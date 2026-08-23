using System;
using System.Collections;
using System.Collections.Generic;
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
        private Vector2 _skillsScroll;
        private Vector2 _talentsScroll;
        private Vector2 _statusScroll;
        private Vector2 _tasksScroll;
        private Vector2 _socialScroll;
        private Vector2 _worldScroll;
        private Vector2 _factionsScroll;
        private Vector2 _radioScroll;
        private JObject _wasteland;
        private bool _worldRequestPending;
        private float _worldRefreshAt;
        private string _worldError = string.Empty;
        private int _radioChannel;
        private Rect _stagingRect;
        private bool _stagingVisible;

        public bool IsOpen { get { return _open; } }

        /// <summary>Канва-версия окон включена: IMGUI-окно и своя клавиша молчат.</summary>
        public bool CanvasDriven { get; set; }

        /// <summary>Авторитетное самосостояние для новых окон (только чтение).</summary>
        public JObject Self { get { return _self; } }

        /// <summary>Идёт ли запрос прокачки и его статус — для блокировки кнопок.</summary>
        public bool ProgressionPending { get { return _pending; } }
        public string ProgressionStatus { get { return _status ?? string.Empty; } }

        // ---- Фасад для канва-страниц терминала (RoaPipboyCanvas) ----

        /// <summary>Авторитетная сводка пустоши (/api/wasteland → sim); null, пока не получена.</summary>
        public JObject Wasteland { get { return _wasteland; } }
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

        public void SubmitHeal(PublicPlayer target, string itemId)
        {
            if (_pending) return;
            HealNearby(target, itemId);
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
            { "Поселенческий маяк", "Пепельная частота", "Канал безопасности", "Тишина" };

        public static readonly string[] RadioDescriptions =
        {
            "Слабый сигнал караванов и местных объявлений.",
            "Фоновый шум, редкие пакеты данных из старых ретрансляторов.",
            "Автоматические предупреждения о рейдерах, ловушках и тайниках.",
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
                if (_open) return true;
                if (!_stagingVisible) return false;
                Vector3 mouse = Input.mousePosition;
                return _stagingRect.Contains(new Vector2(mouse.x, Screen.height - mouse.y));
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
            Socket.OnSocialStateUpdated += HandleSocialStateUpdated;
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
            Socket.OnSocialStateUpdated -= HandleSocialStateUpdated;
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

            if (!_pending || !_pendingProgression) return;
            int actual = RoaProgressionData.FindSkill(_pendingId) != null
                ? SkillPercent(_pendingId)
                : TalentRank(_pendingId);
            if (actual < _pendingRank) return;

            _pending = false;
            _pendingProgression = false;
            _status = "Сервер подтвердил: " + ProgressionName(_pendingId) + ".";
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

        private void ApplySocialState(JObject social)
        {
            if (social == null) return;
            if (_self == null) _self = new JObject();
            _self["socialState"] = social.DeepClone();
        }

        private void OnGUI()
        {
            if (CanvasDriven) return;
            RoaUiTheme.Apply();
            if (_self == null || Socket == null || Socket.Phase != RoaSocketClient.ConnectionPhase.Joined)
                return;

            if (!_open)
            {
                DrawCaravanStaging();
                return;
            }
            _stagingVisible = false;

            float width = Mathf.Min(840f, Screen.width - 28f);
            float height = Mathf.Min(690f, Screen.height - 28f);
            var area = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f, width, height);
            GUILayout.BeginArea(area, GUI.skin.window);

            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>PIP-BOY · " + (_self["name"]?.ToString() ?? "Персонаж") + "</b>", Rich(), GUILayout.ExpandWidth(true));
            if (GUILayout.Button("Закрыть [P]", GUILayout.Width(118f))) _open = false;
            GUILayout.EndHorizontal();

            GUILayout.BeginHorizontal();
            DrawTabButton(Tab.Status, "Статус");
            DrawTabButton(Tab.Skills, "Навыки");
            DrawTabButton(Tab.Talents, "Таланты");
            DrawTabButton(Tab.Tasks, "Работы");
            DrawTabButton(Tab.Social, "Друзья и клан");
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            DrawTabButton(Tab.World, "Мир");
            DrawTabButton(Tab.Factions, "Фракции");
            DrawTabButton(Tab.Radio, "Радио");
            GUILayout.EndHorizontal();

            GUILayout.Space(4f);
            GUILayout.Label(HeaderLine());
            if (!string.IsNullOrEmpty(_status)) GUILayout.Label(_status, Wrap());
            GUILayout.Space(4f);

            if (_tab == Tab.Status) DrawStatus();
            else if (_tab == Tab.Skills) DrawSkills();
            else if (_tab == Tab.Talents) DrawTalents();
            else if (_tab == Tab.Tasks) DrawTasks();
            else if (_tab == Tab.Social) DrawSocial();
            else if (_tab == Tab.World) DrawWorld();
            else if (_tab == Tab.Factions) DrawFactions();
            else DrawRadio();

            GUILayout.EndArea();
        }

        private void DrawCaravanStaging()
        {
            JObject task = StagingCaravanTask();
            if (task == null)
            {
                _stagingVisible = false;
                return;
            }

            float width = Mathf.Min(420f, Screen.width - 24f);
            _stagingRect = new Rect((Screen.width - width) * 0.5f, 82f, width, 174f);
            _stagingVisible = true;
            GUILayout.BeginArea(_stagingRect, GUI.skin.window);
            GUILayout.Label("<b>Сбор каравана</b> · " + (task["title"]?.ToString() ?? "Ожидание выхода"), Rich());

            JObject details = task["details"] as JObject ?? new JObject();
            string from = WorldSiteName(_wasteland?["sites"] as JArray, details["stagingSiteId"]?.ToString());
            string to = WorldSiteName(_wasteland?["sites"] as JArray, details["destinationSiteId"]?.ToString());
            if (!string.IsNullOrEmpty(from) || !string.IsNullOrEmpty(to))
                GUILayout.Label("Погрузка: " + from + " → " + to, Wrap());

            float? seconds = StagingSecondsLeft(task);
            GUILayout.Label(seconds.HasValue && seconds.Value > 0f
                ? "До выхода: " + FormatCountdown(seconds.Value)
                : "Караван выходит", GUI.skin.box);
            int players = Int(details["playerCount"]);
            int limit = Int(details["playerLimit"]);
            GUILayout.Label(limit > 0 ? "В очереди: " + players + " из " + limit : "В очереди: " + players);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Открыть работы"))
            {
                _tab = Tab.Tasks;
                _open = true;
            }
            GUI.enabled = !_pending;
            if (GUILayout.Button("Выйти из очереди")) SendWorldTaskAction(task["id"]?.ToString(), "cancel");
            GUI.enabled = true;
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        private void DrawTabButton(Tab tab, string title)
        {
            bool selected = _tab == tab;
            GUI.enabled = !selected;
            if (GUILayout.Button(selected ? "▶ " + title : title, GUILayout.Height(28f))) _tab = tab;
            GUI.enabled = true;
        }

        private string HeaderLine()
        {
            int level = Int(_self["level"], 1);
            int xp = Int(_self["xp"]);
            int needed = Int(_self["xpNeeded"], 100);
            return "Уровень " + level + "   ·   XP " + xp + "/" + needed
                + "   ·   очки навыков " + Int(_self["skillPoints"])
                + "   ·   очки перков " + Int(_self["perkPoints"]);
        }

        private void DrawStatus()
        {
            _statusScroll = GUILayout.BeginScrollView(_statusScroll);
            GUILayout.Label("<b>SPECIAL</b>", Rich());
            JObject special = _self["special"] as JObject ?? new JObject();
            JObject talents = _self["talentRanks"] as JObject ?? new JObject();
            string[] ids = { "str", "per", "end", "cha", "int", "agi", "luck" };
            string[] names = { "Сила", "Восприятие", "Выносливость", "Харизма", "Интеллект", "Ловкость", "Удача" };
            for (int i = 0; i < ids.Length; i++)
            {
                int baseValue = Int(special[ids[i]], 5);
                int bonus = Int(talents["special" + char.ToUpperInvariant(ids[i][0]) + ids[i].Substring(1)]);
                GUILayout.Label(names[i] + ": " + (baseValue + bonus) + (bonus > 0 ? "  (база " + baseValue + ")" : string.Empty));
            }

            GUILayout.Space(8f);
            GUILayout.Label("<b>Состояние</b>", Rich());
            GUILayout.Label("HP " + Int(_self["hp"]) + "/" + Int(_self["maxHp"], 100)
                + "   ·   AP " + Float(_self["ap"]).ToString("0.#") + "/" + Int(_self["maxAp"]));
            GUILayout.Label("Фракция: " + FactionLabel(_self["worldFactionId"]?.ToString() ?? _self["factionId"]?.ToString()));
            JObject injuries = _self["injuries"] as JObject;
            var injuryNames = new List<string>();
            if (injuries?["brokenArm"]?.ToObject<bool>() == true) injuryNames.Add("перелом руки");
            if (injuries?["brokenLeg"]?.ToObject<bool>() == true) injuryNames.Add("перелом ноги");
            if (injuries?["concussion"]?.ToObject<bool>() == true) injuryNames.Add("сотрясение");
            if (injuries?["infection"]?.ToObject<bool>() == true) injuryNames.Add("инфекция");
            GUILayout.Label("Травмы: " + (injuryNames.Count > 0 ? string.Join(", ", injuryNames) : "нет"));

            GUILayout.Space(8f);
            GUILayout.Label("<b>Экипировка</b>", Rich());
            JObject equipment = _self["equipmentRuntime"] as JObject ?? _self["equipment"] as JObject ?? new JObject();
            foreach (string slot in new[] { "weapon", "offhand", "armor", "helmet", "boots", "backpack" })
            {
                string item = equipment[slot]?.ToString();
                GUILayout.Label(EquipmentSlotLabel(slot) + ": " + (string.IsNullOrEmpty(item) ? "—" : RoaItemData.Name(item)));
            }

            JObject quests = _self["npcQuests"] as JObject;
            if (quests != null && quests.Count > 0)
            {
                GUILayout.Space(8f);
                GUILayout.Label("<b>Локальные задания</b>", Rich());
                foreach (KeyValuePair<string, JToken> entry in quests)
                    GUILayout.Label(entry.Key + ": " + QuestStateLabel(entry.Value?.ToString()));
            }
            GUILayout.EndScrollView();
        }

        private void DrawTasks()
        {
            _tasksScroll = GUILayout.BeginScrollView(_tasksScroll);
            JArray records = _self["worldTaskRecords"] as JArray;
            if (records == null || records.Count == 0)
            {
                GUILayout.Label("Активных или отслеживаемых работ нет. Возьмите работу у доски поселения.");
                GUILayout.EndScrollView();
                return;
            }

            string trackedId = _self["worldTaskTrackedId"]?.ToString() ?? string.Empty;
            foreach (JToken task in records)
            {
                string id = task["id"]?.ToString() ?? string.Empty;
                string state = task["status"]?.ToString() ?? "active";
                bool accepted = ArrayContains(_self["worldTaskAccepted"] as JArray, id);
                bool claimed = ArrayContains(_self["worldTaskRewardClaims"] as JArray, id);
                bool rewardEligible = task["rewardEligible"]?.ToObject<bool>() == true;
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + (task["title"]?.ToString() ?? id) + "</b>"
                    + (trackedId == id ? "  ★ отслеживается" : string.Empty), Rich());
                string description = task["description"]?.ToString() ?? task["text"]?.ToString();
                if (!string.IsNullOrEmpty(description)) GUILayout.Label(description, Wrap());
                JObject reward = task["reward"] as JObject;
                if (reward != null)
                    GUILayout.Label("Награда: " + Int(reward["xp"]) + " XP, " + Int(reward["caps"]) + " крышек");
                GUILayout.Label("Состояние: " + TaskStateLabel(state));

                GUI.enabled = !_pending;
                GUILayout.BeginHorizontal();
                if (accepted && state == "active"
                    && GUILayout.Button(trackedId == id ? "Снять метку" : "Отслеживать"))
                    SendWorldTaskAction(id, "track");
                if (accepted && state == "active" && task["type"]?.ToString() == "deliver_supplies"
                    && GUILayout.Button("Доставить"))
                    SendWorldTaskAction(id, "deliver");
                if (state == "completed" && rewardEligible && !claimed && GUILayout.Button("Получить награду"))
                    SendWorldTaskAction(id, "claim");
                if ((accepted || trackedId == id) && state != "completed" && GUILayout.Button("Отменить"))
                    SendWorldTaskAction(id, "cancel");
                GUILayout.EndHorizontal();
                GUI.enabled = true;
                GUILayout.EndVertical();
            }
            GUILayout.EndScrollView();
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
                    _worldError = string.Empty;
                }
                catch (Exception error)
                {
                    _worldError = "Не удалось прочитать сводку пустоши: " + error.Message;
                }
            }
            _worldRequestPending = false;
        }

        private void DrawWorld()
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>Живая пустошь</b>", Rich(), GUILayout.ExpandWidth(true));
            GUI.enabled = !_worldRequestPending;
            if (GUILayout.Button(_worldRequestPending ? "Обновление…" : "Обновить", GUILayout.Width(112f)))
                _worldRefreshAt = 0f;
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            if (!string.IsNullOrEmpty(_worldError)) GUILayout.Label(_worldError, Wrap());
            if (_wasteland == null)
            {
                GUILayout.Label(_worldRequestPending ? "Получаем авторитетную сводку сервера…" : "Данных мира пока нет.");
                return;
            }

            JArray sites = _wasteland["sites"] as JArray ?? new JArray();
            JArray parties = _wasteland["parties"] as JArray ?? new JArray();
            JArray events = _wasteland["events"] as JArray ?? new JArray();
            int activeParties = 0;
            foreach (JToken row in parties)
                if (row?["destroyed"]?.ToObject<bool>() != true && row?["state"]?.ToString() != "destroyed") activeParties++;

            GUILayout.BeginHorizontal(GUI.skin.box);
            GUILayout.Label("Час мира: " + Mathf.FloorToInt(Float(_wasteland["worldHour"])), GUILayout.ExpandWidth(true));
            GUILayout.Label("Точки: " + sites.Count, GUILayout.ExpandWidth(true));
            GUILayout.Label("Группы: " + activeParties, GUILayout.ExpandWidth(true));
            GUILayout.Label("Караваны: " + Int(_wasteland["stats"]?["caravansArrived"])
                + "/" + Int(_wasteland["stats"]?["caravansLost"]), GUILayout.ExpandWidth(true));
            GUILayout.EndHorizontal();

            _worldScroll = GUILayout.BeginScrollView(_worldScroll);
            GUILayout.Label("<b>Поселения</b>", Rich());
            DrawWorldSites(sites, true, 6);
            GUILayout.Space(6f);
            GUILayout.Label("<b>Ресурсы и аванпосты</b>", Rich());
            DrawWorldSites(sites, false, 10);
            GUILayout.Space(6f);
            GUILayout.Label("<b>Группы на карте</b>", Rich());
            int shown = 0;
            foreach (JToken token in parties)
            {
                if (shown >= 8) break;
                JObject party = token as JObject;
                if (party == null || party["destroyed"]?.ToObject<bool>() == true
                    || party["state"]?.ToString() == "destroyed") continue;
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + PartyKindLabel(party["kind"]?.ToString()) + ": "
                    + (party["name"]?.ToString() ?? party["id"]?.ToString() ?? "Группа") + "</b>", Rich());
                GUILayout.Label(FactionLabel(party["faction"]?.ToString()) + " · бойцов "
                    + Int(party["members"]) + " · сила " + Int(party["strength"]));
                string destination = party["destinationSiteId"]?.ToString();
                GUILayout.Label(string.IsNullOrEmpty(destination)
                    ? PartyStateLabel(party["state"]?.ToString())
                    : "Путь к: " + WorldSiteName(sites, destination));
                GUILayout.EndVertical();
                shown++;
            }
            if (shown == 0) GUILayout.Label("Активных групп нет.");

            GUILayout.Space(6f);
            GUILayout.Label("<b>Последние события</b>", Rich());
            shown = 0;
            foreach (JToken token in events)
            {
                if (shown++ >= 8) break;
                GUILayout.BeginHorizontal(GUI.skin.box);
                GUILayout.Label(EventTypeLabel(token?["type"]?.ToString()), GUILayout.Width(92f));
                GUILayout.Label(token?["title"]?.ToString() ?? token?["text"]?.ToString() ?? "Событие мира", Wrap());
                GUILayout.EndHorizontal();
            }
            if (shown == 0) GUILayout.Label("Событий пока нет.");
            GUILayout.EndScrollView();
        }

        private void DrawWorldSites(JArray sites, bool settlements, int limit)
        {
            int shown = 0;
            float worldHour = Float(_wasteland?["worldHour"]);
            foreach (JToken token in sites)
            {
                if (shown >= limit) break;
                JObject site = token as JObject;
                if (site == null) continue;
                bool isSettlement = string.Equals(site["type"]?.ToString(), "settlement", StringComparison.OrdinalIgnoreCase);
                if (isSettlement != settlements) continue;
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + (site["name"]?.ToString() ?? site["id"]?.ToString() ?? "Точка") + "</b> · "
                    + SiteTypeLabel(site["type"]?.ToString()), Rich());
                GUILayout.Label(SiteStatusLabel(site, worldHour) + " · " + FactionLabel(site["owner"]?.ToString()));
                GUILayout.Label((isSettlement ? "Безопасность " + Int(site["security"]) : "Контроль " + Float(site["controlPressure"]).ToString("0.0"))
                    + " · Запасы: " + StockText(site["stockpile"] as JObject), Wrap());
                GUILayout.EndVertical();
                shown++;
            }
            if (shown == 0) GUILayout.Label(settlements ? "Поселений нет." : "Других точек мира нет.");
        }

        private void DrawFactions()
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>Отношения фракций</b>", Rich(), GUILayout.ExpandWidth(true));
            GUI.enabled = !_worldRequestPending;
            if (GUILayout.Button(_worldRequestPending ? "Обновление…" : "Обновить", GUILayout.Width(112f)))
                _worldRefreshAt = 0f;
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            if (!string.IsNullOrEmpty(_worldError)) GUILayout.Label(_worldError, Wrap());
            if (_wasteland == null)
            {
                GUILayout.Label(_worldRequestPending ? "Получаем авторитетную сводку сервера…" : "Данных фракций пока нет.");
                return;
            }

            string playerFaction = WorldFactionId();
            GUILayout.Label("Текущая сторона: " + (string.IsNullOrEmpty(playerFaction)
                ? "Независимый странник" : FactionLabel(playerFaction)), GUI.skin.box);
            _factionsScroll = GUILayout.BeginScrollView(_factionsScroll);
            string[] ids = { "old_klim", "scrap_union", "relay_order", "caravans", "neutral", "raiders", "mutants", "wild" };
            foreach (string id in ids)
            {
                int relation = FactionRelation(id, playerFaction);
                int sites;
                int parties;
                int contested;
                FactionStats(id, out sites, out parties, out contested);
                int reputation = Int(_self?["worldFactionReputation"]?[id]);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.BeginHorizontal();
                GUILayout.Label("<b>" + FactionLabel(id) + "</b>", Rich(), GUILayout.ExpandWidth(true));
                GUILayout.Label(RelationLabel(id, playerFaction, relation), GUILayout.Width(190f));
                GUILayout.EndHorizontal();
                string extra = IsJoinableFaction(id) ? " · репутация " + reputation : string.Empty;
                GUILayout.Label("Точки " + sites + " · отряды " + parties + " · спорные " + contested + extra);
                GUILayout.EndVertical();
            }
            GUILayout.EndScrollView();
        }

        private void DrawRadio()
        {
            string[] titles = { "Поселенческий маяк", "Пепельная частота", "Канал безопасности", "Тишина" };
            string[] descriptions =
            {
                "Слабый сигнал караванов и местных объявлений.",
                "Фоновый шум, редкие пакеты данных из старых ретрансляторов.",
                "Автоматические предупреждения о рейдерах, ловушках и тайниках.",
                "Приёмник отключён; остаётся только системный журнал."
            };
            _radioScroll = GUILayout.BeginScrollView(_radioScroll);
            for (int i = 0; i < titles.Length; i++)
            {
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.BeginHorizontal();
                GUILayout.Label((i == _radioChannel ? "▶ " : string.Empty) + "<b>" + titles[i] + "</b>", Rich(), GUILayout.ExpandWidth(true));
                GUI.enabled = i != _radioChannel;
                if (GUILayout.Button(i == _radioChannel ? "Выбрано" : "Настроить", GUILayout.Width(96f))) _radioChannel = i;
                GUI.enabled = true;
                GUILayout.EndHorizontal();
                GUILayout.Label(descriptions[i], Wrap());
                GUILayout.EndVertical();
            }
            GUILayout.EndScrollView();
        }

        private void DrawSkills()
        {
            DrawSpecial();
            GUILayout.Label("Каждое очко поднимает навык на 5%. Возврат и перераспределение сервер не разрешает.", Wrap());
            _skillsScroll = GUILayout.BeginScrollView(_skillsScroll);

            string group = string.Empty;
            foreach (RoaProgressionData.SkillDef skill in RoaProgressionData.Skills)
            {
                if (group != skill.Group)
                {
                    group = skill.Group;
                    GUILayout.Space(5f);
                    GUILayout.Label("<b>" + group + "</b>", Rich());
                }

                int value = SkillPercent(skill.Id);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.BeginHorizontal();
                GUILayout.Label(skill.Name, GUILayout.Width(220f));
                GUILayout.Label(value + "%", GUILayout.Width(62f));
                GUILayout.Label(IsTagged(skill.Id) ? "профильный" : string.Empty, GUILayout.Width(110f));
                GUI.enabled = !_pending && Int(_self["skillPoints"]) > 0 && value < 100;
                if (GUILayout.Button("+5%", GUILayout.Width(72f))) RequestSkill(skill.Id, value);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
                GUILayout.Label(skill.Description, Wrap());
                GUILayout.EndVertical();
            }

            GUILayout.EndScrollView();
        }

        private void DrawSpecial()
        {
            GUILayout.BeginHorizontal(GUI.skin.box);
            DrawStat("ST", "str");
            DrawStat("PE", "per");
            DrawStat("EN", "end");
            DrawStat("CH", "cha");
            DrawStat("IN", "int");
            DrawStat("AG", "agi");
            DrawStat("LK", "luck");
            GUILayout.EndHorizontal();
        }

        private void DrawStat(string code, string id)
        {
            GUILayout.Label(code + " " + EffectiveSpecial(id), GUILayout.ExpandWidth(true));
        }

        private void DrawTalents()
        {
            GUILayout.Label("Перк даётся каждый третий уровень. Все требования повторно проверяет сервер.", Wrap());
            _talentsScroll = GUILayout.BeginScrollView(_talentsScroll);

            string group = string.Empty;
            foreach (RoaProgressionData.TalentDef talent in RoaProgressionData.Talents)
            {
                if (group != talent.Group)
                {
                    group = talent.Group;
                    GUILayout.Space(6f);
                    GUILayout.Label("<b>" + group + "</b>", Rich());
                }

                int rank = TalentRank(talent.Id);
                bool requirements = TalentRequirementsMet(talent);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.BeginHorizontal();
                GUILayout.Label(talent.Name, GUILayout.Width(265f));
                GUILayout.Label(rank + "/" + talent.MaxRank, GUILayout.Width(48f));
                GUILayout.Label(RequirementText(talent), Wrap(), GUILayout.ExpandWidth(true));
                GUI.enabled = !_pending && requirements && Int(_self["perkPoints"]) > 0 && rank < talent.MaxRank;
                if (GUILayout.Button("Изучить", GUILayout.Width(88f))) RequestTalent(talent.Id, rank);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
                GUILayout.Label(talent.Description, Wrap());
                GUILayout.EndVertical();
            }

            GUILayout.EndScrollView();
        }

        private void DrawSocial()
        {
            _socialScroll = GUILayout.BeginScrollView(_socialScroll);
            DrawNearbyPlayer();

            JObject social = SocialState();
            GUILayout.Space(8f);
            GUILayout.Label("<b>Друзья</b>", Rich());
            DrawEntries(social["friends"] as JArray, "removeFriend", "Удалить");

            GUILayout.Label("<b>Заявки в друзья</b>", Rich());
            DrawRequestEntries(social["friendRequests"] as JArray, "acceptFriend", "declineFriend");

            GUILayout.Space(8f);
            GUILayout.Label("<b>Клан</b>", Rich());
            DrawClan(social);
            GUILayout.EndScrollView();
        }

        private void DrawNearbyPlayer()
        {
            GUILayout.Label("<b>Игрок рядом</b>", Rich());
            if (Player == null || RemotePlayers == null
                || !RemotePlayers.TryGetNearest(Player.transform.position, 4.5f, out PublicPlayer target, out float distance))
            {
                GUILayout.Label("Подойдите к другому игроку на 4.5 м.");
                return;
            }

            GUILayout.BeginHorizontal(GUI.skin.box);
            GUILayout.Label((target.Name ?? "Игрок") + " · ур. " + target.Level + " · " + distance.ToString("0.0") + " м", GUILayout.ExpandWidth(true));
            GUI.enabled = !_pending;
            if (GUILayout.Button("Торговля", GUILayout.Width(95f))) SendNearbyAction(target, "trade");
            if (GUILayout.Button("В друзья", GUILayout.Width(105f))) SendNearbyAction(target, "friend");
            bool hasClan = !string.IsNullOrEmpty(SocialState()["clan"]?["name"]?.ToString());
            GUI.enabled = !_pending && hasClan;
            if (GUILayout.Button("В клан", GUILayout.Width(90f))) SendNearbyAction(target, "clan");
            GUI.enabled = true;
            GUILayout.EndHorizontal();

            GUILayout.BeginHorizontal();
            bool withinHealRange = distance <= RemoteHealRange;
            string rangeHint = withinHealRange ? string.Empty : " · подойдите ближе";
            GUILayout.Label("Лечение: " + target.Hp + "/" + target.MaxHp + " HP" + rangeHint, GUILayout.Width(205f));
            DrawHealButton(target, "medkit", "Аптечка", withinHealRange && target.Hp < target.MaxHp);
            DrawHealButton(target, "stim", "Стимулятор", withinHealRange && target.Hp < target.MaxHp);
            DrawHealButton(target, "doctorBag", "Доктор", withinHealRange && HasTreatableInjury(target));
            DrawHealButton(target, "antibiotics", "Антибиотик", withinHealRange && HasInjury(target, "infection"));
            GUILayout.EndHorizontal();
        }

        private void DrawHealButton(PublicPlayer target, string itemId, string label, bool applicable)
        {
            int qty = InventoryQty(itemId);
            GUI.enabled = !_pending && applicable && qty > 0;
            if (GUILayout.Button(label + " (" + qty + ")", GUILayout.ExpandWidth(true))) HealNearby(target, itemId);
            GUI.enabled = true;
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
                if (ack["target"] is JObject targetState)
                    RemotePlayers?.ApplyPublicPlayer(targetState.ToObject<PublicPlayer>());
                string cured = ack["curedInjury"]?.ToString();
                int healed = Int(ack["healed"]);
                _status = !string.IsNullOrEmpty(cured)
                    ? (target.Name ?? "Игрок") + ": вылечено — " + cured
                    : (target.Name ?? "Игрок") + ": HP +" + healed;
            });
        }

        private void DrawEntries(JArray entries, string action, string actionLabel)
        {
            if (entries == null || entries.Count == 0)
            {
                GUILayout.Label("— пусто —");
                return;
            }

            foreach (JToken entry in entries)
            {
                GUILayout.BeginHorizontal(GUI.skin.box);
                GUILayout.Label(SocialEntryLabel(entry), GUILayout.ExpandWidth(true));
                GUI.enabled = !_pending;
                if (GUILayout.Button(actionLabel, GUILayout.Width(92f)))
                    SendSocialStateAction(action, entry["id"]?.ToString());
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
        }

        private void DrawRequestEntries(JArray entries, string accept, string decline)
        {
            if (entries == null || entries.Count == 0)
            {
                GUILayout.Label("— пусто —");
                return;
            }

            foreach (JToken entry in entries)
            {
                string id = entry["id"]?.ToString();
                GUILayout.BeginHorizontal(GUI.skin.box);
                GUILayout.Label(SocialEntryLabel(entry), GUILayout.ExpandWidth(true));
                GUI.enabled = !_pending;
                if (GUILayout.Button("Принять", GUILayout.Width(88f))) SendSocialStateAction(accept, id);
                if (GUILayout.Button("Отклонить", GUILayout.Width(92f))) SendSocialStateAction(decline, id);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
        }

        private void DrawClan(JObject social)
        {
            JObject clan = social["clan"] as JObject;
            string clanName = clan?["name"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(clanName))
            {
                GUILayout.BeginHorizontal();
                _clanName = GUILayout.TextField(_clanName, 42, GUILayout.ExpandWidth(true));
                GUI.enabled = !_pending && _clanName.Trim().Length >= 3;
                if (GUILayout.Button("Создать клан", GUILayout.Width(125f)))
                    SendSocialStateAction("createClan", null, _clanName.Trim());
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
            else
            {
                GUILayout.BeginHorizontal(GUI.skin.box);
                GUILayout.Label(clanName + " · " + (clan["role"]?.ToString() ?? "Участник"), GUILayout.ExpandWidth(true));
                GUI.enabled = !_pending;
                if (GUILayout.Button("Покинуть", GUILayout.Width(95f))) SendSocialStateAction("leaveClan");
                GUI.enabled = true;
                GUILayout.EndHorizontal();
                DrawPlainEntries(clan["members"] as JArray, "Участники");
            }

            GUILayout.Label("<b>Приглашения в клан</b>", Rich());
            DrawRequestEntries(social["clanInvites"] as JArray, "acceptClan", "declineClan");
        }

        private void DrawPlainEntries(JArray entries, string label)
        {
            GUILayout.Label("<b>" + label + "</b>", Rich());
            if (entries == null || entries.Count == 0)
            {
                GUILayout.Label("— пока нет —");
                return;
            }
            foreach (JToken entry in entries) GUILayout.Label(SocialEntryLabel(entry), GUI.skin.box);
        }

        private void RequestSkill(string id, int current)
        {
            JObject ranks = (_self["skillRanks"] as JObject)?.DeepClone() as JObject ?? new JObject();
            ranks[id] = Mathf.Min(100, current + 5);
            BeginProgressionRequest(id, current + 5);
            Socket.SendProgressionProfile(ranks, null);
        }

        private void RequestTalent(string id, int current)
        {
            JObject ranks = (_self["talentRanks"] as JObject)?.DeepClone() as JObject ?? new JObject();
            ranks[id] = current + 1;
            BeginProgressionRequest(id, current + 1);
            Socket.SendProgressionProfile(null, ranks);
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
            Socket.EmitWithAck("socialAction", new { targetId = target.Id, action }, ack =>
            {
                _pending = false;
                if (ack == null || ack["ok"]?.ToObject<bool>() == false)
                {
                    Socket.ApplyGameplayAck(ack);
                    _status = ack?["error"]?.ToString() ?? "Социальное действие не выполнено.";
                    return;
                }
                Socket.ApplyGameplayAck(ack);
                _status = ack["message"]?.ToString() ?? "Запрос отправлен игроку " + (target.Name ?? "игрок") + ".";
            });
        }

        private void SendSocialStateAction(string action, string targetId = null, string clanName = null)
        {
            var payload = new JObject { ["action"] = action };
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
            _status = "Сервер обновляет работу…";
            Socket.EmitWithAck("worldTaskAction", new { taskId, action }, ack =>
            {
                _pending = false;
                Socket.ApplyGameplayAck(ack);
                if (ack == null || ack["ok"]?.ToObject<bool>() != true)
                {
                    _status = ack?["error"]?.ToString() ?? "Работа не обновлена.";
                    return;
                }
                if (action == "track") _status = string.IsNullOrEmpty(ack["trackedId"]?.ToString())
                    ? "Метка работы снята." : "Работа отслеживается.";
                else if (action == "deliver") _status = "Припасы доставлены.";
                else if (action == "claim")
                {
                    JObject reward = ack["reward"] as JObject;
                    _status = "Награда получена: " + Int(reward?["xp"]) + " XP, "
                        + Int(reward?["caps"]) + " крышек.";
                }
                else if (action == "cancel") _status = "Работа отменена.";
                else _status = "Работа обновлена.";
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
                case "wanderer": value = 10 + end + per + luck * 2; break;
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
            if (!string.IsNullOrEmpty(talent.Stat)) rows.Add(talent.Stat.ToUpperInvariant() + " " + talent.StatValue);
            if (!string.IsNullOrEmpty(talent.Stat2)) rows.Add(talent.Stat2.ToUpperInvariant() + " " + talent.StatValue2);
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

        private static string EquipmentSlotLabel(string slot)
        {
            if (slot == "weapon") return "Оружие";
            if (slot == "offhand") return "Вторая рука";
            if (slot == "armor") return "Броня";
            if (slot == "helmet") return "Шлем";
            if (slot == "boots") return "Обувь";
            if (slot == "backpack") return "Рюкзак";
            return slot;
        }

        public static string WorldSiteName(JArray sites, string id)
        {
            foreach (JToken token in sites ?? new JArray())
                if (token?["id"]?.ToString() == id)
                    return token["name"]?.ToString() ?? id;
            return string.IsNullOrEmpty(id) ? "отмеченной точке" : id;
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
                case "wanderer": value = 10 + end + per + luck * 2; break;
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
                case "wanderer": formula = "10 + EN + PE + LK×2 = " + (10 + end + per + luck * 2); break;
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
            if (id == "silver") return "крышки";
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
            if (key == "raider") return "Рейдеры";
            if (key == "monster") return "Монстры";
            return "Группа";
        }

        public static string PartyStateLabel(string state)
        {
            string key = (state ?? string.Empty).ToLowerInvariant();
            if (key == "idle") return "на стоянке";
            if (key == "moving") return "в пути";
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
            return IsJoinableFaction(id) ? id : string.Empty;
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
                if (token?["owner"]?.ToString() != factionId) continue;
                sites++;
                string state = token["controlState"]?.ToString() ?? string.Empty;
                if (state == "critical" || state == "contested" || state == "threatened"
                    || Mathf.Abs(Float(token["controlPressure"])) > 8f
                    || Flag(token["activeConflict"])) contested++;
            }
            foreach (JToken token in _wasteland?["parties"] as JArray ?? new JArray())
                if (token?["faction"]?.ToString() == factionId
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
            return id == "old_klim" || id == "scrap_union" || id == "relay_order" || id == "caravans";
        }

        public static string FactionLabel(string id)
        {
            if (string.IsNullOrEmpty(id) || id == "neutral") return "Нейтралы";
            if (id == "old_klim") return "Старый Клим";
            if (id == "scrap_union") return "Свалочный союз";
            if (id == "relay_order") return "Орден Ретранслятора";
            if (id == "caravans" || id == "caravan") return "Вольные караваны";
            if (id == "raiders" || id == "ash_raiders") return "Рейдеры";
            if (id == "mutants") return "Супермутанты";
            if (id == "wild") return "Дикие твари";
            if (id == "free_settlers") return "Свободные поселения";
            if (id == "iron_clans") return "Железные кланы";
            return id ?? "Нейтралы";
        }

        private static string QuestStateLabel(string state)
        {
            if (state == "active") return "выполняется";
            if (state == "completed") return "завершено";
            if (state == "failed") return "провалено";
            if (state == "cancelled" || state == "canceled") return "отменено";
            return state ?? "неизвестно";
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

        private static GUIStyle Rich()
        {
            var style = new GUIStyle(GUI.skin.label) { richText = true };
            return style;
        }

        private static GUIStyle Wrap()
        {
            var style = new GUIStyle(GUI.skin.label) { wordWrap = true };
            return style;
        }
    }
}
