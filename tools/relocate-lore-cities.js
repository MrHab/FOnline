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
  coreBaseLeague: { x: 210, y: 127, region: 'tract_isthmus' },  // z_10_06, рядом с Ключами
  // Клановые базы — только в красных зонах (библия, 4.3), внутри — чёрная локация.
  clanHydroNode2: { x: 230, y: 210, region: 'middle_vein' },     // z_11_10
  clanOreExchange: { x: 170, y: 170, region: 'middle_vein' },    // z_08_08
  clanFactoryCycle: { x: 150, y: 210, region: 'middle_vein' },   // z_07_10
  clanRelayEast: { x: 250, y: 190, region: 'glasslands' },       // z_12_09
  clanChalkSluice: { x: 290, y: 130, region: 'chalk_lowland' },  // z_14_06
  clanFortZero: { x: 218, y: 44, region: 'zero_basin' },         // z_10_02, конец южной служебной дороги
  // Места по таблице раздела 6: «Вектор» — в красный клин, поля — в синие у Раздолья.
  vectorLab: { x: 290, y: 150, region: 'glasslands' },           // z_14_07
  resourceScrapFields: { x: 50, y: 190, region: 'ore_arc' }      // z_02_09
};

// Клановые базы — чёрные локации: внутри выпадает всё (библия, 4.3 и 16.5).
const CLAN_BASES = ['clanHydroNode2', 'clanFilterT6', 'clanOreExchange', 'clanFactoryCycle',
  'clanDepotBypass', 'clanRelayEast', 'clanChalkSluice', 'clanFortZero'];

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
    // Южная служебная дорога доходит до Форта 14 на его новом месте.
    if (route.id === 'zero_admin_access') {
      const last = route.points[route.points.length - 1];
      const fort = MOVES.clanFortZero;
      if (last[0] !== fort.x || last[1] !== fort.y) route.points.push([fort.x, fort.y]);
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

for (const id of CLAN_BASES) {
  const rel = `data/locations/${id}.json`;
  const text = fs.readFileSync(file(rel), 'utf8');
  const next = text.replace(/("pvpMode": ")[a-zA-Z]+(")/, '$1pvpBlack$2');
  if (next !== text) fs.writeFileSync(file(rel), next);
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
