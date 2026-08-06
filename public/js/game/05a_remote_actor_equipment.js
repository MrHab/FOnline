  function remoteDeviceIcon(deviceType = '') {
    return deviceType === 'mobile' ? '📱' : '🖥';
  }

  function makeRemoteNameSprite(name, deviceType = 'desktop') {
    const c = document.createElement('canvas');
    c.width = 292;
    c.height = 72;
    const ctx = c.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 8, 292, 54);
    ctx.strokeStyle = 'rgba(217,184,109,0.85)';
    ctx.strokeRect(2, 10, 288, 50);
    ctx.font = 'bold 23px Segoe UI, Arial';
    ctx.fillStyle = '#f0d28a';
    ctx.fillText(`${remoteDeviceIcon(deviceType)} ${String(name || 'Игрок').slice(0, 20)}`, 146, 29);
    ctx.font = '11px Segoe UI, Arial';
    ctx.fillStyle = '#9fb58e';
    ctx.fillText(deviceType === 'mobile' ? 'мобильное управление' : 'ПК управление', 146, 50);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.75, 0.68, 1);
    sprite.position.y = 2.25;
    sprite.userData.texture = tex;
    sprite.userData.name = name || 'Игрок';
    sprite.userData.deviceType = deviceType || 'desktop';
    return sprite;
  }

  function updateRemoteNameSprite(sprite, name, deviceType = 'desktop') {
    if (!sprite || (sprite.userData.name === name && sprite.userData.deviceType === deviceType)) return;
    const oldTex = sprite.userData.texture;
    const fresh = makeRemoteNameSprite(name, deviceType);
    sprite.material.map = fresh.material.map;
    sprite.userData.texture = fresh.userData.texture;
    sprite.userData.name = name;
    sprite.userData.deviceType = deviceType || 'desktop';
    if (oldTex && oldTex.dispose) oldTex.dispose();
  }

  function bindRemotePlayerContextOnce(row) {
    if (!row || !row.group || row.remoteContextBound) return;
    row.group.userData.remotePlayerRow = row;
    try { row.group.traverse(obj => { obj.userData.remotePlayerRow = row; }); } catch (_) {}
    row.remoteContextBound = true;
  }

  function remoteEquipmentFromData(data = {}) {
    const eq = (data && typeof data.equipment === 'object') ? data.equipment : {};
    const primary = String(networkEquipmentBaseId(eq.weapon || '', ''));
    const offhand = String(networkEquipmentBaseId(eq.offhand || '', ''));
    const weapon = data.weapon || (primary && primary !== 'fists' ? primary : (offhand || primary || 'pistol'));
    return {
      weapon: String(networkEquipmentBaseId(weapon, 'pistol')),
      offhand,
      armor: String(networkEquipmentBaseId(eq.armor || '')),
      helmet: String(networkEquipmentBaseId(eq.helmet || '')),
      boots: String(networkEquipmentBaseId(eq.boots || '')),
      backpack: String(networkEquipmentBaseId(eq.backpack || ''))
    };
  }

  function remoteWeaponMuzzleLocalZ(weaponId = 'pistol') {
    weaponId = networkEquipmentBaseId(weaponId, 'pistol');
    if (weaponId === 'pistol') return -0.92;
    if (weaponId === 'rifle') return -1.36;
    if (weaponId === 'assaultRifle') return -1.16;
    if (weaponId === 'machineGun') return -1.42;
    if (weaponId === 'laserPistol') return -0.98;
    if (weaponId === 'flamethrower') return -1.02;
    if (weaponId === 'plasmaRifle') return -1.24;
    if (weaponId === 'shotgun') return -1.18;
    if (weaponId === 'rocketLauncher') return -1.36;
    if (weaponId === 'knife') return -0.72;
    if (weaponId === 'pickaxe' || weaponId === 'axe' || weaponId === 'handPump') return -0.82;
    return -0.72;
  }

  function makeRemoteWeaponMesh(weaponId = 'pistol') {
    weaponId = networkEquipmentBaseId(weaponId, 'pistol');
    const model = typeof makeWeaponModelMesh === 'function' ? makeWeaponModelMesh(weaponId) : null;
    if (model) return model;
    if (weaponId === 'pistol') return makePistolMesh();
    if (weaponId === 'rifle') return makeRifleMesh();
    if (weaponId === 'assaultRifle') return makeAssaultRifleMesh();
    if (weaponId === 'machineGun') return makeMachineGunMesh();
    if (weaponId === 'laserPistol') return makeLaserPistolMesh();
    if (weaponId === 'flamethrower') return makeFlamethrowerMesh();
    if (weaponId === 'plasmaRifle') return makePlasmaRifleMesh();
    if (weaponId === 'shotgun') return makeShotgunMesh();
    if (weaponId === 'rocketLauncher') return makeRocketLauncherMesh();
    if (weaponId === 'knife') return makeKnifeMesh();
    if (weaponId === 'pickaxe') return makePickaxeMesh();
    if (weaponId === 'axe') return makeAxeMesh();
    if (weaponId === 'handPump' && typeof makeHandPumpMesh === 'function') return makeHandPumpMesh();
    return null;
  }

  function disposeGroupChildren(group) {
    if (!group) return;
    group.children.forEach(child => {
      child.traverse(obj => {
        if (!obj.userData?.weaponSharedAsset && obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        // Материалы mats общие, их не трогаем, чтобы не сломать сцену.
      });
    });
    group.clear();
  }

  function updateRemoteEquipmentVisuals(group, data = {}) {
    if (!group) return;
    const eq = remoteEquipmentFromData(data);
    const key = JSON.stringify(eq);
    if (group.userData.equipmentKey === key) return;
    group.userData.equipmentKey = key;
    group.userData.equipment = eq;
    group.userData.weaponId = eq.weapon;

    const parts = group.userData.parts || {};
    applyArmorVisualSet(parts, eq);
    if (parts.weaponGroup) {
      disposeGroupChildren(parts.weaponGroup);
      initWeaponVisualState(parts.weaponGroup);
      parts.weaponGroup.userData.weaponId = eq.weapon;
      const mesh = makeRemoteWeaponMesh(eq.weapon);
      if (mesh) parts.weaponGroup.add(mesh);
    }
  }

  function enemyEquipmentFromData(data = {}) {
    if (isNaturalCreatureEnemy(data)) return { weapon: 'fists', armor: '', helmet: '', boots: '', backpack: '' };
    const eq = (data && typeof data.equipment === 'object') ? data.equipment : {};
    return {
      weapon: String(networkEquipmentBaseId(eq.weapon || data.weapon || 'fists', 'fists')),
      offhand: String(networkEquipmentBaseId(eq.offhand || '')),
      armor: String(networkEquipmentBaseId(eq.armor || '')),
      helmet: String(networkEquipmentBaseId(eq.helmet || '')),
      boots: String(networkEquipmentBaseId(eq.boots || '')),
      backpack: String(networkEquipmentBaseId(eq.backpack || ''))
    };
  }

  function naturalCreatureEquipment() {
    return { weapon: 'fists', offhand: '', armor: '', helmet: '', boots: '', backpack: '' };
  }

  function isNaturalCreatureEnemy(data = {}) {
    const mesh = data?.mesh || data?.group || null;
    const parts = mesh?.userData?.actorParts || {};
    const text = [
      data?.visual,
      data?.species,
      data?.modelKey,
      data?.encounterRole,
      data?.role,
      data?.profile,
      data?.statProfile,
      data?.equipmentProfile,
      data?.lootProfile,
      data?.name,
      mesh?.userData?.enemyVisual,
      parts.kind
    ].map(value => String(value || '')).join(' ').toLowerCase();
    const compact = text.replace(/[^a-z0-9]+/g, '');
    return compact.includes('brahmin')
      || text.includes('брамин')
      || compact.includes('radscorpion')
      || text.includes('скорпион')
      || compact.includes('mutantant')
      || text.includes('мурав')
      || compact.includes('firegecko')
      || compact.includes('gecko')
      || text.includes('геккон')
      || compact.includes('ashwolf')
      || text.includes('wolf')
      || text.includes('волк')
      || String(data?.encounterRole || data?.role || '').toLowerCase() === 'animal';
  }

  function naturalCreatureSnapshotFor(data = {}, type = {}) {
    return isNaturalCreatureEnemy({
      ...data,
      visual: data.visual || type.visual || '',
      modelKey: data.modelKey || type.modelKey || '',
      species: data.species || type.species || ''
    });
  }

  function ensureEnemyWeaponGroup(enemy) {
    if (isNaturalCreatureEnemy(enemy)) return null;
    const group = enemy?.mesh;
    if (!group) return null;
    if (group.userData.enemyWeaponGroup) return group.userData.enemyWeaponGroup;
    const parts = group.userData.actorParts || {};
    if (parts.weaponGroup) {
      group.userData.enemyWeaponGroup = parts.weaponGroup;
      return parts.weaponGroup;
    }
    const s = Number(enemy.scale || 1);
    const kind = parts.kind || group.userData.enemyVisual || 'raider';
    const weaponGroup = new THREE.Group();
    if (kind === 'mutant') weaponGroup.position.set(0.74 * s, 0.9 * s, -0.34 * s);
    else if (kind === 'ghoul') weaponGroup.position.set(0.42 * s, 0.78 * s, -0.3 * s);
    else weaponGroup.position.set(0.52 * s, 0.92 * s, -0.34 * s);
    weaponGroup.rotation.set(0.05, 0.02, kind === 'mutant' ? 0.08 : -0.02);
    initWeaponVisualState(weaponGroup);
    group.add(weaponGroup);
    group.userData.enemyWeaponGroup = weaponGroup;
    return weaponGroup;
  }

  function disposeEnemyStaticEquipmentOverlay(group) {
    const overlay = group?.userData?.enemyStaticEquipmentOverlay;
    if (!overlay) return;
    disposeGroupChildren(overlay);
    try { group.remove(overlay); } catch (_) {}
    group.userData.enemyStaticEquipmentOverlay = null;
  }

  function enemyStaticEquipmentMat(id = '') {
    const key = networkEquipmentBaseId(id || '');
    if (key === 'combatArmor' || key === 'heavyArmor') return actorMats?.rustPlate || mats.metal;
    if (key === 'ballisticVest' || key === 'tacticalHelmet' || key === 'assaultHelmet') return mats.darkMetal || mats.metal;
    if (key === 'leather' || key === 'boots' || key === 'backpack') return mats.leather || actorMats?.strap;
    return mats.metal || actorMats?.rustPlate;
  }

  function addStaticEquipmentBox(parent, w, h, d, mat, x, y, z, s, rx = 0, ry = 0, rz = 0) {
    const mesh = makeEnemyBox(w, h, d, mat, x, y, z, s, rx, ry, rz);
    mesh.userData.staticEquipment = true;
    parent.add(mesh);
    return mesh;
  }

  function updateEnemyStaticEquipmentOverlay(enemy, parts = {}, eq = {}) {
    const group = enemy?.mesh;
    if (!group || !parts.staticModel) return;
    disposeEnemyStaticEquipmentOverlay(group);
    const overlay = new THREE.Group();
    overlay.userData.staticEquipmentOverlay = true;
    const s = Number(enemy.scale || 1) || 1;
    const kind = parts.kind || group.userData.enemyVisual || 'raider';
    const armorId = networkEquipmentBaseId(eq.armor || '');
    const helmetId = networkEquipmentBaseId(eq.helmet || '');
    const bootsId = networkEquipmentBaseId(eq.boots || '');
    const backpackId = networkEquipmentBaseId(eq.backpack || '');
    const yScale = kind === 'mutant' ? 1.16 : 1;
    const chestY = kind === 'mutant' ? 1.18 : 1.02;
    const headY = kind === 'mutant' ? 1.64 : 1.45;
    const shoulderX = kind === 'mutant' ? 0.62 : 0.44;

    if (armorId) {
      const armorMat = enemyStaticEquipmentMat(armorId);
      const thick = armorId === 'combatArmor' || armorId === 'heavyArmor' ? 0.12 : 0.08;
      addStaticEquipmentBox(overlay, 0.66, 0.34 * yScale, thick, armorMat, 0, chestY, -0.34, s, 0.04, 0, 0);
      addStaticEquipmentBox(overlay, 0.5, 0.26 * yScale, 0.07, armorMat, 0, chestY - 0.03, 0.2, s, -0.04, 0, 0);
      if (armorId === 'combatArmor' || armorId === 'heavyArmor' || armorId === 'metalArmor') {
        addStaticEquipmentBox(overlay, 0.18, 0.15, 0.24, armorMat, -shoulderX, chestY + 0.1, -0.08, s, 0, 0, -0.18);
        addStaticEquipmentBox(overlay, 0.18, 0.15, 0.24, armorMat, shoulderX, chestY + 0.1, -0.08, s, 0, 0, 0.18);
      }
    }

    if (helmetId) {
      const helmetMat = enemyStaticEquipmentMat(helmetId);
      const helmet = new THREE.Mesh(new THREE.CylinderGeometry(0.19 * s, 0.23 * s, 0.18 * s, 12), helmetMat);
      helmet.position.set(0, headY * s, -0.04 * s);
      helmet.userData.staticEquipment = true;
      overlay.add(helmet);
      if (helmetId === 'assaultHelmet' || helmetId === 'tacticalHelmet') {
        addStaticEquipmentBox(overlay, 0.28, 0.055, 0.04, mats.glowGreen || mats.darkMetal, 0, headY - 0.02, -0.24, s, 0, 0, 0);
      }
    }

    if (bootsId) {
      const bootMat = enemyStaticEquipmentMat(bootsId);
      addStaticEquipmentBox(overlay, 0.18, 0.14, 0.2, bootMat, -0.16, 0.16, -0.1, s, 0, 0, 0);
      addStaticEquipmentBox(overlay, 0.18, 0.14, 0.2, bootMat, 0.16, 0.16, -0.1, s, 0, 0, 0);
    }

    if (backpackId) {
      const packMat = enemyStaticEquipmentMat(backpackId);
      addStaticEquipmentBox(overlay, 0.34, 0.42, 0.18, packMat, 0, 0.9, 0.38, s, -0.08, 0, 0);
      addStaticEquipmentBox(overlay, 0.05, 0.46, 0.04, mats.darkMetal || packMat, -0.16, 0.92, 0.27, s, -0.08, 0, 0);
      addStaticEquipmentBox(overlay, 0.05, 0.46, 0.04, mats.darkMetal || packMat, 0.16, 0.92, 0.27, s, -0.08, 0, 0);
    }

    if (!overlay.children.length) return;
    group.add(overlay);
    group.userData.enemyStaticEquipmentOverlay = overlay;
  }

  function updateEnemyEquipmentVisuals(enemy) {
    const group = enemy?.mesh;
    if (!group) return;
    if (isNaturalCreatureEnemy(enemy)) {
      const parts = group.userData.actorParts || {};
      if (parts.weaponStatic) parts.weaponStatic.visible = false;
      if (group.userData.enemyWeaponGroup) {
        disposeGroupChildren(group.userData.enemyWeaponGroup);
        try { group.remove(group.userData.enemyWeaponGroup); } catch (_) {}
        group.userData.enemyWeaponGroup = null;
      }
      disposeEnemyStaticEquipmentOverlay(group);
      enemy.equipment = naturalCreatureEquipment();
      enemy.weapon = 'fists';
      enemy.canDialogue = false;
      enemy.traderStock = [];
      enemy.traderBuyInterests = [];
      enemy.inventory = [];
      enemy.traderId = '';
      enemy.traderProfile = '';
      enemy.dialogueProfile = '';
      enemy.traderQuests = [];
      group.userData.enemyEquipmentKey = 'natural-creature';
      group.userData.enemyEquipment = enemy.equipment;
      return;
    }
    const eq = enemyEquipmentFromData(enemy);
    const key = JSON.stringify(eq);
    if (group.userData.enemyEquipmentKey === key) return;
    group.userData.enemyEquipmentKey = key;
    group.userData.enemyEquipment = eq;
    enemy.equipment = eq;
    enemy.weapon = eq.weapon;

    const parts = group.userData.actorParts || {};
    applyArmorVisualSet(parts, eq);
    updateEnemyStaticEquipmentOverlay(enemy, parts, eq);
    const weaponGroup = ensureEnemyWeaponGroup(enemy);
    if (parts.weaponStatic) parts.weaponStatic.visible = !eq.weapon || eq.weapon === 'fists';
    if (!weaponGroup) return;
    disposeGroupChildren(weaponGroup);
    initWeaponVisualState(weaponGroup);
    const mesh = eq.weapon && eq.weapon !== 'fists' ? makeRemoteWeaponMesh(eq.weapon) : null;
    weaponGroup.visible = !!mesh;
    if (mesh) weaponGroup.add(mesh);
  }

  function enemyRenderKey(type = {}) {
    return [
      String(type.visual || '').toLowerCase(),
      String(type.modelKey || '').toLowerCase(),
      String(type.species || '').toLowerCase()
    ].join('|');
  }

  function currentEnemyRenderKey(enemy = {}) {
    return enemyRenderKey({
      visual: enemy.mesh?.userData?.enemyVisual || enemy.visual || '',
      modelKey: enemy.modelKey || '',
      species: enemy.species || ''
    });
  }

  function replaceEnemyVisualModel(enemy, type = {}) {
    if (!enemy) return;
    const oldMesh = enemy.mesh;
    const x = Number(enemy.visualX ?? enemy.x ?? oldMesh?.position?.x ?? 0);
    const z = Number(enemy.visualZ ?? enemy.z ?? oldMesh?.position?.z ?? 0);
    if (oldMesh) {
      forgetNetworkRevealObject(oldMesh);
      try { scene.remove(oldMesh); } catch (_) {}
    }
    const mesh = createEnemyModel(type);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    enemy.mesh = mesh;
    mesh.userData.enemy = enemy;
    mesh.traverse(child => { if (child.isMesh) child.userData.enemy = enemy; });
    const idx = enemyMeshes.indexOf(oldMesh);
    if (idx >= 0) enemyMeshes[idx] = mesh;
    else enemyMeshes.push(mesh);
  }

  function getEnemyMuzzlePoint(enemy, shotData = {}) {
    const group = enemy?.mesh;
    const weaponId = networkEquipmentBaseId(enemy?.equipment?.weapon || shotData.weapon || 'pistol', 'pistol');
    if (group) {
      const weaponGroup = group.userData.enemyWeaponGroup;
      if (weaponGroup) return weaponGroup.localToWorld(new THREE.Vector3(0, 0, remoteWeaponMuzzleLocalZ(weaponId)));
      return group.localToWorld(new THREE.Vector3(0.48, 1.05, remoteWeaponMuzzleLocalZ(weaponId)));
    }
    const sx = Number(shotData.startX), sy = Number(shotData.startY), sz = Number(shotData.startZ);
    if (Number.isFinite(sx) && Number.isFinite(sz)) return new THREE.Vector3(sx, Number.isFinite(sy) ? sy : 1.05, sz);
    const x = Number(shotData.x || 0), z = Number(shotData.z || 0);
    return new THREE.Vector3(x, 1.05, z);
  }

  function getRemoteMuzzlePoint(row, shotData = {}) {
    const sx = Number(shotData.startX), sy = Number(shotData.startY), sz = Number(shotData.startZ);
    if (Number.isFinite(sx) && Number.isFinite(sz)) return new THREE.Vector3(sx, Number.isFinite(sy) ? sy : 1.05, sz);
    const group = row?.group;
    if (group) {
      const weaponId = networkEquipmentBaseId(row.data?.equipment?.weapon || row.data?.weapon || shotData.weapon || 'pistol', 'pistol');
      return group.localToWorld(new THREE.Vector3(0.48, 1.05, remoteWeaponMuzzleLocalZ(weaponId)));
    }
    const x = Number(shotData.x || 0), z = Number(shotData.z || 0);
    return new THREE.Vector3(x, 1.05, z);
  }
