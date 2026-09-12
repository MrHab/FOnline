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
    /// Environment-model iteration 10/20. The outer Glasslands gains three
    /// large strategic silhouettes: Solar Field No.4, Object Vector and the
    /// split-dish clan relay B-9. These nodes complete the cold eastern sector
    /// established by Contour-3 without turning it into a uniform city block.
    /// </summary>
    internal static class KromkaGlobalMapGlasslandsLandmarkAuthoring
    {
        internal const int ModelIteration = 10;
        internal const int ModelIterationCount = 20;
        private const int ExpectedSolarPanelCount = 18;
        private const int ExpectedVectorRingSegmentCount = 24;
        private const int ExpectedSupportCount = 12;
        private const int ExpectedDishCount = 4;
        private const int ExpectedMachineCount = 5;
        private const int ExpectedFacilityCount = 3;
        private const int ExpectedMepRuinCount = 17;
        private const int ExpectedOuterNodeCount = 3;
        private const float WorldScale = 0.1f;
        private const float LoreOffsetX = -20f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string SpaceModelRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";

        private const string FacilityMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_ContourFacility.mat";
        private const string DishMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_ContourCeramic.mat";
        private const string MachineMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_ContourMachinery.mat";
        private const string SupportMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_LeaningSupports.mat";
        private const string MepRuinMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_MEP_Ruins.mat";
        private const string BeaconMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_ContourBeacon.mat";
        private const string SolarPanelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_SolarPanel.mat";
        private const string VectorRingMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Glasslands_VectorRing.mat";

        private const string SupportModel = SpaceModelRoot + "supports_high.fbx";

        private static readonly string[] DishModels =
        {
            SpaceModelRoot + "satelliteDish.fbx",
            SpaceModelRoot + "satelliteDish_detailed.fbx",
            SpaceModelRoot + "satelliteDish_large.fbx"
        };

        private static readonly string[] MachineModels =
        {
            SpaceModelRoot + "machine_generator.fbx",
            SpaceModelRoot + "machine_generatorLarge.fbx",
            SpaceModelRoot + "machine_wireless.fbx",
            SpaceModelRoot + "machine_wirelessCable.fbx"
        };

        private static readonly string[] FacilityModels =
        {
            SpaceModelRoot + "hangar_roundGlass.fbx",
            SpaceModelRoot + "structure_closed.fbx",
            SpaceModelRoot + "structure_detailed.fbx"
        };

        private static readonly string[] MepRuinPrefabs =
        {
            MepBuildingRoot + "MEP_StoneWall_01_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_01_N.prefab",
            MepBuildingRoot + "MEP_Fence_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_03_N.prefab",
            MepBuildingRoot + "MEP_Wall_01_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_01_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_02_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_03_N.prefab",
            MepCaveRoot + "MEP_C_ConcaveStone_N.prefab"
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
            public readonly float TiltX;
            public readonly float TiltZ;
            public readonly float Embed;

            public Placement(string name, string zone, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float tiltX,
                             float tiltZ, float embed)
            {
                Name = name;
                Zone = zone;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                TiltX = tiltX;
                TiltZ = tiltZ;
                Embed = embed;
            }
        }

        private static readonly Placement[] Supports =
        {
            new Placement("Solar4_LightningMastWest", "SolarField4", SupportModel,
                334f, 148f, 0.48f, 0.80f, -12f, 0f, 10f, 0.022f),
            new Placement("Solar4_LightningMastEast", "SolarField4", SupportModel,
                359f, 158f, 0.48f, 0.80f, 17f, -11f, 0f, 0.022f),

            new Placement("Vector_LatticeNorth", "ObjectVector", SupportModel,
                338f, 214f, 0.50f, 0.82f, 0f, 12f, 0f, 0.022f),
            new Placement("Vector_LatticeSouth", "ObjectVector", SupportModel,
                338f, 236f, 0.50f, 0.82f, 180f, -12f, 0f, 0.022f),
            new Placement("Vector_LatticeWest", "ObjectVector", SupportModel,
                327f, 225f, 0.50f, 0.82f, -90f, 0f, -13f, 0.022f),
            new Placement("Vector_LatticeEast", "ObjectVector", SupportModel,
                349f, 225f, 0.50f, 0.82f, 90f, 0f, 13f, 0.022f),
            new Placement("Vector_LatticeDiagonalNW", "ObjectVector", SupportModel,
                331f, 218f, 0.48f, 0.78f, -43f, 8f, -10f, 0.022f),
            new Placement("Vector_LatticeDiagonalSE", "ObjectVector", SupportModel,
                345f, 232f, 0.48f, 0.78f, 137f, -8f, 10f, 0.022f),

            new Placement("RelayB9_StormVaneNorth", "RelayB9", SupportModel,
                357f, 174f, 0.44f, 0.76f, -3f, 9f, 0f, 0.022f),
            new Placement("RelayB9_StormVaneEast", "RelayB9", SupportModel,
                368f, 184f, 0.44f, 0.76f, 84f, 0f, 11f, 0.022f),
            new Placement("RelayB9_StormVaneSouth", "RelayB9", SupportModel,
                359f, 195f, 0.44f, 0.76f, 176f, -10f, 0f, 0.022f),
            new Placement("RelayB9_StormVaneWest", "RelayB9", SupportModel,
                349f, 185f, 0.44f, 0.76f, -91f, 0f, -10f, 0.022f)
        };

        private static readonly Placement[] Dishes =
        {
            new Placement("Solar4_WeatherDish", "SolarField4", DishModels[0],
                360f, 149f, 0.42f, 0.50f, 28f, 0f, 0f, 0.016f),
            new Placement("RelayB9_SplitDishNorth", "RelayB9", DishModels[2],
                355f, 180f, 0.58f, 0.72f, -37f, 0f, 0f, 0.018f),
            new Placement("RelayB9_SplitDishSouth", "RelayB9", DishModels[2],
                362f, 188f, 0.56f, 0.70f, 143f, 0f, 0f, 0.018f),
            new Placement("RelayB9_TrackingDish", "RelayB9", DishModels[1],
                352f, 192f, 0.44f, 0.54f, 16f, 0f, 0f, 0.016f)
        };

        private static readonly Placement[] Machines =
        {
            new Placement("Solar4_InverterWest", "SolarField4", MachineModels[1],
                339f, 163f, 0.36f, 0.35f, -4f, 0f, 0f, 0.012f),
            new Placement("Solar4_InverterEast", "SolarField4", MachineModels[0],
                351f, 164f, 0.32f, 0.31f, 7f, 0f, 0f, 0.010f),
            new Placement("Vector_PhaseAnalyzer", "ObjectVector", MachineModels[2],
                351f, 224f, 0.34f, 0.37f, 34f, 0f, 0f, 0.010f),
            new Placement("RelayB9_StormReceiver", "RelayB9", MachineModels[3],
                347f, 178f, 0.32f, 0.34f, -18f, 0f, 0f, 0.010f),
            new Placement("RelayB9_BackupGenerator", "RelayB9", MachineModels[0],
                365f, 194f, 0.30f, 0.30f, 11f, 0f, 0f, 0.010f)
        };

        private static readonly Placement[] Facilities =
        {
            new Placement("Vector_BuriedResearchShell", "ObjectVector", FacilityModels[0],
                338f, 228f, 0.66f, 0.48f, 12f, 0f, 0f, 0.115f),
            new Placement("Vector_ImpossibleControlCell", "ObjectVector", FacilityModels[2],
                338f, 223f, 0.54f, 0.60f, -9f, 0f, 0f, 0.022f),
            new Placement("RelayB9_PressureBase", "RelayB9", FacilityModels[1],
                358f, 185f, 0.52f, 0.62f, 5f, 0f, 0f, 0.022f)
        };

        private static readonly Placement[] MepRuins =
        {
            new Placement("Solar4_FenceNW", "SolarField4", MepRuinPrefabs[2], 331f, 142f, 0.44f, 0.22f, 7f, 0f, 0f, 0.012f),
            new Placement("Solar4_FenceNorth", "SolarField4", MepRuinPrefabs[3], 344f, 140f, 0.44f, 0.22f, 1f, 0f, 0f, 0.012f),
            new Placement("Solar4_FenceNE", "SolarField4", MepRuinPrefabs[4], 358f, 143f, 0.44f, 0.22f, -11f, 0f, 0f, 0.012f),
            new Placement("Solar4_WallWest", "SolarField4", MepRuinPrefabs[0], 328f, 156f, 0.48f, 0.24f, 79f, 0f, 0f, 0.016f),
            new Placement("Solar4_WallSouth", "SolarField4", MepRuinPrefabs[5], 344f, 168f, 0.48f, 0.24f, -2f, 0f, 0f, 0.016f),
            new Placement("Solar4_RubbleEast", "SolarField4", MepRuinPrefabs[6], 363f, 163f, 0.46f, 0.30f, 22f, 0f, 0f, 0.024f),

            new Placement("Vector_RubbleNorth", "ObjectVector", MepRuinPrefabs[7], 338f, 211f, 0.48f, 0.31f, -8f, 0f, 0f, 0.026f),
            new Placement("Vector_ConcaveNorthEast", "ObjectVector", MepRuinPrefabs[9], 349f, 215f, 0.50f, 0.31f, 24f, 0f, 0f, 0.030f),
            new Placement("Vector_RubbleEast", "ObjectVector", MepRuinPrefabs[8], 353f, 227f, 0.48f, 0.31f, -31f, 0f, 0f, 0.026f),
            new Placement("Vector_RubbleSouth", "ObjectVector", MepRuinPrefabs[6], 339f, 240f, 0.48f, 0.31f, 17f, 0f, 0f, 0.026f),
            new Placement("Vector_ConcaveSouthWest", "ObjectVector", MepRuinPrefabs[9], 327f, 235f, 0.50f, 0.31f, -16f, 0f, 0f, 0.030f),
            new Placement("Vector_RubbleWest", "ObjectVector", MepRuinPrefabs[7], 323f, 224f, 0.48f, 0.31f, 37f, 0f, 0f, 0.026f),

            new Placement("RelayB9_WallNorth", "RelayB9", MepRuinPrefabs[0], 357f, 171f, 0.48f, 0.24f, -3f, 0f, 0f, 0.016f),
            new Placement("RelayB9_FenceEast", "RelayB9", MepRuinPrefabs[3], 370f, 184f, 0.44f, 0.22f, 81f, 0f, 0f, 0.012f),
            new Placement("RelayB9_WallSouth", "RelayB9", MepRuinPrefabs[1], 359f, 198f, 0.48f, 0.24f, 4f, 0f, 0f, 0.016f),
            new Placement("RelayB9_FenceWest", "RelayB9", MepRuinPrefabs[4], 345f, 185f, 0.44f, 0.22f, 83f, 0f, 0f, 0.012f),
            new Placement("RelayB9_RubbleSouthWest", "RelayB9", MepRuinPrefabs[8], 348f, 196f, 0.46f, 0.30f, -26f, 0f, 0f, 0.024f)
        };

        internal static void Compose(Transform parent)
        {
            Material facility = RequireMaterial(FacilityMaterialPath);
            Material dishes = RequireMaterial(DishMaterialPath);
            Material machines = RequireMaterial(MachineMaterialPath);
            Material supports = RequireMaterial(SupportMaterialPath);
            Material mep = RequireMaterial(MepRuinMaterialPath);
            Material beacon = RequireMaterial(BeaconMaterialPath);
            Material solar = BuildEmissiveMaterial(SolarPanelMaterialPath,
                "Kromka_Glasslands_SolarPanel", new Color(0.035f, 0.17f, 0.20f, 1f),
                new Color(0.02f, 0.28f, 0.34f, 1f), 0.46f, 0.62f);
            Material vector = BuildEmissiveMaterial(VectorRingMaterialPath,
                "Kromka_Glasslands_VectorRing", new Color(0.08f, 0.42f, 0.43f, 1f),
                new Color(0.06f, 0.52f, 0.58f, 1f), 0.30f, 0.42f);

            Transform root = Child(parent, "Glasslands_OuterLandmarks_MEP_Kenney");
            PlaceSet(Supports, Child(root, "OuterSupportArrays_EDITABLE"), supports);
            PlaceSet(Dishes, Child(root, "OuterDishArrays_EDITABLE"), dishes);
            PlaceSet(Machines, Child(root, "OuterMachines_EDITABLE"), machines);
            PlaceSet(Facilities, Child(root, "OuterFacilities_EDITABLE"), facility);
            PlaceSet(MepRuins, Child(root, "OuterMEPRuins_EDITABLE"), mep);
            BuildSolarField(root, solar, supports);
            BuildVectorRings(root, vector, supports, beacon);
            BuildRelayTower(root, facility, dishes, beacon);

            Child(parent, "GlasslandsOuterNodes_3_REFERENCE");
            Child(parent, "SolarField4Panels_18_REFERENCE");
            Child(parent, "VectorRingSegments_24_REFERENCE");
            Child(parent, "OuterScienceSupports_12_REFERENCE");
            Child(parent, "OuterScienceDishes_4_REFERENCE");
            Child(parent, "OuterScienceMachines_5_REFERENCE");
            Child(parent, "OuterScienceFacilities_3_REFERENCE");
            Child(parent, "DirectMEPOuterRuins_17_REFERENCE");
            Child(parent, "RelayB9SplitDishes_3_REFERENCE");
            Child(parent, "ObjectVectorImpossibleLattice_1_REFERENCE");
            Child(parent, "PersistentOuterGlasslandsGeometry_REFERENCE");
            Child(parent, "ModelIteration_10_of_20");
        }

        internal static void ValidateIteration10()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 10 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "GlasslandsOuterNodes_3_REFERENCE", "SolarField4Panels_18_REFERENCE",
                "VectorRingSegments_24_REFERENCE", "OuterScienceSupports_12_REFERENCE",
                "OuterScienceDishes_4_REFERENCE", "OuterScienceMachines_5_REFERENCE",
                "OuterScienceFacilities_3_REFERENCE", "DirectMEPOuterRuins_17_REFERENCE",
                "RelayB9SplitDishes_3_REFERENCE",
                "ObjectVectorImpossibleLattice_1_REFERENCE",
                "PersistentOuterGlasslandsGeometry_REFERENCE", "ModelIteration_10_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Require(Supports.Length == ExpectedSupportCount,
                "twelve outer Glasslands supports are required");
            Require(Dishes.Length == ExpectedDishCount,
                "four outer Glasslands dishes are required");
            Require(Machines.Length == ExpectedMachineCount,
                "five outer Glasslands machines are required");
            Require(Facilities.Length == ExpectedFacilityCount,
                "three outer Glasslands facilities are required");
            Require(MepRuins.Length == ExpectedMepRuinCount,
                "seventeen outer Glasslands MEP ruins are required");

            Transform belt = FindDescendant(root, "Glasslands_OuterLandmarks_MEP_Kenney");
            Transform supportRoot = FindDescendant(belt, "OuterSupportArrays_EDITABLE");
            Transform dishRoot = FindDescendant(belt, "OuterDishArrays_EDITABLE");
            Transform machineRoot = FindDescendant(belt, "OuterMachines_EDITABLE");
            Transform facilityRoot = FindDescendant(belt, "OuterFacilities_EDITABLE");
            Transform mepRoot = FindDescendant(belt, "OuterMEPRuins_EDITABLE");
            Require(supportRoot != null && supportRoot.childCount == ExpectedOuterNodeCount,
                "supports must define all three outer Glasslands nodes");
            Require(dishRoot != null && dishRoot.childCount == 2,
                "dishes must remain limited to Solar Field No.4 and relay B-9");
            Require(machineRoot != null && machineRoot.childCount == ExpectedOuterNodeCount,
                "machines must define all three outer Glasslands nodes");
            Require(facilityRoot != null && facilityRoot.childCount == 2,
                "facilities must remain limited to Object Vector and relay B-9");
            Require(mepRoot != null && mepRoot.childCount == ExpectedOuterNodeCount,
                "MEP ruins must ground all three outer Glasslands nodes");

            Material facility = RequireMaterial(FacilityMaterialPath);
            Material dishes = RequireMaterial(DishMaterialPath);
            Material machines = RequireMaterial(MachineMaterialPath);
            Material supports = RequireMaterial(SupportMaterialPath);
            Material mep = RequireMaterial(MepRuinMaterialPath);
            ValidateSet(supportRoot, Supports, supports, SpaceModelRoot,
                new[] { SupportModel });
            ValidateSet(dishRoot, Dishes, dishes, SpaceModelRoot, DishModels);
            ValidateSet(machineRoot, Machines, machines, SpaceModelRoot, MachineModels);
            ValidateSet(facilityRoot, Facilities, facility, SpaceModelRoot,
                FacilityModels);
            ValidateSet(mepRoot, MepRuins, mep, "Assets/MEP/", MepRuinPrefabs);

            Transform panelField = FindDescendant(belt, "SolarField4_PanelField_LANDMARK");
            Require(panelField != null && panelField.childCount == ExpectedSolarPanelCount,
                "Solar Field No.4 must retain eighteen panel tables");
            Require(panelField.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedSolarPanelCount * 3,
                "Solar Field No.4 panel silhouettes are incomplete");
            Transform rings = FindDescendant(belt, "ObjectVector_BuriedRings_EDITABLE");
            Require(rings != null && rings.childCount == 2,
                "Object Vector must retain two buried field rings");
            Require(rings.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedVectorRingSegmentCount,
                "Object Vector ring segments are incomplete");
            Transform lattice = FindDescendant(belt,
                "ObjectVector_ImpossibleLattice_LANDMARK");
            Require(lattice != null
                    && lattice.GetComponentsInChildren<Renderer>(true).Length == 9,
                "Object Vector impossible lattice silhouette is incomplete");
            Transform relay = FindDescendant(belt, "RelayB9_SealedMast_LANDMARK");
            Require(relay != null
                    && relay.GetComponentsInChildren<Renderer>(true).Length == 7,
                "relay B-9 sealed mast silhouette is incomplete");
            Require(belt.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "outer Glasslands geometry can obstruct strategic-map interaction");
            Require(belt.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "outer Glasslands geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 50%] PASS: Solar Field No.4, Object Vector "
                + "and relay B-9 complete the outer Glasslands with eighteen panel "
                + "tables, two buried field rings, split dishes and seventeen direct "
                + "MEP ruins.");
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
                        AdjustedMapX(placement.MapX), placement.MapY,
                        placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(resolvedMaterial,
                        renderers[rendererIndex].sharedMaterials.Length).ToArray();
                if (Mathf.Abs(placement.TiltX) > 0.01f
                    || Mathf.Abs(placement.TiltZ) > 0.01f)
                {
                    instance.transform.rotation = Quaternion.Euler(placement.TiltX,
                        placement.Yaw, placement.TiltZ);
                    SeatAfterTilt(instance, placement);
                }
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        Material material, string sourceRoot,
                                        string[] expectedSources)
        {
            var sources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Require(placement.MapX >= 320f && placement.MapX <= 372f
                        && placement.MapY >= 138f && placement.MapY <= 242f,
                    placement.Name + " is outside the reviewed outer Glasslands");
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath
                        && source.StartsWith(sourceRoot, StringComparison.Ordinal),
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
                    AdjustedMapX(placement.MapX), placement.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is not grounded on the authored relief");
                Require(bounds.size.y <= placement.MaximumHeight + 0.14f,
                    placement.Name + " is too tall for the strategic-map scale");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    placement.Name + " can obstruct strategic-map interaction");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    placement.Name + " can disappear with camera distance");
            }
            Require(sources.SetEquals(expectedSources),
                "a reviewed outer Glasslands source set is incomplete");
        }

        private static void BuildSolarField(Transform parent, Material panelMaterial,
                                            Material frameMaterial)
        {
            Transform root = Child(parent, "SolarField4_PanelField_LANDMARK");
            int index = 0;
            float[] rows = { 146f, 153f, 160f };
            for (int row = 0; row < rows.Length; row++)
            {
                for (int column = 0; column < 6; column++)
                {
                    float mapX = 333f + column * 5.0f + row * 0.8f;
                    float mapY = rows[row] + (column % 2 == 0 ? -0.5f : 0.5f);
                    Transform panel = Child(root, "SolarPanelTable_" + index.ToString("00"));
                    panel.position = MapToWorld(mapX, mapY);
                    panel.rotation = Quaternion.Euler(0f, -8f + row * 5f, 0f);
                    BuildPrimitive("DarkPanel", panel, PrimitiveType.Cube,
                        new Vector3(0f, 0.14f, 0f), new Vector3(0.42f, 0.035f, 0.27f),
                        Quaternion.Euler(-14f, 0f, 0f), panelMaterial);
                    BuildPrimitive("SupportLeg", panel, PrimitiveType.Cube,
                        new Vector3(0f, 0.075f, 0f), new Vector3(0.055f, 0.15f, 0.055f),
                        Quaternion.identity, frameMaterial);
                    BuildPrimitive("GroundFoot", panel, PrimitiveType.Cube,
                        new Vector3(0f, 0.018f, 0f), new Vector3(0.18f, 0.035f, 0.10f),
                        Quaternion.identity, frameMaterial);
                    index++;
                }
            }
        }

        private static void BuildVectorRings(Transform parent, Material ringMaterial,
                                             Material frameMaterial,
                                             Material beaconMaterial)
        {
            Vector3 centre = MapToWorld(338f, 225f);
            Transform ringRoot = Child(parent, "ObjectVector_BuriedRings_EDITABLE");
            ringRoot.position = centre;
            for (int ring = 0; ring < 2; ring++)
            {
                Transform group = Child(ringRoot, "BuriedFieldRing_" + ring);
                float radius = ring == 0 ? 0.72f : 1.18f;
                float length = 2f * Mathf.PI * radius / 12f * 0.82f;
                for (int segment = 0; segment < 12; segment++)
                {
                    float angle = segment * 30f + (ring == 0 ? 5f : -3f);
                    float radians = angle * Mathf.Deg2Rad;
                    Vector3 position = new Vector3(Mathf.Cos(radians) * radius,
                        0.045f + (segment % 3) * 0.006f,
                        Mathf.Sin(radians) * radius);
                    BuildPrimitive("RingSegment_" + segment.ToString("00"), group,
                        PrimitiveType.Cube, position,
                        new Vector3(length, 0.035f, 0.075f),
                        Quaternion.Euler(0f, -angle + 90f, 0f), ringMaterial);
                }
            }

            Transform lattice = Child(parent, "ObjectVector_ImpossibleLattice_LANDMARK");
            lattice.position = centre + new Vector3(0f, 0.02f, 0f);
            for (int i = 0; i < 6; i++)
            {
                float yaw = i * 60f;
                float radians = yaw * Mathf.Deg2Rad;
                BuildPrimitive("InclinedFieldBeam_" + i, lattice, PrimitiveType.Cube,
                    new Vector3(Mathf.Cos(radians) * 0.16f, 0.42f,
                        Mathf.Sin(radians) * 0.16f),
                    new Vector3(0.075f, 0.84f, 0.075f),
                    Quaternion.Euler(i % 2 == 0 ? 34f : -34f, yaw,
                        i % 3 == 0 ? 18f : -18f), frameMaterial);
            }
            for (int i = 0; i < 2; i++)
                BuildPrimitive("CrossPhaseBeam_" + i, lattice, PrimitiveType.Cube,
                    new Vector3(0f, 0.43f + i * 0.16f, 0f),
                    new Vector3(0.92f - i * 0.16f, 0.065f, 0.065f),
                    Quaternion.Euler(i == 0 ? 17f : -19f, i * 90f + 25f,
                        i == 0 ? 8f : -8f), frameMaterial);
            BuildPrimitive("VectorColdCore", lattice, PrimitiveType.Sphere,
                new Vector3(0f, 0.50f, 0f), new Vector3(0.16f, 0.16f, 0.16f),
                Quaternion.identity, beaconMaterial);
        }

        private static void BuildRelayTower(Transform parent, Material facility,
                                            Material ceramic, Material beacon)
        {
            Transform root = Child(parent, "RelayB9_SealedMast_LANDMARK");
            root.position = MapToWorld(358f, 184f);
            BuildPrimitive("RelayBase", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.10f, 0f), new Vector3(0.29f, 0.10f, 0.29f),
                Quaternion.identity, facility);
            BuildPrimitive("RelayPressureCore", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.51f, 0f), new Vector3(0.20f, 0.41f, 0.20f),
                Quaternion.identity, facility);
            BuildPrimitive("RelayCollar", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.88f, 0f), new Vector3(0.30f, 0.055f, 0.30f),
                Quaternion.identity, ceramic);
            BuildPrimitive("RelayCap", root, PrimitiveType.Sphere,
                new Vector3(0f, 1.02f, 0f), new Vector3(0.20f, 0.13f, 0.20f),
                Quaternion.identity, ceramic);
            for (int i = 0; i < 2; i++)
                BuildPrimitive("StormVaneArm_" + i, root, PrimitiveType.Cube,
                    new Vector3(0f, 0.84f + i * 0.10f, 0f),
                    new Vector3(0.72f - i * 0.14f, 0.045f, 0.045f),
                    Quaternion.Euler(0f, 31f + i * 90f, i == 0 ? 7f : -7f), facility);
            BuildPrimitive("RelayPulse", root, PrimitiveType.Sphere,
                new Vector3(0f, 1.19f, 0f), new Vector3(0.075f, 0.075f, 0.075f),
                Quaternion.identity, beacon);
        }

        private static Material BuildEmissiveMaterial(string path, string name,
                                                      Color baseColor,
                                                      Color emissionColor,
                                                      float metallic,
                                                      float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetTexture("_BaseMap", null);
            material.SetColor("_BaseColor", baseColor);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", emissionColor * 1.45f);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type,
                                           Vector3 localPosition, Vector3 scale,
                                           Quaternion rotation, Material material)
        {
            GameObject item = GameObject.CreatePrimitive(type);
            item.name = name;
            item.transform.SetParent(parent, false);
            item.transform.localPosition = localPosition;
            item.transform.localRotation = rotation;
            item.transform.localScale = scale;
            Collider collider = item.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = item.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(item,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static void SeatAfterTilt(GameObject instance, Placement placement)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Bounds bounds = Encapsulate(renderers);
            Vector3 target = MapToWorld(placement.MapX, placement.MapY);
            instance.transform.position += new Vector3(target.x - bounds.center.x,
                target.y - placement.Embed - bounds.min.y,
                target.z - bounds.center.z);
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null, "material is missing: " + path);
            return material;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            float adjustedX = AdjustedMapX(mapX);
            return new Vector3((adjustedX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(adjustedX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static float AdjustedMapX(float mapX)
        {
            return mapX + LoreOffsetX;
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
                    "Kromka model iteration 10 validation failed: " + message);
        }
    }
}
#endif
