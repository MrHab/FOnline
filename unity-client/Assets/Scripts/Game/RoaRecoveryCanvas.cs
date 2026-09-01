using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    [DisallowMultipleComponent]
    public sealed class RoaRecoveryCanvas : MonoBehaviour
    {
        private static readonly Color Panel = new Color(0.035f, 0.043f, 0.036f, 0.98f);
        private static readonly Color Border = new Color(0.76f, 0.31f, 0.22f, 0.82f);
        private static readonly Color Ink = new Color(0.91f, 0.87f, 0.75f, 1f);
        private static readonly Color Muted = new Color(0.59f, 0.66f, 0.55f, 1f);
        private static readonly Color Danger = new Color(0.94f, 0.36f, 0.24f, 1f);
        private static readonly Color Safe = new Color(0.45f, 0.75f, 0.40f, 1f);

        public RoaSocketClient Socket;
        public RoaGameBootstrap Bootstrap;

        private Canvas _canvas;
        private RectTransform _safeRoot;
        private GameObject _root;
        private Text _title;
        private Text _cause;
        private Text _state;
        private Text _next;
        private JObject _pendingPayload;
        private bool _subscribed;
        private float _visibleUntil;
        private Rect _lastSafeArea;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        public void Configure(RoaSocketClient socket, RoaGameBootstrap bootstrap)
        {
            Unsubscribe();
            Socket = socket;
            Bootstrap = bootstrap;
            Subscribe();
            EnsureBuilt();
        }

        private void OnEnable()
        {
            Subscribe();
        }

        private void OnDisable()
        {
            Unsubscribe();
        }

        private void Subscribe()
        {
            if (_subscribed || Socket == null) return;
            Socket.OnServerRespawn += HandleRespawn;
            Socket.OnDisconnected += HandleDisconnected;
            _subscribed = true;
        }

        private void Unsubscribe()
        {
            if (!_subscribed || Socket == null) return;
            Socket.OnServerRespawn -= HandleRespawn;
            Socket.OnDisconnected -= HandleDisconnected;
            _subscribed = false;
        }

        private void HandleRespawn(JObject payload)
        {
            if (payload == null) return;
            _pendingPayload = (JObject)payload.DeepClone();
            _visibleUntil = 0f;
            if (_root != null) _root.SetActive(false);
        }

        private void HandleDisconnected(string _)
        {
            _pendingPayload = null;
            _visibleUntil = 0f;
            if (_root != null) _root.SetActive(false);
        }

        private void Update()
        {
            EnsureBuilt();
            UpdateSafeArea();

            if (_pendingPayload != null && Bootstrap != null && Bootstrap.InGame)
            {
                Show(_pendingPayload);
                _pendingPayload = null;
            }

            bool screenReady = Bootstrap == null || (Bootstrap.InGame && !Bootstrap.FrontendVisible);
            bool show = Time.unscaledTime < _visibleUntil
                && screenReady
                && !RoaGameBootstrap.BlocksWorldHud;
            if (_root.activeSelf != show) _root.SetActive(show);
        }

        private void Show(JObject payload)
        {
            string locationId = payload?["locationId"]?.ToString() ?? "settlement";
            string locationName = Bootstrap?.Loader?.GetDefinition(locationId)?.Name;
            if (string.IsNullOrEmpty(locationName)) locationName = locationId;
            _title.text = "ВЫ ВЕРНУЛИСЬ · " + locationName.ToUpperInvariant();
            _cause.text = CauseText(payload);
            _state.text = StateText(payload);
            _state.color = payload?["cause"]?["fullDrop"]?.ToObject<bool>() == true ? Danger : Safe;
            _next.text = NextText(payload);
            _visibleUntil = Time.unscaledTime + 18f;
            _root.SetActive(true);
        }

        public static string CauseText(JObject payload)
        {
            JObject cause = payload?["cause"] as JObject ?? new JObject();
            if (cause["selfExplosion"]?.ToObject<bool>() == true)
                return "Собственный взрыв оказался смертельным.";
            string killer = cause["killerName"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(killer))
                return "Вас убил игрок: " + killer + ".";
            string enemy = cause["enemyName"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(enemy))
                return "Вас одолел противник: " + enemy + ".";
            return "Вы получили смертельное ранение.";
        }

        public static string StateText(JObject payload)
        {
            int hp = Mathf.Max(0, payload?["hp"]?.ToObject<int>() ?? 0);
            int maxHp = Mathf.Max(1, payload?["maxHp"]?.ToObject<int>() ?? 1);
            int percent = Mathf.Clamp(Mathf.RoundToInt(hp * 100f / maxHp), 0, 100);
            JObject cause = payload?["cause"] as JObject ?? new JObject();
            if (cause["fullDrop"]?.ToObject<bool>() == true)
            {
                int dropped = cause["droppedItems"] is JArray rows ? rows.Count : 0;
                string loss = dropped > 0
                    ? "Содержимое рюкзака осталось на месте гибели: " + dropped + " поз."
                    : "Рюкзак был пуст — терять было нечего.";
                return "Здоровье восстановлено до " + percent + "%. " + loss;
            }
            return "Здоровье восстановлено до " + percent + "%. Рюкзак и экипировка сохранены.";
        }

        public static string NextText(JObject payload)
        {
            int failed = payload?["failedWorldActivityIds"] is JArray failedRows ? failedRows.Count : 0;
            string reason = payload?["activityResult"]?["reason"]?.ToString() ?? string.Empty;
            if (failed > 0 || reason == "player_died")
                return "Личная вылазка провалена. Выйдите на живую карту и выберите новое событие.";
            int detached = payload?["detachedWorldTaskIds"] is JArray detachedRows ? detachedRows.Count : 0;
            if (detached > 0)
                return "Вы покинули групповую задачу. Новый маршрут можно выбрать на живой карте.";
            return "Вы восстановились в безопасном поселении и можете продолжить путь.";
        }

        private void Close()
        {
            _visibleUntil = 0f;
            if (_root != null) _root.SetActive(false);
        }

        private void EnsureBuilt()
        {
            if (_canvas != null) return;
            var canvasGo = new GameObject("RecoveryCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 36;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _safeRoot = Rect("SafeArea", canvasGo.transform, Vector2.zero, Vector2.one,
                             new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero);
            RectTransform panel = Rect("RecoveryPanel", _safeRoot, new Vector2(0.5f, 0.5f),
                                       new Vector2(0.5f, 0.5f), new Vector2(0f, 70f),
                                       new Vector2(610f, 204f));
            _root = panel.gameObject;
            Image background = panel.gameObject.AddComponent<Image>();
            background.color = Panel;
            background.raycastTarget = false;
            Outline outline = panel.gameObject.AddComponent<Outline>();
            outline.effectColor = Border;
            outline.effectDistance = new Vector2(1f, -1f);

            _title = Label("Title", panel, 14, FontStyle.Bold, TextAnchor.MiddleLeft, Danger);
            Place(_title.rectTransform, 18f, -34f, -110f, -8f);
            _cause = Label("Cause", panel, 15, FontStyle.Bold, TextAnchor.MiddleLeft, Ink);
            Place(_cause.rectTransform, 18f, -70f, -18f, -39f);
            _state = Label("State", panel, 12, FontStyle.Normal, TextAnchor.UpperLeft, Safe);
            _state.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_state.rectTransform, 18f, -116f, -18f, -76f);
            _next = Label("Next", panel, 12, FontStyle.Normal, TextAnchor.UpperLeft, Muted);
            _next.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_next.rectTransform, 18f, -164f, -120f, -120f);
            Button close = UiButton("Continue", panel, "ПРОДОЛЖИТЬ", Close);
            Place((RectTransform)close.transform, 478f, -185f, -16f, -153f);

            UpdateSafeArea(true);
            _root.SetActive(false);
        }

        private void UpdateSafeArea(bool force = false)
        {
            if (_safeRoot == null) return;
            Rect area = Screen.safeArea;
            if (!force && area == _lastSafeArea) return;
            _lastSafeArea = area;
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
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchor, Vector2 pivot,
                                          Vector2 position, Vector2 size)
        {
            return Rect(name, parent, anchor, anchor, pivot, position, size);
        }

        private static RectTransform Rect(string name, Transform parent, Vector2 anchorMin,
                                          Vector2 anchorMax, Vector2 pivot,
                                          Vector2 position, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.pivot = pivot;
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            return rect;
        }

        private static Text Label(string name, Transform parent, int size, FontStyle style,
                                  TextAnchor alignment, Color color)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Text text = rect.gameObject.AddComponent<Text>();
            text.font = RoaUiFont.Default;
            text.fontSize = size;
            text.fontStyle = style;
            text.alignment = alignment;
            text.color = color;
            text.raycastTarget = false;
            return text;
        }

        private static Button UiButton(string name, Transform parent, string caption,
                                       UnityEngine.Events.UnityAction action)
        {
            RectTransform rect = Rect(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            Image image = rect.gameObject.AddComponent<Image>();
            image.color = new Color(0.18f, 0.20f, 0.12f, 0.98f);
            Button button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = image;
            button.onClick.AddListener(action);
            Text label = Label("Label", rect, 11, FontStyle.Bold, TextAnchor.MiddleCenter, Ink);
            label.text = caption;
            label.rectTransform.anchorMax = Vector2.one;
            label.rectTransform.sizeDelta = Vector2.zero;
            return button;
        }

        private static void Place(RectTransform rect, float left, float bottomY, float right, float topY)
        {
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(1f, 1f);
            rect.offsetMin = new Vector2(left, bottomY);
            rect.offsetMax = new Vector2(right, topY);
        }
    }
}
