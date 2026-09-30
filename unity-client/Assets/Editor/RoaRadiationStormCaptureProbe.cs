#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Кадры бури для глаз: полоса на 3D-карте мира и три кадра зоны z_08_06
    /// игровой камерой — стена на подходе, стена над игроком, глубина бури с
    /// молнией. Путь — снимок сервера shift_7 (как в RoaRadiationStormProbe),
    /// время подбирается так, чтобы стена стояла на заданном расстоянии.
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.RoaRadiationStormCaptureProbe.Run,
    /// папка кадров — ROA_STORM_CAPTURE_DIR (по умолчанию Temp/RadiationStorm).
    /// </summary>
    public static class RoaRadiationStormCaptureProbe
    {
        private const string ZoneId = "z_08_06";
        private const string Fixture = @"{'id':'shift_7','strength':2,'phase':'active','dirX':-0.940999,'dirY':-0.338409,'headingDeg':199.78,'widthKm':60,'waveKm':10,
            'waves':[{'amp':6,'k':0.041888,'lead':5.469,'trail':5.297},{'amp':3,'k':0.098175,'lead':1.195,'trail':1.023},{'amp':1,'k':0.232711,'lead':3.204,'trail':1.279}],
            'lead0Km':-469.1024,'speedKmPerSec':0.299501,'warningStartAt':54000000,'activeStartAt':54600000,'activeEndAt':56400000,'afterglowEndAt':57600000,
            'bounds':{'minX':0,'minY':0,'maxX':380,'maxY':300},'frame':{'ox':170,'oy':130,'kx':0.0625,'kz':0.0625}}";

        [MenuItem("Realm of Ashes/Probe/Radiation storm frames")]
        public static void Run()
        {
            string outDir = Environment.GetEnvironmentVariable("ROA_STORM_CAPTURE_DIR");
            if (string.IsNullOrEmpty(outDir)) outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "RadiationStorm"));
            Directory.CreateDirectory(outDir);
            try
            {
                JObject storm = JObject.Parse(Fixture);
                RoaRadiationStormPath path = RoaRadiationStormPath.Parse(storm);
                CaptureWorldMap(path, outDir);
                CaptureZone(storm, path, outDir);
                Debug.Log("[RADIATION STORM FRAMES] OK: " + outDir);
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[RADIATION STORM FRAMES] FAIL " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
            }
        }

        private static void CaptureWorldMap(RoaRadiationStormPath path, string outDir)
        {
            string repo = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            JObject graph = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data", "kromka", "zone-graph.json")));
            float zoneKm = graph["grid"]?["zoneKm"]?.ToObject<float>() ?? 20f;
            int cols = graph["grid"]?["cols"]?.ToObject<int>() ?? 19;
            int rows = graph["grid"]?["rows"]?.ToObject<int>() ?? 15;
            Scene scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath, OpenSceneMode.Single);
            RoaUnityGlobalMapScene authored = null;
            foreach (GameObject top in scene.GetRootGameObjects())
            {
                authored = top.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (authored != null) break;
            }
            if (authored == null) throw new Exception("the world map scene has no RoaUnityGlobalMapScene");
            var map = new GameObject("StormWorldMapProbe").AddComponent<RoaWorldMap3D>();
            map.SetWorldSize(cols * zoneKm, rows * zoneKm);
            map.AttachForProbe(scene, authored, false);
            var zones = new List<JObject>();
            foreach (JObject zone in graph["zones"] as JArray ?? new JArray())
            {
                var gates = new System.Text.StringBuilder();
                foreach (var side in new[] { ("north", 'n'), ("east", 'e'), ("south", 's'), ("west", 'w') })
                    if (zone["edges"]?[side.Item1]?["open"]?.ToObject<bool>() == true) gates.Append(side.Item2);
                zones.Add(new JObject { ["id"] = zone["id"], ["col"] = zone["col"], ["row"] = zone["row"], ["mode"] = zone["mode"], ["gates"] = gates.ToString() });
            }
            map.ShowZones(zones, zoneKm, RoaWorldOverviewCanvas.DangerZoneColor);
            double now = path.ActiveStartAt + 12 * 60000d;
            map.ShowStorm(path, now);
            if (!map.HasStorm) throw new Exception("the world map shows no storm in the middle of its pass");
            map.SetPlayer(new Vector2(170f, 130f));
            // Как при открытии карты в игре: без тумана локального мира и с ровным светом.
            RenderSettings.fog = false;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.49f, 0.45f, 1f);
            string warmup = Path.Combine(outDir, "warmup.png");
            map.CaptureTo(warmup, 640, 360);
            File.Delete(warmup);
            map.FocusOn(new Vector2(190f, 150f), 34f);
            map.SetView(0f, 62f);
            map.CaptureTo(Path.Combine(outDir, "worldmap.png"), 1280, 720);
            map.FocusOn(new Vector2(170f, 130f), 12f);
            map.SetView(0f, 60f);
            map.CaptureTo(Path.Combine(outDir, "worldmap_close.png"), 1280, 720);
            UnityEngine.Object.DestroyImmediate(map.gameObject);
        }

        private static void CaptureZone(JObject storm, RoaRadiationStormPath path, string outDir)
        {
            EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/" + ZoneId + ".unity", OpenSceneMode.Single);
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "StormProbeGround";
            ground.transform.position = new Vector3(0f, -0.04f, 0f);
            ground.transform.localScale = new Vector3(40f, 1f, 40f);
            var groundMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "StormProbeGround" };
            groundMaterial.SetColor("_BaseColor", new Color(0.56f, 0.49f, 0.37f, 1f));
            ground.GetComponent<Renderer>().sharedMaterial = groundMaterial;

            var cameraObject = new GameObject("StormProbeCamera") { tag = "MainCamera" };
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = RoaCameraRig.GameplayFieldOfView;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 400f;
            camera.allowHDR = true;
            cameraObject.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;

            GameObject sunObject = GameObject.Find("Directional Light");
            if (sunObject == null)
            {
                sunObject = new GameObject("Directional Light");
                sunObject.AddComponent<Light>().type = LightType.Directional;
            }
            var lightingHost = new GameObject("StormProbeLighting");
            RoaWorldLighting lighting = lightingHost.AddComponent<RoaWorldLighting>();
            lighting.Sun = sunObject.GetComponent<Light>();
            lighting.FixedWorldHour = RoaWorldLighting.WebFixedWorldHour;
            lighting.SetLocation(new LocationDefinition { Id = ZoneId, Kind = "zone" }, ground.GetComponent<Renderer>());
            lighting.SetLocalWorldActive(true);

            var host = new GameObject("StormProbeHost");
            RoaRadiationStorm component = host.AddComponent<RoaRadiationStorm>();
            component.ApplyShift(new JObject { ["phase"] = "active", ["serverNow"] = path.ActiveStartAt, ["sheltered"] = false, ["storm"] = storm }, ZoneId);
            if (!component.LocalAxes(out Vector2 dl, out _, out float kmPerMetre)) throw new Exception("no storm axes");

            var player = new Vector3(18f, 0f, 26f);
            Vector2 global = component.Frame.LocalToGlobal(player.x, player.z);
            RoaRadiationStormPath.Sample early = path.SampleAt(global.x, global.y, path.ActiveStartAt);
            double reachedAt = path.ActiveStartAt + early.EtaMs;
            double metresPerMs = path.SpeedKmPerSec / 1000d / kmPerMetre;
            // Кадры: стена в 24 м, стена на игроке, глубина бури (14 с за стеной ≈ 60 м).
            var shots = new (string name, double at, bool strike)[]
            {
                ("zone_approach", reachedAt - 24d / metresPerMs, false),
                ("zone_wall", reachedAt + 1.5d / metresPerMs, false),
                ("zone_inside", reachedAt + 60d / metresPerMs, false),
                ("zone_inside_strike", reachedAt + 62d / metresPerMs, true)
            };
            Quaternion orbit = Quaternion.Euler(55f, 45f, 0f);
            foreach (var shot in shots)
            {
                Vector3 focus = player + Vector3.up;
                camera.transform.SetPositionAndRotation(focus - orbit * Vector3.forward * 16f, orbit);
                component.PreviewForProbe(player, shot.at, shot.strike);
                GameObject root = GameObject.Find("RadiationStorm");
                if (root != null)
                    foreach (ParticleSystem system in root.GetComponentsInChildren<ParticleSystem>(true))
                        system.Simulate(3f, true, true, true);
                lighting.SetWeather(component.Presence, component.Flash);
                lighting.RefreshWeather();
                string file = Path.Combine(outDir, shot.name + ".png");
                Capture(camera, file, 1280, 720);
                Debug.Log($"[RADIATION STORM FRAMES] {shot.name}: inside {component.Here.Inside}, ahead {component.Here.AheadKm:0.00} km, presence {component.Presence:0.00}, flash {component.Flash:0.00}");
            }
            UnityEngine.Object.DestroyImmediate(host);
            UnityEngine.Object.DestroyImmediate(lightingHost);
            UnityEngine.Object.DestroyImmediate(groundMaterial);
        }

        private static void Capture(Camera camera, string path, int width, int height)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            target.Create();
            RenderTexture previous = RenderTexture.active;
            camera.targetTexture = target;
            try
            {
                camera.Render();
                camera.Render();
                RenderTexture.active = target;
                var image = new Texture2D(width, height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                File.WriteAllBytes(path, image.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(image);
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previous;
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }
    }
}
#endif
