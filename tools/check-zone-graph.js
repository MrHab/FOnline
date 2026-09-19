#!/usr/bin/env node
'use strict';

// Граф зон мира и его стык с конструктором: файл графа свеж, мир связен, столицы
// мирные, каждое место карты стоит ровно в одной зоне, обе зоны видят общую сторону
// одинаково — и конструктор собирает каждую зону мира так, что ворота соседей сходятся.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildFromData, serialize } = require('./build-zone-graph');
const { SIDES, neighbour, route, unreachableZones, zoneAtPoint, zoneById, zoneOfPlace, zoneRecipe } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { DIRECTIONS, TILES, buildZone } = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const graph = buildFromData();
const onDisk = fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(onDisk, serialize(graph), 'data/kromka/zone-graph.json is stale: run `node tools/build-zone-graph.js`');

// --- состав ---------------------------------------------------------------------------
const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
assert.deepEqual(graph.grid, { cols: 19, rows: 15, zoneKm: 20, cellsPerZone: 2 });
assert(graph.zones.length >= 190 && graph.zones.length <= 205, `the world has about 195 zones, got ${graph.zones.length}`);
assert.deepEqual(graph.zones.map(zone => zone.n), graph.zones.map((_, index) => index + 1), 'zones are numbered 1…N north to south, west to east');
for (const zone of graph.zones) {
  assert(zone.region && zone.name && zone.title.endsWith(`№${zone.n}`), `${zone.id} has a region and a title`);
  assert(['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack'].includes(zone.mode));
  assert(Object.values(zone.edges).some(edge => edge.open), `${zone.id} has a way out`);
}

// --- места: каждое видимое место карты — ровно в одной зоне, столицы мирные --------------
const visible = map.nodes.filter(node => node.hidden !== true);
for (const node of visible) {
  const id = node.locationId || node.id;
  const holders = graph.zones.filter(zone => zone.places.some(place => place.locationId === id));
  assert.equal(holders.length, 1, `${id} belongs to exactly one zone`);
  assert.equal(zoneAtPoint(graph, node.x, node.y).id, holders[0].id, `${id}: the zone at its map point is its zone`);
  const place = holders[0].places.find(row => row.locationId === id);
  assert(place.name && place.name !== id, `${id} has a player-facing name`);
  assert(place.u > 0 && place.u < 1 && place.v > 0 && place.v < 1);
}
for (const node of map.nodes.filter(row => row.hidden === true)) {
  assert.equal(zoneOfPlace(graph, node.locationId || node.id), null, 'hidden faction bases are entered from the Core hub, not from a zone');
}
assert.equal(graph.capitals.length, 6);
for (const capital of graph.capitals) assert.equal(zoneOfPlace(graph, capital).mode, 'peaceful', `${capital} stands in a peaceful zone`);
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
const built = new Map(graph.zones.map(zone => [zone.id, buildZone(zoneRecipe(graph, zone.id), catalog)]));
let gates = 0;
for (const zone of graph.zones) {
  const def = built.get(zone.id);
  assert.equal(def.id, zone.id);
  assert.equal(def.pvpMode, zone.mode);
  assert.equal(def.name, zone.title);
  const openSides = Object.entries(zone.edges).filter(([, edge]) => edge.open);
  assert.equal(def.transitions.filter(row => row.type === 'zoneGate').length, openSides.length, `${zone.id}: one gate per open side`);
  for (const [side, edge] of openSides) {
    gates += 1;
    const gate = def.transitions.find(row => row.id === `gate_${side}`);
    assert.equal(gate.to, edge.to);
    const target = built.get(edge.to);
    const landing = target[gate.entryKey];
    assert(landing, `${zone.id} ${side}: the neighbour has the entry point ${gate.entryKey}`);
    // Вышел из ворот — вошёл напротив них: позиция вдоль общей стороны сохраняется.
    const along = DIRECTIONS[side].axis === 'z' ? [gate.tx, landing.tx] : [gate.tz, landing.tz];
    assert.equal(along[0], along[1], `${zone.id} ${side}: you arrive opposite the gate you left by`);
    const depth = DIRECTIONS[side].axis === 'z' ? landing.tz : landing.tx;
    assert(DIRECTIONS[side].near ? depth > TILES / 2 : depth < TILES / 2, `${zone.id} ${side}: you arrive on the far side of the neighbour`);
    assert.equal(gate.label, zoneById(graph, edge.to).title, 'a gate is labelled with the neighbour it leads to');
  }
  for (const place of zone.places) {
    assert(def.transitions.some(row => row.type === 'location' && row.to === place.locationId), `${zone.id}: a portal leads to ${place.locationId}`);
    assert(def[`entryFromPlace_${place.locationId}`.slice(0, 32)], `${zone.id}: leaving ${place.locationId} lands in the zone`);
  }
}
const objects = [...built.values()].reduce((sum, def) => sum + def.objects.length, 0);
const lairs = [...built.values()].reduce((sum, def) => sum + def.zone.lairs.length, 0);

console.log(`Zone graph OK: ${graph.zones.length} zones, all reachable from a capital, ${visible.length} places in exactly one zone each, ${gates} gates that land opposite each other; the constructor built every zone (${objects} objects, ${lairs} lairs).`);
