using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Окно станка (E у верстака, PanelKind.Crafting): участок поселения с
    /// арендой и торгами, фокус премиума и рецепты этого станка.
    ///
    /// Карточки участка и фокуса строятся один раз: в них живут поля ввода, и
    /// пересборка по таймеру сбрасывала бы набранную ставку. Карточки рецептов
    /// пересобираются только при смене станка, а между этим обновляют текст.
    ///
    /// Логика и серверные запросы — в RoaInteraction; это окно только рисует.
    /// </summary>
    public sealed class RoaCraftingCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.075f, 0.071f, 0.055f, 0.97f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color InkDim = new Color(0.937f, 0.867f, 0.678f, 0.62f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color CardBg = new Color(0.13f, 0.12f, 0.09f, 0.9f);
        private static readonly Color ActionBg = new Color(0.16f, 0.28f, 0.12f, 0.95f);
        private static readonly Color ActionOffBg = new Color(0.12f, 0.12f, 0.10f, 0.9f);
        private static readonly Color FieldBg = new Color(0f, 0f, 0f, 0.45f);

        public const float PanelWidth = 640f;
        public const float PanelMaxHeight = 640f;

        public RoaInteraction Interaction;

        private sealed class RecipeCard
        {
            public RoaCraftRecipe Recipe;
            public Text Cost;
            public Text Focus;
            public Text Missing;
            public Button Craft;
            public Text CraftLabel;
        }

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _panel;
        private RectTransform _list;
        private Text _title;
        private Text _status;

        private GameObject _plotCard;
        private Text _plotHead;
        private Text _plotLease;
        private Text _plotAuction;
        private Text _bidHint;
        private GameObject _feeRow;
        private InputField _feeInput;
        private Button _feeButton;

        private GameObject _focusCard;
        private GameObject _focusToggleRow;
        private GameObject _focusMark;
        private Text _focusToggleLabel;
        private Text _focusText;

        private Text _note;
        private Text _empty;
        private readonly List<RecipeCard> _cards = new List<RecipeCard>();
        private string _builtStation;
        // Поле заполняется значением по умолчанию один раз за открытие: пустую
        // строку игрок стёр сам, и её не нужно тут же заполнять заново.
        private bool _feeDefaulted;
        private float _refreshAt;

        private void Update()
        {
            // Панель количества у станка не открывается, но условие то же, что
            // было у окна: выбор количества всегда поверх и без соседей.
            bool open = Interaction != null && Interaction.CraftingOpen && !Interaction.QuantityOpen;
            if (!open)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                return;
            }

            EnsureBuilt();
            if (!_root.activeSelf)
            {
                _root.SetActive(true);
                _feeDefaulted = false;
                _feeInput.text = string.Empty;
                _builtStation = null;
                _refreshAt = 0f;
            }

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.3f;
                Refresh();
            }
            // Доступность кнопок зависит от набранного числа — без задержки.
            RefreshPlotButtons(Interaction.CraftingPlot);
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("CraftingCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 42;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("CraftingWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);
            var dim = _root.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.46f);

            _panel = Child("Panel", rootRect);
            _panel.anchorMin = _panel.anchorMax = new Vector2(0.5f, 0.5f);
            _panel.pivot = new Vector2(0.5f, 0.5f);
            _panel.sizeDelta = new Vector2(PanelWidth, PanelMaxHeight);
            var back = _panel.gameObject.AddComponent<Image>();
            back.color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", _panel, 20, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(16f, -44f), new Vector2(-56f, -8f));

            Button close = TextButton("Close", _panel, "×", 24, out _);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-8f, -8f);
            closeRect.sizeDelta = new Vector2(36f, 32f);
            close.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.3f);
            close.onClick.AddListener(() => Interaction.CraftingClose());

            RectTransform scrollArea = Child("Scroll", _panel);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(12f, 34f), new Vector2(-12f, -50f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scrollArea.gameObject.AddComponent<RectMask2D>();

            _list = Child("List", scrollArea);
            _list.anchorMin = new Vector2(0f, 1f);
            _list.anchorMax = new Vector2(1f, 1f);
            _list.pivot = new Vector2(0f, 1f);
            _list.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            Column(_list.gameObject, 6f, new RectOffset(4, 4, 4, 4));
            var fitter = _list.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _list;

            BuildPlotCard();
            BuildFocusCard();
            _note = Body("Note", _list, InkDim);
            _empty = Body("Empty", _list, Ink);
            _empty.text = "Для этого станка рецепты не найдены.";

            _status = Label("Status", _panel, 12, TextAnchor.MiddleCenter, InkDim);
            Place(_status.rectTransform, 0f, 0f, 1f, 0f, new Vector2(16f, 6f), new Vector2(-16f, 28f));

            _root.SetActive(false);
        }

        /// <summary>Участок станка: арендатор, плата, торги за аренду.</summary>
        private void BuildPlotCard()
        {
            RectTransform card = Card("Plot", _list);
            _plotCard = card.gameObject;
            _plotHead = Body("Head", card, Ink);
            _plotHead.supportRichText = true;
            _plotLease = Body("Lease", card, Ink);
            _plotAuction = Body("Auction", card, Ink);

            _bidHint = Body("BidHint", card, InkDim);

            RectTransform feeRow = FieldRow("FeeRow", card, "Плата, %:", 3, 70f, "Назначить плату",
                out _feeInput, out _feeButton);
            _feeRow = feeRow.gameObject;
            _feeButton.onClick.AddListener(() =>
            {
                if (int.TryParse(_feeInput.text, out int percent)) Interaction.PlotSetFee(percent);
                _refreshAt = Time.unscaledTime + 0.4f;
            });
        }

        /// <summary>
        /// Фокус премиума у станка участка: переключатель «тратить фокус» и
        /// остаток — заказ с фокусом возвращает больше материалов.
        /// </summary>
        private void BuildFocusCard()
        {
            RectTransform card = Card("Focus", _list);
            _focusCard = card.gameObject;

            // Кнопка с галочкой, а не Toggle: тот шлёт onValueChanged и при
            // собственной пересборке, а настройка пишется в PlayerPrefs.
            RectTransform row = Child("ToggleRow", card);
            _focusToggleRow = row.gameObject;
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = 26f;
            var rowHit = row.gameObject.AddComponent<Image>();
            rowHit.color = Color.clear;
            var toggle = row.gameObject.AddComponent<Button>();
            toggle.transition = Selectable.Transition.None;
            RectTransform box = Child("Box", row);
            box.anchorMin = box.anchorMax = new Vector2(0f, 0.5f);
            box.pivot = new Vector2(0f, 0.5f);
            box.anchoredPosition = Vector2.zero;
            box.sizeDelta = new Vector2(20f, 20f);
            var boxImage = box.gameObject.AddComponent<Image>();
            boxImage.color = FieldBg;
            boxImage.raycastTarget = false;
            var boxOutline = box.gameObject.AddComponent<Outline>();
            boxOutline.effectColor = PanelBorder;
            boxOutline.effectDistance = new Vector2(1f, -1f);
            RectTransform mark = Child("Mark", box);
            Stretch(mark, 4f);
            var markImage = mark.gameObject.AddComponent<Image>();
            markImage.color = Accent;
            markImage.raycastTarget = false;
            _focusMark = mark.gameObject;
            _focusToggleLabel = Label("Label", row, 13, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(_focusToggleLabel.rectTransform, 0f, 0f, 1f, 1f, new Vector2(30f, 0f), Vector2.zero);
            toggle.onClick.AddListener(() =>
            {
                RoaCraftingPlots.UseFocus = !RoaCraftingPlots.UseFocus;
                _refreshAt = 0f;
            });

            _focusText = Body("Text", card, InkDim);
        }

        // ------------------------------------------------------------------

        private void Refresh()
        {
            FitPanel();
            _title.text = Interaction.CraftingTitle;
            _status.text = Interaction.CraftingStatus;

            JObject plot = Interaction.CraftingPlot;
            JObject account = Interaction.CraftingAccount;
            RefreshPlot(plot);
            RefreshFocus(plot, account);
            _note.text = plot != null
                ? "Состав рюкзака и результат повторно проверяет сервер. Комиссия уходит арендатору участка; свободный участок берёт плату поселения."
                : "Состав рюкзака и результат повторно проверяет сервер. Комиссия поступает владельцу мастерской.";

            string station = Interaction.CraftingStation;
            if (station != _builtStation) BuildRecipes(station);
            foreach (RecipeCard card in _cards) RefreshRecipe(card, plot, account);

            // Ширина карточек известна только после пересчёта LayoutGroup; без
            // этого перенос строк в свежесозданных карточках не срабатывает.
            LayoutRebuilder.ForceRebuildLayoutImmediate(_list);
        }

        /// <summary>Окно не выше экрана: на низких экранах список просто короче.</summary>
        private void FitPanel()
        {
            var canvasRect = (RectTransform)_canvas.transform;
            float height = Mathf.Min(PanelMaxHeight, canvasRect.rect.height - 24f);
            if (!Mathf.Approximately(_panel.sizeDelta.y, height))
                _panel.sizeDelta = new Vector2(PanelWidth, height);
        }

        private void RefreshPlot(JObject plot)
        {
            _plotCard.SetActive(plot != null);
            if (plot == null) return;

            bool leased = plot["leased"]?.ToObject<bool>() == true;
            bool mine = plot["mine"]?.ToObject<bool>() == true;
            double feePct = plot["feePct"]?.ToObject<double>() ?? 0d;
            double returnRate = plot["returnRate"]?.ToObject<double>() ?? 0d;
            JObject auction = plot["auction"] as JObject;

            _plotHead.text = "<b>Участок поселения</b> · возврат материалов " + Mathf.RoundToInt((float)(returnRate * 100d)) + "%";
            _plotLease.text = leased
                ? "Арендатор: " + (mine ? "вы" : plot["lesseeName"]?.ToString()) + " · до "
                    + PlotTime(plot["leaseEndsAt"]) + " · плата " + Percent(feePct) + " стоимости изделия"
                    + (mine ? " (сами работаете бесплатно)" : string.Empty)
                : "Участок свободен · плата поселения " + Percent(feePct) + " стоимости изделия, она сгорает.";

            // За участок торгуются у его таблички; здесь — только состояние торгов.
            bool open = auction?["open"]?.ToObject<bool>() == true;
            int highest = auction?["highestBid"]?.ToObject<int>() ?? 0;
            int minBid = auction?["minBid"]?.ToObject<int>() ?? 0;
            _plotAuction.gameObject.SetActive(open);
            if (open)
            {
                string leader = auction?["leading"]?.ToObject<bool>() == true ? "ваша" : auction?["bidderName"]?.ToString();
                _plotAuction.text = highest > 0
                    ? "Торги за участок идут: ставка " + RoaPlural.Marks(highest) + " (" + leader + ") · до " + PlotTime(auction["endsAt"])
                    : "Торги за участок открыты: первая ставка от " + RoaPlural.Marks(minBid) + ", торги длятся сутки.";
            }
            _bidHint.text = open
                ? "Ставку делают у таблички участка."
                : "Торги за участок откроются за сутки до конца срока.";

            _feeRow.SetActive(mine);
            if (mine && !_feeDefaulted)
            {
                _feeDefaulted = true;
                _feeInput.text = Mathf.RoundToInt((float)(feePct * 100d)).ToString();
            }
        }

        private void RefreshPlotButtons(JObject plot)
        {
            if (plot == null || _plotCard == null || !_plotCard.activeSelf) return;
            bool pending = Interaction.PlotPending;
            if (_feeRow.activeSelf)
            {
                double maxFee = plot["maxFeePct"]?.ToObject<double>() ?? 0d;
                SetEnabled(_feeButton, !pending && int.TryParse(_feeInput.text, out int pct)
                    && pct >= 0 && pct <= Mathf.RoundToInt((float)(maxFee * 100d)));
            }
        }

        private void RefreshFocus(JObject plot, JObject account)
        {
            _focusCard.SetActive(plot != null);
            if (plot == null) return;

            bool premium = RoaCraftingPlots.Premium(account);
            _focusToggleRow.SetActive(premium);
            if (premium)
            {
                double focusRate = plot["focusReturnRate"]?.ToObject<double>() ?? 0d;
                _focusToggleLabel.text = "Тратить фокус: возврат материалов " + Mathf.RoundToInt((float)(focusRate * 100d)) + "%";
                _focusMark.SetActive(RoaCraftingPlots.UseFocus);
                _focusText.text = "Фокус: " + RoaCraftingPlots.FocusText(account) + " · копится, пока действует премиум.";
            }
            else
            {
                _focusText.text = "Фокус — только с премиумом: заказ с фокусом возвращает больше материалов.";
            }
        }

        private void BuildRecipes(string station)
        {
            foreach (RecipeCard card in _cards)
                if (card.Craft != null) Destroy(card.Craft.transform.parent.gameObject);
            _cards.Clear();
            _builtStation = station;

            foreach (RoaCraftRecipe recipe in RoaCraftingData.Recipes)
            {
                if (recipe.Station != station) continue;
                RectTransform rect = Card("Recipe:" + recipe.Id, _list);
                var card = new RecipeCard { Recipe = recipe };

                Text head = Body("Head", rect, Ink);
                head.supportRichText = true;
                head.text = "<b>" + recipe.Name + "</b>  → " + RoaItemData.Name(recipe.OutputId) + " x" + recipe.OutputQty;
                card.Cost = Body("Cost", rect, InkDim);
                card.Focus = Body("Focus", rect, InkDim);

                card.Craft = TextButton("Craft", rect, "Создать", 13, out card.CraftLabel);
                card.Craft.gameObject.AddComponent<LayoutElement>().preferredHeight = 30f;
                card.CraftLabel.fontStyle = FontStyle.Bold;
                RoaCraftRecipe captured = recipe;
                card.Craft.onClick.AddListener(() =>
                {
                    Interaction.CraftRecipe(captured);
                    _refreshAt = 0f;
                });

                card.Missing = Body("Missing", rect, InkDim);
                card.Missing.text = "Не хватает материалов или марок.";
                _cards.Add(card);
            }
            _empty.gameObject.SetActive(_cards.Count == 0);
            _empty.transform.SetAsLastSibling();
        }

        private void RefreshRecipe(RecipeCard card, JObject plot, JObject account)
        {
            RoaCraftRecipe recipe = card.Recipe;
            bool available = Interaction.CanCraft(recipe);
            bool pending = Interaction.CraftPending;

            card.Cost.text = "Материалы: " + RoaInteraction.CraftCost(recipe) + " · комиссия: " + RoaPlural.Marks(recipe.Fee)
                + (recipe.WorkSeconds > 0 ? " · работа: " + recipe.WorkSeconds + " с" : string.Empty);

            bool focus = plot != null && RoaCraftingPlots.WantsFocus(recipe, account);
            card.Focus.gameObject.SetActive(focus);
            if (focus)
            {
                int focusCost = RoaCraftingPlots.FocusCostFor(recipe, account);
                card.Focus.text = "Фокус на заказ: " + focusCost
                    + (RoaCraftingPlots.Focus(account) >= focusCost ? string.Empty : " — не хватает, заказ пройдёт без фокуса");
            }

            card.CraftLabel.text = pending ? "Станок занят…" : "Создать";
            SetEnabled(card.Craft, available && !pending);
            card.Missing.gameObject.SetActive(!available);
        }

        private static void SetEnabled(Button button, bool enabled)
        {
            if (button.interactable == enabled) return;
            button.interactable = enabled;
            button.GetComponent<Image>().color = enabled ? ActionBg : ActionOffBg;
            Text label = button.GetComponentInChildren<Text>();
            if (label != null) label.color = enabled ? Accent : InkDim;
        }

        private static string Percent(double share)
        {
            return (share * 100d).ToString("0.#") + "%";
        }

        private static string PlotTime(JToken value)
        {
            long ms = value?.Type == JTokenType.Integer || value?.Type == JTokenType.Float ? value.Value<long>() : 0L;
            if (ms <= 0) return "—";
            return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("dd.MM HH:mm");
        }

        // ------------------------------------------------------------------

        private static RectTransform Card(string name, RectTransform parent)
        {
            RectTransform card = Child(name, parent);
            card.gameObject.AddComponent<Image>().color = CardBg;
            Column(card.gameObject, 4f, new RectOffset(10, 10, 8, 8));
            return card;
        }

        /// <summary>
        /// Вертикальная раскладка с явными флагами: в редакторе AddComponent
        /// сбрасывает их в false, и карточки выходят шириной 100.
        /// </summary>
        private static void Column(GameObject go, float spacing, RectOffset padding)
        {
            var layout = go.AddComponent<VerticalLayoutGroup>();
            layout.spacing = spacing;
            layout.padding = padding;
            layout.childAlignment = TextAnchor.UpperLeft;
            layout.childControlWidth = true;
            layout.childControlHeight = true;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = false;
        }

        /// <summary>Строка «подпись — поле — кнопка»: ставка и плата арендатора.</summary>
        private static RectTransform FieldRow(string name, RectTransform parent, string caption, int characterLimit,
                                              float fieldWidth, string action, out InputField field, out Button button)
        {
            RectTransform row = Child(name, parent);
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = 30f;

            Text label = Label("Label", row, 13, TextAnchor.MiddleLeft, Ink);
            label.text = caption;
            Fixed(label.rectTransform, 0f, 80f);

            var fieldGo = new GameObject("Field", typeof(RectTransform));
            var fieldRect = (RectTransform)fieldGo.transform;
            fieldRect.SetParent(row, false);
            Fixed(fieldRect, 84f, fieldWidth);
            fieldGo.AddComponent<Image>().color = FieldBg;
            var fieldOutline = fieldGo.AddComponent<Outline>();
            fieldOutline.effectColor = PanelBorder;
            fieldOutline.effectDistance = new Vector2(1f, -1f);
            field = fieldGo.AddComponent<InputField>();
            Text text = Label("Text", fieldRect, 14, TextAnchor.MiddleLeft, Accent);
            Stretch(text.rectTransform, 6f);
            text.supportRichText = false;
            field.textComponent = text;
            field.characterLimit = characterLimit;
            field.contentType = InputField.ContentType.IntegerNumber;

            button = TextButton("Action", row, action, 13, out Text actionLabel);
            Fixed((RectTransform)button.transform, 84f + fieldWidth + 8f, 160f);
            button.GetComponent<Image>().color = ActionBg;
            actionLabel.color = Accent;
            actionLabel.fontStyle = FontStyle.Bold;
            return row;
        }

        /// <summary>Элемент строки: от левого края на всю высоту, заданной ширины.</summary>
        private static void Fixed(RectTransform rect, float left, float width)
        {
            rect.anchorMin = new Vector2(0f, 0f);
            rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 0.5f);
            rect.anchoredPosition = new Vector2(left, 0f);
            rect.sizeDelta = new Vector2(width, 0f);
        }

        /// <summary>Абзац внутри карточки: переносится по ширине, высоту берёт раскладка.</summary>
        private static Text Body(string name, RectTransform parent, Color color)
        {
            Text text = Label(name, parent, 12, TextAnchor.UpperLeft, color);
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.supportRichText = false;
            return text;
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
            text.font = RoaUiFont.Default;
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
            image.color = ActionBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Accent);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            return button;
        }
    }
}
