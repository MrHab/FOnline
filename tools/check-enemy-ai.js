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
  npcAttackTelegraph,
  applyNpcHitStagger,
  npcHitStaggerActive,
  finalizeNpcDeathState,
  segmentIntersectsRotatedBlocker,
  actorCircleContactPenalty,
  actorCircleMoveAllowed,
  npcMeleeFormationSlot,
  reconcileNpcMeleeSlotReservations,
  npcMeleeApproachSpeed,
  npcMeleeCommitCapacity,
  npcMeleeCommitLeaseMs,
  npcMeleeCommitCooldownMs,
  tryReserveNpcMeleeCommit,
  completeNpcMeleeCommit
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

const aimingRifleman = { aiState: 'attack', targetId: 'socket-target', attackTimer: 0.31 };
const rifleTell = npcAttackTelegraph(aimingRifleman, rifle);
assert(rifleTell && rifleTell.ranged && rifleTell.targetId === 'socket-target',
  'ranged attack enters a target-specific warning window');
assert.strictEqual(npcAttackTelegraph({ ...aimingRifleman, attackTimer: 0.7 }, rifle), null,
  'ordinary ranged cooldown is not shown as one long warning');
const rocketTell = npcAttackTelegraph({ ...aimingRifleman, attackTimer: 0.62 },
  { id: 'rocketLauncher', ammoType: 'rocketAmmo' });
assert(rocketTell && rocketTell.windowMs > rifleTell.windowMs,
  'slow explosive attacks receive a longer readable tell');
assert.strictEqual(npcAttackTelegraph({ ...aimingRifleman, aiState: 'chase' }, rifle), null,
  'non-attacking NPC does not leak a false warning');

const blocker = { x: 0, z: 0, halfX: 1, halfZ: 0.5, rotationY: Math.PI / 4 };
assert.strictEqual(segmentIntersectsRotatedBlocker(-5, 0, 5, 0, blocker), true, 'rotated collider blocks a crossing ray');
assert.strictEqual(segmentIntersectsRotatedBlocker(-5, 4, 5, 4, blocker), false, 'separated ray remains clear');

const staggered = {
  id: 'raider-stagger', hp: 80, maxHp: 100, dead: false,
  aiState: 'attack', vx: 1, vz: -1, attackTimer: 0.05
};
const staggerMs = applyNpcHitStagger(staggered, 22, 1000, { critical: true });
assert(staggerMs >= 250 && staggerMs <= 310,
  'a strong critical hit must create a readable bounded stagger');
assert.strictEqual(staggered.aiState, 'stagger');
assert.strictEqual(staggered.vx, 0);
assert.strictEqual(staggered.vz, 0);
assert(npcHitStaggerActive(staggered, 1000 + staggerMs - 1),
  'stagger must remain active for its authoritative window');
assert(!npcHitStaggerActive(staggered, 1000 + staggerMs),
  'stagger must end exactly at its authoritative deadline');
assert.strictEqual(applyNpcHitStagger(staggered, 99, 1100), 0,
  'stagger immunity must prevent automatic-fire stun lock');

const dying = {
  hp: -4, maxHp: 40, aiState: 'chase', vx: 1.3, vz: -0.4,
  targetId: 'player-a', targetPlayerId: 'player-a', attackTargetId: 'player-a',
  factionTargetId: 'guard-a', lookX: 4, lookZ: 6, attackTimer: 0.2,
  hitStaggerUntil: 9000, path: [{ x: 1, z: 1 }], pathIndex: 1,
  pathGoalKey: '4:6', nextPathAt: 5000
};
finalizeNpcDeathState(dying, 2400);
assert.deepStrictEqual({
  dead: dying.dead, hp: dying.hp, state: dying.aiState,
  vx: dying.vx, vz: dying.vz, target: dying.targetId,
  factionTarget: dying.factionTargetId, attackTarget: dying.attackTargetId,
  lookX: dying.lookX, path: dying.path, pathIndex: dying.pathIndex,
  attackTimer: dying.attackTimer, stagger: dying.hitStaggerUntil
}, {
  dead: true, hp: 0, state: 'dead', vx: 0, vz: 0, target: '',
  factionTarget: '', attackTarget: '', lookX: null, path: null, pathIndex: 0,
  attackTimer: 0, stagger: 0
}, 'death must atomically clear every combat and locomotion intent');

assert(actorCircleContactPenalty(0, 0, 0.5, 0.7, 0, 0.4, 0.08) > 0.27,
  'point-blank actors report authoritative penetration');
assert.strictEqual(actorCircleMoveAllowed(0, 0, -0.2, 0, 0.5, 0.7, 0, 0.4, 0.08), true,
  'an actor already overlapping may move out of contact');
assert.strictEqual(actorCircleMoveAllowed(0, 0, 0.2, 0, 0.5, 0.7, 0, 0.4, 0.08), false,
  'an actor may not deepen point-blank penetration');
assert.strictEqual(actorCircleMoveAllowed(0, 0, 0.1, 0, 0.4, 2, 0, 0.4, 0.08), true,
  'separated actors retain ordinary movement');

const meleeFormation = Array.from({ length: 18 }, (_, index) =>
  npcMeleeFormationSlot(index, 18, 0.9, 1.45, index / 20));
assert(meleeFormation.slice(0, 8).every(slot => slot.ring === 0 && slot.contact),
  'the first eight melee NPCs must own the readable contact ring');
assert(meleeFormation.slice(8, 16).every(slot => slot.ring === 1 && !slot.contact),
  'overflow melee NPCs must wait on a support ring');
assert(meleeFormation[8].radius > meleeFormation[0].radius + 0.65
  && meleeFormation[16].radius > meleeFormation[8].radius + 0.65,
  'melee support rings must be spatially distinct');
assert.strictEqual(new Set(meleeFormation.slice(8, 16).map(slot => slot.slot)).size, 8,
  'a full support ring must never reuse a contact point');
const threeWay = Array.from({ length: 3 }, (_, index) =>
  npcMeleeFormationSlot(index, 3, 0.9, 1.45, 0));
assert(Math.abs((threeWay[1].angle - threeWay[0].angle) - Math.PI * 2 / 3) < 1e-9
  && Math.abs((threeWay[2].angle - threeWay[1].angle) - Math.PI * 2 / 3) < 1e-9,
  'a small melee group must surround the target evenly');

let reservations = new Map();
const firstWave = new Set(['raider-a', 'raider-b', 'raider-c']);
for (const id of firstWave)
  reservations = reconcileNpcMeleeSlotReservations(reservations, firstWave, id);
assert.deepStrictEqual([...reservations.entries()], [
  ['raider-a', 0], ['raider-b', 1], ['raider-c', 2]
], 'initial melee reservations fill distinct slots');
const slotA = reservations.get('raider-a');
const slotC = reservations.get('raider-c');
const secondWave = new Set(['raider-a', 'raider-c', 'raider-d']);
reservations = reconcileNpcMeleeSlotReservations(reservations, secondWave, 'raider-d');
assert.strictEqual(reservations.get('raider-a'), slotA,
  'an attacker must not change slot when a neighbour leaves');
assert.strictEqual(reservations.get('raider-c'), slotC,
  'a second surviving attacker must retain its engagement point');
assert.strictEqual(reservations.get('raider-d'), 1,
  'a newcomer reuses the lowest released slot without moving survivors');
assert.strictEqual(new Set(reservations.values()).size, reservations.size,
  'active melee reservations must remain unique');

const approachDistances = [0.02, 0.08, 0.4, 0.9, 1.65, 3];
const approachSpeeds = approachDistances.map(distance =>
  npcMeleeApproachSpeed(2.4, distance));
assert.strictEqual(approachSpeeds[0], 0,
  'an NPC already in its final centimetres must stop');
for (let index = 1; index < approachSpeeds.length; index += 1)
  assert(approachSpeeds[index] >= approachSpeeds[index - 1],
    'melee approach speed must increase monotonically with remaining distance');
assert(approachSpeeds[1] > 0 && approachSpeeds[1] < 2.4 * 0.4,
  'the final approach must remain slow but able to finish');
assert.strictEqual(approachSpeeds[approachSpeeds.length - 1], 2.4,
  'far movement retains the authored NPC speed');

assert.deepStrictEqual([1, 2, 5, 6, 18].map(npcMeleeCommitCapacity), [1, 2, 2, 3, 3],
  'melee pressure grows through a bounded one/two/three-attacker cadence');
assert(npcMeleeCommitLeaseMs(0.55) >= 1100 && npcMeleeCommitLeaseMs(0.55) <= 1250,
  'an ordinary melee wind-up receives a complete readable commit lease');
assert.strictEqual(npcMeleeCommitLeaseMs(9), 1850,
  'pathological delays cannot monopolize a melee commit slot');
assert(npcMeleeCommitCooldownMs(1) > npcMeleeCommitCooldownMs(0),
  'stable per-actor cooldown jitter rotates the committed attackers');
const commitActors = Array.from({ length: 8 }, (_, index) => ({
  id: `commit-${index}`, attackTimer: 0.55, meleeCommitCooldownUntil: 0
}));
const activeCommits = new Set();
const firstCommitPass = commitActors.map(actor =>
  tryReserveNpcMeleeCommit(actor, 'player-a', commitActors.length, activeCommits, 2000));
assert.deepStrictEqual(firstCommitPass, [true, true, true, false, false, false, false, false],
  'an eight-NPC group must expose exactly three simultaneous melee commits');
completeNpcMeleeCommit(commitActors[0], activeCommits, 2100, 0);
assert.strictEqual(activeCommits.size, 2, 'a completed swing must release its commit immediately');
assert.strictEqual(tryReserveNpcMeleeCommit(
  commitActors[3], 'player-a', commitActors.length, activeCommits, 2101), true,
  'the next waiting NPC must inherit a released commit slot');
assert.strictEqual(tryReserveNpcMeleeCommit(
  commitActors[0], 'player-a', commitActors.length, activeCommits, 2101), false,
  'the previous attacker must respect its personal rotation cooldown');

const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
[
  'actorIsExplicitlyHostileToPlayer(actor, player)',
  'roomStaticCollisionBlocksSegment(room, fromX, fromZ, toX, toZ',
  'beginEnemySearchAt(room, enemy, searchX, searchZ',
  "io.to(target.id).emit('enemyAttackMiss'",
  "enemy.aiState = readiness.reloading ? 'reload' : 'chase'",
  'const telegraph = npcAttackTelegraph(e, serverNpcWeaponDef(e));',
  'frame.attackTargetId = telegraph.targetId;',
  'updateEnemyCombatRetreat(room, enemy, visibleTarget, dt, now)',
  'room.enemyAiPlayers = roomPlayers;',
  'roomPlayerCollisionMoveAllowed(room, enemy, x, z)',
  'actorCircleMoveAllowed(',
  'roomMeleeFormationReservation(room, enemy, target)',
  'room.enemyMeleeFormationReservations = new Map()',
  'reconcileNpcMeleeSlotReservations(state.slots, activeIds, actorId)',
  'function reserveEnemyMeleeCommit(room, enemy, target, now = Date.now())',
  "enemy.aiState = 'pressure';",
  'finishEnemyMeleeCommit(room, enemy, now);',
  'function moveEnemyTowardsMeleeSlot(room, enemy, goal, baseSpeed, dt, opts = {})',
  'const speed = npcMeleeApproachSpeed(baseSpeed, distance);',
  'finalizeNpcDeathState(enemy, now);',
  'applyNpcHitStagger(enemy, damage, now, { critical: criticalHits > 0 });',
  "enemy.aiState = 'stagger';",
  'return { x: ex, z: ez };',
  'extrapolate a melee NPC',
  'room.enemySpawnTimer * 1000 >= ENEMY_RESPAWN_INTERVAL_MS'
].forEach(contract => assert(serverSource.includes(contract), `server AI integration is missing: ${contract}`));

console.log('Enemy AI checks OK: hostility, threat, FOV, attack tells, hit stagger, atomic death, collision, stable melee rings, braking and rotating commit pressure');
