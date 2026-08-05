  // ===== APPROVED HUMANOID NPC / BOOTS / ASSAULT-RIFLE RUNTIME =====
  const APPROVED_HUMANOID_ASSET_VERSION = '7.76.6-approved-humanoid-assets-v2';
  const APPROVED_NPC_ANIMATION_URL = '/assets/models/characters/npc/npc_humanoid_animations.glb';
  const APPROVED_ASSAULT_RIFLE_GRIP_URL = '/assets/models/weapons/approved_assault_rifle_grip.glb';
  const APPROVED_BOOT_URLS = Object.freeze({
    female_slim: '/assets/models/equipment/boots/equipment_boots_female_slim.glb',
    female_medium: '/assets/models/equipment/boots/equipment_boots_female_medium.glb',
    female_large: '/assets/models/equipment/boots/equipment_boots_female_large.glb',
    male_slim: '/assets/models/equipment/boots/equipment_boots_male_slim.glb',
    male_medium: '/assets/models/equipment/boots/equipment_boots_male_medium.glb',
    male_large: '/assets/models/equipment/boots/equipment_boots_male_large.glb'
  });

  const approvedNpcAnimationState = { promise: null, clips: null, failed: false };
  const approvedBootState = { templates: new Map(), promises: new Map(), failed: new Set() };
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

  function approvedBootBodyKey(actor) {
    const appearance = normalizeCharacterAppearance(
      actor?.userData?.characterGlbRuntime?.appearance
      || actor?.userData?.characterAppearance
      || {}
    );
    return `${appearance.sex}_${appearance.bodyType}`;
  }

  function configureApprovedBootTemplate(scene) {
    if (!scene?.traverse) return null;
    scene.updateMatrixWorld(true);
    let sourceMesh = null;
    scene.traverse(node => {
      if (!sourceMesh && node?.isSkinnedMesh && node.skeleton) sourceMesh = node;
    });
    if (!sourceMesh) return null;
    sourceMesh.frustumCulled = false;
    return { scene, sourceMesh };
  }

  function loadApprovedBootTemplate(bodyKey = '') {
    if (approvedBootState.templates.has(bodyKey)) {
      return Promise.resolve(approvedBootState.templates.get(bodyKey));
    }
    if (approvedBootState.promises.has(bodyKey)) return approvedBootState.promises.get(bodyKey);
    const url = APPROVED_BOOT_URLS[bodyKey];
    const loader = approvedHumanoidLoader();
    if (!url || !loader || approvedBootState.failed.has(bodyKey)) return Promise.resolve(null);
    const promise = new Promise(resolve => {
      loader.load(approvedAssetUrl(url), gltf => {
        const template = configureApprovedBootTemplate(gltf?.scene || gltf?.scenes?.[0] || null);
        if (!template) {
          approvedBootState.failed.add(bodyKey);
          console.warn(`Утверждённые ботинки ${bodyKey} не содержат skinned mesh.`);
          resolve(null);
          return;
        }
        approvedBootState.templates.set(bodyKey, template);
        resolve(template);
      }, undefined, error => {
        approvedBootState.failed.add(bodyKey);
        console.warn(`Не удалось загрузить утверждённые ботинки ${bodyKey}.`, error);
        resolve(null);
      });
    }).finally(() => {
      approvedBootState.promises.delete(bodyKey);
    });
    approvedBootState.promises.set(bodyKey, promise);
    return promise;
  }

  function approvedBootFallbackMeshes(parts = {}) {
    return [
      parts.baseBootL,
      parts.baseBootR,
      parts.baseGaiterL,
      parts.baseGaiterR,
      parts.bootL,
      parts.bootR,
      parts.serviceScoutBootL,
      parts.serviceScoutBootR
    ].filter(Boolean);
  }

  function removeApprovedBootRuntime(actor) {
    const state = actor?.userData?.approvedBootRuntime;
    if (!state) return;
    state.requestId = Number(state.requestId || 0) + 1;
    state.mesh?.parent?.remove?.(state.mesh);
    delete actor.userData.approvedBootRuntime;
  }

  function makeApprovedBootInstance(template, characterRoot) {
    const sourceMesh = template?.sourceMesh;
    if (!sourceMesh?.skeleton || !characterRoot) return null;
    const targetBones = sourceMesh.skeleton.bones.map(sourceBone => (
      characterRoot.getObjectByName?.(sourceBone.name) || null
    ));
    if (targetBones.some(bone => !bone)) return null;
    template.scene.updateMatrixWorld(true);
    const mesh = new THREE.SkinnedMesh(sourceMesh.geometry, sourceMesh.material);
    mesh.name = 'approved_equipment_boots';
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
    mesh.userData.approvedEquipmentSharedAsset = true;
    return mesh;
  }

  function applyApprovedBootsVisual(actor, eq = {}) {
    if (!actor?.userData) return false;
    const parts = actor.userData.parts || actor.userData.actorParts || {};
    const characterRuntime = actor.userData.characterGlbRuntime;
    const bootsId = String(equipmentVisualBaseId(eq?.boots || '') || '');
    const wanted = bootsId === 'boots' && !!characterRuntime?.root;
    const current = actor.userData.approvedBootRuntime;
    if (!wanted) {
      if (current) removeApprovedBootRuntime(actor);
      return false;
    }
    const bodyKey = approvedBootBodyKey(actor);
    if (current?.bodyKey === bodyKey && current.mesh?.parent === characterRuntime.root) {
      approvedBootFallbackMeshes(parts).forEach(mesh => { mesh.visible = false; });
      return true;
    }
    removeApprovedBootRuntime(actor);
    const requestId = Number(actor.userData.approvedBootRequestId || 0) + 1;
    actor.userData.approvedBootRequestId = requestId;
    actor.userData.approvedBootRuntime = { bodyKey, requestId, mesh: null };
    loadApprovedBootTemplate(bodyKey).then(template => {
      const runtime = actor.userData.approvedBootRuntime;
      const activeCharacter = actor.userData.characterGlbRuntime;
      if (
        !template
        || runtime?.requestId !== requestId
        || runtime?.bodyKey !== bodyKey
        || activeCharacter !== characterRuntime
        || String(equipmentVisualBaseId((actor.userData.enemyEquipment || actor.userData.equipment || eq)?.boots || '') || '') !== 'boots'
      ) return;
      const mesh = makeApprovedBootInstance(template, activeCharacter.root);
      if (!mesh) {
        console.warn(`Не удалось привязать утверждённые ботинки ${bodyKey} к персонажу.`);
        return;
      }
      activeCharacter.root.add(mesh);
      runtime.mesh = mesh;
      approvedBootFallbackMeshes(parts).forEach(fallback => { fallback.visible = false; });
    });
    return false;
  }

  function compileApprovedGripPose(gltf) {
    const clip = (gltf?.animations || []).find(animation => (
      String(animation?.name || '').toLowerCase() === 'assault_rifle_grip'
    ));
    const mount = gltf?.scene?.getObjectByName?.('approved_assault_rifle_mount');
    if (!clip || !mount) return null;
    const sampleTime = Math.max(0, Number(clip.duration || 0)) * 0.5;
    const bones = new Map();
    const restBones = new Map();
    let unsafeTransformTrack = false;
    clip.tracks.forEach(track => {
      const dot = String(track?.name || '').lastIndexOf('.');
      if (dot <= 0) return;
      const boneName = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (property !== 'quaternion') {
        unsafeTransformTrack = true;
        return;
      }
      const value = Array.from(track.createInterpolant().evaluate(sampleTime));
      const length = Math.hypot(...value);
      if (value.length !== 4 || value.some(component => !Number.isFinite(component)) || Math.abs(length - 1) > 0.01) {
        unsafeTransformTrack = true;
        return;
      }
      if (!bones.has(boneName)) bones.set(boneName, {});
      bones.get(boneName)[property] = value;
    });
    if (unsafeTransformTrack || !bones.has('hand_l') || !bones.has('hand_r') || !bones.has('thumb_01_l')) return null;
    gltf.scene.updateMatrixWorld(true);
    bones.forEach((_transform, boneName) => {
      const bone = gltf.scene.getObjectByName?.(boneName);
      if (!bone) return;
      restBones.set(boneName, {
        quaternion: bone.quaternion.clone()
      });
    });
    const donorShoulder = gltf.scene.getObjectByName?.('upperarm_r');
    const donorShoulderPosition = donorShoulder
      ? gltf.scene.worldToLocal(donorShoulder.getWorldPosition(new THREE.Vector3()))
      : null;
    return {
      bones,
      restBones,
      donorShoulderPosition,
      mount: {
        position: mount.position.clone(),
        quaternion: mount.quaternion.clone(),
        scale: mount.scale.clone()
      }
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
    root.updateMatrixWorld(true);
    const shoulder = root.getObjectByName?.('upperarm_r');
    const shoulderPosition = shoulder?.isBone
      ? root.worldToLocal(shoulder.getWorldPosition(new THREE.Vector3()))
      : null;
    return { bones, shoulderPosition };
  }

  function approvedGripTargetTransform(runtime, pose, boneName, transform) {
    const donorRest = pose?.restBones?.get?.(boneName);
    const targetRest = runtime?.approvedAssaultRifleRestPose?.bones?.get?.(boneName);
    if (!donorRest || !targetRest) return transform;
    const result = {};
    if (transform.quaternion?.length === 4) {
      const poseQuaternion = new THREE.Quaternion().fromArray(transform.quaternion).normalize();
      const delta = donorRest.quaternion.clone().invert().multiply(poseQuaternion);
      result.quaternion = targetRest.quaternion.clone().multiply(delta).normalize();
    }
    return result;
  }

  function approvedGripMountTransform(runtime, pose) {
    const mount = {
      position: pose.mount.position.clone(),
      quaternion: pose.mount.quaternion.clone(),
      scale: pose.mount.scale.clone()
    };
    const donorShoulder = pose.donorShoulderPosition;
    const targetShoulder = runtime?.approvedAssaultRifleRestPose?.shoulderPosition;
    if (donorShoulder && targetShoulder) {
      mount.position.add(targetShoulder).sub(donorShoulder);
    }
    return mount;
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

  function mountApprovedAssaultRifle(actor, pose) {
    const runtime = actor?.userData?.characterGlbRuntime;
    const weaponGroup = approvedActorWeaponGroup(actor);
    if (!runtime?.root || !weaponGroup || !pose) return false;
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
    const mount = approvedGripMountTransform(runtime, pose);
    if (weaponGroup.parent !== runtime.root) runtime.root.add(weaponGroup);
    weaponGroup.position.copy(mount.position);
    weaponGroup.quaternion.copy(mount.quaternion);
    weaponGroup.scale.copy(mount.scale);
    weaponGroup.userData.basePosition = mount.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(mount.quaternion);
    weaponGroup.userData.characterPose = {};
    return true;
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
    if (!mountApprovedAssaultRifle(actor, pose)) return false;
    const characterRoot = actor.userData.characterGlbRuntime.root;
    pose.bones.forEach((transform, boneName) => {
      const bone = characterRoot.getObjectByName?.(boneName);
      if (!bone?.isBone) return;
      const target = approvedGripTargetTransform(
        actor.userData.characterGlbRuntime,
        pose,
        boneName,
        transform
      );
      if (target.quaternion) bone.quaternion.copy(target.quaternion);
      else if (transform.quaternion?.length === 4) bone.quaternion.fromArray(transform.quaternion).normalize();
    });
    return true;
  }

  function preloadApprovedHumanoidAssets() {
    const appearance = normalizeCharacterAppearance(characterProfile?.appearance || {});
    return Promise.all([
      loadApprovedNpcAnimationClips(),
      loadApprovedBootTemplate(`${appearance.sex}_${appearance.bodyType}`),
      loadApprovedAssaultRifleGrip()
    ]);
  }
