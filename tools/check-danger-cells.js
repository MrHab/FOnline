#!/usr/bin/env node
'use strict';

// Опасные клетки глобальной карты (экономика v3, библия 18.1): цвет клетки
// по правилам (чёрная Сердцевина, мирные столицы, синий пояс, красные
// внешние регионы), мелкие клетки 1,6 км как общие сцены стычек, шанс
// стычки по цвету и навыку странника, одна сцена на мелкую клетку.

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
assert.equal(economy.worldModel.dangerCells, true, 'v3 turns danger cells on');
assert.equal(config.subCellKm, 1.6, 'an encounter cell is the size of an Albion zone');
for (const id of config.capitals) assert(nodes[id], `capital ${id} is on the map`);
for (const center of config.blackCenters) assert(nodes[center.locationId], `black centre ${center.locationId} is on the map`);
for (const mode of ['pvp', 'pvpFullDrop', 'pvpBlack']) {
  assert(config.encounters[mode]?.length > 0, `mode ${mode} has an encounter pool`);
  assert(config.encounterChance[mode] > 0, `mode ${mode} rolls encounters`);
}
assert.equal(config.encounterChance.peaceful, 0);
assert.equal(config.encounterChance.pve, 0, 'blue cells leave encounters to hunting grounds');
assert(config.encounterChance.pvpBlack > config.encounterChance.pvpFullDrop
  && config.encounterChance.pvpFullDrop > config.encounterChance.pvp, 'the darker the cell, the more encounters');
const encountersCatalog = require(path.join(root, 'data', 'encounters.json')).encounters;
for (const list of Object.values(config.encounters)) {
  for (const id of list) assert(encountersCatalog[id], `encounter ${id} exists`);
}
for (const locationId of Object.values(config.templates)) {
  const loc = require(path.join(root, 'data', 'locations', `${locationId}.json`));
  assert(loc.randomTemplate === true || loc.encounterOnly === true, `${locationId} is an encounter template`);
}

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

// --- клетки карты -------------------------------------------------------------------------
{
  const modes = cells.cellDangerModes(config, map.grid, map.cells, nodes);
  assert.equal(Object.keys(modes).length, Object.keys(map.cells).length, 'every map cell gets a colour');
  const counts = {};
  for (const mode of Object.values(modes)) counts[mode] = (counts[mode] || 0) + 1;
  for (const mode of ['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack']) assert(counts[mode] > 0, `the map has ${mode} cells: ${JSON.stringify(counts)}`);
  for (const [key, cell] of Object.entries(map.cells)) {
    if (cell.pvpMode === 'peaceful') assert.equal(modes[key], 'peaceful', `authored peaceful cell ${key} stays peaceful`);
  }
}

// --- мелкие клетки и сцены -----------------------------------------------------------------
{
  const a = cells.subCellAt(config, { x: 10, y: 10 }, pointKm);
  const b = cells.subCellAt(config, { x: 10.5, y: 10.2 }, pointKm);
  const c = cells.subCellAt(config, { x: 12, y: 10 }, pointKm);
  assert.equal(a.key, b.key, 'nearby points share an encounter cell');
  assert.notEqual(a.key, c.key);
  assert.equal(cells.subCellAt(config, { x: -1, y: 0 }, pointKm).sx, -1);
  // Цвет сцены считается по центру мелкой клетки: центр лежит в ней самой,
  // и мелкая клетка на границе клеток карты получает один цвет.
  const edge = cells.subCellAt(config, { x: 169.9, y: 93 }, pointKm);
  const size = config.subCellKm / pointKm;
  assert(edge.center.x > edge.sx * size && edge.center.x < (edge.sx + 1) * size, JSON.stringify(edge));
  assert.equal(cells.subCellAt(config, edge.center, pointKm).key, edge.key, 'the centre belongs to its own cell');
  assert.equal(cells.subCellAt(config, { x: 171, y: 93 }, pointKm).key, edge.key, 'both sides of the map cell border share the scene');
  const first = cells.cellEncounter(config, 'pvpFullDrop', 'glasslands', a);
  const again = cells.cellEncounter(config, 'pvpFullDrop', 'glasslands', b);
  assert.deepEqual(first, again, 'one scene per encounter cell');
  assert(config.encounters.pvpFullDrop.includes(first.encounterId));
  assert.equal(first.pvpMode, 'pvpFullDrop');
  assert(first.roomId.startsWith(`${first.locationId}#cell_`), first.roomId);
  const negative = cells.cellEncounter(config, 'pvp', '', { key: '-3_-4' });
  assert(/^[a-zA-Z0-9_#-]+$/.test(negative.roomId) && !negative.roomId.includes('-3'), 'negative cells stay valid room ids: ' + negative.roomId);
}

// --- шанс ------------------------------------------------------------------------------
assert.equal(cells.encounterChance(config, 'pvpBlack', 0), config.encounterChance.pvpBlack);
assert.equal(cells.encounterChance(config, 'pvpBlack', 1), config.encounterChance.pvpBlack * (1 - config.wandererReduction),
  'a skilled wanderer meets less');
assert.equal(cells.encounterChance(config, 'peaceful', 0), 0);

// --- итерация 2: сквозные клетки ------------------------------------------------------
{
  assert.deepEqual([...config.sceneModes], ['pvpBlack'], 'the black core is walked on foot, red stays a chance');
  assert.equal(cells.isSceneMode(config, 'pvpBlack'), true);
  assert.equal(cells.isSceneMode(config, 'pvpFullDrop'), false);
  assert.equal(config.respawn, undefined, 'threats come with A-Life groups, not a respawn timer');
  const base = cells.subCellAt(config, { x: 170, y: 150 }, pointKm);
  const north = cells.neighbourCell(config, base, 'north', pointKm);
  assert.deepEqual([north.sx, north.sy], [base.sx, base.sy - 1]);
  assert.deepEqual([cells.neighbourCell(config, base, 'east', pointKm).sx], [base.sx + 1]);
  assert.equal(cells.neighbourCell(config, base, 'up', pointKm), null);
  // Движение на север — вход с юга; сторона считается по смещению.
  assert.equal(cells.entryKeyForDirection('north'), 'entryFromSouth');
  assert.equal(cells.entryKeyForDirection('west'), 'entryFromEast');
  assert.equal(cells.directionBetween({ x: 0, y: 10 }, { x: 0.2, y: 8 }), 'north');
  assert.equal(cells.directionBetween({ x: 0, y: 0 }, { x: -3, y: 1 }), 'west');
  // Точка у общей границы лежит в соседней клетке и держит положение вдоль края.
  const size = config.subCellKm / pointKm;
  const edge = cells.boundaryPoint(config, base, 'east', pointKm, 0.25);
  assert.equal(cells.subCellAt(config, edge, pointKm).key, cells.neighbourCell(config, base, 'east', pointKm).key);
  assert(Math.abs(edge.y - (base.sy + 0.25) * size) < 1e-9, JSON.stringify(edge));
  const top = cells.boundaryPoint(config, base, 'north', pointKm, 0.5);
  assert.equal(cells.subCellAt(config, top, pointKm).key, north.key);
  const custom = cells.normalizeDangerCellConfig({ sceneModes: ['pvpBlack', 'pvpFullDrop', 'bogus'] });
  assert.deepEqual([...custom.sceneModes], ['pvpBlack', 'pvpFullDrop']);
}

console.log('Danger cells OK: black core, peaceful capitals with blue belts, red outer regions, 1.6 km encounter cells with one shared scene each, encounter chances by colour and wanderer skill, and walk cells with neighbours, entry sides and border points.');
