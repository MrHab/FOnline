'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  affectedRegions,
  applyAnomalyShift,
  artifactOpportunity,
  normalizeLocations,
  publicAnomalyCycle
} = require('../src/server/wasteland-anomaly-cycle');
const { reconcileArtifactSpawns } = require('../src/server/artifact-spawns');

const root = path.resolve(__dirname, '..');
const locationCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/locations.json'), 'utf8'));
const artifactCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data/artifacts.json'), 'utf8'));
const simulationConfig = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/world-simulation.json'), 'utf8'));
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const simSource = fs.readFileSync(path.join(root, 'src/server/wasteland-sim.js'), 'utf8');
const pipboySource = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs'), 'utf8');

const locations = normalizeLocations(locationCatalog.locations);
assert(locations.length >= 8, 'The authored world needs several causal anomaly locations.');
assert(!locations.some(row => row.id === 'tutorialCaravanYard'), 'The tutorial yard must stay outside the world Shift lottery.');

const shift = {
  shiftId: 'shift_test_42',
  phase: 'active',
  strength: 2,
  phaseStartedAt: 1000,
  phaseEndsAt: 2000,
  nextShiftAt: 1000,
  serverNow: 1500
};
const selectedA = affectedRegions(shift, locationCatalog.locations, simulationConfig.anomalyCycle);
const selectedB = affectedRegions(shift, locationCatalog.locations, simulationConfig.anomalyCycle);
assert.deepEqual(selectedA, selectedB, 'The same Shift seed must select the same regions.');
assert.equal(selectedA.length, 2, 'Strength two must affect two configured regions.');

const sites = Object.fromEntries(locations.map((location, index) => [location.id, {
  id: location.id,
  locationId: location.id,
  owner: `owner_${index}`,
  population: 100 + index,
  settlementLife: { population: 100 + index, tension: 10, integrity: 70 }
}]));
const ownershipBefore = Object.fromEntries(Object.values(sites).map(site => [site.id, site.owner]));
const populationBefore = Object.fromEntries(Object.values(sites).map(site => [site.id, site.settlementLife.population]));
const first = applyAnomalyShift({}, shift, sites, {
  locations: locationCatalog.locations,
  config: simulationConfig.anomalyCycle,
  worldHour: 77
});
assert(first.applied, 'The active phase must apply its world consequence once.');
assert(first.impactedSites.length > 0, 'An active Shift needs at least one impacted public site.');
assert(first.state.hotspots.length > 0, 'An active Shift needs causal artifact hotspots.');
for (const impact of first.impactedSites) {
  const site = sites[impact.siteId];
  assert.equal(site.owner, ownershipBefore[site.id], 'A background Shift must not change ownership.');
  assert.equal(site.settlementLife.population, populationBefore[site.id], 'A background Shift must not remove protected population.');
  assert(site.settlementLife.integrity >= 40, 'A background Shift must respect the protected integrity floor.');
  assert.equal(site.lastShiftImpact.causeCode, 'shift_wave');
}

const sitesAfterFirst = JSON.stringify(sites);
const replay = applyAnomalyShift(first.state, { ...shift, serverNow: 1600 }, sites, {
  locations: locationCatalog.locations,
  config: simulationConfig.anomalyCycle,
  worldHour: 78
});
assert(!replay.applied, 'Restart/replay of the same Shift must be idempotent.');
assert.equal(JSON.stringify(sites), sitesAfterFirst, 'Replay must not stack world consequences.');

const publicCycle = publicAnomalyCycle(first.state);
assert.equal(publicCycle.causeCode, 'shift_wave');
assert(publicCycle.reason && publicCycle.forecast && publicCycle.actions.length >= 2,
  'The player must receive cause, forecast and useful actions.');
const hotspot = first.state.hotspots[0];
const opportunity = artifactOpportunity(first.state, hotspot.locationId, shift.shiftId);
assert(opportunity && opportunity.artifactCount > 0, 'The selected hotspot must expose an artifact opportunity.');

const authoredLocation = locationCatalog.locations.find(row => row.id === hotspot.locationId);
const allowedRoom = {};
const allowed = reconcileArtifactSpawns(
  allowedRoom,
  authoredLocation,
  shift,
  artifactCatalog,
  authoredLocation.anomalyFields,
  1500,
  { causalArtifactRequired: true, opportunity }
);
assert.equal(allowed.artifacts.length, opportunity.artifactCount,
  'Artifact count must come from the causal world opportunity.');
assert.equal(allowed.causeCode, 'shift_wave');

const blockedLocation = locationCatalog.locations.find(row => row.id !== hotspot.locationId && Array.isArray(row.anomalyFields) && row.anomalyFields.length);
const blocked = reconcileArtifactSpawns(
  {}, blockedLocation, shift, artifactCatalog, blockedLocation.anomalyFields, 1500,
  { causalArtifactRequired: true, opportunity: null }
);
assert.equal(blocked.artifacts.length, 0, 'An anomaly outside the selected Shift regions must not mint artifacts.');

for (const needle of [
  'anomalyLocations: KROMKA_LOCATION_CATALOG.locations || []',
  'WASTELAND_SIM.recordAnomalyShift(globalShift)',
  'causalArtifactRequired: true',
  'artifactOpportunityForLocation'
]) assert(serverSource.includes(needle), `Server causal integration is missing ${needle}.`);
for (const needle of ['anomalyCycle:', 'artifactOpportunities:', 'shiftImpact:', 'recordAnomalyShift']) {
  assert(simSource.includes(needle), `World simulation public contract is missing ${needle}.`);
}
for (const needle of ['ВЫБРОС · СИЛА', 'Артефактная возможность']) assert(pipboySource.includes(needle));

console.log('Wasteland anomaly cycle passed: deterministic regions, protected consequences, causal artifacts and Unity warnings.');
