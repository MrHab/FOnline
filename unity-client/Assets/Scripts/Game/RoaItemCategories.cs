using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Категории инвентаря и арт предметов — копия itemCategoryFor /
    /// ITEM_CATEGORY_TABS (03b_inventory_actions_ui.js:896) и itemArtKey /
    /// ITEM_ART_DEFS (03_items_inventory_core.js:235). Таблица сгенерирована
    /// из web ITEMS: категория по type/slot/heal/repair, ключ арта — свой SVG,
    /// иначе SVG типа, иначе misc. Сами SVG отрисованы в PNG 128×128 в
    /// Resources/RealmUi/items/item_{key}.png.
    /// </summary>
    public static class RoaItemCategories
    {
        public sealed class Tab
        {
            public readonly string Id;
            public readonly string Label;
            public Tab(string id, string label) { Id = id; Label = label; }
        }

        public static readonly Tab[] Tabs =
        {
            new Tab("all", "Всё"),
            new Tab("weapons", "Оружие"),
            new Tab("armor", "Броня"),
            new Tab("aid", "Мед."),
            new Tab("ammo", "Патроны"),
            new Tab("tools", "Инструм."),
            new Tab("materials", "Материалы"),
            new Tab("misc", "Разное")
        };

        private static readonly Dictionary<string, string> CategoryById = new Dictionary<string, string>
        {
            { "pistol", "weapons" }, { "revolver", "weapons" }, { "sawedOffShotgun", "weapons" }, { "smg", "weapons" },
            { "rifle", "weapons" }, { "assaultRifle", "weapons" }, { "machineGun", "weapons" }, { "laserPistol", "weapons" },
            { "flamethrower", "weapons" }, { "plasmaRifle", "weapons" }, { "shotgun", "weapons" }, { "rocketLauncher", "weapons" },
            { "knife", "weapons" }, { "fists", "weapons" },
            { "leather", "armor" }, { "metalArmor", "armor" }, { "ballisticVest", "armor" }, { "combatArmor", "armor" },
            { "hazmatSuit", "armor" }, { "heavyArmor", "armor" }, { "energySuit", "armor" }, { "preWarHelmet", "armor" },
            { "weldedHelmet", "armor" }, { "helmet", "armor" }, { "tacticalHelmet", "armor" }, { "assaultHelmet", "armor" },
            { "boots", "armor" }, { "scoutBoots", "armor" }, { "assaultBoots", "armor" }, { "reinforcedBoots", "armor" }, { "backpack", "armor" },
            { "ammo9", "ammo" }, { "ammo556", "ammo" }, { "energyCell", "ammo" }, { "napalm", "ammo" }, { "shotgunShell", "ammo" }, { "rocketAmmo", "ammo" },
            { "medkit", "aid" }, { "stim", "aid" }, { "doctorBag", "aid" }, { "antibiotics", "aid" },
            { "ore", "materials" }, { "wood", "materials" }, { "scrap", "materials" }, { "oil", "materials" }, { "chemicals", "materials" },
            { "medicine", "materials" }, { "electronics", "materials" }, { "ammoParts", "materials" }, { "weaponParts", "materials" },
            { "food", "misc" }, { "silver", "misc" }, { "trophy", "misc" }, { "water", "misc" },
            { "pickaxe", "tools" }, { "axe", "tools" }, { "handPump", "tools" }, { "repairKit", "tools" }
        };

        private static readonly Dictionary<string, string> ArtKeyById = new Dictionary<string, string>
        {
            { "revolver", "misc" }, { "sawedOffShotgun", "misc" }, { "smg", "misc" },
            { "preWarHelmet", "helmet" }, { "weldedHelmet", "helmet" }, { "assaultBoots", "boots" },
            { "chemicals", "misc" }, { "medicine", "misc" }, { "electronics", "misc" }, { "ammoParts", "misc" },
            { "food", "misc" }, { "weaponParts", "misc" }
        };

        private static readonly Dictionary<string, Texture2D> ArtCache = new Dictionary<string, Texture2D>();

        public static string Category(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            return CategoryById.TryGetValue(id, out string category) ? category : "misc";
        }

        public static bool Matches(string itemOrRuntimeId, string category)
        {
            return string.IsNullOrEmpty(category) || category == "all" || Category(itemOrRuntimeId) == category;
        }

        public static string Label(string category)
        {
            foreach (Tab tab in Tabs) if (tab.Id == category) return tab.Label;
            return "Всё";
        }

        public static string ArtKey(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            if (string.IsNullOrEmpty(id)) return "misc";
            if (ArtKeyById.TryGetValue(id, out string key)) return key;
            return CategoryById.ContainsKey(id) ? id : "misc";
        }

        /// <summary>PNG-растр SVG-арта web; null только если ресурс отсутствует.</summary>
        public static Texture2D Art(string itemOrRuntimeId)
        {
            string key = ArtKey(itemOrRuntimeId);
            if (ArtCache.TryGetValue(key, out Texture2D cached)) return cached;
            Texture2D texture = Resources.Load<Texture2D>("RealmUi/items/item_" + key);
            if (texture == null && key != "misc") texture = Resources.Load<Texture2D>("RealmUi/items/item_misc");
            ArtCache[key] = texture;
            return texture;
        }
    }
}
