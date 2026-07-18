# Крыша торговца и производительность

## Текущая модель

Крыша торговца — простая двухскатная деревянная крыша без отдельного конька. Она состоит из двух цельных плоскостей: передний скат и задний скат.

Крыша не исчезает геометрически. При движении игрока не меняются matrix, visible, scale и count у roof mesh. Меняется только маленькая DataTexture alpha-mask.

## Как работает прозрачность

Каждая логическая ячейка крыши соответствует одной мировой `TILE`-ячейке и спрашивает главную функцию видимости:

```js
isPointVisibleForGameplay(worldX, worldZ, options)
```

- Видимая ячейка получает значение mask `255` и становится почти прозрачной.
- Невидимая/fogged ячейка получает значение mask `0` и остаётся непрозрачной.
- Nearest-фильтрация mask-текстуры делает переходы квадратами, а размер квадрата совпадает с мировой gameplay/fog-of-war ячейкой.
- Один single-pass материал смешивает opacity: closed `1.0`, open около `0.085`.

## Сетка крыши

Крыша не использует отдельный мелкий шаг вроде 1.18 world units. Маска строится по мировой сетке `TILE = 2.0`: одна tile-ячейка fog-of-war = одна ячейка alpha-mask крыши. Геометрия крыши может быть обрезана по краям ската, но выбор прозрачности всё равно идёт по полной мировой tile-ячейке.

## Почему не используется вырезание геометрии

Не использовать для крыши:

- удаление квадратов;
- `visible = false` для отдельных частей;
- сдвиг ячеек вниз;
- нулевой scale;
- обновление `instanceMatrix` при каждом шаге.

Эти подходы уже вызывали лаги или визуальные дыры. Текущий способ оставляет крышу стабильной и меняет только маленькую alpha-mask.

## Что не скрываем под крышей

Статическое окружение под крышей не скрывается. Оно может оставаться в сцене, потому что закрытая крыша сама перекрывает его визуально.

Fog-of-war применяется к NPC, игрокам, врагам, луту и интерактивным объектам. Это дешевле и понятнее, чем пытаться прятать всю статическую геометрию помещения.

## Тени

Настоящие shadow-map тени для крыши отключены. Используются псевдо-тени и baked/contact AO там, где это нужно визуально.


## v7.74.95: tile-sized trader building blocks

The trader building shell is now rebuilt on the same `TILE` grid used by gameplay visibility. Wall visuals, wall collision, roof-mask cells and LOS blockers use matching 2m modules. The roof remains a simple two-slope shell; no separate ridge mesh is used. Static interior props remain rendered under the roof while dynamic/interactable objects use `isPointVisibleForGameplay()`.


## v7.74.96: square wall blocks and transparent window LOS

Trader wall modules now use a square `TILE x TILE` footprint in top-down space, not a thin wall strip. Collision follows the same square block footprint. Window cells remain physical wall/window modules for movement, but they are excluded from `traderBuildingVisionWalls()` so windows do not block the single gameplay visibility function. The roof mask, NPCs, players, loot and interactable objects continue to ask `isPointVisibleForGameplay()`.

## v7.74.97: trader building 10 × 8 grid

Trader building footprint is now exactly **10 × 8 world tiles**. The building origin is placed on a world tile corner so all wall blocks, collision boxes, roof-mask cells and LOS blockers align to the same `TILE` grid. Wall modules are full square `TILE × TILE` blocks in top-down space. The perimeter includes all corner cells; there are no half cells or empty grid corners. Window cells are physical window/wall cells for movement collision, but they are excluded from LOS blockers so they do not block `isPointVisibleForGameplay()`.

