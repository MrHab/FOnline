#!/usr/bin/env node
'use strict';

// Закреплённые зоны: файл data/zones/authored/<id>.json заменяет генератор,
// его ревизия идёт от содержимого (правка файла видна клиентам), а файл,
// разошедшийся с графом (ворота не туда, нет точки входа или портала места),
// сервер не принимает. Все закреплённые зоны игры сверяются с графом.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createZoneRuntime, frozenZoneProblems } = require('../src/server/zone-runtime');
const { zoneOfPlace, zoneRecipe } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
// Ключи занимают свой сектор целиком, конструктор их не собирает: берём соседнюю зону.
const home = graph.zones.find(zone => zone.id === zoneOfPlace(graph, 'settlement').edges.north.to);

// Временный каталог зон с тем же набором и кусками и одной закреплённой зоной.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-zone-freeze-'));
try {
  fs.copyFileSync(path.join(root, 'data', 'zones', 'kit.json'), path.join(scratch, 'kit.json'));
  fs.cpSync(path.join(root, 'data', 'zones', 'chunks'), path.join(scratch, 'chunks'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'authored'));
  const generated = buildZone(zoneRecipe(graph, home.id), catalog);
  assert.deepEqual(frozenZoneProblems(graph, generated), [], 'a zone of the constructor fits the graph');
  const edited = JSON.parse(JSON.stringify(generated));
  edited.name = 'Ключевая пустошь (правка)';
  edited.objects = edited.objects.slice(0, 10);
  fs.writeFileSync(path.join(scratch, 'authored', `${home.id}.json`), JSON.stringify(edited));

  const runtime = createZoneRuntime({ graph, zonesDir: scratch, normalize: row => row });
  const locations = {};
  runtime.registerStubs(locations);
  const loaded = runtime.ensure(locations, home.id);
  assert.equal(loaded.name, 'Ключевая пустошь (правка)', 'the frozen file replaces the constructor');
  assert.equal(loaded.objects.length, 10);
  assert(loaded.frozen === true && /^f-[0-9a-f]{8}$/.test(loaded.revision), 'a frozen zone gets a content revision: ' + loaded.revision);
  assert.notEqual(loaded.revision, generated.revision, 'an edit changes the revision');
  const other = runtime.ensure(locations, home.edges.north.to);
  assert(!other.frozen, 'other zones still come from the constructor');

  const broken = JSON.parse(JSON.stringify(generated));
  broken.transitions = broken.transitions.filter(row => row.direction !== 'north');
  const problems = frozenZoneProblems(graph, broken);
  assert(problems.some(text => /north gate/.test(text)), 'a missing gate is caught: ' + problems.join('; '));
  const place = home.places[0].locationId;
  delete broken[`entryFromPlace_${place}`.slice(0, 32)];
  assert(frozenZoneProblems(graph, broken).some(text => new RegExp('exit point from ' + place).test(text)), 'a missing place exit is caught');
  fs.writeFileSync(path.join(scratch, 'authored', `${home.id}.json`), JSON.stringify(broken));
  const strict = createZoneRuntime({ graph, zonesDir: scratch, normalize: row => row });
  const fresh = {};
  strict.registerStubs(fresh);
  assert.throws(() => strict.ensure(fresh, home.id), /no longer fits the graph/, 'the server refuses a frozen zone that left the graph');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// Закреплённые зоны самой игры.
const authoredDir = path.join(root, 'data', 'zones', 'authored');
const frozen = fs.existsSync(authoredDir) ? fs.readdirSync(authoredDir).filter(name => name.endsWith('.json')) : [];
for (const name of frozen) {
  const definition = JSON.parse(fs.readFileSync(path.join(authoredDir, name), 'utf8'));
  assert.equal(`${definition.id}.json`, name, `${name} is named after its zone`);
  assert.deepEqual(frozenZoneProblems(graph, definition), [], `${name} fits the graph`);
}

console.log(`Zone freeze OK: a frozen file replaces the constructor with a content revision, a file that left the graph is refused, ${frozen.length} frozen zones of the game fit the graph.`);
