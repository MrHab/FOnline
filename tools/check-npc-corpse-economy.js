#!/usr/bin/env node
'use strict';

// Экономика v3, этап 2 (библия 14.5): снаряжение делают только игроки, поэтому
// с трупа NPC оно не падает — остаются детали и лом. Марки NPC умножаются на
// богатство зоны, узлы в опасной зоне дают больше. Настоящие функции server.js
// выполняются в песочнице.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  loadWorldEconomy,
  normalizeWorldEconomy,
  zoneLootMultiplier,
  zoneGatherYield,
  rollQuantity,
  npcRemnantRows
} = require('../src/server/world-economy');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const economy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));
const plain = value => JSON.parse(JSON.stringify(value));

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

assert.equal(economy.worldModel.npcGearDrops, false, 'v3 stage 2: NPC equipment does not drop');
assert.deepEqual(plain(economy.zones.gatherYield), { peaceful: 1, pve: 1, pvp: 1.25, pvpFullDrop: 1.6, pvpBlack: 2, pvpEvent: 1 });
assert.equal(zoneGatherYield(economy, 'pvpBlack'), 2);
assert.equal(zoneLootMultiplier(economy, 'pvpBlack'), 2.6);

// Дробные количества: целая часть гарантирована, дробная — шансом.
assert.equal(rollQuantity(2.4, () => 0.3), 3);
assert.equal(rollQuantity(2.4, () => 0.5), 2);
assert.equal(rollQuantity(0, () => 0), 0);

// Таблица останков: доля 0,5 от деталей и лома на единицу снаряжения.
{
  const rolls = [0.1, 0.9];
  let cursor = 0;
  const rows = npcRemnantRows(economy, [
    { id: 'pistol', qty: 1, kind: 'firearm' },
    { id: 'leather', qty: 1, kind: 'armor' },
    { id: 'knife', qty: 1, kind: 'melee' },
    { id: 'mystery', qty: 3, kind: 'unknown' }
  ], () => rolls[cursor++ % rolls.length]);
  assert.deepEqual(plain(rows), [{ id: 'weaponParts', qty: 1 }, { id: 'scrap', qty: 3 }]);
}

function sandbox(worldEconomy, mode) {
  const context = vm.createContext({
    Map, Set, Number, String, JSON, Object, Array, Math, console,
    WORLD_ECONOMY: worldEconomy,
    zoneLootMultiplier,
    rollQuantity,
    npcRemnantRows,
    serverBaseItemId: id => String(id || ''),
    SERVER_WEAPONS: {
      pistol: { id: 'pistol', ammoType: 'ammo9' },
      knife: { id: 'knife', ammoType: null },
      fists: { id: 'fists', ammoType: null }
    },
    KROMKA_ITEM_INDEXES: { byId: { leather: { slot: 'armor' }, boots: { slot: 'boots' }, medkit: { slot: 'weapon' } } },
    SERVER_ITEM_IDS: new Set(['pistol', 'knife', 'leather', 'boots', 'medkit', 'silver', 'ammo9', 'weaponParts', 'scrap']),
    roomLocation: room => room.loc,
    locationPvpMode: loc => loc.pvpMode,
    serverNpcIsNaturalCreature: () => false,
    sanitizeServerInventorySnapshot: rows => {
      const merged = new Map();
      for (const row of rows || []) {
        const qty = Math.floor(Number(row?.qty || 0));
        if (row?.id && qty > 0) merged.set(row.id, (merged.get(row.id) || 0) + qty);
      }
      return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
    }
  });
  for (const name of ['serverNpcGearKind', 'serverApplyNpcCorpseEconomy', 'serverPrepareNpcCorpseLoot']) {
    vm.runInContext(functionSource(name), context);
  }
  const room = { loc: { pvpMode: mode }, rng: () => 0.99 };
  return { context, room };
}

function raider() {
  return {
    id: 'raider',
    dead: true,
    inventory: [
      { id: 'pistol', qty: 1 }, { id: 'leather', qty: 1 }, { id: 'boots', qty: 1 },
      { id: 'medkit', qty: 2 }, { id: 'ammo9', qty: 6 }, { id: 'silver', qty: 20 }
    ]
  };
}

const byId = rows => Object.fromEntries(plain(rows).map(row => [row.id, row.qty]));

// --- жёлтая зона: снаряжение стало останками, остальное на месте ---------------
{
  const { context, room } = sandbox(economy, 'pvp');
  const enemy = raider();
  const loot = context.serverPrepareNpcCorpseLoot(enemy, room);
  // Пистолет: половина детали не выпала, лом 1; куртка и ботинки: по 1 лому
  // из 1,5; марки 20 × 1,33 = 26,6 → 26 при неудачном броске дробной части.
  assert.deepEqual(byId(loot), { medkit: 2, ammo9: 6, silver: 26, scrap: 3 },
    'gear becomes remnants and marks grow with the zone: ' + JSON.stringify(plain(loot)));
  assert.deepEqual(byId(enemy.inventory), byId(loot), 'the corpse inventory and loot agree');
  const again = context.serverPrepareNpcCorpseLoot(enemy, room);
  assert.deepEqual(byId(again), byId(loot), 'a second call does not convert or multiply again');
}

// --- живой NPC: ничего не превращается ------------------------------------------
{
  const { context, room } = sandbox(economy, 'pvpBlack');
  const enemy = { ...raider(), dead: false };
  const loot = context.serverPrepareNpcCorpseLoot(enemy, room);
  assert.equal(byId(loot).pistol, 1, 'a living NPC keeps its weapon');
  assert.equal(byId(loot).silver, 20);
}

// --- прежнее правило под флагом: снаряжение падает, марки всё равно по зоне ------
{
  const legacy = normalizeWorldEconomy({ ...economy, worldModel: { ...economy.worldModel, npcGearDrops: true } });
  const { context, room } = sandbox(legacy, 'pvpBlack');
  const loot = context.serverPrepareNpcCorpseLoot(raider(), room);
  assert.deepEqual(byId(loot), { pistol: 1, leather: 1, boots: 1, medkit: 2, ammo9: 6, silver: 52 });
}

// --- серверная привязка ----------------------------------------------------------
for (const token of [
  'serverPrepareNpcCorpseLoot(enemy, room);',
  'serverPrepareNpcCorpseLoot(foe, room);',
  'serverPrepareNpcCorpseLoot(actor, room);',
  'qty = Math.max(1, rollQuantity(qty * zoneGatherYield(WORLD_ECONOMY, locationPvpMode(roomLocation(room))), rng));'
]) assert(source.includes(token), `server.js must keep: ${token}`);
assert(!/serverPrepareNpcCorpseLoot\((enemy|foe|actor)\);/.test(source), 'every corpse knows its room');

console.log('NPC corpse economy OK: NPC equipment turns into parts and scrap, marks and resource nodes scale with the zone, and a corpse is converted once.');
