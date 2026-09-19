'use strict';

// Конструктор зон: из рецепта (биом, цвет опасности, ворота, места, зерно) и
// каталога кусков собирает обычное определение локации `realm.location.v1`.
// Сервер читает его как любую авторскую локацию, клиент строит сцену на лету из
// набора префабов. Модуль чистый и детерминированный: один рецепт — один и тот
// же результат байт в байт. Меняя правила сборки, поднимайте BUILDER_VERSION.

const crypto = require('node:crypto');
const { SLOT_METRES, chunkFits, rotatePoint, rotatedHalfExtents } = require('./zone-chunks');

const BUILDER_VERSION = 1;
const TILE = 2;
const TILES = 160;
const HALF_METRES = TILES * TILE / 2;
const SLOTS = TILES * TILE / SLOT_METRES;
// Закрытая локация не пускает игрока в двухтайловую кромку, поэтому проём ворот
// стоит на четвёртом тайле от края, а точка входа — глубже, чтобы прибывший не
// оказался сразу в проёме обратно.
const GATE_TRIGGER_TILE = 4;
const GATE_ENTRY_TILE = 9;
const WALK_MIN = 2;
const WALK_MAX = TILES - 3;
const KEY_POINT_CLEAR_METRES = 6;
const SPAWN_CLEAR_METRES = 40;
const DIRECTIONS = Object.freeze({
  north: { axis: 'z', near: true, targetEntry: 'entryFromSouth', entry: 'entryFromNorth' },
  south: { axis: 'z', near: false, targetEntry: 'entryFromNorth', entry: 'entryFromSouth' },
  west: { axis: 'x', near: true, targetEntry: 'entryFromEast', entry: 'entryFromWest' },
  east: { axis: 'x', near: false, targetEntry: 'entryFromWest', entry: 'entryFromEast' }
});
const MODES = Object.freeze(['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack']);
const MODE_BUDGET = Object.freeze({
  peaceful: { lairs: 0, anomalies: 0, containers: 0, loot: 0 },
  pve: { lairs: 1, anomalies: 0, containers: 3, loot: 1 },
  pvp: { lairs: 1, anomalies: 1, containers: 4, loot: 1.3 },
  pvpFullDrop: { lairs: 2, anomalies: 2, containers: 4, loot: 2.2 },
  pvpBlack: { lairs: 3, anomalies: 3, containers: 5, loot: 2.6 }
});
// В тайниках зон только материалы: оружие, броню и инструменты делают игроки.
const LOOT_MATERIALS = Object.freeze(['scrap', 'chemicals', 'electronics', 'medicine', 'ammoParts', 'weaponParts', 'ore', 'wood']);
const ANOMALY_TYPES = Object.freeze(['sink', 'dew', 'glass', 'chime', 'seam', 'pull', 'carousel', 'mute']);

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round2(value) { return Math.round(Number(value) * 100) / 100; }
function camel(key) { return String(key).replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase()); }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); }
function tileCentre(t) { return (t - TILES / 2 + 0.5) * TILE; }
function metresToTile(m) { return clamp(Math.floor(m / TILE + TILES / 2), 0, TILES - 1); }
function worldOf(tile) { return { x: tileCentre(tile.tx), z: tileCentre(tile.tz) }; }

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) ^ Math.imul(BUILDER_VERSION, 0x9E3779B1);
  const next = () => {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: p => next() < p,
    pick: list => list[Math.floor(next() * list.length)],
    shuffle: list => {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
  };
}

function normalizeRecipe(recipe = {}) {
  const zoneId = safeId(recipe.zoneId);
  if (!zoneId) throw new Error('zone recipe needs zoneId');
  const mode = MODES.includes(recipe.mode) ? recipe.mode : 'pvp';
  const budget = recipe.budget && typeof recipe.budget === 'object' ? recipe.budget : {};
  const count = (key, fallback, max) => clamp(Math.round(Number(budget[key] ?? fallback)), 0, max);
  const seenDirs = new Set();
  const gates = (Array.isArray(recipe.gates) ? recipe.gates : []).map(gate => {
    const dir = String(gate?.dir || '');
    if (!DIRECTIONS[dir] || seenDirs.has(dir)) throw new Error(`zone ${zoneId}: gate direction "${dir}" is unknown or repeated`);
    seenDirs.add(dir);
    const to = safeId(gate.to);
    if (!to) throw new Error(`zone ${zoneId}: gate ${dir} has no target zone`);
    return {
      dir, to, toTitle: String(gate.toTitle || to).slice(0, 80),
      toMode: MODES.includes(gate.toMode) ? gate.toMode : '',
      along: clamp(Number(gate.along ?? 0.5), 0.1, 0.9), road: gate.road === true
    };
  }).sort((a, b) => a.dir.localeCompare(b.dir));
  // Скрытое место (база фракции) — только выход в зону: точка входа есть, портала внутрь нет.
  const places = (Array.isArray(recipe.places) ? recipe.places : []).map(place => ({
    locationId: safeId(place?.locationId), name: String(place?.name || place?.locationId || '').slice(0, 80),
    u: clamp(Number(place?.u ?? 0.5), 0, 1), v: clamp(Number(place?.v ?? 0.5), 0, 1),
    ...(place?.hidden === true ? { hidden: true } : {})
  })).filter(place => place.locationId).sort((a, b) => a.locationId.localeCompare(b.locationId));
  return {
    zoneId, mode, gates, places,
    name: String(recipe.name || zoneId).slice(0, 80),
    seed: Number(recipe.seed) >>> 0,
    biome: safeId(recipe.biome) || 'wasteland',
    groundPreset: safeId(recipe.groundPreset) || 'wasteland',
    difficulty: clamp(Math.round(Number(recipe.difficulty || 1)), 1, 5),
    col: Number.isFinite(Number(recipe.col)) ? Number(recipe.col) : 0,
    row: Number.isFinite(Number(recipe.row)) ? Number(recipe.row) : 0,
    n: Number.isFinite(Number(recipe.n)) ? Number(recipe.n) : 0,
    budget: {
      landmarks: count('landmarks', 1, 2), poi: count('poi', 5, 12), resources: count('resources', 3, 10),
      lairs: count('lairs', MODE_BUDGET[mode].lairs, 6), containers: count('containers', MODE_BUDGET[mode].containers, 12),
      anomalies: count('anomalies', MODE_BUDGET[mode].anomalies, 8), eventAnchors: count('eventAnchors', 3, 8),
      fill: clamp(Number(budget.fill ?? 0.55), 0, 1), maxObjects: count('maxObjects', 260, 600)
    }
  };
}

function gateGeometry(gate) {
  const dir = DIRECTIONS[gate.dir];
  const along = clamp(Math.round(gate.along * (TILES - 1)), 12, TILES - 13);
  const edge = dir.near ? GATE_TRIGGER_TILE : TILES - 1 - GATE_TRIGGER_TILE;
  const inner = dir.near ? GATE_ENTRY_TILE : TILES - 1 - GATE_ENTRY_TILE;
  const trigger = dir.axis === 'z' ? { tx: along, tz: edge } : { tx: edge, tz: along };
  const entry = dir.axis === 'z' ? { tx: along, tz: inner } : { tx: inner, tz: along };
  return { ...gate, trigger, entry, entryKey: dir.entry, targetEntryKey: dir.targetEntry, axis: dir.axis };
}

function placeGeometry(place, hub, taken) {
  let tx = clamp(Math.round(place.u * (TILES - 1)), 24, TILES - 25);
  let tz = clamp(Math.round(place.v * (TILES - 1)), 24, TILES - 25);
  // Портал места не садится на центр зоны, на ворота и на другой портал.
  for (let guard = 0; guard < 8 && taken.some(p => Math.hypot(p.tx - tx, p.tz - tz) < 14); guard++) {
    tx = clamp(tx + 14, 24, TILES - 25);
    if (guard % 2) tz = clamp(tz + 14, 24, TILES - 25);
  }
  const portal = { tx, tz };
  const dx = hub.tx - tx;
  const dz = hub.tz - tz;
  const length = Math.max(1, Math.hypot(dx, dz));
  const entry = { tx: clamp(Math.round(tx + dx / length * 4), WALK_MIN, WALK_MAX), tz: clamp(Math.round(tz + dz / length * 4), WALK_MIN, WALK_MAX) };
  return { ...place, portal, entry, entryKey: `entryFromPlace_${place.locationId}`.slice(0, 32) };
}

function segmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq > 0 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / lengthSq, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

function slotOf(point) {
  return {
    i: clamp(Math.floor((point.x + HALF_METRES) / SLOT_METRES), 0, SLOTS - 1),
    j: clamp(Math.floor((point.z + HALF_METRES) / SLOT_METRES), 0, SLOTS - 1)
  };
}
function slotKey(slot) { return `${slot.i}:${slot.j}`; }
function slotCentre(slot) {
  return { x: -HALF_METRES + (slot.i + 0.5) * SLOT_METRES, z: -HALF_METRES + (slot.j + 0.5) * SLOT_METRES };
}

function chooseChunk(rng, catalog, kind, recipe, used, wanted = () => true) {
  const pool = catalog.chunks.filter(chunk => chunk.kind === kind && chunkFits(chunk, recipe.biome, recipe.mode)
    && (used.get(chunk.id) || 0) < chunk.maxPerZone && wanted(chunk));
  if (!pool.length) return null;
  let roll = rng.next() * pool.reduce((sum, chunk) => sum + chunk.weight, 0);
  for (const chunk of pool) {
    roll -= chunk.weight;
    if (roll < 0) { used.set(chunk.id, (used.get(chunk.id) || 0) + 1); return chunk; }
  }
  const last = pool[pool.length - 1];
  used.set(last.id, (used.get(last.id) || 0) + 1);
  return last;
}

function planSlots(rng, recipe, catalog, reserved, arrivalSlots, hub) {
  const free = [];
  for (let j = 0; j < SLOTS; j++) for (let i = 0; i < SLOTS; i++) if (!reserved.has(`${i}:${j}`)) free.push({ i, j });
  const placed = new Map();
  const used = new Map();
  const taken = slot => placed.has(slotKey(slot));
  const touches = (slot, keys) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => keys.has(`${slot.i + di}:${slot.j + dj}`));
  const put = (slot, kind, wanted) => {
    const chunk = chooseChunk(rng, catalog, kind, recipe, used, wanted);
    if (chunk) placed.set(slotKey(slot), { slot, chunk, rot: rng.pick(chunk.rotations) });
    return !!chunk;
  };
  const hubSlot = slotOf(worldOf(hub));
  const byHubDistance = free.slice().sort((a, b) => (Math.hypot(a.i - hubSlot.i, a.j - hubSlot.j) - Math.hypot(b.i - hubSlot.i, b.j - hubSlot.j))
    || a.j - b.j || a.i - b.i);
  // Ориентир стоит у центра зоны: его видно с любой тропы.
  for (let left = recipe.budget.landmarks; left > 0; left--) {
    const near = byHubDistance.filter(slot => !taken(slot)).slice(0, 4);
    if (!near.length || !put(rng.pick(near), 'landmark')) break;
  }
  const order = rng.shuffle(free);
  const featured = new Set([...placed.keys()]);
  const spread = (kind, budget, allow = () => true, wanted) => {
    let left = budget;
    for (const slot of order) {
      if (left <= 0) break;
      if (taken(slot) || touches(slot, featured) || !allow(slot)) continue;
      if (put(slot, kind, wanted)) { featured.add(slotKey(slot)); left--; } else break;
    }
    return budget - left;
  };
  // Логова первыми: им нужен слот вдали от точек прибытия, а таких немного.
  spread('lair', recipe.budget.lairs, slot => !arrivalSlots.some(g => Math.max(Math.abs(g.i - slot.i), Math.abs(g.j - slot.j)) < 2));
  // Обещанные зоне аномалии не зависят от удачи: сначала ставятся точки интереса с ними.
  const withAnomaly = chunk => chunk.anchors.some(anchor => anchor.type === 'anomaly');
  const anomalyPois = spread('poi', Math.min(recipe.budget.poi, Math.ceil(recipe.budget.anomalies / 2)), undefined, withAnomaly);
  spread('poi', recipe.budget.poi - anomalyPois);
  spread('resource', recipe.budget.resources);
  for (const slot of order) if (!taken(slot) && rng.chance(recipe.budget.fill)) put(slot, 'filler');
  return [...placed.values()].sort((a, b) => a.slot.j - b.slot.j || a.slot.i - b.slot.i);
}

function containerRow(rng, recipe, id, tile, tierHint) {
  const danger = recipe.mode === 'pvpFullDrop' || recipe.mode === 'pvpBlack';
  const locked = danger ? rng.chance(0.7) : recipe.mode === 'pvp' && rng.chance(0.35);
  const lockDifficulty = recipe.difficulty >= 4 ? 'hard' : recipe.difficulty >= 2 ? 'medium' : 'easy';
  const scale = MODE_BUDGET[recipe.mode].loot * (locked ? 1.5 : 1);
  const loot = rng.shuffle(LOOT_MATERIALS).slice(0, locked ? 3 : 2).sort()
    .map(itemId => ({ id: itemId, qty: Math.max(1, Math.round((2 + rng.int(0, 3)) * scale)) }));
  if (locked && danger) loot.push({ id: 'silver', qty: Math.round((8 + rng.int(0, 8)) * recipe.difficulty) });
  const point = worldOf(tile);
  return {
    id, name: 'Тайник', tier: tierHint || (danger ? 'rare' : recipe.mode === 'pvp' ? 'wasteland' : 'basic'),
    tx: tile.tx, tz: tile.tz, x: point.x, y: 0.1, z: point.z, rotationY: 0,
    locked, ...(locked ? { lockDifficulty } : {}), loot
  };
}

function rasterize(objects) {
  const blocked = new Uint8Array(TILES * TILES);
  for (const row of objects) {
    if (row.collision !== 'solid' && !row.resourceType) continue;
    const size = row.collisionSize || { width: TILE * 0.9, depth: TILE * 0.9 };
    const degrees = row.rotation.y * 180 / Math.PI;
    const half = rotatedHalfExtents(size.width + 1, size.depth + 1, degrees);
    const from = { tx: metresToTile(row.position.x - half.hx), tz: metresToTile(row.position.z - half.hz) };
    const to = { tx: metresToTile(row.position.x + half.hx), tz: metresToTile(row.position.z + half.hz) };
    for (let tz = from.tz; tz <= to.tz; tz++) {
      for (let tx = from.tx; tx <= to.tx; tx++) {
        if (Math.abs(tileCentre(tx) - row.position.x) <= half.hx && Math.abs(tileCentre(tz) - row.position.z) <= half.hz) blocked[tz * TILES + tx] = 1;
      }
    }
  }
  return blocked;
}

function reachable(blocked, start) {
  const seen = new Uint8Array(TILES * TILES);
  const open = tile => tile.tx >= WALK_MIN && tile.tx <= WALK_MAX && tile.tz >= WALK_MIN && tile.tz <= WALK_MAX && !blocked[tile.tz * TILES + tile.tx];
  if (!open(start)) return seen;
  const queue = [start.tz * TILES + start.tx];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const tx = queue[head] % TILES;
    const tz = (queue[head] - tx) / TILES;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { tx: tx + dx, tz: tz + dz };
      const index = next.tz * TILES + next.tx;
      if (!open(next) || seen[index]) continue;
      seen[index] = 1;
      queue.push(index);
    }
  }
  return seen;
}

/** Убирает преграды, пока каждая обязательная точка не станет достижимой из центра зоны. */
function ensureConnected(objects, hub, targets) {
  const removed = [];
  for (let guard = 0; guard < 80; guard++) {
    const seen = reachable(rasterize(objects), hub);
    const lost = targets.find(target => ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .some(([dx, dz]) => seen[(target.tz + dz) * TILES + target.tx + dx]));
    if (!lost) return removed;
    const point = worldOf(lost);
    let nearest = -1;
    let best = Infinity;
    objects.forEach((row, index) => {
      if (row.collision !== 'solid') return;
      const d = Math.hypot(row.position.x - point.x, row.position.z - point.z);
      if (d < best) { best = d; nearest = index; }
    });
    if (nearest < 0) throw new Error(`zone builder: ${lost.label || 'a target'} is unreachable with no obstacle left to remove`);
    removed.push(objects[nearest].id);
    objects.splice(nearest, 1);
  }
  throw new Error('zone builder: could not connect the zone');
}

function zoneRevision(definition) {
  const { revision, ...rest } = definition;
  return `b${BUILDER_VERSION}-${crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`;
}

function buildZone(recipeInput, catalog) {
  const recipe = normalizeRecipe(recipeInput);
  const rng = seededRandom(recipe.seed);
  const hub = { tx: TILES / 2 + rng.int(-8, 8), tz: TILES / 2 + rng.int(-8, 8) };
  const gates = recipe.gates.map(gateGeometry);
  const takenTiles = [hub, ...gates.map(gate => gate.entry)];
  const places = recipe.places.map(place => {
    const row = placeGeometry(place, hub, takenTiles);
    takenTiles.push(row.portal);
    return row;
  });

  // Тропы от каждых ворот и каждого места к центру: по ним зона связна по построению.
  const corridors = [];
  const navNodes = [{ id: 'hub', ...hub }];
  const navLinks = [];
  const lay = (id, from, half, axisFirst) => {
    const elbow = axisFirst === 'z' ? { tx: from.tx, tz: hub.tz } : { tx: hub.tx, tz: from.tz };
    corridors.push({ a: worldOf(from), b: worldOf(elbow), half }, { a: worldOf(elbow), b: worldOf(hub), half });
    navNodes.push({ id, ...from }, { id: `${id}_turn`, ...elbow });
    navLinks.push([id, `${id}_turn`], [`${id}_turn`, 'hub']);
  };
  for (const gate of gates) lay(`gate_${gate.dir}`, gate.entry, gate.road ? 4 : 3, gate.axis);
  for (const place of places) lay(`place_${place.locationId}`, place.entry, 3, 'x');

  const keyPoints = [hub, ...gates.flatMap(gate => [gate.entry, gate.trigger]), ...places.flatMap(place => [place.portal, place.entry])].map(worldOf);
  const arrivalPoints = [...gates.map(gate => gate.entry), ...places.map(place => place.entry)].map(worldOf);
  const reserved = new Set(keyPoints.map(point => slotKey(slotOf(point))));
  // Логова держатся в двух слотах от любой точки прибытия — ворот и выхода из места.
  const arrivalSlots = arrivalPoints.map(slotOf);
  const plan = planSlots(rng, recipe, catalog, reserved, arrivalSlots, hub);

  const objects = [];
  const containers = [];
  const anomalyFields = [];
  const zoneLists = { spawnAreas: [], lairs: [], eventAnchors: [] };
  const inTheWay = (point, reach) => keyPoints.some(key => Math.hypot(key.x - point.x, key.z - point.z) < KEY_POINT_CLEAR_METRES + reach)
    || corridors.some(seg => segmentDistance(point, seg.a, seg.b) < seg.half + reach);
  const farFromArrivals = point => arrivalPoints.every(arrival => Math.hypot(arrival.x - point.x, arrival.z - point.z) >= SPAWN_CLEAR_METRES);

  for (const { slot, chunk, rot } of plan) {
    const centre = slotCentre(slot);
    const prefix = `s${slot.i}${slot.j}`;
    for (const item of chunk.objects) {
      if (objects.length >= recipe.budget.maxObjects) break;
      const kit = catalog.kit[item.prefab];
      const local = rotatePoint(item.x, item.z, rot);
      const point = { x: round2(centre.x + local.x), z: round2(centre.z + local.z) };
      const degrees = ((item.ry + rot) % 360 + 360) % 360;
      const width = round2(kit.size[0] * item.s);
      const depth = round2(kit.size[1] * item.s);
      const half = rotatedHalfExtents(width, depth, degrees);
      const reach = Math.max(half.hx, half.hz);
      if (Math.abs(point.x) + half.hx > HALF_METRES - 8 || Math.abs(point.z) + half.hz > HALF_METRES - 8) continue;
      const blocks = item.solid || !!kit.resource;
      if (blocks ? inTheWay(point, reach) : keyPoints.some(key => Math.hypot(key.x - point.x, key.z - point.z) < 2)) continue;
      objects.push({
        id: `${prefix}_${item.id}`, model: camel(item.prefab), prefab: item.prefab, name: kit.name,
        position: { x: point.x, y: 0, z: point.z }, rotation: { x: 0, y: round2(degrees * Math.PI / 180), z: 0 },
        scale: { x: item.s, y: item.s, z: item.s },
        collision: item.solid && !kit.resource ? 'solid' : 'none',
        ...(item.solid && !kit.resource ? { collisionSize: { width, depth } } : {}),
        footprint: { x: width, z: depth }, vision: { blocks: kit.vision },
        role: kit.resource ? 'scenery' : item.solid ? 'cover' : 'scenery',
        tags: [...new Set([...item.tags, ...(kit.resource ? ['resource', kit.resource] : []), 'zone-kit'])],
        ...(kit.resource ? { resourceType: kit.resource, hp: kit.hp, maxHp: kit.hp } : {})
      });
    }
    for (const anchor of chunk.anchors) {
      const local = rotatePoint(anchor.x, anchor.z, rot);
      const point = { x: centre.x + local.x, z: centre.z + local.z };
      const tile = { tx: metresToTile(point.x), tz: metresToTile(point.z) };
      const id = `${prefix}_${anchor.id}`;
      if (anchor.type === 'container') {
        if (containers.length < recipe.budget.containers && !inTheWay(point, 1)) containers.push(containerRow(rng, recipe, id, tile, anchor.tier));
      } else if (anchor.type === 'anomaly') {
        if (anomalyFields.length < recipe.budget.anomalies && !inTheWay(point, anchor.radius || 3)) {
          anomalyFields.push({
            id, type: ANOMALY_TYPES.includes(anchor.anomalyType) ? anchor.anomalyType : rng.pick(ANOMALY_TYPES),
            x: round2(point.x), z: round2(point.z), radius: anchor.radius || 3.2, dischargeMs: 4000, training: false,
            placement: 'zone-builder', belt: recipe.mode === 'pvpBlack' ? 'core' : 'outskirts',
            tierRange: [Math.max(1, recipe.difficulty - 1), Math.min(5, recipe.difficulty)]
          });
        }
      } else if (farFromArrivals(point)) {
        const list = anchor.type === 'spawnArea' ? zoneLists.spawnAreas : anchor.type === 'lair' ? zoneLists.lairs : zoneLists.eventAnchors;
        const cap = anchor.type === 'eventAnchor' ? recipe.budget.eventAnchors : anchor.type === 'lair' ? recipe.budget.lairs : 12;
        if (list.length < cap) list.push({ id, tx: tile.tx, tz: tile.tz, ...(anchor.type === 'lair' ? {} : { radius: anchor.radius || 9 }) });
      }
    }
    if (chunk.kind === 'poi' || chunk.kind === 'landmark') {
      const tile = { tx: metresToTile(centre.x), tz: metresToTile(centre.z) };
      const nearest = navNodes.reduce((best, node) => (Math.hypot(node.tx - tile.tx, node.tz - tile.tz) < Math.hypot(best.tx - tile.tx, best.tz - tile.tz) ? node : best));
      navNodes.push({ id: `${chunk.kind}_${prefix}`, ...tile });
      navLinks.push([`${chunk.kind}_${prefix}`, nearest.id]);
    }
  }

  const targets = [
    ...gates.flatMap(gate => [{ ...gate.entry, label: `gate ${gate.dir} entry` }, { ...gate.trigger, label: `gate ${gate.dir}` }]),
    ...places.flatMap(place => [{ ...place.portal, label: `portal ${place.locationId}` }, { ...place.entry, label: `entry from ${place.locationId}` }]),
    ...containers.map(row => ({ tx: row.tx, tz: row.tz, label: `container ${row.id}` })),
    ...[...zoneLists.spawnAreas, ...zoneLists.lairs, ...zoneLists.eventAnchors].map(row => ({ tx: row.tx, tz: row.tz, label: row.id }))
  ];
  const removedForConnectivity = ensureConnected(objects, hub, targets);

  const entries = {};
  for (const gate of gates) entries[gate.entryKey] = { ...gate.entry };
  for (const place of places) entries[place.entryKey] = { ...place.entry };
  const definition = {
    schema: 'realm.location.v1', version: 1, id: recipe.zoneId, name: recipe.name, seed: recipe.seed,
    kind: 'zone', generated: true, builderVersion: BUILDER_VERSION, revision: '',
    safe: recipe.mode === 'peaceful', pvpMode: recipe.mode, noRespawn: true, enemyCap: 0, spawnCount: 0,
    allowGlobalMapExit: false, noGlobalMapEntry: true, runtimeMode: 'generated', macroRegion: recipe.biome,
    ground: { preset: recipe.groundPreset }, map: { width: TILES * TILE, depth: TILES * TILE, origin: 'center' },
    grid: { snap: true, step: TILE }, units: 'game-meters',
    spawn: { ...hub }, entryFromWorld: { ...hub }, ...entries,
    transitions: [
      ...gates.map(gate => ({
        id: `gate_${gate.dir}`, type: 'zoneGate', auto: true, direction: gate.dir, label: gate.toTitle, to: gate.to,
        entryKey: gate.targetEntryKey, tx: gate.trigger.tx, tz: gate.trigger.tz, radius: 5, halfWidthTiles: 3,
        ...(gate.toMode ? { targetMode: gate.toMode } : {}), ...(gate.road ? { road: true } : {})
      })),
      ...places.filter(place => !place.hidden).map(place => ({
        id: `place_${place.locationId}`.slice(0, 48), type: 'location', label: place.name || place.locationId, to: place.locationId,
        entryKey: 'entryFromWorld', tx: place.portal.tx, tz: place.portal.tz, radius: 3.2
      }))
    ],
    worldZones: [], objects, containers, anomalyFields,
    zone: {
      col: recipe.col, row: recipe.row, n: recipe.n, region: recipe.biome, mode: recipe.mode, difficulty: recipe.difficulty,
      gates: gates.map(gate => ({ dir: gate.dir, to: gate.to, tx: gate.trigger.tx, tz: gate.trigger.tz, halfWidthTiles: 3, road: gate.road })),
      chunks: plan.map(row => ({ slot: [row.slot.i, row.slot.j], chunk: row.chunk.id, rot: row.rot })),
      ...zoneLists, removedForConnectivity,
      nav: { nodes: navNodes.map(node => ({ id: node.id, tx: node.tx, tz: node.tz })), links: navLinks }
    }
  };
  definition.revision = zoneRevision(definition);
  return definition;
}

module.exports = {
  BUILDER_VERSION, DIRECTIONS, GATE_ENTRY_TILE, GATE_TRIGGER_TILE, TILES, WALK_MAX, WALK_MIN,
  buildZone, normalizeRecipe, rasterize, reachable, zoneRevision
};
