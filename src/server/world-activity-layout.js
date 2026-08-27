'use strict';

const DEFAULT_PATTERNS = [
  [0.16, 0.18], [0.84, 0.18], [0.5, 0.5], [0.18, 0.84],
  [0.84, 0.82], [0.5, 0.14], [0.5, 0.86], [0.14, 0.5], [0.86, 0.5]
];

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

module.exports = {
  worldActivityPointCandidates,
  createWorldActivityPointPositions
};