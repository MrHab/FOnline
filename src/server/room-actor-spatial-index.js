'use strict';

const DEFAULT_CELL_SIZE = 8;

function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function spatialCellCoordinate(value, cellSize) {
  return Math.floor(Number(value) / cellSize);
}

function spatialCellKey(cellX, cellZ) {
  return `${cellX},${cellZ}`;
}

function defaultLivingActorPredicate(actor) {
  if (!actor || typeof actor !== 'object' || actor.dead === true || actor._removed === true) return false;
  const x = Number(actor.x);
  const z = Number(actor.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Object.prototype.hasOwnProperty.call(actor, 'hp')) {
    const hp = Number(actor.hp);
    if (Number.isFinite(hp) && hp <= 0) return false;
  }
  return true;
}

function actorIterable(actors) {
  if (actors instanceof Map) return actors.values();
  if (actors && typeof actors[Symbol.iterator] === 'function') return actors;
  throw new TypeError('actors must be a Map or iterable');
}

function actorId(actor) {
  const id = String(actor?.id || '');
  return id || '';
}

/**
 * Builds a point-based, uniform-grid broad phase for room actors.
 *
 * Actors keep their source iteration order. Repeated objects and repeated
 * non-empty ids are indexed once, with the first occurrence winning. The
 * returned index is a snapshot of cell membership: rebuild it after actors
 * move, while exact collision/visibility checks continue to use live objects.
 */
function buildRoomActorSpatialIndex(actors, options = {}) {
  const cellSize = positiveFinite(options.cellSize, DEFAULT_CELL_SIZE);
  const queryPadding = nonNegativeFinite(options.padding, 0);
  const isLiving = typeof options.isLiving === 'function'
    ? options.isLiving
    : defaultLivingActorPredicate;
  const cells = new Map();
  const records = [];
  const seenActors = new Set();
  const seenIds = new Set();

  for (const actor of actorIterable(actors)) {
    if (!actor || typeof actor !== 'object' || seenActors.has(actor)) continue;
    const id = actorId(actor);
    if (id && seenIds.has(id)) continue;
    if (!isLiving(actor)) continue;
    seenActors.add(actor);
    if (id) seenIds.add(id);

    const x = Number(actor.x);
    const z = Number(actor.z);
    const cellX = spatialCellCoordinate(x, cellSize);
    const cellZ = spatialCellCoordinate(z, cellSize);
    const key = spatialCellKey(cellX, cellZ);
    const record = { actor, id, order: records.length, cellX, cellZ };
    records.push(record);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(record);
  }

  return {
    cellSize,
    queryPadding,
    cells,
    records,
    size: records.length,
    cellCount: cells.size,
    isLiving
  };
}

function normalizedExclusions(options = {}) {
  const excludedActors = new Set();
  const excludedIds = new Set();
  const addActor = actor => {
    if (actor && typeof actor === 'object') excludedActors.add(actor);
  };
  const addId = id => {
    const normalized = String(id || '');
    if (normalized) excludedIds.add(normalized);
  };

  addActor(options.excludeActor);
  addId(options.excludeId);
  if (options.exclude && typeof options.exclude === 'object') addActor(options.exclude);
  else addId(options.exclude);
  if (options.excludeActors && typeof options.excludeActors[Symbol.iterator] === 'function') {
    for (const actor of options.excludeActors) addActor(actor);
  }
  if (typeof options.excludeIds === 'string') addId(options.excludeIds);
  else if (options.excludeIds && typeof options.excludeIds[Symbol.iterator] === 'function') {
    for (const id of options.excludeIds) addId(id);
  }
  return { excludedActors, excludedIds };
}

/**
 * Returns a deterministic superset of actors inside the requested radius.
 * False positives from boundary cells are intentional: callers perform their
 * existing exact narrow-phase test against this much smaller candidate list.
 */
function queryRoomActorSpatialIndex(index, x, z, radius, options = {}) {
  if (!index || !(index.cells instanceof Map)) throw new TypeError('index must be built by buildRoomActorSpatialIndex');
  const centerX = Number(x);
  const centerZ = Number(z);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) return [];

  const baseRadius = nonNegativeFinite(radius, 0);
  const padding = Object.prototype.hasOwnProperty.call(options, 'padding')
    ? nonNegativeFinite(options.padding, 0)
    : nonNegativeFinite(index.queryPadding, 0);
  const reach = baseRadius + padding;
  const cellSize = positiveFinite(index.cellSize, DEFAULT_CELL_SIZE);
  const minCellX = spatialCellCoordinate(centerX - reach, cellSize);
  const maxCellX = spatialCellCoordinate(centerX + reach, cellSize);
  const minCellZ = spatialCellCoordinate(centerZ - reach, cellSize);
  const maxCellZ = spatialCellCoordinate(centerZ + reach, cellSize);
  const { excludedActors, excludedIds } = normalizedExclusions(options);
  const byOrder = new Map();

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const records = index.cells.get(spatialCellKey(cellX, cellZ));
      if (!records) continue;
      for (const record of records) {
        const actor = record.actor;
        if (byOrder.has(record.order)
          || excludedActors.has(actor)
          || (record.id && excludedIds.has(record.id))
          || !index.isLiving(actor)) continue;
        byOrder.set(record.order, actor);
      }
    }
  }

  return [...byOrder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, actor]) => actor);
}

module.exports = {
  DEFAULT_CELL_SIZE,
  buildRoomActorSpatialIndex,
  defaultLivingActorPredicate,
  queryRoomActorSpatialIndex,
  spatialCellCoordinate,
  spatialCellKey
};
