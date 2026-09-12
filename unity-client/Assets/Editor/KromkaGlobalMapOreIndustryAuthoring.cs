#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 06/20. Three compact Ore Arc works now use
    /// a textured CC0 industrial warehouse family. This replaces the bright,
    /// toy-scaled Factory Kit conveyors, hoppers and cranes that looked like
    /// board-game pieces when the strategic camera approached the terrain.
    /// </summary>
    internal static class KromkaGlobalMapOreIndustryAuthoring
    {
        internal const int ModelIteration = 6;
        internal const int ModelIterationCount = 20;
        private const int ExpectedClusterCount = 3;
        private const int ExpectedIndustrialCount = 6;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string AssetRoot =
            "Assets/ThirdParty/SovietCC0/IndustrialWarehouse/";
        private const string WarehouseModelPath = AssetRoot
            + "IndustrialWarehouse.obj";
        private const string WarehouseTexturePath = AssetRoot
            + "Material.013.png";
        private const string WarehouseMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OreArc_IndustrialWarehouse_CC0.mat";

        private readonly struct IndustrialPlacement
        {
            public readonly string Name;
            public readonly string Cluster;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public IndustrialPlacement(string name, string cluster,
                                       float mapX, float mapY,
                                       float footprint, float maximumHeight,
                                       float yaw, float embed = 0.018f)
            {
                Name = name;
                Cluster = cluster;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly IndustrialPlacement[] Placements =
        {
            new IndustrialPlacement("WesternFoundry_MainHall", "WesternFoundry",
                54f, 224f, 0.94f, 0.34f, 22f),
            new IndustrialPlacement("WesternFoundry_ServiceHall", "WesternFoundry",
                70f, 237f, 0.70f, 0.28f, -18f),
            new IndustrialPlacement("PitWorks_CrusherHall", "PitWorks",
                83f, 204f, 0.86f, 0.32f, 14f),
            new IndustrialPlacement("PitWorks_RepairHall", "PitWorks",
                103f, 218f, 0.68f, 0.27f, -34f),
            new IndustrialPlacement("OreExchange_LoadingHall", "OreExchange",
                119f, 232f, 0.80f, 0.30f, 31f),
            new IndustrialPlacement("OreExchange_TallyHall", "OreExchange",
                139f, 218f, 0.66f, 0.25f, -9f)
        };

        internal static void Compose(Transform parent)
        {
            ConfigureAssets();
            Material material = BuildMaterial();
            Transform root = Child(parent,
                "OreArc_SovietIndustrialBelt_CC0");
            Transform buildings = Child(root,
                "WeatheredIndustrialBuildings_EDITABLE");

            for (int i = 0; i < Placements.Length; i++)
            {
                IndustrialPlacement placement = Placements[i];
                if (!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.08f))
                    throw new InvalidOperationException(placement.Name
                        + " is too close to the global-map shoreline");
                Transform cluster = buildings.Find(placement.Cluster)
                    ?? Child(buildings, placement.Cluster);
                InstantiateAndFitModel(placement, cluster, material);
            }

            Child(parent, "OreIndustryClusters_3_REFERENCE");
            Child(parent, "CC0IndustrialWarehouses_6_REFERENCE");
            Child(parent, "Warehouse02_CC0_REFERENCE");
            Child(parent, "NoKenneyIndustrialModels_REFERENCE");
            Child(parent, "NoToyFactoryKit_REFERENCE");
            Child(parent, "StaticIndustrialGeometry_REFERENCE");
            Child(parent, "ModelIteration_06_of_20");
        }

        internal static void ValidateIteration06()
        {
            GameObject rootObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 06 root is missing from the global map.");
            Transform root = rootObject.transform;
            string[] references =
            {
                "OreIndustryClusters_3_REFERENCE",
                "CC0IndustrialWarehouses_6_REFERENCE",
                "Warehouse02_CC0_REFERENCE",
                "NoKenneyIndustrialModels_REFERENCE",
                "NoToyFactoryKit_REFERENCE",
                "StaticIndustrialGeometry_REFERENCE",
                "ModelIteration_06_of_20"
            };
            for (int i = 0; i < references.Length; i++)
                Require(root.Find(references[i]) != null,
                    references[i] + " is missing");

            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                WarehouseTexturePath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(
                WarehouseMaterialPath);
            Require(texture != null && texture.width >= 2048
                    && texture.height >= 2048,
                "the CC0 warehouse texture is missing or under-resolved");
            Require(material != null && material.shader != null
                    && material.shader.isSupported
                    && material.GetTexture("_BaseMap") == texture,
                "the Ore Arc warehouse material is unavailable or untextured");

            Transform beltRoot = FindDescendant(root,
                "OreArc_SovietIndustrialBelt_CC0");
            Transform buildings = FindDescendant(beltRoot,
                "WeatheredIndustrialBuildings_EDITABLE");
            Require(buildings != null
                    && buildings.childCount == ExpectedClusterCount,
                "three compact industrial clusters are required");
            Require(Placements.Length == ExpectedIndustrialCount,
                "iteration 06 must contain six reviewed industrial buildings");

            for (int i = 0; i < Placements.Length; i++)
            {
                IndustrialPlacement placement = Placements[i];
                Require(placement.MapX >= 40f && placement.MapX <= 150f
                        && placement.MapY >= 185f && placement.MapY <= 250f,
                    placement.Name + " is outside the Ore Arc interior");
                Transform instance = FindDescendant(buildings, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string sourcePath = PrefabUtility
                    .GetPrefabAssetPathOfNearestInstanceRoot(instance.gameObject)
                    .Replace('\\', '/');
                Require(sourcePath == WarehouseModelPath,
                    placement.Name + " lost its CC0 warehouse model link");
                Renderer[] renderers = instance
                    .GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled)
                    .ToArray();
                Require(renderers.Length > 0,
                    placement.Name + " has no visible renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials.Length > 0
                        && renderer.sharedMaterials.All(shared => shared == material)),
                    placement.Name + " lost its reviewed warehouse material");
                ValidateFittedInstance(instance, renderers, placement);
            }

            MeshFilter[] filters = beltRoot
                .GetComponentsInChildren<MeshFilter>(true);
            Require(filters.Length >= ExpectedIndustrialCount
                    && filters.All(filter => filter.sharedMesh != null
                        && AssetDatabase.GetAssetPath(filter.sharedMesh)
                            .Replace('\\', '/')
                            .StartsWith(AssetRoot, StringComparison.Ordinal)),
                "the industrial belt contains a primitive or non-reviewed mesh");
            Require(beltRoot.GetComponentsInChildren<Animator>(true).Length == 0,
                "the industrial belt contains a runtime animator");

            Debug.Log("[KROMKA MODELS 30%] PASS: three Ore Arc works use six "
                + "textured CC0 industrial halls; all toy Factory Kit models "
                + "are absent and every building is static, grounded and "
                + "persistent at every strategic-map distance.");
        }

        private static void InstantiateAndFitModel(
            IndustrialPlacement placement, Transform parent, Material material)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                WarehouseModelPath);
            if (prefab == null)
                throw new InvalidOperationException(
                    "Missing reviewed CC0 industrial model: "
                    + WarehouseModelPath);
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab)
                as GameObject;
            if (instance == null)
                throw new InvalidOperationException(
                    "Cannot instantiate " + placement.Name);
            instance.name = placement.Name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = MapToWorld(
                placement.MapX, placement.MapY);
            instance.transform.localRotation = Quaternion.Euler(
                0f, placement.Yaw, 0f);

            Animator[] animators = instance.GetComponentsInChildren<Animator>(true);
            for (int i = 0; i < animators.Length; i++)
                UnityEngine.Object.DestroyImmediate(animators[i]);
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++)
                colliders[i].enabled = false;
            LODGroup[] lodGroups = instance.GetComponentsInChildren<LODGroup>(true);
            for (int i = 0; i < lodGroups.Length; i++)
                UnityEngine.Object.DestroyImmediate(lodGroups[i]);

            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (renderers.Length == 0)
                throw new InvalidOperationException(
                    placement.Name + " has no renderer");
            Bounds bounds = Encapsulate(renderers);
            float sourceFootprint = Mathf.Max(0.001f,
                Mathf.Max(bounds.size.x, bounds.size.z));
            instance.transform.localScale *= placement.Footprint
                / sourceFootprint;
            bounds = Encapsulate(instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray());
            float targetHeight = placement.MaximumHeight * 0.82f;
            if (bounds.size.y < targetHeight)
            {
                Vector3 scale = instance.transform.localScale;
                scale.y *= targetHeight / Mathf.Max(0.001f, bounds.size.y);
                instance.transform.localScale = scale;
                bounds = Encapsulate(instance
                    .GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled)
                    .ToArray());
            }
            if (bounds.size.y > placement.MaximumHeight)
            {
                Vector3 scale = instance.transform.localScale;
                scale.y *= placement.MaximumHeight / bounds.size.y;
                instance.transform.localScale = scale;
                bounds = Encapsulate(instance
                    .GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled)
                    .ToArray());
            }
            Vector3 target = MapToWorld(placement.MapX, placement.MapY);
            instance.transform.position += new Vector3(
                target.x - bounds.center.x,
                target.y - placement.Embed - bounds.min.y,
                target.z - bounds.center.z);

            renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                int slotCount = Mathf.Max(1, renderer.sharedMaterials.Length);
                renderer.sharedMaterials = Enumerable.Repeat(material, slotCount)
                    .ToArray();
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
                renderer.motionVectorGenerationMode =
                    MotionVectorGenerationMode.ForceNoMotion;
            }
            MarkStatic(instance);
            EditorUtility.SetDirty(instance);
        }

        private static void ValidateFittedInstance(Transform instance,
                                                   Renderer[] renderers,
                                                   IndustrialPlacement placement)
        {
            Bounds bounds = Encapsulate(renderers);
            Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                    - placement.Footprint) <= 0.035f,
                placement.Name + " footprint drifted from authored scale");
            Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                placement.Name + " is too tall for the strategic-map scale");
            float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                placement.MapX, placement.MapY);
            Require(Mathf.Abs(bounds.min.y
                    - (terrainHeight - placement.Embed)) <= 0.035f,
                placement.Name + " is floating above the Ore Arc relief");
            Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                placement.Name + " can disappear with camera distance");
            Require(instance.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                placement.Name + " can obstruct strategic-map interaction");
        }

        private static void ConfigureAssets()
        {
            ModelImporter importer = AssetImporter.GetAtPath(WarehouseModelPath)
                as ModelImporter;
            if (importer == null)
                throw new InvalidOperationException(
                    "Missing CC0 warehouse importer: " + WarehouseModelPath);
            bool changed = importer.importAnimation || importer.importCameras
                || importer.importLights || importer.importBlendShapes
                || importer.materialImportMode
                    != ModelImporterMaterialImportMode.None;
            importer.importAnimation = false;
            importer.importCameras = false;
            importer.importLights = false;
            importer.importBlendShapes = false;
            importer.materialImportMode = ModelImporterMaterialImportMode.None;
            if (changed) importer.SaveAndReimport();

            TextureImporter textureImporter = AssetImporter.GetAtPath(
                WarehouseTexturePath) as TextureImporter;
            if (textureImporter == null)
                throw new InvalidOperationException(
                    "Missing CC0 warehouse texture importer");
            bool textureChanged = !textureImporter.sRGBTexture
                || !textureImporter.mipmapEnabled
                || textureImporter.textureCompression
                    != TextureImporterCompression.CompressedHQ
                || textureImporter.filterMode != FilterMode.Bilinear
                || textureImporter.wrapMode != TextureWrapMode.Repeat;
            textureImporter.sRGBTexture = true;
            textureImporter.mipmapEnabled = true;
            textureImporter.textureCompression =
                TextureImporterCompression.CompressedHQ;
            textureImporter.filterMode = FilterMode.Bilinear;
            textureImporter.wrapMode = TextureWrapMode.Repeat;
            if (textureChanged) textureImporter.SaveAndReimport();
        }

        private static Material BuildMaterial()
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                WarehouseTexturePath);
            if (texture == null)
                throw new InvalidOperationException(
                    "Missing CC0 warehouse texture: " + WarehouseTexturePath);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable.");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(
                WarehouseMaterialPath);
            if (material == null)
            {
                material = new Material(shader)
                {
                    name = "Kromka_OreArc_IndustrialWarehouse_CC0"
                };
                AssetDatabase.CreateAsset(material, WarehouseMaterialPath);
            }
            else material.shader = shader;
            material.SetTexture("_BaseMap", texture);
            material.SetColor("_BaseColor",
                new Color(0.43f, 0.39f, 0.33f, 1f));
            material.SetFloat("_Metallic", 0.08f);
            material.SetFloat("_Smoothness", 0.13f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
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
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null) return null;
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
        }

        private static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(
                    transforms[i].gameObject, flags);
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
                throw new InvalidOperationException(
                    "Kromka model iteration 06 validation failed: " + message);
        }
    }
}
#endif
