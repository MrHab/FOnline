#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const {
  LOCATION_RELEASE_SCHEMA,
  LOCATION_RELEASE_VERSION,
  RELEASED_LOCATION_IDS,
  isReleasedLocationId,
  publicLocationRelease
} = require('../src/server/location-release');

const root = path.join(__dirname, '..');
const locationsDir = path.join(root, 'data', 'locations');
const authoredFiles = fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort();
const globalMap = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const simSource = fs.readFileSync(path.join(root, 'src', 'server', 'wasteland-sim.js'), 'utf8');
const unityTerritoryProbeSource = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Editor', 'RoaGlobalMapTerritoryProbe.cs'), 'utf8');
const released = new Set(RELEASED_LOCATION_IDS);
const requiredCapitals = ['settlement', 'scrapTown', 'relayStation'];

function collectSiteReferences(value, output = new Set(), depth = 0) {
  if (!value || depth > 8) return output;
  if (Array.isArray(value)) {
    value.forEach(row => collectSiteReferences(row, output, depth + 1));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, row] of Object.entries(value)) {
    if (/siteId$/i.test(key) && typeof row === 'string' && row) output.add(row);
    if (row && typeof row === 'object') collectSiteReferences(row, output, depth + 1);
  }
  return output;
}

function assertReleasedReferences(label, rows) {
  for (const row of rows || []) {
    for (const siteId of collectSiteReferences(row)) {
      assert(released.has(siteId), `${label} exposes hidden site ${siteId}`);
    }
  }
}

assert.strictEqual(authoredFiles.length, 30, 'authored location catalog must stay intact');
assert(RELEASED_LOCATION_IDS.length >= 6 && RELEASED_LOCATION_IDS.length <= 8,
  'Unity release must contain 6-8 locations');
assert.strictEqual(released.size, RELEASED_LOCATION_IDS.length, 'released location IDs must be unique');
requiredCapitals.forEach(id => assert(released.has(id), `required faction capital is missing: ${id}`));

for (const id of RELEASED_LOCATION_IDS) {
  const file = path.join(locationsDir, `${id}.json`);
  assert(fs.existsSync(file), `released location definition is missing: ${id}`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(location.id, id, `released location file/id mismatch: ${id}`);
  assert(!location.randomTemplate && !location.encounterOnly,
    `released location must be a permanent authored destination: ${id}`);
  assert(isReleasedLocationId(id), `release predicate rejected ${id}`);
}

for (const node of globalMap.nodes || []) {
  assert(released.has(String(node.locationId || node.id || '')),
    `authored global-map node is not in the Unity release: ${node.id}`);
}
const expectedDynamicUnityMarkers = RELEASED_LOCATION_IDS.length - (globalMap.nodes || []).length;
assert(unityTerritoryProbeSource.includes(`_map.SiteMarkerCount == ${expectedDynamicUnityMarkers}`),
  'Unity territory probe still expects the hidden procedural site markers');

const release = publicLocationRelease();
assert.strictEqual(release.schema, LOCATION_RELEASE_SCHEMA);
assert.strictEqual(release.version, LOCATION_RELEASE_VERSION);
assert.deepStrictEqual(release.locationIds, RELEASED_LOCATION_IDS);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-location-release-'));
try {
  const sim = createWastelandSimulation({
    stateFile: path.join(tempRoot, 'wasteland-sim.json'),
    getGlobalMap: () => globalMap,
    publicSiteIds: RELEASED_LOCATION_IDS,
    locationRelease: release
  });
  const internal = sim.state();
  const snapshot = sim.publicState();
  const publicSiteIds = snapshot.sites.map(site => site.id);

  assert(Object.keys(internal.sites).length > RELEASED_LOCATION_IDS.length,
    'hidden sites must remain in the background simulation');
  assert.deepStrictEqual(new Set(publicSiteIds), released,
    'public wasteland snapshot must expose exactly the released sites');
  assert.deepStrictEqual(snapshot.locationRelease, release, 'public snapshot release metadata drifted');
  assert(snapshot.worldActivities.length > 0, 'released world must keep at least one playable activity');

  assertReleasedReferences('world task', snapshot.worldTasks);
  assertReleasedReferences('world activity', snapshot.worldActivities);
  assertReleasedReferences('world event', snapshot.events);
  assertReleasedReferences('public party', snapshot.parties);

  for (const zone of snapshot.threatZones || []) {
    if (zone.sourceType === 'site') assert(released.has(zone.sourceId), `threat zone exposes hidden site ${zone.sourceId}`);
  }
  for (const task of snapshot.worldActivities) {
    if (!task.siteId) continue;
    const site = internal.sites[task.siteId];
    assert(site, `activity target site is missing: ${task.siteId}`);
    assert.strictEqual(task.details?.locationId, site.locationId,
      `activity ${task.id} points to the wrong location instance`);
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

assert(!simSource.includes('worldSiteLocationId(site)'),
  'site activity generator must not stringify a site object as a location ID');
assert(serverSource.includes('!WASTELAND_SIM.isWorldTaskInPublicRelease(task)'),
  'direct acceptance of a hidden task is not guarded');
assert(serverSource.includes('!isReleasedLocationId(site.id || \'\') || !isReleasedLocationId(locationId)'),
  'global-map destination resolver is not guarded by the release list');
assert(serverSource.includes('&& isReleasedLocationId(requestedLocationId)'),
  'direct global-map arrival by hidden location ID is not guarded');

console.log(`Location release check passed: ${RELEASED_LOCATION_IDS.length} visible, ${authoredFiles.length - RELEASED_LOCATION_IDS.length} preserved.`);
