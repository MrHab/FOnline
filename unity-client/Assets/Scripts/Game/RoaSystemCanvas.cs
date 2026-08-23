using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Системные окна в структуре web-клиента:
    /// - кнопка ⚙ (#game-settings-btn) справа сверху и панель «Меню»
    ///   (#game-settings-panel, 310px под кнопкой): Сменить персонажа, Выйти
    ///   из аккаунта, Редактировать HUD, Сбросить HUD, Настройки графики,
    ///   плюс «Обучение» (в web — отдельная кнопка F1/рельса);
    /// - «Настройки графики» (#graphics-window, 420px по центру): четыре
    ///   пресета, «Текущий режим», строки параметров, заметка;
    /// - «Обучение» (#tutorial-window, 520px по центру): h4/p;
    /// - тулбар редактирования HUD (body.hud-edit-mode): «Сохранить HUD» и
    ///   «Сбросить позиции».
    /// Состояния и действия остаются в RoaGameBootstrap (фасад Menu*).
    /// </summary>
    public sealed class RoaSystemCanvas : MonoBehaviour
    {
        private static readonly Color PanelBg = new Color(0.051f, 0.063f, 0.063f, 0.88f);
        private static readonly Color PanelBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);
        private static readonly Color ButtonBg = new Color(0.165f, 0.141f, 0.098f, 0.94f);   // .ui-btn
        private static readonly Color ButtonInk = new Color(0.898f, 0.78f, 0.486f, 1f);      // #e5c77c
        private static readonly Color ButtonBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color ActiveBg = new Color(0.298f, 0.227f, 0.114f, 0.94f);
        private static readonly Color ActiveInk = new Color(1f, 0.886f, 0.627f, 1f);
        private static readonly Color NoteInk = new Color(0.557f, 0.627f, 0.49f, 1f);        // #8ea07d
        private static readonly Color BodyInk = new Color(0.725f, 0.678f, 0.525f, 1f);       // #b9ad86
        private static readonly Color RowBorder = new Color(0.353f, 0.314f, 0.216f, 0.45f);
        private static readonly Color RowValue = new Color(0.91f, 0.792f, 0.514f, 1f);       // #e8ca83

        public RoaGameBootstrap Bootstrap;

        private Canvas _canvas;
        private RectTransform _root;
        private GameObject _gearButton;
        private GameObject _menu;
        private GameObject _graphics;
        private GameObject _tutorial;
        private GameObject _hudToolbar;
        private Text _menuStatus;
        private Text _graphicsCurrent;
        private readonly List<Button> _presetButtons = new List<Button>();
        private readonly Dictionary<string, Text> _graphicsRows = new Dictionary<string, Text>();
        private float _refreshAt;

        private void Update()
        {
            bool inGame = Bootstrap != null && Bootstrap.SystemCanvasDriven && Bootstrap.InGame;
            if (!inGame)
            {
                if (_root != null && _root.gameObject.activeSelf) _root.gameObject.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.gameObject.activeSelf) _root.gameObject.SetActive(true);

            bool editing = RoaHudLayout.Editing;
            _gearButton.SetActive(!editing);
            // На глобальной карте справа сайдбар — шестерёнка уходит левее него.
            ((RectTransform)_gearButton.transform).anchoredPosition = new Vector2(Bootstrap.OnGlobalMap ? -(RoaGlobalMapCanvas.SidebarWidth + 24f) : -10f, -10f);
            _menu.SetActive(Bootstrap.GameMenuOpen && !editing);
            _graphics.SetActive(Bootstrap.GraphicsOpen && !editing);
            _tutorial.SetActive(Bootstrap.TutorialOpen && !editing);
            _hudToolbar.SetActive(editing);

            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.25f;
            if (_menu.activeSelf)
            {
                _menuStatus.text = Bootstrap.GameMenuActionPending ? Bootstrap.StatusText
                    : (Bootstrap.OnGlobalMap ? "Глобальная карта" : "Локальная локация") + " · Esc — закрыть";
                foreach (Button button in _menu.GetComponentsInChildren<Button>())
                    if (button.name == "SwitchCharacter" || button.name == "Logout")
                        button.interactable = !Bootstrap.GameMenuActionPending;
            }
            if (_graphics.activeSelf) RefreshGraphics();
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;

            var canvasGo = new GameObject("SystemCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 45; // z-index 180 в web: над игровыми окнами, под экраном аккаунта
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.matchWidthOrHeight = 0.5f;

            _root = Child("Root", (RectTransform)canvasGo.transform);
            Stretch(_root, 0f);

            BuildGearButton();
            BuildMenu();
            BuildGraphics();
            BuildTutorial();
            BuildHudToolbar();
        }

        /// <summary>#game-settings-btn: ⚙ в правом верхнем углу.</summary>
        private void BuildGearButton()
        {
            Button gear = UiButton("GearButton", _root, "⚙", 22, () => Bootstrap.MenuOpenGameMenu(!Bootstrap.GameMenuOpen));
            var rect = (RectTransform)gear.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(1f, 1f);
            rect.anchoredPosition = new Vector2(-10f, -10f);
            rect.sizeDelta = new Vector2(40f, 40f);
            _gearButton = gear.gameObject;
        }

        /// <summary>#game-settings-panel: 310px под ⚙, список кнопок и заметка.</summary>
        private void BuildMenu()
        {
            RectTransform panel = Panel("GameMenu", new Vector2(1f, 1f), new Vector2(-10f, -58f), new Vector2(310f, 360f));
            _menu = panel.gameObject;
            PanelTitle(panel, "Меню", () => Bootstrap.MenuOpenGameMenu(false));

            string[] names = { "SwitchCharacter", "Logout", "EditHud", "ResetHud", "Graphics", "Tutorial" };
            string[] labels = { "Сменить персонажа", "Выйти из аккаунта", "Редактировать HUD", "Сбросить HUD", "Настройки графики", "Обучение и управление (F1)" };
            System.Action[] actions =
            {
                () => Bootstrap.ReturnToCharacterPicker(),
                () => Bootstrap.MenuLogout(),
                () => Bootstrap.MenuBeginHudEdit(),
                () => Bootstrap.MenuResetHud(),
                () => Bootstrap.MenuOpenGraphics(true),
                () => Bootstrap.MenuOpenTutorial(true)
            };
            for (int i = 0; i < names.Length; i++)
            {
                Button button = UiButton(names[i], panel, labels[i], 12, actions[i]);
                var rect = (RectTransform)button.transform;
                Place(rect, 0f, 1f, 1f, 1f, new Vector2(12f, -48f - i * 44f - 36f), new Vector2(-12f, -48f - i * 44f));
                button.GetComponentInChildren<Text>().alignment = TextAnchor.MiddleLeft;
            }

            _menuStatus = Label("Note", panel, 10, TextAnchor.UpperLeft, NoteInk);
            _menuStatus.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_menuStatus.rectTransform, 0f, 0f, 1f, 0f, new Vector2(12f, 8f), new Vector2(-12f, 34f));
        }

        /// <summary>#graphics-window: пресеты, текущий режим, строки параметров.</summary>
        private void BuildGraphics()
        {
            RectTransform panel = Panel("GraphicsWindow", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(480f, 420f));
            panel.pivot = new Vector2(0.5f, 0.5f);
            _graphics = panel.gameObject;
            PanelTitle(panel, "Настройки графики", () => Bootstrap.MenuOpenGraphics(false));

            string[] names = QualitySettings.names;
            int count = Mathf.Max(1, names.Length);
            float width = (480f - 24f - 8f * (count - 1)) / count;
            _presetButtons.Clear();
            for (int i = 0; i < names.Length; i++)
            {
                int index = i;
                Button button = UiButton("Preset:" + names[i], panel, RoaGameBootstrap.MenuQualityLabel(names[i]), 11,
                    () => { RoaGameBootstrap.MenuSetQuality(index); _refreshAt = 0f; });
                var rect = (RectTransform)button.transform;
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(12f + i * (width + 8f), -48f);
                rect.sizeDelta = new Vector2(width, 34f);
                _presetButtons.Add(button);
            }

            _graphicsCurrent = Label("Current", panel, 12, TextAnchor.MiddleLeft, TitleInk);
            Place(_graphicsCurrent.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -112f), new Vector2(-12f, -90f));

            string[] rowKeys = { "scale", "shadows", "fog", "culling", "aa", "textures", "screen" };
            string[] rowLabels = { "Разрешение рендера", "Тени", "Туман войны", "Дальность статики", "Сглаживание", "Текстуры", "Экран" };
            for (int i = 0; i < rowKeys.Length; i++)
            {
                RectTransform row = Child("Row:" + rowKeys[i], panel);
                Place(row, 0f, 1f, 1f, 1f, new Vector2(12f, -118f - i * 34f - 28f), new Vector2(-12f, -118f - i * 34f));
                row.gameObject.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.2f);
                Outline outline = row.gameObject.AddComponent<Outline>();
                outline.effectColor = RowBorder;
                outline.effectDistance = new Vector2(1f, -1f);
                Text key = Label("Key", row, 11, TextAnchor.MiddleLeft, RowValue, FontStyle.Bold);
                key.text = rowLabels[i];
                Stretch(key.rectTransform, 8f);
                Text value = Label("Value", row, 11, TextAnchor.MiddleRight, BodyInk);
                Stretch(value.rectTransform, 8f);
                _graphicsRows[rowKeys[i]] = value;
            }

            // Строка «Экран» кликабельна на ПК — полноэкранный режим, как ⛶ в web.
            if (!Application.isMobilePlatform)
            {
                var fullscreen = _graphicsRows["screen"].transform.parent.gameObject.AddComponent<Button>();
                fullscreen.onClick.AddListener(() => { Screen.fullScreen = !Screen.fullScreen; _refreshAt = 0f; });
            }

            Text note = Label("Note", panel, 10, TextAnchor.UpperLeft, NoteInk);
            note.horizontalOverflow = HorizontalWrapMode.Wrap;
            note.text = "Пресет управляет тенями, дальностью, освещением, сглаживанием и качеством текстур URP. Настройки применяются сразу и запоминаются. Esc — закрыть.";
            Place(note.rectTransform, 0f, 0f, 1f, 0f, new Vector2(12f, 8f), new Vector2(-12f, 48f));
        }

        private void RefreshGraphics()
        {
            string[] names = QualitySettings.names;
            int level = QualitySettings.GetQualityLevel();
            for (int i = 0; i < _presetButtons.Count; i++)
            {
                bool active = i == level;
                _presetButtons[i].GetComponent<Image>().color = active ? ActiveBg : ButtonBg;
                _presetButtons[i].GetComponent<Outline>().effectColor = active ? new Color(0.941f, 0.776f, 0.357f, 1f) : ButtonBorder;
                _presetButtons[i].GetComponentInChildren<Text>().color = active ? ActiveInk : ButtonInk;
            }
            _graphicsCurrent.text = "Текущий режим: " + (level < names.Length ? RoaGameBootstrap.MenuQualityLabel(names[level]) : "—");

            var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            _graphicsRows["scale"].text = urp != null
                ? Mathf.RoundToInt(urp.renderScale * 100f) + "% · " + Screen.width + "×" + Screen.height
                : Screen.width + "×" + Screen.height;
            _graphicsRows["shadows"].text = urp != null
                ? (urp.supportsMainLightShadows ? "вкл · " + Mathf.RoundToInt(urp.shadowDistance) + " м" : "выкл")
                : (QualitySettings.shadows == UnityEngine.ShadowQuality.Disable ? "выкл" : "вкл");
            RoaFogOfWar fog = FindAnyObjectByType<RoaFogOfWar>();
            _graphicsRows["fog"].text = fog == null ? "—" : (fog.ShowVisualFog ? "вкл · обзор " + fog.Radius + " кл." : "только видимость · обзор " + fog.Radius + " кл.");
            _graphicsRows["culling"].text = QualitySettings.lodBias.ToString("0.0") + "× LOD";
            _graphicsRows["aa"].text = urp != null && urp.msaaSampleCount > 1 ? "MSAA " + urp.msaaSampleCount + "×" : "выкл";
            _graphicsRows["textures"].text = QualitySettings.globalTextureMipmapLimit == 0 ? "полные"
                : "1/" + (1 << QualitySettings.globalTextureMipmapLimit);
            _graphicsRows["screen"].text = Application.isMobilePlatform ? "мобильный"
                : (Screen.fullScreen ? "полный экран · нажмите для окна" : "окно · нажмите для полного экрана");
        }

        /// <summary>#tutorial-window: разделы h4 + p.</summary>
        private void BuildTutorial()
        {
            RectTransform panel = Panel("TutorialWindow", new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(560f, 580f));
            panel.pivot = new Vector2(0.5f, 0.5f);
            _tutorial = panel.gameObject;
            PanelTitle(panel, "Обучение", () => Bootstrap.MenuOpenTutorial(false));

            RectTransform scrollArea = Child("Scroll", panel);
            Place(scrollArea, 0f, 0f, 1f, 1f, new Vector2(14f, 30f), new Vector2(-14f, -48f));
            var scroll = scrollArea.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scrollArea.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", scrollArea);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 4f;
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;

            string[][] sections =
            {
                new[] { "Передвижение", "ПК: WASD, мышь — направление взгляда, Ctrl/C — присесть, колесо — масштаб. Телефон: левое касание создаёт плавающий стик, правый палец — прицел и стрельба удержанием." },
                new[] { "Бой", "ЛКМ или ОГОНЬ атакует выбранную точку/цель. R — перезарядка, X — режим оружия. Урон, ОД, магазин и попадание всегда подтверждает сервер." },
                new[] { "Взаимодействие", "Короткое E открывает разговор, торговлю, хранилище, контейнер, ресурс, станок, доску работ или переход между локациями. Удержание E открывает круг быстрых слотов; клавиши 1–8 используют слот сразу." },
                new[] { "Инвентарь", "Tab — сумка, P или B — PIP-ASH, M — карта локации. В сумке вкладки категорий и сортировка; кнопка «быстро» назначает предмет в быстрый слот." },
                new[] { "HUD", "В меню ⚙ включите «Редактировать HUD» и перетащите золотые рамки; «Сбросить HUD» возвращает раскладку." },
                new[] { "Глобальная карта", "G у границы локации — выход на глобальную карту. Выберите точку и подтвердите маршрут: время, встречи, состав группы, отмену и прибытие ведёт сервер." }
            };
            foreach (string[] section in sections)
            {
                Text h4 = Label("H4", list, 13, TextAnchor.UpperLeft, TitleInk, FontStyle.Bold);
                h4.text = section[0];
                h4.gameObject.AddComponent<LayoutElement>().preferredHeight = 24f;
                Text p = Label("P", list, 12, TextAnchor.UpperLeft, BodyInk);
                p.horizontalOverflow = HorizontalWrapMode.Wrap;
                p.text = section[1];
                p.gameObject.AddComponent<LayoutElement>().preferredHeight = 18f * Mathf.Max(1, Mathf.CeilToInt(section[1].Length / 78f)) + 6f;
            }

            Text hint = Label("Hint", panel, 10, TextAnchor.MiddleLeft, NoteInk);
            hint.text = "F1 / Esc — закрыть";
            Place(hint.rectTransform, 0f, 0f, 1f, 0f, new Vector2(14f, 6f), new Vector2(-14f, 26f));
        }

        /// <summary>Тулбар редактирования HUD внизу экрана.</summary>
        private void BuildHudToolbar()
        {
            RectTransform panel = Panel("HudToolbar", new Vector2(0.5f, 1f), new Vector2(0f, -12f), new Vector2(460f, 84f));
            panel.pivot = new Vector2(0.5f, 1f);
            _hudToolbar = panel.gameObject;
            Text text = Label("Text", panel, 11, TextAnchor.UpperLeft, BodyInk);
            text.text = "Перетаскивайте золотые рамки. Игровое управление отключено.";
            Place(text.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -30f), new Vector2(-12f, -8f));
            Button save = UiButton("SaveHud", panel, "Сохранить HUD", 12, () => Bootstrap.MenuEndHudEdit());
            Place((RectTransform)save.transform, 0f, 0f, 0.5f, 0f, new Vector2(12f, 10f), new Vector2(-4f, 44f));
            Button reset = UiButton("ResetHudPositions", panel, "Сбросить позиции", 12, () => Bootstrap.MenuResetHud());
            Place((RectTransform)reset.transform, 0.5f, 0f, 1f, 0f, new Vector2(4f, 10f), new Vector2(-12f, 44f));
        }

        // --- Утилиты ---------------------------------------------------------

        private RectTransform Panel(string name, Vector2 anchor, Vector2 position, Vector2 size)
        {
            RectTransform panel = Child(name, _root);
            panel.anchorMin = panel.anchorMax = anchor;
            panel.pivot = anchor;
            panel.anchoredPosition = position;
            panel.sizeDelta = size;
            panel.gameObject.AddComponent<Image>().color = PanelBg;
            Outline outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = PanelBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            panel.gameObject.SetActive(false);
            return panel;
        }

        /// <summary>.panel-title: заголовок капсом слева, «Закрыть» справа.</summary>
        private void PanelTitle(RectTransform panel, string caption, System.Action onClose)
        {
            Text title = Label("Title", panel, 11, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            title.text = caption.ToUpperInvariant();
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(12f, -38f), new Vector2(-100f, -10f));
            Button close = UiButton("Close", panel, "Закрыть", 11, onClose);
            var rect = (RectTransform)close.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(1f, 1f);
            rect.pivot = new Vector2(1f, 1f);
            rect.anchoredPosition = new Vector2(-10f, -10f);
            rect.sizeDelta = new Vector2(80f, 26f);
        }

        private static Button UiButton(string name, RectTransform parent, string caption, int size, System.Action onClick)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = ButtonBg;
            Outline outline = go.AddComponent<Outline>();
            outline.effectColor = ButtonBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            Text label = Label("Label", (RectTransform)go.transform, size, TextAnchor.MiddleCenter, ButtonInk);
            Stretch(label.rectTransform, 8f);
            label.text = caption;
            button.onClick.AddListener(() => onClick());
            return button;
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
    }
}
