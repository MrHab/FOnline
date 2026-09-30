'use strict';

// Радиационная буря выброса. Выброс — не вспышка сразу над всем миром, а полоса
// бури, которая выходит из-за границы мира со случайной стороны и проходит
// карту насквозь. Путь бури — чистая функция цикла сдвига (shift-cycle.js):
// направление и рваная кромка берутся из hash32(shiftId), положение фронта —
// из времени. Сервер отдаёт клиенту те же параметры, и клиент рисует фронт у
// себя в зоне и на карте мира по той же формуле (RoaRadiationStormMath.cs).
//
// Координаты карты — километры: x на восток, y на юг (data/global-map.json).
// Фаза warning — буря ползёт к краю мира из-за границы, active — идёт через
// карту (передняя кромка касается мира в начале фазы, задняя уходит с карты в
// конце), afterglow — буря ушла за противоположный край.

const { hash32 } = require('./shift-cycle');

// Три гармоники рваной кромки: доля амплитуды и длина волны вдоль фронта, км.
const WAVES = Object.freeze([
  Object.freeze({ share: 0.6, lengthKm: 150 }),
  Object.freeze({ share: 0.3, lengthKm: 64 }),
  Object.freeze({ share: 0.1, lengthKm: 27 })
]);
// Масштаб места (поселения, логова): как у зоны — 320 м сцены на 20 км карты.
const PLACE_KM_PER_METRE = 20 / 320;
const LEAD_WALL_KM = 4;
const TRAIL_FADE_KM = 12;

function clamp(value, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeBounds(bounds = {}) {
  const minX = Number.isFinite(Number(bounds.minX)) ? Number(bounds.minX) : 0;
  const minY = Number.isFinite(Number(bounds.minY)) ? Number(bounds.minY) : 0;
  const maxX = Math.max(minX + 1, Number.isFinite(Number(bounds.maxX)) ? Number(bounds.maxX) : 380);
  const maxY = Math.max(minY + 1, Number.isFinite(Number(bounds.maxY)) ? Number(bounds.maxY) : 300);
  return { minX, minY, maxX, maxY };
}

/** Смещение кромки (км) в точке q вдоль фронта; edge — 'lead' или 'trail'. */
function waveOffset(storm, q, edge = 'lead') {
  let offset = 0;
  for (const wave of storm?.waves || []) {
    offset += wave.amp * Math.sin(wave.k * q + (edge === 'trail' ? wave.trail : wave.lead));
  }
  return offset;
}

/** Передняя линия бури (км вдоль направления движения) в момент now. */
function leadLineKm(storm, now = Date.now()) {
  return storm.lead0Km + storm.speedKmPerSec * (Number(now) - storm.activeStartAt) / 1000;
}

/**
 * Где точка карты относительно бури в момент now:
 * inside — под бурей; intensity 0..1 — сила внутри (стена у передней кромки,
 * затухание к задней); aheadKm/etaMs — сколько до фронта, если буря ещё идёт к
 * точке; reachedAt/passedAt — когда передняя кромка дошла и задняя ушла.
 */
function sampleStorm(storm, x, y, now = Date.now()) {
  if (!storm) return { inside: false, intensity: 0, aheadKm: Infinity, etaMs: Infinity, reachedAt: 0, passedAt: 0 };
  const px = Number(x) || 0;
  const py = Number(y) || 0;
  const p = px * storm.dirX + py * storm.dirY;
  const q = -px * storm.dirY + py * storm.dirX;
  const line = leadLineKm(storm, now);
  const leadWave = waveOffset(storm, q, 'lead');
  const trailWave = waveOffset(storm, q, 'trail');
  const lead = line + leadWave;
  const trail = line - storm.widthKm + trailWave;
  const perMs = storm.speedKmPerSec / 1000;
  const reachedAt = Math.round(storm.activeStartAt + (p - leadWave - storm.lead0Km) / perMs);
  const passedAt = Math.round(storm.activeStartAt + (p - trailWave + storm.widthKm - storm.lead0Km) / perMs);
  if (p > lead) {
    const aheadKm = p - lead;
    return { inside: false, intensity: 0, aheadKm, etaMs: Math.round(aheadKm / perMs), reachedAt, passedAt };
  }
  if (p < trail) return { inside: false, intensity: 0, aheadKm: 0, etaMs: 0, reachedAt, passedAt };
  const wall = 0.45 + 0.55 * smoothstep(0, LEAD_WALL_KM, lead - p);
  const tail = 0.35 + 0.65 * smoothstep(0, TRAIL_FADE_KM, p - trail);
  return { inside: true, intensity: round(Math.min(wall, tail), 3), aheadKm: 0, etaMs: 0, reachedAt, passedAt };
}

/**
 * Буря цикла сдвига. cycle — createShiftCycle(...); config — shift.storm из
 * data/artifacts.json; bounds — прямоугольник мира в километрах карты.
 */
function createRadiationStorm(cycle, config = {}, bounds = {}) {
  const box = normalizeBounds(bounds);
  const widthKm = clamp(config.widthKm ?? 60, 10, 200);
  const waveKm = clamp(config.waveKm ?? 10, 0, widthKm / 3);
  const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.minX, box.maxY], [box.maxX, box.maxY]];

  function timeline(state) {
    const cycleStart = Number(state.phaseStartedAt || 0) - phaseOffset(state.phase);
    const activeStartAt = cycleStart + cycle.cycleMs - cycle.afterglowMs - cycle.activeMs;
    return {
      warningStartAt: activeStartAt - cycle.warningMs,
      activeStartAt,
      activeEndAt: activeStartAt + cycle.activeMs,
      afterglowEndAt: cycleStart + cycle.cycleMs
    };
  }

  // Смещение начала фазы от начала цикла: так начало цикла выводится из
  // phaseStartedAt, и буря не зависит от эпохи цикла.
  function phaseOffset(phase) {
    const warningStart = cycle.cycleMs - cycle.warningMs - cycle.activeMs - cycle.afterglowMs;
    if (phase === 'warning') return warningStart;
    if (phase === 'active') return warningStart + cycle.warningMs;
    if (phase === 'afterglow') return warningStart + cycle.warningMs + cycle.activeMs;
    return 0;
  }

  /** Буря для состояния цикла; в спокойную фазу — только с forecast (ранний прогноз). */
  function fromShift(state = {}, options = {}) {
    if (!state || !state.shiftId) return null;
    if (state.phase === 'calm' && options.forecast !== true) return null;
    const id = String(state.shiftId);
    const angle = (hash32(`${id}:storm:heading`) % 36000) / 36000 * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const along = corners.map(([x, y]) => x * dirX + y * dirY);
    const pMin = Math.min(...along);
    const pMax = Math.max(...along);
    const waves = WAVES.map((wave, index) => ({
      amp: round(waveKm * wave.share, 3),
      k: round(Math.PI * 2 / wave.lengthKm, 6),
      lead: round((hash32(`${id}:storm:lead:${index}`) % 6283) / 1000, 3),
      trail: round((hash32(`${id}:storm:trail:${index}`) % 6283) / 1000, 3)
    }));
    const times = timeline(state);
    // Передняя кромка (с самым выпуклым горбом) касается мира в начале
    // активной фазы, задняя (с самой глубокой впадиной) покидает его в конце.
    const lead0Km = pMin - waveKm;
    const travelKm = (pMax + waveKm + widthKm) - lead0Km;
    const speedKmPerSec = travelKm / (cycle.activeMs / 1000);
    return {
      id,
      strength: clamp(Math.floor(Number(state.strength || 1)), 1, 3),
      phase: String(state.phase || 'calm'),
      dirX: round(dirX, 6),
      dirY: round(dirY, 6),
      headingDeg: round(angle * 180 / Math.PI, 2),
      widthKm,
      waveKm,
      waves,
      lead0Km: round(lead0Km, 4),
      speedKmPerSec: round(speedKmPerSec, 6),
      warningStartAt: times.warningStartAt,
      activeStartAt: times.activeStartAt,
      activeEndAt: times.activeEndAt,
      afterglowEndAt: times.afterglowEndAt,
      bounds: { ...box }
    };
  }

  function at(now = Date.now(), options = {}) {
    return fromShift(cycle.state(now), options);
  }

  return { at, fromShift, widthKm, waveKm, bounds: box };
}

// Рамка сцены: как точка (x, z) сцены ложится на карту. gx = ox + x·kx,
// gy = oy + z·kz. Сектор (зона 320 м, город 160 м) занимает свою клетку
// графа 20×20 км; север сектора — малые tz, то есть −Z (так стоят ворота и так
// сервер переводит через край), поэтому kz > 0. Место — точка карты со своей
// Unity-сценой (север = +Z), в масштабе зоны.
function sectorFrame(col, row, zoneKm = 20, widthM = 320, depthM = 320) {
  const size = Math.max(1, Number(zoneKm) || 20);
  return {
    ox: round((Number(col) + 0.5) * size, 4),
    oy: round((Number(row) + 0.5) * size, 4),
    kx: round(size / Math.max(1, Number(widthM) || 320), 6),
    kz: round(size / Math.max(1, Number(depthM) || 320), 6)
  };
}

function placeFrame(x, y) {
  return {
    ox: round(Number(x) || 0, 4),
    oy: round(Number(y) || 0, 4),
    kx: round(PLACE_KM_PER_METRE, 6),
    kz: round(-PLACE_KM_PER_METRE, 6)
  };
}

function localToGlobal(frame, x = 0, z = 0) {
  if (!frame) return null;
  return { x: frame.ox + (Number(x) || 0) * frame.kx, y: frame.oy + (Number(z) || 0) * frame.kz };
}

/** Что игрок знает о буре: параметры пути, рамка его сцены и что над ним сейчас. */
function publicStorm(storm, frame = null, here = null) {
  if (!storm) return null;
  const view = {
    ...storm,
    waves: storm.waves.map(wave => ({ ...wave })),
    bounds: { ...storm.bounds },
    frame: frame ? { ...frame } : null
  };
  if (here) {
    view.here = {
      inside: !!here.inside,
      intensity: round(here.intensity || 0, 3),
      aheadKm: Number.isFinite(here.aheadKm) ? round(here.aheadKm, 2) : -1,
      etaSeconds: Number.isFinite(here.etaMs) ? Math.max(0, Math.round(here.etaMs / 1000)) : -1,
      passed: !here.inside && here.aheadKm === 0
    };
  }
  return view;
}

module.exports = {
  PLACE_KM_PER_METRE,
  createRadiationStorm,
  leadLineKm,
  localToGlobal,
  placeFrame,
  publicStorm,
  sampleStorm,
  sectorFrame,
  waveOffset
};
