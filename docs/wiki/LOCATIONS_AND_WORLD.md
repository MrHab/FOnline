# Локации и мир

## Текущие локации

### Караванный двор Старого Клима

Стартовая безопасная локация. Здесь находится здание торговца, точка торговли, хранилище и переход в пустошь. Локация развивается как поселение караванщиков, но текущий фокус — правильная работа здания, обзора, крыши, света и теней.

### Пепельный лес

Опасная локация с врагами, ресурсами, контейнерами и переходом обратно в поселение.

## Переходы

Переход между локациями идёт через серверное событие `changeRoom`. На клиенте показывается экран загрузки, чтобы игрок не видел момент пересборки сцены.

## Террейн

Земля строится как слоёный PBR-террейн:
- базовый материал;
- песок;
- трещины;
- гравий;
- следы шин;
- гарь/грязь;
- AO/контактные слои.

Карта может использовать технические клетки, но визуально не должна быть расчерчена квадратами.

## Здание торговца

Здание торговца — полноценная постройка со стенами, полом, окнами с решётками, дверным проёмом, крышей по сетке и интерьером.

Ключевые правила:
- потолков нет, чтобы крыша могла открывать помещение;
- крыша разделена на квадратные ячейки;
- интерьер скрывается fog-of-war, если игрок не видит его через line-of-sight;
- стены блокируют обзор так же, как деревья;
- освещение интерьера не раскрывает комнату через стены.

## Коллизии

Для крупных объектов используются простые AABB-боксы. Нельзя использовать тяжёлые mesh-collision для мелкого декора.

Игрок не должен проходить через:
- стены;
- прилавок;
- крупные полки;
- контейнеры;
- заборы;
- ворота и большие объекты.


## v7.74.95: tile-sized trader building blocks

The trader building shell is now rebuilt on the same `TILE` grid used by gameplay visibility. Wall visuals, wall collision, roof-mask cells and LOS blockers use matching 2m modules. The roof remains a simple two-slope shell; no separate ridge mesh is used. Static interior props remain rendered under the roof while dynamic/interactable objects use `isPointVisibleForGameplay()`.


## v7.74.96: square wall blocks and transparent window LOS

Trader wall modules now use a square `TILE x TILE` footprint in top-down space, not a thin wall strip. Collision follows the same square block footprint. Window cells remain physical wall/window modules for movement, but they are excluded from `traderBuildingVisionWalls()` so windows do not block the single gameplay visibility function. The roof mask, NPCs, players, loot and interactable objects continue to ask `isPointVisibleForGameplay()`.

## v7.74.97: trader building 10 × 8 grid

Trader building footprint is now exactly **10 × 8 world tiles**. The building origin is placed on a world tile corner so all wall blocks, collision boxes, roof-mask cells and LOS blockers align to the same `TILE` grid. Wall modules are full square `TILE × TILE` blocks in top-down space. The perimeter includes all corner cells; there are no half cells or empty grid corners. Window cells are physical window/wall cells for movement collision, but they are excluded from LOS blockers so they do not block `isPointVisibleForGameplay()`.

