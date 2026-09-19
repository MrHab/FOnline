'use strict';

// Запись о жизни поселения только нормализуется и публикуется: почасового
// расчёта потребления, состояний и миграции в экономике v3 нет.
const { normalizePopulation } = require('./wasteland-population');

const SETTLEMENT_LIFE_VERSION = 1;
const SETTLEMENT_STATES = new Set(['stable', 'shortage', 'crisis', 'recovering']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function lifeConfig(config = {}) {
  const defaults = config.settlementDefaults || {};
  return {
    consumptionPer100PerDay: {
      water: 8,
      food: 6,
      medicine: 1,
      ...(defaults.consumptionPer100PerDay || {})
    },
    shortageReserveDays: Math.max(0.25, Number(defaults.shortageReserveDays || 3)),
    crisisReserveDays: Math.max(0.1, Number(defaults.crisisReserveDays || 1)),
    protectedPopulationRatio: clamp(defaults.protectedPopulationRatio ?? 0.55, 0.1, 1),
    maxDailyMigrationRate: clamp(defaults.maxDailyMigrationRate ?? 0.05, 0, 0.05),
    crisisMigrationDelayHours: Math.max(24, Number(defaults.crisisMigrationDelayHours || 48)),
    recoveryHours: Math.max(6, Number(defaults.recoveryHours || 24))
  };
}

function settlementProfile(site = {}, config = {}) {
  return config.settlements?.[site.id] || {};
}

function bootstrapStockpile(site = {}, profile = {}) {
  const stockpile = site.stockpile || (site.stockpile = {});
  for (const [id, qty] of Object.entries(profile.initialStock || {})) {
    stockpile[id] = Math.max(Number(stockpile[id] || 0), Math.max(0, Number(qty || 0)));
  }
}

function normalizeSettlementLife(site = {}, config = {}, worldHour = 0) {
  const profile = settlementProfile(site, config);
  const rules = lifeConfig(config);
  const source = site.settlementLife && typeof site.settlementLife === 'object' ? site.settlementLife : {};
  const firstInitialization = Number(source.version || 0) < SETTLEMENT_LIFE_VERSION;
  if (firstInitialization) bootstrapStockpile(site, profile);
  const population = normalizePopulation(source, profile, {
    defaultPopulation: Number(config.settlementDefaults?.population || 80),
    protected: profile.protected === true || site.capital === true,
    protectedRatio: rules.protectedPopulationRatio
  });
  return {
    ...source,
    ...population,
    version: SETTLEMENT_LIFE_VERSION,
    health: clamp(source.health ?? profile.health ?? 68, 0, 100),
    integrity: clamp(source.integrity ?? profile.integrity ?? 70, 0, 100),
    prosperity: clamp(source.prosperity ?? site.prosperity ?? profile.prosperity ?? 50, 0, 100),
    tension: clamp(source.tension ?? profile.tension ?? 22, 0, 100),
    condition: SETTLEMENT_STATES.has(source.condition) ? source.condition : 'stable',
    previousCondition: SETTLEMENT_STATES.has(source.previousCondition) ? source.previousCondition : 'stable',
    recoveryUntilHour: Math.max(0, Number(source.recoveryUntilHour || 0)),
    consumptionRemainder: Object.fromEntries(Object.entries(source.consumptionRemainder || {})
      .map(([id, qty]) => [id, clamp(qty, 0, 0.999999)])),
    reserveDays: source.reserveDays && typeof source.reserveDays === 'object' ? source.reserveDays : {},
    causeCode: String(source.causeCode || 'stable_supplies').slice(0, 48),
    reason: String(source.reason || '').slice(0, 180),
    forecast: String(source.forecast || '').slice(0, 180),
    actions: Array.isArray(source.actions) ? source.actions.map(String).slice(0, 4) : [],
    consequences: Array.isArray(source.consequences) ? source.consequences.slice(0, 12) : [],
    lastUpdatedHour: Number.isFinite(Number(source.lastUpdatedHour)) ? Number(source.lastUpdatedHour) : Number(worldHour || 0)
  };
}

function publicSettlementLife(site = {}, config = {}) {
  if (!site.settlementLife) return null;
  const life = normalizeSettlementLife(site, config, site.settlementLife.lastUpdatedHour || 0);
  return {
    version: life.version,
    population: life.population,
    protectedMinimum: life.protectedMinimum,
    health: Math.round(life.health),
    integrity: Math.round(life.integrity),
    prosperity: Math.round(life.prosperity),
    tension: Math.round(life.tension),
    state: life.condition,
    stateLabel: {
      stable: 'стабильно',
      shortage: 'нехватка',
      crisis: 'кризис',
      recovering: 'восстановление'
    }[life.condition] || 'стабильно',
    causeCode: life.causeCode,
    reason: life.reason,
    forecast: life.forecast,
    actions: life.actions.slice(0, 4),
    reserveDays: Object.fromEntries(Object.entries(life.reserveDays || {}).map(([id, value]) => [id, round(value, 1)])),
    consequences: life.consequences.slice(0, 3)
  };
}

module.exports = {
  SETTLEMENT_LIFE_VERSION,
  SETTLEMENT_STATES,
  lifeConfig,
  normalizeSettlementLife,
  publicSettlementLife
};
