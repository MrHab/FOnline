#!/usr/bin/env node
'use strict';

// Миграция сохранений на мир зон (src/server/zone-migration.js) на образцах:
// персонаж на карте встаёт в зону своей точки, из красной и чёрной — в
// ближайшую синюю или мирную; из сцены мелкой клетки — в зону её точки;
// персонаж в месте остаётся на месте; следы карты стираются; повторная
// миграция ничего не меняет.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { migrateSaveStateToZones } = require('../src/server/zone-migration');
const { zoneAtPoint, zoneOfPlace } = require('../src/server/zone-graph');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const size = graph.grid.zoneKm;
const centre = zone => ({ x: (zone.col + 0.5) * size, y: (zone.row + 0.5) * size });
const yellow = graph.zones.find(zone => zone.mode === 'pvp');
const red = graph.zones.find(zone => zone.mode === 'pvpFullDrop');
const black = graph.zones.find(zone => zone.mode === 'pvpBlack');

// На карте в жёлтой зоне — в эту же зону.
{
  const state = { currentLocationId: 'wasteland', globalMap: { onWorldMap: true, playerX: centre(yellow).x, playerY: centre(yellow).y }, player: { x: 5, z: 7 } };
  const out = migrateSaveStateToZones(state, graph);
  assert.deepEqual([out.changed, out.zoneId, out.reason], [true, yellow.id, 'globalMap']);
  assert.equal(state.currentLocationId, yellow.id);
  assert.deepEqual([state.player.x, state.player.z], [0, 0], 'the character stands at the zone centre');
  assert(!('globalMap' in state), 'the map state is gone');
}
// На карте в красной и чёрной — в ближайшую синюю или мирную.
for (const harsh of [red, black]) {
  const state = { globalMap: { onWorldMap: true, playerX: centre(harsh).x, playerY: centre(harsh).y } };
  const out = migrateSaveStateToZones(state, graph);
  const landed = graph.zones.find(zone => zone.id === out.zoneId);
  assert(['pve', 'peaceful'].includes(landed.mode), `${harsh.mode} moves to a safe colour, got ${landed.mode}`);
  const nearest = Math.min(...graph.zones.filter(zone => ['pve', 'peaceful'].includes(zone.mode))
    .map(zone => Math.hypot(zone.col - harsh.col, zone.row - harsh.row)));
  assert.equal(Math.hypot(landed.col - harsh.col, landed.row - harsh.row), nearest, 'the nearest safe zone');
}
// В сцене мелкой клетки — в зону её точки.
{
  const point = centre(yellow);
  const state = { currentLocationId: 'randomDryBasin', serverLocationContext: { locationId: 'randomDryBasin', roomId: 'randomDryBasin#cell_9_92', worldPoint: point }, pendingWorldDrop: { x: 1 } };
  const out = migrateSaveStateToZones(state, graph);
  assert.deepEqual([out.zoneId, out.reason], [zoneAtPoint(graph, point.x, point.y).id, 'dangerCell']);
  assert(!state.serverLocationContext && !state.pendingWorldDrop, 'the cell context and the pending drop are gone');
}
// В месте — на месте; повторная миграция ничего не трогает.
{
  const state = { currentLocationId: 'settlement', player: { x: 3, z: 4 }, globalMap: { onWorldMap: false, playerX: 1, playerY: 1 } };
  const out = migrateSaveStateToZones(state, graph);
  assert.equal(out.zoneId, '', 'a character in a place stays there');
  assert.equal(state.currentLocationId, 'settlement');
  assert.deepEqual([state.player.x, state.player.z], [3, 4]);
  assert.equal(out.changed, true, 'the stale map state is dropped');
  assert.equal(migrateSaveStateToZones(state, graph).changed, false, 'migration is idempotent');
  assert(zoneOfPlace(graph, 'settlement'), 'Keys stands in a zone its edge leads to');
}

console.log(`Zone migration OK: map characters land in the zone of their point (red and black move to the nearest blue or peaceful zone), cell scenes too, places stay, the map state is dropped and a second run changes nothing.`);
