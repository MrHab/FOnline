using System.Text;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>Single adaptive owner for the always-visible gameplay HUD.</summary>
    public sealed partial class RoaHudCanvas : MonoBehaviour
    {
        public enum ConnectionBannerKind
        {
            Hidden,
            Interrupted,
            Connecting,
            Synchronizing,
            Restored,
            Rejected
        }

        public enum HudFocusMode
        {
            Exploration,
            Activity,
            Combat,
            Detailed
        }

        public enum HudVisualLayer
        {
            Minimap,
            WeaponConsole,
            Quickbar
        }

        public static float FocusLayerAlpha(HudFocusMode focus, HudVisualLayer layer)
        {
            switch (layer)
            {
                case HudVisualLayer.Minimap:
                    if (focus == HudFocusMode.Activity) return 0.74f;
                    if (focus == HudFocusMode.Exploration) return 0.86f;
                    return 1f;
                case HudVisualLayer.WeaponConsole:
                    if (focus == HudFocusMode.Activity) return 0.76f;
                    if (focus == HudFocusMode.Exploration) return 0.82f;
                    return 1f;
                case HudVisualLayer.Quickbar:
                    return focus == HudFocusMode.Detailed ? 0.92f : 1f;
                default:
                    return 1f;
            }
        }

        public readonly struct ConnectionBannerState
        {
            public readonly ConnectionBannerKind Kind;
            public readonly string Title;
            public readonly string Detail;

            public ConnectionBannerState(ConnectionBannerKind kind, string title, string detail)
            {
                Kind = kind;
                Title = title;
                Detail = detail;
            }
        }

        public readonly struct LayoutProfile
        {
            public readonly float PlayerScale;
            public readonly Vector2 PlayerPosition;
            public readonly float ConsoleScale;
            public readonly Vector2 ConsolePosition;
            public readonly float MapScale;
            public readonly Vector2 MapPosition;
            public readonly float QuickbarScale;
            public readonly Vector2 QuickbarPosition;

            public LayoutProfile(float playerScale, Vector2 playerPosition,
                                 float consoleScale, Vector2 consolePosition,
                                 float mapScale, Vector2 mapPosition,
                                 float quickbarScale, Vector2 quickbarPosition)
            {
                PlayerScale = playerScale;
                PlayerPosition = playerPosition;
                ConsoleScale = consoleScale;
                ConsolePosition = consolePosition;
                MapScale = mapScale;
                MapPosition = mapPosition;
                QuickbarScale = quickbarScale;
                QuickbarPosition = quickbarPosition;
            }
        }

        public static LayoutProfile ResolveLayout(bool mobile)
        {
            return mobile
                ? new LayoutProfile(0.75f, new Vector2(64f, -6f),
                    0.625f, new Vector2(0f, 44f),
                    0.625f, new Vector2(-62f, -8f),
                    0.625f, new Vector2(0f, 208f))
                 : new LayoutProfile(1f, new Vector2(12f, -12f),
                    0.875f, new Vector2(0f, 16f),
                    0.875f, new Vector2(-16f, -16f),
                    0.875f, new Vector2(0f, 242f));
        }

        public static HudFocusMode ResolveFocusMode(bool recentCombat, bool detailHeld,
                                                     bool editingHud)
        {
            return ResolveFocusMode(recentCombat, false, detailHeld, editingHud);
        }

        public static HudFocusMode ResolveFocusMode(bool recentCombat, bool activityActive,
                                                     bool detailHeld, bool editingHud)
        {
            if (detailHeld || editingHud) return HudFocusMode.Detailed;
            if (recentCombat) return HudFocusMode.Combat;
            return activityActive ? HudFocusMode.Activity : HudFocusMode.Exploration;
        }

        public static bool ShowsIdentity(HudFocusMode focus)
        {
            return focus == HudFocusMode.Detailed;
        }

        public static bool ShowsQuickbar(HudFocusMode focus, bool mobile,
                                         bool radialOpen, bool transientStatus)
        {
            if (mobile) return false;
            return focus == HudFocusMode.Combat || focus == HudFocusMode.Detailed
                || radialOpen || transientStatus;
        }

        public static float MapFocusScale(bool mobile, HudFocusMode focus)
        {
            if (mobile) return 0.625f;
            return focus == HudFocusMode.Detailed || focus == HudFocusMode.Exploration
                ? 0.875f : 0.75f;
        }

        public static float CompactConsoleScale(bool mobile)
        {
            return mobile ? 0.75f : 0.875f;
        }

        public static float CompactConsoleFocusScale(bool mobile, HudFocusMode focus)
        {
            if (mobile) return CompactConsoleScale(true);
            return focus == HudFocusMode.Combat ? 1f : CompactConsoleScale(false);
        }

        public static Vector2 CompactConsolePosition(bool mobile)
        {
            return new Vector2(0f, mobile ? 20f : 16f);
        }

        public static Vector2 QuickbarFocusPosition(bool mobile, HudFocusMode focus)
        {
            if (focus == HudFocusMode.Detailed)
                return ResolveLayout(mobile).QuickbarPosition;
            return new Vector2(0f, mobile ? 112f : 92f);
        }

        public static Vector2 ClampBottomPanelPosition(Vector2 position, Vector2 panelSize,
                                                        float scale, Vector2 parentSize,
                                                        float padding = 8f)
        {
            float safeScale = Mathf.Max(0.01f, Mathf.Abs(scale));
            float safePadding = Mathf.Max(0f, padding);
            float halfWidth = Mathf.Max(0f, panelSize.x) * safeScale * 0.5f;
            float height = Mathf.Max(0f, panelSize.y) * safeScale;

            if (parentSize.x > 1f)
            {
                float minX = -parentSize.x * 0.5f + halfWidth + safePadding;
                float maxX = parentSize.x * 0.5f - halfWidth - safePadding;
                position.x = minX <= maxX ? Mathf.Clamp(position.x, minX, maxX) : 0f;
            }

            if (parentSize.y > 1f)
            {
                float maxY = parentSize.y - height - safePadding;
                position.y = maxY >= safePadding
                    ? Mathf.Clamp(position.y, safePadding, maxY)
                    : safePadding;
            }
            else
            {
                position.y = Mathf.Max(safePadding, position.y);
            }
            return position;
        }

        private static readonly Color Ink = new Color(0.90f, 0.78f, 0.43f, 1f);
        private static readonly Color MutedInk = new Color(0.73f, 0.66f, 0.43f, 1f);
        private static readonly Color Panel = new Color(0.055f, 0.06f, 0.052f, 0.91f);
        private static readonly Color Border = new Color(0.55f, 0.40f, 0.16f, 0.95f);

        private RoaHud _hud;
        private RoaQuickbar _quickbar;
        private RoaMinimap _minimap;
        private RoaCombat _combat;
        private RoaMobileControls _mobile;
        private RoaGlobalMap _globalMap;
        private RoaWorldActivityCanvas _worldActivity;
        private Canvas _canvas;
        private RectTransform _safeRoot;
        private GameObject _playerPanel;
        private GameObject _mapPanel;
        private CanvasGroup _mapGroup;
        private GameObject _quickPanel;
        private CanvasGroup _quickGroup;
        private GameObject _logPanel;
        private GameObject _systemPanel;
        private GameObject _connectionPanel;
        private Image _connectionBack;
        private Outline _connectionOutline;
        private Image _connectionDot;
        private Text _connectionTitle;
        private Text _connectionDetail;
        private bool _connectionInterrupted;
        private float _connectionRestoredUntil;
        private GameObject _consolePanel;
        private GameObject _compactConsolePanel;
        private CanvasGroup _consoleGroup;
        private CanvasGroup _compactConsoleGroup;
        private Text _compactHp;
        private Text _compactAp;
        private Text _compactWeapon;
        private Text _compactWeaponState;
        private Text _compactAmmo;
        private Image _compactHpFill;
        private HudFocusMode _focusMode;
        private bool _focusInitialized;
        private float _consoleBlend;
        private RawImage _playerFrame;
        private Text _nameText;
        private Text _statsText;
        private Text _fpsText;

        // Оружейная консоль: значения в боксах поверх арта weapon_ui.
        private readonly Image[] _leds = new Image[LedCount];
        private Text _consoleHp;
        private Text _consoleAp;
        private Text _consoleArmor;
        private Text _consoleDamage;
        private Text _consoleMag;
        private Text _consoleReserve;
        private Text _consoleAmmoType;
        private Text _consoleModeLabel;
        private Text _consoleWeaponState;
        private Text _consoleApCost;
        private Text _consoleAmmoMain;
        private Text _consoleWeaponName;
        private Image _conditionFill;
        private Texture2D _ledCircle;
        private RawImage _weaponArtImage;
        private RoaWeaponArt _weaponArt;

        /// <summary>Диодов на консоли; горит floor(ОД). renderWeaponReadout(), 13:243.</summary>
        private const int LedCount = 15;

        private static readonly Color LedOff = new Color(0.075f, 0.066f, 0.045f, 1f);
        private static readonly Color LedOn = new Color(0.51f, 0.847f, 0.38f, 1f);
        private static readonly Color ConsoleLabel = new Color(0.965f, 0.886f, 0.706f, 1f);
        private static readonly Color ConsoleValue = Color.white;
        private static readonly Color ConsoleAccent = new Color(0.941f, 0.824f, 0.541f, 1f);
        private static readonly Color HpHealthy = new Color(0.914f, 1f, 0.812f, 1f);
        private static readonly Color HpWarning = new Color(1f, 0.847f, 0.435f, 1f);
        private static readonly Color HpCritical = new Color(1f, 0.431f, 0.345f, 1f);
        private static readonly Color AmmoEmpty = new Color(1f, 0.427f, 0.337f, 1f);
        private RawImage _mapImage;
        private Text _mapTitle;
        private Text _cellText;
        private RectTransform _markerLayer;
        private Text _playerArrow;
        private readonly Image[] _markers = new Image[96];
        private readonly Button[] _slotButtons = new Button[RoaQuickbar.SlotCount];
        private readonly Text[] _slotTexts = new Text[RoaQuickbar.SlotCount];
        private Text _quickStatus;
        private Text _logText;
        private Text _systemText;
        private RoaInteraction _interaction;
        private readonly System.Collections.Generic.List<string> _systemLines = new System.Collections.Generic.List<string>();
        private string _lastCombatLine = string.Empty;
        private float _combatLogUntil;
        private string _lastInteractionStatus = string.Empty;
        private float _systemLastPushAt;
        private readonly Vector3[] _occupiedScreenCorners = new Vector3[4];

        /// <summary>Источник подсказок взаимодействия и статусов для системного журнала.</summary>
        public void SetInteraction(RoaInteraction interaction)
        {
            _interaction = interaction;
            if (interaction != null) interaction.HintCanvasDriven = true;
        }

        /// <summary>Appends visible HUD panel bounds in top-left screen-space coordinates.</summary>
        public int CollectOccupiedScreenRects(System.Collections.Generic.List<Rect> output)
        {
            if (output == null) throw new System.ArgumentNullException(nameof(output));
            int before = output.Count;
            AppendOccupiedScreenRect(_playerPanel, output);
            AppendOccupiedScreenRect(_mapPanel, output);
            AppendOccupiedScreenRect(_quickPanel, output);
            AppendOccupiedScreenRect(_logPanel, output);
            AppendOccupiedScreenRect(_systemPanel, output);
            AppendOccupiedScreenRect(_connectionPanel, output);
            AppendOccupiedScreenRect(_consolePanel, output);
            AppendOccupiedScreenRect(_compactConsolePanel, output);
            AppendOccupiedScreenRect(_economyRoot, output);
            AppendOccupiedScreenRect(_interactionPrompt, output);
            return output.Count - before;
        }

        private void AppendOccupiedScreenRect(GameObject panel,
            System.Collections.Generic.List<Rect> output)
        {
            if (panel == null || !panel.activeInHierarchy) return;
            RectTransform rect = panel.transform as RectTransform;
            if (rect == null) return;
            rect.GetWorldCorners(_occupiedScreenCorners);
            Vector2 bottomLeft = RectTransformUtility.WorldToScreenPoint(
                _canvas != null ? _canvas.worldCamera : null, _occupiedScreenCorners[0]);
            Vector2 topRight = RectTransformUtility.WorldToScreenPoint(
                _canvas != null ? _canvas.worldCamera : null, _occupiedScreenCorners[2]);
            if (topRight.x <= bottomLeft.x || topRight.y <= bottomLeft.y) return;
            output.Add(new Rect(bottomLeft.x, Screen.height - topRight.y,
                topRight.x - bottomLeft.x, topRight.y - bottomLeft.y));
        }

        private string _lastGlobalStatus = string.Empty;
        private float _globalStatusUntil;
        private Rect _lastSafeArea;
        private bool _lastMobile;
        private const float MinimapPixels = 164f;

        public void Configure(RoaHud hud, RoaQuickbar quickbar, RoaMinimap minimap,
                              RoaCombat combat, RoaMobileControls mobile, RoaGlobalMap globalMap)
        {
            _hud = hud;
            _quickbar = quickbar;
            _minimap = minimap;
            _combat = combat;
            _mobile = mobile;
            _globalMap = globalMap;
            ConfigureEconomyFeedback(hud != null ? hud.Socket : null);
            ClaimLegacyRenderers(true);
            if (_canvas == null) Build();
        }

        private void OnDestroy()
        {
            ReleaseEconomyFeedback();
            ClaimLegacyRenderers(false);
        }

        private void ClaimLegacyRenderers(bool claimed)
        {
            if (_hud != null) _hud.CanvasDriven = claimed;
            if (_quickbar != null) _quickbar.CanvasDriven = claimed;
            if (_minimap != null) _minimap.CanvasDriven = claimed;
            if (_combat != null) _combat.CanvasDriven = claimed;
        }

        private void Update()
        {
            if (!IsBuilt()) Rebuild();
            if (_canvas == null) return;
            UpdateSafeArea();
            bool worldHud = !RoaGameBootstrap.BlocksWorldHud;
            bool gameplayScreen = RoaGameBootstrap.Active != null
                ? RoaGameBootstrap.Active.InGame
                : _hud != null && _hud.HasState;
            // До входа в мир (экран аккаунта) HUD не показывается — как в web,
            // где #character-screen перекрывает всё.
            if (RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.FrontendVisible) worldHud = false;
            // На глобальной карте web-окно карты перекрывает HUD целиком.
            if (RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.OnGlobalMap) worldHud = false;
            bool mobile = MobileHudMode; // mobile HUD and touch controls use one authoritative mode
            bool detailsHeld = !mobile && (Input.GetKey(KeyCode.LeftAlt)
                || Input.GetKey(KeyCode.RightAlt));
            bool combatActive = _combat != null && _combat.CombatPresentationActive;
            bool activityActive = _worldActivity != null && _worldActivity.IsActivityRunning;
            HudFocusMode focus = ResolveFocusMode(combatActive, activityActive,
                detailsHeld, RoaHudLayout.Editing);
            RefreshHudFocus(worldHud, mobile, focus);

            bool stateVisible = worldHud && _hud != null && _hud.HasState;
            _playerPanel.SetActive(stateVisible && ShowsIdentity(focus));
            _mapPanel.SetActive(worldHud && _minimap != null);
            bool quickbarTransient = _quickbar != null
                && (!string.IsNullOrEmpty(_quickbar.CanvasStatus) || _quickbar.IsRadialOpen);
            _quickPanel.SetActive(worldHud && _quickbar != null && _quickbar.CanvasVisible
                && ShowsQuickbar(focus, mobile, _quickbar.IsRadialOpen, quickbarTransient));
            string latestCombat = _combat != null && _combat.LogLines.Count > 0
                ? _combat.LogLines[_combat.LogLines.Count - 1] : string.Empty;
            if (latestCombat != _lastCombatLine)
            {
                _lastCombatLine = latestCombat;
                if (!string.IsNullOrEmpty(latestCombat)) _combatLogUntil = Time.unscaledTime + 5f;
            }
            _logPanel.SetActive(worldHud && !mobile && !string.IsNullOrEmpty(latestCombat)
                && Time.unscaledTime < _combatLogUntil);
            RefreshConnectionStatus(gameplayScreen);
            RefreshSystemStatus(worldHud && !mobile);
            RefreshEconomyFeedback(worldHud);
            RefreshInteractionPrompt(worldHud);
            RefreshPlayer();
            RefreshConsole();
            RefreshMinimap();
            RefreshQuickbar();
            RefreshLog();
        }

        private bool IsBuilt()
        {
            return _canvas != null && _safeRoot != null && _playerPanel != null
                && _mapPanel != null && _mapGroup != null && _quickPanel != null
                && _quickGroup != null && _logPanel != null && _systemPanel != null
                && _connectionPanel != null && _connectionTitle != null && _connectionDetail != null
                && _economyRoot != null && _consolePanel != null && _compactConsolePanel != null
                && _interactionPrompt != null
                && _slotButtons[0] != null && _slotTexts[0] != null;
        }

        private void Rebuild()
        {
            if (_canvas != null) Destroy(_canvas.gameObject);
            _canvas = null;
            Build();
        }

        private void Build()
        {
            _focusInitialized = false;
            _consoleBlend = 0f;
            GameObject root = new GameObject("AdaptiveGameplayHud", typeof(RectTransform), typeof(Canvas),
                                             typeof(CanvasScaler), typeof(GraphicRaycaster));
            root.transform.SetParent(transform, false);
            _canvas = root.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 30;
            CanvasScaler scaler = root.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);
            _safeRoot = Rect("SafeArea", root.transform, Vector2.zero, Vector2.one,
                             new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            BuildPlayerPanel();
            BuildMinimapPanel();
            BuildWeaponConsole();
            BuildCompactWeaponConsole();
            BuildQuickbar();
            BuildInteractionPrompt();
            BuildSystemStatus();
            BuildConnectionStatus();
            BuildEconomyFeedback();
            BuildCombatLog();
            if (FindAnyObjectByType<EventSystem>() == null)
            {
                var events = new GameObject("HudEventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
                events.transform.SetParent(transform, false);
            }
            UpdateSafeArea(true);
        }

        /// <summary>
        /// Панель личности игрока — копия web-раскладки (17_player_frame_hud.css):
        /// готовый PNG, поверх которого в процентах позиционируются FPS с пингом,
        /// имя и чипы прогрессии. HP и ОД здесь НЕ живут — по канону HUD они
        /// показываются в оружейной консоли внизу.
        /// </summary>
        private void BuildPlayerPanel()
        {
            RectTransform panel = PanelRect("PlayerStatus", _safeRoot, new Vector2(0f, 1f),
                                            new Vector2(0f, 1f), new Vector2(12f, -12f), new Vector2(330f, 74f));
            _playerPanel = panel.gameObject;
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("status");

            _playerFrame = Raw("Frame", panel, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            _playerFrame.raycastTarget = false;
            _playerFrame.color = Color.clear;
            _playerFrame.enabled = false;
            Image accent = Bar("IdentityAccent", panel, new Vector2(10f, -65f), new Vector2(310f, 3f), ConsoleAccent).transform.parent.GetComponent<Image>();
            if (accent != null) accent.color = new Color(0.04f, 0.04f, 0.035f, 0.72f);

            _fpsText = Label("Diagnostics", panel, Vector2.zero, Vector2.zero, 1,
                             TextAnchor.MiddleLeft, Color.clear);
            _fpsText.gameObject.SetActive(false);
            _nameText = Label("Name", panel, new Vector2(14f, -8f), new Vector2(300f, 25f), 17,
                              TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            _statsText = Label("Progress", panel, new Vector2(14f, -35f), new Vector2(300f, 23f), 11,
                               TextAnchor.MiddleLeft, MutedInk, FontStyle.Bold);
            _statsText.supportRichText = true;
        }

        private void BuildMinimapPanel()
        {
            RectTransform panel = PanelRect("Minimap", _safeRoot, new Vector2(1f, 1f),
                                            new Vector2(1f, 1f), new Vector2(-16f, -16f), new Vector2(190f, 202f));
            _mapPanel = panel.gameObject;
            _mapGroup = panel.gameObject.AddComponent<CanvasGroup>();
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("minimap");
            _mapTitle = Label("Title", panel, new Vector2(10f, -7f), new Vector2(170f, 22f), 12,
                              TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            RectTransform map = Rect("Map", panel, new Vector2(0f, 1f), new Vector2(0f, 1f),
                                     new Vector2(0f, 1f), new Vector2(13f, -32f), new Vector2(MinimapPixels, MinimapPixels));
            _mapImage = map.gameObject.AddComponent<RawImage>();
            _mapImage.color = Color.white;
            _mapImage.raycastTarget = false;
            _markerLayer = Rect("Markers", map, Vector2.zero, Vector2.one,
                                new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            BuildGrid(map);
            _markerLayer.SetAsLastSibling();
            for (int i = 0; i < _markers.Length; i++)
            {
                RectTransform marker = Rect("Marker" + i, _markerLayer, Vector2.zero, Vector2.zero,
                                            new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(4f, 4f));
                _markers[i] = marker.gameObject.AddComponent<Image>();
                _markers[i].raycastTarget = false;
                _markers[i].gameObject.SetActive(false);
            }
            _playerArrow = Label("Player", _markerLayer, Vector2.zero, new Vector2(18f, 18f), 17,
                                 TextAnchor.MiddleCenter, new Color(0.94f, 0.82f, 0.28f), FontStyle.Bold);
            _playerArrow.text = "\u25b2";
            _playerArrow.rectTransform.anchorMin = Vector2.zero;
            _playerArrow.rectTransform.anchorMax = Vector2.zero;
            _playerArrow.rectTransform.pivot = new Vector2(0.5f, 0.5f);
            _cellText = Label("Cell", panel, new Vector2(13f, -190f), new Vector2(164f, 10f), 10,
                              TextAnchor.MiddleLeft, MutedInk);
            _cellText.gameObject.SetActive(false);
        }

        /// <summary>
        /// Оружейная консоль в стиле Fallout — центральный нижний модуль HUD.
        /// Точная копия web-раскладки: фон weapon_ui, поверх — проценты из
        /// 15_location_loading_screen.css:649-802. Внутри всегда есть действие,
        /// стоимость ОД, патроны, здоровье и броня — правило HUD web-клиента.
        /// </summary>
        private void BuildWeaponConsole()
        {
            // width min(1060px), aspect 2048/682, bottom 18 — как в css.
            RectTransform panel = Rect("WeaponConsole", _safeRoot, new Vector2(0.5f, 0f),
                                       new Vector2(0.5f, 0f), new Vector2(0.5f, 0f),
                                       new Vector2(0f, 72f), new Vector2(760f, 253f));
            _consolePanel = panel.gameObject;
            _consoleGroup = panel.gameObject.AddComponent<CanvasGroup>();
            _consoleGroup.interactable = false;
            _consoleGroup.blocksRaycasts = false;
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("console");

            var frame = panel.gameObject.AddComponent<RawImage>();
            frame.texture = Resources.Load<Texture2D>("RealmUi/weapon_ui");
            frame.raycastTarget = false;
            if (frame.texture == null)
                Debug.LogError("[ROA] Не найден арт консоли RealmUi/weapon_ui — HUD останется без фона.");

            // Ряд диодов: 31.5%/2.8%, ширина 37.5%, поровну по ряду.
            if (_ledCircle == null) _ledCircle = BuildCircleTexture();
            for (int i = 0; i < LedCount; i++)
            {
                float step = 0.375f / LedCount;
                RectTransform led = PercentRect("Led" + i, panel,
                    0.315f + step * i + step * 0.1f, 0.028f, step * 0.8f, 0.082f);
                var image = led.gameObject.AddComponent<Image>();
                image.sprite = Sprite.Create(_ledCircle,
                    new UnityEngine.Rect(0f, 0f, _ledCircle.width, _ledCircle.height),
                    new Vector2(0.5f, 0.5f));
                image.preserveAspect = true;
                image.color = LedOff;
                image.raycastTarget = false;
                _leds[i] = image;
            }

            _consoleHp = ConsoleBox(panel, "Hp", "ЗДОРОВЬЕ", 0.095f, 0.178f, 0.162f, 0.118f);
            _consoleAp = ConsoleBox(panel, "Ap", "ОД", 0.096f, 0.384f, 0.164f, 0.116f);
            _consoleArmor = ConsoleBox(panel, "Armor", "БРОНЯ", 0.094f, 0.605f, 0.18f, 0.122f);
            _consoleDamage = ConsoleBox(panel, "Damage", "УРОН", 0.767f, 0.175f, 0.145f, 0.117f);
            _consoleMag = ConsoleBox(panel, "Mag", "В МАГ.", 0.752f, 0.38f, 0.084f, 0.108f, 15);
            _consoleReserve = ConsoleBox(panel, "Reserve", "ЗАПАС", 0.841f, 0.38f, 0.085f, 0.108f, 15);
            _consoleAmmoType = ConsoleBox(panel, "AmmoType", "КАЛИБР", 0.757f, 0.564f, 0.168f, 0.156f);

            // Центральная сцена: 30%/16.5% 39.2%x56.5%.
            RectTransform stage = PercentRect("Stage", panel, 0.30f, 0.165f, 0.392f, 0.565f);
            _consoleModeLabel = PercentLabel("Mode", stage, 0.08f, 0.04f, 0.84f, 0.15f, 20,
                                             TextAnchor.MiddleCenter, new Color(0.851f, 0.718f, 0.412f), FontStyle.Bold);
            _consoleWeaponState = PercentLabel("WeaponState", stage, 0.08f, 0.19f, 0.84f, 0.10f, 11,
                                               TextAnchor.MiddleCenter, LedOn, FontStyle.Bold);
            // Силуэт оружия по центру сцены — web: 58% x 18% в центре
            // (15_css:787). Рендерится из той же GLB, что держит персонаж.
            RectTransform art = PercentRect("WeaponArt", stage, 0.21f, 0.30f, 0.58f, 0.34f);
            _weaponArtImage = art.gameObject.AddComponent<RawImage>();
            _weaponArtImage.raycastTarget = false;
            _weaponArtImage.enabled = false;

            _consoleApCost = PercentLabel("ApCost", stage, 0.10f, 0.62f, 0.26f, 0.25f, 24,
                                          TextAnchor.MiddleCenter, ConsoleAccent, FontStyle.Bold);
            _consoleAmmoMain = PercentLabel("AmmoMain", stage, 0.64f, 0.62f, 0.26f, 0.25f, 26,
                                            TextAnchor.MiddleCenter, ConsoleAccent, FontStyle.Bold);
            _consoleWeaponName = PercentLabel("WeaponName", stage, 0.23f, 0.68f, 0.54f, 0.16f, 13,
                                              TextAnchor.LowerCenter, new Color(0.902f, 0.808f, 0.592f, 0.72f));

            RectTransform conditionBack = PercentRect("Condition", stage, 0.31f, 0.885f, 0.38f, 0.05f);
            var back = conditionBack.gameObject.AddComponent<Image>();
            back.color = new Color(0.078f, 0.055f, 0.031f, 0.76f);
            back.raycastTarget = false;
            RectTransform fill = Rect("Fill", conditionBack, Vector2.zero, Vector2.one,
                                      new Vector2(0f, 0.5f), Vector2.zero, Vector2.zero);
            fill.offsetMin = new Vector2(1f, 1f);
            fill.offsetMax = new Vector2(-1f, -1f);
            _conditionFill = fill.gameObject.AddComponent<Image>();
            _conditionFill.color = new Color(0.878f, 0.769f, 0.376f, 1f);
            _conditionFill.raycastTarget = false;
        }

        public void SetWorldActivity(RoaWorldActivityCanvas activity)
        {
            _worldActivity = activity;
        }

        public bool IdentityVisible
        {
            get { return _playerPanel != null && _playerPanel.activeSelf; }
        }

        private void BuildCompactWeaponConsole()
        {
            RectTransform panel = PanelRect("CompactWeaponConsole", _safeRoot,
                new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0f, 16f),
                new Vector2(560f, 66f));
            _compactConsolePanel = panel.gameObject;
            _compactConsoleGroup = panel.gameObject.AddComponent<CanvasGroup>();
            _compactConsoleGroup.interactable = false;
            _compactConsoleGroup.blocksRaycasts = false;
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("console");

            Image background = panel.GetComponent<Image>();
            background.color = new Color(0.038f, 0.041f, 0.034f, 0.94f);
            Outline outline = panel.GetComponent<Outline>();
            outline.effectColor = new Color(ConsoleAccent.r, ConsoleAccent.g,
                ConsoleAccent.b, 0.58f);

            RectTransform hpTrack = Rect("HpTrack", panel, new Vector2(0f, 0f),
                new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(12f, 8f),
                new Vector2(126f, 4f));
            Image hpBack = hpTrack.gameObject.AddComponent<Image>();
            hpBack.color = new Color(0.12f, 0.09f, 0.06f, 0.9f);
            hpBack.raycastTarget = false;
            RectTransform hpFill = Rect("Fill", hpTrack, Vector2.zero, Vector2.one,
                new Vector2(0f, 0.5f), Vector2.zero, Vector2.zero);
            hpFill.offsetMin = Vector2.zero;
            hpFill.offsetMax = Vector2.zero;
            _compactHpFill = hpFill.gameObject.AddComponent<Image>();
            _compactHpFill.raycastTarget = false;

            _compactHp = Label("Hp", panel, new Vector2(12f, -8f), new Vector2(126f, 23f),
                13, TextAnchor.MiddleLeft, HpHealthy, FontStyle.Bold);
            _compactAp = Label("Ap", panel, new Vector2(12f, -32f), new Vector2(126f, 20f),
                11, TextAnchor.MiddleLeft, ConsoleAccent, FontStyle.Bold);

            RectTransform leftDividerRect = Rect("LeftDivider", panel,
                new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 1f),
                new Vector2(148f, -10f), new Vector2(2f, 46f));
            Image leftDivider = leftDividerRect.gameObject.AddComponent<Image>();
            leftDivider.color = new Color(ConsoleAccent.r, ConsoleAccent.g,
                ConsoleAccent.b, 0.38f);
            leftDivider.raycastTarget = false;
            RectTransform rightDividerRect = Rect("RightDivider", panel,
                new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(0f, 1f),
                new Vector2(426f, -10f), new Vector2(2f, 46f));
            Image rightDivider = rightDividerRect.gameObject.AddComponent<Image>();
            rightDivider.color = new Color(ConsoleAccent.r, ConsoleAccent.g,
                ConsoleAccent.b, 0.38f);
            rightDivider.raycastTarget = false;

            _compactWeapon = Label("Weapon", panel, new Vector2(164f, -7f),
                new Vector2(246f, 25f), 15, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            _compactWeaponState = Label("WeaponState", panel, new Vector2(164f, -34f),
                new Vector2(246f, 18f), 10, TextAnchor.MiddleCenter, LedOn, FontStyle.Bold);
            _compactAmmo = Label("Ammo", panel, new Vector2(440f, -10f),
                new Vector2(108f, 42f), 15, TextAnchor.MiddleCenter, ConsoleAccent, FontStyle.Bold);
            _compactAmmo.horizontalOverflow = HorizontalWrapMode.Wrap;
            _compactConsolePanel.SetActive(false);
        }

        /// <summary>Бокс консоли: подпись сверху, значение снизу, по центру.</summary>
        private Text ConsoleBox(RectTransform panel, string name, string title,
                                float left, float top, float width, float height,
                                int valueSize = 19)
        {
            RectTransform box = PercentRect(name, panel, left, top, width, height);
            Text label = PercentLabel("Label", box, 0f, 0f, 1f, 0.44f, 12,
                                      TextAnchor.MiddleCenter, ConsoleLabel, FontStyle.Bold);
            label.text = title;
            return PercentLabel("Value", box, 0f, 0.44f, 1f, 0.56f, valueSize,
                                TextAnchor.MiddleCenter, ConsoleValue, FontStyle.Bold);
        }

        /// <summary>Дочерний Rect по долям родителя от верхнего левого угла — как проценты в css.</summary>
        private static RectTransform PercentRect(string name, Transform parent,
                                                 float left, float top, float width, float height)
        {
            GameObject child = new GameObject(name, typeof(RectTransform));
            RectTransform rect = child.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = new Vector2(left, 1f - top - height);
            rect.anchorMax = new Vector2(left + width, 1f - top);
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            return rect;
        }

        private static Text PercentLabel(string name, Transform parent, float left, float top,
                                         float width, float height, int fontSize,
                                         TextAnchor alignment, Color color,
                                         FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = PercentRect(name, parent, left, top, width, height);
            Text label = rect.gameObject.AddComponent<Text>();
            label.font = RoaUiFont.Default;
            label.fontSize = fontSize;
            label.alignment = alignment;
            label.color = color;
            label.fontStyle = style;
            label.raycastTarget = false;
            label.supportRichText = false;
            label.horizontalOverflow = HorizontalWrapMode.Overflow;
            Shadow shadow = rect.gameObject.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.62f);
            shadow.effectDistance = new Vector2(1f, -1f);
            shadow.useGraphicAlpha = true;

            // Без этого Text выше своей области не рисуется ВООБЩЕ: в узких
            // боксах «В МАГ.»/«ЗАПАС» значения просто исчезали.
            label.verticalOverflow = VerticalWrapMode.Overflow;
            return label;
        }

        /// <summary>Круг для диода: у UI.Image без спрайта форма только квадратная.</summary>
        private static Texture2D BuildCircleTexture()
        {
            const int size = 24;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            float half = (size - 1f) * 0.5f;

            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float distance = Mathf.Sqrt((x - half) * (x - half) + (y - half) * (y - half)) / half;
                    float alpha = Mathf.Clamp01((1f - distance) * 6f);
                    texture.SetPixel(x, y, new Color(1f, 1f, 1f, alpha));
                }
            }

            texture.Apply();
            return texture;
        }

        private void BuildQuickbar()
        {
            RectTransform panel = PanelRect("Quickbar", _safeRoot, new Vector2(0.5f, 0f),
                                            new Vector2(0.5f, 0f), new Vector2(0f, 14f), new Vector2(566f, 54f));
            _quickPanel = panel.gameObject;
            _quickGroup = panel.gameObject.AddComponent<CanvasGroup>();
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("quickbar");
            for (int i = 0; i < _slotButtons.Length; i++)
            {
                int slot = i;
                RectTransform slotRect = Rect("Slot" + i, panel, new Vector2(0f, 1f), new Vector2(0f, 1f),
                                              new Vector2(0f, 1f), new Vector2(9f + i * 69f, -7f), new Vector2(64f, 38f));
                Image image = slotRect.gameObject.AddComponent<Image>();
                image.color = new Color(0.10f, 0.10f, 0.08f, 0.96f);
                Button button = slotRect.gameObject.AddComponent<Button>();
                button.targetGraphic = image;
                ColorBlock colors = button.colors;
                colors.highlightedColor = new Color(0.30f, 0.24f, 0.11f, 1f);
                colors.pressedColor = new Color(0.48f, 0.35f, 0.13f, 1f);
                button.colors = colors;
                button.onClick.AddListener(() => { if (_quickbar != null) _quickbar.TriggerSlot(slot); });
                _slotButtons[i] = button;
                _slotTexts[i] = Label("Label", slotRect, Vector2.zero, slotRect.sizeDelta, 11,
                                      TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
                Stretch(_slotTexts[i].rectTransform, new Vector2(3f, 3f));
            }
            _quickStatus = Label("Status", panel, new Vector2(10f, -46f), new Vector2(546f, 8f), 9,
                                 TextAnchor.MiddleCenter, MutedInk);
        }

        private void BuildCombatLog()
        {
            // Web держит журнал слева снизу без рамки (#log: left 8, снизу),
            // полупрозрачным текстом поверх мира.
            RectTransform panel = Rect("CombatLog", _safeRoot, new Vector2(0f, 0f),
                                       new Vector2(0f, 0f), new Vector2(0f, 0f),
                                       new Vector2(12f, 12f), new Vector2(360f, 118f));
            _logPanel = panel.gameObject;
            panel.gameObject.AddComponent<RoaHudDragHandle>().Configure("combatLog");
            _logText = Label("Lines", panel, new Vector2(0f, 0f), new Vector2(360f, 118f), 12,
                             TextAnchor.LowerLeft, new Color(0.86f, 0.82f, 0.68f, 0.92f));
            _logText.horizontalOverflow = HorizontalWrapMode.Wrap;
            _logText.verticalOverflow = VerticalWrapMode.Truncate;
        }

        /// <summary>
        /// Мобильный ландшафт по web (02_mobile_fullscreen_touch.css, 13:647, 17:197):
        /// рамка игрока ≈47vw слева сверху, оружейная консоль по центру внизу в
        /// масштабе 0.62 над зоной джойстика, миникарта меньше, системный журнал и
        /// лог боя скрыты — место занимают сенсорные кнопки.
        /// </summary>
        private bool MobileHudMode
        {
            get { return _mobile != null ? _mobile.ControlsEnabled : Application.isMobilePlatform; }
        }

        public HudFocusMode CurrentFocusMode { get { return _focusMode; } }

        private void RefreshHudFocus(bool worldHud, bool mobile, HudFocusMode resolved)
        {
            bool visible = worldHud && _hud != null && _hud.HasState;
            if (!visible)
            {
                _consolePanel.SetActive(false);
                _compactConsolePanel.SetActive(false);
                _focusInitialized = false;
                return;
            }

            if (!_focusInitialized || resolved != _focusMode)
            {
                _focusMode = resolved;
                ApplyPanelLayout((RectTransform)_quickPanel.transform,
                    ResolveLayout(mobile).QuickbarScale,
                    QuickbarFocusPosition(mobile, _focusMode));
                ApplyPanelLayout((RectTransform)_mapPanel.transform,
                    MapFocusScale(mobile, _focusMode), ResolveLayout(mobile).MapPosition);
                ApplyPanelLayout((RectTransform)_compactConsolePanel.transform,
                    CompactConsoleFocusScale(mobile, _focusMode),
                    CompactConsolePosition(mobile));
            }

            float target = resolved == HudFocusMode.Detailed ? 1f : 0f;
            if (!_focusInitialized)
            {
                _consoleBlend = target;
                _focusInitialized = true;
            }
            else
            {
                _consoleBlend = Mathf.MoveTowards(_consoleBlend, target,
                    Time.unscaledDeltaTime * 6.5f);
            }

            float fullAlpha = Mathf.SmoothStep(0f, 1f, _consoleBlend);
            float compactAlpha = Mathf.SmoothStep(0f, 1f, 1f - _consoleBlend);
            float focusFadeSpeed = Time.unscaledDeltaTime * 4.8f;
            if (_mapGroup != null)
                _mapGroup.alpha = Mathf.MoveTowards(_mapGroup.alpha,
                    FocusLayerAlpha(resolved, HudVisualLayer.Minimap), focusFadeSpeed);
            if (_quickGroup != null)
                _quickGroup.alpha = Mathf.MoveTowards(_quickGroup.alpha,
                    FocusLayerAlpha(resolved, HudVisualLayer.Quickbar), focusFadeSpeed);
            float weaponAlpha = FocusLayerAlpha(resolved, HudVisualLayer.WeaponConsole);
            _consolePanel.SetActive(fullAlpha > 0.01f);
            _compactConsolePanel.SetActive(compactAlpha > 0.01f);
            _consoleGroup.alpha = fullAlpha;
            _compactConsoleGroup.alpha = compactAlpha * weaponAlpha;
            ClampBottomPanelToSafeArea((RectTransform)_consolePanel.transform);
            ClampBottomPanelToSafeArea((RectTransform)_compactConsolePanel.transform);
        }

        private void ApplyAdaptiveLayout(bool mobile)
        {
            LayoutProfile layout = ResolveLayout(mobile);
            ApplyPanelLayout((RectTransform)_playerPanel.transform,
                layout.PlayerScale, layout.PlayerPosition);
            ApplyPanelLayout((RectTransform)_consolePanel.transform,
                layout.ConsoleScale, layout.ConsolePosition);
            ApplyPanelLayout((RectTransform)_compactConsolePanel.transform,
                CompactConsoleFocusScale(mobile, _focusMode), CompactConsolePosition(mobile));
            ApplyPanelLayout((RectTransform)_mapPanel.transform,
                MapFocusScale(mobile, _focusMode), layout.MapPosition);
            ApplyPanelLayout((RectTransform)_quickPanel.transform,
                layout.QuickbarScale, QuickbarFocusPosition(mobile, _focusMode));
        }

        private static void ApplyPanelLayout(RectTransform panel, float scale, Vector2 position)
        {
            panel.localScale = Vector3.one * scale;
            position = new Vector2(Mathf.Round(position.x), Mathf.Round(position.y));
            RoaHudDragHandle drag = panel.GetComponent<RoaHudDragHandle>();
            if (drag != null) drag.SetBasePosition(position);
            else panel.anchoredPosition = position;
        }

        private static void ClampBottomPanelToSafeArea(RectTransform panel)
        {
            if (panel == null) return;
            RectTransform parent = panel.parent as RectTransform;
            Vector2 parentSize = parent != null ? parent.rect.size : Vector2.zero;
            panel.anchoredPosition = ClampBottomPanelPosition(panel.anchoredPosition,
                panel.rect.size, panel.localScale.x, parentSize);
        }

        private void BuildSystemStatus()
        {
            // #system-log-panel: right 12, top 206 (под миникартой), width 190, max-height 138.
            RectTransform panel = PanelRect("SystemStatus", _safeRoot, new Vector2(1f, 1f),
                                            new Vector2(1f, 1f), new Vector2(-16f, -228f), new Vector2(190f, 82f));
            panel.GetComponent<Image>().color = new Color(0.031f, 0.039f, 0.039f, 0.42f);
            panel.GetComponent<Outline>().effectColor = new Color(0.89f, 0.765f, 0.431f, 0.36f);
            _systemPanel = panel.gameObject;
            RectTransform head = Rect("Head", panel, new Vector2(0f, 1f), new Vector2(1f, 1f),
                                      new Vector2(0.5f, 1f), Vector2.zero, new Vector2(0f, 28f));
            head.gameObject.AddComponent<Image>().color = new Color(0f, 0f, 0f, 0.24f);
            Text headText = Label("Title", head, new Vector2(9f, -4f), new Vector2(200f, 20f), 10,
                                  TextAnchor.MiddleLeft, ConsoleAccent, FontStyle.Bold);
            headText.text = "СИСТЕМА";
            _systemText = Label("Text", panel, new Vector2(9f, -32f), new Vector2(172f, 44f), 10,
                                TextAnchor.UpperLeft, new Color(0.624f, 0.784f, 0.816f, 1f));
            _systemText.horizontalOverflow = HorizontalWrapMode.Wrap;
            _systemText.verticalOverflow = VerticalWrapMode.Truncate;
            _systemText.lineSpacing = 1.1f;
            _systemPanel.SetActive(false);
        }

        private void BuildConnectionStatus()
        {
            RectTransform panel = PanelRect("ConnectionStatus", _safeRoot, new Vector2(0.5f, 1f),
                                            new Vector2(0.5f, 1f), new Vector2(0f, -14f),
                                            new Vector2(430f, 58f));
            _connectionPanel = panel.gameObject;
            _connectionBack = panel.GetComponent<Image>();
            _connectionOutline = panel.GetComponent<Outline>();

            if (_ledCircle == null) _ledCircle = BuildCircleTexture();
            RectTransform dot = Rect("State", panel, new Vector2(0f, 1f), new Vector2(0f, 1f),
                                     new Vector2(0.5f, 0.5f), new Vector2(21f, -29f),
                                     new Vector2(11f, 11f));
            _connectionDot = dot.gameObject.AddComponent<Image>();
            _connectionDot.sprite = Sprite.Create(_ledCircle,
                new UnityEngine.Rect(0f, 0f, _ledCircle.width, _ledCircle.height),
                new Vector2(0.5f, 0.5f));
            _connectionDot.preserveAspect = true;
            _connectionDot.raycastTarget = false;

            _connectionTitle = Label("Title", panel, new Vector2(40f, -7f),
                                     new Vector2(374f, 22f), 12,
                                     TextAnchor.MiddleLeft, ConsoleAccent, FontStyle.Bold);
            _connectionDetail = Label("Detail", panel, new Vector2(40f, -30f),
                                      new Vector2(374f, 18f), 10,
                                      TextAnchor.MiddleLeft, MutedInk);
            _connectionPanel.SetActive(false);
        }

        public static ConnectionBannerState DescribeConnection(
            RoaSocketClient.ConnectionPhase phase, int reconnectAttempt,
            float retryRemainingSeconds, string lastError, bool restored)
        {
            if (phase == RoaSocketClient.ConnectionPhase.Joined)
            {
                return restored
                    ? new ConnectionBannerState(ConnectionBannerKind.Restored,
                        "СВЯЗЬ ВОССТАНОВЛЕНА", "Мир снова синхронизирован с сервером")
                    : new ConnectionBannerState(ConnectionBannerKind.Hidden, string.Empty, string.Empty);
            }

            int attempt = Mathf.Max(1, reconnectAttempt);
            switch (phase)
            {
                case RoaSocketClient.ConnectionPhase.Disconnected:
                    int seconds = Mathf.Max(0, Mathf.CeilToInt(retryRemainingSeconds));
                    string retry = seconds > 0
                        ? "Повтор через " + seconds + " с · попытка " + attempt
                        : "Ожидаем повторное подключение · попытка " + attempt;
                    return new ConnectionBannerState(ConnectionBannerKind.Interrupted,
                        "СВЯЗЬ С ПУСТОШЬЮ ПОТЕРЯНА", retry);
                case RoaSocketClient.ConnectionPhase.Connecting:
                    return new ConnectionBannerState(ConnectionBannerKind.Connecting,
                        "ВОССТАНАВЛИВАЕМ СВЯЗЬ", "Подключение к серверу · попытка " + attempt);
                case RoaSocketClient.ConnectionPhase.Connected:
                case RoaSocketClient.ConnectionPhase.Joining:
                    return new ConnectionBannerState(ConnectionBannerKind.Synchronizing,
                        "СИНХРОНИЗИРУЕМ МИР", "Сервер отвечает · восстанавливаем персонажа");
                case RoaSocketClient.ConnectionPhase.Rejected:
                    return new ConnectionBannerState(ConnectionBannerKind.Rejected,
                        "СЕССИЯ ОТКЛОНЕНА", string.IsNullOrWhiteSpace(lastError)
                            ? "Вернитесь к выбору персонажа" : lastError.Trim());
                default:
                    return new ConnectionBannerState(ConnectionBannerKind.Hidden,
                        string.Empty, string.Empty);
            }
        }

        private void RefreshConnectionStatus(bool gameplayScreen)
        {
            RoaSocketClient socket = _hud != null ? _hud.Socket : null;
            if (!gameplayScreen || socket == null)
            {
                _connectionInterrupted = false;
                _connectionRestoredUntil = 0f;
                _connectionPanel.SetActive(false);
                return;
            }

            RoaSocketClient.ConnectionPhase phase = socket.Phase;
            if (phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                _connectionInterrupted = true;
                _connectionRestoredUntil = 0f;
            }
            else if (_connectionInterrupted)
            {
                _connectionInterrupted = false;
                _connectionRestoredUntil = Time.unscaledTime + 2.4f;
            }

            bool restored = phase == RoaSocketClient.ConnectionPhase.Joined
                && Time.unscaledTime < _connectionRestoredUntil;
            ConnectionBannerState state = DescribeConnection(phase, socket.ReconnectAttempt,
                socket.ReconnectDelayRemainingSeconds, socket.LastError, restored);
            bool visible = state.Kind != ConnectionBannerKind.Hidden;
            _connectionPanel.SetActive(visible);
            if (!visible) return;

            Color accent;
            if (state.Kind == ConnectionBannerKind.Restored)
                accent = new Color(0.46f, 0.84f, 0.42f, 1f);
            else if (state.Kind == ConnectionBannerKind.Rejected)
                accent = new Color(1f, 0.36f, 0.28f, 1f);
            else
                accent = new Color(1f, 0.72f, 0.25f, 1f);

            _connectionBack.color = new Color(0.035f, 0.04f, 0.035f, 0.94f);
            _connectionOutline.effectColor = new Color(accent.r, accent.g, accent.b, 0.82f);
            float pulse = state.Kind == ConnectionBannerKind.Restored
                ? 1f
                : 0.83f + 0.17f * Mathf.Sin(Time.unscaledTime * 4.6f);
            _connectionDot.color = new Color(accent.r, accent.g, accent.b, Mathf.Clamp01(pulse));
            _connectionTitle.color = accent;
            _connectionTitle.text = state.Title;
            _connectionDetail.text = state.Detail;
        }

        private void UpdateSafeArea(bool force = false)
        {
            Rect area = Screen.safeArea;
            bool mobile = MobileHudMode;
            if (!force && area == _lastSafeArea && mobile == _lastMobile) return;
            _lastSafeArea = area;
            _lastMobile = mobile;
            RoaUiScale.Apply(_canvas != null ? _canvas.GetComponent<CanvasScaler>() : null, mobile);
            Vector2 min = area.position;
            Vector2 max = area.position + area.size;
            min.x /= Mathf.Max(1f, Screen.width);
            min.y /= Mathf.Max(1f, Screen.height);
            max.x /= Mathf.Max(1f, Screen.width);
            max.y /= Mathf.Max(1f, Screen.height);
            _safeRoot.anchorMin = min;
            _safeRoot.anchorMax = max;
            _safeRoot.offsetMin = Vector2.zero;
            _safeRoot.offsetMax = Vector2.zero;
            ApplyAdaptiveLayout(mobile);
            ((RectTransform)_logPanel.transform).anchoredPosition = new Vector2(12f, mobile ? 142f : 12f);
            ((RectTransform)_systemPanel.transform).anchoredPosition = new Vector2(-16f, mobile ? -184f : -228f);
            ApplyInteractionPromptLayout(mobile);
        }

        private void PushSystemLine(string line)
        {
            if (_systemLines.Count > 0 && _systemLines[_systemLines.Count - 1] == line)
            {
                _systemLastPushAt = Time.unscaledTime;
                return;
            }
            _systemLines.Add(line);
            while (_systemLines.Count > 2) _systemLines.RemoveAt(0);
            _systemLastPushAt = Time.unscaledTime;
        }

        private void RefreshSystemStatus(bool worldHud)
        {
            string status = _globalMap != null ? (_globalMap.StatusText ?? string.Empty) : string.Empty;
            if (status != _lastGlobalStatus)
            {
                _lastGlobalStatus = status;
                if (!string.IsNullOrEmpty(status) && (_globalMap == null || !_globalMap.IsActive))
                    _globalStatusUntil = Time.unscaledTime + 5f;
            }

            if (!string.IsNullOrEmpty(status) && (_globalMap == null || !_globalMap.IsActive)
                && Time.unscaledTime < _globalStatusUntil)
                PushSystemLine(status);

            // Результаты взаимодействия остаются в журнале; доступное действие
            // постоянно показывает отдельная центральная плашка.
            if (_interaction != null)
            {
                string line = _interaction.StatusLine ?? string.Empty;
                if (line != _lastInteractionStatus)
                {
                    _lastInteractionStatus = line;
                    if (!string.IsNullOrEmpty(line)) PushSystemLine(line);
                }
            }

            // Журнал виден, пока есть свежие строки (последняя — не старше 12 с).
            // Как #system-log-panel: виден, пока есть строки (в web панель постоянная).
            bool visible = worldHud && _systemLines.Count > 0
                && Time.unscaledTime - _systemLastPushAt < 6f
                && (_globalMap == null || !_globalMap.IsActive);
            _systemPanel.SetActive(visible);
            if (visible) _systemText.text = string.Join("\n", _systemLines);
        }

        private void RefreshPlayer()
        {
            if (_hud == null || !_playerPanel.activeSelf) return;
            _playerFrame.texture = null;
            _playerFrame.enabled = false;
            _nameText.text = _hud.DisplayName;
            _statsText.text =
                "<color=#d7e3a2>УР.</color> <color=#ffd16b>" + _hud.Level + "</color>   "
                + "<color=#d7e3a2>ОПЫТ</color> <color=#ffd16b>" + _hud.Xp + "/" + Mathf.Max(1, _hud.XpNeeded) + "</color>";
        }

        /// <summary>
        /// Данные оружейной консоли. Формат повторяет renderWeaponReadout()
        /// (13_minimap_hud_loop.js:204): патроны с ведущими нулями, «—» у ближнего
        /// боя, диоды по текущим ОД, цвет здоровья по трети запаса.
        /// </summary>
        private void RefreshConsole()
        {
            if (_hud == null || (!_consolePanel.activeSelf && !_compactConsolePanel.activeSelf)) return;

            RoaWeaponData.Weapon weapon = RoaWeaponData.Get(_hud.WeaponId);
            RoaWeaponData.FireMode mode = RoaWeaponData.Mode(_hud.WeaponId,
                _combat != null ? _combat.FireMode : "single", _hud.WeaponSkillPercent);

            if (_weaponArt == null)
            {
                _weaponArt = gameObject.AddComponent<RoaWeaponArt>();
                _weaponArt.BaseUrl = RoaGameBootstrap.ActiveBaseUrl;
            }
            _weaponArt.Show(_hud.WeaponId);
            _weaponArtImage.texture = _weaponArt.ArtTexture;
            _weaponArtImage.enabled = _weaponArt.ArtTexture != null;

            float hpRatio = _hud.MaxHp > 0 ? Mathf.Clamp01((float)_hud.Hp / _hud.MaxHp) : 0f;
            _consoleHp.text = _hud.Hp + "/" + Mathf.Max(1, _hud.MaxHp);
            _consoleHp.color = hpRatio <= 0.25f ? HpCritical : (hpRatio <= 0.55f ? HpWarning : HpHealthy);

            _consoleAp.text = Mathf.FloorToInt(_hud.Ap) + "/" + Mathf.Max(1, _hud.MaxAp);

            _consoleArmor.text = _hud.ArmorThreshold.ToString();

            bool hasAmmo = !string.IsNullOrEmpty(weapon.AmmoType);
            bool hasLoadedRound = _combat != null ? _combat.HasUsableRound : _hud.Loaded > 0;
            int attackApCost = _combat != null ? _combat.CurrentAttackApCost : mode.ApCost;
            RoaWeaponReadiness.Frame readiness = _combat != null
                ? _combat.WeaponReadiness
                : RoaWeaponReadiness.Evaluate(
                    hasAmmo, hasLoadedRound, _hud.ReserveAmmo, _hud.Ap, attackApCost,
                    _hud.CooldownRemainingSeconds, false, 0f);
            _consoleDamage.text = Mathf.Max(1, Mathf.RoundToInt(weapon.DmgMin * mode.DamageMul))
                + "-" + Mathf.Max(1, Mathf.RoundToInt(weapon.DmgMax * mode.DamageMul));
            _consoleMag.text = hasAmmo ? _hud.Loaded + "/" + Mathf.Max(0, _hud.MagSize) : "—";
            _consoleReserve.text = hasAmmo ? _hud.ReserveAmmo.ToString() : "—";
            _consoleAmmoType.text = RoaWeaponData.AmmoLabel(weapon.AmmoType);

            _consoleModeLabel.text = mode.Label;
            _consoleWeaponState.text = readiness.Label;
            _consoleWeaponState.color = WeaponStateColor(readiness.Kind);
            _consoleApCost.text = attackApCost + " ОД";
            _consoleAmmoMain.text = hasAmmo ? _hud.Loaded.ToString("000") : "---";
            _consoleAmmoMain.color = hasAmmo && _hud.Loaded <= 0 ? AmmoEmpty : ConsoleAccent;
            _consoleWeaponName.text = weapon.Name;

            SetFill(_conditionFill, Mathf.Clamp01(_hud.Condition));

            int activeLeds = Mathf.Clamp(Mathf.FloorToInt(_hud.Ap), 0, LedCount);
            for (int i = 0; i < LedCount; i++)
                if (_leds[i] != null) _leds[i].color = i < activeLeds ? LedOn : LedOff;

            _compactHp.text = "HP  " + _hud.Hp + "/" + Mathf.Max(1, _hud.MaxHp);
            _compactHp.color = hpRatio <= 0.25f ? HpCritical
                : hpRatio <= 0.55f ? HpWarning : HpHealthy;
            _compactHpFill.color = _compactHp.color;
            SetFill(_compactHpFill, hpRatio);
            _compactAp.text = "ОД  " + Mathf.FloorToInt(_hud.Ap) + "/" + Mathf.Max(1, _hud.MaxAp)
                + "   БРОНЯ " + _hud.ArmorThreshold;
            _compactWeapon.text = weapon.Name;
            _compactWeaponState.text = mode.Label.ToUpperInvariant() + " · " + readiness.Label
                + " · " + attackApCost + " ОД";
            _compactWeaponState.color = WeaponStateColor(readiness.Kind);
            _compactAmmo.text = hasAmmo
                ? _hud.Loaded + "/" + Mathf.Max(0, _hud.MagSize) + "  +" + _hud.ReserveAmmo
                    + "\n" + RoaWeaponData.AmmoLabel(weapon.AmmoType)
                : "БЛИЖНИЙ\nБОЙ";
            _compactAmmo.color = hasAmmo && _hud.Loaded <= 0 ? AmmoEmpty : ConsoleAccent;
        }

        private static Color WeaponStateColor(RoaWeaponReadinessKind kind)
        {
            switch (kind)
            {
                case RoaWeaponReadinessKind.Ready:
                    return LedOn;
                case RoaWeaponReadinessKind.AttackPending:
                case RoaWeaponReadinessKind.Cooldown:
                case RoaWeaponReadinessKind.ReloadPending:
                case RoaWeaponReadinessKind.Reloading:
                    return ConsoleAccent;
                case RoaWeaponReadinessKind.Empty:
                    return HpWarning;
                default:
                    return AmmoEmpty;
            }
        }

        private void RefreshMinimap()
        {
            if (_minimap == null || !_mapPanel.activeSelf) return;
            if (!_minimap.IsReady)
            {
                _mapImage.enabled = false;
                _mapTitle.text = "\u041a\u0410\u0420\u0422\u0410: \u0417\u0410\u0413\u0420\u0423\u0417\u041a";
                _cellText.text = string.Empty;
                for (int i = 0; i < _markers.Length; i++) _markers[i].gameObject.SetActive(false);
                _playerArrow.gameObject.SetActive(false);
                return;
            }
            _mapImage.enabled = true;
            _mapImage.texture = _minimap.StaticTexture;
            _mapTitle.text = string.IsNullOrEmpty(_minimap.LocationName) ? "\u041a\u0430\u0440\u0442\u0430" : _minimap.LocationName;
            _cellText.text = _minimap.CellLabel;
            int count = Mathf.Min(_markers.Length, _minimap.Markers.Count);
            for (int i = 0; i < count; i++)
            {
                RoaMinimap.Marker marker = _minimap.Markers[i];
                Vector2 p = _minimap.WorldToMapNormalized(marker.Position);
                bool visible = p.x >= 0f && p.y >= 0f && p.x <= 1f && p.y <= 1f;
                Image image = _markers[i];
                image.gameObject.SetActive(visible);
                if (!visible) continue;
                image.rectTransform.anchoredPosition = new Vector2(p.x * MinimapPixels, p.y * MinimapPixels);
                ApplyMarkerStyle(image, marker.Kind);
            }
            for (int i = count; i < _markers.Length; i++) _markers[i].gameObject.SetActive(false);
            Vector2 player = _minimap.PlayerMapNormalized;
            bool playerVisible = _minimap.HasPlayer && player.x >= 0f && player.y >= 0f
                && player.x <= 1f && player.y <= 1f;
            _playerArrow.gameObject.SetActive(playerVisible);
            if (playerVisible)
            {
                _playerArrow.rectTransform.anchoredPosition = new Vector2(player.x * MinimapPixels, player.y * MinimapPixels);
                _playerArrow.rectTransform.localEulerAngles = new Vector3(0f, 0f, -_minimap.PlayerHeading);
            }
        }

        private void RefreshQuickbar()
        {
            if (_quickbar == null || !_quickPanel.activeSelf) return;
            for (int i = 0; i < _slotButtons.Length; i++)
            {
                string item = i < _quickbar.Slots.Count ? _quickbar.Slots[i] : string.Empty;
                _slotTexts[i].text = _quickbar.SlotLabel(i, item);
                Image image = _slotButtons[i].targetGraphic as Image;
                if (image == null) continue;
                if (_quickbar.IsSlotActive(i)) image.color = new Color(0.24f, 0.47f, 0.20f, 0.98f);
                else if (!string.IsNullOrEmpty(item) && !_quickbar.IsSlotAvailable(i))
                    image.color = new Color(0.18f, 0.18f, 0.17f, 0.82f);
                else image.color = new Color(0.10f, 0.10f, 0.08f, 0.96f);
            }
            _quickStatus.text = _quickbar.CanvasStatus;
        }

        private void RefreshLog()
        {
            if (_combat == null || !_logPanel.activeSelf) return;
            int start = Mathf.Max(0, _combat.LogLines.Count - 3);
            var text = new StringBuilder();
            for (int i = start; i < _combat.LogLines.Count; i++)
            {
                if (text.Length > 0) text.Append('\n');
                text.Append(_combat.LogLines[i]);
            }
            _logText.text = text.ToString();
        }

        private static void ApplyMarkerStyle(Image image, RoaMinimap.MarkerKind kind)
        {
            float size;
            switch (kind)
            {
                case RoaMinimap.MarkerKind.Enemy:
                    image.color = new Color(0.88f, 0.31f, 0.22f); size = 5f; break;
                case RoaMinimap.MarkerKind.FriendlyNpc:
                    image.color = new Color(0.46f, 0.75f, 0.62f); size = 5f; break;
                case RoaMinimap.MarkerKind.ServiceNpc:
                    image.color = new Color(0.95f, 0.75f, 0.30f); size = 6f; break;
                case RoaMinimap.MarkerKind.RemotePlayer:
                    image.color = new Color(0.44f, 0.67f, 0.90f); size = 6f; break;
                case RoaMinimap.MarkerKind.GroundItem:
                    image.color = new Color(0.90f, 0.84f, 0.50f); size = 4f; break;
                case RoaMinimap.MarkerKind.Container:
                    image.color = new Color(0.90f, 0.71f, 0.35f); size = 5f; break;
                case RoaMinimap.MarkerKind.Objective:
                    image.color = new Color(0.95f, 0.78f, 0.25f); size = 7f; break;
                case RoaMinimap.MarkerKind.Extraction:
                    image.color = new Color(0.42f, 0.82f, 0.40f); size = 8f; break;
                default:
                    image.color = new Color(0.78f, 0.62f, 0.30f); size = 4f; break;
            }
            image.rectTransform.sizeDelta = new Vector2(size, size);
        }

        private static void SetFill(Image image, float value)
        {
            RectTransform rect = image.rectTransform;
            rect.anchorMax = new Vector2(Mathf.Clamp01(value), 1f);
        }

        private static RectTransform PanelRect(string name, Transform parent, Vector2 anchor,
                                               Vector2 pivot, Vector2 position, Vector2 size)
        {
            RectTransform rect = Rect(name, parent, anchor, anchor, pivot, position, size);
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = Panel;
            image.raycastTarget = false;
            Outline outline = rect.gameObject.AddComponent<Outline>();
            outline.effectColor = Border;
            outline.effectDistance = new Vector2(1f, -1f);
            return rect;
        }

        private static Image Bar(string name, Transform parent, Vector2 position, Vector2 size, Color color)
        {
            RectTransform back = Rect(name + "Back", parent, new Vector2(0f, 1f), new Vector2(0f, 1f),
                                      new Vector2(0f, 1f), position, size);
            Image background = back.gameObject.AddComponent<Image>();
            background.color = new Color(0.04f, 0.04f, 0.035f, 0.96f);
            background.raycastTarget = false;
            RectTransform fillRect = Rect(name + "Fill", back, Vector2.zero, Vector2.one,
                                          new Vector2(0f, 0.5f), Vector2.zero, Vector2.zero);
            fillRect.offsetMin = new Vector2(1f, 1f);
            fillRect.offsetMax = new Vector2(-1f, -1f);
            Image fill = fillRect.gameObject.AddComponent<Image>();
            fill.color = color;
            fill.raycastTarget = false;
            return fill;
        }

        private static RawImage Raw(string name, Transform parent, Vector2 anchorMin, Vector2 anchorMax,
                                    Vector2 offsetMin, Vector2 offsetMax)
        {
            RectTransform rect = Rect(name, parent, anchorMin, anchorMax, new Vector2(0.5f, 0.5f),
                                      Vector2.zero, Vector2.zero);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
            return rect.gameObject.AddComponent<RawImage>();
        }

        private static Text Label(string name, Transform parent, Vector2 position, Vector2 size,
                                  int fontSize, TextAnchor alignment, Color color,
                                  FontStyle style = FontStyle.Normal)
        {
            RectTransform rect = Rect(name, parent, new Vector2(0f, 1f), new Vector2(0f, 1f),
                                      new Vector2(0f, 1f), position, size);
            Text label = rect.gameObject.AddComponent<Text>();
            label.font = RoaUiFont.Default;
            label.fontSize = fontSize;
            label.alignment = alignment;
            label.color = color;
            label.fontStyle = style;
            label.raycastTarget = false;
            label.supportRichText = false;
            Shadow shadow = rect.gameObject.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.62f);
            shadow.effectDistance = new Vector2(1f, -1f);
            shadow.useGraphicAlpha = true;
            return label;
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchorMin, Vector2 anchorMax,
                                          Vector2 pivot, Vector2 position, Vector2 size)
        {
            GameObject child = new GameObject(name, typeof(RectTransform));
            RectTransform rect = child.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        private static void Stretch(RectTransform rect, Vector2 inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.offsetMin = inset;
            rect.offsetMax = -inset;
        }

        private static void BuildGrid(RectTransform map)
        {
            for (int i = 1; i < 10; i++)
            {
                float point = i / 10f;
                RectTransform vertical = Rect("GridV" + i, map, new Vector2(point, 0f),
                                              new Vector2(point, 1f), new Vector2(0.5f, 0.5f),
                                              Vector2.zero, new Vector2(1f, 0f));
                Image vi = vertical.gameObject.AddComponent<Image>();
                vi.color = new Color(0.89f, 0.76f, 0.43f, 0.18f);
                vi.raycastTarget = false;
                RectTransform horizontal = Rect("GridH" + i, map, new Vector2(0f, point),
                                                new Vector2(1f, point), new Vector2(0.5f, 0.5f),
                                                Vector2.zero, new Vector2(0f, 1f));
                Image hi = horizontal.gameObject.AddComponent<Image>();
                hi.color = vi.color;
                hi.raycastTarget = false;
            }
        }
    }
}
