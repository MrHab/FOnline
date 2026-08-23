using System.Collections.Generic;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Отображаемый каталог рецептов web-клиента. Сервер повторно проверяет рецепт,
    /// станок, материалы, комиссию, вес и итоговый стек перед любой мутацией.
    /// </summary>
    public sealed class RoaCraftRecipe
    {
        public string Id;
        public string Name;
        public string OutputId;
        public int OutputQty;
        public string Station;
        public string Description;
        public Dictionary<string, int> Cost;

        public int Fee
        {
            get
            {
                int total = 0;
                foreach (int qty in Cost.Values) total += qty;
                return System.Math.Max(1, (total + 4) / 5);
            }
        }
    }

    public static class RoaCraftingData
    {
        // ВАЖНО: словарь объявлен раньше Recipes — статические поля
        // инициализируются в порядке объявления, и Recipe() читает его.
        /// <summary>Описания из web CRAFT_RECIPES (03_items_inventory_core.js:72).</summary>
        private static readonly Dictionary<string, string> Descriptions = new Dictionary<string, string>
        {
            { "ammo9craft", "Простые боеприпасы для пистолета." },
            { "ammo556craft", "Боеприпасы для винтовки." },
            { "repairkitcraft", "Набор для ремонта оружия и брони." },
            { "knifecraft", "Запасное оружие ближнего боя." },
            { "assaultcraft", "Автоматическое оружие с одиночным, прицельным и автоматическим режимом." },
            { "machineguncraft", "Тяжёлое автоматическое оружие для навыка Тяжёлое оружие." },
            { "lasercraft", "Энергетическое оружие с риском перегрева/сбоя." },
            { "flamercraft", "Тяжёлое оружие с огненной струёй." },
            { "plasmacraft", "Мощное энергетическое ружьё." },
            { "shotguncraft", "Надёжное оружие ближней и средней дистанции." },
            { "rocketcrafter", "Тяжёлое взрывное оружие с уроном по области." },
            { "energycellcraft", "Боеприпасы для энергетического оружия." },
            { "napalmcraft", "Горючая смесь для огнемёта." },
            { "shellcraft", "Боеприпасы для дробовика." },
            { "rocketammocraft", "Боеприпасы для ракетницы." },
            { "pickaxecraft", "Инструмент для добычи руды." },
            { "axecraft", "Инструмент для заготовки древесины." },
            { "handpumpcraft", "Инструмент для откачки воды и нефти." },
            { "weaponpartscraft", "Пружины, штифты и заготовки стволов. Нужны почти для любой модификации оружия." },
            { "electronicscraft", "Платы и датчики. Нужны для прицелов и энергетических модификаций." },
        };

        public static readonly IReadOnlyList<RoaCraftRecipe> Recipes = new[]
        {
            Recipe("ammo9craft", "Самодельные патроны 9mm", "ammo9", 8, "ammo_bench", "ore", 1, "wood", 1),
            Recipe("ammo556craft", "Патроны .223", "ammo556", 5, "ammo_bench", "ore", 2, "wood", 1),
            Recipe("repairkitcraft", "Ремкомплект", "repairKit", 1, "repair_bench", "ore", 2, "wood", 2),
            Recipe("knifecraft", "Боевой нож", "knife", 1, "weapon_bench", "ore", 2, "wood", 1),
            Recipe("assaultcraft", "Ржавый автомат", "assaultRifle", 1, "weapon_bench", "ore", 6, "wood", 3),
            Recipe("machineguncraft", "Самодельный пулемёт", "machineGun", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("lasercraft", "Лазерный пистолет", "laserPistol", 1, "energy_bench", "ore", 5, "wood", 2),
            Recipe("flamercraft", "Огнемёт", "flamethrower", 1, "weapon_bench", "ore", 9, "wood", 3, "oil", 2),
            Recipe("plasmacraft", "Плазменное ружьё", "plasmaRifle", 1, "energy_bench", "ore", 10, "wood", 2, "silver", 10),
            Recipe("shotguncraft", "Дробовик", "shotgun", 1, "weapon_bench", "ore", 7, "wood", 4),
            Recipe("rocketcrafter", "Ракетница", "rocketLauncher", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("energycellcraft", "Энергозаряды", "energyCell", 8, "energy_bench", "ore", 2, "wood", 1),
            Recipe("napalmcraft", "Напалм", "napalm", 12, "chem_station", "oil", 2, "scrap", 1, "wood", 1),
            Recipe("shellcraft", "Патроны 12 калибра", "shotgunShell", 6, "ammo_bench", "ore", 2, "wood", 1),
            Recipe("rocketammocraft", "Ракета", "rocketAmmo", 2, "ammo_bench", "ore", 5, "wood", 1, "oil", 1, "silver", 4),
            Recipe("pickaxecraft", "Кирка", "pickaxe", 1, "tool_bench", "ore", 2, "wood", 2),
            Recipe("axecraft", "Топор", "axe", 1, "tool_bench", "ore", 1, "wood", 3),
            Recipe("handpumpcraft", "Ручной насос", "handPump", 1, "tool_bench", "ore", 3, "wood", 1, "scrap", 2),
            Recipe("weaponpartscraft", "Оружейные детали", "weaponParts", 2, "weapon_bench", "ore", 6, "scrap", 5),
            Recipe("electronicscraft", "Электроника", "electronics", 2, "energy_bench", "scrap", 3, "chemicals", 1)
        };

        /// <summary>
        /// Ключ модели станка нужного типа: авторские объекты станций
        /// узнаются по полю model (CRAFT_STATION_DEFS, 03:93).
        /// </summary>
        public static string StationModelKey(string station)
        {
            if (station == "ammo_bench") return "craftStationAmmo";
            if (station == "weapon_bench") return "craftStationWeapon";
            if (station == "tool_bench") return "craftStationTools";
            if (station == "repair_bench") return "craftStationRepair";
            if (station == "energy_bench") return "craftStationEnergy";
            if (station == "chem_station") return "craftStationChem";
            return string.Empty;
        }

        public static string StationLabel(string id)
        {
            if (id == "ammo_bench") return "Патронный станок";
            if (id == "weapon_bench") return "Оружейный верстак";
            if (id == "tool_bench") return "Инструментальный верстак";
            if (id == "repair_bench") return "Ремонтный верстак";
            if (id == "energy_bench") return "Энергетический стенд";
            if (id == "chem_station") return "Химический стол";
            return "Станок";
        }

        private static RoaCraftRecipe Recipe(string id, string name, string outputId, int outputQty,
            string station, params object[] cost)
        {
            var rows = new Dictionary<string, int>();
            for (int i = 0; i + 1 < cost.Length; i += 2)
                rows[(string)cost[i]] = (int)cost[i + 1];
            string description;
            Descriptions.TryGetValue(id, out description);

            return new RoaCraftRecipe
            {
                Id = id,
                Name = name,
                Description = description ?? string.Empty,
                OutputId = outputId,
                OutputQty = outputQty,
                Station = station,
                Cost = rows
            };
        }
    }
}
