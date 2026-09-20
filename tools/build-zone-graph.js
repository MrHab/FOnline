#!/usr/bin/env node
'use strict';

// Собирает граф зон мира data/kromka/zone-graph.json из карты, играбельного
// контура, правил цвета опасности и ручных правок data/kromka/zone-graph.overrides.json
// (закрытые рёбра, имена зон, закрепы кусков). `--check` ничего не пишет и падает,
// если файл на диске отстал от данных.

const fs = require('node:fs');
const path = require('node:path');
const { buildZoneGraph } = require('../src/server/zone-graph');
const { loadWorldEconomy } = require('../src/server/world-economy');

const root = path.resolve(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));
const graphFile = path.join(root, 'data', 'kromka', 'zone-graph.json');
const overridesFile = path.join(root, 'data', 'kromka', 'zone-graph.overrides.json');

function buildFromData() {
  const seed = readJson('data', 'kromka', 'world-layout.seed.json');
  const locations = readJson('data', 'kromka', 'locations.json');
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
  // Город занимает сектор целиком, и правила сектора — правила самой городской локации.
  const locationModes = Object.fromEntries((overrides.cities || [])
    .map(id => [id, readJson('data', 'locations', `${id}.json`).pvpMode])
    .filter(([, mode]) => mode));
  return buildZoneGraph({
    globalMap: readJson('data', 'global-map.json'),
    contour: readJson('data', 'kromka', 'global-map-playable.json'),
    dangerConfig: loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json')).dangerCells,
    regionNames: Object.fromEntries(seed.regions.map(region => [region.id, region.displayName || region.id])),
    locationNames: Object.fromEntries(locations.locations.map(row => [row.id, row.displayName || row.id])),
    locationModes,
    overrides
  });
}

function serialize(graph) { return `${JSON.stringify(graph, null, 1)}\n`; }

if (require.main === module) {
  const text = serialize(buildFromData());
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(graphFile) ? fs.readFileSync(graphFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (onDisk !== text) {
      console.error('data/kromka/zone-graph.json is stale: run `node tools/build-zone-graph.js`.');
      process.exit(1);
    }
    console.log('Zone graph file is up to date.');
  } else {
    fs.writeFileSync(graphFile, text, 'utf8');
    const graph = JSON.parse(text);
    const byMode = graph.zones.reduce((acc, zone) => ({ ...acc, [zone.mode]: (acc[zone.mode] || 0) + 1 }), {});
    console.log(`Zone graph: ${graph.zones.length} zones on a ${graph.grid.cols}×${graph.grid.rows} grid, ${JSON.stringify(byMode)}, ${text.length} bytes.`);
  }
}

module.exports = { buildFromData, serialize };
