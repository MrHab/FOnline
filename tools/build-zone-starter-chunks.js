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

const chunks = [
  // --- заполнители: то, из чего состоит пустошь между местами --------------------------
  chunk('filler_dead_grove', 'filler', 'Сухостой', [
    o('t1', 'dead_tree_a', -12, -9, 20), o('t2', 'dead_tree_c', -3, -14, 110), o('t3', 'dead_tree_a', 9, -6, 200),
    o('t4', 'dead_tree_c', 13, 8, 300), o('t5', 'dead_tree_a', -8, 11, 60), o('b1', 'dry_bush', 2, 3, 0), o('b2', 'dry_bush', -15, 2, 40),
    o('w1', 'deadwood', 5, 14, 75)
  ], [], { weight: 5, maxPerZone: 8 }),
  chunk('filler_rock_field', 'filler', 'Каменная россыпь', [
    o('r1', 'rubble_rock', -11, -10, 15), o('r2', 'rubble_rock', 6, -13, 140), o('r3', 'rubble_rock', 12, 5, 260),
    o('r4', 'rubble_rock', -6, 10, 80), o('d1', 'perimeter_debris', 0, -2, 30), o('d2', 'perimeter_debris', -14, 14, 120)
  ], [], { weight: 5, maxPerZone: 8 }),
  chunk('filler_scrub', 'filler', 'Сухой кустарник', [
    o('b1', 'dry_bush', -13, -12), o('b2', 'dry_bush', -2, -8, 50), o('b3', 'dry_bush', 10, -14, 100), o('b4', 'dry_bush', 14, 2, 150),
    o('b5', 'dry_bush', 3, 11, 210), o('b6', 'dry_bush', -10, 9, 320), o('k1', 'rust_barrel_v1', -5, 2, 0)
  ], [], { weight: 6, maxPerZone: 10 }),
  chunk('filler_road_debris', 'filler', 'Брошенная дорога', [
    o('s1', 'asphalt_slab', -9, -3, 10), o('s2', 'asphalt_slab', 4, 1, 355), o('c1', 'car_wreck', 11, -9, 70),
    o('t1', 'tire_stack', -13, 8, 0), o('h1', 'highway_sign', -2, -12, 180)
  ], [], { weight: 4, maxPerZone: 5 }),
  chunk('filler_pole_line', 'filler', 'Линия столбов', [
    o('p1', 'utility_pole', -15, -4, 0), o('p2', 'utility_pole', 0, -2, 0), o('p3', 'utility_pole', 15, 0, 0),
    o('d1', 'perimeter_debris', 6, 9, 45), o('b1', 'dry_bush', -8, 12, 0)
  ], [], { weight: 3, maxPerZone: 4 }),
  chunk('filler_barrels', 'filler', 'Свалка бочек', [
    o('c1', 'barrel_cluster', -4, -3, 25), o('k1', 'rust_barrel_v1', 5, 4, 0), o('k2', 'rust_barrel_v1', 8, -7, 90),
    o('k3', 'rust_barrel_v1', -11, 8, 200), o('d1', 'perimeter_debris', 12, 12, 10)
  ], [], { weight: 3, maxPerZone: 4 }),
  chunk('filler_open', 'filler', 'Голая земля', [
    o('b1', 'dry_bush', -9, 6, 0), o('b2', 'dry_bush', 11, -10, 130), o('d1', 'perimeter_debris', 2, 13, 60)
  ], [], { weight: 6, maxPerZone: 12 }),
  chunk('filler_wreck_pair', 'filler', 'Два остова', [
    o('c1', 'car_wreck', -8, -5, 35), o('c2', 'car_wreck', 9, 7, 250), o('t1', 'tire_stack', 1, -13, 0), o('d1', 'perimeter_debris', -13, 12, 0)
  ], [], { weight: 2, maxPerZone: 3 }),

  // --- точки интереса --------------------------------------------------------------------
  chunk('poi_ruin_corner', 'poi', 'Угол руины', [
    o('w1', 'concrete_wall', -6, -10, 0), o('w2', 'concrete_wall', -2, -10, 0), o('w3', 'concrete_wall', -8, -8, 90),
    o('w4', 'concrete_wall', -8, -4, 90), o('w5', 'concrete_wall', 6, 4, 0), o('r1', 'rubble_rock', 2, -2, 40), o('d1', 'perimeter_debris', -3, -5, 0)
  ], [a('cache', 'container', -5, -7), a('pack', 'spawnArea', 8, 10, { radius: 8 })]),
  chunk('poi_camp', 'poi', 'Брошенная стоянка', [
    o('f1', 'campfire_rest', 0, 0, 0), o('c1', 'cot_bed', -5, 3, 20), o('c2', 'cot_bed', 4, -5, 110), o('l1', 'storage_lean_to', 7, 6, 200),
    o('k1', 'rust_barrel_v1', -7, -6, 0)
  ], [a('cache', 'container', 5, 8, { tier: 'survival' }), a('event', 'eventAnchor', -10, 10, { radius: 9 })]),
  chunk('poi_checkpoint', 'poi', 'Заброшенный пост', [
    o('b1', 'roadblock_barricade', -6, -2, 0), o('b2', 'roadblock_barricade', 6, 2, 0), o('p1', 'watch_post', -10, 6, 180),
    o('s1', 'scrap_wall_segment', 0, 12, 0), o('h1', 'highway_sign', 12, -8, 270)
  ], [a('pack', 'spawnArea', 0, -12, { radius: 8 }), a('cache', 'container', -8, 9, { tier: 'ammo' })], { modes: WILD }),
  chunk('poi_shack', 'poi', 'Лачуга', [
    o('s1', 'wasteland_shack', 0, -2, 0), o('f1', 'fence_segment', -8, 8, 0), o('f2', 'fence_segment', -6, 8, 0), o('f3', 'fence_segment', 8, 8, 0),
    o('k1', 'rust_barrel_v1', 6, -8, 0), o('t1', 'dead_tree_a', -12, -10, 0)
  ], [a('cache', 'container', 0, 5, { tier: 'basic' }), a('pack', 'spawnArea', 12, 12, { radius: 7 })]),
  chunk('poi_depot', 'poi', 'Перевалочный склад', [
    o('g1', 'cargo_stack', -7, -6, 0), o('g2', 'cargo_stack', -7, 0, 0), o('g3', 'cargo_stack', 5, -8, 90), o('b1', 'barrel_cluster', 8, 5, 30),
    o('l1', 'storage_lean_to', -2, 10, 180)
  ], [a('cache', 'container', 2, -2, { tier: 'tools' }), a('event', 'eventAnchor', 12, -12, { radius: 9 })]),
  chunk('poi_watchtower', 'poi', 'Дозорная вышка', [
    o('t1', 'scrap_watch_tower', 0, 0, 0), o('s1', 'scrap_wall_segment', 0, -9, 0), o('s2', 'scrap_wall_segment', -9, 2, 90), o('k1', 'rust_barrel_v1', 5, 6, 0)
  ], [a('pack', 'spawnArea', 10, 10, { radius: 8 })], { modes: WILD }),
  chunk('poi_anomaly_glade', 'poi', 'Аномальная поляна', [
    o('r1', 'rubble_rock', -12, -6, 0), o('r2', 'rubble_rock', 11, -9, 90), o('r3', 'rubble_rock', 9, 11, 180), o('t1', 'dead_tree_c', -10, 12, 0)
  ], [a('anom1', 'anomaly', -3, 0, { radius: 3.2 }), a('anom2', 'anomaly', 5, 3, { radius: 2.8 }), a('cache', 'container', 0, -12, { tier: 'rare' })],
  { modes: DANGER, maxPerZone: 3 }),
  chunk('poi_garden', 'poi', 'Заброшенный огород', [
    o('g1', 'garden_patch', -5, -4, 0), o('g2', 'garden_patch', 4, -4, 0), o('p1', 'brahmin_pen', 0, 8, 0), o('f1', 'fence_segment', -10, 2, 90),
    o('f2', 'fence_segment', 10, 2, 90)
  ], [a('event', 'eventAnchor', 12, 12, { radius: 8 })], { modes: ['peaceful', 'pve'] }),

  // --- ориентиры: по одному на зону, у центра ---------------------------------------------
  chunk('landmark_relay_mast', 'landmark', 'Мачта связи', [
    o('m1', 'relay_antenna', 0, 0, 0), o('w1', 'concrete_wall', -7, -7, 0), o('w2', 'concrete_wall', 7, -7, 0), o('w3', 'concrete_wall', -9, 3, 90),
    o('p1', 'utility_pole', 12, 8, 0), o('p2', 'utility_pole', -12, 12, 0), o('b1', 'workshop_bench', 4, 8, 0)
  ], [a('cache', 'container', -4, 6, { tier: 'tools' }), a('event', 'eventAnchor', 0, -14, { radius: 10 })], { maxPerZone: 1 }),
  chunk('landmark_tank_yard', 'landmark', 'Двор цистерн', [
    o('t1', 'water_tank', -5, -3, 0), o('t2', 'water_tank', 3, -5, 40), o('b1', 'workshop_bench', 7, 5, 90), o('l1', 'storage_lean_to', -7, 8, 180),
    o('s1', 'scrap_wall_segment', 0, -13, 0), o('s2', 'scrap_wall_segment', 13, 0, 90)
  ], [a('cache', 'container', 0, 3, { tier: 'basic' }), a('event', 'eventAnchor', -13, -13, { radius: 9 })], { maxPerZone: 1 }),
  chunk('landmark_billboard_crossing', 'landmark', 'Перекрёсток со щитами', [
    o('b1', 'ruined_billboard', -9, -8, 20), o('b2', 'ruined_billboard', 10, 7, 200), o('h1', 'highway_sign', 0, -13, 0), o('c1', 'car_wreck', 7, -6, 120),
    o('s1', 'asphalt_slab', -3, 2, 0), o('s2', 'asphalt_slab', 3, 6, 90)
  ], [a('event', 'eventAnchor', -12, 12, { radius: 10 }), a('cache', 'container', 12, -12, { tier: 'wasteland' })], { maxPerZone: 1 }),

  // --- ресурсные участки ------------------------------------------------------------------
  chunk('resource_ore_field', 'resource', 'Рудный выход', [
    o('o1', 'ore_outcrop', -8, -6, 0), o('o2', 'ore_outcrop', 3, -10, 70), o('o3', 'ore_outcrop', 9, 4, 160), o('o4', 'ore_outcrop', -3, 9, 250),
    o('r1', 'rubble_rock', 12, -12, 0), o('r2', 'rubble_rock', -13, 10, 90)
  ], [a('pack', 'spawnArea', 0, 0, { radius: 9 })], { maxPerZone: 4 }),
  chunk('resource_scrap_yard', 'resource', 'Свалка лома', [
    o('s1', 'scrap_heap', -7, -7, 0), o('s2', 'scrap_heap', 5, -9, 60), o('s3', 'scrap_heap', 8, 6, 150), o('s4', 'scrap_heap', -6, 8, 240),
    o('t1', 'tire_stack', 0, 0, 0), o('c1', 'car_wreck', 13, -2, 90)
  ], [a('pack', 'spawnArea', -12, 0, { radius: 8 })], { maxPerZone: 4 }),
  chunk('resource_oil_seep', 'resource', 'Нефтяной выход', [
    o('p1', 'oil_pump_jack', 0, 0, 0), o('t1', 'tire_stack', -8, 5, 0), o('b1', 'barrel_cluster', 8, -6, 45), o('k1', 'rust_barrel_v1', 5, 9, 0)
  ], [a('cache', 'container', -6, -8, { tier: 'basic' })], { maxPerZone: 2 }),
  chunk('resource_deadwood', 'resource', 'Валежник', [
    o('w1', 'deadwood', -8, -5, 10), o('w2', 'deadwood', 4, -9, 100), o('w3', 'deadwood', 7, 7, 190), o('t1', 'dead_tree_b', -4, 8, 0),
    o('t2', 'dead_tree_b', 12, -2, 0), o('t3', 'dead_tree_b', -13, -12, 0)
  ], [], { maxPerZone: 4 }),

  // --- логова A‑Life ------------------------------------------------------------------------
  chunk('lair_den_rocks', 'lair', 'Логово в камнях', [
    o('r1', 'rubble_rock', -9, -8, 0), o('r2', 'rubble_rock', 0, -11, 60), o('r3', 'rubble_rock', 9, -7, 120), o('r4', 'rubble_rock', 11, 3, 180),
    o('r5', 'rubble_rock', -11, 2, 240), o('w1', 'deadwood', 0, 2, 0)
  ], [a('den', 'lair', 0, -3), a('pack', 'spawnArea', 0, 10, { radius: 9 }), a('pack2', 'spawnArea', -12, 12, { radius: 7 })], { modes: WILD }),
  chunk('lair_wreck_nest', 'lair', 'Гнездо в остовах', [
    o('c1', 'car_wreck', -7, -4, 30), o('c2', 'car_wreck', 6, -6, 200), o('s1', 'scrap_heap', 0, 6, 0), o('t1', 'tire_stack', 10, 8, 0)
  ], [a('den', 'lair', 0, -2), a('pack', 'spawnArea', 0, 13, { radius: 8 })], { modes: WILD }),
  chunk('lair_ruin_pit', 'lair', 'Логово в руине', [
    o('w1', 'concrete_wall', -8, -8, 0), o('w2', 'concrete_wall', -4, -8, 0), o('w3', 'concrete_wall', 8, -6, 90), o('w4', 'concrete_wall', 8, -2, 90),
    o('r1', 'rubble_rock', -10, 6, 0)
  ], [a('den', 'lair', 0, -3), a('pack', 'spawnArea', 2, 10, { radius: 9 }), a('cache', 'container', -6, -5, { tier: 'rare' })], { modes: DANGER })
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
