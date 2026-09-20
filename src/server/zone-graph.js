'use strict';

// Граф зон мира: сетка 20‑километровых зон поверх карты 380×300 км. Зона берёт
// биом, сложность и цвет опасности у своих 10‑километровых клеток карты, соседей —
// по четырём сторонам, места — у узлов карты, дороги — у линий инфраструктуры.
// Модуль чистый: строит граф из данных, отвечает «какая зона в точке», «кто
// сосед», «как пройти» и выдаёт рецепт зоны для конструктора (zone-builder.js).

const { dangerModeAt } = require('./danger-cells');

const SCHEMA = 'kromka.zoneGraph.v1';
const GRAPH_VERSION = 1;
const ZONE_KM = 20;
const SIDES = Object.freeze({
  north: { dc: 0, dr: -1, opposite: 'south' },
  south: { dc: 0, dr: 1, opposite: 'north' },
  west: { dc: -1, dr: 0, opposite: 'east' },
  east: { dc: 1, dr: 0, opposite: 'west' }
});
const ALONG_MIN = 0.15;
const ALONG_MAX = 0.85;
// Решение 20.09.2026: синие зоны — только кольцо вокруг городов фракций: зона
// столицы мирная, соседние с ней зоны (квадрат 3×3) синие, дальше цвет по региону.
const BLUE_RING_ZONES = 1;

function pad(n) { return String(n).padStart(2, '0'); }
function zoneId(col, row) { return `z_${pad(col)}_${pad(row)}`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round3(value) { return Math.round(value * 1000) / 1000; }

function hash32(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    if (((ay > y) !== (by > y)) && (x < (bx - ax) * (y - ay) / (by - ay) + ax)) inside = !inside;
  }
  return inside;
}

function majority(values, tieBreak) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || tieBreak(b[0]) - tieBreak(a[0]) || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || '';
}

/** Где линия инфраструктуры пересекает общую сторону двух зон: доля вдоль стороны или null. */
function roadCrossing(points, vertical, line, from, to) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const [a1, b1] = vertical ? [a.x, b.x] : [a.y, b.y];
    if ((a1 - line) * (b1 - line) > 0 || a1 === b1) continue;
    const t = (line - a1) / (b1 - a1);
    const cross = vertical ? a.y + (b.y - a.y) * t : a.x + (b.x - a.x) * t;
    if (cross >= from && cross <= to) return (cross - from) / (to - from);
  }
  return null;
}

function buildZoneGraph({ globalMap, contour, dangerConfig, regionNames = {}, locationNames = {}, locationModes = {}, overrides = {} }) {
  const mapGrid = globalMap.grid;
  const cellKm = Number(mapGrid.cellKm || 10);
  const pointKm = cellKm / Number(mapGrid.cellPoints || 10);
  const cellsPerZone = Math.round(ZONE_KM / cellKm);
  const cols = Math.ceil(mapGrid.cols / cellsPerZone);
  const rows = Math.ceil(mapGrid.rows / cellsPerZone);
  const zonePoints = ZONE_KM / pointKm;
  const polygon = contour.points;
  const nodesById = {};
  for (const node of globalMap.nodes) nodesById[node.locationId || node.id] = { x: Number(node.x), y: Number(node.y) };
  const capitals = new Set(dangerConfig.capitals);
  // Синий пояс и мирный радиус опасных клеток считаются по сетке зон ниже, а не по километрам.
  const colourRules = { ...dangerConfig, capitals: [], blueExtraCenters: [] };
  const capitalCells = [...capitals].filter(id => nodesById[id]).map(id => ({
    col: clamp(Math.floor(nodesById[id].x / zonePoints), 0, cols - 1),
    row: clamp(Math.floor(nodesById[id].y / zonePoints), 0, rows - 1)
  }));
  const capitalDistance = (col, row) => Math.min(Infinity, ...capitalCells.map(cell => Math.max(Math.abs(cell.col - col), Math.abs(cell.row - row))));

  // Скрытые узлы (базы фракций Сердцевины) — места «только на выход»: входят в
  // них метро из узла Сердцевины, а их внешний выход ведёт в зону, где стоит узел.
  const placesByZone = new Map();
  for (const node of globalMap.nodes) {
    const col = clamp(Math.floor(node.x / zonePoints), 0, cols - 1);
    const row = clamp(Math.floor(node.y / zonePoints), 0, rows - 1);
    const locationId = node.locationId || node.id;
    const list = placesByZone.get(zoneId(col, row)) || [];
    list.push({
      locationId, kind: String(node.kind || ''), name: String(locationNames[locationId] || locationId),
      u: round3(clamp((node.x - col * zonePoints) / zonePoints, 0.08, 0.92)),
      v: round3(clamp((node.y - row * zonePoints) / zonePoints, 0.08, 0.92)),
      road: node.roadAccess === true,
      ...(node.hidden === true ? { hidden: true } : {})
    });
    placesByZone.set(zoneId(col, row), list);
  }

  const zones = new Map();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = zoneId(col, row);
      const centre = { x: (col + 0.5) * zonePoints, y: (row + 0.5) * zonePoints };
      const places = (placesByZone.get(id) || []).sort((a, b) => a.locationId.localeCompare(b.locationId));
      // Зона входит в мир, если её центр внутри играбельного контура или в ней стоит видимое место.
      if (!insidePolygon(polygon, centre.x, centre.y) && !places.some(place => !place.hidden)) {
        if (places.length) throw new Error(`zone graph: hidden place ${places[0].locationId} stands outside the world`);
        continue;
      }
      const cells = [];
      for (let dy = 0; dy < cellsPerZone; dy++) {
        for (let dx = 0; dx < cellsPerZone; dx++) {
          const cell = globalMap.cells[`${col * cellsPerZone + dx}:${row * cellsPerZone + dy}`];
          if (cell) cells.push(cell);
        }
      }
      const difficultyOf = region => Math.max(0, ...cells.filter(cell => cell.macroRegion === region).map(cell => Number(cell.difficulty || 0)));
      const region = majority(cells.map(cell => cell.macroRegion || ''), difficultyOf);
      const ring = capitalDistance(col, row);
      let mode = dangerModeAt(colourRules, centre, nodesById, region, pointKm);
      if (ring === 0) mode = 'peaceful';
      else if (ring <= BLUE_RING_ZONES && mode !== 'pvpBlack') mode = 'pve';
      zones.set(id, {
        id, col, row, n: 0, name: '', title: '', region, mode,
        difficulty: clamp(Math.round(cells.reduce((sum, cell) => sum + Number(cell.difficulty || 1), 0) / Math.max(1, cells.length)), 1, 5),
        ground: majority(cells.map(cell => cell.texture || ''), () => 0) || region,
        seed: hash32(`${globalMap.worldRevision || 'world'}:${id}`),
        edges: {}, roads: [], places, authored: false
      });
    }
  }

  // Город занимает сектор целиком: его локация и есть зона, ворота соседей ведут
  // прямо в неё, портала внутри сектора нет, а правила сектора — правила города.
  const cityIds = new Set((overrides.cities || []).filter(Boolean));
  const cityNames = new Map();
  for (const zone of zones.values()) {
    const city = zone.places.find(place => cityIds.has(place.locationId));
    if (!city) continue;
    const rest = zone.places.filter(place => place.locationId !== city.locationId);
    if (rest.length) {
      throw new Error(`zone graph: the city ${city.locationId} shares zone ${zone.id} with ${rest.map(place => place.locationId).join(', ')}`);
    }
    zone.city = city.locationId;
    zone.places = [];
    zone.mode = String(locationModes[city.locationId] || zone.mode);
    cityNames.set(zone.id, city.name);
  }

  [...zones.values()].sort((a, b) => a.row - b.row || a.col - b.col).forEach((zone, index) => {
    zone.n = index + 1;
    if (zone.city) {
      // У города своё имя и без номера: в воротах соседа игрок читает «Ключи».
      zone.name = String(cityNames.get(zone.id) || locationNames[zone.city] || zone.city);
      zone.title = zone.name;
      return;
    }
    zone.name = String(overrides.names?.[zone.id] || regionNames[zone.region] || zone.region);
    zone.title = `${zone.name} №${zone.n}`;
  });

  const closed = new Set((overrides.closedEdges || []).map(pair => String(pair).split('|').sort().join('|')));
  const roads = globalMap.infrastructure.filter(line => Array.isArray(line.points) && line.points.length > 1)
    .sort((a, b) => (a.type === 'road' ? 0 : 1) - (b.type === 'road' ? 0 : 1) || a.id.localeCompare(b.id));
  for (const zone of zones.values()) {
    for (const side of ['south', 'east']) {
      const step = SIDES[side];
      const other = zones.get(zoneId(zone.col + step.dc, zone.row + step.dr));
      if (!other) continue;
      const vertical = side === 'east';
      const line = vertical ? (zone.col + 1) * zonePoints : (zone.row + 1) * zonePoints;
      const from = vertical ? zone.row * zonePoints : zone.col * zonePoints;
      let road = '';
      let along = null;
      for (const candidate of roads) {
        const hit = roadCrossing(candidate.points, vertical, line, from, from + zonePoints);
        if (hit !== null) { road = candidate.id; along = hit; break; }
      }
      const pair = [zone.id, other.id].sort().join('|');
      const edge = {
        open: !closed.has(pair),
        along: round3(clamp(along ?? 0.25 + (hash32(`edge:${pair}`) % 1000) / 999 * 0.5, ALONG_MIN, ALONG_MAX)),
        ...(road ? { road } : {})
      };
      zone.edges[side] = { to: other.id, ...edge };
      other.edges[step.opposite] = { to: zone.id, ...edge };
      if (road && edge.open) {
        if (!zone.roads.includes(road)) zone.roads.push(road);
        if (!other.roads.includes(road)) other.roads.push(road);
      }
    }
  }
  for (const zone of zones.values()) {
    zone.roads.sort();
    zone.edges = Object.fromEntries(Object.keys(SIDES).filter(side => zone.edges[side]).map(side => [side, zone.edges[side]]));
  }

  const graph = {
    schema: SCHEMA, version: GRAPH_VERSION, worldRevision: String(globalMap.worldRevision || ''),
    grid: { cols, rows, zoneKm: ZONE_KM, cellsPerZone },
    capitals: [...capitals].filter(id => nodesById[id]).sort(),
    zones: [...zones.values()].sort((a, b) => a.n - b.n)
  };
  const lost = unreachableZones(graph);
  if (lost.length) throw new Error(`zone graph: ${lost.length} zones cannot be reached from a capital: ${lost.slice(0, 8).join(', ')}`);
  return graph;
}

function indexGraph(graph) {
  if (!graph.__index) Object.defineProperty(graph, '__index', { value: new Map(graph.zones.map(zone => [zone.id, zone])), enumerable: false });
  return graph.__index;
}

function zoneById(graph, id) { return indexGraph(graph).get(String(id)) || null; }

function neighbour(graph, id, side) {
  const edge = zoneById(graph, id)?.edges?.[side];
  return edge && edge.open ? zoneById(graph, edge.to) : null;
}

/** Локация сектора: у города — он сам, у обычной зоны — её сгенерированная локация. */
function zoneLocationId(zone) { return String(zone?.city || zone?.id || ''); }

/** Сектор по id его локации: принимает и `z_CC_RR`, и город («settlement»). */
function zoneOfLocation(graph, locationId) {
  const id = String(locationId || '');
  return zoneById(graph, id) || graph.zones.find(zone => zone.city === id) || null;
}

function zoneOfPlace(graph, locationId) {
  return graph.zones.find(zone => zone.city === locationId
    || zone.places.some(place => place.locationId === locationId)) || null;
}

/** Зона точки карты (координаты в километрах карты); вне мира — ближайшая зона. */
function zoneAtPoint(graph, x, y) {
  const size = graph.grid.zoneKm;
  const direct = zoneById(graph, zoneId(Math.floor(Number(x) / size), Math.floor(Number(y) / size)));
  if (direct) return direct;
  let best = null;
  let bestD = Infinity;
  for (const zone of graph.zones) {
    const d = Math.hypot((zone.col + 0.5) * size - x, (zone.row + 0.5) * size - y);
    if (d < bestD) { bestD = d; best = zone; }
  }
  return best;
}

/** Кратчайший путь по открытым воротам: список id зон от `from` до `to` включительно или null. */
function route(graph, from, to, allow = () => true) {
  if (!zoneById(graph, from) || !zoneById(graph, to)) return null;
  const cameFrom = new Map([[from, '']]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === to) {
      const path = [];
      for (let id = to; id; id = cameFrom.get(id)) path.push(id);
      return path.reverse();
    }
    for (const side of Object.keys(SIDES)) {
      const next = neighbour(graph, current, side);
      if (!next || cameFrom.has(next.id) || !allow(next)) continue;
      cameFrom.set(next.id, current);
      queue.push(next.id);
    }
  }
  return null;
}

function unreachableZones(graph) {
  const start = graph.capitals.map(id => zoneOfPlace(graph, id)).find(Boolean) || graph.zones[0];
  if (!start) return [];
  const seen = new Set([start.id]);
  const queue = [start.id];
  for (let head = 0; head < queue.length; head++) {
    for (const side of Object.keys(SIDES)) {
      const next = neighbour(graph, queue[head], side);
      if (next && !seen.has(next.id)) { seen.add(next.id); queue.push(next.id); }
    }
  }
  return graph.zones.filter(zone => !seen.has(zone.id)).map(zone => zone.id);
}

/** Рецепт зоны для `buildZone`: ворота с названием и цветом соседа, места, биом, зерно. */
function zoneRecipe(graph, id, overrides = {}) {
  const zone = zoneById(graph, id);
  if (!zone) throw new Error(`zone graph: unknown zone ${id}`);
  if (zone.city) throw new Error(`zone graph: ${id} is the city ${zone.city}, it is not generated`);
  return {
    zoneId: zone.id, name: zone.title, seed: zone.seed, biome: zone.region, groundPreset: zone.ground,
    mode: zone.mode, difficulty: zone.difficulty, col: zone.col, row: zone.row, n: zone.n,
    gates: Object.entries(zone.edges).filter(([, edge]) => edge.open).map(([dir, edge]) => {
      const other = zoneById(graph, edge.to);
      // Сосед‑город принимает прямо в свою локацию: ворота ведут в неё, а не в зону.
      return { dir, to: zoneLocationId(other), toTitle: other.title, toMode: other.mode, along: edge.along, road: !!edge.road };
    }),
    places: zone.places.map(place => ({
      locationId: place.locationId, name: place.name, u: place.u, v: place.v, ...(place.hidden ? { hidden: true } : {})
    })),
    ...(overrides.pins?.[zone.id] ? { pins: overrides.pins[zone.id] } : {})
  };
}

module.exports = {
  GRAPH_VERSION, SCHEMA, SIDES, ZONE_KM,
  buildZoneGraph, neighbour, route, unreachableZones,
  zoneAtPoint, zoneById, zoneId, zoneLocationId, zoneOfLocation, zoneOfPlace, zoneRecipe
};
