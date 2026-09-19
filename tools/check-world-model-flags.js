#!/usr/bin/env node
'use strict';

// Экономика v3 (KRM-22): прежняя живая пустошь снята совсем. В симуляции нет
// караванов, производства и потребления поселений, беженцев и враждебных
// отрядов на карте — ни с настройками, ни без них, ни после загрузки старого
// сохранения, в котором они были.

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

assert.deepEqual(Object.keys(economy.worldModel).sort(), Object.keys(DEFAULT_WORLD_MODEL).sort());
for (const retired of ['settlementLife', 'npcProduction', 'worldCaravans', 'visibleWorldParties', 'hostileWorldParties']) {
  assert(!(retired in economy.worldModel), `${retired} is no longer a switch: the mechanic is gone`);
}

function simulation(name) {
  return createWastelandSimulation({
    stateFile: path.join(tempRoot, `${name}.json`),
    getGlobalMap: () => globalMap,
    gameDayRealMs: 60 * 60 * 1000
  });
}

const partiesOfKind = (state, kinds) => Object.values(state.parties || {})
  .filter(party => kinds.includes(String(party?.kind || '').toLowerCase()));
const goods = state => Object.values(state.sites || {}).reduce((sum, site) => {
  const pile = Object.entries(site?.stockpile || {})
    .filter(([id]) => id !== 'silver')
    .reduce((acc, [, qty]) => acc + Math.max(0, Number(qty || 0)), 0);
  const shelves = Object.values(site?.retailMarkets || site?.markets || {})
    .flatMap(market => Array.isArray(market?.stock) ? market.stock : [])
    .reduce((acc, row) => acc + Math.max(0, Number(row?.qty || 0)), 0);
  return sum + pile + shelves;
}, 0);

function assertQuietWorld(sim, label) {
  const before = goods(sim.state());
  const seenTasks = new Set();
  const start = Date.now();
  for (let hour = 1; hour <= 48; hour += 1) {
    sim.tick(start + hour * 1000, { hours: 1, force: true });
    const current = sim.state();
    assert.equal(partiesOfKind(current, ['caravan']).length, 0, `${label}, hour ${hour}: no caravan exists`);
    assert.equal(partiesOfKind(current, ['raider', 'monster']).length, 0,
      `${label}, hour ${hour}: raiders and monsters live in danger cells, not as wasteland parties`);
    assert.equal(Object.keys(current.refugeeFlows?.active || {}).length, 0, `${label}, hour ${hour}: no refugees move`);
    for (const task of current.worldTasks || []) seenTasks.add(String(task?.type || ''));
  }
  for (const type of ['escort_caravan', 'deliver_supplies']) {
    assert(!seenTasks.has(type), `${label}: no ${type} task appears`);
  }
  const after = goods(sim.state());
  assert(after <= before + 0.001, `${label}: settlements produce nothing: goods ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  assert.deepEqual(sim.publicState().parties, [], `${label}: NPC parties are not shown on the map`);
}

// --- новый мир ------------------------------------------------------------------------
assertQuietWorld(simulation('fresh'), 'fresh world');

// --- старое сохранение с караваном, налётчиками и беженцами ---------------------------
{
  const seed = simulation('legacy-seed');
  seed.tick(Date.now() + 1000, { hours: 1, force: true });
  const saved = JSON.parse(JSON.stringify(seed.state()));
  const home = Object.values(saved.sites).find(site => String(site?.type || '') === 'settlement');
  const base = { x: home.x, y: home.y, homeSiteId: home.id, faction: home.faction || 'neutral', members: 6, strength: 6, state: 'travel' };
  saved.parties.legacy_caravan = { ...base, id: 'legacy_caravan', kind: 'caravan', name: 'Старый караван', cargo: { water: 12 } };
  saved.parties.legacy_raiders = { ...base, id: 'legacy_raiders', kind: 'raider', name: 'Старые налётчики', faction: 'raiders' };
  saved.refugeeFlows = { active: { legacy_refugees: { id: 'legacy_refugees', members: 9, originSiteId: home.id, status: 'moving', x: home.x, y: home.y } } };
  const legacyFile = path.join(tempRoot, 'legacy.json');
  fs.writeFileSync(legacyFile, JSON.stringify(saved));
  const legacy = createWastelandSimulation({ stateFile: legacyFile, getGlobalMap: () => globalMap, gameDayRealMs: 60 * 60 * 1000 });
  assertQuietWorld(legacy, 'legacy save');
}

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log('World model OK: no caravans, production, consumption, refugees or hostile map parties — in a fresh world and after loading a legacy save.');
