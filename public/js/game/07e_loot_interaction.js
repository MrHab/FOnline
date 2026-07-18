  // ===== LOOT WINDOW =====
  let activeLootEnemy = null;
  let activeWorldContainer = null;
  const CLIENT_CORPSE_LOOT_HOLD_MS = 45000;
  const CLIENT_CORPSE_LOOT_HEARTBEAT_MS = 12000;
  let corpseLootHoldTimer = null;

  function hideLootWindowTooltip() {
    if (typeof hideTooltip === 'function') hideTooltip();
  }

  function touchLocalCorpseLootHold(corpse, now = Date.now()) {
    if (!corpse || !corpse.dead) return;
    corpse._lastLootInspectAt = now;
    corpse._corpseLootHoldUntil = Math.max(Number(corpse._corpseLootHoldUntil || 0), now + CLIENT_CORPSE_LOOT_HOLD_MS);
  }

  function isCorpseLootHoldActive(corpse, now = Date.now()) {
    return !!(corpse && corpse.dead && Number(corpse._corpseLootHoldUntil || 0) > now);
  }

  function removeLootedCorpseAfterWindow(corpse) {
    if (!corpse || !corpse.dead || !corpse._looted || isCorpseLootHoldActive(corpse)) return;
    if (typeof removeNetworkEnemy === 'function') removeNetworkEnemy(corpse);
    else if (typeof removeCorpse === 'function') removeCorpse(corpse);
  }

  function sendCorpseLootHold(corpse, reason = 'open') {
    if (!corpse || !corpse.dead || !corpse.id) return;
    touchLocalCorpseLootHold(corpse);
    if (!enemiesAreServerAuthoritative() || !multiplayer?.socket?.connected || !multiplayer.joined) return;
    multiplayer.socket.emit('inspectCorpse', { enemyId: corpse.id, reason }, ack => {
      if (!ack || !ack.ok) return;
      if (ack.enemy && typeof applyNetworkEnemies === 'function') {
        applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
      }
      if (activeLootEnemy && ack.enemy && activeLootEnemy.id === ack.enemy.id) {
        renderLootWindow();
      }
    });
  }

  function startCorpseLootHold(corpse) {
    stopCorpseLootHold(false);
    if (!corpse || !corpse.dead) return;
    sendCorpseLootHold(corpse, 'open');
    corpseLootHoldTimer = setInterval(() => {
      const lootWin = document.getElementById('loot-window');
      if (!activeLootEnemy || !lootWin || lootWin.style.display !== 'block') {
        stopCorpseLootHold(false);
        return;
      }
      sendCorpseLootHold(activeLootEnemy, 'heartbeat');
    }, CLIENT_CORPSE_LOOT_HEARTBEAT_MS);
  }

  function stopCorpseLootHold(release = true) {
    if (corpseLootHoldTimer) {
      clearInterval(corpseLootHoldTimer);
      corpseLootHoldTimer = null;
    }
    const corpse = activeLootEnemy;
    if (!corpse || !corpse.dead) return;
    corpse._corpseLootHoldUntil = 0;
    if (!release || !corpse.id || !enemiesAreServerAuthoritative() || !multiplayer?.socket?.connected || !multiplayer.joined) {
      removeLootedCorpseAfterWindow(corpse);
      return;
    }
    multiplayer.socket.emit('releaseCorpseLoot', { enemyId: corpse.id }, ack => {
      if (ack?.removed) removeLootedCorpseAfterWindow(corpse);
    });
  }

  function openLootWindow(enemy) {
    if (!enemy || !enemy.dead) return;
    const dist = Math.hypot(enemy.x - player.x, enemy.z - player.z);
    if (dist > 3.2) {
      setReadout('Подойдите ближе, чтобы обыскать тело.');
      return;
    }
    ensureCorpseLoot(enemy);
    if (activeLootEnemy && activeLootEnemy !== enemy) stopCorpseLootHold(true);
    activeWorldContainer = null;
    activeLootEnemy = enemy;
    startCorpseLootHold(enemy);
    document.body.classList.add('loot-window-open');
    document.getElementById('loot-window').style.display = 'block';
    renderLootWindow();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function closeLootWindow() {
    hideLootWindowTooltip();
    stopCorpseLootHold(true);
    document.getElementById('loot-window').style.display = 'none';
    document.body.classList.remove('loot-window-open');
    activeLootEnemy = null;
    activeWorldContainer = null;
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function renderLootWindow() {
    const grid = document.getElementById('loot-grid');
    const title = document.getElementById('loot-title');
    if ((!activeLootEnemy && !activeWorldContainer) || !grid || !title) return;
    const source = activeWorldContainer || activeLootEnemy;
    title.textContent = activeWorldContainer ? `Контейнер: ${source.name || 'Ящик'}` : `Обыск: ${source.name}`;
    hideLootWindowTooltip();
    grid.innerHTML = '';
    const loot = (source.loot || []).filter(x => x.qty > 0);
    const lootAllBtn = document.getElementById('loot-all');
    const canTakeAllLoot = canCarryFullLootList(loot);
    if (lootAllBtn) {
      lootAllBtn.disabled = loot.length === 0 || !canTakeAllLoot;
      lootAllBtn.classList.toggle('carry-blocked', loot.length > 0 && !canTakeAllLoot);
      if (loot.length > 0 && !canTakeAllLoot) lootAllBtn.dataset.gameHint = 'Не хватает переносимого веса, чтобы забрать всё.'; else delete lootAllBtn.dataset.gameHint;
      lootAllBtn.removeAttribute('title');
    }
    if (loot.length === 0) {
      grid.innerHTML = '<div class="loot-empty">Пусто.</div>';
      return;
    }
    loot.forEach(entry => {
      const item = ITEMS[entry.id];
      if (!item) return;
      const card = document.createElement('div');
      const carryMax = finiteMaxCarryableQty(entry.id, entry.qty);
      const carryLimited = carryMax < entry.qty;
      const carryBlocked = carryMax <= 0;
      card.className = 'loot-card' + (carryLimited ? ' carry-limited' : '') + (carryBlocked ? ' disabled carry-blocked' : '');
      card.dataset.gameHint = carryLimited ? carryLimitText(entry.id, entry.qty) : `Забрать: ${item.name}`;
      const count = entry.qty > 1 || ['ammo', 'money', 'material', 'loot'].includes(item.type) ? `<div class="inv-count">${entry.qty}</div>` : '';
      const limitNote = carryLimited && entry.qty > 1 ? `<div class="loot-weight-note">можно ${carryMax}/${entry.qty}</div>` : '';
      card.innerHTML = `<div class="inv-emoji">${itemArtHtml(item)}</div><div class="inv-name">${item.name}</div>${count}${limitNote}`;
      card.addEventListener('click', () => takeLootItem(entry.id));
      bindMobileItemLongPress(card, entry.id);
      card.addEventListener('mouseenter', e => showTooltip(e, carryLimited ? gameTooltipItem(item, carryLimitText(entry.id, entry.qty)) : item));
      card.addEventListener('mousemove', moveTooltip);
      card.addEventListener('mouseleave', hideTooltip);
      grid.appendChild(card);
    });
  }

  function takeLootItem(id, qty = null) {
    if (activeWorldContainer) return takeWorldContainerItem(id, qty);
    if (!activeLootEnemy || !activeLootEnemy.loot) return;
    const entry = activeLootEnemy.loot.find(x => x.id === id && x.qty > 0);
    if (!entry) return;
    const item = ITEMS[entry.id];
    if (!item) return;
    const available = Math.max(1, Math.floor(Number(entry.qty || 1)));
    const doTake = amount => {
      hideLootWindowTooltip();
      const takeQty = Math.max(1, Math.min(available, Math.floor(Number(amount || 1))));
      if (!canCarryItem(entry.id, takeQty)) {
        setReadout(`${item.name}: нет места. ${carryLimitText(entry.id, available)}`);
        renderLootWindow();
        return false;
      }
      if (enemiesAreServerAuthoritative()) {
        const corpse = activeLootEnemy;
        multiplayer.socket.emit('lootEnemy', { enemyId: corpse.id, itemId: entry.id, qty: takeQty, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
          if (!ack || !ack.ok) { setReadout(ack?.error || 'Не удалось забрать добычу.'); return; }
          if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
          else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
          (ack.items || []).forEach(taken => {
            const it = ITEMS[taken.id];
            if (it) addLog(`Получено: ${it.name} x${taken.qty}.`, null, 'loot');
          });
          if (ack.enemy) applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
        if (typeof refreshNetworkFogVisibilityNow === 'function') refreshNetworkFogVisibilityNow();
          const corpseDepleted = !!(ack.enemy && ack.enemy.looted);
          if (ack.removed || corpseDepleted) {
            setReadout(`${corpse.name}: обыск завершён.`);
            closeLootWindow();
          } else {
            renderLootWindow();
          }
          queueSave(true);
        });
        return true;
      }
      if (!addItem(entry.id, takeQty)) return false;
      addLog(`Получено: ${item.name} x${takeQty}.`, null, 'loot');
      entry.qty = Math.max(0, entry.qty - takeQty);
      if (!corpseHasLoot(activeLootEnemy)) activeLootEnemy._looted = true;
      syncWorldStateToServer('lootItem');
      renderLootWindow();
      if (!corpseHasLoot(activeLootEnemy)) {
        const corpse = activeLootEnemy;
        setReadout(`${corpse.name}: обыск завершён.`);
        closeLootWindow();
        setTimeout(() => removeCorpse(corpse), 350);
      }
      return true;
    };
    if (qty && qty > 0) return doTake(qty);
    return prepareTakeQuantity(entry.id, available, 'Забрать', doTake);
  }

  function takeAllLoot() {
    hideLootWindowTooltip();
    if (activeWorldContainer) return takeAllWorldContainerLoot();
    if (!activeLootEnemy || !activeLootEnemy.loot) return;
    const corpse = activeLootEnemy;
    if (enemiesAreServerAuthoritative()) {
      const loot = (corpse.loot || []).filter(entry => entry.qty > 0 && ITEMS[entry.id]);
      if (!loot.length) return;
      if (!canCarryFullLootList(loot)) {
        setReadout('Не хватает переносимого веса, чтобы забрать всё. Выберите предмет или количество вручную.');
        renderLootWindow();
        return;
      }
      const requested = loot.map(entry => ({ id: entry.id, qty: entry.qty }));
      multiplayer.socket.emit('lootEnemy', { enemyId: corpse.id, mode: 'all', requested, carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null }, ack => {
        if (!ack || !ack.ok) { setReadout(ack?.error || 'Не удалось забрать добычу.'); return; }
        if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
        let taken = 0;
        (ack.items || []).forEach(itemTake => {
          const it = ITEMS[itemTake.id];
          if (it) {
            taken++;
            addLog(`Получено: ${it.name} x${itemTake.qty}.`, null, 'loot');
          }
        });
        if (taken <= 0) setReadout('Нет свободного веса для добычи.');
        if (ack.enemy) applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
        if (typeof refreshNetworkFogVisibilityNow === 'function') refreshNetworkFogVisibilityNow();
        const corpseDepleted = !!(ack.enemy && ack.enemy.looted);
        if (ack.removed || corpseDepleted) {
          addLog(`Обыск завершён: ${corpse.name}.`, null, 'loot');
          setReadout(`${corpse.name}: всё забрано.`);
          closeLootWindow();
        } else {
          setReadout('Часть добычи осталась: не хватает переносимого веса.');
          renderLootWindow();
        }
        queueSave(true);
      });
      return;
    }
    const loot = (corpse.loot || []).filter(entry => entry.qty > 0 && ITEMS[entry.id]);
    if (!loot.length) return;
    if (!canCarryFullLootList(loot)) {
      setReadout('Не хватает переносимого веса, чтобы забрать всё. Выберите предмет или количество вручную.');
      renderLootWindow();
      return;
    }
    let taken = 0;
    loot.forEach(entry => {
      if (addItem(entry.id, entry.qty)) {
        entry.qty = 0;
        taken++;
      }
    });
    if (corpseHasLoot(corpse)) {
      addLog(`Обыск: часть добычи забрана, часть осталась из-за веса.`, null, 'loot');
      setReadout('Часть добычи осталась: не хватает переносимого веса.');
      renderLootWindow();
      return;
    }
    corpse._looted = true;
    addLog(`Обыск завершён: ${corpse.name}.`, null, 'loot');
    setReadout(`${corpse.name}: всё забрано.`);
    syncWorldStateToServer('lootAll');
    closeLootWindow();
    setTimeout(() => removeCorpse(corpse), 350);
  }

  function findNearestCorpse(maxDist = 3.2) {
    let best = null;
    let bestDist = maxDist;
    enemies.forEach(e => {
      if (!e.dead || e._removed) return;
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d <= bestDist) { bestDist = d; best = e; }
    });
    return best;
  }

  function openNearbyCorpse() {
    const corpse = findNearestCorpse();
    if (corpse) {
      openLootWindow(corpse);
      return true;
    }
    setReadout('Рядом нет тела для обыска.');
    return false;
  }

  function findNearestResource(maxDist = 2.5) {
    let best = null;
    let bestDist = maxDist;
    resourceNodes.forEach(res => {
      if (!res || res.hp <= 0) return;
      const pos = tileToWorld(res.tx, res.tz);
      const d = Math.hypot(pos.x - player.x, pos.z - player.z);
      if (d <= bestDist) { bestDist = d; best = res; }
    });
    return best;
  }

  function interactNearby() {
    if (findNearbyTrader()) {
      talkToTraderQuest();
      return;
    }
    if (findNearbyStorage()) {
      openStorageWindow();
      return;
    }
    if (useLocationExit()) return;
    if (pickupNearestGroundItem()) return;
    if (openNearestWorldContainer()) return;
    const corpse = findNearestCorpse();
    if (corpse) {
      openLootWindow(corpse);
      return;
    }
    const res = findNearestResource();
    if (res) {
      interactResource(res);
      return;
    }
    setReadout('Рядом нет цели для взаимодействия.');
  }


