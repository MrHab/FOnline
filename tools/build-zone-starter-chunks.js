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
// Ряд одинаковых объектов от точки к точке; поворот — вдоль ряда.
const line = (id, prefab, x0, z0, x1, z1, n, extra = {}) => Array.from({ length: n }, (_, i) => {
  const t = n === 1 ? 0.5 : i / (n - 1);
  return o(`${id}${i}`, prefab, Number((x0 + (x1 - x0) * t).toFixed(2)), Number((z0 + (z1 - z0) * t).toFixed(2)),
    Math.round((Math.atan2(x1 - x0, z1 - z0) * 180 / Math.PI + 270) % 360), extra);
});
// Кольцо объектов вокруг точки, каждый повёрнут по касательной; skip — пропущенные места (проход).
const ring = (id, prefab, cx, cz, radius, n, { skip = [], ...extra } = {}) => Array.from({ length: n }, (_, i) => i)
  .filter(i => !skip.includes(i))
  .map(i => {
    const angle = (i / n) * Math.PI * 2;
    return o(`${id}${i}`, prefab, Number((cx + Math.sin(angle) * radius).toFixed(2)), Number((cz + Math.cos(angle) * radius).toFixed(2)),
      Math.round((angle * 180 / Math.PI + 90) % 360), extra);
  });
// Ориентир: один на зону, только в своём регионе. У каждого — место аномалии: в опасной
// зоне она всегда будет (бюджет аномалий мирных и синих зон нулевой), встаёт на край слота
// подальше от построек и якорей ориентира.
const landmark = (id, name, biome, objects, anchors, scatterRows) => {
  const busy = [...objects.map(row => ({ x: row.x, z: row.z, r: 3 })), ...anchors.map(row => ({ x: row.x, z: row.z, r: (row.radius || 2) + 3 }))];
  const spots = [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, -15], [0, 15], [-15, 0], [15, 0]];
  const clearance = ([x, z]) => Math.min(...busy.map(row => Math.hypot(row.x - x, row.z - z) - row.r));
  const [fx, fz] = spots.reduce((best, spot) => (clearance(spot) > clearance(best) ? spot : best));
  return chunk(id, 'landmark', name, objects, [...anchors, a('anom', 'anomaly', fx, fz, { radius: 3 })], {
    biomes: [biome], maxPerZone: 1, scatter: scatterRows
  });
};
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

  // --- ориентиры: у центра зоны, видно издалека; у каждого региона три своих (облик — библия §3) ----
  // Северные затворы: вода между откосами, водосбросы, туман и линии высоковольтных опор.
  landmark('landmark_sluice_pylons', 'Линия опор', 'northern_sluices', [
    ...line('p', 'utility_pole', -16, -4, 16, 4, 5, { s: 2.3 }), o('b1', 'barrel_cluster', -6, 9, 30), o('w1', 'workshop_bench', 7, 10, 180)
  ], [a('event', 'eventAnchor', 0, -13, { radius: 9 }), a('cache', 'container', 11, 12, { tier: 'tools' })], [scatter(DEBRIS, [6, 10]), scatter(BUSH, [6, 10])]),
  landmark('landmark_sluice_gatehouse', 'Сторожка затвора', 'northern_sluices', [
    o('t1', 'watch_post', 0, 0, 0, { s: 1.6 }), o('k1', 'water_tank', -8, -6, 0, { s: 1.8 }), ...wall('n', -10, -12, 'x', 11), ...wall('w', -12, -10, 'z', 6),
    o('b1', 'barrel_cluster', 8, 6, 120), o('l1', 'storage_lean_to', 9, -5, 270)
  ], [a('event', 'eventAnchor', 4, 13, { radius: 9 }), a('cache', 'container', -6, 4, { tier: 'basic' })], [scatter(DEBRIS, [5, 8]), scatter(BUSH, [6, 9])]),
  landmark('landmark_sluice_pressure_tanks', 'Напорные баки', 'northern_sluices', [
    o('k1', 'water_tank', -9, -2, 0, { s: 2.2 }), o('k2', 'water_tank', 0, -4, 25, { s: 2.4 }), o('k3', 'water_tank', 9, -2, 50, { s: 2.1 }),
    ...line('f', 'fence_segment', -14, 8, 14, 8, 6), o('p1', 'utility_pole', 15, -10, 0, { s: 1.8 })
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 })], [scatter(JUNK, [5, 8]), scatter(BUSH, [5, 8])]),

  // Срединная жила: дамбы, лесополосы, панельные посёлки, водонапорные башни, огороды.
  landmark('landmark_vein_water_tower', 'Водонапорная башня', 'middle_vein', [
    o('k1', 'water_tank', 0, 0, 0, { s: 2.8 }), ...ring('f', 'fence_segment', 0, 0, 9, 8), o('p1', 'utility_pole', 13, 11, 0, { s: 1.6 }),
    o('p2', 'utility_pole', -13, 11, 0, { s: 1.6 })
  ], [a('event', 'eventAnchor', 0, -14, { radius: 9 }), a('cache', 'container', 5, 4, { tier: 'basic' })], [scatter(TREES, [4, 7], { spacing: 4, scale: [1.3, 1.9] }), scatter(BUSH, [8, 12])]),
  landmark('landmark_vein_field_camp', 'Полевой стан', 'middle_vein', [
    o('g1', 'garden_patch', -8, -8, 0), o('g2', 'garden_patch', -2, -8, 0), o('g3', 'garden_patch', 4, -8, 0), o('g4', 'garden_patch', 10, -8, 0),
    o('p1', 'brahmin_pen', -7, 6, 90), o('s1', 'wasteland_shack', 7, 6, 180), o('c1', 'campfire_rest', 1, 1, 0), o('b1', 'cot_bed', 4, 11, 0)
  ], [a('event', 'eventAnchor', -12, 13, { radius: 8 }), a('cache', 'container', 10, 2, { tier: 'basic' })], [scatter(BUSH, [8, 12])]),
  landmark('landmark_vein_crossing', 'Переезд', 'middle_vein', [
    ...line('s', 'asphalt_slab', -15, 0, 15, 0, 6), o('r1', 'roadblock_barricade', -4, -5, 0), o('r2', 'roadblock_barricade', 4, 5, 180),
    o('h1', 'highway_sign', -9, -8, 0, { s: 1.5 }), o('c1', 'car_wreck', 10, -7, 60), o('p1', 'utility_pole', -14, 9, 0, { s: 1.7 })
  ], [a('event', 'eventAnchor', 12, 12, { radius: 9 })], [scatter(JUNK, [6, 9]), scatter(BUSH, [6, 9])]),

  // Рудная дуга: терриконы, красно-чёрная порода, открытые цеха, ржавые рельсы.
  landmark('landmark_ore_spoil_heap', 'Террикон', 'ore_arc', [
    o('o1', 'ore_outcrop', 0, 0, 0, { s: 2.9 }), o('o2', 'ore_outcrop', -9, 5, 80, { s: 2 }), o('o3', 'ore_outcrop', 8, 6, 170, { s: 1.9 }),
    o('o4', 'ore_outcrop', 4, -10, 260, { s: 1.7 }), o('h1', 'scrap_heap', -11, -8, 30, { s: 1.4 })
  ], [a('event', 'eventAnchor', 0, 15, { radius: 8 }), a('cache', 'container', -13, 1, { tier: 'tools' })], [scatter(ROCKS, [6, 10], { spacing: 3.5, scale: [1, 2] }), scatter(DEBRIS, [4, 7])]),
  landmark('landmark_ore_pumpjacks', 'Качалки', 'ore_arc', [
    o('j1', 'oil_pump_jack', -8, -4, 0, { s: 1.6 }), o('j2', 'oil_pump_jack', 2, -7, 30, { s: 1.6 }), o('j3', 'oil_pump_jack', 10, -1, 60, { s: 1.5 }),
    o('b1', 'barrel_cluster', -4, 7, 0), o('b2', 'barrel_cluster', 6, 8, 90), o('t1', 'tire_stack', -12, 6, 0)
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 }), a('cache', 'container', 13, 10, { tier: 'basic' })], [scatter(['rust_barrel_v1', 'tire_stack'], [6, 10]), scatter(BUSH, [4, 7])]),
  landmark('landmark_ore_open_works', 'Открытый цех', 'ore_arc', [
    o('b1', 'workshop_bench', -4, -3, 0), o('b2', 'workshop_bench', 4, -3, 0), o('r1', 'armory_rack', 0, 3, 180),
    o('h1', 'scrap_heap', -10, 6, 0, { s: 1.6 }), o('h2', 'scrap_heap', 10, 7, 90, { s: 1.5 }),
    ...line('w', 'scrap_wall_segment', -12, -10, 12, -10, 5), o('p1', 'utility_pole', 13, -4, 0, { s: 1.8 })
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 }), a('cache', 'container', -7, 1, { tier: 'tools' })], [scatter(JUNK, [6, 9]), scatter(DEBRIS, [4, 7])]),

  // Трактовый перешеек: шоссе на насыпи, дорожные кафе-крепости, склады и кладбища машин.
  landmark('landmark_billboard_crossing', 'Перекрёсток со щитами', 'tract_isthmus', [
    o('b1', 'ruined_billboard', -9, -8, 20, { s: 2 }), o('b2', 'ruined_billboard', 10, 7, 200, { s: 2 }), o('h1', 'highway_sign', 0, -13, 0), o('c1', 'car_wreck', 7, -6, 120),
    o('s1', 'asphalt_slab', -3, 2, 0), o('s2', 'asphalt_slab', 3, 6, 90), o('s3', 'asphalt_slab', -2, -4, 10)
  ], [a('event', 'eventAnchor', -12, 12, { radius: 10 }), a('cache', 'container', 12, -12, { tier: 'wasteland' })], [scatter(JUNK, [6, 10]), scatter(BUSH, [5, 8])]),
  landmark('landmark_tract_car_graveyard', 'Кладбище машин', 'tract_isthmus', [
    o('c1', 'car_wreck', -11, -8, 10), o('c2', 'car_wreck', -4, -9, 170), o('c3', 'car_wreck', 4, -8, 20), o('c4', 'car_wreck', 11, -9, 190),
    o('c5', 'car_wreck', -8, 1, 100), o('c6', 'car_wreck', 1, 0, 280), o('c7', 'car_wreck', 9, 2, 80), o('t1', 'tire_stack', -13, 9, 0), o('t2', 'tire_stack', 12, 10, 0)
  ], [a('event', 'eventAnchor', 0, 13, { radius: 8 }), a('cache', 'container', -2, 9, { tier: 'wasteland' })], [scatter(JUNK, [8, 12]), scatter(BUSH, [4, 7])]),
  landmark('landmark_tract_road_fort', 'Придорожная крепость', 'tract_isthmus', [
    o('t1', 'scrap_watch_tower', 0, 0, 0, { s: 1.4 }), ...ring('w', 'scrap_wall_segment', 0, 0, 10, 10, { skip: [2] }),
    o('r1', 'roadblock_barricade', 14, 0, 90), o('h1', 'highway_sign', 15, -8, 270, { s: 1.4 }), o('k1', 'cargo_stack', -5, 4, 30)
  ], [a('event', 'eventAnchor', 0, -15, { radius: 8 }), a('cache', 'container', 4, 4, { tier: 'wasteland' })], [scatter(JUNK, [5, 8]), scatter(BUSH, [5, 8])]),

  // Меловая низь: провалы, карстовые окна, утопленные дворы, тоннели в мягком камне.
  landmark('landmark_chalk_karst_window', 'Карстовое окно', 'chalk_lowland', [
    ...ring('r', 'rubble_rock', 0, 0, 9, 11, { s: 2.1 }), o('t1', 'dead_tree_b', 12, 11, 0, { s: 1.6 }), o('t2', 'dead_tree_b', -12, -11, 0, { s: 1.5 })
  ], [a('event', 'eventAnchor', 0, 0, { radius: 6 }), a('cache', 'container', 14, -13, { tier: 'basic' })], [scatter(ROCKS, [4, 7], { spacing: 4, scale: [0.8, 1.6] }), scatter(BUSH, [6, 9])]),
  landmark('landmark_chalk_sunken_yard', 'Утопленный двор', 'chalk_lowland', [
    ...wall('n', -9, -9, 'x', 11), ...wall('s', -9, 9, 'x', 11), ...wall('w', -10, -8, 'z', 9), o('l1', 'storage_lean_to', 3, -4, 0),
    o('b1', 'barrel_cluster', -4, 4, 60), o('d1', 'deadwood', 6, 5, 20)
  ], [a('event', 'eventAnchor', 15, 0, { radius: 7 }), a('cache', 'container', -3, -4, { tier: 'basic' })], [scatter(DEBRIS, [5, 8]), scatter(BUSH, [4, 7])]),
  landmark('landmark_chalk_rock_gate', 'Каменные ворота', 'chalk_lowland', [
    o('r1', 'rubble_rock', -6, 0, 0, { s: 2.9 }), o('r2', 'rubble_rock', 6, 0, 90, { s: 2.8 }), o('r3', 'rubble_rock', -11, 6, 40, { s: 1.8 }),
    o('r4', 'rubble_rock', 11, -6, 210, { s: 1.9 }), o('d1', 'deadwood', 0, 9, 90), o('t1', 'dead_tree_c', -3, -10, 0, { s: 1.5 })
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 })], [scatter(ROCKS, [5, 8], { spacing: 3.5, scale: [0.9, 1.7] }), scatter(BUSH, [5, 8])]),

  // Стеколье: спёкшийся грунт, наклонённые опоры, фасады без внутренних стен, сухие грозы.
  landmark('landmark_relay_mast', 'Мачта связи', 'glasslands', [
    o('m1', 'relay_antenna', 0, 0, 0, { s: 2.2 }), ...wall('w', -8, -8, 'x', 4), ...wall('v', -9.5, -6, 'z', 4),
    o('p1', 'utility_pole', 12, 8, 0), o('p2', 'utility_pole', -12, 12, 0), o('b1', 'workshop_bench', 5, 8, 0)
  ], [a('cache', 'container', -4, 6, { tier: 'tools' }), a('event', 'eventAnchor', 0, -14, { radius: 10 })], [scatter(DEBRIS, [6, 10]), scatter(BUSH, [6, 10])]),
  landmark('landmark_glass_bare_facades', 'Пустые фасады', 'glasslands', [
    ...line('a', 'scrap_wall_segment', -13, -9, 13, -9, 6, { s: 1.4 }), ...line('b', 'scrap_wall_segment', -13, -1, 13, -1, 6, { s: 1.4 }),
    ...line('c', 'scrap_wall_segment', -13, 7, 13, 7, 6, { s: 1.4 }), o('r1', 'rubble_rock', 14, 13, 0, { s: 1.4 })
  ], [a('event', 'eventAnchor', 0, 14, { radius: 7 }), a('cache', 'container', -6, 3, { tier: 'rare' })], [scatter(DEBRIS, [8, 12]), scatter(ROCKS, [3, 5])]),
  landmark('landmark_glass_pylon_field', 'Поле опор', 'glasslands', [
    o('p1', 'utility_pole', -11, -9, 17, { s: 2.4 }), o('p2', 'utility_pole', -2, -12, 71, { s: 2.2 }), o('p3', 'utility_pole', 9, -6, 133, { s: 2.5 }),
    o('p4', 'utility_pole', -8, 5, 212, { s: 2.3 }), o('p5', 'utility_pole', 6, 8, 301, { s: 2.4 }), o('m1', 'relay_antenna', 0, 0, 45, { s: 1.2 })
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 })], [scatter(DEBRIS, [8, 12]), scatter(ROCKS, [4, 7], { spacing: 4, scale: [0.8, 1.5] })]),

  // Нулевая котловина: чёрная вода в чашах, толстые трубы, насосные башни, многоярусные дамбы.
  landmark('landmark_tank_yard', 'Двор цистерн', 'zero_basin', [
    o('t1', 'water_tank', -5, -3, 0, { s: 2.2 }), o('t2', 'water_tank', 3, -5, 40, { s: 2 }), o('b1', 'workshop_bench', 7, 5, 90), o('l1', 'storage_lean_to', -7, 8, 180),
    o('s1', 'scrap_wall_segment', 0, -13, 0), o('s2', 'scrap_wall_segment', 13, 0, 90), o('s3', 'scrap_wall_segment', -13, 0, 90)
  ], [a('cache', 'container', 0, 3, { tier: 'basic' }), a('event', 'eventAnchor', -12, -12, { radius: 9 })], [scatter(JUNK, [6, 9]), scatter(BUSH, [5, 8])]),
  landmark('landmark_zero_pump_tower', 'Насосная башня', 'zero_basin', [
    o('k1', 'water_tank', 0, -2, 0, { s: 2.6 }), o('j1', 'oil_pump_jack', -9, 4, 30, { s: 1.4 }), o('j2', 'oil_pump_jack', 9, 5, 330, { s: 1.4 }),
    o('b1', 'barrel_cluster', -11, -8, 0), o('b2', 'barrel_cluster', 11, -9, 90), o('b3', 'barrel_cluster', 0, 10, 180), o('w1', 'watch_post', 13, 12, 200)
  ], [a('event', 'eventAnchor', -13, 13, { radius: 7 }), a('cache', 'container', 4, 6, { tier: 'basic' })], [scatter(['rust_barrel_v1'], [6, 10], { spacing: 1.6 }), scatter(DEBRIS, [4, 7])]),
  landmark('landmark_zero_settling_bowl', 'Отстойник', 'zero_basin', [
    ...ring('w', 'concrete_wall', 0, 0, 8, 14), o('b1', 'barrel_cluster', -13, 10, 30), o('b2', 'barrel_cluster', 13, -11, 200),
    o('p1', 'utility_pole', 14, 12, 0, { s: 1.6 })
  ], [a('event', 'eventAnchor', 0, 0, { radius: 5 }), a('cache', 'container', -14, -12, { tier: 'basic' })], [scatter(['rust_barrel_v1'], [5, 8], { spacing: 1.6 }), scatter(DEBRIS, [5, 8])]),

  // Глухой обвод: пыль на горизонте, оплавленные леса опор, кратеры, турели без людей.
  landmark('landmark_ring_crater', 'Кратер', 'silent_ring', [
    ...ring('r', 'rubble_rock', 0, 0, 10, 12, { s: 2.2 }), o('h1', 'scrap_heap', -4, 3, 0, { s: 1.3 }), o('t1', 'dead_tree_c', 13, 12, 0, { s: 1.4 })
  ], [a('event', 'eventAnchor', 0, 0, { radius: 6 }), a('cache', 'container', 14, -13, { tier: 'rare' })], [scatter(DEBRIS, [8, 12]), scatter(ROCKS, [4, 7])]),
  landmark('landmark_ring_dead_turret', 'Мёртвая турель', 'silent_ring', [
    o('t1', 'scrap_watch_tower', 0, 0, 0, { s: 1.5 }), o('r1', 'armory_rack', 3, 3, 90), ...line('b', 'roadblock_barricade', -12, -9, 12, -9, 4),
    o('k1', 'cargo_stack', -8, 7, 20)
  ], [a('event', 'eventAnchor', 0, 14, { radius: 8 }), a('cache', 'container', 6, 6, { tier: 'rare' })], [scatter(DEBRIS, [8, 12]), scatter(BUSH, [3, 5])]),
  landmark('landmark_ring_melted_pylons', 'Оплавленные опоры', 'silent_ring', [
    ...line('p', 'utility_pole', -14, -10, 14, 10, 6, { s: 2.5 }), o('d1', 'deadwood', -6, 7, 40), o('d2', 'deadwood', 7, -6, 120),
    o('t1', 'dead_tree_a', -12, 10, 0, { s: 1.6 }), o('t2', 'dead_tree_a', 12, -11, 0, { s: 1.5 })
  ], [a('event', 'eventAnchor', 12, 12, { radius: 7 })], [scatter(TREES, [6, 9], { spacing: 4, scale: [1.2, 1.8] }), scatter(DEBRIS, [5, 8])]),

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
