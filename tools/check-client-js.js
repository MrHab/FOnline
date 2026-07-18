const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const partsDir = path.join(root, 'public', 'js', 'game');
const loaderFile = path.join(root, 'public', 'js', 'game.js');
const partNames = [
  '01_bootstrap_online_save.js',
  '02_renderer_world_map.js',
  '02a_materials_static_models.js',
  '02b_lighting_time.js',
  '02c_map_locations_collision.js',
  '02d_trader_spawn_props.js',
  '02d1_building_blocks_roof_setup.js',
  '02d2_cutaway_geometry_visibility.js',
  '02d3_cutaway_transparency_warmup.js',
  '02d4_roof_visibility_batch.js',
  '02d5_trader_building_interior.js',
  '02e_trader_yard_world_build.js',
  '03_items_inventory_core.js',
  '03a_pipboy_social_world_tasks.js',
  '03b_inventory_actions_ui.js',
  '03c_skills_perks_tooltips.js',
  '03d_item_context_repair_crafting.js',
  '04_player_model_visuals.js',
  '05_multiplayer_core_state.js',
  '05a_remote_actor_equipment.js',
  '05b_remote_player_locomotion.js',
  '05c_multiplayer_socket_room.js',
  '05d_world_containers_security.js',
  '05e_ground_items_world_sync.js',
  '05f_enemy_models_location_flow.js',
  '06_pathfinding_movement.js',
  '06a_combat_visual_fx.js',
  '06b_explosions_speech.js',
  '06c_combat_stats_modes.js',
  '06d_combat_damage_shooting.js',
  '06e_combat_targeting_loot_resources.js',
  '07_quantity_confirm_carry.js',
  '07a_storage_window.js',
  '07b_trader_market_state.js',
  '07c_trader_dialogues_quests.js',
  '07d_trader_barter_ui.js',
  '07e_loot_interaction.js',
  '07f_quickbar_drag_slots.js',
  '08_character_creation_save.js',
  '08a_mobile_controls_panels.js',
  '08b_interaction_quick_access.js',
  '08c_hud_edit_windows_touch.js',
  '08d_world_context_targets.js',
  '08e_mobile_player_action_menus.js',
  '08f_input_events_proximity.js',
  '09_update_fog_movement_ai.js',
  '10_global_map_state_logs_config.js',
  '11_global_map_terrain_core.js',
  '11a_global_map_player_models.js',
  '11b_global_map_static_scene_camera.js',
  '11c_global_map_sites_territory.js',
  '11d_global_map_contacts_parties.js',
  '11e_global_map_tasks_dynamic_render.js',
  '12_global_map_canvas_controls.js',
  '12a_global_map_world_status.js',
  '12b_global_map_panel_window.js',
  '12c_global_map_travel_encounters.js',
  '12d_global_map_entry_ambush_controls.js',
  '13_minimap_hud_loop.js'
];
const partFiles = partNames.map(name => path.join(partsDir, name));

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const loader = fs.readFileSync(loaderFile, 'utf8');
new Function(loader);

const missing = partFiles.filter(file => !fs.existsSync(file));
if (missing.length) {
  throw new Error(`Missing client JS part(s): ${missing.join(', ')}`);
}

const jsFiles = fs.readdirSync(partsDir).filter(file => file.endsWith('.js')).sort();
const unlisted = jsFiles.filter(file => !partNames.includes(file));
if (unlisted.length) {
  throw new Error(`Unlisted client JS part(s): ${unlisted.join(', ')}`);
}

for (const file of partNames) {
  if (!loader.includes(`/js/game/${file}`)) {
    throw new Error(`Client JS loader does not include: ${file}`);
  }
}

const combined = partFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
new Function(combined);

const nativeDialogCallPattern = /\b(?:window\s*\.\s*)?(?:confirm|alert|prompt)\s*\(/g;
const publicUiFiles = walkFiles(publicDir)
  .filter(file => /\.(?:html|js)$/i.test(file))
  .filter(file => !file.includes(`${path.sep}vendor${path.sep}`));
for (const file of publicUiFiles) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = nativeDialogCallPattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    const relative = path.relative(root, file);
    throw new Error(`Native browser dialog call is not allowed in client UI: ${relative}:${line}`);
  }
}

console.log('Client JS loader syntax OK:', loaderFile);
console.log('Client JS reconstructed bundle syntax OK:', partFiles.length, 'parts');
console.log('Client JS native dialog guard OK');
