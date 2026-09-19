'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const vm = require('vm');
const { usesAuthoredWorldSites, authoredNodeForSite, archiveUnplacedWorldSites } = require('../src/server/authored-world-sites');
const { districtInterestSites } = require('../src/server/wasteland-district-sites');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const root = path.resolve(__dirname, '..');
const map = JSON.parse(fs.readFileSync(path.join(root, 'data/global-map.json'), 'utf8'));
const locations = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/locations.json'), 'utf8'));
assert.equal(map.sitePlacement, 'unity-authored');
assert(usesAuthoredWorldSites({ worldRevision: 'kromka-1' }), 'Old Kromka files must not revive generation');
assert(usesAuthoredWorldSites({ worldRevision: 'kromka-1', sitePlacement: 'procedural' }));
assert(map.nodes.length >= 39, 'Existing lore nodes must be preserved');
assert.equal(new Set(map.nodes.map(node => node.id)).size, map.nodes.length);
// Exercise the actual server normalizer, not just direct simulation inputs.
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const normalizerSource = serverSource.slice(serverSource.indexOf('function normalizeGlobalMapConfig('),
  serverSource.indexOf('function normalizeLocationDefinition('));
const normalizeMap = vm.runInNewContext(`(${normalizerSource.trim()})`, {
  clamp: (n, min, max) => Math.max(min, Math.min(max, n)), GLOBAL_MAP_GRID_DEFAULT: map.grid,
  safeLocationFileId: value => value,
  normalizeGlobalInfrastructure: require('../src/server/global-infrastructure').normalizeGlobalInfrastructure
});
const normalized = normalizeMap({ worldRevision: 'kromka-1', grid: map.grid,
  nodes: [{ id: 'settlement', x: 0, y: 15.125 }] });
assert.equal(normalized.sitePlacement, 'unity-authored');
assert.equal(normalized.nodes[0].x, 0);
assert.equal(normalized.nodes[0].y, 15.125, 'Server loading must preserve fractional Unity positions');
for (const node of map.nodes) {
  const lore = locations.locations.find(row => row.id === node.locationId);
  assert(lore, `${node.id}: no lore location`);
  assert(fs.existsSync(path.join(root, 'unity-client', lore.unityScene)), `${node.id}: missing authored Unity scene`);
}
const noScan = { worldRevision: 'kromka-1', get grid() { throw Error('Procedural grid scan attempted'); } };
for (const hour of [0, 72, 10000]) assert.deepStrictEqual(districtInterestSites(noScan, hour), {});

const retired = { id: 'district_interest_1_1', districtInterest: true, locationId: 'world_district_interest_1_1',
  x: 1, y: 2, stockpile: { silver: 71 }, activeConflict: { status: 'active', progress: 0.5 } };
const retained = { id: 'settlement', locationId: 'settlement', stockpile: { silver: 99 } };
const migration = { sites: { settlement: retained, [retired.id]: retired },
  parties: { legacy: { id: 'legacy', destinationSiteId: retired.id, cargo: { ore: 4 } }, keep: { homeSiteId: 'settlement' } },
  worldTasks: [{ id: 'task', details: { targetSiteId: retired.id }, progress: 0.6 },
    { id: 'party-task', partyId: 'legacy', progress: 0.2 }, { id: 'zone-task', worldZoneId: 'zone' }],
  worldZones: [{ id: 'zone', siteId: retired.id }], cargoLedger: {},
  worldTaskHistory: [{ id: 'completed', siteId: retired.id }] };
const original = JSON.parse(JSON.stringify(migration));
assert(archiveUnplacedWorldSites(migration, map));
assert.deepStrictEqual(migration.retiredWorldSites.sites[retired.id], original.sites[retired.id]);
assert.deepStrictEqual(migration.retiredWorldSites.parties.legacy, original.parties.legacy);
assert.deepStrictEqual(migration.retiredWorldSites.worldTasks, original.worldTasks);
assert.deepStrictEqual(migration.worldTaskHistory, original.worldTaskHistory);
assert.deepStrictEqual(migration.sites.settlement, original.sites.settlement);
assert(!archiveUnplacedWorldSites(migration, map), 'Retirement must be idempotent');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roa-authored-sites-'));
try {
  const stateFile = path.join(temp, 'simulation.json');
  const start = performance.now();
  const sim = createWastelandSimulation({ stateFile, getGlobalMap: () => map });
  for (const site of Object.values(sim.state().sites)) {
    const node = authoredNodeForSite(map, site);
    assert(node, `${site.id}: has no Unity placement`);
    assert(!site.districtInterest);
    assert.equal(site.x, node.x, `${site.id}: authored X moved`);
    assert.equal(site.y, node.y, `${site.id}: authored Y moved`);
    assert.equal(site.name, locations.locations.find(row => row.id === node.locationId).displayName,
      `${site.id}: runtime name differs from lore`);
  }
  const before = Object.values(sim.state().sites).map(site => [site.id, site.locationId, site.x, site.y]);
  sim.tick(Date.now(), { hours: 73, force: true });
  assert.deepStrictEqual(Object.values(sim.state().sites).map(site => [site.id, site.locationId, site.x, site.y]), before,
    'A 72-hour cycle must not move, rename IDs or create sites');
  assert.throws(() => sim.upsertSite({ id: 'runtime_random', x: 10, y: 10 }), /authored in Unity/);
  const settlement = map.nodes.find(node => node.id === 'settlement');
  const savedPoint = { x: settlement.x, y: settlement.y };
  settlement.x = 0; settlement.y = 15.125;
  sim.syncGlobalMap(map);
  assert.equal(sim.state().sites.settlement.x, 0);
  assert.equal(sim.state().sites.settlement.y, 15.125);
  Object.assign(settlement, savedPoint);
  sim.syncGlobalMap(map);
  sim.save(true);
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  persisted.sites[retired.id] = original.sites[retired.id];
  fs.writeFileSync(stateFile, JSON.stringify(persisted));
  const reloaded = createWastelandSimulation({ stateFile, getGlobalMap: () => map });
  assert(!reloaded.state().sites[retired.id]);
  assert.deepStrictEqual(reloaded.state().retiredWorldSites.sites[retired.id], original.sites[retired.id]);
  reloaded.save(true);
  const second = createWastelandSimulation({ stateFile, getGlobalMap: () => map });
  assert.deepStrictEqual(second.state().retiredWorldSites, reloaded.state().retiredWorldSites);
  console.log(`Authored world sites PASS: ${map.nodes.length} lore nodes, ${before.length} simulation sites; no grid generation, exact coordinates, archive/reload and 73-hour cycle (${Math.round(performance.now() - start)} ms).`);
} finally {
  // The exact directory is created above for this isolated test only.
  fs.rmSync(temp, { recursive: true, force: true });
}
