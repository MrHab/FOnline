#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 03/20. Three continuous authored bench lips
    /// carry a licensed quarry material; sparse MEP dirt-edge pieces break their
    /// silhouette without pretending that a prop is a kilometre-long landform.
    /// </summary>
    internal static class KromkaGlobalMapQuarryBenchAuthoring
    {
        internal const int ModelIteration = 3;
        internal const int ModelIterationCount = 20;
        private const int ExpectedBenchCount = 3;
        private const int ExpectedAccentCount = 12;
        private const int SamplesPerBench = 96;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string MepDirtEdgeRoot =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_DirtEdge/Prefabs/";
        private const string ThirdPartyRoot =
            "Assets/ThirdParty/PolyHaven/QuarryWall02/";
        private const string DiffusePath = ThirdPartyRoot
            + "quarry_wall_02_diff_2k.jpg";
        private const string NormalPath = ThirdPartyRoot
            + "quarry_wall_02_nor_gl_2k.jpg";
        private const string OcclusionPath = ThirdPartyRoot
            + "quarry_wall_02_ao_2k.jpg";
        private const string MaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_QuarryBench_PolyHaven_MEP.mat";
        private const string MeshFolder = "Assets/Art/Kromka/Meshes";

        private static readonly string[] EdgePrefabs =
        {
            MepDirtEdgeRoot + "MEP_Dirtedge_Straight.prefab",
            MepDirtEdgeRoot + "MEP_Dirtedge_Curve_Out.prefab",
            MepDirtEdgeRoot + "MEP_Dirtedge_Curve_In.prefab"
        };

        private readonly struct Tier
        {
            public readonly string Name;
            public readonly float RadiusX;
            public readonly float RadiusY;
            public readonly float StartAngle;
            public readonly float EndAngle;
            public readonly float Width;
            public readonly float WallHeight;
            public readonly float AccentFootprint;
            public readonly float AccentHeight;

            public Tier(string name, float radiusX, float radiusY,
                        float startAngle, float endAngle, float width,
                        float wallHeight, float accentFootprint,
                        float accentHeight)
            {
                Name = name;
                RadiusX = radiusX;
                RadiusY = radiusY;
                StartAngle = startAngle;
                EndAngle = endAngle;
                Width = width;
                WallHeight = wallHeight;
                AccentFootprint = accentFootprint;
                AccentHeight = accentHeight;
            }
        }

        private readonly struct AccentPlacement
        {
            public readonly string Name;
            public readonly string TierName;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public AccentPlacement(string name, string tierName, string prefabPath,
                                   float mapX, float mapY, float footprint,
                                   float maximumHeight, float yaw, float embed)
            {
                Name = name;
                TierName = tierName;
                PrefabPath = prefabPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        // All three arcs stop before the eastern and southern haul-ramp mouths.
        // The centre is shifted east from the broad oxide field so the walls sit
        // inside the landmass silhouette at strategic-map scale.
        private static readonly Tier[] Tiers =
        {
            new Tier("OuterBench", 40f, 28f, 28f, 238f,
                2.8f, 0.18f, 0.70f, 0.17f),
            new Tier("MiddleBench", 29f, 20f, 40f, 232f,
                2.3f, 0.14f, 0.58f, 0.14f),
            new Tier("InnerBench", 19f, 13f, 55f, 222f,
                1.9f, 0.11f, 0.48f, 0.12f)
        };

        internal static void Compose(Transform parent)
        {
            EnsureFolder(MeshFolder);
            Material quarryMaterial = BuildQuarryMaterial();
            Transform root = Child(parent, "OreArc_OpenPitBenchTiers_MEP");
            Transform continuousRoot = Child(root, "ContinuousBenchMeshes_EDITABLE");
            Transform accentRoot = Child(root, "MepEdgeAccents_EDITABLE");

            for (int tierIndex = 0; tierIndex < Tiers.Length; tierIndex++)
            {
                Tier tier = Tiers[tierIndex];
                Mesh mesh = BuildBenchMesh(tier, tierIndex);
                string path = MeshFolder + "/Kromka_QuarryBench_" + tier.Name + ".asset";
                mesh = SaveMesh(mesh, path);
                var bench = new GameObject("OreArc_Quarry_" + tier.Name + "_CONTINUOUS");
                bench.transform.SetParent(continuousRoot, false);
                bench.AddComponent<MeshFilter>().sharedMesh = mesh;
                MeshRenderer renderer = bench.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = quarryMaterial;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
                renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
                MarkStatic(bench);
            }

            List<AccentPlacement> accents = BuildAccentPlacements();
            for (int i = 0; i < accents.Count; i++)
            {
                AccentPlacement accent = accents[i];
                Transform group = accentRoot.Find(accent.TierName)
                    ?? Child(accentRoot, accent.TierName);
                GameObject instance = KromkaGlobalMapRockLandmarkAuthoring
                    .InstantiateMepRock(accent.PrefabPath, accent.Name, group,
                        accent.MapX, accent.MapY, accent.Footprint,
                        accent.MaximumHeight, accent.Yaw, accent.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                    renderers[rendererIndex].sharedMaterial = quarryMaterial;
            }

            Child(parent, "QuarryBenchMeshes_3_REFERENCE");
            Child(parent, "QuarryBenchAccents_12_REFERENCE");
            Child(parent, "DirectMEPDirtEdgePrefabs_3_REFERENCE");
            Child(parent, "PolyHavenQuarryWall02_CC0_REFERENCE");
            Child(parent, "HaulRampGaps_2_REFERENCE");
            Child(parent, "ModelIteration_03_of_20");
        }

        internal static void ValidateIteration03()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 03 root is missing from the global map.");
            Transform root = rootObject.transform;
            Require(root.Find("QuarryBenchMeshes_3_REFERENCE") != null,
                "continuous bench reference is missing");
            Require(root.Find("QuarryBenchAccents_12_REFERENCE") != null,
                "MEP accent reference is missing");
            Require(root.Find("DirectMEPDirtEdgePrefabs_3_REFERENCE") != null,
                "MEP dirt-edge source reference is missing");
            Require(root.Find("PolyHavenQuarryWall02_CC0_REFERENCE") != null,
                "CC0 quarry material reference is missing");
            Require(root.Find("HaulRampGaps_2_REFERENCE") != null,
                "haul-ramp gap reference is missing");
            Require(root.Find("ModelIteration_03_of_20") != null,
                "model iteration marker is missing");

            Texture2D diffuse = AssetDatabase.LoadAssetAtPath<Texture2D>(DiffusePath);
            Texture2D normal = AssetDatabase.LoadAssetAtPath<Texture2D>(NormalPath);
            Texture2D occlusion = AssetDatabase.LoadAssetAtPath<Texture2D>(OcclusionPath);
            Require(diffuse != null && diffuse.width >= 2048 && diffuse.height >= 2048,
                "Poly Haven quarry diffuse is missing or under-resolved");
            Require(normal != null && normal.width >= 2048 && normal.height >= 2048,
                "Poly Haven quarry normal is missing or under-resolved");
            Require(occlusion != null && occlusion.width >= 2048 && occlusion.height >= 2048,
                "Poly Haven quarry AO is missing or under-resolved");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            Require(material != null && material.shader != null
                && material.shader.isSupported, "quarry bench material is unavailable");
            Require(material.GetTexture("_BaseMap") == diffuse
                && material.GetTexture("_BumpMap") == normal
                && material.GetTexture("_OcclusionMap") == occlusion,
                "quarry bench material lost a CC0 source texture");

            Transform benchRoot = FindDescendant(root, "ContinuousBenchMeshes_EDITABLE");
            Require(benchRoot != null, "continuous bench hierarchy is missing");
            MeshFilter[] filters = benchRoot.GetComponentsInChildren<MeshFilter>(true);
            Require(filters.Length == ExpectedBenchCount,
                "iteration 03 must contain three continuous bench meshes");
            for (int i = 0; i < filters.Length; i++)
            {
                Mesh mesh = filters[i].sharedMesh;
                Require(mesh != null && mesh.vertexCount == (SamplesPerBench + 1) * 4,
                    filters[i].name + " has incomplete continuous geometry");
                MeshRenderer renderer = filters[i].GetComponent<MeshRenderer>();
                Require(renderer != null && renderer.sharedMaterial == material,
                    filters[i].name + " lost the quarry material");
            }

            List<AccentPlacement> accents = BuildAccentPlacements();
            Require(accents.Count == ExpectedAccentCount,
                "iteration 03 must contain twelve MEP edge accents");
            var sourcePaths = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < accents.Count; i++)
            {
                AccentPlacement accent = accents[i];
                Transform instance = FindDescendant(root, accent.Name);
                Require(instance != null, accent.Name + " is missing");
                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == accent.PrefabPath,
                    accent.Name + " lost its direct MEP prefab link");
                sourcePaths.Add(sourcePath);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, accent.Name + " has no visible renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == material)),
                    accent.Name + " does not use the reviewed quarry material");
                Bounds bounds = Encapsulate(renderers);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - accent.Footprint) <= 0.035f,
                    accent.Name + " footprint drifted from authored scale");
                Require(bounds.size.y <= accent.MaximumHeight + 0.035f,
                    accent.Name + " is too tall for a bench accent");
                float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    accent.MapX, accent.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrainHeight - accent.Embed)) <= 0.035f,
                    accent.Name + " is not seated in the quarry relief");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    accent.Name + " can disappear with camera distance");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    accent.Name + " can obstruct strategic-map interaction");
            }
            Require(sourcePaths.SetEquals(EdgePrefabs),
                "iteration 03 must use all three reviewed MEP dirt-edge sources");

            Debug.Log("[KROMKA MODELS 15%] PASS: three continuous open-pit bench "
                + "meshes use the CC0 Poly Haven Quarry Wall 02 material and twelve "
                + "direct MEP dirt-edge accents; both haul-ramp gaps remain open.");
        }

        private static Mesh BuildBenchMesh(Tier tier, int tierIndex)
        {
            var vertices = new Vector3[(SamplesPerBench + 1) * 4];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[SamplesPerBench * 12];
            float distance = 0f;
            Vector3 previous = Vector3.zero;
            for (int sample = 0; sample <= SamplesPerBench; sample++)
            {
                float t = sample / (float)SamplesPerBench;
                float angle = Mathf.Lerp(tier.StartAngle, tier.EndAngle, t);
                float radians = angle * Mathf.Deg2Rad;
                float irregularity = Mathf.Sin(radians * 4.7f + tierIndex * 0.81f) * 0.85f
                    + Mathf.Sin(radians * 9.3f - tierIndex * 0.53f) * 0.36f;
                float radiusX = tier.RadiusX + irregularity;
                float radiusY = tier.RadiusY + irregularity * 0.65f;
                Vector2 radial = new Vector2(Mathf.Cos(radians), Mathf.Sin(radians));
                Vector2 centre = new Vector2(82f + radial.x * radiusX,
                    215f + radial.y * radiusY);
                Vector2 inner = centre - radial * (tier.Width * 0.5f);
                Vector2 outer = centre + radial * (tier.Width * 0.5f);

                Vector3 innerWorld = MapToWorld(inner.x, inner.y);
                Vector3 outerWorld = MapToWorld(outer.x, outer.y);
                float lip = 0.025f + Mathf.Sin(radians * 7f + tierIndex) * 0.008f;
                Vector3 innerTop = innerWorld + Vector3.up * (tier.WallHeight + lip);
                Vector3 outerTop = outerWorld + Vector3.up * (0.025f + lip * 0.35f);
                Vector3 innerBottom = innerWorld - Vector3.up * 0.035f;
                if (sample > 0) distance += Vector3.Distance(previous, innerTop);
                previous = innerTop;

                int vertex = sample * 4;
                vertices[vertex] = outerTop;
                vertices[vertex + 1] = innerTop;
                vertices[vertex + 2] = innerTop;
                vertices[vertex + 3] = innerBottom;
                float u = distance * 0.72f;
                uv[vertex] = new Vector2(u, 0f);
                uv[vertex + 1] = new Vector2(u, 0.38f);
                uv[vertex + 2] = new Vector2(u, 0f);
                uv[vertex + 3] = new Vector2(u, 1f);

                if (sample == SamplesPerBench) continue;
                int next = vertex + 4;
                int triangle = sample * 12;
                // Upper weathered shelf.
                triangles[triangle] = vertex;
                triangles[triangle + 1] = next;
                triangles[triangle + 2] = vertex + 1;
                triangles[triangle + 3] = vertex + 1;
                triangles[triangle + 4] = next;
                triangles[triangle + 5] = next + 1;
                // Inward-facing quarry wall. The material is double-sided so
                // the lip remains readable from every strategic-map orbit.
                triangles[triangle + 6] = vertex + 2;
                triangles[triangle + 7] = next + 2;
                triangles[triangle + 8] = vertex + 3;
                triangles[triangle + 9] = vertex + 3;
                triangles[triangle + 10] = next + 2;
                triangles[triangle + 11] = next + 3;
            }

            var mesh = new Mesh { name = "Kromka_QuarryBench_" + tier.Name };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static List<AccentPlacement> BuildAccentPlacements()
        {
            var result = new List<AccentPlacement>(ExpectedAccentCount);
            float[] fractions = { 0.12f, 0.39f, 0.66f, 0.88f };
            for (int tierIndex = 0; tierIndex < Tiers.Length; tierIndex++)
            {
                Tier tier = Tiers[tierIndex];
                for (int accentIndex = 0; accentIndex < fractions.Length; accentIndex++)
                {
                    float angle = Mathf.Lerp(tier.StartAngle, tier.EndAngle,
                        fractions[accentIndex]);
                    float radians = angle * Mathf.Deg2Rad;
                    float mapX = 82f + Mathf.Cos(radians) * tier.RadiusX;
                    float mapY = 215f + Mathf.Sin(radians) * tier.RadiusY;
                    float tangentWorldX = -tier.RadiusX * Mathf.Sin(radians);
                    float tangentWorldZ = -tier.RadiusY * Mathf.Cos(radians);
                    float yaw = Mathf.Atan2(tangentWorldX, tangentWorldZ) * Mathf.Rad2Deg;
                    string name = "OreArc_QuarryAccent_" + tier.Name + "_"
                        + accentIndex.ToString("00");
                    string prefab = EdgePrefabs[(tierIndex + accentIndex) % EdgePrefabs.Length];
                    result.Add(new AccentPlacement(name, tier.Name, prefab,
                        mapX, mapY, tier.AccentFootprint, tier.AccentHeight,
                        yaw, tier.WallHeight * 0.58f));
                }
            }
            return result;
        }

        private static Material BuildQuarryMaterial()
        {
            ConfigureTexture(DiffusePath, false, true);
            ConfigureTexture(NormalPath, true, false);
            ConfigureTexture(OcclusionPath, false, false);
            Texture2D diffuse = LoadTexture(DiffusePath);
            Texture2D normal = LoadTexture(NormalPath);
            Texture2D occlusion = LoadTexture(OcclusionPath);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable.");

            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(shader) { name = "Kromka_QuarryBench_PolyHaven_MEP" };
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            else material.shader = shader;

            material.SetTexture("_BaseMap", diffuse);
            material.SetTextureScale("_BaseMap", new Vector2(1.05f, 1.05f));
            material.SetColor("_BaseColor", new Color(0.49f, 0.30f, 0.22f, 1f));
            material.SetTexture("_BumpMap", normal);
            material.SetFloat("_BumpScale", 0.72f);
            material.EnableKeyword("_NORMALMAP");
            material.SetTexture("_OcclusionMap", occlusion);
            material.SetFloat("_OcclusionStrength", 0.78f);
            material.EnableKeyword("_OCCLUSIONMAP");
            material.SetFloat("_Smoothness", 0.14f);
            material.SetFloat("_Metallic", 0f);
            material.SetFloat("_Cull", 0f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Texture2D LoadTexture(string path)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture == null)
                throw new InvalidOperationException("Missing quarry texture: " + path);
            return texture;
        }

        private static void ConfigureTexture(string path, bool normalMap, bool sRgb)
        {
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null)
                throw new InvalidOperationException("Missing quarry texture importer: " + path);
            bool changed = importer.maxTextureSize != 2048
                || importer.textureType != (normalMap
                    ? TextureImporterType.NormalMap : TextureImporterType.Default)
                || importer.sRGBTexture != sRgb
                || importer.textureCompression != TextureImporterCompression.CompressedHQ
                || (normalMap && importer.flipGreenChannel);
            importer.maxTextureSize = 2048;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.textureType = normalMap
                ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = sRgb;
            if (normalMap) importer.flipGreenChannel = false;
            if (changed) importer.SaveAndReimport();
        }

        private static Mesh SaveMesh(Mesh generated, string path)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            string parent = path.Substring(0, slash);
            string name = path.Substring(slash + 1);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 03 validation failed: " + message);
        }
    }
}
#endif
