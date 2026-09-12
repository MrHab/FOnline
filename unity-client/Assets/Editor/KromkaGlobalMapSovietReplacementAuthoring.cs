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
    /// Replaces the visually incompatible primitive/Kenney passes with a small,
    /// deliberately spaced collection of textured Soviet and post-Soviet CC0
    /// landmarks. Every instance is fitted to strategic-map scale, seated on
    /// the relief and kept well inside the irregular shoreline.
    /// </summary>
    internal static class KromkaGlobalMapSovietReplacementAuthoring
    {
        private const string AssetRoot = "Assets/ThirdParty/SovietCC0/";
        private const string PanelModel = AssetRoot
            + "SovietPanelHouse/spah9lvl.FBX";
        private const string PanelTexture = AssetRoot
            + "SovietPanelHouse/spah9lvl.png";
        private const string ResidentialModel = AssetRoot
            + "ResidentialBlock/my_panel16_14.obj";
        private const string GarageModel = AssetRoot
            + "SovietGarage/SMGarage.FBX";
        private const string GarageTexture = AssetRoot
            + "SovietGarage/SMGarage.tga";
        private const string GarageNormal = AssetRoot
            + "SovietGarage/SMGarage_N.tga";
        private const string SubstationModel = AssetRoot
            + "ElectricalSubstation/ElectricSubstation.FBX";
        private const string FenceModel = AssetRoot
            + "PostSovietFence/zaborec.obj";

        // Ordered like the first usemtl occurrence in the source OBJ. The
        // source material name is preferred at runtime; this order is a safe
        // fallback if an importer omits embedded material names.
        private static readonly string[] ResidentialTextures =
        {
            AssetRoot + "ResidentialBlock/metall.png",
            AssetRoot + "ResidentialBlock/whiteplitka.png",
            AssetRoot + "ResidentialBlock/dombokwall.png",
            AssetRoot + "ResidentialBlock/krisha.png",
            AssetRoot + "ResidentialBlock/podezdwall.png",
            AssetRoot + "ResidentialBlock/my16wins4.png",
            AssetRoot + "ResidentialBlock/b_metall.png",
            AssetRoot + "ResidentialBlock/blackplitka.png",
            AssetRoot + "ResidentialBlock/my16wins2.png",
            AssetRoot + "ResidentialBlock/door_damofon.png",
            AssetRoot + "ResidentialBlock/mysorndoor.png",
            AssetRoot + "ResidentialBlock/my16wins3.png",
            AssetRoot + "ResidentialBlock/balkons2.png",
            AssetRoot + "ResidentialBlock/my16wins7.png",
            AssetRoot + "ResidentialBlock/my16wins1.png",
            AssetRoot + "ResidentialBlock/balkons1.png",
            AssetRoot + "ResidentialBlock/balkons4.png",
            AssetRoot + "ResidentialBlock/my16wins5.png",
            AssetRoot + "ResidentialBlock/my16wins6.png",
            AssetRoot + "ResidentialBlock/balkons3.png"
        };

        private static readonly string[] SubstationTextures =
        {
            AssetRoot + "ElectricalSubstation/Electr1wall.png",
            AssetRoot + "ElectricalSubstation/Electr1door.png",
            AssetRoot + "ElectricalSubstation/Electr1vent.png",
            AssetRoot + "ElectricalSubstation/Electr1concrete.png",
            AssetRoot + "ElectricalSubstation/Electr1roof.png"
        };

        private static readonly string[] FenceTextures =
        {
            AssetRoot + "PostSovietFence/black.png",
            AssetRoot + "PostSovietFence/reshet.png",
            AssetRoot + "PostSovietFence/medicsubsta_zaborclear.png"
        };

        private const string MaterialRoot = "Assets/Art/Kromka/Materials/";
        private const string PanelMaterialPath = MaterialRoot
            + "Kromka_SovietPanelHouse_CC0.mat";
        private const string ResidentialMaterialPath = MaterialRoot
            + "Kromka_ResidentialBlock_CC0.mat";
        private const string GarageMaterialPath = MaterialRoot
            + "Kromka_SovietGarage_CC0.mat";
        private const string SubstationMaterialPath = MaterialRoot
            + "Kromka_ElectricalSubstation_CC0.mat";
        private const string FenceMaterialPath = MaterialRoot
            + "Kromka_PostSovietFence_CC0.mat";

        private enum AssetKind
        {
            Panel,
            Residential,
            Garage,
            Substation,
            Fence
        }

        private readonly struct Placement
        {
            public readonly string Region;
            public readonly string Name;
            public readonly AssetKind Kind;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string region, string name, AssetKind kind,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed = 0.018f)
            {
                // Single-car garages and small transformer shelters are map
                // dressing, not city-scale landmarks. Their source meshes read
                // as grey cubes/canopies beside the apartment blocks at the
                // extended close zoom, so keep them deliberately subordinate.
                float strategicScale = kind == AssetKind.Garage ? 0.58f
                    : kind == AssetKind.Substation ? 0.58f
                    : kind == AssetKind.Fence ? 0.72f : 1f;
                Region = region;
                Name = name;
                Kind = kind;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint * strategicScale;
                MaximumHeight = maximumHeight * strategicScale;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly Placement[] Placements =
        {
            // Keys and the inhabited Middle Vein: recognizable five-storey
            // housing, a lower residential block and the ubiquitous garages.
            new Placement("MiddleVein", "Keys_PanelHouse_West", AssetKind.Panel,
                185f, 196f, 0.82f, 0.92f, 8f),
            new Placement("MiddleVein", "Keys_PanelHouse_East", AssetKind.Panel,
                227f, 208f, 0.78f, 0.88f, -13f),
            new Placement("MiddleVein", "Keys_ResidentialBlock", AssetKind.Residential,
                178f, 223f, 0.86f, 0.76f, -5f),
            new Placement("MiddleVein", "Keys_GarageCooperative", AssetKind.Garage,
                230f, 184f, 0.50f, 0.34f, 24f),
            new Placement("MiddleVein", "Outpost17_ServiceGarage", AssetKind.Garage,
                165f, 224f, 0.44f, 0.31f, 41f),
            new Placement("MiddleVein", "FarRow_UtilityShed", AssetKind.Garage,
                151f, 191f, 0.42f, 0.30f, -12f),

            // The Tract reads as a maintained transport and power corridor.
            new Placement("TractIsthmus", "Tract_WestServiceGarage", AssetKind.Garage,
                116f, 149f, 0.46f, 0.31f, 7f),
            new Placement("TractIsthmus", "Tract_CentreGarage", AssetKind.Garage,
                137f, 157f, 0.46f, 0.31f, -18f),
            new Placement("TractIsthmus", "Tract_Substation", AssetKind.Substation,
                165f, 157f, 0.68f, 0.54f, 11f),
            new Placement("TractIsthmus", "Tract_SubstationFence", AssetKind.Fence,
                165f, 164f, 0.72f, 0.20f, 4f, 0.010f),

            // Glasslands installations are old civil/scientific infrastructure,
            // not brightly coloured spacecraft modules.
            new Placement("Glasslands", "Glasslands_VectorSubstation",
                AssetKind.Substation, 286f, 184f, 0.70f, 0.56f, -19f),
            new Placement("Glasslands", "Glasslands_FieldGarage", AssetKind.Garage,
                272f, 203f, 0.43f, 0.30f, 27f),
            new Placement("Glasslands", "Glasslands_AbandonedBlock", AssetKind.Panel,
                302f, 194f, 0.72f, 0.80f, 13f),
            new Placement("Glasslands", "Glasslands_VectorFence", AssetKind.Fence,
                292f, 179f, 0.70f, 0.20f, -21f, 0.010f),

            // Chalk settlements use low, practical post-Soviet silhouettes.
            new Placement("ChalkLowland", "Chalk_WeatheredBlock", AssetKind.Residential,
                292f, 108f, 0.72f, 0.66f, 9f),
            new Placement("ChalkLowland", "Chalk_KilnGarage_West", AssetKind.Garage,
                283f, 116f, 0.42f, 0.30f, -24f),
            new Placement("ChalkLowland", "Chalk_KilnGarage_East", AssetKind.Garage,
                303f, 116f, 0.42f, 0.30f, 21f),

            // The ravine keeps only grounded utility ruins. The enormous cave
            // arches and floating primitive lattice from the old pass are gone.
            new Placement("ListenersRavine", "Ravine_ListeningSubstation",
                AssetKind.Substation, 298f, 91f, 0.64f, 0.51f, 18f),
            new Placement("ListenersRavine", "Ravine_MaintenanceGarage",
                AssetKind.Garage, 310f, 81f, 0.40f, 0.29f, -31f),

            // Zero Basin retains pre-war mass, but with mundane Soviet shells
            // that contrast with the anomalous terrain instead of sci-fi props.
            new Placement("ZeroBasin", "Zero_WestPanelShell", AssetKind.Panel,
                185f, 100f, 0.74f, 0.82f, -7f),
            new Placement("ZeroBasin", "Zero_ServiceSubstation", AssetKind.Substation,
                235f, 58f, 0.66f, 0.53f, 22f),
            new Placement("ZeroBasin", "Zero_SealedGarage", AssetKind.Garage,
                248f, 61f, 0.42f, 0.30f, -16f),

            // Silent Ring and hostile edges receive sparse, plausible relics.
            new Placement("SilentRing", "SilentRing_AbandonedGarage", AssetKind.Garage,
                78f, 77f, 0.43f, 0.30f, 14f),
            new Placement("SilentRing", "SilentRing_DeadSubstation", AssetKind.Substation,
                96f, 88f, 0.62f, 0.50f, -27f),
            new Placement("SilentRing", "SilentRing_PerimeterFence", AssetKind.Fence,
                87f, 91f, 0.68f, 0.19f, -17f, 0.010f),
            new Placement("HostileEdges", "Storehouse_CraterGarage", AssetKind.Garage,
                307f, 145f, 0.42f, 0.30f, 33f),

            // Sparse roadside anchors replace icon-like crossings and power
            // pylons while preserving readable travel nodes on the map.
            new Placement("Roadside", "Roadside_WestGarage", AssetKind.Garage,
                104f, 159f, 0.40f, 0.28f, 6f),
            new Placement("Roadside", "Roadside_SouthGarage", AssetKind.Garage,
                181f, 115f, 0.40f, 0.28f, -12f),
            new Placement("Roadside", "Roadside_EastGarage", AssetKind.Garage,
                247f, 155f, 0.40f, 0.28f, 19f),
            new Placement("PowerCorridor", "NorthGrid_Substation", AssetKind.Substation,
                180f, 241f, 0.66f, 0.52f, 4f),
            new Placement("PowerCorridor", "NorthGrid_Fence", AssetKind.Fence,
                180f, 247f, 0.68f, 0.19f, 3f, 0.010f)
        };

        internal static void RefreshCrossingClearance(Transform modelRoot)
        {
            foreach (Placement placement in Placements.Where(item =>
                item.Name == "Keys_PanelHouse_West" || item.Name == "Keys_PanelHouse_East"
                || item.Name == "Keys_ResidentialBlock" || item.Name == "Zero_WestPanelShell"
                || item.Name == "Keys_GarageCooperative"))
            {
                Transform instance = modelRoot.GetComponentsInChildren<Transform>(true)
                    .Single(node => node.name == placement.Name);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>()
                    .Where(renderer => renderer.enabled).ToArray();
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                Vector3 target = new Vector3((placement.MapX - 190f) * .1f,
                    KromkaGlobalMapReliefAuthoring.HeightAtMap(placement.MapX, placement.MapY),
                    (150f - placement.MapY) * .1f);
                instance.position += new Vector3(target.x - bounds.center.x,
                    target.y - placement.Embed - bounds.min.y, target.z - bounds.center.z);
            }
        }

        internal static void Compose(Transform parent)
        {
            ConfigureModelImporters();
            Dictionary<AssetKind, Material[]> materials = BuildMaterials();
            Transform root = Child(parent,
                "SovietPostSoviet_CC0_Replacements_EDITABLE");

            for (int i = 0; i < Placements.Length; i++)
            {
                Placement placement = Placements[i];
                if (!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.075f))
                    throw new InvalidOperationException(placement.Name
                        + " is too close to the global-map shoreline");

                Transform region = root.Find(placement.Region)
                    ?? Child(root, placement.Region);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        ModelPath(placement.Kind), placement.Name, region,
                        placement.MapX, placement.MapY, placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed,
                        SourcePitch(placement.Kind));
                ApplyMaterials(instance, placement.Kind,
                    materials[placement.Kind]);
            }

            Child(parent, "SovietCC0Landmarks_31_REFERENCE");
            Child(parent, "SovietCC0SourceFamilies_5_REFERENCE");
            Child(parent, "NoKenneySpaceOrCarModels_REFERENCE");
            Child(parent, "NoUnityPrimitiveLandmarks_REFERENCE");
            Child(parent, "StrategicShorelineClearance_REFERENCE");
        }

        internal static void Validate()
        {
            GameObject modelRoot = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (modelRoot == null)
                throw new InvalidOperationException("Global model root is missing");
            Transform root = FindDescendant(modelRoot.transform,
                "SovietPostSoviet_CC0_Replacements_EDITABLE");
            Require(root != null, "replacement root is missing");
            Require(Placements.Length == 31, "replacement placement count changed");

            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(renderers.Length >= Placements.Length,
                "replacement renderer coverage is incomplete");
            Require(renderers.All(renderer => renderer.sharedMaterials.Length > 0
                && renderer.sharedMaterials.All(material => material != null
                    && HasAuthoredTexture(material))),
                "replacement landmark lost its authored texture");
            Material[] appliedMaterials = renderers
                .SelectMany(renderer => renderer.sharedMaterials)
                .Where(material => material != null).Distinct().ToArray();
            Require(appliedMaterials.All(material => AssetDatabase
                    .GetAssetPath(material).Replace('\\', '/')
                    .StartsWith(MaterialRoot, StringComparison.Ordinal)),
                "replacement landmark still uses an embedded placeholder material");
            int distinctAlbedos = appliedMaterials
                .Select(material => material.GetTexture("_BaseMap"))
                .Where(texture => texture != null).Distinct().Count();
            Require(distinctAlbedos >= 25,
                "multi-material Soviet models lost their wall, roof, door or fence textures");
            Require(root.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "replacement landmark can disappear with camera distance");
            Require(root.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "replacement landmark can obstruct map interaction");

            MeshFilter[] filters = root.GetComponentsInChildren<MeshFilter>(true);
            Require(filters.All(filter =>
            {
                string path = filter.sharedMesh == null ? string.Empty
                    : AssetDatabase.GetAssetPath(filter.sharedMesh).Replace('\\', '/');
                return path.StartsWith(AssetRoot, StringComparison.Ordinal);
            }), "replacement root contains a non-CC0 or primitive mesh");

            for (int i = 0; i < Placements.Length; i++)
            {
                Placement placement = Placements[i];
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                Renderer[] placedRenderers = instance
                    .GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Bounds bounds = Encapsulate(placedRenderers);
                Require(BoundsInsideLandmass(bounds), placement.Name
                    + " crosses the strategic shoreline");
                Require(Mathf.Max(bounds.size.x, bounds.size.z)
                        <= placement.Footprint + 0.04f,
                    placement.Name + " exceeds its strategic footprint");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for the strategic scale");
                if (placement.Kind == AssetKind.Panel
                        || placement.Kind == AssetKind.Residential)
                    Require(bounds.size.y >= placement.MaximumHeight * 0.52f,
                        placement.Name + " is lying flat instead of forming a "
                        + "vertical apartment silhouette; size=" + bounds.size);
                if (placement.Kind == AssetKind.Garage)
                {
                    float actualFootprint = Mathf.Max(bounds.size.x, bounds.size.z);
                    Require(bounds.size.y >= actualFootprint * 0.25f
                            && bounds.size.y <= actualFootprint * 0.58f,
                        placement.Name + " lost its long, low garage silhouette; size="
                        + bounds.size);
                }
                if (placement.Kind == AssetKind.Substation)
                    Require(placedRenderers.SelectMany(renderer =>
                                renderer.sharedMaterials)
                            .All(material => material != null
                                && material.HasProperty("_Cull")
                                && Mathf.Approximately(material.GetFloat("_Cull"),
                                    (float)CullMode.Off)),
                        placement.Name + " can lose its single-sided walls at orbit angles");
            }

            Debug.Log("[KROMKA SOVIET REPLACEMENTS] PASS: 31 multi-material CC0 "
                + "Soviet and post-Soviet landmarks are grounded inside the "
                + "shoreline; no primitive, Space Kit or Car Kit proxy remains "
                + "in the pass.");
        }

        private static Dictionary<AssetKind, Material[]> BuildMaterials()
        {
            Material[] residential = new Material[ResidentialTextures.Length];
            for (int i = 0; i < residential.Length; i++)
            {
                string token = MaterialToken(ResidentialTextures[i]);
                string path = i == 14 ? ResidentialMaterialPath
                    : MaterialRoot + "Kromka_ResidentialBlock_CC0_"
                        + i.ToString("00") + "_" + token + ".mat";
                residential[i] = BuildMaterial(path,
                    "Kromka_ResidentialBlock_CC0_" + token,
                    ResidentialTextures[i], null,
                    new Color(0.66f, 0.64f, 0.57f, 1f), 0.02f, 0.16f,
                    false);
            }

            Material[] substation = new Material[SubstationTextures.Length];
            for (int i = 0; i < substation.Length; i++)
            {
                string token = MaterialToken(SubstationTextures[i]);
                string path = i == 0 ? SubstationMaterialPath
                    : MaterialRoot + "Kromka_ElectricalSubstation_CC0_"
                        + token + ".mat";
                substation[i] = BuildMaterial(path,
                    "Kromka_ElectricalSubstation_CC0_" + token,
                    SubstationTextures[i], null,
                    new Color(0.64f, 0.60f, 0.52f, 1f), 0.06f, 0.15f,
                    false);
                // The source is deliberately economical (114 triangles) and
                // several wall planes are single-sided. At the orbiting map
                // camera, back-face culling made the building collapse into a
                // T-shaped roof-and-wall silhouette from two quadrants.
                substation[i].SetFloat("_Cull", (float)CullMode.Off);
                substation[i].doubleSidedGI = true;
                EditorUtility.SetDirty(substation[i]);
            }

            Material[] fence = new Material[FenceTextures.Length];
            for (int i = 0; i < fence.Length; i++)
            {
                string token = MaterialToken(FenceTextures[i]);
                string path = i == 2 ? FenceMaterialPath
                    : MaterialRoot + "Kromka_PostSovietFence_CC0_"
                        + token + ".mat";
                fence[i] = BuildMaterial(path,
                    "Kromka_PostSovietFence_CC0_" + token,
                    FenceTextures[i], null,
                    new Color(0.62f, 0.61f, 0.55f, 1f), 0.08f, 0.17f,
                    i != 0);
            }

            return new Dictionary<AssetKind, Material[]>
            {
                { AssetKind.Panel, new[] { BuildMaterial(PanelMaterialPath,
                    "Kromka_SovietPanelHouse_CC0", PanelTexture, null,
                    new Color(0.70f, 0.67f, 0.58f, 1f), 0.02f, 0.18f,
                    false) } },
                { AssetKind.Residential, residential },
                { AssetKind.Garage, new[] { BuildMaterial(GarageMaterialPath,
                    "Kromka_SovietGarage_CC0", GarageTexture, GarageNormal,
                    new Color(0.58f, 0.53f, 0.45f, 1f), 0.18f, 0.18f,
                    false) } },
                { AssetKind.Substation, substation },
                { AssetKind.Fence, fence }
            };
        }

        private static string MaterialToken(string texturePath)
        {
            return System.IO.Path.GetFileNameWithoutExtension(texturePath)
                .Replace(' ', '_');
        }

        private static Material BuildMaterial(string path, string name,
                                              string albedoPath, string normalPath,
                                              Color tint, float metallic,
                                              float smoothness, bool alphaClip)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Texture2D albedo = AssetDatabase.LoadAssetAtPath<Texture2D>(albedoPath);
            if (albedo == null)
                throw new InvalidOperationException("Missing CC0 texture: " + albedoPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetTexture("_BaseMap", albedo);
            material.SetColor("_BaseColor", tint);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;

            if (!string.IsNullOrEmpty(normalPath))
            {
                Texture2D normal = AssetDatabase.LoadAssetAtPath<Texture2D>(normalPath);
                if (normal == null)
                    throw new InvalidOperationException("Missing CC0 normal map: "
                        + normalPath);
                material.SetTexture("_BumpMap", normal);
                material.SetFloat("_BumpScale", 0.45f);
                material.EnableKeyword("_NORMALMAP");
            }
            if (alphaClip)
            {
                material.SetFloat("_AlphaClip", 1f);
                material.SetFloat("_Cutoff", 0.42f);
                material.EnableKeyword("_ALPHATEST_ON");
                material.renderQueue = (int)RenderQueue.AlphaTest;
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void ConfigureModelImporters()
        {
            string[] modelPaths =
            {
                PanelModel, ResidentialModel, GarageModel,
                SubstationModel, FenceModel
            };
            for (int i = 0; i < modelPaths.Length; i++)
            {
                ModelImporter importer = AssetImporter.GetAtPath(modelPaths[i])
                    as ModelImporter;
                if (importer == null)
                    throw new InvalidOperationException("Missing imported CC0 model: "
                        + modelPaths[i]);
                bool changed = importer.importAnimation || importer.importCameras
                    || importer.importLights || importer.importBlendShapes
                    || importer.materialImportMode
                        != ModelImporterMaterialImportMode.ImportStandard;
                importer.importAnimation = false;
                importer.importCameras = false;
                importer.importLights = false;
                importer.importBlendShapes = false;
                // Retain embedded slot names so each wall, roof, door, vent,
                // balcony and fence submesh can receive its intended texture.
                importer.materialImportMode =
                    ModelImporterMaterialImportMode.ImportStandard;
                if (changed) importer.SaveAndReimport();
            }

            TextureImporter normalImporter = AssetImporter.GetAtPath(GarageNormal)
                as TextureImporter;
            if (normalImporter != null
                    && normalImporter.textureType != TextureImporterType.NormalMap)
            {
                normalImporter.textureType = TextureImporterType.NormalMap;
                normalImporter.SaveAndReimport();
            }
        }

        private static string ModelPath(AssetKind kind)
        {
            switch (kind)
            {
                case AssetKind.Panel: return PanelModel;
                case AssetKind.Residential: return ResidentialModel;
                case AssetKind.Garage: return GarageModel;
                case AssetKind.Substation: return SubstationModel;
                case AssetKind.Fence: return FenceModel;
                default: throw new ArgumentOutOfRangeException(nameof(kind), kind, null);
            }
        }

        private static float SourcePitch(AssetKind kind)
        {
            // These FBX families store building depth in source Y and height
            // in source Z. Rotate before footprint fitting; otherwise garages
            // become tall cubes and substations become open T-shaped canopies.
            return kind == AssetKind.Panel || kind == AssetKind.Garage
                    || kind == AssetKind.Substation
                ? -90f : 0f;
        }

        private static void ApplyMaterials(GameObject instance, AssetKind kind,
                                           Material[] materials)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                Material[] sourceSlots = renderer.sharedMaterials;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                int subMeshCount = filter != null && filter.sharedMesh != null
                    ? filter.sharedMesh.subMeshCount : 0;
                int slotCount = Mathf.Max(1, Mathf.Max(sourceSlots.Length,
                    subMeshCount));
                var assigned = new Material[slotCount];
                for (int slot = 0; slot < assigned.Length; slot++)
                {
                    string sourceName = slot < sourceSlots.Length
                            && sourceSlots[slot] != null
                        ? sourceSlots[slot].name : string.Empty;
                    assigned[slot] = SelectMaterial(kind, materials,
                        sourceName, slot);
                }
                renderer.sharedMaterials = assigned;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
                EditorUtility.SetDirty(renderer);
            }
        }

        private static Material SelectMaterial(AssetKind kind,
                                               Material[] materials,
                                               string sourceName, int slot)
        {
            if (materials == null || materials.Length == 0)
                throw new InvalidOperationException(
                    "No authored materials are available for " + kind);
            if (materials.Length == 1) return materials[0];

            string key = (sourceName ?? string.Empty).ToLowerInvariant();
            if (kind == AssetKind.Substation)
            {
                if (key.Contains("wall")) return materials[0];
                if (key.Contains("door")) return materials[1];
                if (key.Contains("vent")) return materials[2];
                if (key.Contains("concrete")) return materials[3];
                if (key.Contains("roof")) return materials[4];
            }
            else if (kind == AssetKind.Fence)
            {
                if (key.Contains("reshet")) return materials[1];
                if (key.Contains("zaborclear")) return materials[2];
                if (key.Contains("black") || key == "none")
                    return materials[0];
            }
            else if (kind == AssetKind.Residential)
            {
                for (int i = 0; i < ResidentialTextures.Length; i++)
                    if (key.Contains(MaterialToken(ResidentialTextures[i])
                            .ToLowerInvariant()))
                        return materials[i];
            }
            return materials[Mathf.Clamp(slot, 0, materials.Length - 1)];
        }

        private static bool HasAuthoredTexture(Material material)
        {
            return material.HasProperty("_BaseMap")
                && material.GetTexture("_BaseMap") != null;
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
                float mapX = samples[i].x / 0.1f + 190f;
                float mapY = 150f - samples[i].z / 0.1f;
                if (!KromkaGlobalMapReliefAuthoring.ContainsMapPoint(mapX, mapY,
                        0.02f))
                    return false;
            }
            return true;
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            if (renderers.Length == 0)
                throw new InvalidOperationException("Landmark has no renderer");
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
                    "Kromka Soviet replacement validation failed: " + message);
        }
    }
}
#endif
