using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Клиентские подписи и вес предметов. Значения совпадают с ITEMS браузерного
    /// клиента и SERVER_ITEM_WEIGHTS; сервер всё равно повторно проверяет переносимый вес.
    /// </summary>
    public static class RoaItemData
    {
        public sealed class Definition
        {
            public readonly string Id;
            public readonly string Name;
            public readonly string Description;
            public readonly int Tier;
            public readonly float Weight;
            public readonly int BasePrice;
            public readonly int StackLimit;
            public readonly string Category;
            public readonly string Slot;
            public readonly string ConditionMode;
            /// <summary>Слоты экипировки из каталога сервера: weapon, offhand и т.д.</summary>
            public readonly string[] CompatibleSlots;
            /// <summary>Непустой тип патронов отличает огнестрел от ножа и инструмента.</summary>
            public readonly string AmmoType;
            /// <summary>Группа тировых вариантов (smgT4 → smg); пусто у предметов без тиров.</summary>
            public readonly string TierGroup;
            /// <summary>Чья модель и иконка у предмета: вариант тира выглядит как исходник.</summary>
            public readonly string VisualId;
            /// <summary>Семейство материала (metal, wood, fiber, hide, oil) и raw/refined.</summary>
            public readonly string Family;
            public readonly string MaterialKind;

            public Definition(string id, string name, float weight, int basePrice = 0,
                              int stackLimit = 0, string category = "", string slot = "",
                              string conditionMode = "none", string[] compatibleSlots = null,
                              string ammoType = "", string description = "", int tier = 0,
                              string tierGroup = "", string visualId = "", string family = "",
                              string materialKind = "")
            {
                CompatibleSlots = compatibleSlots ?? EmptySlots;
                AmmoType = ammoType ?? string.Empty;
                TierGroup = tierGroup ?? string.Empty;
                VisualId = string.IsNullOrEmpty(visualId) ? id : visualId;
                Family = family ?? string.Empty;
                MaterialKind = materialKind ?? string.Empty;
                Id = id;
                // У тировых предметов имя несёт тир: пять «Шорохов» различимы в сумке и на торгах.
                Name = !string.IsNullOrEmpty(TierGroup) && tier > 0 ? name + " [T" + tier + "]" : name;
                Description = description;
                Tier = tier;
                Weight = weight;
                BasePrice = basePrice;
                StackLimit = stackLimit;
                Category = category;
                Slot = slot;
                ConditionMode = conditionMode;
            }
        }

        private static readonly string[] EmptySlots = new string[0];
        private static readonly Dictionary<string, Definition> ById = Build();
        public static int CatalogVersion { get; private set; }

        public static string Name(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            Definition definition;
            return ById.TryGetValue(id, out definition) ? definition.Name : id;
        }

        public static float Weight(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            Definition definition;
            return ById.TryGetValue(id, out definition) ? definition.Weight : 0f;
        }

        public static string Description(string itemOrRuntimeId)
        {
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out Definition definition)
                ? definition.Description : string.Empty;
        }

        public static int Tier(string itemOrRuntimeId)
        {
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out Definition definition)
                ? definition.Tier : 0;
        }

        /// <summary>
        /// Id облика: модель, иконка и боевая оснастка варианта тира берутся у
        /// исходного предмета (smgT5 → smg, oreT4 → ore). Без каталога — сам id.
        /// </summary>
        public static string VisualId(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            return !string.IsNullOrEmpty(id) && ById.TryGetValue(id, out Definition definition)
                ? definition.VisualId : id;
        }

        /// <summary>Группа тировых вариантов предмета; у предмета без тиров — сам id.</summary>
        public static string TierGroup(string itemOrRuntimeId)
        {
            string id = RoaInventory.BaseId(itemOrRuntimeId);
            return ById.TryGetValue(id ?? string.Empty, out Definition definition) && !string.IsNullOrEmpty(definition.TierGroup)
                ? definition.TierGroup : id;
        }

        public static bool Contains(string itemOrRuntimeId)
        {
            return ById.ContainsKey(RoaInventory.BaseId(itemOrRuntimeId));
        }

        public static int BasePrice(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.BasePrice : 0;
        }

        public static int StackLimit(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.StackLimit : 0;
        }

        public static string Category(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.Category : string.Empty;
        }

        public static string Slot(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.Slot : string.Empty;
        }

        /// <summary>Слоты, в которые предмет разрешает надеть себя серверный каталог.</summary>
        public static string[] CompatibleSlots(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.CompatibleSlots : EmptySlots;
        }

        /// <summary>Тип патронов; пусто у ножа, кулаков и инструментов.</summary>
        public static string AmmoType(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.AmmoType : string.Empty;
        }

        public static string ConditionMode(string itemOrRuntimeId)
        {
            Definition definition;
            return ById.TryGetValue(RoaInventory.BaseId(itemOrRuntimeId), out definition)
                ? definition.ConditionMode : "none";
        }

        /// <summary>
        /// Replaces the baked emergency labels with the authoritative server catalog.
        /// The swap happens only after every row is validated, so a partial HTTP response
        /// can never leave the inventory with half a catalog.
        /// </summary>
        public static bool ApplyCatalog(JObject catalog, out string error)
        {
            error = string.Empty;
            JArray rows = catalog?["items"] as JArray;
            if (rows == null || rows.Count < 60)
            {
                error = "Каталог предметов пуст или неполон.";
                return false;
            }
            var next = new Dictionary<string, Definition>();
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString() ?? string.Empty;
                string name = row?["name"]?.ToString() ?? string.Empty;
                float weight = row?["weight"]?.ToObject<float?>() ?? -1f;
                int basePrice = row?["basePrice"]?.ToObject<int?>() ?? -1;
                int stackLimit = row?["stackLimit"]?.ToObject<int?>() ?? -1;
                string category = row?["category"]?.ToString() ?? string.Empty;
                string slot = row?["slot"]?.ToString() ?? string.Empty;
                string conditionMode = row?["conditionMode"]?.ToString() ?? string.Empty;
                var slotsArray = row?["compatibleSlots"] as JArray;
                string[] compatibleSlots = slotsArray != null
                    ? slotsArray.Select(entry => entry?.ToString() ?? string.Empty)
                        .Where(entry => !string.IsNullOrEmpty(entry)).ToArray()
                    : EmptySlots;
                string ammoType = row?["ammoType"]?.ToString() ?? string.Empty;
                string description = row?["description"]?.ToString() ?? string.Empty;
                int tier = row?["tier"]?.ToObject<int?>() ?? 0;
                string tierGroup = row?["tierGroup"]?.ToString() ?? string.Empty;
                string visualId = row?["visualId"]?.ToString() ?? string.Empty;
                string family = row?["family"]?.ToString() ?? string.Empty;
                string materialKind = row?["materialKind"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)
                    || weight < 0f || basePrice < 0 || stackLimit < 0
                    || string.IsNullOrEmpty(category) || string.IsNullOrEmpty(conditionMode)
                    || tier < 0 || tier > 5
                    || next.ContainsKey(id))
                {
                    error = "Каталог предметов содержит повреждённую строку: " + id;
                    return false;
                }
                next[id] = new Definition(id, name, weight, basePrice, stackLimit,
                    category, slot, conditionMode, compatibleSlots, ammoType, description, tier,
                    tierGroup, visualId, family, materialKind);
            }
            if (!next.ContainsKey("fists") || !next.ContainsKey("silver")
                || !next.ContainsKey("artifactDetectorMk1") || !next.ContainsKey("artifactBelt2"))
            {
                error = "Каталог предметов не содержит обязательные системные предметы.";
                return false;
            }
            ById.Clear();
            foreach (KeyValuePair<string, Definition> row in next) ById[row.Key] = row.Value;
            CatalogVersion = Math.Max(1, catalog?["version"]?.ToObject<int?>() ?? 1);
            return true;
        }

        public static float CarryCapacity(int effectiveStrength, bool backpackEquipped)
        {
            int strength = UnityEngine.Mathf.Clamp(effectiveStrength, 1, 15);
            return 30f + strength * 8f + (backpackEquipped ? 20f : 0f);
        }

        private static Dictionary<string, Definition> Build()
        {
            var result = new Dictionary<string, Definition>();
            Add(result, "pistol", "Пистолет «Искра»", 1.5f);
            Add(result, "revolver", "Револьвер «Шериф»", 2f);
            Add(result, "sawedOffShotgun", "Дробовик «Коротыш»", 2.4f);
            Add(result, "smg", "ПП «Шорох»", 3.2f);
            Add(result, "rifle", "Винтовка «След»", 4f);
            Add(result, "assaultRifle", "Автомат «Рубеж»", 4.8f);
            Add(result, "machineGun", "Пулемёт «Гром»", 8.8f);
            Add(result, "laserPistol", "Гибрид «Разряд»", 2.2f);
            Add(result, "flamethrower", "Огнемёт «Жар»", 7.4f);
            Add(result, "plasmaRifle", "Гибрид «Заря»", 5.1f);
            Add(result, "shotgun", "Дробовик «Град»", 4.2f);
            Add(result, "rocketLauncher", "Ракетомёт «Пепел»", 9.6f);
            Add(result, "knife", "Нож «Тихий»", 0.5f);
            IReadOnlyList<RoaApocalypseModels.WeaponEntry> apocalypseWeapons =
                RoaApocalypseModels.WeaponEntries;
            if (apocalypseWeapons != null)
                foreach (RoaApocalypseModels.WeaponEntry entry in apocalypseWeapons)
                    if (entry != null && entry.itemId != null
                        && entry.itemId != "pickaxe" && entry.itemId != "axe"
                        && entry.itemId != "handPump")
                        Add(result, entry.itemId, entry.displayName, entry.weight);
            Add(result, "fists", "Кулаки", 0f);

            Add(result, "leather", "Куртка «Пыль»", 3f);
            Add(result, "metalArmor", "Панцирь «Лом»", 7.5f);
            Add(result, "ballisticVest", "Жилет «Застава»", 5.5f);
            Add(result, "combatArmor", "Комплект «Штурм»", 9f);
            Add(result, "hazmatSuit", "Костюм «Фильтр»", 4.2f);
            Add(result, "heavyArmor", "Панцирь «Бастион»", 14f);
            Add(result, "energySuit", "Костюм «Изолятор»", 6.8f);
            Add(result, "weldedHelmet", "Шлем «Сварщик»", 2.4f);
            Add(result, "helmet", "Шлем «Караул»", 2f);
            Add(result, "tacticalHelmet", "Шлем «Дозор»", 1.9f);
            Add(result, "assaultHelmet", "Шлем «Штурм»", 2.8f);
            Add(result, "preWarHelmet", "Шлем «Реликт»", 2.6f);
            Add(result, "boots", "Ботинки «Тропа»", 1.5f);
            Add(result, "scoutBoots", "Ботинки «След»", 1.1f);
            Add(result, "reinforcedBoots", "Ботинки «Крепь»", 2.2f);
            Add(result, "assaultBoots", "Ботинки «Натиск»", 2.6f);
            Add(result, "backpack", "Рюкзак «Странник»", 1.2f);

            Add(result, "ammo9", "Патроны 9mm", 0.025f);
            Add(result, "ammo556", "Патроны .223", 0.04f);
            Add(result, "energyCell", "Энергозаряды", 0.03f);
            Add(result, "napalm", "Напалм", 0.08f);
            Add(result, "shotgunShell", "Патроны 12 калибра", 0.05f);
            Add(result, "rocketAmmo", "Ракета", 0.85f);
            Add(result, "medkit", "Аптечка", 0.6f);
            Add(result, "stim", "Стимулятор", 0.2f);
            Add(result, "doctorBag", "Набор доктора", 0.9f);
            Add(result, "antibiotics", "Антибиотики", 0.15f);

            Add(result, "ore", "Железная руда", 2f);
            Add(result, "wood", "Древесина", 1.2f);
            Add(result, "scrap", "Металлолом", 1.4f);
            Add(result, "oil", "Канистра нефти", 1.5f);
            Add(result, "chemicals", "Химикаты", 0.45f);
            Add(result, "medicine", "Медикаменты", 0.35f);
            Add(result, "electronics", "Электроника", 0.6f);
            Add(result, "ammoParts", "Детали патронов", 0.18f);
            Add(result, "food", "Пища", 0.65f);
            Add(result, "weaponParts", "Оружейные детали", 0.85f);
            Add(result, "bioReagent", "Биореагент", 0.3f);
            Add(result, "circuitModule", "Контурный модуль", 0.4f);
            Add(result, "alloyPlate", "Пластина сплава", 0.7f);
            Add(result, "spectrumSample", "Спектральная проба", 0.25f);
            Add(result, "stabilizerCatalyst", "Катализатор стабилизации", 0.2f);
            Add(result, "silver", "Марки Тракта", 0f);
            Add(result, "blue", "Кассета сини", 0.4f);
            Add(result, "trophy", "Трофей", 0.5f);
            Add(result, "water", "Фляга воды", 1f);
            Add(result, "pickaxe", "Лопата «Пласт»", 3f);
            Add(result, "axe", "Топор «Пролом»", 2.5f);
            Add(result, "handPump", "Ключ «Поток»", 2.7f);
            Add(result, "sickle", "Серп «Жнец»", 1.4f);
            Add(result, "skinningKnife", "Нож свежевальщика «Шкурник»", 0.6f);
            Add(result, "repairKit", "Ремкомплект", 1.5f);
            Add(result, "artifactDetectorMk1", "Детектор МК-1", 0.8f);
            Add(result, "artifactDetectorMk2", "Детектор МК-2", 0.9f);
            Add(result, "artifactDetectorMk3", "Детектор МК-3", 1f);
            Add(result, "artifactBelt2", "Пояс-контейнер на 2", 1.2f);
            Add(result, "artifactBelt3", "Пояс-контейнер на 3", 1.5f);
            Add(result, "artifactBelt4", "Пояс-контейнер на 4", 1.8f);
            Add(result, "artifactContainer", "Свинцовый контейнер", 2f);
            Add(result, "motorcycle", "Армейский мотоцикл", 0f);
            Add(result, "artifactSpring", "Артефакт «Пружина»", 0.45f);
            Add(result, "artifactVein", "Артефакт «Жила»", 0.6f);
            Add(result, "artifactNode", "Артефакт «Узел»", 0.7f);
            Add(result, "artifactDrop", "Артефакт «Капля»", 0.35f);
            Add(result, "artifactBloodkin", "Артефакт «Кровник»", 0.8f);
            Add(result, "artifactShell", "Артефакт «Панцирь»", 1.1f);
            Add(result, "artifactWarmer", "Артефакт «Тепляк»", 0.5f);
            Add(result, "artifactSieve", "Артефакт «Сито»", 0.4f);
            Add(result, "artifactThunderer", "Артефакт «Громник»", 0.65f);
            Add(result, "artifactHusher", "Артефакт «Молчун»", 0.5f);
            Add(result, "artifactAnchor", "Артефакт «Якорь»", 1.2f);
            Add(result, "artifactDew", "Артефакт «Роса»", 0.35f);
            Add(result, "artifactMemory", "Артефакт «Память»", 0.4f);
            return result;
        }

        private static void Add(Dictionary<string, Definition> target, string id, string name, float weight)
        {
            target[id] = new Definition(id, name, weight);
        }
    }
}
