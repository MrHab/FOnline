#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  advanceSettlementHour,
  normalizeSettlementLife,
  publicSettlementLife,
  settlementReserveDays
} = require('../src/server/wasteland-settlements');
const { advancePopulation } = require('../src/server/wasteland-population');
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
assert(Object.values(settlementReserveDays(initialized.stockpile, initialized.settlementLife, config)).every(Number.isFinite));

const crisis = site({ stockpile: { water: 0, food: 0, medicine: 0 }, security: 18 });
for (let hour = 1; hour <= 80; hour += 1) advanceSettlementHour(crisis, config, 1, hour);
assert.equal(crisis.settlementLife.condition, 'crisis');
assert(crisis.settlementLife.population >= crisis.settlementLife.protectedMinimum,
  'a protected settlement fell below its population floor');
const maximumSingleDayMigration = Math.floor(180 * 0.05);
assert(crisis.settlementLife.migratedTotal <= maximumSingleDayMigration * 2,
  'migration exceeded five percent per eligible game day');

crisis.stockpile.water = 500;
crisis.stockpile.food = 500;
crisis.stockpile.medicine = 100;
crisis.security = 70;
crisis.settlementLife.integrity = 60;
advanceSettlementHour(crisis, config, 1, 81);
assert.equal(crisis.settlementLife.condition, 'recovering');
const publicLife = publicSettlementLife(crisis, config);
['stateLabel', 'reason', 'forecast', 'actions', 'reserveDays', 'consequences'].forEach(key => {
  assert(Object.prototype.hasOwnProperty.call(publicLife, key), `public settlement life is missing ${key}`);
});
assert(publicLife.consequences.length <= 3);

const population = advancePopulation({ population: 100, protectedMinimum: 50, crisisHours: 48 }, 'crisis', 24, 72, {
  maxDailyMigrationRate: 0.05,
  crisisMigrationDelayHours: 48
});
assert.equal(population.migrated, 5);

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

const unityMap = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMap.cs'), 'utf8');
const unityPipboy = fs.readFileSync(path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaPipboyCanvas.cs'), 'utf8');
['Состояние: ', 'Причина: ', 'Прогноз: ', 'Помощь: ', 'Резерв: ', 'Последствие: ']
  .forEach(text => assert(unityMap.includes(text), `global-map settlement card is missing ${text}`));
assert(unityPipboy.includes('site["settlementLife"] is JObject life')
  && unityPipboy.includes('Mathf.Min(3, consequences.Count)'),
  'Pipboy world page does not expose settlement causes and three consequences');

const coordinator = fs.readFileSync(path.join(ROOT, 'src', 'server', 'wasteland-sim.js'), 'utf8');
assert(coordinator.includes("const SCHEMA = 'realm.wastelandSim.v2'")
  && coordinator.includes('WORLD_SIM_MAX_CATCHUP_STEPS')
  && coordinator.includes('settleCargoLoss(')
  && coordinator.includes('publicSettlementLife(site, worldSimulationConfig)'),
  'wasteland coordinator is missing the v2 life/logistics integration');

console.log('Wasteland life OK: causal settlement states, protected migration, bounded catch-up, cargo idempotency and Unity explanations');
