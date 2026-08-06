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

  function buildPlayerAttackPlan(w, modeInfo = getWeaponModeInfo(w)) {
    const pair = typeof dualWieldPistolPair === 'function' ? dualWieldPistolPair() : null;
    const requestedMode = modeInfo?.id || player.fireMode || 'single';
    if (requestedMode === 'dual' && pair) {
      const loaded = pair.entries.filter(entry => Number(entry.weapon.loaded || 0) > 0);
      if (!loaded.length) return { ok: false, error: 'Оба магазина пусты. Нажмите R для перезарядки.' };
      if (loaded.length === 1) {
        const entry = loaded[0];
        const singleMode = getWeaponModes(entry.weapon).find(mode => mode.id === 'single') || getWeaponModes(entry.weapon)[0];
        return {
          ok: true,
          requestedMode,
          resolvedMode: 'single',
          fallback: true,
          modeInfo: singleMode,
          apCost: Math.max(0, Number(singleMode.apCost || entry.weapon.apCost || 2) + injuryApPenalty('attack')),
          bullets: [{ ...entry, modeInfo: singleMode }]
        };
      }
      return {
        ok: true,
        requestedMode,
        resolvedMode: 'dual',
        fallback: false,
        modeInfo,
        apCost: Math.max(0, Number(modeInfo.apCost || 5) + injuryApPenalty('attack')),
        bullets: pair.entries.map(entry => ({ ...entry, modeInfo: { ...modeInfo, shots: 1 } }))
      };
    }

    let slot = typeof activeWeaponEquipmentSlot === 'function' ? activeWeaponEquipmentSlot() : 'weapon';
    if (requestedMode === 'single' && pair) {
      const preferred = player.dualPistolNextHandSlot === 'offhand' ? 'offhand' : 'weapon';
      const alternate = preferred === 'weapon' ? 'offhand' : 'weapon';
      const selected = pair.entries.find(entry => entry.slot === preferred && Number(entry.weapon.loaded || 0) > 0)
        || pair.entries.find(entry => entry.slot === alternate && Number(entry.weapon.loaded || 0) > 0)
        || pair.entries.find(entry => entry.slot === preferred)
        || pair.entries[0];
      slot = selected.slot;
      w = selected.weapon;
    }
    const runtimeId = String(equipment?.[slot] || w?.id || '');
    return {
      ok: true,
      requestedMode,
      resolvedMode: requestedMode,
      fallback: false,
      modeInfo,
      apCost: Math.max(0, Number(modeInfo.apCost || w.apCost || 2) + injuryApPenalty('attack')),
      bullets: [{ slot, weapon: w, runtimeId, modeInfo }]
    };
  }

  function spendAttackCost(w, modeInfo = getWeaponModeInfo(w)) {
    if (player.fireCooldown > 0 || player.reloadTimer > 0) return false;
    const plan = buildPlayerAttackPlan(w, modeInfo);
    if (!plan.ok) {
      setReadout(plan.error || 'Атака недоступна.');
      return false;
    }
    const apCost = plan.apCost;
    const apBefore = Number(player.ap || 0);
    if (player.ap < apCost) {
      setReadout(`Недостаточно очков действий. Нужно ${formatActionCost(apCost)} ОД.`);
      return false;
    }
    if (plan.bullets.some(bullet => bullet.weapon.ammoType && Number(bullet.weapon.loaded || 0) <= 0)) {
      addLog('Щёлк! Магазин пуст. Нажмите R для перезарядки.', null, 'combat');
      setReadout('Оружие разряжено. R — перезарядить.');
      return false;
    }
    const failedBullet = plan.bullets.find(bullet => rollEnergyFailure(bullet.weapon, bullet.modeInfo));
    if (failedBullet) {
      const failedWeapon = failedBullet.weapon;
      const risk = Math.round(energyFailureChance(failedWeapon, failedBullet.modeInfo) * 100);
      player.fireCooldown = Math.max(player.fireCooldown, 1.0 + risk / 100);
      if (typeof failedWeapon.condition === 'number') failedWeapon.condition = Math.max(1, failedWeapon.condition - Math.max(0.35, 1 - talentLevel('weaponSmith') * 0.18));
      addLog(`${failedWeapon.icon} ${failedWeapon.name}: перегрев/сбой (${risk}%). Выстрел заблокирован.`, null, 'combat');
      setReadout(`${failedWeapon.name}: перегрев/сбой. Навык Энергетическое снижает этот риск.`);
      renderWeaponReadout();
      updateTargetHintFromHover();
      queueSave();
      return false;
    }
    player.ap = Math.max(0, player.ap - apCost);
    player.fireCooldown = Math.max(...plan.bullets.map(bullet => (bullet.weapon.fireRate || 0.5) * (bullet.modeInfo.fireRateMul || 1)));
    const wear = Math.max(0.25, 0.55 - talentLevel('weaponSmith') * 0.12);
    const bullets = plan.bullets.map(bullet => {
      const weapon = bullet.weapon;
      const loadedBefore = weapon.ammoType ? Number(weapon.loaded || 0) : 0;
      const conditionBefore = Number.isFinite(Number(weapon.condition)) ? Number(weapon.condition) : null;
      if (weapon.ammoType) weapon.loaded = Math.max(0, loadedBefore - 1);
      if (weapon.ammoType && typeof weapon.condition === 'number') weapon.condition = Math.max(1, weapon.condition - wear);
      return {
        ...bullet,
        loadedBefore,
        loadedAfter: weapon.ammoType ? Number(weapon.loaded || 0) : 0,
        conditionBefore,
        conditionAfter: Number.isFinite(Number(weapon.condition)) ? Number(weapon.condition) : conditionBefore
      };
    });
    if (plan.requestedMode === 'single' && dualWieldPistolPair()) {
      player.dualPistolNextHandSlot = bullets[0].slot === 'weapon' ? 'offhand' : 'weapon';
    }
    const primary = bullets[0];
    const spend = {
      token: makeAttackToken(),
      shots: bullets.length,
      apCost,
      apBefore,
      apAfter: Number(player.ap || 0),
      loadedBefore: primary.loadedBefore,
      loadedAfter: primary.loadedAfter,
      conditionBefore: primary.conditionBefore,
      conditionAfter: primary.conditionAfter,
      bullets,
      requestedMode: plan.requestedMode,
      resolvedMode: plan.resolvedMode,
      fallback: plan.fallback,
      modeInfo: plan.modeInfo
    };
    renderQuickbar();
    renderWeaponReadout();
    updateTargetHintFromHover();
    return spend;
  }

  function primaryAttackBullet(spend, fallbackWeapon = currentWeapon(), fallbackMode = getWeaponModeInfo(fallbackWeapon)) {
    return Array.isArray(spend?.bullets) && spend.bullets.length
      ? spend.bullets[0]
      : {
          slot: typeof activeWeaponEquipmentSlot === 'function' ? activeWeaponEquipmentSlot() : 'weapon',
          weapon: fallbackWeapon,
          runtimeId: String(equipment?.[typeof activeWeaponEquipmentSlot === 'function' ? activeWeaponEquipmentSlot() : 'weapon'] || fallbackWeapon?.id || ''),
          modeInfo: fallbackMode
        };
  }

  function attackNetworkFields(w, modeInfo, spend) {
    const primary = primaryAttackBullet(spend, w, modeInfo);
    return {
      weapon: weaponBaseId(primary.weapon || w),
      weaponRuntimeId: String(primary.runtimeId || equipment?.[primary.slot] || primary.weapon?.id || ''),
      handSlot: primary.slot === 'offhand' ? 'offhand' : 'weapon',
      mode: spend?.requestedMode || modeInfo?.id || player.fireMode || 'single',
      attackToken: spend?.token || '',
      combat: combatResourceSnapshot(primary.weapon || w, modeInfo, spend || {})
    };
  }

  function submitUntargetedServerAttack(w, modeInfo, spend) {
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined || !spend) return false;
    return emitGuardedMultiplayerGameplayAction('combatAttack', {
      ...multiplayerProgressionSnapshot(),
      equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
      ...attackNetworkFields(w, modeInfo, spend)
    }, ack => {
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      applyServerCombatPayload(ack);
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
        ...attackNetworkFields(w, modeInfo, options.spend),
        multiTarget: !!options.multiTarget,
        conePerp: Number.isFinite(Number(options.conePerp)) ? Number(options.conePerp) : 0,
        coneWidth: Number.isFinite(Number(options.coneWidth)) ? Number(options.coneWidth) : coneWeaponWidthAtDistance(w, dist),
        shotDirX: Number.isFinite(Number(options.shotDirX)) ? Number(options.shotDirX) : null,
        shotDirZ: Number.isFinite(Number(options.shotDirZ)) ? Number(options.shotDirZ) : null,
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
            const critical = ack.critical === true;
            const criticalHits = Math.max(1, Math.round(Number(ack.criticalHits || 1)));
            enemy.flash = 0.14;
            const damageText = critical ? `КРИТ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! -${damage}` : '-' + damage;
            if (damage > 0) createFloatingText(enemy.x, enemy.z, damageText, critical ? '#ffd166' : '#ff765d');
            const absorbedText = absorbed > 0 ? `, броня поглотила ${absorbed}` : '';
            const criticalText = critical ? `КРИТИЧЕСКИЙ ВЫСТРЕЛ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! ` : '';
            addLog(`${w.icon} ${criticalText}${w.name} (${modeInfo.label}, ${damageTypeLabel(type)}): ${enemy.name} получает ${damage} урона${absorbedText}.`, null, 'combat');
          }
          applyNetworkEnemies([serverEnemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
          applyServerCombatPayload(ack);
          if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
          restoreMobileAutoTargetById(preservedTargetId);
        } else if (ack && ack.error) {
          if (ack.enemy) applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
          applyServerCombatPayload(ack);
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
    const criticalShot = rollCriticalShot(raw, w);
    const dmgInfo = mitigateEnemyDamage(criticalShot.rawDamage, enemy, w.damageType || 'ballistic');
    const dmg = dmgInfo.damage;
    enemy.flash = 0.14;
    createFloatingText(enemy.x, enemy.z, criticalShot.critical ? `КРИТ! -${dmg}` : '-' + dmg, criticalShot.critical ? '#ffd166' : '#ff765d');
    const absorbedText = dmgInfo.absorbed > 0 ? `, броня поглотила ${dmgInfo.absorbed}` : '';
    const criticalText = criticalShot.critical ? 'КРИТИЧЕСКИЙ ВЫСТРЕЛ! ' : '';
    addLog(`${w.icon} ${criticalText}${w.name} (${modeInfo.label}, ${damageTypeLabel(dmgInfo.type)}): ${enemy.name} получает ${dmg} урона${absorbedText}.`, null, 'combat');

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
    const handSlot = options.handSlot === 'offhand' ? 'offhand' : 'weapon';
    const handWeaponGroup = typeof actorWeaponGroupForSlot === 'function' ? actorWeaponGroupForSlot(playerGroup, handSlot) : null;
    triggerWeaponVisualRecoil(handWeaponGroup || activeActorWeaponGroup(playerGroup) || playerParts.weaponGroup, weaponId);

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
      handSlot: options.handSlot === 'offhand' ? 'offhand' : 'weapon',
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

  function renderRangedAttackVisuals(spend, fallbackWeapon, fallbackMode, endX, endZ, options = {}) {
    const bullets = Array.isArray(spend?.bullets) && spend.bullets.length
      ? spend.bullets
      : [primaryAttackBullet(spend, fallbackWeapon, fallbackMode)];
    bullets.forEach((bullet, index) => {
      const draw = () => {
        const weapon = bullet.weapon || fallbackWeapon;
        const bulletMode = bullet.modeInfo || fallbackMode;
        const handSlot = bullet.slot === 'offhand' ? 'offhand' : 'weapon';
        const muzzle = getWeaponMuzzlePoint(weapon, handSlot);
        const fxOptions = { ...options, handSlot };
        spawnWeaponTracers(weapon, 1, muzzle, endX, endZ, bulletMode, fxOptions);
        if (!options.closeBlocked) emitShootFxPacket(weapon, bulletMode, muzzle, endX, endZ, fxOptions);
      };
      if (index > 0) setTimeout(draw, 90 * index);
      else draw();
    });
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
      ...attackNetworkFields(w, modeInfo, options.spend),
      conePerp: Number.isFinite(Number(options.conePerp)) ? Number(options.conePerp) : target.perp || 0,
      coneWidth: Number.isFinite(Number(options.coneWidth)) ? Number(options.coneWidth) : coneWeaponWidthAtDistance(w, dist),
      shotDirX: Number.isFinite(Number(options.shotDirX)) ? Number(options.shotDirX) : null,
      shotDirZ: Number.isFinite(Number(options.shotDirZ)) ? Number(options.shotDirZ) : null,
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
          const critical = ack.critical === true;
          const criticalHits = Math.max(1, Math.round(Number(ack.criticalHits || 1)));
          const damageText = critical ? `КРИТ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! -${damage}` : '-' + damage;
          if (damage > 0) createFloatingText(target.x, target.z, damageText, critical ? '#ffd166' : '#ff765d');
          const absorbedText = absorbed > 0 ? `, броня поглотила ${absorbed}` : '';
          const criticalText = critical ? `КРИТИЧЕСКИЙ ВЫСТРЕЛ${criticalHits > 1 ? ` ×${criticalHits}` : ''}! ` : '';
          addLog(`${w.icon} ${criticalText}${w.name} (${modeInfo.label}, ${damageTypeLabel(type)}): ${target.name} получает ${damage} урона${absorbedText}.`, null, 'combat');
        }
        if (ack.target && target.row) {
          target.row.data = { ...target.row.data, ...ack.target };
          if (Number(ack.target.hp || 0) <= 0 || ack.killed) {
            if (typeof removeRemotePlayerFromNetworkEvent === 'function') removeRemotePlayerFromNetworkEvent({ id: target.id, characterId: ack.target.characterId });
          }
        }
        applyServerCombatPayload(ack);
      } else if (ack && ack.error) {
        applyServerCombatPayload(ack);
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
    const previewPlan = buildPlayerAttackPlan(w, modeInfo);
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

    const maxRange = Math.max(0.4, previewPlan.ok && previewPlan.resolvedMode !== 'dual'
      ? effectiveWeaponRange(previewPlan.bullets[0].weapon, previewPlan.modeInfo)
      : effectiveWeaponRange(w, modeInfo));
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
      renderRangedAttackVisuals(spend, w, modeInfo, endX, endZ, { blockedByStatic: shotBlockedByStatic, closeBlocked: closeBlockedShot, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist, fxSuppressed: closeBlockedShot });
      if (isRocket) spawnExplosionFx(endX, endZ, explosiveRadiusForWeapon(w));
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
      return applyPlayerWeaponDamage(primaryPvpTarget, Math.max(0.1, primaryPvpTarget.dist), w, modeInfo, { spend, shotDirX: dir.x, shotDirZ: dir.z });
    }
    if (!effectiveEnemy) {
      submitUntargetedServerAttack(w, modeInfo, spend);
      if (w.ammoType) setReadout(`${w.name} (${modeInfo.label}): выстрел на ${Math.round(clearRange)} м. Цели нет.`);
      else setReadout('Удар пришёлся по воздуху.');
      renderInventoryIfVisibleDeferred();
      return false;
    }
    if (enemiesAreServerAuthoritative()) return applyWeaponDamage(effectiveEnemy, endDist, w, modeInfo, { spend });
    let hit = false;
    for (const bullet of spend.bullets || []) {
      if (!effectiveEnemy || effectiveEnemy.dead) break;
      hit = applyWeaponDamage(effectiveEnemy, endDist, bullet.weapon, bullet.modeInfo, { spend }) || hit;
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
    const previewPlan = buildPlayerAttackPlan(w, modeInfo);
    const attackRange = Math.max(0.4, previewPlan.ok && previewPlan.resolvedMode !== 'dual'
      ? effectiveWeaponRange(previewPlan.bullets[0].weapon, previewPlan.modeInfo)
      : effectiveWeaponRange(w, modeInfo));
    if (dist > attackRange) {
      if (!fromAuto) setReadout(`Цель вне дальности: ${w.name} бьёт до ${Math.round(attackRange)} м.`);
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
    const coneTargets = isMultiTargetConeWeapon(w) ? findEnemiesInWeaponCone(dir, attackRange, w) : [];
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
        ? Math.min(attackRange, coneTargets.length ? Math.max(...coneTargets.map(t => t.proj)) + 0.75 : dist)
        : dist);
    const visualEndX = (isRocket || !isMultiTargetConeWeapon(w)) ? enemy.x : player.x + dir.x * visualEndDist;
    const visualEndZ = (isRocket || !isMultiTargetConeWeapon(w)) ? enemy.z : player.z + dir.z * visualEndDist;
    if (w.ammoType) {
      renderRangedAttackVisuals(spend, w, modeInfo, visualEndX, visualEndZ, { blockedByStatic: false, originX: player.x, originZ: player.z, dirX: dir.x, dirZ: dir.z, endDist: visualEndDist, explosiveRadius: isRocket ? explosiveRadiusForWeapon(w) : 0 });
      if (isRocket) spawnExplosionFx(visualEndX, visualEndZ, explosiveRadiusForWeapon(w));
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
    if (enemiesAreServerAuthoritative()) return applyWeaponDamage(enemy, dist, w, modeInfo, { spend });
    let hit = false;
    for (const bullet of spend.bullets || []) {
      if (!enemy || enemy.dead) break;
      hit = applyWeaponDamage(enemy, dist, bullet.weapon, bullet.modeInfo, { spend }) || hit;
    }
    return hit;
  }

  function reloadWeapon() {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    const w = currentWeapon();
    const preservedAutoTarget = isMobileControlsEnabled() ? player.attackTarget : null;
    const pair = typeof dualWieldPistolPair === 'function' ? dualWieldPistolPair() : null;
    const activeSlot = typeof activeWeaponEquipmentSlot === 'function' ? activeWeaponEquipmentSlot() : 'weapon';
    const entries = pair?.entries || [{ slot: activeSlot, weapon: w, runtimeId: String(equipment?.[activeSlot] || w.id) }];
    if (!entries.some(entry => entry.weapon.ammoType)) {
      setReadout('Это оружие не требует перезарядки.');
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const plans = entries.map(entry => ({
      ...entry,
      loadedBefore: Number(entry.weapon.loaded || 0),
      need: Math.max(0, Number(entry.weapon.magSize || 0) - Number(entry.weapon.loaded || 0)),
      take: 0
    }));
    const ammoTypes = [...new Set(plans.map(plan => plan.weapon.ammoType).filter(Boolean))];
    for (const ammoType of ammoTypes) {
      let available = Math.max(0, Number(inventory.get(ammoType) || 0));
      const candidates = plans.filter(plan => plan.weapon.ammoType === ammoType && plan.need > 0);
      while (available > 0 && candidates.some(plan => plan.take < plan.need)) {
        candidates.sort((a, b) => {
          const aFill = (a.loadedBefore + a.take) / Math.max(1, Number(a.weapon.magSize || 1));
          const bFill = (b.loadedBefore + b.take) / Math.max(1, Number(b.weapon.magSize || 1));
          if (aFill !== bFill) return aFill - bFill;
          return a.slot === 'weapon' ? -1 : 1;
        });
        const next = candidates.find(plan => plan.take < plan.need);
        if (!next) break;
        next.take += 1;
        available -= 1;
      }
    }
    const fundedPlans = plans.filter(plan => plan.take > 0);
    if (!fundedPlans.length) {
      addLog('Нет подходящих патронов.', null, 'combat');
      setReadout(plans.every(plan => plan.need <= 0) ? 'Оба магазина уже полные.' : 'Нет патронов для выбранного оружия.');
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const apCost = fundedPlans.reduce((sum, plan) => sum + reloadApCost(plan.weapon), 0);
    if (player.ap < apCost) {
      setReadout(`Недостаточно очков действий для перезарядки. Нужно ${formatActionCost(apCost)} ОД.`);
      restoreMobileAutoTargetAfterReload(preservedAutoTarget);
      return;
    }
    const apBefore = Number(player.ap || 0);
    player.ap = Math.max(0, player.ap - apCost);
    for (const ammoType of ammoTypes) {
      const total = fundedPlans.filter(plan => plan.weapon.ammoType === ammoType).reduce((sum, plan) => sum + plan.take, 0);
      if (total > 0) removeItem(ammoType, total);
    }
    fundedPlans.forEach(plan => { plan.weapon.loaded = Math.min(Number(plan.weapon.magSize || 0), plan.loadedBefore + plan.take); });
    const primary = fundedPlans[0];
    const take = fundedPlans.reduce((sum, plan) => sum + plan.take, 0);
    const reloadCombat = {
      weapon: weaponBaseId(primary.weapon),
      weaponRuntimeId: String(primary.runtimeId || equipment?.[primary.slot] || primary.weapon.id),
      handSlot: primary.slot,
      mode: getWeaponModeInfo(w)?.id || player.fireMode || 'single',
      apCost,
      take,
      apBefore,
      apAfter: Number(player.ap || 0),
      loadedBefore: primary.loadedBefore,
      loadedAfter: Number(primary.weapon.loaded || 0),
      ammoType: primary.weapon.ammoType,
      reserveAmmo: Math.max(0, Number(inventory.get(primary.weapon.ammoType) || 0)),
      hands: fundedPlans.map(plan => ({
        handSlot: plan.slot,
        weapon: weaponBaseId(plan.weapon),
        weaponRuntimeId: String(plan.runtimeId || equipment?.[plan.slot] || plan.weapon.id),
        take: plan.take,
        loadedBefore: plan.loadedBefore,
        loadedAfter: Number(plan.weapon.loaded || 0)
      }))
    };
    player.reloadTimer = 0;
    triggerCharacterReloadVisual(playerGroup, weaponBaseId(w));
    addLog(`⟳ Перезарядка: +${take} патр. в ${pair ? 'два пистолета' : w.name}. Потрачено ${formatActionCost(apCost)} ОД.`, null, 'system');
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
        dualReload: !!pair,
        takes: reloadCombat.hands,
        combat: reloadCombat
      }, ack => {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        applyServerCombatPayload(ack);
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
