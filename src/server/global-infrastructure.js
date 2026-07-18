'use strict';

const DEFAULT_GRID = Object.freeze({ cols: 30, rows: 30, cellPoints: 30, cellKm: 10 });
const WATER_TEXTURES = new Set(['water', 'ocean', 'sea', 'lake']);
const COASTLINE = [
  { x: 0.105, y: 0.00 }, { x: 0.070, y: 0.08 }, { x: 0.082, y: 0.16 }, { x: 0.055, y: 0.25 },
  { x: 0.106, y: 0.36 }, { x: 0.090, y: 0.48 }, { x: 0.142, y: 0.62 }, { x: 0.126, y: 0.73 },
  { x: 0.184, y: 0.86 }, { x: 0.154, y: 1.00 }
];

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function infrastructureGrid(globalMap = {}) {
  const source = globalMap?.grid || DEFAULT_GRID;
  const cols = clamp(Math.round(Number(source.cols || DEFAULT_GRID.cols)), 4, 80);
  const rows = clamp(Math.round(Number(source.rows || DEFAULT_GRID.rows)), 4, 80);
  const cellPoints = clamp(Math.round(Number(source.cellPoints || DEFAULT_GRID.cellPoints)), 4, 200);
  const cellKm = clamp(Number(source.cellKm || DEFAULT_GRID.cellKm), 1, 100);
  return { cols, rows, cellPoints, cellKm, width: cols * cellPoints, height: rows * cellPoints };
}

function sanitizeInfrastructurePoint(input = null, grid = DEFAULT_GRID) {
  if (!input || typeof input !== 'object') return null;
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number(grid.width || Number(grid.cols || DEFAULT_GRID.cols) * Number(grid.cellPoints || DEFAULT_GRID.cellPoints));
  const height = Number(grid.height || Number(grid.rows || DEFAULT_GRID.rows) * Number(grid.cellPoints || DEFAULT_GRID.cellPoints));
  return { x: clamp(x, 0, width), y: clamp(y, 0, height) };
}

function normalizeGlobalInfrastructure(rows = [], globalMap = {}) {
  const grid = infrastructureGrid(globalMap);
  const nodes = new Map((Array.isArray(globalMap?.nodes) ? globalMap.nodes : [])
    .filter(Boolean)
    .map(node => [String(node.id || node.locationId || ''), node]));
  const result = [];
  for (const [index, source] of (Array.isArray(rows) ? rows : []).slice(0, 64).entries()) {
    if (!source || typeof source !== 'object') continue;
    const id = String(source.id || `infrastructure_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const type = String(source.type || source.kind || 'road').toLowerCase() === 'pipeline' ? 'pipeline' : 'road';
    const points = [];
    for (const rawPoint of (Array.isArray(source.points) ? source.points : []).slice(0, 96)) {
      const nodeId = String(rawPoint?.nodeId || rawPoint?.node || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const point = sanitizeInfrastructurePoint(nodeId && nodes.has(nodeId) ? nodes.get(nodeId) : rawPoint, grid);
      if (!point) continue;
      const previous = points[points.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.01) continue;
      points.push(point);
    }
    if (!id || points.length < 2) continue;
    const defaultFactor = type === 'pipeline' ? 0.78 : 0.62;
    const defaultWidth = type === 'pipeline' ? 4.2 : 8.0;
    result.push({
      id,
      name: String(source.name || id).replace(/[<>]/g, '').trim().slice(0, 96),
      type,
      model: String(source.model || (type === 'pipeline' ? 'service_pipeline' : 'broken_asphalt')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48),
      walkable: source.walkable !== false,
      travelFactor: clamp(source.travelFactor ?? defaultFactor, 0.35, 1.5),
      width: clamp(source.width ?? defaultWidth, 2, 18),
      points
    });
  }
  return result;
}

function pointDistance(a = null, b = null) {
  if (!a || !b) return Infinity;
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
}

function pointToSegmentDistance(point = null, from = null, to = null) {
  if (!point || !from || !to) return Infinity;
  const dx = Number(to.x || 0) - Number(from.x || 0);
  const dy = Number(to.y || 0) - Number(from.y || 0);
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) return pointDistance(point, from);
  const progress = clamp(
    ((Number(point.x || 0) - Number(from.x || 0)) * dx
      + (Number(point.y || 0) - Number(from.y || 0)) * dy) / lengthSquared,
    0,
    1
  );
  return pointDistance(point, {
    x: Number(from.x || 0) + dx * progress,
    y: Number(from.y || 0) + dy * progress
  });
}

function pointToInfrastructureDistance(point = null, row = {}) {
  const points = Array.isArray(row.points) ? row.points : [];
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    nearest = Math.min(nearest, pointToSegmentDistance(point, points[index - 1], points[index]));
  }
  return nearest;
}

function segmentToSegmentDistance(leftFrom = null, leftTo = null, rightFrom = null, rightTo = null) {
  if (!leftFrom || !leftTo || !rightFrom || !rightTo) return Infinity;
  const cross = (a, b, c) => (
    (Number(b.x || 0) - Number(a.x || 0)) * (Number(c.y || 0) - Number(a.y || 0))
    - (Number(b.y || 0) - Number(a.y || 0)) * (Number(c.x || 0) - Number(a.x || 0))
  );
  const leftA = cross(leftFrom, leftTo, rightFrom);
  const leftB = cross(leftFrom, leftTo, rightTo);
  const rightA = cross(rightFrom, rightTo, leftFrom);
  const rightB = cross(rightFrom, rightTo, leftTo);
  const epsilon = 0.000001;
  const intersects = (
    ((leftA > epsilon && leftB < -epsilon) || (leftA < -epsilon && leftB > epsilon) || Math.abs(leftA) <= epsilon || Math.abs(leftB) <= epsilon)
    && ((rightA > epsilon && rightB < -epsilon) || (rightA < -epsilon && rightB > epsilon) || Math.abs(rightA) <= epsilon || Math.abs(rightB) <= epsilon)
    && Math.max(Math.min(Number(leftFrom.x || 0), Number(leftTo.x || 0)), Math.min(Number(rightFrom.x || 0), Number(rightTo.x || 0)))
      <= Math.min(Math.max(Number(leftFrom.x || 0), Number(leftTo.x || 0)), Math.max(Number(rightFrom.x || 0), Number(rightTo.x || 0))) + epsilon
    && Math.max(Math.min(Number(leftFrom.y || 0), Number(leftTo.y || 0)), Math.min(Number(rightFrom.y || 0), Number(rightTo.y || 0)))
      <= Math.min(Math.max(Number(leftFrom.y || 0), Number(leftTo.y || 0)), Math.max(Number(rightFrom.y || 0), Number(rightTo.y || 0))) + epsilon
  );
  if (intersects) return 0;
  return Math.min(
    pointToSegmentDistance(leftFrom, rightFrom, rightTo),
    pointToSegmentDistance(leftTo, rightFrom, rightTo),
    pointToSegmentDistance(rightFrom, leftFrom, leftTo),
    pointToSegmentDistance(rightTo, leftFrom, leftTo)
  );
}

function infrastructureToInfrastructureDistance(left = {}, right = {}) {
  const leftPoints = Array.isArray(left.points) ? left.points : [];
  const rightPoints = Array.isArray(right.points) ? right.points : [];
  let nearest = Infinity;
  for (let leftIndex = 1; leftIndex < leftPoints.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < rightPoints.length; rightIndex += 1) {
      nearest = Math.min(nearest, segmentToSegmentDistance(
        leftPoints[leftIndex - 1],
        leftPoints[leftIndex],
        rightPoints[rightIndex - 1],
        rightPoints[rightIndex]
      ));
    }
  }
  return nearest;
}

function routeDistance(points = []) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += pointDistance(points[index - 1], points[index]);
  return total;
}

function coastlineXAtY(ny = 0) {
  const y = clamp(ny, 0, 1);
  if (y <= COASTLINE[0].y) return COASTLINE[0].x;
  for (let index = 0; index < COASTLINE.length - 1; index += 1) {
    const from = COASTLINE[index];
    const to = COASTLINE[index + 1];
    if (y > to.y) continue;
    const progress = (y - from.y) / Math.max(0.0001, to.y - from.y);
    return from.x + (to.x - from.x) * progress;
  }
  return COASTLINE[COASTLINE.length - 1].x;
}

function infrastructurePointIsWater(globalMap = {}, point = null) {
  const grid = infrastructureGrid(globalMap);
  const safe = sanitizeInfrastructurePoint(point, grid);
  if (!safe) return true;
  const nx = safe.x / Math.max(1, grid.width);
  const ny = safe.y / Math.max(1, grid.height);
  if (nx <= coastlineXAtY(ny)) return true;
  const cx = clamp(Math.floor(safe.x / grid.cellPoints), 0, grid.cols - 1);
  const cy = clamp(Math.floor(safe.y / grid.cellPoints), 0, grid.rows - 1);
  const texture = String(globalMap?.cells?.[`${cx}:${cy}`]?.texture || '').trim().toLowerCase();
  return WATER_TEXTURES.has(texture);
}

function infrastructureSegmentIsLand(globalMap = {}, from = null, to = null) {
  const distance = pointDistance(from, to);
  if (!Number.isFinite(distance)) return false;
  const steps = Math.max(1, Math.ceil(distance / 1.25));
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    if (infrastructurePointIsWater(globalMap, {
      x: Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * progress,
      y: Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * progress
    })) return false;
  }
  return true;
}

function sampleInfrastructureRoute(row = {}, spacing = 12) {
  const result = [];
  const points = Array.isArray(row.points) ? row.points : [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = pointDistance(from, to);
    const steps = Math.max(1, Math.ceil(distance / Math.max(3, spacing)));
    for (let step = 0; step <= steps; step += 1) {
      if (index > 1 && step === 0) continue;
      const progress = step / steps;
      result.push({
        x: Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * progress,
        y: Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * progress
      });
    }
  }
  return result;
}

function addGraphEdge(graph, fromId, toId, cost) {
  if (!graph.has(fromId) || !graph.has(toId) || !Number.isFinite(cost)) return;
  graph.get(fromId).edges.push({ id: toId, cost: Math.max(0.0001, cost) });
  graph.get(toId).edges.push({ id: fromId, cost: Math.max(0.0001, cost) });
}

function simplifyRoutePoints(points = []) {
  const compact = [];
  for (const point of points) {
    const previous = compact[compact.length - 1];
    if (!previous || pointDistance(previous, point) > 0.05) compact.push({ x: Number(point.x || 0), y: Number(point.y || 0) });
  }
  if (compact.length <= 2) return compact;
  const result = [compact[0]];
  for (let index = 1; index < compact.length - 1; index += 1) {
    const a = result[result.length - 1];
    const b = compact[index];
    const c = compact[index + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = Math.abs(abx * bcy - aby * bcx);
    const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(bcx, bcy));
    if (cross / scale > 0.0025) result.push(b);
  }
  result.push(compact[compact.length - 1]);
  return result;
}

function planInfrastructureRoute(globalMap = {}, fromPoint = null, toPoint = null, options = {}) {
  const grid = infrastructureGrid(globalMap);
  const from = sanitizeInfrastructurePoint(fromPoint, grid);
  const to = sanitizeInfrastructurePoint(toPoint, grid);
  if (!from || !to) return [];
  if (pointDistance(from, to) < 0.05) return [from, to];
  const infrastructure = normalizeGlobalInfrastructure(globalMap.infrastructure || [], globalMap)
    .filter(row => row.walkable && row.points.length >= 2);
  const graph = new Map();
  const infrastructureIds = [];
  const spacing = clamp(options.spacing || 12, 5, 30);
  const bias = clamp(options.infrastructureBias || 1, 0.65, 1.65);

  infrastructure.forEach(row => {
    const sampled = sampleInfrastructureRoute(row, spacing);
    let previousId = '';
    sampled.forEach((point, index) => {
      const id = `${row.id}:${index}`;
      graph.set(id, { id, point, routeId: row.id, edges: [] });
      infrastructureIds.push(id);
      if (previousId) {
        const distance = pointDistance(graph.get(previousId).point, point);
        if (infrastructureSegmentIsLand(globalMap, graph.get(previousId).point, point)) {
          addGraphEdge(graph, previousId, id, distance * row.travelFactor * bias);
        }
      }
      previousId = id;
    });
  });

  for (let left = 0; left < infrastructureIds.length; left += 1) {
    const leftNode = graph.get(infrastructureIds[left]);
    for (let right = left + 1; right < infrastructureIds.length; right += 1) {
      const rightNode = graph.get(infrastructureIds[right]);
      if (leftNode.routeId === rightNode.routeId) continue;
      const distance = pointDistance(leftNode.point, rightNode.point);
      if (distance <= 1.25) addGraphEdge(graph, leftNode.id, rightNode.id, Math.max(0.01, distance * 0.5));
    }
  }

  graph.set('start', { id: 'start', point: from, routeId: '', edges: [] });
  graph.set('finish', { id: 'finish', point: to, routeId: '', edges: [] });
  if (infrastructureSegmentIsLand(globalMap, from, to)) addGraphEdge(graph, 'start', 'finish', pointDistance(from, to));

  const connectEndpoint = (endpointId, point) => {
    const nearest = infrastructureIds
      .map(id => ({ id, distance: pointDistance(point, graph.get(id).point) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 32);
    for (const candidate of nearest) {
      const target = graph.get(candidate.id).point;
      if (!infrastructureSegmentIsLand(globalMap, point, target)) continue;
      addGraphEdge(graph, endpointId, candidate.id, candidate.distance);
    }
  };
  connectEndpoint('start', from);
  connectEndpoint('finish', to);

  const distanceById = new Map(Array.from(graph.keys(), id => [id, Infinity]));
  const previousById = new Map();
  const unvisited = new Set(graph.keys());
  distanceById.set('start', 0);
  while (unvisited.size) {
    let currentId = '';
    let currentDistance = Infinity;
    for (const id of unvisited) {
      const distance = distanceById.get(id);
      if (distance < currentDistance) {
        currentDistance = distance;
        currentId = id;
      }
    }
    if (!currentId || !Number.isFinite(currentDistance)) break;
    unvisited.delete(currentId);
    if (currentId === 'finish') break;
    for (const edge of graph.get(currentId).edges) {
      if (!unvisited.has(edge.id)) continue;
      const nextDistance = currentDistance + edge.cost;
      if (nextDistance + 0.0001 >= distanceById.get(edge.id)) continue;
      distanceById.set(edge.id, nextDistance);
      previousById.set(edge.id, currentId);
    }
  }

  if (!Number.isFinite(distanceById.get('finish'))) return [];
  const ids = [];
  let cursor = 'finish';
  while (cursor) {
    ids.push(cursor);
    if (cursor === 'start') break;
    cursor = previousById.get(cursor) || '';
  }
  if (ids[ids.length - 1] !== 'start') return [];
  ids.reverse();
  return simplifyRoutePoints(ids.map(id => graph.get(id).point));
}

function pointAtRouteProgress(points = [], progress = 0) {
  const route = Array.isArray(points) ? points.filter(Boolean) : [];
  if (!route.length) return null;
  if (route.length === 1) return { x: Number(route[0].x || 0), y: Number(route[0].y || 0) };
  const total = routeDistance(route);
  if (total <= 0.0001) return { x: Number(route[route.length - 1].x || 0), y: Number(route[route.length - 1].y || 0) };
  let remaining = total * clamp(progress, 0, 1);
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const distance = pointDistance(from, to);
    if (remaining > distance && index < route.length - 1) {
      remaining -= distance;
      continue;
    }
    const segmentProgress = distance > 0 ? clamp(remaining / distance, 0, 1) : 1;
    return {
      x: Number(from.x || 0) + (Number(to.x || 0) - Number(from.x || 0)) * segmentProgress,
      y: Number(from.y || 0) + (Number(to.y || 0) - Number(from.y || 0)) * segmentProgress
    };
  }
  return { x: Number(route[route.length - 1].x || 0), y: Number(route[route.length - 1].y || 0) };
}

module.exports = {
  infrastructureGrid,
  infrastructurePointIsWater,
  infrastructureSegmentIsLand,
  infrastructureToInfrastructureDistance,
  normalizeGlobalInfrastructure,
  planInfrastructureRoute,
  pointAtRouteProgress,
  pointDistance,
  pointToInfrastructureDistance,
  pointToSegmentDistance,
  routeDistance,
  sanitizeInfrastructurePoint,
  segmentToSegmentDistance
};
