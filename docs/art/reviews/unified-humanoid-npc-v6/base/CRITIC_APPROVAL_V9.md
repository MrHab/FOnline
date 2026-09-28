# Решение агента-критика: человекоподобный НПС v9 (UAL + мокап CMU)

Вердикт: **APPROVE**

Файл: `docs/art/reviews/unified-humanoid-npc-v6/base/npc_humanoid_base_unified_v6.glb`
(имя файла прежнее, содержимое — v9; одобрения v6–v8 лежат рядом и относятся к
прежним хешам).

SHA-256: `0DF7E1435A792435BCA30C00971D82B0E3403F38D8F2AC0F687CD6778341BF20`

Блокирующие дефекты: **нет**

## Что изменилось против v8

- `tools/import-cmu-clips.js` переносит мокап CMU (BVH, `public/assets/licenses/CMU_MOCAP.md`):
  `strafe_left/right`, `strafe_run_left/right`, `crouch_idle`, `crouch_walk`,
  `crouch_walk_back`, `pickup`, `harvest`.
- Тот же импорт перекраивает клипы UAL: `walk_back` и `run_back` (короче замах вокруг
  опорной позы), `death` (обмякшие руки, стопы прижаты IK), строит `crouch_run` из
  `run` (таз ниже, ноги по IK), оставляет прежний `crouch_walk_back` как
  `crouch_run_back`, сажает на пол `chest_open`, `consume`, `kneel_work`.
- Удалены `sword_idle` и `sword_attack` (фэнтезийный тон, игра их не играет).
- Повторный прогон импорта даёт те же байты.

## Оценки (тело игрока, 12 раундов листов, последний — полный прогон 50 листов)

- 10/10: idle, walk, run, strafe_diag, punch, hurt, pickup, consume, rifle_idle,
  rifle_walk, rifle_fire, rifle_reload, pistol_idle, pistol_walk, pistol_fire,
  pistol_reload, axe_walk.
- На пределе без новых исходных клипов (решение владельца проекта — новых клипов
  не покупать): walk_back, run_back, strafe_walk, strafe_run, strafe_step,
  crouch_idle, crouch_walk, crouch_back, crouch_run, rifle_crouch_walk, rifle_run,
  harvest, axe_idle, axe_swing, death.
- Проникновения в пол нет (подушечки не ниже −1 см на толчке бега), отрыв кисти от
  оружия ≤ 0.001 м, кроме замаха топора (0.03 м).
