# Разбиение `game.js`

`public/js/game.js` является загрузчиком. Он последовательно читает файлы из этой папки, склеивает их в указанном порядке и запускает реконструированный клиентский скрипт.

Разбиение сделано механически: порядок выполнения важен, логику игры внутри частей нельзя переставлять без отдельной проверки.

Текущий порядок:

1. `01_bootstrap_online_save.js` - оболочка клиента, Three.js guard, устройство, серверная авторизация, профиль.
2. `02_renderer_world_map.js` - базовый renderer, scene/camera, viewport, visibility shell.
3. `02a_materials_static_models.js` - материалы, текстуры, static model registry, authored location objects.
4. `02b_lighting_time.js` - свет, тени, время суток, day/night lighting.
5. `02c_map_locations_collision.js` - карта, локации, тайлы, торговые профили, коллизии, `TRADER_STOCK`.
6. `02d_trader_spawn_props.js` - торговец, хранилище, переходы, декор и внешние стены локации.
7. `02d1_building_blocks_roof_setup.js` - строительные блоки, регистрация интерьера, материалы и сетка крыши.
8. `02d2_cutaway_geometry_visibility.js` - координаты здания, bounds, экранные пробы и проверки видимости.
9. `02d3_cutaway_transparency_warmup.js` - прозрачность стен/крыш, кэши и прогрев cutaway.
10. `02d4_roof_visibility_batch.js` - совместимость fog/LOS, видимость крыши, instanced roof cells, окна.
11. `02d5_trader_building_interior.js` - финальная сборка интерьера здания.
12. `02e_trader_yard_world_build.js` - двор торговца, окружение, terrain layers, `buildWorld()`.
8. `03_items_inventory_core.js` - items, item art, equipment, inventory core snapshots.
9. `03a_pipboy_social_world_tasks.js` - Pip-Boy social tabs, world tasks, factions, radio.
10. `03b_inventory_actions_ui.js` - inventory actions, medicine, drag-drop, categories, inventory UI.
11. `03c_skills_perks_tooltips.js` - SPECIAL, skills, perks, perk catalog, tooltips.
12. `03d_item_context_repair_crafting.js` - item context menu, repair, salvage, crafting stations.
9. `04_player_model_visuals.js` - игрок, SPECIAL, модель персонажа, оружие, броня, приседание и визуальные травмы.
10. `05_multiplayer_core_state.js` - multiplayer state, room guards, outgoing character snapshots.
11. `05a_remote_actor_equipment.js` - remote actor names, equipment visuals, muzzle helpers.
12. `05b_remote_player_locomotion.js` - remote player interpolation and visual locomotion.
13. `05c_multiplayer_socket_room.js` - Socket.IO connect/events, room changes, transfer handlers.
14. `05d_world_containers_security.js` - server containers, lock/terminal UI and loot actions.
15. `05e_ground_items_world_sync.js` - ground items, resources, world/enemy network snapshots.
16. `05f_enemy_models_location_flow.js` - enemy model builders, local spawn/restore and location loading.
11. `06_pathfinding_movement.js` - поиск пути, ближайшая проходимая клетка и цель движения.
12. `06a_combat_visual_fx.js` - маркер движения, трассеры, пулы эффектов и визуальные FX оружия.
13. `06b_explosions_speech.js` - взрывы, плавающий текст и речевые пузырьки НПС.
14. `06c_combat_stats_modes.js` - формулы боя, режимы оружия, шанс попадания и снапшоты ресурсов.
15. `06d_combat_damage_shooting.js` - трата ОД, урон, выстрелы, PvP/NPC guard и перезарядка.
16. `06e_combat_targeting_loot_resources.js` - автотаргет, трупы, лут, добыча ресурсов.
12. `07_quantity_confirm_carry.js` - выбор количества, подтверждения и ограничения переносимого веса.
13. `07a_storage_window.js` - окно хранилища и перенос между рюкзаком/хранилищем.
14. `07b_trader_market_state.js` - профили торговцев, определения квестов, запас и ресток рынка.
15. `07c_trader_dialogues_quests.js` - жизненный цикл окна торговца, цены, диалоги и квестовые действия.
16. `07d_trader_barter_ui.js` - сетки бартера, очереди покупки/продажи и принятие обмена.
17. `07e_loot_interaction.js` - окна обыска трупов/контейнеров и ближайшее взаимодействие.
18. `07f_quickbar_drag_slots.js` - быстрые слоты, назначение, drag/drop и очистка слотов.
13. `08_character_creation_save.js` - character creator, SPECIAL/traits, save/load/bootstrap.
14. `08a_mobile_controls_panels.js` - input globals, touch movement/aim, fullscreen and game menu panels.
15. `08b_interaction_quick_access.js` - universal interaction, held items, resource tools, quick access radial.
16. `08c_hud_edit_windows_touch.js` - HUD editor, mobile control binding, Pip-Boy/window toggles.
17. `08d_world_context_targets.js` - pointer picking, context target detection and world context options.
18. `08e_mobile_player_action_menus.js` - mobile treatment/social action windows and remote player menus.
19. `08f_input_events_proximity.js` - canvas/keyboard events, automatic fire, proximity hints.
14. `09_update_fog_movement_ai.js` - основной update, fog-of-war, culling, графические настройки, движение, AI мобов, эффекты и камера.
15. `10_global_map_state_logs_config.js` - системный журнал, базовое состояние глобальной карты, загрузка конфига, сохранение маршрута.
16. `11_global_map_terrain_core.js` - координаты глобальной карты, вода/берег, высоты, texture canvas и базовые линии.
17. `11a_global_map_player_models.js` - модель игрока на глобальной карте, оружие и направление движения.
18. `11b_global_map_static_scene_camera.js` - статическая 3D-сцена, города/объекты, дороги, terrain, камера.
19. `11c_global_map_sites_territory.js` - ресурсные точки, зоны влияния, территории и фронты фракций.
20. `11d_global_map_contacts_parties.js` - контакты мира, бродячие отряды и их мини-модели.
21. `11e_global_map_tasks_dynamic_render.js` - маркеры заданий, динамическое обновление и render global map 3D.
17. `12_global_map_canvas_controls.js` - колесо/перетаскивание карты и 2D canvas fallback глобальной карты.
18. `12a_global_map_world_status.js` - подписи отрядов, ресурсные точки, задачи мира, контакты и доска работ.
19. `12b_global_map_panel_window.js` - панель глобальной карты, runtime frame, окно карты и выход на карту из локации.
20. `12c_global_map_travel_encounters.js` - старт/отмена маршрута, встречи, входы в локальные локации, завершение travel.
21. `12d_global_map_entry_ambush_controls.js` - вход в поселения, засады и инициализация контролов глобальной карты.
18. `13_minimap_hud_loop.js` - миникарта, HUD, оружейный UI, безопасный render guard, главный игровой loop и bootstrap-вызовы.

Проверка порядка и синтаксиса: `npm run check:client`.
