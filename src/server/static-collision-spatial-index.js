'use strict';

const DEFAULT_CELL_SIZE = 8;
const MAX_BLOCKER_CELL_REFERENCES = 16_384;
const MAX_INDEX_CELL_REFERENCES = 1_000_000;
const MAX_QUERY_CELL_REFERENCES = 65_536;

function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteCollisionNumber(value, field = 'collision value') {
  // Match the legacy narrow phase's `Number(value || 0)` coercion, but reject
  // non-finite authored values so the server can fall back to its full scan.
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new RangeError(`${field} must be finite`);
  return number;
}

function cellCoordinate(value, cellSize) {
  const coordinate = Math.floor(finiteCollisionNumber(value, 'cell coordinate') / cellSize);
  if (!Number.isSafeInteger(coordinate)) throw new RangeError('cell coordinate exceeds the safe integer range');
  return coordinate;
}

function cellKey(cellX, cellZ) {
  return `${cellX},${cellZ}`;
}

function staticCollisionBlockerBounds(blocker = {}) {
  const x = finiteCollisionNumber(blocker.x, 'blocker.x');
  const z = finiteCollisionNumber(blocker.z, 'blocker.z');
  const halfX = Math.max(0.01, finiteCollisionNumber(blocker.halfX, 'blocker.halfX'));
  const halfZ = Math.max(0.01, finiteCollisionNumber(blocker.halfZ, 'blocker.halfZ'));
  const rotation = finiteCollisionNumber(blocker.rotationY, 'blocker.rotationY');
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  // Conservative world-space AABB for the rotated narrow-phase rectangle.
  const extentX = cos * halfX + sin * halfZ;
  const extentZ = sin * halfX + cos * halfZ;
  const bounds = {
    minX: x - extentX,
    maxX: x + extentX,
    minZ: z - extentZ,
    maxZ: z + extentZ
  };
  if (Object.values(bounds).some(value => !Number.isFinite(value))) {
    throw new RangeError('derived blocker bounds must be finite');
  }
  return bounds;
}

function buildStaticCollisionSpatialIndex(blockers, options = {}) {
  if (!Array.isArray(blockers)) throw new TypeError('blockers must be an array');
  const cellSize = positiveFinite(options.cellSize, DEFAULT_CELL_SIZE);
  const cells = new Map();
  const records = [];
  let cellReferences = 0;

  blockers.forEach((blocker, order) => {
    if (!blocker || typeof blocker !== 'object') return;
    const bounds = staticCollisionBlockerBounds(blocker);
    const record = { blocker, order, ...bounds };
    records.push(record);
    const minCellX = cellCoordinate(bounds.minX, cellSize);
    const maxCellX = cellCoordinate(bounds.maxX, cellSize);
    const minCellZ = cellCoordinate(bounds.minZ, cellSize);
    const maxCellZ = cellCoordinate(bounds.maxZ, cellSize);
    const cellWidth = maxCellX - minCellX + 1;
    const cellHeight = maxCellZ - minCellZ + 1;
    const recordCellReferences = cellWidth * cellHeight;
    if (!Number.isSafeInteger(recordCellReferences)
      || recordCellReferences > MAX_BLOCKER_CELL_REFERENCES
      || cellReferences + recordCellReferences > MAX_INDEX_CELL_REFERENCES) {
      throw new RangeError('static collision index cell budget exceeded');
    }
    cellReferences += recordCellReferences;
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const key = cellKey(cellX, cellZ);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(record);
      }
    }
  });

  return {
    cellSize,
    cells,
    records,
    size: records.length,
    cellCount: cells.size
  };
}

function normalizedQueryBounds(minX, minZ, maxX, maxZ) {
  const left = finiteCollisionNumber(minX, 'query.minX');
  const right = finiteCollisionNumber(maxX, 'query.maxX');
  const top = finiteCollisionNumber(minZ, 'query.minZ');
  const bottom = finiteCollisionNumber(maxZ, 'query.maxZ');
  return {
    minX: Math.min(left, right),
    maxX: Math.max(left, right),
    minZ: Math.min(top, bottom),
    maxZ: Math.max(top, bottom)
  };
}

function boundsOverlap(left, right) {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minZ <= right.maxZ
    && left.maxZ >= right.minZ;
}

/**
 * Returns a deterministic superset of blockers overlapping a world-space AABB.
 * Callers retain their exact rotated-rectangle narrow phase, so this helper can
 * only remove impossible candidates and cannot change collision semantics.
 */
function queryStaticCollisionSpatialIndex(index, minX, minZ, maxX, maxZ) {
  if (!index || !(index.cells instanceof Map)) {
    throw new TypeError('index must be built by buildStaticCollisionSpatialIndex');
  }
  const query = normalizedQueryBounds(minX, minZ, maxX, maxZ);
  const cellSize = positiveFinite(index.cellSize, DEFAULT_CELL_SIZE);
  const minCellX = cellCoordinate(query.minX, cellSize);
  const maxCellX = cellCoordinate(query.maxX, cellSize);
  const minCellZ = cellCoordinate(query.minZ, cellSize);
  const maxCellZ = cellCoordinate(query.maxZ, cellSize);
  const cellWidth = maxCellX - minCellX + 1;
  const cellHeight = maxCellZ - minCellZ + 1;
  const queryCellReferences = cellWidth * cellHeight;
  if (!Number.isSafeInteger(queryCellReferences) || queryCellReferences > MAX_QUERY_CELL_REFERENCES) {
    throw new RangeError('static collision query cell budget exceeded');
  }
  const byOrder = new Map();

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const records = index.cells.get(cellKey(cellX, cellZ));
      if (!records) continue;
      for (const record of records) {
        if (!byOrder.has(record.order) && boundsOverlap(record, query)) {
          byOrder.set(record.order, record.blocker);
        }
      }
    }
  }

  return [...byOrder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, blocker]) => blocker);
}

module.exports = {
  DEFAULT_CELL_SIZE,
  MAX_BLOCKER_CELL_REFERENCES,
  MAX_INDEX_CELL_REFERENCES,
  MAX_QUERY_CELL_REFERENCES,
  buildStaticCollisionSpatialIndex,
  queryStaticCollisionSpatialIndex,
  staticCollisionBlockerBounds
};
