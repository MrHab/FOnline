using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Главный экран коротких активностей. Показывает по одной актуальной работе
    /// каждого типа прямо на глобальной карте, принимает локальные вылазки без
    /// старой доски и передает движение существующему серверному маршруту.
    /// </summary>
    public sealed class RoaActivityHubCanvas : MonoBehaviour
    {
        private static readonly string[] Kinds =
        {
            "escort_caravan",
            "distress_signal",
            "recon_expedition",
            "resource_expedition",
            "outpost_defense",
            "assault_diversion"
        };

        private static readonly Color Backdrop = new Color(0.012f, 0.018f, 0.014f, 0.76f);
        private static readonly Color PanelBg = new Color(0.035f, 0.055f, 0.039f, 0.98f);
        private static readonly Color CardBg = new Color(0.045f, 0.075f, 0.052f, 1f);
        private static readonly Color Border = new Color(0.56f, 0.69f, 0.31f, 0.48f);
        private static readonly Color Ink = new Color(0.86f, 0.85f, 0.76f, 1f);
        private static readonly Color Muted = new Color(0.58f, 0.67f, 0.54f, 1f);
        private static readonly Color Accent = new Color(0.94f, 0.78f, 0.34f, 1f);
        private static readonly Color Safe = new Color(0.48f, 0.78f, 0.38f, 1f);
        private static readonly Color Danger = new Color(0.94f, 0.38f, 0.22f, 1f);
        private static readonly Color ButtonBg = new Color(0.20f, 0.25f, 0.105f, 1f);

        public RoaGameBootstrap Bootstrap;
        public RoaGlobalMap Map;
        public RoaInteraction Interaction;

        private Canvas _canvas;
        private GameObject _root;
        private GameObject _launcher;
        private GameObject _shade;
        private RectTransform _grid;
        private Text _message;
        private readonly List<GameObject> _cards = new List<GameObject>();
        private bool _expanded = true;
        private bool _wasVisible;
        private float _refreshAt;

        private void Update()
        {
            bool visible = Bootstrap != null && Bootstrap.OnGlobalMap && Map != null && Map.IsActive;
            if (!visible)
            {
                if (_canvas != null && _canvas.gameObject.activeSelf) _canvas.gameObject.SetActive(false);
                _wasVisible = false;
                return;
            }

            EnsureBuilt();
            if (!_canvas.gameObject.activeSelf) _canvas.gameObject.SetActive(true);
            if (!_wasVisible)
            {
                _wasVisible = true;
                _expanded = true;
                _refreshAt = 0f;
            }
            _root.SetActive(_expanded);
            _shade.SetActive(_expanded);
            _launcher.SetActive(!_expanded);
            if (!_expanded || Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.75f;
            RefreshCards();
        }

        private void RefreshCards()
        {
            foreach (GameObject card in _cards) Destroy(card);
            _cards.Clear();

            List<JObject> tasks = CollectPriorityTasks();
            if (tasks.Count == 0) AddCard(Kinds[0], null);
            else foreach (JObject task in tasks) AddCard(task["type"]?.ToString() ?? string.Empty, task);
            Map.SetActivityHighlights(tasks);
        }

        private List<JObject> CollectPriorityTasks()
        {
            var rows = new List<JObject>();
            foreach (string kind in Kinds)
            {
                JObject task = PickTask(kind);
                if (task != null) rows.Add(task);
            }
            rows.Sort((left, right) =>
            {
                int byScore = TaskScore(right).CompareTo(TaskScore(left));
                if (byScore != 0) return byScore;
                return TaskDistance(left).CompareTo(TaskDistance(right));
            });
            if (rows.Count > 3) rows.RemoveRange(3, rows.Count - 3);
            return rows;
        }

        private double TaskScore(JObject task)
        {
            string id = task?["id"]?.ToString() ?? string.Empty;
            bool accepted = Interaction != null && Interaction.IsWorldTaskAccepted(id);
            bool tracked = Interaction != null && Interaction.IsWorldTaskTracked(id);
            double score = accepted ? 2000000d : 0d;
            score += tracked ? 1000000d : 0d;
            score += (task?["priority"]?.ToObject<double>() ?? 0d) * 20000d;
            score -= TaskDistance(task) * 120d;

            double now = Map?.WastelandState?["sim"]?["worldHour"]?.ToObject<double>() ?? double.NaN;
            double expires = task?["expiresHour"]?.ToObject<double>() ?? double.NaN;
            if (!double.IsNaN(now) && !double.IsNaN(expires))
                score += Math.Max(0d, 8d - Math.Max(0d, expires - now)) * 15000d;
            return score;
        }

        private float TaskDistance(JObject task)
        {
            JToken x = task?["targetX"] ?? task?["details"]?["x"];
            JToken y = task?["targetY"] ?? task?["details"]?["y"];
            if (x == null || y == null || x.Type == JTokenType.Null || y.Type == JTokenType.Null)
                return 9999f;
            Vector2 point = new Vector2(x.ToObject<float>(), y.ToObject<float>());
            return Map != null ? Map.DistanceKm(Map.PlayerXY, point) : 9999f;
        }

        private JObject PickTask(string kind)
        {
            JArray rows = Map?.WastelandState?["worldActivities"] as JArray
                ?? Map?.WastelandState?["worldTasks"] as JArray
                ?? new JArray();
            JObject best = null;
            double bestScore = double.MinValue;
            foreach (JToken token in rows)
            {
                JObject task = token as JObject;
                if (task == null || task["status"]?.ToString() != "active"
                    || task["type"]?.ToString() != kind) continue;
                string id = task["id"]?.ToString() ?? string.Empty;
                double score = TaskScore(task);
                if (score <= bestScore) continue;
                best = task;
                bestScore = score;
            }
            return best;
        }

        private void AddCard(string kind, JObject task)
        {
            var card = new GameObject("Activity:" + kind, typeof(RectTransform), typeof(Image), typeof(Outline), typeof(LayoutElement));
            card.transform.SetParent(_grid, false);
            card.GetComponent<Image>().color = CardBg;
            var outline = card.GetComponent<Outline>();
            outline.effectColor = task == null ? new Color(Border.r, Border.g, Border.b, 0.20f) : Border;
            outline.effectDistance = new Vector2(1f, -1f);
            card.GetComponent<LayoutElement>().preferredWidth = 342f;
            card.GetComponent<LayoutElement>().preferredHeight = 92f;
            RectTransform rect = (RectTransform)card.transform;

            Text kicker = Label("Kind", rect, 10, TextAnchor.MiddleLeft, KindColor(kind), FontStyle.Bold);
            kicker.text = KindLabel(kind).ToUpperInvariant();
            Place(kicker.rectTransform, 10f, -20f, -10f, -5f);

            if (task == null)
            {
                Text empty = Label("Empty", rect, 12, TextAnchor.UpperLeft, Muted);
                empty.text = "Сейчас подходящей цели нет.\nСигналы обновляются вместе с живым миром.";
                empty.horizontalOverflow = HorizontalWrapMode.Wrap;
                Place(empty.rectTransform, 10f, -58f, -10f, -25f);
                Text wait = Label("Wait", rect, 10, TextAnchor.MiddleLeft, new Color(Muted.r, Muted.g, Muted.b, 0.65f));
                wait.text = "ОЖИДАНИЕ НОВОГО СОБЫТИЯ";
                Place(wait.rectTransform, 10f, -84f, -10f, -63f);
                _cards.Add(card);
                return;
            }

            string id = task["id"]?.ToString() ?? string.Empty;
            bool accepted = Interaction != null && Interaction.IsWorldTaskAccepted(id);
            bool tracked = Interaction != null && Interaction.IsWorldTaskTracked(id);
            string siteId = task["siteId"]?.ToString() ?? string.Empty;
            string issuerId = task["issuerSiteId"]?.ToString() ?? siteId;
            string target = task["targetSiteName"]?.ToString() ?? siteId;

            Text title = Label("Title", rect, 12, TextAnchor.UpperLeft, Ink, FontStyle.Bold);
            title.text = task["title"]?.ToString() ?? KindLabel(kind);
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place(title.rectTransform, 10f, -42f, -10f, -22f);

            Text details = Label("Details", rect, 10, TextAnchor.UpperLeft, Muted);
            details.text = target + DistanceText(task) + "\n" + GoalText(kind);
            details.horizontalOverflow = HorizontalWrapMode.Wrap;
            details.verticalOverflow = VerticalWrapMode.Truncate;
            details.text = target + DistanceText(task) + " · " + RiskLabel(task) + "\n" + GoalText(kind);
            Place(details.rectTransform, 10f, -65f, -112f, -41f);

            JObject reward = task["reward"] as JObject;
            Text rewardText = Label("Reward", rect, 10, TextAnchor.MiddleLeft, accepted ? Safe : Accent);
            rewardText.text = (tracked ? "МЕТКА · " : accepted ? "ПРИНЯТО · " : string.Empty)
                + (reward?["xp"]?.ToObject<int>() ?? 0) + " XP · "
                + (reward?["caps"]?.ToObject<int>() ?? 0) + " крышек";
            Place(rewardText.rectTransform, 10f, -87f, -116f, -67f);

            string caption = ActionLabel(kind, accepted, siteId, issuerId);
            bool enabled = Interaction != null && !Interaction.WorldTaskActionPending && !Map.TravelActive
                && !(kind == "escort_caravan" && accepted);
            Button action = Button(rect, caption, () => Activate(task));
            Place((RectTransform)action.transform, 232f, -86f, -10f, -61f);
            SetButton(action, enabled);
            _cards.Add(card);
        }

        private string ActionLabel(string kind, bool accepted, string siteId, string issuerId)
        {
            if (Map.TravelActive) return "В ПУТИ";
            if (kind == "escort_caravan")
            {
                if (accepted) return "В КАРАВАНЕ";
                return Map.PlayerAtWorldSite(issuerId) ? "ВСТУПИТЬ" : "К СБОРУ";
            }
            if (!accepted) return "ВЗЯТЬ И ЕХАТЬ";
            return Map.PlayerAtWorldSite(siteId) ? "ВОЙТИ" : "ЕХАТЬ";
        }

        private void Activate(JObject task)
        {
            if (task == null || Interaction == null || Map == null) return;
            string id = task["id"]?.ToString() ?? string.Empty;
            string kind = task["type"]?.ToString() ?? string.Empty;
            string siteId = task["siteId"]?.ToString() ?? string.Empty;
            string issuerId = task["issuerSiteId"]?.ToString() ?? siteId;
            bool accepted = Interaction.IsWorldTaskAccepted(id);

            if (kind == "escort_caravan" && !accepted && !Map.PlayerAtWorldSite(issuerId))
            {
                SetMessage("Строим маршрут к месту сбора каравана…", Accent);
                Map.RequestTravelToWorldSite(issuerId);
                return;
            }

            if (!accepted)
            {
                SetMessage(kind == "escort_caravan" ? "Записываемся в сопровождение…" : "Принимаем вылазку…", Accent);
                Interaction.SubmitWorldTaskAction(id, "accept", ack =>
                {
                    if (ack?["ok"]?.ToObject<bool>() != true)
                    {
                        SetMessage(ack?["error"]?.ToString() ?? "Активность недоступна.", Danger);
                        return;
                    }
                    SetMessage(kind == "escort_caravan" ? "Вы в группе каравана." : "Вылазка принята. Маршрут построен.", Safe);
                    if (kind != "escort_caravan") TravelTo(task);
                    _refreshAt = 0f;
                });
                return;
            }

            if (!Interaction.IsWorldTaskTracked(id))
            {
                Interaction.SubmitWorldTaskAction(id, "track", ack =>
                {
                    if (ack?["ok"]?.ToObject<bool>() == true) TravelTo(task);
                    else SetMessage(ack?["error"]?.ToString() ?? "Не удалось отметить цель.", Danger);
                    _refreshAt = 0f;
                });
                return;
            }
            TravelTo(task);
        }

        private void TravelTo(JObject task)
        {
            string siteId = task?["siteId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(siteId) || !Map.RequestTravelToWorldSite(siteId))
            {
                SetMessage("Не удалось построить маршрут к этой точке.", Danger);
                return;
            }
            if (Map.PlayerAtWorldSite(siteId))
            {
                SetMessage("Входим в район активности…", Safe);
                Map.EnterCurrent();
            }
            else SetMessage("Маршрут к активности начат.", Safe);
        }

        private string DistanceText(JObject task)
        {
            float distance = TaskDistance(task);
            return distance >= 9999f ? string.Empty : " · " + distance.ToString("0.0") + " км";
        }

        private static string RiskLabel(JObject task)
        {
            string kind = task?["type"]?.ToString() ?? string.Empty;
            int priority = task?["priority"]?.ToObject<int>() ?? 0;
            if (kind == "distress_signal" || kind == "outpost_defense"
                || kind == "assault_diversion" || priority >= 5) return "высокий риск";
            if (kind == "recon_expedition" || priority >= 3) return "средний риск";
            return "низкий риск";
        }

        private void SetMessage(string value, Color color)
        {
            if (_message == null) return;
            _message.text = value ?? string.Empty;
            _message.color = color;
        }

        private void EnsureBuilt()
        {
            if (_canvas != null) return;
            var canvasGo = new GameObject("ActivityHubCanvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            _canvas = canvasGo.GetComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 36;
            RoaUiScale.Apply(canvasGo.GetComponent<CanvasScaler>());

            _launcher = new GameObject("OpenActivities", typeof(RectTransform), typeof(Image), typeof(Button), typeof(Outline));
            RectTransform launcher = (RectTransform)_launcher.transform;
            launcher.SetParent(canvasGo.transform, false);
            launcher.anchorMin = launcher.anchorMax = new Vector2(0f, 1f);
            launcher.pivot = new Vector2(0f, 1f);
            launcher.anchoredPosition = new Vector2(18f, -64f);
            launcher.sizeDelta = new Vector2(210f, 38f);
            _launcher.GetComponent<Image>().color = ButtonBg;
            _launcher.GetComponent<Outline>().effectColor = Border;
            _launcher.GetComponent<Button>().onClick.AddListener(() => { _expanded = true; _refreshAt = 0f; });
            Text launcherLabel = Label("Label", launcher, 12, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            launcherLabel.text = "СИГНАЛЫ ПУСТОШИ";
            Stretch(launcherLabel.rectTransform, 2f);

            _shade = new GameObject("ActivityHubShade", typeof(RectTransform), typeof(Image));
            RectTransform shadeRect = (RectTransform)_shade.transform;
            shadeRect.SetParent(canvasGo.transform, false);
            shadeRect.anchorMin = Vector2.zero;
            shadeRect.anchorMax = Vector2.one;
            shadeRect.offsetMin = Vector2.zero;
            shadeRect.offsetMax = Vector2.zero;
            _shade.GetComponent<Image>().color = Color.clear;
            _shade.GetComponent<Image>().raycastTarget = false;

            _root = new GameObject("ActivityHub", typeof(RectTransform), typeof(Image), typeof(Outline));
            RectTransform root = (RectTransform)_root.transform;
            root.SetParent(canvasGo.transform, false);
            root.anchorMin = root.anchorMax = new Vector2(0f, 1f);
            root.pivot = new Vector2(0f, 1f);
            root.anchoredPosition = new Vector2(18f, -64f);
            root.sizeDelta = new Vector2(370f, 414f);
            _root.GetComponent<Image>().color = PanelBg;
            _root.GetComponent<Outline>().effectColor = Border;

            Text title = Label("Title", root, 19, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            title.text = "СЕЙЧАС РЯДОМ";
            Place(title.rectTransform, 14f, -35f, -54f, -8f);
            Text subtitle = Label("Subtitle", root, 11, TextAnchor.MiddleLeft, Muted);
            subtitle.text = "Три приоритетных сигнала живого мира";
            Place(subtitle.rectTransform, 14f, -57f, -54f, -37f);

            Button close = Button(root, "×", () => _expanded = false);
            Place((RectTransform)close.transform, 329f, -40f, -10f, -10f);

            var gridGo = new GameObject("ActivityGrid", typeof(RectTransform), typeof(GridLayoutGroup));
            _grid = (RectTransform)gridGo.transform;
            _grid.SetParent(root, false);
            Place(_grid, 14f, -358f, -14f, -68f);
            GridLayoutGroup grid = gridGo.GetComponent<GridLayoutGroup>();
            grid.cellSize = new Vector2(342f, 92f);
            grid.spacing = new Vector2(0f, 7f);
            grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            grid.constraintCount = 1;
            grid.startAxis = GridLayoutGroup.Axis.Horizontal;

            _message = Label("Message", root, 11, TextAnchor.MiddleLeft, Muted);
            _message.text = "Активности обновляются вместе с состоянием пустоши.";
            _message.text = "Выберите сигнал — цель станет маршрутом.";
            Place(_message.rectTransform, 14f, -402f, -14f, -368f);
        }

        private static string KindLabel(string kind)
        {
            switch (kind)
            {
                case "escort_caravan": return "Караван";
                case "distress_signal": return "Сигнал бедствия";
                case "recon_expedition": return "Разведка";
                case "resource_expedition": return "Вылазка за ресурсами";
                case "outpost_defense": return "Защита аванпоста";
                case "assault_diversion": return "Штурм или диверсия";
                default: return "Активность";
            }
        }

        private static string GoalText(string kind)
        {
            switch (kind)
            {
                case "escort_caravan": return "Успеть к сбору и довести груз.";
                case "distress_signal": return "Найти маяк и пережить засаду.";
                case "recon_expedition": return "Проверить точки и эвакуироваться.";
                case "resource_expedition": return "Собрать ресурсы под растущей угрозой.";
                case "outpost_defense": return "Отразить усиливающиеся волны.";
                case "assault_diversion": return "Выбрать прямой бой или саботаж.";
                default: return string.Empty;
            }
        }

        private static Color KindColor(string kind)
        {
            switch (kind)
            {
                case "distress_signal": return Danger;
                case "outpost_defense": return new Color(1f, 0.56f, 0.22f, 1f);
                case "recon_expedition": return new Color(0.48f, 0.78f, 0.78f, 1f);
                case "resource_expedition": return Safe;
                default: return Accent;
            }
        }

        private static Button Button(RectTransform parent, string caption, Action clicked)
        {
            var go = new GameObject("Button:" + caption, typeof(RectTransform), typeof(Image), typeof(Button), typeof(Outline));
            RectTransform rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            Image image = go.GetComponent<Image>();
            image.color = ButtonBg;
            go.GetComponent<Outline>().effectColor = Border;
            Button button = go.GetComponent<Button>();
            button.targetGraphic = image;
            if (clicked != null) button.onClick.AddListener(() => clicked());
            Text label = Label("Label", rect, 10, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            label.text = caption;
            Stretch(label.rectTransform, 2f);
            return button;
        }

        private static void SetButton(Button button, bool enabled)
        {
            button.interactable = enabled;
            Image image = button.targetGraphic as Image;
            if (image != null) image.color = enabled ? ButtonBg : new Color(ButtonBg.r, ButtonBg.g, ButtonBg.b, 0.42f);
        }

        private static Text Label(string name, RectTransform parent, int size, TextAnchor anchor, Color color, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Text));
            RectTransform rect = (RectTransform)go.transform;
            rect.SetParent(parent, false);
            Text text = go.GetComponent<Text>();
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
    }
}
