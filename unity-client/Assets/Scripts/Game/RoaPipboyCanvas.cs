using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Терминал PIP-ASH — окно инвентаря и Pip-Boy в структуре web-клиента
    /// (#inventory-window в index.html:55): латунная рамка, фосфорный экран,
    /// сводка WG/HP/AP/DT/Caps/СИЛА, страницы и ряд вкладок снизу.
    ///
    /// Клавиши повторяют web: TAB — статус, I — инвентарь, B — навыки/перки,
    /// P — крафт. Данные и действия остаются в RoaInventory и RoaPipboy —
    /// этот класс только рисует их в новом виде; старые IMGUI-окна выключены
    /// флагом CanvasDriven, как это уже сделано с HUD.
    ///
    /// Разделы, ещё не перенесённые из web, показывают честную заглушку,
    /// а не пустую страницу: игрок должен видеть, что раздел существует.
    /// </summary>
    public sealed partial class RoaPipboyCanvas : MonoBehaviour
    {
        public enum Page { Status, Items, Skills, Perks, Craft, Quests, World, Factions, Friends, Clan, Radio }

        // Палитра фосфорного экрана — из .pipboy-screen (13_fallout_weapon_console.css:1004).
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
        public RoaFogOfWar Fog;
        public bool InputEnabled = true;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }
        public Page ActivePage { get { return _page; } }

        private Canvas _canvas;
        private GameObject _root;
        private Page _page = Page.Items;

        private Text _locationLine;
        private Text _topline;
        private readonly Dictionary<Page, GameObject> _pages = new Dictionary<Page, GameObject>();
        private readonly Dictionary<Page, Button> _tabs = new Dictionary<Page, Button>();
        private readonly Dictionary<Page, Text> _tabLabels = new Dictionary<Page, Text>();

        // ITEMS
        private Text _carryLine;
        public RoaQuickbar Quickbar;
        private RoaCharacterPreview _itemsPreview;
        private RawImage _itemsModel;
        private Text _itemsPanelName;
        private Text _itemsPanelSlots;
        private readonly Dictionary<string, (Button button, RawImage art, Text name, Text type, Text empty)> _itemsSlots
            = new Dictionary<string, (Button, RawImage, Text, Text, Text)>();
        private readonly List<(Button button, Text label)> _quickSlots = new List<(Button, Text)>();
        private Text _quickHint;
        private RectTransform _itemsGrid;
        private Text _itemsStatus;
        private string _selectedItemId = string.Empty;
        private readonly List<GameObject> _itemCards = new List<GameObject>();
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
        private readonly List<GameObject> _craftRows = new List<GameObject>();
        private readonly HashSet<string> _pendingRecipes = new HashSet<string>();

        // QUESTS / WORLD / FACTIONS / FRIENDS / CLAN / RADIO
        private RectTransform _questsList;
        private RectTransform _worldList;
        private RectTransform _factionsList;
        private RectTransform _friendsList;
        private RectTransform _clanList;
        private RectTransform _radioList;
        private Text _worldHeader;
        private Text _socialStatus;
        private InputField _clanNameInput;
        private readonly List<GameObject> _questRows = new List<GameObject>();
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
            (Page.Status, "Статус"), (Page.Items, "Инвентарь"), (Page.Skills, "Навыки"),
            (Page.Perks, "Перки"), (Page.Craft, "Крафт"), (Page.Quests, "Задания"),
            (Page.World, "Мир"), (Page.Factions, "Фракции"), (Page.Friends, "Друзья"),
            (Page.Clan, "Клан"), (Page.Radio, "Радио")
        };

        private void Update()
        {
            if (!InputEnabled || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                if (IsOpen) Close();
                return;
            }

            // Клавиши как в web: TAB/I/B/P. Повторное нажатие своей клавиши закрывает.
            if (Input.GetKeyDown(KeyCode.Tab)) TogglePage(Page.Status);
            else if (Input.GetKeyDown(KeyCode.I)) TogglePage(Page.Items);
            else if (Input.GetKeyDown(KeyCode.B)) TogglePage(Page.Skills);
            else if (Input.GetKeyDown(KeyCode.P)) TogglePage(Page.Craft);
            else if (IsOpen && Input.GetKeyDown(KeyCode.Escape)) Close();

            if (!IsOpen) return;

            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + 0.25f;
                Refresh();
            }
        }

        public void TogglePage(Page page)
        {
            if (IsOpen && _page == page) { Close(); return; }
            Open(page);
        }

        public void Open(Page page)
        {
            EnsureBuilt();
            _page = page;
            _root.SetActive(true);
            ApplyPage();
            Refresh();
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

            // Латунная рамка 980x780 по центру.
            RectTransform frame = Child("Frame", rootRect);
            frame.anchorMin = frame.anchorMax = new Vector2(0.5f, 0.5f);
            frame.pivot = new Vector2(0.5f, 0.5f);
            frame.sizeDelta = new Vector2(980f, 800f);
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
            pageArea.offsetMin = new Vector2(18f, 64f);
            pageArea.offsetMax = new Vector2(-18f, -108f);

            BuildStatusPage(pageArea);
            BuildItemsPage(pageArea);
            BuildSkillsPage(pageArea);
            BuildPerksPage(pageArea);
            BuildCraftPage(pageArea);
            BuildQuestsPage(pageArea);
            BuildWorldPage(pageArea);
            BuildFactionsPage(pageArea);
            BuildFriendsPage(pageArea);
            BuildClanPage(pageArea);
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
            title.text = "PIP-ASH";

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
            closeRect.sizeDelta = new Vector2(38f, 34f);
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
            tabs.offsetMin = new Vector2(12f, 10f);
            tabs.offsetMax = new Vector2(-12f, 54f);

            var layout = tabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            layout.spacing = 4f;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = true;
            layout.childControlWidth = true;
            layout.childControlHeight = true;

            foreach ((Page page, string label) in TabOrder)
            {
                Button button = TextButton("Tab:" + page, tabs, label, 13, out Text text);
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
        private static readonly Color SlotName = new Color(0.827f, 0.933f, 0.541f, 1f);    // #d3ee8a
        private static readonly Color SpecialValue = new Color(0.937f, 0.816f, 0.471f, 1f); // #efd078
        private static readonly Color CellBg = new Color(0.03f, 0.075f, 0.042f, 1f);
        private static readonly Color CellBorder = new Color(0.494f, 0.784f, 0.357f, 0.28f);

        private Text _plateName;
        private Text _plateMeta;
        private readonly Dictionary<string, (RawImage art, Text name, Text type, Text empty)> _statusSlots
            = new Dictionary<string, (RawImage, Text, Text, Text)>();
        private readonly Dictionary<string, Text> _specialCells = new Dictionary<string, Text>();
        private readonly List<Text> _statLines = new List<Text>();
        private Text _injuryBody;

        private static readonly (string slot, string title)[] StatusSlots =
        {
            ("weapon", "Правая рука"), ("offhand", "Левая рука"), ("armor", "Корпус"),
            ("helmet", "Голова"), ("boots", "Ноги"), ("backpack", "Спина")
        };

        private void BuildStatusPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Status, parent);
            SectionTitle(page, "STATUS");

            // Левая колонка: пластина персонажа + сетка слотов.
            RectTransform left = Child("Left", page);
            left.anchorMin = new Vector2(0f, 0f);
            left.anchorMax = new Vector2(0.415f, 1f);
            left.offsetMin = new Vector2(0f, 0f);
            left.offsetMax = new Vector2(-8f, -34f);

            RectTransform plate = Panel_(left, PlateBg, PlateBorder);
            Place_(plate, 0f, 1f, 1f, 1f, new Vector2(0f, -150f), new Vector2(0f, 0f));
            _plateName = Label("Name", plate, 15, TextAnchor.UpperLeft, PlateName, FontStyle.Bold);
            Place_(_plateName.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -30f), new Vector2(-12f, -10f));
            _plateMeta = Label("Meta", plate, 11, TextAnchor.UpperLeft, ScreenInkDim);
            Place_(_plateMeta.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -46f), new Vector2(-12f, -32f));
            BuildBodyReadout(plate);

            for (int i = 0; i < StatusSlots.Length; i++)
            {
                RectTransform slot = Panel_(left, SlotBg, SlotBorder);
                float top = 158f + i * 52f;
                Place_(slot, 0f, 1f, 1f, 1f, new Vector2(0f, -top - 46f), new Vector2(0f, -top));
                RectTransform artRect = Child("Art", slot);
                artRect.anchorMin = artRect.anchorMax = new Vector2(0f, 0.5f);
                artRect.pivot = new Vector2(0f, 0.5f);
                artRect.anchoredPosition = new Vector2(6f, 0f);
                artRect.sizeDelta = new Vector2(31f, 31f);
                var art = artRect.gameObject.AddComponent<RawImage>();
                art.raycastTarget = false;
                Text empty = Label("Empty", slot, 16, TextAnchor.MiddleCenter, ScreenInkDim);
                Place_(empty.rectTransform, 0f, 0f, 0f, 1f, new Vector2(6f, 0f), new Vector2(37f, 0f));
                empty.text = "—";
                Text name = Label("Name", slot, 11, TextAnchor.UpperLeft, SlotName);
                Place_(name.rectTransform, 0f, 0.5f, 1f, 1f, new Vector2(44f, -2f), new Vector2(-6f, -8f));
                name.verticalOverflow = VerticalWrapMode.Truncate;
                Text type = Label("Type", slot, 9, TextAnchor.UpperLeft, ScreenInkDim);
                Place_(type.rectTransform, 0f, 0f, 1f, 0.5f, new Vector2(44f, 8f), new Vector2(-6f, 2f));
                type.text = StatusSlots[i].title;
                _statusSlots[StatusSlots[i].slot] = (art, name, type, empty);
            }

            // Правая колонка: SPECIAL, stat-line, Состояние.
            RectTransform right = Child("Right", page);
            right.anchorMin = new Vector2(0.415f, 0f);
            right.anchorMax = new Vector2(1f, 1f);
            right.offsetMin = new Vector2(8f, 0f);
            right.offsetMax = new Vector2(0f, -34f);

            RectTransform special = Panel_(right, new Color(0.03f, 0.06f, 0.04f, 1f), new Color(0.835f, 0.722f, 0.392f, 0.3f));
            Place_(special, 0f, 1f, 1f, 1f, new Vector2(0f, -88f), new Vector2(0f, 0f));
            Text specialTitle = Label("Title", special, 11, TextAnchor.UpperLeft, AccentWarm, FontStyle.Bold);
            specialTitle.text = "SPECIAL";
            Place_(specialTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(9f, -24f), new Vector2(-9f, -8f));
            string[] keys = { "str", "per", "end", "cha", "int", "agi", "luck" };
            string[] codes = { "ST", "PE", "EN", "CH", "IN", "AG", "LK" };
            for (int i = 0; i < keys.Length; i++)
            {
                RectTransform cell = Panel_(special, CellBg, CellBorder);
                float minX = i / 7f, maxX = (i + 1) / 7f;
                Place_(cell, minX, 0f, maxX, 0f, new Vector2(i == 0 ? 9f : 2.5f, 9f), new Vector2(i == 6 ? -9f : -2.5f, 57f));
                Text code = Label("Code", cell, 9, TextAnchor.UpperCenter, ScreenInkDim, FontStyle.Bold);
                code.text = codes[i];
                Place_(code.rectTransform, 0f, 1f, 1f, 1f, new Vector2(0f, -18f), new Vector2(0f, -5f));
                Text value = Label("Value", cell, 18, TextAnchor.LowerCenter, SpecialValue, FontStyle.Bold);
                Place_(value.rectTransform, 0f, 0f, 1f, 0f, new Vector2(0f, 4f), new Vector2(0f, 28f));
                _specialCells[keys[i]] = value;
            }

            _statLines.Clear();
            for (int i = 0; i < 17; i++)
            {
                Text line = Label("Stat" + i, right, 11, TextAnchor.MiddleLeft, ScreenInkDim);
                line.supportRichText = true;
                Place_(line.rectTransform, 0f, 1f, 1f, 1f, new Vector2(2f, -98f - i * 15f - 14f), new Vector2(-2f, -98f - i * 15f));
                _statLines.Add(line);
            }

            RectTransform injury = Panel_(right, SlotBg, SlotBorder);
            Place_(injury, 0f, 1f, 1f, 1f, new Vector2(0f, -98f - 17 * 15f - 8f - 56f), new Vector2(0f, -98f - 17 * 15f - 8f));
            Text injuryTitle = Label("Title", injury, 12, TextAnchor.UpperLeft, SlotName, FontStyle.Bold);
            injuryTitle.text = "СОСТОЯНИЕ";
            Place_(injuryTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(8f, -24f), new Vector2(-8f, -6f));
            _injuryBody = Label("Body", injury, 11, TextAnchor.UpperLeft, ScreenInkDim);
            Place_(_injuryBody.rectTransform, 0f, 0f, 1f, 1f, new Vector2(8f, 4f), new Vector2(-8f, -26f));
        }

        /// <summary>.pipboy-body-readout: схематичный силуэт (голова, торс, руки, ноги, оружие).</summary>
        private static void BuildBodyReadout(RectTransform plate)
        {
            Color body = new Color(0.49f, 0.804f, 0.369f, 0.35f);
            Color weapon = new Color(0.937f, 0.816f, 0.471f, 0.55f);
            void Part(string name, Vector2 pos, Vector2 size, Color color)
            {
                RectTransform rect = Child(name, plate);
                rect.anchorMin = rect.anchorMax = new Vector2(1f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.anchoredPosition = pos;
                rect.sizeDelta = size;
                var image = rect.gameObject.AddComponent<Image>();
                image.color = color;
                image.raycastTarget = false;
            }
            Part("Head", new Vector2(-60f, 40f), new Vector2(18f, 18f), body);
            Part("Torso", new Vector2(-60f, 10f), new Vector2(26f, 38f), body);
            Part("ArmL", new Vector2(-80f, 10f), new Vector2(8f, 34f), body);
            Part("ArmR", new Vector2(-40f, 10f), new Vector2(8f, 34f), body);
            Part("LegL", new Vector2(-67f, -28f), new Vector2(9f, 36f), body);
            Part("LegR", new Vector2(-53f, -28f), new Vector2(9f, 36f), body);
            Part("Weapon", new Vector2(-28f, 12f), new Vector2(5f, 30f), weapon);
        }

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

        private void RefreshStatus(JObject self)
        {
            if (self == null) return;
            string weaponId = Inventory != null && Inventory.EquipmentSlots.TryGetValue("weapon", out string w) ? RoaArmorData.BaseId(w) : string.Empty;
            string offhandId = Inventory != null && Inventory.EquipmentSlots.TryGetValue("offhand", out string o) ? RoaArmorData.BaseId(o) : string.Empty;
            string heldId = !string.IsNullOrEmpty(weaponId) && weaponId != "fists" ? weaponId : (!string.IsNullOrEmpty(offhandId) ? offhandId : "fists");
            string heldName = heldId == "fists" ? "Кулаки" : ItemName(heldId);

            _plateName.text = (self["name"]?.ToString() ?? "Странник").ToUpperInvariant();
            _plateMeta.text = "Уровень " + (self["level"]?.ToObject<int>() ?? 1) + " · " + heldName;

            foreach ((string slot, string _) in StatusSlots)
            {
                (RawImage art, Text name, Text type, Text empty) row = _statusSlots[slot];
                string runtimeId = Inventory != null && Inventory.EquipmentSlots.TryGetValue(slot, out string id) ? id : string.Empty;
                string baseId = RoaArmorData.BaseId(runtimeId ?? string.Empty);
                bool has = !string.IsNullOrEmpty(baseId) && baseId != "fists";
                row.art.texture = has ? RoaItemCategories.Art(baseId) : null;
                row.art.enabled = has && row.art.texture != null;
                row.empty.gameObject.SetActive(!has);
                row.name.text = has ? ItemName(baseId) : "Пусто";
            }

            JObject special = self["special"] as JObject;
            foreach (KeyValuePair<string, Text> cell in _specialCells)
                cell.Value.text = (special?[cell.Key]?.ToObject<int>() ?? 5).ToString();

            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(heldId);
            bool melee = string.IsNullOrEmpty(weapon.AmmoType);
            string ammoText = melee ? "не нужны" : RoaWeaponData.AmmoLabel(weapon.AmmoType);
            float speed = 4.35f + (special?["agi"]?.ToObject<int>() ?? 5) * 0.13f;
            int vision = Fog != null ? Fog.Radius : 0;
            string faction = RoaPipboy.FactionLabel(self["worldFactionId"]?.ToString() ?? self["factionId"]?.ToString());
            int skillsAboveBase = 0;
            foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills)
            {
                JToken rank = self["skillRanks"]?[skill.Id];
                if (rank != null && rank.Type != JTokenType.Null && rank.ToObject<int>() > RoaPipboy.SkillPercent(new JObject { ["special"] = special, ["taggedSkills"] = self["taggedSkills"] }, skill.Id)) skillsAboveBase++;
            }
            int learnedPerks = 0;
            foreach (KeyValuePair<string, JToken> rank in self["talentRanks"] as JObject ?? new JObject())
                learnedPerks += rank.Value?.ToObject<int>() ?? 0;
            int power = RoaGearData.PowerTotal(Inventory != null ? Inventory.EquipmentSlots : null,
                id => Mathf.RoundToInt(self["itemConditions"]?[id]?.ToObject<float>() ?? 100f));

            string[] lines =
            {
                "Активно: <b>" + heldName + "</b>",
                "Правая рука: <b>" + (!string.IsNullOrEmpty(weaponId) && weaponId != "fists" ? ItemName(weaponId) : "пусто") + "</b>",
                "Левая рука: <b>" + (!string.IsNullOrEmpty(offhandId) ? ItemName(offhandId) : "пусто") + "</b>",
                "Урон: <b>" + weapon.DmgMin + "-" + weapon.DmgMax + "</b>",
                "Дальность: <b>" + RoaGearData.Range(heldId).ToString("0.##") + "</b>",
                "Патроны: <b>" + ammoText + "</b>",
                "Броня: <b>" + (Hud != null ? Hud.ArmorThreshold : 0) + "</b>",
                "СИЛА: <b>" + power + "</b>",
                "Скорость: <b>" + speed.ToString("0.0") + "</b>",
                "Вес: <b>" + (Inventory != null ? Inventory.CarryWeight.ToString("0.#") + "/" + Inventory.CarryCapacity.ToString("0") : "—") + "</b>",
                "Обзор: <b>" + vision + " кл.</b>",
                "ОД: <b>" + (Hud != null ? Hud.MaxAp : (self["maxAp"]?.ToObject<int>() ?? 0)) + "</b>",
                "Фракция: <b>" + faction + "</b>",
                "Свободные очки навыков: <b>" + (self["skillPoints"]?.ToObject<int>() ?? 0) + "</b>",
                "Свободные перки: <b>" + (self["talentPoints"]?.ToObject<int>() ?? self["perkPoints"]?.ToObject<int>() ?? 0) + "</b>",
                "Навыки выше базы: <b>" + skillsAboveBase + "</b>",
                "Изучено перков: <b>" + learnedPerks + "</b>"
            };
            for (int i = 0; i < _statLines.Count && i < lines.Length; i++)
                _statLines[i].text = lines[i].Replace("<b>", "<b><color=#d3ee8a>").Replace("</b>", "</color></b>");

            JObject injuries = self["injuries"] as JObject;
            var names = new List<string>();
            if (injuries?["brokenArm"]?.ToObject<bool>() == true) names.Add("перелом руки");
            if (injuries?["brokenLeg"]?.ToObject<bool>() == true) names.Add("перелом ноги");
            if (injuries?["concussion"]?.ToObject<bool>() == true) names.Add("сотрясение");
            if (injuries?["infection"]?.ToObject<bool>() == true) names.Add("инфекция");
            _injuryBody.text = names.Count > 0 ? string.Join(" · ", names) : "Травм нет.";
        }

        private void BuildItemsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Items, parent);
            SectionTitle(page, "ITEMS");

            // Слева — панель персонажа (inventory-character-panel): шапка, модель, слоты вокруг.
            RectTransform panel = Panel_(page, PlateBg, PlateBorder);
            Place_(panel, 0f, 0f, 0.30f, 1f, new Vector2(0f, 4f), new Vector2(-6f, -34f));
            Text modelLabel = Label("ModelLabel", panel, 10, TextAnchor.UpperLeft, ScreenInkDim, FontStyle.Bold);
            modelLabel.text = "МОДЕЛЬ";
            Place_(modelLabel.rectTransform, 0f, 1f, 0.6f, 1f, new Vector2(10f, -20f), new Vector2(0f, -8f));
            _itemsPanelName = Label("Name", panel, 13, TextAnchor.UpperLeft, PlateName, FontStyle.Bold);
            _itemsPanelName.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(_itemsPanelName.rectTransform, 0f, 1f, 0.7f, 1f, new Vector2(10f, -38f), new Vector2(0f, -20f));
            _itemsPanelSlots = Label("Slots", panel, 9, TextAnchor.UpperRight, ScreenInkDim);
            Place_(_itemsPanelSlots.rectTransform, 0.5f, 1f, 1f, 1f, new Vector2(0f, -20f), new Vector2(-10f, -8f));

            RectTransform stage = Child("Stage", panel);
            Place_(stage, 0f, 0f, 1f, 1f, new Vector2(6f, 6f), new Vector2(-6f, -44f));
            _itemsModel = stage.gameObject.AddComponent<RawImage>();
            _itemsModel.color = Color.white;
            _itemsModel.raycastTarget = false;
            _itemsModel.enabled = false;

            string[] leftSlots = { "weapon", "armor", "boots" };
            string[] rightSlots = { "offhand", "helmet", "backpack" };
            string[] leftTitles = { "Правая рука", "Корпус", "Ноги" };
            string[] rightTitles = { "Левая рука", "Голова", "Спина" };
            for (int i = 0; i < 3; i++)
            {
                BuildItemsSlot(stage, leftSlots[i], leftTitles[i], true, i);
                BuildItemsSlot(stage, rightSlots[i], rightTitles[i], false, i);
            }

            // Справа — вес, список, действия.
            _carryLine = Label("Carry", page, 14, TextAnchor.MiddleLeft, ScreenInk, FontStyle.Bold);
            _carryLine.rectTransform.anchorMin = new Vector2(0.31f, 1f);
            _carryLine.rectTransform.anchorMax = new Vector2(1f, 1f);
            _carryLine.rectTransform.pivot = new Vector2(0.5f, 1f);
            _carryLine.rectTransform.offsetMin = new Vector2(0f, -58f);
            _carryLine.rectTransform.offsetMax = new Vector2(-4f, -34f);

            // Кнопка «Сортировать · по типу» справа от строки веса (inventory-sort-btn).
            Button sort = TextButton("Sort", page, "Сортировать", 12, out _sortLabel);
            var sortRect = (RectTransform)sort.transform;
            sortRect.anchorMin = new Vector2(1f, 1f);
            sortRect.anchorMax = new Vector2(1f, 1f);
            sortRect.pivot = new Vector2(1f, 1f);
            sortRect.anchoredPosition = new Vector2(-4f, -34f);
            sortRect.sizeDelta = new Vector2(190f, 24f);
            sort.GetComponent<Image>().color = new Color(0.13f, 0.22f, 0.11f, 0.95f);
            sort.onClick.AddListener(() =>
            {
                _sortMode = _sortMode == "type" ? "weight" : "type";
                _refreshAt = 0f;
            });
            _carryLine.rectTransform.offsetMax = new Vector2(-200f, -34f);

            // Вкладки категорий (#inventory-category-tabs).
            _categoryTabs = Child("CategoryTabs", page);
            _categoryTabs.anchorMin = new Vector2(0.31f, 1f);
            _categoryTabs.anchorMax = new Vector2(1f, 1f);
            _categoryTabs.offsetMin = new Vector2(0f, -88f);
            _categoryTabs.offsetMax = new Vector2(-4f, -62f);
            var tabsLayout = _categoryTabs.gameObject.AddComponent<HorizontalLayoutGroup>();
            tabsLayout.spacing = 5f;
            tabsLayout.childForceExpandWidth = false;
            tabsLayout.childForceExpandHeight = true;
            tabsLayout.childControlWidth = true;
            tabsLayout.childControlHeight = true;
            foreach (RoaItemCategories.Tab tab in RoaItemCategories.Tabs)
            {
                Button button = TextButton("Tab:" + tab.Id, _categoryTabs, tab.Label, 11, out Text label);
                button.gameObject.AddComponent<LayoutElement>().preferredWidth = 12f + tab.Label.Length * 8f;
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

            // Быстрый доступ 1–8 (mobile-inventory-quickbar в web): выбрать предмет → нажать слот.
            _quickHint = Label("QuickHint", page, 9, TextAnchor.MiddleLeft, ScreenInkDim, FontStyle.Bold);
            _quickHint.text = "БЫСТРЫЙ ДОСТУП: ВЫБЕРИТЕ ПРЕДМЕТ И НАЖМИТЕ СЛОТ 1–8";
            Place_(_quickHint.rectTransform, 0.31f, 1f, 1f, 1f, new Vector2(2f, -104f), new Vector2(-4f, -92f));
            for (int i = 0; i < RoaQuickbar.SlotCount; i++)
            {
                Button slot = TextButton("Quick" + (i + 1), page, (i + 1) + "\n—", 9, out Text label);
                var srect = (RectTransform)slot.transform;
                srect.anchorMin = new Vector2(0.31f, 1f);
                srect.anchorMax = new Vector2(0.31f, 1f);
                srect.pivot = new Vector2(0f, 1f);
                srect.anchoredPosition = new Vector2(i * 52f, -106f);
                srect.sizeDelta = new Vector2(48f, 40f);
                slot.GetComponent<Image>().color = new Color(0.016f, 0.055f, 0.031f, 0.58f);
                var outline = slot.gameObject.AddComponent<Outline>();
                outline.effectColor = SlotBorder;
                outline.effectDistance = new Vector2(1f, -1f);
                label.color = ScreenInkDim;
                int index = i;
                slot.onClick.AddListener(() => OnQuickSlotClicked(index));
                _quickSlots.Add((slot, label));
            }

            RectTransform scrollArea = Child("Scroll", page);
            scrollArea.anchorMin = new Vector2(0.31f, 0f);
            scrollArea.anchorMax = new Vector2(1f, 1f);
            scrollArea.offsetMin = new Vector2(0f, 64f);
            scrollArea.offsetMax = new Vector2(-4f, -150f);

            _categoryEmpty = Label("CategoryEmpty", scrollArea, 13, TextAnchor.MiddleCenter, ScreenInkDim);
            _categoryEmpty.rectTransform.anchorMin = new Vector2(0f, 1f);
            _categoryEmpty.rectTransform.anchorMax = new Vector2(1f, 1f);
            _categoryEmpty.rectTransform.offsetMin = new Vector2(8f, -60f);
            _categoryEmpty.rectTransform.offsetMax = new Vector2(-8f, -8f);
            _categoryEmpty.gameObject.SetActive(false);
            var scrollImage = scrollArea.gameObject.AddComponent<Image>();
            scrollImage.color = new Color(0f, 0f, 0f, 0.25f);
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            var mask = scrollArea.gameObject.AddComponent<RectMask2D>();

            _itemsGrid = Child("Grid", scrollArea);
            _itemsGrid.anchorMin = new Vector2(0f, 1f);
            _itemsGrid.anchorMax = new Vector2(1f, 1f);
            // Pivot строго в левый верх: с центральным pivot контент, чуть
            // переросший viewport, съезжал влево и резал первую колонку.
            _itemsGrid.pivot = new Vector2(0f, 1f);
            _itemsGrid.sizeDelta = Vector2.zero; // иначе контейнер на 100 px шире области прокрутки
            var grid = _itemsGrid.gameObject.AddComponent<GridLayoutGroup>();
            grid.cellSize = new Vector2(112f, 96f); // .inv-card: арт 42px, имя по центру, вес/кол-во по углам
            grid.childAlignment = TextAnchor.UpperLeft;
            grid.spacing = new Vector2(8f, 8f);
            grid.padding = new RectOffset(8, 8, 8, 8);
            var fitter = _itemsGrid.gameObject.AddComponent<ContentSizeFitter>();
            fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = _itemsGrid;

            // Панель действий под списком.
            RectTransform actions = Child("Actions", page);
            actions.anchorMin = new Vector2(0.31f, 0f);
            actions.anchorMax = new Vector2(1f, 0f);
            actions.pivot = new Vector2(0.5f, 0f);
            actions.offsetMin = new Vector2(0f, 0f);
            actions.offsetMax = new Vector2(-4f, 58f);

            _selectedTitle = Label("Selected", actions, 13, TextAnchor.UpperLeft, ScreenInkDim);
            _selectedTitle.rectTransform.anchorMin = new Vector2(0f, 0.55f);
            _selectedTitle.rectTransform.anchorMax = new Vector2(1f, 1f);
            _selectedTitle.rectTransform.offsetMin = new Vector2(2f, 0f);
            _selectedTitle.rectTransform.offsetMax = Vector2.zero;

            _equipButton = ActionButton(actions, 0f, "Экипировать", out _equipLabel, OnEquipClicked);
            _useButton = ActionButton(actions, 0.26f, "Использовать", out _, OnUseClicked);
            _dropButton = ActionButton(actions, 0.52f, "Выбросить", out _, OnDropClicked);
            _modifyButton = ActionButton(actions, 0.78f, "Модификация", out _, OnModifyClicked);

            _itemsStatus = Label("Status", actions, 12, TextAnchor.LowerRight, ScreenInkDim);
            _itemsStatus.rectTransform.anchorMin = new Vector2(0.55f, 0f);
            _itemsStatus.rectTransform.anchorMax = new Vector2(1f, 0.5f);
            _itemsStatus.rectTransform.offsetMin = Vector2.zero;
            _itemsStatus.rectTransform.offsetMax = Vector2.zero;
        }

        private Button ActionButton(RectTransform parent, float left, string caption,
                                    out Text label, UnityEngine.Events.UnityAction onClick)
        {
            Button button = TextButton("Action:" + caption, parent, caption, 13, out label);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = new Vector2(left, 0f);
            rect.anchorMax = new Vector2(left + 0.24f, 0.5f);
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
                    Chip("WG", Inventory.CarryWeight.ToString("0.0") + "/" + Inventory.CarryCapacity.ToString("0"))
                    + Chip("HP", Hud.Hp + "/" + Mathf.Max(1, Hud.MaxHp))
                    + Chip("AP", Mathf.FloorToInt(Hud.Ap) + "/" + Mathf.Max(1, Hud.MaxAp))
                    + Chip("DT", Hud.ArmorThreshold.ToString())
                    + Chip("Caps", CapsCount().ToString())
                    + Chip("УРОВЕНЬ", Hud.Level.ToString());
            }

            switch (_page)
            {
                case Page.Status: RefreshStatus(self); break;
                case Page.Items: RefreshItems(); break;
                case Page.Skills: RefreshSkills(self); break;
                case Page.Perks: RefreshPerks(self); break;
                case Page.Craft: RefreshCraft(); break;
                case Page.Quests: RefreshQuests(self); break;
                case Page.World: RefreshWorld(); break;
                case Page.Factions: RefreshFactions(self); break;
                case Page.Friends: RefreshFriends(); break;
                case Page.Clan: RefreshClan(); break;
                case Page.Radio: RefreshRadio(); break;
            }
        }

        private static string Chip(string label, string value)
        {
            return "<color=#6f9c5a>" + label + "</color> <color=#d8f5b8>" + value + "</color>    ";
        }

        private int CapsCount()
        {
            if (Inventory == null) return 0;
            foreach (RoaInventory.Row row in Inventory.Items)
                if (row.Id == "silver") return row.Qty;
            return 0;
        }

        private void AppendEquipment(System.Text.StringBuilder into)
        {
            if (Inventory == null) return;
            foreach ((string slot, string title) in new[]
            {
                ("weapon", "Оружие"), ("offhand", "Втор. рука"), ("armor", "Броня"),
                ("helmet", "Шлем"), ("boots", "Ботинки"), ("backpack", "Рюкзак")
            })
            {
                string runtimeId;
                Inventory.EquipmentSlots.TryGetValue(slot, out runtimeId);
                string baseId = RoaArmorData.BaseId(runtimeId ?? string.Empty);
                string name = string.IsNullOrEmpty(baseId) || baseId == "fists"
                    ? "<color=#557a46>—</color>"
                    : ItemName(baseId);
                into.AppendLine(title.PadRight(11) + name);
            }
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
            if (_itemsPreview != null) _itemsPreview.SetVisible(true);

            _carryLine.text = "Вес: " + Inventory.CarryWeight.ToString("0.0")
                + " / " + Inventory.CarryCapacity.ToString("0") + " кг";

            RefreshItemsPanel();

            foreach (GameObject card in _itemCards) Destroy(card);
            _itemCards.Clear();

            _sortLabel.text = "Сортировать · " + (_sortMode == "weight" ? "по весу" : "по типу");

            // Полный список (надетое первым, как в web), затем доступность категорий.
            var all = new List<RoaInventory.Row>();
            var shown = new HashSet<string>();
            foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
            {
                string baseId = RoaArmorData.BaseId(slot.Value);
                if (string.IsNullOrEmpty(baseId) || baseId == "fists" || !shown.Add(baseId)) continue;
                all.Add(new RoaInventory.Row { Id = baseId, Qty = 1 });
            }
            int equippedCount = all.Count;
            var rest = new List<RoaInventory.Row>();
            foreach (RoaInventory.Row row in Inventory.Items)
            {
                if (row.Qty <= 0 || !shown.Add(row.Id)) continue;
                rest.Add(row);
            }
            if (_sortMode == "weight")
                rest.Sort((a, b) =>
                {
                    float aw = RoaItemData.Weight(a.Id) * a.Qty, bw = RoaItemData.Weight(b.Id) * b.Qty;
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
            all.AddRange(rest);

            var available = new HashSet<string>();
            foreach (RoaInventory.Row row in all) available.Add(RoaItemCategories.Category(row.Id));
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

            bool selectedStillOwned = false;
            int visible = 0;
            foreach (RoaInventory.Row row in all)
            {
                if (!RoaItemCategories.Matches(row.Id, _activeCategory)) continue;
                if (row.Id == _selectedItemId) selectedStillOwned = true;
                _itemCards.Add(BuildItemCard(row));
                visible++;
            }
            _categoryEmpty.gameObject.SetActive(visible == 0 && _activeCategory != "all");
            _categoryEmpty.text = "В разделе «" + RoaItemCategories.Label(_activeCategory) + "» пока пусто.";

            if (!selectedStillOwned) _selectedItemId = string.Empty;
            RefreshSelection();
        }

        private void BuildItemsSlot(RectTransform stage, string slot, string title, bool left, int index)
        {
            Button button = TextButton("Slot:" + slot, stage, string.Empty, 9, out Text _);
            var rect = (RectTransform)button.transform;
            rect.anchorMin = new Vector2(left ? 0f : 1f, 1f);
            rect.anchorMax = new Vector2(left ? 0f : 1f, 1f);
            rect.pivot = new Vector2(left ? 0f : 1f, 1f);
            rect.anchoredPosition = new Vector2(left ? 2f : -2f, -8f - index * 74f);
            rect.sizeDelta = new Vector2(92f, 64f);
            button.GetComponent<Image>().color = SlotBg;
            var outline = button.gameObject.AddComponent<Outline>();
            outline.effectColor = SlotBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            // Правый клик по слоту — showEquippedItemContextMenu web (03d:265); подсказка — по надетому предмету.
            string slotId = slot;
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

            RectTransform artRect = Child("Art", rect);
            artRect.anchorMin = artRect.anchorMax = new Vector2(0.5f, 1f);
            artRect.pivot = new Vector2(0.5f, 1f);
            artRect.anchoredPosition = new Vector2(0f, -4f);
            artRect.sizeDelta = new Vector2(26f, 26f);
            var art = artRect.gameObject.AddComponent<RawImage>();
            art.raycastTarget = false;
            Text empty = Label("Empty", rect, 14, TextAnchor.UpperCenter, ScreenInkDim);
            empty.text = "—";
            Place_(empty.rectTransform, 0f, 1f, 1f, 1f, new Vector2(0f, -30f), new Vector2(0f, -6f));
            Text name = Label("Name", rect, 9, TextAnchor.UpperCenter, SlotName);
            name.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(name.rectTransform, 0f, 0f, 1f, 1f, new Vector2(3f, 12f), new Vector2(-3f, -32f));
            Text type = Label("Type", rect, 8, TextAnchor.LowerCenter, ScreenInkDim);
            type.text = title.ToUpperInvariant();
            Place_(type.rectTransform, 0f, 0f, 1f, 0f, new Vector2(2f, 2f), new Vector2(-2f, 13f));

            button.onClick.AddListener(() => OnItemsSlotClicked(slotId));
            _itemsSlots[slot] = (button, art, name, type, empty);
        }

        private void OnItemsSlotClicked(string slot)
        {
            if (Inventory == null) return;
            Inventory.EquipmentSlots.TryGetValue(slot, out string current);
            string currentBase = RoaArmorData.BaseId(current ?? string.Empty);
            // Выбран подходящий предмет — надеть; иначе клик по занятому слоту снимает (equip-clear ×).
            if (!string.IsNullOrEmpty(_selectedItemId) && RoaInventory.SlotFor(_selectedItemId) == slot && _selectedItemId != currentBase)
            {
                Submit(Inventory.SubmitEquipmentAction(slot, _selectedItemId, OnActionAck), "Экипирую…");
                return;
            }
            if (!string.IsNullOrEmpty(currentBase) && currentBase != "fists")
                Submit(Inventory.SubmitEquipmentAction(slot, string.Empty, OnActionAck), "Снимаю…");
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
            int filled = 0;
            foreach (KeyValuePair<string, (Button button, RawImage art, Text name, Text type, Text empty)> entry in _itemsSlots)
            {
                Inventory.EquipmentSlots.TryGetValue(entry.Key, out string runtimeId);
                string baseId = RoaArmorData.BaseId(runtimeId ?? string.Empty);
                bool has = !string.IsNullOrEmpty(baseId) && baseId != "fists";
                if (has) filled++;
                entry.Value.art.texture = has ? RoaItemCategories.Art(baseId) : null;
                entry.Value.art.enabled = has && entry.Value.art.texture != null;
                entry.Value.empty.gameObject.SetActive(!has);
                entry.Value.name.text = has ? ItemName(baseId) : "Пусто";
                bool highlight = !string.IsNullOrEmpty(_selectedItemId) && RoaInventory.SlotFor(_selectedItemId) == entry.Key;
                entry.Value.button.gameObject.GetComponent<Outline>().effectColor = highlight ? AccentWarm : SlotBorder;
            }
            _itemsPanelSlots.text = filled + "/6 СЛОТОВ";

            // Модель персонажа с экипировкой — как pipboy-character-model в web.
            if (_itemsPreview == null)
            {
                _itemsPreview = gameObject.AddComponent<RoaCharacterPreview>();
                _itemsPreview.FieldOfView = 40f;
            }
            JObject appearance = self?["appearance"] as JObject;
            if (appearance != null)
            {
                var rect = (RectTransform)_itemsModel.transform;
                _itemsPreview.Show(RoaGameBootstrap.ActiveBaseUrl, appearance.ToObject<CharacterAppearance>(),
                    Mathf.Max(64, Mathf.RoundToInt(rect.rect.width)), Mathf.Max(64, Mathf.RoundToInt(rect.rect.height)));
                var equipment = new JObject();
                foreach (KeyValuePair<string, string> slot in Inventory.EquipmentSlots)
                    equipment[slot.Key] = RoaArmorData.BaseId(slot.Value ?? string.Empty);
                if (string.IsNullOrEmpty(equipment["weapon"]?.ToString())) equipment["weapon"] = "fists";
                _itemsPreview.ApplyEquipment(RoaGameBootstrap.ActiveBaseUrl, equipment);
                if (_itemsModel.texture != _itemsPreview.Texture) _itemsModel.texture = _itemsPreview.Texture;
                _itemsModel.enabled = _itemsPreview.Texture != null;
            }

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

        private GameObject BuildItemCard(RoaInventory.Row row)
        {
            var card = new GameObject("Item:" + row.Id, typeof(RectTransform));
            card.transform.SetParent(_itemsGrid, false);
            var image = card.AddComponent<Image>();
            bool equipped = IsEquippedBase(row.Id);
            image.color = row.Id == _selectedItemId ? CardSelected : CardBg;
            var outline = card.AddComponent<Outline>();
            outline.effectColor = equipped ? AccentWarm : ScreenBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            var rect = (RectTransform)card.transform;

            // .inv-tag — слева сверху: ЭКИПИРОВАНО или «быстр.».
            bool quickable = Inventory.IsQuickAssignable(row.Id);
            if (equipped || quickable)
            {
                Text tag = Label("Tag", rect, 9, TextAnchor.UpperLeft, equipped ? new Color(0.573f, 0.776f, 0.427f, 1f) : ScreenInkDim);
                tag.rectTransform.anchorMin = new Vector2(0f, 1f);
                tag.rectTransform.anchorMax = new Vector2(0.7f, 1f);
                tag.rectTransform.offsetMin = new Vector2(4f, -16f);
                tag.rectTransform.offsetMax = new Vector2(0f, -3f);
                tag.text = equipped ? "ЭКИПИРОВАНО" : "быстр.";
            }

            // .inv-weight — справа сверху.
            float weight = RoaItemData.Weight(row.Id) * row.Qty;
            Text weightText = Label("Weight", rect, 9, TextAnchor.UpperRight, AccentWarm, FontStyle.Bold);
            weightText.rectTransform.anchorMin = new Vector2(0.5f, 1f);
            weightText.rectTransform.anchorMax = new Vector2(1f, 1f);
            weightText.rectTransform.offsetMin = new Vector2(0f, -16f);
            weightText.rectTransform.offsetMax = new Vector2(-5f, -3f);
            weightText.text = weight.ToString("0.0") + " кг";

            // .inv-emoji — арт 42px по центру.
            RectTransform artRect = Child("Art", rect);
            artRect.anchorMin = artRect.anchorMax = new Vector2(0.5f, 1f);
            artRect.pivot = new Vector2(0.5f, 1f);
            artRect.anchoredPosition = new Vector2(0f, -16f);
            artRect.sizeDelta = new Vector2(42f, 42f);
            var art = artRect.gameObject.AddComponent<RawImage>();
            art.texture = RoaItemCategories.Art(row.Id);
            art.raycastTarget = false;
            art.enabled = art.texture != null;

            // .inv-name — по центру под артом.
            Text name = Label("Name", rect, 10, TextAnchor.UpperCenter, new Color(0.788f, 0.91f, 0.514f, 1f));
            name.rectTransform.anchorMin = new Vector2(0f, 0f);
            name.rectTransform.anchorMax = new Vector2(1f, 1f);
            name.rectTransform.offsetMin = new Vector2(4f, 4f);
            name.rectTransform.offsetMax = new Vector2(-4f, -60f);
            name.horizontalOverflow = HorizontalWrapMode.Wrap;
            name.verticalOverflow = VerticalWrapMode.Truncate;
            name.text = ItemName(row.Id);

            // .inv-count — справа снизу для стопок.
            string category = RoaItemCategories.Category(row.Id);
            if (row.Qty > 1 || category == "ammo" || category == "materials" || row.Id == "silver")
            {
                Text count = Label("Count", rect, 11, TextAnchor.LowerRight, AccentWarm, FontStyle.Bold);
                count.rectTransform.anchorMin = new Vector2(0.5f, 0f);
                count.rectTransform.anchorMax = new Vector2(1f, 0f);
                count.rectTransform.offsetMin = new Vector2(0f, 2f);
                count.rectTransform.offsetMax = new Vector2(-5f, 16f);
                count.text = row.Qty.ToString();
            }

            var button = card.AddComponent<Button>();
            button.targetGraphic = image;
            string id = row.Id;
            button.onClick.AddListener(() =>
            {
                _selectedItemId = id;
                _refreshAt = 0f;
            });
            // Подсказка (showTooltip) и контекстное меню правой кнопкой (showItemContextMenu web 03d:229).
            RoaItemPopups.Bind(card, id, ItemExtraStat(id));
            RoaItemPopups.BindMenu(card, () => { _selectedItemId = id; _refreshAt = 0f; return BuildItemContextOptions(id); });
            return card;
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

        private bool IsEquippedBase(string baseId)
        {
            if (Inventory == null) return false;
            foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                if (RoaArmorData.BaseId(entry.Value) == baseId) return true;
            return false;
        }

        private void RefreshSelection()
        {
            bool hasSelection = !string.IsNullOrEmpty(_selectedItemId);
            _selectedTitle.text = hasSelection
                ? "Выбрано: " + ItemName(_selectedItemId)
                : "Выберите предмет, чтобы действовать.";

            bool equipped = hasSelection && IsEquippedBase(_selectedItemId);
            _equipButton.gameObject.SetActive(hasSelection);
            _useButton.gameObject.SetActive(hasSelection && Inventory.IsQuickAssignable(_selectedItemId));
            _dropButton.gameObject.SetActive(hasSelection && !equipped);
            _modifyButton.gameObject.SetActive(hasSelection && RoaWeaponModificationData.IsFirearm(_selectedItemId));
            _equipLabel.text = equipped ? "Снять" : "Экипировать";
        }

        private void OnEquipClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;

            if (IsEquippedBase(_selectedItemId))
            {
                foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                {
                    if (RoaArmorData.BaseId(entry.Value) != _selectedItemId) continue;
                    Submit(Inventory.SubmitEquipmentAction(entry.Key, string.Empty, OnActionAck), "Снимаю…");
                    return;
                }
                return;
            }

            string slot = RoaInventory.SlotFor(_selectedItemId);
            if (slot == null) { _itemsStatus.text = "Этот предмет не экипируется."; return; }
            Submit(Inventory.SubmitEquipmentAction(slot, _selectedItemId, OnActionAck), "Экипирую…");
        }

        private Button _modifyButton;

        /// <summary>Контекстное «Модификация» web (03d:250): только огнестрел.</summary>
        private void OnModifyClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            string runtimeId = _selectedItemId;
            foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                if (RoaArmorData.BaseId(entry.Value) == _selectedItemId) runtimeId = entry.Value;
            if (Inventory.OpenWorkbench(runtimeId)) Close();
            else _itemsStatus.text = Inventory.ActionStatus;
        }

        /// <summary>Динамическая часть строки характеристик: состояние и магазин, как itemStatLine web.</summary>
        private string ItemExtraStat(string baseId)
        {
            var parts = new List<string>();
            if (Inventory != null && (Inventory.IsRepairable(baseId)))
                parts.Add("состояние " + Mathf.RoundToInt(Inventory.ConditionPercent(baseId)) + "%");
            return parts.Count > 0 ? string.Join(" · ", parts) : null;
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
                bool intact = Inventory.ConditionPercent(baseId) >= 99.995f;
                options.Add(new RoaItemPopups.Option(intact ? "Починить (целый)" : "Починить", () => { Inventory.ItemAction("repair", runtimeId); Submit(true, "Ремонтирую…"); }, intact));
            }
            if (Quickbar != null && Inventory.IsQuickAssignable(baseId))
                for (int i = 0; i < Mathf.Min(4, Quickbar.Slots.Count); i++) { int idx = i; options.Add(new RoaItemPopups.Option("В быстрый доступ " + (i + 1), () => { Quickbar.Assign(idx, baseId); _refreshAt = 0f; })); }
            return options;
        }

        /// <summary>Пункты showItemContextMenu web (03d:229) в том же порядке.</summary>
        private List<RoaItemPopups.Option> BuildItemContextOptions(string baseId)
        {
            var options = new List<RoaItemPopups.Option>();
            if (Inventory == null) return options;
            RoaItemInfo.Row info = RoaItemInfo.Get(baseId);
            string equippedSlot = null, equippedRuntime = null;
            foreach (KeyValuePair<string, string> entry in Inventory.EquipmentSlots)
                if (!string.IsNullOrEmpty(entry.Value) && RoaArmorData.BaseId(entry.Value) == baseId) { equippedSlot = entry.Key; equippedRuntime = entry.Value; }
            string equipSlot = RoaInventory.SlotFor(baseId);

            if (equippedSlot != null)
            {
                string slotCaptured = equippedSlot;
                bool hand = slotCaptured == "weapon" || slotCaptured == "offhand";
                options.Add(new RoaItemPopups.Option(hand ? "Снять из " + (slotCaptured == "weapon" ? "правой руки" : "левой руки") : "Снять",
                    () => Submit(Inventory.SubmitEquipmentAction(slotCaptured, string.Empty, OnActionAck), "Снимаю…")));
            }
            else if (equipSlot == "weapon")
            {
                if (info != null && info.Hands == 2)
                    options.Add(new RoaItemPopups.Option("В обе руки", () => Submit(Inventory.SubmitEquipmentAction("weapon", baseId, OnActionAck), "Экипирую…")));
                else
                {
                    options.Add(new RoaItemPopups.Option("В правую руку", () => Submit(Inventory.SubmitEquipmentAction("weapon", baseId, OnActionAck), "Экипирую…")));
                    options.Add(new RoaItemPopups.Option("В левую руку", () => Submit(Inventory.SubmitEquipmentAction("offhand", baseId, OnActionAck), "Экипирую…")));
                }
            }
            else if (equipSlot != null)
                options.Add(new RoaItemPopups.Option("Надеть", () => Submit(Inventory.SubmitEquipmentAction(equipSlot, baseId, OnActionAck), "Экипирую…")));

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
                string rt = equippedRuntime ?? baseId;
                bool intact = Inventory.ConditionPercent(baseId) >= 99.995f;
                options.Add(new RoaItemPopups.Option(intact ? "Починить (целый)" : "Починить", () => { Inventory.ItemAction("repair", rt); Submit(true, "Ремонтирую…"); }, intact));
            }
            if (Inventory.IsSalvageable(baseId))
                options.Add(new RoaItemPopups.Option("Разобрать", () => { Inventory.ItemAction("salvage", baseId); Submit(true, "Разбираю…"); }));
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
                () => Submit(Inventory.SubmitDropItem(baseId, 1, OnActionAck), "Бросаю…"), cantDrop));
            return options;
        }

        private void OnUseClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            Submit(Inventory.ActivateQuickItem(_selectedItemId, Combat), "Использую…");
        }

        private void OnDropClicked()
        {
            if (string.IsNullOrEmpty(_selectedItemId) || Inventory == null) return;
            Submit(Inventory.SubmitDropItem(_selectedItemId, 1, OnActionAck), "Бросаю…");
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

        private void AddListRow(List<GameObject> rows, RectTransform list, string text,
                                string description, string buttonCaption, System.Action onClick)
        {
            var row = new GameObject("Row", typeof(RectTransform));
            row.transform.SetParent(list, false);
            var layout = row.AddComponent<LayoutElement>();
            layout.preferredHeight = description != null && description.Contains("\n") ? 58f : 44f;
            var back = row.AddComponent<Image>();
            back.color = CardBg;

            Text main = Label("Text", (RectTransform)row.transform, 14, TextAnchor.UpperLeft, ScreenInk, FontStyle.Bold);
            main.rectTransform.anchorMin = new Vector2(0f, 0.45f);
            main.rectTransform.anchorMax = new Vector2(0.86f, 1f);
            main.rectTransform.offsetMin = new Vector2(8f, 0f);
            main.rectTransform.offsetMax = Vector2.zero;
            main.text = text;

            Text info = Label("Info", (RectTransform)row.transform, 11, TextAnchor.UpperLeft, ScreenInkDim);
            info.rectTransform.anchorMin = new Vector2(0f, 0f);
            info.rectTransform.anchorMax = new Vector2(0.86f, 0.5f);
            info.rectTransform.offsetMin = new Vector2(8f, 2f);
            info.rectTransform.offsetMax = Vector2.zero;
            info.text = description ?? string.Empty;

            if (buttonCaption != null)
            {
                Button plus = TextButton("Plus", (RectTransform)row.transform, buttonCaption, 14, out Text plusText);
                var rect = (RectTransform)plus.transform;
                rect.anchorMin = new Vector2(0.88f, 0.2f);
                rect.anchorMax = new Vector2(0.99f, 0.8f);
                rect.offsetMin = Vector2.zero;
                rect.offsetMax = Vector2.zero;
                plus.GetComponent<Image>().color = new Color(0.16f, 0.28f, 0.12f, 0.95f);
                plusText.color = AccentWarm;
                plus.interactable = Pipboy == null || !Pipboy.ProgressionPending;
                plus.onClick.AddListener(() => { onClick(); _refreshAt = Time.unscaledTime + 0.3f; });
            }

            rows.Add(row);
        }

        private void BuildCraftPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Craft, parent);
            SectionTitle(page, "CRAFT");
            _craftList = ListArea(page, out _);

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
            station.text = pending ? "Сервер создаёт предмет…" : (stationNear
                ? RoaCraftingData.StationLabel(recipe.Station) + " рядом · комиссия " + recipe.Fee
                : "нужен станок: " + RoaCraftingData.StationLabel(recipe.Station) + " · комиссия " + recipe.Fee);

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
                ["recipeId"] = recipe.Id,
                ["station"] = recipe.Station,
                ["fee"] = recipe.Fee,
                ["locationId"] = Socket.Session != null ? Socket.Session.LocationId : string.Empty,
                ["stationObjectId"] = stationObjectId
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
                _craftStatus.text = "Создано: " + ItemName(outId) + " ×" + outQty + ".";
            });
        }

        // ------------------------------------------------------------------
        // QUESTS — pipboy-quest-grid (03a_pipboy_social_world_tasks.js:1875)
        // ------------------------------------------------------------------

        private void BuildQuestsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Quests, parent);
            SectionTitle(page, "QUESTS");
            _questsList = ListArea(page, out _);
        }

        private void RefreshQuests(JObject self)
        {
            RebuildRows(_questRows, _questsList, () =>
            {
                if (Interaction == null)
                {
                    AddTextCard(_questRows, _questsList, "Заданий нет", "Нет связи с миром.");
                    return;
                }
                Interaction.EnsureWorldState();
                // Как renderPipboyInfoPanels web: секции «Активные» и «Выполненные»,
                // внутри — карточки работ пустоши (pipboyWorldTaskCard).
                AddSectionTitle(_questRows, _questsList, "Активные");
                List<RoaInteraction.WorldTaskCard> active = Interaction.PipboyWorldTasks(true);
                if (active.Count == 0) AddTextCard(_questRows, _questsList, "Нет активных заданий.", "Возьмите работу у доски поселения.");
                foreach (RoaInteraction.WorldTaskCard card in active) AddWorldTaskCard(card);
                AddSectionTitle(_questRows, _questsList, "Выполненные");
                List<RoaInteraction.WorldTaskCard> done = Interaction.PipboyWorldTasks(false);
                if (done.Count == 0) AddTextCard(_questRows, _questsList, "Выполненных заданий пока нет.", string.Empty);
                foreach (RoaInteraction.WorldTaskCard card in done) AddWorldTaskCard(card);
            });
        }

        private void AddWorldTaskCard(RoaInteraction.WorldTaskCard card)
        {
            var body = new System.Text.StringBuilder();
            if (!string.IsNullOrEmpty(card.Text)) body.Append(card.Text);
            if (!string.IsNullOrEmpty(card.Route)) body.Append('\n').Append(card.Route);
            if (!string.IsNullOrEmpty(card.Reward)) body.Append('\n').Append(card.Reward);
            if (!string.IsNullOrEmpty(card.JoinHint)) body.Append('\n').Append(card.JoinHint);
            if (!string.IsNullOrEmpty(card.AcceptHint)) body.Append('\n').Append(card.AcceptHint);

            var actions = new List<(string, System.Action)>();
            string id = card.Id;
            if (card.AcceptLabel != null)
                actions.Add((card.AcceptLabel, card.CanAccept ? (System.Action)(() => Interaction.PipboyWorldTaskAction(id, "accept")) : null));
            if (card.TrackLabel != null) actions.Add((card.TrackLabel, () => Interaction.PipboyWorldTaskAction(id, "track")));
            if (card.CanCancel) actions.Add(("Отменить", () => Interaction.PipboyWorldTaskAction(id, "cancel")));
            if (card.CanClaim) actions.Add(("Забрать награду", () => Interaction.PipboyWorldTaskAction(id, "claim")));

            AddTextCard(_questRows, _questsList, card.Label.ToUpperInvariant() + "  " + card.Title, body.ToString(), actions);
        }

        // ------------------------------------------------------------------
        // WORLD — pipboy-world-grid (03a:682): сводка, поселения, точки, группы, события
        // ------------------------------------------------------------------

        private void BuildWorldPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.World, parent);
            SectionTitle(page, "WORLD");
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
            int emLines = string.IsNullOrEmpty(em) ? 0 : Mathf.Max(1, Mathf.CeilToInt(em.Length / 80f));
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

        /// <summary>.pipboy-faction-card: цветная полоса, kicker/имя/отношение, три мини-плитки и кнопка вступления.</summary>
        private void AddFactionCard(List<GameObject> rows, RectTransform list, string kicker, string name, string relation,
                                    Color factionColor, int sites, int parties, int contested,
                                    string actionLabel, System.Action onAction)
        {
            float height = onAction != null || actionLabel != null ? 104f : 78f;
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
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place_(title.rectTransform, 0f, 1f, 0.68f, 1f, new Vector2(29f, -42f), new Vector2(0f, -23f));
            Text rel = Label("Relation", rect, 12, TextAnchor.UpperLeft, SpecialValue, FontStyle.Bold);
            rel.text = relation.ToUpperInvariant();
            Place_(rel.rectTransform, 0f, 1f, 0.68f, 1f, new Vector2(29f, -58f), new Vector2(0f, -43f));

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
            switch (id)
            {
                case "old_klim": return new Color(0.576f, 0.851f, 0.51f);   // #93d982
                case "scrap_union": return new Color(0.843f, 0.663f, 0.369f); // #d7a95e
                case "relay_order": return new Color(0.498f, 0.812f, 1f);   // #7fcfff
                case "caravans": return new Color(0.937f, 0.816f, 0.471f);  // #efd078
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
            _worldHeader.text = string.Empty;

            RebuildRows(_worldRows, _worldList, () =>
            {
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
                        + (party["name"]?.ToString() ?? party["id"]?.ToString() ?? "Группа"),
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
                        token?["title"]?.ToString() ?? token?["text"]?.ToString() ?? "Событие мира");
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

                AddWorldCard(_worldRows, _worldList,
                    RoaPipboy.SiteTypeLabel(site["type"]?.ToString()),
                    site["name"]?.ToString() ?? site["id"]?.ToString() ?? "Точка",
                    RoaPipboy.SiteStatusLabel(site, worldHour) + " · " + RoaPipboy.FactionLabel(site["owner"]?.ToString()),
                    (isSettlement
                        ? "Безопасность " + (site["security"]?.ToObject<int>() ?? 0)
                        : "Контроль " + (site["controlPressure"]?.ToObject<float>() ?? 0f).ToString("0.0"))
                    + " · Запасы: " + RoaPipboy.StockText(site["stockpile"] as JObject),
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
            SectionTitle(page, "FACTIONS");
            _factionsList = ListArea(page, out _);
        }

        private static readonly string[] FactionIds =
            { "old_klim", "scrap_union", "relay_order", "caravans", "neutral", "raiders", "mutants", "wild" };

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

                string playerFaction = Pipboy.WorldFactionId();
                int allied = 0, hostile = 0;
                foreach (string id in FactionIds)
                {
                    if (id == playerFaction) continue;
                    int relation = Pipboy.FactionRelation(id, playerFaction);
                    if (relation >= 25) allied++;
                    else if (relation <= -50) hostile++;
                }
                AddDashboard(_factionRows, _factionsList,
                    ("Текущая сторона", string.IsNullOrEmpty(playerFaction) ? "Независимый странник" : RoaPipboy.FactionLabel(playerFaction)),
                    ("Союзные", allied.ToString()),
                    ("Враждебные", hostile.ToString()),
                    ("Всего фракций", FactionIds.Length.ToString()));

                foreach (string id in FactionIds)
                {
                    int relation = Pipboy.FactionRelation(id, playerFaction);
                    int sites, parties, contested;
                    Pipboy.FactionStats(id, out sites, out parties, out contested);
                    int reputation = self?["worldFactionReputation"]?[id]?.ToObject<int>() ?? 0;
                    bool joinable = RoaPipboy.IsJoinableFaction(id);
                    string kicker = joinable ? "фракция" : id == "neutral" ? "нейтралы" : "угроза";
                    string relationText = id == playerFaction ? "Ваша фракция"
                        : RoaPipboy.RelationLabel(id, playerFaction, relation) + (joinable ? " · репутация " + reputation : string.Empty);

                    string actionLabel = null;
                    System.Action onAction = null;
                    if (joinable && id != playerFaction && Interaction != null)
                    {
                        string factionId = id;
                        actionLabel = string.IsNullOrEmpty(playerFaction) ? "Вступить во фракцию" : "Сменить сторону";
                        onAction = () => Interaction.SubmitWorldFactionJoin(factionId, null);
                    }
                    AddFactionCard(_factionRows, _factionsList, kicker, RoaPipboy.FactionLabel(id), relationText,
                        FactionTint(id), sites, parties, contested, actionLabel, onAction);
                }
            });
        }

        // ------------------------------------------------------------------
        // FRIENDS — pipboy-friends-grid (03a:262): игрок рядом, друзья, заявки
        // ------------------------------------------------------------------

        private void BuildFriendsPage(RectTransform parent)
        {
            RectTransform page = Page_(Page.Friends, parent);
            SectionTitle(page, "FRIENDS");
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

                    bool inRange = distance <= RoaPipboy.HealRange;
                    var heal = new List<(string, System.Action)>();
                    AddHeal(heal, target, "medkit", "Аптечка", inRange && target.Hp < target.MaxHp);
                    AddHeal(heal, target, "stim", "Стимулятор", inRange && target.Hp < target.MaxHp);
                    AddHeal(heal, target, "doctorBag", "Доктор", inRange && RoaPipboy.HasTreatableInjury(target));
                    AddHeal(heal, target, "antibiotics", "Антибиотик", inRange && RoaPipboy.HasInjury(target, "infection"));
                    AddTextCard(_friendRows, _friendsList, "Лечение",
                        inRange ? "Предметы из вашего рюкзака, расход подтверждает сервер." : "Подойдите ближе, чтобы лечить.", heal);
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
            SectionTitle(page, "CLAN");
            _clanList = ListArea(page, out _);
        }

        private void RefreshClan()
        {
            JObject social = Pipboy.SocialState();
            JObject clan = social["clan"] as JObject;
            string clanName = clan?["name"]?.ToString() ?? string.Empty;

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
                        new List<(string, System.Action)> { ("Покинуть", () => Pipboy.SubmitSocialState("leaveClan")) });

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
                        ("Принять", () => Pipboy.SubmitSocialState("acceptClan", entry)),
                        ("Отклонить", () => Pipboy.SubmitSocialState("declineClan", entry))
                    });
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
                if (name.Length < 3) return;
                Pipboy.SubmitSocialState("createClan", null, name);
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
            SectionTitle(page, "RADIO");
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
