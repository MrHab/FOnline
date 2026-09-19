'use strict';

// Сетка тайлов задаётся локацией: обычные сцены остаются 38×38, большая
// авторская сцена объявляет размер через `map.width/depth` в метрах и не имеет
// верхнего предела. Проверяет извлечённые из server.js помощники.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
// Объекты из vm-контекста имеют другой прототип; сравниваем как простые данные.
const same = (actual, expected, message) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message);

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js must define ${name}`);
  // Пропускаем список параметров (в нём могут быть `{}` по умолчанию), затем
  // считаем фигурные скобки тела.
  let paren = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') paren++;
    if (ch === ')') { paren--; if (paren === 0) { bodyStart = source.indexOf('{', i); break; } }
  }
  assert(bodyStart >= 0, `cannot find body of ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

const LOCATIONS = {
  settlement: { id: 'settlement' },
  vectorLab: { id: 'vectorLab', map: { width: 72, depth: 72, origin: 'center' } },
  coreZone: { id: 'coreZone', map: { width: 320, depth: 320, origin: 'center' } },
  hugeZone: { id: 'hugeZone', map: { width: 2000, depth: 1200, origin: 'center' } },
  siteInstance: { id: 'siteInstance', map: { width: 40, depth: 40, technicalWidth: 76, technicalDepth: 76 } }
};
const rooms = new Map([
  ['coreZone', { id: 'coreZone', locationId: 'coreZone' }],
  ['settlement', { id: 'settlement', locationId: 'settlement' }]
]);
const context = vm.createContext({
  LOCATIONS,
  rooms,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  normalizeLocationId: id => String(id || 'settlement'),
  WORLD_MAP_EXIT_BAND_TILES: 2,
  PLAYER_COLLISION_RADIUS: 0.48,
  serverPlayerCanLeaveByEdge: () => false,
  roomLocation: room => LOCATIONS[room.locationId]
});
vm.runInContext('const TILE = 2.0; const MAP_W = 38; const MAP_H = 38;', context);
vm.runInContext(source.slice(source.indexOf('const DEFAULT_TILE_DIMS ='), source.indexOf('function locationTileDims(')), context);
for (const name of [
  'locationTileDims', 'roomTileDims', 'roomWorldExtent', 'playerWorldExtent',
  'tileToWorld', 'worldToTile', 'inBounds', 'locationWorldToTilePoint',
  'normalizedLocationPlayableBounds', 'serverClosedLocationMovementBounds'
]) vm.runInContext(functionSource(name), context);

const {
  locationTileDims, roomTileDims, roomWorldExtent, playerWorldExtent,
  tileToWorld, worldToTile, inBounds, locationWorldToTilePoint,
  normalizedLocationPlayableBounds, serverClosedLocationMovementBounds
} = context;

// Без карты — прежняя сетка 38×38 и прежние координаты.
same({ ...locationTileDims(LOCATIONS.settlement) }, { w: 38, h: 38 });
same(tileToWorld(19, 19), { x: 1, z: 1 });
same(worldToTile(1, 1), { tx: 19, tz: 19 });
same(tileToWorld(0, 0), { x: -37, z: -37 });
assert.strictEqual(inBounds(37, 37), true);
assert.strictEqual(inBounds(38, 0), false);

// Авторская сцена 72 м остаётся на технической сетке 38×38 (как раньше), а
// техническая ширина инстанса имеет приоритет над видимой.
same({ ...locationTileDims(LOCATIONS.vectorLab) }, { w: 36, h: 36 });
same({ ...locationTileDims(LOCATIONS.siteInstance) }, { w: 38, h: 38 });

// Большая сцена: 320 м → 160 тайлов, центр остаётся в нуле, без верхнего предела.
const core = locationTileDims(LOCATIONS.coreZone);
same({ ...core }, { w: 160, h: 160 });
same(tileToWorld(80, 80, core), { x: 1, z: 1 });
same(tileToWorld(0, 0, core), { x: -159, z: -159 });
same(worldToTile(-159, 159, core), { tx: 0, tz: 159 });
assert.strictEqual(inBounds(159, 159, core), true);
assert.strictEqual(inBounds(160, 0, core), false);
same({ ...locationTileDims(LOCATIONS.hugeZone) }, { w: 1000, h: 600 });

// Комната наследует сетку локации и предел координат.
same({ ...roomTileDims(rooms.get('coreZone')) }, { w: 160, h: 160 });
assert.strictEqual(roomWorldExtent(rooms.get('coreZone')), 162);
assert.strictEqual(roomWorldExtent(rooms.get('settlement')), 40);
assert.strictEqual(playerWorldExtent({ roomId: 'coreZone' }), 162);
assert.strictEqual(playerWorldExtent({ roomId: 'missing' }), 40);
assert.strictEqual(playerWorldExtent(null), 40);

// Точки локации и границы считаются в её сетке.
same(locationWorldToTilePoint({ x: -159, z: 0 }, core), { tx: 0, tz: 80 });
same(locationWorldToTilePoint({ tx: 500, tz: -3 }, core), { tx: 159, tz: 0 });
same(locationWorldToTilePoint({ tx: 500, tz: -3 }), { tx: 37, tz: 0 });
const bounds = normalizedLocationPlayableBounds(LOCATIONS.coreZone);
same(bounds, { minX: 0, minZ: 0, maxX: 159, maxZ: 159, width: 160, height: 160 });
const closed = serverClosedLocationMovementBounds({}, rooms.get('coreZone'));
assert(closed.minX < -150 && closed.maxX > 150, 'closed bounds must span the large scene');

// Серверные привязки: билдеры комнаты и предел координат используют сетку комнаты.
assert(!/\bMAP_SIZE\b/.test(source), 'the global MAP_SIZE constant must be gone');
assert(source.includes('const authoredDims = roomTileDims(room);'));
assert(source.includes('const genDims = roomTileDims(room);'));
assert(source.includes('const worldExtent = playerWorldExtent(player);'));
assert(source.includes('const locDims = locationTileDims(loc);'));
assert(!source.includes('function tileToWorld(tx, tz) {'));

console.log('Location tile dims OK: per-location grids, unlimited authored scene size, room extents and playable bounds.');
