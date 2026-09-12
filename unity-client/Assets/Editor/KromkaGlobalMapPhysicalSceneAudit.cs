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
    // Covers imported props even after prefab unpacking, and samples the actual
    // rendered interior AND exterior terrain. Findings need assembly-aware review:
    // a bridge deck can be supported by a separate pier, unlike a floating house.
    internal static class KromkaGlobalMapPhysicalSceneAudit
    {
        [MenuItem("Realm of Ashes/Checks/Visual review/Physical scene contact")]
        public static void Run()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (scene.path != "Assets/Scenes/Kromka/KromkaGlobalMap.unity")
                throw new InvalidOperationException("Open the authored global map first.");
            MeshFilter[] filters = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<MeshFilter>(true)).ToArray();
            var grounds = new List<MeshCollider>();
            var temporary = new List<GameObject>();
            try
            {
                foreach (MeshFilter filter in filters)
                {
                    Renderer renderer = filter.GetComponent<Renderer>();
                    if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                    if (!renderer.sharedMaterials.Any(material => material != null
                        && (material.name == "Kromka_GlobalTerrain_MEP"
                            || material.name == "Kromka_OuterNuclearGround_MEP"))) continue;
                    var go = new GameObject("PhysicalSceneTerrainProbe") { hideFlags = HideFlags.HideAndDontSave };
                    temporary.Add(go);
                    go.transform.SetPositionAndRotation(filter.transform.position, filter.transform.rotation);
                    go.transform.localScale = filter.transform.lossyScale;
                    MeshCollider collider = go.AddComponent<MeshCollider>();
                    collider.sharedMesh = filter.sharedMesh;
                    grounds.Add(collider);
                }
                Physics.SyncTransforms();
                var roots = new HashSet<GameObject>();
                foreach (MeshFilter filter in filters)
                {
                    string source = AssetDatabase.GetAssetPath(filter.sharedMesh);
                    if (!source.StartsWith("Assets/ThirdParty/", StringComparison.Ordinal)
                        && !source.StartsWith("Assets/MEP/", StringComparison.Ordinal)) continue;
                    if (!filter.gameObject.activeInHierarchy) continue;
                    GameObject instance = PrefabUtility.GetOutermostPrefabInstanceRoot(filter.gameObject);
                    roots.Add(instance != null ? instance : filter.gameObject);
                }
                var inventory = new JArray();
                foreach (GameObject root in roots.OrderBy(item => item.name))
                {
                    Renderer[] renderers = root.GetComponentsInChildren<Renderer>()
                        .Where(renderer => renderer.enabled && renderer.gameObject.activeInHierarchy).ToArray();
                    if (renderers.Length == 0) continue;
                    Bounds bounds = renderers[0].bounds;
                    foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                    var heights = new List<float>();
                    foreach (Vector2 sample in new[] { Vector2.zero, new Vector2(-1f, -1f),
                        new Vector2(-1f, 1f), new Vector2(1f, -1f), new Vector2(1f, 1f),
                        new Vector2(1f, 0f), new Vector2(-1f, 0f), new Vector2(0f, 1f), new Vector2(0f, -1f) })
                    {
                        Vector3 point = new Vector3(bounds.center.x + bounds.extents.x * .8f * sample.x,
                            10f, bounds.center.z + bounds.extents.z * .8f * sample.y);
                        float highest = float.NegativeInfinity;
                        foreach (MeshCollider ground in grounds)
                            if (ground.Raycast(new Ray(point, Vector3.down), out RaycastHit hit, 35f))
                                highest = Mathf.Max(highest, hit.point.y);
                        if (!float.IsNegativeInfinity(highest)) heights.Add(highest);
                    }
                    MeshFilter first = root.GetComponentsInChildren<MeshFilter>().FirstOrDefault();
                    inventory.Add(new JObject {
                        ["name"] = root.name,
                        ["source"] = first == null ? "" : AssetDatabase.GetAssetPath(first.sharedMesh),
                        ["worldX"] = bounds.center.x, ["worldZ"] = bounds.center.z,
                        ["height"] = bounds.size.y, ["footprint"] = Mathf.Max(bounds.size.x, bounds.size.z),
                        ["groundSamples"] = heights.Count,
                        ["bottomGap"] = heights.Count == 0 ? (float?)null : bounds.min.y - heights.Max(),
                        ["cornerGap"] = heights.Count == 0 ? (float?)null : bounds.min.y - heights.Min(),
                        ["groundSpread"] = heights.Count == 0 ? (float?)null : heights.Max() - heights.Min(),
                        ["reviewUnsupported"] = heights.Count == 0 || bounds.min.y > heights.Max() + .025f
                    });
                }
                string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                    "../../Build/KromkaSceneCaptures/physical-scene-audit.json"));
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                File.WriteAllText(output, new JObject {
                    ["createdAt"] = DateTime.UtcNow.ToString("O"), ["groundMeshes"] = grounds.Count,
                    ["objects"] = inventory.Count, ["models"] = inventory }.ToString());
                Debug.Log("[KROMKA PHYSICAL CONTACT] Inspected " + inventory.Count + " objects against "
                    + grounds.Count + " rendered terrain meshes. Assembly review candidates: "
                    + inventory.Count(item => (bool)item["reviewUnsupported"]) + ". " + output);
                WriteAssemblyContacts(grounds);
                WriteRailClearance(roots);
            }
            finally { foreach (GameObject go in temporary) UnityEngine.Object.DestroyImmediate(go); }
        }

        private static void WriteRailClearance(HashSet<GameObject> roots)
        {
            Vector2[] route = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(
                KromkaGlobalMapRouteSurfaceAuthoring.OreFreightRail);
            var corridor = new List<Bounds>();
            var headings = new List<Quaternion>();
            for (int i = 0; i < route.Length - 1; i++)
            {
                int steps = Mathf.Max(1, Mathf.CeilToInt(Vector2.Distance(route[i], route[i + 1]) / .4f));
                for (int step = 0; step <= steps; step++)
                {
                    Vector2 map = Vector2.Lerp(route[i], route[i + 1], step / (float)steps);
                    float ground = KromkaGlobalMapReliefAuthoring.HeightAtMap(map.x, map.y);
                    float rail = KromkaGlobalMapRouteCrossingAuthoring.RailwaySurfaceHeight(map, ground);
                    corridor.Add(new Bounds(new Vector3((map.x - 190f) * .1f,
                        rail + .16f, (150f - map.y) * .1f), new Vector3(.24f, .30f, .24f)));
                    Vector2 heading = (route[i + 1] - route[i]).normalized;
                    headings.Add(Quaternion.LookRotation(new Vector3(heading.x, 0f, -heading.y), Vector3.up));
                }
            }
            var findings = new JArray();
            foreach (GameObject root in roots)
            {
                if (root.name.Contains("RoadBridge")) continue;
                Renderer[] renderers = root.GetComponentsInChildren<Renderer>()
                    .Where(r => r.enabled && r.gameObject.activeInHierarchy).ToArray();
                if (renderers.Length == 0) continue;
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer r in renderers.Skip(1)) bounds.Encapsulate(r.bounds);
                bool blocked = corridor.Any(clearance => bounds.Intersects(clearance));
                if (blocked) blocked = HasRailMeshContact(root, corridor, headings);
                if (blocked) findings.Add(new JObject { ["object"] = root.name,
                    ["mapX"] = 190f + bounds.center.x * 10f, ["mapY"] = 150f - bounds.center.z * 10f,
                    ["sizeX"] = bounds.size.x, ["sizeZ"] = bounds.size.z,
                    ["hitX"] = 190f + corridor.First(c => bounds.Intersects(c)).center.x * 10f,
                    ["hitY"] = 150f - corridor.First(c => bounds.Intersects(c)).center.z * 10f });
            }
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/rail-clearance-candidates.json"));
            File.WriteAllText(output, new JObject { ["createdAt"] = DateTime.UtcNow.ToString("O"),
                ["candidates"] = findings }.ToString());
            Debug.Log("[KROMKA RAIL CLEARANCE] Imported-object corridor candidates: " + findings.Count);
        }

        private static bool HasRailMeshContact(GameObject model, List<Bounds> corridor, List<Quaternion> headings)
        {
            // Broad bounds include empty space around rotated/irregular models.
            // Confirm using the visible mesh and a swept, track-aligned loading gauge.
            var temporary = new List<GameObject>();
            try
            {
                var gaugeObject = new GameObject("RailClearanceGauge") { hideFlags = HideFlags.HideAndDontSave };
                temporary.Add(gaugeObject);
                BoxCollider gauge = gaugeObject.AddComponent<BoxCollider>();
                gauge.size = new Vector3(.24f, .30f, .08f);
                foreach (MeshFilter filter in model.GetComponentsInChildren<MeshFilter>())
                {
                    Renderer renderer = filter.GetComponent<Renderer>();
                    if (renderer == null || !renderer.enabled || filter.sharedMesh == null) continue;
                    var probe = new GameObject("RailObstacleMesh") { hideFlags = HideFlags.HideAndDontSave };
                    temporary.Add(probe);
                    probe.transform.SetPositionAndRotation(filter.transform.position, filter.transform.rotation);
                    probe.transform.localScale = filter.transform.lossyScale;
                    MeshCollider mesh = probe.AddComponent<MeshCollider>(); mesh.sharedMesh = filter.sharedMesh;
                    Physics.SyncTransforms();
                    for (int i = 0; i < corridor.Count; i++)
                    {
                        if (!renderer.bounds.Intersects(corridor[i])) continue;
                        if (Physics.ComputePenetration(gauge, corridor[i].center, headings[i],
                            mesh, probe.transform.position, probe.transform.rotation, out Vector3 direction, out float distance)
                            && distance > .002f) return true;
                    }
                }
                return false;
            }
            finally { foreach (GameObject go in temporary) UnityEngine.Object.DestroyImmediate(go); }
        }

        private static void WriteAssemblyContacts(List<MeshCollider> grounds)
        {
            // Propagate support through touching structural parts. Unlike the
            // imported-model inventory this sees individual procedural lamps,
            // braces and ring segments as well as their foundations.
            GameObject models = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            MeshRenderer[] parts = models.GetComponentsInChildren<MeshRenderer>()
                .Where(r => r.enabled && r.bounds.size.y > .01f
                    && Mathf.Max(r.bounds.size.x, r.bounds.size.z) < 4.5f)
                .Where(r => !r.sharedMaterials.Any(m => m != null
                    && m.name.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0)).ToArray();
            Bounds[] bounds = parts.Select(r => r.bounds).ToArray();
            bool[] supported = new bool[parts.Length];
            float[] gap = new float[parts.Length];
            for (int i = 0; i < parts.Length; i++)
            {
                float highest = float.NegativeInfinity;
                foreach (Vector2 sample in new[] { Vector2.zero, Vector2.one, -Vector2.one,
                    new Vector2(-1f, 1f), new Vector2(1f, -1f) })
                {
                    Vector3 from = new Vector3(bounds[i].center.x + sample.x * bounds[i].extents.x * .8f,
                        10f, bounds[i].center.z + sample.y * bounds[i].extents.z * .8f);
                    foreach (MeshCollider ground in grounds)
                        if (ground.Raycast(new Ray(from, Vector3.down), out RaycastHit hit, 35f))
                            highest = Mathf.Max(highest, hit.point.y);
                }
                gap[i] = bounds[i].min.y - highest;
                supported[i] = gap[i] <= .008f;
            }
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (int i = 0; i < parts.Length; i++)
                {
                    if (supported[i]) continue;
                    Bounds contact = bounds[i]; contact.Expand(.012f);
                    for (int j = 0; j < parts.Length; j++)
                        if (supported[j] && contact.Intersects(bounds[j]))
                        { supported[i] = true; changed = true; break; }
                }
            }
            var detached = new JArray();
            for (int i = 0; i < parts.Length; i++)
            {
                if (supported[i]) continue;
                string hierarchy = parts[i].name;
                for (Transform p = parts[i].transform.parent; p != null && p != models.transform; p = p.parent)
                    hierarchy = p.name + "/" + hierarchy;
                detached.Add(new JObject { ["object"] = hierarchy, ["groundGap"] = gap[i],
                    ["mapX"] = 190f + bounds[i].center.x * 10f,
                    ["mapY"] = 150f - bounds[i].center.z * 10f });
            }
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/assembly-contact-candidates.json"));
            File.WriteAllText(output, new JObject { ["createdAt"] = DateTime.UtcNow.ToString("O"),
                ["parts"] = parts.Length, ["detached"] = detached.Count, ["candidates"] = detached,
                ["limitation"] = "Conservative bounding-box connectivity, requires close visual verification." }.ToString());
            Debug.Log("[KROMKA ASSEMBLY CONTACT] " + parts.Length + " parts; " + detached.Count + " candidates. " + output);
        }
    }
}
#endif
