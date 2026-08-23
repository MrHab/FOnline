using System;
using System.Collections.Generic;
using RealmOfAshes.Net;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Functional IMGUI port of 08_character_creation_save.js. It owns only the
    /// draft selection; the Node server still creates and validates the character.
    /// </summary>
    public sealed class RoaCharacterCreator
    {
        public enum DrawResult
        {
            None,
            Cancel,
            Create
        }

        public sealed class StatDef
        {
            public readonly string Id;
            public readonly string Code;
            public readonly string Name;
            public readonly string Description;

            public StatDef(string id, string code, string name, string description)
            {
                Id = id;
                Code = code;
                Name = name;
                Description = description;
            }
        }

        public sealed class TraitDef
        {
            public readonly string Id;
            public readonly string Name;
            public readonly string Description;

            public TraitDef(string id, string name, string description)
            {
                Id = id;
                Name = name;
                Description = description;
            }
        }

        public struct DerivedStats
        {
            public int MaxHp;
            public int MaxAp;
            public float Speed;
            public int Carry;
            public int Hit;
            public int CriticalChance;
            public int VisionRadius;
            public int ResistAll;
            public int Sell;
            public int Craft;
            public int LuckChecks;
        }

        public const int SpecialTotal = 40;
        public const int SpecialMin = 1;
        public const int SpecialMax = 10;
        public const int MaxTaggedSkills = 2;
        public const int MaxTraits = 2;

        public static readonly StatDef[] Stats =
        {
            new StatDef("str", "ST", "Сила", "Формулы: переносимый вес = 30 + Сила×8; штраф оружия −5.5 п.п. за каждую недостающую Силу; ближний урон +floor((Сила−5)/2)."),
            new StatDef("per", "PE", "Восприятие", "Формулы: меткость оружием +(Восприятие−5)×2.5 п.п.; обзор = clamp 6–16 клеток: round(5.5 + Восприятие×0.7). Влияет на боевые и технические базовые навыки."),
            new StatDef("end", "EN", "Выносливость", "Формулы: HP = 55 + Выносливость×9 + уровни×12 + перки; сопротивление = round(Выносливость×0.7)%. Влияет на выживание и базовые навыки."),
            new StatDef("cha", "CH", "Харизма", "Формулы: продажа +(Харизма−5)×4%; речь +(Харизма−5)×3.5 п.п.; награды квестов +(Харизма−5)×2%. Даёт базу речи и бартера."),
            new StatDef("int", "IN", "Интеллект", "Формулы: терминалы +(Интеллект−5)×3 п.п.; лечение Доктором +(Интеллект−5)×2.5 п.п.; энергоурон +floor((Интеллект−5)/2). Даёт базу науки, ремонта и медицины."),
            new StatDef("agi", "AG", "Ловкость", "Формулы: ОД = 5 + floor(Ловкость/2) + Живчик; скорость = 4.35 + Ловкость×0.13; взлом замков получает бонус от Ловкости. Даёт базу оружейных и скрытных навыков."),
            new StatDef("luck", "LK", "Удача", "Формулы: шанс критического выстрела = Удача%; крит удваивает сырой урон до брони; меткость +max(0, Удача−5)×0.6 п.п.; проверки удачи +max(0, Удача−5)×2.5 п.п.")
        };

        public static readonly TraitDef[] Traits =
        {
            new TraitDef("trainedEye", "Меткий глаз", "+6% к шансу попадания из огнестрельного оружия."),
            new TraitDef("bruiser", "Тяжёлый удар", "+18 HP и +2 урона в ближнем бою, но немного ниже скорость."),
            new TraitDef("scavengerStart", "Падальщик", "Больше полезных находок в трофеях и стартовый запас патронов."),
            new TraitDef("traderStart", "Барыга", "Лучшие цены продажи и +15 крышек на старте."),
            new TraitDef("craftsmanStart", "Ремесленник", "Стартовый ремкомплект и бонус к сбору ресурсов."),
            new TraitDef("educatedStart", "Образованный", "+5 свободных очков навыков после создания персонажа.")
        };

        private static readonly string[] SexIds = { "male", "female" };
        private static readonly string[] SexLabels = { "Мужской", "Женский" };
        private static readonly string[] BodyIds = { "slim", "medium", "large" };
        private static readonly string[] BodyLabels = { "Стройное", "Среднее", "Крепкое" };
        private static readonly string[] FaceSuffixes = { "01", "02", "03", "04" };
        private static readonly string[] FaceLabels = { "Угловатое", "Узкое", "Широкое", "Округлое" };
        private static readonly string[] HairColorIds =
        {
            "hair_01", "hair_02", "hair_03", "hair_04",
            "hair_05", "hair_06", "hair_07", "hair_08"
        };
        private static readonly string[] HairColorLabels =
        {
            "Чёрный", "Тёмно-коричневый", "Каштановый", "Коричневый",
            "Светло-коричневый", "Русый", "Седой", "Рыжий"
        };

        private readonly Dictionary<string, int> _stats = new Dictionary<string, int>();
        private readonly List<string> _taggedSkills = new List<string>();
        private readonly List<string> _traits = new List<string>();
        private string _notice = string.Empty;

        public CharacterAppearance Appearance { get; private set; }

        // --- Фасад для канва-экрана создания (RoaAuthCanvas, шаг creator). ---
        public string Notice { get { return _notice; } }
        public string SexLabelText { get { return SexLabel(Appearance.Sex); } }
        public string BodyLabelText { get { return LabelFor(BodyIds, BodyLabels, Appearance.BodyType); } }
        public string FaceLabelText { get { return LabelFor(FaceIds(), FaceLabels, Appearance.FaceId); } }
        public string HairLabelText { get { return HairLabel(Appearance.HairId); } }
        public string HairColorLabelText { get { return LabelFor(HairColorIds, HairColorLabels, Appearance.HairColorId); } }
        public bool HasSkill(string id) { return _taggedSkills.Contains(id); }
        public bool HasTrait(string id) { return _traits.Contains(id); }

        /// <summary>Цвет образца причёски — hex из CHARACTER_HAIR_COLOR_OPTIONS web.</summary>
        public static Color HairColorSwatch(string id)
        {
            string hex = id == "hair_01" ? "#1A1512" : id == "hair_02" ? "#2A1B16" : id == "hair_04" ? "#6B452A"
                : id == "hair_05" ? "#8A6040" : id == "hair_06" ? "#A27A4B" : id == "hair_07" ? "#7B7D76"
                : id == "hair_08" ? "#5B2922" : "#4B3023";
            return ColorUtility.TryParseHtmlString(hex, out Color parsed) ? parsed : new Color(0.294f, 0.188f, 0.137f);
        }
        public int PointsLeft { get { return SpecialTotal - SpecialSum; } }
        public int SpecialSum
        {
            get
            {
                int total = 0;
                foreach (StatDef stat in Stats) total += _stats[stat.Id];
                return total;
            }
        }
        public int SelectedSkillCount { get { return _taggedSkills.Count; } }
        public int SelectedTraitCount { get { return _traits.Count; } }
        public string[] TaggedSkills { get { return _taggedSkills.ToArray(); } }
        public string[] SelectedTraits { get { return _traits.ToArray(); } }

        public RoaCharacterCreator()
        {
            Reset();
        }

        public void Reset()
        {
            _stats.Clear();
            foreach (StatDef stat in Stats) _stats[stat.Id] = 5;
            _taggedSkills.Clear();
            _traits.Clear();
            Appearance = DefaultAppearance("male");
            _notice = string.Empty;
        }

        /// <summary>
        /// Шаблон быстрого старта — prepareQuickStartCharacter web (08:585):
        /// SPECIAL 5/7/6/5/5/7/5, навыки lightWeapons + wanderer, черты
        /// trainedEye + scavengerStart, внешность по умолчанию (male).
        /// </summary>
        public void PrepareQuickStart()
        {
            Reset();
            // AdjustStat шагает по одному очку.
            AdjustStat("per", 1); AdjustStat("per", 1);
            AdjustStat("end", 1);
            AdjustStat("agi", 1); AdjustStat("agi", 1);
            ToggleSkill("lightWeapons");
            ToggleSkill("wanderer");
            ToggleTrait("trainedEye");
            ToggleTrait("scavengerStart");
        }

        /// <summary>Deterministic valid draft used only by the opt-in debug auto-login flow.</summary>
        public void PrepareAutomaticDefault()
        {
            Reset();
            foreach (string id in new[] { "per", "end", "int", "agi", "luck" }) AdjustStat(id, 1);
            ToggleSkill("lightWeapons");
            ToggleTrait("trainedEye");
        }

        public int Stat(string id)
        {
            int value;
            return id != null && _stats.TryGetValue(id, out value) ? value : 5;
        }

        public bool AdjustStat(string id, int delta)
        {
            int value;
            if (!_stats.TryGetValue(id ?? string.Empty, out value) || delta == 0) return false;
            int step = delta > 0 ? 1 : -1;
            if (step > 0 && (PointsLeft <= 0 || value >= SpecialMax)) return false;
            if (step < 0 && value <= SpecialMin) return false;
            _stats[id] = value + step;
            _notice = string.Empty;
            return true;
        }

        public bool ToggleSkill(string id)
        {
            if (RoaProgressionData.FindSkill(id) == null) return false;
            if (_taggedSkills.Remove(id)) return true;
            if (_taggedSkills.Count >= MaxTaggedSkills)
            {
                _notice = "Можно выбрать не больше двух профильных навыков.";
                return false;
            }
            _taggedSkills.Add(id);
            _notice = string.Empty;
            return true;
        }

        public bool ToggleTrait(string id)
        {
            if (Array.Find(Traits, row => row.Id == id) == null) return false;
            if (_traits.Remove(id)) return true;
            if (_traits.Count >= MaxTraits)
            {
                _notice = "Можно выбрать не больше двух стартовых перков.";
                return false;
            }
            _traits.Add(id);
            _notice = string.Empty;
            return true;
        }

        public void SetSex(string sex)
        {
            string normalized = sex == "female" ? "female" : "male";
            if (Appearance != null && Appearance.Sex == normalized) return;
            string body = Appearance != null ? Appearance.BodyType : "medium";
            string color = Appearance != null ? Appearance.HairColorId : "hair_03";
            Appearance = DefaultAppearance(normalized);
            Appearance.BodyType = body;
            Appearance.HairColorId = color;
        }

        public CharacterSpecial BuildSpecial()
        {
            return new CharacterSpecial
            {
                Strength = Stat("str"),
                Perception = Stat("per"),
                Endurance = Stat("end"),
                Charisma = Stat("cha"),
                Intelligence = Stat("int"),
                Agility = Stat("agi"),
                Luck = Stat("luck")
            };
        }

        public bool Ready(string name)
        {
            return SpecialSum == SpecialTotal
                && !string.IsNullOrWhiteSpace(name)
                && name.Trim().Length >= 2
                && _taggedSkills.Count >= 1 && _taggedSkills.Count <= MaxTaggedSkills
                && _traits.Count >= 1 && _traits.Count <= MaxTraits
                && AppearanceIsValid(Appearance);
        }

        public DerivedStats Derived()
        {
            int str = Stat("str");
            int per = Stat("per");
            int end = Stat("end");
            int cha = Stat("cha");
            int intelligence = Stat("int");
            int agi = Stat("agi");
            int luck = Stat("luck");
            bool bruiser = _traits.Contains("bruiser");
            bool trainedEye = _traits.Contains("trainedEye");
            bool trader = _traits.Contains("traderStart");
            bool craftsman = _traits.Contains("craftsmanStart");
            return new DerivedStats
            {
                MaxHp = 55 + end * 9 + (bruiser ? 18 : 0),
                MaxAp = Mathf.Max(5, 5 + Mathf.FloorToInt(agi / 2f)),
                Speed = 4.35f + agi * 0.13f - (bruiser ? 0.18f : 0f),
                Carry = 30 + str * 8,
                Hit = JsRound((per - 5) * 2.5f + (trainedEye ? 6f : 0f)),
                CriticalChance = Mathf.Clamp(luck, 1, 15),
                VisionRadius = Mathf.Clamp(Mathf.FloorToInt(5.5f + per * 0.7f + 0.5f), 6, 16),
                ResistAll = Mathf.Max(0, JsRound(end * 0.7f)),
                Sell = JsRound((cha - 5) * 4f + (trader ? 15f : 0f)),
                Craft = JsRound((intelligence - 5) * 3f + (craftsman ? 10f : 0f)),
                LuckChecks = JsRound(Mathf.Max(0, luck - 5) * 2.5f)
            };
        }

        public DrawResult Draw(ref string name, ref Vector2 scroll)
        {
            DrawResult result = DrawResult.None;
            scroll = GUILayout.BeginScrollView(scroll);

            GUILayout.Label("<b>Создание персонажа</b>", RichLabel());
            GUILayout.Label("Имя (2–18 символов)");
            name = GUILayout.TextField(name ?? string.Empty, 18);
            GUILayout.Space(8f);

            GUILayout.Label("<b>Внешность</b>", RichLabel());
            DrawOption("Пол", SexLabel(Appearance.Sex), () => CycleSex(-1), () => CycleSex(1));
            DrawOption("Телосложение", LabelFor(BodyIds, BodyLabels, Appearance.BodyType),
                       () => CycleBody(-1), () => CycleBody(1));
            DrawOption("Лицо", LabelFor(FaceIds(), FaceLabels, Appearance.FaceId),
                       () => CycleFace(-1), () => CycleFace(1));
            DrawOption("Причёска", HairLabel(Appearance.HairId),
                       () => CycleHair(-1), () => CycleHair(1));
            DrawOption("Цвет волос", LabelFor(HairColorIds, HairColorLabels, Appearance.HairColorId),
                       () => CycleHairColor(-1), () => CycleHairColor(1));
            GUILayout.Space(8f);

            GUILayout.Label("<b>SPECIAL — распределите 40 очков</b>", RichLabel());
            GUILayout.Label("Свободно: " + PointsLeft);
            foreach (StatDef stat in Stats) DrawStat(stat);
            GUILayout.Space(8f);

            GUILayout.Label("<b>Профильные навыки: " + _taggedSkills.Count + "/2</b>", RichLabel());
            DrawSkillGrid();
            GUILayout.Space(8f);

            GUILayout.Label("<b>Стартовые перки: " + _traits.Count + "/2</b>", RichLabel());
            DrawTraitGrid();
            GUILayout.Space(8f);

            DrawDerived();
            if (!string.IsNullOrEmpty(_notice))
            {
                Color previous = GUI.color;
                GUI.color = new Color(1f, 0.62f, 0.35f);
                GUILayout.Label(_notice);
                GUI.color = previous;
            }

            GUILayout.Space(10f);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Назад", GUILayout.Height(32f))) result = DrawResult.Cancel;
            bool ready = Ready(name);
            GUI.enabled = ready;
            if (GUILayout.Button("Создать и войти", GUILayout.Height(32f))) result = DrawResult.Create;
            GUI.enabled = true;
            GUILayout.EndHorizontal();
            if (!ready) GUILayout.Label(ReadinessHint(name));

            GUILayout.EndScrollView();
            return result;
        }

        public static bool AppearanceIsValid(CharacterAppearance appearance)
        {
            if (appearance == null) return false;
            bool sex = appearance.Sex == "male" || appearance.Sex == "female";
            bool body = Array.IndexOf(BodyIds, appearance.BodyType) >= 0;
            bool face = appearance.FaceId != null && appearance.FaceId.StartsWith(appearance.Sex + "_")
                        && Array.IndexOf(FaceSuffixes, appearance.FaceId.Substring(appearance.FaceId.Length - 2)) >= 0;
            bool hair = Array.IndexOf(HairIds(appearance.Sex), appearance.HairId) >= 0;
            bool color = Array.IndexOf(HairColorIds, appearance.HairColorId) >= 0;
            return appearance.Schema == "realm.character-appearance.v1"
                && appearance.SkinToneId == "skin_03"
                && sex && body && face && hair && color;
        }

        public int SkillBasePercent(string id, bool tagged)
        {
            int str = Stat("str");
            int per = Stat("per");
            int end = Stat("end");
            int cha = Stat("cha");
            int intelligence = Stat("int");
            int agi = Stat("agi");
            int luck = Stat("luck");
            int raw;
            switch (id)
            {
                case "lightWeapons": raw = 15 + agi * 2 + per; break;
                case "heavyWeapons": raw = 10 + str * 2 + end; break;
                case "energyWeapons": raw = 10 + intelligence * 2 + per; break;
                case "throwing": raw = 10 + agi * 2 + str; break;
                case "melee": raw = 15 + str * 2 + agi; break;
                case "unarmed": raw = 15 + str + agi + end; break;
                case "doctor": raw = 10 + intelligence * 2 + per; break;
                case "firstAid": raw = 12 + intelligence + per + end; break;
                case "stealth": raw = 10 + agi * 2 + luck; break;
                case "lockpick": raw = 10 + agi * 2 + per; break;
                case "traps": raw = 10 + per + agi + intelligence; break;
                case "science": raw = 10 + intelligence * 3; break;
                case "repair": raw = 10 + intelligence * 2 + per; break;
                case "speech": raw = 10 + cha * 3; break;
                case "barter": raw = 10 + cha * 2 + intelligence; break;
                case "wanderer": raw = 10 + end + per + luck * 2; break;
                default: raw = 20; break;
            }
            int baseValue = Mathf.Clamp(raw, 20, 45);
            return Mathf.Min(50, baseValue + (tagged ? 5 : 0));
        }

        private void DrawStat(StatDef stat)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(stat.Code, GUILayout.Width(28f));
            GUILayout.Label(new GUIContent(stat.Name, stat.Description), GUILayout.Width(145f));
            if (GUILayout.Button("?", GUILayout.Width(26f))) _notice = stat.Description;
            GUI.enabled = Stat(stat.Id) > SpecialMin;
            if (GUILayout.Button("−", GUILayout.Width(32f))) AdjustStat(stat.Id, -1);
            GUI.enabled = true;
            GUILayout.Label(Stat(stat.Id).ToString(), CenteredLabel(), GUILayout.Width(32f));
            GUI.enabled = PointsLeft > 0 && Stat(stat.Id) < SpecialMax;
            if (GUILayout.Button("+", GUILayout.Width(32f))) AdjustStat(stat.Id, 1);
            GUI.enabled = true;
            GUILayout.EndHorizontal();
        }

        private void DrawSkillGrid()
        {
            for (int i = 0; i < RoaProgressionData.Skills.Length; i += 2)
            {
                GUILayout.BeginHorizontal();
                DrawSkillButton(RoaProgressionData.Skills[i]);
                if (i + 1 < RoaProgressionData.Skills.Length)
                    DrawSkillButton(RoaProgressionData.Skills[i + 1]);
                GUILayout.EndHorizontal();
            }
        }

        private void DrawSkillButton(RoaProgressionData.SkillDef skill)
        {
            bool selected = _taggedSkills.Contains(skill.Id);
            int baseValue = SkillBasePercent(skill.Id, false);
            string label = (selected ? "✓ " : string.Empty) + skill.Name + "\n"
                           + skill.Group + " · " + baseValue + "% → " + Mathf.Min(50, baseValue + 5) + "%";
            DrawSelectionButton(label, selected, () => ToggleSkill(skill.Id));
        }

        private void DrawTraitGrid()
        {
            for (int i = 0; i < Traits.Length; i += 2)
            {
                GUILayout.BeginHorizontal();
                DrawTraitButton(Traits[i]);
                if (i + 1 < Traits.Length) DrawTraitButton(Traits[i + 1]);
                GUILayout.EndHorizontal();
            }
        }

        private void DrawTraitButton(TraitDef trait)
        {
            bool selected = _traits.Contains(trait.Id);
            string label = (selected ? "✓ " : string.Empty) + trait.Name + "\n" + trait.Description;
            DrawSelectionButton(label, selected, () => ToggleTrait(trait.Id));
        }

        private static void DrawSelectionButton(string label, bool selected, Action action)
        {
            Color previous = GUI.backgroundColor;
            if (selected) GUI.backgroundColor = new Color(0.45f, 0.76f, 0.38f);
            if (GUILayout.Button(label, GUILayout.MinHeight(46f))) action();
            GUI.backgroundColor = previous;
        }

        private void DrawDerived()
        {
            DerivedStats d = Derived();
            GUILayout.Label("<b>Производные параметры</b>", RichLabel());
            GUILayout.Label("ОЗ " + d.MaxHp + " · ОД " + d.MaxAp + " · скорость " + d.Speed.ToString("0.0")
                            + " · вес " + d.Carry);
            GUILayout.Label("Меткость " + Signed(d.Hit) + "% · крит " + d.CriticalChance
                            + "% · обзор " + d.VisionRadius + " кл. · сопротивление " + d.ResistAll + "%");
            GUILayout.Label("Продажа " + Signed(d.Sell) + "% · крафт/сбор " + Signed(d.Craft)
                            + "% · проверки удачи +" + d.LuckChecks + " п.п.");
        }

        public string ReadinessHint(string name)
        {
            if (PointsLeft != 0) return "Распределите ещё " + PointsLeft + " очк. SPECIAL.";
            if (string.IsNullOrWhiteSpace(name) || name.Trim().Length < 2) return "Введите имя минимум из двух символов.";
            if (_taggedSkills.Count == 0) return "Выберите хотя бы один профильный навык.";
            if (_traits.Count == 0) return "Выберите хотя бы один стартовый перк.";
            return AppearanceIsValid(Appearance) ? string.Empty : "Завершите выбор внешности.";
        }

        public void CycleSex(int offset)
        {
            int index = IndexOf(SexIds, Appearance.Sex);
            SetSex(SexIds[Wrap(index + offset, SexIds.Length)]);
        }

        public void CycleBody(int offset)
        {
            Appearance.BodyType = Cycle(BodyIds, Appearance.BodyType, offset);
        }

        public void CycleFace(int offset)
        {
            string[] ids = FaceIds();
            Appearance.FaceId = Cycle(ids, Appearance.FaceId, offset);
        }

        public void CycleHair(int offset)
        {
            string[] ids = HairIds(Appearance.Sex);
            Appearance.HairId = Cycle(ids, Appearance.HairId, offset);
        }

        public void CycleHairColor(int offset)
        {
            Appearance.HairColorId = Cycle(HairColorIds, Appearance.HairColorId, offset);
        }

        private static void DrawOption(string label, string value, Action previous, Action next)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(label, GUILayout.Width(145f));
            if (GUILayout.Button("←", GUILayout.Width(34f))) previous();
            GUILayout.Label(value, CenteredLabel(), GUILayout.MinWidth(170f));
            if (GUILayout.Button("→", GUILayout.Width(34f))) next();
            GUILayout.EndHorizontal();
        }

        private static CharacterAppearance DefaultAppearance(string sex)
        {
            bool female = sex == "female";
            return new CharacterAppearance
            {
                Sex = female ? "female" : "male",
                BodyType = "medium",
                FaceId = female ? "female_01" : "male_01",
                HairId = female ? "tied_back" : "short_crop",
                HairColorId = "hair_03"
            };
        }

        private string[] FaceIds()
        {
            string prefix = Appearance.Sex == "female" ? "female_" : "male_";
            string[] ids = new string[FaceSuffixes.Length];
            for (int i = 0; i < ids.Length; i++) ids[i] = prefix + FaceSuffixes[i];
            return ids;
        }

        private static string[] HairIds(string sex)
        {
            return sex == "female"
                ? new[] { "shaved", "tied_back" }
                : new[] { "shaved", "short_crop" };
        }

        private static string HairLabel(string id)
        {
            if (id == "shaved") return "Без волос";
            if (id == "tied_back") return "Собранная";
            return "Короткая";
        }

        private static string SexLabel(string id)
        {
            return LabelFor(SexIds, SexLabels, id);
        }

        private static string Signed(int value)
        {
            return value >= 0 ? "+" + value : value.ToString();
        }

        private static string LabelFor(string[] ids, string[] labels, string id)
        {
            int index = IndexOf(ids, id);
            return index >= 0 && index < labels.Length ? labels[index] : id;
        }

        private static string Cycle(string[] ids, string current, int offset)
        {
            int index = IndexOf(ids, current);
            return ids[Wrap(index + offset, ids.Length)];
        }

        private static int IndexOf(string[] values, string value)
        {
            int index = Array.IndexOf(values, value);
            return index >= 0 ? index : 0;
        }

        private static int Wrap(int value, int count)
        {
            value %= count;
            return value < 0 ? value + count : value;
        }

        private static int JsRound(float value)
        {
            return Mathf.FloorToInt(value + 0.5f);
        }

        private static GUIStyle RichLabel()
        {
            var style = new GUIStyle(GUI.skin.label) { richText = true };
            return style;
        }

        private static GUIStyle CenteredLabel()
        {
            var style = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter };
            return style;
        }
    }
}
