'use strict';

const POPULATION_STATE_VERSION = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizePopulation(input = {}, profile = {}, options = {}) {
  const initial = Math.max(1, Math.floor(Number(
    input.population ?? profile.population ?? options.defaultPopulation ?? 80
  )));
  const protectedByStory = profile.protected === true || options.protected === true;
  const protectedMinimum = Math.max(1, Math.floor(Number(
    input.protectedMinimum
      ?? profile.protectedMinimum
      ?? (protectedByStory ? initial * Number(options.protectedRatio ?? 0.55) : 1)
  )));
  return {
    version: POPULATION_STATE_VERSION,
    population: Math.max(protectedMinimum, initial),
    protectedMinimum,
    crisisHours: Math.max(0, Number(input.crisisHours || 0)),
    lastMigrationDay: Math.max(-1, Math.floor(Number(input.lastMigrationDay ?? -1))),
    migratedTotal: Math.max(0, Math.floor(Number(input.migratedTotal || 0)))
  };
}

function advancePopulation(input = {}, condition = 'stable', hours = 0, worldHour = 0, options = {}) {
  const state = normalizePopulation(input, {}, options);
  const step = Math.max(0, Number(hours || 0));
  const crisis = condition === 'crisis';
  state.crisisHours = crisis ? state.crisisHours + step : Math.max(0, state.crisisHours - step * 2);

  let migrated = 0;
  const delayHours = Math.max(24, Number(options.crisisMigrationDelayHours || 48));
  const day = Math.max(0, Math.floor(Number(worldHour || 0) / 24));
  if (crisis && state.crisisHours >= delayHours && day > state.lastMigrationDay) {
    const maxRate = clamp(options.maxDailyMigrationRate ?? 0.05, 0, 0.05);
    const movable = Math.max(0, state.population - state.protectedMinimum);
    migrated = Math.min(movable, Math.max(1, Math.floor(state.population * maxRate)));
    state.population -= migrated;
    state.migratedTotal += migrated;
    state.lastMigrationDay = day;
  }
  return { state, migrated };
}

module.exports = {
  POPULATION_STATE_VERSION,
  advancePopulation,
  normalizePopulation
};
