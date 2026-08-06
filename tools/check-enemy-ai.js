#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  actorIsExplicitlyHostileToPlayer,
  markActorHostileToPlayer,
  addPlayerThreat,
  observePlayerThreat,
  playerThreatScore,
  targetInsideVisionArc,
  npcAttackHitChance,
  segmentIntersectsRotatedBlocker
} = require('../src/server/enemy-ai');

const attacker = { id: 'socket-a', characterId: 'character-a', x: 8, z: 0 };
const bystander = { id: 'socket-b', characterId: 'character-b', x: 2, z: 0 };
const guard = { id: 'guard', hostileToPlayer: false, x: 0, z: 0, targetId: '' };

assert.strictEqual(actorIsExplicitlyHostileToPlayer(guard, attacker), false, 'guard starts neutral');
assert.strictEqual(markActorHostileToPlayer(guard, attacker), true, 'first hostility mark changes state');
assert.strictEqual(actorIsExplicitlyHostileToPlayer(guard, attacker), true, 'attacker becomes a personal enemy');
assert.strictEqual(actorIsExplicitlyHostileToPlayer(guard, bystander), false, 'bystander does not inherit another player hostility');
assert.strictEqual(markActorHostileToPlayer(guard, attacker), false, 'hostility marking is idempotent');

const now = 100000;
observePlayerThreat(guard, bystander, now);
addPlayerThreat(guard, attacker, 260, now, { visible: true });
const attackerThreat = playerThreatScore(guard, attacker, { now, distance: 8, visible: true });
const bystanderThreat = playerThreatScore(guard, bystander, { now, distance: 2, visible: true });
assert(attackerThreat > bystanderThreat, 'damage threat must outweigh simple proximity');

const watcher = { x: 0, z: 0, vx: 0, vz: 1, lootTier: 'raider' };
assert.strictEqual(targetInsideVisionArc(watcher, { x: 0, z: 5 }), true, 'target in front is visible');
assert.strictEqual(targetInsideVisionArc(watcher, { x: 0, z: -5 }), false, 'humanoid has a rear blind zone');
assert.strictEqual(targetInsideVisionArc(watcher, { x: 0, z: -1 }), true, 'very close target bypasses the vision arc');
assert.strictEqual(
  targetInsideVisionArc(watcher, { x: 4, z: -1 }, { naturalCreature: true }),
  true,
  'natural creatures receive a wider field of view'
);

const rifle = { id: 'rifle', ammoType: 'ammo556', range: 24 };
const automatic = { id: 'assaultRifle', ammoType: 'ammo556', range: 18, automatic: true };
const skilledShooter = { npcProfile: { special: { PE: 8, AG: 6 } } };
const stationaryTarget = { moving: false, crouching: false };
const movingTarget = { moving: true, crouching: false };
const nearChance = npcAttackHitChance(skilledShooter, stationaryTarget, rifle, 4, { attackRange: 20 });
const farChance = npcAttackHitChance(skilledShooter, stationaryTarget, rifle, 18, { attackRange: 20 });
const movingChance = npcAttackHitChance(skilledShooter, movingTarget, rifle, 4, { attackRange: 20 });
const automaticChance = npcAttackHitChance(skilledShooter, stationaryTarget, automatic, 4, { attackRange: 15 });
assert(nearChance > farChance, 'ranged accuracy falls with distance');
assert(nearChance > movingChance, 'moving targets are harder to hit');
assert(nearChance > automaticChance, 'automatic weapons carry an accuracy penalty');
assert(nearChance < 1 && farChance > 0, 'NPC attacks are probabilistic rather than guaranteed');

const blocker = { x: 0, z: 0, halfX: 1, halfZ: 0.5, rotationY: Math.PI / 4 };
assert.strictEqual(segmentIntersectsRotatedBlocker(-5, 0, 5, 0, blocker), true, 'rotated collider blocks a crossing ray');
assert.strictEqual(segmentIntersectsRotatedBlocker(-5, 4, 5, 4, blocker), false, 'separated ray remains clear');

const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
[
  'actorIsExplicitlyHostileToPlayer(actor, player)',
  'roomStaticCollisionBlocksSegment(room, fromX, fromZ, toX, toZ',
  'beginEnemySearchAt(room, enemy, searchX, searchZ',
  "io.to(target.id).emit('enemyAttackMiss'",
  "enemy.aiState = readiness.reloading ? 'reload' : 'chase'",
  'updateEnemyCombatRetreat(room, enemy, visibleTarget, dt, now)',
  'room.enemySpawnTimer * 1000 >= ENEMY_RESPAWN_INTERVAL_MS'
].forEach(contract => assert(serverSource.includes(contract), `server AI integration is missing: ${contract}`));

console.log('Enemy AI checks OK: personal hostility, threat, FOV, accuracy, and collider LOS');
