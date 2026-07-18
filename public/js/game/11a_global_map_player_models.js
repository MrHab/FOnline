  function buildGlobalMapFallbackPlayerModel() {
    const root = new THREE.Group();
    const coatMat = new THREE.MeshLambertMaterial({ color: 0x6f4a22 });
    const armorMat = new THREE.MeshLambertMaterial({ color: 0xc4b77e });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0bd8d });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x171615 });
    const body = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.22, 0.28, 0.55, 8), coatMat);
    body.position.y = 0.62;
    const chest = new THREE.Mesh(new THREE.BoxBufferGeometry(0.54, 0.34, 0.26), armorMat);
    chest.position.y = 0.86;
    const head = new THREE.Mesh(new THREE.SphereBufferGeometry(0.18, 12, 8), skinMat);
    head.position.y = 1.18;
    const helmet = new THREE.Mesh(new THREE.SphereBufferGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), darkMat);
    helmet.position.y = 1.27;
    const weapon = new THREE.Mesh(new THREE.BoxBufferGeometry(0.08, 0.08, 0.78), darkMat);
    weapon.position.set(0.34, 0.82, -0.34);
    weapon.rotation.z = -0.12;
    const pack = new THREE.Mesh(new THREE.BoxBufferGeometry(0.36, 0.42, 0.16), new THREE.MeshLambertMaterial({ color: 0x8a6130 }));
    pack.position.set(0, 0.78, 0.23);
    root.add(body, chest, head, helmet, weapon, pack);
    return root;
  }

  function globalMapPlayerMarkerCircleRadius() {
    return 0.52;
  }

  function buildGlobalMapPlayerModelMarker() {
    const marker = new THREE.Group();
    marker.frustumCulled = false;
    const halo = new THREE.Mesh(
      new THREE.TorusBufferGeometry(globalMapPlayerMarkerCircleRadius(), 0.026, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe077, transparent: true, opacity: 0.42, depthTest: false })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.035;
    marker.add(halo);
    marker.userData.playerHalo = halo;

    const parts = {};
    const modelRoot = new THREE.Group();
    try {
      if (typeof buildWastelandHumanoid === 'function') {
        buildWastelandHumanoid(modelRoot, parts, { castShadow: false, isPlayer: true });
        if (typeof buildCharacterArmorExtras === 'function') buildCharacterArmorExtras(modelRoot, parts, false);
        if (parts.weaponGroup && typeof initWeaponVisualState === 'function') initWeaponVisualState(parts.weaponGroup);
      } else {
        modelRoot.add(buildGlobalMapFallbackPlayerModel());
      }
    } catch (_) {
      modelRoot.clear();
      modelRoot.add(buildGlobalMapFallbackPlayerModel());
    }
    modelRoot.scale.setScalar(0.36);
    modelRoot.position.y = 0.06;
    marker.add(modelRoot);
    marker.userData.modelRoot = modelRoot;
    marker.userData.parts = parts;
    marker.userData.equipmentSignature = '';
    if (typeof stabilizeCharacterNoCull === 'function') stabilizeCharacterNoCull(marker);
    else marker.traverse?.(obj => { obj.frustumCulled = false; });
    return marker;
  }

  function globalMapPlayerWeaponMesh(weaponId = '') {
    const id = String(weaponId || 'fists');
    if (id === 'pistol' && typeof makePistolMesh === 'function') return makePistolMesh();
    if (id === 'rifle' && typeof makeRifleMesh === 'function') return makeRifleMesh();
    if (id === 'assaultRifle' && typeof makeAssaultRifleMesh === 'function') return makeAssaultRifleMesh();
    if (id === 'machineGun' && typeof makeMachineGunMesh === 'function') return makeMachineGunMesh();
    if (id === 'laserPistol' && typeof makeLaserPistolMesh === 'function') return makeLaserPistolMesh();
    if (id === 'flamethrower' && typeof makeFlamethrowerMesh === 'function') return makeFlamethrowerMesh();
    if (id === 'plasmaRifle' && typeof makePlasmaRifleMesh === 'function') return makePlasmaRifleMesh();
    if (id === 'shotgun' && typeof makeShotgunMesh === 'function') return makeShotgunMesh();
    if (id === 'rocketLauncher' && typeof makeRocketLauncherMesh === 'function') return makeRocketLauncherMesh();
    if (id === 'knife' && typeof makeKnifeMesh === 'function') return makeKnifeMesh();
    if (id === 'pickaxe' && typeof makePickaxeMesh === 'function') return makePickaxeMesh();
    if (id === 'axe' && typeof makeAxeMesh === 'function') return makeAxeMesh();
    if (id === 'handPump' && typeof makeHandPumpMesh === 'function') return makeHandPumpMesh();
    return null;
  }

  function updateGlobalMapPlayerModelVisuals(marker = null) {
    if (!marker?.userData) return;
    const parts = marker.userData.parts || {};
    const eq = typeof equipment !== 'undefined' && equipment ? equipment : {};
    let weaponId = eq.weapon || 'fists';
    try {
      const w = typeof currentWeapon === 'function' ? currentWeapon() : null;
      weaponId = (typeof equipmentVisualBaseId === 'function' ? equipmentVisualBaseId(w?.id || eq.weapon || 'fists') : (w?.id || eq.weapon || 'fists')) || 'fists';
    } catch (_) {
      weaponId = eq.weapon || 'fists';
    }
    const signature = [
      weaponId,
      eq.armor || '',
      eq.helmet || '',
      eq.boots || '',
      eq.backpack || ''
    ].join('|');
    if (marker.userData.equipmentSignature === signature) return;
    marker.userData.equipmentSignature = signature;
    if (parts.weaponGroup) {
      parts.weaponGroup.clear();
      if (typeof initWeaponVisualState === 'function') initWeaponVisualState(parts.weaponGroup);
      const weaponMesh = globalMapPlayerWeaponMesh(weaponId);
      if (weaponMesh) parts.weaponGroup.add(weaponMesh);
    }
    if (typeof applyArmorVisualSet === 'function') applyArmorVisualSet(parts, eq);
    if (typeof stabilizeCharacterNoCull === 'function') stabilizeCharacterNoCull(marker);
  }

  function globalMapFacingYFromWorldDelta(dx = 0, dz = 0, facingOffsetY = 0) {
    const vx = Number(dx || 0);
    const vz = Number(dz || 0);
    if (Math.hypot(vx, vz) <= 0.001) return null;
    return Math.atan2(-vx, -vz) + Number(facingOffsetY || 0);
  }

  function updateGlobalMapPlayerModelDirection(marker = null, playerPoint = null, destinationPoint = null) {
    if (!marker || !playerPoint) return;
    const from = globalMapWorldFromPoint(playerPoint);
    const hasDestination = destinationPoint && globalMapPointDistance(playerPoint, destinationPoint) > 0.35;
    if (hasDestination) {
      const to = globalMapWorldFromPoint(destinationPoint);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const facingY = globalMapFacingYFromWorldDelta(dx, dz, marker.userData?.facingOffsetY || 0);
      if (Number.isFinite(facingY)) marker.userData.lastFacingY = facingY;
    }
    const targetY = Number.isFinite(Number(marker.userData.lastFacingY)) ? Number(marker.userData.lastFacingY) : Math.PI * 0.25;
    marker.rotation.y = targetY;
  }

  function updateGlobalMapWorldPartyModelDirection(group = null, row = {}, displayPoint = null) {
    if (!group || !row) return;
    const fromPoint = displayPoint || globalMapWorldPartyDisplayPoint(row);
    const destinationPoint = globalMapWorldPartyDestinationPoint(row);
    const hasLookPoint = fromPoint && destinationPoint && globalMapPointDistance(fromPoint, destinationPoint) > 0.18;
    if (hasLookPoint) {
      const from = globalMapWorldFromPoint(fromPoint);
      const to = globalMapWorldFromPoint(destinationPoint);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const facingY = globalMapFacingYFromWorldDelta(dx, dz, group.userData?.facingOffsetY || 0);
      if (Number.isFinite(facingY)) group.userData.lastFacingY = facingY;
    }
    const targetY = Number.isFinite(Number(group.userData.lastFacingY)) ? Number(group.userData.lastFacingY) : Math.PI * 0.25;
    group.rotation.y = targetY;
  }

