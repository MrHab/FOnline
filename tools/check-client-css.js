const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssDir = path.join(root, 'public', 'css', 'game');
const loaderPath = path.join(root, 'public', 'css', 'game.css');

const parts = [
  '01_base_layout_hud.css',
  '02_mobile_fullscreen_touch.css',
  '03_hud_minimap_inventory_progression.css',
  '04_mobile_inventory_trade_quality.css',
  '05_loot_storage_trader_mobile.css',
  '06_graphics_settings_time.css',
  '07_injuries_progression_perks_base.css',
  '08_perk_tree_layout_navigation.css',
  '09_perk_tree_focus_and_overrides.css',
  '10_custom_scrollbars.css',
  '11_persistent_hud_windows.css',
  '12_persistent_hud_device_split.css',
  '13_fallout_weapon_console.css',
  '14_wasteland_actor_cards.css',
  '15_location_loading_screen.css',
  '16_mobile_ui_icons.css',
  '17_player_frame_hud.css',
  '18_hud_readability.css',
  '19_weapon_modification_workbench.css',
  '20_caravan_staging_window.css'
];

const retiredParts = [
  '16_mobile_custom_icons.css'
];

for (const file of parts) {
  const full = path.join(cssDir, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing CSS part: ${file}`);
  }
}

const cssFiles = fs.readdirSync(cssDir).filter(file => file.endsWith('.css')).sort();
const unlisted = cssFiles.filter(file => !parts.includes(file));
if (unlisted.length) {
  throw new Error(`Unlisted CSS part(s): ${unlisted.join(', ')}`);
}

const loader = fs.readFileSync(loaderPath, 'utf8');
const importedParts = Array.from(
  loader.matchAll(/@import\s+url\(["']?\/css\/game\/([^"'?;)]+)(?:\?[^"')]+)?["']?\);/g),
  match => match[1]
);
if (importedParts.length !== parts.length || importedParts.some((file, index) => file !== parts[index])) {
  throw new Error(
    `CSS loader import order mismatch.\nExpected: ${parts.join(', ')}\nActual: ${importedParts.join(', ')}`
  );
}

for (const file of retiredParts) {
  if (fs.existsSync(path.join(cssDir, file)) || loader.includes(`/css/game/${file}`)) {
    throw new Error(`Retired CSS part returned: ${file}`);
  }
}

const reconstructed = parts.map(file => fs.readFileSync(path.join(cssDir, file), 'utf8')).join('');
if (!reconstructed.includes('Realm of Ashes')) {
  throw new Error('Reconstructed CSS does not look like the original stylesheet.');
}

console.log(`Client CSS split OK: ${parts.length} parts, ${reconstructed.length} bytes reconstructed`);
