# Интеграция моделей предметов

Все игровые GLB предметов, экипировки, костюмов и носимых устройств собираются
детерминированными сборщиками из `tools/` и не редактируются вручную. Каждый
сборщик пишет манифест рядом с моделями и тут же обновляет константу версии
каталога в C#, чтобы браузер не подставил старую модель из кеша.

## Каталоги

| Каталог | Манифест | Состав | Версия в Unity |
| --- | --- | --- | --- |
| Оружие | `public/assets/models/weapons/manifest.json` | 16 моделей оружия и инструментов | `RoaModelUrl.WeaponCatalogVersion` |
| Предметы | `public/assets/models/items/kromka/manifest.json` | 23 модели, включая аптечку, детекторы, пояса и артефакты | `RoaItemModelCatalog.CatalogVersion` |
| Экипировка | `public/assets/models/equipment/free-v2/manifest.json` | 60 вариантов шлемов, обуви, брони и рюкзака для 6 тел | `RoaEquipmentModelCatalog.CatalogVersion` |
| Костюмы | `public/assets/models/equipment/suits-v2/manifest.json` | 12 вариантов химзащиты и энергокостюма | `RoaSuitModelCatalog.CatalogVersion` |
| Носимые устройства | `public/assets/models/equipment/utilities-v1/manifest.json` | 288 вариантов детекторов и поясов для 6 тел и 8 вариантов брони | `RoaWornUtilityCatalog.CatalogVersion` |
| Наземные предметы | `public/assets/models/items/manifest.json` | одна библиотека `ground_item_library.glb` на 24 предмета | — |

Версия каталога — отпечаток содержимого: `1-` плюс начало SHA-256 от склеенных
хэшей файлов манифеста. Проверка требует, чтобы C#-константа совпадала с
манифестом, поэтому подменить модель без пересборки каталога нельзя.

## Сборка

```text
npm run build:free-items        # предметы, артефакты, детекторы
npm run build:free-equipment    # шлемы, обувь, броня, рюкзак
npm run build:layered-suits     # химзащита и энергокостюм
npm run build:worn-utilities    # детекторы и пояса поверх экипировки
npm run build:ground-items      # библиотека наземных предметов
npm run build:models-lite       # облегчённые копии всех GLB
```

Сборщикам нужен Blender 4.5; путь задаётся `REALM_BLENDER_EXE`. Каждый из них
скачивает или сверяет CC0-доноров, запускает Blender-скрипт из `tools/blender/`,
прогоняет результат через `tools/optimize-glb.js`, обновляет манифест и версию
каталога в Unity и завершает работу соответствующей проверкой.

`tools/build-ground-item-models.js` ничего не генерирует: он копирует
утверждённую библиотеку из `docs/art/reviews/ground-item-library-v1/` в
`public/assets/models/items/`, предварительно сверив SHA-256 review-GLB, стиль
`geometry_b_materials_c` и наличие корня `ground_item_<id>` для всех 24 предметов.

## Облегчённые копии

`tools/optimize-glb.js` не трогает оригиналы (их хэши закреплены пайплайном
утверждения) и пишет копии в `public/assets/models-lite/` с тем же относительным
путём. Каталог в `.gitignore` и создаётся при деплое. Применяются только
`dedup`, `prune`, `resample` и перевод PNG → JPEG для текстур непрозрачных
материалов. Квантование, Meshopt, Draco и KTX2 не применяются: серверные
инструменты коллайдеров читают вершины напрямую
(`tools/model-collider-geometry.js`), а декодеры потребовали бы отдельной
поддержки на клиенте.

`RoaModelUrl.Lite()` подменяет `/assets/models/` на `/assets/models-lite/`, пока
включён `UseLite`, и дописывает оружию `?v=weapon-catalog-<версия>`: имена
файлов оружия стабильны между пересборками, поэтому ревизия каталога нужна
именно в запросе. Сервер отдаёт облегчённую копию, а при её отсутствии —
оригинал (`server.js`, маршрут `/assets/models-lite`).

## Сторона Unity

`RoaModelPrefabCatalog` — build-time ссылки на префабы моделей. Полная
библиотека лежит в `Assets/Prefabs/Models`, а лёгкий ресурсный каталог
`Resources/RealmOfAshes/GlobalMapModelPrefabs` содержит только те модели,
которым неоткуда взять ссылку из сцены. Сетевая загрузка GLB остаётся
совместимым запасным путём.

Каталоги предметов, экипировки, костюмов и носимых устройств
(`RoaItemModelCatalog`, `RoaEquipmentModelCatalog`, `RoaSuitModelCatalog`,
`RoaWornUtilityCatalog`) собирают URL по id предмета, телу и версии каталога.

## Проверки

```text
npm run check:ground-items
```

Цепочка проверяет библиотеку наземных предметов и вызывает
`check:free-items`, `check:free-equipment`, `check:worn-utilities` и
`check:layered-suits`. Каждая проверка сверяет хэши и размеры файлов манифеста,
происхождение CC0-доноров (для предметов — по
`source-assets/items/free-catalog-v1/sources.json`), совпадение версии каталога
с C# и наличие id в
`data/kromka/items.json` или `data/artifacts.json`. У предметов и носимых
устройств дополнительно проверяется бюджет мобильной загрузки — менее 500 КБ на
файл, а у костюмов — 65-костный скин и геометрические бюджеты слоёв.
Статические предметы обязаны быть без анимаций и скина — и в оригинале, и в
облегчённой копии.

Компиляцию C# после смены версии каталога проверяет
`unity-client/Tools/compile-check.ps1`.

## Известные ограничения

На крупных планах крайних поз у костюмов остаются пересечения декоративной
обшивки и ткани. Проверка загрузки и уменьшенного зазора не означает идеальную
художественную посадку во всех анимациях.

Исходные модели и текстуры Atomic Realm исключены из публичного репозитория;
в проекте сохранены инструкции локальной установки и GUID-метаданные привязок.
