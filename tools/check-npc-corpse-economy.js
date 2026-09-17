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
const {
  normalizeBlackMarketState,
  fundBlackMarket,
  takeBlackMarketLoot,
  blackMarketFatigueFactor
} = require('../src/server/black-market');

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

const PRICES = { knife: 8, pistol: 40, leather: 30, boots: 12, rifle: 80 };

function sandbox(worldEconomy, mode, options = {}) {
  const market = normalizeBlackMarketState({ treasury: 0, stock: options.stock || {} }, worldEconomy.blackMarket, 0);
  const context = vm.createContext({
    Map, Set, Number, String, JSON, Object, Array, Math, console, Date,
    WORLD_ECONOMY: worldEconomy,
    zoneLootMultiplier,
    rollQuantity,
    npcRemnantRows,
    fundBlackMarket,
    takeBlackMarketLoot,
    blackMarketFatigueFactor,
    serverBlackMarketStore: () => market,
    serverBlackMarketItemPrice: id => PRICES[id] || 0,
    serverMarkBlackMarketDirty: () => {},
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
  const roll = options.roll ?? 0.99;
  const room = { loc: { pvpMode: mode }, rng: () => roll };
  return { context, room, market };
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
  // из 1,5; марки 20 × 1,33 = 26,6 → 26 при неудачном броске, из них 5 уходят
  // в казну Чёрного рынка; бросок добычи рынка не удался.
  assert.deepEqual(byId(loot), { medkit: 2, ammo9: 6, silver: 21, scrap: 3 },
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
  const legacy = normalizeWorldEconomy({ ...economy, worldModel: { ...economy.worldModel, npcGearDrops: true, blackMarket: false } });
  const { context, room } = sandbox(legacy, 'pvpBlack');
  const loot = context.serverPrepareNpcCorpseLoot(raider(), room);
  assert.deepEqual(byId(loot), { pistol: 1, leather: 1, boots: 1, medkit: 2, ammo9: 6, silver: 52 });
}

// --- Чёрный рынок: доля марок в казну и снаряжение со склада ----------------------
{
  const { context, room, market } = sandbox(economy, 'pvp', {
    roll: 0.1,
    stock: { knife: [{ c: 60, t: 1 }], rifle: [{ c: 100, t: 2 }] }
  });
  const enemy = raider();
  const loot = context.serverPrepareNpcCorpseLoot(enemy, room);
  // Удачный бросок: пистолет даёт деталь и лом, куртка и ботинки по 2 лома;
  // марки 27 → 5 в казну; бюджет 15 × 1,33 ≈ 20 — со склада выпадает нож.
  assert.deepEqual(byId(loot), { medkit: 2, ammo9: 6, silver: 22, knife: 1, weaponParts: 1, scrap: 5 },
    'the corpse drops a player-made knife from the market stock: ' + JSON.stringify(plain(loot)));
  assert.equal(market.treasury, 5, 'a fifth of the marks funds the market');
  assert.equal(market.stock.knife, undefined, 'the dropped knife leaves the market stock');
  assert.equal(market.stock.rifle.length, 1, 'a weak NPC does not take an expensive rifle');
  assert.deepEqual(plain(enemy.blackMarketLoot), { itemId: 'knife', condition: 60 });
}
{
  const { context, room, market } = sandbox(economy, 'pvp', { roll: 0.1 });
  context.serverPrepareNpcCorpseLoot(raider(), room);
  assert(market.bands.cheap.multiplier > 1, 'an empty market raises the price of the requested band');
}

// --- состояние предмета рынка доходит до игрока ------------------------------------
{
  const restored = [];
  const conditions = {};
  const context = vm.createContext({
    Number, Array,
    SERVER_WEAPONS: { pistol: { ammoType: 'ammo9' }, knife: { ammoType: null } },
    serverRestoreWeaponRuntimeRecords: (player, records) => {
      restored.push(...records);
      return records;
    },
    serverSetPlayerItemCondition: (player, id, value) => {
      conditions[id] = value;
      return value;
    }
  });
  vm.runInContext(functionSource('serverApplyBlackMarketLootCondition'), context);
  const apply = context.serverApplyBlackMarketLootCondition;
  const player = {};
  const pistolCorpse = { blackMarketLoot: { itemId: 'pistol', condition: 42 } };
  assert.equal(apply(player, pistolCorpse, [{ id: 'medkit', qty: 1 }], 0), false, 'other loot leaves the record waiting');
  assert(pistolCorpse.blackMarketLoot, 'the record waits for the market item');
  assert.equal(apply(player, pistolCorpse, [{ id: 'pistol', qty: 1 }], 3), true);
  assert.deepEqual(plain(restored), [{ baseId: 'pistol', loaded: 0, condition: 42 }], 'a firearm keeps its sold condition');
  assert.equal(pistolCorpse.blackMarketLoot, null, 'the record is used once');
  assert.equal(apply(player, { blackMarketLoot: { itemId: 'knife', condition: 55 } }, [{ id: 'knife', qty: 1 }], 1), false,
    'a shared condition is not overwritten when the player already owns the item');
  assert.equal(conditions.knife, undefined);
  assert.equal(apply(player, { blackMarketLoot: { itemId: 'knife', condition: 55 } }, [{ id: 'knife', qty: 1 }], 0), true);
  assert.equal(conditions.knife, 55, 'a first knife arrives with its sold condition');
}

// --- серверная привязка ----------------------------------------------------------
for (const token of [
  'serverPrepareNpcCorpseLoot(enemy, room);',
  'serverPrepareNpcCorpseLoot(foe, room);',
  'serverPrepareNpcCorpseLoot(actor, room);',
  'serverApplyBlackMarketLootCondition(p, enemy, taken, blackMarketHeld);',
  'qty = Math.max(1, rollQuantity(qty * zoneGatherYield(WORLD_ECONOMY, locationPvpMode(roomLocation(room)))'
]) assert(source.includes(token), `server.js must keep: ${token}`);
assert(!/serverPrepareNpcCorpseLoot\((enemy|foe|actor)\);/.test(source), 'every corpse knows its room');

console.log('NPC corpse economy OK: NPC equipment turns into parts and scrap, marks and resource nodes scale with the zone, a fifth of the marks funds the black market, corpses drop player-made gear from its stock in its sold condition, and a corpse is converted once.');
