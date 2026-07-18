#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createWastelandSimulation,
  worldSiteLocationId,
  worldSiteLocationSeed,
  ensureUniqueWorldSiteLocalProfiles
} = require('../src/server/wasteland-sim');

const ROOT = path.resolve(__dirname, '..');
const stateFile = path.join(os.tmpdir(), `realm-world-location-check-${process.pid}-${Date.now()}.json`);
const globalMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/global-map.json'), 'utf8'));
const authoredLocationIds = new Set(fs.readdirSync(path.join(ROOT, 'data/locations'))
  .filter(name => name.endsWith('.json'))
  .map(name => path.basename(name, '.json')));

try {
  const sim = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  const sites = Object.values(sim.state().sites || {});
  const enterableSites = sites.filter(site => site.locationId);
  const locationIds = enterableSites.map(site => site.locationId);
  const districtSites = sites.filter(site => site.districtInterest);

  assert(districtSites.length >= 80, 'district locations were not generated');
  assert.strictEqual(new Set(locationIds).size, locationIds.length,
    'two global map sites still lead to the same local location id');
  assert(locationIds.every(id => String(id).length <= 32),
    'a world location id exceeds the authoritative server limit');
  assert(districtSites.every(site => site.locationId === worldSiteLocationId(site.id)),
    'a district site does not use its stable unique world location id');
  assert(districtSites.every(site => authoredLocationIds.has(site.templateLocationId)),
    'a world location instance references a missing authored template');
  assert.strictEqual(new Set(enterableSites.map(site => site.name)).size, enterableSites.length,
    'two global map locations still share the same display name');
  assert.strictEqual(new Set(enterableSites.map(site => site.description || site.note)).size, enterableSites.length,
    'two global map locations still share the same description');
  assert(enterableSites.every(site => Number(site.localProfileVersion || 0) > 0),
    'an enterable global site is missing its persistent local profile');
  assert(enterableSites.every(site => Number(site.localWidthTiles || 0) >= 20 && Number(site.localHeightTiles || 0) >= 20),
    'an enterable global site is missing a valid local size');
  const localSizeKeys = enterableSites.map(site => `${site.localWidthTiles}x${site.localHeightTiles}`);
  assert.strictEqual(new Set(localSizeKeys).size, localSizeKeys.length,
    'two global map locations still share the same local size profile');
  assert(districtSites.every(site => Number(site.identityVersion || 0) > 0 && site.landmark && site.sectorCode),
    'a district site is missing its unique landmark identity');

  const coordinateKeys = sites.map(site => `${Number(site.x).toFixed(2)}:${Number(site.y).toFixed(2)}`);
  assert.strictEqual(new Set(coordinateKeys).size, coordinateKeys.length,
    'two global map locations still occupy the same point');

  const sampleA = districtSites[0];
  const sampleB = districtSites[1];
  assert(sampleA && sampleB && sampleA.locationId !== sampleB.locationId);
  assert.notStrictEqual(worldSiteLocationSeed(2026, sampleA.id), worldSiteLocationSeed(2026, sampleB.id),
    'different world locations still receive the same procedural seed');
  assert.strictEqual(worldSiteLocationId('a'.repeat(80)).length, 32,
    'long site ids are not converted to bounded stable location ids');

  const expandedSites = JSON.parse(JSON.stringify(sim.state().sites));
  expandedSites.aaa_new_world_site = {
    id: 'aaa_new_world_site',
    name: 'Новая проверочная точка',
    locationId: worldSiteLocationId('aaa_new_world_site'),
    templateLocationId: 'randomRuinedRoad'
  };
  const profilesBeforeExpansion = new Map(enterableSites.map(site => [site.id, `${site.localWidthTiles}x${site.localHeightTiles}`]));
  ensureUniqueWorldSiteLocalProfiles(expandedSites);
  for (const [siteId, size] of profilesBeforeExpansion.entries()) {
    assert.strictEqual(`${expandedSites[siteId].localWidthTiles}x${expandedSites[siteId].localHeightTiles}`, size,
      `adding another global site changed the persistent local size of ${siteId}`);
  }

  sim.save(true);
  const reloaded = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  assert.deepStrictEqual(
    Object.values(reloaded.state().sites || {}).filter(site => site.districtInterest).map(site => site.locationId).sort(),
    districtSites.map(site => site.locationId).sort(),
    'world location ids changed after persistence reload'
  );
  assert.deepStrictEqual(
    Object.values(reloaded.state().sites || {}).filter(site => site.locationId)
      .map(site => `${site.id}:${site.localWidthTiles}x${site.localHeightTiles}:${site.localContentSeed}`).sort(),
    enterableSites.map(site => `${site.id}:${site.localWidthTiles}x${site.localHeightTiles}:${site.localContentSeed}`).sort(),
    'local size or content profiles changed after persistence reload'
  );

  console.log(`World location instance check passed: ${enterableSites.length} global sites use unique IDs, names, descriptions, sizes and content profiles.`);
} finally {
  try { fs.unlinkSync(stateFile); } catch (_) {}
}
