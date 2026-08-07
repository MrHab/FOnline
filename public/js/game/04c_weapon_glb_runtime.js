  // ===== B+C WEAPON GLB RUNTIME =====
  const WEAPON_MODEL_ASSET_VERSION = '7.82.0-muzzle-sockets-v1';
  const WEAPON_MODEL_CATALOG = Object.freeze({
    pistol: { file: '/assets/models/weapons/weapon_pistol.glb', family: 'sidearm' },
    rifle: { file: '/assets/models/weapons/weapon_rifle.glb', family: 'long_gun' },
    assaultRifle: { file: '/assets/models/weapons/weapon_assaultRifle.glb', family: 'long_gun' },
    machineGun: { file: '/assets/models/weapons/weapon_machineGun.glb', family: 'heavy' },
    laserPistol: { file: '/assets/models/weapons/weapon_laserPistol.glb', family: 'energy_sidearm' },
    flamethrower: { file: '/assets/models/weapons/weapon_flamethrower.glb', family: 'heavy' },
    plasmaRifle: { file: '/assets/models/weapons/weapon_plasmaRifle.glb', family: 'energy_long_gun' },
    shotgun: { file: '/assets/models/weapons/weapon_shotgun.glb', family: 'long_gun' },
    rocketLauncher: { file: '/assets/models/weapons/weapon_rocketLauncher.glb', family: 'launcher' },
    knife: { file: '/assets/models/weapons/weapon_knife.glb', family: 'melee_light' },
    pickaxe: { file: '/assets/models/weapons/weapon_pickaxe.glb', family: 'melee_heavy' },
    axe: { file: '/assets/models/weapons/weapon_axe.glb', family: 'melee_heavy' },
    handPump: { file: '/assets/models/weapons/weapon_handPump.glb', family: 'melee_heavy' }
  });

  const weaponModelLibraryState = {
    promise: null,
    templates: new Map(),
    failed: new Set()
  };

  function weaponModelCatalogEntry(weaponId = '') {
    const id = typeof equipmentVisualBaseId === 'function'
      ? equipmentVisualBaseId(weaponId)
      : String(weaponId || '');
    return WEAPON_MODEL_CATALOG[id] ? { id, ...WEAPON_MODEL_CATALOG[id] } : null;
  }

  function prepareWeaponModelTemplate(entry, gltf) {
    const source = gltf?.scene || gltf?.scenes?.[0] || null;
    if (!source) return null;
    source.name = `weapon_template_${entry.id}`;
    source.userData.weaponId = entry.id;
    source.userData.weaponFamily = entry.family;
    source.traverse(part => {
      if (!part) return;
      part.userData.weaponSharedAsset = true;
      part.frustumCulled = false;
      if (part.isMesh) {
        part.castShadow = true;
        part.receiveShadow = false;
      }
    });
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source);
    if (bounds.isEmpty()) return null;
    return {
      id: entry.id,
      family: entry.family,
      scene: source,
      animations: Array.isArray(gltf.animations) ? gltf.animations : []
    };
  }

  function loadWeaponModelTemplate(entry) {
    if (!entry || weaponModelLibraryState.templates.has(entry.id)) {
      return Promise.resolve(weaponModelLibraryState.templates.get(entry?.id) || null);
    }
    if (weaponModelLibraryState.failed.has(entry.id) || !THREE.GLTFLoader) return Promise.resolve(null);
    return new Promise(resolve => {
      const loader = new THREE.GLTFLoader();
      loader.load(`${entry.file}?v=${encodeURIComponent(WEAPON_MODEL_ASSET_VERSION)}`, gltf => {
        const template = prepareWeaponModelTemplate(entry, gltf);
        if (!template) {
          weaponModelLibraryState.failed.add(entry.id);
          console.warn(`GLB-оружие ${entry.id} не содержит пригодной runtime-сцены.`);
          resolve(null);
          return;
        }
        weaponModelLibraryState.templates.set(entry.id, template);
        resolve(template);
      }, undefined, error => {
        weaponModelLibraryState.failed.add(entry.id);
        console.warn(`Не удалось загрузить GLB-оружие ${entry.id}.`, error);
        resolve(null);
      });
    });
  }

  function preloadWeaponModelLibrary() {
    if (weaponModelLibraryState.templates.size === Object.keys(WEAPON_MODEL_CATALOG).length) {
      return Promise.resolve(weaponModelLibraryState.templates);
    }
    if (weaponModelLibraryState.promise) return weaponModelLibraryState.promise;
    weaponModelLibraryState.promise = Promise.all(
      Object.keys(WEAPON_MODEL_CATALOG).map(id => loadWeaponModelTemplate({ id, ...WEAPON_MODEL_CATALOG[id] }))
    ).then(() => {
      weaponModelLibraryState.promise = null;
      if (typeof updatePlayerEquipmentVisuals === 'function' && typeof playerGroup !== 'undefined' && playerGroup) {
        updatePlayerEquipmentVisuals();
      }
      return weaponModelLibraryState.templates;
    });
    return weaponModelLibraryState.promise;
  }

  function weaponAnimationRuntimeFor(root, template) {
    if (!root || !template?.animations?.length || !THREE.AnimationMixer) return null;
    const mixer = new THREE.AnimationMixer(root);
    const clips = new Map(template.animations.map(clip => [String(clip.name || '').toLowerCase(), clip]));
    const runtime = {
      mixer,
      clips,
      idleAction: null,
      currentAction: null
    };
    const playIdle = () => {
      const idleClip = clips.get('idle');
      if (!idleClip) return;
      const action = mixer.clipAction(idleClip);
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.play();
      runtime.idleAction = action;
    };
    mixer.addEventListener('finished', event => {
      if (event?.action !== runtime.currentAction) return;
      runtime.currentAction = null;
      playIdle();
    });
    runtime.playIdle = playIdle;
    playIdle();
    return runtime;
  }

  function makeWeaponModelMesh(weaponId = '') {
    const entry = weaponModelCatalogEntry(weaponId);
    const template = entry ? weaponModelLibraryState.templates.get(entry.id) : null;
    if (!template?.scene) return null;
    const root = template.scene.clone(true);
    root.name = `weapon_runtime_${entry.id}`;
    root.userData.weaponId = entry.id;
    root.userData.weaponFamily = entry.family;
    root.userData.weaponSharedAsset = true;
    root.userData.weaponAnimationRuntime = weaponAnimationRuntimeFor(root, template);
    root.traverse(part => {
      part.userData.weaponSharedAsset = true;
      part.frustumCulled = false;
      if (part.isMesh) part.castShadow = true;
    });
    return root;
  }

  function weaponModelRootFromGroup(weaponGroup) {
    if (!weaponGroup) return null;
    if (weaponGroup.userData?.weaponAnimationRuntime) return weaponGroup;
    return weaponGroup.children?.find(child => child?.userData?.weaponAnimationRuntime) || null;
  }

  function triggerWeaponModelAction(weaponGroup, actionName = 'attack', options = {}) {
    const root = weaponModelRootFromGroup(weaponGroup);
    const runtime = root?.userData?.weaponAnimationRuntime;
    const clip = runtime?.clips?.get(String(actionName || '').toLowerCase());
    if (!runtime || !clip) return false;
    runtime.mixer.stopAllAction();
    const action = runtime.mixer.clipAction(clip);
    action.reset();
    const requestedDuration = Number(options?.duration || 0);
    action.timeScale = requestedDuration > 0 && Number(clip.duration) > 0
      ? Number(clip.duration) / requestedDuration
      : 1;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    runtime.currentAction = action;
    return true;
  }

  function updateWeaponModelAnimation(weaponGroup, dt = 0.016) {
    const root = weaponModelRootFromGroup(weaponGroup);
    const runtime = root?.userData?.weaponAnimationRuntime;
    if (runtime?.mixer) runtime.mixer.update(Math.max(0, Math.min(0.05, Number(dt || 0.016))));
  }

  function weaponModelFamily(weaponId = '') {
    return weaponModelCatalogEntry(weaponId)?.family || (
      ['knife'].includes(weaponId) ? 'melee_light'
        : ['pickaxe', 'axe', 'handPump'].includes(weaponId) ? 'melee_heavy'
          : 'unarmed'
    );
  }
