using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Guards the strategic map against buildings being placed in the Tesma.
    /// Purpose-built bridges, dams and abutments are reported
    /// separately because crossing the water is their authored function.
    /// </summary>
    internal static class KromkaGlobalMapRiverClearanceAudit
    {
        private const float WorldScale = 0.1f;
        private const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        [MenuItem("Kromka/Checks/Write river-clearance audit")]
        public static void WriteReport()
        {
            GameObject modelRoot = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (modelRoot == null)
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                modelRoot = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            }
            if (modelRoot == null)
                throw new InvalidOperationException("Global-map model root is missing");

            var blockers = new List<string>();
            var hydraulic = new List<string>();
            var visited = new HashSet<GameObject>();
            int scannedStructures = 0;
            Transform[] transforms = modelRoot.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < transforms.Length; i++)
            {
                GameObject instance = PrefabUtility.GetOutermostPrefabInstanceRoot(
                    transforms[i].gameObject);
                if (instance == null || !visited.Add(instance)) continue;
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance)
                    .Replace('\\', '/');
                if (!IsStructureSource(source)) continue;
                if (IsNaturalRiverDebris(instance, source)) continue;
                scannedStructures++;

                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                if (renderers.Length == 0) continue;
                Bounds bounds = Encapsulate(renderers);
                // Authoring code maps north/up (larger map Y) to negative world Z.
                // Mirror that conversion exactly or the audit compares structures
                // against a vertically flipped river and reports false blockers.
                Vector2 map = new Vector2(bounds.center.x / WorldScale + MapCentre.x,
                    MapCentre.y - bounds.center.z / WorldScale);
                float radius = Mathf.Max(bounds.extents.x, bounds.extents.z) / WorldScale;
                float tesmaClearance = DistanceToPath(map,
                    KromkaGlobalMapWaterAuthoring.SampleTesma(), 1.9f, 2.55f)
                    - radius;
                if (tesmaClearance > 0.35f) continue;

                string entry = instance.name + " | map=" + map.x.ToString("0.0") + ","
                    + map.y.ToString("0.0") + " | radius=" + radius.ToString("0.0")
                    + " | TesmaClearance=" + tesmaClearance.ToString("0.0")
                    + " | " + source;
                if (IsHydraulicStructure(instance.transform)) hydraulic.Add(entry);
                else blockers.Add(entry);
            }

            // Procedural towers, retaining walls and braces are not prefabs.
            // They must participate too: the old prefab-only audit missed the
            // R-12 column standing directly in the river and road bridge.
            Vector2[] river = KromkaGlobalMapWaterAuthoring.SampleTesma();
            foreach (MeshRenderer renderer in modelRoot.GetComponentsInChildren<MeshRenderer>())
            {
                if (!renderer.enabled || PrefabUtility.GetOutermostPrefabInstanceRoot(renderer.gameObject) != null)
                    continue;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null) continue;
                string meshSource = AssetDatabase.GetAssetPath(filter.sharedMesh);
                if (!string.IsNullOrEmpty(meshSource) && meshSource.StartsWith("Assets/")) continue;
                if (renderer.sharedMaterials.Any(material => material != null
                    && material.name.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0)) continue;
                scannedStructures++;
                Bounds b = renderer.bounds;
                bool overlaps = false;
                for (int row = 0; row < river.Length; row++)
                {
                    Vector2 point = river[row];
                    float halfWidth = Mathf.Lerp(1.9f, 2.55f, row / (river.Length - 1f)) * WorldScale;
                    float x = (point.x - MapCentre.x) * WorldScale;
                    float z = (MapCentre.y - point.y) * WorldScale;
                    float dx = Mathf.Max(b.min.x - x, 0f, x - b.max.x);
                    float dz = Mathf.Max(b.min.z - z, 0f, z - b.max.z);
                    if (dx * dx + dz * dz <= halfWidth * halfWidth) { overlaps = true; break; }
                }
                if (!overlaps) continue;
                string entry = renderer.transform.parent.name + "/" + renderer.name + " | procedural structure";
                if (IsHydraulicStructure(renderer.transform)) hydraulic.Add(entry);
                else blockers.Add(entry);
            }

            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string reportPath = Path.GetFullPath(Path.Combine(projectRoot,
                "../Build/KromkaSceneCaptures/river-clearance-audit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath));
            var lines = new List<string>
            {
                "Kromka global-map river-clearance audit",
                "scanned_structures=" + scannedStructures,
                "blocking_structures=" + blockers.Count,
                "authored_hydraulic_structures=" + hydraulic.Count,
                string.Empty,
                "BLOCKING STRUCTURES"
            };
            lines.AddRange(blockers.Count == 0 ? new[] { "none" } : blockers);
            lines.Add(string.Empty);
            lines.Add("AUTHORED BRIDGES, DAMS AND ABUTMENTS");
            lines.AddRange(hydraulic.Count == 0 ? new[] { "none" } : hydraulic);
            File.WriteAllLines(reportPath, lines);
            AssetDatabase.SaveAssets();
            Debug.Log("[KROMKA RIVER CLEARANCE] scanned=" + scannedStructures
                + ", blockers=" + blockers.Count + ", hydraulic="
                + hydraulic.Count + ". Report: " + reportPath);
            if (blockers.Count > 0)
                throw new InvalidOperationException("River-clearance audit found "
                    + blockers.Count + " non-hydraulic structures in the water");
        }

        internal static bool IsStructureSource(string path)
        {
            return path.StartsWith("Assets/ThirdParty/Kenney/CityKitIndustrial20/",
                       StringComparison.Ordinal)
                || path.StartsWith("Assets/ThirdParty/Kenney/FactoryKit30/",
                       StringComparison.Ordinal)
                || path.StartsWith("Assets/ThirdParty/Kenney/SpaceKit10/",
                       StringComparison.Ordinal)
                || path.StartsWith("Assets/ThirdParty/SovietCC0/",
                       StringComparison.Ordinal)
                || path.StartsWith("Assets/MEP/MEP_Environment/MEP_Buildings&Props/",
                       StringComparison.Ordinal)
                || path.StartsWith("Assets/ThirdParty/OpenGameArt/ConcreteBridge/",
                       StringComparison.Ordinal);
        }

        private static bool IsHydraulicStructure(Transform instance)
        {
            // Deliberately use a narrow allow-list. A broad parent-name check
            // previously allowed ordinary SouthSluiceStop fences into the river.
            // Only authored spans and their structural supports may overlap water.
            for (Transform cursor = instance; cursor != null; cursor = cursor.parent)
            {
                string name = cursor.name;
                if (name.StartsWith("TesmaMainTract_RoadBridge",
                        StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("R12SouthService_RoadBridge",
                        StringComparison.OrdinalIgnoreCase)
                    || name.Equals("TesmaFreightRail_SUPPORTED_EDITABLE",
                        StringComparison.OrdinalIgnoreCase)
                    || name.Equals("NorthernSluices_DamComplex_MEP",
                        StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        private static bool IsNaturalRiverDebris(GameObject instance, string source)
        {
            return instance.name.IndexOf("Windfall", StringComparison.OrdinalIgnoreCase) >= 0
                || source.IndexOf("MEP_S_Branch_", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static float DistanceToPath(Vector2 point, Vector2[] path,
                                            float startWidth, float endWidth)
        {
            float best = float.MaxValue;
            for (int i = 0; i < path.Length - 1; i++)
            {
                Vector2 a = path[i];
                Vector2 b = path[i + 1];
                Vector2 ab = b - a;
                float t = Mathf.Clamp01(Vector2.Dot(point - a, ab)
                    / Mathf.Max(0.0001f, ab.sqrMagnitude));
                Vector2 closest = a + ab * t;
                float progress = (i + t) / (path.Length - 1f);
                float halfWidth = Mathf.Lerp(startWidth, endWidth, progress);
                best = Mathf.Min(best, Vector2.Distance(point, closest) - halfWidth);
            }
            return best;
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }
    }
}
