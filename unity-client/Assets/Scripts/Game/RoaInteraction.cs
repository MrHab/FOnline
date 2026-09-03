using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единый контур взаимодействий локальной сцены: дружественные NPC, диалоги,
    /// задания, бартер, трупы и серверные контейнеры.
    ///
    /// Компонент ничего не переносит между инвентарями локально. Любая сделка,
    /// награда, взлом и добыча применяются только из ack с каноническим self.
    /// </summary>
    public sealed class RoaInteraction : MonoBehaviour
    {
        public string BaseUrl = "http://127.0.0.1:3000";
        public RoaSocketClient Socket;
        public RoaEnemies Enemies;
        public RoaFogOfWar Fog;
        public RoaPlayerController Player;
        public RoaLocationLoader Loader;
        public RoaGroundItems GroundItems;

        public bool WorldTaskActionPending { get { return _worldRequestPending; } }

        public bool IsWorldTaskAccepted(string taskId)
        {
            if (string.IsNullOrEmpty(taskId)) return false;
            foreach (JToken token in _self?["worldTaskAccepted"] as JArray ?? new JArray())
                if (token?.ToString() == taskId) return true;
            return false;
        }

        public bool IsWorldTaskTracked(string taskId)
        {
            return !string.IsNullOrEmpty(taskId)
                && _self?["worldTaskTrackedId"]?.ToString() == taskId;
        }

        public JObject WorldTaskRecord(string taskId)
        {
            if (string.IsNullOrEmpty(taskId)) return null;
            foreach (string key in new[] { "worldActivities", "worldTasks" })
            {
                foreach (JToken token in _world?[key] as JArray ?? new JArray())
                {
                    JObject task = token as JObject;
                    if (task?["id"]?.ToString() == taskId) return task;
                }
            }
            return null;
        }

        public void RefreshWorldTasks()
        {
            if (!_worldRequestPending) StartCoroutine(LoadWastelandState());
        }

        [Tooltip("Клавиша взаимодействия с ближайшей целью.")]
        public KeyCode InteractKey = KeyCode.E;
        public bool KeyboardInputEnabled = true;

        [Tooltip("Радиус выбора NPC и трупов. Сервер дополнительно проверяет дистанцию.")]
        public float ActorRange = 4.4f;

        [Tooltip("Радиус выбора контейнеров. Сервер разрешает открытие не дальше 3.2 м.")]
        public float ContainerRange = 3.1f;

        private enum TargetKind { None, Actor, Container, TradeMachine, Storage, Resource, CraftingStation, JobBoard, Transition }
        private enum PanelKind { None, Npc, Trade, MachineTrade, Storage, Corpse, Container, Crafting, JobBoard }
        private enum QuantityKind { None, TradeBuy, TradeSell, StorageDeposit, StorageWithdraw, Loot }

        private sealed class ContainerView
        {
            public JObject Data;
            public GameObject Root;
            public GameObject Placeholder;
            public RoaVisibilityGate Gate;
            public string ModelKey;
        }

        private sealed class StaticTarget
        {
            public TargetKind Kind;
            public JObject Data;
            public Vector3 Position;
            public float Range;
            public GameObject Marker;
        }

        private sealed class ResourceView
        {
            public JObject Data;
            public Vector3 Position;
            public GameObject Marker;
        }

        private static readonly Dictionary<string, Task<GltfImport>> ModelCache =
            new Dictionary<string, Task<GltfImport>>();

        private readonly Dictionary<string, ContainerView> _containers =
            new Dictionary<string, ContainerView>();
        private readonly Dictionary<string, ResourceView> _resources =
            new Dictionary<string, ResourceView>();
        private readonly HashSet<string> _authoredResourceIds = new HashSet<string>();
        private readonly List<StaticTarget> _staticTargets = new List<StaticTarget>();
        private readonly Dictionary<string, int> _tradeBuys = new Dictionary<string, int>();
        private readonly Dictionary<string, int> _tradeSells = new Dictionary<string, int>();

        private bool _attached;
        private TargetKind _candidateKind;
        private JObject _candidate;
        private Vector3 _candidatePosition;
        private PanelKind _panel;
        private JObject _active;
        private JObject _market;
        private JObject _self;
        private JObject _quests = new JObject();
        private JObject _world = new JObject();
        private Vector2 _scroll;
        private string _status = string.Empty;
        private float _statusUntil;
        private float _nextCorpseHoldAt;
        private float _nextDialogueFocusAt;
        private int _mapWidth = 40;
        private int _mapDepth = 40;
        private string _locationId = string.Empty;
        private bool _locationReady;
        private bool _encounterLocation;
        private bool _craftPending;
        private bool _harvestPending;
        private bool _robPending;
        private bool _worldRequestPending;
        private bool _tradePending;
        private bool _transitionPending;
        private Material _transitionMaterial;
        private QuantityKind _quantityKind;
        private string _quantityItemId = string.Empty;
        private int _quantityValue = 1;
        private int _quantityMax = 1;
        private string _quantityTitle = string.Empty;

        /// <summary>Открытое окно блокирует прямой подбор, пока игрок не закроет его.</summary>
        public bool BlocksGroundPickup
        {
            get { return _panel != PanelKind.None; }
        }

        public bool IsPanelOpen { get { return _panel != PanelKind.None; } }

        // --- Публичные точки для канва-окна бартера (RoaBarterCanvas). ---
        // Вся торговая логика и серверные запросы остаются здесь; канва
        // это только другой способ их нарисовать.

        /// <summary>Канва рисует торговлю сама; IMGUI-вариант этих панелей молчит.</summary>
        public bool TradeCanvasDriven { get; set; }

        public bool TradeOpen { get { return _panel == PanelKind.Trade || _panel == PanelKind.MachineTrade; } }
        public bool TradeIsMachine { get { return _panel == PanelKind.MachineTrade; } }
        public bool TradePending { get { return _tradePending; } }
        public JObject TradeMarket { get { return _market; } }
        public JObject TradeSelf { get { return _self; } }
        public string TradeStatus { get { return Time.unscaledTime <= _statusUntil ? _status : string.Empty; } }

        public string TradeActorName
        {
            get { return _active?["name"]?.ToString() ?? (TradeIsMachine ? "Торговый автомат" : "Торговец"); }
        }

        public System.Collections.Generic.IReadOnlyDictionary<string, int> TradeBuysQueue { get { return _tradeBuys; } }
        public System.Collections.Generic.IReadOnlyDictionary<string, int> TradeSellsQueue { get { return _tradeSells; } }

        public int TradeQueuedQuantity(string itemRuntimeId, bool buy)
        {
            return QueuedTradeQuantity(itemRuntimeId, buy);
        }

        public void TradeQueueAdd(string itemRuntimeId, bool buy, int qty = 1)
        {
            QueueTradeItem(itemRuntimeId, buy, qty);
        }

        public void TradeQueueRemove(string itemRuntimeId, bool buy, int qty)
        {
            RemoveTradeItem(itemRuntimeId, buy, qty);
        }

        public void TradeConfirm()
        {
            SubmitTradeQueue();
        }

        /// <summary>Как кнопка «Вернуться к разговору»: NPC остаётся в диалоге.</summary>
        public void TradeBack()
        {
            ClearTradeQueue();
            if (_panel == PanelKind.Trade) _panel = PanelKind.Npc;
            else ClosePanel(true);
        }

        public void TradeClose()
        {
            ClosePanel(true);
        }

        /// <summary>«Сбросить» web (trade-sell-clear): очистить корзину, окно остаётся.</summary>
        public void TradeClear() { ClearTradeQueue(); }

        public static string TradeBaseId(string runtimeId)
        {
            return BaseItemId(runtimeId);
        }

        // --- Фасад для системного журнала HUD (RoaHudCanvas). ---

        /// <summary>Канва показывает подсказку и статус сама; IMGUI-бокс и статус молчат.</summary>
        public bool HintCanvasDriven { get; set; }

        /// <summary>Подсказка как setReadout в web: «E — поговорить: Старый Клим».</summary>
        public string InteractionHint
        {
            get
            {
                if (_candidateKind == TargetKind.None || _candidate == null) return string.Empty;
                string name = _candidate["name"]?.ToString() ?? "Объект";
                string action;
                if (_candidateKind == TargetKind.Resource) action = "добыть";
                else if (_candidateKind == TargetKind.CraftingStation) action = "открыть станок";
                else if (_candidateKind == TargetKind.JobBoard) action = "посмотреть контракты";
                else if (_candidateKind == TargetKind.Transition) action = "перейти";
                else if (_candidateKind == TargetKind.Storage) action = "открыть хранилище";
                else if (_candidateKind == TargetKind.Container) action = "открыть";
                else if (_candidateKind == TargetKind.TradeMachine) action = "торговать";
                else action = _candidate["dead"]?.ToObject<bool>() == true ? "обыскать" : "поговорить";
                return InteractKey + " — " + action + ": " + name;
            }
        }

        /// <summary>Текущее сообщение статуса (пока не истекло), иначе пусто.</summary>
        public string StatusLine
        {
            get { return !string.IsNullOrEmpty(_status) && Time.unscaledTime <= _statusUntil ? _status : string.Empty; }
        }

        // --- Фасад для канва-окна диалога NPC и доски работ (RoaDialogueCanvas). ---

        /// <summary>Канва рисует диалог и доску сама; IMGUI-вариант этих панелей молчит.</summary>
        public bool DialogueCanvasDriven { get; set; }

        public bool NpcOpen { get { return _panel == PanelKind.Npc; } }
        public bool JobBoardOpen { get { return _panel == PanelKind.JobBoard; } }
        public string DialogueTitle { get { return PanelTitle(); } }
        public string DialogueStatus { get { return Time.unscaledTime <= _statusUntil ? _status : string.Empty; } }

        /// <summary>
        /// Реплика NPC. У торговцев с профилем — нарративная строка по состоянию
        /// их поручений, как traderDialogueLine() web (07c:449); у прочих —
        /// своя речь, иначе расписание.
        /// </summary>
        public string NpcSpeech
        {
            get
            {
                string trader = TraderDialogueLine();
                if (!string.IsNullOrEmpty(trader)) return trader;

                string speech = _active?["speechText"]?.ToString();
                if (!string.IsNullOrEmpty(speech)) return speech;
                string schedule = _active?["scheduleLabel"]?.ToString();
                return string.IsNullOrEmpty(schedule)
                    ? "Путник внимательно смотрит на вас."
                    : "Сейчас я " + schedule + ". Говори по делу.";
            }
        }

        /// <summary>traderProfileId() web (07b:154): профиль по полю, затем по id, затем по локации.</summary>
        private string TraderProfileId()
        {
            if (_active == null || !NpcHasTrade(_active)) return string.Empty;
            string direct = (_active["dialogueProfile"]?.ToString() ?? _active["traderProfile"]?.ToString() ?? string.Empty).ToLowerInvariant();
            if (direct == "klim" || direct == "scrap" || direct == "relay") return direct;
            string actorId = (_active["traderId"]?.ToString() ?? _active["id"]?.ToString() ?? string.Empty).ToLowerInvariant();
            if (actorId.Contains("scrap")) return "scrap";
            if (actorId.Contains("relay")) return "relay";
            if (actorId.Contains("klim")) return "klim";
            string loc = (_locationId ?? string.Empty).ToLowerInvariant();
            if (loc == "scraptown") return "scrap";
            if (loc == "relaystation") return "relay";
            return "klim";
        }

        private bool HasQuestItems(params (string id, int qty)[] cost)
        {
            foreach ((string id, int qty) in cost)
                if (InventoryQuantity(_self?["inventory"] as JArray, id) < qty) return false;
            return true;
        }

        /// <summary>Дословно traderDialogueLine() web — реплики по состоянию квестов торговца.</summary>
        private string TraderDialogueLine()
        {
            string profile = TraderProfileId();
            if (string.IsNullOrEmpty(profile)) return string.Empty;

            if (profile == "scrap")
            {
                string state = QuestState("scrapParts");
                if (state == "available") return "Грач-Жестянщик стучит пальцем по мятым чертежам: \"Нужны детали для пресса. Принесёшь сырьё и ремкомплект — расплачусь крышками и патронами.\"";
                if (state == "active") return HasQuestItems(("ore", 6), ("wood", 2), ("repairKit", 1))
                    ? "\"Вот это уже похоже на работу. Выкладывай железо, я проверю качество.\""
                    : "\"Мне нужно 6 руды, 2 древесины и ремкомплект. Без этого станок снова заклинит.\"";
                return "\"Пресс снова дышит. Товар смотри спокойно, но не трогай детали без спроса.\"";
            }

            if (profile == "relay")
            {
                string state = QuestState("relayCalibration");
                if (state == "available") return "Рада Искра не отрывается от панели: \"Ретранслятор глохнет. Нужны энергозаряды и ремкомплект. Поможешь — открою доступ к лучшему товару.\"";
                if (state == "active") return HasQuestItems(("energyCell", 20), ("repairKit", 1))
                    ? "\"Слышу вес батарей в твоём рюкзаке. Давай сюда, пока станция опять не ушла в помехи.\""
                    : "\"Двадцать энергозарядов и один ремкомплект. Меньше не хватит даже на тестовый запуск.\"";
                return "\"Станция держит частоту. Если нужен редкий техно-хлам, смотри ящики на продажу.\"";
            }

            string supplies = QuestState("klimSupplies");
            if (supplies == "available") return "Старый Клим смотрит поверх прилавка: \"Если ищешь работу, поселению нужны припасы. Платить буду честно, но без роскоши.\"";
            if (supplies == "active") return HasQuestItems(("ore", 3), ("wood", 3), ("water", 1))
                ? "\"Вижу, рюкзак потяжелел. Принёс всё, о чём я просил?\""
                : "\"Руда, древесина и вода. Без этого люди здесь долго не протянут.\"";
            string terminal = QuestState("klimTerminal");
            if (terminal == "available") return "\"Есть ещё дело. В Пепельном лесу стоит редкий тайник с терминалом. Кто вскроет его аккуратно, тот принесёт мне данные.\"";
            if (terminal == "active") return "\"Тайник ждёт в лесу. Не ломай терминал кулаками, ему нужна голова.\"";
            return "\"Пока новых поручений нет. Но торговля открыта, если нужны патроны или вода.\"";
        }

        public string NpcPersonality
        {
            get
            {
                JObject personality = _active?["personality"] as JObject;
                return personality == null ? string.Empty
                    : (personality["label"]?.ToString() ?? personality["id"]?.ToString() ?? string.Empty);
            }
        }

        public bool NpcHasTradeOption { get { return _active != null && NpcHasTrade(_active); } }
        public bool NpcCanRob { get { return _active != null && CanRobEncounterActor(_active); } }

        public sealed class QuestOption
        {
            public string Id;
            public string Name;
            public string State;
            public string StateLabel;
            public string Description;
        }

        public List<QuestOption> NpcQuests()
        {
            var rows = new List<QuestOption>();
            JArray ids = _active?["traderQuests"] as JArray;
            if (ids == null) return rows;

            foreach (JToken token in ids)
            {
                string id = token?.ToString();
                if (string.IsNullOrEmpty(id)) continue;
                JObject definition = _quests[id] as JObject;
                string state = QuestState(id);
                JObject panel = definition?["panel"] as JObject;
                string description = panel?[state]?.ToString();
                if (string.IsNullOrEmpty(description) && state == "available")
                    description = "Можно принять это поручение.";
                rows.Add(new QuestOption
                {
                    Id = id,
                    Name = definition?["name"]?.ToString() ?? id,
                    State = state,
                    StateLabel = QuestStateLabel(state),
                    Description = description ?? string.Empty
                });
            }
            return rows;
        }

        public sealed class StoryQuestCard
        {
            public string Id;
            public string Giver;
            public string Name;
            public string State;
            public string StateLabel;
            public string Description;
            public string Objective;
            public string Reward;
            public string Hint;
        }

        /// <summary>
        /// Сюжетный журнал строится только из авторских определений /api/quests и
        /// серверных npcQuests. Доступные и закрытые задания остаются у именных NPC.
        /// </summary>
        public List<StoryQuestCard> JournalQuests(bool completed)
        {
            var rows = new List<StoryQuestCard>();
            foreach (JProperty property in _quests.Properties())
            {
                string id = property.Name;
                JObject definition = property.Value as JObject;
                if (definition == null) continue;
                string state = QuestState(id);
                bool isDone = state == "done";
                bool isCurrent = state == "active" || state == "ready";
                if (completed ? !isDone : !isCurrent) continue;

                JObject panel = definition["panel"] as JObject;
                string description = panel?[state]?.ToString();
                if (string.IsNullOrEmpty(description))
                    description = panel?[isDone ? "done" : "active"]?.ToString() ?? string.Empty;
                string giver = definition["title"]?.ToString() ?? string.Empty;
                rows.Add(new StoryQuestCard
                {
                    Id = id,
                    Giver = giver,
                    Name = definition["name"]?.ToString() ?? id,
                    State = state,
                    StateLabel = QuestStateLabel(state),
                    Description = description,
                    Objective = StoryQuestObjective(definition),
                    Reward = StoryQuestReward(definition),
                    Hint = state == "ready" && !string.IsNullOrEmpty(giver)
                        ? "Вернитесь к персонажу: " + giver + "."
                        : string.Empty
                });
            }
            return rows;
        }

        private static string StoryQuestObjective(JObject definition)
        {
            JObject requirements = definition?["requirements"] as JObject;
            JObject items = requirements?["items"] as JObject;
            JObject labels = requirements?["labels"] as JObject;
            var parts = new List<string>();
            if (items != null)
            {
                foreach (JProperty item in items.Properties())
                {
                    int qty = Mathf.Max(0, item.Value?.ToObject<int>() ?? 0);
                    if (qty <= 0) continue;
                    string label = labels?[item.Name]?.ToString();
                    if (string.IsNullOrEmpty(label)) label = RoaItemData.Name(item.Name);
                    parts.Add(label + " ×" + qty);
                }
            }
            return parts.Count > 0 ? "Цель: " + string.Join(", ", parts) + "." : string.Empty;
        }

        private static string StoryQuestReward(JObject definition)
        {
            JObject reward = definition?["reward"] as JObject;
            var parts = new List<string>();
            int xp = Mathf.Max(0, reward?["xp"]?.ToObject<int>() ?? 0);
            int silver = Mathf.Max(0, reward?["silver"]?.ToObject<int>() ?? 0);
            if (xp > 0) parts.Add(xp + " XP");
            if (silver > 0) parts.Add(silver + " крышек");
            foreach (JToken token in reward?["items"] as JArray ?? new JArray())
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString() ?? token?.ToString() ?? string.Empty;
                int qty = Mathf.Max(1, row?["qty"]?.ToObject<int>() ?? 1);
                if (!string.IsNullOrEmpty(id)) parts.Add(RoaItemData.Name(id) + " ×" + qty);
            }
            return parts.Count > 0 ? "Награда: " + string.Join(", ", parts) + "." : string.Empty;
        }

        public void NpcQuestAction(string questId, string action) { SubmitQuest(questId, action); }
        public void NpcRequestTrade() { RequestTrade(); }
        public void NpcRob() { RobEncounterActor(); }
        public void DialogueClose() { ClosePanel(true); }

        // Доска контрактов.
        public bool JobBoardLoading { get { return _worldRequestPending && !(_world?["worldTasks"] is JArray); } }
        public bool JobBoardRefreshing { get { return _worldRequestPending; } }

        public JObject TrackedWorldTask
        {
            get
            {
                string trackedId = _self?["worldTaskTrackedId"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(trackedId)) return null;
                foreach (JObject task in WorldTaskRowsForPlayer())
                {
                    if (task?["id"]?.ToString() == trackedId && task?["status"]?.ToString() == "active") return task;
                }
                return null;
            }
        }

        public sealed class JobBoardSiteInfo
        {
            public string Name;
            public string Owner;
            public string OwnerLabel;
            public bool Joinable;
            public bool IsMember;
            public string JoinLabel;
        }

        public JobBoardSiteInfo JobBoardSite()
        {
            string boardSiteId = _active?["boardSiteId"]?.ToString() ?? _locationId;
            JObject site = WorldSite(boardSiteId);
            string owner = site?["capitalFaction"]?.ToString() ?? site?["owner"]?.ToString() ?? string.Empty;
            string current = _self?["worldFactionId"]?.ToString() ?? _self?["factionId"]?.ToString() ?? string.Empty;
            return new JobBoardSiteInfo
            {
                Name = site?["name"]?.ToString() ?? boardSiteId,
                Owner = owner,
                OwnerLabel = FactionLabel(owner),
                Joinable = IsJoinableFaction(owner),
                IsMember = IsJoinableFaction(owner) && current == owner,
                JoinLabel = IsJoinableFaction(owner) && current == owner ? "Фракция выбрана"
                    : (IsJoinableFaction(current) ? "Сменить сторону" : "Вступить во фракцию")
            };
        }

        public sealed class JobBoardTask
        {
            public JObject Row;
            public string Id;
            public string Title;
            public string Text;
            public string Status;
            public string Type;
            public bool Accepted;
            public bool Tracked;
            public bool Claimed;
            public bool RewardEligible;
            public string RewardText;
            public int SlotsLeft;
            public bool StatusOnly;
        }

        public List<JobBoardTask> JobBoardTasks()
        {
            var rows = new List<JobBoardTask>();
            string boardSiteId = _active?["boardSiteId"]?.ToString() ?? _locationId;
            foreach (JObject task in WorldTaskRowsForPlayer())
            {
                if (task == null || !TaskBelongsToBoard(task, boardSiteId)) continue;
                string taskId = task["id"]?.ToString() ?? string.Empty;
                bool statusOnly = task["statusOnly"]?.ToObject<bool>() == true
                    || task["actionMode"]?.ToString() == "status_only"
                    || task["type"]?.ToString() == "patrol_mission";
                rows.Add(new JobBoardTask
                {
                    Row = task,
                    Id = taskId,
                    Title = task["title"]?.ToString() ?? taskId,
                    Text = task["text"]?.ToString() ?? string.Empty,
                    Status = task["status"]?.ToString() ?? "active",
                    Type = task["type"]?.ToString() ?? string.Empty,
                    Accepted = SelfArrayContains("worldTaskAccepted", taskId),
                    Tracked = _self?["worldTaskTrackedId"]?.ToString() == taskId,
                    Claimed = SelfArrayContains("worldTaskRewardClaims", taskId),
                    RewardEligible = WorldTaskRewardEligible(taskId),
                    RewardText = statusOnly
                        ? "Поручение выполняет патруль НПС."
                        : WorldTaskRewardText(task),
                    SlotsLeft = task["joinPartySlotsLeft"]?.ToObject<int>() ?? -1,
                    StatusOnly = statusOnly
                });
            }
            return rows;
        }

        public void JobBoardAction(JobBoardTask task, string action)
        {
            if (task?.Row == null || (task.StatusOnly && action == "accept")) return;
            WorldTaskAction(task.Row, action);
        }
        public void JobBoardJoinOwner() { string owner = JobBoardSite().Owner; if (!string.IsNullOrEmpty(owner)) JoinWorldFaction(owner); }
        public void JobBoardRefresh() { if (!_worldRequestPending) StartCoroutine(LoadWastelandState()); }

        // --- Фасад для страницы CONTRACTS PIP-ASH (pipboyWorldTaskCard, 03a:1309). ---

        public sealed class WorldTaskCard
        {
            public string Id;
            public string Label;        // Контракт / Взято / Метка / Выполнено / Решено миром / Провалено
            public string Title;
            public string Text;         // текст + «Осталось около N ч.»
            public string Route;        // Где взять / Цель / Координаты
            public string Reward;       // «Награда: …»
            public string JoinHint;     // «После принятия: …»
            public string AcceptLabel;  // null — кнопки нет
            public bool CanAccept;
            public string AcceptHint;
            public string TrackLabel;   // Отслеживать / Снять метку
            public bool CanCancel;
            public bool CanClaim;
            public bool Accepted;
            public bool Tracked;
        }

        /// <summary>Контракты пустоши для PIP-ASH: active — 8 активных, иначе 6 завершённых.</summary>
        public List<WorldTaskCard> PipboyWorldTasks(bool active)
        {
            var rows = new List<WorldTaskCard>();
            var seenOffers = new HashSet<string>();
            float worldHour = _world?["worldHour"]?.ToObject<float>() ?? 0f;
            foreach (JObject task in WorldTaskRowsForPlayer())
            {
                if (task == null) continue;
                string status = task["status"]?.ToString() ?? "active";
                if (active ? status != "active" : status == "active") continue;

                string id = task["id"]?.ToString() ?? string.Empty;
                string type = (task["type"]?.ToString() ?? string.Empty).ToLowerInvariant();
                bool statusOnly = type == "patrol_mission"
                    || task["statusOnly"]?.ToObject<bool>() == true
                    || task["actionMode"]?.ToString() == "status_only";
                bool accepted = SelfArrayContains("worldTaskAccepted", id);
                bool tracked = _self?["worldTaskTrackedId"]?.ToString() == id;
                string semanticKey = WorldTaskSemanticKey(task);
                if (active && accepted && !string.IsNullOrEmpty(semanticKey)) seenOffers.Add(semanticKey);
                if (active && !accepted && !string.IsNullOrEmpty(semanticKey) && !seenOffers.Add(semanticKey)) continue;
                if (rows.Count >= (active ? 8 : 6)) break;
                var card = new WorldTaskCard { Id = id, Accepted = accepted, Tracked = tracked };
                card.Label = tracked ? "Метка"
                    : status == "completed" ? "Выполнено"
                    : status == "resolved" ? "Решено миром"
                    : status == "expired" ? "Провалено"
                    : accepted ? "Взято" : "Контракт";
                card.Title = task["title"]?.ToString() ?? "Контракт пустоши";

                float expires = task["expiresHour"]?.ToObject<float>() ?? worldHour;
                int hoursLeft = status == "active" ? Mathf.Max(0, Mathf.CeilToInt(expires - worldHour)) : 0;
                string text = task["text"]?.ToString() ?? string.Empty;
                if (status == "active" && hoursLeft > 0) text = (text + " Осталось около " + hoursLeft + " ч.").Trim();
                card.Text = text;

                // pipboyWorldTaskRouteText
                string issuer = task["issuerSiteName"]?.ToString() ?? string.Empty;
                string target = task["targetSiteName"]?.ToString() ?? task["siteName"]?.ToString() ?? string.Empty;
                string party = task["targetPartyName"]?.ToString() ?? task["joinPartyName"]?.ToString() ?? string.Empty;
                var route = new List<string>();
                if (!string.IsNullOrEmpty(issuer)) route.Add("Где взять: " + issuer + ".");
                if (type == "deliver_supplies") { if (!string.IsNullOrEmpty(target)) route.Add("Куда сдать ресурсы: " + target + "."); }
                else if (type == "clear_lair") route.Add("Цель: зачистить " + (!string.IsNullOrEmpty(party) ? party : !string.IsNullOrEmpty(target) ? target : "логово") + ".");
                else if (type == "escort_caravan") route.Add("Цель: сопроводить " + (!string.IsNullOrEmpty(party) ? party : "караван") + ".");
                else if (type == "join_patrol") route.Add("Цель: присоединиться к " + (!string.IsNullOrEmpty(party) ? party : "патрулю") + ".");
                else if (!string.IsNullOrEmpty(target)) route.Add("Место выполнения: " + target + ".");
                else if (!string.IsNullOrEmpty(party)) route.Add("Цель: " + party + ".");
                JToken px = task["targetX"] ?? task["x"] ?? task["details"]?["x"];
                JToken py = task["targetY"] ?? task["y"] ?? task["details"]?["y"];
                if (px != null && py != null && px.Type != JTokenType.Null && py.Type != JTokenType.Null)
                    route.Add("Координаты: " + Mathf.RoundToInt(px.ToObject<float>()) + ":" + Mathf.RoundToInt(py.ToObject<float>()) + ".");
                card.Route = string.Join(" ", route);

                card.Reward = statusOnly ? string.Empty : WorldTaskRewardText(task);

                string joinName = task["joinPartyName"]?.ToString();
                card.JoinHint = task["actionMode"]?.ToString() == "join_party" && !string.IsNullOrEmpty(joinName)
                    ? "После принятия: присоединиться к группе " + joinName + "."
                    : type == "clear_lair" ? "Зачистку можно выполнить одному или собрать группу игроков." : string.Empty;

                if (status == "active" && !accepted)
                {
                    if (statusOnly)
                    {
                        card.Label = "Операция фракции";
                        card.CanAccept = false;
                        card.AcceptLabel = null;
                        card.AcceptHint = "Поручение выполняет патруль НПС. Его статус можно смотреть на карте активностей.";
                        rows.Add(card);
                        continue;
                    }
                    // worldTaskAcceptancePlaceStatus + worldTaskAccessStatus
                    string boardSiteId = task["issuerSiteId"]?.ToString() ?? task["boardSiteId"]?.ToString() ?? task["siteId"]?.ToString() ?? string.Empty;
                    JObject site = WorldSite(boardSiteId);
                    string siteName = task["issuerSiteName"]?.ToString() ?? site?["name"]?.ToString() ?? "доска контрактов";
                    bool placeOk = !string.IsNullOrEmpty(boardSiteId) && PlayerAtSite(boardSiteId, site);
                    string placeText = string.IsNullOrEmpty(boardSiteId) ? "Доска контрактов не найдена."
                        : placeOk ? "Вы у доски: " + siteName + "." : "Взять можно у доски: " + siteName + ".";
                    bool accessOk = true;
                    string accessText = string.Empty;
                    if ((type == "escort_caravan" || type == "join_patrol")
                        && (string.IsNullOrEmpty(task["joinPartyId"]?.ToString()) || task["actionMode"]?.ToString() != "join_party"))
                    {
                        accessOk = false;
                        accessText = "Отряд еще не готов. Дождитесь выхода каравана или патруля.";
                    }
                    else
                    {
                        string factionId = WorldTaskFactionId(task, site);
                        bool requires = type == "escort_caravan" || type == "join_patrol" || type == "defend_resource" || type == "retake_site";
                        string mine = _self?["worldFactionId"]?.ToString() ?? _self?["factionId"]?.ToString() ?? string.Empty;
                        if (requires && !string.IsNullOrEmpty(factionId) && mine != factionId)
                        {
                            accessOk = false;
                            accessText = "Нужно вступить во фракцию: " + FactionLabel(factionId) + ".";
                        }
                        else if (!string.IsNullOrEmpty(factionId) && mine == factionId)
                            accessText = "Фракционный контракт: " + FactionLabel(factionId) + ".";
                    }
                    card.CanAccept = placeOk && accessOk;
                    card.AcceptLabel = !placeOk ? "Нужна доска" : !accessOk ? "Недоступно" : "Взять контракт";
                    card.AcceptHint = (placeText + " " + accessText).Trim();
                }
                if (status == "active" && accepted)
                {
                    card.TrackLabel = tracked ? "Снять метку" : "Отслеживать";
                    card.CanCancel = true;
                }
                card.CanClaim = status == "completed" && !SelfArrayContains("worldTaskRewardClaims", id) && WorldTaskRewardEligible(id);
                rows.Add(card);
            }
            return rows;
        }

        public void PipboyWorldTaskAction(string taskId, string action) { SubmitWorldTaskAction(taskId, action); }

        /// <summary>Страница CONTRACTS открыта вне доски — подтянуть состояние пустоши, если его ещё нет.</summary>
        public void EnsureWorldState()
        {
            if (_world?["worldTasks"] is JArray || _worldRequestPending) return;
            StartCoroutine(LoadWastelandState());
        }

        /// <summary>
        /// Персональные записи идут первыми: принятый или отслеживаемый контракт
        /// не должен исчезнуть, если его публичный дубль убран из общей витрины.
        /// </summary>
        private List<JObject> WorldTaskRowsForPlayer()
        {
            var rows = new List<JObject>();
            var ids = new HashSet<string>();
            foreach (JToken token in _self?["worldTaskRecords"] as JArray ?? new JArray())
            {
                JObject task = token as JObject;
                string id = task?["id"]?.ToString() ?? string.Empty;
                if (task != null && (string.IsNullOrEmpty(id) || ids.Add(id))) rows.Add(task);
            }
            foreach (JToken token in _world?["worldTasks"] as JArray ?? new JArray())
            {
                JObject task = token as JObject;
                string id = task?["id"]?.ToString() ?? string.Empty;
                if (task != null && (string.IsNullOrEmpty(id) || ids.Add(id))) rows.Add(task);
            }
            return rows;
        }

        private static string WorldTaskSemanticKey(JObject task)
        {
            if (task == null) return string.Empty;
            string direct = task["contractKey"]?.ToString() ?? task["key"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(direct)) return direct.Trim().ToLowerInvariant();

            JObject details = task["details"] as JObject;
            JObject operation = task["operation"] as JObject ?? details?["operation"] as JObject;
            string type = task["type"]?.ToString() ?? "contract";
            string objective = task["objective"]?.ToString()
                ?? details?["objective"]?.ToString()
                ?? details?["activityKind"]?.ToString()
                ?? operation?["goal"]?["kind"]?.ToString()
                ?? operation?["kind"]?.ToString()
                ?? type;
            string faction = task["joinPartyFaction"]?.ToString()
                ?? task["faction"]?.ToString()
                ?? details?["factionId"]?.ToString()
                ?? string.Empty;
            string actionMode = task["actionMode"]?.ToString() ?? string.Empty;
            string reason = details?["supportReason"]?.ToString()
                ?? details?["resourceSupport"]?["reason"]?.ToString()
                ?? string.Empty;

            var mechanics = new List<string>();
            JObject demand = details?["demand"] as JObject
                ?? details?["supportDemand"] as JObject
                ?? details?["resourceSupport"]?["demand"] as JObject;
            if (demand != null)
            {
                var demandParts = new List<string>();
                foreach (JProperty item in demand.Properties())
                    if ((item.Value?.ToObject<float>() ?? 0f) > 0f)
                        demandParts.Add(item.Name.ToLowerInvariant() + ":" + item.Value.ToString());
                demandParts.Sort(StringComparer.Ordinal);
                mechanics.AddRange(demandParts);
            }
            JArray resourceTypes = details?["resourceTypes"] as JArray;
            if (resourceTypes != null)
            {
                var resourceParts = new List<string>();
                foreach (JToken token in resourceTypes)
                    if (!string.IsNullOrEmpty(token?.ToString())) resourceParts.Add(token.ToString().ToLowerInvariant());
                resourceParts.Sort(StringComparer.Ordinal);
                mechanics.AddRange(resourceParts);
            }
            return string.Join("|", new[]
            {
                type, objective, faction, actionMode, reason, string.Join(",", mechanics)
            }).Trim().ToLowerInvariant();
        }

        /// <summary>worldTaskPlayerAtSite web: текущая локация совпадает с locationId площадки или с её id.</summary>
        private bool PlayerAtSite(string siteId, JObject site)
        {
            if (string.IsNullOrEmpty(siteId)) return false;
            string siteLocation = site?["locationId"]?.ToString();
            if (!string.IsNullOrEmpty(siteLocation)) return _locationId == siteLocation;
            return _locationId == siteId;
        }

        private string WorldTaskFactionId(JObject task, JObject boardSite)
        {
            string explicitId = (task["joinPartyFaction"]?.ToString() ?? task["faction"]?.ToString() ?? task["owner"]?.ToString() ?? string.Empty).ToLowerInvariant();
            if (IsJoinableFaction(explicitId)) return explicitId;
            JObject site = boardSite ?? WorldSite(task["siteId"]?.ToString() ?? string.Empty);
            string owner = (site?["owner"]?.ToString() ?? string.Empty).ToLowerInvariant();
            return IsJoinableFaction(owner) ? owner : string.Empty;
        }

        private string WorldTaskReputationFactionId(JObject task)
        {
            if (task == null) return string.Empty;
            string explicitId = (task["reward"]?["reputationFactionId"]?.ToString()
                ?? task["details"]?["rewardFactionId"]?.ToString()
                ?? task["reputationFactionId"]?.ToString()
                ?? string.Empty).ToLowerInvariant();
            if (!string.IsNullOrEmpty(explicitId)) return IsJoinableFaction(explicitId) ? explicitId : string.Empty;
            string issuerId = task["issuerSiteId"]?.ToString() ?? task["boardSiteId"]?.ToString() ?? task["siteId"]?.ToString() ?? string.Empty;
            return WorldTaskFactionId(task, WorldSite(issuerId));
        }

        private string WorldTaskRewardText(JObject task)
        {
            JObject reward = task?["reward"] as JObject;
            var parts = new List<string>();
            int xp = reward?["xp"]?.ToObject<int>() ?? 0;
            int caps = reward?["caps"]?.ToObject<int>() ?? 0;
            int reputation = reward?["reputation"]?.ToObject<int>() ?? 0;
            if (xp > 0) parts.Add(xp + " XP");
            if (caps > 0) parts.Add(caps + " крышек");
            string reputationFactionId = WorldTaskReputationFactionId(task);
            if (reputation > 0 && !string.IsNullOrEmpty(reputationFactionId))
                parts.Add("репутация " + FactionLabel(reputationFactionId) + " +" + reputation);
            return parts.Count > 0 ? "Награда: " + string.Join(", ", parts) + "." : string.Empty;
        }

        // --- Фасад для канва-окон лута и хранилища (RoaLootCanvas). ---

        /// <summary>Канва рисует лут/хранилище сама; IMGUI-вариант этих панелей молчит.</summary>
        public bool LootCanvasDriven { get; set; }

        public bool LootOpen { get { return _panel == PanelKind.Corpse || _panel == PanelKind.Container; } }
        public bool StorageOpen { get { return _panel == PanelKind.Storage; } }
        public bool LootLocked { get { return _active?["locked"]?.ToObject<bool>() == true; } }
        public bool LootTerminalLocked { get { return _active?["terminalLocked"]?.ToObject<bool>() == true; } }
        public JArray LootRows { get { return _active?["loot"] as JArray; } }
        public JArray StorageRows { get { return _self?["storage"] as JArray; } }
        public JArray InventoryRows { get { return _self?["inventory"] as JArray; } }
        public string LootTitle { get { return PanelTitle(); } }
        public string LootStatus { get { return Time.unscaledTime <= _statusUntil ? _status : string.Empty; } }

        public void TakeLoot(string itemId, int qty = 1) { Loot(itemId, false, qty); }
        public void TakeAllLoot() { Loot(string.Empty, true); }
        public void LootSecurity(string action) { SecurityAction(action); }
        public void StorageDeposit(string runtimeId, int qty = 1) { StorageTransfer(runtimeId, true, qty); }
        public void StorageWithdraw(string runtimeId, int qty = 1) { StorageTransfer(runtimeId, false, qty); }
        public void LootClose() { ClosePanel(true); }

        /// <summary>
        /// «Положить всё» / «Забрать всё» — одним батчем строк, как принимает
        /// storageTransfer; крышки и кулаки в ящик не кладутся.
        /// </summary>
        public void StorageTransferAll(bool deposit)
        {
            JArray source = deposit ? InventoryRows : StorageRows;
            if (source == null || Socket == null) return;

            var rows = new List<Dictionary<string, object>>();
            foreach (JToken row in source)
            {
                string runtimeId = row["id"]?.ToString();
                string baseId = BaseItemId(runtimeId);
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(runtimeId) || qty <= 0) continue;
                if (deposit && (baseId == "silver" || baseId == "fists")) continue;
                rows.Add(new Dictionary<string, object>
                {
                    ["id"] = baseId,
                    ["itemRuntimeId"] = runtimeId,
                    ["qty"] = qty
                });
            }
            if (rows.Count == 0) { Show(deposit ? "Нечего положить." : "Ящик пуст."); return; }

            Socket.EmitWithAck("storageTransfer", new Dictionary<string, object>
            {
                ["direction"] = deposit ? "deposit" : "withdraw",
                ["rows"] = rows
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                Show(ok ? (deposit ? "Всё убрано в ящик." : "Всё забрано из ящика.")
                        : (ack?["error"]?.ToString() ?? "Сервер отклонил перенос."), 4f);
            });
        }

        public void Configure(string baseUrl, RoaSocketClient socket, RoaEnemies enemies, RoaFogOfWar fog,
            RoaLocationLoader loader = null)
        {
            Detach();
            BaseUrl = string.IsNullOrEmpty(baseUrl) ? BaseUrl : baseUrl;
            Socket = socket;
            Enemies = enemies;
            Fog = fog;
            Loader = loader;
            Attach();
        }

        public void SetPlayer(RoaPlayerController player)
        {
            Player = player;
        }

        /// <summary>
        /// Авторские интерактивные объекты уже отрисованы LocationLoader. Здесь
        /// сохраняются только их серверные id и позиции для выбора цели.
        /// </summary>
        public void SetLocation(LocationDefinition location)
        {
            ClearStaticTargets();
            _authoredResourceIds.Clear();
            _locationReady = location != null;
            _locationId = location?.Id ?? string.Empty;
            _encounterLocation = location != null && (location.EncounterOnly || location.RandomTemplate);
            _mapWidth = location?.TileWidth ?? 38;
            _mapDepth = location?.TileDepth ?? 38;
            if (location == null)
            {
                RefreshResourceViews();
                return;
            }

            foreach (LocationObject entry in location.Objects ?? new List<LocationObject>())
            {
                if (entry == null || entry.Position == null || string.IsNullOrEmpty(entry.Id)) continue;
                if (IsResourceObject(entry))
                {
                    _authoredResourceIds.Add(entry.Id);
                    ResourceView resource;
                    bool visible = !_resources.TryGetValue(entry.Id, out resource)
                        || resource.Data?["hp"]?.ToObject<float>() > 0f;
                    Loader?.SetObjectVisible(entry.Id, visible);
                }

                TargetKind kind = StaticTargetKind(entry);
                if (kind == TargetKind.None) continue;

                string station = kind == TargetKind.CraftingStation ? CraftingStationId(entry) : string.Empty;
                string boardSiteId = kind == TargetKind.JobBoard
                    ? (entry.Interactive?["boardSiteId"]?.ToString() ?? _locationId)
                    : string.Empty;

                _staticTargets.Add(new StaticTarget
                {
                    Kind = kind,
                    Position = RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z),
                    Data = new JObject
                    {
                        ["id"] = entry.Id,
                        ["name"] = string.IsNullOrEmpty(entry.Name)
                            ? DefaultStaticName(kind, station)
                            : entry.Name,
                        ["staticKind"] = kind.ToString(),
                        ["station"] = station,
                        ["boardSiteId"] = boardSiteId,
                        ["locationId"] = _locationId
                    }
                });
            }

            var transitionIds = new HashSet<string>();
            AddTransitionTarget(location.Exit, transitionIds);
            if (location.Transitions != null)
                foreach (LocationTransition transition in location.Transitions)
                    AddTransitionTarget(transition, transitionIds);

            RefreshResourceViews();
        }

        private void AddTransitionTarget(LocationTransition transition, HashSet<string> seen)
        {
            if (transition == null || string.IsNullOrEmpty(transition.To)) return;
            if (string.Equals(transition.Type, "globalMap", StringComparison.OrdinalIgnoreCase)) return;
            string key = transition.Tx + ":" + transition.Tz + ":" + transition.To;
            if (!seen.Add(key)) return;

            Vector3 position = RoaCoords.TileToWorld(transition.Tx, transition.Tz, _mapWidth, _mapDepth);
            var target = new StaticTarget
            {
                Kind = TargetKind.Transition,
                Position = position,
                Range = Mathf.Max(1.5f, transition.Radius > 0f ? transition.Radius : 2.4f),
                Data = new JObject
                {
                    ["id"] = string.IsNullOrEmpty(transition.Id) ? "location_exit" : transition.Id,
                    ["name"] = string.IsNullOrEmpty(transition.Label) ? "Переход" : transition.Label,
                    ["to"] = transition.To,
                    ["entryKey"] = transition.EntryKey ?? string.Empty,
                    ["locationId"] = _locationId
                }
            };
            target.Marker = CreateTransitionMarker(position);
            _staticTargets.Add(target);
        }

        private GameObject CreateTransitionMarker(Vector3 position)
        {
            var root = new GameObject("LocationTransitionMarker");
            root.transform.SetParent(transform, false);
            root.transform.position = position + Vector3.up * 0.08f;
            var line = root.AddComponent<LineRenderer>();
            line.loop = true;
            line.useWorldSpace = false;
            line.positionCount = 48;
            line.startWidth = 0.055f;
            line.endWidth = 0.055f;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            if (_transitionMaterial == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                    ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
                if (shader != null)
                {
                    _transitionMaterial = new Material(shader);
                    Color color = new Color(0.85f, 0.74f, 0.43f, 0.76f);
                    _transitionMaterial.color = color;
                    if (_transitionMaterial.HasProperty("_BaseColor"))
                        _transitionMaterial.SetColor("_BaseColor", color);
                    if (_transitionMaterial.HasProperty("_Surface")) _transitionMaterial.SetFloat("_Surface", 1f);
                    if (_transitionMaterial.HasProperty("_SrcBlend"))
                        _transitionMaterial.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                    if (_transitionMaterial.HasProperty("_DstBlend"))
                        _transitionMaterial.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                    if (_transitionMaterial.HasProperty("_ZWrite")) _transitionMaterial.SetFloat("_ZWrite", 0f);
                    _transitionMaterial.renderQueue = 3000;
                    _transitionMaterial.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                }
            }
            line.sharedMaterial = _transitionMaterial;
            for (int i = 0; i < line.positionCount; i++)
            {
                float angle = i / (float)line.positionCount * Mathf.PI * 2f;
                line.SetPosition(i, new Vector3(Mathf.Cos(angle) * 0.92f, 0f, Mathf.Sin(angle) * 0.92f));
            }
            return root;
        }

        private void Start()
        {
            StartCoroutine(LoadQuestDefinitions());
        }

        private void OnEnable()
        {
            Attach();
        }

        private void OnDisable()
        {
            Detach();
            ClosePanel(false);
        }

        private void OnDestroy()
        {
            if (_transitionMaterial == null) return;
            if (Application.isPlaying) Destroy(_transitionMaterial);
            else DestroyImmediate(_transitionMaterial);
            _transitionMaterial = null;
        }

        private void Attach()
        {
            if (_attached || Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnAuthoritativeSelf += HandleSelf;
            Socket.OnWorldState += HandleWorldState;
            Socket.OnWorldContainers += HandleContainerSnapshot;
            Socket.OnWorldContainerUpdated += HandleContainerUpdated;
            Socket.OnEnemyTradeUpdated += HandleEnemyTradeUpdated;
            Socket.OnTradeMachineMarketUpdated += HandleTradeMachineMarketUpdated;
            Socket.OnResourceUpdated += HandleResourceUpdated;
            _attached = true;
        }

        private void Detach()
        {
            if (!_attached || Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnAuthoritativeSelf -= HandleSelf;
            Socket.OnWorldState -= HandleWorldState;
            Socket.OnWorldContainers -= HandleContainerSnapshot;
            Socket.OnWorldContainerUpdated -= HandleContainerUpdated;
            Socket.OnEnemyTradeUpdated -= HandleEnemyTradeUpdated;
            Socket.OnTradeMachineMarketUpdated -= HandleTradeMachineMarketUpdated;
            Socket.OnResourceUpdated -= HandleResourceUpdated;
            _attached = false;
        }

        private IEnumerator LoadQuestDefinitions()
        {
            using (UnityWebRequest request = UnityWebRequest.Get(BaseUrl.TrimEnd('/') + "/api/quests"))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning("[ROA] Не удалось загрузить определения заданий: " + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    _quests = payload["quests"] as JObject ?? new JObject();
                }
                catch (Exception error)
                {
                    Debug.LogWarning("[ROA] Некорректный /api/quests: " + error.Message);
                }
            }
        }

        private void HandleJoined(JoinAck ack)
        {
            ClearWorld();
            if (ack == null) return;
            HandleSelf(ack.Self);
            HandleWorldState(ack.WorldState);
        }

        private void HandleSelf(JObject self)
        {
            if (self == null) return;
            _self = (JObject)self.DeepClone();
            ReconcileTradeQueue();
        }

        private void HandleWorldState(JObject payload)
        {
            if (payload?["map"] is JArray stateMap) Loader?.ApplyWorldMap(stateMap);
            ApplyContainers(payload?["containers"] as JArray);
            ApplyResources(payload?["resources"] as JArray);
        }

        private void HandleContainerSnapshot(JObject payload)
        {
            ApplyContainers(payload?["containers"] as JArray);
        }

        private void HandleContainerUpdated(JObject payload)
        {
            JObject row = payload?["container"] as JObject;
            if (row == null) return;
            UpsertContainer(row);
            RefreshActiveContainer(row);
        }

        private void HandleEnemyTradeUpdated(JObject payload)
        {
            JObject row = payload?["enemy"] as JObject;
            if (row == null || _active == null) return;
            if (row["id"]?.ToString() == _active["id"]?.ToString())
            {
                _active = (JObject)row.DeepClone();
                if (_panel == PanelKind.Trade && _market != null)
                {
                    if (row["traderStock"] is JArray stock)
                        _market["stock"] = stock.DeepClone();
                    int caps = InventoryQuantity(row["inventory"] as JArray, "silver");
                    _market["caps"] = Mathf.Max(0, caps);
                    ReconcileTradeQueue();
                }
            }
        }

        private void HandleTradeMachineMarketUpdated(JObject payload)
        {
            if (_panel != PanelKind.MachineTrade || _active == null) return;
            string machineId = payload?["machineId"]?.ToString()
                ?? payload?["market"]?["machineId"]?.ToString();
            if (machineId != _active["id"]?.ToString()) return;
            if (payload?["market"] is JObject market)
            {
                _market = (JObject)market.DeepClone();
                ReconcileTradeQueue();
            }
        }

        private void HandleResourceUpdated(JObject payload)
        {
            JObject row = payload?["resource"] as JObject;
            if (row == null) return;
            UpsertResource(row);
        }

        private void ApplyContainers(JArray rows)
        {
            if (rows == null) return;
            var seen = new HashSet<string>();

            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;
                seen.Add(id);
                UpsertContainer(row);
                RefreshActiveContainer(row);
            }

            var stale = new List<string>();
            foreach (string id in _containers.Keys)
                if (!seen.Contains(id)) stale.Add(id);
            foreach (string id in stale) RemoveContainer(id);
        }

        private void ApplyResources(JArray rows)
        {
            if (rows == null) return;
            var seen = new HashSet<string>();
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;
                seen.Add(id);
                UpsertResource(row);
            }

            var stale = new List<string>();
            foreach (string id in _resources.Keys)
                if (!seen.Contains(id)) stale.Add(id);
            foreach (string id in stale) RemoveResource(id);
        }

        private void UpsertResource(JObject row)
        {
            string id = row?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            int tx = row["tx"]?.ToObject<int>() ?? 0;
            int tz = row["tz"]?.ToObject<int>() ?? 0;

            ResourceView view;
            if (!_resources.TryGetValue(id, out view))
            {
                view = new ResourceView();
                _resources[id] = view;
            }

            view.Data = (JObject)row.DeepClone();
            view.Data["name"] = ResourceLabel(row["type"]?.ToString());
            view.Position = RoaCoords.TileToWorld(tx, tz, _mapWidth, _mapDepth);
            bool available = row["hp"]?.ToObject<float>() > 0f;

            bool loaderOwnsVisual = Loader != null && Loader.TryGetObjectRoot(id, out GameObject _);
            if (_locationReady && (_authoredResourceIds.Contains(id) || loaderOwnsVisual))
            {
                if (view.Marker != null) Destroy(view.Marker);
                view.Marker = null;
                Loader?.SetObjectVisible(id, available);
            }
            else if (_locationReady)
            {
                if (view.Marker == null) view.Marker = CreateResourceMarker(id, row);
                view.Marker.transform.position = view.Position;
                view.Marker.SetActive(available);
            }
        }

        private void RefreshResourceViews()
        {
            foreach (ResourceView view in _resources.Values)
                if (view.Data != null) UpsertResource(view.Data);
        }

        private GameObject CreateResourceMarker(string id, JObject row)
        {
            var root = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            root.name = "Resource:" + id;
            root.transform.SetParent(transform, false);
            root.transform.localScale = new Vector3(0.42f, 0.32f, 0.42f);
            Destroy(root.GetComponent<Collider>());

            Renderer renderer = root.GetComponent<Renderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (renderer != null && shader != null)
            {
                var material = new Material(shader);
                material.color = ResourceColor(row?["type"]?.ToString());
                renderer.sharedMaterial = material;
            }
            return root;
        }

        private void RemoveResource(string id)
        {
            ResourceView view;
            if (!_resources.TryGetValue(id, out view)) return;
            if (view.Marker != null) Destroy(view.Marker);
            if (_authoredResourceIds.Contains(id)
                || (Loader != null && Loader.TryGetObjectRoot(id, out GameObject _)))
                Loader?.SetObjectVisible(id, false);
            _resources.Remove(id);
        }

        private void UpsertContainer(JObject row)
        {
            string id = row?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;

            ContainerView view;
            if (!_containers.TryGetValue(id, out view))
            {
                view = CreateContainer(id, row);
                _containers[id] = view;
            }

            view.Data = (JObject)row.DeepClone();
            Vector3 position = RoaCoords.ToUnity(Value(row, "x"), Value(row, "z"));
            if (view.Root != null) view.Root.transform.position = position;
        }

        private ContainerView CreateContainer(string id, JObject row)
        {
            var root = new GameObject("WorldContainer:" + id);
            root.transform.SetParent(transform, false);

            var view = new ContainerView
            {
                Root = root,
                Gate = root.AddComponent<RoaVisibilityGate>(),
                ModelKey = ContainerModelKey(row)
            };

            view.Placeholder = CreateContainerPlaceholder(root.transform, row);
            _ = LoadContainerModel(view);
            return view;
        }

        private static GameObject CreateContainerPlaceholder(Transform parent, JObject row)
        {
            var marker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            marker.name = "LoadingContainer";
            marker.transform.SetParent(parent, false);
            marker.transform.localPosition = new Vector3(0f, 0.38f, 0f);
            marker.transform.localScale = new Vector3(0.9f, 0.76f, 0.72f);
            Destroy(marker.GetComponent<Collider>());

            Renderer renderer = marker.GetComponent<Renderer>();
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (renderer != null && shader != null)
            {
                var material = new Material(shader);
                bool locked = row["locked"]?.ToObject<bool>() == true
                    || row["terminalLocked"]?.ToObject<bool>() == true;
                material.color = locked
                    ? new Color(0.42f, 0.28f, 0.18f)
                    : new Color(0.38f, 0.42f, 0.32f);
                renderer.sharedMaterial = material;
            }
            return marker;
        }

        private async Task LoadContainerModel(ContainerView view)
        {
            string path = view.ModelKey == "tradeMachine"
                ? "/assets/models/wasteland/trade_machine.glb"
                : (view.ModelKey == "crate"
                    ? "/assets/models/wasteland/crate.glb"
                    : "/assets/models/wasteland/storage_chest.glb");
            string url = BaseUrl.TrimEnd('/') + path;

            try
            {
                GltfImport import = await LoadCached(url);
                if (import == null || view.Root == null) return;

                var holder = new GameObject("Model:" + view.ModelKey);
                holder.transform.SetParent(view.Root.transform, false);
                if (!await import.InstantiateMainSceneAsync(holder.transform))
                {
                    Destroy(holder);
                    return;
                }

                if (view.Root == null)
                {
                    Destroy(holder);
                    return;
                }

                if (view.Placeholder != null) Destroy(view.Placeholder);
                view.Gate.Invalidate();
            }
            catch (MissingReferenceException)
            {
                // Комната была очищена, пока загружалась модель.
            }
            catch (Exception error)
            {
                Debug.LogWarning("[ROA] Контейнер оставлен с резервной моделью: " + error.Message);
            }
        }

        private static Task<GltfImport> LoadCached(string url)
        {
            Task<GltfImport> cached;
            if (ModelCache.TryGetValue(url, out cached)) return cached;
            Task<GltfImport> loading = LoadImport(url);
            ModelCache[url] = loading;
            return loading;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            if (await import.Load(RoaModelUrl.Lite(url))) return import;
            import.Dispose();
            ModelCache.Remove(url);
            return null;
        }

        private static string ContainerModelKey(JObject row)
        {
            if (row?["terminalLocked"]?.ToObject<bool>() == true
                || Value(row, "terminalDifficulty") > 0f) return "tradeMachine";
            return string.Equals(row?["tier"]?.ToString(), "basic", StringComparison.OrdinalIgnoreCase)
                ? "crate"
                : "storageChest";
        }

        private void Update()
        {
            UpdateContainerVisibility();

            if (Player == null || !Player.gameObject.activeInHierarchy)
            {
                ClearCandidate();
                return;
            }

            if (_panel != PanelKind.None)
            {
                MaintainServerHolds();
                if (_quantityKind != QuantityKind.None)
                {
                    if (Input.GetKeyDown(KeyCode.Escape)) CloseQuantity();
                    return;
                }
                if (Input.GetKeyDown(KeyCode.Escape)) ClosePanel(true);
                return;
            }

            FindCandidate();
            if (KeyboardInputEnabled && Input.GetKeyDown(InteractKey))
            {
                if (!TryPickupGroundBeforeInteract()) Interact();
            }
        }

        private void UpdateContainerVisibility()
        {
            foreach (ContainerView view in _containers.Values)
            {
                if (view.Root == null || view.Gate == null) continue;
                view.Gate.SetVisible(Fog == null || Fog.IsVisible(view.Root.transform.position));
            }


            foreach (ResourceView view in _resources.Values)
            {
                if (view.Marker == null || view.Data == null) continue;
                bool available = view.Data["hp"]?.ToObject<float>() > 0f;
                bool visible = Fog == null || Fog.IsVisible(view.Position);
                view.Marker.SetActive(available && visible);
            }
        }

        public void CollectMinimapMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null) return;
            foreach (ContainerView view in _containers.Values)
            {
                if (view == null || view.Root == null) continue;
                if (view.Gate != null && !view.Gate.IsVisible) continue;
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Container,
                                                   view.Root.transform.position));
            }
            foreach (ResourceView view in _resources.Values)
            {
                if (view == null || view.Data == null || view.Data["hp"]?.ToObject<float>() <= 0f) continue;
                if (Fog != null && !Fog.IsVisible(view.Position)) continue;
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Resource, view.Position));
            }
        }

        public bool TryNearestActivityResource(Vector3 origin, out Vector3 position, out float distance)
        {
            position = Vector3.zero;
            distance = float.PositiveInfinity;
            float best = float.PositiveInfinity;
            bool found = false;
            foreach (ResourceView view in _resources.Values)
            {
                if (view == null || view.Data == null || view.Data["hp"]?.ToObject<float>() <= 0f) continue;
                Vector3 delta = view.Position - origin;
                delta.y = 0f;
                float candidate = delta.sqrMagnitude;
                if (candidate >= best) continue;
                best = candidate;
                position = view.Position;
                found = true;
            }
            if (found) distance = Mathf.Sqrt(best);
            return found;
        }

        public void CollectActivityResourceMarkers(List<RoaMinimap.Marker> markers)
        {
            if (markers == null) return;
            foreach (ResourceView view in _resources.Values)
            {
                if (view == null || view.Data == null || view.Data["hp"]?.ToObject<float>() <= 0f) continue;
                markers.Add(new RoaMinimap.Marker(RoaMinimap.MarkerKind.Objective, view.Position));
            }
        }

        private void FindCandidate()
        {
            ClearCandidate();
            Vector3 origin = Player.transform.position;
            float best = float.MaxValue;

            JObject actor;
            Vector3 actorPosition;
            if (Enemies != null && Enemies.TryFindInteractable(origin, ActorRange, out actor, out actorPosition))
            {
                Vector3 delta = actorPosition - origin;
                delta.y = 0f;
                best = delta.sqrMagnitude;
                _candidateKind = TargetKind.Actor;
                _candidate = actor;
                _candidatePosition = actorPosition;
            }

            foreach (ContainerView view in _containers.Values)
            {
                if (view.Root == null || view.Data == null) continue;
                if (Fog != null && !Fog.IsVisible(view.Root.transform.position)) continue;
                Vector3 delta = view.Root.transform.position - origin;
                delta.y = 0f;
                float distance = delta.sqrMagnitude;
                if (distance > ContainerRange * ContainerRange || distance >= best) continue;
                best = distance;
                _candidateKind = TargetKind.Container;
                _candidate = (JObject)view.Data.DeepClone();
                _candidatePosition = view.Root.transform.position;
            }

            foreach (ResourceView view in _resources.Values)
            {
                if (view.Data == null || view.Data["hp"]?.ToObject<float>() <= 0f) continue;
                if (Fog != null && !Fog.IsVisible(view.Position)) continue;
                Vector3 delta = view.Position - origin;
                delta.y = 0f;
                float distance = delta.sqrMagnitude;
                if (distance > ContainerRange * ContainerRange || distance >= best) continue;
                best = distance;
                _candidateKind = TargetKind.Resource;
                _candidate = (JObject)view.Data.DeepClone();
                _candidatePosition = view.Position;
            }


            foreach (StaticTarget target in _staticTargets)
            {
                float range = target.Range > 0f ? target.Range
                    : (target.Kind == TargetKind.Storage ? 4.5f : 5.0f);
                Vector3 delta = target.Position - origin;
                delta.y = 0f;
                float distance = delta.sqrMagnitude;
                if (distance > range * range || distance >= best) continue;
                best = distance;
                _candidateKind = target.Kind;
                _candidate = (JObject)target.Data.DeepClone();
                _candidatePosition = target.Position;
            }
        }

        private void ClearCandidate()
        {
            _candidateKind = TargetKind.None;
            _candidate = null;
            _candidatePosition = Vector3.zero;
        }

        public void TriggerInteract()
        {
            if (_panel != PanelKind.None) return;
            FindCandidate();
            if (!TryPickupGroundBeforeInteract()) Interact();
        }

        /// <summary>
        /// E is shared by the quickbar radial, world interaction and pickup.
        /// Both keyboard paths must use the same priority or an item at an NPC's
        /// feet becomes impossible to recover.
        /// </summary>
        private bool TryPickupGroundBeforeInteract()
        {
            RoaGroundItems groundItems = GroundItems != null
                ? GroundItems
                : GetComponent<RoaGroundItems>();
            if (GroundItems == null) GroundItems = groundItems;
            if (groundItems == null || !groundItems.HasPickupCandidate()) return false;
            return groundItems.RequestPickupNearest();
        }

        private void Interact()
        {
            if (_candidate == null || Socket == null) return;

            if (_candidateKind == TargetKind.Container)
            {
                OpenContainer(_candidate);
                return;
            }

            if (_candidateKind == TargetKind.TradeMachine)
            {
                OpenTradeMachine(_candidate);
                return;
            }
            if (_candidateKind == TargetKind.Storage)
            {
                _active = (JObject)_candidate.DeepClone();
                _panel = PanelKind.Storage;
                _scroll = Vector2.zero;
                return;
            }

            if (_candidateKind == TargetKind.Resource)
            {
                HarvestResource(_candidate);
                return;
            }
            if (_candidateKind == TargetKind.CraftingStation)
            {
                OpenCrafting(_candidate);
                return;
            }
            if (_candidateKind == TargetKind.JobBoard)
            {
                OpenJobBoard(_candidate);
                return;
            }
            if (_candidateKind == TargetKind.Transition)
            {
                UseLocationTransition(_candidate);
                return;
            }

            if (_candidateKind != TargetKind.Actor) return;
            if (_candidate["dead"]?.ToObject<bool>() == true) InspectCorpse(_candidate);
            else OpenNpc(_candidate);
        }

        private void UseLocationTransition(JObject transition)
        {
            if (_transitionPending || transition == null || Socket == null) return;
            string target = transition["to"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(target)) return;
            string entryKey = transition["entryKey"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(entryKey))
                entryKey = target == "settlement" ? "entryFromWasteland" : "entryFromSettlement";

            _transitionPending = true;
            Show("Переход в локацию…", 3f);
            Socket.EmitWithAck("changeLocation", new Dictionary<string, object>
            {
                ["locationId"] = target,
                ["entryKey"] = entryKey,
                ["deviceType"] = Application.isMobilePlatform ? "mobile" : "desktop",
                ["controlType"] = Application.isMobilePlatform ? "touch" : "keyboard_mouse"
            }, ack =>
            {
                _transitionPending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Сервер не разрешил переход.", 4f);
                    return;
                }
                if (Socket.ApplyLocationTransitionAck(ack) == null)
                    Show("Ответ перехода не удалось разобрать.", 4f);
            });
        }

        private void HarvestResource(JObject resource)
        {
            if (_harvestPending || resource == null) return;
            string id = resource["id"]?.ToString();
            string toolRuntimeId = _self?["equipmentRuntime"]?["weapon"]?.ToString() ?? string.Empty;
            string toolId = BaseItemId(toolRuntimeId);
            if (string.IsNullOrEmpty(id)) return;

            _harvestPending = true;
            Show("Добыча ресурса…", 2f);
            Socket.EmitWithAck("harvestResource", new Dictionary<string, object>
            {
                ["id"] = id,
                ["tx"] = resource["tx"]?.ToObject<int>() ?? 0,
                ["tz"] = resource["tz"]?.ToObject<int>() ?? 0,
                ["type"] = resource["type"]?.ToString() ?? string.Empty,
                ["toolId"] = toolRuntimeId,
                ["baseToolId"] = toolId
            }, ack =>
            {
                _harvestPending = false;
                ApplyActionAck(ack);
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Сервер отклонил добычу ресурса.");
                    return;
                }

                JObject item = ack["item"] as JObject;
                Show("Получено: " + (item?["id"]?.ToString() ?? "ресурс")
                    + " x" + (item?["qty"]?.ToObject<int>() ?? 1));
            });
        }

        private void OpenCrafting(JObject station)
        {
            _active = (JObject)station.DeepClone();
            _panel = PanelKind.Crafting;
            _scroll = Vector2.zero;
            _status = string.Empty;
        }

        private void OpenJobBoard(JObject board)
        {
            _active = (JObject)board.DeepClone();
            _panel = PanelKind.JobBoard;
            _scroll = Vector2.zero;
            Show("Получаем контракты пустоши…", 4f);
            if (!_worldRequestPending) StartCoroutine(LoadWastelandState());
        }

        private IEnumerator LoadWastelandState()
        {
            _worldRequestPending = true;
            using (UnityWebRequest request = UnityWebRequest.Get(BaseUrl.TrimEnd('/') + "/api/wasteland"))
            {
                request.SetRequestHeader("Cache-Control", "no-store");
                yield return request.SendWebRequest();
                _worldRequestPending = false;
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Show("Живая пустошь недоступна: " + request.error);
                    yield break;
                }

                try
                {
                    JObject payload = JObject.Parse(request.downloadHandler.text);
                    _world = payload["sim"] as JObject ?? new JObject();
                    _status = string.Empty;
                }
                catch (Exception error)
                {
                    Show("Некорректный ответ пустоши: " + error.Message);
                }
            }
        }

        private void OpenTradeMachine(JObject machine)
        {
            string id = machine?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            Show("Получаем ассортимент…", 2f);
            Socket.EmitWithAck("tradeMachineMarketState", new Dictionary<string, object>
            {
                ["machineId"] = id
            }, ack =>
            {
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Торговый автомат недоступен.");
                    return;
                }

                _active = (JObject)machine.DeepClone();
                if (!string.IsNullOrEmpty(ack["name"]?.ToString())) _active["name"] = ack["name"];
                _market = (JObject)ack.DeepClone();
                ClearTradeQueue();
                _panel = PanelKind.MachineTrade;
                _scroll = Vector2.zero;
                _status = string.Empty;
            });
        }

        private void OpenNpc(JObject actor)
        {
            _active = (JObject)actor.DeepClone();
            _market = null;
            ClearTradeQueue();
            _panel = PanelKind.Npc;
            _scroll = Vector2.zero;
            FocusNpc(true);
        }

        private void FocusNpc(bool active)
        {
            string id = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(id) || Socket == null) return;
            _nextDialogueFocusAt = active ? Time.unscaledTime + 3.5f : 0f;
            Socket.EmitWithAck("npcDialogueFocus", new Dictionary<string, object>
            {
                ["enemyId"] = id,
                ["active"] = active
            }, ack =>
            {
                if (ack?["enemy"] is JObject enemy)
                {
                    Enemies?.ApplyPublicEnemy(enemy);
                    if (_active != null && enemy["id"]?.ToString() == _active["id"]?.ToString())
                        _active = (JObject)enemy.DeepClone();
                }
                if (active && ack?["ok"]?.ToObject<bool>() != true)
                    Show(ack?["error"]?.ToString() ?? "НПС не отвечает.");
            });
        }

        private void InspectCorpse(JObject corpse)
        {
            string id = corpse["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            Socket.EmitWithAck("inspectCorpse", new Dictionary<string, object>
            {
                ["enemyId"] = id,
                ["reason"] = "open"
            }, ack =>
            {
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Тело недоступно.");
                    return;
                }

                JObject enemy = ack["enemy"] as JObject ?? corpse;
                Enemies?.ApplyPublicEnemy(enemy);
                _active = (JObject)enemy.DeepClone();
                _panel = PanelKind.Corpse;
                _scroll = Vector2.zero;
                _nextCorpseHoldAt = Time.unscaledTime + 12f;
            });
        }

        private void OpenContainer(JObject container)
        {
            string id = container["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            Socket.EmitWithAck("openWorldContainer", new Dictionary<string, object>
            {
                ["containerId"] = id
            }, ack =>
            {
                JObject fresh = ack?["container"] as JObject ?? container;
                UpsertContainer(fresh);
                _active = (JObject)fresh.DeepClone();
                _panel = PanelKind.Container;
                _scroll = Vector2.zero;

                if (ack?["ok"]?.ToObject<bool>() != true)
                    Show(ack?["error"]?.ToString() ?? "Контейнер недоступен.");
            });
        }

        private void MaintainServerHolds()
        {
            if (_panel == PanelKind.Corpse && Time.unscaledTime >= _nextCorpseHoldAt)
            {
                _nextCorpseHoldAt = Time.unscaledTime + 12f;
                string id = _active?["id"]?.ToString();
                if (!string.IsNullOrEmpty(id))
                    Socket.EmitWithAck("inspectCorpse", new Dictionary<string, object>
                    {
                        ["enemyId"] = id,
                        ["reason"] = "heartbeat"
                    }, ApplyEnemyAck);
            }

            if ((_panel == PanelKind.Npc || _panel == PanelKind.Trade)
                && Time.unscaledTime >= _nextDialogueFocusAt)
                FocusNpc(true);
        }

        private void ClosePanel(bool notifyServer)
        {
            if (notifyServer && Socket != null && _active != null)
            {
                string id = _active["id"]?.ToString();
                if (_panel == PanelKind.Corpse && !string.IsNullOrEmpty(id))
                    Socket.EmitWithAck("releaseCorpseLoot", new Dictionary<string, object>
                    {
                        ["enemyId"] = id
                    }, null);
                else if ((_panel == PanelKind.Npc || _panel == PanelKind.Trade)
                         && !string.IsNullOrEmpty(id))
                    FocusNpc(false);
            }

            _panel = PanelKind.None;
            _active = null;
            _market = null;
            ClearTradeQueue();
            _scroll = Vector2.zero;
            _nextCorpseHoldAt = 0f;
            _nextDialogueFocusAt = 0f;
            CloseQuantity();
        }

        private void RequestTrade()
        {
            string id = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            Show("Получаем ассортимент…", 2f);
            Socket.EmitWithAck("syncNpcTradeState", new Dictionary<string, object>
            {
                ["enemyId"] = id
            }, ack =>
            {
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Торговля недоступна.");
                    return;
                }
                ApplyEnemyAck(ack);
                _market = ack["market"] as JObject;
                ClearTradeQueue();
                _panel = PanelKind.Trade;
                _scroll = Vector2.zero;
                _status = string.Empty;
            });
        }

        private int QueuedTradeQuantity(string itemRuntimeId, bool buy)
        {
            Dictionary<string, int> queue = buy ? _tradeBuys : _tradeSells;
            int qty;
            return queue.TryGetValue(itemRuntimeId ?? string.Empty, out qty) ? Mathf.Max(0, qty) : 0;
        }

        private void QueueTradeItem(string itemRuntimeId, bool buy, int qty = 1)
        {
            if (_tradePending || string.IsNullOrEmpty(itemRuntimeId)) return;
            int available = buy
                ? Mathf.Max(0, MarketStockQuantity(itemRuntimeId) - QueuedTradeQuantity(itemRuntimeId, true))
                : Mathf.Max(0, InventoryRuntimeQuantity(itemRuntimeId) - QueuedTradeQuantity(itemRuntimeId, false));
            int added = Mathf.Min(Mathf.Max(1, qty), available);
            if (added <= 0)
            {
                Show("Этот товар больше недоступен для обмена.");
                return;
            }

            Dictionary<string, int> queue = buy ? _tradeBuys : _tradeSells;
            queue[itemRuntimeId] = QueuedTradeQuantity(itemRuntimeId, buy) + added;
            Show(RoaItemData.Name(itemRuntimeId) + " добавлен" + (buy ? " в покупку." : " в продажу."), 2f);
        }

        private void RemoveTradeItem(string itemRuntimeId, bool buy, int qty)
        {
            Dictionary<string, int> queue = buy ? _tradeBuys : _tradeSells;
            int current;
            if (!queue.TryGetValue(itemRuntimeId ?? string.Empty, out current)) return;
            int next = current - Mathf.Max(1, qty);
            if (next <= 0) queue.Remove(itemRuntimeId);
            else queue[itemRuntimeId] = next;
        }

        private void ClearTradeQueue()
        {
            _tradeBuys.Clear();
            _tradeSells.Clear();
            _tradePending = false;
        }

        private void ReconcileTradeQueue()
        {
            if (_tradeBuys.Count > 0)
            {
                var keys = new List<string>(_tradeBuys.Keys);
                foreach (string id in keys)
                {
                    int qty = Mathf.Min(_tradeBuys[id], MarketStockQuantity(id));
                    if (qty <= 0) _tradeBuys.Remove(id);
                    else _tradeBuys[id] = qty;
                }
            }

            if (_tradeSells.Count > 0)
            {
                var keys = new List<string>(_tradeSells.Keys);
                foreach (string runtimeId in keys)
                {
                    int qty = Mathf.Min(_tradeSells[runtimeId], InventoryRuntimeQuantity(runtimeId));
                    if (qty <= 0) _tradeSells.Remove(runtimeId);
                    else _tradeSells[runtimeId] = qty;
                }
            }
        }

        private int MarketStockQuantity(string itemId)
        {
            string baseId = BaseItemId(itemId);
            JArray stock = _market?["stock"] as JArray;
            if (stock == null) return 0;
            foreach (JToken row in stock)
                if (BaseItemId(row?["id"]?.ToString()) == baseId)
                    return Mathf.Max(0, row?["qty"]?.ToObject<int>() ?? 0);
            return 0;
        }

        private int InventoryRuntimeQuantity(string itemRuntimeId)
        {
            JArray inventory = _self?["inventory"] as JArray;
            if (inventory == null || string.IsNullOrEmpty(itemRuntimeId)) return 0;
            int total = 0;
            foreach (JToken row in inventory)
                if (row?["id"]?.ToString() == itemRuntimeId)
                    total += Mathf.Max(0, row?["qty"]?.ToObject<int>() ?? 0);
            return total;
        }

        private static int InventoryQuantity(JArray inventory, string itemId)
        {
            if (inventory == null || string.IsNullOrEmpty(itemId)) return 0;
            int total = 0;
            foreach (JToken row in inventory)
                if (BaseItemId(row?["id"]?.ToString()) == itemId)
                    total += Mathf.Max(0, row?["qty"]?.ToObject<int>() ?? 0);
            return total;
        }

        private void SubmitTradeQueue()
        {
            if (_tradePending) return;
            ReconcileTradeQueue();
            if (_tradeBuys.Count == 0 && _tradeSells.Count == 0)
            {
                Show("Добавьте товары в обмен.");
                return;
            }

            string actorId = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(actorId) || Socket == null) return;
            bool machine = _panel == PanelKind.MachineTrade;
            var buys = new List<Dictionary<string, object>>();
            var sells = new List<Dictionary<string, object>>();
            foreach (KeyValuePair<string, int> entry in _tradeBuys)
            {
                buys.Add(new Dictionary<string, object>
                {
                    ["id"] = BaseItemId(entry.Key),
                    ["itemRuntimeId"] = entry.Key,
                    ["qty"] = entry.Value
                });
            }
            foreach (KeyValuePair<string, int> entry in _tradeSells)
            {
                sells.Add(new Dictionary<string, object>
                {
                    ["id"] = BaseItemId(entry.Key),
                    ["itemRuntimeId"] = entry.Key,
                    ["qty"] = entry.Value
                });
            }

            var payload = new Dictionary<string, object>
            {
                ["buys"] = buys,
                ["sells"] = sells
            };
            payload[machine ? "machineId" : "enemyId"] = actorId;
            if (_self?["inventory"] != null) payload["inventory"] = _self["inventory"].DeepClone();
            if (_self?["carry"] != null) payload["carry"] = _self["carry"].DeepClone();
            if (_self?["special"] != null) payload["special"] = _self["special"].DeepClone();
            if (_self?["skillRanks"] != null) payload["skillRanks"] = _self["skillRanks"].DeepClone();
            if (_self?["talentRanks"] != null) payload["talentRanks"] = _self["talentRanks"].DeepClone();
            if (_self?["traits"] != null) payload["traits"] = _self["traits"].DeepClone();
            if (_self?["level"] != null) payload["level"] = _self["level"].DeepClone();

            _tradePending = true;
            Show("Сервер проверяет обмен…", 4f);
            Socket.EmitWithAck(machine ? "tradeMachineExchange" : "npcTradeExchange", payload, ack =>
            {
                _tradePending = false;
                ApplyActionAck(ack);
                if (ack?["market"] is JObject market) _market = (JObject)market.DeepClone();
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                if (!ok)
                {
                    ReconcileTradeQueue();
                    Show(ack?["error"]?.ToString() ?? "Сервер отклонил обмен.", 5f);
                    return;
                }

                int net = ack?["net"]?.ToObject<int>() ?? 0;
                string balance = net > 0 ? "доплата " + net
                    : net < 0 ? "получено " + Mathf.Abs(net)
                    : "без доплаты";
                ClearTradeQueue();
                Show("Обмен подтверждён сервером: " + balance + " крышек.", 5f);
            });
        }

        private void StorageTransfer(string itemRuntimeId, bool deposit, int qty = 1)
        {
            if (string.IsNullOrEmpty(itemRuntimeId)) return;
            string baseId = BaseItemId(itemRuntimeId);
            var row = new Dictionary<string, object>
            {
                ["id"] = baseId,
                ["itemRuntimeId"] = itemRuntimeId,
                ["qty"] = Mathf.Max(1, qty)
            };

            Socket.EmitWithAck("storageTransfer", new Dictionary<string, object>
            {
                ["direction"] = deposit ? "deposit" : "withdraw",
                ["rows"] = new[] { row }
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                Show(ok ? (deposit ? "Предмет помещён в хранилище." : "Предмет забран из хранилища.")
                    : (ack?["error"]?.ToString() ?? "Сервер отклонил перенос."));
            });
        }

        private void Craft(RoaCraftRecipe recipe)
        {
            if (_craftPending || recipe == null || _active == null) return;
            string stationObjectId = _active["id"]?.ToString();
            string station = _active["station"]?.ToString();
            if (string.IsNullOrEmpty(stationObjectId) || station != recipe.Station) return;

            _craftPending = true;
            Show("Станок выполняет заказ…", 3f);
            Socket.EmitWithAck("craftingStationUsed", new Dictionary<string, object>
            {
                ["recipeId"] = recipe.Id,
                ["station"] = recipe.Station,
                ["fee"] = recipe.Fee,
                ["locationId"] = _locationId,
                ["stationObjectId"] = stationObjectId
            }, ack =>
            {
                _craftPending = false;
                ApplyActionAck(ack);
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(CraftingError(ack));
                    return;
                }

                JObject output = ack["output"] as JObject;
                Show("Создано: " + RoaItemData.Name(output?["id"]?.ToString() ?? recipe.OutputId)
                    + " x" + (output?["qty"]?.ToObject<int>() ?? recipe.OutputQty));
            });
        }

        private void WorldTaskAction(JObject task, string action)
        {
            if (task == null) return;
            SubmitWorldTaskAction(task["id"]?.ToString(), action);
        }

        /// <summary>
        /// Выполнить тот же серверный маршрут контракта, что использует окно доски контрактов.
        /// Публичный вход также позволяет проверять production-путь в собранном клиенте.
        /// </summary>
        public bool SubmitWorldTaskAction(string taskId, string action, Action<JObject> completed = null)
        {
            if (_worldRequestPending || Socket == null || string.IsNullOrEmpty(taskId)
                || string.IsNullOrEmpty(action)) return false;
            _worldRequestPending = true;
            Show("Сервер обновляет контракт…", 3f);
            Socket.EmitWithAck("worldTaskAction", new Dictionary<string, object>
            {
                ["taskId"] = taskId,
                ["action"] = action
            }, ack =>
            {
                _worldRequestPending = false;
                ApplyActionAck(ack);
                if (ack?["sim"] is JObject sim) _world = (JObject)sim.DeepClone();
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Сервер отклонил действие с работой.");
                    completed?.Invoke(ack);
                    return;
                }

                if (action == "accept") Show("Контракт принят.");
                else if (action == "cancel") Show("Контракт отменён.");
                else if (action == "track") Show(string.IsNullOrEmpty(ack["trackedId"]?.ToString())
                    ? "Метка снята." : "Контракт отслеживается.");
                else if (action == "deliver") Show("Припасы доставлены.");
                else if (action == "claim")
                {
                    JObject reward = ack["reward"] as JObject;
                    Show("Награда: " + (reward?["xp"]?.ToObject<int>() ?? 0) + " XP, "
                        + (reward?["caps"]?.ToObject<int>() ?? 0) + " крышек.");
                }
                else Show("Контракт обновлён.");
                completed?.Invoke(ack);
            });
            return true;
        }

        /// <summary>
        /// Просит авторитетный сервер подобрать наиболее срочную короткую вылазку.
        /// Сервер сам принимает и помечает задачу; клиент только применяет ack и строит маршрут.
        /// </summary>
        public bool SubmitQuickWorldActivity(Action<JObject> completed = null)
        {
            if (_worldRequestPending || Socket == null) return false;
            _worldRequestPending = true;
            Show("Ищем активную вылазку…", 3f);
            Socket.EmitWithAck("worldActivityQuickJoin", new Dictionary<string, object>(), ack =>
            {
                _worldRequestPending = false;
                ApplyActionAck(ack);
                if (ack?["sim"] is JObject sim) _world = (JObject)sim.DeepClone();
                if (ack?["ok"]?.ToObject<bool>() != true)
                    Show(ack?["error"]?.ToString() ?? "Сервер не нашёл доступную вылазку.");
                else
                    Show(ack?["joinSource"]?.ToString() == "help_signal"
                        ? "Найден отряд, которому нужна помощь."
                        : "Вылазка подобрана. Маршрут отмечен.");
                completed?.Invoke(ack);
            });
            return true;
        }

        private void JoinWorldFaction(string factionId)
        {
            SubmitWorldFactionJoin(factionId);
        }

        public bool SubmitWorldFactionJoin(string factionId, Action<JObject> completed = null)
        {
            if (_worldRequestPending || Socket == null || string.IsNullOrEmpty(factionId)) return false;
            _worldRequestPending = true;
            Show("Сервер оформляет вступление…", 3f);
            Socket.EmitWithAck("worldFactionJoin", new Dictionary<string, object>
            {
                ["factionId"] = factionId
            }, ack =>
            {
                _worldRequestPending = false;
                ApplyActionAck(ack);
                Show(ack?["ok"]?.ToObject<bool>() == true
                    ? "Фракция выбрана: " + FactionLabel(factionId)
                    : (ack?["error"]?.ToString() ?? "Вступление отклонено."));
                completed?.Invoke(ack);
            });
            return true;
        }

        private void SubmitQuest(string questId, string action)
        {
            string actorId = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(actorId) || string.IsNullOrEmpty(questId)) return;
            Socket.EmitWithAck("npcQuestAction", new Dictionary<string, object>
            {
                ["enemyId"] = actorId,
                ["questId"] = questId,
                ["action"] = action
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                string message = ack?["error"]?.ToString();
                if (ok && action == "negotiate")
                    message = ack?["success"]?.ToObject<bool>() == true
                        ? "Проверка навыка успешна. Награда улучшена."
                        : "Проверка навыка не удалась.";
                else if (ok) message = action == "accept" ? "Задание принято." : "Задание обновлено.";
                Show(message ?? "Сервер отклонил действие задания.");
            });
        }

        private void Loot(string itemId, bool all, int qty = 1)
        {
            string id = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;

            string eventName = _panel == PanelKind.Corpse ? "lootEnemy" : "lootWorldContainer";
            var payload = new Dictionary<string, object>();
            if (_panel == PanelKind.Corpse) payload["enemyId"] = id;
            else payload["containerId"] = id;
            if (all) payload["mode"] = "all";
            else
            {
                payload["itemId"] = itemId;
                payload["qty"] = Mathf.Max(1, qty);
            }

            Socket.EmitWithAck(eventName, payload, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                if (!ok)
                {
                    Show(ack?["error"]?.ToString() ?? "Не удалось забрать предмет.");
                    return;
                }

                int count = 0;
                foreach (JToken row in ack["items"] as JArray ?? new JArray())
                    count += row["qty"]?.ToObject<int>() ?? 0;
                Show(count > 0 ? "Получено предметов: " + count : "Нечего забирать.");

                if (ack["removed"]?.ToObject<bool>() == true)
                    ClosePanel(false);
            });
        }

        private void SecurityAction(string action)
        {
            string id = _active?["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) return;
            Socket.EmitWithAck(action, new Dictionary<string, object>
            {
                ["containerId"] = id
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                bool success = ack?["success"]?.ToObject<bool>() ?? false;
                Show(success ? "Доступ открыт." : (ack?["error"]?.ToString()
                    ?? (ok ? "Попытка не удалась." : "Сервер отклонил действие.")));
                if (success && ack?["container"] is JObject container) OpenContainer(container);
            });
        }

        private void ApplyActionAck(JObject ack)
        {
            if (ack == null) return;
            Socket?.ApplyGameplayAck(ack);
            ApplyEnemyAck(ack);
            if (ack["container"] is JObject container)
            {
                UpsertContainer(container);
                RefreshActiveContainer(container);
            }
            if (ack["resource"] is JObject resource) UpsertResource(resource);
        }

        private void ApplyEnemyAck(JObject ack)
        {
            if (!(ack?["enemy"] is JObject enemy)) return;
            Enemies?.ApplyPublicEnemy(enemy);
            if (_active != null && enemy["id"]?.ToString() == _active["id"]?.ToString())
                _active = (JObject)enemy.DeepClone();
        }

        private void RefreshActiveContainer(JObject row)
        {
            if (_active == null || row == null) return;
            if ((_panel == PanelKind.Container)
                && row["id"]?.ToString() == _active["id"]?.ToString())
                _active = (JObject)row.DeepClone();
        }

        public void ClearWorld()
        {
            ClosePanel(false);
            foreach (ContainerView view in _containers.Values)
                if (view.Root != null) Destroy(view.Root);
            _containers.Clear();
            foreach (ResourceView view in _resources.Values)
                if (view.Marker != null) Destroy(view.Marker);
            _resources.Clear();
            _authoredResourceIds.Clear();
            ClearStaticTargets();
            _locationReady = false;
            _locationId = string.Empty;
            _encounterLocation = false;
            _craftPending = false;
            _harvestPending = false;
            _transitionPending = false;
            _world = new JObject();
            _worldRequestPending = false;
            ClearCandidate();
        }

        private void ClearStaticTargets()
        {
            foreach (StaticTarget target in _staticTargets)
                if (target?.Marker != null) Destroy(target.Marker);
            _staticTargets.Clear();
        }

        private void RemoveContainer(string id)
        {
            ContainerView view;
            if (!_containers.TryGetValue(id, out view)) return;
            if (view.Root != null) Destroy(view.Root);
            _containers.Remove(id);
            if (_active != null && _active["id"]?.ToString() == id) ClosePanel(false);
        }

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (_quantityKind != QuantityKind.None)
            {
                if (!QuantityCanvasDriven) DrawQuantity();
                return;
            }
            if (_panel == PanelKind.None)
            {
                if (HintCanvasDriven) return;
                if (!RoaGameBootstrap.BlocksWorldHud) DrawInteractionHint();
                DrawStatus();
                return;
            }

            // Бартер в канва-виде: IMGUI-окно этих панелей не рисуется, чтобы
            // два окна торговли не спорили за одни и те же кнопки.
            if (TradeCanvasDriven && (_panel == PanelKind.Trade || _panel == PanelKind.MachineTrade))
            {
                if (!HintCanvasDriven) DrawStatus();
                return;
            }
            if (LootCanvasDriven && (_panel == PanelKind.Corpse || _panel == PanelKind.Container || _panel == PanelKind.Storage))
            {
                if (!HintCanvasDriven) DrawStatus();
                return;
            }
            if (DialogueCanvasDriven && (_panel == PanelKind.Npc || _panel == PanelKind.JobBoard))
            {
                if (!HintCanvasDriven) DrawStatus();
                return;
            }

            const float width = 560f;
            float height = Mathf.Min(580f, Screen.height - 24f);
            var area = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f,
                width, height);
            GUILayout.BeginArea(area, GUI.skin.box);

            GUILayout.BeginHorizontal();
            GUILayout.Label("<b>" + PanelTitle() + "</b>", Rich());
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("Закрыть  Esc", GUILayout.Width(100f))) ClosePanel(true);
            GUILayout.EndHorizontal();
            GUILayout.Space(6f);

            _scroll = GUILayout.BeginScrollView(_scroll);
            if (_panel == PanelKind.Npc) DrawNpc();
            else if (_panel == PanelKind.Trade || _panel == PanelKind.MachineTrade) DrawTrade();
            else if (_panel == PanelKind.Storage) DrawStorage();
            else if (_panel == PanelKind.Crafting) DrawCrafting();
            else if (_panel == PanelKind.JobBoard) DrawJobBoard();
            else DrawLoot();
            GUILayout.EndScrollView();

            if (!string.IsNullOrEmpty(_status) && Time.unscaledTime <= _statusUntil)
            {
                GUILayout.Space(5f);
                GUILayout.Label(_status, Wrap());
            }
            GUILayout.EndArea();
        }

        private void DrawInteractionHint()
        {
            if (_candidateKind == TargetKind.None || _candidate == null) return;
            string name = _candidate["name"]?.ToString() ?? "Объект";
            string action;
            if (_candidateKind == TargetKind.Resource) action = "добыть";
            else if (_candidateKind == TargetKind.CraftingStation) action = "создать предмет";
            else if (_candidateKind == TargetKind.JobBoard) action = "посмотреть контракты";
            else if (_candidateKind == TargetKind.Transition) action = "перейти";
            else if (_candidateKind == TargetKind.Container || _candidateKind == TargetKind.Storage) action = "открыть";
            else if (_candidateKind == TargetKind.TradeMachine) action = "торговать";
            else action = _candidate["dead"]?.ToObject<bool>() == true ? "обыскать" : "говорить";

            const float width = 360f;
            var area = new Rect((Screen.width - width) * 0.5f, Screen.height - 92f, width, 80f);
            GUILayout.BeginArea(area, GUI.skin.box);
            GUILayout.Label(name + " — " + InteractKey + ": " + action, Center());
            if (GUILayout.Button("Взаимодействовать", GUILayout.Height(30f))) Interact();
            GUILayout.EndArea();
        }

        private void DrawStatus()
        {
            if (string.IsNullOrEmpty(_status) || Time.unscaledTime > _statusUntil) return;
            var area = new Rect(12f, Screen.height - 62f, 440f, 50f);
            GUILayout.BeginArea(area, GUI.skin.box);
            GUILayout.Label(_status, Wrap());
            GUILayout.EndArea();
        }

        private void DrawNpc()
        {
            if (_active == null) return;
            string speech = _active["speechText"]?.ToString();
            if (string.IsNullOrEmpty(speech))
            {
                string schedule = _active["scheduleLabel"]?.ToString();
                speech = string.IsNullOrEmpty(schedule)
                    ? "Путник внимательно смотрит на вас."
                    : "Сейчас я " + schedule + ". Говори по делу.";
            }
            GUILayout.Label(speech, Wrap());

            JObject personality = _active["personality"] as JObject;
            if (personality != null)
                GUILayout.Label("Характер: " + (personality["label"]?.ToString() ?? personality["id"]?.ToString()), Dim());

            GUILayout.Space(8f);
            if (NpcHasTrade(_active) && GUILayout.Button("Показать товары", GUILayout.Height(32f)))
                RequestTrade();

            if (CanRobEncounterActor(_active)
                && GUILayout.Button("Ограбить караван", GUILayout.Height(32f)))
                RobEncounterActor();

            JArray questIds = _active["traderQuests"] as JArray;
            if (questIds != null && questIds.Count > 0)
            {
                GUILayout.Space(10f);
                GUILayout.Label("<b>Задания</b>", Rich());
                foreach (JToken token in questIds)
                {
                    string id = token?.ToString();
                    if (string.IsNullOrEmpty(id)) continue;
                    DrawQuest(id);
                }
            }
        }

        private void DrawQuest(string id)
        {
            JObject definition = _quests[id] as JObject;
            string name = definition?["name"]?.ToString() ?? id;
            string state = QuestState(id);
            GUILayout.BeginVertical(GUI.skin.box);
            GUILayout.Label(name + "  [" + QuestStateLabel(state) + "]");

            JObject panel = definition?["panel"] as JObject;
            string description = panel?[state]?.ToString();
            if (string.IsNullOrEmpty(description) && state == "available")
                description = "Можно принять это поручение.";
            if (!string.IsNullOrEmpty(description)) GUILayout.Label(description, Wrap());

            GUILayout.BeginHorizontal();
            if (state == "available" && GUILayout.Button("Принять")) SubmitQuest(id, "accept");
            if (state == "active")
            {
                if (GUILayout.Button("Сдать")) SubmitQuest(id, "complete");
                if (GUILayout.Button("Договориться")) SubmitQuest(id, "negotiate");
                if (GUILayout.Button("Отказаться")) SubmitQuest(id, "cancel");
            }
            GUILayout.EndHorizontal();
            GUILayout.EndVertical();
        }

        private bool CanRobEncounterActor(JObject actor)
        {
            if (!_encounterLocation || actor == null) return false;
            if (actor["dead"]?.ToObject<bool>() == true) return false;
            if (actor["hostileToPlayer"]?.ToObject<bool>() != false) return false;

            string role = (actor["encounterRole"]?.ToString() ?? actor["role"]?.ToString() ?? string.Empty).ToLowerInvariant();
            string faction = (actor["faction"]?.ToString() ?? string.Empty).ToLowerInvariant();
            return role == "merchant" || role == "trader"
                || faction == "caravan" || faction == "caravans" || faction == "klim_patrol";
        }

        private void RobEncounterActor()
        {
            SubmitRobEncounterActor(_active?["id"]?.ToString());
        }

        /// <summary>Ограбить мирного участника встречи тем же маршрутом, что использует окно диалога.</summary>
        public bool SubmitRobEncounterActor(string enemyId, Action<JObject> completed = null)
        {
            if (_robPending || Socket == null || string.IsNullOrEmpty(enemyId)) return false;
            JObject actor = null;
            if (Enemies != null) Enemies.TryGetSnapshot(enemyId, out actor);
            if (actor == null && _active?["id"]?.ToString() == enemyId) actor = _active;
            if (!CanRobEncounterActor(actor)) return false;

            _robPending = true;
            Show("Караван поднимает тревогу…", 3f);
            Socket.EmitWithAck("robEncounterActor", new Dictionary<string, object>
            {
                ["enemyId"] = enemyId
            }, ack =>
            {
                _robPending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Ограбление не удалось.");
                    completed?.Invoke(ack);
                    return;
                }

                JArray enemies = ack["enemies"] as JArray;
                if (enemies != null)
                {
                    foreach (JToken token in enemies)
                        Enemies?.ApplyPublicEnemy(token as JObject);
                }

                string targetName = ack["targetName"]?.ToString()
                    ?? actor["name"]?.ToString()
                    ?? "караван";
                ClosePanel(true);
                Show(targetName + " сопротивляется. Победите охрану, чтобы забрать вещи.", 5f);
                completed?.Invoke(ack);
            });
            return true;
        }

        private void DrawTrade()
        {
            if (_active == null || _market == null)
            {
                GUILayout.Label("Ассортимент ещё не получен.");
                return;
            }

            GUILayout.Label("Крышек у торговца: " + (_market["caps"]?.ToObject<int>() ?? 0));
            GUILayout.Label("Ваши крышки: " + InventoryQuantity(_self?["inventory"] as JArray, "silver"));
            GUILayout.Label("Цена в списке базовая; навыки, вес и итог сделки проверяет сервер.", Dim());
            DrawTradeQueue();
            GUILayout.Space(8f);
            GUILayout.Label("<b>Купить</b>", Rich());

            JArray stock = _market["stock"] as JArray;
            if (stock == null || stock.Count == 0) GUILayout.Label("Нет товаров.");
            else foreach (JToken row in stock)
            {
                string id = row["id"]?.ToString();
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                int price = row["price"]?.ToObject<int>() ?? 0;
                int queued = QueuedTradeQuantity(id, true);
                int available = Mathf.Max(0, qty - queued);
                GUILayout.BeginHorizontal();
                string queuedLabel = queued > 0 ? " · в обмене " + queued : string.Empty;
                GUILayout.Label(RoaItemData.Name(id) + "  x" + available + "  · " + price + queuedLabel,
                    GUILayout.ExpandWidth(true));
                GUI.enabled = !_tradePending && available > 0;
                if (GUILayout.Button("+1", GUILayout.Width(58f))) QueueTradeItem(id, true);
                GUI.enabled = !_tradePending && available > 1;
                if (GUILayout.Button("количество", GUILayout.Width(100f)))
                    OpenQuantity(QuantityKind.TradeBuy, id, available, "В покупку: " + RoaItemData.Name(id));
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }

            GUILayout.Space(10f);
            GUILayout.Label("<b>Продать</b>", Rich());
            JArray inventory = _self?["inventory"] as JArray;
            bool any = false;
            if (inventory != null) foreach (JToken row in inventory)
            {
                string runtimeId = row["id"]?.ToString();
                string baseId = BaseItemId(runtimeId);
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(runtimeId) || qty <= 0 || baseId == "silver" || baseId == "fists") continue;
                any = true;
                int queued = QueuedTradeQuantity(runtimeId, false);
                int available = Mathf.Max(0, qty - queued);
                GUILayout.BeginHorizontal();
                string queuedLabel = queued > 0 ? " · в обмене " + queued : string.Empty;
                GUILayout.Label(RoaItemData.Name(baseId) + "  x" + available + queuedLabel, GUILayout.ExpandWidth(true));
                GUI.enabled = !_tradePending && available > 0;
                if (GUILayout.Button("+1", GUILayout.Width(58f))) QueueTradeItem(runtimeId, false);
                GUI.enabled = !_tradePending && available > 1;
                if (GUILayout.Button("количество", GUILayout.Width(100f)))
                    OpenQuantity(QuantityKind.TradeSell, runtimeId, available, "В продажу: " + RoaItemData.Name(baseId));
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
            if (!any) GUILayout.Label("Нет предметов для продажи.");

            GUILayout.Space(10f);
            if (_panel == PanelKind.Trade && GUILayout.Button("Вернуться к разговору"))
            {
                ClearTradeQueue();
                _panel = PanelKind.Npc;
            }
        }

        private void DrawTradeQueue()
        {
            GUILayout.Space(8f);
            GUILayout.Label("<b>Обмен</b>", Rich());
            if (_tradeBuys.Count == 0 && _tradeSells.Count == 0)
            {
                GUILayout.Label("Корзина пуста: добавьте товары из списков ниже.", Dim());
                return;
            }

            foreach (KeyValuePair<string, int> entry in new List<KeyValuePair<string, int>>(_tradeBuys))
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label("Купить · " + RoaItemData.Name(entry.Key) + " x" + entry.Value,
                    GUILayout.ExpandWidth(true));
                GUI.enabled = !_tradePending;
                if (GUILayout.Button("−1", GUILayout.Width(52f))) RemoveTradeItem(entry.Key, true, 1);
                if (GUILayout.Button("убрать", GUILayout.Width(72f))) RemoveTradeItem(entry.Key, true, entry.Value);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
            foreach (KeyValuePair<string, int> entry in new List<KeyValuePair<string, int>>(_tradeSells))
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label("Продать · " + RoaItemData.Name(entry.Key) + " x" + entry.Value,
                    GUILayout.ExpandWidth(true));
                GUI.enabled = !_tradePending;
                if (GUILayout.Button("−1", GUILayout.Width(52f))) RemoveTradeItem(entry.Key, false, 1);
                if (GUILayout.Button("убрать", GUILayout.Width(72f))) RemoveTradeItem(entry.Key, false, entry.Value);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }

            GUILayout.BeginHorizontal();
            GUI.enabled = !_tradePending;
            if (GUILayout.Button("Очистить", GUILayout.Height(34f))) ClearTradeQueue();
            if (GUILayout.Button(_tradePending ? "Проверка…" : "Подтвердить обмен", GUILayout.Height(34f)))
                SubmitTradeQueue();
            GUI.enabled = true;
            GUILayout.EndHorizontal();
        }

        private void DrawStorage()
        {
            GUILayout.Label("Все перемещения подтверждает сервер. Заряженное оружие перед переносом нужно разрядить.", Dim());
            GUILayout.Space(8f);
            GUILayout.Label("<b>Рюкзак</b>", Rich());
            JArray inventory = _self?["inventory"] as JArray;
            bool anyInventory = false;
            if (inventory != null) foreach (JToken row in inventory)
            {
                string runtimeId = row["id"]?.ToString();
                string baseId = BaseItemId(runtimeId);
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(runtimeId) || qty <= 0 || baseId == "silver" || baseId == "fists") continue;
                anyInventory = true;
                GUILayout.BeginHorizontal();
                GUILayout.Label(RoaItemData.Name(baseId) + "  x" + qty, GUILayout.ExpandWidth(true));
                if (GUILayout.Button("положить 1", GUILayout.Width(100f))) StorageTransfer(runtimeId, true);
                if (qty > 1 && GUILayout.Button("количество", GUILayout.Width(100f)))
                    OpenQuantity(QuantityKind.StorageDeposit, runtimeId, qty, "Положить: " + RoaItemData.Name(baseId));
                GUILayout.EndHorizontal();
            }
            if (!anyInventory) GUILayout.Label("Нет предметов для хранения.");

            GUILayout.Space(10f);
            GUILayout.Label("<b>Хранилище</b>", Rich());
            JArray storage = _self?["storage"] as JArray;
            bool anyStorage = false;
            if (storage != null) foreach (JToken row in storage)
            {
                string runtimeId = row["id"]?.ToString();
                string baseId = BaseItemId(runtimeId);
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(runtimeId) || qty <= 0) continue;
                anyStorage = true;
                GUILayout.BeginHorizontal();
                GUILayout.Label(RoaItemData.Name(baseId) + "  x" + qty, GUILayout.ExpandWidth(true));
                if (GUILayout.Button("забрать 1", GUILayout.Width(100f))) StorageTransfer(runtimeId, false);
                if (qty > 1 && GUILayout.Button("количество", GUILayout.Width(100f)))
                    OpenQuantity(QuantityKind.StorageWithdraw, runtimeId, qty, "Забрать: " + RoaItemData.Name(baseId));
                GUILayout.EndHorizontal();
            }
            if (!anyStorage) GUILayout.Label("Пусто.");
        }

        private void DrawCrafting()
        {
            string station = _active?["station"]?.ToString() ?? string.Empty;
            GUILayout.Label("Состав рюкзака и результат повторно проверяет сервер. Комиссия поступает владельцу мастерской.", Dim());
            GUILayout.Space(8f);

            bool any = false;
            foreach (RoaCraftRecipe recipe in RoaCraftingData.Recipes)
            {
                if (recipe.Station != station) continue;
                any = true;
                bool available = HasCraftIngredients(recipe);
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + recipe.Name + "</b>  → " + RoaItemData.Name(recipe.OutputId) + " x" + recipe.OutputQty, Rich());
                GUILayout.Label("Материалы: " + CraftCostText(recipe) + " · комиссия: " + recipe.Fee + " крышек", Dim());
                GUI.enabled = available && !_craftPending;
                if (GUILayout.Button(_craftPending ? "Станок занят…" : "Создать", GUILayout.Height(30f))) Craft(recipe);
                GUI.enabled = true;
                if (!available) GUILayout.Label("Не хватает материалов или крышек.", Dim());
                GUILayout.EndVertical();
            }

            if (!any) GUILayout.Label("Для этого станка рецепты не найдены.");
        }

        private void DrawJobBoard()
        {
            if (_worldRequestPending && !(_world?["worldTasks"] is JArray))
            {
                GUILayout.Label("Получаем актуальные контракты…");
                return;
            }

            string boardSiteId = _active?["boardSiteId"]?.ToString() ?? _locationId;
            JObject site = WorldSite(boardSiteId);
            string owner = site?["capitalFaction"]?.ToString() ?? site?["owner"]?.ToString() ?? string.Empty;
            string currentFaction = _self?["worldFactionId"]?.ToString() ?? _self?["factionId"]?.ToString() ?? string.Empty;

            if (IsJoinableFaction(owner))
            {
                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + (site?["name"]?.ToString() ?? boardSiteId) + "</b>", Rich());
                GUILayout.Label("Владелец: " + FactionLabel(owner)
                    + (currentFaction == owner ? " · вы состоите во фракции" : string.Empty), Dim());
                GUI.enabled = !_worldRequestPending && currentFaction != owner;
                string factionAction = currentFaction == owner
                    ? "Фракция выбрана"
                    : (IsJoinableFaction(currentFaction) ? "Сменить сторону" : "Вступить во фракцию");
                if (GUILayout.Button(factionAction, GUILayout.Height(30f)))
                    JoinWorldFaction(owner);
                GUI.enabled = true;
                GUILayout.EndVertical();
            }

            GUILayout.Space(8f);
            GUILayout.Label("<b>Контракты пустоши</b>", Rich());
            bool any = false;
            foreach (JObject task in WorldTaskRowsForPlayer())
            {
                if (task == null || !TaskBelongsToBoard(task, boardSiteId)) continue;
                any = true;
                string taskId = task["id"]?.ToString() ?? string.Empty;
                string status = task["status"]?.ToString() ?? "active";
                string type = task["type"]?.ToString() ?? string.Empty;
                bool statusOnly = task["statusOnly"]?.ToObject<bool>() == true
                    || task["actionMode"]?.ToString() == "status_only"
                    || type == "patrol_mission";
                bool accepted = SelfArrayContains("worldTaskAccepted", taskId);
                bool tracked = _self?["worldTaskTrackedId"]?.ToString() == taskId;
                bool claimed = SelfArrayContains("worldTaskRewardClaims", taskId);
                bool rewardEligible = WorldTaskRewardEligible(taskId);

                GUILayout.BeginVertical(GUI.skin.box);
                GUILayout.Label("<b>" + (task["title"]?.ToString() ?? taskId) + "</b>"
                    + (tracked ? "  [отслеживается]" : string.Empty), Rich());
                string text = task["text"]?.ToString();
                if (!string.IsNullOrEmpty(text)) GUILayout.Label(text, Wrap());
                if (statusOnly) GUILayout.Label("Поручение выполняет патруль НПС.", Dim());
                else
                {
                    string rewardText = WorldTaskRewardText(task);
                    if (!string.IsNullOrEmpty(rewardText)) GUILayout.Label(rewardText, Dim());
                }
                int slots = task["joinPartySlotsLeft"]?.ToObject<int>() ?? -1;
                if (slots >= 0) GUILayout.Label("Свободных мест в группе: " + slots, Dim());

                GUI.enabled = !_worldRequestPending;
                GUILayout.BeginHorizontal();
                if (status == "active" && !accepted && !statusOnly && GUILayout.Button("Взять")) WorldTaskAction(task, "accept");
                if (status == "active" && accepted && !statusOnly)
                {
                    if (GUILayout.Button(tracked ? "Снять метку" : "Отслеживать")) WorldTaskAction(task, "track");
                    if (type == "deliver_supplies" && GUILayout.Button("Доставить")) WorldTaskAction(task, "deliver");
                    if (GUILayout.Button("Отменить")) WorldTaskAction(task, "cancel");
                }
                if (status == "completed" && !claimed && rewardEligible && GUILayout.Button("Забрать награду"))
                    WorldTaskAction(task, "claim");
                GUILayout.EndHorizontal();
                GUI.enabled = true;

                if (status == "completed" && claimed) GUILayout.Label("Награда уже получена.", Dim());
                else if (status == "completed" && !rewardEligible) GUILayout.Label("Контракт завершён; участие не подтверждено.", Dim());
                GUILayout.EndVertical();
            }

            if (!any) GUILayout.Label("На этой доске сейчас нет контрактов.");
            GUILayout.Space(6f);
            GUI.enabled = !_worldRequestPending;
            if (GUILayout.Button("Обновить список")) StartCoroutine(LoadWastelandState());
            GUI.enabled = true;
        }

        private void DrawLoot()
        {
            if (_active == null) return;
            bool locked = _active["locked"]?.ToObject<bool>() == true;
            bool terminalLocked = _active["terminalLocked"]?.ToObject<bool>() == true;

            if (_panel == PanelKind.Container && (locked || terminalLocked))
            {
                GUILayout.Label(terminalLocked ? "Доступ защищён терминалом." : "Контейнер заперт.");
                GUILayout.BeginHorizontal();
                if (locked && GUILayout.Button("Взломать замок", GUILayout.Height(34f))) SecurityAction("pickLock");
                if (terminalLocked && GUILayout.Button("Взломать терминал", GUILayout.Height(34f))) SecurityAction("hackTerminal");
                GUILayout.EndHorizontal();
                GUILayout.Space(8f);
            }

            JArray loot = _active["loot"] as JArray;
            if (loot == null || loot.Count == 0)
            {
                GUILayout.Label("Пусто.");
                return;
            }

            foreach (JToken row in loot)
            {
                string id = row["id"]?.ToString();
                int qty = row["qty"]?.ToObject<int>() ?? 0;
                if (string.IsNullOrEmpty(id) || qty <= 0) continue;
                GUILayout.BeginHorizontal();
                GUILayout.Label(RoaItemData.Name(id) + "  x" + qty, GUILayout.ExpandWidth(true));
                GUI.enabled = !locked && !terminalLocked;
                if (GUILayout.Button("взять 1", GUILayout.Width(90f))) Loot(id, false);
                if (qty > 1 && GUILayout.Button("количество", GUILayout.Width(100f)))
                    OpenQuantity(QuantityKind.Loot, id, qty, "Забрать: " + RoaItemData.Name(id));
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }

            GUI.enabled = !locked && !terminalLocked;
            if (GUILayout.Button("Забрать всё", GUILayout.Height(34f))) Loot(string.Empty, true);
            GUI.enabled = true;
        }

        // --- Фасад панели количества (#quantity-side-panel web, 07_quantity_confirm_carry.js) ---

        /// <summary>Канва рисует панель количества; IMGUI-версия молчит.</summary>
        public bool QuantityCanvasDriven { get; set; }
        public bool QuantityOpen { get { return _quantityKind != QuantityKind.None; } }
        public string QuantityTitle { get { return _quantityTitle; } }
        public string QuantitySub { get { return string.IsNullOrEmpty(_quantitySub) ? "Доступно: " + _quantityMax : _quantitySub; } }
        public int QuantityMax { get { return _quantityMax; } }
        public int QuantityValue
        {
            get { return _quantityValue; }
            set { _quantityValue = Mathf.Clamp(value, 1, Mathf.Max(1, _quantityMax)); }
        }
        public void QuantityConfirm() { if (QuantityOpen) SubmitQuantity(); }
        public void QuantityCancel() { CloseQuantity(); }

        private string _quantitySub = string.Empty;

        /// <summary>requestStorageTransfer web: стопка &gt; 1 — выбор количества, иначе сразу перенос.</summary>
        public void StorageRequest(string runtimeId, bool deposit, int available, int carryMax)
        {
            string name = RoaItemData.Name(BaseItemId(runtimeId));
            if (deposit)
            {
                if (available > 1) OpenQuantity(QuantityKind.StorageDeposit, runtimeId, available, name, "Положить в хранилище. Доступно: " + available, available);
                else StorageTransfer(runtimeId, true, 1);
                return;
            }
            if (carryMax <= 0) return;
            if (available > 1)
                OpenQuantity(QuantityKind.StorageWithdraw, runtimeId, carryMax, name,
                    carryMax < available ? "Забрать в рюкзак. В ящике: " + available + ". Можно унести: " + carryMax + "." : "Забрать в рюкзак. Доступно: " + available,
                    carryMax);
            else StorageTransfer(runtimeId, false, 1);
        }

        /// <summary>queueBuy/queueSaleFromInventoryWithAmount web: стопка &gt; 1 — выбор количества.</summary>
        public void TradeRequest(string runtimeId, bool buy, int available, int price)
        {
            string name = RoaItemData.Name(BaseItemId(runtimeId));
            if (available <= 1) { QueueTradeItem(runtimeId, buy, 1); return; }
            if (buy) OpenQuantity(QuantityKind.TradeBuy, runtimeId, available, name, "Добавить в покупку. Осталось у торговца: " + available + ". Цена: " + price + " за 1 шт.", 1);
            else OpenQuantity(QuantityKind.TradeSell, runtimeId, available, name, "Добавить в продажу. Доступно: " + available, available);
        }

        /// <summary>Лут: стопка &gt; 1 — выбор количества с учётом веса.</summary>
        public void LootRequest(string itemId, int available, int carryMax)
        {
            string name = RoaItemData.Name(itemId);
            if (available <= 1 || carryMax <= 0) { Loot(itemId, false, 1); return; }
            OpenQuantity(QuantityKind.Loot, itemId, carryMax, "Забрать: " + name,
                carryMax < available ? "В стаке: " + available + ". Можно унести сейчас: " + carryMax + "." : "В стаке: " + available + ". Можно забрать полностью.",
                carryMax);
        }

        private void OpenQuantity(QuantityKind kind, string itemId, int max, string title, string sub, int value)
        {
            OpenQuantity(kind, itemId, max, title);
            if (_quantityKind == QuantityKind.None) return;
            _quantitySub = sub ?? string.Empty;
            _quantityValue = Mathf.Clamp(value, 1, _quantityMax);
        }

        private void OpenQuantity(QuantityKind kind, string itemId, int max, string title)
        {
            if (kind == QuantityKind.None || string.IsNullOrEmpty(itemId) || max <= 0) return;
            _quantityKind = kind;
            _quantityItemId = itemId;
            _quantityMax = Mathf.Max(1, max);
            _quantityValue = _quantityMax;
            _quantityTitle = title ?? "Количество";
            _quantitySub = string.Empty;
        }

        private void CloseQuantity()
        {
            _quantityKind = QuantityKind.None;
            _quantityItemId = string.Empty;
            _quantityValue = 1;
            _quantityMax = 1;
            _quantityTitle = string.Empty;
        }

        private void SubmitQuantity()
        {
            QuantityKind kind = _quantityKind;
            string itemId = _quantityItemId;
            int qty = Mathf.Clamp(_quantityValue, 1, _quantityMax);
            CloseQuantity();
            if (kind == QuantityKind.TradeBuy) QueueTradeItem(itemId, true, qty);
            else if (kind == QuantityKind.TradeSell) QueueTradeItem(itemId, false, qty);
            else if (kind == QuantityKind.StorageDeposit) StorageTransfer(itemId, true, qty);
            else if (kind == QuantityKind.StorageWithdraw) StorageTransfer(itemId, false, qty);
            else if (kind == QuantityKind.Loot) Loot(itemId, false, qty);
        }

        private void DrawQuantity()
        {
            float width = Mathf.Min(420f, Screen.width - 24f);
            float height = 210f;
            Rect area = new Rect((Screen.width - width) * 0.5f, (Screen.height - height) * 0.5f,
                                 width, height);
            GUILayout.BeginArea(area, GUI.skin.window);
            GUILayout.Label("<b>" + _quantityTitle + "</b>", Rich());
            GUILayout.Label("Доступно: " + _quantityMax + " · выбрано: " + _quantityValue);
            _quantityValue = Mathf.Clamp(Mathf.RoundToInt(GUILayout.HorizontalSlider(
                _quantityValue, 1f, _quantityMax, GUILayout.Height(28f))), 1, _quantityMax);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("−")) _quantityValue = Mathf.Max(1, _quantityValue - 1);
            if (GUILayout.Button("Половина")) _quantityValue = Mathf.Max(1, Mathf.CeilToInt(_quantityMax * 0.5f));
            if (GUILayout.Button("Всё")) _quantityValue = _quantityMax;
            if (GUILayout.Button("+")) _quantityValue = Mathf.Min(_quantityMax, _quantityValue + 1);
            GUILayout.EndHorizontal();
            GUILayout.FlexibleSpace();
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("Отмена", GUILayout.Height(34f))) CloseQuantity();
            if (GUILayout.Button("Подтвердить", GUILayout.Height(34f))) SubmitQuantity();
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        private string PanelTitle()
        {
            string name = _active?["name"]?.ToString() ?? "Взаимодействие";
            if (_panel == PanelKind.Trade) return "Торговля: " + name;
            if (_panel == PanelKind.MachineTrade) return name;
            if (_panel == PanelKind.Storage) return "Хранилище: " + name;
            if (_panel == PanelKind.Crafting) return "Крафт: " + name;
            if (_panel == PanelKind.JobBoard) return name;
            if (_panel == PanelKind.Corpse) return "Обыск: " + name;
            if (_panel == PanelKind.Container) return "Контейнер: " + name;
            return name;
        }

        private string QuestState(string id)
        {
            return _self?["npcQuests"]?[id]?.ToString()
                ?? _quests?[id]?["initialState"]?.ToString()
                ?? "available";
        }

        private static string QuestStateLabel(string state)
        {
            if (state == "active") return "в работе";
            if (state == "ready") return "готово к сдаче";
            if (state == "done") return "выполнено";
            if (state == "locked") return "закрыто";
            return "доступно";
        }

        private static bool NpcHasTrade(JObject actor)
        {
            if (actor == null) return false;
            return actor["personalTrade"]?.ToObject<bool>() == true
                || !string.IsNullOrEmpty(actor["traderId"]?.ToString())
                || !string.IsNullOrEmpty(actor["traderProfile"]?.ToString())
                || (actor["traderStock"] as JArray)?.Count > 0;
        }

        private static TargetKind StaticTargetKind(LocationObject entry)
        {
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            string kind = (entry.Interactive?["kind"]?.ToString() ?? string.Empty).ToLowerInvariant();
            string role = (entry.Interactive?["role"]?.ToString() ?? string.Empty).ToLowerInvariant();
            string containerType = (entry.Interactive?["containerType"]?.ToString() ?? string.Empty).ToLowerInvariant();

            if (kind == "jobboard" || role == "worldtaskboard"
                || HasTag(entry, "jobBoard") || HasTag(entry, "questBoard"))
                return TargetKind.JobBoard;

            if (!string.IsNullOrEmpty(CraftingStationId(entry))
                || kind == "craftingstation" || HasTag(entry, "crafting-station"))
                return TargetKind.CraftingStation;

            bool tradeMachine = model == "trademachine"
                || kind == "trademachine" || kind == "vendingmachine"
                || role == "trademachine" || HasTag(entry, "tradeMachine")
                || HasTag(entry, "vendingMachine");
            if (tradeMachine) return TargetKind.TradeMachine;

            bool storage = role == "storage" || containerType == "storage"
                || HasTag(entry, "personal-storage") || HasTag(entry, "capital-storage");
            return storage ? TargetKind.Storage : TargetKind.None;
        }

        // Возвращает КАНОНИЧЕСКИЙ id станка (energy_bench, chem_station…), а не
        // сырой токен: авторские объекты помечают станки серверными синонимами
        // («electronics», «relay», «armory», «lab»), и именно канонический id
        // сравнивается с recipe.Station. Сырой синоним ломал бы это сравнение.
        private static string CraftingStationId(LocationObject entry)
        {
            if (entry == null) return string.Empty;
            string station;
            if (entry.CraftingStations != null)
                foreach (string value in entry.CraftingStations)
                    if (!string.IsNullOrEmpty(station = RoaCraftingData.CanonicalStation(value))) return station;

            string[] fields = { "craftingStation", "station", "stationType", "stationId" };
            foreach (JObject source in new[] { entry.Interactive, entry.Entity })
            {
                if (source == null) continue;
                foreach (string field in fields)
                    if (!string.IsNullOrEmpty(station = RoaCraftingData.CanonicalStation(source[field]?.ToString())))
                        return station;
                foreach (JToken value in source["craftingStations"] as JArray ?? new JArray())
                    if (!string.IsNullOrEmpty(station = RoaCraftingData.CanonicalStation(value?.ToString())))
                        return station;
            }

            if (entry.Tags != null)
                foreach (string value in entry.Tags)
                    if (!string.IsNullOrEmpty(station = RoaCraftingData.CanonicalStation(value))) return station;
            return string.Empty;
        }

        private static bool IsCraftingStation(string value)
        {
            return !string.IsNullOrEmpty(RoaCraftingData.CanonicalStation(value));
        }

        private static bool IsResourceObject(LocationObject entry)
        {
            if (entry == null) return false;
            if (!string.IsNullOrEmpty(entry.ResourceType) || !string.IsNullOrEmpty(entry.Resource)) return true;
            if (string.Equals(entry.Collision, "resource", StringComparison.OrdinalIgnoreCase)) return true;
            return HasTag(entry, "resource") || HasTag(entry, "harvestable") || HasTag(entry, "resource-node");
        }

        private static string DefaultStaticName(TargetKind kind, string station)
        {
            if (kind == TargetKind.Storage) return "Хранилище";
            if (kind == TargetKind.CraftingStation) return RoaCraftingData.StationLabel(station);
            if (kind == TargetKind.JobBoard) return "Доска контрактов";
            return "Торговый автомат";
        }

        private bool HasCraftIngredients(RoaCraftRecipe recipe)
        {
            if (recipe == null) return false;
            foreach (KeyValuePair<string, int> cost in recipe.Cost)
                if (InventoryQty(cost.Key) < cost.Value) return false;
            return InventoryQty("silver") >= recipe.Fee;
        }

        private int InventoryQty(string itemId)
        {
            int total = 0;
            foreach (JToken row in _self?["inventory"] as JArray ?? new JArray())
                if (BaseItemId(row?["id"]?.ToString()) == itemId)
                    total += row?["qty"]?.ToObject<int>() ?? 0;
            return total;
        }

        private static string CraftCostText(RoaCraftRecipe recipe)
        {
            var rows = new List<string>();
            foreach (KeyValuePair<string, int> cost in recipe.Cost)
                rows.Add(RoaItemData.Name(cost.Key) + " x" + cost.Value);
            return string.Join(", ", rows);
        }

        private static string CraftingError(JObject ack)
        {
            string error = ack?["error"]?.ToString() ?? "Сервер отклонил заказ.";
            if (error == "unknown_recipe") return "Сервер не знает этот рецепт.";
            if (error == "wrong_station" || error == "missing_station") return "Для рецепта нужен другой станок.";
            if (error == "too_far_from_station") return "Подойдите ближе к станку.";
            if (error == "missing_site") return "Мастерская не связана с действующим поселением.";
            if (error == "fee_too_low") return "Комиссия станка изменилась; обновите клиент.";
            return error;
        }

        private static string ResourceLabel(string type)
        {
            if (type == "ore") return "Руда";
            if (type == "wood") return "Древесина";
            if (type == "scrap") return "Металлолом";
            if (type == "water") return "Вода";
            if (type == "oil") return "Нефть";
            if (type == "chemicals") return "Химикаты";
            if (type == "medicine") return "Лекарственные растения";
            if (type == "food") return "Пищевые растения";
            if (type == "electronics") return "Электроника";
            if (type == "ammoParts") return "Детали боеприпасов";
            if (type == "weaponParts") return "Оружейные детали";
            return "Ресурс";
        }

        private static Color ResourceColor(string type)
        {
            if (type == "wood" || type == "food" || type == "medicine") return new Color(0.35f, 0.55f, 0.24f);
            if (type == "water") return new Color(0.20f, 0.48f, 0.68f);
            if (type == "oil") return new Color(0.16f, 0.14f, 0.12f);
            if (type == "chemicals") return new Color(0.45f, 0.72f, 0.30f);
            if (type == "electronics") return new Color(0.25f, 0.65f, 0.62f);
            return new Color(0.56f, 0.48f, 0.34f);
        }

        private JObject WorldSite(string siteId)
        {
            foreach (JToken token in _world?["sites"] as JArray ?? new JArray())
            {
                JObject site = token as JObject;
                if (site?["id"]?.ToString() == siteId) return site;
            }
            return null;
        }

        private static bool TaskBelongsToBoard(JObject task, string siteId)
        {
            if (task == null || string.IsNullOrEmpty(siteId)) return false;
            string issuer = task["issuerSiteId"]?.ToString();
            string site = task["siteId"]?.ToString();
            return issuer == siteId || (string.IsNullOrEmpty(issuer) && site == siteId);
        }

        private bool SelfArrayContains(string field, string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            foreach (JToken token in _self?[field] as JArray ?? new JArray())
                if (token?.ToString() == id) return true;
            return false;
        }

        private bool WorldTaskRewardEligible(string taskId)
        {
            foreach (JToken token in _self?["worldTaskRecords"] as JArray ?? new JArray())
            {
                if (token?["id"]?.ToString() != taskId) continue;
                return token?["rewardEligible"]?.ToObject<bool>() == true;
            }
            return false;
        }

        private static bool IsJoinableFaction(string factionId)
        {
            return RoaPipboy.IsJoinableFaction(factionId);
        }

        private static string FactionLabel(string factionId)
        {
            if (factionId == "old_klim") return "Старый Клим";
            if (factionId == "scrap_union") return "Свалочный союз";
            if (factionId == "relay_order") return "Орден Ретранслятора";
            if (factionId == "caravans") return "Вольные караваны";
            return string.IsNullOrEmpty(factionId) ? "нет" : factionId;
        }

        private static bool HasTag(LocationObject entry, string tag)
        {
            if (entry?.Tags == null) return false;
            foreach (string value in entry.Tags)
                if (string.Equals(value, tag, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private void Show(string message, float seconds = 5f)
        {
            _status = message ?? string.Empty;
            _statusUntil = Time.unscaledTime + seconds;
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        private static float Value(JObject row, string key)
        {
            return row?[key]?.ToObject<float>() ?? 0f;
        }

        private static GUIStyle Rich()
        {
            var style = new GUIStyle(GUI.skin.label);
            style.richText = true;
            return style;
        }

        private static GUIStyle Wrap()
        {
            var style = new GUIStyle(GUI.skin.label);
            style.wordWrap = true;
            return style;
        }

        private static GUIStyle Center()
        {
            var style = Wrap();
            style.alignment = TextAnchor.MiddleCenter;
            return style;
        }

        private static GUIStyle Dim()
        {
            var style = Wrap();
            style.normal.textColor = new Color(0.7f, 0.72f, 0.7f);
            return style;
        }
    }
}
