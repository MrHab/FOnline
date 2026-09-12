'use strict';

const { advancePopulation, normalizePopulation } = require('./wasteland-population');
const { appendSettlementConsequence, publicCause } = require('./wasteland-world-events');

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

function settlementDailyNeeds(life = {}, config = {}) {
  const rules = lifeConfig(config);
  const factor = Math.max(1, Number(life.population || 1)) / 100;
  return Object.fromEntries(Object.entries(rules.consumptionPer100PerDay)
    .map(([id, qty]) => [id, Math.max(0, Number(qty || 0) * factor)]));
}

function settlementReserveDays(stockpile = {}, life = {}, config = {}) {
  const needs = settlementDailyNeeds(life, config);
  return Object.fromEntries(Object.entries(needs).map(([id, daily]) => [
    id,
    daily > 0 ? round(Math.max(0, Number(stockpile[id] || 0)) / daily, 2) : 99
  ]));
}

function criticalCause(reserveDays = {}, life = {}, security = 100, config = {}) {
  const rules = lifeConfig(config);
  const ordered = ['water', 'food', 'medicine']
    .map(id => ({ id, days: Number(reserveDays[id] ?? 99) }))
    .sort((a, b) => a.days - b.days);
  if (ordered[0] && ordered[0].days < rules.shortageReserveDays) return `low_${ordered[0].id}`;
  if (Number(security || 0) < 25) return 'unsafe_roads';
  if (Number(life.integrity || 0) < 45) return 'damaged_infrastructure';
  return 'stable_supplies';
}

function deriveCondition(life = {}, reserveDays = {}, security = 100, config = {}, worldHour = 0) {
  const rules = lifeConfig(config);
  const values = ['water', 'food', 'medicine'].map(id => Number(reserveDays[id] ?? 99));
  const underDay = values.filter(value => value < rules.crisisReserveDays).length;
  const shortage = values.some(value => value < rules.shortageReserveDays)
    || Math.min(life.health, life.integrity, life.prosperity) < 45;
  const crisis = underDay >= 2 || Number(security || 0) < 25 || Number(life.integrity || 0) < 20;
  if (crisis) return 'crisis';
  if ((life.condition === 'crisis' || life.condition === 'recovering')
    && Number(life.recoveryUntilHour || 0) > Number(worldHour || 0)) return 'recovering';
  return shortage ? 'shortage' : 'stable';
}

function consumeNeeds(stockpile = {}, life = {}, hours = 0, config = {}) {
  const daily = settlementDailyNeeds(life, config);
  const remainders = { ...(life.consumptionRemainder || {}) };
  const demanded = {};
  const consumed = {};
  const missing = {};
  for (const [id, perDay] of Object.entries(daily)) {
    const exact = perDay * Math.max(0, Number(hours || 0)) / 24 + Number(remainders[id] || 0);
    const demand = Math.floor(exact + 1e-9);
    remainders[id] = round(exact - demand, 6);
    demanded[id] = demand;
    const have = Math.max(0, Math.floor(Number(stockpile[id] || 0)));
    const take = Math.min(have, demand);
    if (take > 0) stockpile[id] = have - take;
    consumed[id] = take;
    missing[id] = Math.max(0, demand - take);
  }
  return { demanded, consumed, missing, remainders };
}

function advanceSettlementHour(site = {}, config = {}, hours = 0, worldHour = 0) {
  const rules = lifeConfig(config);
  const life = normalizeSettlementLife(site, config, worldHour);
  const previousCondition = life.condition;
  const previousCause = life.causeCode;
  const stockpile = site.stockpile || (site.stockpile = {});
  const consumption = consumeNeeds(stockpile, life, hours, config);
  life.consumptionRemainder = consumption.remainders;
  const missingUnits = Object.values(consumption.missing).reduce((sum, qty) => sum + Number(qty || 0), 0);
  const step = Math.max(0, Number(hours || 0));
  const shortagePressure = Math.min(1, missingUnits / Math.max(1,
    Object.values(consumption.demanded).reduce((sum, qty) => sum + Number(qty || 0), 0)));
  if (shortagePressure > 0) {
    life.health = clamp(life.health - step * (0.12 + shortagePressure * 0.45), 0, 100);
    life.prosperity = clamp(life.prosperity - step * (0.16 + shortagePressure * 0.5), 0, 100);
    life.tension = clamp(life.tension + step * (0.22 + shortagePressure * 0.65), 0, 100);
  } else {
    life.health = clamp(life.health + step * 0.035, 0, 100);
    life.prosperity = clamp(life.prosperity + step * 0.025, 0, 100);
    life.tension = clamp(life.tension - step * 0.06, 0, 100);
  }
  const security = clamp(site.security ?? 50, 0, 100);
  if (security < 35) life.integrity = clamp(life.integrity - step * 0.04, 0, 100);
  else if (stockpile.scrap > 0 && life.integrity < 85) life.integrity = clamp(life.integrity + step * 0.02, 0, 100);

  life.reserveDays = settlementReserveDays(stockpile, life, config);
  let condition = deriveCondition(life, life.reserveDays, security, config, worldHour);
  if (previousCondition === 'crisis' && condition !== 'crisis') {
    life.recoveryUntilHour = Number(worldHour || 0) + rules.recoveryHours;
    condition = 'recovering';
  }
  life.previousCondition = previousCondition;
  life.condition = condition;
  const causeCode = condition === 'recovering'
    ? 'recovering'
    : criticalCause(life.reserveDays, life, security, config);
  const cause = publicCause(causeCode, config.causes, {});
  life.causeCode = causeCode;
  life.reason = cause.reason;
  const worst = Object.entries(life.reserveDays).sort((a, b) => a[1] - b[1])[0];
  life.forecast = worst && worst[1] < 20
    ? `${worst[0]}: резерва примерно на ${round(worst[1], 1)} игровых суток`
    : cause.forecast;
  life.actions = cause.actions;
  if (condition !== previousCondition || causeCode !== previousCause) {
    life.consequences = appendSettlementConsequence(life.consequences, {
      worldHour,
      causeCode,
      state: condition,
      text: `${condition}: ${life.reason}`
    });
  }
  const populationResult = advancePopulation(life, condition, step, worldHour, {
    protected: site.capital === true || settlementProfile(site, config).protected === true,
    protectedRatio: rules.protectedPopulationRatio,
    maxDailyMigrationRate: rules.maxDailyMigrationRate,
    crisisMigrationDelayHours: rules.crisisMigrationDelayHours
  });
  Object.assign(life, populationResult.state);
  life.lastUpdatedHour = Number(worldHour || 0);
  site.settlementLife = life;
  site.prosperity = round(life.prosperity, 2);
  return {
    life,
    conditionChanged: condition !== previousCondition,
    causeChanged: causeCode !== previousCause,
    migrated: populationResult.migrated,
    consumption
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
  advanceSettlementHour,
  deriveCondition,
  lifeConfig,
  normalizeSettlementLife,
  publicSettlementLife,
  settlementDailyNeeds,
  settlementReserveDays
};
