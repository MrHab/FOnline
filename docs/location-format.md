# Формат локации `realm.location.v1`

Файлы локаций лежат в `data/locations/`. Сервер читает их при старте и
перекрывает ими встроенные резервные описания локаций. Локации Кромки
экспортируются из Unity-сцен (поле `unityScene`), точечные правки делаются
прямо в JSON. Порядок экспорта описан в
[`KROMKA_UNITY_AUTHORING.md`](KROMKA_UNITY_AUTHORING.md).

Минимальная структура:

```json
{
  "schema": "realm.location.v1",
  "version": 1,
  "id": "custom_wasteland_site",
  "name": "Новая локация",
  "pvpMode": "peaceful",
  "safe": true,
  "units": "game-meters",
  "grid": { "snap": true, "step": 1 },
  "map": { "width": 48, "depth": 48, "origin": "center" },
  "spawn": { "x": 0, "y": 0, "z": 0, "rotationY": 0 },
  "entry": { "x": 0, "y": 0, "z": 0, "rotationY": 0 },
  "ground": { "preset": "caravanYard", "label": "Утоптанная земля стоянки", "texture": "traderYard" },
  "transitions": [],
  "worldZones": [],
  "objects": []
}
```

`pvpMode` задаёт режим зоны. Правила PvP и потерь считает
`src/server/zone-rules.js` и публикует в `zoneRules` до входа:

- `peaceful` — мирная локация, PvP-урон запрещён;
- `pve` — PvP запрещён, но NPC враждебны и локация не считается безопасной;
- `pvp` — PvP разрешён, предметы при смерти сохраняются, надетое изнашивается;
- `pvpEvent` — PvP разрешён, потерь нет (временные публичные события);
- `pvpFullDrop` — частичная потеря: выпадает содержимое инвентаря, а экипировка,
  экипированный рюкзак, экипированный контейнер и установленные в него
  стабилизированные артефакты сохраняются;
- `pvpBlack` — выпадает всё, включая экипировку и установленные артефакты;
  часть выпавшего становится ломом.

Сервер понимает и авторские псевдонимы (`safe`, `nopvp`, `red`, `black`,
`event` и другие — таблица `ZONE_MODE_ALIASES`).

Поле `safe` сохраняется для совместимости со старыми локациями: `peaceful`
экспортируется как `safe: true`, остальные режимы как `safe: false`.

Размер сцены задаётся `map.width/depth` в метрах, верхнего предела нет: сервер
берёт сетку тайлов из локации, а не из общей константы.

Каждый объект:

```json
{
  "id": "obj_0001",
  "model": "crate",
  "name": "Ящик",
  "url": "/assets/models/wasteland/crate.glb",
  "position": { "x": 3, "y": 0, "z": -2 },
  "rotation": { "x": 0, "y": 1.5708, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 },
  "collision": "solid",
  "tags": ["loot"]
}
```

`collision`:
- `solid` - объект блокирует проход.
- `cover` - объект блокирует проход и может использоваться как укрытие.
- `resource` - объект является добываемым ресурсом.
- `decoration` - декоративный объект с возможной логикой, но без обязательной физики.
- `none` - объект не мешает движению.

Обзор задаётся отдельным вложенным полем `vision`, потому что проход, укрытие и
линия взгляда — разные системы. Принимаются `{ "blocks": true }` (стена),
`{ "cover": true }` или `{ "lowCover": true }` (низкое укрытие),
`{ "blocks": false }` (сквозной объект) и эквивалентная форма
`{ "mode": "block" | "cover" | "none" }`. Без этого поля вердикт выводится из
реестра моделей, роли `occlusion`, тегов и режима коллизии. Старые поля
`blocksVision` и `visionPortal` текущей схемой не являются.

Переход между локациями:

```json
{
  "id": "north_gate",
  "type": "location",
  "label": "Северные ворота",
  "to": "wasteland",
  "entryKey": "entryFromSettlement",
  "tx": 19,
  "tz": 8,
  "radius": 2.4,
  "position": { "x": 1, "y": 0, "z": -21 }
}
```

Зона выхода на глобальную карту:

```json
{
  "id": "world_exit_edges",
  "type": "globalMap",
  "label": "Уйти на глобальную карту",
  "tx": 19,
  "tz": 2,
  "radius": 4
}
```

Сервер читает зону как точку `tx`/`tz` с радиусом `radius` (0,5–18 м), так её
нормализует `normalizeLocationDefinition`. `type` по умолчанию — `globalMap`;
`factionPlatform` с `factionId` отмечает платформу фракции в Сердцевине. Поля
`shape`, `edgeWidth` и `edges` сервер и клиент не читают.

Для интеграции достаточно пройти по `objects`, загрузить `url` или модель по ключу `model`, применить `position`, `rotation.y`, `scale` и создать игровую коллизию по полю `collision`. Переходы читать из `transitions`, выходы на глобальную карту из `worldZones`, а визуальный стиль земли из `ground.preset` и `ground.texture`.

## Роли перекрытия

Поле `occlusion.role` (`wall`, `window`, `roof`, `floor`) участвует в расчёте
обзора: стена перекрывает линию взгляда, окно, крыша и пол — нет. Прозрачность
крыши над персонажем клиент включает по тегу `trader-cutaway`/`roof-cutaway`
или по `occlusion.cutaway: true`.

## Интерактивные объекты и NPC

Хранилища, торговцы, дружественные NPC и существа несут обязательные теги и дополнительное описание:

- `interactive` используется для контейнеров, например у `storageChest` это `{ "kind": "container", "role": "storage", "containerType": "storage" }`.
- `entity` используется для NPC и существ. Внутри лежат `kind`, `role`, `faction`, `hostileToPlayer`, а у существ — `creatureTypeId`.
- Дружественные NPC имеют `hostileToPlayer: false`; враги имеют `hostileToPlayer: true`.
- Торговцы получают `role: "merchant"` и `traderProfile`, чтобы игровая логика могла привязать профиль товаров.

Вид существа задаёт `entity.creatureTypeId` — единственное поле, по которому
сервер выбирает тип. Допустимые значения — идентификаторы каталога
`data/mutants.json`: `burned` (Выжженный), `fold` (Складень), `gari` (Гарь),
`rykhlyak` (Рыхляк), `dustling` (Пыльник), `listener` (Слухач), `mourner`
(Плакальщик), `lantern` (Фонарник). Человеческий противник — налётчик —
задаётся не существом, а моделью `enemyRaider` с `role: "raider"`.

Без `creatureTypeId` сервер разбирает `model`, `name`, `species`, `enemyType`,
`profile` и теги как текст и сопоставляет их с прежними идентификаторами из
`legacyAliases` каталога. Это путь совместимости для старых карт; в новых
объектах поля `species`/`enemyType` не нужны. Ключи моделей и файлы GLB тоже
остались прежними (`enemyGecko` → `npc_gecko.glb`), поэтому имя модели и вид
существа не совпадают — это нормально, вид берётся из `creatureTypeId`.

Пример существа в `objects`:

```json
{
  "id": "service_guard_4",
  "model": "enemyGecko",
  "name": "Слухач",
  "position": { "x": 8, "y": 0, "z": 20 },
  "rotation": { "x": 0, "y": 0, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 },
  "collision": "solid",
  "tags": ["npc", "enemy", "hostile", "monster"],
  "entity": {
    "kind": "npc",
    "role": "monster",
    "creatureTypeId": "listener",
    "faction": "wild",
    "hostileToPlayer": true
  }
}
```

Авторские `entity.hp`, `entity.atk` и `entity.speed` перекрывают характеристики
каталога для конкретного объекта — так внутренние секции лабораторий населены
теми же видами, но сильнее.

## Распорядки NPC и слоты активности

Именные, квестовые и сервисные NPC могут иметь стабильную личность и ссылку на
распорядок. Эти поля хранятся в `entity`:

```json
{
  "kind": "npc",
  "npcId": "caravan_sayla",
  "routineId": "caravan_sayla",
  "role": "merchant",
  "stationary": false
}
```

- `npcId` — уникальный и стабильный ID именного NPC. Его не нужно назначать случайно создаваемой
  фоновой толпе.
- `routineId` — ключ распорядка из `data/npc-routines.json`.
- NPC, который должен ходить между точками распорядка, не должен быть принудительно стационарным.

Точки сна, работы, торговли, общения и охраны задаются массивом `activitySlots` на существующем
объекте локации:

```json
{
  "id": "capital_station_caravans_chem_station",
  "model": "craftStationChem",
  "position": { "x": -6, "y": 0, "z": -4 },
  "activitySlots": [
    {
      "id": "caravan_sayla_shop",
      "type": "shop",
      "capacity": 1,
      "position": { "x": -5, "y": 0, "z": 9 },
      "rotationY": 0,
      "visualAction": "shop"
    }
  ]
}
```

- ID слота должен быть уникальным внутри локации и не меняться при пересохранении карты.
- `type` — семантический тип: `shop`, `social`, `work` или `guard`. Сна у NPC нет,
  поэтому слотов `bed`/`sleep` и коек в локациях не бывает.
- `capacity` ограничивает число NPC, которые могут одновременно зарезервировать точку.
- `ownerNpcId` задается только для личного слота. Такой слот не должен выбираться другими NPC.
- `position` — абсолютная точка в метрах локации. Её задают у края объекта, если его центр закрыт коллизией.
- `rotationY` задает точное направление NPC после достижения точки.
- `visualAction` задаёт семантическую анимацию: `shop`, `social`, `work` или `guard`.
- Слоты нельзя привязывать к синтезируемому объекту столичного хранилища с тегом `capital-storage`:
  сервер заменяет его нормализованным объектом. Для слота выбирают обычный authored-объект локации.

Файл `data/npc-routines.json` имеет схему `realm.npc-routines.v1`. Ключи в `routines` совпадают с `routineId`,
а каждый пакет содержит:

- стабильные `id` и `type`;
- `priority` для выбора из нескольких допустимых пакетов;
- `target.slotId` для точной цели или `target.slotType` для любого свободного слота этого типа;
- `interruptPolicy` — можно ли прервать пакет; по умолчанию `interruptible`;
- `resumePolicy` — продолжить тот же пакет (`resume`) или повторно оценить распорядок (`reevaluate`);
- `serviceAvailable` — доступен ли сервис NPC во время этого пакета.

Времени суток в игре нет, поэтому у роли ровно одно постоянное поведение:
окон по часам в пакете не бывает, а прерывания задаются отдельно (бой, тревога,
диалог, проверка шума) и после них NPC возвращается к тому же пакету.
