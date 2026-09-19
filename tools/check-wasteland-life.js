#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeSettlementLife,
  publicSettlementLife
} = require('../src/server/wasteland-settlements');
const {
  registerCargoDeparture,
  settleCargoArrival,
  settleCargoLoss
} = require('../src/server/wasteland-logistics');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'world-simulation.json'), 'utf8'));
assert.equal(config.schema, 'realm.kromka-world-simulation.v1');
assert.equal(config.settlementDefaults.maxDailyMigrationRate, 0.05);
assert.equal(config.economy.minimumPriceMultiplier, 0.85);
assert.equal(config.economy.crisisPriceMultiplier, 1.6);

function site(overrides = {}) {
  return {
    id: 'settlement',
    type: 'settlement',
    capital: true,
    security: 70,
    prosperity: 60,
    stockpile: { water: 100, food: 100, medicine: 20, scrap: 10 },
    ...overrides
  };
}

const initialized = site();
initialized.settlementLife = normalizeSettlementLife(initialized, config, 0);
assert(initialized.settlementLife.population >= initialized.settlementLife.protectedMinimum);
assert.equal(initialized.settlementLife.condition, 'stable', 'a new settlement starts stable');

// Запись из старого сохранения публикуется как есть: симуляция её не меняет.
const legacy = site({
  settlementLife: {
    version: 1, population: 140, condition: 'crisis', causeCode: 'low_water', reason: 'Нет воды.',
    forecast: 'вода: резерва на 0,4 суток', actions: ['доставить воду'], reserveDays: { water: 0.41 },
    consequences: [1, 2, 3, 4, 5].map(n => ({ worldHour: n, text: `запись ${n}` }))
  }
});
const publicLife = publicSettlementLife(legacy, config);
['stateLabel', 'reason', 'forecast', 'actions', 'reserveDays', 'consequences'].forEach(key => {
  assert(Object.prototype.hasOwnProperty.call(publicLife, key), `public settlement life is missing ${key}`);
});
assert.equal(publicLife.state, 'crisis');
assert.equal(publicLife.reserveDays.water, 0.4);
assert(publicLife.consequences.length <= 3);
assert.equal(publicSettlementLife(site(), config), null, 'a site without a life record publishes none');

const ledger = {};
const caravan = { id: 'test_caravan', kind: 'caravan', homeSiteId: 'a', destinationSiteId: 'b', createdHour: 4, cargo: { water: 12 } };
const departure = registerCargoDeparture(ledger, caravan, 'a', 'b', 4);
assert(departure.created && departure.transaction.status === 'in_transit');
const arrival = settleCargoArrival(ledger, caravan, 'b', caravan.cargo, 9);
assert(!arrival.duplicate && arrival.transaction.status === 'delivered');
assert(settleCargoArrival(ledger, caravan, 'b', caravan.cargo, 9).duplicate,
  'the same cargo transaction can be credited twice');

const lostCaravan = { id: 'lost_caravan', kind: 'caravan', homeSiteId: 'a', destinationSiteId: 'b', createdHour: 10, cargo: { food: 7 } };
registerCargoDeparture(ledger, lostCaravan, 'a', 'b', 10);
const loss = settleCargoLoss(ledger, lostCaravan, 'ambush', 12);
assert(!loss.duplicate && loss.transaction.status === 'lost' && loss.transaction.lostCargo.food === 7);
assert(settleCargoLoss(ledger, lostCaravan, 'ambush', 12).duplicate,
  'the same lost cargo transaction can be settled twice');

const unityPipboy = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaPipboyCanvas.cs'), 'utf8');
assert(unityPipboy.includes('site["settlementLife"] is JObject life')
  && unityPipboy.includes('Mathf.Min(3, consequences.Count)'),
  'Pipboy world page does not expose settlement causes and three consequences');

const coordinator = fs.readFileSync(path.join(ROOT, 'src', 'server', 'wasteland-sim.js'), 'utf8');
assert(coordinator.includes("const SCHEMA = 'realm.wastelandSim.v2'")
  && coordinator.includes('WORLD_SIM_MAX_CATCHUP_STEPS')
  && coordinator.includes('settleCargoLoss(')
  && coordinator.includes('publicSettlementLife(site, worldSimulationConfig)'),
  'wasteland coordinator is missing the v2 life/logistics integration');

console.log('Wasteland life OK: settlement records normalize and publish as stored, the cargo ledger is idempotent, and Unity shows the explanations.');
