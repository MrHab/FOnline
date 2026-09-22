using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Экран рынка фракции: открывается взаимодействием с аукционером и
    /// заменяет собой диалог, поэтому вариантов ответа у аукционера нет.
    ///
    /// Торговля идёт книгой ордеров, а не ставками. Слева — разделы (ПОКУПКА,
    /// ПРОДАЖА, МОИ ОРДЕРА, ПОЛКА, СИНЬ) и категории товаров со счётчиками, в центре
    /// — товары книги или строки ордеров по выбранному предмету, справа — форма
    /// ордера на выкуп или на продажу со сбором, налогом и сроком. Все проверки
    /// серверные: экран показывает снимок `auctionAction:state` и отправляет
    /// действия, а срок ордера идёт от последнего снимка, чтобы таймер не
    /// замирал между обновлениями.
    ///
    /// Раздел СИНЬ (экономика v3) показывает счёт сини аккаунта, премиум и
    /// обменник синь↔марки: это отдельная книга `accountSinAction`, синь в ней
    /// списывается со счёта и зачисляется на счёт, а не в рюкзак.
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
        private static readonly Color ConfirmBg = new Color(0.46f, 0.15f, 0.1f, 0.96f);

        private enum Tab { Buy, Sell, Mine, Shelf, Journal, Sin }

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
        private InputField _priceInput;
        private InputField _qtyInput;
        private InputField _searchInput;
        private int _sort;
        private bool _actionBusy;

        private readonly List<GameObject> _rows = new List<GameObject>();
        private readonly List<GameObject> _detailRows = new List<GameObject>();
        private readonly List<GameObject> _categoryRows = new List<GameObject>();
        private readonly List<KeyValuePair<Text, long>> _timers = new List<KeyValuePair<Text, long>>();

        private JObject _state;
        private bool _pending;
        private string _note = string.Empty;
        private float _refreshAt;
        private float _clockAt;
        private long _snapshotAt;
        private Tab _tab = Tab.Buy;
        private string _category = "all";
        private string _itemId = string.Empty;
        private string _orderId = string.Empty;
        private int _durationHours;
        private float _detailCursor;
        private int _detailButtons;

        // Счёт сини и обменник: отдельный снимок, раздел виден, только если
        // сервер ведёт счёт сини.
        private JObject _sinAccount;
        private JObject _sinExchange;
        private long _sinSnapshotAt;
        private bool _sinSell;
        // Пока ответ обменника не пришёл, кнопки сини не шлют второй запрос:
        // у каждого нажатия свой requestId, и двойной клик купил бы дважды.
        private bool _sinBusy;
        private float _sinBusyAt;
        private bool _premiumConfirm;

        /// <summary>Блокировка снимается ответом, а без ответа — через 10 секунд.</summary>
        private bool SinBusy { get { return _sinBusy && Time.unscaledTime - _sinBusyAt < 10f; } }

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
                    _sinAccount = null;
                    _sinExchange = null;
                    _note = string.Empty;
                    _itemId = string.Empty;
                    _orderId = string.Empty;
                }
                return;
            }

            EnsureBuilt();
            if (!_root.activeSelf)
            {
                _root.SetActive(true);
                _tab = Tab.Buy;
                _category = "all";
                _itemId = string.Empty;
                _orderId = string.Empty;
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

            if (Input.GetKeyDown(KeyCode.Escape) && !RoaPipboyCanvas.TypingInInputField()) Close();
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
            if (_actionBusy || _pending) return;
            _pending = true;
            bool sent = RoaAuctionNet.RequestState(Interaction.Socket, _itemId, ack =>
            {
                _pending = false;
                if (ack != null && ack["ok"]?.Value<bool>() == true) Apply(ack);
                else _note = ack?["error"]?.ToString() ?? "Аукционер не ответил.";
                Rebuild();
            });
            if (!sent) { _pending = false; _note = "Нет связи с сервером."; }
            RequestSinState();
        }

        private void RequestSinState()
        {
            if (Interaction == null || Interaction.Socket == null) return;
            RoaAccountSinNet.RequestState(Interaction.Socket, ack =>
            {
                if (ack != null && ack["ok"]?.Value<bool>() == true) ApplySin(ack);
                else
                {
                    _sinAccount = null;
                    _sinExchange = null;
                    if (_tab == Tab.Sin) _tab = Tab.Buy;
                }
                Rebuild();
            });
        }

        private void ApplySin(JObject ack)
        {
            _sinAccount = ack["account"] as JObject;
            _sinExchange = ack["exchange"] as JObject;
            _sinSnapshotAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        /// <summary>Действие обменника: одно за раз, ответ снимает блокировку.</summary>
        private void SendSin(Func<Action<JObject>, bool> send)
        {
            if (SinBusy || Interaction == null || Interaction.Socket == null) return;
            _premiumConfirm = false;
            _sinBusyAt = Time.unscaledTime;
            _sinBusy = send(AfterSinAction);
            if (!_sinBusy) { _note = "Нет связи с сервером."; Rebuild(); }
        }

        private void AfterSinAction(JObject ack)
        {
            _sinBusy = false;
            if (ack != null && ack["ok"]?.Value<bool>() == true)
            {
                _note = SinActionNote(ack);
                ApplySin(ack);
            }
            else _note = ack?["error"]?.ToString() ?? "Обменник отклонил действие.";
            _refreshAt = Time.unscaledTime + 6f;
            Rebuild();
        }

        private static string SinActionNote(JObject ack)
        {
            if (ack["replay"]?.Value<bool>() == true) return "Это действие уже выполнено.";
            int qty = ack["qty"]?.Value<int>() ?? 0;
            int fee = ack["fee"]?.Value<int>() ?? 0;
            int shelved = ack["shelvedSilver"]?.Value<int>() ?? 0;
            string shelfNote = shelved > 0 ? " " + RoaPlural.Marks(shelved) + " не влезли в рюкзак и ждут на полке." : string.Empty;
            switch (ack["action"]?.ToString() ?? string.Empty)
            {
                case "buyPremium":
                    return "Премиум продлён до " + DateLabel(ack["premiumUntil"]?.Value<long>() ?? 0) + ".";
                case "sell":
                {
                    int sold = ack["soldQty"]?.Value<int>() ?? 0;
                    int resting = ack["restingQty"]?.Value<int>() ?? 0;
                    string note = sold > 0 ? "Продано сразу: " + sold + " сини за " + RoaPlural.Marks((ack["proceeds"]?.Value<int>() ?? 0)) + "." : string.Empty;
                    if (resting > 0) note += (note.Length > 0 ? " " : string.Empty) + "В книге: " + resting + " сини.";
                    return note + " Сбор " + fee + "." + shelfNote;
                }
                case "buy":
                {
                    int bought = ack["boughtQty"]?.Value<int>() ?? 0;
                    int resting = ack["restingQty"]?.Value<int>() ?? 0;
                    string note = bought > 0 ? "Куплено сразу: " + bought + " сини за " + RoaPlural.Marks((ack["spent"]?.Value<int>() ?? 0)) + "." : string.Empty;
                    if (resting > 0) note += (note.Length > 0 ? " " : string.Empty) + "Ордер на выкуп: " + resting + " сини, заморожено " + (ack["escrow"]?.Value<int>() ?? 0) + ".";
                    return note + " Сбор " + fee + ".";
                }
                case "buyNow": return "Куплено " + qty + " сини за " + RoaPlural.Marks((ack["cost"]?.Value<int>() ?? 0)) + ".";
                case "sellNow": return "Продано " + qty + " сини за " + RoaPlural.Marks((ack["proceeds"]?.Value<int>() ?? 0)) + "." + shelfNote;
                case "cancel": return "Ордер отменён: синь вернулась на счёт, марки ждут на полке обменника.";
                case "claim": return "С полки обменника забрано " + RoaPlural.Marks((ack["claimedSilver"]?.Value<int>() ?? 0)) + ".";
                default: return string.Empty;
            }
        }

        private static string DateLabel(long unixMs)
        {
            if (unixMs <= 0) return "—";
            return DateTimeOffset.FromUnixTimeMilliseconds(unixMs).ToLocalTime().ToString("dd.MM.yyyy HH:mm");
        }

        private void SendMarket(Func<Action<JObject>, bool> send)
        {
            if (_actionBusy || Interaction == null || Interaction.Socket == null) return;
            _actionBusy = true;
            _note = "Аукционер проводит операцию…";
            if (!send(AfterAction)) { _actionBusy = false; _note = "Нет связи с сервером."; }
            Rebuild();
        }

        private void AfterAction(JObject ack)
        {
            _actionBusy = false;
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
            int qty = ack["qty"]?.Value<int>() ?? 0;
            switch (ack["action"]?.ToString() ?? string.Empty)
            {
                case "sell":
                {
                    int sold = ack["soldQty"]?.Value<int>() ?? 0;
                    int resting = ack["restingQty"]?.Value<int>() ?? 0;
                    string note = sold > 0 ? "Продано сразу: " + sold + " шт за " + RoaPlural.Marks((ack["proceeds"]?.Value<int>() ?? 0)) + "." : string.Empty;
                    if (resting > 0) note += (note.Length > 0 ? " " : string.Empty) + "В книге: " + resting + " шт.";
                    return note + " Сбор " + (ack["setupFee"]?.Value<int>() ?? 0) + ".";
                }
                case "buy":
                {
                    int bought = ack["boughtQty"]?.Value<int>() ?? 0;
                    int resting = ack["restingQty"]?.Value<int>() ?? 0;
                    string note = bought > 0 ? "Куплено сразу: " + bought + " шт за " + RoaPlural.Marks((ack["spent"]?.Value<int>() ?? 0)) + "." : string.Empty;
                    if (resting > 0) note += (note.Length > 0 ? " " : string.Empty) + "Ордер на выкуп: " + resting + " шт, заморожено " + (ack["escrow"]?.Value<int>() ?? 0) + ".";
                    if ((ack["shelved"]?.Value<int>() ?? 0) > 0) note += " Часть не влезла в рюкзак и ждёт на полке.";
                    return note;
                }
                case "buyNow": return "Куплено " + qty + " шт за " + RoaPlural.Marks((ack["cost"]?.Value<int>() ?? 0)) + ".";
                case "sellNow": return "Продано " + qty + " шт, на руки " + RoaPlural.Marks((ack["proceeds"]?.Value<int>() ?? 0)) + ".";
                case "cancel": return "Ордер отменён, товар и марки ждут на полке.";
                case "update": return "Ордер обновлён. Сбор " + (ack["setupFee"]?.Value<int>() ?? 0)
                    + ". Купленное и возвращённые предметы ждут на полке.";
                case "claim": return "Полка забрана.";
                default: return string.Empty;
            }
        }

        private void Apply(JObject ack)
        {
            JObject market = ack["auction"] as JObject;
            if (market == null) return;
            _state = market;
            _snapshotAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_durationHours <= 0)
            {
                _durationHours = market["listingLifetimeHours"]?.Value<int>() ?? 720;
            }
        }

        // ------------------------------------------------------------------
        // Данные снимка

        private JArray Orders { get { return _state?["orders"] as JArray ?? new JArray(); } }

        private JArray MarketItems { get { return _state?["items"] as JArray ?? new JArray(); } }

        private float TaxPct { get { return _state?["taxPct"]?.Value<float>() ?? 0.05f; } }

        private float SetupFeePct { get { return _state?["setupFeePct"]?.Value<float>() ?? 0.015f; } }

        private JObject Shelf { get { return _state?["shelf"] as JObject; } }

        private int SinBalance { get { return _sinAccount?["sin"]?.Value<int>() ?? 0; } }

        private bool SinPremium { get { return _sinAccount?["premium"]?.Value<bool>() == true; } }

        private int SinOrderFee { get { return _sinExchange?["orderFee"]?.Value<int>() ?? 0; } }

        /// <summary>Сторона книги обменника: продажи от дешёвых, выкупы от дорогих.</summary>
        private List<JObject> SinBook(string side)
        {
            var rows = new List<JObject>();
            foreach (JToken token in _sinExchange?["orders"] as JArray ?? new JArray())
            {
                JObject order = token as JObject;
                if (order != null && (order["side"]?.ToString() ?? string.Empty) == side) rows.Add(order);
            }
            rows.Sort((a, b) =>
            {
                int left = a["price"]?.Value<int>() ?? 0;
                int right = b["price"]?.Value<int>() ?? 0;
                return side == "sell" ? left.CompareTo(right) : right.CompareTo(left);
            });
            return rows;
        }

        private int SinBestPrice(string side)
        {
            List<JObject> rows = SinBook(side);
            return rows.Count > 0 ? (rows[0]["price"]?.Value<int>() ?? 0) : 0;
        }

        /// <summary>Рюкзак ищется один раз: строк книги бывает много, а поиск по сцене недёшев.</summary>
        private RoaInventory _inventory;

        private RoaInventory Inventory
        {
            get
            {
                if (_inventory == null) _inventory = FindObjectOfType<RoaInventory>();
                return _inventory;
            }
        }

        private int Marks { get { return Inventory != null ? Inventory.CountOf("silver") : 0; } }

        private int Backpack(string itemId)
        {
            return Inventory != null && !string.IsNullOrEmpty(itemId) ? Inventory.CountOf(itemId) : 0;
        }

        /// <summary>Ордер на выкуп ставится только на предмет без износа и свойств — правило сервера.</summary>
        private static bool Fungible(string itemId)
        {
            return !string.IsNullOrEmpty(itemId)
                && itemId != "silver"
                && RoaItemData.ConditionMode(itemId) == "none"
                && RoaItemData.Category(itemId) != "artifacts";
        }

        /// <summary>Сторона книги по предмету: продажи от дешёвых, выкупы от дорогих.</summary>
        private List<JObject> Book(string itemId, string side)
        {
            var rows = new List<JObject>();
            foreach (JToken token in Orders)
            {
                JObject order = token as JObject;
                if (order == null) continue;
                if ((order["itemId"]?.ToString() ?? string.Empty) != itemId) continue;
                if ((order["side"]?.ToString() ?? string.Empty) != side) continue;
                rows.Add(order);
            }
            rows.Sort((a, b) =>
            {
                int left = a["price"]?.Value<int>() ?? 0;
                int right = b["price"]?.Value<int>() ?? 0;
                return side == "sell" ? left.CompareTo(right) : right.CompareTo(left);
            });
            return rows;
        }

        private int BestPrice(string itemId, string side)
        {
            List<JObject> rows = Book(itemId, side);
            return rows.Count > 0 ? (rows[0]["price"]?.Value<int>() ?? 0) : 0;
        }

        private JObject SelectedOrder()
        {
            if (string.IsNullOrEmpty(_orderId)) return null;
            foreach (JToken token in Orders)
            {
                JObject order = token as JObject;
                if (order != null && order["id"]?.ToString() == _orderId) return order;
            }
            return null;
        }

        private void SelectOrder(JObject order, bool mine)
        {
            _orderId = order["id"]?.ToString() ?? string.Empty;
            _itemId = order["itemId"]?.ToString() ?? string.Empty;
            if (mine) _tab = Tab.Mine;
            _priceInput.text = (order["price"]?.Value<int>() ?? 1).ToString();
            _qtyInput.text = mine ? (order["qty"]?.Value<int>() ?? 1).ToString() : "1";
            Rebuild();
        }

        private bool ValidOrderForm => FormPrice >= (_state?["limits"]?["minPrice"]?.Value<int>() ?? 1)
            && FormPrice <= (_state?["limits"]?["maxPrice"]?.Value<int>() ?? 200000)
            && FormQty > 0 && FormQty <= (_state?["limits"]?["maxQtyPerOrder"]?.Value<int>() ?? 500);

        private long FormTotal => (long)FormPrice * FormQty;
        private long FormFee => (long)Math.Floor(FormTotal * (_state?["setupFeePct"]?.Value<double>() ?? 0.025));

        /// <summary>Остаток срока на момент снимка, доигранный локальными часами.</summary>
        private long DeadlineFor(JObject order)
        {
            int remaining = order?["remainingSeconds"]?.Value<int>() ?? 0;
            return _snapshotAt + remaining * 1000L;
        }

        private static string Clock(long deadlineMs)
        {
            long seconds = Math.Max(0, (deadlineMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000);
            if (seconds >= 86400) return (seconds / 86400) + " д " + ((seconds % 86400) / 3600) + " ч";
            if (seconds >= 3600) return (seconds / 3600) + " ч " + ((seconds % 3600) / 60) + " мин";
            if (seconds >= 60) return (seconds / 60) + " мин";
            return seconds + " с";
        }

        private void TickTimers()
        {
            for (int i = _timers.Count - 1; i >= 0; i -= 1)
            {
                Text label = _timers[i].Key;
                if (label == null) { _timers.RemoveAt(i); continue; }
                long deadline = _timers[i].Value;
                label.text = Clock(deadline);
                label.color = deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < 600000 ? Warn : InkDim;
            }
        }

        private static int ParseNumber(string text, int fallback)
        {
            int value;
            return int.TryParse((text ?? string.Empty).Trim(), out value) && value >= 0 ? value : fallback;
        }

        private int FormPrice { get { return Math.Max(0, ParseNumber(_priceInput.text, 0)); } }

        private int FormQty { get { return Math.Max(0, ParseNumber(_qtyInput.text, 0)); } }

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
            _status.horizontalOverflow = HorizontalWrapMode.Wrap;

            // Левая колонка: разделы и категории товаров.
            RectTransform left = Child("Left", _panel);
            Place(left, 0f, 0f, 0f, 1f, new Vector2(14f, 32f), new Vector2(214f, -76f));

            _tabsColumn = Child("Tabs", left);
            Place(_tabsColumn, 0f, 1f, 1f, 1f, new Vector2(0f, -240f), new Vector2(0f, 0f));
            var tabsLayout = _tabsColumn.gameObject.AddComponent<VerticalLayoutGroup>();
            tabsLayout.spacing = 4f;
            tabsLayout.childForceExpandHeight = false;
            tabsLayout.childControlHeight = true;
            tabsLayout.childControlWidth = true;

            RectTransform categoryArea = Child("CategoryScroll", left);
            Place(categoryArea, 0f, 0f, 1f, 1f, Vector2.zero, new Vector2(0f, -248f));
            categoryArea.gameObject.AddComponent<RectMask2D>();
            var categoryScroll = categoryArea.gameObject.AddComponent<ScrollRect>();
            _categoryColumn = Child("Categories", categoryArea);
            _categoryColumn.anchorMin = new Vector2(0f, 1f);
            _categoryColumn.anchorMax = Vector2.one;
            _categoryColumn.pivot = new Vector2(0.5f, 1f);
            _categoryColumn.sizeDelta = Vector2.zero;
            _categoryColumn.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            categoryScroll.viewport = categoryArea;
            categoryScroll.content = _categoryColumn;
            RoaUiScroll.Configure(categoryScroll);
            var categoryLayout = _categoryColumn.gameObject.AddComponent<VerticalLayoutGroup>();
            categoryLayout.spacing = 2f;
            categoryLayout.childForceExpandHeight = false;
            categoryLayout.childControlHeight = true;
            categoryLayout.childControlWidth = true;

            // Центр: товары книги, строки ордеров или полка.
            RectTransform scrollArea = Child("Scroll", _panel);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(222f, 32f), new Vector2(-396f, -116f));
            RectTransform toolbar = Child("SearchBar", _panel);
            Place(toolbar, 0f, 1f, 1f, 1f, new Vector2(222f, -108f), new Vector2(-396f, -76f));
            _searchInput = NumberInput("Search", toolbar, "Поиск предмета…");
            _searchInput.contentType = InputField.ContentType.Standard;
            _searchInput.characterLimit = 64;
            Place((RectTransform)_searchInput.transform, 0f, 0f, 1f, 1f, Vector2.zero, new Vector2(-145f, 0f));
            _searchInput.onValueChanged.AddListener(value => Rebuild());
            Button sortButton = TextButton("Sort", toolbar, "По имени ↓", 12, out Text sortText);
            Place((RectTransform)sortButton.transform, 1f, 0f, 1f, 1f, new Vector2(-140f, 0f), Vector2.zero);
            sortButton.onClick.AddListener(() => {
                _sort = (_sort + 1) % 3;
                sortText.text = new[] { "По имени ↓", "Дешевле ↓", "Выкуп дороже ↓" }[_sort];
                Rebuild();
            });
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            RectTransform viewport = Child("Viewport", scrollArea);
            Stretch(viewport, 0f);
            viewport.gameObject.AddComponent<RectMask2D>();
            _list = Child("Content", viewport);
            _list.anchorMin = new Vector2(0f, 1f);
            _list.anchorMax = new Vector2(1f, 1f);
            _list.pivot = new Vector2(0.5f, 1f);
            // Ширина строго по окну прокрутки: у нового RectTransform sizeDelta
            // равен (100,100), и список вылезал на 50 px в каждую сторону —
            // маска срезала начало названий и конец строки ордера.
            _list.sizeDelta = Vector2.zero;
            _list.anchoredPosition = Vector2.zero;
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

            // Правая колонка: форма ордера или карточка выбранного ордера.
            _detail = Child("Detail", _panel);
            Place(_detail, 1f, 0f, 1f, 1f, new Vector2(-388f, 32f), new Vector2(-14f, -76f));
            _detail.gameObject.AddComponent<Image>().color = QuietBg;

            // Поля формы переживают перерисовку: иначе набранная цена пропадала
            // бы при каждом обновлении снимка книги.
            _priceInput = NumberInput("Price", _detail, "Цена за штуку");
            Place((RectTransform)_priceInput.transform, 0f, 1f, 1f, 1f, new Vector2(12f, -150f), new Vector2(-12f, -118f));
            _qtyInput = NumberInput("Qty", _detail, "Количество");
            Place((RectTransform)_qtyInput.transform, 0f, 1f, 1f, 1f, new Vector2(12f, -196f), new Vector2(-12f, -164f));
            Text priceCaption = Label("Caption", (RectTransform)_priceInput.transform, 11, TextAnchor.MiddleLeft, InkDim);
            Place(priceCaption.rectTransform, 0f, 1f, 1f, 1f, new Vector2(0f, 2f), new Vector2(0f, 18f));
            priceCaption.text = "Цена за штуку";
            Text qtyCaption = Label("Caption", (RectTransform)_qtyInput.transform, 11, TextAnchor.MiddleLeft, InkDim);
            Place(qtyCaption.rectTransform, 0f, 1f, 1f, 1f, new Vector2(0f, 1f), new Vector2(0f, 14f));
            qtyCaption.text = "Количество";
            _priceInput.gameObject.SetActive(false);
            _qtyInput.gameObject.SetActive(false);
        }

        // ------------------------------------------------------------------
        // Перерисовка

        private void Rebuild()
        {
            if (_root == null || !_root.activeSelf) return;

            // Экономика v3: у каждой столицы своя книга, сервер называет её.
            string marketName = _state?["marketName"]?.ToString();
            _title.text = string.IsNullOrEmpty(marketName) ? "РЫНОК ПУСТОШИ" : "РЫНОК · " + marketName.ToUpperInvariant();
            // Налог продавца может быть дробным: премиум и жители базы снижают ставку.
            _terms.text = _tab == Tab.Sin
                ? "Обменник сини: сбор за ордер " + RoaPlural.Marks(SinOrderFee) + ", налога нет · у вас " + Marks
                    + " марок, на счёте " + SinBalance + " сини"
                : "Налог с продажи " + (TaxPct * 100f).ToString("0.#") + "% · сбор за ордер "
                    + (SetupFeePct * 100f).ToString("0.#") + "% · у вас " + RoaPlural.Marks(Marks);
            _status.text = string.IsNullOrEmpty(_note)
                ? (_pending ? "Аукционер сверяет книгу…" : "Купленное, проданное и возвраты ждут на полке у аукционера.")
                : _note;
            _status.color = string.IsNullOrEmpty(_note) ? InkDim : Accent;

            RebuildTabs();
            RebuildCategories();
            ClearRows(_rows);
            _timers.Clear();

            switch (_tab)
            {
                case Tab.Sell:
                    if (string.IsNullOrEmpty(_itemId)) BuildBackpackPage(); else BuildBookPage();
                    break;
                case Tab.Mine: BuildMyOrdersPage(); break;
                case Tab.Shelf: BuildShelfPage(); break;
                case Tab.Sin: BuildSinPage(); break;
                case Tab.Journal: BuildJournalPage(); break;
                default:
                    if (string.IsNullOrEmpty(_itemId)) BuildMarketPage(); else BuildBookPage();
                    break;
            }

            RebuildDetail();
            TickTimers();
        }

        private void RebuildTabs()
        {
            foreach (Transform child in _tabsColumn) Destroy(child.gameObject);
            int mine = _state?["mineCount"]?.Value<int>() ?? 0;
            JObject shelf = Shelf;
            int shelfSilver = shelf?["silver"]?.Value<int>() ?? 0;
            int shelfItems = 0;
            foreach (JToken row in shelf?["items"] as JArray ?? new JArray()) shelfItems += row["qty"]?.Value<int>() ?? 0;

            AddTab(Tab.Buy, "ПОКУПКА");
            AddTab(Tab.Sell, "ПРОДАЖА");
            AddTab(Tab.Mine, "МОИ ОРДЕРА" + (mine > 0 ? " (" + mine + ")" : string.Empty));
            AddTab(Tab.Shelf, "ПОЛКА" + (shelfSilver > 0 || shelfItems > 0 ? " ●" : string.Empty));
            AddTab(Tab.Journal, "ЖУРНАЛ СДЕЛОК");
            if (_sinAccount != null) AddTab(Tab.Sin, "СИНЬ · " + SinBalance + (SinPremium ? " ★" : string.Empty));
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
                _itemId = string.Empty;
                _orderId = string.Empty;
                _note = string.Empty;
                _premiumConfirm = false;
                if (captured == Tab.Sin) PrepareSinForm();
                Rebuild();
            });
        }

        private void RebuildCategories()
        {
            ClearRows(_categoryRows);
            if (_tab != Tab.Buy || !string.IsNullOrEmpty(_itemId))
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

            AddCategory("all", "Все товары", MarketItems.Count);
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
            button.onClick.AddListener(() => { _category = captured; Rebuild(); });
            _categoryRows.Add(row);
        }

        // --- товары книги -------------------------------------------------

        private void BuildMarketPage()
        {
            int shown = 0;
            var rows = MarketItems.OfType<JObject>().Where(row => MatchesSearch(row["itemId"]?.ToString()));
            rows = _sort == 1 ? rows.OrderBy(row => (row["sellPrice"]?.Value<int>() ?? 0) > 0 ? row["sellPrice"].Value<int>() : int.MaxValue)
                : _sort == 2 ? rows.OrderByDescending(row => row["buyPrice"]?.Value<int>() ?? 0)
                : rows.OrderBy(row => RoaItemData.Name(row["itemId"]?.ToString()));
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                if (_category != "all" && (row["category"]?.ToString() ?? "misc") != _category) continue;
                shown += 1;
                AddMarketItemRow(row);
            }
            if (shown == 0)
            {
                AddNote(_state == null
                    ? (_pending ? "Аукционер раскладывает книгу…" : "Рынок не ответил.")
                    : "По запросу ничего не найдено. Измените поиск или категорию.");
            }
        }

        private void AddMarketItemRow(JObject row)
        {
            string itemId = row["itemId"]?.ToString() ?? string.Empty;
            int sellQty = row["sellQty"]?.Value<int>() ?? 0;
            int sellPrice = row["sellPrice"]?.Value<int>() ?? 0;
            int buyQty = row["buyQty"]?.Value<int>() ?? 0;
            int buyPrice = row["buyPrice"]?.Value<int>() ?? 0;

            var go = new GameObject("Item", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 38f;
            var back = go.AddComponent<Image>();
            back.color = row["mine"]?.Value<bool>() == true ? RowSelected : RowBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = back;
            var rect = (RectTransform)go.transform;

            Text name = Label("Name", rect, 14, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(name.rectTransform, 0f, 0f, 0.44f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = RoaItemData.Name(itemId);

            Text sell = Label("Sell", rect, 12, TextAnchor.MiddleLeft, sellQty > 0 ? Ink : InkDim);
            Place(sell.rectTransform, 0.44f, 0f, 0.72f, 1f, new Vector2(0f, 0f), new Vector2(-4f, 0f));
            sell.text = sellQty > 0 ? "продают " + sellQty + " шт от " + sellPrice : "не продают";

            Text buy = Label("Buy", rect, 12, TextAnchor.MiddleLeft, buyQty > 0 ? Good : InkDim);
            Place(buy.rectTransform, 0.72f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            buy.text = buyQty > 0 ? "выкупают " + buyQty + " шт по " + buyPrice : "нет заявок";

            string captured = itemId;
            button.onClick.AddListener(() => SelectItem(captured));
            _rows.Add(go);
        }

        private void SelectItem(string itemId)
        {
            _itemId = itemId;
            _orderId = string.Empty;
            _note = string.Empty;
            // Предложение по умолчанию: цена из книги, иначе каталожная.
            int suggested = _tab == Tab.Sell
                ? (BestPrice(itemId, "sell") > 0 ? BestPrice(itemId, "sell") : Mathf.Max(1, RoaItemData.BasePrice(itemId) * 2))
                : (BestPrice(itemId, "buy") > 0 ? BestPrice(itemId, "buy") : Mathf.Max(1, RoaItemData.BasePrice(itemId)));
            _priceInput.text = suggested.ToString();
            _qtyInput.text = _tab == Tab.Sell && Fungible(itemId) ? Mathf.Min(500, Mathf.Max(1, Backpack(itemId))).ToString() : "1";
            Rebuild();
            RequestState();
        }

        private bool MatchesSearch(string itemId)
        {
            string query = _searchInput != null ? _searchInput.text.Trim() : string.Empty;
            return query.Length == 0 || RoaItemData.Name(itemId).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        // --- рюкзак для продажи -------------------------------------------

        private void BuildBackpackPage()
        {
            RoaInventory inventory = Inventory;
            if (inventory == null) { AddNote("Рюкзак недоступен."); return; }
            int shown = 0;
            foreach (RoaInventory.Row item in inventory.Items)
            {
                if (string.IsNullOrEmpty(item.Id) || item.Id == "silver" || item.Qty <= 0) continue;
                if (!MatchesSearch(item.Id)) continue;
                shown += 1;
                AddBackpackRow(item.Id, item.Qty);
            }
            if (shown == 0) AddNote("В рюкзаке нечего продавать.");
        }

        private void AddBackpackRow(string itemId, int qty)
        {
            var go = new GameObject("Backpack", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 34f;
            var back = go.AddComponent<Image>();
            back.color = RowBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = back;
            var rect = (RectTransform)go.transform;

            Text name = Label("Name", rect, 13, TextAnchor.MiddleLeft, Ink);
            Place(name.rectTransform, 0f, 0f, 0.55f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = RoaItemData.Name(itemId) + " ×" + qty;

            int best = BestPrice(itemId, "buy");
            Text hint = Label("Hint", rect, 11, TextAnchor.MiddleRight, best > 0 ? Good : InkDim);
            Place(hint.rectTransform, 0.55f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            hint.text = best > 0 ? "выкупают по " + best : "каталог " + RoaItemData.BasePrice(itemId);

            string captured = itemId;
            button.onClick.AddListener(() => SelectItem(captured));
            _rows.Add(go);
        }

        // --- книга по предмету --------------------------------------------

        private void BuildBookPage()
        {
            AddBackRow(RoaItemData.Name(_itemId) + " · книга ордеров");
            if (_state?["historyItemId"]?.ToString() == _itemId)
            {
                foreach (JToken row in _state?["history"] as JArray ?? new JArray())
                {
                    int hours = row["hours"]?.Value<int>() ?? 24;
                    string period = hours == 24 ? "24 часа" : (hours / 24) + " дней";
                    int volume = row["qty"]?.Value<int>() ?? 0;
                    AddInfoRow(period, volume > 0 ? "средняя " + row["average"] + " · " + volume + " шт · "
                        + row["min"] + "–" + row["max"] : "нет сделок");
                }
            }
            List<JObject> sells = Book(_itemId, "sell");
            List<JObject> buys = Book(_itemId, "buy");

            AddHeading("ПРОДАЮТ" + (sells.Count == 0 ? " — пусто" : string.Empty));
            foreach (JObject order in sells) AddOrderRow(order);
            AddHeading("ВЫКУПАЮТ" + (buys.Count == 0 ? " — пусто" : string.Empty));
            foreach (JObject order in buys) AddOrderRow(order);
        }

        private void AddOrderRow(JObject order)
        {
            string id = order["id"]?.ToString() ?? string.Empty;
            string side = order["side"]?.ToString() ?? "sell";
            string itemId = order["itemId"]?.ToString() ?? string.Empty;
            int qty = order["qty"]?.Value<int>() ?? 0;
            int price = order["price"]?.Value<int>() ?? 0;
            bool mine = order["mine"]?.Value<bool>() == true;

            var go = new GameObject("Order", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 44f;
            go.AddComponent<Image>().color = mine ? RowSelected : RowBg;
            var rect = (RectTransform)go.transform;

            Text priceText = Label("Price", rect, 15, TextAnchor.UpperLeft, side == "sell" ? Ink : Good, FontStyle.Bold);
            Place(priceText.rectTransform, 0f, 0f, 0.3f, 1f, new Vector2(10f, 20f), new Vector2(-4f, -3f));
            priceText.text = price + " за шт";

            Text qtyText = Label("Qty", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(qtyText.rectTransform, 0f, 0f, 0.3f, 1f, new Vector2(10f, 4f), new Vector2(-4f, -22f));
            qtyText.text = qty + " шт · всего " + (qty * price);

            Text owner = Label("Owner", rect, 12, TextAnchor.UpperLeft, InkDim);
            Place(owner.rectTransform, 0.3f, 0f, 0.62f, 1f, new Vector2(0f, 20f), new Vector2(-4f, -3f));
            owner.text = mine ? "ваш ордер" : (order["ownerName"]?.ToString() ?? "—");

            Text extra = Label("Extra", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(extra.rectTransform, 0.3f, 0f, 0.62f, 1f, new Vector2(0f, 4f), new Vector2(-4f, -22f));
            string artifacts = AuctionArtifactLine(order);
            extra.text = string.IsNullOrEmpty(artifacts)
                ? "исполнено " + (order["filled"]?.Value<int>() ?? 0)
                : artifacts.TrimStart('\n').Replace("\n", " · ");

            Text timer = Label("Timer", rect, 11, TextAnchor.UpperRight, InkDim);
            Place(timer.rectTransform, 0.62f, 0f, 1f, 1f, new Vector2(0f, 20f), new Vector2(-10f, -3f));
            _timers.Add(new KeyValuePair<Text, long>(timer, DeadlineFor(order)));

            string label;
            Action action;
            if (mine)
            {
                label = "Изменить";
                action = () => SelectOrder(order, true);
            }
            else if (side == "sell")
            {
                label = "Купить…";
                action = () => SelectOrder(order, false);
            }
            else
            {
                int have = Backpack(itemId);
                int take = Mathf.Min(qty, have);
                label = have > 0 ? "Продать…" : "Нет товара";
                action = have > 0 ? (Action)(() => SelectOrder(order, false)) : null;
            }
            Button button = TextButton("Act", rect, label, 12, out Text buttonLabel);
            var buttonRect = (RectTransform)button.transform;
            buttonRect.anchorMin = new Vector2(0.62f, 0f);
            buttonRect.anchorMax = new Vector2(1f, 0f);
            buttonRect.offsetMin = new Vector2(0f, 5f);
            buttonRect.offsetMax = new Vector2(-10f, 27f);
            button.GetComponent<Image>().color = action == null ? QuietBg : ButtonBg;
            buttonLabel.color = action == null ? InkDim : Accent;
            Action captured = action;
            button.onClick.AddListener(() =>
            {
                if (captured != null && Interaction != null && Interaction.Socket != null) captured();
            });

            _rows.Add(go);
        }

        // --- мои ордера ---------------------------------------------------

        private void BuildMyOrdersPage()
        {
            int shown = 0;
            foreach (JToken token in Orders)
            {
                JObject order = token as JObject;
                if (order == null || order["mine"]?.Value<bool>() != true || !MatchesSearch(order["itemId"]?.ToString())) continue;
                shown += 1;
                AddMyOrderRow(order);
            }
            if (shown == 0) AddNote("У вас нет ордеров. Раздел «ПРОДАЖА» выставит товар, «ПОКУПКА» — заявку на выкуп.");
        }

        private void AddMyOrderRow(JObject order)
        {
            string id = order["id"]?.ToString() ?? string.Empty;
            bool sell = (order["side"]?.ToString() ?? "sell") == "sell";
            int qty = order["qty"]?.Value<int>() ?? 0;
            int price = order["price"]?.Value<int>() ?? 0;

            var go = new GameObject("MyOrder", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 44f;
            var back = go.AddComponent<Image>();
            back.color = _orderId == id ? RowSelected : RowBg;
            var button = go.AddComponent<Button>();
            button.targetGraphic = back;
            var rect = (RectTransform)go.transform;

            Text name = Label("Name", rect, 14, TextAnchor.UpperLeft, sell ? Ink : Good, FontStyle.Bold);
            Place(name.rectTransform, 0f, 0f, 0.5f, 1f, new Vector2(10f, 20f), new Vector2(-4f, -3f));
            name.text = (sell ? "Продажа: " : "Выкуп: ") + RoaItemData.Name(order["itemId"]?.ToString());

            Text detail = Label("Detail", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(detail.rectTransform, 0f, 0f, 0.5f, 1f, new Vector2(10f, 4f), new Vector2(-4f, -22f));
            detail.text = qty + " шт по " + price + " · исполнено " + (order["filled"]?.Value<int>() ?? 0);

            Text total = Label("Total", rect, 12, TextAnchor.UpperLeft, InkDim);
            Place(total.rectTransform, 0.5f, 0f, 0.78f, 1f, new Vector2(0f, 20f), new Vector2(-4f, -3f));
            total.text = sell ? "в книге на " + (qty * price) : "заморожено " + (qty * price);

            Text timer = Label("Timer", rect, 11, TextAnchor.UpperRight, InkDim);
            Place(timer.rectTransform, 0.78f, 0f, 1f, 1f, new Vector2(0f, 20f), new Vector2(-10f, -3f));
            _timers.Add(new KeyValuePair<Text, long>(timer, DeadlineFor(order)));

            Button cancel = TextButton("Cancel", rect, "Отменить", 12, out Text cancelLabel);
            var cancelRect = (RectTransform)cancel.transform;
            cancelRect.anchorMin = new Vector2(0.78f, 0f);
            cancelRect.anchorMax = new Vector2(1f, 0f);
            cancelRect.offsetMin = new Vector2(0f, 5f);
            cancelRect.offsetMax = new Vector2(-10f, 27f);
            cancel.GetComponent<Image>().color = QuietBg;
            cancelLabel.color = Warn;
            string captured = id;
            cancel.onClick.AddListener(() =>
            {
                SendMarket(done => RoaAuctionNet.Cancel(Interaction.Socket, captured, done));
            });
            button.onClick.AddListener(() => SelectOrder(order, true));
            _rows.Add(go);
        }

        // --- полка --------------------------------------------------------

        private void BuildJournalPage()
        {
            AddHeading("ПОСЛЕДНИЕ ОПЕРАЦИИ В ЭТОМ ГОРОДЕ");
            int count = 0;
            foreach (JToken row in _state?["activity"] as JArray ?? new JArray())
            {
                string itemId = row["itemId"]?.ToString();
                if (!MatchesSearch(itemId)) continue;
                string kind = row["kind"]?.ToString();
                string action = kind == "bought" ? "Куплено" : kind == "sold" ? "Продано"
                    : kind == "expired" ? "Истёк срок" : kind == "updated" ? "Обновлено" : "Отменено";
                string date = DateTimeOffset.FromUnixTimeMilliseconds(row["at"]?.Value<long>() ?? 0)
                    .ToLocalTime().ToString("dd.MM HH:mm");
                AddNote(date + " · " + action + " · " + RoaItemData.Name(itemId) + "\n"
                    + row["qty"] + " шт по " + row["price"] + (kind == "sold" ? " · налог " + row["tax"] : string.Empty));
                count++;
            }
            if (count == 0) AddNote("Операций пока нет. Здесь появятся сделки, изменения, отмены и истёкшие заявки.");
        }

        private void BuildShelfPage()
        {
            JObject shelf = Shelf;
            int silver = shelf?["silver"]?.Value<int>() ?? 0;
            JArray items = shelf?["items"] as JArray ?? new JArray();
            if (silver <= 0 && items.Count == 0)
            {
                AddNote("Полка пуста. Сюда попадают выручка проданного, купленный товар, отменённые ордера и замороженные марки.");
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
                case "bought": return "куплено по ордеру";
                case "cancelled": return "отменённый ордер";
                case "expired": return "срок ордера вышел";
                default: return "возврат";
            }
        }

        private void AddShelfRow(string title, int qty, string reason)
        {
            var go = new GameObject("ShelfRow", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 32f;
            go.AddComponent<Image>().color = RowBg;
            var rect = (RectTransform)go.transform;

            Text name = Label("Name", rect, 13, TextAnchor.MiddleLeft, Ink);
            Place(name.rectTransform, 0f, 0f, 0.7f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = title + " ×" + qty;

            Text hint = Label("Reason", rect, 11, TextAnchor.MiddleRight, InkDim);
            Place(hint.rectTransform, 0.7f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            hint.text = reason;
            _rows.Add(go);
        }

        // --- синь -----------------------------------------------------------

        /// <summary>Подсказка цены, пока книга обменника пуста: у сини нет каталожной цены.</summary>
        private const int SinStarterPrice = 25;

        private void PrepareSinForm()
        {
            int best = SinBestPrice(_sinSell ? "buy" : "sell");
            _priceInput.text = (best > 0 ? best : SinStarterPrice).ToString();
            _qtyInput.text = "1";
        }

        private void BuildSinPage()
        {
            if (_sinAccount == null) { AddNote("Счёт сини недоступен."); return; }
            AddHeading("СЧЁТ АККАУНТА");
            AddInfoRow("Синь на счёте", SinBalance.ToString());
            AddInfoRow("Премиум", SinPremium
                ? "до " + DateLabel(_sinAccount["premiumUntil"]?.Value<long>() ?? 0)
                : "нет · " + (_sinAccount["premiumPriceSin"]?.Value<int>() ?? 0) + " сини за "
                    + (_sinAccount["premiumDays"]?.Value<int>() ?? 0) + " д");
            if (SinPremium || (_sinAccount["focus"]?.Value<int>() ?? 0) > 0)
                AddInfoRow("Фокус", (_sinAccount["focus"]?.Value<int>() ?? 0) + " из " + (_sinAccount["focusCap"]?.Value<int>() ?? 0));
            AddNote("Премиум: налог рынка ниже, +50% опыта, марок с NPC и добычи при сборе, фокус для возврата "
                + "материалов на станках участков, работы на личной базе быстрее.");

            List<JObject> sells = SinBook("sell");
            List<JObject> buys = SinBook("buy");
            AddHeading("ПРОДАЮТ СИНЬ" + (sells.Count == 0 ? " — пусто" : string.Empty));
            foreach (JObject order in sells) AddSinOrderRow(order);
            AddHeading("ВЫКУПАЮТ СИНЬ" + (buys.Count == 0 ? " — пусто" : string.Empty));
            foreach (JObject order in buys) AddSinOrderRow(order);

            int shelfSilver = _sinExchange?["shelf"]?["silver"]?.Value<int>() ?? 0;
            if (shelfSilver > 0)
            {
                AddHeading("ПОЛКА ОБМЕННИКА");
                AddShelfRow("Марки", shelfSilver, "выручка и возвраты");
            }
        }

        private void AddInfoRow(string title, string value)
        {
            var go = new GameObject("InfoRow", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 30f;
            go.AddComponent<Image>().color = RowBg;
            var rect = (RectTransform)go.transform;

            Text name = Label("Name", rect, 13, TextAnchor.MiddleLeft, Ink);
            Place(name.rectTransform, 0f, 0f, 0.45f, 1f, new Vector2(10f, 0f), new Vector2(-4f, 0f));
            name.text = title;

            Text text = Label("Value", rect, 13, TextAnchor.MiddleRight, Accent, FontStyle.Bold);
            Place(text.rectTransform, 0.45f, 0f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-10f, 0f));
            text.text = value;
            _rows.Add(go);
        }

        private void AddSinOrderRow(JObject order)
        {
            string id = order["id"]?.ToString() ?? string.Empty;
            bool sell = (order["side"]?.ToString() ?? "sell") == "sell";
            int qty = order["qty"]?.Value<int>() ?? 0;
            int price = order["price"]?.Value<int>() ?? 0;
            bool mine = order["mine"]?.Value<bool>() == true;

            var go = new GameObject("SinOrder", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 44f;
            go.AddComponent<Image>().color = mine ? RowSelected : RowBg;
            var rect = (RectTransform)go.transform;

            Text priceText = Label("Price", rect, 15, TextAnchor.UpperLeft, sell ? Ink : Good, FontStyle.Bold);
            Place(priceText.rectTransform, 0f, 0f, 0.34f, 1f, new Vector2(10f, 20f), new Vector2(-4f, -3f));
            priceText.text = RoaPlural.Marks(price) + " за синь";

            Text qtyText = Label("Qty", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(qtyText.rectTransform, 0f, 0f, 0.34f, 1f, new Vector2(10f, 4f), new Vector2(-4f, -22f));
            qtyText.text = qty + " сини · всего " + (qty * price);

            Text owner = Label("Owner", rect, 12, TextAnchor.UpperLeft, InkDim);
            Place(owner.rectTransform, 0.34f, 0f, 0.62f, 1f, new Vector2(0f, 20f), new Vector2(-4f, -3f));
            owner.text = mine ? "ваш ордер" : (order["ownerName"]?.ToString() ?? "—");

            Text timer = Label("Timer", rect, 11, TextAnchor.LowerLeft, InkDim);
            Place(timer.rectTransform, 0.34f, 0f, 0.62f, 1f, new Vector2(0f, 4f), new Vector2(-4f, -22f));
            _timers.Add(new KeyValuePair<Text, long>(timer, _sinSnapshotAt + (order["remainingSeconds"]?.Value<int>() ?? 0) * 1000L));

            string label;
            Action action;
            if (mine)
            {
                label = "Отменить";
                action = () => SendSin(done => RoaAccountSinNet.Cancel(Interaction.Socket, id, done));
            }
            else if (sell)
            {
                int take = Mathf.Min(qty, price > 0 ? Marks / price : 0);
                label = take > 0 ? "Купить " + take : "Мало марок";
                action = take > 0 ? (Action)(() => SendSin(done => RoaAccountSinNet.TakeOrder(Interaction.Socket, id, true, take, done))) : null;
            }
            else
            {
                int take = Mathf.Min(qty, SinBalance);
                label = take > 0 ? "Продать " + take : "Нет сини";
                action = take > 0 ? (Action)(() => SendSin(done => RoaAccountSinNet.TakeOrder(Interaction.Socket, id, false, take, done))) : null;
            }
            Button button = TextButton("Act", rect, label, 12, out Text buttonLabel);
            var buttonRect = (RectTransform)button.transform;
            buttonRect.anchorMin = new Vector2(0.62f, 0f);
            buttonRect.anchorMax = new Vector2(1f, 1f);
            buttonRect.offsetMin = new Vector2(0f, 8f);
            buttonRect.offsetMax = new Vector2(-10f, -8f);
            button.GetComponent<Image>().color = action == null ? QuietBg : ButtonBg;
            buttonLabel.color = action == null ? InkDim : (mine ? Warn : Accent);
            Action captured = action;
            button.onClick.AddListener(() =>
            {
                if (captured != null && Interaction != null && Interaction.Socket != null) captured();
            });
            _rows.Add(go);
        }

        private void RebuildSinPanel()
        {
            AddDetailText("ОБМЕННИК СИНИ", 15, Accent, 24f, FontStyle.Bold);
            float top = _detailCursor;
            AddSinSideButton("Купить синь", false, 12f, top);
            AddSinSideButton("Продать синь", true, 184f, top);
            _detailCursor = top - 34f;
            AddDetailText("Цена одной сини в марках и количество:", 11, InkDim, 30f);

            // Поля формы стоят на своих местах; подписи и кнопки ложатся ниже.
            _detailCursor = -204f;
            int price = FormPrice;
            int qty = FormQty;
            int fee = SinOrderFee;
            if (_sinSell)
            {
                int best = SinBestPrice("buy");
                AddDetailText(best > 0
                    ? "Дороже всего выкупают по " + best + " — ордер не дороже этой цены продастся сразу."
                    : "Заявок на выкуп нет: ордер будет ждать покупателя.", 11, InkDim, 34f);
                AddDurationRow(_sinExchange?["durationChoicesHours"] as JArray);
                AddDetailText("Со счёта уйдёт " + qty + " сини, сбор " + RoaPlural.Marks(fee) + ", на руки не меньше "
                    + RoaPlural.Marks((price * qty)) + ".", 11, qty > SinBalance || fee > Marks ? Warn : InkDim, 40f);
            }
            else
            {
                int best = SinBestPrice("sell");
                AddDetailText(best > 0
                    ? "Дешевле всего продают по " + best + " — ордер не дешевле этой цены исполнится сразу."
                    : "Сейчас синь никто не продаёт: ордер будет ждать продавца.", 11, InkDim, 34f);
                AddDurationRow(_sinExchange?["durationChoicesHours"] as JArray);
                AddDetailText("Заморозится " + RoaPlural.Marks((price * qty)) + ", сбор " + fee + ". У вас " + Marks + ".",
                    11, price * qty + fee > Marks ? Warn : InkDim, 40f);
            }

            bool ready = !SinBusy && price > 0 && qty > 0 && (_sinSell ? qty <= SinBalance && fee <= Marks : price * qty + fee <= Marks);
            AddDetailButton(ready ? "ПОСТАВИТЬ ОРДЕР НА " + _durationHours + " Ч" : "УКАЖИТЕ ЦЕНУ И КОЛИЧЕСТВО",
                ready ? ButtonBg : QuietBg, () =>
                {
                    if (!ready) return;
                    bool sell = _sinSell;
                    int hours = _durationHours;
                    SendSin(done => RoaAccountSinNet.PlaceOrder(Interaction.Socket, sell, qty, price, hours, done));
                });

            int premiumPrice = _sinAccount?["premiumPriceSin"]?.Value<int>() ?? 0;
            int premiumDays = _sinAccount?["premiumDays"]?.Value<int>() ?? 0;
            bool canPremium = !SinBusy && _sinAccount != null && premiumPrice > 0 && SinBalance >= premiumPrice;
            // Покупка премиума — в два нажатия: первое спрашивает подтверждение.
            string premiumCaption = _premiumConfirm && canPremium
                ? "ПОДТВЕРДИТЬ: СПИСАТЬ " + premiumPrice + " СИНИ"
                : (SinPremium ? "ПРОДЛИТЬ ПРЕМИУМ: " : "ПРЕМИУМ: ") + premiumPrice + " СИНИ / " + premiumDays + " Д";
            AddDetailButton(premiumCaption, canPremium ? (_premiumConfirm ? ConfirmBg : ButtonBg) : QuietBg, () =>
                {
                    if (!canPremium) return;
                    if (!_premiumConfirm)
                    {
                        _premiumConfirm = true;
                        Rebuild();
                        return;
                    }
                    SendSin(done => RoaAccountSinNet.BuyPremium(Interaction.Socket, done));
                });

            if ((_sinExchange?["shelf"]?["silver"]?.Value<int>() ?? 0) > 0)
                AddDetailButton("ЗАБРАТЬ МАРКИ С ПОЛКИ", ButtonBg, () => SendSin(done => RoaAccountSinNet.Claim(Interaction.Socket, done)));
        }

        private void AddSinSideButton(string caption, bool sell, float x, float top)
        {
            Button button = TextButton("SinSide", _detail, caption, 12, out Text label);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(x, top);
            rect.sizeDelta = new Vector2(166f, 28f);
            button.GetComponent<Image>().color = _sinSell == sell ? ButtonBg : QuietBg;
            label.color = _sinSell == sell ? Accent : Ink;
            button.onClick.AddListener(() =>
            {
                _sinSell = sell;
                PrepareSinForm();
                Rebuild();
            });
            _detailRows.Add(button.gameObject);
        }

        // --- вспомогательные строки списка --------------------------------

        private void AddBackRow(string caption)
        {
            var go = new GameObject("Back", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 32f;
            var back = go.AddComponent<Image>();
            back.color = RowSelected;
            var button = go.AddComponent<Button>();
            button.targetGraphic = back;
            Text text = Label("Text", (RectTransform)go.transform, 13, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(text.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 0f), new Vector2(-10f, 0f));
            text.text = "‹  " + caption;
            button.onClick.AddListener(() => { _itemId = string.Empty; _note = string.Empty; Rebuild(); });
            _rows.Add(go);
        }

        private void AddHeading(string caption)
        {
            var go = new GameObject("Heading", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 24f;
            Text text = Label("Text", (RectTransform)go.transform, 11, TextAnchor.LowerLeft, InkDim, FontStyle.Bold);
            Place(text.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 2f), new Vector2(-10f, -2f));
            text.text = caption;
            _rows.Add(go);
        }

        private void AddNote(string text)
        {
            var go = new GameObject("Note", typeof(RectTransform));
            go.transform.SetParent(_list, false);
            go.AddComponent<LayoutElement>().preferredHeight = 60f;
            Text label = Label("Text", (RectTransform)go.transform, 13, TextAnchor.UpperLeft, InkDim);
            Place(label.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 6f), new Vector2(-10f, -6f));
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.text = text;
            _rows.Add(go);
        }

        // ------------------------------------------------------------------
        // Правая колонка

        private void RebuildDetail()
        {
            ClearRows(_detailRows);
            bool form = (_tab == Tab.Buy || _tab == Tab.Sell) && !string.IsNullOrEmpty(_itemId);
            bool sellForm = _tab == Tab.Sell;
            JObject selected = SelectedOrder();
            bool edit = _tab == Tab.Mine && selected != null;
            bool trade = form && selected != null && selected["mine"]?.Value<bool>() != true;
            bool showInputs = (form && (sellForm || Fungible(_itemId))) || (_tab == Tab.Sin && _sinExchange != null) || edit;
            _priceInput.gameObject.SetActive(showInputs);
            _qtyInput.gameObject.SetActive(showInputs || trade);
            if (trade) { _priceInput.gameObject.SetActive(false); RebuildTradeForm(selected); return; }

            if (_tab == Tab.Shelf) { RebuildShelfPanel(); return; }
            if (_tab == Tab.Sin) { RebuildSinPanel(); return; }
            if (_tab == Tab.Mine) { RebuildOrderPanel(); return; }
            if (_tab == Tab.Journal) { AddDetailText("Журнал хранит последние операции этого города. Предметы и возвраты забираются в разделе «ПОЛКА». История цен в книге товара учитывает только совершённые сделки.", 13, InkDim, 140f); return; }
            if (!form)
            {
                AddDetailText(_tab == Tab.Sell
                    ? "Выберите предмет из рюкзака: справа появится форма ордера на продажу, в центре — книга по нему."
                    : "Выберите товар слева: в центре откроется книга ордеров, справа — форма ордера на выкуп.", 13, InkDim, 90f);
                return;
            }
            if (sellForm) RebuildSellForm(); else RebuildBuyForm();
        }

        private void RebuildTradeForm(JObject order)
        {
            bool buying = order["side"]?.ToString() == "sell";
            int price = order["price"]?.Value<int>() ?? 0;
            int available = order["qty"]?.Value<int>() ?? 0;
            int quantity = FormQty;
            long total = (long)price * quantity;
            long tax = buying ? 0 : (long)Math.Floor(total * (_state?["taxPct"]?.Value<double>() ?? 0.08));
            AddDetailText(buying ? "КУПИТЬ СЕЙЧАС" : "ПРОДАТЬ СЕЙЧАС", 15, Accent, 24f, FontStyle.Bold);
            AddDetailText(RoaItemData.Name(_itemId), 14, Ink, 24f);
            AddDetailText("Цена за штуку: " + price + "\nДоступно: " + available + " шт", 12, InkDim, 40f);
            string artifacts = AuctionArtifactLine(order);
            if (artifacts.Length > 0) AddDetailText(artifacts.Trim(), 11, InkDim, 46f);
            _detailCursor = -204f;
            AddDetailText(buying ? "К оплате: " + total + " марок."
                : "Налог: " + tax + " · получите: " + (total - tax) + " марок.", 13, Ink, 38f);
            AddDetailText("Без сбора за размещение. Укажите количество в поле выше.", 12, InkDim, 40f);
            bool ready = quantity > 0 && quantity <= available && (buying ? total <= Marks : quantity <= Backpack(_itemId));
            string id = order["id"]?.ToString();
            AddDetailButton(ready ? (buying ? "КУПИТЬ " : "ПРОДАТЬ ") + quantity + " ШТ" : "ПРОВЕРЬТЕ КОЛИЧЕСТВО И БАЛАНС",
                ready ? ButtonBg : QuietBg, () => {
                    if (!ready) return;
                    SendMarket(done => buying ? RoaAuctionNet.BuyNow(Interaction.Socket, id, quantity, done, price)
                        : RoaAuctionNet.SellNow(Interaction.Socket, id, quantity, string.Empty, done, price));
                });
            AddDetailButton("К ФОРМЕ ЗАЯВКИ", QuietBg, () => { _orderId = string.Empty; Rebuild(); });
        }

        private void RebuildBuyForm()
        {
            AddDetailText("ОРДЕР НА ВЫКУП", 15, Accent, 24f, FontStyle.Bold);
            AddDetailText(RoaItemData.Name(_itemId), 14, Ink, 22f);
            if (!Fungible(_itemId))
            {
                AddDetailText("У этого предмета есть износ или собственные свойства, поэтому обезличенную заявку на него не поставить — такой товар покупают ордером продавца в центре списка.", 12, InkDim, 90f);
                return;
            }
            // Поля формы стоят на своих местах; подписи и кнопка ложатся ниже.
            _detailCursor = -204f;
            int price = FormPrice;
            int qty = FormQty;
            long fee = FormFee;
            int best = BestPrice(_itemId, "sell");

            AddDetailText(best > 0
                ? "Дешевле всего продают по " + best + " — ордер выше этой цены исполнится сразу."
                : "Сейчас никто не продаёт: ордер будет ждать продавца.", 11, InkDim, 34f);
            AddDurationRow();
            AddDetailText("Заморозится " + FormTotal + " марок, сбор за ордер " + fee
                + ". У вас " + Marks + ".", 11, FormTotal + fee > Marks ? Warn : InkDim, 40f);

            bool ready = ValidOrderForm && FormTotal + fee <= Marks;
            AddDetailButton(ready ? "ПОСТАВИТЬ ОРДЕР НА " + _durationHours + " Ч" : "УКАЖИТЕ ЦЕНУ И КОЛИЧЕСТВО",
                ready ? ButtonBg : QuietBg, () =>
                {
                    if (!ready) return;
                    SendMarket(done => RoaAuctionNet.BuyOrder(Interaction.Socket, _itemId, qty, price, _durationHours, done));
                });
        }

        private void RebuildSellForm()
        {
            AddDetailText("ОРДЕР НА ПРОДАЖУ", 15, Accent, 24f, FontStyle.Bold);
            int have = Backpack(_itemId);
            AddDetailText(RoaItemData.Name(_itemId) + " · в рюкзаке " + have, 14, Ink, 22f);
            _detailCursor = -204f;
            int price = FormPrice;
            int qty = FormQty;
            long fee = FormFee;
            long tax = (long)Math.Floor(FormTotal * (_state?["taxPct"]?.Value<double>() ?? 0.08));
            int best = BestPrice(_itemId, "buy");

            AddDetailText(best > 0
                ? "Дороже всего выкупают по " + best + " — ордер ниже этой цены продастся сразу."
                : "Заявок на выкуп нет: ордер будет ждать покупателя.", 11, InkDim, 34f);
            AddDurationRow();
            AddDetailText("Сбор за ордер " + fee + " · налог с продажи " + tax
                + " · итог после сборов " + Math.Max(0, FormTotal - tax - fee) + ".", 11, fee > Marks ? Warn : InkDim, 40f);
            if (!Fungible(_itemId)) AddDetailText("Снаряжение принимается полностью отремонтированным. Предметы с собственными свойствами выставляются по одному.", 11, InkDim, 48f);

            bool ready = ValidOrderForm && qty <= have && fee <= Marks && (Fungible(_itemId) || qty == 1);
            AddDetailButton(ready ? "ВЫСТАВИТЬ ОРДЕР НА " + _durationHours + " Ч" : "УКАЖИТЕ ЦЕНУ И КОЛИЧЕСТВО",
                ready ? ButtonBg : QuietBg, () =>
                {
                    if (!ready) return;
                    SendMarket(done => RoaAuctionNet.SellOrder(Interaction.Socket, _itemId, qty, price, _durationHours, string.Empty, done));
                });
        }

        private void AddDurationRow(JArray choices = null)
        {
            AddDetailText("СРОК ОРДЕРА", 11, InkDim, 18f, FontStyle.Bold);
            float top = _detailCursor;
            float x = 12f;
            foreach (JToken token in choices ?? _state?["durationChoicesHours"] as JArray ?? new JArray())
            {
                int choice = token?.Value<int>() ?? 0;
                if (choice <= 0) continue;
                string caption = choice >= 24 ? (choice / 24) + " д" : choice + " ч";
                Button button = TextButton("Duration", _detail, caption, 12, out Text label);
                var rect = (RectTransform)button.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(x, top);
                rect.sizeDelta = new Vector2(80f, 28f);
                x += 84f;
                button.GetComponent<Image>().color = _durationHours == choice ? ButtonBg : QuietBg;
                label.color = _durationHours == choice ? Accent : Ink;
                int captured = choice;
                button.onClick.AddListener(() => { _durationHours = captured; Rebuild(); });
                _detailRows.Add(button.gameObject);
            }
            _detailCursor = top - 34f;
        }

        private void RebuildOrderPanel()
        {
            JObject order = SelectedOrder();
            if (order == null || order["mine"]?.Value<bool>() != true)
            {
                AddDetailText("Выберите свой ордер: здесь появятся его цена, остаток и срок.", 13, InkDim, 70f);
                return;
            }
            bool sell = (order["side"]?.ToString() ?? "sell") == "sell";
            int qty = order["qty"]?.Value<int>() ?? 0;
            int price = order["price"]?.Value<int>() ?? 0;
            string id = order["id"]?.ToString() ?? string.Empty;

            AddDetailText(RoaItemData.Name(order["itemId"]?.ToString()), 17, Accent, 30f, FontStyle.Bold);
            AddDetailText(sell ? "Ордер на продажу" : "Ордер на выкуп", 13, sell ? Ink : Good, 22f);
            AddDetailText("Осталось: " + qty + " · исполнено: " + (order["filled"]?.Value<int>() ?? 0), 11, InkDim, 18f);
            _detailCursor = -204f;
            AddDurationRow();
            long extra = FormFee + (sell ? 0 : FormTotal - (long)qty * price);
            AddDetailText("Новый сбор: " + FormFee + ". " + (extra >= 0 ? "К оплате: " + extra : "Вернётся: " + -extra)
                + " марок.\nСрок начнётся заново. Позиция в очереди обновится.", 11, InkDim, 58f);
            AddDetailText(sell ? "Можно уменьшить остаток. Возврат — на полку. Для дополнительных предметов создайте новую заявку."
                : "Укажите новый остаток и цену. Купленное при изменении поступит на полку.", 11, InkDim, 48f);
            bool ready = ValidOrderForm && (!sell || FormQty <= qty) && Math.Max(0, extra) <= Marks;
            AddDetailButton("СОХРАНИТЬ ИЗМЕНЕНИЯ", ready ? ButtonBg : QuietBg, () => {
                if (ready) SendMarket(done => RoaAuctionNet.UpdateOrder(Interaction.Socket, id, FormQty, FormPrice, _durationHours, done, price, qty));
            });
            AddDetailButton("ОТМЕНИТЬ ОРДЕР", Warn, () => SendMarket(done => RoaAuctionNet.Cancel(Interaction.Socket, id, done)));
        }

        private void RebuildShelfPanel()
        {
            JObject shelf = Shelf;
            int silver = shelf?["silver"]?.Value<int>() ?? 0;
            int items = 0;
            foreach (JToken row in shelf?["items"] as JArray ?? new JArray()) items += row["qty"]?.Value<int>() ?? 0;
            AddDetailText("ПОЛКА У АУКЦИОНЕРА", 15, Accent, 28f, FontStyle.Bold);
            AddDetailText("Марки: " + silver + "\nПредметов: " + items + "\nСделок: " + (shelf?["sales"]?.Value<int>() ?? 0), 13, Ink, 60f);
            AddDetailText("Забирается целиком, насколько хватит места и грузоподъёмности; остаток остаётся на полке у аукционера.", 11, InkDim, 52f);
            if (silver > 0 || items > 0)
                AddDetailButton("ЗАБРАТЬ ПОЛКУ", ButtonBg, () => SendMarket(done => RoaAuctionNet.Claim(Interaction.Socket, done)));
        }

        /// <summary>
        /// Состояние артефакта в ордере до покупки: вид, тир и признак
        /// стабилизации, а у исследованного — его точные свойства. Сервер
        /// присылает записи в публичной проекции, поэтому скрытый ролл сюда не
        /// попадает.
        /// </summary>
        public static string AuctionArtifactLine(JObject order)
        {
            JArray artifacts = order?["artifacts"] as JArray;
            if (artifacts == null || artifacts.Count == 0)
            {
                int count = order?["artifactCount"]?.Value<int>() ?? 0;
                return count > 0 ? "\nАртефактов в ордере: " + count : string.Empty;
            }
            var lines = new List<string>();
            foreach (JToken token in artifacts)
            {
                JObject record = token as JObject;
                if (record == null) continue;
                lines.Add((record["displayName"]?.ToString() ?? "Артефакт") + ": "
                    + RoaPipboyCanvas.ArtifactCardSummary(record, 1));
                if (lines.Count >= 4) break;
            }
            return lines.Count > 0 ? "\n" + string.Join("\n", lines) : string.Empty;
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
