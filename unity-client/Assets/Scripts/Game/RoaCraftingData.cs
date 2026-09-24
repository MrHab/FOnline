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
            Recipe("knifecraft", "Нож 01", "knife", 1, "weapon_bench", "ore", 2, "wood", 1),
            Recipe("pistolcraft", "Пистолет 01", "pistol", 1, "weapon_bench", "weaponParts", 1, "scrap", 4, "ammoParts", 2),
            Recipe("revolvercraft", "Револьвер 01", "revolver", 1, "weapon_bench", "ore", 4, "scrap", 4, "wood", 2),
            Recipe("sawedoffcraft", "Дробовик (обрез) 01", "sawedOffShotgun", 1, "weapon_bench", "scrap", 5, "wood", 3),
            Recipe("smgcraft", "Пистолет-пулемёт 01", "smg", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("riflecraft", "Охотничья винтовка 01", "rifle", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("assaultcraft", "Штурмовая винтовка 01", "assaultRifle", 1, "weapon_bench", "ore", 6, "wood", 3),
            Recipe("machineguncraft", "Пулемёт 01", "machineGun", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("lasercraft", "Гибридное оружие 01", "laserPistol", 1, "energy_bench", "ore", 5, "wood", 2),
            Recipe("flamercraft", "Огнемёт 01", "flamethrower", 1, "weapon_bench", "ore", 9, "wood", 3, "oil", 2),
            Recipe("plasmacraft", "Гибридное оружие 02", "plasmaRifle", 1, "energy_bench", "ore", 10, "wood", 2, "silver", 10),
            Recipe("shotguncraft", "Дробовик 01", "shotgun", 1, "weapon_bench", "ore", 7, "wood", 4),
            Recipe("rocketcrafter", "Ракетная установка 01", "rocketLauncher", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("leathercraft", "Кожаная куртка", "leather", 1, "repair_bench", "scrap", 5, "chemicals", 1),
            Recipe("metalarmorcraft", "Металлическая броня", "metalArmor", 1, "repair_bench", "scrap", 12, "ore", 4),
            Recipe("ballisticvestcraft", "Бронежилет", "ballisticVest", 1, "repair_bench", "scrap", 10, "ammoParts", 5, "chemicals", 2),
            Recipe("combatarmorcraft", "Боевая броня", "combatArmor", 1, "repair_bench", "scrap", 18, "electronics", 6, "chemicals", 4),
            Recipe("hazmatsuitcraft", "Костюм химзащиты", "hazmatSuit", 1, "chem_station", "chemicals", 10, "scrap", 6),
            Recipe("heavyarmorcraft", "Тяжёлая броня", "heavyArmor", 1, "repair_bench", "scrap", 26, "ore", 10, "electronics", 6),
            Recipe("energysuitcraft", "Энергозащитный костюм", "energySuit", 1, "energy_bench", "electronics", 16, "chemicals", 8, "scrap", 10),
            Recipe("prewarhelmetcraft", "Довоенный боевой шлем", "preWarHelmet", 1, "energy_bench", "scrap", 6, "electronics", 3),
            Recipe("weldedhelmetcraft", "Сварной шлем", "weldedHelmet", 1, "tool_bench", "scrap", 4),
            Recipe("helmetcraft", "Стальной шлем", "helmet", 1, "repair_bench", "scrap", 4),
            Recipe("tacticalhelmetcraft", "Тактический шлем", "tacticalHelmet", 1, "repair_bench", "scrap", 6, "electronics", 2),
            Recipe("assaulthelmetcraft", "Штурмовой шлем", "assaultHelmet", 1, "repair_bench", "scrap", 8, "electronics", 3),
            Recipe("bootscraft", "Армейские ботинки", "boots", 1, "tool_bench", "scrap", 3, "chemicals", 1),
            Recipe("scoutbootscraft", "Разведботинки", "scoutBoots", 1, "tool_bench", "scrap", 4, "chemicals", 2),
            Recipe("assaultbootscraft", "Штурмовые ботинки", "assaultBoots", 1, "tool_bench", "scrap", 5, "wood", 1),
            Recipe("reinforcedbootscraft", "Усиленные ботинки", "reinforcedBoots", 1, "repair_bench", "scrap", 6, "ore", 2),
            Recipe("backpackcraft", "Рюкзак", "backpack", 1, "tool_bench", "scrap", 5, "chemicals", 1),
            Recipe("pickaxecraft", "Кирка", "pickaxe", 1, "tool_bench", "ore", 2, "wood", 2),
            Recipe("axecraft", "Топор", "axe", 1, "tool_bench", "ore", 1, "wood", 3),
            Recipe("handpumpcraft", "Ручной насос", "handPump", 1, "tool_bench", "ore", 3, "wood", 1, "scrap", 2),
            Recipe("weaponpartscraft", "Оружейные детали", "weaponParts", 2, "weapon_bench", "ore", 6, "scrap", 5),
            Recipe("electronicscraft", "Электроника", "electronics", 2, "energy_bench", "scrap", 3, "chemicals", 1),
            Recipe("polygonAssaultRifle02craft", "Штурмовая винтовка 02", "polygonAssaultRifle02", 1, "weapon_bench", "ore", 6, "wood", 3),
            Recipe("polygonAssaultRifle03craft", "Штурмовая винтовка 03", "polygonAssaultRifle03", 1, "weapon_bench", "ore", 6, "wood", 3),
            Recipe("polygonHuntingRifleClean01craft", "Охотничья винтовка (чистое) 01", "polygonHuntingRifleClean01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonHybrid03craft", "Гибридное оружие 03", "polygonHybrid03", 1, "weapon_bench", "ore", 10, "wood", 2, "silver", 10),
            Recipe("polygonMachineGun02craft", "Пулемёт 02", "polygonMachineGun02", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonMinigun01craft", "Миниган 01", "polygonMinigun01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonMinigunClean01craft", "Миниган (чистое) 01", "polygonMinigunClean01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonNailgun01craft", "Гвоздомёт 01", "polygonNailgun01", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("polygonNailgunClean01craft", "Гвоздомёт (чистое) 01", "polygonNailgunClean01", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("polygonRevolver02craft", "Револьвер 02", "polygonRevolver02", 1, "weapon_bench", "ore", 4, "scrap", 4, "wood", 2),
            Recipe("polygonRifle01craft", "Винтовка 01", "polygonRifle01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonRifle02craft", "Винтовка 02", "polygonRifle02", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonRifle03craft", "Винтовка 03", "polygonRifle03", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonSniperRifle01craft", "Снайперская винтовка 01", "polygonSniperRifle01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonSniperRifle02craft", "Снайперская винтовка 02", "polygonSniperRifle02", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonSniperRiflePneumatic01craft", "Пневматическая снайперская винтовка 01", "polygonSniperRiflePneumatic01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonSpearGun01craft", "Гарпунное ружьё 01", "polygonSpearGun01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonSubMGun02craft", "Пистолет-пулемёт 02", "polygonSubMGun02", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("polygonSubMGun03craft", "Пистолет-пулемёт 03", "polygonSubMGun03", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("polygonSubMGunClean03craft", "Пистолет-пулемёт (чистое) 03", "polygonSubMGunClean03", 1, "weapon_bench", "scrap", 8, "weaponParts", 3, "wood", 2),
            Recipe("polygonBatMetal01craft", "Металлическая бита 01", "polygonBatMetal01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonBatWood01craft", "Деревянная бита 01", "polygonBatWood01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonBatWood02craft", "Деревянная бита 02", "polygonBatWood02", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonBaton01craft", "Дубинка 01", "polygonBaton01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonBaton02craft", "Дубинка 02", "polygonBaton02", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonButcher01craft", "Мясницкий тесак 01", "polygonButcher01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonCross01craft", "Боевой крест 01", "polygonCross01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonCrowbar01craft", "Лом 01", "polygonCrowbar01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonCrutch01craft", "Костыль 01", "polygonCrutch01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonHammer01craft", "Молот 01", "polygonHammer01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonKatana01craft", "Катана 01", "polygonKatana01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonMeleeGolfClub01craft", "Клюшка 01", "polygonMeleeGolfClub01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonMeleeMachete01craft", "Мачете 01", "polygonMeleeMachete01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonMeleeSpearWood01craft", "Копьё 01", "polygonMeleeSpearWood01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonPipe01craft", "Труба 01", "polygonPipe01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonPlank01craft", "Доска 01", "polygonPlank01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonRebarClub01craft", "Арматурная дубина 01", "polygonRebarClub01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonWoodAxe01craft", "Дровяной топор 01", "polygonWoodAxe01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonWrench01craft", "Ключ 01", "polygonWrench01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonBombGasCan01craft", "Бомба из канистры 01", "polygonBombGasCan01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonBombPropane01craft", "Пропановая бомба 01", "polygonBombPropane01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonChainSaw01craft", "Бензопила 01", "polygonChainSaw01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonCrossBow01craft", "Арбалет 01", "polygonCrossBow01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonCrossBowClean01craft", "Арбалет (чистое) 01", "polygonCrossBowClean01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonFlareGun01craft", "Сигнальный пистолет 01", "polygonFlareGun01", 1, "weapon_bench", "weaponParts", 1, "scrap", 4, "ammoParts", 2),
            Recipe("polygonFlashbang01craft", "Светошумовая граната 01", "polygonFlashbang01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonGrenade01craft", "Граната 01", "polygonGrenade01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonMolotov01craft", "Коктейль Молотова 01", "polygonMolotov01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonNailBomb01craft", "Бомба с гвоздями 01", "polygonNailBomb01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonPipeBomb01craft", "Трубная бомба 01", "polygonPipeBomb01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonSignShield01craft", "Щит 01", "polygonSignShield01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonTrimmer01craft", "Триммер 01", "polygonTrimmer01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonTrimmerClean01craft", "Триммер (чистое) 01", "polygonTrimmerClean01", 1, "weapon_bench", "ore", 1, "wood", 3),
            Recipe("polygonAAGun01craft", "Зенитная установка 01", "polygonAAGun01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonVehAA01craft", "Транспортная зенитная установка 01", "polygonVehAA01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonVehHarpoon01craft", "Транспортный гарпун 01", "polygonVehHarpoon01", 1, "weapon_bench", "weaponParts", 2, "scrap", 5, "wood", 2),
            Recipe("polygonVehMachineGun01craft", "Транспортный пулемёт 01", "polygonVehMachineGun01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonVehMiniGun01craft", "Транспортный миниган 01", "polygonVehMiniGun01", 1, "weapon_bench", "ore", 10, "wood", 4),
            Recipe("polygonVehRocketLauncher01craft", "Транспортная ракетная установка 01", "polygonVehRocketLauncher01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14),
            Recipe("polygonVehSawLauncher01craft", "Транспортная пильная установка 01", "polygonVehSawLauncher01", 1, "weapon_bench", "ore", 14, "wood", 4, "silver", 14)
        };

        public static IReadOnlyList<RoaCraftRecipe> Recipes { get { return _recipes; } }

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
                    WorkSeconds = System.Math.Max(1, row?["workSeconds"]?.ToObject<int?>() ?? 1)
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
