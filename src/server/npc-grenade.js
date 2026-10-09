'use strict';

// Rare, deliberate area attack for mobile raider groups. This state belongs to
// the actor and never enters authored A-Life data or the background simulation.
const WINDUP_MS = 1100;
const COOLDOWN_MS = 20000;
const GROUP_COOLDOWN_MS = 5000;
const RADIUS = 2.8;
const RANGE_MIN = 4;
const RANGE_MAX = 11;
const MAX_PLAYER_HITS = 6;

function distance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0),
    Number(a?.z || 0) - Number(b?.z || 0));
}

function canPrimeNpcGrenade(enemy, target, players, allies, now, groupReadyAt = 0, hostile = () => true) {
  if (!enemy || !target || enemy.dead || enemy.npcGrenade
    || enemy.role !== 'raider' || !enemy.ecologyGroupId || enemy.ecologySiteId
    || now < Number(enemy.npcGrenadeCooldownUntil || 0) || now < groupReadyAt) return false;
  const range = distance(enemy, target);
  if (range < RANGE_MIN || range > RANGE_MAX) return false;
  if (distance(enemy, target) <= RADIUS + 0.8) return false;
  const clustered = (players || []).filter(player => player && !player.dead
    && Number(player.hp || 0) > 0 && hostile(player)
    && distance(player, target) <= RADIUS * 0.72);
  if (clustered.length < 2) return false;
  // The thrower does not knowingly blast its own group or a neutral actor.
  return !(allies || []).some(ally => ally && ally !== enemy && !ally.dead
    && distance(ally, target) <= RADIUS + 0.75);
}

function primeNpcGrenade(enemy, target, now) {
  const grenade = {
    x: Number(target.x), z: Number(target.z), startedAt: now,
    detonateAt: now + WINDUP_MS
  };
  enemy.npcGrenade = grenade;
  enemy.npcGrenadeCooldownUntil = now + COOLDOWN_MS;
  enemy.ecologyVisualAction = 'grenade';
  enemy.ecologyVisualActionStartedAt = now;
  enemy.aiState = 'grenade';
  enemy.vx = 0;
  enemy.vz = 0;
  return grenade;
}

function finishNpcGrenade(enemy, now, players, canHit, applyDamage) {
  const grenade = enemy?.npcGrenade;
  if (!grenade) return { state: 'none', hits: [] };
  if (now < grenade.detonateAt) return { state: 'windup', hits: [] };
  enemy.npcGrenade = null;
  enemy.ecologyVisualAction = '';
  if (enemy.dead) return { state: 'cancelled', hits: [] };
  const impact = { x: grenade.x, z: grenade.z };
  const hits = (players || []).filter(player => player && !player.dead
    && Number(player.hp || 0) > 0 && distance(player, impact) <= RADIUS + 0.72
    && canHit(player, impact))
    .sort((a, b) => distance(a, impact) - distance(b, impact)
      || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, MAX_PLAYER_HITS)
    .map(player => {
      const falloff = Math.max(0.36, 1 - Math.max(0, distance(player, impact) - 0.72) / RADIUS * 0.65);
      const raw = Math.max(1, Math.round((18 + Math.min(5, Math.max(0, Number(enemy.tier || 0))) * 3) * falloff));
      return { playerId: player.id, raw, result: applyDamage(player, raw, impact) };
    });
  return { state: 'detonated', impact, hits };
}

module.exports = { WINDUP_MS, COOLDOWN_MS, GROUP_COOLDOWN_MS, RADIUS,
  RANGE_MIN, RANGE_MAX, MAX_PLAYER_HITS, canPrimeNpcGrenade, primeNpcGrenade, finishNpcGrenade };
