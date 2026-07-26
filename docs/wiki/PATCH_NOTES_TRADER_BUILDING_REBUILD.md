# Realm of Ashes v7.69.0 — Trader Building Rebuild

Цель патча — заменить торговый навес на настоящее здание торговца и убрать ощущение временных предметов неправильного масштаба.

## Главное

- Торговец больше не стоит под открытым навесом.
- В первой локации добавлено полноценное торговое здание с:
  - полом;
  - стенами;
  - потолком;
  - крышей;
  - дверным проёмом;
  - открытой створкой двери;
  - окнами;
  - прилавком;
  - внутренними полками;
  - складским углом.
- Стены здания собраны процедурно из простых низкополигональных модулей, но используют текстуры из архива `PSXBuildings.zip`.
- Для здания добавлены PBR-материалы:
  - base color;
  - normal map;
  - roughness map;
  - ambient occlusion map.
- Крыша стала cutaway-прозрачной рядом с игроком, чтобы здание имело крышу, но не закрывало торговца и проход.
- Масштаб здания привязан к игроку: дверь, окна, прилавок и полки больше не выглядят игрушечными.

## Использованные ассеты

Источник: `PSXBuildings.zip`

В архиве:

```text
PSXBuildings/PSX_Buildings.fbx
source-assets/psx-buildings/T_Buildings_Textures.png
```

В проект добавлены:

```text
source-assets/psx-buildings/T_Buildings_Textures.png
public/assets/models/psx_buildings/PSX_Buildings.fbx
public/assets/textures/psx_buildings/*_base_v769.webp
public/assets/textures/psx_buildings/*_normal_v769.webp
public/assets/textures/psx_buildings/*_roughness_v769.webp
public/assets/textures/psx_buildings/*_ao_v769.webp
public/assets/textures/psx_buildings/asset_manifest_v769.json
```

FBX сохранён в проекте как исходник, но игровая сцена использует собственные оптимизированные модульные меши и WebP-карты, чтобы не подключать тяжёлый загрузчик FBX в рантайме.

## Размещение здания

Система координат текущей карты:

```text
TILE = 2.0 world units
MAP = 38 x 38
Origin для планировки = тайловые координаты X/Z
```

Торговое здание:

```text
trader_building:
  center tile: tx=15 tz=20
  world center: tileToWorld(15,20)
  rotation: -0.04 rad
  world size: width=7.6 depth=5.8 height=2.45
  roof height: 2.73
  door side: south/front
```

Внутренние элементы здания:

```text
trader_counter:
  local x=1.15 z=0.88
  size=2.10 x 0.46

left_shelf:
  local x=-2.95 z=1.15
  size=0.32 x 2.35

right_shelf:
  local x=2.95 z=1.20
  size=0.32 x 2.18

back_stock_crate:
  local x=-1.82 z=-1.80

metal_locker:
  local x=-1.20 z=-1.72

outside_stock_box:
  local x=-3.15 z=-3.20

outside_locker:
  local x=3.05 z=-3.10
```

Окна:

```text
front_left_window:
  local x=-2.95 y=1.32 z=-2.925

front_right_window:
  local x=2.95 y=1.32 z=-2.925

back_left_window:
  local x=-1.58 y=1.42 z=2.925

back_right_window:
  local x=1.62 y=1.42 z=2.925

left_side_window:
  local x=-3.825 y=1.30 z=-0.78

right_side_window:
  local x=3.825 y=1.30 z=0.82
```

Дверь:

```text
front_door_open_leaf:
  local x=-0.82 y=0.95 z=-3.16
  rotation y=-0.82
```

## Технические изменения

### Новые функции

```text
matPsxBuilding()
createBuildingBox()
createBuildingWindow()
addTraderBuildingInterior()
createTraderBuilding()
updateTraderBuildingRoofCutaway()
```

### Стабильность рендера

- Все части торгового здания получают `markNoRuntimeCull`, как остальная ручная диорама первой локации.
- Крыша не удаляется и не пересоздаётся во время движения, а только плавно меняет opacity.
- При пересборке локации список roof cutaway-объектов очищается.

### Загрузка

Экран загрузки поселения теперь заранее подгружает основные карты торгового здания:

- металл;
- ржавый профнастил;
- бетонный пол;
- крыша;
- окно.

## Проверка

```text
npm run check — OK
node tools/check-client-js.js — OK
node tools/check-client-css.js — OK
```
