# Unity-клиент: контракт с сервером, WebGL-сборка и деплой

Unity — единственный клиент игры. Документ фиксирует технический контракт
между Unity-клиентом и авторитетным Node-сервером: вход и Socket.IO, систему
координат, формат локации, транспорт, WebGL-сборку и её выкладку. Настройка
окружения, сборки и редакторские пробы — в
[`unity-client/README.md`](../unity-client/README.md), карта классов — в
[`docs/wiki/CLIENT_FILES.md`](wiki/CLIENT_FILES.md).

## Контракт с сервером

Протокол описан в [`docs/wiki/SOCKET_EVENTS.md`](wiki/SOCKET_EVENTS.md), REST —
в [`docs/wiki/AUTH_AND_CHARACTERS.md`](wiki/AUTH_AND_CHARACTERS.md). Состав
событий сервера закрепляет `npm run check:socket-events`
(`tools/check-socket-event-contract.js`), соответствие клиента серверу —
`npm run check:unity-parity`: у каждого серверного `emit` есть обработчик в
Unity, у каждого события Unity — `socket.on` на сервере, у каждого `/api/...`
из клиента — маршрут сервера.

Вход состоит из двух шагов:

1. `POST /api/auth/login` (или `/api/auth/guest`, `/api/auth/register`) →
   `token` и список персонажей.
2. Socket.IO `join` с `token`, `deviceId`, `clientInstanceId`, `characterId`
   и `enemyFrameVersion: 1` → ack с `characterLeaseId`, комнатой, собственным
   состоянием, списком игроков и `worldState`.

Остальной REST клиента (`RoaAuthClient`): оба этапа
`/api/auth/password-reset/*`, список и удаление через `/api/characters`,
heartbeat `/api/auth/heartbeat` раз в 10 секунд (после сбоя — повтор через 60)
и `/api/auth/logout`, освобождающий блокировку аккаунта. Токен живёт в памяти
процесса; в `PlayerPrefs` пишется только `deviceId`. Удаление персонажа, который
находится в игре, сервер отклоняет с кодом 409.

Смена персонажа закрывает Socket.IO без автоматического reconnect и очищает обе
сцены; logout сначала просит сервер завершить сессию. Под игровым меню
блокируются движение, бой, взаимодействие, быстрые слоты и выбор цели на карте,
при этом авторитетный маршрут продолжает идти по серверному времени.

Существенные детали протокола:

- **`enemyFrameVersion: 1` обязателен.** Без него сервер шлёт полные
  `enemySnapshot` вместо компактных volatile `enemyFrame` — трафик вырастает
  на порядок.
- **Таймаут join — 5000 мс**, просроченный callback игнорируется, соединение
  уходит в reconnect. Игровой authority до нового ack считается потерянным.
  Отказы `session-busy` и `character-busy` временные: клиент повторяет `join`
  по тому же сокету с нарастающей задержкой.
- **`seq` в `state` должен строго расти.** Пакеты с не большим `seq` сервер
  молча отбрасывает.
- **`playerState` и `enemyFrame` — volatile.** Промежуточный пакет допустимо
  потерять; отбрасывать устаревшие по `seq` обязан клиент.
- **Пакеты чужой комнаты надо игнорировать** по `roomId` — во время перехода
  между локациями в полёте остаются сообщения предыдущей сцены.
- **Начало и остановка движения отправляются надёжно и немедленно**, промежуточные
  координаты — не чаще 20 Гц. Иначе персонаж «залипает» в беге у других игроков.
- Сервер может отклонить предложенную позицию по бюджету коллизий и прислать
  поправку через `authoritativePlayerState` с `reason: "movementCorrection"`.
  Обычная сверка позицию **не** трогает — применять `x`/`z` только при этой причине
  или при явном переходе.

## Система координат

Это главный источник тихих багов, поэтому преобразование изолировано в
единственном классе `RoaCoords`.

Сервер и вся авторская разметка работают в правосторонней системе glTF (Y
вверх). Unity левосторонняя. glTFast при импорте GLB инвертирует ось Z, поэтому
весь мир переводится тем же преобразованием:

```
позиция:  x_unity = x_server,  y_unity = y_server,  z_unity = -z_server
угол:     yaw_unity(град) = 180 - angle_server(рад) * Rad2Deg
Euler XYZ: Q_unity = Qx(-x) * Qy(-y) * Qz(z)
тайл:     x = (tx - width/2 + 0.5) * TILE,  TILE = 2
```

Для авторских `rotation.x/y/z` недостаточно передать знаки в
`Quaternion.Euler`: Unity применяет другой порядок осей, и ошибка проявляется,
когда ненулевы сразу несколько углов. `RoaCoords.AuthoredRotation` явно строит
`Qx * Qy * Qz`, одновременно отражая Z.

Серверный `angle` — это `atan2(dx, dz)`: 0 означает взгляд вдоль +Z, рост против
часовой стрелки при взгляде сверху. После импорта glTFast модель персонажа
смотрит в +Z, поэтому `ModelYawOffsetDeg` нулевой; четыре стороны света и
обратное преобразование угла прогоняет `npm run check:actor-facing`.

## Формат локации

`data/locations/*.json` (`realm.location.v1`) полностью декларативен: объект
несёт мировую позицию, поворот, масштаб, режим коллизии, правила обзора, теги и
— для NPC — блок `entity` с фракцией, диалогом и торговым профилем. Unity
получает каталог одним запросом `GET /api/locations`.

Геометрию локации Кромки задаёт авторская сцена Unity
(`Assets/Scenes/Kromka/Locations/`, имя по `locationId` —
`KromkaLocationSceneCatalog`): `RoaLocationLoader` загружает её аддитивно и
связывает объекты JSON с объектами сцены по `id`. Объект без пары в сцене
строится из GLB по полю `url`, если сцена не объявила, что заменяет серверную
статику целиком (`ReplaceServerStaticGeometry`). Экземпляры встреч, для которых
сцены нет, собираются из JSON и GLB целиком.

Одна ловушка: NPC и враги лежат в `objects` вместе с декорациями, но их
авторитетные позиции приходят в `enemySnapshot`. Загрузчик пропускает только
живые сущности (`LocationObject.IsLiveEntity`: `entity.kind`
`npc`/`enemy`/`monster`, живые теги и модели NPC). Отбрасывать любой объект с
`entity` нельзя: станки и доски заданий тоже имеют `entity`, но остаются
статическими объектами.

## Транспорт Socket.IO

Клиент Socket.IO написан своим кодом
(`Assets/Scripts/Net/SocketIo/RoaSocketIoConnection.cs`): реализованы Engine.IO
v4 и Socket.IO v5 — протокол `socket.io` 4.x сервера, только пространство имён
по умолчанию и текстовые пакеты; бинарный пакет даёт явную ошибку, а не тихую
потерю данных. Класс не зависит от `UnityEngine`.

Соединение работает поверх `IRoaWebSocketTransport`
(`Assets/Scripts/Net/SocketIo/RoaWebSocketTransport.cs`):

- `RoaNativeWebSocket` — `ClientWebSocket` с фоновым приёмом (редактор и
  Standalone);
- `RoaWebGlWebSocket` — мост к WebSocket страницы через
  `Assets/Plugins/WebGL/RoaWebSocket.jslib`: в WebGL нет ни сокетов .NET, ни
  потоков. Колбэки приходят на главном потоке, маршалинг `RoaSocketClient` не
  меняется.

Игровой слой изолирован в `RoaSocketClient`, поэтому смена транспорта не
задевает ни протокол, ни игровой код.

## Компиляция без запуска Unity

```bash
./unity-client/Tools/compile-check.sh
```

```powershell
.\unity-client\Tools\compile-check.ps1
```

Оба скрипта гоняют тот же Roslyn и те же reference-сборки, которыми пользуется
сам редактор, по `Assets/Scripts` и `Assets/Editor`. Нужен один предварительный
запуск Unity — чтобы в `Library/ScriptAssemblies` лежали сборки пакетов (glTFast
и прочие). Путь к редактору вынесен в переменную `UNITY_DATA` (`-UnityData` у
PowerShell-версии).

Важно понимать границу: скрипт проверяет **только компиляцию**. Тихие отказы,
пути привязки анимаций и вёрстку ловят запуск, пробы и глаза.

## WebGL-сборка Unity-клиента

- **Сборка**: меню «Кромка → Build WebGL» (`Assets/Editor/RoaWebGlBuild.cs`)
  → `public/unity/` (в .gitignore). Собираются все включённые сцены Build
  Settings: локации и карта грузятся аддитивно, и без них сборка молча
  осталась бы с одной `Wasteland`. Редактор должен стоять в Edit-режиме без
  несохранённых сцен. Ход и итог пишутся в квитанцию
  `Logs/local-webgl-build.json` проекта (`result`, длительность, размер,
  число текстур сверх бюджета).
- **Настройки**, которые выставляет сборщик: Brotli + `decompressionFallback`,
  имена файлов — хэши содержимого (иначе кеш браузера смешивает framework/wasm
  разных сборок → LinkError), стрипинг движка и managed-кода (Medium) с
  `Assets/link.xml` — он защищает то, что добавляется из кода или читается
  рефлексией (физика, UI, анимация, UnityWebRequest, Newtonsoft, glTFast,
  Assembly-CSharp); память 256 → 2048 МБ, без потоков, без сплэша Unity, шаблон
  `Assets/WebGLTemplates/RealmOfAshes` (холст во весь экран, экран загрузки в
  стиле игры).
- **Локальный просмотр**: «Realm of Ashes → Build local WebGL review» собирает
  то же с gzip (быстрее на итерациях) и возвращает настройку Brotli.
- **Сервер по умолчанию** в WebGL — origin страницы (`Application.absoluteURL`);
  поля адреса сервера на экране входа в WebGL нет.
- **Шрифт**: в WebGL нет системных шрифтов, `LegacyRuntime.ttf` без кириллицы —
  все канвы берут `RoaUiFont.Default` = Noto Sans (OFL) из
  `Resources/RealmUi/Fonts`.
- **Текстуры**: паки окружения (`Assets/MEP`) получают для WebGL предел 1024
  постпроцессором `RoaWebGlTextureBudget`; меню «Кромка → Авторинг → Бюджет
  текстур WebGL» приводит к нему уже импортированное.
- **Модели**: `npm run build:models-lite` (`tools/optimize-glb.js`) —
  dedup/prune/resample и PNG→JPEG q85 для текстур непрозрачных материалов
  (BLEND/MASK и PNG с реальной альфой остаются). Квантование и meshopt не
  используются: серверные инструменты коллайдеров читают вершины напрямую, а
  meshopt/KTX2 требуют декодеров на стороне клиента. Оригиналы в
  `public/assets/models` **не трогаются** — их хэши закреплены пайплайном
  утверждения; копии пишутся в `public/assets/models-lite/` (в .gitignore),
  сервер отдаёт `/assets/models-lite/*` с фолбэком на оригинал, Unity
  подставляет префикс через `RoaModelUrl.Lite`. В каталоге `Resources` сборки
  лежат только тела персонажа и библиотека анимаций — за этим следит
  `npm run check:webgl-payload`.
- **Мобильные**: `RoaUiScale` — единый CanvasScaler для всех канв (1440×810,
  на мобильных 1280×720); шаблон ограничивает DPR 1,5 на телефонах и
  планшетах. В WebGL `Application.isMobilePlatform` истинен в мобильном
  браузере — сенсорные контролы и мобильная раскладка HUD включаются сами.
- **Диагностика**: `?roadebug=1` включает `RoaWebGlInputProbe` — раз в 2 с
  в консоль браузера: FPS, позиция мыши, модуль EventSystem, фокус.

Две ловушки при замерах: встроенная панель браузера и перекрытое окно Chrome
троттлят rAF до ~1 Гц (`document.hidden = true`) — мерить только в видимом окне
или с `--disable-backgrounding-occluded-windows`; синтетический клик без
предшествующего движения мыши оставляет `Input.mousePosition` = (0,0).

Не проверено: реальный телефон, https/brotli на rangir.ru, долгие сессии
(рост памяти), ввод с клавиатуры в InputField, SDK площадок (vk-bridge/ysdk).

## Деплой: Unity — единственный клиент

Маршруты (одинаково в `server.js` для dev и в
`deploy/nginx/realm-of-ashes.locations.conf` для VPS, где статику раздаёт Nginx):

- `/` → `public/unity/index.html` (если сборки нет — страница ожидания
  `public/unity-unavailable.html`, чтобы dev и CI работали без Unity); на неё же
  Nginx отправляет прочие неизвестные пути;
- `/unity/Build/*` — immutable (имена-хэши); предсжатый файл отдаётся как есть.
  Node определяет кодек `.unityweb` по первым байтам
  (`src/server/webgl-delivery.js`) и объявляет `Content-Encoding` с
  `Vary: Accept-Encoding` только клиенту, который этот кодек принимает, и не на
  Range-запрос; Nginx объявляет `br` по расширению `.unityweb`. Остальным файл
  распакует загрузчик Unity. Несжатый `loader.js` — без кодека. И Node, и
  конфиг Nginx проверяет `npm run check:webgl-delivery`;
- `/unity/` и `index.html` — `no-cache`;
- `/assets/models-lite/*` → облегчённые GLB с фолбэком на `/assets/models/*`.

Общий порядок обновления VPS — в [`docs/CODEX_WORKFLOW.md`](CODEX_WORKFLOW.md).
Шаги, относящиеся к клиенту:

1. `npm ci && npm run build:models-lite` — генерирует
   `public/assets/models-lite/` (в git не входит). Скрипту нужны devDependencies
   (`@gltf-transform/*`, `sharp`): при установке с `--omit=dev` каталог собирают
   на сборочной машине и копируют вместе со сборкой.
2. WebGL-сборка: на машине с Unity 6000.5.8f1 (+ модуль WebGL) — меню
   «Кромка → Build WebGL» или пакетно:
   `Unity.exe -batchmode -quit -projectPath unity-client -buildTarget WebGL -executeMethod RealmOfAshes.EditorTools.RoaWebGlBuild.Build`,
   результат — `public/unity/`; скопировать каталог на VPS
   (`rsync -a --delete public/unity/ vps:/opt/realm-of-ashes/public/unity/`).
   Сборка в git не входит (.gitignore).
3. Обновить nginx-сниппет (`install … realm-of-ashes.locations.conf`, `nginx -t`,
   `systemctl reload nginx`) и перезапустить Node.
4. Проверить: `curl -fsS https://rangir.ru/ | grep -o "<title>[^<]*"` — `<title>Кромка — Unity`
   (страница ожидания отвечает «Кромка — подготовка клиента»);
   `curl -fsSI https://rangir.ru/assets/models-lite/wasteland/npc_raider.glb` — 200.

## Уроки о тихих отказах

Дороже всего в клиенте обходится **сбой без сообщения**:

| Что молчит | Как проявляется |
|---|---|
| `AnimationClip.SampleAnimation` при несовпадении путей | поза хвата не применяется, оружие висит в метре от руки |
| `_ = LoadModel(...)` — исключение в задаче, которую никто не ожидает | NPC создаются невидимыми, консоль пустая |
| `return` без лога в загрузчике | то же самое |

Правило, закреплённое в коде: **любая ветка отказа обязана писать в консоль**.

Отдельно отделены штатные гонки: если объект уничтожен во время загрузки
(вышел из комнаты, остановился Play Mode), это не ошибка и в консоль не идёт.
