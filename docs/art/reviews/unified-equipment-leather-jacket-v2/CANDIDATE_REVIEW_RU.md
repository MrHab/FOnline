# Карта ревью: кожаная куртка v2

Кандидат подготовлен для сравнения с направлением `geometry_b_materials_c`. Runtime-версия игры не изменена.

## Сводка вариантов

| Тело | Треугольники | Размер GLB | High-poly полигоны |
| --- | ---: | ---: | ---: |
| `female_slim` | 9 374 | 1 428 196 Б | 114 445 |
| `female_medium` | 9 410 | 1 430 112 Б | 115 387 |
| `female_large` | 9 452 | 1 432 096 Б | 117 158 |
| `male_slim` | 9 422 | 1 430 960 Б | 116 642 |
| `male_medium` | 9 470 | 1 431 064 Б | 117 857 |
| `male_large` | 9 538 | 1 435 372 Б | 120 651 |

## Что уже проверено автоматически

- [x] шесть отдельных GLB и шесть индивидуальных отчётов;
- [x] один skin, `character_root`, текущий 65-костный rig и контрольные joints;
- [x] две mesh-секции, четыре материала и 12 встроенных PBR-текстур;
- [x] бюджет 6–10 тыс. треугольников и размер меньше 1,5 МБ;
- [x] наличие рендеров `idle`, `walk`, `run`, stress-pose и 112 × 112 px;
- [x] high-poly и game-ready объекты в воспроизводимой `.blend`-сцене;
- [x] флаг `reviewOnly: true` и закрытый `runtimeIntegrationAllowed`.

## Что должен подтвердить художник

- [ ] узнаваемость кроя по приложенному референсу;
- [ ] единство с Geometry B и Materials C;
- [ ] отсутствие нежелательного ощущения брони в плечах;
- [ ] естественность воротника, лацканов и нижнего края;
- [ ] отсутствие заметных пересечений в фактических игровых анимациях;
- [ ] убедительность кожи, локального износа и тусклого металла;
- [ ] читаемость силуэта и ключевой фурнитуры в изометрии 112 × 112 px;
- [ ] отдельное одобрение плечевой границы `male_large` и поведения лацканов в кадре `run_f6`.

## Основные визуальные доказательства

- `jacket/equipment_leather_jacket_unified_v2_male_medium_three_quarter.png` — основной силуэт;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_back.png` — спина, воротник и локти;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_detail.png` — молния, пряжка, заклёпки и материал;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_native112.png` — фактический игровой масштаб;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_night.png` — ночное освещение;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_wireframe.png` — сетка;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_deformation.png` — поднятые руки и сильный сгиб локтей;
- `jacket/equipment_leather_jacket_unified_v2_male_medium_idle_f19.png`, `walk_f10.png`, `run_f6.png` — текущие игровые action-клипы.

Точные хеши, размеры и параметры посадки находятся в `jacket/fit-report-all.json` и индивидуальных `.report.json`.
