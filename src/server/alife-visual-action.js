'use strict';

const { WINDUP_MS: GRENADE_WINDUP_MS } = require('./npc-grenade');

// These are the same short windows used by the server's artifact search,
// gathering and ability actions. Loot and heal have no ecology duration yet;
// bound their presentation so a stale action cannot hold a pose forever.
const EXPLICIT_ACTION_MS = Object.freeze({
  ability: 1100, grenade: GRENADE_WINDUP_MS,
  search: 1000, gather: 1800, loot: 1800, heal: 1100
});
const COMBAT_ACTIONS = new Set(['ability', 'grenade', 'heal']);

function currentExplicitAction(enemy, now, moving) {
  if (moving) return null;
  const action = String(enemy.ecologyVisualAction || '');
  const duration = EXPLICIT_ACTION_MS[action];
  const startedAt = Number(enemy.ecologyVisualActionStartedAt);
  if (!duration || !Number.isFinite(startedAt) || startedAt <= 0
    || !Number.isFinite(now) || now < startedAt || now - startedAt >= duration) return null;
  return { action, startedAt };
}

// The tactical goal is chosen by combat AI. Presentation only reads its
// current hold, so a cover pose never causes movement or changes combat.
function holdingTacticalCover(enemy, now, aiState, moving) {
  if (!enemy || enemy.dead || moving || !enemy.ecologySiteId) return false;
  if (!enemy.targetId && !enemy.factionTargetId) return false;
  if (!['chase', 'factionCombat', 'tactical'].includes(aiState)) return false;
  if (enemy.tacticalGoalKind !== 'cover') return false;
  if (!(Number(enemy.tacticalGoalUntil) > now && Number(enemy.tacticalHoldUntil) > now)) return false;
  const x = enemy.tacticalGoalX;
  const z = enemy.tacticalGoalZ;
  if (x == null || z == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) return false;
  return Math.hypot(Number(x) - Number(enemy.x || 0), Number(z) - Number(enemy.z || 0)) <= 0.58;
}

function siteActorVisualAction(enemy, now, aiState, moving) {
  const combat = !!(enemy.targetId || enemy.factionTargetId)
    || ['chase', 'attack', 'reload', 'pressure', 'factionCombat', 'stagger'].includes(aiState);
  const explicit = currentExplicitAction(enemy, now, moving);
  const emerging = enemy.ecologyVisualAction === 'emerge'
    && now - Number(enemy.ecologyVisualActionStartedAt || 0) < 1500;
  const action = enemy.dead ? 'death'
    : holdingTacticalCover(enemy, now, aiState, moving) ? 'cover'
      : ['attack', 'reload', 'stagger'].includes(aiState) ? 'combat'
        : explicit && (COMBAT_ACTIONS.has(explicit.action) || !combat) ? explicit.action
          : combat ? 'combat' : emerging ? 'emerge' : moving ? 'patrol' : 'guard';
  const startedAt = explicit?.action === action
    ? explicit.startedAt : action === 'emerge' ? Number(enemy.ecologyVisualActionStartedAt || now) : now;
  if (enemy.siteVisualAction !== action
    || (explicit?.action === action && enemy.siteVisualActionStartedAt !== startedAt)) {
    enemy.siteVisualAction = action;
    enemy.siteVisualActionStartedAt = startedAt;
  }
  return { action, startedAt: Math.max(0, Number(enemy.siteVisualActionStartedAt || 0)) };
}

module.exports = { holdingTacticalCover, siteActorVisualAction };
