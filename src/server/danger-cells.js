'use strict';

/**
 * Цвет опасности точки мира (экономика v3, библия 18.1, KRM-22). Правила из
 * economy.json: чёрная Сердцевина, мирные столицы с синим поясом, красные
 * внешние регионы, остальное жёлтое. Граф зон (src/server/zone-graph.js)
 * красит так каждую зону по её центру, а кольцо 3×3 вокруг столиц задаёт сам.
 *
 * Модуль не знает о сервере: координаты узлов и регион передаются снаружи.
 */

const DANGER_MODES = Object.freeze(['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack']);

const DEFAULT_CONFIG = Object.freeze({
  capitals: Object.freeze([]),
  safeRadiusKm: 12,
  blueRadiusKm: 38,
  blueExtraCenters: Object.freeze([]),
  blackCenters: Object.freeze([]),
  regionModes: Object.freeze({}),
  defaultMode: 'pvp'
});

// Сторона движения → точка входа: движение на север входит с юга.
const ENTRY_FOR_DIRECTION = Object.freeze({
  north: 'entryFromSouth',
  south: 'entryFromNorth',
  west: 'entryFromEast',
  east: 'entryFromWest'
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function cleanMode(value, fallback = 'pvp') {
  return DANGER_MODES.includes(value) ? value : fallback;
}

function idList(value, fallback = []) {
  return Object.freeze((Array.isArray(value) ? value : fallback).map(item => safeId(item)).filter(Boolean));
}

function centerList(value) {
  return Object.freeze((Array.isArray(value) ? value : [])
    .map(row => ({ locationId: safeId(row?.locationId), radiusKm: finite(row?.radiusKm, 0, 0, 1000) }))
    .filter(row => row.locationId && row.radiusKm > 0)
    .map(Object.freeze));
}

function normalizeDangerCellConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const regionModes = {};
  for (const [region, mode] of Object.entries(src.regionModes && typeof src.regionModes === 'object' ? src.regionModes : {})) {
    const id = safeId(region, 48);
    if (id && DANGER_MODES.includes(mode)) regionModes[id] = mode;
  }
  return Object.freeze({
    capitals: idList(src.capitals),
    safeRadiusKm: finite(src.safeRadiusKm, DEFAULT_CONFIG.safeRadiusKm, 0, 1000),
    blueRadiusKm: finite(src.blueRadiusKm, DEFAULT_CONFIG.blueRadiusKm, 0, 1000),
    blueExtraCenters: idList(src.blueExtraCenters),
    blackCenters: centerList(src.blackCenters),
    regionModes: Object.freeze(regionModes),
    defaultMode: cleanMode(src.defaultMode, DEFAULT_CONFIG.defaultMode)
  });
}

function distanceKm(a, b, pointKm = 1) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) * pointKm;
}

/**
 * Режим опасности точки карты. point и nodes ({ locationId: { x, y } }) — в
 * точках карты, pointKm — километров в точке, region — макрорегион точки.
 * Порядок: чёрные центры, мирные столицы, синий пояс, режим региона, режим
 * по умолчанию.
 */
function dangerModeAt(config, point = {}, nodes = {}, region = '', pointKm = 1) {
  for (const center of config.blackCenters) {
    const node = nodes[center.locationId];
    if (node && distanceKm(point, node, pointKm) <= center.radiusKm) return 'pvpBlack';
  }
  for (const id of config.capitals) {
    const node = nodes[id];
    if (node && distanceKm(point, node, pointKm) <= config.safeRadiusKm) return 'peaceful';
  }
  for (const id of [...config.capitals, ...config.blueExtraCenters]) {
    const node = nodes[id];
    if (node && distanceKm(point, node, pointKm) <= config.blueRadiusKm) return 'pve';
  }
  return config.regionModes[safeId(region, 48)] || config.defaultMode;
}

/** Точка входа при движении в сторону direction: входят с противоположной стороны. */
function entryKeyForDirection(direction = '') {
  return ENTRY_FOR_DIRECTION[String(direction || '').toLowerCase()] || 'entryFromWorld';
}

module.exports = {
  DANGER_MODES,
  DEFAULT_DANGER_CELL_CONFIG: DEFAULT_CONFIG,
  normalizeDangerCellConfig,
  dangerModeAt,
  entryKeyForDirection
};
