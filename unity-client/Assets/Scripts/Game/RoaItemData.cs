using System.Collections.Generic;

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
            public readonly float Weight;

            public Definition(string id, string name, float weight)
            {
                Id = id;
                Name = name;
                Weight = weight;
            }
        }

        private static readonly Dictionary<string, Definition> ById = Build();

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

        public static bool Contains(string itemOrRuntimeId)
        {
            return ById.ContainsKey(RoaInventory.BaseId(itemOrRuntimeId));
        }

        public static float CarryCapacity(int effectiveStrength, bool backpackEquipped)
        {
            int strength = UnityEngine.Mathf.Clamp(effectiveStrength, 1, 15);
            return 30f + strength * 8f + (backpackEquipped ? 20f : 0f);
        }

        private static Dictionary<string, Definition> Build()
        {
            var result = new Dictionary<string, Definition>();
            Add(result, "pistol", "9mm пистолет", 1.5f);
            Add(result, "revolver", "Ржавый револьвер", 2f);
            Add(result, "sawedOffShotgun", "Обрез", 2.4f);
            Add(result, "smg", "Самодельный ПП", 3.2f);
            Add(result, "rifle", "Охотничья винтовка", 4f);
            Add(result, "assaultRifle", "Ржавый автомат", 4.8f);
            Add(result, "machineGun", "Самодельный пулемёт", 8.8f);
            Add(result, "laserPistol", "Лазерный пистолет", 2.2f);
            Add(result, "flamethrower", "Огнемёт", 7.4f);
            Add(result, "plasmaRifle", "Плазменное ружьё", 5.1f);
            Add(result, "shotgun", "Дробовик", 4.2f);
            Add(result, "rocketLauncher", "Ракетница", 9.6f);
            Add(result, "knife", "Боевой нож", 0.5f);
            Add(result, "fists", "Кулаки", 0f);

            Add(result, "leather", "Кожаная куртка", 3f);
            Add(result, "metalArmor", "Металлическая броня", 7.5f);
            Add(result, "ballisticVest", "Бронежилет", 5.5f);
            Add(result, "combatArmor", "Боевая броня", 9f);
            Add(result, "hazmatSuit", "Костюм химзащиты", 4.2f);
            Add(result, "heavyArmor", "Тяжёлая броня", 14f);
            Add(result, "energySuit", "Энергозащитный костюм", 6.8f);
            Add(result, "weldedHelmet", "Сварной шлем", 2.4f);
            Add(result, "helmet", "Стальной шлем", 2f);
            Add(result, "tacticalHelmet", "Тактический шлем", 1.9f);
            Add(result, "assaultHelmet", "Штурмовой шлем", 2.8f);
            Add(result, "preWarHelmet", "Довоенный боевой шлем", 2.6f);
            Add(result, "boots", "Армейские ботинки", 1.5f);
            Add(result, "scoutBoots", "Разведботинки", 1.1f);
            Add(result, "reinforcedBoots", "Усиленные ботинки", 2.2f);
            Add(result, "assaultBoots", "Штурмовые ботинки", 2.6f);
            Add(result, "backpack", "Рюкзак", 1.2f);

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
            Add(result, "silver", "Крышки", 0f);
            Add(result, "trophy", "Трофей", 0.5f);
            Add(result, "water", "Фляга воды", 1f);
            Add(result, "pickaxe", "Кирка", 3f);
            Add(result, "axe", "Топор", 2.5f);
            Add(result, "handPump", "Ручной насос", 2.7f);
            Add(result, "repairKit", "Ремкомплект", 1.5f);
            return result;
        }

        private static void Add(Dictionary<string, Definition> target, string id, string name, float weight)
        {
            target[id] = new Definition(id, name, weight);
        }
    }
}
