#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BODY_IDS = Object.freeze([
  'female_slim', 'female_medium', 'female_large',
  'male_slim', 'male_medium', 'male_large'
]);
const FIREARMS = Object.freeze({
  pistol: { reloadPart: 'magazine', reloadRotation: [0.05, -0.25, -1.0] },
  rifle: { reloadPart: 'cartridge_clip', reloadRotation: [-0.55, 0.05, -0.25] },
  assaultRifle: { reloadPart: 'magazine', reloadRotation: [0.05, -0.25, -0.9] },
  machineGun: { reloadPart: 'ammo_box', reloadRotation: [-0.15, -0.35, -0.55] },
  laserPistol: { reloadPart: 'energy_core', reloadRotation: [0.0, -0.4, -0.85] },
  flamethrower: { reloadPart: 'fuel_tank', reloadRotation: [-0.3, -0.15, -0.65] },
  plasmaRifle: { reloadPart: 'energy_core', reloadRotation: [-0.2, -0.5, -0.55] },
  shotgun: { reloadPart: 'reload_shell', reloadRotation: [-0.55, 0.0, -0.35] },
  rocketLauncher: { reloadPart: 'rocket_round', reloadRotation: [-0.15, -0.55, -0.4] }
});
const MELEE_WEAPONS = Object.freeze({
  knife: {
    twoHanded: false,
    sourceAxis: [0, 1, 0],
    roll: -0.18,
    poses: {
      idle: { primary: [-0.27, 1.22, 0.24], direction: [0.04, 0.02, 1] },
      windup: { primary: [-0.34, 1.40, 0.08], direction: [0.12, 0.42, -0.90] },
      strike: { primary: [-0.16, 1.18, 0.56], direction: [0.02, -0.05, 1] }
    }
  },
  pickaxe: {
    twoHanded: true,
    supportRotation: [0.06, 0.02, 0.12],
    roll: 0.12,
    poses: {
      idle: { primary: [-0.22, 1.18, 0.22], direction: [0.95, 0.29, 0.08] },
      windup: { primary: [-0.31, 1.47, 0.05], direction: [0.76, 0.64, -0.08] },
      strike: { primary: [-0.22, 1.04, 0.53], direction: [0.98, 0.14, 0.03] }
    }
  },
  axe: {
    twoHanded: true,
    supportRotation: [0.06, 0.02, 0.12],
    roll: 0.24,
    poses: {
      idle: { primary: [-0.21, 1.18, 0.23], direction: [0.95, 0.29, 0.08] },
      windup: { primary: [-0.30, 1.46, 0.06], direction: [0.76, 0.64, -0.08] },
      strike: { primary: [-0.21, 1.05, 0.52], direction: [0.98, 0.14, 0.03] }
    }
  },
  handPump: {
    twoHanded: true,
    supportRotation: [0.10, -0.04, 0.18],
    roll: -0.08,
    poses: {
      idle: { primary: [-0.20, 1.18, 0.24], direction: [0.94, 0.31, 0.11] },
      windup: { primary: [-0.28, 1.43, 0.08], direction: [0.74, 0.66, -0.10] },
      strike: { primary: [-0.20, 1.07, 0.49], direction: [0.97, 0.20, 0.05] }
    }
  }
});
const ASSAULT_PRIMARY_SOCKET = Object.freeze([0.03, -0.02, 0.025]);
const ASSAULT_SUPPORT_SOCKET = Object.freeze([-0.01, 0.105, -0.33]);

async function main() {
  const runtimeSource = fs.readFileSync(path.join(
    ROOT, 'public', 'js', 'game', '04d_approved_humanoid_assets_runtime.js'
  ), 'utf8');
  [
    'APPROVED_MELEE_GRIP_PROFILES',
    'applyApprovedMeleeGrip',
    'approvedMeleePrimaryHandTarget',
    "solveApprovedArm(characterRuntime.root, 'r', primaryTarget)",
    "solveApprovedArm(characterRuntime.root, 'l', supportTarget)"
  ].forEach(marker => assert(runtimeSource.includes(marker), `melee runtime marker is missing: ${marker}`));
  Object.keys(MELEE_WEAPONS).forEach(id => {
    assert(runtimeSource.includes(`${id}: Object.freeze({`), `melee runtime profile is missing: ${id}`);
  });
  const visualSource = fs.readFileSync(path.join(
    ROOT, 'public', 'js', 'game', '04_player_model_visuals.js'
  ), 'utf8');
  assert(
    visualSource.includes('approvedPhysicalMeleeGripActive'),
    'legacy procedural melee animation still lacks the physical GLB grip gate'
  );
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
  const modelFile = relative => path.join(ROOT, 'public', 'assets', 'models', relative);
  const gripReport = JSON.parse(fs.readFileSync(path.join(
    ROOT, 'docs', 'art', 'reviews', 'unified-style-v5', 'rifle',
    'assault_rifle_grip_runtime-report.json'
  ), 'utf8'));
  const gripBoneNames = new Set(gripReport.gripBones || []);
  assert.strictEqual(gripBoneNames.size, 41, 'approved donor must provide 41 grip bones');
  const gripRuntime = await load(modelFile('weapons/approved_assault_rifle_grip.glb'));
  const gripClip = gripRuntime.animations.find(clip => clip.name === 'assault_rifle_grip');
  const mount = gripRuntime.scene.getObjectByName('approved_assault_rifle_mount');
  assert(gripClip && mount, 'approved grip clip or mount is missing');
  const sampleTime = gripClip.duration * 0.5;
  const donorRest = new Map();
  for (const boneName of gripBoneNames) {
    const bone = gripRuntime.scene.getObjectByName(boneName);
    assert(bone?.isBone, `approved donor bone is missing: ${boneName}`);
    donorRest.set(boneName, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone()
    });
  }
  const donorMixer = new THREE.AnimationMixer(gripRuntime.scene);
  donorMixer.clipAction(gripClip).play();
  donorMixer.update(sampleTime);
  gripRuntime.scene.updateMatrixWorld(true);
  const donorPrimaryHand = gripRuntime.scene.getObjectByName('hand_r');
  const donorSupportHand = gripRuntime.scene.getObjectByName('hand_l');
  const primaryHandToMount = donorPrimaryHand.matrixWorld.clone().invert().multiply(mount.matrixWorld);
  const mountToSupport = mount.matrixWorld.clone().invert().multiply(donorSupportHand.matrixWorld);
  const supportPosition = new THREE.Vector3();
  const supportQuaternion = new THREE.Quaternion();
  mountToSupport.decompose(supportPosition, supportQuaternion, new THREE.Vector3());
  const supportOffset = supportPosition.clone().sub(new THREE.Vector3().fromArray(ASSAULT_SUPPORT_SOCKET));

  const weaponTemplates = new Map();
  for (const id of [...Object.keys(FIREARMS), ...Object.keys(MELEE_WEAPONS)]) {
    weaponTemplates.set(id, await load(modelFile(`weapons/weapon_${id}.glb`)));
  }

  function captureBones(root) {
    const state = new Map();
    root.traverse(node => {
      if (!node?.isBone) return;
      state.set(node.name, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone()
      });
    });
    return state;
  }

  function restoreBones(root, state) {
    state.forEach((transform, name) => {
      const bone = root.getObjectByName(name);
      if (!bone?.isBone) return;
      bone.position.copy(transform.position);
      bone.quaternion.copy(transform.quaternion);
      bone.scale.copy(transform.scale);
    });
    root.updateMatrixWorld(true);
  }

  function applyGripPose(root) {
    for (const track of gripClip.tracks) {
      const dot = track.name.lastIndexOf('.');
      if (dot <= 0) continue;
      const boneName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (!gripBoneNames.has(boneName)) continue;
      const bone = root.getObjectByName(boneName);
      const rest = donorRest.get(boneName);
      assert(bone?.isBone && rest, `target grip bone is missing: ${boneName}`);
      const value = Array.from(track.createInterpolant().evaluate(sampleTime));
      if (property === 'quaternion') {
        const posed = new THREE.Quaternion().fromArray(value).normalize();
        const delta = rest.quaternion.clone().invert().multiply(posed);
        bone.quaternion.multiply(delta).normalize();
      } else if (property === 'position' && boneName === 'thumb_01_l') {
        bone.position.add(new THREE.Vector3().fromArray(value).sub(rest.position));
      }
    }
    root.updateMatrixWorld(true);
  }

  function setBoneWorldQuaternion(bone, worldQuaternion) {
    if (!bone?.isBone || !bone.parent) return false;
    const parentQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  function solveArm(root, side, targetMatrix) {
    const suffix = side === 'r' ? 'r' : 'l';
    const chain = [`clavicle_${suffix}`, `upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`]
      .map(name => root.getObjectByName(name));
    assert(chain.every(bone => bone?.isBone), 'support-arm chain is incomplete');
    chain[0].updateWorldMatrix(true, true);
    const positions = chain.map(bone => bone.getWorldPosition(new THREE.Vector3()));
    const base = positions[0].clone();
    const lengths = positions.slice(0, -1).map((position, index) => position.distanceTo(positions[index + 1]));
    const targetPosition = new THREE.Vector3();
    const targetQuaternion = new THREE.Quaternion();
    targetMatrix.decompose(targetPosition, targetQuaternion, new THREE.Vector3());
    const reach = lengths.reduce((sum, length) => sum + length, 0);
    if (base.distanceTo(targetPosition) >= reach - 0.0001) {
      const direction = targetPosition.clone().sub(base).normalize();
      positions[0].copy(base);
      for (let index = 1; index < positions.length; index += 1) {
        positions[index] = positions[index - 1].clone().addScaledVector(direction, lengths[index - 1]);
      }
    } else {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        positions[positions.length - 1].copy(targetPosition);
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          const direction = positions[index].clone().sub(positions[index + 1]).normalize();
          positions[index] = positions[index + 1].clone().addScaledVector(direction, lengths[index]);
        }
        positions[0].copy(base);
        for (let index = 1; index < positions.length; index += 1) {
          const direction = positions[index].clone().sub(positions[index - 1]).normalize();
          positions[index] = positions[index - 1].clone().addScaledVector(direction, lengths[index - 1]);
        }
        if (positions[positions.length - 1].distanceTo(targetPosition) < 0.001) break;
      }
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].updateWorldMatrix(true, true);
      const start = chain[index].getWorldPosition(new THREE.Vector3());
      const currentDirection = chain[index + 1].getWorldPosition(new THREE.Vector3()).sub(start).normalize();
      const wantedDirection = positions[index + 1].clone().sub(positions[index]).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(currentDirection, wantedDirection);
      const currentWorld = chain[index].getWorldQuaternion(new THREE.Quaternion());
      assert(setBoneWorldQuaternion(chain[index], delta.multiply(currentWorld)), 'cannot rotate support-arm bone');
    }
    assert(setBoneWorldQuaternion(chain[chain.length - 1], targetQuaternion), 'cannot orient support hand');
    root.updateMatrixWorld(true);
    return chain[chain.length - 1].getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition);
  }

  function solveSupportArm(root, targetMatrix) {
    return solveArm(root, 'l', targetMatrix);
  }

  function objectLocalPose(group, object) {
    group.updateMatrixWorld(true);
    object.updateWorldMatrix(true, false);
    const matrix = group.matrixWorld.clone().invert().multiply(object.matrixWorld);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    matrix.decompose(position, quaternion, new THREE.Vector3());
    return { position, quaternion };
  }

  function mountWeapon(character, wrapper) {
    character.updateMatrixWorld(true);
    const hand = character.getObjectByName('hand_r');
    const socket = wrapper.getObjectByName('socket_grip_r');
    assert(hand?.isBone && socket, 'primary hand or grip socket is missing');
    const mountWorld = hand.matrixWorld.clone().multiply(primaryHandToMount);
    const primaryTarget = mountWorld.clone().multiply(
      new THREE.Matrix4().makeTranslation(...ASSAULT_PRIMARY_SOCKET)
    );
    const local = objectLocalPose(wrapper, socket);
    const source = new THREE.Matrix4().compose(local.position, local.quaternion, new THREE.Vector3(1, 1, 1));
    const weaponWorld = primaryTarget.clone().multiply(source.invert());
    if (wrapper.parent !== character) character.add(wrapper);
    const localWorld = character.matrixWorld.clone().invert().multiply(weaponWorld);
    localWorld.decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
    wrapper.updateMatrixWorld(true);
    const socketError = socket.getWorldPosition(new THREE.Vector3()).distanceTo(
      new THREE.Vector3().setFromMatrixPosition(primaryTarget)
    );
    return { mountWorld, socketError };
  }

  function handTarget(wrapper, object, rotation = null, grip = false) {
    const local = objectLocalPose(wrapper, object);
    if (grip) local.position.add(supportOffset);
    const quaternion = supportQuaternion.clone();
    if (rotation) quaternion.multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')
    ));
    return wrapper.matrixWorld.clone().multiply(new THREE.Matrix4().compose(
      local.position,
      quaternion,
      new THREE.Vector3(1, 1, 1)
    ));
  }

  function relativePartPosition(wrapper, part, socket) {
    wrapper.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(
      socket.matrixWorld.clone().invert().multiply(part.matrixWorld)
    );
  }

  function meleeVector(value, fallback = [0, 0, 0]) {
    const source = Array.isArray(value) && value.length === 3 ? value : fallback;
    return new THREE.Vector3(source[0], source[1], source[2]);
  }

  function placeMeleeWeapon(character, wrapper, profile, requestedPose) {
    const primarySocket = wrapper.getObjectByName('socket_grip_r');
    const supportSocket = profile.twoHanded ? wrapper.getObjectByName('socket_grip_l') : null;
    assert(primarySocket, 'melee primary socket is missing');
    if (profile.twoHanded) assert(supportSocket, 'melee support socket is missing');
    const primaryLocal = objectLocalPose(wrapper, primarySocket);
    const supportLocal = supportSocket ? objectLocalPose(wrapper, supportSocket) : null;
    const sourceDirection = supportLocal
      ? supportLocal.position.clone().sub(primaryLocal.position)
      : meleeVector(profile.sourceAxis, [0, 1, 0]);
    sourceDirection.normalize();
    const direction = meleeVector(requestedPose.direction, [0, 0, 1]).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(sourceDirection, direction);
    if (Math.abs(Number(profile.roll || 0)) > 0.0001) {
      quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(direction, Number(profile.roll)));
    }
    const primary = meleeVector(requestedPose.primary);
    wrapper.position.copy(primary.sub(primaryLocal.position.clone().applyQuaternion(quaternion)));
    wrapper.quaternion.copy(quaternion);
    wrapper.scale.set(1, 1, 1);
    if (wrapper.parent !== character) character.add(wrapper);
    wrapper.updateMatrixWorld(true);
    return { primarySocket, supportSocket };
  }

  function meleePrimaryHandTarget(primarySocket) {
    primarySocket.updateWorldMatrix(true, false);
    const handToSocket = primaryHandToMount.clone().multiply(
      new THREE.Matrix4().makeTranslation(...ASSAULT_PRIMARY_SOCKET)
    );
    return primarySocket.matrixWorld.clone().multiply(handToSocket.invert());
  }

  function assertBoneScales(root, restBones, context) {
    restBones.forEach((transform, name) => {
      const bone = root.getObjectByName(name);
      if (!bone?.isBone) return;
      assert(
        bone.scale.distanceTo(transform.scale) < 0.000001,
        `${context}: bone scale changed (${name})`
      );
    });
  }

  let restChecks = 0;
  let reloadChecks = 0;
  let meleePrimaryChecks = 0;
  let meleeSupportChecks = 0;
  for (const bodyId of BODY_IDS) {
    const character = await load(modelFile(`characters/base/character_${bodyId}.glb`));
    const root = character.scene;
    const restBones = captureBones(root);
    for (const [weaponId, profile] of Object.entries(FIREARMS)) {
      const template = weaponTemplates.get(weaponId);

      restoreBones(root, restBones);
      applyGripPose(root);
      const restWrapper = new THREE.Group();
      restWrapper.add(template.scene.clone(true));
      const restMount = mountWeapon(root, restWrapper);
      assert(restMount.socketError < 0.0001, `${bodyId}/${weaponId}: primary grip misses by ${restMount.socketError}`);
      const supportSocket = restWrapper.getObjectByName('socket_grip_l');
      assert(supportSocket, `${weaponId}: support grip socket is missing`);
      const restError = solveSupportArm(root, handTarget(restWrapper, supportSocket, null, true));
      assert(restError < 0.01, `${bodyId}/${weaponId}: support grip is unreachable (${restError})`);
      root.remove(restWrapper);
      restChecks += 1;

      restoreBones(root, restBones);
      applyGripPose(root);
      const reloadWrapper = new THREE.Group();
      const reloadModel = template.scene.clone(true);
      reloadWrapper.add(reloadModel);
      const reloadClip = template.animations.find(clip => clip.name === 'reload');
      assert(reloadClip, `${weaponId}: reload clip is missing`);
      const reloadPart = reloadWrapper.getObjectByName(profile.reloadPart);
      const primarySocket = reloadWrapper.getObjectByName('socket_grip_r');
      assert(reloadPart && primarySocket, `${weaponId}: reload part or primary socket is missing`);
      reloadWrapper.updateMatrixWorld(true);
      const startRelative = relativePartPosition(reloadWrapper, reloadPart, primarySocket);
      const mixer = new THREE.AnimationMixer(reloadModel);
      mixer.clipAction(reloadClip).play();
      mixer.setTime(reloadClip.duration * 0.52);
      reloadWrapper.updateMatrixWorld(true);
      const serviceRelative = relativePartPosition(reloadWrapper, reloadPart, primarySocket);
      const displacement = startRelative.distanceTo(serviceRelative);
      assert(displacement >= 0.03, `${weaponId}: reload part moves only ${displacement}m`);
      const reloadMount = mountWeapon(root, reloadWrapper);
      assert(reloadMount.socketError < 0.0001, `${bodyId}/${weaponId}: primary grip drifts during reload`);
      const reloadError = solveSupportArm(root, handTarget(
        reloadWrapper,
        reloadPart,
        profile.reloadRotation,
        false
      ));
      assert(reloadError < 0.01, `${bodyId}/${weaponId}: reload service point is unreachable (${reloadError})`);
      root.remove(reloadWrapper);
      mixer.stopAllAction();
      reloadChecks += 1;
    }

    for (const [weaponId, profile] of Object.entries(MELEE_WEAPONS)) {
      const template = weaponTemplates.get(weaponId);
      const phasePositions = new Map();
      for (const [phaseName, requestedPose] of Object.entries(profile.poses)) {
        restoreBones(root, restBones);
        applyGripPose(root);
        const wrapper = new THREE.Group();
        wrapper.add(template.scene.clone(true));
        const mounted = placeMeleeWeapon(root, wrapper, profile, requestedPose);
        const primaryError = solveArm(root, 'r', meleePrimaryHandTarget(mounted.primarySocket));
        assert(primaryError < 0.01, `${bodyId}/${weaponId}/${phaseName}: primary grip is unreachable (${primaryError})`);
        meleePrimaryChecks += 1;
        if (profile.twoHanded) {
          root.updateMatrixWorld(true);
          wrapper.updateMatrixWorld(true);
          const supportError = solveSupportArm(root, handTarget(
            wrapper,
            mounted.supportSocket,
            profile.supportRotation,
            true
          ));
          assert(supportError < 0.01, `${bodyId}/${weaponId}/${phaseName}: support grip is unreachable (${supportError})`);
          meleeSupportChecks += 1;
        }
        assertBoneScales(root, restBones, `${bodyId}/${weaponId}/${phaseName}`);
        phasePositions.set(phaseName, mounted.primarySocket.getWorldPosition(new THREE.Vector3()));
        root.remove(wrapper);
      }
      assert(
        phasePositions.get('idle').distanceTo(phasePositions.get('windup')) >= 0.22,
        `${bodyId}/${weaponId}: windup travel is too small`
      );
      assert(
        phasePositions.get('windup').distanceTo(phasePositions.get('strike')) >= 0.38,
        `${bodyId}/${weaponId}: strike travel is too small`
      );
    }
  }
  console.log(
    `Weapon interaction runtime OK: ${restChecks} two-hand grips and `
    + `${reloadChecks} physical reload poses; ${meleePrimaryChecks} melee primary grips and `
    + `${meleeSupportChecks} melee support grips across ${BODY_IDS.length} bodies`
  );
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
