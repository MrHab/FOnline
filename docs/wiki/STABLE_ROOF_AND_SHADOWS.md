# Стабильная крыша и тени

## Актуальное правило

Крыша здания торговца должна выглядеть как настоящая крыша: непрозрачная, текстурная, без общей стеклянной плёнки, без чёрных секций и без технических разрывов.

Крыша строится как несколько непрерывных плоскостей, а не как набор видимых box-квадратов. Логические клетки используются только для alpha-маски обзора и совпадают с мировой gameplay/fog-of-war сеткой.

## Как работает cutaway

Крыша не удаляется и не пересоздаётся. Геометрия после создания не двигается и не получает нулевой масштаб.

Открытие крыши работает через `DataTexture`-маску:

- `0` — участок крыши рисуется как обычная непрозрачная текстурная кровля;
- `255` — участок крыши становится почти прозрачным, если он попал в текущий обзор персонажа.

Если участок крыши находится в fog-of-war или вне единой `isPointVisibleForGameplay()`-видимости, он остаётся непрозрачным.

## Почему так

Предыдущие подходы давали проблемы:

- общая прозрачность всей крыши делала её похожей на стекло;
- скрытие/перемещение ячеек могло вызывать подвисание на телефонах;
- box-секции создавали чёрные полосы и разрывы;
- полное скрытие крыши раскрывало слишком много интерьера сразу.

Текущий подход оставляет крышу в стабильном render-пути и меняет только лёгкую alpha-маску.

## Тени крыши

Крыша не участвует в настоящем shadow-map pass:

- `castShadow = false`;
- `receiveShadow = false`;
- `forceNoShadow = true`.

Псевдо/contact-тени остаются. Настоящие динамические тени временно отключены глобально, чтобы не тратить мобильный бюджет.

## Видимость под крышей

Статические интерьерные объекты не переключаются по fog-of-war. Крыша сама скрывает их, когда она непрозрачная.

Fog-of-war должен скрывать только динамические и интерактивные сущности: NPC, игроков, трупы, лут и объекты взаимодействия.


## Актуальное состояние крыши

Real shadow-map shadows for the roof stay disabled. The roof itself is always rendered as a continuous wood surface; visible cells use low alpha instead of `visible=false`, zero scale, matrix edits, or removed meshes.


Крыша торговца использует текстуру `trader_roof_wood_planks_v77490.webp`. Отрисовка идёт одним single-pass материалом: закрытые world-tile ячейки остаются непрозрачными, видимые world-tile ячейки становятся почти прозрачными через DataTexture alpha-mask. Отдельного ghost-прохода, скрытия mesh, перемещения геометрии и отдельной indoor-системы обзора нет.


## v7.74.95: tile-sized trader building blocks

The trader building shell is now rebuilt on the same `TILE` grid used by gameplay visibility. Wall visuals, wall collision, roof-mask cells and LOS blockers use matching 2m modules. The roof remains a simple two-slope shell; no separate ridge mesh is used. Static interior props remain rendered under the roof while dynamic/interactable objects use `isPointVisibleForGameplay()`.


## v7.74.96: square wall blocks and transparent window LOS

Trader wall modules now use a square `TILE x TILE` footprint in top-down space, not a thin wall strip. Collision follows the same square block footprint. Window cells remain physical wall/window modules for movement, but they are excluded from `traderBuildingVisionWalls()` so windows do not block the single gameplay visibility function. The roof mask, NPCs, players, loot and interactable objects continue to ask `isPointVisibleForGameplay()`.

## v7.74.97: trader building 10 × 8 grid

Trader building footprint is now exactly **10 × 8 world tiles**. The building origin is placed on a world tile corner so all wall blocks, collision boxes, roof-mask cells and LOS blockers align to the same `TILE` grid. Wall modules are full square `TILE × TILE` blocks in top-down space. The perimeter includes all corner cells; there are no half cells or empty grid corners. Window cells are physical window/wall cells for movement collision, but they are excluded from LOS blockers so they do not block `isPointVisibleForGameplay()`.

