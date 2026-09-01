using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сайдбар глобальной карты в структуре web (#global-map-window .global-map-side,
    /// 03_hud_minimap_inventory_progression.css:362; текст — renderGlobalMapPanel,
    /// 12b_global_map_panel_window.js): заголовок «Глобальная карта», справа панель
    /// 340px с разделами МАРШРУТ (текст маршрута моноширинным), ДОСКА РАБОТ
    /// (контракты площадки под игроком),
    /// СИСТЕМНЫЙ ЖУРНАЛ, ГРУППА. Контакт на маршруте — блок с «Вступить / Обойти».
    /// Логика и серверные запросы остаются в RoaGlobalMap (фасад CanvasDriven…).
    /// </summary>
    public sealed class RoaGlobalMapCanvas : MonoBehaviour
    {
        public enum MapJourneyStage
        {
            Target = 0,
            Travel = 1,
            Arrival = 2,
            Location = 3
        }

        private sealed class MapLabelSlot
        {
            public GameObject Root;
            public RectTransform Rect;
            public Image Background;
            public Outline Outline;
            public Text Text;
        }

        private static readonly Color SideBg = new Color(0.03f, 0.07f, 0.045f, 1f);        // rgba(2,10,6,.72) на тёмном
        private static readonly Color SideBorder = new Color(0.494f, 0.784f, 0.357f, 0.34f);
        private static readonly Color Kicker = new Color(0.831f, 0.702f, 0.357f, 1f);      // #d4b35b
        private static readonly Color Mono = new Color(0.749f, 0.902f, 0.541f, 1f);        // #bfe68a
        private static readonly Color MonoBold = new Color(0.937f, 0.816f, 0.471f, 1f);    // #efd078
        private static readonly Color BoxBg = new Color(0.02f, 0.05f, 0.03f, 1f);
        private static readonly Color BoxBorder = new Color(0.494f, 0.784f, 0.357f, 0.28f);
        private static readonly Color BtnBg = new Color(0.165f, 0.141f, 0.098f, 1f);
        private static readonly Color BtnInk = new Color(0.898f, 0.78f, 0.486f, 1f);
        private static readonly Color BtnBorder = new Color(0.682f, 0.545f, 0.282f, 0.65f);
        private static readonly Color TitleInk = new Color(0.941f, 0.824f, 0.541f, 1f);

        public RoaGlobalMap Map;
        public RoaInteraction Interaction;
        public RoaHudCanvas HudCanvas;

        private Canvas _canvas;
        private GameObject _root;
        private RectTransform _side;
        private Image _sideBackground;
        private Text _mapContext;
        private Text _route;
        private Text _routeState;
        private Image _routeStateBackground;
        private Text _routeMeta;
        private Text _routeHint;
        private Text _routeRisk;
        private Image _routeRiskBackground;
        private RectTransform _routeBox;
        private RectTransform _routeProgressTrack;
        private RectTransform _routeProgressFill;
        private Image _routeProgressImage;
        private RectTransform _journeyFlow;
        private readonly List<Image> _journeyStepBackgrounds = new List<Image>();
        private readonly List<Text> _journeyStepLabels = new List<Text>();
        private Text _gestureHelp;
        private RectTransform _mapLabelLayer;
        private readonly List<MapLabelSlot> _mapLabelPool = new List<MapLabelSlot>();
        private readonly List<RoaGlobalMap.OverlayLabel> _mapLabelFrames = new List<RoaGlobalMap.OverlayLabel>();
        private readonly List<Rect> _occupiedMapLabels = new List<Rect>();
        private RectTransform _contactBox;
        private Text _contactTitle;
        private Text _contactDetails;
        private Button _contactEnter;
        private Button _contactAvoid;
        private Button _detailsToggle;
        private Text _detailsToggleLabel;
        private Button _focusPlayerButton;
        private Button _leavePartyButton;
        private Button _factionFilter;
        private Text _factionFilterLabel;
        private Button _eventFilter;
        private Text _eventFilterLabel;
        private Button _partyFilter;
        private Text _partyFilterLabel;
        private readonly List<GameObject> _detailObjects = new List<GameObject>();
        private readonly List<GameObject> _desktopDetailObjects = new List<GameObject>();
        private bool _detailsExpanded;
        private Text _worldChangeToast;
        private Image _worldChangeToastBackground;
        private CanvasGroup _worldChangeToastGroup;
        private string _lastWorldChangeKey = string.Empty;
        private float _worldChangeToastUntil;
        private RectTransform _hoverCard;
        private Image _hoverCardBackground;
        private Outline _hoverCardOutline;
        private Text _hoverKind;
        private Text _hoverTitle;
        private Text _hoverMeta;
        private RectTransform _workList;
        private readonly List<GameObject> _workRows = new List<GameObject>();
        private string _workSignature;
        private Text _systemLog;
        private RectTransform _partyList;
        private readonly List<GameObject> _partyRows = new List<GameObject>();
        private string _partySignature;
        private float _refreshAt;
        private readonly List<string> _logLines = new List<string>();
        private string _lastStatus = string.Empty;

        /// <summary>Ширина сайдбара в единицах канвы (340 px как в web).</summary>
        public const float SidebarWidth = 340f;
        public const float RouteCardHeight = 156f;
        public const float CompactSidebarHeight = 238f;
        public const float ContactSidebarHeight = 358f;
        public const float DesktopExpandedSidebarHeight = 468f;
        public const float MobileExpandedSidebarHeight = 338f;
        public MapJourneyStage JourneyStage { get; private set; }
        public int ActiveMapLabelCount { get; private set; }
        public int MapLabelPoolSize { get { return _mapLabelPool.Count; } }
        public bool RouteProgressVisible { get { return _routeProgressTrack != null && _routeProgressTrack.gameObject.activeSelf; } }
        public float RouteProgressFill { get { return _routeProgressFill != null ? _routeProgressFill.anchorMax.x : 0f; } }
        public int WorkListRebuildCount { get; private set; }
        public int PartyListRebuildCount { get; private set; }
        public bool DetailsExpanded { get { return _detailsExpanded; } }
        public bool HoverCardVisible { get { return _hoverCard != null && _hoverCard.gameObject.activeSelf; } }
        public float SidebarHeightValue { get { return _side != null ? _side.sizeDelta.y : 0f; } }

        private void Update()
        {
            bool visible = Map != null && Map.CanvasDriven && Map.IsActive;
            if (!visible)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                ActiveMapLabelCount = 0;
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            ApplyResponsiveLayout();
            UpdateWorldChangeToastVisual();
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.3f;
            Refresh();
        }

        private void LateUpdate()
        {
            if (_root == null || !_root.activeInHierarchy) return;
            RefreshHoverCard();
            RefreshMapLabels();
            UpdateWorldChangeToastVisual();
        }

        // ------------------------------------------------------------------

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("GlobalMapCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 35;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            _root = new GameObject("GlobalMapWindow", typeof(RectTransform));
            var rootRect = (RectTransform)_root.transform;
            rootRect.SetParent(canvasGo.transform, false);
            Stretch(rootRect, 0f);

            // .panel-title: «ГЛОБАЛЬНАЯ КАРТА» слева сверху.
            Text title = Label("Title", rootRect, 12, TextAnchor.MiddleLeft, TitleInk, FontStyle.Bold);
            title.text = "ГЛОБАЛЬНАЯ КАРТА";
            Place(title.rectTransform, 0f, 1f, 0f, 1f, new Vector2(18f, -40f), new Vector2(420f, -14f));

            _mapContext = Label("MapContext", rootRect, 10, TextAnchor.MiddleLeft, Mono,
                FontStyle.Bold);
            _mapContext.text = MapContextText("РЕГИОН", 0, 0);
            Place(_mapContext.rectTransform, 0f, 1f, 0f, 1f,
                new Vector2(18f, -58f), new Vector2(520f, -39f));

            _gestureHelp = Label("TouchGestureHelp", rootRect, 11, TextAnchor.MiddleCenter, Mono, FontStyle.Bold);
            _gestureHelp.text = "ЛКМ — МАРШРУТ  ·  WASD/ТЯНУТЬ — ОБЗОР  ·  ПКМ — ИНВ. Y  ·  КОЛЕСО — МАСШТАБ  ·  ЗАЖАТЬ КОЛЕСО — УГОЛ";
            Place(_gestureHelp.rectTransform, 0f, 0f, 1f, 0f,
                  new Vector2(18f, 16f), new Vector2(-SidebarWidth - 28f, 46f));

            _mapLabelLayer = Child("MapOverlayLabels", rootRect);
            Stretch(_mapLabelLayer, 0f);
            EnsureMapLabelPool(8);

            RectTransform toast = Child("WorldChangeToast", rootRect);
            Place(toast, 0.5f, 1f, 0.5f, 1f, new Vector2(-180f, -64f), new Vector2(180f, -24f));
            _worldChangeToastBackground = toast.gameObject.AddComponent<Image>();
            _worldChangeToastBackground.color = new Color(0.02f, 0.055f, 0.032f, 0.96f);
            _worldChangeToastBackground.raycastTarget = false;
            var toastOutline = toast.gameObject.AddComponent<Outline>();
            toastOutline.effectColor = new Color(0.48f, 0.88f, 0.34f, 0.72f);
            toastOutline.effectDistance = new Vector2(1f, -1f);
            _worldChangeToast = Label("Text", toast, 12, TextAnchor.MiddleCenter, MonoBold, FontStyle.Bold);
            _worldChangeToastGroup = toast.gameObject.AddComponent<CanvasGroup>();
            _worldChangeToastGroup.blocksRaycasts = false;
            _worldChangeToastGroup.interactable = false;
            Stretch(_worldChangeToast.rectTransform, 8f);
            toast.gameObject.SetActive(false);

            _hoverCard = Child("MapHoverCard", rootRect);
            Place(_hoverCard, 0f, 0f, 0f, 0f,
                new Vector2(18f, 58f), new Vector2(344f, 134f));
            _hoverCardBackground = _hoverCard.gameObject.AddComponent<Image>();
            _hoverCardBackground.color = new Color(0.018f, 0.045f, 0.028f, 0.96f);
            _hoverCardBackground.raycastTarget = false;
            _hoverCardOutline = _hoverCard.gameObject.AddComponent<Outline>();
            _hoverCardOutline.effectColor = new Color(0.82f, 0.70f, 0.36f, 0.72f);
            _hoverCardOutline.effectDistance = new Vector2(1f, -1f);
            _hoverKind = Label("Kind", _hoverCard, 10, TextAnchor.MiddleLeft, Kicker,
                FontStyle.Bold);
            Place(_hoverKind.rectTransform, 0f, 1f, 1f, 1f,
                new Vector2(10f, -22f), new Vector2(-10f, -5f));
            _hoverTitle = Label("Title", _hoverCard, 13, TextAnchor.MiddleLeft, MonoBold,
                FontStyle.Bold);
            Place(_hoverTitle.rectTransform, 0f, 1f, 1f, 1f,
                new Vector2(10f, -45f), new Vector2(-10f, -22f));
            _hoverMeta = Label("Meta", _hoverCard, 11, TextAnchor.MiddleLeft, Mono);
            Place(_hoverMeta.rectTransform, 0f, 0f, 1f, 0f,
                new Vector2(10f, 7f), new Vector2(-10f, 28f));
            _hoverCard.gameObject.SetActive(false);

            // .global-map-side
            RectTransform side = _side = Child("Side", rootRect);
            _sideBackground = side.gameObject.AddComponent<Image>();
            _sideBackground.color = SideBg;
            var outline = side.gameObject.AddComponent<Outline>();
            outline.effectColor = SideBorder;
            outline.effectDistance = new Vector2(1f, -1f);

            _detailsToggle = UiButton(side, "ПОДРОБНО", out _detailsToggleLabel, ToggleDetails);
            Place((RectTransform)_detailsToggle.transform, 1f, 1f, 1f, 1f,
                new Vector2(-112f, -30f), new Vector2(-10f, -7f));

            _focusPlayerButton = UiButton(side, "К ИГРОКУ", out _,
                () => Map?.FocusPlayerOnMap());
            Place((RectTransform)_focusPlayerButton.transform, 1f, 1f, 1f, 1f,
                new Vector2(-216f, -30f), new Vector2(-118f, -7f));

            float y = 36f;
            KickerLabel(side, "Маршрут", ref y);
            RectTransform routeBox = _routeBox = Box(side, RouteCardHeight, ref y);

            RectTransform routeStateBadge = Child("RouteStateBadge", routeBox);
            Place(routeStateBadge, 0f, 1f, 0f, 1f,
                new Vector2(9f, -29f), new Vector2(142f, -8f));
            _routeStateBackground = routeStateBadge.gameObject.AddComponent<Image>();
            _routeStateBackground.raycastTarget = false;
            _routeState = Label("Text", routeStateBadge, 10, TextAnchor.MiddleCenter,
                Color.white, FontStyle.Bold);
            Stretch(_routeState.rectTransform, 3f);

            RectTransform routeRiskBadge = Child("RouteRiskBadge", routeBox);
            Place(routeRiskBadge, 1f, 1f, 1f, 1f,
                new Vector2(-112f, -29f), new Vector2(-9f, -8f));
            _routeRiskBackground = routeRiskBadge.gameObject.AddComponent<Image>();
            _routeRiskBackground.raycastTarget = false;
            _routeRisk = Label("Text", routeRiskBadge, 10, TextAnchor.MiddleCenter,
                Color.white, FontStyle.Bold);
            Stretch(_routeRisk.rectTransform, 3f);

            _route = Label("Route", routeBox, 14, TextAnchor.MiddleLeft, MonoBold,
                FontStyle.Bold);
            _route.supportRichText = false;
            _route.horizontalOverflow = HorizontalWrapMode.Wrap;
            _route.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_route.rectTransform, 0f, 1f, 1f, 1f,
                new Vector2(9f, -57f), new Vector2(-9f, -33f));

            _routeMeta = Label("RouteMeta", routeBox, 11, TextAnchor.MiddleLeft, Mono);
            _routeMeta.horizontalOverflow = HorizontalWrapMode.Wrap;
            _routeMeta.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_routeMeta.rectTransform, 0f, 1f, 1f, 1f,
                new Vector2(9f, -79f), new Vector2(-9f, -58f));

            _routeHint = Label("RouteHint", routeBox, 10, TextAnchor.UpperLeft,
                new Color(Mono.r, Mono.g, Mono.b, 0.72f));
            _routeHint.horizontalOverflow = HorizontalWrapMode.Wrap;
            _routeHint.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_routeHint.rectTransform, 0f, 0f, 1f, 0f,
                new Vector2(9f, 45f), new Vector2(-9f, 68f));

            _journeyFlow = Child("JourneyFlow", routeBox);
            Place(_journeyFlow, 0f, 0f, 1f, 0f,
                new Vector2(9f, 20f), new Vector2(-9f, 41f));
            string[] journeyLabels = { "ЦЕЛЬ", "ПУТЬ", "ПРИБЫТИЕ", "ЛОКАЦИЯ" };
            for (int i = 0; i < journeyLabels.Length; i++)
            {
                RectTransform step = Child("JourneyStep:" + journeyLabels[i], _journeyFlow);
                float left = i / (float)journeyLabels.Length;
                float right = (i + 1f) / journeyLabels.Length;
                Place(step, left, 0f, right, 1f,
                    new Vector2(i == 0 ? 0f : 2f, 0f),
                    new Vector2(i == journeyLabels.Length - 1 ? 0f : -2f, 0f));
                Image background = step.gameObject.AddComponent<Image>();
                background.raycastTarget = false;
                Text label = Label("Text", step, i == 2 ? 8 : 9,
                    TextAnchor.MiddleCenter, Mono, FontStyle.Bold);
                label.raycastTarget = false;
                label.text = journeyLabels[i];
                Stretch(label.rectTransform, 2f);
                _journeyStepBackgrounds.Add(background);
                _journeyStepLabels.Add(label);
            }
            ApplyJourneyFlow(MapJourneyStage.Target, false, false);

            _leavePartyButton = UiButton(routeBox, "ПОКИНУТЬ", out _,
                () => Map?.RequestLeaveAttachedWorldParty());
            Place((RectTransform)_leavePartyButton.transform, 1f, 0f, 1f, 0f,
                new Vector2(-112f, 44f), new Vector2(-9f, 69f));
            _leavePartyButton.gameObject.SetActive(false);

            _routeProgressTrack = Child("RouteProgressTrack", routeBox);
            Place(_routeProgressTrack, 0f, 0f, 1f, 0f, new Vector2(9f, 8f), new Vector2(-9f, 14f));
            Image trackImage = _routeProgressTrack.gameObject.AddComponent<Image>();
            trackImage.color = new Color(0.11f, 0.16f, 0.11f, 0.95f);
            trackImage.raycastTarget = false;
            _routeProgressFill = Child("RouteProgressFill", _routeProgressTrack);
            _routeProgressFill.anchorMin = Vector2.zero;
            _routeProgressFill.anchorMax = new Vector2(0f, 1f);
            _routeProgressFill.offsetMin = Vector2.zero;
            _routeProgressFill.offsetMax = Vector2.zero;
            _routeProgressImage = _routeProgressFill.gameObject.AddComponent<Image>();
            _routeProgressImage.raycastTarget = false;
            _routeProgressTrack.gameObject.SetActive(false);

            // Контакт на маршруте (global-encounter-panel): показывается поверх доски работ.
            _contactBox = Box(side, 110f, ref y);
            _contactTitle = Label("ContactTitle", _contactBox, 12, TextAnchor.UpperLeft, MonoBold, FontStyle.Bold);
            Place(_contactTitle.rectTransform, 0f, 1f, 1f, 1f, new Vector2(9f, -26f), new Vector2(-9f, -8f));
            _contactDetails = Label("ContactDetails", _contactBox, 11, TextAnchor.UpperLeft, Mono);
            _contactDetails.horizontalOverflow = HorizontalWrapMode.Wrap;
            _contactDetails.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_contactDetails.rectTransform, 0f, 1f, 1f, 1f, new Vector2(9f, -66f), new Vector2(-9f, -28f));
            _contactEnter = UiButton(_contactBox, "Вступить", out _, () => Map.ResolveContact(true));
            Place((RectTransform)_contactEnter.transform, 0f, 0f, 0.5f, 0f, new Vector2(9f, 8f), new Vector2(-3f, 36f));
            _contactAvoid = UiButton(_contactBox, "Обойти", out _, () => Map.ResolveContact(false));
            Place((RectTransform)_contactAvoid.transform, 0.5f, 0f, 1f, 0f, new Vector2(3f, 8f), new Vector2(-9f, 36f));
            _contactBox.gameObject.SetActive(false);
            y -= 110f + 9f; // бокс контакта накладывается на доску работ, когда виден

            Text layersKicker = KickerLabel(side, "Слои карты", ref y);
            RectTransform filterBox = Box(side, 64f, ref y);
            _factionFilter = UiButton(filterBox, "ФРАКЦИИ", out _factionFilterLabel,
                () => Map.ToggleFactionLayer());
            Place((RectTransform)_factionFilter.transform, 0f, 0.43f, 0.34f, 1f,
                new Vector2(5f, 5f), new Vector2(-2f, -5f));
            _eventFilter = UiButton(filterBox, "СОБЫТИЯ", out _eventFilterLabel,
                () => Map.ToggleEventLayer());
            Place((RectTransform)_eventFilter.transform, 0.34f, 0.43f, 0.67f, 1f,
                new Vector2(2f, 5f), new Vector2(-2f, -5f));
            _partyFilter = UiButton(filterBox, "ОТРЯДЫ", out _partyFilterLabel,
                () => Map.TogglePartyLayer());
            Place((RectTransform)_partyFilter.transform, 0.67f, 0.43f, 1f, 1f,
                new Vector2(2f, 5f), new Vector2(-5f, -5f));

            Text legend = Label("MapLegend", filterBox, 9, TextAnchor.MiddleCenter, Mono);
            legend.supportRichText = true;
            legend.text = "<color=#50d1b2>◆ РЕСУРС</color>  ·  <color=#efa63d>▲ АВАНПОСТ</color>  ·  <color=#7adc7a>→ КАРАВАН</color>\n"
                        + "<color=#ef4029>! УГРОЗА</color>  ·  <color=#efd078>■ ПОСЕЛЕНИЕ</color>  ·  <color=#ff7a2e>● СОБЫТИЕ</color>";
            Place(legend.rectTransform, 0f, 0f, 1f, 0.43f,
                new Vector2(5f, 2f), new Vector2(-5f, -2f));

            Text workKicker = KickerLabel(side, "Контракты", ref y);
            _workList = ScrollBox(side, 0.13f, ref y);
            Text logKicker = KickerLabel(side, "Системный журнал", ref y);
            RectTransform logBox = Box(side, 92f, ref y);
            _systemLog = Label("Log", logBox, 11, TextAnchor.UpperLeft, Mono);
            _systemLog.horizontalOverflow = HorizontalWrapMode.Wrap;
            _systemLog.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(_systemLog.rectTransform, 8f);
            Text partyKicker = KickerLabel(side, "Группа", ref y);
            _partyList = ScrollBox(side, 0.12f, ref y);

            _detailObjects.Add(layersKicker.gameObject);
            _detailObjects.Add(filterBox.gameObject);
            _desktopDetailObjects.Add(workKicker.gameObject);
            _desktopDetailObjects.Add(_workList.parent.gameObject);
            logKicker.gameObject.SetActive(false);
            logBox.gameObject.SetActive(false);
            partyKicker.gameObject.SetActive(false);
            _partyList.parent.gameObject.SetActive(false);
            SetDetailObjectsVisible(false);

            _root.SetActive(false);
        }

        private void ToggleDetails()
        {
            _detailsExpanded = !_detailsExpanded;
            SetDetailObjectsVisible(_detailsExpanded && (Map == null || !Map.HasPendingContact));
            ApplyResponsiveLayout();
        }

        private void SetDetailObjectsVisible(bool visible)
        {
            for (int i = 0; i < _detailObjects.Count; i++)
                if (_detailObjects[i] != null && _detailObjects[i].activeSelf != visible)
                    _detailObjects[i].SetActive(visible);
            bool desktopVisible = visible && !MobileLayout();
            for (int i = 0; i < _desktopDetailObjects.Count; i++)
                if (_desktopDetailObjects[i] != null
                    && _desktopDetailObjects[i].activeSelf != desktopVisible)
                    _desktopDetailObjects[i].SetActive(desktopVisible);
            if (_detailsToggleLabel != null)
                _detailsToggleLabel.text = _detailsExpanded ? "СВЕРНУТЬ" : "ПОДРОБНО";
        }

        private bool MobileLayout()
        {
            return Application.isMobilePlatform
                || RoaGameBootstrap.Active?.MobileControls?.ControlsEnabled == true;
        }

        private void ApplyResponsiveLayout()
        {
            if (_side == null || _canvas == null) return;
            float scale = Mathf.Max(0.01f, _canvas.scaleFactor);
            float viewHeight = Screen.height / scale;
            bool mobile = MobileLayout();
            bool contact = Map != null && Map.HasPendingContact;
            bool expanded = _detailsExpanded && !contact;
            SetDetailObjectsVisible(expanded);

            if (mobile)
            {
                _side.anchorMin = new Vector2(0f, 0f);
                _side.anchorMax = new Vector2(1f, 0f);
                _side.pivot = new Vector2(0.5f, 0f);
                _side.anchoredPosition = new Vector2(0f, 10f);
                _side.sizeDelta = new Vector2(-20f,
                    SidebarHeight(mobile, expanded, contact, viewHeight));
                _gestureHelp.text = MapGestureHint(true, Map?.DetailTierLabel);
                Place(_gestureHelp.rectTransform, 0f, 0f, 1f, 0f,
                    new Vector2(14f, _side.sizeDelta.y + 16f), new Vector2(-14f, _side.sizeDelta.y + 44f));
            }
            else
            {
                _side.anchorMin = new Vector2(1f, 1f);
                _side.anchorMax = new Vector2(1f, 1f);
                _side.pivot = new Vector2(1f, 1f);
                _side.anchoredPosition = new Vector2(-14f, -14f);
                _side.sizeDelta = new Vector2(SidebarWidth,
                    SidebarHeight(mobile, expanded, contact, viewHeight));
                _gestureHelp.text = MapGestureHint(false, Map?.DetailTierLabel);
                Place(_gestureHelp.rectTransform, 0f, 0f, 1f, 0f,
                    new Vector2(18f, 16f), new Vector2(-SidebarWidth - 28f, 46f));
            }
        }

        public static float SidebarHeight(bool mobile, bool expanded, bool contact,
                                          float viewHeight)
        {
            float desired = contact ? ContactSidebarHeight
                : (expanded
                    ? (mobile ? MobileExpandedSidebarHeight : DesktopExpandedSidebarHeight)
                    : CompactSidebarHeight);
            float padding = mobile ? 20f : 28f;
            return Mathf.Min(desired, Mathf.Max(196f, viewHeight - padding));
        }

        public static string MapGestureHint(bool mobile, string detailTier)
        {
            string controls = mobile
                ? "КАСАНИЕ — МАРШРУТ  ·  ПОТЯНУТЬ — ОБЗОР  ·  ЩИПОК — МАСШТАБ"
                : "ЛКМ: НАЖАТЬ — МАРШРУТ  ·  WASD/ТЯНУТЬ — ОБЗОР  ·  ПКМ — ИНВ. Y  ·  КОЛЕСО — МАСШТАБ  ·  ЗАЖАТЬ КОЛЕСО — УГОЛ";
            return controls + "  ·  МАСШТАБ: " + (string.IsNullOrWhiteSpace(detailTier)
                ? "РЕГИОН"
                : detailTier.ToUpperInvariant());
        }

        private Rect CurrentSidebarScreenRect()
        {
            if (_side == null || !_side.gameObject.activeInHierarchy) return default;
            var corners = new Vector3[4];
            _side.GetWorldCorners(corners);
            float minX = Mathf.Min(corners[0].x, corners[2].x);
            float maxX = Mathf.Max(corners[0].x, corners[2].x);
            float minY = Mathf.Min(corners[0].y, corners[2].y);
            float maxY = Mathf.Max(corners[0].y, corners[2].y);
            return new Rect(minX, Screen.height - maxY, maxX - minX, maxY - minY);
        }

        private void RefreshWorldChangeToast()
        {
            if (Map == null || _worldChangeToast == null) return;
            string key = Map.WorldChangeKey;
            if (string.IsNullOrEmpty(key))
            {
                _lastWorldChangeKey = string.Empty;
                return;
            }
            if (string.Equals(key, _lastWorldChangeKey, System.StringComparison.Ordinal)) return;
            _lastWorldChangeKey = key;
            _worldChangeToast.text = Map.WorldChangeSummary;
            _worldChangeToastUntil = Time.unscaledTime + 5.5f;
            _worldChangeToast.transform.parent.gameObject.SetActive(true);
        }

        private void UpdateWorldChangeToastVisual()
        {
            if (_worldChangeToast == null || _worldChangeToastGroup == null) return;
            GameObject toast = _worldChangeToast.transform.parent.gameObject;
            float left = _worldChangeToastUntil - Time.unscaledTime;
            if (left <= 0f)
            {
                if (toast.activeSelf) toast.SetActive(false);
                return;
            }
            if (!toast.activeSelf) toast.SetActive(true);
            _worldChangeToastGroup.alpha = Mathf.Clamp01(left / 0.65f);
        }

        private void RefreshHoverCard()
        {
            if (_hoverCard == null) return;
            bool visible = Map != null && Map.HoverPreviewActive && !MobileLayout()
                && !Map.HasPendingContact;
            if (!visible)
            {
                if (_hoverCard.gameObject.activeSelf) _hoverCard.gameObject.SetActive(false);
                return;
            }

            if (!_hoverCard.gameObject.activeSelf) _hoverCard.gameObject.SetActive(true);
            Color accent = Map.HoverAccent;
            _hoverKind.text = Map.HoverSemantic;
            _hoverKind.color = accent;
            _hoverTitle.text = Map.HoverTitle;
            _hoverMeta.text = Map.HoverSummary;
            _hoverCardOutline.effectColor = new Color(accent.r, accent.g, accent.b, 0.82f);
            _hoverCardBackground.color = new Color(0.018f, 0.045f, 0.028f, 0.96f);
        }

        private void RefreshMapLabels()
        {
            if (_mapLabelLayer == null || Map == null)
            {
                HideMapLabels();
                return;
            }

            Camera camera = Camera.main;
            if (camera == null || Map.CollectOverlayLabels(_mapLabelFrames) == 0)
            {
                HideMapLabels();
                return;
            }

            RoaGlobalMap.MapPresentationProfile profile =
                RoaGlobalMap.PresentationProfile(Map.DetailTier);
            EnsureMapLabelPool(Mathf.Min(_mapLabelFrames.Count,
                profile.OverlayLabelLimit));
            _mapLabelFrames.Sort(CompareOverlayLabels);
            _occupiedMapLabels.Clear();
            Rect sidebar = CurrentSidebarScreenRect();
            _occupiedMapLabels.Add(new Rect(12f, 10f, 520f, 58f));
            _occupiedMapLabels.Add(new Rect(12f, 58f, 196f, 58f));
            if (_hoverCard != null && _hoverCard.gameObject.activeSelf)
                _occupiedMapLabels.Add(ScreenRect(_hoverCard));
            bool mobile = MobileLayout();
            if (mobile && sidebar.xMin > 60f)
                _occupiedMapLabels.Add(new Rect(12f, Screen.height - 54f, sidebar.xMin - 24f, 42f));

            int visible = 0;
            int labelLimit = profile.OverlayLabelLimit;
            for (int i = 0; i < _mapLabelFrames.Count; i++)
            {
                if (visible >= labelLimit) break;
                RoaGlobalMap.OverlayLabel frame = _mapLabelFrames[i];
                Vector3 projected = camera.WorldToScreenPoint(frame.World);
                if (projected.z <= 0f) continue;

                Vector2 point = new Vector2(projected.x, Screen.height - projected.y);
                Vector2 screenSize = OverlayLabelScreenSize(frame.Cluster, frame.Activity,
                    frame.Selected, _canvas.scaleFactor);
                if (!RoaGlobalMap.TryResolveOverlayLabelRect(point, sidebar, _occupiedMapLabels,
                    Screen.width, Screen.height, screenSize.x, screenSize.y,
                    out Rect resolved)) continue;

                MapLabelSlot slot = _mapLabelPool[visible++];
                slot.Root.SetActive(true);
                slot.Root.name = "MapOverlayLabel:" + frame.Id;
                slot.Rect.anchoredPosition = CanvasPositionForScreenRect(
                    resolved, Screen.width, Screen.height, _canvas.scaleFactor);
                slot.Rect.sizeDelta = CanvasSizeForScreenRect(resolved, _canvas.scaleFactor);
                slot.Text.text = frame.Selected ? "◆ " + frame.Text : frame.Text;
                slot.Text.alignment = frame.Activity ? TextAnchor.MiddleLeft : TextAnchor.MiddleCenter;
                slot.Text.fontSize = frame.Activity || frame.Selected ? 12 : 11;
                slot.Text.color = frame.Color;
                float alpha = frame.Selected ? 0.98f
                            : (frame.Activity ? 0.93f : (frame.Cluster ? 0.72f : 0.58f));
                slot.Background.color = new Color(0.018f, 0.045f, 0.028f, alpha);
                slot.Outline.effectColor = new Color(frame.Color.r, frame.Color.g, frame.Color.b,
                    frame.Selected ? 0.95f : 0.68f);
                slot.Outline.effectDistance = frame.Selected ? new Vector2(2f, -2f) : new Vector2(1f, -1f);
                _occupiedMapLabels.Add(resolved);
            }

            for (int i = visible; i < _mapLabelPool.Count; i++)
                if (_mapLabelPool[i].Root.activeSelf) _mapLabelPool[i].Root.SetActive(false);
            ActiveMapLabelCount = visible;
        }

        public static int OverlayLabelPriority(RoaGlobalMap.OverlayLabel label)
        {
            return label.Priority
                + (label.Activity ? 1000 : 0)
                + (label.Selected ? 10000 : 0)
                - (label.Cluster ? 500 : 0);
        }

        public static int CompareOverlayLabels(RoaGlobalMap.OverlayLabel left,
                                               RoaGlobalMap.OverlayLabel right)
        {
            int priority = OverlayLabelPriority(right).CompareTo(OverlayLabelPriority(left));
            if (priority != 0) return priority;
            return string.Compare(left.Id ?? string.Empty, right.Id ?? string.Empty,
                System.StringComparison.Ordinal);
        }

        private void EnsureMapLabelPool(int count)
        {
            if (_mapLabelLayer == null) return;
            while (_mapLabelPool.Count < count)
            {
                var root = new GameObject("MapOverlayLabel", typeof(RectTransform),
                    typeof(Image), typeof(Outline));
                RectTransform rect = (RectTransform)root.transform;
                rect.SetParent(_mapLabelLayer, false);
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                Image background = root.GetComponent<Image>();
                background.raycastTarget = false;
                var outline = root.GetComponent<Outline>();
                outline.useGraphicAlpha = true;
                Text text = Label("Text", rect, 11, TextAnchor.MiddleCenter, Mono, FontStyle.Bold);
                text.supportRichText = true;
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Truncate;
                Stretch(text.rectTransform, 6f);
                root.SetActive(false);
                _mapLabelPool.Add(new MapLabelSlot
                {
                    Root = root,
                    Rect = rect,
                    Background = background,
                    Outline = outline,
                    Text = text
                });
            }
        }

        private void HideMapLabels()
        {
            for (int i = 0; i < _mapLabelPool.Count; i++)
                if (_mapLabelPool[i].Root.activeSelf) _mapLabelPool[i].Root.SetActive(false);
            ActiveMapLabelCount = 0;
        }

        private static Rect ScreenRect(RectTransform rect)
        {
            if (rect == null) return default;
            var corners = new Vector3[4];
            rect.GetWorldCorners(corners);
            float minX = Mathf.Min(corners[0].x, corners[2].x);
            float maxX = Mathf.Max(corners[0].x, corners[2].x);
            float minY = Mathf.Min(corners[0].y, corners[2].y);
            float maxY = Mathf.Max(corners[0].y, corners[2].y);
            return new Rect(minX, Screen.height - maxY, maxX - minX, maxY - minY);
        }

        public static Vector2 CanvasPositionForScreenRect(Rect screenRect, int screenWidth,
                                                          int screenHeight, float canvasScale)
        {
            float scale = Mathf.Max(0.01f, canvasScale);
            return new Vector2((screenRect.center.x - screenWidth * 0.5f) / scale,
                (screenHeight - screenRect.center.y - screenHeight * 0.5f) / scale);
        }

        public static Vector2 OverlayLabelCanvasSize(bool cluster, bool activity, bool selected)
        {
            float width = cluster ? 92f : (activity ? 220f : (selected ? 156f : 140f));
            float height = cluster ? 24f : (activity ? 44f : 26f);
            return new Vector2(width, height);
        }

        public static Vector2 OverlayLabelScreenSize(bool cluster, bool activity, bool selected,
                                                     float canvasScale)
        {
            return OverlayLabelCanvasSize(cluster, activity, selected)
                * Mathf.Max(0.01f, canvasScale);
        }

        public static Vector2 CanvasSizeForScreenRect(Rect screenRect, float canvasScale)
        {
            float scale = Mathf.Max(0.01f, canvasScale);
            return new Vector2(screenRect.width / scale, screenRect.height / scale);
        }

        private Text KickerLabel(RectTransform side, string caption, ref float y)
        {
            Text text = Label("Kicker", side, 11, TextAnchor.MiddleLeft, Kicker, FontStyle.Bold);
            text.text = caption.ToUpperInvariant();
            Place(text.rectTransform, 0f, 1f, 1f, 1f, new Vector2(10f, -y - 16f), new Vector2(-10f, -y));
            y += 16f + 5f;
            return text;
        }

        private RectTransform Box(RectTransform side, float height, ref float y)
        {
            RectTransform box = Child("Box", side);
            Place(box, 0f, 1f, 1f, 1f, new Vector2(10f, -y - height), new Vector2(-10f, -y));
            box.gameObject.AddComponent<Image>().color = BoxBg;
            var outline = box.gameObject.AddComponent<Outline>();
            outline.effectColor = BoxBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            y += height + 9f;
            return box;
        }

        /// <summary>Прокручиваемый список фиксированной доли высоты сайдбара.</summary>
        private RectTransform ScrollBox(RectTransform side, float fraction, ref float y)
        {
            float height = Mathf.Round(fraction * 800f);
            RectTransform box = Box(side, height, ref y);
            var scroll = box.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            RoaUiScroll.Configure(scroll);
            scroll.scrollSensitivity = 24f;
            box.gameObject.AddComponent<RectMask2D>();
            RectTransform list = Child("List", box);
            list.anchorMin = new Vector2(0f, 1f);
            list.anchorMax = new Vector2(1f, 1f);
            list.pivot = new Vector2(0f, 1f);
            list.sizeDelta = Vector2.zero;
            var layout = list.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.spacing = 5f;
            layout.padding = new RectOffset(6, 6, 6, 6);
            layout.childForceExpandHeight = false;
            layout.childControlHeight = true;
            list.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = list;
            return list;
        }

        // ------------------------------------------------------------------

        private void Refresh()
        {
            Vector2 player = Map.PlayerXY;
            Vector2 selected = Map.SelectedXY;
            string attached = Map.AttachedPartyId;
            if (_gestureHelp != null) _gestureHelp.gameObject.SetActive(true);
            if (_mapContext != null)
                _mapContext.text = MapContextText(Map.DetailTierLabel,
                    Map.ActivityMarkerCount, Map.PartyMarkerCount);
            RefreshWorldChangeToast();
            SetFilterVisual(_factionFilter, _factionFilterLabel, Map.FactionLayerVisible);
            SetFilterVisual(_eventFilter, _eventFilterLabel, Map.EventLayerVisible);
            SetFilterVisual(_partyFilter, _partyFilterLabel, Map.PartyLayerVisible);
            SetRouteProgress(Map.TravelActive, Map.TravelProgress, Map.HasPendingContact);

            bool contact = Map.HasPendingContact;
            bool travelling = Map.TravelActive;
            bool routeRequest = Map.RouteRequestPending;
            bool rerouting = Map.RerouteRequestPending;
            bool arrivalPending = Map.ArrivalPending;
            bool locationEntryPending = Map.LocationEntryPending;
            bool attachedToParty = !string.IsNullOrEmpty(attached);
            bool same = Map.PlayerAtSelection;
            string risk = Map.SelectedRiskLabel;
            Color stateColor = RouteStateColor(routeRequest, rerouting, travelling, contact,
                arrivalPending, locationEntryPending, Map.PendingEntry, attachedToParty, same);
            _routeState.text = RouteStateLabel(routeRequest, rerouting, travelling, contact,
                arrivalPending, locationEntryPending, Map.PendingEntry, attachedToParty, same);
            _routeState.color = stateColor;
            _routeStateBackground.color = BadgeBackground(stateColor);
            _routeRisk.text = attachedToParty && !travelling
                ? "ВЕДЁТ ЛИДЕР"
                : "РИСК: " + risk.ToUpperInvariant();
            Color riskColor = attachedToParty && !travelling ? Mono : RiskColor(risk);
            _routeRisk.color = riskColor;
            _routeRiskBackground.color = BadgeBackground(riskColor);
            _leavePartyButton.gameObject.SetActive(attachedToParty);
            _routeHint.rectTransform.offsetMax = new Vector2(attachedToParty ? -120f : -9f, 68f);
            JourneyStage = ResolveJourneyStage(routeRequest, travelling, contact,
                Map.TravelProgress, arrivalPending, locationEntryPending, Map.PendingEntry, same);
            ApplyJourneyFlow(JourneyStage, contact, routeRequest || arrivalPending
                || locationEntryPending);

            if (locationEntryPending)
            {
                _route.text = Map.SelectedTitle;
                _routeMeta.text = "Вход подтверждён · загружаем локацию";
                _routeHint.text = "Локация загружается. Активность запустится автоматически.";
            }
            else if (arrivalPending)
            {
                _route.text = Map.SelectedTitle;
                _routeMeta.text = "Маршрут завершён · сервер подтверждает прибытие";
                _routeHint.text = "Прибытие подтверждается. Вход начнётся автоматически.";
            }
            else if (routeRequest)
            {
                _route.text = Map.SelectedTitle;
                _routeMeta.text = rerouting
                    ? "Сохраняем движение · рассчитываем новый путь"
                    : "Сервер рассчитывает путь к выбранной цели";
                _routeHint.text = "Можно сразу выбрать другую точку: будет применён последний маршрут.";
            }
            else if (travelling)
            {
                int pct = Mathf.RoundToInt(Map.TravelProgress * 100f);
                _route.text = Map.SelectedTitle;
                _routeMeta.text = pct + "% · " + FormatSeconds(Map.TravelSecondsLeft)
                    + " · " + Map.DistanceKm(player, selected).ToString("0.0") + " км";
                _routeHint.text = contact
                    ? "Примите решение о встрече, чтобы продолжить путь."
                    : "Клик по новой точке меняет путь. Вход — автоматически.";
            }
            else if (attachedToParty)
            {
                _route.text = attached;
                _routeMeta.text = "Маршрут и встречи контролирует лидер";
                _routeHint.text = "Покиньте отряд, чтобы выбрать собственную цель.";
            }
            else if (Map.PendingEntry)
            {
                _route.text = Map.PendingEntryTitle;
                _routeMeta.text = "Маршрут завершён · риск " + risk;
                _routeHint.text = "Кликните по локации ещё раз, чтобы войти, или выберите новую цель.";
            }
            else
            {
                GlobalMapNode playerNode = Map.PlayerNode;
                _route.text = Map.SelectedTitle;
                _routeMeta.text = same
                    ? (playerNode != null ? "Вы в зоне · " + Map.NodeTitle(playerNode) : "Текущая точка пустоши")
                    : Map.DistanceKm(player, selected).ToString("0.0") + " км · риск " + risk;
                _routeHint.text = same
                    ? "Кликните по этой точке, чтобы войти в локацию."
                    : "Клик строит маршрут сразу. Цель можно изменить в любой момент.";
            }

            // --- Контакт на маршруте ---
            _contactBox.gameObject.SetActive(contact);
            SetDetailObjectsVisible(_detailsExpanded && !contact);
            ApplyResponsiveLayout();
            if (contact)
            {
                _contactTitle.text = "Контакт: " + Map.PendingContactName;
                _contactDetails.text = Map.LocalIsLeader ? Map.PendingContactDetails : "Решение принимает лидер группы.";
                bool can = Map.LocalIsLeader && !Map.ContactDecisionPending;
                _contactEnter.interactable = can;
                _contactAvoid.interactable = can && !Map.PendingContactForced;
                _contactAvoid.gameObject.SetActive(!Map.PendingContactForced);
            }

            RefreshWorkBoard();
            RefreshLog();
            RefreshParty();
        }

        private void RefreshWorkBoard()
        {
            JObject site = Map.PlayerSiteData();
            var cards = new List<RoaInteraction.WorldTaskCard>();
            string siteKey = "none";
            if (site != null)
            {
                string currentSiteId = site["id"]?.ToString() ?? string.Empty;
                siteKey = currentSiteId + "|" + (site["name"]?.ToString() ?? currentSiteId);
                if (Interaction != null)
                {
                    foreach (RoaInteraction.WorldTaskCard card in Interaction.PipboyWorldTasks(true))
                    {
                        JToken issuer = null;
                        foreach (JToken token in Map.WastelandState?["worldTasks"] as JArray ?? new JArray())
                            if (token?["id"]?.ToString() == card.Id)
                                issuer = token["issuerSiteId"] ?? token["siteId"];
                        if (issuer?.ToString() == currentSiteId) cards.Add(card);
                    }
                }
            }

            if (!ListSignatureChanged(ref _workSignature, BuildWorkSignature(siteKey, cards))) return;
            WorkListRebuildCount++;
            foreach (GameObject row in _workRows) Destroy(row);
            _workRows.Clear();
            if (site == null)
            {
                AddNote(_workList, _workRows, "Доска контрактов доступна у поселения или точки мира.");
                return;
            }

            string siteId = site["id"]?.ToString() ?? string.Empty;
            AddNote(_workList, _workRows, site["name"]?.ToString() ?? siteId, true);
            foreach (RoaInteraction.WorldTaskCard card in cards) AddWorkRow(card);
            if (cards.Count == 0) AddNote(_workList, _workRows, "Контрактов на этой доске нет.");
        }

        private void AddWorkRow(RoaInteraction.WorldTaskCard card)
        {
            var row = new GameObject("Work:" + card.Id, typeof(RectTransform));
            row.transform.SetParent(_workList, false);
            bool hasButton = card.AcceptLabel != null || card.TrackLabel != null;
            row.AddComponent<LayoutElement>().preferredHeight = hasButton ? 66f : 40f;
            row.AddComponent<Image>().color = new Color(0.04f, 0.09f, 0.055f, 1f);
            var outline = row.AddComponent<Outline>();
            outline.effectColor = BoxBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var rect = (RectTransform)row.transform;
            Text title = Label("Title", rect, 11, TextAnchor.UpperLeft, MonoBold, FontStyle.Bold);
            title.text = card.Label.ToUpperInvariant() + " · " + card.Title;
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place(title.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -20f), new Vector2(-6f, -4f));
            Text reward = Label("Reward", rect, 10, TextAnchor.UpperLeft, Mono);
            reward.text = card.Reward;
            reward.verticalOverflow = VerticalWrapMode.Truncate;
            Place(reward.rectTransform, 0f, 1f, 1f, 1f, new Vector2(6f, -36f), new Vector2(-6f, -22f));
            if (hasButton)
            {
                string id = card.Id;
                string caption = card.AcceptLabel ?? card.TrackLabel;
                bool enabled = card.AcceptLabel == null || card.CanAccept;
                string action = card.AcceptLabel != null ? "accept" : "track";
                Button button = UiButton(rect, caption, out Text label, () => Interaction.PipboyWorldTaskAction(id, action));
                Place((RectTransform)button.transform, 0f, 0f, 0.6f, 0f, new Vector2(6f, 4f), new Vector2(0f, 26f));
                SetButton(button, label, enabled);
            }
            _workRows.Add(row);
        }

        private void RefreshLog()
        {
            string status = Map.StatusText ?? string.Empty;
            if (!string.IsNullOrEmpty(status) && status != _lastStatus)
            {
                _lastStatus = status;
                _logLines.Add(status);
                while (_logLines.Count > 6) _logLines.RemoveAt(0);
            }
            _systemLog.text = _logLines.Count == 0
                ? "События маршрута и системные сообщения появятся здесь."
                : string.Join("\n", _logLines);
        }

        private void RefreshParty()
        {
            string attached = Map.AttachedPartyId;
            if (!ListSignatureChanged(ref _partySignature, BuildPartySignature(attached))) return;
            PartyListRebuildCount++;
            foreach (GameObject row in _partyRows) Destroy(row);
            _partyRows.Clear();
            AddPartyRow("Вы", string.IsNullOrEmpty(attached) ? "Лидер" : "в отряде");
            if (!string.IsNullOrEmpty(attached))
            {
                AddPartyRow(attached, "караван");
                AddPartyLeaveAction();
            }
        }

        public static string BuildWorkSignature(string siteKey, IList<RoaInteraction.WorldTaskCard> cards)
        {
            var value = new StringBuilder(192);
            AppendSignature(value, siteKey);
            if (cards == null) return value.ToString();
            foreach (RoaInteraction.WorldTaskCard card in cards)
            {
                AppendSignature(value, card?.Id);
                AppendSignature(value, card?.Label);
                AppendSignature(value, card?.Title);
                AppendSignature(value, card?.Reward);
                AppendSignature(value, card?.AcceptLabel);
                AppendSignature(value, card?.TrackLabel);
                value.Append(card?.CanAccept == true ? '1' : '0').Append(';');
            }
            return value.ToString();
        }

        public static string BuildPartySignature(string attachedPartyId)
        {
            return string.IsNullOrEmpty(attachedPartyId) ? "self:leader" : "self:member|" + attachedPartyId;
        }

        public static bool ListSignatureChanged(ref string previous, string next)
        {
            if (string.Equals(previous, next, System.StringComparison.Ordinal)) return false;
            previous = next;
            return true;
        }

        private static void AppendSignature(StringBuilder target, string part)
        {
            part = part ?? string.Empty;
            target.Append(part.Length).Append(':').Append(part).Append('|');
        }

        private void AddPartyRow(string name, string meta)
        {
            var row = new GameObject("Party", typeof(RectTransform));
            row.transform.SetParent(_partyList, false);
            row.AddComponent<LayoutElement>().preferredHeight = 20f;
            var rect = (RectTransform)row.transform;
            Text n = Label("Name", rect, 12, TextAnchor.MiddleLeft, MonoBold, FontStyle.Bold);
            n.text = name;
            Place(n.rectTransform, 0f, 0f, 0.7f, 1f, new Vector2(2f, 0f), Vector2.zero);
            Text m = Label("Meta", rect, 11, TextAnchor.MiddleRight, Mono);
            m.text = meta;
            Place(m.rectTransform, 0.5f, 0f, 1f, 1f, Vector2.zero, new Vector2(-2f, 0f));
            _partyRows.Add(row);
        }

        private void AddPartyLeaveAction()
        {
            Button leave = UiButton(_partyList, "Покинуть отряд", out _,
                () => Map.RequestLeaveAttachedWorldParty());
            leave.gameObject.name = "PartyLeave";
            leave.gameObject.AddComponent<LayoutElement>().preferredHeight = 26f;
            _partyRows.Add(leave.gameObject);
        }

        private void AddNote(RectTransform list, List<GameObject> rows, string text, bool bold = false)
        {
            var row = new GameObject("Note", typeof(RectTransform));
            row.transform.SetParent(list, false);
            row.AddComponent<LayoutElement>().preferredHeight = 18f;
            Text label = Label("Text", (RectTransform)row.transform, 11, TextAnchor.MiddleLeft, bold ? MonoBold : new Color(Mono.r, Mono.g, Mono.b, 0.62f), bold ? FontStyle.Bold : FontStyle.Normal);
            label.text = text;
            label.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(label.rectTransform, 2f);
            rows.Add(row);
        }

        public static string MapContextText(string detailTier, int activities, int parties)
        {
            return "МАСШТАБ: " + (string.IsNullOrWhiteSpace(detailTier)
                    ? "РЕГИОН"
                    : detailTier.ToUpperInvariant())
                + "  ·  СОБЫТИЯ: " + Mathf.Max(0, activities)
                + "  ·  ОТРЯДЫ: " + Mathf.Max(0, parties);
        }

        public static string RouteStateLabel(bool travelling, bool contact, bool pendingEntry,
                                             bool attachedToParty, bool samePoint)
        {
            return RouteStateLabel(false, false, travelling, contact, pendingEntry,
                attachedToParty, samePoint);
        }

        public static string RouteStateLabel(bool routeRequest, bool rerouting, bool travelling,
                                             bool contact, bool pendingEntry,
                                             bool attachedToParty, bool samePoint)
        {
            return RouteStateLabel(routeRequest, rerouting, travelling, contact, false,
                false, pendingEntry, attachedToParty, samePoint);
        }

        public static string RouteStateLabel(bool routeRequest, bool rerouting, bool travelling,
                                             bool contact, bool arrivalPending,
                                             bool locationEntryPending, bool pendingEntry,
                                             bool attachedToParty, bool samePoint)
        {
            if (contact) return "КОНТАКТ";
            if (locationEntryPending) return "ВХОДИМ";
            if (arrivalPending) return "ПРИБЫТИЕ";
            if (routeRequest) return rerouting ? "МЕНЯЕМ ПУТЬ" : "РАСЧЁТ ПУТИ";
            if (travelling) return "В ПУТИ";
            if (attachedToParty) return "В ОТРЯДЕ";
            if (pendingEntry) return "ПРИБЫЛИ";
            return samePoint ? "НА МЕСТЕ" : "НОВАЯ ЦЕЛЬ";
        }

        public static Color RouteStateColor(bool travelling, bool contact, bool pendingEntry,
                                            bool attachedToParty, bool samePoint)
        {
            return RouteStateColor(false, false, travelling, contact, pendingEntry,
                attachedToParty, samePoint);
        }

        public static Color RouteStateColor(bool routeRequest, bool rerouting, bool travelling,
                                            bool contact, bool pendingEntry,
                                            bool attachedToParty, bool samePoint)
        {
            return RouteStateColor(routeRequest, rerouting, travelling, contact, false,
                false, pendingEntry, attachedToParty, samePoint);
        }

        public static Color RouteStateColor(bool routeRequest, bool rerouting, bool travelling,
                                            bool contact, bool arrivalPending,
                                            bool locationEntryPending, bool pendingEntry,
                                            bool attachedToParty, bool samePoint)
        {
            if (contact) return new Color(1f, 0.36f, 0.18f, 1f);
            if (locationEntryPending) return new Color(0.35f, 0.88f, 0.58f, 1f);
            if (arrivalPending) return new Color(0.48f, 0.91f, 1f, 1f);
            if (routeRequest) return rerouting
                ? new Color(1f, 0.67f, 0.22f, 1f)
                : new Color(0.48f, 0.91f, 1f, 1f);
            if (travelling) return new Color(0.30f, 0.88f, 1f, 1f);
            if (attachedToParty) return new Color(0.55f, 0.82f, 0.47f, 1f);
            if (pendingEntry || samePoint) return new Color(0.35f, 0.88f, 0.58f, 1f);
            return MonoBold;
        }

        public static MapJourneyStage ResolveJourneyStage(bool routeRequest, bool travelling,
            bool contact, float travelProgress, bool arrivalPending,
            bool locationEntryPending, bool pendingEntry, bool samePoint)
        {
            if (locationEntryPending || pendingEntry || (samePoint && !travelling
                && !routeRequest && !arrivalPending)) return MapJourneyStage.Location;
            if (arrivalPending || (travelling && !contact && travelProgress >= 0.92f))
                return MapJourneyStage.Arrival;
            if (routeRequest || travelling || contact) return MapJourneyStage.Travel;
            return MapJourneyStage.Target;
        }

        public static Color JourneyStepColor(int step, MapJourneyStage stage, bool contact,
                                             bool pending)
        {
            int current = Mathf.Clamp((int)stage, 0, 3);
            if (step < current) return new Color(0.35f, 0.78f, 0.50f, 1f);
            if (step > current) return new Color(0.35f, 0.43f, 0.31f, 0.72f);
            if (contact && stage == MapJourneyStage.Travel)
                return new Color(1f, 0.36f, 0.18f, 1f);
            return pending
                ? new Color(0.48f, 0.91f, 1f, 1f)
                : new Color(0.94f, 0.76f, 0.28f, 1f);
        }

        private void ApplyJourneyFlow(MapJourneyStage stage, bool contact, bool pending)
        {
            int count = Mathf.Min(_journeyStepBackgrounds.Count, _journeyStepLabels.Count);
            for (int i = 0; i < count; i++)
            {
                Color accent = JourneyStepColor(i, stage, contact, pending);
                _journeyStepBackgrounds[i].color = new Color(
                    accent.r * 0.16f, accent.g * 0.16f, accent.b * 0.16f,
                    i <= (int)stage ? 0.98f : 0.68f);
                _journeyStepLabels[i].color = accent;
            }
        }

        public static Color RiskColor(string risk)
        {
            string normalized = (risk ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized.Contains("высок")) return new Color(1f, 0.34f, 0.18f, 1f);
            if (normalized.Contains("сред")) return new Color(1f, 0.66f, 0.24f, 1f);
            return new Color(0.42f, 0.86f, 0.50f, 1f);
        }

        private static Color BadgeBackground(Color accent)
        {
            return new Color(accent.r * 0.18f, accent.g * 0.18f, accent.b * 0.18f, 0.96f);
        }

        private static string FormatSeconds(float seconds)
        {
            int total = Mathf.CeilToInt(seconds);
            return total >= 60 ? (total / 60) + " мин " + (total % 60) + " с" : total + " с";
        }

        public static float RouteProgressFillAmount(float progress)
        {
            return Mathf.Max(0.025f, Mathf.Clamp01(progress));
        }

        public static Color RouteProgressColor(bool contact)
        {
            return contact
                ? new Color(1f, 0.42f, 0.22f, 0.88f)
                : new Color(0.831f, 0.702f, 0.357f, 0.78f);
        }

        private void SetRouteProgress(bool visible, float progress, bool contact)
        {
            if (_routeProgressTrack == null || _routeProgressFill == null) return;
            if (_routeProgressTrack.gameObject.activeSelf != visible)
                _routeProgressTrack.gameObject.SetActive(visible);
            if (!visible) return;
            _routeProgressFill.anchorMax = new Vector2(RouteProgressFillAmount(progress), 1f);
            if (_routeProgressImage != null) _routeProgressImage.color = RouteProgressColor(contact);
        }

        private static void SetButton(Button button, Text label, bool enabled)
        {
            button.interactable = enabled;
            button.GetComponent<Image>().color = enabled ? BtnBg : new Color(BtnBg.r, BtnBg.g, BtnBg.b, 0.5f);
            label.color = enabled ? BtnInk : new Color(BtnInk.r, BtnInk.g, BtnInk.b, 0.45f);
        }

        private static void SetFilterVisual(Button button, Text label, bool active)
        {
            if (button == null || label == null) return;
            button.interactable = true;
            Image image = button.GetComponent<Image>();
            if (image != null)
                image.color = active ? new Color(0.16f, 0.24f, 0.11f, 1f)
                                     : new Color(0.07f, 0.065f, 0.052f, 0.82f);
            label.color = active ? MonoBold : new Color(Mono.r, Mono.g, Mono.b, 0.48f);
        }

        // --- Утилиты ---------------------------------------------------------

        private static Button UiButton(RectTransform parent, string caption, out Text label, System.Action onClick)
        {
            var go = new GameObject("Btn:" + caption, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.color = BtnBg;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = BtnBorder;
            outline.effectDistance = new Vector2(1f, -1f);
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            label = Label("Label", (RectTransform)go.transform, 11, TextAnchor.MiddleCenter, BtnInk, FontStyle.Bold);
            label.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(label.rectTransform, 4f);
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

        private static void Place(RectTransform rect, float minX, float minY, float maxX, float maxY, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = new Vector2(minX, minY);
            rect.anchorMax = new Vector2(maxX, maxY);
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor, Color color, FontStyle style = FontStyle.Normal)
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
            Shadow shadow = rect.gameObject.AddComponent<Shadow>();
            shadow.effectColor = new Color(0f, 0f, 0f, 0.68f);
            shadow.effectDistance = new Vector2(1f, -1f);
            shadow.useGraphicAlpha = true;
            return text;
        }
    }
}
