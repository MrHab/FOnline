'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  deathLootPolicy,
  persistedDeathState,
  persistedDownedState,
  restoreDeathState,
  restoreDownedState,
  resolveDeathLootTransaction,
  selectBagDropRows,
  splitTrashRows,
  trashScrapQty
} = require('../src/server/kromka-death-loot');
const { sanitizeArtifactLoadout } = require('../src/server/artifact-effects');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));

assert.deepStrictEqual(deathLootPolicy('peaceful'), { mode: 'peaceful', loss: 'none' });
assert.deepStrictEqual(deathLootPolicy('pve'), { mode: 'pve', loss: 'none' });
assert.deepStrictEqual(deathLootPolicy('pvpEvent'), { mode: 'pvpEvent', loss: 'none' });
// Жёлтая зона ничего не роняет: износ надетого считает сервер.
assert.deepStrictEqual(deathLootPolicy('pvp'), { mode: 'pvp', loss: 'none' });
assert.deepStrictEqual(deathLootPolicy('pvpBlack'), { mode: 'pvpBlack', loss: 'all', loadedMagazines: true, trash: true });
assert.deepStrictEqual(deathLootPolicy('pvpFullDrop'), {
  mode: 'pvpFullDrop', loss: 'inventory', loadedMagazines: true, keepEquipment: true, keepInstalledArtifacts: true
});
assert.deepStrictEqual(deathLootPolicy('unknown'), { mode: 'peaceful', loss: 'none' });

// Частичная потеря: экипировка и установленные артефакты защищены по
// экземплярам, всё содержимое рюкзака (в том числе такой же артефакт в
// инвентаре, запасные контейнеры и детекторы) выпадает; валюта защищена по id.
const catalog = readJson('data/artifacts.json');
const target = {
  characterId: 'char-a',
  equipment: { artifactBelt: 'artifactBelt2', detector: 'artifactDetectorMk1' },
  inventory: [
    { id: 'artifactSpring', qty: 2 },
    { id: 'artifactVein', qty: 1 },
    { id: 'artifactBelt2', qty: 1 },
    { id: 'artifactDetectorMk1', qty: 1 },
    { id: 'medkit', qty: 3 },
    { id: 'silver', qty: 40 },
    { id: 'quest_relay_key', qty: 1 }
  ],
  artifactRecords: [
    { id: 'rec-spring-installed', itemId: 'artifactSpring', typeId: 'spring', hot: false, stabilized: true },
    { id: 'rec-spring-spare', itemId: 'artifactSpring', typeId: 'spring', hot: false, stabilized: true },
    { id: 'rec-vein-spare', itemId: 'artifactVein', typeId: 'vein', hot: false, stabilized: true }
  ],
  artifactSlots: ['rec-spring-installed']
};
sanitizeArtifactLoadout(target, catalog);
const installedCounts = new Map();
for (const recordId of target.artifactSlots) {
  const record = target.artifactRecords.find(row => row.id === recordId);
  installedCounts.set(record.itemId, (installedCounts.get(record.itemId) || 0) + 1);
}
const bag = selectBagDropRows(target.inventory, {
  installedCounts,
  isProtected: id => id === 'silver' || /(?:^|_)(?:quest|story|key)(?:_|$)/i.test(id)
});
assert.deepStrictEqual(bag.drops.map(row => [row.id, row.qty]), [
  ['artifactSpring', 1], ['artifactVein', 1], ['artifactBelt2', 1], ['artifactDetectorMk1', 1], ['medkit', 3]
], 'the spare artifact of the installed kind, spare container, detector and consumables drop');
assert.deepStrictEqual(bag.kept.map(row => [row.id, row.qty]), [
  ['artifactSpring', 1], ['silver', 40], ['quest_relay_key', 1]
], 'only the installed artifact instance, currency and story items stay');
assert.deepStrictEqual(selectBagDropRows([{ id: 'ammo9', qty: 0 }, { id: '', qty: 3 }]).drops, []);

// Надетый рюкзак — это экипировка: сам он остаётся на персонаже, а всё, что
// в нём лежит, выпадает. Быстрые слоты защиты не дают: они только ссылаются
// на предметы инвентаря.
{
  const carrier = {
    characterId: 'char-bag',
    equipment: { backpack: 'backpack', armor: 'leatherArmor' },
    inventory: [
      { id: 'medkit', qty: 2 },
      { id: 'ammo9', qty: 30 },
      { id: 'backpack', qty: 1 },
      { id: 'silver', qty: 15 }
    ],
    quickbar: ['medkit', 'ammo9'],
    artifactRecords: [],
    artifactSlots: []
  };
  const carried = selectBagDropRows(carrier.inventory, {
    installedCounts: new Map(),
    isProtected: id => id === 'silver'
  });
  assert.deepStrictEqual(carried.drops.map(row => row.id), ['medkit', 'ammo9', 'backpack'],
    'the contents of the bag and a spare bag drop, quick slots protect nothing');
  assert.deepStrictEqual(carried.kept.map(row => row.id), ['silver'], 'only currency stays in the bag');
  for (const id of carrier.quickbar) {
    assert(carried.drops.some(row => row.id === id), `quick slot ${id} does not protect the item`);
  }
  assert.equal(carrier.equipment.backpack, 'backpack', 'the worn bag itself stays on the character');
  assert.equal(carrier.equipment.armor, 'leatherArmor', 'worn armour stays too');
}

// Лом чёрной зоны: каждая единица бросается отдельно; уцелевшее падает, а
// уничтоженное превращается в лом по доле базовой цены.
{
  const rolls = [0.1, 0.9, 0.5, 0.2, 0.95];
  let cursor = 0;
  const random = () => rolls[cursor++ % rolls.length];
  const split = splitTrashRows([{ id: 'pistol', qty: 2 }, { id: 'ammo9', qty: 3 }, { id: 'ghost', qty: 0 }], 0.33, random);
  assert.deepStrictEqual(split.kept, [{ id: 'pistol', qty: 1 }, { id: 'ammo9', qty: 2 }]);
  assert.deepStrictEqual(split.trashed, [{ id: 'pistol', qty: 1 }, { id: 'ammo9', qty: 1 }]);
  assert.deepStrictEqual(splitTrashRows([{ id: 'medkit', qty: 4 }], 0).trashed, [], 'without a chance nothing is destroyed');
  assert.strictEqual(splitTrashRows([{ id: 'medkit', qty: 4 }], 1).kept.length, 0, 'a certain chance destroys everything');
  const prices = { pistol: 40, ammo9: 1 };
  assert.strictEqual(trashScrapQty(split.trashed, id => prices[id] || 0, 3, 0.25), 3,
    'a destroyed pistol leaves a quarter of its price in scrap, a cartridge almost nothing');
  assert.strictEqual(trashScrapQty([{ id: 'ammo9', qty: 5 }], id => prices[id] || 0, 3, 0.25), 0);
}

let mutations = 0;
const victim = { id: 'socket-a', characterId: 'char-a', diedAt: 1700000000000 };
const first = resolveDeathLootTransaction(victim, 'pvpFullDrop', victim.diedAt, () => {
  mutations++;
  return [{ id: 'drop-1', itemId: 'pistol', itemRuntimeRecords: [{ loadedAmmo: 7 }] }];
});
const replay = resolveDeathLootTransaction(victim, 'pvpFullDrop', victim.diedAt, () => {
  mutations++;
  return [{ id: 'duplicate' }];
});
assert.strictEqual(mutations, 1, 'one death must mutate inventory exactly once');
assert.strictEqual(first.reused, false);
assert.strictEqual(replay.reused, true);
assert.deepStrictEqual(replay.result, first.result);

// Reconnect после смерти: идентификатор транзакции восстанавливается из
// сохранения, повтор того же события не создаёт предметы.
const persistedDeath = persistedDeathState(victim);
assert.deepStrictEqual(persistedDeath, {
  diedAt: 1700000000000,
  deathLootTransactionId: 'char-a:1700000000000:pvpFullDrop'
});
const reconnected = { id: 'socket-b', characterId: 'char-a', ...restoreDeathState(persistedDeath, persistedDeath) };
const afterReconnect = resolveDeathLootTransaction(reconnected, 'pvpFullDrop', reconnected.diedAt, () => {
  mutations++;
  return [{ id: 'duplicate-after-reconnect' }];
});
assert.strictEqual(afterReconnect.reused, true, 'a restored transaction id must block a second drop');
assert.strictEqual(mutations, 1);
assert.deepStrictEqual(restoreDeathState({}, {}), { diedAt: 0, lastDeathLootTransaction: null });

victim.diedAt++;
const nextLife = resolveDeathLootTransaction(victim, 'pvpFullDrop', victim.diedAt, () => {
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
assert(!server.includes('...KROMKA_ARTIFACT_CATALOG.types.map(row => row.itemId),\n  ...KROMKA_ARTIFACT_CATALOG.detectors'),
  'artifacts must no longer be protected from the partial-loss drop by item id');
assert(server.includes('selectBagDropRows(inventory, {'));
assert(server.includes('installedCounts: options.all ? new Map() : serverInstalledArtifactCounts(target)'),
  'the black zone must drop installed artifacts too');
assert(server.includes("if (!SERVER_WEAPONS[entry.id]?.ammoType && !KROMKA_ARTIFACT_INDEXES.byItem[entry.id]) continue;"));
assert(server.includes('itemRuntimeRecords: records,'), 'dropped weapons must carry their runtime records');
assert(server.includes('resolveDeathLootTransaction(target, mode, now'));
assert(server.includes("policy.loss === 'inventory'"));
assert(!server.includes("policy.loss === 'consumables'") && !server.includes('consumableDrop:'),
  'the half-consumables drop is gone with the v3 zone ladder');
assert(server.includes("function locationDropsEverything(loc = {}) {\n  return deathLootPolicy(locationPvpMode(loc)).loss === 'all';"));
assert(server.includes('loc.fullDrop = zoneModeDropsInventory(loc.pvpMode);'), 'the black zone also reports a drop');
assert(server.includes("if (policy.loss === 'all') {"));
assert(server.includes('serverStripEquipmentForDeath(target, now);'), 'the black zone must strip the equipment before dropping it');
assert(server.includes('serverApplyDeathWear(target, mode);'), 'death must wear the worn equipment by zone');
assert(server.includes('const split = trashChance > 0 ? splitTrashRows(drops, trashChance)'), 'the black drop must roll scrap per unit');
assert(server.includes('(runtimeDrops.get(entry.id)?.records || []).slice(0, entry.qty)'), 'destroyed weapon instances must not reach the ground');
assert(server.includes('serverSyncRoomGroundDrops(room);\n    persistActivePlayerState(target);'));
assert(server.includes('serverRestoreRoomGroundDrops(rooms.get(id));'));
assert(server.includes('serverDropPvpLootForMode(shiftRoom, p, null, shiftLoc, now)'), 'emission death must use the zone loss policy');
assert(server.includes('serverDropPvpLootForMode(anomalyRoom, p, null, anomalyLoc, playerTickNow)'), 'anomaly death must use the zone loss policy');
assert(server.includes('serverDropPvpLootForMode(downedRoom, p, null, bleedLoc, playerTickNow)'), 'bleed-out must use the zone loss policy');
assert(server.includes('serverTryDownWorldActivityPlayer(p, shiftRoom, now)'));
assert(server.includes('serverTryDownWorldActivityPlayer(p, anomalyRoom, playerTickNow)'));
assert(server.includes('WORLD_ACTIVITY_REVIVE_DISTANCE = 3.5'));
assert(server.includes('* 0.3'));
assert(server.includes('* 0.55'));
assert(server.includes('...persistedDownedState(player)'));
assert(server.includes('diedAt: persistedDeathState(player).diedAt'));
assert(server.includes('next.deathLootTransactionId = persistedDeathState(player).deathLootTransactionId;'));
assert(server.includes('const savedDownedState = restoreDownedState(savedPlayer)'));
assert(server.includes('...savedDownedState'));
assert(server.includes('...restoreDeathState(savedState, savedPlayer)'));
assert(server.includes('persistActivePlayerState(player);'));
assert(server.includes('persistActivePlayerState(target);'));
assert(server.includes('zoneRules: zoneRules(currentPvpMode'));
assert(!/полн(ый|ого|ым) (лут|дроп)/i.test(server), 'the server must not describe the partial-loss mode as full loot');

const hud = read('unity-client/Assets/Scripts/Game/RoaHudCanvas.cs');
assert(hud.includes('МИРНЫЙ · PvP ОТКЛЮЧЁН'));
assert(hud.includes('ЭКИПИРОВКА ЦЕЛА'));
assert(hud.includes('ВЕЩИ СОХРАНЯЮТСЯ'));
assert(!hud.includes('ПОЛНЫЙ ЛУТ'));
const map = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const canvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
const recovery = read('unity-client/Assets/Scripts/Game/RoaRecoveryCanvas.cs');
assert(map.includes('ConfirmFullLootEntry'));
assert(map.includes('CancelFullLootEntry'));
assert(map.includes('zoneRules'));
assert(map.includes('инвентарь выпадает, экипировка сохраняется'));
assert(canvas.includes('ВОЙТИ И ПРИНЯТЬ РИСК'));
assert(canvas.includes('ПРАВИЛА ЗОНЫ'));
assert(recovery.includes('Экипировка сохранена'));
for (const [file, source] of [['RoaHudCanvas', hud], ['RoaGlobalMap', map], ['RoaGlobalMapCanvas', canvas], ['RoaRecoveryCanvas', recovery]]) {
  assert(!/полн(ый|ого|ым) (лут|дроп)|ПОЛНЫЙ ЛУТ/i.test(source), `${file} must not call the partial-loss mode full loot`);
}

// Правило потерь не зависит от причины смерти: собственный взрыв идёт через ту
// же воронку, что и чужая ракета, аномалия или выброс.
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(serverSource.includes('droppedItems = serverDropPvpLootForMode(room, target, isSelf ? null : p, loc, now);'),
  'A self-inflicted explosion must drop loot by the zone rule.');
assert(!serverSource.includes('if (!isSelf) droppedItems = serverDropPvpLootForMode'),
  'The old exception for self-inflicted deaths must be gone.');
assert(!serverSource.includes('fullDrop: !isSelf &&') && !serverSource.includes('totalDrop: !isSelf &&'),
  'Loss flags of an explosion death must not depend on who caused it.');

console.log('Kromka death/loot contract: OK (6 zone modes, black-zone scrap, partial-loss drop by instance, atomic and reconnect-safe death loot, persisted ground drops, zone rules before entry).');
