#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  advanceRefugeeFlows,
  createRefugeeFlow,
  normalizeRefugeeState,
  publicRefugeeFlow,
  selectRefugeeDestination,
  settlementSceneVariant
} = require('../src/server/wasteland-refugees');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'world-simulation.json'), 'utf8'));
config.refugees.departureDelayHoursMin = 0;
config.refugees.departureDelayHoursMax = 0;
config.refugees.travelSpeedKmh = 12;

function settlement(id, x, y, options = {}) {
  return {
    id,
    name: options.name || id,
    type: 'settlement',
    x,
    y,
    security: options.security ?? 70,
    stockpile: { water: options.water ?? 100, food: 100, medicine: 20 },
    settlementLife: {
      population: options.population ?? 100,
      protectedMinimum: 50,
      condition: options.condition || 'stable',
      integrity: options.integrity ?? 75,
      tension: options.tension ?? 20,
      causeCode: options.causeCode || 'stable_supplies',
      reserveDays: { water: options.waterDays ?? 10, food: 10, medicine: 10 }
    }
  };
}

const origin = settlement('origin', 0, 0, {
  name: 'Исходное поселение', condition: 'crisis', waterDays: 0, causeCode: 'low_water'
});
const unsafe = settlement('unsafe', 2, 0, { security: 20, waterDays: 10 });
const dry = settlement('dry', 4, 0, { waterDays: 0.4 });
const safe = settlement('safe', 10, 0, { name: 'Безопасная гавань', waterDays: 5 });
const farther = settlement('farther', 20, 0, { waterDays: 8 });
const sites = { origin, unsafe, dry, safe, farther };

assert.equal(selectRefugeeDestination(origin, sites, config)?.id, 'safe',
  'refugees did not choose the nearest settlement with both water and security');

const refugeeState = normalizeRefugeeState({}, config);
const created = createRefugeeFlow(refugeeState, origin, 9, sites, 72, config);
assert(created.created && created.flow.destinationSiteId === 'safe');
assert.equal(Object.keys(refugeeState.active).length, 1,
  'one migration wave must create one aggregated group');
assert(created.flow.supplies.water > 0 && created.flow.supplies.food > 0,
  'refugee group does not carry any supplies');

const merged = createRefugeeFlow(refugeeState, origin, 4, sites, 73, config);
assert(!merged.created && merged.flow.id === created.flow.id && merged.flow.members === 13,
  'same-origin migrants within a day were not aggregated');

const beforePopulation = safe.settlementLife.population;
const moved = advanceRefugeeFlows(refugeeState, sites, 1, 73, { config, pointKm: 1 });
assert.equal(moved.arrivals.length, 1, 'refugee group did not arrive at its reachable destination');
assert.equal(safe.settlementLife.population, beforePopulation + 13,
  'arrival did not transfer population to the destination settlement');
advanceRefugeeFlows(refugeeState, sites, 2, 75, { config, pointKm: 1 });
assert.equal(safe.settlementLife.population, beforePopulation + 13,
  'the same refugee arrival was applied more than once');
assert.equal(Object.keys(refugeeState.active).length, 0);
assert.equal(refugeeState.history.length, 1);

const publicFlow = publicRefugeeFlow(created.flow, sites);
assert(publicFlow.aggregated && publicFlow.canEncounter === false && publicFlow.kind === 'refugees',
  'public refugee group is not explicitly aggregated and non-encounterable');

const crisisScene = settlementSceneVariant(settlement('scene', 0, 0, {
  condition: 'crisis', security: 18, integrity: 35
}), config, 100);
assert(crisisScene.queue && crisisScene.barricades && crisisScene.repairCrew,
  'crisis scene does not expose queues, barricades and repair crews');
assert(crisisScene.actorBudget > 0 && crisisScene.actorBudget <= 8,
  'settlement scene actor budget is not bounded');
const stableScene = settlementSceneVariant(settlement('stable', 0, 0), config, 100);
assert(!stableScene.queue && !stableScene.barricades && !stableScene.repairCrew
  && stableScene.actorBudget === 0, 'stable scene incorrectly materializes crisis dressing');

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const globalMap = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMap.cs'), 'utf8');
const bootstrap = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGameBootstrap.cs'), 'utf8');
const presentation = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaSettlementLifePresentation.cs'), 'utf8');
assert(server.includes('settlementSceneVariant(controllingSite')
  && server.includes('wastelandSceneVariant'),
  'local room does not materialize settlement scene actors');
assert(globalMap.includes('type == "refugees"')
  && globalMap.includes('row["canEncounter"]?.ToObject<bool>() == false'),
  'Unity global map does not present refugee groups safely');
assert(bootstrap.includes('SettlementLifePresentation?.ApplyWorldState')
  && presentation.includes('BuildRationQueue')
  && presentation.includes('BuildBarricades')
  && presentation.includes('BuildRepairSite'),
  'Unity local scene does not materialize the authoritative life variant');

console.log('Wasteland refugees OK: aggregate migration, safe destination, idempotent arrival, aid contract and bounded local variants');
