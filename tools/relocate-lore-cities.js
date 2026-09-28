#!/usr/bin/env node
'use strict';

// Одноразовый перенос городов Кромки на места канона (библия, 4.4: пять городов
// фракций пятиугольником вокруг Ключей). Правит все авторские копии координат
// сразу: узлы data/global-map.json, снимок data/kromka/world-layout.seed.json
// (места и дороги), регион в data/kromka/locations.json и файле локации, точку
// базы в data/kromka/territory.json и обзор размещения. После него:
//   node tools/build-kromka-runtime-world.js --sync-authored
//   node tools/build-zone-graph.js
// Повторный запуск ничего не меняет.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const file = rel => path.join(ROOT, rel);
const read = rel => JSON.parse(fs.readFileSync(file(rel), 'utf8'));
const write = (rel, value) => fs.writeFileSync(file(rel), JSON.stringify(value, null, 2) + '\n');

// Центры секторов канона: x = col·20 + 10, y = row·20 + 10 (км карты).
const MOVES = {
  sluiceCity: { x: 170, y: 270, region: 'northern_sluices' },   // z_08_13
  scrapTown: { x: 70, y: 170, region: 'ore_arc' },              // z_03_08
  relayStation: { x: 310, y: 210, region: 'glasslands' },       // z_15_10
  secondHaven: { x: 290, y: 70, region: 'chalk_lowland' },      // z_14_03
  caravanCamp: { x: 155, y: 52, region: 'zero_basin' },         // z_07_02, у Нижнего обхода
  settlement: { x: 210, y: 150, region: 'middle_vein' },        // z_10_07 — центр
  // Места, что стояли в новых секторах городов: город занимает сектор целиком.
  resourceOilPump: { x: 168, y: 34, region: 'zero_basin' },     // z_08_01 (библия, 6)
  coreBaseLeague: { x: 210, y: 127, region: 'tract_isthmus' }   // z_10_06, рядом с Ключами
};

// Железная ветвь по лору связывает Рудную дугу, Ключи и Стеколье: продлевается
// до Контура-3. Дорога к Топливной рампе кончается у рампы.
function patchRoutes(routes) {
  for (const route of routes) {
    if (route.id === 'ore_freight_rail') {
      const last = route.points[route.points.length - 1];
      const relay = MOVES.relayStation;
      if (last[0] !== relay.x || last[1] !== relay.y) route.points.push([relay.x, relay.y]);
    }
    if (route.id === 'fuel_ramp_access') {
      route.points[route.points.length - 1] = [MOVES.resourceOilPump.x, MOVES.resourceOilPump.y];
    }
  }
}

const map = read('data/global-map.json');
for (const node of map.nodes) {
  const move = MOVES[node.id];
  if (!move) continue;
  node.x = move.x;
  node.y = move.y;
  node.macroRegion = move.region;
}
// Сервер хранит дороги копией в infrastructure — она обязана совпадать со снимком.
const seed = read('data/kromka/world-layout.seed.json');
for (const location of seed.locations) {
  const move = MOVES[location.id];
  if (!move) continue;
  location.x = move.x;
  location.z = move.y;
}
patchRoutes(seed.routes);
for (const route of seed.routes) {
  const exported = (map.infrastructure || []).find(row => row.id === route.id);
  if (exported) exported.points = route.points.map(([x, y], index) => ({ ...(exported.points[index] || {}), x, y }));
}
write('data/global-map.json', map);
write('data/kromka/world-layout.seed.json', seed);

// Эти файлы не в формате JSON.stringify: меняется только строка региона.
function patchRegionText(rel, id, region) {
  const text = fs.readFileSync(file(rel), 'utf8');
  const start = rel.endsWith(`${id}.json`) ? 0 : text.indexOf(`"id": "${id}"`);
  if (start < 0) return;
  const at = text.indexOf('"macroRegion": "', start);
  if (at < 0 || (start > 0 && at - start > 400)) return;
  const valueStart = at + '"macroRegion": "'.length;
  const valueEnd = text.indexOf('"', valueStart);
  if (text.slice(valueStart, valueEnd) === region) return;
  fs.writeFileSync(file(rel), text.slice(0, valueStart) + region + text.slice(valueEnd));
}
for (const [id, move] of Object.entries(MOVES)) {
  patchRegionText('data/kromka/locations.json', id, move.region);
  const rel = `data/locations/${id}.json`;
  if (fs.existsSync(file(rel))) patchRegionText(rel, id, move.region);
}

const territory = read('data/kromka/territory.json');
(function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.baseLocationId && MOVES[value.baseLocationId] && value.mapPoint) {
    value.mapPoint.x = MOVES[value.baseLocationId].x;
    value.mapPoint.z = MOVES[value.baseLocationId].y;
  }
  for (const child of Object.values(value)) walk(child);
})(territory);
write('data/kromka/territory.json', territory);

const reviewRel = 'docs/art/reviews/global-map-lore-placement-2026-09-13.json';
const review = read(reviewRel);
for (const row of review.locations) if (MOVES[row.id]) { row.x = MOVES[row.id].x; row.y = MOVES[row.id].y; }
write(reviewRel, review);

console.log(`Relocated ${Object.keys(MOVES).length} sites to the canon layout.`);
