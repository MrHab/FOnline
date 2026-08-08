// Realm of Ashes client loader.
// The original game.js body was split mechanically into ordered files under /js/game/.
// The loader concatenates the parts and executes the exact reconstructed script without changing game logic.
(async () => {
  'use strict';

  const GAME_CLIENT_VERSION = '7.83.0-scene-environment-v1';
  const MODEL_COLLIDER_CATALOG_URL = '/assets/models/wasteland/model-colliders.json';
  const GAME_SCRIPT_PARTS = [
    '/js/game/00_save_generation_drain.js',
    '/js/game/00a_actor_facing.js',
    '/js/game/01_bootstrap_online_save.js',
    '/js/game/02_renderer_world_map.js',
    '/js/game/02a_materials_static_models.js',
    '/js/game/02b_lighting_time.js',
    '/js/game/02c_map_locations_collision.js',
    '/js/game/02d_trader_spawn_props.js',
    '/js/game/02d1_building_blocks_roof_setup.js',
    '/js/game/02d2_cutaway_geometry_visibility.js',
    '/js/game/02d3_cutaway_transparency_warmup.js',
    '/js/game/02d4_roof_visibility_batch.js',
    '/js/game/02d5_trader_building_interior.js',
    '/js/game/02e_trader_yard_world_build.js',
    '/js/game/03_items_inventory_core.js',
    '/js/game/03a_pipboy_social_world_tasks.js',
    '/js/game/03b_inventory_actions_ui.js',
    '/js/game/03c_skills_perks_tooltips.js',
    '/js/game/03d_item_context_repair_crafting.js',
    '/js/game/04_player_model_visuals.js',
    '/js/game/04a_player_model_modern_runtime.js',
    '/js/game/04b_character_glb_runtime.js',
    '/js/game/04c_weapon_glb_runtime.js',
    '/js/game/04d_approved_humanoid_assets_runtime.js',
    '/js/game/04e_weapon_modification_workbench.js',
    '/js/game/05_multiplayer_core_state.js',
    '/js/game/05a_remote_actor_equipment.js',
    '/js/game/05b_remote_player_locomotion.js',
    '/js/game/05c_multiplayer_socket_room.js',
    '/js/game/05d_world_containers_security.js',
    '/js/game/05e_ground_items_world_sync.js',
    '/js/game/05f_enemy_models_location_flow.js',
    '/js/game/06a_combat_visual_fx.js',
    '/js/game/06b_explosions_speech.js',
    '/js/game/06c_combat_stats_modes.js',
    '/js/game/06d_combat_damage_shooting.js',
    '/js/game/06e_combat_targeting_loot_resources.js',
    '/js/game/07_quantity_confirm_carry.js',
    '/js/game/07a_storage_window.js',
    '/js/game/07b_trader_market_state.js',
    '/js/game/07c_trader_dialogues_quests.js',
    '/js/game/07d_trader_barter_ui.js',
    '/js/game/07e_loot_interaction.js',
    '/js/game/07f_quickbar_drag_slots.js',
    '/js/game/08_character_creation_save.js',
    '/js/game/08a_mobile_controls_panels.js',
    '/js/game/08b_interaction_quick_access.js',
    '/js/game/08c_hud_edit_windows_touch.js',
    '/js/game/08d_world_context_targets.js',
    '/js/game/08e_mobile_player_action_menus.js',
    '/js/game/08f_input_events_proximity.js',
    '/js/game/09_update_fog_movement_ai.js',
    '/js/game/10_global_map_state_logs_config.js',
    '/js/game/11_global_map_terrain_core.js',
    '/js/game/11a_global_map_player_models.js',
    '/js/game/11b_global_map_static_scene_camera.js',
    '/js/game/11c_global_map_sites_territory.js',
    '/js/game/11d_global_map_parties.js',
    '/js/game/11e_global_map_tasks_dynamic_render.js',
    '/js/game/12_global_map_canvas_controls.js',
    '/js/game/12a_global_map_world_status.js',
    '/js/game/12b_global_map_panel_window.js',
    '/js/game/12c_global_map_travel_encounters.js',
    '/js/game/12d_global_map_entry_ambush_controls.js',
    '/js/game/13_minimap_hud_loop.js'
  ];

  function showLoaderError(message) {
    console.error(message);
    const err = document.getElementById('char-error');
    if (err) {
      err.textContent = message;
      err.classList.add('visible');
    }
    const note = document.getElementById('character-online-note');
    if (note) note.textContent = message;
  }

  async function loadTextResource(src, mimeType) {
    const url = `${src}${src.includes('?') ? '&' : '?'}v=${encodeURIComponent(GAME_CLIENT_VERSION)}`;
    const response = await fetch(url, {
      cache: 'default',
      credentials: 'same-origin',
      headers: { Accept: mimeType }
    });
    if (!response.ok) throw new Error(`Не удалось загрузить часть клиента: ${src} (${response.status})`);
    return await response.text();
  }

  async function loadScriptPart(src) {
    return loadTextResource(src, 'application/javascript; charset=utf-8');
  }

  try {
    const [colliderText, ...scriptParts] = await Promise.all([
      loadTextResource(MODEL_COLLIDER_CATALOG_URL, 'application/json; charset=utf-8'),
      ...GAME_SCRIPT_PARTS.map(loadScriptPart)
    ]);
    const colliderManifest = JSON.parse(colliderText);
    if (colliderManifest?.schema !== 'realm.model-colliders.v1' || !colliderManifest.models) {
      throw new Error('Invalid 3D model collider catalog.');
    }
    const catalogSource = `const MODEL_COLLIDER_CATALOG = Object.freeze(${JSON.stringify(colliderManifest.models)});\n`;
    const source = catalogSource + scriptParts.join('\n');
    new Function(source)();
  } catch (error) {
    showLoaderError(error && error.message ? error.message : String(error));
    throw error;
  }
})();
