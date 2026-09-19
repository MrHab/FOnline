#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Снимки клеток Сердцевины так, как их строит
    /// игра: глобальная карта из сцены KromkaGlobalMap с ответами /api/global-map,
    /// /api/wasteland и именами из /api/locations (Library/AgentCaptures:
    /// global-map-public.json, wasteland-public.json, locations-names.json), точка
    /// игрока в клетке Сердцевины,
    /// канвас карты с номерами клеток — и окно «Карта мира» с флажком: в
    /// Сердцевине на десктопе и телефоне и в Ключах. Снимки — в
    /// Library/AgentCaptures/core-*.png и overview-*.png. Сцена не сохраняется.
    /// </summary>
    public static class RoaCoreMapCaptureProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        private const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";

        [MenuItem("Realm of Ashes/Глобальная карта/Снимок клеток Сердцевины и обзора")]
        public static void Run()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new Exception("[CORE SHOT] Есть несохранённая сцена (" + SceneManager.GetSceneAt(i).name + ").");

            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string captures = Path.Combine(projectRoot, "Library", "AgentCaptures");
            JObject mapPayload = JObject.Parse(File.ReadAllText(Path.Combine(captures, "global-map-public.json")));
            JObject wastelandPayload = JObject.Parse(File.ReadAllText(Path.Combine(captures, "wasteland-public.json")));
            JObject wasteland = wastelandPayload["sim"] as JObject ?? wastelandPayload;
            GlobalMapDefinition definition = mapPayload["map"].ToObject<GlobalMapDefinition>();
            JObject names = JObject.Parse(File.ReadAllText(Path.Combine(captures, "locations-names.json")));
            if (definition?.DangerWalkCells?.Cells == null || definition.DangerWalkCells.Cells.Count == 0)
                throw new Exception("[CORE SHOT] В выгрузке карты нет клеток Сердцевины (dangerWalkCells).");

            // Клетка игрока — середина списка Сердцевины.
            int[] cell = definition.DangerWalkCells.Cells[definition.DangerWalkCells.Cells.Count / 2];
            float size = definition.DangerWalkCells.SubCellKm;
            var player = new Vector2((cell[0] + 0.5f) * size, (cell[1] + 0.5f) * size);
            string title = definition.DangerWalkCells.NameOf(cell) + " №" + cell[2];

            CaptureMap(definition, wasteland, player, captures);
            var inCore = new JObject
            {
                ["locationId"] = "dangerWalk",
                ["dangerCell"] = new JObject
                {
                    ["sx"] = cell[0], ["sy"] = cell[1], ["x"] = player.x, ["y"] = player.y,
                    ["walk"] = true, ["number"] = cell[2], ["title"] = title
                }
            };
            CaptureOverview(definition, wasteland, names, inCore, captures, false, "overview-desktop.png");
            CaptureOverview(definition, wasteland, names, inCore, captures, true, "overview-mobile.png");
            // Обычная локация: точка игрока на карте из снимка мира, имя — из каталога мест.
            GlobalMapNode keys = definition.Nodes.Find(node => node != null && node.EffectiveLocationId == "settlement");
            if (keys == null) throw new Exception("[CORE SHOT] На карте нет узла Ключей (settlement).");
            var inKeys = new JObject
            {
                ["locationId"] = "settlement",
                ["uiSnapshots"] = new JObject
                {
                    ["world"] = new JObject
                    {
                        ["globalMap"] = new JObject { ["playerX"] = keys.X, ["playerY"] = keys.Y }
                    }
                }
            };
            CaptureOverview(definition, wasteland, names, inKeys, captures, false, "overview-keys.png");
            CaptureHudMinimap(captures, title);
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Debug.Log("[CORE SHOT] OK: клетка игрока " + title + "; снимки → " + captures);
        }

        private static void CaptureMap(GlobalMapDefinition definition, JObject wasteland, Vector2 player, string captures)
        {
            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var authored = UnityEngine.Object.FindAnyObjectByType<RoaUnityGlobalMapScene>();
            if (authored == null) throw new Exception("[CORE SHOT] В сцене нет RoaUnityGlobalMapScene.");
            var host = new GameObject("CoreShotProbe_Temp");
            SceneManager.MoveGameObjectToScene(host, scene);
            try
            {
                var map = host.AddComponent<RoaGlobalMap>();
                map.enabled = false;
                Call(map, "EnsureRuntimeState");
                Set(map, "_map", definition);
                Set(map, "_wasteland", wasteland);
                Set(map, "_authoredScene", authored);
                Set(map, "_root", authored.gameObject);
                Set(map, "_dynamicRoot", authored.DynamicContentRoot != null ? authored.DynamicContentRoot.gameObject : null);
                Transform boundaryLine = authored.StaticContentRoot != null
                    ? authored.StaticContentRoot.Find("WorldEdge_AUTHORED/ToxicBoundaryFog_AUTHORED/BoundaryLine")
                    : null;
                Set(map, "_playableBoundary", boundaryLine != null ? boundaryLine.GetComponent<RoaGlobalMapBoundary>() : null);
                typeof(RoaGlobalMap).GetProperty("IsActive").GetSetMethod(true).Invoke(map, new object[] { true });
                Set(map, "_playerPoint", new GlobalMapPoint { X = player.x, Y = player.y });
                Set(map, "_selectedPoint", new GlobalMapPoint { X = player.x, Y = player.y });
                authored.gameObject.SetActive(true);
                Call(map, "RebuildDynamicWorld");
                typeof(RoaGlobalMap).GetMethod("ApplyDynamicPresentation", Private).Invoke(map, new object[] { true });
                Call(map, "RefreshMarkers");
                if (map.CoreCells.Count == 0) throw new Exception("[CORE SHOT] Сетка Сердцевины не построена.");
                RoaGlobalMap.CoreCellInfo playerCell = map.PlayerCoreCell;
                if (playerCell == null) throw new Exception("[CORE SHOT] Клетка игрока не найдена среди клеток Сердцевины.");

                // Подписи проецирует Camera.main — камера сцены не должна ею оказаться.
                foreach (Camera other in Camera.allCameras)
                    other.enabled = false;

                // Канвас карты: подписи клеток считает сам (RefreshCoreCellLabels).
                var canvasHost = new GameObject("CoreShotCanvas_Temp");
                SceneManager.MoveGameObjectToScene(canvasHost, scene);
                var mapCanvas = canvasHost.AddComponent<RoaGlobalMapCanvas>();
                mapCanvas.Map = map;
                Vector3 center = playerCell.World;
                Shoot(Path.Combine(captures, "core-near.png"), mapCanvas, center, 3.2f, 62f, 1600, 900);
                Shoot(Path.Combine(captures, "core-medium.png"), mapCanvas, center, 8f, 60f, 1600, 900);
                Debug.Log("[CORE SHOT] карта: клеток Сердцевины " + map.CoreCells.Count + ", клетка игрока " + playerCell.Title
                    + ", подписей " + mapCanvas.ActiveCoreLabelCount);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
                if (authored != null) authored.ClearDynamicContent();
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
        }

        private static void Shoot(string path, RoaGlobalMapCanvas mapCanvas, Vector3 target, float distance, float pitch,
                                  int width, int height)
        {
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                cameraObject = new GameObject("CoreShotCamera") { tag = "MainCamera" };
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = RoaCameraRig.StrategicFieldOfView;
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 500f;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = RoaGlobalMap.StrategicProfile(90f).CameraBackground;
                Quaternion orbit = Quaternion.Euler(pitch, 0f, 0f);
                camera.transform.SetPositionAndRotation(target - orbit * Vector3.forward * distance, orbit);
                renderTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                renderTarget.Create();
                camera.targetTexture = renderTarget;

                typeof(RoaGlobalMapCanvas).GetMethod("EnsureBuilt", Private).Invoke(mapCanvas, null);
                Canvas canvas = mapCanvas.GetComponentInChildren<Canvas>(true);
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), false);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                Transform window = mapCanvas.transform.Find("GlobalMapCanvas/GlobalMapWindow");
                if (window != null) window.gameObject.SetActive(true);
                Canvas.ForceUpdateCanvases();
                // Сайдбар встаёт на место только в Update — зовём раскладку и наполнение сами.
                typeof(RoaGlobalMapCanvas).GetMethod("ApplyResponsiveLayout", Private).Invoke(mapCanvas, null);
                try { typeof(RoaGlobalMapCanvas).GetMethod("Refresh", Private).Invoke(mapCanvas, null); }
                catch (TargetInvocationException error) { Debug.LogWarning("[CORE SHOT] Refresh: " + error.InnerException?.Message); }
                Canvas.ForceUpdateCanvases();
                typeof(RoaGlobalMapCanvas).GetMethod("RefreshCoreCellLabels", Private).Invoke(mapCanvas, null);
                Canvas.ForceUpdateCanvases();

                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = renderTarget });
                else camera.Render();
                RenderTexture.active = renderTarget;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                    UnityEngine.Object.DestroyImmediate(cameraObject);
                }
                if (renderTarget != null) renderTarget.Release();
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
            }
        }

        private static void CaptureOverview(GlobalMapDefinition definition, JObject wasteland, JObject names,
                                            JObject self, string captures, bool mobile, string file)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            // Окно открывается поверх локальной сцены; мир глобальной карты в кадре лишний.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            try
            {
                host = new GameObject("OverviewShotProbe_Temp");
                var map = host.AddComponent<RoaGlobalMap>();
                map.enabled = false;
                Call(map, "EnsureRuntimeState");
                Set(map, "_map", definition);
                Set(map, "_wasteland", wasteland);
                var loader = host.AddComponent<RoaLocationLoader>();
                Set(loader, "_locations", names["locations"].ToObject<System.Collections.Generic.Dictionary<string, LocationDefinition>>());
                var overview = host.AddComponent<RoaWorldOverviewCanvas>();
                overview.GlobalMap = map;
                overview.Loader = loader;
                overview.OpenFor(self);
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);

                cameraObject = new GameObject("OverviewShotCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.1f, 0.09f, 0.07f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                int width = mobile ? 1280 : 1920;
                int height = mobile ? 720 : 1080;
                renderTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                Canvas.ForceUpdateCanvases();
                // Раскладка зависит от размера окна, а он известен только после масштабера.
                overview.OpenFor(self);
                Debug.Log("[CORE SHOT] обзор " + file + ": "
                    + host.transform.Find("WorldOverviewCanvas/WorldOverview/Panel/Subtitle")?.GetComponent<Text>()?.text);
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = renderTarget });
                else camera.Render();
                RenderTexture.active = renderTarget;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(Path.Combine(captures, file), readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                    UnityEngine.Object.DestroyImmediate(cameraObject);
                }
                if (renderTarget != null) renderTarget.Release();
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        /// <summary>Панель миникарты HUD с заголовком клетки и кнопкой «КАРТА МИРА» (1280×720).</summary>
        private static void CaptureHudMinimap(string captures, string title)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture renderTarget = null;
            Texture2D readback = null;
            Texture2D fakeMap = null;
            RenderTexture previous = RenderTexture.active;
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            try
            {
                host = new GameObject("HudMinimapProbe_Temp");
                RoaHud hud = host.AddComponent<RoaHud>();
                RoaHudCanvas owner = host.AddComponent<RoaHudCanvas>();
                owner.Configure(hud, null, null, null, null, null);
                ((GameObject)Get(owner, "_mapPanel")).SetActive(true);
                ((Text)Get(owner, "_mapTitle")).text = title;
                // Вместо снимка локации — ровная земля: смотрим раскладку панели.
                fakeMap = new Texture2D(8, 8, TextureFormat.RGBA32, false);
                var ground = new Color32[64];
                for (int i = 0; i < ground.Length; i++) ground[i] = new Color32(58, 52, 40, 255);
                fakeMap.SetPixels32(ground);
                fakeMap.Apply(false, false);
                var image = (RawImage)Get(owner, "_mapImage");
                image.texture = fakeMap;
                image.enabled = true;

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                cameraObject = new GameObject("HudShotCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.13f, 0.085f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                renderTarget = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                renderTarget.Create();
                camera.targetTexture = renderTarget;
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = renderTarget });
                else camera.Render();
                RenderTexture.active = renderTarget;
                readback = new Texture2D(1280, 720, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, 1280, 720), 0, 0, false);
                readback.Apply(false, false);
                File.WriteAllBytes(Path.Combine(captures, "hud-minimap.png"), readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (cameraObject != null)
                {
                    Camera camera = cameraObject.GetComponent<Camera>();
                    if (camera != null) camera.targetTexture = null;
                    UnityEngine.Object.DestroyImmediate(cameraObject);
                }
                if (renderTarget != null) renderTarget.Release();
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (fakeMap != null) UnityEngine.Object.DestroyImmediate(fakeMap);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static object Get(object target, string field)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            return info.GetValue(target);
        }

        private static void Set(object target, string field, object value)
        {
            FieldInfo info = target.GetType().GetField(field, Private);
            if (info == null) throw new MissingFieldException(target.GetType().Name, field);
            info.SetValue(target, value);
        }

        private static void Call(object target, string method)
        {
            MethodInfo info = target.GetType().GetMethod(method, Private);
            if (info == null) throw new MissingMethodException(target.GetType().Name, method);
            info.Invoke(target, null);
        }
    }
}
#endif
