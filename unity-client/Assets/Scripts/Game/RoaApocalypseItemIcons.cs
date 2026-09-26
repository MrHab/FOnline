using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Item art from the owner's locally installed Synty package.</summary>
    public static class RoaApocalypseItemIcons
    {
        private static readonly Dictionary<string, string> Names = new Dictionary<string, string>
        {
            { "pistol", "ICON_SM_Wep_Pistol_01" },
            { "revolver", "ICON_SM_Wep_Pistol_Revolver_01" },
            { "sawedOffShotgun", "ICON_SM_Wep_Shotgun_01_Apoc" },
            { "rifle", "ICON_SM_Wep_HuntingRifle_01" },
            { "assaultRifle", "ICON_SM_Wep_AssaultRifle_01" },
            { "shotgun", "ICON_SM_Wep_Shotgun_01_Farm" },
            { "rocketLauncher", "ICON_SM_Wep_RocketLauncher_01_Apoc" },
            { "pickaxe", "ICON_SM_Wep_Pickaxe_01" },
            { "axe", "ICON_SM_Wep_WoodAxe_01" },
            { "ammo9", "ICON_SM_Wep_Pistol_Ammo_01" },
            { "ammo556", "ICON_SM_Item_Bullet_Large_01" },
            { "energyCell", "ICON_SM_Item_Battery_01" },
            { "napalm", "ICON_SM_Prop_GasCan_01" },
            { "shotgunShell", "ICON_SM_Wep_Shotgun_Ammo_01" },
            { "rocketAmmo", "ICON_SM_Wep_RPG_Rocket_Seperate_01" },
            { "medkit", "ICON_SM_Item_HealthKit_01" },
            { "stim", "ICON_SM_Item_Pills_01" },
            { "antibiotics", "ICON_SM_Item_Pills_01" },
            { "wood", "ICON_SM_Prop_Wood_Stack_01" },
            { "scrap", "ICON_SM_Prop_Scav_Scrap_13" },
            { "oil", "ICON_SM_Prop_GasCan_01" },
            { "chemicals", "ICON_SM_Item_Bottle_01" },
            { "food", "ICON_SM_Item_Meat_Cooked_01" },
            { "water", "ICON_SM_Item_Drink_Bottle_02" },
            { "silver", "ICON_SM_Prop_Money_Strapped_04" },
            { "backpack", "ICON_SM_Chr_Attach_Backpack_01" }
        };

        private static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();

        public static Sprite For(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            if (string.IsNullOrEmpty(id)) return null;
            if (Cache.TryGetValue(id, out Sprite cached) && cached != null) return cached;
            Texture2D rendered = Resources.Load<Texture2D>("RealmUi/items/item_" + id);
            Sprite sprite = rendered != null
                ? Sprite.Create(rendered, new Rect(0f, 0f, rendered.width, rendered.height),
                    new Vector2(0.5f, 0.5f))
                : Names.TryGetValue(id, out string name)
                    ? Resources.Load<Sprite>("ApocalypseHud/" + name) : null;
            if (sprite != null) Cache[id] = sprite;
            return sprite;
        }
    }
}
