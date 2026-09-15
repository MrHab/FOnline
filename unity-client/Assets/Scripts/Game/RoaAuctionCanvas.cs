using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Экран аукциона Сердцевины: открывается взаимодействием с аукционером и
    /// заменяет собой диалог, поэтому вариантов ответа у аукционера нет.
    ///
    /// Слева — разделы (ТОРГИ, МОИ ЛОТЫ, ВЫСТАВИТЬ, ПОЛКА) и категории товаров
    /// со счётчиками, в центре — лоты, справа — карточка выбранного лота со
    /// ставкой и выкупом либо форма выставления. Все проверки серверные:
    /// экран только показывает снимок `auctionAction:state` и отправляет
    /// действия, а цифры срока идут от последнего снимка, чтобы таймер шёл
    /// между обновлениями.
    /// </summary>
    public sealed class RoaAuctionCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.075f, 0.071f, 0.055f, 0.985f);
        private static readonly Color PanelBorder = new Color(0.82f, 0.694f, 0.404f, 0.58f);
        private static readonly Color Ink = new Color(0.937f, 0.867f, 0.678f, 1f);
        private static readonly Color InkDim = new Color(0.937f, 0.867f, 0.678f, 0.55f);
        private static readonly Color Accent = new Color(1f, 0.82f, 0.42f, 1f);
        private static readonly Color Good = new Color(0.62f, 0.78f, 0.42f, 1f);
        private static readonly Color Warn = new Color(0.86f, 0.44f, 0.33f, 1f);
        private static readonly Color RowBg = new Color(0.13f, 0.12f, 0.09f, 0.9f);
        private static readonly Color RowSelected = new Color(0.2f, 0.19f, 0.11f, 0.98f);
        private static readonly Color ButtonBg = new Color(0.16f, 0.28f, 0.12f, 0.95f);
        private static readonly Color QuietBg = new Color(0f, 0f, 0f, 0.35f);

        private enum Tab { Trade, Mine, Sell, Shelf }

        public RoaInteraction Interaction;

        private static RoaAuctionCanvas _instance;

        private GameObject _root;
        private RectTransform _panel;
        private Text _title;
        private Text _terms;
        private Text _status;
        private RectTransform _tabsColumn;
        private RectTransform _categoryColumn;
        private RectTransform _list;
        private RectTransform _detail;
        private RectTransform _sellForm;
        private InputField _bidInput;
        private InputField _qtyInput;
        private InputField _startInput;
        private InputField _buyoutInput;

        private readonly List<GameObject> _rows = new List<GameObject>();
        private readonly List<GameObject> _detailRows = new List<GameObject>();
        private readonly List<GameObject> _categoryRows = new List<GameObject>();
        private readonly List<(Text label, long deadline)> _timers = new List<(Text, long)>();

        private JObject _state;
        private bool _pending;
        private string _note = string.Empty;
        private float _refreshAt;
        private float _clockAt;
        private long _snapshotAt;
        private Tab _tab = Tab.Trade;
        private string _category = "all";
        private string _selectedLotId = string.Empty;
        private string _sellItemId = string.Empty;
        private int _sellHours;
        private float _detailCursor;
        private int _detailButtons;

        /// <summary>
        /// Создаёт экран рядом с диалогом при первом разговоре с аукционером.
        /// Отдельная сборка сцены не нужна: экран живёт на том же объекте.
        /// </summary>
        public static RoaAuctionCanvas Ensure(RoaInteraction interaction, GameObject host)
        {
            if (_instance == null && host != null)
            {
                RoaAuctionCanvas existing = host.GetComponent<RoaAuctionCanvas>();
                _instance = existing != null ? existing : host.AddComponent<RoaAuctionCanvas>();
            }
            if (_instance != null) _instance.Interaction = interaction;
            return _instance;
        }

        /// <summary>Аукционер ведёт свой экран: диалог в это время не рисуется.</summary>
        public static bool ServesAuctioneer(RoaInteraction interaction)
        {
            return interaction != null && interaction.NpcOpen && interaction.NpcService == "auction";
        }

        private void Update()
        {
            if (!ServesAuctioneer(Interaction))
            {
                if (_root != null && _root.activeSelf)
                {
                    _root.SetActive(false);
                    _state = null;
                    _note = string.Empty;
                    _selectedLotId = string.Empty;
                }
                return;
            }

            EnsureBuilt();
            if (!_root.activeSelf)
            {
                _root.SetActive(true);
                _tab = Tab.Trade;
                _category = "all";
                _refreshAt = 0f;
            }

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 6f;
                RequestState();
            }

            if (Time.unscaledTime >= _clockAt)
            {
                _clockAt = Time.unscaledTime + 0.5f;
                TickTimers();
            }

            if (Input.GetKeyDown(KeyCode.Escape)) Close();
        }

        private void Close()
        {
            if (Interaction != null) Interaction.DialogueClose();
            if (_root != null) _root.SetActive(false);
        }

        // ------------------------------------------------------------------
        // Сеть

        private void RequestState()
        {
            if (Interaction == null || Interaction.Socket == null) return;
            _pending = true;
            bool sent = RoaAuctionNet.RequestState(Interaction.Socket, ack =>
            {
                _pending = false;
                if (ack != null && ack["ok"]?.Value<bool>() == true) Apply(ack);
                else _note = ack?["error"]?.ToString() ?? "Аукционер не ответил.";
                Rebuild();
            });
            if (!sent) { _pending = false; _note = "Нет связи с сервером."; }
        }

        private void AfterAction(JObject ack)
        {
            if (ack != null && ack["ok"]?.Value<bool>() == true)
            {
                _note = ActionNote(ack);
                Apply(ack);
            }
            else _note = ack?["error"]?.ToString() ?? "Аукционер отклонил действие.";
            _refreshAt = Time.unscaledTime + 6f;
            Rebuild();
        }

        private static string ActionNote(JObject ack)
        {
            string action = ack["action"]?.ToString() ?? string.Empty;
            switch (action)
            {
                case "list": return "Лот выставлен.";
                case "bid":
                    return "Ставка принята: " + (ack["amount"]?.Value<int>() ?? 0) + " марок."
                        + (ack["extended"]?.Value<bool>() == true ? " Торги продлены." : string.Empty);
                case "buyout":
                    return "Выкуплено за " + (ack["price"]?.Value<int>() ?? 0) + " марок.";
                case "cancel": return "Лот снят, предметы ждут на полке.";
                case "claim": return "Полка забрана.";
                default: return string.Empty;
            }
        }

        private void Apply(JObject ack)
        {
            JObject auction = ack["auction"] as JObject;
            if (auction == null) return;
            _state = auction;
            _snapshotAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_sellHours <= 0)
            {
                JArray choices = auction["durationChoicesHours"] as JArray;
                int fallback = auction["listingLifetimeHours"]?.Value<int>() ?? 24;
                _sellHours = choices != null && choices.Count > 0 ? choices[choices.Count - 1].Value<int>() : fallback;
            }
        }

        // ------------------------------------------------------------------
        // Данные снимка

        private JArray Listings { get { return _state?["listings"] as JArray ?? new JArray(); } }

        private float TaxPct { get { return _state?["taxPct"]?.Value<float>() ?? 0.05f; } }

        private JObject Shelf { get { return _state?["shelf"] as JObject; } }

        private int Marks
        {
            get
            {
                RoaInventory inventory = FindObjectOfType<RoaInventory>();
                return inventory != null ? inventory.CountOf("silver") : 0;
            }
        }

        private List<JObject> VisibleLots()
        {
            var rows = new List<JObject>();
            foreach (JToken token in Listings)
            {
                JObject lot = token as JObject;
                if (lot == null) continue;
                bool mine = lot["mine"]?.Value<bool>() == true;
                if (_tab == Tab.Mine && !mine) continue;
                if (_tab == Tab.Trade && mine) continue;
                if (_tab == Tab.Trade && _category != "all" && (lot["category"]?.ToString() ?? "misc") != _category) continue;
                rows.Add(lot);
            }
            return rows;
        }

        private JObject SelectedLot()
        {
            if (string.IsNullOrEmpty(_selectedLotId)) return null;
            foreach (JToken token in Listings)
            {
                JObject lot = token as JObject;
                if (lot != null && lot["id"]?.ToString() == _selectedLotId) return lot;
            }
            return null;
        }

        /// <summary>Остаток срока на момент снимка, доигранный локальными часами.</summary>
        private long DeadlineFor(JObject lot)
        {
            int remaining = lot?["remainingSeconds"]?.Value<int>() ?? 0;
            return _snapshotAt + remaining * 1000L;
        }

        private static string Clock(long deadlineMs)
        {
            long seconds = Math.Max(0, (deadlineMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000);
            if (seconds >= 3600) return (seconds / 3600) + " ч " + ((seconds % 3600) / 60) + " мин";
            if (seconds >= 60) return (seconds / 60) + " мин " + (seconds % 60) + " с";
            return seconds + " с";
        }

        private void TickTimers()
        {
            for (int i = _timers.Count - 1; i >= 0; i -= 1)
            {
                (Text label, long deadline) = _timers[i];
                if (label == null) { _timers.RemoveAt(i); continue; }
                label.text = Clock(deadline);
                label.color = deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < 300000 ? Warn : InkDim;
            }
        }

        // ------------------------------------------------------------------
        // Сборка окна

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("AuctionCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            // Выше диалога и ПУТНИКа: экран аукционера закрывает собой весь стол.
            canvas.sortingOrder = 44;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _root = new GameObject("AuctionWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);
            _root.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.65f);

            _panel = Child("Panel", rootRect);
            Stretch(_panel, 0f);
            _panel.offsetMin = new Vector2(48f, 34f);
            _panel.offsetMax = new Vector2(-48f, -28f);
            _panel.gameObject.AddComponent<Image>().color = PanelBg;
            var outline = _panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1.5f, -1.5f);

            _title = Label("Title", _panel, 22, TextAnchor.UpperLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(18f, -46f), new Vector2(-120f, -14f));

            _terms = Label("Terms", _panel, 12, TextAnchor.UpperLeft, InkDim);
            Place(_terms.rectTransform, 0f, 1f, 1f, 1f, new Vector2(18f, -68f), new Vector2(-120f, -46f));

            Button close = TextButton("Close", _panel, "×", 26, out Text closeText);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = closeRect.anchorMax = new Vector2(1f, 1f);
            closeRect.pivot = new Vector2(1f, 1f);
            closeRect.anchoredPosition = new Vector2(-10f, -10f);
            closeRect.sizeDelta = new Vector2(46f, 40f);
            closeText.color = Accent;
            close.onClick.AddListener(Close);

            _status = Label("Status", _panel, 12, TextAnchor.LowerLeft, InkDim);
            Place(_status.rectTransform, 0f, 0f, 1f, 0f, new Vector2(18f, 8f), new Vector2(-18f, 28f));

            // Левая колонка: разделы и категории товаров.
            RectTransform left = Child("Left", _panel);
            Place(left, 0f, 0f, 0f, 1f, new Vector2(14f, 32f), new Vector2(214f, -76f));

            _tabsColumn = Child("Tabs", left);
            Place(_tabsColumn, 0f, 1f, 1f, 1f, new Vector2(0f, -164f), new Vector2(0f, 0f));
            var tabsLayout = _tabsColumn.gameObject.AddComponent<VerticalLayoutGroup>();
            tabsLayout.spacing = 4f;
            tabsLayout.childForceExpandHeight = false;
            tabsLayout.childControlHeight = true;
            tabsLayout.childControlWidth = true;

            _categoryColumn = Child("Categories", left);
            Place(_categoryColumn, 0f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(0f, -172f));
            var categoryLayout = _categoryColumn.gameObject.AddComponent<VerticalLayoutGroup>();
            categoryLayout.spacing = 2f;
            categoryLayout.childForceExpandHeight = false;
            categoryLayout.childControlHeight = true;
            categoryLayout.childControlWidth = true;

            // Центр: список лотов или предметов рюкзака.
            RectTransform scrollArea = Child("Scroll", _panel);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(222f, 32f), new Vector2(-396f, -76f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            RectTransform viewport = Child("Viewport", scrollArea);
            Stretch(viewport, 0f);
            viewport.gameObject.AddComponent<RectMask2D>();
            _list = Child("Content", viewport);
            _list.anchorMin = new Vector2(0f, 1f);
            _list.anchorMax = new Vector2(1f, 1f);
            _list.pivot = new Vector2(0.5f, 1f);
            var listLayout = _list.gameObject.AddComponent<VerticalLayoutGroup>();
            listLayout.spacing = 4f;
            listLayout.childForceExpandHeight = false;
            listLayout.childControlHeight = true;
            listLayout.childControlWidth = true;
            var fitter = _list.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _list;
            scroll.viewport = viewport;
            RoaUiScroll.Configure(scroll);

            // Правая колонка: карточка лота или форма выставления.
            _detail = Child("Detail", _panel);
            Place(_detail, 1f, 0f, 1f, 1f, new Vector2(-388f, 32f), new Vector2(-14f, -76f));
            _detail.gameObject.AddComponent<Image>().color = QuietBg;

            _sellForm = Child("SellForm", _detail);
            Stretch(_sellForm, 10f);
            BuildSellForm();
            _sellForm.gameObject.SetActive(false);

            // Поле своей ставки живёт над стопкой кнопок и переживает перерисовку:
            // иначе набранная сумма пропадала бы при каждом обновлении снимка.
            _bidInput = NumberInput("BidInput", _detail, "Своя ставка");
            var bidRect = (RectTransform)_bidInput.transform;
            bidRect.anchorMin = new Vector2(0f, 0f);
            bidRect.anchorMax = new Vector2(1f, 0f);
            bidRect.offsetMin = new Vector2(12f, 96f);
            bidRect.offsetMax = new Vector2(-12f, 128f);
            _bidInput.gameObject.SetActive(false);
        }

        private void BuildSellForm()
        {
            Text heading = Label("SellTitle", _sellForm, 15, TextAnchor.UpperLeft, Accent, FontStyle.Bold);
            Place(heading.rectTransform, 0f, 1f, 1f, 1f, new Vector2(4f, -26f), new Vector2(-4f, -2f));
            heading.text = "ВЫСТАВИТЬ ЛОТ";

            _qtyInput = NumberInput("Qty", _sellForm, "Количество");
            Place((RectTransform)_qtyInput.transform, 0f, 1f, 1f, 1f, new Vector2(4f, -118f), new Vector2(-4f, -86f));

            _startInput = NumberInput("StartPrice", _sellForm, "Стартовая цена");
            Place((RectTransform)_startInput.transform, 0f, 1f, 1f, 1f, new Vector2(4f, -180f), new Vector2(-4f, -148f));

            _buyoutInput = NumberInput("BuyoutPrice", _sellForm, "Цена выкупа (0 — без выкупа)");
            Place((RectTransform)_buyoutInput.transform, 0f, 1f, 1f, 1f, new Vector2(4f, -242f), new Vector2(-4f, -210f));
        }

        // ------------------------------------------------------------------
        // Перерисовка

        private void Rebuild()
        {
            if (_root == null || !_root.activeSelf) return;

            string factionId = _state?["factionId"]?.ToString() ?? string.Empty;
            _title.text = "АУКЦИОН" + (string.IsNullOrEmpty(factionId) ? string.Empty : " · " + factionId.ToUpperInvariant());
            int stepPct = Mathf.RoundToInt((_state?["minBidStepPct"]?.Value<float>() ?? 0.05f) * 100f);
            int antiSnipe = _state?["antiSnipeSeconds"]?.Value<int>() ?? 120;
            _terms.text = "Налог на продажу " + Mathf.RoundToInt(TaxPct * 100f) + "% · шаг ставки " + stepPct
                + "% · ставка в последние " + Mathf.Max(1, antiSnipe / 60) + " мин продлевает торги · у вас "
                + Marks + " марок";
            _status.text = string.IsNullOrEmpty(_note)
                ? (_pending ? "Аукционер сверяет книги…" : "Купленное, выигранное и возвраты ждут на полке у аукционера.")
                : _note;
            _status.color = string.IsNullOrEmpty(_note) ? InkDim : Accent;

            RebuildTabs();
            RebuildCategories();
            ClearRows(_rows);
            _timers.Clear();

            switch (_tab)
            {
                case Tab.Sell: BuildSellPage(); break;
                case Tab.Shelf: BuildShelfPage(); break;
                default: BuildLotsPage(); break;
            }

            RebuildDetail();
            TickTimers();
        }

        private void RebuildTabs()
        {
            foreach (Transform child in _tabsColumn) Destroy(child.gameObject);
            int mine = _state?["mineCount"]?.Value<int>() ?? 0;
            int leading = _state?["leadingCount"]?.Value<int>() ?? 0;
            JObject shelf = Shelf;
            int shelfSilver = shelf?["silver"]?.Value<int>() ?? 0;
            int shelfItems = 0;
            foreach (JToken row in shelf?["items"] as JArray ?? new JArray()) shelfItems += row["qty"]?.Value<int>() ?? 0;

            AddTab(Tab.Trade, "ТОРГИ" + (leading > 0 ? " (веду " + leading + ")" : string.Empty));
            AddTab(Tab.Mine, "МОИ ЛОТЫ" + (mine > 0 ? " (" + mine + ")" : string.Empty));
            AddTab(Tab.Sell, "ВЫСТАВИТЬ");
            AddTab(Tab.Shelf, "ПОЛКА" + (shelfSilver > 0 || shelfItems > 0 ? " ●" : string.Empty));
        }

        private void AddTab(Tab tab, string caption)
        {
            var row = new GameObject("Tab", typeof(RectTransform));
            row.transform.SetParent(_tabsColumn, false);
            row.AddComponent<LayoutElement>().preferredHeight = 34f;
            var back = row.AddComponent<Image>();
            back.color = _tab == tab ? ButtonBg : RowBg;
            var button = row.AddComponent<Button>();
            button.targetGraphic = back;
            Text text = Label("Text", (RectTransform)row.transform, 13, TextAnchor.MiddleLeft,
                _tab == tab ? Accent : Ink, FontStyle.Bold);
            Place(text.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 0f), new Vector2(-6f, 0f));
            text.text = caption;
            Tab captured = tab;
            button.onClick.AddListener(() =>
            {
                _tab = captured;
                _selectedLotId = string.Empty;
                _note = string.Empty;
                Rebuild();
            });
        }

        private void RebuildCategories()
        {
            ClearRows(_categoryRows);
            if (_tab != Tab.Trade)
            {
                _categoryColumn.gameObject.SetActive(false);
                return;
            }
            _categoryColumn.gameObject.SetActive(true);

            var heading = new GameObject("Heading", typeof(RectTransform));
            heading.transform.SetParent(_categoryColumn, false);
            heading.AddComponent<LayoutElement>().preferredHeight = 26f;
            Text headingText = Label("Text", (RectTransform)heading.transform, 11, TextAnchor.LowerLeft, InkDim, FontStyle.Bold);
            Stretch(headingText.rectTransform, 4f);
            headingText.text = "КАТЕГОРИИ ТОВАРОВ";
            _categoryRows.Add(heading);

            int total = 0;
            foreach (JToken token in Listings)
            {
                JObject lot = token as JObject;
                if (lot != null && lot["mine"]?.Value<bool>() != true) total += 1;
            }
            AddCategory("all", "Все лоты", total);
            foreach (JToken token in _state?["categories"] as JArray ?? new JArray())
            {
                JObject row = token as JObject;
                if (row == null) continue;
                int count = row["count"]?.Value<int>() ?? 0;
                string id = row["id"]?.ToString() ?? string.Empty;
                // Пустые категории не занимают колонку, но выбранная остаётся видимой.
                if (count == 0 && id != _category) continue;
                AddCategory(id, row["label"]?.ToString() ?? id, count);
            }
        }

        private void AddCategory(string id, string label, int count)
        {
            var row = new GameObject("Category", typeof(RectTransform));
            row.transform.SetParent(_categoryColumn, false);
            row.AddComponent<LayoutElement>().preferredHeight = 28f;
            var back = row.AddComponent<Image>();
            back.color = _category == id ? RowSelected : RowBg;
            var button = row.AddComponent<Button>();
            button.targetGraphic = back;
            Text text = Label("Text", (RectTransform)row.transform, 12, TextAnchor.MiddleLeft,
                _category == id ? Accent : Ink);
            Place(text.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 0f), new Vector2(-8f, 0f));
            text.text = label + "  " + count;
            string captured = id;
            button.onClick.AddListener(() => { _category = captured; _selectedLotId = string.Empty; Rebuild(); });
            _categoryRows.Add(row);
        }

        // --- лоты ---------------------------------------------------------

        private void BuildLotsPage()
        {
            List<JObject> lots = VisibleLots();
            if (lots.Count == 0)
            {
                AddNote(_state == null
                    ? (_pending ? "Аукционер раскладывает книги…" : "Аукцион не ответил.")
                    : _tab == Tab.Mine
                        ? "Вы ничего не выставили. Раздел «ВЫСТАВИТЬ» примет предмет из рюкзака."
                        : "В этой категории пока пусто.");
                return;
            }
            foreach (JObject lot in lots) AddLotRow(lot);
        }

        private void AddLotRow(JObject lot)
        {
            string id = lot["id"]?.ToString() ?? string.Empty;
            string itemId = lot["itemId"]?.ToString() ?? string.Empty;
            int qty = lot["qty"]?.Value<int>() ?? 0;
            int bid = lot["bid"]?.Value<int>() ?? 0;
            int startPrice = lot["startPrice"]?.Value<int>() ?? 0;
            int buyout = lot["buyoutPrice"]?.Value<int>() ?? 0;
            bool leading = lot["leading"]?.Value<bool>() == true;
            bool mine = lot["mine"]?.Value<bool>() == true;

            var row = new GameObject("Lot", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 46f;
            var back = row.AddComponent<Image>();
            back.color = _selectedLotId == id ? RowSelected : RowBg;
            var button = row.AddComponent<Button>();
            button.targetGraphic = back;
            var rect = (RectTransform)row.transform;

            Text name = Label("Name", rect, 14, TextAnchor.UpperLeft, Ink, FontStyle.Bold);
            Place(name.rectTransform, 0f, 0f, 0.44f, 1f, new Vector2(10f, 22f), new Vector2(-4f, -4f));
            name.text = RoaItemData.Name(itemId) + (qty > 1 ? " ×" + qty : string.Empty);

            Text seller = Label("Seller", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(seller.rectTransform, 0f, 0f, 0.44f, 1f, new Vector2(10f, 4f), new Vector2(-4f, -24f));
            seller.text = mine ? "ваш лот" : "продавец: " + (lot["sellerName"]?.ToString() ?? "—");

            Text price = Label("Price", rect, 13, TextAnchor.UpperLeft, bid > 0 ? (leading ? Good : Ink) : InkDim);
            Place(price.rectTransform, 0.44f, 0f, 0.72f, 1f, new Vector2(0f, 22f), new Vector2(-4f, -4f));
            price.text = bid > 0 ? "ставка " + bid : "старт " + startPrice;

            Text bidder = Label("Bidder", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(bidder.rectTransform, 0.44f, 0f, 0.72f, 1f, new Vector2(0f, 4f), new Vector2(-4f, -24f));
            bidder.text = bid > 0
                ? (leading ? "ваша ставка ведёт" : "ведёт " + (lot["bidderName"]?.ToString() ?? "—"))
                : "ставок нет";

            Text buyoutText = Label("Buyout", rect, 13, TextAnchor.UpperLeft, buyout > 0 ? Accent : InkDim);
            Place(buyoutText.rectTransform, 0.72f, 0f, 0.88f, 1f, new Vector2(0f, 22f), new Vector2(-4f, -4f));
            buyoutText.text = buyout > 0 ? "выкуп " + buyout : "без выкупа";

            Text timer = Label("Timer", rect, 12, TextAnchor.LowerRight, InkDim);
            Place(timer.rectTransform, 0.72f, 0f, 1f, 1f, new Vector2(0f, 4f), new Vector2(-10f, -24f));
            _timers.Add((timer, DeadlineFor(lot)));

            string captured = id;
            button.onClick.AddListener(() =>
            {
                _selectedLotId = captured;
                _note = string.Empty;
                Rebuild();
            });
            _rows.Add(row);
        }

        // --- выставление --------------------------------------------------

        private void BuildSellPage()
        {
            RoaInventory inventory = FindObjectOfType<RoaInventory>();
            if (inventory == null) { AddNote("Рюкзак недоступен."); return; }
            int shown = 0;
            foreach (RoaInventory.Row item in inventory.Items)
            {
                if (string.IsNullOrEmpty(item.Id) || item.Id == "silver" || item.Qty <= 0) continue;
                shown += 1;
                AddSellCandidate(item.Id, item.Qty);
            }
            if (shown == 0) AddNote("В рюкзаке нечего выставить.");
        }

        private void AddSellCandidate(string itemId, int qty)
        {
            var row = new GameObject("Candidate", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 34f;
            var back = row.AddComponent<Image>();
            back.color = _sellItemId == itemId ? RowSelected : RowBg;
            var button = row.AddComponent<Button>();
            button.targetGraphic = back;
            var rect = (RectTransform)row.transform;

            Text name = Label("Name", rect, 13, TextAnchor.MiddleLeft, Ink);
            Place(name.rectTransform, 0f, 0f, 0.62f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = RoaItemData.Name(itemId) + " ×" + qty;

            Text hint = Label("Hint", rect, 11, TextAnchor.MiddleRight, InkDim);
            Place(hint.rectTransform, 0.62f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            hint.text = "каталог " + RoaItemData.BasePrice(itemId) + " марок";

            string captured = itemId;
            button.onClick.AddListener(() =>
            {
                _sellItemId = captured;
                _note = string.Empty;
                // Предложение по умолчанию: одна штука, старт по каталогу, выкуп вдвое.
                int basePrice = Mathf.Max(1, RoaItemData.BasePrice(captured));
                _qtyInput.text = "1";
                _startInput.text = basePrice.ToString();
                _buyoutInput.text = (basePrice * 2).ToString();
                Rebuild();
            });
            _rows.Add(row);
        }

        // --- полка --------------------------------------------------------

        private void BuildShelfPage()
        {
            JObject shelf = Shelf;
            int silver = shelf?["silver"]?.Value<int>() ?? 0;
            JArray items = shelf?["items"] as JArray ?? new JArray();
            if (silver <= 0 && items.Count == 0)
            {
                AddNote("Полка пуста. Сюда попадают выручка, выигранные лоты, возвраты снятых и перебитые ставки.");
                return;
            }
            if (silver > 0) AddShelfRow("Марки", silver, "выручка и возвраты");
            foreach (JToken token in items)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                AddShelfRow(RoaItemData.Name(row["itemId"]?.ToString()), row["qty"]?.Value<int>() ?? 0,
                    ShelfReason(row["reason"]?.ToString()));
            }
        }

        private static string ShelfReason(string reason)
        {
            switch (reason)
            {
                case "won": return "выигранный лот";
                case "cancelled": return "снятый лот";
                case "expired": return "срок вышел";
                default: return "возврат";
            }
        }

        private void AddShelfRow(string title, int qty, string reason)
        {
            var row = new GameObject("ShelfRow", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 32f;
            row.AddComponent<Image>().color = RowBg;
            var rect = (RectTransform)row.transform;

            Text name = Label("Name", rect, 13, TextAnchor.MiddleLeft, Ink);
            Place(name.rectTransform, 0f, 0f, 0.7f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = title + " ×" + qty;

            Text hint = Label("Reason", rect, 11, TextAnchor.MiddleRight, InkDim);
            Place(hint.rectTransform, 0.7f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            hint.text = reason;
            _rows.Add(row);
        }

        private void AddNote(string text)
        {
            var row = new GameObject("Note", typeof(RectTransform));
            row.transform.SetParent(_list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 60f;
            Text label = Label("Text", (RectTransform)row.transform, 13, TextAnchor.UpperLeft, InkDim);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 6f), new Vector2(-10f, -6f));
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.text = text;
            _rows.Add(row);
        }

        // ------------------------------------------------------------------
        // Правая колонка

        private void RebuildDetail()
        {
            ClearRows(_detailRows);
            bool sell = _tab == Tab.Sell;
            _sellForm.gameObject.SetActive(sell);
            if (sell) { RebuildSellForm(); return; }

            _bidInput.gameObject.SetActive(false);
            if (_tab == Tab.Shelf) { RebuildShelfPanel(); return; }

            JObject lot = SelectedLot();
            if (lot == null)
            {
                AddDetailText("Выберите лот слева: в карточке появятся ставка, выкуп и срок.", 13, InkDim, 90f);
                return;
            }

            string itemId = lot["itemId"]?.ToString() ?? string.Empty;
            int qty = lot["qty"]?.Value<int>() ?? 0;
            int bid = lot["bid"]?.Value<int>() ?? 0;
            int nextBid = lot["nextBid"]?.Value<int>() ?? 0;
            int buyout = lot["buyoutPrice"]?.Value<int>() ?? 0;
            bool mine = lot["mine"]?.Value<bool>() == true;
            bool leading = lot["leading"]?.Value<bool>() == true;
            string lotId = lot["id"]?.ToString() ?? string.Empty;
            int marks = Marks;

            AddDetailText(RoaItemData.Name(itemId) + (qty > 1 ? " ×" + qty : string.Empty), 17, Accent, 30f, FontStyle.Bold);
            AddDetailText(CategoryLabel(lot["category"]?.ToString()) + " · срок лота "
                + (lot["durationHours"]?.Value<int>() ?? 0) + " ч · осталось " + Clock(DeadlineFor(lot)), 12, InkDim, 20f);
            AddDetailText(mine ? "Ваш лот" : "Продавец: " + (lot["sellerName"]?.ToString() ?? "—"), 12, InkDim, 20f);

            AddDetailText(bid > 0
                ? "Ставка " + bid + " марок · " + (leading ? "ведёте вы" : "ведёт " + (lot["bidderName"]?.ToString() ?? "—"))
                : "Ставок нет · старт " + (lot["startPrice"]?.Value<int>() ?? 0) + " марок",
                14, bid > 0 && leading ? Good : Ink, 26f);

            string artifacts = RoaDialogueCanvas.AuctionArtifactLine(lot);
            if (!string.IsNullOrEmpty(artifacts)) AddDetailText(artifacts.TrimStart('\n'), 11, InkDim, 62f);

            if (mine)
            {
                AddDetailText(bid > 0
                    ? "Снять лот со ставкой нельзя: торги идут до конца срока, выручка придёт на полку за вычетом налога."
                    : "Пока ставок нет, лот можно снять — предметы вернутся на полку.", 11, InkDim, 54f);
                if (bid <= 0)
                {
                    AddDetailButton("СНЯТЬ ЛОТ", Warn, () =>
                        RoaAuctionNet.Cancel(Interaction.Socket, lotId, AfterAction));
                }
                return;
            }

            AddDetailText("Минимальная ставка: " + nextBid + " марок · у вас " + marks, 12,
                marks >= nextBid ? InkDim : Warn, 22f);
            _bidInput.gameObject.SetActive(true);
            if (string.IsNullOrEmpty(_bidInput.text) || !leading) _bidInput.text = nextBid.ToString();

            AddDetailButton("СТАВКА " + nextBid, marks >= nextBid ? ButtonBg : QuietBg, () =>
            {
                int amount = ParseNumber(_bidInput.text, nextBid);
                RoaAuctionNet.Bid(Interaction.Socket, lotId, Mathf.Max(nextBid, amount), AfterAction);
            });

            if (buyout > 0)
            {
                AddDetailButton("ВЫКУП ЗА " + buyout, marks >= buyout ? ButtonBg : QuietBg, () =>
                    RoaAuctionNet.Buyout(Interaction.Socket, lotId, AfterAction));
            }
            else AddDetailText("Выкупа у этого лота нет — только торги.", 11, InkDim, 20f);
        }

        private void RebuildShelfPanel()
        {
            JObject shelf = Shelf;
            int silver = shelf?["silver"]?.Value<int>() ?? 0;
            int items = 0;
            foreach (JToken row in shelf?["items"] as JArray ?? new JArray()) items += row["qty"]?.Value<int>() ?? 0;
            AddDetailText("ПОЛКА У АУКЦИОНЕРА", 15, Accent, 28f, FontStyle.Bold);
            AddDetailText("Марки: " + silver + "\nПредметов: " + items + "\nПродаж: " + (shelf?["sales"]?.Value<int>() ?? 0), 13, Ink, 60f);
            AddDetailText("Забирается целиком, насколько хватит места и грузоподъёмности; остаток остаётся на полке.", 11, InkDim, 52f);
            if (silver > 0 || items > 0)
                AddDetailButton("ЗАБРАТЬ ПОЛКУ", ButtonBg, () => RoaAuctionNet.Claim(Interaction.Socket, AfterAction));
        }

        private void RebuildSellForm()
        {
            int hours = Mathf.Max(1, _sellHours);
            int start = ParseNumber(_startInput.text, 0);
            int buyout = ParseNumber(_buyoutInput.text, 0);
            int qty = Mathf.Max(1, ParseNumber(_qtyInput.text, 1));
            int tax = Mathf.FloorToInt(Mathf.Max(start, buyout) * TaxPct);

            // Поля формы стоят на своих местах в _sellForm; подписи и кнопки
            // ложатся ниже них, поэтому курсор колонки начинается под полями.
            _detailCursor = -252f;
            AddDetailText(string.IsNullOrEmpty(_sellItemId)
                ? "Выберите предмет из рюкзака слева."
                : "Предмет: " + RoaItemData.Name(_sellItemId) + " ×" + qty, 13,
                string.IsNullOrEmpty(_sellItemId) ? InkDim : Ink, 22f);

            AddDetailText("СРОК ВЫСТАВЛЕНИЯ", 11, InkDim, 18f, FontStyle.Bold);
            float top = _detailCursor;
            float x = 12f;
            foreach (JToken token in _state?["durationChoicesHours"] as JArray ?? new JArray())
            {
                int choice = token?.Value<int>() ?? 0;
                if (choice <= 0) continue;
                Button button = TextButton("Duration", _detail, choice + " ч", 12, out Text label);
                var rect = (RectTransform)button.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(x, top);
                rect.sizeDelta = new Vector2(80f, 28f);
                x += 84f;
                button.GetComponent<Image>().color = hours == choice ? ButtonBg : QuietBg;
                label.color = hours == choice ? Accent : Ink;
                int captured = choice;
                button.onClick.AddListener(() => { _sellHours = captured; Rebuild(); });
                _detailRows.Add(button.gameObject);
            }
            _detailCursor = top - 34f;

            AddDetailText("Налог на продажу " + Mathf.RoundToInt(TaxPct * 100f) + "%: при продаже удержат "
                + tax + " марок, на полку придёт " + Mathf.Max(0, Mathf.Max(start, buyout) - tax) + ".",
                11, InkDim, 46f);

            bool ready = !string.IsNullOrEmpty(_sellItemId) && start > 0 && (buyout == 0 || buyout >= start);
            AddDetailButton(ready ? "ВЫСТАВИТЬ НА " + hours + " Ч" : "ВЫБЕРИТЕ ПРЕДМЕТ И ЦЕНУ",
                ready ? ButtonBg : QuietBg, () =>
                {
                    if (!ready) return;
                    RoaAuctionNet.ListItem(Interaction.Socket, _sellItemId, qty, start, buyout, hours, string.Empty, ack =>
                    {
                        if (ack != null && ack["ok"]?.Value<bool>() == true) _sellItemId = string.Empty;
                        AfterAction(ack);
                    });
                });
        }

        private static string CategoryLabel(string id)
        {
            switch (id)
            {
                case "weapons": return "Оружие";
                case "armor": return "Броня";
                case "ammo": return "Патроны";
                case "aid": return "Медицина";
                case "artifacts": return "Артефакты";
                case "tools": return "Инструменты";
                case "materials": return "Материалы";
                case "strategic": return "Стратегическое";
                default: return "Разное";
            }
        }

        private static int ParseNumber(string text, int fallback)
        {
            int value;
            return int.TryParse((text ?? string.Empty).Trim(), out value) && value >= 0 ? value : fallback;
        }

        // ------------------------------------------------------------------
        // Мелкие строители

        /// <summary>Строки правой колонки идут сверху вниз от текущего курсора.</summary>
        private void AddDetailText(string text, int size, Color color, float height, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject("DetailText", typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(_detail, false);
            Text label = Label("Text", rect, size, TextAnchor.UpperLeft, color, style);
            Stretch(label.rectTransform, 0f);
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.text = text;
            Place(rect, 0f, 1f, 1f, 1f, new Vector2(12f, _detailCursor - height), new Vector2(-12f, _detailCursor));
            _detailCursor -= height + 6f;
            _detailRows.Add(go);
        }

        /// <summary>Кнопки действий стоят внизу колонки стопкой снизу вверх.</summary>
        private void AddDetailButton(string caption, Color color, Action onClick)
        {
            Button button = TextButton("DetailButton", _detail, caption, 14, out Text label);
            var rect = (RectTransform)button.transform;
            float shift = _detailButtons * 38f;
            _detailButtons += 1;
            rect.anchorMin = new Vector2(0f, 0f);
            rect.anchorMax = new Vector2(1f, 0f);
            rect.offsetMin = new Vector2(12f, 12f + shift);
            rect.offsetMax = new Vector2(-12f, 46f + shift);
            button.GetComponent<Image>().color = color;
            label.color = Accent;
            label.fontStyle = FontStyle.Bold;
            Action captured = onClick;
            button.onClick.AddListener(() => { if (Interaction != null && Interaction.Socket != null) captured(); });
            _detailRows.Add(button.gameObject);
        }

        private InputField NumberInput(string name, RectTransform parent, string placeholder)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            go.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.45f);
            var field = go.AddComponent<InputField>();
            Text text = Label("Text", rect, 14, TextAnchor.MiddleLeft, Ink);
            Stretch(text.rectTransform, 8f);
            text.supportRichText = false;
            field.textComponent = text;
            field.characterLimit = 7;
            field.contentType = InputField.ContentType.IntegerNumber;
            Text hint = Label("Placeholder", rect, 12, TextAnchor.MiddleLeft, InkDim);
            Stretch(hint.rectTransform, 8f);
            hint.text = placeholder;
            field.placeholder = hint;
            field.onEndEdit.AddListener(value => Rebuild());
            return field;
        }

        private void ClearRows(List<GameObject> rows)
        {
            foreach (GameObject row in rows) if (row != null) Destroy(row);
            rows.Clear();
            if (rows == _detailRows) { _detailCursor = -12f; _detailButtons = 0; }
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
            image.color = QuietBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Text", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, Ink);
            Stretch(label.rectTransform, 2f);
            label.text = caption;
            return button;
        }
    }
}
