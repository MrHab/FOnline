'use strict';

const { clamp } = require('./wasteland-sim-utils');

function mapPointKm(globalMap = {}) {
  const grid = globalMap.grid || {};
  const cellKm = clamp(grid.cellKm || 10, 1, 100);
  const cellPoints = clamp(grid.cellPoints || 30, 1, 500);
  return cellKm / cellPoints;
}

function mapNode(globalMap = {}, id = '') {
  return (Array.isArray(globalMap.nodes) ? globalMap.nodes : []).find(node => String(node?.id || '') === id) || null;
}

function globalMapCellCenter(point = {}, globalMap = {}) {
  const grid = globalMap.grid || {};
  const cols = Math.max(1, Math.round(Number(grid.cols || 30)));
  const rows = Math.max(1, Math.round(Number(grid.rows || 30)));
  const cellPoints = Math.max(1, Math.round(Number(grid.cellPoints || 30)));
  const maxX = cols * cellPoints;
  const maxY = rows * cellPoints;
  const px = clamp(point.x, 0, Math.max(0, maxX - 0.001));
  const py = clamp(point.y, 0, Math.max(0, maxY - 0.001));
  const cx = clamp(Math.floor(px / cellPoints), 0, cols - 1);
  const cy = clamp(Math.floor(py / cellPoints), 0, rows - 1);
  return {
    x: Math.round((cx + 0.5) * cellPoints),
    y: Math.round((cy + 0.5) * cellPoints)
  };
}

function pointDistanceKm(a = {}, b = {}, globalMap = {}) {
  const dx = Number(a.x || 0) - Number(b.x || 0);
  const dy = Number(a.y || 0) - Number(b.y || 0);
  return Math.hypot(dx, dy) * mapPointKm(globalMap);
}

function globalMapLocationRadiusKm(globalMap = {}) {
  const grid = globalMap.grid || {};
  const cellPoints = clamp(Number(grid.cellPoints || 30), 1, 500);
  return Math.max(1, cellPoints * 0.5 * mapPointKm(globalMap));
}

function siteEntryRadiusKm(site = {}, globalMap = {}) {
  const explicit = Number(site.entryRadiusKm || site.radiusKm || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(0.5, explicit);
  return globalMapLocationRadiusKm(globalMap);
}

module.exports = {
  globalMapCellCenter,
  globalMapLocationRadiusKm,
  mapNode,
  mapPointKm,
  pointDistanceKm,
  siteEntryRadiusKm
};
