using System;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Подписи и требования канонических 16 навыков и 41 таланта.
    /// Боевые эффекты здесь не рассчитываются: server.js остаётся authority.
    /// Массивы повторяют public/js/game/04_player_model_visuals.js.
    /// </summary>
    public static class RoaProgressionData
    {
        public sealed class SkillDef
        {
            public readonly string Id;
            public readonly string Name;
            public readonly string Group;
            public readonly string Description;

            public SkillDef(string id, string name, string group, string description = "")
            {
                Id = id;
                Name = name;
                Group = group;
                Description = string.IsNullOrEmpty(description) ? SkillDescription(id) : description;
            }
        }

        public sealed class TalentDef
        {
            public readonly string Id;
            public readonly string Name;
            public readonly string Group;
            public readonly int MaxRank;
            public readonly int Level;
            public readonly string Stat;
            public readonly int StatValue;
            public readonly string Skill;
            public readonly int SkillValue;
            public readonly string Stat2;
            public readonly int StatValue2;
            public readonly string Description;

            public TalentDef(string id, string name, string group, int maxRank, int level,
                             string stat = "", int statValue = 0,
                             string skill = "", int skillValue = 0,
                             string stat2 = "", int statValue2 = 0,
                             string description = "")
            {
                Id = id;
                Name = name;
                Group = group;
                MaxRank = maxRank;
                Level = level;
                Stat = stat;
                StatValue = statValue;
                Skill = skill;
                SkillValue = skillValue;
                Stat2 = stat2;
                StatValue2 = statValue2;
                Description = string.IsNullOrEmpty(description) ? TalentDescription(id) : description;
            }
        }

        public static readonly SkillDef[] Skills =
        {
            new SkillDef("lightWeapons", "Лёгкое оружие", "Боевые"),
            new SkillDef("heavyWeapons", "Тяжёлое оружие", "Боевые"),
            new SkillDef("energyWeapons", "Энергетическое", "Боевые"),
            new SkillDef("throwing", "Метательное", "Боевые"),
            new SkillDef("melee", "Ближний бой", "Боевые"),
            new SkillDef("unarmed", "Без оружия", "Боевые"),
            new SkillDef("doctor", "Доктор", "Мирные"),
            new SkillDef("firstAid", "Первая помощь", "Мирные"),
            new SkillDef("stealth", "Скрытность", "Мирные"),
            new SkillDef("lockpick", "Взлом", "Мирные"),
            new SkillDef("traps", "Ловушки", "Мирные"),
            new SkillDef("science", "Наука", "Мирные"),
            new SkillDef("repair", "Ремонт", "Мирные"),
            new SkillDef("speech", "Красноречие", "Мирные"),
            new SkillDef("barter", "Бартер", "Мирные"),
            new SkillDef("wanderer", "Странник", "Мирные")
        };

        public static readonly TalentDef[] Talents =
        {
            new TalentDef("gunslinger", "Меткий стрелок", "Боевые", 3, 3, "per", 6, "lightWeapons", 40),
            new TalentDef("automaticMan", "Автоматчик", "Боевые", 3, 6, skill: "lightWeapons", skillValue: 50),
            new TalentDef("heavyShooter", "Тяжёлый стрелок", "Боевые", 3, 6, "str", 6, "heavyWeapons", 50),
            new TalentDef("machineGunner", "Пулемётчик", "Боевые", 3, 9, "str", 7, "heavyWeapons", 65),
            new TalentDef("pyromaniac", "Поджигатель", "Боевые", 3, 6, "str", 6, "heavyWeapons", 50),
            new TalentDef("energyTech", "Энергетик", "Боевые", 3, 6, "int", 6, "energyWeapons", 50),
            new TalentDef("grenadier", "Гренадёр", "Боевые", 2, 6, skill: "throwing", skillValue: 50),
            new TalentDef("meleeBreaker", "Костолом", "Боевые", 2, 6, "str", 6, "melee", 50),
            new TalentDef("unarmedFighter", "Кулачный боец", "Боевые", 2, 6, skill: "unarmed", skillValue: 50),
            new TalentDef("sharpshooter", "Прицельная концентрация", "Боевые", 2, 12, "per", 7, stat2: "luck", statValue2: 5),
            new TalentDef("ambush", "Засада", "Боевые", 2, 9, "agi", 6, "stealth", 60),

            new TalentDef("vigilance", "Бдительность", "Обзор и выживание", 2, 3, "per", 6),
            new TalentDef("awareness", "Осведомлённость", "Обзор и выживание", 1, 3, "per", 5),
            new TalentDef("ghost", "Привидение", "Обзор и выживание", 2, 6, "agi", 6, "stealth", 60),

            new TalentDef("fieldMedic", "Полевой санитар", "Медицина", 2, 3, skill: "firstAid", skillValue: 50),
            new TalentDef("quickTreatment", "Быстрое лечение", "Медицина", 2, 6, "agi", 5, "firstAid", 60),
            new TalentDef("surgeon", "Хирург", "Медицина", 2, 9, "int", 6, "doctor", 60),
            new TalentDef("immunologist", "Иммунолог", "Медицина", 2, 9, "end", 6, "doctor", 50),
            new TalentDef("fieldSurgeon", "Полевой хирург", "Медицина", 2, 12, "int", 7, "doctor", 70),

            new TalentDef("quickHands", "Быстрые руки", "Техника и торговля", 3, 3, "agi", 5),
            new TalentDef("engineer", "Инженер", "Техника и торговля", 2, 6, "int", 6, "repair", 50),
            new TalentDef("merchant", "Торговец", "Техника и торговля", 3, 3, "cha", 5, "barter", 50),
            new TalentDef("diplomat", "Дипломат", "Техника и торговля", 2, 6, "cha", 6, "speech", 50),
            new TalentDef("scrounger", "Редкая находка", "Техника и торговля", 3, 6, "luck", 6),
            new TalentDef("cacheSense", "Нюх на тайники", "Техника и торговля", 2, 9, "luck", 6, "wanderer", 50),
            new TalentDef("weaponSmith", "Оружейник", "Техника и торговля", 2, 6, "int", 6, "repair", 55),
            new TalentDef("recycler", "Утилизация", "Техника и торговля", 2, 6, "int", 5, "repair", 45),

            new TalentDef("actionBoy", "Живчик", "Защита и удача", 3, 6, "agi", 6),
            new TalentDef("toughness", "Крепкий организм", "Защита и удача", 3, 3, "end", 6),
            new TalentDef("armorTraining", "Бронник", "Защита и удача", 3, 9, skill: "repair", skillValue: 60),
            new TalentDef("steadfastness", "Стойкость", "Защита и удача", 2, 6, "end", 7),
            new TalentDef("lucky", "Счастливчик", "Защита и удача", 2, 3, "luck", 6),
            new TalentDef("secondChance", "Второй шанс", "Защита и удача", 2, 12, "luck", 7),
            new TalentDef("ironBones", "Железные кости", "Защита и удача", 2, 12, "end", 8),

            // Сервер обходит SPECIAL-таланты перед остальными: это позволяет
            // в одном пакете поднять SPECIAL и открыть зависящий от него перк.
            new TalentDef("specialStr", "Сила +1", "SPECIAL", 3, 3),
            new TalentDef("specialPer", "Восприятие +1", "SPECIAL", 3, 3),
            new TalentDef("specialEnd", "Выносливость +1", "SPECIAL", 3, 3),
            new TalentDef("specialCha", "Харизма +1", "SPECIAL", 3, 3),
            new TalentDef("specialInt", "Интеллект +1", "SPECIAL", 3, 3),
            new TalentDef("specialAgi", "Ловкость +1", "SPECIAL", 3, 3),
            new TalentDef("specialLuck", "Удача +1", "SPECIAL", 3, 3)
        };

        public static SkillDef FindSkill(string id)
        {
            return Array.Find(Skills, row => row.Id == id);
        }

        private static string SkillDescription(string id)
        {
            switch (id)
            {
                case "lightWeapons": return "Шанс попадания и снижение штрафа точности автоматической стрельбы из лёгкого оружия.";
                case "heavyWeapons": return "Шанс попадания и снижение штрафа точности автоматической стрельбы из тяжёлого оружия.";
                case "energyWeapons": return "Шанс попадания, снижение штрафа точности авто-режима и ниже шанс перегрева или сбоя.";
                case "throwing": return "Точность и радиус поражения взрывного оружия.";
                case "melee": return "Шанс попадания и урон оружием ближнего боя.";
                case "unarmed": return "Шанс попадания и урон без оружия.";
                case "doctor": return "Лечение перелома руки, перелома ноги, контузии и инфекции.";
                case "firstAid": return "Быстрое восстановление ОЗ.";
                case "stealth": return "Шанс остаться незамеченным мобами и игроками.";
                case "lockpick": return "Открытие запертых ящиков, дверей и контейнеров.";
                case "traps": return "Работа с защитными системами: меньше задержка после провала взлома.";
                case "science": return "Технологический крафт, терминалы, техпроверки и энергооружие.";
                case "repair": return "Починка оружия и брони.";
                case "speech": return "Повышает шанс проверок диалога, опыт и награды за квесты.";
                case "barter": return "Более выгодные цены у торговцев.";
                case "wanderer": return "Находки, добыча ресурсов, встречи и скорость движения по глобальной карте.";
                default: return string.Empty;
            }
        }

        private static string TalentDescription(string id)
        {
            switch (id)
            {
                case "gunslinger": return "+7 п.п. к шансу попадания одиночным и прицельным выстрелом за каждый ранг.";
                case "automaticMan": return "Снижает штраф точности автоматической стрельбы из лёгкого оружия на 3 п.п. за каждый ранг.";
                case "heavyShooter": return "+6 п.п. к шансу попадания из тяжёлого оружия за каждый ранг.";
                case "machineGunner": return "Снижает штраф точности автоматической стрельбы из тяжёлого оружия на 4 п.п. за каждый ранг.";
                case "pyromaniac": return "Огненное оружие получает +4 п.п. к попаданию и +12% сырого урона до брони за каждый ранг.";
                case "energyTech": return "+5 п.п. к попаданию энергооружием, −3 п.п. к штрафу авто-режима и −3.5 п.п. к риску сбоя за ранг.";
                case "grenadier": return "+6 п.п. к шансу попадания взрывным оружием и +0.2 м к радиусу взрыва за каждый ранг.";
                case "meleeBreaker": return "+2 к урону оружием ближнего боя за каждый ранг.";
                case "unarmedFighter": return "+4 п.п. к шансу попадания и +2 к урону без оружия за каждый ранг.";
                case "sharpshooter": return "+2 к сырому урону оружия с патронами за каждый ранг до расчёта брони цели.";
                case "ambush": return "Атака из приседа по врагу вне погони получает +8 п.п. к попаданию и множитель урона ×(1+14%×ранг).";
                case "vigilance": return "+1 клетка обзора за каждый ранг.";
                case "awareness": return "Интерфейсный перк: +0 к шансу и урону, но показывает точное ОЗ цели и прогноз урона с учётом навыков, перков, режима и защиты.";
                case "ghost": return "В приседе: обнаружение −11 п.п. и шум −17 п.п. в формуле скрытности за ранг.";
                case "fieldMedic": return "Первая помощь восстанавливает на 8 ОЗ больше за каждый ранг.";
                case "quickTreatment": return "Медицинские действия −0.12 сек. за ранг; штраф контузии к лечению становится max(0, 25%−12%×ранг).";
                case "surgeon": return "+8 п.п. к шансу вылечить перелом руки, перелом ноги и контузию за каждый ранг.";
                case "immunologist": return "Шанс инфекции и токсичных осложнений ×max(45%, 1−25%×ранг).";
                case "fieldSurgeon": return "Успешное лечение набором доктора может не израсходовать набор: 25% за ранг + 8%×норма Доктора, максимум 70%.";
                case "quickHands": return "Перезарядка стоит −1 ОД за ранг, минимум 1 ОД. Замки получают −1 ОД за каждые 2 суммарных ранга с «Живчиком».";
                case "engineer": return "+1 результат техкрафта, +3.5 п.п. к терминалам, +7 п.п. к техпроверке; скидка ОД сочетается с «Живчиком».";
                case "merchant": return "+8% к цене продажи и +5 п.п. к скидке покупки за каждый ранг.";
                case "diplomat": return "+8 п.п. к проверкам диалога и +8% к наградам квестов за каждый ранг.";
                case "scrounger": return "+1 очко поиска лута за ранг; повышает крышки, патроны, медикаменты и редкие броски добычи.";
                case "cacheSense": return "+1 очко поиска за ранг; в контейнерах: ремкомплект или антибиотики 18%×ранг, трофей 8%×ранг.";
                case "weaponSmith": return "Ремонт оружия и инструментов +8/+4, крафт +7 состояния, износ выстрела max(0.25, 0.55−0.12×ранг).";
                case "recycler": return "Открывает разбор оружия, брони и инструментов; +12 п.п. к успеху и +2 п.п. к доп. ресурсу за ранг.";
                case "actionBoy": return "+1 максимальное ОД и быстрее восстановление ОД за ранг; помогает получить скидку ОД на действия безопасности.";
                case "toughness": return "+12 к максимальному ОЗ за каждый ранг.";
                case "armorTraining": return "С бронёй или шлемом: защита +1.2 п.п., порог +1, класс брони +2, ремонт +8/+4 и крафт +5 за ранг.";
                case "steadfastness": return "Шанс тяжёлых травм −2.5 п.п. от входящего урона и −2.8 п.п. от самоповреждения за ранг.";
                case "lucky": return "Шанс перелома или контузии −3.5 п.п. от входящего урона и −4 п.п. от самоповреждения за ранг.";
                case "secondChance": return "Раз в 90 секунд смертельный удар может оставить 1 ОЗ: 22% шанса за ранг плюс бонус Удачи.";
                case "ironBones": return "Снижает шанс перелома руки или ноги на 28% за каждый ранг.";
                case "specialStr": return "+1 к Силе за ранг: выше переносимый вес, ближний урон и ниже штраф оружия с требованием Силы.";
                case "specialPer": return "+1 к Восприятию за ранг: больше обзор и +2.5 п.п. к шансу попадания оружием.";
                case "specialEnd": return "+1 к Выносливости за ранг: больше ОЗ, +0.35 п.п. к защите брони и ниже риск травм.";
                case "specialCha": return "+1 к Харизме за ранг: +4% к продаже, +3.5 п.п. к речи и +2% к наградам квестов.";
                case "specialInt": return "+1 к Интеллекту за ранг: терминалы, лечение Доктором, добыча и энергетический урон.";
                case "specialAgi": return "+1 к Ловкости за ранг: выше скорость, больше ОД и +2.5 п.п. к взлому замков.";
                case "specialLuck": return "+1 к Удаче за ранг: критический шанс, точность, взлом, добыча и ниже риск травм.";
                default: return string.Empty;
            }
        }
    }
}
