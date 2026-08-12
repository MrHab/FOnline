'use strict';
// Глобальная карта обязана доезжать до уже работающих серверов.
//
// Локации сервер собирает как «поставка + правки оператора», а карта читалась
// иначе: файл из DATA_DIR побеждал целиком. Из-за этого добавленная столица
// вольных караванов не появлялась на развёрнутом сервере — без узла нет ни
// круга локации, ни подписи, и войти в неё нельзя.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mergeAuthoredGlobalMap, MERGED_COLLECTIONS } = require('../src/server/global-map-merge');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// --- Слияние: новое добавляется, правки оператора сохраняются ---
const stored = {
  nodes: [{ id: 'settlement', x: 255, y: 615, note: 'правка оператора' }],
  infrastructure: [{ id: 'road_a' }],
  cells: { keep: true }
};
const bundled = {
  nodes: [
    { id: 'settlement', x: 195, y: 690, note: 'из поставки' },
    { id: 'caravanCamp', x: 495, y: 495 }
  ],
  infrastructure: [{ id: 'road_a' }, { id: 'road_b' }],
  cells: {}
};
const merged = mergeAuthoredGlobalMap(stored, bundled);

assert.strictEqual(merged.nodes.length, 2, 'новый узел из поставки не подмешался');
const settlement = merged.nodes.find(row => row.id === 'settlement');
assert.strictEqual(settlement.x, 255, 'слияние перетёрло координаты оператора');
assert.strictEqual(settlement.y, 615, 'слияние перетёрло координаты оператора');
assert.strictEqual(settlement.note, 'правка оператора', 'слияние перетёрло правку оператора');
assert(merged.nodes.some(row => row.id === 'caravanCamp'), 'новая столица не появилась');
assert.strictEqual(merged.infrastructure.length, 2, 'новая инфраструктура не подмешалась');
assert.deepStrictEqual(merged.cells, { keep: true }, 'слияние затронуло поля вне списка коллекций');

assert.deepStrictEqual(mergeAuthoredGlobalMap(null, bundled), bundled, 'без сохранённой карты берётся поставка');
assert.deepStrictEqual(mergeAuthoredGlobalMap(stored, null), stored, 'без поставки остаётся сохранённая карта');
for (const key of MERGED_COLLECTIONS) {
  assert(Array.isArray(merged[key]), `коллекция ${key} после слияния не массив`);
}

// --- Сервер обязан использовать именно слияние ---
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
assert(server.includes("require('./src/server/global-map-merge')"),
  'server.js больше не подмешивает карту из поставки');
assert(/GLOBAL_MAP = normalizeGlobalMapConfig\(readAuthoredGlobalMapJson\(/.test(server),
  'глобальная карта снова читается без подмешивания поставки');
for (const field of ['locationId:', 'capital:', 'capitalFaction:']) {
  assert(server.includes(field),
    `нормализация узла снова теряет поле ${field.replace(':', '')}`);
}

// --- Каждый город на карте должен быть входимым и подписанным ---
const globalMap = readJson('data/global-map.json');
const locationFiles = new Set(
  fs.readdirSync(path.join(ROOT, 'data', 'locations'))
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
);
const settlements = (globalMap.nodes || []).filter(node => String(node?.kind || '') === 'settlement');
assert(settlements.length >= 4, `на карте только ${settlements.length} городов`);
for (const node of settlements) {
  const id = String(node.id || '');
  assert(locationFiles.has(id),
    `город "${id}" не имеет файла локации: в него нельзя войти и его нечем подписать`);
  const location = readJson(`data/locations/${id}.json`);
  assert(String(location.name || '').trim(),
    `город "${id}" не имеет названия — подпись на карте будет пустой`);
}

console.log(`Global map merge OK: ${settlements.length} городов, все входимы и подписаны; поставка подмешивается без потери правок.`);
