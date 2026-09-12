'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  deathLootPolicy,
  persistedDownedState,
  restoreDownedState,
  resolveDeathLootTransaction
} = require('../src/server/kromka-death-loot');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepStrictEqual(deathLootPolicy('peaceful'), { mode: 'peaceful', loss: 'none' });
assert.deepStrictEqual(deathLootPolicy('pvp'), { mode: 'pvp', loss: 'consumables', fraction: 0.5 });
assert.deepStrictEqual(deathLootPolicy('pvpFullDrop'), {
  mode: 'pvpFullDrop', loss: 'inventory', loadedMagazines: true
});

let mutations = 0;
const target = { id: 'socket-a', characterId: 'char-a', diedAt: 1700000000000 };
const first = resolveDeathLootTransaction(target, 'pvpFullDrop', target.diedAt, () => {
  mutations++;
  return [{ id: 'drop-1', itemId: 'pistol', itemRuntimeRecords: [{ loadedAmmo: 7 }] }];
});
const replay = resolveDeathLootTransaction(target, 'pvpFullDrop', target.diedAt, () => {
  mutations++;
  return [{ id: 'duplicate' }];
});
assert.strictEqual(mutations, 1, 'one death must mutate inventory exactly once');
assert.strictEqual(first.reused, false);
assert.strictEqual(replay.reused, true);
assert.deepStrictEqual(replay.result, first.result);

target.diedAt++;
const nextLife = resolveDeathLootTransaction(target, 'pvpFullDrop', target.diedAt, () => {
  mutations++;
  return [];
});
assert.strictEqual(nextLife.reused, false);
assert.strictEqual(mutations, 2, 'a later death must create a new transaction');

const persistedDowned = persistedDownedState({ downed: true, downedUntil: 1700000020000 });
assert.deepStrictEqual(persistedDowned, { downed: true, downedUntil: 1700000020000 });
assert.deepStrictEqual(restoreDownedState(persistedDowned), {
  dead: true, downed: true, downedUntil: 1700000020000
}, 'reconnect must not turn a downed participant into a live 1-HP player');
assert.deepStrictEqual(restoreDownedState({ downed: false, downedUntil: 999 }), {
  dead: false, downed: false, downedUntil: 0
});

const server = read('server.js');
assert(server.includes('const SERVER_PVP_PROTECTED_ITEM_IDS = new Set(['));
assert(server.includes("id !== 'silver'"));
assert(server.includes('itemRuntimeRecords: runtimeDrops.get(entry.id)?.records || []'));
assert(server.includes('resolveDeathLootTransaction(target, mode, now'));
assert(server.includes("policy.loss === 'inventory'"));
assert(server.includes("policy.loss === 'consumables'"));
assert(server.includes('serverTryDownWorldActivityPlayer(p, shiftRoom, now)'));
assert(server.includes('serverTryDownWorldActivityPlayer(p, anomalyRoom, playerTickNow)'));
assert(server.includes('WORLD_ACTIVITY_REVIVE_DISTANCE = 3.5'));
assert(server.includes('* 0.3'));
assert(server.includes('* 0.55'));
assert(server.includes('...persistedDownedState(player)'));
assert(server.includes('const savedDownedState = restoreDownedState(savedPlayer)'));
assert(server.includes('...savedDownedState'));
assert(server.includes('persistActivePlayerState(player);'));
assert(server.includes('persistActivePlayerState(target);'));

const hud = read('unity-client/Assets/Scripts/Game/RoaHudCanvas.cs');
assert(hud.includes('МИРНЫЙ · PvP ОТКЛЮЧЁН'));
assert(hud.includes('ПОЛНЫЙ ЛУТ · ПОТЕРЯ ИНВЕНТАРЯ'));
const map = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const canvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
assert(map.includes('roa.fullLootWarningAccepted.v1'));
assert(map.includes('ConfirmFullLootEntry'));
assert(map.includes('CancelFullLootEntry'));
assert(canvas.includes('ВОЙТИ И ПРИНЯТЬ РИСК'));
assert(canvas.includes('заряженные магазины'));

console.log('Kromka death/loot contract: OK (3 PvP modes, atomic death loot, downed/revive/respawn, first-entry warning).');
