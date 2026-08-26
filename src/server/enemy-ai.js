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
  segmentIntersectsRotatedBlocker
};
