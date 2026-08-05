'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  BODY_IDS,
  NPC_REVIEW_SHA256,
  RIFLE_REVIEW_SHA256,
  BOOTS_FIT_REPORT_SHA256,
  GRIP_RUNTIME_SHA256
} = require('./build-approved-humanoid-assets');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_FILE = path.join(ROOT, 'public', 'assets', 'models', 'approved-humanoid-assets.json');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${file}: invalid GLB magic`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${file}: glTF 2 is required`);
  assert.strictEqual(data.readUInt32LE(8), data.length, `${file}: stale GLB byte length`);
  let json = null;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(body.toString('utf8').replace(/\0+$/g, '').trim());
    offset += 8 + length;
  }
  assert(json, `${file}: JSON chunk is missing`);
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
  return { data, json, vertices, triangles };
}

function runtimeFile(url) {
  return path.join(ROOT, 'public', String(url || '').replace(/^\//, ''));
}

assert(fs.existsSync(MANIFEST_FILE), 'approved humanoid asset manifest is missing');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.approved-humanoid-assets.v1');
assert.strictEqual(manifest.artDirection, 'geometry_b_materials_c');
assert.deepStrictEqual(manifest.approval, {
  humanoidNpc: NPC_REVIEW_SHA256,
  bootsFitReport: BOOTS_FIT_REPORT_SHA256,
  assaultRifle: RIFLE_REVIEW_SHA256,
  assaultRifleGrip: GRIP_RUNTIME_SHA256
});
assert.strictEqual(manifest.files?.length, 9, 'approved humanoid manifest must contain 9 runtime files');

const byId = new Map(manifest.files.map(row => [row.id, row]));
for (const row of manifest.files) {
  const file = runtimeFile(row.file);
  assert(fs.existsSync(file), `${row.id}: runtime file is missing`);
  assert.strictEqual(fs.statSync(file).size, row.bytes, `${row.id}: byte count is stale`);
  assert.strictEqual(sha256(file), String(row.runtimeSha256 || '').toUpperCase(), `${row.id}: runtime SHA changed`);
}

const npc = byId.get('npc_humanoid_animations');
assert(npc, 'humanoid NPC animation donor is missing');
assert.strictEqual(npc.sourceSha256, NPC_REVIEW_SHA256);
const npcGlb = parseGlb(runtimeFile(npc.file));
assert.strictEqual(npcGlb.json.skins?.length, 1);
assert.strictEqual(npcGlb.json.skins[0].joints?.length, 65);
assert.deepStrictEqual(
  (npcGlb.json.animations || []).map(animation => animation.name).sort(),
  ['attack', 'death', 'hurt', 'idle', 'run', 'walk']
);
const npcRoot = (npcGlb.json.nodes || []).find(node => node.extras?.realm_runtime_asset_id === 'npc_humanoid_animations');
assert(npcRoot, 'humanoid NPC runtime metadata is missing');
assert.strictEqual(npcRoot.extras.realm_runtime_integration_allowed, true);
assert.strictEqual(npcRoot.extras.realm_approved_review_sha256, NPC_REVIEW_SHA256);

for (const bodyId of BODY_IDS) {
  const row = byId.get(`boots_${bodyId}`);
  assert(row, `${bodyId}: approved boots are missing`);
  const parsed = parseGlb(runtimeFile(row.file));
  assert.deepStrictEqual({ vertices: parsed.vertices, triangles: parsed.triangles }, { vertices: 2532, triangles: 1308 });
  assert.strictEqual(parsed.json.meshes?.length, 1);
  assert.strictEqual(parsed.json.materials?.length, 4);
  assert.strictEqual(parsed.json.images?.length, 12);
  assert.strictEqual(parsed.json.skins?.length, 1);
  assert.strictEqual(parsed.json.skins[0].joints?.length, 65);
  const root = (parsed.json.nodes || []).find(node => node.extras?.realm_runtime_asset_id === `boots_${bodyId}`);
  assert(root, `${bodyId}: runtime approval metadata is missing`);
  assert.strictEqual(root.extras.realm_runtime_integration_allowed, true);
  assert.strictEqual(root.extras.realm_approved_review_sha256, row.sourceSha256);
}

const rifle = byId.get('assaultRifle');
assert(rifle, 'approved assault rifle is missing');
assert.strictEqual(rifle.sourceSha256, RIFLE_REVIEW_SHA256);
const rifleGlb = parseGlb(runtimeFile(rifle.file));
assert.deepStrictEqual({ vertices: rifleGlb.vertices, triangles: rifleGlb.triangles }, { vertices: 1893, triangles: 1116 });
assert.strictEqual(rifleGlb.json.meshes?.length, 3);
assert.strictEqual(rifleGlb.json.materials?.length, 4);
assert.strictEqual(rifleGlb.json.images?.length, 12);
assert.deepStrictEqual(
  (rifleGlb.json.animations || []).map(animation => animation.name).sort(),
  ['attack', 'idle', 'reload']
);
const rifleNames = new Set((rifleGlb.json.nodes || []).map(node => node.name));
['socket_butt', 'socket_grip_l', 'socket_grip_r', 'socket_muzzle'].forEach(name => (
  assert(rifleNames.has(name), `assault rifle socket is missing: ${name}`)
));
const rifleRoot = (rifleGlb.json.nodes || []).find(node => node.extras?.realm_weapon_id === 'assaultRifle');
assert(rifleRoot, 'approved assault-rifle runtime root is missing');
assert.strictEqual(rifleRoot.extras.realm_runtime_integration_allowed, true);
assert.strictEqual(rifleRoot.extras.realm_approved_review_sha256, RIFLE_REVIEW_SHA256);

const grip = byId.get('assaultRifleGrip');
assert(grip, 'approved assault-rifle grip donor is missing');
assert.strictEqual(grip.sourceSha256, GRIP_RUNTIME_SHA256);
const gripGlb = parseGlb(runtimeFile(grip.file));
assert.strictEqual(gripGlb.json.meshes?.length || 0, 0);
assert.strictEqual(gripGlb.json.skins?.length || 0, 0);
assert.deepStrictEqual((gripGlb.json.animations || []).map(animation => animation.name), ['assault_rifle_grip']);
assert.strictEqual(gripGlb.json.animations[0].channels?.length, 123);
const gripNames = new Set((gripGlb.json.nodes || []).map(node => node.name));
['approved_assault_rifle_mount', 'hand_l', 'hand_r', 'thumb_01_l'].forEach(name => (
  assert(gripNames.has(name), `approved grip node is missing: ${name}`)
));

const runtimeSource = fs.readFileSync(
  path.join(ROOT, 'public', 'js', 'game', '04d_approved_humanoid_assets_runtime.js'),
  'utf8'
);
[
  'function attachApprovedNpcAnimations(runtime)',
  'new THREE.Skeleton(',
  'function applyApprovedBootsVisual(actor, eq = {})',
  'function compileApprovedGripPose(gltf)',
  'function captureApprovedAssaultRifleRestPose(root)',
  'function approvedGripTargetTransform(runtime, pose, boneName, transform)',
  'mount.position.add(targetShoulder).sub(donorShoulder)',
  'function applyApprovedAssaultRifleGrip(actor, weaponId = \'\')',
  "id !== 'assaultRifle'",
  'weaponGroup.parent !== runtime.root',
  'bone.quaternion.copy(target.quaternion)'
].forEach(marker => assert(runtimeSource.includes(marker), `approved humanoid runtime marker is missing: ${marker}`));

const characterSource = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '04b_character_glb_runtime.js'), 'utf8');
assert(characterSource.includes("state.dead && runtime.actions?.death"));
assert(characterSource.includes("options.npcAnimations && typeof attachApprovedNpcAnimations === 'function'"));
assert(characterSource.includes("typeof applyApprovedBootsVisual === 'function'"));
assert(characterSource.includes("approvedAssaultRifleRestPose: typeof captureApprovedAssaultRifleRestPose === 'function'"));

const enemySource = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '05f_enemy_models_location_flow.js'), 'utf8');
assert(enemySource.includes('function buildUnifiedHumanoidNpc(group, type = {}, visual = \'raider\')'));
assert(enemySource.includes('npcAnimations: true'));
assert(enemySource.includes('if (parts.unifiedHumanoidNpc)'));

const loaderSource = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game.js'), 'utf8');
assert(loaderSource.includes("'/js/game/04d_approved_humanoid_assets_runtime.js'"));

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
  const load = file => {
    const data = fs.readFileSync(file);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  };

  const character = await load(path.join(
    ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb'
  ));
  const femaleCharacter = await load(path.join(
    ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_female_medium.glb'
  ));
  const boots = await load(runtimeFile(byId.get('boots_male_medium').file));
  let bootMesh = null;
  boots.scene.traverse(node => {
    if (!bootMesh && node?.isSkinnedMesh && node.skeleton) bootMesh = node;
  });
  assert(bootMesh, 'male_medium boots have no Three.js SkinnedMesh');
  const targetBones = bootMesh.skeleton.bones.map(bone => character.scene.getObjectByName(bone.name));
  assert.strictEqual(targetBones.length, 65);
  assert(targetBones.every(Boolean), 'boots cannot resolve every bone on the current character rig');
  const instance = new THREE.SkinnedMesh(bootMesh.geometry, bootMesh.material);
  instance.bind(
    new THREE.Skeleton(
      targetBones,
      bootMesh.skeleton.boneInverses.map(matrix => matrix.clone())
    ),
    bootMesh.bindMatrix.clone()
  );
  assert(instance.skeleton.bones.every(bone => character.scene.getObjectByName(bone.name) === bone));
  const mixer = new THREE.AnimationMixer(character.scene);
  const walk = character.animations.find(clip => clip.name === 'walk');
  assert(walk, 'current character has no walk animation');
  mixer.clipAction(walk).play();
  mixer.update(Math.min(0.2, walk.duration / 2));
  instance.skeleton.update();

  const gripRuntime = await load(runtimeFile(grip.file));
  const gripClip = gripRuntime.animations.find(clip => clip.name === 'assault_rifle_grip');
  assert(gripClip, 'Three.js cannot read the approved assault-rifle grip clip');
  const handTrack = gripClip.tracks.find(track => track.name === 'hand_l.quaternion');
  assert(handTrack, 'approved support-hand quaternion track is missing');
  const handQuaternion = Array.from(handTrack.createInterpolant().evaluate(gripClip.duration * 0.5));
  assert.strictEqual(handQuaternion.length, 4);
  assert(Math.abs(Math.hypot(...handQuaternion) - 1) < 0.001, 'approved support-hand quaternion is invalid');
  const upperArmPositionTrack = gripClip.tracks.find(track => track.name === 'upperarm_l.position');
  assert(upperArmPositionTrack, 'approved support-arm position track is missing');
  const donorUpperArm = gripRuntime.scene.getObjectByName('upperarm_l');
  const maleUpperArm = character.scene.getObjectByName('upperarm_l');
  const femaleUpperArm = femaleCharacter.scene.getObjectByName('upperarm_l');
  assert(donorUpperArm && maleUpperArm?.isBone && femaleUpperArm?.isBone);
  const approvedUpperArmPosition = new THREE.Vector3().fromArray(Array.from(
    upperArmPositionTrack.createInterpolant().evaluate(gripClip.duration * 0.5)
  ));
  const maleRetargetedPosition = maleUpperArm.position.clone().add(
    approvedUpperArmPosition.clone().sub(donorUpperArm.position)
  );
  const femaleRetargetedPosition = femaleUpperArm.position.clone().add(
    approvedUpperArmPosition.clone().sub(donorUpperArm.position)
  );
  assert(maleRetargetedPosition.distanceTo(approvedUpperArmPosition) < 0.0001,
    'approved male grip must remain byte-for-byte equivalent after retargeting');
  assert(femaleRetargetedPosition.distanceTo(approvedUpperArmPosition) > 0.03,
    'female grip retarget must preserve the female shoulder/arm proportions');
  const mount = gripRuntime.scene.getObjectByName('approved_assault_rifle_mount');
  assert(mount, 'Three.js cannot resolve the approved rifle mount');
  assert(Math.abs(mount.position.y - 1.3562635) < 0.0001, 'approved shoulder mount drifted');

  const rifleRuntime = await load(runtimeFile(rifle.file));
  rifleRuntime.scene.updateMatrixWorld(true);
  const rifleSize = new THREE.Box3().setFromObject(rifleRuntime.scene).getSize(new THREE.Vector3());
  assert(
    Math.max(rifleSize.x, rifleSize.y, rifleSize.z) >= 1.04
      && Math.max(rifleSize.x, rifleSize.y, rifleSize.z) <= 1.06,
    `approved assault-rifle length is wrong in Three.js: ${rifleSize.toArray()}`
  );

  console.log(
    `Approved humanoid assets OK: 1 NPC donor, ${BODY_IDS.length} fitted boot models, `
    + `1 assault rifle and 1 exact grip pose`
  );
}

verifyThreeRuntime().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
