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
      if (typeof buildGlbOnlyHumanoidAnchors === 'function') {
        buildGlbOnlyHumanoidAnchors(modelRoot, parts);
        if (parts.weaponGroup && typeof initWeaponVisualState === 'function') initWeaponVisualState(parts.weaponGroup);
        if (parts.offhandWeaponGroup && typeof initWeaponVisualState === 'function') initWeaponVisualState(parts.offhandWeaponGroup);
      }
    } catch (_) {
      modelRoot.clear();
    }
    modelRoot.scale.setScalar(0.36);
    modelRoot.position.y = 0.06;
    marker.add(modelRoot);
    marker.userData.modelRoot = modelRoot;
    marker.userData.parts = parts;
    marker.userData.equipmentSignature = '';
    modelRoot.userData.parts = parts;
    if (typeof applyCharacterGlbAppearance === 'function') {
      void applyCharacterGlbAppearance(modelRoot, characterProfile?.appearance || {}, {
        castShadow: false,
        equipment: typeof equipment !== 'undefined' ? equipment : {}
      });
    }
    if (typeof stabilizeCharacterNoCull === 'function') stabilizeCharacterNoCull(marker);
    else marker.traverse?.(obj => { obj.frustumCulled = false; });
    return marker;
  }

  function globalMapPlayerWeaponMesh(weaponId = '') {
    const id = String(weaponId || 'fists');
    return typeof makeWeaponModelMesh === 'function' ? makeWeaponModelMesh(id) : null;
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
    const rightWeaponId = typeof equipmentVisualBaseId === 'function'
      ? (equipmentVisualBaseId(eq.weapon || 'fists') || 'fists')
      : (eq.weapon || 'fists');
    const leftWeaponId = typeof equipmentVisualBaseId === 'function'
      ? equipmentVisualBaseId(eq.offhand || '')
      : (eq.offhand || '');
    const signature = [
      weaponId,
      rightWeaponId,
      leftWeaponId,
      eq.armor || '',
      eq.helmet || '',
      eq.boots || '',
      eq.backpack || ''
    ].join('|');
    if (marker.userData.equipmentSignature === signature) return;
    marker.userData.equipmentSignature = signature;
    marker.userData.modelRoot.userData.weaponId = weaponId;
    marker.userData.modelRoot.userData.weaponHandSlot = typeof activeWeaponEquipmentSlot === 'function'
      ? activeWeaponEquipmentSlot()
      : weaponHandSlotFromEquipment(eq, weaponId);
    [
      [parts.weaponGroup, rightWeaponId, 'weapon'],
      [parts.offhandWeaponGroup, leftWeaponId, 'offhand']
    ].forEach(([weaponGroup, slotWeaponId, handSlot]) => {
      if (!weaponGroup) return;
      if (typeof cancelWeaponGlbForGroup === 'function') cancelWeaponGlbForGroup(weaponGroup);
      weaponGroup.clear();
      weaponGroup.userData.weaponGlbRequestId = Number(weaponGroup.userData.weaponGlbRequestId || 0) + 1;
      if (typeof initWeaponVisualState === 'function') initWeaponVisualState(weaponGroup);
      weaponGroup.userData.handSlot = handSlot;
      weaponGroup.userData.weaponId = slotWeaponId || 'fists';
      const weaponMesh = slotWeaponId && slotWeaponId !== 'fists' ? globalMapPlayerWeaponMesh(slotWeaponId) : null;
      if (typeof setWeaponGlbGroupVisibility === 'function') {
        setWeaponGlbGroupVisibility(weaponGroup, !!weaponMesh);
      } else weaponGroup.visible = !!weaponMesh;
      if (weaponMesh) weaponGroup.add(weaponMesh);
      else if (slotWeaponId && slotWeaponId !== 'fists' && typeof requestWeaponGlbForGroup === 'function') {
        requestWeaponGlbForGroup(weaponGroup, slotWeaponId, {
          onReady() {
            if (typeof stabilizeCharacterNoCull === 'function') stabilizeCharacterNoCull(marker);
          }
        });
      }
    });
    if (typeof applyArmorVisualSet === 'function') applyArmorVisualSet(parts, eq);
    if (typeof stabilizeCharacterNoCull === 'function') stabilizeCharacterNoCull(marker);
  }

  function globalMapFacingYFromWorldDelta(dx = 0, dz = 0, facingOffsetY = 0) {
    const vx = Number(dx || 0);
    const vz = Number(dz || 0);
    if (Math.hypot(vx, vz) <= 0.001) return null;
    return Math.atan2(-vx, -vz) + Number(facingOffsetY || 0);
  }

  // Модель на глобальной карте стояла в T-позе: её загружали, но миксер
  // никто не крутил. Гоняем тот же рантайм, что и в локации, но без IK стоп:
  // маркер уменьшен и приподнят над рельефом, привязывать стопы не к чему.
  const GLOBAL_MAP_PLAYER_WALK_SPEED = 1.6;

  function updateGlobalMapPlayerModelAnimation(marker = null, dt = 0.016) {
    const modelRoot = marker?.userData?.modelRoot;
    if (!modelRoot?.userData?.characterGlbRuntime) return false;
    if (typeof updateCharacterGlbAnimation !== 'function') return false;
    const frameDt = Math.max(0, Math.min(0.08, Number(dt) || 0));
    const travelling = !!(typeof globalMapState !== 'undefined' && globalMapState?.travel);
    return updateCharacterGlbAnimation(modelRoot, frameDt, {
      moving: travelling,
      speed: travelling ? GLOBAL_MAP_PLAYER_WALK_SPEED : 0,
      moveX: 0,
      moveZ: travelling ? GLOBAL_MAP_PLAYER_WALK_SPEED * frameDt : 0,
      facingAngle: 0,
      footIk: false,
      turning: false,
      turnAmount: 0
    }) === true;
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
