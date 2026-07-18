# Realm of Ashes — Wiki

Эта wiki описывает текущее состояние проекта, а не журнал патчей.

## Актуальные ключевые решения

- В игре один источник видимости: `isPointVisibleForGameplay(worldX, worldZ, options)`.
- Эту функцию используют крыша, NPC, игроки, враги, лут и интерактивные объекты.
- Здание торговца не имеет отдельной indoor-системы обзора.
- Крыша торговца — двухскатная деревянная крыша без отдельного конька.
- Крыша не исчезает геометрически: закрытые ячейки непрозрачные, видимые ячейки почти прозрачные.
- Статическое окружение под крышей остаётся отрисованным; fog-of-war скрывает только динамические и интерактивные сущности.
- Настоящие shadow-map тени временно отключены, используются дешёвые псевдо-тени.

## Основные страницы

- `PROJECT_OVERVIEW.md` — общий обзор проекта.
- `ARCHITECTURE.md` — структура клиента и сервера.
- `CLIENT_FILES.md` — разбиение клиентского JavaScript.
- `SERVER_FILES.md` — структура сервера.
- `CAMERA_AND_VISION.md` — камера, единая видимость, fog-of-war и line-of-sight.
- `ROOF_CUTAWAY_PERFORMANCE.md` — крыша торговца и производительность.
- `GRAPHICS_SETTINGS.md` — качество графики, render scale, тени.
- `KNOWN_BUGS.md` — актуальные ограничения и известные проблемы.
- `ROADMAP.md` — дальнейшие задачи.


## v7.74.95: tile-sized trader building blocks

The trader building shell is now rebuilt on the same `TILE` grid used by gameplay visibility. Wall visuals, wall collision, roof-mask cells and LOS blockers use matching 2m modules. The roof remains a simple two-slope shell; no separate ridge mesh is used. Static interior props remain rendered under the roof while dynamic/interactable objects use `isPointVisibleForGameplay()`.


## v7.74.96: square wall blocks and transparent window LOS

Trader wall modules now use a square `TILE x TILE` footprint in top-down space, not a thin wall strip. Collision follows the same square block footprint. Window cells remain physical wall/window modules for movement, but they are excluded from `traderBuildingVisionWalls()` so windows do not block the single gameplay visibility function. The roof mask, NPCs, players, loot and interactable objects continue to ask `isPointVisibleForGameplay()`.

## v7.74.97: trader building 10 × 8 grid

Trader building footprint is now exactly **10 × 8 world tiles**. The building origin is placed on a world tile corner so all wall blocks, collision boxes, roof-mask cells and LOS blockers align to the same `TILE` grid. Wall modules are full square `TILE × TILE` blocks in top-down space. The perimeter includes all corner cells; there are no half cells or empty grid corners. Window cells are physical window/wall cells for movement collision, but they are excluded from LOS blockers so they do not block `isPointVisibleForGameplay()`.



## Мобильная кнопка быстрого доступа v7.75.64

Кнопка ⚡ в правом боевом блоке открывает радиальное меню сразу по тапу, без удержания. Раскладка правого блока стала компактной: атака по центру, действие и автоприцел слева, перезарядка/режим/быстрый доступ справа вертикальной колонкой без пересечений.
