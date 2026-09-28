# CMU Graphics Lab Motion Capture Database

Часть клипов общей библиотеки анимаций
(`public/assets/models/characters/npc/npc_humanoid_animations.glb`) перенесена
из мокапа CMU: боковой шаг (`strafe_left`, `strafe_right`), приставной шаг
(`strafe_run_left`, `strafe_run_right`), стойка и шаг в приседе (`crouch_idle`,
`crouch_walk`, `crouch_walk_back`) и подбор с земли (`pickup`).

- Источник: http://mocap.cs.cmu.edu/ (файлы 69_42, 06_09, 136_09, 136_11, 69_70).
- Формат BVH: конвертация Bruce Hahne (cgspeed.com), копия
  https://github.com/una-dinosauria/cmu-mocap.

Условия CMU (приведены в READMEFIRST.txt конвертации): «This data is free for
use in research and commercial projects worldwide». Конвертация BVH
дополнительных ограничений не добавляет.

The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

Перенос на скелет игры, выбор петли и посадка на землю — `tools/import-cmu-clips.js`.
