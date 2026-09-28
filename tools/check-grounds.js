#!/usr/bin/env node
'use strict';

// Угодья (библия, 4.5; src/server/zone-grounds.js; data/kromka/grounds.json):
// файл совпадает со своим генератором, у пяти угодий по три семейства, каждое
// семейство — основное, второе и третье ровно по разу, двух нет, ремесло города
// — семейство не из его угодий, каждая зона мира кроме Ключей в угодьях, жила
// лежит в угодьях своего основного ресурса, узлы делятся по долям угодий, а
// звери со шкурой не заводятся там, где шкур нет.

const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const grounds = require('../src/server/zone-grounds');

const ROOT = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build-zone-grounds.js'), '--check'], { stdio: 'inherit' });
const raw = require('../data/kromka/grounds.json');
const graph = require('../data/kromka/zone-graph.json');
const config = grounds.normalizeGrounds(raw);
const rows = Object.values(config.grounds);

assert.equal(rows.length, 5, 'five grounds, one per faction city');
for (const rank of [0, 1, 2]) {
  const families = rows.map(row => row.families[rank]).sort();
  assert.deepEqual(families, [...grounds.ALL_FAMILIES].sort(), `every family is rank ${rank + 1} in exactly one grounds`);
}
for (const row of rows) {
  assert(!row.families.includes(row.refine), `${row.id} refines a family its grounds lack`);
  assert.equal(config.byCity[row.cityLocationId], row.id, `${row.cityLocationId} owns ${row.id}`);
}
assert.deepEqual(rows.map(row => row.refine).sort(), [...grounds.ALL_FAMILIES].sort(), 'each city refines a different family');
console.log('PASS five grounds, each family main, second and third once, each city refines a family it lacks');

const centre = graph.zones.find(zone => zone.id === raw.center);
assert(centre, 'the centre zone exists');
for (const zone of graph.zones) {
  if (zone.id === raw.center) assert(!config.zones[zone.id], 'Klyuchi has no grounds');
  else assert(config.zones[zone.id], `zone ${zone.id} lies in some grounds`);
}
assert.equal(grounds.groundsFor(config, { cityLocationId: raw.centerLocationId }), null, 'the free city has no grounds');
console.log(`PASS every world zone but Klyuchi lies in grounds (${Object.keys(config.zones).length})`);

const hotspotsByFamily = {};
for (const [zoneId, hotspot] of Object.entries(config.hotspots)) {
  const ground = grounds.groundsFor(config, { zoneId });
  assert(ground && ground.families[0] === hotspot.family, `hotspot ${zoneId} (${hotspot.family}) lies in grounds whose main family it is`);
  (hotspotsByFamily[hotspot.family] = hotspotsByFamily[hotspot.family] || []).push(hotspot.tier);
}
for (const family of grounds.ALL_FAMILIES) {
  assert.deepEqual((hotspotsByFamily[family] || []).sort(), [1, 2, 3, 4, 5], `${family} has one hotspot per tier`);
}
console.log('PASS each main resource has one hotspot per tier inside its grounds');

for (const row of rows) {
  const targets = grounds.nodeTargets(config, row, 11);
  assert.equal(Object.values(targets).reduce((a, b) => a + b, 0), 11, `${row.id} keeps the node count`);
  for (const family of grounds.NODE_FAMILIES) {
    assert.equal(targets[family] > 0, row.families.includes(family), `${row.id} grows ${family} only if its grounds hold it`);
  }
  const main = row.families.find(family => grounds.NODE_FAMILIES.includes(family));
  assert(grounds.NODE_FAMILIES.every(family => targets[main] >= targets[family]), `${row.id} grows most of its main node family`);
  if (main === row.families[0]) {
    assert.equal(grounds.nodeTargets(config, row, 11, main)[main], targets[main] * config.hotspotFactor, 'a hotspot doubles its family');
  }
  const pick = grounds.replacementFamily(row, 0.37);
  assert(row.families.includes(pick), `${row.id} retypes a foreign node into one of its families`);
  const beast = grounds.beastWeight(config, row, { hideBeast: true });
  const rank = row.families.indexOf('hide');
  assert.equal(beast > 0, rank >= 0, `${row.id}: hide beasts live only where hides grow`);
  assert.equal(grounds.beastWeight(config, row, { hideBeast: false }), 1, 'other species keep their weight');
}
assert.deepEqual(grounds.nodeTargets(config, null, 11), { ore: 3, wood: 3, fiber: 3, oil: 2 }, 'without grounds nodes stay even');
console.log('PASS nodes follow the grounds shares, hotspots double them, hide beasts follow the hides');

console.log('Grounds OK: five wedge grounds of three families, city crafts, hotspots per tier, node shares and beasts.');
