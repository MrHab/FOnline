const fs = require('fs');
const path = require('path');
const {
  infrastructureSegmentIsLand,
  infrastructureToInfrastructureDistance,
  normalizeGlobalInfrastructure,
  pointToInfrastructureDistance
} = require('../src/server/global-infrastructure');
const { ROAD_SITE_LAYOUT_VERSION } = require('../src/server/wasteland-district-sites');
const { worldSiteLocationId } = require('../src/server/wasteland-site-instances');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const locationsDir = path.join(dataDir, 'locations');
const globalMapFile = path.join(dataDir, 'global-map.json');
const tradersFile = path.join(dataDir, 'traders.json');
const questsFile = path.join(dataDir, 'quests.json');
const encountersFile = path.join(dataDir, 'encounters.json');
const lootTablesFile = path.join(dataDir, 'loot-tables.json');
const wastelandSimFile = path.join(dataDir, 'wasteland-sim.json');

const errors = [];
const warnings = [];
let wastelandSim = null;
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clientWorldSyncSource = fs.readFileSync(path.join(root, 'public', 'js', 'game', '05e_ground_items_world_sync.js'), 'utf8');
const locationEditorFile = path.join(root, 'public', 'dev-location-editor.html');
const locationEditorSource = fs.existsSync(locationEditorFile) ? fs.readFileSync(locationEditorFile, 'utf8') : '';
const authoredDataFiles = new Set([
  'encounters.json',
  'global-map.json',
  'loot-tables.json',
  'quests.json',
  'traders.json'
]);

function isAuthoredJsonFile(file) {
  const rel = path.relative(dataDir, file).replace(/\\/g, '/');
  return rel.startsWith('locations/') || authoredDataFiles.has(rel);
}

function collectCorruptedAuthoredText(value, trail = '$', found = []) {
  if (typeof value === 'string') {
    if (value.includes('\uFFFD')) found.push({ trail, reason: 'contains the Unicode replacement character' });
    if (/\?{2,}/u.test(value)) found.push({ trail, reason: 'contains repeated "?" characters' });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectCorruptedAuthoredText(entry, `${trail}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    const keyTrail = /^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(key)
      ? `${trail}.${key}`
      : `${trail}[${JSON.stringify(key)}]`;
    collectCorruptedAuthoredText(entry, keyTrail, found);
  }
  return found;
}

const authoredTextValidationProbe = collectCorruptedAuthoredText({
  validQuestion: 'Кто оставил эту запись?',
  brokenQuestionMarks: '????',
  brokenReplacement: 'Повреждённый \uFFFD текст'
});
if (authoredTextValidationProbe.length !== 2
  || !authoredTextValidationProbe.some(row => row.trail === '$.brokenQuestionMarks')
  || !authoredTextValidationProbe.some(row => row.trail === '$.brokenReplacement')) {
  errors.push('tools/check-world-data.js: authored text validation contract failed');
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isAuthoredJsonFile(file)) {
      const rel = path.relative(root, file);
      collectCorruptedAuthoredText(parsed).forEach(row => {
        errors.push(`${rel}: ${row.trail} ${row.reason}`);
      });
    }
    return parsed;
  } catch (err) {
    errors.push(`${path.relative(root, file)}: invalid JSON (${err.message})`);
    return null;
  }
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function publicAssetExists(url) {
  if (!url || typeof url !== 'string') return true;
  if (!url.startsWith('/')) return true;
  const clean = url.split(/[?#]/)[0].replace(/^\/+/, '');
  return fs.existsSync(path.join(root, 'public', clean.replace(/\//g, path.sep)));
}

function pointLooksValid(row) {
  if (!row || typeof row !== 'object') return false;
  if (finiteNumber(row.tx) && finiteNumber(row.tz)) return true;
  const p = row.position || {};
  return finiteNumber(p.x) && finiteNumber(p.z);
}

function objectTags(row = {}) {
  return (Array.isArray(row.tags) ? row.tags : []).map(value => String(value || '').toLowerCase());
}

function objectEntity(row = {}) {
  return row && row.entity && typeof row.entity === 'object' ? row.entity : {};
}

function objectRole(row = {}) {
  const entity = objectEntity(row);
  return String(entity.role || row.role || '').trim().toLowerCase();
}

function objectModel(row = {}) {
  return String(row.model || row.url || '').trim().toLowerCase();
}

function objectIsNpc(row = {}) {
  const tags = objectTags(row);
  const model = objectModel(row);
  const entity = objectEntity(row);
  const kind = String(entity.kind || '').trim().toLowerCase();
  return kind === 'npc'
    || kind === 'enemy'
    || kind === 'monster'
    || tags.some(tag => ['npc', 'enemy', 'monster', 'living', 'friendly', 'guard', 'merchant', 'trader'].includes(tag))
    || /^(enemy|npc|tradernpc|caravanmerchant|caravanguard|klimpatrolguard|wastelandsettler|friendlybrahmin)/i.test(String(row.model || ''));
}

function objectIsTrader(row = {}) {
  const tags = objectTags(row);
  const model = objectModel(row);
  const role = objectRole(row);
  const entity = objectEntity(row);
  return role === 'merchant'
    || role === 'trader'
    || tags.includes('merchant')
    || tags.includes('trader')
    || model.includes('tradernpc')
    || model.includes('caravanmerchant')
    || !!(entity.traderProfile || entity.tradeProfile);
}

function objectIsStorage(row = {}) {
  const tags = objectTags(row);
  const model = objectModel(row);
  const role = objectRole(row);
  return model.includes('storagechest')
    || role === 'storage'
    || role === 'container'
    || tags.includes('storage')
    || tags.includes('container');
}

function objectResourceType(row = {}) {
  const tags = objectTags(row);
  const model = objectModel(row);
  const entity = objectEntity(row);
  const resource = String(row.resourceType || row.resource || entity.resourceType || '').toLowerCase();
  if (['ore', 'wood', 'scrap', 'water', 'oil'].includes(resource)) return resource;
  const collision = String(row.collision || '').toLowerCase();
  const isResourceCandidate = collision === 'resource' || tags.includes('resource') || tags.includes('harvestable') || tags.includes('resource-node');
  if (!isResourceCandidate) return '';
  if (tags.includes('oil') || model.includes('oil_pump') || model.includes('oilpump') || model.includes('pump_jack')) return 'oil';
  if (tags.includes('water') || model.includes('water_tank') || model.includes('watertank')) return 'water';
  if (tags.includes('scrap') || model.includes('scrap')) return 'scrap';
  if (tags.includes('ore') || model.includes('ore')) return 'ore';
  if (tags.includes('wood') || tags.includes('tree') || model.includes('wood') || model.includes('deadwood')) return 'wood';
  return '';
}

function naturalCreatureKind(row = {}) {
  const entity = objectEntity(row);
  const text = [
    row.name,
    row.model,
    row.url,
    row.visual,
    row.species,
    row.typeName,
    row.role,
    row.encounterRole,
    entity.role,
    entity.species,
    entity.profile,
    entity.statProfile,
    entity.lootProfile,
    objectTags(row).join(' ')
  ].map(value => String(value || '')).join(' ').toLowerCase();
  const compact = text.replace(/[^a-z0-9]+/g, '');
  if (compact.includes('brahmin') || text.includes('брамин')) return 'brahmin';
  if (compact.includes('radscorpion') || text.includes('scorpion') || text.includes('скорпион')) return 'radscorpion';
  if (compact.includes('mutantant') || text.includes('мурав')) return 'mutantAnt';
  if (compact.includes('firegecko') || (text.includes('огненн') && text.includes('геккон'))) return 'fireGecko';
  if (compact.includes('gecko') || text.includes('геккон')) return 'gecko';
  if (compact.includes('ashwolf') || text.includes('wolf') || text.includes('волк')) return 'wolf';
  if (String(row.role || row.encounterRole || entity.role || '').toLowerCase() === 'animal') return 'animal';
  return '';
}

function checkNaturalCreatureActor(row, label, rel) {
  if (!naturalCreatureKind(row)) return;
  const entity = objectEntity(row);
  const generation = entity.generation && typeof entity.generation === 'object' ? entity.generation : {};
  const profile = safeId(row.equipmentProfile || entity.equipmentProfile || generation.equipmentProfile).toLowerCase();
  if (profile && !['none', 'natural', 'animal', 'creature'].includes(profile)) {
    errors.push(`${rel}: ${label} is a natural creature but has equipment profile "${profile}"`);
  }
  const equipment = row.equipment && typeof row.equipment === 'object' ? row.equipment : {};
  const entityEquipment = entity.equipment && typeof entity.equipment === 'object' ? entity.equipment : {};
  const equippedItems = [...Object.values(equipment), ...Object.values(entityEquipment)].map(value => String(value || '')).filter(Boolean);
  if (equippedItems.length) errors.push(`${rel}: ${label} is a natural creature but has equipment (${equippedItems.join(', ')})`);
  const inventory = [
    ...(Array.isArray(row.inventory) ? row.inventory : []),
    ...(Array.isArray(entity.inventory) ? entity.inventory : []),
    ...(Array.isArray(generation.inventory) ? generation.inventory : [])
  ];
  inventory.forEach((entry, index) => {
    const itemId = String(entry?.id || '');
    if (/^(pistol|rifle|assaultRifle|machineGun|laserPistol|flamethrower|plasmaRifle|shotgun|rocketLauncher|knife|ammo9|ammo556|energyCell|napalm|shotgunShell|rocketAmmo)$/i.test(itemId)) {
      errors.push(`${rel}: ${label} inventory[${index}] gives combat item "${itemId}" to a natural creature`);
    }
  });
  if (row.tradeProfile || row.traderProfile || entity.tradeProfile || entity.traderProfile || generation.tradeProfile) {
    errors.push(`${rel}: ${label} is a natural creature but has trader profile`);
  }
}

function readServerItemIds() {
  const match = serverSource.match(/const\s+SERVER_ITEM_IDS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!match) return new Set();
  const ids = [];
  const re = /'([^']+)'/g;
  let next;
  while ((next = re.exec(match[1]))) ids.push(next[1]);
  return new Set(ids);
}

function readStaticModelKeys() {
  const source = [
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
    '02e_trader_yard_world_build.js'
  ].map(name => fs.readFileSync(path.join(root, 'public', 'js', 'game', name), 'utf8')).join('\n');
  const match = source.match(/const\s+STATIC_MODEL_URLS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!match) return new Set();
  const keys = [];
  const re = /^\s*([a-zA-Z0-9_]+)\s*:/gm;
  let next;
  while ((next = re.exec(match[1]))) keys.push(next[1]);
  return new Set(keys);
}

const GLOBAL_MAP_MODEL_ALIASES = {
  oldKlimYard: 'traderAwning',
  scrapTown: 'scrapWatchTower',
  relayStation: 'relayAntenna'
};
const LOCATION_EDITOR_MODEL_ALIASES = {
  rustBarrel: 'barrel'
};
const GLOBAL_MAP_COASTLINE = [
  { x: 0.105, y: 0.00 }, { x: 0.070, y: 0.08 }, { x: 0.082, y: 0.16 }, { x: 0.055, y: 0.25 },
  { x: 0.106, y: 0.36 }, { x: 0.090, y: 0.48 }, { x: 0.142, y: 0.62 }, { x: 0.126, y: 0.73 },
  { x: 0.184, y: 0.86 }, { x: 0.154, y: 1.00 }
];
const GLOBAL_MAP_WATER_TEXTURES = new Set(['water', 'ocean', 'sea', 'lake']);
const ROAD_LOCATION_CLEARANCE_POINTS = 20;
const PIPELINE_ROAD_EDGE_CLEARANCE_POINTS = 18;
const ROAD_OUTPOST_SITE_IDS = new Set(['roadOutpost', 'scrapOutpost', 'relayOutpost']);

function resolveGlobalMapModelKey(value) {
  const key = safeId(value);
  return GLOBAL_MAP_MODEL_ALIASES[key] || key;
}

function checkGlobalMapModelKey(value, label, rel) {
  const key = safeId(value);
  if (!key) return;
  const resolved = resolveGlobalMapModelKey(key);
  if (staticModelKeys.size && !staticModelKeys.has(resolved)) {
    errors.push(`${rel}: ${label} references unknown global map model "${value}"`);
  }
}

function resolveLocationEditorModelKey(value) {
  const key = safeId(value);
  return LOCATION_EDITOR_MODEL_ALIASES[key] || key;
}

function globalMapCoastNormXAtY(ny = 0) {
  const y = Math.max(0, Math.min(1, Number(ny || 0)));
  const points = GLOBAL_MAP_COASTLINE;
  if (y <= points[0].y) return points[0].x;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (y <= b.y) {
      const t = (y - a.y) / Math.max(0.0001, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return points[points.length - 1].x;
}

function globalMapPointCellForMap(globalMap, x = 0, y = 0) {
  const grid = globalMap?.grid || {};
  const cols = Math.max(1, Number(grid.cols || 30));
  const rows = Math.max(1, Number(grid.rows || 30));
  const cellPoints = Math.max(1, Number(grid.cellPoints || 30));
  return {
    cx: Math.max(0, Math.min(cols - 1, Math.floor(Number(x || 0) / cellPoints))),
    cy: Math.max(0, Math.min(rows - 1, Math.floor(Number(y || 0) / cellPoints)))
  };
}

function globalMapPointIsWaterForMap(globalMap, x = 0, y = 0) {
  const grid = globalMap?.grid || {};
  const cols = Math.max(1, Number(grid.cols || 30));
  const rows = Math.max(1, Number(grid.rows || 30));
  const cellPoints = Math.max(1, Number(grid.cellPoints || 30));
  const width = cols * cellPoints;
  const height = rows * cellPoints;
  const px = Math.max(0, Math.min(width, Number(x || 0)));
  const py = Math.max(0, Math.min(height, Number(y || 0)));
  const nx = px / width;
  const ny = py / height;
  if (nx <= globalMapCoastNormXAtY(ny)) return true;
  const cell = globalMapPointCellForMap(globalMap, px, py);
  const override = globalMap?.cells?.[`${cell.cx}:${cell.cy}`];
  const texture = String(override?.texture || override?.textureId || '').trim().toLowerCase();
  return GLOBAL_MAP_WATER_TEXTURES.has(texture);
}

function nearestGlobalMapRoad(point = {}, roads = []) {
  let nearest = null;
  for (const road of roads) {
    const distance = pointToInfrastructureDistance(point, road);
    if (!nearest || distance < nearest.distance) nearest = { road, distance };
  }
  return nearest;
}

function readGlobalMapEditorModels() {
  const file = path.join(root, 'public', 'dev-global-map-editor.html');
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/const\s+GLOBAL_MODEL_LIBRARY\s*=\s*\[([\s\S]*?)\]\.map/);
  if (!match) return [];
  const rows = [];
  const re = /\{\s*key:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'/g;
  let next;
  while ((next = re.exec(match[1]))) rows.push({ key: next[1], file: next[2] });
  return rows;
}

function readLocationEditorModels() {
  const source = locationEditorSource;
  if (!source) return [];
  const match = source.match(/const\s+MODEL_LIBRARY\s*=\s*\[([\s\S]*?)\]\.map/);
  if (!match) return [];
  const rows = [];
  const re = /\{\s*key:\s*'([^']+)'\s*,\s*file:\s*'([^']+)'/g;
  let next;
  while ((next = re.exec(match[1]))) rows.push({ key: next[1], file: next[2] });
  return rows;
}

const ENCOUNTER_MODEL_BY_TYPE_INDEX = [
  'enemyRaider',
  'enemyGhoul',
  'enemySuperMutant',
  'enemyAshWolf',
  'enemyRadscorpion',
  'enemyMutantAnt',
  'enemyGecko',
  'enemyFireGecko'
];
const ENCOUNTER_MODEL_BY_VISUAL = {
  raider: 'enemyRaider',
  enemyraider: 'enemyRaider',
  enemy_raider: 'enemyRaider',
  ghoul: 'enemyGhoul',
  enemyghoul: 'enemyGhoul',
  enemy_ghoul: 'enemyGhoul',
  mutant: 'enemySuperMutant',
  supermutant: 'enemySuperMutant',
  super_mutant: 'enemySuperMutant',
  enemysupermutant: 'enemySuperMutant',
  enemy_super_mutant: 'enemySuperMutant',
  wolf: 'enemyAshWolf',
  ashwolf: 'enemyAshWolf',
  ash_wolf: 'enemyAshWolf',
  enemyashwolf: 'enemyAshWolf',
  enemy_ash_wolf: 'enemyAshWolf',
  radscorpion: 'enemyRadscorpion',
  rad_scorpion: 'enemyRadscorpion',
  enemyradscorpion: 'enemyRadscorpion',
  enemy_radscorpion: 'enemyRadscorpion',
  mutantant: 'enemyMutantAnt',
  mutant_ant: 'enemyMutantAnt',
  enemymutantant: 'enemyMutantAnt',
  enemy_mutant_ant: 'enemyMutantAnt',
  gecko: 'enemyGecko',
  enemygecko: 'enemyGecko',
  enemy_gecko: 'enemyGecko',
  firegecko: 'enemyFireGecko',
  fire_gecko: 'enemyFireGecko',
  enemyfiregecko: 'enemyFireGecko',
  enemy_fire_gecko: 'enemyFireGecko',
  brahmin: 'friendlyBrahmin',
  animal: 'friendlyBrahmin',
  friendlybrahmin: 'friendlyBrahmin',
  friendly_brahmin: 'friendlyBrahmin',
  caravanmerchant: 'caravanMerchant',
  caravan_merchant: 'caravanMerchant',
  caravanguard: 'caravanGuard',
  caravan_guard: 'caravanGuard',
  klimpatrolguard: 'klimPatrolGuard',
  klim_patrol_guard: 'klimPatrolGuard',
  wastelandsettler: 'wastelandSettler',
  wasteland_settler: 'wastelandSettler'
};
const MERCHANT_MODEL_KEYS = new Set(['traderNpc', 'caravanMerchant']);
const GUARD_MODEL_KEYS = new Set(['caravanGuard', 'klimPatrolGuard']);
const CIVILIAN_MODEL_KEYS = new Set(['wastelandSettler']);
const FRIENDLY_ANIMAL_MODEL_KEYS = new Set(['friendlyBrahmin']);
const HOSTILE_MODEL_KEYS = new Set([
  'enemyRaider',
  'enemyGhoul',
  'enemySuperMutant',
  'enemyAshWolf',
  'enemyRadscorpion',
  'enemyMutantAnt',
  'enemyGecko',
  'enemyFireGecko'
]);
const NATURAL_CREATURE_MODEL_KEYS = new Set([
  'friendlyBrahmin',
  'enemyGhoul',
  'enemyAshWolf',
  'enemyRadscorpion',
  'enemyMutantAnt',
  'enemyGecko',
  'enemyFireGecko'
]);

function inferredEncounterModelByVisual(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.replace(/[^a-zA-Z0-9_]+/g, '').toLowerCase();
  const snake = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return ENCOUNTER_MODEL_BY_VISUAL[key] || ENCOUNTER_MODEL_BY_VISUAL[snake] || '';
}

function inferredEncounterModelKey(actor = {}) {
  const role = String(actor.role || '').toLowerCase();
  const faction = safeId(actor.faction).toLowerCase();
  const tradeProfile = safeId(actor.tradeProfile || actor.traderProfile).toLowerCase();
  const text = [
    actor.visual,
    actor.species,
    actor.modelKey,
    actor.model,
    actor.name,
    actor.typeName
  ].map(value => String(value || '')).join(' ').toLowerCase();
  if (actor.modelKey || actor.model) return safeId(actor.modelKey || actor.model);
  const directVisualModel = inferredEncounterModelByVisual(actor.visual || actor.species);
  if (directVisualModel) return directVisualModel;
  if (role === 'merchant' || tradeProfile === 'caravan') return 'caravanMerchant';
  if (role === 'guard') return faction === 'klim_patrol' || text.includes('клим') ? 'klimPatrolGuard' : 'caravanGuard';
  if (role === 'civilian') return 'wastelandSettler';
  if (role === 'animal' || text.includes('брамин') || text.includes('brahmin')) return 'friendlyBrahmin';
  if (text.includes('огнен') && text.includes('геккон')) return 'enemyFireGecko';
  if (text.includes('firegecko') || text.includes('fire_gecko')) return 'enemyFireGecko';
  if (text.includes('геккон') || text.includes('gecko')) return 'enemyGecko';
  if (text.includes('мурав') || text.includes('mutantant') || text.includes('mutant_ant')) return 'enemyMutantAnt';
  if (text.includes('скорпион') || text.includes('radscorpion') || text.includes('scorpion')) return 'enemyRadscorpion';
  if (text.includes('волк') || text.includes('ashwolf') || text.includes('ash_wolf')) return 'enemyAshWolf';
  if (text.includes('супер') || text.includes('supermutant') || text.includes('super_mutant')) return 'enemySuperMutant';
  if (text.includes('гул') || text.includes('ghoul')) return 'enemyGhoul';
  const typeIndex = Number(actor.typeIndex);
  if (Number.isInteger(typeIndex) && ENCOUNTER_MODEL_BY_TYPE_INDEX[typeIndex]) return ENCOUNTER_MODEL_BY_TYPE_INDEX[typeIndex];
  if (role === 'raider' || actor.equipment?.weapon) return 'enemyRaider';
  return '';
}

function actorRoleForCompatibility(row = {}) {
  const entity = objectEntity(row);
  return String(row.role || row.encounterRole || entity.role || '').trim().toLowerCase();
}

function actorTradeProfiles(row = {}) {
  const entity = objectEntity(row);
  const generation = entity.generation && typeof entity.generation === 'object' ? entity.generation : {};
  return [
    row.tradeProfile,
    row.traderProfile,
    entity.tradeProfile,
    entity.traderProfile,
    generation.tradeProfile,
    generation.traderProfile
  ].map(safeId).filter(Boolean);
}

function checkActorRoleModelCompatibility(row = {}, modelKey = '', label = 'actor', rel = '') {
  const role = actorRoleForCompatibility(row);
  const key = String(modelKey || '').trim();
  const tradeProfiles = actorTradeProfiles(row);
  const natural = naturalCreatureKind(row);
  if (!key && !role && !tradeProfiles.length) return;

  if ((role === 'merchant' || role === 'trader') && key && !MERCHANT_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} is a trader but resolves to non-trader model "${key}"`);
  }
  if (role === 'guard' && key && !GUARD_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} is a guard but resolves to non-guard model "${key}"`);
  }
  if (role === 'civilian' && key && !CIVILIAN_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} is a civilian but resolves to non-civilian model "${key}"`);
  }
  if (role === 'animal' && key && !FRIENDLY_ANIMAL_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} is an animal but resolves to non-animal model "${key}"`);
  }
  if ((role === 'monster' || role === 'raider' || row.hostileToPlayer === true) && key && (MERCHANT_MODEL_KEYS.has(key) || GUARD_MODEL_KEYS.has(key) || CIVILIAN_MODEL_KEYS.has(key) || FRIENDLY_ANIMAL_MODEL_KEYS.has(key))) {
    errors.push(`${rel}: ${label} is hostile/monster but resolves to friendly model "${key}"`);
  }
  if (role === 'monster' && key && !HOSTILE_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} is a monster but resolves to non-hostile model "${key}"`);
  }
  if ((role === 'merchant' || role === 'trader' || tradeProfiles.length) && HOSTILE_MODEL_KEYS.has(key)) {
    errors.push(`${rel}: ${label} has trading role/profile but resolves to hostile model "${key}"`);
  }
  if ((natural || NATURAL_CREATURE_MODEL_KEYS.has(key)) && tradeProfiles.length) {
    errors.push(`${rel}: ${label} is a natural creature but has trade profile "${tradeProfiles.join(', ')}"`);
  }
}

const itemIds = readServerItemIds();
const staticModelKeys = readStaticModelKeys();
const globalMapEditorModels = readGlobalMapEditorModels();
const locationEditorModels = readLocationEditorModels();
const traderProfiles = new Set();
const questIds = new Set();
const encounterDefs = new Set();
const containerLootTiers = new Set();
const enemyLootTiers = new Set();

const normalizeEncounterActorStart = serverSource.indexOf('function normalizeServerEncounterActor');
const normalizeEncounterActorEnd = serverSource.indexOf('function normalizeServerEncounterDefinitions', normalizeEncounterActorStart);
if (normalizeEncounterActorStart < 0 || normalizeEncounterActorEnd < 0) {
  errors.push('server.js: missing normalizeServerEncounterActor');
} else {
  const body = serverSource.slice(normalizeEncounterActorStart, normalizeEncounterActorEnd);
  ['visual', 'modelKey', 'model', 'species', 'profile', 'statProfile', 'equipmentProfile', 'lootProfile', 'traderProfile', 'tradeProfile'].forEach(field => {
    if (!body.includes(`${field}:`)) errors.push(`server.js: normalizeServerEncounterActor must preserve "${field}" from data/encounters.json`);
  });
}
const spawnAuthoredActorsStart = serverSource.indexOf('function spawnAuthoredLocationActors');
const spawnAuthoredActorsEnd = serverSource.indexOf('function locationUsesAuthoredRuntime', spawnAuthoredActorsStart);
if (spawnAuthoredActorsStart < 0 || spawnAuthoredActorsEnd < 0) {
  errors.push('server.js: missing spawnAuthoredLocationActors');
} else {
  const body = serverSource.slice(spawnAuthoredActorsStart, spawnAuthoredActorsEnd);
  ['profile', 'statProfile', 'equipmentProfile', 'lootProfile', 'traderProfile', 'tradeProfile'].forEach(field => {
    if (!body.includes(`${field}: String(entity.${field}`)) {
      errors.push(`server.js: spawnAuthoredLocationActors must pass entity.${field} into spawnServerEnemy`);
    }
  });
  if (!body.includes('authoredNpcMatchesWastelandOwner(row, controllingSite, loc)')) {
    errors.push('server.js: authored location NPCs must be filtered against the current wasteland site owner');
  }
}
const siteSelectionStart = serverSource.indexOf('function wastelandSitesForLocation');
const siteSelectionEnd = serverSource.indexOf('function wastelandLocationOccupantKey', siteSelectionStart);
if (siteSelectionStart < 0 || siteSelectionEnd < 0) {
  errors.push('server.js: missing wastelandSitesForLocation owner selection');
} else {
  const body = serverSource.slice(siteSelectionStart, siteSelectionEnd);
  if (!body.includes('room?.worldSiteId') || !body.includes('return [explicitSite]')) {
    errors.push('server.js: shared location templates must select occupants by the room worldSiteId');
  }
  try {
    const selectSites = new Function('WASTELAND_SIM', 'worldSiteIdFromRoomId', `${body}; return wastelandSitesForLocation;`)(
      { state: () => ({ sites: {
        shared_a: { id: 'shared_a', locationId: 'randomDryBasin', owner: 'raiders', type: 'pointOfInterest' },
        shared_b: { id: 'shared_b', locationId: 'randomDryBasin', owner: 'relay_order', type: 'pointOfInterest' }
      } }) },
      () => ''
    );
    const selected = selectSites({ id: 'randomDryBasin' }, { id: 'randomDryBasin#site_shared_b', locationId: 'randomDryBasin', worldSiteId: 'shared_b' });
    if (selected.length !== 1 || selected[0]?.id !== 'shared_b') {
      errors.push('server.js: shared location template selected NPCs from a different global-map site');
    }
  } catch (err) {
    errors.push(`server.js: cannot verify shared-template owner selection (${err.message})`);
  }
}
const claimStart = serverSource.indexOf('function maybeClaimClearedWastelandSite');
const claimEnd = serverSource.indexOf('function serverRespawnPlayer', claimStart);
if (claimStart < 0 || claimEnd < 0) {
  errors.push('server.js: missing cleared-site claim handler');
} else {
  const body = serverSource.slice(claimStart, claimEnd);
  if (!body.includes('spawnWastelandSiteWorkers(room, loc)') || !body.includes('wastelandLocationOccupantKey(loc, room)')) {
    errors.push('server.js: a claimed site must rebuild its local occupants from the new owner immediately');
  }
}
if (!serverSource.includes('worldSiteOwner: String(controllingSite?.owner')
  || !clientWorldSyncSource.includes('syncWastelandSiteControlFromWorldState(state)')) {
  errors.push('local world state must synchronize authoritative site control back to the global map state');
}
if (!serverSource.includes('SERVER_ENEMY_MODEL_KEY_BY_VISUAL') || !serverSource.includes('serverEnemyModelKeyForType')) {
  errors.push('server.js: missing explicit enemy visual/model-key fallback map');
}

const REQUIRED_LOCATION_EDITOR_NPC_MODELS = [
  {
    key: 'traderNpc',
    ruleTokens: ["role: 'merchant'", "traderProfile: 'oldKlim'"],
    generationTokens: ["profile: 'oldKlimMerchant'", "equipmentProfile: 'oldKlimMerchant'", "tradeProfile: 'oldKlim'"]
  },
  {
    key: 'caravanMerchant',
    ruleTokens: ["role: 'merchant'", "traderProfile: 'caravan'"],
    generationTokens: ["profile: 'caravanMerchant'", "equipmentProfile: 'caravanMerchant'", "tradeProfile: 'caravan'"]
  },
  {
    key: 'caravanGuard',
    ruleTokens: ["role: 'guard'", "faction: 'caravan'"],
    generationTokens: ["profile: 'caravanGuard'", "equipmentProfile: 'caravanGuard'", "tradeProfile: 'guardCaravan'"]
  },
  {
    key: 'klimPatrolGuard',
    ruleTokens: ["role: 'guard'", "faction: 'klim_patrol'"],
    generationTokens: ["profile: 'klimPatrolGuard'", "equipmentProfile: 'klimPatrolGuard'", "tradeProfile: 'guardKlimPatrol'"]
  },
  {
    key: 'wastelandSettler',
    ruleTokens: ["role: 'civilian'", "hostileToPlayer: false"],
    generationTokens: ["profile: 'wastelandSettler'", "equipmentProfile: 'settler'"]
  },
  {
    key: 'friendlyBrahmin',
    ruleTokens: ["role: 'animal'", "species: 'brahmin'", 'canDialogue: false'],
    generationTokens: ["profile: 'brahmin'", "equipmentProfile: 'none'", "lootProfile: 'brahmin'"]
  },
  {
    key: 'enemyMutantAnt',
    ruleTokens: ["role: 'monster'", "species: 'mutantAnt'", "enemyType: 'mutantAnt'"],
    generationTokens: ["profile: 'mutantAnt'", "equipmentProfile: 'natural'", "lootProfile: 'mutantAnt'"]
  },
  {
    key: 'enemyRadscorpion',
    ruleTokens: ["role: 'monster'", "species: 'radScorpion'", "enemyType: 'radScorpion'"],
    generationTokens: ["profile: 'radscorpion'", "equipmentProfile: 'natural'", "lootProfile: 'radscorpion'"]
  },
  {
    key: 'enemyGecko',
    ruleTokens: ["role: 'monster'", "species: 'gecko'", "enemyType: 'gecko'"],
    generationTokens: ["profile: 'gecko'", "equipmentProfile: 'natural'", "lootProfile: 'gecko'"]
  },
  {
    key: 'enemyFireGecko',
    ruleTokens: ["role: 'monster'", "species: 'fireGecko'", "enemyType: 'fireGecko'"],
    generationTokens: ["profile: 'fireGecko'", "equipmentProfile: 'natural'", "lootProfile: 'fireGecko'"]
  }
];

function objectLiteralBody(source, objectName, key) {
  const objectStart = source.indexOf(`const ${objectName} = {`);
  const keyStart = objectStart >= 0 ? source.indexOf(`${key}: {`, objectStart) : -1;
  if (keyStart < 0) return '';
  const open = source.indexOf('{', keyStart);
  if (open < 0) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(keyStart, i + 1);
    }
  }
  return '';
}

if (!locationEditorSource) {
  errors.push('public/dev-location-editor.html: missing location editor');
} else {
  REQUIRED_LOCATION_EDITOR_NPC_MODELS.forEach(def => {
    if (!locationEditorSource.includes(`key: '${def.key}'`)) {
      errors.push(`public/dev-location-editor.html: missing model library entry for "${def.key}"`);
    }
    const ruleBody = objectLiteralBody(locationEditorSource, 'MODEL_ENTITY_RULES', def.key);
    if (!ruleBody) {
      errors.push(`public/dev-location-editor.html: missing entity rule for "${def.key}"`);
    } else {
      def.ruleTokens.forEach(token => {
        if (!ruleBody.includes(token)) errors.push(`public/dev-location-editor.html: entity rule "${def.key}" missing ${token}`);
      });
    }
    const generationBody = objectLiteralBody(locationEditorSource, 'NPC_AUTO_GENERATION_PROFILES', def.key);
    if (!generationBody) {
      errors.push(`public/dev-location-editor.html: missing auto-generation profile for "${def.key}"`);
    } else {
      def.generationTokens.forEach(token => {
        if (!generationBody.includes(token)) errors.push(`public/dev-location-editor.html: auto-generation profile "${def.key}" missing ${token}`);
      });
    }
  });
}

globalMapEditorModels.forEach(model => {
  checkGlobalMapModelKey(model.key, `editor model "${model.key}"`, path.join('public', 'dev-global-map-editor.html'));
  const url = `/assets/models/wasteland/${model.file}`;
  if (!publicAssetExists(url)) errors.push(`public/dev-global-map-editor.html: editor model "${model.key}" missing asset ${url}`);
});

locationEditorModels.forEach(model => {
  const rel = path.join('public', 'dev-location-editor.html');
  const url = `/assets/models/wasteland/${model.file}`;
  if (!publicAssetExists(url)) errors.push(`${rel}: editor model "${model.key}" missing asset ${url}`);
  const resolved = resolveLocationEditorModelKey(model.key);
  if (staticModelKeys.size && !staticModelKeys.has(resolved)) {
    errors.push(`${rel}: editor model "${model.key}" is not registered in STATIC_MODEL_URLS`);
  }
});

function anyTraderProfileExists(...ids) {
  return ids.map(safeId).filter(Boolean).some(id => traderProfiles.has(id));
}

function checkTraderProfileObject(profile, id, rel) {
  if (!profile || typeof profile !== 'object') {
    errors.push(`${rel}: trader profile "${id}" is not an object`);
    return;
  }
  if (traderProfiles.has(id)) errors.push(`${rel}: duplicate trader profile "${id}"`);
  traderProfiles.add(id);
  const stock = Array.isArray(profile.stock) ? profile.stock : [];
  stock.forEach((entry, index) => {
    const itemId = String(entry?.id || '');
    if (!itemIds.has(itemId)) errors.push(`${rel}: trader "${id}" stock[${index}] unknown item "${itemId}"`);
    if (!finiteNumber(entry?.qty) || Number(entry.qty) <= 0) errors.push(`${rel}: trader "${id}" stock[${index}] has invalid qty`);
    if (!finiteNumber(entry?.price) || Number(entry.price) <= 0) errors.push(`${rel}: trader "${id}" stock[${index}] has invalid price`);
  });
  if (profile.caps !== undefined && (!finiteNumber(profile.caps) || Number(profile.caps) < 0)) {
    errors.push(`${rel}: trader "${id}" has invalid caps`);
  }
}

function checkQuestObject(quest, id, rel) {
  if (!quest || typeof quest !== 'object') {
    errors.push(`${rel}: quest "${id}" is not an object`);
    return;
  }
  if (questIds.has(id)) errors.push(`${rel}: duplicate quest "${id}"`);
  questIds.add(id);
  const reqItems = quest.requirements && typeof quest.requirements.items === 'object' ? quest.requirements.items : {};
  for (const [itemId, qty] of Object.entries(reqItems || {})) {
    if (!itemIds.has(itemId)) errors.push(`${rel}: quest "${id}" requirement references unknown item "${itemId}"`);
    if (!finiteNumber(qty) || Number(qty) <= 0) errors.push(`${rel}: quest "${id}" requirement "${itemId}" has invalid qty`);
  }
  const rewardItems = Array.isArray(quest.reward?.items) ? quest.reward.items : [];
  rewardItems.forEach((entry, index) => {
    const itemId = String(entry?.id || '');
    if (!itemIds.has(itemId)) errors.push(`${rel}: quest "${id}" reward[${index}] references unknown item "${itemId}"`);
    if (!finiteNumber(entry?.qty) || Number(entry.qty) <= 0) errors.push(`${rel}: quest "${id}" reward[${index}] has invalid qty`);
  });
  if (quest.reward?.xp !== undefined && (!finiteNumber(quest.reward.xp) || Number(quest.reward.xp) < 0)) {
    errors.push(`${rel}: quest "${id}" has invalid xp reward`);
  }
  if (quest.reward?.silver !== undefined && (!finiteNumber(quest.reward.silver) || Number(quest.reward.silver) < 0)) {
    errors.push(`${rel}: quest "${id}" has invalid silver reward`);
  }
}

function checkEncounterObject(encounter, id, rel) {
  if (!encounter || typeof encounter !== 'object') {
    errors.push(`${rel}: encounter "${id}" is not an object`);
    return;
  }
  if (encounterDefs.has(id)) errors.push(`${rel}: duplicate encounter "${id}"`);
  encounterDefs.add(id);
  const actors = Array.isArray(encounter.actors) ? encounter.actors : [];
  if (!actors.length) warnings.push(`${rel}: encounter "${id}" has no actors`);
  actors.forEach((actor, index) => {
    if (!pointLooksValid(actor)) errors.push(`${rel}: encounter "${id}" actor[${index}] has no tx/tz`);
    if (actor.typeIndex !== undefined && (!finiteNumber(actor.typeIndex) || Number(actor.typeIndex) < 0)) {
      errors.push(`${rel}: encounter "${id}" actor[${index}] has invalid typeIndex`);
    }
    const equipment = actor.equipment && typeof actor.equipment === 'object' ? actor.equipment : {};
    for (const [slot, itemId] of Object.entries(equipment)) {
      if (!itemIds.has(String(itemId || ''))) errors.push(`${rel}: encounter "${id}" actor[${index}] ${slot} references unknown item "${itemId}"`);
    }
    const tradeProfile = safeId(actor.tradeProfile);
    if (tradeProfile && traderProfiles.size && !traderProfiles.has(tradeProfile)) {
      errors.push(`${rel}: encounter "${id}" actor[${index}] references unknown trader profile "${tradeProfile}"`);
    }
    const modelKey = inferredEncounterModelKey(actor);
    if ((modelKey || actor.modelKey || actor.model) && staticModelKeys.size && !staticModelKeys.has(modelKey)) {
      errors.push(`${rel}: encounter "${id}" actor[${index}] resolves to unknown model key "${modelKey || actor.modelKey || actor.model}"`);
    }
    if (['merchant', 'guard', 'civilian', 'animal', 'monster'].includes(String(actor.role || '').toLowerCase()) && !modelKey) {
      warnings.push(`${rel}: encounter "${id}" actor[${index}] has role "${actor.role}" but no visual model key can be inferred`);
    }
    checkActorRoleModelCompatibility(actor, modelKey, `encounter "${id}" actor[${index}]`, rel);
    checkNaturalCreatureActor(actor, `encounter "${id}" actor[${index}]`, rel);
  });
}

function checkLootTableRows(kind, tier, rows, rel) {
  if (!Array.isArray(rows) || !rows.length) {
    errors.push(`${rel}: ${kind} loot table "${tier}" is empty`);
    return;
  }
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') {
      errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] is not an object`);
      return;
    }
    const ids = row.id ? [String(row.id)] : (Array.isArray(row.oneOf) ? row.oneOf.map(String) : []);
    if (!ids.length) errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] has no id/oneOf`);
    ids.forEach(itemId => {
      if (!itemIds.has(itemId)) errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] references unknown item "${itemId}"`);
    });
    if (!finiteNumber(row.min) || Number(row.min) <= 0) errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] has invalid min`);
    if (row.max !== undefined && (!finiteNumber(row.max) || Number(row.max) < Number(row.min || 1))) errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] has invalid max`);
    if (row.chance !== undefined && (!finiteNumber(row.chance) || Number(row.chance) < 0 || Number(row.chance) > 1)) errors.push(`${rel}: ${kind} loot table "${tier}" row[${index}] has invalid chance`);
  });
}

if (!fs.existsSync(locationsDir)) {
  errors.push('data/locations directory is missing');
}

const locations = new Map();
if (fs.existsSync(tradersFile)) {
  const rawTraders = readJson(tradersFile);
  const rel = path.relative(root, tradersFile);
  const profiles = rawTraders && rawTraders.profiles && typeof rawTraders.profiles === 'object'
    ? rawTraders.profiles
    : rawTraders;
  for (const [id, profile] of Object.entries(profiles || {})) {
    checkTraderProfileObject(profile, safeId(profile?.id || id), rel);
  }
} else {
  warnings.push('data/traders.json is missing; authored NPC trade profiles will use runtime fallback');
}

if (fs.existsSync(questsFile)) {
  const rawQuests = readJson(questsFile);
  const rel = path.relative(root, questsFile);
  const quests = rawQuests && rawQuests.quests && typeof rawQuests.quests === 'object'
    ? rawQuests.quests
    : rawQuests;
  for (const [id, quest] of Object.entries(quests || {})) {
    checkQuestObject(quest, safeId(quest?.id || id), rel);
  }
  for (const [id, quest] of Object.entries(quests || {})) {
    const questId = safeId(quest?.id || id);
    (Array.isArray(quest?.unlocks) ? quest.unlocks : []).forEach(unlockId => {
      if (!questIds.has(safeId(unlockId))) errors.push(`${rel}: quest "${questId}" unlocks missing quest "${unlockId}"`);
    });
  }
} else {
  warnings.push('data/quests.json is missing; quest requirements and rewards will use runtime fallback');
}

if (fs.existsSync(encountersFile)) {
  const rawEncounters = readJson(encountersFile);
  const rel = path.relative(root, encountersFile);
  const encounters = rawEncounters && rawEncounters.encounters && typeof rawEncounters.encounters === 'object'
    ? rawEncounters.encounters
    : rawEncounters;
  for (const [id, encounter] of Object.entries(encounters || {})) {
    checkEncounterObject(encounter, safeId(encounter?.id || id), rel);
  }
} else {
  warnings.push('data/encounters.json is missing; random encounter compositions will use runtime fallback');
}

if (fs.existsSync(lootTablesFile)) {
  const rawLoot = readJson(lootTablesFile);
  const rel = path.relative(root, lootTablesFile);
  const containers = rawLoot && rawLoot.containers && typeof rawLoot.containers === 'object' ? rawLoot.containers : {};
  const enemies = rawLoot && rawLoot.enemies && typeof rawLoot.enemies === 'object' ? rawLoot.enemies : {};
  for (const [tier, rows] of Object.entries(containers)) {
    const id = safeId(tier);
    if (!id) continue;
    if (containerLootTiers.has(id)) errors.push(`${rel}: duplicate container loot tier "${id}"`);
    containerLootTiers.add(id);
    checkLootTableRows('container', id, rows, rel);
  }
  for (const [tier, rows] of Object.entries(enemies)) {
    const id = safeId(tier);
    if (!id) continue;
    if (enemyLootTiers.has(id)) errors.push(`${rel}: duplicate enemy loot tier "${id}"`);
    enemyLootTiers.add(id);
    checkLootTableRows('enemy', id, rows, rel);
  }
  if (!containerLootTiers.has('basic')) errors.push(`${rel}: missing container loot tier "basic"`);
  if (!enemyLootTiers.has('basic')) errors.push(`${rel}: missing enemy loot tier "basic"`);
} else {
  errors.push('data/loot-tables.json is missing');
}

if (fs.existsSync(locationsDir)) {
  for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
    const abs = path.join(locationsDir, file);
    const loc = readJson(abs);
    if (!loc || typeof loc !== 'object') continue;
    const fileId = path.basename(file, '.json');
    const id = safeId(loc.id || fileId);
    if (!id) {
      errors.push(`${path.relative(root, abs)}: missing location id`);
      continue;
    }
    if (id !== fileId) {
      warnings.push(`${path.relative(root, abs)}: id "${id}" differs from file name "${fileId}"`);
    }
    if (locations.has(id)) {
      errors.push(`${path.relative(root, abs)}: duplicate location id "${id}"`);
    }
    locations.set(id, { file: abs, loc });
  }
}

for (const [id, row] of locations) {
  const rel = path.relative(root, row.file);
  const loc = row.loc;
  if (!loc.name) warnings.push(`${rel}: missing display name`);
  if (!pointLooksValid(loc.spawn)) warnings.push(`${rel}: spawn point is missing or incomplete`);
  if (String(loc.runtimeMode || loc.authoredMode || '').toLowerCase() === 'procedural' || loc.legacyProcedural === true) {
    warnings.push(`${rel}: procedural runtime mode is enabled; this bypasses the editor-authored world path`);
  }
  const locTraderProfiles = [
    loc.trader?.tradeProfile,
    loc.trader?.traderProfile,
    loc.trader?.profile,
    loc.trader?.dialogueProfile,
    loc.trader?.id
  ].map(safeId).filter(Boolean);
  if (locTraderProfiles.length && traderProfiles.size && !anyTraderProfileExists(...locTraderProfiles)) {
    warnings.push(`${rel}: location trader references unknown trader profile "${locTraderProfiles.join(', ')}"`);
  }
  (Array.isArray(loc.trader?.quests) ? loc.trader.quests : []).forEach(questId => {
    if (questIds.size && !questIds.has(safeId(questId))) warnings.push(`${rel}: location trader references unknown quest "${questId}"`);
  });

  const objectIds = new Set();
  const objects = Array.isArray(loc.objects) ? loc.objects : [];
  const authoredTraders = objects.filter(obj => objectIsNpc(obj) && objectIsTrader(obj));
  const authoredStorages = objects.filter(obj => objectIsStorage(obj));
  if (id === 'settlement') {
    const oldKlimActors = authoredTraders.filter(obj => {
      const entity = objectEntity(obj);
      return safeId(obj.id) === 'old_klim'
        || safeId(entity.traderProfile) === 'oldKlim'
        || safeId(entity.tradeProfile) === 'oldKlim';
    });
    if (oldKlimActors.length !== 1) {
      errors.push(`${rel}: caravan stop must contain exactly one authored Old Klim trader (found ${oldKlimActors.length})`);
    } else {
      const oldKlim = oldKlimActors[0];
      const entity = objectEntity(oldKlim);
      const tags = objectTags(oldKlim);
      if (safeId(oldKlim.id) !== 'old_klim') errors.push(`${rel}: Old Klim must use stable object id "old_klim"`);
      if (resolveLocationEditorModelKey(oldKlim.model || '') !== 'traderNpc') errors.push(`${rel}: Old Klim must use the dedicated "traderNpc" model`);
      if (objectRole(oldKlim) !== 'merchant') errors.push(`${rel}: Old Klim must have merchant role`);
      if (safeId(entity.faction) !== 'old_klim') errors.push(`${rel}: Old Klim must belong to faction "old_klim"`);
      if (entity.hostileToPlayer !== false) errors.push(`${rel}: Old Klim must be friendly to the player`);
      if (entity.canDialogue !== true) errors.push(`${rel}: Old Klim must support dialogue`);
      if (entity.stationary !== true) errors.push(`${rel}: Old Klim must stay at his authored caravan-stop position`);
      if (safeId(entity.traderProfile) !== 'oldKlim' || safeId(entity.tradeProfile) !== 'oldKlim') {
        errors.push(`${rel}: Old Klim must use the authoritative "oldKlim" trade profile`);
      }
      if (safeId(entity.dialogueProfile) !== 'klim') errors.push(`${rel}: Old Klim must use the "klim" dialogue profile`);
      if (!tags.includes('unique') || !tags.includes('leader')) errors.push(`${rel}: Old Klim must remain marked as a unique faction leader`);
      const quests = new Set((Array.isArray(entity.quests) ? entity.quests : []).map(safeId));
      ['klimSupplies', 'klimTerminal'].forEach(questId => {
        if (!quests.has(questId)) errors.push(`${rel}: Old Klim is missing quest "${questId}"`);
      });
    }
  }
  if (id === 'scrapTown') {
    const gratchActors = authoredTraders.filter(obj => {
      const entity = objectEntity(obj);
      return safeId(obj.id) === 'scrap_gratch'
        || safeId(entity.traderProfile) === 'scrap'
        || safeId(entity.tradeProfile) === 'scrap';
    });
    if (gratchActors.length !== 1) {
      errors.push(`${rel}: scrap town must contain exactly one authored Gratch trader (found ${gratchActors.length})`);
    } else {
      const gratch = gratchActors[0];
      const entity = objectEntity(gratch);
      if (safeId(gratch.id) !== 'scrap_gratch') errors.push(`${rel}: Gratch must use stable object id "scrap_gratch"`);
      if (resolveLocationEditorModelKey(gratch.model || '') !== 'traderNpc') errors.push(`${rel}: Gratch must use the dedicated "traderNpc" model`);
      if (objectRole(gratch) !== 'merchant') errors.push(`${rel}: Gratch must have merchant role`);
      if (safeId(entity.faction) !== 'scrap_union') errors.push(`${rel}: Gratch must belong to faction "scrap_union"`);
      if (entity.hostileToPlayer !== false) errors.push(`${rel}: Gratch must be friendly to the player`);
      if (entity.canDialogue !== true) errors.push(`${rel}: Gratch must support dialogue`);
      if (entity.stationary !== true) errors.push(`${rel}: Gratch must stay at his authored scrap-town position`);
      if (safeId(entity.traderProfile) !== 'scrap' || safeId(entity.tradeProfile) !== 'scrap') {
        errors.push(`${rel}: Gratch must use the authoritative "scrap" trade profile`);
      }
      if (safeId(entity.dialogueProfile) !== 'scrap') errors.push(`${rel}: Gratch must use the "scrap" dialogue profile`);
      const quests = new Set((Array.isArray(entity.quests) ? entity.quests : []).map(safeId));
      if (!quests.has('scrapParts')) errors.push(`${rel}: Gratch is missing quest "scrapParts"`);
    }
  }
  const locTraderObjectId = safeId(loc.trader?.objectId);
  const locStorageObjectId = safeId(loc.storage?.objectId);
  if ((loc.trader?.authoredActor || loc.trader?.authoredObject || locTraderObjectId) && locTraderObjectId && !authoredTraders.some(obj => safeId(obj.id) === locTraderObjectId)) {
    warnings.push(`${rel}: location trader objectId "${locTraderObjectId}" is stale; runtime will use authored trader objects`);
  }
  if ((loc.storage?.authoredObject || locStorageObjectId) && locStorageObjectId && !authoredStorages.some(obj => safeId(obj.id) === locStorageObjectId)) {
    warnings.push(`${rel}: location storage objectId "${locStorageObjectId}" is stale; runtime will use authored storage objects`);
  }
  objects.forEach((obj, index) => {
    if (!obj || typeof obj !== 'object') {
      errors.push(`${rel}: objects[${index}] is not an object`);
      return;
    }
    const objectId = String(obj.id || '').trim();
    if (objectId) {
      if (objectIds.has(objectId)) errors.push(`${rel}: duplicate object id "${objectId}"`);
      objectIds.add(objectId);
    }
    if (!pointLooksValid(obj)) warnings.push(`${rel}: object "${objectId || index}" has no tx/tz or position x/z`);
    if (obj.url && !publicAssetExists(obj.url)) errors.push(`${rel}: object "${objectId || index}" missing asset ${obj.url}`);
    const resourceType = objectResourceType(obj);
    if (resourceType && obj.collision === 'none') {
      warnings.push(`${rel}: resource object "${objectId || index}" has collision "none"; harvesting may not be reachable through interaction`);
    }
    if (resourceType && (!finiteNumber(obj.hp || obj.maxHp) || Number(obj.hp || obj.maxHp) <= 0)) {
      warnings.push(`${rel}: resource object "${objectId || index}" has no positive hp/maxHp`);
    }
    const entity = obj.entity && typeof obj.entity === 'object' ? obj.entity : {};
    const modelKey = resolveLocationEditorModelKey(obj.model || '');
    checkActorRoleModelCompatibility(obj, modelKey, `object "${objectId || index}"`, rel);
    checkNaturalCreatureActor(obj, `object "${objectId || index}"`, rel);
    const tradeProfiles = [entity.tradeProfile, entity.traderProfile].map(safeId).filter(Boolean);
    if (tradeProfiles.length && traderProfiles.size && !anyTraderProfileExists(...tradeProfiles)) {
      warnings.push(`${rel}: object "${objectId || index}" references unknown trader profile "${tradeProfiles.join(', ')}"`);
    }
    (Array.isArray(entity.quests) ? entity.quests : []).forEach(questId => {
      if (questIds.size && !questIds.has(safeId(questId))) warnings.push(`${rel}: object "${objectId || index}" references unknown quest "${questId}"`);
    });
  });

  const transitions = Array.isArray(loc.transitions) ? loc.transitions : [];
  transitions.forEach((tr, index) => {
    if (!tr || typeof tr !== 'object') {
      errors.push(`${rel}: transitions[${index}] is not an object`);
      return;
    }
    if (tr.type !== 'globalMap' && tr.to && !locations.has(safeId(tr.to))) {
      errors.push(`${rel}: transition "${tr.id || index}" points to missing location "${tr.to}"`);
    }
    if (!pointLooksValid(tr)) warnings.push(`${rel}: transition "${tr.id || index}" has no tx/tz`);
  });

  if (loc.exit && loc.exit.to && !locations.has(safeId(loc.exit.to))) {
    errors.push(`${rel}: exit points to missing location "${loc.exit.to}"`);
  }

  const zones = Array.isArray(loc.worldZones) ? loc.worldZones : [];
  zones.forEach((zone, index) => {
    if (!pointLooksValid(zone)) warnings.push(`${rel}: world zone "${zone?.id || index}" has no tx/tz`);
  });

  const containers = Array.isArray(loc.containers) ? loc.containers : [];
  containers.forEach((container, index) => {
    if (!pointLooksValid(container)) warnings.push(`${rel}: container "${container?.id || index}" has no tx/tz`);
    const tier = safeId(container?.tier || 'basic');
    if (tier && containerLootTiers.size && !containerLootTiers.has(tier)) {
      errors.push(`${rel}: container "${container?.id || index}" references unknown loot tier "${tier}"`);
    }
  });
}

if (!locations.size) errors.push('No location files found in data/locations');

if (fs.existsSync(wastelandSimFile)) {
  const sim = readJson(wastelandSimFile);
  wastelandSim = sim;
  const rel = path.relative(root, wastelandSimFile);
  for (const [siteId, site] of Object.entries(sim?.sites || {})) {
    const locationId = safeId(site?.locationId);
    const templateLocationId = safeId(site?.templateLocationId);
    if (!locationId) continue;
    if (templateLocationId) {
      if (locationId !== worldSiteLocationId(site?.id || siteId)) {
        errors.push(`${rel}: site "${site?.id || siteId}" has unstable world location id "${locationId}"`);
      }
      if (!locations.has(templateLocationId)) {
        errors.push(`${rel}: site "${site?.id || siteId}" points to missing location template "${templateLocationId}"`);
      }
      continue;
    }
    if (!locations.has(locationId)) {
      const caseMatch = [...locations.keys()].find(id => id.toLowerCase() === locationId.toLowerCase());
      const hint = caseMatch ? `; did you mean "${caseMatch}"?` : '';
      errors.push(`${rel}: site "${site?.id || siteId}" points to missing location "${locationId}"${hint}`);
    }
  }
  (Array.isArray(sim?.worldZones) ? sim.worldZones : []).forEach((zone, index) => {
    const id = String(zone?.id || '');
    const realTimePartyEncounter = zone?.details?.realTimePartyEncounter === true
      && zone?.details?.simulationDisabled === true;
    if (!realTimePartyEncounter
      && (id.startsWith('party_meeting_') || String(zone?.sourceType || '') === 'party_zone' || zone?.details?.partyEncounter === true)) {
      errors.push(`${rel}: worldZones[${index}] keeps deprecated party encounter zone "${id || index}"`);
    }
    const status = String(zone?.status || 'active');
    if ((status === 'resolved' || status === 'expired') && !zone?.details?.fixedLair) {
      errors.push(`${rel}: worldZones[${index}] keeps finished transient zone "${id || index}"`);
    }
    if ((String(zone?.sourceType || '') === 'site_conflict' || zone?.details?.siteConflict) && zone?.locationId) {
      const expectedRoomId = safeId(zone.locationId).slice(0, 96);
      if (String(zone?.roomId || '') !== expectedRoomId) {
        errors.push(`${rel}: worldZones[${index}] must use the single location reality "${expectedRoomId}" instead of "${zone?.roomId || ''}"`);
      }
    }
  });
}

const globalMap = fs.existsSync(globalMapFile) ? readJson(globalMapFile) : null;
if (!globalMap) {
  errors.push('data/global-map.json is missing');
} else {
  const rel = path.relative(root, globalMapFile);
  const rawInfrastructure = Array.isArray(globalMap.infrastructure) ? globalMap.infrastructure : [];
  const infrastructureRows = normalizeGlobalInfrastructure(rawInfrastructure, globalMap);
  const roads = infrastructureRows.filter(row => row.type === 'road');
  const pipelines = infrastructureRows.filter(row => row.type === 'pipeline');
  if (infrastructureRows.length !== rawInfrastructure.length) {
    errors.push(`${rel}: ${rawInfrastructure.length - infrastructureRows.length} infrastructure route(s) are invalid or have fewer than two points`);
  }
  const infrastructureIds = new Set();
  infrastructureRows.forEach(row => {
    if (infrastructureIds.has(row.id)) errors.push(`${rel}: duplicate infrastructure id "${row.id}"`);
    infrastructureIds.add(row.id);
    for (let index = 1; index < row.points.length; index += 1) {
      if (!infrastructureSegmentIsLand(globalMap, row.points[index - 1], row.points[index])) {
        errors.push(`${rel}: ${row.type} "${row.id}" segment ${index} crosses water`);
      }
    }
  });
  pipelines.forEach(pipeline => {
    roads.forEach(road => {
      const distance = infrastructureToInfrastructureDistance(pipeline, road);
      const requiredDistance = PIPELINE_ROAD_EDGE_CLEARANCE_POINTS
        + Number(pipeline.width || 0) * 0.5
        + Number(road.width || 0) * 0.5;
      if (distance < requiredDistance) {
        const edgeGap = distance - Number(pipeline.width || 0) * 0.5 - Number(road.width || 0) * 0.5;
        errors.push(`${rel}: pipeline "${pipeline.id}" is too close to road "${road.id}" (edge gap ${edgeGap.toFixed(1)}, required ${PIPELINE_ROAD_EDGE_CLEARANCE_POINTS})`);
      }
    });
  });
  const encounterIds = new Set((Array.isArray(globalMap.encounters) ? globalMap.encounters : [])
    .map(row => safeId(row && row.id)).filter(Boolean));
  encounterIds.forEach(id => {
    if (encounterDefs.size && !encounterDefs.has(id)) errors.push(`${rel}: encounter "${id}" has no composition in data/encounters.json`);
  });
  // Клиент вписывает модель узла так, чтобы её самое длинное ребро было равно
  // цели (2.1 для одиночной локации), см. fitGlobalMapStaticModelInstance.
  const GLOBAL_MAP_NODE_FIT_TARGET = 2.1;
  const CAPITAL_MIN_MAP_HEIGHT = 0.9;
  const GLOBAL_MAP_NODE_MODEL_FILES = {
    oldKlimYard: 'trader_awning.glb',
    traderAwning: 'trader_awning.glb',
    scrapTown: 'scrap_watch_tower.glb',
    scrapWatchTower: 'scrap_watch_tower.glb',
    relayStation: 'relay_antenna.glb',
    relayAntenna: 'relay_antenna.glb',
    wastelandShack: 'wasteland_shack.glb',
    brahminPen: 'brahmin_pen.glb',
    watchPost: 'watch_post.glb',
    storageLeanTo: 'storage_lean_to.glb'
  };
  function globalMapNodeFittedHeight(node = {}) {
    const file = GLOBAL_MAP_NODE_MODEL_FILES[String(node.model || '')];
    if (!file) return null;
    const entry = readJson(path.join('public', 'assets', 'models', 'wasteland', 'model-colliders.json'), { models: {} })?.models?.[file];
    const size = entry?.size;
    if (!size) return null;
    const longest = Math.max(Number(size.x || 0), Number(size.y || 0), Number(size.z || 0));
    if (!(longest > 0)) return null;
    const target = GLOBAL_MAP_NODE_FIT_TARGET * Math.max(0.45, Math.min(4, Number(node.modelScale || 1)));
    return Number(size.y || 0) * target / longest;
  }

  const randomLocationRows = Array.isArray(globalMap.randomLocations) ? globalMap.randomLocations : [];
  randomLocationRows.forEach((row, index) => {
    const id = safeId(row && row.id);
    if (id && !locations.has(id)) errors.push(`${rel}: randomLocations[${index}] points to missing location "${id}"`);
  });
  (Array.isArray(globalMap.nodes) ? globalMap.nodes : []).forEach((node, index) => {
    const locationId = safeId(node && node.locationId);
    if (locationId && !locations.has(locationId)) errors.push(`${rel}: node "${node.id || index}" points to missing location "${locationId}"`);
    const defaultNodeModel = node?.kind === 'settlement'
      ? ({ settlement: 'oldKlimYard', scrapTown: 'scrapTown', relayStation: 'relayStation' }[safeId(node.id)] || '')
      : '';
    checkGlobalMapModelKey(node?.model || defaultNodeModel, `node "${node?.id || index}"`, rel);
    // Столица обязана читаться на карте. Модели узлов вписываются по самому
    // длинному ребру, поэтому плоская модель (загон, навес плашмя) даёт
    // силуэт вдвое-вчетверо ниже соседей и теряется на рельефе.
    if (node?.capital === true) {
      const height = globalMapNodeFittedHeight(node);
      if (height !== null && height < CAPITAL_MIN_MAP_HEIGHT) {
        errors.push(`${rel}: capital "${node.id || index}" renders only ${height.toFixed(2)} tall on the map `
          + `(minimum ${CAPITAL_MIN_MAP_HEIGHT}); its model is too flat to read as a settlement`);
      }
    }
    if (finiteNumber(node?.x) && finiteNumber(node?.y) && globalMapPointIsWaterForMap(globalMap, node.x, node.y)) {
      errors.push(`${rel}: node "${node.id || index}" is placed on water`);
    }
    if (finiteNumber(node?.x) && finiteNumber(node?.y)) {
      const nearest = nearestGlobalMapRoad(node, roads);
      const requiredDistance = ROAD_LOCATION_CLEARANCE_POINTS + Number(nearest?.road?.width || 0) * 0.5;
      if (nearest && nearest.distance <= requiredDistance) {
        errors.push(`${rel}: node "${node.id || index}" overlaps road "${nearest.road.id}" (${nearest.distance.toFixed(1)} <= ${requiredDistance.toFixed(1)})`);
      }
    }
  });
  (Array.isArray(globalMap.objects) ? globalMap.objects : []).forEach((obj, index) => {
    if (obj?.url && !publicAssetExists(obj.url)) errors.push(`${rel}: map object "${obj.id || index}" missing asset ${obj.url}`);
    checkGlobalMapModelKey(obj?.model, `map object "${obj?.id || index}"`, rel);
    const locationId = safeId(obj && obj.locationId);
    if (locationId && !locations.has(locationId)) errors.push(`${rel}: map object "${obj.id || index}" points to missing location "${locationId}"`);
    if (finiteNumber(obj?.x) && finiteNumber(obj?.y) && globalMapPointIsWaterForMap(globalMap, obj.x, obj.y)) {
      errors.push(`${rel}: map object "${obj.id || index}" is placed on water`);
    }
  });
  for (const [siteId, site] of Object.entries(wastelandSim?.sites || {})) {
    if (!finiteNumber(site?.x) || !finiteNumber(site?.y)) continue;
    const nearest = nearestGlobalMapRoad(site, roads);
    if (!nearest) continue;
    const id = safeId(site?.id || siteId);
    const roadOutpost = site?.roadOutpost === true || ROAD_OUTPOST_SITE_IDS.has(id);
    if (roadOutpost) {
      const maxDistance = Number(nearest.road.width || 0) * 0.5 + 2;
      if (nearest.distance > maxDistance) {
        errors.push(`${path.relative(root, wastelandSimFile)}: road outpost "${id}" is not on a road (${nearest.distance.toFixed(1)} > ${maxDistance.toFixed(1)})`);
      }
      continue;
    }
    const requiredDistance = ROAD_LOCATION_CLEARANCE_POINTS + Number(nearest.road.width || 0) * 0.5;
    if (nearest.distance <= requiredDistance) {
      const migratesOnLoad = site?.districtInterest === true
        && Number(site.roadLayoutVersion || 0) < ROAD_SITE_LAYOUT_VERSION;
      const message = `${path.relative(root, wastelandSimFile)}: site "${id}" overlaps road "${nearest.road.id}" (${nearest.distance.toFixed(1)} <= ${requiredDistance.toFixed(1)})`;
      if (migratesOnLoad) warnings.push(`${message}; runtime layout v${ROAD_SITE_LAYOUT_VERSION} will relocate it on startup`);
      else errors.push(message);
    }
  }
  const cells = globalMap.cells && typeof globalMap.cells === 'object' ? globalMap.cells : {};
  for (const [key, cell] of Object.entries(cells)) {
    if (!/^\d+:\d+$/.test(key)) errors.push(`${rel}: invalid cell key "${key}"`);
    const waterCell = GLOBAL_MAP_WATER_TEXTURES.has(String(cell?.texture || cell?.textureId || '').trim().toLowerCase());
    if (waterCell) {
      if ((Array.isArray(cell?.encounters) ? cell.encounters : []).length) {
        errors.push(`${rel}: water cell ${key} must not contain random encounters`);
      }
      if ((Array.isArray(cell?.randomLocations) ? cell.randomLocations : []).length) {
        errors.push(`${rel}: water cell ${key} must not contain random locations`);
      }
      if (Number(cell?.chance || 0) > 0) errors.push(`${rel}: water cell ${key} must have encounter chance 0`);
    }
    (Array.isArray(cell?.encounters) ? cell.encounters : []).forEach((row, index) => {
      const id = safeId(row && row.id);
      if (id && encounterIds.size && !encounterIds.has(id)) {
        errors.push(`${rel}: cell ${key} encounter[${index}] points to missing encounter "${id}"`);
      }
    });
    (Array.isArray(cell?.randomLocations) ? cell.randomLocations : []).forEach((row, index) => {
      const id = safeId(row && row.id);
      if (id && !locations.has(id)) errors.push(`${rel}: cell ${key} randomLocations[${index}] points to missing location "${id}"`);
    });
  }
}

if (warnings.length) {
  console.warn(`World data warnings (${warnings.length}):`);
  warnings.forEach(message => console.warn(`- ${message}`));
}

if (errors.length) {
  console.error(`World data errors (${errors.length}):`);
  errors.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`World data OK: ${locations.size} locations checked.`);
