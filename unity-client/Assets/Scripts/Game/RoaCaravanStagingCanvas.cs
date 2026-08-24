using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Компактный HUD караванной активности. До старта показывает минутный сбор,
    /// после старта сопровождает прикрепленного игрока на глобальной карте:
    /// маршрут, расчетное время, груз, охрану и живую угрозу симуляции.
    /// </summary>
    public sealed class RoaCaravanStagingCanvas : MonoBehaviour
    {
        public RoaPipboy Pipboy;
        public RoaGameBootstrap Bootstrap;

        // Палитра .ui-panel / 20_caravan_staging_window.css.
        private static readonly Color PanelBg = new Color(0.047f, 0.043f, 0.035f, 0.94f);
        private static readonly Color PanelBorder = new Color(0.682f, 0.545f, 0.282f, 0.45f);
        private static readonly Color Ink = new Color(0.847f, 0.824f, 0.753f, 1f);            // #d8d2c0
        private static readonly Color NameInk = new Color(0.937f, 0.816f, 0.471f, 1f);        // #efd078
        private static readonly Color RouteInk = new Color(0.604f, 0.659f, 0.541f, 1f);       // #9aa88a
        private static readonly Color TimerLabelInk = new Color(0.49f, 0.545f, 0.408f, 1f);   // #7d8b68
        private static readonly Color UrgentInk = new Color(1f, 0.604f, 0.329f, 1f);          // #ff9a54
        private static readonly Color RosterInk = new Color(0.725f, 0.753f, 0.659f, 1f);      // #b9c0a8
        private static readonly Color TimerBg = new Color(0.02f, 0.018f, 0.015f, 1f);
        private static readonly Color TimerBorder = new Color(0.682f, 0.545f, 0.282f, 0.35f);
        private static readonly Color LeaveBg = new Color(0.157f, 0.086f, 0.071f, 1f);        // rgba(40,22,18)
        private static readonly Color LeaveBorder = new Color(0.682f, 0.376f, 0.282f, 0.5f);

        private Canvas _canvas;
        private GameObject _root;
        private Text _title, _site, _name, _route, _timerLabel, _timer, _roster, _leaveLabel;
        private Button _leave;
        private float _refreshAt;
        private string _taskId = string.Empty;

        public bool IsOpen { get { return _root != null && _root.activeSelf; } }

        private void Update()
        {
            Pipboy?.EnsureWorldData();
            JObject task = Pipboy != null ? Pipboy.ActiveEscortTask : null;
            JObject details = task?["details"] as JObject;
            JObject party = Pipboy != null ? Pipboy.WorldParty(task?["partyId"]?.ToString()) : null;
            bool staging = party != null
                ? party["state"]?.ToString() == "staging"
                : details?["staging"]?.ToObject<bool>() == true && details["joinClosed"]?.ToObject<bool>() != true;
            bool onGlobalMap = Bootstrap != null && Bootstrap.OnGlobalMap;
            bool hide = task == null || (Bootstrap != null && Bootstrap.FrontendVisible)
                || (!staging && !onGlobalMap);
            if (hide)
            {
                if (_root != null && _root.activeSelf) _root.SetActive(false);
                _taskId = string.Empty;
                return;
            }
            EnsureBuilt();
            if (!_root.activeSelf) { _root.SetActive(true); _refreshAt = 0f; }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 1f; // web обновляет раз в секунду
            Refresh(task, party, staging);
        }

        private void Refresh(JObject task, JObject party, bool staging)
        {
            JObject details = task["details"] as JObject ?? new JObject();
            _taskId = task["id"]?.ToString() ?? string.Empty;
            if (!staging)
            {
                RefreshLiveRaid(task, party, details);
                return;
            }
            _title.text = "СБОР КАРАВАНА";
            _timerLabel.text = "ДО ВЫХОДА";
            _site.text = Pipboy.SiteName(task["siteId"]?.ToString());
            _name.text = task["title"]?.ToString() ?? "Караван ждет сопровождение";
            string from = Pipboy.SiteName(details["stagingSiteId"]?.ToString());
            string to = Pipboy.SiteName(details["destinationSiteId"]?.ToString());
            _route.text = !string.IsNullOrEmpty(from) || !string.IsNullOrEmpty(to)
                ? "Погрузка: " + (string.IsNullOrEmpty(from) ? "в пути" : from) + (string.IsNullOrEmpty(to) ? string.Empty : " → " + to)
                : string.Empty;
            float? seconds = Pipboy.StagingSeconds(task);
            bool leaving = !seconds.HasValue || seconds.Value <= 0f;
            _timer.text = leaving ? "выходит" : RoaPipboy.CountdownText(seconds.Value);
            _timer.color = !leaving && seconds.Value <= 10f ? UrgentInk : NameInk;
            int joined = Mathf.Max(0, Mathf.RoundToInt(details["playerCount"]?.ToObject<float>() ?? 0f));
            int limit = Mathf.Max(0, Mathf.RoundToInt(details["playerLimit"]?.ToObject<float>() ?? 0f));
            _roster.text = limit > 0
                ? "В очереди: " + joined + " из " + limit + ". Караван выйдет с теми, кто успел записаться."
                : "В очереди: " + joined + ". Караван выйдет с теми, кто успел записаться.";
            _leave.interactable = !Pipboy.ActionPending;
            _leaveLabel.color = _leave.interactable ? Ink : new Color(Ink.r, Ink.g, Ink.b, 0.5f);
            _leaveLabel.text = "Выйти из очереди";
        }

        private void RefreshLiveRaid(JObject task, JObject party, JObject details)
        {
            _title.text = "КАРАВАН В ПУТИ";
            _timerLabel.text = "ДО ПРИБЫТИЯ";
            _name.text = task["title"]?.ToString() ?? party?["name"]?.ToString() ?? "Сопровождение каравана";
            string from = Pipboy.SiteName(party?["homeSiteId"]?.ToString() ?? details["stagingSiteId"]?.ToString());
            string to = Pipboy.SiteName(party?["destinationSiteId"]?.ToString() ?? details["destinationSiteId"]?.ToString());
            _route.text = (string.IsNullOrEmpty(from) ? "Маршрут" : from)
                + (string.IsNullOrEmpty(to) ? string.Empty : " → " + to);
            string state = party?["state"]?.ToString() ?? "moving";
            int risk = Mathf.Clamp(party?["riskLevel"]?.ToObject<int>() ?? 0, 0, 100);
            _site.text = state == "engaged" ? "бой" : risk >= 55 ? "опасный маршрут" : "маршрут";
            float? seconds = CaravanSecondsLeft(party);
            _timer.text = state == "engaged" ? "БОЙ"
                : seconds.HasValue ? RoaPipboy.CountdownText(seconds.Value) : "--:--";
            _timer.color = state == "engaged" || risk >= 55 ? UrgentInk : NameInk;
            int cargo = Mathf.Max(0, party?["cargoFillPercent"]?.ToObject<int>() ?? 0);
            int guards = Mathf.Max(0, party?["npcMemberCount"]?.ToObject<int>() ?? 0);
            int initial = Mathf.Max(guards, details["initialNpcMembers"]?.ToObject<int>() ?? guards);
            int players = Mathf.Max(0, party?["playerMemberCount"]?.ToObject<int>() ?? details["playerCount"]?.ToObject<int>() ?? 0);
            string threat = party?["threatName"]?.ToString() ?? string.Empty;
            float threatKm = Mathf.Max(0f, party?["threatDistanceKm"]?.ToObject<float>() ?? 0f);
            _roster.text = "Груз: " + cargo + "% · охрана: " + guards + "/" + initial + " · игроков: " + players
                + (risk > 0 ? "\nРиск " + risk + "%" + (!string.IsNullOrEmpty(threat) ? ": " + threat + " · " + threatKm.ToString("0.0") + " км" : string.Empty) : string.Empty);
            _leave.interactable = !Pipboy.ActionPending;
            _leaveLabel.color = _leave.interactable ? Ink : new Color(Ink.r, Ink.g, Ink.b, 0.5f);
            _leaveLabel.text = "Покинуть караван";
        }

        private float? CaravanSecondsLeft(JObject party)
        {
            if (party == null || Bootstrap?.GlobalMap == null || Pipboy?.Wasteland == null) return null;
            string destinationId = party["destinationSiteId"]?.ToString() ?? string.Empty;
            JObject destination = null;
            foreach (JToken token in Pipboy.Wasteland["sites"] as JArray ?? new JArray())
                if (token?["id"]?.ToString() == destinationId) { destination = token as JObject; break; }
            if (destination == null) return null;
            Vector2 current = new Vector2(party["x"]?.ToObject<float>() ?? 0f, party["y"]?.ToObject<float>() ?? 0f);
            Vector2 target = new Vector2(destination["x"]?.ToObject<float>() ?? 0f, destination["y"]?.ToObject<float>() ?? 0f);
            float worldHours = Bootstrap.GlobalMap.DistanceKm(current, target) / Mathf.Max(1f, party["speedKmh"]?.ToObject<float>() ?? 1f);
            float dayRealMs = Mathf.Max(60000f, Pipboy.Wasteland["gameDayRealMs"]?.ToObject<float>() ?? 60f * 60f * 1000f);
            return Mathf.Max(0f, worldHours / 24f * dayRealMs / 1000f);
        }

        private void EnsureBuilt()
        {
            if (_root != null) return;
            var canvasGo = new GameObject("CaravanStagingCanvas", typeof(RectTransform), typeof(Canvas),
                                          typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 31; // над HUD (30), под PIP-ASH (40)
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            RoaUiScale.Apply(scaler);

            // #caravan-staging-window: top 84px, центр по X, ширина 320, padding 12/14.
            _root = new GameObject("CaravanStagingWindow", typeof(RectTransform));
            var root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0.5f, 1f);
            root.pivot = new Vector2(0.5f, 1f);
            root.anchoredPosition = new Vector2(0f, -84f);
            root.sizeDelta = new Vector2(320f, 178f);
            var bg = _root.AddComponent<Image>();
            bg.color = PanelBg;
            var border = _root.AddComponent<Outline>();
            border.effectColor = PanelBorder;
            border.effectDistance = new Vector2(1f, -1f);

            float y = -12f;
            // .panel-title «Сбор каравана <small>площадка</small>».
            _title = Label("Title", root, 11, TextAnchor.MiddleLeft, NameInk, FontStyle.Bold);
            _title.text = "СБОР КАРАВАНА";
            Place(_title.rectTransform, 14f, y - 14f, -14f, y);
            _site = Label("Site", root, 10, TextAnchor.MiddleRight, RouteInk);
            Place(_site.rectTransform, 120f, y - 14f, -14f, y);
            y -= 18f;

            _name = Label("Name", root, 13, TextAnchor.UpperLeft, NameInk);
            Place(_name.rectTransform, 14f, y - 17f, -14f, y);
            y -= 19f;
            _route = Label("Route", root, 11, TextAnchor.UpperLeft, RouteInk);
            Place(_route.rectTransform, 14f, y - 15f, -14f, y);
            y -= 23f;

            // .caravan-staging-timer-row
            RectTransform timerRow = Child("TimerRow", root);
            Place(timerRow, 14f, y - 34f, -14f, y);
            var timerBg = timerRow.gameObject.AddComponent<Image>();
            timerBg.color = TimerBg;
            var timerBorder = timerRow.gameObject.AddComponent<Outline>();
            timerBorder.effectColor = TimerBorder;
            timerBorder.effectDistance = new Vector2(1f, -1f);
            _timerLabel = Label("TimerLabel", timerRow, 10, TextAnchor.MiddleLeft, TimerLabelInk);
            _timerLabel.text = "ДО ВЫХОДА";
            Place(_timerLabel.rectTransform, 8f, -34f, -90f, 0f);
            _timer = Label("Timer", timerRow, 20, TextAnchor.MiddleRight, NameInk);
            _timer.text = "--:--";
            Place(_timer.rectTransform, 100f, -34f, -8f, 0f);
            y -= 42f;

            _roster = Label("Roster", root, 11, TextAnchor.UpperLeft, RosterInk);
            _roster.horizontalOverflow = HorizontalWrapMode.Wrap;
            Place(_roster.rectTransform, 14f, y - 30f, -14f, y);
            y -= 38f;

            // .caravan-staging-leave: во всю ширину.
            var leaveGo = new GameObject("Btn:Выйти из очереди", typeof(RectTransform));
            var leaveRect = (RectTransform)leaveGo.transform;
            leaveRect.SetParent(root, false);
            Place(leaveRect, 14f, y - 26f, -14f, y);
            var leaveImage = leaveGo.AddComponent<Image>();
            leaveImage.color = LeaveBg;
            var leaveBorder = leaveGo.AddComponent<Outline>();
            leaveBorder.effectColor = LeaveBorder;
            leaveBorder.effectDistance = new Vector2(1f, -1f);
            _leave = leaveGo.AddComponent<Button>();
            _leave.targetGraphic = leaveImage;
            _leaveLabel = Label("Label", leaveRect, 11, TextAnchor.MiddleCenter, Ink);
            _leaveLabel.text = "Выйти из очереди";
            Stretch(_leaveLabel.rectTransform, 2f);
            _leave.onClick.AddListener(() =>
            {
                if (!string.IsNullOrEmpty(_taskId)) Pipboy.CancelWorldTask(_taskId);
                _refreshAt = 0f;
            });
        }

        private static RectTransform Child(string name, RectTransform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            return rect;
        }

        /// <summary>Размещение по верхней кромке родителя: left/right — отступы, bottomY/topY — отрицательные смещения вниз от верха.</summary>
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
