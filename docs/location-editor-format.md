# Формат локации `realm.location.v1`

Редактор `public/dev-location-editor.html` сохраняет локацию в JSON в папку `data/locations/`.
Сервер читает эти файлы при старте и перекрывает ими встроенные резервные описания локаций.

Dev API по умолчанию закрыт. Для локального редактора запустите сервер из
PowerShell так:

```powershell
$env:DEV_API_MODE='local'
npm start
```

Открывайте <http://127.0.0.1:3000/dev-location-editor.html>. Local-режим не
принимает LAN-, proxy-, DNS-rebinding и cross-site form-запросы, запрещён при
`NODE_ENV=production` и принимает изменения только как JSON. Редактор
автоматически добавляет защищающий от CSRF заголовок `X-Dev-Local: 1`.

Для непубличного token-режима задайте `DEV_API_MODE=token` и случайный
`DEV_ADMIN_TOKEN` длиной не менее 32 UTF-8 байт. Например, в PowerShell:

```powershell
$env:DEV_ADMIN_TOKEN = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:DEV_API_MODE = 'token'
npm start
```

Редактор запросит токен и сохранит его только в `sessionStorage` текущей
вкладки. Штатный production Nginx token-режим наружу не публикует.

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

`pvpMode` задает правила боя между игроками:

- `peaceful` - мирная локация. PvP-урон запрещен.
- `pvp` - PvP разрешен, но рюкзак не выпадает полностью при смерти.
- `pvpFullDrop` - PvP разрешен, при смерти содержимое рюкзака выпадает на землю.

Поле `safe` сохраняется для совместимости со старыми локациями: `peaceful` экспортируется как `safe: true`, оба PvP-режима как `safe: false`.

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
  "shape": "edges",
  "label": "Край стоянки",
  "tx": 19,
  "tz": 2,
  "radius": 4,
  "edgeWidth": 4,
  "position": { "x": 0, "y": 0, "z": 0 },
  "edges": ["north", "south", "west", "east"]
}
```

В редакторе выход на глобальную карту всегда представлен как зона по границам текущей локации. `edgeWidth` задает ширину полосы от края карты внутрь, а `radius` оставлен как совместимое поле для старой серверной логики.

Для интеграции достаточно пройти по `objects`, загрузить `url` или модель по ключу `model`, применить `position`, `rotation.y`, `scale` и создать игровую коллизию по полю `collision`. Переходы читать из `transitions`, выходы на глобальную карту из `worldZones`, а визуальный стиль земли из `ground.preset` и `ground.texture`.

## Текстуры земли

Редактор использует PBR-пресеты из `public/assets/textures/`:

- `traderYard` - земля стоянки Старого Клима: base, normal, roughness.
- `reliefWasteland` - рельефная пустошь: base, normal, roughness, AO, height.
- `destroyedConcrete` - разрушенный бетон: base, normal, roughness, AO, height.

Если PBR-набор не указан, редактор использует процедурную запасную текстуру, но стандартные пресеты локаций должны ссылаться на реальные PBR-карты.

## Правила модульных блоков зданий

Блоки Старого Клима предназначены для ручной сборки зданий по сетке. Для них действует отдельное правило:

- `traderWallBlock` занимает одну ячейку `2 x 2` метра и имеет высоту `1` метр.
- `traderWindowBlock` занимает одну ячейку `2 x 2` метра и имеет высоту `1` метр.
- `traderFloorSlab` занимает одну ячейку `2 x 2` метра, низ модели находится на земле.
- `traderRoofBlock` занимает одну ячейку `2 x 2` метра, толщина крыши `0.20` метра; текущая процедурная крыша торговца использует центр около `y = 5.32`.

Дополнительные универсальные блоки используют те же размеры и правила сетки:

- Стены: `wallWoodBlock`, `wallBrickBlock`, `wallMetalBlock`.
- Крыши: `roofWoodBlock`, `roofMetalBlock`.
- Полы: `floorWoodBlock`, `floorTileBlock`.

Редактор размещает эти блоки только по двухметровой сетке, новый блок ставится с нижней точкой на `y = 0`, а масштаб блоков фиксируется `1 x 1 x 1`. При экспорте редактор добавляет к таким объектам поля `footprint`, `building` и, для стен/окон/крыши, `occlusion`. Поле `occlusion.mode = "traderCutaway"` сохраняет связь с механикой скрытия стен и крыши, которая используется в здании торговца.

## Интерактивные объекты и NPC

Редактор добавляет готовые модели хранилища, торговцев, дружественных NPC и враждебных существ. При экспорте такие объекты получают обязательные теги и дополнительное описание:

- `interactive` используется для контейнеров, например `storageChest` сохраняется как `{ "kind": "container", "role": "storage", "containerType": "storage" }`.
- `entity` используется для NPC и существ. Внутри сохраняются `kind`, `role`, `faction`, `hostileToPlayer`, а для врагов еще `enemyType`.
- Дружественные NPC имеют `hostileToPlayer: false`; враги имеют `hostileToPlayer: true`.
- Торговцы получают `role: "merchant"` и `traderProfile`, чтобы игровая логика могла привязать профиль товаров.

Пример NPC в `objects`:

```json
{
  "id": "obj_0012",
  "model": "enemyRadscorpion",
  "name": "Радскорпион",
  "url": "/assets/models/wasteland/npc_radscorpion.glb",
  "position": { "x": 8, "y": 0, "z": -6 },
  "rotation": { "x": 0, "y": 0, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 },
  "collision": "solid",
  "tags": ["npc", "enemy", "hostile", "radscorpion"],
  "entity": {
    "kind": "npc",
    "role": "monster",
    "species": "radScorpion",
    "faction": "radscorpions",
    "enemyType": "radScorpion",
    "hostileToPlayer": true
  }
}
```

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
  "id": "caravan_sayla_cot",
  "model": "cotBed",
  "position": { "x": -9, "y": 0, "z": 7 },
  "activitySlots": [
    {
      "id": "caravan_sayla_bed",
      "type": "bed",
      "capacity": 1,
      "ownerNpcId": "caravan_sayla",
      "position": { "x": -9, "y": 0, "z": 7 },
      "rotationY": 1.5707963267948966,
      "visualAction": "sleep"
    }
  ]
}
```

- ID слота должен быть уникальным внутри локации и не меняться при пересохранении карты.
- `type` — семантический тип, например `bed`, `shop`, `social`, `work` или `guard`.
- `capacity` ограничивает число NPC, которые могут одновременно зарезервировать точку.
- `ownerNpcId` задается только для личного слота. Такой слот не должен выбираться другими NPC.
- `position` — абсолютная точка в метрах локации. Её задают у края объекта, если его центр закрыт коллизией.
- `rotationY` задает точное направление NPC после достижения точки.
- `visualAction` задаёт семантическую анимацию: `sleep`, `shop`, `social`, `work` или `guard`.
- Слоты нельзя привязывать к синтезируемому объекту столичного хранилища с тегом `capital-storage`:
  сервер заменяет его нормализованным объектом. Для слота выбирают обычный authored-объект локации.
- При загрузке и повторном экспорте редактор сохраняет `activitySlots` и авторские поля `entity`,
  включая `npcId` и `routineId`; отредактированные координаты, поворот, масштаб, теги и коллизия при этом
  остаются авторитетными.

Файл `data/npc-routines.json` имеет схему `realm.npc-routines.v1`. Ключи в `routines` совпадают с `routineId`,
а каждый пакет содержит:

- стабильные `id` и `type`;
- игровое окно `[startHour, endHour)`, где окно с `startHour > endHour` переходит через полночь;
- `priority` для выбора из нескольких допустимых пакетов;
- `target.slotId` для точной цели или `target.slotType` для любого свободного слота этого типа;
- `interruptPolicy` — когда пакет можно прервать; для текущей схемы используется `immediate`;
- `resumePolicy` — продолжить тот же пакет (`resume`) или повторно оценить распорядок (`reevaluate`);
- `serviceAvailable` — доступен ли сервис NPC во время этого пакета. Для торговца `true` ставится только в рабочие часы.
