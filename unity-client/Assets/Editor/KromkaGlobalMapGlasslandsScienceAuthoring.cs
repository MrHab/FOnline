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
    /// Environment-model iteration 09/20. The Glasslands receives its first
    /// authored science belt: Contour-3 is the dominant sealed complex,
    /// Perimeter K-3 controls the western approach, and the experimental
    /// workshop survives as a smaller eastern satellite among leaning pylons.
    /// </summary>
    internal static class KromkaGlobalMapGlasslandsScienceAuthoring
    {
        internal const int ModelIteration = 9;
        internal const int ModelIterationCount = 20;
        private const int ExpectedFacilityCount = 12;
        private const int ExpectedDishCount = 5;
        private const int ExpectedMachineCount = 10;
        private const int ExpectedSupportCount = 7;
        private const int ExpectedMepRuinCount = 18;
        private const int ExpectedNamedNodeCount = 3;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/";
        private const string SpaceModelRoot = SpaceRoot + "Models/";
        private const string SpaceLicensePath = SpaceRoot + "License.txt";
        private const string SpaceReadmePath = SpaceRoot + "README.md";
        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string MepSourceMaterialPath =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";

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

        private static readonly string[] FacilityModels =
        {
            SpaceModelRoot + "gate_complex.fbx",
            SpaceModelRoot + "hangar_largeA.fbx",
            SpaceModelRoot + "hangar_largeB.fbx",
            SpaceModelRoot + "hangar_roundGlass.fbx",
            SpaceModelRoot + "hangar_smallA.fbx",
            SpaceModelRoot + "hangar_smallB.fbx",
            SpaceModelRoot + "structure_closed.fbx",
            SpaceModelRoot + "structure_detailed.fbx",
            SpaceModelRoot + "corridor_detailed.fbx",
            SpaceModelRoot + "corridor_open.fbx"
        };

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
            SpaceModelRoot + "machine_wirelessCable.fbx",
            SpaceModelRoot + "pipe_cornerRoundLarge.fbx",
            SpaceModelRoot + "pipe_split.fbx",
            SpaceModelRoot + "pipe_straight.fbx"
        };

        private const string SupportModel = SpaceModelRoot + "supports_high.fbx";

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

        private static readonly Placement[] Facilities =
        {
            new Placement("Contour3_DispatchDome", "Contour3", FacilityModels[3],
                300f, 181f, 1.00f, 0.72f, 4f, 0f, 0f, 0.025f),
            new Placement("Contour3_WestSealedHall", "Contour3", FacilityModels[1],
                289f, 181f, 0.80f, 0.55f, -4f, 0f, 0f, 0.022f),
            new Placement("Contour3_EastSealedHall", "Contour3", FacilityModels[2],
                312f, 184f, 0.82f, 0.56f, 7f, 0f, 0f, 0.022f),
            new Placement("Contour3_AirlockGate", "Contour3", FacilityModels[0],
                300f, 194f, 0.62f, 0.58f, 3f, 0f, 0f, 0.018f),
            new Placement("Contour3_NorthServiceGallery", "Contour3", FacilityModels[8],
                297f, 169f, 0.60f, 0.34f, 88f, 0f, 0f, 0.014f),
            new Placement("Contour3_BrokenEastGallery", "Contour3", FacilityModels[9],
                310f, 172f, 0.55f, 0.34f, -82f, 0f, 0f, 0.014f),

            new Placement("PerimeterK3_DeconGate", "PerimeterK3", FacilityModels[0],
                272f, 205f, 0.70f, 0.64f, -21f, 0f, 0f, 0.020f),
            new Placement("PerimeterK3_FilterBarracks", "PerimeterK3", FacilityModels[4],
                264f, 211f, 0.60f, 0.46f, -15f, 0f, 0f, 0.018f),
            new Placement("PerimeterK3_SealControl", "PerimeterK3", FacilityModels[6],
                280f, 213f, 0.56f, 0.58f, 15f, 0f, 0f, 0.018f),

            new Placement("ExperimentalWorkshop_MainHall", "ExperimentalWorkshop", FacilityModels[5],
                330f, 196f, 0.72f, 0.48f, -18f, 0f, 0f, 0.020f),
            new Placement("ExperimentalWorkshop_TestCell", "ExperimentalWorkshop", FacilityModels[7],
                338f, 202f, 0.54f, 0.62f, -12f, 0f, 0f, 0.018f),
            new Placement("ExperimentalWorkshop_BreachedGallery", "ExperimentalWorkshop", FacilityModels[9],
                324f, 205f, 0.54f, 0.33f, 72f, 0f, 0f, 0.014f)
        };

        private static readonly Placement[] Dishes =
        {
            new Placement("Contour3_WestDeepDish", "Contour3", DishModels[2],
                288f, 169f, 0.72f, 0.88f, -18f, 0f, 0f, 0.018f),
            new Placement("Contour3_CentralTrackingDish", "Contour3", DishModels[1],
                301f, 165f, 0.56f, 0.64f, 12f, 0f, 0f, 0.018f),
            new Placement("Contour3_EastTelemetryDish", "Contour3", DishModels[0],
                314f, 171f, 0.48f, 0.56f, 33f, 0f, 0f, 0.016f),
            new Placement("PerimeterK3_WarningDish", "PerimeterK3", DishModels[0],
                268f, 198f, 0.42f, 0.50f, -35f, 0f, 0f, 0.016f),
            new Placement("ExperimentalWorkshop_FoldDish", "ExperimentalWorkshop", DishModels[1],
                336f, 188f, 0.48f, 0.58f, 19f, 0f, 0f, 0.016f)
        };

        private static readonly Placement[] Machines =
        {
            new Placement("Contour3_WestGenerator", "Contour3", MachineModels[1],
                286f, 190f, 0.40f, 0.38f, -8f, 0f, 0f, 0.012f),
            new Placement("Contour3_EastGenerator", "Contour3", MachineModels[0],
                313f, 193f, 0.36f, 0.33f, 16f, 0f, 0f, 0.012f),
            new Placement("Contour3_WirelessRack", "Contour3", MachineModels[2],
                317f, 180f, 0.30f, 0.34f, 24f, 0f, 0f, 0.010f),
            new Placement("Contour3_CableAnalyzer", "Contour3", MachineModels[3],
                282f, 178f, 0.34f, 0.34f, -17f, 0f, 0f, 0.010f),
            new Placement("Contour3_ServicePipe", "Contour3", MachineModels[6],
                292f, 191f, 0.52f, 0.22f, 3f, 0f, 0f, 0.010f),
            new Placement("Contour3_SplitPipe", "Contour3", MachineModels[5],
                307f, 191f, 0.45f, 0.23f, -6f, 0f, 0f, 0.010f),
            new Placement("ExperimentalWorkshop_ReturnPipe", "ExperimentalWorkshop", MachineModels[4],
                322f, 198f, 0.48f, 0.24f, 12f, 0f, 0f, 0.010f),
            new Placement("ExperimentalWorkshop_FieldGenerator", "ExperimentalWorkshop", MachineModels[1],
                328f, 188f, 0.36f, 0.36f, -12f, 0f, 0f, 0.012f),
            new Placement("PerimeterK3_DeconGenerator", "PerimeterK3", MachineModels[0],
                276f, 215f, 0.32f, 0.31f, 21f, 0f, 0f, 0.010f),
            new Placement("ExperimentalWorkshop_CableSpire", "ExperimentalWorkshop", MachineModels[3],
                340f, 194f, 0.30f, 0.34f, 31f, 0f, 0f, 0.010f)
        };

        private static readonly Placement[] LeaningSupports =
        {
            new Placement("GlassGrid_NorthWest", "GlassGrid", SupportModel,
                253f, 229f, 0.50f, 0.78f, -8f, 0f, 15f, 0.022f),
            new Placement("GlassGrid_NorthGate", "GlassGrid", SupportModel,
                267f, 229f, 0.50f, 0.78f, 12f, -9f, 0f, 0.022f),
            new Placement("GlassGrid_VectorApproach", "GlassGrid", SupportModel,
                337f, 225f, 0.52f, 0.82f, -17f, 0f, -18f, 0.022f),
            new Placement("GlassGrid_RelayEast", "GlassGrid", SupportModel,
                348f, 212f, 0.52f, 0.82f, 21f, 12f, 0f, 0.022f),
            new Placement("GlassGrid_StormEast", "GlassGrid", SupportModel,
                353f, 171f, 0.50f, 0.80f, -27f, 0f, 16f, 0.022f),
            new Placement("GlassGrid_SolarNorth", "GlassGrid", SupportModel,
                329f, 154f, 0.50f, 0.80f, 11f, -14f, 0f, 0.022f),
            new Placement("GlassGrid_SolarWest", "GlassGrid", SupportModel,
                279f, 154f, 0.48f, 0.78f, -19f, 0f, -13f, 0.022f)
        };

        private static readonly Placement[] MepRuins =
        {
            new Placement("Contour3_RuinWallNW", "Contour3", MepRuinPrefabs[0], 284f, 178f, 0.48f, 0.25f, -16f, 0f, 0f, 0.016f),
            new Placement("Contour3_RuinWallNorth", "Contour3", MepRuinPrefabs[1], 291f, 173f, 0.50f, 0.25f, -7f, 0f, 0f, 0.016f),
            new Placement("Contour3_RuinFenceNE", "Contour3", MepRuinPrefabs[2], 310f, 175f, 0.44f, 0.22f, 18f, 0f, 0f, 0.012f),
            new Placement("Contour3_RuinFenceEast", "Contour3", MepRuinPrefabs[3], 319f, 183f, 0.44f, 0.22f, 76f, 0f, 0f, 0.012f),
            new Placement("Contour3_RuinFenceSE", "Contour3", MepRuinPrefabs[4], 317f, 193f, 0.44f, 0.22f, -32f, 0f, 0f, 0.012f),
            new Placement("Contour3_RuinWallSouth", "Contour3", MepRuinPrefabs[5], 307f, 199f, 0.48f, 0.24f, 4f, 0f, 0f, 0.016f),
            new Placement("Contour3_GlassEatenRubbleW", "Contour3", MepRuinPrefabs[6], 287f, 198f, 0.46f, 0.30f, 31f, 0f, 0f, 0.024f),
            new Placement("Contour3_GlassEatenRubbleSW", "Contour3", MepRuinPrefabs[7], 280f, 190f, 0.46f, 0.30f, -21f, 0f, 0f, 0.024f),

            new Placement("PerimeterK3_RuinWest", "PerimeterK3", MepRuinPrefabs[0], 259f, 205f, 0.48f, 0.24f, 68f, 0f, 0f, 0.016f),
            new Placement("PerimeterK3_FenceNorth", "PerimeterK3", MepRuinPrefabs[2], 264f, 218f, 0.44f, 0.22f, 10f, 0f, 0f, 0.012f),
            new Placement("PerimeterK3_FenceNE", "PerimeterK3", MepRuinPrefabs[4], 276f, 221f, 0.44f, 0.22f, -13f, 0f, 0f, 0.012f),
            new Placement("PerimeterK3_RubbleEast", "PerimeterK3", MepRuinPrefabs[8], 284f, 211f, 0.46f, 0.31f, 27f, 0f, 0f, 0.024f),
            new Placement("PerimeterK3_ConcaveBlast", "PerimeterK3", MepRuinPrefabs[9], 281f, 201f, 0.48f, 0.30f, -9f, 0f, 0f, 0.028f),

            new Placement("ExperimentalWorkshop_RubbleWest", "ExperimentalWorkshop", MepRuinPrefabs[6], 320f, 190f, 0.44f, 0.29f, 13f, 0f, 0f, 0.024f),
            new Placement("ExperimentalWorkshop_RuinWallSouth", "ExperimentalWorkshop", MepRuinPrefabs[1], 328f, 210f, 0.48f, 0.24f, 8f, 0f, 0f, 0.016f),
            new Placement("ExperimentalWorkshop_RubbleSE", "ExperimentalWorkshop", MepRuinPrefabs[7], 338f, 212f, 0.44f, 0.29f, -24f, 0f, 0f, 0.024f),
            new Placement("ExperimentalWorkshop_FenceEast", "ExperimentalWorkshop", MepRuinPrefabs[3], 346f, 202f, 0.44f, 0.22f, 73f, 0f, 0f, 0.012f),
            new Placement("ExperimentalWorkshop_ConcaveNorth", "ExperimentalWorkshop", MepRuinPrefabs[9], 343f, 190f, 0.46f, 0.29f, 36f, 0f, 0f, 0.028f)
        };

        internal static void Compose(Transform parent)
        {
            ConfigureImportedAssets();
            Material facility = BuildSolidMaterial(FacilityMaterialPath,
                "Kromka_Glasslands_ContourFacility",
                new Color(0.28f, 0.36f, 0.36f, 1f), 0.46f, 0.20f);
            Material ceramic = BuildSolidMaterial(DishMaterialPath,
                "Kromka_Glasslands_ContourCeramic",
                new Color(0.58f, 0.70f, 0.69f, 1f), 0.34f, 0.30f);
            Material machinery = BuildSolidMaterial(MachineMaterialPath,
                "Kromka_Glasslands_ContourMachinery",
                new Color(0.18f, 0.34f, 0.33f, 1f), 0.54f, 0.18f);
            Material supports = BuildSolidMaterial(SupportMaterialPath,
                "Kromka_Glasslands_LeaningSupports",
                new Color(0.23f, 0.28f, 0.27f, 1f), 0.58f, 0.15f);
            Material mep = BuildMepRuinMaterial();
            Material beacon = BuildBeaconMaterial();

            Transform root = Child(parent, "Glasslands_ScienceBelt_MEP_Kenney");
            PlaceSet(Facilities, Child(root, "ThreeNamedScienceNodes_EDITABLE"), facility);
            PlaceSet(Dishes, Child(root, "DishArray_EDITABLE"), ceramic);
            PlaceSet(Machines, Child(root, "ScientificMachinery_EDITABLE"), machinery);
            PlaceSet(LeaningSupports, Child(root, "LeaningSupportGrid_EDITABLE"), supports);
            PlaceSet(MepRuins, Child(root, "DirectMEPRuins_EDITABLE"), mep);
            BuildSealedTower(root, facility, ceramic, beacon);

            Child(parent, "GlasslandsNamedScienceNodes_3_REFERENCE");
            Child(parent, "ContourFacilities_12_REFERENCE");
            Child(parent, "ContourDishes_5_REFERENCE");
            Child(parent, "ContourMachines_10_REFERENCE");
            Child(parent, "LeaningScienceSupports_7_REFERENCE");
            Child(parent, "DirectMEPGlasslandRuins_18_REFERENCE");
            Child(parent, "Contour3SealedTower_1_REFERENCE");
            Child(parent, "KenneySpaceKit10_CC0_REFERENCE");
            Child(parent, "PersistentGlasslandsScienceGeometry_REFERENCE");
            Child(parent, "ModelIteration_09_of_20");
        }

        internal static void ValidateIteration09()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 09 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "GlasslandsNamedScienceNodes_3_REFERENCE",
                "ContourFacilities_12_REFERENCE", "ContourDishes_5_REFERENCE",
                "ContourMachines_10_REFERENCE", "LeaningScienceSupports_7_REFERENCE",
                "DirectMEPGlasslandRuins_18_REFERENCE", "Contour3SealedTower_1_REFERENCE",
                "KenneySpaceKit10_CC0_REFERENCE",
                "PersistentGlasslandsScienceGeometry_REFERENCE",
                "ModelIteration_09_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Require(Facilities.Length == ExpectedFacilityCount,
                "twelve Glasslands facility models are required");
            Require(Dishes.Length == ExpectedDishCount,
                "five science dishes are required");
            Require(Machines.Length == ExpectedMachineCount,
                "ten science machines are required");
            Require(LeaningSupports.Length == ExpectedSupportCount,
                "seven leaning supports are required");
            Require(MepRuins.Length == ExpectedMepRuinCount,
                "eighteen direct MEP ruins are required");
            Require(AssetDatabase.LoadAssetAtPath<TextAsset>(SpaceLicensePath) != null
                    && AssetDatabase.LoadAssetAtPath<TextAsset>(SpaceReadmePath) != null,
                "Kenney Space Kit provenance is incomplete");

            Transform belt = FindDescendant(root, "Glasslands_ScienceBelt_MEP_Kenney");
            Transform facilityRoot = FindDescendant(belt, "ThreeNamedScienceNodes_EDITABLE");
            Transform dishRoot = FindDescendant(belt, "DishArray_EDITABLE");
            Transform machineRoot = FindDescendant(belt, "ScientificMachinery_EDITABLE");
            Transform supportRoot = FindDescendant(belt, "LeaningSupportGrid_EDITABLE");
            Transform mepRoot = FindDescendant(belt, "DirectMEPRuins_EDITABLE");
            Require(facilityRoot != null && facilityRoot.childCount == ExpectedNamedNodeCount,
                "the three named Glasslands science nodes are incomplete");
            Require(dishRoot != null && dishRoot.childCount == ExpectedNamedNodeCount,
                "dishes must remain distributed across the three science nodes");
            Require(machineRoot != null && machineRoot.childCount == ExpectedNamedNodeCount,
                "machines must remain distributed across the three science nodes");
            Require(supportRoot != null && supportRoot.childCount == 1,
                "the leaning support grid group is incomplete");
            Require(mepRoot != null && mepRoot.childCount == ExpectedNamedNodeCount,
                "MEP ruins must bind all three science nodes to the terrain");

            Material facility = RequireMaterial(FacilityMaterialPath);
            Material ceramic = RequireMaterial(DishMaterialPath);
            Material machinery = RequireMaterial(MachineMaterialPath);
            Material supports = RequireMaterial(SupportMaterialPath);
            Material mep = RequireMaterial(MepRuinMaterialPath);
            Material beacon = RequireMaterial(BeaconMaterialPath);
            Require(facility.GetTexture("_BaseMap") == null
                    && ceramic.GetTexture("_BaseMap") == null
                    && machinery.GetTexture("_BaseMap") == null,
                "reviewed muted science materials must not regain the bright source palette");

            ValidateSet(facilityRoot, Facilities, facility, SpaceModelRoot,
                FacilityModels);
            ValidateSet(dishRoot, Dishes, ceramic, SpaceModelRoot, DishModels);
            ValidateSet(machineRoot, Machines, machinery, SpaceModelRoot,
                MachineModels);
            ValidateSet(supportRoot, LeaningSupports, supports, SpaceModelRoot,
                new[] { SupportModel });
            ValidateSet(mepRoot, MepRuins, mep, "Assets/MEP/", MepRuinPrefabs);

            Transform tower = FindDescendant(belt, "Contour3_SealedTower_LANDMARK");
            Require(tower != null, "Contour-3 sealed tower is missing");
            Renderer[] towerRenderers = tower.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(towerRenderers.Length == 10,
                "Contour-3 sealed tower silhouette is incomplete");
            Require(towerRenderers.Any(renderer => renderer.sharedMaterial == beacon),
                "Contour-3 tower lost its cyan warning beacon");
            Require(tower.GetComponentsInChildren<Collider>(true).Length == 0,
                "Contour-3 tower can obstruct strategic-map interaction");

            Debug.Log("[KROMKA MODELS 45%] PASS: Contour-3, Perimeter K-3 and the "
                + "experimental workshop form a three-node Glasslands science belt; "
                + "five CC0 Kenney dishes, seven leaning supports and eighteen direct "
                + "MEP ruins preserve the sealed post-war silhouette.");
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
                Require(placement.MapX >= 250f && placement.MapX <= 355f
                        && placement.MapY >= 150f && placement.MapY <= 232f,
                    placement.Name + " is outside the reviewed Glasslands shelf");
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
                Require(renderers.Length > 0, placement.Name + " has no visible renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == resolvedMaterial)),
                    placement.Name + " lost its strategic-map material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
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
                "a reviewed Glasslands source set is incomplete");
        }

        private static void ConfigureImportedAssets()
        {
            string[] sources = FacilityModels.Concat(DishModels).Concat(MachineModels)
                .Concat(new[] { SupportModel }).Distinct(StringComparer.Ordinal).ToArray();
            for (int i = 0; i < sources.Length; i++)
            {
                ModelImporter importer = AssetImporter.GetAtPath(sources[i]) as ModelImporter;
                if (importer == null)
                    throw new InvalidOperationException(
                        "Missing Glasslands science model importer: " + sources[i]);
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
        }

        private static Material BuildMepRuinMaterial()
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(
                MepSourceMaterialPath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP Glasslands source material is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(
                MepRuinMaterialPath);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, MepRuinMaterialPath);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = "Kromka_Glasslands_MEP_Ruins";
            Color tint = new Color(0.61f, 0.66f, 0.61f, 1f);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name,
                                                   Color tint, float metallic,
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
            material.SetColor("_BaseColor", tint);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildBeaconMaterial()
        {
            Material material = BuildSolidMaterial(BeaconMaterialPath,
                "Kromka_Glasslands_ContourBeacon",
                new Color(0.12f, 0.74f, 0.78f, 1f), 0.20f, 0.36f);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", new Color(0.08f, 0.78f, 0.90f, 1f) * 2.2f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void BuildSealedTower(Transform parent, Material facility,
                                             Material ceramic, Material beacon)
        {
            Transform root = Child(parent, "Contour3_SealedTower_LANDMARK");
            root.position = MapToWorld(300f, 181f);
            BuildPrimitive("TowerBase", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.12f, 0f), new Vector3(0.36f, 0.12f, 0.36f),
                Quaternion.identity, facility);
            BuildPrimitive("LowerSealedCore", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.58f, 0f), new Vector3(0.27f, 0.46f, 0.27f),
                Quaternion.identity, facility);
            BuildPrimitive("UpperSealedCore", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.25f, 0f), new Vector3(0.19f, 0.32f, 0.19f),
                Quaternion.identity, ceramic);
            BuildPrimitive("PressureCollar", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.01f, 0f), new Vector3(0.34f, 0.05f, 0.34f),
                Quaternion.identity, ceramic);
            BuildPrimitive("SealedCap", root, PrimitiveType.Sphere,
                new Vector3(0f, 1.56f, 0f), new Vector3(0.23f, 0.12f, 0.23f),
                Quaternion.identity, ceramic);
            for (int i = 0; i < 4; i++)
            {
                float radians = i * Mathf.PI * 0.5f;
                Vector3 position = new Vector3(Mathf.Cos(radians) * 0.29f,
                    0.60f, Mathf.Sin(radians) * 0.29f);
                BuildPrimitive("PressureRib_" + i, root, PrimitiveType.Cube,
                    position, new Vector3(0.055f, 0.76f, 0.055f),
                    Quaternion.Euler(0f, i * 90f, i % 2 == 0 ? 3f : -3f), facility);
            }
            BuildPrimitive("CyanWarningBeacon", root, PrimitiveType.Sphere,
                new Vector3(0f, 1.76f, 0f), new Vector3(0.09f, 0.09f, 0.09f),
                Quaternion.identity, beacon);
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 localPosition,
                                           Vector3 scale, Quaternion rotation,
                                           Material material)
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
                    "Kromka model iteration 09 validation failed: " + message);
        }
    }
}
#endif
