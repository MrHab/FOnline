  function openWorldContextMenuFromEvent(e) {
    if (!gameStarted || paused || hudEditMode || isProgressionWindowOpen()) return false;
    if (anyWindowOpen()) return false;
    stopAutoFire();
    hideTargetHint();
    const target = buildWorldContextTarget(e.clientX, e.clientY);
    if (!target) { hideWorldContextMenu(); return false; }
    return showWorldContextMenu(e.clientX, e.clientY, target.title, buildWorldContextOptions(target), target);
  }

  canvas.addEventListener('pointermove', e => {
    if (!gameStarted || paused) return;
    if (isProgressionWindowOpen() || anyWindowOpen()) {
      hideTargetHint();
      if (typeof hideWorldContainerTooltip === 'function') hideWorldContainerTooltip();
      return;
    }
    if (isMobileControlsEnabled() && e.pointerType === 'touch') {
      // На телефоне касание игрового поля не вращает персонажа за курсором.
      // Направление задаётся стиком, а стрельба — кнопкой атаки/автоприцелом.
      return;
    }
    updatePointerWorld(e.clientX, e.clientY);
    const enemy = findEnemyFromEvent(e.clientX, e.clientY);
    hoveredEnemy = enemy;
    if (enemy) {
      if (typeof hideWorldContainerTooltip === 'function') hideWorldContainerTooltip();
      showTargetHint(enemy, e.clientX, e.clientY);
      return;
    }
    hideTargetHint();
    const worldContainer = findWorldContainerFromEvent(e.clientX, e.clientY);
    if (worldContainer && typeof showWorldContainerTooltip === 'function') showWorldContainerTooltip(e, worldContainer);
    else if (typeof hideWorldContainerTooltip === 'function') hideWorldContainerTooltip();
  });

  function isAutoFireModeActive() {
    const w = currentWeapon();
    const modeInfo = getWeaponModeInfo(w);
    return !!(w && w.ammoType && w.automatic && modeInfo.id === 'auto');
  }

  function stopAutoFire() {
    mouseFireHeld = false;
  }

  function updateAutomaticFire() {
    if (hudEditMode) { stopAutoFire(); return; }
    if (!mouseFireHeld || !gameStarted || paused || anyWindowOpen() || activeLootEnemy || activeWorldContainer || traderWindowOpen || storageWindowOpen) return;
    if (!isAutoFireModeActive()) { stopAutoFire(); return; }
    if (player.fireCooldown > 0 || player.reloadTimer > 0) return;
    refreshPointerWorldFromLastScreen();
    if (!pointerHasWorld) return;
    shootAtPoint(pointerWorld.x, pointerWorld.z);
  }

  canvas.addEventListener('pointerdown', e => {
    if (isMobileControlsEnabled() && e.pointerType === 'touch' && blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
    if (hudEditMode) { e.preventDefault(); e.stopPropagation(); return; }
    if (isProgressionWindowOpen()) { e.preventDefault(); e.stopPropagation(); return; }
    if (!gameStarted || paused) return;
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      openWorldContextMenuFromEvent(e);
      return;
    }
    if (e.button !== 0) return;
    hideWorldContextMenu();
    if (isMobileControlsEnabled() && e.pointerType === 'touch') {
      // На телефоне тап по модели игрока открывает карточку состояния и лечения.
      // Пустое касание поля не крутит персонажа, не показывает прицел и не атакует.
      if (tryOpenMobileRemotePlayerContextFromTap(e.clientX, e.clientY, e)) return;
      e.preventDefault();
      e.stopPropagation();
      stopTouchAim();
      return;
    }
    updatePointerWorld(e.clientX, e.clientY);
    const enemy = findEnemyFromEvent(e.clientX, e.clientY);
    if (enemy && enemy.dead) {
      stopAutoFire();
      openLootWindow(enemy);
      return;
    }
    const worldContainer = findWorldContainerFromEvent(e.clientX, e.clientY);
    if (worldContainer) {
      stopAutoFire();
      openWorldContainerWindow(worldContainer);
      return;
    }
    const groundItem = findGroundItemFromEvent(e.clientX, e.clientY);
    if (groundItem) {
      stopAutoFire();
      pickupGroundItem(groundItem);
      return;
    }
    const resource = findResourceFromEvent(e.clientX, e.clientY);
    if (resource && tryHarvestResourceWithHeldTool(resource)) {
      stopAutoFire();
      return;
    }
    player.attackTarget = null;
    mouseFireHeld = isAutoFireModeActive();
    shootAtPoint(pointerWorld.x, pointerWorld.z);
  });

  window.addEventListener('pointerup', e => { stopAutoFire(); stopTouchAim(e.pointerId); });
  window.addEventListener('pointercancel', e => { stopAutoFire(); stopTouchAim(e.pointerId); });
  window.addEventListener('blur', () => clearAllGameplayInput('blur'));
  window.addEventListener('pagehide', () => clearAllGameplayInput('pagehide'));
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    openWorldContextMenuFromEvent(e);
  });
  document.addEventListener('pointerdown', e => {
    if (e.target && e.target.closest && e.target.closest('#world-context-menu')) return;
    if (e.button === 2) return;
    hideWorldContextMenu();
  }, true);
  window.addEventListener('contextmenu', e => { stopAutoFire(); e.preventDefault(); });


  function startKeyboardQuickUseRadial(e) {
    if (!gameStarted || paused || anyBlockingWindowOpenForQuickAccess() || hudEditMode || isProgressionWindowOpen()) return false;
    if (quickUseRadialState && quickUseRadialState.source === 'keyboard-e') return true;
    bindQuickUseGlobalPointerTracking();
    const p = quickUseFallbackPoint();
    quickUseRadialState = {
      pointerId: 'keyboard-e',
      startX: p.x,
      startY: p.y,
      open: false,
      selectedIndex: null,
      entries: [],
      center: { x: p.x, y: p.y },
      timer: null,
      source: 'keyboard-e'
    };
    quickUseRadialState.timer = setTimeout(() => {
      if (!quickUseRadialState || quickUseRadialState.source !== 'keyboard-e') return;
      const p2 = quickUseFallbackPoint();
      quickUseRadialState.startX = p2.x;
      quickUseRadialState.startY = p2.y;
      quickUseRadialState.center = { x: p2.x, y: p2.y };
      openQuickUseRadial(null, p2.x, p2.y);
    }, QUICK_USE_RADIAL_HOLD_MS);
    return true;
  }

  function finishKeyboardQuickUseRadial(e) {
    const state = quickUseRadialState;
    if (!state || state.source !== 'keyboard-e') return false;
    if (state.timer) clearTimeout(state.timer);
    const wasOpen = !!state.open;
    const p = quickUseFallbackPoint();
    if (wasOpen) {
      updateQuickUseRadialSelection(p.x, p.y);
      closeQuickUseRadial(true);
    } else {
      quickUseRadialState = null;
      if (gameStarted && !paused && !anyWindowOpen()) performUniversalInteract();
    }
    return true;
  }

  function isKeyboardTextEntryTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  document.addEventListener('keydown', e => {
    if (e.code === 'Escape') hideWorldContextMenu();
    if (!gameStarted) return;
    if (isKeyboardTextEntryTarget(e.target)) return;
    if (handlePipboyNavigationHotkey(e)) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      openPipboyTab('status');
      return;
    }
    if (isProgressionWindowOpen()) {
      e.preventDefault();
      Object.keys(keys).forEach(code => { keys[code] = false; });
      stopAutoFire();
      stopTouchAim();
      if (e.code === 'Escape') closePipboyWindows();
      return;
    }
    if (hudEditMode) {
      e.preventDefault();
      if (e.code === 'Escape') setHudEditMode(false);
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      if (!e.repeat) startKeyboardQuickUseRadial(e);
      keys[e.code] = true;
      return;
    }
    keys[e.code] = true;
    const quickIndex = QUICK_KEYS.indexOf(e.code);
    if (quickIndex !== -1) {
      e.preventDefault();
      if (!e.repeat && isGlobalMapOverlayActive() && !anyBlockingWindowOpenForQuickAccess() && typeof activateQuickSlot === 'function') activateQuickSlot(quickIndex);
      return;
    }
    if (e.code === 'F1') { e.preventDefault(); toggleControls(); return; }
    if (e.code === 'KeyI') { e.preventDefault(); openPipboyTab('items'); return; }
    if (e.code === 'KeyB') { e.preventDefault(); openPipboyTab('skills'); return; }
    if (e.code === 'KeyP') { e.preventDefault(); openPipboyTab('craft'); return; }
    if (e.code === 'KeyX') { e.preventDefault(); cycleFireMode(); return; }
    if (e.code === 'KeyM') { e.preventDefault(); toggleWindow('map'); return; }
    if (e.code === 'KeyV') { e.preventDefault(); toggleVisibilityFogVisual(); return; }
    if (e.code === 'KeyC') { e.preventDefault(); togglePlayerCrouch(); return; }
    if (e.code === 'KeyF') { e.preventDefault(); openNearbyCorpse(); return; }
    if (e.code === 'KeyG') { e.preventDefault(); if (!pickupNearestGroundItem()) setReadout('Рядом нет предмета на земле.'); return; }
    if (e.code === 'KeyR') reloadWeapon();
    if (e.code === 'Space') {
      e.preventDefault();
      if ((activeLootEnemy || activeWorldContainer) && document.getElementById('loot-window').style.display === 'block') takeAllLoot();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      
      const gfxWin = document.getElementById('graphics-window');
      if (gfxWin && (gfxWin.classList.contains('visible') || gfxWin.style.display === 'block')) { closeGraphicsWindow(); return; }
      const settingsPanel = document.getElementById('game-settings-panel');
      const tutorialPanel = document.getElementById('tutorial-window');
      if (settingsPanel && settingsPanel.classList.contains('visible')) closeGameMenu();
      else if (tutorialPanel && tutorialPanel.classList.contains('visible')) closeTutorialWindow();
      else if (isPipboyWindowOpen()) closePipboyWindows();
      else if (activeLootEnemy || activeWorldContainer) closeLootWindow();
      else if (traderWindowOpen) closeTraderWindow();
      else if (storageWindowOpen) closeStorageWindow();
      else if (anyWindowOpen()) closeAllWindows(true, { preserveGlobalMap: isGlobalMapOverlayActive() });
      // ESC больше не ставит игру на паузу и не выключает внутренний fullscreen на ПК.
      return;
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'KeyE') {
      e.preventDefault();
      finishKeyboardQuickUseRadial(e);
    }
    keys[e.code] = false;
  });

  function clearAllGameplayInput(reason = 'lifecycle', options = {}) {
    Object.keys(keys).forEach(k => { keys[k] = false; });
    stopAutoFire();
    touchFireHeld = false;
    touchAimFireHeld = false;
    touchFireTimer = 0;
    resetVirtualMove();
    stopTouchAim();
    try {
      if (typeof clearGlobalMapCameraKeys === 'function') clearGlobalMapCameraKeys();
      if (typeof GLOBAL_MAP_3D === 'object' && GLOBAL_MAP_3D) {
        GLOBAL_MAP_3D.dragging = false;
        GLOBAL_MAP_3D.dragX = 0;
        GLOBAL_MAP_3D.dragY = 0;
      }
    } catch (_) {}
    try {
      document.querySelectorAll('.touch-btn.active').forEach(button => button.classList.remove('active'));
    } catch (_) {}
    try {
      if (quickUseRadialState) cancelQuickUseRadial();
    } catch (_) {}
    try {
      if (player) {
        player.attackTarget = null;
      }
    } catch (_) {}
    if (options.sendIdle !== false
      && typeof sendImmediateMultiplayerState === 'function'
      && multiplayer?.socket?.connected
      && multiplayer.joined) {
      try { sendImmediateMultiplayerState('idle'); } catch (_) {}
    }
    return reason;
  }

  function clearMovementInputForHudEdit() {
    clearAllGameplayInput('hud-edit');
  }


  let proximityHintLastUpdateAt = 0;

  function updateProximityHints() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - proximityHintLastUpdateAt < 120) return;
    proximityHintLastUpdateAt = now;
    if (!(paused || hoveredEnemy || anyWindowOpen() || activeLootEnemy || activeWorldContainer || traderWindowOpen)) {
    const cursorTarget = interactionTargetUnderCursor();
      if (cursorTarget && (typeof isWorldContextTargetInRange !== 'function' || isWorldContextTargetInRange(cursorTarget))) {
        const cursorHint = interactionHintForTarget(cursorTarget);
        if (cursorHint) {
          setReadout(cursorHint);
          return;
        }
      }
      const held = heldInteractionItemEntry();
      if (held && isMedicalInteractionItem(held.item) && cursorOverLocalPlayerForHeldInteraction()) {
        setReadout(`E - применить ${held.item.name} на себя.`);
        return;
      }
    }
    if (paused || hoveredEnemy || anyWindowOpen() || activeLootEnemy || activeWorldContainer || traderWindowOpen) return;
    if (findNearbyTrader()) {
      setReadout('E — поговорить с торговцем.');
      return;
    }
    if (findNearbyStorage()) {
      setReadout('E — открыть хранилище.');
      return;
    }
    if (typeof isPlayerInWorldMapExitZone === 'function' && isPlayerInWorldMapExitZone()) {
      setReadout('Выход в пустошь: переход на глобальную карту.');
      return;
    }
    if (exitPortal && Math.hypot(exitPortal.x - player.x, exitPortal.z - player.z) <= 2.4) {
      const targetName = LOCATIONS[exitPortal.to]?.name || 'другую локацию';
      setReadout(`${exitPortal.label || 'Переход'}: перейти в ${targetName}.`);
    }
  }
