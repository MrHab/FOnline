  // ===== APPROVED HUMANOID NPC / BOOTS / ASSAULT-RIFLE RUNTIME =====
  const APPROVED_HUMANOID_ASSET_VERSION = '7.76.6-approved-humanoid-assets-v13-weapon-interactions';
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
  const APPROVED_FIREARM_GRIP_PROFILES = Object.freeze({
    pistol: Object.freeze({ reloadNodes: ['magazine', 'socket_reload'], reloadRotation: [0.05, -0.25, -1.0], fallbackReload: [0, -0.13, 0.015] }),
    rifle: Object.freeze({ reloadNodes: ['cartridge_clip', 'bolt', 'socket_reload'], reloadRotation: [-0.55, 0.05, -0.25], fallbackReload: [0, 0.02, -0.11] }),
    assaultRifle: Object.freeze({ reloadNodes: ['magazine', 'socket_reload'], reloadRotation: [0.05, -0.25, -0.9], fallbackReload: [0, -0.16, -0.07] }),
    machineGun: Object.freeze({ reloadNodes: ['ammo_box', 'socket_reload'], reloadRotation: [-0.15, -0.35, -0.55], fallbackReload: [0.1, -0.13, -0.08] }),
    laserPistol: Object.freeze({ reloadNodes: ['energy_core', 'socket_reload'], reloadRotation: [0.0, -0.4, -0.85], fallbackReload: [0, 0.04, -0.08] }),
    flamethrower: Object.freeze({ reloadNodes: ['fuel_tank', 'socket_reload'], reloadRotation: [-0.3, -0.15, -0.65], fallbackReload: [0, 0.07, 0.1] }),
    plasmaRifle: Object.freeze({ reloadNodes: ['energy_core', 'socket_reload'], reloadRotation: [-0.2, -0.5, -0.55], fallbackReload: [0, 0.09, -0.13] }),
    shotgun: Object.freeze({ reloadNodes: ['reload_shell', 'socket_reload', 'pump'], reloadRotation: [-0.55, 0.0, -0.35], fallbackReload: [-0.07, -0.02, -0.13] }),
    rocketLauncher: Object.freeze({ reloadNodes: ['rocket_round', 'socket_reload'], reloadRotation: [-0.15, -0.55, -0.4], fallbackReload: [0, 0.08, 0.22] })
  });
  const APPROVED_MELEE_GRIP_PROFILES = Object.freeze({
    knife: Object.freeze({
      family: 'knife',
      twoHanded: false,
      sourceAxis: [0, 1, 0],
      roll: -0.18,
      poses: Object.freeze({
        idle: Object.freeze({ primary: [-0.27, 1.22, 0.24], direction: [0.04, 0.02, 1] }),
        windup: Object.freeze({ primary: [-0.34, 1.40, 0.08], direction: [0.12, 0.42, -0.90] }),
        strike: Object.freeze({ primary: [-0.16, 1.18, 0.56], direction: [0.02, -0.05, 1] })
      }),
      spine: Object.freeze({ windup: [0.04, -0.20, -0.06], strike: [-0.10, 0.18, 0.05] })
    }),
    pickaxe: Object.freeze({
      family: 'heavy',
      twoHanded: true,
      supportRotation: [0.06, 0.02, 0.12],
      roll: 0.12,
      poses: Object.freeze({
        idle: Object.freeze({ primary: [-0.22, 1.18, 0.22], direction: [0.95, 0.29, 0.08] }),
        windup: Object.freeze({ primary: [-0.31, 1.47, 0.05], direction: [0.76, 0.64, -0.08] }),
        strike: Object.freeze({ primary: [-0.22, 1.04, 0.53], direction: [0.98, 0.14, 0.03] })
      }),
      spine: Object.freeze({ windup: [0.10, -0.24, -0.10], strike: [-0.18, 0.22, 0.08] })
    }),
    axe: Object.freeze({
      family: 'heavy',
      twoHanded: true,
      supportRotation: [0.06, 0.02, 0.12],
      roll: 0.24,
      poses: Object.freeze({
        idle: Object.freeze({ primary: [-0.21, 1.18, 0.23], direction: [0.95, 0.29, 0.08] }),
        windup: Object.freeze({ primary: [-0.30, 1.46, 0.06], direction: [0.76, 0.64, -0.08] }),
        strike: Object.freeze({ primary: [-0.21, 1.05, 0.52], direction: [0.98, 0.14, 0.03] })
      }),
      spine: Object.freeze({ windup: [0.09, -0.22, -0.09], strike: [-0.16, 0.20, 0.07] })
    }),
    handPump: Object.freeze({
      family: 'heavy',
      twoHanded: true,
      supportRotation: [0.10, -0.04, 0.18],
      roll: -0.08,
      poses: Object.freeze({
        idle: Object.freeze({ primary: [-0.20, 1.18, 0.24], direction: [0.94, 0.31, 0.11] }),
        windup: Object.freeze({ primary: [-0.28, 1.43, 0.08], direction: [0.74, 0.66, -0.10] }),
        strike: Object.freeze({ primary: [-0.20, 1.07, 0.49], direction: [0.97, 0.20, 0.05] })
      }),
      spine: Object.freeze({ windup: [0.08, -0.20, -0.08], strike: [-0.14, 0.18, 0.06] })
    })
  });
  const APPROVED_ASSAULT_PRIMARY_SOCKET = Object.freeze([0.03, -0.02, 0.025]);
  const APPROVED_ASSAULT_SUPPORT_SOCKET = Object.freeze([-0.01, 0.105, -0.33]);
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
    scoutBoots: Object.freeze({
      itemId: 'scoutBoots',
      slot: 'boots',
      urls: approvedEquipmentBodyUrls('boots', 'equipment_scout_boots')
    }),
    leather: Object.freeze({
      itemId: 'leather',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_leather_jacket')
    }),
    metalArmor: Object.freeze({
      itemId: 'metalArmor',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_metal_armor')
    }),
    ballisticVest: Object.freeze({
      itemId: 'ballisticVest',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_ballistic_vest')
    }),
    combatArmor: Object.freeze({
      itemId: 'combatArmor',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_combat_armor')
    }),
    heavyArmor: Object.freeze({
      itemId: 'heavyArmor',
      slot: 'armor',
      urls: approvedEquipmentBodyUrls('armor', 'equipment_heavy_armor')
    }),
    backpack: Object.freeze({
      itemId: 'backpack',
      slot: 'backpack',
      urls: approvedEquipmentBodyUrls('backpack', 'equipment_backpack')
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
  const APPROVED_BACKPACK_ARMOR_OFFSETS = Object.freeze({
    '': 0,
    leather: 0.02,
    metalArmor: 0.04,
    ballisticVest: 0.035,
    combatArmor: 0.05,
    hazmatSuit: 0.03,
    heavyArmor: 0.07,
    energySuit: 0.04
  });

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

  function approvedActorCharacterRuntime(actor) {
    return actor?.userData?.characterGlbRuntime
      || actor?.userData?.approvedEquipmentCharacterRuntime
      || null;
  }

  function approvedEquipmentBodyKey(actor) {
    const runtime = approvedActorCharacterRuntime(actor);
    const appearance = normalizeCharacterAppearance(
      runtime?.appearance
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
    if (slot === 'backpack') {
      return [...new Set([
        parts.backpack, parts.backpackTop, parts.bedroll,
        ...(Array.isArray(parts.packAccessories) ? parts.packAccessories : [])
      ].filter(Boolean))];
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
    ['armor', 'helmet', 'boots', 'backpack'].forEach(slot => removeApprovedEquipmentRuntime(actor, slot));
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
      mesh.name = `approved_equipment_${itemId}_${sourceMesh.material?.name || group.children.length}`;
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
      mesh.userData.approvedEquipmentSourceName = sourceMesh.name;
      mesh.userData.approvedBackpackLayer = String(
        sourceMesh.userData?.realm_backpack_layer
        || sourceMesh.parent?.userData?.realm_backpack_layer
        || ''
      );
      mesh.userData.approvedEquipmentBasePositionZ = mesh.position.z;
      group.add(mesh);
    }
    return group.children.length === sourceMeshes.length ? group : null;
  }

  function approvedBackpackArmorOffset(eq = {}) {
    const armorId = String(equipmentVisualBaseId(eq?.armor || '') || '');
    return Number(APPROVED_BACKPACK_ARMOR_OFFSETS[armorId] || 0);
  }

  function placeApprovedEquipmentRuntime(group, slot = '', eq = {}) {
    if (slot !== 'backpack' || !group) return;
    const offset = approvedBackpackArmorOffset(eq);
    group.children.forEach(child => {
      const baseZ = Number(child.userData?.approvedEquipmentBasePositionZ);
      if (!Number.isFinite(baseZ)) return;
      child.position.z = baseZ - (
        child.userData.approvedBackpackLayer === 'pack' ? offset : 0
      );
    });
    group.userData.approvedBackpackArmorOffset = offset;
  }

  function applyApprovedEquipmentSlot(actor, eq = {}, slot = '') {
    if (!actor?.userData) return false;
    const parts = actor.userData.parts || actor.userData.actorParts || {};
    const characterRuntime = approvedActorCharacterRuntime(actor);
    const itemId = String(equipmentVisualBaseId(eq?.[slot] || '') || '');
    const definition = APPROVED_EQUIPMENT_ASSETS[itemId];
    const wanted = definition?.slot === slot && !!characterRuntime?.root;
    actor.userData.approvedEquipmentRuntimes = actor.userData.approvedEquipmentRuntimes || {};
    const current = actor.userData.approvedEquipmentRuntimes[slot];
    if (!wanted) {
      if (current) removeApprovedEquipmentRuntime(actor, slot);
      return false;
    }
    const bodyKey = approvedEquipmentBodyKey(actor);
    if (current?.itemId === itemId && current?.bodyKey === bodyKey && current.mesh?.parent === characterRuntime.root) {
      placeApprovedEquipmentRuntime(current.mesh, slot, eq);
      approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
      return true;
    }
    removeApprovedEquipmentRuntime(actor, slot);
    actor.userData.approvedEquipmentRequestIds = actor.userData.approvedEquipmentRequestIds || {};
    const requestId = Number(actor.userData.approvedEquipmentRequestIds[slot] || 0) + 1;
    actor.userData.approvedEquipmentRequestIds[slot] = requestId;
    actor.userData.approvedEquipmentRuntimes[slot] = { itemId, bodyKey, requestId, mesh: null };
    loadApprovedEquipmentTemplate(itemId, bodyKey).then(template => {
      const runtime = actor.userData.approvedEquipmentRuntimes?.[slot];
      const activeCharacter = approvedActorCharacterRuntime(actor);
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
      placeApprovedEquipmentRuntime(mesh, slot, activeEquipment);
      activeCharacter.root.add(mesh);
      runtime.mesh = mesh;
      approvedEquipmentFallbackMeshes(parts, slot).forEach(fallback => { fallback.visible = false; });
    });
    return false;
  }

  function applyApprovedEquipmentVisuals(actor, eq = {}) {
    return ['armor', 'helmet', 'boots', 'backpack'].map(slot => applyApprovedEquipmentSlot(actor, eq, slot));
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
    const supportHandPosition = new THREE.Vector3();
    const supportHandQuaternion = new THREE.Quaternion();
    mountToSupportHand.decompose(supportHandPosition, supportHandQuaternion, new THREE.Vector3());
    const supportHandOffset = supportHandPosition.sub(
      new THREE.Vector3().fromArray(APPROVED_ASSAULT_SUPPORT_SOCKET)
    );
    return {
      bones,
      restBones,
      primaryHandToMount,
      mountToSupportHand,
      supportHandQuaternion,
      supportHandOffset
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

  function restoreApprovedWeaponGrip(actor) {
    const state = actor?.userData?.approvedWeaponGripMount || actor?.userData?.approvedAssaultRifleGrip;
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
    delete actor.userData.approvedWeaponGripMount;
    delete actor.userData.approvedAssaultRifleGrip;
    delete actor.userData.approvedPhysicalMeleeGripActive;
  }

  function restoreApprovedAssaultRifleGrip(actor) {
    restoreApprovedWeaponGrip(actor);
  }

  function setApprovedBoneWorldQuaternion(bone, worldQuaternion) {
    if (!bone?.isBone || !bone.parent) return false;
    const parentQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  function solveApprovedArm(characterRoot, side = 'l', targetMatrix) {
    const suffix = side === 'r' ? 'r' : 'l';
    const chain = [`clavicle_${suffix}`, `upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`].map(name => (
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

  function solveApprovedSupportArm(characterRoot, targetMatrix) {
    return solveApprovedArm(characterRoot, 'l', targetMatrix);
  }

  function approvedWeaponSocket(weaponGroup, names = []) {
    if (!weaponGroup?.getObjectByName) return null;
    for (const name of names) {
      const socket = weaponGroup.getObjectByName(name);
      if (socket) return socket;
    }
    return null;
  }

  function approvedWeaponObjectLocalPose(weaponGroup, object) {
    if (!weaponGroup || !object) return null;
    weaponGroup.updateMatrixWorld(true);
    object.updateWorldMatrix(true, false);
    const matrix = weaponGroup.matrixWorld.clone().invert().multiply(object.matrixWorld);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    matrix.decompose(position, quaternion, new THREE.Vector3());
    return { position, quaternion };
  }

  function mountApprovedWeapon(actor, pose, weaponId = '') {
    const runtime = approvedActorCharacterRuntime(actor);
    const weaponGroup = approvedActorWeaponGroup(actor);
    const primaryHand = runtime?.root?.getObjectByName?.('hand_r');
    const primarySocket = approvedWeaponSocket(weaponGroup, ['socket_grip_r']);
    if (
      !runtime?.root
      || !weaponGroup
      || !pose?.primaryHandToMount
      || !primaryHand?.isBone
      || !primarySocket
    ) return null;
    let state = actor.userData.approvedWeaponGripMount || actor.userData.approvedAssaultRifleGrip;
    if (!state || state.weaponGroup !== weaponGroup) {
      if (state) restoreApprovedWeaponGrip(actor);
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
      actor.userData.approvedWeaponGripMount = state;
      delete actor.userData.approvedAssaultRifleGrip;
    }
    state.weaponId = weaponId;
    runtime.root.updateMatrixWorld(true);
    const mountWorld = primaryHand.matrixWorld.clone().multiply(pose.primaryHandToMount);
    const primaryTargetWorld = mountWorld.clone().multiply(
      new THREE.Matrix4().makeTranslation(...APPROVED_ASSAULT_PRIMARY_SOCKET)
    );
    const primaryLocal = approvedWeaponObjectLocalPose(weaponGroup, primarySocket);
    if (!primaryLocal) return null;
    const primaryLocalMatrix = new THREE.Matrix4().compose(
      primaryLocal.position,
      primaryLocal.quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    const weaponWorld = primaryTargetWorld.clone().multiply(primaryLocalMatrix.invert());
    if (weaponGroup.parent !== runtime.root) runtime.root.add(weaponGroup);
    const mountLocal = runtime.root.matrixWorld.clone().invert().multiply(weaponWorld);
    mountLocal.decompose(weaponGroup.position, weaponGroup.quaternion, weaponGroup.scale);
    weaponGroup.userData.basePosition = weaponGroup.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(weaponGroup.quaternion);
    weaponGroup.userData.characterPose = {};
    weaponGroup.updateMatrixWorld(true);
    return { mountWorld, weaponGroup };
  }

  function mountApprovedAssaultRifle(actor, pose) {
    return mountApprovedWeapon(actor, pose, 'assaultRifle')?.mountWorld || null;
  }

  function approvedWeaponLocalHandTarget(weaponGroup, pose, profile, options = {}) {
    if (!weaponGroup || !pose?.supportHandQuaternion) return null;
    const object = options.object || null;
    const localPose = object ? approvedWeaponObjectLocalPose(weaponGroup, object) : null;
    const position = localPose?.position?.clone?.() || new THREE.Vector3().fromArray(
      options.fallback || profile?.fallbackReload || [0, 0, 0]
    );
    if (options.grip === true && pose.supportHandOffset) position.add(pose.supportHandOffset);
    const quaternion = pose.supportHandQuaternion.clone();
    if (Array.isArray(options.rotation) && options.rotation.length === 3) {
      quaternion.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(options.rotation[0], options.rotation[1], options.rotation[2], 'XYZ')
      ));
    }
    const localMatrix = new THREE.Matrix4().compose(
      position,
      quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    weaponGroup.updateMatrixWorld(true);
    return weaponGroup.matrixWorld.clone().multiply(localMatrix);
  }

  function approvedWeaponReloadPhase(actor) {
    const reload = actor?.userData?.reloadAnim;
    if (!reload) return null;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const duration = Math.max(0.5, Number(reload.duration || 0.82));
    const phase = (now - Number(reload.startedAt || 0)) / (duration * 1000);
    return phase >= 0 && phase < 1 ? Math.max(0, Math.min(1, phase)) : null;
  }

  function approvedWeaponSupportTarget(actor, weaponGroup, pose, profile) {
    const gripSocket = approvedWeaponSocket(weaponGroup, ['socket_grip_l']);
    if (!gripSocket) return null;
    const gripTarget = approvedWeaponLocalHandTarget(weaponGroup, pose, profile, {
      object: gripSocket,
      grip: true
    });
    const phase = approvedWeaponReloadPhase(actor);
    if (phase === null) return gripTarget;
    const reloadObject = approvedWeaponSocket(weaponGroup, profile.reloadNodes || []);
    const reloadTarget = approvedWeaponLocalHandTarget(weaponGroup, pose, profile, {
      object: reloadObject,
      fallback: profile.fallbackReload,
      rotation: profile.reloadRotation
    });
    if (!reloadTarget || !gripTarget) return gripTarget || reloadTarget;
    const edge = 0.22;
    const rawBlend = phase < edge
      ? phase / edge
      : (phase > 1 - edge ? (1 - phase) / edge : 1);
    const blend = Math.max(0, Math.min(1, rawBlend));
    const eased = blend * blend * (3 - 2 * blend);
    const gripPosition = new THREE.Vector3();
    const gripQuaternion = new THREE.Quaternion();
    const reloadPosition = new THREE.Vector3();
    const reloadQuaternion = new THREE.Quaternion();
    gripTarget.decompose(gripPosition, gripQuaternion, new THREE.Vector3());
    reloadTarget.decompose(reloadPosition, reloadQuaternion, new THREE.Vector3());
    return new THREE.Matrix4().compose(
      gripPosition.lerp(reloadPosition, eased),
      gripQuaternion.slerp(reloadQuaternion, eased),
      new THREE.Vector3(1, 1, 1)
    );
  }

  function approvedMeleeSmoothStep(value = 0) {
    const t = Math.max(0, Math.min(1, Number(value || 0)));
    return t * t * (3 - 2 * t);
  }

  function approvedMeleePoseState(actor, weaponId = '') {
    const anim = actor?.userData?.meleeAnim;
    if (!anim || String(equipmentVisualBaseId(anim.weaponId || '') || '') !== weaponId) {
      return { from: 'idle', to: 'idle', blend: 0, phase: 0 };
    }
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const duration = Math.max(0.18, Number(anim.duration || 0.36));
    const phase = Math.max(0, Math.min(1, (now - Number(anim.startedAt || 0)) / (duration * 1000)));
    if (phase < 0.34) {
      return {
        from: 'idle',
        to: 'windup',
        blend: approvedMeleeSmoothStep(phase / 0.34),
        phase
      };
    }
    if (phase < 0.58) {
      return {
        from: 'windup',
        to: 'strike',
        blend: approvedMeleeSmoothStep((phase - 0.34) / 0.24),
        phase
      };
    }
    return {
      from: 'strike',
      to: 'idle',
      blend: approvedMeleeSmoothStep((phase - 0.58) / 0.42),
      phase
    };
  }

  function approvedMeleeVector(value = [], fallback = [0, 0, 0]) {
    const source = Array.isArray(value) && value.length === 3 ? value : fallback;
    return new THREE.Vector3(Number(source[0] || 0), Number(source[1] || 0), Number(source[2] || 0));
  }

  function approvedMeleeInterpolatedPose(profile, poseState) {
    const from = profile?.poses?.[poseState.from] || profile?.poses?.idle;
    const to = profile?.poses?.[poseState.to] || from;
    if (!from || !to) return null;
    const blend = Math.max(0, Math.min(1, Number(poseState.blend || 0)));
    const primary = approvedMeleeVector(from.primary).lerp(approvedMeleeVector(to.primary), blend);
    const direction = approvedMeleeVector(from.direction, [0, 0, 1])
      .lerp(approvedMeleeVector(to.direction, [0, 0, 1]), blend)
      .normalize();
    return { primary, direction };
  }

  function approvedMeleeSpineRotation(profile, poseState) {
    const zero = [0, 0, 0];
    const from = poseState.from === 'idle' ? zero : (profile?.spine?.[poseState.from] || zero);
    const to = poseState.to === 'idle' ? zero : (profile?.spine?.[poseState.to] || zero);
    return approvedMeleeVector(from).lerp(
      approvedMeleeVector(to),
      Math.max(0, Math.min(1, Number(poseState.blend || 0)))
    );
  }

  function applyApprovedMeleeSpinePose(characterRoot, profile, poseState) {
    const rotation = approvedMeleeSpineRotation(profile, poseState);
    const weights = { spine_01: 0.18, spine_02: 0.34, spine_03: 0.48 };
    Object.entries(weights).forEach(([name, weight]) => {
      const bone = characterRoot?.getObjectByName?.(name);
      if (!bone?.isBone) return;
      bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        rotation.x * weight,
        rotation.y * weight,
        rotation.z * weight,
        'XYZ'
      ))).normalize();
    });
    characterRoot?.updateMatrixWorld?.(true);
  }

  function approvedGripBoneIsFinger(name = '') {
    return /^(?:index|middle|ring|pinky|thumb)_0[123]_[lr]$/.test(String(name || ''));
  }

  function applyApprovedMeleeFingerPose(characterRuntime, pose) {
    const characterRoot = characterRuntime?.root;
    if (!characterRoot || !pose?.bones) return;
    pose.bones.forEach((transform, boneName) => {
      if (!approvedGripBoneIsFinger(boneName)) return;
      const bone = characterRoot.getObjectByName?.(boneName);
      if (!bone?.isBone) return;
      const target = approvedGripTargetTransform(characterRuntime, pose, boneName, transform);
      if (target.position) bone.position.copy(target.position);
      if (target.quaternion) bone.quaternion.copy(target.quaternion);
      else if (transform.quaternion?.length === 4) bone.quaternion.fromArray(transform.quaternion).normalize();
    });
    characterRoot.updateMatrixWorld(true);
  }

  function captureApprovedWeaponMountState(actor, weaponGroup) {
    let state = actor?.userData?.approvedWeaponGripMount || actor?.userData?.approvedAssaultRifleGrip;
    if (!state || state.weaponGroup !== weaponGroup) {
      if (state) restoreApprovedWeaponGrip(actor);
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
      actor.userData.approvedWeaponGripMount = state;
      delete actor.userData.approvedAssaultRifleGrip;
    }
    return state;
  }

  function placeApprovedMeleeWeapon(actor, characterRuntime, pose, profile, meleePose, weaponId = '') {
    const weaponGroup = approvedActorWeaponGroup(actor);
    const primarySocket = approvedWeaponSocket(weaponGroup, ['socket_grip_r']);
    if (!weaponGroup || !primarySocket || !meleePose || !characterRuntime?.root) return null;
    const supportSocket = profile.twoHanded
      ? approvedWeaponSocket(weaponGroup, ['socket_grip_l'])
      : null;
    if (profile.twoHanded && !supportSocket) return null;
    const primaryLocal = approvedWeaponObjectLocalPose(weaponGroup, primarySocket);
    const supportLocal = supportSocket ? approvedWeaponObjectLocalPose(weaponGroup, supportSocket) : null;
    if (!primaryLocal || (profile.twoHanded && !supportLocal)) return null;
    const state = captureApprovedWeaponMountState(actor, weaponGroup);
    state.weaponId = weaponId;
    const sourceDirection = supportLocal
      ? supportLocal.position.clone().sub(primaryLocal.position)
      : approvedMeleeVector(profile.sourceAxis, [0, 1, 0]);
    if (sourceDirection.lengthSq() < 0.000001) return null;
    sourceDirection.normalize();
    const weaponQuaternion = new THREE.Quaternion().setFromUnitVectors(
      sourceDirection,
      meleePose.direction.clone().normalize()
    );
    const roll = Number(profile.roll || 0);
    if (Math.abs(roll) > 0.0001) {
      weaponQuaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(meleePose.direction, roll));
    }
    const scaledPrimary = primaryLocal.position.clone().multiply(state.scale).applyQuaternion(weaponQuaternion);
    const weaponPosition = meleePose.primary.clone().sub(scaledPrimary);
    if (weaponGroup.parent !== characterRuntime.root) characterRuntime.root.add(weaponGroup);
    weaponGroup.position.copy(weaponPosition);
    weaponGroup.quaternion.copy(weaponQuaternion).normalize();
    weaponGroup.scale.copy(state.scale);
    weaponGroup.userData.basePosition = weaponGroup.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(weaponGroup.quaternion);
    weaponGroup.userData.characterPose = {};
    weaponGroup.updateMatrixWorld(true);
    return { weaponGroup, primarySocket, supportSocket };
  }

  function approvedMeleePrimaryHandTarget(mounted, pose) {
    if (!mounted?.primarySocket || !pose?.primaryHandToMount) return null;
    mounted.primarySocket.updateWorldMatrix(true, false);
    const handToSocket = pose.primaryHandToMount.clone().multiply(
      new THREE.Matrix4().makeTranslation(...APPROVED_ASSAULT_PRIMARY_SOCKET)
    );
    return mounted.primarySocket.matrixWorld.clone().multiply(handToSocket.invert());
  }

  function applyApprovedMeleeGrip(actor, characterRuntime, pose, profile, weaponId = '') {
    const poseState = approvedMeleePoseState(actor, weaponId);
    const meleePose = approvedMeleeInterpolatedPose(profile, poseState);
    if (!meleePose) return false;
    applyApprovedMeleeSpinePose(characterRuntime.root, profile, poseState);
    applyApprovedMeleeFingerPose(characterRuntime, pose);
    const mounted = placeApprovedMeleeWeapon(actor, characterRuntime, pose, profile, meleePose, weaponId);
    if (!mounted) return false;
    actor.userData.approvedPhysicalMeleeGripActive = weaponId;
    const primaryTarget = approvedMeleePrimaryHandTarget(mounted, pose);
    if (!primaryTarget || !solveApprovedArm(characterRuntime.root, 'r', primaryTarget)) return false;
    if (!profile.twoHanded) return true;
    characterRuntime.root.updateMatrixWorld(true);
    mounted.weaponGroup.updateMatrixWorld(true);
    const supportTarget = approvedWeaponLocalHandTarget(mounted.weaponGroup, pose, profile, {
      object: mounted.supportSocket,
      grip: true,
      rotation: profile.supportRotation
    });
    return !!supportTarget && solveApprovedArm(characterRuntime.root, 'l', supportTarget);
  }

  function applyApprovedWeaponGrip(actor, weaponId = '') {
    if (!actor?.userData) return false;
    const id = String(equipmentVisualBaseId(weaponId || actor.userData.weaponId || '') || '');
    const firearmProfile = APPROVED_FIREARM_GRIP_PROFILES[id];
    const meleeProfile = APPROVED_MELEE_GRIP_PROFILES[id];
    const characterRuntime = approvedActorCharacterRuntime(actor);
    if ((!firearmProfile && !meleeProfile) || !characterRuntime?.root) {
      restoreApprovedWeaponGrip(actor);
      return false;
    }
    const pose = approvedAssaultGripState.pose;
    if (!pose) {
      void loadApprovedAssaultRifleGrip();
      return false;
    }
    const characterRoot = characterRuntime.root;
    if (characterRuntime.currentAction === 'death') {
      delete actor.userData.approvedPhysicalMeleeGripActive;
      characterRoot.updateMatrixWorld(true);
      return !!mountApprovedWeapon(actor, pose, id);
    }
    if (meleeProfile) {
      const applied = applyApprovedMeleeGrip(actor, characterRuntime, pose, meleeProfile, id);
      if (!applied) restoreApprovedWeaponGrip(actor);
      return applied;
    }
    delete actor.userData.approvedPhysicalMeleeGripActive;
    pose.bones.forEach((transform, boneName) => {
      const bone = characterRoot.getObjectByName?.(boneName);
      if (!bone?.isBone) return;
      const target = approvedGripTargetTransform(
        characterRuntime,
        pose,
        boneName,
        transform
      );
      if (target.position) bone.position.copy(target.position);
      if (target.quaternion) bone.quaternion.copy(target.quaternion);
      else if (transform.quaternion?.length === 4) bone.quaternion.fromArray(transform.quaternion).normalize();
    });
    characterRoot.updateMatrixWorld(true);
    const mounted = mountApprovedWeapon(actor, pose, id);
    if (!mounted) {
      restoreApprovedWeaponGrip(actor);
      return false;
    }
    const supportTarget = approvedWeaponSupportTarget(actor, mounted.weaponGroup, pose, firearmProfile);
    if (!supportTarget) return true;
    return solveApprovedSupportArm(characterRoot, supportTarget);
  }

  function applyApprovedAssaultRifleGrip(actor, weaponId = '') {
    return applyApprovedWeaponGrip(actor, weaponId);
  }

  function preloadApprovedHumanoidAssets() {
    const appearance = normalizeCharacterAppearance(characterProfile?.appearance || {});
    return Promise.all([
      loadApprovedNpcAnimationClips(),
      loadApprovedEquipmentTemplate('boots', `${appearance.sex}_${appearance.bodyType}`),
      loadApprovedAssaultRifleGrip()
    ]);
  }
