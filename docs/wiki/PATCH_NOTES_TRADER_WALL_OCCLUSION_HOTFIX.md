# v7.74.1 — Trader Wall Occlusion Hotfix

## Исправлено

- Исправлена ошибка запуска `traderBuildingInteriorObjects is not defined`.
- Массив объектов интерьера теперь объявлен рядом с `traderBuildingCutawayRoofs` и очищается при пересборке локации.
- Логика скрытия интерьера, торговца NPC и крыши сохранена.

## Проверка

- `node tools/check-client-js.js` — OK
- `node tools/check-client-css.js` — OK
