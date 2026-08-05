'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  APPROVED_CREATURES,
  MANIFEST_NAME,
  STYLE
} = require('./build-approved-creature-models');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIRECTORY = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MANIFEST_FILE = path.join(MODEL_DIRECTORY, MANIFEST_NAME);
const COLLIDER_FILE = path.join(MODEL_DIRECTORY, 'model-colliders.json');
const STATIC_RUNTIME_FILE = path.join(ROOT, 'public', 'js', 'game', '02a_materials_static_models.js');
const ENEMY_RUNTIME_FILE = path.join(ROOT, 'public', 'js', 'game', '05f_enemy_models_location_flow.js');
const REQUIRED_ACTIONS = ['attack', 'death', 'hurt', 'idle', 'run', 'walk'];
const EXPECTED_BOUNDS = {
  brahmin: {
    center: { x: 0, y: 0.570542, z: 0.157249 },
    size: { x: 1.695023, y: 1.087041, z: 1.238178 }
  },
  npc_gecko: {
    center: { x: -0.000077, y: 0.653827, z: -0.17729 },
    size: { x: 1.415697, y: 1.257459, z: 1.876276 }
  },
  npc_fire_gecko: {
    center: { x: -0.000077, y: 0.715884, z: -0.17729 },
    size: { x: 1.415697, y: 1.381573, z: 1.876276 }
  },
  npc_ash_wolf: {
    center: { x: 0, y: 0.681511, z: -0.081834 },
    size: { x: 0.671076, y: 1.348549, z: 2.110174 }
  },
  npc_radscorpion: {
    center: { x: 0.000017, y: 0.646637, z: -0.231122 },
    size: { x: 2.210505, y: 1.246726, z: 2.269616 }
  },
  npc_mutant_ant: {
    center: { x: 0.000012, y: 0.354658, z: 0.02032 },
    size: { x: 2.009994, y: 0.675568, z: 2.15746 }
  }
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)} is not a GLB`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)} must use glTF 2`);
  assert.strictEqual(data.readUInt32LE(8), data.length, `${path.basename(file)} has stale length metadata`);
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
  assert(json, `${path.basename(file)} has no JSON chunk`);
  assert(binary, `${path.basename(file)} has no binary chunk`);
  return { data, json, binary };
}

function embeddedPngSize(json, binary, image, modelId) {
  assert(Number.isInteger(image.bufferView), `${modelId} texture is not embedded`);
  assert.strictEqual(image.mimeType, 'image/png', `${modelId} texture is not PNG`);
  const view = json.bufferViews[image.bufferView];
  const start = Number(view.byteOffset || 0);
  const bytes = binary.subarray(start, start + view.byteLength);
  assert.strictEqual(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${modelId} PNG is invalid`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function geometryStats(json) {
  let vertices = 0;
  let triangles = 0;
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const position = json.accessors?.[primitive.attributes?.POSITION];
      const indices = json.accessors?.[primitive.indices];
      vertices += Number(position?.count || 0);
      triangles += indices
        ? Math.floor(Number(indices.count || 0) / 3)
        : Math.floor(Number(position?.count || 0) / 3);
    }
  }
  return { vertices, triangles };
}

assert(fs.existsSync(MANIFEST_FILE), 'approved creature manifest is missing');
assert(fs.existsSync(COLLIDER_FILE), 'model collider catalog is missing');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const colliders = JSON.parse(fs.readFileSync(COLLIDER_FILE, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.approved-creature-model-catalog.v1');
assert.strictEqual(manifest.artDirection, STYLE);
assert.strictEqual(manifest.scope, 'approved_creature_runtime_replacements');
assert.deepStrictEqual([...manifest.animationSet].sort(), REQUIRED_ACTIONS);
assert.strictEqual(manifest.files.length, APPROVED_CREATURES.length);
assert.strictEqual(new Set(manifest.files.map(row => row.id)).size, APPROVED_CREATURES.length);

const manifestById = new Map(manifest.files.map(row => [row.id, row]));
const parsedRuntimeModels = [];
let totalBytes = 0;
let totalTriangles = 0;
let totalChannels = 0;

for (const definition of APPROVED_CREATURES) {
  const reviewFile = path.join(definition.reviewDirectory, definition.reviewFile);
  const reviewReportFile = path.join(definition.reviewDirectory, definition.reviewReport);
  const approvalFile = path.join(definition.reviewDirectory, definition.approvalFile);
  const runtimeFile = path.join(MODEL_DIRECTORY, definition.outputFile);
  const row = manifestById.get(definition.id);
  assert(row, `${definition.id} manifest row is missing`);
  assert(fs.existsSync(reviewFile), `${definition.id} review GLB is missing`);
  assert(fs.existsSync(reviewReportFile), `${definition.id} review report is missing`);
  assert(fs.existsSync(approvalFile), `${definition.id} critic approval is missing`);
  assert(fs.existsSync(runtimeFile), `${definition.id} runtime GLB is missing`);

  const approval = fs.readFileSync(approvalFile, 'utf8');
  const reviewReport = JSON.parse(fs.readFileSync(reviewReportFile, 'utf8'));
  assert(approval.includes('APPROVE'), `${definition.id} critic approval is invalid`);
  assert(
    approval.includes(definition.approvedReviewSha256),
    `${definition.id} approved SHA is missing from critic approval`
  );
  assert.strictEqual(sha256(reviewFile), definition.approvedReviewSha256);
  assert.strictEqual(String(reviewReport.sha256 || '').toUpperCase(), definition.approvedReviewSha256);
  assert.strictEqual(sha256(runtimeFile), definition.expectedRuntimeSha256);

  const { data, json, binary } = parseGlb(runtimeFile);
  parsedRuntimeModels.push({ definition, data });
  assert.strictEqual(row.bytes, data.length, `${definition.id} manifest byte count is stale`);
  assert.strictEqual(row.sha256, definition.expectedRuntimeSha256);
  assert.strictEqual(row.approvedReviewSha256, definition.approvedReviewSha256);
  assert.strictEqual(row.runtimeScaleMultiplier, definition.runtimeScaleMultiplier);
  assert.strictEqual(row.runtimeScaleCompensation, definition.runtimeScaleCompensation || null);
  assert.strictEqual(json.meshes?.length, definition.expected.meshes, `${definition.id} mesh count changed`);
  assert.strictEqual(json.materials?.length, definition.expected.materials, `${definition.id} material count changed`);
  assert.strictEqual(json.images?.length, definition.expected.images, `${definition.id} texture count changed`);
  assert.deepStrictEqual(geometryStats(json), {
    vertices: definition.expected.vertices,
    triangles: definition.expected.triangles
  });
  assert.deepStrictEqual(
    (json.animations || []).map(animation => String(animation.name || '').toLowerCase()).sort(),
    REQUIRED_ACTIONS,
    `${definition.id} animation set changed`
  );
  const channelCount = (json.animations || []).reduce(
    (sum, animation) => sum + Number(animation.channels?.length || 0),
    0
  );
  assert.strictEqual(channelCount, definition.expected.channels, `${definition.id} channels changed`);
  assert.strictEqual(json.skins?.length, 1, `${definition.id} must keep one skin`);
  assert.strictEqual(
    json.skins[0].joints?.length,
    definition.expected.joints,
    `${definition.id} rig joint count changed`
  );
  assert((json.buffers || []).every(buffer => !buffer.uri), `${definition.id} uses an external buffer`);
  json.images.forEach(image => {
    assert(!image.uri, `${definition.id} uses an external texture`);
    assert.deepStrictEqual(embeddedPngSize(json, binary, image, definition.id), [512, 512]);
  });
  const pbrMaterials = json.materials.filter(material => (
    Number.isInteger(material.pbrMetallicRoughness?.baseColorTexture?.index)
    && Number.isInteger(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index)
    && Number.isInteger(material.normalTexture?.index)
  ));
  assert.strictEqual(
    pbrMaterials.length,
    definition.expected.materials,
    `${definition.id} PBR material contract changed`
  );
  const assetRoot = (json.nodes || []).find(node => node.extras?.realm_asset_id === definition.id);
  assert(assetRoot, `${definition.id} runtime metadata is missing`);
  assert.strictEqual(assetRoot.extras.realm_review_only, false);
  assert.strictEqual(assetRoot.extras.realm_runtime_integration_allowed, true);
  assert.strictEqual(assetRoot.extras.realm_style, STYLE);
  assert.strictEqual(assetRoot.extras.realm_approved_review_sha256, definition.approvedReviewSha256);
  assert.strictEqual(assetRoot.extras.realm_runtime_scale_multiplier, definition.runtimeScaleMultiplier);
  if (definition.runtimeScaleCompensation) {
    assert.strictEqual(
      assetRoot.extras.realm_runtime_scale_compensation,
      definition.runtimeScaleCompensation
    );
  }
  const rigNode = (json.nodes || []).find(node => node.extras?.realm_full_deforming_rig === true);
  assert(rigNode, `${definition.id} full deforming rig metadata is missing`);

  const collider = colliders.models?.[definition.outputFile];
  assert(collider, `${definition.id} collider is missing`);
  assert.deepStrictEqual(collider.center, EXPECTED_BOUNDS[definition.id].center);
  assert.deepStrictEqual(collider.size, EXPECTED_BOUNDS[definition.id].size);
  assert.strictEqual(collider.collision?.mode, 'solid');
  assert.deepStrictEqual(row.centerMeters, collider.center);
  assert.deepStrictEqual(row.boundsMeters, collider.size);

  totalBytes += data.length;
  totalTriangles += definition.expected.triangles;
  totalChannels += channelCount;
}

const staticRuntime = fs.readFileSync(STATIC_RUNTIME_FILE, 'utf8');
[
  "const APPROVED_CREATURE_GLB_ASSET_VERSION = '7.77.0-approved-creatures-bc';",
  'const APPROVED_CREATURE_STATIC_MODEL_KEYS = new Set([',
  'const LAZY_SKINNED_STATIC_MODEL_KEYS = new Set([',
  "'friendlyBrahmin'",
  "'enemyAshWolf'",
  "'enemyRadscorpion'",
  "'enemyMutantAnt'",
  "'enemyGecko'",
  "'enemyFireGecko'",
  '? APPROVED_CREATURE_GLB_ASSET_VERSION',
  '.filter(key => !LAZY_SKINNED_STATIC_MODEL_KEYS.has(key))',
  'function cloneStaticModelSource(source)',
  'new THREE.Skeleton(bones, inverses)',
  'state.animations = Array.isArray(gltf?.animations) ? gltf.animations : [];'
].forEach(marker => {
  assert(staticRuntime.includes(marker), `approved creature loader integration is missing: ${marker}`);
});

const enemyRuntime = fs.readFileSync(ENEMY_RUNTIME_FILE, 'utf8');
[
  "modelKey !== 'enemyGhoul'",
  "typeof APPROVED_CREATURE_STATIC_MODEL_KEYS === 'undefined'",
  '!APPROVED_CREATURE_STATIC_MODEL_KEYS.has(modelKey)',
  'configureEnemyStaticGlbAnimation(group, instance, appliedKey || modelKey);',
  "function setEnemyStaticGlbAction(runtime, requested = 'idle'",
  'characterOneShotRestart(runtime, action, state.attackToken)',
  'attackActive: attackAnimation.active',
  'attackToken: attackAnimation.token',
  '&& runtime.actions.run',
  "runtime.currentAction === 'walk' || runtime.currentAction === 'run'",
  'updateEnemyStaticGlbAnimation(enemy, dt, {',
  'updateEnemyStaticGlbAnimation(enemy, dt, { dead: true });'
].forEach(marker => {
  assert(enemyRuntime.includes(marker), `approved creature animation integration is missing: ${marker}`);
});

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
  for (const { definition, data } of parsedRuntimeModels) {
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
      assert(bones.every(Boolean), `${definition.id} cloned skeleton bone is missing`);
      cloneNode.bind(
        new THREE.Skeleton(
          bones,
          sourceNode.skeleton.boneInverses.map(matrix => matrix.clone())
        ),
        sourceNode.bindMatrix.clone()
      );
      assert.notStrictEqual(
        cloneNode.skeleton,
        sourceNode.skeleton,
        `${definition.id} instances share a skeleton`
      );
      assert(
        cloneNode.skeleton.bones.every(bone => cloneNodes.includes(bone)),
        `${definition.id} cloned skin points to source bones`
      );
      skinnedMeshes += 1;
    });
    assert(skinnedMeshes > 0, `${definition.id} has no skinned runtime mesh`);
    const mixer = new THREE.AnimationMixer(clone);
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.reset().play();
      mixer.update(Math.min(1 / 30, Math.max(0.001, Number(clip.duration || 0.001) / 2)));
      action.stop();
    }
  }
  console.log(
    `Approved B+C creature models OK: ${APPROVED_CREATURES.length} GLB, `
    + `${totalTriangles} triangles, ${totalChannels} animation channels, ${totalBytes} bytes`
  );
}

verifyThreeRuntime().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
