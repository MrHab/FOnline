# Клиентские файлы

## `public/js/game.js`

`public/index.html` сначала подключает локальные vendor-сборки Three.js, `GLTFLoader` и Socket.IO, а затем запускает этот загрузчик.

Загрузчик параллельно получает каталог коллайдеров и все 59 файлов из `GAME_SCRIPT_PARTS`. После загрузки он проверяет схему каталога `realm.model-colliders.v1`, добавляет замороженный `MODEL_COLLIDER_CATALOG`, объединяет JS-части **в порядке массива** и выполняет общий исходник через `new Function(...)`. Поэтому сетевой порядок завершения запросов не влияет на порядок выполнения кода.

При добавлении, удалении или переименовании JS-части нужно обязательно синхронно обновить `GAME_SCRIPT_PARTS`: каталог не сканируется автоматически.

## JS-части

| Файл | Назначение |
|---|---|
| `01_bootstrap_online_save.js` | запуск, устройство, авторизация, профиль, выбор персонажа |
| `02_renderer_world_map.js` | базовый renderer, scene/camera, viewport, visibility shell |
| `02a_materials_static_models.js` | материалы, текстуры, static model registry, authored objects |
| `02b_lighting_time.js` | свет, тени, время суток, day/night lighting |
| `02c_map_locations_collision.js` | карта, локации, тайлы, торговые профили, коллизии, `TRADER_STOCK` |
| `02d_trader_spawn_props.js` | торговец, хранилище, переходы, декор и внешние стены локации |
| `02d1_building_blocks_roof_setup.js` | строительные блоки, регистрация интерьера, материалы и сетка крыши |
| `02d2_cutaway_geometry_visibility.js` | координаты здания, bounds, экранные пробы и проверки видимости |
| `02d3_cutaway_transparency_warmup.js` | прозрачность стен/крыш, кэши и прогрев cutaway |
| `02d4_roof_visibility_batch.js` | совместимость fog/LOS, видимость крыши, instanced roof cells, окна |
| `02d5_trader_building_interior.js` | финальная сборка интерьера здания |
| `02e_trader_yard_world_build.js` | двор торговца, окружение, terrain layers, `buildWorld()` |
| `03_items_inventory_core.js` | items, item art, equipment, inventory snapshots |
| `03a_pipboy_social_world_tasks.js` | Pip-Boy social, world tasks, factions, radio |
| `03b_inventory_actions_ui.js` | inventory actions, medicine, drag-drop, categories, inventory UI |
| `03c_skills_perks_tooltips.js` | SPECIAL, skills, perks, tooltips |
| `03d_item_context_repair_crafting.js` | item context menu, repair, salvage, crafting |
| `04_player_model_visuals.js` | модель игрока, оружие, броня, визуал экипировки |
| `05_multiplayer_core_state.js` | multiplayer state, room guards, outgoing character snapshots |
| `05a_remote_actor_equipment.js` | remote actor names, equipment visuals, muzzle helpers |
| `05b_remote_player_locomotion.js` | remote player interpolation and visual locomotion |
| `05c_multiplayer_socket_room.js` | Socket.IO connect/events, room changes, transfer handlers, измерение сетевого ping |
| `05d_world_containers_security.js` | server containers, lock/terminal UI and loot window actions |
| `05e_ground_items_world_sync.js` | ground items, resources, world/enemy network snapshots |
| `05f_enemy_models_location_flow.js` | enemy model builders, local spawn/restore and location loading |
| `06_pathfinding_movement.js` | поиск пути, ближайшая проходимая клетка и цель движения |
| `06a_combat_visual_fx.js` | маркер движения, трассеры, пулы эффектов и визуальные FX оружия |
| `06b_explosions_speech.js` | взрывы, плавающий текст и речевые пузырьки НПС |
| `06c_combat_stats_modes.js` | формулы боя, режимы оружия, шанс попадания и снапшоты ресурсов |
| `06d_combat_damage_shooting.js` | трата ОД, урон, выстрелы, PvP/NPC guard и перезарядка |
| `06e_combat_targeting_loot_resources.js` | автотаргет, трупы, лут, добыча ресурсов |
| `07_quantity_confirm_carry.js` | выбор количества, подтверждения и ограничения переносимого веса |
| `07a_storage_window.js` | окно хранилища и перенос между рюкзаком/хранилищем |
| `07b_trader_market_state.js` | профили торговцев, определения квестов, запас и ресток рынка |
| `07c_trader_dialogues_quests.js` | жизненный цикл окна торговца, цены, диалоги и квестовые действия |
| `07d_trader_barter_ui.js` | сетки бартера, очереди покупки/продажи и принятие обмена |
| `07e_loot_interaction.js` | окна обыска трупов/контейнеров и ближайшее взаимодействие |
| `07f_quickbar_drag_slots.js` | быстрые слоты, назначение, drag/drop и очистка слотов |
| `08_character_creation_save.js` | character creator, SPECIAL, traits, tagged skills, starting perks, save/load/bootstrap |
| `08a_mobile_controls_panels.js` | input globals, touch movement, fullscreen and game menu panels |
| `08b_interaction_quick_access.js` | universal interaction, held items, resource tools, quick access radial |
| `08c_hud_edit_windows_touch.js` | HUD editor, mobile control binding, Pip-Boy/window toggles |
| `08d_world_context_targets.js` | pointer picking, context target detection and world context options |
| `08e_mobile_player_action_menus.js` | mobile treatment/social action windows and remote player menus |
| `08f_input_events_proximity.js` | canvas/keyboard events, automatic fire, proximity hints |
| `09_update_fog_movement_ai.js` | update, fog-of-war, culling, графика, движение, AI, эффекты, камера |
| `10_global_map_state_logs_config.js` | системный журнал, состояние и конфиг глобальной карты |
| `11_global_map_terrain_core.js` | координаты глобальной карты, вода/берег, высоты, texture canvas и базовые линии |
| `11a_global_map_player_models.js` | модель игрока на глобальной карте, оружие и направление движения |
| `11b_global_map_static_scene_camera.js` | статическая 3D-сцена, города/объекты, дороги, terrain, камера |
| `11c_global_map_sites_territory.js` | ресурсные точки, зоны влияния, территории и фронты фракций |
| `11d_global_map_contacts_parties.js` | контакты мира, бродячие отряды и их мини-модели |
| `11e_global_map_tasks_dynamic_render.js` | маркеры заданий, динамическое обновление и render global map 3D |
| `12_global_map_canvas_controls.js` | колесо/перетаскивание карты и 2D canvas fallback глобальной карты |
| `12a_global_map_world_status.js` | подписи отрядов, ресурсные точки, задачи мира, контакты и доска работ |
| `12b_global_map_panel_window.js` | панель глобальной карты, runtime frame, окно карты и выход на карту из локации |
| `12c_global_map_travel_encounters.js` | старт/отмена маршрута, встречи, входы в локальные локации, завершение travel |
| `12d_global_map_entry_ambush_controls.js` | вход в поселения, засады и инициализация контролов глобальной карты |
| `13_minimap_hud_loop.js` | миникарта, HUD, оружейный UI, auth/bootstrap bindings, render guard, главный loop |

## CSS-части

`public/css/game.css` — единая точка входа, которая последовательно импортирует 19 CSS-частей. Порядок `@import` является частью контракта каскада: поздние слои интерфейса и адаптивные переопределения могут уточнять ранние базовые стили. При добавлении или переносе CSS-части нужно обновлять этот список явно.

## Проверка клиента

```bash
node tools/check-client-js.js
node tools/check-client-css.js
```

## Правило изменения клиента

Перед изменениями важно понять, в какой части находится система. Новую механику не стоит добавлять в `index.html`, если для неё уже есть JS-часть.

## Совместимые атрибуты BufferGeometry

В клиентских частях нельзя напрямую полагаться только на `BufferGeometry.setAttribute`, потому что при локальном запуске пользователь может получить другую сборку Three.js из `node_modules` или кэша. Для новых runtime-атрибутов нужно использовать `setGeometryAttributeCompat()` из `02a_materials_static_models.js`.

Это касается крыши торговца, боевых трассеров и защитного ремонта геометрий перед рендером.

## Быстрый доступ

Данные быстрого доступа состоят из восьми логических слотов и используются общим потоком назначения предметов из инвентаря.

- На мобильных устройствах `#quickbar` отображается как восемь постоянных кнопок: касание сразу активирует назначенный слот.
- На desktop обычная панель скрыта. Короткое нажатие `E` выполняет универсальное взаимодействие, а удержание `E` открывает radial-меню быстрого доступа.

Мобильная панель не привязана к `#touch-loot` и не требует удержания.
