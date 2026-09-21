'use strict';

// A Kromka location file and its Unity scene are two copies of one authored world:
// the client draws and collides with the scene, the authoritative server reads the
// data, and KromkaWorldSceneExporter turns one into the other. Where they disagree a
// full export silently rewrites the data — and until then the server and the client
// simply play different levels. Every such drift is asserted here:
//   rows        a static row without a scene object is invisible on the client and used
//               to be deleted by the export (18 story objectives and lab shafts);
//   collision   319 rows said "none" under markers that said "blocks";
//   tags        the export copies them from the marker (a quest antenna would have lost
//               `quest-object`, the tutorial cot would have got its sleep tags back);
//   parts       801 of 802 buildings blocked a 2x2 m placeholder on the server while
//               the client blocked their real colliders; the footprint is their extent.
// The geometry is recomputed from the scene YAML with the exporter's own rules
// (tools/kromka-walk-collision.js) and then rebuilt the way the server does it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  collisionBlocksMovement,
  locationScenePath,
  readMarkerColliders,
  readPlacedObjectMarkers
} = require('./kromka-scene-markers');
const { colliderFootprint, colliderShapes, MIN_PART_SIZE, walkCollisionParts } = require('./kromka-walk-collision');
const { createLocationCollision } = require('../src/server/location-collision');

const ROOT = path.resolve(__dirname, '..');
const locationsDir = path.join(ROOT, 'data', 'locations');
// The exporter rounds to a millimetre; float32 in Unity against float64 here can tip
// a value across a rounding edge, never further.
const TOLERANCE = 0.0015;
const { locationObjectBlockers } = createLocationCollision({ tile: 2 });

// KromkaWorldSceneExporter.IsLiveServerObject: actors are spawned by the server, the
// scene holds no object for them.
function isLiveRow(row) {
  const kind = String(row?.entity?.kind || '');
  if (['npc', 'enemy', 'creature', 'player'].includes(kind)) return true;
  return (Array.isArray(row?.tags) ? row.tags : []).some(tag => ['npc', 'living', 'hostile', 'mutant'].includes(tag));
}

function close(a, b) {
  return Math.abs(Number(a) - Number(b)) <= TOLERANCE;
}

function samePart(expected, actual) {
  if (!actual || typeof actual !== 'object') return false;
  if (!close(expected.center.x, actual.center?.x) || !close(expected.center.z, actual.center?.z)) return false;
  if (expected.radius !== undefined) return actual.size === undefined && close(expected.radius, actual.radius);
  return actual.radius === undefined
    && close(expected.size.x, actual.size?.x) && close(expected.size.z, actual.size?.z)
    && close(expected.rotationY || 0, actual.rotationY || 0);
}

// Parts form a set: Unity lists colliders in hierarchy order, the scene file in
// document order, and the server does not care about either.
function sameSet(expected, actual, same) {
  if (expected.length !== actual.length) return false;
  const used = new Set();
  return expected.every(item => {
    const index = actual.findIndex((candidate, at) => !used.has(at) && same(item, candidate));
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

// The server's blocker against the scene's shape, both in world space: what finally
// has to be equal, whatever the row's position, yaw and scale did in between.
function sameWorldShape(shape, blocker) {
  const within = 0.02;
  if (Math.hypot(shape.x - blocker.x, shape.z - blocker.z) > within) return false;
  if (shape.radius !== undefined) return blocker.round === true && Math.abs(blocker.halfX - shape.radius) <= within;
  if (blocker.round) return false;
  const turned = Math.abs(Math.sin(shape.yaw + blocker.rotationY));
  const swapped = Math.abs(Math.cos(shape.yaw + blocker.rotationY));
  const sizes = (halfX, halfZ) => Math.abs(halfX * 2 - shape.sizeX) <= within && Math.abs(halfZ * 2 - shape.sizeZ) <= within;
  return (turned <= 0.003 && sizes(blocker.halfX, blocker.halfZ)) || (swapped <= 0.003 && sizes(blocker.halfZ, blocker.halfX));
}

const failures = {
  unexported: [], unmarked: [], collision: [], flag: [], tags: [], parts: [], strayParts: [], footprint: [], rebuilt: [],
  ground: []
};
let scenes = 0;
let pairs = 0;
let blocking = 0;
let partCount = 0;

for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
  const definition = JSON.parse(fs.readFileSync(path.join(locationsDir, file), 'utf8'));
  const scenePath = locationScenePath(definition, ROOT);
  if (!scenePath) continue;
  assert(fs.existsSync(scenePath), `${file}: Unity scene ${definition.unityScene} is missing`);
  const markers = readPlacedObjectMarkers(scenePath);
  assert(markers.size > 0, `${file}: ${definition.unityScene} has no placed-object markers`);
  const colliders = readMarkerColliders(scenePath);
  assert(!(colliders.get('') || []).length,
    `${file}: ${(colliders.get('') || []).length} solid colliders belong to no placed-object marker; the server has no row for them`);
  scenes += 1;

  const rows = new Map((Array.isArray(definition.objects) ? definition.objects : [])
    .filter(row => row && row.id)
    .map(row => [String(row.id), row]));
  for (const [id, row] of rows)
    if (!isLiveRow(row) && !markers.has(id)) failures.unmarked.push(`${file}: ${id} (${row.model || row.role || 'no model'})`);

  // The floor is a marker of its own, and a body that walks off its edge falls out
  // of the world: a camp's 76 m ground under a 160 m city dropped the player at the
  // gate. The map is the walkable rectangle, so the floor has to cover all of it.
  const floor = [...markers.values()].filter(marker => marker.role === 'terrain')
    .flatMap(marker => colliders.get(marker.id) || [])
    .flatMap(shape => shape.corners || []);
  const mapWidth = Number(definition.map?.width) || 0;
  const mapDepth = Number(definition.map?.depth) || 0;
  if (mapWidth > 0 && mapDepth > 0) {
    if (!floor.length) failures.ground.push(`${file}: the terrain marker carries no floor collider`);
    else {
      const reach = (index, sign) => sign * Math.max(...floor.map(corner => sign * corner[index]));
      const covered = reach(0, -1) <= -mapWidth / 2 + 0.5 && reach(0, 1) >= mapWidth / 2 - 0.5
        && reach(2, -1) <= -mapDepth / 2 + 0.5 && reach(2, 1) >= mapDepth / 2 - 0.5;
      if (!covered)
        failures.ground.push(`${file}: map ${mapWidth}x${mapDepth} m, floor `
          + `x ${reach(0, -1).toFixed(1)}..${reach(0, 1).toFixed(1)}, z ${reach(2, -1).toFixed(1)}..${reach(2, 1).toFixed(1)}`);
    }
  }

  for (const marker of markers.values()) {
    // The exporter skips terrain markers: the ground has no server row.
    if (marker.role === 'terrain') continue;
    const row = rows.get(marker.id);
    if (!row) {
      failures.unexported.push(`${file}: ${marker.id}`);
      continue;
    }
    pairs += 1;
    const where = `${file}: ${marker.id} (${row.model || marker.archetype})`;
    const dataBlocks = collisionBlocksMovement(row.collision);
    if (dataBlocks !== marker.blocksMovement) {
      failures.collision.push(`${where} collision "${row.collision}" vs marker _blocksMovement ${marker.blocksMovement ? 1 : 0}`);
      continue;
    }
    if (JSON.stringify(row.tags || []) !== JSON.stringify(marker.tags))
      failures.tags.push(`${where} data ${JSON.stringify(row.tags || [])} vs marker ${JSON.stringify(marker.tags)}`);

    const solid = colliders.get(marker.id) || [];
    const shapes = solid.flatMap(colliderShapes)
      .filter(shape => (shape.radius !== undefined ? shape.radius * 2 : Math.min(shape.sizeX, shape.sizeZ)) >= MIN_PART_SIZE);
    if (marker.blocksMovement !== shapes.length > 0) {
      failures.flag.push(`${where} marker _blocksMovement ${marker.blocksMovement ? 1 : 0} but the scene has `
        + `${shapes.length ? shapes.length + ' collider shapes' : 'no collider'} at body height`);
      continue;
    }

    const footprint = colliderFootprint(solid);
    if (footprint && !(close(footprint.x, row.footprint?.x) && close(footprint.z, row.footprint?.z)))
      failures.footprint.push(`${where} data ${JSON.stringify(row.footprint)} vs scene ${JSON.stringify(footprint)}`);

    if (!marker.blocksMovement) {
      if (row.collisionParts !== undefined) failures.strayParts.push(where);
      continue;
    }
    blocking += 1;
    const expected = walkCollisionParts(solid, row);
    const actual = Array.isArray(row.collisionParts) ? row.collisionParts : [];
    partCount += actual.length;
    if (!sameSet(expected, actual, samePart)) {
      failures.parts.push(`${where} data has ${actual.length} parts, the scene gives ${expected.length}: `
        + `${JSON.stringify(expected.find(part => !actual.some(candidate => samePart(part, candidate))) || null)} is missing`);
      continue;
    }
    const blockers = locationObjectBlockers(row);
    if (!sameSet(shapes, blockers, sameWorldShape))
      failures.rebuilt.push(`${where} the server builds ${blockers.length} blockers that do not match the scene's ${shapes.length} shapes`);
  }
}

assert(scenes > 0 && pairs > 0, 'no Kromka location row was paired with a Unity scene marker');
assert.deepStrictEqual(failures.unexported, [],
  'Unity scene markers without a data/locations row (the scene was never exported)');
assert.deepStrictEqual(failures.unmarked, [],
  'static data/locations rows without a Unity scene object: invisible on the client, and a row the export does not own '
  + '(Unity menu: Кромка/Авторинг/Дополнить сцены маркерами строк data)');
assert.deepStrictEqual(failures.collision, [],
  'data/locations collision disagrees with the Unity marker; a scene export would silently flip it');
assert.deepStrictEqual(failures.flag, [],
  'a marker\'s movement flag disagrees with the scene colliders a walking body can touch');
assert.deepStrictEqual(failures.tags, [],
  'data/locations tags disagree with the Unity marker; a scene export would silently replace them');
assert.deepStrictEqual(failures.strayParts, [], 'rows that do not block movement carry collisionParts');
assert.deepStrictEqual(failures.parts, [],
  'data/locations collisionParts disagree with the scene colliders: the server and the client block different ground');
assert.deepStrictEqual(failures.footprint, [],
  'data/locations footprint disagrees with the extent of the scene colliders; a scene export would rewrite it');
assert.deepStrictEqual(failures.rebuilt, [],
  'the server does not rebuild the scene\'s collider shapes from collisionParts');
assert.deepStrictEqual(failures.ground, [],
  'the scene floor does not cover the location map: a player walking there falls through the world');

console.log(`Kromka scene parity OK: ${pairs} rows in ${scenes} Unity scenes match their markers in row set, collision and tags; `
  + `${blocking} block movement with ${partCount} collision parts the server rebuilds exactly.`);
