'use strict';

const fs = require('fs');
const path = require('path');
const { migrateSavedStateToKromka } = require('../src/server/kromka-save-migration');

const root = path.resolve(__dirname, '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const catalog = read('data', 'kromka', 'locations.json');
const seed = read('data', 'kromka', 'world-layout.seed.json');
const map = read('data', 'global-map.json');
const generated = read('data', 'generated', 'kromka', 'world.json');
const migration = read('data', 'generated', 'kromka', 'save-migration.json');
const plan = read('data', 'map-plan', 'plan.json');

assert(map.worldRevision === 'kromka-1' && generated.worldRevision === 'kromka-1',
  'runtime world must use revision kromka-1');
assert(map.grid.cols === 38 && map.grid.rows === 30 && map.grid.cellPoints === 10,
  'Kromka must use the new 380×300 layout, not the legacy 900×900 grid');
// Западного океана прежнего мира у карты нет: столица на западном краю — суша.
{
  const { infrastructurePointIsWater } = require('../src/server/global-infrastructure');
  const westernmost = map.nodes.reduce((a, b) => (Number(a.x) <= Number(b.x) ? a : b));
  assert(!infrastructurePointIsWater(map, { x: 1, y: westernmost.y })
    && !infrastructurePointIsWater(map, { x: westernmost.x, y: westernmost.y }),
  'the western edge of Kromka must be passable land, not the retired ocean mask');
}
assert(map.nodes.length === seed.locations.length && map.nodes.length === 44,
  'all physical Kromka locations must be present on the strategic map');
assert(map.infrastructure.length === seed.routes.length && map.infrastructure.length >= 5,
  'Tesma/Cascade/road/rail infrastructure is incomplete');
assert(Object.keys(map.cells).length === map.grid.cols * map.grid.rows,
  'every Kromka world cell must have an authored regional profile');
assert(!Object.values(map.cells).some(cell => ['water', 'ocean', 'snow'].includes(cell.texture)),
  'legacy ocean or snow geography leaked into Kromka');
assert(new Set(map.nodes.map(node => `${node.x}:${node.y}`)).size === map.nodes.length,
  'Kromka global-map node coordinates must be unique');
assert(seed.regions.length === 8 && new Set(seed.regions.map(row => row.id)).size === 8,
  'exactly eight macroregions are required');
assert(plan.worldRevision === 'kromka-1' && plan.spatialSource === 'unity'
  && plan.forbiddenLegacyMotifs.includes('west-ocean'),
  'data/map-plan was not replaced by the Kromka Unity-first plan');

const catalogById = new Map(catalog.locations.map(row => [row.id, row]));
const seedById = new Map(seed.locations.map(row => [row.id, row]));
const generatedById = new Map(generated.nodes.map(row => [row.id, row]));
for (const node of map.nodes) {
  const location = catalogById.get(node.id);
  const authoredPoint = seedById.get(node.id);
  const generatedNode = generatedById.get(node.id);
  assert(location, `world node ${node.id} has no Kromka location definition`);
  assert(authoredPoint, `world node ${node.id} has no Unity layout point`);
  assert(node.locationId === node.id, `${node.id} entry location id drifted`);
  assert(node.x === authoredPoint.x && node.y === authoredPoint.z,
    `${node.id} server entry point (${node.x}, ${node.y}) drifted from the Unity layout `
    + `(${authoredPoint.x}, ${authoredPoint.z})`);
  assert(generatedNode && generatedNode.x === node.x && generatedNode.y === node.y,
    `${node.id} generated world point drifted from data/global-map.json`);
  assert(node.macroRegion === location.macroRegion, `${node.id} macroregion drifted`);
  assert(node.visualProfile === location.visualProfile, `${node.id} visual profile drifted`);
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function routeDistance(node, route) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < route.points.length; i += 1) {
    best = Math.min(best, segmentDistance(node, route.points[i - 1], route.points[i]));
  }
  return best;
}

const routeMembership = new Map(map.infrastructure.map(route => [route.id, new Set()]));
for (const node of map.nodes) {
  for (const route of map.infrastructure) {
    if (routeDistance(node, route) <= 32) routeMembership.get(route.id).add(node.id);
  }
}
const graph = new Map(map.nodes.map(node => [node.id, new Set()]));
for (const members of routeMembership.values()) {
  for (const a of members) for (const b of members) if (a !== b) graph.get(a).add(b);
}
const visited = new Set(['settlement']);
const queue = ['settlement'];
while (queue.length) {
  const next = queue.shift();
  for (const neighbor of graph.get(next) || []) {
    if (visited.has(neighbor)) continue;
    visited.add(neighbor);
    queue.push(neighbor);
  }
}
for (const capital of ['sluiceCity', 'scrapTown', 'relayStation', 'caravanCamp', 'secondHaven', 'balanceBunker']) {
  assert(visited.has(capital), `faction capital ${capital} is disconnected from the travel network`);
}

const sceneCatalog = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Scripts',
  'Kromka', 'KromkaLocationSceneCatalog.cs'), 'utf8');
const serverRuntime = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
for (const location of catalog.locations) {
  assert(sceneCatalog.includes(`"${location.id}"`),
    `Unity scene catalog has no ${location.id}`);
}
assert(serverRuntime.includes("const preserveAuthoredNodePoints = String(src.worldRevision || '') === 'kromka-1'"),
  'server normalization must preserve Kromka entry points');
const builder = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Editor',
  'KromkaWorldSceneBuilder.cs'), 'utf8');
for (const token of ['MigrationArrival_SAFE', 'KromkaPlacedObjectAuthoring',
  'EditorSceneManager.SaveScene']) {
  assert(builder.includes(token), `Unity world builder is missing ${token}`);
}

for (const row of migration.safeDestinations) {
  const location = catalogById.get(row.targetLocationId);
  assert(location, `migration target ${row.targetLocationId} does not exist`);
  assert(location.locationType !== 'clan_base' && location.locationType !== 'raid_complex',
    `migration target ${row.targetLocationId} is unsafe`);
  assert(row.spawnId === location.migrationSpawnId,
    `migration spawn ${row.spawnId} does not match ${row.targetLocationId}`);
}

const legacyState = {
  currentLocationId: 'retired_location',
  globalMap: { playerX: 720, playerY: 120, route: [{ x: 1, y: 1 }], travelling: true },
  player: { inventory: [{ id: 'silver', qty: 77 }], reputation: { old_klim: 12 } }
};
const migrated = migrateSavedStateToKromka(legacyState, migration, map);
assert(migrated.migrated && legacyState.worldRevision === 'kromka-1',
  'legacy save did not migrate to kromka-1');
assert(legacyState.currentLocationId === 'scrapTown'
  && legacyState.migrationSpawnId === 'razdolye-gate',
  'legacy north-east coordinates did not reach the safe Razdolye arrival');
assert(legacyState.player.inventory[0].qty === 77 && legacyState.player.reputation.old_klim === 12,
  'world migration must not lose inventory or reputation');
assert(legacyState.globalMap.travelling === false && legacyState.globalMap.route.length === 0,
  'unsafe legacy travel state survived migration');

console.log(`Kromka world revision OK: ${map.nodes.length} nodes, ${map.infrastructure.length} routes, ${Object.keys(map.cells).length} cells`);
