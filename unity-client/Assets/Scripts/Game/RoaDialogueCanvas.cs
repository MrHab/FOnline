using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Диалог с NPC и доска работ в структуре web-клиента.
    ///
    /// Диалог (#npc-dialogue-window, 07c_trader_dialogues_quests.js:394):
    /// модальное окно с именем собеседника, репликой и списком вариантов-кнопок:
    /// торговля, поручения с их состоянием и действиями, ограбление каравана
    /// на встречах, «Уйти».
    ///
    /// Доска работ: карточка поселения-владельца с кнопкой вступления во
    /// фракцию и список работ пустоши с действиями Взять / Отслеживать /
    /// Доставить / Забрать награду / Отменить.
    ///
    /// Логика и серверные запросы остаются в RoaInteraction; это окно только рисует.
    /// </summary>
    public sealed class RoaDialogueCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.075f, 0.071f, 0.055f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color InkDim = new Color(0.937f, 0.867f, 0.678f, 0.55f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color RowBg = new Color(0.13f, 0.12f, 0.09f, 0.9f);
        private static readonly Color OptionBg = new Color(0.16f, 0.28f, 0.12f, 0.95f);

        public RoaInteraction Interaction;

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _panel;
        private Text _title;
        private Text _line;
        private Text _status;
        private RectTransform _list;
        private readonly List<GameObject> _rows = new List<GameObject>();
        private float _refreshAt;
        private bool _boardMode;

        private void Update()
        {
            bool open = Interaction != null && (Interaction.NpcOpen || Interaction.JobBoardOpen);

            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }

            EnsureBuilt();
            bool board = Interaction.JobBoardOpen;
            if (!_root.activeSelf || board != _boardMode)
            {
                _boardMode = board;
                _panel.sizeDelta = board ? new Vector2(820f, 680f) : new Vector2(680f, 560f);
                _root.SetActive(true);
                _refreshAt = 0f;
            }

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.35f;
                Refresh();
            }
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("DialogueCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 42;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            _root = new GameObject("DialogueWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            rootRect.anchorMin = Vector2.zero;
            rootRect.anchorMax = Vector2.one;
            rootRect.offsetMin = Vector2.zero;
            rootRect.offsetMax = Vector2.zero;
            var dim = _root.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.4f);

            _panel = Child("Panel", rootRect);
            _panel.anchorMin = _panel.anchorMax = new Vector2(0.5f, 0.5f);
            _panel.pivot = new Vector2(0.5f, 0.5f);
            _panel.sizeDelta = new Vector2(680f, 560f);
            var back = _panel.gameObject.AddComponent<Image>();
            back.color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", _panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -44f), new Vector2(-56f, -8f));

            Button close = TextButton("Close", _panel, "×", 24, out Text closeText);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-8f, -8f);
            closeRect.sizeDelta = new Vector2(36f, 32f);
            closeText.color = Accent;
            close.onClick.AddListener(() => Interaction.DialogueClose());

            // Реплика — как #npc-dialogue-line: крупнее и курсивом.
            _line = Label("Line", _panel, 15, TextAnchor.UpperLeft, Ink, FontStyle.Italic);
            Place(_line.rectTransform, 0f, 1f, 1f, 1f, new Vector2(18f, -150f), new Vector2(-18f, -50f));
            _line.horizontalOverflow = HorizontalWrapMode.Wrap;
            _line.verticalOverflow = VerticalWrapMode.Truncate;

            // Варианты — как #npc-dialogue-options.
            RectTransform scrollArea = Child("Scroll", _panel);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(14f, 34f), new Vector2(-14f, -156f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scrollArea.gameObject.AddComponent<RectMask2D>();

            _list = Child("List", scrollArea);
            _list.anchorMin = new Vector2(0f, 1f);
            _list.anchorMax = new Vector2(1f, 1f);
            _list.pivot = new Vector2(0f, 1f);
            _list.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            var layout = _list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 4f;
            layout.padding = new RectOffset(4, 4, 4, 4);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            var fitter = _list.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _list;

            _status = Label("Status", _panel, 12, TextAnchor.MiddleCenter, InkDim);
            Place(_status.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 6f), new Vector2(-16f, 30f));

            _root.SetActive(false);
        }

        // ------------------------------------------------------------------

        private void Refresh()
        {
            _title.text = Interaction.DialogueTitle;
            _status.text = Interaction.DialogueStatus;

            foreach (GameObject row in _rows) Destroy(row);
            _rows.Clear();

            if (_boardMode) RefreshBoard();
            else RefreshNpc();

            // Ширина рядов известна только после пересчёта LayoutGroup; без
            // этого перенос строк (Wrap) в свежесозданных карточках не
            // срабатывает и описания уезжают за край.
            LayoutRebuilder.ForceRebuildLayoutImmediate(_list);
        }

        private void RefreshNpc()
        {
            string personality = Interaction.NpcPersonality;
            _line.text = "«" + Interaction.NpcSpeech + "»"
                + (string.IsNullOrEmpty(personality) ? string.Empty : "\n\nХарактер: " + personality);

            if (Interaction.NpcHasTradeOption)
                AddOption("Показать товары", () => Interaction.NpcRequestTrade());
            if (Interaction.NpcCanRob)
                AddOption("Ограбить караван", () => Interaction.NpcRob());

            List<RoaInteraction.QuestOption> quests = Interaction.NpcQuests();
            if (quests.Count > 0)
            {
                AddHeading("ПОРУЧЕНИЯ");
                foreach (RoaInteraction.QuestOption quest in quests)
                {
                    string id = quest.Id;
                    var actions = new List<(string, System.Action)>();
                    if (quest.State == "available")
                        actions.Add(("Принять", () => Interaction.NpcQuestAction(id, "accept")));
                    if (quest.State == "active")
                    {
                        actions.Add(("Сдать", () => Interaction.NpcQuestAction(id, "complete")));
                        actions.Add(("Договориться", () => Interaction.NpcQuestAction(id, "negotiate")));
                        actions.Add(("Отказаться", () => Interaction.NpcQuestAction(id, "cancel")));
                    }
                    AddCard(quest.Name + "  [" + quest.StateLabel + "]", quest.Description, actions);
                }
            }

            AddOption("Уйти", () => Interaction.DialogueClose(), true);
        }

        private void RefreshBoard()
        {
            RoaInteraction.JobBoardSiteInfo site = Interaction.JobBoardSite();
            _line.text = site.Name + "\nВладелец: " + site.OwnerLabel
                + (site.IsMember ? " · вы состоите во фракции" : string.Empty);

            if (Interaction.JobBoardLoading)
            {
                AddCard("Получаем актуальные работы…", string.Empty, null);
                return;
            }

            if (site.Joinable && !site.IsMember)
                AddOption(site.JoinLabel, () => Interaction.JobBoardJoinOwner());

            AddHeading("РАБОТЫ ПУСТОШИ");
            List<RoaInteraction.JobBoardTask> tasks = Interaction.JobBoardTasks();
            if (tasks.Count == 0) AddCard("У этой доски сейчас нет работ", string.Empty, null);

            foreach (RoaInteraction.JobBoardTask task in tasks)
            {
                RoaInteraction.JobBoardTask captured = task;
                var actions = new List<(string, System.Action)>();
                if (task.Status == "active" && !task.Accepted)
                    actions.Add(("Взять", () => Interaction.JobBoardAction(captured, "accept")));
                if (task.Status == "active" && task.Accepted)
                {
                    actions.Add((task.Tracked ? "Снять метку" : "Отслеживать", () => Interaction.JobBoardAction(captured, "track")));
                    if (task.Type == "deliver_supplies")
                        actions.Add(("Доставить", () => Interaction.JobBoardAction(captured, "deliver")));
                    actions.Add(("Отменить", () => Interaction.JobBoardAction(captured, "cancel")));
                }
                if (task.Status == "completed" && !task.Claimed && task.RewardEligible)
                    actions.Add(("Забрать награду", () => Interaction.JobBoardAction(captured, "claim")));

                string body = task.Text + "\n" + task.RewardText
                    + (task.SlotsLeft >= 0 ? " · мест в группе: " + task.SlotsLeft : string.Empty)
                    + (task.Status == "completed" && task.Claimed ? "\nНаграда уже получена." : string.Empty)
                    + (task.Status == "completed" && !task.RewardEligible ? "\nРабота завершена; участие не подтверждено." : string.Empty);

                AddCard((task.Tracked ? "★ " : string.Empty) + task.Title, body.Trim(), actions);
            }

            AddOption(Interaction.JobBoardRefreshing ? "Обновление…" : "Обновить список",
                () => Interaction.JobBoardRefresh(), true);
        }

        // ------------------------------------------------------------------

        private void AddHeading(string caption)
        {
            var row = new GameObject("Heading", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 24f;
            Text text = Label("Text", (RectTransform)row.transform, 12, TextAnchor.LowerLeft, InkDim, FontStyle.Bold);
            Stretch(text.rectTransform, 4f);
            text.text = caption;
            _rows.Add(row);
        }

        /// <summary>Вариант ответа — полная строка-кнопка, как .npc-dialogue-option.</summary>
        private void AddOption(string caption, System.Action onClick, bool secondary = false)
        {
            var row = new GameObject("Option", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 36f;
            var back = row.AddComponent<Image>();
            back.color = secondary ? RowBg : OptionBg;
            var button = row.AddComponent<Button>();
            button.targetGraphic = back;
            Text text = Label("Text", (RectTransform)row.transform, 14, TextAnchor.MiddleLeft,
                secondary ? Ink : Accent, FontStyle.Bold);
            Place(text.rectTransform, 0f, 0f, 1f, 1f, new Vector2(12f, 0f), new Vector2(-12f, 0f));
            text.text = "▸ " + caption;
            button.onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.4f; });
            _rows.Add(row);
        }

        private void AddCard(string title, string body, List<(string, System.Action)> actions)
        {
            // Оценка высоты с учётом переноса: ~85 символов в строке при ширине карточки и шрифте 11.
            int lines = 1;
            if (!string.IsNullOrEmpty(body))
                foreach (string segment in body.Split('\n'))
                    lines += Mathf.Max(1, Mathf.CeilToInt(segment.Length / 85f));
            float height = 26f + lines * 16f + (actions != null && actions.Count > 0 ? 32f : 4f);

            var row = new GameObject("Card", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = height;
            row.AddComponent<Image>().color = RowBg;

            Text head = Label("Title", (RectTransform)row.transform, 14, TextAnchor.UpperLeft, Ink, FontStyle.Bold);
            Place(head.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -24f), new Vector2(-8f, -4f));
            head.text = title;

            if (!string.IsNullOrEmpty(body))
            {
                Text text = Label("Body", (RectTransform)row.transform, 12, TextAnchor.UpperLeft, InkDim);
                Place(text.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -26f - lines * 16f), new Vector2(-8f, -26f));
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.text = body;
            }

            if (actions != null)
            {
                float x = 8f;
                foreach ((string caption, System.Action onClick) in actions)
                {
                    Button button = TextButton("Action", (RectTransform)row.transform, caption, 12, out Text label);
                    var rect = (RectTransform)button.transform;
                    rect.anchorMin = rect.anchorMax = Vector2.zero;
                    rect.pivot = Vector2.zero;
                    float width = Mathf.Max(96f, caption.Length * 8f + 24f);
                    rect.anchoredPosition = new Vector2(x, 5f);
                    rect.sizeDelta = new Vector2(width, 24f);
                    x += width + 6f;
                    button.GetComponent<Image>().color = OptionBg;
                    label.color = Accent;
                    System.Action act = onClick;
                    button.onClick.AddListener(() => { act(); _refreshAt = Time.unscaledTime + 0.4f; });
                }
            }

            _rows.Add(row);
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
        }

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY,
                                  Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor,
                                  Color color, FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Child(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = size;
            text.alignment = anchor;
            text.color = color;
            text.fontStyle = style;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }

        private static Button TextButton(string name, RectTransform parent, string caption, int size, out Text label)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.3f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Ink);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            return button;
        }
    }
}
