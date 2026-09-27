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
            string authoritative = RoaItemData.Category(id);
            if (!string.IsNullOrEmpty(authoritative))
            {
                if (authoritative == "currency" || authoritative == "strategic"
                    || authoritative == "artifacts") return "misc";
                return authoritative;
            }
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

        /// <summary>
        /// Картинка предмета; null только если нет вообще ничего.
        ///
        /// Сначала пробуем ИНДИВИДУАЛЬНЫЙ рендер item_{id}: их печёт из моделей
        /// предметов RoaItemRenderBaker (меню «Realm of Ashes/Напечь рендеры
        /// предметов»), и они есть у 83 предметов из 84. Общий рисунок по ArtKey
        /// остаётся запасным — по нему живут те, у кого своей модели нет
        /// (сейчас это только fists), — а item_misc замыкает цепочку.
        /// Кэш теперь по id, а не по ключу арта: картинки стали разными.
        /// </summary>
        public static Texture2D Art(string itemOrRuntimeId)
        {
            // Предмет с тиром — своя картинка и точка цвета тира в углу (копия на каждый тир).
            string exact = RoaInventory.BaseId(itemOrRuntimeId);
            if (RoaItemData.IsTiered(exact))
            {
                if (TierArtCache.TryGetValue(exact, out Texture2D badged) && badged != null) return badged;
                badged = TierBadged(ArtOf(itemOrRuntimeId), RoaTierData.TierColor(RoaItemData.Tier(exact)));
                TierArtCache[exact] = badged;
                return badged;
            }
            return ArtOf(itemOrRuntimeId);
        }

        private static readonly Dictionary<string, Texture2D> TierArtCache = new Dictionary<string, Texture2D>();

        /// <summary>
        /// Копия картинки с точкой цвета тира в правом нижнем углу (с тёмной обводкой).
        /// Иконки не читаемы с диска, поэтому копия снимается через RenderTexture (в sRGB).
        /// </summary>
        public static Texture2D TierBadged(Texture2D source, Color tier)
        {
            if (source == null) return source;
            RenderTexture target = RenderTexture.GetTemporary(source.width, source.height, 0,
                RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            RenderTexture previous = RenderTexture.active;
            try
            {
                Graphics.Blit(source, target);
                RenderTexture.active = target;
                var copy = new Texture2D(source.width, source.height, TextureFormat.RGBA32, false)
                {
                    name = source.name + "_tier",
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = source.filterMode
                };
                copy.ReadPixels(new Rect(0f, 0f, source.width, source.height), 0, 0);
                Color32[] pixels = copy.GetPixels32();
                int w = source.width, h = source.height;
                float radius = Mathf.Max(4f, w * 0.085f);
                float cx = w - radius * 1.5f, cy = radius * 1.5f;
                Color32 fill = tier, edge = new Color32(22, 20, 16, 255);
                for (int y = Mathf.Max(0, (int)(cy - radius - 2)); y < Mathf.Min(h, (int)(cy + radius + 3)); y++)
                    for (int x = Mathf.Max(0, (int)(cx - radius - 2)); x < Mathf.Min(w, (int)(cx + radius + 3)); x++)
                    {
                        float d = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                        if (d <= radius - 1.5f) pixels[y * w + x] = fill;
                        else if (d <= radius + 1f) pixels[y * w + x] = edge;
                    }
                copy.SetPixels32(pixels);
                copy.Apply(false, true);
                return copy;
            }
            finally
            {
                RenderTexture.active = previous;
                RenderTexture.ReleaseTemporary(target);
            }
        }

        private static Texture2D ArtOf(string itemOrRuntimeId)
        {
            // Своя картинка (у каждого тира материала она своя), иначе — исходного предмета.
            string id = RoaItemData.IconId(itemOrRuntimeId);
            if (string.IsNullOrEmpty(id)) id = "misc";
            if (ArtCache.TryGetValue(id, out Texture2D cached)) return cached;

            Sprite apocalypseIcon = RoaApocalypseItemIcons.Untinted(id);
            Texture2D texture = apocalypseIcon != null ? apocalypseIcon.texture : null;
            if (texture == null) texture = Resources.Load<Texture2D>("RealmUi/items/item_" + id);
            if (texture == null && RoaApocalypseModels.Weapon(id) != null)
                texture = Resources.Load<Texture2D>("RealmUi/items/item_"
                    + RoaApocalypseModels.WeaponRig(id));
            if (texture == null)
            {
                string key = ArtKey(itemOrRuntimeId);
                if (key != id) texture = Resources.Load<Texture2D>("RealmUi/items/item_" + key);
                if (texture == null) texture = Resources.Load<Texture2D>("RealmUi/items/item_misc");
            }
            ArtCache[id] = texture;
            return texture;
        }
    }
}
