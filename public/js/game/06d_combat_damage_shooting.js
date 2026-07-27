  function renderInventoryIfVisibleDeferred() {
    const invOpen = !!(uiWindows?.inventory && uiWindows.inventory.classList.contains('visible'));
    const needFullInventory = invOpen || traderWindowOpen || storageWindowOpen || activeLootEnemy || activeWorldContainer;
    if (!needFullInventory) return;
    if (deferredInventoryRenderQueued) return;
    deferredInventoryRenderQueued = true;
    requestAnimationFrame(() => {
      deferredInventoryRenderQueued = false;
      renderInventory();
    });
  }

  function spendAttackCost(w, modeInfo = getWeaponModeInfo(w)) {
    if (player.fireCooldown > 0 || player.reloadTimer > 0) return false;
    const apCost = Math.max(0, Number(modeInfo.apCost || w.apCost || 2) + injuryApPenalty('attack'));
    const apBefore = Number(player.ap || 0);
    const loadedBefore = w.ammoType ? Number(w.loaded || 0) : 0;
    const conditionBefore = Number.isFinite(Number(w?.condition)) ? Number(w.condition) : null;
    if (player.ap < apCost) {
      setReadout(`Недостаточно очков действий. Нужно ${formatActionCost(apCost)} ОД.`);
      return false;
    }
    if (w.ammoType && w.loaded <= 0) {
      addLog('Щёлк! Магазин пуст. Нажмите R для перезарядки.', null, 'combat');
      setReadout('Оружие разряжено. R — перезарядить.');
      return false;
    }
    if (rollEnergyFailure(w, modeInfo)) {
      const risk = Math.round(energyFailureChance(w, modeInfo) * 100);
      player.fireCooldown = Math.max(player.fireCooldown, 1.0 + risk / 100);
      if (typeof w.condition === 'number') w.condition = Math.max(1, w.condition - Math.max(0.35, 1 - talentLevel('weaponSmith') * 0.18));
      addLog(`${w.icon} ${w.name}: перегрев/сбой (${risk}%). Выстрел заблокирован.`, null, 'combat');
      setReadout(`${w.name}: перегрев/сбой. Навык Энергетическое снижает этот риск.`);
      renderWeaponReadout();
      updateTargetHintFromHover();
      queueSave();
      return false;
    }
    const shots = w.ammoType ? Math.max(1, Math.min(modeInfo.shots || 1, w.loaded)) : 1;
    player.ap = Math.max(0, player.ap - apCost);
    player.fireCooldown = (w.fireRate || 0.5) * (modeInfo.fireRateMul || 1);
    if (w.ammoType) w.loaded = Math.max(0, w.loaded - shots);
    if (w.ammoType && typeof w.condition === 'number') {
      const wear = Math.max(0.25, 0.55 - talentLevel('weaponSmith') * 0.12);
      w.condition = Math.max(1, w.condition - wear * shots);
    }
    const conditionAfter = Number.isFinite(Number(w?.condition)) ? Number(w.condition) : conditionBefore;
    const spend = { token: makeAttackToken(), shots, apCost, apBefore, apAfter: Number(player.ap || 0), loadedBefore, loadedAfter: w.ammoType ? Number(w.loaded || 0) : 0, conditionBefore, conditionAfter };
    renderQuickbar();
    renderWeaponReadout();
    updateTargetHintFromHover();
    return spend;
  }

  function submitUntargetedServerAttack(w, modeInfo, spend) {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined || !spend) return false;
    return emitGuardedMultiplayerGameplayAction('combatAttack', {
      ...multiplayerProgressionSnapshot(),
      equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
      weapon: weaponBaseId(w),
      mode: modeInfo?.id || player.fireMode || 'single',
      attackToken: spend.token || '',
      combat: combatResourceSnapshot(w, modeInfo, spend)
    }, ack => {
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (ack?.combat) applyServerCombatState(ack.combat);
      if (ack && !ack.ok && ack.error) setReadout(ack.error);
    });
  }

  function applyWeaponDamage(enemy, dist, w, modeInfo = getWeaponModeInfo(w), options = {}) {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    if (!currentLocationAllowsNpcCombat()) return rejectPeacefulNpcCombat();
    const hitChance = calculateHitChance(enemy, dist, w, modeInfo, options);
    const shotgunDamageMul = shotgunDamageMultiplierAt(w, dist, options.conePerp || 0, options.coneWidth);

    if (enemiesAreServerAuthoritative()) {
      const observedTarget = enemyCombatTargetPoint(enemy);
      const rawBase = (damageRoll(w) + (w.ammoType ? talentLevel('sharpshooter') * 2 : 0)) * fireDamageMultiplier(w);
      const raw = Math.max(1, Math.round(rawBase * (modeInfo.damageMul || 1) * ambushDamageMultiplier(enemy) * shotgunDamageMul));
      const preservedTargetId = isMobileControlsEnabled() ? mobileAutoTargetId(player.attackTarget || enemy) : '';
      const emitted = emitGuardedMultiplayerGameplayAction('enemyHit', {
        enemyId: enemy.id,
        ...multiplayerProgressionSnapshot(),
        equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
        clientPredictedDamage: raw,
        clientHitChance: Math.round(hitChance * 100),
        weapon: weaponBaseId(w),
        mode: modeInfo.id,
        multiTarget: !!options.multiTarget,
        conePerp: Number.isFinite(Number(options.conePerp)) ? Number(options.conePerp) : 0,
        coneWidth: Number.isFinite(Number(options.coneWidth)) ? Number(options.coneWidth) : coneWeaponWidthAtDistance(w, dist),
        shotDirX: Number.isFinite(Number(options.shotDirX)) ? Number(options.shotDirX) : null,
        shotDirZ: Number.isFinite(Number(options.shotDirZ)) ? Number(options.shotDirZ) : null,
        attackToken: options.spend?.token || '',
        combat: combatResourceSnapshot(w, modeInfo, options.spend || {}),
        x: player.x,
        z: player.z,
        targetX: observedTarget.x,
        targetZ: observedTarget.z,
        angle: player.angle
      }, ack => {
        if (ack && ack.ok && ack.enemy) {
          const serverEnemy = ack.enemy;
          if (ack.hit === false) {
            createFloatingText(enemy.x, enemy.z, 'мимо', '#b7b7b7');
            addLog(`${w.icon} ${w.name} (${modeInfo.label}): промах ${Math.max(0, Number(ack.chance || hitChance * 100)).toFixed(0)}%.`, null, 'combat');
          } else {
            const damage = Math.max(0, Number(ack.damage || 0));
            const absorbed = Math.max(0, Number(ack.absorbed || 0));
            const type = ack.damageType || w.damageType || 'ballistic';
            enemy.flash = 0.14;
            if (damage > 0) createFloatingText(enemy.x, enemy.z, '-' + damage, '#ff765d');
            const absorbedText = absorbed > 0 ? `, броня поглотила ${absorbed}` : '';
            addLog(`${w.icon} ${w.name} (${modeInfo.label}, ${damageTypeLabel(type)}): ${enemy.name} получает ${damage} урона${absorbedText}.`, null, 'combat');
          }
          applyNetworkEnemies([serverEnemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
          if (ack.combat) applyServerCombatState(ack.combat);
          if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
          restoreMobileAutoTargetById(preservedTargetId);
        } else if (ack && ack.error) {
          if (ack.enemy) applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
          if (ack.combat) applyServerCombatState(ack.combat);
          if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
          setReadout(ack.error);
          restoreMobileAutoTargetById(preservedTargetId);
        }
        updateTargetHintFromHover();
      });
      renderInventoryIfVisibleDeferred();
      updateTargetHintFromHover();
      return emitted;
    }

    if (Math.random() > hitChance) {
      createFloatingText(enemy.x, enemy.z, 'мимо', '#b7b7b7');
      addLog(`${w.icon} ${w.name} (${modeInfo.label}): промах ${Math.round(hitChance * 100)}%.`, null, 'combat');
      renderInventoryIfVisibleDeferred();
      return false;
    }
    const rawBase = (damageRoll(w) + (w.ammoType ? talentLevel('sharpshooter') * 2 : 0)) * fireDamageMultiplier(w);
    const raw = Math.max(1, Math.round(rawBase * (modeInfo.damageMul || 1) * ambushDamageMultiplier(enemy) * shotgunDamageMul));
    const dmgInfo = mitigateEnemyDamage(raw, enemy, w.damageType || 'ballistic');
    const dmg = dmgInfo.damage;
    enemy.flash = 0.14;
    createFloatingText(enemy.x, enemy.z, '-' + dmg, '#ff765d');
    const absorbedText = dmgInfo.absorbed > 0 ? `, броня поглотила ${dmgInfo.absorbed}` : '';
    addLog(`${w.icon} ${w.name} (${modeInfo.label}, ${damageTypeLabel(dmgInfo.type)}): ${enemy.name} получает ${dmg} урона${absorbedText}.`, null, 'combat');

    enemy.hp -= dmg;
    if (enemy.hp <= 0) killEnemy(enemy);
    renderInventoryIfVisibleDeferred();
    updateTargetHintFromHover();
    return true;
  }

  function spawnWeaponTracers(w, shots, start, endX, endZ, modeInfo, options = {}) {
    if (!w.ammoType) return;
    const fx = weaponFxProfile(w);
    const weaponId = weaponBaseId(w);
    triggerWeaponVisualRecoil(playerParts.weaponGroup, weaponId);

    // Visual shots must follow the same gameplay ray axis. Do not draw tracer
    // from the laterally offset muzzle to the collision point: at close range
    // that creates a fake sideways shot. The muzzle is used only for height and
    // flash; the tracer/flame starts on the centered shot ray.
    const originX = Number.isFinite(Number(options.originX)) ? Number(options.originX) : Number(player?.x || start?.x || 0);
    const originZ = Number.isFinite(Number(options.originZ)) ? Number(options.originZ) : Number(player?.z || start?.z || 0);
    let dirX = Number(options.dirX);
    let dirZ = Number(options.dirZ);
    let dirLen = Math.hypot(dirX, dirZ);
    if (!Number.isFinite(dirLen) || dirLen <= 0.0001) {
      dirX = Number(endX || 0) - originX;
      dirZ = Number(endZ || 0) - originZ;
      dirLen = Math.hypot(dirX, dirZ);
    }
    if (!Number.isFinite(dirLen) || dirLen <= 0.0001) {
      dirX = Math.sin(Number(player?.angle || 0));
      dirZ = Math.cos(Number(player?.angle || 0));
      dirLen = Math.hypot(dirX, dirZ) || 1;
    }
    dirX /= dirLen;
    dirZ /= dirLen;
    const requestedEndDist = Number.isFinite(Number(options.endDist))
      ? Number(options.endDist)
      : Math.max(0, (Number(endX || 0) - originX) * dirX + (Number(endZ || 0) - originZ) * dirZ);
    const closeBlockedFx = !!options.closeBlocked || requestedEndDist < 0.72;
    const blockedFx = closeBlockedFx || !!options.blockedByStatic;
    if (closeBlockedFx) {
      spawnBlockedMuzzleFlash(start, w);
      return;
    }

    // Start the visible shot at the actual muzzle, but keep the ray parallel to
    // the gameplay axis. This avoids both old problems: no sideward diagonal to
    // the centre-hit point, and no tracer coming out of the character centre.
    const muzzleX = Number.isFinite(Number(start?.x)) ? Number(start.x) : originX;
    const muzzleZ = Number.isFinite(Number(start?.z)) ? Number(start.z) : originZ;
    const muzzleAlong = (muzzleX - originX) * dirX + (muzzleZ - originZ) * dirZ;
    const remainingDist = requestedEndDist - Math.max(0, muzzleAlong);
    if (remainingDist < 0.16) {
      spawnBlockedMuzzleFlash(start, w);
      return;
    }
    const fxStartX = muzzleX;
    const fxStartZ = muzzleZ;
    const baseEndX = muzzleX + dirX * remainingDist;
    const baseEndZ = muzzleZ + dirZ * remainingDist;
    const rightX = -dirZ;
    const rightZ = dirX;
    const visualJitter = blockedFx ? 0 : (modeInfo.id === 'auto' ? 0.28 : 0.12);

    if (weaponId === 'flamethrower') {
      for (let i = 0; i < shots; i++) {
        const jitter = blockedFx ? 0 : (Math.random() - 0.5) * 0.32;
        spawnFlameCone(fxStartX, fxStartZ, baseEndX + rightX * jitter, baseEndZ + rightZ * jitter, Number(start?.y || 1.12), 1.05, fx);
      }
      return;
    }
    const pelletCount = weaponId === 'shotgun' ? (combatRenderTier() === 'minimal' ? 3 : 6) : 1;
    const spreadScale = blockedFx ? 0 : (weaponId === 'shotgun' ? shotgunVisualSpreadAtDistance(w, requestedEndDist) : visualJitter);
    for (let i = 0; i < shots; i++) {
      for (let p = 0; p < pelletCount; p++) {
        const jitter = (Math.random() - 0.5) * spreadScale;
        spawnTracer(fxStartX, fxStartZ, baseEndX + rightX * jitter, baseEndZ + rightZ * jitter, Number(start?.y || 1.12), 1.05, fx);
      }
    }
  }


  let localShotFxSeq = 0;

  function emitShootFxPacket(w, modeInfo, muzzle, endX, endZ, options = {}) {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) return;
    const payload = {
      shotSeq: ++localShotFxSeq,
      clientFiredAt: (typeof performance !== 'undefined' && performance.now) ? Math.round(performance.now()) : Date.now(),
      startX: muzzle.x,
      startY: muzzle.y,
      startZ: muzzle.z,
      originX: Number.isFinite(Number(options.originX)) ? Number(options.originX) : player.x,
      originZ: Number.isFinite(Number(options.originZ)) ? Number(options.originZ) : player.z,
      dirX: Number.isFinite(Number(options.dirX)) ? Number(options.dirX) : Math.sin(Number(player.angle || 0)),
      dirZ: Number.isFinite(Number(options.dirZ)) ? Number(options.dirZ) : Math.cos(Number(player.angle || 0)),
      endDist: Number.isFinite(Number(options.endDist)) ? Number(options.endDist) : null,
      fxSuppressed: !!options.fxSuppressed,
      endX,
      endZ,
      angle: player.angle,
      weapon: weaponBaseId(w),
      mode: modeInfo?.id || player.fireMode || 'single',
      explosiveRadius: options.explosiveRadius || 0,
      deviceType: getDeviceType(),
      controlType: getDeviceControlType()
    };
    // This event only draws shot FX on other clients. It is intentionally
    // volatile and compact: authoritative damage still goes through enemyHit.
    const shotSocket = multiplayer.socket.volatile || multiplayer.socket;
    shotSocket.emit('shoot', payload);
  }

  function emitMeleeFxPacket(w, target = null) {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) return;
    const meleeSocket = multiplayer.socket.volatile || multiplayer.socket;
    meleeSocket.emit('melee', {
      x: player.x,
      z: player.z,
      angle: player.angle,
      targetX: Number.isFinite(Number(target?.x)) ? Number(target.x) : null,
      targetZ: Number.isFinite(Number(target?.z)) ? Number(target.z) : null,
      weapon: weaponBaseId(w),
      equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
      deviceType: getDeviceType(),
      controlType: getDeviceControlType(),
      t: Date.now()
    });
  }

  function normalizeClientLocationPvpMode(value = '', safeFallback = true) {
    if (typeof value === 'boolean') return value ? 'pvp' : (safeFallback ? 'peaceful' : 'pvp');
    const raw = String(value || '').trim();
    if (raw === 'peaceful' || raw === 'pvp' || raw === 'pvpFullDrop') return raw;
    const low = raw.toLowerCase();
    if (['peace', 'safe', 'safezone', 'no_pvp', 'nopvp', 'noncombat', 'social'].includes(low)) return 'peaceful';
    if (['pvpfulldrop', 'fullpvp', 'fulldrop', 'full_drop', 'pvp-full-drop', 'pvp_full_drop'].includes(low)) return 'pvpFullDrop';
    if (['pvp', 'danger', 'dangerous', 'unsafe', 'true', 'combat'].includes(low)) return 'pvp';
    return safeFallback ? 'peaceful' : 'pvp';
  }

  function currentLocationCombatMode() {
    const locMode = currentLocation?.pvpMode ?? currentLocation?.pvpType ?? currentLocation?.combatMode ?? currentLocation?.pvp;
    if (locMode !== undefined && locMode !== null && String(locMode).trim() !== '') {
      return normalizeClientLocationPvpMode(locMode, currentLocation?.safe !== false);
    }
    if (currentLocation?.safe === true) return 'peaceful';
    if (currentLocation?.safe === false) return 'pvp';
    const mode = multiplayer?.pvpMode || '';
    return normalizeClientLocationPvpMode(mode, true);
  }

  const CLIENT_FACTION_CAPITAL_LOCATION_IDS = new Set(['settlement', 'scrapTown', 'relayStation']);

  function currentLocationIsFactionCapital() {
    const id = String(currentLocation?.id || multiplayer?.locationId || '').trim();
    return CLIENT_FACTION_CAPITAL_LOCATION_IDS.has(id);
  }

  function currentLocationAllowsPvp() {
    return !currentLocationIsFactionCapital();
  }

  function currentLocationAllowsNpcCombat() {
    return !currentLocationIsFactionCapital();
  }

  function rejectPeacefulNpcCombat() {
    setReadout('В мирной локации нельзя атаковать НПС.');
    return false;
  }

  function remotePlayerTargetPosition(row) {
    if (!row) return null;
    const g = row.group;
    const data = row.data || {};
    const x = Number.isFinite(Number(g?.position?.x)) ? Number(g.position.x) : Number(data.x);
    const z = Number.isFinite(Number(g?.position?.z)) ? Number(g.position.z) : Number(data.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z };
  }

  function findRemotePlayerAlongRay(dir, maxDist) {
    if (!currentLocationAllowsPvp() || !multiplayer?.remotePlayers || !multiplayer.remotePlayers.size) return null;
    let best = null;
    multiplayer.remotePlayers.forEach((row, id) => {
      const data = row?.data || {};
      if (!row || data.dead || Number(data.hp || 1) <= 0) return;
      const pos = remotePlayerTargetPosition(row);
      if (!pos) return;
      if (typeof isWorldPointVisibleByRtsFog === 'function' && !isWorldPointVisibleByRtsFog(pos.x, pos.z, { crouching: !!data.crouching })) return;
      const vx = pos.x - player.x;
      const vz = pos.z - player.z;
      const proj = vx * dir.x + vz * dir.z;
      if (proj < 0.35 || proj > maxDist + 0.45) return;
      const perp = Math.hypot(vx - dir.x * proj, vz - dir.z * proj);
      const radius = 0.58;
      if (perp > radius) return;
      if (!best || proj < best.dist) {
        best = {
          id,
          row,
          data,
          x: pos.x,
          z: pos.z,
          dist: proj,
          perp,
          name: data.name || 'Игрок',
          dead: false
        };
      }
    });
    return best;
  }

  function triggerRemotePlayerHitFeedback(target, color = 0xff765d) {
    if (!target) return;
    if (combatRenderTier() === 'minimal') return;
    const glow = acquireCombatGlow(color, target.x, 0.98, target.z, 0.24, 0.44);
    sparks.push({ obj: glow, life: 0.055, maxLife: 0.055, kind: 'mesh', baseScale: 0.18, peakScale: 0.46, pooled: true });
  }

  function applyPlayerWeaponDamage(target, dist, w, modeInfo = getWeaponModeInfo(w), options = {}) {
    if (!target || !target.id || !multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) return false;
    if (!currentLocationAllowsPvp()) {
      setReadout('В этой локации PvP запрещён.');
      return false;
    }
    triggerRemotePlayerHitFeedback(target);
    const hitChance = calculateHitChance({ x: target.x, z: target.z, dead: false, scale: 1 }, dist, w, modeInfo, options);
    const emitted = emitGuardedMultiplayerGameplayAction('playerHit', {
      targetId: target.id,
      ...multiplayerProgressionSnapshot(),
      equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
      inventory: typeof multiplayerInventorySnapshot === 'function' ? multiplayerInventorySnapshot() : null,
      clientHitChance: Math.round(hitChance * 100),
      weapon: weaponBaseId(w),
      mode: modeInfo.id,
      conePerp: Number.isFinite(Number(options.conePerp)) ? Number(options.conePerp) : target.perp || 0,
      coneWidth: Number.isFinite(Number(options.coneWidth)) ? Number(options.coneWidth) : coneWeaponWidthAtDistance(w, dist),
      shotDirX: Number.isFinite(Number(options.shotDirX)) ? Number(options.shotDirX) : null,
      shotDirZ: Number.isFinite(Number(options.shotDirZ)) ? Number(options.shotDirZ) : null,
      attackToken: options.spend?.token || '',
      combat: combatResourceSnapshot(w, modeInfo, options.spend || {}),
      x: player.x,
      z: player.z,
      angle: player.angle
    }, ack => {
      if (ack && ack.ok) {
        if (ack.hit === false) {
          createFloatingText(target.x, target.z, 'мимо', '#b7b7b7');
          addLog(`${w.icon} ${w.name} (${modeInfo.label}): промах по игроку ${Math.max(0, Number(ack.chance || hitChance * 100)).toFixed(0)}%.`, null, 'combat');
        } else {
          const damage = Math.max(0, Number(ack.damage || 0));
          const absorbed = Math.max(0, Number(ack.absorbed || 0));
          const type = ack.damageType || w.damageType || 'ballistic';
          if (damage > 0) createFloatingText(target.x, target.z, '-' + damage, '#ff765d');
          const absorbedText = absorbed > 0 ? `, броня поглотила ${absorbed}` : '';
          addLog(`${w.icon} ${w.name} (${modeInfo.label}, ${damageTypeLabel(type)}): ${target.name} получает ${damage} урона${absorbedText}.`, null, 'combat');
        }
        if (ack.target && target.row) {
          target.row.data = { ...target.row.data, ...ack.target };
          if (Number(ack.target.hp || 0) <= 0 || ack.killed) {
            if (typeof removeRemotePlayerFromNetworkEvent === 'function') removeRemotePlayerFromNetworkEvent({ id: target.id, characterId: ack.target.characterId });
          }
        }
        if (ack.combat) applyServerCombatState(ack.combat);
      } else if (ack && ack.error) {
        if (ack.combat) applyServerCombatState(ack.combat);
        setReadout(ack.error);
      }
      updateTargetHintFromHover();
    });
    renderInventoryIfVisibleDeferred();
    updateTargetHintFromHover();
    return emitted;
  }

  function shootAtPoint(x, z) {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    const w = currentWeapon();
    const modeInfo = ensureWeaponMode(w);
    let dx = x - player.x;
    let dz = z - player.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.15 && !isExplosionWeapon(w)) return false;
    if (len < 0.15 && isExplosionWeapon(w)) {
      dx = Math.sin(player.angle) * 0.1;
      dz = Math.cos(player.angle) * 0.1;
      len = 0.1;
    }
    const dir = { x: dx / Math.max(0.001, len), z: dz / Math.max(0.001, len) };
    if (len >= 0.15) facePoint(x, z);

    const maxRange = Math.max(0.4, w.range);
    const isRocket = isExplosionWeapon(w);
    const intendedDist = isRocket ? Math.min(maxRange, Math.max(0.15, len)) : maxRange;
    const staticBlockDist = typeof staticCollisionRayHitDistance === 'function'
      ? staticCollisionRayHitDistance(player.x, player.z, dir.x, dir.z, intendedDist, 0.035, { startPad: 0.20 })
      : null;
    const clearRange = blockingDistanceOnRay(dir, intendedDist);
    const shotBlockedByStatic = staticBlockDist !== null && staticBlockDist < intendedDist - 0.08;
    const closeBlockedShot = shotBlockedByStatic && staticBlockDist < 0.82;
    const impactDist = isRocket ? Math.min(intendedDist, clearRange) : clearRange;
    const coneTargets = (!isRocket && isMultiTargetConeWeapon(w)) ? findEnemiesInWeaponCone(dir, maxRange, w) : [];
    const enemy = coneTargets.length ? coneTargets[0].enemy : (!isRocket ? findEnemyAlongRay(dir, clearRange) : null);
    const pvpTarget = !isRocket ? findRemotePlayerAlongRay(dir, clearRange) : null;
    const enemyDist = enemy ? Math.hypot(enemy.x - player.x, enemy.z - player.z) : Infinity;
    const primaryPvpTarget = pvpTarget && pvpTarget.dist <= enemyDist + 0.05 ? pvpTarget : null;
    const effectiveEnemy = primaryPvpTarget ? null : enemy;
    const endDist = isRocket
      ? impactDist
      : (isMultiTargetConeWeapon(w)
        ? Math.min(maxRange, coneTargets.length ? Math.max(...coneTargets.map(t => t.proj)) + 0.75 : clearRange)
        : (primaryPvpTarget ? primaryPvpTarget.x - player.x : (effectiveEnemy ? effectiveEnemy.x - player.x : dir.x * clearRange)) * dir.x
          + (primaryPvpTarget ? primaryPvpTarget.z - player.z : (effectiveEnemy ? effectiveEnemy.z - player.z : dir.z * clearRange)) * dir.z);
    const endX = isRocket ? player.x + dir.x * endDist : (isMultiTargetConeWeapon(w) ? player.x + dir.x * endDist : (primaryPvpTarget ? primaryPvpTarget.x : (effectiveEnemy ? effectiveEnemy.x : player.x + dir.x * endDist)));
    const endZ = isRocket ? player.z + dir.z * endDist : (isMultiTargetConeWeapon(w) ? player.z + dir.z * endDist : (primaryPvpTarget ? primaryPvpTarget.z : (effectiveEnemy ? effectiveEnemy.z : player.z + dir.z * endDist)));

    if (!currentLocationAllowsNpcCombat() && (effectiveEnemy || coneTargets.length || (isRocket && explosionWouldAffectNpc(endX, endZ, w)))) {
      return rejectPeacefulNpcCombat();
    }

    const spend = spendAttackCost(w, modeInfo);
    if (!spend) return false;

    if (!w.ammoType) {
      triggerMeleeAttackVisual(playerGroup, weaponBaseId(w), { targetX: x, targetZ: z });
      emitMeleeFxPacket(w, { x, z });
    }

    if (w.ammoType) {
      const muzzle = getWeaponMuzzlePoint(w);
      spawnWeaponTracers(w, spend.shots, muzzle, endX, endZ, modeInfo, { blockedByStatic: shotBlockedByStatic, closeBlocked: closeBlockedShot, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist });
      if (isRocket) spawnExplosionFx(endX, endZ, explosiveRadiusForWeapon(w));
      if (!closeBlockedShot) emitShootFxPacket(w, modeInfo, muzzle, endX, endZ, { explosiveRadius: isRocket ? explosiveRadiusForWeapon(w) : 0, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist, fxSuppressed: closeBlockedShot });
    }
    if (isRocket) {
      const hit = applyExplosionDamage(endX, endZ, w, modeInfo, { selfDamage: true, spend });
      if (!hit) setReadout(`${w.name}: взрыв никого не задел.`);
      return hit;
    }
    if (isMultiTargetConeWeapon(w)) {
      if (!coneTargets.length && !pvpTarget) {
        submitUntargetedServerAttack(w, modeInfo, spend);
        setReadout(`${w.name} (${modeInfo.label}): зона поражения пуста.`);
        renderInventoryIfVisibleDeferred();
        return false;
      }
      if (!coneTargets.length && pvpTarget) {
        return applyPlayerWeaponDamage(pvpTarget, Math.max(0.1, pvpTarget.dist), w, modeInfo, { spend, conePerp: pvpTarget.perp, coneWidth: coneWeaponWidthAtDistance(w, pvpTarget.dist), shotDirX: dir.x, shotDirZ: dir.z });
      }
      return applyConeWeaponDamage(coneTargets, w, modeInfo, spend.shots, spend);
    }
    if (primaryPvpTarget) {
      let hit = false;
      for (let i = 0; i < spend.shots; i++) {
        hit = applyPlayerWeaponDamage(primaryPvpTarget, Math.max(0.1, primaryPvpTarget.dist), w, modeInfo, { spend, shotDirX: dir.x, shotDirZ: dir.z }) || hit;
      }
      return hit;
    }
    if (!effectiveEnemy) {
      submitUntargetedServerAttack(w, modeInfo, spend);
      if (w.ammoType) setReadout(`${w.name} (${modeInfo.label}): выстрел на ${Math.round(clearRange)} м. Цели нет.`);
      else setReadout('Удар пришёлся по воздуху.');
      renderInventoryIfVisibleDeferred();
      return false;
    }
    let hit = false;
    for (let i = 0; i < spend.shots && effectiveEnemy && !effectiveEnemy.dead; i++) {
      hit = applyWeaponDamage(effectiveEnemy, endDist, w, modeInfo, { spend }) || hit;
    }
    return hit;
  }

  function tryAttack(enemy, fromAuto = false) {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    if (!enemy || enemy.dead) return false;
    if (!currentLocationAllowsNpcCombat()) return rejectPeacefulNpcCombat();
    const w = currentWeapon();
    const modeInfo = ensureWeaponMode(w);
    const dist = distanceToEnemy(enemy);
    if (dist > w.range) {
      if (!fromAuto) setReadout(`Цель вне дальности: ${w.name} бьёт до ${w.range} м.`);
      return false;
    }
    const dx = enemy.x - player.x;
    const dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / len, z: dz / len };
    if (blockingDistanceOnRay(dir, dist) + 0.25 < dist) {
      if (!fromAuto) setReadout('Линия огня перекрыта препятствием.');
      return false;
    }
    facePoint(enemy.x, enemy.z);
    const coneTargets = isMultiTargetConeWeapon(w) ? findEnemiesInWeaponCone(dir, w.range, w) : [];
    const spend = spendAttackCost(w, modeInfo);
    if (!spend) return false;
    if (!w.ammoType) {
      triggerMeleeAttackVisual(playerGroup, weaponBaseId(w), { targetX: enemy.x, targetZ: enemy.z });
      emitMeleeFxPacket(w, enemy);
    }
    const isRocket = isExplosionWeapon(w);
    const visualEndDist = isRocket
      ? dist
      : (isMultiTargetConeWeapon(w)
        ? Math.min(w.range, coneTargets.length ? Math.max(...coneTargets.map(t => t.proj)) + 0.75 : dist)
        : dist);
    const visualEndX = (isRocket || !isMultiTargetConeWeapon(w)) ? enemy.x : player.x + dir.x * visualEndDist;
    const visualEndZ = (isRocket || !isMultiTargetConeWeapon(w)) ? enemy.z : player.z + dir.z * visualEndDist;
    if (w.ammoType) {
      const muzzle = getWeaponMuzzlePoint(w);
      spawnWeaponTracers(w, spend.shots, muzzle, visualEndX, visualEndZ, modeInfo, { blockedByStatic: false, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist: visualEndDist });
      if (isRocket) spawnExplosionFx(visualEndX, visualEndZ, explosiveRadiusForWeapon(w));
      emitShootFxPacket(w, modeInfo, muzzle, visualEndX, visualEndZ, { explosiveRadius: isRocket ? explosiveRadiusForWeapon(w) : 0, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist: visualEndDist });
    }
    if (isRocket) {
      return applyExplosionDamage(visualEndX, visualEndZ, w, modeInfo, { selfDamage: true, spend });
    }
    if (isMultiTargetConeWeapon(w)) {
      return applyConeWeaponDamage(coneTargets.length ? coneTargets : [{
        enemy,
        dist,
        proj: dist,
        perp: 0,
        coneWidth: coneWeaponWidthAtDistance(w, dist),
        dirX: dir.x,
        dirZ: dir.z
      }], w, modeInfo, spend.shots, spend);
    }
    let hit = false;
    for (let i = 0; i < spend.shots && enemy && !enemy.dead; i++) {
      hit = applyWeaponDamage(enemy, dist, w, modeInfo, { spend }) || hit;
    }
    return hit;
  }

  function reloadWeapon() {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    const w = currentWeapon();
    const preservedAutoTarget = isMobileControlsEnabled() ? player.attackTarget : null;
    if (!w.ammoType) {
      setReadout('Это оружие не требует перезарядки.');
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    if (w.loaded >= w.magSize) {
      setReadout('Магазин уже полный.');
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const available = inventory.get(w.ammoType) || 0;
    if (available <= 0) {
      addLog('Нет подходящих патронов.', null, 'combat');
      setReadout('Нет патронов для выбранного оружия.');
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const apCost = reloadApCost(w);
    if (player.ap < apCost) {
      setReadout(`Недостаточно очков действий для перезарядки. Нужно ${formatActionCost(apCost)} ОД.`);
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const need = w.magSize - w.loaded;
    const take = Math.min(need, available);
    const apBefore = Number(player.ap || 0);
    const loadedBefore = Number(w.loaded || 0);
    const reserveBefore = Number(available || 0);
    player.ap = Math.max(0, player.ap - apCost);
    removeItem(w.ammoType, take);
    w.loaded += take;
    const reloadCombat = {
      weapon: weaponBaseId(w),
      mode: getWeaponModeInfo(w)?.id || player.fireMode || 'single',
      apCost,
      take,
      apBefore,
      apAfter: Number(player.ap || 0),
      loadedBefore,
      loadedAfter: Number(w.loaded || 0),
      ammoType: w.ammoType,
      reserveBefore,
      reserveAmmo: Math.max(0, Number(inventory.get(w.ammoType) || 0))
    };
    player.reloadTimer = 0;
    triggerCharacterReloadVisual(playerGroup, weaponBaseId(w));
    addLog(`⟳ Перезарядка: +${take} патр. в ${w.name}. Потрачено ${formatActionCost(apCost)} ОД.`, null, 'system');
    setReadout(`Перезарядка: -${formatActionCost(apCost)} ОД.`);
    if (multiplayer.socket && multiplayer.socket.connected && multiplayer.joined) {
      emitGuardedMultiplayerGameplayAction('reloadWeapon', {
        weapon: weaponBaseId(w),
        equipment: multiplayerEquipmentSnapshot(),
        inventory: typeof multiplayerInventorySnapshot === 'function' ? multiplayerInventorySnapshot() : null,
        special: characterProfile?.special || DEFAULT_SPECIAL,
        skillRanks: multiplayerSkillSnapshot(),
        talentRanks: multiplayerTalentSnapshot(),
        traits: multiplayerTraitSnapshot(),
        injuries: multiplayerInjurySnapshot(),
        take,
        combat: reloadCombat
      }, ack => {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        if (ack?.combat) applyServerCombatState(ack.combat);
        if (ack && !ack.ok && ack.error) setReadout(ack.error);
      });
    }
    renderInventoryIfVisibleDeferred();
    renderQuickbar();
    renderWeaponReadout();
    renderUI();
    queueSave();
    restoreMobileAutoTargetAfterReload(preservedAutoTarget);
  }
