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

Импорты находятся в начале `server.js` (и внутри `wasteland-sim.js` для его
подмодулей); именно этот список определяет активные production-модули.

### Аккаунты и доступ

| Файл | Назначение |
|---|---|
| `auth-rate-limit.js` | ограничение частоты auth-запросов |
| `password-hashing.js` | асинхронная PBKDF2-очередь хеширования паролей |
| `password-reset.js` | одноразовый reset token, TTL и безопасный email-контент |
| `guest-auth.js` | гостевые профили по `deviceId` |
| `dev-access.js` | startup-политика и middleware для закрытого dev API |

### Комнаты, бой и NPC

| Файл | Назначение |
|---|---|
| `room-lifecycle.js` | жизненный цикл эфемерных комнат встреч и мировых точек |
| `room-actor-spatial-index.js` | uniform-grid broad phase для коллизий плотной комнаты |
| `static-collision-spatial-index.js` | индекс authored static blockers для движения, LOS и A* |
| `model-colliders.js` | загрузка collider-каталога и преобразование bounds/parts в blockers |
| `enemy-ai.js` | серверный ИИ NPC: восприятие, преследование, координация ближнего боя |
| `combat-critical.js` | правила критических попаданий |
| `equipment-hands.js` | правила слотов рук (weapon/offhand) |
| `npc-inventory.js` | фракционные запасы, доктрины экипировки, инвентарь NPC, торговый и трупный лут |
| `npc-routines.js` | распорядок дня NPC поселений |
| `npc-smart-objects.js` | smart-объекты, к которым привязаны занятия NPC |
| `starting-loadout.js` | стартовый набор нового персонажа |

### Глобальная карта и живая пустошь

| Файл | Назначение |
|---|---|
| `wasteland-sim.js` | автономная глобальная симуляция: точки, отряды, экономика, конфликты, задания, world zones |
| `wasteland-party-speed.js` | чистые профили и пределы скорости мировых отрядов |
| `wasteland-party-membership.js` | нормализация состава отрядов, лимиты, patrol duty и сверка с персонажами |
| `wasteland-sim-utils.js` | нормализация значений, устойчивый PRNG, атомарное хранение состояния |
| `wasteland-factions.js` | нормализация фракций, столицы и инварианты защищённых столичных локаций |
| `wasteland-map-geometry.js` | масштаб карты, центры клеток, расстояния и радиусы входа |
| `wasteland-district-sites.js` | детерминированные районные точки интереса и охранные зоны столиц |
| `wasteland-localization.js` | миграционная локализация старых англоязычных названий |
| `wasteland-world-tasks.js` | нормализация схемы мировых заданий |
| `wasteland-site-instances.js` | устойчивые ID, seed и профили точек глобальной карты |
| `wasteland-stockpile.js` | чистые операции над складом и грузом |
| `wasteland-live-regions.js` | живые регионы, приоритетные события и aftermath-последствия |
| `faction-economy.js` | экономика фракционных узлов |
| `world-contracts.js` | нормализация мировых контрактов |
| `global-infrastructure.js` | дороги/трубопроводы, проверка суши и поиск маршрутов |
| `global-map-merge.js` | подмешивание авторской глобальной карты из поставки в runtime-карту |
| `global-exit-direction.js` | направление выхода из локальной карты на глобальную |
| `global-arrival-transition.js` | билет `pendingWorldDrop` подтверждённого прибытия (TTL 90 с) |
| `location-release.js` | релизный срез авторского мира: скрытые локации остаются в симуляции |

### Локальные активности

| Файл | Назначение |
|---|---|
| `world-activity-runtime.js` | жизненный цикл активностей комнаты и авторитетный прогресс |
| `world-activity-director.js` | режиссёр темпа: волны, замена потерянных целей, восстановление точек |
| `world-activity-layout.js` | пространственная схема столкновения: район целей, линии подхода |
| `world-activity-matchmaking.js` | серверный подбор событий и «Быстрая вылазка» |
| `player-activity-recovery.js` | планирование восстановления проваленных активностей игрока |
| `world-party-integrity.js` | контракт task/party, identity и целостность мировых групп |
| `onsite-party-formation.js` | формирование отряда на месте |

### Инфраструктура записи

| Файл | Назначение |
|---|---|
| `coalesced-writer.js` | single-flight таймер объединения частых JSON-записей |

Историческая копия `src/server/authoritative-server.js` удалена. Проверки
серверных контрактов читают только production-код и активные модули, поэтому
изменение неиспользуемого файла больше не может создать ложное ощущение
исправленного runtime.

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

Запись выполняется через временный файл и rename. Частые session-touch
обновления `users.json` объединяются, остальные изменения аккаунтов и
сохранений записываются немедленно. При ошибке чтения
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
