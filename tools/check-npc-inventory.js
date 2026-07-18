#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildFactionSupplyCatalog,
  chooseFactionEquipment,
  buildFactionPersonalInventory,
  prepareNpcWeapon,
  consumeNpcAmmo,
  buildPersonalTradeStock,
  transferCorpseLoot,
  rowQty
} = require('../src/server/npc-inventory');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');

const WEAPONS = {
  pistol: { id: 'pistol', dmg: [18, 26], range: 12, ammoType: 'ammo9', magSize: 8 },
  rifle: { id: 'rifle', dmg: [28, 40], range: 24, ammoType: 'ammo556', magSize: 5 },
  assaultRifle: { id: 'assaultRifle', dmg: [13, 19], range: 18, ammoType: 'ammo556', magSize: 30 },
  shotgun: { id: 'shotgun', dmg: [26, 40], range: 11, ammoType: 'shotgunShell', magSize: 6 },
  laserPistol: { id: 'laserPistol', dmg: [22, 32], range: 16, ammoType: 'energyCell', magSize: 12 },
  plasmaRifle: { id: 'plasmaRifle', dmg: [32, 48], range: 18, ammoType: 'energyCell', magSize: 14 },
  knife: { id: 'knife', dmg: [9, 15], range: 2.1, ammoType: null, magSize: 0 },
  axe: { id: 'axe', dmg: [11, 19], range: 2.1, ammoType: null, magSize: 0 },
  fists: { id: 'fists', dmg: [2, 4], range: 1.35, ammoType: null, magSize: 0 }
};
const ITEM_IDS = new Set([
  ...Object.keys(WEAPONS), 'ammo9', 'ammo556', 'shotgunShell', 'energyCell',
  'silver', 'water', 'food', 'stim', 'medkit', 'scrap', 'leather', 'boots', 'backpack'
]);

const factionState = {
  sites: {
    klimCapital: {
      id: 'klimCapital',
      owner: 'old_klim',
      prosperity: 70,
      security: 82,
      stockpile: { silver: 500, ammoParts: 12, scrap: 20, water: 15, food: 6 },
      production: { ammo9: 18, ammo556: 12 },
      traderProfiles: ['oldKlim']
    },
    relayCapital: {
      id: 'relayCapital',
      owner: 'relay_order',
      prosperity: 65,
      security: 78,
      stockpile: { silver: 420, electronics: 20, chemicals: 12, water: 8 },
      production: { energyCell: 16 },
      traderProfiles: ['relay']
    }
  },
  parties: {}
};
const traderProfiles = {
  oldKlim: { stock: [{ id: 'leather', qty: 3 }, { id: 'boots', qty: 4 }, { id: 'backpack', qty: 2 }] },
  relay: { stock: [{ id: 'energyCell', qty: 30 }, { id: 'backpack', qty: 2 }] }
};

const klimSupply = buildFactionSupplyCatalog(factionState, 'klim_patrol', traderProfiles);
const relaySupply = buildFactionSupplyCatalog(factionState, 'relay_order', traderProfiles);
assert(klimSupply.items.has('ammo556'), 'Old Klim must derive 5.56 ammo from faction production');
assert(klimSupply.items.has('assaultRifle'), 'Old Klim must be able to issue a rifle when it can make its ammo');
assert(!klimSupply.items.has('plasmaRifle'), 'Old Klim must not receive unsupported plasma weapons');
assert(relaySupply.items.has('energyCell') && relaySupply.items.has('plasmaRifle'), 'Relay Order must issue its supported energy weapons');

const klimEquipment = chooseFactionEquipment({
  faction: 'klim_patrol',
  role: 'guard',
  seed: 'klim-guard-1',
  catalog: klimSupply,
  requested: { weapon: 'plasmaRifle', armor: 'leather', boots: 'boots', backpack: 'backpack' },
  fallback: { weapon: 'assaultRifle' }
});
assert.notStrictEqual(klimEquipment.weapon, 'plasmaRifle', 'Unsupported requested equipment must be replaced');
assert(klimSupply.items.has(klimEquipment.weapon), 'Issued weapon must exist in faction supply');

const personal = buildFactionPersonalInventory({
  seed: 'klim-guard-1',
  faction: 'klim_patrol',
  role: 'guard',
  catalog: klimSupply,
  equipment: klimEquipment,
  weaponDefs: WEAPONS,
  itemIds: ITEM_IDS
});
const issuedWeapon = WEAPONS[klimEquipment.weapon];
assert(rowQty(personal, 'silver') > 0, 'Every humanoid NPC must receive personal money');
assert(issuedWeapon && issuedWeapon.ammoType, 'Test guard must receive a ranged faction weapon');
assert(rowQty(personal, issuedWeapon.ammoType) >= issuedWeapon.magSize * 3, 'Combat NPC must receive several magazines');
assert(personal.some(row => ['knife', 'axe'].includes(row.id)), 'Ranged NPC must receive an available melee backup');

const lastRoundActor = {
  equipment: { weapon: 'pistol' },
  inventory: [{ id: 'pistol', qty: 1 }, { id: 'ammo9', qty: 1 }, { id: 'knife', qty: 1 }]
};
const lastRound = consumeNpcAmmo(lastRoundActor, WEAPONS.pistol, WEAPONS, { distance: 4 });
assert.strictEqual(lastRound.consumed, 1, 'A ranged attack must consume one round');
assert.strictEqual(rowQty(lastRoundActor.inventory, 'ammo9'), 0, 'The last round must be removed from personal inventory');
assert.strictEqual(lastRoundActor.equipment.weapon, 'knife', 'NPC must switch to an available melee weapon after the last round');

const alternateGunActor = {
  equipment: { weapon: 'pistol' },
  inventory: [{ id: 'pistol', qty: 1 }, { id: 'rifle', qty: 1 }, { id: 'ammo556', qty: 3 }]
};
const prepared = prepareNpcWeapon(alternateGunActor, WEAPONS, { distance: 14 });
assert.strictEqual(prepared.weaponId, 'rifle', 'NPC must select another loaded weapon when the current gun is empty');

const looter = { equipment: { weapon: 'fists' }, inventory: [] };
const corpse = { loot: [{ id: 'ammo9', qty: 100 }, { id: 'pistol', qty: 1 }, { id: 'stim', qty: 2 }] };
const transfer = transferCorpseLoot(looter, corpse, {
  allowed: id => ITEM_IDS.has(id),
  stackLimit: id => id === 'ammo9' ? 200 : 10,
  itemWeight: id => ({ ammo9: 0.02, pistol: 2.5, stim: 0.2 }[id] || 0),
  capacity: 4,
  priority: id => ({ ammo9: 100, pistol: 90, stim: 80 }[id] || 0)
});
assert(transfer.taken.length > 0, 'NPC must take loot when carry capacity permits');
assert(rowQty(looter.inventory, 'ammo9') > 0, 'Taken ammunition must remain in NPC inventory');
assert(transfer.remaining.some(row => row.id === 'pistol'), 'Carry capacity must leave items that no longer fit on the corpse');

const armedFromLoot = { equipment: { weapon: 'fists' }, inventory: [{ id: 'pistol', qty: 1 }, { id: 'ammo9', qty: 4 }] };
assert.strictEqual(prepareNpcWeapon(armedFromLoot, WEAPONS, { distance: 8 }).weaponId, 'pistol', 'Looted weapon and ammo must be usable in later combat');

const personalTrader = {
  equipment: { weapon: 'rifle' },
  inventory: [
    { id: 'rifle', qty: 1 },
    { id: 'knife', qty: 1 },
    { id: 'ammo556', qty: 15 },
    { id: 'water', qty: 2 },
    { id: 'silver', qty: 24 }
  ]
};
const personalStock = buildPersonalTradeStock(personalTrader, {
  weaponDefs: WEAPONS,
  allowed: id => ITEM_IDS.has(id),
  priceFor: id => id === 'ammo556' ? 5 : 6,
  reserveMagazines: 1
});
assert.strictEqual(rowQty(personalStock, 'ammo556'), 10, 'Friendly NPC must keep one magazine and offer only excess ammunition');
assert.strictEqual(rowQty(personalStock, 'water'), 2, 'Friendly NPC personal goods must be available for barter');
assert(!personalStock.some(row => ['silver', 'rifle', 'knife'].includes(row.id)), 'Money, equipped gear and the combat backup must not be offered for sale');

const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'realm-of-ashes-npc-inventory-')), 'state.json');
const simulation = createWastelandSimulation({
  stateFile,
  getGlobalMap: () => ({ grid: { cols: 1, rows: 1, cellPoints: 1, cellKm: 10 }, nodes: [], cells: { '0:0': {} } }),
  gameDayRealMs: 60 * 60 * 1000
});
const simState = simulation.state();
simState.worldZones = [{
  id: 'npc_inventory_test_zone',
  status: 'active',
  roomId: 'randomAshGrove#npc_inventory_test_zone',
  details: {
    simBattle: true,
    actors: [{
      id: 'guard_1', side: 'defender', faction: 'old_klim', hp: 40, maxHp: 40,
      equipment: { weapon: 'rifle' }, inventory: [{ id: 'ammo556', qty: 5 }]
    }]
  }
}];
assert.strictEqual(simulation.syncBattleZoneActors({
  worldZoneId: 'npc_inventory_test_zone',
  actors: [{
    actorId: 'guard_1', hp: 40, maxHp: 40,
    equipment: { weapon: 'knife' }, inventory: [{ id: 'knife', qty: 1 }, { id: 'silver', qty: 17 }]
  }]
}), true, 'Real-time battle inventory snapshot must update the global battle actor');
const persistedActor = simulation.worldZoneById('npc_inventory_test_zone').details.actors[0];
assert.strictEqual(persistedActor.equipment.weapon, 'knife', 'Weapon switch must persist in the global battle zone');
assert.deepStrictEqual(persistedActor.inventory, [{ id: 'knife', qty: 1 }, { id: 'silver', qty: 17 }], 'Loot and spent ammunition must persist in the global battle zone');

simState.worldZones.push({
  id: 'npc_onsite_inventory_migration_zone',
  status: 'active',
  partyId: 'inventory_migration_party',
  roomId: 'world_inventory_migration#1',
  details: {
    onsiteParty: true,
    actors: [{
      id: 'legacy_guard', side: 'defender', faction: 'old_klim', role: 'guard', hp: 40, maxHp: 40,
      equipment: { weapon: 'rifle' }, inventory: [{ id: 'rifle', qty: 1 }], inventoryVersion: 0
    }]
  }
});
assert.strictEqual(simulation.syncOnsitePartyActors({
  worldZoneId: 'npc_onsite_inventory_migration_zone',
  actors: [{
    actorId: 'legacy_guard', hp: 40, maxHp: 40,
    equipment: { weapon: 'rifle' },
    inventory: [{ id: 'rifle', qty: 1 }, { id: 'ammo556', qty: 20 }, { id: 'silver', qty: 12 }],
    inventoryVersion: 2
  }]
}), true, 'Migrated local party inventory was not written back into the global onsite actor');
const migratedOnsiteActor = simulation.worldZoneById('npc_onsite_inventory_migration_zone').details.actors[0];
assert.strictEqual(migratedOnsiteActor.inventoryVersion, 2, 'Onsite actor inventory migration version was not persisted');
assert.strictEqual(rowQty(migratedOnsiteActor.inventory, 'silver'), 12, 'Onsite actor personal money was lost during migration');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const wastelandSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'wasteland-sim.js'), 'utf8');
const traderStateSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '07b_trader_market_state.js'), 'utf8');
const dialogueSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '07c_trader_dialogues_quests.js'), 'utf8');
const contextSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '08d_world_context_targets.js'), 'utf8');
const roomActorSnapshotSource = serverSource.match(/function worldZoneActorSnapshotsFromRoom\(room\) \{[\s\S]*?\n\}/)?.[0] || '';
assert(serverSource.includes('function ensureServerFriendlyNpcSocialState'), 'Server must centralize friendly NPC dialogue and trade initialization');
assert(serverSource.includes('ensureServerFriendlyNpcSocialState(enemy);'), 'Every spawned friendly NPC must receive social initialization');
assert(serverSource.includes('actor.personalTrade !== true'), 'Personal barter stock must be distinguished from faction-backed merchant stock');
assert(serverSource.includes('serverNpcPersonalInventory(npcProfile, role, faction, equipment, factionSupply)'),
  'Every newly spawned sapient NPC must receive faction-backed personal inventory');
assert(serverSource.includes('persistedInventoryVersion < NPC_INVENTORY_VERSION')
  && serverSource.includes('serverInventoryEnsureMinimumRows(enemyInventory, personalInventory)'),
  'Legacy global-party actors with incomplete inventory must receive missing mandatory faction items once');
assert(serverSource.includes('Number.isFinite(explicitCaps) && explicitCaps > 0'),
  'A non-trader caps value of zero must not erase mandatory personal money from sapient NPC inventory');
assert(serverSource.includes('inventoryVersion: Math.max(0, Math.floor(Number(enemy.inventoryVersion || 0)))')
  && wastelandSource.includes('inventoryVersion: Math.max(0, Math.floor(Number(input.inventoryVersion || 0)))'),
  'NPC inventory schema version must survive local/global actor snapshots without replenishing spent items');
assert(roomActorSnapshotSource.includes('inventoryVersion: Math.max(0, Math.floor(Number(enemy.inventoryVersion || 0)))'),
  'Room actor snapshots must carry the inventory schema version back into the autonomous simulation');
assert(serverSource.includes("typeof WASTELAND_SIM.syncOnsitePartyActors === 'function'")
  && wastelandSource.includes('function syncOnsitePartyActors(context = {})'),
  'Migrated physical party actors must write their complete inventory back to the global simulation');
assert(serverSource.includes('if (updateServerNpcCorpseLooting(room, enemy, dt, now)) continue;'),
  'Live NPC AI must attempt to loot defeated hostile actors');
assert((serverSource.match(/serverNpcConsumeCombatAmmo\(/g) || []).length >= 3,
  'Both NPC-vs-NPC and NPC-vs-player attacks must consume personal ammunition and trigger weapon fallback');
assert(serverSource.includes('inventory: naturalCreature ? stripServerCreatureInventoryRows(e.inventory || []) : sanitizeServerInventorySnapshot(e.inventory || [], { includeEquipped: true })'),
  'NPC inventory changes must be exposed in authoritative snapshots');
assert(traderStateSource.includes("return !!(actor && !actor.dead && !actor._removed && actor.hostileToPlayer === false);"), 'Client must recognize every friendly sapient NPC as a barter partner');
assert(dialogueSource.includes('function renderFriendlyNpcDialogue'), 'Client must provide a generic non-quest dialogue for friendly NPCs');
assert(dialogueSource.includes('return renderFriendlyNpcDialogue(trader);'), 'Unknown friendly profiles must not fall through to Old Klim quests');
assert(contextSource.includes("if (neutral) {\n        const options = ["), 'Friendly NPC context menu must always contain social actions');

console.log('NPC inventory checks passed.');
