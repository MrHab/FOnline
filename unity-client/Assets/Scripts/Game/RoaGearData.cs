using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Тиры снаряжения и дальность оружия — копия GEAR_ITEM_TIERS / GEAR_TIER_POINTS /
    /// GEAR_SLOT_WEIGHTS / GEAR_TIER_INFO и range из ITEMS (03_items_inventory_core.js:513).
    /// Нужны для «СИЛА» (gearPowerTotal) и ярлыков Т1–Т5 в PIP-ASH.
    /// </summary>
    public static class RoaGearData
    {
        private static readonly Dictionary<string, int> Tiers = new Dictionary<string, int>
        {
            { "fists", 1 }, { "knife", 1 }, { "pickaxe", 1 }, { "axe", 1 }, { "handPump", 1 }, { "pistol", 1 },
            { "rifle", 2 }, { "revolver", 2 }, { "sawedOffShotgun", 2 },
            { "shotgun", 3 }, { "assaultRifle", 3 }, { "machineGun", 3 }, { "smg", 3 },
            { "laserPistol", 4 }, { "flamethrower", 4 },
            { "plasmaRifle", 5 }, { "rocketLauncher", 5 },
            { "leather", 1 }, { "hazmatSuit", 1 }, { "metalArmor", 2 }, { "energySuit", 2 },
            { "ballisticVest", 3 }, { "combatArmor", 4 }, { "heavyArmor", 5 },
            { "weldedHelmet", 1 }, { "helmet", 2 }, { "tacticalHelmet", 3 }, { "assaultHelmet", 4 }, { "preWarHelmet", 5 },
            { "boots", 1 }, { "scoutBoots", 2 }, { "reinforcedBoots", 3 }, { "assaultBoots", 4 },
            { "backpack", 2 }
        };

        private static readonly int[] TierPoints = { 0, 10, 18, 30, 45, 65 };
        private static readonly string[] TierShort = { "", "Т1", "Т2", "Т3", "Т4", "Т5" };
        private static readonly string[] TierLabel = { "", "Самодельное", "Рабочее", "Боевое", "Армейское", "Довоенное" };
        private static readonly Color[] TierColor =
        {
            Color.clear,
            new Color(0.541f, 0.576f, 0.608f), new Color(0.847f, 0.824f, 0.753f), new Color(0.937f, 0.816f, 0.471f),
            new Color(0.624f, 0.843f, 1f), new Color(1f, 0.604f, 0.329f)
        };

        private static readonly Dictionary<string, float> SlotWeights = new Dictionary<string, float>
        {
            { "weapon", 1f }, { "offhand", 0.5f }, { "armor", 0.8f }, { "helmet", 0.4f }, { "boots", 0.3f }, { "backpack", 0.2f }
        };

        private static readonly Dictionary<string, float> WeaponRange = new Dictionary<string, float>
        {
            { "pistol", 12f }, { "revolver", 14f }, { "sawedOffShotgun", 7f }, { "smg", 14f }, { "rifle", 24f },
            { "assaultRifle", 18f }, { "machineGun", 20f }, { "laserPistol", 16f }, { "flamethrower", 8f },
            { "plasmaRifle", 18f }, { "shotgun", 11f }, { "rocketLauncher", 22f }, { "knife", 2.1f }, { "fists", 1.35f }
        };

        public static int Tier(string itemOrRuntimeId)
        {
            return Tiers.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId ?? string.Empty), out int tier) ? tier : 0;
        }

        public static string TierShortLabel(int tier) { return tier >= 1 && tier <= 5 ? TierShort[tier] : string.Empty; }
        public static string TierName(int tier) { return tier >= 1 && tier <= 5 ? TierLabel[tier] : string.Empty; }
        public static Color TierTint(int tier) { return tier >= 1 && tier <= 5 ? TierColor[tier] : Color.clear; }

        public static float Range(string weaponId)
        {
            return WeaponRange.TryGetValue(RoaInventory.BaseId(weaponId ?? string.Empty), out float range) ? range : 1.35f;
        }

        /// <summary>gearPowerTotal web: сумма очков тира по слотам с весом слота и состоянием предмета.</summary>
        public static int PowerTotal(IReadOnlyDictionary<string, string> equipment, System.Func<string, int> conditionOf)
        {
            int total = 0;
            foreach (KeyValuePair<string, float> slot in SlotWeights)
            {
                if (equipment == null || !equipment.TryGetValue(slot.Key, out string id) || string.IsNullOrEmpty(id)) continue;
                int tier = Tier(id);
                if (tier == 0) continue;
                int condition = Mathf.Clamp(conditionOf != null ? conditionOf(id) : 100, 1, 100);
                total += Mathf.RoundToInt(TierPoints[tier] * slot.Value * condition / 100f);
            }
            return total;
        }
    }
}
