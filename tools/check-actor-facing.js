const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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

console.log(`Actor facing OK: ${Object.keys(EXPECTED_ACTOR_MODELS).length} model axes, movement and attack priorities.`);
