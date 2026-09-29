#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Окно зоны и компас 3D-карты мира на снимке. Берёт дамп /api/world-map
    /// (Library/AgentCaptures/ZoneWindow/world-map.json), открывает сцену карты, выбирает
    /// зону с жилой (игрок стоит в ней), столицу и зону высшего тира и снимает карту вместе
    /// с окном на десктопе и телефоне. Проверяет: окно открыто и целиком в кадре, тир и
    /// ресурсы заполнены, местность снята (кадр не пуст), север компаса смотрит туда же,
    /// куда карта, при повороте камеры.
    /// </summary>
    public static class RoaWorldZoneWindowProbe
    {
        private const int UiLayer = 31;

        [MenuItem("Realm of Ashes/Zones/Check world map zone window")]
        public static void Run()
        {
            string outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library", "AgentCaptures", "ZoneWindow"));
            Directory.CreateDirectory(outDir);
            var report = new StringBuilder();
            Scene scene = default;
            Scene userScene = SceneManager.GetActiveScene();
            try
            {
                Check(outDir, report, out scene);
                report.AppendLine("RESULT OK");
                Debug.Log("[ZONE WINDOW] OK\n" + report);
            }
            catch (Exception error)
            {
                report.AppendLine("RESULT FAIL " + error.Message);
                Debug.LogError("[ZONE WINDOW] FAIL " + error + "\n" + report);
            }
            finally
            {
                File.WriteAllText(Path.Combine(outDir, "report.txt"), report.ToString());
                // Сцена карты открыта рядом с открытой сценой пользователя и закрывается без сохранения.
                if (userScene.IsValid() && userScene.isLoaded) SceneManager.SetActiveScene(userScene);
                if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
            }
            if (Application.isBatchMode) EditorApplication.Exit(report.ToString().Contains("RESULT OK") ? 0 : 1);
        }

        private static void Check(string outDir, StringBuilder report, out Scene scene)
        {
            JObject world = JObject.Parse(File.ReadAllText(Path.Combine(outDir, "world-map.json")))["map"] as JObject;
            Require(world != null, "world-map.json has no map");
            float zoneKm = world["zoneKm"]?.ToObject<float>() ?? 20f;
            int cols = world["cols"]?.ToObject<int>() ?? 19, rows = world["rows"]?.ToObject<int>() ?? 15;
            List<JObject> zones = (world["zones"] as JArray).OfType<JObject>().ToList();
            var capitals = new HashSet<string>((world["capitals"] as JArray ?? new JArray()).Select(t => t.ToString()));
            JObject hotspot = zones.First(z => z["hotspot"] is JObject && (z["places"] as JArray)?.Count > 0);
            JObject capital = zones.FirstOrDefault(z => capitals.Contains(z["city"]?.ToString() ?? "")) ?? zones.First(z => z["city"] != null);
            JObject high = zones.Where(z => (z["places"] as JArray)?.Count > 0).OrderByDescending(z => z["tier"]?.ToObject<int>() ?? 0).First();

            scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath, OpenSceneMode.Additive);
            RoaUnityGlobalMapScene authored = null;
            foreach (GameObject top in scene.GetRootGameObjects())
            {
                authored = top.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (authored != null) break;
            }
            Require(authored != null, "the world map scene has no RoaUnityGlobalMapScene");
            // Всё, что проба и карта создают, рождается в сцене карты, а не в сцене пользователя.
            SceneManager.SetActiveScene(scene);
            var host = new GameObject("ZoneWindowProbe");
            SceneManager.MoveGameObjectToScene(host, scene);
            RoaWorldMap3D map = host.AddComponent<RoaWorldMap3D>();
            map.SetWorldSize(cols * zoneKm, rows * zoneKm);
            map.AttachForProbe(scene, authored, false);
            RoaWorldOverviewCanvas overview = host.AddComponent<RoaWorldOverviewCanvas>();
            overview.ApplyWorld(world);
            overview.ProbeSelf = new JObject { ["zone"] = new JObject { ["id"] = hotspot["id"] }, ["x"] = 60f, ["z"] = -70f };
            // Свет карты как в игре (RoaWorldMap3D.Open): ровный рассеянный свет, без тумана.
            RenderSettings.fog = false;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.49f, 0.45f, 1f);
            overview.AttachMapForProbe(map);

            Capture(overview, map, hotspot, null, 0f, false, Path.Combine(outDir, "hotspot-desktop.png"), 1440, 810, report, zoneKm);
            Capture(overview, map, capital, null, 35f, false, Path.Combine(outDir, "capital-desktop.png"), 1440, 810, report, zoneKm);
            string placeId = (high["places"] as JArray)[0]["id"]?.ToString();
            Capture(overview, map, high, placeId, -60f, false, Path.Combine(outDir, "high-desktop.png"), 1440, 810, report, zoneKm);
            Capture(overview, map, hotspot, null, 0f, true, Path.Combine(outDir, "hotspot-mobile.png"), 1334, 620, report, zoneKm);
        }

        private static void Capture(RoaWorldOverviewCanvas overview, RoaWorldMap3D map, JObject zone, string placeId, float yaw, bool mobile,
            string file, int width, int height, StringBuilder report, float zoneKm)
        {
            Canvas canvas = overview.GetComponentsInChildren<Canvas>(true).First(c => c.name == "WorldOverviewCanvas");
            RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var uiCamera = new GameObject("ProbeUiCamera").AddComponent<Camera>();
            SceneManager.MoveGameObjectToScene(uiCamera.gameObject, overview.gameObject.scene);
            try
            {
                uiCamera.enabled = false;
                uiCamera.clearFlags = CameraClearFlags.Depth;
                uiCamera.cullingMask = 1 << UiLayer;
                uiCamera.targetTexture = target;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = uiCamera;
                canvas.planeDistance = 1f;

                Vector2 centre = new Vector2((zone["col"].ToObject<int>() + 0.5f) * zoneKm, (zone["row"].ToObject<int>() + 0.5f) * zoneKm);
                map.FocusOn(centre, 16f);
                map.SetView(yaw, 58f);
                // Запечённая карта зоны (RoaZoneMapBaker): в редакторе корутина загрузки не идёт, кладём снимок сами.
                string mapFile = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "public", "assets", "zone-maps", zone["id"] + ".jpg"));
                Require(File.Exists(mapFile), "no baked zone map " + mapFile);
                var zoneMap = new Texture2D(2, 2);
                zoneMap.LoadImage(File.ReadAllBytes(mapFile));
                overview.SetZoneMapForProbe(zone["id"].ToString(), zoneMap);
                overview.SelectForProbe(zone["id"].ToString(), placeId);
                overview.UpdateCompassForProbe();
                foreach (Transform node in canvas.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = UiLayer;
                Canvas.ForceUpdateCanvases();

                Require(overview.ZoneWindowOpen, "the zone window did not open for " + zone["id"]);
                RectTransform window = canvas.GetComponentsInChildren<RectTransform>(true).First(r => r.name == "ZoneWindow");
                Rect canvasRect = ((RectTransform)canvas.transform).rect;
                Vector3[] corners = new Vector3[4];
                window.GetWorldCorners(corners);
                Vector3 min = canvas.transform.InverseTransformPoint(corners[0]), max = canvas.transform.InverseTransformPoint(corners[2]);
                Require(min.x >= canvasRect.xMin && max.x <= canvasRect.xMax && min.y >= canvasRect.yMin + 48f && max.y <= canvasRect.yMax - 62f,
                    $"the zone window leaves the view between the bars on {(mobile ? "mobile" : "desktop")}: {min}..{max} in {canvasRect}");

                Text tier = window.GetComponentsInChildren<Text>(true).First(t => t.name == "Tier");
                Text title = window.GetComponentsInChildren<Text>(true).First(t => t.name == "Title");
                int resources = window.GetComponentsInChildren<RawImage>(false).Count(r => r.name == "Icon" && r.texture != null);
                int expected = RoaWorldOverviewCanvas.ZoneResources(zone).Count;
                Require(resources == expected, $"{zone["id"]}: {resources} resource icons shown, {expected} expected");
                RawImage terrain = window.GetComponentsInChildren<RawImage>(true).First(r => r.name == "Terrain");
                Require(terrain.texture == zoneMap, zone["id"] + ": the window does not show the baked zone map");
                float spread = Spread(zoneMap);
                Require(spread > 0.05f, $"{zone["id"]}: the terrain frame is flat (spread {spread:0.000})");

                // Север компаса: игла повёрнута на тот же угол, что север карты на экране.
                RectTransform rose = canvas.GetComponentsInChildren<RectTransform>(true).First(r => r.name == "Rose");
                float roseNorth = Mathf.DeltaAngle(0f, -rose.localEulerAngles.z);
                float mapNorth = map.NorthScreenAngle();
                Require(Mathf.Abs(Mathf.DeltaAngle(roseNorth, mapNorth)) < 1f, $"compass {roseNorth:0.0}° vs map north {mapNorth:0.0}°");
                Require(Mathf.Abs(Mathf.DeltaAngle(mapNorth, -yaw)) < 10f, $"with yaw {yaw}° north is at {mapNorth:0.0}° on screen");

                // Карта и окно снимаются раздельно и складываются по альфе окна: базовая камера URP
                // окна всегда очищает кадр, и слоем поверх карты её не положить.
                Color32[] mapPixels = RenderPixels(map.MapCamera, width, height, null);
                uiCamera.clearFlags = CameraClearFlags.SolidColor;
                uiCamera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                Color32[] uiPixels = RenderPixels(uiCamera, width, height, target);
                var composed = new Texture2D(width, height, TextureFormat.RGB24, false);
                var result = new Color32[mapPixels.Length];
                for (int i = 0; i < result.Length; i++)
                    result[i] = Color32.Lerp(mapPixels[i], uiPixels[i], uiPixels[i].a / 255f);
                composed.SetPixels32(result);
                composed.Apply();
                File.WriteAllBytes(file, composed.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(composed);
                report.AppendLine($"{Path.GetFileName(file)}: {zone["id"]} «{title.text}» tier {tier.text}, {resources} resources, terrain spread {spread:0.000}, north {mapNorth:0.0}°");
            }
            finally
            {
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                UnityEngine.Object.DestroyImmediate(uiCamera.gameObject);
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        /// <summary>Разброс яркости кадра: у пустого (одноцветного) кадра он около нуля.</summary>
        private static float Spread(Texture2D texture)
        {
            float low = 1f, high = 0f;
            Color[] pixels = texture.GetPixels();
            for (int i = 0; i < pixels.Length; i += 97)
            {
                low = Mathf.Min(low, pixels[i].grayscale);
                high = Mathf.Max(high, pixels[i].grayscale);
            }
            return high - low;
        }

        private static Color32[] RenderPixels(Camera camera, int width, int height, RenderTexture target)
        {
            RenderTexture own = target ?? new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var request = new UnityEngine.Rendering.Universal.UniversalRenderPipeline.SingleCameraRequest { destination = own };
            if (UnityEngine.Rendering.RenderPipeline.SupportsRenderRequest(camera, request))
                UnityEngine.Rendering.RenderPipeline.SubmitRenderRequest(camera, request);
            else
            {
                RenderTexture keep = camera.targetTexture;
                camera.targetTexture = own;
                camera.Render();
                camera.targetTexture = keep;
            }
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = own;
            var image = new Texture2D(width, height, TextureFormat.RGBA32, false);
            image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            Color32[] pixels = image.GetPixels32();
            UnityEngine.Object.DestroyImmediate(image);
            if (target == null) { own.Release(); UnityEngine.Object.DestroyImmediate(own); }
            return pixels;
        }

        private static void Save(RenderTexture texture, string file)
        {
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = texture;
            var image = new Texture2D(texture.width, texture.height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, texture.width, texture.height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            File.WriteAllBytes(file, image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
