using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Терминал PIP-ASH — окно инвентаря и Pip-Boy в структуре web-клиента
    /// (#inventory-window в index.html:55): латунная рамка, фосфорный экран,
    /// сводка WG/HP/AP/DT/Caps/СИЛА, страницы и ряд вкладок снизу.
    ///
    /// Клавиши: TAB и I — персонаж и инвентарь, K — навыки, P — крафт
    /// (B — транспорт, его ведёт RoaVehicleController). Данные и действия остаются в RoaInventory и RoaPipboy —
    /// этот класс только рисует их в новом виде; старые IMGUI-окна выключены
    /// флагом CanvasDriven, как это уже сделано с HUD.
    ///
    /// Разделы, ещё не перенесённые из web, показывают честную заглушку,
    /// а не пустую страницу: игрок должен видеть, что раздел существует.
    /// </summary>
    public sealed partial class RoaPipboyCanvas : MonoBehaviour
    {
        public enum Page { Status, Items, Skills, Perks, Craft, Quests, Contracts, World, Factions, Friends, Clan, Base, Radio }

        // Палитра фосфорного экрана «ПУТНИКА»; исходные значения сверены с frozen parity CSS.
        private static readonly Color ScreenInk = new Color(0.624f, 0.859f, 0.478f, 1f);      // #9fdb7a
        private static readonly Color ScreenInkDim = new Color(0.624f, 0.859f, 0.478f, 0.55f);
        private static readonly Color ScreenBg = new Color(0.027f, 0.067f, 0.043f, 0.99f);
        private static readonly Color ScreenBorder = new Color(0.533f, 0.686f, 0.396f, 0.34f);
        private static readonly Color FrameBg = new Color(0.090f, 0.090f, 0.075f, 0.98f);      // #171713
        private static readonly Color FrameBorder = new Color(0.820f, 0.694f, 0.404f, 0.58f);
        private static readonly Color CardBg = new Color(0.055f, 0.125f, 0.078f, 0.92f);
        private static readonly Color CardSelected = new Color(0.145f, 0.267f, 0.129f, 0.98f);
        private static readonly Color AccentWarm = new Color(1f, 0.82f, 0.42f, 1f);

        public RoaInventory Inventory;
        public RoaPipboy Pipboy;
        public RoaHud Hud;
        public RoaSocketClient Socket;
        public RoaCombat Combat;
        public RealmOfAshes.World.RoaLocationLoader Loader;
        public RoaPlayerController Player;
        public RoaInteraction Interaction;
        public RoaPersonalBaseCanvas PersonalBaseCanvas;
        public RoaFogOfWar Fog;
        public bool InputEnabled = true;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }
        public Page ActivePage { get { return _page; } }

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _frameRect;
        private Page _page = Page.Items;

        private Text _locationLine;
        private Text _topline;
        private readonly Dictionary<Page, GameObject> _pages = new Dictionary<Page, GameObject>();
        private readonly Dictionary<Page, Button> _tabs = new Dictionary<Page, Button>();
        private readonly Dictionary<Page, Text> _tabLabels = new Dictionary<Page, Text>();

        // ITEMS
        private Text _carryLine;
        public RoaQuickbar Quickbar;
        private Text _itemsPanelName;
        private Text _itemsPanelSlots;
        private readonly List<(Button button, Text label)> _quickSlots = new List<(Button, Text)>();
        private RectTransform _itemsGrid;
        private Text _itemsStatus;
        private string _selectedItemId = string.Empty;
        /// <summary>Выбранный в ПУТНИКе предмет — его же выставляет аукционер базы.</summary>
        public string SelectedItemId { get { return _selectedItemId; } }
        // Выбрана плитка, а не вид предмета: надетый пистолет и такой же запасной
        // в сумке — две разные вещи с разными действиями.
        private string _selectedTileKey = string.Empty;
        private string _selectedRuntimeId = string.Empty;
        private string _selectedSlot = string.Empty;
        private readonly List<GameObject> _itemCards = new List<GameObject>();

        /// <summary>
        /// Плитка сетки предметов. Надетая вещь — всегда своя плитка; экипировка из
        /// сумки лежит по одной; стопкой остаются только расходники и материалы.
        /// </summary>
        private struct ItemTile
        {
            /// <summary>"eq:{слот}" для надетого, "bag:{baseId}:{номер}" для сумки.</summary>
            public string Key;
            public string BaseId;
            /// <summary>Экземпляр для запроса серверу; у стопки и брони — базовый id.</summary>
            public string RuntimeId;
            /// <summary>Слот, в котором вещь надета; у вещи из сумки пусто.</summary>
            public string Slot;
            public int Qty;
            public bool Equipped { get { return !string.IsNullOrEmpty(Slot); } }
        }
        // Категории и сортировка — как itemCategoryFilters / sortModes в web.
        private RectTransform _categoryTabs;
        private readonly Dictionary<string, Button> _categoryButtons = new Dictionary<string, Button>();
        private string _activeCategory = "all";
        private string _sortMode = "type";
        private Text _sortLabel;
        private Text _categoryEmpty;
        private Button _equipButton;
        private Button _useButton;
        private Button _dropButton;
        private Text _equipLabel;
        private Text _selectedTitle;

        // CRAFT
        private RectTransform _craftList;
        private Text _craftStatus;
        private Button _craftFocus;
        private Text _craftFocusLabel;
        private readonly List<GameObject> _craftRows = new List<GameObject>();
        private readonly HashSet<string> _pendingRecipes = new HashSet<string>();

        // QUESTS / CONTRACTS / WORLD / FACTIONS / FRIENDS / CLAN / RADIO
        private RectTransform _questsList;
        private RectTransform _contractsList;
        private RectTransform _worldList;
        private RectTransform _factionsList;
        private RectTransform _friendsList;
        private RectTransform _clanList;
        private RectTransform _radioList;
        private Text _worldHeader;
        private Text _socialStatus;
        private InputField _clanNameInput;
        private readonly List<GameObject> _questRows = new List<GameObject>();
        private readonly List<GameObject> _contractRows = new List<GameObject>();
        private readonly List<GameObject> _worldRows = new List<GameObject>();
        private readonly List<GameObject> _factionRows = new List<GameObject>();
        private readonly List<GameObject> _friendRows = new List<GameObject>();
        private readonly List<GameObject> _clanRows = new List<GameObject>();
        private readonly List<GameObject> _radioRows = new List<GameObject>();

        // STATUS / SKILLS / PERKS
        private RectTransform _skillsList;
        private RectTransform _perksList;
        private Text _progressionStatus;
        private readonly List<GameObject> _skillRows = new List<GameObject>();
        private readonly List<GameObject> _perkRows = new List<GameObject>();

        private float _refreshAt;

        private static readonly (Page page, string label)[] TabOrder =
        {
            (Page.Items, "Персонаж"), (Page.Skills, "Навыки"),
            (Page.Perks, "Перки"), (Page.Craft, "Крафт"), (Page.Quests, "Журнал"),
            (Page.Contracts, "Контракты"), (Page.World, "Мир"), (Page.Factions, "Фракции"), (Page.Friends, "Друзья"),
            (Page.Clan, "Клан"), (Page.Base, "Укрытие"), (Page.Radio, "Радио")
        };

        private void Update()
        {
            if (!InputEnabled || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                if (IsOpen) Close();
                return;
            }

            // Escape закрывает окно всегда, даже из поля ввода: иначе набранное имя
            // клана запирало бы игрока в терминале.
            if (IsOpen && Input.GetKeyDown(KeyCode.Escape)) { Close(); return; }

            // Во время набора текста буквы принадлежат полю ввода, а не терминалу.
            if (TypingInInputField()) return;

            // Tab и I — экран персонажа, K — навыки, P — крафт. Повторное нажатие
            // своей клавиши закрывает. Клавишу B занимает транспорт (RoaVehicleController),
            // болт бросают нажатием колеса мыши.
            if (Input.GetKeyDown(KeyCode.Tab)) TogglePage(Page.Items);
            else if (Input.GetKeyDown(KeyCode.I)) TogglePage(Page.Items);
            else if (Input.GetKeyDown(KeyCode.K)) TogglePage(Page.Skills);
            else if (Input.GetKeyDown(KeyCode.P)) TogglePage(Page.Craft);

            if (!IsOpen) return;
            FitFrameToViewport();

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.25f;
                Refresh();
            }
        }

        /// <summary>
        /// Фокус стоит в поле ввода: имя клана, поиск перка. Пока игрок печатает,
        /// буквы принадлежат полю, иначе «wasd» уводил персонажа гулять, а «i» и «p»
        /// переключали страницы прямо посреди слова.
        /// </summary>
        public static bool TypingInInputField()
        {
            EventSystem events = EventSystem.current;
            GameObject focus = events != null ? events.currentSelectedGameObject : null;
            if (focus == null) return false;
            var field = focus.GetComponent<InputField>();
            return field != null && field.isFocused;
        }

        public void TogglePage(Page page)
        {
            if (IsOpen && _page == Resolve(page)) { Close(); return; }
            Open(page);
        }

        /// <summary>
        /// Отдельной страницы «Статус» больше нет: экипировка, характеристики и
        /// состояние живут на экране персонажа. Член перечисления остаётся —
        /// на него ссылается мобильная панель (RoaMobileControls.cs:445), и её
        /// кнопка обязана открывать что-то осмысленное, а не пустоту.
        /// </summary>
        private static Page Resolve(Page page)
        {
            return page == Page.Status ? Page.Items : page;
        }

        public void Open(Page page)
        {
            EnsureBuilt();
            _page = Resolve(page);
            _root.SetActive(true);
            ApplyPage();
            Refresh();
            Canvas.ForceUpdateCanvases();
            FitFrameToViewport();
        }

        /// <summary>
        /// Рама шире экрана-предшественника: на 16:9 множитель выходит ровно 1.00,
        /// то есть терминал наконец рисуется пиксель в пиксель. Со старыми 980x800
        /// он всегда ужимался до 0.9875 и мылил подписи в 9-10 пунктов.
        /// </summary>
        public const float FrameWidth = 1180f;
        public const float FrameHeight = 780f;

        private void FitFrameToViewport()
        {
            if (_frameRect == null || _canvas == null) return;
            Rect viewport = ((RectTransform)_canvas.transform).rect;
            Vector2 frame = _frameRect.sizeDelta;
            float fit = Mathf.Min(1f, (viewport.width - 20f) / Mathf.Max(1f, frame.x),
                                      (viewport.height - 20f) / Mathf.Max(1f, frame.y));
            _frameRect.localScale = Vector3.one * Mathf.Max(0.1f, fit);
            ApplyCompactLayout(viewport.width < 900f);
        }

        /// <summary>
        /// Узкий экран: решётка снаряжения уходит, сумка занимает всю ширину и
        /// растит ячейки. Три колонки в 0.54 масштаба портрета читаются хуже, чем
        /// одна крупная. Вызывается каждый кадр из Update — поэтому сравнение
        /// с текущим состоянием обязательно, иначе перестройка идёт без остановки.
        /// </summary>
        private void ApplyCompactLayout(bool compact)
        {
            if (_compactLayout.HasValue && _compactLayout.Value == compact) return;
            _compactLayout = compact;
            if (_equipPanel == null || _bagPanel == null) return;

            _equipPanel.gameObject.SetActive(!compact);
            Place_(_bagPanel, 0f, 0f, 0f, 0f, new Vector2(compact ? 0f : 546f, 30f), new Vector2(1112f, 586f));

            if (_itemsGridLayout != null)
                _itemsGridLayout.cellSize = compact ? new Vector2(150f, 116f) : new Vector2(102f, 104f);

            if (_hintBar != null) _hintBar.gameObject.SetActive(!compact);
            if (_hintTouch != null) _hintTouch.gameObject.SetActive(compact);
            _refreshAt = 0f;
        }

        public void Close()
        {
            if (RoaItemPopups.Instance != null) { RoaItemPopups.Instance.Hide(); RoaItemPopups.Instance.HideMenu(); }
            if (_root != null) _root.SetActive(false);
        }

        private void ApplyPage()
        {
            foreach (KeyValuePair<Page, GameObject> entry in _pages)
                entry.Value.SetActive(entry.Key == _page);

            foreach (KeyValuePair<Page, Text> entry in _tabLabels)
            {
                bool active = entry.Key == _page;
                entry.Value.color = active ? AccentWarm : ScreenInkDim;
                entry.Value.fontStyle = active ? FontStyle.Bold : FontStyle.Normal;
            }
        }

        // ------------------------------------------------------------------
        // Построение
        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("PipboyCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 40; // выше HUD (30)
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            // Затемнение мира: web даёт box-shadow 0 0 0 9999px rgba(0,0,0,.46).
            _root = new GameObject("PipboyWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            rootRect.anchorMin = Vector2.zero;
            rootRect.anchorMax = Vector2.one;
            rootRect.offsetMin = Vector2.zero;
            rootRect.offsetMax = Vector2.zero;
            var dim = _root.AddComponent<Image>();
            dim.color = new Color(0f, 0f, 0f, 0.46f);
            // Тап по затемнению закрывает окно. На телефоне рамка ужимается под экран
            // вместе с крестиком, поэтому крупная зона выхода обязательна: клавиши Esc
            // там нет. Клики внутри рамки перехватывает её собственный Image.
            var dimButton = _root.AddComponent<Button>();
            dimButton.transition = Selectable.Transition.None;
            dimButton.onClick.AddListener(Close);

            // Латунная рамка 980x780 по центру.
            RectTransform frame = Child("Frame", rootRect);
            _frameRect = frame;
            frame.anchorMin = frame.anchorMax = new Vector2(0.5f, 0.5f);
            frame.pivot = new Vector2(0.5f, 0.5f);
            frame.sizeDelta = new Vector2(FrameWidth, FrameHeight);
            var frameImage = frame.gameObject.AddComponent<Image>();
            frameImage.color = FrameBg;
            var frameOutline = frame.gameObject.AddComponent<Outline>();
            frameOutline.effectColor = FrameBorder;
            frameOutline.effectDistance = new Vector2(1.5f, -1.5f);

            // Фосфорный экран с полем 16px.
            RectTransform screen = Child("Screen", frame);
            Stretch(screen, 16f);
            var screenImage = screen.gameObject.AddComponent<Image>();
            screenImage.color = ScreenBg;
            var screenOutline = screen.gameObject.AddComponent<Outline>();
            screenOutline.effectColor = ScreenBorder;
            screenOutline.effectDistance = new Vector2(1f, -1f);

            BuildTitleRow(screen);
            BuildTopline(screen);
            BuildTabs(screen);

            RectTransform pageArea = Child("Pages", screen);
            pageArea.anchorMin = new Vector2(0f, 0f);
            pageArea.anchorMax = new Vector2(1f, 1f);
            pageArea.offsetMin = new Vector2(18f, 54f);
            pageArea.offsetMax = new Vector2(-18f, -108f);

            BuildItemsPage(pageArea);
            BuildSkillsPage(pageArea);
            BuildPerksPage(pageArea);
            BuildCraftPage(pageArea);
            BuildQuestsPage(pageArea);
            BuildContractsPage(pageArea);
            BuildWorldPage(pageArea);
            BuildFactionsPage(pageArea);
            BuildFriendsPage(pageArea);
            BuildClanPage(pageArea);
            BuildPersonalBasePage(pageArea);
            BuildRadioPage(pageArea);

            foreach ((Page page, string label) in TabOrder)
            {
                if (_pages.ContainsKey(page)) continue;
                RectTransform stub = Page_(page, pageArea);
                Text text = Label("Stub", stub, 16, TextAnchor.MiddleCenter, ScreenInkDim);
                Stretch(text.rectTransform, 8f);
                text.text = label.ToUpperInvariant() + "\n\nРаздел ещё не перенесён в Unity-клиент.\nОн доступен в браузерной версии игры.";
            }

            _root.SetActive(false);
        }

        private void BuildTitleRow(RectTransform screen)
        {
            RectTransform row = Child("TitleRow", screen);
            row.anchorMin = new Vector2(0f, 1f);
            row.anchorMax = new Vector2(1f, 1f);
            row.pivot = new Vector2(0.5f, 1f);
            row.offsetMin = new Vector2(18f, -46f);
            row.offsetMax = new Vector2(-14f, -6f);

            Text title = Label("Title", row, 24, TextAnchor.MiddleLeft, ScreenInk, FontStyle.Bold);
            title.rectTransform.anchorMin = new Vector2(0f, 0f);
            title.rectTransform.anchorMax = new Vector2(0.5f, 1f);
            title.rectTransform.offsetMin = Vector2.zero;
            title.rectTransform.offsetMax = Vector2.zero;
            title.text = "ПУТНИК";

            _locationLine = Label("Location", row, 13, TextAnchor.LowerLeft, ScreenInkDim);
            _locationLine.rectTransform.anchorMin = new Vector2(0.13f, 0f);
            _locationLine.rectTransform.anchorMax = new Vector2(0.7f, 1f);
            _locationLine.rectTransform.offsetMin = Vector2.zero;
            _locationLine.rectTransform.offsetMax = new Vector2(0f, -6f);

            Button close = TextButton("Close", row, "×", 24, out Text closeText);
            var closeRect = (RectTransform)close.transform;
            closeRect.anchorMin = new Vector2(1f, 0.5f);
            closeRect.anchorMax = new Vector2(1f, 0.5f);
            closeRect.pivot = new Vector2(1f, 0.5f);
            closeRect.sizeDelta = new Vector2(56f, 46f);
            closeText.color = AccentWarm;
            close.onClick.AddListener(Close);
        }

        private void BuildTopline(RectTransform screen)
        {
            RectTransform line = Child("Topline", screen);
            line.anchorMin = new Vector2(0f, 1f);
            line.anchorMax = new Vector2(1f, 1f);
            line.pivot = new Vector2(0.5f, 1f);
            line.offsetMin = new Vector2(18f, -76f);
            line.offsetMax = new Vector2(-18f, -50f);
            var back = line.gameObject.AddComponent<Image>();
            back.color = new Color(0f, 0f, 0f, 0.28f);

            _topline = Label("Values", line, 14, TextAnchor.MiddleLeft, ScreenInk, FontStyle.Bold);
            Stretch(_topline.rectTransform, 8f);
            _topline.supportRichText = true;
        }

        private void BuildTabs(RectTransform screen)
        {
            RectTransform tabs = Child("Tabs", screen);
            tabs.anchorMin = new Vector2(0f, 0f);
            tabs.anchorMax = new Vector2(1f, 0f);
            tabs.pivot = new Vector2(0.5f, 0f);
            tabs.offsetMin = new Vector2(12f, 8f);
            tabs.offsetMax = new Vector2(-12f, 46f);

            var layout = tabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 4f;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = true;
            layout.childControlWidth = true;
            layout.childControlHeight = true;

            foreach ((Page page, string label) in TabOrder)
            {
                Button button = TextButton("Tab:" + page, tabs, label, 12, out Text text);
                var image = button.GetComponent<Image>();
                image.color = new Color(0f, 0f, 0f, 0.30f);
                Page target = page;
                button.onClick.AddListener(() => { _page = target; ApplyPage(); Refresh(); });
                _tabs[page] = button;
                _tabLabels[page] = text;
            }
        }

        private RectTransform Page_(Page page, RectTransform parent)
        {
            RectTransform rect = Child("Page:" + page, parent);
            Stretch(rect, 0f);
            _pages[page] = rect.gameObject;
            rect.gameObject.SetActive(false);
            return rect;
        }

        // --- STATUS (pipboy-status-layout web: 370 / 500, gap 16) -----------------

        private static readonly Color PlateBg = new Color(0.03f, 0.07f, 0.04f, 1f);
        private static readonly Color PlateBorder = new Color(0.49f, 0.804f, 0.369f, 0.32f);
        private static readonly Color PlateName = new Color(0.843f, 0.757f, 0.424f, 1f);   // #d7c16c
        private static readonly Color SlotBg = new Color(0.03f, 0.075f, 0.042f, 1f);
        private static readonly Color SlotBorder = new Color(0.494f, 0.784f, 0.357f, 0.32f);
        /// <summary>Занятая ячейка держит границу заметнее пустой — решётка читается без чтения подписей.</summary>
        private static readonly Color EquippedSlotBorder = new Color(0.494f, 0.784f, 0.357f, 0.58f);
        private static readonly Color SlotName = new Color(0.827f, 0.933f, 0.541f, 1f);    // #d3ee8a
        private static readonly Color SpecialValue = new Color(0.937f, 0.816f, 0.471f, 1f); // #efd078
        private static readonly Color CellBg = new Color(0.03f, 0.075f, 0.042f, 1f);
        private static readonly Color CellBorder = new Color(0.494f, 0.784f, 0.357f, 0.28f);


        private static RectTransform Panel_(RectTransform parent, Color bg, Color border)
        {
            RectTransform rect = Child("Panel", parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = bg;
            image.raycastTarget = false;
            var outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = border;
            outline.effectDistance = new Vector2(1f, -1f);
            return rect;
        }

        private static void Place_(RectTransform rect, float minX, float minY, float maxX, float maxY, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }


        // ------------------------------------------------------------------
        // ЭКРАН ПЕРСОНАЖА: экипировка | характеристики | сумка
        //
        // Композиция взята из современных выживалок: слева решётка надетого,
        // посередине колонка чисел, справа сумка, снизу полоса подсказок.
        // Страница живёт в 1112x586. SectionTitle здесь снят намеренно — эти
        // 26 px отданы решётке, а название экрана и так написано на вкладке.
        //
        // Все координаты ниже абсолютные (якорь в левом нижнем углу страницы),
        // потому что колонки обязаны держать ширину: на дробных якорях решётка
        // 94-пиксельных ячеек разъезжается на первом же нестандартном аспекте.
        // ------------------------------------------------------------------

        private RectTransform _hintBar; // полоса подсказок внизу экрана персонажа
        private Text _hintTouch;
        private RectTransform _equipPanel;
        private RectTransform _bagPanel;
        private GridLayoutGroup _itemsGridLayout;
        /// <summary>null — режим ещё ни разу не применяли; иначе текущий.</summary>
        private bool? _compactLayout;
        private RectTransform _quickRow;
        private Text _gearPowerLine;
        private Text _invClanLine;
        private Text _invFundsLine;
        private RectTransform _weightFill;
        private Image _weightFillImage;

        /// <summary>Ячейка надетого предмета: больше частей, чем у прежнего слота.</summary>
        private sealed class EquipCell
        {
            public Button Button;
            public RawImage Art;
            public Text Name;
            public Text Type;
            public Text Empty;
            public Text Weight;
            public Text Meta;
            public Image Condition;
        }

        private readonly Dictionary<string, EquipCell> _equipCells = new Dictionary<string, EquipCell>();

        private void BuildItemsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Items, parent);

            BuildHintBar(page);

            _equipPanel = Panel_(page, PlateBg, PlateBorder);
            Place_(_equipPanel, 0f, 0f, 0f, 0f, new Vector2(0f, 30f), new Vector2(536f, 586f));
            BuildEquipPanel(_equipPanel);

            _bagPanel = Panel_(page, PlateBg, PlateBorder);
            Place_(_bagPanel, 0f, 0f, 0f, 0f, new Vector2(546f, 30f), new Vector2(1112f, 586f));
            BuildBagPanel(_bagPanel);
        }

        /// <summary>
        /// Подсказки пишем только про то, что экран действительно умеет: обещать
        /// «выбросить по G» нельзя — эта клавиша уже занята в мире и окна не знает.
        /// </summary>
        private void BuildHintBar(RectTransform page)
        {
            _hintBar = Child("HintBar", page);
            Place_(_hintBar, 0f, 0f, 1f, 0f, new Vector2(0f, 0f), new Vector2(0f, 24f));
            var layout = _hintBar.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 18f;
            layout.childAlignment = TextAnchor.MiddleCenter;
            layout.childForceExpandWidth = false;
            layout.childForceExpandHeight = false;
            layout.childControlWidth = true;
            layout.childControlHeight = true;

            AddHint("SHIFT+ЛКМ", "Экипировать");
            AddHint("ПКМ", "Действия");
            AddHint("Наведение", "Сведения");
            AddHint("1–8", "Быстрый доступ");

            // На телефоне клавиш нет — и обещать их нельзя.
            _hintTouch = Label("HintTouch", page, 10, TextAnchor.MiddleCenter, RoaUiPalette.InkLabel);
            _hintTouch.text = "Касание — выбрать · Долгое нажатие — действия";
            Place_(_hintTouch.rectTransform, 0f, 0f, 1f, 0f, new Vector2(0f, 0f), new Vector2(0f, 24f));
            _hintTouch.gameObject.SetActive(false);
        }

        private void AddHint(string key, string caption)
        {
            RectTransform row = Child("Hint:" + key, _hintBar);
            var rowLayout = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            rowLayout.spacing = 5f;
            rowLayout.childAlignment = TextAnchor.MiddleLeft;
            rowLayout.childForceExpandWidth = false;
            rowLayout.childForceExpandHeight = false;
            rowLayout.childControlWidth = true;
            rowLayout.childControlHeight = true;

            RectTransform badge = Child("Key", row);
            var badgeImage = badge.gameObject.AddComponent<Image>();
            badgeImage.sprite = RoaUiPalette.Plate();
            badgeImage.type = Image.Type.Sliced;
            badgeImage.color = new Color(0.016f, 0.055f, 0.031f, 0.85f);
            badgeImage.raycastTarget = false;
            var badgeOutline = badge.gameObject.AddComponent<Outline>();
            badgeOutline.effectColor = RoaUiPalette.TileBorder;
            badgeOutline.effectDistance = new Vector2(1f, -1f);
            Text keyLabel = Label("Label", badge, 9, TextAnchor.MiddleCenter, RoaUiPalette.Accent);
            keyLabel.text = key;
            // Без Overflow узкий бейдж переносит подпись и она ложится сама на себя.
            keyLabel.horizontalOverflow = HorizontalWrapMode.Overflow;
            Stretch(keyLabel.rectTransform, 1f);
            badge.gameObject.AddComponent<LayoutElement>().preferredWidth = 14f + key.Length * 7.5f;

            Text text = Label("Caption", row, 10, TextAnchor.MiddleLeft, RoaUiPalette.InkLabel);
            text.text = caption;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.gameObject.AddComponent<LayoutElement>().preferredWidth = 6f + caption.Length * 6.5f;
        }

        /// <summary>Шапка панели: заголовок слева, счётчик справа.</summary>
        private Text PanelHeader(RectTransform panel, string caption, out Text counter)
        {
            Text title = Label("Header", panel, 12, TextAnchor.MiddleLeft, RoaUiPalette.InkLabel, FontStyle.Bold);
            title.text = caption;
            Place_(title.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(10f, -26f), new Vector2(0f, -4f));
            counter = Label("HeaderCounter", panel, 9, TextAnchor.MiddleRight, RoaUiPalette.InkLabel);
            Place_(counter.rectTransform, 0.4f, 1f, 1f, 1f, new Vector2(0f, -26f), new Vector2(-10f, -4f));
            return title;
        }

        // --- ЛЕВАЯ ПАНЕЛЬ: решётка надетого и колонка характеристик ----------

        private void BuildEquipPanel(RectTransform panel)
        {
            PanelHeader(panel, "ЭКИПИРОВКА", out _itemsPanelSlots);

            RectTransform lattice = Child("Lattice", panel);
            Place_(lattice, 0f, 0f, 0f, 1f, new Vector2(6f, 32f), new Vector2(306f, -30f));

            string[] leftSlots = { "weapon", "armor", "boots", "detector" };
            string[] rightSlots = { "offhand", "helmet", "backpack", "artifactBelt" };
            string[] leftTitles = { "Правая рука", "Корпус", "Ноги", "Детектор" };
            string[] rightTitles = { "Левая рука", "Голова", "Спина", "Арт-пояс" };

            // Геометрия решётки 3x5 в шаге 100: оружие во всю ширину, вторая рука
            // на две клетки, рядом с ней транспорт; корпус крупным квадратом 2x2,
            // остальное — обычные ячейки.
            BuildEquipCell(lattice, leftSlots[0], leftTitles[0], 0, 0, 3, 1);
            BuildEquipCell(lattice, rightSlots[0], rightTitles[0], 0, 1, 2, 1);
            BuildEquipCell(lattice, RoaVehicleCatalog.Slot, "Транспорт", 2, 1, 1, 1);
            BuildEquipCell(lattice, leftSlots[1], leftTitles[1], 0, 2, 2, 2);
            BuildEquipCell(lattice, rightSlots[1], rightTitles[1], 2, 2, 1, 1);
            BuildEquipCell(lattice, leftSlots[2], leftTitles[2], 2, 3, 1, 1);
            BuildEquipCell(lattice, rightSlots[2], rightTitles[2], 0, 4, 1, 1);
            BuildEquipCell(lattice, leftSlots[3], leftTitles[3], 1, 4, 1, 1);
            BuildEquipCell(lattice, rightSlots[3], rightTitles[3], 2, 4, 1, 1);

            _gearPowerLine = Label("GearPower", panel, 10, TextAnchor.MiddleLeft, RoaUiPalette.InkLabel);
            Place_(_gearPowerLine.rectTransform, 0f, 0f, 0f, 0f, new Vector2(6f, 6f), new Vector2(306f, 30f));

            RectTransform divider = Child("Divider", panel);
            Place_(divider, 0f, 0f, 0f, 1f, new Vector2(310f, 32f), new Vector2(311f, -30f));
            var dividerImage = divider.gameObject.AddComponent<Image>();
            dividerImage.color = RoaUiPalette.Divider;
            dividerImage.raycastTarget = false;

            BuildStatsColumn(panel);
        }

        // --- ПРАВАЯ ПАНЕЛЬ: владелец, сумка, быстрый доступ, действия --------

        private void BuildBagPanel(RectTransform panel)
        {
            // Шапка: кто это, из какого клана, сколько денег, сколько несёт.
            RectTransform header = Child("Header", panel);
            Place_(header, 0f, 1f, 1f, 1f, new Vector2(6f, -54f), new Vector2(-6f, 0f));

            _itemsPanelName = Label("Owner", header, 14, TextAnchor.LowerLeft, RoaUiPalette.InkPrimary, FontStyle.Bold);
            Place_(_itemsPanelName.rectTransform, 0f, 0.5f, 0.55f, 1f, new Vector2(4f, 0f), new Vector2(0f, -4f));
            _invClanLine = Label("Clan", header, 10, TextAnchor.UpperLeft, RoaUiPalette.InkLabel);
            Place_(_invClanLine.rectTransform, 0f, 0f, 0.55f, 0.5f, new Vector2(4f, 4f), new Vector2(0f, 0f));

            _invFundsLine = Label("Funds", header, 12, TextAnchor.LowerRight, RoaUiPalette.Accent, FontStyle.Bold);
            Place_(_invFundsLine.rectTransform, 0.55f, 0.5f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-4f, -4f));

            _carryLine = Label("Carry", header, 10, TextAnchor.UpperRight, RoaUiPalette.InkLabel);
            Place_(_carryLine.rectTransform, 0.55f, 0f, 0.82f, 0.5f, new Vector2(0f, 4f), new Vector2(0f, 0f));

            RectTransform weightTrack = Child("WeightTrack", header);
            Place_(weightTrack, 0.82f, 0f, 1f, 0.5f, new Vector2(6f, 9f), new Vector2(-4f, -3f));
            var trackImage = weightTrack.gameObject.AddComponent<Image>();
            trackImage.color = new Color(0f, 0f, 0f, 0.45f);
            trackImage.raycastTarget = false;
            _weightFill = Child("Fill", weightTrack);
            _weightFill.anchorMin = new Vector2(0f, 0f);
            _weightFill.anchorMax = new Vector2(1f, 1f);
            _weightFill.offsetMin = Vector2.zero;
            _weightFill.offsetMax = Vector2.zero;
            _weightFillImage = _weightFill.gameObject.AddComponent<Image>();
            _weightFillImage.color = RoaUiPalette.InkPrimary;
            _weightFillImage.raycastTarget = false;

            // Рейка категорий и сортировка.
            _categoryTabs = Child("CategoryTabs", panel);
            Place_(_categoryTabs, 0f, 1f, 1f, 1f, new Vector2(6f, -86f), new Vector2(-104f, -60f));
            var tabsLayout = _categoryTabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            tabsLayout.spacing = 5f;
            tabsLayout.childForceExpandWidth = false;
            tabsLayout.childForceExpandHeight = true;
            tabsLayout.childControlWidth = true;
            tabsLayout.childControlHeight = true;
            foreach (RoaItemCategories.Tab tab in RoaItemCategories.Tabs)
            {
                Button button = TextButton("Tab:" + tab.Id, _categoryTabs, tab.Label, 10, out Text label);
                button.gameObject.AddComponent<LayoutElement>().preferredWidth = 10f + tab.Label.Length * 7f;
                var outline = button.gameObject.AddComponent<Outline>();
                outline.effectDistance = new Vector2(1f, -1f);
                string id = tab.Id;
                button.onClick.AddListener(() =>
                {
                    _activeCategory = id;
                    _refreshAt = 0f;
                });
                _categoryButtons[id] = button;
            }

            Button sort = TextButton("Sort", panel, "Сортировать", 10, out _sortLabel);
            var sortRect = (RectTransform)sort.transform;
            Place_(sortRect, 1f, 1f, 1f, 1f, new Vector2(-100f, -84f), new Vector2(-6f, -62f));
            sort.GetComponent<Image>().color = new Color(0.13f, 0.22f, 0.11f, 0.95f);
            sort.onClick.AddListener(() =>
            {
                _sortMode = _sortMode == "type" ? "weight" : "type";
                _refreshAt = 0f;
            });

            // Сетка предметов.
            RectTransform scrollArea = Child("Scroll", panel);
            Place_(scrollArea, 0f, 0f, 1f, 1f, new Vector2(6f, 98f), new Vector2(-6f, -92f));
            var scrollImage = scrollArea.gameObject.AddComponent<Image>();
            scrollImage.color = new Color(0f, 0f, 0f, 0.25f);
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scrollArea.gameObject.AddComponent<RectMask2D>();

            _categoryEmpty = Label("CategoryEmpty", scrollArea, 12, TextAnchor.MiddleCenter, RoaUiPalette.InkLabel);
            Place_(_categoryEmpty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -60f), new Vector2(-8f, -8f));
            _categoryEmpty.gameObject.SetActive(false);

            _itemsGrid = Child("Grid", scrollArea);
            _itemsGrid.anchorMin = new Vector2(0f, 1f);
            _itemsGrid.anchorMax = new Vector2(1f, 1f);
            // Pivot строго в левый верх: с центральным pivot контент, чуть
            // переросший viewport, съезжал влево и резал первую колонку.
            _itemsGrid.pivot = new Vector2(0f, 1f);
            _itemsGrid.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            var grid = _itemsGrid.gameObject.AddComponent<GridLayoutGroup>();
            // 5 колонок: 5*102 + 4*6 + 16 = 550 при ширине области 554.
            // Высота 104, а не 96: 8 px уходят арту — рендер предмета в 34 px
            // сливается в пятно, ради чего его тогда печь.
            grid.cellSize = new Vector2(102f, 104f);
            grid.childAlignment = TextAnchor.UpperLeft;
            grid.spacing = new Vector2(6f, 6f);
            grid.padding = new RectOffset(8, 8, 8, 8);
            _itemsGridLayout = grid;
            var fitter = _itemsGrid.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _itemsGrid;

            // Быстрый доступ 1-8: без этого ряда слоты 5-8 недостижимы вовсе —
            // контекстное меню предлагает только первые четыре.
            _quickRow = Child("QuickRow", panel);
            Place_(_quickRow, 0f, 0f, 1f, 0f, new Vector2(6f, 56f), new Vector2(-6f, 92f));
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
            {
                Button slot = TextButton("Quick" + (i + 1), _quickRow, (i + 1) + "\n—", 9, out Text label);
                var srect = (RectTransform)slot.transform;
                srect.anchorMin = srect.anchorMax = new Vector2(0f, 0f);
                srect.pivot = new Vector2(0f, 0f);
                srect.anchoredPosition = new Vector2(i * 69f, 0f);
                srect.sizeDelta = new Vector2(64f, 36f);
                slot.GetComponent<Image>().color = new Color(0.016f, 0.055f, 0.031f, 0.58f);
                var outline = slot.gameObject.AddComponent<Outline>();
                outline.effectColor = SlotBorder;
                outline.effectDistance = new Vector2(1f, -1f);
                label.color = ScreenInkDim;
                int index = i;
                slot.onClick.AddListener(() => OnQuickSlotClicked(index));
                _quickSlots.Add((slot, label));
            }

            // Действия по выбранному предмету.
            RectTransform actions = Child("Actions", panel);
            Place_(actions, 0f, 0f, 1f, 0f, new Vector2(6f, 0f), new Vector2(-6f, 52f));

            _selectedTitle = Label("Selected", actions, 11, TextAnchor.UpperLeft, RoaUiPalette.InkLabel);
            Place_(_selectedTitle.rectTransform, 0f, 0.56f, 0.62f, 1f, new Vector2(2f, 0f), new Vector2(0f, 0f));
            _itemsStatus = Label("Status", actions, 10, TextAnchor.UpperRight, RoaUiPalette.InkLabel);
            Place_(_itemsStatus.rectTransform, 0.62f, 0.56f, 1f, 1f, new Vector2(0f, 0f), new Vector2(-2f, 0f));

            _equipButton = ActionButton(actions, 0f, "Экипировать", out _equipLabel, OnEquipClicked);
            _useButton = ActionButton(actions, 0.255f, "Использовать", out _, OnUseClicked);
            _dropButton = ActionButton(actions, 0.51f, "Выбросить", out _, OnDropClicked);
            _modifyButton = ActionButton(actions, 0.765f, "Модификация", out _, OnModifyClicked);
        }
        private Button ActionButton(RectTransform parent, float left, string caption,
                                    out Text label, UnityEngine.Events.UnityAction onClick)
        {
            Button button = TextButton("Action:" + caption, parent, caption, 13, out label);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = new Vector2(left, 0f);
            rect.anchorMax = new Vector2(left + 0.235f, 0.5f);
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            button.GetComponent<Image>().color = new Color(0.13f, 0.22f, 0.11f, 0.95f);
            button.onClick.AddListener(onClick);
            return button;
        }

        private RectTransform ListArea(RectTransform page, out ScrollRect scroll)
        {
            RectTransform scrollArea = Child("Scroll", page);
            scrollArea.anchorMin = new Vector2(0f, 0f);
            scrollArea.anchorMax = new Vector2(1f, 1f);
            scrollArea.offsetMin = new Vector2(4f, 30f);
            scrollArea.offsetMax = new Vector2(-4f, -34f);
            var image = scrollArea.gameObject.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.22f);
            scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scrollArea.gameObject.AddComponent<RectMask2D>();

            RectTransform list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            // Левый верхний pivot: с центральным контент съезжает влево,
            // как это уже было с сеткой предметов.
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 4f;
            layout.padding = new RectOffset(8, 8, 8, 8);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            var fitter = list.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return list;
        }

        // ------------------------------------------------------------------
        // Обновление данных
        // ------------------------------------------------------------------

        private void Refresh()
        {
            JObject self = Pipboy != null ? Pipboy.Self : null;

            _locationLine.text = Socket != null && Socket.Session != null
                ? (Socket.Session.LocationId ?? string.Empty) : string.Empty;

            if (Hud != null && Inventory != null)
            {
                _topline.text =
                    Chip("ВЕС", Inventory.CarryWeight.ToString("0.0") + "/" + Inventory.CarryCapacity.ToString("0"))
                    + Chip("ОЗ", Hud.Hp + "/" + Mathf.Max(1, Hud.MaxHp))
                    + Chip("ОД", Mathf.FloorToInt(Hud.Ap) + "/" + Mathf.Max(1, Hud.MaxAp))
                    + Chip("БРОНЯ", Hud.ArmorThreshold.ToString())
                    + Chip("МАРКИ", CapsCount().ToString())
                    + Chip("УРОВЕНЬ", Hud.Level.ToString());
            }

            switch (_page)
            {
                case Page.Items: RefreshItems(); break;
                case Page.Skills: RefreshSkills(self); break;
                case Page.Perks: RefreshPerks(self); break;
                case Page.Craft: RefreshCraft(); break;
                case Page.Quests: RefreshQuests(); break;
                case Page.Contracts: RefreshContracts(); break;
                case Page.World: RefreshWorld(); break;
                case Page.Factions: RefreshFactions(self); break;
                case Page.Friends: RefreshFriends(); break;
                case Page.Clan: RefreshClan(); break;
                case Page.Base: RefreshPersonalBasePage(); break;
                case Page.Radio: RefreshRadio(); break;
            }
        }

        private static string Chip(string label, string value)
        {
            return "<color=#6f9c5a>" + label + "</color> <color=#d8f5b8>" + value + "</color>    ";
        }

        /// <summary>Марки на счёте аккаунта (не строка рюкзака).</summary>
        private int CapsCount()
        {
            return Inventory != null ? Inventory.Marks : 0;
        }

        private static string ItemName(string baseId)
        {
            string name = RoaItemData.Name(baseId);
            if (!string.IsNullOrEmpty(name)) return name;
            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(baseId);
            return weapon.Id == baseId ? weapon.Name : baseId;
        }

        private void RefreshItems()
        {
            if (Inventory == null) return;

            _carryLine.text = Inventory.CarryWeight.ToString("0.0")
                + " / " + Inventory.CarryCapacity.ToString("0") + " кг";

            RefreshItemsPanel();

            foreach (GameObject card in _itemCards) Destroy(card);
            _itemCards.Clear();

            _sortLabel.text = "Сортировать · " + (_sortMode == "weight" ? "по весу" : "по типу");

            // Полный список (надетое первым, как в web), затем доступность категорий.
            List<ItemTile> all = BuildItemTiles();

            var available = new HashSet<string>();
            foreach (ItemTile tile in all) available.Add(RoaItemCategories.Category(tile.BaseId));
            foreach (KeyValuePair<string, Button> entry in _categoryButtons)
            {
                bool active = entry.Key == _activeCategory;
                bool enabled = entry.Key == "all" || available.Contains(entry.Key);
                entry.Value.interactable = enabled;
                var image = entry.Value.GetComponent<Image>();
                image.color = active ? new Color(0.19f, 0.15f, 0.08f, 0.96f) : new Color(0.03f, 0.07f, 0.05f, enabled ? 0.74f : 0.3f);
                entry.Value.GetComponent<Outline>().effectColor = active
                    ? new Color(0.816f, 0.631f, 0.306f, 1f)
                    : new Color(0.459f, 0.58f, 0.341f, enabled ? 0.46f : 0.2f);
                Text label = entry.Value.GetComponentInChildren<Text>();
                label.color = active ? AccentWarm : new Color(0.663f, 0.788f, 0.561f, enabled ? 1f : 0.4f);
            }

            ResolveSelectedTile(all);

            // Бейдж быстрого слота — один на вид предмета: три запасных пистолета
            // с одной и той же цифрой читались бы как три разные привязки.
            var badged = new HashSet<string>();
            int visible = 0;
            foreach (ItemTile tile in all)
            {
                if (!RoaItemCategories.Matches(tile.BaseId, _activeCategory)) continue;
                _itemCards.Add(BuildItemCard(tile, badged.Add(tile.BaseId)));
                visible++;
            }
            _categoryEmpty.gameObject.SetActive(visible == 0 && _activeCategory != "all");
            _categoryEmpty.text = "В разделе «" + RoaItemCategories.Label(_activeCategory) + "» пока пусто.";

            RefreshSelection();
        }

        /// <summary>
        /// Надетое идёт первым и никогда не сливается с сумкой: строка сумки сервера —
        /// это запасные вещи, даже если такая же сейчас на персонаже. Экипировка из
        /// сумки раскладывается по одной плитке на экземпляр.
        /// </summary>
        private List<ItemTile> BuildItemTiles()
        {
            var tiles = new List<ItemTile>();
            foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
            {
                string baseId = RoaArmorData.BaseId(slot.Value);
                if (string.IsNullOrEmpty(baseId) || baseId == "fists") continue;
                tiles.Add(new ItemTile { Key = "eq:" + slot.Key, BaseId = baseId, RuntimeId = slot.Value, Slot = slot.Key, Qty = 1 });
            }

            var rest = new List<RoaInventory.Row>();
            var seen = new HashSet<string>();
            foreach (RoaInventory.Row row in Inventory.Items)
            {
                if (row.Qty <= 0 || !seen.Add(row.Id)) continue;
                rest.Add(row);
            }
            if (_sortMode == "weight")
                rest.Sort((a, b) =>
                {
                    float aw = TileWeight(a), bw = TileWeight(b);
                    if (!Mathf.Approximately(aw, bw)) return bw.CompareTo(aw);
                    return string.Compare(ItemName(a.Id), ItemName(b.Id), System.StringComparison.CurrentCulture);
                });
            else
                rest.Sort((a, b) =>
                {
                    int cmp = CategoryOrder(a.Id).CompareTo(CategoryOrder(b.Id));
                    if (cmp != 0) return cmp;
                    return string.Compare(ItemName(a.Id), ItemName(b.Id), System.StringComparison.CurrentCulture);
                });

            foreach (RoaInventory.Row row in rest)
            {
                string baseId = RoaArmorData.BaseId(row.Id);
                if (!RoaInventory.IsGear(baseId))
                {
                    tiles.Add(new ItemTile { Key = "bag:" + baseId + ":0", BaseId = baseId, RuntimeId = row.Id, Slot = string.Empty, Qty = row.Qty });
                    continue;
                }
                List<string> instances = Inventory.BagInstanceIds(baseId, row.Qty);
                for (int i = 0; i < instances.Count; i++)
                    tiles.Add(new ItemTile { Key = "bag:" + baseId + ":" + i, BaseId = baseId, RuntimeId = instances[i], Slot = string.Empty, Qty = 1 });
            }
            return tiles;
        }

        /// <summary>Вес одной плитки: экипировка лежит поштучно, стопка весит целиком.</summary>
        private static float TileWeight(RoaInventory.Row row)
        {
            return RoaItemData.Weight(row.Id) * (RoaInventory.IsGear(row.Id) ? 1 : Mathf.Max(1, row.Qty));
        }

        /// <summary>
        /// Привязать выбор к плитке свежего списка. Если именно эта плитка исчезла
        /// (последний экземпляр надели, сняли или выбросили), выбор переходит на
        /// соседнюю того же вида — иначе серия «выбросить» обрывалась бы на каждом шаге.
        /// </summary>
        private void ResolveSelectedTile(List<ItemTile> tiles)
        {
            if (string.IsNullOrEmpty(_selectedItemId)) { ClearSelection(); return; }
            int found = -1, sameKind = -1;
            bool wantEquipped = _selectedTileKey.StartsWith("eq:", StringComparison.Ordinal);
            for (int i = 0; i < tiles.Count; i++)
            {
                if (tiles[i].Key == _selectedTileKey) { found = i; break; }
                if (tiles[i].BaseId != _selectedItemId) continue;
                if (sameKind < 0 || tiles[i].Equipped == wantEquipped) sameKind = i;
            }
            if (found < 0) found = sameKind;
            if (found < 0) { ClearSelection(); return; }
            SelectTile(tiles[found]);
        }

        private void SelectTile(ItemTile tile)
        {
            _selectedItemId = tile.BaseId;
            _selectedTileKey = tile.Key;
            _selectedRuntimeId = tile.RuntimeId;
            _selectedSlot = tile.Slot;
        }

        private void ClearSelection()
        {
            _selectedItemId = string.Empty;
            _selectedTileKey = string.Empty;
            _selectedRuntimeId = string.Empty;
            _selectedSlot = string.Empty;
        }

        // --- КОЛОНКА ХАРАКТЕРИСТИК ------------------------------------------
        //
        // Строки создаются ОДИН раз и потом только меняют текст. Прежний экран
        // пересобирал списки через Destroy четыре раза в секунду; для колонки из
        // трёх десятков строк это мусор на каждом такте.

        private RectTransform _statsSelfContent;
        private RectTransform _statsEffectsContent;
        private Button _statsTabSelf;
        private Button _statsTabEffects;
        private Text _statsTabSelfLabel;
        private Text _statsTabEffectsLabel;
        private bool _statsShowEffects;
        private readonly Dictionary<string, Text> _statCells = new Dictionary<string, Text>();
        private readonly Dictionary<string, Text> _specialCells = new Dictionary<string, Text>();
        private readonly Dictionary<string, GameObject> _statRows = new Dictionary<string, GameObject>();

        private void BuildStatsColumn(RectTransform panel)
        {
            _statsTabSelf = TextButton("StatsTabSelf", panel, "Персонаж", 10, out _statsTabSelfLabel);
            Place_((RectTransform)_statsTabSelf.transform, 0f, 1f, 0f, 1f, new Vector2(316f, -54f), new Vector2(420f, -30f));
            _statsTabSelf.onClick.AddListener(() => SetStatsTab(false));

            _statsTabEffects = TextButton("StatsTabEffects", panel, "Эффекты", 10, out _statsTabEffectsLabel);
            Place_((RectTransform)_statsTabEffects.transform, 0f, 1f, 0f, 1f, new Vector2(426f, -54f), new Vector2(530f, -30f));
            _statsTabEffects.onClick.AddListener(() => SetStatsTab(true));

            RectTransform scrollArea = Child("StatsScroll", panel);
            Place_(scrollArea, 0f, 0f, 0f, 1f, new Vector2(316f, 6f), new Vector2(530f, -58f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scrollArea.gameObject.AddComponent<RectMask2D>();

            _statsSelfContent = StatsContent("StatsSelf", scrollArea);
            _statsEffectsContent = StatsContent("StatsEffects", scrollArea);
            scroll.content = _statsSelfContent;

            // SPECIAL переехал сюда вместе с закрытием отдельной страницы «Статус»:
            // это единственное место в клиенте, где игрок видит семь характеристик.
            AddStatGroup(_statsSelfContent, "ОСОБЫЕ");
            AddSpecialRow(_statsSelfContent);

            AddStatGroup(_statsSelfContent, "ОСНОВНОЕ");
            AddStatRow(_statsSelfContent, "hp", "Живучесть");
            AddStatRow(_statsSelfContent, "ap", "Очки действий");
            AddStatRow(_statsSelfContent, "speed", "Скорость");
            AddStatRow(_statsSelfContent, "carry", "Переносимый вес");
            AddStatRow(_statsSelfContent, "vision", "Обзор");
            AddStatRow(_statsSelfContent, "power", "Сила снаряжения");
            AddStatRow(_statsSelfContent, "heal", "Эффективность лечения");
            AddStatRow(_statsSelfContent, "regen", "Регенерация");

            AddStatGroup(_statsSelfContent, "ЗАЩИТА");
            foreach ((string id, string label) in ProtectionOrder)
                AddStatRow(_statsSelfContent, "prot:" + id, label);

            AddStatGroup(_statsSelfContent, "БОЙ");
            AddStatRow(_statsSelfContent, "hand", "Правая рука");
            AddStatRow(_statsSelfContent, "offhand", "Левая рука");
            AddStatRow(_statsSelfContent, "damage", "Урон");
            AddStatRow(_statsSelfContent, "range", "Дальность");
            AddStatRow(_statsSelfContent, "ammo", "Патроны");
            AddStatRow(_statsSelfContent, "weaponSkill", "Навык оружия");

            AddStatGroup(_statsSelfContent, "РАЗВИТИЕ");
            AddStatRow(_statsSelfContent, "level", "Уровень");
            AddStatRow(_statsSelfContent, "faction", "Фракция");
            AddStatRow(_statsSelfContent, "skillPoints", "Свободные очки навыков");
            AddStatRow(_statsSelfContent, "perkPoints", "Свободные перки");
            AddStatRow(_statsSelfContent, "focus", "Фокус");

            AddStatGroup(_statsEffectsContent, "СОСТОЯНИЕ");
            AddStatRow(_statsEffectsContent, "injuries", "Травмы");
            AddStatRow(_statsEffectsContent, "hydration", "Гидратация");

            AddStatGroup(_statsEffectsContent, "АРТЕФАКТЫ");
            AddStatRow(_statsEffectsContent, "belt", "Пояс");
            AddStatRow(_statsEffectsContent, "beltTotals", "Итог пояса");
            AddStatRow(_statsEffectsContent, "artifactStatus", "Состояние");

            SetStatsTab(false);
        }

        /// <summary>Порядок типов защиты фиксирован: игрок читает колонку глазами, а не поиском.</summary>
        private static readonly (string id, string label)[] ProtectionOrder =
        {
            ("bullet", "Пуля"), ("explosion", "Взрыв"), ("energy", "Энергия"), ("fire", "Огонь"),
            ("electric", "Электр."), ("toxin", "Токсины"), ("radiation", "Радиация"), ("anomaly", "Аномалия")
        };

        private static RectTransform StatsContent(string name, RectTransform scrollArea)
        {
            RectTransform content = Child(name, scrollArea);
            content.anchorMin = new Vector2(0f, 1f);
            content.anchorMax = new Vector2(1f, 1f);
            content.pivot = new Vector2(0f, 1f);
            content.sizeDelta = Vector2.zero; // иначе Child оставляет 100x100
            var layout = content.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 2f;
            layout.padding = new RectOffset(6, 6, 6, 6);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            layout.childForceExpandWidth = true;
            layout.childControlWidth = true;
            var fitter = content.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            return content;
        }

        private void SetStatsTab(bool effects)
        {
            _statsShowEffects = effects;
            if (_statsSelfContent != null) _statsSelfContent.gameObject.SetActive(!effects);
            if (_statsEffectsContent != null) _statsEffectsContent.gameObject.SetActive(effects);
            if (_statsTabSelfLabel != null)
            {
                _statsTabSelfLabel.color = effects ? RoaUiPalette.InkLabel : RoaUiPalette.Accent;
                _statsTabSelfLabel.fontStyle = effects ? FontStyle.Normal : FontStyle.Bold;
            }
            if (_statsTabEffectsLabel != null)
            {
                _statsTabEffectsLabel.color = effects ? RoaUiPalette.Accent : RoaUiPalette.InkLabel;
                _statsTabEffectsLabel.fontStyle = effects ? FontStyle.Bold : FontStyle.Normal;
            }
            _refreshAt = 0f;
        }

        private void AddStatGroup(RectTransform content, string caption)
        {
            RectTransform row = Child("Group:" + caption, content);
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = 22f;
            Text title = Label("Title", row, 10, TextAnchor.LowerLeft, RoaUiPalette.Accent, FontStyle.Bold);
            title.text = caption;
            Place_(title.rectTransform, 0f, 0f, 1f, 1f, new Vector2(0f, 3f), new Vector2(0f, 0f));
            RectTransform line = Child("Rule", row);
            Place_(line, 0f, 0f, 1f, 0f, new Vector2(0f, 1f), new Vector2(0f, 2f));
            var image = line.gameObject.AddComponent<Image>();
            image.color = RoaUiPalette.Divider;
            image.raycastTarget = false;
        }

        /// <summary>Семь ячеек SPECIAL одной строкой: код сверху, число снизу.</summary>
        private void AddSpecialRow(RectTransform content)
        {
            string[] keys = { "str", "per", "end", "cha", "int", "agi", "luck" };
            string[] codes = { "МЩ", "НБ", "СТ", "ВЛ", "ИН", "РЕ", "ЧУ" };

            RectTransform row = Child("Special", content);
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = 34f;
            for (int i = 0; i < keys.Length; i++)
            {
                RectTransform cell = Panel_(row, CellBg, CellBorder);
                Place_(cell, i / 7f, 0f, (i + 1) / 7f, 1f, new Vector2(1f, 0f), new Vector2(-1f, 0f));
                Text code = Label("Code", cell, 8, TextAnchor.UpperCenter, RoaUiPalette.InkLabel);
                code.horizontalOverflow = HorizontalWrapMode.Overflow;
                code.text = codes[i];
                Place_(code.rectTransform, 0f, 1f, 1f, 1f, new Vector2(0f, -13f), new Vector2(0f, -2f));
                Text value = Label("Value", cell, 14, TextAnchor.LowerCenter, SpecialValue, FontStyle.Bold);
                value.horizontalOverflow = HorizontalWrapMode.Overflow;
                Place_(value.rectTransform, 0f, 0f, 1f, 0f, new Vector2(0f, 1f), new Vector2(0f, 19f));
                _specialCells[keys[i]] = value;
            }
        }

        private void AddStatRow(RectTransform content, string id, string label)
        {
            RectTransform row = Child("Stat:" + id, content);
            row.gameObject.AddComponent<LayoutElement>().preferredHeight = 16f;
            Text caption = Label("Label", row, 10, TextAnchor.MiddleLeft, RoaUiPalette.InkLabel);
            caption.text = label;
            caption.horizontalOverflow = HorizontalWrapMode.Overflow;
            Place_(caption.rectTransform, 0f, 0f, 0.55f, 1f, Vector2.zero, Vector2.zero);
            Text value = Label("Value", row, 10, TextAnchor.MiddleRight, RoaUiPalette.InkPrimary);
            value.horizontalOverflow = HorizontalWrapMode.Overflow;
            Place_(value.rectTransform, 0.55f, 0f, 1f, 1f, Vector2.zero, Vector2.zero);
            _statCells[id] = value;
            _statRows[id] = row.gameObject;
        }

        /// <summary>Строка есть — значит, за ней стоит число. Пустую прячем, а не рисуем прочерк.</summary>
        private void SetStat(string id, string value, Color? color = null)
        {
            if (!_statCells.TryGetValue(id, out Text cell)) return;
            bool has = !string.IsNullOrEmpty(value);
            if (_statRows.TryGetValue(id, out GameObject row) && row.activeSelf != has) row.SetActive(has);
            if (!has) return;
            cell.text = value;
            cell.color = color ?? RoaUiPalette.InkPrimary;
        }

        // --- ЯЧЕЙКА НАДЕТОГО ПРЕДМЕТА ---------------------------------------

        /// <summary>
        /// Ячейка решётки: адрес задаётся клеткой (col,row) и охватом (wSpan,hSpan)
        /// при шаге 100 и зазоре 6. Крупные ячейки показывают больше — вес, тир и
        /// состояние; мелкие ограничиваются артом и именем.
        /// </summary>
        private void BuildEquipCell(RectTransform lattice, string slot, string title,
                                    int col, int row, int wSpan, int hSpan)
        {
            Button button = TextButton("Slot:" + slot, lattice, string.Empty, 9, out Text _);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(col * 100f, -row * 100f);
            rect.sizeDelta = new Vector2(wSpan * 100f - 6f, hSpan * 100f - 6f);
            var image = button.GetComponent<Image>();
            image.sprite = RoaUiPalette.Plate();
            image.type = Image.Type.Sliced;
            image.color = SlotBg;
            var outline = button.gameObject.AddComponent<Outline>();
            outline.effectColor = SlotBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            bool big = wSpan > 1 || hSpan > 1;
            string slotId = slot;

            // Правый клик по слоту — то же меню, что и в списке; подсказка по надетому.
            RoaItemPopups.BindMenu(button.gameObject, () => BuildSlotContextOptions(slotId));
            var hover = button.gameObject.AddComponent<UnityEngine.EventSystems.EventTrigger>();
            var enter = new UnityEngine.EventSystems.EventTrigger.Entry { eventID = UnityEngine.EventSystems.EventTriggerType.PointerEnter };
            enter.callback.AddListener(_ =>
            {
                string rt; if (Inventory != null && Inventory.EquipmentSlots.TryGetValue(slotId, out rt) && !string.IsNullOrEmpty(rt) && RoaItemPopups.Instance != null)
                    RoaItemPopups.Instance.ShowItem(RoaArmorData.BaseId(rt), ItemExtraStat(RoaArmorData.BaseId(rt)));
            });
            var exit = new UnityEngine.EventSystems.EventTrigger.Entry { eventID = UnityEngine.EventSystems.EventTriggerType.PointerExit };
            exit.callback.AddListener(_ => { if (RoaItemPopups.Instance != null) RoaItemPopups.Instance.Hide(); });
            hover.triggers.Add(enter); hover.triggers.Add(exit);

            var cell = new EquipCell { Button = button };

            cell.Type = Label("Type", rect, 8, TextAnchor.UpperLeft, RoaUiPalette.InkLabel);
            cell.Type.text = title.ToUpperInvariant();
            Place_(cell.Type.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -16f), new Vector2(-6f, -4f));

            cell.Name = Label("Name", rect, big ? 11 : 9, TextAnchor.UpperLeft, RoaUiPalette.InkPrimary);
            cell.Name.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(cell.Name.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -34f), new Vector2(-6f, -16f));

            RectTransform artRect = Child("Art", rect);
            float art = big ? (hSpan > 1 ? 104f : 60f) : 46f;
            if (big && hSpan == 1)
            {
                artRect.anchorMin = artRect.anchorMax = new Vector2(0f, 0.5f);
                artRect.pivot = new Vector2(0f, 0.5f);
                artRect.anchoredPosition = new Vector2(10f, -4f);
            }
            else
            {
                artRect.anchorMin = artRect.anchorMax = new Vector2(0.5f, 0.5f);
                artRect.pivot = new Vector2(0.5f, 0.5f);
                artRect.anchoredPosition = new Vector2(0f, big ? -4f : -2f);
            }
            artRect.sizeDelta = new Vector2(art, art);
            cell.Art = artRect.gameObject.AddComponent<RawImage>();
            cell.Art.raycastTarget = false;

            cell.Empty = Label("Empty", rect, 12, TextAnchor.MiddleCenter, RoaUiPalette.InkMuted);
            cell.Empty.text = "—";
            Place_(cell.Empty.rectTransform, 0f, 0f, 1f, 1f, new Vector2(0f, 6f), new Vector2(0f, -30f));

            cell.Weight = Label("Weight", rect, 9, TextAnchor.LowerLeft, RoaUiPalette.InkLabel);
            Place_(cell.Weight.rectTransform, 0f, 0f, 0.5f, 0f, new Vector2(6f, 4f), new Vector2(0f, 16f));
            cell.Meta = Label("Meta", rect, 9, TextAnchor.LowerRight, RoaUiPalette.Accent);
            Place_(cell.Meta.rectTransform, 0.5f, 0f, 1f, 0f, new Vector2(0f, 4f), new Vector2(-6f, 16f));

            RectTransform bar = Child("Condition", rect);
            Place_(bar, 0f, 0f, 1f, 0f, new Vector2(1f, 1f), new Vector2(-1f, 3f));
            cell.Condition = bar.gameObject.AddComponent<Image>();
            cell.Condition.raycastTarget = false;
            cell.Condition.color = RoaUiPalette.InkPrimary;

            button.onClick.AddListener(() => OnItemsSlotClicked(slotId));
            _equipCells[slot] = cell;
        }
        private void OnItemsSlotClicked(string slot)
        {
            if (Inventory == null) return;
            Inventory.EquipmentSlots.TryGetValue(slot, out string current);
            string currentBase = RoaArmorData.BaseId(current ?? string.Empty);
            // Выбрана подходящая вещь из сумки — надеть (в том числе такую же на замену
            // надетой); иначе клик по занятому слоту снимает (equip-clear ×).
            bool bagTileSelected = !string.IsNullOrEmpty(_selectedItemId) && string.IsNullOrEmpty(_selectedSlot);
            if (bagTileSelected && RoaInventory.SlotFor(_selectedItemId) == slot)
            {
                SubmitEquip(slot, _selectedRuntimeId);
                return;
            }
            if (!string.IsNullOrEmpty(currentBase) && currentBase != "fists") SubmitUnequip(slot);
        }

        private void OnQuickSlotClicked(int index)
        {
            if (Quickbar == null) return;
            if (!string.IsNullOrEmpty(_selectedItemId) && Inventory != null && Inventory.IsQuickAssignable(_selectedItemId))
            {
                Quickbar.Assign(index, _selectedItemId);
                _itemsStatus.text = "Слот " + (index + 1) + ": " + ItemName(_selectedItemId);
            }
            else if (index < Quickbar.Slots.Count && !string.IsNullOrEmpty(Quickbar.Slots[index]))
            {
                Quickbar.ClearSlot(index);
                _itemsStatus.text = "Слот " + (index + 1) + " очищен.";
            }
            else _itemsStatus.text = "Выберите предмет для быстрого доступа.";
            _refreshAt = 0f;
        }

        private void RefreshItemsPanel()
        {
            JObject self = Socket != null && Socket.Session != null ? Socket.Session.Self : null;
            _itemsPanelName.text = (self?["name"]?.ToString() ?? "Странник").ToUpperInvariant();

            string clan = self?["socialState"]?["clan"]?["name"]?.ToString();
            string faction = RoaPipboy.FactionLabel(self?["worldFactionId"]?.ToString() ?? self?["factionId"]?.ToString());
            _invClanLine.text = string.IsNullOrEmpty(clan) ? faction : clan + " · " + faction;
            _invFundsLine.text = "Марки · " + CapsCount().ToString("N0", System.Globalization.CultureInfo.CurrentCulture);

            float capacity = Mathf.Max(0.01f, Inventory.CarryCapacity);
            float share = Inventory.CarryWeight / capacity;
            _weightFill.anchorMax = new Vector2(Mathf.Clamp01(share), 1f);
            _weightFillImage.color = share > 1f ? RoaUiPalette.Negative
                : share > 0.85f ? RoaUiPalette.Accent : RoaUiPalette.InkPrimary;

            int filled = 0;
            foreach (KeyValuePair<string, EquipCell> entry in _equipCells)
            {
                EquipCell cell = entry.Value;
                string runtimeId = Inventory.EquipmentSlots.TryGetValue(entry.Key, out string id) ? id : string.Empty;
                string baseId = RoaArmorData.BaseId(runtimeId ?? string.Empty);
                bool has = !string.IsNullOrEmpty(baseId) && baseId != "fists";
                if (has) filled++;

                cell.Art.texture = has ? RoaItemCategories.Art(baseId) : null;
                cell.Art.enabled = has && cell.Art.texture != null;
                cell.Empty.gameObject.SetActive(!has);
                cell.Name.text = has ? ItemName(baseId) : string.Empty;
                cell.Name.color = has ? RoaUiPalette.TierInk(RoaGearData.Tier(baseId)) : RoaUiPalette.InkLabel;

                cell.Weight.text = has ? RoaItemData.Weight(baseId).ToString("0.#") + " кг" : string.Empty;

                // Состояние показываем только у того, что вообще изнашивается:
                // у пояса и детектора шкалы прочности нет, и рисовать её — врать.
                bool wears = has && Inventory.IsRepairable(baseId);
                float condition = wears ? Inventory.ConditionPercent(runtimeId) : 0f;
                int tier = has ? RoaGearData.Tier(baseId) : 0;
                string tierLabel = tier > 0 ? RoaGearData.TierShortLabel(tier) : string.Empty;
                string metaText = wears ? condition.ToString("0") + "%" : string.Empty;
                if (!string.IsNullOrEmpty(tierLabel))
                    metaText = string.IsNullOrEmpty(metaText) ? tierLabel : tierLabel + " · " + metaText;
                cell.Meta.text = metaText;

                cell.Condition.enabled = wears;
                if (wears)
                {
                    var barRect = (RectTransform)cell.Condition.transform;
                    barRect.anchorMax = new Vector2(Mathf.Clamp01(condition / 100f), 0f);
                    cell.Condition.color = condition < 25f ? RoaUiPalette.Negative
                        : condition < 60f ? RoaUiPalette.Accent : RoaUiPalette.InkPrimary;
                }

                bool highlight = !string.IsNullOrEmpty(_selectedItemId) && RoaInventory.SlotFor(_selectedItemId) == entry.Key;
                cell.Button.GetComponent<Outline>().effectColor = highlight ? AccentWarm
                    : has ? EquippedSlotBorder : SlotBorder;
            }
            _itemsPanelSlots.text = filled + "/" + RoaInventory.SlotCount + " СЛОТОВ";

            int power = RoaGearData.PowerTotal(Inventory.EquipmentSlots,
                itemId => Mathf.RoundToInt(Inventory.ConditionOf(itemId)));
            _gearPowerLine.text = "СИЛА СНАРЯЖЕНИЯ · " + power;

            RefreshStatsColumn(self);

            if (Quickbar != null)
            {
                for (int i = 0; i < _quickSlots.Count; i++)
                {
                    string item = i < Quickbar.Slots.Count ? Quickbar.Slots[i] : null;
                    _quickSlots[i].label.text = Quickbar.SlotLabel(i, item);
                    _quickSlots[i].label.color = string.IsNullOrEmpty(item) ? ScreenInkDim : SlotName;
                }
            }
        }

        /// <summary>
        /// Колонка чисел. Правило одно: нет числа — нет строки. Единственное
        /// исключение — нулевая защита: её показываем приглушённой, потому что
        /// «защиты нет» это тоже сведение, и игрок обязан его получить до боя.
        /// </summary>
        private void RefreshStatsColumn(JObject self)
        {
            if (_statsShowEffects) { RefreshEffectsColumn(self); return; }

            JObject special = self?["special"] as JObject;
            foreach (KeyValuePair<string, Text> cell in _specialCells)
                cell.Value.text = (special?[cell.Key]?.ToObject<int>() ?? 5).ToString();

            SetStat("hp", Hud != null ? Hud.Hp + " / " + Mathf.Max(1, Hud.MaxHp) : null);
            SetStat("ap", Hud != null ? Mathf.FloorToInt(Hud.Ap) + " / " + Mathf.Max(1, Hud.MaxAp) : null);
            SetStat("speed", Player != null ? Player.Speed.ToString("0.0") + " м/с" : null);
            SetStat("carry", Inventory.CarryCapacity.ToString("0") + " кг");
            SetStat("vision", Fog != null ? Fog.Radius + " кл." : null);
            SetStat("power", RoaGearData.PowerTotal(Inventory.EquipmentSlots,
                itemId => Mathf.RoundToInt(Inventory.ConditionOf(itemId))).ToString());

            JObject effects = self?["artifactEffects"] as JObject;
            float heal = effects?["medkitEffectPct"]?.ToObject<float>() ?? 0f;
            SetStat("heal", Mathf.Approximately(heal, 0f) ? null : (heal > 0f ? "+" : string.Empty) + heal.ToString("0.#") + " %");
            float regen = effects?["regenHpPerSecond"]?.ToObject<float>() ?? 0f;
            // Подпись прямо называет источник: естественной регенерации в игре нет,
            // и без пояса эта строка обязана исчезать, а не показывать ноль.
            SetStat("regen", Mathf.Approximately(regen, 0f) ? null : regen.ToString("0.##") + " ОЗ/с (пояс)");

            JObject protection = self?["combatProtection"] as JObject;
            foreach ((string id, string _) in ProtectionOrder)
            {
                JToken row = protection?[id];
                if (row == null) { SetStat("prot:" + id, null); continue; }
                int threshold = row["threshold"]?.ToObject<int>() ?? 0;
                int percent = row["protection"]?.ToObject<int>() ?? row["resistance"]?.ToObject<int>() ?? 0;
                bool none = threshold == 0 && percent == 0;
                SetStat("prot:" + id, "порог " + threshold + " · " + percent + " %",
                        none ? RoaUiPalette.InkMuted : RoaUiPalette.InkPrimary);
            }

            string weaponId = Inventory.EquipmentSlots.TryGetValue("weapon", out string w) ? RoaArmorData.BaseId(w) : string.Empty;
            string offhandId = Inventory.EquipmentSlots.TryGetValue("offhand", out string o) ? RoaArmorData.BaseId(o) : string.Empty;
            string heldId = !string.IsNullOrEmpty(weaponId) && weaponId != "fists" ? weaponId
                : (!string.IsNullOrEmpty(offhandId) ? offhandId : "fists");
            SetStat("hand", !string.IsNullOrEmpty(weaponId) && weaponId != "fists" ? ItemName(weaponId) : "Кулаки");
            SetStat("offhand", !string.IsNullOrEmpty(offhandId) ? ItemName(offhandId) : null);

            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(heldId);
            SetStat("damage", weapon.DmgMin + "-" + weapon.DmgMax);
            SetStat("range", RoaGearData.Range(heldId).ToString("0.##"));
            // Магазин и запас сервер шлёт только для активного оружия — для всего
            // остального честнее назвать тип патрона, чем выдумывать числа.
            SetStat("ammo", string.IsNullOrEmpty(weapon.AmmoType) ? null
                : Hud != null && Hud.MagSize > 0
                    ? Hud.Loaded + " / " + Hud.MagSize + " · запас " + Hud.ReserveAmmo
                    : RoaWeaponData.AmmoLabel(weapon.AmmoType));
            SetStat("weaponSkill", Hud != null ? Hud.WeaponSkillPercent + " %" : null);

            SetStat("level", self?["level"]?.ToObject<int>().ToString());
            SetStat("faction", RoaPipboy.FactionLabel(self?["worldFactionId"]?.ToString() ?? self?["factionId"]?.ToString()));
            int skillPoints = self?["skillPoints"]?.ToObject<int>() ?? 0;
            SetStat("skillPoints", skillPoints > 0 ? skillPoints.ToString() : null, RoaUiPalette.Accent);
            int perkPoints = self?["talentPoints"]?.ToObject<int>() ?? self?["perkPoints"]?.ToObject<int>() ?? 0;
            SetStat("perkPoints", perkPoints > 0 ? perkPoints.ToString() : null, RoaUiPalette.Accent);
            // Фокус премиума: тратится у станков участков на возврат материалов.
            SetStat("focus", RoaCraftingPlots.FocusText(self?["account"] as JObject));
        }

        private void RefreshEffectsColumn(JObject self)
        {
            JObject injuries = self?["injuries"] as JObject;
            var names = new List<string>();
            if (injuries?["brokenArm"]?.ToObject<bool>() == true) names.Add("перелом руки");
            if (injuries?["brokenLeg"]?.ToObject<bool>() == true) names.Add("перелом ноги");
            if (injuries?["concussion"]?.ToObject<bool>() == true) names.Add("сотрясение");
            if (injuries?["infection"]?.ToObject<bool>() == true) names.Add("инфекция");
            SetStat("injuries", names.Count > 0 ? string.Join(" · ", names) : "нет",
                    names.Count > 0 ? RoaUiPalette.Negative : RoaUiPalette.InkPrimary);

            SetStat("hydration", Hud != null ? Hud.Hydration.ToString("0") + " %" : null);

            int belt = 0;
            foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                if (entry.Key == "artifactBelt" && !string.IsNullOrEmpty(entry.Value)) belt++;
            int capacity = self?["artifactBeltCapacity"]?.ToObject<int>() ?? 0;
            SetStat("belt", capacity > 0 ? belt + " / " + capacity : null);
            string totals = BeltTotalsLine(self?["artifactEffects"] as JObject);
            SetStat("beltTotals", string.IsNullOrEmpty(totals) ? null : totals);
            SetStat("artifactStatus", string.IsNullOrEmpty(Inventory.ArtifactStatus) ? null : Inventory.ArtifactStatus);
        }
        /// <summary>
        /// Карточка предмета 102x96. Шесть зон вместо прежних трёх: категория и
        /// состояние сверху, имя цветом тира, арт, вес и калибр снизу, полоска
        /// износа по нижней кромке. Всё, кроме имени, появляется только когда за
        /// ним стоит число — пустых подписей на карточке нет.
        /// </summary>
        private GameObject BuildItemCard(ItemTile tile, bool showQuickBadge)
        {
            // Дальше карточка читает вид предмета; экземпляр нужен только износу и действиям.
            var row = new RoaInventory.Row { Id = tile.BaseId, Qty = tile.Qty };
            var card = new GameObject("Item:" + tile.Key, typeof(RectTransform));
            card.transform.SetParent(_itemsGrid, false);
            var image = card.AddComponent<Image>();
            bool equipped = tile.Equipped;
            image.sprite = RoaUiPalette.Plate();
            image.type = Image.Type.Sliced;
            image.color = tile.Key == _selectedTileKey ? RoaUiPalette.TileSelected : RoaUiPalette.TileBg;
            var outline = card.AddComponent<Outline>();
            outline.effectColor = equipped ? RoaUiPalette.EquippedEdge : RoaUiPalette.TileBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            var rect = (RectTransform)card.transform;

            // Верхняя строка: к какому разделу предмет относится. Берём подпись
            // категории, а не RoaItemInfo.Type — там у десяти записей лежит
            // английский ключ слота, и карточка прочлась бы как «helmet».
            Text meta = Label("Meta", rect, 9, TextAnchor.UpperLeft, RoaUiPalette.InkLabel);
            meta.horizontalOverflow = HorizontalWrapMode.Overflow;
            meta.text = equipped ? "НАДЕТО" : RoaItemCategories.Label(RoaItemCategories.Category(row.Id));
            if (equipped) meta.color = RoaUiPalette.EquippedEdge;
            Place_(meta.rectTransform, 0f, 1f, 0.62f, 1f, new Vector2(5f, -16f), new Vector2(0f, -3f));

            // Состояние — только у того, что изнашивается.
            bool wears = Inventory != null && Inventory.IsRepairable(row.Id);
            float condition = !wears ? 0f
                : equipped ? Inventory.ConditionPercent(tile.RuntimeId)
                : Inventory.BagConditionPercent(tile.RuntimeId);
            if (wears)
            {
                Text state = Label("Condition", rect, 9, TextAnchor.UpperRight, RoaUiPalette.Accent);
                state.horizontalOverflow = HorizontalWrapMode.Overflow;
                state.text = condition.ToString("0") + "%";
                Place_(state.rectTransform, 0.62f, 1f, 1f, 1f, new Vector2(0f, -16f), new Vector2(-5f, -3f));
            }

            Text name = Label("Name", rect, 10, TextAnchor.UpperLeft, RoaUiPalette.TierInk(RoaGearData.Tier(row.Id)));
            name.horizontalOverflow = HorizontalWrapMode.Wrap;
            name.verticalOverflow = VerticalWrapMode.Truncate;
            name.text = ItemName(row.Id);
            Place_(name.rectTransform, 0f, 1f, 1f, 1f, new Vector2(5f, -38f), new Vector2(-5f, -16f));

            RectTransform artRect = Child("Art", rect);
            artRect.anchorMin = artRect.anchorMax = new Vector2(0.5f, 0f);
            artRect.pivot = new Vector2(0.5f, 0f);
            artRect.anchoredPosition = new Vector2(0f, 16f);
            artRect.sizeDelta = new Vector2(50f, 50f);
            var art = artRect.gameObject.AddComponent<RawImage>();
            art.texture = RoaItemCategories.Art(row.Id);
            art.raycastTarget = false;
            art.enabled = art.texture != null;

            // Бейдж горячей клавиши рисуем ТОЛЬКО когда предмет действительно
            // назначен: пустой квадрат обещал бы игроку несуществующую привязку.
            int quickIndex = showQuickBadge ? QuickSlotOf(row.Id) : -1;
            if (quickIndex >= 0)
            {
                RectTransform badge = Child("Quick", rect);
                badge.anchorMin = badge.anchorMax = new Vector2(0f, 0f);
                badge.pivot = new Vector2(0f, 0f);
                badge.anchoredPosition = new Vector2(4f, 3f);
                badge.sizeDelta = new Vector2(14f, 14f);
                var badgeImage = badge.gameObject.AddComponent<Image>();
                badgeImage.sprite = RoaUiPalette.Plate();
                badgeImage.type = Image.Type.Sliced;
                badgeImage.color = new Color(0.016f, 0.055f, 0.031f, 0.9f);
                badgeImage.raycastTarget = false;
                Text badgeLabel = Label("Label", badge, 9, TextAnchor.MiddleCenter, RoaUiPalette.Accent);
                badgeLabel.horizontalOverflow = HorizontalWrapMode.Overflow;
                badgeLabel.text = (quickIndex + 1).ToString();
                Stretch(badgeLabel.rectTransform, 0f);
            }

            float weight = RoaItemData.Weight(row.Id) * Mathf.Max(1, row.Qty);
            Text weightText = Label("Weight", rect, 9, TextAnchor.LowerLeft, RoaUiPalette.InkLabel);
            weightText.horizontalOverflow = HorizontalWrapMode.Overflow;
            weightText.text = weight >= 1f ? weight.ToString("0.#") + " кг"
                                           : Mathf.RoundToInt(weight * 1000f) + " г";
            Place_(weightText.rectTransform, 0f, 0f, 0.55f, 0f, new Vector2(quickIndex >= 0 ? 22f : 5f, 3f), new Vector2(0f, 15f));

            // Правый нижний угол: количество для стопки, иначе калибр у ствола,
            // иначе тир. Боезапас сервер шлёт только для активного оружия, поэтому
            // на карточке в сумке его нет — там честнее назвать патрон.
            string corner = string.Empty;
            if (row.Qty > 1) corner = "×" + row.Qty;
            else if (Inventory != null && Inventory.IsFirearmItem(row.Id))
                corner = RoaWeaponData.AmmoLabel(RoaWeaponData.Get(row.Id).AmmoType);
            else
            {
                int tier = RoaGearData.Tier(row.Id);
                if (tier > 0) corner = RoaGearData.TierShortLabel(tier);
            }
            if (!string.IsNullOrEmpty(corner))
            {
                Text cornerText = Label("Corner", rect, 9, TextAnchor.LowerRight, RoaUiPalette.Accent);
                cornerText.horizontalOverflow = HorizontalWrapMode.Overflow;
                cornerText.text = corner;
                Place_(cornerText.rectTransform, 0.55f, 0f, 1f, 0f, new Vector2(0f, 3f), new Vector2(-5f, 15f));
            }

            if (wears)
            {
                RectTransform bar = Child("ConditionBar", rect);
                bar.anchorMin = new Vector2(0f, 0f);
                bar.anchorMax = new Vector2(Mathf.Clamp01(condition / 100f), 0f);
                bar.offsetMin = new Vector2(1f, 1f);
                bar.offsetMax = new Vector2(-1f, 3f);
                var barImage = bar.gameObject.AddComponent<Image>();
                barImage.raycastTarget = false;
                barImage.color = condition < 25f ? RoaUiPalette.Negative
                    : condition < 60f ? RoaUiPalette.Accent : RoaUiPalette.InkPrimary;
            }

            var button = card.AddComponent<Button>();
            button.targetGraphic = image;
            ItemTile captured = tile;
            button.onClick.AddListener(() => OnCardClicked(captured));
            // Подсказка (showTooltip) и контекстное меню правой кнопкой (showItemContextMenu web 03d:229).
            RoaItemPopups.Bind(card, tile.BaseId, ItemExtraStat(tile.BaseId, wears ? condition : -1f));
            RoaItemPopups.BindMenu(card, () => { SelectTile(captured); _refreshAt = 0f; return BuildItemContextOptions(captured); });
            return card;
        }

        private int QuickSlotOf(string baseId)
        {
            if (Quickbar == null || string.IsNullOrEmpty(baseId)) return -1;
            for (int i = 0; i < Quickbar.Slots.Count; i++)
                if (Quickbar.Slots[i] == baseId) return i;
            return -1;
        }

        /// <summary>
        /// Обычный клик выбирает предмет, SHIFT — сразу экипирует. Полоса подсказок
        /// обещает игроку именно это, и обещание обязано быть правдой.
        /// </summary>
        private void OnCardClicked(ItemTile tile)
        {
            SelectTile(tile);
            _refreshAt = 0f;
            if (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift)) OnEquipClicked();
        }

        /// <summary>Порядок типов compareItemEntries('type') web: оружие, броня, патроны, мед., инструменты, материалы, разное.</summary>
        private static int CategoryOrder(string id)
        {
            switch (RoaItemCategories.Category(id))
            {
                case "weapons": return 1;
                case "armor": return 2;
                case "ammo": return 3;
                case "aid": return 4;
                case "tools": return 5;
                case "materials": return 6;
                default: return id == "silver" ? 9 : 7;
            }
        }

        private void RefreshSelection()
        {
            bool hasSelection = !string.IsNullOrEmpty(_selectedItemId);
            bool equipped = hasSelection && !string.IsNullOrEmpty(_selectedSlot);
            _selectedTitle.text = hasSelection
                ? "Выбрано: " + ItemName(_selectedItemId) + (equipped ? " · надето" : string.Empty)
                : "Выберите предмет, чтобы действовать.";
            if (!string.IsNullOrEmpty(Inventory.ArtifactStatus)) _selectedTitle.text += "   ·   " + Inventory.ArtifactStatus;

            _equipButton.gameObject.SetActive(hasSelection);
            _useButton.gameObject.SetActive(hasSelection && Inventory.IsQuickAssignable(_selectedItemId));
            _dropButton.gameObject.SetActive(hasSelection && !equipped);
            _modifyButton.gameObject.SetActive(hasSelection && RoaWeaponModificationData.IsFirearm(_selectedItemId));
            _equipLabel.text = Inventory.ArtifactsFor(_selectedItemId).Count > 0 ? "Артефакт…" : equipped ? "Снять" : "Экипировать";
        }

        private void OnEquipClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            if (Inventory.ArtifactsFor(_selectedItemId).Count > 0)
            {
                RoaItemPopups.Instance?.ShowMenu(BuildArtifactContextOptions(_selectedItemId));
                return;
            }

            if (!string.IsNullOrEmpty(_selectedSlot)) { SubmitUnequip(_selectedSlot); return; }

            string slot = RoaInventory.SlotFor(_selectedItemId);
            if (slot == null) { _itemsStatus.text = "Этот предмет не экипируется."; return; }
            SubmitEquip(slot, _selectedRuntimeId);
        }

        /// <summary>
        /// Надеть именно этот экземпляр. После ответа выбор переходит на надетую
        /// плитку: кнопка сразу читается «Снять», а не предлагает надеть следующий
        /// такой же предмет из сумки.
        /// </summary>
        private void SubmitEquip(string slot, string runtimeId)
        {
            string baseId = RoaArmorData.BaseId(runtimeId);
            Submit(Inventory.SubmitEquipmentAction(slot, runtimeId, ack =>
            {
                OnActionAck(ack);
                if (ack == null || ack["ok"]?.ToObject<bool>() != true || _selectedItemId != baseId) return;
                string target = null;
                foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                {
                    if (RoaArmorData.BaseId(entry.Value) != baseId) continue;
                    // Двуручное, надетое «в левую», сервер кладёт в правую — слот берём из ответа.
                    if (runtimeId != baseId && entry.Value == runtimeId) { target = entry.Key; break; }
                    if (target == null || entry.Key == slot) target = entry.Key;
                }
                if (target != null) _selectedTileKey = "eq:" + target;
            }), "Экипирую…");
        }

        /// <summary>Снять вещь из слота; выбор уходит за ней в сумку.</summary>
        private void SubmitUnequip(string slot)
        {
            Inventory.EquipmentSlots.TryGetValue(slot, out string runtimeId);
            string baseId = RoaArmorData.BaseId(runtimeId ?? string.Empty);
            Submit(Inventory.SubmitEquipmentAction(slot, string.Empty, ack =>
            {
                OnActionAck(ack);
                if (ack == null || ack["ok"]?.ToObject<bool>() != true || _selectedTileKey != "eq:" + slot) return;
                int copy = RoaInventory.IsGear(baseId)
                    ? Mathf.Max(0, Inventory.BagInstanceIds(baseId, Inventory.CountOf(baseId)).IndexOf(runtimeId))
                    : 0;
                _selectedTileKey = "bag:" + baseId + ":" + copy;
            }), "Снимаю…");
        }

        private Button _modifyButton;

        /// <summary>Контекстное «Модификация» web (03d:250): только огнестрел.</summary>
        private void OnModifyClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            if (Inventory.OpenWorkbench(_selectedRuntimeId)) Close();
            else _itemsStatus.text = Inventory.ActionStatus;
        }

        /// <summary>Динамическая часть строки характеристик: состояние и магазин, как itemStatLine web.</summary>
        private string ItemExtraStat(string baseId, float tileCondition = -1f)
        {
            var parts = new List<string>();
            // У плитки состояние своё: запасной ствол не должен показывать износ надетого.
            if (Inventory != null && (Inventory.IsRepairable(baseId)))
                parts.Add("состояние " + Mathf.RoundToInt(tileCondition >= 0f ? tileCondition : Inventory.ConditionPercent(baseId)) + "%");
            // Пояс показывает, что он сейчас даёт и где потолок: до этого итог
            // эффектов считался на сервере, но игроку его никто не показывал.
            if (baseId != null && baseId.StartsWith("artifactBelt", StringComparison.Ordinal))
            {
                string totals = BeltTotalsLine(Pipboy?.Self?["artifactEffects"] as JObject);
                if (!string.IsNullOrEmpty(totals)) parts.Add(totals);
            }
            var artifacts = Inventory != null ? Inventory.ArtifactsFor(baseId) : new List<JObject>();
            if (artifacts.Count > 0)
            {
                parts.Add(ArtifactCardSummary(artifacts[0], artifacts.Count));
                string note = artifacts[0]["implementationNote"]?.ToString();
                if (!string.IsNullOrEmpty(note)) parts.Add(note);
            }
            return parts.Count > 0 ? string.Join(" · ", parts) : null;
        }

        /// <summary>
        /// Итог пояса одной строкой: что он сейчас даёт и где потолок. Потолки
        /// приходят с сервера вместе с эффектами; без них игрок не понимает,
        /// почему четвёртая «Пружина» уже ничего не добавляет.
        /// </summary>
        public static string BeltTotalsLine(JObject effects)
        {
            if (effects == null) return string.Empty;
            int count = (effects["artifactTypeIds"] as JArray)?.Count ?? 0;
            if (count == 0) return "пояс пуст";
            JObject caps = effects["caps"] as JObject;
            var parts = new List<string>();
            AddTotal(parts, "скорость", effects["speedPct"]?.Value<float>() ?? 0f, caps?["speedPct"]?.Value<float>() ?? 0f, true, string.Empty);
            AddTotal(parts, "груз", effects["carryKg"]?.Value<float>() ?? 0f, caps?["carryKg"]?.Value<float>() ?? 0f, false, " кг");
            AddTotal(parts, "регенерация", effects["regenHpPerSecond"]?.Value<float>() ?? 0f,
                caps?["regenHpPerSecond"]?.Value<float>() ?? 0f, false, " HP/с");
            AddTotal(parts, "ближний урон", effects["meleeDamagePct"]?.Value<float>() ?? 0f, 0f, true, string.Empty);
            if (parts.Count == 0) return "артефактов на поясе: " + count;
            return "пояс (" + count + "): " + string.Join(", ", parts);
        }

        private static void AddTotal(List<string> parts, string name, float value, float cap, bool percent, string unit)
        {
            if (Mathf.Abs(value) < 0.0005f) return;
            string shown = percent
                ? (value > 0f ? "+" : string.Empty) + Mathf.RoundToInt(value * 100f) + "%"
                : (value > 0f ? "+" : string.Empty) + value.ToString("0.#") + unit;
            if (cap > 0f)
            {
                shown += value >= cap - 0.0005f
                    ? " (предел)"
                    : " (до " + (percent ? "+" + Mathf.RoundToInt(cap * 100f) + "%" : "+" + cap.ToString("0.#") + unit) + ")";
            }
            parts.Add(name + " " + shown);
        }

        /// <summary>
        /// Карточка артефакта: тир в цвете шкалы экипировки (RoaGearData.TierTint),
        /// статус, раскрытые свойства или пометка, что они скрыты до стабилизации,
        /// цена стабилизации и выход разбора. Все данные — из записи сервера.
        /// </summary>
        public static string ArtifactCardSummary(JObject record, int count)
        {
            if (record == null) return string.Empty;
            int tier = record["tier"]?.Value<int>() ?? 0;
            string tierHex = ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(tier));
            string tierLabel = tier > 0
                ? "<color=#" + tierHex + ">" + (record["tierShort"]?.ToString() ?? RoaGearData.TierShortLabel(tier))
                    + " " + (record["tierName"]?.ToString() ?? string.Empty).Trim() + "</color>"
                : string.Empty;
            bool stabilized = record["stabilized"]?.Value<bool>() == true && record["hot"]?.Value<bool>() != true;
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(tierLabel)) parts.Add(tierLabel);
            parts.Add(stabilized ? "стабильный" : "сырой");
            if (count > 1) parts.Add("экз. ×" + count);
            JObject properties = record["properties"] as JObject;
            if (stabilized && properties != null)
            {
                // После стабилизации показываются точные значения экземпляра, а не
                // типовое описание вида: сервер присылает primary/secondary/drawback.
                string values = ArtifactEffectList(properties["primary"], properties["secondary"]);
                if (!string.IsNullOrEmpty(values)) parts.Add(values);
                else
                {
                    string benefit = record["benefit"]?.ToString();
                    if (!string.IsNullOrEmpty(benefit)) parts.Add(benefit);
                }
                string drawbacks = ArtifactEffectList(null, properties["drawback"]);
                if (!string.IsNullOrEmpty(drawbacks)) parts.Add("недостатки: " + drawbacks);
                else
                {
                    string cost = record["cost"]?.ToString();
                    if (!string.IsNullOrEmpty(cost)) parts.Add("недостатки: " + cost);
                }
            }
            else
            {
                parts.Add("свойства скрыты до стабилизации");
                string source = ArtifactSourceLabel(record["sourceAnomalyType"]?.ToString());
                if (!string.IsNullOrEmpty(source)) parts.Add("источник: " + source);
                parts.Add("стабилизация: " + ArtifactCostLabel(record["stabilizationCost"] as JObject));
            }
            string salvage = ArtifactYieldLabel(record["salvageYields"] as JArray);
            if (!string.IsNullOrEmpty(salvage)) parts.Add("разбор: " + salvage);
            return string.Join(" · ", parts);
        }

        /// <summary>
        /// Список эффектов экземпляра «имя значение» из строк сервера
        /// ({ key, value }). Первым идёт основное свойство, затем остальные.
        /// </summary>
        public static string ArtifactEffectList(JToken primary, JToken rest)
        {
            var parts = new List<string>();
            AppendArtifactEffect(parts, primary as JObject);
            if (rest is JArray rows)
            {
                foreach (JToken row in rows) AppendArtifactEffect(parts, row as JObject);
            }
            else AppendArtifactEffect(parts, rest as JObject);
            return parts.Count > 0 ? string.Join(", ", parts) : string.Empty;
        }

        private static void AppendArtifactEffect(List<string> parts, JObject effect)
        {
            if (effect == null) return;
            string key = effect["key"]?.ToString();
            if (string.IsNullOrEmpty(key)) return;
            JToken valueToken = effect["value"];
            if (valueToken == null || (valueToken.Type != JTokenType.Float && valueToken.Type != JTokenType.Integer)) return;
            float value = valueToken.Value<float>();
            if (key.StartsWith("resistances."))
            {
                parts.Add("сопр. " + key.Substring("resistances.".Length) + " " + Signed(value, true));
                return;
            }
            parts.Add(ArtifactStatName(key) + " " + Signed(value, key.EndsWith("Pct")));
        }

        /// <summary>Природный источник вида: тип аномалии, в которой он рождается.</summary>
        public static string ArtifactSourceLabel(string anomalyType)
        {
            switch (anomalyType)
            {
                case "pull": return "Тяга";
                case "seam": return "Шов";
                case "carousel": return "Карусель";
                case "glass": return "Стекло";
                case "dew": return "Роса";
                case "sink": return "Провал";
                case "chime": return "Звон";
                case "mute": return "Молчун";
                default: return string.Empty;
            }
        }

        public static string ArtifactCostLabel(JObject cost)
        {
            if (cost == null) return "—";
            var parts = new List<string>();
            int silver = cost["silver"]?.Value<int>() ?? 0;
            if (silver > 0) parts.Add(RoaPlural.Marks(silver));
            foreach (JToken token in cost["items"] as JArray ?? new JArray())
            {
                string id = token["id"]?.ToString() ?? string.Empty;
                int qty = token["qty"]?.Value<int>() ?? 0;
                if (!string.IsNullOrEmpty(id) && qty > 0) parts.Add(RoaItemData.Name(id) + " ×" + qty);
            }
            return parts.Count > 0 ? string.Join(" + ", parts) : "бесплатно";
        }

        public static string ArtifactYieldLabel(JArray yields)
        {
            if (yields == null) return string.Empty;
            var parts = new List<string>();
            foreach (JToken token in yields)
            {
                string id = token["id"]?.ToString() ?? string.Empty;
                int qty = token["qty"]?.Value<int>() ?? 0;
                if (!string.IsNullOrEmpty(id) && qty > 0) parts.Add(RoaItemData.Name(id) + " ×" + qty);
            }
            return string.Join(", ", parts);
        }

        /// <summary>Дельта предпросмотра контейнера: только изменившиеся характеристики.</summary>
        public static string ArtifactPreviewLabel(JObject preview)
        {
            JObject delta = preview?["delta"] as JObject;
            if (delta == null || !delta.HasValues) return "Характеристики не изменятся.";
            var parts = new List<string>();
            foreach (JProperty property in delta.Properties())
            {
                if (property.Name == "resistances" && property.Value is JObject resistances)
                {
                    foreach (JProperty res in resistances.Properties())
                        parts.Add("сопр. " + res.Name + " " + Signed(res.Value.Value<float>(), true));
                    continue;
                }
                if (property.Value.Type != JTokenType.Float && property.Value.Type != JTokenType.Integer) continue;
                float value = property.Value.Value<float>();
                bool pct = property.Name.EndsWith("Pct");
                parts.Add(ArtifactStatName(property.Name) + " " + Signed(value, pct));
            }
            return parts.Count > 0 ? string.Join(", ", parts) : "Характеристики не изменятся.";
        }

        private static string Signed(float value, bool pct)
        {
            string number = pct ? Mathf.RoundToInt(value * 100f).ToString() + "%" : value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
            return (value > 0 ? "+" : string.Empty) + number;
        }

        private static string ArtifactStatName(string key)
        {
            switch (key)
            {
                case "speedPct": return "скорость";
                case "apRegenPct": return "восст. ОД";
                case "carryKg": return "груз (кг)";
                case "meleeDamagePct": return "ближний урон";
                case "maxHpFlat": return "макс. HP";
                case "medkitEffectPct": return "аптечки";
                case "waterUsePct": return "расход воды";
                case "regenHpPerSecond": return "реген HP/с";
                case "regenDelaySeconds": return "задержка регена (с)";
                case "maxApPct": return "макс. ОД";
                case "movementNoisePct": return "шум";
                case "hearingRangePct": return "слух";
                case "knockbackResistance": return "устойчивость";
                case "stimDurationPct": return "стимуляторы";
                case "detectorTraceDurationPct": return "след детектора";
                case "lowHealthHeal": return "лечение при низком HP";
                case "radiationOnTrigger": return "радиация при срабатывании";
                default: return key;
            }
        }

        /// <summary>Пункты showEquippedItemContextMenu web (03d:265) для слота экипировки.</summary>
        private List<RoaItemPopups.Option> BuildSlotContextOptions(string slot)
        {
            var options = new List<RoaItemPopups.Option>();
            string runtimeId;
            if (Inventory == null || !Inventory.EquipmentSlots.TryGetValue(slot, out runtimeId) || string.IsNullOrEmpty(runtimeId)) return options;
            string baseId = RoaArmorData.BaseId(runtimeId);
            bool hand = slot == "weapon" || slot == "offhand";
            options.Add(new RoaItemPopups.Option(hand ? "Снять из руки" : "Снять", () => Submit(Inventory.SubmitEquipmentAction(slot, string.Empty, OnActionAck), "Снимаю…")));
            if (slot == "weapon" && Inventory.IsFirearmItem(baseId))
                options.Add(new RoaItemPopups.Option("Разрядить", () => { Inventory.ItemAction("unload", runtimeId); Submit(true, "Разряжаю…"); }));
            if (RoaWeaponModificationData.IsFirearm(baseId))
                options.Add(new RoaItemPopups.Option("Модификация", () => { if (Inventory.OpenWorkbench(runtimeId)) Close(); }));
            if (Inventory.IsRepairable(baseId))
            {
                bool intact = Inventory.ConditionPercent(runtimeId) >= 99.995f;
                options.Add(new RoaItemPopups.Option(intact ? "Починить (целый)" : "Починить", () => { Inventory.ItemAction("repair", runtimeId); Submit(true, "Ремонтирую…"); }, intact));
            }
            if (Quickbar != null && Inventory.IsQuickAssignable(baseId))
                for (int i = 0; i < Mathf.Min(4, Quickbar.Slots.Count); i++) { int idx = i; options.Add(new RoaItemPopups.Option("В быстрый доступ " + (i + 1), () => { Quickbar.Assign(idx, baseId); _refreshAt = 0f; })); }
            return options;
        }

        /// <summary>Пункты showItemContextMenu web (03d:229) в том же порядке.</summary>
        private List<RoaItemPopups.Option> BuildItemContextOptions(ItemTile tile)
        {
            string baseId = tile.BaseId;
            var options = BuildArtifactContextOptions(baseId);
            if (Inventory == null) return options;
            RoaItemInfo.Row info = RoaItemInfo.Get(baseId);
            // Меню относится к плитке: у запасной вещи из сумки нет «Снять», даже
            // если точно такая же сейчас надета.
            string equippedSlot = tile.Equipped ? tile.Slot : null;
            string equippedRuntime = tile.Equipped ? tile.RuntimeId : null;
            string runtimeId = tile.RuntimeId;
            string equipSlot = RoaInventory.SlotFor(baseId);

            if (equippedSlot != null)
            {
                string slotCaptured = equippedSlot;
                bool hand = slotCaptured == "weapon" || slotCaptured == "offhand";
                options.Add(new RoaItemPopups.Option(hand ? "Снять из " + (slotCaptured == "weapon" ? "правой руки" : "левой руки") : "Снять",
                    () => SubmitUnequip(slotCaptured)));
            }
            else if (equipSlot == "weapon")
            {
                if (info != null && info.Hands == 2)
                    options.Add(new RoaItemPopups.Option("В обе руки", () => SubmitEquip("weapon", runtimeId)));
                else
                {
                    options.Add(new RoaItemPopups.Option("В правую руку", () => SubmitEquip("weapon", runtimeId)));
                    options.Add(new RoaItemPopups.Option("В левую руку", () => SubmitEquip("offhand", runtimeId)));
                }
            }
            else if (equipSlot != null)
                options.Add(new RoaItemPopups.Option("Надеть", () => SubmitEquip(equipSlot, runtimeId)));

            if (info != null && info.Usable && Inventory.IsQuickAssignable(baseId))
                options.Add(new RoaItemPopups.Option("Использовать", () => Submit(Inventory.ActivateQuickItem(baseId, Combat), "Использую…")));
            if (equippedSlot == "weapon" && Inventory.IsFirearmItem(baseId))
            {
                string rt = equippedRuntime;
                options.Add(new RoaItemPopups.Option("Разрядить", () => { Inventory.ItemAction("unload", rt); Submit(true, "Разряжаю…"); }));
            }
            if (RoaWeaponModificationData.IsFirearm(baseId))
                options.Add(new RoaItemPopups.Option("Модификация", OnModifyClicked));
            if (Inventory.IsRepairable(baseId))
            {
                // Плитка — уже конкретный экземпляр, выбирать его из списка незачем.
                bool intact = (tile.Equipped ? Inventory.ConditionPercent(runtimeId) : Inventory.BagConditionPercent(runtimeId)) >= 99.995f;
                options.Add(new RoaItemPopups.Option(intact ? "Починить (целый)" : "Починить", () => { Inventory.ItemAction("repair", runtimeId); Submit(true, "Ремонтирую…"); }, intact));
            }
            if (Inventory.IsSalvageable(baseId) && !tile.Equipped)
                options.Add(new RoaItemPopups.Option("Разобрать", () => { Inventory.ItemAction("salvage", runtimeId); Submit(true, "Разбираю…"); }));
            if (Quickbar != null && Inventory.IsQuickAssignable(baseId))
            {
                for (int i = 0; i < Mathf.Min(4, Quickbar.Slots.Count); i++)
                {
                    int slotIndex = i;
                    options.Add(new RoaItemPopups.Option("В быстрый доступ " + (i + 1), () => { Quickbar.Assign(slotIndex, baseId); _refreshAt = 0f; }));
                }
            }
            bool cantDrop = equippedSlot != null || baseId == "fists";
            options.Add(new RoaItemPopups.Option(equippedSlot != null ? "Выбросить на землю (сначала снять)" : "Выбросить на землю",
                () => Submit(Inventory.SubmitDropItem(runtimeId, 1, OnActionAck), "Бросаю…"), cantDrop));
            return options;
        }

        private List<RoaItemPopups.Option> BuildArtifactContextOptions(string baseId)
        {
            return BuildArtifactContextPage(baseId, 0);
        }

        private List<RoaItemPopups.Option> BuildArtifactContextPage(string baseId, int page)
        {
            var options = new List<RoaItemPopups.Option>();
            if (Inventory == null) return options;
            var records = Inventory.ArtifactsFor(baseId);
            const int pageSize = 4;
            int start = Mathf.Max(0, page) * pageSize;
            for (int i = start; i < Mathf.Min(start + pageSize, records.Count); i++)
            {
                JObject record = records[i];
                string id = record["id"]?.ToString();
                string suffix = records.Count > 1 ? " · №" + (i + 1) : string.Empty;
                int tier = record["tier"]?.Value<int>() ?? 0;
                if (tier > 0)
                    suffix += " · <color=#" + ColorUtility.ToHtmlStringRGB(RoaGearData.TierTint(tier)) + ">"
                        + (record["tierShort"]?.ToString() ?? RoaGearData.TierShortLabel(tier)) + "</color>";
                bool stable = record["stabilized"]?.ToObject<bool>() == true && record["hot"]?.ToObject<bool>() != true;
                string action = !stable ? "stabilize" : Inventory.ArtifactEquipped(id) ? "unequip" : "equip";
                string label = !stable
                    ? "Стабилизировать (" + ArtifactCostLabel(record["stabilizationCost"] as JObject) + ")"
                    : action == "unequip" ? "Снять с пояса" : "Установить на пояс";
                options.Add(new RoaItemPopups.Option(label + suffix,
                    () => Submit(Inventory.SubmitArtifactAction(action, id, OnActionAck), "Артефакт…")));
                if (stable)
                {
                    // Предпросмотр дельты характеристик без изменения контейнера.
                    options.Add(new RoaItemPopups.Option("Предпросмотр" + suffix, () =>
                        Submit(Inventory.SubmitArtifactAction("preview", id, ack =>
                        {
                            OnActionAck(ack);
                            if (ack?["ok"]?.Value<bool>() == true)
                                RoaItemPopups.Instance?.ShowItem(baseId, ArtifactPreviewLabel(ack));
                        }), "Считаю…")));
                }
                if (!Inventory.ArtifactEquipped(id))
                {
                    string yields = ArtifactYieldLabel(record["salvageYields"] as JArray);
                    options.Add(new RoaItemPopups.Option("Разобрать" + (string.IsNullOrEmpty(yields) ? string.Empty : " → " + yields) + suffix,
                        () => Submit(Inventory.SubmitArtifactAction("salvage", id, OnActionAck), "Разбираю…")));
                }
            }
            if (start > 0) options.Add(new RoaItemPopups.Option("Предыдущие экземпляры",
                () => RoaItemPopups.Instance?.ShowMenu(BuildArtifactContextPage(baseId, page - 1))));
            if (start + pageSize < records.Count) options.Add(new RoaItemPopups.Option("Следующие экземпляры",
                () => RoaItemPopups.Instance?.ShowMenu(BuildArtifactContextPage(baseId, page + 1))));
            if (records.Count > 0 && !string.IsNullOrEmpty(records[0]["implementationNote"]?.ToString()))
                options.Add(new RoaItemPopups.Option("Не все свойства реализованы",
                    () => RoaItemPopups.Instance?.ShowItem(baseId, ItemExtraStat(baseId))));
            return options;
        }

        private void OnUseClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            Submit(Inventory.ActivateQuickItem(_selectedRuntimeId, Combat), "Использую…");
        }

        private void OnDropClicked()
        {
            // Надетое не выбрасывается: кнопка скрыта, но горячий путь проверяем и здесь.
            if (string.IsNullOrEmpty(_selectedItemId) || !string.IsNullOrEmpty(_selectedSlot) || Inventory == null) return;
            Submit(Inventory.SubmitDropItem(_selectedRuntimeId, 1, OnActionAck), "Бросаю…");
        }

        private void Submit(bool accepted, string message)
        {
            _itemsStatus.text = accepted ? message : "Действие не отправлено.";
            _refreshAt = Time.unscaledTime + 0.4f;
        }

        private void OnActionAck(JObject ack)
        {
            bool ok = ack != null && ack["ok"]?.ToObject<bool>() != false;
            _itemsStatus.text = ok ? string.Empty : (ack?["error"]?.ToString() ?? "Сервер отказал.");
            _refreshAt = 0f;
        }

        private void RebuildRows(List<GameObject> rows, RectTransform list, System.Action fill)
        {
            foreach (GameObject row in rows) Destroy(row);
            rows.Clear();
            fill();
        }

        private void BuildCraftPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Craft, parent);
            SectionTitle(page, "КРАФТ");
            _craftList = ListArea(page, out _);

            // Фокус премиума: переключатель, общий с окном станка участка.
            _craftFocus = TextButton("CraftFocus", page, string.Empty, 11, out _craftFocusLabel);
            var focusRect = (RectTransform)_craftFocus.transform;
            focusRect.anchorMin = focusRect.anchorMax = new Vector2(1f, 1f);
            focusRect.pivot = new Vector2(1f, 1f);
            focusRect.anchoredPosition = new Vector2(-4f, 0f);
            focusRect.sizeDelta = new Vector2(300f, 22f);
            _craftFocus.onClick.AddListener(() =>
            {
                if (!RoaCraftingPlots.Premium(Pipboy?.Self?["account"] as JObject)) return;
                RoaCraftingPlots.UseFocus = !RoaCraftingPlots.UseFocus;
                _refreshAt = 0f;
            });

            _craftStatus = Label("CraftStatus", page, 13, TextAnchor.LowerLeft, ScreenInkDim);
            _craftStatus.rectTransform.anchorMin = new Vector2(0f, 0f);
            _craftStatus.rectTransform.anchorMax = new Vector2(1f, 0f);
            _craftStatus.rectTransform.pivot = new Vector2(0.5f, 0f);
            _craftStatus.rectTransform.offsetMin = new Vector2(6f, 2f);
            _craftStatus.rectTransform.offsetMax = new Vector2(-6f, 26f);
        }

        /// <summary>
        /// Карточки рецептов — как renderCraftingWindow() в web (03d:520):
        /// имя, описание, «Нужно: … → xN», строка станка с комиссией. Карточка
        /// кликабельна, когда рецепт доступен; недоступная приглушена, но
        /// остаётся видимой с причиной.
        /// </summary>
        private RectTransform _craftPairRow;
        private int _craftPairCount;

        /// <summary>
        /// Сетка рецептов как #craft-grid web (03d:520, 13:2324): две колонки
        /// карточек .recipe-card — арт + имя, описание, «Нужно: … · результат: xN»,
        /// строка станка с комиссией. Вся карточка — кнопка; недоступная
        /// приглушена (opacity .48), но остаётся видимой с причиной.
        /// </summary>
        private void RefreshCraft()
        {
            JObject account = Pipboy?.Self?["account"] as JObject;
            if (_craftFocusLabel != null)
            {
                bool premium = RoaCraftingPlots.Premium(account);
                _craftFocus.interactable = premium;
                _craftFocusLabel.text = premium
                    ? "ФОКУС " + RoaCraftingPlots.FocusText(account) + " · " + (RoaCraftingPlots.UseFocus ? "ТРАТИТЬ ✓" : "НЕ ТРАТИТЬ")
                    : "ФОКУС — ТОЛЬКО С ПРЕМИУМОМ";
            }
            RebuildRows(_craftRows, _craftList, () =>
            {
                _craftPairRow = null;
                _craftPairCount = 0;
                foreach (RoaCraftRecipe recipe in RoaCraftingData.Recipes)
                    AddCraftCard(recipe, NextCraftCell());
            });
            LayoutRebuilder.ForceRebuildLayoutImmediate(_craftList);
        }

        private RectTransform NextCraftCell()
        {
            if (_craftPairRow == null || _craftPairCount >= 2)
            {
                var row = new GameObject("Pair", typeof(RectTransform));
                row.transform.SetParent(_craftList, false);
                row.AddComponent<LayoutElement>().preferredHeight = 118f;
                _craftPairRow = (RectTransform)row.transform;
                _craftPairCount = 0;
                _craftRows.Add(row);
            }
            RectTransform cell = Child("Cell", _craftPairRow);
            bool left = _craftPairCount == 0;
            Place_(cell, left ? 0f : 0.5f, 0f, left ? 0.5f : 1f, 1f, new Vector2(left ? 0f : 4f, 4f), new Vector2(left ? -4f : 0f, -4f));
            _craftPairCount++;
            return cell;
        }

        private void AddCraftCard(RoaCraftRecipe recipe, RectTransform cell)
        {
            bool hasResources = HasRecipeResources(recipe);
            bool hasFee = CountItem("silver") >= recipe.Fee;
            string stationObjectId;
            float stationDistance;
            bool stationNear = TryFindStation(recipe.Station, out stationObjectId, out stationDistance);
            bool pending = _pendingRecipes.Contains(recipe.Id);
            bool ready = hasResources && hasFee && stationNear && !pending;

            var card = new GameObject("Recipe:" + recipe.Id, typeof(RectTransform));
            var rect = (RectTransform)card.transform;
            rect.SetParent(cell, false);
            Stretch_(rect, 0f);
            var back = card.AddComponent<Image>();
            // .recipe-card: rgba(4,14,8,.58) на тёмном; disabled — приглушённый непрозрачный.
            back.color = ready ? new Color(0.03f, 0.07f, 0.045f, 1f) : new Color(0.025f, 0.045f, 0.03f, 1f);
            var outline = card.AddComponent<Outline>();
            outline.effectColor = ready ? new Color(0.494f, 0.784f, 0.357f, 0.34f) : new Color(0.494f, 0.784f, 0.357f, 0.16f);
            outline.effectDistance = new Vector2(1f, -1f);

            float alpha = ready ? 1f : 0.48f;
            Color titleInk = new Color(0.827f, 0.933f, 0.541f, alpha);     // #d3ee8a
            Color descInk = new Color(0.624f, 0.859f, 0.478f, 0.76f * alpha);
            Color costInk = new Color(0.89f, 0.761f, 0.412f, alpha);      // #e3c269
            Color warnInk = new Color(1f, 0.55f, 0.4f, alpha);

            // .recipe-title: арт + имя.
            RectTransform artRect = Child("Art", rect);
            artRect.anchorMin = artRect.anchorMax = new Vector2(0f, 1f);
            artRect.pivot = new Vector2(0f, 1f);
            artRect.anchoredPosition = new Vector2(8f, -7f);
            artRect.sizeDelta = new Vector2(24f, 24f);
            var art = artRect.gameObject.AddComponent<RawImage>();
            art.texture = RoaItemCategories.Art(recipe.OutputId);
            art.raycastTarget = false;
            art.enabled = art.texture != null;
            art.color = new Color(1f, 1f, 1f, alpha);
            Text title = Label("Title", rect, 12, TextAnchor.MiddleLeft, titleInk, FontStyle.Bold);
            Place_(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(38f, -32f), new Vector2(-8f, -6f));
            title.horizontalOverflow = HorizontalWrapMode.Wrap;
            title.verticalOverflow = VerticalWrapMode.Truncate;
            title.text = recipe.Name;

            // .recipe-desc
            Text desc = Label("Desc", rect, 10, TextAnchor.UpperLeft, descInk);
            Place_(desc.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -62f), new Vector2(-8f, -36f));
            desc.horizontalOverflow = HorizontalWrapMode.Wrap;
            desc.verticalOverflow = VerticalWrapMode.Truncate;
            desc.text = recipe.Description;

            // .recipe-cost: «Нужно: [арт] N … · результат: [арт] xN» — строка иконок на y = -80.
            RectTransform costRow = Child("Cost", rect);
            Place_(costRow, 0f, 1f, 1f, 1f, new Vector2(8f, -84f), new Vector2(-8f, -66f));
            float x = 0f;
            x = CostLabel_(costRow.gameObject, "Нужно:", x, costInk);
            foreach (KeyValuePair<string, int> part in recipe.Cost)
            {
                bool enough = CountItem(part.Key) >= part.Value;
                x = CostIcon_(costRow.gameObject, part.Key, x, enough && ready);
                x = CostLabel_(costRow.gameObject, part.Value + (enough ? "" : "!"), x, enough ? costInk : warnInk);
            }
            x = CostLabel_(costRow.gameObject, "· результат:", x, costInk);
            x = CostIcon_(costRow.gameObject, recipe.OutputId, x, ready);
            CostLabel_(costRow.gameObject, "x" + recipe.OutputQty, x, costInk);

            // Вторая .recipe-cost: станок и комиссия.
            Text station = Label("Station", rect, 9, TextAnchor.UpperLeft, costInk);
            Place_(station.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -110f), new Vector2(-8f, -88f));
            station.horizontalOverflow = HorizontalWrapMode.Wrap;
            station.verticalOverflow = VerticalWrapMode.Truncate;
            JObject account = Pipboy?.Self?["account"] as JObject;
            string focusNote = RoaCraftingPlots.WantsFocus(recipe, account)
                ? " · фокус " + RoaCraftingPlots.FocusCostFor(recipe, account)
                : string.Empty;
            station.text = pending ? "Сервер создаёт предмет…" : (stationNear
                ? RoaCraftingData.StationLabel(recipe.Station) + " рядом · комиссия " + recipe.Fee
                    + (recipe.WorkSeconds > 0 ? " · " + recipe.WorkSeconds + " с" : string.Empty) + focusNote
                : "нужен станок: " + RoaCraftingData.StationLabel(recipe.Station) + " · комиссия " + recipe.Fee
                    + (recipe.WorkSeconds > 0 ? " · " + recipe.WorkSeconds + " с" : string.Empty) + focusNote);

            var button = card.AddComponent<Button>();
            button.targetGraphic = back;
            button.interactable = ready;
            string objectId = stationObjectId;
            button.onClick.AddListener(() => SubmitCraft(recipe, objectId));
        }

        private static void Stretch_(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
        }

        private static float CostLabel_(GameObject row, string text, float x, Color color)
        {
            Text label = Label("CostText", (RectTransform)row.transform, 11, TextAnchor.MiddleLeft, color);
            label.horizontalOverflow = HorizontalWrapMode.Overflow;
            label.rectTransform.anchorMin = new Vector2(0f, 0f);
            label.rectTransform.anchorMax = new Vector2(0f, 0f);
            label.rectTransform.pivot = new Vector2(0f, 0f);
            label.rectTransform.anchoredPosition = new Vector2(x, 16f);
            label.rectTransform.sizeDelta = new Vector2(200f, 18f);
            label.text = text;
            return x + label.preferredWidth + 5f;
        }

        private static float CostIcon_(GameObject row, string itemId, float x, bool enough)
        {
            RectTransform rect = Child("CostIcon", (RectTransform)row.transform);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 0f);
            rect.pivot = new Vector2(0f, 0f);
            rect.anchoredPosition = new Vector2(x, 16f);
            rect.sizeDelta = new Vector2(18f, 18f);
            var image = rect.gameObject.AddComponent<RawImage>();
            image.texture = RoaItemCategories.Art(itemId);
            image.raycastTarget = false;
            image.color = enough ? Color.white : new Color(1f, 0.7f, 0.6f, 0.8f);
            return x + 21f;
        }

        private string CostText(RoaCraftRecipe recipe)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, int> row in recipe.Cost)
            {
                bool enough = CountItem(row.Key) >= row.Value;
                parts.Add(RoaItemData.Name(row.Key) + " " + row.Value + (enough ? "" : "!"));
            }
            return string.Join(" · ", parts);
        }

        private bool HasRecipeResources(RoaCraftRecipe recipe)
        {
            foreach (KeyValuePair<string, int> row in recipe.Cost)
                if (CountItem(row.Key) < row.Value) return false;
            return true;
        }

        private int CountItem(string baseId)
        {
            if (Inventory == null) return 0;
            foreach (RoaInventory.Row row in Inventory.Items)
                if (row.Id == baseId) return row.Qty;
            return 0;
        }

        /// <summary>
        /// Ближайший станок нужного типа — nearbyCraftingStation() web (03d:389):
        /// объекты локации с моделью станка в радиусе 4.2 м. Сервер проверит
        /// то же самое своей дистанцией 4.6 м, клиентский порог строже.
        /// </summary>
        private bool TryFindStation(string station, out string objectId, out float distance)
        {
            objectId = string.Empty;
            distance = float.MaxValue;

            if (Loader == null || Player == null || Socket == null || Socket.Session == null) return false;

            RealmOfAshes.World.LocationDefinition definition = Loader.GetDefinition(Socket.Session.LocationId);
            if (definition == null || definition.Objects == null) return false;

            string modelKey = RoaCraftingData.StationModelKey(station);
            if (string.IsNullOrEmpty(modelKey)) return false;

            foreach (RealmOfAshes.World.LocationObject row in definition.Objects)
            {
                if (row == null || row.Position == null) continue;
                if ((row.Model ?? string.Empty) != modelKey) continue;

                Vector3 point = RealmOfAshes.World.RoaCoords.ToUnity(row.Position.X, 0f, row.Position.Z);
                Vector3 delta = point - Player.transform.position;
                delta.y = 0f;
                float dist = delta.magnitude;

                if (dist > 4.2f || dist >= distance) continue;
                distance = dist;
                objectId = row.Id ?? string.Empty;
            }

            return !string.IsNullOrEmpty(objectId);
        }

        /// <summary>
        /// Заказ станку. Сервер пере-проверяет рецепт, станок, дистанцию,
        /// материалы и комиссию (recordWastelandCraftingStationFee,
        /// server.js:11444) и возвращает авторитетный self с новым инвентарём.
        /// </summary>
        private void SubmitCraft(RoaCraftRecipe recipe, string stationObjectId)
        {
            if (Socket == null || _pendingRecipes.Contains(recipe.Id)) return;

            _pendingRecipes.Add(recipe.Id);
            _craftStatus.text = "Станок принимает заказ…";
            _refreshAt = 0f;

            Socket.EmitWithAck("craftingStationUsed", new Dictionary<string, object>
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["recipeId"] = recipe.Id,
                ["station"] = recipe.Station,
                ["fee"] = recipe.Fee,
                ["locationId"] = Socket.Session != null ? Socket.Session.LocationId : string.Empty,
                ["stationObjectId"] = stationObjectId,
                ["useFocus"] = RoaCraftingPlots.WantsFocus(recipe, Pipboy?.Self?["account"] as JObject)
            }, ack =>
            {
                _pendingRecipes.Remove(recipe.Id);
                _refreshAt = 0f;

                if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                {
                    _craftStatus.text = ack?["error"]?.ToString() ?? "Станок отклонил заказ.";
                    return;
                }

                Socket.ApplyGameplayAck(ack);

                JObject output = ack["output"] as JObject;
                string outId = output?["id"]?.ToString() ?? recipe.OutputId;
                int outQty = output?["qty"]?.ToObject<int>() ?? recipe.OutputQty;
                int focusSpent = ack["focusSpent"]?.ToObject<int>() ?? 0;
                _craftStatus.text = "Создано: " + ItemName(outId) + " ×" + outQty
                    + (focusSpent > 0 ? " · фокус −" + focusSpent : string.Empty) + ".";
            });
        }

        // ------------------------------------------------------------------
        // QUESTS — авторский сюжетный журнал
        // ------------------------------------------------------------------

        private void BuildQuestsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Quests, parent);
            SectionTitle(page, "СЮЖЕТНЫЙ ЖУРНАЛ");
            _questsList = ListArea(page, out _);
        }

        private void RefreshQuests()
        {
            RebuildRows(_questRows, _questsList, () =>
            {
                AddKromkaJournalCards();
                if (Interaction == null)
                {
                    AddTextCard(_questRows, _questsList, "Заданий нет", "Нет связи с миром.");
                    return;
                }
                AddSectionTitle(_questRows, _questsList, "Активные");
                List<RoaInteraction.StoryQuestCard> active = Interaction.JournalQuests(false);
                if (active.Count == 0)
                    AddTextCard(_questRows, _questsList, "Нет активных сюжетных заданий.",
                        "Новые сюжетные задания можно получить у именных персонажей.");
                foreach (RoaInteraction.StoryQuestCard card in active) AddStoryQuestCard(card);

                AddSectionTitle(_questRows, _questsList, "Выполненные");
                List<RoaInteraction.StoryQuestCard> done = Interaction.JournalQuests(true);
                if (done.Count == 0)
                    AddTextCard(_questRows, _questsList, "Завершённых сюжетных заданий пока нет.", string.Empty);
                foreach (RoaInteraction.StoryQuestCard card in done) AddStoryQuestCard(card);
            });
        }

        private void AddStoryQuestCard(RoaInteraction.StoryQuestCard card)
        {
            var body = new System.Text.StringBuilder();
            if (!string.IsNullOrEmpty(card.Giver)) body.Append("Поручитель: ").Append(card.Giver).Append('.');
            if (!string.IsNullOrEmpty(card.Description))
            {
                if (body.Length > 0) body.Append('\n');
                body.Append(card.Description);
            }
            if (!string.IsNullOrEmpty(card.Objective)) body.Append('\n').Append(card.Objective);
            if (!string.IsNullOrEmpty(card.Reward)) body.Append('\n').Append(card.Reward);
            if (!string.IsNullOrEmpty(card.Hint)) body.Append('\n').Append(card.Hint);
            AddTextCard(_questRows, _questsList,
                card.StateLabel.ToUpperInvariant() + "  " + card.Name, body.ToString());
        }

        // ------------------------------------------------------------------
        // CONTRACTS — отдельная витрина повторяемых работ пустоши
        // ------------------------------------------------------------------

        private void BuildContractsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Contracts, parent);
            SectionTitle(page, "КОНТРАКТЫ");
            _contractsList = ListArea(page, out _);
        }

        private void RefreshContracts()
        {
            RebuildRows(_contractRows, _contractsList, () =>
            {
                if (Interaction == null)
                {
                    AddTextCard(_contractRows, _contractsList, "Контрактов нет", "Нет связи с миром.");
                    return;
                }
                Interaction.EnsureWorldState();
                AddSectionTitle(_contractRows, _contractsList, "Доступные и принятые");
                List<RoaInteraction.WorldTaskCard> active = Interaction.PipboyWorldTasks(true);
                if (active.Count == 0)
                    AddTextCard(_contractRows, _contractsList, "Активных контрактов нет.",
                        "Проверьте доску контрактов у поселения или точки мира.");
                foreach (RoaInteraction.WorldTaskCard card in active) AddContractCard(card);

                AddSectionTitle(_contractRows, _contractsList, "Завершённые");
                List<RoaInteraction.WorldTaskCard> done = Interaction.PipboyWorldTasks(false);
                if (done.Count == 0)
                    AddTextCard(_contractRows, _contractsList, "Завершённых контрактов пока нет.", string.Empty);
                foreach (RoaInteraction.WorldTaskCard card in done) AddContractCard(card);
            });
        }

        private void AddContractCard(RoaInteraction.WorldTaskCard card)
        {
            var body = new System.Text.StringBuilder();
            if (!string.IsNullOrEmpty(card.Text)) body.Append(RoaPipboy.KromkaPublicText(card.Text));
            if (!string.IsNullOrEmpty(card.Route)) body.Append('\n').Append(RoaPipboy.KromkaPublicText(card.Route));
            if (!string.IsNullOrEmpty(card.Reward)) body.Append('\n').Append(RoaPipboy.KromkaPublicText(card.Reward));
            if (!string.IsNullOrEmpty(card.JoinHint)) body.Append('\n').Append(RoaPipboy.KromkaPublicText(card.JoinHint));
            if (!string.IsNullOrEmpty(card.AcceptHint)) body.Append('\n').Append(RoaPipboy.KromkaPublicText(card.AcceptHint));

            var actions = new List<(string, System.Action)>();
            string id = card.Id;
            if (card.AcceptLabel != null)
                actions.Add((card.AcceptLabel, card.CanAccept ? (System.Action)(() => Interaction.PipboyWorldTaskAction(id, "accept")) : null));
            if (card.TrackLabel != null) actions.Add((card.TrackLabel, () => Interaction.PipboyWorldTaskAction(id, "track")));
            if (card.CanCancel) actions.Add(("Отменить", () => Interaction.PipboyWorldTaskAction(id, "cancel")));
            if (card.CanClaim) actions.Add(("Забрать награду", () => Interaction.PipboyWorldTaskAction(id, "claim")));

            AddTextCard(_contractRows, _contractsList,
                card.Label.ToUpperInvariant() + "  " + RoaPipboy.KromkaPublicText(card.Title), body.ToString(), actions);
        }

        // ------------------------------------------------------------------
        // WORLD — pipboy-world-grid (03a:682): сводка, поселения, точки, группы, события
        // ------------------------------------------------------------------

        private void BuildWorldPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.World, parent);
            SectionTitle(page, "МИР");
            _worldHeader = Label("Header", page, 13, TextAnchor.MiddleLeft, ScreenInk, FontStyle.Bold);
            _worldHeader.rectTransform.anchorMin = new Vector2(0f, 1f);
            _worldHeader.rectTransform.anchorMax = new Vector2(0.8f, 1f);
            _worldHeader.rectTransform.pivot = new Vector2(0.5f, 1f);
            _worldHeader.rectTransform.offsetMin = new Vector2(4f, -56f);
            _worldHeader.rectTransform.offsetMax = new Vector2(0f, -30f);

            Button refresh = TextButton("Refresh", page, "Обновить", 12, out Text refreshText);
            var rect = (RectTransform)refresh.transform;
            rect.anchorMin = new Vector2(0.82f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(0.5f, 1f);
            rect.offsetMin = new Vector2(0f, -54f);
            rect.offsetMax = new Vector2(-4f, -32f);
            refreshText.color = AccentWarm;
            refresh.onClick.AddListener(() => { Pipboy.EnsureWorldData(true); _refreshAt = Time.unscaledTime + 0.5f; });

            _worldList = ListArea(page, out _);
            _worldList.parent.GetComponent<RectTransform>().offsetMax = new Vector2(-4f, -60f);
        }

        // --- Плитки-дашборд и карточки web (pipboy-world-dashboard / pipboy-world-card / pipboy-faction-card) ---

        private static readonly Color TileBg = new Color(0.035f, 0.09f, 0.05f, 1f); // непрозрачный: Outline просвечивает сквозь альфу
        private static readonly Color TileBorder = new Color(0.424f, 0.722f, 0.322f, 0.28f);
        private static readonly Color TileValue = new Color(1f, 0.89f, 0.459f, 1f);       // #ffe375
        private static readonly Color TileLabel = new Color(0.604f, 0.82f, 0.478f, 0.82f);
        private static readonly Color CardName = new Color(0.953f, 0.851f, 0.471f, 1f);   // #f3d978
        private static readonly Color CardSmall = new Color(0.706f, 0.886f, 0.545f, 0.82f);
        private static readonly Color BorderStable = new Color(0.502f, 0.816f, 0.357f, 0.36f);
        private static readonly Color BorderWarning = new Color(0.878f, 0.706f, 0.333f, 0.62f);
        private static readonly Color BorderDanger = new Color(0.878f, 0.439f, 0.333f, 0.62f);
        private static readonly Color BorderSafe = new Color(0.5f, 0.85f, 0.95f, 0.5f);

        /// <summary>Ряд плиток «подпись / значение» (58px), как .pipboy-world-dashboard.</summary>
        private void AddDashboard(List<GameObject> rows, RectTransform list, params (string label, string value)[] tiles)
        {
            var row = new GameObject("Dashboard", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 66f;
            var rect = (RectTransform)row.transform;
            int count = Mathf.Max(1, tiles.Length);
            for (int i = 0; i < tiles.Length; i++)
            {
                RectTransform tile = Panel_(rect, TileBg, TileBorder);
                float minX = i / (float)count, maxX = (i + 1) / (float)count;
                Place_(tile, minX, 0f, maxX, 1f, new Vector2(i == 0 ? 0f : 4f, 4f), new Vector2(i == tiles.Length - 1 ? 0f : -4f, -4f));
                Text label = Label("Label", tile, 10, TextAnchor.UpperLeft, TileLabel);
                label.text = tiles[i].label.ToUpperInvariant();
                Place_(label.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -22f), new Vector2(-10f, -8f));
                Text value = Label("Value", tile, 18, TextAnchor.LowerLeft, TileValue, FontStyle.Bold);
                value.text = tiles[i].value;
                value.horizontalOverflow = HorizontalWrapMode.Overflow;
                value.verticalOverflow = VerticalWrapMode.Overflow;
                Place_(value.rectTransform, 0f, 0f, 1f, 0f, new Vector2(10f, 7f), new Vector2(-10f, 31f));
            }
            rows.Add(row);
        }

        private static Color ToneBorder(string tone)
        {
            switch (tone)
            {
                case "danger": return BorderDanger;
                case "warning": return BorderWarning;
                case "safe": return BorderSafe;
                default: return BorderStable;
            }
        }

        /// <summary>.pipboy-world-card: подпись типа, имя, строка small, строка em; рамка по состоянию.</summary>
        private void AddWorldCard(List<GameObject> rows, RectTransform list, string kicker, string name,
                                  string small, string em, string tone)
        {
            int emLines = string.IsNullOrEmpty(em) ? 0 : Mathf.Max(
                em.Split('\n').Length,
                Mathf.CeilToInt(em.Length / 80f));
            float height = 10f + 14f + 20f + (string.IsNullOrEmpty(small) ? 0f : 17f) + emLines * 16f + 10f;
            var row = new GameObject("WorldCard", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = height;
            var rect = (RectTransform)row.transform;
            var back = row.AddComponent<Image>();
            back.color = TileBg;
            back.raycastTarget = false;
            var outline = row.AddComponent<Outline>();
            outline.effectColor = ToneBorder(tone);
            outline.effectDistance = new Vector2(1f, -1f);

            float y = 9f;
            Text kick = Label("Kicker", rect, 10, TextAnchor.UpperLeft, TileLabel);
            kick.text = kicker.ToUpperInvariant();
            Place_(kick.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 13f), new Vector2(-10f, -y));
            y += 13f;
            Text title = Label("Name", rect, 15, TextAnchor.UpperLeft, CardName, FontStyle.Bold);
            title.text = name;
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 20f), new Vector2(-10f, -y));
            y += 21f;
            if (!string.IsNullOrEmpty(small))
            {
                Text sm = Label("Small", rect, 12, TextAnchor.UpperLeft, CardSmall);
                sm.text = small;
                Place_(sm.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 16f), new Vector2(-10f, -y));
                y += 17f;
            }
            if (!string.IsNullOrEmpty(em))
            {
                Text e = Label("Em", rect, 12, TextAnchor.UpperLeft, CardSmall, FontStyle.Italic);
                e.text = em;
                Place_(e.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - emLines * 16f), new Vector2(-10f, -y));
            }
            rows.Add(row);
        }

        /// <summary>Карточка стороны: цвет, репутация, открытая цена обещаний и состояние временного контракта.</summary>
        private void AddFactionCard(List<GameObject> rows, RectTransform list, string kicker, string name, string relation,
                                    string description, Color factionColor, int sites, int parties, int contested,
                                    string actionLabel, System.Action onAction)
        {
            float height = onAction != null || actionLabel != null ? 148f : 122f;
            var row = new GameObject("FactionCard", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = height;
            var rect = (RectTransform)row.transform;
            var back = row.AddComponent<Image>();
            back.color = new Color(0.035f, 0.08f, 0.047f, 1f);
            back.raycastTarget = false;
            var outline = row.AddComponent<Outline>();
            outline.effectColor = new Color(factionColor.r, factionColor.g, factionColor.b, 0.6f);
            outline.effectDistance = new Vector2(1f, -1f);

            RectTransform mark = Child("Mark", rect);
            Place_(mark, 0f, 0f, 0f, 1f, new Vector2(9f, 9f), new Vector2(19f, -9f));
            var markImage = mark.gameObject.AddComponent<Image>();
            markImage.color = factionColor;
            markImage.raycastTarget = false;

            Text kick = Label("Kicker", rect, 10, TextAnchor.UpperLeft, new Color(ScreenInk.r, ScreenInk.g, ScreenInk.b, 0.72f), FontStyle.Bold);
            kick.text = kicker.ToUpperInvariant();
            Place_(kick.rectTransform, 0f, 1f, 0.68f, 1f, new Vector2(29f, -22f), new Vector2(0f, -9f));
            Text title = Label("Name", rect, 15, TextAnchor.UpperLeft, SlotName, FontStyle.Bold);
            title.text = name.ToUpperInvariant();
            title.verticalOverflow = VerticalWrapMode.Overflow;
            Place_(title.rectTransform, 0f, 1f, 0.68f, 1f, new Vector2(29f, -43f), new Vector2(0f, -22f));
            Text rel = Label("Relation", rect, 12, TextAnchor.UpperLeft, SpecialValue, FontStyle.Bold);
            rel.text = relation.ToUpperInvariant();
            Place_(rel.rectTransform, 0f, 1f, 0.68f, 1f, new Vector2(29f, -58f), new Vector2(0f, -43f));

            Text details = Label("Details", rect, 11, TextAnchor.UpperLeft, CardSmall);
            details.text = description ?? string.Empty;
            details.horizontalOverflow = HorizontalWrapMode.Wrap;
            details.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(details.rectTransform, 0f, 0f, 0.68f, 1f, new Vector2(29f, 10f), new Vector2(-7f, -62f));

            string[] labels = { "Точки", "Отряды", "Спорно" };
            int[] values = { sites, parties, contested };
            for (int i = 0; i < 3; i++)
            {
                RectTransform cell = Panel_(rect, new Color(0.025f, 0.06f, 0.035f, 1f), new Color(0.494f, 0.784f, 0.357f, 0.22f));
                float minX = 0.69f + i * 0.1033f, maxX = minX + 0.097f;
                Place_(cell, minX, 1f, maxX, 1f, new Vector2(0f, -67f), new Vector2(0f, -9f));
                Text l = Label("Label", cell, 9, TextAnchor.UpperLeft, TileLabel);
                l.text = labels[i].ToUpperInvariant();
                Place_(l.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -18f), new Vector2(-4f, -5f));
                Text v = Label("Value", cell, 16, TextAnchor.LowerLeft, TileValue, FontStyle.Bold);
                v.text = values[i].ToString();
                Place_(v.rectTransform, 0f, 0f, 1f, 0f, new Vector2(6f, 4f), new Vector2(-4f, 26f));
            }

            if (actionLabel != null)
            {
                Button button = TextButton("Join", rect, actionLabel, 11, out Text label);
                var brect = (RectTransform)button.transform;
                brect.anchorMin = new Vector2(0f, 0f);
                brect.anchorMax = new Vector2(0f, 0f);
                brect.pivot = new Vector2(0f, 0f);
                brect.anchoredPosition = new Vector2(29f, 8f);
                brect.sizeDelta = new Vector2(150f, 22f);
                button.GetComponent<Image>().color = new Color(0.16f, 0.28f, 0.12f, 0.95f);
                label.color = AccentWarm;
                button.interactable = onAction != null;
                if (onAction != null) button.onClick.AddListener(() => { onAction(); _refreshAt = Time.unscaledTime + 0.3f; });
            }
            rows.Add(row);
        }

        private static Color FactionTint(string id)
        {
            switch (RoaPipboy.CanonicalFactionId(id))
            {
                case "uprava": return new Color(0.094f, 0.196f, 0.29f);       // #18324a
                case "free_artels": return new Color(0.69f, 0.416f, 0.173f); // #b06a2c
                case "contour": return new Color(0.333f, 0.4f, 0.365f);      // #55665d
                case "tract_league": return new Color(0.718f, 0.612f, 0.439f); // #b79c70
                case "seconds": return new Color(0.867f, 0.847f, 0.784f);    // #ddd8c8
                case "continuity": return new Color(0.431f, 0.141f, 0.141f); // #6e2424
                case "raiders": return new Color(1f, 0.482f, 0.325f);       // #ff7b53
                case "mutants": return new Color(0.78f, 0.42f, 0.85f);
                case "wild": return new Color(0.75f, 0.62f, 0.45f);
                default: return new Color(0.62f, 0.72f, 0.58f);
            }
        }

        private void RefreshWorld()
        {
            Pipboy.EnsureWorldData();
            JObject world = Pipboy.Wasteland;

            if (world == null)
            {
                _worldHeader.text = Pipboy.WorldRequestPending
                    ? "Получаем авторитетную сводку сервера…"
                    : (string.IsNullOrEmpty(Pipboy.WorldError) ? "Данных мира пока нет." : Pipboy.WorldError);
                RebuildRows(_worldRows, _worldList, () => { });
                return;
            }

            JArray sites = world["sites"] as JArray ?? new JArray();
            JArray parties = world["parties"] as JArray ?? new JArray();
            JArray events = world["events"] as JArray ?? new JArray();
            int activeParties = 0;
            foreach (JToken row in parties)
                if (!IsTrue(row?["destroyed"]) && row?["state"]?.ToString() != "destroyed") activeParties++;

            float worldHour = world["worldHour"]?.ToObject<float>() ?? 0f;
            JObject anomalyCycle = world["anomalyCycle"] as JObject;
            _worldHeader.text = string.Empty;

            RebuildRows(_worldRows, _worldList, () =>
            {
                string anomalyPhase = anomalyCycle?["phase"]?.ToString() ?? "calm";
                if (!string.Equals(anomalyPhase, "calm", System.StringComparison.OrdinalIgnoreCase))
                {
                    AddTextCard(_worldRows, _worldList,
                        "ВЫБРОС · СИЛА " + (anomalyCycle?["strength"]?.ToObject<int>() ?? 1),
                        (anomalyCycle?["reason"]?.ToString() ?? "Аномальная волна проходит через регион")
                        + "\nПрогноз: " + (anomalyCycle?["forecast"]?.ToString() ?? "нет данных")
                        + "\nДействие: " + ((anomalyCycle?["actions"] as JArray)?[0]?.ToString() ?? "следить за сводкой"));
                }
                AddDashboard(_worldRows, _worldList,
                    ("Час мира", Mathf.FloorToInt(worldHour).ToString()),
                    ("Точки", sites.Count.ToString()),
                    ("Группы", activeParties.ToString()),
                    ("Караваны", (world["stats"]?["caravansArrived"]?.ToObject<int>() ?? 0) + "/" + (world["stats"]?["caravansLost"]?.ToObject<int>() ?? 0)));
                AddHeading(_worldRows, _worldList, "ПОСЕЛЕНИЯ");
                AddSites(sites, true, 6, worldHour);
                AddHeading(_worldRows, _worldList, "РЕСУРСЫ И АВАНПОСТЫ");
                AddSites(sites, false, 10, worldHour);

                AddHeading(_worldRows, _worldList, "ГРУППЫ НА КАРТЕ");
                int shown = 0;
                foreach (JToken token in parties)
                {
                    if (shown >= 8) break;
                    JObject party = token as JObject;
                    if (party == null || IsTrue(party["destroyed"])
                        || party["state"]?.ToString() == "destroyed") continue;
                    string destination = party["destinationSiteId"]?.ToString();
                    AddTextCard(_worldRows, _worldList,
                        RoaPipboy.PartyKindLabel(party["kind"]?.ToString()) + ": "
                        + RoaPipboy.KromkaPublicText(party["name"]?.ToString() ?? party["id"]?.ToString() ?? "Группа"),
                        RoaPipboy.FactionLabel(party["faction"]?.ToString())
                        + " · бойцов " + (party["members"]?.ToObject<int>() ?? 0)
                        + " · сила " + (party["strength"]?.ToObject<int>() ?? 0) + "\n"
                        + (string.IsNullOrEmpty(destination)
                            ? RoaPipboy.PartyStateLabel(party["state"]?.ToString())
                            : "Путь к: " + RoaPipboy.WorldSiteName(sites, destination)));
                    shown++;
                }
                if (shown == 0) AddTextCard(_worldRows, _worldList, "Активных групп нет", string.Empty);

                AddHeading(_worldRows, _worldList, "ПОСЛЕДНИЕ СОБЫТИЯ");
                shown = 0;
                foreach (JToken token in events)
                {
                    if (shown++ >= 8) break;
                    AddTextCard(_worldRows, _worldList,
                        RoaPipboy.EventTypeLabel(token?["type"]?.ToString()),
                        RoaPipboy.KromkaPublicText(token?["title"]?.ToString() ?? token?["text"]?.ToString() ?? "Событие мира"));
                }
                if (shown == 0) AddTextCard(_worldRows, _worldList, "Событий пока нет", string.Empty);
            });
        }

        private void AddSites(JArray sites, bool settlements, int limit, float worldHour)
        {
            int shown = 0;
            foreach (JToken token in sites)
            {
                if (shown >= limit) break;
                JObject site = token as JObject;
                if (site == null) continue;
                bool isSettlement = string.Equals(site["type"]?.ToString(), "settlement", System.StringComparison.OrdinalIgnoreCase);
                if (isSettlement != settlements) continue;

                string detail;
                if (isSettlement && site["settlementLife"] is JObject life)
                {
                    JObject reserve = life["reserveDays"] as JObject;
                    string reserves = reserve == null
                        ? "нет данных"
                        : "вода " + (reserve["water"]?.ToObject<float>() ?? 0f).ToString("0.#")
                          + " дн. · пища " + (reserve["food"]?.ToObject<float>() ?? 0f).ToString("0.#")
                          + " дн. · медицина " + (reserve["medicine"]?.ToObject<float>() ?? 0f).ToString("0.#") + " дн.";
                    JArray actions = life["actions"] as JArray;
                    string help = actions != null && actions.Count > 0 ? actions[0]?.ToString() : "сейчас не требуется";
                    detail = "Состояние: " + (life["stateLabel"]?.ToString() ?? "нет данных")
                        + "\nПричина: " + (life["reason"]?.ToString() ?? "нет данных")
                        + "\nПрогноз: " + (life["forecast"]?.ToString() ?? "нет данных")
                        + "\nПомощь: " + help
                        + "\nРезерв: " + reserves;
                    JArray consequences = life["consequences"] as JArray;
                    if (consequences != null)
                    {
                        int recent = Mathf.Min(3, consequences.Count);
                        for (int i = 0; i < recent; i++)
                        {
                            string text = consequences[i]?["text"]?.ToString();
                            if (!string.IsNullOrEmpty(text)) detail += "\nПоследствие: " + text;
                        }
                    }
                    if (site["sceneVariant"] is JObject scene
                        && (scene["actorBudget"]?.ToObject<int>() ?? 0) > 0)
                        detail += "\nНа месте: " + (scene["label"]?.ToString() ?? "видимые последствия");
                }
                else
                {
                    detail = "Контроль " + (site["controlPressure"]?.ToObject<float>() ?? 0f).ToString("0.0")
                        + " · Запасы: " + RoaPipboy.StockText(site["stockpile"] as JObject);
                }

                if (site["artifactOpportunity"] is JObject artifactOpportunity)
                {
                    detail += "\nАртефактная возможность: до "
                        + (artifactOpportunity["artifactCount"]?.ToObject<int>() ?? 0)
                        + " · нужен детектор";
                }

                AddWorldCard(_worldRows, _worldList,
                    RoaPipboy.SiteTypeLabel(site["type"]?.ToString()),
                    RoaPipboy.WorldSiteName(sites, site["id"]?.ToString()),
                    RoaPipboy.SiteStatusLabel(site, worldHour) + " · " + RoaPipboy.FactionLabel(site["owner"]?.ToString()),
                    detail,
                    RoaPipboy.SiteStatusTone(site, worldHour));
                shown++;
            }
            if (shown == 0) AddTextCard(_worldRows, _worldList, settlements ? "Поселений нет" : "Других точек мира нет", string.Empty);
        }

        // ------------------------------------------------------------------
        // FACTIONS — pipboy-factions-grid (03a:1492)
        // ------------------------------------------------------------------

        private void BuildFactionsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Factions, parent);
            SectionTitle(page, "ФРАКЦИИ");
            _factionsList = ListArea(page, out _);
        }

        private void RefreshFactions(JObject self)
        {
            Pipboy.EnsureWorldData();

            RebuildRows(_factionRows, _factionsList, () =>
            {
                if (Pipboy.Wasteland == null)
                {
                    AddTextCard(_factionRows, _factionsList, "Фракции",
                        Pipboy.WorldRequestPending ? "Получаем авторитетную сводку сервера…" : "Данных фракций пока нет.");
                    return;
                }

                JObject contracts = self?["factionContracts"] as JObject ?? new JObject();
                JObject knownSecrets = self?["knownFactionSecrets"] as JObject ?? new JObject();
                int activeContracts = 0;
                foreach (JProperty property in contracts.Properties())
                    if (FactionContractActive(property.Value)) activeContracts++;
                int knownSecretCount = 0;
                foreach (JProperty property in knownSecrets.Properties())
                    if (property.Value != null && property.Value.Type != JTokenType.Null) knownSecretCount++;
                AddDashboard(_factionRows, _factionsList,
                    ("Статус", "Независимый наёмник"),
                    ("Известных сторон", Pipboy.FactionCatalog.Count.ToString()),
                    ("Контрактов активно", activeContracts.ToString()),
                    ("Тайн раскрыто", knownSecretCount.ToString()));
                AddTextCard(_factionRows, _factionsList, "Работа на стороны", RoaPipboy.FactionGroupsExplanation);

                foreach (string id in RoaPipboy.PrimaryFactionIds)
                {
                    JObject lore = Pipboy.FactionLore(id);
                    if (lore == null)
                    {
                        AddFactionCard(_factionRows, _factionsList, "зашифрованный источник", "НЕИЗВЕСТНАЯ СТОРОНА",
                            "ДОСЬЕ НЕ ОТКРЫТО", "В эфире остаётся служебный сигнал без подписи.", FactionTint(id), 0, 0, 0, null, null);
                        continue;
                    }
                    int sites, parties, contested;
                    Pipboy.FactionStats(id, out sites, out parties, out contested);
                    int reputation = self?["worldFactionReputation"]?[id]?.ToObject<int>() ?? 0;
                    bool contractActive = FactionContractActive(contracts[id]);
                    string relationText = ReputationTier(reputation) + " · " + (reputation >= 0 ? "+" : string.Empty) + reputation
                        + (contractActive ? " · КОНТРАКТ АКТИВЕН" : "");
                    string secret = KnownFactionSecret(knownSecrets[id]);
                    string description = "Обещание: " + (lore["promise"]?.ToString() ?? "—")
                        + "\nЦена: " + (lore["price"]?.ToString() ?? "—")
                        + "\nТайна: " + secret;
                    AddFactionCard(_factionRows, _factionsList, "контрактная сторона", RoaPipboy.FactionLabel(id), relationText,
                        description, FactionTint(id), sites, parties, contested, null, null);
                }
            });
        }

        private static bool FactionContractActive(JToken token)
        {
            JObject contract = token as JObject;
            if (contract == null) return false;
            double expiresAt = contract["expiresAt"]?.ToObject<double>() ?? 0d;
            return expiresAt <= 0d || expiresAt > System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private static string ReputationTier(int value)
        {
            if (value >= 75) return "Союзная репутация";
            if (value >= 25) return "Доверие";
            if (value > -25) return "Нейтрально";
            if (value > -60) return "Подозрение";
            return "Враждебность";
        }

        private static string KnownFactionSecret(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return "не раскрыта";
            if (token.Type == JTokenType.String && !string.IsNullOrWhiteSpace(token.ToString())) return token.ToString();
            return token.Type == JTokenType.Boolean && token.ToObject<bool>() ? "досье найдено" : "не раскрыта";
        }

        // ------------------------------------------------------------------
        // FRIENDS — pipboy-friends-grid (03a:262): игрок рядом, друзья, заявки
        // ------------------------------------------------------------------

        private void BuildFriendsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Friends, parent);
            SectionTitle(page, "ДРУЗЬЯ");
            _friendsList = ListArea(page, out _);
            _socialStatus = Label("SocialStatus", page, 13, TextAnchor.LowerLeft, ScreenInkDim);
            _socialStatus.rectTransform.anchorMin = new Vector2(0f, 0f);
            _socialStatus.rectTransform.anchorMax = new Vector2(1f, 0f);
            _socialStatus.rectTransform.pivot = new Vector2(0.5f, 0f);
            _socialStatus.rectTransform.offsetMin = new Vector2(6f, 2f);
            _socialStatus.rectTransform.offsetMax = new Vector2(-6f, 26f);
        }

        private void RefreshFriends()
        {
            JObject social = Pipboy.SocialState();
            _socialStatus.text = Pipboy.ProgressionStatus;

            RebuildRows(_friendRows, _friendsList, () =>
            {
                int friends = (social["friends"] as JArray)?.Count ?? 0;
                int requests = (social["friendRequests"] as JArray)?.Count ?? 0;
                bool online = Socket != null && Socket.Session != null;
                AddDashboard(_friendRows, _friendsList,
                    ("Сеть", online ? "в сети" : "нет связи"),
                    ("В локации", (Pipboy.RemotePlayers != null ? Pipboy.RemotePlayers.Count : 0).ToString()),
                    ("Друзья", friends.ToString()),
                    ("Заявки", requests.ToString()));
                JObject medicalConsent = Pipboy.MedicalConsentRequest;
                if (medicalConsent != null)
                {
                    string healerName = medicalConsent["healerName"]?.ToString() ?? "Игрок";
                    string itemName = RoaItemData.Name(medicalConsent["itemId"]?.ToString() ?? "medkit");
                    AddTextCard(_friendRows, _friendsList, "ЗАПРОС ЛЕЧЕНИЯ",
                        healerName + " хочет применить: " + itemName + ".",
                        new List<(string, System.Action)>
                        {
                            ("Разрешить", () => Pipboy.SubmitMedicalConsent(true)),
                            ("Отклонить", () => Pipboy.SubmitMedicalConsent(false))
                        });
                }
                JObject trade = Pipboy.PlayerTrade;
                if (trade != null)
                {
                    string otherName = trade["otherName"]?.ToString() ?? "Игрок";
                    string status = trade["status"]?.ToString() ?? "pending";
                    bool invitedMe = trade["inviterId"]?.ToString() != trade["selfId"]?.ToString();
                    if (status == "pending")
                    {
                        var inviteActions = invitedMe
                            ? new List<(string, System.Action)>
                            {
                                ("Принять", () => Pipboy.SubmitPlayerTradeAction("acceptInvite")),
                                ("Отклонить", () => Pipboy.SubmitPlayerTradeAction("declineInvite"))
                            }
                            : new List<(string, System.Action)>
                            {
                                ("Отменить", () => Pipboy.SubmitPlayerTradeAction("cancel"))
                            };
                        AddTextCard(_friendRows, _friendsList, "ПРЕДЛОЖЕНИЕ ТОРГОВЛИ",
                            invitedMe ? otherName + " предлагает безопасный обмен." : "Ожидаем ответ: " + otherName + ".",
                            inviteActions);
                    }
                    else
                    {
                        string own = TradeOfferLabel(trade["ownOffer"] as JArray);
                        string other = TradeOfferLabel(trade["otherOffer"] as JArray);
                        bool ownAccepted = trade["ownAccepted"]?.ToObject<bool>() == true;
                        bool otherAccepted = trade["otherAccepted"]?.ToObject<bool>() == true;
                        AddTextCard(_friendRows, _friendsList, "БЕЗОПАСНАЯ СДЕЛКА · " + otherName,
                            "Вы: " + own + (ownAccepted ? " · подтверждено" : "")
                            + "\n" + otherName + ": " + other + (otherAccepted ? " · подтверждено" : ""),
                            new List<(string, System.Action)>
                            {
                                (ownAccepted ? "Подтверждено" : "Подтвердить", () => Pipboy.SubmitPlayerTradeAction("confirm")),
                                ("Отменить", () => Pipboy.SubmitPlayerTradeAction("cancel"))
                            });
                        if (Pipboy.Self?["inventory"] is JArray inventory)
                        {
                            foreach (JToken row in inventory.Take(18))
                            {
                                string itemId = RoaArmorData.BaseId(row["id"]?.ToString() ?? string.Empty);
                                int available = row["qty"]?.ToObject<int>() ?? 0;
                                if (string.IsNullOrEmpty(itemId) || itemId == "fists" || available <= 0) continue;
                                int offered = TradeOfferQty(trade["ownOffer"] as JArray, itemId);
                                var itemActions = new List<(string, System.Action)>();
                                if (offered < available) itemActions.Add(("+1", () => Pipboy.SubmitPlayerTradeOfferDelta(itemId, 1)));
                                if (offered > 0) itemActions.Add(("−1", () => Pipboy.SubmitPlayerTradeOfferDelta(itemId, -1)));
                                AddTextCard(_friendRows, _friendsList, RoaItemData.Name(itemId) + " · " + available,
                                    "В предложении: " + offered, itemActions);
                            }
                        }
                        if (Pipboy.Self?["weaponInventoryRuntime"] is JArray runtimeWeapons)
                        {
                            foreach (JToken token in runtimeWeapons)
                            {
                                string runtimeId = token?["id"]?.ToString() ?? string.Empty;
                                string itemId = token?["baseId"]?.ToString() ?? string.Empty;
                                if (string.IsNullOrEmpty(runtimeId) || string.IsNullOrEmpty(itemId)
                                    || runtimeId == itemId) continue;
                                bool selected = TradeOfferHasRuntime(trade["ownOffer"] as JArray, itemId, runtimeId);
                                int loaded = token?["loaded"]?.ToObject<int>() ?? 0;
                                int condition = Mathf.RoundToInt(token?["condition"]?.ToObject<float>() ?? 100f);
                                JObject mods = token?["weaponMods"] as JObject;
                                int modCount = mods?.Properties().Count() ?? 0;
                                AddTextCard(_friendRows, _friendsList,
                                    RoaItemData.Name(itemId) + " · экземпляр " + runtimeId.Substring(Mathf.Max(0, runtimeId.Length - 6)),
                                    "Состояние " + condition + "% · магазин " + loaded + " · модулей " + modCount,
                                    new List<(string, System.Action)>
                                    {
                                        (selected ? "Убрать экземпляр" : "Предложить экземпляр",
                                            () => Pipboy.SubmitPlayerTradeWeaponToggle(itemId, runtimeId))
                                    });
                            }
                        }
                    }
                }
                AddHeading(_friendRows, _friendsList, "ИГРОК РЯДОМ");
                PublicPlayer target;
                float distance;
                if (Pipboy.TryNearestPlayer(out target, out distance))
                {
                    bool hasClan = !string.IsNullOrEmpty(social["clan"]?["name"]?.ToString());
                    var actions = new List<(string, System.Action)>
                    {
                        ("Торговля", () => Pipboy.SubmitNearbyAction(target, "trade")),
                        ("В друзья", () => Pipboy.SubmitNearbyAction(target, "friend"))
                    };
                    if (hasClan) actions.Add(("В клан", () => Pipboy.SubmitNearbyAction(target, "clan")));
                    AddTextCard(_friendRows, _friendsList,
                        (target.Name ?? "Игрок") + " · ур. " + target.Level + " · " + distance.ToString("0.0") + " м",
                        "HP " + target.Hp + "/" + target.MaxHp, actions);
                    AddTextCard(_friendRows, _friendsList, "Доступ к личной базе",
                        "Гость только входит; работник использует склад и станции; строитель также ставит объекты.",
                        new List<(string, System.Action)>
                        {
                            ("Гость", () => Pipboy.SubmitPersonalBasePermission(target, "guest")),
                            ("Работник", () => Pipboy.SubmitPersonalBasePermission(target, "worker")),
                            ("Строитель", () => Pipboy.SubmitPersonalBasePermission(target, "builder")),
                            ("Закрыть", () => Pipboy.SubmitPersonalBasePermission(target, "revoke")),
                            ("В гости", () => Pipboy.SubmitPersonalBaseVisit(target))
                        });

                    bool inRange = distance <= RoaPipboy.HealRange;
                    var heal = new List<(string, System.Action)>();
                    AddHeal(heal, target, "medkit", "Аптечка", inRange && target.Hp < target.MaxHp);
                    AddHeal(heal, target, "stim", "Стимулятор", inRange && target.Hp < target.MaxHp);
                    AddHeal(heal, target, "doctorBag", "Доктор", inRange && RoaPipboy.HasTreatableInjury(target));
                    AddHeal(heal, target, "antibiotics", "Антибиотик", inRange && RoaPipboy.HasInjury(target, "infection"));
                    AddTextCard(_friendRows, _friendsList, "Лечение",
                        inRange ? "Предметы из вашего рюкзака. Другой игрок должен подтвердить лечение." : "Подойдите ближе, чтобы лечить.", heal);
                }
                else
                {
                    AddTextCard(_friendRows, _friendsList, "Никого рядом", "Подойдите к другому игроку на 4.5 м.");
                }

                AddHeading(_friendRows, _friendsList, "ДРУЗЬЯ");
                AddSocialEntries(_friendRows, _friendsList, social["friends"] as JArray,
                    entry => new List<(string, System.Action)> { ("Удалить", () => Pipboy.SubmitSocialState("removeFriend", entry)) });

                AddHeading(_friendRows, _friendsList, "ЗАЯВКИ В ДРУЗЬЯ");
                AddSocialEntries(_friendRows, _friendsList, social["friendRequests"] as JArray,
                    entry => new List<(string, System.Action)>
                    {
                        ("Принять", () => Pipboy.SubmitSocialState("acceptFriend", entry)),
                        ("Отклонить", () => Pipboy.SubmitSocialState("declineFriend", entry))
                    });
            });
        }

        private void AddHeal(List<(string, System.Action)> into, PublicPlayer target, string itemId, string label, bool applicable)
        {
            int qty = Pipboy.InventoryQty(itemId);
            if (!applicable || qty <= 0) return;
            into.Add((label + " (" + qty + ")", () => Pipboy.SubmitHeal(target, itemId)));
        }

        private static int TradeOfferQty(JArray rows, string itemId)
        {
            if (rows == null) return 0;
            foreach (JToken row in rows)
                if (RoaArmorData.BaseId(row["id"]?.ToString() ?? string.Empty) == itemId)
                    return Mathf.Max(0, row["qty"]?.ToObject<int>() ?? 0);
            return 0;
        }

        private static bool TradeOfferHasRuntime(JArray rows, string itemId, string itemRuntimeId)
        {
            if (rows == null || string.IsNullOrEmpty(itemRuntimeId)) return false;
            foreach (JToken row in rows)
            {
                if (RoaArmorData.BaseId(row?["id"]?.ToString() ?? string.Empty) != itemId) continue;
                foreach (JToken token in row?["itemRuntimeIds"] as JArray ?? new JArray())
                    if (token?.ToString() == itemRuntimeId) return true;
            }
            return false;
        }

        private static string TradeOfferLabel(JArray rows)
        {
            if (rows == null || rows.Count == 0) return "ничего";
            return string.Join(", ", rows.Take(8).Select(row =>
                RoaItemData.Name(RoaArmorData.BaseId(row["id"]?.ToString() ?? string.Empty))
                + " ×" + Mathf.Max(1, row["qty"]?.ToObject<int>() ?? 1)
                + (((row["itemRuntimeIds"] as JArray)?.Count ?? 0) > 0
                    ? " (выбрано экземпляров: " + (row["itemRuntimeIds"] as JArray).Count + ")"
                    : string.Empty)
                + TradeOfferRuntimeSummary(row)));
        }

        private static string TradeOfferRuntimeSummary(JToken row)
        {
            JArray records = row?["itemRuntimeRecords"] as JArray;
            if (records == null || records.Count == 0) return string.Empty;
            return " [" + string.Join("; ", records.Take(3).Select(record =>
                Mathf.RoundToInt(record?["condition"]?.ToObject<float>() ?? 100f) + "%"
                + ", магазин " + (record?["loaded"]?.ToObject<int>() ?? 0)
                + ", модулей " + ((record?["weaponMods"] as JObject)?.Properties().Count() ?? 0))) + "]";
        }

        private void AddSocialEntries(List<GameObject> rows, RectTransform list, JArray entries,
                                      System.Func<string, List<(string, System.Action)>> actionsFor)
        {
            if (entries == null || entries.Count == 0)
            {
                AddTextCard(rows, list, "— пусто —", string.Empty);
                return;
            }

            foreach (JToken entry in entries)
            {
                string id = entry["id"]?.ToString();
                AddTextCard(rows, list, RoaPipboy.SocialEntryLabel(entry), string.Empty, actionsFor(id));
            }
        }

        // ------------------------------------------------------------------
        // CLAN — pipboy-clan-grid (03a:325)
        // ------------------------------------------------------------------

        private void BuildClanPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Clan, parent);
            SectionTitle(page, "КЛАН");
            _clanList = ListArea(page, out _);
            BuildKromkaClanStatus(page);
        }

        private void RefreshClan()
        {
            JObject social = Pipboy.SocialState();
            JObject clan = social["clan"] as JObject;
            string clanName = clan?["name"]?.ToString() ?? string.Empty;
            RefreshKromkaClanStatus();

            RebuildRows(_clanRows, _clanList, () =>
            {
                int invites = (social["clanInvites"] as JArray)?.Count ?? 0;
                int memberCount = (clan?["members"] as JArray)?.Count ?? 0;
                AddDashboard(_clanRows, _clanList,
                    ("Клан", string.IsNullOrEmpty(clanName) ? "нет" : clanName),
                    ("Ранг", string.IsNullOrEmpty(clanName) ? "-" : (clan?["role"]?.ToString() ?? "Участник")),
                    ("Состав", memberCount.ToString()),
                    ("Приглашения", invites.ToString()));
                if (string.IsNullOrEmpty(clanName))
                {
                    AddHeading(_clanRows, _clanList, "НЕТ КЛАНА");
                    AddClanCreateRow();
                }
                else
                {
                    AddHeading(_clanRows, _clanList, "ВАШ КЛАН");
                    AddTextCard(_clanRows, _clanList, clanName, "Роль: " + (clan["role"]?.ToString() ?? "Участник"),
                        new List<(string, System.Action)> { ("Покинуть", () => SubmitClanSocial("leaveClan")) });

                    AddHeading(_clanRows, _clanList, "УЧАСТНИКИ");
                    JArray members = clan["members"] as JArray;
                    if (members == null || members.Count == 0) AddTextCard(_clanRows, _clanList, "— пока нет —", string.Empty);
                    else foreach (JToken member in members)
                        AddTextCard(_clanRows, _clanList, RoaPipboy.SocialEntryLabel(member), string.Empty);
                }

                AddHeading(_clanRows, _clanList, "ПРИГЛАШЕНИЯ В КЛАН");
                AddSocialEntries(_clanRows, _clanList, social["clanInvites"] as JArray,
                    entry => new List<(string, System.Action)>
                    {
                        ("Принять", () => SubmitClanSocial("acceptClan", entry)),
                        ("Отклонить", () => SubmitClanSocial("declineClan", entry))
                    });
                AddKromkaClanBaseRows(clanName);
            });
        }

        private void AddClanCreateRow()
        {
            var row = new GameObject("ClanCreate", typeof(RectTransform));
            row.transform.SetParent(_clanList, false);
            var layout = row.AddComponent<LayoutElement>();
            layout.preferredHeight = 44f;
            var back = row.AddComponent<Image>();
            back.color = CardBg;

            var fieldGo = new GameObject("Name", typeof(RectTransform));
            fieldGo.transform.SetParent(row.transform, false);
            var fieldRect = (RectTransform)fieldGo.transform;
            fieldRect.anchorMin = new Vector2(0.01f, 0.15f);
            fieldRect.anchorMax = new Vector2(0.72f, 0.85f);
            fieldRect.offsetMin = Vector2.zero;
            fieldRect.offsetMax = Vector2.zero;
            var fieldBack = fieldGo.AddComponent<Image>();
            fieldBack.color = new Color(0f, 0f, 0f, 0.45f);
            _clanNameInput = fieldGo.AddComponent<InputField>();
            Text fieldText = Label("Text", fieldRect, 14, TextAnchor.MiddleLeft, ScreenInk);
            Stretch(fieldText.rectTransform, 6f);
            fieldText.raycastTarget = false;
            fieldText.supportRichText = false;
            _clanNameInput.textComponent = fieldText;
            _clanNameInput.characterLimit = 42;
            Text placeholder = Label("Placeholder", fieldRect, 14, TextAnchor.MiddleLeft, ScreenInkDim);
            Stretch(placeholder.rectTransform, 6f);
            placeholder.text = "Название клана (от 3 символов)";
            _clanNameInput.placeholder = placeholder;

            Button create = TextButton("Create", (RectTransform)row.transform, "Создать клан", 13, out Text createText);
            var rect = (RectTransform)create.transform;
            rect.anchorMin = new Vector2(0.74f, 0.15f);
            rect.anchorMax = new Vector2(0.99f, 0.85f);
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            create.GetComponent<Image>().color = new Color(0.16f, 0.28f, 0.12f, 0.95f);
            createText.color = AccentWarm;
            create.onClick.AddListener(() =>
            {
                string name = (_clanNameInput.text ?? string.Empty).Trim();
                if (name.Length < 3)
                {
                    SetKromkaClanStatus("Название клана должно содержать не меньше трёх символов.");
                    return;
                }
                SubmitClanSocial("createClan", null, name);
                _refreshAt = Time.unscaledTime + 0.4f;
            });

            _clanRows.Add(row);
        }

        // ------------------------------------------------------------------
        // RADIO — pipboy-radio-grid (03a:1941)
        // ------------------------------------------------------------------

        private void BuildRadioPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Radio, parent);
            SectionTitle(page, "РАДИО");
            _radioList = ListArea(page, out _);
        }

        /// <summary>
        /// .pipboy-radio-row web (03a:1941, 13:1446/1815): вся строка — кнопка,
        /// имя ЗАГЛАВНЫМИ, описание ниже; активная — янтарная рамка #d4b35b и
        /// тёплый фон rgba(67,52,20,.42).
        /// </summary>
        private void RefreshRadio()
        {
            RebuildRows(_radioRows, _radioList, () =>
            {
                for (int i = 0; i < RoaPipboy.RadioTitles.Length; i++)
                {
                    int channel = i;
                    bool active = Pipboy.RadioChannel == i;
                    var row = new GameObject("Radio:" + i, typeof(RectTransform));
                    row.transform.SetParent(_radioList, false);
                    row.AddComponent<LayoutElement>().preferredHeight = 58f;
                    var back = row.AddComponent<Image>();
                    back.color = active ? new Color(0.16f, 0.13f, 0.06f, 1f) : new Color(0.03f, 0.07f, 0.045f, 1f);
                    var outline = row.AddComponent<Outline>();
                    outline.effectColor = active ? new Color(0.831f, 0.702f, 0.357f, 1f) : ScreenBorder;
                    outline.effectDistance = new Vector2(1f, -1f);
                    Text title = Label("Title", (RectTransform)row.transform, 12, TextAnchor.UpperLeft, new Color(0.827f, 0.933f, 0.541f, 1f), FontStyle.Bold);
                    Place_(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -26f), new Vector2(-10f, -8f));
                    title.text = RoaPipboy.RadioTitles[i].ToUpperInvariant();
                    Text body = Label("Body", (RectTransform)row.transform, 11, TextAnchor.UpperLeft, new Color(0.624f, 0.859f, 0.478f, 0.76f));
                    Place_(body.rectTransform, 0f, 0f, 1f, 1f, new Vector2(10f, 6f), new Vector2(-10f, -28f));
                    body.horizontalOverflow = HorizontalWrapMode.Wrap;
                    body.verticalOverflow = VerticalWrapMode.Truncate;
                    body.text = RoaPipboy.RadioDescriptions[i];
                    var button = row.AddComponent<Button>();
                    button.targetGraphic = back;
                    button.onClick.AddListener(() => { Pipboy.RadioChannel = channel; _refreshAt = 0f; });
                    _radioRows.Add(row);
                }

                // Живой эфир выбранного канала: статус приёма и последние строки из
                // сводки пустоши. Сам звук ведёт RoaRadio, страница только читает.
                RoaRadio radio = RoaRadio.Active;
                AddHeading(_radioRows, _radioList, "ЭФИР");
                if (radio == null || Pipboy.RadioChannel == RoaRadio.ChannelSilence)
                {
                    AddTextCard(_radioRows, _radioList, "Приёмник отключён", "Остаётся только системный журнал.");
                }
                else
                {
                    AddTextCard(_radioRows, _radioList, radio.StatusLine,
                        string.IsNullOrEmpty(radio.SignalLine) ? "Настройка на несущую…" : radio.SignalLine);
                    // Пластинка из библиотеки (public/radio): сводка может перезаписать
                    // строку сигнала, поэтому «сейчас играет» показывается отдельной карточкой.
                    if (radio.MusicPlaying && !string.IsNullOrEmpty(radio.NowPlayingTitle))
                        AddTextCard(_radioRows, _radioList, "♪ Сейчас играет", radio.NowPlayingTitle);
                    if (!string.IsNullOrEmpty(radio.NextUpTitle))
                        AddTextCard(_radioRows, _radioList, "Далее в эфире", radio.NextUpTitle);
                    IReadOnlyList<RoaRadio.Broadcast> lines = radio.Lines;
                    if (lines.Count == 0)
                        AddTextCard(_radioRows, _radioList, "Несущая", "Эфир пуст — ждём сводку пустоши.");
                    for (int i = 0; i < lines.Count; i++)
                        AddTextCard(_radioRows, _radioList, lines[i].Stamp, lines[i].Text);
                }
            });
        }

        // ------------------------------------------------------------------
        // Общие карточки списков
        // ------------------------------------------------------------------

        private void AddHeading(List<GameObject> rows, RectTransform list, string caption)
        {
            var row = new GameObject("Heading", typeof(RectTransform));
            row.transform.SetParent(list, false);
            var layout = row.AddComponent<LayoutElement>();
            layout.preferredHeight = 24f;
            Text text = Label("Text", (RectTransform)row.transform, 13, TextAnchor.LowerLeft, ScreenInkDim, FontStyle.Bold);
            Stretch(text.rectTransform, 4f);
            text.text = caption;
            rows.Add(row);
        }

        /// <summary>
        /// Карточка с заголовком, описанием и рядом кнопок справа — общая форма
        /// для заданий, точек мира, фракций, друзей и радио. Высота зависит
        /// от числа строк описания.
        /// </summary>
        private void AddTextCard(List<GameObject> rows, RectTransform list, string title, string body,
                                 List<(string, System.Action)> actions = null)
        {
            // Высота с учётом переноса (~135 символов в строке при ширине списка и шрифте 12).
            int lines = 1;
            if (!string.IsNullOrEmpty(body))
                foreach (string segment in body.Split('\n'))
                    lines += Mathf.Max(1, Mathf.CeilToInt(segment.Length / 135f));
            float height = 26f + lines * 16f + (actions != null && actions.Count > 0 ? 30f : 4f);

            var row = new GameObject("Card", typeof(RectTransform));
            row.transform.SetParent(list, false);
            var layout = row.AddComponent<LayoutElement>();
            layout.preferredHeight = height;
            var back = row.AddComponent<Image>();
            back.color = CardBg;

            Text head = Label("Title", (RectTransform)row.transform, 14, TextAnchor.UpperLeft, ScreenInk, FontStyle.Bold);
            head.rectTransform.anchorMin = new Vector2(0f, 1f);
            head.rectTransform.anchorMax = new Vector2(1f, 1f);
            head.rectTransform.pivot = new Vector2(0.5f, 1f);
            head.rectTransform.offsetMin = new Vector2(8f, -24f);
            head.rectTransform.offsetMax = new Vector2(-8f, -4f);
            head.text = title;

            if (!string.IsNullOrEmpty(body))
            {
                Text text = Label("Body", (RectTransform)row.transform, 12, TextAnchor.UpperLeft, ScreenInkDim);
                text.rectTransform.anchorMin = new Vector2(0f, 1f);
                text.rectTransform.anchorMax = new Vector2(1f, 1f);
                text.rectTransform.pivot = new Vector2(0.5f, 1f);
                text.rectTransform.offsetMin = new Vector2(8f, -26f - lines * 16f);
                text.rectTransform.offsetMax = new Vector2(-8f, -26f);
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.text = body;
            }

            if (actions != null && actions.Count > 0)
            {
                float x = 8f;
                foreach ((string caption, System.Action onClick) in actions)
                {
                    Button button = TextButton("Action", (RectTransform)row.transform, caption, 12, out Text label);
                    var rect = (RectTransform)button.transform;
                    rect.anchorMin = new Vector2(0f, 0f);
                    rect.anchorMax = new Vector2(0f, 0f);
                    rect.pivot = new Vector2(0f, 0f);
                    float width = Mathf.Max(96f, caption.Length * 8f + 24f);
                    rect.anchoredPosition = new Vector2(x, 4f);
                    rect.sizeDelta = new Vector2(width, 24f);
                    x += width + 6f;
                    button.GetComponent<Image>().color = new Color(0.16f, 0.28f, 0.12f, 0.95f);
                    label.color = AccentWarm;
                    button.interactable = onClick != null && (Pipboy == null || !Pipboy.ProgressionPending);
                    if (onClick == null) label.color = new Color(AccentWarm.r, AccentWarm.g, AccentWarm.b, 0.55f);
                    System.Action act = onClick;
                    button.onClick.AddListener(() => { if (act == null) return; act(); _refreshAt = Time.unscaledTime + 0.3f; });
                }
            }

            rows.Add(row);
        }

        /// <summary>.pipboy-quest-section-title: золотой заголовок секции капсом.</summary>
        private void AddSectionTitle(List<GameObject> rows, RectTransform list, string caption)
        {
            var row = new GameObject("Section", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 22f;
            Text text = Label("Title", (RectTransform)row.transform, 12, TextAnchor.LowerLeft, AccentWarm, FontStyle.Bold);
            text.rectTransform.anchorMin = Vector2.zero;
            text.rectTransform.anchorMax = Vector2.one;
            text.rectTransform.offsetMin = new Vector2(4f, 0f);
            text.rectTransform.offsetMax = new Vector2(-4f, 0f);
            text.text = caption.ToUpperInvariant();
            rows.Add(row);
        }

        private static bool IsTrue(JToken token)
        {
            return token != null && token.Type == JTokenType.Boolean && token.ToObject<bool>();
        }

        private static bool Contains(JArray array, string value)
        {
            if (array == null || string.IsNullOrEmpty(value)) return false;
            foreach (JToken token in array)
                if (token?.ToString() == value) return true;
            return false;
        }

        // ------------------------------------------------------------------
        // Мелкие помощники uGUI
        // ------------------------------------------------------------------

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

        private Text SectionTitle(RectTransform page, string caption)
        {
            Text title = Label("SectionTitle", page, 15, TextAnchor.UpperLeft, ScreenInkDim, FontStyle.Bold);
            title.rectTransform.anchorMin = new Vector2(0f, 1f);
            title.rectTransform.anchorMax = new Vector2(1f, 1f);
            title.rectTransform.pivot = new Vector2(0.5f, 1f);
            title.rectTransform.offsetMin = new Vector2(4f, -26f);
            title.rectTransform.offsetMax = new Vector2(-4f, 0f);
            title.text = caption;
            return title;
        }

        private static Text Label(string name, RectTransform parent, int size,
                                  TextAnchor anchor, Color color, FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Child(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.alignment = anchor;
            text.color = color;
            text.fontStyle = style;
            text.raycastTarget = false;
            text.supportRichText = false;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }

        private static Button TextButton(string name, Transform parent, string caption,
                                         int size, out Text label)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = new Color(0f, 0f, 0f, 0.3f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;

            label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, ScreenInk);
            Stretch(label.rectTransform, 2f);
            label.raycastTarget = false;
            label.text = caption;
            return button;
        }
    }
}
