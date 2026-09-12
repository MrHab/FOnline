#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Read-only visual-defect inventory for the strategic map. The overview
    /// camera can hide objects beyond the landmass, oversized meshes and broken
    /// materials, so this audit reports those conditions directly from the saved
    /// scene. Restored lore passes intentionally use compact procedural assemblies,
    /// solid strategic materials and recoloured CC0 kits; those are inventoried but
    /// are no longer confused with abandoned grey-box placeholders.
    /// </summary>
    internal static class KromkaGlobalMapVisualDefectAudit
    {
        private const string GlobalScene =
            "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const float WorldScale = 0.1f;
        private const float OversizedHorizontalExtent = 2.2f;
        private const float OversizedVerticalExtent = 2.2f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        [MenuItem("Kromka/Checks/Write global-map visual defect audit")]
        public static void WriteReport()
        {
            var scene = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            GameObject modelObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (modelObject == null)
                throw new InvalidOperationException(
                    "Global-map model pass is missing");
            KromkaGlobalMapSovietReplacementAuthoring.Validate();

            Renderer[] renderers = modelObject
                .GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled
                    && renderer.gameObject.activeInHierarchy)
                .ToArray();
            var outside = new List<string>();
            var oversized = new List<string>();
            var primitives = new List<string>();
            var untextured = new List<string>();
            var unsuitable = new List<string>();
            var broken = new List<string>();

            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                Bounds bounds = renderer.bounds;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                string meshPath = mesh != null
                    ? AssetDatabase.GetAssetPath(mesh).Replace('\\', '/') : string.Empty;
                if (!RendererInsideLandmass(renderer))
                    outside.Add(Describe(renderer));
                if (!(renderer is LineRenderer)
                        && !IsAuthoredMacroTerrainMesh(meshPath)
                        && (bounds.extents.x > OversizedHorizontalExtent
                            || bounds.extents.z > OversizedHorizontalExtent
                            || bounds.extents.y > OversizedVerticalExtent))
                    oversized.Add(Describe(renderer));
                if (mesh != null && IsUnityPrimitive(mesh, meshPath))
                    primitives.Add(Describe(renderer));
                if (meshPath.IndexOf("/ThirdParty/Kenney/",
                        StringComparison.OrdinalIgnoreCase) >= 0)
                    unsuitable.Add(Describe(renderer));

                Material[] materials = renderer.sharedMaterials;
                if (materials == null || materials.Length == 0
                        || materials.Any(material => material == null
                            || material.shader == null
                            || !material.shader.isSupported))
                    broken.Add(Describe(renderer));
                else if (materials.Any(material => !HasAuthoredTexture(material)))
                    untextured.Add(Describe(renderer));
            }

            Collider[] activeColliders = modelObject
                .GetComponentsInChildren<Collider>(true)
                .Where(collider => collider != null && collider.enabled).ToArray();
            LODGroup[] lodGroups = modelObject
                .GetComponentsInChildren<LODGroup>(true);
            Renderer[] sceneRenderers = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true))
                .Where(renderer => renderer != null && renderer.enabled
                    && renderer.gameObject.activeInHierarchy).ToArray();
            List<string> nonModelPrimitives = sceneRenderers
                .Where(renderer => !renderer.transform.IsChildOf(modelObject.transform))
                .Where(renderer =>
                {
                    MeshFilter filter = renderer.GetComponent<MeshFilter>();
                    Mesh mesh = filter != null ? filter.sharedMesh : null;
                    string path = mesh != null
                        ? AssetDatabase.GetAssetPath(mesh).Replace('\\', '/') : string.Empty;
                    return mesh != null && IsUnityPrimitive(mesh, path);
                })
                .Select(Describe).ToList();
            GameObject locationsObject = GameObject.Find("Locations_EDITABLE");
            Renderer[] locationRenderers = locationsObject == null
                ? Array.Empty<Renderer>()
                : locationsObject.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled
                        && renderer.gameObject.activeInHierarchy).ToArray();
            List<string> outsideLocations = locationRenderers
                .Where(renderer => !RendererInsideLandmass(renderer))
                .Select(Describe).ToList();
            List<string> oversizedLocationMarkers = locationRenderers
                .Where(renderer => renderer.bounds.size.x > 0.55f
                    || renderer.bounds.size.y > 0.55f
                    || renderer.bounds.size.z > 0.55f)
                .Select(Describe).ToList();

            GameObject effectsObject = GameObject.Find(
                "Effects_EffectPass_EDITABLE");
            Renderer[] dustRenderers = effectsObject == null
                ? Array.Empty<Renderer>()
                : effectsObject.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled
                        && renderer.gameObject.activeInHierarchy
                        && HierarchyPath(renderer.transform).IndexOf(
                            "/Dust_Iteration", StringComparison.Ordinal) >= 0)
                    .ToArray();
            List<string> outsideDustCards = dustRenderers
                .Where(renderer => !RendererInsideLandmass(renderer))
                .Select(Describe).ToList();
            List<string> oversizedDustCards = dustRenderers
                .Where(renderer => renderer.bounds.size.x > 2.45f
                    || renderer.bounds.size.z > 2.45f
                    || renderer.bounds.size.y > 0.08f)
                .Select(Describe).ToList();
            Renderer[] fogRenderers = effectsObject == null
                ? Array.Empty<Renderer>()
                : effectsObject.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled
                        && renderer.gameObject.activeInHierarchy
                        && HierarchyPath(renderer.transform).IndexOf(
                            "/Fog_Iteration", StringComparison.Ordinal) >= 0)
                    .ToArray();
            List<string> outsideFogCards = fogRenderers
                .Where(renderer => !RendererInsideLandmass(renderer))
                .Select(Describe).ToList();
            List<string> tallFogCards = fogRenderers
                .Where(renderer => renderer.bounds.size.y > 0.08f)
                .Select(Describe).ToList();
            List<string> oversizedDamElements = renderers
                .Where(renderer => HierarchyPath(renderer.transform).IndexOf(
                    "/NorthernSluices_DamComplex_MEP/",
                    StringComparison.Ordinal) >= 0)
                .Where(DamElementTooTall)
                .Select(Describe).ToList();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/visual-defect-audit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var lines = new List<string>
            {
                "KROMKA GLOBAL MAP VISUAL DEFECT AUDIT",
                "renderers=" + renderers.Length,
                "outside_landmass=" + outside.Count,
                "oversized=" + oversized.Count,
                "authored_procedural_parts=" + primitives.Count,
                "solid_color_materials=" + untextured.Count,
                "restored_kenney_models=" + unsuitable.Count,
                "broken_materials=" + broken.Count,
                "active_colliders=" + activeColliders.Length,
                "lod_groups=" + lodGroups.Length,
                "scene_primitives_outside_model_pass=" + nonModelPrimitives.Count,
                "location_renderers_outside_landmass=" + outsideLocations.Count,
                "oversized_location_markers=" + oversizedLocationMarkers.Count,
                "dust_cards_outside_landmass=" + outsideDustCards.Count,
                "oversized_dust_cards=" + oversizedDustCards.Count,
                "fog_cards_outside_landmass=" + outsideFogCards.Count,
                "tall_fog_cards=" + tallFogCards.Count,
                "oversized_dam_elements=" + oversizedDamElements.Count,
                string.Empty
            };
            Append(lines, "OUTSIDE LANDMASS", outside);
            Append(lines, "OVERSIZED", oversized);
            Append(lines, "AUTHORED PROCEDURAL PARTS (INFORMATIONAL)", primitives);
            Append(lines, "SOLID COLOR MATERIALS (INFORMATIONAL)", untextured);
            Append(lines, "RESTORED KENNEY MODELS (INFORMATIONAL)", unsuitable);
            Append(lines, "BROKEN MATERIALS", broken);
            Append(lines, "SCENE PRIMITIVES OUTSIDE MODEL PASS", nonModelPrimitives);
            Append(lines, "LOCATION RENDERERS OUTSIDE LANDMASS", outsideLocations);
            Append(lines, "OVERSIZED LOCATION MARKERS", oversizedLocationMarkers);
            Append(lines, "DUST CARDS OUTSIDE LANDMASS", outsideDustCards);
            Append(lines, "OVERSIZED DUST CARDS", oversizedDustCards);
            Append(lines, "FOG CARDS OUTSIDE LANDMASS", outsideFogCards);
            Append(lines, "TALL FOG CARDS", tallFogCards);
            Append(lines, "OVERSIZED DAM ELEMENTS", oversizedDamElements);
            File.WriteAllLines(output, lines);
            Debug.Log("[KROMKA VISUAL DEFECT AUDIT] renderers="
                + renderers.Length + ", outside=" + outside.Count
                + ", oversized=" + oversized.Count + ", authoredParts="
                + primitives.Count + ", solidMaterials=" + untextured.Count
                + ", restoredKits=" + unsuitable.Count + ", broken="
                + broken.Count + ", activeColliders=" + activeColliders.Length
                + ", lodGroups=" + lodGroups.Length + ", otherPrimitives="
                + nonModelPrimitives.Count + ", outsideLocations="
                + outsideLocations.Count + ", oversizedLocationMarkers="
                + oversizedLocationMarkers.Count + ", outsideDustCards="
                + outsideDustCards.Count + ", oversizedDustCards="
                + oversizedDustCards.Count + ", outsideFogCards="
                + outsideFogCards.Count + ", tallFogCards="
                + tallFogCards.Count + ", oversizedDamElements="
                + oversizedDamElements.Count + ". Report: " + output);

            int defectCount = outside.Count + oversized.Count + broken.Count
                + activeColliders.Length + lodGroups.Length
                + nonModelPrimitives.Count + outsideLocations.Count
                + oversizedLocationMarkers.Count + outsideDustCards.Count
                + oversizedDustCards.Count + outsideFogCards.Count
                + tallFogCards.Count + oversizedDamElements.Count;
            if (defectCount != 0)
                throw new InvalidOperationException(
                    "Global-map visual defect audit found " + defectCount
                    + " blocking issue(s). See " + output);
        }

        private static bool RendererInsideLandmass(Renderer renderer)
        {
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            return filter != null && filter.sharedMesh != null
                ? MeshInsideLandmass(filter)
                : BoundsInsideLandmass(renderer.bounds);
        }

        private static bool DamElementTooTall(Renderer renderer)
        {
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            if (filter != null && filter.sharedMesh != null
                    && renderer.name.IndexOf("_Section_",
                        StringComparison.Ordinal) >= 0)
            {
                Vector3[] vertices = filter.sharedMesh.vertices;
                float maximumExtrusion = 0f;
                for (int vertex = 0; vertex + 3 < vertices.Length; vertex += 4)
                {
                    float upper = Mathf.Max(vertices[vertex + 1].y,
                        vertices[vertex + 2].y);
                    float terrainCrown = Mathf.Max(vertices[vertex].y,
                        vertices[vertex + 3].y);
                    maximumExtrusion = Mathf.Max(maximumExtrusion,
                        upper - terrainCrown);
                }
                // Terrain elevation can vary greatly along a curved dam, so
                // audit the authored wall extrusion rather than the renderer's
                // aggregate world-space height.
                return maximumExtrusion > 0.34f;
            }
            return renderer.bounds.size.y > 0.38f;
        }

        private static bool BoundsInsideLandmass(Bounds bounds)
        {
            Vector3 min = bounds.min;
            Vector3 max = bounds.max;
            Vector3[] samples =
            {
                bounds.center,
                new Vector3(min.x, bounds.center.y, min.z),
                new Vector3(min.x, bounds.center.y, max.z),
                new Vector3(max.x, bounds.center.y, min.z),
                new Vector3(max.x, bounds.center.y, max.z)
            };
            for (int i = 0; i < samples.Length; i++)
            {
                Vector2 map = WorldToMap(samples[i]);
                if (!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        map.x, map.y, 0.015f))
                    return false;
            }
            return true;
        }

        private static bool MeshInsideLandmass(MeshFilter filter)
        {
            Vector3[] vertices = filter.sharedMesh.vertices;
            for (int i = 0; i < vertices.Length; i++)
            {
                Vector2 map = WorldToMap(filter.transform.TransformPoint(vertices[i]));
                if (!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        map.x, map.y, 0.005f))
                    return false;
            }
            return true;
        }

        private static bool IsAuthoredMacroTerrainMesh(string meshPath)
        {
            return meshPath.StartsWith(
                "Assets/Art/Kromka/Meshes/Kromka_QuarryBench_",
                StringComparison.Ordinal);
        }

        private static bool IsUnityPrimitive(Mesh mesh, string meshPath)
        {
            if (!string.IsNullOrEmpty(meshPath)
                    && meshPath.IndexOf("unity default resources",
                        StringComparison.OrdinalIgnoreCase) < 0)
                return false;
            string meshName = mesh.name ?? string.Empty;
            return meshName == "Cube" || meshName == "Sphere"
                || meshName == "Cylinder" || meshName == "Capsule"
                || meshName == "Quad" || meshName == "Plane";
        }

        private static bool HasAuthoredTexture(Material material)
        {
            string[] properties =
            {
                "_BaseMap", "_MainTex", "_BaseColorMap", "_AlbedoMap"
            };
            for (int i = 0; i < properties.Length; i++)
                if (material.HasProperty(properties[i])
                        && material.GetTexture(properties[i]) != null)
                    return true;
            return false;
        }

        private static Vector2 WorldToMap(Vector3 world)
        {
            return new Vector2(world.x / WorldScale + MapCentre.x,
                MapCentre.y - world.z / WorldScale);
        }

        private static string Describe(Renderer renderer)
        {
            Bounds bounds = renderer.bounds;
            MeshFilter filter = renderer.GetComponent<MeshFilter>();
            Mesh mesh = filter != null ? filter.sharedMesh : null;
            string meshPath = mesh != null
                ? AssetDatabase.GetAssetPath(mesh).Replace('\\', '/') : "<none>";
            Vector2 map = WorldToMap(bounds.center);
            return HierarchyPath(renderer.transform) + " | map="
                + map.x.ToString("0.0") + "," + map.y.ToString("0.0")
                + " | size=" + bounds.size.x.ToString("0.00") + ","
                + bounds.size.y.ToString("0.00") + ","
                + bounds.size.z.ToString("0.00") + " | mesh=" + meshPath;
        }

        private static string HierarchyPath(Transform transform)
        {
            var names = new List<string>();
            Transform current = transform;
            while (current != null)
            {
                names.Add(current.name);
                current = current.parent;
            }
            names.Reverse();
            return string.Join("/", names);
        }

        private static void Append(List<string> lines, string title,
                                   List<string> entries)
        {
            lines.Add("[" + title + "]");
            lines.AddRange(entries.Distinct().OrderBy(entry => entry));
            lines.Add(string.Empty);
        }
    }
}
#endif
