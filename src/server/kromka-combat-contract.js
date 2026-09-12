'use strict';

const { resolveCriticalShot } = require('./combat-critical');

const KROMKA_DAMAGE_TYPES = Object.freeze([
  'ballistic',
  'explosive',
  'energy',
  'fire',
  'electric',
  'toxic',
  'radiation',
  'anomalous'
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeDamageType(type = 'ballistic') {
  return KROMKA_DAMAGE_TYPES.includes(type) ? type : 'ballistic';
}

function sanitizeProtectionProfile(profile = {}, type = 'ballistic') {
  return {
    type: normalizeDamageType(profile.type || type),
    threshold: Math.max(0, Number(profile.threshold || 0)),
    protection: clamp(profile.protection, -0.5, 0.85),
    resistance: clamp(profile.resistance, -0.5, 0.85)
  };
}

/**
 * Единый серверный порядок Кромки:
 * сырой урон (уже после крита) -> плоский порог -> броня -> сопротивление.
 * Минимум в 12% сохраняет прежний баланс и применяется только после всех
 * защитных ступеней, поэтому ни одна из них не меняет порядок вычислений.
 */
function resolveDamageMitigation(rawDamage, profile = {}, damageType = 'ballistic') {
  const raw = Math.max(0, Math.round(Number(rawDamage) || 0));
  const safe = sanitizeProtectionProfile(profile, damageType);
  if (raw <= 0) {
    return {
      raw: 0,
      damage: 0,
      absorbed: 0,
      ...safe,
      afterThreshold: 0,
      afterProtection: 0,
      afterResistance: 0
    };
  }

  const afterThreshold = Math.max(0, raw - safe.threshold);
  const afterProtection = Math.max(0, afterThreshold * (1 - safe.protection));
  const afterResistance = Math.max(0, afterProtection * (1 - safe.resistance));
  const minimum = Math.max(1, Math.floor(raw * 0.12));
  const damage = Math.max(minimum, Math.round(afterResistance));
  return {
    raw,
    damage,
    absorbed: Math.max(0, raw - damage),
    ...safe,
    afterThreshold: Number(afterThreshold.toFixed(3)),
    afterProtection: Number(afterProtection.toFixed(3)),
    afterResistance: Number(afterResistance.toFixed(3))
  };
}

function resolveWeaponDamage(options = {}) {
  const critical = resolveCriticalShot(
    options.rawDamage,
    options.luck,
    options.weapon,
    options.rng
  );
  const mitigation = resolveDamageMitigation(
    critical.rawDamage,
    options.profile,
    options.damageType || options.weapon?.damageType
  );
  return {
    ...mitigation,
    baseRawDamage: Math.max(0, Math.round(Number(options.rawDamage) || 0)),
    critical: critical.critical,
    criticalChance: critical.chance,
    criticalMultiplier: critical.multiplier
  };
}

module.exports = {
  KROMKA_DAMAGE_TYPES,
  normalizeDamageType,
  resolveDamageMitigation,
  resolveWeaponDamage,
  sanitizeProtectionProfile
};
