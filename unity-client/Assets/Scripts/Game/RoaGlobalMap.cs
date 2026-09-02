using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Networking;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сервер-авторитетная глобальная карта. Геометрия берётся из
    /// /api/global-map, маршрут строит сервер, а клиент только показывает его
    /// и запрашивает прибытие после подтверждённого времени.
    /// </summary>
    public sealed class RoaGlobalMap : MonoBehaviour
    {
        public enum MapDetailTier
        {
            Far = 0,
            Medium = 1,
            Near = 2
        }

        /// <summary>
        /// One source of truth for the strategic-map hierarchy.  The map must not
        /// show the same amount of information at every zoom level: the region is
        /// for large decisions, the district is for choosing an activity and the
        /// local view is for precise contacts.
        /// </summary>
        public struct MapPresentationProfile
        {
            public bool TerritoryFill;
            public bool TerritoryBorder;
            public bool Influence;
            public bool Settlements;
            public bool Sites;
            public bool Parties;
            public bool Threats;
            public float SiteBucket;
            public float PartyBucket;
            public float ThreatBucket;
            public int OverlayLabelLimit;
            public int ActivityLabelLimit;
            public int InfrastructureLabelLimit;
        }

        public struct StrategicVisualProfile
        {
            public Color CameraBackground;
            public Color FogColor;
            public Color AmbientSky;
            public Color AmbientEquator;
            public Color AmbientGround;
            public float AmbientIntensity;
            public float ReflectionIntensity;
            public float FogStart;
            public float FogEnd;
        }

        /// <summary>Авторитетный час мира из снимка симуляции (0–24).</summary>
        public float WorldHour
        {
            get
            {
                float hour = _wasteland?["worldHour"]?.ToObject<float>() ?? 12f;
                return Mathf.Repeat(float.IsFinite(hour) ? hour : 12f, 24f);
            }
        }

        /// <summary>Мировой размах диорамы карты (для атмосферы и cookie облаков).</summary>
        public float MapWorldSpan
        {
            get { return Mathf.Max(MapWidthPoints, MapHeightPoints) * MapWorldScale; }
        }

        /// <summary>Корень диорамы карты; null до постройки сцены.</summary>
        public GameObject MapRoot { get { return _root; } }

        public static StrategicVisualProfile StrategicProfile(float mapSpan)
        {
            // Туман начинается ЗА играбельной диорамой: при прежнем 1.12×span
            // дальняя половина карты на обзорном зуме тонула в черноте.
            // Ambient поднят до читаемого дневного уровня — карта светлая даже
            // без пост-обработки (редакторские снимки и старые пресеты).
            // 1.28×span: играбельная диорама целиком до тумана, а токсичное
            // окружение и горизонт мягко растворяются, не показывая тайлинг.
            float span = Mathf.Max(40f, mapSpan);
            float fogStart = Mathf.Max(96f, span * 1.28f);
            return new StrategicVisualProfile
            {
                CameraBackground = new Color(0.052f, 0.046f, 0.037f, 1f),
                FogColor = new Color(0.055f, 0.048f, 0.038f, 1f),
                AmbientSky = new Color(0.63f, 0.545f, 0.42f, 1f),
                AmbientEquator = new Color(0.42f, 0.355f, 0.26f, 1f),
                AmbientGround = new Color(0.16f, 0.13f, 0.095f, 1f),
                AmbientIntensity = 1.18f,
                ReflectionIntensity = 0.32f,
                FogStart = fogStart,
                FogEnd = Mathf.Max(fogStart + 38f, span * 1.95f)
            };
        }

        public static float PresentationVisibility(float current, bool visible,
                                                   float unscaledDeltaTime)
        {
            float target = visible ? 1f : 0f;
            return Mathf.MoveTowards(Mathf.Clamp01(current), target,
                Mathf.Max(0f, unscaledDeltaTime) / 0.18f);
        }

        public static float PresentationVisibilityScale(float visibility, float detailScale)
        {
            float smooth = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(visibility));
            return Mathf.Max(0.01f, detailScale) * Mathf.Lerp(0.76f, 1f, smooth);
        }

        public static MapPresentationProfile PresentationProfile(MapDetailTier tier)
        {
            switch (tier)
            {
                case MapDetailTier.Near:
                    return new MapPresentationProfile
                    {
                        TerritoryFill = false,
                        TerritoryBorder = true,
                        Influence = true,
                        Settlements = true,
                        Sites = true,
                        Parties = true,
                        Threats = true,
                        SiteBucket = 0f,
                        PartyBucket = 0f,
                        ThreatBucket = 30f,
                        OverlayLabelLimit = 12,
                        ActivityLabelLimit = 3,
                        InfrastructureLabelLimit = 0
                    };
                // SiteBucket = 0: близкие точки не сворачиваются в «победителя»
                // с меткой «• N точек» — все маркеры видимы, а слишком близкие
                // визуально разносятся (ApplySiteSeparation).
                case MapDetailTier.Medium:
                    return new MapPresentationProfile
                    {
                        TerritoryFill = false,
                        TerritoryBorder = true,
                        Influence = false,
                        Settlements = true,
                        Sites = true,
                        Parties = true,
                        Threats = true,
                        SiteBucket = 0f,
                        PartyBucket = 42f,
                        ThreatBucket = 72f,
                        OverlayLabelLimit = 9,
                        ActivityLabelLimit = 3,
                        InfrastructureLabelLimit = 3
                    };
                default:
                    // РЕГИОН: заливка владений вместе с границами — контур
                    // региона читается сразу, названия рисует канва (регионные
                    // картографические подписи видны только на этом ярусе).
                    return new MapPresentationProfile
                    {
                        TerritoryFill = true,
                        TerritoryBorder = true,
                        Influence = false,
                        Settlements = true,
                        Sites = false,
                        Parties = false,
                        Threats = false,
                        SiteBucket = 0f,
                        PartyBucket = 0f,
                        ThreatBucket = 0f,
                        OverlayLabelLimit = 6,
                        ActivityLabelLimit = 2,
                        InfrastructureLabelLimit = 0
                    };
            }
        }

        public static bool TargetKindVisibleAtTier(string kind, MapDetailTier tier,
                                                   bool showEvents, bool showParties)
        {
            MapPresentationProfile profile = PresentationProfile(tier);
            string normalized = (kind ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "site") return profile.Sites;
            if (normalized == "party") return showParties && profile.Parties;
            if (normalized == "zone") return showEvents && profile.Threats;
            return true;
        }

        public static RoaActorPresentationTier StrategicActorPresentationTier(
            MapDetailTier mapTier, bool markerVisible, bool selected,
            Vector3 actorPosition, Vector3 observerPosition, bool mobile,
            RoaActorPresentationTier previous)
        {
            if (!markerVisible) return RoaActorPresentationTier.Hidden;
            if (mapTier != MapDetailTier.Near) return RoaActorPresentationTier.Far;
            if (selected) return RoaActorPresentationTier.Near;
            return RoaActorPresentationLod.Select(actorPosition, observerPosition,
                true, mobile, previous);
        }

        public struct OverlayLabel
        {
            public string Id;
            public string Text;
            public string Semantic;
            public Vector3 World;
            public Color Color;
            /// <summary>Фракционная лента у левого края плашки; alpha 0 — без ленты.</summary>
            public Color Accent;
            public bool Activity;
            public bool Selected;
            public bool Cluster;
            public int Priority;
        }

        private enum DynamicVisualLayer
        {
            TerritoryFill,
            TerritoryBorder,
            Influence,
            Settlement,
            Site,
            Party,
            Threat,
            Tracked
        }

        private sealed class DynamicVisualState
        {
            public GameObject Visual;
            public DynamicVisualLayer Layer;
            public GlobalMapPoint Point;
            /// <summary>Позиция до разнесения близких маркеров (идемпотентность).</summary>
            public Vector3 BaseLocalPosition;
            public Vector3 BaseScale;
            public bool Important;
            public int Priority;
            public bool TargetVisible = true;
            public float Visibility = 1f;
            public float DetailScale = 1f;
        }

        private sealed class PartyActorState
        {
            public string Id;
            public GameObject Root;
            public RoaGlobalMapActorView Actor;
            public DynamicTarget Target;
            public DynamicVisualState Presentation;
            public JObject Snapshot;
            public Vector3 BaseScale;
            public bool HasRenderedPoint;
        }

        private sealed class ActivityOverlayState
        {
            public string Id;
            public string Text;
            public GlobalMapPoint Point;
            public Color Color;
            public int Priority;
        }

        private const float MapWorldScale = 0.1f;
        private const float NodeSnapRadiusPoints = 18f;
        private const float DynamicSnapRadiusPoints = 13f;
        private const float WastelandRefreshSeconds = 5f;
        private const float WastelandMaxExtrapolationSeconds = 7.5f;
        private const float PartyPositionCorrectionRate = 8.5f;
        private const float PartyPositionSnapWorldDistance = 5f;
        private const float PartyFacingLookAheadSeconds = 0.2f;
        // Only bridges main-thread queue reordering; it is not a client authority timeout.
        private const float TravelDescriptorGraceSeconds = 2.5f;
        private const float TouchDragThresholdPixels = 14f;
        private const float TouchTapMaxSeconds = 0.55f;
        private const float MouseDragThresholdPixels = 9f;
        private const float MouseTapMaxSeconds = 0.75f;
        public const float StrategicDefaultPitchDeg = 55f;
        public const float StrategicDefaultYawDeg = 45f;
        public const float StrategicMinimumPitchDeg = 38f;
        public const float StrategicMaximumPitchDeg = 82f;
        public const float StrategicOrbitDegreesPerPixel = 0.18f;
        public const float StrategicMinimumCameraClearance = 10f;
        public const float StrategicKeyboardPanSpeedFactor = 0.28f;
        public const float StrategicKeyboardPanMinimumSpeed = 7.5f;
        public const float StrategicKeyboardPanMaximumSpeed = 32f;
        private const int LocationEntryAutomaticAttempts = 4;
        private const float LocationEntryRetryBaseSeconds = 1.25f;
        private const string AuthoredSceneName = "GlobalMapAuthored";
        private static readonly int BaseColorProperty = Shader.PropertyToID("_BaseColor");
        private static readonly int ColorProperty = Shader.PropertyToID("_Color");

        public RoaSocketClient Socket;
        public RoaCameraRig CameraRig;
        public string BaseUrl = "http://127.0.0.1:3000";

        public bool IsActive { get; private set; }
        public bool InputEnabled = true;
        public string StatusText { get; private set; } = string.Empty;
        public int TerritoryCellCount { get; private set; }
        public int TerritoryBorderCount { get; private set; }
        public int InfluenceZoneCount { get; private set; }
        public int SettlementModelCount { get; private set; }
        public int SiteMarkerCount { get; private set; }
        public int SettlementStatusCount { get; private set; }
        public int ThreatMarkerCount { get; private set; }
        public int ActivityMarkerCount
        {
            get { return _activityOverlayLabels != null ? _activityOverlayLabels.Count : 0; }
        }
        public int PartyMarkerCount
        {
            get
            {
                if (_dynamicTargets == null) return 0;
                int count = 0;
                for (int i = 0; i < _dynamicTargets.Count; i++)
                    if (_dynamicTargets[i] != null && _dynamicTargets[i].Kind == "party") count++;
                return count;
            }
        }
        public int PartyActorCount { get { return _partyActors != null ? _partyActors.Count : 0; } }
        public bool PlayerActorReady { get { return _playerActor != null && _playerActor.Ready; } }
        public string SelectionSummary { get { return BuildSelectionSummary(); } }
        public string FactionSummary { get { return BuildFactionSummary(); } }
        public string AttachedPartyId { get { return _state?["attachedPartyId"]?.ToString() ?? string.Empty; } }

        // --- Фасад для канва-сайдбара (RoaGlobalMapCanvas), структура renderGlobalMapPanel web (12b). ---

        /// <summary>Сайдбар рисует канва; IMGUI-панель информации не рисуется.</summary>
        public bool CanvasDriven { get; set; }

        public bool ArrivalPending { get { return _arrivalPending; } }
        public bool LocationEntryPending { get { return _locationEntryPending; } }
        public bool ContactDecisionPending { get { return _contactDecisionPending; } }
        public bool HasPendingContact { get { return _pendingContact != null; } }
        public string PendingContactName { get { return _pendingContact?.Name ?? "Событие пустоши"; } }
        public string PendingContactDetails { get { return _pendingContact?.Details ?? string.Empty; } }
        public bool PendingContactForced { get { return _pendingContact != null && _pendingContact.Forced; } }
        public bool LocalIsLeader { get { return IsLocalTravelLeader(); } }
        public JObject WastelandState { get { return _wasteland; } }
        public Vector2 PlayerXY { get { return _playerPoint != null ? new Vector2(_playerPoint.X, _playerPoint.Y) : Vector2.zero; } }
        public Vector2 SelectedXY { get { return _selectedPoint != null ? new Vector2(_selectedPoint.X, _selectedPoint.Y) : Vector2.zero; } }
        public float TravelProgress
        {
            get { return _travelActive ? Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / Mathf.Max(0.01f, _travelDuration)) : 0f; }
        }
        public float TravelSecondsLeft
        {
            get { return _travelActive ? Mathf.Max(0f, _travelDuration * (1f - TravelProgress)) : 0f; }
        }
        public bool RouteRequestPending { get { return _routeRequestPending; } }
        public bool RerouteRequestPending { get { return _routeRequestPending && _routeRequestWasReroute; } }
        public MapDetailTier DetailTier { get { return CurrentDetailTier(); } }
        public string DetailTierLabel { get { return DetailTierDisplayName(CurrentDetailTier()); } }
        public bool FactionLayerVisible { get { return _showFactions; } }
        public bool EventLayerVisible { get { return _showEvents; } }
        public bool PartyLayerVisible { get { return _showParties; } }
        public string WorldChangeKey { get { return BuildWorldChangeKey(); } }
        public string WorldChangeSummary { get { return BuildWorldChangeSummary(); } }
        public string SelectedRiskLabel { get { return BuildSelectedRiskLabel(); } }
        public bool HoverPreviewActive { get { return _hoverDynamic != null || _hoverNode != null; } }
        public string HoverTitle
        {
            get
            {
                if (_hoverDynamic != null) return _hoverDynamic.Name ?? _hoverDynamic.Id ?? "Точка пустоши";
                return _hoverNode != null ? NodeTitle(_hoverNode) : string.Empty;
            }
        }
        public string HoverSemantic
        {
            get
            {
                if (_hoverDynamic != null) return _hoverDynamic.Semantic;
                return _hoverNode != null ? "ПОСЕЛЕНИЕ" : string.Empty;
            }
        }
        public Color HoverAccent
        {
            get
            {
                if (_hoverDynamic != null) return _hoverDynamic.Accent;
                return _hoverNode != null ? new Color(0.94f, 0.82f, 0.47f, 1f) : Color.clear;
            }
        }
        public string HoverSummary
        {
            get
            {
                GlobalMapPoint point = _hoverDynamic?.Point
                    ?? (_hoverNode != null ? new GlobalMapPoint { X = _hoverNode.X, Y = _hoverNode.Y } : null);
                if (point == null) return string.Empty;
                float distance = DistanceKm(PlayerXY, new Vector2(point.X, point.Y));
                return distance.ToString("0.0") + " км · риск "
                    + RiskLabel(DangerAtPoint(point, _hoverDynamic)) + " · ЛКМ — маршрут";
            }
        }

        public void ToggleFactionLayer()
        {
            _showFactions = !_showFactions;
            ApplyDynamicPresentation(true);
        }

        public void ToggleEventLayer()
        {
            _showEvents = !_showEvents;
            ApplyDynamicPresentation(true);
        }

        public void TogglePartyLayer()
        {
            _showParties = !_showParties;
            ApplyDynamicPresentation(true);
        }

        /// <summary>Возвращает стратегическую камеру к позиции игрока, не меняя маршрут.</summary>
        public bool FocusPlayerOnMap()
        {
            if (!IsActive || _cameraAnchor == null || _root == null || _playerPoint == null)
                return false;
            Vector3 world = _root.transform.TransformPoint(
                PointToWorld(_playerPoint.X, _playerPoint.Y, 0f));
            world.y = _cameraAnchor.transform.position.y;
            _cameraAnchor.transform.position = ClampCameraPan(world,
                MapWidthPoints * MapWorldScale, MapHeightPoints * MapWorldScale);
            CameraRig?.SnapToTarget();
            StatusText = "Камера возвращена к игроку.";
            return true;
        }

        /// <summary>Клетка карты для точки — «Клетка cx:cy» в тексте маршрута web.</summary>
        public Vector2Int CellOf(Vector2 point)
        {
            if (_map == null || _map.Grid == null) return Vector2Int.zero;
            return new Vector2Int(
                Mathf.Clamp(Mathf.FloorToInt(point.x / _map.Grid.CellPoints), 0, _map.Grid.Cols - 1) + 1,
                Mathf.Clamp(Mathf.FloorToInt(point.y / _map.Grid.CellPoints), 0, _map.Grid.Rows - 1) + 1);
        }

        public float DistanceKm(Vector2 a, Vector2 b)
        {
            if (_map == null || _map.Grid == null) return 0f;
            float points = Vector2.Distance(a, b);
            return points / Mathf.Max(0.001f, _map.Grid.CellPoints) * _map.Grid.CellKm;
        }

        /// <summary>Имя выбранной цели: динамический объект, узел карты или точка пустоши.</summary>
        public string SelectedTitle
        {
            get
            {
                if (_selectedDynamic != null) return _selectedDynamic.Name ?? _selectedDynamic.Id ?? "точка пустоши";
                if (_selectedNode != null) return NodeTitle(_selectedNode);
                return "Точка пустоши";
            }
        }

        /// <summary>Узел (поселение/точка входа) под игроком, если он стоит в его радиусе.</summary>
        public GlobalMapNode PlayerNode { get { return _playerPoint != null ? NearestNode(_playerPoint, NodeSnapRadiusPoints) : null; } }
        public bool PlayerAtSelection { get { return _playerPoint != null && _selectedPoint != null && Distance(_playerPoint, _selectedPoint) <= 0.35f; } }

        /// <summary>Площадка живой пустоши под игроком (для доски работ сайдбара).</summary>
        public JObject PlayerSiteData()
        {
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null || _playerPoint == null) return null;
            GlobalMapNode node = PlayerNode;
            JObject nearest = null;
            float nearestDistance = 15f;
            foreach (JToken token in sites)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string id = row["id"]?.ToString() ?? string.Empty;
                string rowLocation = row["locationId"]?.ToString() ?? string.Empty;
                if (node != null && (id == node.Id || id == node.EffectiveLocationId || rowLocation == node.EffectiveLocationId)) return row;
                float distance = Distance(_playerPoint, ReadPoint(row, "x", "y", null));
                if (distance > nearestDistance) continue;
                nearest = row;
                nearestDistance = distance;
            }
            return nearest;
        }

        public string NodeTitle(GlobalMapNode node)
        {
            if (node == null) return string.Empty;
            string locationId = node.EffectiveLocationId;
            LocationDefinition definition = _bootstrap?.Loader != null ? _bootstrap.Loader.GetDefinition(locationId) : null;
            if (definition != null && !string.IsNullOrEmpty(definition.Name)) return definition.Name;
            foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
                if (token?["id"]?.ToString() == node.Id || token?["locationId"]?.ToString() == locationId)
                    return token["name"]?.ToString() ?? locationId;
            return locationId;
        }

        // Legacy pendingWorldDrop остаётся только для совместимости со старыми снимками.
        // Новый Unity-путь после подтверждённого прибытия входит в локацию автоматически.
        private bool _pendingEntry;
        public bool PendingEntry { get { return _pendingEntry; } }
        public string PendingEntryTitle { get { return _pendingEntry ? SelectedTitle : string.Empty; } }

        /// <summary>Подпись кнопки «Войти» и её доступность — как enterBtn в renderGlobalMapPanel.</summary>
        public bool CanEnter(out string label)
        {
            label = "Войти";
            if (_travelActive || _pendingContact != null || !string.IsNullOrEmpty(AttachedPartyId)
                || _arrivalPending || _locationEntryPending) return false;
            if (_pendingEntry) { label = "Войти: " + SelectedTitle; return true; }
            GlobalMapNode node = PlayerNode;
            if (node != null) { label = "Войти: " + NodeTitle(node); return true; }
            // Точка мира с локацией под игроком (globalMapWorldSiteCanEnter web).
            DynamicTarget site = _playerPoint != null ? NearestDynamicTarget(_playerPoint, DynamicSnapRadiusPoints) : null;
            if (site != null && !string.IsNullOrEmpty(site.LocationId) && site.Kind == "site")
            {
                label = "Войти: " + (site.Name ?? site.Id);
                return true;
            }
            return false;
        }

        public void EnterCurrent()
        {
            string label;
            if (!CanEnter(out label)) return;
            if (_pendingEntry && _pendingArrival != null)
            {
                _locationEntryAttempts = 0;
                _locationEntryRetryAt = 0f;
                RequestLocationEntry(_pendingArrival);
                return;
            }
            if (!_pendingEntry)
            {
                GlobalMapNode node = PlayerNode;
                _selectedNode = node;
                _selectedDynamic = node == null ? NearestDynamicTarget(_playerPoint, DynamicSnapRadiusPoints) : null;
                _selectedPoint = CopyPoint(_playerPoint);
            }
            _pendingEntry = false;
            RequestArrival();
        }

        public void CancelOrLeave()
        {
            if (!string.IsNullOrEmpty(AttachedPartyId)) RequestLeaveAttachedWorldParty();
            else CancelTravel();
        }

        public void ResolveContact(bool enter) { ResolveTravelContact(enter); }
        public void BeginTravel() { StartTravel(); }

        public string AttachedPartyTaskId { get { return _state?["attachedPartyTaskId"]?.ToString() ?? string.Empty; } }
        public bool TravelActive { get { return _travelActive; } }
        public bool ContactPending { get { return _pendingContact != null; } }
        public string PendingContactId { get { return _pendingContact?.Id ?? string.Empty; } }
        public float PlayerMapX { get { return _playerPoint.X; } }
        public float PlayerMapY { get { return _playerPoint.Y; } }
        public float SelectedMapX { get { return _selectedPoint.X; } }
        public float SelectedMapY { get { return _selectedPoint.Y; } }

        private RoaGameBootstrap _bootstrap;
        private GlobalMapDefinition _map;
        private JObject _state;

        private GameObject _root;
        private GameObject _playerMarker;
        private GameObject _selectionMarker;
        private GameObject _cameraAnchor;
        private Collider _terrainCollider;
        private List<GameObject> _routeVisuals = new List<GameObject>();
        private List<Vector3> _routeVisualBaseScales = new List<Vector3>();
        private List<float> _routeVisualProgress = new List<float>();
        private List<bool> _routeVisualShadows = new List<bool>();
        private float _appliedRouteProgress = -1f;
        private bool _appliedRouteContact;
        private float _routeDetailScale = 1f;
        private List<DynamicVisualState> _dynamicPresentationVisuals =
            new List<DynamicVisualState>();
        // UnityEngine native resources must be created from Awake/OnEnable, never
        // from a MonoBehaviour field initializer (which runs in its constructor).
        private MaterialPropertyBlock _colorBlock;

        private sealed class DynamicTarget
        {
            public string Kind;
            public string Id;
            public string Name;
            public string LocationId;
            public string SiteId;
            public string PartyId;
            public string WorldZoneId;
            public string Details;
            public string Faction;
            public GlobalMapPoint Point;
            public float Radius;
            public bool CanEnter;
            public bool Forced;
            public string Semantic;
            public Color Accent;
            public int Priority;
            public JObject Data;
        }

        private JObject _wasteland;
        private float _wastelandAppliedRealtime = -1f;
        private double _wastelandSampleAgeMs;
        private GameObject _dynamicRoot;
        private RoaUnityGlobalMapScene _authoredScene;
        private Scene _authoredUnityScene;
        private AsyncOperation _authoredSceneUnload;
        private Coroutine _wastelandPoll;
        private bool _wastelandFetchPending;
        private List<DynamicTarget> _dynamicTargets = new List<DynamicTarget>();
        private Dictionary<string, PartyActorState> _partyActors =
            new Dictionary<string, PartyActorState>(StringComparer.Ordinal);
        private HashSet<string> _seenPartyActors = new HashSet<string>(StringComparer.Ordinal);
        private RoaGlobalMapActorView _playerActor;
        private sealed class ActivityHighlightVisual
        {
            public GameObject Visual;
            public Vector3 BaseScale;
            public float Phase;
        }

        private List<ActivityHighlightVisual> _activityHighlightVisuals =
            new List<ActivityHighlightVisual>();
        private List<ActivityOverlayState> _activityOverlayLabels = new List<ActivityOverlayState>();
        private string _activityHighlightKey = string.Empty;
        private Dictionary<string, JObject> _territoryByCell = new Dictionary<string, JObject>();
        private DynamicTarget _selectedDynamic;
        private DynamicTarget _hoverDynamic;
        private GlobalMapNode _hoverNode;
        private string _factionSummary = string.Empty;
        [SerializeField] private bool _showFactions;
        [SerializeField] private bool _showEvents = true;
        [SerializeField] private bool _showParties = true;
        private MapDetailTier _appliedDetailTier = (MapDetailTier)(-1);
        private float _nextPresentationRefresh;

        private GlobalMapPoint _playerPoint = new GlobalMapPoint();
        private GlobalMapPoint _selectedPoint = new GlobalMapPoint();
        private GlobalMapNode _selectedNode;
        private List<GlobalMapPoint> _route = new List<GlobalMapPoint>();
        private float _travelDuration;
        private float _travelStartedRealtime;
        private bool _travelActive;
        private float _travelDescriptorGraceUntil;
        private int _routeRequestVersion;
        private bool _routeRequestPending;
        private bool _routeRequestWasReroute;
        private bool _arrivalPending;
        private bool _locationEntryPending;
        private JObject _pendingArrival;
        private string _pendingArrivalKey = string.Empty;
        private int _locationEntryAttempts;
        private float _locationEntryRetryAt;
        private float _arrivalRetryAt;
        private bool _contactArrival;
        private DynamicTarget _savedDestinationDynamic;
        private GlobalMapNode _savedDestinationNode;
        private GlobalMapPoint _savedDestinationPoint;
        private HashSet<string> _ignoredRouteContacts = new HashSet<string>();
        private DynamicTarget _pendingContact;
        private string _travelLeaderId = string.Empty;
        private bool _contactDecisionPending;
        private Vector2 _panelScroll;

        private bool _cameraSaved;
        private float _savedDistance;
        private float _savedMinDistance;
        private float _savedMaxDistance;
        private float _savedPitch;
        private float _savedYaw;
        private float _savedFieldOfView;
        private CameraClearFlags _savedCameraClearFlags;
        private Color _savedCameraBackground;
        private bool _mapLightingSaved;
        private RoaGlobalMapAtmosphere _atmosphere;
        private AmbientMode _savedAmbientMode;
        private Color _savedAmbientSky;
        private Color _savedAmbientEquator;
        private Color _savedAmbientGround;
        private float _savedAmbientIntensity;
        private float _savedReflectionIntensity;
        private bool _savedFog;
        private FogMode _savedFogMode;
        private Color _savedFogColor;
        private float _savedFogStartDistance;
        private float _savedFogEndDistance;
        private float _savedFogDensity;
        private Light _savedSun;
        private Vector3 _playerMarkerBaseScale = Vector3.one;
        private Vector3 _selectionMarkerBaseScale = Vector3.one;
        private Quaternion _playerMarkerBaseRotation = Quaternion.identity;
        private Quaternion _selectionMarkerBaseRotation = Quaternion.identity;
        private bool _cameraPanning;
        private Vector2 _lastPanPointer;
        private bool _cameraOrbiting;
        private Vector2 _lastOrbitPointer;
        private bool _mousePrimaryTracking;
        private bool _mousePrimaryDragging;
        private Vector2 _mousePrimaryStart;
        private Vector2 _mousePrimaryLast;
        private float _mousePrimaryStartedAt;
        private int _mapTouchFinger = -1;
        private Vector2 _mapTouchStart;
        private float _mapTouchStartedAt;
        private bool _mapTouchDragging;
        private bool _mapTouchBlocked;
        private bool _pinching;
        private int _pinchFingerA = -1;
        private int _pinchFingerB = -1;
        private float _pinchStartSpan;
        private float _pinchStartCameraDistance;
        private Vector2 _pinchLastCenter;
        private float _suppressSyntheticMouseUntil;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket,
                              RoaCameraRig cameraRig, string baseUrl)
        {
            EnsureRuntimeState();
            DetachSocket();
            _bootstrap = bootstrap;
            Socket = socket;
            CameraRig = cameraRig;
            BaseUrl = string.IsNullOrEmpty(baseUrl) ? BaseUrl : baseUrl;
            AttachSocket();
        }

        private void Awake()
        {
            EnsureRuntimeState();
        }

        private void OnEnable()
        {
            EnsureRuntimeState();
        }

        /// <summary>
        /// Unity can preserve a MonoBehaviour across script reload while dropping its
        /// non-serialized managed fields. Native Unity state must also be created here,
        /// outside the MonoBehaviour constructor. Restore both before gameplay resumes.
        /// </summary>
        private void EnsureRuntimeState()
        {
            if (_routeVisuals == null) _routeVisuals = new List<GameObject>();
            if (_routeVisualBaseScales == null) _routeVisualBaseScales = new List<Vector3>();
            if (_routeVisualProgress == null) _routeVisualProgress = new List<float>();
            if (_routeVisualShadows == null) _routeVisualShadows = new List<bool>();
            if (_dynamicPresentationVisuals == null)
                _dynamicPresentationVisuals = new List<DynamicVisualState>();
            if (_colorBlock == null) _colorBlock = new MaterialPropertyBlock();
            if (_dynamicTargets == null) _dynamicTargets = new List<DynamicTarget>();
            if (_partyActors == null)
                _partyActors = new Dictionary<string, PartyActorState>(StringComparer.Ordinal);
            if (_seenPartyActors == null)
                _seenPartyActors = new HashSet<string>(StringComparer.Ordinal);
            if (_activityHighlightVisuals == null)
                _activityHighlightVisuals = new List<ActivityHighlightVisual>();
            if (_activityOverlayLabels == null)
                _activityOverlayLabels = new List<ActivityOverlayState>();
            if (_territoryByCell == null) _territoryByCell = new Dictionary<string, JObject>();
            if (_playerPoint == null) _playerPoint = new GlobalMapPoint();
            if (_selectedPoint == null) _selectedPoint = new GlobalMapPoint();
            if (_route == null) _route = new List<GlobalMapPoint>();
            if (_ignoredRouteContacts == null) _ignoredRouteContacts = new HashSet<string>();
        }

        private void AttachSocket()
        {
            if (Socket == null) return;
            Socket.OnGlobalTravelStarted += HandleTravelStarted;
            Socket.OnGlobalTravelEnteredWorld += HandleEnteredWorld;
            Socket.OnGlobalTravelCancelled += HandleTravelCancelled;
            Socket.OnGlobalTravelArrived += HandleTravelArrived;
            Socket.OnGlobalTravelGroupReleased += HandleGroupReleased;
            Socket.OnGlobalTravelEncounterDecision += HandleEncounterDecision;
            Socket.OnWorldActivityFeedChanged += HandleWorldActivityFeedChanged;
        }

        private void DetachSocket()
        {
            if (Socket == null) return;
            Socket.OnGlobalTravelStarted -= HandleTravelStarted;
            Socket.OnGlobalTravelEnteredWorld -= HandleEnteredWorld;
            Socket.OnGlobalTravelCancelled -= HandleTravelCancelled;
            Socket.OnGlobalTravelArrived -= HandleTravelArrived;
            Socket.OnGlobalTravelGroupReleased -= HandleGroupReleased;
            Socket.OnGlobalTravelEncounterDecision -= HandleEncounterDecision;
            Socket.OnWorldActivityFeedChanged -= HandleWorldActivityFeedChanged;
        }

        private void HandleWorldActivityFeedChanged(JObject _)
        {
            if (IsActive && !_wastelandFetchPending) StartCoroutine(FetchWasteland());
        }

        private void OnDestroy()
        {
            DetachSocket();
            RestoreMapLighting();
            ClearVisuals();
        }

        /// <summary>Показать глобальную карту из self.globalMap успешного join.</summary>
        public IEnumerator EnterFromJoin(JoinAck ack, Action<bool, string> onDone)
        {
            JObject state = ack != null && ack.Self != null
                ? ack.Self["globalMap"] as JObject
                : null;

            if (state == null)
            {
                onDone?.Invoke(false, "В join нет авторитетного self.globalMap.");
                yield break;
            }

            yield return Enter(state, onDone);
        }

        /// <summary>Показать карту после globalTravelEnterWorld или события лидера.</summary>
        public IEnumerator Enter(JObject state, Action<bool, string> onDone)
        {
            EnsureRuntimeState();
            if (_wastelandPoll != null) StopCoroutine(_wastelandPoll);
            _wastelandPoll = null;
            if (_map == null)
            {
                bool loaded = false;
                string loadError = null;
                yield return FetchDefinition((ok, error) =>
                {
                    loaded = ok;
                    loadError = error;
                });

                if (!loaded)
                {
                    StatusText = loadError;
                    onDone?.Invoke(false, loadError);
                    yield break;
                }
            }

            ClearVisuals();
            bool visualsLoaded = false;
            string visualsError = null;
            yield return LoadAuthoredVisuals((ok, error) =>
            {
                visualsLoaded = ok;
                visualsError = error;
            });
            if (!visualsLoaded)
            {
                StatusText = visualsError;
                onDone?.Invoke(false, visualsError);
                yield break;
            }
            ApplyState(state);
            IsActive = true;
            StatusText = _pendingEntry
                ? "Прибытие подтверждено. Входим в локацию..."
                : (_travelActive ? "Маршрут восстановлен сервером." : "Выберите точку на карте.");
            ConfigureMapLighting();
            ConfigureCamera();
            _wastelandPoll = StartCoroutine(PollWasteland());
            onDone?.Invoke(true, "Глобальная карта загружена: " + _map.Nodes.Count + " поселения, "
                                  + _map.Infrastructure.Count + " объектов инфраструктуры.");
            if (_pendingEntry) ResumePendingLocationEntry();
        }

        /// <summary>
        /// Обновить уже открытую карту полным серверным self.globalMap. Это важно при
        /// присоединении к мировой группе и выходе из неё: маршрут и лидер меняются без нового join.
        /// </summary>
        public void ApplyAuthoritativeState(JObject state)
        {
            if (!IsActive || state == null) return;
            ApplyState(state, true);
        }

        /// <summary>Немедленно применяет свежую публичную симуляцию из подтверждённого действия.</summary>
        public void ApplyWastelandState(JObject state)
        {
            if (state == null) return;
            ApplyWastelandSnapshot(state, true);
        }

        private bool ApplyWastelandSnapshot(JObject state, bool clone)
        {
            if (state == null || WastelandSnapshotIsStale(_wasteland, state)) return false;

            float appliedAt = Time.realtimeSinceStartup;
            double previousSampledAt = Number(_wasteland?["sampledAt"], 0d);
            double sampledAt = Number(state["sampledAt"], 0d);
            double serverNow = Math.Max(sampledAt,
                Number(state["serverNow"], sampledAt));
            bool sameSample = sampledAt > 0d && sampledAt == previousSampledAt;
            double carriedAgeMs = sameSample && _wastelandAppliedRealtime >= 0f
                ? Math.Max(0d, _wastelandSampleAgeMs
                    + Math.Max(0f, appliedAt - _wastelandAppliedRealtime) * 1000d)
                : 0d;
            double serverAgeMs = sampledAt > 0d ? Math.Max(0d, serverNow - sampledAt) : 0d;

            _wastelandSampleAgeMs = sameSample
                ? Math.Max(carriedAgeMs, serverAgeMs)
                : serverAgeMs;
            _wastelandAppliedRealtime = appliedAt;
            _wasteland = clone ? (JObject)state.DeepClone() : state;
            _wasteland["sampleAgeMs"] = _wastelandSampleAgeMs;
            if (IsActive) RebuildDynamicWorld();
            return true;
        }

        public static bool WastelandSnapshotIsStale(JObject previous, JObject incoming)
        {
            if (incoming == null) return true;
            double previousSampledAt = Number(previous?["sampledAt"], 0d);
            double sampledAt = Number(incoming["sampledAt"], 0d);
            if (previousSampledAt <= 0d) return false;
            if (sampledAt <= 0d) return true;
            if (sampledAt != previousSampledAt) return sampledAt < previousSampledAt;

            double previousServerNow = Number(previous?["serverNow"], 0d);
            double serverNow = Number(incoming["serverNow"], 0d);
            return previousServerNow > 0d && serverNow > 0d && serverNow < previousServerNow;
        }

        public void Leave()
        {
            _pendingEntry = false;
            _locationEntryPending = false;
            _pendingArrival = null;
            _pendingArrivalKey = string.Empty;
            _locationEntryAttempts = 0;
            _locationEntryRetryAt = 0f;
            IsActive = false;
            ResetTouchMapInput();
            ResetMouseMapInput();
            _routeRequestVersion++;
            _routeRequestPending = false;
            _routeRequestWasReroute = false;
            _travelActive = false;
            _arrivalPending = false;
            if (_wastelandPoll != null) StopCoroutine(_wastelandPoll);
            _wastelandPoll = null;
            RestoreCamera();
            RestoreMapLighting();
            ClearVisuals();
        }

        private IEnumerator PollWasteland()
        {
            while (IsActive)
            {
                yield return FetchWasteland();
                float until = Time.realtimeSinceStartup + WastelandRefreshSeconds;
                while (IsActive && Time.realtimeSinceStartup < until) yield return null;
            }
            _wastelandPoll = null;
        }

        private IEnumerator FetchWasteland()
        {
            if (_wastelandFetchPending) yield break;
            _wastelandFetchPending = true;
            using (UnityWebRequest request = UnityWebRequest.Get(BaseUrl.TrimEnd('/') + "/api/wasteland"))
            {
                request.SetRequestHeader("Cache-Control", "no-store");
                yield return request.SendWebRequest();
                if (!IsActive)
                {
                    _wastelandFetchPending = false;
                    yield break;
                }
                if (request.result != UnityWebRequest.Result.Success)
                {
                    StatusText = "Живая пустошь временно недоступна: " + request.error;
                    _wastelandFetchPending = false;
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JObject sim = payload["sim"] as JObject;
                    if (sim == null) throw new JsonException("В ответе нет поля sim.");
                    ApplyWastelandSnapshot(sim, false);
                }
                catch (JsonException error)
                {
                    StatusText = "Не удалось разобрать живую пустошь: " + error.Message;
                }
                _wastelandFetchPending = false;
            }
        }

        private IEnumerator FetchDefinition(Action<bool, string> onDone)
        {
            string url = BaseUrl.TrimEnd('/') + "/api/global-map";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    onDone?.Invoke(false, "Не удалось получить глобальную карту: " + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JToken mapToken = payload["map"];
                    if (mapToken == null)
                    {
                        onDone?.Invoke(false, "В /api/global-map нет поля map.");
                        yield break;
                    }

                    _map = mapToken.ToObject<GlobalMapDefinition>();
                    if (_map == null || _map.Grid == null || _map.Grid.Cols <= 0 || _map.Grid.Rows <= 0)
                    {
                        onDone?.Invoke(false, "Сервер прислал некорректную сетку глобальной карты.");
                        yield break;
                    }

                    onDone?.Invoke(true, null);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Некорректный JSON глобальной карты: " + error.Message);
                }
            }
        }

        private IEnumerator LoadAuthoredVisuals(Action<bool, string> onDone)
        {
            while (_authoredSceneUnload != null && !_authoredSceneUnload.isDone) yield return null;
            _authoredSceneUnload = null;

            Scene scene = SceneManager.GetSceneByName(AuthoredSceneName);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                AsyncOperation load = SceneManager.LoadSceneAsync(AuthoredSceneName, LoadSceneMode.Additive);
                if (load == null)
                {
                    onDone?.Invoke(false, "Не удалось начать загрузку авторской сцены " + AuthoredSceneName + ".");
                    yield break;
                }
                while (!load.isDone) yield return null;
                scene = SceneManager.GetSceneByName(AuthoredSceneName);
            }

            RoaUnityGlobalMapScene authored = FindAuthoredScene(scene);
            if (authored == null)
            {
                onDone?.Invoke(false, "В сцене " + AuthoredSceneName + " нет RoaUnityGlobalMapScene.");
                yield break;
            }
            if (!authored.Validate(out string validationError))
            {
                onDone?.Invoke(false, "Авторская глобальная карта неполна: " + validationError + ".");
                yield break;
            }

            var missingNodes = new List<string>();
            if (_map?.Nodes != null)
            {
                foreach (GlobalMapNode node in _map.Nodes)
                {
                    if (node == null || string.IsNullOrEmpty(node.Id)) continue;
                    if (!authored.TryGetNode(node.Id, out RoaGlobalMapNodeAnchor _)) missingNodes.Add(node.Id);
                }
            }
            if (missingNodes.Count > 0)
            {
                onDone?.Invoke(false, "В авторской глобальной карте отсутствуют узлы: "
                                     + string.Join(", ", missingNodes) + ".");
                yield break;
            }

            _authoredUnityScene = scene;
            _authoredScene = authored;
            _root = authored.gameObject;
            _root.SetActive(true);
            _playerMarker = authored.PlayerMarker;
            _selectionMarker = authored.SelectionMarker;
            _cameraAnchor = authored.CameraAnchor != null ? authored.CameraAnchor.gameObject : null;
            _terrainCollider = authored.SelectionSurface;
            _dynamicRoot = authored.DynamicContentRoot != null ? authored.DynamicContentRoot.gameObject : null;
            _playerMarkerBaseScale = _playerMarker != null ? _playerMarker.transform.localScale : Vector3.one;
            _selectionMarkerBaseScale = _selectionMarker != null ? _selectionMarker.transform.localScale : Vector3.one;
            _playerMarkerBaseRotation = _playerMarker != null
                ? _playerMarker.transform.localRotation : Quaternion.identity;
            _selectionMarkerBaseRotation = _selectionMarker != null
                ? _selectionMarker.transform.localRotation : Quaternion.identity;
            EnsurePlayerActor();
            authored.ClearDynamicContent();
            _routeVisuals.Clear();
            _routeVisualBaseScales.Clear();
            _routeVisualProgress.Clear();
            _routeVisualShadows.Clear();
            _appliedRouteProgress = -1f;
            _dynamicPresentationVisuals.Clear();
            _appliedDetailTier = (MapDetailTier)(-1);
            _activityHighlightVisuals.Clear();
            SettlementModelCount = authored.NodeCount;
            onDone?.Invoke(true, null);
        }

        private static RoaUnityGlobalMapScene FindAuthoredScene(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            GameObject[] roots = scene.GetRootGameObjects();
            for (int i = 0; i < roots.Length; i++)
            {
                RoaUnityGlobalMapScene marker = roots[i].GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }

        private void RebuildDynamicWorld()
        {
            if (_root == null || _wasteland == null) return;

            if (_authoredScene == null || _authoredScene.DynamicContentRoot == null) return;
            _authoredScene.ClearDynamicContent();
            _dynamicRoot = _authoredScene.DynamicContentRoot.gameObject;
            BuildRimRidges();
            IndexExistingPartyActors();
            _routeVisuals.Clear();
            _routeVisualBaseScales.Clear();
            _routeVisualProgress.Clear();
            _routeVisualShadows.Clear();
            _appliedRouteProgress = -1f;
            _dynamicPresentationVisuals.Clear();
            _appliedDetailTier = (MapDetailTier)(-1);
            _activityHighlightVisuals.Clear();
            _activityHighlightKey = string.Empty;
            _dynamicTargets.Clear();
            _territoryByCell.Clear();
            _regionAccumulators.Clear();
            _factionSummary = string.Empty;
            TerritoryCellCount = 0;
            TerritoryBorderCount = 0;
            InfluenceZoneCount = 0;
            SiteMarkerCount = 0;
            SettlementStatusCount = 0;
            ThreatMarkerCount = 0;
            _seenPartyActors.Clear();

            BuildFactionTerritories();
            if (TerritoryCellCount == 0) BuildFactionInfluence();

            JArray sites = _wasteland["sites"] as JArray;
            if (sites != null)
            {
                foreach (JToken token in sites)
                {
                    JObject row = token as JObject;
                    if (row == null) continue;
                    string type = row["type"]?.ToString() ?? string.Empty;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;
                    if (string.Equals(type, "settlement", StringComparison.OrdinalIgnoreCase))
                    {
                        BuildSettlementStatus(row);
                        continue;
                    }

                    DynamicTarget target = TargetFrom(row, "site");
                    target.SiteId = id;
                    target.LocationId = row["locationId"]?.ToString() ?? string.Empty;
                    target.Radius = 15f;
                    target.CanEnter = !string.IsNullOrEmpty(target.LocationId);
                    target.Details = row["description"]?.ToString()
                                  ?? row["note"]?.ToString()
                                  ?? row["workSummary"]?.ToString()
                                  ?? string.Empty;
                    string controlState = row["controlState"]?.ToString() ?? string.Empty;
                    target.Semantic = MarkerSemanticLabel("site", type, false);
                    target.Accent = MarkerSemanticColor("site", type, false, controlState);
                    target.Priority = MarkerPresentationPriority("site", type, false, controlState);
                    _dynamicTargets.Add(target);

                    Color accent = target.Accent;
                    GameObject marker = InstantiateLivePrefab(RoaGlobalMapPrefabKind.Site,
                                                               "WorldSite:" + id);
                    if (marker != null)
                    {
                        marker.transform.localPosition = PointToWorld(target.Point.X, target.Point.Y, 0.09f);
                        float scale = string.Equals(type, "outpost", StringComparison.OrdinalIgnoreCase) ? 0.86f
                                    : (string.Equals(type, "resource", StringComparison.OrdinalIgnoreCase) ? 0.68f : 0.76f);
                        marker.transform.localScale *= scale;
                        TintLivePrefab(marker, accent, "Tint");
                        RegisterDynamicVisual(marker, DynamicVisualLayer.Site, target.Point,
                            false, target.Priority);
                        SiteMarkerCount++;
                    }
                }
            }

            JArray parties = _wasteland["parties"] as JArray;
            if (parties != null)
            {
                foreach (JToken token in parties)
                {
                    JObject row = token as JObject;
                    if (row == null || row["destroyed"]?.ToObject<bool>() == true) continue;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;

                    float sampleAgeSeconds = CurrentWastelandSampleAgeSeconds();
                    GlobalMapPoint displayPoint = WorldPartyDisplayPoint(row,
                        sampleAgeSeconds, _map.Grid.CellPoints, _map.Grid.CellKm,
                        Float(_wasteland["gameDayRealMs"], 60f * 60f * 1000f));
                    DynamicTarget target = TargetFrom(row, "party");
                    target.Point = displayPoint;
                    target.PartyId = id;
                    target.Faction = row["faction"]?.ToString() ?? string.Empty;
                    target.Radius = PartyRadius(row);
                    target.CanEnter = PartyCanEncounter(row);
                    target.Forced = WorldPartyHostile(target.Faction);
                    target.Details = row["statusText"]?.ToString() ?? row["kind"]?.ToString() ?? string.Empty;
                    string partyKind = row["kind"]?.ToString() ?? string.Empty;
                    target.Semantic = MarkerSemanticLabel("party", partyKind, target.Forced);
                    target.Accent = MarkerSemanticColor("party", partyKind, target.Forced, string.Empty);
                    target.Priority = MarkerPresentationPriority("party", partyKind,
                        target.Forced, string.Empty);
                    _seenPartyActors.Add(id);

                    PartyActorState partyActor = EnsurePartyActor(id);
                    if (partyActor != null && partyActor.Root != null)
                    {
                        if (!partyActor.HasRenderedPoint)
                        {
                            partyActor.Root.transform.localPosition = PointToWorld(
                                displayPoint.X, displayPoint.Y, 0.45f);
                            partyActor.HasRenderedPoint = true;
                        }
                        else
                        {
                            target.Point = WorldToPoint(partyActor.Root.transform.position);
                        }

                        float size = string.Equals(row["kind"]?.ToString(), "caravan",
                            StringComparison.OrdinalIgnoreCase) ? 0.72f : 0.54f;
                        partyActor.Root.transform.localScale = partyActor.BaseScale * size;
                        TintLivePrefab(partyActor.Root, target.Accent, "Tint");
                        partyActor.Target = target;
                        partyActor.Snapshot = row;
                        partyActor.Presentation = RegisterDynamicVisual(partyActor.Root,
                            DynamicVisualLayer.Party, target.Point, false, target.Priority);
                        if (partyActor.Actor != null)
                        {
                            _ = partyActor.Actor.ConfigureParty(BaseUrl, row);
                            partyActor.Actor.SetBanner(
                                FactionColor(target.Faction, target.Accent));
                        }
                    }
                    _dynamicTargets.Add(target);
                }
            }
            RemoveMissingPartyActors();

            JArray zones = _wasteland["worldZones"] as JArray;
            if (zones != null)
            {
                foreach (JToken token in zones)
                {
                    JObject row = token as JObject;
                    if (row == null || !string.Equals(row["status"]?.ToString(), "active", StringComparison.OrdinalIgnoreCase)) continue;
                    if (row["details"]?["hidden"]?.ToObject<bool>() == true || row["details"]?["visible"]?.ToObject<bool>() == false) continue;
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(id)) continue;

                    DynamicTarget target = TargetFrom(row, "zone");
                    target.WorldZoneId = id;
                    target.PartyId = row["partyId"]?.ToString() ?? string.Empty;
                    target.SiteId = row["siteId"]?.ToString() ?? string.Empty;
                    target.LocationId = row["locationId"]?.ToString() ?? string.Empty;
                    target.Faction = row["faction"]?.ToString()
                        ?? row["details"]?["faction"]?.ToString()
                        ?? string.Empty;
                    target.Radius = Mathf.Clamp(Float(row["radius"], 7f), 2f, 40f);
                    target.CanEnter = !string.IsNullOrEmpty(target.LocationId);
                    target.Forced = row["forced"]?.ToObject<bool>() == true
                        || row["details"]?["forced"]?.ToObject<bool>() == true
                        || WorldPartyHostile(target.Faction);
                    target.Details = row["title"]?.ToString() ?? row["encounterId"]?.ToString() ?? string.Empty;
                    target.Semantic = MarkerSemanticLabel("zone", row["kind"]?.ToString(), target.Forced);
                    target.Accent = MarkerSemanticColor("zone", row["kind"]?.ToString(),
                        target.Forced, row["status"]?.ToString());
                    target.Priority = MarkerPresentationPriority("zone", row["kind"]?.ToString(),
                        target.Forced, row["status"]?.ToString());
                    _dynamicTargets.Add(target);

                    DrawWorldRing("WorldZone:" + id, target.Point,
                                  Mathf.Clamp(Float(row["radius"], 7f), 2f, 40f),
                                  new Color(0.95f, 0.3f, 0.2f, 0.38f),
                                  0.13f, 0.16f, DynamicVisualLayer.Threat, false,
                                  target.Priority);
                    ThreatMarkerCount++;
                }
            }

            JArray threats = _wasteland["threatZones"] as JArray;
            if (threats != null)
            {
                int index = 0;
                foreach (JToken token in threats)
                {
                    JObject row = token as JObject;
                    if (row == null) continue;
                    bool hostileFaction = WorldPartyHostile(row["faction"]?.ToString());
                    if (!ThreatZoneShouldDisplay(row["kind"]?.ToString(),
                        Float(row["chanceBonus"], 0f), Float(row["difficultyBonus"], 0f),
                        hostileFaction)) continue;
                    GlobalMapPoint point = ReadPoint(row, "x", "y", null);
                    float difficulty = Float(row["difficultyBonus"], 0f);
                    float chance = Float(row["chanceBonus"], 0f);
                    int priority = Mathf.RoundToInt(70f + Mathf.Max(0f, difficulty) * 25f
                        + Mathf.Max(0f, chance) * 40f);
                    DrawWorldRing("Threat:" + index++, point,
                                  ThreatRadiusPoints(row), ThreatZoneColor(difficulty, chance),
                                  0.13f, 0.16f, DynamicVisualLayer.Threat, false, priority);
                    ThreatMarkerCount++;
                }
            }

            BuildTrackedWorldTaskMarker();
            _dynamicPresentationVisuals.Sort((left, right) =>
                (right?.Priority ?? 0).CompareTo(left?.Priority ?? 0));
            ApplySiteSeparation();
            ResolveSelectedDynamic();
            RebuildRouteVisuals();
            ApplyDynamicPresentation(true);
        }

        // Вместо кластера «• N точек» близкие мировые точки разносятся визуально.
        // Сдвиг ограничен запасом клика: NearestDynamicTarget ищет цель в радиусе
        // DynamicSnapRadiusPoints (13) от авторитетной точки, поэтому смещённый
        // маркер продолжает выбирать свою же точку.
        private const float SiteSeparationPoints = 16f;
        private const float SiteSeparationMaxOffsetPoints = 9f;

        private void ApplySiteSeparation()
        {
            var sites = new List<DynamicVisualState>();
            for (int i = 0; i < _dynamicPresentationVisuals.Count; i++)
            {
                DynamicVisualState state = _dynamicPresentationVisuals[i];
                if (state?.Visual != null && state.Point != null
                    && state.Layer == DynamicVisualLayer.Site) sites.Add(state);
            }
            if (sites.Count < 2) return;

            var offsets = new Vector2[sites.Count];
            for (int pass = 0; pass < 4; pass++)
                for (int i = 0; i < sites.Count; i++)
                    for (int j = i + 1; j < sites.Count; j++)
                    {
                        Vector2 a = new Vector2(sites[i].Point.X, sites[i].Point.Y) + offsets[i];
                        Vector2 b = new Vector2(sites[j].Point.X, sites[j].Point.Y) + offsets[j];
                        Vector2 delta = b - a;
                        float distance = delta.magnitude;
                        if (distance >= SiteSeparationPoints) continue;
                        Vector2 direction = distance > 0.01f
                            ? delta / distance
                            : SeparationFallbackDirection(sites[i].Point, sites[j].Point);
                        float push = (SiteSeparationPoints - distance) * 0.5f;
                        offsets[i] -= direction * push;
                        offsets[j] += direction * push;
                    }

            for (int i = 0; i < sites.Count; i++)
            {
                Vector2 offset = Vector2.ClampMagnitude(offsets[i], SiteSeparationMaxOffsetPoints);
                Transform visual = sites[i].Visual.transform;
                if (offset.sqrMagnitude < 0.01f)
                {
                    visual.localPosition = sites[i].BaseLocalPosition;
                    continue;
                }
                Vector3 shifted = PointToWorld(sites[i].Point.X + offset.x,
                    sites[i].Point.Y + offset.y, 0f);
                Vector3 origin = PointToWorld(sites[i].Point.X, sites[i].Point.Y, 0f);
                visual.localPosition = sites[i].BaseLocalPosition + (shifted - origin);
            }
        }

        /// <summary>Детерминированное направление для совпадающих координат.</summary>
        private static Vector2 SeparationFallbackDirection(GlobalMapPoint a, GlobalMapPoint b)
        {
            float angle = Mathf.Repeat(a.X * 73.856f + a.Y * 19.349f
                + b.X * 83.492f + b.Y * 12.289f, 360f) * Mathf.Deg2Rad;
            return new Vector2(Mathf.Cos(angle), Mathf.Sin(angle));
        }

        private void BuildTrackedWorldTaskMarker()
        {
            JObject task = _bootstrap?.Interaction?.TrackedWorldTask;
            JObject details = task?["details"] as JObject;
            JToken x = task?["targetX"] ?? task?["x"] ?? details?["x"];
            JToken y = task?["targetY"] ?? task?["y"] ?? details?["y"];
            if (task == null || x == null || y == null || x.Type == JTokenType.Null || y.Type == JTokenType.Null) return;
            var point = new GlobalMapPoint { X = Float(x, 0f), Y = Float(y, 0f) };
            string id = task["id"]?.ToString() ?? "tracked";
            DrawWorldRing("TrackedWorldTask:" + id, point, 9f,
                new Color(1f, 0.78f, 0.18f, 0.95f), 0.24f, 0.12f,
                DynamicVisualLayer.Tracked, true, 140);

            GameObject marker = InstantiateLivePrefab(RoaGlobalMapPrefabKind.TrackedTask,
                                                       "TrackedWorldTaskMarker:" + id);
            if (marker == null) return;
            marker.transform.localPosition = PointToWorld(point.X, point.Y, 0.32f);
            TintLivePrefab(marker, new Color(1f, 0.78f, 0.18f, 1f));
            RegisterDynamicVisual(marker, DynamicVisualLayer.Tracked, point, true, 140);
        }

        private void BuildSettlementStatus(JObject row)
        {
            string id = row?["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(id)) return;
            GlobalMapPoint point = ReadPoint(row, "x", "y", null);
            Color accent = FactionColor(row["owner"]?.ToString(), new Color(0.82f, 0.51f, 0.2f));
            bool critical = string.Equals(row["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase);
            bool contested = string.Equals(row["controlState"]?.ToString(), "contested", StringComparison.OrdinalIgnoreCase)
                          || string.Equals(row["controlState"]?.ToString(), "threatened", StringComparison.OrdinalIgnoreCase);
            Color ring = critical ? new Color(0.96f, 0.22f, 0.16f, 0.82f)
                       : (contested ? new Color(1f, 0.65f, 0.18f, 0.76f)
                                    : new Color(accent.r, accent.g, accent.b, 0.68f));
            DrawWorldRing("SettlementStatus:" + id, point, 14f, ring, 0.18f, 0.12f,
                DynamicVisualLayer.Settlement, false, critical ? 125 : (contested ? 115 : 100));

            Vector3 origin = PointToWorld(point.X, point.Y, 0.09f);
            GameObject flag = InstantiateLivePrefab(RoaGlobalMapPrefabKind.SettlementStatus,
                                                     "SettlementStatusMarker:" + id);
            if (flag == null) return;
            flag.transform.localPosition = origin;
            TintLivePrefab(flag, accent, "Tint");
            RegisterDynamicVisual(flag, DynamicVisualLayer.Settlement, point, false,
                critical ? 125 : (contested ? 115 : 100));
            SettlementStatusCount++;
        }

        private DynamicTarget TargetFrom(JObject row, string kind)
        {
            return new DynamicTarget
            {
                Kind = kind,
                Id = row["id"]?.ToString() ?? string.Empty,
                Name = row["name"]?.ToString() ?? row["title"]?.ToString() ?? row["id"]?.ToString() ?? kind,
                Point = ReadPoint(row, "x", "y", null),
                Data = row
            };
        }

        private void BuildFactionTerritories()
        {
            JArray rows = _wasteland?["territories"] as JArray;
            if (rows == null || _map == null || _map.Grid == null) return;

            float cellPoints = _map.Grid.CellPoints;
            float cellWorld = cellPoints * MapWorldScale;

            // Build the ownership index first. The old single pass could not know
            // whether the next cell had the same owner, so every simulation cell
            // became a visible border and the world looked like a debug grid.
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                int cx = Mathf.FloorToInt(Float(row["cx"], -1f));
                int cy = Mathf.FloorToInt(Float(row["cy"], -1f));
                if (cx < 0 || cy < 0 || cx >= _map.Grid.Cols || cy >= _map.Grid.Rows || IsWaterCell(cx, cy)) continue;
                string owner = row["owner"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                _territoryByCell[cx + ":" + cy] = row;
            }

            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                int cx = Mathf.FloorToInt(Float(row["cx"], -1f));
                int cy = Mathf.FloorToInt(Float(row["cy"], -1f));
                string owner = row["owner"]?.ToString() ?? string.Empty;
                if (!_territoryByCell.ContainsKey(cx + ":" + cy)
                    || string.IsNullOrEmpty(owner)) continue;

                Color baseColor = TerritoryColor(row, owner);
                float strength = Mathf.Clamp(Float(row["strength"], 0.3f), 0.1f, 1f);
                // Заливка видна только на «РЕГИОН» (Medium/Near показывают лишь
                // границы), поэтому она достаточно плотная, чтобы владение
                // читалось как закрашенная провинция, а не как намёк.
                float alpha = Mathf.Round((0.10f + strength * 0.13f) * 100f) / 100f;
                Color fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, alpha);

                GameObject cell = InstantiateLivePrefab(RoaGlobalMapPrefabKind.TerritoryCell,
                    "TerritoryCell:" + cx + ":" + cy);
                if (cell != null)
                {
                    cell.transform.localPosition = PointToWorld((cx + 0.5f) * cellPoints,
                                                                 (cy + 0.5f) * cellPoints, 0.045f);
                    cell.transform.localScale = new Vector3(cellWorld * 1.005f, 1f, cellWorld * 1.005f);
                    TintLivePrefab(cell, fillColor);
                    RegisterDynamicVisual(cell, DynamicVisualLayer.TerritoryFill,
                        new GlobalMapPoint { X = (cx + 0.5f) * cellPoints, Y = (cy + 0.5f) * cellPoints });
                    TerritoryCellCount++;
                }

                string borders = row["borders"]?.ToString()?.ToUpperInvariant() ?? string.Empty;
                Color coreColor = new Color(baseColor.r, baseColor.g, baseColor.b, 0.76f);
                foreach (char side in borders)
                {
                    if (side != 'N' && side != 'E' && side != 'S' && side != 'W') continue;
                    if (TerritoryBorderTouchesWater(cx, cy, side)) continue;
                    if (!TerritoryBorderIsFrontier(cx, cy, side, owner)) continue;
                    if (PlaceTerritoryBorder(cx, cy, side, cellPoints, cellWorld, coreColor) != null)
                        TerritoryBorderCount++;
                }

                RegionAccumulator accumulator;
                if (!_regionAccumulators.TryGetValue(owner, out accumulator))
                    accumulator = new RegionAccumulator { Color = baseColor };
                accumulator.SumX += (cx + 0.5f) * cellPoints;
                accumulator.SumY += (cy + 0.5f) * cellPoints;
                accumulator.Cells++;
                _regionAccumulators[owner] = accumulator;
            }

            RebuildRegionLabels(cellPoints);
            _factionSummary = ComposeFactionSummary();
        }

        // ------------------------------------------------------------------
        // Картографические названия регионов: по одному на владение фракции,
        // в центроиде её территориальных клеток. Показываются канвой только на
        // ярусе «РЕГИОН» — вместе с включёнными там границами территории они
        // отвечают на вопрос «чья это земля и где она кончается».

        public struct RegionLabel
        {
            public string Owner;
            public string Name;
            public Color Color;
            public GlobalMapPoint Point;
            public int Cells;
        }

        private struct RegionAccumulator
        {
            public float SumX;
            public float SumY;
            public int Cells;
            public Color Color;
        }

        private readonly Dictionary<string, RegionAccumulator> _regionAccumulators =
            new Dictionary<string, RegionAccumulator>();
        private readonly List<RegionLabel> _regionLabels = new List<RegionLabel>();

        /// <summary>Минимум клеток, чтобы владение получило подпись региона.</summary>
        public const int RegionLabelMinimumCells = 6;

        private void RebuildRegionLabels(float cellPoints)
        {
            _regionLabels.Clear();
            foreach (KeyValuePair<string, RegionAccumulator> pair in _regionAccumulators)
            {
                RegionAccumulator accumulator = pair.Value;
                if (accumulator.Cells < RegionLabelMinimumCells) continue;
                _regionLabels.Add(new RegionLabel
                {
                    Owner = pair.Key,
                    Name = RegionShortName(pair.Key),
                    Color = accumulator.Color,
                    Point = new GlobalMapPoint
                    {
                        X = accumulator.SumX / accumulator.Cells,
                        Y = accumulator.SumY / accumulator.Cells
                    },
                    Cells = accumulator.Cells
                });
            }
            _regionLabels.Sort((left, right) => right.Cells.CompareTo(left.Cells));
        }

        /// <summary>Не больше шести самых крупных владений — карта не превращается в текст.</summary>
        public const int RegionLabelLimit = 6;

        public int CollectRegionLabels(List<RegionLabel> output)
        {
            if (output == null) return 0;
            output.Clear();
            if (!IsActive || _root == null) return 0;
            for (int i = 0; i < _regionLabels.Count && i < RegionLabelLimit; i++)
            {
                RegionLabel label = _regionLabels[i];
                label.Point = CopyPoint(label.Point);
                output.Add(label);
            }
            return output.Count;
        }

        /// <summary>
        /// Короткое картографическое имя владения: длинные названия столиц
        /// («Караванный двор Старого Клима») на карте превращаются в кашу.
        /// </summary>
        private string RegionShortName(string factionId)
        {
            switch (FactionGroupKey(factionId))
            {
                case "old_klim": return "Старый Клим";
                case "caravans": return "Вольные караваны";
                case "scrap_union": return "Свалочный союз";
                case "relay_order": return "Ретранслятор";
                case "raiders": return "Рейдеры";
                case "mutants": return "Супермутанты";
                case "wild": return "Дикие земли";
                default: return FactionName(factionId);
            }
        }

        /// <summary>Мировая позиция подписи региона (для проекции канвой).</summary>
        public Vector3 RegionLabelWorld(RegionLabel label)
        {
            return _root != null
                ? _root.transform.TransformPoint(PointToWorld(label.Point.X, label.Point.Y, 0.6f))
                : Vector3.zero;
        }

        // ------------------------------------------------------------------
        // Рельефное обрамление: два ряда клонов авторских скальных кластеров
        // (RockCluster_* из сцены GlobalMapAuthored) вдоль прямоугольного
        // периметра диорамы. Настоящий MEP-арт вместо процедурных пирамид;
        // сегменты напротив воды пропускаются — горы не растут из моря.
        // Живёт как ребёнок корня авторской сцены и выгружается вместе с ней.

        // Клоны паркуются прямо под корнем авторской сцены (правило проверки:
        // рантайм карты не создаёт ни одного собственного GameObject — только
        // экземпляры авторского контента) и выгружаются вместе со сценой.
        private bool _rimBuilt;
        public int RimRidgeCount { get; private set; }

        private void BuildRimRidges()
        {
            if (_rimBuilt || _root == null || _map?.Grid == null) return;
            Transform template = FindRimTemplate();
            if (template == null) return;

            _rimBuilt = true;
            RimRidgeCount = 0;

            var random = new System.Random(20260901);
            // Ближний ряд — мельче и чаще, дальний — крупнее и реже: силуэт
            // хребта с наложением, как рамка диорамы.
            PlaceRimRow(template, random, 16f, 34f, 1.05f, 1.8f, 46f, -0.25f);
            PlaceRimRow(template, random, 44f, 70f, 2.1f, 3.4f, 62f, -0.45f);
        }

        private Transform FindRimTemplate()
        {
            if (_root == null) return null;
            foreach (Transform child in _root.GetComponentsInChildren<Transform>(true))
                if (child != null && child.name.StartsWith("RockCluster", StringComparison.Ordinal))
                    return child;
            return null;
        }

        private void PlaceRimRow(Transform template, System.Random random,
                                 float minOffset, float maxOffset,
                                 float minScale, float maxScale,
                                 float spacingPoints, float sinkWorld)
        {
            float w = MapWidthPoints, h = MapHeightPoints;
            // Четыре стороны: точка на краю и наружная нормаль в координатах карты.
            for (int side = 0; side < 4; side++)
            {
                float length = side < 2 ? w : h;
                for (float t = spacingPoints * 0.5f; t < length; t += spacingPoints
                     * Mathf.Lerp(0.8f, 1.25f, (float)random.NextDouble()))
                {
                    float edgeX = side == 0 ? t : side == 1 ? t : side == 2 ? 0f : w;
                    float edgeY = side == 0 ? 0f : side == 1 ? h : t;
                    float normalX = side == 2 ? -1f : side == 3 ? 1f : 0f;
                    float normalY = side == 0 ? -1f : side == 1 ? 1f : 0f;
                    if (RimAnchorFacesWater(edgeX, edgeY)) continue;

                    float offset = Mathf.Lerp(minOffset, maxOffset, (float)random.NextDouble());
                    float drift = ((float)random.NextDouble() - 0.5f) * spacingPoints * 0.4f;
                    float px = edgeX + normalX * offset - normalY * drift;
                    float py = edgeY + normalY * offset + normalX * drift;

                    Transform clone = Instantiate(template.gameObject, _root.transform)
                        .transform;
                    clone.gameObject.name = "RimRidge:" + RimRidgeCount;
                    clone.gameObject.SetActive(true);
                    clone.localPosition = PointToWorld(px, py, sinkWorld);
                    clone.localRotation = Quaternion.Euler(0f,
                        (float)random.NextDouble() * 360f, 0f);
                    clone.localScale = template.localScale
                        * Mathf.Lerp(minScale, maxScale, (float)random.NextDouble());
                    RimRidgeCount++;
                }
            }
        }

        /// <summary>Край карты напротив анкера — вода: море продолжается в туман.</summary>
        private bool RimAnchorFacesWater(float edgeX, float edgeY)
        {
            float cell = Mathf.Max(0.01f, _map.Grid.CellPoints);
            int cx = Mathf.Clamp(Mathf.FloorToInt(edgeX / cell), 0, _map.Grid.Cols - 1);
            int cy = Mathf.Clamp(Mathf.FloorToInt(edgeY / cell), 0, _map.Grid.Rows - 1);
            return IsWaterCell(cx, cy);
        }

        private void BuildFactionInfluence()
        {
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null) return;
            int limit = 32;
            foreach (JToken token in sites)
            {
                if (InfluenceZoneCount >= limit) break;
                JObject site = token as JObject;
                if (site == null || site["owner"] == null) continue;
                string owner = site["owner"]?.ToString() ?? "neutral";
                Color color = TerritoryColor(site, owner);
                bool critical = string.Equals(site["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase);
                bool contested = string.Equals(site["controlState"]?.ToString(), "contested", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(site["controlState"]?.ToString(), "threatened", StringComparison.OrdinalIgnoreCase);
                float alpha = string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase) ? 0.095f : (critical ? 0.18f : (contested ? 0.16f : 0.12f));
                GlobalMapPoint point = ReadPoint(site, "x", "y", null);
                float radius = FactionInfluenceRadius(site);
                DrawWorldRing("FactionInfluence:" + (site["id"]?.ToString() ?? InfluenceZoneCount.ToString()),
                              point, radius, new Color(color.r, color.g, color.b,
                                  critical ? 0.34f : Mathf.Max(0.14f, alpha)), 0.14f, 0.075f,
                              DynamicVisualLayer.Influence);
                InfluenceZoneCount++;
            }
            _factionSummary = ComposeFactionSummary();
        }

        private GameObject PlaceTerritoryBorder(int cx, int cy, char side, float cellPoints,
                                                float cellWorld, Color color)
        {
            float pointX = (cx + 0.5f) * cellPoints;
            float pointY = (cy + 0.5f) * cellPoints;
            bool horizontal = side == 'N' || side == 'S';
            if (side == 'N') pointY = cy * cellPoints;
            else if (side == 'S') pointY = (cy + 1f) * cellPoints;
            else if (side == 'W') pointX = cx * cellPoints;
            else if (side == 'E') pointX = (cx + 1f) * cellPoints;

            GameObject border = InstantiateLivePrefab(RoaGlobalMapPrefabKind.TerritoryBorder,
                "TerritoryBorder:" + cx + ":" + cy + ":" + side);
            if (border == null) return null;
            border.transform.localPosition = PointToWorld(pointX, pointY, 0.078f);
            border.transform.localRotation = Quaternion.Euler(0f, horizontal ? 90f : 0f, 0f);
            border.transform.localScale = new Vector3(1f, 1f, cellWorld * 0.98f);
            TintLivePrefab(border, color);
            RegisterDynamicVisual(border, DynamicVisualLayer.TerritoryBorder,
                new GlobalMapPoint { X = pointX, Y = pointY });
            return border;
        }

        private bool TerritoryBorderIsFrontier(int cx, int cy, char side, string owner)
        {
            int nx = cx;
            int ny = cy;
            if (side == 'N') ny--;
            else if (side == 'E') nx++;
            else if (side == 'S') ny++;
            else if (side == 'W') nx--;

            if (_map?.Grid == null || nx < 0 || ny < 0
                || nx >= _map.Grid.Cols || ny >= _map.Grid.Rows) return true;
            if (IsWaterCell(nx, ny)) return false;
            if (!_territoryByCell.TryGetValue(nx + ":" + ny, out JObject neighbor)) return true;
            string neighborOwner = neighbor?["owner"]?.ToString() ?? string.Empty;
            return !string.Equals(FactionGroupKey(owner), FactionGroupKey(neighborOwner),
                StringComparison.OrdinalIgnoreCase);
        }

        private Color TerritoryColor(JObject row, string owner)
        {
            string hex = row?["color"]?.ToString();
            Color color;
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out color)) return color;
            return FactionColor(owner, new Color(0.62f, 0.84f, 1f));
        }

        private bool IsWaterCell(int cx, int cy)
        {
            if (_map == null || cx < 0 || cy < 0 || cx >= _map.Grid.Cols || cy >= _map.Grid.Rows) return false;
            GlobalMapCell cell;
            return _map.Cells.TryGetValue(cx + ":" + cy, out cell) && IsWater(cell);
        }

        private bool TerritoryBorderTouchesWater(int cx, int cy, char side)
        {
            if (side == 'N') return IsWaterCell(cx, cy - 1);
            if (side == 'E') return IsWaterCell(cx + 1, cy);
            if (side == 'S') return IsWaterCell(cx, cy + 1);
            return IsWaterCell(cx - 1, cy);
        }

        private static bool IsWater(GlobalMapCell cell)
        {
            string texture = cell != null ? (cell.Texture ?? string.Empty).ToLowerInvariant() : string.Empty;
            return texture == "water" || texture == "ocean" || texture == "sea" || texture == "lake";
        }

        private static float FactionInfluenceRadius(JObject site)
        {
            string type = site?["type"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            float security = Mathf.Clamp(Float(site?["security"], 0f), 0f, 100f);
            float prosperity = Mathf.Clamp(Float(site?["prosperity"], 0f), 0f, 100f);
            float pressure = Mathf.Min(30f, Mathf.Abs(Float(site?["controlPressure"], 0f)));
            float radius = type == "settlement" ? 48f : (type == "outpost" ? 38f : (type == "production" ? 35f : (type == "resource" ? 31f : (type == "pointofinterest" ? 27f : 28f))));
            radius += security * 0.08f + prosperity * 0.05f - pressure * 0.22f;
            if (string.Equals(site?["owner"]?.ToString(), "neutral", StringComparison.OrdinalIgnoreCase)) radius *= 0.72f;
            if (string.Equals(site?["controlState"]?.ToString(), "secured", StringComparison.OrdinalIgnoreCase)) radius *= 1.12f;
            if (string.Equals(site?["controlState"]?.ToString(), "critical", StringComparison.OrdinalIgnoreCase)) radius *= 0.86f;
            return Mathf.Clamp(radius, 18f, 58f);
        }

        private void DrawWorldRing(string name, GlobalMapPoint point, float radiusPoints, Color color,
                                   float width = 0.13f, float height = 0.16f,
                                   DynamicVisualLayer layer = DynamicVisualLayer.Influence,
                                   bool important = false, int priority = 0)
        {
            GameObject go = InstantiateLivePrefab(RoaGlobalMapPrefabKind.InfluenceRing, name);
            if (go == null) return;
            float diameter = Mathf.Max(0.1f, radiusPoints * MapWorldScale * 2f);
            go.transform.localPosition = PointToWorld(point.X, point.Y, height);
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = new Vector3(diameter, 1f, diameter);
            TintLivePrefab(go, color);
            RegisterDynamicVisual(go, layer, point, important, priority);
        }

        private DynamicVisualState RegisterDynamicVisual(GameObject visual,
                                                          DynamicVisualLayer layer,
                                                          GlobalMapPoint point,
                                                          bool important = false,
                                                          int priority = 0)
        {
            if (visual == null) return null;
            var state = new DynamicVisualState
            {
                Visual = visual,
                Layer = layer,
                Point = CopyPoint(point),
                BaseLocalPosition = visual.transform.localPosition,
                BaseScale = visual.transform.localScale,
                Important = important,
                Priority = priority,
                TargetVisible = visual.activeSelf,
                Visibility = visual.activeSelf ? 1f : 0f,
                DetailScale = 1f
            };
            _dynamicPresentationVisuals.Add(state);
            return state;
        }

        public static MapDetailTier DetailTierForDistance(float distance, float minDistance,
                                                          float maxDistance)
        {
            float span = Mathf.Max(0.01f, maxDistance - minDistance);
            float normalized = Mathf.Clamp01((distance - minDistance) / span);
            if (normalized <= 0.24f) return MapDetailTier.Near;
            if (normalized <= 0.42f) return MapDetailTier.Medium;
            return MapDetailTier.Far;
        }

        public static string DetailTierDisplayName(MapDetailTier tier)
        {
            switch (tier)
            {
                case MapDetailTier.Near: return "РАЙОН";
                case MapDetailTier.Medium: return "ОКРУГА";
                default: return "РЕГИОН";
            }
        }

        private MapDetailTier CurrentDetailTier()
        {
            return CameraRig == null
                ? MapDetailTier.Medium
                : DetailTierForDistance(CameraRig.Distance, CameraRig.MinDistance, CameraRig.MaxDistance);
        }

        private void ApplyDynamicPresentation(bool force = false)
        {
            MapDetailTier tier = CurrentDetailTier();
            if (!force && tier == _appliedDetailTier) return;
            _appliedDetailTier = tier;
            MapPresentationProfile profile = PresentationProfile(tier);

            Dictionary<string, DynamicVisualState> siteWinners = profile.Sites
                && profile.SiteBucket > 0f
                ? PresentationWinners(DynamicVisualLayer.Site, profile.SiteBucket) : null;
            Dictionary<string, DynamicVisualState> partyWinners = profile.Parties
                && profile.PartyBucket > 0f
                ? PresentationWinners(DynamicVisualLayer.Party, profile.PartyBucket) : null;
            Dictionary<string, DynamicVisualState> threatWinners = profile.Threats
                && profile.ThreatBucket > 0f
                ? PresentationWinners(DynamicVisualLayer.Threat, profile.ThreatBucket) : null;
            for (int i = 0; i < _dynamicPresentationVisuals.Count; i++)
            {
                DynamicVisualState state = _dynamicPresentationVisuals[i];
                if (state == null || state.Visual == null) continue;
                bool selected = state.Point != null && _selectedPoint != null
                    && Distance(state.Point, _selectedPoint) <= 1.1f;
                bool visible = state.Important || selected;
                if (!visible)
                {
                    switch (state.Layer)
                    {
                        case DynamicVisualLayer.TerritoryFill:
                            visible = _showFactions && profile.TerritoryFill;
                            break;
                        case DynamicVisualLayer.TerritoryBorder:
                            visible = _showFactions && profile.TerritoryBorder;
                            break;
                        case DynamicVisualLayer.Influence:
                            visible = _showFactions && profile.Influence;
                            break;
                        case DynamicVisualLayer.Settlement:
                            visible = profile.Settlements;
                            break;
                        case DynamicVisualLayer.Site:
                            visible = profile.Sites && (profile.SiteBucket <= 0f
                                || IsPresentationWinner(state, siteWinners,
                                    profile.SiteBucket));
                            break;
                        case DynamicVisualLayer.Party:
                            visible = _showParties && profile.Parties
                                && (profile.PartyBucket <= 0f
                                    || IsPresentationWinner(state, partyWinners,
                                        profile.PartyBucket));
                            break;
                        case DynamicVisualLayer.Threat:
                            visible = _showEvents && profile.Threats
                                && (profile.ThreatBucket <= 0f
                                    || IsPresentationWinner(state, threatWinners,
                                        profile.ThreatBucket));
                            break;
                        case DynamicVisualLayer.Tracked:
                            visible = true;
                            break;
                    }
                }

                float scale = tier == MapDetailTier.Far ? 1.18f
                            : (tier == MapDetailTier.Medium ? 1.08f : 1f);
                state.TargetVisible = visible;
                state.DetailScale = scale;
                bool immediate = force || state.Layer == DynamicVisualLayer.TerritoryFill;
                if (immediate)
                {
                    state.Visibility = visible ? 1f : 0f;
                    if (state.Visual.activeSelf != visible) state.Visual.SetActive(visible);
                    state.Visual.transform.localScale = state.BaseScale
                        * PresentationVisibilityScale(state.Visibility, scale);
                }
                else if (visible && !state.Visual.activeSelf)
                {
                    state.Visual.SetActive(true);
                }
            }

            for (int i = 0; i < _activityHighlightVisuals.Count; i++)
            {
                ActivityHighlightVisual activity = _activityHighlightVisuals[i];
                if (activity?.Visual != null && activity.Visual.activeSelf != _showEvents)
                    activity.Visual.SetActive(_showEvents);
            }

            ApplyMarkerPresentation(tier);
            ApplyRoutePresentation(tier);
        }

        private void UpdateDynamicPresentationTransitions(float unscaledDeltaTime)
        {
            for (int i = 0; i < _dynamicPresentationVisuals.Count; i++)
            {
                DynamicVisualState state = _dynamicPresentationVisuals[i];
                if (state == null || state.Visual == null
                    || state.Layer == DynamicVisualLayer.TerritoryFill) continue;
                float next = PresentationVisibility(state.Visibility,
                    state.TargetVisible, unscaledDeltaTime);
                if (state.TargetVisible && !state.Visual.activeSelf)
                    state.Visual.SetActive(true);
                state.Visibility = next;
                state.Visual.transform.localScale = state.BaseScale
                    * PresentationVisibilityScale(next, state.DetailScale);
                if (!state.TargetVisible && next <= 0.001f && state.Visual.activeSelf)
                    state.Visual.SetActive(false);
            }
        }

        private Dictionary<string, DynamicVisualState> PresentationWinners(
            DynamicVisualLayer layer, float bucketSize)
        {
            var winners = new Dictionary<string, DynamicVisualState>();
            for (int i = 0; i < _dynamicPresentationVisuals.Count; i++)
            {
                DynamicVisualState candidate = _dynamicPresentationVisuals[i];
                if (candidate == null || candidate.Visual == null || candidate.Point == null
                    || candidate.Layer != layer || candidate.Important) continue;
                string key = PresentationBucket(candidate.Point, bucketSize);
                if (!winners.TryGetValue(key, out DynamicVisualState current)
                    || candidate.Priority > current.Priority)
                    winners[key] = candidate;
            }
            return winners;
        }

        private static bool IsPresentationWinner(DynamicVisualState state,
            IDictionary<string, DynamicVisualState> winners, float bucketSize)
        {
            if (state == null || winners == null || state.Point == null) return false;
            return winners.TryGetValue(PresentationBucket(state.Point, bucketSize),
                out DynamicVisualState winner) && ReferenceEquals(winner, state);
        }

        private static string PresentationBucket(GlobalMapPoint point, float size)
        {
            if (point == null) return "none";
            float safe = Mathf.Max(1f, size);
            return Mathf.FloorToInt(point.X / safe) + ":" + Mathf.FloorToInt(point.Y / safe);
        }

        private void ApplyMarkerPresentation(MapDetailTier tier)
        {
            float playerScale = tier == MapDetailTier.Far ? 1.75f
                              : (tier == MapDetailTier.Medium ? 1.35f : 1.08f);
            float selectionScale = tier == MapDetailTier.Far ? 1.5f
                                 : (tier == MapDetailTier.Medium ? 1.25f : 1f);
            if (_playerMarker != null) _playerMarker.transform.localScale = _playerMarkerBaseScale * playerScale;
            if (_selectionMarker != null) _selectionMarker.transform.localScale = _selectionMarkerBaseScale * selectionScale;
        }

        private void ApplyRoutePresentation(MapDetailTier tier)
        {
            _routeDetailScale = RouteDetailScale(tier);
            ApplyRouteProgressPresentation(true);
        }

        public static float RouteDetailScale(MapDetailTier tier)
        {
            return tier == MapDetailTier.Far ? 1.55f
                 : (tier == MapDetailTier.Medium ? 1.28f : 1.05f);
        }

        public static Color RouteVisualColor(float routePosition, float travelProgress,
                                             bool shadow, bool contact)
        {
            float position = Mathf.Clamp01(routePosition);
            float progress = Mathf.Clamp01(travelProgress);
            if (shadow)
                return contact
                    ? new Color(0.11f, 0.018f, 0.008f, 0.94f)
                    : new Color(0.035f, 0.025f, 0.012f, 0.9f);

            Color completed = new Color(0.23f, 0.58f, 0.48f, 0.68f);
            Color ahead = contact
                ? new Color(1f, 0.31f, 0.13f, 1f)
                : new Color(1f, 0.79f, 0.18f, 0.96f);
            if (position < progress - 0.012f) return completed;

            float head = 1f - Mathf.Clamp01(Mathf.Abs(position - progress) / 0.075f);
            Color headColor = contact
                ? new Color(1f, 0.78f, 0.42f, 1f)
                : new Color(0.48f, 0.96f, 1f, 1f);
            return Color.Lerp(ahead, headColor, head);
        }

        /// <summary>
        /// Completed arrows recede while the authoritative travel head is enlarged.
        /// Direction remains readable without animating or manufacturing geometry.
        /// </summary>
        public static float RouteVisualScale(float routePosition, float travelProgress,
                                             bool shadow, bool contact)
        {
            float position = Mathf.Clamp01(routePosition);
            float progress = Mathf.Clamp01(travelProgress);
            float head = 1f - Mathf.Clamp01(Mathf.Abs(position - progress) / 0.075f);
            if (shadow) return 1f + head * (contact ? 0.14f : 0.09f);
            if (position < progress - 0.012f) return 0.78f;
            return Mathf.Lerp(1f, contact ? 1.46f : 1.32f, head);
        }

        private void ApplyRouteProgressPresentation(bool force = false)
        {
            float progress = _travelActive ? TravelProgress : 0f;
            bool contact = _pendingContact != null;
            if (!force && Mathf.Abs(progress - _appliedRouteProgress) < 0.006f
                && contact == _appliedRouteContact) return;
            _appliedRouteProgress = progress;
            _appliedRouteContact = contact;
            int count = Mathf.Min(_routeVisuals.Count,
                Mathf.Min(_routeVisualBaseScales.Count,
                    Mathf.Min(_routeVisualProgress.Count, _routeVisualShadows.Count)));
            for (int i = 0; i < count; i++)
            {
                GameObject visual = _routeVisuals[i];
                if (visual == null) continue;
                visual.transform.localScale = _routeVisualBaseScales[i]
                    * (_routeDetailScale * RouteVisualScale(_routeVisualProgress[i], progress,
                        _routeVisualShadows[i], contact));
                TintLivePrefab(visual, RouteVisualColor(_routeVisualProgress[i], progress,
                    _routeVisualShadows[i], contact));
            }
        }

        private void ApplyState(JObject state, bool preserveIdleSelection = false)
        {
            JObject authoritativeTravel = state?["travel"] as JObject;
            // A gameplay self snapshot may already be queued when the travel-start
            // acknowledgement reaches the main thread. Do not let that older idle
            // snapshot erase a route that the server has just accepted. A current
            // descriptor normally arrives immediately afterwards and still wins.
            bool preserveFreshTravel = preserveIdleSelection
                                    && _travelActive
                                    && authoritativeTravel == null
                                    && Time.realtimeSinceStartup < _travelDescriptorGraceUntil;
            bool keepSelection = preserveIdleSelection
                              && authoritativeTravel == null
                              && (!_travelActive || preserveFreshTravel);
            _state = state != null ? (JObject)state.DeepClone() : new JObject();
            EnsurePlayerActor();
            JObject pendingDrop = _state["pendingWorldDrop"] as JObject;
            if (pendingDrop != null)
            {
                RestorePendingLocationEntry(pendingDrop);
                RefreshMarkers();
                return;
            }
            if (_pendingEntry)
            {
                // Ждём «Войти»: сервер ещё хранит завершённый маршрут и стартовую точку —
                // не откатываем игрока и выбор (web в этот момент живёт на pendingWorldDrop).
                RefreshMarkers();
                return;
            }
            _playerPoint = ReadPoint(_state, "playerX", "playerY", null);
            if (!keepSelection)
            {
                _selectedPoint = ReadPoint(_state, "selectedX", "selectedY", _playerPoint);
                _selectedNode = NearestNode(_selectedPoint, NodeSnapRadiusPoints);
                _selectedDynamic = null;
            }

            if (authoritativeTravel != null) ApplyTravel(authoritativeTravel);
            else if (!preserveFreshTravel) ClearTravel();

            RefreshMarkers();
        }

        private void RestorePendingLocationEntry(JObject pendingDrop)
        {
            if (pendingDrop == null) return;
            JObject arrival = (JObject)pendingDrop.DeepClone();
            string targetLocationId = arrival["targetLocationId"]?.ToString()
                                   ?? arrival["locationId"]?.ToString()
                                   ?? string.Empty;
            if (string.IsNullOrEmpty(targetLocationId)) return;
            arrival["targetLocationId"] = targetLocationId;
            string key = PendingArrivalKey(arrival);
            bool changed = !string.Equals(key, _pendingArrivalKey, StringComparison.Ordinal);

            _playerPoint = ReadObjectPoint(arrival["worldPoint"],
                ReadPoint(_state, "playerX", "playerY", _playerPoint));
            _selectedPoint = CopyPoint(_playerPoint);
            _selectedDynamic = null;
            string siteId = arrival["siteId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(siteId) && _dynamicTargets != null)
                _selectedDynamic = _dynamicTargets.Find(row => row != null && row.Id == siteId);
            _selectedNode = _selectedDynamic == null
                ? NearestNode(_selectedPoint, NodeSnapRadiusPoints)
                : null;
            ClearTravel();
            _pendingEntry = true;
            _pendingArrival = arrival;
            _pendingArrivalKey = key;
            if (changed)
            {
                _locationEntryAttempts = 0;
                _locationEntryRetryAt = Time.realtimeSinceStartup;
            }
        }

        private void ApplyTravel(JObject travel)
        {
            _routeRequestPending = false;
            _routeRequestWasReroute = false;
            _locationEntryPending = false;
            _travelLeaderId = travel["leaderId"]?.ToString() ?? Socket?.Session?.Id ?? string.Empty;
            GlobalMapPoint from = ReadObjectPoint(travel["fromPoint"], _playerPoint);
            GlobalMapPoint to = ReadObjectPoint(travel["toPoint"] ?? travel["targetPoint"], from);
            float rawDuration = Float(travel["duration"], Float(travel["durationMs"], 0f) / 1000f);
            if (rawDuration <= 0.001f && Distance(from, to) <= 0.35f)
            {
                _playerPoint = CopyPoint(from);
                _selectedPoint = CopyPoint(from);
                _selectedNode = NearestNode(from, NodeSnapRadiusPoints);
                _selectedDynamic = null;
                ClearTravel();
                return;
            }
            _route = ReadRoute(travel["routePoints"] as JArray);
            if (_route.Count < 2)
            {
                _route.Clear();
                _route.Add(from);
                _route.Add(to);
            }

            _selectedPoint = CopyPoint(to);
            _selectedNode = NearestNode(to, NodeSnapRadiusPoints);
            string targetSiteId = travel["targetSiteId"]?.ToString()
                               ?? travel["targetWorldSiteId"]?.ToString()
                               ?? string.Empty;
            string targetPartyId = travel["partyId"]?.ToString() ?? string.Empty;
            string targetWorldZoneId = travel["worldZoneId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(targetSiteId) || !string.IsNullOrEmpty(targetPartyId) || !string.IsNullOrEmpty(targetWorldZoneId))
            {
                _selectedDynamic = new DynamicTarget
                {
                    Kind = !string.IsNullOrEmpty(targetWorldZoneId) ? "zone" : (!string.IsNullOrEmpty(targetPartyId) ? "party" : "site"),
                    Id = !string.IsNullOrEmpty(targetWorldZoneId) ? targetWorldZoneId : (!string.IsNullOrEmpty(targetPartyId) ? targetPartyId : targetSiteId),
                    Name = !string.IsNullOrEmpty(targetSiteId) ? targetSiteId : (!string.IsNullOrEmpty(targetPartyId) ? targetPartyId : targetWorldZoneId),
                    SiteId = targetSiteId,
                    PartyId = targetPartyId,
                    WorldZoneId = targetWorldZoneId,
                    LocationId = travel["targetLocationId"]?.ToString() ?? string.Empty,
                    Point = CopyPoint(to)
                };
            }
            _travelDuration = Mathf.Max(0.1f, rawDuration);
            float progress = Mathf.Clamp01(Float(travel["progress"], Float(travel["elapsedMs"], 0f) / (_travelDuration * 1000f)));
            _travelStartedRealtime = Time.realtimeSinceStartup - progress * _travelDuration;
            _travelActive = true;
            _travelDescriptorGraceUntil = 0f;
            _arrivalPending = false;
            _arrivalRetryAt = 0f;
            _contactArrival = false;
            _pendingContact = null;
            _contactDecisionPending = false;
            _ignoredRouteContacts.Clear();
            _playerPoint = PointAtRouteProgress(_route, progress);
            RebuildRouteVisuals();
        }

        private void ClearTravel()
        {
            ClearRouteVisuals();
            _route.Clear();
            _travelActive = false;
            _travelDescriptorGraceUntil = 0f;
            _arrivalPending = false;
            _contactArrival = false;
            _pendingContact = null;
            _contactDecisionPending = false;
            _travelLeaderId = string.Empty;
            _ignoredRouteContacts.Clear();
        }

        private void RebuildRouteVisuals()
        {
            ClearRouteVisuals();
            if (_authoredScene == null || _route == null || _route.Count < 2) return;

            const float spacing = 0.82f;
            const int maximumPairs = 140;
            float totalLength = 0f;
            for (int i = 1; i < _route.Count; i++)
                totalLength += Distance(_route[i - 1], _route[i]);
            totalLength = Mathf.Max(0.001f, totalLength);
            float distanceBeforeSegment = 0f;
            int pairCount = 0;
            for (int segment = 1; segment < _route.Count && pairCount < maximumPairs; segment++)
            {
                Vector3 from = PointToWorld(_route[segment - 1].X, _route[segment - 1].Y, 0.38f);
                Vector3 to = PointToWorld(_route[segment].X, _route[segment].Y, 0.38f);
                Vector3 delta = to - from;
                delta.y = 0f;
                float length = delta.magnitude;
                if (length < 0.01f) continue;
                int count = Mathf.Clamp(Mathf.CeilToInt(length / spacing), 1,
                    maximumPairs - pairCount);
                Quaternion rotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
                for (int i = 0; i < count; i++)
                {
                    float t = (i + 0.5f) / count;
                    float routeProgress = Mathf.Clamp01((distanceBeforeSegment
                        + Distance(_route[segment - 1], _route[segment]) * t) / totalLength);
                    Vector3 position = Vector3.Lerp(from, to, t);
                    GameObject shadow = InstantiateLivePrefab(RoaGlobalMapPrefabKind.RouteDash,
                        "ActiveRouteShadow:" + segment + ":" + i);
                    if (shadow != null)
                    {
                        shadow.transform.localPosition = position + Vector3.down * 0.045f;
                        shadow.transform.localRotation = rotation;
                        shadow.transform.localScale = Vector3.one * 1.75f;
                        _routeVisuals.Add(shadow);
                        _routeVisualBaseScales.Add(shadow.transform.localScale);
                        _routeVisualProgress.Add(routeProgress);
                        _routeVisualShadows.Add(true);
                    }

                    GameObject dash = InstantiateLivePrefab(RoaGlobalMapPrefabKind.RouteDash,
                        "ActiveRoute:" + segment + ":" + i);
                    if (dash != null)
                    {
                        dash.transform.localPosition = position;
                        dash.transform.localRotation = rotation;
                        dash.transform.localScale = Vector3.one;
                        _routeVisuals.Add(dash);
                        _routeVisualBaseScales.Add(dash.transform.localScale);
                        _routeVisualProgress.Add(routeProgress);
                        _routeVisualShadows.Add(false);
                    }
                    pairCount++;
                }
                distanceBeforeSegment += Distance(_route[segment - 1], _route[segment]);
            }
            ApplyRoutePresentation(CurrentDetailTier());
        }

        private void ClearRouteVisuals()
        {
            if (_authoredScene != null)
            {
                for (int i = 0; i < _routeVisuals.Count; i++)
                    _authoredScene.ReleaseLivePrefab(_routeVisuals[i]);
            }
            _routeVisuals.Clear();
            _routeVisualBaseScales.Clear();
            _routeVisualProgress.Clear();
            _routeVisualShadows.Clear();
            _appliedRouteProgress = -1f;
        }

        private void Update()
        {
            if (!IsActive) return;

            if (_pendingEntry && !_locationEntryPending && _pendingArrival != null
                && Time.realtimeSinceStartup >= _locationEntryRetryAt)
                ResumePendingLocationEntry();

            UpdatePartyActors();

            bool touchActive = UpdateTouchMapInput();
            if (!touchActive)
            {
                bool keyboardActive = UpdateKeyboardCameraPan();
                bool mouseActive = UpdateMouseMapInput();
                if (mouseActive || keyboardActive) ClearHoverPreview();
                else UpdateMouseHover();
            }
            else
            {
                ResetMouseMapInput(false);
                ClearHoverPreview();
            }
            PulseActivityHighlights();
            if (Time.unscaledTime >= _nextPresentationRefresh)
            {
                _nextPresentationRefresh = Time.unscaledTime + 0.18f;
                ApplyDynamicPresentation();
                ApplyRouteProgressPresentation();
            }
            UpdateDynamicPresentationTransitions(Time.unscaledDeltaTime);
            UpdateStrategicActorPresentation();
            PulseMapFocus();

            if (!_travelActive)
            {
                _playerActor?.SetMotion(Vector3.zero, false);
                return;
            }
            if (_pendingContact != null)
            {
                _playerActor?.SetMotion(Vector3.zero, false);
                return;
            }

            GlobalMapPoint previousPoint = CopyPoint(_playerPoint);
            float progress = Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / _travelDuration);
            _playerPoint = PointAtRouteProgress(_route, progress);
            RefreshMarkers();
            Vector3 playerMotion = PointToWorld(_playerPoint.X, _playerPoint.Y, 0f)
                - PointToWorld(previousPoint.X, previousPoint.Y, 0f);
            Vector3 playerWorldMotion = _root != null
                ? _root.transform.TransformDirection(playerMotion) : playerMotion;
            _playerActor?.SetMotion(playerWorldMotion, playerMotion.sqrMagnitude > 0.000001f);

            if (!_arrivalPending && Time.realtimeSinceStartup >= _arrivalRetryAt
                && MaybeTriggerTravelContact(previousPoint, _playerPoint)) return;
            if (progress >= 1f && !_arrivalPending && Time.realtimeSinceStartup >= _arrivalRetryAt)
            {
                if (TryOpenSelectedDestinationContact()) return;
                RequestArrival();
            }
        }

        private bool UpdateTouchMapInput()
        {
            if (!InputEnabled)
            {
                ResetTouchMapInput();
                return false;
            }

            int count = Input.touchCount;
            if (count <= 0)
            {
                if (_mapTouchFinger >= 0 || _pinching) ResetTouchMapInput();
                return false;
            }

            _suppressSyntheticMouseUntil = Time.unscaledTime + 0.45f;
            if (count >= 2)
            {
                Touch first = Input.GetTouch(0);
                Touch second = Input.GetTouch(1);
                _mapTouchFinger = -1;
                _mapTouchDragging = false;
                _mapTouchBlocked = false;
                if (!TouchCanUseMap(first) || !TouchCanUseMap(second)
                    || CameraRig == null)
                {
                    ResetPinch();
                    _cameraPanning = false;
                    return true;
                }

                int fingerA = Mathf.Min(first.fingerId, second.fingerId);
                int fingerB = Mathf.Max(first.fingerId, second.fingerId);
                float span = Vector2.Distance(first.position, second.position);
                Vector2 center = (first.position + second.position) * 0.5f;
                if (!_pinching || fingerA != _pinchFingerA || fingerB != _pinchFingerB)
                {
                    _pinching = true;
                    _pinchFingerA = fingerA;
                    _pinchFingerB = fingerB;
                    _pinchStartSpan = Mathf.Max(1f, span);
                    _pinchStartCameraDistance = CameraRig.Distance;
                    _pinchLastCenter = center;
                }
                else
                {
                    CameraRig.SetDistance(PinchZoomDistance(_pinchStartCameraDistance,
                        _pinchStartSpan, span, CameraRig.MinDistance, CameraRig.MaxDistance), false);
                    ApplyCameraPanDelta(center - _pinchLastCenter);
                    _pinchLastCenter = center;
                }
                _cameraPanning = true;
                return true;
            }

            ResetPinch();
            _cameraPanning = false;
            Touch touch = Input.GetTouch(0);
            if (_mapTouchFinger < 0)
            {
                if (touch.phase != TouchPhase.Began) return true;
                _mapTouchFinger = touch.fingerId;
                _mapTouchStart = touch.position;
                _mapTouchStartedAt = Time.unscaledTime;
                _mapTouchDragging = false;
                _mapTouchBlocked = !TouchCanUseMap(touch);
                _cameraPanning = false;
            }
            if (touch.fingerId != _mapTouchFinger) return true;

            bool ended = touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled;
            if (!_mapTouchBlocked && !_mapTouchDragging
                && TouchDragReached(_mapTouchStart, touch.position, TouchDragThresholdPixels))
            {
                _mapTouchDragging = true;
                _cameraPanning = true;
            }
            if (!_mapTouchBlocked && _mapTouchDragging && touch.phase == TouchPhase.Moved)
                ApplyCameraPanDelta(touch.deltaPosition);

            if (!ended) return true;
            bool tap = !_mapTouchBlocked && TouchTapEligible(
                Time.unscaledTime - _mapTouchStartedAt, _mapTouchStart, touch.position,
                touch.phase == TouchPhase.Canceled);
            Vector2 screenPoint = touch.position;
            ResetSingleTouch();
            if (tap) SelectScreenPointAndMaybeTravel(screenPoint);
            return true;
        }

        private bool TouchCanUseMap(Touch touch)
        {
            if (!MapScreenPointCanGesture(touch.position, Screen.width, Screen.height, CanvasDriven))
                return false;
            EventSystem events = EventSystem.current;
            return events == null || !events.IsPointerOverGameObject(touch.fingerId);
        }

        private void ResetSingleTouch()
        {
            _mapTouchFinger = -1;
            _mapTouchDragging = false;
            _mapTouchBlocked = false;
            _cameraPanning = false;
        }

        private void ResetPinch()
        {
            _pinching = false;
            _pinchFingerA = -1;
            _pinchFingerB = -1;
            _pinchStartSpan = 0f;
            _pinchStartCameraDistance = 0f;
            _pinchLastCenter = Vector2.zero;
        }

        private void ResetTouchMapInput()
        {
            ResetSingleTouch();
            ResetPinch();
        }

        public static bool TouchDragReached(Vector2 start, Vector2 current, float threshold)
        {
            float safeThreshold = Mathf.Max(1f, threshold);
            return (current - start).sqrMagnitude >= safeThreshold * safeThreshold;
        }

        public static bool TouchTapEligible(float heldSeconds, Vector2 start,
                                            Vector2 current, bool cancelled)
        {
            return PointerTapEligible(heldSeconds, start, current, cancelled,
                TouchTapMaxSeconds, TouchDragThresholdPixels);
        }

        public static bool MouseTapEligible(float heldSeconds, Vector2 start,
                                            Vector2 current, bool cancelled)
        {
            return PointerTapEligible(heldSeconds, start, current, cancelled,
                MouseTapMaxSeconds, MouseDragThresholdPixels);
        }

        public static bool PointerTapEligible(float heldSeconds, Vector2 start,
                                              Vector2 current, bool cancelled,
                                              float maxSeconds, float dragThreshold)
        {
            return !cancelled && heldSeconds <= Mathf.Max(0.05f, maxSeconds)
                && !TouchDragReached(start, current, dragThreshold);
        }

        public static float PinchZoomDistance(float startCameraDistance, float startFingerSpan,
                                              float currentFingerSpan, float minDistance,
                                              float maxDistance)
        {
            float ratio = Mathf.Max(1f, startFingerSpan) / Mathf.Max(1f, currentFingerSpan);
            return Mathf.Clamp(startCameraDistance * ratio, minDistance, maxDistance);
        }

        /// <summary>
        /// Pure strategic-camera orbit calculation. The returned vector stores pitch in x
        /// and yaw in y. Unity screen-space y grows upward, so dragging the wheel upward
        /// lowers the camera toward the horizon while dragging downward raises it.
        /// </summary>
        public static Vector2 StrategicCameraOrbit(float pitchDeg, float yawDeg,
                                                    Vector2 pointerDelta)
        {
            float pitch = Mathf.Clamp(
                pitchDeg - pointerDelta.y * StrategicOrbitDegreesPerPixel,
                StrategicMinimumPitchDeg, StrategicMaximumPitchDeg);
            float yaw = Mathf.Repeat(
                yawDeg + pointerDelta.x * StrategicOrbitDegreesPerPixel, 360f);
            return new Vector2(pitch, yaw);
        }

        /// <summary>
        /// Right-button navigation follows the horizontal pointer impulse, but uses an
        /// inverted vertical axis. Primary-button and touch dragging keep their original
        /// direct-map-drag behaviour.
        /// </summary>
        public static Vector2 RightMousePanDelta(Vector2 pointerDelta)
        {
            return new Vector2(pointerDelta.x, -pointerDelta.y);
        }

        public static Vector3 KeyboardCameraPanMovement(Vector2 input, float distance,
                                                        float deltaTime, Vector3 right,
                                                        Vector3 forward)
        {
            if (input.sqrMagnitude > 1f) input.Normalize();
            float speed = Mathf.Clamp(distance * StrategicKeyboardPanSpeedFactor,
                StrategicKeyboardPanMinimumSpeed, StrategicKeyboardPanMaximumSpeed);
            return (right.normalized * input.x + forward.normalized * input.y)
                * speed * Mathf.Max(0f, deltaTime);
        }

        public static float StrategicMinimumCameraDistance(float mapSpan)
        {
            float pitchRadians = StrategicMinimumPitchDeg * Mathf.Deg2Rad;
            float clearanceDistance = StrategicMinimumCameraClearance
                / Mathf.Max(0.01f, Mathf.Sin(pitchRadians));
            return Mathf.Max(clearanceDistance, Mathf.Max(14f, Mathf.Max(0f, mapSpan) * 0.2f));
        }

        public static float StrategicMaximumCameraDistance(float mapSpan)
        {
            return Mathf.Max(150f, Mathf.Max(0f, mapSpan) * 1.65f);
        }

        public static bool MapScreenPointCanGesture(Vector2 screenPoint, int screenWidth,
                                                     int screenHeight, bool canvasDriven)
        {
            if (screenPoint.x < 0f || screenPoint.y < 0f
                || screenPoint.x > screenWidth || screenPoint.y > screenHeight) return false;
            if (canvasDriven) return true;
            Vector2 guiPoint = new Vector2(screenPoint.x, screenHeight - screenPoint.y);
            return MapPointCanSelect(guiPoint, screenWidth, screenHeight);
        }
        private bool UpdateMouseMapInput()
        {
            if (!_mousePrimaryTracking && UpdateCameraOrbit()) return true;
            if (!_mousePrimaryTracking && UpdateCameraPan()) return true;

            if (!InputEnabled || Input.touchCount > 0
                || Time.unscaledTime < _suppressSyntheticMouseUntil)
            {
                ResetPrimaryMouseInput();
                return false;
            }

            Vector2 pointer = Input.mousePosition;
            if (!_mousePrimaryTracking && Input.GetMouseButtonDown(0))
            {
                EventSystem events = EventSystem.current;
                bool blocked = events != null && events.IsPointerOverGameObject();
                if (!blocked)
                    blocked = !MapScreenPointCanGesture(pointer, Screen.width, Screen.height,
                        CanvasDriven);
                if (blocked) return false;

                _mousePrimaryTracking = true;
                _mousePrimaryDragging = false;
                _mousePrimaryStart = pointer;
                _mousePrimaryLast = pointer;
                _mousePrimaryStartedAt = Time.unscaledTime;
            }
            if (!_mousePrimaryTracking) return false;
            if (!Input.GetMouseButton(0) && !Input.GetMouseButtonUp(0))
            {
                ResetPrimaryMouseInput();
                return true;
            }

            if (!_mousePrimaryDragging && TouchDragReached(_mousePrimaryStart, pointer,
                MouseDragThresholdPixels))
            {
                _mousePrimaryDragging = true;
                _cameraPanning = true;
            }
            if (_mousePrimaryDragging && Input.GetMouseButton(0))
                ApplyCameraPanDelta(pointer - _mousePrimaryLast);
            _mousePrimaryLast = pointer;

            if (!Input.GetMouseButtonUp(0)) return true;
            bool tap = MouseTapEligible(Time.unscaledTime - _mousePrimaryStartedAt,
                _mousePrimaryStart, pointer, false);
            ResetPrimaryMouseInput();
            if (tap) SelectScreenPointAndMaybeTravel(pointer);
            return true;
        }

        private void UpdateMouseHover()
        {
            if (!InputEnabled || _cameraPanning || _cameraOrbiting || _mousePrimaryTracking
                || !Input.mousePresent
                || Application.isMobilePlatform || _terrainCollider == null)
            {
                ClearHoverPreview();
                return;
            }

            EventSystem events = EventSystem.current;
            if (events != null && events.IsPointerOverGameObject())
            {
                ClearHoverPreview();
                return;
            }

            Vector2 screenPoint = Input.mousePosition;
            if (!MapScreenPointCanGesture(screenPoint, Screen.width, Screen.height, CanvasDriven))
            {
                ClearHoverPreview();
                return;
            }

            Camera camera = Camera.main;
            if (camera == null || !_terrainCollider.Raycast(camera.ScreenPointToRay(screenPoint),
                out RaycastHit hit, 1000f))
            {
                ClearHoverPreview();
                return;
            }

            GlobalMapPoint point = WorldToPoint(hit.point);
            DynamicTarget target = NearestDynamicTarget(point,
                DynamicSnapRadiusPoints * 0.9f, true);
            GlobalMapNode node = target == null ? NearestNode(point, NodeSnapRadiusPoints * 0.9f) : null;
            _hoverDynamic = target;
            _hoverNode = node;
        }

        private void ClearHoverPreview()
        {
            _hoverDynamic = null;
            _hoverNode = null;
        }

        private bool UpdateCameraOrbit()
        {
            if (!InputEnabled || CameraRig == null || _cameraAnchor == null)
            {
                _cameraOrbiting = false;
                _lastOrbitPointer = Vector2.zero;
                return false;
            }

            if (!_cameraOrbiting)
            {
                if (!Input.GetMouseButtonDown(2)) return false;
                EventSystem events = EventSystem.current;
                if (events != null && events.IsPointerOverGameObject()) return false;
                if (!MapScreenPointCanGesture(Input.mousePosition, Screen.width, Screen.height,
                    CanvasDriven)) return false;
                _cameraOrbiting = true;
                _cameraPanning = false;
                _lastOrbitPointer = Input.mousePosition;
                return true;
            }

            if (!Input.GetMouseButton(2))
            {
                _cameraOrbiting = false;
                _lastOrbitPointer = Vector2.zero;
                return false;
            }

            Vector2 pointer = Input.mousePosition;
            Vector2 delta = pointer - _lastOrbitPointer;
            _lastOrbitPointer = pointer;
            if (delta.sqrMagnitude < 0.01f) return true;

            Vector2 orbit = StrategicCameraOrbit(CameraRig.PitchDeg, CameraRig.YawDeg, delta);
            CameraRig.PitchDeg = orbit.x;
            CameraRig.YawDeg = orbit.y;
            return true;
        }

        private bool UpdateCameraPan()
        {
            if (!InputEnabled || CameraRig == null || _cameraAnchor == null)
            {
                _cameraPanning = false;
                return false;
            }

            bool pressed = Input.GetMouseButton(1);
            if (!_cameraPanning)
            {
                bool began = Input.GetMouseButtonDown(1);
                if (!began) return false;
                EventSystem events = EventSystem.current;
                if (events != null && events.IsPointerOverGameObject()) return false;
                if (!MapScreenPointCanGesture(Input.mousePosition, Screen.width, Screen.height,
                    CanvasDriven)) return false;
                _cameraPanning = true;
                _lastPanPointer = Input.mousePosition;
                return true;
            }
            if (!pressed)
            {
                _cameraPanning = false;
                return false;
            }

            Vector2 pointer = Input.mousePosition;
            Vector2 delta = pointer - _lastPanPointer;
            _lastPanPointer = pointer;
            if (delta.sqrMagnitude < 0.01f) return true;

            ApplyCameraPanDelta(RightMousePanDelta(delta));
            return true;
        }

        private bool UpdateKeyboardCameraPan()
        {
            if (!InputEnabled || CameraRig == null || _cameraAnchor == null
                || Input.touchCount > 0 || RoaGameBootstrap.BlocksWorldHud)
                return false;

            EventSystem events = EventSystem.current;
            GameObject selected = events != null ? events.currentSelectedGameObject : null;
            if (selected != null
                && selected.GetComponentInParent<UnityEngine.UI.InputField>() != null)
                return false;

            Vector2 input = new Vector2(
                (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f),
                (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f));
            if (input.sqrMagnitude < 0.01f) return false;

            Vector3 movement = KeyboardCameraPanMovement(input, CameraRig.Distance,
                Time.unscaledDeltaTime, CameraRig.PlanarRight(), CameraRig.PlanarForward());
            ApplyCameraMovement(movement);
            return true;
        }

        private void ResetPrimaryMouseInput(bool clearCameraPanning = true)
        {
            _mousePrimaryTracking = false;
            _mousePrimaryDragging = false;
            _mousePrimaryStart = Vector2.zero;
            _mousePrimaryLast = Vector2.zero;
            _mousePrimaryStartedAt = 0f;
            if (clearCameraPanning) _cameraPanning = false;
        }

        private void ResetMouseMapInput(bool clearCameraPanning = true)
        {
            ResetPrimaryMouseInput(clearCameraPanning);
            _lastPanPointer = Vector2.zero;
            _cameraOrbiting = false;
            _lastOrbitPointer = Vector2.zero;
        }

        private void ApplyCameraPanDelta(Vector2 pointerDelta)
        {
            if (CameraRig == null || _cameraAnchor == null || pointerDelta.sqrMagnitude < 0.01f) return;
            Vector3 movement = CameraPanMovement(pointerDelta, CameraRig.Distance, Screen.height,
                CameraRig.PlanarRight(), CameraRig.PlanarForward());
            ApplyCameraMovement(movement);
        }

        private void ApplyCameraMovement(Vector3 movement)
        {
            if (_cameraAnchor == null || movement.sqrMagnitude < 0.000001f) return;
            _cameraAnchor.transform.position = ClampCameraPan(
                _cameraAnchor.transform.position + movement,
                MapWidthPoints * MapWorldScale, MapHeightPoints * MapWorldScale);
        }
        public static Vector3 CameraPanMovement(Vector2 pointerDelta, float distance,
                                                float screenHeight, Vector3 right, Vector3 forward)
        {
            float scale = distance / Mathf.Max(240f, screenHeight) * 1.1f;
            return -right.normalized * (pointerDelta.x * scale)
                   + forward.normalized * (pointerDelta.y * scale);
        }

        public static Vector3 ClampCameraPan(Vector3 position, float width, float depth)
        {
            float xLimit = Mathf.Max(0f, width) * 0.5f;
            float zLimit = Mathf.Max(0f, depth) * 0.5f;
            position.x = Mathf.Clamp(position.x, -xLimit, xLimit);
            position.z = Mathf.Clamp(position.z, -zLimit, zLimit);
            return position;
        }

        private bool MaybeTriggerTravelContact(GlobalMapPoint previousPoint, GlobalMapPoint nextPoint)
        {
            if (!IsLocalTravelLeader()) return false;
            DynamicTarget best = null;
            float bestT = float.MaxValue;

            foreach (DynamicTarget target in _dynamicTargets)
            {
                if (target == null || !target.CanEnter || target.Point == null) continue;
                if (target.Kind != "party" && target.Kind != "zone") continue;
                if (_ignoredRouteContacts.Contains(target.Kind + ":" + target.Id)) continue;
                float touchRadius = Mathf.Max(2f, target.Radius) + 2.5f;
                if (Distance(previousPoint, target.Point) <= touchRadius + 0.25f) continue;
                float t;
                float distance = PointSegmentDistance(target.Point, previousPoint, nextPoint, out t);
                if (distance > touchRadius || t < 0f || t > 1f || t >= bestT) continue;
                best = target;
                bestT = t;
            }

            if (best == null) return false;

            _savedDestinationDynamic = _selectedDynamic;
            _savedDestinationNode = _selectedNode;
            _savedDestinationPoint = CopyPoint(_selectedPoint);
            _ignoredRouteContacts.Add(best.Kind + ":" + best.Id);

            if ((best.Kind == "party" || best.Kind == "zone") && !best.Forced)
            {
                return OpenPendingTravelContact(best);
            }

            _contactArrival = true;
            _selectedDynamic = best;
            _selectedNode = null;
            _selectedPoint = CopyPoint(best.Point);
            StatusText = "Маршрут встретил: " + best.Name + ". Сервер подтверждает вход...";
            if (best.Kind == "party" || best.Kind == "zone")
            {
                Socket.Emit("globalTravelEncounterDecision", new
                {
                    decision = "enter",
                    encounterId = best.Id,
                    title = best.Name
                });
            }
            RequestArrival();
            return true;
        }

        private bool TryOpenSelectedDestinationContact()
        {
            DynamicTarget contact = _selectedDynamic;
            if (contact == null || contact.Forced || !contact.CanEnter) return false;
            if (contact.Kind != "party" && contact.Kind != "zone") return false;
            if (_ignoredRouteContacts.Contains(contact.Kind + ":" + contact.Id)) return false;

            _savedDestinationDynamic = contact;
            _savedDestinationNode = _selectedNode;
            _savedDestinationPoint = CopyPoint(_selectedPoint);
            _ignoredRouteContacts.Add(contact.Kind + ":" + contact.Id);
            return OpenPendingTravelContact(contact);
        }

        private bool OpenPendingTravelContact(DynamicTarget contact)
        {
            if (contact == null || Socket == null || !IsLocalTravelLeader()) return false;
            _pendingContact = contact;
            StatusText = "На маршруте: " + contact.Name + ". Вступить или обойти?";
            Socket.Emit("globalTravelEncounterDecision", new
            {
                pending = true,
                encounterId = contact.Id,
                title = contact.Name
            });
            return true;
        }

        private void ResolveTravelContact(bool enter)
        {
            if (_pendingContact == null || _contactDecisionPending || Socket == null) return;
            DynamicTarget contact = _pendingContact;
            bool destinationContact = _savedDestinationDynamic != null
                && _savedDestinationDynamic.Kind == contact.Kind
                && _savedDestinationDynamic.Id == contact.Id;
            _contactDecisionPending = true;
            StatusText = enter ? "Сервер подтверждает вход…" : "Сервер подтверждает обход…";
            Socket.EmitWithAck("globalTravelEncounterDecision", new
            {
                decision = enter ? "enter" : "skip",
                encounterId = contact.Id,
                title = contact.Name
            }, ack =>
            {
                _contactDecisionPending = false;
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не принял решение по встрече.");
                    return;
                }

                if (!enter)
                {
                    if (destinationContact)
                    {
                        StatusText = "Останавливаемся перед " + contact.Name + "...";
                        _contactDecisionPending = true;
                        Socket.EmitWithAck("globalTravelCancel", new { }, cancelAck =>
                        {
                            _contactDecisionPending = false;
                            if (!AckOk(cancelAck))
                            {
                                StatusText = AckError(cancelAck, "Сервер не подтвердил обход встречи.");
                                return;
                            }
                            _playerPoint = ReadObjectPoint(cancelAck["worldPoint"], _playerPoint);
                            _selectedPoint = CopyPoint(_playerPoint);
                            _selectedDynamic = null;
                            _selectedNode = NearestNode(_playerPoint, NodeSnapRadiusPoints);
                            ClearTravel();
                            RefreshMarkers();
                            StatusText = "Вы обошли " + contact.Name + " и остановились на маршруте.";
                        });
                        return;
                    }

                    _pendingContact = null;
                    _selectedDynamic = _savedDestinationDynamic;
                    _selectedNode = _savedDestinationNode;
                    _selectedPoint = CopyPoint(_savedDestinationPoint);
                    RefreshMarkers();
                    StatusText = "Группа обходит: " + contact.Name + ". Маршрут продолжается.";
                    return;
                }

                _pendingContact = null;
                _contactArrival = true;
                _selectedDynamic = contact;
                _selectedNode = null;
                _selectedPoint = CopyPoint(contact.Point);
                RefreshMarkers();
                RequestArrival();
            });
        }

        private bool SelectScreenPointAndMaybeTravel(Vector2 screenPoint)
        {
            if (!SelectFromScreen(screenPoint)) return false;
            if (!RouteClickAllowed(InputEnabled, _arrivalPending, _locationEntryPending,
                                   _pendingContact != null,
                                   !string.IsNullOrEmpty(AttachedPartyId))) return true;
            _pendingEntry = false;
            if (PlayerAtSelection) EnterCurrent();
            else StartTravel();
            return true;
        }

        public static bool RouteClickAllowed(bool inputEnabled, bool arrivalPending,
                                             bool contactPending, bool attachedToParty)
        {
            return RouteClickAllowed(inputEnabled, arrivalPending, false, contactPending,
                attachedToParty);
        }

        public static bool RouteClickAllowed(bool inputEnabled, bool arrivalPending,
                                             bool locationEntryPending, bool contactPending,
                                             bool attachedToParty)
        {
            return inputEnabled && !arrivalPending && !locationEntryPending
                && !contactPending && !attachedToParty;
        }
        private bool SelectFromScreen(Vector2 screenPoint)
        {
            Camera camera = Camera.main;
            if (camera == null || _terrainCollider == null) return false;

            Ray ray = camera.ScreenPointToRay(screenPoint);
            if (!_terrainCollider.Raycast(ray, out RaycastHit hit, 1000f)) return false;

            _selectedPoint = WorldToPoint(hit.point);
            _selectedDynamic = NearestDynamicTarget(_selectedPoint,
                DynamicSnapRadiusPoints, true);
            _selectedNode = _selectedDynamic == null ? NearestNode(_selectedPoint, NodeSnapRadiusPoints) : null;
            if (_selectedDynamic != null)
                _selectedPoint = CopyPoint(_selectedDynamic.Point);
            else if (_selectedNode != null)
                _selectedPoint = new GlobalMapPoint { X = _selectedNode.X, Y = _selectedNode.Y };

            StatusText = _selectedDynamic != null
                ? "Выбрано: " + _selectedDynamic.Name
                : (_selectedNode != null ? "Выбрано: " + _selectedNode.EffectiveLocationId : "Выбрана точка пустоши.");
            RefreshMarkers();
            return true;
        }

        public void RequestEnterFromLocation()
        {
            if (Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                StatusText = "Нет соединения с сервером.";
                return;
            }

            StatusText = "Сервер проверяет выход с границы локации...";
            Socket.EmitWithAck("globalTravelEnterWorld", new { }, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Не удалось выйти на глобальную карту.");
                    return;
                }

                Socket.ApplyGlobalMapTransitionAck(ack);
                JObject point = ack["worldPoint"] as JObject;
                JObject state = StateFromWorldPoint(point, ack["fromLocationId"]?.ToString());
                _bootstrap?.EnterGlobalMapFromServer(state);
            });
        }

        /// <summary>
        /// Построить обычный production-маршрут к видимому отряду мира. Курсорная
        /// кнопка использует те же внутренние выбор и StartTravel; этот вход нужен
        /// также мобильному управлению и сквозным проверкам собранного клиента.
        /// </summary>
        public bool RequestTravelToWorldParty(string partyId, Action<JObject> completed = null)
        {
            if (!IsActive || _arrivalPending || _locationEntryPending
                || _pendingContact != null || string.IsNullOrEmpty(partyId)) return false;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return false;
            }

            DynamicTarget target = _dynamicTargets.Find(row => row != null && row.PartyId == partyId && row.CanEnter);
            if (target == null) return false;
            _selectedDynamic = target;
            _selectedNode = null;
            _selectedPoint = CopyPoint(target.Point);
            RefreshMarkers();
            StartTravel(completed);
            return true;
        }

        public int CollectOverlayLabels(List<OverlayLabel> output)
        {
            if (output == null) return 0;
            output.Clear();
            if (!IsActive || _root == null || _map == null) return 0;

            MapDetailTier tier = CurrentDetailTier();
            MapPresentationProfile profile = PresentationProfile(tier);
            int activityLabels = 0;
            bool selectedActivityLabelAdded = false;
            for (int i = 0; _showEvents && i < _activityOverlayLabels.Count; i++)
            {
                ActivityOverlayState row = _activityOverlayLabels[i];
                if (row == null || row.Point == null) continue;
                bool selected = _selectedPoint != null && Distance(_selectedPoint, row.Point) <= 1f;
                if (activityLabels >= profile.ActivityLabelLimit && !selected) continue;
                output.Add(new OverlayLabel
                {
                    Id = row.Id,
                    Text = row.Text,
                    World = _root.transform.TransformPoint(PointToWorld(row.Point.X, row.Point.Y, 1.2f)),
                    Color = row.Color,
                    Accent = row.Color,
                    Activity = true,
                    Selected = selected,
                    Priority = selected ? 1500 : row.Priority
                });
                if (selected) selectedActivityLabelAdded = true;
                activityLabels++;
            }

            if (_selectedDynamic != null && _selectedDynamic.Point != null
                && !selectedActivityLabelAdded)
            {
                string semantic = string.IsNullOrWhiteSpace(_selectedDynamic.Semantic)
                    ? "ЦЕЛЬ"
                    : _selectedDynamic.Semantic.ToUpperInvariant();
                string name = _selectedDynamic.Name ?? _selectedDynamic.Id ?? "Точка пустоши";
                output.Add(new OverlayLabel
                {
                    Id = "selected:" + (_selectedDynamic.Id ?? name),
                    Text = "<b>" + EscapeOverlayText(semantic) + "</b>\n"
                        + EscapeOverlayText(name),
                    Semantic = semantic,
                    World = _root.transform.TransformPoint(PointToWorld(
                        _selectedDynamic.Point.X, _selectedDynamic.Point.Y, 1.26f)),
                    Color = _selectedDynamic.Accent,
                    Accent = FactionColor(_selectedDynamic.Faction, _selectedDynamic.Accent),
                    Activity = true,
                    Selected = true,
                    Cluster = false,
                    Priority = 1800
                });
            }

            if (profile.InfrastructureLabelLimit > 0)
                AppendInfrastructureLabels(output, profile.InfrastructureLabelLimit);

            if (_map.Nodes != null)
            {
                GlobalMapNode playerNode = PlayerNode;
                foreach (GlobalMapNode node in _map.Nodes)
                {
                    if (node == null) continue;
                    bool selected = _selectedNode == node;
                    bool playerLocation = playerNode == node;
                    bool coveredBySelectedTarget = _selectedDynamic?.Point != null
                        && Mathf.Abs(_selectedDynamic.Point.X - node.X) <= 1f
                        && Mathf.Abs(_selectedDynamic.Point.Y - node.Y) <= 1f;
                    if (coveredBySelectedTarget && !playerLocation) continue;
                    if (tier == MapDetailTier.Near && !selected && !playerLocation) continue;
                    string title = NodeTitle(node);
                    if (string.IsNullOrWhiteSpace(title)) continue;
                    output.Add(new OverlayLabel
                    {
                        Id = "node:" + (node.Id ?? node.EffectiveLocationId),
                        Text = EscapeOverlayText(title),
                        World = NodeLabelWorld(node, 0.9f),
                        Color = selected ? new Color(0.3f, 0.88f, 1f, 1f)
                                          : new Color(0.94f, 0.82f, 0.47f, 1f),
                        Accent = FactionColor(node.CapitalFaction,
                            new Color(0.94f, 0.82f, 0.47f, 1f)),
                        Activity = false,
                        Selected = selected,
                        Cluster = false,
                        Priority = selected ? 1600 : (playerLocation ? 1100 : 450)
                    });
                }
            }
            return output.Count;
        }

        private void AppendInfrastructureLabels(List<OverlayLabel> output, int limit)
        {
            if (_map?.Infrastructure == null || _root == null || limit <= 0) return;
            int added = 0;
            for (int i = 0; i < _map.Infrastructure.Count && added < limit; i++)
            {
                GlobalMapInfrastructure row = _map.Infrastructure[i];
                if (row == null || !string.Equals(row.Type, "road",
                        StringComparison.OrdinalIgnoreCase)
                    || row.Points == null || row.Points.Count < 2) continue;
                GlobalMapPoint point = row.Points[row.Points.Count / 2];
                if (point == null) continue;
                output.Add(new OverlayLabel
                {
                    Id = "infrastructure:" + (row.Id ?? added.ToString()),
                    Text = InfrastructureShortTitle(row.Id, row.Name),
                    World = _root.transform.TransformPoint(PointToWorld(point.X, point.Y, 0.54f)),
                    Color = new Color(0.82f, 0.66f, 0.36f, 0.92f),
                    Activity = false,
                    Selected = false,
                    Cluster = true,
                    Priority = 820 - added * 10
                });
                added++;
            }
        }

        public static string InfrastructureShortTitle(string id, string fallback)
        {
            switch ((id ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "southern_caravan_road": return "ЮЖНАЯ ТРАССА";
                case "relay_trade_road": return "ТОРГОВЫЙ ПУТЬ";
                case "old_northern_road": return "СЕВЕРНЫЙ ТРАКТ";
                default:
                    return string.IsNullOrWhiteSpace(fallback)
                        ? "СТАРАЯ ДОРОГА"
                        : fallback.Trim().ToUpperInvariant();
            }
        }

        /// <summary>Draw up to three pulsing rings for the compact live-event rail.</summary>
        public void SetActivityHighlights(IList<JObject> tasks)
        {
            var ids = new List<string>();
            if (tasks != null)
            {
                for (int i = 0; i < tasks.Count && i < 3; i++)
                    ids.Add(tasks[i]?["id"]?.ToString() ?? string.Empty);
            }
            string key = string.Join("|", ids);
            if (key == _activityHighlightKey && (_activityHighlightVisuals.Count > 0 || ids.Count == 0)) return;
            ClearActivityHighlights();
            _activityHighlightKey = key;
            if (_root == null || tasks == null) return;

            for (int i = 0; i < tasks.Count && i < 3; i++)
            {
                JObject task = tasks[i];
                GlobalMapPoint point;
                if (!TryActivityPoint(task, out point)) continue;
                Color color = ActivityColor(task);
                string type = task?["type"]?.ToString() ?? string.Empty;
                string kindLabel = ActivityKindLabel(type);
                string title = task?["title"]?.ToString() ?? string.Empty;
                string text = "<b>" + EscapeOverlayText(kindLabel.ToUpperInvariant()) + "</b>";
                if (!string.IsNullOrEmpty(title)
                    && !string.Equals(title, kindLabel, StringComparison.OrdinalIgnoreCase))
                    text += "\n" + EscapeOverlayText(title);
                _activityOverlayLabels.Add(new ActivityOverlayState
                {
                    Id = "activity:" + ids[i],
                    Text = text,
                    Point = CopyPoint(point),
                    Color = color,
                    Priority = 900 - i * 40
                });

                GameObject visual = InstantiateLivePrefab(ActivityPrefabKind(type),
                    "LiveActivity:" + ids[i]);
                if (visual == null) continue;
                visual.transform.localPosition = PointToWorld(point.X, point.Y, 0.34f + i * 0.02f);
                visual.transform.localRotation = Quaternion.identity;
                visual.transform.localScale = Vector3.one * (1f + i * 0.08f);
                TintLivePrefab(visual, color, "Tint");
                _activityHighlightVisuals.Add(new ActivityHighlightVisual
                {
                    Visual = visual,
                    BaseScale = visual.transform.localScale,
                    Phase = i * 0.9f
                });
            }
            ApplyDynamicPresentation(true);
        }

        private static RoaGlobalMapPrefabKind ActivityPrefabKind(string type)
        {
            switch (type ?? string.Empty)
            {
                case "escort_caravan": return RoaGlobalMapPrefabKind.ActivityCaravan;
                case "distress_signal": return RoaGlobalMapPrefabKind.ActivityDistress;
                case "recon_expedition": return RoaGlobalMapPrefabKind.ActivityRecon;
                case "resource_expedition": return RoaGlobalMapPrefabKind.ActivityResource;
                case "outpost_defense": return RoaGlobalMapPrefabKind.ActivityDefense;
                case "assault_diversion": return RoaGlobalMapPrefabKind.ActivityAssault;
                default: return RoaGlobalMapPrefabKind.TrackedTask;
            }
        }

        private bool TryActivityPoint(JObject task, out GlobalMapPoint point)
        {
            point = null;
            JToken x = task?["targetX"] ?? task?["details"]?["x"];
            JToken y = task?["targetY"] ?? task?["details"]?["y"];
            if (x != null && y != null && x.Type != JTokenType.Null && y.Type != JTokenType.Null)
            {
                point = new GlobalMapPoint { X = Float(x, 0f), Y = Float(y, 0f) };
                return true;
            }

            string siteId = task?["siteId"]?.ToString() ?? string.Empty;
            DynamicTarget target = _dynamicTargets.Find(row => row != null
                && (row.SiteId == siteId || (row.Kind == "site" && row.Id == siteId)));
            if (target != null)
            {
                point = CopyPoint(target.Point);
                return true;
            }

            foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
            {
                JObject site = token as JObject;
                if (site?["id"]?.ToString() != siteId) continue;
                point = new GlobalMapPoint { X = Float(site["x"], 0f), Y = Float(site["y"], 0f) };
                return true;
            }
            if (_map?.Nodes != null)
            {
                foreach (GlobalMapNode node in _map.Nodes)
                {
                    if (node == null || (node.Id != siteId && node.EffectiveLocationId != siteId)) continue;
                    point = new GlobalMapPoint { X = node.X, Y = node.Y };
                    return true;
                }
            }
            return false;
        }

        private static Color ActivityColor(JObject task)
        {
            switch (task?["type"]?.ToString() ?? string.Empty)
            {
                case "distress_signal": return new Color(1f, 0.28f, 0.16f, 1f);
                case "outpost_defense": return new Color(1f, 0.55f, 0.18f, 1f);
                case "recon_expedition": return new Color(0.35f, 0.86f, 0.92f, 1f);
                case "resource_expedition": return new Color(0.48f, 0.88f, 0.34f, 1f);
                case "assault_diversion": return new Color(0.96f, 0.38f, 0.24f, 1f);
                case "escort_caravan": return new Color(0.96f, 0.76f, 0.25f, 1f);
                default: return new Color(0.82f, 0.82f, 0.68f, 1f);
            }
        }

        private static string ActivityKindLabel(string kind)
        {
            switch (kind ?? string.Empty)
            {
                case "escort_caravan": return "Караван";
                case "distress_signal": return "Сигнал бедствия";
                case "recon_expedition": return "Разведка";
                case "resource_expedition": return "Вылазка за ресурсами";
                case "outpost_defense": return "Защита аванпоста";
                case "assault_diversion": return "Штурм / диверсия";
                default: return "Активность";
            }
        }

        private static string EscapeOverlayText(string value)
        {
            return (value ?? string.Empty).Replace("&", "&amp;")
                .Replace("<", "&lt;").Replace(">", "&gt;");
        }

        private string BuildWorldChangeKey()
        {
            JArray aftermaths = _wasteland?["worldPulse"]?["aftermaths"] as JArray;
            if (aftermaths == null || aftermaths.Count == 0) return string.Empty;
            var parts = new List<string>();
            foreach (JToken token in aftermaths)
            {
                JObject region = token as JObject;
                JObject aftermath = region?["aftermath"] as JObject;
                string siteId = region?["siteId"]?.ToString()
                    ?? aftermath?["siteId"]?.ToString() ?? string.Empty;
                string title = aftermath?["title"]?.ToString() ?? string.Empty;
                string outcome = aftermath?["outcome"]?.ToString() ?? string.Empty;
                string revision = aftermath?["revision"]?.ToString()
                    ?? aftermath?["updatedAt"]?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(siteId) || !string.IsNullOrEmpty(title))
                    parts.Add(siteId + ":" + outcome + ":" + revision + ":" + title);
            }
            return string.Join("|", parts);
        }

        private string BuildWorldChangeSummary()
        {
            JArray aftermaths = _wasteland?["worldPulse"]?["aftermaths"] as JArray;
            if (aftermaths == null || aftermaths.Count == 0) return string.Empty;
            if (aftermaths.Count == 1)
            {
                string title = aftermaths[0]?["aftermath"]?["title"]?.ToString() ?? string.Empty;
                return string.IsNullOrEmpty(title) ? "Мир изменился" : "Мир изменился · " + title;
            }
            return "Мир изменился: " + aftermaths.Count + " события";
        }

        private string BuildSelectedRiskLabel()
        {
            return _selectedPoint == null
                ? "неизвестно"
                : RiskLabel(DangerAtPoint(_selectedPoint, _selectedDynamic));
        }

        private float DangerAtPoint(GlobalMapPoint point, DynamicTarget target)
        {
            if (point == null) return 0f;
            float danger = Float(target?.Data?["danger"], 0f);
            if (_map?.Grid != null)
            {
                int cx = Mathf.Clamp(Mathf.FloorToInt(point.X / _map.Grid.CellPoints), 0,
                    _map.Grid.Cols - 1);
                int cy = Mathf.Clamp(Mathf.FloorToInt(point.Y / _map.Grid.CellPoints), 0,
                    _map.Grid.Rows - 1);
                if (_map.Cells.TryGetValue(cx + ":" + cy, out GlobalMapCell cell) && cell != null)
                {
                    danger = Mathf.Max(danger, Mathf.Clamp(
                        Mathf.Max(cell.Difficulty, cell.Danger) * 22f, 0f, 78f));
                    string pvp = (cell.PvpMode ?? string.Empty).ToLowerInvariant();
                    if (pvp.Contains("fulldrop")) danger = Mathf.Max(danger, 72f);
                    else if (pvp == "pvp") danger = Mathf.Max(danger, 46f);
                }
            }
            foreach (JToken token in _wasteland?["threatZones"] as JArray ?? new JArray())
            {
                JObject row = token as JObject;
                if (row == null) continue;
                bool hostileFaction = WorldPartyHostile(row["faction"]?.ToString());
                float chance = Float(row["chanceBonus"], 0f);
                float difficulty = Float(row["difficultyBonus"], 0f);
                if (!ThreatZoneShouldDisplay(row["kind"]?.ToString(), chance, difficulty,
                    hostileFaction)) continue;
                GlobalMapPoint threatPoint = ReadPoint(row, "x", "y", null);
                if (Distance(point, threatPoint) <= ThreatRadiusPoints(row))
                {
                    float inferred = Mathf.Clamp(32f + Mathf.Max(0f, difficulty) * 58f
                        + Mathf.Max(0f, chance) * 90f, 32f, 96f);
                    danger = Mathf.Max(danger, Float(row["danger"], inferred));
                }
            }
            foreach (JToken token in _wasteland?["worldZones"] as JArray ?? new JArray())
            {
                JObject row = token as JObject;
                if (row == null || !string.Equals(row["status"]?.ToString(), "active",
                    StringComparison.OrdinalIgnoreCase)) continue;
                GlobalMapPoint zonePoint = ReadPoint(row, "x", "y", null);
                float radius = Mathf.Clamp(Float(row["radius"], 7f), 2f, 40f);
                if (Distance(point, zonePoint) <= radius)
                    danger = Mathf.Max(danger, Float(row["danger"], 68f));
            }
            return danger;
        }

        public static string RiskLabel(float danger)
        {
            if (danger >= 85f) return "крайний";
            if (danger >= 60f) return "высокий";
            if (danger >= 30f) return "средний";
            return "низкий";
        }

        public static bool ThreatZoneShouldDisplay(string kind, float chanceBonus,
                                                   float difficultyBonus, bool hostileFaction)
        {
            string value = (kind ?? string.Empty).Trim().ToLowerInvariant();
            if (value == "caravan" || value == "patrol" || value == "trader"
                || value == "merchant" || value == "escort")
                return false;
            if (value == "resource" || value == "production" || value == "outpost"
                || value == "pointofinterest" || value == "settlement")
                return false;
            if (value == "monster" || value == "raider" || value == "hostile"
                || value == "predator" || value == "ambush" || value == "battle"
                || value == "beast" || value == "deathclaw" || value == "mutant"
                || value == "anomaly")
                return true;
            return hostileFaction || difficultyBonus >= 0.25f || chanceBonus >= 0.08f;
        }

        private float ThreatRadiusPoints(JObject row)
        {
            float direct = Float(row?["radius"], 0f);
            if (direct > 0f) return Mathf.Clamp(direct, 2f, 80f);
            float radiusKm = Float(row?["radiusKm"], 0f);
            if (radiusKm <= 0f || _map?.Grid == null) return 10f;
            return Mathf.Clamp(radiusKm / Mathf.Max(0.001f, _map.Grid.CellKm)
                * _map.Grid.CellPoints, 2f, 80f);
        }

        public static Color ThreatZoneColor(float difficultyBonus, float chanceBonus)
        {
            float severity = Mathf.Max(Mathf.Max(0f, difficultyBonus), Mathf.Max(0f, chanceBonus) * 4f);
            if (severity >= 0.75f) return new Color(0.93f, 0.20f, 0.13f, 0.38f);
            if (severity >= 0.35f) return new Color(1f, 0.46f, 0.12f, 0.32f);
            return new Color(0.96f, 0.67f, 0.18f, 0.26f);
        }

        private void PulseActivityHighlights()
        {
            for (int i = 0; i < _activityHighlightVisuals.Count; i++)
            {
                ActivityHighlightVisual state = _activityHighlightVisuals[i];
                if (state == null || state.Visual == null || !state.Visual.activeSelf) continue;
                float pulse = 1f + Mathf.Sin(Time.unscaledTime * 4.2f + state.Phase) * 0.09f;
                MapDetailTier tier = CurrentDetailTier();
                float detailScale = tier == MapDetailTier.Far ? 1.28f
                                  : (tier == MapDetailTier.Medium ? 1.12f : 1f);
                state.Visual.transform.localScale = state.BaseScale * pulse * detailScale;
                state.Visual.transform.Rotate(0f, Time.unscaledDeltaTime * 24f, 0f, Space.Self);
            }
        }

        private void PulseMapFocus()
        {
            MapDetailTier tier = CurrentDetailTier();
            float playerDetailScale = tier == MapDetailTier.Far ? 1.75f
                                    : (tier == MapDetailTier.Medium ? 1.35f : 1.08f);
            float selectionDetailScale = tier == MapDetailTier.Far ? 1.5f
                                       : (tier == MapDetailTier.Medium ? 1.25f : 1f);
            if (_playerMarker != null && _playerMarker.activeInHierarchy)
            {
                float breath = 1f + Mathf.Sin(Time.unscaledTime * 2.4f) * 0.025f;
                _playerMarker.transform.localScale = _playerMarkerBaseScale
                    * playerDetailScale * breath;
                _playerMarker.transform.localRotation = _playerMarkerBaseRotation;
            }
            if (_selectionMarker != null && _selectionMarker.activeInHierarchy)
            {
                float pulse = 1f + Mathf.Sin(Time.unscaledTime * 4.1f) * 0.075f;
                _selectionMarker.transform.localScale = _selectionMarkerBaseScale
                    * selectionDetailScale * pulse;
                _selectionMarker.transform.localRotation = _selectionMarkerBaseRotation
                    * Quaternion.Euler(0f, Time.unscaledTime * 26f, 0f);
            }
        }

        private void ClearActivityHighlights()
        {
            if (_authoredScene != null)
            {
                for (int i = 0; i < _activityHighlightVisuals.Count; i++)
                    if (_activityHighlightVisuals[i] != null)
                        _authoredScene.ReleaseLivePrefab(_activityHighlightVisuals[i].Visual);
            }
            _activityHighlightVisuals.Clear();
            _activityOverlayLabels.Clear();
            _activityHighlightKey = string.Empty;
        }


        /// <summary>Select an activity site and immediately request its server route.</summary>
        public bool RequestTravelToWorldSite(string siteId, Action<JObject> completed = null)
        {
            if (!IsActive || _arrivalPending || _locationEntryPending
                || _pendingContact != null || string.IsNullOrEmpty(siteId)) return false;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return false;
            }

            DynamicTarget target = _dynamicTargets.Find(row => row != null
                && (row.SiteId == siteId || (row.Kind == "site" && row.Id == siteId))
                && row.CanEnter);
            if (target != null)
            {
                _selectedDynamic = target;
                _selectedNode = null;
                _selectedPoint = CopyPoint(target.Point);
            }
            else
            {
                JObject site = null;
                foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
                {
                    JObject row = token as JObject;
                    if (row?["id"]?.ToString() == siteId) { site = row; break; }
                }
                string locationId = site?["locationId"]?.ToString() ?? siteId;
                GlobalMapNode node = null;
                if (_map != null && _map.Nodes != null)
                foreach (GlobalMapNode row in _map.Nodes)
                {
                    if (row.Id == siteId || row.Id == locationId || row.EffectiveLocationId == locationId)
                    {
                        node = row;
                        break;
                    }
                }
                if (node == null)
                {
                    StatusText = "Точка активности пока не нанесена на карту.";
                    return false;
                }
                _selectedDynamic = null;
                _selectedNode = node;
                _selectedPoint = new GlobalMapPoint { X = node.X, Y = node.Y };
            }

            RefreshMarkers();
            if (Distance(_playerPoint, _selectedPoint) <= 0.35f)
            {
                StatusText = "Вы прибыли к цели. Входим в локацию...";
                EnterCurrent();
                completed?.Invoke(new JObject { ["ok"] = true, ["alreadyThere"] = true });
                return true;
            }
            StartTravel(completed);
            return true;
        }

        public bool PlayerAtWorldSite(string siteId)
        {
            if (string.IsNullOrEmpty(siteId)) return false;
            JObject site = PlayerSiteData();
            if (site == null) return false;
            string id = site["id"]?.ToString() ?? string.Empty;
            string locationId = site["locationId"]?.ToString() ?? string.Empty;
            return id == siteId || locationId == siteId;
        }
        public bool SubmitPendingContactDecision(bool enter)
        {
            if (_pendingContact == null || _contactDecisionPending || !IsLocalTravelLeader()) return false;
            ResolveTravelContact(enter);
            return true;
        }

        public bool RequestLeaveAttachedWorldParty(Action<JObject> completed = null)
        {
            string taskId = AttachedPartyTaskId;
            if (string.IsNullOrEmpty(taskId) || _bootstrap?.Interaction == null) return false;
            StatusText = "Сервер подтверждает выход из отряда…";
            return _bootstrap.Interaction.SubmitWorldTaskAction(taskId, "cancel", ack =>
            {
                StatusText = ack?["ok"]?.ToObject<bool>() == true
                    ? "Вы покинули отряд и снова можете выбирать маршрут."
                    : (ack?["error"]?.ToString() ?? "Сервер не подтвердил выход из отряда.");
                completed?.Invoke(ack);
            });
        }

        private void StartTravel(Action<JObject> completed = null)
        {
            if (Socket == null || _arrivalPending || _locationEntryPending
                || _pendingContact != null) return;
            if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                StatusText = "Вы движетесь с отрядом. Сначала покиньте группу.";
                return;
            }
            if (Distance(_playerPoint, _selectedPoint) <= 0.35f)
            {
                StatusText = "Вы уже находитесь в этой точке.";
                return;
            }

            bool rerouting = _travelActive;
            int requestVersion = ++_routeRequestVersion;
            _routeRequestPending = true;
            _routeRequestWasReroute = rerouting;
            StatusText = rerouting ? "Сервер меняет маршрут..." : "Сервер строит маршрут...";
            string locationId = _selectedDynamic != null && !string.IsNullOrEmpty(_selectedDynamic.LocationId)
                ? _selectedDynamic.LocationId
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "wasteland");
            var payload = new
            {
                fromLocationId = _state?["fromLocationId"]?.ToString() ?? Socket.Session?.LocationId ?? "settlement",
                targetLocationId = locationId,
                siteId = _selectedDynamic?.SiteId ?? string.Empty,
                worldPoint = new { x = _selectedPoint.X, y = _selectedPoint.Y }
            };

            Socket.EmitWithAck("globalTravelStart", payload, ack =>
            {
                if (requestVersion != _routeRequestVersion) return;
                _routeRequestPending = false;
                _routeRequestWasReroute = false;
                if (!AckOk(ack))
                {
                    if (rerouting) RestoreTravelDestinationSelection();
                    StatusText = AckError(ack, rerouting
                        ? "Сервер не подтвердил изменение маршрута."
                        : "Сервер не подтвердил маршрут.");
                    completed?.Invoke(ack);
                    return;
                }

                ApplyTravel(ack);
                _travelDescriptorGraceUntil = Time.realtimeSinceStartup + TravelDescriptorGraceSeconds;
                RefreshMarkers();
                StatusText = rerouting ? "Маршрут изменён." : "Маршрут запущен.";
                completed?.Invoke(ack);
            });
        }

        private void RestoreTravelDestinationSelection()
        {
            if (!_travelActive || _route == null || _route.Count == 0) return;
            GlobalMapPoint destination = _route[_route.Count - 1];
            _selectedPoint = CopyPoint(destination);
            _selectedDynamic = NearestDynamicTarget(destination, DynamicSnapRadiusPoints);
            _selectedNode = _selectedDynamic == null
                ? NearestNode(destination, NodeSnapRadiusPoints)
                : null;
            RefreshMarkers();
        }

        private void CancelTravel()
        {
            if (!_travelActive || Socket == null || _arrivalPending) return;
            _routeRequestVersion++;
            _routeRequestPending = false;
            _routeRequestWasReroute = false;
            StatusText = "Останавливаем маршрут...";
            Socket.EmitWithAck("globalTravelCancel", new { }, ack =>
            {
                if (!AckOk(ack))
                {
                    StatusText = AckError(ack, "Сервер не смог остановить маршрут.");
                    return;
                }

                _playerPoint = ReadObjectPoint(ack["worldPoint"], _playerPoint);
                _selectedPoint = CopyPoint(_playerPoint);
                _selectedNode = NearestNode(_playerPoint, NodeSnapRadiusPoints);
                ClearTravel();
                RefreshMarkers();
                StatusText = "Маршрут остановлен.";
            });
        }

        private void RequestArrival()
        {
            if (Socket == null || _arrivalPending || _locationEntryPending) return;
            _arrivalPending = true;
            StatusText = "Сервер подтверждает прибытие...";
            string targetLocationId = _selectedDynamic != null && !string.IsNullOrEmpty(_selectedDynamic.LocationId)
                ? _selectedDynamic.LocationId
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "wasteland");
            Socket.EmitWithAck("globalTravelArrive", new
            {
                targetLocationId,
                siteId = _selectedDynamic?.SiteId ?? string.Empty,
                partyId = _selectedDynamic?.PartyId ?? string.Empty,
                worldZoneId = _selectedDynamic?.WorldZoneId ?? string.Empty,
                worldPoint = new { x = _selectedPoint.X, y = _selectedPoint.Y }
            }, ack =>
            {
                _arrivalPending = false;
                if (!AckOk(ack))
                {
                    JObject corrected = ack?["worldPoint"] as JObject;
                    if (corrected != null) _playerPoint = ReadObjectPoint(corrected, _playerPoint);
                    StatusText = AckError(ack, "Сервер не подтвердил прибытие.");
                    _arrivalRetryAt = Time.realtimeSinceStartup + 1.5f;
                    if (_contactArrival)
                    {
                        _selectedDynamic = _savedDestinationDynamic;
                        _selectedNode = _savedDestinationNode;
                        _selectedPoint = CopyPoint(_savedDestinationPoint);
                        _contactArrival = false;
                        RefreshMarkers();
                    }
                    return;
                }

                _contactArrival = false;
                ApplyArrival(ack);
            });
        }

        private void ApplyArrival(JObject payload)
        {
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _selectedPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();

            if (payload?["stayOnWorldMap"]?.ToObject<bool>() == true)
            {
                StatusText = "Вы прибыли в выбранную точку пустоши.";
                return;
            }

            RequestLocationEntry(payload);
        }

        private void RequestLocationEntry(JObject arrival)
        {
            if (arrival == null || Socket == null || _locationEntryPending) return;
            string locationId = arrival["targetLocationId"]?.ToString()
                             ?? arrival["locationId"]?.ToString();
            if (string.IsNullOrEmpty(locationId))
            {
                StatusText = "В ответе прибытия нет targetLocationId.";
                return;
            }

            _pendingEntry = true;
            _pendingArrival = (JObject)arrival.DeepClone();
            _pendingArrival["targetLocationId"] = locationId;
            _pendingArrivalKey = PendingArrivalKey(_pendingArrival);
            if (Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
            {
                StatusText = "Связь восстанавливается. Вход продолжится автоматически.";
                _locationEntryRetryAt = Time.realtimeSinceStartup + 1f;
                return;
            }

            StatusText = "Вход в локацию " + locationId + "...";
            _locationEntryPending = true;
            _locationEntryAttempts++;
            var payload = new
            {
                locationId,
                roomId = arrival["encounterRoomId"]?.ToString()
                      ?? arrival["roomId"]?.ToString()
                      ?? string.Empty,
                encounterId = arrival["encounterId"]?.ToString() ?? string.Empty,
                worldZoneId = arrival["worldZoneId"]?.ToString() ?? string.Empty,
                partyId = arrival["partyId"]?.ToString() ?? string.Empty,
                siteId = arrival["siteId"]?.ToString() ?? string.Empty,
                worldPoint = arrival["worldPoint"],
                pvpMode = arrival["pvpMode"]?.ToString() ?? string.Empty,
                entryKey = arrival["entryKey"]?.ToString() ?? "entryFromWorld",
                deviceType = Application.isMobilePlatform ? "mobile" : "desktop",
                controlType = Application.isMobilePlatform ? "touch" : "keyboard_mouse"
            };

            Socket.EmitWithAck("changeLocation", payload, ack =>
            {
                _locationEntryPending = false;
                if (!AckOk(ack))
                {
                    if (LocationEntryFailureRetryable(ack))
                    {
                        if (ShouldAutoRetryLocationEntry(_locationEntryAttempts, true))
                        {
                            float delay = LocationEntryRetryDelay(_locationEntryAttempts);
                            _locationEntryRetryAt = Time.realtimeSinceStartup + delay;
                            StatusText = "Ответ входа потерян. Повторяем через "
                                       + delay.ToString("0.#") + " с...";
                        }
                        else
                        {
                            _locationEntryRetryAt = float.PositiveInfinity;
                            StatusText = "Вход не подтверждён. Нажмите «Войти», чтобы повторить.";
                        }
                        return;
                    }

                    _pendingEntry = false;
                    _pendingArrival = null;
                    _pendingArrivalKey = string.Empty;
                    _locationEntryAttempts = 0;
                    _locationEntryRetryAt = 0f;
                    StatusText = AckError(ack, "Сервер не разрешил вход в локацию.");
                    return;
                }

                JoinAck session = Socket.ApplyLocationTransitionAck(ack);
                if (session == null)
                {
                    StatusText = "Не удалось разобрать ответ смены локации.";
                    return;
                }
                _pendingEntry = false;
                _pendingArrival = null;
                _pendingArrivalKey = string.Empty;
                _locationEntryAttempts = 0;
                _locationEntryRetryAt = 0f;
            });
        }

        private void ResumePendingLocationEntry()
        {
            if (!_pendingEntry || _pendingArrival == null || _locationEntryPending) return;
            if (!ShouldAutoRetryLocationEntry(_locationEntryAttempts, true))
            {
                _locationEntryRetryAt = float.PositiveInfinity;
                StatusText = "Вход не подтверждён. Нажмите «Войти», чтобы повторить.";
                return;
            }
            RequestLocationEntry(_pendingArrival);
        }

        public static bool ShouldAutoRetryLocationEntry(int attempts, bool pendingEntry)
        {
            return pendingEntry && attempts < LocationEntryAutomaticAttempts;
        }

        public static float LocationEntryRetryDelay(int attempts)
        {
            int exponent = Mathf.Clamp(attempts - 1, 0, 3);
            return LocationEntryRetryBaseSeconds * Mathf.Pow(2f, exponent);
        }

        public static bool LocationEntryFailureRetryable(JObject ack)
        {
            return ack == null
                || TokenTrue(ack["timeout"])
                || TokenTrue(ack["disconnected"])
                || TokenTrue(ack["empty"]);
        }

        private static string PendingArrivalKey(JObject arrival)
        {
            if (arrival == null) return string.Empty;
            return (arrival["targetLocationId"]?.ToString()
                    ?? arrival["locationId"]?.ToString()
                    ?? string.Empty)
                 + "|" + (arrival["siteId"]?.ToString() ?? string.Empty)
                 + "|" + (arrival["worldZoneId"]?.ToString() ?? string.Empty)
                 + "|" + (arrival["expiresAt"]?.ToString() ?? string.Empty);
        }

        private void HandleTravelStarted(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            ApplyTravel(payload);
            RefreshMarkers();
            StatusText = (payload?["leaderName"]?.ToString() ?? "Лидер группы") + " запустил маршрут.";
        }

        private void HandleEnteredWorld(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            Socket?.ApplyGlobalMapTransitionAck(payload);
            JObject state = StateFromWorldPoint(payload?["worldPoint"] as JObject,
                                                payload?["fromLocationId"]?.ToString());
            _bootstrap?.EnterGlobalMapFromServer(state);
        }

        private void HandleTravelCancelled(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _playerPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();
            StatusText = "Лидер группы остановил маршрут.";
        }

        private void HandleTravelArrived(JObject payload)
        {
            if (IsOwnLeaderEvent(payload)) return;
            ApplyArrival(payload);
        }

        private void HandleGroupReleased(JObject payload)
        {
            _playerPoint = ReadObjectPoint(payload?["worldPoint"], _playerPoint);
            _selectedPoint = CopyPoint(_playerPoint);
            ClearTravel();
            RefreshMarkers();
            StatusText = "Связь с лидером потеряна; маршрут снова можно выбирать самостоятельно.";
        }

        private void HandleEncounterDecision(JObject payload)
        {
            if (payload == null || IsOwnLeaderEvent(payload)) return;
            string title = payload["title"]?.ToString() ?? "событие мира";
            if (payload["pending"]?.ToObject<bool>() == true)
            {
                string id = payload["encounterId"]?.ToString() ?? string.Empty;
                _pendingContact = _dynamicTargets.Find(row => row.Id == id)
                    ?? new DynamicTarget { Id = id, Name = title, Point = CopyPoint(_playerPoint) };
                StatusText = "Лидер выбирает решение: " + title;
                return;
            }

            if (payload["decision"]?.ToString() == "skip")
            {
                _pendingContact = null;
                StatusText = "Лидер обходит событие: " + title;
            }
            else StatusText = "Лидер вступает в событие: " + title;
        }

        private bool IsOwnLeaderEvent(JObject payload)
        {
            string leaderId = payload?["leaderId"]?.ToString();
            return !string.IsNullOrEmpty(leaderId) && leaderId == Socket?.Session?.Id;
        }

        private bool IsLocalTravelLeader()
        {
            return string.IsNullOrEmpty(_travelLeaderId) || _travelLeaderId == Socket?.Session?.Id;
        }

        private bool WorldPartyHostile(string factionId)
        {
            string faction = FactionGroupKey(factionId);
            if (faction == "raiders" || faction == "mutants" || faction == "wild") return true;
            string playerFaction = FactionGroupKey(Socket?.Session?.Self?["worldFactionId"]?.ToString()
                ?? Socket?.Session?.Self?["factionId"]?.ToString());
            bool playerCivil = IsCivilFaction(playerFaction);
            return playerCivil && IsCivilFaction(faction) && playerFaction != faction;
        }

        private static bool IsCivilFaction(string faction)
        {
            return faction == "old_klim" || faction == "caravans"
                || faction == "scrap_union" || faction == "relay_order";
        }

        private static string FactionGroupKey(string faction)
        {
            string key = (faction ?? string.Empty).ToLowerInvariant();
            if (key == "old_klim" || key == "klim_patrol") return "old_klim";
            if (key == "caravan" || key == "caravans") return "caravans";
            if (key == "scrap" || key == "scrap_town" || key == "scrap_union") return "scrap_union";
            if (key == "relay" || key == "relay_station" || key == "relay_order") return "relay_order";
            if (key == "ghouls" || key == "radscorpions" || key == "mutant_ants"
                || key == "geckos" || key == "wild") return "wild";
            return string.IsNullOrEmpty(key) ? "neutral" : key;
        }

        private void UpdatePartyActors()
        {
            if (_partyActors == null || _partyActors.Count == 0 || _map?.Grid == null) return;
            float sampleAgeSeconds = CurrentWastelandSampleAgeSeconds();
            float gameDayRealMs = Float(_wasteland?["gameDayRealMs"], 60f * 60f * 1000f);
            float correction = 1f - Mathf.Exp(-PartyPositionCorrectionRate
                * Mathf.Max(0.001f, Time.unscaledDeltaTime));
            bool selectedMoved = false;

            foreach (PartyActorState state in _partyActors.Values)
            {
                if (state == null || state.Root == null || state.Snapshot == null) continue;
                GlobalMapPoint desiredPoint = WorldPartyDisplayPoint(state.Snapshot,
                    sampleAgeSeconds, _map.Grid.CellPoints, _map.Grid.CellKm, gameDayRealMs);
                Vector3 desiredLocal = PointToWorld(desiredPoint.X, desiredPoint.Y, 0.45f);
                Vector3 currentLocal = state.Root.transform.localPosition;
                if (!state.HasRenderedPoint
                    || Vector3.Distance(currentLocal, desiredLocal) > PartyPositionSnapWorldDistance)
                    currentLocal = desiredLocal;
                else
                    currentLocal = Vector3.Lerp(currentLocal, desiredLocal, correction);
                state.Root.transform.localPosition = currentLocal;
                state.HasRenderedPoint = true;

                GlobalMapPoint renderedPoint = WorldToPoint(state.Root.transform.position);
                if (state.Target != null) state.Target.Point = renderedPoint;
                if (state.Presentation != null) state.Presentation.Point = CopyPoint(renderedPoint);

                GlobalMapPoint lookAheadPoint = WorldPartyDisplayPoint(state.Snapshot,
                    sampleAgeSeconds + PartyFacingLookAheadSeconds,
                    _map.Grid.CellPoints, _map.Grid.CellKm, gameDayRealMs);
                Vector3 lookAheadLocal = PointToWorld(lookAheadPoint.X, lookAheadPoint.Y, 0.45f);
                Vector3 motionLocal = lookAheadLocal - currentLocal;
                if (motionLocal.sqrMagnitude <= 0.000001f)
                    motionLocal = desiredLocal - currentLocal;
                Vector3 motionWorld = _root != null
                    ? _root.transform.TransformDirection(motionLocal) : motionLocal;
                state.Actor?.SetMotion(motionWorld, motionLocal.sqrMagnitude > 0.000001f);

                if (_selectedDynamic != null && state.Target != null
                    && !string.IsNullOrEmpty(_selectedDynamic.PartyId)
                    && _selectedDynamic.PartyId == state.Target.PartyId)
                {
                    _selectedDynamic = state.Target;
                    if (!_travelActive)
                    {
                        _selectedPoint = CopyPoint(renderedPoint);
                        selectedMoved = true;
                    }
                }
            }

            if (selectedMoved && _selectionMarker != null)
                _selectionMarker.transform.localPosition = PointToWorld(
                    _selectedPoint.X, _selectedPoint.Y, 0.13f);
        }

        private void UpdateStrategicActorPresentation()
        {
            MapDetailTier mapTier = CurrentDetailTier();
            bool mobile = Application.isMobilePlatform;
            Vector3 observer = _cameraAnchor != null
                ? _cameraAnchor.transform.position
                : (_root != null ? _root.transform.position : Vector3.zero);

            if (_playerActor != null && _playerMarker != null)
            {
                RoaActorPresentationTier playerTier = StrategicActorPresentationTier(
                    mapTier, true, false, _playerMarker.transform.position, observer,
                    mobile, _playerActor.PresentationTier);
                _playerActor.SetPresentationLod(playerTier);
            }

            if (_partyActors == null) return;
            foreach (PartyActorState state in _partyActors.Values)
            {
                if (state?.Actor == null || state.Root == null) continue;
                bool markerVisible = state.Presentation == null
                    || state.Presentation.TargetVisible;
                bool selected = _selectedDynamic != null && state.Target != null
                    && !string.IsNullOrEmpty(state.Target.PartyId)
                    && state.Target.PartyId == _selectedDynamic.PartyId;
                RoaActorPresentationTier tier = StrategicActorPresentationTier(
                    mapTier, markerVisible, selected, state.Root.transform.position,
                    observer, mobile, state.Actor.PresentationTier);
                state.Actor.SetPresentationLod(tier);
            }
        }

        private float CurrentWastelandSampleAgeSeconds()
        {
            if (_wastelandAppliedRealtime < 0f
                || Number(_wasteland?["sampledAt"], 0d) <= 0d) return 0f;
            double ageMs = Math.Max(0d, _wastelandSampleAgeMs
                + Math.Max(0f, Time.realtimeSinceStartup - _wastelandAppliedRealtime) * 1000d);
            return Mathf.Min(WastelandMaxExtrapolationSeconds, (float)(ageMs / 1000d));
        }

        public static GlobalMapPoint WorldPartyDisplayPoint(JObject party,
                                                             float sampleAgeSeconds,
                                                             float cellPoints,
                                                             float cellKm,
                                                             float gameDayRealMs)
        {
            GlobalMapPoint basePoint = ReadPoint(party, "x", "y", null);
            if (party == null || TokenTrue(party["destroyed"])) return basePoint;
            string state = (party["state"]?.ToString() ?? string.Empty).Trim().ToLowerInvariant();
            if (state == "engaged" || state == "onsite" || state == "staging"
                || state == "recovering" || state == "forming" || state == "destroyed")
                return basePoint;

            List<GlobalMapPoint> route = ReadRoute(party["movementRoutePoints"] as JArray);
            for (int i = route.Count - 1; i > 0; i--)
                if (Distance(route[i - 1], route[i]) <= 0.01f) route.RemoveAt(i);
            if (route.Count == 0) route.Add(CopyPoint(basePoint));
            else if (Distance(basePoint, route[0]) > 0.05f) route.Insert(0, CopyPoint(basePoint));
            else route[0] = CopyPoint(basePoint);

            float routeDistance = 0f;
            for (int i = 1; i < route.Count; i++)
                routeDistance += Distance(route[i - 1], route[i]);
            float speedKmh = Mathf.Max(0f, Float(party["speedKmh"], 0f));
            float pointKm = Mathf.Max(0.001f, cellKm / Mathf.Max(0.001f, cellPoints));
            if (routeDistance <= 0.001f || speedKmh <= 0f) return basePoint;

            float safeAge = Mathf.Clamp(sampleAgeSeconds, 0f,
                WastelandMaxExtrapolationSeconds);
            float worldHours = safeAge * 1000f
                / Mathf.Max(60000f, gameDayRealMs) * 24f;
            float travelPoints = Mathf.Min(routeDistance, speedKmh * worldHours / pointKm);
            return PointAtRouteProgress(route, travelPoints / routeDistance);
        }

        private void RefreshMarkers()
        {
            if (_playerMarker != null) _playerMarker.transform.localPosition = PointToWorld(_playerPoint.X, _playerPoint.Y, 0.62f);
            if (_selectionMarker != null) _selectionMarker.transform.localPosition = PointToWorld(_selectedPoint.X, _selectedPoint.Y, 0.13f);
        }

        private Vector3 NodeLabelWorld(GlobalMapNode node, float height)
        {
            if (_authoredScene != null && node != null
                && _authoredScene.TryGetNode(node.Id, out RoaGlobalMapNodeAnchor anchor)
                && anchor != null)
                return anchor.transform.position + Vector3.up * height;
            Vector3 local = node != null ? PointToWorld(node.X, node.Y, height) : Vector3.up * height;
            return _root != null ? _root.transform.TransformPoint(local) : local;
        }

        private void ConfigureMapLighting()
        {
            if (!_mapLightingSaved)
            {
                _mapLightingSaved = true;
                _savedAmbientMode = RenderSettings.ambientMode;
                _savedAmbientSky = RenderSettings.ambientSkyColor;
                _savedAmbientEquator = RenderSettings.ambientEquatorColor;
                _savedAmbientGround = RenderSettings.ambientGroundColor;
                _savedAmbientIntensity = RenderSettings.ambientIntensity;
                _savedReflectionIntensity = RenderSettings.reflectionIntensity;
                _savedFog = RenderSettings.fog;
                _savedFogMode = RenderSettings.fogMode;
                _savedFogColor = RenderSettings.fogColor;
                _savedFogStartDistance = RenderSettings.fogStartDistance;
                _savedFogEndDistance = RenderSettings.fogEndDistance;
                _savedFogDensity = RenderSettings.fogDensity;
                _savedSun = RenderSettings.sun;
            }

            // Local scene lighting is disabled while travelling, so the authored
            // strategic map owns a warm, readable light setup of its own. Linear
            // distance fog merges the authored table edge into the charcoal void;
            // it never obscures the playable centre or replaces authored geometry.
            float span = Mathf.Max(MapWidthPoints, MapHeightPoints) * MapWorldScale;
            StrategicVisualProfile profile = StrategicProfile(span);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = profile.AmbientSky;
            RenderSettings.ambientEquatorColor = profile.AmbientEquator;
            RenderSettings.ambientGroundColor = profile.AmbientGround;
            RenderSettings.ambientIntensity = profile.AmbientIntensity;
            RenderSettings.reflectionIntensity = profile.ReflectionIntensity;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = profile.FogColor;
            RenderSettings.fogStartDistance = profile.FogStart;
            RenderSettings.fogEndDistance = profile.FogEnd;

            if (_authoredScene != null)
            {
                Light[] authoredLights = _authoredScene.GetComponentsInChildren<Light>(true);
                for (int i = 0; i < authoredLights.Length; i++)
                {
                    Light candidate = authoredLights[i];
                    if (candidate == null || candidate.type != LightType.Directional) continue;
                    candidate.enabled = true;
                    RenderSettings.sun = candidate;
                    break;
                }
            }

            if (_atmosphere == null)
                _atmosphere = RoaGlobalMapAtmosphere.Attach(this, RenderSettings.sun, CameraRig);
        }

        private void RestoreMapLighting()
        {
            if (_atmosphere != null)
            {
                _atmosphere.DisposeAtmosphere();
                _atmosphere = null;
            }
            if (!_mapLightingSaved) return;
            RenderSettings.ambientMode = _savedAmbientMode;
            RenderSettings.ambientSkyColor = _savedAmbientSky;
            RenderSettings.ambientEquatorColor = _savedAmbientEquator;
            RenderSettings.ambientGroundColor = _savedAmbientGround;
            RenderSettings.ambientIntensity = _savedAmbientIntensity;
            RenderSettings.reflectionIntensity = _savedReflectionIntensity;
            RenderSettings.fog = _savedFog;
            RenderSettings.fogMode = _savedFogMode;
            RenderSettings.fogColor = _savedFogColor;
            RenderSettings.fogStartDistance = _savedFogStartDistance;
            RenderSettings.fogEndDistance = _savedFogEndDistance;
            RenderSettings.fogDensity = _savedFogDensity;
            RenderSettings.sun = _savedSun;
            _mapLightingSaved = false;
        }

        private void ConfigureCamera()
        {
            if (CameraRig == null || _cameraAnchor == null) return;
            if (!_cameraSaved)
            {
                _cameraSaved = true;
                _savedDistance = CameraRig.Distance;
                _savedMinDistance = CameraRig.MinDistance;
                _savedMaxDistance = CameraRig.MaxDistance;
                _savedPitch = CameraRig.PitchDeg;
                _savedYaw = CameraRig.YawDeg;
                _savedFieldOfView = CameraRig.CurrentFieldOfView;
                Camera view = CameraRig.GetComponent<Camera>();
                if (view != null)
                {
                    _savedCameraClearFlags = view.clearFlags;
                    _savedCameraBackground = view.backgroundColor;
                }
            }

            CameraRig.ZoomPersistenceEnabled = false;
            CameraRig.SetFieldOfView(RoaCameraRig.StrategicFieldOfView);
            Camera mapCamera = CameraRig.GetComponent<Camera>();
            if (mapCamera != null)
            {
                float mapSpan = Mathf.Max(MapWidthPoints, MapHeightPoints) * MapWorldScale;
                StrategicVisualProfile profile = StrategicProfile(mapSpan);
                mapCamera.clearFlags = CameraClearFlags.SolidColor;
                mapCamera.backgroundColor = profile.CameraBackground;
            }

            float span = Mathf.Max(MapWidthPoints, MapHeightPoints) * MapWorldScale;
            CameraRig.Target = _cameraAnchor.transform;
            CameraRig.PitchDeg = StrategicDefaultPitchDeg;
            CameraRig.YawDeg = StrategicDefaultYawDeg;
            CameraRig.MinDistance = StrategicMinimumCameraDistance(span);
            CameraRig.MaxDistance = StrategicMaximumCameraDistance(span);
            CameraRig.Distance = Mathf.Clamp(span * 1.05f, CameraRig.MinDistance, CameraRig.MaxDistance);
            CameraRig.SnapToTarget();
            ApplyDynamicPresentation(true);
        }

        private void RestoreCamera()
        {
            if (!_cameraSaved || CameraRig == null) return;
            CameraRig.Distance = _savedDistance;
            CameraRig.MinDistance = _savedMinDistance;
            CameraRig.MaxDistance = _savedMaxDistance;
            CameraRig.PitchDeg = _savedPitch;
            CameraRig.YawDeg = _savedYaw;
            CameraRig.SetFieldOfView(_savedFieldOfView);
            Camera view = CameraRig.GetComponent<Camera>();
            if (view != null)
            {
                view.clearFlags = _savedCameraClearFlags;
                view.backgroundColor = _savedCameraBackground;
            }
            CameraRig.ZoomPersistenceEnabled = true;
            _cameraSaved = false;
        }

        private void ClearVisuals()
        {
            ClearPartyActors();
            if (_authoredScene != null) _authoredScene.ClearDynamicContent();
            if (_root != null)
            {
                _root.SetActive(false);
            }
            if (_authoredUnityScene.IsValid() && _authoredUnityScene.isLoaded)
                _authoredSceneUnload = SceneManager.UnloadSceneAsync(_authoredUnityScene);
            _authoredUnityScene = default;
            _authoredScene = null;
            _root = null;
            _rimBuilt = false;
            RimRidgeCount = 0;
            _playerMarker = null;
            _playerActor = null;
            _selectionMarker = null;
            _cameraAnchor = null;
            _terrainCollider = null;
            _routeVisuals.Clear();
            _routeVisualBaseScales.Clear();
            _routeVisualProgress.Clear();
            _routeVisualShadows.Clear();
            _appliedRouteProgress = -1f;
            _dynamicPresentationVisuals.Clear();
            _appliedDetailTier = (MapDetailTier)(-1);
            _dynamicRoot = null;
            _dynamicTargets?.Clear();
            ClearHoverPreview();
            _routeVisuals?.Clear();
            _activityHighlightVisuals?.Clear();
            _activityOverlayLabels?.Clear();
            _activityHighlightKey = string.Empty;

            _territoryByCell?.Clear();
            _factionSummary = string.Empty;
            TerritoryCellCount = 0;
            TerritoryBorderCount = 0;
            InfluenceZoneCount = 0;
            SettlementModelCount = 0;
            SiteMarkerCount = 0;
            SettlementStatusCount = 0;
            ThreatMarkerCount = 0;
        }

        private GameObject InstantiateLivePrefab(RoaGlobalMapPrefabKind kind, string objectName,
                                                 Transform parent = null)
        {
            if (_authoredScene == null || _dynamicRoot == null) return null;
            GameObject instance = _authoredScene.InstantiateLivePrefab(kind,
                parent != null ? parent : _dynamicRoot.transform);
            if (instance == null) return null;
            instance.name = objectName;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            return instance;
        }

        private void EnsurePlayerActor()
        {
            if (_playerMarker == null) return;
            if (_playerActor == null || _playerActor.gameObject != _playerMarker)
            {
                _playerActor = _playerMarker.GetComponent<RoaGlobalMapActorView>();
                if (_playerActor == null)
                    _playerActor = _playerMarker.AddComponent<RoaGlobalMapActorView>();
            }

            JObject self = Socket?.Session?.Self;
            _ = _playerActor.ConfigurePlayer(BaseUrl, self ?? new JObject());
        }

        private PartyActorState EnsurePartyActor(string id)
        {
            if (string.IsNullOrEmpty(id) || _authoredScene == null || _dynamicRoot == null)
                return null;
            if (_partyActors.TryGetValue(id, out PartyActorState current)
                && current != null && current.Root != null)
                return current;

            GameObject prefab = _authoredScene.PrefabFor(RoaGlobalMapPrefabKind.Party);
            if (prefab == null) return null;
            GameObject root = Instantiate(prefab, _dynamicRoot.transform);
            root.name = "WorldParty:" + id;
            root.transform.localPosition = Vector3.zero;
            root.transform.localRotation = Quaternion.identity;
            root.SetActive(true);
            RoaGlobalMapActorView actor = root.GetComponent<RoaGlobalMapActorView>();
            if (actor == null) actor = root.AddComponent<RoaGlobalMapActorView>();

            var state = new PartyActorState
            {
                Id = id,
                Root = root,
                Actor = actor,
                BaseScale = root.transform.localScale
            };
            _partyActors[id] = state;
            return state;
        }

        private void IndexExistingPartyActors()
        {
            if (_dynamicRoot == null || _partyActors == null || _authoredScene == null) return;
            GameObject prefab = _authoredScene.PrefabFor(RoaGlobalMapPrefabKind.Party);
            Vector3 authoredScale = prefab != null ? prefab.transform.localScale : Vector3.one;
            Transform content = _dynamicRoot.transform;
            for (int i = 0; i < content.childCount; i++)
            {
                Transform child = content.GetChild(i);
                if (child == null || !child.name.StartsWith("WorldParty:",
                    StringComparison.Ordinal)) continue;
                RoaGlobalMapActorView actor = child.GetComponent<RoaGlobalMapActorView>();
                if (actor == null) continue;
                string id = child.name.Substring("WorldParty:".Length);
                if (string.IsNullOrEmpty(id)) continue;
                if (_partyActors.TryGetValue(id, out PartyActorState indexed)
                    && indexed != null && indexed.Root != null)
                {
                    if (indexed.Root != child.gameObject) Destroy(child.gameObject);
                    continue;
                }
                _partyActors[id] = new PartyActorState
                {
                    Id = id,
                    Root = child.gameObject,
                    Actor = actor,
                    BaseScale = authoredScale,
                    HasRenderedPoint = true
                };
            }
        }

        private void RemoveMissingPartyActors()
        {
            if (_partyActors.Count == 0) return;
            var removed = new List<string>();
            foreach (KeyValuePair<string, PartyActorState> pair in _partyActors)
            {
                if (_seenPartyActors.Contains(pair.Key)) continue;
                if (pair.Value?.Root != null) Destroy(pair.Value.Root);
                removed.Add(pair.Key);
            }
            for (int i = 0; i < removed.Count; i++) _partyActors.Remove(removed[i]);
        }

        private void ClearPartyActors()
        {
            if (_partyActors != null)
            {
                foreach (PartyActorState state in _partyActors.Values)
                    if (state?.Root != null) Destroy(state.Root);
                _partyActors.Clear();
            }
            _seenPartyActors?.Clear();
        }

        private void TintLivePrefab(GameObject target, Color color, string childNameFilter = null)
        {
            if (target == null) return;
            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null) continue;
                if (!string.IsNullOrEmpty(childNameFilter)
                    && renderer.gameObject.name.IndexOf(childNameFilter, StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                _colorBlock.Clear();
                _colorBlock.SetColor(BaseColorProperty, color);
                _colorBlock.SetColor(ColorProperty, color);
                renderer.SetPropertyBlock(_colorBlock);
            }
        }

        private float MapWidthPoints { get { return _map.Grid.Cols * _map.Grid.CellPoints; } }
        private float MapHeightPoints { get { return _map.Grid.Rows * _map.Grid.CellPoints; } }

        private RoaGlobalMapRelief _relief;
        private bool _reliefLoaded;

        /// <summary>
        /// Запечённый рельеф авторской карты. Единственная точка врезки —
        /// PointToWorld: маркеры, кольца, отряды, подписи и территория едут по
        /// холмам автоматически. Нет ассета — карта плоская, как раньше.
        /// </summary>
        private float ReliefHeightAt(float x, float y)
        {
            if (!_reliefLoaded)
            {
                _reliefLoaded = true;
                _relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            }
            return _relief != null && _relief.Ready ? _relief.HeightAt(x, y) : 0f;
        }

        private Vector3 PointToWorld(float x, float y, float height)
        {
            return new Vector3((x - MapWidthPoints * 0.5f) * MapWorldScale,
                               height + ReliefHeightAt(x, y),
                               (MapHeightPoints * 0.5f - y) * MapWorldScale);
        }

        private GlobalMapPoint WorldToPoint(Vector3 world)
        {
            Vector3 local = _root != null ? _root.transform.InverseTransformPoint(world) : world;
            return new GlobalMapPoint
            {
                X = Mathf.Clamp(local.x / MapWorldScale + MapWidthPoints * 0.5f, 0f, MapWidthPoints),
                Y = Mathf.Clamp(MapHeightPoints * 0.5f - local.z / MapWorldScale, 0f, MapHeightPoints)
            };
        }

        private GlobalMapNode NearestNode(GlobalMapPoint point, float radius)
        {
            GlobalMapNode best = null;
            float bestDistance = radius;
            foreach (GlobalMapNode node in _map.Nodes)
            {
                float distance = Mathf.Sqrt((node.X - point.X) * (node.X - point.X)
                                          + (node.Y - point.Y) * (node.Y - point.Y));
                if (distance > bestDistance) continue;
                best = node;
                bestDistance = distance;
            }
            return best;
        }

        private DynamicTarget NearestDynamicTarget(GlobalMapPoint point, float radius,
                                                   bool respectPresentation = false)
        {
            DynamicTarget best = null;
            float bestDistance = radius;
            foreach (DynamicTarget target in _dynamicTargets)
            {
                if (target == null || target.Point == null) continue;
                if (!target.CanEnter && !string.Equals(target.Kind, "site", StringComparison.OrdinalIgnoreCase)) continue;
                if (respectPresentation && !TargetVisibleForSelection(target,
                    CurrentDetailTier())) continue;
                float distance = Distance(point, target.Point);
                if (distance > bestDistance) continue;
                if (best != null && Mathf.Abs(distance - bestDistance) <= 0.001f
                    && target.Priority <= best.Priority) continue;
                best = target;
                bestDistance = distance;
            }
            return best;
        }

        private bool TargetVisibleForSelection(DynamicTarget target, MapDetailTier tier)
        {
            if (target == null || target.Point == null) return false;
            if (!TargetKindVisibleAtTier(target.Kind, tier, _showEvents, _showParties))
                return false;

            MapPresentationProfile profile = PresentationProfile(tier);
            float bucket = string.Equals(target.Kind, "site", StringComparison.OrdinalIgnoreCase)
                ? profile.SiteBucket
                : (string.Equals(target.Kind, "party", StringComparison.OrdinalIgnoreCase)
                    ? profile.PartyBucket
                    : (string.Equals(target.Kind, "zone", StringComparison.OrdinalIgnoreCase)
                        ? profile.ThreatBucket : 0f));
            return bucket <= 0f || PresentationTargetWinner(target, bucket);
        }

        private bool PresentationTargetWinner(DynamicTarget candidate, float bucketSize)
        {
            if (candidate == null || candidate.Point == null) return false;
            string bucket = PresentationBucket(candidate.Point, bucketSize);
            DynamicTarget winner = null;
            for (int i = 0; i < _dynamicTargets.Count; i++)
            {
                DynamicTarget current = _dynamicTargets[i];
                if (current == null || current.Point == null
                    || !string.Equals(current.Kind, candidate.Kind,
                        StringComparison.OrdinalIgnoreCase)
                    || PresentationBucket(current.Point, bucketSize) != bucket) continue;
                if (winner == null || current.Priority > winner.Priority) winner = current;
            }
            return ReferenceEquals(winner, candidate);
        }

        private static float PointSegmentDistance(GlobalMapPoint point, GlobalMapPoint from,
                                                  GlobalMapPoint to, out float t)
        {
            float dx = to.X - from.X;
            float dy = to.Y - from.Y;
            float lengthSq = dx * dx + dy * dy;
            t = lengthSq > 0.0001f
                ? Mathf.Clamp01(((point.X - from.X) * dx + (point.Y - from.Y) * dy) / lengthSq)
                : 0f;
            float x = from.X + dx * t;
            float y = from.Y + dy * t;
            float px = point.X - x;
            float py = point.Y - y;
            return Mathf.Sqrt(px * px + py * py);
        }

        private static bool PartyCanEncounter(JObject row)
        {
            if (row == null || row["destroyed"]?.ToObject<bool>() == true) return false;
            string state = row["state"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            if (state == "destroyed" || state == "onsite" || state == "engaged") return false;
            return Float(row["members"], Float(row["strength"], 0f)) > 0f;
        }

        private static float PartyRadius(JObject row)
        {
            string kind = row?["kind"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            string faction = row?["faction"]?.ToString()?.ToLowerInvariant() ?? string.Empty;
            string species = ((row?["species"]?.ToString() ?? string.Empty) + " "
                            + (row?["visual"]?.ToString() ?? string.Empty) + " "
                            + (row?["name"]?.ToString() ?? string.Empty)).ToLowerInvariant();
            float radius = 5.8f;
            if (kind == "caravan") radius = 8.2f;
            else if (kind == "patrol") radius = 6.4f;
            else if (faction == "raiders" || kind == "raider") radius = 6.2f;
            else if (faction == "mutants") radius = 7f;
            else if (species.Contains("radscorpion") || species.Contains("scorpion") || species.Contains("скорпион")) radius = 7.2f;
            else if (species.Contains("gecko") || species.Contains("геккон")) radius = 6.8f;
            else if (species.Contains("brahmin") || species.Contains("брамин")) radius = 7.4f;
            else if (species.Contains("ant") || species.Contains("мурав")) radius = 6f;
            else if (species.Contains("wolf") || species.Contains("волк")) radius = 6.4f;
            return Mathf.Clamp(radius, 5.2f, 8.8f);
        }

        private void ResolveSelectedDynamic()
        {
            if (_selectedDynamic == null) return;
            foreach (DynamicTarget target in _dynamicTargets)
            {
                bool same = !string.IsNullOrEmpty(_selectedDynamic.WorldZoneId)
                    ? target.WorldZoneId == _selectedDynamic.WorldZoneId
                    : (!string.IsNullOrEmpty(_selectedDynamic.PartyId)
                        ? target.PartyId == _selectedDynamic.PartyId
                        : (!string.IsNullOrEmpty(_selectedDynamic.SiteId) && target.SiteId == _selectedDynamic.SiteId));
                if (!same) continue;
                _selectedDynamic = target;
                if (!_travelActive) _selectedPoint = CopyPoint(target.Point);
                RefreshMarkers();
                return;
            }
        }

        private Color FactionColor(string factionId, Color fallback)
        {
            if (string.IsNullOrEmpty(factionId) || _wasteland == null) return fallback;
            string hex = _wasteland["factions"]?[factionId]?["color"]?.ToString();
            Color color;
            return !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out color) ? color : fallback;
        }

        private static GlobalMapPoint PointAtRouteProgress(IList<GlobalMapPoint> route, float progress)
        {
            if (route == null || route.Count == 0) return new GlobalMapPoint();
            if (route.Count == 1) return CopyPoint(route[0]);

            float total = 0f;
            for (int i = 1; i < route.Count; i++) total += Distance(route[i - 1], route[i]);
            if (total <= 0.0001f) return CopyPoint(route[route.Count - 1]);

            float remaining = Mathf.Clamp01(progress) * total;
            for (int i = 1; i < route.Count; i++)
            {
                float segment = Distance(route[i - 1], route[i]);
                if (remaining <= segment || i == route.Count - 1)
                {
                    float t = segment > 0.0001f ? Mathf.Clamp01(remaining / segment) : 1f;
                    return new GlobalMapPoint
                    {
                        X = Mathf.Lerp(route[i - 1].X, route[i].X, t),
                        Y = Mathf.Lerp(route[i - 1].Y, route[i].Y, t)
                    };
                }
                remaining -= segment;
            }
            return CopyPoint(route[route.Count - 1]);
        }

        private static float Distance(GlobalMapPoint a, GlobalMapPoint b)
        {
            if (a == null || b == null) return 0f;
            float dx = a.X - b.X;
            float dy = a.Y - b.Y;
            return Mathf.Sqrt(dx * dx + dy * dy);
        }

        private static GlobalMapPoint CopyPoint(GlobalMapPoint point)
        {
            return point == null ? new GlobalMapPoint() : new GlobalMapPoint { X = point.X, Y = point.Y };
        }

        private static GlobalMapPoint ReadPoint(JObject source, string xName, string yName, GlobalMapPoint fallback)
        {
            if (source == null) return CopyPoint(fallback);
            return new GlobalMapPoint
            {
                X = Float(source[xName], fallback != null ? fallback.X : 0f),
                Y = Float(source[yName], fallback != null ? fallback.Y : 0f)
            };
        }

        private static GlobalMapPoint ReadObjectPoint(JToken token, GlobalMapPoint fallback)
        {
            JObject point = token as JObject;
            return point == null ? CopyPoint(fallback) : ReadPoint(point, "x", "y", fallback);
        }

        private static List<GlobalMapPoint> ReadRoute(JArray rows)
        {
            var result = new List<GlobalMapPoint>();
            if (rows == null) return result;
            foreach (JToken row in rows)
            {
                JObject point = row as JObject;
                if (point != null) result.Add(ReadPoint(point, "x", "y", null));
            }
            return result;
        }

        private static float Float(JToken token, float fallback)
        {
            if (token == null) return fallback;
            // JValue.ToString() форматирует double текущей культурой (ru-RU даёт "173,3"),
            // и инвариантный разбор такой строки молча возвращал fallback. Числовые токены
            // читаем напрямую, строки разбираем инвариантно.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();
            float value;
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                                  System.Globalization.CultureInfo.InvariantCulture, out value)
                ? value
                : fallback;
        }

        private static double Number(JToken token, double fallback)
        {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
                return token.Value<double>();
            double value;
            return double.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                                   System.Globalization.CultureInfo.InvariantCulture, out value)
                ? value
                : fallback;
        }

        private static bool AckOk(JObject ack)
        {
            return ack != null && TokenTrue(ack["ok"]);
        }

        private static bool TokenTrue(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null
                || token.Type == JTokenType.Undefined) return false;
            if (token.Type == JTokenType.Boolean) return token.Value<bool>();
            bool value;
            return bool.TryParse(token.ToString(), out value) && value;
        }

        private static string AckError(JObject ack, string fallback)
        {
            return ack?["error"]?.ToString() ?? fallback;
        }

        private static JObject StateFromWorldPoint(JObject point, string fromLocationId)
        {
            float x = Float(point?["x"], 0f);
            float y = Float(point?["y"], 0f);
            return new JObject
            {
                ["version"] = 1,
                ["onWorldMap"] = true,
                ["fromLocationId"] = string.IsNullOrEmpty(fromLocationId) ? "settlement" : fromLocationId,
                ["playerX"] = x,
                ["playerY"] = y,
                ["selectedX"] = x,
                ["selectedY"] = y
            };
        }

        private static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 0xff) / 255f,
                             ((rgb >> 8) & 0xff) / 255f,
                             (rgb & 0xff) / 255f, 1f);
        }

        private string BuildSelectionSummary()
        {
            if (_map == null || _map.Grid == null || _selectedPoint == null) return string.Empty;
            int cx = Mathf.Clamp(Mathf.FloorToInt(_selectedPoint.X / _map.Grid.CellPoints), 0, _map.Grid.Cols - 1);
            int cy = Mathf.Clamp(Mathf.FloorToInt(_selectedPoint.Y / _map.Grid.CellPoints), 0, _map.Grid.Rows - 1);
            var lines = new List<string>();

            GlobalMapCell cell;
            _map.Cells.TryGetValue(cx + ":" + cy, out cell);
            string terrain = cell != null && !string.IsNullOrEmpty(cell.Terrain)
                ? cell.Terrain
                : TerrainLabel(cell != null ? cell.Texture : string.Empty);
            int difficulty = cell != null ? Mathf.Max(cell.Difficulty, cell.Danger) : 0;
            float chance = cell != null ? cell.Chance : 0f;
            string cellLine = "Клетка " + (cx + 1) + ":" + (cy + 1) + " · " + terrain;
            if (difficulty > 0) cellLine += " · опасность " + difficulty;
            if (chance > 0.01f) cellLine += " · встреча " + chance.ToString("0.#") + "%";
            if (cell != null && !string.IsNullOrEmpty(cell.PvpMode)) cellLine += " · " + PvpLabel(cell.PvpMode);
            lines.Add(cellLine);

            float distancePoints = Distance(_playerPoint, _selectedPoint);
            float distanceKm = distancePoints / Mathf.Max(0.001f, _map.Grid.CellPoints) * _map.Grid.CellKm;
            if (distancePoints > 0.35f) lines.Add("До цели: " + distanceKm.ToString("0.0") + " км");

            JObject territory;
            if (_territoryByCell.TryGetValue(cx + ":" + cy, out territory))
            {
                string owner = territory["owner"]?.ToString() ?? string.Empty;
                string ownerLabel = territory["ownerLabel"]?.ToString();
                if (string.IsNullOrEmpty(ownerLabel)) ownerLabel = FactionName(owner);
                lines.Add("Территория: " + ownerLabel + " · контроль "
                          + Mathf.RoundToInt(Float(territory["strength"], 0f) * 100f) + "%"
                          + (territory["frontier"]?.ToObject<bool>() == true ? " · граница" : string.Empty));
            }

            JObject site = SelectedSiteData();
            if (site != null)
            {
                string owner = site["owner"]?.ToString() ?? "neutral";
                string ownerLabel = site["ownerLabel"]?.ToString();
                if (string.IsNullOrEmpty(ownerLabel)) ownerLabel = FactionName(owner);
                string type = SiteTypeLabel(site["type"]?.ToString());
                string control = site["controlStateLabel"]?.ToString() ?? site["controlState"]?.ToString() ?? "стабильно";
                lines.Add(type + " · владелец: " + ownerLabel + " · контроль: " + control);
                JObject liveRegion = site["liveRegion"] as JObject;
                if (liveRegion != null)
                {
                    lines.Add("Снабжение: " + (liveRegion["supply"]?["label"]?.ToString() ?? "нет данных")
                              + " · безопасность: " + (liveRegion["security"]?["label"]?.ToString() ?? "нет данных")
                              + " · влияние: " + (liveRegion["influence"]?["label"]?.ToString() ?? "нет данных"));
                    JObject aftermath = liveRegion["aftermath"] as JObject;
                    if (aftermath != null)
                    {
                        string aftermathTitle = aftermath["title"]?.ToString();
                        string aftermathText = aftermath["text"]?.ToString();
                        if (!string.IsNullOrEmpty(aftermathTitle))
                            lines.Add("Последствие: " + aftermathTitle + (string.IsNullOrEmpty(aftermathText) ? string.Empty : " — " + aftermathText));
                    }
                }
                string work = site["workSummary"]?.ToString();
                if (!string.IsNullOrEmpty(work)) lines.Add("Население и работа: " + work);
                string need = site["productionNeedSummary"]?.ToString();
                if (!string.IsNullOrEmpty(need)) lines.Add("Нужна поддержка: " + need);
            }
            else if (_selectedDynamic != null && _selectedDynamic.Data != null)
            {
                JObject row = _selectedDynamic.Data;
                if (string.Equals(_selectedDynamic.Kind, "party", StringComparison.OrdinalIgnoreCase))
                {
                    string faction = row["faction"]?.ToString() ?? "neutral";
                    lines.Add(PartyKindLabel(row["kind"]?.ToString()) + " · " + FactionName(faction)
                              + " · бойцов " + Mathf.RoundToInt(Float(row["members"], Float(row["strength"], 0f))));
                    string status = row["statusText"]?.ToString();
                    if (!string.IsNullOrEmpty(status)) lines.Add(status);
                    string cargo = row["cargoSummary"]?.ToString();
                    if (!string.IsNullOrEmpty(cargo)) lines.Add("Груз: " + cargo + " · риск " + (row["riskLabel"]?.ToString() ?? "нет"));
                }
                else if (string.Equals(_selectedDynamic.Kind, "zone", StringComparison.OrdinalIgnoreCase))
                {
                    lines.Add("Мировая зона · " + FactionName(_selectedDynamic.Faction)
                              + " · радиус " + _selectedDynamic.Radius.ToString("0.#") + " км");
                }
            }
            else if (_selectedNode != null)
            {
                string note = _selectedNode.Note;
                if (!string.IsNullOrEmpty(note)) lines.Add(note);
                if (_selectedNode.Danger > 0) lines.Add("Опасность поселения: " + _selectedNode.Danger);
            }

            return string.Join("\n", lines);
        }

        private JObject SelectedSiteData()
        {
            if (_selectedDynamic != null && string.Equals(_selectedDynamic.Kind, "site", StringComparison.OrdinalIgnoreCase)
                && _selectedDynamic.Data != null) return _selectedDynamic.Data;
            JArray sites = _wasteland?["sites"] as JArray;
            if (sites == null) return null;
            string nodeId = _selectedNode != null ? _selectedNode.Id : string.Empty;
            string locationId = _selectedNode != null ? _selectedNode.EffectiveLocationId : string.Empty;
            JObject nearest = null;
            float nearestDistance = 15f;
            foreach (JToken token in sites)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string id = row["id"]?.ToString() ?? string.Empty;
                string rowLocation = row["locationId"]?.ToString() ?? string.Empty;
                if ((!string.IsNullOrEmpty(nodeId) && id == nodeId)
                    || (!string.IsNullOrEmpty(locationId) && (id == locationId || rowLocation == locationId))) return row;
                float distance = Distance(_selectedPoint, ReadPoint(row, "x", "y", null));
                if (distance > nearestDistance) continue;
                nearest = row;
                nearestDistance = distance;
            }
            return nearest;
        }

        private string ComposeFactionSummary()
        {
            var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (JObject row in _territoryByCell.Values)
            {
                string owner = row?["owner"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                int count;
                counts.TryGetValue(owner, out count);
                counts[owner] = count + 1;
            }

            if (counts.Count == 0)
            {
                JArray sites = _wasteland?["sites"] as JArray;
                if (sites != null)
                {
                    foreach (JToken token in sites)
                    {
                        string owner = token?["owner"]?.ToString() ?? string.Empty;
                        if (string.IsNullOrEmpty(owner) || string.Equals(owner, "neutral", StringComparison.OrdinalIgnoreCase)) continue;
                        int count;
                        counts.TryGetValue(owner, out count);
                        counts[owner] = count + 1;
                    }
                }
            }
            if (counts.Count == 0) return string.Empty;

            var rows = new List<KeyValuePair<string, int>>(counts);
            rows.Sort((left, right) => right.Value.CompareTo(left.Value));
            var parts = new List<string>();
            float cellArea = _map != null && _map.Grid != null ? _map.Grid.CellKm * _map.Grid.CellKm : 1f;
            bool territoryArea = _territoryByCell.Count > 0;
            for (int i = 0; i < rows.Count && i < 8; i++)
            {
                string value = territoryArea
                    ? Mathf.RoundToInt(rows[i].Value * cellArea).ToString("N0") + " км²"
                    : rows[i].Value + " точек";
                parts.Add(FactionName(rows[i].Key) + " — " + value);
            }
            return (territoryArea ? "Владение фракций: " : "Влияние фракций: ") + string.Join(" · ", parts);
        }

        private string BuildFactionSummary()
        {
            return _factionSummary;
        }

        private string FactionName(string factionId)
        {
            string id = FactionGroupKey(factionId);
            string name = _wasteland?["factions"]?[id]?["name"]?.ToString();
            if (!string.IsNullOrEmpty(name)) return name;
            switch (id)
            {
                case "old_klim": return "Старый Клим";
                case "caravans": return "Вольные караваны";
                case "scrap_union": return "Свалочный союз";
                case "relay_order": return "Техники Ретранслятора";
                case "raiders": return "Рейдеры";
                case "mutants": return "Супермутанты";
                case "wild": return "Дикие твари";
                default: return "Нейтральные";
            }
        }

        private static string TerrainLabel(string texture)
        {
            switch ((texture ?? string.Empty).ToLowerInvariant())
            {
                case "water": case "ocean": case "sea": case "lake": return "вода";
                case "old_road": return "старая дорога";
                case "salt_flat": return "солончак";
                case "dry_lake": return "сухое озеро";
                case "rocky_hills": return "каменистые холмы";
                case "scrap_field": return "поле металлолома";
                case "green_lowland": return "зелёная низина";
                default: return "пустошь";
            }
        }

        private static string PvpLabel(string mode)
        {
            string value = (mode ?? string.Empty).ToLowerInvariant();
            return value == "peaceful" || value == "pve" ? "мирная зона" : (value == "pvp" ? "PvP" : mode);
        }

        public static string MarkerSemanticLabel(string targetKind, string subtype, bool hostile)
        {
            string kind = (targetKind ?? string.Empty).ToLowerInvariant();
            string type = (subtype ?? string.Empty).ToLowerInvariant();
            if (hostile) return "УГРОЗА";
            if (kind == "party")
            {
                if (type == "caravan") return "КАРАВАН";
                if (type == "patrol") return "ПАТРУЛЬ";
                return "ОТРЯД";
            }
            if (kind == "zone") return "СОБЫТИЕ";
            switch (type)
            {
                case "settlement": return "ПОСЕЛЕНИЕ";
                case "outpost": return "АВАНПОСТ";
                case "production": return "ПРОИЗВОДСТВО";
                case "resource": return "РЕСУРС";
                case "pointofinterest": return "ТОЧКА ИНТЕРЕСА";
                default: return "ТОЧКА ПУСТОШИ";
            }
        }

        public static Color MarkerSemanticColor(string targetKind, string subtype, bool hostile,
                                                string controlState)
        {
            string state = (controlState ?? string.Empty).ToLowerInvariant();
            if (hostile || state == "critical") return new Color(0.94f, 0.25f, 0.16f, 1f);
            if (state == "contested" || state == "threatened")
                return new Color(1f, 0.61f, 0.16f, 1f);
            string kind = (targetKind ?? string.Empty).ToLowerInvariant();
            string type = (subtype ?? string.Empty).ToLowerInvariant();
            if (kind == "party")
            {
                if (type == "caravan") return new Color(0.48f, 0.86f, 0.48f, 1f);
                if (type == "patrol") return new Color(0.42f, 0.75f, 0.94f, 1f);
                return new Color(0.78f, 0.72f, 0.56f, 1f);
            }
            if (kind == "zone") return new Color(1f, 0.48f, 0.18f, 1f);
            switch (type)
            {
                case "outpost": return new Color(0.94f, 0.65f, 0.24f, 1f);
                case "production": return new Color(0.86f, 0.48f, 0.20f, 1f);
                case "resource": return new Color(0.31f, 0.82f, 0.70f, 1f);
                case "pointofinterest": return new Color(0.45f, 0.72f, 0.96f, 1f);
                case "settlement": return new Color(0.94f, 0.82f, 0.47f, 1f);
                default: return new Color(0.78f, 0.72f, 0.56f, 1f);
            }
        }

        public static int MarkerPresentationPriority(string targetKind, string subtype,
                                                     bool hostile, string controlState)
        {
            string state = (controlState ?? string.Empty).ToLowerInvariant();
            if (hostile || state == "critical") return 125;
            if (state == "contested" || state == "threatened") return 115;
            string kind = (targetKind ?? string.Empty).ToLowerInvariant();
            string type = (subtype ?? string.Empty).ToLowerInvariant();
            if (kind == "zone") return 105;
            if (kind == "party") return type == "patrol" ? 72 : (type == "caravan" ? 62 : 68);
            if (type == "settlement") return 100;
            if (type == "outpost") return 82;
            if (type == "resource") return 64;
            if (type == "production") return 58;
            if (type == "pointofinterest") return 52;
            return 45;
        }

        private static string SiteTypeLabel(string type)
        {
            switch ((type ?? string.Empty).ToLowerInvariant())
            {
                case "settlement": return "Поселение";
                case "outpost": return "Аванпост";
                case "production": return "Производственная точка";
                case "resource": return "Ресурсная точка";
                case "pointofinterest": return "Точка интереса";
                default: return "Точка пустоши";
            }
        }

        private static string PartyKindLabel(string kind)
        {
            switch ((kind ?? string.Empty).ToLowerInvariant())
            {
                case "caravan": return "Караван";
                case "patrol": return "Патруль";
                case "raider": return "Рейдерский отряд";
                default: return "Отряд";
            }
        }

        private void OnGUI()
        {
            if (!IsActive || !InputEnabled || CanvasDriven) return;
            RoaUiTheme.Apply();

            Rect panel = InformationPanelRect(Screen.width, Screen.height);
            DrawPanelBackdrop(panel);
            GUILayout.BeginArea(panel, GUI.skin.box);
            GUILayout.Label("<b>Глобальная карта</b>", Rich());
            _panelScroll = GUILayout.BeginScrollView(_panelScroll, false, true);
            GUILayout.Label(StatusText);
            GUILayout.Label("Позиция: " + _playerPoint.X.ToString("0.0") + ", " + _playerPoint.Y.ToString("0.0"));
            string targetName = _selectedDynamic != null
                ? _selectedDynamic.Name
                : (_selectedNode != null ? _selectedNode.EffectiveLocationId : "точка пустоши");
            GUILayout.Label("Цель: " + targetName
                            + "  (" + _selectedPoint.X.ToString("0.0") + ", " + _selectedPoint.Y.ToString("0.0") + ")");

            string selectionSummary = BuildSelectionSummary();
            if (!string.IsNullOrEmpty(selectionSummary))
            {
                GUILayout.Space(3f);
                GUILayout.Label(selectionSummary, Wrapped());
            }

            if (_wasteland != null)
            {
                float hour = Float(_wasteland["worldHour"], 0f);
                GUILayout.Label("Мир: час " + hour.ToString("0.0")
                               + " · точки " + ArrayCount(_wasteland["sites"])
                               + " · отряды " + ArrayCount(_wasteland["parties"])
                               + " · территории " + TerritoryCellCount);
                if (!string.IsNullOrEmpty(_factionSummary)) GUILayout.Label(_factionSummary, Wrapped());
            }

            if (_pendingContact != null)
            {
                GUILayout.Space(7f);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>Контакт на маршруте</b>", Rich());
                GUILayout.Label(_pendingContact.Name ?? "Событие пустоши");
                if (!string.IsNullOrEmpty(_pendingContact.Details)) GUILayout.Label(_pendingContact.Details);
                if (IsLocalTravelLeader())
                {
                    GUI.enabled = !_contactDecisionPending;
                    GUILayout.BeginHorizontal();
                    if (GUILayout.Button("Вступить", GUILayout.Height(32f))) ResolveTravelContact(true);
                    if (!_pendingContact.Forced && GUILayout.Button("Обойти", GUILayout.Height(32f))) ResolveTravelContact(false);
                    GUILayout.EndHorizontal();
                    GUI.enabled = true;
                }
                else GUILayout.Label("Решение принимает лидер группы.");
                GUILayout.EndVertical();
            }
            else if (_travelActive)
            {
                float progress = Mathf.Clamp01((Time.realtimeSinceStartup - _travelStartedRealtime) / _travelDuration);
                GUILayout.Label("Путь: " + Mathf.RoundToInt(progress * 100f) + "%");

            }
            else if (!string.IsNullOrEmpty(AttachedPartyId))
            {
                GUILayout.Label("Вы следуете с отрядом " + AttachedPartyId + ". Собственный маршрут недоступен.", Wrapped());
                if (GUILayout.Button("Покинуть отряд")) RequestLeaveAttachedWorldParty();
            }

            GUILayout.Space(4f);
            GUILayout.Label("ЛКМ — маршрут, WASD — обзор, ПКМ — обзор (инв. Y), колесо — масштаб, зажать колесо — угол.");
            GUILayout.EndScrollView();
            GUILayout.EndArea();

            DrawNodeLabels();
        }

        public static Rect InformationPanelRect(int screenWidth, int screenHeight)
        {
            float width = Mathf.Clamp(screenWidth * 0.46f, 270f, 390f);
            float height = Mathf.Clamp(screenHeight - 24f, 240f, 600f);
            return new Rect(screenWidth - width - 12f, 12f, width, height);
        }

        public static bool MapPointCanSelect(Vector2 guiPoint, int screenWidth, int screenHeight)
        {
            return guiPoint.x >= 0f && guiPoint.y >= 0f
                && guiPoint.x <= screenWidth && guiPoint.y <= screenHeight
                && !InformationPanelRect(screenWidth, screenHeight).Contains(guiPoint);
        }

        private static void DrawPanelBackdrop(Rect area)
        {
            Color previous = GUI.color;
            GUI.color = new Color(0.075f, 0.065f, 0.055f, 0.94f);
            GUI.DrawTexture(area, Texture2D.whiteTexture);
            GUI.color = previous;
        }

        private void DrawNodeLabels()
        {
            Camera camera = Camera.main;
            if (camera == null || _map == null) return;
            Rect panel = InformationPanelRect(Screen.width, Screen.height);
            var occupied = new List<Rect>();
            foreach (GlobalMapNode node in _map.Nodes)
            {
                Vector3 screen = camera.WorldToScreenPoint(NodeLabelWorld(node, 0.9f));
                if (screen.z <= 0f) continue;
                Vector2 point = new Vector2(screen.x, Screen.height - screen.y);
                if (!TryResolveNodeLabelRect(point, panel, occupied,
                                             Screen.width, Screen.height, out Rect label)) continue;
                occupied.Add(label);
                GUI.Label(label, NodeTitle(node), Centered());
            }
        }

        /// <summary>
        /// Keeps projected Canvas labels inside the visible map viewport and out
        /// of the route sidebar. Higher-priority activity labels reserve their
        /// rectangles first; nearby settlements are shifted or omitted.
        /// </summary>
        public static bool TryResolveNodeLabelRect(Vector2 point, Rect blocked,
                                                   IReadOnlyList<Rect> occupied,
                                                   int screenWidth, int screenHeight,
                                                   out Rect resolved)
        {
            return TryResolveOverlayLabelRect(point, blocked, occupied, screenWidth,
                                              screenHeight, 140f, 24f, out resolved);
        }

        public static bool TryResolveOverlayLabelRect(Vector2 point, Rect blocked,
                                                      IReadOnlyList<Rect> occupied,
                                                      int screenWidth, int screenHeight,
                                                      float requestedWidth, float requestedHeight,
                                                      out Rect resolved)
        {
            return TryResolveOverlayLabelRect(point, blocked, occupied, screenWidth,
                screenHeight, requestedWidth, requestedHeight, 0f, out resolved);
        }

        /// <summary>
        /// Вертикальная база плашки для данной точки — то же клэмп-правило, что
        /// внутри подбора. Каноничный расчёт «липкого» сдвига слота.
        /// </summary>
        public static float OverlayLabelBaseY(float pointY, float requestedHeight, int screenHeight)
        {
            const float margin = 5f;
            float height = Mathf.Clamp(requestedHeight, 20f, Mathf.Max(20f, screenHeight - margin * 2f));
            return Mathf.Clamp(pointY - height * 0.5f, margin,
                               Mathf.Max(margin, screenHeight - height - margin));
        }

        /// <summary>
        /// Подбор слота с памятью: родное место → слот прошлого кадра
        /// (preferredYOffset относительно базы) → свободный слот со сдвигом.
        /// Без памяти каждый пересчёт мог перекинуть подпись на другой
        /// свободный слот, и названия «летали» при панорамировании.
        /// </summary>
        public static bool TryResolveOverlayLabelRect(Vector2 point, Rect blocked,
                                                      IReadOnlyList<Rect> occupied,
                                                      int screenWidth, int screenHeight,
                                                      float requestedWidth, float requestedHeight,
                                                      float preferredYOffset,
                                                      out Rect resolved)
        {
            const float margin = 5f;
            float width = Mathf.Clamp(requestedWidth, 60f, Mathf.Max(60f, screenWidth - margin * 2f));
            float height = Mathf.Clamp(requestedHeight, 20f, Mathf.Max(20f, screenHeight - margin * 2f));
            if (point.x < 0f || point.y < 0f || point.x > screenWidth || point.y > screenHeight
                || blocked.Contains(point))
            {
                resolved = default;
                return false;
            }

            float rightEdge = screenWidth - margin;
            bool rightSidebar = blocked.width > 0f && blocked.height > 0f
                && blocked.xMin >= screenWidth * 0.5f
                && blocked.height >= screenHeight * 0.25f;
            if (rightSidebar)
                rightEdge = Mathf.Min(rightEdge, blocked.xMin - margin);
            if (rightEdge - margin < width)
            {
                resolved = default;
                return false;
            }

            float x = Mathf.Clamp(point.x - width * 0.5f, margin, rightEdge - width);
            float maxY = Mathf.Max(margin, screenHeight - height - margin);
            float baseY = Mathf.Clamp(point.y - height * 0.5f, margin, maxY);

            // Подпись не должна уходить от своей точки. Если клэмп к краю экрана
            // или сайдбару утащил плашку далеко по горизонтали, подпись честно
            // пропускается, а не паркуется в стороне от маркера.
            if (Mathf.Abs(x + width * 0.5f - point.x) > width * 0.5f + 24f)
            {
                resolved = default;
                return false;
            }

            // Родное место всегда проверяется первым: как только оно свободно,
            // подпись возвращается к своей точке.
            if (OverlayLabelCandidateFree(x, baseY, width, height, blocked, occupied,
                    out resolved)) return true;

            // Слот прошлого кадра, чтобы занятая подпись не прыгала между
            // свободными слотами при каждом изменении набора соседей.
            if (preferredYOffset != 0f
                && OverlayLabelCandidateFree(x, Mathf.Clamp(baseY + preferredYOffset, margin, maxY),
                    width, height, blocked, occupied, out resolved)) return true;

            // Максимум один слот вверх или вниз: дальше подпись читалась бы как
            // принадлежащая соседней точке, поэтому лучше не показать её вовсе.
            for (int attempt = 1; attempt < 3; attempt++)
            {
                float direction = attempt % 2 == 1 ? -1f : 1f;
                float y = Mathf.Clamp(baseY + direction * (height + 3f), margin, maxY);
                if (OverlayLabelCandidateFree(x, y, width, height, blocked, occupied,
                        out resolved)) return true;
            }
            resolved = default;
            return false;
        }

        private static bool OverlayLabelCandidateFree(float x, float y, float width, float height,
                                                      Rect blocked, IReadOnlyList<Rect> occupied,
                                                      out Rect resolved)
        {
            var candidate = new Rect(x, y, width, height);
            resolved = candidate;
            if (candidate.Overlaps(blocked)) return false;
            if (occupied != null)
            {
                for (int i = 0; i < occupied.Count; i++)
                    if (candidate.Overlaps(occupied[i])) return false;
            }
            return true;
        }

        private static GUIStyle Rich()
        {
            var style = new GUIStyle(GUI.skin.label) { richText = true };
            return style;
        }

        private static GUIStyle Wrapped()
        {
            return new GUIStyle(GUI.skin.label) { wordWrap = true };
        }

        private static GUIStyle Centered()
        {
            var style = new GUIStyle(GUI.skin.label)
            {
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Color.white }
            };
            return style;
        }

        private static int ArrayCount(JToken token)
        {
            JArray array = token as JArray;
            return array != null ? array.Count : 0;
        }
    }
}
