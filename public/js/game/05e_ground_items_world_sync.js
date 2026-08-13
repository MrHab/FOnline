  // ===== SERVER GROUND ITEMS =====
  const GROUND_ITEM_MODEL_ASSET_VERSION = '7.76.7-ground-items-bc-v1';
  const GROUND_ITEM_LIBRARY_URL = '/assets/models/items/ground_item_library.glb';
  const GROUND_ITEM_LIBRARY_IDS = new Set([
    'ammo9', 'ammo556', 'energyCell', 'napalm', 'shotgunShell', 'rocketAmmo',
    'medkit', 'stim', 'doctorBag', 'antibiotics', 'ore', 'wood', 'scrap',
    'oil', 'chemicals', 'medicine', 'electronics', 'ammoParts', 'food',
    'weaponParts', 'silver', 'trophy', 'water', 'repairKit'
  ]);
  const groundItemModelState = {
    library: null,
    libraryPromise: null,
    libraryFailureCount: 0,
    libraryNextRetryAt: 0,
    requestCounter: 0
  };
  const GROUND_ITEM_GLB_FLIGHT_RETRY_DELAYS_MS = Object.freeze([450, 1_200, 2_800]);
  const GROUND_ITEM_GLB_RETRY_COOLDOWN_MS = 8_000;
  const GROUND_ITEM_GLB_OWNER_RETRY_MAX_DELAY_MS = 30_000;

  function loadGroundItemLibrary() {
    if (groundItemModelState.library) return Promise.resolve(groundItemModelState.library);
    if (groundItemModelState.libraryPromise) return groundItemModelState.libraryPromise;
    if (!THREE.GLTFLoader) return Promise.resolve(null);
    groundItemModelState.libraryPromise = new Promise(resolve => {
      let flightAttempt = 0;
      const finishFailure = error => {
        groundItemModelState.libraryFailureCount += 1;
        const retryIndex = Math.min(flightAttempt, GROUND_ITEM_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1);
        const retryDelay = GROUND_ITEM_GLB_FLIGHT_RETRY_DELAYS_MS[retryIndex];
        groundItemModelState.libraryNextRetryAt = Date.now() + retryDelay;
        if (flightAttempt < GROUND_ITEM_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1) {
          flightAttempt += 1;
          setTimeout(runAttempt, retryDelay);
          return;
        }
        groundItemModelState.libraryNextRetryAt = Date.now() + GROUND_ITEM_GLB_RETRY_COOLDOWN_MS;
        console.warn('Не удалось загрузить библиотеку физических предметов; GLB появятся после retry.', error);
        resolve(null);
      };
      const runAttempt = () => {
        const loader = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
        if (!loader) {
          finishFailure(new Error('THREE.GLTFLoader is unavailable'));
          return;
        }
        loader.load(`${GROUND_ITEM_LIBRARY_URL}?v=${encodeURIComponent(GROUND_ITEM_MODEL_ASSET_VERSION)}`, gltf => {
          const sceneRoot = gltf?.scene || gltf?.scenes?.[0] || null;
          const complete = sceneRoot && [...GROUND_ITEM_LIBRARY_IDS].every(id => (
            !!sceneRoot.getObjectByName?.(`ground_item_${id}`)
          ));
          if (!complete) {
            finishFailure(new Error('Библиотека физических предметов не содержит полный набор моделей'));
            return;
          }
          prepareStaticModelObject(sceneRoot);
          groundItemModelState.library = sceneRoot;
          groundItemModelState.libraryFailureCount = 0;
          groundItemModelState.libraryNextRetryAt = 0;
          resolve(sceneRoot);
        }, undefined, finishFailure);
      };
      const initialDelay = Math.max(0, groundItemModelState.libraryNextRetryAt - Date.now());
      if (initialDelay > 0) setTimeout(runAttempt, initialDelay);
      else runAttempt();
    }).finally(() => { groundItemModelState.libraryPromise = null; });
    return groundItemModelState.libraryPromise;
  }

  function pendingGroundItemGlbAssetSnapshot() {
    const pending = groundItemModelState.libraryPromise;
    const retryScheduled = !groundItemModelState.library
      && groundItemModelState.libraryFailureCount > 0
      && groundItemModelState.libraryNextRetryAt > Date.now();
    return {
      revision: groundItemModelState.requestCounter + groundItemModelState.libraryFailureCount,
      promises: pending ? [pending] : [],
      activeCount: pending ? 1 : 0,
      unresolvedCount: (pending || retryScheduled) ? 1 : 0,
      retryScheduledCount: retryScheduled ? 1 : 0
    };
  }

  function groundItemModelKind(itemId = '') {
    if (GROUND_ITEM_LIBRARY_IDS.has(itemId)) return 'library';
    if (typeof weaponModelCatalogEntry === 'function' && weaponModelCatalogEntry(itemId)) return 'weapon';
    if (typeof APPROVED_EQUIPMENT_ASSETS !== 'undefined' && APPROVED_EQUIPMENT_ASSETS[itemId]) return 'equipment';
    return '';
  }

  function loadGroundItemPhysicalModel(itemId = '') {
    const kind = groundItemModelKind(itemId);
    if (kind === 'library') {
      return loadGroundItemLibrary().then(library => {
        const source = library?.getObjectByName?.(`ground_item_${itemId}`) || null;
        return source ? source.clone(true) : null;
      });
    }
    if (kind === 'weapon') {
      const entry = weaponModelCatalogEntry(itemId);
      return loadWeaponModelTemplate(entry).then(template => (
        template?.scene ? cloneStaticModelSource(template.scene) : null
      ));
    }
    if (kind === 'equipment') {
      return loadApprovedEquipmentTemplate(itemId, 'male_medium').then(template => (
        template?.scene ? cloneStaticModelSource(template.scene) : null
      ));
    }
    return Promise.resolve(null);
  }

  function fitGroundItemPhysicalModel(model, itemId = '', kind = '') {
    if (!model) return null;
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(1);
    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) return null;
    const initialSize = bounds.getSize(new THREE.Vector3());
    if (kind === 'equipment' || initialSize.y > Math.max(initialSize.x, initialSize.z) * 1.2) {
      model.rotation.x = -Math.PI / 2;
      model.rotation.z = kind === 'equipment' ? 0.18 : 0.08;
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
    } else if (kind === 'weapon') {
      model.rotation.y = 0.24;
      model.rotation.z = 0.04;
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
    }
    const targetFootprint = kind === 'weapon' ? 1.02 : kind === 'equipment' ? 0.92 : 0.68;
    const size = bounds.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z, size.y * 0.55, 0.001);
    const scale = Math.min(1.35, targetFootprint / footprint);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y += 0.025 - bounds.min.y;
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    model.name = `ground_item_physical_${itemId}`;
    model.traverse(part => {
      part.frustumCulled = false;
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
    });
    return bounds;
  }

  function requestGroundItemPhysicalModel(group, itemId = '') {
    const kind = groundItemModelKind(itemId);
    if (!group || !kind) return;
    const requestId = ++groundItemModelState.requestCounter;
    clearTimeout(group.userData.groundItemModelRetryTimer || 0);
    group.userData.groundItemModelRetryTimer = 0;
    group.userData.groundItemModelRequestId = requestId;
    const tryLoad = retryRound => {
      loadGroundItemPhysicalModel(itemId).then(model => {
        if (
          group.userData.groundItemModelActive === false
          || group.userData.groundItemModelRequestId !== requestId
        ) return;
        const bounds = model ? fitGroundItemPhysicalModel(model, itemId, kind) : null;
        if (!model || !bounds) {
          const retryDelay = Math.min(
            GROUND_ITEM_GLB_OWNER_RETRY_MAX_DELAY_MS,
            900 * (2 ** Math.min(5, retryRound))
          );
          group.userData.groundItemModelRetryTimer = setTimeout(() => {
            group.userData.groundItemModelRetryTimer = 0;
            if (
              group.userData.groundItemModelActive !== false
              && group.userData.groundItemModelRequestId === requestId
            ) tryLoad(retryRound + 1);
          }, retryDelay);
          return;
        }
        clearTimeout(group.userData.groundItemModelRetryTimer || 0);
        group.userData.groundItemModelRetryTimer = 0;
        group.add(model);
        group.userData.groundItemPhysicalModel = model;
        const row = group.userData.groundItem;
        model.traverse(child => { child.userData.groundItem = row; });
        const size = bounds.getSize(new THREE.Vector3());
        const shadow = group.userData.groundItemShadow;
        if (shadow) {
          shadow.scale.set(
            Math.max(0.48, size.x / 0.76),
            Math.max(0.42, size.z / 0.76),
            1
          );
        }
      });
    };
    tryLoad(0);
  }

  function clearGroundItemsVisuals() {
    multiplayer.groundItemMeshes.forEach(mesh => {
      if (mesh?.userData) {
        mesh.userData.groundItemModelActive = false;
        clearTimeout(mesh.userData.groundItemModelRetryTimer || 0);
        mesh.userData.groundItemModelRetryTimer = 0;
      }
      forgetNetworkRevealObject(mesh);
      try { scene.remove(mesh); } catch (_) {}
    });
    multiplayer.groundItemMeshes.length = 0;
    multiplayer.groundItems.clear();
  }

  function createGroundItemMesh(itemId, qty = 1) {
    const item = ITEMS[itemId] || { icon: '?', name: itemId || 'Предмет', type: 'misc' };
    const group = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.visible = true; // v7.74.81: cheap pseudo contact shadow while real shadow maps are disabled
    group.add(shadow);
    group.userData.groundItemShadow = shadow;
    group.userData.groundItemModelActive = true;

    // Physical loot is GLB-only. Keep the holder empty until the authored
    // model is ready instead of flashing an old generated box into the world.
    requestGroundItemPhysicalModel(group, itemId);

    // Предметы на земле тоже без надписей над объектом.
    // Текстовая информация остаётся в окне лута/инвентаря и системных подсказках.
    return group;
  }

  function removeGroundItemVisual(id) {
    const row = multiplayer.groundItems.get(id);
    if (!row) return;
    const idx = multiplayer.groundItemMeshes.indexOf(row.mesh);
    if (idx >= 0) multiplayer.groundItemMeshes.splice(idx, 1);
    if (row.mesh?.userData) {
      row.mesh.userData.groundItemModelActive = false;
      clearTimeout(row.mesh.userData.groundItemModelRetryTimer || 0);
      row.mesh.userData.groundItemModelRetryTimer = 0;
    }
    forgetNetworkRevealObject(row.mesh);
    if (row.mesh) scene.remove(row.mesh);
    multiplayer.groundItems.delete(id);
  }

  function upsertGroundItem(src) {
    if (!src || !src.id || !ITEMS[src.itemId] || Number(src.qty || 0) <= 0) return;
    let row = multiplayer.groundItems.get(src.id);
    if (!row) {
      const mesh = createGroundItemMesh(src.itemId, src.qty);
      row = { ...src, mesh };
      mesh.userData.groundItem = row;
      mesh.traverse(child => { if (child.isMesh) child.userData.groundItem = row; });
      scene.add(mesh);
      multiplayer.groundItems.set(src.id, row);
      multiplayer.groundItemMeshes.push(mesh);
    } else {
      const previousItemId = row.itemId;
      row.itemId = src.itemId;
      row.qty = Number(src.qty || row.qty || 1);
      row.x = Number(src.x ?? row.x ?? 0);
      row.z = Number(src.z ?? row.z ?? 0);
      if (row.mesh && previousItemId !== row.itemId) {
        row.mesh.userData.groundItemModelActive = false;
        clearTimeout(row.mesh.userData.groundItemModelRetryTimer || 0);
        row.mesh.userData.groundItemModelRetryTimer = 0;
        forgetNetworkRevealObject(row.mesh);
        scene.remove(row.mesh);
        const idx = multiplayer.groundItemMeshes.indexOf(row.mesh);
        if (idx >= 0) multiplayer.groundItemMeshes.splice(idx, 1);
        row.mesh = createGroundItemMesh(row.itemId, row.qty);
        row.mesh.userData.groundItem = row;
        row.mesh.traverse(child => { if (child.isMesh) child.userData.groundItem = row; });
        scene.add(row.mesh);
        multiplayer.groundItemMeshes.push(row.mesh);
      }
    }
    row.x = Number(src.x ?? row.x ?? 0);
    row.z = Number(src.z ?? row.z ?? 0);
    if (row.mesh) {
      row.mesh.position.set(Number(row.x || 0), 0, Number(row.z || 0));
      applyNetworkFogVisibilityNow(row.mesh, Number(row.x || 0), Number(row.z || 0));
    }
  }

  function applyNetworkGroundItems(items) {
    if (!Array.isArray(items)) return;
    const ids = new Set();
    items.forEach(src => {
      if (!src || !src.id) return;
      ids.add(src.id);
      upsertGroundItem(src);
    });
    [...multiplayer.groundItems.keys()].forEach(id => { if (!ids.has(id)) removeGroundItemVisual(id); });
  }

  function findNearestGroundItem(maxDist = 2.7) {
    let best = null;
    let bestDist = maxDist;
    multiplayer.groundItems.forEach(row => {
      if (!row || !ITEMS[row.itemId] || (row.mesh && row.mesh.visible === false)) return;
      const d = Math.hypot(Number(row.x || 0) - player.x, Number(row.z || 0) - player.z);
      if (d <= bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function pickupGroundItem(row) {
    if (!row || !ITEMS[row.itemId]) return false;
    if (!groundItemsAreServerAuthoritative()) {
      setReadout('Подбор предметов с земли работает в сетевой игре.');
      return false;
    }
    const item = ITEMS[row.itemId];
    const qty = Math.max(1, Math.floor(Number(row.qty || 1)));
    if (!canCarryItem(row.itemId, qty)) {
      setReadout(`${item.name}: нет места. Вес ${formatWeight(inventoryWeight())}/${formatWeight(carryCapacity())}.`);
      return false;
    }
    multiplayer.socket.emit('pickupGroundItem', { id: row.id, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
      if (!ack || !ack.ok) {
        setReadout(ack?.error || 'Не удалось подобрать предмет.');
        return;
      }
      const picked = ack.item || row;
      const pickedItem = ITEMS[picked.itemId];
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
      if (pickedItem) {
        addLog(`${pickedItem.icon} Подобрано с земли: ${pickedItem.name} x${picked.qty}.`, null, 'loot');
        createFloatingText(Number(picked.x || player.x), Number(picked.z || player.z), `+${picked.qty}`, '#e0be5c');
      }
      removeGroundItemVisual(picked.id || row.id);
      queueSave(true);
    });
    return true;
  }

  function pickupNearestGroundItem() {
    const row = findNearestGroundItem();
    if (!row) return false;
    return pickupGroundItem(row);
  }

  function findGroundItemFromEvent(clientX, clientY) {
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(multiplayer.groundItemMeshes, true);
    for (const h of hits) {
      if (h.object.userData.groundItem && (!h.object.userData.groundItem.mesh || h.object.userData.groundItem.mesh.visible !== false)) return h.object.userData.groundItem;
    }
    return null;
  }

  function requestDropInventoryItem(id, qty = null) {
    const item = ITEMS[id];
    const available = inventory.get(id) || 0;
    if (!item || available <= 0) return false;
    if (!groundItemsAreServerAuthoritative()) {
      setReadout('Выбрасывание предметов на землю работает в сетевой игре.');
      return false;
    }
    if (id === 'fists') {
      setReadout('Кулаки выбросить нельзя.');
      return false;
    }
    const doDrop = amount => {
      const currentAvailable = inventory.get(id) || 0;
      if (currentAvailable <= 0) {
        setReadout('Предмета уже нет в рюкзаке.');
        return false;
      }
      const dropQty = Math.max(1, Math.min(currentAvailable, Math.floor(Number(amount || 1))));
      const apSpent = typeof spendInventoryManipulationAp === 'function' ? spendInventoryManipulationAp('inventory-drop') : 0;
      if (!apSpent) return false;
      const dropX = player.x + Math.sin(player.angle || 0) * 1.15;
      const dropZ = player.z + Math.cos(player.angle || 0) * 1.15;
      multiplayer.socket.emit('dropItem', { itemId: baseItemId(id), itemRuntimeId: String(id || '').slice(0, 96), qty: dropQty, inventoryQtyBefore: currentAvailable, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null, x: dropX, z: dropZ }, ack => {
        if (!ack || !ack.ok) {
          if (typeof refundInventoryManipulationAp === 'function') refundInventoryManipulationAp(apSpent);
          setReadout(ack?.error || 'Не удалось выбросить предмет.');
          return;
        }
        if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
        const dropped = ack.item;
        if (dropped) upsertGroundItem(dropped);
        addLog(`${item.icon} Выброшено на землю: ${item.name} x${dropQty}. Потрачено ${apSpent} ОД.`, null, 'system');
        setReadout(`${item.name}: выброшено x${dropQty}. Потрачено ${apSpent} ОД.`);
        queueSave(true);
      });
      return true;
    };
    if (qty && qty > 0) return doDrop(qty);
    if (available > 1) {
      return openQuantityPanel({
        title: `Выбросить: ${item.name}`,
        sub: `В рюкзаке: ${available}. Выберите, сколько выбросить.`,
        max: available,
        value: 1,
        onConfirm: doDrop
      });
    }
    return doDrop(1);
  }

  // ===== ENEMIES =====
  const enemies = [];
  const enemyMeshes = [];
  const networkEnemyById = new Map();
  const ENEMY_TYPES = [
    { name: 'Рейдер', hp: 55, atk: 9, speed: 2.45, xp: 25, scale: 1.0, visual: 'raider', modelKey: 'enemyRaider' },
    { name: 'Гуль', hp: 42, atk: 7, speed: 2.85, xp: 18, scale: 0.92, visual: 'ghoul', modelKey: 'enemyGhoul' },
    { name: 'Супермутант', hp: 120, atk: 18, speed: 1.75, xp: 70, scale: 1.32, visual: 'mutant', modelKey: 'enemySuperMutant' },
    { name: 'Пепельный волк', hp: 36, atk: 8, speed: 3.15, xp: 20, scale: 0.82, visual: 'wolf', modelKey: 'enemyAshWolf' },
    { name: 'Радскорпион', hp: 76, atk: 14, speed: 1.9, xp: 36, scale: 1.05, visual: 'radscorpion', modelKey: 'enemyRadscorpion' },
    { name: 'Большой мутировавший муравей', hp: 52, atk: 10, speed: 2.55, xp: 24, scale: 0.9, visual: 'mutantAnt', modelKey: 'enemyMutantAnt' },
    { name: 'Геккон пустоши', hp: 46, atk: 9, speed: 2.7, xp: 22, scale: 0.92, visual: 'gecko', modelKey: 'enemyGecko' },
    { name: 'Огненный геккон', hp: 62, atk: 12, speed: 2.42, xp: 34, scale: 1.02, visual: 'fireGecko', modelKey: 'enemyFireGecko' }
  ];

  const ENEMY_GLB_IDENTITY_BY_TOKEN = Object.freeze({
    raider: { visual: 'raider', modelKey: 'enemyRaider' },
    enemyraider: { visual: 'raider', modelKey: 'enemyRaider' },
    ghoul: { visual: 'ghoul', modelKey: 'enemyGhoul' },
    enemyghoul: { visual: 'ghoul', modelKey: 'enemyGhoul' },
    mutant: { visual: 'mutant', modelKey: 'enemySuperMutant' },
    supermutant: { visual: 'mutant', modelKey: 'enemySuperMutant' },
    enemysupermutant: { visual: 'mutant', modelKey: 'enemySuperMutant' },
    wolf: { visual: 'wolf', modelKey: 'enemyAshWolf' },
    ashwolf: { visual: 'wolf', modelKey: 'enemyAshWolf' },
    enemyashwolf: { visual: 'wolf', modelKey: 'enemyAshWolf' },
    radscorpion: { visual: 'radscorpion', modelKey: 'enemyRadscorpion' },
    enemyradscorpion: { visual: 'radscorpion', modelKey: 'enemyRadscorpion' },
    mutantant: { visual: 'mutantAnt', modelKey: 'enemyMutantAnt' },
    enemymutantant: { visual: 'mutantAnt', modelKey: 'enemyMutantAnt' },
    gecko: { visual: 'gecko', modelKey: 'enemyGecko' },
    enemygecko: { visual: 'gecko', modelKey: 'enemyGecko' },
    firegecko: { visual: 'fireGecko', modelKey: 'enemyFireGecko' },
    enemyfiregecko: { visual: 'fireGecko', modelKey: 'enemyFireGecko' },
    brahmin: { visual: 'brahmin', modelKey: 'friendlyBrahmin' },
    friendlybrahmin: { visual: 'brahmin', modelKey: 'friendlyBrahmin' }
  });

  function enemyGlbIdentityFromValue(value = '') {
    const token = String(value || '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
    return token ? (ENEMY_GLB_IDENTITY_BY_TOKEN[token] || null) : null;
  }

  function enemyGlbIdentityFromText(saved = {}) {
    const text = [
      saved.name,
      saved.typeName,
      saved.visual,
      saved.species,
      saved.modelKey,
      saved.model,
      saved.role,
      saved.encounterRole,
      saved.profile,
      saved.statProfile,
      saved.equipmentProfile,
      saved.lootProfile
    ].map(value => String(value || '')).join(' ').toLowerCase();
    const compact = text.replace(/[^a-z0-9]+/g, '');
    if (compact.includes('firegecko') || (text.includes('огнен') && text.includes('геккон'))) return ENEMY_GLB_IDENTITY_BY_TOKEN.firegecko;
    if (compact.includes('radscorpion') || text.includes('скорпион')) return ENEMY_GLB_IDENTITY_BY_TOKEN.radscorpion;
    if (compact.includes('mutantant') || text.includes('мурав')) return ENEMY_GLB_IDENTITY_BY_TOKEN.mutantant;
    if (compact.includes('ashwolf') || text.includes('wolf') || text.includes('волк')) return ENEMY_GLB_IDENTITY_BY_TOKEN.ashwolf;
    if (compact.includes('brahmin') || text.includes('брамин') || String(saved.role || saved.encounterRole || '').toLowerCase() === 'animal') return ENEMY_GLB_IDENTITY_BY_TOKEN.brahmin;
    if (compact.includes('supermutant') || text.includes('супермутант')) return ENEMY_GLB_IDENTITY_BY_TOKEN.supermutant;
    if (compact.includes('ghoul') || text.includes('гул')) return ENEMY_GLB_IDENTITY_BY_TOKEN.ghoul;
    if (compact.includes('gecko') || text.includes('геккон')) return ENEMY_GLB_IDENTITY_BY_TOKEN.gecko;
    if (compact.includes('raider') || text.includes('рейдер')) return ENEMY_GLB_IDENTITY_BY_TOKEN.raider;
    return null;
  }

  function enemyGlbModelKeyFromSnapshot(saved = {}, fallbackVisual = '') {
    const explicit = String(saved.modelKey || saved.model || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const explicitIdentity = enemyGlbIdentityFromValue(explicit);
    if (explicitIdentity) return explicitIdentity.modelKey;
    if (explicit && typeof STATIC_MODEL_URLS !== 'undefined' && STATIC_MODEL_URLS[explicit]) return explicit;
    const candidates = [saved.visual, saved.species];
    for (const candidate of candidates) {
      const identity = enemyGlbIdentityFromValue(candidate);
      if (identity) return identity.modelKey;
    }
    const inferred = enemyGlbIdentityFromText(saved);
    if (inferred) return inferred.modelKey;
    return enemyGlbIdentityFromValue(fallbackVisual)?.modelKey || '';
  }

  function enemyVisualFromNetworkSnapshot(saved = {}, fallback = '') {
    for (const candidate of [saved.visual, saved.species, saved.modelKey, saved.model]) {
      const identity = enemyGlbIdentityFromValue(candidate);
      if (identity) return identity.visual;
    }
    const inferred = enemyGlbIdentityFromText(saved);
    if (inferred) return inferred.visual;
    const fallbackIdentity = enemyGlbIdentityFromValue(fallback);
    return fallbackIdentity?.visual || String(saved.visual || saved.species || fallback || '').trim();
  }

  function enemyTypeFromNetworkSnapshot(saved = {}) {
    const rawIndex = Number(saved.typeIndex);
    const typeIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
    const base = ENEMY_TYPES[typeIndex] || ENEMY_TYPES[0];
    const maxHp = Number(saved.maxHp ?? saved.hp ?? base.hp);
    const visual = enemyVisualFromNetworkSnapshot(saved, base.visual);
    return {
      ...base,
      name: saved.name || base.name,
      hp: Number.isFinite(maxHp) && maxHp > 0 ? maxHp : base.hp,
      atk: Number.isFinite(Number(saved.atk)) ? Number(saved.atk) : base.atk,
      speed: Number.isFinite(Number(saved.baseSpeed)) ? Number(saved.baseSpeed) : base.speed,
      xp: Number.isFinite(Number(saved.xp)) ? Number(saved.xp) : base.xp,
      scale: Number.isFinite(Number(saved.scale)) && Number(saved.scale) > 0 ? Number(saved.scale) : (visual === 'brahmin' ? 1.08 : base.scale),
      visual,
      modelKey: enemyGlbModelKeyFromSnapshot(saved, visual || base.visual) || base.modelKey || '',
      species: saved.species || (visual === 'brahmin' ? 'brahmin' : ''),
      variantId: saved.variantId || 'normal',
      variantName: saved.variantName || ''
    };
  }

  function enemyAttackProfile(enemy = {}) {
    const name = String(enemy.name || '').toLowerCase();
    if (name.includes('гуль')) return { damageType: 'toxic', injurySource: 'Гуль: заражающий удар' };
    if (name.includes('супермутант')) return { damageType: 'ballistic', injurySource: 'удар супермутанта' };
    if (name.includes('волк')) return { damageType: 'toxic', injurySource: 'укус пепельного волка' };
    if (name.includes('скорпион')) return { damageType: 'toxic', injurySource: 'Радскорпион: ядовитое жало' };
    if (name.includes('мурав')) return { damageType: 'ballistic', injurySource: 'укус мутировавшего муравья' };
    if (name.includes('огненный геккон')) return { damageType: 'fire', injurySource: 'Огненный геккон: обжигающий укус' };
    if (name.includes('геккон')) return { damageType: 'ballistic', injurySource: 'укус геккона пустоши' };
    return { damageType: 'ballistic', injurySource: enemy.name || 'удар' };
  }



  let applyingNetworkWorldState = false;
  let authoritativeResourceSnapshotLocationId = '';
  function makeEntityId(prefix = 'e') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureEnemyId(e) { if (e && !e.id) e.id = makeEntityId('enemy'); return e?.id || ''; }
  function ensureResourceId(r) { if (r && !r.id) r.id = `res_${r.tx}_${r.tz}_${r.type || 'node'}`; return r?.id || ''; }

  function requestWorldStateFromServer(reason = 'resync') {
    const socket = multiplayer.socket;
    const requestedRoomId = String(multiplayer.roomId || '');
    if (!socket || !socket.connected || !multiplayer.joined) return false;
    socket.emit('requestWorldState', { reason: String(reason || 'resync').slice(0, 32) }, ack => {
      if (socket !== multiplayer.socket || !socket.connected || !multiplayer.joined) return;
      if (requestedRoomId && requestedRoomId !== String(multiplayer.roomId || '')) return;
      if (!ack?.ok || !ack.state || !networkPayloadIsForCurrentRoom(ack.state)) return;
      markStartupNetworkEvent('worldState');
      applyNetworkWorldState(ack.state, ack.reason || reason);
    });
    return true;
  }

  function findResourceNode(snapshot) {
    if (!snapshot) return null;
    const id = snapshot.id || '';
    return resourceNodes.find(r => (id && r.id === id) || (Number(r.tx) === Number(snapshot.tx) && Number(r.tz) === Number(snapshot.tz)));
  }

  function removeResourceVisual(node) {
    if (!node || !node.mesh) return;
    const removedMesh = node.mesh;
    const idx = obstacleMeshes.indexOf(node.mesh);
    if (idx >= 0) obstacleMeshes.splice(idx, 1);
    if (node.mesh.userData?.staticCollisionBox) removeStaticCollisionBox(node.mesh.userData.staticCollisionBox);
    forgetNetworkRevealObject(node.mesh);
    try { worldGroup.remove(node.mesh); } catch (_) { node.mesh.visible = false; }
    if (node.authoredObjectId) node.depletedMesh = removedMesh;
    node.mesh = null;
  }

  function createResourceVisual(node) {
    if (!node || node.hp <= 0 || node.mesh) return;
    if (node.authoredObjectId && node.depletedMesh) {
      node.mesh = node.depletedMesh;
      node.depletedMesh = null;
      worldGroup.add(node.mesh);
      if (!obstacleMeshes.includes(node.mesh)) obstacleMeshes.push(node.mesh);
      const row = node.authoredRow || node.mesh.userData?.locationObject;
      if (row) {
        node.mesh.userData.staticCollisionBox = addAuthoredObjectCollision(
          row,
          Number(node.mesh.position.x || 0),
          Number(node.mesh.position.z || 0),
          Number(node.mesh.rotation.y || 0)
        );
      }
      applyNetworkFogVisibilityNow(node.mesh, Number(node.mesh.position.x || 0), Number(node.mesh.position.z || 0));
      return;
    }
    if (node.authoredObjectId) {
      recreateWorldVisualsFromCurrentMap();
      return;
    }
    const pos = tileToWorld(node.tx, node.tz);
    if (node.type === 'wood') node.mesh = createWoodNode(pos.x, pos.z);
    else if (node.type === 'oil' || node.type === 'water') {
      node.mesh = typeof createOilNode === 'function'
        ? createOilNode(pos.x, pos.z, 0)
        : createRock(pos.x, pos.z, true);
    } else {
      node.mesh = createRock(pos.x, pos.z, true);
    }
    if (node.mesh) {
      node.mesh.userData.resource = node;
      applyNetworkFogVisibilityNow(node.mesh, pos.x, pos.z);
    }
  }

  function applyNetworkResources(resources, stateMap) {
    if (!Array.isArray(resources)) return;
    resources.forEach(src => {
      const normalized = {
        id: src.id || `res_${src.tx}_${src.tz}_${src.type || 'node'}`,
        tx: Number(src.tx || 0),
        tz: Number(src.tz || 0),
        type: src.type || 'wood',
        hp: Number(src.hp || 0),
        maxHp: Number(src.maxHp || 3)
      };
      let node = findResourceNode(normalized);
      if (!node) {
        node = { ...normalized, mesh: null };
        resourceNodes.push(node);
      } else {
        node.id = normalized.id;
        node.tx = normalized.tx;
        node.tz = normalized.tz;
        node.type = normalized.type;
        node.hp = normalized.hp;
        node.maxHp = normalized.maxHp;
      }
      if (node.hp <= 0 && map[node.tz]) {
        // Depleted resource tiles are walkable. Do this even when the server
        // includes a full map snapshot so old/parallel clients cannot leave an
        // invisible ROCK collision after ore depletion.
        map[node.tz][node.tx] = TILE_TYPES.GRASS;
      } else if (Array.isArray(stateMap) && Array.isArray(stateMap[node.tz])) {
        map[node.tz][node.tx] = stateMap[node.tz][node.tx];
      }
      if (node.hp <= 0) removeResourceVisual(node);
      else createResourceVisual(node);
    });
    if (typeof invalidateMinimapStaticCache === 'function') invalidateMinimapStaticCache('network-resources');
  }

  function clampEnemyVisualVelocity(vx, vz, maxSpeed) {
    vx = Number(vx || 0);
    vz = Number(vz || 0);
    maxSpeed = Math.max(0.05, Number(maxSpeed || 0));
    const len = Math.hypot(vx, vz);
    if (!Number.isFinite(len) || len <= 0.001) return { vx: 0, vz: 0, speed: 0 };
    if (len <= maxSpeed) return { vx, vz, speed: len };
    const k = maxSpeed / len;
    return { vx: vx * k, vz: vz * k, speed: maxSpeed };
  }

  function resetEnemyVisualController(enemy, x, z, opts = {}) {
    if (!enemy) return;
    const nx = Number(x ?? enemy.serverTargetX ?? enemy.x ?? 0);
    const nz = Number(z ?? enemy.serverTargetZ ?? enemy.z ?? 0);
    enemy.x = nx;
    enemy.z = nz;
    enemy.visualX = nx;
    enemy.visualZ = nz;
    enemy.serverTargetX = nx;
    enemy.serverTargetZ = nz;
    enemy.lastServerX = nx;
    enemy.lastServerZ = nz;
    enemy.netVx = 0;
    enemy.netVz = 0;
    enemy.enemyVisualSpeed = 0;
    enemy.enemyVisualDirX = 0;
    enemy.enemyVisualDirZ = 0;
    enemy.lastNetworkAt = performance.now();
    enemy.enemyJustSnappedAt = enemy.lastNetworkAt;
    if (enemy.mesh) enemy.mesh.position.set(nx, opts.dead ? enemy.mesh.position.y : 0, nz);
  }

  function lockEnemyCorpsePosition(enemy, saved = {}, opts = {}) {
    if (!enemy) return;
    const sx = Number(saved?.x ?? enemy.serverTargetX ?? enemy.x ?? enemy.mesh?.position?.x ?? 0);
    const sz = Number(saved?.z ?? enemy.serverTargetZ ?? enemy.z ?? enemy.mesh?.position?.z ?? 0);
    const existingX = Number(enemy.corpseX);
    const existingZ = Number(enemy.corpseZ);
    let cx = Number.isFinite(existingX) ? existingX : sx;
    let cz = Number.isFinite(existingZ) ? existingZ : sz;

    if (!opts.keepExisting || !Number.isFinite(existingX) || !Number.isFinite(existingZ)) {
      const visualX = Number(enemy.mesh?.position?.x ?? enemy.visualX ?? enemy.x ?? sx);
      const visualZ = Number(enemy.mesh?.position?.z ?? enemy.visualZ ?? enemy.z ?? sz);
      const visualGap = Math.hypot(visualX - sx, visualZ - sz);
      const canUseVisibleDeathSpot = Number.isFinite(visualX) && Number.isFinite(visualZ) && visualGap <= 4.5;
      cx = canUseVisibleDeathSpot ? visualX : sx;
      cz = canUseVisibleDeathSpot ? visualZ : sz;
    }

    enemy.corpseX = cx;
    enemy.corpseZ = cz;
    enemy.x = cx;
    enemy.z = cz;
    enemy.visualX = cx;
    enemy.visualZ = cz;
    enemy.serverTargetX = cx;
    enemy.serverTargetZ = cz;
    enemy.lastServerX = cx;
    enemy.lastServerZ = cz;
    enemy.netVx = 0;
    enemy.netVz = 0;
    enemy.enemyVisualSpeed = 0;
    enemy.enemyVisualDirX = 0;
    enemy.enemyVisualDirZ = 0;
    if (enemy.mesh) enemy.mesh.position.set(cx, enemy.mesh.position.y, cz);
  }

  function applyEnemySpeechSnapshot(enemy, saved = {}, naturalCreature = false) {
    if (!enemy) return;
    const text = String(saved?.speechText || '').trim().slice(0, 96);
    const ms = Math.max(0, Math.min(8000, Number(saved?.speechMs || 0)));
    if (naturalCreature || enemy.dead || !text || ms <= 0) {
      enemy.speechText = '';
      enemy.speechId = '';
      enemy.speechUntil = 0;
      return;
    }
    enemy.speechText = text;
    enemy.speechId = String(saved?.speechId || text).slice(0, 140);
    enemy.speechUntil = performance.now() + ms;
  }

  function updateEnemyNetworkMotion(enemy, saved) {
    if (!enemy || !saved) return;
    const now = performance.now();
    const sx = Number(saved.x ?? enemy.serverTargetX ?? enemy.x ?? 0);
    const sz = Number(saved.z ?? enemy.serverTargetZ ?? enemy.z ?? 0);
    const previousTargetX = Number(enemy.serverTargetX ?? enemy.x ?? sx);
    const previousTargetZ = Number(enemy.serverTargetZ ?? enemy.z ?? sz);
    const elapsed = Math.max(0.045, Math.min(0.32, (now - Number(enemy.lastNetworkAt || now)) / 1000));

    enemy.lastServerX = previousTargetX;
    enemy.lastServerZ = previousTargetZ;
    enemy.serverTargetX = sx;
    enemy.serverTargetZ = sz;
    enemy.lastNetworkAt = now;

    const maxSpeed = Math.max(0.35, Number(enemy.speed || saved.speed || 2.4) * 1.22);
    const packetVx = Number(saved.vx || 0);
    const packetVz = Number(saved.vz || 0);
    const packetSpeed = Math.hypot(packetVx, packetVz);
    let vx = packetVx;
    let vz = packetVz;
    const movingFlag = Object.prototype.hasOwnProperty.call(saved, 'moving')
      ? !!saved.moving
      : !!(Math.floor(Number(saved.flags || 0)) & 1);
    if (!movingFlag && packetSpeed <= 0.02) {
      vx = 0;
      vz = 0;
    } else if (packetSpeed <= 0.02) {
      vx = (sx - previousTargetX) / elapsed;
      vz = (sz - previousTargetZ) / elapsed;
    }
    const clamped = clampEnemyVisualVelocity(vx, vz, maxSpeed);
    const moving = movingFlag && clamped.speed > 0.04;
    enemy.netVx = moving ? clamped.vx : 0;
    enemy.netVz = moving ? clamped.vz : 0;
    enemy.enemyVisualSpeed = moving ? clamped.speed : 0;
    if (moving && clamped.speed > 0.01) {
      enemy.enemyVisualDirX = clamped.vx / clamped.speed;
      enemy.enemyVisualDirZ = clamped.vz / clamped.speed;
    }
  }

  function createEnemyFromNetworkSnapshot(saved) {
    const type = enemyTypeFromNetworkSnapshot(saved);
    const naturalCreature = naturalCreatureSnapshotFor(saved, type);
    const equipment = enemyEquipmentFromData(saved);
    const mesh = createEnemyModel(type);
    mesh.position.set(saved.x, 0, saved.z);
    scene.add(mesh);
    const enemy = {
      ...type,
      id: saved.id || makeEntityId('enemy'),
      typeIndex: saved.typeIndex || 0,
      x: Number(saved.x || 0),
      z: Number(saved.z || 0),
      visualX: Number(saved.x || 0),
      visualZ: Number(saved.z || 0),
      serverTargetX: Number(saved.x || 0),
      serverTargetZ: Number(saved.z || 0),
      lastServerX: Number(saved.x || 0),
      lastServerZ: Number(saved.z || 0),
      netVx: Number(saved.vx || 0),
      netVz: Number(saved.vz || 0),
      enemyVisualSpeed: Math.hypot(Number(saved.vx || 0), Number(saved.vz || 0)),
      enemyVisualDirX: 0,
      enemyVisualDirZ: 0,
      lastNetworkAt: performance.now(),
      aiState: saved.aiState || 'idle',
      lookX: Number.isFinite(Number(saved.lookX)) ? Number(saved.lookX) : null,
      lookZ: Number.isFinite(Number(saved.lookZ)) ? Number(saved.lookZ) : null,
      faction: saved.faction || 'wild',
      hostileToPlayer: saved.hostileToPlayer !== false,
      wastelandSiteId: saved.wastelandSiteId || '',
      wastelandOwnerFaction: saved.wastelandOwnerFaction || '',
      wastelandOwnerLabel: saved.wastelandOwnerLabel || '',
      role: saved.role || saved.encounterRole || '',
      encounterRole: saved.encounterRole || '',
      profile: saved.profile || '',
      statProfile: saved.statProfile || '',
      equipmentProfile: saved.equipmentProfile || '',
      lootProfile: saved.lootProfile || '',
      tradeProfile: saved.tradeProfile || '',
      special: saved.special || null,
      scheduleState: saved.scheduleState || '',
      scheduleLabel: saved.scheduleLabel || '',
      activityRevision: 0,
      activityType: '',
      goalActivity: '',
      activityPhase: '',
      visualAction: '',
      activitySlotId: '',
      activityFacing: null,
      serviceAvailable: null,
      _hasNetworkActivity: false,
      speechText: '',
      speechId: '',
      speechUntil: 0,
      visual: type.visual || saved.visual || '',
      modelKey: saved.modelKey || type.modelKey || '',
      species: saved.species || type.species || '',
      canDialogue: naturalCreature ? false : saved.canDialogue !== false,
      traderId: naturalCreature ? '' : (saved.traderId || ''),
      traderProfile: naturalCreature ? '' : (saved.traderProfile || ''),
      dialogueProfile: naturalCreature ? '' : (saved.dialogueProfile || ''),
      traderQuests: naturalCreature ? [] : (Array.isArray(saved.traderQuests) ? saved.traderQuests.map(id => String(id || '')).filter(Boolean) : []),
      equipment,
      weapon: equipment.weapon,
      traderStock: naturalCreature ? [] : (Array.isArray(saved.traderStock) ? saved.traderStock.map(row => ({
        id: String(row.id || ''),
        price: Math.max(1, Math.round(Number(row.price || 1))),
        qty: Math.max(1, Math.round(Number(row.qty || 1)))
      })).filter(row => row.id) : []),
      traderBuyInterests: naturalCreature ? [] : (Array.isArray(saved.traderBuyInterests) ? saved.traderBuyInterests.map(x => String(x || '')).filter(Boolean) : []),
      traderMarket: naturalCreature || !saved.traderMarket || typeof saved.traderMarket !== 'object' ? null : {
        siteId: String(saved.traderMarket.siteId || ''),
        state: String(saved.traderMarket.state || ''),
        stateLabel: String(saved.traderMarket.stateLabel || ''),
        scarcity: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.scarcity || 0)))),
        abundance: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.abundance || 0)))),
        priceMultiplier: Number(saved.traderMarket.priceMultiplier || 1),
        quantityMultiplier: Number(saved.traderMarket.quantityMultiplier || 1)
      },
      inventory: naturalCreature ? [] : (typeof normalizeNpcInventoryWithLegacyCaps === 'function'
        ? normalizeNpcInventoryWithLegacyCaps(saved.inventory || [], saved.traderCaps)
        : (Array.isArray(saved.inventory) ? saved.inventory.slice() : [])),
      hp: Number(saved.hp ?? type.hp),
      maxHp: Number(saved.maxHp ?? type.hp),
      mesh,
      dead: !!saved.dead,
      attackTimer: 0,
      wanderTimer: 0,
      vx: 0,
      vz: 0,
      flash: 0,
      selected: false,
      variantId: type.variantId || 'normal',
      variantName: type.variantName || '',
      loot: (saved.loot || []).map(x => ({ id: x.id, qty: x.qty })),
      _looted: !!saved.looted,
      path: [],
      pathTimer: 0
    };
    applyNetworkEnemyActivityPacket(enemy, saved);
    applyEnemySpeechSnapshot(enemy, saved, naturalCreature);
    mesh.userData.enemy = enemy;
    mesh.traverse(child => { if (child.isMesh) child.userData.enemy = enemy; });
    updateEnemyEquipmentVisuals(enemy);
    enemies.push(enemy);
    networkEnemyById.set(String(enemy.id || ''), enemy);
    enemyMeshes.push(mesh);
    if (enemy.dead) makeCorpse(enemy);
    applyNetworkFogVisibilityNow(mesh, enemy.x, enemy.z);
    return enemy;
  }

  function removeNetworkEnemy(enemy) {
    if (!enemy) return;
    if (player.attackTarget === enemy) player.attackTarget = null;
    if (hoveredEnemy === enemy) { hoveredEnemy = null; hideTargetHint(); }
    const idx = enemies.indexOf(enemy);
    if (idx >= 0) enemies.splice(idx, 1);
    if (enemy.id && networkEnemyById.get(String(enemy.id)) === enemy) networkEnemyById.delete(String(enemy.id));
    const midx = enemyMeshes.indexOf(enemy.mesh);
    if (midx >= 0) enemyMeshes.splice(midx, 1);
    if (typeof cancelActorGlbVisualRequests === 'function') cancelActorGlbVisualRequests(enemy.mesh);
    forgetNetworkRevealObject(enemy.mesh);
    if (enemy.mesh) scene.remove(enemy.mesh);
  }

  function rebuildNetworkEnemyIndex() {
    networkEnemyById.clear();
    for (const enemy of enemies) {
      if (!enemy?.id) continue;
      networkEnemyById.set(String(enemy.id), enemy);
    }
    return networkEnemyById;
  }

  function networkEnemyScheduleLabel(state = '') {
    const labels = {
      work: 'работает',
      eat: 'ест',
      shop: 'торгует',
      patrol: 'патрулирует',
      guard: 'на посту',
      rest: 'отдыхает',
      social: 'общается',
      combat: 'тревога',
      dialogue: 'разговор'
    };
    return labels[String(state || '').toLowerCase()] || '';
  }

  function networkEnemyHasActivityState(saved = {}) {
    if (Array.isArray(saved.a)) return true;
    return [
      'activityRevision',
      'activityType',
      'goalActivity',
      'activityPhase',
      'visualAction',
      'activitySlotId',
      'activityFacing',
      'serviceAvailable'
    ].some(key => Object.prototype.hasOwnProperty.call(saved, key));
  }

  // Activity fields are optional so an older server can still drive the legacy
  // scheduleState client. Once any field is present, explicit empty values are
  // authoritative too: they must clear a previous package instead of reviving it.
  function applyNetworkEnemyActivityState(enemy, saved = {}, options = {}) {
    if (!enemy || !saved || typeof saved !== 'object') return false;
    const previousServiceAvailable = enemy.serviceAvailable;
    const compact = Array.isArray(saved.a) ? saved.a : null;
    const compactIndex = {
      activityRevision: 0,
      activityType: 1,
      goalActivity: 1,
      activityPhase: 2,
      visualAction: 3,
      activitySlotId: 4,
      activityFacing: 5,
      serviceAvailable: 6
    };
    const hasOwn = key => Object.prototype.hasOwnProperty.call(saved, key)
      || !!(compact && compact.length > compactIndex[key]);
    const read = key => Object.prototype.hasOwnProperty.call(saved, key)
      ? saved[key]
      : (compact ? compact[compactIndex[key]] : undefined);
    const hasExplicitActivityType = Object.prototype.hasOwnProperty.call(saved, 'activityType');
    const hasExplicitGoalActivity = Object.prototype.hasOwnProperty.call(saved, 'goalActivity');
    const hasActivityType = hasOwn('activityType');
    const hasGoalActivity = hasOwn('goalActivity');
    const hasActivityState = networkEnemyHasActivityState(saved);
    if (!hasActivityState) return false;
    if (options.rejectStaleRevision === true) {
      if (!hasOwn('activityRevision')) return false;
      const incomingRevision = Number(read('activityRevision'));
      if (!Number.isFinite(incomingRevision)) return false;
      const currentRevision = Math.max(0, Math.floor(Number(enemy.activityRevision || 0)));
      if (enemy._hasNetworkActivity === true && Math.floor(incomingRevision) <= currentRevision) return false;
    }

    enemy._hasNetworkActivity = true;
    if (hasOwn('activityRevision')) {
      const revision = Number(read('activityRevision'));
      enemy.activityRevision = Number.isFinite(revision) ? Math.max(0, Math.floor(revision)) : 0;
    }
    if (hasActivityType) enemy.activityType = String(read('activityType') ?? '');
    if (hasGoalActivity) enemy.goalActivity = String(read('goalActivity') ?? '');
    // Accept both protocol spellings and keep a single-field payload useful to
    // old and new UI call sites. When both are sent, preserve both verbatim.
    if (hasActivityType && !hasExplicitGoalActivity) enemy.goalActivity = enemy.activityType;
    if (hasGoalActivity && !hasExplicitActivityType) enemy.activityType = enemy.goalActivity;
    if (hasOwn('activityPhase')) enemy.activityPhase = String(read('activityPhase') ?? '');
    if (hasOwn('visualAction')) enemy.visualAction = String(read('visualAction') ?? '');
    if (hasOwn('activitySlotId')) enemy.activitySlotId = String(read('activitySlotId') ?? '');
    if (hasOwn('activityFacing')) {
      const rawFacing = read('activityFacing');
      const facing = Number(rawFacing);
      enemy.activityFacing = rawFacing === '' || rawFacing == null || !Number.isFinite(facing) ? null : facing;
    }
    if (hasOwn('serviceAvailable')) {
      const rawAvailability = read('serviceAvailable');
      enemy.serviceAvailable = rawAvailability === '' || rawAvailability == null ? null : !!rawAvailability;
      if (
        previousServiceAvailable !== false
        && enemy.serviceAvailable === false
        && typeof handleNpcScheduledTradeAvailabilityChanged === 'function'
      ) {
        handleNpcScheduledTradeAvailabilityChanged(enemy);
      }
    }
    return true;
  }

  function applyNetworkEnemyActivityPacket(enemy, saved = {}, options = {}) {
    if (!applyNetworkEnemyActivityState(enemy, saved, options)) return false;
    const activityLabel = networkEnemyScheduleLabel(enemy.activityType || enemy.goalActivity || enemy.visualAction);
    if (activityLabel) enemy.scheduleLabel = activityLabel;
    return true;
  }

  // Activity changes are reliable and sparse. Structural enemy creation remains
  // the responsibility of enemySnapshot, so a delta for an unknown id is ignored.
  function applyNetworkEnemyActivityDelta(activities) {
    if (!Array.isArray(activities)) return 0;
    const enemyIndex = rebuildNetworkEnemyIndex();
    let applied = 0;
    for (const saved of activities) {
      if (!saved?.id) continue;
      const enemy = enemyIndex.get(String(saved.id));
      if (!enemy) continue;
      if (applyNetworkEnemyActivityPacket(enemy, saved, { rejectStaleRevision: true })) applied += 1;
    }
    return applied;
  }

  // Merge only absolute realtime fields from enemyFrame. Unknown ids are
  // intentionally ignored: reliable enemySnapshot owns structural creation and
  // removal as well as equipment, inventory, trader, loot and fog reconciliation.
  function applyNetworkEnemyFrame(enemyFrames) {
    if (!Array.isArray(enemyFrames)) return 0;
    const enemyIndex = rebuildNetworkEnemyIndex();
    let applied = 0;
    for (const saved of enemyFrames) {
      if (!saved?.id) continue;
      const enemy = enemyIndex.get(String(saved.id));
      if (!enemy) continue;
      const flags = Math.max(0, Math.floor(Number(saved.flags || 0)));
      const wasDead = !!enemy.dead;
      const incomingDead = !!(flags & 2);

      enemy.hp = Math.max(0, Number(saved.hp ?? enemy.hp ?? 0));
      enemy.aiState = String(saved.aiState || (incomingDead ? 'dead' : 'idle'));
      enemy.hostileToPlayer = !!(flags & 8);
      enemy._looted = !!(flags & 4);
      enemy.lookX = (flags & 16) && Number.isFinite(Number(saved.lookX)) ? Number(saved.lookX) : null;
      enemy.lookZ = (flags & 16) && Number.isFinite(Number(saved.lookZ)) ? Number(saved.lookZ) : null;
      if (Object.prototype.hasOwnProperty.call(saved, 'scheduleState')) {
        enemy.scheduleState = String(saved.scheduleState || '');
        if (enemy._hasNetworkActivity !== true) {
          enemy.scheduleLabel = networkEnemyScheduleLabel(enemy.scheduleState);
        }
      }
      applyNetworkEnemyActivityPacket(enemy, saved);
      if (flags & 32) applyEnemySpeechSnapshot(enemy, saved, false);
      else if (enemy.speechText || enemy.speechId || enemy.speechUntil) applyEnemySpeechSnapshot(enemy, {}, false);

      if (incomingDead) {
        lockEnemyCorpsePosition(enemy, saved, { keepExisting: wasDead });
      } else {
        const sx = Number(saved.x ?? enemy.serverTargetX ?? enemy.x ?? 0);
        const sz = Number(saved.z ?? enemy.serverTargetZ ?? enemy.z ?? 0);
        const dx = sx - Number(enemy.visualX ?? enemy.x ?? 0);
        const dz = sz - Number(enemy.visualZ ?? enemy.z ?? 0);
        const snap = !enemy.mesh || Math.hypot(dx, dz) > 6.5 || wasDead !== incomingDead;
        if (snap) resetEnemyVisualController(enemy, sx, sz, { dead: false });
        else updateEnemyNetworkMotion(enemy, saved);
      }
      if (incomingDead && !enemy.dead) makeCorpse(enemy);
      else if (!incomingDead && enemy.dead) {
        enemy.dead = false;
        enemy.corpseX = null;
        enemy.corpseZ = null;
        if (enemy.mesh) {
          enemy.mesh.rotation.z = 0;
          enemy.mesh.position.y = 0;
          if (enemy.mesh.userData.hpBar) enemy.mesh.userData.hpBar.visible = true;
        }
      }
      applied += 1;
    }
    return applied;
  }

  function applyNetworkEnemies(enemySnapshots, options = {}) {
    if (!Array.isArray(enemySnapshots)) return;
    const allowPositionSync = !!options.allowPositionSync;
    const pruneMissing = options.pruneMissing !== false;
    const preservedAutoTargetId = (typeof mobileAutoTargetId === 'function') ? mobileAutoTargetId(player.attackTarget) : '';
    const incomingIds = new Set();
    const enemyIndex = rebuildNetworkEnemyIndex();
    enemySnapshots.forEach(saved => {
      if (!saved) return;
      const id = saved.id || '';
      incomingIds.add(id);
      let enemy = id ? enemyIndex.get(String(id)) : null;
      if (!enemy) {
        createEnemyFromNetworkSnapshot(saved);
        return;
      }
      const networkType = enemyTypeFromNetworkSnapshot(saved);
      const naturalCreature = naturalCreatureSnapshotFor(saved, networkType);
      const equipment = enemyEquipmentFromData(saved);
      const wasDead = !!enemy.dead;
      const incomingDead = !!saved.dead;
      const incomingRenderKey = enemyRenderKey(networkType);
      const currentRenderKey = currentEnemyRenderKey(enemy);
      if (incomingRenderKey !== currentRenderKey || naturalCreature !== isNaturalCreatureEnemy(enemy)) {
        replaceEnemyVisualModel(enemy, networkType);
      }
      enemy.typeIndex = saved.typeIndex || enemy.typeIndex || 0;
      enemy.name = networkType.name || enemy.name;
      enemy.atk = networkType.atk;
      enemy.speed = networkType.speed;
      enemy.xp = networkType.xp;
      enemy.scale = networkType.scale;
      enemy.variantId = networkType.variantId || 'normal';
      enemy.variantName = networkType.variantName || '';
      enemy.faction = saved.faction || enemy.faction || 'wild';
      enemy.hostileToPlayer = saved.hostileToPlayer !== false;
      enemy.wastelandSiteId = saved.wastelandSiteId || enemy.wastelandSiteId || '';
      enemy.wastelandOwnerFaction = saved.wastelandOwnerFaction || enemy.wastelandOwnerFaction || '';
      enemy.wastelandOwnerLabel = saved.wastelandOwnerLabel || enemy.wastelandOwnerLabel || '';
      enemy.role = saved.role || saved.encounterRole || enemy.role || '';
      enemy.encounterRole = saved.encounterRole || enemy.encounterRole || '';
      enemy.profile = saved.profile || enemy.profile || '';
      enemy.statProfile = saved.statProfile || enemy.statProfile || '';
      enemy.equipmentProfile = saved.equipmentProfile || enemy.equipmentProfile || '';
      enemy.lootProfile = saved.lootProfile || enemy.lootProfile || '';
      enemy.tradeProfile = saved.tradeProfile || enemy.tradeProfile || '';
      enemy.special = saved.special || enemy.special || null;
      if (Object.prototype.hasOwnProperty.call(saved, 'scheduleState')) {
        enemy.scheduleState = String(saved.scheduleState ?? '');
        if (!Object.prototype.hasOwnProperty.call(saved, 'scheduleLabel')) {
          enemy.scheduleLabel = networkEnemyScheduleLabel(enemy.scheduleState);
        }
      }
      if (Object.prototype.hasOwnProperty.call(saved, 'scheduleLabel')) {
        enemy.scheduleLabel = String(saved.scheduleLabel ?? '');
      }
      applyNetworkEnemyActivityPacket(enemy, saved);
      applyEnemySpeechSnapshot(enemy, saved, naturalCreature);
      enemy.visual = networkType.visual || saved.visual || enemy.visual || '';
      enemy.modelKey = saved.modelKey || networkType.modelKey || enemy.modelKey || '';
      enemy.species = saved.species || networkType.species || enemy.species || '';
      enemy.canDialogue = naturalCreature ? false : saved.canDialogue !== false;
      enemy.traderId = saved.traderId || enemy.traderId || '';
      enemy.traderProfile = saved.traderProfile || enemy.traderProfile || '';
      enemy.dialogueProfile = saved.dialogueProfile || enemy.dialogueProfile || '';
      if (Array.isArray(saved.traderQuests)) enemy.traderQuests = saved.traderQuests.map(id => String(id || '')).filter(Boolean);
      enemy.equipment = equipment;
      enemy.weapon = enemy.equipment.weapon;
      updateEnemyEquipmentVisuals(enemy);
      if (naturalCreature) {
        enemy.traderStock = [];
        enemy.traderBuyInterests = [];
        enemy.inventory = [];
        enemy.traderId = '';
        enemy.traderProfile = '';
        enemy.dialogueProfile = '';
        enemy.traderQuests = [];
        enemy.special = null;
        enemy.scheduleState = '';
        enemy.scheduleLabel = '';
        enemy.activityRevision = 0;
        enemy.activityType = '';
        enemy.goalActivity = '';
        enemy.activityPhase = '';
        enemy.visualAction = '';
        enemy.activitySlotId = '';
        enemy.activityFacing = null;
        enemy.serviceAvailable = null;
        enemy._hasNetworkActivity = false;
        enemy.speechText = '';
        enemy.speechId = '';
        enemy.speechUntil = 0;
      } else if (Array.isArray(saved.traderStock)) {
        enemy.traderStock = saved.traderStock.map(row => ({
          id: String(row.id || ''),
          price: Math.max(1, Math.round(Number(row.price || 1))),
          qty: Math.max(1, Math.round(Number(row.qty || 1)))
        })).filter(row => row.id);
      }
      if (!naturalCreature && Array.isArray(saved.traderBuyInterests)) {
        enemy.traderBuyInterests = saved.traderBuyInterests.map(x => String(x || '')).filter(Boolean);
      }
      if (!naturalCreature && saved.traderMarket && typeof saved.traderMarket === 'object') {
        enemy.traderMarket = {
          siteId: String(saved.traderMarket.siteId || ''),
          state: String(saved.traderMarket.state || ''),
          stateLabel: String(saved.traderMarket.stateLabel || ''),
          scarcity: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.scarcity || 0)))),
          abundance: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.abundance || 0)))),
          priceMultiplier: Number(saved.traderMarket.priceMultiplier || 1),
          quantityMultiplier: Number(saved.traderMarket.quantityMultiplier || 1)
        };
      } else if (naturalCreature) {
        enemy.traderMarket = null;
      }
      if (!naturalCreature && typeof normalizeNpcInventoryWithLegacyCaps === 'function') {
        enemy.inventory = normalizeNpcInventoryWithLegacyCaps(saved.inventory || enemy.inventory || [], saved.traderCaps);
      }
      enemy.hp = Number(saved.hp || 0);
      enemy.maxHp = Number(saved.maxHp || enemy.maxHp || 1);
      enemy.aiState = saved.aiState || enemy.aiState || 'idle';
      enemy.lookX = Number.isFinite(Number(saved.lookX)) ? Number(saved.lookX) : null;
      enemy.lookZ = Number.isFinite(Number(saved.lookZ)) ? Number(saved.lookZ) : null;
      enemy.loot = (saved.loot || []).map(x => ({ id: x.id, qty: x.qty }));
      enemy._looted = !!saved.looted;
      // v7.74.68: enemies use the same split as remote players:
      // server position is an invisible anchor, mesh position is visual.
      // Normal snapshots update motion intent; only death/spawn/large desync snaps.
      if (incomingDead) {
        lockEnemyCorpsePosition(enemy, saved, { keepExisting: wasDead });
      } else if (allowPositionSync || enemiesAreServerAuthoritative()) {
        const sx = Number(saved.x ?? enemy.serverTargetX ?? enemy.x ?? 0);
        const sz = Number(saved.z ?? enemy.serverTargetZ ?? enemy.z ?? 0);
        const vx = sx - Number(enemy.visualX ?? enemy.x ?? 0);
        const vz = sz - Number(enemy.visualZ ?? enemy.z ?? 0);
        const snap = !enemy.mesh || Math.hypot(vx, vz) > 6.5 || wasDead !== incomingDead;
        if (snap) resetEnemyVisualController(enemy, sx, sz, { dead: false });
        else updateEnemyNetworkMotion(enemy, saved);
      }
      if (incomingDead && !enemy.dead) makeCorpse(enemy);
      else if (!incomingDead && enemy.dead) {
        enemy.dead = false;
        enemy.corpseX = null;
        enemy.corpseZ = null;
        if (enemy.mesh) {
          enemy.mesh.rotation.z = 0;
          enemy.mesh.position.y = 0;
          if (enemy.mesh.userData.hpBar) enemy.mesh.userData.hpBar.visible = true;
        }
      }
      if (enemy.mesh) applyNetworkFogVisibilityNow(enemy.mesh, enemy.x, enemy.z);
    });
    if (pruneMissing) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (!enemy || !enemy.id) continue;
        if (!incomingIds.has(enemy.id)) removeNetworkEnemy(enemy);
      }
    }
    refreshNetworkFogVisibilityNow();
    if (preservedAutoTargetId && typeof restoreMobileAutoTargetById === 'function') {
      restoreMobileAutoTargetById(preservedAutoTargetId, { silent: true });
    }
  }

  function syncWastelandSiteControlFromWorldState(state = {}) {
    const siteId = String(state.worldSiteId || '').trim();
    const owner = String(state.worldSiteOwner || '').trim();
    if (!siteId || !owner) return false;
    multiplayer.worldSiteId = siteId;
    multiplayer.worldSiteOwner = owner;
    multiplayer.worldSiteOwnerLabel = String(state.worldSiteOwnerLabel || '').trim();
    if (typeof WASTELAND_SIM_STATE !== 'object' || !Array.isArray(WASTELAND_SIM_STATE?.sites)) return true;
    const current = WASTELAND_SIM_STATE.sites.find(site => String(site?.id || '') === siteId);
    if (!current || (String(current.owner || '') === owner && String(current.ownerLabel || '') === multiplayer.worldSiteOwnerLabel)) return true;
    const sites = WASTELAND_SIM_STATE.sites.map(site => String(site?.id || '') === siteId
      ? { ...site, owner, ownerLabel: multiplayer.worldSiteOwnerLabel || site.ownerLabel || '' }
      : site);
    if (typeof applyWastelandSimState === 'function') {
      applyWastelandSimState({ ...WASTELAND_SIM_STATE, sites, updatedAt: Math.max(Number(WASTELAND_SIM_STATE.updatedAt || 0), Number(state.updatedAt || 0)) });
    }
    return true;
  }

  function applyNetworkWorldState(state, reason = 'update') {
    if (!state || !networkPayloadIsForCurrentRoom(state)) return;
    if (typeof state.pvpMode === 'string') multiplayer.pvpMode = state.pvpMode;
    if (currentLocation && typeof state.pvpMode === 'string') {
      currentLocation.pvpMode = state.pvpMode;
      currentLocation.safe = state.pvpMode === 'peaceful';
      currentLocation.pvp = state.pvpMode !== 'peaceful';
      currentLocation.fullDrop = state.pvpMode === 'pvpFullDrop';
    }
    const preservedAutoTargetId = (typeof mobileAutoTargetId === 'function') ? mobileAutoTargetId(player.attackTarget) : '';
    const stamp = Number(state.updatedAt || 0);
    const fullRebuild = reason === 'serverInit' || reason === 'full' || reason === 'locationFull';
    const authoritativeEnemyStream = multiplayer.serverAuthoritativeEnemies === true;
    if (!fullRebuild && stamp && stamp < multiplayer.lastWorldStateApplied) return;
    if (stamp) multiplayer.lastWorldStateApplied = stamp;
    syncWastelandSiteControlFromWorldState(state);
    applyingNetworkWorldState = true;
    try {
      if (fullRebuild && Array.isArray(state.resources)) {
        resourceNodes.length = 0;
        state.resources.forEach(r => resourceNodes.push({ id: r.id || `res_${r.tx}_${r.tz}_${r.type || 'node'}`, tx: r.tx, tz: r.tz, type: r.type, hp: r.hp, maxHp: r.maxHp || 3, mesh: null }));
        authoritativeResourceSnapshotLocationId = String(state.locationId || currentLocation?.id || '');
      }
      if (fullRebuild && locationUsesAuthoredLayout(currentLocation)) {
        buildAuthoredClientMap(currentLocation);
      }
      if (fullRebuild && Array.isArray(state.map) && state.map.length === MAP_H) {
        for (let z = 0; z < MAP_H; z++) if (Array.isArray(state.map[z])) map[z] = state.map[z].slice(0, MAP_W);
      }
      if (fullRebuild) {
        if (!authoritativeEnemyStream) {
          clearEnemies();
          if (Array.isArray(state.enemies)) state.enemies.forEach(createEnemyFromNetworkSnapshot);
        }
        applyNetworkGroundItems(state.groundItems || []);
        applyNetworkWorldContainers(state.containers || []);
        rebuildLocationAfterNetworkResources();
        refreshNetworkFogVisibilityNow();
      } else {
        applyNetworkResources(state.resources, state.map);
        if (!authoritativeEnemyStream) applyNetworkEnemies(state.enemies, { allowPositionSync: fullRebuild });
        applyNetworkGroundItems(state.groundItems || []);
        applyNetworkWorldContainers(state.containers || []);
        refreshNetworkFogVisibilityNow();
      }
      saveCurrentLocationState();
    } finally {
      applyingNetworkWorldState = false;
    }
    if (preservedAutoTargetId && typeof restoreMobileAutoTargetById === 'function') {
      restoreMobileAutoTargetById(preservedAutoTargetId, { silent: true });
    }
  }

  function rebuildLocationAfterNetworkResources() {
    // Пересоздаём визуальную часть локации из уже принятой сетевой карты/ресурсов.
    // Врагов не трогаем: они находятся отдельно в scene, а не в worldGroup.
    recreateWorldVisualsFromCurrentMap();
  }

  function recreateWorldVisualsFromCurrentMap() {
    if (!Array.isArray(map) || map.length !== MAP_H) return;
    const latestLocation = currentLocation?.id ? LOCATIONS[currentLocation.id] : null;
    if (latestLocation && latestLocation !== currentLocation) currentLocation = latestLocation;
    const authoredLayout = locationUsesAuthoredLayout(currentLocation);
    prepareWorldGroupForRebuild();
    clearWorldGroupWithDispose();
    floorMeshes.length = 0;
    obstacleMeshes.length = 0;
    staticCullObjects.length = 0;
    staticCollisionBoxes.length = 0;
    locationCraftingStations.length = 0;
    locationJobBoards.length = 0;
    locationTradeMachines.length = 0;
    traderNpc = null;
    storageBox = null;
    exitPortal = null;
    if (typeof invalidateMinimapStaticCache === 'function') invalidateMinimapStaticCache('network-rebuild');
    createWastelandBackplate();

    for (let z = 0; z < MAP_H; z++) {
      if (!Array.isArray(map[z])) continue;
      for (let x = 0; x < MAP_W; x++) {
        const type = map[z][x];
        const pos = tileToWorld(x, z);
        createTile(x, z, type);
        const settlementHandbuiltObstacle = currentLocation.id === 'settlement'
          && (type === TILE_TYPES.TREE || type === TILE_TYPES.ROCK || type === TILE_TYPES.RUIN);
        if (settlementHandbuiltObstacle) {
          // The legacy capital draws these cells in createSettlementProps().
        }
        else if (type === TILE_TYPES.TREE) createTree(pos.x, pos.z);
        else if (type === TILE_TYPES.ROCK) createRock(pos.x, pos.z, false);
        else if (type === TILE_TYPES.ORE) {
          let node = resourceNodes.find(r => r.tx === x && r.tz === z);
          if (!node) {
            node = { id: `res_${x}_${z}_ore`, tx: x, tz: z, type: 'ore', hp: 3, maxHp: 3, mesh: null };
            resourceNodes.push(node);
          }
          node.mesh = createRock(pos.x, pos.z, true);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.WOOD) {
          let node = resourceNodes.find(r => r.tx === x && r.tz === z);
          if (!node) {
            node = { id: `res_${x}_${z}_wood`, tx: x, tz: z, type: 'wood', hp: 3, maxHp: 3, mesh: null };
            resourceNodes.push(node);
          }
          node.mesh = createWoodNode(pos.x, pos.z);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.OIL) {
          let node = resourceNodes.find(r => r.tx === x && r.tz === z);
          if (!node) {
            node = { id: `res_${x}_${z}_oil`, tx: x, tz: z, type: 'oil', hp: 4, maxHp: 4, mesh: null };
            resourceNodes.push(node);
          }
          node.mesh = typeof createOilNode === 'function'
            ? createOilNode(pos.x, pos.z, 0)
            : createRock(pos.x, pos.z, true);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.RUIN) createRuin(pos.x, pos.z);
      }
    }

    if (authoredLayout) {
      createAuthoredLocationObjects();
      if (typeof shouldCreateStaticLocationTrader === 'function' ? shouldCreateStaticLocationTrader() : currentLocation.trader) createTraderNpc(currentLocation.trader.tx, currentLocation.trader.tz);
      if (currentLocation.storage) createStorageChest(currentLocation.storage.tx, currentLocation.storage.tz);
    } else if (currentLocation.id === 'settlement' && !clientLocationConfigLoaded) {
      createSettlementProps();
    } else {
      const camp = typeof makeStaticModelGroup === 'function'
        ? makeStaticModelGroup('campfireRest', -2.6, 2.2, 0, 'campfire-rest-area', {
            castShadow: true,
            receiveShadow: true
          })
        : new THREE.Group();
      const glow = new THREE.PointLight(0xffa64a, 1.8, 9, 2.2);
      glow.position.set(0, 1.1, 0);
      camp.add(glow);
      worldGroup.add(camp);
    }
    if (!authoredLayout) createWorldSetDressing();
    createWorldMapExitZoneVisuals();
    createLocationExit();
    freezeStaticWorldTransforms();
    if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
  }

  function initWorldSyncFromServer(worldState) {
    multiplayer.lastWorldStateApplied = 0;
    if (worldState && worldState.roomId && !multiplayer.roomId) multiplayer.roomId = worldState.roomId;
    if (worldState && networkPayloadIsForCurrentRoom(worldState)) {
      applyNetworkWorldState(worldState, 'serverInit');
    } else {
      requestWorldStateFromServer('serverInitFallback');
    }
  }
