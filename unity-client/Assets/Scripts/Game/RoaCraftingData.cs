using System.Collections.Generic;
using Newtonsoft.Json.Linq;

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
        public int SilverFee;
        public int WorkSeconds;
        /// <summary>Тир рецепта (0 — без тира), группа его вариантов, профессия и уровень доступа.</summary>
        public int Tier;
        public string RecipeGroup = string.Empty;
        public string Profession = string.Empty;
        public int Level;

        /// <summary>Ключ карточки: все тиры одного изделия — одна карточка.</summary>
        public string GroupKey { get { return string.IsNullOrEmpty(RecipeGroup) ? Id : RecipeGroup; } }

        /// <summary>
        /// Комиссия заказа: на участке столицы её назначает арендатор
        /// (RoaCraftingPlots), иначе — прежняя комиссия рецепта.
        /// </summary>
        public int Fee { get { return RoaCraftingPlots.FeeFor(this); } }

        /// <summary>Комиссия рецепта без участка — нижняя граница платы.</summary>
        public int BaseFee
        {
            get
            {
                if (SilverFee > 0) return SilverFee;
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
            { "energycellcraft", "Боеприпасы для энергетического оружия." },
            { "napalmcraft", "Горючая смесь для огнемёта." },
            { "shellcraft", "Боеприпасы для дробовика." },
            { "rocketammocraft", "Боеприпасы для ракетницы." },
            { "stimcraft", "Быстрое средство первой помощи." },
            { "medkitcraft", "Комплект для восстановления здоровья." },
            { "doctorbagcraft", "Медицинский набор для лечения тяжёлых травм." },
            { "antibioticscraft", "Препарат для лечения инфекции." },
            { "reagentcraft", "Промышленные реагенты из масла, воды и очищенного лома." },
            { "repairkitcraft", "Набор для ремонта оружия и брони." },
            { "knifecraft", "Запасное оружие ближнего боя." },
            { "pistolcraft", "Лёгкий одноручный пистолет." },
            { "revolvercraft", "Надёжный шестизарядный револьвер." },
            { "sawedoffcraft", "Компактное двуствольное оружие ближнего боя." },
            { "smgcraft", "Автоматическое оружие под патрон 9mm." },
            { "riflecraft", "Дальнобойная винтовка с продольно-скользящим затвором." },
            { "assaultcraft", "Автоматическое оружие с одиночным, прицельным и автоматическим режимом." },
            { "machineguncraft", "Тяжёлое автоматическое оружие для навыка Тяжёлое оружие." },
            { "lasercraft", "Энергетическое оружие с риском перегрева/сбоя." },
            { "flamercraft", "Тяжёлое оружие с огненной струёй." },
            { "plasmacraft", "Мощное энергетическое ружьё." },
            { "shotguncraft", "Надёжное оружие ближней и средней дистанции." },
            { "rocketcrafter", "Тяжёлое взрывное оружие с уроном по области." },
            { "leathercraft", "Лёгкая броня из кожи и подручных материалов." },
            { "metalarmorcraft", "Прочная броня из металлических пластин." },
            { "ballisticvestcraft", "Бронежилет с усиленной баллистической защитой." },
            { "combatarmorcraft", "Комплексная защита для тяжёлых боёв." },
            { "hazmatsuitcraft", "Защитный костюм от токсинов и радиации." },
            { "heavyarmorcraft", "Тяжёлый комплект с высокой общей защитой." },
            { "energysuitcraft", "Специализированная защита от энергетического урона." },
            { "prewarhelmetcraft", "Восстановленный армейский шлем старого мира." },
            { "weldedhelmetcraft", "Простой шлем из сваренных листов металла." },
            { "helmetcraft", "Базовая защита головы." },
            { "tacticalhelmetcraft", "Усиленный шлем с закрытым визором." },
            { "assaulthelmetcraft", "Тяжёлый шлем с усиленной лицевой защитой." },
            { "bootscraft", "Надёжные ботинки для пустоши." },
            { "scoutbootscraft", "Лёгкие ботинки для быстрого передвижения." },
            { "assaultbootscraft", "Защитные ботинки с композитными накладками." },
            { "reinforcedbootscraft", "Тяжёлая обувь с защитными накладками." },
            { "backpackcraft", "Рюкзак, увеличивающий переносимый вес." },
            { "pickaxecraft", "Инструмент для добычи руды." },
            { "axecraft", "Инструмент для заготовки древесины." },
            { "handpumpcraft", "Инструмент для откачки воды и нефти." },
            { "weaponpartscraft", "Пружины, штифты и заготовки стволов. Нужны почти для любой модификации оружия." },
            { "electronicscraft", "Платы и датчики. Нужны для прицелов и энергетических модификаций." },
        };

        private static IReadOnlyList<RoaCraftRecipe> _recipes = new[]
        {
            Recipe("ammo9craft", "Патроны 9mm", "ammo9", 8, "ammo_bench", "ore", 1, "wood", 1),
            Recipe("ammo556craft", "Патроны .223", "ammo556", 5, "ammo_bench", "ore", 2, "wood", 1),
            Recipe("energycellcraft", "Энергозаряды", "energyCell", 8, "energy_bench", "ore", 2, "wood", 1),
            Recipe("napalmcraft", "Напалм", "napalm", 12, "chem_station", "oil", 2, "scrap", 1, "wood", 1),
            Recipe("shellcraft", "Патроны 12 калибра", "shotgunShell", 6, "ammo_bench", "ore", 2, "wood", 1),
            Recipe("rocketammocraft", "Ракета", "rocketAmmo", 2, "ammo_bench", "ore", 5, "wood", 1, "oil", 1, "silver", 4),
            Recipe("stimcraft", "Стимулятор", "stim", 3, "chem_station", "medicine", 2, "chemicals", 1),
            Recipe("medkitcraft", "Аптечка", "medkit", 2, "chem_station", "medicine", 4, "chemicals", 1, "scrap", 1),
            Recipe("doctorbagcraft", "Набор доктора", "doctorBag", 1, "chem_station", "medicine", 5, "electronics", 1, "scrap", 2),
            Recipe("antibioticscraft", "Антибиотики", "antibiotics", 2, "chem_station", "medicine", 3, "chemicals", 2),
            Recipe("medicinecraft", "Медикаменты", "medicine", 3, "chem_station", "chemicals", 2, "water", 1),
            Recipe("reagentcraft", "Химикаты", "chemicals", 3, "chem_station", "oil", 2, "water", 1, "scrap", 1),
            Recipe("repairkitcraft", "Ремкомплект", "repairKit", 1, "repair_bench", "ore", 2, "wood", 2),
            Recipe("weaponpartscraft", "Оружейные детали", "weaponParts", 2, "weapon_bench", "ore", 6, "scrap", 5),
            Recipe("electronicscraft", "Электроника", "electronics", 2, "energy_bench", "scrap", 3, "chemicals", 1)
        };

        public static IReadOnlyList<RoaCraftRecipe> Recipes { get { return _recipes; } }

        /// <summary>Уровень профессии из состояния игрока (self.professions); 0, если её нет.</summary>
        public static int ProfessionLevel(JObject self, string professionId)
        {
            if (self?["professions"] is JArray rows)
                foreach (JToken token in rows)
                    if (token is JObject row && row["id"]?.ToString() == professionId)
                        return row["level"]?.ToObject<int?>() ?? 0;
            return 0;
        }

        public static bool ProfessionAllows(JObject self, RoaCraftRecipe recipe)
        {
            return recipe == null || string.IsNullOrEmpty(recipe.Profession)
                || ProfessionLevel(self, recipe.Profession) >= recipe.Level;
        }

        /// <summary>
        /// По рецепту на изделие: старший тир, открытый профессией игрока (или
        /// младший, если закрыты все). Для списков, где пять тиров — лишний шум.
        /// </summary>
        public static List<RoaCraftRecipe> GroupRepresentatives(JObject self)
        {
            var order = new List<string>();
            var best = new Dictionary<string, RoaCraftRecipe>();
            foreach (RoaCraftRecipe recipe in _recipes)
            {
                string key = recipe.GroupKey;
                if (!best.TryGetValue(key, out RoaCraftRecipe current))
                {
                    order.Add(key);
                    best[key] = recipe;
                    continue;
                }
                bool open = ProfessionAllows(self, recipe);
                bool currentOpen = ProfessionAllows(self, current);
                if ((open && (!currentOpen || recipe.Tier > current.Tier)) || (!open && !currentOpen && recipe.Tier < current.Tier))
                    best[key] = recipe;
            }
            var result = new List<RoaCraftRecipe>(order.Count);
            foreach (string key in order) result.Add(best[key]);
            return result;
        }

        /// <summary>Atomically replaces the baked fallback recipes with server-authored rows.</summary>
        public static bool ApplyCatalog(JObject catalog, out string error)
        {
            error = string.Empty;
            JArray rows = catalog?["recipes"] as JArray;
            if (rows == null || rows.Count < 40)
            {
                error = "Каталог полевого крафта пуст или неполон.";
                return false;
            }
            var next = new List<RoaCraftRecipe>();
            var ids = new HashSet<string>();
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString() ?? string.Empty;
                string name = row?["name"]?.ToString() ?? string.Empty;
                string station = row?["station"]?.ToString() ?? string.Empty;
                string outputId = row?["output"]?["id"]?.ToString() ?? string.Empty;
                int outputQty = row?["output"]?["qty"]?.ToObject<int?>() ?? 0;
                JObject inputs = row?["inputs"] as JObject;
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)
                    || string.IsNullOrEmpty(station) || string.IsNullOrEmpty(outputId)
                    || outputQty < 1 || inputs == null || !ids.Add(id))
                {
                    error = "Повреждён рецепт: " + id;
                    return false;
                }
                var cost = new Dictionary<string, int>();
                foreach (JProperty property in inputs.Properties())
                {
                    int qty = property.Value.ToObject<int>();
                    if (string.IsNullOrEmpty(property.Name) || qty < 1)
                    {
                        error = "Повреждены материалы рецепта: " + id;
                        return false;
                    }
                    cost[property.Name] = qty;
                }
                if (cost.Count == 0)
                {
                    error = "Рецепт не содержит материалов: " + id;
                    return false;
                }
                next.Add(new RoaCraftRecipe
                {
                    Id = id,
                    Name = name,
                    Description = row?["description"]?.ToString() ?? string.Empty,
                    OutputId = outputId,
                    OutputQty = outputQty,
                    Station = station,
                    Cost = cost,
                    SilverFee = System.Math.Max(0, row?["silverFee"]?.ToObject<int?>() ?? 0),
                    WorkSeconds = System.Math.Max(1, row?["workSeconds"]?.ToObject<int?>() ?? 1),
                    Tier = System.Math.Max(0, row?["tier"]?.ToObject<int?>() ?? 0),
                    RecipeGroup = row?["recipeGroup"]?.ToString() ?? string.Empty,
                    Profession = row?["profession"]?.ToString() ?? string.Empty,
                    Level = System.Math.Max(0, row?["level"]?.ToObject<int?>() ?? 0)
                });
            }
            _recipes = next;
            return true;
        }

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

        /// <summary>
        /// Канонический id станка по любому его токену. Зеркалит серверную
        /// таблицу SERVER_CRAFT_STATION_TOKENS: сервер принимает синонимы
        /// («electronics», «relay», «armory», «lab», «medicine»…), и авторские
        /// локации ими пользуются (oldDepot помечает энергостанок только как
        /// «electronics»). Без зеркала Unity не узнавал такие станки вовсе.
        /// Пустая строка — токен не станок.
        /// </summary>
        public static string CanonicalStation(string token)
        {
            string id = (token ?? string.Empty).Trim().ToLowerInvariant();
            switch (id)
            {
                case "ammo_bench": case "ammo": case "munition":
                    return "ammo_bench";
                case "weapon_bench": case "weapon": case "armory":
                    return "weapon_bench";
                case "tool_bench": case "tool":
                    return "tool_bench";
                case "repair_bench": case "repair":
                    return "repair_bench";
                case "energy_bench": case "energy": case "relay": case "electronics":
                    return "energy_bench";
                case "chem_station": case "chem": case "lab": case "medicine":
                    return "chem_station";
                default:
                    return string.Empty;
            }
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
