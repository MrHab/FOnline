#!/usr/bin/env node
'use strict';

// Стартовый набор кусков‑заготовок конструктора зон: data/zones/chunks/*.json.
// Куски — рабочий материал: их правят руками и экспортируют из Unity, поэтому
// существующий файл инструмент не трогает (перезапись — только с --force).
// Координаты — метры от центра слота 40×40 м, поворот ry — градусы.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeChunk, normalizeKit } = require('../src/server/zone-chunks');

const root = path.resolve(__dirname, '..');
const zonesDir = path.join(root, 'data', 'zones');
const chunkDir = path.join(zonesDir, 'chunks');
const force = process.argv.includes('--force');
const kit = normalizeKit(JSON.parse(fs.readFileSync(path.join(zonesDir, 'kit.json'), 'utf8')));

const o = (id, prefab, x, z, ry = 0, extra = {}) => ({ id, prefab, x, z, ry, ...extra });
const a = (id, type, x, z, extra = {}) => ({ id, type, x, z, ...extra });
const chunk = (id, kind, name, objects, anchors = [], extra = {}) => ({
  schema: 'kromka.zoneChunk.v1', id, kind, name, biomes: ['*'], modes: ['*'], weight: 3, maxPerZone: 3,
  rotations: [0, 90, 180, 270], ...extra, objects, anchors
});
const DANGER = ['pvp', 'pvpFullDrop', 'pvpBlack'];
const WILD = ['pve', ...DANGER];

// Отрезок стены из сегментов бетонной стены (1,8 м каждый) вдоль оси.
const wall = (id, x0, z0, axis, n, step = 1.8) => Array.from({ length: n }, (_, i) => o(`${id}${i}`, 'concrete_wall',
  axis === 'x' ? x0 + i * step : x0, axis === 'z' ? z0 + i * step : z0, axis === 'x' ? 0 : 90));
const scatter = (prefabs, count, extra = {}) => ({ prefabs, count, ...extra });
const BUSH = ['dry_bush'];
const DEBRIS = ['perimeter_debris'];
const TREES = ['dead_tree_a', 'dead_tree_c'];
const ROCKS = ['rubble_rock'];
const JUNK = ['tire_stack', 'rust_barrel_v1', 'perimeter_debris'];

const chunks = [
  // --- заполнители: пустошь между местами --------------------------------------------------
  chunk('filler_dead_grove', 'filler', 'Сухостой', [o('w1', 'deadwood', 5, 14, 75)], [], {
    weight: 5, maxPerZone: 14,
    scatter: [scatter(TREES, [9, 15], { spacing: 3.5, scale: [1.2, 2] }), scatter(BUSH, [12, 20], { scale: [1, 1.9] }), scatter(['deadwood'], [1, 3], { spacing: 6 })]
  }),
  chunk('filler_rock_field', 'filler', 'Каменная россыпь', [], [], {
    weight: 5, maxPerZone: 14,
    scatter: [scatter(ROCKS, [8, 13], { spacing: 3.2, scale: [0.8, 2] }), scatter(DEBRIS, [5, 9], { scale: [0.9, 1.5] }), scatter(BUSH, [5, 9])]
  }),
  chunk('filler_scrub', 'filler', 'Сухой кустарник', [o('k1', 'rust_barrel_v1', -5, 2, 0)], [], {
    weight: 6, maxPerZone: 18,
    scatter: [scatter(BUSH, [22, 34], { spacing: 1.9, scale: [1, 2] }), scatter(DEBRIS, [3, 6])]
  }),
  chunk('filler_road_debris', 'filler', 'Брошенная дорога', [
    o('s1', 'asphalt_slab', -9, -3, 10), o('s2', 'asphalt_slab', -1, -2, 355), o('s3', 'asphalt_slab', 7, -1, 5),
    o('c1', 'car_wreck', 11, -9, 70), o('h1', 'highway_sign', -2, -12, 180)
  ], [], { weight: 4, maxPerZone: 6, scatter: [scatter(JUNK, [8, 13], { spacing: 2.5 }), scatter(BUSH, [6, 10])] }),
  chunk('filler_pole_line', 'filler', 'Линия столбов', [
    o('p1', 'utility_pole', -15, -4, 0), o('p2', 'utility_pole', -5, -3, 0), o('p3', 'utility_pole', 5, -2, 0), o('p4', 'utility_pole', 15, -1, 0)
  ], [], { weight: 3, maxPerZone: 5, scatter: [scatter(BUSH, [12, 18]), scatter(DEBRIS, [3, 5])] }),
  chunk('filler_barrels', 'filler', 'Свалка бочек', [o('c1', 'barrel_cluster', -4, -3, 25), o('c2', 'barrel_cluster', 6, 5, 200)], [], {
    weight: 3, maxPerZone: 5, scatter: [scatter(['rust_barrel_v1'], [6, 11], { spacing: 1.6, radius: 10 }), scatter(DEBRIS, [4, 8]), scatter(BUSH, [6, 10])]
  }),
  chunk('filler_open', 'filler', 'Голая земля', [], [], {
    weight: 5, maxPerZone: 18, scatter: [scatter(BUSH, [8, 14], { spacing: 3 }), scatter(DEBRIS, [3, 6]), scatter(ROCKS, [1, 3], { spacing: 8 })]
  }),
  chunk('filler_wreck_pair', 'filler', 'Два остова', [o('c1', 'car_wreck', -8, -5, 35), o('c2', 'car_wreck', 9, 7, 250)], [], {
    weight: 2, maxPerZone: 3, scatter: [scatter(JUNK, [7, 11]), scatter(BUSH, [6, 10])]
  }),

  // --- покров у центра, ворот и мест: только то, что не мешает пройти ------------------------
  chunk('cover_scrub', 'cover', 'Покров: кустарник', [], [], {
    weight: 4, maxPerZone: 20, scatter: [scatter(BUSH, [12, 18], { spacing: 2.4, scale: [0.9, 1.7] }), scatter(DEBRIS, [3, 6])]
  }),
  chunk('cover_broken_road', 'cover', 'Покров: битый асфальт', [], [], {
    weight: 2, maxPerZone: 8, scatter: [scatter(['asphalt_slab'], [3, 6], { spacing: 5 }), scatter(DEBRIS, [4, 7]), scatter(BUSH, [5, 9])]
  }),

  // --- точки интереса --------------------------------------------------------------------------
  chunk('poi_ruin_corner', 'poi', 'Угол руины', [
    ...wall('n', -9, -10, 'x', 6), ...wall('w', -10.5, -8.4, 'z', 5), ...wall('e', 3, 5, 'x', 3),
    o('r1', 'rubble_rock', 2, -2, 40), o('r2', 'rubble_rock', -4, 3, 110)
  ], [a('cache', 'container', -6, -6), a('pack', 'spawnArea', 9, 11, { radius: 8 })], { scatter: [scatter(DEBRIS, [8, 12]), scatter(BUSH, [6, 10])] }),
  chunk('poi_camp', 'poi', 'Брошенная стоянка', [
    o('f1', 'campfire_rest', 0, 0, 0), o('c1', 'cot_bed', -4, 3, 20), o('c2', 'cot_bed', 3, -4, 110), o('l1', 'storage_lean_to', 7, 6, 200),
    o('l2', 'storage_lean_to', -7, 6, 160), o('k1', 'rust_barrel_v1', -7, -6, 0), o('b1', 'barrel_cluster', 8, -7, 30)
  ], [a('cache', 'container', 5, 9, { tier: 'survival' }), a('event', 'eventAnchor', -11, 11, { radius: 9 })], { scatter: [scatter(BUSH, [8, 12]), scatter(DEBRIS, [5, 8])] }),
  chunk('poi_checkpoint', 'poi', 'Заброшенный пост', [
    o('b1', 'roadblock_barricade', -6, -2, 0), o('b2', 'roadblock_barricade', -3, -2, 0), o('b3', 'roadblock_barricade', 4, 2, 0),
    o('p1', 'watch_post', -10, 6, 180), o('s1', 'scrap_wall_segment', 0, 12, 0), o('h1', 'highway_sign', 12, -8, 270), o('t1', 'tire_stack', 7, -5, 0)
  ], [a('pack', 'spawnArea', 0, -12, { radius: 8 }), a('cache', 'container', -8, 9, { tier: 'ammo' })], { modes: WILD, scatter: [scatter(JUNK, [6, 9]), scatter(BUSH, [6, 10])] }),
  chunk('poi_shack', 'poi', 'Лачуга', [
    o('s1', 'wasteland_shack', 0, -2, 0), o('f1', 'fence_segment', -8, 8, 0), o('f2', 'fence_segment', -5.6, 8, 0), o('f3', 'fence_segment', 6, 8, 0),
    o('k1', 'rust_barrel_v1', 6, -8, 0), o('t1', 'dead_tree_a', -12, -10, 0, { s: 1.6 }), o('g1', 'garden_patch', 9, 2, 90)
  ], [a('cache', 'container', 0, 5, { tier: 'basic' }), a('pack', 'spawnArea', 12, 12, { radius: 7 })], { scatter: [scatter(BUSH, [10, 14]), scatter(DEBRIS, [4, 7])] }),
  chunk('poi_depot', 'poi', 'Перевалочный склад', [
    o('g1', 'cargo_stack', -7, -6, 0), o('g2', 'cargo_stack', -7, -3.5, 0), o('g3', 'cargo_stack', -7, -1, 0), o('g4', 'cargo_stack', 5, -8, 90),
    o('b1', 'barrel_cluster', 8, 5, 30), o('l1', 'storage_lean_to', -2, 10, 180), o('l2', 'storage_lean_to', 3, 10, 180), o('w1', 'workshop_bench', 4, 0, 0)
  ], [a('cache', 'container', 1, -3, { tier: 'tools' }), a('event', 'eventAnchor', 12, -12, { radius: 9 })], { scatter: [scatter(JUNK, [6, 10]), scatter(BUSH, [5, 8])] }),
  chunk('poi_watchtower', 'poi', 'Дозорная вышка', [
    o('t1', 'scrap_watch_tower', 0, 0, 0, { s: 2.4 }), o('s1', 'scrap_wall_segment', 0, -9, 0), o('s2', 'scrap_wall_segment', -9, 2, 90),
    o('k1', 'rust_barrel_v1', 5, 6, 0), o('k2', 'rust_barrel_v1', 6, 7, 40)
  ], [a('pack', 'spawnArea', 10, 10, { radius: 8 })], { modes: WILD, scatter: [scatter(BUSH, [8, 12]), scatter(DEBRIS, [4, 7])] }),
  chunk('poi_anomaly_glade', 'poi', 'Аномальная поляна', [
    o('r1', 'rubble_rock', -12, -6, 0, { s: 1.6 }), o('r2', 'rubble_rock', 11, -9, 90, { s: 1.5 }), o('r3', 'rubble_rock', 9, 11, 180, { s: 1.7 }),
    o('t1', 'dead_tree_c', -10, 12, 0, { s: 1.8 }), o('t2', 'dead_tree_a', 12, 3, 0, { s: 1.6 })
  ], [a('anom1', 'anomaly', -3, 0, { radius: 3.2 }), a('anom2', 'anomaly', 5, 3, { radius: 2.8 }), a('cache', 'container', 0, -12, { tier: 'rare' })],
  { modes: DANGER, maxPerZone: 3, scatter: [scatter(DEBRIS, [6, 9], { spacing: 3 })] }),
  chunk('poi_garden', 'poi', 'Заброшенный огород', [
    o('g1', 'garden_patch', -5, -4, 0), o('g2', 'garden_patch', 0, -4, 0), o('g3', 'garden_patch', 5, -4, 0), o('p1', 'brahmin_pen', 0, 8, 0),
    o('f1', 'fence_segment', -9, 2, 90), o('f2', 'fence_segment', 9, 2, 90), o('s1', 'wasteland_shack', -11, 11, 90)
  ], [a('event', 'eventAnchor', 12, 12, { radius: 8 })], { modes: ['peaceful', 'pve'], scatter: [scatter(BUSH, [8, 12])] }),

  // --- ориентиры: по одному на зону, у центра, видно издалека ----------------------------------
  chunk('landmark_relay_mast', 'landmark', 'Мачта связи', [
    o('m1', 'relay_antenna', 0, 0, 0, { s: 2.2 }), ...wall('w', -8, -8, 'x', 4), ...wall('v', -9.5, -6, 'z', 4),
    o('p1', 'utility_pole', 12, 8, 0), o('p2', 'utility_pole', -12, 12, 0), o('b1', 'workshop_bench', 5, 8, 0)
  ], [a('cache', 'container', -4, 6, { tier: 'tools' }), a('event', 'eventAnchor', 0, -14, { radius: 10 })], { maxPerZone: 1, scatter: [scatter(DEBRIS, [6, 10]), scatter(BUSH, [6, 10])] }),
  chunk('landmark_tank_yard', 'landmark', 'Двор цистерн', [
    o('t1', 'water_tank', -5, -3, 0, { s: 2.2 }), o('t2', 'water_tank', 3, -5, 40, { s: 2 }), o('b1', 'workshop_bench', 7, 5, 90), o('l1', 'storage_lean_to', -7, 8, 180),
    o('s1', 'scrap_wall_segment', 0, -13, 0), o('s2', 'scrap_wall_segment', 13, 0, 90), o('s3', 'scrap_wall_segment', -13, 0, 90)
  ], [a('cache', 'container', 0, 3, { tier: 'basic' }), a('event', 'eventAnchor', -12, -12, { radius: 9 })], { maxPerZone: 1, scatter: [scatter(JUNK, [6, 9]), scatter(BUSH, [5, 8])] }),
  chunk('landmark_billboard_crossing', 'landmark', 'Перекрёсток со щитами', [
    o('b1', 'ruined_billboard', -9, -8, 20, { s: 2 }), o('b2', 'ruined_billboard', 10, 7, 200, { s: 2 }), o('h1', 'highway_sign', 0, -13, 0), o('c1', 'car_wreck', 7, -6, 120),
    o('s1', 'asphalt_slab', -3, 2, 0), o('s2', 'asphalt_slab', 3, 6, 90), o('s3', 'asphalt_slab', -2, -4, 10)
  ], [a('event', 'eventAnchor', -12, 12, { radius: 10 }), a('cache', 'container', 12, -12, { tier: 'wasteland' })], { maxPerZone: 1, scatter: [scatter(JUNK, [6, 10]), scatter(BUSH, [5, 8])] }),

  // --- ресурсные участки ----------------------------------------------------------------------
  chunk('resource_ore_field', 'resource', 'Рудный выход', [
    o('o1', 'ore_outcrop', -8, -6, 0), o('o2', 'ore_outcrop', 3, -10, 70), o('o3', 'ore_outcrop', 9, 4, 160), o('o4', 'ore_outcrop', -3, 9, 250)
  ], [a('pack', 'spawnArea', 0, 0, { radius: 9 })], { maxPerZone: 4, scatter: [scatter(ROCKS, [5, 8], { spacing: 4, scale: [0.9, 1.8] }), scatter(DEBRIS, [3, 6])] }),
  chunk('resource_scrap_yard', 'resource', 'Свалка лома', [
    o('s1', 'scrap_heap', -7, -7, 0), o('s2', 'scrap_heap', 5, -9, 60), o('s3', 'scrap_heap', 8, 6, 150), o('s4', 'scrap_heap', -6, 8, 240),
    o('c1', 'car_wreck', 13, -2, 90)
  ], [a('pack', 'spawnArea', -12, 0, { radius: 8 })], { maxPerZone: 4, scatter: [scatter(JUNK, [8, 12]), scatter(BUSH, [4, 7])] }),
  chunk('resource_oil_seep', 'resource', 'Нефтяной выход', [
    o('p1', 'oil_pump_jack', 0, 0, 0, { s: 1.4 }), o('b1', 'barrel_cluster', 8, -6, 45), o('b2', 'barrel_cluster', -8, 5, 200)
  ], [a('cache', 'container', -6, -8, { tier: 'basic' })], { maxPerZone: 2, scatter: [scatter(['tire_stack', 'rust_barrel_v1'], [6, 10]), scatter(BUSH, [5, 8])] }),
  chunk('resource_deadwood', 'resource', 'Валежник', [
    o('w1', 'deadwood', -8, -5, 10), o('w2', 'deadwood', 4, -9, 100), o('w3', 'deadwood', 7, 7, 190), o('t1', 'dead_tree_b', -4, 8, 0, { s: 1.5 }),
    o('t2', 'dead_tree_b', 12, -2, 0, { s: 1.4 }), o('t3', 'dead_tree_b', -13, -12, 0, { s: 1.6 })
  ], [], { maxPerZone: 4, scatter: [scatter(TREES, [5, 9], { spacing: 4, scale: [1.2, 1.9] }), scatter(BUSH, [8, 12])] }),

  // --- логова A‑Life -----------------------------------------------------------------------------
  chunk('lair_den_rocks', 'lair', 'Логово в камнях', [
    o('r1', 'rubble_rock', -9, -8, 0, { s: 1.8 }), o('r2', 'rubble_rock', 0, -11, 60, { s: 2 }), o('r3', 'rubble_rock', 9, -7, 120, { s: 1.7 }),
    o('r4', 'rubble_rock', 11, 3, 180, { s: 1.6 }), o('r5', 'rubble_rock', -11, 2, 240, { s: 1.9 }), o('w1', 'deadwood', 0, 2, 0)
  ], [a('den', 'lair', 0, -3), a('pack', 'spawnArea', 0, 10, { radius: 9 }), a('pack2', 'spawnArea', -12, 12, { radius: 7 })],
  { modes: WILD, scatter: [scatter(DEBRIS, [6, 9]), scatter(BUSH, [4, 7])] }),
  chunk('lair_wreck_nest', 'lair', 'Гнездо в остовах', [
    o('c1', 'car_wreck', -7, -4, 30), o('c2', 'car_wreck', 6, -6, 200), o('c3', 'car_wreck', -2, 7, 110), o('s1', 'scrap_heap', 0, 0, 0), o('t1', 'tire_stack', 10, 8, 0)
  ], [a('den', 'lair', 0, -2), a('pack', 'spawnArea', 0, 13, { radius: 8 })], { modes: WILD, scatter: [scatter(JUNK, [7, 11])] }),
  chunk('lair_ruin_pit', 'lair', 'Логово в руине', [
    ...wall('n', -9, -8, 'x', 5), ...wall('e', 8, -8, 'z', 5), o('r1', 'rubble_rock', -10, 6, 0, { s: 1.6 }), o('r2', 'rubble_rock', 2, 4, 90, { s: 1.4 })
  ], [a('den', 'lair', 0, -3), a('pack', 'spawnArea', 2, 11, { radius: 9 }), a('cache', 'container', -6, -5, { tier: 'rare' })],
  { modes: DANGER, scatter: [scatter(DEBRIS, [6, 10])] })
];

fs.mkdirSync(chunkDir, { recursive: true });
let written = 0;
let kept = 0;
for (const row of chunks) {
  normalizeChunk(row, kit);
  const file = path.join(chunkDir, `${row.id}.json`);
  if (fs.existsSync(file) && !force) { kept += 1; continue; }
  fs.writeFileSync(file, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  written += 1;
}
console.log(`Zone starter chunks: ${written} written, ${kept} kept as they are (${chunks.length} in the starter set).`);
