# v7.74.9 — Optimized Real Shadows

## Что исправлено
- Возвращены настоящие realtime/static shadow-map тени.
- Низкие и средние настройки больше не отключают тени полностью.
- Псевдотени под персонажами остаются как мягкая контактная подложка, но больше не являются единственными тенями.

## Оптимизация по настройкам
- Low:
  - shadows: enabled
  - shadow map: 512
  - shadow type: BasicShadowMap
  - короткая shadow camera area
  - тени только от крупных объектов: здания, стены, деревья, камни, ящики, NPC/игроки.
- Medium:
  - shadows: enabled
  - shadow map: 1024
  - shadow type: PCFShadowMap
  - средняя shadow camera area
  - мелкий мусор и дешевые эффекты не отбрасывают тени.
- High:
  - shadows: enabled
  - shadow map: 2048
  - shadow type: PCFSoftShadowMap
  - расширенная shadow camera area.
- Ultra:
  - shadows: enabled
  - shadow map: 4096
  - shadow type: PCFSoftShadowMap
  - максимальная область и больше мелких caster-объектов.

## Производительность
- Shadow map остается кэшированной.
- Тени пересчитываются после загрузки/пересборки локации и смены качества графики.
- Стрельба и эффекты боя не запускают пересборку shadow map, чтобы не вернуть фризы и мигание теней.

## Измененные файлы
- public/js/game/02_renderer_world_map.js
- public/js/game/09_update_graphics_minimap_loop.js
