#!/usr/bin/env node
'use strict';

// Собирает data/kromka/grounds.json — угодья Кромки по канону библии
// (разделы 4.4–4.5): пять угодий городов клиньями от Ключей, их семейства
// ресурсов, ремесло города (семейство, которого в угодьях нет) и жилы —
// по одной зоне на тир для основного ресурса угодий.
//
//   node tools/build-zone-grounds.js          — записать файл
//   node tools/build-zone-grounds.js --check  — сверить файл с генератором

const fs = require('node:fs');
const path = require('node:path');
const { assignGroundsByWedges } = require('../src/server/zone-grounds');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'kromka', 'grounds.json');

// Канон раздела 4.4: Ключи в центре, пять городов пятиугольником.
const CENTER = { zoneId: 'z_10_07', col: 10, row: 7 };
const GROUNDS = [
  { id: 'uprava', name: 'Угодья Створа', cityLocationId: 'sluiceCity', col: 8, row: 13, families: ['wood', 'fiber', 'hide'], refine: 'oil' },
  { id: 'artels', name: 'Угодья Раздолья', cityLocationId: 'scrapTown', col: 3, row: 8, families: ['ore', 'wood', 'oil'], refine: 'fiber' },
  { id: 'contour', name: 'Угодья Контура-3', cityLocationId: 'relayStation', col: 15, row: 10, families: ['oil', 'ore', 'fiber'], refine: 'hide' },
  { id: 'seconds', name: 'Угодья Мелового двора', cityLocationId: 'secondHaven', col: 14, row: 3, families: ['fiber', 'hide', 'ore'], refine: 'wood' },
  { id: 'league', name: 'Угодья Перекрёстка', cityLocationId: 'caravanCamp', col: 7, row: 2, families: ['hide', 'oil', 'wood'], refine: 'ore' }
];

// Жилы основного ресурса, тиры 1–5 (раздел 4.5).
const HOTSPOTS = {
  wood: [['z_07_13', 'Лесосека у Пенной чаши'], ['z_08_12', 'Плотинный лес'], ['z_07_11', 'Сплавной затор'], ['z_11_11', 'Горелая просека'], ['z_10_08', 'Пепельный кедровник']],
  ore: [['z_02_12', 'Шахта «Три смены»'], ['z_04_08', 'Канатный рудник'], ['z_05_10', 'Вагонеточный рудник'], ['z_05_05', 'Болотная жила'], ['z_08_07', 'Кромочная жила']],
  oil: [['z_16_10', 'Скважина К-1'], ['z_15_09', 'Резервуарный парк К-3'], ['z_15_08', 'Спёкшаяся скважина'], ['z_12_10', 'Газоконденсатное поле'], ['z_11_08', 'Синяя скважина']],
  fiber: [['z_15_02', 'Льняные чеки'], ['z_14_02', 'Конопляные дворы'], ['z_13_05', 'Тканевые фильтры'], ['z_11_03', 'Тростниковые отстойники'], ['z_11_06', 'Шёлковый каскад']],
  hide: [['z_07_01', 'Выгон у отстойников'], ['z_06_02', 'Скотобойня Лиги'], ['z_09_02', 'Смоляные лежбища'], ['z_07_05', 'Пастбища мутантов'], ['z_09_06', 'Логово вожаков']]
};

function build() {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
  const zones = assignGroundsByWedges(graph.zones, CENTER, GROUNDS);
  const sortedZones = Object.fromEntries(Object.keys(zones).sort().map(id => [id, zones[id]]));
  const hotspots = {};
  for (const [family, rows] of Object.entries(HOTSPOTS)) {
    rows.forEach(([zoneId, name], index) => { hotspots[zoneId] = { family, tier: index + 1, name }; });
  }
  return {
    schema: 'kromka.grounds.v1',
    note: 'Угодья — биомы Кромки, как в Albion (библия, 4.5). Файл собирает tools/build-zone-grounds.js: не править руками. Зона принадлежит угодьям города по клину от Ключей; у угодий три семейства (основное, второе, третье — доли узлов 50/30/20), двух нет; refine — ремесло города: семейство, которого в его угодьях нет. Жила удваивает основной ресурс своих угодий.',
    center: CENTER.zoneId,
    // Ключи — вольный город в центре, угодий у них нет (ресурсы — поровну).
    centerLocationId: 'settlement',
    hotspotFactor: 2,
    grounds: Object.fromEntries(GROUNDS.map(row => [row.id, {
      name: row.name, cityLocationId: row.cityLocationId, cityZone: `z_${String(row.col).padStart(2, '0')}_${String(row.row).padStart(2, '0')}`,
      families: row.families, refine: row.refine
    }])),
    hotspots: Object.fromEntries(Object.keys(hotspots).sort().map(id => [id, hotspots[id]])),
    zones: sortedZones
  };
}

const text = JSON.stringify(build(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('data/kromka/grounds.json differs from tools/build-zone-grounds.js — run it to rebuild.');
    process.exit(1);
  }
  console.log('Grounds file matches its generator.');
} else {
  fs.writeFileSync(OUT, text);
  console.log(`Wrote ${path.relative(ROOT, OUT)}.`);
}
