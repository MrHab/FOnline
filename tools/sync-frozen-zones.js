#!/usr/bin/env node
'use strict';

// Сверить закреплённые секторы (data/zones/authored) с графом зон, не трогая
// их раскладку. Когда города переезжают или меняется цвет зон, у соседей
// меняются цель и подпись ворот, режим PvP и название; раскладку объектов и
// сцену Unity это не задевает. Скрипт берёт эти поля у свежей сборки
// конструктора (buildZone) и переносит в файл сектора.
//
//   node tools/sync-frozen-zones.js          — переписать расходящиеся файлы
//   node tools/sync-frozen-zones.js --check  — только сообщить, что разошлось

const fs = require('node:fs');
const path = require('node:path');
const { zoneRecipe } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'data', 'zones', 'authored');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
const check = process.argv.includes('--check');

// Поля верхнего уровня, которые определяет граф, а не раскладка.
const GRAPH_FIELDS = ['name', 'safe', 'pvpMode', 'noRespawn'];
// Поля сведений о секторе (zone), которые определяет граф.
const ZONE_FIELDS = ['n', 'region', 'mode', 'difficulty'];
// Поля ворот (переходов zoneGate), которые определяет граф.
const GATE_FIELDS = ['to', 'label', 'targetMode'];

const drifted = [];
for (const name of fs.readdirSync(dir).filter(entry => entry.endsWith('.json')).sort()) {
  const zoneId = name.slice(0, -5);
  const zone = graph.zones.find(row => row.id === zoneId);
  if (!zone || zone.city) continue; // сектор города закрепляет tools/bake-city-scene.js
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  const frozen = JSON.parse(text);
  const built = buildZone(zoneRecipe(graph, zoneId), catalog);
  const changes = [];
  for (const key of GRAPH_FIELDS) {
    if (JSON.stringify(frozen[key]) === JSON.stringify(built[key])) continue;
    changes.push(key);
    if (built[key] === undefined) delete frozen[key];
    else frozen[key] = built[key];
  }
  // Сведения о секторе в графе: режим, сложность, номер, регион и цели ворот.
  // Прочее в zone (куски, точки появления, якоря) — раскладка, её не трогаем.
  if (frozen.zone && built.zone) {
    for (const key of ZONE_FIELDS) {
      if (JSON.stringify(frozen.zone[key]) === JSON.stringify(built.zone[key])) continue;
      changes.push(`zone.${key}`);
      frozen.zone[key] = built.zone[key];
    }
    const builtByDir = new Map((built.zone.gates || []).map(gate => [gate.dir, gate]));
    for (const gate of frozen.zone.gates || []) {
      const fresh = builtByDir.get(gate.dir);
      if (!fresh || gate.to === fresh.to) continue;
      changes.push(`zone.gates.${gate.dir}`);
      gate.to = fresh.to;
    }
  }
  const builtGates = new Map((built.transitions || []).filter(row => row.type === 'zoneGate').map(row => [row.id, row]));
  for (const row of frozen.transitions || []) {
    const fresh = row.type === 'zoneGate' ? builtGates.get(row.id) : null;
    if (!fresh) continue;
    for (const key of GATE_FIELDS) {
      if (JSON.stringify(row[key]) === JSON.stringify(fresh[key])) continue;
      changes.push(`${row.id}.${key}`);
      if (fresh[key] === undefined) delete row[key];
      else row[key] = fresh[key];
    }
  }
  if (!changes.length) continue;
  drifted.push(`${zoneId}: ${changes.join(', ')}`);
  if (!check) fs.writeFileSync(file, `${JSON.stringify(frozen, null, 2)}\n`);
}

if (check) {
  if (drifted.length) {
    console.error(`Frozen sectors drift from the zone graph (run node tools/sync-frozen-zones.js):\n${drifted.join('\n')}`);
    process.exit(1);
  }
  console.log('Frozen sectors match the zone graph.');
} else {
  console.log(`Synced ${drifted.length} frozen sector(s) with the zone graph.`);
}
