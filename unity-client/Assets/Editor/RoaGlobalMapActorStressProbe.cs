#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Profiling;
using Debug = UnityEngine.Debug;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Play Mode density probe for the global map. It deliberately uses a dead
    /// endpoint: every one of the 33 party models must come from the project
    /// prefab catalog. Timing and memory are reported for comparison, while the
    /// deterministic pass/fail gates cover object reuse, fitting and animation LOD.
    /// </summary>
    public static class RoaGlobalMapActorStressProbe
    {
        public const int PartyCount = 33;
        public const int NearAnimationBudget = 6;
        public const int MovingFarAnimationBudget = 10;
        private const string DeadBaseUrl = "http://127.0.0.1:9";
        private const float Epsilon = 0.06f;

        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        public static void RunBatch()
        {
            if (EditorApplication.isPlaying)
            {
                RunBatchAsync();
                return;
            }

            try
            {
                _previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
                _previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
                _batchOptionsCaptured = true;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
                EditorApplication.EnterPlaymode();
            }
            catch (Exception error)
            {
                Debug.LogError("[GLOBAL MAP STRESS] FAIL: " + error);
                FinishBatch(1);
            }
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeStateChanged;
            RunBatchAsync();
        }

        private static async void RunBatchAsync()
        {
            try
            {
                await RunStressAsync();
                FinishBatch(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[GLOBAL MAP STRESS] FAIL: " + error);
                FinishBatch(1);
            }
        }

        private static void FinishBatch(int exitCode)
        {
            if (_batchOptionsCaptured)
            {
                EditorSettings.enterPlayModeOptions = _previousEnterPlayModeOptions;
                EditorSettings.enterPlayModeOptionsEnabled = _previousEnterPlayModeOptionsEnabled;
                _batchOptionsCaptured = false;
            }
            EditorApplication.Exit(exitCode);
        }

        public static async Task RunStressAsync()
        {
            var roots = new List<GameObject>(PartyCount);
            var views = new List<RoaGlobalMapActorView>(PartyCount);
            long memoryBefore = Profiler.GetTotalAllocatedMemoryLong();
            var watch = Stopwatch.StartNew();
            try
            {
                var loads = new List<Task>(PartyCount);
                for (int i = 0; i < PartyCount; i++)
                {
                    var root = new GameObject("GlobalMapStressParty:" + i);
                    int column = i % 11;
                    int row = i / 11;
                    root.transform.position = new Vector3((column - 5) * 2.5f,
                        0.45f, (row - 1) * 3.2f);
                    roots.Add(root);
                    RoaGlobalMapActorView view = root.AddComponent<RoaGlobalMapActorView>();
                    views.Add(view);
                    loads.Add(view.ConfigureParty(DeadBaseUrl, Party(i)));
                }
                await Task.WhenAll(loads);
                watch.Stop();

                VerifyModels(roots, views);
                VerifyAssetReuse(views);
                VerifyAnimationBudget(views);
                VerifyCenteredTurning(roots, views);

                string capturePath = Environment.GetEnvironmentVariable(
                    "ROA_GLOBAL_MAP_STRESS_CAPTURE");
                if (!string.IsNullOrWhiteSpace(capturePath))
                {
                    for (int i = 0; i < views.Count; i++)
                    {
                        views[i].SetPresentationLod(RoaActorPresentationTier.Near);
                        views[i].SetMotion(Direction(i), i % 3 != 1);
                    }
                    Capture(capturePath, roots);
                }

                long memoryAfter = Profiler.GetTotalAllocatedMemoryLong();
                int uniqueMeshes = UniqueMeshes(views).Count;
                int uniqueMaterials = UniqueMaterials(views).Count;
                Debug.Log("[GLOBAL MAP STRESS] PASS parties=" + views.Count
                    + " prefab=33 nearBudget=" + NearAnimationBudget
                    + " movingFarBudget=" + MovingFarAnimationBudget
                    + " uniqueMeshes=" + uniqueMeshes
                    + " uniqueMaterials=" + uniqueMaterials
                    + " loadMs=" + watch.ElapsedMilliseconds
                    + " memoryDelta=" + Math.Max(0L, memoryAfter - memoryBefore));
            }
            finally
            {
                for (int i = 0; i < roots.Count; i++)
                    if (roots[i] != null) Object.DestroyImmediate(roots[i]);
            }
        }

        private static void VerifyModels(IReadOnlyList<GameObject> roots,
                                         IReadOnlyList<RoaGlobalMapActorView> views)
        {
            Check(views.Count == PartyCount, "wrong party count: " + views.Count);
            for (int i = 0; i < views.Count; i++)
            {
                RoaGlobalMapActorView view = views[i];
                Check(view.Ready && view.ModelRendererCount > 0,
                    "party is not render-ready: " + i);
                Check(view.UsesProjectPrefab,
                    "party used a network model instead of a project prefab: " + i);
                Check(view.TryGetModelWorldBounds(out Bounds rendererBounds),
                    "party has no fitted world bounds: " + i);
                Check(view.TryGetStrategicWorldBounds(out Bounds strategicBounds),
                    "party has no strategic animation envelope: " + i);
                Check(Mathf.Abs(view.CurrentWorldSpan
                    - view.StrategicProfile.TargetWorldSpan) <= Epsilon,
                    "profile span mismatch for " + view.ModelKey + ": "
                    + view.CurrentWorldSpan + " vs " + view.StrategicProfile.TargetWorldSpan);

                float expectedGround = roots[i].transform.position.y
                    - view.StrategicProfile.GroundDropWorld;
                Check(Mathf.Abs(strategicBounds.min.y - expectedGround) <= Epsilon,
                    "ground mismatch for " + view.ModelKey + ": " + strategicBounds.min.y
                    + " vs " + expectedGround);
                Check(HorizontalDistance(strategicBounds.center,
                        roots[i].transform.position) <= 0.03f,
                    "model is not centered over its marker: " + view.ModelKey);
                Check(RendererEnvelopeFits(view, roots[i].transform.position,
                        rendererBounds, 0.14f),
                    "renderer envelope is outside its fitted profile: " + view.ModelKey
                    + " renderer=" + BoundsText(rendererBounds)
                    + " profile=" + BoundsText(strategicBounds));

                foreach (Collider collider in roots[i].GetComponentsInChildren<Collider>(true))
                    Check(!collider.enabled, "enabled strategic collider on " + view.ModelKey);
            }
        }

        private static void VerifyAssetReuse(IReadOnlyList<RoaGlobalMapActorView> views)
        {
            var meshesByModel = new Dictionary<string, HashSet<Mesh>>(StringComparer.Ordinal);
            var materialsByModel = new Dictionary<string, HashSet<Material>>(StringComparer.Ordinal);
            for (int i = 0; i < views.Count; i++)
            {
                RoaGlobalMapActorView view = views[i];
                HashSet<Mesh> meshes = Meshes(view);
                HashSet<Material> materials = Materials(view);
                Check(meshes.Count > 0, "model has no shared mesh: " + view.ModelKey);
                Check(materials.Count > 0, "model has no shared material: " + view.ModelKey);
                foreach (Material material in materials)
                {
                    Check(material != null && !material.name.EndsWith(" (Instance)",
                        StringComparison.Ordinal), "instanced material on " + view.ModelKey);
                    Check(AssetDatabase.Contains(material),
                        "runtime-only material on prefab model " + view.ModelKey);
                }

                if (meshesByModel.TryGetValue(view.ModelKey, out HashSet<Mesh> expectedMeshes))
                {
                    Check(expectedMeshes.SetEquals(meshes),
                        "duplicate instances do not share meshes: " + view.ModelKey);
                    Check(materialsByModel[view.ModelKey].SetEquals(materials),
                        "duplicate instances do not share materials: " + view.ModelKey);
                }
                else
                {
                    meshesByModel[view.ModelKey] = meshes;
                    materialsByModel[view.ModelKey] = materials;
                }
            }
            Check(meshesByModel.Count == 8,
                "stress set should cover 8 creature archetypes, got " + meshesByModel.Count);
        }

        private static void VerifyAnimationBudget(IReadOnlyList<RoaGlobalMapActorView> views)
        {
            for (int i = 0; i < views.Count; i++)
            {
                views[i].SetMotion(Vector3.forward, false);
                views[i].SetPresentationLod(RoaActorPresentationTier.Far);
            }
            Check(EnabledAnimations(views) == 0,
                "stationary far parties still evaluate animation");

            for (int i = 0; i < NearAnimationBudget; i++)
                views[i].SetPresentationLod(RoaActorPresentationTier.Near);
            Check(EnabledAnimations(views) == NearAnimationBudget,
                "near animation budget is not deterministic");

            for (int i = NearAnimationBudget;
                 i < NearAnimationBudget + MovingFarAnimationBudget; i++)
            {
                views[i].SetMotion(Direction(i), true);
                Check(views[i].MotionClip == "walk",
                    "moving far party did not select walk: " + views[i].ModelKey);
            }
            Check(EnabledAnimations(views)
                    == NearAnimationBudget + MovingFarAnimationBudget,
                "moving far animation budget is not deterministic");

            for (int i = PartyCount - 5; i < PartyCount; i++)
            {
                views[i].SetPresentationLod(RoaActorPresentationTier.Hidden);
                Check(!views[i].ModelVisible && views[i].EnabledAnimationCount == 0,
                    "hidden party kept its model or animation active");
            }
        }

        private static void VerifyCenteredTurning(IReadOnlyList<GameObject> roots,
                                                  IReadOnlyList<RoaGlobalMapActorView> views)
        {
            for (int i = 0; i < views.Count; i++)
            {
                views[i].SetPresentationLod(RoaActorPresentationTier.Near);
                views[i].SetMotion(Direction(i), true);
                Check(views[i].TryGetStrategicWorldBounds(out Bounds bounds),
                    "turned model lost its strategic bounds: " + views[i].ModelKey);
                Check(HorizontalDistance(bounds.center, roots[i].transform.position) <= 0.03f,
                    "turned model orbited away from its marker: " + views[i].ModelKey);
            }
        }

        private static JObject Party(int index)
        {
            var party = new JObject
            {
                ["id"] = "stress-party-" + index,
                ["state"] = index % 3 == 1 ? "onsite" : "moving"
            };
            switch (index % 8)
            {
                case 0:
                    party["kind"] = "caravan";
                    party["faction"] = "caravans";
                    break;
                case 1:
                    party["kind"] = "mutant";
                    party["faction"] = "mutants";
                    break;
                case 2:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "fire-gecko";
                    break;
                case 3:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "gecko";
                    break;
                case 4:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "radscorpion";
                    break;
                case 5:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "mutant-ant";
                    break;
                case 6:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "ghoul";
                    break;
                default:
                    party["kind"] = "monster";
                    party["faction"] = "wild";
                    party["visual"] = "ash-wolf";
                    break;
            }
            return party;
        }

        private static Vector3 Direction(int index)
        {
            switch (index % 4)
            {
                case 0: return Vector3.forward;
                case 1: return Vector3.right;
                case 2: return Vector3.back;
                default: return Vector3.left;
            }
        }

        private static int EnabledAnimations(IReadOnlyList<RoaGlobalMapActorView> views)
        {
            int count = 0;
            for (int i = 0; i < views.Count; i++) count += views[i].EnabledAnimationCount;
            return count;
        }

        private static HashSet<Mesh> UniqueMeshes(IReadOnlyList<RoaGlobalMapActorView> views)
        {
            var result = new HashSet<Mesh>();
            for (int i = 0; i < views.Count; i++) result.UnionWith(Meshes(views[i]));
            return result;
        }

        private static HashSet<Material> UniqueMaterials(IReadOnlyList<RoaGlobalMapActorView> views)
        {
            var result = new HashSet<Material>();
            for (int i = 0; i < views.Count; i++) result.UnionWith(Materials(views[i]));
            return result;
        }

        private static HashSet<Mesh> Meshes(RoaGlobalMapActorView view)
        {
            var result = new HashSet<Mesh>();
            foreach (MeshFilter filter in view.GetComponentsInChildren<MeshFilter>(true))
                if (filter.sharedMesh != null) result.Add(filter.sharedMesh);
            foreach (SkinnedMeshRenderer renderer
                     in view.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (renderer.sharedMesh != null) result.Add(renderer.sharedMesh);
            return result;
        }

        private static HashSet<Material> Materials(RoaGlobalMapActorView view)
        {
            var result = new HashSet<Material>();
            foreach (Renderer renderer in view.GetComponentsInChildren<Renderer>(true))
                foreach (Material material in renderer.sharedMaterials)
                    if (material != null) result.Add(material);
            return result;
        }

        private static float HorizontalDistance(Vector3 left, Vector3 right)
        {
            float dx = left.x - right.x;
            float dz = left.z - right.z;
            return Mathf.Sqrt(dx * dx + dz * dz);
        }

        private static bool RendererEnvelopeFits(RoaGlobalMapActorView view, Vector3 root,
                                                 Bounds baked, float groundTolerance)
        {
            float span = view.StrategicProfile.FitMode == RoaStrategicActorFitMode.Height
                ? baked.size.y : Mathf.Max(baked.size.x, baked.size.z);
            float target = view.StrategicProfile.TargetWorldSpan;
            float expectedGround = root.y - view.StrategicProfile.GroundDropWorld;
            return span >= target * 0.82f && span <= target * 1.15f
                && Mathf.Abs(baked.min.y - expectedGround) <= groundTolerance;
        }

        private static string BoundsText(Bounds value)
        {
            return "center(" + value.center.x.ToString("0.000") + ","
                + value.center.y.ToString("0.000") + ","
                + value.center.z.ToString("0.000") + ") size("
                + value.size.x.ToString("0.000") + ","
                + value.size.y.ToString("0.000") + ","
                + value.size.z.ToString("0.000") + ")";
        }


        private static void Capture(string path, IReadOnlyList<GameObject> actorRoots)
        {
            string fullPath = Path.GetFullPath(path);
            string directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "GlobalMapStressGround";
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = new Vector3(3.2f, 1f, 1.4f);
            Renderer groundRenderer = ground.GetComponent<Renderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Standard");
            Material groundMaterial = shader != null ? new Material(shader) : null;
            if (groundMaterial != null)
            {
                groundMaterial.color = new Color(0.16f, 0.105f, 0.065f, 1f);
                groundRenderer.sharedMaterial = groundMaterial;
            }

            var cameraObject = new GameObject("GlobalMapStressCamera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.backgroundColor = new Color(0.025f, 0.021f, 0.017f, 1f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.orthographic = true;
            camera.orthographicSize = 10.4f;
            cameraObject.transform.position = new Vector3(0f, 18f, -13f);
            cameraObject.transform.LookAt(new Vector3(0f, 0.35f, 0f));

            var lightObject = new GameObject("GlobalMapStressLight");
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.84f, 0.63f, 1f);
            light.intensity = 1.7f;
            lightObject.transform.rotation = Quaternion.Euler(52f, -32f, 0f);

            var target = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32);
            var image = new Texture2D(1600, 900, TextureFormat.RGB24, false);
            RenderTexture previous = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                image.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                image.Apply();
                File.WriteAllBytes(fullPath, image.EncodeToPNG());
                Debug.Log("[GLOBAL MAP STRESS] capture=" + fullPath
                    + " actors=" + actorRoots.Count);
            }
            finally
            {
                RenderTexture.active = previous;
                camera.targetTexture = null;
                Object.DestroyImmediate(image);
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(lightObject);
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(ground);
                if (groundMaterial != null) Object.DestroyImmediate(groundMaterial);
            }
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "[GLOBAL MAP STRESS] " + message);
        }
    }
}
#endif
