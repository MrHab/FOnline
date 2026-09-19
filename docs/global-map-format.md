# Формат глобальной карты

Файл карты хранится в `data/global-map.json`. География, узлы и маршруты
правятся в Unity-сцене и экспортируются оттуда, отдельные поля можно править
в файле вручную. Порядок экспорта описан в
[`KROMKA_UNITY_AUTHORING.md`](KROMKA_UNITY_AUTHORING.md).

Схема — `realm.globalMap.v1`. Сервер нормализует файл при старте
(`normalizeGlobalMapConfig`) и переписывает его обратно, поэтому неизвестные
поля не сохраняются.

- `worldRevision` — ревизия мира; у активной карты `kromka-1`. Из неё
  выводится `sitePlacement: unity-authored`: размещение мест задаёт Unity, а не
  процедурный генератор. `legacyCoastline: false` — маски берега нет.
- `unityScene` — авторская сцена-источник,
  `Assets/Scenes/Kromka/KromkaGlobalMap.unity`.
- `grid` — сетка: `cols`, `rows`, `cellPoints` (точек в клетке) и `cellKm`
  (километров в клетке). Активная карта — 38 × 30 клеток по 10 км и 10 точек в
  клетке, то есть поле координат 380 × 300 точек и мир 380 × 300 км.
- `nodes` — города и особые точки: `id`, `locationId`, координаты точки `x`/`y`,
  `kind` (`settlement`, `outpost`, `resource`, `clan_base`, `lair`, `complex`),
  `capital` и `capitalFaction`, `roadAccess`, `danger` (0–10), `model`,
  `modelScale`, `rotationY`, `macroRegion`, `visualProfile`, `note`. Поле
  `hidden: true` оставляет узел серверной точкой мира (выход из локации, место
  симуляции), но не отдаёт его клиентам и не рисует на карте — так скрыты базы
  Сердцевины. Для ревизии `kromka-1` сервер сохраняет точные авторские
  координаты, включая нулевые и дробные, и не притягивает узел к центру клетки.
- `infrastructure` — линии дорог и трубопроводов
  (`src/server/global-infrastructure.js`): `id`, `name`, `type` (`road` или
  `pipeline`), `model`, `walkable`, `travelFactor`, `width`,
  `allowCrossingsWith` и `points`; точка задаётся координатами или `nodeId`.
- `cells` — правила отдельных клеток. Ключ имеет вид `x:y`, счёт идёт с нуля.
  Поля клетки: `terrain`, `pvpMode`, `chance`, `difficulty`, `texture`,
  `macroRegion`, `fill`, `encounters`, `randomLocations`.
- `pvpMode` клетки принимает режим зоны (`peaceful`, `pve`, `pvp`, `pvpEvent`,
  `pvpFullDrop`, `pvpBlack`) и авторские псевдонимы вроде `safe`; правила
  режимов — `src/server/zone-rules.js`. Мирная клетка остаётся мирной, а цвет
  остальных считают опасные клетки (`src/server/danger-cells.js`) по правилам
  из `data/kromka/economy.json` и подмешивают в `/api/global-map`, не меняя файл.
- `encounters` внутри клетки задаёт веса случайных встреч; идентификаторы
  должны быть в общем списке `encounters` карты. `randomLocations` задаёт веса
  случайных локаций, которые могут открыться при входе в пустошь из этой клетки.
- `objects` — декоративные модели на клетках: `cx`/`cy`, `x`/`y`, `model`,
  `modelScale`, `rotationY`, `note`.

Если у клетки нет настройки в `cells`, игра использует процедурный профиль
пустоши для визуала, риска и встреч.
