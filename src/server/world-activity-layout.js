'use strict';

const DEFAULT_PATTERNS = [
  [0.16, 0.18], [0.84, 0.18], [0.5, 0.5], [0.18, 0.84],
  [0.84, 0.82], [0.5, 0.14], [0.5, 0.86], [0.14, 0.5], [0.86, 0.5]
];
const ENCOUNTER_DIRECTIONS = Object.freeze([
  Object.freeze({ id: 'north', label: 'СЕВЕР' }),
  Object.freeze({ id: 'east', label: 'ВОСТОК' }),
  Object.freeze({ id: 'south', label: 'ЮГ' }),
  Object.freeze({ id: 'west', label: 'ЗАПАД' })
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedBounds(bounds = {}) {
  const minX = Math.round(finite(bounds.minX));
  const minZ = Math.round(finite(bounds.minZ));
  const maxX = Math.max(minX, Math.round(finite(bounds.maxX, minX)));
  const maxZ = Math.max(minZ, Math.round(finite(bounds.maxZ, minZ)));
  return { minX, minZ, maxX, maxZ, width: maxX - minX + 1, height: maxZ - minZ + 1 };
}

function stableHash(value = '') {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function worldActivityPointCandidates(bounds = {}, margin = 2) {
  const area = normalizedBounds(bounds);
  const safeMargin = Math.max(0, Math.min(
    Math.floor(finite(margin, 2)),
    Math.floor((Math.min(area.width, area.height) - 1) / 3)
  ));
  const minX = area.minX + safeMargin;
  const maxX = area.maxX - safeMargin;
  const minZ = area.minZ + safeMargin;
  const maxZ = area.maxZ - safeMargin;
  const candidates = [];
  const keys = new Set();
  const add = (tx, tz) => {
    tx = Math.max(area.minX, Math.min(area.maxX, Math.round(tx)));
    tz = Math.max(area.minZ, Math.min(area.maxZ, Math.round(tz)));
    const key = `${tx}:${tz}`;
    if (keys.has(key)) return;
    keys.add(key);
    candidates.push({ tx, tz });
  };
  for (const [fx, fz] of DEFAULT_PATTERNS) {
    add(minX + (maxX - minX) * fx, minZ + (maxZ - minZ) * fz);
  }
  const step = Math.max(1, Math.floor(Math.min(area.width, area.height) / 7));
  for (let tz = minZ; tz <= maxZ; tz += step) {
    for (let tx = minX; tx <= maxX; tx += step) add(tx, tz);
  }
  add(maxX, maxZ);
  add(maxX, minZ);
  add(minX, maxZ);
  return candidates;
}

function createWorldActivityPointPositions(options = {}) {
  const count = Math.max(0, Math.floor(finite(options.count)));
  if (!count || typeof options.resolveSafeTile !== 'function') return [];
  const bounds = normalizedBounds(options.bounds);
  const toWorld = typeof options.tileToWorld === 'function'
    ? options.tileToWorld
    : (tx, tz) => ({ x: tx, z: tz });
  const candidates = worldActivityPointCandidates(bounds, options.margin ?? 2);
  const minSide = Math.max(1, Math.min(bounds.width, bounds.height));
  const adaptive = Math.max(1.25, Math.min(9, (minSide - 2) / Math.max(2, Math.ceil(Math.sqrt(count)))));
  const passes = [
    { minSpacing: 9, maxRadius: 8, resourceClearance: 1.4, containerClearance: 1.6, minEnemyDistance: 3 },
    { minSpacing: adaptive, maxRadius: 10, resourceClearance: 0.8, containerClearance: 1, minEnemyDistance: 2 },
    { minSpacing: Math.min(3, adaptive), maxRadius: 14, resourceClearance: 0, containerClearance: 0, minEnemyDistance: 1 },
    { minSpacing: 1.1, maxRadius: 18, resourceClearance: 0, containerClearance: 0, minEnemyDistance: 0 }
  ];
  const points = [];
  const used = new Set();
  for (const pass of passes) {
    for (const candidate of candidates) {
      if (points.length >= count) return points.slice(0, count);
      const safe = options.resolveSafeTile(candidate.tx, candidate.tz, pass);
      if (!safe) continue;
      const tx = Math.round(finite(safe.tx, candidate.tx));
      const tz = Math.round(finite(safe.tz, candidate.tz));
      const key = `${tx}:${tz}`;
      if (used.has(key)) continue;
      const position = toWorld(tx, tz) || {};
      const x = finite(position.x, tx);
      const z = finite(position.z, tz);
      if (points.some(point => Math.hypot(point.x - x, point.z - z) < pass.minSpacing)) continue;
      used.add(key);
      points.push({ tx, tz, x, z });
    }
  }
  return points.slice(0, count);
}

function createWorldActivityEncounterLayout(options = {}) {
  if (typeof options.resolveSafeTile !== 'function') return null;
  const bounds = normalizedBounds(options.bounds);
  const seed = String(options.seed || options.taskId || 'world_activity');
  const hash = stableHash(seed);
  const minSide = Math.max(1, Math.min(bounds.width, bounds.height));
  const margin = Math.max(1, Math.min(5, Math.floor(minSide / 6)));
  const focusFractions = [
    [0.42, 0.42], [0.58, 0.42], [0.58, 0.58], [0.42, 0.58]
  ];
  const focusCandidates = [];
  for (let offset = 0; offset < focusFractions.length; offset += 1) {
    const patternIndex = (hash + offset) % focusFractions.length;
    const pattern = focusFractions[patternIndex];
    const rawTx = Math.round(bounds.minX + (bounds.width - 1) * pattern[0]);
    const rawTz = Math.round(bounds.minZ + (bounds.height - 1) * pattern[1]);
    const safe = options.resolveSafeTile(rawTx, rawTz, {
      maxRadius: 12,
      radius: 0.5,
      resourceClearance: 0.6,
      containerClearance: 0.8,
      minEnemyDistance: 1
    });
    if (!safe) continue;
    const tx = Math.round(finite(safe.tx, rawTx));
    const tz = Math.round(finite(safe.tz, rawTz));
    const coverScore = typeof options.scoreFocusTile === 'function'
      ? finite(options.scoreFocusTile(tx, tz), 0)
      : 0;
    focusCandidates.push({ tx, tz, coverScore, order: offset });
  }
  focusCandidates.sort((left, right) => right.coverScore - left.coverScore || left.order - right.order);
  const focusSafe = focusCandidates[0];
  if (!focusSafe) return null;
  const focusTx = focusSafe.tx;
  const focusTz = focusSafe.tz;
  const toWorld = typeof options.tileToWorld === 'function'
    ? options.tileToWorld
    : (tx, tz) => ({ x: tx, z: tz });
  const focusWorld = toWorld(focusTx, focusTz) || {};
  const zoneRadius = clamp(Math.floor(minSide * 0.23), 5, 13);
  const objectiveBounds = normalizedBounds({
    minX: clamp(focusTx - zoneRadius, bounds.minX + margin, bounds.maxX - margin),
    minZ: clamp(focusTz - zoneRadius, bounds.minZ + margin, bounds.maxZ - margin),
    maxX: clamp(focusTx + zoneRadius, bounds.minX + margin, bounds.maxX - margin),
    maxZ: clamp(focusTz + zoneRadius, bounds.minZ + margin, bounds.maxZ - margin)
  });

  const rawLanes = [
    { id: 'north', label: 'СЕВЕР', tx: focusTx, tz: bounds.minZ + margin },
    { id: 'east', label: 'ВОСТОК', tx: bounds.maxX - margin, tz: focusTz },
    { id: 'south', label: 'ЮГ', tx: focusTx, tz: bounds.maxZ - margin },
    { id: 'west', label: 'ЗАПАД', tx: bounds.minX + margin, tz: focusTz }
  ];
  const lanes = [];
  for (const raw of rawLanes) {
    const safe = options.resolveSafeTile(raw.tx, raw.tz, {
      maxRadius: 12,
      radius: 0.46,
      resourceClearance: 0,
      containerClearance: 0,
      minEnemyDistance: 1.25,
      minPlayerDistance: Math.min(7, Math.max(2.5, minSide * 0.25))
    });
    if (!safe) continue;
    const tx = Math.round(finite(safe.tx, raw.tx));
    const tz = Math.round(finite(safe.tz, raw.tz));
    const world = toWorld(tx, tz) || {};
    if (Math.hypot(tx - focusTx, tz - focusTz) < Math.max(1.5, Math.min(4, zoneRadius * 0.35))) continue;
    if (lanes.some(row => Math.hypot(row.tx - tx, row.tz - tz) < Math.max(2.5, Math.min(4, minSide * 0.3)))) continue;
    lanes.push({
      id: raw.id,
      label: raw.label,
      tx,
      tz,
      x: finite(world.x, tx),
      z: finite(world.z, tz)
    });
  }
  if (!lanes.length) return null;

  const northWorld = toWorld(focusTx, bounds.minZ) || {};
  const eastWorld = toWorld(bounds.maxX, focusTz) || {};
  const southWorld = toWorld(focusTx, bounds.maxZ) || {};
  const westWorld = toWorld(bounds.minX, focusTz) || {};
  const edgeRadius = Math.min(
    Math.abs(finite(focusWorld.z, focusTz) - finite(northWorld.z, bounds.minZ)),
    Math.abs(finite(eastWorld.x, bounds.maxX) - finite(focusWorld.x, focusTx)),
    Math.abs(finite(southWorld.z, bounds.maxZ) - finite(focusWorld.z, focusTz)),
    Math.abs(finite(focusWorld.x, focusTx) - finite(westWorld.x, bounds.minX))
  );

  return {
    schema: 'realm.worldActivityEncounter.v1',
    seedOffset: hash % lanes.length,
    focus: {
      tx: focusTx,
      tz: focusTz,
      x: finite(focusWorld.x, focusTx),
      z: finite(focusWorld.z, focusTz),
      radius: Number(Math.max(4, Math.min(zoneRadius * 2, edgeRadius)).toFixed(2))
    },
    objectiveBounds,
    lanes,
    activeLaneId: '',
    waveNumber: 0,
    waveCount: 3,
    revision: 1
  };
}

function selectWorldActivityEncounterWave(activity = {}, layout = null) {
  if (!layout || !Array.isArray(layout.lanes) || !layout.lanes.length) return null;
  const attackers = (Array.isArray(activity.objectives) ? activity.objectives : [])
    .find(row => String(row?.id || '') === 'attackers' && row.required !== false);
  if (!attackers) return null;
  const current = Math.max(0, Math.floor(finite(attackers.current)));
  const target = Math.max(1, Math.floor(finite(attackers.target, 1)));
  const maximum = Math.max(target, Math.floor(finite(attackers.maxTarget, target)));
  if (current >= maximum) return null;
  const waveCount = Math.min(4, Math.max(1, Math.min(layout.lanes.length, 3)));
  const mainSpan = Math.max(1, Math.ceil(target / waveCount));
  const waveNumber = current < target
    ? Math.min(waveCount, Math.floor(current / mainSpan) + 1)
    : Math.min(waveCount + 1, waveCount + Math.floor((current - target) / Math.max(1, maximum - target)));
  const laneIndex = (Math.max(0, Math.floor(finite(layout.seedOffset))) + waveNumber - 1)
    % layout.lanes.length;
  return {
    waveNumber,
    waveCount,
    lane: layout.lanes[laneIndex]
  };
}

module.exports = {
  ENCOUNTER_DIRECTIONS,
  normalizedBounds,
  worldActivityPointCandidates,
  createWorldActivityPointPositions,
  createWorldActivityEncounterLayout,
  selectWorldActivityEncounterWave
};
