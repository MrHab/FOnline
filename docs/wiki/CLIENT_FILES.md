# Файлы Unity-клиента

Игровой клиент — Unity-проект `unity-client/` (Unity **6000.5.8f1**, URP
17.5.0). Код лежит в `Assets/Scripts/` (~55 тысяч строк C#) и разделён на три
пространства: `Net/` (сеть), `World/` (мир и координаты) и `Game/` (игровой
слой и UI). Редакторские пробы и генераторы — в `Assets/Editor/`.

Сцены: `Assets/Scenes/Wasteland.unity` (локальные локации, точка входа) и
`Assets/Scenes/GlobalMapAuthored.unity` (авторская глобальная карта).

## Пакеты

`Packages/manifest.json` содержит только официальные пакеты Unity плюс
локальный пакет моделей:

| Пакет | Зачем |
|---|---|
| `com.unity.cloud.gltfast` | загрузка тех же GLB, что у сервера/legacy, без конвертации |
| `com.unity.nuget.newtonsoft-json` | разбор вложенных объектов протокола |
| `com.unity.render-pipelines.universal` | URP |
| `com.unity.inputsystem` | ввод |
| `com.unity.postprocessing` | пост-обработка |
| `com.realmofashes.models` | `file:../public/assets/models` — общий каталог GLB как локальный пакет |
| `com.unity.ai.assistant` | Unity MCP — доступ агента к редактору |

Socket.IO реализован собственным кодом, сторонних git-зависимостей нет.

## Сетевой слой (`Assets/Scripts/Net/`)

| Файл | Назначение |
|---|---|
| `RoaAuthClient.cs` | REST: вход, регистрация, гостевой старт, восстановление пароля, персонажи, heartbeat, заголовки сессии; `deviceId` в `PlayerPrefs` |
| `RoaProtocol.cs` | C#-модели событий Socket.IO |
| `RoaSocketClient.cs` | игровой слой: join/reconnect-FSM, RTT, guard по `roomId`/lease и маршалинг в главный поток |
| `SocketIo/RoaSocketIoConnection.cs` | Engine.IO v4 / Socket.IO v5 (протокол `socket.io@4.7.5`) |
| `SocketIo/RoaWebSocketTransport.cs` | транспорты: `ClientWebSocket` (Standalone) и мост к браузерному WebSocket (WebGL) |

WebGL-мост живёт в `Assets/Plugins/WebGL/RoaWebSocket.jslib`; протокольный и
игровой код при смене транспорта не меняются.

## Мир (`Assets/Scripts/World/`)

| Файл | Назначение |
|---|---|
| `RoaCoords.cs` | **единственное** место преобразования координат/углов Three.js ↔ Unity |
| `RoaLocationData.cs` | модель `data/locations/*.json` (`realm.location.v1`) |
| `RoaLocationLoader.cs` | сборка сцены из JSON/GLB, точный collider-каталог, детерминированные модели динамических точек |
| `RoaLocalTerrain.cs` | земля из авторитетной `worldState.map`, рельеф, вода, физика тайлов и границы `playableBounds` |
| `RoaGroundDressing.cs` | процедурная растительность и разбивка однообразия земли |
| `RoaEnvironmentPalette.cs` | палитры окружения локаций |
| `RoaGlobalMapData.cs`, `RoaUnityGlobalMapScene.cs`, `RoaUnityLocationScene.cs` | данные и prefab-only сцены глобальной карты и локаций |

## Игровой слой (`Assets/Scripts/Game/`)

Группы по подсистемам (файлы с суффиксами `.Presentation`, `.Damage` и т.п. —
partial-части того же класса):

**Сессия и вход** — `RoaGameBootstrap` (FSM всего клиента: вход → join →
локация → игрок), `RoaAuthCanvas`, `RoaCharacterCreator`, `RoaCharacterPreview`
(изолированный GLB-предпросмотр), `RoaLoadingCanvas`, `RoaRecoveryCanvas`,
`RoaFirstRunCoach` (обучение «первый выход»).

**Персонаж и анимация** — `RoaCharacterView` (общий 65-костный риг, внешность,
травмы, локомоция, combat-клипы), `RoaCharacterPose` (направленная поза и
демпфирование верха), `RoaFootIk`, `RoaIkChain`, `RoaEquipmentView`,
`RoaWeaponGrip`, `RoaWeaponView`, `RoaOffhandWeaponView`, `RoaMeleeGrip`,
`RoaHitReaction`, `RoaLocomotionPresentation`, `RoaMovementFx`,
`RoaActorGroundShadow`, `RoaActorPresentationLod`, `RoaNetworkActorMotion`.

**Игрок и акторы** — `RoaPlayerController` (ввод, предсказание, отправка
`state`), `RoaRemotePlayers`, `RoaEnemies` (NPC и существа из
`enemySnapshot`/`enemyFrame`), `RoaEnemyModels`, `RoaEnemyThreatTelegraph`,
`RoaActorNameplates`.

**Бой** — `RoaCombat`, `RoaCombatPreview` (шанс/урон без изменения
авторитетного состояния), `RoaCombatFx` (пулы трассеров/вспышек, взрывы, речь
NPC), `RoaCombatPresentationFx.*`, `RoaCombatConfirmation`,
`RoaCombatFeedbackCanvas`, `RoaTargetingFeedback`, `RoaWeaponReadiness`.

**Камера, свет и видимость** — `RoaCameraRig` (+`.Presentation`),
`RoaWorldLighting` (день/ночь и авторские профили), `RoaFogOfWar`,
`RoaAuthoredVision`, `RoaVisibilityGate`, `RoaRoofCutaway`, `RoaMinimap`.
Подробнее: [камера и видимость](CAMERA_AND_VISION.md).

**Инвентарь и предметы** — `RoaInventory`, `RoaQuickbar`, `RoaItemData`
(русские подписи, канонический вес), `RoaItemCategories`, `RoaItemInfo`,
`RoaItemPopups`, `RoaArmorData`, `RoaGearData`, `RoaWeaponData`,
`RoaWeaponModificationData`, `RoaGroundItems` (физические GLB-модели предметов
на земле).

**Взаимодействия и мир** — `RoaInteraction` (диалоги, квесты, бартер, переходы,
лут, ресурсы, станки, доски работ), `RoaCraftingData`, `RoaPipboy` и
`RoaPipboyCanvas` (+`.Progression`) — SPECIAL, навыки, таланты, работы, мир,
фракции, радио, друзья, кланы; `RoaProgressionData`, `RoaEconomyFeedback`.

**Глобальная карта и активности** — `RoaGlobalMap` (серверный маршрут,
территории, живой слой), `RoaGlobalMapCanvas`, `RoaGlobalMapActorView`,
`RoaWorldActivityCanvas` (+`.Feedback`), `RoaWorldActivityNavigation`,
`RoaActivityHubCanvas` (+`.Presentation`), `RoaActivityBeacon`,
`RoaActivityZoneMarker`, `RoaActivityFeedback`, `RoaCaravanStagingCanvas`,
`RoaMapWindowCanvas`, `RoaWorldOverlayCanvas`.

**HUD и UI-инфраструктура** — `RoaHud`, `RoaHudCanvas` (+`.EconomyFeedback`),
`RoaHudLayout`, `RoaHudDragHandle` (редактор HUD), `RoaHudInteractionPrompt`,
`RoaSystemCanvas` (меню, графика, обучение), `RoaDialogueCanvas`,
`RoaBarterCanvas`, `RoaLootCanvas`, `RoaStorageCanvas`, `RoaWorkbenchCanvas`,
`RoaQuantityCanvas`, `RoaUiTheme`, `RoaUiFont` (Noto Sans с кириллицей для
WebGL), `RoaUiScale` (единый CanvasScaler 1920×1080, mobile 1280×720),
`RoaUiScroll`, `RoaUiPrefabTemplate`.

**Мобильное управление** — `RoaMobileControls`, `RoaMobileControlsCanvas`
(landscape-стик, автоцель, игровые кнопки).

**Прочее** — `RoaAudio`, `RoaModelPrefabCatalog`, `RoaModelUrl`
(префикс `/assets/models-lite/` для WebGL), `RoaWebGlInputProbe`
(диагностика `?roadebug=1`).

## Редакторские инструменты (`Assets/Editor/`)

- **Пробы** `Roa*Probe.cs` — детерминированные проверки подсистем из меню
  **Realm of Ashes** (камера, создание персонажа, fog, крыши, боевые эффекты,
  мобильное управление, quickbar, глобальная карта, mission director и др.).
- `RoaClientAuditRunner.cs` — запускает набор проб одним batchmode-процессом и
  завершает Unity с кодом 1 при любой ошибке.
- Генераторы: `RoaUiPrefabGenerator` (24 редактируемых UI-префаба),
  `RoaModelPrefabGenerator`, `RoaOldKlimSceneGenerator`, авторские инструменты
  глобальной карты (`RoaGlobalMap*Authoring`).
- `RoaWebGlBuild.cs` — меню «Realm of Ashes → Build WebGL», результат в
  `public/unity/` (в .gitignore).
- `RoaCredentialGuard.cs` — защита от коммита включённого `AutoLoginOnStart`
  с заполненными учётными данными.

## Сборка и проверка без редактора

| Команда | Что делает |
|---|---|
| `unity-client/Tools/compile-check.ps1` (`.sh` для Git Bash) | компиляция тем же Roslyn и reference-сборками, что у Editor |
| `unity-client/Tools/build-windows.ps1` | полная Windows-сборка через чистую копию в ASCII-пути (обязательно для кириллического пути проекта) |
| `unity-client/Tools/sync-ui-prefabs.ps1` | пересборка UI-префабов |
| `npm run check:unity-parity` | чётность с legacy-клиентом: события Socket.IO, предметы, рецепты, модификации, стартовые перки |
| `npm run check:coords` | контракт преобразования координат |
| `npm run start:unity-assets` | раздача ассетов на loopback для редакторских проб без игрового сервера |

## Правила изменения клиента

- Новое исходящее или входящее событие Socket.IO должно быть добавлено и в
  контракт `tools/check-socket-event-contract.js` /
  `tools/check-unity-client-parity.js` — иначе проверка упадёт.
- Преобразования координат и углов не писать на месте — только через
  `RoaCoords`.
- Каталоги предметов, рецептов, модификаций и прогрессии намеренно дублируют
  серверные ради отсутствия доверия к клиенту; их чётность закреплена
  parity-проверками.
- UI собирается из генерируемых префабов (`RoaUiPrefabGenerator`); ручные
  правки префабов перетираются генератором.
- `AutoLoginOnStart` у `RoaGameBootstrap` включать только локально и не
  коммитить: сцена с заполненными полями отправит учётные данные в репозиторий.
