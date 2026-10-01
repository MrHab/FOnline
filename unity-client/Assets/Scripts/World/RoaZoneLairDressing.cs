using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Existing PolygonApocalypse models placed around server-owned A-Life lairs.</summary>
    public static class RoaZoneLairDressing
    {
        private static readonly HashSet<string> Species = new HashSet<string>(StringComparer.Ordinal)
        {
            "raider_band", "gari_pack", "dustling_brood", "listener_pack", "rykhlyak_herd",
            "mourner_flock", "fold_cluster", "burned_drifters", "lantern_herd"
        };

        public static int ThemeCount => Species.Count;
        public static bool HasTheme(string speciesId) => speciesId != null && Species.Contains(speciesId);

        public static int Build(LocationDefinition definition, Transform parent)
        {
            JArray lairs = definition?.Zone?["lairs"] as JArray;
            if (lairs == null || parent == null) return 0;
            RoaLairPropCatalog catalog = RoaLairPropCatalog.Instance;
            if (catalog == null)
            {
                Debug.LogError("[ROA] PolygonApocalypse lair prefab references are missing.");
                return 0;
            }
            var root = new GameObject("LairDressing");
            root.transform.SetParent(parent, false);
            int built = 0;
            foreach (JToken token in lairs)
            {
                if (!(token is JObject row)) continue;
                string speciesId = row["speciesId"]?.ToString() ?? string.Empty;
                if (!Species.Contains(speciesId)) continue;
                int tx = row["tx"]?.Value<int>() ?? -1;
                int tz = row["tz"]?.Value<int>() ?? -1;
                if (tx < 0 || tx >= definition.TileWidth || tz < 0 || tz >= definition.TileDepth) continue;
                float x = (tx - definition.TileWidth / 2f + 0.5f) * definition.TileStep;
                float z = (tz - definition.TileDepth / 2f + 0.5f) * definition.TileStep;
                string anchorId = row["id"]?.ToString() ?? built.ToString();
                var group = new GameObject("Lair_" + speciesId + "_" + anchorId);
                group.transform.SetParent(root.transform, false);
                group.transform.localPosition = new Vector3(x, 0f, z);
                group.transform.localRotation = Quaternion.Euler(0f, StableYaw(anchorId), 0f);
                Dress(speciesId, group.transform, catalog);
                built++;
            }
            return built;
        }

        private static float StableYaw(string id)
        {
            uint hash = 2166136261;
            foreach (char c in id) hash = unchecked((hash ^ c) * 16777619);
            return (hash % 4) * 90f;
        }

        private static void Dress(string id, Transform root, RoaLairPropCatalog kit)
        {
            // The tier-one layout is the baseline for these four species until
            // higher-tier variants are authored from zone.difficulty.
            if (DressTierOne(id, root, kit)) return;
            switch (id)
            {
                case "listener_pack":
                    Place(kit, root, "SM_Prop_Roof_Satellite_Dish_01", -2.6f, 0.6f, 40f);
                    Place(kit, root, "SM_Prop_Roof_Satellite_Dish_01", 2.6f, 0.6f, -40f);
                    Place(kit, root, "SM_Prop_Loud_Speaker_01", 0f, 1.9f, 180f);
                    Place(kit, root, "SM_Prop_Wire_01", 0f, -2f);
                    Place(kit, root, "SM_Prop_Bear_Trap_01", -2.2f, -3.3f);
                    Place(kit, root, "SM_Prop_Bear_Trap_01", 2.2f, -3.3f);
                    break;
                case "rykhlyak_herd":
                    Place(kit, root, "SM_Env_DirtPile_01", 0f, 0f, 22f);
                    Place(kit, root, "SM_Env_DirtPile_01", -3.2f, 1.6f, 65f);
                    Place(kit, root, "SM_Env_DirtPile_02", 2.7f, 2.4f, -35f);
                    Place(kit, root, "SM_Env_DirtPile_02", -1.3f, -2.4f, 110f);
                    Place(kit, root, "SM_Env_Rubble_Pebbles_01", 2.9f, -2.6f);
                    Place(kit, root, "SM_Env_Rock_01", -3.8f, -2.9f);
                    break;
                case "mourner_flock":
                    Place(kit, root, "SM_Env_Tree_Dead_02", 0f, 1.7f);
                    Place(kit, root, "SM_Env_GroundLeaves_03", -2.7f, -1.8f);
                    Place(kit, root, "SM_Prop_Skull_Silver_01", -0.7f, -0.8f);
                    Place(kit, root, "SM_Prop_Glass_Shard_02", 1.2f, -1.4f);
                    Place(kit, root, "SM_Prop_DeadBody_Laying_Male_01", 2.8f, -2.9f, 80f);
                    break;
                case "fold_cluster":
                    Place(kit, root, "SM_Prop_BodyBag_Pile_01", 0f, 1.5f);
                    Place(kit, root, "SM_Prop_Bed_Gurney_BodySheet_01", -2.1f, -1.1f, 40f);
                    Place(kit, root, "SM_Prop_BodyBag_Pile_01", 2.2f, -1.3f, -35f);
                    Place(kit, root, "SM_Prop_Medical_Container_Broken_01", -2.6f, -3.1f);
                    Place(kit, root, "SM_Prop_Chemical_02", 2.8f, -3.2f);
                    break;
                case "burned_drifters":
                    Place(kit, root, "SM_Prop_Tent_Dome_Damaged_01", 1.9f, 2.2f, -25f);
                    Place(kit, root, "SM_Prop_BurnPile_01", -1.6f, 0.4f);
                    Place(kit, root, "SM_Prop_BurnPile_Books_01", -2.7f, -2.2f, 40f);
                    Place(kit, root, "SM_Prop_Luggage_Open_01", 2.9f, -2.1f);
                    Place(kit, root, "SM_Prop_Sleeping_Bag_01", 0.2f, -2.9f, 95f);
                    Place(kit, root, "SM_Prop_BloodSplat_01", -0.5f, 2.6f);
                    break;
            }
        }

        private static bool DressTierOne(string id, Transform root, RoaLairPropCatalog kit)
        {
            switch (id)
            {
                case "raider_band":
                    Place(kit, root, "SM_Prop_Tent_Dome_01", -3.4f, 2f, 28f);
                    Place(kit, root, "SM_Prop_Tent_Dome_01", 3.4f, 2f, -28f);
                    Place(kit, root, "SM_Prop_Barricade_01", -3.3f, -2.9f);
                    Place(kit, root, "SM_Prop_Barricade_02", -1.8f, -2.9f);
                    Place(kit, root, "SM_Prop_Barricade_01", 1.8f, -2.9f);
                    Place(kit, root, "SM_Prop_Barricade_02", 3.3f, -2.9f);
                    Place(kit, root, "SM_Prop_Barricade_01", -4.7f, -0.6f, 90f);
                    Place(kit, root, "SM_Prop_Barricade_02", 4.7f, -0.6f, 90f);
                    Place(kit, root, "SM_Prop_Barricade_Corrugated_01", -4.9f, 1.3f, 90f);
                    Place(kit, root, "SM_Prop_Barricade_Corrugated_01", 4.9f, 1.3f, 90f);
                    Place(kit, root, "SM_Prop_Sandbag_Wall_01", -1.9f, 4.5f);
                    Place(kit, root, "SM_Prop_Sandbag_Wall_01", 1.9f, 4.5f);
                    Place(kit, root, "SM_Prop_FirePit_01", 0f, 0f);
                    AddLight(Place(kit, root, "FX_Fire_01", 0f, 0f),
                        new Color(1f, 0.46f, 0.18f), 1.5f, 6f);
                    Place(kit, root, "SM_Prop_Camp_Chair_01", -1.7f, 0.1f, 85f);
                    Place(kit, root, "SM_Prop_Sleeping_Bag_01", 2.6f, 1.8f, 25f);
                    Place(kit, root, "SM_Prop_SupplyPile_01", -2.7f, 3.9f);
                    Place(kit, root, "SM_Prop_Ammo_Box_Open_01", 2.6f, 0.3f, -20f);
                    Place(kit, root, "SM_Prop_Flag_Straight_01", 4.2f, 3.1f);
                    Place(kit, root, "SM_Prop_Bandit_Skull_01", -1.9f, -2.5f);
                    Place(kit, root, "SM_Prop_DeadBody_Spiked_Male_01", -3.6f, -3.4f, 45f);
                    Place(kit, root, "SM_Prop_Luggage_Open_01", 3.5f, -2.1f, -25f);
                    return true;
                case "gari_pack":
                    Place(kit, root, "SM_Env_Rock_01", -1.2f, 0.9f, 45f);
                    Place(kit, root, "SM_Env_Rock_01", 1.2f, 0.9f, -35f);
                    Place(kit, root, "SM_Env_Rock_01", 0f, 2.5f, 85f);
                    Place(kit, root, "SM_Env_DirtPile_01", -1.5f, 1.5f, 65f);
                    Place(kit, root, "SM_Env_DirtPile_02", 1.5f, 1.5f, -55f);
                    Place(kit, root, "SM_Env_DirtPile_01", -1.5f, -0.2f, 25f);
                    Place(kit, root, "SM_Env_DirtPile_02", 1.5f, -0.2f, -25f);
                    Place(kit, root, "SM_Prop_Skull_01", -0.8f, -0.5f);
                    Place(kit, root, "SM_Prop_BloodPool_01", 0.4f, -1f, 25f);
                    Place(kit, root, "SM_Prop_BloodSplat_01", 0.6f, -1.5f, -20f);
                    Place(kit, root, "SM_Prop_DeadBody_Laying_Male_01", 0.9f, -1.8f, 36f);
                    PlaceRemains(root, "kromkaGari", -2.6f, -0.55f, 40f, -0.18f, 78f);
                    return true;
                case "dustling_brood":
                    Place(kit, root, "SM_Prop_Vents_Exhaust_01", 0f, 0.8f);
                    Place(kit, root, "SM_Env_DirtPile_02", -1.1f, 0.9f, 40f);
                    Place(kit, root, "SM_Env_DirtPile_02", 1.1f, 0.9f, -55f);
                    Place(kit, root, "SM_Env_DirtPile_01", 0f, -1.3f, 150f);
                    Place(kit, root, "SM_Env_DirtPile_01", -1.2f, -0.6f, 25f);
                    Place(kit, root, "SM_Env_DirtPile_01", 1.2f, -0.6f, -25f);
                    Place(kit, root, "SM_Prop_CarBattery_01", 1.7f, -1.8f);
                    EmphasizeSwarm(Place(kit, root, "FX_Flies_01", -1f, 0.3f, 0f, 1.2f));
                    EmphasizeSwarm(Place(kit, root, "FX_Flies_01", 0f, -0.6f, 0f, 1.2f));
                    EmphasizeSwarm(Place(kit, root, "FX_Flies_01", 1f, 0.3f, 0f, 1.2f));
                    PlaceRemains(root, "kromkaDustling", 0f, -0.3f, 155f, -0.2f);
                    return true;
                case "lantern_herd":
                    Place(kit, root, "SM_Env_GrassBlob_11", -2.7f, 1.4f);
                    Place(kit, root, "SM_Env_GrassBlob_11", 2.7f, 1.4f, 60f);
                    Place(kit, root, "SM_Env_Bushes_02", -3f, -1.6f);
                    Place(kit, root, "SM_Env_Overgrowth_05", 3f, -1.6f, -35f);
                    Place(kit, root, "SM_Env_Grass_Tuft_01", -1.4f, -1.5f);
                    Place(kit, root, "SM_Env_Grass_Tuft_02", 1.4f, -1.5f);
                    AddLight(Place(kit, root, "SM_Env_Flowers_Large_01", -1.5f, 0.2f),
                        new Color(0.20f, 0.62f, 1f), 0.28f, 2.5f);
                    AddLight(Place(kit, root, "SM_Env_Flowers_Large_02", 1.6f, 0.4f),
                        new Color(0.20f, 0.62f, 1f), 0.28f, 2.5f);
                    AddLight(Place(kit, root, "SM_Env_Flowers_Large_01", 0f, -1.8f, 35f),
                        new Color(0.20f, 0.62f, 1f), 0.28f, 2.5f);
                    PlaceRemains(root, "kromkaLantern", -1.5f, -0.5f, 115f);
                    PlaceRemains(root, "kromkaLantern", 1.5f, -0.5f, 245f, 0f, 0f, true);
                    return true;
                default:
                    return false;
            }
        }

        private static void PlaceRemains(Transform parent, string modelKey,
            float x, float z, float yaw, float height = 0f, float roll = 0f,
            bool showBody = false)
        {
            var visual = new GameObject("LairRemains_" + modelKey);
            visual.transform.SetParent(parent, false);
            visual.transform.localPosition = new Vector3(x, height, z);
            visual.transform.localRotation = Quaternion.Euler(0f, yaw, roll);
            visual.AddComponent<RoaLairCreatureRemains>().Initialize(modelKey, showBody);
        }

        private static GameObject Place(RoaLairPropCatalog kit, Transform parent, string key,
            float x, float z, float yaw = 0f, float height = 0f)
        {
            GameObject prefab = kit.Find(key);
            if (prefab == null)
            {
                Debug.LogError("[ROA] Missing PolygonApocalypse lair model: " + key);
                return null;
            }
            GameObject visual = UnityEngine.Object.Instantiate(prefab, parent);
            visual.name = "LairProp_" + key;
            visual.transform.localPosition = new Vector3(x, height, z);
            visual.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            foreach (Collider collider in visual.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            return visual;
        }

        private static void AddLight(GameObject visual, Color color, float intensity, float range)
        {
            if (visual == null) return;
            Light light = visual.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.None;
        }

        private static void EmphasizeSwarm(GameObject visual)
        {
            if (visual == null) return;
            foreach (ParticleSystem particles in visual.GetComponentsInChildren<ParticleSystem>(true))
            {
                ParticleSystem.MainModule main = particles.main;
                main.startSizeMultiplier *= 1.6f;
            }
        }
    }
}
