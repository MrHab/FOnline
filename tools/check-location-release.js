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
const requiredCapitals = ['settlement', 'sluiceCity', 'scrapTown', 'relayStation', 'caravanCamp', 'secondHaven'];
const requiredStoryDestinations = ['balanceBunker', 'cascadeRegenerator'];

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

assert(authoredFiles.length >= 30, 'authored location catalog lost released or migration locations');
assert(authoredFiles.includes('tutorialCaravanYard.json'),
  'private story locations must coexist with the public release catalog');
assert.strictEqual(released.size, RELEASED_LOCATION_IDS.length, 'released location IDs must be unique');
requiredCapitals.forEach(id => assert(released.has(id), `required faction capital is missing: ${id}`));
requiredStoryDestinations.forEach(id => assert(released.has(id), `required campaign destination is missing: ${id}`));

for (const id of RELEASED_LOCATION_IDS) {
  const file = path.join(locationsDir, `${id}.json`);
  assert(fs.existsSync(file), `released location definition is missing: ${id}`);
  const location = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(location.id, id, `released location file/id mismatch: ${id}`);
  assert(!location.randomTemplate && !location.encounterOnly,
    `released location must be a permanent authored destination: ${id}`);
  assert(isReleasedLocationId(id), `release predicate rejected ${id}`);
}

const globalNodeIds = (globalMap.nodes || []).map(node => String(node.locationId || node.id || ''));
assert.strictEqual(new Set(globalNodeIds).size, globalNodeIds.length,
  'active global-map destination IDs must be unique');
assert.deepStrictEqual(RELEASED_LOCATION_IDS, globalNodeIds,
  'every visible global-map location, and only a visible location, must be released');
assert(unityTerritoryProbeSource.includes('_map.SiteMarkerCount == 2'),
  'Unity territory probe lost coverage for the currently streamed public site markers');

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

  assert(authoredFiles.length > RELEASED_LOCATION_IDS.length,
    'private and instanced locations must remain outside the global-map release');
  assert(publicSiteIds.every(id => released.has(id)),
    'public wasteland snapshot exposed a site outside the release allowlist');
  requiredCapitals.forEach(id => assert(publicSiteIds.includes(id),
    `public wasteland snapshot lost required capital ${id}`));
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

console.log(`Location release check passed: ${RELEASED_LOCATION_IDS.length} visible, ${authoredFiles.length - RELEASED_LOCATION_IDS.length} preserved.`);
