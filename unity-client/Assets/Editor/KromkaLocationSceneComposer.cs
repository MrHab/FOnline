using System;
using System.Collections.Generic;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Builds the lore-first visual grammar of every Kromka location as ordinary
    /// Unity GameObjects. Nothing is combined into an opaque mesh: designers can
    /// move, replace or delete every building, road, prop and gameplay anchor.
    /// </summary>
    internal static class KromkaLocationSceneComposer
    {
        private const string MaterialRoot = "Assets/Art/Kromka/Materials";

        private static readonly Dictionary<string, Color> RegionColors =
            new Dictionary<string, Color>(StringComparer.Ordinal)
            {
                { "northern_sluices", new Color(0.25f, 0.34f, 0.34f) },
                { "middle_vein", new Color(0.36f, 0.42f, 0.25f) },
                { "ore_arc", new Color(0.48f, 0.24f, 0.14f) },
                { "tract_isthmus", new Color(0.49f, 0.38f, 0.22f) },
                { "chalk_lowland", new Color(0.72f, 0.69f, 0.52f) },
                { "glasslands", new Color(0.20f, 0.37f, 0.36f) },
                { "zero_basin", new Color(0.10f, 0.14f, 0.15f) },
                { "silent_ring", new Color(0.09f, 0.11f, 0.10f) },
                { "off_map", new Color(0.31f, 0.29f, 0.23f) },
                { "regional", new Color(0.39f, 0.32f, 0.22f) }
            };

        public static void Compose(Transform parent, JObject location)
        {
            string id = Text(location, "id");
            string type = Text(location, "locationType");
            string region = Text(location, "macroRegion");
            Color regionColor = ColorFor(region);

            Transform environment = Child(parent, "REGION_LANGUAGE_" + region + "_EDITABLE");
            BuildRegionLanguage(environment, id, region, regionColor);

            Transform layout = Child(parent, "LOCATION_TYPE_" + type + "_EDITABLE");
            switch (type)
            {
                case "tutorial": BuildTutorial(layout, id); break;
                case "settlement": BuildSettlement(layout, id); break;
                case "faction_capital": BuildFactionCapital(layout, id); break;
                case "caravan_hub": BuildCaravanHub(layout, id); break;
                case "road_outpost": BuildRoadOutpost(layout, id); break;
                case "industrial_site": BuildIndustrialSite(layout, id, regionColor); break;
                case "resource_site": BuildResourceSite(layout, id, regionColor); break;
                case "raid_complex": BuildRaidComplex(layout, id, regionColor); break;
                case "mutant_lair": BuildMutantLair(layout, id, regionColor); break;
                case "encounter_template": BuildEncounter(layout, id, regionColor); break;
                case "boundary_expedition": BuildBoundary(layout, id); break;
                case "story_complex": BuildStoryComplex(layout, id, regionColor); break;
                case "personal_base": BuildPersonalBase(layout, id); break;
                case "clan_base": BuildClanBase(layout, id, regionColor); break;
                default: BuildEncounter(layout, id, regionColor); break;
            }
        }

        private static void BuildRegionLanguage(Transform parent, string id, string region, Color color)
        {
            switch (region)
            {
                case "northern_sluices":
                    Strip(parent, id + "-region-canal", new Vector3(-29f, -0.02f, 17f),
                        new Vector3(58f, 0.08f, 7f), "water_channel", Water(), false);
                    Wall(parent, id + "-region-dam-bank", new Vector3(-1f, 1.2f, 12f),
                        new Vector3(62f, 2.4f, 1.5f), Concrete(), true);
                    for (int i = 0; i < 4; i++) Pylon(parent, id + "-region-pylon-" + i,
                        new Vector3(-24f + i * 16f, 0f, 25f), Steel());
                    break;
                case "middle_vein":
                    Strip(parent, id + "-region-irrigation", new Vector3(-31f, -0.03f, 25f),
                        new Vector3(62f, 0.06f, 3f), "irrigation", Water(), false);
                    for (int i = 0; i < 5; i++) Tree(parent, id + "-region-shelterbelt-" + i,
                        new Vector3(-26f + i * 12f, 0f, 30f), color);
                    for (int i = 0; i < 4; i++) Strip(parent, id + "-region-field-" + i,
                        new Vector3(-29f + i * 18f, 0.02f, -29f), new Vector3(13f, 0.04f, 4f),
                        "clean_soil", Soil(), false);
                    break;
                case "ore_arc":
                    for (int i = 0; i < 4; i++) Mound(parent, id + "-region-slag-" + i,
                        new Vector3(-27f + i * 18f, 0f, 28f - (i % 2) * 4f),
                        new Vector3(8f, 3f + i * 0.45f, 6f), Slag());
                    Rails(parent, id + "-region-rail", new Vector3(0f, 0.05f, -27f), 64f);
                    break;
                case "tract_isthmus":
                    Strip(parent, id + "-region-raised-tract", new Vector3(0f, 0.24f, 0f),
                        new Vector3(9f, 0.45f, 72f), "raised_road", Asphalt(), false);
                    Culvert(parent, id + "-region-culvert-west", new Vector3(-6f, 0f, 22f));
                    Culvert(parent, id + "-region-culvert-east", new Vector3(6f, 0f, -20f));
                    break;
                case "chalk_lowland":
                    for (int i = 0; i < 5; i++) Mound(parent, id + "-region-chalk-cliff-" + i,
                        new Vector3(-30f + i * 15f, 0f, 29f), new Vector3(10f, 4f, 4f), Chalk());
                    Ring(parent, id + "-region-karst-window", new Vector3(27f, 0.02f, -24f),
                        5f, 0.7f, Karst(), false);
                    break;
                case "glasslands":
                    for (int i = 0; i < 7; i++)
                    {
                        Transform plate = Group(parent, id + "-region-glass-" + i, "fused_glass",
                            "ground_accent", new[] { "glasslands", "fused-ground" }, false, false);
                        plate.localPosition = new Vector3(-27f + i * 9f, 0.02f,
                            25f - (i % 3) * 4f);
                        GameObject slab = Box("FusedPlate", plate, Vector3.zero,
                            new Vector3(7f, 0.05f, 4f), Glass(), false);
                        slab.transform.localRotation = Quaternion.Euler(0f, i * 19f, (i % 2 == 0 ? 4f : -3f));
                    }
                    for (int i = 0; i < 3; i++) Pylon(parent, id + "-region-leaning-pylon-" + i,
                        new Vector3(-22f + i * 22f, 0f, -29f), ColdSteel(), i % 2 == 0 ? 9f : -12f);
                    break;
                case "zero_basin":
                    for (int i = 0; i < 3; i++) SettlingPool(parent, id + "-region-black-pool-" + i,
                        new Vector3(-23f + i * 23f, 0f, 27f), 7f, BlackWater());
                    PipeRun(parent, id + "-region-main-pipe", new Vector3(0f, 1.1f, -29f), 64f,
                        ColdSteel());
                    break;
                case "silent_ring":
                    for (int i = 0; i < 4; i++) Ring(parent, id + "-region-crater-" + i,
                        new Vector3(-25f + i * 17f, 0.01f, 27f - (i % 2) * 6f),
                        4f + i * 0.5f, 0.6f, Slag(), false);
                    for (int i = 0; i < 3; i++) Pylon(parent, id + "-region-dead-grid-" + i,
                        new Vector3(-24f + i * 24f, 0f, -28f), Steel(), i == 1 ? 17f : -8f);
                    break;
                case "off_map":
                    Rails(parent, id + "-region-departure-rail", new Vector3(25f, 0.03f, 0f), 68f, 90f);
                    Wall(parent, id + "-region-yard-fence", new Vector3(-34f, 1.2f, 0f),
                        new Vector3(1f, 2.4f, 66f), Steel(), true);
                    break;
                default:
                    Strip(parent, id + "-region-route", new Vector3(0f, 0.03f, 0f),
                        new Vector3(8f, 0.05f, 72f), "regional_route", Asphalt(), false);
                    break;
            }
        }

        private static void BuildTutorial(Transform parent, string id)
        {
            Yard(parent, id + "-tutorial-yard", new Vector3(0f, 0f, 2f), 48f, 42f);
            WaterTower(parent, id + "-tower-12", new Vector3(-22f, 0f, 18f), "12");
            Workshop(parent, id + "-repair-pit", new Vector3(-18f, 0f, -5f), Rust());
            Canopy(parent, id + "-supply-canopy", new Vector3(16f, 0f, -8f), Sand(), new Color(0.38f, 0.12f, 0.10f));
            TrainingRange(parent, id + "-training-range", new Vector3(18f, 0f, 15f));
            CaravanLoading(parent, id + "-caravan-loading", new Vector3(1f, 0f, 25f));
        }

        private static void BuildSettlement(Transform parent, string id)
        {
            Yard(parent, id + "-settlement-ring", Vector3.zero, 52f, 48f);
            WaterTower(parent, id + "-keys-water-tower", new Vector3(-23f, 0f, 17f), "КЛЮЧИ");
            RailBridge(parent, id + "-keys-rail-bridge", new Vector3(22f, 0f, 18f));
            Market(parent, id + "-keys-market", new Vector3(-6f, 0f, 4f));
            Workshop(parent, id + "-keys-workshops", new Vector3(-18f, 0f, -12f), Rust());
            Clinic(parent, id + "-keys-clinic", new Vector3(13f, 0f, -11f));
            CommunityLife(parent, id + "-keys-life", new Vector3(10f, 0f, 10f));
        }

        private static void BuildFactionCapital(Transform parent, string id)
        {
            if (id == "sluiceCity")
            {
                Dam(parent, id + "-command-dam", new Vector3(0f, 0f, 18f));
                Checkpoint(parent, id + "-permit-control", new Vector3(0f, 0f, -15f), Navy());
                QueueLanes(parent, id + "-ration-queues", new Vector3(-17f, 0f, -4f));
            }
            else if (id == "scrapTown")
            {
                Furnace(parent, id + "-blast-furnace", new Vector3(-18f, 0f, 13f));
                Gantry(parent, id + "-gantry-crane", new Vector3(16f, 0f, 12f), Ochre());
                Workshop(parent, id + "-artel-shops", new Vector3(0f, 0f, -12f), Rust());
                Market(parent, id + "-artel-vote-yard", new Vector3(17f, 0f, -12f));
            }
            else if (id == "relayStation")
            {
                SealedTower(parent, id + "-sealed-dispatch", Vector3.zero);
                DishArray(parent, id + "-dish-array", new Vector3(-20f, 0f, 15f));
                Checkpoint(parent, id + "-decon-gate", new Vector3(0f, 0f, -20f), Contour());
            }
            else if (id == "secondHaven")
            {
                QuarryHomes(parent, id + "-quarry-homes", new Vector3(-10f, 0f, 5f));
                Canopy(parent, id + "-filter-canopy", new Vector3(16f, 0f, 5f), Chalk(), FadedBlue());
                Clinic(parent, id + "-seconds-clinic", new Vector3(4f, 0f, -15f));
            }
            else
            {
                Yard(parent, id + "-capital-yard", Vector3.zero, 54f, 50f);
                SealedTower(parent, id + "-capital-landmark", Vector3.zero);
            }
        }

        private static void BuildCaravanHub(Transform parent, string id)
        {
            for (int i = -2; i <= 2; i++) Strip(parent, id + "-traffic-lane-" + (i + 2),
                new Vector3(i * 6f, 0.03f, 0f), new Vector3(3.8f, 0.05f, 68f),
                "caravan_lane", Asphalt(), false);
            Canopy(parent, id + "-route-market", new Vector3(-22f, 0f, 4f), Sand(), Burgundy());
            Warehouse(parent, id + "-cargo-warehouse", new Vector3(21f, 0f, 7f), Sand());
            Workshop(parent, id + "-wagon-repair", new Vector3(20f, 0f, -16f), Brass());
            RoutePylon(parent, id + "-route-pylon", new Vector3(-20f, 0f, -20f));
        }

        private static void BuildRoadOutpost(Transform parent, string id)
        {
            Strip(parent, id + "-checkpoint-road", new Vector3(0f, 0.08f, 0f),
                new Vector3(9f, 0.15f, 70f), "road", Asphalt(), false);
            Checkpoint(parent, id + "-checkpoint", new Vector3(0f, 0f, -3f), Navy());
            WatchTower(parent, id + "-watch-west", new Vector3(-12f, 0f, 6f));
            WatchTower(parent, id + "-watch-east", new Vector3(12f, 0f, 6f));
            Searchlight(parent, id + "-searchlight", new Vector3(14f, 0f, -10f));
        }

        private static void BuildIndustrialSite(Transform parent, string id, Color regionColor)
        {
            Warehouse(parent, id + "-main-workshop", new Vector3(-10f, 0f, 3f), regionColor);
            Workshop(parent, id + "-service-bay", new Vector3(16f, 0f, -9f), Rust());
            PipeRun(parent, id + "-external-pipes", new Vector3(0f, 2f, 18f), 52f, Steel());
            Gantry(parent, id + "-loading-gantry", new Vector3(14f, 0f, 15f), Ochre());
            Furnace(parent, id + "-process-stack", new Vector3(-23f, 0f, -14f));
        }

        private static void BuildResourceSite(Transform parent, string id, Color color)
        {
            if (id.IndexOf("Oil", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                PumpJack(parent, id + "-pump", new Vector3(-8f, 0f, 4f));
                TankFarm(parent, id + "-tanks", new Vector3(16f, 0f, 8f));
            }
            else if (id.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                WaterTower(parent, id + "-intake", new Vector3(-14f, 0f, 7f), "СУХОЙ");
                FilterBank(parent, id + "-filters", new Vector3(14f, 0f, 5f));
            }
            else if (id.IndexOf("Chem", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                SettlingPool(parent, id + "-settling-pool", new Vector3(-13f, 0f, 5f), 10f, BlackWater());
                PipeRun(parent, id + "-drain-stack", new Vector3(14f, 2f, 7f), 30f, Steel(), 90f);
            }
            else if (id.IndexOf("Farm", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                for (int i = 0; i < 6; i++) Strip(parent, id + "-crop-row-" + i,
                    new Vector3(-23f + i * 9f, 0.02f, 4f), new Vector3(6f, 0.04f, 34f),
                    "crop_row", Soil(), false);
                WaterTower(parent, id + "-irrigation-tank", new Vector3(24f, 0f, 17f), "ВОДА");
            }
            else if (id.IndexOf("Scrap", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                for (int i = 0; i < 5; i++) ScrapPile(parent, id + "-sorted-pile-" + i,
                    new Vector3(-20f + i * 10f, 0f, 5f + (i % 2) * 8f));
                Gantry(parent, id + "-magnet-crane", new Vector3(0f, 0f, -14f), Rust());
            }
            else if (id.IndexOf("Tire", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                Canopy(parent, id + "-polymer-canopy", Vector3.zero, Sand(), Burgundy());
                for (int i = 0; i < 5; i++) TireStack(parent, id + "-rubber-bale-" + i,
                    new Vector3(-16f + i * 8f, 0f, 11f));
            }
            else if (id == "solarArray")
            {
                for (int z = 0; z < 3; z++) for (int x = 0; x < 5; x++)
                    SolarPanel(parent, id + "-panel-" + x + "-" + z,
                        new Vector3(-20f + x * 10f, 0f, -10f + z * 10f));
                Pylon(parent, id + "-lightning-mast", new Vector3(0f, 0f, 22f), ColdSteel());
            }
            else
            {
                Quarry(parent, id + "-cut-face", new Vector3(0f, 0f, 13f), color);
                Conveyor(parent, id + "-conveyor", new Vector3(12f, 0f, -7f));
                Gantry(parent, id + "-headframe", new Vector3(-13f, 0f, -5f), Rust());
            }
        }

        private static void BuildRaidComplex(Transform parent, string id, Color color)
        {
            Checkpoint(parent, id + "-outer-perimeter", new Vector3(0f, 0f, -24f), Steel());
            Warehouse(parent, id + "-production-level", new Vector3(-11f, 0f, 0f), color);
            PipeRun(parent, id + "-technical-spine", new Vector3(10f, 2f, 1f), 32f, Steel(), 90f);
            Ring(parent, id + "-core-arena", new Vector3(0f, 0.02f, 23f), 9f, 1.4f, Alarm(), true);
        }

        private static void BuildMutantLair(Transform parent, string id, Color color)
        {
            for (int i = 0; i < 5; i++) Mound(parent, id + "-outer-trace-" + i,
                new Vector3(-24f + i * 12f, 0f, -16f + (i % 2) * 7f),
                new Vector3(4f, 1f, 3f), Slag());
            Ring(parent, id + "-main-nest", new Vector3(0f, 0.02f, 9f), 9f, 1.2f, color, true);
            Ring(parent, id + "-elder-den", new Vector3(0f, 0.05f, 22f), 5f, 1.0f, Alarm(), true);
            if (id == "antHive") PipeRun(parent, id + "-shredded-cables", new Vector3(0f, 0.5f, 1f), 38f, ColdSteel());
            if (id == "mutantCrater") MedicalRing(parent, id + "-medical-containers", new Vector3(0f, 0f, 10f));
        }

        private static void BuildEncounter(Transform parent, string id, Color color)
        {
            float angle = id == "randomDryBasin" ? 32f : id == "randomAshGrove" ? -18f : 0f;
            Strip(parent, id + "-route-segment", Vector3.zero, new Vector3(8f, 0.08f, 70f),
                "encounter_route", Asphalt(), false, angle);
            for (int i = 0; i < 5; i++) Wall(parent, id + "-cover-" + i,
                new Vector3(-18f + i * 9f, 0.7f, -12f + (i % 3) * 12f),
                new Vector3(4f, 1.4f, 1.2f), Color.Lerp(color, Steel(), 0.5f), true);
        }

        private static void BuildBoundary(Transform parent, string id)
        {
            for (int i = 0; i < 3; i++) WatchTower(parent, id + "-defense-tower-" + i,
                new Vector3(-22f + i * 22f, 0f, 18f));
            Ring(parent, id + "-impact-crater", new Vector3(0f, 0f, -8f), 13f, 1.8f, Slag(), true);
            PipeRun(parent, id + "-subsurface-grid", new Vector3(0f, 1f, 28f), 58f, ColdSteel());
        }

        private static void BuildStoryComplex(Transform parent, string id, Color color)
        {
            if (id == "balanceBunker")
            {
                SealedTower(parent, id + "-administrative-shaft", new Vector3(0f, 0f, -8f));
                BunkerCorridors(parent, id + "-service-level", new Vector3(0f, 0f, 10f), ColdSteel());
            }
            else if (id == "vectorLab")
            {
                ImpossibleLattice(parent, id + "-lattice", new Vector3(0f, 0f, 10f));
                BunkerCorridors(parent, id + "-buried-lab", new Vector3(0f, 0f, -12f), Contour());
            }
            else
            {
                Furnace(parent, id + "-regenerator-column", new Vector3(0f, 0f, 12f));
                SettlingPool(parent, id + "-black-reservoir", new Vector3(0f, 0f, -12f), 11f, BlackWater());
                PipeRun(parent, id + "-cascade-feed", new Vector3(0f, 2f, 0f), 55f, Steel(), 90f);
            }
        }

        private static void BuildPersonalBase(Transform parent, string id)
        {
            Yard(parent, id + "-permanent-boundary", Vector3.zero, 46f, 42f);
            Workshop(parent, id + "-service-shaft", new Vector3(-18f, 0f, 14f), Steel());
            for (int z = 0; z < 3; z++) for (int x = 0; x < 4; x++)
                Socket(parent, id + "-build-socket-" + x + "-" + z,
                    new Vector3(-15f + x * 10f, 0.02f, -12f + z * 10f), "personal-build-socket");
        }

        private static void BuildClanBase(Transform parent, string id, Color color)
        {
            for (int lane = -1; lane <= 1; lane++) Strip(parent, id + "-approach-" + (lane + 1),
                new Vector3(lane * 14f, 0.04f, -18f), new Vector3(8f, 0.08f, 38f),
                "siege_approach", Asphalt(), false);
            for (int i = 0; i < 3; i++) Relay(parent, id + "-relay-" + (i + 1),
                new Vector3(-18f + i * 18f, 0f, -3f), color);
            Checkpoint(parent, id + "-breach-gate", new Vector3(0f, 0f, 10f), Steel());
            Ring(parent, id + "-command-core", new Vector3(0f, 0.02f, 25f), 7f, 1f, Alarm(), true);
            for (int i = 0; i < 6; i++)
            {
                float angle = i * Mathf.PI * 2f / 6f;
                Socket(parent, id + "-module-socket-" + (i + 1),
                    new Vector3(Mathf.Cos(angle) * 20f, 0.02f, 19f + Mathf.Sin(angle) * 13f),
                    "clan-module-socket");
            }
        }

        private static void Yard(Transform parent, string id, Vector3 position, float width, float depth)
        {
            Transform root = Group(parent, id, "welded_yard", "structure",
                new[] { "post-industrial", "editable-perimeter" }, true, true);
            root.localPosition = position;
            Box("NorthWall", root, new Vector3(0f, 1.2f, depth * 0.5f), new Vector3(width, 2.4f, 0.8f), Steel());
            Box("WestWall", root, new Vector3(-width * 0.5f, 1.2f, 0f), new Vector3(0.8f, 2.4f, depth), Steel());
            Box("EastWall", root, new Vector3(width * 0.5f, 1.2f, 0f), new Vector3(0.8f, 2.4f, depth), Steel());
            Box("SouthWallLeft", root, new Vector3(-width * 0.31f, 1.2f, -depth * 0.5f), new Vector3(width * 0.38f, 2.4f, 0.8f), Steel());
            Box("SouthWallRight", root, new Vector3(width * 0.31f, 1.2f, -depth * 0.5f), new Vector3(width * 0.38f, 2.4f, 0.8f), Steel());
        }

        private static void WaterTower(Transform parent, string id, Vector3 position, string label)
        {
            Transform root = Group(parent, id, "water_tower", "landmark",
                new[] { "water", "tower", "top-readable" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 4; i++)
            {
                float x = i % 2 == 0 ? -2f : 2f;
                float z = i < 2 ? -2f : 2f;
                Box("Leg_" + i, root, new Vector3(x, 4f, z), new Vector3(0.45f, 8f, 0.45f), Steel());
            }
            Cylinder("Tank", root, new Vector3(0f, 9f, 0f), new Vector3(4f, 2.6f, 4f), Navy());
            Sign(root, "TowerLabel", label, new Vector3(0f, 11.8f, 0f), 0f);
        }

        private static void Workshop(Transform parent, string id, Vector3 position, Color accent)
        {
            Transform root = Group(parent, id, "modular_workshop", "structure",
                new[] { "workshop", "sheet-metal", "craft" }, true, true);
            root.localPosition = position;
            Box("BrickBody", root, new Vector3(0f, 2f, 0f), new Vector3(12f, 4f, 8f), Brick());
            Box("OpenBay", root, new Vector3(0f, 1.7f, -4.1f), new Vector3(5f, 3.2f, 0.4f), accent);
            Box("Roof", root, new Vector3(0f, 4.2f, 0f), new Vector3(13f, 0.35f, 9f), Steel());
        }

        private static void Canopy(Transform parent, string id, Vector3 position, Color frame, Color cloth)
        {
            Transform root = Group(parent, id, "market_canopy", "structure",
                new[] { "canopy", "trade", "shelter" }, true, false);
            root.localPosition = position;
            for (int i = 0; i < 4; i++) Box("Post_" + i, root,
                new Vector3(i % 2 == 0 ? -5f : 5f, 2f, i < 2 ? -3.5f : 3.5f),
                new Vector3(0.3f, 4f, 0.3f), frame);
            Box("ClothRoof", root, new Vector3(0f, 4.1f, 0f), new Vector3(11f, 0.18f, 8f), cloth, false);
        }

        private static void TrainingRange(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "training_range", "structure",
                new[] { "tutorial", "shooting-range", "cover" }, true, true);
            root.localPosition = position;
            WallParts(root, 12f, 9f, Concrete());
            for (int i = 0; i < 3; i++)
            {
                Box("Target_" + i, root, new Vector3(-4f + i * 4f, 1.4f, 3f),
                    new Vector3(1f, 2.8f, 0.25f), Alarm());
                Box("Cover_" + i, root, new Vector3(-4f + i * 4f, 0.6f, -3f),
                    new Vector3(2.4f, 1.2f, 0.8f), Concrete());
            }
        }

        private static void CaravanLoading(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "caravan_loading", "structure",
                new[] { "caravan", "cargo", "departure" }, true, true);
            root.localPosition = position;
            Box("Wagon", root, new Vector3(-5f, 1.5f, 0f), new Vector3(8f, 3f, 4f), Sand());
            Box("Truck", root, new Vector3(6f, 1.3f, 0f), new Vector3(7f, 2.6f, 3.5f), Rust());
            Box("Cargo", root, new Vector3(0f, 1f, -5f), new Vector3(8f, 2f, 4f), Ochre());
        }

        private static void RailBridge(Transform parent, string id, Vector3 position)
        {
            // Настил висит на 2,5 м, фермы — на 3 м: под мостом проходят в полный рост,
            // поэтому преградой движению он не помечается (экспорт это проверяет).
            Transform root = Group(parent, id, "rail_bridge", "landmark",
                new[] { "rail", "bridge", "top-readable" }, false, true);
            root.localPosition = position;
            Box("Deck", root, new Vector3(0f, 2.8f, 0f), new Vector3(16f, 0.6f, 7f), Steel());
            for (int i = -1; i <= 1; i += 2) Box("Truss_" + i, root,
                new Vector3(i * 7f, 5f, 0f), new Vector3(0.5f, 4f, 7f), Rust());
        }

        private static void Market(Transform parent, string id, Vector3 position)
        {
            Canopy(parent, id, position, Brass(), Burgundy());
        }

        private static void Clinic(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "field_clinic", "structure",
                new[] { "clinic", "medical", "warm-light" }, true, true);
            root.localPosition = position;
            Box("ClinicBody", root, new Vector3(0f, 2f, 0f), new Vector3(11f, 4f, 8f), FadedBlue());
            Box("Door", root, new Vector3(0f, 1.5f, -4.1f), new Vector3(2.4f, 3f, 0.3f), WarmWhite());
            Cross(root, new Vector3(0f, 4.7f, -4.3f), Alarm());
        }

        private static void CommunityLife(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "community_yard", "dressing",
                new[] { "garden", "laundry", "kitchen", "lived-in" }, false, false);
            root.localPosition = position;
            for (int i = 0; i < 3; i++) Box("Garden_" + i, root,
                new Vector3(-5f + i * 5f, 0.15f, 2f), new Vector3(3.5f, 0.3f, 6f), Soil(), false);
            Box("LaundryLine", root, new Vector3(0f, 2.2f, -3f), new Vector3(11f, 0.08f, 0.08f), Steel(), false);
            Cylinder("KitchenFire", root, new Vector3(0f, 0.3f, 6f), new Vector3(1.4f, 0.3f, 1.4f), Alarm(), false);
        }

        private static void Dam(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "command_dam", "landmark",
                new[] { "cascade", "dam", "uprava", "top-readable" }, true, true);
            root.localPosition = position;
            Box("DamFace", root, new Vector3(0f, 4f, 0f), new Vector3(48f, 8f, 5f), Concrete());
            for (int i = -2; i <= 2; i++) Box("Gate_" + i, root,
                new Vector3(i * 8f, 3f, -2.7f), new Vector3(5f, 5f, 0.5f), Navy());
            Sign(root, "SectorNumber", "СТВОР", new Vector3(0f, 8.5f, -3f), 0f);
        }

        private static void Checkpoint(Transform parent, string id, Vector3 position, Color accent)
        {
            Transform root = Group(parent, id, "checkpoint_gate", "structure",
                new[] { "checkpoint", "gate", "controlled-route" }, true, true);
            root.localPosition = position;
            Box("PostWest", root, new Vector3(-6f, 2f, 0f), new Vector3(4f, 4f, 5f), Concrete());
            Box("PostEast", root, new Vector3(6f, 2f, 0f), new Vector3(4f, 4f, 5f), Concrete());
            Box("GateBeam", root, new Vector3(0f, 4.8f, 0f), new Vector3(16f, 1f, 1f), accent);
        }

        private static void QueueLanes(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "ration_queue", "dressing",
                new[] { "uprava", "queue", "civilian-cost" }, false, false);
            root.localPosition = position;
            for (int i = 0; i < 4; i++) Box("Rail_" + i, root,
                new Vector3(i * 2.2f, 0.6f, 0f), new Vector3(0.1f, 1.2f, 13f), Steel(), false);
        }

        private static void Furnace(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "blast_furnace", "landmark",
                new[] { "industry", "furnace", "top-readable" }, true, true);
            root.localPosition = position;
            Cylinder("FurnaceBody", root, new Vector3(0f, 5f, 0f), new Vector3(5f, 5f, 5f), Steel());
            Cylinder("Stack", root, new Vector3(0f, 12f, 0f), new Vector3(2f, 5f, 2f), Rust());
            Box("FireDoor", root, new Vector3(0f, 2f, -5f), new Vector3(3f, 2.5f, 0.4f), Alarm());
        }

        private static void Gantry(Transform parent, string id, Vector3 position, Color accent)
        {
            Transform root = Group(parent, id, "gantry_crane", "landmark",
                new[] { "crane", "industry", "top-readable" }, true, true);
            root.localPosition = position;
            Box("LegWest", root, new Vector3(-7f, 4f, 0f), new Vector3(0.8f, 8f, 2f), Steel());
            Box("LegEast", root, new Vector3(7f, 4f, 0f), new Vector3(0.8f, 8f, 2f), Steel());
            Box("Beam", root, new Vector3(0f, 8f, 0f), new Vector3(16f, 1f, 2f), accent);
            Box("Hook", root, new Vector3(2f, 4.5f, 0f), new Vector3(0.3f, 6f, 0.3f), Steel(), false);
        }

        private static void SealedTower(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "sealed_tower", "landmark",
                new[] { "contour", "sealed", "top-readable" }, true, true);
            root.localPosition = position;
            Cylinder("Core", root, new Vector3(0f, 5f, 0f), new Vector3(6f, 5f, 6f), Contour());
            Box("Airlock", root, new Vector3(0f, 2f, -6f), new Vector3(4f, 4f, 0.8f), Amber());
            Cylinder("Beacon", root, new Vector3(0f, 11f, 0f), new Vector3(1f, 2f, 1f), Amber(), false);
        }

        private static void DishArray(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "dish_array", "landmark",
                new[] { "contour", "antenna", "top-readable" }, true, false);
            root.localPosition = position;
            for (int i = 0; i < 3; i++)
            {
                Cylinder("Mast_" + i, root, new Vector3(i * 7f, 3f, 0f), new Vector3(0.5f, 3f, 0.5f), ColdSteel());
                GameObject dish = Cylinder("Dish_" + i, root, new Vector3(i * 7f, 6f, 0f),
                    new Vector3(3f, 0.25f, 3f), WarmWhite(), false);
                dish.transform.localRotation = Quaternion.Euler(25f, i * 28f, 10f);
            }
        }

        private static void QuarryHomes(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "quarry_housing", "structure",
                new[] { "seconds", "housing", "crowded" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 5; i++) Box("Home_" + i, root,
                new Vector3((i % 3) * 6f, 1.5f + (i / 3) * 1.2f, (i / 3) * 7f),
                new Vector3(5f, 3f, 5f), i % 2 == 0 ? Chalk() : FadedBlue());
        }

        private static void Warehouse(Transform parent, string id, Vector3 position, Color color)
        {
            Transform root = Group(parent, id, "warehouse", "structure",
                new[] { "warehouse", "industrial", "loot-space" }, true, true);
            root.localPosition = position;
            Box("Hall", root, new Vector3(0f, 3f, 0f), new Vector3(17f, 6f, 12f), Color.Lerp(color, Steel(), 0.42f));
            Box("SlidingDoor", root, new Vector3(0f, 2f, -6.2f), new Vector3(7f, 4f, 0.4f), Rust());
            Box("Roof", root, new Vector3(0f, 6.2f, 0f), new Vector3(18f, 0.35f, 13f), Steel());
        }

        private static void RoutePylon(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "route_pylon", "landmark",
                new[] { "tract-league", "route-sign", "top-readable" }, true, false);
            root.localPosition = position;
            Box("Post", root, new Vector3(0f, 4f, 0f), new Vector3(0.7f, 8f, 0.7f), Brass());
            Box("RouteBoards", root, new Vector3(0f, 7f, 0f), new Vector3(7f, 2.5f, 0.5f), Burgundy(), false);
        }

        private static void WatchTower(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "watch_tower", "structure",
                new[] { "watch", "security", "vertical" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 4; i++) Box("Leg_" + i, root,
                new Vector3(i % 2 == 0 ? -1.8f : 1.8f, 3f, i < 2 ? -1.8f : 1.8f),
                new Vector3(0.35f, 6f, 0.35f), Steel());
            Box("Cab", root, new Vector3(0f, 6.5f, 0f), new Vector3(5f, 2.5f, 5f), Concrete());
        }

        private static void Searchlight(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "searchlight", "dressing",
                new[] { "searchlight", "uprava", "night-readable" }, false, false);
            root.localPosition = position;
            Cylinder("Mast", root, new Vector3(0f, 3f, 0f), new Vector3(0.4f, 3f, 0.4f), Steel(), false);
            Light light = Child(root, "Lamp").gameObject.AddComponent<Light>();
            light.type = LightType.Spot;
            light.color = WarmWhite();
            light.intensity = 8f;
            light.range = 28f;
            light.spotAngle = 42f;
            light.transform.localPosition = new Vector3(0f, 6f, 0f);
            light.transform.localRotation = Quaternion.Euler(55f, 25f, 0f);
        }

        private static void PumpJack(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "oil_pump_jack", "structure",
                new[] { "fuel", "pump", "resource" }, true, true);
            root.localPosition = position;
            Box("Base", root, new Vector3(0f, 0.7f, 0f), new Vector3(9f, 1.4f, 5f), Steel());
            Box("Beam", root, new Vector3(0f, 4f, 0f), new Vector3(12f, 1f, 1f), Rust());
            Box("HorseHead", root, new Vector3(6f, 2.8f, 0f), new Vector3(2f, 4f, 2f), Rust());
        }

        private static void TankFarm(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "tank_farm", "structure",
                new[] { "fuel", "tank", "chemical-risk" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 4; i++) Cylinder("Tank_" + i, root,
                new Vector3((i % 2) * 7f, 2f, (i / 2) * 7f), new Vector3(3f, 2f, 3f), Rust());
        }

        private static void FilterBank(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "filter_bank", "structure",
                new[] { "cascade", "filter", "water" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 4; i++) Cylinder("Filter_" + i, root,
                new Vector3(-6f + i * 4f, 2.5f, 0f), new Vector3(1.8f, 2.5f, 1.8f), FadedBlue());
            PipeRun(root, "InternalPipe", new Vector3(0f, 1f, 4f), 18f, Steel(), 90f, false);
        }

        private static void Quarry(Transform parent, string id, Vector3 position, Color color)
        {
            Transform root = Group(parent, id, "quarry_face", "landmark",
                new[] { "quarry", "resource", "top-readable" }, true, true);
            root.localPosition = position;
            for (int i = 0; i < 5; i++) Box("Bench_" + i, root,
                new Vector3(-12f + i * 6f, 1f + i * 0.65f, i * 2f),
                new Vector3(7f, 2f + i * 0.4f, 5f), Color.Lerp(color, Chalk(), i / 7f));
        }

        private static void Conveyor(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "ore_conveyor", "structure",
                new[] { "conveyor", "ore", "industry" }, true, true);
            root.localPosition = position;
            GameObject belt = Box("Belt", root, new Vector3(0f, 3f, 0f), new Vector3(4f, 0.6f, 18f), Steel());
            belt.transform.localRotation = Quaternion.Euler(-12f, 0f, 0f);
        }

        private static void ScrapPile(Transform parent, string id, Vector3 position)
        {
            Mound(parent, id, position, new Vector3(5f, 2.2f, 4f), Rust());
        }

        private static void TireStack(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "rubber_bale", "cover",
                new[] { "rubber", "polymer", "resource" }, true, false);
            root.localPosition = position;
            for (int i = 0; i < 3; i++) Cylinder("Tire_" + i, root,
                new Vector3(0f, 0.4f + i * 0.7f, 0f), new Vector3(1.8f, 0.35f, 1.8f), Rubber());
        }

        private static void SolarPanel(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "solar_panel", "resource",
                new[] { "solar", "electronics", "glasslands" }, true, false);
            root.localPosition = position;
            Box("Post", root, new Vector3(0f, 1.2f, 0f), new Vector3(0.3f, 2.4f, 0.3f), Steel());
            GameObject panel = Box("Panel", root, new Vector3(0f, 2.4f, 0f), new Vector3(6f, 0.2f, 3f), Glass());
            panel.transform.localRotation = Quaternion.Euler(22f, 0f, 0f);
        }

        private static void MedicalRing(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "medical_container_ring", "dressing",
                new[] { "fold", "medical", "mutant-trace" }, false, false);
            root.localPosition = position;
            for (int i = 0; i < 8; i++)
            {
                float a = i * Mathf.PI * 2f / 8f;
                Box("Container_" + i, root, new Vector3(Mathf.Cos(a) * 8f, 1f, Mathf.Sin(a) * 8f),
                    new Vector3(2.4f, 2f, 4f), WarmWhite(), false);
            }
        }

        private static void BunkerCorridors(Transform parent, string id, Vector3 position, Color accent)
        {
            Transform root = Group(parent, id, "bunker_corridors", "structure",
                new[] { "bunker", "sealed", "story" }, true, true);
            root.localPosition = position;
            Box("Spine", root, new Vector3(0f, 2f, 0f), new Vector3(9f, 4f, 28f), Concrete());
            Box("WestRoom", root, new Vector3(-9f, 2f, 3f), new Vector3(10f, 4f, 9f), Concrete());
            Box("EastRoom", root, new Vector3(9f, 2f, -5f), new Vector3(10f, 4f, 9f), Concrete());
            Box("Airlock", root, new Vector3(0f, 2f, -14f), new Vector3(5f, 3.5f, 0.7f), accent);
        }

        private static void ImpossibleLattice(Transform parent, string id, Vector3 position)
        {
            // The beams carry no colliders: players walk through the lattice, so the
            // server must not keep a blocker in its place.
            Transform root = Group(parent, id, "vector_lattice", "landmark",
                new[] { "vector", "distortion", "impossible-geometry" }, false, false);
            root.localPosition = position;
            for (int i = 0; i < 8; i++)
            {
                GameObject beam = Box("Beam_" + i, root, new Vector3(0f, 4f, 0f),
                    new Vector3(0.45f, 10f, 0.45f), Glass(), false);
                beam.transform.localRotation = Quaternion.Euler(i * 17f, i * 43f, 35f + i * 9f);
            }
        }

        private static void Relay(Transform parent, string id, Vector3 position, Color accent)
        {
            Transform root = Group(parent, id, "siege_relay", "siege_objective",
                new[] { "clan", "relay", "objective" }, true, true);
            root.localPosition = position;
            Cylinder("Mast", root, new Vector3(0f, 3f, 0f), new Vector3(0.7f, 3f, 0.7f), Steel());
            Box("Control", root, new Vector3(0f, 1f, -1.5f), new Vector3(2f, 2f, 1.5f), accent);
            Cylinder("Beacon", root, new Vector3(0f, 6.5f, 0f), new Vector3(0.8f, 0.5f, 0.8f), Alarm(), false);
        }

        private static void Socket(Transform parent, string id, Vector3 position, string tag)
        {
            Transform root = Group(parent, id, "module_socket", "build_socket",
                new[] { tag, "fixed-placement" }, false, false);
            root.localPosition = position;
            Box("Pad", root, Vector3.zero, new Vector3(7f, 0.15f, 7f), Concrete(), false);
            for (int i = -1; i <= 1; i += 2) for (int z = -1; z <= 1; z += 2)
                Cylinder("Bolt_" + i + "_" + z, root, new Vector3(i * 2.7f, 0.15f, z * 2.7f),
                    new Vector3(0.18f, 0.15f, 0.18f), Brass(), false);
        }

        private static void SettlingPool(Transform parent, string id, Vector3 position, float radius, Color color)
        {
            Ring(parent, id, position, radius, 1.1f, color, true);
        }

        private static void Ring(Transform parent, string id, Vector3 position, float radius,
                                 float width, Color color, bool blocks)
        {
            Transform root = Group(parent, id, "ring_structure", blocks ? "structure" : "ground_accent",
                new[] { "ring", "readable-from-above" }, blocks, blocks);
            root.localPosition = position;
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2f / 16f;
                GameObject segment = Box("Segment_" + i, root,
                    new Vector3(Mathf.Cos(a) * radius, width * 0.5f, Mathf.Sin(a) * radius),
                    new Vector3(radius * 0.42f, width, 0.7f), color, blocks);
                segment.transform.localRotation = Quaternion.Euler(0f, -a * Mathf.Rad2Deg, 0f);
            }
        }

        private static void Pylon(Transform parent, string id, Vector3 position, Color color, float lean = 0f)
        {
            Transform root = Group(parent, id, "power_pylon", "dressing",
                new[] { "power-grid", "vertical" }, false, false);
            root.localPosition = position;
            root.localRotation = Quaternion.Euler(0f, 0f, lean);
            Box("Mast", root, new Vector3(0f, 5f, 0f), new Vector3(0.55f, 10f, 0.55f), color, false);
            Box("Crossbar", root, new Vector3(0f, 8f, 0f), new Vector3(6f, 0.35f, 0.35f), color, false);
        }

        private static void Tree(Transform parent, string id, Vector3 position, Color color)
        {
            Transform root = Group(parent, id, "shelterbelt_tree", "dressing",
                new[] { "shelterbelt", "vegetation" }, false, false);
            root.localPosition = position;
            Cylinder("Trunk", root, new Vector3(0f, 2f, 0f), new Vector3(0.45f, 2f, 0.45f), Rust(), false);
            Sphere("Crown", root, new Vector3(0f, 5f, 0f), new Vector3(3f, 3f, 3f), color, false);
        }

        private static void Mound(Transform parent, string id, Vector3 position, Vector3 scale, Color color)
        {
            Transform root = Group(parent, id, "terrain_mound", "cover",
                new[] { "terrain", "cover" }, true, true);
            root.localPosition = position;
            Sphere("Mound", root, new Vector3(0f, -scale.y * 0.15f, 0f), scale, color);
        }

        private static void Culvert(Transform parent, string id, Vector3 position)
        {
            Transform root = Group(parent, id, "concrete_culvert", "dressing",
                new[] { "tract", "drainage" }, false, false);
            root.localPosition = position;
            Cylinder("Culvert", root, Vector3.zero, new Vector3(2f, 4f, 2f), Concrete(), false)
                .transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
        }

        private static void Rails(Transform parent, string id, Vector3 position, float length, float yaw = 0f)
        {
            Transform root = Group(parent, id, "railway", "ground_accent",
                new[] { "rail", "transport" }, false, false);
            root.localPosition = position;
            root.localRotation = Quaternion.Euler(0f, yaw, 0f);
            Box("RailLeft", root, new Vector3(-1f, 0f, 0f), new Vector3(0.16f, 0.16f, length), Steel(), false);
            Box("RailRight", root, new Vector3(1f, 0f, 0f), new Vector3(0.16f, 0.16f, length), Steel(), false);
            for (int i = -5; i <= 5; i++) Box("Sleeper_" + i, root,
                new Vector3(0f, -0.04f, i * length / 11f), new Vector3(3.2f, 0.12f, 0.35f), Timber(), false);
        }

        private static void PipeRun(Transform parent, string id, Vector3 position, float length,
                                    Color color, float yaw = 0f, bool register = true)
        {
            Transform root = register
                ? Group(parent, id, "external_pipe", "structure", new[] { "pipe", "cascade" }, true, true)
                : Child(parent, id);
            root.localPosition = position;
            root.localRotation = Quaternion.Euler(0f, yaw, 90f);
            Cylinder("Pipe", root, Vector3.zero, new Vector3(0.75f, length * 0.5f, 0.75f), color);
        }

        private static void Strip(Transform parent, string id, Vector3 position, Vector3 scale,
                                  string archetype, Color color, bool blocks, float yaw = 0f)
        {
            Transform root = Group(parent, id, archetype, "ground_accent",
                new[] { archetype, "region-language" }, blocks, false);
            root.localPosition = position;
            root.localRotation = Quaternion.Euler(0f, yaw, 0f);
            Box("Surface", root, Vector3.zero, scale, color, blocks);
        }

        private static void Wall(Transform parent, string id, Vector3 position, Vector3 scale,
                                 Color color, bool blocks)
        {
            Transform root = Group(parent, id, "wall", "cover", new[] { "wall", "cover" }, blocks, blocks);
            root.localPosition = position;
            Box("Wall", root, Vector3.zero, scale, color, blocks);
        }

        private static void WallParts(Transform root, float width, float depth, Color color)
        {
            Box("BackWall", root, new Vector3(0f, 1.5f, depth * 0.5f), new Vector3(width, 3f, 0.5f), color);
            Box("SideWest", root, new Vector3(-width * 0.5f, 1.5f, 0f), new Vector3(0.5f, 3f, depth), color);
            Box("SideEast", root, new Vector3(width * 0.5f, 1.5f, 0f), new Vector3(0.5f, 3f, depth), color);
        }

        private static void Cross(Transform root, Vector3 position, Color color)
        {
            Box("CrossVertical", root, position, new Vector3(0.7f, 3f, 0.2f), color, false);
            Box("CrossHorizontal", root, position, new Vector3(2.2f, 0.7f, 0.2f), color, false);
        }

        private static void Sign(Transform root, string name, string text, Vector3 position, float yaw)
        {
            Transform sign = Child(root, name);
            sign.localPosition = position;
            sign.localRotation = Quaternion.Euler(90f, yaw, 0f);
            TextMesh label = sign.gameObject.AddComponent<TextMesh>();
            label.text = text;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.characterSize = 0.65f;
            label.fontSize = 48;
            label.color = WarmWhite();
        }

        private static Transform Group(Transform parent, string id, string archetype, string role,
                                       string[] tags, bool blocksMovement, bool blocksVision)
        {
            Transform root = Child(parent, id + "_EDITABLE");
            root.gameObject.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                id, archetype, role, tags, true, blocksMovement, blocksVision);
            root.gameObject.AddComponent<RoaUnityLocationObject>().Configure(id);
            return root;
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static GameObject Box(string name, Transform parent, Vector3 position,
                                      Vector3 scale, Color color, bool collider = true)
        {
            return Primitive(name, PrimitiveType.Cube, parent, position, scale, color, collider);
        }

        private static GameObject Cylinder(string name, Transform parent, Vector3 position,
                                           Vector3 scale, Color color, bool collider = true)
        {
            return Primitive(name, PrimitiveType.Cylinder, parent, position, scale, color, collider);
        }

        private static GameObject Sphere(string name, Transform parent, Vector3 position,
                                         Vector3 scale, Color color, bool collider = true)
        {
            return Primitive(name, PrimitiveType.Sphere, parent, position, scale, color, collider);
        }

        private static GameObject Primitive(string name, PrimitiveType type, Transform parent,
                                            Vector3 position, Vector3 scale, Color color, bool collider)
        {
            GameObject result = GameObject.CreatePrimitive(type);
            result.name = name;
            result.transform.SetParent(parent, false);
            result.transform.localPosition = position;
            result.transform.localScale = scale;
            Renderer renderer = result.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = MaterialFor("Kromka_" + ColorKey(color), color);
            Collider shape = result.GetComponent<Collider>();
            if (shape != null) shape.enabled = collider;
            return result;
        }

        private static Material MaterialFor(string name, Color color)
        {
            string path = MaterialRoot + "/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.14f);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        private static string ColorKey(Color color)
        {
            Color32 c = color;
            return c.r.ToString("X2") + c.g.ToString("X2") + c.b.ToString("X2");
        }

        private static Color ColorFor(string region)
        {
            return RegionColors.TryGetValue(region ?? string.Empty, out Color color)
                ? color : RegionColors["regional"];
        }

        private static string Text(JObject row, string key) => row?[key]?.Value<string>() ?? string.Empty;
        private static Color Concrete() => new Color(0.40f, 0.41f, 0.39f);
        private static Color Steel() => new Color(0.21f, 0.22f, 0.21f);
        private static Color ColdSteel() => new Color(0.26f, 0.34f, 0.35f);
        private static Color Rust() => new Color(0.49f, 0.20f, 0.10f);
        private static Color Brick() => new Color(0.43f, 0.28f, 0.21f);
        private static Color Asphalt() => new Color(0.16f, 0.17f, 0.16f);
        private static Color Sand() => new Color(0.53f, 0.42f, 0.27f);
        private static Color Soil() => new Color(0.26f, 0.25f, 0.15f);
        private static Color Timber() => new Color(0.31f, 0.22f, 0.14f);
        private static Color Slag() => new Color(0.18f, 0.13f, 0.11f);
        private static Color Chalk() => new Color(0.72f, 0.70f, 0.58f);
        private static Color Karst() => new Color(0.20f, 0.48f, 0.55f);
        private static Color Water() => new Color(0.08f, 0.28f, 0.31f);
        private static Color BlackWater() => new Color(0.035f, 0.065f, 0.07f);
        private static Color Glass() => new Color(0.16f, 0.42f, 0.43f);
        private static Color Rubber() => new Color(0.055f, 0.052f, 0.047f);
        private static Color Navy() => new Color(0.08f, 0.16f, 0.24f);
        private static Color Ochre() => new Color(0.58f, 0.30f, 0.10f);
        private static Color Burgundy() => new Color(0.34f, 0.08f, 0.09f);
        private static Color Brass() => new Color(0.48f, 0.36f, 0.14f);
        private static Color Contour() => new Color(0.24f, 0.34f, 0.31f);
        private static Color FadedBlue() => new Color(0.32f, 0.48f, 0.50f);
        private static Color Amber() => new Color(0.94f, 0.48f, 0.08f);
        private static Color Alarm() => new Color(0.70f, 0.08f, 0.045f);
        private static Color WarmWhite() => new Color(0.92f, 0.84f, 0.67f);
    }
}
