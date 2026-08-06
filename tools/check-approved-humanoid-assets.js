'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  BODY_IDS,
  APPROVED_EQUIPMENT_REVIEWS,
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
assert.strictEqual(manifest.schema, 'realm.approved-humanoid-assets.v2');
assert.strictEqual(manifest.artDirection, 'geometry_b_materials_c');
assert.deepStrictEqual(manifest.approval, {
  humanoidNpc: NPC_REVIEW_SHA256,
  bootsFitReport: BOOTS_FIT_REPORT_SHA256,
  equipmentFitReports: Object.fromEntries(APPROVED_EQUIPMENT_REVIEWS.map(definition => (
    [definition.itemId, definition.fitReportSha256]
  ))),
  assaultRifle: RIFLE_REVIEW_SHA256,
  assaultRifleGrip: GRIP_RUNTIME_SHA256
});
assert.strictEqual(
  manifest.files?.length,
  9 + APPROVED_EQUIPMENT_REVIEWS.length * BODY_IDS.length,
  'approved humanoid manifest must contain every runtime body/equipment variant'
);

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
const npcDeath = (npcGlb.json.animations || []).find(animation => animation.name === 'death');
const npcDeathDuration = Math.max(...npcDeath.samplers.map(sampler => (
  Number(npcGlb.json.accessors?.[sampler.input]?.max?.[0] || 0)
)));
assert(npcDeathDuration >= 1.2, 'humanoid death must include balance loss, knee collapse and ground contact');
assert.strictEqual(npcDeath.channels?.length, 195, 'humanoid death must key all 65 bones');
const npcRoot = (npcGlb.json.nodes || []).find(node => node.extras?.realm_runtime_asset_id === 'npc_humanoid_animations');
assert(npcRoot, 'humanoid NPC runtime metadata is missing');
assert.strictEqual(npcRoot.extras.realm_runtime_integration_allowed, true);
assert.strictEqual(npcRoot.extras.realm_approved_review_sha256, NPC_REVIEW_SHA256);
const npcGeneratorSource = fs.readFileSync(path.join(
  ROOT, 'tools', 'blender', 'build_unified_humanoid_npc_review.py'
), 'utf8');
[
  'def pin_death_limb_contacts(',
  '("upperarm_r", "lowerarm_r")',
  '("thigh_r", "calf_r")',
  'target.location = Vector((current_tail.x, current_tail.y, clearance))',
  'pin_death_limb_contacts(armature)'
].forEach(marker => assert(
  npcGeneratorSource.includes(marker),
  `humanoid death-contact marker is missing: ${marker}`
));

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

for (const definition of APPROVED_EQUIPMENT_REVIEWS) {
  for (const bodyId of BODY_IDS) {
    const runtimeAssetId = `${definition.itemId}_${bodyId}`;
    const row = byId.get(runtimeAssetId);
    assert(row, `${runtimeAssetId}: approved equipment runtime is missing`);
    assert.strictEqual(row.itemId, definition.itemId);
    assert.strictEqual(row.slot, definition.slot);
    assert.strictEqual(row.bodyId, bodyId);
    const reportFile = path.join(
      ROOT,
      ...definition.reviewDirectory,
      `${definition.sourcePrefix}_${bodyId}.report.json`
    );
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.strictEqual(row.sourceSha256, report.sha256, `${runtimeAssetId}: review SHA is stale`);
    const parsed = parseGlb(runtimeFile(row.file));
    assert.strictEqual(parsed.json.meshes?.length, definition.meshCount, `${runtimeAssetId}: mesh count changed`);
    assert.strictEqual(parsed.json.skins?.length, 1, `${runtimeAssetId}: one skin is required`);
    assert.strictEqual(parsed.json.skins[0].joints?.length, 65, `${runtimeAssetId}: current rig has 65 joints`);
    assert.strictEqual(parsed.json.asset?.extras?.realm_schema, 'realm.equipment-runtime.approved.v1');
    assert.strictEqual(parsed.json.asset?.extras?.realm_item_id, definition.itemId);
    assert.strictEqual(parsed.json.asset?.extras?.realm_equipment_slot, definition.slot);
    const meshNodes = (parsed.json.nodes || []).filter(node => Number.isInteger(node?.mesh));
    assert.strictEqual(meshNodes.length, definition.meshCount, `${runtimeAssetId}: skinned mesh nodes changed`);
    meshNodes.forEach(node => {
      assert.strictEqual(node.extras?.realm_review_only, false, `${runtimeAssetId}: review-only flag leaked to runtime`);
      assert.strictEqual(node.extras?.realm_runtime_integration_allowed, true);
      assert.strictEqual(node.extras?.realm_approved_review_sha256, report.sha256);
      assert.strictEqual(node.extras?.realm_runtime_asset_id, runtimeAssetId);
      assert.strictEqual(node.extras?.realm_item_id, definition.itemId);
      assert.strictEqual(node.extras?.realm_equipment_slot, definition.slot);
      assert.strictEqual(node.extras?.realm_body_id, bodyId);
    });
  }
}

const rifle = byId.get('assaultRifle');
assert(rifle, 'approved assault rifle is missing');
assert.strictEqual(rifle.sourceSha256, RIFLE_REVIEW_SHA256);
const rifleGlb = parseGlb(runtimeFile(rifle.file));
assert.deepStrictEqual({ vertices: rifleGlb.vertices, triangles: rifleGlb.triangles }, { vertices: 1940, triangles: 1116 });
assert.strictEqual(rifleGlb.json.meshes?.length, 4);
assert.strictEqual(rifleGlb.json.materials?.length, 4);
assert.strictEqual(rifleGlb.json.images?.length, 12);
assert.deepStrictEqual(
  (rifleGlb.json.animations || []).map(animation => animation.name).sort(),
  ['attack', 'idle', 'reload']
);
const rifleNames = new Set((rifleGlb.json.nodes || []).map(node => node.name));
['magazine', 'socket_butt', 'socket_grip_l', 'socket_grip_r', 'socket_muzzle', 'socket_reload'].forEach(name => (
  assert(rifleNames.has(name), `assault rifle socket is missing: ${name}`)
));
const rifleReload = (rifleGlb.json.animations || []).find(animation => animation.name === 'reload');
const rifleReloadTargets = new Set((rifleReload?.channels || []).map(channel => (
  rifleGlb.json.nodes[channel.target.node]?.name
)));
assert(rifleReloadTargets.has('magazine'), 'assault-rifle reload clip does not animate its magazine');
const rifleRoot = (rifleGlb.json.nodes || []).find(node => node.extras?.realm_weapon_id === 'assaultRifle');
assert(rifleRoot, 'approved assault-rifle runtime root is missing');
assert.strictEqual(rifleRoot.extras.realm_runtime_integration_allowed, true);
assert.strictEqual(rifleRoot.extras.realm_approved_review_sha256, RIFLE_REVIEW_SHA256);

const grip = byId.get('assaultRifleGrip');
assert(grip, 'approved assault-rifle grip donor is missing');
assert.strictEqual(grip.sourceSha256, GRIP_RUNTIME_SHA256);
const gripReport = JSON.parse(fs.readFileSync(path.join(
  ROOT, 'docs', 'art', 'reviews', 'unified-style-v5', 'rifle', 'assault_rifle_grip_runtime-report.json'
), 'utf8'));
const gripBoneNames = new Set(gripReport.gripBones || []);
assert.strictEqual(gripBoneNames.size, 41, 'approved grip report must name 41 upper-body bones');
assert(gripReport.visualBake?.maxPositionErrorMetres < 0.00001);
assert(gripReport.visualBake?.maxRotationErrorDegrees < 0.01);
const gripGlb = parseGlb(runtimeFile(grip.file));
assert.deepStrictEqual({ vertices: gripGlb.vertices, triangles: gripGlb.triangles }, { vertices: 3, triangles: 1 });
assert.strictEqual(gripGlb.json.meshes?.length, 1);
assert.strictEqual(gripGlb.json.skins?.length, 1);
assert.strictEqual(gripGlb.json.skins[0].joints?.length, 65);
assert.deepStrictEqual((gripGlb.json.animations || []).map(animation => animation.name), ['assault_rifle_grip']);
assert.strictEqual(gripGlb.json.animations[0].channels?.length, 195);
const gripChannelCounts = (gripGlb.json.animations[0].channels || []).reduce((counts, channel) => {
  const property = String(channel.target?.path || '');
  counts[property] = Number(counts[property] || 0) + 1;
  return counts;
}, {});
assert.deepStrictEqual(gripChannelCounts, { translation: 65, rotation: 65, scale: 65 });
const gripNames = new Set((gripGlb.json.nodes || []).map(node => node.name));
['approved_assault_rifle_mount', 'hand_l', 'hand_r', 'thumb_01_l'].forEach(name => (
  assert(gripNames.has(name), `approved grip node is missing: ${name}`)
));

const runtimeSource = fs.readFileSync(
  path.join(ROOT, 'public', 'js', 'game', '04d_approved_humanoid_assets_runtime.js'),
  'utf8'
);
[
  "const APPROVED_HUMANOID_ASSET_VERSION = '7.76.6-approved-humanoid-assets-v13-weapon-interactions'",
  'const APPROVED_EQUIPMENT_ASSETS = Object.freeze({',
  'const APPROVED_ASSAULT_RIFLE_GRIP_BONES = Object.freeze([',
  'function attachApprovedNpcAnimations(runtime)',
  'const sourceMeshes = []',
  "mesh.name = `approved_equipment_${itemId}_${sourceMesh.material?.name || group.children.length}`",
  'new THREE.Skeleton(',
  'function applyApprovedEquipmentVisuals(actor, eq = {})',
  'const APPROVED_BACKPACK_ARMOR_OFFSETS = Object.freeze({',
  'function approvedBackpackArmorOffset(eq = {})',
  'function placeApprovedEquipmentRuntime(group, slot = \'\', eq = {})',
  'function applyApprovedBootsVisual(actor, eq = {})',
  'function compileApprovedGripPose(gltf)',
  'function captureApprovedAssaultRifleRestPose(root)',
  'function approvedGripTargetTransform(runtime, pose, boneName, transform)',
  'function restoreApprovedWeaponGrip(actor)',
  'primaryHand.matrixWorld.clone().multiply(pose.primaryHandToMount)',
  "function solveApprovedArm(characterRoot, side = 'l', targetMatrix)",
  "const suffix = side === 'r' ? 'r' : 'l'",
  'function solveApprovedSupportArm(characterRoot, targetMatrix)',
  'const APPROVED_FIREARM_GRIP_PROFILES = Object.freeze({',
  'function mountApprovedWeapon(actor, pose, weaponId = \'\')',
  'function approvedWeaponSupportTarget(actor, weaponGroup, pose, profile)',
  'function applyApprovedWeaponGrip(actor, weaponId = \'\')',
  'function applyApprovedAssaultRifleGrip(actor, weaponId = \'\')',
  "characterRuntime.currentAction === 'death'",
  'return !!mountApprovedWeapon(actor, pose, id)',
  'weaponGroup.parent !== runtime.root',
  'bone.quaternion.copy(target.quaternion)'
].forEach(marker => assert(runtimeSource.includes(marker), `approved humanoid runtime marker is missing: ${marker}`));

const characterSource = fs.readFileSync(path.join(ROOT, 'public', 'js', 'game', '04b_character_glb_runtime.js'), 'utf8');
assert(characterSource.includes("state.dead && runtime.actions?.death"));
assert(characterSource.includes("options.npcAnimations && typeof attachApprovedNpcAnimations === 'function'"));
assert(characterSource.includes("typeof applyApprovedEquipmentVisuals === 'function'"));
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

  const skinnedMeshBounds = mesh => {
    assert(mesh?.isSkinnedMesh && mesh.skeleton, 'cannot measure a missing skinned mesh');
    const box = new THREE.Box3().makeEmpty();
    const vertex = new THREE.Vector3();
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let index = 0; index < mesh.geometry.attributes.position.count; index += 1) {
      vertex.fromBufferAttribute(mesh.geometry.attributes.position, index);
      mesh.boneTransform(index, vertex);
      box.expandByPoint(vertex.applyMatrix4(mesh.matrixWorld));
    }
    return box;
  };

  const setBoneWorldQuaternion = (bone, worldQuaternion) => {
    const parentQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
  };

  const solveSupportArm = (root, targetMatrix) => {
    const chain = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l'].map(name => (
      root.getObjectByName(name)
    ));
    assert(chain.every(bone => bone?.isBone), 'support-arm IK chain is incomplete');
    chain[0].updateWorldMatrix(true, true);
    const positions = chain.map(bone => bone.getWorldPosition(new THREE.Vector3()));
    const base = positions[0].clone();
    const lengths = positions.slice(0, -1).map((position, index) => (
      position.distanceTo(positions[index + 1])
    ));
    const targetPosition = new THREE.Vector3();
    const targetQuaternion = new THREE.Quaternion();
    targetMatrix.decompose(targetPosition, targetQuaternion, new THREE.Vector3());
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    if (base.distanceTo(targetPosition) >= totalLength) {
      const direction = targetPosition.clone().sub(base).normalize();
      for (let index = 1; index < positions.length; index += 1) {
        positions[index] = positions[index - 1].clone().addScaledVector(direction, lengths[index - 1]);
      }
    } else {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        positions[positions.length - 1] = targetPosition.clone();
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          const direction = positions[index].clone().sub(positions[index + 1]).normalize();
          positions[index] = positions[index + 1].clone().addScaledVector(direction, lengths[index]);
        }
        positions[0] = base.clone();
        for (let index = 1; index < positions.length; index += 1) {
          const direction = positions[index].clone().sub(positions[index - 1]).normalize();
          positions[index] = positions[index - 1].clone().addScaledVector(direction, lengths[index - 1]);
        }
        if (positions[positions.length - 1].distanceTo(targetPosition) < 0.001) break;
      }
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].updateWorldMatrix(true, true);
      const currentStart = chain[index].getWorldPosition(new THREE.Vector3());
      const currentEnd = chain[index + 1].getWorldPosition(new THREE.Vector3());
      const currentDirection = currentEnd.sub(currentStart).normalize();
      const wantedDirection = positions[index + 1].clone().sub(positions[index]).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(currentDirection, wantedDirection);
      setBoneWorldQuaternion(
        chain[index],
        delta.multiply(chain[index].getWorldQuaternion(new THREE.Quaternion()))
      );
    }
    setBoneWorldQuaternion(chain[chain.length - 1], targetQuaternion);
    chain[0].updateWorldMatrix(true, true);
    return chain[chain.length - 1].getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition);
  };

  const skinComponent = ['getX', 'getY', 'getZ', 'getW'];
  const footVertexIndices = (mesh, side) => {
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    const footBones = new Set([`foot_${side}`, `ball_${side}`, `ball_leaf_${side}`]);
    const indices = [];
    for (let vertexIndex = 0; vertexIndex < mesh.geometry.attributes.position.count; vertexIndex += 1) {
      let footWeight = 0;
      for (let component = 0; component < 4; component += 1) {
        const boneIndex = skinIndex[skinComponent[component]](vertexIndex);
        if (footBones.has(mesh.skeleton.bones[boneIndex]?.name)) {
          footWeight += skinWeight[skinComponent[component]](vertexIndex);
        }
      }
      if (footWeight > 0.5) indices.push(vertexIndex);
    }
    return indices;
  };
  const skinnedMinimumY = (mesh, indices) => {
    const vertex = new THREE.Vector3();
    let minimum = Infinity;
    for (const vertexIndex of indices) {
      vertex.fromBufferAttribute(mesh.geometry.attributes.position, vertexIndex);
      mesh.boneTransform(vertexIndex, vertex);
      minimum = Math.min(minimum, vertex.applyMatrix4(mesh.matrixWorld).y);
    }
    return minimum;
  };

  for (const bodyId of BODY_IDS) {
    const character = await load(path.join(
      ROOT, 'public', 'assets', 'models', 'characters', 'base', `character_${bodyId}.glb`
    ));
    const bodyMesh = character.scene.getObjectByName('body_base');
    assert(bodyMesh?.isSkinnedMesh, `${bodyId}: current character body mesh is missing`);
    const boots = await load(runtimeFile(byId.get(`boots_${bodyId}`).file));
    boots.scene.updateMatrixWorld(true);
    const bootMeshes = [];
    boots.scene.traverse(node => {
      if (node?.isSkinnedMesh && node.skeleton) bootMeshes.push(node);
    });
    assert.strictEqual(bootMeshes.length, 4, `${bodyId}: boots must expose all four skinned material parts`);
    assert.deepStrictEqual(
      bootMeshes.map(mesh => String(mesh.material?.name || '')).sort(),
      ['boots_aged_hardware', 'boots_dusty_canvas', 'boots_rubberized_sole', 'boots_weathered_leather']
    );
    assert.strictEqual(
      bootMeshes.reduce((total, mesh) => total + mesh.geometry.attributes.position.count, 0),
      2532,
      `${bodyId}: Three.js must retain every approved boot vertex`
    );
    const instances = bootMeshes.map(bootMesh => {
      const targetBones = bootMesh.skeleton.bones.map(bone => character.scene.getObjectByName(bone.name));
      assert.strictEqual(targetBones.length, 65);
      assert(targetBones.every(Boolean), `${bodyId}: boots cannot resolve every current character bone`);
      const instance = new THREE.SkinnedMesh(bootMesh.geometry, bootMesh.material);
      bootMesh.matrixWorld.decompose(instance.position, instance.quaternion, instance.scale);
      instance.bindMode = bootMesh.bindMode;
      instance.bind(
        new THREE.Skeleton(
          targetBones,
          bootMesh.skeleton.boneInverses.map(matrix => matrix.clone())
        ),
        bootMesh.bindMatrix.clone()
      );
      character.scene.add(instance);
      assert(instance.skeleton.bones.every(bone => character.scene.getObjectByName(bone.name) === bone));
      return instance;
    });
    const sole = instances.find(instance => instance.material?.name === 'boots_rubberized_sole');
    assert(sole, `${bodyId}: rubberized sole is missing from the runtime instance`);
    const bodyFootVertices = Object.fromEntries(['l', 'r'].map(side => (
      [side, footVertexIndices(bodyMesh, side)]
    )));
    const soleVertices = Object.fromEntries(['l', 'r'].map(side => (
      [side, footVertexIndices(sole, side)]
    )));
    assert(Object.values(bodyFootVertices).every(indices => indices.length > 0));
    assert(Object.values(soleVertices).every(indices => indices.length > 0));
    for (const clipName of ['walk', 'run']) {
      const clip = character.animations.find(animation => animation.name === clipName);
      assert(clip, `${bodyId}: current character has no ${clipName} animation`);
      const mixer = new THREE.AnimationMixer(character.scene);
      mixer.clipAction(clip).play();
      for (let sample = 0; sample <= 48; sample += 1) {
        mixer.setTime(clip.duration * sample / 48);
        character.scene.updateMatrixWorld(true);
        bodyMesh.skeleton.update();
        instances.forEach(instance => instance.skeleton.update());
        for (const side of ['l', 'r']) {
          const clearance = skinnedMinimumY(bodyMesh, bodyFootVertices[side])
            - skinnedMinimumY(sole, soleVertices[side]);
          assert(
            clearance >= 0.008,
            `${bodyId}: ${side} foot pierces the sole in ${clipName} sample ${sample}: ${clearance}`
          );
        }
      }
      mixer.stopAllAction();
    }

    for (const definition of APPROVED_EQUIPMENT_REVIEWS) {
      const runtimeAssetId = `${definition.itemId}_${bodyId}`;
      const equipment = await load(runtimeFile(byId.get(runtimeAssetId).file));
      const equipmentJson = parseGlb(runtimeFile(byId.get(runtimeAssetId).file)).json;
      const expectedSkinnedMeshes = (equipmentJson.meshes || []).reduce((total, mesh) => (
        total + (mesh.primitives || []).length
      ), 0);
      equipment.scene.updateMatrixWorld(true);
      const sourceMeshes = [];
      equipment.scene.traverse(node => {
        if (node?.isSkinnedMesh && node.skeleton) sourceMeshes.push(node);
      });
      assert.strictEqual(
        sourceMeshes.length,
        expectedSkinnedMeshes,
        `${runtimeAssetId}: Three.js cannot resolve every skinned mesh`
      );
      const group = new THREE.Group();
      for (const sourceMesh of sourceMeshes) {
        const targetBones = sourceMesh.skeleton.bones.map(bone => character.scene.getObjectByName(bone.name));
        assert.strictEqual(targetBones.length, 65, `${runtimeAssetId}: current rig must expose 65 bones`);
        assert(targetBones.every(Boolean), `${runtimeAssetId}: cannot resolve every current character bone`);
        const instance = new THREE.SkinnedMesh(sourceMesh.geometry, sourceMesh.material);
        sourceMesh.matrixWorld.decompose(instance.position, instance.quaternion, instance.scale);
        instance.bindMode = sourceMesh.bindMode;
        instance.bind(
          new THREE.Skeleton(
            targetBones,
            sourceMesh.skeleton.boneInverses.map(matrix => matrix.clone())
          ),
          sourceMesh.bindMatrix.clone()
        );
        instance.normalizeSkinWeights();
        group.add(instance);
      }
      character.scene.add(group);
      character.scene.updateMatrixWorld(true);
      const equipmentBounds = new THREE.Box3().makeEmpty();
      group.children.forEach(mesh => equipmentBounds.union(skinnedMeshBounds(mesh)));
      const equipmentSize = equipmentBounds.getSize(new THREE.Vector3());
      assert(
        equipmentSize.toArray().every(value => Number.isFinite(value) && value > 0 && value < 5),
        `${runtimeAssetId}: bound runtime equipment has invalid bounds: ${equipmentSize.toArray()}`
      );
      if (
        ['metalArmor', 'ballisticVest', 'combatArmor', 'heavyArmor', 'backpack'].includes(definition.itemId)
        || definition.slot === 'boots'
      ) {
        const equipmentSole = definition.slot === 'boots'
          ? group.children.find(mesh => String(mesh.material?.name || '') === (
            definition.itemId === 'scoutBoots'
              ? 'scout_boots_flexible_black_rubber'
              : 'boots_rubberized_sole'
          ))
          : null;
        const equipmentSoleVertices = equipmentSole
          ? Object.fromEntries(['l', 'r'].map(side => [side, footVertexIndices(equipmentSole, side)]))
          : null;
        if (definition.slot === 'boots') {
          assert(equipmentSole, `${runtimeAssetId}: animated sole material is missing`);
          assert(Object.values(equipmentSoleVertices).every(indices => indices.length > 0));
        }
        for (const clipName of ['walk', 'run']) {
          const clip = character.animations.find(animation => animation.name === clipName);
          assert(clip, `${bodyId}: current character has no ${clipName} animation`);
          const mixer = new THREE.AnimationMixer(character.scene);
          mixer.clipAction(clip).play();
          for (let sample = 0; sample <= 24; sample += 1) {
            mixer.setTime(clip.duration * sample / 24);
            character.scene.updateMatrixWorld(true);
            bodyMesh.skeleton.update();
            group.children.forEach(mesh => mesh.skeleton.update());
            const animatedBounds = new THREE.Box3().makeEmpty();
            group.children.forEach(mesh => animatedBounds.union(skinnedMeshBounds(mesh)));
            const animatedSize = animatedBounds.getSize(new THREE.Vector3());
            const armorCenter = animatedBounds.getCenter(new THREE.Vector3());
            const bodyCenter = skinnedMeshBounds(bodyMesh).getCenter(new THREE.Vector3());
            const centerTolerance = definition.itemId === 'backpack'
              ? { x: 0.45, y: 0.7, z: 0.9 }
              : (definition.slot === 'boots'
                ? { x: 0.45, y: 1.0, z: 0.45 }
                : { x: 0.45, y: 0.45, z: 0.75 });
            assert(
              animatedSize.toArray().every(value => Number.isFinite(value) && value > 0 && value < 2),
              `${runtimeAssetId}: ${clipName} sample ${sample} has exploded armor bounds`
            );
            assert(
              Math.abs(armorCenter.x - bodyCenter.x) < centerTolerance.x
                && Math.abs(armorCenter.y - bodyCenter.y) < centerTolerance.y
                && Math.abs(armorCenter.z - bodyCenter.z) < centerTolerance.z,
              `${runtimeAssetId}: ${clipName} sample ${sample} detached from the animated body: `
                + `equipment=${armorCenter.toArray()}, body=${bodyCenter.toArray()}`
            );
            if (equipmentSole) {
              for (const side of ['l', 'r']) {
                const clearance = skinnedMinimumY(bodyMesh, bodyFootVertices[side])
                  - skinnedMinimumY(equipmentSole, equipmentSoleVertices[side]);
                assert(
                  clearance >= 0.008,
                  `${runtimeAssetId}: ${side} foot pierces the sole in ${clipName} sample ${sample}: ${clearance}`
                );
              }
            }
          }
          mixer.stopAllAction();
        }
      }
      character.scene.remove(group);
    }
  }

  const gripRuntime = await load(runtimeFile(grip.file));
  const gripClip = gripRuntime.animations.find(clip => clip.name === 'assault_rifle_grip');
  assert(gripClip, 'Three.js cannot read the approved assault-rifle grip clip');
  assert.strictEqual(gripClip.tracks.length, 195);
  assert.deepStrictEqual(
    gripClip.tracks.reduce((counts, track) => {
      const property = track.name.slice(track.name.lastIndexOf('.') + 1);
      counts[property] = Number(counts[property] || 0) + 1;
      return counts;
    }, {}),
    { position: 65, quaternion: 65, scale: 65 }
  );
  const handTrack = gripClip.tracks.find(track => track.name === 'hand_l.quaternion');
  assert(handTrack, 'approved support-hand quaternion track is missing');
  const handQuaternion = Array.from(handTrack.createInterpolant().evaluate(gripClip.duration * 0.5));
  assert.strictEqual(handQuaternion.length, 4);
  assert(Math.abs(Math.hypot(...handQuaternion) - 1) < 0.001, 'approved support-hand quaternion is invalid');
  const gripSampleTime = gripClip.duration * 0.5;
  const donorRest = new Map();
  for (const boneName of gripBoneNames) {
    const bone = gripRuntime.scene.getObjectByName(boneName);
    assert(bone?.isBone, `approved grip donor bone is missing: ${boneName}`);
    donorRest.set(boneName, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone()
    });
  }
  gripClip.tracks.filter(track => track.name.endsWith('.position')).forEach(track => {
    const boneName = track.name.slice(0, -'.position'.length);
    if (!gripBoneNames.has(boneName)) return;
    const bone = gripRuntime.scene.getObjectByName(boneName);
    const position = new THREE.Vector3().fromArray(Array.from(
      track.createInterpolant().evaluate(gripSampleTime)
    ));
    const limit = boneName === 'thumb_01_l' ? 0.03 : 0.002;
    assert(bone?.isBone && position.distanceTo(bone.position) <= limit,
      `approved grip contains an unsafe bone translation: ${boneName}`);
  });
  gripClip.tracks.filter(track => track.name.endsWith('.scale')).forEach(track => {
    const boneName = track.name.slice(0, -'.scale'.length);
    if (!gripBoneNames.has(boneName)) return;
    const bone = gripRuntime.scene.getObjectByName(boneName);
    const scale = new THREE.Vector3().fromArray(Array.from(
      track.createInterpolant().evaluate(gripSampleTime)
    ));
    assert(bone?.isBone && scale.distanceTo(bone.scale) <= 0.002,
      `approved grip contains an unsafe bone scale: ${boneName}`);
  });
  const mount = gripRuntime.scene.getObjectByName('approved_assault_rifle_mount');
  assert(mount, 'Three.js cannot resolve the approved rifle mount');
  assert(Math.abs(mount.position.y - 1.3562635) < 0.0001, 'approved shoulder mount drifted');
  const donorPoseMixer = new THREE.AnimationMixer(gripRuntime.scene);
  donorPoseMixer.clipAction(gripClip).play();
  donorPoseMixer.update(gripSampleTime);
  gripRuntime.scene.updateMatrixWorld(true);
  const donorPrimaryHand = gripRuntime.scene.getObjectByName('hand_r');
  const donorSupportHand = gripRuntime.scene.getObjectByName('hand_l');
  const primaryHandToMount = donorPrimaryHand.matrixWorld.clone().invert().multiply(mount.matrixWorld);
  const mountToSupportHand = mount.matrixWorld.clone().invert().multiply(donorSupportHand.matrixWorld);
  for (const bodyId of BODY_IDS) {
    const posedCharacter = await load(path.join(
      ROOT, 'public', 'assets', 'models', 'characters', 'base', `character_${bodyId}.glb`
    ));
    const bodyMesh = posedCharacter.scene.getObjectByName('body_base');
    assert(bodyMesh?.isSkinnedMesh, `${bodyId}: current character body mesh is missing`);
    gripClip.tracks.forEach(track => {
      const dot = track.name.lastIndexOf('.');
      const boneName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (!gripBoneNames.has(boneName)) return;
      const targetBone = posedCharacter.scene.getObjectByName(boneName);
      const rest = donorRest.get(boneName);
      assert(targetBone?.isBone && rest, `${bodyId}: grip bone is missing: ${boneName}`);
      const value = Array.from(track.createInterpolant().evaluate(gripSampleTime));
      if (property === 'quaternion') {
        const poseQuaternion = new THREE.Quaternion().fromArray(value).normalize();
        const delta = rest.quaternion.clone().invert().multiply(poseQuaternion);
        targetBone.quaternion.multiply(delta).normalize();
      }
      if (property === 'position' && boneName === 'thumb_01_l') {
        targetBone.position.add(new THREE.Vector3().fromArray(value).sub(rest.position));
      }
    });
    posedCharacter.scene.updateMatrixWorld(true);
    const primaryHand = posedCharacter.scene.getObjectByName('hand_r');
    const mountWorld = primaryHand.matrixWorld.clone().multiply(primaryHandToMount);
    const rifleInstance = await load(runtimeFile(rifle.file));
    const mountLocal = posedCharacter.scene.matrixWorld.clone().invert().multiply(mountWorld);
    mountLocal.decompose(rifleInstance.scene.position, rifleInstance.scene.quaternion, rifleInstance.scene.scale);
    posedCharacter.scene.add(rifleInstance.scene);
    posedCharacter.scene.updateMatrixWorld(true);
    const supportTarget = mountWorld.clone().multiply(mountToSupportHand);
    const supportError = solveSupportArm(posedCharacter.scene, supportTarget);
    posedCharacter.scene.updateMatrixWorld(true);
    assert(supportError < 0.01, `${bodyId}: support hand misses the approved IK target: ${supportError}`);
    for (const side of ['l', 'r']) {
      const hand = posedCharacter.scene.getObjectByName(`hand_${side}`);
      const socket = rifleInstance.scene.getObjectByName(`socket_grip_${side}`);
      const distance = hand.getWorldPosition(new THREE.Vector3())
        .distanceTo(socket.getWorldPosition(new THREE.Vector3()));
      assert(distance >= 0.045 && distance <= 0.075,
        `${bodyId}: ${side} palm does not wrap its rifle socket: ${distance}`);
    }
    const size = skinnedMeshBounds(bodyMesh).getSize(new THREE.Vector3());
    assert(size.y >= 1.6 && size.y <= 2.1 && size.x <= 1 && size.z <= 1,
      `${bodyId}: assault-rifle grip tears the character mesh: ${size.toArray()}`);
  }

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
    + `${APPROVED_EQUIPMENT_REVIEWS.length * BODY_IDS.length} fitted equipment models, `
    + `1 assault rifle and 1 exact grip pose`
  );
}

verifyThreeRuntime().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
