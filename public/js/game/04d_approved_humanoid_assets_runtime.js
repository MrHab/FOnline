  // ===== APPROVED HUMANOID NPC / BOOTS / ASSAULT-RIFLE RUNTIME =====
  const APPROVED_HUMANOID_ASSET_VERSION = '7.76.6-approved-humanoid-assets-v7-hazmat-hood';
  const APPROVED_NPC_ANIMATION_URL = '/assets/models/characters/npc/npc_humanoid_animations.glb';
  const APPROVED_ASSAULT_RIFLE_GRIP_URL = '/assets/models/weapons/approved_assault_rifle_grip.glb';
  const APPROVED_ASSAULT_RIFLE_GRIP_BONES = Object.freeze([
    'spine_01', 'spine_02', 'spine_03',
    'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
    'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
    'index_01_l', 'index_02_l', 'index_03_l',
    'middle_01_l', 'middle_02_l', 'middle_03_l',
    'ring_01_l', 'ring_02_l', 'ring_03_l',
    'pinky_01_l', 'pinky_02_l', 'pinky_03_l',
    'thumb_01_l', 'thumb_02_l', 'thumb_03_l',
    'index_01_r', 'index_02_r', 'index_03_r',
    'middle_01_r', 'middle_02_r', 'middle_03_r',
    'ring_01_r', 'ring_02_r', 'ring_03_r',
    'pinky_01_r', 'pinky_02_r', 'pinky_03_r',
    'thumb_01_r', 'thumb_02_r', 'thumb_03_r'
  ]);
  function approvedEquipmentBodyUrls(slot = '', prefix = '') {
    return Object.freeze(Object.fromEntries([
      'female_slim', 'female_medium', 'female_large',
      'male_slim', 'male_medium', 'male_large'
    ].map(bodyId => [
      bodyId,
      `/assets/models/equipment/${slot}/${prefix}_${bodyId}.glb`
    ])));
  }

  const APPROVED_EQUIPMENT_ASSETS = Object.freeze({
    boots: Object.freeze({
      itemId: 'boots',
      slot: 'boots',
      urls: approvedEquipmentBodyUrls('boots', 'equipment_boots')
    }),
    reinforcedBoots: Object.freeze({
      itemId: 'reinforcedBoots',
      slot: 'boots',
      urls: approvedEquipmentBodyUrls('boots', 'equipment_reinforced_boots')
    }),
    leather: Object.freeze({
      itemId: 'leather',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_leather_jacket')
    }),
    hazmatSuit: Object.freeze({
      itemId: 'hazmatSuit',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_hazmat_suit')
    }),
    energySuit: Object.freeze({
      itemId: 'energySuit',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_energy_suit')
    }),
    helmet: Object.freeze({
      itemId: 'helmet',
      slot: 'helmet',
      urls: approvedEquipmentBodyUrls('helmet', 'equipment_steel_helmet')
    }),
    tacticalHelmet: Object.freeze({
      itemId: 'tacticalHelmet',
      slot: 'helmet',
      urls: approvedEquipmentBodyUrls('helmet', 'equipment_tactical_helmet')
    }),
    assaultHelmet: Object.freeze({
      itemId: 'assaultHelmet',
      slot: 'helmet',
      urls: approvedEquipmentBodyUrls('helmet', 'equipment_assault_helmet')
    })
  });
  const APPROVED_BOOT_URLS = APPROVED_EQUIPMENT_ASSETS.boots.urls;

  const approvedNpcAnimationState = { promise: null, clips: null, failed: false };
  const approvedEquipmentState = { templates: new Map(), promises: new Map(), failed: new Set() };
  const approvedAssaultGripState = { promise: null, pose: null, failed: false };

  function approvedHumanoidLoader() {
    return THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
  }

  function approvedAssetUrl(url) {
    return `${url}?v=${encodeURIComponent(APPROVED_HUMANOID_ASSET_VERSION)}`;
  }

  function loadApprovedNpcAnimationClips() {
    if (approvedNpcAnimationState.clips) return Promise.resolve(approvedNpcAnimationState.clips);
    if (approvedNpcAnimationState.promise) return approvedNpcAnimationState.promise;
    const loader = approvedHumanoidLoader();
    if (!loader || approvedNpcAnimationState.failed) return Promise.resolve([]);
    approvedNpcAnimationState.promise = new Promise(resolve => {
      loader.load(approvedAssetUrl(APPROVED_NPC_ANIMATION_URL), gltf => {
        const clips = (gltf?.animations || []).filter(clip => (
          ['attack', 'hurt', 'death'].includes(String(clip?.name || '').toLowerCase())
        ));
        if (clips.length !== 3) {
          approvedNpcAnimationState.failed = true;
          console.warn('Утверждённый набор анимаций НПС не содержит attack/hurt/death.');
          resolve([]);
          return;
        }
        approvedNpcAnimationState.clips = clips;
        if (gltf?.scene && typeof disposeCharacterGlbObject === 'function') {
          disposeCharacterGlbObject(gltf.scene);
        }
        resolve(clips);
      }, undefined, error => {
        approvedNpcAnimationState.failed = true;
        console.warn('Не удалось загрузить утверждённые анимации НПС.', error);
        resolve([]);
      });
    }).finally(() => {
      approvedNpcAnimationState.promise = null;
    });
    return approvedNpcAnimationState.promise;
  }

  function installApprovedNpcAnimationClips(runtime, clips = []) {
    if (!runtime?.mixer || runtime.approvedNpcAnimationsInstalled) return false;
    clips.forEach(clip => {
      const name = String(clip?.name || '').toLowerCase();
      if (!name || runtime.actions?.[name]) return;
      const action = runtime.mixer.clipAction(clip, runtime.root);
      action.enabled = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      runtime.actions[name] = action;
    });
    runtime.approvedNpcAnimationsInstalled = ['attack', 'hurt', 'death'].every(name => runtime.actions?.[name]);
    return runtime.approvedNpcAnimationsInstalled;
  }

  function attachApprovedNpcAnimations(runtime) {
    if (!runtime) return Promise.resolve(false);
    runtime.usesApprovedNpcAnimations = true;
    if (runtime.approvedNpcAnimationsInstalled) return Promise.resolve(true);
    return loadApprovedNpcAnimationClips().then(clips => installApprovedNpcAnimationClips(runtime, clips));
  }

  function approvedEquipmentBodyKey(actor) {
    const appearance = normalizeCharacterAppearance(
      actor?.userData?.characterGlbRuntime?.appearance
      || actor?.userData?.characterAppearance
      || {}
    );
    return `${appearance.sex}_${appearance.bodyType}`;
  }

  function configureApprovedEquipmentTemplate(scene) {
    if (!scene?.traverse) return null;
    scene.updateMatrixWorld(true);
    const sourceMeshes = [];
    scene.traverse(node => {
      if (node?.isSkinnedMesh && node.skeleton) sourceMeshes.push(node);
    });
    if (!sourceMeshes.length) return null;
    sourceMeshes.forEach(sourceMesh => { sourceMesh.frustumCulled = false; });
    return { scene, sourceMeshes };
  }

  function approvedEquipmentCacheKey(itemId = '', bodyKey = '') {
    return `${itemId}:${bodyKey}`;
  }

  function loadApprovedEquipmentTemplate(itemId = '', bodyKey = '') {
    const definition = APPROVED_EQUIPMENT_ASSETS[itemId];
    const cacheKey = approvedEquipmentCacheKey(itemId, bodyKey);
    if (approvedEquipmentState.templates.has(cacheKey)) {
      return Promise.resolve(approvedEquipmentState.templates.get(cacheKey));
    }
    if (approvedEquipmentState.promises.has(cacheKey)) return approvedEquipmentState.promises.get(cacheKey);
    const url = definition?.urls?.[bodyKey];
    const loader = approvedHumanoidLoader();
    if (!url || !loader || approvedEquipmentState.failed.has(cacheKey)) return Promise.resolve(null);
    const promise = new Promise(resolve => {
      loader.load(approvedAssetUrl(url), gltf => {
        const template = configureApprovedEquipmentTemplate(gltf?.scene || gltf?.scenes?.[0] || null);
        if (!template) {
          approvedEquipmentState.failed.add(cacheKey);
          console.warn(`Утверждённая экипировка ${itemId} (${bodyKey}) не содержит skinned mesh.`);
          resolve(null);
          return;
        }
        approvedEquipmentState.templates.set(cacheKey, template);
        resolve(template);
      }, undefined, error => {
        approvedEquipmentState.failed.add(cacheKey);
        console.warn(`Не удалось загрузить утверждённую экипировку ${itemId} (${bodyKey}).`, error);
        resolve(null);
      });
    }).finally(() => {
      approvedEquipmentState.promises.delete(cacheKey);
    });
    approvedEquipmentState.promises.set(cacheKey, promise);
    return promise;
  }

  function loadApprovedBootTemplate(bodyKey = '') {
    return loadApprovedEquipmentTemplate('boots', bodyKey);
  }

  function approvedEquipmentFallbackMeshes(parts = {}, slot = '') {
    if (slot === 'boots') {
      return [
        parts.baseBootL, parts.baseBootR, parts.baseGaiterL, parts.baseGaiterR,
        parts.bootL, parts.bootR, parts.serviceScoutBootL, parts.serviceScoutBootR
      ].filter(Boolean);
    }
    if (slot === 'helmet') {
      return [
        parts.helmet, parts.helmetVisor, parts.helmetFront,
        parts.helmetPodL, parts.helmetPodR
      ].filter(Boolean);
    }
    if (slot === 'armor') {
      return [
        parts.chestPlate, parts.shoulderL, parts.shoulderR, parts.energyCore,
        parts.visor, parts.canister, parts.leatherTorso, parts.leatherSleeveL,
        parts.leatherSleeveR, parts.leatherCollarL, parts.leatherCollarR
      ].filter(Boolean);
    }
    return [];
  }

  function removeApprovedEquipmentRuntime(actor, slot = '') {
    const runtimes = actor?.userData?.approvedEquipmentRuntimes;
    const state = runtimes?.[slot];
    if (!state) return;
    state.requestId = Number(state.requestId || 0) + 1;
    state.mesh?.parent?.remove?.(state.mesh);
    delete runtimes[slot];
  }

  function removeApprovedEquipmentRuntimes(actor) {
    ['armor', 'helmet', 'boots'].forEach(slot => removeApprovedEquipmentRuntime(actor, slot));
    if (actor?.userData) delete actor.userData.approvedEquipmentRuntimes;
  }

  function removeApprovedBootRuntime(actor) {
    removeApprovedEquipmentRuntime(actor, 'boots');
  }

  function makeApprovedEquipmentInstance(template, characterRoot, itemId = '') {
    const sourceMeshes = Array.isArray(template?.sourceMeshes) ? template.sourceMeshes : [];
    if (!sourceMeshes.length || !characterRoot) return null;
    template.scene.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.name = `approved_equipment_${itemId}`;
    for (const sourceMesh of sourceMeshes) {
      if (!sourceMesh?.skeleton) return null;
      const targetBones = sourceMesh.skeleton.bones.map(sourceBone => (
        characterRoot.getObjectByName?.(sourceBone.name) || null
      ));
      if (targetBones.some(bone => !bone)) return null;
      const mesh = new THREE.SkinnedMesh(sourceMesh.geometry, sourceMesh.material);
      mesh.name = `approved_equipment_${itemId}_${sourceMesh.name || sourceMesh.material?.name || group.children.length}`;
      sourceMesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.bindMode = sourceMesh.bindMode;
      mesh.bind(
        new THREE.Skeleton(
          targetBones,
          sourceMesh.skeleton.boneInverses.map(matrix => matrix.clone())
        ),
        sourceMesh.bindMatrix.clone()
      );
      mesh.normalizeSkinWeights?.();
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData = {
        ...(sourceMesh.userData || {}),
        approvedEquipmentSharedAsset: true
      };
      group.add(mesh);
    }
    return group.children.length === sourceMeshes.length ? group : null;
  }

  function syncApprovedHazmatHoodVisibility(actor, eq = null) {
    if (!actor?.userData) return;
    const activeEquipment = eq && typeof eq === 'object'
      ? eq
      : (actor.userData.enemyEquipment || actor.userData.equipment || {});
    const armorId = String(equipmentVisualBaseId(activeEquipment?.armor || '') || '');
    const helmetId = String(equipmentVisualBaseId(activeEquipment?.helmet || '') || '');
    const armorRuntime = actor.userData.approvedEquipmentRuntimes?.armor?.mesh;
    armorRuntime?.traverse?.(node => {
      if (node?.isSkinnedMesh && node.userData?.realm_hide_when_helmet_equipped === true) {
        node.visible = !(armorId === 'hazmatSuit' && helmetId);
      }
    });
  }

  function applyApprovedEquipmentSlot(actor, eq = {}, slot = '') {
    if (!actor?.userData) return false;
    const parts = actor.userData.parts || actor.userData.actorParts || {};
    const characterRuntime = actor.userData.characterGlbRuntime;
    const itemId = String(equipmentVisualBaseId(eq?.[slot] || '') || '');
    const definition = APPROVED_EQUIPMENT_ASSETS[itemId];
    const wanted = definition?.slot === slot && !!characterRuntime?.root;
    actor.userData.approvedEquipmentRuntimes = actor.userData.approvedEquipmentRuntimes || {};
    const current = actor.userData.approvedEquipmentRuntimes[slot];
    if (!wanted) {
      if (current) removeApprovedEquipmentRuntime(actor, slot);
      syncApprovedHazmatHoodVisibility(actor, eq);
      return false;
    }
    const bodyKey = approvedEquipmentBodyKey(actor);
    if (current?.itemId === itemId && current?.bodyKey === bodyKey && current.mesh?.parent === characterRuntime.root) {
      approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
      syncApprovedHazmatHoodVisibility(actor, eq);
      return true;
    }
    removeApprovedEquipmentRuntime(actor, slot);
    actor.userData.approvedEquipmentRequestIds = actor.userData.approvedEquipmentRequestIds || {};
    const requestId = Number(actor.userData.approvedEquipmentRequestIds[slot] || 0) + 1;
    actor.userData.approvedEquipmentRequestIds[slot] = requestId;
    actor.userData.approvedEquipmentRuntimes[slot] = { itemId, bodyKey, requestId, mesh: null };
    loadApprovedEquipmentTemplate(itemId, bodyKey).then(template => {
      const runtime = actor.userData.approvedEquipmentRuntimes?.[slot];
      const activeCharacter = actor.userData.characterGlbRuntime;
      const activeEquipment = actor.userData.enemyEquipment || actor.userData.equipment || eq;
      if (
        !template
        || runtime?.requestId !== requestId
        || runtime?.itemId !== itemId
        || runtime?.bodyKey !== bodyKey
        || activeCharacter !== characterRuntime
        || String(equipmentVisualBaseId(activeEquipment?.[slot] || '') || '') !== itemId
      ) return;
      const mesh = makeApprovedEquipmentInstance(template, activeCharacter.root, itemId);
      if (!mesh) {
        console.warn(`Не удалось привязать утверждённую экипировку ${itemId} (${bodyKey}) к персонажу.`);
        return;
      }
      activeCharacter.root.add(mesh);
      runtime.mesh = mesh;
      approvedEquipmentFallbackMeshes(parts, slot).forEach(fallback => { fallback.visible = false; });
      syncApprovedHazmatHoodVisibility(actor, activeEquipment);
    });
    return false;
  }

  function applyApprovedEquipmentVisuals(actor, eq = {}) {
    const results = ['armor', 'helmet', 'boots'].map(slot => applyApprovedEquipmentSlot(actor, eq, slot));
    syncApprovedHazmatHoodVisibility(actor, eq);
    return results;
  }

  function applyApprovedBootsVisual(actor, eq = {}) {
    return applyApprovedEquipmentSlot(actor, eq, 'boots');
  }

  function compileApprovedGripPose(gltf) {
    const clip = (gltf?.animations || []).find(animation => (
      String(animation?.name || '').toLowerCase() === 'assault_rifle_grip'
    ));
    const mount = gltf?.scene?.getObjectByName?.('approved_assault_rifle_mount');
    if (!clip || !mount) return null;
    const sampleTime = Math.max(0, Number(clip.duration || 0)) * 0.5;
    const gripBoneNames = new Set(APPROVED_ASSAULT_RIFLE_GRIP_BONES);
    const bones = new Map();
    const restBones = new Map();
    const sampledPositions = new Map();
    const sampledScales = new Map();
    let unsafeTransformTrack = false;
    clip.tracks.forEach(track => {
      const dot = String(track?.name || '').lastIndexOf('.');
      if (dot <= 0) return;
      const boneName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (!['position', 'quaternion', 'scale'].includes(property)) {
        unsafeTransformTrack = true;
        return;
      }
      const value = Array.from(track.createInterpolant().evaluate(sampleTime));
      if (value.some(component => !Number.isFinite(component))) {
        unsafeTransformTrack = true;
        return;
      }
      if (!gripBoneNames.has(boneName)) return;
      if (property === 'position') sampledPositions.set(boneName, value);
      if (property === 'scale') sampledScales.set(boneName, value);
      if (property !== 'quaternion') return;
      const length = Math.hypot(...value);
      if (value.length !== 4 || Math.abs(length - 1) > 0.01) {
        unsafeTransformTrack = true;
        return;
      }
      if (!bones.has(boneName)) bones.set(boneName, {});
      bones.get(boneName).quaternion = value;
    });
    if (
      unsafeTransformTrack
      || APPROVED_ASSAULT_RIFLE_GRIP_BONES.some(boneName => !bones.has(boneName))
    ) return null;
    gltf.scene.updateMatrixWorld(true);
    bones.forEach((_transform, boneName) => {
      const bone = gltf.scene.getObjectByName?.(boneName);
      if (!bone?.isBone) {
        unsafeTransformTrack = true;
        return;
      }
      restBones.set(boneName, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone()
      });
    });
    sampledPositions.forEach((value, boneName) => {
      const bone = gltf.scene.getObjectByName?.(boneName);
      if (!bone?.isBone || value.length !== 3) {
        unsafeTransformTrack = true;
        return;
      }
      const delta = new THREE.Vector3().fromArray(value).distanceTo(bone.position);
      const limit = boneName === 'thumb_01_l' ? 0.03 : 0.002;
      if (delta > limit) unsafeTransformTrack = true;
      if (boneName === 'thumb_01_l' && bones.has(boneName)) {
        bones.get(boneName).position = value;
      }
    });
    sampledScales.forEach((value, boneName) => {
      const bone = gltf.scene.getObjectByName?.(boneName);
      if (
        !bone?.isBone
        || value.length !== 3
        || new THREE.Vector3().fromArray(value).distanceTo(bone.scale) > 0.002
      ) unsafeTransformTrack = true;
    });
    if (unsafeTransformTrack) return null;

    const primaryHand = gltf.scene.getObjectByName?.('hand_r');
    const supportHand = gltf.scene.getObjectByName?.('hand_l');
    if (!primaryHand?.isBone || !supportHand?.isBone) return null;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    mixer.update(sampleTime);
    gltf.scene.updateMatrixWorld(true);
    const primaryHandToMount = primaryHand.matrixWorld.clone().invert().multiply(mount.matrixWorld);
    const mountToSupportHand = mount.matrixWorld.clone().invert().multiply(supportHand.matrixWorld);
    return {
      bones,
      restBones,
      primaryHandToMount,
      mountToSupportHand
    };
  }

  function captureApprovedAssaultRifleRestPose(root) {
    if (!root?.traverse) return null;
    const bones = new Map();
    root.traverse(node => {
      if (!node?.isBone) return;
      bones.set(node.name, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone()
      });
    });
    return { bones };
  }

  function approvedGripTargetTransform(runtime, pose, boneName, transform) {
    const donorRest = pose?.restBones?.get?.(boneName);
    const targetRest = runtime?.approvedAssaultRifleRestPose?.bones?.get?.(boneName);
    if (!donorRest || !targetRest) return transform;
    const result = {};
    if (transform.position?.length === 3) {
      result.position = targetRest.position.clone().add(
        new THREE.Vector3().fromArray(transform.position).sub(donorRest.position)
      );
    }
    if (transform.quaternion?.length === 4) {
      const poseQuaternion = new THREE.Quaternion().fromArray(transform.quaternion).normalize();
      const delta = donorRest.quaternion.clone().invert().multiply(poseQuaternion);
      result.quaternion = targetRest.quaternion.clone().multiply(delta).normalize();
    }
    return result;
  }

  function loadApprovedAssaultRifleGrip() {
    if (approvedAssaultGripState.pose) return Promise.resolve(approvedAssaultGripState.pose);
    if (approvedAssaultGripState.promise) return approvedAssaultGripState.promise;
    const loader = approvedHumanoidLoader();
    if (!loader || approvedAssaultGripState.failed) return Promise.resolve(null);
    approvedAssaultGripState.promise = new Promise(resolve => {
      loader.load(approvedAssetUrl(APPROVED_ASSAULT_RIFLE_GRIP_URL), gltf => {
        const pose = compileApprovedGripPose(gltf);
        if (gltf?.scene && typeof disposeCharacterGlbObject === 'function') {
          disposeCharacterGlbObject(gltf.scene);
        }
        if (!pose) {
          approvedAssaultGripState.failed = true;
          console.warn('Утверждённая поза хвата автомата повреждена.');
          resolve(null);
          return;
        }
        approvedAssaultGripState.pose = pose;
        resolve(pose);
      }, undefined, error => {
        approvedAssaultGripState.failed = true;
        console.warn('Не удалось загрузить утверждённую позу хвата автомата.', error);
        resolve(null);
      });
    }).finally(() => {
      approvedAssaultGripState.promise = null;
    });
    return approvedAssaultGripState.promise;
  }

  function approvedActorWeaponGroup(actor) {
    const parts = actor?.userData?.parts || actor?.userData?.actorParts || {};
    return parts.weaponGroup || actor?.userData?.enemyWeaponGroup || null;
  }

  function restoreApprovedAssaultRifleGrip(actor) {
    const state = actor?.userData?.approvedAssaultRifleGrip;
    if (!state) return;
    const weaponGroup = state.weaponGroup;
    if (weaponGroup && state.parent) {
      state.parent.add(weaponGroup);
      weaponGroup.position.copy(state.position);
      weaponGroup.quaternion.copy(state.quaternion);
      weaponGroup.scale.copy(state.scale);
      weaponGroup.userData.basePosition = state.basePosition.clone();
      weaponGroup.userData.baseRotation = state.baseRotation.clone();
      weaponGroup.userData.characterPose = {};
    }
    delete actor.userData.approvedAssaultRifleGrip;
  }

  function setApprovedBoneWorldQuaternion(bone, worldQuaternion) {
    if (!bone?.isBone || !bone.parent) return false;
    const parentQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  function solveApprovedSupportArm(characterRoot, targetMatrix) {
    const chain = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l'].map(name => (
      characterRoot?.getObjectByName?.(name) || null
    ));
    if (chain.some(bone => !bone?.isBone) || !targetMatrix) return false;
    chain[0].updateWorldMatrix(true, true);
    const positions = chain.map(bone => bone.getWorldPosition(new THREE.Vector3()));
    const base = positions[0].clone();
    const lengths = positions.slice(0, -1).map((position, index) => (
      position.distanceTo(positions[index + 1])
    ));
    if (lengths.some(length => !Number.isFinite(length) || length <= 0.0001)) return false;
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
      const currentWorld = chain[index].getWorldQuaternion(new THREE.Quaternion());
      if (!setApprovedBoneWorldQuaternion(chain[index], delta.multiply(currentWorld))) return false;
    }
    if (!setApprovedBoneWorldQuaternion(chain[chain.length - 1], targetQuaternion)) return false;
    chain[0].updateWorldMatrix(true, true);
    return chain[chain.length - 1]
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(targetPosition) < 0.01;
  }

  function mountApprovedAssaultRifle(actor, pose) {
    const runtime = actor?.userData?.characterGlbRuntime;
    const weaponGroup = approvedActorWeaponGroup(actor);
    const primaryHand = runtime?.root?.getObjectByName?.('hand_r');
    if (!runtime?.root || !weaponGroup || !pose?.primaryHandToMount || !primaryHand?.isBone) return null;
    let state = actor.userData.approvedAssaultRifleGrip;
    if (!state || state.weaponGroup !== weaponGroup) {
      if (state) restoreApprovedAssaultRifleGrip(actor);
      initWeaponVisualState(weaponGroup);
      state = {
        weaponGroup,
        parent: weaponGroup.parent,
        position: weaponGroup.position.clone(),
        quaternion: weaponGroup.quaternion.clone(),
        scale: weaponGroup.scale.clone(),
        basePosition: weaponGroup.userData.basePosition.clone(),
        baseRotation: weaponGroup.userData.baseRotation.clone()
      };
      actor.userData.approvedAssaultRifleGrip = state;
    }
    runtime.root.updateMatrixWorld(true);
    const mountWorld = primaryHand.matrixWorld.clone().multiply(pose.primaryHandToMount);
    if (weaponGroup.parent !== runtime.root) runtime.root.add(weaponGroup);
    const mountLocal = runtime.root.matrixWorld.clone().invert().multiply(mountWorld);
    mountLocal.decompose(weaponGroup.position, weaponGroup.quaternion, weaponGroup.scale);
    weaponGroup.userData.basePosition = weaponGroup.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(weaponGroup.quaternion);
    weaponGroup.userData.characterPose = {};
    weaponGroup.updateMatrixWorld(true);
    return mountWorld;
  }

  function applyApprovedAssaultRifleGrip(actor, weaponId = '') {
    if (!actor?.userData) return false;
    const id = String(equipmentVisualBaseId(weaponId || actor.userData.weaponId || '') || '');
    if (id !== 'assaultRifle' || !actor.userData.characterGlbRuntime?.root) {
      restoreApprovedAssaultRifleGrip(actor);
      return false;
    }
    const pose = approvedAssaultGripState.pose;
    if (!pose) {
      void loadApprovedAssaultRifleGrip();
      return false;
    }
    const characterRoot = actor.userData.characterGlbRuntime.root;
    if (actor.userData.characterGlbRuntime.currentAction === 'death') {
      characterRoot.updateMatrixWorld(true);
      return !!mountApprovedAssaultRifle(actor, pose);
    }
    pose.bones.forEach((transform, boneName) => {
      const bone = characterRoot.getObjectByName?.(boneName);
      if (!bone?.isBone) return;
      const target = approvedGripTargetTransform(
        actor.userData.characterGlbRuntime,
        pose,
        boneName,
        transform
      );
      if (target.position) bone.position.copy(target.position);
      if (target.quaternion) bone.quaternion.copy(target.quaternion);
      else if (transform.quaternion?.length === 4) bone.quaternion.fromArray(transform.quaternion).normalize();
    });
    characterRoot.updateMatrixWorld(true);
    const mountWorld = mountApprovedAssaultRifle(actor, pose);
    if (!mountWorld) return false;
    const supportTarget = mountWorld.clone().multiply(pose.mountToSupportHand);
    return solveApprovedSupportArm(characterRoot, supportTarget);
  }

  function preloadApprovedHumanoidAssets() {
    const appearance = normalizeCharacterAppearance(characterProfile?.appearance || {});
    return Promise.all([
      loadApprovedNpcAnimationClips(),
      loadApprovedEquipmentTemplate('boots', `${appearance.sex}_${appearance.bodyType}`),
      loadApprovedAssaultRifleGrip()
    ]);
  }
