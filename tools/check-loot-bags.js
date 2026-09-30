#!/usr/bin/env node
'use strict';

// Мешок и рюкзак с добычей как модуль: из чего собирается контейнер, куда он
// ложится, сколько живёт, как уходят экземпляры оружия и что переживает
// сохранение. Настоящий бой и обыск — в check-city-critters-network.js, раскладка
// смерти игрока по зонам — в check-zone-ladder-runtime.js.

const assert = require('node:assert/strict');
const bags = require('../src/server/loot-bags');

const isItem = id => ['food', 'scrap', 'pistol', 'medkit'].includes(id);
const now = 1_000_000;

// Строки: без пустых, без кулаков и чужих id, по одной на предмет.
assert.deepEqual(bags.mergeLootRows([
  { id: 'food', qty: 1 }, { id: 'food', qty: 2 }, { id: 'fists', qty: 1 }, { id: 'ghost', qty: 3 }, { id: 'scrap', qty: 0 }
], isItem), [{ id: 'food', qty: 3 }]);
console.log('PASS loot rows merge by item and drop empties, fists and unknown ids');

// Контейнер: вид, имя, срок, записи экземпляров не больше количества.
const sack = bags.buildLootBag({
  id: 'bag_rat_1', kind: 'sack', ownerName: 'Крысюк', x: 1.23456, z: -2, tx: 40, tz: 38,
  rows: [{ id: 'food', qty: 1 }], now, source: { type: 'npc', id: 'rat_1', faction: 'neutral', killerId: 'p1' }, isItem
});
assert.equal(sack.lootBag, true);
assert.equal(sack.kind, 'sack');
assert.equal(sack.name, 'Мешок — Крысюк');
assert.equal(sack.x, 1.235);
assert.equal(sack.expiresAt - now, bags.LOOT_BAG_KINDS.sack.ttlMs);
assert.equal(bags.buildLootBag({ id: 'bag_empty', kind: 'sack', rows: [], now, isItem }), null, 'nothing to drop — no sack');
const backpack = bags.buildLootBag({
  id: 'bag_p', kind: 'backpack', ownerName: 'Вера', rows: [{ id: 'pistol', qty: 1 }, { id: 'medkit', qty: 2 }],
  records: { pistol: [{ id: 'ui_pistol_1', condition: 60 }, { id: 'extra' }] }, now, source: { type: 'player' }, isItem
});
assert.equal(backpack.name, 'Рюкзак — Вера');
assert(bags.LOOT_BAG_KINDS.backpack.ttlMs > bags.LOOT_BAG_KINDS.sack.ttlMs, 'a player backpack lies longer than an NPC sack');
assert.deepEqual(backpack.itemRuntimeRecords, { pistol: [{ id: 'ui_pistol_1', condition: 60 }] }, 'no more instances than items');
assert.equal(bags.buildLootBag({ id: 'bag_x', kind: 'chest', rows: [{ id: 'food', qty: 1 }], now, isItem }).kind, 'sack',
  'an unknown kind falls back to a sack');
console.log('PASS a sack for NPCs and a backpack for players carry their name, lifetime and instances');

// Точка: в шаге от тела, иначе другая сторона, иначе у самого тела.
const body = { x: 10, z: 5 };
const open = bags.lootBagPoint(body, 0, () => true);
assert(Math.abs(Math.hypot(open.x - body.x, open.z - body.z) - bags.LOOT_BAG_OFFSET_M) < 1e-9, 'the sack lies a step from the body');
const walled = bags.lootBagPoint(body, 0, x => x < body.x);
assert(walled.x < body.x, 'a wall on one side moves the sack to another');
assert.deepEqual(bags.lootBagPoint(body, 0.3, () => false), body, 'with no room around it the sack lies at the body');
console.log('PASS the container lies a step from the body, never inside a wall');

// Срок и пустота; экземпляры уходят вместе с взятым предметом.
assert.equal(bags.lootBagSpent(sack, now + 1000), false);
assert.equal(bags.lootBagSpent(sack, sack.expiresAt), true, 'an untouched sack goes after its lifetime');
assert.equal(bags.lootBagSpent({ ...sack, loot: [] }, now), true, 'an emptied sack goes at once');
const taken = bags.takeLootBagRecords(backpack, 'pistol', 1);
assert.deepEqual(taken, [{ id: 'ui_pistol_1', condition: 60 }]);
assert.deepEqual(backpack.itemRuntimeRecords, {}, 'a taken pistol leaves no instance behind');
assert.deepEqual(bags.takeLootBagRecords(backpack, 'medkit', 2), [], 'plain items have no instances');
console.log('PASS a container expires or empties, a taken weapon takes its instance along');

// Сохранение: своё переживает перезапуск, чужое и истёкшее — нет.
const saved = bags.persistedLootBag({ ...backpack, lockDifficulty: 5, itemRuntimeRecords: { pistol: [{ id: 'ui_pistol_2' }] } });
assert.equal(saved.lockDifficulty, undefined, 'room fields are not saved');
const restored = bags.restoreLootBag(saved, {
  now: now + 60_000, isItem, sanitizeRecord: (record, itemId) => (itemId === 'pistol' && record.id ? { ...record, ok: true } : null)
});
assert.equal(restored.name, 'Рюкзак — Вера');
assert.equal(restored.expiresAt, backpack.expiresAt, 'a restored backpack keeps its deadline');
assert.deepEqual(restored.itemRuntimeRecords, { pistol: [{ id: 'ui_pistol_2', ok: true }] }, 'instances pass the sanitiser');
assert.equal(bags.restoreLootBag(saved, { now: backpack.expiresAt + 1, isItem }), null, 'an expired backpack is not restored');
assert.equal(bags.restoreLootBag({ ...saved, loot: [{ id: 'ghost', qty: 1 }] }, { now, isItem }), null, 'unknown items are not restored');
console.log('PASS a saved backpack survives a restart with its deadline and instances');

console.log('Loot bags OK: merged rows, sack and backpack, a step from the body, lifetime and emptying, instances, persistence.');
