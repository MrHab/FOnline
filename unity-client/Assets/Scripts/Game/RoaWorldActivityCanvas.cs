using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Компактный HUD сервер-авторитетной активности текущей локации.
    /// Клиент только показывает worldState.activity и предлагает эвакуацию через
    /// существующий worldTaskAction; цели, таймер и результат считает сервер.
    /// </summary>
    public sealed partial class RoaWorldActivityCanvas : MonoBehaviour
    {
        public enum ObjectiveVisualState
        {
            Locked,
            Active,
            Complete,
            Bonus,
            Mastered
        }

        public enum ActivityHudDensity
        {
            Glance,
            Context,
            Detailed
        }

        public enum ActivityFlowStage
        {
            Arrival,
            Objective,
            Extraction,
            Reward
        }

        public readonly struct ObjectiveView
        {
            public readonly string Id;
            public readonly string Label;
            public readonly string Progress;
            public readonly ObjectiveVisualState State;
            public readonly bool IsCurrent;

            public ObjectiveView(string id, string label, string progress,
                                 ObjectiveVisualState state, bool isCurrent)
            {
                Id = id ?? string.Empty;
                Label = label ?? string.Empty;
                Progress = progress ?? string.Empty;
                State = state;
                IsCurrent = isCurrent;
            }
        }

        private sealed class ObjectiveSlot
        {
            public GameObject Root;
            public Image Background;
            public Image Stripe;
            public Text Label;
            public Text Progress;
            public ObjectiveView View;
        }

        private sealed class FlowSlot
        {
            public Image Background;
            public Text Label;
        }

        public RoaSocketClient Socket;
        public RoaGameBootstrap Bootstrap;

        private static readonly Color PanelBg = new Color(0.035f, 0.039f, 0.031f, 0.95f);
        private static readonly Color Border = new Color(0.65f, 0.58f, 0.32f, 0.55f);
        private static readonly Color Ink = new Color(0.86f, 0.84f, 0.75f, 1f);
        private static readonly Color Accent = new Color(0.93f, 0.78f, 0.34f, 1f);
        private static readonly Color Muted = new Color(0.57f, 0.63f, 0.51f, 1f);
        private static readonly Color Safe = new Color(0.42f, 0.72f, 0.39f, 1f);
        private static readonly Color Danger = new Color(0.92f, 0.31f, 0.18f, 1f);
        private static readonly Color ButtonBg = new Color(0.18f, 0.25f, 0.12f, 1f);
        private const float DesktopPingHoldSeconds = 0.25f;
        private const float MobilePingHoldSeconds = 0.40f;
        private const float MobilePingMoveTolerance = 18f;
        private const float PingRadialDeadZone = 28f;
        private const float PingMaxDistance = 32f;

        private GameObject _root;
        private Text _title;
        private Text _phase;
        private Text _timer;
        private Text _objectiveHeader;
        private readonly List<ObjectiveSlot> _objectiveSlots = new List<ObjectiveSlot>(3);
        private readonly List<ObjectiveView> _objectiveViews = new List<ObjectiveView>(3);
        private readonly List<FlowSlot> _flowSlots = new List<FlowSlot>(4);
        private readonly List<FlowSlot> _resultFlowSlots = new List<FlowSlot>(4);
        private RectTransform _objectiveRows;
        private bool _focusedHud;
        private bool _focusedHudInitialized;
        private ActivityHudDensity _hudDensity = ActivityHudDensity.Glance;
        private bool _detailsExpanded;
        private bool _activityScaleInitialized;
        private bool _activityScaleMobile;
        private Button _detailsToggle;
        private Text _detailsToggleLabel;
        private Image _rootBackground;
        private Outline _rootOutline;
        private Text _threatText;
        private Text _participants;
        private Text _actionLabel;
        private Text _helpActionLabel;
        private Text _message;
        private Image _threatFill;
        private Button _action;
        private Button _helpAction;
        private Button _reviveAction;
        private Text _reviveActionLabel;
        private Button _pingToggle;
        private Text _pingToggleLabel;
        private GameObject _pingMenuRoot;
        private Text _pingMenuHint;
        private Button _pingMove;
        private Button _pingDanger;
        private Button _pingLoot;
        private bool _pingMenuOpen;
        private bool _pingGestureMenu;
        private bool _desktopPingHeld;
        private float _desktopPingStartedAt;
        private int _mobilePingFinger = -1;
        private float _mobilePingStartedAt;
        private Vector2 _pingGestureOrigin;
        private Vector3 _pingPlacementWorld;
        private bool _pingPlacementReady;
        private string _pingRadialSelection = string.Empty;
        private float _messageUntil;
        private string _reviveTargetId = string.Empty;
        private bool _selfDowned;
        private long _selfDownedUntil;
        private JObject _activity;
        private bool _subscribed;
        private bool _pending;
        private float _refreshAt;
        private GameObject _markerRoot;
        private string _markerRevision = string.Empty;
        private string _actionPointId = string.Empty;
        private GameObject _resultRoot;
        private Text _resultTitle;
        private Text _resultName;
        private Text _resultGrade;
        private Text _resultReward;
        private Button _resultContinue;
        private Text _resultContinueLabel;
        private bool _continuePending;
        private string _resultKey = string.Empty;
        private float _resultUntil;
        private bool _resultPending;
        private string _introActivityId = string.Empty;
        private bool _introPending;
        private float _introUntil;
        private GameObject _introRoot;
        private Text _introKicker;
        private Text _introTitle;
        private Text _introInstruction;
        private string _pendingDirectorMessage = string.Empty;
        private bool _pendingDirectorDanger;
        private int _missionTimeWarningLevel;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }
        public bool HasActiveActivity { get { return _activity != null; } }
        public bool IsActivityRunning
        {
            get
            {
                string status = _activity?["status"]?.ToString() ?? string.Empty;
                return status == "active" || status == "extracting";
            }
        }
        public string CurrentActivityTaskId { get { return _activity?["taskId"]?.ToString() ?? string.Empty; } }
        public string LastResultId { get { return _resultKey; } }
        public string LastResultTaskId { get; private set; } = string.Empty;
        public bool LastResultSucceeded { get; private set; }
        public bool LastResultRewardClaimed { get; private set; }
        public int ActiveObjectiveRowCount { get; private set; }
        public int ObjectiveRowPoolSize { get { return _objectiveSlots.Count; } }
        public bool FocusedHud { get { return _focusedHud; } }
        public ActivityHudDensity HudDensity { get { return _hudDensity; } }
        public ActivityFlowStage FlowStage { get; private set; } = ActivityFlowStage.Arrival;

        public static bool UseFocusedActivityHud(bool combatActive, bool mobile)
        {
            return combatActive || mobile;
        }

        public static Vector2 ActivityHudSize(bool focused)
        {
            return ActivityHudSize(focused ? ActivityHudDensity.Context : ActivityHudDensity.Detailed);
        }

        public static Vector2 ActivityHudSize(ActivityHudDensity density)
        {
            switch (density)
            {
                case ActivityHudDensity.Detailed:
                    return new Vector2(330f, 210f);
                case ActivityHudDensity.Context:
                    return new Vector2(330f, 144f);
                default:
                    return new Vector2(330f, 100f);
            }
        }

        public static ActivityFlowStage ResolveActivityFlowStage(JObject activity)
        {
            if (activity == null) return ActivityFlowStage.Arrival;
            string status = activity["status"]?.ToString() ?? string.Empty;
            string phase = activity["phase"]?.ToString() ?? string.Empty;
            bool extractionOpen = activity["extractionOpen"]?.ToObject<bool>() == true;
            if (status == "completed") return ActivityFlowStage.Reward;
            if (status == "failed" || status == "expired" || extractionOpen || phase == "extraction")
                return ActivityFlowStage.Extraction;
            return ActivityFlowStage.Objective;
        }

        public static Vector2 ActivityHudPosition(bool mobile, bool reserveIdentity)
        {
            float x = mobile ? 76f : 12f;
            float y = reserveIdentity ? (mobile ? -72f : -96f) : -12f;
            return new Vector2(x, y);
        }

        public static ActivityHudDensity ResolveActivityHudDensity(bool combatActive,
            bool mobile, bool detailsRequested, bool editingHud, bool contextAction,
            bool importantMessage)
        {
            if (detailsRequested || editingHud) return ActivityHudDensity.Detailed;
            if (contextAction || importantMessage) return ActivityHudDensity.Context;
            // Combat and mobile both benefit from the smallest readable state. The
            // current objective and threat remain visible; secondary controls do not.
            return ActivityHudDensity.Glance;
        }

        public static int FocusedObjectiveIndex(IReadOnlyList<ObjectiveView> views)
        {
            if (views == null || views.Count == 0) return -1;
            for (int index = 0; index < views.Count; index += 1)
                if (views[index].IsCurrent) return index;
            for (int index = 0; index < views.Count; index += 1)
                if (views[index].State == ObjectiveVisualState.Active) return index;
            return views.Count - 1;
        }

        public void Configure(RoaSocketClient socket, RoaGameBootstrap bootstrap)
        {
            Unsubscribe();
            Socket = socket;
            Bootstrap = bootstrap;
            if (Bootstrap?.MobileControls != null) Bootstrap.MobileControls.PingRequested = TogglePingMenu;
            Subscribe();
            ApplyWorldState(Socket?.Session?.WorldState);
            HandleAuthoritativeSelf(Socket?.Session?.Self);
        }

        private void OnEnable()
        {
            Subscribe();
        }

        private void OnDisable()
        {
            Unsubscribe();
        }

        private void OnDestroy()
        {
            if (Bootstrap?.MobileControls != null)
            {
                Bootstrap.MobileControls.PingAvailable = false;
                Bootstrap.MobileControls.PingRequested = null;
            }
            ClearWorldMarkers();
        }

        private void Subscribe()
        {
            if (_subscribed || Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnWorldState += ApplyWorldState;
            Socket.OnAuthoritativeSelf += HandleAuthoritativeSelf;
            Socket.OnDisconnected += HandleDisconnected;
            _subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!_subscribed || Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnWorldState -= ApplyWorldState;
            Socket.OnAuthoritativeSelf -= HandleAuthoritativeSelf;
            Socket.OnDisconnected -= HandleDisconnected;
            _subscribed = false;
        }

        private void HandleJoined(JoinAck ack)
        {
            ApplyWorldState(ack?.WorldState);
            HandleAuthoritativeSelf(ack?.Self);
        }

        private void HandleDisconnected(string _)
        {
            _activity = null;
            _pending = false;
            CancelPingInput(true);
            if (_root != null) _root.SetActive(false);
            if (_introRoot != null) _introRoot.SetActive(false);
            if (_resultRoot != null) _resultRoot.SetActive(false);
            _resultPending = false;
            _introPending = false;
            _pendingDirectorMessage = string.Empty;
            _missionTimeWarningLevel = 0;
            ResetActivityFeedback();
            ClearWorldMarkers();
            HideActivityNavigation();
        }

        private void HandleAuthoritativeSelf(JObject self)
        {
            _selfDowned = self?["downed"]?.ToObject<bool>() == true;
            _selfDownedUntil = _selfDowned ? self?["downedUntil"]?.ToObject<long>() ?? 0L : 0L;
            JObject result = self?["lastWorldActivityResult"] as JObject;
            string key = result?["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(key) || string.Equals(key, _resultKey, StringComparison.Ordinal)) return;
            _resultKey = key;
            EnsureBuilt();

            string status = result["status"]?.ToString() ?? "resolved";
            string grade = result["grade"]?.ToString() ?? "failed";
            bool success = status == "completed";
            bool claimed = result["rewardClaimed"]?.ToObject<bool>() == true;
            LastResultTaskId = result["taskId"]?.ToString() ?? string.Empty;
            LastResultSucceeded = success;
            LastResultRewardClaimed = claimed;
            _pendingResultCue = RoaActivityFeedback.ClassifyResult(result);
            _resultTitle.text = success
                ? claimed ? "АКТИВНОСТЬ ЗАВЕРШЕНА" : "ЦЕЛЬ ВЫПОЛНЕНА"
                : status == "resolved" ? "УЧАСТИЕ НЕ ЗАСЧИТАНО" : "АКТИВНОСТЬ ПРОВАЛЕНА";
            _resultTitle.color = success ? Safe : Danger;
            _resultName.text = result["title"]?.ToString() ?? "Активность пустоши";
            _resultGrade.text = !success ? "РЕЗУЛЬТАТ: БЕЗ НАГРАДЫ"
                : grade == "mastered" ? "ОЦЕНКА: МАКСИМУМ"
                : grade == "bonus" ? "ОЦЕНКА: БОНУС"
                : "ОЦЕНКА: ВЫПОЛНЕНО";

            _resultReward.text = RewardReceipt(result, self);
            RefreshFlowStrip(_resultFlowSlots, ActivityFlowStage.Reward, !success, claimed);
            if (_resultContinue != null)
            {
                _resultContinue.gameObject.SetActive(success);
                _resultContinue.interactable = success;
                _resultContinueLabel.text = "ПРОДОЛЖИТЬ С ОТРЯДОМ";
            }
            _continuePending = false;

            if (result["reason"]?.ToString() == "player_died")
            {
                _resultPending = false;
                _pendingResultCue = RoaActivityFeedbackCue.None;
                _resultUntil = 0f;
                _resultRoot.SetActive(false);
                return;
            }
            _resultPending = true;
            _resultUntil = 0f;
            _resultRoot.SetActive(false);
        }
        private void ApplyWorldState(JObject state)
        {
            JObject next = state?["activity"] as JObject;
            RoaActivityFeedbackCue feedback = RoaActivityFeedback.ClassifyActivity(_activity, next);
            string directorMessage = MissionDirectorTransitionMessage(_activity, next);
            if (!string.IsNullOrEmpty(directorMessage))
            {
                _pendingDirectorMessage = directorMessage;
                string warning = next?["director"]?["warning"]?.ToString() ?? string.Empty;
                _pendingDirectorDanger = warning == "stalled" || warning == "final_seconds"
                    || directorMessage.StartsWith("ВОЛНА", StringComparison.Ordinal)
                    || directorMessage.StartsWith("ВЫБРАН ШТУРМ", StringComparison.Ordinal);
            }
            string previousId = _activity?["id"]?.ToString() ?? string.Empty;
            string nextId = next?["id"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(nextId) && !string.Equals(previousId, nextId, StringComparison.Ordinal))
            {
                _introActivityId = nextId;
                _introPending = true;
                _introUntil = 0f;
                _pendingDirectorMessage = string.Empty;
                _missionTimeWarningLevel = 0;
            }
            string previousRevision = _activity?["revision"]?.ToString() ?? string.Empty;
            string nextRevision = next?["revision"]?.ToString() ?? string.Empty;
            bool changed = !string.Equals(previousRevision, nextRevision, StringComparison.Ordinal)
                || !string.Equals(_activity?["status"]?.ToString(), next?["status"]?.ToString(), StringComparison.Ordinal);
            _activity = next;
            if (_resultContinue != null && _resultContinue.gameObject.activeSelf && next?["rally"] is JObject rally)
            {
                int votes = Mathf.Max(0, rally["voteCount"]?.ToObject<int>() ?? 0);
                bool ready = rally["ready"]?.ToObject<bool>() == true;
                _resultContinueLabel.text = ready ? "ОТРЯД ГОТОВ · ЦЕЛЬ ОТМЕЧЕНА"
                    : votes > 0 ? "ПРОДОЛЖИТЬ · СОГЛАСНЫ: " + votes
                    : "ПРОДОЛЖИТЬ С ОТРЯДОМ";
            }
            if (_activity == null)
            {
                _introPending = false;
                _pendingActivityCue = RoaActivityFeedbackCue.None;
                _pendingDirectorMessage = string.Empty;
                _missionTimeWarningLevel = 0;
            }
            else QueueActivityFeedback(feedback);
            if (changed)
            {
                _pending = false;
                CancelPingInput(true);
                _messageUntil = 0f;
                if (_message != null)
                {
                    _message.text = string.Empty;
                    _message.gameObject.SetActive(false);
                }
                _markerRevision = string.Empty;
            }
            _refreshAt = 0f;
            if (_activity == null && _root != null) _root.SetActive(false);
        }

        private void Update()
        {
            bool showResult = false;
            if (_resultRoot != null)
            {
                bool screenReady = Bootstrap == null || (Bootstrap.InGame && !Bootstrap.FrontendVisible
                    && !RoaGameBootstrap.BlocksWorldHud);
                if (_resultPending && screenReady)
                {
                    _resultPending = false;
                    _resultStartedAt = Time.unscaledTime;
                    float resultLifetime = Bootstrap != null && Bootstrap.OnGlobalMap
                        ? RoaActivityFeedback.GlobalMapResultSeconds
                        : RoaActivityFeedback.ResultSeconds;
                    _resultUntil = Time.unscaledTime + resultLifetime;
                    EmitActivityFeedback(_pendingResultCue);
                    _pendingResultCue = RoaActivityFeedbackCue.None;
                }
                showResult = Time.unscaledTime < _resultUntil
                    && (Bootstrap == null || (!Bootstrap.FrontendVisible && !RoaGameBootstrap.BlocksWorldHud));
                if (_resultRoot.activeSelf != showResult) _resultRoot.SetActive(showResult);
                UpdateResultCardAnimation(showResult);
            }
            bool hiddenByScreen = Bootstrap != null && (Bootstrap.FrontendVisible || Bootstrap.OnGlobalMap
                || RoaGameBootstrap.BlocksWorldHud);
            if (_activity == null || hiddenByScreen)
            {
                CancelPingInput(true);
                if (Bootstrap?.MobileControls != null) Bootstrap.MobileControls.PingAvailable = false;
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                if (_introRoot != null && _introRoot.activeSelf) _introRoot.SetActive(false);
                if (_markerRoot != null) _markerRoot.SetActive(false);
                HideActivityNavigation();
                return;
            }
            EnsureBuilt();
            if (_introPending && _introActivityId == (_activity?["id"]?.ToString() ?? string.Empty))
            {
                _introPending = false;
                _introStartedAt = Time.unscaledTime;
                _introUntil = Time.unscaledTime + RoaActivityFeedback.IntroSeconds;
            }
            FlushActivityFeedback();
            bool introActive = _introActivityId == (_activity?["id"]?.ToString() ?? string.Empty)
                && Time.unscaledTime < _introUntil;
            _root.SetActive(!introActive);
            _introRoot.SetActive(introActive);
            UpdateIntroCardAnimation(introActive);
            if (!introActive && !string.IsNullOrEmpty(_pendingDirectorMessage))
            {
                ShowMessage(_pendingDirectorMessage, _pendingDirectorDanger ? Danger : Accent, 5f);
                _pendingDirectorMessage = string.Empty;
                _pendingDirectorDanger = false;
            }
            UpdateActivityPulseVisuals();
            if (introActive) RefreshIntro();
            UpdatePingInput(!introActive);
            RebuildWorldMarkers();
            if (_markerRoot != null) _markerRoot.SetActive(true);
            RefreshActivityNavigation();
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.2f;
            Refresh();
        }

        private void Refresh()
        {
            string status = _activity?["status"]?.ToString() ?? "active";
            string kind = _activity?["kind"]?.ToString() ?? string.Empty;
            string phase = _activity?["phase"]?.ToString() ?? "scavenging";
            bool mobileHud = Bootstrap?.MobileControls?.ControlsEnabled == true;
            if (!_activityScaleInitialized || _activityScaleMobile != mobileHud)
            {
                _activityScaleInitialized = true;
                _activityScaleMobile = mobileHud;
                RoaUiScale.Apply(_activityCanvas != null
                    ? _activityCanvas.GetComponent<CanvasScaler>() : null, mobileHud);
            }
            RectTransform hudRect = _root != null ? _root.transform as RectTransform : null;
            if (hudRect != null)
                hudRect.anchoredPosition = ActivityHudPosition(mobileHud,
                    Bootstrap?.HudCanvas?.IdentityVisible == true);
            _title.text = (_activity?["title"]?.ToString() ?? "Вылазка за ресурсами").ToUpperInvariant();
            _phase.text = PhaseLabel(status, phase, kind);
            string encounterStatus = EncounterStatusText(_activity);
            if (!string.IsNullOrEmpty(encounterStatus)) _phase.text += " · " + encounterStatus;
            FlowStage = ResolveActivityFlowStage(_activity);
            RefreshFlowStrip(_flowSlots, FlowStage, status == "failed" || status == "expired");

            long endsAt = _activity?["endsAt"]?.ToObject<long>() ?? 0L;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            float seconds = Mathf.Max(0f, (endsAt - now) / 1000f);
            _timer.text = status == "completed" ? "ГОТОВО" : Countdown(seconds);
            int warningLevel = MissionTimeWarningLevel(seconds);
            bool timerRunning = status == "active" || status == "extracting";
            if (timerRunning && warningLevel > _missionTimeWarningLevel)
            {
                _missionTimeWarningLevel = warningLevel;
                string warning = MissionTimeWarningMessage(warningLevel);
                if (!string.IsNullOrEmpty(warning)) ShowMessage(warning, Danger, 4.5f);
            }

            float threat = Mathf.Clamp(_activity?["threat"]?.ToObject<float>() ?? 0f, 0f, 100f);
            _threatFill.fillAmount = threat / 100f;
            _threatFill.color = Color.Lerp(Safe, Danger, threat / 100f);
            string threatPrefix = kind == "outpost_defense" ? "НАТИСК "
                : kind == "distress_signal" ? "ЗАСАДА "
                : kind == "assault_diversion" ? "ТРЕВОГА "
                : "УГРОЗА ";
            _threatText.text = threatPrefix
                + Mathf.RoundToInt(threat) + "%";
            _threatText.color = threat >= 50f ? Danger : Muted;

            int count = Mathf.Max(0, _activity?["squad"]?["memberCount"]?.ToObject<int>()
                ?? _activity?["participantCount"]?.ToObject<int>() ?? 0);
            int recommended = Mathf.Max(1, _activity?["squad"]?["recommendedSize"]?.ToObject<int>() ?? 8);
            int downedCount = 0;
            if (_activity?["squad"]?["members"] is JArray squadMembers)
                downedCount = squadMembers.Count(member => member?["downed"]?.ToObject<bool>() == true);
            _participants.text = "ОТРЯД " + count + "/" + recommended
                + (downedCount > 0 ? " · РАНЕНЫ: " + downedCount : string.Empty);

            bool extractionOpen = _activity?["extractionOpen"]?.ToObject<bool>() == true;
            bool defense = kind == "outpost_defense";
            bool localCompletion = defense || kind == "distress_signal";
            Vector3 extractionTarget = Vector3.zero;
            float extractionReach = 0f;
            bool extractionTargetKnown = extractionOpen && !localCompletion
                && TryActivityExtractionTarget(out extractionTarget, out extractionReach);
            float extractionDistance = extractionTargetKnown && Bootstrap?.PlayerView != null
                ? Vector3.ProjectOnPlane(extractionTarget - Bootstrap.PlayerView.transform.position, Vector3.up).magnitude
                : 0f;
            bool extractionInReach = localCompletion || !extractionTargetKnown
                || extractionDistance <= extractionReach + 0.35f;
            float nearestDistance = float.MaxValue;
            bool usesPoint = kind == "recon_expedition" || kind == "distress_signal"
                || kind == "assault_diversion";
            JObject nearestPoint = usesPoint ? NearestPendingPoint(out nearestDistance) : null;
            bool pointInReach = nearestPoint != null && nearestDistance <= 3f;
            _actionPointId = pointInReach ? nearestPoint?["id"]?.ToString() ?? string.Empty : string.Empty;
            bool running = status == "active" || status == "extracting";
            PublicPlayer wounded = null;
            float woundedDistance = float.PositiveInfinity;
            bool canRevive = !_selfDowned && running && Bootstrap?.PlayerView != null
                && Bootstrap.RemotePlayers != null
                && Bootstrap.RemotePlayers.TryGetNearestDowned(Bootstrap.PlayerView.transform.position,
                    3.5f, out wounded, out woundedDistance);
            _reviveTargetId = canRevive ? wounded?.Id ?? string.Empty : string.Empty;
            if (_reviveAction != null)
            {
                _reviveAction.interactable = canRevive && !_pending;
                int woundedSeconds = wounded == null || wounded.DownedUntil <= 0L ? 0
                    : Mathf.Max(0, Mathf.CeilToInt((wounded.DownedUntil - now) / 1000f));
                _reviveActionLabel.text = _pending ? "ПОДНИМАЕМ…"
                    : "ПОДНЯТЬ " + (wounded?.Name ?? "СОЮЗНИКА").ToUpperInvariant()
                    + (woundedSeconds > 0 ? " · " + woundedSeconds + " С" : string.Empty);
            }
            foreach (Button pingButton in new[] { _pingMove, _pingDanger, _pingLoot })
            {
                if (pingButton == null) continue;
                pingButton.interactable = !_pending;
            }
            bool canPing = running && !_selfDowned && !canRevive;
            if (Bootstrap?.MobileControls != null)
            {
                Bootstrap.MobileControls.PingAvailable = canPing;
                Bootstrap.MobileControls.PingRequested = TogglePingMenu;
            }
            if (!canPing) _pingMenuOpen = false;
            if (_pingToggle != null)
            {
                _pingToggle.interactable = !_pending;
                _pingToggleLabel.text = _pingMenuOpen ? "ЗАКРЫТЬ" : "МЕТКА Q";
            }
            if (_pingMenuRoot != null) _pingMenuRoot.SetActive(canPing && _pingMenuOpen);
            JObject helpSignal = _activity?["helpSignal"] as JObject;
            long helpExpiresAt = helpSignal?["expiresAt"]?.ToObject<long>() ?? 0L;
            bool helpActive = helpSignal != null && (helpExpiresAt <= 0L || helpExpiresAt > now);
            int responders = Mathf.Max(0, helpSignal?["responderCount"]?.ToObject<int>() ?? 0);
            if (_helpAction != null)
            {
                _helpAction.interactable = !_pending && !helpActive;
                _helpActionLabel.text = helpActive ? (responders > 0 ? "SOS · " + responders : "SOS ✓") : "SOS";
            }
            bool showAction = running && (pointInReach || (extractionOpen && extractionInReach));
            _action.interactable = !_pending;
            if (_pending) _actionLabel.text = "ОБРАБОТКА…";
            else if (pointInReach) _actionLabel.text = kind == "distress_signal"
                ? "АКТИВИРОВАТЬ МАЯК"
                : kind == "assault_diversion" && _actionPointId == "approach_assault" ? "НАЧАТЬ ШТУРМ"
                : kind == "assault_diversion" && _actionPointId == "approach_diversion" ? "ВЫБРАТЬ ДИВЕРСИЮ"
                : kind == "assault_diversion" ? "ЗАЛОЖИТЬ ЗАРЯД"
                : "СОБРАТЬ РАЗВЕДДАННЫЕ";
            else if (extractionOpen) _actionLabel.text = defense
                ? "ЗАВЕРШИТЬ ОБОРОНУ"
                : kind == "distress_signal" ? "ЗАВЕРШИТЬ СПАСЕНИЕ" : "ЭВАКУИРОВАТЬСЯ";
            else _actionLabel.text = string.Empty;
            bool persistentMessage = false;
            if (_selfDowned)
            {
                int secondsLeft = _selfDownedUntil <= 0L ? 0
                    : Mathf.Max(0, Mathf.CeilToInt((_selfDownedUntil - now) / 1000f));
                _message.text = "ВЫ РАНЕНЫ · СОЮЗНИК МОЖЕТ ПОДНЯТЬ ВАС"
                    + (secondsLeft > 0 ? " · " + secondsLeft + " С" : string.Empty);
                _message.color = Danger;
                persistentMessage = true;
            }
            else if (status == "completed")
            {
                string grade = _activity?["result"]?["grade"]?.ToString() ?? "completed";
                _message.text = grade == "mastered" ? "МАКСИМУМ ВЫПОЛНЕН · Проверяем выплату сервера…"
                    : grade == "bonus" ? "БОНУС ВЫПОЛНЕН · Проверяем выплату сервера…"
                    : "ЦЕЛЬ ВЫПОЛНЕНА · Проверяем выплату сервера…";
                _message.color = Safe;
                persistentMessage = true;
            }
            else if (status == "failed" || status == "expired")
            {
                _message.text = "ПРОВАЛ · Дойдите до края локации.";
                _message.color = Danger;
                persistentMessage = true;
            }
            else if (!_pending && Time.unscaledTime >= _messageUntil)
            {
                _message.text = string.Empty;
            }
            bool messageVisible = persistentMessage || _pending || Time.unscaledTime < _messageUntil;
            _message.gameObject.SetActive(messageVisible);

            bool combatActive = Bootstrap?.Combat?.CombatPresentationActive == true;
            bool detailsHeld = !mobileHud && (Input.GetKey(KeyCode.LeftAlt)
                || Input.GetKey(KeyCode.RightAlt));
            bool contextAction = canRevive || (showAction && !_selfDowned);
            ActivityHudDensity density = ResolveActivityHudDensity(combatActive, mobileHud,
                _detailsExpanded || detailsHeld, RoaHudLayout.Editing, contextAction,
                messageVisible);
            ApplyHudDensityLayout(density);
            RefreshObjectiveRows(density != ActivityHudDensity.Detailed);

            bool detailed = density == ActivityHudDensity.Detailed;
            bool contextual = density == ActivityHudDensity.Context;
            _reviveAction.gameObject.SetActive(canRevive && (contextual || detailed));
            _action.gameObject.SetActive(showAction && !canRevive && !_selfDowned
                && (contextual || detailed));
            _helpAction.gameObject.SetActive(detailed && running && !canRevive && !_selfDowned);
            _pingToggle.gameObject.SetActive(detailed && canPing && !mobileHud);
            if (helpActive && !detailed)
                _participants.text += responders > 0 ? " · SOS " + responders : " · SOS ✓";
        }

        private void RefreshIntro()
        {
            if (_introRoot == null || _activity == null) return;
            string kind = _activity["kind"]?.ToString() ?? string.Empty;
            _introKicker.text = kind == "distress_signal" ? "ПЕРЕХВАЧЕН СИГНАЛ"
                : kind == "outpost_defense" ? "АВАНПОСТ ПОД УДАРОМ"
                : kind == "assault_diversion" ? "БОЕВАЯ ОПЕРАЦИЯ"
                : "НОВАЯ ВЫЛАЗКА";
            _introKicker.color = kind == "distress_signal" || kind == "outpost_defense" ? Danger : Accent;
            _introTitle.text = (_activity["title"]?.ToString() ?? "Активность пустоши").ToUpperInvariant();
            _introInstruction.text = StartInstruction(kind);
        }

        private JObject NearestPendingPoint(out float distance)
        {
            distance = float.MaxValue;
            if (Bootstrap?.PlayerView == null || !(_activity?["interactionPoints"] is JArray points)) return null;
            RoaCoords.ToServer(Bootstrap.PlayerView.transform.position, out float playerX, out float playerZ);
            JObject nearest = null;
            foreach (JToken token in points)
            {
                JObject point = token as JObject;
                if (point == null || point["status"]?.ToString() != "pending") continue;
                float pointX = point["x"]?.ToObject<float>() ?? 0f;
                float pointZ = point["z"]?.ToObject<float>() ?? 0f;
                float candidate = Mathf.Sqrt((playerX - pointX) * (playerX - pointX) + (playerZ - pointZ) * (playerZ - pointZ));
                if (candidate >= distance) continue;
                distance = candidate;
                nearest = point;
            }
            return nearest;
        }

        private void PerformPrimaryAction()
        {
            if (!string.IsNullOrEmpty(_actionPointId)) Interact(_actionPointId);
            else Extract();
        }

        private void RequestHelp()
        {
            if (_pending || Socket == null || _activity == null) return;
            _pending = true;
            ShowMessage("Передаём координаты вылазки другим игрокам…", Accent, 12f);
            Socket.EmitWithAck("worldActivityHelpSignal", new Dictionary<string, object>(), ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ShowMessage(ack?["error"]?.ToString() ?? "Сигнал помощи не передан.", Danger);
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack?["activity"] is JObject activity) _activity = activity;
                ShowMessage("Сигнал передан. Другие игроки могут присоединиться.", Safe);
                _refreshAt = 0f;
            });
        }

        private void TogglePingMenu()
        {
            if (_pending || _selfDowned) return;
            if (_pingMenuOpen)
            {
                CancelPingInput(true);
                return;
            }
            Vector2 screenPoint = new Vector2(Screen.width * 0.5f, Screen.height * 0.5f);
            if (!TryResolvePingWorldPosition(screenPoint, out Vector3 worldPoint)) return;
            OpenPingMenu(screenPoint, worldPoint, false,
                Bootstrap?.MobileControls?.ControlsEnabled == true);
            _refreshAt = 0f;
        }

        private void UpdatePingInput(bool visible)
        {
            string status = _activity?["status"]?.ToString() ?? string.Empty;
            bool running = status == "active" || status == "extracting";
            bool reviveVisible = _reviveAction != null && _reviveAction.gameObject.activeSelf;
            if (!visible || !running || _pending || _selfDowned || reviveVisible)
            {
                CancelPingInput(true);
                return;
            }

            bool mobile = Bootstrap?.MobileControls?.ControlsEnabled == true;
            if (mobile) UpdateMobilePingInput();
            else UpdateDesktopPingInput();
        }

        private void UpdateDesktopPingInput()
        {
            if (Input.GetKeyDown(KeyCode.Q))
            {
                if (_pingMenuOpen) CancelPingInput(true);
                _desktopPingHeld = true;
                _desktopPingStartedAt = Time.unscaledTime;
                _pingGestureOrigin = Input.mousePosition;
                _pingPlacementReady = TryResolvePingWorldPosition(_pingGestureOrigin, out _pingPlacementWorld);
            }
            if (!_desktopPingHeld) return;

            if (!_pingMenuOpen && Input.GetKey(KeyCode.Q)
                && Time.unscaledTime - _desktopPingStartedAt >= DesktopPingHoldSeconds
                && _pingPlacementReady)
            {
                OpenPingMenu(_pingGestureOrigin, _pingPlacementWorld, true, false);
            }
            if (_pingMenuOpen && _pingGestureMenu)
            {
                _pingRadialSelection = ResolvePingRadialType(
                    (Vector2)Input.mousePosition - _pingGestureOrigin, false);
                RefreshPingRadialHighlight();
            }
            if (!Input.GetKeyUp(KeyCode.Q)) return;

            Vector3 placement = _pingPlacementWorld;
            bool placementReady = _pingPlacementReady;
            bool radial = _pingMenuOpen && _pingGestureMenu;
            string selected = radial ? _pingRadialSelection : "move";
            CancelPingInput(true);
            if (placementReady && !string.IsNullOrEmpty(selected)) SendPingAt(selected, placement);
        }

        private void UpdateMobilePingInput()
        {
            Touch tracked = default;
            bool found = false;
            if (_mobilePingFinger >= 0)
            {
                for (int index = 0; index < Input.touchCount; index += 1)
                {
                    Touch touch = Input.GetTouch(index);
                    if (touch.fingerId != _mobilePingFinger) continue;
                    tracked = touch;
                    found = true;
                    break;
                }
            }
            if (_mobilePingFinger < 0)
            {
                for (int index = 0; index < Input.touchCount; index += 1)
                {
                    Touch touch = Input.GetTouch(index);
                    if (touch.phase != TouchPhase.Began || PointerOverUi(touch.fingerId)) continue;
                    Vector2 gui = new Vector2(touch.position.x, Screen.height - touch.position.y);
                    if (RoaMobileControls.IsJoystickStart(gui, Screen.width, Screen.height, Screen.safeArea)) continue;
                    _mobilePingFinger = touch.fingerId;
                    _mobilePingStartedAt = Time.unscaledTime;
                    _pingGestureOrigin = touch.position;
                    _pingPlacementReady = TryResolvePingWorldPosition(touch.position, out _pingPlacementWorld);
                    tracked = touch;
                    found = true;
                    break;
                }
            }
            if (!found)
            {
                if (_mobilePingFinger >= 0) CancelPingInput(_pingGestureMenu);
                return;
            }

            Vector2 delta = tracked.position - _pingGestureOrigin;
            bool ended = tracked.phase == TouchPhase.Ended || tracked.phase == TouchPhase.Canceled;
            if (!_pingMenuOpen && !ended && delta.magnitude > MobilePingMoveTolerance)
            {
                CancelPingInput(false);
                return;
            }
            if (!_pingMenuOpen && !ended
                && Time.unscaledTime - _mobilePingStartedAt >= MobilePingHoldSeconds
                && _pingPlacementReady)
            {
                OpenPingMenu(_pingGestureOrigin, _pingPlacementWorld, true, true);
            }
            if (_pingMenuOpen && _pingGestureMenu)
            {
                _pingRadialSelection = ResolvePingRadialType(delta, true);
                RefreshPingRadialHighlight();
            }
            if (!ended) return;

            Vector3 placement = _pingPlacementWorld;
            bool placementReady = _pingPlacementReady;
            bool radial = _pingMenuOpen && _pingGestureMenu;
            string selected = radial ? ResolvePingRadialType(delta, true) : string.Empty;
            CancelPingInput(true);
            if (placementReady && !string.IsNullOrEmpty(selected)) SendPingAt(selected, placement);
        }

        private void OpenPingMenu(Vector2 screenPoint, Vector3 worldPoint, bool gesture, bool mobile)
        {
            if (_pingMenuRoot == null) return;
            _pingMenuOpen = true;
            _pingGestureMenu = gesture;
            _pingGestureOrigin = screenPoint;
            _pingPlacementWorld = worldPoint;
            _pingPlacementReady = true;
            _pingRadialSelection = gesture && mobile ? "move" : string.Empty;
            PositionPingMenu(screenPoint);
            if (_pingMenuHint != null)
                _pingMenuHint.text = gesture ? (mobile ? "ПРОВЕДИТЕ И ОТПУСТИТЕ" : "Q · ВЫБЕРИТЕ НАПРАВЛЕНИЕ")
                    : "ВЫБЕРИТЕ МЕТКУ";
            _pingMenuRoot.SetActive(true);
            RefreshPingRadialHighlight();
        }

        private void PositionPingMenu(Vector2 screenPoint)
        {
            RectTransform menu = _pingMenuRoot != null ? _pingMenuRoot.transform as RectTransform : null;
            RectTransform canvasRect = _activityCanvas != null ? _activityCanvas.transform as RectTransform : null;
            if (menu == null || canvasRect == null) return;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(canvasRect, screenPoint, null, out Vector2 local);
            Rect bounds = canvasRect.rect;
            local.x = Mathf.Clamp(local.x, bounds.xMin + 118f, bounds.xMax - 118f);
            local.y = Mathf.Clamp(local.y, bounds.yMin + 96f, bounds.yMax - 96f);
            menu.anchoredPosition = local;
        }

        private void RefreshPingRadialHighlight()
        {
            ApplyPingHighlight(_pingMove, "move");
            ApplyPingHighlight(_pingDanger, "danger");
            ApplyPingHighlight(_pingLoot, "loot");
        }

        private void ApplyPingHighlight(Button button, string type)
        {
            if (button?.targetGraphic == null) return;
            Color color = type == "danger" ? new Color(0.34f, 0.11f, 0.07f, 0.98f)
                : type == "loot" ? new Color(0.30f, 0.24f, 0.08f, 0.98f)
                : new Color(0.12f, 0.25f, 0.12f, 0.98f);
            if (_pingRadialSelection == type) color = Color.Lerp(color, Color.white, 0.28f);
            button.targetGraphic.color = color;
        }

        public static string ResolvePingRadialType(Vector2 delta, bool defaultMove)
        {
            if (delta.magnitude < PingRadialDeadZone) return defaultMove ? "move" : string.Empty;
            Vector2 direction = delta.normalized;
            float danger = Vector2.Dot(direction, Vector2.up);
            float move = Vector2.Dot(direction, new Vector2(-0.82f, -0.57f).normalized);
            float loot = Vector2.Dot(direction, new Vector2(0.82f, -0.57f).normalized);
            return danger >= move && danger >= loot ? "danger" : move >= loot ? "move" : "loot";
        }

        private bool TryResolvePingWorldPosition(Vector2 screenPoint, out Vector3 point)
        {
            point = Bootstrap?.PlayerView != null ? Bootstrap.PlayerView.transform.position : Vector3.zero;
            if (Bootstrap?.PlayerView == null) return false;
            Camera camera = Camera.main;
            if (camera != null)
            {
                Ray ray = camera.ScreenPointToRay(screenPoint);
                Plane ground = new Plane(Vector3.up, point);
                if (ground.Raycast(ray, out float distance)) point = ray.GetPoint(distance);
            }
            Vector3 origin = Bootstrap.PlayerView.transform.position;
            Vector3 delta = Vector3.ProjectOnPlane(point - origin, Vector3.up);
            if (delta.sqrMagnitude > PingMaxDistance * PingMaxDistance)
                point = origin + delta.normalized * PingMaxDistance;
            return true;
        }

        private static bool PointerOverUi(int fingerId)
        {
            return EventSystem.current != null && EventSystem.current.IsPointerOverGameObject(fingerId);
        }

        private void CancelPingInput(bool closeMenu)
        {
            _desktopPingHeld = false;
            _mobilePingFinger = -1;
            _pingGestureMenu = false;
            _pingRadialSelection = string.Empty;
            _pingPlacementReady = false;
            if (!closeMenu) return;
            _pingMenuOpen = false;
            if (_pingMenuRoot != null) _pingMenuRoot.SetActive(false);
        }

        private void SendPing(string type)
        {
            Vector3 point = _pingPlacementWorld;
            bool ready = _pingPlacementReady;
            if (!ready)
            {
                Vector2 screenPoint = new Vector2(Screen.width * 0.5f, Screen.height * 0.5f);
                ready = TryResolvePingWorldPosition(screenPoint, out point);
            }
            CancelPingInput(true);
            if (ready) SendPingAt(type, point);
        }

        private void SendPingAt(string type, Vector3 point)
        {
            if (_pending || Socket == null || _activity == null || Bootstrap?.PlayerView == null) return;
            RoaCoords.ToServer(point, out float x, out float z);
            string label = type == "danger" ? "ВРАГ" : type == "loot" ? "ЛУТ" : "СЮДА";
            _pending = true;
            Socket.EmitWithAck("worldActivityPing", new Dictionary<string, object>
            {
                ["type"] = type,
                ["label"] = label,
                ["x"] = x,
                ["z"] = z
            }, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ShowMessage(ack?["error"]?.ToString() ?? "Метка не поставлена.", Danger);
                    return;
                }
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                ShowMessage("МЕТКА ОТРЯДА: " + label, type == "danger" ? Danger : Accent);
                _refreshAt = 0f;
            });
        }

        private void ReviveNearest()
        {
            if (_pending || Socket == null || string.IsNullOrEmpty(_reviveTargetId)) return;
            string targetId = _reviveTargetId;
            _pending = true;
            Socket.EmitWithAck("worldActivityRevive", new Dictionary<string, object>
            {
                ["targetId"] = targetId
            }, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ShowMessage(ack?["error"]?.ToString() ?? "Не удалось поднять союзника.", Danger);
                    return;
                }
                if (ack?["activity"] is JObject activity) _activity = activity;
                _reviveTargetId = string.Empty;
                ShowMessage("СОЮЗНИК СНОВА В БОЮ.", Safe);
                _refreshAt = 0f;
            });
        }

        private void ContinueTogether()
        {
            if (_continuePending || Socket == null || string.IsNullOrEmpty(LastResultTaskId)) return;
            _continuePending = true;
            _resultContinue.interactable = false;
            _resultContinueLabel.text = "ИЩЕМ СЛЕДУЮЩУЮ ЦЕЛЬ…";
            Socket.EmitWithAck("worldActivityContinue", new Dictionary<string, object>
            {
                ["taskId"] = LastResultTaskId
            }, ack =>
            {
                _continuePending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    _resultContinue.interactable = true;
                    _resultContinueLabel.text = ack?["error"]?.ToString() ?? "СБОР ОТРЯДА ЗАКРЫТ";
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                int votes = Mathf.Max(1, ack?["voteCount"]?.ToObject<int>() ?? 1);
                bool ready = ack?["ready"]?.ToObject<bool>() == true;
                string title = ack?["nextTask"]?["title"]?.ToString() ?? "Следующая вылазка";
                _resultContinueLabel.text = ready ? "ОТРЯД ГОТОВ · ЦЕЛЬ ОТМЕЧЕНА" : "ВЫ СОГЛАСНЫ · " + votes;
                _resultReward.text += "\nСледующая цель: " + title + ". Вернитесь на глобальную карту.";
            });
        }

        private void Interact(string pointId)
        {
            if (_pending || Socket == null || _activity == null || string.IsNullOrEmpty(pointId)) return;
            string taskId = _activity["taskId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(taskId)) return;
            bool distress = _activity["kind"]?.ToString() == "distress_signal";
            bool operation = _activity["kind"]?.ToString() == "assault_diversion";
            _pending = true;
            ShowMessage(distress ? "Активируем аварийный маяк…"
                : operation && pointId == "approach_assault" ? "Начинаем прямой штурм…"
                : operation && pointId == "approach_diversion" ? "Выбираем скрытый маршрут…"
                : operation ? "Устанавливаем диверсионный заряд…"
                : "Собираем данные наблюдения…", Accent, 12f);
            Socket.EmitWithAck("worldTaskAction", new Dictionary<string, object>
            {
                ["taskId"] = taskId,
                ["action"] = "activity_interact",
                ["pointId"] = pointId
            }, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ShowMessage(ack?["error"]?.ToString() ?? "Точка наблюдения недоступна.", Danger);
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                ShowMessage(distress ? "Маяк активирован. Засада раскрыта."
                    : operation && pointId == "approach_assault" ? "Штурм начался."
                    : operation && pointId == "approach_diversion" ? "Диверсионный маршрут выбран."
                    : operation ? "Объект выведен из строя."
                    : "Разведданные получены.", Safe);
                _refreshAt = 0f;
            });
        }

        private void Extract()
        {
            if (_pending || Socket == null || _activity == null) return;
            string taskId = _activity["taskId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(taskId)) return;
            bool defense = _activity["kind"]?.ToString() == "outpost_defense";
            _pending = true;
            ShowMessage(defense ? "Подводим итог обороны…" : "Проверяем точку эвакуации…", Accent, 12f);
            Socket.EmitWithAck("worldTaskAction", new Dictionary<string, object>
            {
                ["taskId"] = taskId,
                ["action"] = "activity_extract"
            }, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ShowMessage(ack?["error"]?.ToString() ?? "Эвакуация не удалась.", Danger);
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                ShowMessage(defense ? "Оборона завершена сервером." : "Эвакуация подтверждена сервером.", Safe);
                _refreshAt = 0f;
            });
        }

        private void ShowMessage(string value, Color color, float seconds = 4f)
        {
            if (_message == null) return;
            _message.text = value ?? string.Empty;
            _message.color = color;
            _messageUntil = Time.unscaledTime + Mathf.Max(0.5f, seconds);
            _message.gameObject.SetActive(true);
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("WorldActivityCanvas", typeof(RectTransform), typeof(Canvas),
                typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _activityCanvas = canvasGo.GetComponent<Canvas>();
            _activityCanvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _activityCanvas.sortingOrder = 32;
            BuildObjectiveWorldLabelLayer((RectTransform)canvasGo.transform);

            _focusedHudInitialized = false;
            _hudDensity = ActivityHudDensity.Glance;
            _root = new GameObject("WorldActivityHud", typeof(RectTransform), typeof(Image), typeof(Outline));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0f, 1f);
            root.pivot = new Vector2(0f, 1f);
            bool mobileHudLayout = Bootstrap?.MobileControls?.ControlsEnabled == true;
            _activityScaleInitialized = true;
            _activityScaleMobile = mobileHudLayout;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>(), mobileHudLayout);
            root.anchoredPosition = ActivityHudPosition(mobileHudLayout,
                Bootstrap?.HudCanvas?.IdentityVisible == true);
            root.sizeDelta = ActivityHudSize(ActivityHudDensity.Glance);
            _rootBackground = _root.GetComponent<Image>();
            _rootBackground.color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.86f);
            _rootBackground.raycastTarget = false;
            _rootOutline = _root.GetComponent<Outline>();
            _rootOutline.effectColor = new Color(Border.r, Border.g, Border.b, 0.38f);
            _rootOutline.effectDistance = new Vector2(1f, -1f);

            _title = Label("Title", root, 14, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 10f, -27f, -126f, -8f);
            _title.resizeTextForBestFit = true;
            _title.resizeTextMinSize = 10;
            _title.resizeTextMaxSize = 14;
            _timer = Label("Timer", root, 13, TextAnchor.MiddleRight, Accent, FontStyle.Bold);
            Place(_timer.rectTransform, 256f, -27f, -10f, -8f);
            var detailsGo = new GameObject("Btn:ActivityDetails", typeof(RectTransform),
                typeof(Image), typeof(Button));
            RectTransform detailsRect = (RectTransform)detailsGo.transform;
            detailsRect.SetParent(root, false);
            Place(detailsRect, 210f, -44f, -76f, 0f);
            Image detailsHitArea = detailsGo.GetComponent<Image>();
            detailsHitArea.color = Color.clear;
            RectTransform detailsVisual = Child("Visual", detailsRect);
            detailsVisual.anchorMin = detailsVisual.anchorMax = new Vector2(0.5f, 0.5f);
            detailsVisual.pivot = new Vector2(0.5f, 0.5f);
            detailsVisual.anchoredPosition = Vector2.zero;
            detailsVisual.sizeDelta = new Vector2(30f, 22f);
            Image detailsBackground = detailsVisual.gameObject.AddComponent<Image>();
            detailsBackground.color = new Color(0.12f, 0.13f, 0.10f, 0.92f);
            detailsBackground.raycastTarget = false;
            _detailsToggle = detailsGo.GetComponent<Button>();
            _detailsToggle.targetGraphic = detailsBackground;
            _detailsToggle.onClick.AddListener(ToggleDetails);
            _detailsToggleLabel = Label("Label", detailsVisual, 14, TextAnchor.MiddleCenter,
                Muted, FontStyle.Bold);
            _detailsToggleLabel.text = "+";
            Stretch(_detailsToggleLabel.rectTransform, 1f);
            BuildFlowStrip(root, "ActivityFlow", _flowSlots, 10f, -43f, -10f, -30f);
            _phase = Label("Phase", root, 10, TextAnchor.MiddleLeft, Muted);
            Place(_phase.rectTransform, 10f, -60f, -10f, -45f);
            _objectiveHeader = Label("ObjectiveHeader", root, 9, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            _objectiveHeader.text = "ЦЕЛИ ОПЕРАЦИИ";
            _objectiveHeader.gameObject.SetActive(false);
            BuildObjectiveRowPool(root);

            RectTransform threatTrack = Child("ThreatTrack", root);
            Place(threatTrack, 10f, -144f, -10f, -136f);
            Image threatBackground = threatTrack.gameObject.AddComponent<Image>();
            threatBackground.color = new Color(0.08f, 0.08f, 0.065f, 1f);
            threatBackground.raycastTarget = false;
            RectTransform fill = Child("ThreatFill", threatTrack);
            Stretch(fill, 1f);
            _threatFill = fill.gameObject.AddComponent<Image>();
            _threatFill.raycastTarget = false;
            _threatFill.type = Image.Type.Filled;
            _threatFill.fillMethod = Image.FillMethod.Horizontal;
            _threatFill.fillOrigin = 0;
            _threatFill.fillAmount = 0f;
            _threatText = Label("Threat", root, 10, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            Place(_threatText.rectTransform, 10f, -162f, -180f, -146f);
            _participants = Label("Participants", root, 10, TextAnchor.MiddleRight, Muted);
            Place(_participants.rectTransform, 108f, -162f, -10f, -146f);
            _message = Label("Message", root, 10, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            _message.horizontalOverflow = HorizontalWrapMode.Wrap;
            _message.verticalOverflow = VerticalWrapMode.Truncate;
            Place(_message.rectTransform, 10f, -182f, -10f, -164f);
            _message.gameObject.SetActive(false);

            var actionGo = new GameObject("Btn:ActivityExtract", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            var actionRect = (RectTransform)actionGo.transform;
            actionRect.SetParent(root, false);
            Place(actionRect, 10f, -207f, -138f, -185f);
            actionGo.GetComponent<Image>().color = ButtonBg;
            var actionBorder = actionGo.GetComponent<Outline>();
            actionBorder.effectColor = Safe;
            actionBorder.effectDistance = new Vector2(1f, -1f);
            _action = actionGo.GetComponent<Button>();
            _action.targetGraphic = actionGo.GetComponent<Image>();
            _action.onClick.AddListener(PerformPrimaryAction);
            _actionLabel = Label("Label", actionRect, 10, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_actionLabel.rectTransform, 2f);

            var helpGo = new GameObject("Btn:ActivityHelp", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            var helpRect = (RectTransform)helpGo.transform;
            helpRect.SetParent(root, false);
            Place(helpRect, 198f, -207f, -72f, -185f);
            helpGo.GetComponent<Image>().color = new Color(Danger.r * 0.45f, Danger.g * 0.45f, Danger.b * 0.45f, 1f);
            Outline helpBorder = helpGo.GetComponent<Outline>();
            helpBorder.effectColor = Danger;
            helpBorder.effectDistance = new Vector2(1f, -1f);
            _helpAction = helpGo.GetComponent<Button>();
            _helpAction.targetGraphic = helpGo.GetComponent<Image>();
            _helpAction.onClick.AddListener(RequestHelp);
            _helpActionLabel = Label("Label", helpRect, 9, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_helpActionLabel.rectTransform, 2f);

            var reviveGo = new GameObject("Btn:ActivityRevive", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            var reviveRect = (RectTransform)reviveGo.transform;
            reviveRect.SetParent(root, false);
            Place(reviveRect, 10f, -207f, -10f, -185f);
            reviveGo.GetComponent<Image>().color = new Color(Safe.r * 0.48f, Safe.g * 0.48f, Safe.b * 0.48f, 1f);
            Outline reviveBorder = reviveGo.GetComponent<Outline>();
            reviveBorder.effectColor = Safe;
            reviveBorder.effectDistance = new Vector2(1f, -1f);
            _reviveAction = reviveGo.GetComponent<Button>();
            _reviveAction.targetGraphic = reviveGo.GetComponent<Image>();
            _reviveAction.onClick.AddListener(ReviveNearest);
            _reviveActionLabel = Label("Label", reviveRect, 10, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_reviveActionLabel.rectTransform, 2f);
            _reviveAction.gameObject.SetActive(false);

            var pingToggleGo = new GameObject("Btn:ActivityPingToggle", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            RectTransform pingToggleRect = (RectTransform)pingToggleGo.transform;
            pingToggleRect.SetParent(root, false);
            Place(pingToggleRect, 264f, -207f, -10f, -185f);
            pingToggleGo.GetComponent<Image>().color = new Color(0.12f, 0.15f, 0.10f, 1f);
            Outline pingToggleBorder = pingToggleGo.GetComponent<Outline>();
            pingToggleBorder.effectColor = Accent;
            pingToggleBorder.effectDistance = new Vector2(1f, -1f);
            _pingToggle = pingToggleGo.GetComponent<Button>();
            _pingToggle.targetGraphic = pingToggleGo.GetComponent<Image>();
            _pingToggle.onClick.AddListener(TogglePingMenu);
            _pingToggleLabel = Label("Label", pingToggleRect, 9, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_pingToggleLabel.rectTransform, 2f);

            _pingMenuRoot = new GameObject("PingRadial", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform pingMenuRect = (RectTransform)_pingMenuRoot.transform;
            pingMenuRect.SetParent(canvasGo.transform, false);
            pingMenuRect.anchorMin = pingMenuRect.anchorMax = new Vector2(0.5f, 0.5f);
            pingMenuRect.pivot = new Vector2(0.5f, 0.5f);
            pingMenuRect.anchoredPosition = Vector2.zero;
            pingMenuRect.sizeDelta = new Vector2(236f, 192f);
            _pingMenuRoot.GetComponent<Image>().color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.88f);
            _pingMenuRoot.GetComponent<Image>().raycastTarget = false;
            Outline pingMenuBorder = _pingMenuRoot.GetComponent<Outline>();
            pingMenuBorder.effectColor = Border;
            pingMenuBorder.effectDistance = new Vector2(1f, -1f);
            _pingMenuHint = Label("Hint", pingMenuRect, 9, TextAnchor.MiddleCenter, Muted, FontStyle.Bold);
            _pingMenuHint.rectTransform.anchorMin = _pingMenuHint.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
            _pingMenuHint.rectTransform.pivot = new Vector2(0.5f, 0.5f);
            _pingMenuHint.rectTransform.anchoredPosition = new Vector2(0f, -2f);
            _pingMenuHint.rectTransform.sizeDelta = new Vector2(210f, 24f);
            _pingMove = BuildRadialPingButton(pingMenuRect, "Move", "СЮДА\n10 С", new Vector2(-72f, -55f), "move");
            _pingDanger = BuildRadialPingButton(pingMenuRect, "Danger", "ВРАГ\n7 С", new Vector2(0f, 57f), "danger");
            _pingLoot = BuildRadialPingButton(pingMenuRect, "Loot", "ЛУТ\n15 С", new Vector2(72f, -55f), "loot");
            _pingMenuRoot.SetActive(false);

            _introRoot = new GameObject("WorldActivityIntro", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform introRect = (RectTransform)_introRoot.transform;
            introRect.SetParent(canvasGo.transform, false);
            introRect.anchorMin = introRect.anchorMax = new Vector2(0.5f, 1f);
            introRect.pivot = new Vector2(0.5f, 1f);
            introRect.anchoredPosition = new Vector2(0f, -24f);
            introRect.sizeDelta = new Vector2(520f, 112f);
            _introRoot.GetComponent<Image>().color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.98f);
            _introRoot.GetComponent<Image>().raycastTarget = false;
            Outline introBorder = _introRoot.GetComponent<Outline>();
            introBorder.effectColor = Border;
            introBorder.effectDistance = new Vector2(1f, -1f);
            _introKicker = Label("IntroKicker", introRect, 10, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            Place(_introKicker.rectTransform, 18f, -25f, -18f, -8f);
            _introTitle = Label("IntroTitle", introRect, 18, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Place(_introTitle.rectTransform, 18f, -57f, -18f, -29f);
            _introInstruction = Label("IntroInstruction", introRect, 11, TextAnchor.UpperCenter, Muted);
            _introInstruction.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_introInstruction.rectTransform, 26f, -98f, -26f, -64f);
            _introRoot.SetActive(false);

            _resultRoot = new GameObject("WorldActivityResult", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform resultRect = (RectTransform)_resultRoot.transform;
            resultRect.SetParent(canvasGo.transform, false);
            resultRect.anchorMin = resultRect.anchorMax = new Vector2(0.5f, 1f);
            resultRect.pivot = new Vector2(0.5f, 1f);
            resultRect.anchoredPosition = new Vector2(0f, -76f);
            resultRect.sizeDelta = new Vector2(470f, 214f);
            _resultRoot.GetComponent<Image>().color = PanelBg;
            _resultRoot.GetComponent<Image>().raycastTarget = false;
            Outline resultBorder = _resultRoot.GetComponent<Outline>();
            resultBorder.effectColor = Border;
            resultBorder.effectDistance = new Vector2(1f, -1f);

            _resultTitle = Label("ResultTitle", resultRect, 13, TextAnchor.MiddleLeft, Safe, FontStyle.Bold);
            Place(_resultTitle.rectTransform, 16f, -27f, -16f, -8f);
            BuildFlowStrip(resultRect, "ResultFlow", _resultFlowSlots, 16f, -46f, -16f, -31f);
            _resultName = Label("ResultName", resultRect, 15, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(_resultName.rectTransform, 16f, -72f, -16f, -50f);
            _resultGrade = Label("ResultGrade", resultRect, 11, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_resultGrade.rectTransform, 16f, -95f, -16f, -76f);
            _resultReward = Label("ResultReward", resultRect, 11, TextAnchor.UpperLeft, Muted);
            _resultReward.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_resultReward.rectTransform, 16f, -164f, -16f, -99f);

            var continueGo = new GameObject("Btn:ActivityContinue", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            RectTransform continueRect = (RectTransform)continueGo.transform;
            continueRect.SetParent(resultRect, false);
            Place(continueRect, 16f, -202f, -16f, -169f);
            continueGo.GetComponent<Image>().color = ButtonBg;
            Outline continueBorder = continueGo.GetComponent<Outline>();
            continueBorder.effectColor = Safe;
            continueBorder.effectDistance = new Vector2(1f, -1f);
            _resultContinue = continueGo.GetComponent<Button>();
            _resultContinue.targetGraphic = continueGo.GetComponent<Image>();
            _resultContinue.onClick.AddListener(ContinueTogether);
            _resultContinueLabel = Label("Label", continueRect, 10, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_resultContinueLabel.rectTransform, 2f);
            _resultContinue.gameObject.SetActive(false);
            ConfigureActivityFeedbackVisuals(introRect, resultRect);
            _resultRoot.SetActive(false);
            BuildActivityNavigation(canvasGo.transform);
        }

        private void ToggleDetails()
        {
            _detailsExpanded = !_detailsExpanded;
            _refreshAt = 0f;
            if (!_detailsExpanded) CancelPingInput(true);
        }

        private void ApplyHudFocusLayout(bool focused)
        {
            ApplyHudDensityLayout(focused
                ? ActivityHudDensity.Context : ActivityHudDensity.Detailed);
        }

        private void ApplyHudDensityLayout(ActivityHudDensity density)
        {
            if (_root == null || _objectiveRows == null) return;
            if (_focusedHudInitialized && _hudDensity == density) return;
            _focusedHudInitialized = true;
            _hudDensity = density;
            _focusedHud = density != ActivityHudDensity.Detailed;

            RectTransform root = (RectTransform)_root.transform;
            root.sizeDelta = ActivityHudSize(density);
            bool detailed = density == ActivityHudDensity.Detailed;
            bool contextual = density == ActivityHudDensity.Context;
            _phase.gameObject.SetActive(detailed);
            if (_detailsToggleLabel != null)
            {
                _detailsToggleLabel.text = detailed ? "−" : "+";
                _detailsToggleLabel.color = detailed ? Accent : Muted;
            }
            if (_rootBackground != null)
            {
                float alpha = detailed ? 0.95f : contextual ? 0.92f : 0.86f;
                _rootBackground.color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, alpha);
            }
            if (_rootOutline != null)
            {
                float alpha = detailed ? 0.55f : contextual ? 0.46f : 0.34f;
                _rootOutline.effectColor = new Color(Border.r, Border.g, Border.b, alpha);
            }

            if (density == ActivityHudDensity.Glance)
            {
                Place(_objectiveRows, 10f, -71f, -10f, -48f);
                Place(_threatFill.rectTransform.parent as RectTransform, 10f, -80f, -10f, -75f);
                Place(_threatText.rectTransform, 10f, -97f, -180f, -81f);
                Place(_participants.rectTransform, 108f, -97f, -10f, -81f);
                _message.gameObject.SetActive(false);
                _action.gameObject.SetActive(false);
                _helpAction.gameObject.SetActive(false);
                _reviveAction.gameObject.SetActive(false);
                _pingToggle.gameObject.SetActive(false);
            }
            else if (contextual)
            {
                Place(_objectiveRows, 10f, -71f, -10f, -48f);
                Place(_threatFill.rectTransform.parent as RectTransform, 10f, -81f, -10f, -75f);
                Place(_threatText.rectTransform, 10f, -99f, -180f, -83f);
                Place(_participants.rectTransform, 108f, -99f, -10f, -83f);
                Place(_message.rectTransform, 10f, -117f, -10f, -100f);
                Place((RectTransform)_action.transform, 10f, -138f, -10f, -119f);
                Place((RectTransform)_helpAction.transform, 198f, -138f, -72f, -119f);
                Place((RectTransform)_reviveAction.transform, 10f, -138f, -10f, -119f);
                Place((RectTransform)_pingToggle.transform, 264f, -138f, -10f, -119f);
            }
            else
            {
                Place(_objectiveRows, 10f, -133f, -10f, -65f);
                Place(_threatFill.rectTransform.parent as RectTransform, 10f, -144f, -10f, -136f);
                Place(_threatText.rectTransform, 10f, -162f, -180f, -146f);
                Place(_participants.rectTransform, 108f, -162f, -10f, -146f);
                Place(_message.rectTransform, 10f, -182f, -10f, -164f);
                Place((RectTransform)_action.transform, 10f, -207f, -138f, -185f);
                Place((RectTransform)_helpAction.transform, 198f, -207f, -72f, -185f);
                Place((RectTransform)_reviveAction.transform, 10f, -207f, -10f, -185f);
                Place((RectTransform)_pingToggle.transform, 264f, -207f, -10f, -185f);
            }
        }

        private void BuildFlowStrip(RectTransform parent, string name, List<FlowSlot> output,
                                    float left, float top, float right, float bottom)
        {
            if (output == null || output.Count > 0) return;
            var stripGo = new GameObject(name, typeof(RectTransform));
            RectTransform strip = (RectTransform)stripGo.transform;
            strip.SetParent(parent, false);
            Place(strip, left, top, right, bottom);
            const float gap = 3f;
            for (int index = 0; index < 4; index += 1)
            {
                var stepGo = new GameObject("FlowStep:" + index,
                    typeof(RectTransform), typeof(Image));
                RectTransform step = (RectTransform)stepGo.transform;
                step.SetParent(strip, false);
                step.anchorMin = new Vector2(index * 0.25f, 0f);
                step.anchorMax = new Vector2((index + 1) * 0.25f, 1f);
                step.offsetMin = new Vector2(index == 0 ? 0f : gap * 0.5f, 0f);
                step.offsetMax = new Vector2(index == 3 ? 0f : -gap * 0.5f, 0f);
                Image background = stepGo.GetComponent<Image>();
                background.raycastTarget = false;
                Text label = Label("Label", step, 9, TextAnchor.MiddleCenter, Muted, FontStyle.Bold);
                label.text = FlowStepLabel(index);
                Stretch(label.rectTransform, 1f);
                output.Add(new FlowSlot { Background = background, Label = label });
            }
        }

        private static void RefreshFlowStrip(List<FlowSlot> slots, ActivityFlowStage stage,
                                             bool failed, bool currentComplete = false)
        {
            if (slots == null) return;
            int current = Mathf.Clamp((int)stage, 0, 3);
            for (int index = 0; index < slots.Count; index += 1)
            {
                FlowSlot slot = slots[index];
                bool complete = index < current || (index == current && currentComplete);
                bool active = index == current;
                Color color = failed && active ? Danger : complete ? Safe : active ? Accent : Muted;
                float alpha = complete ? 0.28f : active ? 0.34f : 0.11f;
                slot.Background.color = new Color(color.r * 0.55f, color.g * 0.55f,
                    color.b * 0.55f, alpha);
                slot.Label.color = index > current
                    ? new Color(Muted.r, Muted.g, Muted.b, 0.55f) : color;
            }
        }

        private static string FlowStepLabel(int index)
        {
            return index == 0 ? "ВХОД" : index == 1 ? "ЦЕЛЬ"
                : index == 2 ? "ВЫХОД" : "НАГРАДА";
        }

        private Button BuildRadialPingButton(RectTransform parent, string name, string label,
                                             Vector2 position, string type)
        {
            var go = new GameObject("Btn:ActivityPing:" + name,
                typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            RectTransform rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.pivot = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = new Vector2(70f, 48f);
            Outline outline = go.GetComponent<Outline>();
            outline.effectColor = type == "danger" ? Danger : type == "loot" ? Accent : Safe;
            outline.effectDistance = new Vector2(1f, -1f);
            Button button = go.GetComponent<Button>();
            button.targetGraphic = go.GetComponent<Image>();
            button.onClick.AddListener(() => SendPing(type));
            Text text = Label("Label", rect, 9, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            text.text = label;
            Stretch(text.rectTransform, 2f);
            ApplyPingHighlight(button, type);
            return button;
        }

        private void BuildObjectiveRowPool(RectTransform parent)
        {
            if (_objectiveSlots.Count > 0) return;
            var rowsGo = new GameObject("ObjectiveRows", typeof(RectTransform));
            RectTransform rows = (RectTransform)rowsGo.transform;
            _objectiveRows = rows;
            rows.SetParent(parent, false);
            Place(rows, 10f, -133f, -10f, -65f);
            for (int index = 0; index < 3; index += 1)
            {
                var rowGo = new GameObject("ObjectiveRow:" + (index + 1), typeof(RectTransform), typeof(Image));
                RectTransform row = (RectTransform)rowGo.transform;
                row.SetParent(rows, false);
                Place(row, 0f, -(21f + index * 23f), 0f, -(index * 23f));
                Image background = rowGo.GetComponent<Image>();
                background.color = new Color(0.07f, 0.08f, 0.06f, 0.78f);
                background.raycastTarget = false;

                RectTransform stripeRect = Child("State", row);
                stripeRect.anchorMin = new Vector2(0f, 0f);
                stripeRect.anchorMax = new Vector2(0f, 1f);
                stripeRect.pivot = new Vector2(0f, 0.5f);
                stripeRect.offsetMin = Vector2.zero;
                stripeRect.offsetMax = new Vector2(3f, 0f);
                Image stripe = stripeRect.gameObject.AddComponent<Image>();
                stripe.raycastTarget = false;

                Text label = Label("Label", row, 12, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
                label.verticalOverflow = VerticalWrapMode.Truncate;
                Place(label.rectTransform, 9f, -19f, -92f, -2f);
                Text progress = Label("Progress", row, 10, TextAnchor.MiddleRight, Muted, FontStyle.Bold);
                progress.verticalOverflow = VerticalWrapMode.Truncate;
                Place(progress.rectTransform, 228f, -19f, -8f, -2f);
                _objectiveSlots.Add(new ObjectiveSlot
                {
                    Root = rowGo,
                    Background = background,
                    Stripe = stripe,
                    Label = label,
                    Progress = progress
                });
                rowGo.SetActive(false);
            }
        }

        private void RefreshObjectiveRows(bool focused)
        {
            BuildObjectiveViews(_activity, _objectiveViews);
            int focusedIndex = focused ? FocusedObjectiveIndex(_objectiveViews) : -1;
            ActiveObjectiveRowCount = focused
                ? (focusedIndex >= 0 ? 1 : 0)
                : Mathf.Min(_objectiveViews.Count, _objectiveSlots.Count);
            for (int index = 0; index < _objectiveSlots.Count; index += 1)
            {
                ObjectiveSlot slot = _objectiveSlots[index];
                bool visible = index < ActiveObjectiveRowCount;
                if (slot.Root.activeSelf != visible) slot.Root.SetActive(visible);
                if (!visible) continue;
                slot.View = _objectiveViews[focused ? focusedIndex : index];
                slot.Label.text = slot.View.Label;
                slot.Progress.text = slot.View.Progress;
                Color color = ObjectiveViewColor(slot.View);
                slot.Stripe.color = color;
                slot.Label.color = color;
                slot.Progress.color = slot.View.State == ObjectiveVisualState.Locked ? color : Ink;
                slot.Background.color = slot.View.IsCurrent
                    ? new Color(color.r * 0.20f, color.g * 0.20f, color.b * 0.20f, 0.94f)
                    : new Color(0.07f, 0.08f, 0.06f, 0.78f);
                slot.Root.transform.localScale = Vector3.one;
            }
        }

        public static void BuildObjectiveViews(JObject activity, List<ObjectiveView> output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            output.Clear();
            JArray objectives = activity?["objectives"] as JArray;
            if (objectives == null) return;
            string kind = activity?["kind"]?.ToString() ?? string.Empty;
            string approach = activity?["approach"]?.ToString() ?? string.Empty;
            bool extractionOpen = activity?["extractionOpen"]?.ToObject<bool>() == true;
            bool sequenceBlocked = false;
            bool currentAssigned = extractionOpen;

            foreach (JToken token in objectives)
            {
                JObject objective = token as JObject;
                if (objective == null || output.Count >= 3) continue;
                string id = objective["id"]?.ToString() ?? string.Empty;
                bool branchLocked = false;
                if (kind == "assault_diversion")
                {
                    if (id == "attackers")
                    {
                        if (approach == "diversion") continue;
                        branchLocked = string.IsNullOrEmpty(approach);
                    }
                    else if (id == "sabotage")
                    {
                        if (approach == "assault") continue;
                        branchLocked = string.IsNullOrEmpty(approach);
                    }
                }

                int current = Mathf.Max(0, objective["current"]?.ToObject<int>() ?? 0);
                int target = Mathf.Max(1, objective["target"]?.ToObject<int>() ?? 1);
                int bonus = Mathf.Max(target, objective["bonusTarget"]?.ToObject<int>() ?? target);
                int maximum = Mathf.Max(bonus, objective["maxTarget"]?.ToObject<int>() ?? bonus);
                bool required = objective["required"]?.ToObject<bool>() != false;
                if (kind == "assault_diversion" && ((approach == "assault" && id == "attackers")
                    || (approach == "diversion" && id == "sabotage"))) required = true;
                bool locked = branchLocked || sequenceBlocked;
                bool reachedTarget = current >= target;
                bool reachedMaximum = current >= maximum;
                bool isCurrent = !locked && !currentAssigned && !reachedMaximum;
                if (isCurrent) currentAssigned = true;

                ObjectiveVisualState visualState = locked ? ObjectiveVisualState.Locked
                    : reachedMaximum ? (maximum > target ? ObjectiveVisualState.Mastered : ObjectiveVisualState.Complete)
                    : current >= bonus && bonus > target ? ObjectiveVisualState.Bonus
                    : reachedTarget ? ObjectiveVisualState.Complete
                    : isCurrent ? ObjectiveVisualState.Active : ObjectiveVisualState.Locked;
                string progress = locked
                    ? branchLocked ? "ПОСЛЕ ВЫБОРА" : "СЛЕДУЮЩИЙ ЭТАП"
                    : ObjectiveProgressText(current, target, bonus, maximum);
                output.Add(new ObjectiveView(id, ObjectiveLabel(kind, approach, id,
                    objective["label"]?.ToString()), progress, visualState, isCurrent));
                if (!locked && required && !reachedTarget) sequenceBlocked = true;
            }

            if (extractionOpen && output.Count < 3)
            {
                output.Add(new ObjectiveView("extraction", ExtractionObjectiveLabel(kind), "ДОСТУПНО",
                    ObjectiveVisualState.Active, true));
            }
        }

        private static string ObjectiveLabel(string kind, string approach, string id, string authored)
        {
            if (kind == "assault_diversion" && string.IsNullOrEmpty(approach))
            {
                if (id == "attackers") return "Штурм: сломить защитников";
                if (id == "sabotage") return "Диверсия: вывести объекты из строя";
            }
            if (!string.IsNullOrWhiteSpace(authored)) return authored;
            if (id == "resources") return "Собрать ресурсы";
            if (id == "recon_points") return "Проверить точки наблюдения";
            if (id == "distress_signal") return "Найти источник сигнала";
            if (id == "attackers") return kind == "distress_signal" ? "Зачистить засаду" : "Отразить нападение";
            if (id == "sabotage") return "Вывести объекты из строя";
            if (id == "approach") return "Выбрать подход";
            return "Выполнить цель";
        }

        private static string ObjectiveProgressText(int current, int target, int bonus, int maximum)
        {
            if (current >= maximum)
                return maximum > target ? "МАКСИМУМ · " + current + "/" + maximum : "ГОТОВО · " + current + "/" + target;
            if (bonus > target && current >= bonus)
                return maximum > bonus ? "БОНУС ГОТОВ · " + current + "/" + maximum : "БОНУС ГОТОВ";
            if (current >= target)
                return bonus > target ? "ОСНОВА ГОТОВА · " + current + "/" + bonus : "ГОТОВО";
            return current + " / " + target;
        }

        private static string ExtractionObjectiveLabel(string kind)
        {
            if (kind == "outpost_defense") return "Завершить оборону";
            if (kind == "distress_signal") return "Завершить спасение";
            return "Добраться до эвакуации";
        }

        private static Color ObjectiveViewColor(ObjectiveView view)
        {
            if (view.State == ObjectiveVisualState.Locked)
                return new Color(Muted.r, Muted.g, Muted.b, 0.62f);
            if (view.State == ObjectiveVisualState.Complete
                || view.State == ObjectiveVisualState.Bonus
                || view.State == ObjectiveVisualState.Mastered) return Safe;
            return view.IsCurrent ? Accent : Ink;
        }

        public static string RewardReceipt(JObject result, JObject authoritativeSelf)
        {
            if (result == null) return FailureSummary(string.Empty);
            string status = result["status"]?.ToString() ?? "resolved";
            if (status != "completed") return FailureSummary(result["reason"]?.ToString());

            JObject reward = result["reward"] as JObject ?? new JObject();
            var grants = new List<string>();
            int xp = Mathf.Max(0, reward["xp"]?.ToObject<int>() ?? 0);
            int caps = Mathf.Max(0, reward["caps"]?.ToObject<int>() ?? 0);
            int reputation = Mathf.Max(0, reward["reputation"]?.ToObject<int>() ?? 0);
            string factionId = reward["reputationFactionId"]?.ToString() ?? string.Empty;
            if (xp > 0) grants.Add("+" + xp + " XP");
            if (caps > 0) grants.Add("+" + caps + " крышек");
            if (reputation > 0)
                grants.Add("+" + reputation + " репутации"
                    + (string.IsNullOrEmpty(factionId) ? string.Empty : " · " + RoaPipboy.FactionLabel(factionId)));
            string rewardText = grants.Count > 0 ? string.Join(" · ", grants) : "без выплаты";

            bool claimed = result["rewardClaimed"]?.ToObject<bool>() == true;
            if (!claimed)
                return result["reason"]?.ToString() == "reward_inventory_full"
                    ? "НАГРАДА ЖДЁТ: освободите место для крышек — сервер начислит её автоматически."
                    : "НАГРАДА ЖДЁТ В КОНТРАКТАХ: " + rewardText;

            var confirmed = new List<string>();
            if (authoritativeSelf?["inventory"] is JArray inventory)
            {
                int balance = 0;
                foreach (JToken row in inventory)
                    if (RoaInventory.BaseId(row?["id"]?.ToString()) == "silver")
                        balance += Mathf.Max(0, row?["qty"]?.ToObject<int>() ?? 0);
                confirmed.Add("баланс " + balance + " крышек");
            }
            if (authoritativeSelf?["level"] != null)
                confirmed.Add("ур. " + Mathf.Max(1, authoritativeSelf["level"].ToObject<int>()));
            if (authoritativeSelf?["xp"] != null)
            {
                int currentXp = Mathf.Max(0, authoritativeSelf["xp"].ToObject<int>());
                int neededXp = Mathf.Max(1, authoritativeSelf["xpNeeded"]?.ToObject<int>()
                    ?? authoritativeSelf["xpToNext"]?.ToObject<int>() ?? 1);
                confirmed.Add("XP " + currentXp + "/" + neededXp);
            }
            if (reputation > 0 && !string.IsNullOrEmpty(factionId)
                && authoritativeSelf?["worldFactionReputation"]?[factionId] != null)
            {
                int total = Mathf.Max(0, authoritativeSelf["worldFactionReputation"][factionId].ToObject<int>());
                confirmed.Add(RoaPipboy.FactionLabel(factionId) + " " + total);
            }

            return "НАГРАДА НАЧИСЛЕНА: " + rewardText
                + (confirmed.Count > 0 ? "\nПОДТВЕРЖДЕНО СЕРВЕРОМ · " + string.Join(" · ", confirmed) : string.Empty);
        }

        public static string FailureSummary(string reason)
        {
            if (reason == "time_expired")
                return "ВРЕМЯ ВЫШЛО: награда не начислена. Вернитесь на живую карту за новым событием.";
            if (reason == "participation_not_credited")
                return "УЧАСТИЕ НЕ ЗАСЧИТАНО: основная цель не была выполнена вместе с группой.";
            if (reason == "player_died")
                return "ВЫ ПОГИБЛИ: личная вылазка завершена, награда не начислена.";
            return "ВЫЛАЗКА ЗАКРЫТА БЕЗ НАГРАДЫ. Вернитесь на живую карту за новым событием.";
        }

        private static string StartInstruction(string kind)
        {
            return kind == "outpost_defense"
                ? "Удержите аванпост и отразите три волны."
                : kind == "distress_signal"
                ? "Найдите маяк, раскройте засаду и зачистите район."
                : kind == "assault_diversion"
                ? "Выберите штурм или диверсию, затем выполните выбранный план."
                : kind == "recon_expedition"
                ? "Проверьте отмеченные точки и вернитесь к выходу."
                : "Соберите ресурсы и вернитесь к выходу. Полевой инструмент уже доступен.";
        }
        private static string PhaseLabel(string status, string phase, string kind)
        {
            if (status == "completed") return "АКТИВНОСТЬ ЗАВЕРШЕНА";
            if (status == "failed" || status == "expired") return "АКТИВНОСТЬ ПРОВАЛЕНА";
            if (phase == "extraction") return kind == "outpost_defense"
                ? "ОСНОВНАЯ АТАКА ОТБИТА"
                : kind == "distress_signal" ? "РАЙОН ЗАЧИЩЕН" : "ЭВАКУАЦИЯ ОТКРЫТА";
            if (kind == "assault_diversion") return phase == "assaulting" ? "ПРЯМОЙ ШТУРМ"
                : phase == "sabotaging" ? "ДИВЕРСИЯ" : "ВЫБОР ПОДХОДА";
            return kind == "outpost_defense" ? "ОТРАЖЕНИЕ ШТУРМА"
                : kind == "distress_signal" ? (phase == "ambush" ? "ЗАЧИСТКА ЗАСАДЫ" : "ПОИСК И СПАСЕНИЕ")
                : kind == "recon_expedition" ? "РАЗВЕДКА И РИСК"
                : "ДОБЫЧА И РИСК";
        }

        public static JObject ActiveEncounterLane(JObject activity)
        {
            JObject encounter = activity?["encounter"] as JObject;
            string activeLaneId = encounter?["activeLaneId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(activeLaneId) || !(encounter?["lanes"] is JArray lanes)) return null;
            foreach (JToken token in lanes)
            {
                JObject lane = token as JObject;
                if (string.Equals(lane?["id"]?.ToString(), activeLaneId, StringComparison.Ordinal)) return lane;
            }
            return null;
        }

        public static string EncounterStatusText(JObject activity)
        {
            JObject lane = ActiveEncounterLane(activity);
            if (lane == null) return string.Empty;
            int wave = Mathf.Max(1, activity?["encounter"]?["waveNumber"]?.ToObject<int>() ?? 1);
            int waveCount = Mathf.Max(wave, activity?["encounter"]?["waveCount"]?.ToObject<int>() ?? 3);
            string label = lane["label"]?.ToString() ?? lane["id"]?.ToString() ?? string.Empty;
            return "ВОЛНА " + wave + "/" + waveCount + " · " + label.ToUpperInvariant();
        }

        public static string MissionDirectorTransitionMessage(JObject previous, JObject next)
        {
            if (next == null) return string.Empty;
            string previousId = previous?["id"]?.ToString() ?? string.Empty;
            string nextId = next["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(nextId) || !string.Equals(previousId, nextId, StringComparison.Ordinal))
                return string.Empty;

            string previousWarning = previous?["director"]?["warning"]?.ToString() ?? string.Empty;
            string nextWarning = next["director"]?["warning"]?.ToString() ?? string.Empty;
            if (!string.Equals(previousWarning, nextWarning, StringComparison.Ordinal))
            {
                if (nextWarning == "target_recovered")
                    return "ЦЕЛЬ ВОССТАНОВЛЕНА · маршрут и противники снова доступны.";
                if (nextWarning == "stalled")
                    return "ЦЕЛЬ НЕДОСТУПНА · сервер восстанавливает этап.";
            }

            string previousPhase = previous?["phase"]?.ToString() ?? string.Empty;
            string nextPhase = next["phase"]?.ToString() ?? string.Empty;
            string kind = next["kind"]?.ToString() ?? string.Empty;
            bool phaseChanged = !string.IsNullOrEmpty(nextPhase)
                && !string.Equals(previousPhase, nextPhase, StringComparison.Ordinal);
            if (phaseChanged)
            {
                if (nextPhase == "extraction") return kind == "outpost_defense"
                    ? "ОБОРОНА ВЫПОЛНЕНА · завершите операцию и получите награду."
                    : kind == "distress_signal"
                        ? "ЗАСАДА ЗАЧИЩЕНА · завершите спасение и получите награду."
                        : "ОСНОВНАЯ ЦЕЛЬ ВЫПОЛНЕНА · ДОБЕРИТЕСЬ ДО ТОЧКИ ЭВАКУАЦИИ.";
                if (nextPhase == "assaulting")
                {
                    string status = EncounterStatusText(next);
                    return string.IsNullOrEmpty(status) ? "ВЫБРАН ШТУРМ · сломите защитников."
                        : "ВЫБРАН ШТУРМ · " + status + ".";
                }
                if (nextPhase == "sabotaging")
                    return "ВЫБРАНА ДИВЕРСИЯ · выведите отмеченные объекты из строя.";
                if (nextPhase == "searching")
                    return "ЭТАП ПОИСКА · найдите источник сигнала.";
                if (nextPhase == "ambush")
                {
                    string status = EncounterStatusText(next);
                    return string.IsNullOrEmpty(status) ? "МАЯК АКТИВИРОВАН · зачистите засаду."
                        : "МАЯК АКТИВИРОВАН · " + status + ".";
                }
                if (nextPhase == "defending")
                    return "НАЧАЛАСЬ ОБОРОНА · удержите аванпост.";
                if (nextPhase == "surveying")
                    return "НАЧАЛАСЬ РАЗВЕДКА · проверьте отмеченные точки.";
            }
            string previousLane = previous?["encounter"]?["activeLaneId"]?.ToString() ?? string.Empty;
            string nextLane = next["encounter"]?["activeLaneId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(nextLane) && !string.Equals(previousLane, nextLane, StringComparison.Ordinal))
                return EncounterStatusText(next) + " · новое направление атаки.";
            return string.Empty;
        }

        public static int MissionTimeWarningLevel(float seconds)
        {
            if (seconds <= 0f) return 0;
            if (seconds <= 15f) return 2;
            if (seconds <= 60f) return 1;
            return 0;
        }

        public static string MissionTimeWarningMessage(int level)
        {
            return level >= 2 ? "ОСТАЛОСЬ 15 СЕКУНД · завершите цель или эвакуируйтесь."
                : level == 1 ? "ОСТАЛАСЬ 1 МИНУТА · сосредоточьтесь на основной цели."
                : string.Empty;
        }


        private void RebuildWorldMarkers()
        {
            string key = (_activity?["id"]?.ToString() ?? string.Empty) + ":"
                + (_activity?["revision"]?.ToString() ?? string.Empty) + ":"
                + (_activity?["status"]?.ToString() ?? string.Empty) + ":"
                + (_activity?["extractionOpen"]?.ToString() ?? string.Empty);
            if (key == _markerRevision) return;
            ClearWorldMarkers();
            _markerRevision = key;
            string kind = _activity?["kind"]?.ToString() ?? string.Empty;
            string status = _activity?["status"]?.ToString() ?? string.Empty;
            if (status != "active" && status != "extracting") return;

            _markerRoot = new GameObject("WorldActivityMarkers");
            _markerRoot.transform.SetParent(transform, false);
            bool extractionOpen = _activity?["extractionOpen"]?.ToObject<bool>() == true;
            if (extractionOpen && kind != "outpost_defense" && kind != "distress_signal"
                && TryActivityExtractionTarget(out Vector3 extraction, out _))
                CreateActivityWorldBeacon("ExtractionBeacon", extraction, Safe, false);

            bool usesPoints = new[] { "recon_expedition", "distress_signal", "assault_diversion" }.Contains(kind);
            if (usesPoints && _activity?["interactionPoints"] is JArray points)
            {
                foreach (JToken token in points)
                {
                    JObject point = token as JObject;
                    string pointStatus = point?["status"]?.ToString() ?? "pending";
                    if (point == null || pointStatus == "disabled" || pointStatus == "locked") continue;
                    bool completed = pointStatus == "completed";
                    float x = point["x"]?.ToObject<float>() ?? 0f;
                    float z = point["z"]?.ToObject<float>() ?? 0f;
                    string markerName = (kind == "distress_signal" ? "DistressSignal:"
                        : kind == "assault_diversion" ? "OperationPoint:" : "ReconPoint:")
                        + (point["id"]?.ToString() ?? "point");
                    Color markerColor = completed ? Safe : Accent;
                    CreateActivityWorldBeacon(markerName, RoaCoords.ToUnity(x, 0.08f, z), markerColor, completed);
                }
            }

            if (_activity?["pings"] is JArray pings)
            {
                foreach (JToken token in pings)
                {
                    JObject ping = token as JObject;
                    if (ping == null) continue;
                    string type = ping["type"]?.ToString() ?? "move";
                    float x = ping["x"]?.ToObject<float>() ?? 0f;
                    float z = ping["z"]?.ToObject<float>() ?? 0f;
                    Color color = type == "danger" ? Danger : type == "loot" ? Accent : Safe;
                    CreateActivityWorldBeacon("SquadPing:" + (ping["id"]?.ToString() ?? type),
                        RoaCoords.ToUnity(x, 0.08f, z), color, false);
                }
            }

            JObject encounter = _activity?["encounter"] as JObject;
            JObject focus = encounter?["focus"] as JObject;
            if (focus != null)
            {
                float focusX = focus["x"]?.ToObject<float>() ?? 0f;
                float focusZ = focus["z"]?.ToObject<float>() ?? 0f;
                float radius = Mathf.Clamp(focus["radius"]?.ToObject<float>() ?? 8f, 4f, 80f);
                var zone = new GameObject("ActivityEncounterZone");
                zone.transform.SetParent(_markerRoot.transform, false);
                zone.transform.position = RoaCoords.ToUnity(focusX, 0f, focusZ);
                zone.AddComponent<RoaActivityZoneMarker>().Configure(radius, Accent);
            }

            JObject activeLane = ActiveEncounterLane(_activity);
            if (activeLane != null)
            {
                float x = activeLane["x"]?.ToObject<float>() ?? 0f;
                float z = activeLane["z"]?.ToObject<float>() ?? 0f;
                CreateActivityWorldBeacon("AttackLane:" + (activeLane["id"]?.ToString() ?? "incoming"),
                    RoaCoords.ToUnity(x, 0.08f, z), Danger, false);
            }
        }

        private void ClearWorldMarkers()
        {
            if (_markerRoot != null)
            {
                Destroy(_markerRoot);
                _markerRoot = null;
            }
            _markerRevision = string.Empty;
        }

        private static string Countdown(float seconds)
        {
            int total = Mathf.Max(0, Mathf.CeilToInt(seconds));
            return (total / 60).ToString("00") + ":" + (total % 60).ToString("00");
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        private static void Place(RectTransform rect, float left, float bottomY, float right, float topY)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(left, bottomY);
            rect.offsetMax = new Vector2(right, topY);
        }

        private static void Stretch(RectTransform rect, float inset)
        {
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = new Vector2(inset, inset);
            rect.offsetMax = new Vector2(-inset, -inset);
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
            return text;
        }
    }
}
