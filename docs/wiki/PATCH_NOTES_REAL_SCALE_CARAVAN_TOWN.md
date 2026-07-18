# v7.70.0 — Real Scale Caravan Town

Цель патча: убрать ощущение маленькой палатки и криво натянутой текстуры здания. Торговая локация теперь строится по реальному масштабу, а здание торговца собрано из отдельных модульных частей с отдельными PBR-материалами.

## Главное

- Удалён подход, при котором atlas `T_Buildings_Textures.png` от готового 3D-объекта натягивался на самодельное здание.
- Здание торговца пересобрано как настоящее здание, а не как навес/палатка.
- Использованы текстуры из пользовательского архива `Materials_WoodAndBricks_01(1).zip`:
  - `OldBricks_01`
  - `Concrete_DestroyedWall_01`
  - `Wooden_Floor_02`
  - `Wooden_Floor_04`
  - `WoodAndBricks_Floor_01`
- Для материалов подготовлены оптимизированные WebP-карты:
  - base color;
  - normal;
  - roughness;
  - ambient occlusion;
  - height/bump.

## Новый масштаб торгового здания

Система масштаба: `1 world unit ≈ 1 meter`.

```txt
trader_building_real_scale:
center: tile X=15, Y=20
world size: 10.4m x 7.2m
wall height: 3.35m
roof ridge: about 4.25m
front door width: 2.1m
front door height: 2.35m
front windows: 1.32m x 1.02m
side windows: 1.35m x 0.92m
```

Теперь здание выглядит как небольшая лавка/контора караванного двора, а не как палатка.

## Конструкция здания

Здание собрано отдельными мешами:

```txt
real-scale-shop-floor
shop-front-porch
shop-step
front-wall-left-real
front-wall-right-real
front-door-lintel-real
front-left-real-window
front-right-real-window
open-shop-door-leaf-real
door-jamb-left
door-jamb-right
back-wall-real
back-service-window-left
back-service-window-right
left-wall-real
right-wall-real
real-shop-corner-post
real-shop-ceiling
real-shop-roof-front
real-shop-roof-back
real-shop-roof-ridge
roof-rib-real
real-shop-sign-board
```

## Внутреннее наполнение

Внутри здания добавлены реальные функциональные зоны:

```txt
real-trader-counter-body
real-trader-counter-top
counter-back-rail
left-real-shop-shelf-frame
right-real-shop-shelf-frame
rear-storage-crate-large
rear-storage-cloth-bundle
rear-metal-safe-cabinet
rear-supply-box
real-shop-warm-lamp
```

## Барак и загон браминов

Чтобы поселение больше походило на городок караванщиков:

- барак увеличен до настоящей постройки примерно `8.8m x 4.2m`;
- загон для браминов увеличен примерно до `9.7m x 6.5m`;
- в загоне увеличены кормушка, поилка и зона сена.

## Оптимизация

- Старые PSX-building atlas-текстуры оставлены в проекте для совместимости, но новое торговое здание их больше не использует.
- Новые PBR-текстуры подготовлены в WebP, без добавления исходных 4K JPEG в сборку.
- Рендер торговой локации остаётся стабильным: culling для ручной диорамы не возвращался.

## Проверка

- `node tools/check-client-js.js` — OK
- `node tools/check-client-css.js` — OK
- `npm run check` — OK
