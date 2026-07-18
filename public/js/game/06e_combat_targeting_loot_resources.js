  function mobileAutoTargetId(target = player.attackTarget) {
    if (!target) return '';
    return target.id ? String(target.id) : '';
  }

  function findMobileAutoTargetById(targetId) {
    if (!targetId) return null;
    return enemies.find(e => e && e.id && String(e.id) === String(targetId)) || null;
  }

  function canRestoreMobileAutoTarget(target) {
    return !!(
      target &&
      !target.dead &&
      !target._removed &&
      enemies.includes(target) &&
      (!isMobileControlsEnabled() || isEnemyInPlayerFieldOfView(target))
    );
  }

  function restoreMobileAutoTarget(target, options = {}) {
    if (!isMobileControlsEnabled()) return false;
    if (!canRestoreMobileAutoTarget(target)) {
      if (!options.keepInvalid) updateSelectedEnemyVisuals();
      return false;
    }
    player.attackTarget = target;
    hoveredEnemy = target;
    pointerWorld.set(target.x, 0, target.z);
    pointerHasWorld = true;
    if (!virtualMove.active) facePoint(target.x, target.z);
    updateSelectedEnemyVisuals();
    if (!options.silent) showSelectedTargetHint(target);
    return true;
  }

  function restoreMobileAutoTargetById(targetId, options = {}) {
    if (!isMobileControlsEnabled() || !targetId) return false;
    return restoreMobileAutoTarget(findMobileAutoTargetById(targetId), options);
  }

  function restoreMobileAutoTargetAfterReload(target) {
    restoreMobileAutoTarget(target);
  }

  function restoreMobileAutoTargetAfterAttack(target, targetId = '') {
    if (!isMobileControlsEnabled()) return false;
    if (restoreMobileAutoTarget(target)) return true;
    return restoreMobileAutoTargetById(targetId);
  }

  function livingEnemiesSortedByDistance(maxDist = Infinity, options = {}) {
    const requirePlayerVision = !!options.requirePlayerVision;
    return enemies
      .filter(e => {
        if (!e || e.dead || e._removed || distanceToEnemy(e) > maxDist) return false;
        if (e.hostileToPlayer === false) return false;
        // Мобильный автоприцел не должен выбирать цель, которую игрок не видит:
        // за деревом, за укрытием при приседе, за пределами радиуса обзора или в тумане.
        // Вода прозрачна для обзора, поэтому она здесь не блокирует выбор цели.
        if (requirePlayerVision && !isEnemyInPlayerFieldOfView(e)) return false;
        return true;
      })
      .sort((a, b) => distanceToEnemy(a) - distanceToEnemy(b));
  }

  function findNearestLivingEnemy(maxDist = Infinity) {
    const list = livingEnemiesSortedByDistance(maxDist);
    return list[0] || null;
  }

  function isEnemyInPlayerFieldOfView(enemy) {
    if (!enemy || enemy.dead || enemy._removed) return false;
    if (!map || !player) return true;
    return isWorldPointVisibleByRtsFog(enemy.x, enemy.z, { crouching: !!enemy.crouching });
  }

  let selectedEnemyVisualKey = '';
  function updateSelectedEnemyVisuals(activeTarget) {
    const target = activeTarget === undefined ? getActiveAutoTarget() : activeTarget;
    const targetIndex = target ? enemies.indexOf(target) : -1;
    const targetMeshId = target?.mesh?.uuid || '';
    const visualKey = `${targetIndex}|${targetMeshId}|${enemies.length}`;
    if (visualKey === selectedEnemyVisualKey) return;
    selectedEnemyVisualKey = visualKey;
    enemies.forEach(e => {
      const ring = e?.mesh?.userData?.targetRing;
      if (ring) ring.visible = !!(target && e === target && !e.dead && !e._removed);
    });
    const btn = document.getElementById('touch-target');
    if (btn) btn.classList.toggle('active', !!target);
  }

  function getActiveAutoTarget() {
    const t = player.attackTarget;
    const valid = t && !t.dead && !t._removed && enemies.includes(t);
    const visibleForMobile = !isMobileControlsEnabled() || !valid || isEnemyInPlayerFieldOfView(t);
    if (valid && visibleForMobile) return t;
    if (hoveredEnemy === t) hoveredEnemy = null;
    player.attackTarget = null;
    return null;
  }

  function screenPointForEnemy(enemy) {
    if (!enemy) return null;
    const rect = canvas.getBoundingClientRect();
    fallbackScreenPoint.set(enemy.x, 1.35 * (enemy.scale || 1), enemy.z).project(camera);
    return {
      x: rect.left + (fallbackScreenPoint.x + 1) * rect.width * 0.5,
      y: rect.top + (1 - fallbackScreenPoint.y) * rect.height * 0.5
    };
  }

  function showSelectedTargetHint(enemy) {
    const p = screenPointForEnemy(enemy);
    if (p) showTargetHint(enemy, p.x, p.y);
    else showTargetHint(enemy, window.innerWidth * 0.58, window.innerHeight * 0.42);
  }

  function selectNearestEnemyForMobile() {
    if (!isMobileControlsEnabled()) {
      player.attackTarget = null;
      updateSelectedEnemyVisuals();
      setReadout('Автоприцеливание на ПК отключено: цельтесь мышью.');
      return false;
    }
    const maxDist = Math.max(currentWeapon()?.range || 0, 28);
    const nearbyCount = livingEnemiesSortedByDistance(maxDist).length;
    const list = livingEnemiesSortedByDistance(maxDist, { requirePlayerVision: true });
    if (!list.length) {
      player.attackTarget = null;
      hoveredEnemy = null;
      updateSelectedEnemyVisuals();
      hideTargetHint();
      setReadout(nearbyCount ? 'Враг рядом, но вне поля зрения.' : 'Рядом нет врага для выбора.');
      return false;
    }
    const current = getActiveAutoTarget();
    let next = list[0];
    if (current) {
      const idx = list.indexOf(current);
      next = list[(idx + 1) % list.length] || list[0];
    }
    player.attackTarget = next;
    hoveredEnemy = next;
    pointerWorld.set(next.x, 0, next.z);
    pointerHasWorld = true;
    facePoint(next.x, next.z);
    stopTouchAim();
    updateSelectedEnemyVisuals();
    showSelectedTargetHint(next);
    const info = getTargetHitInfo(next);
    setReadout(`Цель выбрана: ${next.name} · шанс попадания ${info.chance}%.`);
    return true;
  }

  function updateSelectedTargetTracking() {
    const target = getActiveAutoTarget();
    updateSelectedEnemyVisuals(target);
    if (!target) return;
    if (isMobileControlsEnabled()) {
      if (!isEnemyInPlayerFieldOfView(target)) {
        player.attackTarget = null;
        if (hoveredEnemy === target) hoveredEnemy = null;
        updateSelectedEnemyVisuals();
        hideTargetHint();
        return;
      }
      if (!virtualMove.active) facePoint(target.x, target.z);
      pointerWorld.set(target.x, 0, target.z);
      pointerHasWorld = true;
      showSelectedTargetHint(target);
    }
  }

  function attackNearest() {
    const nearest = findNearestLivingEnemy();
    if (nearest) tryAttack(nearest);
  }

  function corpseHasLoot(enemy) {
    return !!(enemy && enemy.loot && enemy.loot.some(x => x.qty > 0));
  }

  function ensureCorpseLoot(enemy) {
    if (!enemy || !enemy.dead) return;
    if (!Array.isArray(enemy.loot)) enemy.loot = [];
    if (typeof enemiesAreServerAuthoritative === 'function' && enemiesAreServerAuthoritative()) {
      return;
    }
    if (!corpseHasLoot(enemy)) {
      const inventoryLoot = typeof normalizeNpcInventoryRows === 'function'
        ? normalizeNpcInventoryRows(enemy.inventory || [])
        : (Array.isArray(enemy.inventory) ? enemy.inventory.map(row => ({ id: row.id, qty: row.qty })) : []);
      const physicalLoot = inventoryLoot.filter(row => row && row.id && row.qty > 0);
      if (physicalLoot.length) {
        enemy.loot = physicalLoot.map(row => ({ id: row.id, qty: row.qty }));
        enemy._looted = false;
        return;
      }
      const type = ENEMY_TYPES[enemy.typeIndex] || ENEMY_TYPES.find(t => t.name === enemy.name) || ENEMY_TYPES[0];
      enemy.loot = rollEnemyLoot(type);
      enemy._looted = false;
    }
  }

  function makeCorpse(enemy) {
    if (typeof lockEnemyCorpsePosition === 'function') {
      lockEnemyCorpsePosition(enemy, {}, { keepExisting: Number.isFinite(Number(enemy?.corpseX)) && Number.isFinite(Number(enemy?.corpseZ)) });
    }
    enemy.hp = 0;
    enemy.dead = true;
    if (enemy.mesh.userData.hpBar) enemy.mesh.userData.hpBar.visible = false;
    enemy.mesh.rotation.z = Math.PI / 2;
    enemy.mesh.rotation.y = enemy.mesh.rotation.y || 0;
    enemy.mesh.position.y = 0.05;
    ensureCorpseLoot(enemy);
    enemy.mesh.traverse(m => {
      if (m.isMesh) {
        m.castShadow = false;
        m.userData.enemy = enemy;
      }
    });
  }

  function removeCorpse(enemy) {
    if (!enemy || enemy._removed) return;
    enemy._removed = true;
    const idx = enemies.indexOf(enemy);
    if (idx >= 0) enemies.splice(idx, 1);
    const midx = enemyMeshes.indexOf(enemy.mesh);
    if (midx >= 0) enemyMeshes.splice(midx, 1);
    scene.remove(enemy.mesh);
    if (!enemiesAreServerAuthoritative()) {
      syncWorldStateToServer('removeCorpse');
      spawnEnemy();
    }
  }

  function killEnemy(enemy) {
    if (!enemy || enemy.dead) return;
    if (enemiesAreServerAuthoritative()) return;
    if (player.attackTarget === enemy) { player.attackTarget = null; hoveredEnemy = null; hideTargetHint(); }
    makeCorpse(enemy);
    player.xp += enemy.xp;
    createFloatingText(enemy.x, enemy.z, '+' + enemy.xp + ' XP', '#e4c56b');
    addLog(`☠ ${enemy.name} повержен. +${enemy.xp} XP. Можно обыскать тело.`, null, 'loot');
    if (isMobileControlsEnabled()) setReadout(`☠ ${enemy.name}: тело можно обыскать.`);
    checkLevelUp();
    ensureCorpseLoot(enemy);
    syncWorldStateToServer('killEnemy');
    if (!corpseHasLoot(enemy)) {
      addLog(`${enemy.name}: ничего ценного.`, null, 'loot');
      setTimeout(() => removeCorpse(enemy), 3500);
    }
  }

  function checkLevelUp() {
    while (player.xp >= player.xpNeeded) {
      player.xp -= player.xpNeeded;
      player.level++;
      player.xpNeeded = Math.floor(player.xpNeeded * 1.45);
      if (characterProfile && typeof applyCharacterProfile === 'function') applyCharacterProfile(characterProfile, false);
      else player.maxHp += 12;
      player.hp = player.maxHp;
      player.ap = player.maxAp;
      player.skillPoints += SKILL_POINTS_PER_LEVEL;
      let levelMessage = `⬆ Уровень ${player.level}. Получено ${SKILL_POINTS_PER_LEVEL} очков навыков.`;
      if (player.level % PERK_LEVEL_INTERVAL === 0) {
        player.perkPoints += 1;
        levelMessage += ' Получен 1 перк.';
      }
      addLog(levelMessage, null, 'level');
      renderTalentTree();
      queueSave(true);
    }
  }

  function clearPostResourceActionState() {
    player.attackTarget = null;
    player.targetPath = [];
    if (marker) marker.visible = false;
    if (typeof stopAutoFire === 'function') stopAutoFire();
    if (typeof stopTouchAim === 'function') stopTouchAim();
    if (typeof resetVirtualMove === 'function') resetVirtualMove();
    if (typeof hideWorldContextMenu === 'function') hideWorldContextMenu();
  }

  function setDepletedResourceTileWalkable(res) {
    if (!res || !map || !Array.isArray(map[res.tz])) return;
    // A depleted resource must not leave an invisible blocker behind.
    // Ore used to become ROCK here while its visual mesh was removed, so players
    // could get trapped beside an unseen collision tile after mining.
    map[res.tz][res.tx] = TILE_TYPES.GRASS;
    if (typeof invalidateMinimapStaticCache === 'function') invalidateMinimapStaticCache('resource-depleted');
  }

  function syncPlayerVisualAfterResourceAction() {
    if (playerGroup) {
      playerGroup.position.set(player.x, 0, player.z);
      playerGroup.rotation.y = player.angle + Math.PI;
      playerGroup.updateMatrixWorld(true);
    }
    if (typeof sendMultiplayerState === 'function') {
      try { sendMultiplayerState(0.05); } catch (_) {}
    }
  }

  function resourcesAreServerAuthoritative() {
    return !!(typeof multiplayer !== 'undefined' && multiplayer.socket && multiplayer.socket.connected && multiplayer.joined);
  }

  const HARVEST_AP_COST = 2;

  function harvestActionXp(qty = 1) {
    return 3 + Math.max(1, Math.floor(Number(qty || 1)));
  }

  const CLIENT_RESOURCE_DEFS = {
    ore: { itemId: 'ore', toolId: 'pickaxe', approach: 'Подойдите ближе к руде.', hold: 'Возьмите кирку в руки.', need: 'Для добычи руды нужна кирка.' },
    wood: { itemId: 'wood', toolId: 'axe', approach: 'Подойдите ближе к древесине.', hold: 'Возьмите топор в руки.', need: 'Для заготовки древесины нужен топор.' },
    scrap: { itemId: 'scrap', toolId: 'pickaxe', approach: 'Подойдите ближе к металлолому.', hold: 'Возьмите кирку в руки.', need: 'Для разборки металлолома нужна кирка.' },
    water: { itemId: 'water', toolId: 'handPump', approach: 'Подойдите ближе к насосу.', hold: 'Возьмите ручной насос в руки.', need: 'Для откачки воды нужен ручной насос.' },
    oil: { itemId: 'oil', toolId: 'handPump', approach: 'Подойдите ближе к нефтяной качалке.', hold: 'Возьмите ручной насос в руки.', need: 'Для добычи нефти нужен ручной насос.' },
    chemicals: { itemId: 'chemicals', toolId: 'handPump', approach: 'Подойдите ближе к химическому источнику.', hold: 'Возьмите ручной насос в руки.', need: 'Для сбора химикатов нужен ручной насос.' },
    medicine: { itemId: 'medicine', toolId: 'axe', approach: 'Подойдите ближе к лекарственным растениям.', hold: 'Возьмите топор в руки.', need: 'Для сбора лекарственных растений нужен топор.' },
    food: { itemId: 'food', toolId: 'axe', approach: 'Подойдите ближе к пищевым зарослям.', hold: 'Возьмите топор в руки.', need: 'Для заготовки пищи нужен топор.' },
    electronics: { itemId: 'electronics', toolId: 'pickaxe', approach: 'Подойдите ближе к электронике.', hold: 'Возьмите кирку в руки.', need: 'Для разбора электроники нужна кирка.' },
    ammoParts: { itemId: 'ammoParts', toolId: 'pickaxe', approach: 'Подойдите ближе к деталям патронов.', hold: 'Возьмите кирку в руки.', need: 'Для разбора деталей патронов нужна кирка.' },
    weaponParts: { itemId: 'weaponParts', toolId: 'pickaxe', approach: 'Подойдите ближе к оружейным деталям.', hold: 'Возьмите кирку в руки.', need: 'Для разбора оружейных деталей нужна кирка.' }
  };

  function clientResourceDef(type = '') {
    const key = String(type || '').toLowerCase();
    const canonical = key === 'ammoparts' ? 'ammoParts' : key === 'weaponparts' ? 'weaponParts' : key;
    return CLIENT_RESOURCE_DEFS[canonical] || CLIENT_RESOURCE_DEFS.ore;
  }

  function baseRuntimeItemId(id) {
    const raw = String(id || '');
    if (raw === 'pickaxe' || raw.startsWith('ui_pickaxe')) return 'pickaxe';
    if (raw === 'axe' || raw.startsWith('ui_axe')) return 'axe';
    if (raw === 'handPump' || raw.startsWith('ui_handPump')) return 'handPump';
    return raw;
  }

  function applyServerResourceSnapshot(res, ack) {
    const snapshot = ack?.resource;
    if (snapshot && typeof applyNetworkResources === 'function') {
      applyNetworkResources([snapshot], ack?.worldState?.map || null);
      return findResourceNode(snapshot) || res;
    }
    return res;
  }

  function interactResource(res) {
    if (!res || res.hp <= 0) return;
    clearPostResourceActionState();
    const resourceDef = clientResourceDef(res.type);
    const pos = tileToWorld(res.tx, res.tz);
    const dist = Math.hypot(pos.x - player.x, pos.z - player.z);
    if (dist > 2.5) {
      setReadout(resourceDef.approach);
      return;
    }

    const toolId = resourceDef.toolId;
    const heldToolId = equipment.weapon || '';
    const heldToolBaseId = baseRuntimeItemId(heldToolId);
    if (heldToolBaseId !== toolId) {
      setReadout(resourceDef.hold);
      return;
    }
    // Tools are unique items and can be stored as runtime ids like ui_pickaxe_...
    // after inventory normalization. Checking inventory.get('pickaxe') misses
    // those instances, so resource harvesting could incorrectly say that the
    // player has no pickaxe/axe even when it is visible in the inventory.
    const toolQty = inventory.get(heldToolId) || 0;
    const toolInstanceId = heldToolId;
    const tool = ITEMS[toolInstanceId] || ITEMS[toolId];
    if (toolQty <= 0 || !tool) {
      setReadout(resourceDef.need);
      return;
    }
    if (player.ap + 0.01 < HARVEST_AP_COST) {
      setReadout(`Недостаточно очков действий для сбора ресурса. Нужно ${HARVEST_AP_COST} ОД.`);
      return;
    }
    const itemId = resourceDef.itemId;
    if (!ITEMS[itemId]) {
      setReadout('Этот ресурс пока нельзя добыть.');
      return;
    }
    const maxCarryQty = canCarryItem(itemId, 2) ? 2 : (canCarryItem(itemId, 1) ? 1 : 0);
    if (maxCarryQty <= 0) {
      setReadout(`${ITEMS[itemId].name}: нет места. Сложите лишнее в хранилище.`);
      return;
    }

    const finishHarvest = (qty, serverAck = null) => {
      const takeQty = Math.max(1, Math.floor(Number(qty || 1)));
      if (serverAck?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(serverAck.self);
      else if (serverAck && Array.isArray(serverAck.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(serverAck.inventory);
      if (!serverAck) player.ap = Math.max(0, player.ap - HARVEST_AP_COST);
      tool.condition = Math.max(0, (tool.condition ?? 100) - 1.5);
      if (!serverAck && !addItem(itemId, takeQty)) {
        setReadout(`${ITEMS[itemId].name}: нет места. Сложите лишнее в хранилище.`);
        return false;
      }
      createFloatingText(pos.x, pos.z, `+${takeQty}`, '#e0be5c');
      addLog(`${tool.icon} ${ITEMS[itemId].icon} Получено: ${ITEMS[itemId].name} x${takeQty}. Потрачено ${serverAck?.apCost ?? HARVEST_AP_COST} ОД.`, null, 'loot');
      const xp = Number.isFinite(Number(serverAck?.xp)) ? Number(serverAck.xp) : harvestActionXp(takeQty);
      if (!serverAck && typeof awardCharacterActionXp === 'function') awardCharacterActionXp(xp, 'Добыча ресурса', pos.x, pos.z);
      if (serverAck) res = applyServerResourceSnapshot(res, serverAck) || res;
      renderInventoryIfVisibleDeferred();
      renderWeaponReadout();
      queueSave(true);
      return true;
    };

    if (resourcesAreServerAuthoritative()) {
      if (res._harvestPending) {
        setReadout('Добыча уже выполняется...');
        return;
      }
      res._harvestPending = true;
      syncPlayerVisualAfterResourceAction();
      multiplayer.socket.emit('harvestResource', {
        id: res.id || `res_${res.tx}_${res.tz}_${res.type || 'node'}`,
        ...multiplayerProgressionSnapshot(),
        tx: res.tx,
        tz: res.tz,
        type: res.type,
        toolId: toolInstanceId,
        baseToolId: baseRuntimeItemId(toolInstanceId),
        toolCondition: tool.condition ?? 100,
        maxCarryQty,
        ap: player.ap,
        apCost: HARVEST_AP_COST,
        x: player.x,
        z: player.z
      }, ack => {
        res._harvestPending = false;
        if (!ack || !ack.ok) {
          setReadout(ack?.error || 'Сервер не подтвердил добычу ресурса.');
          if (ack?.resource) applyServerResourceSnapshot(res, ack);
          clearPostResourceActionState();
          syncPlayerVisualAfterResourceAction();
          return;
        }
        const item = ack.item || { id: itemId, qty: 1 };
        if (item.id !== itemId) {
          setReadout('Сервер вернул неизвестный ресурс.');
          applyServerResourceSnapshot(res, ack);
          return;
        }
        finishHarvest(Math.min(Number(item.qty || 1), maxCarryQty), ack);
        recoverPlayerIfBlocked();
        clearPostResourceActionState();
        syncPlayerVisualAfterResourceAction();
      });
      return;
    }

    const gatherChance = 0.18 + Math.max(0, statValue('int') - 5) * 0.025 + (hasStartTrait('craftsmanStart') ? 0.18 : 0) + Math.max(0, statValue('luck') - 5) * 0.01 + skillNorm('wanderer') * 0.12 + skillNorm('repair') * 0.08 + talentLevel('engineer') * 0.025 + talentLevel('recycler') * 0.02;
    const qty = 1 + ((tool.condition ?? 100) > 40 && Math.random() < gatherChance ? 1 : 0);
    if (!finishHarvest(qty)) return;
    res.hp = Math.max(0, Number(res.hp || 0) - 1);
    saveCurrentLocationState();
    if (res.hp <= 0) {
      setDepletedResourceTileWalkable(res);
      if (res.mesh) {
        const idx = obstacleMeshes.indexOf(res.mesh);
        if (idx >= 0) obstacleMeshes.splice(idx, 1);
        try { worldGroup.remove(res.mesh); } catch (_) { res.mesh.visible = false; }
        res.mesh = null;
      }
      recoverPlayerIfBlocked();
      saveCurrentLocationState();
    } else {
      recoverPlayerIfBlocked();
    }
    clearPostResourceActionState();
    syncPlayerVisualAfterResourceAction();
    renderInventoryIfVisibleDeferred();
    renderWeaponReadout();
    queueSave();
  }
