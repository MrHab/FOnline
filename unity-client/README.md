# Unity-клиент «Кромки»

Единственный клиент авторитетного игрового сервера. Здесь — окружение, запуск,
сборки и редакторские проверки. Технический контракт с сервером, WebGL-поставка
и деплой описаны в [`docs/UNITY_PORT.md`](../docs/UNITY_PORT.md), карта файлов и
классов — в [`docs/wiki/CLIENT_FILES.md`](../docs/wiki/CLIENT_FILES.md),
управление — в [`docs/wiki/PLAYER_SYSTEM.md`](../docs/wiki/PLAYER_SYSTEM.md).

## Требования

- **Unity 6000.5.8f1** (версия зафиксирована в
  `ProjectSettings/ProjectVersion.txt`), для WebGL-сборки — модуль WebGL Build
  Support. Рендер — URP, интерфейс — uGUI.
- Игровой сервер из корня репозитория: Node.js, `npm ci`, `npm start`.
- Пакеты — только официальные пакеты Unity из `Packages/manifest.json` и
  локальный пакет моделей `com.realmofashes.models`
  (`file:../public/assets/models`). Socket.IO реализован собственным кодом в
  `Assets/Scripts/Net/SocketIo/`.

## Открытие проекта

В Git нет нескольких вещей, без которых проект откроется с ошибками:

1. **Каталог моделей.** Путь локального пакета разрешается через
   `unity-client/public` — junction на общий `public/` (в .gitignore). Создать
   из корня репозитория:

   ```powershell
   cmd /c mklink /J unity-client\public public
   ```

2. **Магазинные паки окружения.** `Assets/MEP`, `Assets/TerrainSampleAssets` и
   исходные файлы `Assets/ThirdParty/AtomicRealmPostApocalyptic` ставятся
   локально до первого запуска редактора. От пака Atomic Realm в репозитории
   лежат только `.meta`, лицензии и
   [README с порядком установки](Assets/ThirdParty/AtomicRealmPostApocalyptic/README.md):
   без исходных файлов Unity удаляет осиротевшие `.meta` — такие правки не
   коммитить. Сцены Кромки на эти паки напрямую не ссылаются: модель
   заворачивается в собственный префаб.

`Library/` генерируется при первом открытии; компиляционной проверке она тоже
нужна.

## Сцены

| Сцена | Назначение |
|---|---|
| `Assets/Scenes/Wasteland.unity` | точка входа: bootstrap, камера, свет; отсюда запускается Play |
| `Assets/Scenes/Kromka/KromkaGlobalMap.unity` | глобальная карта, загружается аддитивно |
| `Assets/Scenes/Kromka/Locations/` | авторские сцены локаций, по одной на `locationId`; загружаются аддитивно |
| `Assets/Scenes/GlobalMapAuthored.unity` | источник визуального языка карты для редакторских инструментов; в сборку не входит |

Первые три строки включены в Build Settings. Правила авторинга сцен — в
[`docs/KROMKA_UNITY_AUTHORING.md`](../docs/KROMKA_UNITY_AUTHORING.md).

## Запуск против локального сервера

```bash
npm start
```

Сервер слушает порт 3000. Открыть `Assets/Scenes/Wasteland.unity` и нажать Play:
появится экран входа с гостевым стартом («Начать сразу»), входом, регистрацией и
восстановлением пароля, затем выбор, создание или удаление персонажа.

Адрес сервера — поле `BaseUrl` компонента `RoaGameBootstrap` (по умолчанию
`http://127.0.0.1:3000`); bootstrap передаёт его загрузчику локаций, актёрам и
REST-клиенту. В редакторе и Standalone тот же адрес меняется полем «Сервер» на
экране входа, в WebGL берётся origin страницы.

### Авто-вход и автоматизация

У `RoaGameBootstrap` есть `AutoLoginOnStart` с полями `AutoLoginName` и
`AutoLoginPassword` — для локального прогона без ручного ввода. В сохранённой
сцене он выключен: `RoaCredentialGuard` перед каждым сохранением сцены сбрасывает
флаг и очищает поля, чтобы учётные данные не попали в репозиторий.

Для изолированных прогонов те же данные передаются переменными окружения.
Они читаются только при `ROA_UNITY_AUTOMATION=1`: `ROA_UNITY_BASE_URL`,
`ROA_UNITY_LOGIN`, `ROA_UNITY_PASSWORD` и `ROA_UNITY_FORCE_MOBILE=1` (мобильный
режим на десктопе).

## Проверка компиляции без редактора

Тот же Roslyn и reference-сборки, что у редактора; компилируются
`Assets/Scripts` и `Assets/Editor` с `UNITY_EDITOR`. Нужен один предварительный
запуск Unity, чтобы существовала `Library/ScriptAssemblies`.

```powershell
.\unity-client\Tools\compile-check.ps1
.\unity-client\Tools\compile-check.ps1 -UnityData 'C:\Program Files\Unity\Hub\Editor\6000.5.8f1\Editor\Data'
```

```bash
UNITY_DATA="D:/Games/6000.5.8f1/Editor/Data" ./unity-client/Tools/compile-check.sh
```

По умолчанию оба скрипта ищут редактор в `D:\Games\6000.5.8f1\Editor\Data`.
Скрипт проверяет только компиляцию; поведение и вёрстку он не видит.

Из корня репозитория дополнительно запускаются:

```bash
npm run check:unity-parity   # события Socket.IO, HTTP-маршруты, каталоги предметов, рецептов, модификаций
npm run check:unity-csharp   # runtime-скрипты по response-файлу последней компиляции редактора
```

`check:unity-csharp` находит редактор по `UNITY_EDITOR_PATH` (путь к
`Unity.exe`) или в стандартных каталогах установки.

## WebGL-сборка

Меню **Кромка → Build WebGL** (`Assets/Editor/RoaWebGlBuild.cs`) собирает все
включённые сцены Build Settings в `public/unity/` (в .gitignore): Brotli с
decompression fallback, имена файлов — хэши содержимого, шаблон
`Assets/WebGLTemplates/RealmOfAshes`. **Realm of Ashes → Build local WebGL
review** собирает то же с gzip — быстрее для локальных итераций.

Сборщик требует Edit-режим и сохранённые сцены. Ход и итог он пишет в квитанцию
`Logs/local-webgl-build.json`: `result` равен `RUNNING`, пока сборка идёт, и
результату Unity после неё; там же длительность, размер и число текстур сверх
бюджета WebGL (**Кромка → Авторинг → Бюджет текстур WebGL** приводит текстуры
паков к пределу).

Пакетно, при закрытом редакторе:

```powershell
& 'D:\Games\6000.5.8f1\Editor\Unity.exe' -batchmode -quit -projectPath unity-client `
  -buildTarget WebGL -executeMethod RealmOfAshes.EditorTools.RoaWebGlBuild.Build -logFile -
```

Готовую сборку отдаёт тот же `npm start` с корня сайта (`http://127.0.0.1:3000/`);
заголовки раздачи проверяет `npm run check:webgl-delivery`. Облегчённые модели
для WebGL создаёт `npm run build:models-lite`. Выкладка — раздел «Деплой» в
[`docs/UNITY_PORT.md`](../docs/UNITY_PORT.md).

## Windows-сборка

```powershell
.\unity-client\Tools\build-windows.ps1
.\unity-client\Tools\build-windows.ps1 `
  -UnityExe 'D:\Games\6000.5.8f1\Editor\Unity.exe' `
  -OutputDirectory 'D:\Builds\Kromka'
```

Скрипт копирует проект (без `Library`, `Temp`, `Logs`, `obj`, `Build`) в
ASCII-путь внутри `C:\Users\Public\Documents` (`-MirrorBase`), отдельным проходом
импортирует его, затем собирает player и переносит результат в
`unity-client\Build\Windows-<дата>` или в `-OutputDirectory`. Сообщения
`Script attached ... is missing`, ошибки компиляции и `Aborting batchmode` в
логах считаются фатальными, даже если Unity сообщила `Result: Success`;
`-KeepMirror` оставляет копию для разбора. Зачем нужен ASCII-путь — в
[`docs/wiki/KNOWN_BUGS.md`](../docs/wiki/KNOWN_BUGS.md).

`Tools\sync-ui-prefabs.ps1` тем же способом пересобирает библиотеку UI-префабов
(`RoaUiPrefabGenerator.Build`) и копирует `Assets/Resources/RealmUi/Prefabs`
обратно в проект.

## Редакторские пробы

Проба — статический класс `Assets/Editor/Roa*Probe.cs` с методом `Run`, который
детерминированно проверяет одну подсистему и пишет итог в консоль редактора
(`Logs/Editor.log`); провал — `Debug.LogError` или исключение. Точное имя пункта
меню стоит в атрибуте `MenuItem` пробы.

- **Realm of Ashes → Проверить …** и **Realm of Ashes → Probe → …** — пробы
  клиента: создание персонажа, камера, туман войны, мини-карта, крыши, боевые
  эффекты, мобильное управление, HUD, быстрые слоты, каталог предметов,
  библиотека UI-префабов и другие.
- **Кромка → Проверки → …** — авторские сцены, ссылки локальных префабов,
  бюджет текстур WebGL, контрольные снимки сцен.
- **Kromka → Checks → …** — снимки и валидаторы итераций глобальной карты.

Часть проб работает только в Play Mode (например, «Проверить экипировку
персонажа») — вне его пункт меню неактивен. Пробы, которые грузят модели,
обращаются к `http://127.0.0.1:3000`: нужен запущенный игровой сервер или
раздача ассетов на loopback без него:

```bash
npm run start:unity-assets
```

### Пакетный аудит

`RealmOfAshes.EditorTools.RoaClientAuditRunner.Run` прогоняет список проб из
своего массива `Probes` и предпросмотр персонажа одним процессом, пишет
`[UNITY CLIENT AUDIT] PASS` или `FAIL` и завершает Unity с кодом 0 или 1.
Запускается без `-quit`: метод асинхронный и сам вызывает выход.

```powershell
& 'D:\Games\6000.5.8f1\Editor\Unity.exe' -batchmode -projectPath unity-client `
  -executeMethod RealmOfAshes.EditorTools.RoaClientAuditRunner.Run -logFile audit.log
```

Отдельная проба запускается так же, но с `-quit`:
`-executeMethod RealmOfAshes.EditorTools.RoaFogProbe.Run -quit`.

Batchmode не запускается, пока проект открыт в GUI-редакторе, и наоборот. Если
запуск завис и не пишет в лог — скорее всего остался процесс `Unity.exe` от
прошлого прогона; снять его и удалить `Temp/UnityLockfile`. Аудит пересобирает
UI-префабы и может изменить отслеживаемые файлы в `Assets/Resources/RealmUi/` —
перед коммитом сверить `git status`.

## Шлюз автоматизации

`Assets/Editor/RoaAgentGate.cs` позволяет управлять открытым редактором без
фокуса окна. Раз в полсекунды редактор читает
`Library/roa-agent-request.json`, удаляет его, выполняет команду и пишет
`Library/roa-agent-response.json` (`ok`, `message`, `at`). Пока идёт компиляция
или импорт, запрос ждёт.

```json
{ "command": "executeMenu", "path": "Realm of Ashes/Проверить туман войны" }
```

| Команда | Действие |
|---|---|
| `ping` | активная сцена и режим (edit/play) |
| `refresh` | `AssetDatabase.Refresh` — импорт внешних правок кода без фокуса окна |
| `executeMenu` | пункт меню из `path`; разрешены только `Realm of Ashes/`, `Кромка/Авторинг/`, `Кромка/Проверки/` и `Кромка/Build WebGL`; в Play Mode отклоняется |
| `openMapScene` | открыть `Assets/Scenes/GlobalMapAuthored.unity`, если нет несохранённых сцен |
| `captureMap` | снимки загруженной сцены карты (по маркеру `RoaUnityGlobalMapScene`) в `output`, по умолчанию `Library/AgentCaptures`; ракурсы задаёт массив `shots` |
| `revertOpenScene` | перечитать активную сцену с диска, отбросив несохранённые правки; только с `"confirm": true`, то есть после согласия человека |

Шлюз не сохраняет сцены. Ответ «Выполнено» означает только то, что пункт меню
запущен: итог пробы читается по её строке в `Logs/Editor.log`, итог сборки — по
квитанции. Файлы запроса и ответа одни на весь редактор, поэтому параллельные
сессии перезаписывают запросы друг друга — результат сверяют по артефакту, а не
по тексту ответа. Пакетный аудит через шлюз не запускается: у него нет пункта
меню.
