'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function playerIdentityKeys(player = {}) {
  return [player.id, player.characterId]
    .map(value => String(value || '').slice(0, 96))
    .filter(Boolean);
}

function actorHostilityKeys(actor = {}, create = false) {
  if (actor.hostilePlayerIds instanceof Set) return actor.hostilePlayerIds;
  if (Array.isArray(actor.hostilePlayerIds)) {
    actor.hostilePlayerIds = new Set(actor.hostilePlayerIds.map(value => String(value || '')).filter(Boolean));
    return actor.hostilePlayerIds;
  }
  if (!create) return null;
  actor.hostilePlayerIds = new Set();
  return actor.hostilePlayerIds;
}

function actorIsExplicitlyHostileToPlayer(actor = {}, player = {}) {
  const keys = actorHostilityKeys(actor, false);
  if (!keys?.size) return false;
  return playerIdentityKeys(player).some(key => keys.has(key));
}

function markActorHostileToPlayer(actor = {}, player = {}) {
  const keys = actorHostilityKeys(actor, true);
  let changed = false;
  for (const key of playerIdentityKeys(player)) {
    if (!keys.has(key)) changed = true;
    keys.add(key);
  }
  return changed;
}

function threatKey(player = {}) {
  return String(player.characterId || player.id || '').slice(0, 96);
}

function threatStore(actor = {}, create = false) {
  if (actor.playerThreat && typeof actor.playerThreat === 'object' && !Array.isArray(actor.playerThreat)) {
    return actor.playerThreat;
  }
  if (!create) return null;
  actor.playerThreat = Object.create(null);
  return actor.playerThreat;
}

function decayedThreat(entry = {}, now = Date.now()) {
  const elapsed = Math.max(0, Number(now || 0) - Number(entry.updatedAt || now));
  return Math.max(0, Number(entry.score || 0) - elapsed / 1000 * 1.6);
}

function addPlayerThreat(actor = {}, player = {}, amount = 0, now = Date.now(), details = {}) {
  const key = threatKey(player);
  if (!key) return null;
  const store = threatStore(actor, true);
  const previous = store[key] && typeof store[key] === 'object' ? store[key] : {};
  const entry = {
    ...previous,
    playerId: String(player.id || previous.playerId || '').slice(0, 96),
    characterId: String(player.characterId || previous.characterId || '').slice(0, 96),
    score: clamp(decayedThreat(previous, now) + Number(amount || 0), 0, 1000),
    updatedAt: Number(now || Date.now())
  };
  if (details.visible) {
    entry.lastSeenAt = Number(now || Date.now());
    entry.lastSeenX = Number(player.x || 0);
    entry.lastSeenZ = Number(player.z || 0);
  }
  if (details.heard) {
    entry.lastHeardAt = Number(now || Date.now());
    entry.lastHeardX = Number(details.x ?? player.x ?? 0);
    entry.lastHeardZ = Number(details.z ?? player.z ?? 0);
  }
  store[key] = entry;
  return entry;
}

function observePlayerThreat(actor = {}, player = {}, now = Date.now()) {
  const key = threatKey(player);
  if (!key) return null;
  const store = threatStore(actor, true);
  const previous = store[key] && typeof store[key] === 'object' ? store[key] : {};
  const current = decayedThreat(previous, now);
  return addPlayerThreat(actor, player, Math.max(0, 58 - current), now, { visible: true });
}

function playerThreatScore(actor = {}, player = {}, options = {}) {
  const now = Number(options.now || Date.now());
  const store = threatStore(actor, false);
  const entry = store?.[threatKey(player)] || null;
  const remembered = entry ? decayedThreat(entry, now) : 0;
  const distance = Math.max(0, Number(options.distance || 0));
  const proximity = Math.max(0, 34 - distance * 2.2);
  const visible = options.visible ? 64 : 0;
  const current = String(actor.targetId || '') === String(player.id || '') ? 22 : 0;
  return remembered + proximity + visible + current;
}

function actorFacingVector(actor = {}) {
  const x = Number(actor.x || 0);
  const z = Number(actor.z || 0);
  const lookX = Number(actor.lookX);
  const lookZ = Number(actor.lookZ);
  if (Number.isFinite(lookX) && Number.isFinite(lookZ)) {
    const dx = lookX - x;
    const dz = lookZ - z;
    const length = Math.hypot(dx, dz);
    if (length > 0.08) return { x: dx / length, z: dz / length };
  }
  const vx = Number(actor.vx || 0);
  const vz = Number(actor.vz || 0);
  const velocityLength = Math.hypot(vx, vz);
  if (velocityLength > 0.08) return { x: vx / velocityLength, z: vz / velocityLength };
  const angle = Number(actor.angle);
  if (Number.isFinite(angle)) return { x: Math.sin(angle), z: Math.cos(angle) };
  return null;
}

function actorFieldOfViewDegrees(actor = {}, options = {}) {
  const explicit = Number(actor.fieldOfView ?? actor.fovDegrees);
  if (Number.isFinite(explicit)) return clamp(explicit, 45, 360);
  const tier = String(actor.lootTier || actor.species || '').toLowerCase();
  if (options.naturalCreature) return 260;
  if (tier.includes('ghoul')) return 220;
  if (tier.includes('supermutant') || tier.includes('super_mutant')) return 190;
  return 155;
}

function targetInsideVisionArc(actor = {}, target = {}, options = {}) {
  const closeDistance = Math.max(0, Number(options.closeDistance ?? 1.7));
  const dx = Number(target.x || 0) - Number(actor.x || 0);
  const dz = Number(target.z || 0) - Number(actor.z || 0);
  const distance = Math.hypot(dx, dz);
  if (distance <= closeDistance) return true;
  const facing = actorFacingVector(actor);
  if (!facing || distance <= 0.001) return true;
  const fieldOfView = actorFieldOfViewDegrees(actor, options);
  if (fieldOfView >= 359.5) return true;
  const dot = clamp(facing.x * (dx / distance) + facing.z * (dz / distance), -1, 1);
  return dot >= Math.cos(fieldOfView * Math.PI / 360);
}

function npcSpecial(actor = {}, key = '', fallback = 5) {
  const value = Number(actor.npcProfile?.special?.[key] ?? actor.special?.[key]);
  return Number.isFinite(value) ? clamp(value, 1, 10) : fallback;
}

function npcAttackHitChance(actor = {}, target = {}, weapon = {}, distance = 0, options = {}) {
  const ranged = !!weapon.ammoType;
  const moving = !!target.moving || Math.hypot(Number(target.vx || 0), Number(target.vz || 0)) > 0.12;
  if (!ranged) {
    let chance = 0.82 + (npcSpecial(actor, 'AG') - 5) * 0.014;
    if (moving) chance -= 0.045;
    if (options.naturalCreature) chance += 0.025;
    return clamp(chance, 0.58, 0.94);
  }
  const range = Math.max(1, Number(options.attackRange || weapon.range || 10));
  const ratio = clamp(Number(distance || 0) / range, 0, 1.25);
  let chance = 0.79 - ratio * 0.28 + (npcSpecial(actor, 'PE') - 5) * 0.026;
  if (weapon.automatic) chance -= 0.075;
  if (moving) chance -= 0.065;
  if (target.crouching) chance -= 0.04;
  return clamp(chance, 0.24, 0.91);
}

function segmentIntersectsRotatedBlocker(fromX, fromZ, toX, toZ, blocker, radius = 0.04, options = {}) {
  if (!blocker) return false;
  const rotation = Number(blocker.rotationY || 0);
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localPoint = (x, z) => {
    const dx = Number(x || 0) - Number(blocker.x || 0);
    const dz = Number(z || 0) - Number(blocker.z || 0);
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const start = localPoint(fromX, fromZ);
  const end = localPoint(toX, toZ);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const halfX = Math.max(0.01, Number(blocker.halfX || 0)) + Math.max(0, Number(radius || 0));
  const halfZ = Math.max(0.01, Number(blocker.halfZ || 0)) + Math.max(0, Number(radius || 0));
  let tMin = 0;
  let tMax = 1;
  const clipAxis = (origin, delta, min, max) => {
    if (Math.abs(delta) < 1e-9) return origin >= min && origin <= max;
    let near = (min - origin) / delta;
    let far = (max - origin) / delta;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    return tMin <= tMax;
  };
  if (!clipAxis(start.x, dx, -halfX, halfX) || !clipAxis(start.z, dz, -halfZ, halfZ)) return false;
  const distance = Math.hypot(Number(toX || 0) - Number(fromX || 0), Number(toZ || 0) - Number(fromZ || 0));
  const startPadding = Math.min(0.45, Math.max(0, Number(options.startPadding ?? 0.22)));
  const endPadding = Math.min(0.65, Math.max(0, Number(options.endPadding ?? 0.38)));
  const startT = distance > 0.001 ? Math.min(0.49, startPadding / distance) : 0;
  const endT = distance > 0.001 ? Math.max(0.51, 1 - endPadding / distance) : 1;
  return tMax >= startT && tMin <= endT;
}

function npcAttackTelegraph(actor = {}, weapon = {}, options = {}) {
  if (actor.dead || String(actor.aiState || "") !== "attack") return null;
  const targetId = String(actor.targetId || "").slice(0, 96);
  if (!targetId) return null;

  const ranged = !!weapon.ammoType;
  const weaponId = String(weapon.id || "");
  let windowMs = ranged ? 380 : 520;
  if (weaponId === "rocketLauncher") windowMs = 680;
  else if (weaponId === "shotgun" || weaponId === "sawedOffShotgun") windowMs = 520;
  else if (weapon.automatic) windowMs = 330;
  windowMs = Math.round(clamp(options.windowMs ?? windowMs, 240, 800));

  const remainingMs = Math.max(0, Math.ceil(Number(actor.attackTimer || 0) * 1000));
  if (remainingMs <= 0 || remainingMs > windowMs) return null;
  return { remainingMs, windowMs, targetId, ranged };
}

/**
 * Short, bounded hit stagger gives every confirmed hit a readable response
 * without letting automatic fire permanently stun-lock an NPC.  The helper is
 * deliberately independent from room/path state so the authoritative combat
 * loop and faction combat use the exact same timing rule.
 */
function applyNpcHitStagger(actor = {}, damage = 0, now = Date.now(), options = {}) {
  if (!actor || actor.dead || Number(actor.hp || 0) <= 0) return 0;
  const time = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (time < Number(actor.nextHitStaggerAt || 0)) return 0;

  const minimumMs = clamp(Number(options.minimumMs ?? 130), 80, 240);
  const maximumMs = Math.max(minimumMs, clamp(Number(options.maximumMs ?? 310), 180, 480));
  const maxHp = Math.max(1, Number(actor.maxHp || actor.hp || 1));
  const damageRatio = clamp(Math.max(0, Number(damage || 0)) / maxHp, 0, 0.65);
  const criticalBonusMs = options.critical ? 75 : 0;
  const durationMs = Math.round(clamp(
    minimumMs + damageRatio * 520 + criticalBonusMs,
    minimumMs,
    maximumMs
  ));
  const immunityMs = Math.max(durationMs + 90,
    clamp(Number(options.immunityMs ?? 360), 240, 720));

  actor.hitStaggerUntil = time + durationMs;
  actor.nextHitStaggerAt = time + immunityMs;
  actor.aiState = 'stagger';
  actor.vx = 0;
  actor.vz = 0;
  actor.attackTimer = Math.max(Number(actor.attackTimer || 0), durationMs / 1000 + 0.12);
  actor.meleeCommitUntil = 0;
  actor.meleeCommitTargetId = '';
  return durationMs;
}

function npcHitStaggerActive(actor = {}, now = Date.now()) {
  return !!(actor && !actor.dead && Number(actor.hp || 0) > 0
    && Number(now) < Number(actor.hitStaggerUntil || 0));
}

/**
 * Death is one authoritative state transition, not a collection of loosely
 * related fields.  Clearing movement, targeting, telegraph and path intent in
 * one place prevents a late compact frame from presenting a walking corpse.
 */
function finalizeNpcDeathState(actor = {}, now = Date.now()) {
  if (!actor) return actor;
  actor.dead = true;
  actor.hp = 0;
  actor.diedAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  actor.aiState = 'dead';
  actor.vx = 0;
  actor.vz = 0;
  actor.targetId = '';
  actor.targetPlayerId = '';
  actor.attackTargetId = '';
  actor.factionTargetId = '';
  actor.factionGoalAngle = null;
  actor.lookX = null;
  actor.lookZ = null;
  actor.lastKnownX = null;
  actor.lastKnownZ = null;
  actor.attackTimer = 0;
  actor.hitStaggerUntil = 0;
  actor.nextHitStaggerAt = 0;
  actor.npcReloadUntil = 0;
  actor.meleeCommitUntil = 0;
  actor.meleeCommitCooldownUntil = 0;
  actor.meleeCommitTargetId = '';
  actor.tacticalGoal = null;
  actor.tacticalGoalX = null;
  actor.tacticalGoalZ = null;
  actor.path = null;
  actor.pathIndex = 0;
  actor.pathGoalKey = '';
  actor.nextPathAt = 0;
  return actor;
}

/**
 * Circular contact is the common denominator between the authoritative player
 * capsule and the simplified broad phase used by moving NPCs.  Keeping the
 * calculation here makes the "may leave an overlap, may never deepen it" rule
 * deterministic and directly testable.
 */
function actorCircleContactPenalty(ax, az, actorRadius, bx, bz, targetRadius, margin = 0) {
  const separation = Math.max(0, Number(actorRadius || 0))
    + Math.max(0, Number(targetRadius || 0))
    + Math.max(0, Number(margin || 0));
  return Math.max(0, separation - Math.hypot(
    Number(ax || 0) - Number(bx || 0),
    Number(az || 0) - Number(bz || 0)
  ));
}

function actorCircleMoveAllowed(currentX, currentZ, nextX, nextZ, actorRadius,
  targetX, targetZ, targetRadius, margin = 0) {
  const nextPenalty = actorCircleContactPenalty(nextX, nextZ, actorRadius,
    targetX, targetZ, targetRadius, margin);
  if (nextPenalty <= 0.001) return true;
  const currentPenalty = actorCircleContactPenalty(currentX, currentZ, actorRadius,
    targetX, targetZ, targetRadius, margin);
  return currentPenalty > 0.001 && nextPenalty < currentPenalty - 0.0005;
}

/**
 * Stable melee crowd layout around one target.  The first eight actors occupy
 * the readable contact ring; additional attackers wait on concentric support
 * rings instead of reusing the same eight points and merging into one body.
 * The server remains authoritative: this helper only selects the destination
 * offset used by the ordinary path/collision code.
 */
function npcMeleeFormationSlot(index, count, contactRadius, attackRange, seed = 0) {
  const safeIndex = Math.max(0, Math.floor(Number(index || 0)));
  const safeCount = Math.max(1, Math.floor(Number(count || 1)));
  const slotsPerRing = 8;
  const ring = Math.floor(safeIndex / slotsPerRing);
  const localIndex = safeIndex % slotsPerRing;
  const actorsOnRing = Math.max(1, Math.min(slotsPerRing,
    safeCount - ring * slotsPerRing));
  const slot = localIndex;
  const angle = actorsOnRing === 1
    ? 0
    : localIndex * Math.PI * 2 / actorsOnRing;
  const baseRadius = Math.max(Math.max(0, Number(contactRadius || 0)),
    clamp(Number(attackRange || 0) * 0.78, 1.05, 1.65));
  const ringSpacing = Math.max(0.74, Math.max(0, Number(contactRadius || 0)) * 1.16);
  const jitter = clamp(Number(seed || 0), 0, 1) * 0.16;
  return {
    ring,
    slot,
    angle,
    radius: baseRadius + jitter + ring * ringSpacing,
    contact: ring === 0
  };
}

/**
 * Preserve melee engagement slots while the set of attackers changes.  A
 * sorted-per-frame index makes every remaining NPC choose a different point
 * whenever somebody joins, dies or retreats; the resulting crossovers are
 * especially visible at point-blank range.  Existing valid reservations keep
 * their index and only a newcomer receives the lowest free one.
 */
function reconcileNpcMeleeSlotReservations(previous, activeActorIds, reserveActorId = '') {
  const active = new Set([...activeActorIds || []]
    .map(id => String(id || ''))
    .filter(Boolean));
  const next = new Map();
  const used = new Set();
  if (previous instanceof Map) {
    for (const [rawId, rawSlot] of previous.entries()) {
      const id = String(rawId || '');
      const slot = Math.floor(Number(rawSlot));
      if (!id || !active.has(id) || !Number.isFinite(slot) || slot < 0 || used.has(slot)) continue;
      next.set(id, slot);
      used.add(slot);
    }
  }

  const reserveId = String(reserveActorId || '');
  if (reserveId && active.has(reserveId) && !next.has(reserveId)) {
    let slot = 0;
    while (used.has(slot)) slot += 1;
    next.set(reserveId, slot);
  }
  return next;
}

/**
 * Smoothly brakes an NPC over the last metres before its reserved melee slot.
 * The final centimetres retain enough speed to actually reach the slot; the
 * ordinary movement helper owns the exact stop threshold.
 */
function npcMeleeApproachSpeed(baseSpeed, distanceToGoal, options = {}) {
  const speed = Math.max(0, Number(baseSpeed || 0));
  const distance = Math.max(0, Number(distanceToGoal || 0));
  const stopDistance = clamp(Number(options.stopDistance ?? 0.02), 0.01, 0.12);
  const fullSpeedDistance = Math.max(stopDistance + 0.2,
    Number(options.fullSpeedDistance ?? 1.65));
  const minimumMultiplier = clamp(Number(options.minimumMultiplier ?? 0.24), 0.1, 0.65);
  if (speed <= 0 || distance <= stopDistance) return 0;
  const linear = clamp((distance - stopDistance) / (fullSpeedDistance - stopDistance), 0, 1);
  const eased = linear * linear * (3 - 2 * linear);
  return speed * (minimumMultiplier + (1 - minimumMultiplier) * eased);
}

/**
 * Limits how many melee NPCs may commit to an actual swing at once. Everyone
 * else keeps a reserved ring position and remains threatening, but the player
 * gets a readable sequence of attacks instead of one synchronized damage wall.
 */
function npcMeleeCommitCapacity(attackerCount) {
  const count = Math.max(0, Math.floor(Number(attackerCount || 0)));
  if (count <= 1) return count;
  if (count <= 5) return 2;
  return 3;
}

function npcMeleeCommitLeaseMs(attackDelaySeconds, options = {}) {
  const windupMs = Math.max(0, Number(attackDelaySeconds || 0) * 1000);
  const followThroughMs = clamp(Number(options.followThroughMs ?? 620), 320, 900);
  return Math.round(clamp(windupMs + followThroughMs, 760, 1850));
}

function npcMeleeCommitCooldownMs(seed = 0, options = {}) {
  const minimumMs = clamp(Number(options.minimumMs ?? 820), 500, 1300);
  const spreadMs = clamp(Number(options.spreadMs ?? 520), 0, 900);
  return Math.round(minimumMs + clamp(Number(seed || 0), 0, 1) * spreadMs);
}

function releaseNpcMeleeCommit(actor = {}, activeActorIds = null, now = Date.now(), options = {}) {
  const actorId = String(actor.id || '');
  if (activeActorIds instanceof Set && actorId) activeActorIds.delete(actorId);
  actor.meleeCommitUntil = 0;
  actor.meleeCommitTargetId = '';
  const cooldownMs = Math.max(0, Number(options.cooldownMs || 0));
  if (cooldownMs > 0) {
    actor.meleeCommitCooldownUntil = Math.max(Number(actor.meleeCommitCooldownUntil || 0),
      Number(now || Date.now()) + cooldownMs);
  }
}

function tryReserveNpcMeleeCommit(actor = {}, targetId = '', attackerCount = 1,
  activeActorIds = null, now = Date.now(), options = {}) {
  const id = String(actor.id || '');
  const target = String(targetId || '');
  if (!id || !target || !(activeActorIds instanceof Set)) return false;
  const time = Number(now || Date.now());
  if (String(actor.meleeCommitTargetId || '') === target
    && time < Number(actor.meleeCommitUntil || 0)) {
    activeActorIds.add(id);
    return true;
  }
  releaseNpcMeleeCommit(actor, activeActorIds, time);
  if (time < Number(actor.meleeCommitCooldownUntil || 0)) return false;
  if (activeActorIds.size >= npcMeleeCommitCapacity(attackerCount)) return false;
  actor.meleeCommitTargetId = target;
  actor.meleeCommitUntil = time + npcMeleeCommitLeaseMs(
    options.attackDelaySeconds ?? actor.attackTimer, options);
  activeActorIds.add(id);
  return true;
}

function completeNpcMeleeCommit(actor = {}, activeActorIds = null,
  now = Date.now(), seed = 0, options = {}) {
  releaseNpcMeleeCommit(actor, activeActorIds, now, {
    cooldownMs: npcMeleeCommitCooldownMs(seed, options)
  });
}

module.exports = {
  actorHostilityKeys,
  actorIsExplicitlyHostileToPlayer,
  markActorHostileToPlayer,
  addPlayerThreat,
  observePlayerThreat,
  playerThreatScore,
  actorFacingVector,
  actorFieldOfViewDegrees,
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
  releaseNpcMeleeCommit,
  tryReserveNpcMeleeCommit,
  completeNpcMeleeCommit
};
