'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  APPROVED_CREATURES,
  MANIFEST_NAME,
  STYLE
} = require('./build-approved-creature-models');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIRECTORY = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MANIFEST_FILE = path.join(MODEL_DIRECTORY, MANIFEST_NAME);
const COLLIDER_FILE = path.join(MODEL_DIRECTORY, 'model-colliders.json');
const UNITY_ENEMY_MODELS_FILE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaEnemyModels.cs');
const SERVER_RUNTIME_FILE = path.join(ROOT, 'server.js');
const REQUIRED_ACTIONS = ['attack', 'death', 'hurt', 'idle', 'run', 'walk'];
// Unity model keys that must render each approved creature GLB.
const UNITY_MODEL_KEY_BY_CREATURE = {
  brahmin: 'friendlyBrahmin',
  npc_gecko: 'enemyGecko',
  npc_fire_gecko: 'enemyFireGecko',
  npc_ash_wolf: 'enemyAshWolf',
  npc_radscorpion: 'enemyRadscorpion',
  npc_mutant_ant: 'enemyMutantAnt',
  npc_super_mutant: 'enemySuperMutant'
};
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
  },
  npc_super_mutant: {
    center: { x: -0.003261, y: 1.273561, z: -0.01007 },
    size: { x: 2.676769, y: 2.579498, z: 0.548778 }
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

// Unity resolves creature model keys to runtime GLBs through RoaEnemyModels.Urls.
const unityEnemyModels = fs.readFileSync(UNITY_ENEMY_MODELS_FILE, 'utf8');
assert(
  unityEnemyModels.includes('private const string Wasteland = "/assets/models/wasteland/";'),
  'Unity creature models no longer load from the runtime wasteland directory'
);
const unityModelFileByKey = new Map(Array.from(
  unityEnemyModels.matchAll(/\{\s*"(\w+)",\s*Wasteland\s*\+\s*"([^"]+\.glb)"\s*\}/g),
  match => [match[1], match[2]]
));
for (const definition of APPROVED_CREATURES) {
  const key = UNITY_MODEL_KEY_BY_CREATURE[definition.id];
  assert(key, `${definition.id} has no Unity model key`);
  assert.strictEqual(
    unityModelFileByKey.get(key),
    definition.outputFile,
    `approved creature loader integration is missing: Unity key ${key}`
  );
}

const serverRuntime = fs.readFileSync(SERVER_RUNTIME_FILE, 'utf8');
const serverIdentityStart = serverRuntime.indexOf('const SERVER_ENEMY_MODEL_KEY_BY_VISUAL');
const serverIdentityEnd = serverRuntime.indexOf('\nconst SERVER_ENEMY_FACTION_BY_LOOT_TIER', serverIdentityStart);
assert(serverIdentityStart >= 0 && serverIdentityEnd > serverIdentityStart, 'server enemy GLB identity block is missing');
const serverIdentitySandbox = {};
vm.runInNewContext(
  `${serverRuntime.slice(serverIdentityStart, serverIdentityEnd)}\n`
    + 'this.resolveServerEnemyGlbModel = serverEnemyModelKeyForIdentity;\n'
    + 'this.resolveServerExplicitActorGlbModel = serverModelKeyForExplicitRef;',
  serverIdentitySandbox
);
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ name: 'Радскорпион' }), 'kromkaRykhlyak');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ species: 'ash_wolf' }), 'kromkaGari');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ modelKey: 'enemy_fire_gecko' }), 'kromkaMourner');
assert.strictEqual(
  serverIdentitySandbox.resolveServerEnemyGlbModel({
    model: '/assets/models/wasteland/npc_ash_wolf.glb?v=7.99.23#runtime'
  }),
  'kromkaGari'
);
assert.strictEqual(
  serverIdentitySandbox.resolveServerEnemyGlbModel({
    modelKey: 'C:\\realm\\public\\assets\\models\\wasteland\\npc_radscorpion.glb?cache=1'
  }),
  'kromkaRykhlyak'
);
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ role: 'animal' }), 'friendlyBrahmin');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ role: 'merchant' }), 'caravanMerchant');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ role: 'guard', faction: 'old_klim' }), 'klimPatrolGuard');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ role: 'civilian' }), 'wastelandSettler');
assert.strictEqual(serverIdentitySandbox.resolveServerExplicitActorGlbModel('trader_npc.glb?v=7'), 'traderNpc');
assert.strictEqual(serverIdentitySandbox.resolveServerExplicitActorGlbModel('crate'), '');
assert.strictEqual(serverIdentitySandbox.resolveServerExplicitActorGlbModel('/assets/models/wasteland/crate.glb'), '');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ modelKey: 'legacy_generated_raider_body' }), '');
assert.strictEqual(serverIdentitySandbox.resolveServerEnemyGlbModel({ modelKey: 'crate' }), '');
// The server publishes Kromka creature keys; Unity must render them with the approved GLBs.
for (const [identity, file] of [
  [{ name: 'Радскорпион' }, 'npc_radscorpion.glb'],
  [{ species: 'ash_wolf' }, 'npc_ash_wolf.glb'],
  [{ modelKey: 'enemy_fire_gecko' }, 'npc_fire_gecko.glb'],
  [{ role: 'animal' }, 'brahmin.glb']
]) {
  const key = serverIdentitySandbox.resolveServerEnemyGlbModel(identity);
  assert.strictEqual(unityModelFileByKey.get(key), file, `Unity renders server creature key ${key} without ${file}`);
}

const encounterNormalizerSource = serverRuntime.slice(
  serverRuntime.indexOf('function normalizeServerEncounterActor'),
  serverRuntime.indexOf('\nfunction normalizeServerEncounterDefinitions', serverRuntime.indexOf('function normalizeServerEncounterActor'))
);
const naturalCreatureNormalizerSource = serverRuntime.slice(
  serverRuntime.indexOf('function normalizeServerNaturalCreatureState'),
  serverRuntime.indexOf('\nfunction persistedNaturalCreatureArrayChanged', serverRuntime.indexOf('function normalizeServerNaturalCreatureState'))
);
const collisionIdentitySource = serverRuntime.slice(
  serverRuntime.indexOf('function enemyBodyRadius'),
  serverRuntime.indexOf('\nfunction roomEnemyCollisionPenalty', serverRuntime.indexOf('function enemyBodyRadius'))
);
const publicEnemySource = serverRuntime.slice(
  serverRuntime.indexOf('function publicEnemy(e, viewer = null)'),
  serverRuntime.indexOf('\nfunction publicEnemySnapshotForViewer', serverRuntime.indexOf('function publicEnemy(e, viewer = null)'))
);
const spawnEnemySource = serverRuntime.slice(
  serverRuntime.indexOf('function spawnServerEnemy(room, opts = {})'),
  serverRuntime.indexOf('\nfunction spawnEncounterActor', serverRuntime.indexOf('function spawnServerEnemy(room, opts = {})'))
);
assert(!encounterNormalizerSource.includes('authoredModelKey'), 'encounter normalization must not retain an arbitrary authored actor model key');
assert(!naturalCreatureNormalizerSource.includes('|| enemy.modelKey'), 'natural creature normalization must not retain a rejected actor model key');
assert(!collisionIdentitySource.includes('|| enemy?.modelKey') && !collisionIdentitySource.includes('|| enemy.modelKey'), 'enemy collision must not use a rejected actor model key');
assert(!publicEnemySource.includes("String(e.modelKey || '')"), 'public enemy payload must not publish a rejected actor model key');
assert(!spawnEnemySource.includes('|| opts.modelKey') && !spawnEnemySource.includes('|| opts.model'), 'enemy spawning must not retain a rejected actor model key');

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
