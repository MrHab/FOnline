#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  loadModelColliderCatalog,
  modelColliderBounds,
  modelColliderCatalogEntry,
  modelColliderParts,
  modelColliderRadius,
  transformedBounds,
  transformedModelBlocker,
  transformedModelBlockers
} = require('../src/server/model-colliders');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const clientLoader = fs.readFileSync(path.join(ROOT, 'public/js/game.js'), 'utf8');
const clientCollision = fs.readFileSync(path.join(ROOT, 'public/js/game/02c_map_locations_collision.js'), 'utf8');
const clientModels = fs.readFileSync(path.join(ROOT, 'public/js/game/02a_materials_static_models.js'), 'utf8');
const clientProps = fs.readFileSync(path.join(ROOT, 'public/js/game/02d_trader_spawn_props.js'), 'utf8');
const clientContainers = fs.readFileSync(path.join(ROOT, 'public/js/game/05d_world_containers_security.js'), 'utf8');
const clientGroundItems = fs.readFileSync(path.join(ROOT, 'public/js/game/05e_ground_items_world_sync.js'), 'utf8');
const clientMovement = fs.readFileSync(path.join(ROOT, 'public/js/game/09_update_fog_movement_ai.js'), 'utf8');
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
assert(clientLoader.includes('MODEL_COLLIDER_CATALOG_URL'), 'client does not load the shared collider catalog');
assert(server.includes('loadModelColliderCatalog(MODEL_COLLIDERS_FILE)'), 'server does not load the shared collider catalog');

const urlPattern = /([a-zA-Z0-9_]+):\s*['"]([^'"]+\.glb)['"]/g;
const modelFilesByKey = new Map();
for (const match of clientModels.matchAll(urlPattern)) {
  const file = match[2].replace(/\\/g, '/').split('/').pop().toLowerCase();
  modelFilesByKey.set(match[1], file);
  assert(catalog[file], `static model has no generated collider: ${file}`);
}

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

const storageBounds = catalog['storage_chest.glb'];
assert(storageBounds, 'storage chest bounds are missing');
assert.strictEqual(storageBounds.size.x, 2.5);
assert.strictEqual(storageBounds.size.z, 1.34);
const storageCollision = modelColliderBounds(catalog, 'storage_chest.glb');
assert(storageCollision && storageCollision.size.x < storageBounds.size.x && storageCollision.size.z < storageBounds.size.z,
  'storage collision still includes non-body visual decoration');
const storage = transformedModelBlocker(catalog, 'storage_chest.glb', {
  x: 4,
  z: -3,
  rotationY: Math.PI / 2,
  scaleX: 1,
  scaleZ: 1
});
assert(storage, 'storage model did not produce a collider');
assert(Math.abs(storage.halfX - storageCollision.size.x * 0.5) < 1e-9 && Math.abs(storage.halfZ - storageCollision.size.z * 0.5) < 1e-9,
  'storage collider does not use its physical GLB projection');

const rubble = transformedModelBlocker(catalog, 'rubble_rock.glb', {
  x: 10,
  z: 20,
  rotationY: Math.PI / 2,
  scaleX: 2,
  scaleZ: 0.5
});
assert(rubble, 'offset model did not produce a collider');
const rubbleBounds = modelColliderBounds(catalog, 'rubble_rock.glb');
const expectedX = 10 + Number(rubbleBounds.center.z) * 0.5;
const expectedZ = 20 - Number(rubbleBounds.center.x) * 2;
assert(Math.abs(rubble.x - expectedX) < 1e-9 && Math.abs(rubble.z - expectedZ) < 1e-9,
  'model origin offset is not rotated and scaled with the visual');
assert(Math.abs(rubble.rotationY + Math.PI / 2) < 1e-9,
  'model collider yaw does not match the THREE visual yaw convention');

const clientTransformRuntime = new Function([
  functionSource(clientModels, 'staticBoundsCollisionTransform'),
  'return staticBoundsCollisionTransform;'
].join('\n'))();
const clientRubble = clientTransformRuntime(rubbleBounds, 10, 20, Math.PI / 2, {
  scaleX: 2,
  scaleZ: 0.5
});
assert(clientRubble && Math.abs(clientRubble.x - rubble.x) < 1e-9
  && Math.abs(clientRubble.z - rubble.z) < 1e-9
  && Math.abs(clientRubble.rotationY - rubble.rotationY) < 1e-9,
'client and server disagree about the transformed GLB collider yaw');

const scorpionRadius = modelColliderRadius(catalog, 'npc_radscorpion.glb', 1.05);
const scorpionBounds = modelColliderBounds(catalog, 'npc_radscorpion.glb');
const expectedScorpionRadius = Math.max(
  Math.abs(scorpionBounds.min.x), Math.abs(scorpionBounds.max.x),
  Math.abs(scorpionBounds.min.z), Math.abs(scorpionBounds.max.z)
) * 1.05;
assert(Math.abs(scorpionRadius - expectedScorpionRadius) < 1e-9,
  'NPC collider radius does not follow the model footprint');

assert.strictEqual(modelColliderParts(catalog, 'open_scrap_gate.glb').length, 4,
  'open gate must use separate collision parts instead of blocking its opening');
const gateParts = transformedModelBlockers(catalog, 'open_scrap_gate.glb');
assert(!gateParts.some(part => {
  const nearestX = Math.max(-part.halfX, Math.min(part.halfX, -part.x));
  const nearestZ = Math.max(-part.halfZ, Math.min(part.halfZ, -part.z));
  return Math.hypot(-part.x - nearestX, -part.z - nearestZ) <= 0.3;
}), 'open gate center is still blocked by a union collider');
assert(modelColliderParts(catalog, 'brahmin_pen.glb').length >= 4,
  'pen perimeter must not collapse into one filled collision box');
assert(modelColliderCatalogEntry(catalog, 'asphalt_slab.glb')?.collision?.mode === 'none',
  'walkable asphalt is incorrectly physical');
assert.strictEqual(transformedModelBlockers(catalog, 'asphalt_slab.glb').length, 0,
  'non-blocking surface produced a movement blocker');

const clientAddBox = functionBody(clientCollision, 'addStaticCollisionBox');
assert(clientAddBox.includes('rotationY') && clientAddBox.includes('broadHalfX'),
  'client static collision is not a rotated model-aligned box');
assert(functionBody(clientCollision, 'staticCollisionBoxPenaltyAt').includes('localX'),
  'client collision still tests only an axis-aligned bounding box');
assert(functionBody(clientCollision, 'staticCollisionRayHitDistance').includes('localDx'),
  'client line collision ignores model rotation');
const authoredMapMarking = functionBody(clientCollision, 'markAuthoredLocationObjectOnClientMap');
assert(authoredMapMarking.includes('staticModelCollisionTransforms')
  && authoredMapMarking.includes('authoredTileIntersectsStaticCollisionBox'),
  'client authored movement/vision tiles do not follow multipart rotated GLB colliders');
assert(authoredMapMarking.includes('authoredObjectCollisionSize(row)'),
  'client authored tile marking lost the footprint fallback for models without collider parts');
const exactVisionBranch = authoredMapMarking.slice(authoredMapMarking.indexOf('if (collisionBoxes.length)'));
assert(exactVisionBranch.includes('authoredExactVisionBoxes.push')
  && !exactVisionBranch.includes("markAuthoredTileLayer(tx, tz, 'vision-block')"),
  'multipart GLB vision must keep sub-tile doorways instead of filling touched tiles');
assert(functionBody(clientCollision, 'isAuthoredExactVisionBlockingWorldLine').includes('authoredExactVisionBoxes'),
  'client authored vision has no exact multipart OBB line test');
assert(functionBody(clientMovement, 'markVisibilityRay').includes('isAuthoredExactVisionBlockingWorldLine'),
  'RTS fog rays ignore exact authored GLB vision blockers');
assert(functionBody(clientMovement, 'markVisibilityRay').includes('visibilityTileWorldPoint'),
  'RTS fog rays lose the player sub-tile offset and can seal narrow GLB doorways');
assert(functionBody(clientMovement, 'isCrouchedTargetHiddenByLowCover').includes('isAuthoredExactLowCoverHidingCrouchedTargetWorldLine'),
  'crouched targets are not hidden by exact authored GLB low cover');
assert(functionBody(clientMovement, 'updateEntityRtsFogVisibility').includes('targetSubTileX')
  && functionBody(clientMovement, 'updateEntityRtsFogVisibility').includes('targetSubTileZ'),
  'entity visibility cache ignores target sub-tile movement around exact GLB cover');
assert(functionBody(clientMovement, 'updateOccludedEntityVisibility').includes('subTileX')
  && functionBody(clientMovement, 'updateOccludedEntityVisibility').includes('subTileZ'),
  'fog state cache ignores player sub-tile movement through narrow GLB doorways');
const visibilityUpdateBody = functionBody(clientMovement, 'updateOccludedEntityVisibility');
assert(visibilityUpdateBody.includes('fogStateChanged && visibilityRefreshTimer <= 0')
  && !visibilityUpdateBody.includes('fogStateChanged || visibilityRefreshTimer <= 0'),
  'sub-tile player movement bypasses the fog refresh budget');
assert(visibilityUpdateBody.includes('visibilitySafetyRefreshTimer <= 0')
  && visibilityUpdateBody.includes('visibilitySafetyRefreshTimer = 2.40'),
  'idle fog safety refresh is not independent from the sub-tile movement cooldown');
assert(visibilityUpdateBody.includes('rtsFogObserverEpoch++')
  && functionBody(clientMovement, 'updateEntityRtsFogVisibility').includes('rtsFogObserverEpoch'),
  'observer sub-tile movement does not invalidate exact entity LOS caches');
const settlementLocation = JSON.parse(fs.readFileSync(path.join(locationsDir, 'settlement.json'), 'utf8'));
const tradeHall = settlementLocation.objects.find(row => row?.id === 'old_klim_trade_hall');
assert(tradeHall && Array.isArray(tradeHall.collisionParts) && tradeHall.collisionParts.length === 5,
  'MEP trade hall must preserve its doorway with five authored collision parts');
const hallVisionBoxes = tradeHall.collisionParts.map(part => transformedBounds(part, {
  x: Number(tradeHall.position.x),
  z: Number(tradeHall.position.z),
  rotationY: Number(tradeHall.rotation.y),
  scaleX: 1,
  scaleZ: 1
})).filter(Boolean).map(box => ({ ...box, kind: 'block' }));
const exactVisionRuntime = new Function('boxes', [
  'const TILE = 2;',
  'const authoredExactVisionBoxes = boxes;',
  functionSource(clientCollision, 'authoredExactVisionBoxHitInterval'),
  functionSource(clientCollision, 'isAuthoredExactVisionBlockingWorldLine'),
  functionSource(clientCollision, 'isAuthoredExactLowCoverHidingCrouchedTargetWorldLine'),
  'return { isAuthoredExactVisionBlockingWorldLine, isAuthoredExactLowCoverHidingCrouchedTargetWorldLine };'
].join('\n'))(hallVisionBoxes);
const hallX = Number(tradeHall.position.x);
const hallZ = Number(tradeHall.position.z);
assert.strictEqual(exactVisionRuntime.isAuthoredExactVisionBlockingWorldLine(
  hallX + 3, hallZ, hallX + 0.8, hallZ, false), false,
  'MEP trade hall doorway is sealed along the real player-offset fog ray');
assert.strictEqual(exactVisionRuntime.isAuthoredExactVisionBlockingWorldLine(
  hallX + 3, hallZ + 3, hallX + 0.8, hallZ + 3, false), true,
  'MEP trade hall wall no longer blocks the adjacent fog ray');
function settlementCollisionBoxes(...ids) {
  return ids.flatMap(id => {
    const entry = settlementLocation.objects.find(row => row?.id === id);
    assert(entry && Array.isArray(entry.collisionParts), 'Missing settlement collision object: ' + id);
    return entry.collisionParts.map(part => transformedBounds(part, {
      x: Number(entry.position.x),
      z: Number(entry.position.z),
      rotationY: Number(entry.rotation.y),
      scaleX: 1,
      scaleZ: 1
    })).filter(Boolean).map(box => ({ ...box, kind: 'block' }));
  });
}
const settlementBarrierRuntime = new Function('boxes', [
  'const TILE = 2;',
  'const authoredExactVisionBoxes = boxes;',
  functionSource(clientCollision, 'authoredExactVisionBoxHitInterval'),
  functionSource(clientCollision, 'isAuthoredExactVisionBlockingWorldLine'),
  'return isAuthoredExactVisionBlockingWorldLine;'
].join('\n'))(settlementCollisionBoxes(
  'old_klim_defensive_perimeter', 'old_klim_main_gate', 'old_klim_loading_gate'));
assert.strictEqual(settlementBarrierRuntime(0, -27, 0, -20, false), false,
  'Main settlement gate no longer has a clear central passage');
assert.strictEqual(settlementBarrierRuntime(4.1, -27, 4.1, -20, false), true,
  'Main gate post no longer protects the settlement entrance');
assert.strictEqual(settlementBarrierRuntime(22, 7, 28, 7, false), false,
  'Service gate no longer has a clear central caravan passage');
assert.strictEqual(settlementBarrierRuntime(22, 4.65, 28, 4.65, false), true,
  'Service gate post no longer protects the loading-yard entrance');
const penRuntime = new Function('boxes', [
  'const TILE = 2;',
  'const authoredExactVisionBoxes = boxes;',
  functionSource(clientCollision, 'authoredExactVisionBoxHitInterval'),
  functionSource(clientCollision, 'isAuthoredExactVisionBlockingWorldLine'),
  'return isAuthoredExactVisionBlockingWorldLine;'
].join('\n'))(settlementCollisionBoxes('old_klim_brahmin_pens'));
assert.strictEqual(penRuntime(13, -14, 13, -10, false), false,
  'Left brahmin pen no longer has a clear entrance');
assert.strictEqual(penRuntime(20, -14, 20, -10, false), false,
  'Right brahmin pen no longer has a clear entrance');
assert.strictEqual(penRuntime(11.1, -14, 11.1, -10, false), true,
  'Brahmin pen fence no longer blocks beside its entrance');
const exactCoverRuntime = new Function('boxes', [
  'const TILE = 2;',
  'const authoredExactVisionBoxes = boxes;',
  functionSource(clientCollision, 'authoredExactVisionBoxHitInterval'),
  functionSource(clientCollision, 'isAuthoredExactVisionBlockingWorldLine'),
  functionSource(clientCollision, 'isAuthoredExactLowCoverHidingCrouchedTargetWorldLine'),
  'return { isAuthoredExactVisionBlockingWorldLine, isAuthoredExactLowCoverHidingCrouchedTargetWorldLine };'
].join('\n'))([{ kind: 'cover', x: 0, z: 0, halfX: 1, halfZ: 0.2, rotationY: 0 }]);
assert.strictEqual(exactCoverRuntime.isAuthoredExactVisionBlockingWorldLine(0, -3, 0, 1, false), false,
  'low cover incorrectly blocks a standing observer');
assert.strictEqual(exactCoverRuntime.isAuthoredExactVisionBlockingWorldLine(0, -3, 0, 1, true), true,
  'low cover does not block a crouching observer');
assert.strictEqual(exactCoverRuntime.isAuthoredExactLowCoverHidingCrouchedTargetWorldLine(0, -3, 0, 1, true), true,
  'exact low cover does not hide a crouched target directly behind it');
assert.strictEqual(exactCoverRuntime.isAuthoredExactLowCoverHidingCrouchedTargetWorldLine(0, -3, 0, 5, true), false,
  'exact low cover hides crouched targets that are not directly behind it');
const authoredTileSatRuntime = new Function([
  'const TILE = 2;',
  'function inBounds() { return true; }',
  'function tileToWorld(tx, tz) { return { x: tx * TILE, z: tz * TILE }; }',
  functionSource(clientCollision, 'authoredTileIntersectsStaticCollisionBox'),
  'return authoredTileIntersectsStaticCollisionBox;'
].join('\n'))();
const diagonalWall = { x: 0, z: 0, halfX: 3, halfZ: 0.15, rotationY: Math.PI / 4 };
assert.strictEqual(authoredTileSatRuntime(1, 1, diagonalWall), true,
  'rotation-aware authored tile SAT missed a tile crossed by a diagonal wall');
assert.strictEqual(authoredTileSatRuntime(1, -1, diagonalWall), false,
  'rotation-aware authored tile SAT collapsed a diagonal wall to its broad AABB');
assert(functionBody(clientModels, 'createStaticObstacleModel').includes('addStaticModelCollision'),
  'procedural GLB obstacles do not register generated bounds');
assert(functionBody(clientModels, 'addAuthoredObjectCollision').includes('addStaticModelCollision'),
  'authored objects do not use generated model bounds');
assert(functionBody(server, 'roomStaticCollisionBlockersFromObject').includes('transformedModelBlockers'),
  'server authored objects do not use generated model bounds');
assert(functionBody(server, 'roomStaticCollisionBlockersFromObject').includes('row.collisionSize'),
  'server authored objects do not support explicit collision fallbacks');
assert(functionBody(clientModels, 'addAuthoredObjectCollision').includes('row.collisionSize'),
  'client authored objects do not support explicit collision fallbacks');
assert(functionBody(server, 'roomStaticCollisionBlockersFromObject').includes('rotationY: -rotationY'),
  'server authored fallback collider does not convert THREE visual yaw');
assert(functionBody(clientModels, 'addAuthoredObjectCollision').includes("'authored-object', -angle"),
  'client authored fallback collider does not convert THREE visual yaw');
assert(functionBody(server, 'roomProceduralModelSpec').includes('serverModelHash01'),
  'server procedural model selection is not synchronized with the client');

const clientMovementPolicy = functionBody(clientModels, 'authoredObjectBlocksMovement');
const serverMovementPolicy = functionBody(server, 'locationObjectBlocksMovement');
assert(clientMovementPolicy.includes('authoredObjectAllowsPlayerOverlap') && !clientMovementPolicy.includes("'cover'"),
  'client still turns pass-through items or low cover into movement blockers');
assert(serverMovementPolicy.includes('locationObjectAllowsPlayerOverlap') && !serverMovementPolicy.includes("'cover'"),
  'server still turns pass-through items or low cover into movement blockers');
assert(functionBody(clientModels, 'authoredObjectAllowsPlayerOverlap').includes('craftingstation'),
  'client pass-through policy does not cover interactive stations');
assert(functionBody(server, 'locationObjectAllowsPlayerOverlap').includes('craftingstation'),
  'server pass-through policy does not cover interactive stations');
assert(!functionBody(server, 'roomStaticCollisionBlockersFromObject').includes('!locationObjectResourceType'),
  'server still forces every resource-tagged prop into collision regardless of movement policy');

const clientPolicyRuntime = new Function([
  functionSource(clientModels, 'authoredObjectTags'),
  functionSource(clientModels, 'authoredObjectOcclusionRole'),
  functionSource(clientModels, 'authoredObjectAllowsPlayerOverlap'),
  functionSource(clientModels, 'authoredObjectBlocksMovement'),
  'return authoredObjectBlocksMovement;'
].join('\n'))();
const serverPolicyRuntime = new Function([
  'function locationDefinitionObjectIsNpc() { return false; }',
  functionSource(server, 'locationObjectTags'),
  functionSource(server, 'locationObjectOcclusionRole'),
  functionSource(server, 'locationObjectAllowsPlayerOverlap'),
  functionSource(server, 'locationObjectBlocksMovement'),
  'return locationObjectBlocksMovement;'
].join('\n'))();
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
  assert.strictEqual(clientPolicyRuntime(row), expected, `client movement policy is wrong for ${label}`);
  assert.strictEqual(serverPolicyRuntime(row), expected, `server movement policy is wrong for ${label}`);
}

assert(functionBody(clientCollision, 'isWalkableWorld').includes('isWorldTerrainWalkable('),
  'client movement is still blocked by the entire model tile');
assert(functionBody(server, 'isRoomWalkableWorld').includes('isRoomTerrainWalkableWorld('),
  'server movement is still blocked by the entire model tile');
assert(!functionBody(server, 'markAuthoredObjectTiles').includes('room.map'),
  'server authored models still create full-tile collision');
assert(!functionBody(clientProps, 'createStorageChest').includes('collisionSize'),
  'storage still has a hand-authored collider');
assert(!functionBody(clientProps, 'createStorageChest').includes('addStaticModelCollision'),
  'interactive storage still repels the player');
assert(!functionBody(clientCollision, 'createCrate').includes('addStaticModelCollision'),
  'decorative trader crates still repel the player');
assert(!functionBody(clientMovement, 'collectPlayerDynamicObstaclesForFrame').includes('storageBox'),
  'storage still has a second dynamic collider');
assert(!functionBody(clientMovement, 'collectPlayerDynamicObstaclesForFrame').includes('worldContainers'),
  'loot containers still repel the player through dynamic collision');
assert(functionBody(clientContainers, 'createWorldContainerMesh').includes('allowsPlayerOverlap'),
  'loot containers are not explicitly marked as pass-through');
assert(!functionBody(server, 'roomStaticCollisionObjects').includes('room.containers'),
  'server still creates movement blockers for loot containers');
assert(!server.includes('function roomStaticCollisionBlockerFromContainer'),
  'obsolete server container collider can be reintroduced accidentally');
assert(!server.includes('function roomStaticCollisionBlockersFromTraderCrates'),
  'server still contains invisible trader-crate blockers');
assert(!functionBody(clientGroundItems, 'createGroundItemMesh').includes('addStaticCollision'),
  'ground loot unexpectedly registers static collision');
assert(!functionBody(clientGroundItems, 'upsertGroundItem').includes('obstacleMeshes'),
  'ground loot unexpectedly registers as an obstacle');
assert(functionBody(clientProps, 'createTraderNpc').includes('addStaticModelCollision'),
  'static trader does not use its GLB collider');
assert(functionBody(clientCollision, 'removeStaticCollisionBox').includes('staticCollisionBoxes.splice'),
  'removed resource models leave their colliders behind');
assert(functionBody(clientCollision, 'removeStaticCollisionBox').includes('Array.isArray'),
  'compound model colliders cannot be removed');
assert(functionBody(clientCollision, 'staticCollisionPenaltyAt').includes('staticCollisionBoxPenaltyAt'),
  'client cannot measure penetration to let a player leave intersecting geometry');
assert(functionBody(clientMovement, 'canPlayerEscapeStaticBlockTo').includes('nextStaticPenalty < currentStaticPenalty'),
  'client does not allow smooth movement out of an intersecting model');
assert(!functionBody(clientMovement, 'movePlayerBy').includes('recoverPlayerIfBlocked'),
  'ordinary movement still teleports a blocked player away from a model');
assert(functionBody(clientCollision, 'recoverPlayerIfBlocked').includes('isWorldTerrainWalkable(player.x, player.z)'),
  'recovery can still shove a player out of a late-loaded model collider');
assert(functionBody(server, 'roomStaticCollisionMoveAllowed').includes('nextPenalty < currentPenalty'),
  'server rejects attempts to leave intersecting model geometry');
assert(functionBody(clientMovement, 'collectPlayerDynamicObstaclesForFrame').includes('dynamicActorCollisionBoxes'),
  'client still turns long NPC models into oversized circular blockers');
assert(functionBody(server, 'roomEnemyCollisionPenalty').includes('enemyMovementCollisionBlockers'),
  'server still turns long NPC models into oversized circular blockers');
assert(clientMovement.includes('const PLAYER_DYNAMIC_BLOCK_RADIUS = PLAYER_COLLISION_RADIUS;'),
  'static and dynamic player radii differ');
assert(functionBody(server, 'enemyBodyRadius').includes('modelColliderRadius'),
  'server NPC body sizes do not come from their GLB models');
assert(functionBody(server, 'serverLineOfFireClearFrom').includes('enemyBodyRadius(enemy)'),
  'server line-of-fire checks do not protect the full NPC model collider');
assert(functionBody(server, 'serverShotgunSpreadSample').includes('enemyBodyRadius(enemy)'),
  'server shotgun hit checks do not use the NPC model collider');
assert(functionBody(server, 'serverValidateMultiTargetHit').includes('enemyBodyRadius(enemy)'),
  'server cone hit checks do not use the NPC model collider');

console.log(`Movement collision check passed: ${authoredColliderCount} authored model definitions plus procedural and NPC colliders were audited.`);
