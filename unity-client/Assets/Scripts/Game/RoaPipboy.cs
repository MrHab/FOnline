using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Профиль персонажа, навыки, таланты, задания, живая пустошь, фракции,
    /// радио, друзья и кланы.
    /// Окно не мутирует игровое состояние: каждая покупка ранга и социальное
    /// действие сначала уходят на Node-сервер и показываются лишь после авторитетной сверки.
    /// </summary>
    public sealed class RoaPipboy : MonoBehaviour
    {
        private const float RemoteHealRange = 4.2f;
        public static readonly string[] PrimaryFactionIds =
        {
            "uprava", "free_artels", "contour", "tract_league", "seconds", "continuity"
        };
        public const string FactionGroupsExplanation = "Наёмник не вступает во фракцию навсегда: репутация открывает временные контракты, но работа на одну сторону может ухудшить отношения с другой.";

        public RoaSocketClient Socket;
        public RoaRemotePlayers RemotePlayers;
        public RoaPlayerController Player;
        public string BaseUrl = "http://127.0.0.1:3000";
        public KeyCode ToggleKey = KeyCode.P;
        public bool InputEnabled = true;

        private enum Tab
        {
            Status,
            Skills,
            Talents,
            Tasks,
            Social,
            World,
            Factions,
            Radio
        }

        private JObject _self;
        private Tab _tab;
        private bool _open;
        private bool _pending;
        private bool _pendingProgression;
        private bool _subscribed;
        private string _pendingId = string.Empty;
        private int _pendingRank;
        private float _pendingUntil;
        private string _status = string.Empty;
        private string _clanName = string.Empty;
        private JObject _wasteland;
        private JArray _factionCatalog = new JArray();
        private bool _worldRequestPending;
        private float _worldRefreshAt;
        private string _worldError = string.Empty;
        private int _radioChannel;
        private JObject _medicalConsentRequest;
        private JObject _playerTrade;

        /// <summary>
        /// Открыто ли IMGUI-окно. При живой канве оно не рисуется, поэтому и
        /// открытым не считается: иначе поднятый флаг гасил HUD и замораживал
        /// персонажа, не показав ни одного окна.
        /// </summary>
        public bool IsOpen { get { return _open && !CanvasDriven; } }

        /// <summary>Канва-версия окон включена: IMGUI-окно и своя клавиша молчат.</summary>
        public bool CanvasDriven { get; set; }

        /// <summary>
        /// Как открыть страницу «Друзья» живой канвы. Бутстрап подставляет сюда
        /// RoaPipboyCanvas.Open: входящий запрос лечения и приглашение к обмену
        /// должны показаться игроку в том окне, которое реально рисуется.
        /// </summary>
        public System.Action OpenSocialCanvas { get; set; }

        /// <summary>Авторитетное самосостояние для новых окон (только чтение).</summary>
        public JObject Self { get { return _self; } }

        /// <summary>Идёт ли запрос прокачки и его статус — для блокировки кнопок.</summary>
        public bool ProgressionPending { get { return _pending; } }
        public string ProgressionStatus { get { return _status ?? string.Empty; } }
        public JObject MedicalConsentRequest { get { return _medicalConsentRequest; } }
        public JObject PlayerTrade { get { return _playerTrade; } }

        // ---- Фасад для канва-страниц терминала (RoaPipboyCanvas) ----

        /// <summary>Авторитетная сводка пустоши (/api/wasteland → sim); null, пока не получена.</summary>
        public JObject Wasteland { get { return _wasteland; } }
        public JArray FactionCatalog { get { return _factionCatalog; } }
        public string WorldError { get { return _worldError ?? string.Empty; } }
        public bool WorldRequestPending { get { return _worldRequestPending; } }

        /// <summary>
        /// Держать сводку свежей, пока открыта страница мира/фракций: старое
        /// окно делало это только для своих вкладок. Раз в 5 с, как и там.
        /// </summary>
        public void EnsureWorldData(bool force = false)
        {
            if (_worldRequestPending) return;
            if (!force && _wasteland != null && Time.unscaledTime < _worldRefreshAt) return;
            _worldRefreshAt = Time.unscaledTime + 5f;
            StartCoroutine(FetchWasteland());
        }

        public void SubmitWorldTask(string taskId, string action)
        {
            if (_pending) return;
            SendWorldTaskAction(taskId, action);
        }

        public void SubmitSocialState(string action, string targetId = null, string clanName = null)
        {
            if (_pending) return;
            SendSocialStateAction(action, targetId, clanName);
        }

        public void SubmitNearbyAction(PublicPlayer target, string action)
        {
            if (_pending) return;
            SendNearbyAction(target, action);
        }

        public void SubmitPersonalBaseInvite(PublicPlayer target)
        {
            SubmitPersonalBasePermission(target, "guest");
        }

        public void SubmitPersonalBasePermission(PublicPlayer target, string mode)
        {
            if (_pending || target == null || string.IsNullOrEmpty(target.CharacterId) || Socket == null) return;
            bool visit = mode != "revoke";
            bool build = mode == "builder";
            bool work = mode == "worker" || mode == "builder";
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            Socket.EmitWithAck("personalBaseAction", new
            {
                requestId = Guid.NewGuid().ToString("N"),
                action = "setPermission",
                characterId = target.CharacterId,
                visit,
                build,
                storage = work,
                stations = work
            }, ack =>
            {
                _pending = false;
                Socket.ApplyGameplayAck(ack);
                _status = ack?["ok"]?.ToObject<bool>() == true
                    ? (mode == "revoke" ? "Доступ отозван у игрока " : "Права базы обновлены для игрока ") + (target.Name ?? "Игрок") + "."
                    : (ack?["error"]?.ToString() ?? "Не удалось выдать гостевой доступ.");
            });
        }

        public void SubmitPersonalBaseVisit(PublicPlayer target)
        {
            if (_pending || target == null || string.IsNullOrEmpty(target.CharacterId) || Socket == null) return;
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            Socket.EmitWithAck("personalBaseAction", new { requestId = Guid.NewGuid().ToString("N"), action = "enterGuest", ownerCharacterId = target.CharacterId }, ack =>
            {
                _pending = false;
                Socket.ApplyGameplayAck(ack);
                _status = ack?["ok"]?.ToObject<bool>() == true
                    ? "Входим в гостевое убежище…"
                    : (ack?["error"]?.ToString() ?? "Гостевой вход недоступен.");
            });
        }

        public void SubmitHeal(PublicPlayer target, string itemId)
        {
            if (_pending) return;
            HealNearby(target, itemId);
        }

        public void SubmitMedicalConsent(bool accept)
        {
            string requestId = _medicalConsentRequest?["id"]?.ToString() ?? string.Empty;
            if (Socket == null || string.IsNullOrEmpty(requestId)) return;
            Socket.EmitWithAck("medicalConsentAction", new { requestId, accept }, ack =>
            {
                bool ok = ack?["ok"]?.ToObject<bool>() == true;
                _status = ok
                    ? (accept ? "Лечение разрешено на 15 секунд." : "Лечение отклонено.")
                    : (ack?["error"]?.ToString() ?? "Ответ на запрос лечения не принят.");
                if (ok) _medicalConsentRequest = null;
            });
        }

        public void SubmitPlayerTradeAction(string action)
        {
            SubmitPlayerTrade(action, null);
        }

        public void SubmitPlayerTradeOfferDelta(string itemId, int delta)
        {
            if (_playerTrade == null || string.IsNullOrEmpty(itemId) || delta == 0) return;
            var offers = new Dictionary<string, JObject>(StringComparer.Ordinal);
            if (_playerTrade["ownOffer"] is JArray current)
            {
                foreach (JToken row in current)
                {
                    string id = row["id"]?.ToString() ?? string.Empty;
                    if (!string.IsNullOrEmpty(id) && row is JObject record)
                        offers[id] = (JObject)record.DeepClone();
                }
            }
            JObject offer = offers.TryGetValue(itemId, out JObject currentOffer)
                ? currentOffer : new JObject { ["id"] = itemId, ["qty"] = 0, ["itemRuntimeIds"] = new JArray() };
            int before = Mathf.Max(0, offer["qty"]?.ToObject<int>() ?? 0);
            int next = Mathf.Clamp(before + delta, 0, InventoryQty(itemId));
            JArray runtimeIds = offer["itemRuntimeIds"] as JArray ?? new JArray();
            while (runtimeIds.Count > next) runtimeIds.RemoveAt(runtimeIds.Count - 1);
            offer["qty"] = next;
            offer["itemRuntimeIds"] = runtimeIds;
            if (next > 0) offers[itemId] = offer;
            else offers.Remove(itemId);
            var rows = new JArray();
            foreach (JObject row in offers.Values)
                if ((row["qty"]?.ToObject<int>() ?? 0) > 0) rows.Add(row);
            SubmitPlayerTrade("setOffer", rows);
        }

        public void SubmitPlayerTradeWeaponToggle(string itemId, string itemRuntimeId)
        {
            if (_playerTrade == null || string.IsNullOrEmpty(itemId)
                || string.IsNullOrEmpty(itemRuntimeId) || itemRuntimeId == itemId) return;
            var offers = new Dictionary<string, JObject>(StringComparer.Ordinal);
            if (_playerTrade["ownOffer"] is JArray current)
                foreach (JToken token in current)
                    if (token is JObject row && !string.IsNullOrEmpty(row["id"]?.ToString()))
                        offers[row["id"].ToString()] = (JObject)row.DeepClone();

            JObject offer = offers.TryGetValue(itemId, out JObject existing)
                ? existing : new JObject { ["id"] = itemId, ["qty"] = 0, ["itemRuntimeIds"] = new JArray() };
            JArray runtimeIds = offer["itemRuntimeIds"] as JArray ?? new JArray();
            JToken selected = runtimeIds.FirstOrDefault(token => token?.ToString() == itemRuntimeId);
            int qty = Mathf.Max(0, offer["qty"]?.ToObject<int>() ?? 0);
            if (selected != null)
            {
                selected.Remove();
                qty = Mathf.Max(0, qty - 1);
            }
            else
            {
                if (qty < InventoryQty(itemId)) qty++;
                runtimeIds.Add(itemRuntimeId);
            }
            offer["qty"] = qty;
            offer["itemRuntimeIds"] = runtimeIds;
            if (qty > 0) offers[itemId] = offer;
            else offers.Remove(itemId);
            var rows = new JArray(offers.Values.Where(row => (row["qty"]?.ToObject<int>() ?? 0) > 0));
            SubmitPlayerTrade("setOffer", rows);
        }

        private void SubmitPlayerTrade(string action, JArray rows)
        {
            string tradeId = _playerTrade?["id"]?.ToString() ?? string.Empty;
            if (Socket == null || string.IsNullOrEmpty(tradeId) || _pending) return;
            var payload = new JObject
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["tradeId"] = tradeId,
                ["action"] = action
            };
            if (rows != null) payload["rows"] = rows;
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            _status = "Ожидаю подтверждение сделки…";
            Socket.EmitWithAck("playerTradeAction", payload, ack =>
            {
                _pending = false;
                if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                {
                    Socket.ApplyGameplayAck(ack);
                    _status = ack?["error"]?.ToString() ?? "Действие торговли отклонено.";
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                _playerTrade = ack["state"] is JObject state ? (JObject)state.DeepClone() : null;
                _status = ack["completed"]?.ToObject<bool>() == true ? "Обмен завершён." : "Сделка обновлена.";
            });
        }

        public bool TryNearestPlayer(out PublicPlayer target, out float distance)
        {
            target = null;
            distance = 0f;
            return Player != null && RemotePlayers != null
                && RemotePlayers.TryGetNearest(Player.transform.position, 4.5f, out target, out distance);
        }

        public const float HealRange = RemoteHealRange;

        public int RadioChannel { get { return _radioChannel; } set { _radioChannel = Mathf.Clamp(value, 0, RadioTitles.Length - 1); } }

        public static readonly string[] RadioTitles =
            { "Голос Тесьмы", "Шум Стеколья", "Сводка Тракта", "Тишина" };

        public static readonly string[] RadioDescriptions =
        {
            "Поселковые объявления, состояние воды и заявки наёмникам.",
            "Фоновый шум Искажений и редкие пакеты данных Контура.",
            "Маршруты караванов, цены и предупреждения Лиги Тракта.",
            "Приёмник отключён; остаётся только системный журнал."
        };

        /// <summary>Поднять навык на +5 — тот же путь, что кнопка старого окна.</summary>
        public void SubmitSkillUp(string id, int current)
        {
            if (_pending) return;
            RequestSkill(id, current);
        }

        /// <summary>Взять ранг перка — тот же путь, что кнопка старого окна.</summary>
        public void SubmitTalentUp(string id, int current)
        {
            if (_pending) return;
            RequestTalent(id, current);
        }
        public bool PointerOverUi
        {
            get
            {
                return IsOpen;
            }
        }

        public void Configure(RoaSocketClient socket, RoaRemotePlayers remotes, string baseUrl = null)
        {
            Unsubscribe();
            Socket = socket;
            RemotePlayers = remotes;
            if (!string.IsNullOrEmpty(baseUrl)) BaseUrl = baseUrl;
            Subscribe();
        }

        public void SetPlayer(RoaPlayerController player)
        {
            Player = player;
        }

        private void OnEnable()
        {
            Subscribe();
        }

        private void Subscribe()
        {
            if (_subscribed || Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnAuthoritativeSelf += HandleSelf;
            Socket.OnSocialActionReceived += HandleSocialAction;
            Socket.OnPlayerTradeUpdated += HandlePlayerTradeUpdated;
            Socket.OnSocialStateUpdated += HandleSocialStateUpdated;
            Socket.OnMedicalConsentRequested += HandleMedicalConsentRequested;
            Socket.OnMedicalConsentResolved += HandleMedicalConsentResolved;
            _subscribed = true;
        }

        private void OnDisable()
        {
            _worldRequestPending = false;
            Unsubscribe();
        }

        private void Unsubscribe()
        {
            if (!_subscribed || Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnAuthoritativeSelf -= HandleSelf;
            Socket.OnSocialActionReceived -= HandleSocialAction;
            Socket.OnPlayerTradeUpdated -= HandlePlayerTradeUpdated;
            Socket.OnSocialStateUpdated -= HandleSocialStateUpdated;
            Socket.OnMedicalConsentRequested -= HandleMedicalConsentRequested;
            Socket.OnMedicalConsentResolved -= HandleMedicalConsentResolved;
            _subscribed = false;
        }

        private void Update()
        {
            if (!CanvasDriven && InputEnabled && Input.GetKeyDown(ToggleKey) && GUIUtility.keyboardControl == 0)
                Toggle();

            bool needsWorld = (_open && (_tab == Tab.World || _tab == Tab.Factions)) || HasStagingCaravan();
            if (needsWorld
                && !_worldRequestPending && Time.unscaledTime >= _worldRefreshAt)
            {
                _worldRefreshAt = Time.unscaledTime + 5f;
                StartCoroutine(FetchWasteland());
            }

            if (_pending && Time.unscaledTime >= _pendingUntil)
            {
                _pending = false;
                _status = _pendingProgression
                    ? "Сервер не принял изменение: проверьте очки и требования."
                    : "Сервер не ответил на социальное действие.";
                _pendingProgression = false;
            }
        }

        public void Toggle()
        {
            _open = !_open;
        }

        public void OpenSocial()
        {
            if (CanvasDriven)
            {
                OpenSocialCanvas?.Invoke();
                return;
            }
            _tab = Tab.Social;
            _open = true;
        }

        private void HandleJoined(JoinAck ack)
        {
            ApplySelf(ack?.Self);
        }

        private void HandleSelf(JObject self)
        {
            ApplySelf(self);
        }

        private void ApplySelf(JObject self)
        {
            if (self == null) return;
            _self = (JObject)self.DeepClone();
            ApplyVersionedUiSnapshots(_self);

            if (!_pending || !_pendingProgression) return;
            int actual = RoaProgressionData.FindSkill(_pendingId) != null
                ? SkillPercent(_pendingId)
                : TalentRank(_pendingId);
            if (actual < _pendingRank) return;

            _pending = false;
            _pendingProgression = false;
            _status = "Сервер подтвердил: " + ProgressionName(_pendingId) + ".";
        }

        private static void ApplyVersionedUiSnapshots(JObject self)
        {
            JObject snapshots = self?["uiSnapshots"] as JObject;
            if (snapshots == null || (snapshots["version"]?.ToObject<int>() ?? 0) < 1) return;

            JObject contracts = snapshots["contracts"] as JObject;
            JObject world = snapshots["world"] as JObject;
            JObject quests = snapshots["quests"] as JObject;
            JObject reputation = snapshots["reputation"] as JObject;
            JObject friends = snapshots["friends"] as JObject;
            JObject clan = snapshots["clan"] as JObject;
            JObject shelter = snapshots["shelter"] as JObject;

            if (contracts?["records"] != null) self["factionContracts"] = contracts["records"].DeepClone();
            if (world?["tasks"] != null) self["worldTaskRecords"] = world["tasks"].DeepClone();
            if (world?["acceptedTaskIds"] != null) self["worldTaskAccepted"] = world["acceptedTaskIds"].DeepClone();
            if (world?["trackedTaskId"] != null) self["worldTaskTrackedId"] = world["trackedTaskId"].DeepClone();
            if (world?["globalMap"] != null) self["globalMap"] = world["globalMap"].DeepClone();
            if (quests?["npc"] != null) self["npcQuests"] = quests["npc"].DeepClone();
            if (quests?["journal"] != null) self["kromkaQuestJournal"] = quests["journal"].DeepClone();
            if (reputation?["factions"] != null) self["worldFactionReputation"] = reputation["factions"].DeepClone();

            JObject social = self["socialState"] as JObject ?? new JObject();
            if (friends?["records"] != null) social["friends"] = friends["records"].DeepClone();
            if (friends?["requests"] != null) social["friendRequests"] = friends["requests"].DeepClone();
            if (clan?["state"] != null) social["clan"] = clan["state"].DeepClone();
            if (clan?["invites"] != null) social["clanInvites"] = clan["invites"].DeepClone();
            self["socialState"] = social;
            if (shelter?["state"] != null) self["personalBase"] = shelter["state"].DeepClone();
        }

        private void HandleSocialAction(JObject payload)
        {
            if (payload == null) return;
            ApplySocialState(payload["socialState"] as JObject);

            string name = payload["fromName"]?.ToString() ?? "Игрок";
            string action = payload["action"]?.ToString() ?? string.Empty;
            string label = action == "friend" ? "отправляет заявку в друзья"
                : action == "clan" ? "приглашает в клан"
                : "предлагает торговлю";
            _status = name + " " + label + ".";
        }

        private void HandleSocialStateUpdated(JObject payload)
        {
            if (payload == null) return;
            ApplySocialState(payload["socialState"] as JObject);
            string message = payload["message"]?.ToString();
            if (!string.IsNullOrEmpty(message)) _status = message;
        }

        private void HandlePlayerTradeUpdated(JObject payload)
        {
            if (payload == null) return;
            bool wasTrading = _playerTrade != null;
            _playerTrade = payload["state"] is JObject state ? (JObject)state.DeepClone() : null;
            string message = payload["message"]?.ToString();
            if (!string.IsNullOrEmpty(message)) _status = message;
            // Окно открывается, когда обмен появился. Дальше страница обновляется
            // сама, и закрытый игроком терминал не распахивается на каждом
            // изменении чужого предложения.
            if (_playerTrade != null && !wasTrading) OpenSocial();
        }

        private void HandleMedicalConsentRequested(JObject payload)
        {
            if (payload == null) return;
            _medicalConsentRequest = (JObject)payload.DeepClone();
            _status = (payload["healerName"]?.ToString() ?? "Игрок") + " просит разрешение на лечение.";
            OpenSocial();
        }

        private void HandleMedicalConsentResolved(JObject payload)
        {
            if (payload == null) return;
            string requestId = payload["requestId"]?.ToString() ?? string.Empty;
            if (_medicalConsentRequest?["id"]?.ToString() == requestId) _medicalConsentRequest = null;
            bool accepted = payload["accepted"]?.ToObject<bool>() == true;
            _status = accepted
                ? "Лечение разрешено. Примените выбранный предмет повторно."
                : "Запрос лечения отклонён.";
        }

        private void ApplySocialState(JObject social)
        {
            if (social == null) return;
            if (_self == null) _self = new JObject();
            _self["socialState"] = social.DeepClone();
        }

        // --- Фасад для окна ожидания каравана (RoaCaravanStagingCanvas) ---

        /// <summary>Принятая работа «сопровождение каравана» на стоянке (acceptedStagingCaravanTask web).</summary>
        public JObject StagingTask { get { return _self != null ? StagingCaravanTask() : null; } }
        public JObject ActiveEscortTask { get { return _self != null ? AcceptedCaravanTask() : null; } }
        public JObject WorldParty(string id) { return FindWorldParty(id); }
        public float? StagingSeconds(JObject task) { return StagingSecondsLeft(task); }
        public static string CountdownText(float seconds) { return FormatCountdown(seconds); }
        public string SiteName(string id) { return WorldSiteName(_wasteland?["sites"] as JArray, id); }
        public bool ActionPending { get { return _pending; } }
        public void CancelWorldTask(string taskId) { SendWorldTaskAction(taskId, "cancel"); }

        private bool HasStagingCaravan()
        {
            return StagingCaravanTask() != null;
        }

        private JObject StagingCaravanTask()
        {
            JObject task = AcceptedCaravanTask();
            JObject details = task?["details"] as JObject;
            return details?["staging"]?.ToObject<bool>() == true
                && details["joinClosed"]?.ToObject<bool>() != true ? task : null;
        }

        private JObject AcceptedCaravanTask()
        {
            foreach (JToken token in _self?["worldTaskRecords"] as JArray ?? new JArray())
            {
                JObject task = token as JObject;
                if (task == null || task["type"]?.ToString() != "escort_caravan"
                    || task["status"]?.ToString() != "active") continue;
                string id = task["id"]?.ToString();
                if (!ArrayContains(_self?["worldTaskAccepted"] as JArray, id)) continue;
                return task;
            }
            return null;
        }

        private JObject FindWorldParty(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (JToken token in _wasteland?["parties"] as JArray ?? new JArray())
                if (token?["id"]?.ToString() == id) return token as JObject;
            return null;
        }

        private float? StagingSecondsLeft(JObject task)
        {
            JObject details = task?["details"] as JObject;
            float waitUntilHour = Float(details?["waitUntilHour"]);
            if (_wasteland == null || waitUntilHour <= 0f) return null;
            float worldHour = Float(_wasteland["worldHour"]);
            double updatedAt = Double(_wasteland["updatedAt"]);
            float dayRealMs = Mathf.Max(60000f, Float(_wasteland["gameDayRealMs"], 60f * 60f * 1000f));
            if (updatedAt > 0d)
            {
                double nowMs = (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
                worldHour += (float)(Math.Max(0d, nowMs - updatedAt) / dayRealMs * 24d);
            }
            return Mathf.Max(0f, (waitUntilHour - worldHour) / 24f * dayRealMs / 1000f);
        }

        private static string FormatCountdown(float seconds)
        {
            int total = Mathf.Max(0, Mathf.CeilToInt(seconds));
            int hours = total / 3600;
            int minutes = (total % 3600) / 60;
            int secs = total % 60;
            return hours > 0
                ? hours + ":" + minutes.ToString("00") + ":" + secs.ToString("00")
                : minutes + ":" + secs.ToString("00");
        }

        private IEnumerator FetchWasteland()
        {
            _worldRequestPending = true;
            string url = (BaseUrl ?? string.Empty).TrimEnd('/') + "/api/wasteland";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.SetRequestHeader("Cache-Control", "no-store");
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    _worldError = "Сводка пустоши временно недоступна: " + request.error;
                    _worldRequestPending = false;
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    JObject sim = payload["sim"] as JObject;
                    if (sim == null) throw new Exception("в ответе нет поля sim");
                    _wasteland = sim;
                    _factionCatalog = payload["factions"] as JArray ?? new JArray();
                    _worldError = string.Empty;
                }
                catch (Exception error)
                {
                    _worldError = "Не удалось прочитать сводку пустоши: " + error.Message;
                }
            }
            _worldRequestPending = false;
        }

        private void HealNearby(PublicPlayer target, string itemId)
        {
            if (target == null || string.IsNullOrEmpty(target.Id)) return;
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            _status = "Лечение " + (target.Name ?? "игрока") + "…";
            Socket.EmitWithAck("healPlayer", new { targetId = target.Id, itemId }, ack =>
            {
                _pending = false;
                if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                {
                    Socket.ApplyGameplayAck(ack);
                    _status = ack?["error"]?.ToString() ?? "Лечение отклонено.";
                    return;
                }

                Socket.ApplyGameplayAck(ack);
                if (ack["pendingConsent"]?.ToObject<bool>() == true)
                {
                    _status = "Запрос на лечение отправлен. После согласия примените предмет повторно.";
                    return;
                }
                if (ack["target"] is JObject targetState)
                    RemotePlayers?.ApplyPublicPlayer(targetState.ToObject<PublicPlayer>());
                string cured = ack["curedInjury"]?.ToString();
                int healed = Int(ack["healed"]);
                _status = !string.IsNullOrEmpty(cured)
                    ? (target.Name ?? "Игрок") + ": вылечено — " + cured
                    : (target.Name ?? "Игрок") + ": HP +" + healed;
            });
        }

        private void RequestSkill(string id, int current)
        {
            JObject ranks = (_self["skillRanks"] as JObject)?.DeepClone() as JObject ?? new JObject();
            int wanted = Mathf.Min(100, current + 5);
            ranks[id] = wanted;
            BeginProgressionRequest(id, wanted);
            Socket.SendProgressionProfile(ranks, null, HandleProgressionAck);
        }

        private void RequestTalent(string id, int current)
        {
            JObject ranks = (_self["talentRanks"] as JObject)?.DeepClone() as JObject ?? new JObject();
            ranks[id] = current + 1;
            BeginProgressionRequest(id, current + 1);
            Socket.SendProgressionProfile(null, ranks, HandleProgressionAck);
        }

        private void HandleProgressionAck(JObject ack)
        {
            if (ack?["self"] is JObject self) ApplySelf(self);
            if (ack?["ok"]?.ToObject<bool>() == true) return;
            _pending = false;
            _pendingProgression = false;
            _status = ack?["error"]?.ToString() ?? "Сервер отклонил изменение развития персонажа.";
        }

        private void BeginProgressionRequest(string id, int rank)
        {
            _pending = true;
            _pendingProgression = true;
            _pendingId = id;
            _pendingRank = rank;
            _pendingUntil = Time.unscaledTime + 3f;
            _status = "Ожидаю подтверждение сервера…";
        }

        private void SendNearbyAction(PublicPlayer target, string action)
        {
            if (target == null || string.IsNullOrEmpty(target.Id)) return;
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            _status = "Отправка запроса…";
            Socket.EmitWithAck("socialAction", new
            {
                requestId = Guid.NewGuid().ToString("N"), targetId = target.Id, action
            }, ack =>
            {
                _pending = false;
                if (ack == null || ack["ok"]?.ToObject<bool>() == false)
                {
                    Socket.ApplyGameplayAck(ack);
                    _status = ack?["error"]?.ToString() ?? "Социальное действие не выполнено.";
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                if (ack["trade"] is JObject trade) _playerTrade = (JObject)trade.DeepClone();
                _status = ack["message"]?.ToString() ?? "Запрос отправлен игроку " + (target.Name ?? "игрок") + ".";
            });
        }

        private void SendSocialStateAction(string action, string targetId = null, string clanName = null)
        {
            var payload = new JObject
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["action"] = action
            };
            if (!string.IsNullOrEmpty(targetId)) payload["targetId"] = targetId;
            if (!string.IsNullOrEmpty(clanName)) payload["name"] = clanName;

            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            _status = "Ожидаю ответа сервера…";
            Socket.EmitWithAck("socialStateAction", payload, ack =>
            {
                _pending = false;
                if (ack == null || ack["ok"]?.ToObject<bool>() == false)
                {
                    Socket.ApplyGameplayAck(ack);
                    _status = ack?["error"]?.ToString() ?? "Социальное действие не выполнено.";
                    return;
                }

                Socket.ApplyGameplayAck(ack);
                ApplySocialState(ack["socialState"] as JObject);
                _status = ack["message"]?.ToString() ?? "Готово.";
                if (action == "createClan") _clanName = string.Empty;
            });
        }

        private void SendWorldTaskAction(string taskId, string action)
        {
            if (_pending || string.IsNullOrEmpty(taskId)) return;
            _pending = true;
            _pendingProgression = false;
            _pendingUntil = Time.unscaledTime + 5f;
            _status = "Сервер обновляет контракт…";
            Socket.EmitWithAck("worldTaskAction", new
            {
                requestId = Guid.NewGuid().ToString("N"), taskId, action
            }, ack =>
            {
                _pending = false;
                Socket.ApplyGameplayAck(ack);
                if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack?["error"]?.ToString() ?? "Контракт не обновлён.";
                    return;
                }
                if (action == "track") _status = string.IsNullOrEmpty(ack["trackedId"]?.ToString())
                    ? "Метка контракта снята." : "Контракт отслеживается.";
                else if (action == "deliver") _status = "Припасы доставлены.";
                else if (action == "claim")
                {
                    JObject reward = ack["reward"] as JObject;
                    _status = "Награда получена: " + Int(reward?["xp"]) + " XP, "
                        + Int(reward?["caps"]) + " марок.";
                }
                else if (action == "cancel") _status = "Контракт отменён.";
                else _status = "Контракт обновлён.";
            });
        }

        public JObject SocialState()
        {
            return _self?["socialState"] as JObject ?? new JObject();
        }

        private int SkillPercent(string id)
        {
            int baseValue = SkillBasePercent(id);
            int stored = Int(_self?["skillRanks"]?[id], baseValue);
            return Mathf.Clamp(Mathf.Max(baseValue, stored), 20, 100);
        }

        private int SkillBasePercent(string id)
        {
            int str = EffectiveSpecial("str");
            int per = EffectiveSpecial("per");
            int end = EffectiveSpecial("end");
            int cha = EffectiveSpecial("cha");
            int intelligence = EffectiveSpecial("int");
            int agi = EffectiveSpecial("agi");
            int luck = EffectiveSpecial("luck");
            int value;
            switch (id)
            {
                case "lightWeapons": value = 15 + agi * 2 + per; break;
                case "heavyWeapons": value = 10 + str * 2 + end; break;
                case "energyWeapons": value = 10 + intelligence * 2 + per; break;
                case "throwing": value = 10 + agi * 2 + str; break;
                case "melee": value = 15 + str * 2 + agi; break;
                case "unarmed": value = 15 + str + agi + end; break;
                case "doctor": value = 10 + intelligence * 2 + per; break;
                case "firstAid": value = 12 + intelligence + per + end; break;
                case "stealth": value = 10 + agi * 2 + luck; break;
                case "lockpick": value = 10 + agi * 2 + per; break;
                case "traps": value = 10 + per + agi + intelligence; break;
                case "science": value = 10 + intelligence * 3; break;
                case "repair": value = 10 + intelligence * 2 + per; break;
                case "speech": value = 10 + cha * 3; break;
                case "barter": value = 10 + cha * 2 + intelligence; break;
                default: value = 20; break;
            }
            value = Mathf.Clamp(Mathf.RoundToInt(value), 20, 45);
            if (IsTagged(id)) value += 5;
            return Mathf.Clamp(value, 20, 50);
        }

        private int EffectiveSpecial(string id)
        {
            int value = Int(_self?["special"]?[id], 5);
            string talentId = "special" + char.ToUpperInvariant(id[0]) + id.Substring(1);
            return Mathf.Clamp(value + TalentRank(talentId), 1, 15);
        }

        private bool IsTagged(string id)
        {
            if (!(_self?["taggedSkills"] is JArray tagged)) return false;
            foreach (JToken token in tagged) if (token?.ToString() == id) return true;
            return false;
        }

        public int InventoryQty(string itemId)
        {
            int total = 0;
            if (!(_self?["inventory"] is JArray inventory)) return total;
            foreach (JToken row in inventory)
            {
                string id = BaseItemId(row?["id"]?.ToString());
                if (id == itemId) total += Mathf.Max(0, Int(row?["qty"]));
            }
            return total;
        }

        public static bool HasTreatableInjury(PublicPlayer player)
        {
            return HasInjury(player, "brokenArm") || HasInjury(player, "brokenLeg") || HasInjury(player, "concussion");
        }

        public static bool HasInjury(PublicPlayer player, string id)
        {
            return player?.Injuries?[id]?.ToObject<bool>() == true;
        }

        private int TalentRank(string id)
        {
            return Mathf.Max(0, Int(_self?["talentRanks"]?[id]));
        }

        public bool TalentRequirementsMet(RoaProgressionData.TalentDef talent)
        {
            if (Int(_self?["level"], 1) < talent.Level) return false;
            if (!string.IsNullOrEmpty(talent.Stat) && EffectiveSpecial(talent.Stat) < talent.StatValue) return false;
            if (!string.IsNullOrEmpty(talent.Stat2) && EffectiveSpecial(talent.Stat2) < talent.StatValue2) return false;
            if (!string.IsNullOrEmpty(talent.Skill) && SkillPercent(talent.Skill) < talent.SkillValue) return false;
            return true;
        }

        public string RequirementText(RoaProgressionData.TalentDef talent)
        {
            var rows = new List<string> { "ур. " + talent.Level };
            if (!string.IsNullOrEmpty(talent.Stat)) rows.Add(RoaCharacterCreator.StatName(talent.Stat) + " " + talent.StatValue);
            if (!string.IsNullOrEmpty(talent.Stat2)) rows.Add(RoaCharacterCreator.StatName(talent.Stat2) + " " + talent.StatValue2);
            if (!string.IsNullOrEmpty(talent.Skill))
            {
                RoaProgressionData.SkillDef skill = RoaProgressionData.FindSkill(talent.Skill);
                rows.Add((skill?.Name ?? talent.Skill) + " " + talent.SkillValue + "%");
            }
            return string.Join(" · ", rows);
        }

        private string ProgressionName(string id)
        {
            RoaProgressionData.SkillDef skill = RoaProgressionData.FindSkill(id);
            if (skill != null) return skill.Name;
            foreach (RoaProgressionData.TalentDef talent in RoaProgressionData.Talents)
                if (talent.Id == id) return talent.Name;
            return id;
        }

        public static string SocialEntryLabel(JToken entry)
        {
            string name = entry?["name"]?.ToString() ?? "Игрок";
            int level = Int(entry?["level"], 1);
            string clan = entry?["clanName"]?.ToString();
            return name + " · ур. " + level + (string.IsNullOrEmpty(clan) ? string.Empty : " · " + clan);
        }

        private static bool ArrayContains(JArray rows, string id)
        {
            if (rows == null || string.IsNullOrEmpty(id)) return false;
            foreach (JToken row in rows) if (row?.ToString() == id) return true;
            return false;
        }

        public static string WorldSiteName(JArray sites, string id)
        {
            foreach (JToken token in sites ?? new JArray())
                if (token?["id"]?.ToString() == id)
                    return KromkaLocationLabel(id, token["name"]?.ToString() ?? id);
            return string.IsNullOrEmpty(id) ? "отмеченной точке" : KromkaLocationLabel(id, id);
        }

        public static string KromkaPublicText(string value)
        {
            if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
            return value
                .Replace("Дорожный аванпост Старого Клима", "Застава 17")
                .Replace("Старый военный склад", "Арсенал №6")
                .Replace("Караванный двор Старого Клима", "Ключи")
                .Replace("Старого Клима", "Управы")
                .Replace("Старый Клим", "Управа")
                .Replace("Old Klim", "Uprava")
                .Replace("Свалочного союза", "Вольных артелей")
                .Replace("Свалочный союз", "Вольные артели")
                .Replace("Свалочный пост", "Раздолье")
                .Replace("станция Ретранслятор", "станция Контур-3")
                .Replace("Ретранслятор", "Контур")
                .Replace("Вольные караваны", "Лига Тракта");
        }

        private static string KromkaLocationLabel(string id, string fallback)
        {
            switch (id ?? string.Empty)
            {
                case "settlement": return "Ключи";
                case "caravanCamp": return "Перекрёсток";
                case "scrapTown": return "Раздолье";
                case "relayStation": return "Контур-3";
                case "roadOutpost": return "Застава 17";
                case "klimAmmoWorks": return "Патронный двор «Створ-2»";
                default: return KromkaPublicText(fallback);
            }
        }

        public static string SiteTypeLabel(string type)
        {
            string key = (type ?? string.Empty).ToLowerInvariant();
            if (key == "settlement") return "поселение";
            if (key == "resource") return "ресурс";
            if (key == "outpost") return "аванпост";
            if (key == "production") return "производство";
            if (key == "pointofinterest") return "точка интереса";
            return "точка мира";
        }

        /// <summary>
        /// Процент навыка — skillPercent() web (04_player_model_visuals.js:223): ранг
        /// из self.skillRanks, иначе база по SPECIAL (skillBasePercent) с бонусом тега.
        /// </summary>
        public static int SkillPercent(JObject self, string id)
        {
            JToken rank = self?["skillRanks"]?[id];
            if (rank != null && rank.Type != JTokenType.Null) return Mathf.Max(0, rank.ToObject<int>());
            JObject special = self?["special"] as JObject;
            int str = Int(special?["str"], 5), per = Int(special?["per"], 5), end = Int(special?["end"], 5);
            int cha = Int(special?["cha"], 5), intel = Int(special?["int"], 5), agi = Int(special?["agi"], 5), luck = Int(special?["luck"], 5);
            int value;
            switch (id)
            {
                case "lightWeapons": value = 15 + agi * 2 + per; break;
                case "heavyWeapons": value = 10 + str * 2 + end; break;
                case "energyWeapons": value = 10 + intel * 2 + per; break;
                case "throwing": value = 10 + agi * 2 + str; break;
                case "melee": value = 15 + str * 2 + agi; break;
                case "unarmed": value = 15 + str + agi + end; break;
                case "doctor": value = 10 + intel * 2 + per; break;
                case "firstAid": value = 12 + intel + per + end; break;
                case "stealth": value = 10 + agi * 2 + luck; break;
                case "lockpick": value = 10 + agi * 2 + per; break;
                case "traps": value = 10 + per + agi + intel; break;
                case "science": value = 10 + intel * 3; break;
                case "repair": value = 10 + intel * 2 + per; break;
                case "speech": value = 10 + cha * 3; break;
                case "barter": value = 10 + cha * 2 + intel; break;
                default: value = 5; break;
            }
            int baseValue = Mathf.Clamp(value, 5, 95);
            bool tagged = false;
            foreach (JToken token in self?["taggedSkills"] as JArray ?? new JArray())
                if (token?.ToString() == id) tagged = true;
            return Mathf.Min(100, baseValue + (tagged ? 5 : 0));
        }

        /// <summary>Класс карточки площадки web: danger / safe / warning / stable.</summary>
        /// <summary>Строка «Формула» карточки навыка: база по SPECIAL и бонус тега, как skill-formula web.</summary>
        public static string SkillFormulaText(JObject self, string id)
        {
            JObject special = self?["special"] as JObject;
            int str = Int(special?["str"], 5), per = Int(special?["per"], 5), end = Int(special?["end"], 5);
            int cha = Int(special?["cha"], 5), intel = Int(special?["int"], 5), agi = Int(special?["agi"], 5), luck = Int(special?["luck"], 5);
            string formula;
            switch (id)
            {
                case "lightWeapons": formula = "15 + AG×2 + PE = " + (15 + agi * 2 + per); break;
                case "heavyWeapons": formula = "10 + ST×2 + EN = " + (10 + str * 2 + end); break;
                case "energyWeapons": formula = "10 + IN×2 + PE = " + (10 + intel * 2 + per); break;
                case "throwing": formula = "10 + AG×2 + ST = " + (10 + agi * 2 + str); break;
                case "melee": formula = "15 + ST×2 + AG = " + (15 + str * 2 + agi); break;
                case "unarmed": formula = "15 + ST + AG + EN = " + (15 + str + agi + end); break;
                case "doctor": formula = "10 + IN×2 + PE = " + (10 + intel * 2 + per); break;
                case "firstAid": formula = "12 + IN + PE + EN = " + (12 + intel + per + end); break;
                case "stealth": formula = "10 + AG×2 + LK = " + (10 + agi * 2 + luck); break;
                case "lockpick": formula = "10 + AG×2 + PE = " + (10 + agi * 2 + per); break;
                case "traps": formula = "10 + PE + AG + IN = " + (10 + per + agi + intel); break;
                case "science": formula = "10 + IN×3 = " + (10 + intel * 3); break;
                case "repair": formula = "10 + IN×2 + PE = " + (10 + intel * 2 + per); break;
                case "speech": formula = "10 + CH×3 = " + (10 + cha * 3); break;
                case "barter": formula = "10 + CH×2 + IN = " + (10 + cha * 2 + intel); break;
                default: formula = "5"; break;
            }
            bool tagged = false;
            foreach (JToken token in self?["taggedSkills"] as JArray ?? new JArray())
                if (token?.ToString() == id) tagged = true;
            int ranks = 0;
            JToken rank = self?["skillRanks"]?[id];
            if (rank != null && rank.Type != JTokenType.Null) ranks = rank.ToObject<int>();
            return "Формула: база " + formula + "% (в пределах 5–95)" + (tagged ? "; профильный навык +5%" : "")
                + (ranks > 0 ? "; вложено очков до " + ranks + "%" : "") + ". Каждое очко навыка даёт +5%, максимум 100%.";
        }

        public static string SiteStatusTone(JObject site, float worldHour)
        {
            if (Float(site?["supplyDisruptedUntil"]) > worldHour) return "danger";
            if (Float(site?["threatSuppressedUntil"]) > worldHour) return "safe";
            if (Mathf.Abs(Float(site?["controlPressure"])) > 8f) return "warning";
            float security = Float(site?["security"], 100f);
            if (security != 0f && security < 35f) return "warning";
            return "stable";
        }

        public static string SiteStatusLabel(JObject site, float worldHour)
        {
            if (Float(site?["supplyDisruptedUntil"]) > worldHour) return "дефицит снабжения";
            if (Float(site?["threatSuppressedUntil"]) > worldHour) return "угроза подавлена";
            if (Mathf.Abs(Float(site?["controlPressure"])) > 8f) return "идёт борьба за контроль";
            // Web: Number(site.security || 100) — нулевая безопасность читается как 100.
            float security = Float(site?["security"], 100f);
            if (security != 0f && security < 35f) return "низкая безопасность";
            return "стабильно";
        }

        public static string StockText(JObject stock)
        {
            if (stock == null) return "запасов нет";
            var rows = new List<string>();
            foreach (KeyValuePair<string, JToken> entry in stock)
            {
                float value = Float(entry.Value);
                if (value <= 0.01f) continue;
                rows.Add(StockLabel(entry.Key) + " " + CompactNumber(value));
                if (rows.Count >= 5) break;
            }
            return rows.Count == 0 ? "запасов нет" : string.Join(" · ", rows);
        }

        /// <summary>
        /// Число для карточек мира. Mathf.RoundToInt на значении больше
        /// int.MaxValue возвращает int.MinValue — так «крышки −2147483648» и
        /// появились у Ретранслятора, когда сервер отдал 2.9e+74. Большие числа
        /// сворачиваются в тыс./млн/млрд, совсем дикие — в экспоненту.
        /// </summary>
        public static string CompactNumber(float value)
        {
            if (float.IsNaN(value) || float.IsInfinity(value)) return "∞";
            float abs = Mathf.Abs(value);
            if (abs >= 1e12f) return value.ToString("0.0e0");
            if (abs >= 1e9f) return (value / 1e9f).ToString("0.0") + " млрд";
            if (abs >= 1e6f) return (value / 1e6f).ToString("0.0") + " млн";
            if (abs >= 1e4f) return (value / 1e3f).ToString("0.0") + " тыс.";
            return Mathf.RoundToInt(value).ToString();
        }

        private static string StockLabel(string id)
        {
            if (id == "silver") return "марки";
            if (id == "water") return "вода";
            if (id == "ore") return "руда";
            if (id == "scrap") return "лом";
            if (id == "oil") return "нефть";
            if (id == "chemicals") return "химикаты";
            if (id == "medicine") return "медикаменты";
            if (id == "electronics") return "электроника";
            if (id == "ammoParts") return "детали";
            if (id == "food") return "еда";
            if (id == "weaponParts") return "оруж. детали";
            return RoaItemData.Name(id);
        }

        public static string PartyKindLabel(string kind)
        {
            string key = (kind ?? string.Empty).ToLowerInvariant();
            if (key == "caravan") return "Караван";
            if (key == "patrol") return "Патруль";
            if (key == "refugees") return "Беженцы";
            if (key == "raider") return "Рейдеры";
            if (key == "monster") return "Монстры";
            return "Группа";
        }

        public static string PartyStateLabel(string state)
        {
            string key = (state ?? string.Empty).ToLowerInvariant();
            if (key == "idle") return "на стоянке";
            if (key == "moving") return "в пути";
            if (key == "assembling") return "собираются у выхода";
            if (key == "stranded") return "застряли без маршрута";
            if (key == "staging") return "собирается в путь";
            if (key == "returning") return "возвращается на базу";
            if (key == "onsite") return "работает на точке";
            if (key == "engaged") return "участвует во встрече";
            if (key == "recovering") return "восстанавливается";
            if (key == "waiting") return "ожидает";
            if (key == "destroyed") return "уничтожена";
            return "следует своим маршрутом";
        }

        public static string EventTypeLabel(string type)
        {
            string key = (type ?? string.Empty).ToLowerInvariant();
            if (key.Contains("task")) return "Работа";
            if (key.Contains("caravan")) return "Караван";
            if (key.Contains("party") || key.Contains("battle")) return "Отряд";
            if (key.Contains("raid") || key.Contains("ambush") || key.Contains("threat")) return "Опасность";
            if (key.Contains("site") || key.Contains("resource") || key.Contains("control")) return "Точка";
            if (key.Contains("trade") || key.Contains("production") || key.Contains("supply")) return "Экономика";
            if (key.Contains("lair")) return "Логово";
            return "Событие";
        }

        public string WorldFactionId()
        {
            string id = _self?["worldFactionId"]?.ToString() ?? _self?["factionId"]?.ToString() ?? string.Empty;
            return IsKnownFaction(id) ? CanonicalFactionId(id) : string.Empty;
        }

        public int FactionRelation(string id, string playerFaction)
        {
            string player = string.IsNullOrEmpty(playerFaction) ? "neutral" : playerFaction;
            if (id == player) return 100;
            JObject factions = _wasteland?["factions"] as JObject;
            float? direct = NullableFloat(factions?[id]?["relations"]?[player]);
            float? reverse = NullableFloat(factions?[player]?["relations"]?[id]);
            if (direct.HasValue && reverse.HasValue) return Mathf.RoundToInt((direct.Value + reverse.Value) * 0.5f);
            if (direct.HasValue) return Mathf.RoundToInt(direct.Value);
            if (reverse.HasValue) return Mathf.RoundToInt(reverse.Value);
            if (id == "raiders" || id == "mutants" || id == "wild") return -70;
            if (id == "neutral") return player == "neutral" ? 100 : 0;
            return player == "neutral" ? 0 : 10;
        }

        /// <summary>JSON null или отсутствие поля — false, а не исключение.</summary>
        private static bool Flag(JToken token)
        {
            return token != null && token.Type == JTokenType.Boolean && token.ToObject<bool>();
        }

        public void FactionStats(string factionId, out int sites, out int parties, out int contested)
        {
            sites = 0;
            parties = 0;
            contested = 0;
            foreach (JToken token in _wasteland?["sites"] as JArray ?? new JArray())
            {
                if (CanonicalFactionId(token?["owner"]?.ToString()) != factionId) continue;
                sites++;
                string state = token["controlState"]?.ToString() ?? string.Empty;
                if (state == "critical" || state == "contested" || state == "threatened"
                    || Mathf.Abs(Float(token["controlPressure"])) > 8f
                    || Flag(token["activeConflict"])) contested++;
            }
            foreach (JToken token in _wasteland?["parties"] as JArray ?? new JArray())
                if (CanonicalFactionId(token?["faction"]?.ToString()) == factionId
                    && !Flag(token?["destroyed"])
                    && token?["state"]?.ToString() != "destroyed") parties++;
        }

        public static string RelationLabel(string id, string playerFaction, int value)
        {
            string player = string.IsNullOrEmpty(playerFaction) ? "neutral" : playerFaction;
            if (id == player) return player == "neutral" ? "Вы нейтральны" : "Ваша фракция";
            string number = value > 0 ? "+" + value : value.ToString();
            if (value >= 70) return "Союзники · " + number;
            if (value >= 25) return "Дружественно · " + number;
            if (value > -25) return "Нейтрально · " + number;
            if (value > -60) return "Напряжённо · " + number;
            return "Враждебны · " + number;
        }

        public static bool IsJoinableFaction(string id)
        {
            return false;
        }

        public static bool IsKnownFaction(string id)
        {
            string canonical = CanonicalFactionId(id);
            return Array.IndexOf(PrimaryFactionIds, canonical) >= 0;
        }

        public static string CanonicalFactionId(string id)
        {
            string key = (id ?? string.Empty).ToLowerInvariant();
            if (key == "old_klim" || key == "klim_patrol") return "uprava";
            if (key == "scrap_union" || key == "scrap" || key == "scrap_town") return "free_artels";
            if (key == "relay_order" || key == "relay" || key == "relay_station") return "contour";
            if (key == "caravan" || key == "caravans") return "tract_league";
            return key;
        }

        public JObject FactionLore(string id)
        {
            string canonical = CanonicalFactionId(id);
            foreach (JToken token in _factionCatalog)
            {
                JObject row = token as JObject;
                if (row != null && CanonicalFactionId(row["id"]?.ToString()) == canonical) return row;
            }
            return null;
        }

        public static string FactionLabel(string id)
        {
            if (string.IsNullOrEmpty(id) || id == "neutral") return "Нейтралы";
            id = CanonicalFactionId(id);
            if (id == "uprava") return "Управа";
            if (id == "free_artels") return "Вольные артели";
            if (id == "contour") return "Контур";
            if (id == "tract_league") return "Лига Тракта";
            if (id == "seconds") return "Вторые";
            if (id == "continuity") return "Комитет преемственности";
            if (id == "raiders" || id == "ash_raiders") return "Рейдеры";
            if (id == "mutants") return "Мутанты";
            if (id == "wild") return "Дикие твари";
            if (id == "free_settlers") return "Свободные поселения";
            if (id == "iron_clans") return "Железные кланы";
            return id ?? "Нейтралы";
        }

        public static string TaskStateLabel(string state)
        {
            if (state == "active") return "активна";
            if (state == "completed") return "завершена";
            if (state == "failed") return "провалена";
            if (state == "expired") return "истекла";
            return state ?? "неизвестно";
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId ?? string.Empty;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private static int Int(JToken token, int fallback = 0)
        {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer) return token.Value<int>();
            if (token.Type == JTokenType.Float) return (int)Math.Round(token.Value<double>());
            return int.TryParse(token.ToString(), System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out int value) ? value : fallback;
        }

        private static float Float(JToken token, float fallback = 0f)
        {
            if (token == null) return fallback;
            try { return token.ToObject<float>(); }
            catch { return float.TryParse(token.ToString(), out float value) ? value : fallback; }
        }

        private static float? NullableFloat(JToken token)
        {
            if (token == null) return null;
            try { return token.ToObject<float>(); }
            catch { return float.TryParse(token.ToString(), out float value) ? value : (float?)null; }
        }

        private static double Double(JToken token, double fallback = 0d)
        {
            if (token == null) return fallback;
            try { return token.ToObject<double>(); }
            catch { return double.TryParse(token.ToString(), out double value) ? value : fallback; }
        }

    }
}
