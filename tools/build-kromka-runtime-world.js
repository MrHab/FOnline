'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'locations.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'world-layout.seed.json'), 'utf8'));
const factions = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'factions.json'), 'utf8'));

if (catalog.worldRevision !== seed.worldRevision) throw new Error('Kromka world revision mismatch');

// Refresh only the derived snapshot after an explicit Unity scene export. Never
// regenerate authored terrain, nodes or road-access flags in this mode.
if (process.argv.includes('--sync-authored')) {
  const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
  const file = path.join(root, 'data', 'generated', 'kromka', 'world.json');
  const generated = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (map.sitePlacement !== 'unity-authored' || map.nodes.length !== seed.locations.length)
    throw new Error('Expected an exported authored Unity world');
  for (const point of seed.locations) {
    const node = map.nodes.find(row => row.id === point.id);
    if (!node || node.x !== point.x || node.y !== point.z) throw new Error(`Unity export mismatch: ${point.id}`);
  }
  generated.nodes = map.nodes;
  generated.routes = seed.routes;
  generated.regions = seed.regions;
  generated.contentHash = crypto.createHash('sha256')
    .update(JSON.stringify({ nodes: generated.nodes, routes: seed.routes, migration: seed.migration })).digest('hex');
  fs.writeFileSync(file, JSON.stringify(generated, null, 2) + '\n');
  console.log(`Synced derived world: ${map.nodes.length} authored nodes, ${seed.routes.length} routes; map untouched`);
  process.exit(0);
}

const byId = new Map(catalog.locations.map(row => [row.id, row]));
const factionByCapital = new Map(factions.factions.map(row => [row.capitalLocationId, row.id]));
const regionById = new Map(seed.regions.map(row => [row.id, row]));

function nodeKind(locationType) {
  if (['settlement', 'faction_capital', 'caravan_hub'].includes(locationType)) return 'settlement';
  if (locationType === 'clan_base') return 'clan_base';
  if (locationType === 'resource_site') return 'resource';
  if (locationType === 'mutant_lair') return 'lair';
  if (['story_complex', 'raid_complex'].includes(locationType)) return 'complex';
  return 'outpost';
}

function nodeModel(locationType) {
  if (locationType === 'faction_capital') return 'relayAntenna';
  if (locationType === 'settlement' || locationType === 'caravan_hub') return 'wastelandShack';
  if (locationType === 'clan_base') return 'watchPost';
  if (locationType === 'resource_site') return 'storageLeanTo';
  if (locationType === 'mutant_lair') return 'brahminPen';
  if (locationType === 'story_complex' || locationType === 'raid_complex') return 'relayAntenna';
  return 'watchPost';
}

const nodes = seed.locations.map(position => {
  const location = byId.get(position.id);
  if (!location) throw new Error(`Unknown Kromka location in seed: ${position.id}`);
  const region = regionById.get(location.macroRegion);
  return {
    id: location.id,
    x: position.x,
    y: position.z,
    kind: nodeKind(location.locationType),
    locationCount: 1,
    locationId: location.id,
    capital: factionByCapital.has(location.id),
    capitalFaction: factionByCapital.get(location.id) || '',
    danger: region?.dangerBand || 1,
    model: nodeModel(location.locationType),
    modelScale: location.locationType === 'faction_capital' ? 1.25 : 1,
    rotationY: 0,
    note: `${location.displayName}. ${location.landmarkTags.join(', ')}.`,
    macroRegion: location.macroRegion,
    visualProfile: location.visualProfile,
    worldRevision: seed.worldRevision
  };
});

const infrastructure = seed.routes.map(route => ({
  id: route.id,
  name: route.displayName,
  type: route.kind === 'cascade_canal' ? 'pipeline' : route.kind,
  model: route.kind === 'railway' ? 'rail' : route.kind === 'cascade_canal' ? 'cascade_canal' : 'broken_asphalt',
  walkable: route.kind !== 'cascade_canal',
  travelFactor: route.travelFactor,
  allowCrossingsWith: route.kind === 'cascade_canal'
    ? ['tesma_service_road', 'ore_freight_rail', 'tract_main', 'zero_service_line'] : [],
  width: route.widthKm * seed.grid.cellPoints / seed.grid.cellKm,
  points: route.points.map(([x, z]) => ({ x, y: z }))
}));

for (const node of nodes) {
  node.roadAccess = infrastructure.some(route => route.type !== 'pipeline' && route.points.some((point, index) => {
    if (index === 0) return false;
    const from = route.points[index - 1]; const to = point;
    const dx = to.x - from.x; const dy = to.y - from.y; const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((node.x - from.x) * dx + (node.y - from.y) * dy) / length)) : 0;
    return Math.hypot(node.x - (from.x + dx * t), node.y - (from.y + dy * t)) <= 22;
  }));
}

const palette = {
  northern_sluices: { terrain: 'мокрый бетон затворов', texture: 'wet_concrete', fill: 'rgba(88,108,101,0.70)' },
  middle_vein: { terrain: 'долина Тесьмы', texture: 'river_loam', fill: 'rgba(104,119,79,0.70)' },
  ore_arc: { terrain: 'рудная осыпь', texture: 'iron_scree', fill: 'rgba(127,82,58,0.72)' },
  tract_isthmus: { terrain: 'дорожная пыль', texture: 'tract_dust', fill: 'rgba(138,119,79,0.70)' },
  chalk_lowland: { terrain: 'меловая низь', texture: 'chalk', fill: 'rgba(184,180,145,0.72)' },
  glasslands: { terrain: 'оплавленная почва', texture: 'fused_soil', fill: 'rgba(79,105,101,0.72)' },
  zero_basin: { terrain: 'чёрный грунт котловины', texture: 'zero_soil', fill: 'rgba(54,58,59,0.76)' },
  silent_ring: { terrain: 'Глухой обвод', texture: 'silent_ring', fill: 'rgba(54,65,58,0.78)' }
};

function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const crosses = ((zi > z) !== (zj > z))
      && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function regionScore(region, x, z) {
  const dx = (x - region.center[0]) / region.size[0];
  const dz = (z - region.center[1]) / region.size[1];
  return dx * dx + dz * dz;
}

function regionAt(x, z, cx, cy) {
  if (cx < 2 || cy < 2 || cx >= seed.grid.cols - 2 || cy >= seed.grid.rows - 2) return 'silent_ring';
  const regions = seed.regions.filter(row => !row.ring);
  const authored = regions.filter(region => Array.isArray(region.unityBoundary)
    && region.unityBoundary.length >= 3 && pointInPolygon(x, z, region.unityBoundary));
  const candidates = authored.length > 0 ? authored : regions;
  let winner = candidates[0];
  let score = regionScore(winner, x, z);
  for (const region of candidates.slice(1)) {
    const next = regionScore(region, x, z);
    if (next < score) { score = next; winner = region; }
  }
  return winner.id;
}

const cells = {};
for (let cy = 0; cy < seed.grid.rows; cy += 1) {
  for (let cx = 0; cx < seed.grid.cols; cx += 1) {
    const x = (cx + 0.5) * seed.grid.cellPoints;
    const z = (cy + 0.5) * seed.grid.cellPoints;
    const regionId = regionAt(x, z, cx, cy);
    const region = regionById.get(regionId);
    const visual = palette[regionId];
    cells[`${cx}:${cy}`] = {
      terrain: visual.terrain,
      pvpMode: regionId === 'middle_vein' && cx >= 7 && cx <= 16 ? 'peaceful' : 'pvp',
      chance: regionId === 'silent_ring' ? 65 : 8 + region.dangerBand * 9,
      difficulty: region.dangerBand,
      texture: visual.texture,
      fill: visual.fill,
      macroRegion: regionId,
      encounters: [],
      randomLocations: regionId === 'middle_vein'
        ? [{ id: 'randomAshGrove', weight: 20 }]
        : regionId === 'chalk_lowland'
          ? [{ id: 'randomDryBasin', weight: 20 }]
          : [{ id: 'randomRuinedRoad', weight: 16 }]
    };
  }
}

const globalMap = {
  schema: 'realm.globalMap.v1',
  version: 3,
  worldRevision: seed.worldRevision,
  sitePlacement: 'unity-authored',
  legacyCoastline: false,
  unityScene: catalog.unityGlobalMapScene,
  grid: seed.grid,
  nodes,
  infrastructure,
  objects: [],
  encounters: [],
  randomLocations: [
    { id: 'randomAshGrove', weight: 25 },
    { id: 'randomDryBasin', weight: 25 },
    { id: 'randomRuinedRoad', weight: 25 },
    { id: 'randomEncounter', weight: 25 }
  ],
  cells
};

const generated = {
  schema: 'kromka.generatedWorld.v1',
  version: 1,
  worldRevision: seed.worldRevision,
  unityScene: catalog.unityGlobalMapScene,
  grid: seed.grid,
  regions: seed.regions,
  nodes,
  routes: seed.routes,
  migration: seed.migration
};
generated.contentHash = crypto.createHash('sha256')
  .update(JSON.stringify({ nodes, routes: seed.routes, migration: seed.migration }))
  .digest('hex');

const generatedDir = path.join(root, 'data', 'generated', 'kromka');
fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(path.join(generatedDir, 'world.json'), JSON.stringify(generated, null, 2) + '\n');
fs.writeFileSync(path.join(generatedDir, 'save-migration.json'), JSON.stringify({
  schema: 'kromka.saveMigration.v1',
  version: 1,
  fromWorldRevision: 'legacy',
  toWorldRevision: seed.worldRevision,
  safeDestinations: seed.migration
}, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'data', 'global-map.json'), JSON.stringify(globalMap, null, 2) + '\n');

console.log(`Kromka runtime world built: ${nodes.length} nodes, ${seed.routes.length} routes, ${Object.keys(cells).length} cells`);
