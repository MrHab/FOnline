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
    /// Environment-model iteration 08/20. The Tract Isthmus becomes the only
    /// credible heavy-traffic corridor: four named infrastructure nodes sit on
    /// a fortified road, while two abandoned vehicle fields show its cost.
    /// </summary>
    internal static class KromkaGlobalMapTractInfrastructureAuthoring
    {
        internal const int ModelIteration = 8;
        internal const int ModelIterationCount = 20;
        private const int ExpectedHubCount = 4;
        private const int ExpectedStructureCount = 13;
        private const int ExpectedContainerCount = 12;
        private const int ExpectedCraneCount = 2;
        private const int ExpectedMepFortificationCount = 19;
        private const int ExpectedVehicleCount = 18;
        private const int ExpectedDebrisCount = 16;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string CityRoot =
            "Assets/ThirdParty/Kenney/CityKitIndustrial20/";
        private const string CityModelRoot = CityRoot + "Models/";
        private const string CityPalettePath = CityRoot + "Textures/variation-b.png";
        private const string CarRoot = "Assets/ThirdParty/Kenney/CarKit31/";
        private const string CarModelRoot = CarRoot + "Models/";
        private const string CarPalettePath = CarRoot + "Textures/colormap.png";
        private const string FactoryModelRoot =
            "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string MepRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepSourceMaterialPath =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string StructureMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Tract_KenneyStructures.mat";
        private const string VehicleMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Tract_CarWrecks.mat";
        private const string MepMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Tract_MEPFortifications.mat";
        private const string SteelMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Tract_RouteSteel.mat";
        private const string FactoryRustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_OreArc_KenneyRust.mat";

        private static readonly string[] StructureModels =
        {
            CityModelRoot + "building-a.fbx",
            CityModelRoot + "building-b.fbx",
            CityModelRoot + "building-d.fbx",
            CityModelRoot + "building-g.fbx",
            CityModelRoot + "building-h.fbx",
            CityModelRoot + "building-k.fbx",
            CityModelRoot + "building-o.fbx",
            CityModelRoot + "building-s.fbx",
            CityModelRoot + "building-t.fbx"
        };

        private static readonly string[] ContainerModels =
        {
            CityModelRoot + "shipping-container-a.fbx",
            CityModelRoot + "shipping-container-b.fbx",
            CityModelRoot + "shipping-container-c.fbx"
        };

        private static readonly string[] CraneModels =
        {
            FactoryModelRoot + "crane.fbx",
            FactoryModelRoot + "crane-lift.fbx"
        };

        private static readonly string[] FortificationPrefabs =
        {
            MepRoot + "MEP_StoneWall_01_N.prefab",
            MepRoot + "MEP_StoneWall_02_N.prefab",
            MepRoot + "MEP_Fence_01_N.prefab",
            MepRoot + "MEP_Fence_02_N.prefab",
            MepRoot + "MEP_Fence_03_N.prefab",
            MepRoot + "MEP_Wall_01_N.prefab"
        };

        private static readonly string[] VehicleModels =
        {
            CarModelRoot + "truck.fbx",
            CarModelRoot + "truck-flat.fbx",
            CarModelRoot + "van.fbx",
            CarModelRoot + "delivery.fbx",
            CarModelRoot + "firetruck.fbx",
            CarModelRoot + "garbage-truck.fbx",
            CarModelRoot + "sedan.fbx",
            CarModelRoot + "suv.fbx",
            CarModelRoot + "tractor.fbx"
        };

        private static readonly string[] DebrisModels =
        {
            CarModelRoot + "debris-tire.fbx",
            CarModelRoot + "debris-door.fbx",
            CarModelRoot + "debris-bumper.fbx",
            CarModelRoot + "wheel-truck.fbx"
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
            new Placement("Crossroads_FreightWarehouse", "Crossroads",
                StructureModels[7], 117f, 149f, 0.70f, 0.48f, 2f, 0.018f),
            new Placement("Crossroads_ServiceGarage", "Crossroads",
                StructureModels[6], 126f, 147f, 0.62f, 0.60f, -7f, 0.018f),
            new Placement("Crossroads_CafeFort", "Crossroads",
                StructureModels[4], 135f, 150f, 0.62f, 0.50f, -14f, 0.018f),
            new Placement("Crossroads_CoveredMarket", "Crossroads",
                StructureModels[5], 115f, 158f, 0.62f, 0.48f, 13f, 0.018f),
            new Placement("Crossroads_LeagueOffice", "Crossroads",
                StructureModels[1], 128f, 162f, 0.65f, 0.68f, 6f, 0.020f),
            new Placement("Crossroads_RepairHouse", "Crossroads",
                StructureModels[8], 138f, 158f, 0.60f, 0.48f, -20f, 0.018f),
            new Placement("Arsenal6_Barracks", "Arsenal6",
                StructureModels[0], 168f, 157f, 0.72f, 0.70f, -8f, 0.025f),
            new Placement("Arsenal6_WatchBlock", "Arsenal6",
                StructureModels[2], 178f, 159f, 0.62f, 0.78f, 8f, 0.025f),
            new Placement("Arsenal6_RailOffice", "Arsenal6",
                StructureModels[3], 172f, 168f, 0.60f, 0.58f, 19f, 0.025f),
            new Placement("PolymerStore_CollapsedCanopy", "PolymerStore",
                StructureModels[7], 80f, 141f, 0.68f, 0.46f, 6f, 0.020f),
            new Placement("PolymerStore_SortingHall", "PolymerStore",
                StructureModels[4], 89f, 147f, 0.60f, 0.48f, -18f, 0.020f),
            new Placement("BypassDepot_Roundhouse", "BypassDepot",
                StructureModels[6], 237f, 142f, 0.66f, 0.60f, -12f, 0.020f),
            new Placement("BypassDepot_Dispatch", "BypassDepot",
                StructureModels[0], 248f, 148f, 0.68f, 0.66f, 17f, 0.020f)
        };

        private static readonly Placement[] Containers =
        {
            new Placement("Crossroads_ContainerA", "Crossroads", ContainerModels[0],
                108f, 147f, 0.34f, 0.24f, 4f, 0.010f),
            new Placement("Crossroads_ContainerB", "Crossroads", ContainerModels[1],
                110f, 152f, 0.34f, 0.24f, 2f, 0.010f),
            new Placement("Crossroads_ContainerC", "Crossroads", ContainerModels[2],
                141f, 145f, 0.34f, 0.24f, -9f, 0.010f),
            new Placement("Crossroads_ContainerD", "Crossroads", ContainerModels[0],
                144f, 149f, 0.34f, 0.24f, -11f, 0.010f),
            new Placement("Polymer_ContainerA", "PolymerStore", ContainerModels[0],
                72f, 138f, 0.34f, 0.24f, 6f, 0.010f),
            new Placement("Polymer_ContainerB", "PolymerStore", ContainerModels[1],
                75f, 143f, 0.34f, 0.24f, 3f, 0.010f),
            new Placement("Polymer_ContainerC", "PolymerStore", ContainerModels[2],
                78f, 148f, 0.34f, 0.24f, -2f, 0.010f),
            new Placement("Polymer_ContainerD", "PolymerStore", ContainerModels[1],
                90f, 139f, 0.34f, 0.24f, -17f, 0.010f),
            new Placement("Bypass_ContainerA", "BypassDepot", ContainerModels[0],
                231f, 149f, 0.34f, 0.24f, -8f, 0.010f),
            new Placement("Bypass_ContainerB", "BypassDepot", ContainerModels[1],
                235f, 153f, 0.34f, 0.24f, -10f, 0.010f),
            new Placement("Bypass_ContainerC", "BypassDepot", ContainerModels[2],
                244f, 138f, 0.34f, 0.24f, 12f, 0.010f),
            new Placement("Bypass_ContainerD", "BypassDepot", ContainerModels[2],
                253f, 142f, 0.34f, 0.24f, 18f, 0.010f)
        };

        private static readonly Placement[] Cranes =
        {
            new Placement("Crossroads_CargoCrane", "Crossroads", CraneModels[1],
                123f, 154f, 0.72f, 0.78f, 5f, 0.020f),
            new Placement("BypassDepot_CargoCrane", "BypassDepot", CraneModels[0],
                242f, 146f, 0.74f, 0.82f, -17f, 0.020f)
        };

        private static readonly Placement[] Fortifications =
        {
            new Placement("Crossroads_WallSW", "Crossroads", FortificationPrefabs[0], 109f, 143f, 0.48f, 0.23f, 4f, 0.016f),
            new Placement("Crossroads_WallSouth", "Crossroads", FortificationPrefabs[1], 119f, 141f, 0.48f, 0.23f, 2f, 0.016f),
            new Placement("Crossroads_FenceSE", "Crossroads", FortificationPrefabs[2], 132f, 141f, 0.44f, 0.22f, -2f, 0.012f),
            new Placement("Crossroads_FenceEast", "Crossroads", FortificationPrefabs[3], 146f, 153f, 0.44f, 0.22f, 79f, 0.012f),
            new Placement("Crossroads_FenceNE", "Crossroads", FortificationPrefabs[4], 142f, 165f, 0.44f, 0.22f, -14f, 0.012f),
            new Placement("Crossroads_WallNorth", "Crossroads", FortificationPrefabs[5], 128f, 168f, 0.48f, 0.23f, 2f, 0.016f),
            new Placement("Crossroads_FenceNW", "Crossroads", FortificationPrefabs[2], 111f, 164f, 0.44f, 0.22f, 17f, 0.012f),
            new Placement("Arsenal6_WallSW", "Arsenal6", FortificationPrefabs[0], 162f, 153f, 0.50f, 0.24f, -12f, 0.018f),
            new Placement("Arsenal6_WallSouth", "Arsenal6", FortificationPrefabs[1], 170f, 150f, 0.50f, 0.24f, -2f, 0.018f),
            new Placement("Arsenal6_WallSE", "Arsenal6", FortificationPrefabs[5], 180f, 152f, 0.50f, 0.24f, 16f, 0.018f),
            new Placement("Arsenal6_FenceEast", "Arsenal6", FortificationPrefabs[3], 184f, 161f, 0.44f, 0.22f, 82f, 0.012f),
            new Placement("Arsenal6_WallNorth", "Arsenal6", FortificationPrefabs[0], 180f, 171f, 0.50f, 0.24f, -18f, 0.018f),
            new Placement("Arsenal6_FenceNW", "Arsenal6", FortificationPrefabs[4], 168f, 175f, 0.44f, 0.22f, 8f, 0.012f),
            new Placement("Polymer_WallWest", "PolymerStore", FortificationPrefabs[0], 71f, 149f, 0.46f, 0.22f, 78f, 0.016f),
            new Placement("Polymer_FenceNorth", "PolymerStore", FortificationPrefabs[2], 84f, 153f, 0.42f, 0.21f, 4f, 0.012f),
            new Placement("Bypass_WallSouth", "BypassDepot", FortificationPrefabs[1], 232f, 137f, 0.48f, 0.23f, -9f, 0.016f),
            new Placement("Bypass_FenceEast", "BypassDepot", FortificationPrefabs[3], 256f, 148f, 0.44f, 0.22f, 76f, 0.012f),
            new Placement("Bypass_WallNorth", "BypassDepot", FortificationPrefabs[5], 246f, 156f, 0.48f, 0.23f, 11f, 0.016f),
            new Placement("Bypass_FenceWest", "BypassDepot", FortificationPrefabs[4], 228f, 146f, 0.44f, 0.22f, 81f, 0.012f)
        };

        private static readonly Placement[] Vehicles =
        {
            new Placement("WestGraveyard_Truck", "WestGraveyard", VehicleModels[0], 38f, 146f, 0.46f, 0.27f, 66f, 0.018f),
            new Placement("WestGraveyard_VanA", "WestGraveyard", VehicleModels[2], 46f, 153f, 0.35f, 0.23f, -31f, 0.016f),
            new Placement("WestGraveyard_SedanA", "WestGraveyard", VehicleModels[6], 54f, 142f, 0.31f, 0.20f, 17f, 0.014f),
            new Placement("WestGraveyard_Firetruck", "WestGraveyard", VehicleModels[4], 61f, 158f, 0.46f, 0.28f, -63f, 0.018f),
            new Placement("WestGraveyard_GarbageTruck", "WestGraveyard", VehicleModels[5], 68f, 150f, 0.44f, 0.27f, 38f, 0.018f),
            new Placement("WestGraveyard_SuvA", "WestGraveyard", VehicleModels[7], 50f, 165f, 0.34f, 0.22f, 79f, 0.016f),
            new Placement("WestGraveyard_Tractor", "WestGraveyard", VehicleModels[8], 32f, 160f, 0.39f, 0.28f, -18f, 0.018f),
            new Placement("WestGraveyard_Delivery", "WestGraveyard", VehicleModels[3], 71f, 138f, 0.39f, 0.25f, -72f, 0.016f),
            new Placement("WestGraveyard_FlatTruck", "WestGraveyard", VehicleModels[1], 62f, 170f, 0.43f, 0.26f, 11f, 0.018f),
            new Placement("WestGraveyard_SedanB", "WestGraveyard", VehicleModels[6], 43f, 136f, 0.31f, 0.20f, 103f, 0.014f),
            new Placement("WestGraveyard_VanB", "WestGraveyard", VehicleModels[2], 73f, 163f, 0.35f, 0.23f, 54f, 0.016f),
            new Placement("WestGraveyard_SuvB", "WestGraveyard", VehicleModels[7], 35f, 134f, 0.34f, 0.22f, -49f, 0.016f),
            new Placement("EastConvoy_Truck", "EastConvoy", VehicleModels[0], 238f, 151f, 0.44f, 0.27f, -41f, 0.018f),
            new Placement("EastConvoy_Delivery", "EastConvoy", VehicleModels[3], 247f, 145f, 0.38f, 0.24f, -37f, 0.016f),
            new Placement("EastConvoy_Firetruck", "EastConvoy", VehicleModels[4], 256f, 158f, 0.45f, 0.28f, -52f, 0.018f),
            new Placement("EastConvoy_GarbageTruck", "EastConvoy", VehicleModels[5], 265f, 150f, 0.43f, 0.27f, -46f, 0.018f),
            new Placement("EastConvoy_Sedan", "EastConvoy", VehicleModels[6], 273f, 142f, 0.31f, 0.20f, -36f, 0.014f),
            new Placement("EastConvoy_Tractor", "EastConvoy", VehicleModels[8], 253f, 137f, 0.38f, 0.27f, -44f, 0.018f)
        };

        private static readonly Placement[] Debris =
        {
            new Placement("WestDebris_TiresA", "WestGraveyard", DebrisModels[0], 34f, 143f, 0.18f, 0.12f, 12f, 0.008f),
            new Placement("WestDebris_DoorA", "WestGraveyard", DebrisModels[1], 42f, 150f, 0.16f, 0.09f, 62f, 0.006f),
            new Placement("WestDebris_BumperA", "WestGraveyard", DebrisModels[2], 48f, 139f, 0.17f, 0.08f, -31f, 0.006f),
            new Placement("WestDebris_WheelA", "WestGraveyard", DebrisModels[3], 56f, 153f, 0.18f, 0.12f, 44f, 0.008f),
            new Placement("WestDebris_TiresB", "WestGraveyard", DebrisModels[0], 64f, 145f, 0.18f, 0.12f, -18f, 0.008f),
            new Placement("WestDebris_DoorB", "WestGraveyard", DebrisModels[1], 70f, 155f, 0.16f, 0.09f, 23f, 0.006f),
            new Placement("WestDebris_BumperB", "WestGraveyard", DebrisModels[2], 39f, 166f, 0.17f, 0.08f, 71f, 0.006f),
            new Placement("WestDebris_WheelB", "WestGraveyard", DebrisModels[3], 57f, 168f, 0.18f, 0.12f, -47f, 0.008f),
            new Placement("WestDebris_TiresC", "WestGraveyard", DebrisModels[0], 69f, 168f, 0.18f, 0.12f, 36f, 0.008f),
            new Placement("WestDebris_DoorC", "WestGraveyard", DebrisModels[1], 30f, 153f, 0.16f, 0.09f, -72f, 0.006f),
            new Placement("EastDebris_TiresA", "EastConvoy", DebrisModels[0], 242f, 156f, 0.18f, 0.12f, 31f, 0.008f),
            new Placement("EastDebris_DoorA", "EastConvoy", DebrisModels[1], 250f, 150f, 0.16f, 0.09f, -18f, 0.006f),
            new Placement("EastDebris_BumperA", "EastConvoy", DebrisModels[2], 260f, 143f, 0.17f, 0.08f, 54f, 0.006f),
            new Placement("EastDebris_WheelA", "EastConvoy", DebrisModels[3], 269f, 154f, 0.18f, 0.12f, -36f, 0.008f),
            new Placement("EastDebris_TiresB", "EastConvoy", DebrisModels[0], 278f, 148f, 0.18f, 0.12f, 16f, 0.008f),
            new Placement("EastDebris_DoorB", "EastConvoy", DebrisModels[1], 257f, 133f, 0.16f, 0.09f, 67f, 0.006f)
        };

        internal static void Compose(Transform parent)
        {
            ConfigureImportedAssets();
            Material structures = BuildPaletteMaterial(StructureMaterialPath,
                "Kromka_Tract_KenneyStructures", CityPalettePath,
                new Color(0.69f, 0.63f, 0.52f, 1f), 0.12f, 0.18f);
            structures = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                CityModelRoot, structures);
            Material vehicles = BuildSolidMaterial(VehicleMaterialPath,
                "Kromka_Tract_CarWrecks",
                new Color(0.48f, 0.30f, 0.18f, 1f), 0.26f, 0.10f);
            vehicles = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                CarModelRoot, vehicles);
            Material mep = BuildMepMaterial();
            Material steel = BuildSolidMaterial(SteelMaterialPath,
                "Kromka_Tract_RouteSteel", new Color(0.30f, 0.27f, 0.21f, 1f),
                0.38f, 0.18f);
            Material factoryRust = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                FactoryModelRoot,
                AssetDatabase.LoadAssetAtPath<Material>(FactoryRustMaterialPath));
            if (factoryRust == null)
                throw new InvalidOperationException("Ore Arc factory-rust material is missing");

            Transform root = Child(parent, "TractIsthmus_Infrastructure_MEP_Kenney");
            PlaceSet(Structures, Child(root, "FourNamedNodes_EDITABLE"), structures);
            PlaceSet(Containers, Child(root, "CargoContainers_EDITABLE"), structures);
            PlaceSet(Cranes, Child(root, "CargoCranes_EDITABLE"), factoryRust);
            PlaceSet(Fortifications, Child(root, "MEPFortifications_EDITABLE"), mep);
            PlaceSet(Vehicles, Child(root, "VehicleGraveyards_EDITABLE"), vehicles);
            PlaceSet(Debris, Child(root, "VehicleDebris_EDITABLE"), vehicles);
            BuildRoutePylon(root, steel);
            BuildBypassTurntable(root, steel);

            Child(parent, "TractNamedNodes_4_REFERENCE");
            Child(parent, "KenneyStructures_13_REFERENCE");
            Child(parent, "CargoContainers_12_REFERENCE");
            Child(parent, "CargoCranes_2_REFERENCE");
            Child(parent, "DirectMEPFortifications_19_REFERENCE");
            Child(parent, "AbandonedVehicles_18_REFERENCE");
            Child(parent, "VehicleDebris_16_REFERENCE");
            Child(parent, "VehicleFields_2_REFERENCE");
            Child(parent, "RoutePylonAndTurntable_2_REFERENCE");
            Child(parent, "KenneyCarKit31_CC0_REFERENCE");
            Child(parent, "PersistentTractGeometry_REFERENCE");
            Child(parent, "ModelIteration_08_of_20");
        }

        internal static void ValidateIteration08()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException("Model iteration 08 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "TractNamedNodes_4_REFERENCE", "KenneyStructures_13_REFERENCE",
                "CargoContainers_12_REFERENCE", "CargoCranes_2_REFERENCE",
                "DirectMEPFortifications_19_REFERENCE", "AbandonedVehicles_18_REFERENCE",
                "VehicleDebris_16_REFERENCE", "VehicleFields_2_REFERENCE",
                "RoutePylonAndTurntable_2_REFERENCE", "KenneyCarKit31_CC0_REFERENCE",
                "PersistentTractGeometry_REFERENCE", "ModelIteration_08_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            Require(Structures.Length == ExpectedStructureCount, "thirteen Tract structures are required");
            Require(Containers.Length == ExpectedContainerCount, "twelve cargo containers are required");
            Require(Cranes.Length == ExpectedCraneCount, "two cargo cranes are required");
            Require(Fortifications.Length == ExpectedMepFortificationCount, "nineteen MEP fortifications are required");
            Require(Vehicles.Length == ExpectedVehicleCount, "eighteen abandoned vehicles are required");
            Require(Debris.Length == ExpectedDebrisCount, "sixteen vehicle debris pieces are required");

            Transform tract = FindDescendant(root, "TractIsthmus_Infrastructure_MEP_Kenney");
            Transform structureRoot = FindDescendant(tract, "FourNamedNodes_EDITABLE");
            Transform containerRoot = FindDescendant(tract, "CargoContainers_EDITABLE");
            Transform craneRoot = FindDescendant(tract, "CargoCranes_EDITABLE");
            Transform fortRoot = FindDescendant(tract, "MEPFortifications_EDITABLE");
            Transform vehicleRoot = FindDescendant(tract, "VehicleGraveyards_EDITABLE");
            Transform debrisRoot = FindDescendant(tract, "VehicleDebris_EDITABLE");
            Require(structureRoot != null && structureRoot.childCount == ExpectedHubCount, "the four named Tract nodes are incomplete");
            Require(containerRoot != null && containerRoot.childCount == 3, "containers must remain limited to three cargo nodes");
            Require(craneRoot != null && craneRoot.childCount == 2, "cranes must remain grouped at Crossroads and Bypass Depot");
            Require(fortRoot != null && fortRoot.childCount == ExpectedHubCount, "MEP fortifications must protect all four named nodes");
            Require(vehicleRoot != null && vehicleRoot.childCount == 2, "two separated vehicle fields are required");
            Require(debrisRoot != null && debrisRoot.childCount == 2, "vehicle debris must follow the two vehicle fields");

            Material structureMaterial = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                CityModelRoot, AssetDatabase.LoadAssetAtPath<Material>(StructureMaterialPath));
            Material vehicleMaterial = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                CarModelRoot, AssetDatabase.LoadAssetAtPath<Material>(VehicleMaterialPath));
            Material mepMaterial = AssetDatabase.LoadAssetAtPath<Material>(MepMaterialPath);
            Material factoryRust = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(
                FactoryModelRoot, AssetDatabase.LoadAssetAtPath<Material>(FactoryRustMaterialPath));
            Material steel = AssetDatabase.LoadAssetAtPath<Material>(SteelMaterialPath);
            Require(structureMaterial != null && vehicleMaterial != null && mepMaterial != null && factoryRust != null && steel != null,
                "one or more Tract strategic materials are missing");
            Texture2D carPalette = AssetDatabase.LoadAssetAtPath<Texture2D>(CarPalettePath);
            Require(carPalette != null && vehicleMaterial.GetTexture("_BaseMap") == carPalette,
                "Tract vehicles lost the original Car Kit texture atlas");
            KromkaGlobalMapNativeModelMaterialAuthoring.ValidateSourceAtlases();

            ValidateSet(structureRoot, Structures, structureMaterial, CityModelRoot, StructureModels);
            ValidateSet(containerRoot, Containers, structureMaterial, CityModelRoot, ContainerModels);
            ValidateSet(craneRoot, Cranes, factoryRust, FactoryModelRoot, CraneModels);
            ValidateSet(fortRoot, Fortifications, mepMaterial, MepRoot, FortificationPrefabs);
            ValidateSet(vehicleRoot, Vehicles, vehicleMaterial, CarModelRoot, VehicleModels);
            ValidateSet(debrisRoot, Debris, vehicleMaterial, CarModelRoot, DebrisModels);

            Transform pylon = FindDescendant(tract, "Crossroads_RoutePylon_LANDMARK");
            Transform turntable = FindDescendant(tract, "BypassDepot_Turntable_LANDMARK");
            Require(pylon != null && pylon.GetComponentsInChildren<Renderer>(true).Length == 3,
                "Crossroads route pylon silhouette is incomplete");
            Require(turntable != null && turntable.GetComponentsInChildren<Renderer>(true).Length == 3,
                "Bypass Depot turntable silhouette is incomplete");
            Require(pylon.GetComponentsInChildren<Collider>(true).Length == 0 && turntable.GetComponentsInChildren<Collider>(true).Length == 0,
                "custom Tract landmarks can obstruct strategic-map interaction");

            Debug.Log("[KROMKA MODELS 40%] PASS: four named Tract nodes, nineteen "
                + "direct MEP fortifications, two cargo cranes, eighteen CC0 Kenney "
                + "vehicle wrecks and two separated graveyards define the heavy corridor.");
        }

        private static void PlaceSet(Placement[] placements, Transform root, Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform zone = root.Find(placement.Zone) ?? Child(root, placement.Zone);
                GameObject instance = KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                    placement.AssetPath, placement.Name, zone, placement.MapX, placement.MapY,
                    placement.Footprint, placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(material,
                        renderers[rendererIndex].sharedMaterials.Length).ToArray();
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements, Material material,
                                        string sourceRoot, string[] expectedSources)
        {
            var sources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Require(placement.MapX >= 20f && placement.MapX <= 282f && placement.MapY >= 130f && placement.MapY <= 176f,
                    placement.Name + " is outside the reviewed Tract corridor");
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath && source.StartsWith(sourceRoot, StringComparison.Ordinal),
                    placement.Name + " lost its reviewed source link");
                sources.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials.All(shared => shared == material)),
                    placement.Name + " lost its strategic material");
                Bounds bounds = Encapsulate(renderers);
                float footprint = Mathf.Max(bounds.size.x, bounds.size.z);
                Require(Mathf.Abs(footprint - placement.Footprint) <= 0.035f,
                    placement.Name + " footprint drifted from its reviewed scale");
                Require(bounds.size.y <= placement.MaximumHeight + 0.035f,
                    placement.Name + " is too tall for the strategic-map scale");
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(placement.MapX, placement.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.035f,
                    placement.Name + " is not grounded on the authored relief");
                Require(instance.GetComponentsInChildren<Collider>(true).All(collider => !collider.enabled),
                    placement.Name + " can obstruct strategic-map interaction");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    placement.Name + " can disappear with camera distance");
            }
            Require(sources.SetEquals(expectedSources), "a reviewed source set is incomplete");
        }

        private static void ConfigureImportedAssets()
        {
            string[] models = StructureModels.Concat(ContainerModels).Concat(CraneModels)
                .Concat(VehicleModels).Concat(DebrisModels).Distinct(StringComparer.Ordinal).ToArray();
            for (int i = 0; i < models.Length; i++)
            {
                ModelImporter importer = AssetImporter.GetAtPath(models[i]) as ModelImporter;
                if (importer == null)
                    throw new InvalidOperationException("Missing Tract model importer: " + models[i]);
                bool changed = importer.importAnimation || importer.importCameras || importer.importLights
                    || importer.importBlendShapes || importer.materialImportMode != ModelImporterMaterialImportMode.None;
                importer.importAnimation = false;
                importer.importCameras = false;
                importer.importLights = false;
                importer.importBlendShapes = false;
                importer.materialImportMode = ModelImporterMaterialImportMode.None;
                if (changed) importer.SaveAndReimport();
            }
            ConfigurePalette(CityPalettePath);
            ConfigurePalette(CarPalettePath);
        }

        private static void ConfigurePalette(string path)
        {
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null)
                throw new InvalidOperationException("Missing Tract palette importer: " + path);
            bool changed = !importer.sRGBTexture || importer.mipmapEnabled
                || importer.textureCompression != TextureImporterCompression.Uncompressed
                || importer.filterMode != FilterMode.Point || importer.wrapMode != TextureWrapMode.Clamp;
            importer.sRGBTexture = true;
            importer.mipmapEnabled = false;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.filterMode = FilterMode.Point;
            importer.wrapMode = TextureWrapMode.Clamp;
            if (changed) importer.SaveAndReimport();
        }

        private static Material BuildPaletteMaterial(string path, string name, string texturePath,
                                                     Color tint, float metallic, float smoothness)
        {
            Texture2D palette = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (palette == null)
                throw new InvalidOperationException("Missing Tract palette: " + texturePath);
            Material material = BuildSolidMaterial(path, name, tint, metallic, smoothness);
            material.SetTexture("_BaseMap", palette);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildMepMaterial()
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(MepSourceMaterialPath);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException("MEP Tract source material is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(MepMaterialPath);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, MepMaterialPath);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = "Kromka_Tract_MEPFortifications";
            Color tint = new Color(0.78f, 0.70f, 0.57f, 1f);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name, Color tint,
                                                   float metallic, float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetColor("_BaseColor", tint);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void BuildRoutePylon(Transform parent, Material material)
        {
            Transform root = Child(parent, "Crossroads_RoutePylon_LANDMARK");
            root.localPosition = MapToWorld(125f, 170f);
            BuildPrimitive("WestPost", root, PrimitiveType.Cube, new Vector3(-0.40f, 0.39f, 0f),
                new Vector3(0.08f, 0.78f, 0.08f), Quaternion.identity, material);
            BuildPrimitive("EastPost", root, PrimitiveType.Cube, new Vector3(0.40f, 0.39f, 0f),
                new Vector3(0.08f, 0.78f, 0.08f), Quaternion.identity, material);
            BuildPrimitive("RouteBeam", root, PrimitiveType.Cube, new Vector3(0f, 0.74f, 0f),
                new Vector3(0.88f, 0.12f, 0.10f), Quaternion.Euler(0f, 0f, -2f), material);
        }

        private static void BuildBypassTurntable(Transform parent, Material material)
        {
            Transform root = Child(parent, "BypassDepot_Turntable_LANDMARK");
            root.localPosition = MapToWorld(238f, 158f);
            BuildPrimitive("TurntableDeck", root, PrimitiveType.Cylinder, new Vector3(0f, 0.025f, 0f),
                new Vector3(0.52f, 0.025f, 0.52f), Quaternion.identity, material);
            BuildPrimitive("TurntableRailA", root, PrimitiveType.Cube, new Vector3(0f, 0.065f, 0.08f),
                new Vector3(0.88f, 0.035f, 0.035f), Quaternion.Euler(0f, 17f, 0f), material);
            BuildPrimitive("TurntableRailB", root, PrimitiveType.Cube, new Vector3(0f, 0.065f, -0.08f),
                new Vector3(0.88f, 0.035f, 0.035f), Quaternion.Euler(0f, 17f, 0f), material);
        }

        private static void BuildPrimitive(string name, Transform parent, PrimitiveType type,
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
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(item, StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
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
                "Kromka model iteration 08 validation failed: " + message);
        }
    }
}
#endif
