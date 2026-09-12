'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../data/artifacts.json');
const { calculateArtifactEffects, sanitizeArtifactLoadout } = require('../src/server/artifact-effects');
const { publicArtifactsForPlayer, pickupArtifact } = require('../src/server/artifact-spawns');
const runtime = require('../src/server/artifact-runtime');
const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function playerWith(...ids) {
  const types = ids.map(id => catalog.types.find(row => row.id === id));
  return { id: 'tester', characterId: 'tester', roomId: 'room', x: 0, z: 0, hp: 50, maxHp: 100,
    inventory: types.map(row => ({ id: row.itemId, qty: 1 })),
    equipment: { artifactBelt: 'artifactBelt4', detector: 'artifactDetectorMk1' },
    artifactRecords: types.map(row => ({ id: row.id, typeId: row.id, itemId: row.itemId, stabilized: true })),
    artifactSlots: ids, artifactRuntime: runtime.sanitizeArtifactRuntime({}, 1000) };
}
const effects = p => calculateArtifactEffects(p, catalog);
for (const type of catalog.types) {
  const p = playerWith(type.id);
  assert.deepEqual(effects(p).artifactTypeIds, [type.id]);
  assert(!type.implementationNote, `${type.id} still has a placeholder warning`);
  p.artifactRecords[0].hot = true; p.artifactRecords[0].stabilized = false;
  assert.deepEqual(effects(p).artifactTypeIds, []);
  p.artifactRecords[0].hot = false; p.artifactRecords[0].stabilized = true;
  p.inventory = [];
  assert.deepEqual(effects(p).artifactTypeIds, []);
}
const p = playerWith('drop');
const normal = playerWith();
for (let now = 1000; now <= 61000; now += 1000) {
  runtime.tickArtifactRuntime(p, effects(p), false, now);
  runtime.tickArtifactRuntime(normal, effects(normal), false, now);
}
close(p.artifactRuntime.hydration, 98.7); close(normal.artifactRuntime.hydration, 99);
p.onGlobalMap = true;
runtime.tickArtifactRuntime(p, effects(p), false, 62000);
close(p.artifactRuntime.hydration, 98.7);
p.artifactRuntime.hydration = 0;
close(runtime.artifactApMultiplier(p, 1000), 0.75);
assert.equal(runtime.consumeArtifactProvision(p, 'water').hydrated, 40);
close(runtime.artifactApMultiplier(p, 1000), 1);
const dew = playerWith('dew');
assert(!runtime.consumeArtifactProvision(dew, 'food', effects(dew)).ok);
assert.equal(dew.hp, 50);
dew.artifactSlots = [];
assert.equal(runtime.consumeArtifactProvision(dew, 'food', effects(dew)).healed, 10);
dew.artifactSlots = ['dew'];
runtime.startArtifactStim(dew, effects(dew), 1000);
assert.equal(dew.artifactRuntime.stimUntil, 13000);
close(runtime.artifactApMultiplier(dew, 12999), 1.2);
close(runtime.artifactApMultiplier(dew, 13000), 1);
runtime.startArtifactStim(dew, effects(dew), 1000);
assert.equal(dew.artifactRuntime.stimUntil, 13000, 'Repeated stim must refresh, not stack');
const restored = runtime.sanitizeArtifactRuntime(JSON.parse(JSON.stringify(dew.artifactRuntime)), 5000);
assert.equal(restored.stimUntil, 13000, 'Reconnect must not restart duration');

const thunderer = playerWith('thunderer');
assert(!runtime.applyArtifactElectricHit(thunderer, 'electric', effects(thunderer), 1000), 'Dry electricity must not stun');
const wet = runtime.isWetEnvironment(thunderer, [{ type: 'dew', x: 0, z: 0, radius: 3 }]);
assert(wet);
runtime.tickArtifactRuntime(thunderer, effects(thunderer), wet, 1000);
assert(!runtime.applyArtifactElectricHit(thunderer, 'fire', effects(thunderer), 1000));
assert(runtime.applyArtifactElectricHit(thunderer, 'electric', effects(thunderer), 1000));
assert(runtime.isArtifactStunned(thunderer, 2199));
assert(!runtime.isArtifactStunned(thunderer, 2200));
assert(!runtime.applyArtifactElectricHit(thunderer, 'electric', effects(thunderer), 2300), 'Cooldown must allow escape');
assert(!runtime.applyArtifactElectricHit(thunderer, 'electric', effects(thunderer), 31000), 'Wetness expires');
thunderer.artifactSlots = [];
runtime.tickArtifactRuntime(thunderer, effects(thunderer), true, 32000);
assert(!runtime.applyArtifactElectricHit(thunderer, 'electric', effects(thunderer), 32000));

const anchor = playerWith('anchor'); anchor.x = 2;
close(runtime.displaceArtifactPlayer(anchor, { x: 0, z: 0 }, -1, effects(anchor), () => true), 0.4);
close(anchor.x, 1.6);
close(runtime.displaceArtifactPlayer(anchor, { x: 0, z: 0 }, 1, effects(anchor), () => true), 0.4);
const stopped = runtime.displaceArtifactPlayer(anchor, { x: 0, z: 0 }, 4, {}, (fx, fz, x) => x <= 2.3);
assert(stopped <= 0.3 && anchor.x <= 2.3, 'No tunnelling through a wall');
anchor.x = 0.2;
runtime.displaceArtifactPlayer(anchor, { x: 0, z: 0 }, -4, {}, () => true);
close(anchor.x, 0);
const husher = playerWith('husher');
runtime.artifactFootstep(husher, effects(husher), 1000);
husher.x = 2;
close(runtime.artifactFootstep(husher, effects(husher), 1500), 14 * 0.65);
assert.equal(runtime.artifactFootstep(husher, effects(husher), 2000), 0, 'Standing does not generate steps');
husher.x = 30;
assert.equal(runtime.artifactFootstep(husher, effects(husher), 2500), 0, 'Teleport does not generate steps');
close(1 + effects(husher).hearingRangePct, 0.7);

const memory = playerWith('memory');
const room = { id: 'room', locationId: 'test', kromkaArtifactState: { shiftId: 'one', artifacts: [
  { id: 'found', typeId: 'spring', x: 1, z: 0 }, { id: 'hidden', typeId: 'node', x: 10, z: 0 }
] } };
let rows = publicArtifactsForPlayer(room, memory, catalog, 5000);
assert(rows.find(r => r.id === 'found').revealed);
assert.equal(rows.find(r => r.id === 'hidden').x, null, 'Unrevealed location stays private');
memory.x = 30;
rows = publicArtifactsForPlayer(room, memory, catalog, 11500);
assert(rows.find(r => r.id === 'found').trace, 'Memory extends a 5-second trace to 7 seconds');
assert(!pickupArtifact(room, memory, 'found', catalog, 11500).ok, 'A trace is not remote pickup authority');
assert(!publicArtifactsForPlayer(room, memory, catalog, 12000).some(r => r.id === 'found'));
memory.x = 0;
publicArtifactsForPlayer(room, memory, catalog, 13000);
memory.x = 30; memory.artifactSlots = [];
assert(!publicArtifactsForPlayer(room, memory, catalog, 18100).some(r => r.id === 'found'), 'Unequip removes trace extension');
memory.x = 0; memory.artifactSlots = ['memory'];
const echo = publicArtifactsForPlayer(room, memory, catalog, 20001).find(r => r.id.startsWith('echo:'));
assert(echo && !echo.revealed && echo.x === null);
assert(!pickupArtifact(room, memory, echo.id, catalog, 20001).ok);
memory.artifactSlots = [];
assert(!publicArtifactsForPlayer(room, memory, catalog, 20002).some(r => r.id.startsWith('echo:')));
memory.artifactSlots = ['memory'];
room.kromkaArtifactState.artifacts[0].pickedUp = true;
assert(!publicArtifactsForPlayer(room, memory, catalog, 20003).some(r => r.id === 'found'));
memory.equipment.detector = '';
assert.deepEqual(publicArtifactsForPlayer(room, memory, catalog, 20004), []);
assert(!memory.artifactDetectorMemory);

// Execute the real server entry guards, not a parallel implementation.
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const context = vm.createContext({ ...runtime });
for (const name of ['serverApplyMovementProposal', 'serverPrepareFixedActionAp', 'serverValidateAndSpendAttack']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
const stunned = playerWith(); stunned.artifactRuntime.stunnedUntil = 5000;
assert(!context.serverApplyMovementProposal(stunned, { x: 2, z: 0 }, 1000).accepted);
assert(!context.serverPrepareFixedActionAp(stunned, {}, 1, 1000).ok);
assert(!context.serverValidateAndSpendAttack(stunned, {}, {}, {}, 1000).ok);
assert.equal(stunned.x, 0);
const regenContext = vm.createContext({ serverArtifactEffects: effects,
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), io: { to: () => ({ emit() {} }) } });
const regenStart = source.indexOf('function updateServerArtifactRegeneration(');
vm.runInContext(source.slice(regenStart, source.indexOf('\n}', regenStart) + 2), regenContext);
const bloodkin = playerWith('bloodkin'); bloodkin.hp = 10;
for (let t = 1000; t <= 11000; t += 100) regenContext.updateServerArtifactRegeneration(bloodkin, t);
close(bloodkin.hp, 30);
assert.equal(bloodkin.radiation, 15);
assert.equal(bloodkin.artifactBloodkinCooldownUntil, 91000);
bloodkin.hp = 10;
regenContext.updateServerArtifactRegeneration(bloodkin, 12000);
close(bloodkin.hp, 10);
const drop = playerWith('drop'); drop.lastServerDamageAt = 1000;
regenContext.updateServerArtifactRegeneration(drop, 6500);
regenContext.updateServerArtifactRegeneration(drop, 7000);
close(drop.hp, 50);
regenContext.updateServerArtifactRegeneration(drop, 8000);
close(drop.hp, 50.6);
const medicalContext = vm.createContext({ serverArtifactEffects: effects, serverTalentLevel: () => 0,
  serverSkillNorm: () => 0, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) });
const medicalStart = source.indexOf('function serverFirstAidAmount(');
vm.runInContext(source.slice(medicalStart, source.indexOf('\n}', medicalStart) + 2), medicalContext);
assert.equal(medicalContext.serverFirstAidAmount(playerWith(), 'medkit', playerWith('node')), 28,
  'Node reduces incoming medkit healing even when another player heals its wearer');
assert.equal(medicalContext.serverFirstAidAmount(playerWith('node'), 'medkit', playerWith()), 35,
  'Node does not penalize healing other people');
assert.equal(medicalContext.serverFirstAidAmount(playerWith(), 'stim', playerWith('node')), 18);
console.log('Artifact runtime OK: 13 owned/stable types, water/food/stim, wet stun, force/collision, footsteps, detector traces/echoes, server action guards.');
