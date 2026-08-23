using System;
using System.Collections.Generic;
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
    public sealed class RoaWorldActivityCanvas : MonoBehaviour
    {
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
        private Text _objective;
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

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        public void Configure(RoaSocketClient socket, RoaGameBootstrap bootstrap)
        {
            Unsubscribe();
            Socket = socket;
            Bootstrap = bootstrap;
            Subscribe();
            ApplyWorldState(Socket?.Session?.WorldState);
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
            Socket.OnDisconnected += HandleDisconnected;
            _subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!_subscribed || Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnWorldState -= ApplyWorldState;
            Socket.OnDisconnected -= HandleDisconnected;
            _subscribed = false;
        }

        private void HandleJoined(JoinAck ack)
        {
            ApplyWorldState(ack?.WorldState);
        }

        private void HandleDisconnected(string _)
        {
            _activity = null;
            _pending = false;
            if (_root != null) _root.SetActive(false);
            ClearWorldMarkers();
        }

        private void ApplyWorldState(JObject state)
        {
            JObject next = state?["activity"] as JObject;
            string previousRevision = _activity?["revision"]?.ToString() ?? string.Empty;
            string nextRevision = next?["revision"]?.ToString() ?? string.Empty;
            bool changed = !string.Equals(previousRevision, nextRevision, StringComparison.Ordinal)
                || !string.Equals(_activity?["status"]?.ToString(), next?["status"]?.ToString(), StringComparison.Ordinal);
            _activity = next;
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
            bool hiddenByScreen = Bootstrap != null && (Bootstrap.FrontendVisible || Bootstrap.OnGlobalMap);
            if (_activity == null || hiddenByScreen)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                if (_markerRoot != null) _markerRoot.SetActive(false);
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) _root.SetActive(true);
            RebuildWorldMarkers();
            if (_markerRoot != null) _markerRoot.SetActive(true);
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

            JObject objective = (_activity?["objectives"] as JArray)?[0] as JObject;
            int current = Mathf.Max(0, objective?["current"]?.ToObject<int>() ?? 0);
            int target = Mathf.Max(1, objective?["target"]?.ToObject<int>() ?? 1);
            int bonus = Mathf.Max(target, objective?["bonusTarget"]?.ToObject<int>() ?? target);
            int maximum = Mathf.Max(bonus, objective?["maxTarget"]?.ToObject<int>() ?? bonus);
            string objectivePrefix = kind == "recon_expedition" ? "Разведано: "
                : kind == "outpost_defense" ? "Нападающие: "
                : "Собрано: ";
            _objective.text = objectivePrefix + current + " / " + target
                + (current >= target ? "   ·   бонус " + bonus + "   ·   максимум " + maximum : string.Empty);

            float threat = Mathf.Clamp(_activity?["threat"]?.ToObject<float>() ?? 0f, 0f, 100f);
            _threatFill.fillAmount = threat / 100f;
            _threatFill.color = Color.Lerp(Safe, Danger, threat / 100f);
            _threatText.text = (kind == "outpost_defense" ? "НАТИСК " : "УГРОЗА ")
                + Mathf.RoundToInt(threat) + "%";
            _threatText.color = threat >= 50f ? Danger : Muted;

            int count = Mathf.Max(0, _activity?["participantCount"]?.ToObject<int>() ?? 0);
            _participants.text = count <= 1 ? "Участник: " + count : "Участников: " + count;

            bool extractionOpen = _activity?["extractionOpen"]?.ToObject<bool>() == true;
            float nearestDistance = float.MaxValue;
            JObject nearestPoint = kind == "recon_expedition" ? NearestPendingPoint(out nearestDistance) : null;
            bool pointInReach = nearestPoint != null && nearestDistance <= 3f;
            _actionPointId = pointInReach ? nearestPoint?["id"]?.ToString() ?? string.Empty : string.Empty;
            bool showReconAction = kind == "recon_expedition" && nearestPoint != null && !pointInReach && !extractionOpen;
            bool showAction = status != "completed" && (pointInReach || extractionOpen || showReconAction);
            _action.gameObject.SetActive(showAction);
            _action.interactable = !_pending && (pointInReach || extractionOpen);
            if (_pending) _actionLabel.text = "ОБРАБОТКА…";
            else if (pointInReach) _actionLabel.text = "СОБРАТЬ РАЗВЕДДАННЫЕ";
            else if (extractionOpen) _actionLabel.text = kind == "outpost_defense"
                ? "ЗАВЕРШИТЬ ОБОРОНУ" : "ЭВАКУИРОВАТЬСЯ У ВЫХОДА";
            else _actionLabel.text = "ТОЧКА НАБЛЮДЕНИЯ · " + Mathf.CeilToInt(nearestDistance) + " М";
            if (status == "completed")
            {
                string grade = _activity?["result"]?["grade"]?.ToString() ?? "completed";
                _message.text = grade == "mastered" ? "Максимальная цель выполнена. Заберите награду на карте."
                    : grade == "bonus" ? "Бонусная цель выполнена. Заберите награду на карте."
                    : "Активность завершена. Заберите награду на карте.";
                _message.color = Safe;
            }
            else if (status == "failed" || status == "expired")
            {
                _message.text = "Время вышло. Активность можно начать заново.";
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
                    : kind == "recon_expedition"
                    ? "Найдите отмеченные точки. Каждое наблюдение повышает риск обнаружения."
                    : "Добыча создаёт шум и повышает угрозу.";
                _message.color = Muted;
            }
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
                if (point == null || point["status"]?.ToString() == "completed") continue;
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
            _pending = true;
            _message.text = "Собираем данные наблюдения…";
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
                if (ack?["activity"] is JObject activity) _activity = activity;
                _markerRevision = string.Empty;
                _message.text = "Разведданные получены.";
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
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 32;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _root = new GameObject("WorldActivityHud", typeof(RectTransform), typeof(Image), typeof(Outline));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(1f, 1f);
            root.pivot = new Vector2(1f, 1f);
            root.anchoredPosition = new Vector2(-20f, -82f);
            root.sizeDelta = new Vector2(330f, 194f);
            _root.GetComponent<Image>().color = PanelBg;
            var border = _root.GetComponent<Outline>();
            border.effectColor = Border;
            border.effectDistance = new Vector2(1f, -1f);

            _title = Label("Title", root, 12, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            Place(_title.rectTransform, 14f, -28f, -90f, -10f);
            _timer = Label("Timer", root, 14, TextAnchor.MiddleRight, Accent, FontStyle.Bold);
            Place(_timer.rectTransform, 230f, -28f, -14f, -10f);
            _phase = Label("Phase", root, 10, TextAnchor.MiddleLeft, Muted);
            Place(_phase.rectTransform, 14f, -47f, -14f, -31f);
            _objective = Label("Objective", root, 12, TextAnchor.MiddleLeft, Ink);
            Place(_objective.rectTransform, 14f, -70f, -14f, -49f);

            RectTransform threatTrack = Child("ThreatTrack", root);
            Place(threatTrack, 14f, -86f, -14f, -75f);
            threatTrack.gameObject.AddComponent<Image>().color = new Color(0.08f, 0.08f, 0.065f, 1f);
            RectTransform fill = Child("ThreatFill", threatTrack);
            Stretch(fill, 1f);
            _threatFill = fill.gameObject.AddComponent<Image>();
            _threatFill.type = Image.Type.Filled;
            _threatFill.fillMethod = Image.FillMethod.Horizontal;
            _threatFill.fillOrigin = 0;
            _threatFill.fillAmount = 0f;
            _threatText = Label("Threat", root, 10, TextAnchor.MiddleLeft, Muted, FontStyle.Bold);
            Place(_threatText.rectTransform, 14f, -105f, -130f, -89f);
            _participants = Label("Participants", root, 10, TextAnchor.MiddleRight, Muted);
            Place(_participants.rectTransform, 170f, -105f, -14f, -89f);
            _message = Label("Message", root, 10, TextAnchor.UpperLeft, Muted);
            _message.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_message.rectTransform, 14f, -139f, -14f, -110f);

            var actionGo = new GameObject("Btn:ActivityExtract", typeof(RectTransform), typeof(Image), typeof(Outline), typeof(Button));
            var actionRect = (RectTransform)actionGo.transform;
            actionRect.SetParent(root, false);
            Place(actionRect, 14f, -181f, -14f, -147f);
            actionGo.GetComponent<Image>().color = ButtonBg;
            var actionBorder = actionGo.GetComponent<Outline>();
            actionBorder.effectColor = Safe;
            actionBorder.effectDistance = new Vector2(1f, -1f);
            _action = actionGo.GetComponent<Button>();
            _action.targetGraphic = actionGo.GetComponent<Image>();
            _action.onClick.AddListener(PerformPrimaryAction);
            _actionLabel = Label("Label", actionRect, 11, TextAnchor.MiddleCenter, Ink, FontStyle.Bold);
            Stretch(_actionLabel.rectTransform, 2f);
        }

        private static string PhaseLabel(string status, string phase, string kind)
        {
            if (status == "completed") return "АКТИВНОСТЬ ЗАВЕРШЕНА";
            if (status == "failed" || status == "expired") return "АКТИВНОСТЬ ПРОВАЛЕНА";
            if (phase == "extraction") return kind == "outpost_defense"
                ? "ОСНОВНАЯ АТАКА ОТБИТА" : "ЭВАКУАЦИЯ ОТКРЫТА";
            return kind == "outpost_defense" ? "ОТРАЖЕНИЕ ШТУРМА"
                : kind == "recon_expedition" ? "РАЗВЕДКА И РИСК"
                : "ДОБЫЧА И РИСК";
        }


        private void RebuildWorldMarkers()
        {
            string key = (_activity?["id"]?.ToString() ?? string.Empty) + ":"
                + (_activity?["revision"]?.ToString() ?? string.Empty) + ":"
                + (_activity?["status"]?.ToString() ?? string.Empty);
            if (key == _markerRevision) return;
            ClearWorldMarkers();
            _markerRevision = key;
            string kind = _activity?["kind"]?.ToString() ?? string.Empty;
            string status = _activity?["status"]?.ToString() ?? string.Empty;
            if (kind != "recon_expedition" || (status != "active" && status != "extracting")
                || !(_activity?["interactionPoints"] is JArray points)) return;

            _markerRoot = new GameObject("WorldActivityMarkers");
            _markerRoot.transform.SetParent(transform, false);
            foreach (JToken token in points)
            {
                JObject point = token as JObject;
                if (point == null) continue;
                bool completed = point["status"]?.ToString() == "completed";
                float x = point["x"]?.ToObject<float>() ?? 0f;
                float z = point["z"]?.ToObject<float>() ?? 0f;
                var marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                marker.name = "ReconPoint:" + (point["id"]?.ToString() ?? "point");
                marker.transform.SetParent(_markerRoot.transform, false);
                marker.transform.position = RoaCoords.ToUnity(x, 0.08f, z);
                marker.transform.localScale = new Vector3(0.62f, 0.035f, 0.62f);
                Renderer renderer = marker.GetComponent<Renderer>();
                if (renderer != null) renderer.material.color = completed ? Safe : Accent;
                Collider collider = marker.GetComponent<Collider>();
                if (collider != null) Destroy(collider);
            }
        }

        private void ClearWorldMarkers()
        {
            if (_markerRoot != null)
            {
                foreach (Renderer renderer in _markerRoot.GetComponentsInChildren<Renderer>())
                    if (renderer != null && renderer.material != null) Destroy(renderer.material);
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
