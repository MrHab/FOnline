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
            switch (id)
            {
                case "raider_band":
                    Place(kit, root, "SM_Prop_Tent_Dome_01", -4.2f, 1.8f, 30f);
                    Place(kit, root, "SM_Prop_Tent_Dome_01", 4.2f, 1.8f, -30f);
                    Place(kit, root, "SM_Prop_Barricade_01", -3.4f, -3.4f, -28f);
                    Place(kit, root, "SM_Prop_Barricade_02", 3.4f, -3.4f, 28f);
                    Place(kit, root, "SM_Prop_FirePit_01", 0f, 0f);
                    Place(kit, root, "FX_Fire_01", 0f, 0f);
                    Place(kit, root, "SM_Prop_Camp_Chair_01", -1.5f, 0.8f, 85f);
                    Place(kit, root, "SM_Prop_Sleeping_Bag_01", 2.7f, 2.1f, 25f);
                    Place(kit, root, "SM_Prop_SupplyPile_01", -4.2f, 3.8f);
                    break;
                case "gari_pack":
                    Place(kit, root, "SM_Prop_Dog_House_01", 0f, 1.7f, 180f);
                    Place(kit, root, "SM_Env_DirtPile_01", -2.5f, 2.3f, 70f);
                    Place(kit, root, "SM_Env_DirtPile_02", 2.4f, 2.5f, -60f);
                    Place(kit, root, "SM_Prop_Skull_01", -1.3f, -0.9f);
                    Place(kit, root, "SM_Prop_BloodPool_01", 1.4f, -1.1f, 25f);
                    Place(kit, root, "SM_Prop_DeadBody_Laying_Male_01", 3.2f, -2.5f, 36f);
                    break;
                case "dustling_brood":
                    Place(kit, root, "SM_Prop_Vents_Exhaust_01", 0f, 1.1f);
                    Place(kit, root, "SM_Env_DirtPile_02", -2.8f, 1.9f, 40f);
                    Place(kit, root, "SM_Env_DirtPile_02", 2.8f, 1.9f, -55f);
                    Place(kit, root, "SM_Env_DirtPile_01", 0f, -2.6f, 150f);
                    Place(kit, root, "SM_Prop_Wall_Wire_Damaged_01", -2.7f, -2.5f, 90f);
                    Place(kit, root, "SM_Prop_TrashPile_03", 2.5f, -2.3f, -25f);
                    Place(kit, root, "SM_Env_Overgrowth_03", 3.6f, 3.2f);
                    break;
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
                case "lantern_herd":
                    Place(kit, root, "SM_Env_GrassBlob_11", -2f, 0.7f);
                    Place(kit, root, "SM_Env_GrassBlob_11", 2.1f, 1.2f, 60f);
                    Place(kit, root, "SM_Env_Bushes_02", -3.2f, -1.7f);
                    Place(kit, root, "SM_Env_Overgrowth_05", 2.7f, -1.9f, -35f);
                    Place(kit, root, "SM_Prop_Barrel_Nuke_Pool_01", 0f, -0.6f);
                    break;
            }
        }

        private static void Place(RoaLairPropCatalog kit, Transform parent, string key,
            float x, float z, float yaw = 0f)
        {
            GameObject prefab = kit.Find(key);
            if (prefab == null)
            {
                Debug.LogError("[ROA] Missing PolygonApocalypse lair model: " + key);
                return;
            }
            GameObject visual = UnityEngine.Object.Instantiate(prefab, parent);
            visual.name = "LairProp_" + key;
            visual.transform.localPosition = new Vector3(x, 0f, z);
            visual.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            foreach (Collider collider in visual.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
        }
    }
}
