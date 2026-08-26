using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
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

        private GameObject _root;
        private Text _title;
        private Text _phase;
        private Text _timer;
        private Text _objectiveHeader;
        private readonly List<ObjectiveSlot> _objectiveSlots = new List<ObjectiveSlot>(3);
        private readonly List<ObjectiveView> _objectiveViews = new List<ObjectiveView>(3);
        private Text _threatText;
        private Text _participants;
        private Text _actionLabel;
        private Text _message;
        private Image _threatFill;
        private Button _action;
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

        public void Configure(RoaSocketClient socket, RoaGameBootstrap bootstrap)
        {
            Unsubscribe();
            Socket = socket;
            Bootstrap = bootstrap;
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
            if (_root != null) _root.SetActive(false);
            if (_introRoot != null) _introRoot.SetActive(false);
            if (_resultRoot != null) _resultRoot.SetActive(false);
            _resultPending = false;
            _introPending = false;
            ResetActivityFeedback();
            ClearWorldMarkers();
            HideActivityNavigation();
        }

        private void HandleAuthoritativeSelf(JObject self)
        {
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
            string previousId = _activity?["id"]?.ToString() ?? string.Empty;
            string nextId = next?["id"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(nextId) && !string.Equals(previousId, nextId, StringComparison.Ordinal))
            {
                _introActivityId = nextId;
                _introPending = true;
                _introUntil = 0f;
            }
            string previousRevision = _activity?["revision"]?.ToString() ?? string.Empty;
            string nextRevision = next?["revision"]?.ToString() ?? string.Empty;
            bool changed = !string.Equals(previousRevision, nextRevision, StringComparison.Ordinal)
                || !string.Equals(_activity?["status"]?.ToString(), next?["status"]?.ToString(), StringComparison.Ordinal);
            _activity = next;
            if (_activity == null)
            {
                _introPending = false;
                _pendingActivityCue = RoaActivityFeedbackCue.None;
            }
            else QueueActivityFeedback(feedback);
            if (changed)
            {
                _pending = false;
                if (_message != null) _message.text = string.Empty;
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
                    _resultUntil = Time.unscaledTime + RoaActivityFeedback.ResultSeconds;
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
            UpdateActivityPulseVisuals();
            if (introActive) RefreshIntro();
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
            _title.text = (_activity?["title"]?.ToString() ?? "Вылазка за ресурсами").ToUpperInvariant();
            _phase.text = PhaseLabel(status, phase, kind);

            long endsAt = _activity?["endsAt"]?.ToObject<long>() ?? 0L;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            float seconds = Mathf.Max(0f, (endsAt - now) / 1000f);
            _timer.text = status == "completed" ? "ГОТОВО" : Countdown(seconds);

            RefreshObjectiveRows();

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

            int count = Mathf.Max(0, _activity?["participantCount"]?.ToObject<int>() ?? 0);
            _participants.text = count <= 1 ? "Участник: " + count : "Участников: " + count;

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
            bool showReconAction = usesPoint && nearestPoint != null && !pointInReach && !extractionOpen;
            bool running = status == "active" || status == "extracting";
            bool showAction = running && (pointInReach || extractionOpen || showReconAction);
            _action.gameObject.SetActive(showAction);
            _action.interactable = !_pending && (pointInReach || (extractionOpen && extractionInReach));
            if (_pending) _actionLabel.text = "ОБРАБОТКА…";
            else if (pointInReach) _actionLabel.text = kind == "distress_signal"
                ? "АКТИВИРОВАТЬ МАЯК"
                : kind == "assault_diversion" && _actionPointId == "approach_assault" ? "НАЧАТЬ ШТУРМ"
                : kind == "assault_diversion" && _actionPointId == "approach_diversion" ? "ВЫБРАТЬ ДИВЕРСИЮ"
                : kind == "assault_diversion" ? "ЗАЛОЖИТЬ ЗАРЯД"
                : "СОБРАТЬ РАЗВЕДДАННЫЕ";
            else if (extractionOpen) _actionLabel.text = defense
                ? "ЗАВЕРШИТЬ ОБОРОНУ"
                : extractionInReach ? (kind == "distress_signal" ? "ЗАВЕРШИТЬ СПАСЕНИЕ" : "ЭВАКУИРОВАТЬСЯ")
                : "ВЫХОД · " + Mathf.CeilToInt(extractionDistance) + " М";
            else _actionLabel.text = "ТОЧКА НАБЛЮДЕНИЯ · " + Mathf.CeilToInt(nearestDistance) + " М";
            if (status == "active" && _introActivityId == (_activity?["id"]?.ToString() ?? string.Empty)
                && Time.unscaledTime < _introUntil)
            {
                _message.text = "АКТИВНОСТЬ НАЧАЛАСЬ. " + StartInstruction(kind);
                _message.color = Accent;
            }
            else if (status == "completed")
            {
                string grade = _activity?["result"]?["grade"]?.ToString() ?? "completed";
                _message.text = grade == "mastered" ? "Максимальная цель выполнена. Награда начислена."
                    : grade == "bonus" ? "Бонусная цель выполнена. Награда начислена."
                    : "Активность завершена. Награда начислена.";
                _message.color = Safe;
            }
            else if (status == "failed" || status == "expired")
            {
                _message.text = "Вылазка закрыта без награды. Дойдите до края локации, чтобы вернуться на живую карту.";
                _message.color = Danger;
            }
            else if (extractionOpen && string.IsNullOrEmpty(_message.text))
            {
                _message.text = kind == "outpost_defense"
                    ? "Основная атака отбита: завершите оборону или добейте оставшихся ради бонуса."
                    : "Цель выполнена: идите к выходу или рискните ради бонуса.";
                _message.color = Accent;
            }
            else if (!extractionOpen && !_pending)
            {
                _message.text = kind == "outpost_defense"
                    ? "Отразите три волны. Каждая потеря нападающих ускоряет следующий штурм."
                    : kind == "distress_signal"
                    ? "Найдите маяк. После активации будьте готовы к засаде."
                    : kind == "assault_diversion" && string.IsNullOrEmpty(_activity?["approach"]?.ToString())
                    ? "Выберите отмеченный подход: громкий штурм или скрытая диверсия."
                    : kind == "assault_diversion"
                    ? "Выполните выбранный план и эвакуируйтесь после основной цели."
                    : kind == "recon_expedition"
                    ? "Найдите отмеченные точки. Каждое наблюдение повышает риск обнаружения."
                    : "Добыча создаёт шум и повышает угрозу.";
                _message.color = Muted;
            }
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

        private void Interact(string pointId)
        {
            if (_pending || Socket == null || _activity == null || string.IsNullOrEmpty(pointId)) return;
            string taskId = _activity["taskId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(taskId)) return;
            bool distress = _activity["kind"]?.ToString() == "distress_signal";
            bool operation = _activity["kind"]?.ToString() == "assault_diversion";
            _pending = true;
            _message.text = distress ? "Активируем аварийный маяк…"
                : operation && pointId == "approach_assault" ? "Начинаем прямой штурм…"
                : operation && pointId == "approach_diversion" ? "Выбираем скрытый маршрут…"
                : operation ? "Устанавливаем диверсионный заряд…"
                : "Собираем данные наблюдения…";
            _message.color = Accent;
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
                    _message.text = ack?["error"]?.ToString() ?? "Точка наблюдения недоступна.";
                    _message.color = Danger;
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                _message.text = distress ? "Маяк активирован. Засада раскрыта."
                    : operation && pointId == "approach_assault" ? "Штурм начался."
                    : operation && pointId == "approach_diversion" ? "Диверсионный маршрут выбран."
                    : operation ? "Объект выведен из строя."
                    : "Разведданные получены.";
                _message.color = Safe;
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
            _message.text = defense ? "Подводим итог обороны…" : "Проверяем точку эвакуации…";
            _message.color = Accent;
            Socket.EmitWithAck("worldTaskAction", new Dictionary<string, object>
            {
                ["taskId"] = taskId,
                ["action"] = "activity_extract"
            }, ack =>
            {
                _pending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    _message.text = ack?["error"]?.ToString() ?? "Эвакуация не удалась.";
                    _message.color = Danger;
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                _message.text = defense ? "Оборона завершена сервером." : "Эвакуация подтверждена сервером.";
                _message.color = Safe;
                _refreshAt = 0f;
            });
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
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());
            BuildObjectiveWorldLabelLayer((RectTransform)canvasGo.transform);

            _root = new GameObject("WorldActivityHud", typeof(RectTransform), typeof(Image), typeof(Outline));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0.5f, 1f);
            root.pivot = new Vector2(0.5f, 1f);
            root.anchoredPosition = new Vector2(0f, -18f);
            root.sizeDelta = new Vector2(410f, 260f);
            _root.GetComponent<Image>().color = PanelBg;
            var border = _root.GetComponent<Outline>();
            border.effectColor = Border;
            border.effectDistance = new Vector2(1f, -1f);

            _title = Label("Title", root, 12, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 14f, -28f, -110f, -10f);
            _timer = Label("Timer", root, 14, TextAnchor.MiddleRight, Accent, FontStyle.Bold);
            Place(_timer.rectTransform, 300f, -28f, -14f, -10f);
            _phase = Label("Phase", root, 10, TextAnchor.MiddleLeft, Muted);
            Place(_phase.rectTransform, 14f, -47f, -14f, -31f);
            _objectiveHeader = Label("ObjectiveHeader", root, 9, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            _objectiveHeader.text = "ЦЕЛИ ОПЕРАЦИИ";
            Place(_objectiveHeader.rectTransform, 14f, -67f, -14f, -50f);
            BuildObjectiveRowPool(root);

            RectTransform threatTrack = Child("ThreatTrack", root);
            Place(threatTrack, 14f, -151f, -14f, -141f);
            threatTrack.gameObject.AddComponent<Image>().color = new Color(0.08f, 0.08f, 0.065f, 1f);
            RectTransform fill = Child("ThreatFill", threatTrack);
            Stretch(fill, 1f);
            _threatFill = fill.gameObject.AddComponent<Image>();
            _threatFill.type = Image.Type.Filled;
            _threatFill.fillMethod = Image.FillMethod.Horizontal;
            _threatFill.fillOrigin = 0;
            _threatFill.fillAmount = 0f;
            _threatText = Label("Threat", root, 10, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            Place(_threatText.rectTransform, 14f, -169f, -160f, -153f);
            _participants = Label("Participants", root, 10, TextAnchor.MiddleRight, Muted);
            Place(_participants.rectTransform, 220f, -169f, -14f, -153f);
            _message = Label("Message", root, 10, TextAnchor.UpperLeft, Muted);
            _message.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_message.rectTransform, 14f, -203f, -14f, -174f);

            var actionGo = new GameObject("Btn:ActivityExtract", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            var actionRect = (RectTransform)actionGo.transform;
            actionRect.SetParent(root, false);
            Place(actionRect, 14f, -247f, -14f, -211f);
            actionGo.GetComponent<Image>().color = ButtonBg;
            var actionBorder = actionGo.GetComponent<Outline>();
            actionBorder.effectColor = Safe;
            actionBorder.effectDistance = new Vector2(1f, -1f);
            _action = actionGo.GetComponent<Button>();
            _action.targetGraphic = actionGo.GetComponent<Image>();
            _action.onClick.AddListener(PerformPrimaryAction);
            _actionLabel = Label("Label", actionRect, 11, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_actionLabel.rectTransform, 2f);

            _introRoot = new GameObject("WorldActivityIntro", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform introRect = (RectTransform)_introRoot.transform;
            introRect.SetParent(canvasGo.transform, false);
            introRect.anchorMin = introRect.anchorMax = new Vector2(0.5f, 1f);
            introRect.pivot = new Vector2(0.5f, 1f);
            introRect.anchoredPosition = new Vector2(0f, -24f);
            introRect.sizeDelta = new Vector2(520f, 112f);
            _introRoot.GetComponent<Image>().color = new Color(PanelBg.r, PanelBg.g, PanelBg.b, 0.98f);
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
            resultRect.sizeDelta = new Vector2(470f, 148f);
            _resultRoot.GetComponent<Image>().color = PanelBg;
            _resultRoot.GetComponent<Image>().raycastTarget = false;
            Outline resultBorder = _resultRoot.GetComponent<Outline>();
            resultBorder.effectColor = Border;
            resultBorder.effectDistance = new Vector2(1f, -1f);

            _resultTitle = Label("ResultTitle", resultRect, 13, TextAnchor.MiddleLeft, Safe, FontStyle.Bold);
            Place(_resultTitle.rectTransform, 16f, -28f, -16f, -8f);
            _resultName = Label("ResultName", resultRect, 15, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
            Place(_resultName.rectTransform, 16f, -53f, -16f, -31f);
            _resultGrade = Label("ResultGrade", resultRect, 11, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_resultGrade.rectTransform, 16f, -76f, -16f, -57f);
            _resultReward = Label("ResultReward", resultRect, 11, TextAnchor.UpperLeft, Muted);
            _resultReward.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_resultReward.rectTransform, 16f, -139f, -16f, -80f);
            ConfigureActivityFeedbackVisuals(introRect, resultRect);
            _resultRoot.SetActive(false);
            BuildActivityNavigation(canvasGo.transform);
        }

        private void BuildObjectiveRowPool(RectTransform parent)
        {
            if (_objectiveSlots.Count > 0) return;
            var rowsGo = new GameObject("ObjectiveRows", typeof(RectTransform));
            RectTransform rows = (RectTransform)rowsGo.transform;
            rows.SetParent(parent, false);
            Place(rows, 14f, -137f, -14f, -69f);
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

                Text label = Label("Label", row, 10, TextAnchor.MiddleLeft, Ink, FontStyle.Bold);
                label.verticalOverflow = VerticalWrapMode.Truncate;
                Place(label.rectTransform, 9f, -19f, -137f, -2f);
                Text progress = Label("Progress", row, 9, TextAnchor.MiddleRight, Muted, FontStyle.Bold);
                progress.verticalOverflow = VerticalWrapMode.Truncate;
                Place(progress.rectTransform, 250f, -19f, -8f, -2f);
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

        private void RefreshObjectiveRows()
        {
            BuildObjectiveViews(_activity, _objectiveViews);
            ActiveObjectiveRowCount = Mathf.Min(_objectiveViews.Count, _objectiveSlots.Count);
            for (int index = 0; index < _objectiveSlots.Count; index += 1)
            {
                ObjectiveSlot slot = _objectiveSlots[index];
                bool visible = index < ActiveObjectiveRowCount;
                if (slot.Root.activeSelf != visible) slot.Root.SetActive(visible);
                if (!visible) continue;
                slot.View = _objectiveViews[index];
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
                    : "НАГРАДА ЖДЁТ В ЖУРНАЛЕ: " + rewardText;

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
                : kind == "distress_signal" ? "ПОИСК И СПАСЕНИЕ"
                : kind == "recon_expedition" ? "РАЗВЕДКА И РИСК"
                : "ДОБЫЧА И РИСК";
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
            if (!usesPoints || !(_activity?["interactionPoints"] is JArray points)) return;
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
