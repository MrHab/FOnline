#!/usr/bin/env node
'use strict';

// Поведенческая проверка лестницы зон экономики v3 (библия 16.5): настоящая
// воронка смерти из server.js выполняется в песочнице. Видно, что жёлтая и
// синяя зоны только изнашивают надетое, красная роняет рюкзак и изнашивает
// сильнее, а чёрная снимает всё, роняет вместе с установленными артефактами и
// превращает часть выпавшего в лом.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  deathLootPolicy,
  resolveDeathLootTransaction,
  selectBagDropRows,
  splitTrashRows,
  trashScrapQty
} = require('../src/server/kromka-death-loot');
const { loadWorldEconomy, normalizeWorldEconomy, zoneDeathWear } = require('../src/server/world-economy');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const economy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

const SLOTS = ['weapon', 'offhand', 'armor', 'helmet', 'boots', 'backpack', 'detector', 'artifactBelt', 'vehicle'];
const PRICES = { pistol: 40, leather: 30, medkit: 22, scrap: 3, artifactSpring: 120, artifactBelt2: 60 };

function sandbox(trashChance) {
  const worldEconomy = normalizeWorldEconomy({
    zones: { ...economy.zones, blackDrop: { ...economy.zones.blackDrop, trashChance } }
  });
  const finalized = [];
  const fixedMath = Object.create(Math);
  fixedMath.random = () => 0.5;
  const context = vm.createContext({
    Map, Set, Number, String, JSON, Object, Array, console, Math: fixedMath,
    WORLD_ECONOMY: worldEconomy,
    zoneDeathWear,
    deathLootPolicy,
    resolveDeathLootTransaction,
    selectBagDropRows,
    splitTrashRows,
    trashScrapQty,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    locationPvpMode: loc => loc.pvpMode,
    serverBaseItemId: id => String(id || ''),
    sanitizeServerInventorySnapshot: rows => {
      const merged = new Map();
      for (const row of rows || []) {
        const qty = Math.floor(Number(row?.qty || 0));
        if (row?.id && qty > 0) merged.set(row.id, (merged.get(row.id) || 0) + qty);
      }
      return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
    },
    serverInstalledArtifactCounts: target => new Map(
      target.equipment?.artifactBelt ? (target.artifactSlots || []).map(() => ['artifactSpring', 1]) : []
    ),
    serverItemProtectedFromPvpDrop: id => id === 'silver',
    SERVER_WEAPONS: { pistol: { id: 'pistol', ammoType: 'ammo9' }, fists: { id: 'fists' } },
    KROMKA_ARTIFACT_INDEXES: { byItem: { artifactSpring: {} } },
    KROMKA_ARTIFACT_CATALOG: {},
    SERVER_ITEM_IDS: new Set(Object.keys(PRICES)),
    SERVER_ITEM_BASE_PRICES: PRICES,
    VALID_EQUIPMENT: Object.fromEntries(SLOTS.map(slot => [slot, new Set()])),
    sanitizeEquipment: (input = {}) => Object.fromEntries(SLOTS.map(slot => [
      slot, input[slot] || (slot === 'weapon' ? 'fists' : '')
    ])),
    serverEquipmentRuntimeFromRequest: () => Object.fromEntries(SLOTS.map(slot => [slot, ''])),
    serverActiveWeaponId: target => target.equipment?.weapon || 'fists',
    sanitizeArtifactLoadout: target => {
      if (!target.equipment?.artifactBelt) target.artifactSlots = [];
    },
    serverEnsureCombatState: target => target.serverCombat,
    serverEquippedWeaponRuntimeEntries: target => (
      target.equipment?.weapon && target.equipment.weapon !== 'fists'
        ? [{ slot: 'weapon', baseId: target.equipment.weapon, itemKey: target.equipmentRuntime?.weapon || '' }]
        : []
    ),
    serverPlayerItemCondition: (target, id) => (id === 'fists' ? null : Number(target.itemConditions?.[id] ?? 100)),
    serverWearPlayerItem: (target, id, amount) => {
      target.itemConditions[id] = Math.max(1, Number(target.itemConditions[id] ?? 100) - amount);
      return target.itemConditions[id];
    },
    serverValidateWeaponRuntimeRemoval: (target, entry) => {
      if (entry.id === 'artifactSpring') return { ok: true, baseId: entry.id, runtimeIds: ['rec-spring'] };
      if (entry.id !== 'pistol') return { ok: true, baseId: entry.id, runtimeIds: [] };
      const equipped = target.equipmentRuntime?.weapon || '';
      const keys = Object.keys(target.serverCombat.weapons).filter(key => key !== equipped);
      return { ok: true, baseId: 'pistol', runtimeIds: keys.slice(0, entry.qty) };
    },
    serverCaptureWeaponRuntimeRecords: (target, entry, validation) => validation.runtimeIds.map(key => ({
      id: key,
      baseId: entry.id,
      condition: target.serverCombat.weapons[key]?.condition ?? 100
    })),
    serverFinalizeWeaponRuntimeRemoval: (target, row, validation) => {
      finalized.push(...validation.runtimeIds);
      for (const key of validation.runtimeIds) delete target.serverCombat.weapons[key];
    },
    roomWorldExtent: () => 100,
    isRoomWalkableWorld: () => true,
    makeServerEntityId: prefix => `${prefix}-${Math.floor(Math.random() * 1e9)}-${finalized.length}`,
    publicGroundItem: item => ({ ...item }),
    refreshRoomWorldState: () => {},
    io: { to: () => ({ emit: () => {} }) },
    serverSyncRoomGroundDrops: () => {},
    persistActivePlayerState: () => {}
  });
  for (const name of [
    'serverDropPvpInventory', 'serverStripEquipmentForDeath', 'serverApplyDeathWear', 'serverDropPvpLootForMode'
  ]) vm.runInContext(functionSource(name), context);
  return { context, finalized };
}

function victim() {
  return {
    id: 'victim',
    characterId: 'char-victim',
    diedAt: 1700000000000,
    x: 0,
    z: 0,
    equipment: { weapon: 'pistol', armor: 'leather', artifactBelt: 'artifactBelt2' },
    equipmentRuntime: { weapon: 'ui_pistol_a_1' },
    equipmentRevision: 4,
    serverCombat: { weapons: { ui_pistol_a_1: { weaponId: 'pistol', condition: 90, loaded: 5 } } },
    itemConditions: { leather: 100 },
    inventory: [{ id: 'medkit', qty: 2 }, { id: 'silver', qty: 50 }, { id: 'artifactSpring', qty: 1 }],
    artifactSlots: ['rec-spring']
  };
}

function die(mode, trashChance = economy.zones.blackDrop.trashChance) {
  const { context, finalized } = sandbox(trashChance);
  const target = victim();
  const room = { id: 'room', locationId: 'loc', groundItems: new Map() };
  const drops = context.serverDropPvpLootForMode(room, target, null, { pvpMode: mode }, target.diedAt);
  const replay = context.serverDropPvpLootForMode(room, target, null, { pvpMode: mode }, target.diedAt);
  return { target, drops, replay, finalized, ground: [...room.groundItems.values()] };
}

const byItem = rows => Object.fromEntries(rows.map(row => [row.itemId, row.qty]));
// Значения из песочницы живут в другом realm: сравниваем их как обычные данные.
const plain = value => JSON.parse(JSON.stringify(value));

// --- мирная зона: ничего не выпадает и ничего не изнашивается ------------------------
{
  const world = die('peaceful');
  assert.deepEqual(plain(world.drops), []);
  assert.equal(world.target.itemConditions.leather, 100);
  assert.equal(world.target.serverCombat.weapons.ui_pistol_a_1.condition, 90);
}

// --- синяя и жёлтая: вещи целы, надетое изнашивается на 5% ---------------------------
for (const mode of ['pve', 'pvp']) {
  const world = die(mode);
  assert.deepEqual(plain(world.drops), [], `${mode}: nothing drops`);
  assert.equal(world.target.equipment.weapon, 'pistol', `${mode}: the weapon stays in the hand`);
  assert.equal(world.target.itemConditions.leather, 95, `${mode}: worn armour loses 5%`);
  assert.equal(world.target.serverCombat.weapons.ui_pistol_a_1.condition, 85, `${mode}: the weapon instance loses 5%`);
}

// --- красная: выпадает рюкзак, экипировка цела и теряет 20% -------------------------
{
  const world = die('pvpFullDrop');
  assert.deepEqual(byItem(world.ground), { medkit: 2 }, 'the red zone drops the bag, the installed artifact stays');
  assert.deepEqual(plain(world.target.inventory), [{ id: 'silver', qty: 50 }, { id: 'artifactSpring', qty: 1 }]);
  assert.equal(world.target.equipment.armor, 'leather', 'worn armour stays in the red zone');
  assert.equal(world.target.itemConditions.leather, 80, 'the red zone wears the equipment by 20%');
  assert.equal(world.target.serverCombat.weapons.ui_pistol_a_1.condition, 70);
  assert.deepEqual(plain(world.replay), plain(world.drops), 'a replayed death reuses the transaction');
  assert.equal(world.target.itemConditions.leather, 80, 'a replayed death does not wear twice');
}

// --- чёрная без лома: выпадает всё, экипировка снята, магазин и износ в записи -------
{
  const world = die('pvpBlack', 0);
  assert.deepEqual(byItem(world.ground), { medkit: 2, artifactSpring: 1, pistol: 1, leather: 1, artifactBelt2: 1 },
    'the black zone drops the bag, the equipment and the installed artifact');
  assert.deepEqual(plain(world.target.inventory), [{ id: 'silver', qty: 50 }], 'only the marks stay');
  assert.equal(world.target.equipment.weapon, 'fists');
  assert.equal(world.target.equipment.armor, '');
  assert.equal(world.target.equipment.artifactBelt, '');
  assert.deepEqual(plain(world.target.artifactSlots), [], 'without a belt nothing stays installed');
  assert.equal(world.target.equipmentRevision, 5, 'clients see the equipment change');
  assert.deepEqual(plain(world.finalized).sort(), ['rec-spring', 'ui_pistol_a_1'], 'dropped instances leave the victim');
  const pistol = world.ground.find(row => row.itemId === 'pistol');
  assert.equal(pistol.itemRuntimeRecords.length, 1, 'the dropped pistol keeps its instance');
  assert.equal(pistol.itemRuntimeRecords[0].condition, 60, 'a dropped weapon is battered by 20..40%');
  assert.equal(world.ground.some(row => row.itemId === 'scrap'), false, 'without a trash roll there is no scrap');
}

// --- чёрная с ломом: уничтоженное уходит, остаётся кучка лома ------------------------
{
  const world = die('pvpBlack', 1);
  const value = PRICES.pistol + PRICES.leather + PRICES.artifactBelt2 + PRICES.medkit * 2 + PRICES.artifactSpring;
  assert.deepEqual(byItem(world.ground), { scrap: Math.floor(value * economy.zones.blackDrop.trashValueShare / PRICES.scrap) },
    'everything destroyed turns into a quarter of its price in scrap');
  assert.deepEqual(plain(world.target.inventory), [{ id: 'silver', qty: 50 }]);
  assert(world.finalized.includes('ui_pistol_a_1'), 'a destroyed weapon instance is removed too');
  assert.deepEqual(plain(world.ground.find(row => row.itemId === 'scrap').itemRuntimeRecords), [], 'scrap carries no instance');
}

console.log('Zone ladder runtime OK: peaceful keeps everything, blue and yellow wear the equipment, red drops the bag and wears harder, black strips everything and turns part of it into scrap.');
