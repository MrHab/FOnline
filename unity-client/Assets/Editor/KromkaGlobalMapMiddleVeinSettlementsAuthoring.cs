#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 07/20. The inhabited Middle Vein is given a
    /// deliberate hierarchy: Keys is the dense river-and-rail hub, while
    /// Outpost 17 and Far Row Farm remain visibly smaller satellites.
    /// </summary>
    internal static class KromkaGlobalMapMiddleVeinSettlementsAuthoring
    {
        internal const int ModelIteration = 7;
        internal const int ModelIterationCount = 20;
        private const int ExpectedSettlementCount = 3;
        private const int ExpectedBuildingCount = 16;
        private const int ExpectedKeysKenneyBuildingCount = 10;
        private const int ExpectedMepSatelliteBuildingCount = 6;
        private const int ExpectedCivicPieceCount = 13;
        private const string MepRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string KenneyRoot =
            "Assets/ThirdParty/Kenney/CityKitIndustrial20/";
        private const string KenneyModelRoot = KenneyRoot + "Models/";
        private const string KenneyPalettePath = KenneyRoot + "Textures/variation-b.png";
        private const string WaterTowerPath = KenneyModelRoot + "water-tower.fbx";
        private const string MepSourceMaterialPath =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string SettlementMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_MiddleVein_Settlement_MEP.mat";
        private const string CivicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_MiddleVein_Civic_MEP.mat";
        private const string KenneyMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_MiddleVein_KenneyBrick.mat";

        private static readonly string[] KeysBuildingModels =
        {
            KenneyModelRoot + "building-a.fbx",
            KenneyModelRoot + "building-b.fbx",
            KenneyModelRoot + "building-d.fbx",
            KenneyModelRoot + "building-g.fbx",
            KenneyModelRoot + "building-h.fbx",
            KenneyModelRoot + "building-i.fbx",
            KenneyModelRoot + "building-k.fbx",
            KenneyModelRoot + "building-o.fbx",
            KenneyModelRoot + "building-s.fbx",
            KenneyModelRoot + "building-t.fbx"
        };

        private static readonly string[] SatelliteBuildingPrefabs =
        {
            MepRoot + "MEP_Shack_01_N.prefab",
            MepRoot + "MEP_Shack_02_N.prefab",
            MepRoot + "MEP_Shack_03_N.prefab",
            MepRoot + "MEP_Shack_04_N.prefab",
            MepRoot + "MEP_Shack_05_N.prefab",
            MepRoot + "MEP_Shack_06_N.prefab"
        };

        private static readonly string[] CivicPrefabs =
        {
            MepRoot + "MEP_Walk_01_N.prefab",
            MepRoot + "MEP_Walk_02_N.prefab",
            MepRoot + "MEP_Walk_03_N.prefab",
            MepRoot + "MEP_Walk_04_N.prefab",
            MepRoot + "MEP_StoneWall_01_N.prefab",
            MepRoot + "MEP_StoneWall_02_N.prefab",
            MepRoot + "MEP_Fence_01_N.prefab",
            MepRoot + "MEP_Fence_02_N.prefab",
            MepRoot + "MEP_Fence_03_N.prefab"
        };

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Settlement;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string settlement, string prefabPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Settlement = settlement;
                PrefabPath = prefabPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly Placement[] Buildings =
        {
            new Placement("Keys_FilterOffice", "Keys", KeysBuildingModels[0],
                213f, 195f, 0.70f, 0.66f, 7f, 0.020f),
            new Placement("Keys_MarketHall", "Keys", KeysBuildingModels[1],
                214f, 184f, 0.65f, 0.66f, -14f, 0.020f),
            new Placement("Keys_Clinic", "Keys", KeysBuildingModels[9],
                180f, 198f, 0.58f, 0.54f, 18f, 0.018f),
            new Placement("Keys_CaravanOffice", "Keys", KeysBuildingModels[3],
                234f, 205f, 0.62f, 0.78f, -31f, 0.020f),
            new Placement("Keys_RiverHouse", "Keys", KeysBuildingModels[4],
                176f, 211f, 0.58f, 0.49f, 29f, 0.018f),
            new Placement("Keys_Workshop", "Keys", KeysBuildingModels[5],
                231f, 195f, 0.62f, 0.52f, 11f, 0.020f),
            new Placement("Keys_RailBarracks", "Keys", KeysBuildingModels[8],
                221f, 219f, 0.64f, 0.47f, -26f, 0.018f),
            new Placement("Keys_WesternYard", "Keys", KeysBuildingModels[6],
                172f, 205f, 0.58f, 0.47f, 36f, 0.018f),
            new Placement("Keys_BrokenDepot", "Keys", KeysBuildingModels[7],
                230f, 222f, 0.60f, 0.64f, 22f, 0.020f),
            new Placement("Keys_StationShed", "Keys", KeysBuildingModels[2],
                186f, 224f, 0.58f, 0.74f, -8f, 0.018f),

            new Placement("Outpost17_Gatehouse", "Outpost17", SatelliteBuildingPrefabs[3],
                165f, 222f, 0.42f, 0.48f, 42f, 0.020f),
            new Placement("Outpost17_Barracks", "Outpost17", SatelliteBuildingPrefabs[1],
                171f, 227f, 0.44f, 0.50f, 30f, 0.020f),
            new Placement("Outpost17_SearchOffice", "Outpost17", SatelliteBuildingPrefabs[0],
                158f, 227f, 0.37f, 0.44f, 49f, 0.018f),

            new Placement("FarRow_Farmhouse", "FarRowFarm", SatelliteBuildingPrefabs[4],
                151f, 188f, 0.44f, 0.50f, -19f, 0.020f),
            new Placement("FarRow_LongBarn", "FarRowFarm", SatelliteBuildingPrefabs[5],
                144f, 193f, 0.48f, 0.52f, -7f, 0.020f),
            new Placement("FarRow_PumpShed", "FarRowFarm", SatelliteBuildingPrefabs[2],
                157f, 194f, 0.37f, 0.44f, -31f, 0.018f)
        };

        private static readonly Placement[] CivicPieces =
        {
            // Independent timber loading platforms belong to the freight yards,
            // not four disconnected pieces pretending to span the river.
            new Placement("Keys_LoadingPlatform_West", "Keys", CivicPrefabs[0],
                175f, 232f, 0.58f, 0.19f, -4f, 0.010f),
            new Placement("Keys_LoadingPlatform_CentreWest", "Keys", CivicPrefabs[1],
                184f, 232f, 0.58f, 0.19f, -4f, 0.010f),
            new Placement("Keys_LoadingPlatform_CentreEast", "Keys", CivicPrefabs[2],
                216f, 228f, 0.58f, 0.19f, -12f, 0.010f),
            new Placement("Keys_LoadingPlatform_East", "Keys", CivicPrefabs[3],
                227f, 229f, 0.58f, 0.19f, -12f, 0.010f),

            new Placement("Keys_FilterWall_West", "Keys", CivicPrefabs[4],
                190f, 194f, 0.52f, 0.24f, 8f, 0.018f),
            new Placement("Keys_FilterWall_East", "Keys", CivicPrefabs[5],
                214f, 194f, 0.52f, 0.24f, -6f, 0.018f),
            new Placement("Keys_MarketFence_North", "Keys", CivicPrefabs[6],
                216f, 189f, 0.43f, 0.22f, -16f, 0.012f),
            new Placement("Keys_MarketFence_East", "Keys", CivicPrefabs[7],
                214f, 203f, 0.43f, 0.22f, 73f, 0.012f),
            new Placement("Keys_RiverFence", "Keys", CivicPrefabs[8],
                173f, 216f, 0.43f, 0.22f, -27f, 0.012f),

            new Placement("Outpost17_GateWall", "Outpost17", CivicPrefabs[4],
                166f, 230f, 0.48f, 0.23f, 42f, 0.016f),
            new Placement("Outpost17_RoadFence", "Outpost17", CivicPrefabs[7],
                157f, 221f, 0.40f, 0.21f, 43f, 0.012f),
            new Placement("FarRow_FieldFence_West", "FarRowFarm", CivicPrefabs[6],
                143f, 186f, 0.42f, 0.21f, -8f, 0.012f),
            new Placement("FarRow_FieldFence_East", "FarRowFarm", CivicPrefabs[8],
                159f, 188f, 0.42f, 0.21f, -9f, 0.012f)
        };

        internal static void Compose(Transform parent)
        {
            ConfigureKenneyAssets();
            Material kenneyMaterial = BuildKenneyMaterial();
            Material settlementMaterial = BuildMepMaterial(SettlementMaterialPath,
                "Kromka_MiddleVein_Settlement_MEP",
                new Color(0.96f, 0.87f, 0.70f, 1f));
            Material civicMaterial = BuildMepMaterial(CivicMaterialPath,
                "Kromka_MiddleVein_Civic_MEP",
                new Color(0.78f, 0.76f, 0.67f, 1f));
            Transform root = Child(parent, "MiddleVein_SettlementBelt_MEP");
            Transform settlementRoot = Child(root, "ThreeNamedSettlements_EDITABLE");
            Transform civicRoot = Child(root, "CivicInfrastructure_EDITABLE");

            for (int i = 0; i < Buildings.Length; i++)
                InstantiatePlacement(Buildings[i], settlementRoot,
                    Buildings[i].PrefabPath.StartsWith(KenneyModelRoot,
                        StringComparison.Ordinal) ? kenneyMaterial : settlementMaterial);
            for (int i = 0; i < CivicPieces.Length; i++)
                InstantiatePlacement(CivicPieces[i], civicRoot, civicMaterial);

            BuildKeysWaterTower(root);

            Child(parent, "MiddleVeinSettlements_3_REFERENCE");
            Child(parent, "KeysBuildings_10_REFERENCE");
            Child(parent, "SatelliteBuildings_6_REFERENCE");
            Child(parent, "KenneyKeysBuildings_10_REFERENCE");
            Child(parent, "DirectMEPSatelliteBuildings_6_REFERENCE");
            Child(parent, "KenneyCityKitSources_11_REFERENCE");
            Child(parent, "DirectMEPCivicPieces_13_REFERENCE");
            Child(parent, "KeysLoadingPlatforms_4_REFERENCE");
            Child(parent, "KeysWaterTower_1_REFERENCE");
            Child(parent, "PersistentSettlementGeometry_REFERENCE");
            Child(parent, "ModelIteration_07_of_20");
        }

        internal static void ValidateIteration07()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 07 root is missing from the global map.");
            Transform root = rootObject.transform;

            Require(root.Find("MiddleVeinSettlements_3_REFERENCE") != null,
                "settlement-count reference is missing");
            Require(root.Find("KeysBuildings_10_REFERENCE") != null,
                "Keys building-count reference is missing");
            Require(root.Find("SatelliteBuildings_6_REFERENCE") != null,
                "satellite building-count reference is missing");
            Require(root.Find("KenneyKeysBuildings_10_REFERENCE") != null,
                "Kenney Keys building-count reference is missing");
            Require(root.Find("DirectMEPSatelliteBuildings_6_REFERENCE") != null,
                "MEP satellite building-count reference is missing");
            Require(root.Find("KenneyCityKitSources_11_REFERENCE") != null,
                "Kenney City Kit source-count reference is missing");
            Require(root.Find("DirectMEPCivicPieces_13_REFERENCE") != null,
                "MEP civic-count reference is missing");
            Require(root.Find("KeysLoadingPlatforms_4_REFERENCE") != null,
                "freight-yard loading-platform reference is missing");
            Require(root.Find("KeysWaterTower_1_REFERENCE") != null,
                "water-tower reference is missing");
            Require(root.Find("PersistentSettlementGeometry_REFERENCE") != null,
                "persistent-geometry reference is missing");
            Require(root.Find("ModelIteration_07_of_20") != null,
                "model iteration marker is missing");
            Require(Buildings.Length == ExpectedBuildingCount,
                "iteration 07 must contain sixteen settlement buildings");
            Require(Buildings.Count(building => building.Settlement == "Keys")
                    == ExpectedKeysKenneyBuildingCount,
                "iteration 07 must contain ten Kenney buildings in Keys");
            Require(Buildings.Count(building => building.Settlement != "Keys")
                    == ExpectedMepSatelliteBuildingCount,
                "iteration 07 must contain six direct MEP satellite buildings");
            Require(CivicPieces.Length == ExpectedCivicPieceCount,
                "iteration 07 must contain thirteen MEP civic pieces");

            Transform belt = FindDescendant(root, "MiddleVein_SettlementBelt_MEP");
            Transform settlementRoot = FindDescendant(belt,
                "ThreeNamedSettlements_EDITABLE");
            Transform civicRoot = FindDescendant(belt, "CivicInfrastructure_EDITABLE");
            Require(settlementRoot != null && settlementRoot.childCount == ExpectedSettlementCount,
                "the three named settlement groups are incomplete");
            Require(civicRoot != null && civicRoot.childCount == ExpectedSettlementCount,
                "civic pieces are not grouped by the three named settlements");
            Material settlementMaterial = AssetDatabase.LoadAssetAtPath<Material>(
                SettlementMaterialPath);
            Material civicMaterial = AssetDatabase.LoadAssetAtPath<Material>(CivicMaterialPath);
            Material authoredKenneyMaterial = AssetDatabase.LoadAssetAtPath<Material>(
                KenneyMaterialPath);
            Material kenneyMaterial = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                KenneyModelRoot, authoredKenneyMaterial);
            Require(settlementMaterial != null && civicMaterial != null
                    && kenneyMaterial != null,
                "Middle Vein strategic-map materials are missing");
            KromkaGlobalMapNativeModelMaterialAuthoring.ValidateSourceAtlases();
            Require(kenneyMaterial.GetTexture("_BaseMap") != null,
                "Keys buildings lost the original Kenney texture atlas");

            var kenneySources = new HashSet<string>(StringComparer.Ordinal);
            var mepBuildingSources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < Buildings.Length; i++)
            {
                bool isKenney = Buildings[i].PrefabPath.StartsWith(KenneyModelRoot,
                    StringComparison.Ordinal);
                ValidatePlacement(settlementRoot, Buildings[i],
                    isKenney ? kenneyMaterial : settlementMaterial,
                    isKenney ? KenneyModelRoot : MepRoot);
                if (isKenney) kenneySources.Add(Buildings[i].PrefabPath);
                else mepBuildingSources.Add(Buildings[i].PrefabPath);
            }
            Require(kenneySources.SetEquals(KeysBuildingModels),
                "all ten reviewed Kenney Keys buildings must remain represented");
            Require(mepBuildingSources.SetEquals(SatelliteBuildingPrefabs),
                "all six reviewed MEP satellite buildings must remain represented");

            var civicSources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < CivicPieces.Length; i++)
            {
                ValidatePlacement(civicRoot, CivicPieces[i], civicMaterial, MepRoot);
                civicSources.Add(CivicPieces[i].PrefabPath);
            }
            Require(civicSources.SetEquals(CivicPrefabs),
                "all nine reviewed MEP civic sources must remain represented");

            Transform tower = FindDescendant(belt, "Keys_WaterTower_LANDMARK");
            Require(tower != null, "Keys water tower is missing");
            string tankSource = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                tower.gameObject).Replace('\\', '/');
            Require(tankSource == WaterTowerPath,
                "Keys water tower lost its Kenney City Kit source link");
            Require(tower.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Keys water tower can obstruct strategic-map interaction");
            Require(tower.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Keys water tower can disappear with camera distance");
            Renderer[] towerRenderers = tower.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(towerRenderers.Length >= 1,
                "Keys water tower silhouette is incomplete");
            Require(towerRenderers.All(renderer => renderer.sharedMaterials
                    .All(material => material == kenneyMaterial)),
                "Keys water tower lost its reviewed palette material");

            Debug.Log("[KROMKA MODELS 35%] PASS: Keys, Outpost 17 and Far Row "
                + "form a three-tier Middle Vein settlement belt: ten CC0 Kenney "
                + "industrial buildings define Keys, six direct MEP shacks define "
                + "the satellites, and grounded MEP platforms and civic pieces furnish the yards.");
        }

        internal static void RefreshRailBridgePlacement(Transform modelRoot)
        {
            foreach (string suffix in new[] { "West", "CentreWest", "CentreEast", "East" })
            {
                Transform old = FindDescendant(modelRoot, "Keys_RailBridge_" + suffix);
                if (old != null) old.name = "Keys_LoadingPlatform_" + suffix;
            }
            Transform marker = modelRoot.Find("KeysRailBridgeSections_4_REFERENCE");
            if (marker != null) marker.name = "KeysLoadingPlatforms_4_REFERENCE";
            foreach (Placement placement in CivicPieces.Where(item => item.Name.StartsWith("Keys_LoadingPlatform_")
                    || item.Name == "Keys_MarketFence_North" || item.Name == "Keys_RiverFence")
                .Concat(Buildings.Where(item => item.Name == "Keys_Workshop" || item.Name == "Keys_MarketHall"
                    || item.Name == "Keys_CaravanOffice" || item.Name == "Keys_BrokenDepot" || item.Name == "Keys_StationShed")))
            {
                Transform instance = FindDescendant(modelRoot, placement.Name);
                Require(instance != null, placement.Name + " is missing.");
                instance.rotation = Quaternion.Euler(0f, placement.Yaw, 0f);
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
            Transform tower = FindDescendant(modelRoot, "Keys_WaterTower_LANDMARK");
            Transform towerParent = tower.parent;
            UnityEngine.Object.DestroyImmediate(tower.gameObject);
            BuildKeysWaterTower(towerParent);
        }

        private static void InstantiatePlacement(Placement placement, Transform root,
                                                 Material material)
        {
            material = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                placement.PrefabPath, material);
            Transform group = root.Find(placement.Settlement)
                ?? Child(root, placement.Settlement);
            GameObject instance = KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                placement.PrefabPath, placement.Name, group,
                placement.MapX, placement.MapY, placement.Footprint,
                placement.MaximumHeight, placement.Yaw, placement.Embed);
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            for (int i = 0; i < renderers.Length; i++)
            {
                renderers[i].sharedMaterials = Enumerable.Repeat(material,
                    renderers[i].sharedMaterials.Length).ToArray();
                renderers[i].receiveShadows = true;
            }
        }

        private static void ValidatePlacement(Transform groupRoot, Placement placement,
                                              Material expectedMaterial,
                                              string expectedSourceRoot)
        {
            expectedMaterial = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                placement.PrefabPath, expectedMaterial);
            Require(placement.MapX >= 140f && placement.MapX <= 235f
                    && placement.MapY >= 184f && placement.MapY <= 232f,
                placement.Name + " is outside the reviewed Middle Vein settlement belt");
            Transform instance = FindDescendant(groupRoot, placement.Name);
            Require(instance != null, placement.Name + " is missing");
            string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                instance.gameObject).Replace('\\', '/');
            Require(sourcePath == placement.PrefabPath
                    && sourcePath.StartsWith(expectedSourceRoot, StringComparison.Ordinal),
                placement.Name + " lost its reviewed source link");
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(renderers.Length > 0, placement.Name + " has no visible renderer");
            Require(renderers.All(renderer => renderer.sharedMaterials
                    .All(material => material == expectedMaterial)),
                placement.Name + " lost its strategic-map material");
            Bounds bounds = Encapsulate(renderers);
            float actualFootprint = Mathf.Max(bounds.size.x, bounds.size.z);
            Require(Mathf.Abs(actualFootprint - placement.Footprint) <= 0.035f,
                placement.Name + " footprint drifted from the authored scale");
            Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                placement.Name + " is too tall for the strategic-map scale");
            float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                placement.MapX, placement.MapY);
            Require(Mathf.Abs(bounds.min.y - (terrainHeight - placement.Embed)) <= 0.035f,
                placement.Name + " is not seated in the authored relief");
            Require(instance.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                placement.Name + " can obstruct strategic-map interaction");
            Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                placement.Name + " can disappear with camera distance");
        }

        private static void BuildKeysWaterTower(Transform parent)
        {
            const float mapX = 224f;
            const float mapY = 181f;
            GameObject tower = KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                WaterTowerPath, "Keys_WaterTower_LANDMARK", parent,
                mapX, mapY, 0.70f, 1.05f, 0f, 0.020f);
            Material material = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                WaterTowerPath,
                AssetDatabase.LoadAssetAtPath<Material>(KenneyMaterialPath));
            Renderer[] renderers = tower.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            for (int i = 0; i < renderers.Length; i++)
                renderers[i].sharedMaterials = Enumerable.Repeat(material,
                    renderers[i].sharedMaterials.Length).ToArray();
        }

        private static void ConfigureKenneyAssets()
        {
            string[] models = KeysBuildingModels.Concat(new[] { WaterTowerPath }).ToArray();
            for (int i = 0; i < models.Length; i++)
            {
                ModelImporter importer = AssetImporter.GetAtPath(models[i]) as ModelImporter;
                if (importer == null)
                    throw new InvalidOperationException(
                        "Missing Kenney City Kit model importer: " + models[i]);
                bool changed = importer.importAnimation || importer.importCameras
                    || importer.importLights || importer.importBlendShapes
                    || importer.materialImportMode != ModelImporterMaterialImportMode.None;
                importer.importAnimation = false;
                importer.importCameras = false;
                importer.importLights = false;
                importer.importBlendShapes = false;
                importer.materialImportMode = ModelImporterMaterialImportMode.None;
                if (changed) importer.SaveAndReimport();
            }

            TextureImporter paletteImporter = AssetImporter.GetAtPath(KenneyPalettePath)
                as TextureImporter;
            if (paletteImporter == null)
                throw new InvalidOperationException(
                    "Missing Kenney City Kit variation-B palette importer");
            bool paletteChanged = !paletteImporter.sRGBTexture
                || paletteImporter.mipmapEnabled
                || paletteImporter.textureCompression
                    != TextureImporterCompression.Uncompressed
                || paletteImporter.filterMode != FilterMode.Point
                || paletteImporter.wrapMode != TextureWrapMode.Clamp;
            paletteImporter.sRGBTexture = true;
            paletteImporter.mipmapEnabled = false;
            paletteImporter.textureCompression = TextureImporterCompression.Uncompressed;
            paletteImporter.filterMode = FilterMode.Point;
            paletteImporter.wrapMode = TextureWrapMode.Clamp;
            if (paletteChanged) paletteImporter.SaveAndReimport();
        }

        private static Material BuildKenneyMaterial()
        {
            Texture2D palette = AssetDatabase.LoadAssetAtPath<Texture2D>(KenneyPalettePath);
            if (palette == null)
                throw new InvalidOperationException(
                    "Missing Kenney City Kit variation-B palette");
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(KenneyMaterialPath);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, KenneyMaterialPath);
            }
            else material.shader = shader;
            material.name = "Kromka_MiddleVein_KenneyBrick";
            material.SetTexture("_BaseMap", palette);
            material.SetColor("_BaseColor", new Color(0.72f, 0.69f, 0.60f, 1f));
            material.SetFloat("_Metallic", 0.12f);
            material.SetFloat("_Smoothness", 0.20f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildMepMaterial(string assetPath, string name, Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(MepSourceMaterialPath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException("MEP settlement source material is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, assetPath);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
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
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 07 validation failed: " + message);
        }
    }
}
#endif
