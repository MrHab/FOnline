#!/usr/bin/env node
'use strict';

// Экономика v3 (KRM-21): флаги worldModel выключают части прежней живой
// пустоши. Симуляция без настроек работает целиком (на этом держатся старые
// проверки), а с настройками сервера — без караванов, производства, потребления
// и беженцев. Сервер обязан передавать ей флаги из data/kromka/economy.json.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const { loadWorldEconomy, DEFAULT_WORLD_MODEL } = require('../src/server/world-economy');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-world-model-'));
const economy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));
const globalMap = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));

assert.equal(economy.worldModel.settlementLife, false, 'v3 turns settlement consumption, population and refugees off');
assert.equal(economy.worldModel.npcProduction, false, 'v3 turns settlement harvest and production off');
assert.equal(economy.worldModel.worldCaravans, false, 'v3 takes caravans off the map');
assert.deepEqual(Object.keys(economy.worldModel).sort(), Object.keys(DEFAULT_WORLD_MODEL).sort());

function simulation(name, worldModel) {
  return createWastelandSimulation({
    stateFile: path.join(tempRoot, `${name}.json`),
    getGlobalMap: () => globalMap,
    gameDayRealMs: 60 * 60 * 1000,
    ...(worldModel ? { worldModel } : {})
  });
}

const caravans = state => Object.values(state.parties || {}).filter(party => String(party?.kind || '') === 'caravan');
const goods = state => Object.values(state.sites || {}).reduce((sum, site) => {
  const pile = Object.entries(site?.stockpile || {})
    .filter(([id]) => id !== 'silver')
    .reduce((acc, [, qty]) => acc + Math.max(0, Number(qty || 0)), 0);
  const shelves = Object.values(site?.retailMarkets || site?.markets || {})
    .flatMap(market => Array.isArray(market?.stock) ? market.stock : [])
    .reduce((acc, row) => acc + Math.max(0, Number(row?.qty || 0)), 0);
  return sum + pile + shelves;
}, 0);

// --- прежняя пустошь без настроек: караваны на месте --------------------------------
{
  const legacy = simulation('legacy');
  assert(caravans(legacy.state()).length > 0, 'without settings the simulation keeps its caravans');
}

// --- экономика v3 -------------------------------------------------------------------
{
  const sim = simulation('v3', economy.worldModel);
  const state = sim.state();
  const before = goods(state);
  const seenTasks = new Set();
  const start = Date.now();
  for (let hour = 1; hour <= 48; hour += 1) {
    sim.tick(start + hour * 1000, { hours: 1, force: true });
    const current = sim.state();
    assert.equal(caravans(current).length, 0, `hour ${hour}: no caravan exists`);
    for (const task of current.worldTasks || []) seenTasks.add(String(task?.type || ''));
    assert.equal(Object.keys(current.refugeeFlows?.active || {}).length, 0, `hour ${hour}: no refugees move`);
  }
  for (const type of ['escort_caravan', 'deliver_supplies']) {
    assert(!seenTasks.has(type), `v3 creates no ${type} task`);
  }
  const after = goods(sim.state());
  assert(after <= before + 0.001, `settlements produce nothing: goods ${before.toFixed(2)} -> ${after.toFixed(2)}`);
}

// --- сервер передаёт флаги симуляции -------------------------------------------------
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(server.includes("const WORLD_ECONOMY = loadWorldEconomy(path.join(BUNDLED_DATA_DIR, 'kromka', 'economy.json'));"));
assert(server.includes('worldModel: WORLD_ECONOMY.worldModel'), 'the server must hand the world model to the simulation');

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('World model flags OK: without settings the old wasteland runs, with the v3 settings there are no caravans, no production, no consumption and no refugees.');
