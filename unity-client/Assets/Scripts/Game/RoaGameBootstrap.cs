using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Главная последовательность Unity-клиента: аккаунт → персонаж → join →
    /// зона мира или место в ней. Здесь же живут игровые меню и
    /// переключение всех экранных подсистем.
    /// </summary>
    public sealed class RoaGameBootstrap : MonoBehaviour
    {
        private const string QualityPrefsKey = "roa.graphicsQuality";
        private const string AutomationFlagVariable = "ROA_UNITY_AUTOMATION";
        private const string AutomationBaseUrlVariable = "ROA_UNITY_BASE_URL";
        private const string AutomationLoginVariable = "ROA_UNITY_LOGIN";
        private const string AutomationPasswordVariable = "ROA_UNITY_PASSWORD";
        private const string AutomationForceMobileVariable = "ROA_UNITY_FORCE_MOBILE";
        private const float AuthHeartbeatIntervalSeconds = 10f;
        private const float AuthHeartbeatFailureRetrySeconds = 60f;

        public static RoaGameBootstrap Active { get; private set; }
        public static bool BlocksWorldHud
        {
            get
            {
                return Active != null && (Active._cinematicActive
                    || (!RoaHudLayout.Editing && (Active._gameMenuOpen || Active._tutorialOpen
                        || Active._graphicsOpen || Active.AnyGameplayPanelOpen())));
            }
        }

        public bool ShowsFrontendBackdrop
        {
            get
            {
                // Канва экрана аккаунта рисует свою подложку; IMGUI-фон поверх
                // uGUI закрыл бы её целиком.
                if (AuthCanvasDriven && FrontendVisible) return false;
                // Экран загрузки — тоже канва (RoaLoadingCanvas).
                if (LoadingCanvasDriven && LoadingVisible) return false;
                return _stage != Stage.InWorld;
            }
        }

        [Header("Сервер")]
        public string BaseUrl = "http://127.0.0.1:3000";

        /// <summary>
        /// Origin текущего сервера для компонентов, создаваемых на лету
        /// (например, рендер арта оружия): им неоткуда взять ссылку на bootstrap.
        /// </summary>
        public static string ActiveBaseUrl { get; private set; } = "http://127.0.0.1:3000";

        [Header("Связи сцены")]
        public RoaSocketClient Socket;
        public RoaLocationLoader Loader;
        public RoaCameraRig CameraRig;
        public RoaRemotePlayers RemotePlayers;
        public RoaEnemies Enemies;
        public RoaCombat Combat;
        public RoaGroundItems GroundItems;
        public RoaWorldLighting Lighting;
        public RoaMinimap Minimap;
        public RoaRoofCutaway RoofCutaway;
        public RoaCombatFx CombatFx;
        public RoaCombatPresentationFx CombatPresentation;
        public RoaAudio Audio;
        public RoaRadio Radio;
        public RoaMovementFx MovementFx;
        public RoaAnomalyFieldRenderer Anomalies;
        public RoaSettlementLifePresentation SettlementLifePresentation;
        public RoaBoltThrower BoltThrower;
        public RoaVehicleController Vehicles;
        public RoaKromkaShiftAndDetector ShiftAndDetector;
        public RoaPersonalBaseCanvas PersonalBaseCanvas;
        public RoaKromkaSiegePresentation SiegePresentation;
        public RoaMobileControls MobileControls;
        public RoaQuickbar Quickbar;
        public RoaActorNameplates ActorNameplates;
        public RoaHud Hud;
        public RoaHudCanvas HudCanvas;
        public RoaPipboyCanvas PipboyCanvas;
        public RoaWorkbenchCanvas WorkbenchCanvas;
        public RoaMapWindowCanvas MapWindow;
        public RoaWorldOverviewCanvas WorldOverview;
        public RoaWorldActivityCanvas WorldActivityCanvas;
        public RoaKromkaOnboarding Onboarding;
        public RoaCaravanDepartureCinematic CaravanDepartureCinematic;
        public RoaFirstRunCoach FirstRunCoach;
        public RoaRecoveryCanvas RecoveryCanvas;

        [Tooltip("NPC, диалоги, торговля, трупы и контейнеры. Если пусто, создаётся автоматически.")]
        public RoaInteraction Interaction;

        [Tooltip("Профиль, навыки, таланты, друзья и кланы. Если пусто, создаётся автоматически.")]
        public RoaPipboy Pipboy;

        [Tooltip("Сумка и оружейная мастерская. Если пусто, используется компонент этого объекта.")]
        public RoaInventory Inventory;

        [Tooltip("Туман войны. Если пусто, создаётся автоматически при входе в мир.")]
        public RoaFogOfWar Fog;

        [Header("Авто-вход (только для отладки)")]
        [Tooltip("Войти сразу при старте, без ручного ввода. Держать выключенным в сохранённой сцене — " +
                 "поля ниже иначе попадут в репозиторий вместе с учётными данными.")]
        public bool AutoLoginOnStart;

        public string AutoLoginName = string.Empty;
        public string AutoLoginPassword = string.Empty;

        [Tooltip("Создавать нового персонажа, если на аккаунте ещё нет ни одного.")]
        public bool AutoCreateCharacter = true;

        private enum Stage
        {
            NeedLogin,
            LoggingIn,
            PickCharacter,
            CreateCharacter,
            Joining,
            LoadingLocation,
            InWorld,
            Failed
        }

        private enum AuthPanel
        {
            Login,
            Register,
            ResetRequest,
            ResetConfirm
        }

        /// <summary>
        /// Рост персонажа в метрах. Совпадает с проверкой позы web-клиента
        /// (check-character-pose-stability: голова на 1.53 м), плюс запас до макушки.
        /// </summary>
        public const float PlayerHeight = 1.8f;

        private RoaAuthClient _auth;
        private Stage _stage = Stage.NeedLogin;
        private string _status = string.Empty;

        /// <summary>Текущий этап и последнее сообщение — для диагностики извне (тесты, MCP).</summary>
        public string StageName { get { return _stage.ToString(); } }
        public string StatusText { get { return _status; } }

        private string _login = string.Empty;
        private string _password = string.Empty;
        private string _email = string.Empty;
        private string _passwordConfirm = string.Empty;
        private string _resetToken = string.Empty;
        private string _newPassword = string.Empty;
        private AuthPanel _authPanel = AuthPanel.Login;
        private string _deleteCandidateId = string.Empty;
        private string _deleteConfirmation = string.Empty;
        private string _newCharacterName = "Странник";
        private readonly RoaCharacterCreator _creator = new RoaCharacterCreator();
        private RoaCharacterPreview _characterPreview;
        private Vector2 _creatorScroll;
        private bool _joiningNewCharacter;
        private float _nextAuthHeartbeatAt;
        private bool _authHeartbeatPending;
        private bool _authHeartbeatWarningShown;
        private bool _gameMenuOpen;
        private bool _gameMenuActionPending;
        private bool _tutorialOpen;
        private bool _graphicsOpen;
        private bool _cinematicActive;

        private GameObject _player;
        private RoaPlayerController _controller;
        private RoaCharacterView _playerView;

        public RoaCharacterView PlayerView { get { return _playerView; } }
        private bool _automationForceMobile;

        private void Awake()
        {
            if (RoaLocalModelReview.TryStart()) return;
            Active = this;
            RoaUiTheme.Ensure(gameObject);
            ApplyAutomationEnvironment();
#if UNITY_WEBGL && !UNITY_EDITOR
            // WebGL-сборка раздаётся тем же Node-сервером (public/unity/): сервер —
            // origin страницы, как defaultServerApiBase() у браузерного клиента.
            try
            {
                var page = new System.Uri(Application.absoluteURL);
                BaseUrl = page.GetLeftPart(System.UriPartial.Authority);
            }
            catch (System.Exception) { }
#endif
            ApplySavedQuality();
            _auth = new RoaAuthClient(BaseUrl);
            ActiveBaseUrl = BaseUrl;
            if (Loader != null) Loader.BaseUrl = BaseUrl;
            if (RemotePlayers != null) RemotePlayers.BaseUrl = BaseUrl;
            if (Enemies != null) Enemies.BaseUrl = BaseUrl;

            // Туман — общий источник игровой видимости, поэтому он должен
            // существовать раньше всех, кто его спрашивает.
            if (Fog == null) Fog = gameObject.AddComponent<RoaFogOfWar>();
            Fog.Loader = Loader;

            if (Lighting == null) Lighting = GetComponent<RoaWorldLighting>();
            if (Lighting == null) Lighting = gameObject.AddComponent<RoaWorldLighting>();
            Lighting.Configure(BaseUrl);
            Lighting.SetLocalWorldActive(false);

            if (Audio == null) Audio = GetComponent<RoaAudio>();
            if (Audio == null) Audio = gameObject.AddComponent<RoaAudio>();
            Audio.Configure(this);

            if (MovementFx == null) MovementFx = GetComponent<RoaMovementFx>();
            if (MovementFx == null) MovementFx = gameObject.AddComponent<RoaMovementFx>();
            MovementFx.Configure(Audio);

            if (Minimap == null) Minimap = GetComponent<RoaMinimap>();
            if (Minimap == null) Minimap = gameObject.AddComponent<RoaMinimap>();

            // Подсказка при наведении на постройки города.
            var tooltip = GetComponent<RoaWorldTooltip>();
            if (tooltip == null) tooltip = gameObject.AddComponent<RoaWorldTooltip>();
            tooltip.Loader = Loader;

            if (RoofCutaway == null) RoofCutaway = GetComponent<RoaRoofCutaway>();
            if (RoofCutaway == null) RoofCutaway = gameObject.AddComponent<RoaRoofCutaway>();
            RoofCutaway.Configure(Fog, CameraRig);

            if (CombatPresentation == null) CombatPresentation = GetComponent<RoaCombatPresentationFx>();
            if (CombatPresentation == null) CombatPresentation = gameObject.AddComponent<RoaCombatPresentationFx>();
            CombatPresentation.CameraRig = CameraRig;

            if (CombatFx == null) CombatFx = GetComponent<RoaCombatFx>();
            if (CombatFx == null) CombatFx = gameObject.AddComponent<RoaCombatFx>();
            CombatFx.Audio = Audio;
            CombatFx.Polish = CombatPresentation;
            CombatFx.Fog = Fog;
            CombatFx.Configure(Socket, Enemies);

            Camera movementFxCamera = CameraRig != null ? CameraRig.GetComponent<Camera>() : Camera.main;
            if (Enemies != null)
            {
                Enemies.Fog = Fog;
                Enemies.ConfigureMovementFx(MovementFx, movementFxCamera);
            }
            if (RemotePlayers != null)
            {
                RemotePlayers.Fog = Fog;
                RemotePlayers.ConfigureMovementFx(MovementFx, movementFxCamera);
            }
            if (GroundItems != null) GroundItems.Fog = Fog;

            var worldOverlay = GetComponent<RoaWorldOverlayCanvas>();
            if (worldOverlay == null) worldOverlay = gameObject.AddComponent<RoaWorldOverlayCanvas>();
            worldOverlay.Configure(GroundItems, Enemies, movementFxCamera);
            if (GroundItems != null) GroundItems.CanvasDriven = true;
            if (CombatFx != null) CombatFx.CanvasDriven = true;

            if (Interaction == null) Interaction = GetComponent<RoaInteraction>();
            if (Interaction == null) Interaction = gameObject.AddComponent<RoaInteraction>();
            Interaction.Configure(BaseUrl, Socket, Enemies, Fog, Loader);
            if (CaravanDepartureCinematic == null)
                CaravanDepartureCinematic = GetComponent<RoaCaravanDepartureCinematic>();
            if (CaravanDepartureCinematic == null)
                CaravanDepartureCinematic = gameObject.AddComponent<RoaCaravanDepartureCinematic>();
            CaravanDepartureCinematic.Configure(this, Socket, CameraRig);
            Interaction.CaravanDepartureCinematic = CaravanDepartureCinematic;
            Interaction.GroundItems = GroundItems;
            Minimap.Configure(Enemies, RemotePlayers, GroundItems, Interaction);
            if (GroundItems != null) GroundItems.Interaction = Interaction;
            if (Combat != null) Combat.Interaction = Interaction;

            if (Pipboy == null) Pipboy = GetComponent<RoaPipboy>();
            if (Pipboy == null) Pipboy = gameObject.AddComponent<RoaPipboy>();
            // Радио Pip-Boy: отдельный синтезированный эфир, читает канал из Pip-Boy
            // и сводку пустоши из него же; общая громкость — через AudioListener.
            if (Radio == null) Radio = GetComponent<RoaRadio>();
            if (Radio == null) Radio = gameObject.AddComponent<RoaRadio>();
            Radio.Pipboy = Pipboy;
            Radio.Bootstrap = this;
            Pipboy.Configure(Socket, RemotePlayers, BaseUrl);
            if (ActorNameplates == null) ActorNameplates = GetComponent<RoaActorNameplates>();
            if (ActorNameplates == null) ActorNameplates = gameObject.AddComponent<RoaActorNameplates>();
            ActorNameplates.Configure(Socket, Enemies, RemotePlayers,
                CameraRig != null ? CameraRig.GetComponent<Camera>() : Camera.main);
            ActorNameplates.CanvasDriven = true; // подписи в uGUI, как .actor-nameplate web
            ActorNameplates.Combat = Combat;
            if (Combat != null) Combat.TargetHintCanvasDriven = true;
            if (Inventory == null) Inventory = GetComponent<RoaInventory>();
            if (Inventory != null) Inventory.GroundItems = GroundItems;
            if (Combat != null)
            {
                Combat.Bootstrap = this;
                Combat.Pipboy = Pipboy;
                Combat.RemotePlayers = RemotePlayers;
                Combat.Inventory = Inventory;
                Combat.Fx = CombatFx;
                Combat.Audio = Audio;
                Combat.Fog = Fog;
                var feedback = GetComponent<RoaCombatFeedbackCanvas>();
                if (feedback == null) feedback = gameObject.AddComponent<RoaCombatFeedbackCanvas>();
                feedback.Configure(CameraRig != null ? CameraRig.GetComponent<Camera>() : Camera.main);
                Combat.FeedbackCanvas = feedback;
            }

            if (MobileControls == null) MobileControls = GetComponent<RoaMobileControls>();
            if (MobileControls == null) MobileControls = gameObject.AddComponent<RoaMobileControls>();
            if (_automationForceMobile) MobileControls.ForceVisible = true;
            MobileControls.Configure(Combat, Interaction, Inventory, Pipboy, Enemies, GroundItems);
            MobileControls.MenuRequested = ToggleGameMenu;

            if (Anomalies == null) Anomalies = GetComponent<RoaAnomalyFieldRenderer>();
            if (Anomalies == null) Anomalies = gameObject.AddComponent<RoaAnomalyFieldRenderer>();
            Anomalies.Configure(Socket);
            Anomalies.SetLocalWorldActive(false);
            if (SettlementLifePresentation == null) SettlementLifePresentation = GetComponent<RoaSettlementLifePresentation>();
            if (SettlementLifePresentation == null) SettlementLifePresentation = gameObject.AddComponent<RoaSettlementLifePresentation>();
            SettlementLifePresentation.Configure(Loader);
            if (BoltThrower == null) BoltThrower = GetComponent<RoaBoltThrower>();
            if (BoltThrower == null) BoltThrower = gameObject.AddComponent<RoaBoltThrower>();
            BoltThrower.Configure(Socket, movementFxCamera, MobileControls);
            if (Vehicles == null) Vehicles = GetComponent<RoaVehicleController>();
            if (Vehicles == null) Vehicles = gameObject.AddComponent<RoaVehicleController>();
            Vehicles.Configure(Socket, Inventory, BaseUrl);
            Vehicles.ConfigurePresentation(MovementFx, Audio, movementFxCamera);
            if (ShiftAndDetector == null) ShiftAndDetector = GetComponent<RoaKromkaShiftAndDetector>();
            if (ShiftAndDetector == null) ShiftAndDetector = gameObject.AddComponent<RoaKromkaShiftAndDetector>();
            ShiftAndDetector.Configure(this, Socket);
            if (MobileControls != null) MobileControls.SetArtifacts(ShiftAndDetector);
            if (PersonalBaseCanvas == null) PersonalBaseCanvas = GetComponent<RoaPersonalBaseCanvas>();
            if (PersonalBaseCanvas == null) PersonalBaseCanvas = gameObject.AddComponent<RoaPersonalBaseCanvas>();
            PersonalBaseCanvas.Configure(this, Socket);
            if (SiegePresentation == null) SiegePresentation = GetComponent<RoaKromkaSiegePresentation>();
            if (SiegePresentation == null) SiegePresentation = gameObject.AddComponent<RoaKromkaSiegePresentation>();
            SiegePresentation.Configure(this, Socket);
            // Аванпосты, публичные события, мировой босс и PvE-области — одна
            // компактная панель HUD, данные только с сервера.
            var worldEvents = GetComponent<RoaWorldEventsPresentation>();
            if (worldEvents == null) worldEvents = gameObject.AddComponent<RoaWorldEventsPresentation>();
            worldEvents.Configure(Socket);

            var mobileCanvas = GetComponent<RoaMobileControlsCanvas>();
            if (mobileCanvas == null) mobileCanvas = gameObject.AddComponent<RoaMobileControlsCanvas>();
            mobileCanvas.Configure(MobileControls, BoltThrower, Vehicles);
            MobileControls.CanvasDriven = true;

            if (Quickbar == null) Quickbar = GetComponent<RoaQuickbar>();
            if (Quickbar == null) Quickbar = gameObject.AddComponent<RoaQuickbar>();
            Quickbar.Configure(_auth, Socket, Inventory, Combat, MobileControls, Interaction);
            if (Inventory != null) Inventory.Quickbar = Quickbar;

            if (Hud == null) Hud = GetComponent<RoaHud>();
            if (Hud == null) Hud = gameObject.AddComponent<RoaHud>();
            if (ActorNameplates != null) ActorNameplates.Hud = Hud;
            if (Combat != null) Combat.Hud = Hud;
            if (Hud.Socket == null)
            {
                bool wasEnabled = Hud.enabled;
                Hud.enabled = false;
                Hud.Socket = Socket;
                Hud.enabled = wasEnabled;
            }
            if (HudCanvas == null) HudCanvas = GetComponent<RoaHudCanvas>();
            if (HudCanvas == null) HudCanvas = gameObject.AddComponent<RoaHudCanvas>();
            HudCanvas.Configure(Hud, Quickbar, Minimap, Combat, MobileControls);
            HudCanvas.SetInteraction(Interaction);
            HudCanvas.SetArtifactSource(ShiftAndDetector);

            // Терминал PIP-ASH: инвентарь и Pip-Boy в структуре web. Старые
            // IMGUI-окна выключаются флагом CanvasDriven — данные и серверные
            // действия остаются в них, новый класс их только рисует.
            if (PipboyCanvas == null) PipboyCanvas = GetComponent<RoaPipboyCanvas>();
            if (PipboyCanvas == null) PipboyCanvas = gameObject.AddComponent<RoaPipboyCanvas>();
            PipboyCanvas.Inventory = Inventory;
            PipboyCanvas.Pipboy = Pipboy;
            PipboyCanvas.Hud = Hud;
            PipboyCanvas.Socket = Socket;
            PipboyCanvas.Combat = Combat;
            PipboyCanvas.Loader = Loader;
            PipboyCanvas.Interaction = Interaction;
            PipboyCanvas.Fog = Fog;
            PipboyCanvas.Quickbar = Quickbar;
            PipboyCanvas.PersonalBaseCanvas = PersonalBaseCanvas;
            if (Combat != null) Combat.PipboyCanvas = PipboyCanvas;
            // Сенсорные кнопки открывают тот же терминал, что и клавиши: без этой
            // связи «Сумка» и «ПУТНИК» на телефоне гасили HUD и слой кнопок, не
            // показав окна, и выйти было нечем — Esc на телефоне нет.
            if (MobileControls != null) MobileControls.SetTerminal(PipboyCanvas);
            if (Inventory != null) Inventory.CanvasDriven = true;
            if (Pipboy != null) Pipboy.CanvasDriven = true;
            // Запрос лечения и приглашение к обмену открывают страницу «Друзья»
            // канвы: прежний путь поднимал флаг выключенного IMGUI-окна, и игрок
            // оставался без HUD и без окна, пока не нажмёт Esc.
            if (Pipboy != null) Pipboy.OpenSocialCanvas = () => PipboyCanvas.Open(RoaPipboyCanvas.Page.Friends);

            // Бартер в web-виде: три колонки поверх той же серверной логики.
            var barter = GetComponent<RoaBarterCanvas>();
            if (barter == null) barter = gameObject.AddComponent<RoaBarterCanvas>();
            barter.Interaction = Interaction;
            barter.Hud = Hud;
            barter.Inventory = Inventory;
            if (Interaction != null) Interaction.TradeCanvasDriven = true;

            // Окно станка канвой: у встроенного шрифта IMGUI в WebGL нет кириллицы,
            // и в браузере это окно теряло подписи.
            var crafting = GetComponent<RoaCraftingCanvas>();
            if (crafting == null) crafting = gameObject.AddComponent<RoaCraftingCanvas>();
            crafting.Interaction = Interaction;
            if (Interaction != null) Interaction.CraftingCanvasDriven = true;
            // Круг быстрых слотов и баннер выхода рисует HUD-канва — по той же причине.
            if (Quickbar != null) Quickbar.RadialCanvasDriven = true;

            // Лут и хранилище в web-виде поверх той же серверной логики.
            var loot = GetComponent<RoaLootCanvas>();
            if (loot == null) loot = gameObject.AddComponent<RoaLootCanvas>();
            loot.Interaction = Interaction;
            if (Interaction != null) Interaction.LootCanvasDriven = true;

            if (GetComponent<RoaWebGlInputProbe>() == null) gameObject.AddComponent<RoaWebGlInputProbe>();

            // Подсказка предмета и контекстное меню (#tooltip, #item-context-menu).
            if (GetComponent<RoaItemPopups>() == null) gameObject.AddComponent<RoaItemPopups>();

            // Панель количества в web-виде (#quantity-side-panel) поверх торговли/хранилища/лута.
            var quantity = GetComponent<RoaQuantityCanvas>();
            if (quantity == null) quantity = gameObject.AddComponent<RoaQuantityCanvas>();
            quantity.Interaction = Interaction;
            if (Interaction != null) Interaction.QuantityCanvasDriven = true;

            // Окно таблички участка: торги за место в городе и постройка станка.
            var plotCanvas = GetComponent<RoaPlotCanvas>();
            if (plotCanvas == null) plotCanvas = gameObject.AddComponent<RoaPlotCanvas>();
            plotCanvas.Interaction = Interaction;

            // Хранилище в web-виде (#storage-window): колонки, вкладки категорий, карточки.
            var storage = GetComponent<RoaStorageCanvas>();
            if (storage == null) storage = gameObject.AddComponent<RoaStorageCanvas>();
            storage.Interaction = Interaction;
            storage.Inventory = Inventory;

            // Диалог NPC и доска контрактов в web-виде.
            var dialogue = GetComponent<RoaDialogueCanvas>();
            if (dialogue == null) dialogue = gameObject.AddComponent<RoaDialogueCanvas>();
            dialogue.Interaction = Interaction;
            if (Interaction != null) Interaction.DialogueCanvasDriven = true;

            var subtitles = GetComponent<RoaSubtitlesCanvas>();
            if (subtitles == null) subtitles = gameObject.AddComponent<RoaSubtitlesCanvas>();
            subtitles.Configure(this, Interaction);

            // Меню, графика, обучение и панель редактирования HUD в web-виде.
            var system = GetComponent<RoaSystemCanvas>();
            if (system == null) system = gameObject.AddComponent<RoaSystemCanvas>();
            system.Bootstrap = this;
            SystemCanvasDriven = true;

            var chat = GetComponent<RoaChatCanvas>();
            if (chat == null) chat = gameObject.AddComponent<RoaChatCanvas>();
            chat.Configure(this, Socket);

            // Экран загрузки локации в web-виде (#location-loading-screen).
            var loadingCanvas = GetComponent<RoaLoadingCanvas>();
            if (loadingCanvas == null) loadingCanvas = gameObject.AddComponent<RoaLoadingCanvas>();
            loadingCanvas.Bootstrap = this;
            LoadingCanvasDriven = true;

            // Окно ожидания каравана в web-виде (#caravan-staging-window).
            var staging = GetComponent<RoaCaravanStagingCanvas>();
            if (staging == null) staging = gameObject.AddComponent<RoaCaravanStagingCanvas>();
            staging.Pipboy = Pipboy;
            staging.Bootstrap = this;

            // HUD сервер-авторитетной активности текущей локации.
            if (WorldActivityCanvas == null) WorldActivityCanvas = GetComponent<RoaWorldActivityCanvas>();
            if (WorldActivityCanvas == null) WorldActivityCanvas = gameObject.AddComponent<RoaWorldActivityCanvas>();
            WorldActivityCanvas.Configure(Socket, this);
            if (HudCanvas != null) HudCanvas.SetWorldActivity(WorldActivityCanvas);
            if (Minimap != null) Minimap.WorldActivity = WorldActivityCanvas;

            if (Onboarding == null) Onboarding = GetComponent<RoaKromkaOnboarding>();
            if (Onboarding == null) Onboarding = gameObject.AddComponent<RoaKromkaOnboarding>();
            Onboarding.Configure(this, Socket);

            if (FirstRunCoach == null) FirstRunCoach = GetComponent<RoaFirstRunCoach>();
            if (FirstRunCoach == null) FirstRunCoach = gameObject.AddComponent<RoaFirstRunCoach>();
            FirstRunCoach.Configure(this);

            if (RecoveryCanvas == null) RecoveryCanvas = GetComponent<RoaRecoveryCanvas>();
            if (RecoveryCanvas == null) RecoveryCanvas = gameObject.AddComponent<RoaRecoveryCanvas>();
            RecoveryCanvas.Configure(Socket, this);

            // Оружейный верстак в web-виде (#weapon-modification-window).
            var workbench = GetComponent<RoaWorkbenchCanvas>();
            if (workbench == null) workbench = gameObject.AddComponent<RoaWorkbenchCanvas>();
            workbench.Inventory = Inventory;
            workbench.Hud = Hud;
            WorkbenchCanvas = workbench;

            // Экран входа и выбора персонажа в web-виде (#character-screen).
            var authCanvas = GetComponent<RoaAuthCanvas>();
            if (authCanvas == null) authCanvas = gameObject.AddComponent<RoaAuthCanvas>();
            authCanvas.Bootstrap = this;
            AuthCanvasDriven = true;

            // Карта локации по M — в web это #map-window с тем же рендером, что миникарта.
            var mapWindow = GetComponent<RoaMapWindowCanvas>();
            if (mapWindow == null) mapWindow = gameObject.AddComponent<RoaMapWindowCanvas>();
            mapWindow.Minimap = Minimap;
            MapWindow = mapWindow;

            // Карта мира из локальной сцены: кнопка на миникарте, флажок там, где игрок.
            var worldOverview = GetComponent<RoaWorldOverviewCanvas>();
            if (worldOverview == null) worldOverview = gameObject.AddComponent<RoaWorldOverviewCanvas>();
            worldOverview.Socket = Socket;
            worldOverview.Minimap = Minimap;
            worldOverview.Loader = Loader;
            WorldOverview = worldOverview;

            _characterPreview = GetComponent<RoaCharacterPreview>();
            if (_characterPreview == null) _characterPreview = gameObject.AddComponent<RoaCharacterPreview>();
        }

        private void Start()
        {
            StartCoroutine(FetchCharacterProgressionCatalog());
            StartCoroutine(FetchItemCatalog());
            if (!AutoLoginOnStart) return;
            if (string.IsNullOrEmpty(AutoLoginName) || string.IsNullOrEmpty(AutoLoginPassword))
            {
                Debug.LogWarning("[ROA] AutoLoginOnStart включён, но логин или пароль пуст.");
                return;
            }

            _login = AutoLoginName;
            _password = AutoLoginPassword;
            // Serialized debug fields and environment-derived credentials are only
            // a launch hand-off. Do not keep another copy for the lifetime of the
            // client or let a later incidental scene save capture them.
            AutoLoginName = string.Empty;
            AutoLoginPassword = string.Empty;
            StartCoroutine(AutoFlow());
        }

        private IEnumerator FetchCharacterProgressionCatalog()
        {
            string url = BaseUrl.TrimEnd('/') + "/api/kromka/character-progression";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.timeout = 12;
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning("[ROA] Каталог развития недоступен: " + request.error);
                    yield break;
                }
                JObject response;
                try { response = JObject.Parse(request.downloadHandler.text); }
                catch (Exception error)
                {
                    Debug.LogWarning("[ROA] Каталог развития повреждён: " + error.Message);
                    yield break;
                }
                JObject catalog = response["catalog"] as JObject;
                if (response["ok"]?.ToObject<bool>() != true || catalog == null)
                {
                    Debug.LogWarning("[ROA] Сервер не вернул каталог развития персонажа.");
                    yield break;
                }
                string progressionError;
                string creatorError;
                bool progressionOk = RoaProgressionData.ApplyCatalog(catalog, out progressionError);
                bool creatorOk = RoaCharacterCreator.ApplyCatalog(catalog, out creatorError);
                if (!progressionOk || !creatorOk)
                {
                    Debug.LogWarning("[ROA] Каталог развития отклонён: "
                        + (!string.IsNullOrEmpty(progressionError) ? progressionError : creatorError));
                    yield break;
                }
                ProgressionCatalogVersion++;
            }
        }

        private IEnumerator FetchItemCatalog()
        {
            string url = BaseUrl.TrimEnd('/') + "/api/kromka/items";
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.timeout = 12;
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogWarning("[ROA] Каталог предметов недоступен: " + request.error);
                    yield break;
                }
                JObject response;
                try { response = JObject.Parse(request.downloadHandler.text); }
                catch (Exception error)
                {
                    Debug.LogWarning("[ROA] Каталог предметов повреждён: " + error.Message);
                    yield break;
                }
                JObject catalog = response["catalog"] as JObject;
                string catalogError = string.Empty;
                if (response["ok"]?.ToObject<bool>() != true || catalog == null
                    || !RoaItemData.ApplyCatalog(catalog, out catalogError))
                {
                    Debug.LogWarning("[ROA] Каталог предметов отклонён: "
                        + (string.IsNullOrEmpty(catalogError) ? "нет данных" : catalogError));
                    yield break;
                }
                JObject fieldRecipes = response["fieldRecipes"] as JObject;
                if (!RoaCraftingData.ApplyCatalog(fieldRecipes, out catalogError))
                {
                    Debug.LogWarning("[ROA] Каталог полевого крафта отклонён: " + catalogError);
                }
            }
        }

        /// <summary>
        /// Opt-in hook for isolated CI and smoke-test servers. The normal player
        /// ignores all related variables unless ROA_UNITY_AUTOMATION=1. Credentials
        /// remain process-local and are never written to PlayerPrefs or the scene.
        /// </summary>
        private void ApplyAutomationEnvironment()
        {
            string enabled = Environment.GetEnvironmentVariable(AutomationFlagVariable);
            if (!string.Equals(enabled, "1", StringComparison.Ordinal)) return;

            _automationForceMobile = string.Equals(
                Environment.GetEnvironmentVariable(AutomationForceMobileVariable),
                "1", StringComparison.Ordinal);

            string candidateUrl = (Environment.GetEnvironmentVariable(AutomationBaseUrlVariable)
                                   ?? string.Empty).Trim();
            if (!string.IsNullOrEmpty(candidateUrl))
            {
                Uri uri;
                bool valid = Uri.TryCreate(candidateUrl, UriKind.Absolute, out uri)
                    && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
                if (valid) BaseUrl = candidateUrl.TrimEnd('/');
                else Debug.LogWarning("[ROA] ROA_UNITY_BASE_URL отклонён: нужен абсолютный HTTP(S) URL.");
            }

            string login = (Environment.GetEnvironmentVariable(AutomationLoginVariable)
                            ?? string.Empty).Trim();
            string password = Environment.GetEnvironmentVariable(AutomationPasswordVariable)
                              ?? string.Empty;
            if (string.IsNullOrEmpty(login) || string.IsNullOrEmpty(password))
            {
                Debug.LogWarning("[ROA] Режим автоматизации включён без логина или пароля; авто-вход не запущен.");
                return;
            }

            AutoLoginOnStart = true;
            AutoLoginName = login;
            AutoLoginPassword = password;
        }

        private void Update()
        {
            if (_characterPreview != null)
                _characterPreview.SetVisible(_stage == Stage.CreateCharacter);

            UpdatePlaceEdgeExit();

            if (!_cinematicActive && _stage == Stage.InWorld
                && Input.GetKeyDown(KeyCode.F1)
                && !RoaHudLayout.Editing && (_tutorialOpen || !AnyGameplayPanelOpen()))
                SetTutorialOpen(!_tutorialOpen);

            if (!_cinematicActive && _stage == Stage.InWorld
                && Input.GetKeyDown(KeyCode.Escape))
            {
                if (RoaHudLayout.Editing) EndHudEdit();
                else if (_graphicsOpen) SetGraphicsOpen(false);
                else if (_tutorialOpen) SetTutorialOpen(false);
                else if (_gameMenuOpen) SetGameMenuOpen(false);
                else if (WorldOverview != null && WorldOverview.IsOpen) WorldOverview.Close();
                else if (MapWindow != null && MapWindow.IsOpen) MapWindow.Close();
                else if (WorkbenchCanvas != null && WorkbenchCanvas.IsOpen) Inventory.CloseWorkbench();
                else if (PipboyCanvas != null && PipboyCanvas.IsOpen) PipboyCanvas.Close();
                else if (Inventory != null && Inventory.IsOpen) Inventory.Toggle();
                else if (Pipboy != null && Pipboy.IsOpen) Pipboy.Toggle();
                else if ((Interaction == null || !Interaction.IsPanelOpen)
                    && (Quickbar == null || !Quickbar.IsRadialOpen))
                    SetGameMenuOpen(true);
            }

            bool gameplaySession = _stage == Stage.Joining || _stage == Stage.LoadingLocation
                || _stage == Stage.InWorld;
            RoaSocketClient.ConnectionPhase socketPhase = Socket != null
                ? Socket.Phase
                : RoaSocketClient.ConnectionPhase.Disconnected;
            if (_auth != null && _auth.IsAuthenticated && !_authHeartbeatPending
                && ShouldAttemptAuthHeartbeat(gameplaySession, socketPhase)
                && Time.unscaledTime >= _nextAuthHeartbeatAt)
                StartCoroutine(DoAuthHeartbeat());
        }

        public static float AuthHeartbeatDelay(bool success)
        {
            return success ? AuthHeartbeatIntervalSeconds : AuthHeartbeatFailureRetrySeconds;
        }

        public static bool ShouldAttemptAuthHeartbeat(
            bool gameplaySession, RoaSocketClient.ConnectionPhase socketPhase)
        {
            return !gameplaySession || socketPhase == RoaSocketClient.ConnectionPhase.Joined;
        }

        private void ToggleGameMenu()
        {
            if (_stage != Stage.InWorld) return;
            if (RoaHudLayout.Editing) RoaHudLayout.SetEditing(false);
            if (_graphicsOpen) _graphicsOpen = false;
            if (_tutorialOpen) _tutorialOpen = false;
            SetGameMenuOpen(!_gameMenuOpen);
        }

        private float _edgeExitRetryAt;

        /// <summary>
        /// Край места внутри зоны: игрок в полосе выхода (2 клетки от края играбельной
        /// области) и ни одно окно не открыто — переход в родительскую зону
        /// запрашивается сам, без клавиши. Отказ сервера повторяется через 0.75 с.
        /// </summary>
        private void UpdatePlaceEdgeExit()
        {
            if (_stage != Stage.InWorld || _controller == null || Minimap == null || Interaction == null) return;
            ParentZoneInfo parentZone = Loader != null ? Loader.Current?.ExitZone : null;
            if (parentZone == null || !CurrentLocationHasEdgeExit) return;
            if (_cinematicActive || _gameMenuOpen || _tutorialOpen || _graphicsOpen
                || RoaHudLayout.Editing || AnyGameplayPanelOpen()) return;
            if (Time.unscaledTime < _edgeExitRetryAt) return;
            int width = Minimap.MapWidth, depth = Minimap.MapDepth;
            if (width <= 0 || depth <= 0) return;
            Vector3 position = _controller.transform.position;
            bool inBand = RoaWorldExitBoundary.IsInExitBand(position, width, depth);
            // Город занимает сектор: каждая его сторона ведёт к своему соседу.
            ParentZoneInfo target = Loader?.Current?.SectorGate(RoaWorldExitBoundary.EdgeSide(position, width, depth)) ?? parentZone;
            EdgeExitTarget = target;
            Interaction.UpdateZoneEdge(target, inBand);
            if (inBand) _edgeExitRetryAt = Time.unscaledTime + 0.75f;
        }

        private void SetGameMenuOpen(bool open)
        {
            _gameMenuOpen = open;
            ApplyOverlayInputState();
        }

        private void SetTutorialOpen(bool open)
        {
            _tutorialOpen = open;
            if (open)
            {
                _gameMenuOpen = false;
                _graphicsOpen = false;
            }
            ApplyOverlayInputState();
        }

        private void SetGraphicsOpen(bool open)
        {
            _graphicsOpen = open;
            if (open)
            {
                _gameMenuOpen = false;
                _tutorialOpen = false;
            }
            ApplyOverlayInputState();
        }

        private void ApplyOverlayInputState()
        {
            bool input = !_cinematicActive && !_gameMenuOpen && !_tutorialOpen
                && !_graphicsOpen && !RoaHudLayout.Editing;
            if (_controller != null) _controller.InputEnabled = input;
            if (Combat != null) Combat.InputEnabled = input;
            if (Quickbar != null) Quickbar.InputEnabled = input;
            if (MobileControls != null) MobileControls.InputSuppressed = !input;
            if (Inventory != null) Inventory.InputEnabled = input;
            if (Pipboy != null) Pipboy.InputEnabled = input;
            if (PipboyCanvas != null) PipboyCanvas.InputEnabled = input;
            if (MapWindow != null) MapWindow.InputEnabled = input;
            if (WorldOverview != null) WorldOverview.InputEnabled = input;
        }

        public bool CinematicActive { get { return _cinematicActive; } }
        /// <summary>Край текущего места выводит в его зону: место стоит в зоне и сюжет его не держит.</summary>
        /// <summary>Куда выводит край там, где стоит игрок: зона места или сторона города.</summary>
        public ParentZoneInfo EdgeExitTarget { get; private set; }

        public bool CurrentLocationHasEdgeExit
        {
            get { return AllowsEdgeExit(Loader?.Current, Onboarding?.Phase); }
        }

        public static bool AllowsEdgeExit(LocationDefinition location, string onboardingPhase)
        {
            if (location == null || location.ExitZone == null) return false;
            if (!location.CanExitAtEdge) return false;
            return !(string.Equals(location.Id, "randomRuinedRoad", StringComparison.Ordinal)
                && onboardingPhase == "firstMission");
        }

        public void RefreshEdgeExitAvailability()
        {
            Minimap?.SetEdgeExitAllowed(CurrentLocationHasEdgeExit);
        }

        public void SetCinematicActive(bool active)
        {
            if (_cinematicActive == active) return;
            _cinematicActive = active;
            ApplyOverlayInputState();
        }

        /// <summary>
        /// Большие окна мира исключают друг друга: открытое окно закрывает остальные.
        /// Вызов инвентаря с карты мира — это вызов другого окна, и карта уходит, а не
        /// копится стопкой под терминалом. Зовётся из Open() каждого окна, поэтому
        /// сам Close() ничего отсюда не дёргает — иначе была бы рекурсия.
        /// </summary>
        public static void FocusGameplayWindow(object opening)
        {
            RoaGameBootstrap active = Active;
            if (active == null) return;
            if (active.PipboyCanvas != null && !ReferenceEquals(active.PipboyCanvas, opening) && active.PipboyCanvas.IsOpen)
                active.PipboyCanvas.Close();
            if (active.MapWindow != null && !ReferenceEquals(active.MapWindow, opening) && active.MapWindow.IsOpen)
                active.MapWindow.Close();
            if (active.WorldOverview != null && !ReferenceEquals(active.WorldOverview, opening) && active.WorldOverview.IsOpen)
                active.WorldOverview.Close();
            if (active.WorkbenchCanvas != null && !ReferenceEquals(active.WorkbenchCanvas, opening) && active.WorkbenchCanvas.IsOpen)
                active.Inventory?.CloseWorkbench();
        }

        private bool AnyGameplayPanelOpen()
        {
            return (MapWindow != null && MapWindow.IsOpen)
                || (WorldOverview != null && WorldOverview.IsOpen)
                || (WorkbenchCanvas != null && WorkbenchCanvas.IsOpen)
                || (PipboyCanvas != null && PipboyCanvas.IsOpen)
                || (Inventory != null && Inventory.IsOpen)
                || (Pipboy != null && Pipboy.IsOpen)
                || (Interaction != null && Interaction.IsPanelOpen)
                || (Quickbar != null && Quickbar.IsRadialOpen);
        }

        private static void ApplySavedQuality()
        {
            string[] names = QualitySettings.names;
            if (names == null || names.Length == 0) return;
            int fallback = Application.isMobilePlatform ? Mathf.Min(2, names.Length - 1) : QualitySettings.GetQualityLevel();
            int selected = Mathf.Clamp(PlayerPrefs.GetInt(QualityPrefsKey, fallback), 0, names.Length - 1);
            QualitySettings.SetQualityLevel(selected, true);
        }

        private static void SetQualityPreset(int index)
        {
            string[] names = QualitySettings.names;
            if (names == null || names.Length == 0) return;
            index = Mathf.Clamp(index, 0, names.Length - 1);
            QualitySettings.SetQualityLevel(index, true);
            PlayerPrefs.SetInt(QualityPrefsKey, index);
            PlayerPrefs.Save();
        }

        private void BeginHudEdit()
        {
            _gameMenuOpen = false;
            _tutorialOpen = false;
            _graphicsOpen = false;
            RoaHudLayout.SetEditing(true);
            ApplyOverlayInputState();
        }

        private void EndHudEdit()
        {
            RoaHudLayout.SetEditing(false);
            ApplyOverlayInputState();
        }

        private IEnumerator AutoFlow()
        {
            Debug.Log("[ROA] Авто-вход: " + _login + " на " + BaseUrl);
            yield return StartCoroutine(DoLogin());

            if (_stage != Stage.PickCharacter)
            {
                Debug.LogError("[ROA] Авто-вход прерван на этапе " + _stage + ": " + _status);
                yield break;
            }

            if (_auth.Characters.Count > 0)
            {
                Debug.Log("[ROA] Вход существующим персонажем: " + _auth.Characters[0]);
                JoinExisting(_auth.Characters[0]);
            }
            else if (AutoCreateCharacter)
            {
                Debug.Log("[ROA] Персонажей нет — создаю нового.");
                _creator.PrepareAutomaticDefault();
                JoinNew();
            }
            else
            {
                Debug.LogWarning("[ROA] Персонажей нет, автосоздание выключено.");
            }
        }

        private void OnEnable()
        {
            if (Socket == null) return;
            Socket.OnJoined += HandleJoined;
            Socket.OnRejected += HandleRejected;
            Socket.OnDisconnected += HandleDisconnected;
            Socket.OnAuthoritativeSelf += HandleAuthoritativeSelf;
            Socket.OnWorldState += HandleWorldStateVisuals;
        }

        private void OnDisable()
        {
            RoaHudLayout.SetEditing(false);
            if (Socket == null) return;
            Socket.OnJoined -= HandleJoined;
            Socket.OnRejected -= HandleRejected;
            Socket.OnDisconnected -= HandleDisconnected;
            Socket.OnAuthoritativeSelf -= HandleAuthoritativeSelf;
            Socket.OnWorldState -= HandleWorldStateVisuals;
        }

        private void OnDestroy()
        {
            if (_characterPreview != null) _characterPreview.SetVisible(false);
            if (Active == this) Active = null;
        }

        #region Фасад для системных окон (RoaSystemCanvas): меню, графика, обучение, HUD

        public bool SystemCanvasDriven { get; set; }
        public bool GameMenuOpen { get { return _gameMenuOpen; } }
        public bool GraphicsOpen { get { return _graphicsOpen; } }
        public bool TutorialOpen { get { return _tutorialOpen; } }
        public bool GameMenuActionPending { get { return _gameMenuActionPending; } }
        public bool InGame { get { return _stage == Stage.InWorld; } }

        public void MenuOpenGameMenu(bool open) { SetGameMenuOpen(open); }
        public void MenuOpenGraphics(bool open) { SetGraphicsOpen(open); }
        public void MenuOpenTutorial(bool open) { SetTutorialOpen(open); }
        public void MenuRestartFirstRunCoach() { SetTutorialOpen(false); FirstRunCoach?.Restart(); }
        public void MenuBeginHudEdit() { BeginHudEdit(); }
        public void MenuEndHudEdit() { EndHudEdit(); }
        public void MenuResetHud() { RoaHudLayout.Reset(); _status = "Позиции HUD сброшены."; }
        public void MenuLogout() { if (InGame && !_gameMenuActionPending) StartCoroutine(DoLogoutInGame()); }
        public static void MenuSetQuality(int index) { SetQualityPreset(index); }
        public static string MenuQualityLabel(string name) { return QualityLabel(name); }

        #endregion

        #region Фасад для канва-экрана входа (RoaAuthCanvas)

        /// <summary>Канва рисует вход/выбор персонажа сама; IMGUI-панель этих этапов молчит.</summary>
        public bool AuthCanvasDriven { get; set; }

        /// <summary>Экран аккаунта виден на этапах до входа в мир (кроме редактора персонажа).</summary>
        public bool FrontendVisible
        {
            get
            {
                return _stage == Stage.NeedLogin || _stage == Stage.LoggingIn
                    || _stage == Stage.PickCharacter || _stage == Stage.Failed
                    || _stage == Stage.CreateCharacter;
            }
        }

        // Создание персонажа: данные в RoaCharacterCreator, превью в RoaCharacterPreview.
        public RoaCharacterCreator Creator { get { return _creator; } }
        public RoaCharacterPreview CharacterPreview { get { return _characterPreview; } }
        public string NewCharacterName { get { return _newCharacterName; } set { _newCharacterName = value ?? string.Empty; } }
        public bool CreatorBusy { get { return _stage == Stage.Joining || _stage == Stage.LoadingLocation; } }

        public void CreatorSubmit()
        {
            if (_stage != Stage.CreateCharacter) return;
            JoinNew();
        }

        public void CreatorCancel()
        {
            if (_stage != Stage.CreateCharacter) return;
            _status = "Создание отменено.";
            _stage = Stage.PickCharacter;
        }

        /// <summary>Шаг как в web setAuthStep: login / register / reset / resetConfirm / select / connecting.</summary>
        public string AuthStep
        {
            get
            {
                if (_stage == Stage.LoggingIn) return "connecting";
                if (_stage == Stage.PickCharacter) return "select";
                if (_stage == Stage.CreateCharacter) return "creator";
                switch (_authPanel)
                {
                    case AuthPanel.Register: return "register";
                    case AuthPanel.ResetRequest: return "reset";
                    case AuthPanel.ResetConfirm: return "resetConfirm";
                    default: return "login";
                }
            }
        }

        public bool AuthBusy { get { return _stage == Stage.LoggingIn; } }
        public bool AuthFailed { get { return _stage == Stage.Failed; } }
        public string AuthLogin { get { return _login; } set { _login = value ?? string.Empty; } }
        public string AuthPassword { get { return _password; } set { _password = value ?? string.Empty; } }
        public string AuthEmail { get { return _email; } set { _email = value ?? string.Empty; } }
        public string AuthPasswordConfirm { get { return _passwordConfirm; } set { _passwordConfirm = value ?? string.Empty; } }
        public string AuthResetToken { get { return _resetToken; } set { _resetToken = value ?? string.Empty; } }
        public string AuthNewPassword { get { return _newPassword; } set { _newPassword = value ?? string.Empty; } }
        public string AuthServerUrl { get { return BaseUrl; } set { BaseUrl = value ?? string.Empty; } }
        public IReadOnlyList<CharacterSummary> AuthCharacters
        {
            get { return _auth != null ? _auth.Characters : new List<CharacterSummary>(); }
        }

        public void AuthShowPanel(string step)
        {
            _status = string.Empty;
            _password = string.Empty;
            _passwordConfirm = string.Empty;
            if (_stage == Stage.Failed) _stage = Stage.NeedLogin;
            switch (step)
            {
                case "register": _authPanel = AuthPanel.Register; break;
                case "reset": _authPanel = AuthPanel.ResetRequest; break;
                case "resetConfirm": _authPanel = AuthPanel.ResetConfirm; break;
                default: _authPanel = AuthPanel.Login; break;
            }
        }

        public void AuthSubmitLogin()
        {
            if (string.IsNullOrWhiteSpace(_login) || string.IsNullOrEmpty(_password) || AuthBusy) return;
            RecreateAuthClient();
            StartCoroutine(DoLogin());
        }

        /// <summary>
        /// «Начать сразу» web (handleQuickStart, 01:1018): гостевой вход по
        /// deviceId, затем либо последний персонаж гостя, либо быстрый персонаж.
        /// </summary>
        public void AuthQuickStart()
        {
            if (AuthBusy || _stage == Stage.PickCharacter || _stage == Stage.CreateCharacter) return;
            RecreateAuthClient();
            StartCoroutine(DoQuickStart());
        }

        private IEnumerator DoQuickStart()
        {
            _stage = Stage.LoggingIn;
            _status = "Создаю гостевой профиль и готовлю пустошь...";
            bool done = false, ok = false;
            yield return StartCoroutine(_auth.Guest((success, error) =>
            {
                done = true;
                ok = success;
                if (!success)
                {
                    _stage = Stage.Failed;
                    _status = error ?? "Не удалось начать игру без регистрации.";
                    Debug.LogError("[ROA] Быстрый старт не удался: " + _status);
                }
            }));
            if (!done) { _stage = Stage.Failed; _status = "Ответ на гостевой вход не получен."; yield break; }
            if (!ok) yield break;

            _password = string.Empty;
            _login = "guest";
            if (_auth.Characters.Count > 0)
            {
                // Как web: «Продолжаю последнюю вылазку...» — первый персонаж гостя.
                _stage = Stage.PickCharacter;
                _status = "Продолжаю последнюю вылазку...";
                AuthPlayCharacter(_auth.Characters[0].CharacterId);
                yield break;
            }

            // Гость без персонажей — быстрый персонаж «Странник» по web-шаблону.
            _creator.PrepareQuickStart();
            _newCharacterName = "Странник";
            _stage = Stage.CreateCharacter;
            JoinNew();
        }

        public void AuthSubmitRegister()
        {
            bool can = _login.Trim().Length >= 3 && !string.IsNullOrWhiteSpace(_email)
                && _password.Length >= 8 && _password == _passwordConfirm;
            if (!can)
            {
                _status = _password != _passwordConfirm ? "Пароли не совпадают."
                    : "Нужны логин от 3 символов, email и пароль от 8 символов.";
                return;
            }
            RecreateAuthClient();
            StartCoroutine(DoRegister());
        }

        public void AuthSubmitResetRequest()
        {
            if (string.IsNullOrWhiteSpace(_email)) { _status = "Введите email аккаунта."; return; }
            RecreateAuthClient();
            StartCoroutine(DoResetRequest());
        }

        public void AuthSubmitResetConfirm()
        {
            bool can = !string.IsNullOrWhiteSpace(_login) && !string.IsNullOrWhiteSpace(_resetToken)
                && _newPassword.Length >= 8 && _newPassword == _passwordConfirm;
            if (!can)
            {
                _status = _newPassword != _passwordConfirm ? "Пароли не совпадают."
                    : "Нужны логин, код и новый пароль от 8 символов.";
                return;
            }
            RecreateAuthClient();
            StartCoroutine(DoResetConfirm());
        }

        public void AuthPlayCharacter(string characterId)
        {
            if (_stage != Stage.PickCharacter) return;
            foreach (CharacterSummary character in AuthCharacters)
                if (character.CharacterId == characterId) { JoinExisting(character); return; }
        }

        public void AuthDeleteCharacter(string characterId)
        {
            if (_stage != Stage.PickCharacter || string.IsNullOrEmpty(characterId)) return;
            StartCoroutine(DoDeleteCharacter(characterId));
        }

        public void AuthOpenCreator()
        {
            if (_stage != Stage.PickCharacter) return;
            _creator.Reset();
            _creatorScroll = Vector2.zero;
            _newCharacterName = "Странник";
            _status = string.Empty;
            _stage = Stage.CreateCharacter;
        }

        /// <summary>«Сменить персонажа» из игрового меню — для канвы и автоматизации.</summary>
        public void ReturnToCharacterPicker()
        {
            if (_stage != Stage.InWorld) return;
            StartCoroutine(DoReturnToCharacterPicker());
        }

        public void AuthLogout()
        {
            if (_stage != Stage.PickCharacter) return;
            StartCoroutine(DoLogoutFromPicker());
        }

        /// <summary>Имя локации для карточки персонажа — как serverCharacterLocationLabel в web.</summary>
        public string AuthLocationLabel(string locationId)
        {
            string id = string.IsNullOrEmpty(locationId) ? "settlement" : locationId;
            LocationDefinition definition = Loader != null ? Loader.GetDefinition(id) : null;
            if (definition != null && !string.IsNullOrEmpty(definition.Name)) return definition.Name;
            if (!_catalogRequested && Loader != null && !string.IsNullOrEmpty(BaseUrl))
            {
                _catalogRequested = true;
                Loader.BaseUrl = BaseUrl;
                StartCoroutine(Loader.FetchLocationCatalog((ok, error) =>
                {
                    if (ok) AuthCatalogVersion++; else _catalogRequested = false;
                }));
            }
            return id;
        }

        private bool _catalogRequested;

        /// <summary>Растёт при загрузке каталога локаций — канва перестраивает карточки.</summary>
        public int AuthCatalogVersion { get; private set; }

        /// <summary>Растёт после принятия общего каталога создания, навыков и перков.</summary>
        public int ProgressionCatalogVersion { get; private set; }

        #endregion

        private void HandleWorldStateVisuals(JObject state)
        {
            Anomalies?.ApplyWorldState(state);
            SettlementLifePresentation?.ApplyWorldState(state);
            if (!(state?["map"] is JArray map)) return;
            Minimap?.SetWorldMap(map);
            Fog?.ApplyWorldMap(map);
        }

        #region Вход

        private IEnumerator DoLogin()
        {
            _stage = Stage.LoggingIn;
            _status = "Вход...";

            bool done = false;
            yield return StartCoroutine(_auth.Login(_login, _password, (ok, error) =>
            {
                done = true;
                if (!ok)
                {
                    _stage = Stage.Failed;
                    _status = error;

                    // Провал входа обязан попадать в консоль: IMGUI-панель видна
                    // только человеку у экрана, а диагностировать надо и по логам.
                    Debug.LogError("[ROA] Вход не удался: " + error);
                    return;
                }

                _password = string.Empty;
                _status = "Персонажей на аккаунте: " + _auth.Characters.Count;
                _stage = Stage.PickCharacter;
                Debug.Log("[ROA] Вход выполнен. " + _status);
            }));

            if (!done)
            {
                _stage = Stage.Failed;
                _status = "Ответ на вход не получен.";
                Debug.LogError("[ROA] " + _status);
            }
        }

        private IEnumerator DoAuthHeartbeat()
        {
            _authHeartbeatPending = true;
            bool ok = false;
            string failure = null;
            yield return StartCoroutine(_auth.Heartbeat((success, error) =>
            {
                ok = success;
                failure = error;
            }));
            _authHeartbeatPending = false;
            _nextAuthHeartbeatAt = Time.unscaledTime + AuthHeartbeatDelay(ok);
            if (ok)
            {
                _authHeartbeatWarningShown = false;
            }
            else if (!_authHeartbeatWarningShown && !string.IsNullOrEmpty(failure))
            {
                _authHeartbeatWarningShown = true;
                Debug.LogWarning("[ROA] Heartbeat аккаунта: " + failure);
            }
        }

        private void RecreateAuthClient()
        {
            ActiveBaseUrl = BaseUrl;
            if (Loader != null) Loader.BaseUrl = BaseUrl;
            if (RemotePlayers != null) RemotePlayers.BaseUrl = BaseUrl;
            if (Enemies != null) Enemies.BaseUrl = BaseUrl;
            _auth = new RoaAuthClient(BaseUrl);
            _nextAuthHeartbeatAt = Time.unscaledTime + AuthHeartbeatDelay(true);
            _authHeartbeatPending = false;
            _authHeartbeatWarningShown = false;
            Quickbar?.Configure(_auth, Socket, Inventory, Combat, MobileControls, Interaction);
        }

        private IEnumerator DoRegister()
        {
            _stage = Stage.LoggingIn;
            _status = "Регистрация...";
            bool completed = false;
            yield return StartCoroutine(_auth.Register(_login.Trim(), _email.Trim(), _password, (ok, error) =>
            {
                completed = true;
                if (!ok)
                {
                    _stage = Stage.Failed;
                    _status = error;
                    return;
                }

                _password = string.Empty;
                _passwordConfirm = string.Empty;
                _deleteCandidateId = string.Empty;
                _status = "Аккаунт создан. Создайте первого персонажа.";
                _stage = Stage.PickCharacter;
            }));
            if (!completed)
            {
                _stage = Stage.Failed;
                _status = "Ответ на регистрацию не получен.";
            }
        }

        private IEnumerator DoResetRequest()
        {
            _stage = Stage.LoggingIn;
            _status = "Запрос кода восстановления...";
            bool completed = false;
            yield return StartCoroutine(_auth.RequestPasswordReset(_email.Trim(), (ok, error) =>
            {
                completed = true;
                _stage = ok ? Stage.NeedLogin : Stage.Failed;
                _status = ok
                    ? "Если адрес зарегистрирован, код восстановления отправлен. Введите его ниже."
                    : error;
                if (ok) _authPanel = AuthPanel.ResetConfirm;
            }));
            if (!completed)
            {
                _stage = Stage.Failed;
                _status = "Ответ на запрос восстановления не получен.";
            }
        }

        private IEnumerator DoResetConfirm()
        {
            _stage = Stage.LoggingIn;
            _status = "Смена пароля...";
            bool completed = false;
            yield return StartCoroutine(_auth.ConfirmPasswordReset(_login.Trim(), _resetToken.Trim(), _newPassword,
                (ok, error) =>
                {
                    completed = true;
                    _stage = ok ? Stage.NeedLogin : Stage.Failed;
                    _status = ok ? "Пароль изменён. Теперь можно войти." : error;
                    if (!ok) return;
                    _authPanel = AuthPanel.Login;
                    _password = string.Empty;
                    _passwordConfirm = string.Empty;
                    _newPassword = string.Empty;
                    _resetToken = string.Empty;
                }));
            if (!completed)
            {
                _stage = Stage.Failed;
                _status = "Ответ на смену пароля не получен.";
            }
        }

        private IEnumerator DoDeleteCharacter(string characterId)
        {
            _stage = Stage.LoggingIn;
            _status = "Удаление персонажа...";
            bool deleted = false;
            string failure = null;
            yield return StartCoroutine(_auth.DeleteCharacter(characterId, (ok, error) =>
            {
                deleted = ok;
                failure = error;
            }));
            if (!deleted)
            {
                _stage = Stage.PickCharacter;
                _status = failure ?? "Персонаж не удалён.";
                yield break;
            }

            bool refreshed = false;
            yield return StartCoroutine(_auth.RefreshCharacters((ok, error) =>
            {
                refreshed = ok;
                failure = error;
            }));
            _deleteCandidateId = string.Empty;
            _deleteConfirmation = string.Empty;
            _stage = Stage.PickCharacter;
            _status = refreshed ? "Персонаж удалён." : (failure ?? "Список персонажей не обновлён.");
        }

        private IEnumerator DoLogoutFromPicker()
        {
            _stage = Stage.LoggingIn;
            _status = "Выход из аккаунта...";
            yield return StartCoroutine(_auth.Logout());
            _password = string.Empty;
            _deleteCandidateId = string.Empty;
            _deleteConfirmation = string.Empty;
            _authPanel = AuthPanel.Login;
            _stage = Stage.NeedLogin;
            _status = "Вы вышли из аккаунта.";
        }

        private IEnumerator DoReturnToCharacterPicker()
        {
            if (_gameMenuActionPending) yield break;
            _gameMenuActionPending = true;
            SetGameMenuOpen(false);
            _stage = Stage.LoggingIn;
            _status = "Смена персонажа...";
            Socket?.DisconnectForRetry();
            ClearClientWorldForAccountScreen();

            yield return new WaitForSecondsRealtime(0.15f);
            bool refreshed = false;
            string failure = null;
            yield return StartCoroutine(_auth.RefreshCharacters((ok, error) =>
            {
                refreshed = ok;
                failure = error;
            }));
            _stage = Stage.PickCharacter;
            _status = refreshed ? "Выберите персонажа." : (failure ?? "Список персонажей не обновлён.");
            _gameMenuActionPending = false;
        }

        private IEnumerator DoLogoutInGame()
        {
            if (_gameMenuActionPending) yield break;
            _gameMenuActionPending = true;
            SetGameMenuOpen(false);
            _stage = Stage.LoggingIn;
            _status = "Выход из аккаунта...";

            yield return StartCoroutine(_auth.Logout());
            Socket?.DisconnectForRetry();
            ClearClientWorldForAccountScreen();
            _password = string.Empty;
            _deleteCandidateId = string.Empty;
            _deleteConfirmation = string.Empty;
            _authPanel = AuthPanel.Login;
            _stage = Stage.NeedLogin;
            _status = "Вы вышли из аккаунта.";
            _gameMenuActionPending = false;
        }

        private void ClearClientWorldForAccountScreen()
        {
            _loadingStartup = true;
            RoaHudLayout.SetEditing(false);
            Inventory?.CloseWorkbench();
            SetGraphicsOpen(false);
            SetTutorialOpen(false);
            ClearLocalWorld();
            Quickbar?.SetWorldActive(false);
            PipboyCanvas?.Close();
            MapWindow?.Close();
            WorldOverview?.Close();
            if (Inventory != null && Inventory.IsOpen) Inventory.Toggle();
            if (Pipboy != null && Pipboy.IsOpen) Pipboy.Toggle();
        }

        private void JoinExisting(CharacterSummary character)
        {
            _joiningNewCharacter = false;
            if (string.IsNullOrEmpty(character.CharacterId))
            {
                // Пустой id сервер отвергнет как «Не выбран персонаж», и причина
                // будет выглядеть загадочно. Ловим здесь, где видно источник.
                _stage = Stage.Failed;
                _status = "У персонажа '" + character.Name + "' пустой id — список персонажей разобран неверно.";
                Debug.LogError("[ROA] " + _status);
                return;
            }

            _stage = Stage.Joining;
            _status = "Вход в мир персонажем " + character.Name + "...";
            Socket.Connect(BaseUrl, _auth, character.CharacterId);
        }

        private void JoinNew()
        {
            if (!_creator.Ready(_newCharacterName))
            {
                _stage = Stage.CreateCharacter;
                _status = "Завершите имя, характеристики, профильный навык и стартовый перк.";
                return;
            }

            _joiningNewCharacter = true;
            _stage = Stage.Joining;
            _status = "Создание персонажа...";

            // Сервер сам проверит уникальность и при коллизии выдаст свой id.
            string characterId = "char_" + Guid.NewGuid().ToString("N").Substring(0, 16);

            Socket.ConnectWithNewCharacter(BaseUrl, _auth, characterId, _newCharacterName.Trim(),
                _creator.Appearance,
                _creator.BuildSpecial(),
                _creator.TaggedSkills,
                _creator.SelectedTraits);
        }

        #endregion

        #region Реакция на сервер

        private void HandleJoined(JoinAck ack)
        {
            _joiningNewCharacter = false;
            // Мир — граф зон: сервер всегда сажает персонажа в комнату. Без комнаты
            // не придут ни playerState, ни enemyFrame, и сцена осталась бы пустой.
            if (string.IsNullOrEmpty(ack.RoomId))
            {
                _stage = Stage.Failed;
                _status = "Сервер не выдал персонажу комнату.";
                Debug.LogError("[ROA] " + _status);
                return;
            }

            if (_player != null) _player.SetActive(true);
            if (Fog != null) Fog.enabled = true;

            _status = "Вошли в " + ack.LocationId + " (комната '" + ack.RoomId + "')";
            Debug.Log("[ROA] " + _status + ", lease=" + ack.CharacterLeaseId);

            _stage = Stage.LoadingLocation;
            StartCoroutine(EnterWorld(ack));
        }

        /// <summary>Убрать локальную сцену и её сущности (выход к экрану персонажей).</summary>
        private void ClearLocalWorld()
        {
            if (Lighting != null)
            {
                Lighting.SetLocalWorldActive(false);
                Lighting.SetLocation(null, null);
            }
            SettlementLifePresentation?.SetLocalWorldActive(false);
            Anomalies?.SetLocalWorldActive(false);
            if (Minimap != null)
            {
                Minimap.SetLocation(null);
                Minimap.SetPlayer(null);
            }
            if (RoofCutaway != null)
            {
                RoofCutaway.SetPlayer(null);
                RoofCutaway.Clear();
            }
            if (CombatFx != null) CombatFx.Clear();
            if (MobileControls != null)
            {
                MobileControls.SetPlayer(null);
                MobileControls.Clear();
            }
            if (Quickbar != null) Quickbar.SetWorldActive(false);
            if (Loader != null) Loader.ClearLocation();
            if (RemotePlayers != null) RemotePlayers.Clear();
            if (Enemies != null) Enemies.Clear();
            if (GroundItems != null) GroundItems.Clear();
            if (Interaction != null)
            {
                Interaction.SetPlayer(null);
                Interaction.ClearWorld();
            }
            if (Pipboy != null) Pipboy.SetPlayer(null);
            if (ActorNameplates != null) ActorNameplates.SetPlayer(null);
            if (_player != null) _player.SetActive(false);
            if (Fog != null)
            {
                Fog.Observer = null;
                Fog.enabled = false;
            }
        }

        private void HandleRejected(string error)
        {
            if (_joiningNewCharacter)
            {
                _joiningNewCharacter = false;
                Socket?.DisconnectForRetry();
                _stage = Stage.CreateCharacter;
                _status = "Сервер отклонил создание: " + error;
                Debug.LogError("[ROA] " + _status);
                return;
            }
            _stage = Stage.Failed;
            _status = "Сервер отклонил вход: " + error;
            Debug.LogError("[ROA] " + _status);
        }

        private void HandleDisconnected(string reason)
        {
            if (_stage == Stage.Failed) return;
            _status = "Соединение потеряно: " + reason;
        }

        // --- Экран загрузки локации (#location-loading-screen web, 02c:394) ---

        private string _loadingTitle = string.Empty;
        private string _loadingStep = string.Empty;
        private float _loadingProgress;
        private bool _loadingStartup = true;   // первый вход после экрана персонажей — режим startup web
        private float _loadingShownAt;
        private const float LoadingMinVisible = 0.36f; // LOCATION_LOADING_MIN_VISIBLE_MS

        /// <summary>Экран загрузки виден, пока строится локация или карта (и не меньше 360 мс).</summary>
        public bool LoadingVisible
        {
            get
            {
                bool loading = _stage == Stage.Joining || _stage == Stage.LoadingLocation;
                return loading || (Time.unscaledTime - _loadingShownAt < LoadingMinVisible && _loadingShownAt > 0f && _stage == Stage.InWorld);
            }
        }
        public bool LoadingStartup { get { return _loadingStartup; } }
        public bool LoadingCanvasDriven { get; set; }
        public string LoadingKicker { get { return _loadingStartup ? "Вход в игру" : "Переход между локациями"; } }
        public string LoadingTitle { get { return _loadingTitle; } }
        public string LoadingSubtitle { get { return "Подготовка мира..."; } }
        public string LoadingStep
        {
            get
            {
                if (Loader != null && Loader.IsLoading && !string.IsNullOrEmpty(Loader.StepText)) return Loader.StepText;
                return _loadingStep;
            }
        }
        public float LoadingProgress
        {
            get
            {
                // Сборка ассетов занимает полосу 18..58%, как в web.
                if (Loader != null && Loader.IsLoading) return Mathf.Lerp(0.18f, 0.58f, Loader.Progress);
                return _loadingProgress;
            }
        }
        public string LoadingHint
        {
            get
            {
                return _loadingStartup
                    ? "Мир станет доступен после сборки окружения, прогрева материалов и стабилизации камеры."
                    : "Мир станет доступен после загрузки геометрии, текстур, теней и общей локации.";
            }
        }

        private void SetLoading(string step, float progress)
        {
            _loadingStep = step;
            _loadingProgress = progress;
        }

        private IEnumerator EnterWorld(JoinAck ack)
        {
            LocationDefinition known = Loader.GetDefinition(ack.LocationId);
            _loadingTitle = known != null && !string.IsNullOrEmpty(known.Name) ? known.Name : ack.LocationId;
            _loadingShownAt = Time.unscaledTime;
            SetLoading(_loadingStartup ? "Подготовка персонажа..." : "Подготовка перехода...", 0.04f);
            if (_player != null) _player.SetActive(true);
            if (Fog != null) Fog.enabled = true;

            if (Loader.GetDefinition(ack.LocationId) == null)
            {
                // Зона мира не входит в общий каталог — сначала она одна, по id.
                bool fetched = false;
                yield return StartCoroutine(Loader.FetchDefinition(ack.LocationId, (success, error) => fetched = success));
                if (!fetched)
                {
                    bool ok = false;
                    yield return StartCoroutine(Loader.FetchLocationCatalog((success, error) =>
                    {
                        ok = success;
                        if (!success) _status = "Каталог локаций не загружен: " + error;
                    }));

                    if (!ok)
                    {
                        _stage = Stage.Failed;
                        yield break;
                    }
                }
            }

            if (ack.WorldState == null && !string.IsNullOrEmpty(ack.RoomId))
            {
                _status = "Повторный запрос состояния локации...";
                bool completed = false;
                JObject recovered = null;
                Socket.RequestWorldState("serverInitFallback", state =>
                {
                    recovered = state;
                    completed = true;
                });

                float deadline = Time.realtimeSinceStartup + 5f;
                while (!completed && Time.realtimeSinceStartup < deadline) yield return null;
                if (recovered == null)
                {
                    _stage = Stage.Failed;
                    _status = "Сервер не вернул стартовое состояние локации.";
                    yield break;
                }
                ack.WorldState = recovered;
            }

            // Комната точки мира (событие, бой, встреча в угодьях) выводит краем в
            // зону своей точки: эту зону присылает состояние мира.
            LocationDefinition entered = Loader.GetDefinition(ack.LocationId);
            if (entered != null)
                entered.RoomParentZone = ack.WorldState?["parentZone"] is JObject roomZone
                    ? roomZone.ToObject<ParentZoneInfo>()
                    : null;

            _status = "Загрузка локации " + ack.LocationId + "...";
            known = Loader.GetDefinition(ack.LocationId);
            if (known != null && !string.IsNullOrEmpty(known.Name)) _loadingTitle = known.Name;
            SetLoading("Подготавливаю графику и модели мира...", 0.12f);

            yield return StartCoroutine(Loader.LoadLocation(ack.LocationId,
                ack.WorldState?["map"] as JArray, (ok, summary) =>
            {
                _status = ok ? summary : "Локация не загрузилась: " + summary;
                if (!ok) _stage = Stage.Failed;
            }));

            if (_stage == Stage.Failed) { SetLoading("Ошибка загрузки мира.", 1f); yield break; }
            SetLoading("Прогреваю крышу, тени и шейдеры...", 0.78f);
            yield return null;

            // Карта препятствий строится по авторской разметке локации — до
            // спавна, чтобы первый же кадр в мире был с правильной видимостью.
            LocationDefinition location = Loader.GetDefinition(ack.LocationId);
            if (Lighting != null)
            {
                Lighting.SetLocation(location, Loader.CurrentGroundRenderer);
                Lighting.SetLocalWorldActive(true);
            }
            SettlementLifePresentation?.SetLocalWorldActive(true);
            Anomalies?.SetLocalWorldActive(true);
            if (Minimap != null)
            {
                Minimap.SetLocation(location, ack.WorldState?["map"] as JArray);
                RefreshEdgeExitAvailability();
            }
            if (Fog != null) Fog.Build(location, ack.WorldState?["map"] as JArray);
            if (Interaction != null) Interaction.SetLocation(location);
            if (RoofCutaway != null) RoofCutaway.Build(location, Loader);
            Anomalies?.ApplyWorldState(ack.WorldState);
            SettlementLifePresentation?.ApplyWorldState(ack.WorldState);

            SetLoading("Синхронизирую локацию с сервером...", 0.9f);
            SpawnPlayer(ack);
            SetLoading("Готовлю первый кадр мира...", 0.97f);
            yield return null;
            if (RoofCutaway != null) RoofCutaway.SetPlayer(_controller);
            if (MobileControls != null) MobileControls.SetPlayer(_controller);
            if (Quickbar != null) Quickbar.SetWorldActive(true);
            RoaHudLayout.SetEditing(false);
            SetGraphicsOpen(false);
            SetTutorialOpen(false);
            SetGameMenuOpen(false);
            SetLoading("Мир готов.", 1f);
            _loadingShownAt = Time.unscaledTime; // минимум 360 мс показа готового экрана
            _loadingStartup = false;
            _stage = Stage.InWorld;
        }

        /// <summary>
        /// Модель, затем оружие: хвату нужны уже созданные кости.
        /// Оружие берётся из авторитетного combat — того же поля, что показывает
        /// HUD web-клиента (serverCombatAck, server.js:8413).
        /// </summary>
        private async System.Threading.Tasks.Task LoadPlayerVisuals(RoaCharacterView view,
                                                                    JObject appearance, string weaponId,
                                                                    JObject equipment)
        {
            await view.Load(BaseUrl, appearance);
            await System.Threading.Tasks.Task.WhenAll(
                view.EquipWeapon(BaseUrl, weaponId),
                view.EquipItems(BaseUrl, equipment));
        }

        /// <summary>Достать id оружия из блока combat серверного ответа.</summary>
        private static string WeaponIdFrom(JObject combat)
        {
            return combat != null ? (combat["weapon"]?.ToString() ?? string.Empty) : string.Empty;
        }

        /// <summary>
        /// Базовый id предмета из runtime-ключа. Портирует serverBaseItemId()
        /// (server.js:4753): экземпляры именуются "ui_{base}_{a}_{b}", всё
        /// остальное уже является базовым id.
        /// </summary>
        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId)) return string.Empty;
            if (!runtimeId.StartsWith("ui_")) return runtimeId;

            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }

        /// <summary>
        /// Смена оружия по авторитетному состоянию. В authoritativePlayerState нет
        /// блока combat, но есть equipmentRuntime — из него и берём слот оружия.
        /// </summary>
        private void HandleAuthoritativeSelf(JObject payload)
        {
            if (payload == null) return;
            Audio?.ApplyArtifactEffects(payload);

            // Контроллер создаётся активным, а Socket назначается ему уже после
            // OnEnable. Поэтому bootstrap явно передаёт каждую серверную сверку:
            // так лечение/травма/смена ботинок немедленно меняют скорость и обзор.
            if (_controller != null) _controller.ApplySpecial(payload);
            if (_playerView == null) return;

            JObject equipment = EquipmentFromSelf(payload);
            _ = _playerView.EquipItems(BaseUrl, equipment);

            // Пока тело грузится, оружие наденет LoadPlayerVisuals: EquipWeapon
            // до готовности модели ничего не делает, и «смена» была бы ложной.
            if (!_playerView.Ready) return;

            string weaponId = equipment["weapon"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(weaponId)) return;
            if (weaponId == _playerView.WeaponId || weaponId == _playerView.WeaponLoadingId) return;

            Debug.Log("[ROA] Смена оружия: " + _playerView.WeaponId + " -> " + weaponId);
            _ = _playerView.EquipWeapon(BaseUrl, weaponId);
        }

        private static JObject EquipmentFromSelf(JObject self)
        {
            JObject source = self?["equipmentRuntime"] as JObject
                ?? self?["equipment"] as JObject
                ?? new JObject();
            var result = new JObject();
            foreach (string slot in new[] { "weapon", "offhand", "armor", "helmet", "boots", "backpack" })
                result[slot] = BaseItemId(source[slot]?.ToString() ?? string.Empty);
            if (string.IsNullOrEmpty(result["weapon"]?.ToString())) result["weapon"] = "fists";
            return result;
        }

        private void SpawnPlayer(JoinAck ack)
        {
            if (_player == null)
            {
                _player = new GameObject("LocalPlayer");

                var body = _player.AddComponent<CharacterController>();
                body.height = PlayerHeight;
                RoaPlayerController.ConfigureAuthoritativeCollision(body);
                body.center = Vector3.zero;

                // Модель — дочерний объект: её начало координат в ступнях,
                // а трансформ игрока — в центре капсулы контроллера.
                var presentationGo = new GameObject("NetworkPresentation");
                presentationGo.transform.SetParent(_player.transform, false);

                var viewGo = new GameObject("View");
                viewGo.transform.SetParent(presentationGo.transform, false);
                viewGo.transform.localPosition = new Vector3(0f, -PlayerHeight * 0.5f, 0f);

                var view = viewGo.AddComponent<RoaCharacterView>();

                _controller = _player.AddComponent<RoaPlayerController>();
                _controller.Socket = Socket;
                _controller.Camera = CameraRig;
                _controller.View = view;
                _controller.PresentationRoot = presentationGo.transform;
                _controller.Pipboy = Pipboy;
                _controller.Inventory = Inventory;
                _controller.Audio = Audio;

                // Бой и подбор знают о персонаже только после спавна: до входа
                // в мир стрелять не из чего и подбирать некому.
                if (Combat != null) Combat.Player = _controller;
                if (GroundItems != null) GroundItems.Player = _controller;
                if (Interaction != null) Interaction.SetPlayer(_controller);
                if (Pipboy != null) Pipboy.SetPlayer(_controller);
                if (ActorNameplates != null) ActorNameplates.SetPlayer(_controller);
                if (Fog != null) Fog.Observer = _controller;
                if (PipboyCanvas != null) PipboyCanvas.Player = _controller;
                if (MapWindow != null) MapWindow.Player = _controller;
                if (Minimap != null) Minimap.SetPlayer(_controller);

                JObject appearance = ack.Self != null ? ack.Self["appearance"] as JObject : null;
                _playerView = view;
                _ = LoadPlayerVisuals(view, appearance, WeaponIdFrom(ack.Combat), EquipmentFromSelf(ack.Self));
            }
            else if (ack.Self != null)
            {
                HandleAuthoritativeSelf(ack.Self);
            }

            // После смены персонажа объект игрока переиспользуется,
            // но Observer был снят при очистке локальной сцены.
            if (_controller != null)
            {
                _controller.Pipboy = Pipboy;
                _controller.Inventory = Inventory;
                _controller.Audio = Audio;
            }
            if (Fog != null) Fog.Observer = _controller;
            if (Interaction != null) Interaction.SetPlayer(_controller);
            if (Pipboy != null) Pipboy.SetPlayer(_controller);
            if (ActorNameplates != null) ActorNameplates.SetPlayer(_controller);
            if (Minimap != null) Minimap.SetPlayer(_controller);
            if (Enemies != null) Enemies.SetLocalPlayer(_controller);
            if (Vehicles != null)
            {
                Vehicles.SetBaseUrl(BaseUrl);
                Vehicles.SetPlayer(_controller);
            }

            // Скорость зависит от SPECIAL: без этого персонаж бежал бы со скоростью
            // по умолчанию, и походка разошлась бы с web-клиентом.
            _controller.ApplySpecial(ack.Self);

            Vector3 spawn = RoaCoords.ToUnity(ack.X, ack.Z);
            spawn.y = PlayerHeight * 0.5f + 0.1f;
            bool spawnAdjusted = _controller.TeleportToSafeSpawn(spawn);
            Vector3 placed = _controller.transform.position;
            if (spawnAdjusted)
                Debug.LogWarning("[ROA] Safe spawn adjusted: " + spawn + " -> " + placed + ".");

            if (CameraRig != null)
            {
                CameraRig.Target = _player.transform;
                CameraRig.SnapToTarget();
            }

            Debug.Log("[ROA] Игрок поставлен в " + placed + " (сервер: x=" + ack.X + " z=" + ack.Z + ")");
        }

        #endregion

        #region IMGUI

        private static string QualityLabel(string name)
        {
            if (name == "Very Low") return "Очень низкое";
            if (name == "Low") return "Низкое";
            if (name == "Medium") return "Среднее";
            if (name == "High") return "Высокое";
            if (name == "Very High") return "Очень высокое";
            if (name == "Ultra") return "Ультра";
            return name;
        }

        #endregion
    }
}
