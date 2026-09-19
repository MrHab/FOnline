#!/usr/bin/env node
'use strict';

// Конструктор зон: из рецепта и каталога кусков получается обычная локация, по
// которой можно ходить. Проверяется поведение чистого модуля: повторяемость,
// связность, свободные ворота и точки входа, бюджеты по цвету опасности — и то,
// что каждый префаб набора есть среди отслеживаемых префабов клиента.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadZoneCatalog, normalizeChunk, normalizeKit, rotatePoint, rotatedHalfExtents } = require('../src/server/zone-chunks');
const {
  BUILDER_VERSION, DIRECTIONS, GATE_ENTRY_TILE, GATE_TRIGGER_TILE, TILES, WALK_MAX, WALK_MIN,
  buildZone, rasterize, reachable, zoneRevision
} = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
const MODES = ['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack'];

// --- каталог ----------------------------------------------------------------------------
const prefabDir = path.join(root, 'unity-client', 'Assets', 'Prefabs', 'Kromka', 'RecoveredEnvironment');
for (const prefab of Object.keys(catalog.kit)) {
  assert(fs.existsSync(path.join(prefabDir, `${prefab}.prefab`)), `kit prefab ${prefab} is a tracked client prefab`);
}
for (const kind of ['filler', 'poi', 'landmark', 'resource', 'lair']) {
  for (const mode of MODES) {
    if (kind === 'lair' && mode === 'peaceful') continue;
    assert(catalog.chunks.some(chunk => chunk.kind === kind && (chunk.modes.includes('*') || chunk.modes.includes(mode))),
      `a ${kind} chunk exists for ${mode} zones`);
  }
}
assert.throws(() => normalizeChunk({ schema: 'kromka.zoneChunk.v1', id: 'bad', kind: 'poi', objects: [{ id: 'a', prefab: 'no_such_prefab', x: 0, z: 0 }] }, catalog.kit),
  /not in the kit/, 'a chunk cannot use a prefab outside the kit');
assert.throws(() => normalizeChunk({ schema: 'kromka.zoneChunk.v1', id: 'bad', kind: 'poi', objects: [{ id: 'a', prefab: 'rubble_rock', x: 25, z: 0 }] }, catalog.kit),
  /inside the 40 m slot/, 'a chunk object cannot leave its slot');
assert.deepEqual(rotatePoint(3, 5, 90), { x: 5, z: -3 });
assert.deepEqual(rotatePoint(3, 5, 270), { x: -5, z: 3 });
const turned = rotatedHalfExtents(4, 1, 90);
assert(Math.abs(turned.hx - 0.5) < 1e-9 && Math.abs(turned.hz - 2) < 1e-9, 'a quarter turn swaps the extents');

// --- зоны -------------------------------------------------------------------------------
function recipe(mode, seed, extra = {}) {
  return {
    zoneId: `z_test_${mode}_${seed}`, name: `Проверка ${mode}`, seed, biome: 'middle_vein', groundPreset: 'riverSilt', mode, difficulty: 3,
    col: 9, row: 10, n: 131,
    gates: [
      { dir: 'north', to: 'z_09_09', toTitle: 'Север №112', toMode: 'pve', along: 0.47, road: true },
      { dir: 'south', to: 'z_09_11', toTitle: 'Юг №150', along: 0.5, road: true },
      { dir: 'east', to: 'z_10_10', toTitle: 'Восток №132', toMode: 'pvp', along: 0.3 },
      { dir: 'west', to: 'z_08_10', toTitle: 'Запад №130', along: 0.82 }
    ],
    places: [{ locationId: 'settlement', name: 'Ключи', u: 0.75, v: 0.25 }, { locationId: 'roadOutpost', name: 'Дорожный пост', u: 0.3, v: 0.7 }],
    ...extra
  };
}

function assertWalkable(def) {
  const seen = reachable(rasterize(def.objects), def.spawn);
  const near = tile => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen[(tile.tz + dz) * TILES + tile.tx + dx]);
  assert(near(def.spawn), `${def.id}: the zone centre is open`);
  for (const gate of def.transitions) assert(near(gate), `${def.id}: ${gate.id} is reachable from the centre`);
  for (const key of Object.keys(def).filter(name => name.startsWith('entryFrom'))) assert(near(def[key]), `${def.id}: ${key} is reachable`);
  for (const row of def.containers) assert(near(row), `${def.id}: container ${row.id} is reachable`);
  for (const row of [...def.zone.spawnAreas, ...def.zone.lairs, ...def.zone.eventAnchors]) assert(near(row), `${def.id}: ${row.id} is reachable`);
}

let built = 0;
for (const mode of MODES) {
  for (const seed of [1, 77, 3182223411, 4000000001]) {
    const input = recipe(mode, seed);
    const def = buildZone(input, catalog);
    built += 1;
    assert.equal(JSON.stringify(buildZone(input, catalog)), JSON.stringify(def), `${def.id}: the same recipe builds the same zone`);
    assert.equal(def.revision, zoneRevision(def));
    assert.equal(def.builderVersion, BUILDER_VERSION);
    assert.deepEqual(def.map, { width: TILES * 2, depth: TILES * 2, origin: 'center' });
    assert.equal(def.pvpMode, mode);
    assert.equal(def.generated, true);
    assert.equal(def.allowGlobalMapExit, false, 'the perimeter is closed: the only way out is a gate');

    // Ворота: проём у края, вход соседа — с противоположной стороны, своя точка входа глубже проёма.
    for (const gate of input.gates) {
      const row = def.transitions.find(t => t.id === `gate_${gate.dir}`);
      assert(row && row.type === 'zoneGate' && row.to === gate.to && row.label === gate.toTitle);
      assert.equal(row.entryKey, DIRECTIONS[gate.dir].targetEntry, `${gate.dir} gate lands on the opposite side of the neighbour`);
      const entry = def[DIRECTIONS[gate.dir].entry];
      assert(entry, `${def.id}: arrivals from the ${gate.dir} have an entry point`);
      const edgeOf = tile => (DIRECTIONS[gate.dir].axis === 'z' ? tile.tz : tile.tx);
      const alongOf = tile => (DIRECTIONS[gate.dir].axis === 'z' ? tile.tx : tile.tz);
      const near = DIRECTIONS[gate.dir].near;
      assert.equal(edgeOf(row), near ? GATE_TRIGGER_TILE : TILES - 1 - GATE_TRIGGER_TILE);
      assert.equal(edgeOf(entry), near ? GATE_ENTRY_TILE : TILES - 1 - GATE_ENTRY_TILE);
      assert.equal(alongOf(row), alongOf(entry), 'the entry point sits straight inside its gate');
      assert(Math.abs(alongOf(row) - Math.round(gate.along * (TILES - 1))) <= 1, 'the gate follows the shared edge position');
      assert(edgeOf(row) >= WALK_MIN && edgeOf(row) <= WALK_MAX, 'the gate is inside the walkable band');
    }
    for (const place of input.places) {
      const portal = def.transitions.find(t => t.to === place.locationId);
      assert(portal && portal.type === 'location' && portal.entryKey === 'entryFromWorld');
      assert(def[`entryFromPlace_${place.locationId}`], `${def.id}: leaving ${place.locationId} has an entry point in the zone`);
    }
    assert.equal(new Set(def.transitions.map(t => t.id)).size, def.transitions.length, 'transition ids are unique');
    assert.equal(new Set(def.objects.map(o => o.id)).size, def.objects.length, 'object ids are unique');

    // Ничто не стоит на воротах, входах и центре, всё внутри зоны.
    const keyTiles = [def.spawn, ...def.transitions, ...Object.keys(def).filter(k => k.startsWith('entryFrom')).map(k => def[k])];
    for (const row of def.objects) {
      assert(Math.abs(row.position.x) < TILES && Math.abs(row.position.z) < TILES, `${row.id} is inside the zone`);
      assert(catalog.kit[row.prefab], `${row.id} uses a kit prefab`);
      if (row.collision !== 'solid') continue;
      assert(row.collisionSize.width > 0 && row.collisionSize.depth > 0, `${row.id} carries exact collision metres`);
      for (const tile of keyTiles) {
        const d = Math.hypot(row.position.x - (tile.tx - TILES / 2 + 0.5) * 2, row.position.z - (tile.tz - TILES / 2 + 0.5) * 2);
        assert(d >= 6, `${def.id}: ${row.id} stands ${d.toFixed(1)} m from a gate, entry or the centre`);
      }
    }
    assertWalkable(def);

    // Бюджеты по цвету.
    assert(def.objects.length <= 260 && def.objects.length >= 40, `${def.id}: ${def.objects.length} objects`);
    if (mode === 'peaceful') {
      assert.equal(def.zone.lairs.length + def.containers.length + def.anomalyFields.length, 0, 'a peaceful zone has no lairs, caches or anomalies');
    } else {
      assert(def.zone.lairs.length >= 1, `${def.id}: a wild zone has a lair`);
      assert(def.zone.spawnAreas.length >= 2, `${def.id}: a wild zone has places for A-Life to appear`);
      assert(def.containers.length >= 1, `${def.id}: a wild zone has a cache`);
    }
    if (mode === 'pvpFullDrop' || mode === 'pvpBlack') assert(def.anomalyFields.length >= 1, `${def.id}: a dangerous zone has anomalies`);
    for (const row of def.containers) {
      assert(row.loot.length >= 2 && row.loot.every(item => item.qty >= 1));
      assert(row.loot.every(item => item.id !== 'silver') || (row.locked && (mode === 'pvpFullDrop' || mode === 'pvpBlack')), 'marks only behind a lock in a dangerous zone');
    }
    // A-Life не появляется у ворот: прибывший не оказывается в стае.
    const arrivals = Object.keys(def).filter(k => k.startsWith('entryFrom') && k !== 'entryFromWorld').map(k => def[k]);
    for (const row of [...def.zone.spawnAreas, ...def.zone.lairs]) {
      for (const tile of arrivals) assert(Math.hypot(row.tx - tile.tx, row.tz - tile.tz) * 2 >= 40, `${def.id}: ${row.id} is at least 40 m from every arrival point`);
    }
    // Граф путей связывает центр с каждыми воротами и местом.
    const ids = new Set(def.zone.nav.nodes.map(node => node.id));
    for (const link of def.zone.nav.links) assert(ids.has(link[0]) && ids.has(link[1]), 'nav links point at nav nodes');
    for (const gate of input.gates) assert(ids.has(`gate_${gate.dir}`));
  }
}

// Тупик и зона без мест тоже собираются; разные зёрна дают разные зоны.
const deadEnd = buildZone(recipe('pvp', 5, { gates: [{ dir: 'south', to: 'z_01_02', toTitle: 'Юг', along: 0.5 }], places: [] }), catalog);
assertWalkable(deadEnd);
assert.notEqual(buildZone(recipe('pvp', 5), catalog).revision, buildZone(recipe('pvp', 6), catalog).revision, 'the seed changes the zone');
assert.throws(() => buildZone(recipe('pvp', 5, { gates: [{ dir: 'up', to: 'z' }] }), catalog), /unknown or repeated/);

// --- сторож правил сборки ---------------------------------------------------------------
// Крошечный собственный каталог: правка кусков игры его не задевает, а любое изменение
// правил конструктора меняет хэш. Изменили правила намеренно — поднимите BUILDER_VERSION
// и обновите хэши здесь.
const tinyKit = normalizeKit({ prefabs: { rubble_rock: { size: [2.4, 2], solid: true, vision: true }, dry_bush: { size: [1.5, 1.4] }, ore_outcrop: { size: [1.8, 1.5], resource: 'ore', hp: 6 } } });
const tiny = (id, kind, anchors = []) => normalizeChunk({
  schema: 'kromka.zoneChunk.v1', id, kind,
  objects: [{ id: 'r', prefab: 'rubble_rock', x: -8, z: -6, ry: 30 }, { id: 'b', prefab: 'dry_bush', x: 6, z: 9 }, { id: 'o', prefab: 'ore_outcrop', x: 10, z: -10 }],
  anchors
}, tinyKit);
const tinyCatalog = {
  kit: tinyKit,
  chunks: [
    tiny('t_filler', 'filler'), tiny('t_landmark', 'landmark', [{ id: 'e', type: 'eventAnchor', x: 0, z: 12, radius: 8 }]),
    tiny('t_lair', 'lair', [{ id: 'den', type: 'lair', x: 0, z: 0 }, { id: 'p', type: 'spawnArea', x: 5, z: 5, radius: 8 }]),
    tiny('t_poi', 'poi', [{ id: 'c', type: 'container', x: 2, z: 2 }, { id: 'a', type: 'anomaly', x: -4, z: 8, radius: 3 }]),
    tiny('t_resource', 'resource')
  ]
};
const GOLDEN = { pve: 'b1-a31cbede', pvpBlack: 'b1-edb5879b' };
for (const [mode, expected] of Object.entries(GOLDEN)) {
  const revision = buildZone(recipe(mode, 20260920), tinyCatalog).revision;
  assert.equal(revision, expected, `constructor rules changed for ${mode}: bump BUILDER_VERSION and update GOLDEN (got ${revision})`);
}

console.log(`Zone builder OK: ${catalog.chunks.length} chunks over ${Object.keys(catalog.kit).length} kit prefabs, ${built} zones built twice byte for byte, gates and entries clear and reachable, budgets follow the danger colour.`);
