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
    /// Environment-model iteration 14/20. Three outer Zero Basin nodes gain
    /// separate silhouettes: Fort 14, Drain 4-B and the Fuel Ramp. The authored
    /// dressing combines direct MEP props with small Kenney industrial modules.
    /// </summary>
    internal static class KromkaGlobalMapZeroOuterAuthoring
    {
        internal const int ModelIteration = 14;
        internal const int ModelIterationCount = 20;
        private const int ExpectedStructureCount = 15;
        private const int ExpectedVehicleCount = 5;
        private const int ExpectedMepPipeCount = 14;
        private const int ExpectedMepBarrelCount = 18;
        private const int ExpectedMepFortificationCount = 18;
        private const int ExpectedLeaningTankCount = 4;
        private const int PoolSegments = 16;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string SpaceRoot =
            "Assets/ThirdParty/Kenney/SpaceKit10/Models/";
        private const string FactoryRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string CityRoot =
            "Assets/ThirdParty/Kenney/CityKitIndustrial20/Models/";
        private const string CarRoot =
            "Assets/ThirdParty/Kenney/CarKit31/Models/";
        private const string MepBuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string MepBarrelSource =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/Chest_Barrel/Prefabs/MEP_Barrel.prefab";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";
        private const string MepBarrelSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Props/Chest_Barrel/Materials/MEP_Chest_Barrel.mat";

        private const string StructureMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Structures.mat";
        private const string VehicleMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Vehicles.mat";
        private const string PipeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Pipes_MEP.mat";
        private const string BarrelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Barrels_MEP.mat";
        private const string FortificationMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Fortifications_MEP.mat";
        private const string FuelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_FuelSteel.mat";
        private const string ToxicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_ToxicWater.mat";
        private const string DarkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Graphite.mat";
        private const string WarningMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ZeroOuter_Warning.mat";

        private static readonly string[] StructureSources =
        {
            SpaceRoot + "gate_complex.fbx",
            SpaceRoot + "hangar_largeA.fbx",
            SpaceRoot + "structure_closed.fbx",
            SpaceRoot + "structure_detailed.fbx",
            CityRoot + "building-t.fbx",
            FactoryRoot + "hopper-high-round.fbx",
            FactoryRoot + "hopper-high-square.fbx",
            FactoryRoot + "conveyor-long-sides.fbx",
            FactoryRoot + "structure-tall.fbx",
            CityRoot + "water-tower.fbx",
            CityRoot + "shipping-container-a.fbx",
            CityRoot + "shipping-container-b.fbx",
            CityRoot + "shipping-container-c.fbx",
            FactoryRoot + "crane-lift.fbx",
            FactoryRoot + "crane.fbx"
        };

        private static readonly string[] VehicleSources =
        {
            CarRoot + "delivery.fbx",
            CarRoot + "truck-flat.fbx",
            CarRoot + "truck.fbx",
            CarRoot + "tractor.fbx",
            CarRoot + "firetruck.fbx"
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
            MepBuildingRoot + "MEP_Fence_03_N.prefab"
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

        private static readonly Placement[] Structures =
        {
            new Placement("Fort14_ArmouredGate", "Fort14", StructureSources[0], 232f, 30f, 0.88f, 0.58f, 180f, 0.035f),
            new Placement("Fort14_CommandHangar", "Fort14", StructureSources[1], 232f, 22f, 1.02f, 0.62f, 0f, 0.055f),
            new Placement("Fort14_WestBunker", "Fort14", StructureSources[2], 223f, 23f, 0.58f, 0.58f, 88f, 0.035f),
            new Placement("Fort14_EastBunker", "Fort14", StructureSources[3], 241f, 23f, 0.58f, 0.62f, -88f, 0.035f),
            new Placement("Fort14_RearCommandPost", "Fort14", StructureSources[4], 232f, 16f, 0.74f, 0.72f, 0f, 0.030f),

            new Placement("Drain4B_PrimaryHopper", "Drain4B", StructureSources[5], 168f, 75f, 0.54f, 0.72f, 8f, 0.020f),
            new Placement("Drain4B_SecondaryHopper", "Drain4B", StructureSources[6], 174f, 78f, 0.52f, 0.68f, -12f, 0.020f),
            new Placement("Drain4B_SludgeConveyor", "Drain4B", StructureSources[7], 161f, 78f, 0.82f, 0.34f, 72f, 0.018f),
            new Placement("Drain4B_FilterFrame", "Drain4B", StructureSources[8], 171f, 69f, 0.52f, 0.88f, -8f, 0.020f),
            new Placement("Drain4B_HeaderTank", "Drain4B", StructureSources[9], 161f, 71f, 0.56f, 0.82f, 4f, 0.020f),

            new Placement("FuelRamp_ContainerA", "FuelRamp", StructureSources[10], 137f, 51f, 0.72f, 0.34f, 72f, 0.018f),
            new Placement("FuelRamp_ContainerB", "FuelRamp", StructureSources[11], 142f, 54f, 0.72f, 0.34f, 72f, 0.018f),
            new Placement("FuelRamp_ContainerC", "FuelRamp", StructureSources[12], 160f, 55f, 0.72f, 0.34f, -18f, 0.018f),
            new Placement("FuelRamp_LiftCrane", "FuelRamp", StructureSources[13], 158f, 42f, 0.58f, 0.72f, -12f, 0.020f),
            new Placement("FuelRamp_ServiceCrane", "FuelRamp", StructureSources[14], 136f, 40f, 0.62f, 0.82f, 18f, 0.020f)
        };

        private static readonly Placement[] Vehicles =
        {
            new Placement("FuelRamp_DeliveryTanker", "FuelRamp", VehicleSources[0], 147f, 56f, 0.46f, 0.30f, 72f, 0.015f),
            new Placement("FuelRamp_Flatbed", "FuelRamp", VehicleSources[1], 158f, 48f, 0.48f, 0.30f, -18f, 0.015f),
            new Placement("FuelRamp_CargoTruck", "FuelRamp", VehicleSources[2], 134f, 47f, 0.48f, 0.32f, 18f, 0.015f),
            new Placement("FuelRamp_YardTractor", "FuelRamp", VehicleSources[3], 157f, 37f, 0.42f, 0.28f, -32f, 0.015f),
            new Placement("Fort14_FireTender", "Fort14", VehicleSources[4], 244f, 28f, 0.48f, 0.32f, -95f, 0.015f)
        };

        private static readonly Placement[] MepPipes =
        {
            new Placement("Drain4B_IntakeWest", "Drain4B", MepPipeSources[0], 158f, 75f, 0.58f, 0.34f, 82f, 0.024f),
            new Placement("Drain4B_IntakeEast", "Drain4B", MepPipeSources[1], 177f, 75f, 0.58f, 0.34f, -82f, 0.024f),
            new Placement("Drain4B_HeaderNorth", "Drain4B", MepPipeSources[0], 164f, 67f, 0.54f, 0.32f, 8f, 0.024f),
            new Placement("Drain4B_HeaderSouth", "Drain4B", MepPipeSources[1], 171f, 84f, 0.54f, 0.32f, -8f, 0.024f),
            new Placement("Drain4B_SludgeWest", "Drain4B", MepPipeSources[1], 158f, 82f, 0.52f, 0.31f, 62f, 0.024f),
            new Placement("Drain4B_SludgeEast", "Drain4B", MepPipeSources[0], 177f, 82f, 0.52f, 0.31f, -62f, 0.024f),
            new Placement("Drain4B_StackFeedA", "Drain4B", MepPipeSources[0], 164f, 72f, 0.46f, 0.30f, 18f, 0.024f),
            new Placement("Drain4B_StackFeedB", "Drain4B", MepPipeSources[1], 172f, 72f, 0.46f, 0.30f, -18f, 0.024f),

            new Placement("FuelRamp_ManifoldA", "FuelRamp", MepPipeSources[0], 140f, 43f, 0.54f, 0.32f, 72f, 0.022f),
            new Placement("FuelRamp_ManifoldB", "FuelRamp", MepPipeSources[1], 146f, 39f, 0.54f, 0.32f, -18f, 0.022f),
            new Placement("FuelRamp_ManifoldC", "FuelRamp", MepPipeSources[0], 152f, 44f, 0.54f, 0.32f, -68f, 0.022f),
            new Placement("FuelRamp_LoadLineA", "FuelRamp", MepPipeSources[1], 140f, 51f, 0.50f, 0.31f, 74f, 0.022f),
            new Placement("FuelRamp_LoadLineB", "FuelRamp", MepPipeSources[0], 148f, 51f, 0.50f, 0.31f, 74f, 0.022f),
            new Placement("FuelRamp_LoadLineC", "FuelRamp", MepPipeSources[1], 156f, 51f, 0.50f, 0.31f, 74f, 0.022f)
        };

        private static readonly Placement[] MepBarrels = BuildBarrelPlacements();

        private static readonly Placement[] MepFortifications =
        {
            new Placement("Fort14_WallSW", "Fort14", MepFortificationSources[0], 222f, 28f, 0.48f, 0.27f, 42f, 0.018f),
            new Placement("Fort14_WallSE", "Fort14", MepFortificationSources[1], 242f, 28f, 0.48f, 0.27f, -42f, 0.018f),
            new Placement("Fort14_WallW", "Fort14", MepFortificationSources[2], 219f, 22f, 0.48f, 0.27f, 88f, 0.018f),
            new Placement("Fort14_WallE", "Fort14", MepFortificationSources[3], 245f, 22f, 0.48f, 0.27f, -88f, 0.018f),
            new Placement("Fort14_WallNW", "Fort14", MepFortificationSources[4], 223f, 15f, 0.52f, 0.28f, 138f, 0.020f),
            new Placement("Fort14_WallNE", "Fort14", MepFortificationSources[5], 241f, 15f, 0.52f, 0.28f, -138f, 0.020f),
            new Placement("Fort14_FenceFrontW", "Fort14", MepFortificationSources[6], 226f, 31f, 0.42f, 0.22f, 8f, 0.012f),
            new Placement("Fort14_FenceFrontE", "Fort14", MepFortificationSources[7], 238f, 31f, 0.42f, 0.22f, -8f, 0.012f),
            new Placement("Fort14_FenceRear", "Fort14", MepFortificationSources[8], 232f, 12f, 0.42f, 0.22f, 178f, 0.012f),
            new Placement("Fort14_InnerWallW", "Fort14", MepFortificationSources[0], 226f, 20f, 0.44f, 0.25f, 82f, 0.018f),
            new Placement("Fort14_InnerWallE", "Fort14", MepFortificationSources[1], 238f, 20f, 0.44f, 0.25f, -82f, 0.018f),
            new Placement("Fort14_BlastWallW", "Fort14", MepFortificationSources[4], 227f, 26f, 0.46f, 0.26f, 24f, 0.018f),
            new Placement("Fort14_BlastWallE", "Fort14", MepFortificationSources[5], 237f, 26f, 0.46f, 0.26f, -24f, 0.018f),
            new Placement("Fort14_BrokenFence", "Fort14", MepFortificationSources[8], 246f, 17f, 0.40f, 0.21f, -72f, 0.012f),

            new Placement("Drain4B_RetainingWallW", "Drain4B", MepFortificationSources[4], 157f, 68f, 0.48f, 0.27f, 42f, 0.018f),
            new Placement("Drain4B_RetainingWallE", "Drain4B", MepFortificationSources[5], 179f, 70f, 0.48f, 0.27f, -42f, 0.018f),
            new Placement("FuelRamp_WindFenceW", "FuelRamp", MepFortificationSources[6], 133f, 54f, 0.42f, 0.22f, 66f, 0.012f),
            new Placement("FuelRamp_WindFenceE", "FuelRamp", MepFortificationSources[7], 160f, 44f, 0.42f, 0.22f, -68f, 0.012f)
        };

        internal static void Compose(Transform parent)
        {
            Material structures = BuildSolidMaterial(StructureMaterialPath,
                "Kromka_ZeroOuter_Structures", new Color(0.25f, 0.29f, 0.27f, 1f),
                0.28f, 0.22f);
            Material vehicles = BuildSolidMaterial(VehicleMaterialPath,
                "Kromka_ZeroOuter_Vehicles", new Color(0.29f, 0.20f, 0.12f, 1f),
                0.22f, 0.18f);
            Material pipes = BuildMepMaterial(PipeMaterialPath,
                MepCaveSourceMaterial, "Kromka_ZeroOuter_Pipes_MEP",
                new Color(0.35f, 0.36f, 0.28f, 1f));
            Material barrels = BuildMepMaterial(BarrelMaterialPath,
                MepBarrelSourceMaterial, "Kromka_ZeroOuter_Barrels_MEP",
                new Color(0.38f, 0.23f, 0.10f, 1f));
            Material fortifications = BuildMepMaterial(FortificationMaterialPath,
                MepBuildingSourceMaterial, "Kromka_ZeroOuter_Fortifications_MEP",
                new Color(0.32f, 0.33f, 0.28f, 1f));
            Material fuel = BuildSolidMaterial(FuelMaterialPath,
                "Kromka_ZeroOuter_FuelSteel", new Color(0.35f, 0.18f, 0.08f, 1f),
                0.52f, 0.24f);
            Material toxic = BuildSolidMaterial(ToxicMaterialPath,
                "Kromka_ZeroOuter_ToxicWater", new Color(0.018f, 0.070f, 0.032f, 1f),
                0.06f, 0.88f);
            Material dark = BuildSolidMaterial(DarkMaterialPath,
                "Kromka_ZeroOuter_Graphite", new Color(0.07f, 0.085f, 0.075f, 1f),
                0.40f, 0.30f);
            Material warning = BuildEmissiveMaterial(WarningMaterialPath,
                "Kromka_ZeroOuter_Warning", new Color(0.30f, 0.025f, 0.012f, 1f),
                new Color(0.95f, 0.055f, 0.018f, 1f));

            Transform root = Child(parent, "ZeroBasin_OuterInfrastructure_MEP_Kenney");
            PlaceSet(Structures, Child(root, "ZeroOuterStructures_EDITABLE"), structures);
            PlaceSet(Vehicles, Child(root, "ZeroOuterVehicles_EDITABLE"), vehicles);
            PlaceSet(MepPipes, Child(root, "DirectMEPOuterPipes_EDITABLE"), pipes);
            PlaceSet(MepBarrels, Child(root, "DirectMEPOuterBarrels_EDITABLE"), barrels);
            PlaceSet(MepFortifications,
                Child(root, "DirectMEPOuterFortifications_EDITABLE"), fortifications);
            BuildFuelRampTanks(root, fuel, dark, warning);
            BuildFuelLoadingRack(root, dark, fuel, warning);
            BuildDrainStack(root, dark, pipes, toxic, warning);
            BuildSettlingPool(root, dark, toxic, warning);
            BuildFortBastion(root, dark, structures, warning);

            Child(parent, "ZeroOuterNamedNodes_3_REFERENCE");
            Child(parent, "ZeroOuterStructures_15_REFERENCE");
            Child(parent, "ZeroOuterVehicles_5_REFERENCE");
            Child(parent, "DirectMEPOuterPipes_14_REFERENCE");
            Child(parent, "DirectMEPOuterBarrels_18_REFERENCE");
            Child(parent, "DirectMEPOuterFortifications_18_REFERENCE");
            Child(parent, "FuelRampLeaningTanks_4_REFERENCE");
            Child(parent, "FuelRampLoadingRack_1_REFERENCE");
            Child(parent, "Drain4BBlackSettlingPool_1_REFERENCE");
            Child(parent, "Drain4BDrainStack_1_REFERENCE");
            Child(parent, "Fort14CommandBastion_1_REFERENCE");
            Child(parent, "PersistentZeroOuterGeometry_REFERENCE");
            Child(parent, "ModelIteration_14_of_20");
        }

        internal static void ValidateIteration14()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 14 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "ZeroOuterNamedNodes_3_REFERENCE", "ZeroOuterStructures_15_REFERENCE",
                "ZeroOuterVehicles_5_REFERENCE", "DirectMEPOuterPipes_14_REFERENCE",
                "DirectMEPOuterBarrels_18_REFERENCE",
                "DirectMEPOuterFortifications_18_REFERENCE",
                "FuelRampLeaningTanks_4_REFERENCE", "FuelRampLoadingRack_1_REFERENCE",
                "Drain4BBlackSettlingPool_1_REFERENCE", "Drain4BDrainStack_1_REFERENCE",
                "Fort14CommandBastion_1_REFERENCE",
                "PersistentZeroOuterGeometry_REFERENCE", "ModelIteration_14_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(Structures.Length == ExpectedStructureCount,
                "fifteen imported outer structures are required");
            Require(Vehicles.Length == ExpectedVehicleCount,
                "five outer service vehicles are required");
            Require(MepPipes.Length == ExpectedMepPipeCount,
                "fourteen direct MEP pipes are required");
            Require(MepBarrels.Length == ExpectedMepBarrelCount,
                "eighteen direct MEP barrels are required");
            Require(MepFortifications.Length == ExpectedMepFortificationCount,
                "eighteen direct MEP fortifications are required");

            Transform outer = FindDescendant(root,
                "ZeroBasin_OuterInfrastructure_MEP_Kenney");
            Require(outer != null, "Zero Basin outer infrastructure root is missing");
            ValidateSet(FindDescendant(outer, "ZeroOuterStructures_EDITABLE"),
                Structures, RequireMaterial(StructureMaterialPath), StructureSources);
            ValidateSet(FindDescendant(outer, "ZeroOuterVehicles_EDITABLE"),
                Vehicles, RequireMaterial(VehicleMaterialPath), VehicleSources);
            ValidateSet(FindDescendant(outer, "DirectMEPOuterPipes_EDITABLE"),
                MepPipes, RequireMaterial(PipeMaterialPath), MepPipeSources);
            ValidateSet(FindDescendant(outer, "DirectMEPOuterBarrels_EDITABLE"),
                MepBarrels, RequireMaterial(BarrelMaterialPath),
                new[] { MepBarrelSource });
            ValidateSet(FindDescendant(outer, "DirectMEPOuterFortifications_EDITABLE"),
                MepFortifications, RequireMaterial(FortificationMaterialPath),
                MepFortificationSources);

            Transform tanks = FindDescendant(outer, "FuelRamp_LeaningTanks_LANDMARK");
            Require(tanks != null && tanks.childCount == ExpectedLeaningTankCount,
                "Fuel Ramp must retain four leaning tanks");
            Require(tanks.GetComponentsInChildren<Renderer>(true).Length >= 32,
                "Fuel Ramp tank silhouettes are incomplete");
            Transform rack = FindDescendant(outer, "FuelRamp_LoadingRack_LANDMARK");
            Require(rack != null && rack.GetComponentsInChildren<Renderer>(true).Length >= 12,
                "Fuel Ramp loading rack silhouette is incomplete");
            Transform stack = FindDescendant(outer, "Drain4B_DrainStack_LANDMARK");
            Require(stack != null && stack.GetComponentsInChildren<Renderer>(true).Length >= 10,
                "Drain 4-B stack silhouette is incomplete");
            Transform pool = FindDescendant(outer, "Drain4B_BlackSettlingPool_LANDMARK");
            Require(pool != null && pool.childCount == PoolSegments,
                "Drain 4-B must retain its segmented settling pool");
            Require(pool.GetComponentsInChildren<Renderer>(true).Length == PoolSegments * 2,
                "Drain 4-B settling pool silhouette is incomplete");
            Transform bastion = FindDescendant(outer, "Fort14_CommandBastion_LANDMARK");
            Require(bastion != null
                    && bastion.GetComponentsInChildren<Renderer>(true).Length >= 16,
                "Fort 14 command bastion silhouette is incomplete");
            Require(outer.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Zero Basin outer geometry can obstruct strategic-map interaction");
            Require(outer.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Zero Basin outer geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 70%] PASS: Fort 14, Drain 4-B and the Fuel "
                + "Ramp use fifteen structures, five vehicles, fifty direct MEP "
                + "pipes/barrels/fortifications and five distinct persistent landmarks.");
        }

        private static Placement[] BuildBarrelPlacements()
        {
            var rows = new List<Placement>(ExpectedMepBarrelCount);
            for (int i = 0; i < 8; i++)
            {
                float angle = i * 47f + 8f;
                float radians = angle * Mathf.Deg2Rad;
                rows.Add(new Placement("Drain4B_SludgeBarrel_" + i.ToString("00"),
                    "Drain4B", MepBarrelSource,
                    168f + Mathf.Cos(radians) * (7f + i % 3 * 1.5f),
                    76f + Mathf.Sin(radians) * (6f + i % 2 * 1.5f),
                    0.18f, 0.24f, angle + 11f, 0.012f));
            }
            for (int i = 0; i < 10; i++)
            {
                int row = i / 5;
                rows.Add(new Placement("FuelRamp_FuelBarrel_" + i.ToString("00"),
                    "FuelRamp", MepBarrelSource,
                    138f + (i % 5) * 3.6f + row * 0.8f,
                    35f + row * 3.1f + (i % 2) * 0.4f,
                    0.18f, 0.24f, 14f + (i % 3) * 6f, 0.012f));
            }
            return rows.ToArray();
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
                                        Material material, string[] allowedSources)
        {
            Require(root != null, "a Zero Basin outer placement root is missing");
            var used = new HashSet<string>(StringComparer.Ordinal);
            var allowed = new HashSet<string>(allowedSources, StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Material resolvedMaterial =
                    KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                        placement.AssetPath, material);
                Require(placement.MapX >= 130f && placement.MapX <= 248f
                        && placement.MapY >= 10f && placement.MapY <= 88f,
                    placement.Name + " is outside the reviewed Zero Basin outer nodes");
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath && allowed.Contains(source),
                    placement.Name + " lost its reviewed source link");
                used.Add(source);
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
            Require(used.SetEquals(allowed),
                "a reviewed Zero Basin outer source set is incomplete");
        }

        private static void BuildFuelRampTanks(Transform parent, Material fuel,
                                               Material dark, Material warning)
        {
            Transform root = Child(parent, "FuelRamp_LeaningTanks_LANDMARK");
            Vector2[] centres =
            {
                new Vector2(141f, 43f), new Vector2(147f, 40f),
                new Vector2(152f, 45f), new Vector2(145f, 49f)
            };
            float[] yaws = { 18f, -12f, 24f, -20f };
            for (int i = 0; i < centres.Length; i++)
            {
                Transform tank = Child(root, "LeaningFuelTank_" + i.ToString("00"));
                tank.position = MapToWorld(centres[i].x, centres[i].y)
                    + new Vector3(0f, 0.025f, 0f);
                Quaternion tilt = Quaternion.Euler(0f, yaws[i], 82f + i * 1.4f);
                BuildPrimitive("TankBody", tank, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.42f, 0f), new Vector3(0.24f, 0.68f, 0.24f),
                    tilt, fuel);
                BuildPrimitive("FrontCap", tank, PrimitiveType.Sphere,
                    new Vector3(-0.66f, 0.51f, 0f), new Vector3(0.25f, 0.25f, 0.25f),
                    Quaternion.identity, fuel);
                BuildPrimitive("RearCap", tank, PrimitiveType.Sphere,
                    new Vector3(0.66f, 0.33f, 0f), new Vector3(0.25f, 0.25f, 0.25f),
                    Quaternion.identity, fuel);
                BuildPrimitive("SupportFront", tank, PrimitiveType.Cube,
                    new Vector3(-0.38f, 0.16f, 0f), new Vector3(0.09f, 0.30f, 0.40f),
                    Quaternion.Euler(0f, yaws[i], -8f), dark);
                BuildPrimitive("SupportRear", tank, PrimitiveType.Cube,
                    new Vector3(0.38f, 0.16f, 0f), new Vector3(0.09f, 0.30f, 0.40f),
                    Quaternion.Euler(0f, yaws[i], 8f), dark);
                BuildPrimitive("PressureBandFront", tank, PrimitiveType.Cylinder,
                    new Vector3(-0.28f, 0.46f, 0f), new Vector3(0.255f, 0.035f, 0.255f),
                    tilt, dark);
                BuildPrimitive("PressureBandRear", tank, PrimitiveType.Cylinder,
                    new Vector3(0.28f, 0.38f, 0f), new Vector3(0.255f, 0.035f, 0.255f),
                    tilt, dark);
                BuildPrimitive("WarningValve", tank, PrimitiveType.Sphere,
                    new Vector3(-0.04f, 0.73f, 0.12f), new Vector3(0.08f, 0.08f, 0.08f),
                    Quaternion.identity, warning);
            }
        }

        private static void BuildFuelLoadingRack(Transform parent, Material dark,
                                                 Material fuel, Material warning)
        {
            Transform root = Child(parent, "FuelRamp_LoadingRack_LANDMARK");
            root.position = MapToWorld(147f, 53f) + new Vector3(0f, 0.025f, 0f);
            BuildPrimitive("LoadingDeck", root, PrimitiveType.Cube,
                new Vector3(0f, 0.34f, 0f), new Vector3(1.42f, 0.10f, 0.34f),
                Quaternion.Euler(0f, 18f, 0f), dark);
            for (int i = 0; i < 4; i++)
            {
                float x = -0.57f + i * 0.38f;
                BuildPrimitive("DeckLeg_" + i, root, PrimitiveType.Cube,
                    new Vector3(x, 0.18f, 0f), new Vector3(0.055f, 0.36f, 0.28f),
                    Quaternion.Euler(0f, 18f, 0f), dark);
                BuildPrimitive("LoadingArm_" + i, root, PrimitiveType.Cube,
                    new Vector3(x, 0.58f, 0.14f), new Vector3(0.055f, 0.46f, 0.055f),
                    Quaternion.Euler(12f, 18f, i % 2 == 0 ? -12f : 12f), fuel);
            }
            BuildPrimitive("RackHeader", root, PrimitiveType.Cube,
                new Vector3(0f, 0.78f, 0.15f), new Vector3(1.25f, 0.055f, 0.055f),
                Quaternion.Euler(0f, 18f, 0f), fuel);
            BuildPrimitive("WarningLampWest", root, PrimitiveType.Sphere,
                new Vector3(-0.62f, 0.84f, 0.15f), new Vector3(0.075f, 0.075f, 0.075f),
                Quaternion.identity, warning);
            BuildPrimitive("WarningLampEast", root, PrimitiveType.Sphere,
                new Vector3(0.62f, 0.84f, 0.15f), new Vector3(0.075f, 0.075f, 0.075f),
                Quaternion.identity, warning);
        }

        private static void BuildDrainStack(Transform parent, Material dark,
                                            Material pipes, Material toxic,
                                            Material warning)
        {
            Transform root = Child(parent, "Drain4B_DrainStack_LANDMARK");
            root.position = MapToWorld(168f, 76f) + new Vector3(0f, 0.025f, 0f);
            BuildPrimitive("StackFoundation", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.10f, 0f), new Vector3(0.42f, 0.10f, 0.42f),
                Quaternion.identity, dark);
            BuildPrimitive("DrainStack", root, PrimitiveType.Cylinder,
                new Vector3(0f, 0.88f, 0f), new Vector3(0.24f, 0.78f, 0.24f),
                Quaternion.Euler(0f, 0f, 3f), pipes);
            for (int i = 0; i < 4; i++)
                BuildPrimitive("StackCollar_" + i, root, PrimitiveType.Cylinder,
                    new Vector3(0f, 0.38f + i * 0.36f, 0f),
                    new Vector3(0.31f, 0.035f, 0.31f), Quaternion.identity, dark);
            BuildPrimitive("ToxicHeader", root, PrimitiveType.Cylinder,
                new Vector3(0.12f, 1.63f, 0f), new Vector3(0.18f, 0.22f, 0.18f),
                Quaternion.Euler(0f, 0f, 72f), toxic);
            BuildPrimitive("OverflowSpout", root, PrimitiveType.Cube,
                new Vector3(0.34f, 1.56f, 0f), new Vector3(0.48f, 0.10f, 0.16f),
                Quaternion.Euler(0f, 8f, -8f), pipes);
            BuildPrimitive("WarningLamp", root, PrimitiveType.Sphere,
                new Vector3(-0.13f, 1.72f, 0f), new Vector3(0.08f, 0.08f, 0.08f),
                Quaternion.identity, warning);
            BuildPrimitive("ServiceBrace", root, PrimitiveType.Cube,
                new Vector3(-0.28f, 0.78f, 0f), new Vector3(0.055f, 1.10f, 0.055f),
                Quaternion.Euler(0f, 0f, -10f), dark);
        }

        private static void BuildSettlingPool(Transform parent, Material retaining,
                                              Material toxic, Material warning)
        {
            Transform root = Child(parent, "Drain4B_BlackSettlingPool_LANDMARK");
            const float radius = 1.12f;
            float segmentLength = 2f * Mathf.PI * radius / PoolSegments * 0.84f;
            for (int segment = 0; segment < PoolSegments; segment++)
            {
                Transform pair = Child(root, "SettlingPair_" + segment.ToString("00"));
                float angle = segment * (360f / PoolSegments) + 7f;
                float radians = angle * Mathf.Deg2Rad;
                float mapX = 168f + Mathf.Cos(radians) * radius / WorldScale;
                float mapY = 82f - Mathf.Sin(radians) * radius / WorldScale;
                Vector3 retainingPosition = MapToWorld(mapX, mapY)
                    + new Vector3(0f, 0.042f, 0f);
                BuildPrimitive("RetainingSegment", pair, PrimitiveType.Cube,
                    retainingPosition, new Vector3(segmentLength, 0.065f, 0.11f),
                    Quaternion.Euler(0f, -angle + 90f, segment % 2 == 0 ? 2f : -2f),
                    segment % 5 == 0 ? warning : retaining);
                float innerRadius = radius - 0.17f;
                float waterX = 168f + Mathf.Cos(radians) * innerRadius / WorldScale;
                float waterY = 82f - Mathf.Sin(radians) * innerRadius / WorldScale;
                BuildPrimitive("ToxicWaterSegment", pair, PrimitiveType.Cube,
                    MapToWorld(waterX, waterY) + new Vector3(0f, 0.028f, 0f),
                    new Vector3(segmentLength * 0.96f, 0.022f, 0.28f),
                    Quaternion.Euler(0f, -angle + 90f, 0f), toxic);
            }
        }

        private static void BuildFortBastion(Transform parent, Material dark,
                                             Material armour, Material warning)
        {
            Transform root = Child(parent, "Fort14_CommandBastion_LANDMARK");
            root.position = MapToWorld(232f, 22f) + new Vector3(0f, 0.025f, 0f);
            BuildPrimitive("BastionBase", root, PrimitiveType.Cube,
                new Vector3(0f, 0.20f, 0f), new Vector3(1.42f, 0.40f, 1.06f),
                Quaternion.Euler(0f, 0f, 0f), dark);
            BuildPrimitive("CommandBlock", root, PrimitiveType.Cube,
                new Vector3(0f, 0.52f, -0.08f), new Vector3(0.92f, 0.38f, 0.72f),
                Quaternion.identity, armour);
            BuildPrimitive("CommandRoof", root, PrimitiveType.Cube,
                new Vector3(0f, 0.75f, -0.08f), new Vector3(1.04f, 0.09f, 0.82f),
                Quaternion.identity, dark);
            Vector3[] towerPositions =
            {
                new Vector3(-0.65f, 0f, -0.45f), new Vector3(0.65f, 0f, -0.45f),
                new Vector3(-0.65f, 0f, 0.45f), new Vector3(0.65f, 0f, 0.45f)
            };
            for (int i = 0; i < towerPositions.Length; i++)
            {
                Vector3 p = towerPositions[i];
                BuildPrimitive("CornerTower_" + i, root, PrimitiveType.Cylinder,
                    p + new Vector3(0f, 0.50f, 0f), new Vector3(0.24f, 0.50f, 0.24f),
                    Quaternion.identity, armour);
                BuildPrimitive("CornerCap_" + i, root, PrimitiveType.Cylinder,
                    p + new Vector3(0f, 1.02f, 0f), new Vector3(0.31f, 0.055f, 0.31f),
                    Quaternion.identity, dark);
                BuildPrimitive("WarningBeacon_" + i, root, PrimitiveType.Sphere,
                    p + new Vector3(0f, 1.14f, 0f), new Vector3(0.07f, 0.07f, 0.07f),
                    Quaternion.identity, warning);
            }
            BuildPrimitive("FrontBlastApron", root, PrimitiveType.Cube,
                new Vector3(0f, 0.15f, 0.72f), new Vector3(0.92f, 0.30f, 0.24f),
                Quaternion.Euler(12f, 0f, 0f), armour);
            BuildPrimitive("WestShoulder", root, PrimitiveType.Cube,
                new Vector3(-0.90f, 0.23f, 0.18f), new Vector3(0.42f, 0.38f, 0.58f),
                Quaternion.Euler(0f, -12f, 0f), dark);
            BuildPrimitive("EastShoulder", root, PrimitiveType.Cube,
                new Vector3(0.90f, 0.23f, 0.18f), new Vector3(0.42f, 0.38f, 0.58f),
                Quaternion.Euler(0f, 12f, 0f), dark);
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
                    "MEP source material is unavailable for Zero Basin outer nodes: "
                    + sourcePath);
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
                "Kromka model iteration 14 validation failed: " + message);
        }
    }
}
#endif
