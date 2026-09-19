# Файлы Unity-клиента

Игровой клиент — Unity-проект `unity-client/` (Unity **6000.5.8f1**, URP
17.5.0). Код лежит в `Assets/Scripts/` и разделён на четыре каталога: `Net/`
(сеть), `World/` (мир и координаты), `Game/` (игровой слой и UI) и `Kromka/`
(каталог авторских сцен и компоненты авторинга). Редакторские пробы и
генераторы — в `Assets/Editor/`.

Интерфейс — uGUI, канвы собираются кодом классов `Roa*Canvas`. IMGUI-ветки
(`OnGUI`) в тех же компонентах выключены флагами `CanvasDriven`: текст,
подключённый только там, до игрока не доходит.

Сцены:

- `Assets/Scenes/Wasteland.unity` — точка входа: bootstrap, камера, свет;
- `Assets/Scenes/Kromka/Locations/` — авторские сцены мест, по одной на
  `locationId`; загружаются аддитивно (`KromkaLocationSceneCatalog`).

Все они включены в Build Settings. У зон мира сцен нет: их собирает
`RoaZoneAssembler` из префабов набора.

## Пакеты

`Packages/manifest.json` содержит только официальные пакеты Unity плюс
локальный пакет моделей:

| Пакет | Зачем |
|---|---|
| `com.unity.cloud.gltfast` | загрузка серверных GLB из `public/assets/models/` без конвертации |
| `com.unity.nuget.newtonsoft-json` | разбор вложенных объектов протокола |
| `com.unity.render-pipelines.universal` | URP |
| `com.unity.ugui` | uGUI-канвы |
| `com.unity.inputsystem` | ввод |
| `com.realmofashes.models` | `file:../public/assets/models` — общий каталог GLB как локальный пакет; путь разрешается через junction `unity-client/public` → `public/` |
| `com.unity.ai.assistant` | Unity MCP — доступ агента к редактору |

Socket.IO реализован собственным кодом, сторонних git-зависимостей нет.
Остальные записи манифеста (`com.unity.postprocessing`, HDRP, LevelPlay,
Purchasing, Visual Scripting и другие) код из `Assets/Scripts` и
`Assets/Editor` не использует.

## Сетевой слой (`Assets/Scripts/Net/`)

| Файл | Назначение |
|---|---|
| `RoaAuthClient.cs` | REST: вход, регистрация, гостевой старт, восстановление пароля, персонажи, heartbeat, заголовки сессии; в `PlayerPrefs` пишется только `deviceId`, токен живёт в памяти процесса |
| `RoaProtocol.cs` | C#-модели событий Socket.IO |
| `RoaSocketClient.cs` | игровой слой: join/reconnect-FSM, RTT, guard по `roomId`/lease и маршалинг в главный поток |
| `SocketIo/RoaSocketIoConnection.cs` | Engine.IO v4 / Socket.IO v5 (протокол `socket.io` 4.x сервера) |
| `SocketIo/RoaWebSocketTransport.cs` | транспорты: `RoaNativeWebSocket` (`ClientWebSocket`, Standalone и редактор) и `RoaWebGlWebSocket` (мост к WebSocket страницы, WebGL) |

WebGL-мост живёт в `Assets/Plugins/WebGL/RoaWebSocket.jslib`; протокольный и
игровой код при смене транспорта не меняются.

## Мир (`Assets/Scripts/World/`)

| Файл | Назначение |
|---|---|
| `RoaCoords.cs` | **единственное** место преобразования координат и углов сервер ↔ Unity |
| `RoaLocationData.cs` | модель `data/locations/*.json` (`realm.location.v1`) |
| `RoaLocationLoader.cs` | каталог `/api/locations`, аддитивная загрузка авторской сцены локации и привязка объектов JSON к объектам сцены по `id`; для локаций без сцены — GLB через glTFast; зону мира (`generated`) берёт по `/api/locations/<id>` и собирает из набора |
| `RoaZoneAssembler.cs`, `RoaZoneKitCatalog.cs` | сборка зоны мира из префабов набора (`Resources/RealmOfAshes/ZoneKitPrefabs`) с пулами и коллайдерами из `collisionParts` |
| `RoaZoneGroundCover.cs` | покров земли зоны: кусты и камни по зерну зоны мимо троп и объектов, на сцене — только слоты 3×3 вокруг камеры |
| `RoaUnityLocationScene.cs`, `RoaUnityLocationObject.cs` | маркер авторской сцены локации и мост «id серверного объекта → объект сцены» |
| `RoaSceneEnvironment.cs` | снимок освещения авторской сцены (ambient, туман, небо, солнце), применяемый к активной сцене |
| `RoaLocalTerrain.cs` | земля из авторитетной `worldState.map`, рельеф, вода, физика тайлов и границы `playableBounds` |
| `RoaGroundDressing.cs` | процедурная растительность и разбивка однообразия земли |
| `RoaWorldExitBoundary.cs` | край места: золотая полоса выхода в его зону мира или замкнутый пунктирный периметр |
| `RoaEnvironmentPalette.cs` | палитра моделей окружения из `Resources` |

## Авторинг Кромки (`Assets/Scripts/Kromka/`)

`KromkaLocationSceneCatalog.cs` — контракт имён сцен: `locationId` → сцена в
`Assets/Scenes/Kromka/Locations/`. Компоненты `Authoring/Kromka*Authoring.cs`
размечают сцены мест (локация, размещённые объекты, точки появления,
аномалии); экспортёр читает их при выгрузке в `data/`. Порядок работы —
[`KROMKA_UNITY_AUTHORING.md`](../KROMKA_UNITY_AUTHORING.md).

## Игровой слой (`Assets/Scripts/Game/`)

Группы по подсистемам (файлы с суффиксами `.Presentation`, `.Damage` и т.п. —
partial-части того же класса):

**Сессия и вход** — `RoaGameBootstrap` (FSM всего клиента: вход → join →
локация → игрок), `RoaAuthCanvas`, `RoaCharacterCreator`, `RoaCharacterPreview`
(изолированный GLB-предпросмотр), `RoaLoadingCanvas`, `RoaRecoveryCanvas`,
`RoaFirstRunCoach` (обучение «первый выход»), `RoaKromkaOnboarding`,
`RoaCaravanDepartureCinematic` и `RoaCaravanAmbushStage` (сюжетное вступление),
`RoaTutorialProps`.

**Персонаж и анимация** — `RoaCharacterView` (общий риг, внешность, травмы,
локомоция, combat-клипы), `RoaCharacterPose` (направленная поза и
демпфирование верха), `RoaIkChain`, `RoaEquipmentView`,
`RoaWeaponGrip`, `RoaWeaponView`, `RoaOffhandWeaponView`, `RoaMeleeGrip`,
`RoaHitReaction`, `RoaLocomotionPresentation`, `RoaMovementFx`,
`RoaActorGroundShadow`, `RoaActorPresentationLod`, `RoaNetworkActorMotion`.

**Игрок и акторы** — `RoaPlayerController` (ввод, предсказание, отправка
`state`), `RoaRemotePlayers`, `RoaEnemies` (NPC и существа из
`enemySnapshot`/`enemyFrame`), `RoaEnemyModels`, `RoaKromkaMutantPresentation`
(силуэты существ Кромки), `RoaEnemyThreatTelegraph`,
`RoaSettlementLifePresentation`, `RoaActorNameplates` (раскладка плашек — см.
[плашки и подписи](NAMEPLATES_AND_LABELS.md)).

**Бой** — `RoaCombat`, `RoaCombatPreview` (шанс/урон без изменения
авторитетного состояния), `RoaCombatFx` (пулы трассеров/вспышек, взрывы, речь
NPC), `RoaCombatPresentationFx.*`, `RoaCombatConfirmation`,
`RoaCombatFeedbackCanvas`, `RoaTargetingFeedback`, `RoaWeaponReadiness`,
`RoaBoltThrower` (бросок болта для проверки аномалий).
Прогноз читает опубликованный сервером профиль защиты цели и показывает ОД,
режим, требование Мощи, а с «Осведомлённостью» — порог, броню и сопротивление.
`RoaHudCanvas` всегда обозначает режим зоны; `RoaInteraction` перед входом в
зону с потерями показывает её правила и пропускает только со второго шага.

**Камера, свет и видимость** — `RoaCameraRig` (+`.Presentation`),
`RoaWorldLighting` (день/ночь и авторские профили), `RoaFogOfWar`,
`RoaAuthoredVision`, `RoaVisibilityGate`, `RoaRoofCutaway`, `RoaMinimap`.
Подробнее: [камера и видимость](CAMERA_AND_VISION.md).

**Инвентарь и предметы** — `RoaInventory`, `RoaQuickbar`, `RoaItemData`
(русские подписи, канонический вес), `RoaItemCategories`, `RoaItemInfo`,
`RoaItemPopups`, `RoaArmorData`, `RoaGearData`, `RoaWeaponData`,
`RoaWeaponModificationData`, `RoaGroundItems` (модели предметов на земле),
каталоги моделей `RoaItemModelCatalog`, `RoaEquipmentModelCatalog`,
`RoaSuitModelCatalog`, `RoaWornUtilityCatalog`, `RoaItemPropView`,
`RoaWeaponArt` (рендер оружия для оружейной консоли HUD).

**Взаимодействия и мир** — `RoaInteraction` (диалоги, квесты, бартер,
переходы, ворота и порталы зон, лут, ресурсы, станки, доски работ),
`RoaCraftingData`, `RoaCraftingPlots`
(участки станков и комиссия заказа), `RoaPipboy` и `RoaPipboyCanvas`
(+`.Progression`, `.KromkaQuests`, `.KromkaClans`, `.Base`) — пользовательский
ПУТНИК: семь характеристик, навыки, перки, задания, контракты, мир, фракции,
радио, друзья, кланы и укрытие; `RoaRadio`, `RoaProgressionData`,
`RoaEconomyFeedback`, `RoaPersonalBaseCanvas` (личная база и режим
строительства), `RoaAnomalyFieldRenderer` (+`.Presentation`),
`RoaKromkaShiftAndDetector` (Сдвиг, детектор, подбор артефакта),
`RoaKromkaSiegePresentation`, `RoaWorldEventsPresentation` (панель мировых
событий HUD).

**Рынок и сетевые обёртки** — `RoaAuctionCanvas` и `RoaAuctionNet` (рынок
фракции: книга ордеров), `RoaAccountSinNet` (синь на счёте аккаунта, премиум,
обменник синь↔марки), `RoaTerritoryNet` (принадлежность к фракции, сервисы
базы и диспетчер переноса), `RoaTerritoryContractCanvas` (окно контракта у
ворот Сердцевины), `RoaPveAreaNet` (PvE-области, «Искать следы»).

**Карта мира и активности** — `RoaWorldOverviewCanvas` (окно «КАРТА МИРА»:
подписи зон и мест, карточка, путь и строка пути под миникартой; плоская сетка —
запасной вид), `RoaWorldMap3D` (3D-вид: сцена `KromkaGlobalMap` поверх зоны в
своём слое и своей камерой, сетка зон по `GET /api/world-map` на рельефе,
флажок, выбор и путь), `RoaWorldMapRoute` (путь по зонам через открытые ворота),
`RoaMapWindowCanvas` (карта локации), `RoaWorldActivityCanvas`
(+`.Feedback` и partial-файл `RoaWorldActivityNavigation.cs`),
`RoaActivityBeacon`, `RoaActivityZoneMarker`, `RoaActivityFeedback`,
`RoaCaravanStagingCanvas`, `RoaWorldOverlayCanvas`.

**HUD и UI-инфраструктура** — `RoaHud`, `RoaHudCanvas` (+`.EconomyFeedback`
и partial-файл `RoaHudInteractionPrompt.cs`), `RoaHudLayout`,
`RoaHudDragHandle` (редактор HUD), `RoaSystemCanvas` (меню, графика,
обучение), `RoaDialogueCanvas`, `RoaBarterCanvas`, `RoaLootCanvas`,
`RoaStorageCanvas`, `RoaWorkbenchCanvas`, `RoaQuantityCanvas`, `RoaUiTheme`,
`RoaUiPalette`, `RoaUiFont` (Noto Sans с кириллицей для WebGL), `RoaUiScale`
(единый CanvasScaler: 1440×810, mobile 1280×720), `RoaUiScroll`,
`RoaUiPrefabTemplate`.

**Мобильное управление** — `RoaMobileControls`, `RoaMobileControlsCanvas`
(landscape-стик, автоцель по NPC и игрокам в PvP-зоне, тап ракетницей и игровые кнопки).

**Прочее** — `RoaAudio`, `RoaModelPrefabCatalog`, `RoaModelUrl`
(префикс `/assets/models-lite/`), `RoaModelImportLifetime`,
`RoaLocalModelReview` (просмотр моделей на loopback без аккаунта),
`RoaWebGlInputProbe` (диагностика `?roadebug=1`).

## Редакторские инструменты (`Assets/Editor/`)

- **Пробы** `Roa*Probe.cs` — детерминированные проверки подсистем в меню
  **Realm of Ashes**. Проверки авторского мира (`Kromka*`) находятся в меню
  **Кромка → Проверки**.
- `RoaClientAuditRunner.cs` — запускает набор проб одним batchmode-процессом и
  завершает Unity с кодом 1 при любой ошибке.
- `RoaZoneAssemblyProbe.cs` — «Realm of Ashes → Zones → Check zone assembly»:
  собирает зону мира из JSON, сверяет коллайдеры клиента с боксами сервера,
  пулы и покров и снимает кадры сверху и с игровой камеры.
- Авторинг мест Кромки: `KromkaWorldSceneBuilder` (создание и пересборка
  сцен), `KromkaLocationSceneComposer` (композиция локаций),
  `KromkaWorldSceneExporter` (выгрузка положений в `data/`),
  `KromkaTerritoryAuthoring` (сцены Сердцевины), `KromkaSceneShot`
  (контрольные кадры), `KromkaLocalPrefabRecovery` (префабы
  `Assets/Prefabs/Kromka/RecoveredEnvironment/`); меню **Кромка → Авторинг**.
- Генераторы: `RoaUiPrefabGenerator` (библиотека UI-шаблонов в
  `Assets/Resources/RealmUi/Prefabs/`), `RoaModelPrefabGenerator` (префабы
  общих GLB в `Assets/Prefabs/Models/`) и `RoaItemRenderBaker` (иконки
  предметов из 3D-моделей).
- `RoaWebGlBuild.cs` — меню «Кромка → Build WebGL», результат в
  `public/unity/` (в .gitignore); `RoaWebGlTextureBudget.cs` — предел размера
  текстур художественных паков для WebGL; `RoaRuntimeShaderGuard.cs` держит в
  сборке шейдеры, которые код находит через `Shader.Find`.
- `RoaCredentialGuard.cs` — перед каждым сохранением сцены выключает
  `AutoLoginOnStart` и очищает поля логина и пароля.
- `RoaAgentGate.cs` — файловый канал команд для внешней автоматизации
  (`Library/roa-agent-request.json` → `roa-agent-response.json`): ping,
  `AssetDatabase.Refresh` без фокуса окна и запуск разрешённых пунктов меню (`Realm of Ashes/`,
  `Кромка/Авторинг/`, `Кромка/Проверки/`, `Кромка/Build WebGL`); сцены не
  сохраняет. Единственная команда, трогающая несохранённые правки, —
  `revertOpenScene` (перечитать активную сцену с диска), и она выполняется
  только с явным `"confirm": true` после согласия человека.
- `RoaPlayModeRequest.cs` — по файлу `Library/RoaStartPlayMode.request`
  открывает `Wasteland.unity` и входит в Play Mode.

## Сборка и проверка без редактора

| Команда | Что делает |
|---|---|
| `unity-client/Tools/compile-check.ps1` (`.sh` для Git Bash) | компиляция `Assets/Scripts` и `Assets/Editor` тем же Roslyn и reference-сборками, что у Editor |
| `npm run check:unity-csharp` | компиляция runtime-скриптов по response-файлу последней сборки редактора (`Library/Bee`) |
| `unity-client/Tools/build-windows.ps1` | полная Windows-сборка через чистую копию в ASCII-пути (обязательно для кириллического пути проекта) |
| `unity-client/Tools/sync-ui-prefabs.ps1` | пересборка UI-префабов в копии проекта и перенос результата |
| `npm run check:unity-parity` | сверка клиента с сервером и авторскими каталогами: события Socket.IO, HTTP-маршруты, предметы, рецепты, модификации, стартовые черты |
| `npm run check:webgl-delivery`, `npm run check:webgl-payload` | заголовки раздачи WebGL-сборки (Node и Nginx) и вес каталога `Resources` |
| `npm run start:unity-assets` | раздача ассетов на loopback для редакторских проб без игрового сервера |

Настройка окружения, сборки и запуск проб описаны в
[`unity-client/README.md`](../../unity-client/README.md).

## Правила изменения клиента

- Событие Socket.IO добавляется сразу с обеих сторон:
  `npm run check:unity-parity` требует, чтобы у каждого серверного `emit` был
  обработчик в Unity, у каждого события Unity — `socket.on` на сервере, а у
  каждого `/api/...` из клиента — маршрут сервера; состав событий сервера
  закрепляет `npm run check:socket-events`.
- Преобразования координат и углов не писать на месте — только через
  `RoaCoords`.
- Встроенные каталоги предметов, рецептов, модификаций и прогрессии нужны
  клиенту только для показа: решает сервер, а на старте поверх них
  применяются серверные `/api/kromka/items` и
  `/api/kromka/character-progression`. Совпадение встроенных копий с
  авторскими данными закрепляют `npm run check:unity-parity` и
  `npm run check:unity-progression`.
- Канвы строятся кодом; префабы `Assets/Resources/RealmUi/Prefabs/` —
  генерируемая библиотека шаблонов (рантайм берёт из неё только корень темы
  `Assets/Resources/RealmUi/Prefabs/RoaUiRoot.prefab`), ручные правки в них
  перетираются `RoaUiPrefabGenerator`.
- Сцены Кромки не инстанцируют модели магазинных паков напрямую (в чистом
  клоне их нет) — только собственные префабы; ссылки проверяет
  `npm run check:unity-local-prefabs`.
- `AutoLoginOnStart` у `RoaGameBootstrap` включать только локально и не
  коммитить: сцена с заполненными полями отправит учётные данные в репозиторий.
