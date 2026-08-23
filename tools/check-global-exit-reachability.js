#!/usr/bin/env node
'use strict';
// Достижимость зон выхода на глобальную карту.
//
// check-global-exit-direction проверяет геометрию полос (направление, ширину,
// отрисовку), но не отвечает на главный игровой вопрос: может ли персонаж
// ДОЙТИ от точки спавна до полосы выхода пешком. Стена из авторских объектов,
// поставленная поперёк, запечатала бы выход, и ни одна статическая проверка
// этого бы не заметила. Повод написать эту: живой Unity-прогон, где персонаж
// у края локации упал за пределы мира — выяснилось, что край карты никто
// не проверял целиком.
//
// Метод: для каждой локации собираются те же OBB-блокираторы движения, что
// строит сервер (transformedModelBlockers по каталогу model-colliders.json,
// server.js:12366), тайл считается проходимым, если центр тайла с радиусом
// игрока не попадает в блокиратор, и от спавна запускается заливка.
// Полоса выхода — два крайних тайла игровой зоны с каждой стороны
// (WORLD_MAP_EXIT_BAND_TILES = 2, server.js:18485).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadModelColliderCatalog,
  modelColliderCatalogEntry,
  transformedModelBlockers
} = require('../src/server/model-colliders');

const ROOT = path.resolve(__dirname, '..');
const TILE = 2;
const MAP_W = 38;
const MAP_H = 38;
const EXIT_BAND_TILES = 2;
const PLAYER_RADIUS = 0.35;

const catalog = loadModelColliderCatalog(
  path.join(ROOT, 'public/assets/models/wasteland/model-colliders.json'));

// --- Мини-копии серверных помощников (server.js:12133–12420). Логика обязана
// совпадать с сервером, поэтому переносится дословно, а не «по мотивам». ---

const MODULE_MODEL_KEYS = new Set([
  'traderWallBlock', 'traderWindowBlock', 'traderFloorSlab', 'traderRoofBlock',
  'wallWoodBlock', 'wallBrickBlock', 'wallMetalBlock',
  'roofWoodBlock', 'roofMetalBlock', 'floorWoodBlock', 'floorTileBlock'
]);

function objectPosition(row = {}) {
  const pos = row.position && typeof row.position === 'object' ? row.position : row;
  return { x: Number(pos.x || 0), z: Number(pos.z || 0) };
}

function objectScale(row = {}) {
  if (MODULE_MODEL_KEYS.has(String(row.model || ''))) return { x: 1, z: 1 };
  const scale = row.scale && typeof row.scale === 'object' ? row.scale : {};
  const uniform = Number(row.scale || 1);
  const fallback = Number.isFinite(uniform) ? uniform : 1;
  return {
    x: Number.isFinite(Number(scale.x)) ? Number(scale.x) : fallback,
    z: Number.isFinite(Number(scale.z)) ? Number(scale.z) : fallback
  };
}

function objectRotationY(row = {}) {
  const rotation = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
  const value = Number(rotation.y ?? row.rotationY ?? (typeof row.rotation === 'number' ? row.rotation : 0));
  return Number.isFinite(value) ? value : 0;
}

function objectTags(row = {}) {
  return (Array.isArray(row.tags) ? row.tags : [])
    .map(tag => String(tag || '').trim().toLowerCase())
    .filter(Boolean);
}

function objectIsNpc(row = {}) {
  const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
  const entityKind = String(entity.kind || row.entity || '').trim().toLowerCase();
  return entityKind === 'npc' || entityKind === 'enemy' || entityKind === 'monster'
    || objectTags(row).some(tag => ['npc', 'enemy', 'monster', 'living', 'friendly', 'guard', 'merchant', 'trader'].includes(tag))
    || /^(enemy|npc|tradernpc|caravanmerchant|caravanguard|klimpatrolguard|wastelandsettler|friendlybrahmin)/i.test(String(row.model || ''));
}

function objectAllowsPlayerOverlap(row = {}) {
  const explicit = String(row.playerCollision ?? row.movementCollision ?? '').trim().toLowerCase();
  if (row.playerCollision === false
    || ['none', 'off', 'disabled', 'pass', 'pass-through', 'passthrough'].includes(explicit)) return true;
  const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
  const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
  const kinds = [interactive.kind, entity.kind, row.kind]
    .map(value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean);
  const tags = [...objectTags(row), ...objectTags(entity), ...objectTags(interactive)];
  return kinds.some(kind => ['craftingstation', 'jobboard', 'trademachine', 'vendingmachine', 'container', 'storage'].includes(kind))
    || tags.some(tag => [
      'interactive', 'crafting-station', 'jobboard', 'questboard', 'trademachine',
      'vendingmachine', 'container', 'storage', 'personal-storage', 'ground-item',
      'loot-item', 'pickup', 'pass-through', 'no-player-collision'
    ].includes(tag));
}

function objectBlocksMovement(row = {}) {
  if (objectIsNpc(row)) return false;
  const tags = objectTags(row);
  const role = String((row.occlusion && row.occlusion.role) || '').toLowerCase();
  if (role === 'roof' || role === 'floor' || tags.includes('roof') || tags.includes('floor')) return false;
  if (objectAllowsPlayerOverlap(row)) return false;
  const collision = String(row.collision || '').toLowerCase();
  return ['solid', 'block', 'blocked', 'wall', 'resource'].includes(collision);
}

function objectModelRef(row = {}) {
  return String(row.url || row.file || '').trim();
}

function objectFootprintSize(row = {}) {
  const placement = row.placement && typeof row.placement === 'object' ? row.placement : {};
  const cells = placement.cells && typeof placement.cells === 'object' ? placement.cells : {};
  const footprint = row.footprint && typeof row.footprint === 'object' ? row.footprint : {};
  const scale = objectScale(row);
  const cellW = Number(cells.x || 0) > 0 ? Number(cells.x) * TILE : 0;
  const cellD = Number(cells.z || 0) > 0 ? Number(cells.z) * TILE : 0;
  return {
    width: Math.max(0.45, cellW || Number(footprint.x || 0) || Math.max(1, Math.abs(scale.x)) * TILE),
    depth: Math.max(0.45, cellD || Number(footprint.z || 0) || Math.max(1, Math.abs(scale.z)) * TILE)
  };
}

function objectBlockers(row) {
  const pos = objectPosition(row);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return [];
  const scale = objectScale(row);
  const rotationY = objectRotationY(row);
  const modelRef = objectModelRef(row);
  const entry = modelColliderCatalogEntry(catalog, modelRef);
  const parts = transformedModelBlockers(catalog, modelRef, {
    x: pos.x, z: pos.z, rotationY, scaleX: scale.x, scaleZ: scale.z
  });
  if (entry && parts.length) return parts;
  if (entry) {
    // Модель в каталоге, но без частей и без явного collisionSize —
    // сервер такие пропускает (server.js:12378).
    const exact = row.collisionSize && typeof row.collisionSize === 'object' ? row.collisionSize : {};
    if (!(Number(exact.width || exact.x || 0) > 0 && Number(exact.depth || exact.z || 0) > 0)) return [];
  }
  const size = objectFootprintSize(row);
  return [{
    x: pos.x, z: pos.z,
    halfX: Math.max(0.2, size.width * 0.5),
    halfZ: Math.max(0.2, size.depth * 0.5),
    rotationY: -rotationY
  }];
}

// Точка (центр тайла) с радиусом игрока против OBB — так же семплирует
// проходимость web-клиент (isBlockedByStaticCollision по позиции персонажа).
function pointBlocked(x, z, blockers) {
  for (const box of blockers) {
    const dx = x - box.x;
    const dz = z - box.z;
    const cos = Math.cos(box.rotationY || 0);
    const sin = Math.sin(box.rotationY || 0);
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;
    if (Math.abs(localX) <= box.halfX + PLAYER_RADIUS && Math.abs(localZ) <= box.halfZ + PLAYER_RADIUS) return true;
  }
  return false;
}

function tileToWorld(tx, tz) {
  return { x: (tx - MAP_W / 2 + 0.5) * TILE, z: (tz - MAP_H / 2 + 0.5) * TILE };
}

// --- Сама проверка ---

const locationsDir = path.join(ROOT, 'data/locations');
const files = fs.readdirSync(locationsDir).filter(name => name.endsWith('.json'));
assert(files.length >= 25, `подозрительно мало локаций: ${files.length}`);

const failures = [];
let checked = 0;

for (const file of files.sort()) {
  const loc = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  const objects = Array.isArray(loc.objects) ? loc.objects : [];

  const blockers = [];
  for (const row of objects) {
    if (!row || !objectBlocksMovement(row)) continue;
    blockers.push(...objectBlockers(row));
  }

  // Границы игровой зоны: у всех текущих локаций совпадают с картой,
  // но формула повторяет серверную normalizedLocationPlayableBounds.
  const raw = loc.playableBounds && typeof loc.playableBounds === 'object' ? loc.playableBounds : {};
  const width = Math.max(8, Math.min(MAP_W, Math.floor(Number(raw.width) || MAP_W)));
  const height = Math.max(8, Math.min(MAP_H, Math.floor(Number(raw.height) || MAP_H)));
  const minX = Math.max(0, Math.min(MAP_W - width, Math.floor(Number.isFinite(Number(raw.minX)) ? Number(raw.minX) : (MAP_W - width) / 2)));
  const minZ = Math.max(0, Math.min(MAP_H - height, Math.floor(Number.isFinite(Number(raw.minZ)) ? Number(raw.minZ) : (MAP_H - height) / 2)));
  const maxX = minX + width - 1;
  const maxZ = minZ + height - 1;

  const walkable = [];
  for (let tz = 0; tz < MAP_H; tz++) {
    walkable[tz] = [];
    for (let tx = 0; tx < MAP_W; tx++) {
      if (tx < minX || tz < minZ || tx > maxX || tz > maxZ) { walkable[tz][tx] = false; continue; }
      const point = tileToWorld(tx, tz);
      walkable[tz][tx] = !pointBlocked(point.x, point.z, blockers);
    }
  }

  const spawn = loc.spawn || {};
  const spawnTx = Number(spawn.tx);
  const spawnTz = Number(spawn.tz);
  if (!Number.isFinite(spawnTx) || !Number.isFinite(spawnTz)) {
    failures.push(`${loc.id}: нет точки спавна`);
    continue;
  }

  // Заливка от спавна. Спавн может стоять на краю коллайдера — стартуем
  // с ближайшего проходимого тайла в радиусе двух, как серверный respawn.
  const reached = new Set();
  const queue = [];
  outer:
  for (let r = 0; r <= 2; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = spawnTx + dx;
        const tz = spawnTz + dz;
        if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
        if (walkable[tz][tx]) { queue.push([tx, tz]); reached.add(tz * MAP_W + tx); break outer; }
      }
    }
  }

  if (!queue.length) {
    failures.push(`${loc.id}: спавн (${spawnTx},${spawnTz}) заперт коллизией`);
    continue;
  }

  while (queue.length) {
    const [tx, tz] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
      const key = nz * MAP_W + nx;
      if (reached.has(key) || !walkable[nz][nx]) continue;
      reached.add(key);
      queue.push([nx, nz]);
    }
  }

  // Полоса выхода: серверный предикат serverPlayerAtGlobalMapExit
  // (server.js:18668) — два крайних тайла внутри игровой зоны.
  const inner = EXIT_BAND_TILES - 1;
  const sides = { north: false, south: false, west: false, east: false };
  let bandReached = 0;

  for (const key of reached) {
    const tx = key % MAP_W;
    const tz = Math.floor(key / MAP_W);
    let inBand = false;
    if (tz <= minZ + inner) { sides.north = true; inBand = true; }
    if (tz >= maxZ - inner) { sides.south = true; inBand = true; }
    if (tx <= minX + inner) { sides.west = true; inBand = true; }
    if (tx >= maxX - inner) { sides.east = true; inBand = true; }
    if (inBand) bandReached++;
  }

  const reachableSides = Object.entries(sides).filter(([, ok]) => ok).map(([name]) => name);
  if (!reachableSides.length) {
    failures.push(`${loc.id}: полоса выхода недостижима от спавна (${spawnTx},${spawnTz}), блокираторов ${blockers.length}`);
    continue;
  }

  // Явный авторский выход тоже обязан быть достижим.
  if (loc.exit && Number.isFinite(Number(loc.exit.tx)) && Number.isFinite(Number(loc.exit.tz))) {
    const near = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        near.push((Number(loc.exit.tz) + dz) * MAP_W + (Number(loc.exit.tx) + dx));
      }
    }
    if (!near.some(key => reached.has(key))) {
      failures.push(`${loc.id}: авторский выход (${loc.exit.tx},${loc.exit.tz}) недостижим от спавна`);
      continue;
    }
  }

  checked++;
  if (reachableSides.length < 4) {
    console.log(`  ${loc.id}: достижимо сторон ${reachableSides.length}/4 (${reachableSides.join(', ')}), тайлов полосы ${bandReached}`);
  }
}

if (failures.length) {
  console.error('Global exit reachability FAILED:');
  for (const line of failures) console.error('  - ' + line);
  process.exit(1);
}

console.log(`Global exit reachability OK: ${checked} локаций, спавн и авторский выход достижимы, полоса выхода открыта хотя бы с одной стороны.`);
