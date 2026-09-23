using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Adaptive landscape uGUI for touch play. Gameplay authority remains in
    /// RoaMobileControls; this component owns presentation, safe-area layout and
    /// pointer states so the active mobile HUD no longer depends on IMGUI.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class RoaMobileControlsCanvas : MonoBehaviour
    {
        public struct Presentation
        {
            public bool Visible;
            public bool InputSuppressed;
            public bool PanelOpen;
            public bool InventoryOpen;
            public bool TargetSelected;
            public bool Crouching;
            public bool PingAvailable;
            public bool BoltAiming;
            /// <summary>В слоте «Транспорт» есть мотоцикл: кнопка «МОТО» имеет смысл.</summary>
            public bool VehicleAvailable;
            public bool Mounted;
            public string FireMode;
            public bool JoystickActive;
            public Vector2 JoystickBase;
            public Vector2 JoystickPoint;
            public float JoystickRadius;
        }

        public struct Layout
        {
            public Rect SafeArea;
            public Rect Inventory;
            public Rect Map;
            public Rect Pipboy;
            public Rect Menu;
            public Rect Fire;
            public Rect Interact;
            public Rect Target;
            public Rect Crouch;
            public Rect Reload;
            public Rect Mode;
            public Rect Player;
            public Rect Bolt;
            public Rect Vehicle;

            public Rect Action(int index)
            {
                switch (index)
                {
                    case 1: return Interact;
                    case 2: return Target;
                    case 3: return Crouch;
                    case 4: return Reload;
                    case 5: return Mode;
                    case 6: return Player;
                    case 7: return Bolt;
                    case 8: return Vehicle;
                    default: return default;
                }
            }
        }

        private sealed class ButtonView
        {
            public string Id;
            public RectTransform Rect;
            public RawImage Back;
            public RawImage Icon;
            public Text Label;
            public int BaseFontSize;
            public RoaMobileControlPress Press;
        }

        // Мельче 11 пикселей экрана вложенный Noto Sans (Hinted Raster) теряет форму
        // букв: «ДЕЙСТВИЕ» читается как «дейСтвие». Размер глифа округляется до целых
        // пикселей, поэтому порог подгонки подписи — 10,5 пикселя.
        public const float MinLabelPixels = 10.5f;

        private static readonly Color Ink = new Color(0.96f, 0.86f, 0.66f, 1f);
        private static readonly Color Normal = new Color(0.78f, 0.74f, 0.62f, 0.94f);
        private static readonly Color Selected = new Color(1f, 0.82f, 0.43f, 1f);
        private static readonly Color Fire = new Color(1f, 0.50f, 0.32f, 1f);

        public RoaMobileControls Controls;
        public RoaBoltThrower BoltThrower;
        public RoaVehicleController Vehicles;

        /// <summary>Кнопок всего: четыре на левой рейке, огонь и восемь действий справа.</summary>
        public const int TotalButtons = 13;

        private Canvas _canvas;
        private CanvasScaler _scaler;
        private GraphicRaycaster _raycaster;
        private RectTransform _layer;
        private RectTransform _joystickOuter;
        private RectTransform _joystickKnob;
        private RawImage _joystickOuterImage;
        private RawImage _joystickKnobImage;
        private Texture2D _disc;
        private readonly Dictionary<string, ButtonView> _buttons =
            new Dictionary<string, ButtonView>(StringComparer.Ordinal);
        private Layout _layout;
        private int _layoutWidth;
        private int _layoutHeight;
        private Rect _layoutSafe;
        private bool _visible;
        private bool _gameplayButtonsVisible;

        public bool CanvasReady { get { return _canvas != null && _layer != null; } }
        public bool Visible { get { return _visible && _canvas != null && _canvas.enabled; } }
        public bool GameplayButtonsVisible { get { return _gameplayButtonsVisible; } }
        public bool JoystickVisible
        {
            get { return _joystickOuter != null && _joystickOuter.gameObject.activeSelf; }
        }
        public int ButtonCount { get { return _buttons.Count; } }
        public int ActiveButtonCount
        {
            get
            {
                int count = 0;
                foreach (ButtonView view in _buttons.Values)
                    if (view.Rect.gameObject.activeSelf) count++;
                return count;
            }
        }
        public bool InputReady
        {
            get
            {
                if (_raycaster == null || _buttons.Count != TotalButtons) return false;
                foreach (ButtonView view in _buttons.Values)
                {
                    if (!view.Back.raycastTarget || view.Icon.raycastTarget
                        || view.Label.raycastTarget || view.Press == null) return false;
                }
                return _joystickOuterImage != null && !_joystickOuterImage.raycastTarget
                    && _joystickKnobImage != null && !_joystickKnobImage.raycastTarget;
            }
        }

        private void Awake()
        {
            EnsureCanvas();
        }

        private void OnDisable()
        {
            Controls?.SetFireHeld(false);
            Hide();
        }

        private void OnDestroy()
        {
            if (_disc == null || _disc.hideFlags != HideFlags.DontSave) return;
            if (Application.isPlaying) Destroy(_disc);
            else DestroyImmediate(_disc);
        }

        private void LateUpdate()
        {
            PresentFromControls();
        }

        public void Configure(RoaMobileControls controls, RoaBoltThrower boltThrower = null,
                              RoaVehicleController vehicles = null)
        {
            Controls = controls;
            BoltThrower = boltThrower;
            Vehicles = vehicles;
            EnsureCanvas();
            PresentFromControls();
        }

        public void RefreshNow()
        {
            PresentFromControls();
        }

        public void PresentNow(Presentation state, int width, int height, Rect safeArea)
        {
            EnsureCanvas();
            width = Mathf.Max(1, width);
            height = Mathf.Max(1, height);
            if (_layoutWidth != width || _layoutHeight != height || _layoutSafe != safeArea)
                ApplyLayout(width, height, safeArea);

            _visible = state.Visible;
            _canvas.enabled = state.Visible;
            _layer.gameObject.SetActive(state.Visible);
            if (!state.Visible)
            {
                Controls?.SetFireHeld(false);
                return;
            }

            bool leftActions = !state.InputSuppressed;
            SetVisible("Menu", true);
            SetVisible("Inventory", leftActions);
            SetVisible("Map", leftActions);
            SetVisible("Pipboy", leftActions);
            SetLabel("Menu", state.InputSuppressed ? "ЗАКРЫТЬ" : "МЕНЮ");
            SetSelected("Inventory", state.InventoryOpen, false);

            _gameplayButtonsVisible = leftActions && !state.PanelOpen;
            SetVisible("Fire", _gameplayButtonsVisible);
            SetVisible("Interact", _gameplayButtonsVisible);
            SetVisible("Target", _gameplayButtonsVisible);
            SetVisible("Crouch", _gameplayButtonsVisible);
            SetVisible("Reload", _gameplayButtonsVisible);
            SetVisible("Mode", _gameplayButtonsVisible);
            SetVisible("Player", _gameplayButtonsVisible);
            SetVisible("Bolt", _gameplayButtonsVisible);
            // Кнопку транспорта показываем, только когда он надет: пустая кнопка лишь путала бы.
            SetVisible("Vehicle", _gameplayButtonsVisible && (state.VehicleAvailable || state.Mounted));
            SetSelected("Vehicle", state.Mounted, false);
            SetLabel("Vehicle", state.Mounted ? "СЛЕЗТЬ" : "МОТО");
            SetSelected("Target", state.TargetSelected, false);
            // Галки U+2713 нет во вложенном Noto Sans, а в WebGL нет системных
            // шрифтов, которые бы её подставили; точка U+2022 в шрифте есть.
            SetLabel("Target", state.TargetSelected ? "ЦЕЛЬ •" : "ЦЕЛЬ");
            SetLabel("Fire", Controls != null ? Controls.FireLabel : "ОГОНЬ");
            SetSelected("Crouch", state.Crouching, false);
            SetLabel("Crouch", state.Crouching ? "ВСТАТЬ" : "ПРИСЕСТЬ");
            SetLabel("Mode", FireModeLabel(state.FireMode));
            SetSelected("Player", state.PingAvailable, false);
            SetLabel("Player", state.PingAvailable ? "МЕТКА" : "ИГРОК");
            SetSelected("Bolt", state.BoltAiming, false);
            SetLabel("Bolt", state.BoltAiming ? "ОТМЕНА" : "БОЛТ");

            bool joystickVisible = _gameplayButtonsVisible && state.JoystickActive;
            _joystickOuter.gameObject.SetActive(joystickVisible);
            _joystickKnob.gameObject.SetActive(joystickVisible);
            if (joystickVisible)
                ApplyJoystick(state.JoystickBase, state.JoystickPoint,
                              state.JoystickRadius, width, height);
            if (!_gameplayButtonsVisible) Controls?.SetFireHeld(false);
        }

        public bool TryGetButtonScreenRect(string id, out Rect rect)
        {
            rect = default;
            switch (id)
            {
                case "Inventory": rect = _layout.Inventory; return true;
                case "Map": rect = _layout.Map; return true;
                case "Pipboy": rect = _layout.Pipboy; return true;
                case "Menu": rect = _layout.Menu; return true;
                case "Fire": rect = _layout.Fire; return true;
                case "Interact": rect = _layout.Interact; return true;
                case "Target": rect = _layout.Target; return true;
                case "Crouch": rect = _layout.Crouch; return true;
                case "Reload": rect = _layout.Reload; return true;
                case "Mode": rect = _layout.Mode; return true;
                case "Player": rect = _layout.Player; return true;
                case "Bolt": rect = _layout.Bolt; return true;
                case "Vehicle": rect = _layout.Vehicle; return true;
                default: return false;
            }
        }

        public string ButtonLabel(string id)
        {
            return _buttons.TryGetValue(id, out ButtonView view) ? view.Label.text : string.Empty;
        }

        public bool ButtonHasIcon(string id)
        {
            return _buttons.TryGetValue(id, out ButtonView view) && view.Icon.enabled;
        }

        public bool SimulatePressForProbe(string id, bool pressed)
        {
            if (!_buttons.TryGetValue(id, out ButtonView view)) return false;
            view.Press.SimulatePress(pressed);
            return true;
        }

        public bool SimulateClickForProbe(string id)
        {
            if (!_buttons.TryGetValue(id, out ButtonView view)) return false;
            view.Press.SimulateClick();
            return true;
        }

        public static Layout CalculateLayout(int width, int height, Rect safeArea)
        {
            width = Mathf.Max(1, width);
            height = Mathf.Max(1, height);
            Rect viewport = new Rect(0f, 0f, width, height);
            safeArea = Intersect(safeArea, viewport);
            if (safeArea.width < 320f || safeArea.height < 220f) safeArea = viewport;

            float rail = Mathf.Clamp(safeArea.height * 0.12f, 46f, 58f);
            float railX = safeArea.xMin + 12f;
            float railTop = safeArea.yMax - 12f;
            Rect Rail(int index)
            {
                return new Rect(railX, railTop - rail - index * (rail + 6f), rail, rail);
            }

            float fireSize = Mathf.Clamp(Mathf.Min(safeArea.width, safeArea.height) * 0.145f,
                                         76f, 112f);
            Rect fire = new Rect(safeArea.xMax - fireSize - 18f,
                                 safeArea.yMin + 22f, fireSize, fireSize);
            float actionSize = Mathf.Clamp(Mathf.Min(safeArea.width, safeArea.height) * 0.09f,
                                           54f, 76f);
            Rect Action(int index)
            {
                int column = (index - 1) % 2;
                int row = Mathf.FloorToInt((index - 1) / 2f);
                float x = safeArea.xMax - actionSize - 24f
                    - column * (actionSize + 10f);
                float y = safeArea.yMin + fireSize + 42f + row * (actionSize + 8f);
                return new Rect(x, y, actionSize, actionSize);
            }

            return new Layout
            {
                SafeArea = safeArea,
                Inventory = Rail(0), Map = Rail(1), Pipboy = Rail(2), Menu = Rail(3),
                Fire = fire,
                Interact = Action(1), Target = Action(2), Crouch = Action(3),
                Reload = Action(4), Mode = Action(5), Player = Action(6), Bolt = Action(7),
                Vehicle = Action(8)
            };
        }

        /// <summary>
        /// Подпись кнопки режима. RoaCombat.FireMode — id режима (single, aimed…),
        /// который раньше и выводился заглавными латинскими буквами; полные названия
        /// из журнала боя («Автоматический», «Парный залп») в кнопку не влезают.
        /// </summary>
        public static string FireModeLabel(string mode)
        {
            switch (mode)
            {
                case "single": return "ОДИН.";
                case "aimed": return "ПРИЦ.";
                case "auto": return "АВТО";
                case "dual": return "ПАРА";
                case "melee": return "БЛИЖН.";
                default: return "РЕЖИМ";
            }
        }

        private void PresentFromControls()
        {
            EnsureCanvas();
            if (Controls == null)
            {
                Hide();
                return;
            }

            bool joystick = Controls.TryGetJoystickVisual(
                out Vector2 guiBase, out Vector2 guiPoint, out float radius);
            var state = new Presentation
            {
                Visible = Controls.ControlsEnabled && Controls.PlayerReady && !Controls.PipboyOpen,
                InputSuppressed = Controls.InputSuppressed,
                PanelOpen = Controls.PanelOpen,
                InventoryOpen = Controls.InventoryOpen,
                TargetSelected = Controls.TargetSelected,
                Crouching = Controls.Crouching,
                PingAvailable = Controls.PingAvailable,
                BoltAiming = BoltThrower != null && BoltThrower.IsAiming,
                VehicleAvailable = Vehicles != null && Vehicles.HasVehicleEquipped,
                Mounted = Vehicles != null && Vehicles.Mounted,
                FireMode = Controls.CurrentFireMode,
                JoystickActive = joystick,
                JoystickBase = new Vector2(guiBase.x, Screen.height - guiBase.y),
                JoystickPoint = new Vector2(guiPoint.x, Screen.height - guiPoint.y),
                JoystickRadius = radius
            };
            PresentNow(state, Screen.width, Screen.height, Screen.safeArea);
        }

        private void Hide()
        {
            _visible = false;
            _gameplayButtonsVisible = false;
            if (_canvas != null) _canvas.enabled = false;
            if (_layer != null) _layer.gameObject.SetActive(false);
        }

        private void EnsureCanvas()
        {
            if (_canvas != null) return;
            var canvasRoot = new GameObject("MobileControlsCanvas", typeof(RectTransform),
                typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasRoot.transform.SetParent(transform, false);
            _canvas = canvasRoot.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 26;
            _scaler = canvasRoot.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(_scaler);
            _raycaster = canvasRoot.GetComponent<GraphicRaycaster>();

            if (FindAnyObjectByType<EventSystem>() == null)
            {
                var events = new GameObject("MobileControlsEventSystem",
                    typeof(EventSystem), typeof(StandaloneInputModule));
                events.transform.SetParent(canvasRoot.transform, false);
            }

            var layer = new GameObject("MobileControlsLayer", typeof(RectTransform));
            layer.transform.SetParent(canvasRoot.transform, false);
            _layer = (RectTransform)layer.transform;
            _layer.anchorMin = Vector2.zero;
            _layer.anchorMax = Vector2.one;
            _layer.offsetMin = Vector2.zero;
            _layer.offsetMax = Vector2.zero;

            _disc = Resources.Load<Texture2D>(
                "ApocalypseHud/SPR_Apocalypse_Dial_Background_01") ?? CreateDiscTexture();
            CreateButton("Inventory", "СУМКА", "ApocalypseHud/ICON_Apocalpyse_Inventory_Backpack_01",
                () => Controls?.TriggerInventory());
            CreateButton("Map", "КАРТА", "ApocalypseHud/ICON_Apocalpyse_Map_Quest_01",
                () => Controls?.TriggerMap());
            CreateButton("Pipboy", "ПУТНИК", "ApocalypseHud/ICON_Apocalpyse_Inventory_Notes_01",
                () => Controls?.TriggerPipboy());
            CreateButton("Menu", "МЕНЮ", "ApocalypseHud/ICON_Input_Xbox_Button_Menu_Clean",
                () => Controls?.TriggerMenu());
            CreateButton("Fire", "ОГОНЬ", "ApocalypseHud/ICON_Apocalpyse_Inventory_Weapon_01", null,
                held => Controls?.SetFireHeld(held), true);
            CreateButton("Interact", "ДЕЙСТВИЕ", "ApocalypseHud/ICON_Apocalpyse_Map_Unknown_01",
                () => Controls?.TriggerInteract());
            CreateButton("Target", "ЦЕЛЬ", "ApocalypseHud/ICON_Apocalpyse_Map_Target_01",
                () => Controls?.TriggerTargetCycle());
            CreateButton("Crouch", "ПРИСЕСТЬ", "ApocalypseHud/ICON_Input_PC_Arrow_Down_Clean",
                () => Controls?.TriggerCrouch());
            CreateButton("Reload", "ПЕРЕЗАР.", "ApocalypseHud/ICON_SM_Wep_Pistol_Ammo_01",
                () => Controls?.TriggerReload());
            CreateButton("Mode", "РЕЖИМ", "ApocalypseHud/ICON_Input_PC_Tab_Clean",
                () => Controls?.TriggerFireMode());
            CreateButton("Player", "ИГРОК", "ApocalypseHud/ICON_Apocalpyse_Map_Message_01",
                () => Controls?.TriggerPlayerOrPing());
            CreateButton("Bolt", "БОЛТ", "ApocalypseHud/ICON_SM_Wep_CrossBow_Bolt_01",
                () => BoltThrower?.ToggleAim());
            CreateButton("Vehicle", "МОТО", "ApocalypseHud/ICON_Apocalpyse_Map_Vehicle_01",
                () => Vehicles?.Toggle());
            CreateJoystick();
            Hide();
        }

        private void CreateButton(string id, string label, string iconPath, Action clicked,
                                  Action<bool> pressed = null, bool fire = false)
        {
            var root = new GameObject(id, typeof(RectTransform), typeof(CanvasGroup),
                typeof(RawImage), typeof(RoaMobileControlPress));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            RawImage back = root.GetComponent<RawImage>();
            back.texture = _disc;
            back.color = fire ? Fire : Normal;
            back.raycastTarget = true;
            var shadow = root.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.68f);
            shadow.effectDistance = new Vector2(2f, -3f);
            RoaMobileControlPress press = root.GetComponent<RoaMobileControlPress>();
            press.Configure(back, fire ? Fire : Normal, clicked, pressed);

            var iconRoot = new GameObject("Icon", typeof(RectTransform), typeof(RawImage));
            iconRoot.transform.SetParent(root.transform, false);
            RectTransform iconRect = (RectTransform)iconRoot.transform;
            iconRect.anchorMin = new Vector2(0.19f, 0.29f);
            iconRect.anchorMax = new Vector2(0.81f, 0.91f);
            iconRect.offsetMin = iconRect.offsetMax = Vector2.zero;
            RawImage icon = iconRoot.GetComponent<RawImage>();
            icon.texture = string.IsNullOrEmpty(iconPath)
                ? null : Resources.Load<Texture2D>(iconPath);
            if (icon.texture == null)
                icon.texture = Resources.Load<Texture2D>(LegacyIconPath(id));
            icon.color = Color.white;
            icon.raycastTarget = false;
            // RawImage без текстуры рисует сплошной белый квадрат поверх диска:
            // без спрайта кнопка остаётся текстовой, с подписью по центру.
            bool hasIcon = icon.texture != null;
            icon.enabled = hasIcon;

            var labelRoot = new GameObject("Label", typeof(RectTransform), typeof(Text));
            labelRoot.transform.SetParent(root.transform, false);
            RectTransform labelRect = (RectTransform)labelRoot.transform;
            labelRect.anchorMin = new Vector2(0.02f, hasIcon ? 0.03f : 0.30f);
            labelRect.anchorMax = new Vector2(0.98f, hasIcon ? 0.30f : 0.70f);
            labelRect.offsetMin = labelRect.offsetMax = Vector2.zero;
            Text text = labelRoot.GetComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = fire ? 17 : 14;
            text.fontStyle = FontStyle.Bold;
            text.alignment = TextAnchor.MiddleCenter;
            text.color = Ink;
            text.raycastTarget = false;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            text.text = label;
            var outline = labelRoot.AddComponent<Outline>();
            outline.effectColor = new Color(0f, 0f, 0f, 0.92f);
            outline.effectDistance = new Vector2(1f, -1f);

            _buttons[id] = new ButtonView
            {
                Id = id, Rect = rect, Back = back, Icon = icon, Label = text,
                BaseFontSize = text.fontSize, Press = press
            };
        }

        private static string LegacyIconPath(string id)
        {
            switch (id)
            {
                case "Inventory": return "RealmUi/mobile/left/inventory";
                case "Map": return "RealmUi/mobile/left/map";
                case "Pipboy": return "RealmUi/mobile/left/skills";
                case "Menu": return "RealmUi/mobile/top/main_menu";
                case "Fire": return "RealmUi/mobile/right/attack";
                case "Interact": return "RealmUi/mobile/right/interact";
                case "Target": return "RealmUi/mobile/right/target";
                case "Crouch": return "RealmUi/mobile/left/crouch";
                case "Reload": return "RealmUi/mobile/right/reload";
                case "Mode": return "RealmUi/mobile/right/mode";
                case "Player": return "RealmUi/mobile/right/radial_menu";
                case "Bolt": return "RealmUi/mobile/right/bolt";
                case "Vehicle": return "RealmUi/mobile/right/vehicle";
                default: return string.Empty;
            }
        }

        private void CreateJoystick()
        {
            _joystickOuter = CreateJoystickPart("JoystickOuter", 0.52f,
                new Color(0.77f, 0.68f, 0.48f, 0.80f), out _joystickOuterImage);
            _joystickKnob = CreateJoystickPart("JoystickKnob", 0.72f,
                new Color(1f, 0.82f, 0.51f, 0.96f), out _joystickKnobImage);
            _joystickOuter.gameObject.SetActive(false);
            _joystickKnob.gameObject.SetActive(false);
        }

        private RectTransform CreateJoystickPart(string name, float alpha, Color color,
                                                  out RawImage image)
        {
            var root = new GameObject(name, typeof(RectTransform), typeof(RawImage));
            root.transform.SetParent(_layer, false);
            RectTransform rect = (RectTransform)root.transform;
            image = root.GetComponent<RawImage>();
            image.texture = _disc;
            color.a *= alpha;
            image.color = color;
            image.raycastTarget = false;
            return rect;
        }

        private void ApplyLayout(int width, int height, Rect safeArea)
        {
            _layoutWidth = width;
            _layoutHeight = height;
            _layoutSafe = safeArea;
            _layout = CalculateLayout(width, height, safeArea);
            SetScreenRect("Inventory", _layout.Inventory, width, height);
            SetScreenRect("Map", _layout.Map, width, height);
            SetScreenRect("Pipboy", _layout.Pipboy, width, height);
            SetScreenRect("Menu", _layout.Menu, width, height);
            SetScreenRect("Fire", _layout.Fire, width, height);
            SetScreenRect("Interact", _layout.Interact, width, height);
            SetScreenRect("Target", _layout.Target, width, height);
            SetScreenRect("Crouch", _layout.Crouch, width, height);
            SetScreenRect("Reload", _layout.Reload, width, height);
            SetScreenRect("Mode", _layout.Mode, width, height);
            SetScreenRect("Player", _layout.Player, width, height);
            SetScreenRect("Bolt", _layout.Bolt, width, height);
            SetScreenRect("Vehicle", _layout.Vehicle, width, height);
            foreach (ButtonView view in _buttons.Values) FitLabel(view);
        }

        /// <summary>
        /// Кнопки ограничены в пикселях экрана, а шрифт подписи задан в единицах
        /// канвы и растёт вместе с ней: на телефоне «ДЕЙСТВИЕ» залезал в соседний
        /// столбец, на планшете не влезала ни одна подпись. Шрифт сбрасывается к
        /// базовому и уменьшается, пока подпись шире своей кнопки, но не мельче
        /// MinLabelPixels на экране; влезающая подпись сохраняет размер.
        /// </summary>
        private void FitLabel(ButtonView view)
        {
            Text label = view.Label;
            label.fontSize = view.BaseFontSize;
            if (_layoutWidth <= 0 || !TryGetButtonScreenRect(view.Id, out Rect button)) return;
            float scale = CanvasScale(_layoutWidth, _layoutHeight);
            RectTransform box = label.rectTransform;
            float width = button.width * (box.anchorMax.x - box.anchorMin.x) / scale;
            int floor = Mathf.CeilToInt(MinLabelPixels / scale);
            while (label.fontSize > floor && label.preferredWidth > width)
                label.fontSize--;
        }

        /// <summary>
        /// Масштаб, который CanvasScaler (ScaleWithScreenSize, MatchWidthOrHeight)
        /// даст канве на экране этого размера. Размер приходит в PresentNow
        /// параметром, поэтому масштаб считается по нему, а не берётся с канвы.
        /// </summary>
        private float CanvasScale(int width, int height)
        {
            if (_scaler == null) return 1f;
            Vector2 reference = _scaler.referenceResolution;
            float logWidth = Mathf.Log(width / reference.x, 2f);
            float logHeight = Mathf.Log(height / reference.y, 2f);
            return Mathf.Pow(2f, Mathf.Lerp(logWidth, logHeight, _scaler.matchWidthOrHeight));
        }

        private void ApplyJoystick(Vector2 screenBase, Vector2 screenPoint, float radius,
                                   int width, int height)
        {
            radius = Mathf.Clamp(radius, 42f, 68f);
            float outer = radius * 1.28f;
            Vector2 delta = Vector2.ClampMagnitude(screenPoint - screenBase, radius);
            SetScreenRect(_joystickOuter,
                new Rect(screenBase.x - outer, screenBase.y - outer, outer * 2f, outer * 2f),
                width, height);
            const float knob = 34f;
            Vector2 knobCenter = screenBase + delta;
            SetScreenRect(_joystickKnob,
                new Rect(knobCenter.x - knob, knobCenter.y - knob, knob * 2f, knob * 2f),
                width, height);
        }

        private void SetScreenRect(string id, Rect rect, int width, int height)
        {
            if (_buttons.TryGetValue(id, out ButtonView view))
                SetScreenRect(view.Rect, rect, width, height);
        }

        private static void SetScreenRect(RectTransform target, Rect rect, int width, int height)
        {
            target.anchorMin = new Vector2(rect.xMin / width, rect.yMin / height);
            target.anchorMax = new Vector2(rect.xMax / width, rect.yMax / height);
            target.pivot = new Vector2(0.5f, 0.5f);
            target.offsetMin = Vector2.zero;
            target.offsetMax = Vector2.zero;
        }

        private void SetVisible(string id, bool visible)
        {
            if (!_buttons.TryGetValue(id, out ButtonView view)) return;
            view.Rect.gameObject.SetActive(visible);
            if (!visible) view.Press.CancelPress();
        }

        private void SetLabel(string id, string value)
        {
            if (!_buttons.TryGetValue(id, out ButtonView view) || view.Label.text == value) return;
            view.Label.text = value;
            FitLabel(view);
        }

        private void SetSelected(string id, bool selected, bool fire)
        {
            if (!_buttons.TryGetValue(id, out ButtonView view)) return;
            Color color = fire ? Fire : selected ? Selected : Normal;
            view.Press.SetNormalColor(color);
        }

        private static Rect Intersect(Rect a, Rect b)
        {
            float xMin = Mathf.Max(a.xMin, b.xMin);
            float yMin = Mathf.Max(a.yMin, b.yMin);
            float xMax = Mathf.Min(a.xMax, b.xMax);
            float yMax = Mathf.Min(a.yMax, b.yMax);
            return xMax > xMin && yMax > yMin
                ? Rect.MinMaxRect(xMin, yMin, xMax, yMax) : default;
        }

        private static Texture2D CreateDiscTexture()
        {
            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = "MobileControlDisc",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.DontSave
            };
            var pixels = new Color32[size * size];
            Vector2 center = new Vector2((size - 1) * 0.5f, (size - 1) * 0.5f);
            float radius = size * 0.49f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float distance = Vector2.Distance(new Vector2(x, y), center) / radius;
                    float edge = 1f - Mathf.SmoothStep(0.90f, 1f, distance);
                    float ring = Mathf.Clamp01(1f - Mathf.Abs(distance - 0.82f) * 18f);
                    byte alpha = (byte)Mathf.RoundToInt(Mathf.Clamp01(edge * (0.72f + ring * 0.28f)) * 255f);
                    pixels[y * size + x] = new Color32(255, 255, 255, alpha);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }
    }

    /// <summary>Small pointer adapter with deterministic held/clicked states.</summary>
    public sealed class RoaMobileControlPress : MonoBehaviour, IPointerDownHandler,
        IPointerUpHandler, IPointerExitHandler, IPointerClickHandler
    {
        private RawImage _graphic;
        private Color _normal;
        private Action _clicked;
        private Action<bool> _pressed;
        private bool _down;

        public bool IsPressed { get { return _down; } }

        public void Configure(RawImage graphic, Color normal, Action clicked,
                              Action<bool> pressed)
        {
            _graphic = graphic;
            _normal = normal;
            _clicked = clicked;
            _pressed = pressed;
            ApplyVisual();
        }

        public void SetNormalColor(Color color)
        {
            _normal = color;
            ApplyVisual();
        }

        public void OnPointerDown(PointerEventData eventData)
        {
            SimulatePress(true);
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            SimulatePress(false);
        }

        public void OnPointerExit(PointerEventData eventData)
        {
            CancelPress();
        }

        public void OnPointerClick(PointerEventData eventData)
        {
            SimulateClick();
        }

        public void SimulatePress(bool pressed)
        {
            if (_down == pressed) return;
            _down = pressed;
            _pressed?.Invoke(pressed);
            ApplyVisual();
        }

        public void SimulateClick()
        {
            _clicked?.Invoke();
        }

        public void CancelPress()
        {
            SimulatePress(false);
        }

        private void OnDisable()
        {
            CancelPress();
        }

        private void ApplyVisual()
        {
            if (_graphic != null)
                _graphic.color = _down ? Color.Lerp(_normal, Color.white, 0.28f) : _normal;
            transform.localScale = _down ? Vector3.one * 0.91f : Vector3.one;
        }
    }
}
