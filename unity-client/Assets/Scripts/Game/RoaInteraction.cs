using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
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
        public RoaCaravanDepartureCinematic CaravanDepartureCinematic;
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

        private enum TargetKind { None, LabNode, Actor, Container, Storage, Resource, CraftingStation, JobBoard, QuestObject, Transition, PlotBoard }
        private enum PanelKind { None, Npc, Trade, Storage, Corpse, Container, Crafting, JobBoard }
        private enum QuantityKind { None, TradeBuy, TradeSell, StorageDeposit, StorageWithdraw, Loot }

        private sealed class ContainerView
        {
            public JObject Data;
            public GameObject Root;
            public GameObject Placeholder;
            public RoaVisibilityGate Gate;
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

        private readonly Dictionary<string, ContainerView> _containers =
            new Dictionary<string, ContainerView>();
        private readonly Dictionary<string, ResourceView> _resources =
            new Dictionary<string, ResourceView>();
        private readonly HashSet<string> _authoredResourceIds = new HashSet<string>();
        private readonly List<StaticTarget> _staticTargets = new List<StaticTarget>();
        // Порталы зоны из последнего состояния мира: к какой локации они относятся и их подпись.
        private JArray _portalRows;
        private string _portalLocationId = string.Empty;
        private string _portalSignature = string.Empty;
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
        private bool _plotPending;
        private float _plotRefreshAt;
        // null — поле ещё не заполнено значением по умолчанию; пустую строку
        // игрок стёр сам, и её не нужно тут же заполнять заново.
        private bool _harvestPending;
        private bool _robPending;
        private bool _worldRequestPending;
        private bool _tradePending;
        private bool _transitionPending;

        /// <summary>Окно подтверждения перехода со сменой правил зоны.</summary>
        private const float ZoneWarningWindowSeconds = 6f;
        private string _zoneWarningTarget = string.Empty;
        private float _zoneWarningUntil;
        private string _acknowledgedZoneMode = string.Empty;
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

        /// <summary>Канва рисует окно станка сама; IMGUI-вариант молчит.</summary>
        public bool CraftingCanvasDriven { get; set; }

        // --- Фасад для канва-окна станка (RoaCraftingCanvas). ---

        public bool CraftingOpen { get { return _panel == PanelKind.Crafting; } }
        public string CraftingTitle { get { return PanelTitle(); } }
        public string CraftingStatus { get { return Time.unscaledTime <= _statusUntil ? _status : string.Empty; } }
        /// <summary>Канонический id открытого станка: по нему отбираются рецепты.</summary>
        public string CraftingStation { get { return _active?["station"]?.ToString() ?? string.Empty; } }
        /// <summary>Участок поселения под открытым станком; null — станок без участка.</summary>
        public JObject CraftingPlot { get { return RoaCraftingPlots.ForObject(_active?["id"]?.ToString()); } }
        /// <summary>Снимок счёта игрока (self.account): премиум и запас фокуса.</summary>
        public JObject CraftingAccount { get { return _self?["account"] as JObject; } }
        public bool CraftPending { get { return _craftPending; } }
        public bool PlotPending { get { return _plotPending; } }

        public bool CanCraft(RoaCraftRecipe recipe) { return HasCraftIngredients(recipe) && ProfessionAllows(recipe); }

        /// <summary>Тир рецепта открыт уровнем профессии (решает сервер, клиент не шлёт заведомый отказ).</summary>
        public bool ProfessionAllows(RoaCraftRecipe recipe) { return RoaCraftingData.ProfessionAllows(_self, recipe); }

        /// <summary>Уровень профессии из авторитетного состояния игрока (self.professions).</summary>
        public int ProfessionLevel(string professionId) { return RoaCraftingData.ProfessionLevel(_self, professionId); }

        public string ProfessionName(string professionId)
        {
            JObject row = ProfessionRow(professionId);
            return row?["name"]?.ToString() ?? professionId;
        }

        /// <summary>Профессии игрока: добыча, переработка и ремёсла с уровнем и открытым тиром.</summary>
        public JArray Professions { get { return _self?["professions"] as JArray ?? new JArray(); } }

        private JObject ProfessionRow(string professionId)
        {
            foreach (JToken token in Professions)
                if (token is JObject row && row["id"]?.ToString() == professionId) return row;
            return null;
        }
        public static string CraftCost(RoaCraftRecipe recipe) { return recipe == null ? string.Empty : CraftCostText(recipe); }
        public void CraftRecipe(RoaCraftRecipe recipe) { Craft(recipe); }
        public void CraftingClose() { ClosePanel(true); }

        public void PlotBid(int amount)
        {
            PlotAction("bid", CraftingPlot, new Dictionary<string, object> { ["amount"] = amount });
        }

        /// <summary>Плата арендатора за чужие заказы, в целых процентах стоимости изделия.</summary>
        public void PlotSetFee(int percent)
        {
            PlotAction("setFee", CraftingPlot, new Dictionary<string, object> { ["feePct"] = percent / 100d });
        }

        // --- Публичные точки для канва-окна бартера (RoaBarterCanvas). ---
        // Вся торговая логика и серверные запросы остаются здесь; канва
        // это только другой способ их нарисовать.

        /// <summary>Канва рисует торговлю сама; IMGUI-вариант этих панелей молчит.</summary>
        public bool TradeCanvasDriven { get; set; }

        public bool TradeOpen { get { return _panel == PanelKind.Trade; } }
        public bool TradePending { get { return _tradePending; } }
        public JObject TradeMarket { get { return _market; } }
        public JObject TradeSelf { get { return _self; } }
        public string TradeStatus { get { return Time.unscaledTime <= _statusUntil ? _status : string.Empty; } }

        public string TradeActorName
        {
            get { return _active?["name"]?.ToString() ?? "Торговец"; }
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
                else if (_candidateKind == TargetKind.PlotBoard) action = "торги за участок";
                else if (_candidateKind == TargetKind.QuestObject) action = "исследовать";
                else if (_candidateKind == TargetKind.Transition) action = "перейти";
                else if (_candidateKind == TargetKind.Storage) action = "открыть хранилище";
                else if (_candidateKind == TargetKind.Container) action = "открыть";
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
                JObject onboardingStep = ActiveOnboardingStepForNpc();
                string onboardingDialogue = onboardingStep?["dialogue"]?.ToString();
                if (!string.IsNullOrEmpty(onboardingDialogue)) return onboardingDialogue;

                string kromkaQuest = KromkaQuestDialogueLine();
                if (!string.IsNullOrEmpty(kromkaQuest)) return kromkaQuest;

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
                if (state == "available") return "Грач-Жестянщик стучит пальцем по мятым чертежам: \"Нужны детали для пресса. Принесёшь сырьё и ремкомплект — расплачусь марками и патронами.\"";
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
            if (supplies == "available") return "Дежурный снабженец Управы смотрит поверх прилавка: \"Если ищешь работу, Ключам нужны припасы. Платить буду честно, но без роскоши.\"";
            if (supplies == "active") return HasQuestItems(("ore", 3), ("wood", 3), ("water", 1))
                ? "\"Вижу, рюкзак потяжелел. Принёс всё, о чём я просил?\""
                : "\"Руда, древесина и вода. Без этого люди здесь долго не протянут.\"";
            string terminal = QuestState("klimTerminal");
            if (terminal == "available") return "\"Есть ещё дело. В Полосе №8 уцелел служебный терминал. Кто вскроет его аккуратно, тот принесёт мне данные.\"";
            if (terminal == "active") return "\"Терминал ждёт в Полосе №8. Не ломай его кулаками — ему нужна голова.\"";
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
        /// <summary>Сервис NPC постоянной базы: medic, registrar, auction, artifactLab, trade.</summary>
        public string NpcService { get { return _active?["service"]?.ToString() ?? string.Empty; } }
        public string NpcTerritoryFactionId { get { return _active?["territoryFactionId"]?.ToString() ?? string.Empty; } }
        public string NpcId { get { return _active?["id"]?.ToString() ?? string.Empty; } }
        public bool NpcCanRob { get { return _active != null && CanRobEncounterActor(_active); } }

        public sealed class DialogueChoice
        {
            public string Id;
            public string Label;
        }

        public sealed class OnboardingDialogueCard
        {
            public string Title;
            public string Description;
            public readonly List<DialogueChoice> Choices = new List<DialogueChoice>();
        }

        public OnboardingDialogueCard NpcOnboarding()
        {
            JObject step = ActiveOnboardingStepForNpc();
            if (step == null) return null;
            var card = new OnboardingDialogueCard
            {
                Title = step["title"]?.ToString() ?? "Текущий этап",
                Description = step["instruction"]?.ToString() ?? string.Empty
            };
            bool ready = step["ready"]?.Value<bool?>() != false;
            string hintField = RoaGameBootstrap.Active?.Combat?.MobileInputMode == true ? "mobileHint" : "hint";
            card.Description += "\n\n" + (step[hintField]?.ToString() ?? string.Empty);
            if (!ready)
            {
                card.Choices.Add(new DialogueChoice { Id = "__practice", Label = "ПОНЯТНО, ПРИСТУПАЮ" });
                return card;
            }
            foreach (JObject choice in step["choices"] as JArray ?? new JArray())
            {
                string id = choice?["id"]?.ToString() ?? string.Empty;
                string label = choice?["label"]?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(label))
                    card.Choices.Add(new DialogueChoice { Id = id, Label = label });
            }
            if (card.Choices.Count == 0)
            {
                string label = step["button"]?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(label))
                    card.Choices.Add(new DialogueChoice { Id = string.Empty, Label = label });
            }
            return card;
        }

        public void NpcOnboardingAction(string choiceId)
        {
            if (choiceId == "__practice") { ClosePanel(false); return; }
            JObject step = ActiveOnboardingStepForNpc();
            string actorId = _active?["id"]?.ToString() ?? string.Empty;
            string action = step?["action"]?.ToString() ?? string.Empty;
            if (Socket == null || string.IsNullOrEmpty(actorId) || string.IsNullOrEmpty(action)) return;
            string cinematicId = step?["cinematicId"]?.ToString() ?? string.Empty;
            if (action == "depart_caravan" && CaravanDepartureCinematic != null
                && CaravanDepartureCinematic.TryPlayDeparture(cinematicId,
                    () => SubmitNpcOnboardingAction(actorId, action, choiceId)))
            {
                ClosePanel(false);
                return;
            }
            SubmitNpcOnboardingAction(actorId, action, choiceId);
        }

        private void SubmitNpcOnboardingAction(string actorId, string action, string choiceId)
        {
            Socket.EmitWithAck("kromkaOnboardingAction", new Dictionary<string, object>
            {
                ["enemyId"] = actorId,
                ["action"] = action,
                ["choiceId"] = choiceId ?? string.Empty
            }, ack =>
            {
                if (action == "depart_caravan")
                    CaravanDepartureCinematic?.NotifyDepartureResult(ack);
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                if (ok && ack?["onboarding"] is JObject onboarding && _self != null)
                    _self["kromkaOnboarding"] = onboarding.DeepClone();
                Show(ok ? "Этап подтверждён в диалоге."
                    : (ack?["error"]?.ToString() ?? "Сервер отклонил действие обучения."));
                if (ok && ack?["transition"] != null) ClosePanel(false);
            });
        }

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

        public sealed class KromkaQuestOption
        {
            public string Id;
            public string Name;
            public string State;
            public string StateLabel;
            public string Description;
            public string Dialogue;
            public bool CanAdvanceDialogue;
            public readonly List<DialogueChoice> Outcomes = new List<DialogueChoice>();
        }

        private string KromkaQuestDialogueLine()
        {
            KromkaQuestOption selected = null;
            int selectedPriority = int.MaxValue;
            foreach (KromkaQuestOption quest in NpcKromkaQuests())
            {
                int priority = quest.State == "choice" ? 0
                    : quest.State == "turnin" ? 1
                    : quest.State == "active" ? 2
                    : quest.State == "available" ? 3
                    : quest.State == "locked" ? 4 : 5;
                if (string.IsNullOrEmpty(quest.Dialogue) || priority >= selectedPriority) continue;
                selected = quest;
                selectedPriority = priority;
            }
            return selected?.Dialogue ?? string.Empty;
        }

        private bool CurrentActorMatchesQuestDialogueTarget(JObject quest)
        {
            string activeNpcId = _active?["kromkaNamedNpcId"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(activeNpcId)) return false;
            foreach (JToken targetNpc in quest?["currentObjectiveNpcIds"] as JArray ?? new JArray())
                if (targetNpc?.ToString() == activeNpcId) return true;
            return false;
        }

        public List<KromkaQuestOption> NpcKromkaQuests()
        {
            var rows = new List<KromkaQuestOption>();
            foreach (JToken token in _active?["kromkaQuestIds"] as JArray ?? new JArray())
            {
                string id = token?.ToString() ?? string.Empty;
                JObject quest = KromkaQuestJournalRow(id);
                if (string.IsNullOrEmpty(id) || quest == null) continue;
                string state = quest["status"]?.ToString() ?? "available";
                string description = quest["summary"]?.ToString() ?? string.Empty;
                string dialogue = quest["dialogue"]?.ToString() ?? string.Empty;
                string objective = quest["currentObjectiveLabel"]?.ToString() ?? string.Empty;
                string objectiveHint = quest["currentObjectiveHint"]?.ToString() ?? string.Empty;
                int current = quest["objectiveProgressCurrent"]?.ToObject<int>() ?? 0;
                int target = quest["objectiveProgressTarget"]?.ToObject<int>() ?? 0;
                if (!string.IsNullOrEmpty(objective))
                {
                    if (target > 1) objective += " (" + current + "/" + target + ")";
                    description += (string.IsNullOrEmpty(description) ? string.Empty : "\n") + "Цель: " + objective;
                }
                if (state == "active" && !string.IsNullOrEmpty(objectiveHint))
                    description += (string.IsNullOrEmpty(description) ? string.Empty : "\n") + objectiveHint;
                if (state == "active")
                    description += (string.IsNullOrEmpty(description) ? string.Empty : "\n")
                        + "Продолжайте выполнять цель в игровом мире.";
                if (state == "turnin")
                    description += (string.IsNullOrEmpty(description) ? string.Empty : "\n")
                        + "Все цели выполнены. Сдайте дело заказчику.";
                if (!string.IsNullOrEmpty(dialogue))
                    description = "«" + dialogue + "»"
                        + (string.IsNullOrEmpty(description) ? string.Empty : "\n\n" + description);
                bool canAdvanceDialogue = state == "active"
                    && quest["currentObjectiveInteraction"]?.ToString() == "dialogue"
                    && CurrentActorMatchesQuestDialogueTarget(quest);
                var option = new KromkaQuestOption
                {
                    Id = id,
                    Name = quest["title"]?.ToString() ?? id,
                    State = state,
                    StateLabel = QuestStateLabel(state == "completed" ? "done" : state),
                    Description = description,
                    Dialogue = dialogue,
                    CanAdvanceDialogue = canAdvanceDialogue
                };
                foreach (JObject outcome in quest["outcomes"] as JArray ?? new JArray())
                {
                    string outcomeId = outcome?["id"]?.ToString() ?? string.Empty;
                    string label = outcome?["label"]?.ToString() ?? string.Empty;
                    if (!string.IsNullOrEmpty(outcomeId) && !string.IsNullOrEmpty(label))
                        option.Outcomes.Add(new DialogueChoice { Id = outcomeId, Label = label });
                }
                rows.Add(option);
            }
            return rows;
        }

        public void NpcKromkaQuestAction(string questId, string mode, string outcomeId = "")
        {
            SubmitKromkaQuest(questId, mode, outcomeId);
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
            if (silver > 0) parts.Add(RoaPlural.Marks(silver));
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
            return new JobBoardSiteInfo
            {
                Name = site?["name"]?.ToString() ?? boardSiteId,
                Owner = RoaPipboy.CanonicalFactionId(owner),
                OwnerLabel = FactionLabel(owner),
                Joinable = false,
                IsMember = false,
                JoinLabel = string.Empty
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
        /// <summary>Быстрый вход с доски: сервер подбирает ближайшую короткую вылазку и отмечает маршрут.</summary>
        public void JobBoardQuickActivity()
        {
            SubmitQuickWorldActivity(_active?["boardSiteId"]?.ToString() ?? _locationId, _ => JobBoardRefresh());
        }

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
                card.Title = RoaPipboy.KromkaPublicText(task["title"]?.ToString() ?? "Контракт пустоши");

                float expires = task["expiresHour"]?.ToObject<float>() ?? worldHour;
                int hoursLeft = status == "active" ? Mathf.Max(0, Mathf.CeilToInt(expires - worldHour)) : 0;
                string text = RoaPipboy.KromkaPublicText(task["text"]?.ToString() ?? string.Empty);
                if (status == "active" && hoursLeft > 0) text = (text + " Осталось около " + hoursLeft + " ч.").Trim();
                card.Text = text;

                // pipboyWorldTaskRouteText
                string issuer = RoaPipboy.KromkaPublicText(task["issuerSiteName"]?.ToString() ?? string.Empty);
                string target = RoaPipboy.KromkaPublicText(task["targetSiteName"]?.ToString() ?? task["siteName"]?.ToString() ?? string.Empty);
                string party = RoaPipboy.KromkaPublicText(task["targetPartyName"]?.ToString() ?? task["joinPartyName"]?.ToString() ?? string.Empty);
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

                string joinName = RoaPipboy.KromkaPublicText(task["joinPartyName"]?.ToString());
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
                        int reputation = _self?["worldFactionReputation"]?[factionId]?.ToObject<int>() ?? 0;
                        if (requires && !string.IsNullOrEmpty(factionId) && reputation < -25)
                        {
                            accessOk = false;
                            accessText = "Заказчик отказал: репутация у стороны «" + FactionLabel(factionId) + "» слишком низкая.";
                        }
                        else if (!string.IsNullOrEmpty(factionId))
                            accessText = "При принятии будет выдан временный контракт стороны «" + FactionLabel(factionId) + "».";
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
            if (RoaPipboy.IsKnownFaction(explicitId)) return RoaPipboy.CanonicalFactionId(explicitId);
            JObject site = boardSite ?? WorldSite(task["siteId"]?.ToString() ?? string.Empty);
            string owner = (site?["owner"]?.ToString() ?? string.Empty).ToLowerInvariant();
            return RoaPipboy.IsKnownFaction(owner) ? RoaPipboy.CanonicalFactionId(owner) : string.Empty;
        }

        private string WorldTaskReputationFactionId(JObject task)
        {
            if (task == null) return string.Empty;
            string explicitId = (task["reward"]?["reputationFactionId"]?.ToString()
                ?? task["details"]?["rewardFactionId"]?.ToString()
                ?? task["reputationFactionId"]?.ToString()
                ?? string.Empty).ToLowerInvariant();
            if (!string.IsNullOrEmpty(explicitId)) return RoaPipboy.IsKnownFaction(explicitId) ? RoaPipboy.CanonicalFactionId(explicitId) : string.Empty;
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
            if (caps > 0) parts.Add(RoaPlural.Marks(caps));
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

        /// <summary>Снимок открытого контейнера: в нём лежат и правила защиты.</summary>
        public JObject LootSecurityState { get { return _active; } }

        /// <summary>
        /// Строка запертого контейнера: сложность, нужный навык и остаток
        /// заминки после неудачи. Сервер шлёт всё это в снимке контейнера, но
        /// раньше игрок узнавал сложность только из отказа после нажатия, а
        /// длину заминки — никогда.
        /// </summary>
        public static string SecurityLine(JObject container, bool terminal, long nowMs)
        {
            if (container == null) return string.Empty;
            string label = (terminal ? container["terminalDifficultyLabel"] : container["lockDifficultyLabel"])?.ToString() ?? string.Empty;
            int required = (terminal ? container["terminalRequiredSkill"] : container["lockRequiredSkill"])?.ToObject<int>() ?? 0;
            long until = (terminal ? container["terminalCooldownUntil"] : container["lockCooldownUntil"])?.ToObject<long>() ?? 0L;
            string name = terminal ? container["terminalName"]?.ToString() ?? string.Empty : string.Empty;
            var sb = new StringBuilder(terminal
                ? (string.IsNullOrWhiteSpace(name) ? "Доступ защищён терминалом." : "Доступ защищён терминалом «" + name + "».")
                : "Контейнер заперт.");
            if (!string.IsNullOrWhiteSpace(label))
            {
                sb.Append(terminal ? " Терминал: " : " Замок: ").Append(label);
                if (required > 0) sb.Append(terminal ? ", нужна Наука " : ", нужен Взлом ").Append(required).Append('%');
                sb.Append('.');
            }
            if (terminal && container["terminalUnlocksLock"]?.ToObject<bool>() == true) sb.Append(" Взлом терминала снимет и замок.");
            int wait = until > nowMs ? (int)((until - nowMs + 999L) / 1000L) : 0;
            if (wait > 0) sb.Append(" Ещё ").Append(wait).Append(" с до новой попытки.");
            return sb.ToString();
        }
        public JArray LootRows { get { return _active?["loot"] as JArray; } }

        /// <summary>Записи экземпляров в открытом контейнере или трупе, если сервер их прислал.</summary>
        public JArray LootRuntimeRecords { get { return _active?["itemRuntimeRecords"] as JArray; } }
        public JArray StorageRows { get { return _self?["storage"] as JArray; } }
        public JArray InventoryRows { get { return _self?["inventory"] as JArray; } }

        /// <summary>Записи экземпляров на складе фракции и в рюкзаке: в них лежит состояние артефакта.</summary>
        public JArray StorageRuntimeRecords { get { return _self?["storageWeaponRuntime"] as JArray; } }
        public JArray InventoryRuntimeRecords { get { return _self?["weaponInventoryRuntime"] as JArray; } }

        /// <summary>Запись артефакта для строки списка: ищется по runtime-id предмета.</summary>
        public static JObject ArtifactForRuntimeId(JArray records, string runtimeId)
        {
            if (records == null || string.IsNullOrEmpty(runtimeId)) return null;
            foreach (JToken token in records)
            {
                JObject row = token as JObject;
                if (row == null || row["id"]?.ToString() != runtimeId) continue;
                return row["artifact"] as JObject;
            }
            return null;
        }
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
            // Новое место: игрок появляется у входа, а не в проёме, из которого пришёл.
            _autoGateInside = string.Empty;
            _autoGateRetryAt = 0f;
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
                string questObjective = kind == TargetKind.QuestObject
                    ? (entry.Interactive?["questObjective"]?.ToString() ?? string.Empty)
                    : string.Empty;
                // Табличка участка знает, за какой участок торгуются: без этого
                // окно торгов не открыть.
                string plotId = kind == TargetKind.PlotBoard
                    ? (entry.Interactive?["plotId"]?.ToString() ?? string.Empty)
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
                        ["questObjective"] = questObjective,
                        ["plotId"] = plotId,
                        ["locationId"] = _locationId
                    }
                });
            }

            var transitionIds = new HashSet<string>();
            AddTransitionTarget(location.Exit, transitionIds);
            if (location.Transitions != null)
                foreach (LocationTransition transition in location.Transitions)
                    AddTransitionTarget(transition, transitionIds);
            // Состояние мира могло прийти раньше самой локации.
            RebuildPortalTargets();

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
                    ["type"] = transition.Type ?? string.Empty,
                    ["auto"] = transition.Auto,
                    ["to"] = transition.To,
                    ["entryKey"] = transition.EntryKey ?? string.Empty,
                    ["locationId"] = _locationId,
                    ["targetPvpMode"] = transition.TargetPvpMode ?? string.Empty,
                    ["targetZoneRules"] = transition.TargetZoneRules != null
                        ? (JToken)transition.TargetZoneRules.DeepClone()
                        : JValue.CreateNull()
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
            RoaCraftingPlots.Clear();
            if (ack == null) return;
            HandleSelf(ack.Self);
            HandleWorldState(ack.WorldState);
            RequestPlotState();
        }

        /// <summary>
        /// Снимок участков станков текущей локации: по нему окно станка и
        /// Пип-Бой считают комиссию, сервер заодно зачисляет выплаты участков.
        /// </summary>
        private void RequestPlotState()
        {
            if (Socket == null) return;
            _plotRefreshAt = Time.unscaledTime + PlotRefreshSeconds;
            Socket.EmitWithAck("craftingPlotAction", new Dictionary<string, object>
            {
                ["action"] = "state"
            }, ApplyPlotAck);
        }

        private void ApplyPlotAck(JObject ack)
        {
            if (ack?["ok"]?.ToObject<bool>() != true) return;
            ApplyActionAck(ack);
            RoaCraftingPlots.Apply(ack);
            if (RoaCraftingPlots.LastPayout > 0)
                Show("Участки: зачислено " + RoaPlural.Marks(RoaCraftingPlots.LastPayout) + ".", 4f);
        }

        // --- табличка участка: торги и постройка станка --------------------------------------
        private string _plotBoardId = string.Empty;

        /// <summary>Открыта ли табличка участка: по ней рисуется окно торгов.</summary>
        public bool PlotBoardOpen { get { return !string.IsNullOrEmpty(_plotBoardId); } }

        /// <summary>Участок таблички со стороны сервера (или null, пока снимок не пришёл).</summary>
        public JObject PlotBoardPlot { get { return PlotBoardOpen ? RoaCraftingPlots.ForObject(_plotBoardId) : null; } }

        /// <summary>Идёт ли запрос к серверу: пока идёт, кнопки окна заблокированы.</summary>
        public bool PlotBoardBusy { get { return _plotPending; } }

        private void OpenPlotBoard(JObject entry)
        {
            string plotId = entry?["interactive"]?["plotId"]?.ToString();
            if (string.IsNullOrEmpty(plotId)) plotId = entry?["plotId"]?.ToString();
            if (string.IsNullOrEmpty(plotId)) { Show("Табличка ничего не говорит об участке.", 4f); return; }
            _plotBoardId = plotId;
            RequestPlotState();
        }

        public void PlotBoardClose() { _plotBoardId = string.Empty; }

        public void PlotBoardBid(int amount)
        {
            JObject plot = PlotBoardPlot;
            if (plot == null) return;
            PlotAction("bid", plot, new Dictionary<string, object> { ["amount"] = Mathf.Max(0, amount) });
        }

        public void PlotBoardBuild(string station)
        {
            JObject plot = PlotBoardPlot;
            if (plot == null || string.IsNullOrEmpty(station)) return;
            PlotAction("build", plot, new Dictionary<string, object> { ["station"] = station });
        }

        /// <summary>Снести станок участка: город ничего не возвращает.</summary>
        public void PlotBoardDemolish()
        {
            JObject plot = PlotBoardPlot;
            if (plot == null) return;
            PlotAction("demolish", plot, new Dictionary<string, object>());
        }

        public void PlotBoardSetFee(int percent)
        {
            JObject plot = PlotBoardPlot;
            if (plot == null) return;
            PlotAction("setFee", plot, new Dictionary<string, object> { ["feePct"] = Mathf.Clamp(percent, 0, 100) / 100d });
        }

        private void PlotAction(string action, JObject plot, Dictionary<string, object> extra)
        {
            string plotId = plot?["plotId"]?.ToString();
            if (_plotPending || Socket == null || string.IsNullOrEmpty(plotId)) return;
            var payload = new Dictionary<string, object>
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["action"] = action,
                ["plotId"] = plotId
            };
            foreach (KeyValuePair<string, object> pair in extra) payload[pair.Key] = pair.Value;
            _plotPending = true;
            Socket.EmitWithAck("craftingPlotAction", payload, ack =>
            {
                _plotPending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    ApplyActionAck(ack);
                    Show(ack?["error"]?.ToString() ?? "Сервер отклонил действие с участком.", 5f);
                    RequestPlotState();
                    return;
                }
                ApplyPlotAck(ack);
                Show(action == "bid" ? "Ставка принята."
                    : action == "build" ? "Станок построен."
                    : action == "demolish" ? "Станок снесён." : "Плата за станок изменена.", 4f);
            });
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
            if (payload?["portals"] is JArray portals)
            {
                _portalRows = portals;
                _portalLocationId = payload["locationId"]?.ToString() ?? string.Empty;
                RebuildPortalTargets();
            }
        }

        /// <summary>
        /// Порталы зоны к точкам мира — публичному событию, бою, следам угодий —
        /// приходят в состоянии мира и стоят рядом с переходами локации: та же
        /// метка, та же клавиша E и то же предупреждение о правилах зоны. Вход
        /// шлёт id портала, билет в комнату точки выдаёт сервер.
        /// </summary>
        private void RebuildPortalTargets()
        {
            JArray rows = _locationReady && _portalLocationId == _locationId ? _portalRows : null;
            var signature = new System.Text.StringBuilder();
            if (rows != null)
                foreach (JToken row in rows)
                    signature.Append(row?["id"]).Append('@').Append(row?["tx"]).Append(',').Append(row?["tz"]).Append('|');
            string next = signature.ToString();
            if (next == _portalSignature) return;
            _portalSignature = next;

            for (int index = _staticTargets.Count - 1; index >= 0; index--)
            {
                StaticTarget target = _staticTargets[index];
                if (string.IsNullOrEmpty(target?.Data?["portalId"]?.ToString())) continue;
                if (target.Marker != null) Destroy(target.Marker);
                _staticTargets.RemoveAt(index);
            }
            if (rows == null) return;
            foreach (JToken token in rows)
            {
                JObject row = token as JObject;
                string id = row?["id"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(id)) continue;
                int before = _staticTargets.Count;
                AddTransitionTarget(new LocationTransition
                {
                    Id = id,
                    Type = "worldPortal",
                    Label = row["name"]?.ToString(),
                    To = row["to"]?.ToString(),
                    Tx = row["tx"]?.ToObject<int>() ?? 0,
                    Tz = row["tz"]?.ToObject<int>() ?? 0,
                    Radius = row["radius"]?.ToObject<float>() ?? 3.2f,
                    TargetZoneRules = row["targetZoneRules"] as JObject
                }, new HashSet<string>());
                if (_staticTargets.Count > before) _staticTargets[_staticTargets.Count - 1].Data["portalId"] = id;
            }
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
            // Тир узла — тир зоны: «Руда T3» сразу говорит, какой нужен инструмент.
            int resourceTier = row["tier"]?.ToObject<int?>() ?? 0;
            view.Data["name"] = ResourceLabel(row["type"]?.ToString()) + (resourceTier > 0 ? " T" + resourceTier : string.Empty);
            view.Position = RoaCoords.TileToWorld(tx, tz, _mapWidth, _mapDepth);
            bool available = row["hp"]?.ToObject<float>() > 0f;

            bool loaderOwnsVisual = Loader != null && Loader.TryGetObjectRoot(id, out GameObject _);
            if (_locationReady && (_authoredResourceIds.Contains(id) || loaderOwnsVisual))
            {
                if (view.Marker != null) Destroy(view.Marker);
                view.Marker = null;
                if (Loader != null && Loader.TryGetObjectRoot(id, out GameObject nodeRoot))
                    ApplyTierNodeVisual(nodeRoot, row["type"]?.ToString(), row["tier"]?.ToObject<int?>() ?? 0);
                Loader?.SetObjectVisible(id, available);
            }
            else if (_locationReady)
            {
                if (view.Marker == null) view.Marker = CreateResourceMarker(id, row);
                view.Marker.transform.position = view.Position;
                view.Marker.SetActive(available);
            }
        }

        private const string TierNodeChild = "TierResourceVisual";

        /// <summary>
        /// Точка добычи выглядит по тиру зоны: вместо модели набора зон (и её
        /// замены из пака) ставится префаб PolygonApocalypse этого тира в родном
        /// размере. Повторный вызов ничего не пересоздаёт и снова гасит остальное.
        /// </summary>
        private static void ApplyTierNodeVisual(GameObject root, string type, int tier)
        {
            if (root == null || tier < 1) return;
            Transform existing = root.transform.Find(TierNodeChild);
            if (existing == null)
            {
                GameObject prefab = RoaApocalypseModels.TierNode(type, tier);
                if (prefab == null) return;
                GameObject visual = Instantiate(prefab, root.transform, false);
                visual.name = TierNodeChild;
                Vector3 parentScale = root.transform.lossyScale;
                Vector3 native = prefab.transform.localScale;
                visual.transform.localScale = new Vector3(
                    native.x / Mathf.Max(0.0001f, Mathf.Abs(parentScale.x)),
                    native.y / Mathf.Max(0.0001f, Mathf.Abs(parentScale.y)),
                    native.z / Mathf.Max(0.0001f, Mathf.Abs(parentScale.z)));
                foreach (Transform node in visual.GetComponentsInChildren<Transform>(true))
                    node.gameObject.layer = root.layer;
                foreach (Collider collider in visual.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
                RoaApocalypseModels.MarkTierNode(visual, type, tier);
                existing = visual.transform;
            }
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
                if (!renderer.transform.IsChildOf(existing)) renderer.enabled = false;
        }

        private void RefreshResourceViews()
        {
            foreach (ResourceView view in _resources.Values)
                if (view.Data != null) UpsertResource(view.Data);
        }

        private GameObject CreateResourceMarker(string id, JObject row)
        {
            var root = new GameObject("Resource:" + id);
            root.name = "Resource:" + id;
            root.transform.SetParent(transform, false);
            string type = row?["type"]?.ToString();
            string modelKey = type == "ore" ? "ore_outcrop"
                : type == "wood" ? "tutorialWood"
                : type == "food" || type == "medicine" ? "garden_patch"
                : type == "water" ? "water_tank"
                : type == "oil" || type == "chemicals" ? "rust_barrel_v1"
                : type == "electronics" || type == "ammoParts" || type == "weaponParts" ? "storage_chest"
                : "scrap_heap";
            RoaApocalypseVisuals.CreateGrounded(root.transform, RoaApocalypseModels.Environment(modelKey));
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
                Gate = root.AddComponent<RoaVisibilityGate>()
            };

            view.Placeholder = CreateContainerPlaceholder(root.transform, row);
            return view;
        }

        private static GameObject CreateContainerPlaceholder(Transform parent, JObject row)
        {
            return RoaTutorialProps.Build("crate", parent);
        }

        // Плата арендатора и сама аренда меняются без участия игрока: снимок
        // участков локации обновляется сам, чтобы и Пип-Бой присылал верную плату.
        private const float PlotRefreshSeconds = 15f;

        private void Update()
        {
            UpdateContainerVisibility();
            if (RoaCraftingPlots.Plots.Count > 0 && Time.unscaledTime >= _plotRefreshAt) RequestPlotState();

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
            UpdateAutoGates();
            if (KeyboardInputEnabled && Input.GetKeyDown(InteractKey))
            {
                if (!TryPickupGroundBeforeInteract()) Interact();
            }
        }

        // --- ворота зон и край места: переход срабатывает, когда игрок входит в проём ----------
        private string _autoGateInside = string.Empty;
        private string _autoGateWarned = string.Empty;
        private bool _autoGateLeftSinceWarning;
        private float _autoGateRetryAt;

        private void UpdateAutoGates()
        {
            JObject inside = null;
            Vector3 position = Player.transform.position;
            foreach (StaticTarget target in _staticTargets)
            {
                if (target.Kind != TargetKind.Transition || target.Data?["auto"]?.ToObject<bool>() != true) continue;
                Vector3 delta = target.Position - position;
                delta.y = 0f;
                if (delta.magnitude <= target.Range) { inside = target.Data; break; }
            }
            StepIntoAutoTransition(inside);
        }

        /// <summary>Край места ведёт в зону мира: вызывает бутстрап, пока игрок в краевой полосе.</summary>
        public void UpdateZoneEdge(ParentZoneInfo zone, bool inBand)
        {
            JObject data = null;
            if (inBand && zone != null && !string.IsNullOrEmpty(zone.Id))
            {
                data = new JObject
                {
                    ["id"] = "zone_edge",
                    ["name"] = string.IsNullOrEmpty(zone.Title) ? "Зона" : zone.Title,
                    ["to"] = zone.Id,
                    ["entryKey"] = zone.EntryKey ?? string.Empty,
                    ["targetZoneRules"] = zone.TargetZoneRules != null ? (JToken)zone.TargetZoneRules.DeepClone() : JValue.CreateNull()
                };
            }
            StepIntoAutoTransition(data);
        }

        private void StepIntoAutoTransition(JObject data)
        {
            string target = data?["to"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(target))
            {
                if (!string.IsNullOrEmpty(_autoGateInside) && !string.IsNullOrEmpty(_autoGateWarned)) _autoGateLeftSinceWarning = true;
                _autoGateInside = string.Empty;
                return;
            }
            if (target == _autoGateInside || _transitionPending || Socket == null) return;
            if (Time.realtimeSinceStartup < _autoGateRetryAt) return;
            _autoGateInside = target;

            // В более опасную зону — только со второго шага в проём: первый показывает правила.
            JObject rules = data["targetZoneRules"] as JObject;
            bool confirmed = _autoGateWarned == target && _autoGateLeftSinceWarning && Time.realtimeSinceStartup <= _zoneWarningUntil;
            if (TransitionNeedsConfirmation(rules, _acknowledgedZoneMode) && !confirmed)
            {
                _autoGateWarned = target;
                _autoGateLeftSinceWarning = false;
                _zoneWarningUntil = Time.realtimeSinceStartup + ZoneWarningWindowSeconds;
                Show(TransitionZoneWarning(rules, data["name"]?.ToString()) + "\nШагните в проход ещё раз, чтобы войти.", ZoneWarningWindowSeconds);
                return;
            }
            _autoGateWarned = string.Empty;
            if (rules != null) _acknowledgedZoneMode = rules["mode"]?.ToString() ?? _acknowledgedZoneMode;
            SendLocationTransition(data, failed =>
            {
                // Сервер не пустил (например, игрок ещё не у проёма по его данным) — повтор чуть позже.
                if (!failed) return;
                _autoGateInside = string.Empty;
                _autoGateRetryAt = Time.realtimeSinceStartup + 1.5f;
            });
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

            if (_candidateKind == TargetKind.LabNode)
            {
                UseLabNode(_candidate);
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
            if (_candidateKind == TargetKind.PlotBoard)
            {
                OpenPlotBoard(_candidate);
                return;
            }
            if (_candidateKind == TargetKind.QuestObject)
            {
                UseQuestObject(_candidate);
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

        /// <summary>
        /// Правила зоны за переходом: первое нажатие показывает их, второе в
        /// течение окна подтверждает вход. Так смена режима (мирная база →
        /// Сердцевина → лаборатория) не случается молча, как это было при
        /// переходе через платформу метро.
        /// </summary>
        public static string TransitionZoneWarning(JObject rules, string label)
        {
            if (rules == null) return string.Empty;
            var sb = new StringBuilder(string.IsNullOrEmpty(label) ? "Переход" : label).Append(": ");
            sb.Append(rules["label"]?.ToString() ?? "правила зоны");
            string loss = rules["lossLabel"]?.ToString();
            if (!string.IsNullOrEmpty(loss)) sb.Append(". ").Append(loss);
            string pvp = rules["pvpLabel"]?.ToString();
            if (!string.IsNullOrEmpty(pvp)) sb.Append(' ').Append(pvp);
            sb.Append(" Нажмите ещё раз, чтобы войти.");
            return sb.ToString();
        }

        public static bool TransitionNeedsConfirmation(JObject rules, string acknowledgedMode)
        {
            if (rules == null) return false;
            string mode = rules["mode"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(mode)) return false;
            if (string.Equals(mode, acknowledgedMode, StringComparison.OrdinalIgnoreCase)) return false;
            JToken flag = rules["confirmBeforeEntry"];
            if (flag != null && flag.Type == JTokenType.Boolean) return flag.ToObject<bool>();
            return !string.Equals(rules["loss"]?.ToString() ?? "none", "none", StringComparison.OrdinalIgnoreCase);
        }

        private void UseLocationTransition(JObject transition)
        {
            if (_transitionPending || transition == null || Socket == null) return;
            string target = transition["to"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(target)) return;

            JObject targetRules = transition["targetZoneRules"] as JObject;
            if (TransitionNeedsConfirmation(targetRules, _acknowledgedZoneMode)
                && (_zoneWarningTarget != target || Time.realtimeSinceStartup > _zoneWarningUntil))
            {
                _zoneWarningTarget = target;
                _zoneWarningUntil = Time.realtimeSinceStartup + ZoneWarningWindowSeconds;
                Show(TransitionZoneWarning(targetRules, transition["name"]?.ToString()), ZoneWarningWindowSeconds);
                return;
            }
            _zoneWarningTarget = string.Empty;
            _zoneWarningUntil = 0f;
            if (targetRules != null) _acknowledgedZoneMode = targetRules["mode"]?.ToString() ?? _acknowledgedZoneMode;
            SendLocationTransition(transition, null);
        }

        private void SendLocationTransition(JObject transition, Action<bool> onFinished)
        {
            string target = transition["to"]?.ToString() ?? string.Empty;
            string entryKey = transition["entryKey"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(entryKey))
                entryKey = target == "settlement" ? "entryFromWasteland" : "entryFromSettlement";

            _transitionPending = true;
            Show("Переход: " + (transition["name"]?.ToString() ?? "локация") + "…", 3f);
            var payload = new Dictionary<string, object>
            {
                ["locationId"] = target,
                ["entryKey"] = entryKey,
                ["deviceType"] = Application.isMobilePlatform ? "mobile" : "desktop",
                ["controlType"] = Application.isMobilePlatform ? "touch" : "keyboard_mouse"
            };
            string portalId = transition["portalId"]?.ToString() ?? string.Empty;
            if (!string.IsNullOrEmpty(portalId)) payload["portalId"] = portalId;
            Socket.EmitWithAck("changeLocation", payload, ack =>
            {
                _transitionPending = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    // Портал Сердцевины без контракта: окно выбора фракции, после подписи — тот же переход.
                    if (ack?["contractRequired"]?.ToObject<bool>() == true && ack["contract"] is JObject contract)
                    {
                        RoaTerritoryContractCanvas.Ensure(gameObject, Socket).Open(contract, ack["error"]?.ToString(),
                            () => SendLocationTransition(transition, onFinished));
                        onFinished?.Invoke(true);
                        return;
                    }
                    Show(ack?["error"]?.ToString() ?? "Сервер не разрешил переход.", 4f);
                    onFinished?.Invoke(true);
                    return;
                }
                if (Socket.ApplyLocationTransitionAck(ack) == null)
                    Show("Ответ перехода не удалось разобрать.", 4f);
                onFinished?.Invoke(false);
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
                JObject profession = ack["profession"] as JObject;
                string itemId = item?["id"]?.ToString() ?? string.Empty;
                Show("Получено: " + (string.IsNullOrEmpty(itemId) ? "ресурс" : RoaItemData.Name(itemId))
                    + " x" + (item?["qty"]?.ToObject<int>() ?? 1)
                    + (profession != null ? " · " + profession["name"] + " +" + profession["gained"]
                        + (profession["leveledUp"]?.ToObject<bool>() == true ? " — уровень " + profession["level"] + "!" : string.Empty)
                        : string.Empty));
            });
        }

        private void OpenCrafting(JObject station)
        {
            _active = (JObject)station.DeepClone();
            _panel = PanelKind.Crafting;
            _scroll = Vector2.zero;
            _status = string.Empty;
            RequestPlotState();
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

        /// <summary>
        /// Использовать узел зала лаборатории. Сервер проверяет расстояние и
        /// перезарядку, сбрасывает шкалу угрозы и рассылает состояние зала.
        /// </summary>
        private void UseLabNode(JObject node)
        {
            string id = node?["id"]?.ToString();
            if (string.IsNullOrEmpty(id) || Socket == null) return;
            Socket.EmitWithAck("labNodeAction", new Dictionary<string, object> { ["nodeId"] = id }, ack =>
            {
                if (ack?["ok"]?.ToObject<bool>() == true)
                {
                    Show((ack["node"]?.ToString() ?? "Узел") + ": сработал.", 2.5f);
                    return;
                }
                Show(ack?["error"]?.ToString() ?? "Узел зала недоступен.");
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
                ApplyActionAck(ack);
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["buys"] = buys,
                ["sells"] = sells
            };
            payload["enemyId"] = actorId;
            if (_self?["inventory"] != null) payload["inventory"] = _self["inventory"].DeepClone();
            if (_self?["carry"] != null) payload["carry"] = _self["carry"].DeepClone();
            if (_self?["special"] != null) payload["special"] = _self["special"].DeepClone();
            if (_self?["skillRanks"] != null) payload["skillRanks"] = _self["skillRanks"].DeepClone();
            if (_self?["talentRanks"] != null) payload["talentRanks"] = _self["talentRanks"].DeepClone();
            if (_self?["traits"] != null) payload["traits"] = _self["traits"].DeepClone();
            if (_self?["level"] != null) payload["level"] = _self["level"].DeepClone();

            _tradePending = true;
            Show("Сервер проверяет обмен…", 4f);
            Socket.EmitWithAck("npcTradeExchange", payload, ack =>
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
                string balance = net > 0 ? "доплата " + RoaPlural.Marks(net)
                    : net < 0 ? "получено " + RoaPlural.Marks(Mathf.Abs(net))
                    : "без доплаты";
                ClearTradeQueue();
                Show("Обмен подтверждён сервером: " + balance + ".", 5f);
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["recipeId"] = recipe.Id,
                ["station"] = recipe.Station,
                ["fee"] = recipe.Fee,
                ["locationId"] = _locationId,
                ["stationObjectId"] = stationObjectId,
                ["useFocus"] = RoaCraftingPlots.WantsFocus(recipe, _self?["account"] as JObject)
            }, ack =>
            {
                _craftPending = false;
                ApplyActionAck(ack);
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(CraftingError(ack));
                    // Плата участка могла измениться: окно пересчитает комиссию.
                    if (ack?["requiredFee"] != null) RequestPlotState();
                    return;
                }

                JObject output = ack["output"] as JObject;
                int focusSpent = ack["focusSpent"]?.ToObject<int>() ?? 0;
                Show("Создано: " + RoaItemData.Name(output?["id"]?.ToString() ?? recipe.OutputId)
                    + " x" + (output?["qty"]?.ToObject<int>() ?? recipe.OutputQty)
                    + (focusSpent > 0 ? " · фокус −" + focusSpent : string.Empty));
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
                        + RoaPlural.Marks((reward?["caps"]?.ToObject<int>() ?? 0)) + ".");
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
        public bool SubmitQuickWorldActivity(string boardSiteId, Action<JObject> completed = null)
        {
            if (_worldRequestPending || Socket == null) return false;
            _worldRequestPending = true;
            Show("Ищем активную вылазку…", 3f);
            Socket.EmitWithAck("worldActivityQuickJoin", new Dictionary<string, object>
            {
                ["boardSiteId"] = boardSiteId ?? string.Empty
            }, ack =>
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
                ["requestId"] = Guid.NewGuid().ToString("N"),
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
            _portalSignature = string.Empty;
        }

        private void RemoveContainer(string id)
        {
            ContainerView view;
            if (!_containers.TryGetValue(id, out view)) return;
            if (view.Root != null) Destroy(view.Root);
            _containers.Remove(id);
            if (_active != null && _active["id"]?.ToString() == id) ClosePanel(false);
        }

        private JObject ActiveOnboardingStepForNpc()
        {
            JObject onboarding = _self?["kromkaOnboarding"] as JObject;
            JObject step = onboarding?["step"] as JObject;
            if (step == null || onboarding?["phase"]?.ToString() == "complete") return null;
            string expectedNpcId = step["npcId"]?.ToString() ?? string.Empty;
            string activeNpcId = _active?["kromkaOnboardingNpcId"]?.ToString() ?? string.Empty;
            return !string.IsNullOrEmpty(expectedNpcId) && expectedNpcId == activeNpcId ? step : null;
        }

        private void UseQuestObject(JObject target)
        {
            if (target == null || Socket == null) return;
            string objectId = target["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(objectId)) return;
            Show("Проверяем объект…", 2f);
            Socket.EmitWithAck("kromkaQuestObjectInteract", new Dictionary<string, object>
            {
                ["objectId"] = objectId
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() == true;
                string success = "Цель задания подтверждена.";
                foreach (JObject row in ack?["questProgress"] as JArray ?? new JArray())
                {
                    if (row?["partial"]?.ToObject<bool>() != true) continue;
                    int current = row?["current"]?.ToObject<int>() ?? 0;
                    int targetCount = row?["target"]?.ToObject<int>() ?? 0;
                    success = "Прогресс цели: " + current + "/" + targetCount + ".";
                    break;
                }
                Show(ok ? success : (ack?["error"]?.ToString() ?? "Сервер отклонил взаимодействие."), 4f);
            });
        }

        private JObject KromkaQuestJournalRow(string questId)
        {
            JObject journal = _self?["kromkaQuestJournal"] as JObject;
            if (journal == null || string.IsNullOrEmpty(questId)) return null;
            foreach (string section in new[] { "campaign", "mechanic", "personal" })
            {
                foreach (JObject row in journal[section] as JArray ?? new JArray())
                    if (row?["id"]?.ToString() == questId) return row;
            }
            if (journal["factions"] is JObject factions)
            {
                foreach (JProperty faction in factions.Properties())
                    foreach (JObject row in faction.Value as JArray ?? new JArray())
                        if (row?["id"]?.ToString() == questId) return row;
            }
            return null;
        }

        private void SubmitKromkaQuest(string questId, string mode, string outcomeId)
        {
            string actorId = _active?["id"]?.ToString() ?? string.Empty;
            if (Socket == null || string.IsNullOrEmpty(actorId) || string.IsNullOrEmpty(questId)) return;
            Socket.EmitWithAck("kromkaQuestAction", new Dictionary<string, object>
            {
                ["requestId"] = Guid.NewGuid().ToString("N"),
                ["enemyId"] = actorId,
                ["questId"] = questId,
                ["mode"] = mode,
                ["outcomeId"] = outcomeId
            }, ack =>
            {
                ApplyActionAck(ack);
                bool ok = ack?["ok"]?.ToObject<bool>() ?? false;
                Show(ok ? (mode == "start" ? "Дело принято." : "Решение записано.")
                    : (ack?["error"]?.ToString() ?? "Сервер отклонил сюжетное действие."));
            });
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

        private string PanelTitle()
        {
            string name = _active?["name"]?.ToString() ?? "Взаимодействие";
            if (_panel == PanelKind.Trade) return "Торговля: " + name;
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
            if (state == "turnin") return "готово к сдаче";
            if (state == "choice") return "нужно решение";
            if (state == "ready") return "готово к сдаче";
            if (state == "done") return "выполнено";
            if (state == "locked") return "закрыто";
            return "доступно";
        }

        private static bool NpcHasTrade(JObject actor)
        {
            if (actor == null) return false;
            // Сервер говорит прямо, торгует ли этот человек (экономика v3:
            // только торговцы столиц и баз Сердцевины и скупщик Чёрного рынка).
            if (actor["tradeOpen"]?.Type == JTokenType.Boolean) return actor["tradeOpen"].Value<bool>();
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

            // Табличка участка — раньше доски работ: у обеих один префаб.
            if (kind == "plotboard" || HasTag(entry, "plot-board")) return TargetKind.PlotBoard;

            if (kind == "jobboard" || role == "worldtaskboard"
                || HasTag(entry, "jobBoard") || HasTag(entry, "questBoard"))
                return TargetKind.JobBoard;

            if (kind == "questobject" || HasTag(entry, "quest-object"))
                return TargetKind.QuestObject;

            if (!string.IsNullOrEmpty(CraftingStationId(entry))
                || kind == "craftingstation" || HasTag(entry, "crafting-station"))
                return TargetKind.CraftingStation;

            // Узел зала лаборатории: вентиляция, щит питания, охлаждение,
            // излучатель. Использование сбрасывает шкалу угрозы зала.
            if (kind == "labnode" || HasTag(entry, "lab-node")) return TargetKind.LabNode;

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
            if (kind == TargetKind.PlotBoard) return "Участок под застройку";
            if (kind == TargetKind.QuestObject) return "Объект задания";
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
            if (type == "fiber") return "Волокно";
            if (type == "blue") return "Синь";
            return "Ресурс";
        }

        private static Color ResourceColor(string type)
        {
            if (type == "wood" || type == "food" || type == "medicine") return new Color(0.35f, 0.55f, 0.24f);
            if (type == "fiber") return new Color(0.66f, 0.62f, 0.36f);
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
            return RoaPipboy.FactionLabel(factionId);
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

    }
}
