#!/usr/bin/env node
'use strict';

// Закрепить сектор мира: собрать его конструктором, записать в
// data/zones/authored/<id>.json и отдать его сцене Unity. Дальше сектор правят
// в редакторе — сервер берёт этот файл вместо генератора и сверяет его ворота
// с графом, а клиент грузит сцену вместо сборки на лету.
//
//   node tools/freeze-zone.js z_09_10 [--force]   закрепить (--force — поверх)
//   node tools/freeze-zone.js --all               закрепить все секторы мира
//   node tools/freeze-zone.js z_09_10 --release   вернуть сектор генератору
//
// Сцену раскладывает Unity: «Кромка → Собрать сектор в сцену» (в пакете —
// KromkaZoneSceneBuilder.RunBatch), обратно правки идут обычным экспортом.

const fs = require('node:fs');
const path = require('node:path');
const { zoneById, zoneRecipe } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');
const { frozenZoneProblems } = require('../src/server/zone-runtime');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const all = args.includes('--all');
const id = args.find(arg => !arg.startsWith('--')) || '';
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
if (!all && !zoneById(graph, id)) {
  console.error(`Not a zone of the graph: "${id}". Usage: node tools/freeze-zone.js <z_CC_RR|--all> [--force|--release]`);
  process.exit(1);
}
const dir = path.join(root, 'data', 'zones', 'authored');
// Ревизия мира Unity: её же ставит экспорт сцены (KromkaLocationAuthoring).
const WORLD_REVISION = 'kromka-1';
// Города занимают свой сектор целиком, их закрепляет tools/bake-city-scene.js.
const sectors = all ? graph.zones.filter(zone => !zone.city).map(zone => zone.id) : [id];

if (args.includes('--release')) {
  let released = 0;
  for (const zoneId of sectors) {
    const file = path.join(dir, `${zoneId}.json`);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file);
    released += 1;
  }
  console.log(`Built by the constructor again: ${released} sector(s).`);
  process.exit(0);
}

const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
fs.mkdirSync(dir, { recursive: true });
let frozen = 0;
for (const zoneId of sectors) {
  const file = path.join(dir, `${zoneId}.json`);
  if (fs.existsSync(file) && !args.includes('--force')) {
    if (all) continue;
    console.error(`${path.relative(root, file)} already exists: it may hold manual edits. Use --force to rebuild it.`);
    process.exit(1);
  }
  const built = buildZone(zoneRecipe(graph, zoneId), catalog);
  const problems = frozenZoneProblems(graph, built);
  if (problems.length) throw new Error(problems.join('; '));
  const definition = {
    ...built,
    // Сектор живёт в своей сцене: клиент грузит её, а не собирает объекты заново.
    unityScene: `Assets/Scenes/Kromka/Locations/${zoneId}.unity`,
    worldRevision: WORLD_REVISION,
    runtimeMode: 'unity-authored',
    // Своих профилей у сектора нет — вид он берёт от макрорегиона.
    kromkaVisualProfile: built.kromkaVisualProfile || 'inherit-macro-region',
    ambientProfile: built.ambientProfile || 'inherit-macro-region',
    anomalyDensity: built.anomalyDensity || 0,
    // Строки принадлежат сцене: убрав объект в Unity, экспорт уберёт и строку.
    // Без этой пометки он считал бы её чужой и оставлял бы навсегда.
    objects: (built.objects || []).map(row => ({ ...row, unityAuthored: true, worldRevision: WORLD_REVISION }))
  };
  // Ревизию считает сервер по содержимому, а «собран на лету» о секторе со
  // своей сценой говорить нечего.
  for (const key of ['revision', 'generated', 'zoneStub']) delete definition[key];
  fs.writeFileSync(file, `${JSON.stringify(definition, null, 2)}\n`);
  frozen += 1;
  if (!all) console.log(`Frozen ${zoneId} (${definition.objects.length} objects) → ${path.relative(root, file)}`);
}
if (all) console.log(`Frozen sectors: ${frozen}. Next: Unity → «Кромка → Собрать сектор в сцену».`);
