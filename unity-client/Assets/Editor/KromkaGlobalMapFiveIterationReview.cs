#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>Repeatable whole-scene review coverage for five visual iterations.</summary>
    internal static class KromkaGlobalMapFiveIterationReview
    {
        private const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private readonly struct View
        {
            internal readonly string Name;
            internal readonly float X, Y, Yaw, Pitch, Distance;
            internal View(string name, float x, float y, float yaw, float pitch, float distance)
            { Name = name; X = x; Y = y; Yaw = yaw; Pitch = pitch; Distance = distance; }
        }
        private static readonly View[] Regions =
        {
            new View("northern-sluices", 201f, 270f, 180f, 33f, 13f),
            new View("ore-arc", 98f, 223f, 35f, 30f, 12f),
            new View("middle-vein", 194f, 204f, 180f, 30f, 11f),
            new View("tract-isthmus", 141f, 153f, 40f, 30f, 11f),
            new View("glasslands", 300f, 190f, 180f, 30f, 12f),
            new View("chalk-lowland", 309f, 105f, 160f, 30f, 12f),
            new View("zero-basin", 210f, 57f, 140f, 30f, 13f),
            new View("silent-ring", 85f, 77f, 60f, 30f, 13f)
        };
        private static readonly View[] Overviews =
        {
            new View("gloom-tower-detail", 78f, 65f, 100f, 25f, 4.5f),
            new View("fuel-tanks-detail", 147f, 43f, 0f, 50f, 4.5f),
            new View("rail-bridge-detail", 199f, 217f, 180f, 50f, 5f),
            new View("crown-reservoir-detail", 205f, 272f, 180f, 40f, 8f),
            new View("r12-structure-detail", 205f, 65f, 160f, 40f, 6f),
            new View("overview-south", 190f, 150f, 180f, 65f, 65f),
            new View("overview-north", 190f, 150f, 0f, 65f, 65f),
            new View("outer-north", 190f, 300f, 180f, 25f, 25f),
            new View("outer-east", 380f, 150f, -90f, 25f, 25f),
            new View("outer-south", 190f, 0f, 0f, 25f, 25f),
            new View("outer-west", 0f, 150f, 90f, 25f, 25f)
        };

        [MenuItem("Realm of Ashes/Checks/Visual review/Baseline")]
        public static void CaptureBaseline() => Capture(0);
        [MenuItem("Realm of Ashes/Checks/Visual review/Iteration 1")]
        public static void CaptureFirst() => Capture(1);
        [MenuItem("Realm of Ashes/Checks/Visual review/Iteration 2")]
        public static void CaptureSecond() => Capture(2);
        [MenuItem("Realm of Ashes/Checks/Visual review/Iteration 3")]
        public static void CaptureThird() => Capture(3);
        [MenuItem("Realm of Ashes/Checks/Visual review/Iteration 4")]
        public static void CaptureFourth() => Capture(4);
        [MenuItem("Realm of Ashes/Checks/Visual review/Iteration 5")]
        public static void CaptureFifth() => Capture(5);

        [MenuItem("Realm of Ashes/Checks/Visual review/Roadside placement")]
        public static void ValidateRoadsidePlacement()
        {
            if (SceneManager.GetActiveScene().path != ScenePath)
                throw new InvalidOperationException("Open the authored global map first.");
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapSovietReplacementAuthoring.Validate();
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
        }

        [MenuItem("Realm of Ashes/Checks/Visual review/Final structural probes")]
        public static void ValidateFinalStructures()
        {
            ValidateRoadsidePlacement();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapBoundaryAuthoring.Validate();
            KromkaGlobalMapOuterWastelandPerimeterAuthoring.ValidateCompleted();
            KromkaGlobalMapPhysicalSceneAudit.Run();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../Build/KromkaSceneCaptures"));
            JObject assemblies = JObject.Parse(File.ReadAllText(Path.Combine(output, "assembly-contact-candidates.json")));
            JObject rail = JObject.Parse(File.ReadAllText(Path.Combine(output, "rail-clearance-candidates.json")));
            JObject models = JObject.Parse(File.ReadAllText(Path.Combine(output, "physical-scene-audit.json")));
            if ((int)assemblies["detached"] != 0 || ((JArray)rail["candidates"]).Count != 0
                || ((JArray)models["models"]).Any(item => (bool)item["reviewUnsupported"]))
                throw new InvalidOperationException("Review the remaining unsupported parts/rail blockers before accepting the scene.");
            Debug.Log("[KROMKA FINAL PHYSICAL REVIEW] PASS: structures, joints, river/road/rail corridors and outer perimeter.");
        }

        [MenuItem("Realm of Ashes/Checks/Visual review/Outer ruin details")]
        public static void CaptureRuinDetails()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath) throw new InvalidOperationException("Open the global map first.");
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/ruin-review"));
            Directory.CreateDirectory(output);
            MeshFilter[] selected = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<MeshFilter>(true))
                .Where(filter => AssetDatabase.GetAssetPath(filter.sharedMesh)
                    .Contains("MajadroidApocalypticBuildings/Models/building"))
                .OrderBy(filter => filter.GetComponent<Renderer>().bounds.center.sqrMagnitude)
                .Take(3).ToArray();
            for (int i = 0; i < selected.Length; i++)
            {
                Bounds bounds = selected[i].GetComponent<Renderer>().bounds;
                Take(scene, output, new View("ruin-" + i, 190f + bounds.center.x * 10f,
                    150f - bounds.center.z * 10f, 160f, 30f, 4.5f), false);
            }
        }

        private static void Capture(int iteration)
        {
            Scene scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || scene.path != ScenePath)
                throw new InvalidOperationException("Open the authored Kromka global map first.");
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/visual-review-5/" + iteration.ToString("00")));
            Directory.CreateDirectory(output);
            WriteContactInventory(scene, output);
            foreach (View view in Regions)
            {
                Take(scene, output, view, false);
                Take(scene, output, view, true);
            }
            foreach (View view in Overviews) Take(scene, output, view, false);
            foreach (string name in new[] { "TesmaMainTract_RoadBridge", "R12SouthService_RoadBridge" })
            {
                Renderer deck = GameObject.Find(name).GetComponentsInChildren<Renderer>()
                    .Single(renderer => renderer.name == "road");
                var detail = new View(name + "-detail", 190f + deck.bounds.center.x * 10f,
                    150f - deck.bounds.center.z * 10f, 180f, 50f, 6f);
                Take(scene, output, detail, false);
                Take(scene, output, detail, true);
            }
            File.WriteAllText(Path.Combine(output, "capture-coverage.txt"),
                "Captured " + DateTime.UtcNow.ToString("O") + "\n"
                + "Scene: " + scene.path + "\n"
                + "Eight regions at desktop 1600x900 and landscape mobile 932x430.\n"
                + "Two whole-map overviews, four low-angle boundary views, rail/dam/R12 details.\n"
                + "Two road crossings at desktop and mobile detail scale.\n"
                + "Scene rendering captured; visual acceptance still requires image inspection.\n");
            Debug.Log("[KROMKA FIVE-ITERATION REVIEW] Captured iteration " + iteration
                + ": 31 views covering all regions, boundaries and structures. " + output);
        }

        [MenuItem("Realm of Ashes/Checks/Visual review/Boundary seam isolation")]
        public static void IsolateBoundarySeam()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath) throw new InvalidOperationException("Open the global map first.");
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/boundary-seam-isolation"));
            Directory.CreateDirectory(output);
            var view = new View("baseline", 85f, 77f, 60f, 30f, 13f);
            Take(scene, output, view, false);
            foreach (string name in new[] { "TerrainApron_FadesIntoStorm", "BoundaryLine",
                "SilentRing_CliffBelt_MEP", "KromkaLandmass_Relief_100pct" })
            {
                GameObject target = GameObject.Find(name); if (target == null) continue;
                Renderer[] renderers = target.GetComponentsInChildren<Renderer>();
                bool[] enabled = renderers.Select(r => r.enabled).ToArray();
                try
                {
                    foreach (Renderer r in renderers) r.enabled = false;
                    Take(scene, output, new View("without-" + name, view.X, view.Y,
                        view.Yaw, view.Pitch, view.Distance), false);
                }
                finally { for (int i = 0; i < renderers.Length; i++) renderers[i].enabled = enabled[i]; }
            }
        }

        private static void Take(Scene scene, string output, View view, bool mobile)
        {
            KromkaSceneCapture.CaptureSector(scene, Path.Combine(output,
                view.Name + (mobile ? "-mobile.png" : "-desktop.png")),
                view.X, view.Y, view.Yaw, view.Pitch, view.Distance,
                mobile ? 932 : 1600, mobile ? 430 : 900);
        }

        private static void WriteContactInventory(Scene scene, string output)
        {
            MeshFilter terrain = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<MeshFilter>(true))
                .Single(filter => filter.name == "KromkaLandmass_Relief_100pct");
            var probeObject = new GameObject("VisualReviewTerrainProbe")
                { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                probeObject.transform.SetPositionAndRotation(terrain.transform.position,
                    terrain.transform.rotation);
                probeObject.transform.localScale = terrain.transform.lossyScale;
                MeshCollider probe = probeObject.AddComponent<MeshCollider>();
                probe.sharedMesh = terrain.sharedMesh;
                var visited = new HashSet<GameObject>();
                var inventory = new JArray();
                foreach (Transform node in scene.GetRootGameObjects()
                    .SelectMany(root => root.GetComponentsInChildren<Transform>(true)))
                {
                    GameObject instance = PrefabUtility.GetOutermostPrefabInstanceRoot(node.gameObject);
                    if (instance == null || !instance.activeInHierarchy || !visited.Add(instance)) continue;
                    Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                        .Where(renderer => renderer.enabled && renderer.gameObject.activeInHierarchy).ToArray();
                    if (renderers.Length == 0) continue;
                    Bounds bounds = renderers[0].bounds;
                    foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                    var heights = new List<float>();
                    foreach (Vector2 corner in new[] { Vector2.zero, new Vector2(-1f, -1f),
                        new Vector2(-1f, 1f), new Vector2(1f, -1f), new Vector2(1f, 1f) })
                    {
                        Vector3 start = new Vector3(bounds.center.x + corner.x * bounds.extents.x * .8f,
                            10f, bounds.center.z + corner.y * bounds.extents.z * .8f);
                        if (probe.Raycast(new Ray(start, Vector3.down), out RaycastHit hit, 30f))
                            heights.Add(hit.point.y);
                    }
                    if (heights.Count == 0) continue;
                    float bottomGap = bounds.min.y - heights.Max();
                    float groundSpread = heights.Max() - heights.Min();
                    inventory.Add(new JObject {
                        ["name"] = instance.name,
                        ["source"] = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance),
                        ["mapX"] = 190f + bounds.center.x * 10f,
                        ["mapY"] = 150f - bounds.center.z * 10f,
                        ["height"] = bounds.size.y,
                        ["width"] = Mathf.Max(bounds.size.x, bounds.size.z),
                        ["bottomAboveHighestGround"] = bottomGap,
                        ["groundSpread"] = groundSpread,
                        ["bottomBelowLowestGround"] = heights.Min() - bounds.min.y,
                        ["reviewFloating"] = bottomGap > .025f,
                        ["reviewDeepBurial"] = heights.Min() - bounds.min.y > Mathf.Max(.08f, bounds.size.y * .35f)
                    });
                }
                File.WriteAllText(Path.Combine(output, "model-contact.json"),
                    new JObject { ["capturedAt"] = DateTime.UtcNow.ToString("O"),
                        ["scope"] = "Active scene prefab bounds sampled against the visible landmass mesh; candidates require visual review.",
                        ["models"] = inventory }.ToString());
            }
            finally { UnityEngine.Object.DestroyImmediate(probeObject); }
        }
    }
}
#endif
