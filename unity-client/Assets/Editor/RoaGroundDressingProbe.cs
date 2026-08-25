#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks deterministic budgets, navigation safety and a real terrain render.</summary>
    [InitializeOnLoad]
    public static class RoaGroundDressingProbe
    {
        private const string RequestName = "RoaGroundDressingProbe.request";
        private static double _nextRequestCheck;

        static RoaGroundDressingProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить оформление земли")]
        public static void Run()
        {
            GameObject host = null;
            GameObject settlementHost = null;
            try
            {
                Require(RoaGroundDressing.SupportsTile(0) && RoaGroundDressing.SupportsTile(4),
                    "обычная и тёмная земля не принимают декоративные детали");
                Require(!RoaGroundDressing.SupportsTile(3) && !RoaGroundDressing.SupportsTile(5),
                    "камни или кусты могут появиться в воде либо на дороге");
                Require(RoaGroundDressing.SurfaceBudget(true) < RoaGroundDressing.SurfaceBudget(false)
                        && RoaGroundDressing.RidgeBudget(true) < RoaGroundDressing.RidgeBudget(false),
                    "мобильный бюджет оформления не снижен");

                LocationDefinition location = Location("probe_wasteland", 18, 18, 24371L);
                JArray map = MixedMap(18, 18);
                host = new GameObject("Ground dressing probe");
                RoaLocalTerrain terrain = host.AddComponent<RoaLocalTerrain>();
                terrain.Initialize(location, map);

                int budget = RoaGroundDressing.SurfaceBudget(Application.isMobilePlatform);
                Require(terrain.SurfaceDetailClusterCount > budget / 2
                        && terrain.SurfaceDetailClusterCount <= budget,
                    "деталей поверхности слишком мало или больше бюджета: "
                    + terrain.SurfaceDetailClusterCount + "/" + budget);
                Require(terrain.DistantRidgeCount == RoaGroundDressing.RidgeBudget(Application.isMobilePlatform),
                    "дальний рельеф не соблюдает бюджет");
                int expectedDetailSize = Application.isMobilePlatform ? 64 : 128;
                Require(terrain.MicroDetailTextureSize == expectedDetailSize
                        && terrain.GroundRenderer.sharedMaterial.GetTexture("_DetailAlbedoMap") != null
                        && terrain.GroundRenderer.sharedMaterial.IsKeywordEnabled("_DETAIL_MULX2"),
                    "повторяемая микротекстура земли не подключена");
                Require(terrain.DetailVertexCount > terrain.SurfaceDetailClusterCount * 4
                        && terrain.DetailVertexCount < 2200,
                    "геометрический бюджет оформления нарушен: " + terrain.DetailVertexCount);
                int initialVertices = terrain.DetailVertexCount;

                Transform dressing = host.transform.Find("GroundDressing");
                Require(dressing != null, "корень GroundDressing не создан");
                Require(dressing.GetComponentsInChildren<Collider>(true).Length == 0,
                    "визуальное оформление добавило игровой коллайдер");
                MeshRenderer[] renderers = dressing.GetComponentsInChildren<MeshRenderer>(true);
                Require(renderers.Length == 2
                        && Array.TrueForAll(renderers, renderer => renderer.sharedMaterial != null),
                    "ожидались отдельные материалы кустарника и камней");

                GameObject dressingObject = dressing.gameObject;
                Require(!terrain.ApplyMap(map), "одинаковый авторитетный снимок пересобрал оформление");
                Require(host.transform.Find("GroundDressing").gameObject == dressingObject,
                    "одинаковый снимок пересоздал визуальную геометрию");
                CaptureIfRequested(host);

                JArray water = FilledMap(18, 18, 3);
                Require(terrain.ApplyMap(water), "новый авторитетный снимок не применился");
                Require(terrain.SurfaceDetailClusterCount == 0
                        && terrain.DistantRidgeCount == RoaGroundDressing.RidgeBudget(Application.isMobilePlatform),
                    "вода получила наземный декор либо потеряла дальний силуэт");

                settlementHost = new GameObject("Settlement dressing probe");
                RoaLocalTerrain settlement = settlementHost.AddComponent<RoaLocalTerrain>();
                settlement.Initialize(Location("settlement", 38, 38, 9961L), null);
                Require(settlement.SurfaceDetailClusterCount > 0,
                    "авторское поселение без tile-снимка осталось полностью пустым");

                Debug.Log("[ОФОРМЛЕНИЕ ЗЕМЛИ] готово: поверхность=" + budget
                    + ", дальний рельеф=" + RoaGroundDressing.RidgeBudget(Application.isMobilePlatform)
                    + ", вершины=" + initialVertices + ", коллайдеры=0");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (settlementHost != null) UnityEngine.Object.DestroyImmediate(settlementHost);
            }
        }

        private static LocationDefinition Location(string id, int width, int depth, long seed)
        {
            return new LocationDefinition
            {
                Id = id,
                Seed = seed,
                RuntimeMode = "procedural",
                Map = new MapDefinition
                {
                    Width = width * 2,
                    Depth = depth * 2,
                    TechnicalWidth = width * 2,
                    TechnicalDepth = depth * 2,
                    Origin = "center"
                },
                Grid = new GridDefinition { Step = 2f },
                Spawn = new TileCoord { Tx = width / 2, Tz = depth / 2 },
                EntryFromWorld = new TileCoord { Tx = width / 2, Tz = depth / 2 + 1 },
                Exit = new LocationTransition { Tx = width - 2, Tz = depth / 2, Radius = 1.5f }
            };
        }

        private static JArray MixedMap(int width, int depth)
        {
            JArray map = FilledMap(width, depth, 0);
            for (int z = 0; z < depth; z++)
            {
                JArray row = (JArray)map[z];
                row[2] = 3;
                row[width / 2] = 5;
                if (z % 4 == 0) row[width - 3] = 4;
            }
            return map;
        }

        private static JArray FilledMap(int width, int depth, int value)
        {
            var map = new JArray();
            for (int z = 0; z < depth; z++)
            {
                var row = new JArray();
                for (int x = 0; x < width; x++) row.Add(value);
                map.Add(row);
            }
            return map;
        }

        private static void CaptureIfRequested(GameObject host)
        {
            string path = Environment.GetEnvironmentVariable("ROA_GROUND_DRESSING_CAPTURE");
            if (string.IsNullOrWhiteSpace(path)) return;

            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            Texture2D readback = null;
            GameObject cameraObject = null;
            GameObject lightObject = null;
            AmbientMode previousAmbient = RenderSettings.ambientMode;
            Color previousAmbientLight = RenderSettings.ambientLight;
            try
            {
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.42f, 0.38f, 0.30f);

                lightObject = new GameObject("GroundDressingCaptureLight");
                Light light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.color = new Color(1f, 0.82f, 0.61f);
                light.intensity = 1.2f;
                light.shadows = LightShadows.Soft;
                lightObject.transform.rotation = Quaternion.Euler(48f, -32f, 0f);

                cameraObject = new GameObject("GroundDressingCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.11f, 0.085f, 0.055f);
                camera.orthographic = false;
                camera.fieldOfView = 42f;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 80f;
                Vector3 focus = new Vector3(3f, 0f, 1f);
                Quaternion orbit = Quaternion.Euler(55f, 45f, 0f);
                cameraObject.transform.position = focus - orbit * Vector3.forward * 14f;
                cameraObject.transform.rotation = orbit;

                target = new RenderTexture(768, 480, 24, RenderTextureFormat.ARGB32)
                {
                    name = "GroundDressingCapture",
                    antiAliasing = 1
                };
                target.Create();
                camera.targetTexture = target;
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();

                RenderTexture.active = target;
                readback = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
                Debug.Log("[ОФОРМЛЕНИЕ ЗЕМЛИ] кадр: " + path);
            }
            finally
            {
                RenderSettings.ambientMode = previousAmbient;
                RenderSettings.ambientLight = previousAmbientLight;
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null)
                {
                    target.Release();
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (lightObject != null) UnityEngine.Object.DestroyImmediate(lightObject);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
