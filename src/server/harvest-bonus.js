'use strict';

// Сбор ресурса: один удар по узлу всегда даёт одну единицу, вторая выпадает
// шансом. Здесь считается только этот шанс — общий для кирки, топора и насоса.
// Порог состояния инструмента, щедрость зоны и премиум применяет
// `harvestResource` в server.js уже к готовому шансу.

const HARVEST_BONUS = Object.freeze({
  base: 0.18,
  perIntAboveFive: 0.025,
  perLuckAboveFive: 0.01,
  // Стартовая черта «Ремесленник». Её описание в каталоге прогрессии называет
  // это число в процентных пунктах: check-progression-balance.js сверяет их.
  craftsmanStart: 0.18,
  wanderer: 0.12,
  repair: 0.08,
  engineerPerRank: 0.025,
  recyclerPerRank: 0.02,
  min: 0.05,
  max: 0.78
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unit(value) {
  return Math.min(1, Math.max(0, finite(value, 0)));
}

function rank(value) {
  return Math.max(0, Math.floor(finite(value, 0)));
}

/**
 * Шанс второй единицы ресурса за один сбор, 0,05–0,78.
 * `int` и `luck` — действующие характеристики с перками, `wandererNorm` и
 * `repairNorm` — нормы навыков 0–1, `engineer` и `recycler` — ранги перков.
 */
function harvestBonusChance(input = {}) {
  const traits = Array.isArray(input.traits) ? input.traits.map(String) : [];
  const chance = HARVEST_BONUS.base +
    Math.max(0, finite(input.int, 5) - 5) * HARVEST_BONUS.perIntAboveFive +
    Math.max(0, finite(input.luck, 5) - 5) * HARVEST_BONUS.perLuckAboveFive +
    (traits.includes('craftsmanStart') ? HARVEST_BONUS.craftsmanStart : 0) +
    unit(input.wandererNorm) * HARVEST_BONUS.wanderer +
    unit(input.repairNorm) * HARVEST_BONUS.repair +
    rank(input.engineer) * HARVEST_BONUS.engineerPerRank +
    rank(input.recycler) * HARVEST_BONUS.recyclerPerRank;
  return Math.min(HARVEST_BONUS.max, Math.max(HARVEST_BONUS.min, chance));
}

module.exports = { harvestBonusChance };
