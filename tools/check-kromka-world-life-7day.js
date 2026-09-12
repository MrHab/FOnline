#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { advanceSettlementHour, normalizeSettlementLife } = require('../src/server/wasteland-settlements');
const {
  advanceRefugeeFlows,
  createRefugeeFlow,
  normalizeRefugeeState,
  settlementSceneVariant
} = require('../src/server/wasteland-refugees');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'world-simulation.json'), 'utf8'));

function makeSite(id, x, y, crisis = false) {
  const site = {
    id,
    name: id,
    type: 'settlement',
    x,
    y,
    security: crisis ? 18 : 72,
    prosperity: crisis ? 36 : 68,
    stockpile: crisis
      ? { water: 0, food: 0, medicine: 0, scrap: 0 }
      : { water: 5000, food: 5000, medicine: 1000, scrap: 500 },
    capital: false
  };
  site.settlementLife = normalizeSettlementLife(site, CONFIG, 0);
  if (crisis) site.settlementLife.integrity = 18;
  return site;
}

function runSevenDays() {
  const sites = {
    crisis: makeSite('crisis', 0, 0, true),
    north: makeSite('north', 5, 0),
    east: makeSite('east', 0, 8),
    far: makeSite('far', 18, 12)
  };
  const refugeeFlows = normalizeRefugeeState({}, CONFIG);
  const initialPopulation = Object.values(sites)
    .reduce((sum, site) => sum + Number(site.settlementLife.population || 0), 0);
  let maximumActive = 0;
  let migrationWaves = 0;
  let arrivals = 0;

  for (let hour = 1; hour <= 168; hour += 1) {
    for (const site of Object.values(sites)) {
      const result = advanceSettlementHour(site, CONFIG, 1, hour);
      if (result.migrated > 0) {
        const created = createRefugeeFlow(refugeeFlows, site, result.migrated, sites, hour, CONFIG);
        assert(created.flow, 'migration removed population without an aggregate refugee record');
        migrationWaves += 1;
      }
      const scene = settlementSceneVariant(site, CONFIG, hour);
      assert(scene.actorBudget <= 8, 'local life materialization exceeded its NPC budget');
    }
    const movement = advanceRefugeeFlows(refugeeFlows, sites, 1, hour, { config: CONFIG, pointKm: 1 });
    arrivals += movement.arrivals.length;
    maximumActive = Math.max(maximumActive, movement.activeCount);
    assert(movement.activeCount <= CONFIG.refugees.maxActiveGroups,
      'refugee flow count exceeded the configured aggregate cap');
    const residentPopulation = Object.values(sites)
      .reduce((sum, site) => sum + Number(site.settlementLife.population || 0), 0);
    const travellingPopulation = Object.values(refugeeFlows.active)
      .reduce((sum, flow) => sum + Number(flow.members || 0), 0);
    assert.equal(residentPopulation + travellingPopulation, initialPopulation,
      `population was created or lost at hour ${hour}`);
  }

  return {
    sites: Object.fromEntries(Object.entries(sites).map(([id, site]) => [id, {
      population: site.settlementLife.population,
      condition: site.settlementLife.condition,
      migratedTotal: site.settlementLife.migratedTotal,
      tension: Number(site.settlementLife.tension.toFixed(4))
    }])),
    active: refugeeFlows.active,
    history: refugeeFlows.history,
    maximumActive,
    migrationWaves,
    arrivals
  };
}

const first = runSevenDays();
const second = runSevenDays();
assert.deepEqual(first, second, 'seven-day life simulation is not deterministic');
assert(first.migrationWaves >= 3, 'stress settlement did not produce daily migration waves');
assert(first.arrivals >= 2, 'aggregate refugee groups did not complete routes during the test week');
assert(first.maximumActive < 10, 'a four-settlement week produced an unreasonable number of active groups');

console.log(`Kromka 7-day life load passed: ${first.migrationWaves} migrations, ${first.arrivals} arrivals, max ${first.maximumActive} aggregate groups`);
