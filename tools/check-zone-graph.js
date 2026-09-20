#!/usr/bin/env node
'use strict';

// Граф зон мира и его стык с конструктором: файл графа свеж, мир связен, города
// занимают свои секторы целиком, каждое место карты стоит ровно в одном секторе, обе
// зоны видят общую сторону одинаково — и конструктор собирает каждую зону мира так,
// что ворота соседей сходятся.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildFromData, serialize } = require('./build-zone-graph');
const { SIDES, neighbour, route, unreachableZones, zoneAtPoint, zoneById, zoneLocationId, zoneOfPlace, zoneRecipe } = require('../src/server/zone-graph');
const { SIDE_ENTRY, cityEntryPoints } = require('../src/server/zone-runtime');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { DIRECTIONS, TILES, buildZone } = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const overrides = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.overrides.json'), 'utf8'));
const graph = buildFromData();
const onDisk = fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(onDisk, serialize(graph), 'data/kromka/zone-graph.json is stale: run `node tools/build-zone-graph.js`');

// --- состав ---------------------------------------------------------------------------
const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
assert.deepEqual(graph.grid, { cols: 19, rows: 15, zoneKm: 20, cellsPerZone: 2 });
assert(graph.zones.length >= 190 && graph.zones.length <= 205, `the world has about 195 zones, got ${graph.zones.length}`);
assert.deepEqual(graph.zones.map(zone => zone.n), graph.zones.map((_, index) => index + 1), 'zones are numbered 1…N north to south, west to east');
for (const zone of graph.zones) {
  // Город занимает сектор целиком: его имя — имя города, без номера сектора.
  if (zone.city) assert(zone.region && zone.name && zone.title === zone.name, `${zone.id} is the city ${zone.city} and carries its name`);
  else assert(zone.region && zone.name && zone.title.endsWith(`№${zone.n}`), `${zone.id} has a region and a title`);
  assert(['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack'].includes(zone.mode));
  assert(Object.values(zone.edges).some(edge => edge.open), `${zone.id} has a way out`);
}

// --- города: сектор целиком, свои правила, вход с каждой открытой стороны -----------------
const cityZones = graph.zones.filter(zone => zone.city);
assert.deepEqual(cityZones.map(zone => zone.city).sort(), [...(overrides.cities || [])].sort(),
  'every authored city holds a sector of its own');
const cityDefinitions = new Map(cityZones.map(zone => [zone.id,
  JSON.parse(fs.readFileSync(path.join(root, 'data', 'locations', `${zone.city}.json`), 'utf8'))]));
for (const zone of cityZones) {
  const definition = cityDefinitions.get(zone.id);
  assert.equal(zone.places.length, 0, `${zone.id}: the city ${zone.city} shares its sector with a place`);
  assert.equal(zone.mode, definition.pvpMode, `${zone.id}: the sector must follow the rules of ${zone.city}`);
  const node = map.nodes.find(row => (row.locationId || row.id) === zone.city);
  assert(node, `${zone.city} has no node on the map`);
  assert.equal(zoneAtPoint(graph, node.x, node.y).id, zone.id, `${zone.city}: its map point lies outside its own sector`);
  // Пришедший из соседнего сектора встаёт у своей стороны города и вне выходной полосы.
  const tiles = { w: Math.round(definition.map.width / 2), h: Math.round(definition.map.depth / 2) };
  const entries = cityEntryPoints({ minX: 0, minZ: 0, maxX: tiles.w - 1, maxZ: tiles.h - 1 });
  for (const [side, edge] of Object.entries(zone.edges)) {
    if (!edge.open) continue;
    const entry = entries[SIDE_ENTRY[side]];
    assert(entry, `${zone.city}: no entry point for arrivals from the ${side}`);
    assert(entry.tx > 2 && entry.tz > 2 && entry.tx < tiles.w - 3 && entry.tz < tiles.h - 3,
      `${zone.city}: the ${side} entry ${entry.tx},${entry.tz} stands in the exit band`);
  }
}

// --- места: каждое место карты — ровно в одном секторе; город и есть свой сектор ---------
const visible = map.nodes.filter(node => node.hidden !== true);
for (const node of map.nodes) {
  const id = node.locationId || node.id;
  const city = graph.zones.filter(zone => zone.city === id);
  const holders = graph.zones.filter(zone => zone.places.some(place => place.locationId === id));
  assert.equal(city.length + holders.length, 1, `${id} belongs to exactly one sector`);
  const sector = city[0] || holders[0];
  assert.equal(zoneAtPoint(graph, node.x, node.y).id, sector.id, `${id}: the sector at its map point is its sector`);
  if (city.length) continue;
  const place = sector.places.find(row => row.locationId === id);
  assert(place.name && place.name !== id, `${id} has a player-facing name`);
  assert(place.u > 0 && place.u < 1 && place.v > 0 && place.v < 1);
  // Скрытые базы фракций — только выход в зону: внутрь попадают метро из узла Сердцевины.
  assert.equal(place.hidden === true, node.hidden === true, `${id}: hidden on the map means exit-only in its zone`);
}
assert.equal(graph.capitals.length, 6);
// Столица занимает свой сектор целиком, и правила сектора — её собственные.
for (const capital of graph.capitals) {
  const sector = zoneOfPlace(graph, capital);
  assert.equal(sector.city, capital, `${capital} must hold a sector of its own`);
}
// Синие зоны — только кольцо 3×3 вокруг городов фракций, сами столицы живут по своим правилам.
const capitalZones = graph.capitals.map(id => zoneOfPlace(graph, id));
const ringOf = zone => Math.min(...capitalZones.map(c => Math.max(Math.abs(c.col - zone.col), Math.abs(c.row - zone.row))));
for (const zone of graph.zones) {
  const ring = ringOf(zone);
  if (ring === 0) assert(zone.city, `${zone.id} holds a faction city`);
  else if (ring === 1) assert(['pve', 'pvpBlack'].includes(zone.mode) || zone.city, `${zone.id} next to a faction city is blue`);
  else assert(!['pve', 'peaceful'].includes(zone.mode) || zone.city, `${zone.id} is ${ring} zones from any faction city and must not be blue or peaceful`);
}
assert.equal(zoneOfPlace(graph, 'coreZone').mode, 'pvpBlack', 'the Core hub stands in a black zone');
assert.equal(zoneAtPoint(graph, -50, 9999).id.startsWith('z_'), true, 'a point outside the world snaps to the nearest zone');

// --- рёбра: обе зоны видят общую сторону одинаково, мир связен ---------------------------
for (const zone of graph.zones) {
  for (const [side, edge] of Object.entries(zone.edges)) {
    const other = zoneById(graph, edge.to);
    const back = other.edges[SIDES[side].opposite];
    assert(back && back.to === zone.id, `${zone.id} ${side}: the neighbour points back`);
    assert.deepEqual({ open: back.open, along: back.along, road: back.road }, { open: edge.open, along: edge.along, road: edge.road },
      `${zone.id} ${side}: both zones agree on the shared edge`);
    assert(edge.along >= 0.15 && edge.along <= 0.85);
    assert.equal(other.col - zone.col, SIDES[side].dc);
    assert.equal(other.row - zone.row, SIDES[side].dr);
  }
}
assert.deepEqual(unreachableZones(graph), [], 'every zone can be reached from a capital');
const keys = zoneOfPlace(graph, 'settlement');
for (const capital of graph.capitals) {
  const path_ = route(graph, keys.id, zoneOfPlace(graph, capital).id);
  assert(path_ && path_.length >= 1, `a walking route from Keys to ${capital} exists`);
  for (let i = 1; i < path_.length; i++) {
    assert(Object.keys(SIDES).some(side => neighbour(graph, path_[i - 1], side)?.id === path_[i]), 'every step of a route goes through an open gate');
  }
}
assert.equal(route(graph, keys.id, 'z_99_99'), null);
// Дороги карты идут по воротам: у зоны Ключей дорога выходит и на север, и на юг.
assert(keys.edges.north.road && keys.edges.south.road, 'the Tesma road crosses the Keys zone north to south');

// --- стык с конструктором: собирается каждая зона мира, ворота соседей сходятся -----------
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
// Города конструктор не собирает: их секторы — авторские сцены.
const generated = graph.zones.filter(zone => !zone.city);
const built = new Map(generated.map(zone => [zone.id, buildZone(zoneRecipe(graph, zone.id), catalog)]));
let gates = 0;
for (const zone of generated) {
  const def = built.get(zone.id);
  assert.equal(def.id, zone.id);
  assert.equal(def.pvpMode, zone.mode);
  assert.equal(def.name, zone.title);
  const openSides = Object.entries(zone.edges).filter(([, edge]) => edge.open);
  assert.equal(def.transitions.filter(row => row.type === 'zoneGate').length, openSides.length, `${zone.id}: one gate per open side`);
  for (const [side, edge] of openSides) {
    gates += 1;
    const other = zoneById(graph, edge.to);
    const gate = def.transitions.find(row => row.id === `gate_${side}`);
    assert.equal(gate.to, zoneLocationId(other), `${zone.id} ${side}: the gate leads to the neighbour's own location`);
    assert.equal(gate.label, other.title, 'a gate is labelled with the neighbour it leads to');
    if (other.city) {
      // Сосед-город принимает у своей стороны: точка входа авторской локации, а не зоны.
      const definition = cityDefinitions.get(other.id);
      const tiles = { w: Math.round(definition.map.width / 2), h: Math.round(definition.map.depth / 2) };
      assert(cityEntryPoints({ minX: 0, minZ: 0, maxX: tiles.w - 1, maxZ: tiles.h - 1 })[gate.entryKey],
        `${zone.id} ${side}: the city ${other.city} has no ${gate.entryKey}`);
      continue;
    }
    const target = built.get(edge.to);
    const landing = target[gate.entryKey];
    assert(landing, `${zone.id} ${side}: the neighbour has the entry point ${gate.entryKey}`);
    // Вышел из ворот — вошёл напротив них: позиция вдоль общей стороны сохраняется.
    const along = DIRECTIONS[side].axis === 'z' ? [gate.tx, landing.tx] : [gate.tz, landing.tz];
    assert.equal(along[0], along[1], `${zone.id} ${side}: you arrive opposite the gate you left by`);
    const depth = DIRECTIONS[side].axis === 'z' ? landing.tz : landing.tx;
    assert(DIRECTIONS[side].near ? depth > TILES / 2 : depth < TILES / 2, `${zone.id} ${side}: you arrive on the far side of the neighbour`);
  }
  for (const place of zone.places) {
    const portal = def.transitions.some(row => row.type === 'location' && row.to === place.locationId);
    assert.equal(portal, !place.hidden, `${zone.id}: ${place.hidden ? 'no portal leads into the hidden' : 'a portal leads to'} ${place.locationId}`);
    assert(def[`entryFromPlace_${place.locationId}`.slice(0, 32)], `${zone.id}: leaving ${place.locationId} lands in the zone`);
  }
}
const objects = [...built.values()].reduce((sum, def) => sum + def.objects.length, 0);
const lairs = [...built.values()].reduce((sum, def) => sum + def.zone.lairs.length, 0);

// Облик региона: у каждого три своих ориентира, и зона стоит у ориентира своего региона.
const chunkById = new Map(catalog.chunks.map(chunk => [chunk.id, chunk]));
const regions = [...new Set(graph.zones.map(zone => zone.region))];
for (const region of regions) {
  const own = catalog.chunks.filter(chunk => chunk.kind === 'landmark' && chunk.biomes.includes(region));
  assert(own.length >= 3, `${region} has ${own.length} landmarks of its own`);
}
assert(catalog.chunks.filter(chunk => chunk.kind === 'landmark').every(chunk => !chunk.biomes.includes('*')), 'no landmark stands in every region');
for (const zone of generated) {
  const marks = built.get(zone.id).zone.chunks.map(row => chunkById.get(row.chunk)).filter(chunk => chunk?.kind === 'landmark');
  assert(marks.length >= 1 && marks.every(chunk => chunk.biomes.includes(zone.region)), `${zone.id}: a landmark of ${zone.region} stands in the zone`);
}
// Топонимы: у каждого сектора своё имя, не «регион №N».
const names = new Set(graph.zones.map(zone => zone.name));
assert.equal(names.size, graph.zones.length, 'every sector has a name of its own');

console.log(`Zone graph OK: ${graph.zones.length} sectors with names of their own (${cityZones.length} of them whole cities), all reachable from a capital, ${visible.length} places in exactly one sector each, ${gates} gates that land opposite each other; the constructor built every wasteland zone (${objects} objects, ${lairs} lairs) around a landmark of its region (${regions.length} regions × 3).`);
