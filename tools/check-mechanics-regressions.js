'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../data/artifacts.json');
const bases = require('../src/server/personal-bases');
const jobs = require('../src/server/base-jobs');
const effects = require('../src/server/artifact-effects');
const spawns = require('../src/server/artifact-spawns');
const siege = require('../src/server/siege-resolution');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

const baseCatalog = { jobs: [{ id: 'test', stationTypeId: 'bench', input: { scrap: 1 }, output: { filter: 1 }, durationMs: 10 }], objects: [{ id: 'bench' }] };
let base = bases.createPersonalBase('account', 1);
base.objects = [{ id: 'bench1', typeId: 'bench' }];
for (let i = 0; i < 30; i++) {
  const started = jobs.startBaseJob(base, 'test', baseCatalog, () => 100, 100 + i * 20);
  assert(started.ok);
  base = bases.sanitizePersonalBase(JSON.parse(JSON.stringify(base)), 'account', baseCatalog, 110 + i * 20);
  assert(jobs.claimBaseJob(base, started.record.id, baseCatalog, 110 + i * 20).ok);
  assert(!jobs.claimBaseJob(base, started.record.id, baseCatalog, 110 + i * 20).ok);
}
const activeIds = Array.from({ length: 4 }, () => jobs.startBaseJob(base, 'test', baseCatalog, () => 100, 999).record.id);
assert.equal(new Set(activeIds).size, 4);
assert(!jobs.startBaseJob(base, 'test', baseCatalog, () => 100, 999).ok);
base = bases.sanitizePersonalBase(base, 'account', baseCatalog, 2000);
assert.deepEqual(base.jobs.filter(row => !row.claimed).map(row => row.id), activeIds);

const record = { id: 'found:1', typeId: 'spring', itemId: 'artifactSpring', stabilized: true };
const player = { inventory: [{ id: record.itemId, qty: 1 }], equipment: { artifactBelt: 'artifactBelt2' }, artifactRecords: [record], artifactSlots: [record.id] };
assert.equal(effects.calculateArtifactEffects(player, catalog).speedPct, 0.08);
player.inventory = [];
assert.equal(effects.calculateArtifactEffects(player, catalog).speedPct, 0, 'Unowned records cannot grant phantom bonuses');
effects.sanitizeArtifactLoadout(player, catalog);
assert.deepEqual(player.artifactSlots, []);
player.inventory = [{ id: record.itemId, qty: 2 }];
effects.sanitizeArtifactLoadout(player, catalog);
assert.equal(player.artifactRecords.length, 2, 'Legacy orphan items can be stabilized again');
assert(player.artifactRecords.every(row => !row.stabilized));
const recoveredIds = player.artifactRecords.map(row => row.id);
effects.sanitizeArtifactLoadout(player, catalog);
assert.deepEqual(player.artifactRecords.map(row => row.id), recoveredIds);

const shift = { phase: 'active', shiftId: 'regression_shift', strength: 1 };
const location = { id: 'regression_field', macroRegion: 'glasslands', anomalyFields: [{ id: 'a', x: 0, z: 0, radius: 2 }] };
const opportunity = { locationId: location.id, shiftId: shift.shiftId, artifactCount: 1 };
const room = { locationId: location.id };
spawns.reconcileArtifactSpawns(room, location, shift, catalog, location.anomalyFields, 1000, { causalArtifactRequired: true, opportunity });
const artifact = room.kromkaArtifactState.artifacts[0];
const savesDb = { claimedArtifactIds: [artifact.id], characters: { account: { character: { state: { artifactRecords: [record] } } } } };
const claimed = effects.claimedArtifactIdsFromSaves(JSON.parse(JSON.stringify(savesDb)));
assert(claimed.has(record.id) && claimed.has(artifact.id));
const context = vm.createContext({
  KROMKA_CLAIMED_ARTIFACT_IDS: claimed, KROMKA_SHIFT_CYCLE: { state: () => shift },
  WASTELAND_SIM: { artifactOpportunityForLocation: () => opportunity },
  kromkaLocationLore: () => location, KROMKA_ARTIFACT_CATALOG: catalog,
  ANOMALY_SYSTEM: { snapshot: () => ({ fields: location.anomalyFields }) }, reconcileArtifactSpawns: spawns.reconcileArtifactSpawns,
  mergeBirthArtifacts: spawns.mergeBirthArtifacts, liveArtifactBirths: () => [], serverArtifactBirthStore: () => ({ version: 1, locations: {} })
});
vm.runInContext(functionSource('serverEnsureRoomArtifacts'), context);
const restarted = { locationId: location.id };
context.serverEnsureRoomArtifacts(restarted, 1200);
assert(restarted.kromkaArtifactState.artifacts[0].pickedUp, 'Restart must suppress already claimed spawns even without a player record');

const store = { clans: { atk: { id: 'atk', baseId: '', storage: {} }, defA: { id: 'defA', baseId: 'A' }, defB: { id: 'defB', baseId: 'B' } }, bases: { A: { ownerClanId: 'defA' }, B: { ownerClanId: 'defB' } } };
for (const baseId of ['A', 'B']) {
  const event = siege.createSiegeEvent({ id: baseId, baseId, defenderClanId: 'def' + baseId });
  Object.assign(event, { status: 'resolved', winnerClanId: 'atk', result: 'attacker_core_held' });
  assert(siege.applyResolutionOnce(event, store, { reward: { winnerSilver: 10 } }, 1000).ok);
  assert(siege.applyResolutionOnce(event, store, {}, 1001).duplicate);
}
assert.equal(store.clans.atk.baseId, 'A');
assert.equal(store.bases.B.ownerClanId, 'defB');
assert.equal(store.clans.atk.storage.silver, 10);
assert(!siege.applyObjective({ status: 'active', eliminated: { gone: {} } }, { characterId: 'gone', action: 'captureCore' }).ok);

// Exercise the actual shared transfer functions used by ground, base/clan/
// faction storage and both kinds of NPC market; stub only unrelated gun code.
const transfers = vm.createContext({
  KROMKA_ARTIFACT_INDEXES: effects.artifactIndexes(catalog), KROMKA_ARTIFACT_CATALOG: catalog,
  sanitizeArtifactRecords: effects.sanitizeArtifactRecords, sanitizeArtifactLoadout: effects.sanitizeArtifactLoadout,
  serverBaseItemId: id => id, serverEnsureCombatState: p => p.serverCombat ||= { weapons: {} }, savesDb: {}
});
for (const name of ['serverValidateWeaponRuntimeRemoval', 'serverCaptureWeaponRuntimeRecords', 'serverFinalizeWeaponRuntimeRemoval',
  'sanitizeServerWeaponRuntimeRecord', 'serverRestoreWeaponRuntimeRecords', 'sanitizeServerWeaponRuntimeStore',
  'serverTakeWeaponRuntimeStoreRecords', 'serverCommitArtifactMarketTransfer']) vm.runInContext(functionSource(name), transfers);
const donor = { characterId: 'a', equipment: { artifactBelt: 'artifactBelt2' }, inventory: [{ id: record.itemId, qty: 2 }],
  artifactSlots: [record.id], artifactRecords: [record, { ...record, id: 'hot', hot: true, stabilized: false, containerId: 'container:1' }] };
const row = { id: record.itemId, qty: 1 };
const validation = transfers.serverValidateWeaponRuntimeRemoval(donor, row);
assert.equal(validation.runtimeIds[0], 'hot', 'Generic transfer prefers unslotted artifact');
assert(!transfers.serverValidateWeaponRuntimeRemoval(donor, { ...row, itemRuntimeId: 'forged' }).ok);
assert(transfers.serverValidateWeaponRuntimeRemoval(donor, { ...row, itemRuntimeIds: 42 }).ok, 'Malformed optional runtime list must not crash the server');
const captured = transfers.serverCaptureWeaponRuntimeRecords(donor, row, validation);
donor.inventory[0].qty--;
transfers.serverFinalizeWeaponRuntimeRemoval(donor, row, validation);
transfers.serverCommitArtifactMarketTransfer(donor, 'market', [], [{ artifactRecords: captured }]);
assert.deepEqual(donor.artifactSlots, [record.id]);
transfers.savesDb = JSON.parse(JSON.stringify(transfers.savesDb));
const buyer = { characterId: 'b', inventory: [row] };
transfers.serverCommitArtifactMarketTransfer(buyer, 'market', [row], []);
assert.equal(buyer.artifactRecords[0].id, 'hot');
assert(buyer.artifactRecords[0].hot && !buyer.artifactRecords[0].stabilized);
assert.equal(buyer.artifactRecords[0].ownerCharacterId, 'b');
assert.equal(Object.keys(transfers.savesDb.artifactMarketRuntime.market).length, 0);
transfers.serverCarryCapacity = player => 70 + effects.calculateArtifactEffects(player, catalog).carryKg;
vm.runInContext(functionSource('serverCarryCapacityAfterRuntimeRemovals'), transfers);
const vein = { id: 'vein:1', itemId: 'artifactVein', typeId: 'vein', stabilized: true };
const carrier = { inventory: [{ id: vein.itemId, qty: 1 }], equipment: { artifactBelt: 'artifactBelt2' }, artifactSlots: [vein.id], artifactRecords: [vein] };
assert.equal(transfers.serverCarryCapacity(carrier), 85);
assert.equal(transfers.serverCarryCapacityAfterRuntimeRemovals(carrier, carrier.inventory, [{ validation: { runtimeIds: [vein.id] } }]), 70,
  'Even a same-type replacement must not keep the outgoing artifact carry bonus');
console.log('Mechanics regression checks passed: production history, artifact ownership/restart, siege ownership/elimination.');
