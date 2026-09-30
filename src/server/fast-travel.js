'use strict';

// Проводник — единственный быстрый путь в мире зон. Он стоит в каждом городе
// фракции и бесплатно ведёт в любой другой такой город, но только налегке: без
// экипировки и с пустым рюкзаком (марки лежат на счёте аккаунта и не в счёт).
// Вещи из города в город носят через зоны своими ногами — иначе дорога теряла бы
// смысл. Из боя не уводит. Модуль чистый: игрок, его вещи и время приходят снаружи.

const ZONE_KM = 20;

const DEFAULT_RULES = Object.freeze({
  combatLockMs: 15000
});

const CONDUCTOR_ONLY_IN_CITIES = 'Проводник есть только в городах фракций.';

function finite(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeFastTravelRules(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    combatLockMs: Math.round(finite(src.combatLockMs, DEFAULT_RULES.combatLockMs, 0, 600000))
  });
}

/** Расстояние между зонами по прямой, км. */
function zoneDistanceKm(from, to) {
  if (!from || !to) return 0;
  return Math.hypot(Number(to.col) - Number(from.col), Number(to.row) - Number(from.row)) * ZONE_KM;
}

/**
 * Куда ведёт проводник этого города: остальные города фракций, ближние первыми.
 * capitals — [{locationId, name, zone}], где zone — зона города в графе ({col, row}).
 */
function fastTravelDestinations(capitals = [], fromLocationId = '') {
  const from = capitals.find(row => row.locationId === fromLocationId);
  if (!from) return [];
  return capitals
    .filter(row => row.locationId !== fromLocationId)
    .map(row => ({
      locationId: row.locationId,
      name: row.name,
      distanceKm: Math.round(zoneDistanceKm(from.zone, row.zone))
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Готов ли игрок идти с проводником ('' — готов): не в бою, ничего не надето и
 * рюкзак пуст. trip: {rules, lastCombatAt, now, equipment: [{slot, id, name}],
 * cargo: [{id, qty, name}]} — экипировка и рюкзак уже без пустых слотов и марок.
 */
function fastTravelReadiness(trip = {}) {
  const rules = trip.rules || DEFAULT_RULES;
  const now = Number(trip.now || Date.now());
  const lastCombatAt = Number(trip.lastCombatAt || 0);
  const since = now - lastCombatAt;
  if (lastCombatAt > 0 && since < rules.combatLockMs) {
    return `Из боя проводник не уводит. Подождите ${Math.ceil((rules.combatLockMs - since) / 1000)} с без боя.`;
  }
  const worn = Array.isArray(trip.equipment) ? trip.equipment : [];
  if (worn.length) {
    return `Снимите экипировку («${worn[0].name || worn[0].id}»${worn.length > 1 ? ` и ещё ${worn.length - 1}` : ''}): проводник ведёт только налегке.`;
  }
  const cargo = Array.isArray(trip.cargo) ? trip.cargo : [];
  if (cargo.length) {
    return `Рюкзак должен быть пуст («${cargo[0].name || cargo[0].id}»${cargo.length > 1 ? ` и ещё ${cargo.length - 1}` : ''}): вещи оставляют в хранилище города.`;
  }
  return '';
}

/**
 * Почему проводник не поведёт ('' — ведёт). trip: {rules, capitals, fromLocationId,
 * toLocationId, lastCombatAt, now, equipment, cargo}.
 */
function fastTravelRefusal(trip = {}) {
  const capitals = Array.isArray(trip.capitals) ? trip.capitals : [];
  if (!capitals.some(row => row.locationId === trip.fromLocationId)) return CONDUCTOR_ONLY_IN_CITIES;
  if (trip.toLocationId === trip.fromLocationId) return 'Вы уже в этом городе.';
  const destination = fastTravelDestinations(capitals, trip.fromLocationId).find(row => row.locationId === trip.toLocationId);
  if (!destination) return 'Туда проводник не ведёт: только в другой город фракции.';
  return fastTravelReadiness(trip);
}

module.exports = {
  CONDUCTOR_ONLY_IN_CITIES,
  DEFAULT_RULES,
  ZONE_KM,
  fastTravelDestinations,
  fastTravelReadiness,
  fastTravelRefusal,
  normalizeFastTravelRules,
  zoneDistanceKm
};
