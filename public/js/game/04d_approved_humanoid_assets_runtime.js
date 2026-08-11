  // ===== APPROVED HUMANOID NPC / BOOTS / ASSAULT-RIFLE RUNTIME =====
  const APPROVED_HUMANOID_ASSET_VERSION = '7.76.6-approved-humanoid-assets-v22-backward-locomotion';
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
    rocketLauncher: Object.freeze({ reloadNodes: ['rocket_round', 'socket_reload'], reloadRotation: [-0.15, -0.55, -0.4], fallbackReload: [0, 0.08, 0.22] }),
    revolver: Object.freeze({ reloadNodes: ['cylinder', 'socket_reload'], reloadRotation: [0.05, -0.25, -1.0], fallbackReload: [0, 0.06, 0.1] }),
    sawedOffShotgun: Object.freeze({ reloadNodes: ['reload_shell', 'socket_reload'], reloadRotation: [-0.55, 0.0, -0.35], fallbackReload: [0.04, -0.02, 0.2] }),
    smg: Object.freeze({ reloadNodes: ['magazine', 'socket_reload'], reloadRotation: [0.05, -0.25, -0.9], fallbackReload: [0, 0.1, -0.15] })
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
    assaultBoots: Object.freeze({
      itemId: 'assaultBoots',
      slot: 'boots',
      urls: approvedEquipmentBodyUrls('boots', 'equipment_assault_boots')
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
    preWarHelmet: Object.freeze({
      itemId: 'preWarHelmet',
      slot: 'helmet',
      urls: approvedEquipmentBodyUrls('helmet', 'equipment_prewar_helmet')
    }),
    weldedHelmet: Object.freeze({
      itemId: 'weldedHelmet',
      slot: 'helmet',
      urls: approvedEquipmentBodyUrls('helmet', 'equipment_welded_helmet')
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
          ['attack', 'hurt', 'death', 'turn'].includes(String(clip?.name || '').toLowerCase())
        ));
        const names = new Set(clips.map(clip => String(clip?.name || '').toLowerCase()));
        // turn необязателен: устаревший кэш без него не должен ломать боевые клипы.
        if (!['attack', 'hurt', 'death'].every(name => names.has(name))) {
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
      if (APPROVED_LOOP_LOCOMOTION_CLIPS.includes(name)) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      runtime.actions[name] = action;
    });
    runtime.approvedNpcAnimationsInstalled = ['attack', 'hurt', 'death'].every(name => runtime.actions?.[name]);
    return runtime.approvedNpcAnimationsInstalled;
  }

  // Игроку и удалённым игрокам боевые клипы НПС не ставим (их бой рисует свой
  // слой), но зацикленные клипы локомоции — переступание, шаг назад и ходьбу
  // в приседе — нужны всем гуманоидам одинаково.
  const APPROVED_LOOP_LOCOMOTION_CLIPS = Object.freeze([
    'turn', 'walk_back', 'run_back', 'crouch_walk', 'crouch_walk_back'
  ]);

  function attachApprovedTurnAnimation(runtime) {
    if (!runtime?.mixer) return Promise.resolve(false);
    const missing = () => APPROVED_LOOP_LOCOMOTION_CLIPS.filter(name => !runtime.actions?.[name]);
    if (!missing().length) return Promise.resolve(true);
    return loadApprovedNpcAnimationClips().then(clips => {
      for (const name of missing()) {
        const clip = clips.find(row => String(row?.name || '').toLowerCase() === name);
        if (!clip || runtime.actions?.[name]) continue;
        const action = runtime.mixer.clipAction(clip, runtime.root);
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        runtime.actions[name] = action;
      }
      return !missing().length;
    });
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
    if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(actor);
    }
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
      if (typeof enableConservativeCharacterFrustumCulling === 'function') {
        enableConservativeCharacterFrustumCulling(mesh, 2.4);
      } else {
        mesh.frustumCulled = true;
      }
      mesh.userData = {
        ...(sourceMesh.userData || {}),
        approvedEquipmentSharedAsset: true
      };
      if (characterRoot.userData?.enemy) mesh.userData.enemy = characterRoot.userData.enemy;
      if (characterRoot.userData?.traderNpc) mesh.userData.traderNpc = characterRoot.userData.traderNpc;
      if (characterRoot.userData?.remotePlayerRow) mesh.userData.remotePlayerRow = characterRoot.userData.remotePlayerRow;
      mesh.userData.approvedEquipmentSourceName = sourceMesh.name;
      mesh.userData.approvedBackpackLayer = String(
        sourceMesh.userData?.realm_backpack_layer
        || sourceMesh.parent?.userData?.realm_backpack_layer
        || ''
      );
      mesh.userData.approvedEquipmentBasePositionZ = mesh.position.z;
      group.add(mesh);
    }
    if (typeof shareCompatibleCharacterSkeletons === 'function') {
      shareCompatibleCharacterSkeletons(group);
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
    const characterRuntime = approvedActorCharacterRuntime(actor);
    const itemId = String(equipmentVisualBaseId(eq?.[slot] || '') || '');
    const definition = APPROVED_EQUIPMENT_ASSETS[itemId];
    const wanted = definition?.slot === slot && !!characterRuntime?.root;
    actor.userData.approvedEquipmentRuntimes = actor.userData.approvedEquipmentRuntimes || {};
    const current = actor.userData.approvedEquipmentRuntimes[slot];
    if (!wanted) {
      if (current) removeApprovedEquipmentRuntime(actor, slot);
      // У предмета есть утверждённая модель, но GLB-персонаж ещё грузится:
      // старые процедурные части всё равно прячем, чтобы они не мелькали —
      // утверждённая модель встанет сразу после загрузки персонажа.
      if (definition?.slot === slot) {
        approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
      }
      syncApprovedHazmatHoodVisibility(actor, eq);
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor, parts);
      }
      return false;
    }
    const bodyKey = approvedEquipmentBodyKey(actor);
    if (current?.itemId === itemId && current?.bodyKey === bodyKey && current.mesh?.parent === characterRuntime.root) {
      placeApprovedEquipmentRuntime(current.mesh, slot, eq);
      approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
      syncApprovedHazmatHoodVisibility(actor, eq);
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor, parts);
      }
      return true;
    }
    removeApprovedEquipmentRuntime(actor, slot);
    actor.userData.approvedEquipmentRequestIds = actor.userData.approvedEquipmentRequestIds || {};
    const requestId = Number(actor.userData.approvedEquipmentRequestIds[slot] || 0) + 1;
    actor.userData.approvedEquipmentRequestIds[slot] = requestId;
    actor.userData.approvedEquipmentRuntimes[slot] = { itemId, bodyKey, requestId, mesh: null };
    // Утверждённая модель уже выбрана — старый процедурный вариант не должен
    // мелькать, пока GLB грузится. Если загрузка сорвётся, вернём его.
    approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
    if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(actor, parts);
    }
    const restoreFallback = () => {
      if (actor.userData.approvedEquipmentRuntimes?.[slot]?.requestId !== requestId) return;
      approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = true; });
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor, parts);
      }
    };
    loadApprovedEquipmentTemplate(itemId, bodyKey).then(template => {
      const runtime = actor.userData.approvedEquipmentRuntimes?.[slot];
      const activeCharacter = approvedActorCharacterRuntime(actor);
      const activeEquipment = actor.userData.enemyEquipment || actor.userData.equipment || eq;
      if (!template) {
        restoreFallback();
        return;
      }
      if (
        runtime?.requestId !== requestId
        || runtime?.itemId !== itemId
        || runtime?.bodyKey !== bodyKey
        || activeCharacter !== characterRuntime
        || String(equipmentVisualBaseId(activeEquipment?.[slot] || '') || '') !== itemId
      ) return;
      const mesh = makeApprovedEquipmentInstance(template, activeCharacter.root, itemId);
      if (!mesh) {
        console.warn(`Не удалось привязать утверждённую экипировку ${itemId} (${bodyKey}) к персонажу.`);
        restoreFallback();
        return;
      }
      placeApprovedEquipmentRuntime(mesh, slot, activeEquipment);
      activeCharacter.root.add(mesh);
      runtime.mesh = mesh;
      approvedEquipmentFallbackMeshes(parts, slot).forEach(fallback => { fallback.visible = false; });
      syncApprovedHazmatHoodVisibility(actor, activeEquipment);
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor, parts);
      }
    });
    return false;
  }

  // Раннее скрытие: вызывается в момент старта загрузки GLB-персонажа,
  // когда слот-запросы ещё не начались. Всё, у чего есть утверждённая
  // модель, не должно мелькать старым процедурным вариантом.
  function hideApprovedEquipmentFallbacksEarly(actor, eq = {}) {
    const parts = actor?.userData?.parts || actor?.userData?.actorParts || {};
    for (const slot of ['armor', 'helmet', 'boots', 'backpack']) {
      const itemId = String(equipmentVisualBaseId(eq?.[slot] || '') || '');
      if (APPROVED_EQUIPMENT_ASSETS[itemId]?.slot === slot) {
        approvedEquipmentFallbackMeshes(parts, slot).forEach(mesh => { mesh.visible = false; });
      }
    }
    if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(actor, parts);
    }
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
    const boneNodes = new Map();
    root.traverse(node => {
      if (!node?.isBone) return;
      boneNodes.set(node.name, node);
      bones.set(node.name, {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone()
      });
    });
    return { bones, boneNodes };
  }

  function approvedGripTargetTransform(runtime, pose, boneName, transform) {
    if (!runtime) return transform;
    if (runtime.approvedGripTargetPose !== pose) {
      runtime.approvedGripTargetPose = pose;
      runtime.approvedGripTargetTransforms = new Map();
    }
    const cached = runtime.approvedGripTargetTransforms?.get?.(boneName);
    if (cached) return cached;
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
    runtime.approvedGripTargetTransforms.set(boneName, result);
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
      const parentChanged = weaponGroup.parent !== state.parent;
      state.parent.add(weaponGroup);
      weaponGroup.position.copy(state.position);
      weaponGroup.quaternion.copy(state.quaternion);
      weaponGroup.scale.copy(state.scale);
      weaponGroup.userData.basePosition = state.basePosition.clone();
      weaponGroup.userData.baseRotation = state.baseRotation.clone();
      weaponGroup.userData.characterPose = {};
      weaponGroup.userData.approvedGripMounted = false;
      if (parentChanged && typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor);
      }
    }
    delete actor.userData.approvedWeaponGripMount;
    delete actor.userData.approvedAssaultRifleGrip;
    delete actor.userData.approvedPhysicalMeleeGripActive;
  }

  function restoreApprovedAssaultRifleGrip(actor) {
    restoreApprovedWeaponGrip(actor);
  }

  function setApprovedBoneWorldQuaternion(bone, worldQuaternion, parentQuaternionScratch = null) {
    if (!bone?.isBone || !bone.parent) return false;
    const parentQuaternion = bone.parent.getWorldQuaternion(parentQuaternionScratch || new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  function approvedArmSolveRuntime(characterRoot, side = 'l') {
    if (!characterRoot?.userData) return null;
    const suffix = side === 'r' ? 'r' : 'l';
    const cache = characterRoot.userData.approvedArmSolveRuntimes
      || (characterRoot.userData.approvedArmSolveRuntimes = {});
    if (cache[suffix]) return cache[suffix];
    const chain = [`clavicle_${suffix}`, `upperarm_${suffix}`, `lowerarm_${suffix}`, `hand_${suffix}`].map(name => (
      characterRoot.getObjectByName?.(name) || null
    ));
    if (chain.some(bone => !bone?.isBone)) return null;
    const runtime = {
      chain,
      positions: chain.map(() => new THREE.Vector3()),
      lengths: Array.from({ length: chain.length - 1 }, () => 0),
      base: new THREE.Vector3(),
      targetPosition: new THREE.Vector3(),
      targetQuaternion: new THREE.Quaternion(),
      targetScale: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      currentStart: new THREE.Vector3(),
      currentEnd: new THREE.Vector3(),
      currentDirection: new THREE.Vector3(),
      wantedDirection: new THREE.Vector3(),
      delta: new THREE.Quaternion(),
      currentWorld: new THREE.Quaternion(),
      parentWorld: new THREE.Quaternion(),
      finalPosition: new THREE.Vector3()
    };
    cache[suffix] = runtime;
    return runtime;
  }

  function solveApprovedArm(characterRoot, side = 'l', targetMatrix) {
    const solveRuntime = approvedArmSolveRuntime(characterRoot, side);
    if (!solveRuntime || !targetMatrix) return false;
    const { chain, positions, lengths } = solveRuntime;
    chain[0].updateWorldMatrix(true, true);
    for (let index = 0; index < chain.length; index += 1) {
      chain[index].getWorldPosition(positions[index]);
    }
    const base = solveRuntime.base.copy(positions[0]);
    for (let index = 0; index < chain.length - 1; index += 1) {
      lengths[index] = positions[index].distanceTo(positions[index + 1]);
    }
    if (lengths.some(length => !Number.isFinite(length) || length <= 0.0001)) return false;
    const targetPosition = solveRuntime.targetPosition;
    const targetQuaternion = solveRuntime.targetQuaternion;
    targetMatrix.decompose(targetPosition, targetQuaternion, solveRuntime.targetScale);
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    if (base.distanceTo(targetPosition) >= totalLength) {
      const direction = solveRuntime.direction.subVectors(targetPosition, base).normalize();
      for (let index = 1; index < positions.length; index += 1) {
        positions[index].copy(positions[index - 1]).addScaledVector(direction, lengths[index - 1]);
      }
    } else {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        positions[positions.length - 1].copy(targetPosition);
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          const direction = solveRuntime.direction.subVectors(positions[index], positions[index + 1]).normalize();
          positions[index].copy(positions[index + 1]).addScaledVector(direction, lengths[index]);
        }
        positions[0].copy(base);
        for (let index = 1; index < positions.length; index += 1) {
          const direction = solveRuntime.direction.subVectors(positions[index], positions[index - 1]).normalize();
          positions[index].copy(positions[index - 1]).addScaledVector(direction, lengths[index - 1]);
        }
        if (positions[positions.length - 1].distanceTo(targetPosition) < 0.001) break;
      }
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].updateWorldMatrix(true, true);
      chain[index].getWorldPosition(solveRuntime.currentStart);
      chain[index + 1].getWorldPosition(solveRuntime.currentEnd);
      solveRuntime.currentDirection
        .subVectors(solveRuntime.currentEnd, solveRuntime.currentStart)
        .normalize();
      solveRuntime.wantedDirection
        .subVectors(positions[index + 1], positions[index])
        .normalize();
      solveRuntime.delta.setFromUnitVectors(
        solveRuntime.currentDirection,
        solveRuntime.wantedDirection
      );
      chain[index].getWorldQuaternion(solveRuntime.currentWorld);
      if (!setApprovedBoneWorldQuaternion(
        chain[index],
        solveRuntime.delta.multiply(solveRuntime.currentWorld),
        solveRuntime.parentWorld
      )) return false;
    }
    if (!setApprovedBoneWorldQuaternion(
      chain[chain.length - 1],
      targetQuaternion,
      solveRuntime.parentWorld
    )) return false;
    chain[0].updateWorldMatrix(true, true);
    return chain[chain.length - 1]
      .getWorldPosition(solveRuntime.finalPosition)
      .distanceTo(targetPosition) < 0.01;
  }

  function solveApprovedSupportArm(characterRoot, targetMatrix) {
    return solveApprovedArm(characterRoot, 'l', targetMatrix);
  }

  // Когда прицел брался с земли, а ствол жил на высоте груди, между ними
  // набегало около 1.1 м, и доворот доходил до 48°: на таких углах оружие
  // выкручивалось из кисти и выворачивало локоть. С прицелом на высоте ствола
  // остаётся чистое смещение руки — единицы градусов, — поэтому предел снова
  // узкий и служит защитой от вырожденных случаев, когда точка прицела
  // оказывается вплотную к стволу или позади актёра.
  const APPROVED_WEAPON_AIM_CONVERGENCE_LIMIT = 0.35;

  function approvedWeaponAimPoint(actor) {
    if (typeof playerGroup === 'undefined' || actor !== playerGroup) return null;
    // Наводимся на точку курсора, взятую на высоте ствола, а не на земле:
    // иначе ствол доворачивает на проекцию, лежащую дальше по лучу камеры.
    const elevated = typeof pointerHasAimWorld !== 'undefined' && pointerHasAimWorld
      && typeof pointerAimWorld !== 'undefined' && pointerAimWorld;
    const source = elevated ? pointerAimWorld : (typeof pointerWorld !== 'undefined' ? pointerWorld : null);
    if (!elevated && (typeof pointerHasWorld === 'undefined' || !pointerHasWorld)) return null;
    if (!source) return null;
    const x = Number(source.x);
    const z = Number(source.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z };
  }

  // The grip pose seats the weapon in the hand, which sits off the character
  // centre, so the barrel stays parallel to the aim line and the shot passes
  // beside the cursor. Pivot the weapon about its own grip until the barrel
  // axis runs through the aim point. The grip pose itself is untouched, so the
  // hand keeps holding the weapon exactly where the animation put it.
  // Доворот корпуса добирает то, что не влезло в предел оружия. Поворот
  // раскладывается по трём позвонкам, поэтому корпус разворачивается плавной
  // дугой, а не одним шарниром. Кости позы переустанавливаются каждый кадр, так
  // что смещение не накапливается.
  const APPROVED_TORSO_AIM_BONES = Object.freeze(['spine_01', 'spine_02', 'spine_03']);
  const APPROVED_TORSO_AIM_LIMIT = 1.2;

  function rotateApprovedTorsoTowardAim(characterRoot, angle) {
    if (!characterRoot || !Number.isFinite(angle)) return false;
    const total = Math.max(-APPROVED_TORSO_AIM_LIMIT, Math.min(APPROVED_TORSO_AIM_LIMIT, angle));
    const share = total / APPROVED_TORSO_AIM_BONES.length;
    if (Math.abs(share) < 0.0005) return false;
    const up = new THREE.Vector3(0, 1, 0);
    const yaw = new THREE.Quaternion().setFromAxisAngle(up, share);
    const parentWorld = new THREE.Quaternion();
    let applied = false;
    for (const name of APPROVED_TORSO_AIM_BONES) {
      const bone = characterRoot.getObjectByName?.(name);
      if (!bone?.isBone) continue;
      if (bone.parent) {
        bone.parent.updateWorldMatrix(true, false);
        bone.parent.getWorldQuaternion(parentWorld);
      } else {
        parentWorld.identity();
      }
      bone.quaternion.premultiply(
        parentWorld.clone().invert().multiply(yaw).multiply(parentWorld)
      );
      applied = true;
    }
    return applied;
  }

  // «Поднятое положение» (high-ready): если перед стволом препятствие,
  // оружие плавно поднимается к груди и не пересекает геометрию. Щуп идёт
  // вдоль ствола прошлого кадра по статической коллизии локации.
  function updateApprovedWeaponObstruction(actor, weaponGroup) {
    if (!actor?.userData) return 0;
    let target = 0;
    if (weaponGroup && actor === (typeof playerGroup !== 'undefined' ? playerGroup : actor)) {
      const grip = approvedWeaponSocket(weaponGroup, ['socket_grip_r']);
      const muzzle = approvedWeaponSocket(weaponGroup, ['socket_muzzle']);
      if (grip && muzzle) {
        const g = grip.getWorldPosition(new THREE.Vector3());
        const m = muzzle.getWorldPosition(new THREE.Vector3());
        const dx = m.x - g.x;
        const dz = m.z - g.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.05) {
          const nx = dx / len;
          const nz = dz / len;
          // Препятствием считаем и статическую коллизию (стены), и
          // динамические объекты локации (верстаки, ящики, машины) —
          // движение игрока блокируют обе системы, щуп обязан видеть обе.
          const probeBlocked = (px, pz) => (
            (typeof isBlockedByStaticCollision === 'function' && isBlockedByStaticCollision(px, pz, 0.18))
            || (typeof playerDynamicObstaclePenaltyAt === 'function' && playerDynamicObstaclePenaltyAt(px, pz) > 0.0001)
          );
          if (probeBlocked(g.x + nx * 0.55, g.z + nz * 0.55) || probeBlocked(g.x + nx * 0.95, g.z + nz * 0.95)) {
            target = 1;
          }
        }
      }
    }
    const previous = Math.max(0, Math.min(1, Number(actor.userData.weaponObstructedBlend || 0)));
    const blend = previous + (target - previous) * 0.16;
    actor.userData.weaponObstructedBlend = blend < 0.005 ? 0 : blend;
    return actor.userData.weaponObstructedBlend;
  }

  // Подъём ствола вокруг рукояти: дуло уходит вверх, рукоять остаётся в
  // кисти, левая рука на цевье (IK считается уже после подъёма).
  function applyApprovedWeaponReadyRaise(weaponGroup, runtimeRoot, blend = 0) {
    if (!weaponGroup || !runtimeRoot || blend <= 0.01) return;
    const grip = approvedWeaponSocket(weaponGroup, ['socket_grip_r']);
    const muzzle = approvedWeaponSocket(weaponGroup, ['socket_muzzle']);
    if (!grip || !muzzle) return;
    grip.updateWorldMatrix(true, false);
    muzzle.updateWorldMatrix(true, false);
    const pivot = grip.getWorldPosition(new THREE.Vector3());
    const tip = muzzle.getWorldPosition(new THREE.Vector3());
    const barrel = tip.sub(pivot);
    barrel.y = 0;
    if (barrel.lengthSq() < 0.002) return;
    barrel.normalize();
    const rightAxis = new THREE.Vector3().crossVectors(barrel, new THREE.Vector3(0, 1, 0)).normalize();
    const pitch = new THREE.Matrix4().makeRotationAxis(rightAxis, blend * 1.05);
    const pivoted = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(pitch)
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .multiply(weaponGroup.matrixWorld);
    runtimeRoot.updateMatrixWorld(true);
    runtimeRoot.matrixWorld.clone().invert().multiply(pivoted)
      .decompose(weaponGroup.position, weaponGroup.quaternion, weaponGroup.scale);
    weaponGroup.updateMatrixWorld(true);
  }

  function applyApprovedWeaponAimConvergence(actor, weaponGroup, primarySocket, runtimeRoot) {
    if (weaponGroup) {
      weaponGroup.userData.approvedAimConverged = false;
      weaponGroup.userData.aimConvergenceResidual = 0;
    }
    const aim = approvedWeaponAimPoint(actor);
    if (!aim || !weaponGroup || !primarySocket || !runtimeRoot) return;
    const muzzle = approvedWeaponSocket(weaponGroup, ['socket_muzzle']);
    if (!muzzle) return;
    primarySocket.updateWorldMatrix(true, false);
    muzzle.updateWorldMatrix(true, false);
    const pivot = primarySocket.getWorldPosition(new THREE.Vector3());
    const tip = muzzle.getWorldPosition(new THREE.Vector3());
    const barrelX = tip.x - pivot.x;
    const barrelZ = tip.z - pivot.z;
    if (Math.hypot(barrelX, barrelZ) < 0.05) return;
    const aimX = aim.x - pivot.x;
    const aimZ = aim.z - pivot.z;
    if (Math.hypot(aimX, aimZ) < 0.35) return;
    let delta = Math.atan2(aimX, aimZ) - Math.atan2(barrelX, barrelZ);
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const requested = delta;
    delta = Math.max(
      -APPROVED_WEAPON_AIM_CONVERGENCE_LIMIT,
      Math.min(APPROVED_WEAPON_AIM_CONVERGENCE_LIMIT, delta)
    );
    // У препятствия ствол поднят — доворот к курсору гасим, иначе оружие
    // «летает» в попытке навестись сквозь упор.
    delta *= 1 - Math.max(0, Math.min(1, Number(actor?.userData?.weaponObstructedBlend || 0)));
    // Остаток, который оружию не отдали, забирает корпус: ствол обязан прийти
    // в курсор, а выкручивать его в кисти дальше предела нельзя.
    weaponGroup.userData.aimConvergenceResidual = requested - delta;
    if (Math.abs(delta) < 0.0005) return;
    const pivoted = new THREE.Matrix4()
      .makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(new THREE.Matrix4().makeRotationY(delta))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .multiply(weaponGroup.matrixWorld);
    runtimeRoot.updateMatrixWorld(true);
    runtimeRoot.matrixWorld.clone().invert().multiply(pivoted)
      .decompose(weaponGroup.position, weaponGroup.quaternion, weaponGroup.scale);
    weaponGroup.updateMatrixWorld(true);
    weaponGroup.userData.approvedAimConverged = true;
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
    if (weaponGroup.parent !== runtime.root) {
      runtime.root.add(weaponGroup);
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor);
      }
    }
    const mountLocal = runtime.root.matrixWorld.clone().invert().multiply(weaponWorld);
    mountLocal.decompose(weaponGroup.position, weaponGroup.quaternion, weaponGroup.scale);
    weaponGroup.updateMatrixWorld(true);
    applyApprovedWeaponAimConvergence(actor, weaponGroup, primarySocket, runtime.root);
    weaponGroup.userData.basePosition = weaponGroup.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(weaponGroup.quaternion);
    weaponGroup.userData.characterPose = {};
    weaponGroup.userData.approvedGripMounted = true;
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
    if (weaponGroup.parent !== characterRuntime.root) {
      characterRuntime.root.add(weaponGroup);
      if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
        invalidateModernProceduralRigAnimationCache(actor);
      }
    }
    weaponGroup.position.copy(weaponPosition);
    weaponGroup.quaternion.copy(weaponQuaternion).normalize();
    weaponGroup.scale.copy(state.scale);
    weaponGroup.userData.basePosition = weaponGroup.position.clone();
    weaponGroup.userData.baseRotation = new THREE.Euler().setFromQuaternion(weaponGroup.quaternion);
    weaponGroup.userData.characterPose = {};
    weaponGroup.userData.approvedGripMounted = true;
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
    updateApprovedWeaponObstruction(actor, approvedActorWeaponGroup(actor));
    pose.bones.forEach((transform, boneName) => {
      const bone = characterRuntime.approvedAssaultRifleRestPose?.boneNodes?.get?.(boneName)
        || characterRoot.getObjectByName?.(boneName);
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
    let mounted = mountApprovedWeapon(actor, pose, id);
    // Если оружию не хватило собственного предела, добираем корпусом и ставим
    // оружие заново: рука уехала вместе с корпусом, и остаточный доворот уже
    // укладывается в предел.
    const residual = Number(mounted?.weaponGroup?.userData?.aimConvergenceResidual || 0);
    if (Math.abs(residual) > 0.002 && rotateApprovedTorsoTowardAim(characterRoot, residual)) {
      characterRoot.updateMatrixWorld(true);
      mounted = mountApprovedWeapon(actor, pose, id) || mounted;
    }
    if (!mounted) {
      restoreApprovedWeaponGrip(actor);
      return false;
    }
    applyApprovedWeaponReadyRaise(
      mounted.weaponGroup,
      characterRoot,
      Number(actor.userData.weaponObstructedBlend || 0)
    );
    const supportTarget = approvedWeaponSupportTarget(actor, mounted.weaponGroup, pose, firearmProfile);
    if (!supportTarget) return true;
    return solveApprovedSupportArm(characterRoot, supportTarget);
  }

  function applyApprovedAssaultRifleGrip(actor, weaponId = '') {
    return applyApprovedWeaponGrip(actor, weaponId);
  }

  function preloadApprovedHumanoidAssets(options = {}) {
    const legacyFullPreload = arguments.length === 0;
    const appearance = normalizeCharacterAppearance(
      options.appearance || characterProfile?.appearance || {}
    );
    const bodyKey = `${appearance.sex}_${appearance.bodyType}`;
    const activeEquipment = options.equipment && typeof options.equipment === 'object'
      ? options.equipment
      : (legacyFullPreload ? { boots: 'boots' } : {});
    const promises = [];
    for (const slot of ['armor', 'helmet', 'boots', 'backpack']) {
      const itemId = String(equipmentVisualBaseId(activeEquipment[slot] || '') || '');
      if (APPROVED_EQUIPMENT_ASSETS[itemId]?.slot === slot) {
        promises.push(loadApprovedEquipmentTemplate(itemId, bodyKey));
      }
    }
    const weaponIds = (Array.isArray(options.weaponIds) ? options.weaponIds : [])
      .map(id => String(equipmentVisualBaseId(id || '') || ''));
    if (legacyFullPreload || weaponIds.some(id => APPROVED_FIREARM_GRIP_PROFILES[id])) {
      promises.push(loadApprovedAssaultRifleGrip());
    }
    if (legacyFullPreload || options.includeNpcAnimations === true) {
      promises.push(loadApprovedNpcAnimationClips());
    }
    return Promise.all(promises);
  }
