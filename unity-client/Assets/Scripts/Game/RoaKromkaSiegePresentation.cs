using System;
using System.Collections.Generic;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>In-world objectives, side colours, timer, score and result for the isolated 20x20 siege room.</summary>
    [DisallowMultipleComponent]
    public sealed class RoaKromkaSiegePresentation : MonoBehaviour
    {
        private static readonly Color Attack = new Color(0.95f, 0.48f, 0.16f, 1f);
        private static readonly Color Defend = new Color(0.24f, 0.64f, 1f, 1f);
        private static readonly Color Neutral = new Color(0.88f, 0.82f, 0.54f, 1f);
        private static readonly Color Ours = new Color(0.36f, 0.86f, 0.42f, 1f);
        private static readonly string[] RelayIds = { "relay_a", "relay_b", "relay_c" };
        private readonly Dictionary<string, GameObject> _objectives = new Dictionary<string, GameObject>();
        private readonly Dictionary<string, Color> _markerColors = new Dictionary<string, Color>();
        private RoaGameBootstrap _bootstrap;
        private RoaSocketClient _socket;
        private JObject _event;
        private string _clanId = string.Empty;
        private Canvas _canvas;
        private GameObject _panel;
        private Text _status;
        private Button _actionButton;
        private Text _actionLabel;
        private string _nearAction = string.Empty;
        private string _nearObjective = string.Empty;
        // Сроки фаз и удержания ядра — серверные миллисекунды; отсчёт ведётся
        // по серверным часам, а не по часам клиента.
        private long _serverOffsetMs;
        private float _nextStatusAt;
        // Отказ сервера на действие у цели держится на панели три секунды:
        // раньше его затирал следующий же кадр.
        private string _actionError = string.Empty;
        private float _errorUntil;

        public void Configure(RoaGameBootstrap bootstrap, RoaSocketClient socket)
        {
            Unsubscribe(); _bootstrap = bootstrap; _socket = socket;
            BuildUi(); BuildWorldMarkers(); Subscribe(); RequestState();
        }

        private void OnDestroy() { Unsubscribe(); }

        private void Subscribe()
        {
            if (_socket == null) return;
            _socket.OnKromkaSiegeState += ApplyEnvelope;
            _socket.OnJoined += HandleJoined;
            _socket.OnServerWorldTransfer += HandleTransfer;
        }

        private void Unsubscribe()
        {
            if (_socket == null) return;
            _socket.OnKromkaSiegeState -= ApplyEnvelope;
            _socket.OnJoined -= HandleJoined;
            _socket.OnServerWorldTransfer -= HandleTransfer;
        }

        private void HandleJoined(JoinAck _) { RequestState(); RefreshVisibility(); }
        private void HandleTransfer(JObject _) { RequestState(); RefreshVisibility(); }

        private void RequestState()
        {
            if (_socket == null || _socket.Phase != RoaSocketClient.ConnectionPhase.Joined) return;
            _socket.EmitWithAck("requestKromkaSiegeState", new Dictionary<string, object>(), ack =>
            {
                if (ack?["state"] is JObject state) ApplyState(state);
            });
        }

        private void ApplyEnvelope(JObject payload)
        {
            SyncServerClock(payload?["t"]);
            if (payload?["state"] is JObject state) ApplyState(state);
            if (payload?["event"] is JObject changed && EventMatchesRoom(changed)) _event = changed;
            _nextStatusAt = 0f;
            RefreshVisibility();
        }

        private void ApplyState(JObject state)
        {
            SyncServerClock(state?["serverNow"]);
            _clanId = state?["clanId"]?.ToString() ?? string.Empty;
            _event = null;
            foreach (JToken token in state?["events"] as JArray ?? new JArray())
                if (token is JObject row && EventMatchesRoom(row)) { _event = row; break; }
            _nextStatusAt = 0f;
            RefreshVisibility();
        }

        private void SyncServerClock(JToken serverMs)
        {
            long value = serverMs?.Type == JTokenType.Integer || serverMs?.Type == JTokenType.Float ? serverMs.Value<long>() : 0L;
            if (value > 0) _serverOffsetMs = value - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private long ServerNow() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + _serverOffsetMs; }

        private bool EventMatchesRoom(JObject row)
        {
            string roomId = _socket?.Session?.RoomId ?? string.Empty;
            return !string.IsNullOrEmpty(roomId) && row?["roomId"]?.ToString() == roomId;
        }

        private string OwnClan()
        {
            return OwnClanId(_event, _socket?.Session?.CharacterId, _clanId);
        }

        private void Update()
        {
            bool inside = _socket?.Session?.LocationId == "clanSiege" && _event != null;
            if (!inside) { SetHudVisible(false); SetMarkers(false); return; }
            // Панель и кнопка не лежат поверх ПУТНИКА и диалогов; маркеры и
            // клавиша F от открытых окон не зависят.
            SetHudVisible(!RoaGameBootstrap.BlocksWorldHud);
            SetMarkers(true);
            string own = OwnClan();
            if (Time.unscaledTime >= _nextStatusAt)
            {
                _nextStatusAt = Time.unscaledTime + 0.25f;
                UpdateStatus(own);
            }
            UpdateNearbyAction(own);
            if (!string.IsNullOrEmpty(_nearAction) && Input.GetKeyDown(KeyCode.F)) SendObjective();
        }

        private void SetHudVisible(bool visible)
        {
            if (_panel != null && _panel.activeSelf != visible) _panel.SetActive(visible);
            if (!visible && _actionButton != null) _actionButton.gameObject.SetActive(false);
        }

        private void RefreshVisibility()
        {
            bool inside = _socket?.Session?.LocationId == "clanSiege" && _event != null;
            SetHudVisible(inside && !RoaGameBootstrap.BlocksWorldHud);
            SetMarkers(inside);
        }

        private void UpdateStatus(string own)
        {
            string text = DescribeSiege(_event, own, ServerNow());
            if (Time.unscaledTime < _errorUntil && !string.IsNullOrEmpty(_actionError))
            {
                int newline = text.IndexOf('\n');
                text = (newline > 0 ? text.Substring(0, newline) : text) + "\n" + _actionError;
            }
            if (_status.text != text)
            {
                _status.text = text;
                ResizePanel();
            }
            PaintRelays(own);
        }

        private void UpdateNearbyAction(string own)
        {
            _nearAction = string.Empty; _nearObjective = string.Empty;
            // Без своей стороны действий нет: пустой клан совпал бы с пустым атакующим.
            if (string.IsNullOrEmpty(own)) { _actionButton.gameObject.SetActive(false); return; }
            string phase = _event?["phase"]?.ToString() ?? string.Empty;
            string attacker = _event?["qualifiedAttackerClanId"]?.ToString() ?? string.Empty;
            string defender = _event?["defenderClanId"]?.ToString() ?? string.Empty;
            if (phase == "relay" && IsChallenger(_event, own)) FindNearest(RelayIds, "captureRelay");
            else if (phase == "breach" && own == attacker) FindNearest(new[] { "siege_gate" }, "damageGate");
            else if (phase == "core" && own == attacker) FindNearest(new[] { "command_core" }, "captureCore");
            else if (phase == "core" && own == defender) FindNearest(new[] { "command_core" }, "contestCore");
            bool visible = !string.IsNullOrEmpty(_nearAction) && _event?["status"]?.ToString() == "active"
                && !RoaGameBootstrap.BlocksWorldHud;
            _actionButton.gameObject.SetActive(visible);
            if (visible) _actionLabel.text = ActionLabel(_nearAction) + " [F]";
        }

        private void FindNearest(IEnumerable<string> ids, string action)
        {
            Transform player = _bootstrap?.PlayerView?.transform;
            if (player == null) return;
            float best = 3.3f;
            foreach (string id in ids)
            {
                if (!_objectives.TryGetValue(id, out GameObject marker)) continue;
                float distance = Vector3.Distance(player.position, marker.transform.position);
                if (distance > best) continue;
                best = distance; _nearAction = action; _nearObjective = id.StartsWith("relay_") ? id : string.Empty;
            }
        }

        private void SendObjective()
        {
            if (_socket == null || _event == null || string.IsNullOrEmpty(_nearAction)) return;
            string action = _nearAction; string objectiveId = _nearObjective;
            _socket.EmitWithAck("kromkaSiegeAction", new Dictionary<string, object>
            {
                ["action"] = action, ["objectiveId"] = objectiveId, ["eventId"] = _event["id"]?.ToString() ?? string.Empty
            }, ack =>
            {
                if (ack?["state"] is JObject state) ApplyState(state);
                if (ack?["ok"]?.Value<bool>() == true) { _errorUntil = 0f; return; }
                string error = ack?["error"]?.ToString();
                _actionError = string.IsNullOrEmpty(error) ? "Командное ядро отклонило действие." : error;
                _errorUntil = Time.unscaledTime + 3f;
                _nextStatusAt = 0f;
            });
        }

        // --- счёт осады: чистые форматтеры, их проверяет проба --------------------

        /// <summary>
        /// Свой клан — по ростеру события: персональный clanId из рассылки
        /// «участник вошёл» на мгновение подменяется кланом вошедшего.
        /// </summary>
        public static string OwnClanId(JObject ev, string characterId, string fallback)
        {
            if (ev?["rosters"] is JObject rosters && !string.IsNullOrEmpty(characterId))
            {
                foreach (JProperty side in rosters.Properties())
                    foreach (JToken member in side.Value as JArray ?? new JArray())
                        if (member?.ToString() == characterId) return side.Name;
            }
            return fallback ?? string.Empty;
        }

        public static bool IsChallenger(JObject ev, string clanId)
        {
            if (string.IsNullOrEmpty(clanId)) return false;
            foreach (JToken row in ev?["challengers"] as JArray ?? new JArray())
                if (row?["clanId"]?.ToString() == clanId) return true;
            return false;
        }

        /// <summary>Имя стороны для панели: «наши», имя клана или гарнизона.</summary>
        public static string SideName(JObject ev, string clanId, string own)
        {
            if (string.IsNullOrEmpty(clanId)) return "—";
            if (clanId == own) return "наши";
            string name = null;
            if (clanId == ev?["defenderClanId"]?.ToString()) name = ev?["defenderName"]?.ToString();
            if (string.IsNullOrEmpty(name))
                foreach (JToken row in ev?["challengers"] as JArray ?? new JArray())
                    if (row?["clanId"]?.ToString() == clanId) { name = row["name"]?.ToString(); break; }
            if (string.IsNullOrEmpty(name)) name = clanId;
            // Имя клана бывает до 42 символов: длинное разнесло бы строку счёта.
            if (name.Length > 16) name = name.Substring(0, 15) + "…";
            return "«" + name + "»";
        }

        public static string PhaseLabel(string phase)
        {
            switch (phase)
            {
                case "relay": return "ПЕРЕДАТЧИКИ";
                case "breach": return "ПРОЛОМ";
                case "core": return "ЯДРО";
                default: return "ОЖИДАНИЕ";
            }
        }

        public static string ResultLabel(string result)
        {
            switch (result)
            {
                case "attacker_core_held": return "атака удержала ядро";
                case "defender_core_held": return "защита отстояла ядро";
                case "defender_gate_held": return "ворота выстояли";
                case "defender_timeout": return "время защиты истекло";
                case "defender_no_attacker": return "штурмовать некому";
                case "no_challenger": return "вызовов не было";
                case "attacker_already_owns_base": return "у атакующих уже есть база";
                case "ownership_changed": return "владелец сменился раньше";
                default: return Human(result);
            }
        }

        /// <summary>
        /// Кого выведет на штурм тайм-аут фазы передатчиков: тот же порядок,
        /// что у сервера, — больше передатчиков, при равенстве раньше объявивший.
        /// </summary>
        public static string ProjectedQualifier(JObject ev)
        {
            string best = string.Empty;
            int bestScore = -1;
            long bestDeclared = long.MaxValue;
            foreach (JToken token in ev?["challengers"] as JArray ?? new JArray())
            {
                string clanId = token?["clanId"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(clanId)) continue;
                int score = ev?["relayScores"]?[clanId]?.Value<int>() ?? 0;
                long declared = token["declaredAt"]?.Value<long>() ?? 0L;
                if (score > bestScore || (score == bestScore && declared < bestDeclared))
                {
                    best = clanId; bestScore = score; bestDeclared = declared;
                }
            }
            return best;
        }

        public static string DescribeSiege(JObject ev, string own, long nowMs)
        {
            if (ev == null) return string.Empty;
            string status = ev["status"]?.ToString() ?? string.Empty;
            if (status == "resolved" || status == "cancelled")
            {
                return "ОСАДА ЗАВЕРШЕНА\nПобедитель: " + SideName(ev, ev["winnerClanId"]?.ToString(), own)
                    + " · " + ResultLabel(ev["result"]?.ToString());
            }

            string phase = ev["phase"]?.ToString() ?? "waiting";
            long ends = ev["phaseEndsAt"]?.Value<long>() ?? 0L;
            string attacker = ev["qualifiedAttackerClanId"]?.ToString() ?? string.Empty;
            string defender = ev["defenderClanId"]?.ToString() ?? string.Empty;
            bool challenger = IsChallenger(ev, own);
            int challengers = (ev["challengers"] as JArray)?.Count ?? 0;

            var sb = new StringBuilder("ОСАДА · ").Append(PhaseLabel(phase));
            if (ends > 0) sb.Append(" · ").Append(RoaWorldEventsPresentation.Clock(SecondsLeft(ends, nowMs)));

            if (phase == "relay")
            {
                // Передатчик принадлежит последнему нажавшему претенденту: прогресса
                // и оспаривания нет, поэтому показывается только, кто сколько держит.
                var held = new Dictionary<string, int>();
                int free = 0;
                foreach (string relay in RelayIds)
                {
                    string owner = ev["relayOwners"]?[relay]?.ToString() ?? string.Empty;
                    if (string.IsNullOrEmpty(owner)) { free++; continue; }
                    held[owner] = (held.TryGetValue(owner, out int count) ? count : 0) + 1;
                }
                var parts = new List<string>();
                foreach (KeyValuePair<string, int> row in held) parts.Add(SideName(ev, row.Key, own) + " " + row.Value);
                if (free > 0) parts.Add("ничьих " + free);
                sb.Append("\nПередатчики: ").Append(string.Join(" · ", parts)).Append(" · нужно 2 из 3");
                if (challengers > 1)
                    sb.Append("\nПо времени пройдёт: ").Append(SideName(ev, ProjectedQualifier(ev), own));
                if (challenger)
                    sb.Append(challengers > 1
                        ? "\nВозьмите 2 из 3 передатчиков раньше других"
                        : "\nВозьмите 2 из 3 передатчиков — чем раньше, тем больше времени на ворота");
                else if (own == defender && !string.IsNullOrEmpty(own))
                    sb.Append("\nПретенденты делят передатчики: каждая их гибель тратит возрождение их стороны");
            }
            else if (phase == "breach")
            {
                sb.Append("\nШтурм: ").Append(SideName(ev, attacker, own))
                    .Append(" · ворота ").Append(ev["gateHp"]?.Value<int>() ?? 0)
                    .Append('/').Append(ev["gateMaxHp"]?.Value<int>() ?? 0);
                if (own == attacker && !string.IsNullOrEmpty(own)) sb.Append("\nОтключите ворота");
                else if (own == defender && !string.IsNullOrEmpty(own)) sb.Append("\nУдержите ворота до конца фазы");
                else if (challenger) sb.Append("\nШтурм ведёт ").Append(SideName(ev, attacker, own)).Append(" — ваш клан в нём не участвует");
            }
            else if (phase == "core")
            {
                // Сервер знает только, кто запустил перезапись и когда; присутствие
                // у ядра он не отслеживает, поэтому о нём панель молчит.
                string coreOwner = ev["coreOwnerClanId"]?.ToString() ?? string.Empty;
                long holdMs = ev["coreHoldMs"]?.Value<long>() ?? 0L;
                if (string.IsNullOrEmpty(coreOwner)) sb.Append("\nЯдро: перезапись не запущена");
                else
                {
                    long holdEnds = (ev["coreHoldStartedAt"]?.Value<long>() ?? 0L) + holdMs;
                    sb.Append("\nПерезапись: ").Append(SideName(ev, coreOwner, own))
                        .Append(" · до захвата ").Append(RoaWorldEventsPresentation.Clock(SecondsLeft(holdEnds, nowMs)));
                    if (ends > 0 && holdEnds > ends) sb.Append(" · не успеет до конца фазы");
                }
                if (own == attacker && !string.IsNullOrEmpty(own))
                    sb.Append("\nЗапустите перезапись у ядра и не дайте её сбить (")
                        .Append(RoaWorldEventsPresentation.Clock((int)(holdMs / 1000L))).Append(')');
                else if (own == defender && !string.IsNullOrEmpty(own))
                    sb.Append("\nСбейте перезапись у ядра — отсчёт начнётся заново");
                else if (challenger) sb.Append("\nШтурм ведёт ").Append(SideName(ev, attacker, own)).Append(" — ваш клан в нём не участвует");
            }
            else sb.Append("\nОжидание начала осады");

            // Одно возрождение — одна гибель любого участника стороны: они общие
            // на весь состав, и игрок должен знать, сколько их осталось.
            bool side = !string.IsNullOrEmpty(own) && own != "neutral"
                && (own == defender || own == attacker || challenger);
            if (side && phase != "waiting")
            {
                int perSide = ev["respawnWavesPerSide"]?.Value<int>() ?? 0;
                int used = ev["respawnWaves"]?[own]?.Value<int>() ?? 0;
                int left = Math.Max(0, perSide - used);
                if (perSide > 0)
                    sb.Append(left > 0
                        ? "\nВозрождений у стороны: " + left + " из " + perSide + " (общие на состав)"
                        : "\nВозрождений не осталось: следующая гибель выведет из осады");
            }
            return sb.ToString();
        }

        private static int SecondsLeft(long endsMs, long nowMs)
        {
            return (int)Math.Max(0L, (endsMs - nowMs) / 1000L);
        }

        // --- передатчики в мире -----------------------------------------------------

        /// <summary>Передатчики красятся по владельцу: в мире на них нет подписей.</summary>
        private void PaintRelays(string own)
        {
            bool relay = _event?["phase"]?.ToString() == "relay";
            foreach (string id in RelayIds)
            {
                Color color = Attack;
                if (relay)
                {
                    string owner = _event?["relayOwners"]?[id]?.ToString() ?? string.Empty;
                    color = string.IsNullOrEmpty(owner) ? Neutral : owner == own ? Ours : Attack;
                }
                SetMarkerColor(id, color);
            }
        }

        private void SetMarkerColor(string id, Color color)
        {
            if (_markerColors.TryGetValue(id, out Color current) && current == color) return;
            if (!_objectives.TryGetValue(id, out GameObject marker) || marker == null) return;
            Renderer renderer = marker.GetComponent<Renderer>();
            if (renderer == null || renderer.sharedMaterial == null) return;
            ApplyColor(renderer.sharedMaterial, color);
            _markerColors[id] = color;
        }

        private static void ApplyColor(Material material, Color color)
        {
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", color * 1.8f);
        }

        private void BuildWorldMarkers()
        {
            CreateObjective("relay_a", -17, -13, Attack);
            CreateObjective("relay_b", 0, -9, Attack);
            CreateObjective("relay_c", 17, -13, Attack);
            CreateObjective("siege_gate", 0, 3, Neutral);
            CreateObjective("command_core", 0, 19, Defend);
            CreateRing("AttackerZone", 0, -30, 7f, Attack);
            CreateRing("DefenderZone", 0, 31, 7f, Defend);
            SetMarkers(false);
        }

        private void CreateObjective(string id, float x, float z, Color color)
        {
            GameObject marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            marker.name = "SiegeObjective:" + id;
            marker.transform.SetParent(transform, false);
            marker.transform.position = RoaCoords.ToUnity(x, 0.1f, z);
            marker.transform.localScale = new Vector3(0.9f, 0.06f, 0.9f);
            Collider collider = marker.GetComponent<Collider>();
            // Панель собирают и пробы редактора, где Destroy запрещён.
            if (collider != null) { if (Application.isPlaying) Destroy(collider); else DestroyImmediate(collider); }
            Renderer renderer = marker.GetComponent<Renderer>();
            Material material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            material.EnableKeyword("_EMISSION");
            ApplyColor(material, color);
            renderer.sharedMaterial = material; _objectives[id] = marker; _markerColors[id] = color;
        }

        private void CreateRing(string id, float x, float z, float radius, Color color)
        {
            GameObject root = new GameObject(id); root.transform.SetParent(transform, false); root.transform.position = RoaCoords.ToUnity(x, 0.08f, z);
            var line = root.AddComponent<LineRenderer>(); line.useWorldSpace = false; line.loop = true; line.positionCount = 49;
            line.startWidth = line.endWidth = 0.12f; line.material = new Material(Shader.Find("Sprites/Default")); line.startColor = line.endColor = color;
            for (int i = 0; i < line.positionCount; i++) { float a = i / (float)(line.positionCount - 1) * Mathf.PI * 2f; line.SetPosition(i, new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius)); }
            _objectives[id] = root;
        }

        private void SetMarkers(bool active) { foreach (GameObject marker in _objectives.Values) if (marker != null && marker.activeSelf != active) marker.SetActive(active); }

        // --- панель -------------------------------------------------------------------

        /// <summary>
        /// Размеры панели вынесены, чтобы их мерила проба раскладки. Канва
        /// масштабируется как HUD (RoaUiScale), поэтому отступ сверху считается в
        /// тех же единицах: панель встаёт под баннер PvP (он кончается на -110).
        /// </summary>
        public const float PanelPadding = 8f;
        public const float PanelTop = -118f;

        public static Vector2 PanelSize(bool mobile) { return mobile ? new Vector2(560f, 60f) : new Vector2(620f, 64f); }
        public static int PanelFontSize(bool mobile) { return mobile ? 13 : 14; }
        public static float PanelMaxHeight(bool mobile) { return mobile ? 112f : 128f; }

        private void ResizePanel()
        {
            if (_panel == null || _status == null) return;
            bool mobile = Application.isMobilePlatform;
            Vector2 size = PanelSize(mobile);
            float height = Mathf.Clamp(_status.preferredHeight + PanelPadding * 2f, size.y, PanelMaxHeight(mobile));
            ((RectTransform)_panel.transform).sizeDelta = new Vector2(size.x, height);
        }

        private void BuildUi()
        {
            bool mobile = Application.isMobilePlatform;
            _canvas = new GameObject("KromkaSiegeCanvas", typeof(RectTransform)).AddComponent<Canvas>();
            _canvas.transform.SetParent(transform, false); _canvas.renderMode = RenderMode.ScreenSpaceOverlay; _canvas.sortingOrder = 470;
            RoaUiScale.Apply(_canvas.gameObject.AddComponent<CanvasScaler>(), mobile);
            _canvas.gameObject.AddComponent<GraphicRaycaster>();
            _panel = new GameObject("SiegeStatus", typeof(RectTransform), typeof(Image)); _panel.transform.SetParent(_canvas.transform, false);
            RectTransform rect = (RectTransform)_panel.transform; rect.anchorMin = new Vector2(0.5f, 1); rect.anchorMax = new Vector2(0.5f, 1); rect.pivot = new Vector2(0.5f, 1);
            rect.anchoredPosition = new Vector2(0, PanelTop); rect.sizeDelta = PanelSize(mobile);
            _panel.GetComponent<Image>().color = new Color(0.035f, 0.055f, 0.045f, 0.94f);
            _status = CreateText("Status", rect, PanelFontSize(mobile), TextAnchor.MiddleCenter, Neutral); Stretch(_status.rectTransform, PanelPadding);
            _status.verticalOverflow = VerticalWrapMode.Truncate;
            GameObject button = new GameObject("SiegeAction", typeof(RectTransform), typeof(Image), typeof(Button)); button.transform.SetParent(_canvas.transform, false);
            RectTransform br = (RectTransform)button.transform; br.anchorMin = new Vector2(0.5f, 0); br.anchorMax = new Vector2(0.5f, 0); br.pivot = new Vector2(0.5f, 0); br.anchoredPosition = new Vector2(0, 28); br.sizeDelta = new Vector2(320, 46);
            button.GetComponent<Image>().color = new Color(0.34f, 0.17f, 0.05f, 0.96f); _actionButton = button.GetComponent<Button>(); _actionButton.onClick.AddListener(SendObjective);
            _actionLabel = CreateText("Label", br, 15, TextAnchor.MiddleCenter, Neutral); Stretch(_actionLabel.rectTransform, 4); _actionButton.gameObject.SetActive(false); _panel.SetActive(false);
        }

        private static Text CreateText(string name, RectTransform parent, int size, TextAnchor anchor, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform)); go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>(); text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); text.fontSize = size; text.alignment = anchor; text.color = color; text.horizontalOverflow = HorizontalWrapMode.Wrap; text.verticalOverflow = VerticalWrapMode.Overflow; return text;
        }
        private static void Stretch(RectTransform rect, float pad) { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = new Vector2(pad, pad); rect.offsetMax = new Vector2(-pad, -pad); }
        private static string Human(string value) { return string.IsNullOrEmpty(value) ? "—" : value.Replace('_', ' '); }
        private static string ActionLabel(string action) { return action == "captureRelay" ? "ЗАХВАТИТЬ ПЕРЕДАТЧИК" : action == "damageGate" ? "ОТКЛЮЧИТЬ ВОРОТА" : action == "contestCore" ? "СБИТЬ ПЕРЕЗАПИСЬ" : "ЗАПУСТИТЬ ПЕРЕЗАПИСЬ"; }
    }
}
