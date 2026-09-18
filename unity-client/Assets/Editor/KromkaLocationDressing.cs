using System;
using System.Collections.Generic;
using Kromka.Authoring;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>Adds deterministic, individually editable wasteland props to Kromka scenes.</summary>
    internal static class KromkaLocationDressing
    {
        private const string PrefabRoot = "Assets/Prefabs/Models/wasteland/";

        public static void Compose(Transform parent, string id, string type, string region)
        {
            Transform root = Child(parent, "ATMOSPHERIC_DRESSING_EDITABLE");
            string[] regional = RegionProps(region);
            for (int i = 0; i < 15; i++)
            {
                Vector3 position = Scatter(id, i, 18f, 34f);
                Place(root, id + "-dressing-region-" + (i + 1).ToString("00"),
                    regional[i % regional.Length], position, Angle(id, i),
                    0.82f + Fraction(id, i + 71) * 0.46f, false,
                    new[] { region, "regional-dressing" });
            }

            string[] functional = TypeProps(type, id);
            for (int i = 0; i < functional.Length; i++)
            {
                float angle = (i + 0.35f) * Mathf.PI * 2f / functional.Length;
                float radius = 13f + (i % 3) * 3.2f;
                Vector3 position = new Vector3(Mathf.Cos(angle) * radius, 0f,
                    Mathf.Sin(angle) * radius);
                bool blocks = IsBlocking(functional[i]);
                Place(root, id + "-dressing-functional-" + (i + 1).ToString("00"),
                    functional[i], position, -angle * Mathf.Rad2Deg + 90f,
                    0.9f + (i % 2) * 0.12f, blocks,
                    new[] { type, "functional-dressing" });
            }
        }

        private static string[] RegionProps(string region)
        {
            switch (region)
            {
                case "northern_sluices":
                    return new[] { "concrete_wall", "rust_barrel_v1", "utility_pole", "perimeter_debris" };
                case "middle_vein":
                    return new[] { "dry_bush", "garden_patch", "utility_pole", "rubble_rock" };
                case "ore_arc":
                    return new[] { "scrap_heap", "ore_outcrop", "rust_barrel_v1", "perimeter_debris" };
                case "tract_isthmus":
                    return new[] { "car_wreck", "tire_stack", "highway_sign", "dry_bush" };
                case "chalk_lowland":
                    return new[] { "rubble_rock", "deadwood", "dry_bush", "ore_outcrop" };
                case "glasslands":
                    return new[] { "dead_tree_a", "relay_antenna", "utility_pole", "perimeter_debris" };
                case "zero_basin":
                    return new[] { "dead_tree_b", "rust_barrel_v1", "oil_pump_jack", "rubble_rock" };
                case "silent_ring":
                    return new[] { "dead_tree_c", "deadwood", "rubble_rock", "ruined_billboard" };
                case "off_map":
                    return new[] { "cargo_stack", "utility_pole", "tire_stack", "perimeter_debris" };
                default:
                    return new[] { "dry_bush", "rubble_rock", "perimeter_debris" };
            }
        }

        private static string[] TypeProps(string type, string id)
        {
            switch (type)
            {
                case "tutorial":
                    return new[] { "job_board", "workshop_bench", "craft_station_weapon", "brahmin_pen", "cargo_stack", "armory_rack" };
                case "settlement":
                case "faction_capital":
                    return new[] { "wasteland_shack", "trader_awning", "job_board", "garden_patch", "storage_lean_to", "barrel_cluster", "watch_post" };
                case "caravan_hub":
                    // Торговых автоматов в экономике v3 нет.
                    return new[] { "cargo_stack", "trader_awning", "car_wreck", "tire_stack", "workshop_bench", "storage_lean_to" };
                case "road_outpost":
                    return new[] { "roadblock_barricade", "watch_post", "scrap_watch_tower", "highway_sign", "barrel_cluster" };
                case "resource_site":
                    return id.IndexOf("Oil", StringComparison.OrdinalIgnoreCase) >= 0
                        ? new[] { "oil_pump_jack", "rust_barrel_v1", "cargo_stack", "storage_lean_to" }
                        : new[] { "ore_outcrop", "scrap_heap", "cargo_stack", "workshop_bench" };
                case "industrial_site":
                    return new[] { "scrap_heap", "cargo_stack", "rust_barrel_v1", "craft_station_tools", "workshop_bench", "scrap_wall_segment" };
                case "clan_base":
                    return new[] { "scrap_watch_tower", "scrap_wall_segment", "roadblock_barricade", "armory_rack", "storage_chest", "craft_station_repair" };
                case "personal_base":
                    return new[] { "storage_chest", "campfire_rest", "craft_station_tools", "garden_patch", "fence_segment" };
                case "mutant_lair":
                    return new[] { "dead_tree_a", "deadwood", "rubble_rock", "car_wreck", "perimeter_debris" };
                case "story_complex":
                case "raid_complex":
                    return new[] { "concrete_wall", "relay_antenna", "rust_barrel_v1", "roadblock_barricade", "cargo_stack" };
                default:
                    return new[] { "car_wreck", "dry_bush", "rubble_rock", "campfire_rest" };
            }
        }

        private static bool IsBlocking(string prefab)
        {
            return prefab == "wasteland_shack" || prefab == "storage_lean_to"
                || prefab == "scrap_watch_tower" || prefab == "concrete_wall"
                || prefab == "roadblock_barricade" || prefab == "scrap_wall_segment";
        }

        private static void Place(Transform parent, string stableId, string prefabName,
                                  Vector3 position, float yaw, float scale,
                                  bool blocks, string[] tags)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabRoot + prefabName + ".prefab");
            if (prefab == null) return;
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = stableId;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = position;
            instance.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            instance.transform.localScale *= scale;
            if (!blocks)
            {
                foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true))
                    collider.enabled = false;
            }
            instance.AddComponent<KromkaPlacedObjectAuthoring>().Configure(stableId,
                prefabName, "scenery", tags, false, blocks, blocks);
            instance.AddComponent<RoaUnityLocationObject>().Configure(stableId);
        }

        private static Vector3 Scatter(string id, int index, float innerRadius, float outerRadius)
        {
            float angle = Fraction(id, index * 3 + 11) * Mathf.PI * 2f;
            float radius = Mathf.Lerp(innerRadius, outerRadius, Fraction(id, index * 3 + 19));
            return new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);
        }

        private static float Angle(string id, int index) => Fraction(id, index * 5 + 37) * 360f;

        private static float Fraction(string id, int salt)
        {
            unchecked
            {
                uint hash = 2166136261;
                string value = id + ":" + salt;
                for (int i = 0; i < value.Length; i++) hash = (hash ^ value[i]) * 16777619;
                return (hash & 0x00ffffff) / 16777215f;
            }
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }
    }
}
