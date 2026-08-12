  // ===== B+C WEAPON GLB RUNTIME =====
  const WEAPON_MODEL_ASSET_VERSION = '7.93.0-deterministic-weapons-v1-b13d09c0';
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
    revolver: { file: '/assets/models/weapons/weapon_revolver.glb', family: 'sidearm' },
    sawedOffShotgun: { file: '/assets/models/weapons/weapon_sawedOffShotgun.glb', family: 'sidearm' },
    smg: { file: '/assets/models/weapons/weapon_smg.glb', family: 'long_gun' },
    knife: { file: '/assets/models/weapons/weapon_knife.glb', family: 'melee_light' },
    pickaxe: { file: '/assets/models/weapons/weapon_pickaxe.glb', family: 'melee_heavy' },
    axe: { file: '/assets/models/weapons/weapon_axe.glb', family: 'melee_heavy' },
    handPump: { file: '/assets/models/weapons/weapon_handPump.glb', family: 'melee_heavy' }
  });

  const weaponModelLibraryState = {
    promise: null,
    templates: new Map(),
    promises: new Map(),
    failures: new Map(),
    nextRetryAt: new Map()
  };
  const WEAPON_GLB_FLIGHT_RETRY_DELAYS_MS = Object.freeze([350, 900, 2_200]);
  const WEAPON_GLB_RETRY_COOLDOWN_MS = 7_000;
  const WEAPON_GLB_GROUP_RETRY_MAX_DELAY_MS = 30_000;
  const weaponGlbActiveLoadKeys = new Set();
  let weaponGlbLoadRevision = 0;

  function markWeaponGlbLoadStarted(key = '') {
    weaponGlbActiveLoadKeys.add(String(key || ''));
    weaponGlbLoadRevision += 1;
  }

  function markWeaponGlbLoadSettled(key = '') {
    weaponGlbActiveLoadKeys.delete(String(key || ''));
    weaponGlbLoadRevision += 1;
  }

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
    if (weaponModelLibraryState.promises.has(entry.id)) {
      return weaponModelLibraryState.promises.get(entry.id);
    }
    if (!THREE.GLTFLoader) return Promise.resolve(null);
    const promise = new Promise(resolve => {
      let flightAttempt = 0;
      const finishFailure = error => {
        markWeaponGlbLoadSettled(entry.id);
        weaponModelLibraryState.failures.set(
          entry.id,
          Math.max(0, Number(weaponModelLibraryState.failures.get(entry.id) || 0)) + 1
        );
        const retryIndex = Math.min(flightAttempt, WEAPON_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1);
        const retryDelay = WEAPON_GLB_FLIGHT_RETRY_DELAYS_MS[retryIndex];
        weaponModelLibraryState.nextRetryAt.set(entry.id, Date.now() + retryDelay);
        if (flightAttempt < WEAPON_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1) {
          flightAttempt += 1;
          setTimeout(runAttempt, retryDelay);
          return;
        }
        weaponModelLibraryState.nextRetryAt.set(entry.id, Date.now() + WEAPON_GLB_RETRY_COOLDOWN_MS);
        console.warn(`Не удалось загрузить GLB-оружие ${entry.id}; процедурная замена отключена.`, error);
        resolve(null);
      };
      const runAttempt = () => {
        markWeaponGlbLoadStarted(entry.id);
        if (!THREE.GLTFLoader) {
          finishFailure(new Error('THREE.GLTFLoader is unavailable'));
          return;
        }
        const loader = new THREE.GLTFLoader();
        loader.load(`${entry.file}?v=${encodeURIComponent(WEAPON_MODEL_ASSET_VERSION)}`, gltf => {
          const template = prepareWeaponModelTemplate(entry, gltf);
          if (!template) {
            finishFailure(new Error('GLB has no usable runtime scene'));
            return;
          }
          weaponModelLibraryState.templates.set(entry.id, template);
          weaponModelLibraryState.failures.delete(entry.id);
          weaponModelLibraryState.nextRetryAt.delete(entry.id);
          markWeaponGlbLoadSettled(entry.id);
          resolve(template);
        }, undefined, finishFailure);
      };
      const initialDelay = Math.max(
        0,
        Number(weaponModelLibraryState.nextRetryAt.get(entry.id) || 0) - Date.now()
      );
      if (initialDelay > 0) setTimeout(runAttempt, initialDelay);
      else runAttempt();
    }).finally(() => {
      weaponModelLibraryState.promises.delete(entry.id);
    });
    weaponModelLibraryState.promises.set(entry.id, promise);
    return promise;
  }

  function pendingWeaponGlbAssetSnapshot() {
    const activeKeys = Array.from(weaponGlbActiveLoadKeys).filter(Boolean);
    const failedKeys = Array.from(weaponModelLibraryState.failures.keys())
      .filter(key => !weaponModelLibraryState.templates.has(key));
    const unresolvedKeys = new Set([...activeKeys, ...failedKeys]);
    const passiveRetryKeys = failedKeys.filter(key => (
      !weaponGlbActiveLoadKeys.has(key)
      && weaponModelLibraryState.nextRetryAt.has(key)
    ));
    return {
      revision: weaponGlbLoadRevision,
      promises: Array.from(new Set(activeKeys
        .map(key => weaponModelLibraryState.promises.get(key))
        .filter(Boolean))),
      activeCount: activeKeys.length,
      unresolvedCount: unresolvedKeys.size,
      retryScheduledCount: passiveRetryKeys.length
    };
  }

  function preloadWeaponModels(weaponIds = []) {
    const entries = Array.from(new Set((Array.isArray(weaponIds) ? weaponIds : [weaponIds])
      .map(id => weaponModelCatalogEntry(id)?.id || '')
      .filter(Boolean)))
      .map(id => ({ id, ...WEAPON_MODEL_CATALOG[id] }));
    if (!entries.length) return Promise.resolve(weaponModelLibraryState.templates);
    return Promise.all(entries.map(loadWeaponModelTemplate)).then(() => {
      if (typeof updatePlayerEquipmentVisuals === 'function' && typeof playerGroup !== 'undefined' && playerGroup) {
        updatePlayerEquipmentVisuals();
      }
      return weaponModelLibraryState.templates;
    });
  }

  function preloadWeaponModelLibrary() {
    if (weaponModelLibraryState.templates.size === Object.keys(WEAPON_MODEL_CATALOG).length) {
      return Promise.resolve(weaponModelLibraryState.templates);
    }
    if (weaponModelLibraryState.promise) return weaponModelLibraryState.promise;
    weaponModelLibraryState.promise = preloadWeaponModels(Object.keys(WEAPON_MODEL_CATALOG)).then(() => {
      weaponModelLibraryState.promise = null;
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
    if (!template?.scene) {
      if (entry) void loadWeaponModelTemplate(entry);
      return null;
    }
    const root = template.scene.clone(true);
    root.name = `weapon_runtime_${entry.id}`;
    root.userData.weaponId = entry.id;
    root.userData.weaponFamily = entry.family;
    root.userData.weaponSharedAsset = true;
    root.userData.weaponAnimationRuntime = weaponAnimationRuntimeFor(root, template);
    root.traverse(part => {
      part.userData.weaponSharedAsset = true;
      if (part.isMesh) {
        part.castShadow = true;
        if (typeof enableConservativeCharacterFrustumCulling === 'function') {
          enableConservativeCharacterFrustumCulling(part, 2.4);
        } else {
          part.frustumCulled = true;
        }
      }
    });
    return root;
  }

  function weaponGroupGlbOnlyOwner(weaponGroup) {
    let owner = weaponGroup || null;
    while (owner?.parent && !owner.userData?.glbOnlyCharacterVisual) owner = owner.parent;
    return owner?.userData?.glbOnlyCharacterVisual ? owner : null;
  }

  function setWeaponGlbGroupVisibility(weaponGroup, hasMesh = true) {
    if (!weaponGroup) return false;
    const characterOwner = weaponGroupGlbOnlyOwner(weaponGroup);
    const visible = !!hasMesh && (!characterOwner || !!characterOwner.userData.characterGlbRuntime);
    weaponGroup.visible = visible;
    return visible;
  }

  function weaponGlbGroupAttached(weaponGroup) {
    if (!weaponGroup) return false;
    let root = weaponGroup;
    while (root.parent) root = root.parent;
    if (typeof scene !== 'undefined' && scene) return root === scene;
    return !!weaponGroupGlbOnlyOwner(weaponGroup)?.parent;
  }

  function cancelWeaponGlbForGroup(weaponGroup) {
    if (!weaponGroup?.userData) return;
    clearTimeout(weaponGroup.userData.weaponGlbRetryTimer || 0);
    weaponGroup.userData.weaponGlbRetryTimer = 0;
    weaponGroup.userData.weaponGlbRequestId = Number(weaponGroup.userData.weaponGlbRequestId || 0) + 1;
  }

  function cancelActorGlbVisualRequests(actor) {
    if (!actor?.userData) return;
    if (typeof cancelPendingCharacterGlbAppearance === 'function') {
      cancelPendingCharacterGlbAppearance(actor);
    }
    if (typeof cancelApprovedEquipmentRetries === 'function') {
      cancelApprovedEquipmentRetries(actor);
    }
    const parts = actor.userData.parts || actor.userData.actorParts || {};
    [parts.weaponGroup, parts.offhandWeaponGroup, actor.userData.enemyWeaponGroup]
      .filter(Boolean)
      .forEach(cancelWeaponGlbForGroup);
  }

  // Keeps a weapon slot empty until its approved GLB is ready, then attaches
  // it to the same live group. This avoids a generated gun flash on cache miss
  // and lets crowded actors share one in-flight download per weapon type.
  function requestWeaponGlbForGroup(weaponGroup, weaponId = '', options = {}) {
    if (!weaponGroup?.userData) return null;
    const entry = weaponModelCatalogEntry(weaponId);
    const expectedId = entry?.id || '';
    clearTimeout(weaponGroup.userData.weaponGlbRetryTimer || 0);
    weaponGroup.userData.weaponGlbRetryTimer = 0;
    const requestId = Number(weaponGroup.userData.weaponGlbRequestId || 0) + 1;
    weaponGroup.userData.weaponGlbRequestId = requestId;
    weaponGroup.userData.weaponId = expectedId || 'fists';
    weaponGroup.visible = false;
    if (!entry) return null;

    const attachTemplate = template => {
      if (
        !template?.scene
        || weaponGroup.userData.weaponGlbRequestId !== requestId
        || weaponGroup.userData.weaponId !== expectedId
      ) return null;
      const root = makeWeaponModelMesh(expectedId);
      if (!root) return null;
      clearTimeout(weaponGroup.userData.weaponGlbRetryTimer || 0);
      weaponGroup.userData.weaponGlbRetryTimer = 0;
      weaponGroup.clear();
      weaponGroup.add(root);
      setWeaponGlbGroupVisibility(weaponGroup, true);
      weaponGroup.userData.weaponMeshLegacy = false;
      if (typeof options.onReady === 'function') options.onReady(root, weaponGroup);
      return root;
    };

    const ready = weaponModelLibraryState.templates.get(expectedId);
    if (ready?.scene) return attachTemplate(ready);

    const requestWasAttached = weaponGlbGroupAttached(weaponGroup);
    const tryLoad = retryRound => {
      loadWeaponModelTemplate(entry).then(template => {
        if (
          weaponGroup.userData.weaponGlbRequestId !== requestId
          || weaponGroup.userData.weaponId !== expectedId
          || (requestWasAttached && !weaponGlbGroupAttached(weaponGroup))
        ) return;
        if (template?.scene) {
          attachTemplate(template);
          return;
        }
        const cooldown = Math.min(
          WEAPON_GLB_GROUP_RETRY_MAX_DELAY_MS,
          Math.max(
            300,
            Number(weaponModelLibraryState.nextRetryAt.get(expectedId) || 0) - Date.now(),
            Math.min(
              WEAPON_GLB_GROUP_RETRY_MAX_DELAY_MS,
              900 * (2 ** Math.min(5, retryRound))
            )
          )
        );
        clearTimeout(weaponGroup.userData.weaponGlbRetryTimer || 0);
        weaponGroup.userData.weaponGlbRetryTimer = setTimeout(() => {
          if (
            weaponGroup.userData.weaponGlbRequestId === requestId
            && weaponGroup.userData.weaponId === expectedId
            && weaponGlbGroupAttached(weaponGroup)
          ) tryLoad(retryRound + 1);
        }, cooldown);
      });
    };
    tryLoad(0);
    return null;
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
