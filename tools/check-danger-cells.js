#!/usr/bin/env node
'use strict';

// Цвет опасности точки мира (экономика v3, библия 18.1): чёрная Сердцевина,
// мирные столицы с синим поясом, красные внешние регионы, остальное жёлтое.
// Граф зон красит так каждую зону по центру.

const assert = require('node:assert/strict');
const path = require('node:path');
const cells = require('../src/server/danger-cells');
const { loadWorldEconomy } = require('../src/server/world-economy');

const root = path.resolve(__dirname, '..');
const economy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));
const config = economy.dangerCells;
const map = require(path.join(root, 'data', 'global-map.json'));
const nodes = Object.fromEntries(map.nodes.map(node => [node.locationId || node.id, { x: node.x, y: node.y }]));
const pointKm = map.grid.cellKm / map.grid.cellPoints;

// --- настройки ------------------------------------------------------------------------
assert.equal(economy.worldModel.dangerCells, true, 'v3 colours the world by danger');
for (const id of config.capitals) assert(nodes[id], `capital ${id} is on the map`);
for (const center of config.blackCenters) assert(nodes[center.locationId], `black centre ${center.locationId} is on the map`);
assert.deepEqual(Object.keys(config).sort(),
  ['blackCenters', 'blueExtraCenters', 'blueRadiusKm', 'capitals', 'defaultMode', 'regionModes', 'safeRadiusKm'],
  'the colour rules carry no leftovers of the travel encounter cells');

// --- цвет точки ------------------------------------------------------------------------
{
  const core = nodes[config.blackCenters[0].locationId];
  assert.equal(cells.dangerModeAt(config, core, nodes, 'middle_vein', pointKm), 'pvpBlack', 'the core is black');
  const capital = nodes[config.capitals[0]];
  assert.equal(cells.dangerModeAt(config, capital, nodes, 'silent_ring', pointKm), 'peaceful', 'a capital is peaceful even in a red region');
  const ring = { x: capital.x + (config.safeRadiusKm + 2) / pointKm, y: capital.y };
  assert.equal(cells.dangerModeAt(config, ring, nodes, 'silent_ring', pointKm), 'pve', 'the belt around a capital is blue');
  assert.equal(cells.dangerModeAt(config, { x: -500, y: -500 }, nodes, 'silent_ring', pointKm), 'pvpFullDrop', 'the outer region is red');
  assert.equal(cells.dangerModeAt(config, { x: -500, y: -500 }, nodes, 'middle_vein', pointKm), 'pvp', 'other wild land is yellow');
}

// --- стороны входа ----------------------------------------------------------------------
assert.equal(cells.entryKeyForDirection('north'), 'entryFromSouth');
assert.equal(cells.entryKeyForDirection('west'), 'entryFromEast');
assert.equal(cells.entryKeyForDirection('up'), 'entryFromWorld');

console.log('Danger colours OK: black core, peaceful capitals with blue belts, red outer regions, entry sides.');
