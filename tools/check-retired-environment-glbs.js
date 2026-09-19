'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  isRetiredEnvironmentModel
} = require('../src/server/retired-environment-models');

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MODELS_LITE_DIR = path.join(ROOT, 'public', 'assets', 'models-lite', 'wasteland');
const PREFABS_DIR = path.join(ROOT, 'unity-client', 'Assets', 'Prefabs', 'Models', 'wasteland');
const ACTOR_FILE = /^(?:brahmin|trader_npc|npc_[a-z0-9_]+)\.glb$/i;
const WASTELAND_GLB_URL = /\/assets\/models\/wasteland\/([^"'`?#/]+\.glb)/gi;

function environmentGlbUrls(source) {
  return Array.from(source.matchAll(WASTELAND_GLB_URL))
    .map(match => match[1])
    .filter(file => !ACTOR_FILE.test(file));
}

const shippedGlbs = fs.readdirSync(MODELS_DIR)
  .filter(file => file.toLowerCase().endsWith('.glb'))
  .sort();
assert(shippedGlbs.length > 0, 'Actor GLB library is unexpectedly empty');
assert.deepStrictEqual(
  shippedGlbs.filter(file => !ACTOR_FILE.test(file)),
  [],
  'Retired browser environment GLBs are still shipped'
);
if (fs.existsSync(MODELS_LITE_DIR)) {
  const liteEnvironmentGlbs = fs.readdirSync(MODELS_LITE_DIR)
    .filter(file => file.toLowerCase().endsWith('.glb'))
    .filter(file => !ACTOR_FILE.test(file));
  assert.deepStrictEqual(liteEnvironmentGlbs, [],
    'Generated models-lite tree still ships retired browser environment GLBs');
}

const retiredMeta = fs.readdirSync(MODELS_DIR)
  .filter(file => file.toLowerCase().endsWith('.glb.meta'))
  .map(file => file.slice(0, -5))
  .filter(file => !ACTOR_FILE.test(file));
assert.deepStrictEqual(retiredMeta, [], 'Retired environment GLB Unity metadata is still shipped');
assert(!fs.existsSync(path.join(MODELS_DIR, 'priority-environment-manifest.json')),
  'Retired priority environment manifest is still shipped');
assert(!fs.existsSync(path.join(MODELS_DIR, 'priority-environment-manifest.json.meta')),
  'Retired priority environment manifest metadata is still shipped');

const retiredPrefabs = fs.readdirSync(PREFABS_DIR)
  .filter(file => file.toLowerCase().endsWith('.prefab'))
  .map(file => file.replace(/\.prefab$/i, '.glb'))
  .filter(file => !ACTOR_FILE.test(file));
assert.deepStrictEqual(retiredPrefabs, [],
  'Unity still contains prefab wrappers for retired environment GLBs');

const colliderCatalog = JSON.parse(fs.readFileSync(
  path.join(MODELS_DIR, 'model-colliders.json'), 'utf8'
));
assert.strictEqual(colliderCatalog.schema, 'realm.model-colliders.v1');
assert.deepStrictEqual(Object.keys(colliderCatalog.models).sort(), shippedGlbs,
  'Collider catalog must contain only the remaining actor GLBs');

const locationsDir = path.join(ROOT, 'data', 'locations');
const locationLeaks = [];
const collisionLeaks = [];
for (const file of fs.readdirSync(locationsDir).filter(name => name.endsWith('.json')).sort()) {
  const source = fs.readFileSync(path.join(locationsDir, file), 'utf8');
  for (const model of environmentGlbUrls(source)) locationLeaks.push(`${file}: ${model}`);
  const definition = JSON.parse(source);
  for (const object of Array.isArray(definition.objects) ? definition.objects : []) {
    if (!isRetiredEnvironmentModel(object?.model)) continue;
    const collision = String(object.collision || '').toLowerCase();
    const hasGeneratedParts = Array.isArray(object.collisionParts) && object.collisionParts.length > 0;
    if ((collision && collision !== 'none') || hasGeneratedParts || object.collisionSize || object.modelCollision) {
      collisionLeaks.push(`${file}: ${object.id || object.model}`);
    }
  }
}
assert.deepStrictEqual(locationLeaks, [],
  'Location definitions still reference retired browser environment GLBs');
assert.deepStrictEqual(collisionLeaks, [],
  'Location definitions still contain collision derived from retired environment GLBs');

const runtimeFiles = [
  'server.js',
  'unity-client/Assets/Scripts/World/RoaLocationLoader.cs',
  'unity-client/Assets/Scripts/Game/RoaInteraction.cs'
];
const runtimeLeaks = [];
for (const relative of runtimeFiles) {
  const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  for (const model of environmentGlbUrls(source)) runtimeLeaks.push(`${relative}: ${model}`);
}
assert.deepStrictEqual(runtimeLeaks, [],
  'Runtime code still requests retired environment GLBs');
const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const unityLoaderSource = fs.readFileSync(path.join(
  ROOT, 'unity-client/Assets/Scripts/World/RoaLocationLoader.cs'), 'utf8');
const unityFogSource = fs.readFileSync(path.join(
  ROOT, 'unity-client/Assets/Scripts/Game/RoaFogOfWar.cs'), 'utf8');
assert(!serverSource.includes('modelColliderCatalogEntry(SERVER_MODEL_COLLIDERS'),
  'Server location blockers still derive geometry from the GLB collider catalog');
assert(!unityLoaderSource.includes('/assets/models/wasteland/model-colliders.json')
  && !unityLoaderSource.includes('AddCatalogColliders(')
  && !unityLoaderSource.includes('CollectCollisionBoxes(')
  && !unityFogSource.includes('RoaWorldCollisionBox'),
  'Unity location loading still creates collision from the GLB collider catalog');

const scripts = require(path.join(ROOT, 'package.json')).scripts || {};
assert(!scripts['build:stations'], 'Retired station GLB build command is still active');
assert(!scripts['build:priority-environment'], 'Retired environment GLB build command is still active');
assert(!scripts['check:priority-environment'], 'Retired environment GLB verification is still active');

console.log(`Environment GLB retirement OK: ${shippedGlbs.length} actor GLBs remain; retired location URLs and collisions are empty`);
