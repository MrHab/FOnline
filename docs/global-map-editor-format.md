# Формат глобальной карты

Файл карты хранится в `data/global-map.json` и редактируется через `/dev-global-map-editor.html`.

Редактор использует закрытый dev API. Для локальной работы запустите сервер с
`DEV_API_MODE=local` и открывайте
<http://127.0.0.1:3000/dev-global-map-editor.html>. Production Nginx и
production-процесс редактор не публикуют; режимы и token-доступ описаны в
[формате локальной локации](location-editor-format.md).

Схема — `realm.globalMap.v1`. Сервер нормализует файл при старте
(`normalizeGlobalMapConfig`) и переписывает его обратно, поэтому неизвестные
поля не сохраняются.

- `worldRevision` — ревизия мира; у активной карты `kromka-1`. Из неё
  выводится `sitePlacement: unity-authored`: размещение мест задаёт Unity, а не
  процедурный генератор. Водой считаются только клетки с водной `texture`
  (`water`, `ocean`, `sea`, `lake`); маски берега у карты нет.
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
  Поля клетки: `terrain`, `pvpMode`, `difficulty`, `texture`, `macroRegion`,
  `fill`.
- `pvpMode` клетки принимает режим зоны (`peaceful`, `pve`, `pvp`, `pvpEvent`,
  `pvpFullDrop`, `pvpBlack`) и редакторские псевдонимы вроде `safe`; правила
  режимов — `src/server/zone-rules.js`. Мирная клетка остаётся мирной, а цвет
  остальных считают опасные клетки (`src/server/danger-cells.js`) по правилам
  из `data/kromka/economy.json` и подмешивают в `/api/global-map`, не меняя файл.
- Шанса стычки, состава встреч и случайных локаций в файле карты нет: их задаёт
  цвет клетки через `dangerCells` в `data/kromka/economy.json` (`encounterChance`,
  `encounters`, `templates`). В `/api/global-map` сервер добавляет клетке
  `chance` — настоящий шанс стычки в процентах на одну мелкую клетку пути без
  поправки на навык странника; у сквозных клеток он равен нулю.

Если у клетки нет настройки в `cells`, игра использует процедурный профиль
пустоши для визуала, риска и встреч.

Редактор рассчитан на прежнюю сетку 30 × 30 клеток по 30 точек и не берёт
размеры из `grid`, поэтому для карты `kromka-1` он остаётся инструментом
просмотра и точечной правки клеток. География, узлы и маршруты правятся в
Unity и экспортируются оттуда — порядок описан в
[`KROMKA_UNITY_AUTHORING.md`](KROMKA_UNITY_AUTHORING.md).
