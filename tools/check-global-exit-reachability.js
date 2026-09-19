#!/usr/bin/env node
'use strict';
// Достижимость внутри локации: выход на глобальную карту и всё, с чем игрок
// взаимодействует.
//
// check-global-exit-direction проверяет геометрию полос (направление, ширину,
// отрисовку), но не отвечает на главный игровой вопрос: может ли персонаж
// ДОЙТИ от точки спавна до полосы выхода пешком. Стена из авторских объектов,
// поставленная поперёк, запечатала бы выход, и ни одна статическая проверка
// этого бы не заметила.
//
// Преграды здесь собирает тот же src/server/location-collision.js, что и сервер,
// поэтому проверка видит ровно те стены, которые видит он: collisionParts сцен
// Кромки, collisionSize, footprint. С настоящими преградами зданий вопрос стал
// шире выхода: NPC, станок, тайник или объект задания, оказавшийся внутри стены
// или за ней, молча перестаёт работать — сервер требует прямой видимости
// (serverInteractionHasLineOfSight) и отвечает «находится за препятствием».
//
// Метод: сетка с шагом 0.5 м, клетка свободна, если круг игрока в ней не задевает
// ни одну преграду (правило roomStaticCollisionMoveAllowed); от спавна идёт заливка.
// Цель взаимодействия годна, если из какой-то достигнутой клетки в радиусе
// действия до неё есть прямая видимость по правилу сервера.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  circleBlockerPenalty,
  createLocationCollision,
  locationObjectIsNpc,
  locationObjectPosition,
  locationObjectTags
} = require('../src/server/location-collision');
const { segmentIntersectsRotatedBlocker } = require('../src/server/enemy-ai');
const {
  buildStaticCollisionSpatialIndex,
  queryStaticCollisionSpatialIndex
} = require('../src/server/static-collision-spatial-index');

const ROOT = path.resolve(__dirname, '..');
const TILE = 2;
const CELL = 0.5;
// Сетка тайлов задаётся локацией (server.js locationTileDims): без явного
// map.width/depth остаётся 38×38, авторская сцена любого размера объявляет
// его в метрах.
const DEFAULT_MAP_TILES = 38;
const EXIT_BAND_TILES = 2;
// PLAYER_COLLISION_RADIUS в server.js и радиус капсулы RoaPlayerController.
const PLAYER_RADIUS = 0.48;
// Дальности сервера: станок, хранилище, объект задания и разговор — 4.6 м,
// тайник и добыча ресурса — 3.2 м. Проверка оставляет запас на шаг сетки.
const REACH = { interact: 4.6 - CELL, loot: 3.2 - CELL };

const { locationObjectBlockers } = createLocationCollision({ tile: TILE });

function locationTileDims(loc = {}) {
  const map = loc.map && typeof loc.map === 'object' ? loc.map : {};
  const widthMeters = Number(map.technicalWidth || map.width || 0);
  const depthMeters = Number(map.technicalDepth || map.depth || 0);
  return {
    w: widthMeters > 0 ? Math.max(1, Math.round(widthMeters / TILE)) : DEFAULT_MAP_TILES,
    h: depthMeters > 0 ? Math.max(1, Math.round(depthMeters / TILE)) : DEFAULT_MAP_TILES
  };
}

// Точка в метрах; старые записи знают только тайл — тогда берётся его центр.
function pointOf(entry, dims) {
  if (!entry || typeof entry !== 'object') return null;
  const finite = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
  if (finite(entry.x) && finite(entry.z)) return { x: Number(entry.x), z: Number(entry.z) };
  if (finite(entry.tx) && finite(entry.tz))
    return { x: (Number(entry.tx) - dims.w / 2 + 0.5) * TILE, z: (Number(entry.tz) - dims.h / 2 + 0.5) * TILE };
  return null;
}

function isHostile(row) {
  const kind = String(row.entity?.kind || '').trim().toLowerCase();
  return ['enemy', 'creature', 'monster'].includes(kind)
    || row.entity?.hostileToPlayer === true
    || locationObjectTags(row).some(tag => ['hostile', 'mutant', 'enemy', 'monster'].includes(tag));
}

// То, к чему игрок подходит и нажимает «использовать».
function interactionReach(row) {
  const tags = locationObjectTags(row);
  const kind = String(row.interactive?.kind || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (row.resourceType || row.resource || tags.includes('resource-node') || tags.includes('harvestable')) return REACH.loot;
  if (kind || (Array.isArray(row.craftingStations) && row.craftingStations.length)
    || tags.some(tag => ['quest-object', 'crafting-station', 'jobboard', 'questboard', 'lab-node',
      'personal-storage', 'capital-storage'].includes(tag))) return REACH.interact;
  return 0;
}

// Необязательный аргумент — другой каталог локаций: так проверяется пробный экспорт сцен.
const locationsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'data/locations');
const files = fs.readdirSync(locationsDir).filter(name => name.endsWith('.json'));
assert(files.length >= 25, `подозрительно мало локаций: ${files.length}`);

const failures = [];
let checked = 0;
let targetsChecked = 0;
let actorsChecked = 0;

for (const file of files.sort()) {
  const loc = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  const objects = (Array.isArray(loc.objects) ? loc.objects : []).filter(row => row && typeof row === 'object');
  const dims = locationTileDims(loc);
  const fail = message => failures.push(`${loc.id}: ${message}`);

  const blockers = objects.flatMap(row => locationObjectBlockers(row));
  const index = buildStaticCollisionSpatialIndex(blockers, { cellSize: 8 });
  const near = (minX, minZ, maxX, maxZ) => queryStaticCollisionSpatialIndex(index, minX, minZ, maxX, maxZ);
  const isFree = (x, z, radius = PLAYER_RADIUS) => near(x - radius, z - radius, x + radius, z + radius)
    .every(blocker => circleBlockerPenalty(x, z, radius, blocker) <= 0.001);
  // serverInteractionHasLineOfSight: цель не заслоняет сама себя.
  const sees = (fromX, fromZ, toX, toZ, ownId) => !near(
    Math.min(fromX, toX) - 0.1, Math.min(fromZ, toZ) - 0.1, Math.max(fromX, toX) + 0.1, Math.max(fromZ, toZ) + 0.1
  ).some(blocker => !(ownId && blocker.objectId === ownId)
    && segmentIntersectsRotatedBlocker(fromX, fromZ, toX, toZ, blocker, 0.055, { startPadding: 0.3, endPadding: 0.42 }));

  // Границы игровой зоны: у всех текущих локаций совпадают с картой,
  // но формула повторяет серверную normalizedLocationPlayableBounds.
  const raw = loc.playableBounds && typeof loc.playableBounds === 'object' ? loc.playableBounds : {};
  const width = Math.max(8, Math.min(dims.w, Math.floor(Number(raw.width) || dims.w)));
  const height = Math.max(8, Math.min(dims.h, Math.floor(Number(raw.height) || dims.h)));
  const minTx = Math.max(0, Math.min(dims.w - width, Math.floor(Number.isFinite(Number(raw.minX)) ? Number(raw.minX) : (dims.w - width) / 2)));
  const minTz = Math.max(0, Math.min(dims.h - height, Math.floor(Number.isFinite(Number(raw.minZ)) ? Number(raw.minZ) : (dims.h - height) / 2)));
  const maxTx = minTx + width - 1;
  const maxTz = minTz + height - 1;

  const columns = Math.round(dims.w * TILE / CELL);
  const rowsCount = Math.round(dims.h * TILE / CELL);
  const cellX = column => (column + 0.5) * CELL - dims.w * TILE / 2;
  const cellZ = line => (line + 0.5) * CELL - dims.h * TILE / 2;
  const tileOf = (column, line) => ({ tx: Math.floor(column * CELL / TILE), tz: Math.floor(line * CELL / TILE) });
  const free = new Uint8Array(columns * rowsCount);
  for (let line = 0; line < rowsCount; line++) {
    for (let column = 0; column < columns; column++) {
      const tile = tileOf(column, line);
      if (tile.tx < minTx || tile.tz < minTz || tile.tx > maxTx || tile.tz > maxTz) continue;
      if (isFree(cellX(column), cellZ(line))) free[line * columns + column] = 1;
    }
  }

  const spawn = pointOf(loc.spawn, dims);
  if (!spawn) { fail('нет точки спавна'); continue; }

  // Заливка от спавна. Спавн может стоять вплотную к стене — стартуем с ближайшей
  // свободной клетки в пределах 1.5 м, как серверный respawn ищет место рядом.
  const nearestFreeCell = (point, reach) => {
    let best = -1;
    let bestDistance = Infinity;
    const span = Math.ceil(reach / CELL);
    const centerColumn = Math.floor((point.x + dims.w * TILE / 2) / CELL);
    const centerLine = Math.floor((point.z + dims.h * TILE / 2) / CELL);
    for (let line = centerLine - span; line <= centerLine + span; line++) {
      for (let column = centerColumn - span; column <= centerColumn + span; column++) {
        if (column < 0 || line < 0 || column >= columns || line >= rowsCount || !free[line * columns + column]) continue;
        const distance = Math.hypot(cellX(column) - point.x, cellZ(line) - point.z);
        if (distance <= reach && distance < bestDistance) { bestDistance = distance; best = line * columns + column; }
      }
    }
    return best;
  };

  const start = nearestFreeCell(spawn, 1.5);
  if (start < 0) { fail(`спавн (${spawn.x}, ${spawn.z}) заперт коллизией`); continue; }
  const reached = new Uint8Array(columns * rowsCount);
  const queue = [start];
  reached[start] = 1;
  while (queue.length) {
    const cell = queue.pop();
    const column = cell % columns;
    const line = (cell - column) / columns;
    for (const [dc, dl] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = column + dc;
      const nl = line + dl;
      if (nc < 0 || nl < 0 || nc >= columns || nl >= rowsCount) continue;
      const next = nl * columns + nc;
      if (reached[next] || !free[next]) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }

  const reachedNear = (point, reach, accept = () => true) => {
    const span = Math.ceil(reach / CELL);
    const centerColumn = Math.floor((point.x + dims.w * TILE / 2) / CELL);
    const centerLine = Math.floor((point.z + dims.h * TILE / 2) / CELL);
    for (let line = centerLine - span; line <= centerLine + span; line++) {
      for (let column = centerColumn - span; column <= centerColumn + span; column++) {
        if (column < 0 || line < 0 || column >= columns || line >= rowsCount || !reached[line * columns + column]) continue;
        const x = cellX(column);
        const z = cellZ(line);
        if (Math.hypot(x - point.x, z - point.z) <= reach && accept(x, z)) return true;
      }
    }
    return false;
  };

  // Любая точка прибытия: игрок появляется ровно в ней и обязан выйти на общую землю.
  // Точку в преграде сервер меняет на ближайший свободный центр тайла
  // (ensurePlayerOutsideRoomGeometry) — порой в нескольких метрах и уже вне
  // досягаемости двери, через которую игрок пришёл и хочет уйти назад.
  for (const [key, value] of Object.entries(loc)) {
    if (!/^(spawn|respawn|entry|entry[A-Z]\w*|migrationArrival)$/.test(key)) continue;
    const point = pointOf(value, dims);
    if (!point) continue;
    if (!isFree(point.x, point.z)) fail(`точка прибытия ${key} (${point.x}, ${point.z}) стоит в преграде: сервер сдвинет игрока`);
    else if (!reachedNear(point, 1.5)) fail(`точка прибытия ${key} (${point.x}, ${point.z}) отрезана от спавна`);
  }

  for (const row of objects) {
    const position = locationObjectPosition(row);
    if (locationObjectIsNpc(row)) {
      actorsChecked++;
      const label = `${isHostile(row) ? 'противник' : 'NPC'} ${row.id}`;
      // spawnAuthoredLocationActors ставит актёра на авторскую точку, только если там
      // свободно для круга 0.32 м (isEnemyStepOpen); иначе он остаётся на ближайшей
      // свободной клетке сетки — порой по другую сторону стены.
      if (!isFree(position.x, position.z, 0.32)) {
        fail(`${label} (${position.x}, ${position.z}) стоит внутри преграды: сервер поставит его в другом месте`);
      }
      else if (isHostile(row)) {
        if (!reachedNear(position, 2.5)) fail(`${label} отрезан от спавна: до него не дойти и он не выйдет`);
      } else if (!reachedNear(position, REACH.interact, (x, z) => sees(x, z, position.x, position.z, ''))) {
        fail(`${label} не виден ни из одной доступной точки в ${REACH.interact + CELL} м: поговорить и торговать нельзя`);
      }
      continue;
    }
    const reach = interactionReach(row);
    if (!reach) continue;
    targetsChecked++;
    const ownId = String(row.id || '');
    if (!reachedNear(position, reach, (x, z) => sees(x, z, position.x, position.z, ownId)))
      fail(`объект ${row.id} (${position.x}, ${position.z}) не виден ни из одной доступной точки в ${reach + CELL} м`);
  }

  for (const container of Array.isArray(loc.containers) ? loc.containers : []) {
    const point = pointOf(container, dims);
    if (!point) continue;
    targetsChecked++;
    if (!reachedNear(point, REACH.loot, (x, z) => sees(x, z, point.x, point.z, '')))
      fail(`тайник ${container.id} (${point.x}, ${point.z}) не виден ни из одной доступной точки в ${REACH.loot + CELL} м`);
  }

  for (const transition of Array.isArray(loc.transitions) ? loc.transitions : []) {
    if (String(transition.type || '').toLowerCase() === 'globalmap') continue;
    const point = pointOf(transition, dims);
    if (!point) continue;
    targetsChecked++;
    if (!reachedNear(point, Math.max(1.5, Number(transition.radius) || 2.4)))
      fail(`переход ${transition.id || transition.to} (${point.x}, ${point.z}) недостижим от спавна`);
  }

  // Полоса выхода: серверный предикат serverPlayerAtGlobalMapExit — два крайних
  // тайла внутри игровой зоны.
  const inner = EXIT_BAND_TILES - 1;
  const sides = { north: false, south: false, west: false, east: false };
  let bandReached = 0;
  for (let cell = 0; cell < reached.length; cell++) {
    if (!reached[cell]) continue;
    const column = cell % columns;
    const tile = tileOf(column, (cell - column) / columns);
    let inBand = false;
    if (tile.tz <= minTz + inner) { sides.north = true; inBand = true; }
    if (tile.tz >= maxTz - inner) { sides.south = true; inBand = true; }
    if (tile.tx <= minTx + inner) { sides.west = true; inBand = true; }
    if (tile.tx >= maxTx - inner) { sides.east = true; inBand = true; }
    if (inBand) bandReached++;
  }

  const reachableSides = Object.entries(sides).filter(([, ok]) => ok).map(([name]) => name);
  // Сердцевина и лаборатории намеренно без выхода на глобальную карту:
  // спавн проверен выше, а выход идёт через платформу метро или лифт.
  if (loc.allowGlobalMapExit === false) {
    checked++;
    console.log(`  ${loc.id}: выход на глобальную карту закрыт авторски, проверены спавн и цели (${dims.w}×${dims.h})`);
    continue;
  }
  if (!reachableSides.length) {
    fail(`полоса выхода недостижима от спавна (${spawn.x}, ${spawn.z}), преград ${blockers.length}`);
    continue;
  }

  // Явный авторский выход тоже обязан быть достижим.
  const exit = pointOf(loc.exit, dims);
  if (exit && !reachedNear(exit, 3)) {
    fail(`авторский выход (${exit.x}, ${exit.z}) недостижим от спавна`);
    continue;
  }

  checked++;
  if (reachableSides.length < 4) {
    console.log(`  ${loc.id}: достижимо сторон ${reachableSides.length}/4 (${reachableSides.join(', ')}), клеток полосы ${bandReached}`);
  }
}

if (failures.length) {
  console.error('Location reachability FAILED:');
  for (const line of failures) console.error('  - ' + line);
  process.exit(1);
}

console.log(`Location reachability OK: ${checked} локаций, точки прибытия свободны, выход открыт хотя бы с одной стороны, `
  + `${actorsChecked} NPC и противников стоят на свободной земле, ${targetsChecked} целей взаимодействия видны игроку.`);
