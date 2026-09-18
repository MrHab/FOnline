'use strict';

/**
 * Опасные клетки глобальной карты (экономика v3, библия 18.1, KRM-22).
 * Цвет клетки карты (10 км) выводится из правил: у столиц мирно, вокруг них
 * синий пояс, чёрная Сердцевина, внешние регионы красные, остальное жёлтое.
 * Путь по жёлтой, красной и чёрной клетке делится на мелкие клетки размером
 * с зону Albion (1,6 км): на входе в каждую сервер бросает шанс стычки, и
 * все, кого стычка застала в одной мелкой клетке, попадают в одну общую
 * сцену — там и встречаются.
 *
 * Итерация 2: в клетках «сквозных» цветов (sceneModes, сейчас чёрная
 * Сердцевина) путь по карте не идёт — каждая мелкая клетка там общая сцена,
 * вход с карты ставит отряд на сторону, откуда он пришёл, а выход с края
 * ведёт в соседнюю мелкую клетку: в её сцену или, если сосед не сквозной,
 * на карту к общей границе. Угрозы в занятых сценах сервер досыпает по цвету.
 *
 * Модуль не знает о сервере: координаты узлов, регион и случайность
 * передаются снаружи.
 */

const DANGER_MODES = Object.freeze(['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack']);

const DEFAULT_CONFIG = Object.freeze({
  subCellKm: 1.6,
  capitals: Object.freeze([]),
  safeRadiusKm: 12,
  blueRadiusKm: 38,
  blueExtraCenters: Object.freeze([]),
  blackCenters: Object.freeze([]),
  regionModes: Object.freeze({}),
  defaultMode: 'pvp',
  encounterChance: Object.freeze({ peaceful: 0, pve: 0, pvp: 0.04, pvpFullDrop: 0.1, pvpBlack: 0.18 }),
  wandererReduction: 0.5,
  edgeGraceKm: 3,
  templates: Object.freeze({ default: 'randomRuinedRoad' }),
  encounters: Object.freeze({ pvp: Object.freeze(['raider_ambush']) }),
  sceneModes: Object.freeze(['pvpBlack']),
  respawn: Object.freeze({
    intervalSeconds: 90,
    minHostiles: Object.freeze({ peaceful: 0, pve: 0, pvp: 2, pvpFullDrop: 3, pvpBlack: 4 })
  })
});

const DIRECTIONS = Object.freeze({
  north: Object.freeze({ dx: 0, dy: -1, entry: 'entryFromSouth', opposite: 'south' }),
  south: Object.freeze({ dx: 0, dy: 1, entry: 'entryFromNorth', opposite: 'north' }),
  west: Object.freeze({ dx: -1, dy: 0, entry: 'entryFromEast', opposite: 'east' }),
  east: Object.freeze({ dx: 1, dy: 0, entry: 'entryFromWest', opposite: 'west' })
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
  const chance = {};
  const chanceSrc = src.encounterChance && typeof src.encounterChance === 'object' ? src.encounterChance : {};
  for (const mode of DANGER_MODES) chance[mode] = finite(chanceSrc[mode], DEFAULT_CONFIG.encounterChance[mode], 0, 1);
  const templates = {};
  for (const [region, locationId] of Object.entries(src.templates && typeof src.templates === 'object' ? src.templates : DEFAULT_CONFIG.templates)) {
    const key = safeId(region, 48);
    const value = safeId(locationId);
    if (key && value) templates[key] = value;
  }
  if (!templates.default) templates.default = DEFAULT_CONFIG.templates.default;
  const encounters = {};
  for (const mode of DANGER_MODES) {
    const list = idList(src.encounters?.[mode], []);
    if (list.length) encounters[mode] = list;
  }
  return Object.freeze({
    subCellKm: finite(src.subCellKm, DEFAULT_CONFIG.subCellKm, 0.1, 100),
    capitals: idList(src.capitals),
    safeRadiusKm: finite(src.safeRadiusKm, DEFAULT_CONFIG.safeRadiusKm, 0, 1000),
    blueRadiusKm: finite(src.blueRadiusKm, DEFAULT_CONFIG.blueRadiusKm, 0, 1000),
    blueExtraCenters: idList(src.blueExtraCenters),
    blackCenters: centerList(src.blackCenters),
    regionModes: Object.freeze(regionModes),
    defaultMode: cleanMode(src.defaultMode, DEFAULT_CONFIG.defaultMode),
    encounterChance: Object.freeze(chance),
    wandererReduction: finite(src.wandererReduction, DEFAULT_CONFIG.wandererReduction, 0, 1),
    edgeGraceKm: finite(src.edgeGraceKm, DEFAULT_CONFIG.edgeGraceKm, 0, 1000),
    templates: Object.freeze(templates),
    encounters: Object.freeze(encounters),
    sceneModes: Object.freeze((Array.isArray(src.sceneModes) ? src.sceneModes : DEFAULT_CONFIG.sceneModes)
      .filter(mode => DANGER_MODES.includes(mode))),
    respawn: Object.freeze({
      intervalSeconds: finite(src.respawn?.intervalSeconds, DEFAULT_CONFIG.respawn.intervalSeconds, 1, 3600),
      minHostiles: Object.freeze(Object.fromEntries(DANGER_MODES.map(mode => [
        mode,
        Math.floor(finite(src.respawn?.minHostiles?.[mode], DEFAULT_CONFIG.respawn.minHostiles[mode], 0, 40))
      ])))
    })
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

/**
 * Мелкая клетка точки (в точках карты): ключ общей сцены стычки и её центр.
 * Цвет сцены берётся по центру, чтобы у одной сцены был один цвет, даже если
 * мелкая клетка лежит на границе двух клеток карты.
 */
function subCellAt(config, point = {}, pointKm = 1) {
  const size = config.subCellKm;
  const km = Number(pointKm) > 0 ? Number(pointKm) : 1;
  const sx = Math.floor(Number(point.x || 0) * km / size);
  const sy = Math.floor(Number(point.y || 0) * km / size);
  return {
    sx,
    sy,
    key: `${sx}_${sy}`,
    center: { x: (sx + 0.5) * size / km, y: (sy + 0.5) * size / km }
  };
}

/** Мелкая клетка по индексам (для соседей). */
function subCellByIndex(config, sx, sy, pointKm = 1) {
  const size = config.subCellKm;
  const km = Number(pointKm) > 0 ? Number(pointKm) : 1;
  return {
    sx,
    sy,
    key: `${sx}_${sy}`,
    center: { x: (sx + 0.5) * size / km, y: (sy + 0.5) * size / km }
  };
}

/** Сквозной ли цвет: в таких клетках путь идёт пешком по сценам. */
function isSceneMode(config, mode = '') {
  return config.sceneModes.includes(cleanMode(mode, ''));
}

/** Соседняя мелкая клетка по стороне выхода (north/south/west/east). */
function neighbourCell(config, cell = {}, direction = '', pointKm = 1) {
  const step = DIRECTIONS[String(direction || '').toLowerCase()];
  if (!step) return null;
  return subCellByIndex(config, Number(cell.sx) + step.dx, Number(cell.sy) + step.dy, pointKm);
}

/** Точка входа в сцену при движении в сторону direction: входят с противоположной стороны. */
function entryKeyForDirection(direction = '') {
  return DIRECTIONS[String(direction || '').toLowerCase()]?.entry || 'entryFromWorld';
}

/**
 * Сторона движения между двумя точками карты: вход в клетку идёт с той стороны,
 * откуда пришёл отряд (движение на север — вход с юга).
 */
function directionBetween(from = {}, to = {}) {
  const dx = Number(to.x || 0) - Number(from.x || 0);
  const dy = Number(to.y || 0) - Number(from.y || 0);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/**
 * Точка карты сразу за общей границей клетки cell в сторону direction: along
 * (0…1) — положение вдоль границы, как стоял игрок у края сцены. Точка лежит
 * внутри соседней клетки, чтобы путь дальше начинался уже там.
 */
function boundaryPoint(config, cell = {}, direction = '', pointKm = 1, along = 0.5) {
  const size = config.subCellKm / (Number(pointKm) > 0 ? Number(pointKm) : 1);
  const step = DIRECTIONS[String(direction || '').toLowerCase()];
  if (!step) return { x: cell.center?.x || 0, y: cell.center?.y || 0 };
  const inset = size * 0.08;
  const t = finite(along, 0.5, 0.05, 0.95);
  const x0 = Number(cell.sx) * size;
  const y0 = Number(cell.sy) * size;
  if (step.dy !== 0) {
    return { x: x0 + size * t, y: step.dy < 0 ? y0 - inset : y0 + size + inset };
  }
  return { x: step.dx < 0 ? x0 - inset : x0 + size + inset, y: y0 + size * t };
}

/** Сколько угроз держать в занятой сцене этого цвета. */
function minHostilesFor(config, mode = '') {
  return config.respawn.minHostiles[cleanMode(mode)] || 0;
}

/** Шанс стычки при входе в мелкую клетку; навык странника снижает его. */
function encounterChance(config, mode = 'pvp', wandererSkill = 0) {
  const base = config.encounterChance[cleanMode(mode)] || 0;
  const skill = finite(wandererSkill, 0, 0, 1);
  return Math.max(0, base * (1 - skill * config.wandererReduction));
}

function stableHash(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Сцена стычки мелкой клетки: шаблон локации по региону и встреча из пула
 * режима — одинаковые для всех, кого застало в этой клетке.
 */
function cellEncounter(config, mode = 'pvp', region = '', cell = {}) {
  const pool = config.encounters[cleanMode(mode)] || config.encounters.pvp || [];
  if (!pool.length) return null;
  const locationId = config.templates[safeId(region, 48)] || config.templates.default;
  const encounterId = pool[stableHash(`${mode}:${cell.key}`) % pool.length];
  return {
    locationId,
    encounterId,
    zoneId: `cell_${String(cell.key).replace(/-/g, 'm')}`,
    roomId: `${locationId}#cell_${String(cell.key).replace(/-/g, 'm')}`,
    pvpMode: cleanMode(mode)
  };
}

/** Режимы клеток карты (центр клетки 10 км) для публикации клиентам. */
function cellDangerModes(config, grid = {}, cells = {}, nodes = {}) {
  const out = {};
  const cellPoints = Math.max(1, Number(grid.cellPoints || 10));
  const pointKm = Number(grid.cellKm || 10) / cellPoints;
  for (const [key, cell] of Object.entries(cells || {})) {
    const [cx, cy] = key.split(':').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    // Мирная клетка данных (вода, закрытые места) остаётся мирной.
    if (cell?.pvpMode === 'peaceful') {
      out[key] = 'peaceful';
      continue;
    }
    const center = { x: (cx + 0.5) * cellPoints, y: (cy + 0.5) * cellPoints };
    out[key] = dangerModeAt(config, center, nodes, cell?.macroRegion || '', pointKm);
  }
  return out;
}

module.exports = {
  DANGER_MODES,
  DEFAULT_DANGER_CELL_CONFIG: DEFAULT_CONFIG,
  normalizeDangerCellConfig,
  dangerModeAt,
  subCellAt,
  encounterChance,
  cellEncounter,
  cellDangerModes,
  subCellByIndex,
  isSceneMode,
  neighbourCell,
  entryKeyForDirection,
  directionBetween,
  boundaryPoint,
  minHostilesFor
};
