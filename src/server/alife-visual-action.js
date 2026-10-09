'use strict';

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
  const emerging = enemy.ecologyVisualAction === 'emerge'
    && now - Number(enemy.ecologyVisualActionStartedAt || 0) < 1500;
  const action = enemy.dead ? 'death'
    : holdingTacticalCover(enemy, now, aiState, moving) ? 'cover'
      : combat ? 'combat' : emerging ? 'emerge' : moving ? 'patrol' : 'guard';
  if (enemy.siteVisualAction !== action) {
    enemy.siteVisualAction = action;
    enemy.siteVisualActionStartedAt = action === 'emerge'
      ? Number(enemy.ecologyVisualActionStartedAt || now) : now;
  }
  return { action, startedAt: Math.max(0, Number(enemy.siteVisualActionStartedAt || 0)) };
}

module.exports = { holdingTacticalCover, siteActorVisualAction };
