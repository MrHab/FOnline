'use strict';

const POPULATION_STATE_VERSION = 1;

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

module.exports = {
  POPULATION_STATE_VERSION,
  normalizePopulation
};
