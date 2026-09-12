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
    /// Environment-model iteration 13/20. The Zero Basin receives its two
    /// campaign anchors: the exposed R-12 regenerator and the deliberately low,
    /// sealed Balance bunker. Direct MEP pipes and walls ground both complexes.
    /// </summary>
    internal static class KromkaGlobalMapZeroCoreAuthoring
    {
        internal const int ModelIteration = 13;
        internal const int ModelIterationCount = 20;
        private const int ExpectedFacilityCount = 14;
        private const int ExpectedMachineCount = 10;
        private const int ExpectedMepPipeCount = 12;
        private const int ExpectedMepFortificationCount = 18;
        private const int ExpectedBlackWaterRingCount = 3;
        private const int RingSegments = 16;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string FactoryRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";

        private const string FacilityMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_Facility.mat";
        private const string MachineMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_Machinery.mat";
        private const string MepPipeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_Pipes_MEP.mat";
        private const string MepWallMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_Walls_MEP.mat";
        private const string RingMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_RingSteel.mat";
        private const string BlackWaterMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_BlackWater.mat";
        private const string BlueStatusMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_BlueStatus.mat";
        private const string RedStatusMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroCore_RedStatus.mat";

        private static readonly string[] FacilitySources =
        {
            SpaceRoot + "structure_closed.fbx",
            SpaceRoot + "structure_detailed.fbx",
            SpaceRoot + "hangar_smallA.fbx",
            SpaceRoot + "hangar_smallB.fbx",
            SpaceRoot + "corridor_open.fbx",
            SpaceRoot + "corridor_detailed.fbx",
            SpaceRoot + "gate_complex.fbx",
            SpaceRoot + "hangar_largeB.fbx",
            FactoryRoot + "hopper-high-round.fbx",
            FactoryRoot + "hopper-high-square.fbx",
            FactoryRoot + "structure-tall.fbx"
        };

        private static readonly string[] MachineSources =
        {
            SpaceRoot + "machine_generator.fbx",
            SpaceRoot + "machine_generatorLarge.fbx",
            SpaceRoot + "machine_wireless.fbx",
            SpaceRoot + "machine_wirelessCable.fbx"
        };

        private static readonly string[] MepPipeSources =
        {
            MepCaveRoot + "MEP_C_Pipe_01_N.prefab",
            MepCaveRoot + "MEP_C_Pipe_02_N.prefab"
        };

        private static readonly string[] MepFortificationSources =
        {
            MepBuildingRoot + "MEP_Wall_01_N.prefab",
            MepBuildingRoot + "MEP_Wall_02_N.prefab",
            MepBuildingRoot + "MEP_Wall_03_N.prefab",
            MepBuildingRoot + "MEP_Wall_04_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_01_N.prefab",
            MepBuildingRoot + "MEP_StoneWall_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_01_N.prefab",
            MepBuildingRoot + "MEP_Fence_02_N.prefab",
            MepBuildingRoot + "MEP_Fence_03_N.prefab",
            MepCaveRoot + "MEP_C_Entrance_01_N.prefab"
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

        private static readonly Placement[] Facilities =
        {
            new Placement("R12_ControlCell", "RegeneratorR12", FacilitySources[0], 225f, 61f, 0.58f, 0.62f, 2f, 0.022f),
            new Placement("R12_ProcessCell", "RegeneratorR12", FacilitySources[1], 225f, 70f, 0.58f, 0.62f, 182f, 0.022f),
            new Placement("R12_WestServiceHangar", "RegeneratorR12", FacilitySources[2], 193f, 68f, 0.62f, 0.48f, 89f, 0.020f),
            new Placement("R12_EastServiceHangar", "RegeneratorR12", FacilitySources[3], 217f, 68f, 0.62f, 0.48f, -89f, 0.020f),
            new Placement("R12_NorthPipeGallery", "RegeneratorR12", FacilitySources[4], 225f, 76f, 0.72f, 0.38f, 0f, 0.018f),
            new Placement("R12_WestSorbentHopper", "RegeneratorR12", FacilitySources[8], 193f, 59f, 0.50f, 0.66f, -14f, 0.018f),
            new Placement("R12_EastSorbentHopper", "RegeneratorR12", FacilitySources[9], 217f, 59f, 0.50f, 0.64f, 17f, 0.018f),
            new Placement("R12_AuxiliaryTower", "RegeneratorR12", FacilitySources[10], 225f, 55f, 0.54f, 0.88f, 0f, 0.020f),

            new Placement("Balance_ArmouredGate", "BalanceBunker", FacilitySources[6], 247f, 43f, 0.80f, 0.50f, 178f, 0.040f),
            new Placement("Balance_BuriedArchive", "BalanceBunker", FacilitySources[7], 247f, 51f, 0.82f, 0.48f, 0f, 0.105f),
            new Placement("Balance_WestSection", "BalanceBunker", FacilitySources[0], 239f, 49f, 0.56f, 0.56f, 88f, 0.065f),
            new Placement("Balance_EastSection", "BalanceBunker", FacilitySources[1], 255f, 49f, 0.56f, 0.56f, -88f, 0.065f),
            new Placement("Balance_WestDataCorridor", "BalanceBunker", FacilitySources[5], 242f, 57f, 0.70f, 0.34f, -8f, 0.050f),
            new Placement("Balance_EastDataCorridor", "BalanceBunker", FacilitySources[4], 252f, 57f, 0.70f, 0.34f, 8f, 0.050f)
        };

        private static readonly Placement[] Machines =
        {
            new Placement("R12_GeneratorWest", "RegeneratorR12", MachineSources[1], 188f, 58f, 0.42f, 0.44f, 16f, 0.016f),
            new Placement("R12_GeneratorEast", "RegeneratorR12", MachineSources[0], 232f, 65f, 0.38f, 0.39f, -13f, 0.016f),
            new Placement("R12_AnalyzerWest", "RegeneratorR12", MachineSources[2], 194f, 72f, 0.36f, 0.40f, 81f, 0.014f),
            new Placement("R12_AnalyzerEast", "RegeneratorR12", MachineSources[3], 216f, 72f, 0.38f, 0.42f, -82f, 0.014f),
            new Placement("R12_ReturnPumpWest", "RegeneratorR12", MachineSources[0], 195f, 78f, 0.34f, 0.36f, -4f, 0.014f),
            new Placement("R12_ReturnPumpEast", "RegeneratorR12", MachineSources[1], 220f, 81f, 0.38f, 0.40f, 6f, 0.014f),

            new Placement("Balance_WestComputePlant", "BalanceBunker", MachineSources[3], 239f, 44f, 0.36f, 0.38f, 24f, 0.014f),
            new Placement("Balance_EastComputePlant", "BalanceBunker", MachineSources[2], 255f, 44f, 0.36f, 0.38f, -22f, 0.014f),
            new Placement("Balance_ArchiveGenerator", "BalanceBunker", MachineSources[1], 241f, 55f, 0.40f, 0.42f, 11f, 0.014f),
            new Placement("Balance_EmergencyGenerator", "BalanceBunker", MachineSources[0], 253f, 55f, 0.38f, 0.40f, -9f, 0.014f)
        };

        private static readonly Placement[] MepPipes =
        {
            new Placement("R12_IntakePipeWest", "RegeneratorR12", MepPipeSources[0], 192f, 65f, 0.62f, 0.34f, 83f, 0.026f),
            new Placement("R12_IntakePipeEast", "RegeneratorR12", MepPipeSources[1], 218f, 65f, 0.62f, 0.34f, -84f, 0.026f),
            new Placement("R12_SouthManifoldWest", "RegeneratorR12", MepPipeSources[1], 198f, 55f, 0.56f, 0.32f, 9f, 0.024f),
            new Placement("R12_SouthManifoldEast", "RegeneratorR12", MepPipeSources[0], 212f, 55f, 0.56f, 0.32f, -9f, 0.024f),
            new Placement("R12_ReturnPipeWest", "RegeneratorR12", MepPipeSources[0], 194f, 75f, 0.58f, 0.33f, 65f, 0.025f),
            new Placement("R12_ReturnPipeEast", "RegeneratorR12", MepPipeSources[1], 216f, 75f, 0.58f, 0.33f, -66f, 0.025f),
            new Placement("R12_NorthCollectorWest", "RegeneratorR12", MepPipeSources[1], 201f, 81f, 0.54f, 0.31f, -12f, 0.024f),
            new Placement("R12_NorthCollectorEast", "RegeneratorR12", MepPipeSources[0], 209f, 81f, 0.54f, 0.31f, 12f, 0.024f),

            new Placement("Balance_ServicePipeWest", "BalanceBunker", MepPipeSources[0], 237f, 52f, 0.54f, 0.31f, 82f, 0.028f),
            new Placement("Balance_ServicePipeEast", "BalanceBunker", MepPipeSources[1], 257f, 52f, 0.54f, 0.31f, -82f, 0.028f),
            new Placement("Balance_DataCoolantWest", "BalanceBunker", MepPipeSources[1], 243f, 61f, 0.52f, 0.30f, -5f, 0.026f),
            new Placement("Balance_DataCoolantEast", "BalanceBunker", MepPipeSources[0], 251f, 61f, 0.52f, 0.30f, 5f, 0.026f)
        };

        private static readonly Placement[] MepFortifications =
        {
            new Placement("R12_RetainingWallSW", "RegeneratorR12", MepFortificationSources[0], 194f, 58f, 0.46f, 0.25f, 42f, 0.018f),
            new Placement("R12_RetainingWallSE", "RegeneratorR12", MepFortificationSources[1], 216f, 58f, 0.46f, 0.25f, -42f, 0.018f),
            new Placement("R12_RetainingWallWest", "RegeneratorR12", MepFortificationSources[2], 189f, 68f, 0.48f, 0.26f, 84f, 0.018f),
            new Placement("R12_RetainingWallEast", "RegeneratorR12", MepFortificationSources[3], 221f, 68f, 0.48f, 0.26f, -84f, 0.018f),
            new Placement("R12_RetainingWallNW", "RegeneratorR12", MepFortificationSources[4], 196f, 76f, 0.50f, 0.27f, 132f, 0.020f),
            new Placement("R12_RetainingWallNE", "RegeneratorR12", MepFortificationSources[5], 220f, 76f, 0.50f, 0.27f, -132f, 0.020f),
            new Placement("R12_ServiceFenceNorthWest", "RegeneratorR12", MepFortificationSources[6], 195f, 82f, 0.42f, 0.20f, 168f, 0.012f),
            new Placement("R12_ServiceFenceNorthEast", "RegeneratorR12", MepFortificationSources[7], 209f, 82f, 0.42f, 0.20f, -168f, 0.012f),

            new Placement("Balance_BuriedEntrance", "BalanceBunker", MepFortificationSources[9], 247f, 40f, 0.94f, 0.66f, 178f, 0.095f),
            new Placement("Balance_WallSouthWest", "BalanceBunker", MepFortificationSources[0], 240f, 45f, 0.46f, 0.25f, 33f, 0.030f),
            new Placement("Balance_WallSouthEast", "BalanceBunker", MepFortificationSources[1], 254f, 45f, 0.46f, 0.25f, -33f, 0.030f),
            new Placement("Balance_WallWest", "BalanceBunker", MepFortificationSources[2], 238f, 50f, 0.46f, 0.25f, 87f, 0.030f),
            new Placement("Balance_WallEast", "BalanceBunker", MepFortificationSources[3], 256f, 50f, 0.46f, 0.25f, -87f, 0.030f),
            new Placement("Balance_WallNorthWest", "BalanceBunker", MepFortificationSources[4], 241f, 57f, 0.48f, 0.26f, 142f, 0.030f),
            new Placement("Balance_WallNorthEast", "BalanceBunker", MepFortificationSources[5], 253f, 57f, 0.48f, 0.26f, -142f, 0.030f),
            new Placement("Balance_FenceNorth", "BalanceBunker", MepFortificationSources[8], 247f, 61f, 0.42f, 0.20f, 178f, 0.014f),
            new Placement("Balance_FenceWest", "BalanceBunker", MepFortificationSources[6], 238f, 56f, 0.40f, 0.20f, 82f, 0.014f),
            new Placement("Balance_FenceEast", "BalanceBunker", MepFortificationSources[7], 256f, 56f, 0.40f, 0.20f, -82f, 0.014f)
        };

        internal static void Compose(Transform parent)
        {
            Material facility = BuildSolidMaterial(FacilityMaterialPath,
                "Kromka_ZeroCore_Facility", new Color(0.30f, 0.34f, 0.32f, 1f),
                0.24f, 0.24f);
            Material machinery = BuildSolidMaterial(MachineMaterialPath,
                "Kromka_ZeroCore_Machinery", new Color(0.16f, 0.24f, 0.23f, 1f),
                0.38f, 0.30f);
            Material mepPipes = BuildMepMaterial(MepPipeMaterialPath,
                MepCaveSourceMaterial, "Kromka_ZeroCore_Pipes_MEP",
                new Color(0.42f, 0.43f, 0.36f, 1f));
            Material mepWalls = BuildMepMaterial(MepWallMaterialPath,
                MepBuildingSourceMaterial, "Kromka_ZeroCore_Walls_MEP",
                new Color(0.44f, 0.42f, 0.35f, 1f));
            Material ringSteel = BuildSolidMaterial(RingMaterialPath,
                "Kromka_ZeroCore_RingSteel", new Color(0.20f, 0.25f, 0.23f, 1f),
                0.46f, 0.34f);
            Material blackWater = BuildSolidMaterial(BlackWaterMaterialPath,
                "Kromka_ZeroCore_BlackWater", new Color(0.012f, 0.030f, 0.025f, 1f),
                0.10f, 0.82f);
            Material blueStatus = BuildEmissiveMaterial(BlueStatusMaterialPath,
                "Kromka_ZeroCore_BlueStatus", new Color(0.015f, 0.24f, 0.23f, 1f),
                new Color(0.02f, 0.70f, 0.64f, 1f));
            Material redStatus = BuildEmissiveMaterial(RedStatusMaterialPath,
                "Kromka_ZeroCore_RedStatus", new Color(0.22f, 0.035f, 0.020f, 1f),
                new Color(0.72f, 0.045f, 0.018f, 1f));

            Transform root = Child(parent, "ZeroBasin_CoreComplexes_MEP_Kenney");
            PlaceSet(Facilities, Child(root, "R12AndBalanceFacilities_EDITABLE"), facility);
            PlaceSet(Machines, Child(root, "R12AndBalanceMachinery_EDITABLE"), machinery);
            PlaceSet(MepPipes, Child(root, "DirectMEPThickPipes_EDITABLE"), mepPipes);
            PlaceSet(MepFortifications,
                Child(root, "DirectMEPZeroFortifications_EDITABLE"), mepWalls);
            BuildBlackWaterRings(root, ringSteel, blackWater, blueStatus);
            BuildRegeneratorColumn(root, facility, ringSteel, blueStatus);
            BuildBalanceStatusColumn(root, facility, blueStatus, redStatus);

            Child(parent, "ZeroCoreNamedNodes_2_REFERENCE");
            Child(parent, "ZeroCoreFacilities_14_REFERENCE");
            Child(parent, "ZeroCoreMachines_10_REFERENCE");
            Child(parent, "DirectMEPZeroPipes_12_REFERENCE");
            Child(parent, "DirectMEPZeroFortifications_18_REFERENCE");
            Child(parent, "R12BlackWaterRings_3_REFERENCE");
            Child(parent, "R12RegeneratorColumn_1_REFERENCE");
            Child(parent, "BalanceColdStatusColumn_1_REFERENCE");
            Child(parent, "PersistentZeroCoreGeometry_REFERENCE");
            Child(parent, "ModelIteration_13_of_20");
        }

        internal static void ValidateIteration13()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 13 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "ZeroCoreNamedNodes_2_REFERENCE", "ZeroCoreFacilities_14_REFERENCE",
                "ZeroCoreMachines_10_REFERENCE", "DirectMEPZeroPipes_12_REFERENCE",
                "DirectMEPZeroFortifications_18_REFERENCE",
                "R12BlackWaterRings_3_REFERENCE", "R12RegeneratorColumn_1_REFERENCE",
                "BalanceColdStatusColumn_1_REFERENCE",
                "PersistentZeroCoreGeometry_REFERENCE", "ModelIteration_13_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(Facilities.Length == ExpectedFacilityCount,
                "fourteen core facilities are required");
            Require(Machines.Length == ExpectedMachineCount,
                "ten core machines are required");
            Require(MepPipes.Length == ExpectedMepPipeCount,
                "twelve direct MEP pipes are required");
            Require(MepFortifications.Length == ExpectedMepFortificationCount,
                "eighteen direct MEP fortifications are required");

            Transform core = FindDescendant(root, "ZeroBasin_CoreComplexes_MEP_Kenney");
            Require(core != null, "Zero Basin core complex root is missing");
            ValidateSet(FindDescendant(core, "R12AndBalanceFacilities_EDITABLE"),
                Facilities, RequireMaterial(FacilityMaterialPath), FacilitySources);
            ValidateSet(FindDescendant(core, "R12AndBalanceMachinery_EDITABLE"),
                Machines, RequireMaterial(MachineMaterialPath), MachineSources);
            ValidateSet(FindDescendant(core, "DirectMEPThickPipes_EDITABLE"),
                MepPipes, RequireMaterial(MepPipeMaterialPath), MepPipeSources);
            ValidateSet(FindDescendant(core, "DirectMEPZeroFortifications_EDITABLE"),
                MepFortifications, RequireMaterial(MepWallMaterialPath),
                MepFortificationSources);

            Transform rings = FindDescendant(core, "R12_BlackWaterRings_LANDMARK");
            Require(rings != null && rings.childCount == ExpectedBlackWaterRingCount,
                "R-12 must retain three black-water service rings");
            Require(rings.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedBlackWaterRingCount * RingSegments * 6,
                "R-12 black-water ring silhouettes are incomplete");
            Transform regenerator = FindDescendant(core,
                "R12_RegeneratorColumn_LANDMARK");
            Require(regenerator != null
                    && regenerator.GetComponentsInChildren<Renderer>(true).Length == 12,
                "R-12 regenerator column silhouette is incomplete");
            Transform status = FindDescendant(core,
                "Balance_ColdStatusColumn_LANDMARK");
            Require(status != null
                    && status.GetComponentsInChildren<Renderer>(true).Length == 9,
                "Balance cold-status column silhouette is incomplete");
            Require(core.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Zero Basin core geometry can obstruct strategic-map interaction");
            Require(core.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Zero Basin core geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 65%] PASS: R-12 and Balance form the Zero "
                + "Basin campaign core with fourteen facilities, ten machines, thirty "
                + "direct MEP pipes/walls, three black-water rings and two distinct "
                + "status landmarks.");
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
            Require(root != null, "a Zero Basin placement root is missing");
            var sources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Require(placement.MapX >= 187f && placement.MapX <= 261f
                        && placement.MapY >= 40f && placement.MapY <= 84f,
                    placement.Name + " is outside the reviewed Zero Basin core");
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
                    placement.Name + " is not grounded on authored relief");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
            }
            Require(sources.SetEquals(expectedSources),
                "a reviewed Zero Basin source set is incomplete");
        }

        private static void BuildBlackWaterRings(Transform parent, Material steel,
                                                 Material blackWater, Material blue)
        {
            Transform root = Child(parent, "R12_BlackWaterRings_LANDMARK");
            // Compact process cells fit inside the machinery yard. The former
            // oversized rings intersected the surrounding hangars and generators.
            float[] radii = { 0.36f, 0.60f, 0.84f };
            for (int ringIndex = 0; ringIndex < radii.Length; ringIndex++)
            {
                Transform ring = Child(root, "BlackWaterServiceRing_" + ringIndex);
                float radius = radii[ringIndex];
                float segmentLength = 2f * Mathf.PI * radius / RingSegments * 0.80f;
                for (int segment = 0; segment < RingSegments; segment++)
                {
                    float angle = segment * (360f / RingSegments)
                        + ringIndex * 5f;
                    float radians = angle * Mathf.Deg2Rad;
                    float innerRadius = radius - .04f;
                    float innerMapX = 205f
                        + Mathf.Cos(radians) * innerRadius / WorldScale;
                    float innerMapY = 65f
                        - Mathf.Sin(radians) * innerRadius / WorldScale;
                    Vector3 waterPosition = MapToWorld(innerMapX, innerMapY);
                    Quaternion rotation = Quaternion.Euler(0f, -angle + 90f, 0f);
                    Vector3 radial = rotation * Vector3.forward;
                    Vector3 tangent = rotation * Vector3.right;
                    float[] ground = new[] { -1f, 1f }.SelectMany(a => new[] { -1f, 1f }
                        .Select(b => waterPosition + tangent * (a * segmentLength * .5f) + radial * (b * .06f)))
                        .Select(p => KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            190f + p.x * 10f, 150f - p.z * 10f)).ToArray();
                    float waterLevel = ground.Max() + .035f;
                    float bottom = ground.Min() - .012f;
                    waterPosition.y = waterLevel;
                    // Every water cell has a floor and four retaining walls.
                    // It is a supported tank, not a coloured cube hovering over soil.
                    BuildPrimitive("TankFoundation_" + segment.ToString("00"), ring,
                        PrimitiveType.Cube, new Vector3(waterPosition.x,
                            (bottom + waterLevel - .018f) * .5f, waterPosition.z),
                        new Vector3(segmentLength, waterLevel - .018f - bottom, .12f), rotation, steel);
                    BuildPrimitive("RetainingSegment_" + segment.ToString("00"), ring,
                        PrimitiveType.Cube, waterPosition + radial * .04f + Vector3.up * .0225f,
                        new Vector3(segmentLength, .09f, .035f), rotation,
                        (segment + ringIndex) % 4 == 0 ? blue : steel);
                    BuildPrimitive("InnerWall_" + segment.ToString("00"), ring,
                        PrimitiveType.Cube, waterPosition - radial * .04f + Vector3.up * .0225f,
                        new Vector3(segmentLength, .09f, .035f), rotation, steel);
                    for (int end = -1; end <= 1; end += 2)
                        BuildPrimitive("EndWall_" + segment.ToString("00") + "_" + end, ring,
                            PrimitiveType.Cube, waterPosition + tangent * (end * segmentLength * .48f)
                                + Vector3.up * .0225f,
                            new Vector3(.02f, .09f, .12f), rotation, steel);
                    BuildPrimitive("BlackWaterSegment_" + segment.ToString("00"), ring,
                        PrimitiveType.Cube, waterPosition - Vector3.up * .007f,
                        new Vector3(segmentLength * 0.92f, .022f, .075f), rotation, blackWater);
                }
            }
        }

        private static void BuildRegeneratorColumn(Transform parent, Material facility,
                                                   Material steel, Material blue)
        {
            Transform root = Child(parent, "R12_RegeneratorColumn_LANDMARK");
            root.position = MapToWorld(205f, 65f) - Vector3.up * .012f;
            BuildPrimitive("Foundation", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.12f, 0f), new Vector3(0.42f, 0.12f, 0.42f),
                Quaternion.identity, facility);
            BuildPrimitive("RegeneratorDrum", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.91f, 0f), new Vector3(0.27f, 0.80f, 0.27f),
                Quaternion.identity, facility);
            for (int collar = 0; collar < 3; collar++)
                BuildPrimitive("PressureCollar_" + collar, root, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.48f + collar * 0.52f, 0f),
                    new Vector3(0.36f, 0.045f, 0.36f), Quaternion.identity, steel);
            BuildPrimitive("ColumnCap", root, PrimitiveType.Sphere,
                new Vector3(0f, 1.82f, 0f), new Vector3(0.30f, 0.22f, 0.30f),
                Quaternion.identity, facility);
            for (int brace = 0; brace < 4; brace++)
            {
                float yaw = brace * 90f + 45f;
                float radians = yaw * Mathf.Deg2Rad;
                GroundedBrace("ExternalBrace_" + brace, root,
                    new Vector3(Mathf.Cos(radians) * .22f, 0f, Mathf.Sin(radians) * .22f),
                    new Vector3(Mathf.Cos(radians) * .13f, 1.4f, Mathf.Sin(radians) * .13f), steel);
            }
            BuildPrimitive("BlueCycleBandLower", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.72f, 0f), new Vector3(0.295f, 0.026f, 0.295f),
                Quaternion.identity, blue);
            BuildPrimitive("BlueCycleBandUpper", root, PrimitiveType.Cylinder,
                new Vector3(0f, 1.31f, 0f), new Vector3(0.295f, 0.026f, 0.295f),
                Quaternion.identity, blue);
        }

        private static void BuildBalanceStatusColumn(Transform parent, Material facility,
                                                     Material blue, Material red)
        {
            Transform root = Child(parent, "Balance_ColdStatusColumn_LANDMARK");
            root.position = MapToWorld(247f, 49f) - Vector3.up * .012f;
            BuildPrimitive("StatusPlinth", root, PrimitiveType.Cube,
                new Vector3(0f, 0.07f, 0f), new Vector3(0.44f, 0.14f, 0.44f),
                Quaternion.identity, facility);
            BuildPrimitive("StatusShaft", root, PrimitiveType.Cube,
                new Vector3(0f, 0.53f, 0f), new Vector3(0.24f, 0.78f, 0.24f),
                Quaternion.identity, facility);
            BuildPrimitive("StatusCap", root, PrimitiveType.Cube,
                new Vector3(0f, 0.95f, 0f), new Vector3(0.36f, 0.09f, 0.36f),
                Quaternion.identity, facility);
            for (int side = 0; side < 4; side++)
            {
                float yaw = side * 90f;
                float radians = yaw * Mathf.Deg2Rad;
                BuildPrimitive("ColdStatusStrip_" + side, root, PrimitiveType.Cube,
                    new Vector3(Mathf.Sin(radians) * 0.126f, 0.60f,
                        Mathf.Cos(radians) * 0.126f),
                    side % 2 == 0
                        ? new Vector3(0.055f, 0.46f, 0.018f)
                        : new Vector3(0.018f, 0.46f, 0.055f),
                    Quaternion.Euler(0f, yaw, 0f), side == 3 ? red : blue);
            }
            GroundedBrace("ArchiveBraceWest", root, new Vector3(-.27f, 0f, 0f), new Vector3(-.12f, .74f, 0f), facility);
            GroundedBrace("ArchiveBraceEast", root, new Vector3(.27f, 0f, 0f), new Vector3(.12f, .74f, 0f), facility);
        }

        private static void GroundedBrace(string name, Transform root, Vector3 foot, Vector3 top, Material material)
        {
            Vector3 world = root.TransformPoint(foot);
            world.y = KromkaGlobalMapReliefAuthoring.HeightAtMap(190f + world.x * 10f, 150f - world.z * 10f) - .008f;
            foot = root.InverseTransformPoint(world);
            Vector3 direction = top - foot;
            BuildPrimitive(name, root, PrimitiveType.Cube, (foot + top) * .5f,
                new Vector3(.055f, direction.magnitude, .055f), Quaternion.FromToRotation(Vector3.up, direction), material);
        }

        [MenuItem("Realm of Ashes/Authoring/Visual review/Repair R12 structural supports")]
        public static void RepairStructuralSupports()
        {
            Require(!EditorApplication.isPlayingOrWillChangePlaymode, "Exit Play Mode first");
            Transform models = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform;
            Transform core = FindDescendant(models, "ZeroBasin_CoreComplexes_MEP_Kenney");
            foreach (Placement placement in Facilities.Concat(Machines).Concat(MepPipes).Concat(MepFortifications))
            {
                Transform instance = FindDescendant(core, placement.Name);
                Bounds bounds = Encapsulate(instance.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray());
                Vector3 target = MapToWorld(placement.MapX, placement.MapY);
                instance.position += new Vector3(target.x - bounds.center.x,
                    target.y - placement.Embed - bounds.min.y, target.z - bounds.center.z);
            }
            foreach (string name in new[] { "R12_BlackWaterRings_LANDMARK", "R12_RegeneratorColumn_LANDMARK", "Balance_ColdStatusColumn_LANDMARK" })
                UnityEngine.Object.DestroyImmediate(FindDescendant(core, name).gameObject);
            BuildBlackWaterRings(core, RequireMaterial(RingMaterialPath), RequireMaterial(BlackWaterMaterialPath), RequireMaterial(BlueStatusMaterialPath));
            BuildRegeneratorColumn(core, RequireMaterial(FacilityMaterialPath), RequireMaterial(RingMaterialPath), RequireMaterial(BlueStatusMaterialPath));
            BuildBalanceStatusColumn(core, RequireMaterial(FacilityMaterialPath), RequireMaterial(BlueStatusMaterialPath), RequireMaterial(RedStatusMaterialPath));
            KromkaGlobalMapSovietReplacementAuthoring.RefreshCrossingClearance(models);
            ValidateIteration13();
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
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

        private static Material BuildMepMaterial(string path, string sourcePath,
                                                 string name, Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(sourcePath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP source material is unavailable for Zero Basin core: " + sourcePath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name, Color color,
                                                   float metallic, float smoothness)
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
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildEmissiveMaterial(string path, string name,
                                                      Color color, Color emission)
        {
            Material material = BuildSolidMaterial(path, name, color, 0.20f, 0.40f);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", emission);
            material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
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
                "Kromka model iteration 13 validation failed: " + message);
        }
    }
}
#endif
