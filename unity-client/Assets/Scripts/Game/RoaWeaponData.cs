using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Клиентский каталог оружия для HUD: имя, урон, стоимость выстрела, калибр.
    ///
    /// Сервер в combat-блоке шлёт только состояние (loaded, magSize, reserveAmmo,
    /// condition — serverCombatAck, server.js:8406), а справочные данные оружия
    /// живут в каталоге. Web-клиент держит ту же копию в ITEMS; источник истины —
    /// SERVER_WEAPONS (server.js:4427), и урон здесь показательный: считает всё
    /// равно сервер.
    /// </summary>
    public static class RoaWeaponData
    {
        public sealed class Weapon
        {
            public string Id;
            public string Name;
            public int DmgMin;
            public int DmgMax;
            public int ApCost;
            public string AmmoType;
            public bool Automatic;
            public bool DualWield;
            public string WeaponSkill;
        }

        public sealed class FireMode
        {
            public string Id;
            public string Label;
            public int ApCost;
            public float DamageMul;
        }

        private static readonly Dictionary<string, Weapon> Catalog = new Dictionary<string, Weapon>();

        static RoaWeaponData()
        {
            Add("pistol", "9mm пистолет", 18, 26, 3, "ammo9", false, true);
            Add("revolver", "Ржавый револьвер", 22, 32, 3, "ammo9", false, false);
            Add("sawedOffShotgun", "Обрез", 30, 44, 4, "shotgunShell", false, false);
            Add("smg", "Самодельный ПП", 12, 17, 4, "ammo9", true, false);
            Add("rifle", "Охотничья винтовка", 28, 40, 4, "ammo556", false, false);
            Add("assaultRifle", "Ржавый автомат", 13, 19, 4, "ammo556", true, false);
            Add("machineGun", "Самодельный пулемёт", 12, 18, 5, "ammo556", true, false, "heavyWeapons");
            Add("laserPistol", "Лазерный пистолет", 22, 32, 4, "energyCell", false, true, "energyWeapons");
            Add("flamethrower", "Огнемёт", 14, 22, 5, "napalm", true, false, "heavyWeapons");
            Add("plasmaRifle", "Плазменное ружьё", 32, 48, 5, "energyCell", false, false, "energyWeapons");
            Add("shotgun", "Дробовик", 26, 40, 5, "shotgunShell", false, false);
            Add("rocketLauncher", "Ракетница", 54, 78, 6, "rocketAmmo", false, false, "heavyWeapons");

            Add("knife", "Боевой нож", 9, 15, 2, null, false, false, "melee");
            Add("pickaxe", "Кирка", 13, 21, 3, null, false, false, "melee");
            Add("axe", "Топор", 11, 19, 3, null, false, false, "melee");
            Add("handPump", "Ручной насос", 7, 12, 3, null, false, false, "melee");
            Add("fists", "Кулаки", 2, 4, 2, null, false, false, "unarmed");
        }

        private static void Add(string id, string name, int dmgMin, int dmgMax,
                                int apCost, string ammoType, bool automatic, bool dualWield,
                                string weaponSkill = "lightWeapons")
        {
            Catalog[id] = new Weapon
            {
                Id = id,
                Name = name,
                DmgMin = dmgMin,
                DmgMax = dmgMax,
                ApCost = apCost,
                AmmoType = ammoType,
                Automatic = automatic,
                DualWield = dualWield,
                WeaponSkill = weaponSkill
            };
        }

        public static Weapon Get(string weaponId)
        {
            Weapon weapon;
            if (Catalog.TryGetValue(weaponId ?? string.Empty, out weapon)) return weapon;
            return Catalog["fists"];
        }

        /// <summary>
        /// Режим стрельбы для консоли. Портирует getWeaponModes()
        /// (06c_combat_stats_modes.js:360): одиночный — базовая стоимость,
        /// прицельный +2 ОД и ×1.05 урона, автоматический — половина стоимости
        /// одиночного с округлением вниз при профильном навыке 70%+.
        /// </summary>
        public static FireMode Mode(string weaponId, string modeId, int skillPercent = 0)
        {
            Weapon weapon = Get(weaponId);

            if (string.IsNullOrEmpty(weapon.AmmoType) || modeId == "melee")
                return new FireMode { Id = "melee", Label = "Ближний бой", ApCost = weapon.ApCost, DamageMul = 1f };

            switch (modeId)
            {
                case "aimed":
                    return new FireMode { Id = "aimed", Label = "Прицельный", ApCost = weapon.ApCost + 2, DamageMul = 1.05f };
                case "auto":
                    // automaticApCost (06c:65): половина одиночного, при профильном
                    // навыке 70%+ округляется вниз.
                    float half = Mathf.Max(1, weapon.ApCost) * 0.5f;
                    return new FireMode
                    {
                        Id = "auto",
                        Label = "Автоматический",
                        ApCost = Mathf.Max(1, skillPercent >= 70
                            ? Mathf.FloorToInt(half) : Mathf.CeilToInt(half)),
                        DamageMul = 1f
                    };
                default:
                    return new FireMode { Id = "single", Label = "Одиночный", ApCost = weapon.ApCost, DamageMul = 1f };
            }
        }

        /// <summary>«Патроны 9mm» → «9mm», как ammoTypeText в web (13:258).</summary>
        public static string AmmoLabel(string ammoType)
        {
            if (string.IsNullOrEmpty(ammoType)) return "без патронов";

            string name = RoaItemData.Name(ammoType);
            if (string.IsNullOrEmpty(name)) return ammoType;

            if (name.StartsWith("Патроны ")) name = name.Substring("Патроны ".Length);
            else if (name.StartsWith("Патрон ")) name = name.Substring("Патрон ".Length);

            return name.Trim().Length > 0 ? name.Trim() : ammoType;
        }
    }
}
