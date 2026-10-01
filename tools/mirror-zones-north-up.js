#!/usr/bin/env node
'use strict';

// Перевести закреплённые секторы и разложенные города на «север = +Z».
//
// Конструктор зон ставил северные ворота у малых tz (мировая −Z), а компас,
// миникарта и снимки зон считают севером +Z: содержимое зоны было зеркалом
// карты мира. Восток — +X в обеих системах, поэтому это не поворот, а
// отражение по z. Инструмент отражает данные: tz → K − tz, z → c − z, поворот
// объекта θ → π − θ (фасад, смотревший на север, смотрит на юг, а сам объект не
// выворачивается наизнанку). Сектор отражается относительно своей середины
// (K = 159, c = 0), город — относительно центра своего плана (тайл 40, z = +1 м),
// чтобы стена, ворота и площадь остались на сетке конструктора городов. Поля
// аномалий места в лоре (data/kromka/locations.json) отражаются вместе с ним.
//
// Сцены Unity потом отражает «Кромка → Авторинг → Отразить сцены зон по оси
// север-юг» (KromkaZoneNorthMirror): она сверяет каждую сцену с этими данными.
// Файл с меткой `compassNorth: "+z"` уже отражён и пропускается.
//
//   node tools/mirror-zones-north-up.js           — отразить
//   node tools/mirror-zones-north-up.js --check   — только перечислить неотражённые

const fs = require('node:fs');
const path = require('node:path');
const { COMPASS_NORTH } = require('../src/server/zone-builder');
const { SLOT_METRES } = require('../src/server/zone-chunks');

const root = path.resolve(__dirname, '..');
const TILE = 2;
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const check = process.argv.includes('--check');
// Виды якорей сцены, чей поворот экспорт переносит в строку актёра (KromkaWorldSceneExporter.ExportDynamicSpawns).
const ACTOR_SPAWNS = new Set(['Npc', 'Enemy', 'Encounter']);

const round3 = value => {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
};

/** Отражение локации: K — сумма tz пары, c — сумма z пары. */
function frameOf(definition) {
  const tiles = Math.round(Number(definition.map?.depth) / TILE);
  if (!Number.isFinite(tiles) || tiles <= 0) throw new Error(`${definition.id}: no map depth`);
  // Город построен вокруг тайла tiles/2 (его центр — z = +1 м), сектор — вокруг середины карты.
  const k = definition.cityZone === true ? tiles : tiles - 1;
  return { tiles, k, c: (k - tiles + 1) * TILE };
}

function mirrorLocation(definition) {
  const { tiles, k, c } = frameOf(definition);
  const tz = value => k - Number(value);
  const z = value => round3(c - Number(value));
  const yaw = value => {
    const turned = Math.PI - Number(value || 0);
    return round3(((turned % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  };
  const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const point = row => {
    if (!row || typeof row !== 'object') return;
    if (finite(row.z)) {
      row.z = z(row.z);
      // Тайл точки в метрах — тот, что посчитал бы экспорт сцены: у точки на
      // границе тайлов K − tz промахнулся бы на тайл.
      if (finite(row.tz)) row.tz = Math.min(tiles - 1, Math.max(0, Math.floor(row.z / TILE + tiles / 2)));
    } else if (finite(row.tz)) {
      row.tz = tz(row.tz);
    }
  };

  for (const key of Object.keys(definition)) {
    if (/^(spawn|respawn|entry|migrationArrival)$|^entryFrom/.test(key)) point(definition[key]);
  }
  for (const row of definition.transitions || []) point(row);
  for (const row of definition.containers || []) point(row);
  for (const row of definition.anomalyFields || []) point(row);
  for (const row of definition.worldZones || []) point(row);
  for (const row of definition.unitySpawns || []) {
    point(row.position);
    // Якорь живого актёра задаёт и его взгляд (строка объекта получает тот же
    // поворот при экспорте), точки прибытия и выхода только переезжают.
    if (ACTOR_SPAWNS.has(row.kind) && finite(row.rotationY)) row.rotationY = yaw(row.rotationY);
  }
  for (const row of definition.objects || []) {
    point(row.position);
    if (row.rotation) row.rotation.y = yaw(row.rotation.y);
  }

  const zone = definition.zone;
  if (zone) {
    for (const key of ['gates', 'spawnAreas', 'lairs', 'eventAnchors']) for (const row of zone[key] || []) point(row);
    for (const row of zone.nav?.nodes || []) point(row);
    // Куски лежат в слотах 40 × 40 м: отражается ряд слота, поворот куска
    // остаётся записью сборки — отражённый кусок поворотом не выразить.
    const slots = Math.round(tiles * TILE / SLOT_METRES);
    for (const row of zone.chunks || []) if (Array.isArray(row.slot)) row.slot = [row.slot[0], slots - 1 - row.slot[1]];
    if (zone.cityWall) {
      const { minZ, maxZ } = zone.cityWall;
      zone.cityWall.minZ = z(maxZ);
      zone.cityWall.maxZ = z(minZ);
    }
  }

  const plan = definition.cityPlan;
  if (plan) {
    for (const key of ['plaza', 'board', 'dispatcher', 'medic']) point(plan[key]);
    if (plan.wall) {
      const { min, max } = plan.wall;
      // Стена квадратная, одна пара на обе оси: при отражении вокруг центра плана она та же.
      if (tz(max) !== min || tz(min) !== max) throw new Error(`${definition.id}: the city wall is not centred on its plan`);
    }
    if (plan.bank) {
      for (const key of ['door', 'storage', 'auction']) point(plan.bank[key]);
      // Прямоугольник банка — [minX, minZ, maxX, maxZ]: порядок min/max сохраняется.
      if (Array.isArray(plan.bank.rect)) {
        const [x0, z0, x1, z1] = plan.bank.rect;
        plan.bank.rect = [x0, tz(z1), x1, tz(z0)];
      }
    }
    // У рынка и мастерских rect — ближний и дальний от площади участки.
    for (const key of ['market', 'workshop']) {
      const district = plan[key];
      if (!district) continue;
      if (Array.isArray(district.rect)) {
        const [x0, z0, x1, z1] = district.rect;
        district.rect = [x0, tz(z0), x1, tz(z1)];
      }
      for (const list of ['traders', 'benches', 'houses']) for (const row of district[list] || []) point(row);
      point(district.repair);
    }
    for (const row of plan.homes || []) point(row);
    for (const row of plan.plots || []) point(row);
    for (const row of plan.gates || []) point(row);
  }

  definition.compassNorth = COMPASS_NORTH;
  return definition;
}

function locationFiles() {
  const zonesDir = path.join(root, 'data', 'zones', 'authored');
  const zones = fs.readdirSync(zonesDir).filter(name => name.endsWith('.json')).sort().map(name => path.join(zonesDir, name));
  const cities = graph.zones.filter(zone => zone.city).map(zone => path.join(root, 'data', 'locations', `${zone.city}.json`))
    .filter(file => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).cityAuthored === true);
  return [...zones, ...cities.sort()];
}

/**
 * Аномалии мест держит лор (data/kromka/locations.json): по нему сервер рождает
 * артефакты, а сцена хранит их якоря. Поле отражается вместе со своей локацией.
 * Файл пишет экспорт сцен (числа вида 8.0), поэтому правится только строка z поля.
 */
function mirrorLoreAnomalies(mirrored) {
  const file = path.join(root, 'data', 'kromka', 'locations.json');
  let text = fs.readFileSync(file, 'utf8');
  let changed = 0;
  for (const location of JSON.parse(text).locations || []) {
    const frame = mirrored.get(location.id);
    if (!frame) continue;
    for (const field of location.anomalyFields || []) {
      const at = text.indexOf(`"id": ${JSON.stringify(field.id)}`);
      const end = text.indexOf('}', at);
      const line = at < 0 ? null : /"z": (-?[0-9.]+)/.exec(text.slice(at, end));
      if (!line) throw new Error(`${location.id}: anomaly ${field.id} is not in the lore file as written`);
      const value = round3(frame.c - Number(line[1]));
      const literal = line[1].includes('.') && Number.isInteger(value) ? value.toFixed(1) : String(value);
      const start = at + line.index;
      text = text.slice(0, start) + `"z": ${literal}` + text.slice(start + line[0].length);
      changed += 1;
    }
  }
  if (changed) fs.writeFileSync(file, text);
  return changed;
}

if (require.main === module) {
  const pending = [];
  const mirrored = new Map();
  for (const file of locationFiles()) {
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (definition.compassNorth === COMPASS_NORTH) continue;
    pending.push(path.relative(root, file));
    mirrored.set(definition.id, frameOf(definition));
    if (!check) fs.writeFileSync(file, `${JSON.stringify(mirrorLocation(definition), null, 2)}\n`);
  }
  if (!check && mirrored.size) console.log(`Lore anomaly fields mirrored with their location: ${mirrorLoreAnomalies(mirrored)}.`);
  if (check) {
    if (pending.length) {
      console.error(`Not mirrored to north = +Z yet (${pending.length}):\n${pending.join('\n')}`);
      process.exit(1);
    }
    console.log('Every frozen sector and authored city has north at +Z.');
  } else {
    console.log(`Mirrored to north = +Z: ${pending.length} location(s).`);
  }
}

module.exports = { frameOf, mirrorLocation };
