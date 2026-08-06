'use strict';

const CRITICAL_SHOT_DAMAGE_MULTIPLIER = 2;
const CRITICAL_SHOT_MIN_LUCK = 1;
const CRITICAL_SHOT_MAX_LUCK = 15;

function criticalShotChanceFromLuck(luck = 5) {
  const effectiveLuck = Math.max(
    CRITICAL_SHOT_MIN_LUCK,
    Math.min(CRITICAL_SHOT_MAX_LUCK, Number(luck) || 5)
  );
  return effectiveLuck / 100;
}

function weaponCanCriticalShot(weapon = {}) {
  return !!weapon?.ammoType;
}

function resolveCriticalShot(rawDamage, luck = 5, weapon = {}, rng = Math.random) {
  const baseDamage = Math.max(0, Number(rawDamage) || 0);
  const chance = weaponCanCriticalShot(weapon)
    ? criticalShotChanceFromLuck(luck)
    : 0;
  const critical = chance > 0 && rng() < chance;
  const multiplier = critical ? CRITICAL_SHOT_DAMAGE_MULTIPLIER : 1;
  return {
    critical,
    chance,
    multiplier,
    rawDamage: Math.max(0, Math.round(baseDamage * multiplier))
  };
}

module.exports = {
  CRITICAL_SHOT_DAMAGE_MULTIPLIER,
  CRITICAL_SHOT_MAX_LUCK,
  CRITICAL_SHOT_MIN_LUCK,
  criticalShotChanceFromLuck,
  resolveCriticalShot,
  weaponCanCriticalShot
};
