const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UNITY_COORDS_FILE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'World', 'RoaCoords.cs');
const CHARACTER_FILE = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb');
const {
  MODEL_FORWARD_AXIS_BY_KEY,
  actorFacingCorrectionY,
  actorFacingIntent,
  actorFacingModelKey,
  actorFacingYaw
} = require('../public/js/game/00a_actor_facing');

const EXPECTED_ACTOR_MODELS = Object.freeze({
  traderNpc: '-Z',
  caravanMerchant: '-Z',
  caravanGuard: '-Z',
  klimPatrolGuard: '-Z',
  wastelandSettler: '-Z',
  enemyRaider: '-Z',
  enemyGhoul: '+Z',
  enemySuperMutant: '+Z',
  enemyAshWolf: '+Z',
  enemyRadscorpion: '-Z',
  enemyMutantAnt: '-Z',
  enemyGecko: '+Z',
  enemyFireGecko: '+Z',
  brahmin: '+Z',
  friendlyBrahmin: '+Z'
});

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', 'character forward-axis source must be a GLB');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    if (type === 'BIN\0') binary = chunk;
    offset += 8 + length;
  }
  assert(json && binary, 'character GLB is missing JSON or BIN data');
  return { json, binary };
}

function averagePositionZ(glb, meshName) {
  const mesh = glb.json.meshes.find(row => row.name === meshName);
  assert(mesh && mesh.primitives?.length, `character mesh is missing: ${meshName}`);
  const accessor = glb.json.accessors[mesh.primitives[0].attributes.POSITION];
  const view = glb.json.bufferViews[accessor.bufferView];
  assert.strictEqual(accessor.componentType, 5126, `${meshName}: POSITION is not float32`);
  assert.strictEqual(accessor.type, 'VEC3', `${meshName}: POSITION is not VEC3`);
  const stride = view.byteStride || 12;
  const base = Number(view.byteOffset || 0) + Number(accessor.byteOffset || 0);
  let total = 0;
  for (let index = 0; index < accessor.count; index += 1)
    total += glb.binary.readFloatLE(base + index * stride + 8);
  return total / accessor.count;
}

const characterGlb = parseGlb(CHARACTER_FILE);
const eyeForwardZ = averagePositionZ(characterGlb, 'mesh_character_male_medium_bc_eyes');
const eyebrowForwardZ = averagePositionZ(characterGlb, 'mesh_character_male_medium_bc_eyebrows');
assert(eyeForwardZ > 0.05 && eyebrowForwardZ > 0.05,
  `character facial geometry no longer proves +Z forward: eyes=${eyeForwardZ}, brows=${eyebrowForwardZ}`);

const unityCoords = fs.readFileSync(UNITY_COORDS_FILE, 'utf8');
[
  'public const float ModelYawOffsetDeg = 0f;',
  '=> 180f - serverAngleRad * Mathf.Rad2Deg + ModelYawOffsetDeg;',
  '=> (180f - (unityYawDeg - ModelYawOffsetDeg)) * Mathf.Deg2Rad;'
].forEach(marker => assert(unityCoords.includes(marker), `Unity character facing contract is missing: ${marker}`));

for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const unityYaw = Math.PI - angle;
  const renderedForward = { x: Math.sin(unityYaw), z: Math.cos(unityYaw) };
  const convertedServerForward = { x: Math.sin(angle), z: -Math.cos(angle) };
  const dot = renderedForward.x * convertedServerForward.x + renderedForward.z * convertedServerForward.z;
  assert(dot > 0.999999, `Unity player faces backward for server angle ${angle}`);
  const roundTrip = Math.PI - unityYaw;
  assert(Math.abs(roundTrip - angle) < 1e-12, `Unity yaw round-trip drifted for ${angle}`);
}

assert.deepStrictEqual(MODEL_FORWARD_AXIS_BY_KEY, EXPECTED_ACTOR_MODELS, 'actor forward-axis audit changed');

const directions = [
  { dx: 1, dz: 0, label: 'east' },
  { dx: -1, dz: 0, label: 'west' },
  { dx: 0, dz: 1, label: 'south' },
  { dx: 0, dz: -1, label: 'north' }
];

for (const [modelKey, forwardAxis] of Object.entries(EXPECTED_ACTOR_MODELS)) {
  const actor = { modelKey };
  assert.strictEqual(actorFacingCorrectionY(actor), forwardAxis === '+Z' ? Math.PI : 0, `${modelKey}: wrong correction`);
  for (const direction of directions) {
    const yaw = actorFacingYaw(actor, direction.dx, direction.dz);
    assert(Number.isFinite(yaw), `${modelKey}: ${direction.label} yaw is invalid`);
    const localForwardZ = forwardAxis === '+Z' ? 1 : -1;
    const worldForwardX = Math.sin(yaw) * localForwardZ;
    const worldForwardZ = Math.cos(yaw) * localForwardZ;
    const dot = worldForwardX * direction.dx + worldForwardZ * direction.dz;
    assert(dot > 0.9999, `${modelKey}: face does not match ${direction.label} movement`);
  }
}

assert.strictEqual(actorFacingModelKey({ visual: 'ash_wolf' }), 'enemyAshWolf');
assert.strictEqual(actorFacingModelKey({ species: 'fire_gecko' }), 'enemyFireGecko');
assert.strictEqual(actorFacingModelKey({ visual: 'mutant_ant' }), 'enemyMutantAnt');

const movingIntent = actorFacingIntent({
  aiState: 'chase',
  x: 0,
  z: 0,
  lookX: 0,
  lookZ: -10
}, 1, 0);
assert.deepStrictEqual(movingIntent, { dx: 1, dz: 0, source: 'movement' }, 'movement must override a stale chase look point');

const attackIntent = actorFacingIntent({
  aiState: 'attack',
  x: 2,
  z: 3,
  lookX: -4,
  lookZ: 8
}, 1, 0);
assert.deepStrictEqual(attackIntent, { dx: -6, dz: 5, source: 'attack' }, 'attack target must override movement');

const fallbackIntent = actorFacingIntent({ aiState: 'attack', x: 2, z: 3 }, 0, 0, {
  fallbackX: 5,
  fallbackZ: 7
});
assert.deepStrictEqual(fallbackIntent, { dx: 3, dz: 4, source: 'attack-fallback' }, 'attack fallback target is ignored');

const idleLookIntent = actorFacingIntent({ aiState: 'idle', x: 1, z: 1, lookX: 1, lookZ: 4 }, 0, 0);
assert.deepStrictEqual(idleLookIntent, { dx: 0, dz: 3, source: 'look' }, 'stationary look direction is ignored');
assert.strictEqual(actorFacingIntent({ aiState: 'idle', x: 1, z: 1 }, 0, 0), null, 'empty actor has a facing intent');

const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
[
  "require('./public/js/game/00a_actor_facing')",
  'resolveActorFacingIntent(enemy, enemy.vx, enemy.vz)',
  'resolveActorFacingYaw(enemy, intent.dx, intent.dz)',
  'enemy.facingY = yaw;',
  'return Number.isFinite(heldYaw) ? heldYaw : 0;'
].forEach(marker => assert(serverSource.includes(marker), `server facing integration is missing: ${marker}`));

const clientSource = fs.readFileSync(path.join(ROOT, 'public/js/game/09_update_fog_movement_ai.js'), 'utf8');
[
  'RealmActorFacing.actorFacingIntent(enemy, movementDx, movementDz',
  'RealmActorFacing.actorFacingYaw(enemy, dx, dz)',
  'const actualDx = nx - Number(e.prevVisualX ?? nx);',
  "const fallbackTarget = (e.aiState === 'chase' || e.aiState === 'attack') ? player : null;"
].forEach(marker => assert(clientSource.includes(marker), `client facing integration is missing: ${marker}`));

console.log(`Actor facing OK: ${Object.keys(EXPECTED_ACTOR_MODELS).length} model axes, Unity +Z character face (${eyeForwardZ.toFixed(3)}m eyes), movement and attack priorities.`);
