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
    public sealed partial class RoaActivityHubCanvas : MonoBehaviour
    {
        private static readonly string[] Kinds =
        {
            "patrol_mission",
            "join_patrol",
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
        private Button _quickJoin;
        private Text _quickJoinLabel;
        private readonly List<GameObject> _cards = new List<GameObject>();
        private bool _expanded;
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
                PrepareHubForMap();
            }
            UpdateHubPresentation();
            UpdateLauncherPresentation();
            if (_quickJoin != null)
            {
                bool quickAvailable = Interaction != null && !Interaction.WorldTaskActionPending && !Map.TravelActive;
                SetButton(_quickJoin, quickAvailable);
                if (_quickJoinLabel != null) _quickJoinLabel.text = Interaction != null && Interaction.WorldTaskActionPending
                    ? "ПОДБИРАЕМ ВЫЛАЗКУ…"
                    : Map.TravelActive ? "МАРШРУТ УЖЕ ПОСТРОЕН" : "БЫСТРАЯ ВЫЛАЗКА";
            }
            if (Time.unscaledTime < _refreshAt) return;
            _refreshAt = Time.unscaledTime + 0.75f;
            List<JObject> tasks = CollectPriorityTasks();
            string signature = BuildVisibleCardSignature(tasks);
            if (!string.Equals(signature, _cardSignature, StringComparison.Ordinal))
                RefreshCards(tasks, signature);
        }

        private void RefreshCards(List<JObject> tasks, string signature)
        {
            foreach (GameObject card in _cards)
            {
                if (card == null) continue;
                card.SetActive(false);
                Destroy(card);
            }
            _cards.Clear();

            if (tasks.Count == 0) AddCard(Kinds[0], null);
            else foreach (JObject task in tasks) AddCard(task["type"]?.ToString() ?? string.Empty, task);
            _cardSignature = signature;
            _visibleTaskCount = tasks.Count;
            CardRebuildCount++;
            MarkActivityCardsRebuilt();
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
            if (ActiveHelpSignal(task) != null) score += 1500000d;
            score += (task?["priority"]?.ToObject<double>() ?? 0d) * 20000d;
            score -= TaskDistance(task) * 120d;

            JObject sim = Map?.WastelandState?["sim"] as JObject;
            double now = sim?["worldHour"]?.ToObject<double>() ?? double.NaN;
            double expires = task?["expiresHour"]?.ToObject<double>() ?? double.NaN;
            if (!double.IsNaN(now) && !double.IsNaN(expires))
                score += Math.Max(0d, 8d - Math.Max(0d, expires - now)) * 15000d;
            return score;
        }

        private float TaskDistance(JObject task)
        {
            JObject details = task?["details"] as JObject;
            JToken x = task?["targetX"] ?? details?["x"];
            JToken y = task?["targetY"] ?? details?["y"];
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
            card.GetComponent<LayoutElement>().preferredHeight = 140f;
            RectTransform rect = (RectTransform)card.transform;

            Text kicker = Label("Kind", rect, 10, TextAnchor.MiddleLeft, KindColor(kind), FontStyle.Bold);
            bool helpRequested = ActiveHelpSignal(task) != null;
            kicker.text = (helpRequested ? "НУЖНА ПОМОЩЬ · " : string.Empty) + KindLabel(kind).ToUpperInvariant();
            if (helpRequested) kicker.color = Danger;
            Place(kicker.rectTransform, 10f, -20f, -118f, -5f);

            if (task == null)
            {
                Text empty = Label("Empty", rect, 12, TextAnchor.UpperLeft, Muted);
                empty.text = "Сейчас подходящего контракта нет.\nДоска обновляется вместе с живым миром.";
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
            string target = kind == "escort_caravan"
                ? task["impactSiteName"]?.ToString() ?? task["targetSiteName"]?.ToString() ?? siteId
                : task["targetSiteName"]?.ToString() ?? siteId;
            if (IsPatrolMission(task))
                target = PatrolOperationTargetName(task, siteId);
            double worldHour = Map?.WastelandState?["worldHour"]?.ToObject<double>() ?? double.NaN;
            string deadline = RoaActivityHubPresentation.DeadlineLabel(task, worldHour);
            Text deadlineText = Label("Deadline", rect, 10, TextAnchor.MiddleRight,
                deadline == "истекает" || deadline == "меньше часа" ? Danger : Muted, FontStyle.Bold);
            deadlineText.text = deadline.ToUpperInvariant();
            Place(deadlineText.rectTransform, 226f, -20f, -10f, -5f);

            Text title = Label("Title", rect, 12, TextAnchor.UpperLeft, Ink, FontStyle.Bold);
            title.text = task["title"]?.ToString() ?? KindLabel(kind);
            title.verticalOverflow = VerticalWrapMode.Truncate;
            Place(title.rectTransform, 10f, -42f, -10f, -22f);

            Text details = Label("Details", rect, 10, TextAnchor.UpperLeft, Muted);
            details.horizontalOverflow = HorizontalWrapMode.Wrap;
            details.verticalOverflow = VerticalWrapMode.Truncate;
            details.text = target + DistanceText(task) + " · " + RiskLabel(task)
                + "\n" + LiveStageAndCause(task)
                + "\n" + (IsPatrolMission(task) ? PatrolOperationContext(task) : LiveRegionMetrics(task));
            Place(details.rectTransform, 10f, -103f, -10f, -41f);

            JObject reward = task["reward"] as JObject;
            Text rewardText = Label("Reward", rect, 10, TextAnchor.MiddleLeft, accepted ? Safe : Accent);
            rewardText.text = kind == "patrol_mission"
                ? "ВЕДЁТ: " + PatrolOperationLeader(task) + " · СТАТУС ОТРЯДА"
                : (tracked ? "МЕТКА · " : accepted ? "ПРИНЯТО · " : string.Empty)
                    + CommunityText(task) + " · "
                    + (reward?["xp"]?.ToObject<int>() ?? 0) + " XP · "
                    + (reward?["caps"]?.ToObject<int>() ?? 0) + " крышек";
            Place(rewardText.rectTransform, 10f, -135f, -116f, -107f);

            string caption = helpRequested && !accepted ? "ПРИЙТИ НА ПОМОЩЬ" : ActionLabel(kind, accepted, siteId, issuerId);
            bool patrolRouteAvailable = kind != "patrol_mission" || !string.IsNullOrEmpty(WorldTaskTargetSiteId(task));
            if (!patrolRouteAvailable) caption = "ДВИЖУЩАЯСЯ ЦЕЛЬ";
            bool patrolJoinAvailable = kind != "join_patrol" || accepted || task["actionMode"]?.ToString() == "join_party";
            string requiredPatrolFaction = task["joinPartyFaction"]?.ToString() ?? string.Empty;
            JObject playerState = Interaction != null ? Interaction.TradeSelf : null;
            string playerFaction = playerState?["worldFactionId"]?.ToString()
                ?? playerState?["factionId"]?.ToString() ?? string.Empty;
            bool patrolFactionAvailable = kind != "join_patrol" || accepted
                || string.IsNullOrEmpty(requiredPatrolFaction) || playerFaction == requiredPatrolFaction;
            if (kind == "join_patrol" && !accepted && !patrolJoinAvailable) caption = "НЕТ МЕСТ";
            else if (kind == "join_patrol" && !accepted && !patrolFactionAvailable) caption = "НУЖНА ФРАКЦИЯ";
            bool enabled = Interaction != null && !Interaction.WorldTaskActionPending && !Map.TravelActive
                && patrolRouteAvailable && patrolJoinAvailable && patrolFactionAvailable
                && !((kind == "escort_caravan" || kind == "join_patrol") && accepted);
            Button action = Button(rect, caption, () => Activate(task));
            Place((RectTransform)action.transform, 232f, -134f, -10f, -107f);
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
            if (kind == "join_patrol")
            {
                if (accepted) return "В ПАТРУЛЕ";
                return Map.PlayerAtWorldSite(issuerId) ? "ВСТУПИТЬ" : "К СБОРУ";
            }
            if (kind == "patrol_mission") return "К ЦЕЛИ";
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

            if (kind == "patrol_mission")
            {
                TravelTo(task);
                return;
            }

            if ((kind == "escort_caravan" || kind == "join_patrol") && !accepted && !Map.PlayerAtWorldSite(issuerId))
            {
                if (Map.RequestTravelToWorldSite(issuerId))
                {
                    SetMessage(kind == "escort_caravan"
                        ? "Маршрут к месту сбора каравана начат."
                        : "Маршрут к месту сбора патруля начат.", Safe);
                    SetExpanded(false);
                }
                else SetMessage("Не удалось построить маршрут к месту сбора.", Danger);
                return;
            }

            if (!accepted)
            {
                bool joiningParty = kind == "escort_caravan" || kind == "join_patrol";
                SetMessage(kind == "escort_caravan" ? "Записываемся в сопровождение…"
                    : kind == "join_patrol" ? "Присоединяемся к патрулю…" : "Принимаем вылазку…", Accent);
                Interaction.SubmitWorldTaskAction(id, "accept", ack =>
                {
                    if (ack?["ok"]?.ToObject<bool>() != true)
                    {
                        SetMessage(ack?["error"]?.ToString() ?? "Активность недоступна.", Danger);
                        return;
                    }
                    SetMessage(kind == "escort_caravan" ? "Вы в группе каравана."
                        : kind == "join_patrol" ? "Вы в группе патруля." : "Вылазка принята. Маршрут построен.", Safe);
                    if (!joiningParty) TravelTo(task);
                    InvalidateActivityCards();
                });
                return;
            }

            if (!Interaction.IsWorldTaskTracked(id))
            {
                Interaction.SubmitWorldTaskAction(id, "track", ack =>
                {
                    if (ack?["ok"]?.ToObject<bool>() == true) TravelTo(task);
                    else SetMessage(ack?["error"]?.ToString() ?? "Не удалось отметить цель.", Danger);
                    InvalidateActivityCards();
                });
                return;
            }
            TravelTo(task);
        }

        private void QuickJoin()
        {
            if (Interaction == null || Map == null || Interaction.WorldTaskActionPending || Map.TravelActive) return;
            SetMessage("Сервер ищет срочную вылазку и свободный временный отряд…", Accent);
            if (!Interaction.SubmitQuickWorldActivity(ack =>
            {
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    SetMessage(ack?["error"]?.ToString() ?? "Подходящая вылазка не найдена.", Danger);
                    return;
                }
                if (ack?["sim"] is JObject sim) Map.ApplyWastelandState(sim);
                JObject task = ack?["task"] as JObject;
                if (task == null)
                {
                    SetMessage("Вылазка принята, но её точка не найдена на карте.", Danger);
                    return;
                }
                bool rescue = ack?["joinSource"]?.ToString() == "help_signal";
                SetMessage(rescue
                    ? "Отряд запросил подкрепление. Строим маршрут к сигналу."
                    : "Временный отряд найден. Строим маршрут к вылазке.", rescue ? Danger : Safe);
                TravelTo(task);
                InvalidateActivityCards();
            })) SetMessage("Подбор уже выполняется.", Muted);
        }

        private void TravelTo(JObject task)
        {
            string siteId = WorldTaskTargetSiteId(task);
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
            else
            {
                SetMessage("Маршрут к активности начат.", Safe);
                SetExpanded(false);
            }
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

        private static string LiveStageAndCause(JObject task)
        {
            JObject details = task?["details"] as JObject;
            JObject liveEvent = task?["liveEvent"] as JObject ?? details?["liveEvent"] as JObject;
            JObject operation = WorldTaskOperation(task);
            JObject help = ActiveHelpSignal(task);
            if (help != null)
            {
                string caller = help["requestedByName"]?.ToString() ?? "Отряд";
                return "СРОЧНЫЙ ЗАПРОС · " + caller + " ждёт подкрепление";
            }
            string stage = liveEvent?["stageLabel"]?.ToString();
            string cause = liveEvent?["causeLabel"]?.ToString();
            if (IsPatrolMission(task))
            {
                if (string.IsNullOrEmpty(stage)) stage = PatrolPhaseLabel(operation?["phase"]?.ToString());
                if (string.IsNullOrEmpty(cause)) cause = operation?["goal"]?["summary"]?.ToString();
                cause = CompactText(cause, 64);
            }
            if (string.IsNullOrEmpty(stage)) stage = "Основная фаза";
            if (string.IsNullOrEmpty(cause)) cause = "Обстановка в районе меняется";
            return stage + " · причина: " + cause;
        }

        private static JObject WorldTaskOperation(JObject task)
        {
            JObject details = task?["details"] as JObject;
            return task?["operation"] as JObject ?? details?["operation"] as JObject;
        }

        private static bool IsPatrolMission(JObject task)
        {
            return WorldTaskOperation(task)?["kind"]?.ToString() == "patrol_mission"
                || task?["type"]?.ToString() == "patrol_mission";
        }

        private static string PatrolPhaseLabel(string phase)
        {
            switch (phase ?? string.Empty)
            {
                case "preparing": return "Сбор отряда";
                case "loading": return "Подготовка";
                case "traveling": return "Патруль в пути";
                case "patrolling": return "Патрулирование маршрута";
                case "holding": return "Удержание позиции";
                case "engaged": return "Патруль ведёт бой";
                case "unloading": return "Выполнение задачи";
                case "returning": return "Патруль возвращается";
                case "completed": return "Задача выполнена";
                case "failed": return "Патруль потерян";
                case "cancelled": return "Операция отменена";
                default: return "Патруль выполняет задачу";
            }
        }

        private static string PatrolOperationContext(JObject task)
        {
            JObject operation = WorldTaskOperation(task);
            string goal = operation?["goal"]?["summary"]?.ToString();
            return "Цель: " + CompactText(string.IsNullOrEmpty(goal) ? "выполнить приказ фракции" : goal, 68);
        }

        private static string PatrolOperationLeader(JObject task)
        {
            string leader = WorldTaskOperation(task)?["assignment"]?["leaderName"]?.ToString();
            if (string.IsNullOrEmpty(leader)) leader = "Командир патруля";
            return leader;
        }

        private static string CompactText(string value, int limit)
        {
            value = value ?? string.Empty;
            if (limit < 2 || value.Length <= limit) return value;
            return value.Substring(0, limit - 1).TrimEnd() + "…";
        }

        private static string WorldTaskTargetSiteId(JObject task)
        {
            JObject operation = WorldTaskOperation(task);
            if (IsPatrolMission(task))
            {
                if (operation?["goal"]?["kind"]?.ToString() == "intercept_hostile")
                    return FirstNonEmpty(operation?["goal"]?["targetSiteId"]?.ToString(),
                        operation?["destinationSiteId"]?.ToString());
                return FirstNonEmpty(task?["impactSiteId"]?.ToString(), operation?["goal"]?["targetSiteId"]?.ToString(),
                    operation?["destinationSiteId"]?.ToString(), task?["siteId"]?.ToString());
            }
            return task?["siteId"]?.ToString() ?? string.Empty;
        }

        private static string PatrolOperationTargetName(JObject task, string fallback)
        {
            JObject details = task?["details"] as JObject;
            JObject operation = WorldTaskOperation(task);
            if (operation?["goal"]?["kind"]?.ToString() == "intercept_hostile")
                return FirstNonEmpty(details?["targetPartyName"]?.ToString(), "вражеский отряд");
            return FirstNonEmpty(task?["impactSiteName"]?.ToString(), task?["targetSiteName"]?.ToString(),
                WorldTaskTargetSiteId(task), fallback);
        }

        private static string FirstNonEmpty(params string[] values)
        {
            if (values == null) return string.Empty;
            foreach (string value in values)
                if (!string.IsNullOrEmpty(value)) return value;
            return string.Empty;
        }

        private static JObject ActiveHelpSignal(JObject task)
        {
            JObject liveEvent = task?["liveEvent"] as JObject;
            JObject details = task?["details"] as JObject;
            JObject signal = liveEvent?["helpSignal"] as JObject
                ?? details?["helpSignal"] as JObject;
            if (signal == null || signal["active"]?.ToObject<bool>() == false) return null;
            long expiresAt = signal["expiresAt"]?.ToObject<long>() ?? 0L;
            return expiresAt <= 0L || expiresAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() ? signal : null;
        }

        private static string LiveRegionMetrics(JObject task)
        {
            JObject region = task?["liveRegion"] as JObject;
            JObject supplyState = region?["supply"] as JObject;
            JObject securityState = region?["security"] as JObject;
            JObject influenceState = region?["influence"] as JObject;
            string supply = supplyState?["label"]?.ToString();
            string security = securityState?["label"]?.ToString();
            string influence = influenceState?["label"]?.ToString();
            if (string.IsNullOrEmpty(supply) && string.IsNullOrEmpty(security) && string.IsNullOrEmpty(influence))
                return GoalText(task?["type"]?.ToString() ?? string.Empty);
            return "Снабжение: " + (supply ?? "нет данных")
                + " · безопасность: " + (security ?? "нет данных")
                + " · влияние: " + (influence ?? "нет данных");
        }

        private static string CommunityText(JObject task)
        {
            JObject liveEvent = task?["liveEvent"] as JObject;
            JObject details = task?["details"] as JObject;
            JObject detailsLiveEvent = details?["liveEvent"] as JObject;
            JObject community = liveEvent?["community"] as JObject
                ?? detailsLiveEvent?["community"] as JObject;
            int progress = community?["progress"]?.ToObject<int>() ?? 0;
            int goal = Mathf.Max(1, community?["goal"]?.ToObject<int>() ?? 1);
            int participants = Mathf.Max(0, community?["participantCount"]?.ToObject<int>() ?? 0);
            return "ВКЛАД " + progress + "/" + goal + (participants > 0 ? " · " + participants + " чел." : string.Empty);
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
            _launcher.GetComponent<Button>().onClick.AddListener(() => SetExpanded(true));
            Text launcherLabel = Label("Label", launcher, 12, TextAnchor.MiddleCenter, Accent, FontStyle.Bold);
            launcherLabel.text = "КОНТРАКТЫ ПУСТОШИ";
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
            root.sizeDelta = new Vector2(370f, 558f);
            _root.GetComponent<Image>().color = PanelBg;
            _root.GetComponent<Outline>().effectColor = Border;

            Text title = Label("Title", root, 19, TextAnchor.MiddleLeft, Accent, FontStyle.Bold);
            title.text = "СЕЙЧАС РЯДОМ";
            Place(title.rectTransform, 14f, -35f, -54f, -8f);
            Text subtitle = Label("Subtitle", root, 11, TextAnchor.MiddleLeft, Muted);
            subtitle.text = "Три приоритетных контракта живого мира";
            Place(subtitle.rectTransform, 14f, -57f, -54f, -37f);

            Button close = Button(root, "×", () => SetExpanded(false));
            Place((RectTransform)close.transform, 329f, -40f, -10f, -10f);

            _quickJoin = Button(root, "БЫСТРАЯ ВЫЛАЗКА", QuickJoin);
            Place((RectTransform)_quickJoin.transform, 14f, -104f, -14f, -67f);
            _quickJoinLabel = _quickJoin.transform.Find("Label")?.GetComponent<Text>();
            _quickJoin.GetComponent<Outline>().effectColor = Safe;

            var gridGo = new GameObject("ActivityGrid", typeof(RectTransform), typeof(GridLayoutGroup));
            _grid = (RectTransform)gridGo.transform;
            _grid.SetParent(root, false);
            Place(_grid, 14f, -480f, -14f, -118f);
            GridLayoutGroup grid = gridGo.GetComponent<GridLayoutGroup>();
            grid.cellSize = new Vector2(342f, 116f);
            grid.spacing = new Vector2(0f, 7f);
            grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            grid.constraintCount = 1;
            grid.startAxis = GridLayoutGroup.Axis.Horizontal;

            _message = Label("Message", root, 11, TextAnchor.MiddleLeft, Muted);
            _message.text = "Выберите контракт — цель станет маршрутом.";
            Place(_message.rectTransform, 14f, -546f, -14f, -492f);
            ConfigureHubPresentation(root, launcher, _grid, launcherLabel);
        }

        private static string KindLabel(string kind)
        {
            switch (kind)
            {
                case "patrol_mission": return "Задача патруля";
                case "join_patrol": return "Патруль";
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
                case "patrol_mission": return "Проследить за выполнением приказа фракции.";
                case "join_patrol": return "Присоединиться к действующему патрулю.";
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
                case "patrol_mission": return new Color(0.92f, 0.67f, 0.28f, 1f);
                case "join_patrol": return new Color(0.56f, 0.75f, 0.42f, 1f);
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
