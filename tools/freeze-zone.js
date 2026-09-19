#!/usr/bin/env node
'use strict';

// Закрепить зону мира: собрать её конструктором и записать в
// data/zones/authored/<id>.json. Дальше зону правят руками (или в Unity) —
// сервер берёт этот файл вместо генератора и сверяет его ворота с графом.
//
//   node tools/freeze-zone.js z_09_10 [--force]   закрепить (--force — поверх)
//   node tools/freeze-zone.js z_09_10 --release   вернуть зону генератору

const fs = require('node:fs');
const path = require('node:path');
const { zoneById, zoneRecipe } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');
const { frozenZoneProblems } = require('../src/server/zone-runtime');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const id = args.find(arg => !arg.startsWith('--')) || '';
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
if (!zoneById(graph, id)) {
  console.error(`Not a zone of the graph: "${id}". Usage: node tools/freeze-zone.js z_CC_RR [--force|--release]`);
  process.exit(1);
}
const dir = path.join(root, 'data', 'zones', 'authored');
const file = path.join(dir, `${id}.json`);

if (args.includes('--release')) {
  if (fs.existsSync(file)) fs.rmSync(file);
  console.log(`${id} is built by the constructor again.`);
  process.exit(0);
}
if (fs.existsSync(file) && !args.includes('--force')) {
  console.error(`${path.relative(root, file)} already exists: it may hold manual edits. Use --force to rebuild it.`);
  process.exit(1);
}
const definition = buildZone(zoneRecipe(graph, id), loadZoneCatalog(path.join(root, 'data', 'zones')));
const problems = frozenZoneProblems(graph, definition);
if (problems.length) throw new Error(problems.join('; '));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(definition, null, 2)}\n`);
console.log(`Frozen ${id} (${definition.objects.length} objects) → ${path.relative(root, file)}`);
