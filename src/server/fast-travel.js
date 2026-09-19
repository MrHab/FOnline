'use strict';

// Перенос между столицами фракций — единственный быстрый путь в мире зон.
// Диспетчер в столице отправляет игрока в другую столицу за марки: цена растёт
// с расстоянием между зонами столиц. Из боя не отправляют, и груз, который
// выносят из опасных зон ногами (артефакты в рюкзаке), перевезти нельзя —
// иначе дорога через зоны теряла бы смысл. Модуль чистый: игрок, его рюкзак и
// время приходят снаружи.

const ZONE_KM = 20;

const DEFAULT_RULES = Object.freeze({
  baseFee: 40,
  feePerKm: 0.5,
  combatLockMs: 15000,
  blockedCategories: Object.freeze(['artifacts'])
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeFastTravelRules(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const categories = Array.isArray(src.blockedCategories) ? src.blockedCategories : DEFAULT_RULES.blockedCategories;
  return Object.freeze({
    baseFee: Math.round(finite(src.baseFee, DEFAULT_RULES.baseFee, 0, 100000)),
    feePerKm: finite(src.feePerKm, DEFAULT_RULES.feePerKm, 0, 1000),
    combatLockMs: Math.round(finite(src.combatLockMs, DEFAULT_RULES.combatLockMs, 0, 600000)),
    blockedCategories: Object.freeze(categories.map(value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean))
  });
}

/** Расстояние между зонами по прямой, км. */
function zoneDistanceKm(from, to) {
  if (!from || !to) return 0;
  return Math.hypot(Number(to.col) - Number(from.col), Number(to.row) - Number(from.row)) * ZONE_KM;
}

function fastTravelFee(rules, fromZone, toZone) {
  return Math.round(rules.baseFee + rules.feePerKm * zoneDistanceKm(fromZone, toZone));
}

/**
 * Направления из столицы: остальные столицы с ценой. capitals — [{locationId,
 * name, zone}], где zone — зона столицы в графе ({col, row}).
 */
function fastTravelDestinations(rules, capitals = [], fromLocationId = '') {
  const from = capitals.find(row => row.locationId === fromLocationId);
  if (!from) return [];
  return capitals
    .filter(row => row.locationId !== fromLocationId)
    .map(row => ({
      locationId: row.locationId,
      name: row.name,
      distanceKm: Math.round(zoneDistanceKm(from.zone, row.zone)),
      fee: fastTravelFee(rules, from.zone, row.zone)
    }))
    .sort((a, b) => a.fee - b.fee || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Почему перенос невозможен ('' — можно). trip: {rules, capitals, fromLocationId,
 * toLocationId, silver, lastCombatAt, now, cargo: [{id, category, name}]}.
 */
function fastTravelRefusal(trip = {}) {
  const rules = trip.rules || DEFAULT_RULES;
  const capitals = Array.isArray(trip.capitals) ? trip.capitals : [];
  if (!capitals.some(row => row.locationId === trip.fromLocationId)) return 'Диспетчер переноса есть только в столицах фракций.';
  const destination = fastTravelDestinations(rules, capitals, trip.fromLocationId).find(row => row.locationId === trip.toLocationId);
  if (!destination) return 'Туда диспетчер не отправляет: перенос идёт только между столицами.';
  const now = Number(trip.now || Date.now());
  const since = now - Number(trip.lastCombatAt || 0);
  if (Number(trip.lastCombatAt || 0) > 0 && since < rules.combatLockMs) {
    return `Из боя не отправляют. Подождите ${Math.ceil((rules.combatLockMs - since) / 1000)} с без боя.`;
  }
  const blocked = (Array.isArray(trip.cargo) ? trip.cargo : []).find(row => rules.blockedCategories.includes(String(row?.category || '')));
  if (blocked) return `«${blocked.name || blocked.id}» не перевозят: такой груз выносят из зон своими ногами.`;
  if (Math.floor(Number(trip.silver || 0)) < destination.fee) return `Перенос стоит ${destination.fee} марок — у вас столько нет.`;
  return '';
}

module.exports = {
  DEFAULT_RULES,
  ZONE_KM,
  fastTravelDestinations,
  fastTravelFee,
  fastTravelRefusal,
  normalizeFastTravelRules,
  zoneDistanceKm
};
