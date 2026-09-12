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
    /// Environment-model iteration 11/20. Three Chalk Lowland nodes use direct
    /// MEP shacks, civic pieces and cave forms as their visual foundation. Pale
    /// kilns and cloth filters distinguish this inhabited karst from Glasslands.
    /// </summary>
    internal static class KromkaGlobalMapChalkLowlandSettlementAuthoring
    {
        internal const int ModelIteration = 11;
        internal const int ModelIterationCount = 20;
        private const int ExpectedBuildingCount = 8;
        private const int ExpectedCivicCount = 14;
        private const int ExpectedKarstCount = 14;
        private const int ExpectedFactoryCount = 5;
        private const int ExpectedFilterRackCount = 12;
        private const int ExpectedKilnCount = 2;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string FactoryRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";
        private const string BuildingMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_Buildings_MEP.mat";
        private const string CivicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_Civic_MEP.mat";
        private const string KarstMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_Karst_MEP.mat";
        private const string FactoryMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_Factory.mat";
        private const string ClothMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_FilterCloth.mat";
        private const string KilnMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_Kiln.mat";
        private const string KilnDarkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ChalkLowland_KilnDark.mat";

        private static readonly string[] BuildingSources =
        {
            MepBuildingRoot + "MEP_Shack_01_N.prefab",
            MepBuildingRoot + "MEP_Shack_02_N.prefab",
            MepBuildingRoot + "MEP_Shack_03_N.prefab",
            MepBuildingRoot + "MEP_Shack_04_N.prefab",
            MepBuildingRoot + "MEP_Shack_05_N.prefab",
            MepBuildingRoot + "MEP_Shack_06_N.prefab",
            MepBuildingRoot + "MEP_Shack_Broken_N.prefab"
        };

        private static readonly string[] CivicSources =
        {
            MepBuildingRoot + "MEP_Walk_01_N.prefab",
            MepBuildingRoot + "MEP_Walk_02_N.prefab",
            MepBuildingRoot + "MEP_Walk_03_N.prefab",
            MepBuildingRoot + "MEP_Walk_04_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_01_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_01_N.prefab",
            MepBuildingRoot + "MEP_Fence_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_03_N.prefab"
        };

        private static readonly string[] KarstSources =
        {
            MepCaveRoot + "MEP_C_Entrance_01_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_01_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_02_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_03_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_04_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_01_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_02_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_03_N.prefab",
            MepCaveRoot + "MEP_C_ConcaveStone_N.prefab",
            MepCaveRoot + "MEP_C_Wall_03_N.prefab"
        };

        private static readonly string[] FactorySources =
        {
            FactoryRoot + "hopper-high-round.fbx",
            FactoryRoot + "hopper-high-square.fbx",
            FactoryRoot + "conveyor-long-sides.fbx",
            FactoryRoot + "conveyor-bars-fence-slope.fbx",
            FactoryRoot + "structure-tall.fbx"
        };

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Zone;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string zone, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Zone = zone;
                AssetPath = assetPath;
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
            new Placement("SecondHaven_QuarryHouseNorth", "SecondHaven", BuildingSources[0], 294f, 101f, 0.62f, 0.48f, 14f, 0.020f),
            new Placement("SecondHaven_QuarryHouseNorthEast", "SecondHaven", BuildingSources[1], 304f, 103f, 0.58f, 0.46f, -21f, 0.018f),
            new Placement("SecondHaven_FilterHouseEast", "SecondHaven", BuildingSources[2], 309f, 111f, 0.64f, 0.47f, -78f, 0.020f),
            new Placement("SecondHaven_CourtyardHouseSouthEast", "SecondHaven", BuildingSources[3], 304f, 119f, 0.60f, 0.45f, -151f, 0.020f),
            new Placement("SecondHaven_CourtyardHouseSouth", "SecondHaven", BuildingSources[4], 294f, 121f, 0.66f, 0.46f, 171f, 0.022f),
            new Placement("SecondHaven_QuarryHouseSouthWest", "SecondHaven", BuildingSources[5], 285f, 116f, 0.60f, 0.45f, 112f, 0.020f),
            new Placement("SecondHaven_BrokenHouseWest", "SecondHaven", BuildingSources[6], 284f, 106f, 0.68f, 0.39f, 71f, 0.030f),
            new Placement("SecondHaven_CouncilHouse", "SecondHaven", BuildingSources[1], 298f, 109f, 0.78f, 0.54f, 7f, 0.020f)
        };

        private static readonly Placement[] CivicPieces =
        {
            new Placement("SecondHaven_WalkNorth", "SecondHaven", CivicSources[0], 299f, 99f, 0.50f, 0.22f, 3f, 0.012f),
            new Placement("SecondHaven_WalkEast", "SecondHaven", CivicSources[1], 312f, 110f, 0.48f, 0.22f, -88f, 0.012f),
            new Placement("SecondHaven_WalkSouth", "SecondHaven", CivicSources[2], 297f, 124f, 0.52f, 0.22f, 178f, 0.012f),
            new Placement("SecondHaven_WalkWest", "SecondHaven", CivicSources[3], 282f, 111f, 0.48f, 0.22f, 89f, 0.012f),
            new Placement("SecondHaven_CourtyardWallNorth", "SecondHaven", CivicSources[4], 295f, 106f, 0.54f, 0.25f, 5f, 0.016f),
            new Placement("SecondHaven_CourtyardWallSouth", "SecondHaven", CivicSources[5], 297f, 116f, 0.54f, 0.25f, -7f, 0.016f),
            new Placement("SecondHaven_FilterFenceWest", "SecondHaven", CivicSources[6], 287f, 111f, 0.45f, 0.22f, 91f, 0.010f),
            new Placement("SecondHaven_FilterFenceEast", "SecondHaven", CivicSources[7], 306f, 112f, 0.45f, 0.22f, 88f, 0.010f),

            new Placement("ChalkSluice_GateWallNorth", "ChalkSluice", CivicSources[4], 261f, 83f, 0.58f, 0.27f, -29f, 0.016f),
            new Placement("ChalkSluice_GateWallSouth", "ChalkSluice", CivicSources[5], 273f, 94f, 0.58f, 0.27f, -31f, 0.016f),
            new Placement("ChalkSluice_FilterFenceNorth", "ChalkSluice", CivicSources[8], 268f, 79f, 0.48f, 0.22f, 3f, 0.010f),
            new Placement("ChalkSluice_FilterFenceWest", "ChalkSluice", CivicSources[6], 257f, 89f, 0.48f, 0.22f, 62f, 0.010f),
            new Placement("ChalkSluice_FilterFenceEast", "ChalkSluice", CivicSources[7], 278f, 88f, 0.48f, 0.22f, -65f, 0.010f),
            new Placement("ChalkSluice_ServiceWalk", "ChalkSluice", CivicSources[3], 268f, 98f, 0.52f, 0.22f, 2f, 0.012f)
        };

        private static readonly Placement[] KarstPieces =
        {
            new Placement("CeramicLedge_CutFace", "CeramicLedge", KarstSources[0], 274f, 139f, 1.05f, 0.76f, 174f, 0.065f),
            new Placement("CeramicLedge_BoulderNorthWest", "CeramicLedge", KarstSources[1], 263f, 132f, 0.66f, 0.44f, 24f, 0.040f),
            new Placement("CeramicLedge_BoulderNorth", "CeramicLedge", KarstSources[2], 274f, 129f, 0.64f, 0.42f, -14f, 0.038f),
            new Placement("CeramicLedge_BoulderNorthEast", "CeramicLedge", KarstSources[3], 285f, 134f, 0.62f, 0.42f, -39f, 0.040f),
            new Placement("CeramicLedge_BoulderSouthEast", "CeramicLedge", KarstSources[4], 286f, 145f, 0.64f, 0.43f, 53f, 0.038f),
            new Placement("CeramicLedge_ChalkHeapEast", "CeramicLedge", KarstSources[5], 280f, 149f, 0.58f, 0.34f, 11f, 0.032f),
            new Placement("CeramicLedge_ChalkHeapSouth", "CeramicLedge", KarstSources[6], 269f, 150f, 0.62f, 0.35f, -18f, 0.032f),
            new Placement("CeramicLedge_ChalkHeapWest", "CeramicLedge", KarstSources[7], 260f, 143f, 0.60f, 0.35f, 37f, 0.032f),
            new Placement("CeramicLedge_ConcaveCut", "CeramicLedge", KarstSources[8], 261f, 137f, 0.68f, 0.42f, 71f, 0.045f),
            new Placement("CeramicLedge_WhiteWall", "CeramicLedge", KarstSources[9], 282f, 141f, 0.72f, 0.48f, -92f, 0.050f),

            new Placement("ChalkSluice_KarstGate", "ChalkSluice", KarstSources[0], 267f, 88f, 0.94f, 0.70f, -2f, 0.070f),
            new Placement("ChalkSluice_AnchorBoulderWest", "ChalkSluice", KarstSources[2], 257f, 83f, 0.62f, 0.42f, 38f, 0.040f),
            new Placement("ChalkSluice_AnchorBoulderEast", "ChalkSluice", KarstSources[3], 278f, 82f, 0.62f, 0.42f, -45f, 0.040f),
            new Placement("ChalkSluice_OutletRubble", "ChalkSluice", KarstSources[6], 267f, 99f, 0.62f, 0.35f, 8f, 0.032f)
        };

        private static readonly Placement[] FactoryPieces =
        {
            new Placement("CeramicLedge_RoundClayHopper", "CeramicLedge", FactorySources[0], 270f, 136f, 0.48f, 0.60f, -14f, 0.018f),
            new Placement("CeramicLedge_SquareClayHopper", "CeramicLedge", FactorySources[1], 279f, 137f, 0.46f, 0.58f, 13f, 0.018f),
            new Placement("CeramicLedge_BrokenConveyor", "CeramicLedge", FactorySources[2], 275f, 146f, 0.70f, 0.30f, 86f, 0.016f),
            new Placement("ChalkSluice_FilterTower", "ChalkSluice", FactorySources[4], 267f, 84f, 0.48f, 0.72f, 0f, 0.018f),
            new Placement("ChalkSluice_SlopingRack", "ChalkSluice", FactorySources[3], 267f, 94f, 0.70f, 0.34f, 1f, 0.016f)
        };

        internal static void Compose(Transform parent)
        {
            Material buildings = BuildMepMaterial(BuildingMaterialPath,
                MepBuildingSourceMaterial, "Kromka_ChalkLowland_Buildings_MEP",
                new Color(0.82f, 0.78f, 0.66f, 1f));
            Material civic = BuildMepMaterial(CivicMaterialPath,
                MepBuildingSourceMaterial, "Kromka_ChalkLowland_Civic_MEP",
                new Color(0.69f, 0.68f, 0.61f, 1f));
            Material karst = BuildMepMaterial(KarstMaterialPath,
                MepCaveSourceMaterial, "Kromka_ChalkLowland_Karst_MEP",
                new Color(0.86f, 0.86f, 0.76f, 1f));
            Material factory = BuildSolidMaterial(FactoryMaterialPath,
                "Kromka_ChalkLowland_Factory", new Color(0.56f, 0.58f, 0.53f, 1f),
                0.18f, 0.22f);
            Material cloth = BuildSolidMaterial(ClothMaterialPath,
                "Kromka_ChalkLowland_FilterCloth", new Color(0.55f, 0.70f, 0.68f, 1f),
                0f, 0.10f);
            Material kiln = BuildSolidMaterial(KilnMaterialPath,
                "Kromka_ChalkLowland_Kiln", new Color(0.86f, 0.80f, 0.66f, 1f),
                0f, 0.14f);
            Material dark = BuildSolidMaterial(KilnDarkMaterialPath,
                "Kromka_ChalkLowland_KilnDark", new Color(0.10f, 0.09f, 0.075f, 1f),
                0f, 0.05f);

            Transform root = Child(parent, "ChalkLowland_SettlementAndIndustry_MEP_Kenney");
            PlaceSet(Buildings, Child(root, "SecondHaven_QuarryHouses_EDITABLE"), buildings);
            PlaceSet(CivicPieces, Child(root, "ChalkCivicInfrastructure_EDITABLE"), civic);
            PlaceSet(KarstPieces, Child(root, "ChalkKarstLandmarks_EDITABLE"), karst);
            PlaceSet(FactoryPieces, Child(root, "ChalkProcessingMachines_EDITABLE"), factory);
            BuildSecondHavenCanopy(root, civic, cloth);
            BuildCeramicKilns(root, kiln, dark);
            BuildFilterRacks(root, civic, cloth);

            Child(parent, "ChalkLowlandNamedNodes_3_REFERENCE");
            Child(parent, "DirectMEPChalkBuildings_8_REFERENCE");
            Child(parent, "DirectMEPChalkCivic_14_REFERENCE");
            Child(parent, "DirectMEPChalkKarst_14_REFERENCE");
            Child(parent, "KenneyChalkMachines_5_REFERENCE");
            Child(parent, "ChalkFilterRacks_12_REFERENCE");
            Child(parent, "CeramicKilns_2_REFERENCE");
            Child(parent, "SecondHavenFilterCanopy_1_REFERENCE");
            Child(parent, "PersistentChalkLowlandGeometry_REFERENCE");
            Child(parent, "ModelIteration_11_of_20");
        }

        internal static void ValidateIteration11()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 11 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "ChalkLowlandNamedNodes_3_REFERENCE", "DirectMEPChalkBuildings_8_REFERENCE",
                "DirectMEPChalkCivic_14_REFERENCE", "DirectMEPChalkKarst_14_REFERENCE",
                "KenneyChalkMachines_5_REFERENCE", "ChalkFilterRacks_12_REFERENCE",
                "CeramicKilns_2_REFERENCE", "SecondHavenFilterCanopy_1_REFERENCE",
                "PersistentChalkLowlandGeometry_REFERENCE", "ModelIteration_11_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(Buildings.Length == ExpectedBuildingCount,
                "eight Second Haven quarry houses are required");
            Require(CivicPieces.Length == ExpectedCivicCount,
                "fourteen Chalk Lowland civic pieces are required");
            Require(KarstPieces.Length == ExpectedKarstCount,
                "fourteen Chalk Lowland karst pieces are required");
            Require(FactoryPieces.Length == ExpectedFactoryCount,
                "five Chalk Lowland processing machines are required");

            Transform belt = FindDescendant(root,
                "ChalkLowland_SettlementAndIndustry_MEP_Kenney");
            Require(belt != null, "Chalk Lowland model belt is missing");
            Material buildings = RequireMaterial(BuildingMaterialPath);
            Material civic = RequireMaterial(CivicMaterialPath);
            Material karst = RequireMaterial(KarstMaterialPath);
            Material factory = RequireMaterial(FactoryMaterialPath);
            ValidateSet(FindDescendant(belt, "SecondHaven_QuarryHouses_EDITABLE"),
                Buildings, buildings, BuildingSources);
            ValidateSet(FindDescendant(belt, "ChalkCivicInfrastructure_EDITABLE"),
                CivicPieces, civic, CivicSources);
            ValidateSet(FindDescendant(belt, "ChalkKarstLandmarks_EDITABLE"),
                KarstPieces, karst, KarstSources);
            ValidateSet(FindDescendant(belt, "ChalkProcessingMachines_EDITABLE"),
                FactoryPieces, factory, FactorySources);

            Transform canopy = FindDescendant(belt,
                "SecondHaven_FilterCanopy_LANDMARK");
            Require(canopy != null
                    && canopy.GetComponentsInChildren<Renderer>(true).Length == 9,
                "Second Haven filter canopy silhouette is incomplete");
            Transform kilns = FindDescendant(belt, "CeramicLedge_Kilns_LANDMARK");
            Require(kilns != null && kilns.childCount == ExpectedKilnCount
                    && kilns.GetComponentsInChildren<Renderer>(true).Length == 10,
                "Ceramic Ledge kiln pair is incomplete");
            Transform racks = FindDescendant(belt,
                "ChalkSluice_FilterRacks_LANDMARK");
            Require(racks != null && racks.childCount == ExpectedFilterRackCount
                    && racks.GetComponentsInChildren<Renderer>(true).Length
                        == ExpectedFilterRackCount * 4,
                "Chalk Sluice filter-rack rows are incomplete");
            Require(belt.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Chalk Lowland geometry can obstruct strategic-map interaction");
            Require(belt.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Chalk Lowland geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 55%] PASS: Second Haven, Ceramic Ledge and "
                + "Chalk Sluice use eight direct MEP houses, twenty-eight direct MEP "
                + "civic/karst pieces, five processing machines, two kilns and twelve "
                + "cloth-filter racks.");
        }

        private static void PlaceSet(Placement[] placements, Transform root,
                                     Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Transform zone = root.Find(placement.Zone) ?? Child(root, placement.Zone);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, zone,
                        placement.MapX, placement.MapY, placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(resolvedMaterial,
                        renderers[rendererIndex].sharedMaterials.Length).ToArray();
                    renderers[rendererIndex].receiveShadows = true;
                }
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        Material material, string[] expectedSources)
        {
            Require(root != null, "a Chalk Lowland placement root is missing");
            var sources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Require(placement.MapX >= 255f && placement.MapX <= 312f
                        && placement.MapY >= 78f && placement.MapY <= 150f,
                    placement.Name + " is outside the reviewed Chalk Lowland");
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath,
                    placement.Name + " lost its reviewed source link");
                sources.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == resolvedMaterial)),
                    placement.Name + " lost its strategic material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is not grounded on the authored relief");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for the strategic-map scale");
            }
            Require(sources.SetEquals(expectedSources),
                "a reviewed Chalk Lowland source set is incomplete");
        }

        private static void BuildSecondHavenCanopy(Transform parent, Material frame,
                                                   Material cloth)
        {
            Transform canopy = Child(parent, "SecondHaven_FilterCanopy_LANDMARK");
            canopy.position = MapToWorld(297f, 111f) + new Vector3(0f, 0.02f, 0f);
            Vector3[] posts =
            {
                new Vector3(-0.42f, 0.25f, -0.28f), new Vector3(0.42f, 0.25f, -0.28f),
                new Vector3(-0.42f, 0.25f, 0.28f), new Vector3(0.42f, 0.25f, 0.28f)
            };
            for (int i = 0; i < posts.Length; i++)
                BuildPrimitive("CanopyPost_" + i, canopy, PrimitiveType.Cube, posts[i],
                    new Vector3(0.055f, 0.50f, 0.055f), Quaternion.identity, frame);
            for (int i = 0; i < 3; i++)
                BuildPrimitive("FilterClothPanel_" + i, canopy, PrimitiveType.Cube,
                    new Vector3(0f, 0.54f + i * 0.025f, (i - 1) * 0.20f),
                    new Vector3(0.92f, 0.025f, 0.22f),
                    Quaternion.Euler(i == 1 ? 0f : (i == 0 ? -4f : 4f), 0f, 0f), cloth);
            BuildPrimitive("CanopyBeamNorth", canopy, PrimitiveType.Cube,
                new Vector3(0f, 0.52f, -0.30f), new Vector3(0.94f, 0.045f, 0.045f),
                Quaternion.identity, frame);
            BuildPrimitive("CanopyBeamSouth", canopy, PrimitiveType.Cube,
                new Vector3(0f, 0.52f, 0.30f), new Vector3(0.94f, 0.045f, 0.045f),
                Quaternion.identity, frame);
        }

        private static void BuildCeramicKilns(Transform parent, Material ceramic,
                                              Material dark)
        {
            Transform root = Child(parent, "CeramicLedge_Kilns_LANDMARK");
            Vector2[] positions = { new Vector2(267f, 141f), new Vector2(283f, 144f) };
            for (int i = 0; i < positions.Length; i++)
            {
                Transform kiln = Child(root, "CeramicKiln_" + i);
                kiln.position = MapToWorld(positions[i].x, positions[i].y)
                    + new Vector3(0f, 0.018f, 0f);
                kiln.rotation = Quaternion.Euler(0f, i == 0 ? 24f : -31f, 0f);
                BuildPrimitive("KilnDrum", kiln, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.14f, 0f), new Vector3(0.34f, 0.14f, 0.34f),
                    Quaternion.identity, ceramic);
                BuildPrimitive("KilnDome", kiln, PrimitiveType.Sphere,
                    new Vector3(0f, 0.28f, 0f), new Vector3(0.36f, 0.25f, 0.36f),
                    Quaternion.identity, ceramic);
                BuildPrimitive("KilnChimney", kiln, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.56f, 0f), new Vector3(0.075f, 0.22f, 0.075f),
                    Quaternion.identity, ceramic);
                BuildPrimitive("KilnMouth", kiln, PrimitiveType.Cube,
                    new Vector3(0f, 0.18f, -0.30f), new Vector3(0.16f, 0.19f, 0.045f),
                    Quaternion.identity, dark);
                BuildPrimitive("KilnStep", kiln, PrimitiveType.Cube,
                    new Vector3(0f, 0.045f, -0.38f), new Vector3(0.26f, 0.09f, 0.22f),
                    Quaternion.identity, ceramic);
            }
        }

        private static void BuildFilterRacks(Transform parent, Material frame,
                                             Material cloth)
        {
            Transform root = Child(parent, "ChalkSluice_FilterRacks_LANDMARK");
            int index = 0;
            for (int row = 0; row < 3; row++)
            {
                for (int column = 0; column < 4; column++)
                {
                    float mapX = 259f + column * 5.4f + row * 0.7f;
                    float mapY = 84f + row * 5.0f;
                    Transform rack = Child(root, "FilterRack_" + index.ToString("00"));
                    rack.position = MapToWorld(mapX, mapY) + new Vector3(0f, 0.015f, 0f);
                    rack.rotation = Quaternion.Euler(0f, -7f + row * 5f, 0f);
                    BuildPrimitive("PostLeft", rack, PrimitiveType.Cube,
                        new Vector3(-0.20f, 0.22f, 0f), new Vector3(0.035f, 0.44f, 0.035f),
                        Quaternion.identity, frame);
                    BuildPrimitive("PostRight", rack, PrimitiveType.Cube,
                        new Vector3(0.20f, 0.22f, 0f), new Vector3(0.035f, 0.44f, 0.035f),
                        Quaternion.identity, frame);
                    BuildPrimitive("Crossbar", rack, PrimitiveType.Cube,
                        new Vector3(0f, 0.42f, 0f), new Vector3(0.46f, 0.035f, 0.035f),
                        Quaternion.identity, frame);
                    BuildPrimitive("FilterCloth", rack, PrimitiveType.Cube,
                        new Vector3(0f, 0.24f, 0f), new Vector3(0.35f, 0.29f, 0.018f),
                        Quaternion.Euler(0f, 0f, column % 2 == 0 ? 3f : -3f), cloth);
                    index++;
                }
            }
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 localPosition,
                                           Vector3 localScale, Quaternion localRotation,
                                           Material material)
        {
            GameObject primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.localPosition = localPosition;
            primitive.transform.localRotation = localRotation;
            primitive.transform.localScale = localScale;
            Collider collider = primitive.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = primitive.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(primitive,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildMepMaterial(string assetPath, string sourcePath,
                                                 string name, Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(sourcePath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException("MEP Chalk Lowland material is unavailable: "
                    + sourcePath);
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

        private static Material BuildSolidMaterial(string assetPath, string name,
                                                   Color color, float metallic,
                                                   float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, assetPath);
            }
            else material.shader = shader;
            material.name = name;
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null && material.shader.isSupported,
                "material is missing or unsupported: " + path);
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
                "Kromka model iteration 11 validation failed: " + message);
        }
    }
}
#endif
