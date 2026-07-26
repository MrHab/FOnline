# Серверные файлы

## Production entry point

`server.js` — единственная production-точка входа. Версия берётся из
`package.json`; `/health` возвращает `name`, `version`, `uptimeSec`, число
игроков, число активных `locationRealities`, число пользователей и персонажей.
Поле `playerLimitPerLocation` сейчас равно `null`.

В `server.js` находятся:

- Express, CORS, раздача статики и `/health`;
- REST API auth и персонажей;
- загрузка и нормализация авторских данных;
- Socket.IO и блокировки активного аккаунта/персонажа;
- комнаты, движение, бой, прогрессия и серверный инвентарь;
- NPC, AI, лут, контейнеры, ресурсы, торговля и крафт;
- локальные/глобальные переходы и связь с живой пустошью;
- интервалы симуляции, housekeeping и snapshots.

Файл большой, поэтому новые независимые алгоритмы следует выносить в
`src/server/`, сохраняя `server.js` как слой интеграции.

## Активные модули `src/server/`

| Файл | Назначение |
|---|---|
| `wasteland-sim.js` | автономная глобальная симуляция, точки, отряды, экономика, конфликты, задания и world zones |
| `wasteland-sim-utils.js` | общая нормализация значений, устойчивый PRNG и атомарное хранение состояния симуляции |
| `wasteland-factions.js` | нормализация фракций, столицы и инварианты защищённых столичных локаций |
| `wasteland-map-geometry.js` | масштаб глобальной карты, центры клеток, расстояния и радиусы входа |
| `wasteland-district-sites.js` | детерминированные районные точки интереса, берег, дорожные зазоры и охранные зоны столиц |
| `wasteland-localization.js` | миграционная локализация старых англоязычных названий и событий |
| `wasteland-world-tasks.js` | нормализация схемы мировых заданий и совместимость старых наград |
| `wasteland-site-instances.js` | устойчивые ID, seed и уникальные локальные профили точек глобальной карты |
| `wasteland-stockpile.js` | чистые операции над складом, грузом и кратким описанием ресурсов |
| `global-infrastructure.js` | нормализация дорог/трубопроводов, проверка суши и поиск маршрутов |
| `global-exit-direction.js` | направление выхода из локальной карты и точка продолжения на глобальной карте |
| `model-colliders.js` | загрузка collider-каталога и преобразование bounds/parts в серверные blockers |
| `npc-inventory.js` | фракционные запасы, доктрины экипировки, личный инвентарь NPC, боеприпасы, торговый и трупный лут |
| `dev-access.js` | startup-политика и middleware для закрытого dev API |
| `world-party-integrity.js` | общий контракт task/party, account+character identity, доверенный снимок групповой награды и чистые функции целостности мировых групп |

Их импорты находятся в начале `server.js`; именно этот список определяет
активные production-модули.

## `src/server/authoritative-server.js`

Это исторический reference-файл, а не второй сервер и не модуль production
entry point. `server.js` его не импортирует. Несколько проверок всё ещё читают
его текст для сверки отдельных контрактов, поэтому файл нельзя считать
безопасной копией текущего runtime и нельзя запускать вместо `server.js`.

До удаления reference-файла нужно сначала перенести зависящие от него проверки
на production-код.

## Авторские и runtime-данные

| Путь | Содержимое |
|---|---|
| `data/locations/*.json` | авторские локальные карты и объекты |
| `data/global-map.json` | сетка, узлы, инфраструктура, объекты и encounter weights |
| `data/encounters.json` | состав шаблонных встреч |
| `data/quests.json` | квесты |
| `data/traders.json` | торговые профили |
| `data/loot-tables.json` | таблицы контейнеров и врагов |
| `DATA_DIR/users.json` | аккаунты, email и сессии |
| `DATA_DIR/saves.json` | персонажи по user id |
| `DATA_DIR/wasteland-sim.json` | runtime-состояние живой пустоши |

Если `DATA_DIR` не задан, используется каталог `data/` в рабочей копии.
Runtime-файлы игнорируются Git.

Запись выполняется через временный файл и rename. При ошибке чтения
`users.json`, `saves.json` или `wasteland-sim.json` исходник сохраняется рядом как
`*.corrupt-<timestamp>`.

## HTTP API

Основные публичные группы:

- `/health`;
- `/api/auth/*`;
- `/api/characters*`;
- `/api/locations`, `/api/quests`, `/api/global-map`, `/api/wasteland`;
- `/socket.io/`.

Маршруты `/api/dev/*` по умолчанию закрыты:

- `DEV_API_MODE=disabled` возвращает `404`;
- `DEV_API_MODE=local` разрешён только вне production, только для прямого
  loopback с локальными Host/Origin, заголовком `X-Dev-Local: 1` и без
  `Forwarded`, `X-Forwarded-*` и `X-Real-IP`;
- `DEV_API_MODE=token` требует `DEV_ADMIN_TOKEN` длиной не менее 32 UTF-8 байт
  и заголовок `X-Dev-Token`;
- `POST`, `PUT`, `PATCH` и `DELETE` dev API принимают только
  `Content-Type: application/json`.

Production Nginx отдельно возвращает `404` для dev API и HTML-редакторов до
общего `/api/` и static routing, включая варианты регистра и URL-кодирования.
Для административного token-доступа нужен непубличный прямой канал, например
SSH-туннель; штатный public Nginx его не пропускает.

Подробнее об auth и персонажах:
[Аккаунты и персонажи](AUTH_AND_CHARACTERS.md).

## Генераторы и проверки

- `tools/build-wasteland-models.js` создаёт процедурные GLB.
- `tools/build-model-colliders.js` пересобирает collider-каталог.
- `tools/account-admin.js` обновляет email/пароль runtime-аккаунта.
- `tools/check-*.js` проверяют код, контент и синхронизационные контракты.
- `tools/smoke-check.js` запускает изолированный end-to-end smoke.

Основные команды:

```bash
npm run check:server
npm run check:dev-access
npm run check:world-party
npm run check:data
npm run check:npc
npm run check:economy
npm run smoke
npm run check
```

Smoke использует временный порт и временный `DATA_DIR`. Среди прочего он
проверяет версию `/health`, cache headers, auth lifecycle, блокировку
персонажа, создание/удаление персонажа, Socket.IO и совместную комнату трёх
игроков.

## Куда выносить следующий код

При дальнейшем разбиении приоритетны границы с минимальным скрытым состоянием:

```text
src/server/auth.js
src/server/characters.js
src/server/rooms.js
src/server/combat.js
src/server/inventory.js
src/server/socket-handlers/
```

Перенос должен быть поэтапным: сначала чистая функция/подсистема и тесты, затем
подключение из `server.js`, затем удаление дубликата.
