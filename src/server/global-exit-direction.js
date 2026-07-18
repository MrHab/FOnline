'use strict';

const GLOBAL_EXIT_VECTORS = Object.freeze({
  north: Object.freeze({ x: 0, y: -1 }),
  south: Object.freeze({ x: 0, y: 1 }),
  west: Object.freeze({ x: -1, y: 0 }),
  east: Object.freeze({ x: 1, y: 0 })
});

function normalizeGlobalExitDirection(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GLOBAL_EXIT_VECTORS, key) ? key : '';
}

function globalExitDirectionFromTile(tile = {}, mapWidth = 0, mapHeight = 0) {
  const width = Math.max(1, Math.floor(Number(mapWidth) || 0));
  const height = Math.max(1, Math.floor(Number(mapHeight) || 0));
  const tx = Math.max(0, Math.min(width - 1, Number(tile.tx) || 0));
  const tz = Math.max(0, Math.min(height - 1, Number(tile.tz) || 0));
  const candidates = [
    { direction: 'north', distance: tz },
    { direction: 'south', distance: height - 1 - tz },
    { direction: 'west', distance: tx },
    { direction: 'east', distance: width - 1 - tx }
  ];
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].direction;
}

function directedGlobalExitPoint(center = null, direction = '', distance = 0, bounds = {}) {
  if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null;
  const vector = GLOBAL_EXIT_VECTORS[normalizeGlobalExitDirection(direction)];
  if (!vector) return null;
  const offset = Math.max(0, Number(distance) || 0);
  const width = Math.max(0, Number(bounds.width) || 0);
  const height = Math.max(0, Number(bounds.height) || 0);
  return {
    x: Math.max(0, Math.min(width, Number(center.x) + vector.x * offset)),
    y: Math.max(0, Math.min(height, Number(center.y) + vector.y * offset))
  };
}

module.exports = {
  GLOBAL_EXIT_VECTORS,
  normalizeGlobalExitDirection,
  globalExitDirectionFromTile,
  directedGlobalExitPoint
};
