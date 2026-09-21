#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadModelColliderCatalog,
  modelColliderBounds,
  modelColliderRadius,
  transformedBounds,
  transformedModelBlockers
} = require('../src/server/model-colliders');
const { circleBlockerPenalty, createLocationCollision } = require('../src/server/location-collision');
const { segmentIntersectsRotatedBlocker } = require('../src/server/enemy-ai');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const modelsDir = path.join(ROOT, 'public/assets/models/wasteland');
const catalogFile = path.join(modelsDir, 'model-colliders.json');
const catalog = loadModelColliderCatalog(catalogFile);

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')' && --parenDepth === 0) { paramsClose = i; break; }
  }
  const open = source.indexOf('{', paramsClose);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return '';
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return '';
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let i = paramsOpen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')' && --parenDepth === 0) { paramsClose = i; break; }
  }
  const open = source.indexOf('{', paramsClose);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

const modelFiles = fs.readdirSync(modelsDir).filter(file => file.endsWith('.glb')).sort();
const catalogFiles = Object.keys(catalog).sort();
assert.deepStrictEqual(catalogFiles, modelFiles, 'collider catalog does not exactly match the shipped GLB files');
assert(Object.values(catalog).every(entry => ['solid', 'none'].includes(entry?.collision?.mode)),
  'not every GLB has an explicit physical collision mode');
assert(server.includes('loadModelColliderCatalog(MODEL_COLLIDERS_FILE)'), 'server does not load the shared collider catalog');

// Actor model keys (model: 'wastelandSettler') resolve to GLBs through the server map.
const serverModelFileBlock = /const SERVER_MODEL_FILE_BY_KEY = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(server);
assert(serverModelFileBlock, 'server model-key to GLB map is missing');
const urlPattern = /([a-zA-Z0-9_]+):\s*['"]([^'"]+\.glb)['"]/g;
const modelFilesByKey = new Map();
for (const match of serverModelFileBlock[1].matchAll(urlPattern)) {
  const file = match[2].replace(/\\/g, '/').split('/').pop().toLowerCase();
  modelFilesByKey.set(match[1], file);
  assert(catalog[file], `static model has no generated collider: ${file}`);
}
assert(modelFilesByKey.size > 0, 'server model-key to GLB map is empty');

let authoredColliderCount = 0;
const locationsDir = path.join(ROOT, 'data/locations');
for (const fileName of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json'))) {
  const location = JSON.parse(fs.readFileSync(path.join(locationsDir, fileName), 'utf8'));
  for (const row of Array.isArray(location.objects) ? location.objects : []) {
    if (!['solid', 'cover', 'block', 'blocked', 'wall', 'resource'].includes(String(row?.collision || '').toLowerCase())) continue;
    const playerCollision = String(row?.playerCollision ?? row?.movementCollision ?? '').toLowerCase();
    if (row?.playerCollision === false || row?.movementCollision === false
      || ['none', 'false', 'off', 'pass-through', 'passthrough', 'overlap', 'disabled'].includes(playerCollision)) continue;
    const modelFile = String(row.url || row.file || '').replace(/\\/g, '/').split('/').pop().toLowerCase()
      || modelFilesByKey.get(String(row.model || ''));
    const transform = {
      x: Number(row.position?.x || row.x || 0),
      z: Number(row.position?.z || row.z || 0),
      rotationY: Number(row.rotation?.y ?? row.rotationY ?? 0),
      scaleX: Number(row.scale?.x ?? row.scale ?? 1),
      scaleZ: Number(row.scale?.z ?? row.scale ?? 1)
    };
    const authoredParts = (Array.isArray(row.collisionParts) ? row.collisionParts : []).map(part => transformedBounds({
      center: {
        x: Number(part?.center?.x ?? part?.x ?? 0),
        z: Number(part?.center?.z ?? part?.z ?? 0)
      },
      size: {
        x: Number(part?.size?.x ?? part?.width ?? 0),
        z: Number(part?.size?.z ?? part?.depth ?? 0)
      }
    }, transform)).filter(Boolean);
    const exact = row.collisionSize && typeof row.collisionSize === 'object' ? row.collisionSize : {};
    const footprint = row.footprint && typeof row.footprint === 'object' ? row.footprint : {};
    const cells = row.placement?.cells && typeof row.placement.cells === 'object' ? row.placement.cells : {};
    const fallbackWidth = Number(exact.width || exact.x || footprint.x || Number(cells.x || 0) * 2 || 0);
    const fallbackDepth = Number(exact.depth || exact.z || footprint.z || Number(cells.z || 0) * 2 || 0);
    const hasAuthoredFallback = Number.isFinite(fallbackWidth) && fallbackWidth > 0
      && Number.isFinite(fallbackDepth) && fallbackDepth > 0;
    assert(authoredParts.length || (modelFile && catalog[modelFile]) || hasAuthoredFallback,
      `${fileName}/${row.id || row.model}: blocking object has neither authored parts, footprint nor a generated GLB collider`);
    const transformed = authoredParts.length
      ? authoredParts
      : (modelFile && catalog[modelFile] ? transformedModelBlockers(catalog, modelFile, transform) : []);
    assert(transformed.length > 0 || hasAuthoredFallback,
      `${fileName}/${row.id || row.model}: collider transform and authored fallback both failed`);
    authoredColliderCount += 1;
  }
}
assert(authoredColliderCount > 0, 'no authored model colliders were checked');

const scorpionRadius = modelColliderRadius(catalog, 'npc_radscorpion.glb', 1.05);
const scorpionBounds = modelColliderBounds(catalog, 'npc_radscorpion.glb');
const expectedScorpionRadius = Math.max(
  Math.abs(scorpionBounds.min.x), Math.abs(scorpionBounds.max.x),
  Math.abs(scorpionBounds.min.z), Math.abs(scorpionBounds.max.z)
) * 1.05;
assert(Math.abs(scorpionRadius - expectedScorpionRadius) < 1e-9,
  'NPC collider radius does not follow the model footprint');

const settlementLocation = JSON.parse(fs.readFileSync(path.join(locationsDir, 'settlement.json'), 'utf8'));
assert.strictEqual(settlementLocation.worldRevision, 'kromka-1',
  'active settlement collision must come from the Kromka revision');
assert.strictEqual(settlementLocation.runtimeMode, 'unity-authored',
  'active settlement collision must be exported from Unity');
// Стена банка, ориентир площади и лачуга квартала: преграды города, разложенного
// в свою сцену, — их экспорт и пишет в данные.
for (const id of ['bank_w0', 'market_crate_0', 'home_0']) {
  const entry = settlementLocation.objects.find(row => row?.id === id);
  assert(entry && entry.collision === 'solid'
    && Number(entry.footprint?.x) > 0 && Number(entry.footprint?.z) > 0
    && entry.vision?.blocks === true,
  `Kromka settlement blocker lacks Unity-authored footprint/vision: ${id}`);
}
assert(!settlementLocation.objects.some(row => /^oldKlim/.test(String(row?.model || ''))),
  'retired Old Klim collision geometry leaked into active Kromka data');
// The blockers of authored objects are built by src/server/location-collision.js, the
// module the server itself calls, so these are tests of its behaviour.
const collision = createLocationCollision({ tile: 2 });
const serverPolicyRuntime = collision.locationObjectBlocksMovement;
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} instead of ${expected}`);
{
  // A retired GLB key must not bring its old model bounds back: the footprint decides.
  const [byFootprint] = collision.locationObjectBlockers({
    id: 'wall', model: 'concreteWall', url: '/assets/models/wasteland/concrete_wall.glb', collision: 'solid',
    position: { x: 4, z: -6 }, rotation: { y: 0.5 }, footprint: { x: 6, z: 1 }
  });
  near(byFootprint.halfX, 3, 'footprint width rounds to whole tiles');
  near(byFootprint.halfZ, 1, 'footprint depth has a one-tile floor');
  near(byFootprint.rotationY, -0.5, 'authored yaw turns into the server\'s 2D convention');
  const [exact] = collision.locationObjectBlockers({
    id: 'fence', collision: 'wall', position: { x: 0, z: 0 }, collisionSize: { width: 5.5, depth: 0.3 }, footprint: { x: 1, z: 1 }
  });
  near(exact.halfX, 2.75, 'an explicit collisionSize wins over the footprint');
  near(exact.halfZ, 0.2, 'an explicit collisionSize keeps its 0.4 m floor');

  // collisionParts: a yard is walls around open ground, not one box over its footprint.
  const yard = {
    id: 'yard', collision: 'solid', position: { x: 10, z: 20 }, rotation: { y: Math.PI / 2 }, scale: { x: 1, y: 1, z: 1 },
    footprint: { x: 20, z: 20 },
    collisionParts: [
      { center: { x: 0, z: 10 }, size: { x: 20, z: 0.8 } },
      { center: { x: -10, z: 0 }, size: { x: 0.8, z: 20 } },
      { center: { x: 5, z: -10 }, size: { x: 4, z: 0.8 }, rotationY: 0.3 },
      { center: { x: 4, z: 3 }, radius: 1.5 }
    ]
  };
  const parts = collision.locationObjectBlockers(yard);
  assert.strictEqual(parts.length, 4, 'every authored part is a blocker of its own');
  assert(parts.every(part => part.objectId === 'yard'), 'a blocker does not name the object it belongs to');
  // Unity yaw of a quarter turn sends local +Z to world +X.
  near(parts[0].x, 20, 'a part offset is turned by the row yaw'); near(parts[0].z, 20, 'a part offset is turned by the row yaw');
  near(parts[2].rotationY, -(Math.PI / 2 + 0.3), 'a part\'s own yaw adds to the row yaw');
  assert(parts[3].round === true, 'a part with a radius is a disc');
  const free = (x, z) => parts.every(part => circleBlockerPenalty(x, z, 0.48, part) <= 0.001);
  assert(free(10, 20), 'the open ground inside a yard is blocked');
  assert(!free(20, 20), 'a yard wall does not block');
  // The disc sits at world (13, 16): its diagonal is free where a square would not be.
  assert(!free(13 + 1.9, 16), 'a disc does not block along its axis');
  assert(free(13 + 1.45, 16 + 1.45), 'a disc blocks its bounding square\'s corner');
  assert(segmentIntersectsRotatedBlocker(13 - 5, 16, 13 + 5, 16, parts[3], 0.05, {}), 'a shot through a disc passes');
  // This line cuts the corner of the disc's bounding square and misses the disc itself.
  const square = { x: 13, z: 16, halfX: 1.5, halfZ: 1.5, rotationY: 0 };
  assert(segmentIntersectsRotatedBlocker(13.2, 18.5, 15.7, 16, square, 0.05, {}), 'the corner shot misses even a square');
  assert(!segmentIntersectsRotatedBlocker(13.2, 18.5, 15.7, 16, parts[3], 0.05, {}), 'a shot past a disc is stopped by its corner');
  // Physics scales a sphere by its largest axis.
  const [mound] = collision.locationObjectBlockers({
    id: 'mound', collision: 'solid', position: { x: 0, z: 0 }, scale: { x: 8, y: 3, z: 6 }, collisionParts: [{ center: { x: 0, z: 0 }, radius: 0.5 }]
  });
  near(mound.halfX, 4, 'a disc grows with the largest scale axis');
}
const policyCases = [
  [{ collision: 'cover', model: 'cargoStack' }, false, 'low cover'],
  [{ collision: 'solid', model: 'craftStationRepair', interactive: { kind: 'craftingStation' }, tags: ['crafting-station'] }, false, 'crafting station'],
  [{ collision: 'solid', model: 'storageChest', interactive: { kind: 'container' }, tags: ['storage', 'container'] }, false, 'interactive storage'],
  [{ collision: 'solid', model: 'jobBoard', tags: ['interactive', 'jobBoard'] }, false, 'job board'],
  [{ collision: 'solid', model: 'wallMetalBlock', tags: ['wall'] }, true, 'wall'],
  [{ collision: 'resource', model: 'oreOutcrop', tags: ['resource', 'ore'] }, true, 'resource node'],
  [{ collision: 'solid', model: 'cargoStack', playerCollision: false }, false, 'explicit pass-through override']
];
for (const [row, expected, label] of policyCases) {
  assert.strictEqual(serverPolicyRuntime(row), expected, `server movement policy is wrong for ${label}`);
}

assert(functionBody(server, 'isRoomWalkableWorld').includes('isRoomTerrainWalkableWorld('),
  'server movement is still blocked by the entire model tile');
assert(!functionBody(server, 'markAuthoredObjectTiles').includes('room.map'),
  'server authored models still create full-tile collision');
assert(!functionBody(server, 'roomStaticCollisionObjects').includes('room.containers'),
  'server still creates movement blockers for loot containers');
assert(!server.includes('function roomStaticCollisionBlockerFromContainer'),
  'obsolete server container collider can be reintroduced accidentally');
assert(!server.includes('function roomStaticCollisionBlockersFromTraderCrates'),
  'server still contains invisible trader-crate blockers');
assert(functionBody(server, 'roomStaticCollisionMoveAllowed').includes('nextPenalty < currentPenalty'),
  'server rejects attempts to leave intersecting model geometry');
assert(functionBody(server, 'roomEnemyCollisionPenalty').includes('enemyMovementCollisionBlockers'),
  'server still turns long NPC models into oversized circular blockers');
assert(functionBody(server, 'enemyBodyRadius').includes('modelColliderRadius'),
  'server NPC body sizes do not come from their GLB models');
assert(functionBody(server, 'serverLineOfFireClearFrom').includes('enemyBodyRadius(enemy)'),
  'server line-of-fire checks do not protect the full NPC model collider');
assert(functionBody(server, 'serverShotgunSpreadSample').includes('enemyBodyRadius(enemy)'),
  'server shotgun hit checks do not use the NPC model collider');
assert(functionBody(server, 'serverValidateMultiTargetHit').includes('enemyBodyRadius(enemy)'),
  'server cone hit checks do not use the NPC model collider');

console.log(`Movement collision check passed: ${authoredColliderCount} authored definitions plus NPC colliders were audited.`);
