using System;
using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Клиентское описание серверного каталога сменных узлов оружия.
    /// Это только подписи, фильтрация и предварительная проверка материалов:
    /// совместимость, расход и итоговые характеристики всегда решает сервер.
    /// </summary>
    public static class RoaWeaponModificationData
    {
        public sealed class Definition
        {
            public string Id;
            public string Slot;
            public string Name;
            public string Effect;
            public Dictionary<string, int> Cost;
            public HashSet<string> WeaponIds;
            public HashSet<string> ExcludeWeaponIds;
        }

        private static readonly HashSet<string> Firearms = new HashSet<string>(new[]
        {
            "pistol", "revolver", "sawedOffShotgun", "smg", "rifle", "assaultRifle",
            "machineGun", "laserPistol", "flamethrower", "plasmaRifle", "shotgun", "rocketLauncher"
        });

        private static readonly HashSet<string> TwoHanded = new HashSet<string>(new[]
        {
            "smg", "rifle", "assaultRifle", "machineGun", "flamethrower",
            "plasmaRifle", "shotgun", "rocketLauncher"
        });

        public static readonly IReadOnlyList<Definition> All = new[]
        {
            Mod("barrel_precision", "barrel", "Прецизионный ствол", "урон +6%, дальность +12%, выстрел медленнее", Cost("scrap", 3, "weaponParts", 2),
                Only("pistol", "rifle", "assaultRifle", "machineGun", "revolver", "smg")),
            Mod("barrel_suppressor", "barrel", "Самодельный глушитель", "шум −58%, точность +4%, дальность −4%", Cost("scrap", 2, "weaponParts", 2),
                Only("pistol", "rifle", "assaultRifle", "revolver", "smg")),
            Mod("barrel_choke", "barrel", "Усиленный чок", "дальность +18%, точность +4%", Cost("scrap", 2, "weaponParts", 1),
                Only("shotgun", "sawedOffShotgun")),
            Mod("barrel_nozzle", "barrel", "Дальнобойная форсунка", "урон +4%, дальность +20%, атака медленнее", Cost("scrap", 3, "weaponParts", 2),
                Only("flamethrower")),
            Mod("barrel_accelerator", "barrel", "Ускоряющая катушка", "урон +8%, дальность +10%, атака медленнее", Cost("electronics", 3, "weaponParts", 2),
                Only("laserPistol", "plasmaRifle")),
            Mod("barrel_rocket_stabilizer", "barrel", "Стабилизатор сопла", "дальность +12%, точность +5%", Cost("scrap", 4, "weaponParts", 2),
                Only("rocketLauncher")),
            Mod("scope_reflex", "scope", "Коллиматорный прицел", "точность +4%", Cost("electronics", 2, "scrap", 1), null,
                Only("flamethrower")),
            Mod("scope_marksman", "scope", "Оптика разведчика", "точность +8%, дальность +10%", Cost("electronics", 3, "weaponParts", 2),
                Only("rifle", "assaultRifle", "machineGun", "plasmaRifle", "rocketLauncher", "smg")),
            Mod("scope_thermal", "scope", "Тепловизионный визир", "точность +6%, дальность +6%", Cost("electronics", 5, "weaponParts", 2),
                Only("laserPistol", "plasmaRifle", "flamethrower", "rocketLauncher")),
            Mod("mag_extended", "magazine", "Расширенный магазин", "ёмкость +35%, перезарядка +1 ОД", Cost("scrap", 3, "weaponParts", 2), null,
                Only("rocketLauncher", "pistol")),
            Mod("mag_quick", "magazine", "Быстросъёмный магазин", "ёмкость −14%, перезарядка −1 ОД", Cost("scrap", 2, "weaponParts", 2), null,
                Only("rocketLauncher", "pistol")),
            Mod("mag_overcharged", "magazine", "Перегруженный энергоэлемент", "урон +12%, ёмкость −20%", Cost("electronics", 4, "weaponParts", 2),
                Only("laserPistol", "plasmaRifle")),
            Mod("mag_rocket_loader", "magazine", "Кассета быстрого заряжания", "перезарядка −2 ОД", Cost("scrap", 4, "weaponParts", 3),
                Only("rocketLauncher")),
            Mod("mag_drum_pistol", "magazine", "Самодельный барабан", "ёмкость ×5, перезарядка +1 ОД", Cost("scrap", 3, "weaponParts", 1),
                Only("pistol")),
            Mod("barrel_pipe_long", "barrel", "Удлинённая труба", "дальность +30%, урон +3%", Cost("scrap", 2, "wood", 1),
                Only("pistol", "sawedOffShotgun")),
            Mod("forend_wire_wrap", "forend", "Тугая обмотка", "точность +3%", Cost("scrap", 1),
                Only("pistol", "revolver", "sawedOffShotgun", "smg")),
            Mod("forend_grip", "forend", "Эргономичная рукоять", "точность +3%, меньше штраф автоогня", Cost("wood", 2, "scrap", 1),
                Only("rifle", "assaultRifle", "machineGun", "plasmaRifle", "shotgun", "smg")),
            Mod("forend_bipod", "forend", "Складные сошки", "точность +6%", Cost("scrap", 4, "weaponParts", 1),
                Only("rifle", "assaultRifle", "machineGun", "plasmaRifle", "rocketLauncher", "smg")),
            Mod("forend_heatshield", "forend", "Теплозащитное цевьё", "атака быстрее, точность +2%", Cost("scrap", 3, "weaponParts", 2),
                Only("assaultRifle", "machineGun", "flamethrower", "plasmaRifle"))
        };

        /// <summary>Числовые эффекты и описание детали — effects/desc из WEAPON_MODIFICATION_CATALOG web (04e:9).</summary>
        public sealed class Effects
        {
            public readonly string Description;
            public readonly float DamageMul, RangeMul, AccuracyBonus, MagazineMul, FireRateMul;
            public readonly int MagazineBonus, ReloadApDelta;
            public Effects(string description, float damageMul, float rangeMul, float accuracyBonus, float magazineMul, int magazineBonus, float fireRateMul, int reloadApDelta)
            {
                Description = description; DamageMul = damageMul; RangeMul = rangeMul; AccuracyBonus = accuracyBonus;
                MagazineMul = magazineMul; MagazineBonus = magazineBonus; FireRateMul = fireRateMul; ReloadApDelta = reloadApDelta;
            }
        }

        private static readonly Dictionary<string, Effects> EffectsById = new Dictionary<string, Effects>
        {
            { "barrel_precision", new Effects("Повышает урон и дальность, но немного замедляет следующий выстрел.", 1.06f, 1.12f, 0f, 1f, 0, 1.05f, 0) },
            { "barrel_suppressor", new Effects("Резко снижает шум выстрела и слегка повышает точность ценой дальности.", 1f, 0.96f, 0.04f, 1f, 0, 1f, 0) },
            { "barrel_choke", new Effects("Сужает разлёт дроби и делает дробовик увереннее на средней дистанции.", 1f, 1.18f, 0.04f, 1f, 0, 1f, 0) },
            { "barrel_nozzle", new Effects("Формирует плотную струю пламени: дальше и мощнее, но с небольшой задержкой.", 1.04f, 1.2f, 0f, 1f, 0, 1.06f, 0) },
            { "barrel_accelerator", new Effects("Усиливает энергетический импульс ценой более долгого охлаждения.", 1.08f, 1.1f, 0f, 1f, 0, 1.08f, 0) },
            { "barrel_rocket_stabilizer", new Effects("Выравнивает сход ракеты с направляющей и делает дальний выстрел предсказуемее.", 1f, 1.12f, 0.05f, 1f, 0, 1f, 0) },
            { "scope_reflex", new Effects("Простой светящийся маркер для быстрого и точного наведения.", 1f, 1f, 0.04f, 1f, 0, 1f, 0) },
            { "scope_marksman", new Effects("Увеличивает рабочую дальность и вероятность попадания.", 1f, 1.1f, 0.08f, 1f, 0, 1f, 0) },
            { "scope_thermal", new Effects("Стабилизированный визир для сложных энергетических и тяжёлых систем.", 1f, 1.06f, 0.06f, 1f, 0, 1f, 0) },
            { "mag_extended", new Effects("Вмещает больше боеприпасов, но перезарядка требует на 1 ОД больше.", 1f, 1f, 0f, 1.35f, 0, 1f, 1) },
            { "mag_quick", new Effects("Уменьшает ёмкость, зато ускоряет перезарядку на 1 ОД.", 1f, 1f, 0f, 0.86f, 0, 1f, -1) },
            { "mag_overcharged", new Effects("Повышает мощность каждого импульса, уменьшая число зарядов.", 1.12f, 1f, 0f, 0.8f, 0, 1f, 0) },
            { "mag_rocket_loader", new Effects("Направляющая кассета заметно сокращает время установки новой ракеты.", 1f, 1f, 0f, 1f, 0, 1f, -2) },
            { "mag_drum_pistol", new Effects("Кустарный барабан на пять патронов для однозарядного самопала. Перезарядка дольше.", 1f, 1f, 0f, 5f, 0, 1f, 1) },
            { "barrel_pipe_long", new Effects("Кусок трубы подлиннее: бьёт дальше и чуть больнее.", 1.03f, 1.3f, 0f, 1f, 0, 1f, 0) },
            { "forend_wire_wrap", new Effects("Проволока и изолента: оружие не гуляет в руке.", 1f, 1f, 0.03f, 1f, 0, 1f, 0) },
            { "forend_grip", new Effects("Улучшает удержание и заметно снижает штраф автоматического огня.", 1f, 1f, 0.03f, 1f, 0, 1f, 0) },
            { "forend_bipod", new Effects("Тяжёлая, но стабильная опора для уверенного дальнего огня.", 1f, 1f, 0.06f, 1f, 0, 1f, 0) },
            { "forend_heatshield", new Effects("Лучше отводит тепло и сокращает паузу между атаками.", 1f, 1f, 0.02f, 1f, 0, 0.88f, 0) }
        };

        private static readonly Effects NoEffects = new Effects(string.Empty, 1f, 1f, 0f, 1f, 0, 1f, 0);

        public static Effects EffectsOf(string modificationId)
        {
            return !string.IsNullOrEmpty(modificationId) && EffectsById.TryGetValue(modificationId, out Effects effects) ? effects : NoEffects;
        }

        /// <summary>Ёмкость магазина и темп (fireRate) из ITEMS web — для полосы характеристик верстака.</summary>
        private static readonly Dictionary<string, (int mag, float rate)> BaseStats = new Dictionary<string, (int, float)>
        {
            { "pistol", (1, 0.48f) }, { "revolver", (6, 0.55f) }, { "sawedOffShotgun", (2, 0.6f) }, { "smg", (24, 0.26f) }, { "rifle", (5, 0.9f) },
            { "assaultRifle", (30, 0.42f) }, { "machineGun", (45, 0.58f) }, { "laserPistol", (12, 0.62f) }, { "flamethrower", (30, 0.34f) },
            { "plasmaRifle", (14, 0.48f) }, { "shotgun", (6, 0.52f) }, { "rocketLauncher", (1, 1.1f) }
        };

        public static int MagazineSize(string weaponId) { return BaseStats.TryGetValue(weaponId ?? string.Empty, out (int mag, float rate) row) ? row.mag : 0; }
        public static float FireRate(string weaponId) { return BaseStats.TryGetValue(weaponId ?? string.Empty, out (int mag, float rate) row) ? row.rate : 0f; }
        public static bool IsTwoHanded(string weaponId) { return TwoHanded.Contains(weaponId ?? string.Empty); }

        public static bool IsFirearm(string weaponId)
        {
            return !string.IsNullOrEmpty(weaponId) && Firearms.Contains(weaponId);
        }

        public static string[] SlotsFor(string weaponId)
        {
            if (!IsFirearm(weaponId)) return Array.Empty<string>();
            return TwoHanded.Contains(weaponId)
                ? new[] { "barrel", "scope", "magazine", "forend" }
                : new[] { "barrel", "scope", "magazine" };
        }

        public static bool Compatible(Definition definition, string weaponId)
        {
            if (definition == null || !IsFirearm(weaponId)) return false;
            if (definition.Slot == "forend" && !TwoHanded.Contains(weaponId)) return false;
            if (definition.WeaponIds != null && !definition.WeaponIds.Contains(weaponId)) return false;
            if (definition.ExcludeWeaponIds != null && definition.ExcludeWeaponIds.Contains(weaponId)) return false;
            return true;
        }

        public static Definition Find(string id)
        {
            foreach (Definition definition in All)
                if (definition.Id == id) return definition;
            return null;
        }

        public static string SlotLabel(string slot)
        {
            if (slot == "barrel") return "Ствол";
            if (slot == "scope") return "Прицел";
            if (slot == "magazine") return "Магазин";
            if (slot == "forend") return "Цевьё";
            return slot;
        }

        private static Definition Mod(string id, string slot, string name, string effect,
                                      Dictionary<string, int> cost,
                                      HashSet<string> weaponIds = null,
                                      HashSet<string> excludeWeaponIds = null)
        {
            return new Definition
            {
                Id = id,
                Slot = slot,
                Name = name,
                Effect = effect,
                Cost = cost,
                WeaponIds = weaponIds,
                ExcludeWeaponIds = excludeWeaponIds
            };
        }

        private static HashSet<string> Only(params string[] ids)
        {
            return new HashSet<string>(ids);
        }

        private static Dictionary<string, int> Cost(string id, int qty)
        {
            return new Dictionary<string, int> { { id, qty } };
        }

        private static Dictionary<string, int> Cost(string idA, int qtyA, string idB, int qtyB)
        {
            return new Dictionary<string, int> { { idA, qtyA }, { idB, qtyB } };
        }
    }
}
