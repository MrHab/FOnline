using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Страницы «Навыки» и «Перки» PIP-ASH в структуре окна «Развитие персонажа»
    /// web (#talents-window, 07/08 css, 03a):
    /// - навыки: шапка «НАВЫКИ · очков», панель плана «Свободно / В плане ·
    ///   Сбросить / Применить», группы, сетка карточек в две колонки
    ///   (имя, эффект, формула, «Навык X% / 100%», ряд плана «− n +5%»);
    /// - перки: ряд статусов (Очки перков / Уровень / Доступно / Изучено /
    ///   Раздел), строка фокуса с поиском и легендой Можно/Закрыт/Изучен,
    ///   раскладка «категории | список карточек | панель деталей».
    /// Логика и серверные запросы остаются в RoaPipboy.
    /// </summary>
    public sealed partial class RoaPipboyCanvas
    {
        private static readonly Color Gold = new Color(0.835f, 0.722f, 0.392f, 1f);      // #d5b864
        private static readonly Color GoldBright = new Color(0.937f, 0.816f, 0.471f, 1f); // #efd078
        private static readonly Color LimeInk = new Color(0.788f, 0.91f, 0.514f, 1f);     // #c9e883
        private static readonly Color BtnBg = new Color(0.169f, 0.125f, 0.059f, 1f);     // rgba(43,32,15,.78) на тёмном
        private static readonly Color BtnBorder = new Color(0.835f, 0.722f, 0.392f, 0.58f);
        private static readonly Color BtnInk = new Color(0.898f, 0.765f, 0.427f, 1f);    // #e5c36d
        private static readonly Color CardBgDark = new Color(0.03f, 0.075f, 0.042f, 1f);
        private static readonly Color CardBorderGreen = new Color(0.494f, 0.784f, 0.357f, 0.34f);
        private static readonly Color FormulaInk = new Color(0.89f, 0.761f, 0.412f, 0.82f); // #e3c269

        // ---- Навыки ----
        private Text _skillsHeaderPoints;
        private Text _planFree;
        private Text _planUsed;
        private Button _planReset;
        private Button _planApply;
        private RectTransform _skillsGrid;
        private readonly Dictionary<string, int> _skillPlan = new Dictionary<string, int>();
        private bool _planApplying;

        // ---- Перки ----
        private RectTransform _perkStatus;
        private readonly List<Text> _perkStatusValues = new List<Text>();
        private Text _perkFocusIcon;
        private Text _perkFocusName;
        private Text _perkFocusDesc;
        private InputField _perkSearch;
        private readonly Dictionary<string, Button> _perkLegend = new Dictionary<string, Button>();
        private RectTransform _perkCategories;
        private RectTransform _perkList;
        private RectTransform _perkDetail;
        private readonly List<GameObject> _perkCategoryRows = new List<GameObject>();
        private readonly List<GameObject> _perkDetailRows = new List<GameObject>();
        private string _perkCategory = "all";
        private string _perkFilter = string.Empty;
        private string _perkSelected = string.Empty;
        private string _perkSearchText = string.Empty;

        private static readonly (string id, string icon, string title, string desc)[] PerkCategories =
        {
            ("ready", "★", "Доступные", "Перки, которые можно изучить прямо сейчас."),
            ("all", "≡", "Все", "Полный список перков по веткам развития."),
            ("SPECIAL", "S", "Характеристики", "Прямое усиление SPECIAL."),
            ("Боевые", "Б", "Боевые", "Оружие, точность и урон."),
            ("Медицина", "+", "Медицина", "Лечение, травмы и выживание."),
            ("Обзор и выживание", "О", "Обзор и выживание", "Обзор, скрытность и пустошь."),
            ("Техника и торговля", "Т", "Техника и торговля", "Ремонт, взлом, наука и бартер."),
            ("Защита и удача", "З", "Защита и удача", "Броня, сопротивление и удача.")
        };

        // ==================================================================
        // SKILLS
        // ==================================================================

        private void BuildSkillsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Skills, parent);
            SectionTitle(page, "SKILLS");

            // #skills-header: «НАВЫКИ  очков: N»
            Text header = Label("Header", page, 15, TextAnchor.MiddleLeft, Gold, FontStyle.Bold);
            header.text = "НАВЫКИ";
            Place_(header.rectTransform, 0f, 1f, 0.5f, 1f, new Vector2(4f, -60f), new Vector2(0f, -36f));
            _skillsHeaderPoints = Label("Points", page, 11, TextAnchor.MiddleLeft, ScreenInkDim);
            Place_(_skillsHeaderPoints.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(86f, -60f), new Vector2(0f, -36f));

            // .skill-plan-controls
            RectTransform plan = Panel_(page, CardBgDark, CardBorderGreen);
            Place_(plan, 0f, 1f, 1f, 1f, new Vector2(4f, -114f), new Vector2(-4f, -64f));
            Text freeLabel = Label("FreeLabel", plan, 12, TextAnchor.MiddleLeft, ScreenInkDim);
            freeLabel.text = "Свободно";
            Place_(freeLabel.rectTransform, 0f, 0f, 0f, 1f, new Vector2(10f, 0f), new Vector2(80f, 0f));
            _planFree = Label("Free", plan, 16, TextAnchor.MiddleLeft, GoldBright, FontStyle.Bold);
            Place_(_planFree.rectTransform, 0f, 0f, 0f, 1f, new Vector2(82f, 0f), new Vector2(120f, 0f));
            Text usedLabel = Label("UsedLabel", plan, 12, TextAnchor.MiddleLeft, ScreenInkDim);
            usedLabel.text = "В плане";
            Place_(usedLabel.rectTransform, 0f, 0f, 0f, 1f, new Vector2(128f, 0f), new Vector2(190f, 0f));
            _planUsed = Label("Used", plan, 16, TextAnchor.MiddleLeft, GoldBright, FontStyle.Bold);
            Place_(_planUsed.rectTransform, 0f, 0f, 0f, 1f, new Vector2(192f, 0f), new Vector2(240f, 0f));
            _planApply = PlanButton(plan, "Применить", 10f, 96f, () => StartCoroutine(ApplySkillPlan()));
            _planReset = PlanButton(plan, "Сбросить", 114f, 92f, () => { _skillPlan.Clear(); _refreshAt = 0f; });

            // #skill-grid: две колонки карточек.
            RectTransform scrollArea = Child("Scroll", page);
            Place_(scrollArea, 0f, 0f, 1f, 1f, new Vector2(4f, 30f), new Vector2(-4f, -120f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scroll.scrollSensitivity = 28f;
            scrollArea.gameObject.AddComponent<RectMask2D>();
            _skillsGrid = Child("Grid", scrollArea);
            _skillsGrid.anchorMin = new Vector2(0f, 1f);
            _skillsGrid.anchorMax = new Vector2(1f, 1f);
            _skillsGrid.pivot = new Vector2(0f, 1f);
            _skillsGrid.sizeDelta = Vector2.zero;
            // Вертикальный список: строка заголовка группы (20px) и строки из двух карточек (150px),
            // потому что GridLayoutGroup не умеет строки разной высоты.
            var grid = _skillsGrid.gameObject.AddComponent<VerticalLayoutGroup>();
            grid.spacing = 8f;
            grid.padding = new RectOffset(0, 4, 0, 8);
            grid.childForceExpandHeight = false;
            grid.childControlHeight = true;
            _skillsGrid.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _skillsGrid;
            _skillsList = _skillsGrid;

            _progressionStatus = Label("ProgStatus", page, 11, TextAnchor.LowerLeft, ScreenInkDim);
            Place_(_progressionStatus.rectTransform, 0f, 0f, 1f, 0f, new Vector2(6f, 2f), new Vector2(-6f, 26f));
        }

        private Button PlanButton(RectTransform parent, string caption, float right, float width, System.Action onClick)
        {
            Button button = TextButton(caption, parent, caption, 13, out Text label);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(1f, 0.5f);
            rect.pivot = new Vector2(1f, 0.5f);
            rect.anchoredPosition = new Vector2(-right, 0f);
            rect.sizeDelta = new Vector2(width, 30f);
            button.GetComponent<Image>().color = BtnBg;
            var outline = button.gameObject.AddComponent<Outline>();
            outline.effectColor = BtnBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            label.color = BtnInk;
            label.fontStyle = FontStyle.Bold;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        private int PlanTotal()
        {
            int total = 0;
            foreach (KeyValuePair<string, int> row in _skillPlan) total += row.Value;
            return total;
        }

        private void RefreshSkills(JObject self)
        {
            int points = self?["skillPoints"]?.ToObject<int>() ?? 0;
            int planned = PlanTotal();
            int free = Mathf.Max(0, points - planned);
            _skillsHeaderPoints.text = "очков: " + points;
            _planFree.text = free.ToString();
            _planUsed.text = planned.ToString();
            _planApply.interactable = planned > 0 && !_planApplying && !Pipboy.ProgressionPending;
            _planReset.interactable = planned > 0 && !_planApplying;

            RebuildRows(_skillRows, _skillsList, () =>
            {
                _skillPairRow = null;
                _skillPairCount = 0;
                string group = null;
                foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills)
                {
                    if (skill.Group != group)
                    {
                        group = skill.Group;
                        AddSkillGroupTitle(group);
                    }
                    AddSkillCard(self, skill, free);
                }
            });

            _progressionStatus.text = _planApplying ? "Применяю план…" : Pipboy.ProgressionStatus;
        }

        private RectTransform _skillPairRow;
        private int _skillPairCount;

        private void AddSkillGroupTitle(string group)
        {
            _skillPairRow = null;
            var row = new GameObject("Group", typeof(RectTransform));
            row.transform.SetParent(_skillsGrid, false);
            row.AddComponent<LayoutElement>().preferredHeight = 20f;
            Text text = Label("Text", (RectTransform)row.transform, 11, TextAnchor.LowerLeft, Gold, FontStyle.Bold);
            text.text = group.ToUpperInvariant();
            Stretch(text.rectTransform, 2f);
            _skillRows.Add(row);
        }

        /// <summary>Строка на две карточки (#skill-grid: 2 колонки по 441px, gap 8).</summary>
        private RectTransform NextSkillCell()
        {
            if (_skillPairRow == null || _skillPairCount >= 2)
            {
                var row = new GameObject("Pair", typeof(RectTransform));
                row.transform.SetParent(_skillsGrid, false);
                row.AddComponent<LayoutElement>().preferredHeight = 150f;
                _skillPairRow = (RectTransform)row.transform;
                _skillPairCount = 0;
                _skillRows.Add(row);
            }
            RectTransform cell = Child("Cell", _skillPairRow);
            bool left = _skillPairCount == 0;
            Place_(cell, left ? 0f : 0.5f, 0f, left ? 0.5f : 1f, 1f, new Vector2(left ? 0f : 4f, 0f), new Vector2(left ? -4f : 0f, 0f));
            _skillPairCount++;
            return cell;
        }

        /// <summary>.talent-card.skill-card: имя, эффект, формула, «Навык X% / 100%», ряд плана.</summary>
        private void AddSkillCard(JObject self, RoaProgressionData.SkillDef skill, int free)
        {
            int value = RoaPipboy.SkillPercent(self, skill.Id);
            _skillPlan.TryGetValue(skill.Id, out int plannedSteps);
            int shown = Mathf.Min(100, value + plannedSteps * 5);
            bool locked = value >= 100;

            RectTransform cell = NextSkillCell();
            var card = new GameObject("Skill:" + skill.Id, typeof(RectTransform));
            card.transform.SetParent(cell, false);
            var rect = (RectTransform)card.transform;
            Stretch(rect, 0f);
            var back = card.AddComponent<Image>();
            back.color = CardBgDark;
            back.raycastTarget = false;
            var outline = card.AddComponent<Outline>();
            outline.effectColor = plannedSteps > 0 ? new Color(GoldBright.r, GoldBright.g, GoldBright.b, 0.8f) : CardBorderGreen;
            outline.effectDistance = new Vector2(1f, -1f);

            Text name = Label("Name", rect, 11, TextAnchor.UpperLeft, SlotName, FontStyle.Bold);
            name.text = skill.Name;
            Place_(name.rectTransform, 0f, 1f, 1f, 1f, new Vector2(7f, -20f), new Vector2(-7f, -7f));
            Text desc = Label("Desc", rect, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.76f));
            desc.text = skill.Description;
            Place_(desc.rectTransform, 0f, 1f, 1f, 1f, new Vector2(7f, -48f), new Vector2(-35f, -22f));
            Text formula = Label("Formula", rect, 10, TextAnchor.UpperLeft, FormulaInk);
            formula.text = RoaPipboy.SkillFormulaText(self, skill.Id);
            Place_(formula.rectTransform, 0f, 1f, 1f, 1f, new Vector2(7f, -92f), new Vector2(-7f, -50f));
            Text rank = Label("Rank", rect, 9, TextAnchor.UpperLeft, new Color(0.89f, 0.761f, 0.412f, 1f));
            rank.text = "Навык " + value + "% / 100%" + (plannedSteps > 0 ? "  →  " + shown + "%" : string.Empty);
            Place_(rank.rectTransform, 0f, 1f, 1f, 1f, new Vector2(7f, -106f), new Vector2(-7f, -94f));

            // .skill-plan-row: [−] n [+5%] справа снизу.
            RectTransform planRow = Panel_(rect, new Color(0.02f, 0.05f, 0.03f, 1f), new Color(0.494f, 0.784f, 0.357f, 0.22f));
            planRow.anchorMin = planRow.anchorMax = new Vector2(1f, 0f);
            planRow.pivot = new Vector2(1f, 0f);
            planRow.anchoredPosition = new Vector2(-7f, 7f);
            planRow.sizeDelta = new Vector2(134f, 36f);
            string id = skill.Id;
            Button minus = SmallButton(planRow, "-", 3f, 30f, plannedSteps > 0, () => { _skillPlan[id] = Mathf.Max(0, plannedSteps - 1); _refreshAt = 0f; });
            minus.name = "SkillMinus:" + id;
            Text count = Label("Count", planRow, 11, TextAnchor.MiddleCenter, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.76f));
            count.text = (plannedSteps * 5).ToString();
            Place_(count.rectTransform, 0f, 0f, 0f, 1f, new Vector2(38f, 3f), new Vector2(68f, -3f));
            Button plus = SmallButton(planRow, "+5%", 73f, 56f, !locked && free > 0 && shown < 100, () => { _skillPlan[id] = plannedSteps + 1; _refreshAt = 0f; });
            plus.name = "SkillPlus:" + id;

        }

        private Button SmallButton(RectTransform parent, string caption, float left, float width, bool enabled, System.Action onClick)
        {
            Button button = TextButton(caption, parent, caption, 13, out Text label);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = new Vector2(0f, 0f);
            rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 0.5f);
            rect.anchoredPosition = new Vector2(left, 0f);
            rect.offsetMin = new Vector2(left, 4f);
            rect.offsetMax = new Vector2(left + width, -4f);
            button.GetComponent<Image>().color = enabled ? BtnBg : new Color(BtnBg.r, BtnBg.g, BtnBg.b, 0.5f);
            var outline = button.gameObject.AddComponent<Outline>();
            outline.effectColor = new Color(BtnBorder.r, BtnBorder.g, BtnBorder.b, enabled ? 0.58f : 0.25f);
            outline.effectDistance = new Vector2(1f, -1f);
            label.color = enabled ? BtnInk : new Color(BtnInk.r, BtnInk.g, BtnInk.b, 0.4f);
            label.fontStyle = FontStyle.Bold;
            button.interactable = enabled;
            button.onClick.AddListener(() => onClick());
            return button;
        }

        /// <summary>Применить план: сервер принимает по одному шагу +5%, поэтому шаги идут последовательно.</summary>
        private IEnumerator ApplySkillPlan()
        {
            if (_planApplying || Pipboy == null) yield break;
            _planApplying = true;
            var steps = new List<KeyValuePair<string, int>>(_skillPlan);
            foreach (KeyValuePair<string, int> step in steps)
            {
                for (int i = 0; i < step.Value; i++)
                {
                    JObject self = Socket != null && Socket.Session != null ? Socket.Session.Self : null;
                    int current = RoaPipboy.SkillPercent(self, step.Key);
                    Pipboy.SubmitSkillUp(step.Key, current);
                    float until = Time.unscaledTime + 6f;
                    yield return null;
                    while (Pipboy.ProgressionPending && Time.unscaledTime < until) yield return null;
                    _skillPlan[step.Key] = Mathf.Max(0, _skillPlan[step.Key] - 1);
                    _refreshAt = 0f;
                }
            }
            _skillPlan.Clear();
            _planApplying = false;
            _refreshAt = 0f;
        }

        // ==================================================================
        // PERKS
        // ==================================================================

        private void BuildPerksPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Perks, parent);
            SectionTitle(page, "PERKS");

            // .perk-board-status: пять плиток.
            _perkStatus = Child("Status", page);
            Place_(_perkStatus, 0f, 1f, 1f, 1f, new Vector2(4f, -94f), new Vector2(-4f, -36f));
            string[] labels = { "Очки перков", "Уровень", "Доступно", "Изучено", "Раздел" };
            float[] widths = { 0.17f, 0.14f, 0.14f, 0.18f, 0.37f };
            float x = 0f;
            for (int i = 0; i < labels.Length; i++)
            {
                RectTransform tile = Panel_(_perkStatus, CardBgDark, new Color(GoldBright.r, GoldBright.g, GoldBright.b, i == 0 ? 0.75f : 0.48f));
                Place_(tile, x, 0f, x + widths[i], 1f, new Vector2(i == 0 ? 0f : 4f, 0f), new Vector2(i == labels.Length - 1 ? 0f : -4f, 0f));
                x += widths[i];
                Text label = Label("Label", tile, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.68f), FontStyle.Bold);
                label.text = labels[i].ToUpperInvariant();
                Place_(label.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -22f), new Vector2(-10f, -8f));
                Text value = Label("Value", tile, 18, TextAnchor.LowerLeft, GoldBright, FontStyle.Bold);
                value.horizontalOverflow = HorizontalWrapMode.Overflow;
                Place_(value.rectTransform, 0f, 0f, 1f, 0f, new Vector2(10f, 7f), new Vector2(-10f, 31f));
                _perkStatusValues.Add(value);
            }

            // .perk-board-focus: раздел + поиск + легенда.
            RectTransform focus = Panel_(page, CardBgDark, new Color(0.494f, 0.784f, 0.357f, 0.24f));
            Place_(focus, 0f, 1f, 1f, 1f, new Vector2(4f, -160f), new Vector2(-4f, -100f));
            _perkFocusIcon = Label("Icon", focus, 14, TextAnchor.MiddleCenter, GoldBright, FontStyle.Bold);
            Place_(_perkFocusIcon.rectTransform, 0f, 0f, 0f, 1f, new Vector2(12f, 13f), new Vector2(46f, -13f));
            _perkFocusIcon.gameObject.AddComponent<Outline>().effectColor = new Color(0.494f, 0.784f, 0.357f, 0.22f);
            _perkFocusName = Label("Name", focus, 13, TextAnchor.MiddleLeft, GoldBright, FontStyle.Bold);
            Place_(_perkFocusName.rectTransform, 0f, 0.5f, 0.44f, 1f, new Vector2(54f, -4f), new Vector2(0f, -10f));
            _perkFocusDesc = Label("Desc", focus, 10, TextAnchor.MiddleLeft, ScreenInkDim);
            _perkFocusDesc.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(_perkFocusDesc.rectTransform, 0f, 0f, 0.44f, 0.5f, new Vector2(54f, 8f), new Vector2(0f, 2f));

            RectTransform search = Panel_(focus, new Color(0.02f, 0.05f, 0.03f, 1f), new Color(0.494f, 0.784f, 0.357f, 0.22f));
            Place_(search, 0.45f, 0f, 0.78f, 1f, new Vector2(0f, 11f), new Vector2(0f, -11f));
            Text searchLabel = Label("Label", search, 10, TextAnchor.MiddleLeft, ScreenInkDim, FontStyle.Bold);
            searchLabel.text = "ПОИСК";
            Place_(searchLabel.rectTransform, 0f, 0f, 0f, 1f, new Vector2(8f, 0f), new Vector2(56f, 0f));
            _perkSearch = search.gameObject.AddComponent<InputField>();
            Text searchText = Label("Text", search, 12, TextAnchor.MiddleLeft, LimeInk);
            searchText.supportRichText = false;
            Place_(searchText.rectTransform, 0f, 0f, 1f, 1f, new Vector2(58f, 0f), new Vector2(-8f, 0f));
            _perkSearch.textComponent = searchText;
            Text placeholder = Label("Placeholder", search, 12, TextAnchor.MiddleLeft, ScreenInkDim);
            placeholder.text = "название перка";
            Place_(placeholder.rectTransform, 0f, 0f, 1f, 1f, new Vector2(58f, 0f), new Vector2(-8f, 0f));
            _perkSearch.placeholder = placeholder;
            _perkSearch.onValueChanged.AddListener(v => { _perkSearchText = v ?? string.Empty; _refreshAt = 0f; });

            string[] legend = { "ready", "locked", "done" };
            string[] legendLabels = { "Можно", "Закрыт", "Изучен" };
            for (int i = 0; i < legend.Length; i++)
            {
                Button button = TextButton("Legend:" + legend[i], focus, legendLabels[i].ToUpperInvariant(), 9, out Text label);
                var rect = (RectTransform)button.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(1f, 0.5f);
                rect.pivot = new Vector2(1f, 0.5f);
                rect.anchoredPosition = new Vector2(-12f - (2 - i) * 58f, 0f);
                rect.sizeDelta = new Vector2(54f, 20f);
                button.GetComponent<Image>().color = new Color(0.02f, 0.05f, 0.03f, 1f);
                var outline = button.gameObject.AddComponent<Outline>();
                outline.effectColor = new Color(GoldBright.r, GoldBright.g, GoldBright.b, 0.52f);
                outline.effectDistance = new Vector2(1f, -1f);
                label.color = GoldBright;
                label.fontStyle = FontStyle.Bold;
                string key = legend[i];
                button.onClick.AddListener(() => { _perkFilter = _perkFilter == key ? string.Empty : key; _refreshAt = 0f; });
                _perkLegend[key] = button;
            }

            // .perk-board-layout: категории | список | детали.
            _perkCategories = ScrollColumn(page, 0f, 0.21f, -166f);
            _perkList = ScrollColumn(page, 0.215f, 0.655f, -166f);
            _perkDetail = Panel_(page, CardBgDark, new Color(Gold.r, Gold.g, Gold.b, 0.44f));
            Place_(_perkDetail, 0.66f, 0f, 1f, 1f, new Vector2(0f, 30f), new Vector2(-4f, -166f));
            _perksList = _perkList;

            foreach ((string id, string icon, string title, string _) in PerkCategories)
            {
                var row = new GameObject("Category:" + id, typeof(RectTransform));
                row.transform.SetParent(_perkCategories, false);
                row.AddComponent<LayoutElement>().preferredHeight = 42f;
                var image = row.AddComponent<Image>();
                image.color = CardBgDark;
                var outline = row.AddComponent<Outline>();
                outline.effectColor = new Color(0.494f, 0.784f, 0.357f, 0.24f);
                outline.effectDistance = new Vector2(1f, -1f);
                var button = row.AddComponent<Button>();
                button.targetGraphic = image;
                var rect = (RectTransform)row.transform;
                Text glyph = Label("Icon", rect, 12, TextAnchor.MiddleCenter, GoldBright, FontStyle.Bold);
                glyph.text = icon;
                Place_(glyph.rectTransform, 0f, 0.5f, 0f, 0.5f, new Vector2(8f, -12f), new Vector2(32f, 12f));
                Text label = Label("Label", rect, 10, TextAnchor.UpperLeft, ScreenInk, FontStyle.Bold);
                label.text = title.ToUpperInvariant();
                label.verticalOverflow = VerticalWrapMode.Truncate;
                Place_(label.rectTransform, 0f, 0.5f, 1f, 1f, new Vector2(39f, -2f), new Vector2(-6f, -6f));
                Text state = Label("State", rect, 9, TextAnchor.UpperLeft, ScreenInkDim, FontStyle.Bold);
                Place_(state.rectTransform, 0f, 0f, 1f, 0.5f, new Vector2(39f, 5f), new Vector2(-6f, 1f));
                string key = id;
                button.onClick.AddListener(() => { _perkCategory = key; _refreshAt = 0f; });
                _perkCategoryRows.Add(row);
            }
        }

        private RectTransform ScrollColumn(RectTransform page, float minX, float maxX, float top)
        {
            RectTransform scrollArea = Child("Scroll", page);
            Place_(scrollArea, minX, 0f, maxX, 1f, new Vector2(minX == 0f ? 4f : 0f, 30f), new Vector2(-4f, top));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scroll.scrollSensitivity = 28f;
            scrollArea.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 7f;
            layout.padding = new RectOffset(0, 3, 0, 8);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return list;
        }

        private string PerkState(RoaProgressionData.TalentDef talent, JObject ranks, out int rank)
        {
            rank = ranks?[talent.Id]?.ToObject<int>() ?? 0;
            if (rank >= talent.MaxRank) return "done";
            return Pipboy.TalentRequirementsMet(talent) ? "ready" : "locked";
        }

        private static string PerkStateLabel(string state)
        {
            return state == "done" ? "Изучен" : state == "ready" ? "Можно" : "Закрыт";
        }

        private void RefreshPerks(JObject self)
        {
            int points = self?["perkPoints"]?.ToObject<int>() ?? self?["talentPoints"]?.ToObject<int>() ?? 0;
            JObject ranks = self?["talentRanks"] as JObject;
            int learned = 0, available = 0;
            var stateById = new Dictionary<string, string>();
            var rankById = new Dictionary<string, int>();
            foreach (RoaProgressionData.TalentDef t in RoaProgressionData.Talents)
            {
                string state = PerkState(t, ranks, out int r);
                stateById[t.Id] = state;
                rankById[t.Id] = r;
                if (r > 0) learned++;
                if (state == "ready") available++;
            }

            (string id, string icon, string title, string desc) category = PerkCategories[1];
            foreach ((string id, string icon, string title, string desc) row in PerkCategories)
                if (row.id == _perkCategory) category = row;
            _perkStatusValues[0].text = points.ToString();
            _perkStatusValues[1].text = (self?["level"]?.ToObject<int>() ?? 1).ToString();
            _perkStatusValues[2].text = available.ToString();
            _perkStatusValues[3].text = learned.ToString();
            _perkStatusValues[4].text = category.title;
            _perkFocusIcon.text = category.icon;
            _perkFocusName.text = category.title;
            _perkFocusDesc.text = category.desc;
            foreach (KeyValuePair<string, Button> legend in _perkLegend)
            {
                bool active = legend.Key == _perkFilter;
                legend.Value.GetComponent<Image>().color = active ? new Color(0.33f, 0.24f, 0.09f, 1f) : new Color(0.02f, 0.05f, 0.03f, 1f);
            }

            // Категории: подпись состояния (— НЕТ / — ОБЗОР / — N МОЖНО / — ЗАКРЫТО).
            for (int i = 0; i < _perkCategoryRows.Count; i++)
            {
                (string id, string icon, string title, string desc) row = PerkCategories[i];
                int ready = 0, total = 0;
                foreach (RoaProgressionData.TalentDef t in RoaProgressionData.Talents)
                {
                    bool inGroup = row.id == "all" || row.id == "ready" ? true : t.Group == row.id;
                    if (!inGroup) continue;
                    total++;
                    if (stateById[t.Id] == "ready") ready++;
                }
                Text state = _perkCategoryRows[i].transform.Find("State").GetComponent<Text>();
                state.text = row.id == "ready" ? (ready > 0 ? "— " + ready + " МОЖНО" : "— НЕТ")
                    : row.id == "all" ? "— ОБЗОР"
                    : ready > 0 ? "— " + ready + " МОЖНО" : "— ЗАКРЫТО";
                bool active = row.id == _perkCategory;
                _perkCategoryRows[i].transform.Find("Label").GetComponent<Text>().color = active ? GoldBright : ScreenInk;
                _perkCategoryRows[i].GetComponent<Outline>().effectColor = active
                    ? new Color(GoldBright.r, GoldBright.g, GoldBright.b, 0.7f) : new Color(0.494f, 0.784f, 0.357f, 0.24f);
            }

            // Список карточек выбранного раздела с фильтрами.
            RebuildRows(_perkRows, _perkList, () =>
            {
                string group = null;
                bool anySelected = false;
                string needle = _perkSearchText.Trim().ToLowerInvariant();
                foreach (RoaProgressionData.TalentDef talent in RoaProgressionData.Talents)
                {
                    string state = stateById[talent.Id];
                    if (_perkCategory == "ready" && state != "ready") continue;
                    if (_perkCategory != "all" && _perkCategory != "ready" && talent.Group != _perkCategory) continue;
                    if (!string.IsNullOrEmpty(_perkFilter) && state != _perkFilter) continue;
                    if (!string.IsNullOrEmpty(needle) && !talent.Name.ToLowerInvariant().Contains(needle)) continue;
                    if (talent.Group != group)
                    {
                        group = talent.Group;
                        AddPerkGroupTitle(group);
                    }
                    if (string.IsNullOrEmpty(_perkSelected)) _perkSelected = talent.Id;
                    if (talent.Id == _perkSelected) anySelected = true;
                    AddPerkCard(talent, state, rankById[talent.Id]);
                }
                if (_perkRows.Count == 0) AddTextCard(_perkRows, _perkList, "Ничего не найдено", "Смените раздел или фильтр.");
                if (!anySelected) _perkSelected = string.Empty;
            });

            RefreshPerkDetail(self, stateById, rankById, points);
        }

        private void AddPerkGroupTitle(string group)
        {
            var row = new GameObject("GroupTitle", typeof(RectTransform));
            row.transform.SetParent(_perkList, false);
            row.AddComponent<LayoutElement>().preferredHeight = 25f;
            row.AddComponent<Image>().color = new Color(0.16f, 0.13f, 0.07f, 1f);
            var outline = row.AddComponent<Outline>();
            outline.effectColor = new Color(Gold.r, Gold.g, Gold.b, 0.22f);
            outline.effectDistance = new Vector2(1f, -1f);
            Text text = Label("Text", (RectTransform)row.transform, 11, TextAnchor.MiddleLeft, Gold, FontStyle.Bold);
            text.text = group.ToUpperInvariant();
            Stretch(text.rectTransform, 8f);
            _perkRows.Add(row);
        }

        /// <summary>.perk-card: иконка-бокс, имя + состояние, «раздел · ур. N · Следующий ранг», эффект.</summary>
        private void AddPerkCard(RoaProgressionData.TalentDef talent, string state, int rank)
        {
            bool selected = talent.Id == _perkSelected;
            var row = new GameObject("Perk:" + talent.Id, typeof(RectTransform));
            row.transform.SetParent(_perkList, false);
            row.AddComponent<LayoutElement>().preferredHeight = 96f;
            var image = row.AddComponent<Image>();
            image.color = selected ? new Color(0.07f, 0.11f, 0.06f, 1f) : CardBgDark;
            var outline = row.AddComponent<Outline>();
            outline.effectColor = selected ? new Color(GoldBright.r, GoldBright.g, GoldBright.b, 0.86f)
                : state == "ready" ? new Color(0.56f, 0.84f, 0.48f, 0.6f)
                : state == "done" ? new Color(0.5f, 0.8f, 0.95f, 0.5f)
                : new Color(0.494f, 0.784f, 0.357f, 0.24f);
            outline.effectDistance = new Vector2(1f, -1f);
            var button = row.AddComponent<Button>();
            button.targetGraphic = image;
            string id = talent.Id;
            button.onClick.AddListener(() => { _perkSelected = id; _refreshAt = 0f; });
            var rect = (RectTransform)row.transform;

            RectTransform iconBox = Panel_(rect, new Color(0.015f, 0.04f, 0.025f, 1f), new Color(Gold.r, Gold.g, Gold.b, 0.28f));
            Place_(iconBox, 0f, 1f, 0f, 1f, new Vector2(10f, -52f), new Vector2(52f, -10f));
            Text icon = Label("Icon", iconBox, 18, TextAnchor.MiddleCenter, GoldBright, FontStyle.Bold);
            icon.text = PerkGlyph(talent);
            Stretch(icon.rectTransform, 0f);

            Text name = Label("Name", rect, 13, TextAnchor.UpperLeft, GoldBright, FontStyle.Bold);
            name.text = talent.Name;
            name.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(name.rectTransform, 0f, 1f, 1f, 1f, new Vector2(60f, -26f), new Vector2(-70f, -10f));
            Text stateText = Label("State", rect, 9, TextAnchor.UpperRight, state == "ready" ? LimeInk : state == "done" ? new Color(0.6f, 0.85f, 1f) : ScreenInkDim, FontStyle.Bold);
            stateText.text = PerkStateLabel(state).ToUpperInvariant();
            Place_(stateText.rectTransform, 1f, 1f, 1f, 1f, new Vector2(-70f, -24f), new Vector2(-10f, -10f));
            Text meta = Label("Meta", rect, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.7f), FontStyle.Bold);
            meta.text = talent.Group + " · ур. " + talent.Level + " · " + (rank >= talent.MaxRank ? "Максимум " + rank + "/" + talent.MaxRank : "Следующий ранг " + (rank + 1) + "/" + talent.MaxRank);
            meta.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(meta.rectTransform, 0f, 1f, 1f, 1f, new Vector2(60f, -42f), new Vector2(-10f, -28f));
            Text desc = Label("Desc", rect, 10, TextAnchor.UpperLeft, new Color(LimeInk.r, LimeInk.g, LimeInk.b, 0.86f));
            desc.text = talent.Description;
            desc.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(desc.rectTransform, 0f, 0f, 1f, 1f, new Vector2(60f, 8f), new Vector2(-10f, -44f));
            _perkRows.Add(row);
        }

        private static string PerkGlyph(RoaProgressionData.TalentDef talent)
        {
            switch (talent.Group)
            {
                case "SPECIAL": return talent.Stat != null && talent.Stat.Length >= 2 ? talent.Stat.Substring(0, 2).ToUpperInvariant() : "S";
                case "Боевые": return "Б";
                case "Медицина": return "М";
                case "Обзор и выживание": return "О";
                case "Техника и торговля": return "Т";
                case "Защита и удача": return "З";
                default: return "★";
            }
        }

        /// <summary>.perk-detail-panel: kicker, заголовок, чипы состояния, «следующий ранг», эффект, требования, кнопка.</summary>
        private void RefreshPerkDetail(JObject self, Dictionary<string, string> stateById, Dictionary<string, int> rankById, int points)
        {
            foreach (GameObject row in _perkDetailRows) Destroy(row);
            _perkDetailRows.Clear();
            RoaProgressionData.TalentDef talent = null;
            foreach (RoaProgressionData.TalentDef t in RoaProgressionData.Talents) if (t.Id == _perkSelected) talent = t;
            if (talent == null)
            {
                Text empty = Label("Empty", _perkDetail, 11, TextAnchor.UpperLeft, ScreenInkDim);
                empty.text = "Выберите перк в списке.";
                Place_(empty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -40f), new Vector2(-14f, -14f));
                _perkDetailRows.Add(empty.gameObject);
                return;
            }
            string state = stateById[talent.Id];
            int rank = rankById[talent.Id];
            float y = 14f;
            Text kicker = Label("Kicker", _perkDetail, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.72f), FontStyle.Bold);
            kicker.text = talent.Group.ToUpperInvariant() + "     " + PerkStateLabel(state).ToUpperInvariant();
            Place_(kicker.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 12f), new Vector2(-14f, -y));
            _perkDetailRows.Add(kicker.gameObject);
            y += 16f;
            Text title = Label("Title", _perkDetail, 16, TextAnchor.UpperLeft, GoldBright, FontStyle.Bold);
            title.text = PerkGlyph(talent) + "  " + talent.Name;
            Place_(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 20f), new Vector2(-14f, -y));
            _perkDetailRows.Add(title.gameObject);
            y += 26f;

            string[] chips = { "Ранг " + rank + "/" + talent.MaxRank, "Ур. " + talent.Level, PerkStateLabel(state) };
            float cx = 14f;
            foreach (string chip in chips)
            {
                RectTransform box = Panel_(_perkDetail, new Color(0.02f, 0.05f, 0.03f, 1f), new Color(0.494f, 0.784f, 0.357f, 0.24f));
                float width = 14f + chip.Length * 7f;
                box.anchorMin = box.anchorMax = new Vector2(0f, 1f);
                box.pivot = new Vector2(0f, 1f);
                box.anchoredPosition = new Vector2(cx, -y);
                box.sizeDelta = new Vector2(width, 22f);
                Text text = Label("Text", box, 10, TextAnchor.MiddleCenter, new Color(0.682f, 0.867f, 0.545f, 1f), FontStyle.Bold);
                text.text = chip.ToUpperInvariant();
                Stretch(text.rectTransform, 0f);
                _perkDetailRows.Add(box.gameObject);
                cx += width + 6f;
            }
            y += 30f;

            RectTransform next = Panel_(_perkDetail, new Color(0.02f, 0.05f, 0.03f, 1f), new Color(0.494f, 0.784f, 0.357f, 0.24f));
            Place_(next, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 50f), new Vector2(-14f, -y));
            Text nextTitle = Label("NextTitle", next, 11, TextAnchor.UpperLeft, GoldBright, FontStyle.Bold);
            nextTitle.text = rank >= talent.MaxRank ? "Максимальный ранг" : "Следующий ранг " + (rank + 1) + "/" + talent.MaxRank;
            Place_(nextTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -24f), new Vector2(-10f, -8f));
            Text nextNeed = Label("NextNeed", next, 10, TextAnchor.UpperLeft, ScreenInkDim);
            nextNeed.text = rank >= talent.MaxRank ? "Все ранги изучены." : "Нужно: " + Pipboy.RequirementText(talent);
            nextNeed.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(nextNeed.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 6f), new Vector2(-10f, -26f));
            _perkDetailRows.Add(next.gameObject);
            y += 60f;

            Text effectTitle = Label("EffectTitle", _perkDetail, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.7f), FontStyle.Bold);
            effectTitle.text = "ЭФФЕКТ";
            Place_(effectTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 12f), new Vector2(-14f, -y));
            _perkDetailRows.Add(effectTitle.gameObject);
            y += 14f;
            Text effect = Label("Effect", _perkDetail, 11, TextAnchor.UpperLeft, new Color(LimeInk.r, LimeInk.g, LimeInk.b, 0.86f));
            effect.text = talent.Description;
            Place_(effect.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 64f), new Vector2(-14f, -y));
            _perkDetailRows.Add(effect.gameObject);
            y += 70f;

            Text reqTitle = Label("ReqTitle", _perkDetail, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.7f), FontStyle.Bold);
            reqTitle.text = "ТРЕБОВАНИЯ";
            Place_(reqTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 12f), new Vector2(-14f, -y));
            _perkDetailRows.Add(reqTitle.gameObject);
            y += 14f;
            bool met = Pipboy.TalentRequirementsMet(talent);
            Text req = Label("Req", _perkDetail, 11, TextAnchor.UpperLeft, met ? LimeInk : new Color(0.93f, 0.55f, 0.42f, 1f));
            req.text = (met ? "+ " : "× ") + Pipboy.RequirementText(talent);
            Place_(req.rectTransform, 0f, 1f, 1f, 1f, new Vector2(14f, -y - 30f), new Vector2(-14f, -y));
            _perkDetailRows.Add(req.gameObject);

            bool canLearn = state == "ready" && points > 0 && !Pipboy.ProgressionPending;
            Button learn = TextButton("Learn", _perkDetail, rank >= talent.MaxRank ? "Изучен полностью" : state == "locked" ? "Закрыт" : points > 0 ? "Изучить ранг " + (rank + 1) : "Нет очков перков", 12, out Text learnLabel);
            var lrect = (RectTransform)learn.transform;
            lrect.anchorMin = new Vector2(0f, 0f);
            lrect.anchorMax = new Vector2(1f, 0f);
            lrect.pivot = new Vector2(0.5f, 0f);
            lrect.offsetMin = new Vector2(14f, 12f);
            lrect.offsetMax = new Vector2(-14f, 44f);
            learn.GetComponent<Image>().color = canLearn ? new Color(0.16f, 0.28f, 0.12f, 1f) : new Color(BtnBg.r, BtnBg.g, BtnBg.b, 0.6f);
            var loutline = learn.gameObject.AddComponent<Outline>();
            loutline.effectColor = new Color(BtnBorder.r, BtnBorder.g, BtnBorder.b, canLearn ? 0.7f : 0.3f);
            loutline.effectDistance = new Vector2(1f, -1f);
            learnLabel.color = canLearn ? AccentWarm : new Color(BtnInk.r, BtnInk.g, BtnInk.b, 0.45f);
            learnLabel.fontStyle = FontStyle.Bold;
            learn.interactable = canLearn;
            string id = talent.Id;
            int current = rank;
            learn.onClick.AddListener(() => { Pipboy.SubmitTalentUp(id, current); _refreshAt = Time.unscaledTime + 0.3f; });
            _perkDetailRows.Add(learn.gameObject);
        }
    }
}
