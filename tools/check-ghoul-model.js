'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  APPROVED_REVIEW_SHA256,
  EXPECTED_RUNTIME_SHA256
} = require('./build-ghoul-runtime-model');

const ROOT = path.resolve(__dirname, '..');
const MODEL_FILE = path.join(ROOT, 'public', 'assets', 'models', 'wasteland', 'npc_ghoul.glb');
const COLLIDER_FILE = path.join(ROOT, 'public', 'assets', 'models', 'wasteland', 'model-colliders.json');
const REVIEW_DIRECTORY = path.join(
  ROOT,
  'docs',
  'art',
  'reviews',
  'unified-ghoul-v3',
  'ghoul'
);
const REVIEW_FILE = path.join(REVIEW_DIRECTORY, 'creature_ghoul_unified_v3.glb');
const REVIEW_REPORT_FILE = path.join(REVIEW_DIRECTORY, 'technical-report.json');
const APPROVAL_FILE = path.join(REVIEW_DIRECTORY, 'CRITIC_APPROVAL_V3.md');
const STATIC_RUNTIME_FILE = path.join(ROOT, 'public', 'js', 'game', '02a_materials_static_models.js');
const ENEMY_RUNTIME_FILE = path.join(ROOT, 'public', 'js', 'game', '05f_enemy_models_location_flow.js');
const REQUIRED_ACTIONS = ['attack', 'death', 'hurt', 'idle', 'run', 'walk'];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', 'ghoul asset is not a GLB');
  assert.strictEqual(data.readUInt32LE(4), 2, 'ghoul asset must use glTF 2');
  assert.strictEqual(data.readUInt32LE(8), data.length, 'ghoul GLB length metadata is stale');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    else if (type === 'BIN\0') binary = chunk;
    offset += 8 + length;
  }
  assert(json, 'ghoul GLB has no JSON chunk');
  assert(binary, 'ghoul GLB has no binary chunk');
  return { data, json, binary };
}

function pngSize(json, binary, image) {
  assert(Number.isInteger(image.bufferView), 'ghoul texture must be embedded');
  assert.strictEqual(image.mimeType, 'image/png', 'ghoul texture must use PNG');
  const view = json.bufferViews[image.bufferView];
  const start = Number(view.byteOffset || 0);
  const bytes = binary.subarray(start, start + view.byteLength);
  assert.strictEqual(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', 'invalid embedded PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function glbGeometryStats(json) {
  let vertices = 0;
  let triangles = 0;
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const position = json.accessors?.[primitive.attributes?.POSITION];
      vertices += Number(position?.count || 0);
      const indices = json.accessors?.[primitive.indices];
      triangles += indices
        ? Math.floor(Number(indices.count || 0) / 3)
        : Math.floor(Number(position?.count || 0) / 3);
    }
  }
  return { vertices, triangles };
}

assert(fs.existsSync(MODEL_FILE), 'runtime ghoul GLB is missing');
assert(fs.existsSync(REVIEW_FILE), 'review ghoul GLB is missing');
assert.strictEqual(sha256(REVIEW_FILE), APPROVED_REVIEW_SHA256, 'approved review bytes changed');
assert.strictEqual(sha256(MODEL_FILE), EXPECTED_RUNTIME_SHA256, 'runtime ghoul bytes changed');
const approval = fs.readFileSync(APPROVAL_FILE, 'utf8');
assert(approval.includes('APPROVE'), 'critic approval is missing');
assert(approval.includes(APPROVED_REVIEW_SHA256), 'critic approval SHA is missing');
const reviewReport = JSON.parse(fs.readFileSync(REVIEW_REPORT_FILE, 'utf8'));
assert.strictEqual(reviewReport.sha256, APPROVED_REVIEW_SHA256, 'review report SHA changed');
assert.strictEqual(
  reviewReport.geometryAnalysis?.bodyTopology?.connectedComponents,
  1,
  'ghoul body is no longer one connected component'
);

const { data, json, binary } = parseGlb(MODEL_FILE);
assert(data.length >= 5_500_000 && data.length <= 6_500_000, 'runtime ghoul byte budget changed');
assert.strictEqual(json.meshes?.length, 2, 'runtime ghoul must keep body and eye meshes');
assert.strictEqual(json.materials?.length, 7, 'runtime ghoul material count changed');
assert.strictEqual(json.images?.length, 21, 'runtime ghoul embedded texture count changed');
json.images.forEach(image => {
  assert.deepStrictEqual(pngSize(json, binary, image), [512, 512], 'ghoul texture size changed');
});
const pbrMaterials = json.materials.filter(material => (
  Number.isInteger(material.pbrMetallicRoughness?.baseColorTexture?.index)
  && Number.isInteger(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index)
  && Number.isInteger(material.normalTexture?.index)
));
assert.strictEqual(pbrMaterials.length, 7, 'ghoul PBR material contract changed');
const geometry = glbGeometryStats(json);
assert.deepStrictEqual(geometry, { vertices: 33494, triangles: 11168 });
assert.strictEqual(json.skins?.length, 1, 'runtime ghoul must use one skin');
assert.strictEqual(json.skins[0].joints?.length, 65, 'runtime ghoul must keep the 65-joint rig');
assert.deepStrictEqual(
  (json.animations || []).map(animation => String(animation.name || '').toLowerCase()).sort(),
  REQUIRED_ACTIONS
);
assert.strictEqual(
  (json.animations || []).reduce((sum, animation) => sum + Number(animation.channels?.length || 0), 0),
  1170,
  'runtime ghoul animation channels changed'
);
const assetRoot = (json.nodes || []).find(node => node.extras?.realm_asset_id === 'npc_ghoul');
assert(assetRoot, 'runtime ghoul asset metadata is missing');
assert.strictEqual(assetRoot.extras.realm_review_only, false, 'runtime ghoul is still review-only');
assert.strictEqual(
  assetRoot.extras.realm_runtime_integration_allowed,
  true,
  'runtime ghoul is not approved for integration'
);
assert.strictEqual(assetRoot.extras.realm_style, 'geometry_b_materials_c');
assert.strictEqual(assetRoot.extras.realm_approved_review_sha256, APPROVED_REVIEW_SHA256);
assert.strictEqual(assetRoot.extras.realm_runtime_scale_multiplier, 1);
assert.strictEqual(assetRoot.extras.realm_full_deforming_rig, true);

const colliders = JSON.parse(fs.readFileSync(COLLIDER_FILE, 'utf8'));
const collider = colliders.models?.['npc_ghoul.glb'];
assert(collider, 'runtime ghoul collider is missing');
assert.deepStrictEqual(collider.center, { x: 0.002717, y: 0.93776, z: 0.050164 });
assert.deepStrictEqual(collider.size, { x: 1.89623, y: 1.894925, z: 0.377536 });
assert.strictEqual(collider.collision?.mode, 'solid');
assert.deepStrictEqual(collider.collision?.center, { x: 0, y: 0.565, z: -0.022164 });
assert.deepStrictEqual(collider.collision?.size, { x: 0.355851, y: 0.77, z: 0.19376 });

const staticRuntime = fs.readFileSync(STATIC_RUNTIME_FILE, 'utf8');
[
  "const NPC_GHOUL_GLB_ASSET_VERSION = '7.76.9-ghoul-bc-v3';",
  'function cloneStaticModelSource(source)',
  'new THREE.Skeleton(bones, inverses)',
  'function staticModelAnimations(key)',
  'state.animations = Array.isArray(gltf?.animations) ? gltf.animations : [];',
  ".filter(key => key !== 'enemyGhoul')"
].forEach(marker => assert(staticRuntime.includes(marker), `ghoul loader integration is missing: ${marker}`));

const enemyRuntime = fs.readFileSync(ENEMY_RUNTIME_FILE, 'utf8');
[
  'function configureEnemyStaticGlbAnimation(actorGroup, model, modelKey)',
  "modelKey !== 'enemyGhoul'",
  "function setEnemyStaticGlbAction(runtime, requested = 'idle'",
  'function updateEnemyStaticGlbAnimation(enemy, dt = 0.016, state = {})',
  "runtime.currentAction === 'walk' || runtime.currentAction === 'run'",
  'updateEnemyStaticGlbAnimation(enemy, dt, { moving, visualSpeed, sleeping, inDialogue });',
  'updateEnemyStaticGlbAnimation(enemy, dt, { dead: true });'
].forEach(marker => assert(enemyRuntime.includes(marker), `ghoul animation integration is missing: ${marker}`));

async function verifyThreeRuntime() {
  global.ProgressEvent = global.ProgressEvent || class ProgressEvent {};
  global.self = global.self || global;
  global.createImageBitmap = global.createImageBitmap || (async () => ({
    width: 1,
    height: 1,
    close() {}
  }));
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const gltf = await new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
  const source = gltf.scene;
  const clone = source.clone(true);
  const sourceNodes = [];
  const cloneNodes = [];
  source.traverse(node => sourceNodes.push(node));
  clone.traverse(node => cloneNodes.push(node));
  const cloneBySource = new Map(sourceNodes.map((node, index) => [node, cloneNodes[index]]));
  let skinnedMeshes = 0;
  sourceNodes.forEach((sourceNode, index) => {
    if (!sourceNode?.isSkinnedMesh || !sourceNode.skeleton) return;
    const cloneNode = cloneNodes[index];
    const bones = sourceNode.skeleton.bones.map(bone => cloneBySource.get(bone));
    assert(bones.every(Boolean), 'a cloned ghoul skeleton bone is missing');
    cloneNode.bind(
      new THREE.Skeleton(
        bones,
        sourceNode.skeleton.boneInverses.map(matrix => matrix.clone())
      ),
      sourceNode.bindMatrix.clone()
    );
    assert.notStrictEqual(cloneNode.skeleton, sourceNode.skeleton, 'ghoul instances share a skeleton');
    assert(
      cloneNode.skeleton.bones.every(bone => cloneNodes.includes(bone)),
      'a cloned ghoul skin still points to source bones'
    );
    skinnedMeshes += 1;
  });
  assert.strictEqual(
    skinnedMeshes,
    7,
    'all material primitives from both ghoul mesh sections must use independent cloned skins'
  );
  const mixer = new THREE.AnimationMixer(clone);
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    action.reset().play();
    mixer.update(Math.min(1 / 30, Math.max(0.001, Number(clip.duration || 0.001) / 2)));
    action.stop();
  }
  console.log(
    `B+C ghoul model OK: ${geometry.vertices} vertices, ${geometry.triangles} triangles, `
    + `${json.skins[0].joints.length} joints, ${json.animations.length} actions, ${data.length} bytes`
  );
}

verifyThreeRuntime().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
