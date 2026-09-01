  const HUD_EDIT_KEY = 'realmOfAshesHudPositionsV28';
  let hudEditMode = false;

  function hudEditTargets() {
    return Array.from(document.querySelectorAll('#player-info, #hud-top, #quickbar, #weapon-readout, #log, #desktop-minimap-hud, #mobile-minimap-hud, #system-log-panel, .mobile-left-rail, .mobile-right-rail, .touch-buttons, .touch-joystick'));
  }

  function targetHudKey(el) {
    if (!el) return '';
    if (el.id) return '#' + el.id;
    if (el.classList.contains('mobile-left-rail')) return '.mobile-left-rail';
    if (el.classList.contains('mobile-right-rail')) return '.mobile-right-rail';
    if (el.classList.contains('touch-buttons')) return '.touch-buttons';
    if (el.classList.contains('touch-joystick')) return '.touch-joystick';
    return '';
  }

  function loadHudPositions() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(HUD_EDIT_KEY) || '{}') || {}; } catch (_) { data = {}; }
    hudEditTargets().forEach(el => {
      const key = targetHudKey(el);
      const pos = data[key];
      if (!key || !pos) return;
      el.style.left = pos.left;
      el.style.top = pos.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = pos.transform || 'none';
    });
  }

  function saveHudPosition(el) {
    const key = targetHudKey(el);
    if (!key) return;
    let data = {};
    try { data = JSON.parse(localStorage.getItem(HUD_EDIT_KEY) || '{}') || {}; } catch (_) { data = {}; }
    data[key] = { left: el.style.left, top: el.style.top, transform: el.style.transform || 'none' };
    localStorage.setItem(HUD_EDIT_KEY, JSON.stringify(data));
  }

  function resetHudPositions() {
    localStorage.removeItem(HUD_EDIT_KEY);
    hudEditTargets().forEach(el => {
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
    });
    setReadout('HUD сброшен.');
    resize();
  }

  function setHudEditMode(enabled) {
    hudEditMode = !!enabled;
    document.body.classList.toggle('hud-edit-mode', hudEditMode);
    if (hudEditMode && typeof clearMovementInputForHudEdit === 'function') clearMovementInputForHudEdit();
    const btn = document.getElementById('settings-edit-hud-btn');
    if (btn) btn.textContent = hudEditMode ? 'Запомнить HUD' : 'Редактировать HUD';
    setReadout(hudEditMode ? 'Редактирование HUD включено. Двигайте элементы, управление персонажем отключено.' : 'HUD запомнен.');
  }

  function initHudEditor() {
    loadHudPositions();
    hudEditTargets().forEach(el => {
      if (el.dataset.hudEditBound === '1') return;
      el.dataset.hudEditBound = '1';
      el.addEventListener('pointerdown', e => {
        if (!hudEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        const move = ev => {
          if (!hudEditMode) return;
          ev.preventDefault();
          const x = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - dx));
          const y = Math.max(0, Math.min((window.visualViewport?.height || window.innerHeight) - rect.height, ev.clientY - dy));
          el.style.left = Math.round(x) + 'px';
          el.style.top = Math.round(y) + 'px';
          el.style.right = 'auto';
          el.style.bottom = 'auto';
          el.style.transform = 'none';
        };
        const up = ev => {
          try { el.releasePointerCapture(e.pointerId); } catch (_) {}
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          saveHudPosition(el);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }, { passive: false });
    });
  }

  function initGameMenu() {
    const gear = document.getElementById('game-settings-btn');
    if (gear && gear.dataset.boundSettings !== '1') {
      gear.dataset.boundSettings = '1';
      const open = e => { e.preventDefault(); e.stopPropagation(); toggleGameMenu(); };
      gear.addEventListener('pointerdown', e => { e.stopPropagation(); });
      gear.addEventListener('click', open);
    }
    const closeBtn = document.getElementById('settings-close-btn');
    if (closeBtn && closeBtn.dataset.boundSettings !== '1') {
      closeBtn.dataset.boundSettings = '1';
      closeBtn.addEventListener('click', e => { e.preventDefault(); closeGameMenu(); });
    }
    const logoutBtn = document.getElementById('settings-logout-btn');
    if (logoutBtn && logoutBtn.dataset.boundSettings !== '1') {
      logoutBtn.dataset.boundSettings = '1';
      logoutBtn.addEventListener('click', e => { e.preventDefault(); closeGameMenu(false); serverLogout(); });
    }
    const switchBtn = document.getElementById('settings-switch-character-btn');
    if (switchBtn && switchBtn.dataset.boundSettings !== '1') {
      switchBtn.dataset.boundSettings = '1';
      switchBtn.addEventListener('click', e => { e.preventDefault(); switchCharacterFromMenu(); });
    }
    const editBtn = document.getElementById('settings-edit-hud-btn');
    if (editBtn && editBtn.dataset.boundSettings !== '1') {
      editBtn.dataset.boundSettings = '1';
      editBtn.addEventListener('click', e => { e.preventDefault(); setHudEditMode(!hudEditMode); closeGameMenu(); });
    }
    const settingsGraphicsBtn = document.getElementById('settings-graphics-btn');
    if (settingsGraphicsBtn && settingsGraphicsBtn.dataset.boundSettings !== '1') {
      settingsGraphicsBtn.dataset.boundSettings = '1';
      settingsGraphicsBtn.addEventListener('click', e => { e.preventDefault(); closeGameMenu(false); openGraphicsWindow(); });
    }
    const resetBtn = document.getElementById('settings-reset-hud-btn');
    if (resetBtn && resetBtn.dataset.boundSettings !== '1') {
      resetBtn.dataset.boundSettings = '1';
      resetBtn.addEventListener('click', e => { e.preventDefault(); resetHudPositions(); closeGameMenu(); });
    }
    const tutorialClose = document.getElementById('tutorial-close-btn');
    if (tutorialClose && tutorialClose.dataset.boundTutorial !== '1') {
      tutorialClose.dataset.boundTutorial = '1';
      tutorialClose.addEventListener('click', e => { e.preventDefault(); closeTutorialWindow(); });
    }
    const settingsPanel = document.getElementById('game-settings-panel');
    const tutorialPanel = document.getElementById('tutorial-window');
    [settingsPanel, tutorialPanel].forEach(el => {
      if (!el || el.dataset.stopBound === '1') return;
      el.dataset.stopBound = '1';
      el.addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
      el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    });
    const systemToggle = document.getElementById('system-log-toggle');
    if (systemToggle && systemToggle.dataset.boundSystemLog !== '1') {
      systemToggle.dataset.boundSystemLog = '1';
      systemToggle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const panel = document.getElementById('system-log-panel');
        if (!panel) return;
        const collapsed = !panel.classList.contains('collapsed');
        panel.classList.toggle('collapsed', collapsed);
        systemToggle.textContent = collapsed ? '+' : '−';
      });
    }
    initHudEditor();
  }

  function initMobileRails() {
    document.querySelectorAll('.mobile-rail-btn').forEach(btn => {
      if (btn.dataset.boundRail === '1') return;
      btn.dataset.boundRail = '1';
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener('click', e => {
        if (hudEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        if (!gameStarted) return;
        const action = btn.dataset.mobileAction;
        if (action === 'inventory') openPipboyTab('items');
        else if (action === 'map') toggleWindow('map');
        else if (action === 'talents') openPipboyTab('skills');
        else if (action === 'craft') openPipboyTab('craft');
        else if (action === 'tutorial') openTutorialWindow();
        else if (action === 'settings') toggleGameMenu();
        else if (action === 'vision') toggleVisibilityFogVisual();
        else if (action === 'crouch') togglePlayerCrouch();
        else if (action === 'target') selectNearestEnemyForMobile();
        else if (action === 'reload') reloadWeapon();
        else if (action === 'mode') cycleFireMode();
        else if (action === 'interact') {
          performUniversalInteract();
        }
        updateMobilePanelState();
      });
    });
  }

  function isMobilePlayerTapHudTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest([
      '#player-action-window', '#mobile-player-treatment-menu', '#mobile-player-treatment-layer', '#world-context-menu', '#item-context-menu', '#quantity-side-panel', '#game-confirm-panel',
      '#loot-window', '#trader-window', '#storage-window', '#loot-grid', '#trader-grid', '#storage-window .storage-grid', '#trade-sell-zone',
      '.window-panel', '.modal-panel', '#character-screen', '#game-settings-panel', '#tutorial-window',
      '.inv-card', '.trade-card', '.ctx-option', '.ui-btn', 'button', 'input', 'select', 'textarea',
      '#quickbar', '.quick-slot', '#weapon-readout', '#system-log-panel', '.mobile-chat-panel', '.mobile-quest-panel',
      '#player-info', '#hud-top', '#desktop-minimap-hud', '#mobile-minimap-hud',
      '.mobile-left-rail', '.mobile-right-rail', '.touch-buttons', '#touch-fire', '#touch-target', '#touch-reload',
      '#touch-mode', '#touch-loot', '#touch-interact', '#touch-inventory', '#touch-map',
      '#game-settings-btn', '#global-fullscreen-btn', '#mobile-fullscreen-btn', '#landscape-fullscreen-btn'
    ].join(','));
  }

  function isMobilePlayerTreatmentMenuOpen() {
    const win = document.getElementById('mobile-player-treatment-menu');
    return !!(win && win.classList.contains('visible') && win.style.display !== 'none');
  }

  function isInsideMobilePlayerTreatmentMenu(target) {
    return !!(target && target.closest && target.closest('#mobile-player-treatment-menu'));
  }

  function blockEventOutsideMobilePlayerTreatmentMenu(e) {
    if (!isMobilePlayerTreatmentMenuOpen()) return false;
    if (isInsideMobilePlayerTreatmentMenu(e?.target)) return false;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    e?.stopImmediatePropagation?.();
    return true;
  }

  function initMobilePlayerTapCapture() {
    if (document.body.dataset.mobilePlayerTapCaptureBound === '1') return;
    document.body.dataset.mobilePlayerTapCaptureBound = '1';
    let tapState = null;
    const reset = () => { tapState = null; };
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { reset(); return; }
      if (!isMobileControlsEnabled() || !gameStarted || paused || hudEditMode) return;
      if (anyWindowOpen()) { reset(); return; }
      if (isMobilePlayerTapHudTarget(e.target)) { reset(); return; }
      tapState = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, startedAt: performance.now(), moved: false };
    }, true);
    document.addEventListener('pointermove', e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
      if (!tapState || tapState.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - tapState.x, e.clientY - tapState.y) > MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE) tapState.moved = true;
    }, true);
    document.addEventListener('pointerup', e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { reset(); return; }
      if (!tapState || tapState.pointerId !== e.pointerId) return;
      const state = tapState;
      reset();
      if (!isMobilePlayerMenuTapCandidate(state, e)) return;
      // Глобальная capture-проверка нужна, потому что touch-зоны могут перехватить тап
      // раньше canvas. Событие не останавливаем: штатные обработчики зон сами сбросят стик/прицел.
      if (tryOpenMobileRemotePlayerContextFromTap(e.clientX, e.clientY, null)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
    }, true);
    document.addEventListener('pointercancel', reset, true);

    let touchTapState = null;
    const resetTouch = () => { touchTapState = null; };
    document.addEventListener('touchstart', e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { resetTouch(); return; }
      if (!isMobileControlsEnabled() || !gameStarted || paused || hudEditMode) return;
      if (anyWindowOpen()) { resetTouch(); return; }
      if (performance.now() - lastMobilePlayerContextOpenAt < 320) return;
      if (e.touches.length !== 1) { resetTouch(); return; }
      if (isMobilePlayerTapHudTarget(e.target)) { resetTouch(); return; }
      const t = e.touches[0];
      touchTapState = { identifier: t.identifier, x: t.clientX, y: t.clientY, startedAt: performance.now(), moved: false };
    }, true);
    document.addEventListener('touchmove', e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
      if (!touchTapState) return;
      const t = [...e.touches].find(touch => touch.identifier === touchTapState.identifier);
      if (!t) return;
      if (Math.hypot(t.clientX - touchTapState.x, t.clientY - touchTapState.y) > MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE) touchTapState.moved = true;
    }, true);
    document.addEventListener('touchend', e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { resetTouch(); return; }
      if (!touchTapState) return;
      if (performance.now() - lastMobilePlayerContextOpenAt < 320) { resetTouch(); return; }
      const t = [...e.changedTouches].find(touch => touch.identifier === touchTapState.identifier);
      if (!t) { resetTouch(); return; }
      const state = { pointerId: touchTapState.identifier, x: touchTapState.x, y: touchTapState.y, startedAt: touchTapState.startedAt, moved: touchTapState.moved };
      resetTouch();
      const elapsed = performance.now() - state.startedAt;
      const moved = Math.hypot(t.clientX - state.x, t.clientY - state.y);
      if (elapsed > MOBILE_PLAYER_CONTEXT_TAP_MAX_MS || moved > MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE || state.moved) return;
      if (tryOpenMobileRemotePlayerContextFromTap(t.clientX, t.clientY, null)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
    }, { capture: true, passive: false });
    document.addEventListener('touchcancel', resetTouch, true);
  }

  function initMobileControls() {
    setDeviceStatus();
    syncMobileOrientationState();
    initMobileRails();
    initMobilePlayerTapCapture();
    const controlsText = document.getElementById('controls');
    if (controlsText && isMobileControlsEnabled()) {
      controlsText.innerHTML = '<b>Сенсорное управление:</b> левый стик — движение и направление взгляда · ⇩ — присесть за низким укрытием · атака — стрельба · ✋ — действие предметом в руках или рядом · нажмите ⚡ для кругового меню предметов · тап по игроку открывает социальное меню · тап по пустому месту не атакует.';
    }

    let mobileMoveTapState = null;
    let mobileAimTapState = null;

    const startMovePointer = (e, floating = false) => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
      if (hudEditMode) return;
      if (!isMobileControlsEnabled() || virtualMove.pointerId !== null) return;
      e.preventDefault(); e.stopPropagation();
      mobileMoveTapState = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, startedAt: performance.now(), moved: false };
      virtualMove.pointerId = e.pointerId;
      if (floating) placeFloatingJoystick(e.clientX, e.clientY);
      updateVirtualMoveFromPoint(e.clientX, e.clientY);
    };
    const continueMovePointer = e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
      if (hudEditMode) return;
      if (!isMobileControlsEnabled() || virtualMove.pointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      if (mobileMoveTapState && Math.hypot(e.clientX - mobileMoveTapState.x, e.clientY - mobileMoveTapState.y) > MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE) mobileMoveTapState.moved = true;
      updateVirtualMoveFromPoint(e.clientX, e.clientY);
    };
    const endMovePointer = e => {
      if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { resetVirtualMove(); mobileMoveTapState = null; return; }
      if (hudEditMode) { resetVirtualMove(); mobileMoveTapState = null; return; }
      if (!isMobileControlsEnabled() || virtualMove.pointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      const tapState = mobileMoveTapState;
      resetVirtualMove();
      mobileMoveTapState = null;
      if (e.type === 'pointerup' && tryOpenMobileRemotePlayerContextFromTapState(tapState, e)) return;
    };

    const moveZone = document.getElementById('touch-move-zone');
    if (moveZone) {
      moveZone.addEventListener('pointerdown', e => { try { moveZone.setPointerCapture(e.pointerId); } catch (_) {} startMovePointer(e, false); });
      moveZone.addEventListener('pointermove', continueMovePointer);
      moveZone.addEventListener('pointerup', endMovePointer);
      moveZone.addEventListener('pointercancel', endMovePointer);
      moveZone.addEventListener('lostpointercapture', resetVirtualMove);
    }

    const joy = document.getElementById('touch-joystick');
    if (joy) {
      joy.addEventListener('pointerdown', e => { try { joy.setPointerCapture(e.pointerId); } catch (_) {} startMovePointer(e, false); });
      joy.addEventListener('pointermove', continueMovePointer);
      joy.addEventListener('pointerup', endMovePointer);
      joy.addEventListener('pointercancel', endMovePointer);
      joy.addEventListener('lostpointercapture', resetVirtualMove);
    }

    const aimZone = document.getElementById('touch-aim-zone');
    if (aimZone) {
      const startAimTap = e => {
        if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
        if (hudEditMode) return;
        if (!isMobileControlsEnabled()) return;
        // Тап/свайп по правой части экрана больше не показывает прицел и не атакует.
        e.preventDefault();
        e.stopPropagation();
        try { aimZone.setPointerCapture(e.pointerId); } catch (_) {}
        mobileAimTapState = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, startedAt: performance.now(), moved: false };
        touchAimPointerId = null;
        touchAimFireHeld = false;
        stopTouchAim();
      };
      const moveAimTap = e => {
        if (blockEventOutsideMobilePlayerTreatmentMenu(e)) return;
        if (hudEditMode) return;
        if (!isMobileControlsEnabled()) return;
        e.preventDefault();
        e.stopPropagation();
        if (mobileAimTapState && mobileAimTapState.pointerId === e.pointerId && Math.hypot(e.clientX - mobileAimTapState.x, e.clientY - mobileAimTapState.y) > MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE) mobileAimTapState.moved = true;
        touchAimPointerId = null;
        touchAimFireHeld = false;
        stopTouchAim();
      };
      const endAimTap = e => {
        if (blockEventOutsideMobilePlayerTreatmentMenu(e)) { mobileAimTapState = null; stopTouchAim(); return; }
        if (hudEditMode) { mobileAimTapState = null; return; }
        if (!isMobileControlsEnabled()) return;
        e.preventDefault();
        e.stopPropagation();
        const tapState = mobileAimTapState;
        mobileAimTapState = null;
        touchAimPointerId = null;
        touchAimFireHeld = false;
        stopTouchAim();
        if (e.type === 'pointerup' && tryOpenMobileRemotePlayerContextFromTapState(tapState, e)) return;
      };
      aimZone.addEventListener('pointerdown', startAimTap);
      aimZone.addEventListener('pointermove', moveAimTap);
      aimZone.addEventListener('pointerup', endAimTap);
      aimZone.addEventListener('pointercancel', e => { mobileAimTapState = null; moveAimTap(e); });
      aimZone.addEventListener('lostpointercapture', () => { mobileAimTapState = null; stopTouchAim(); });
    }

    const bindTap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', e => {
        if (hudEditMode) return;
        e.preventDefault(); e.stopPropagation(); setTouchButtonActive(id, true); fn(e);
      });
      const up = e => { if (hudEditMode) return; e.preventDefault(); e.stopPropagation(); setTouchButtonActive(id, false); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', () => setTouchButtonActive(id, false));
    };

    const fire = document.getElementById('touch-fire');
    if (fire) {
      fire.addEventListener('pointerdown', e => {
        if (hudEditMode) return;
        if (!isMobileControlsEnabled() || !gameStarted) return;
        if (paused || anyWindowOpen()) {
          e.preventDefault(); e.stopPropagation();
          touchFireHeld = false;
          setTouchButtonActive('touch-fire', false);
          return;
        }
        e.preventDefault(); e.stopPropagation();
        try { fire.setPointerCapture(e.pointerId); } catch (_) {}
        touchFireHeld = true;
        touchFireTimer = 0.03;
        setTouchButtonActive('touch-fire', true);
        shootFromCurrentAim();
      });
      const stop = e => { if (hudEditMode) return; e.preventDefault(); e.stopPropagation(); touchFireHeld = false; setTouchButtonActive('touch-fire', false); };
      fire.addEventListener('pointerup', stop);
      fire.addEventListener('pointercancel', stop);
      fire.addEventListener('lostpointercapture', () => { touchFireHeld = false; setTouchButtonActive('touch-fire', false); });
    }

    bindTap('touch-target', () => { if (gameStarted) selectNearestEnemyForMobile(); });

    bindTap('touch-reload', () => { if (gameStarted) reloadWeapon(); });
    bindTap('touch-mode', () => { if (gameStarted) cycleFireMode(); });
    bindTap('touch-interact', () => { if (gameStarted) performUniversalInteract(); });
    bindTap('touch-loot', () => { if (gameStarted) performUniversalInteract(); });
    // Меню лечения игрока открывается только тапом по самому игроку на экране.
    bindTap('touch-inventory', () => { if (gameStarted) { openPipboyTab('items'); updateMobilePanelState(); } });

    bindTap('touch-map', () => { if (gameStarted) { toggleWindow('map'); updateMobilePanelState(); } });

    initFullscreenButtons();
    initWindowCloseButtons();
    initGameMenu();

    document.querySelectorAll('.window-panel, .modal-panel, #character-screen').forEach(el => {
      el.addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
      el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    });

    window.addEventListener('resize', syncMobileOrientationState);
    window.addEventListener('orientationchange', () => setTimeout(syncMobileOrientationState, 220));
    initMobilePanelStateObserver();
    syncMobileOrientationState();
  }

  const uiWindows = {
    inventory: document.getElementById('inventory-window'),
    talents: document.getElementById('talents-window'),
    craft: document.getElementById('craft-window'),
    map: document.getElementById('map-window'),
    globalMap: document.getElementById('global-map-window')
  };
  const PIPBOY_WINDOW_NAMES = new Set(['inventory', 'talents', 'craft']);

  function isGlobalMapOverlayActive() {
    return !!(
      uiWindows.globalMap &&
      uiWindows.globalMap.classList.contains('visible') &&
      document.body.classList.contains('global-map-mode')
    );
  }

  function isProgressionWindowOpen() {
    return !!(uiWindows.talents && uiWindows.talents.classList.contains('visible'));
  }

  function closePipboyWindows() {
    PIPBOY_WINDOW_NAMES.forEach(name => {
      const win = uiWindows[name];
      if (win) win.classList.remove('visible');
    });
    syncProgressionWindowState();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function syncProgressionWindowState() {
    const open = isProgressionWindowOpen();
    document.body.classList.remove('progression-window-open');
    if (open) {
      Object.keys(keys).forEach(code => { keys[code] = false; });
      stopAutoFire();
      stopTouchAim();
      hideTargetHint();
      hideTooltip();
    }
  }



  document.querySelectorAll('[data-progression-mode]').forEach(btn => {
    if (btn.dataset.boundProgressionMode === '1') return;
    btn.dataset.boundProgressionMode = '1';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setProgressionMode(btn.dataset.progressionMode || 'overview');
    });
  });

  document.querySelectorAll('[data-close-window]').forEach(btn => {
    if (btn.dataset.boundCloseWindow === '1') return;
    btn.dataset.boundCloseWindow = '1';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.getAttribute('data-close-window');
      const win = uiWindows[name];
      if (win) win.classList.remove('visible');
      syncProgressionWindowState();
      closeQuantityPanel();
      hideTooltip();
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    });
  });

  function openPipboyTab(tab = 'items', options = {}) {
    const target = ['status', 'items', 'skills', 'perks', 'craft', 'quests', 'world', 'factions', 'friends', 'clan', 'radio'].includes(tab) ? tab : 'items';
    if (options && options.toggleCurrent && isPipboyWindowOpen() && currentPipboyHotkeyTab() === target) {
      closePipboyWindows();
      return;
    }
    closePipboyWindows();
    if (target === 'skills' || target === 'perks') {
      if (uiWindows.talents) uiWindows.talents.classList.add('visible');
      setProgressionMode(target === 'perks' ? 'perks' : 'overview', { noRender: true });
      renderTalentTree();
      if (target === 'perks') renderPerkWheel();
      if (target === 'perks' && typeof centerPerkWheelView === 'function') centerPerkWheelView(false);
      updatePipboyTabButtons(target);
    } else if (target === 'craft') {
      if (uiWindows.craft) uiWindows.craft.classList.add('visible');
      renderCraftingWindow();
      updatePipboyTabButtons('craft');
    } else {
      if (uiWindows.inventory) uiWindows.inventory.classList.add('visible');
      setPipboyInventoryPage(target);
      renderInventory();
    }
    syncProgressionWindowState();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  document.querySelectorAll('[data-pipboy-tab]').forEach(btn => {
    if (btn.dataset.boundPipboyTab === '1') return;
    btn.dataset.boundPipboyTab = '1';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openPipboyTab(btn.dataset.pipboyTab || 'items');
    });
  });


  function initSortButtons() {
    const bind = (id, key, mapGetter, label) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.boundSort === '1') return;
      btn.dataset.boundSort = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        const map = mapGetter();
        if (map === inventory && typeof spendInventoryManipulationAp === 'function' && !spendInventoryManipulationAp('inventory-sort')) return;
        const mode = nextSortMode(key);
        sortItemMap(map, mode);
        renderInventory();
        renderStorageWindow();
        updateSortButtonLabels();
        const apText = map === inventory ? ` Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.` : '';
        setReadout(`${label}: ${SORT_MODE_LABELS[mode]}.${apText}`);
        queueSave();
      });
    };
    bind('inventory-sort-btn', 'inventory', () => inventory, 'Инвентарь отсортирован');
    bind('storage-sort-inventory', 'storageInventory', () => inventory, 'Рюкзак отсортирован');
    bind('storage-sort-box', 'storage', () => storageInventory, 'Хранилище отсортировано');
    updateSortButtonLabels();
  }
  initSortButtons();

  let lastReadoutLogText = '';

  function setReadout(text) {
    const el = document.getElementById('action-readout');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
    const msg = String(text || '').trim();
    if (!msg) {
      lastReadoutLogText = '';
      return;
    }
    if (msg !== lastReadoutLogText) {
      addLog(msg, null, 'system');
      if (typeof updateMobileChatLine === 'function') updateMobileChatLine(msg);
      lastReadoutLogText = msg;
    }
  }

  function toggleControls() {
    controlsVisible = !controlsVisible;
    document.getElementById('controls').style.display = controlsVisible ? 'block' : 'none';
  }

  function closeAllWindows(includeModalStorage = true, options = {}) {
    let shouldCloseModalStorage = includeModalStorage;
    let closeOptions = options || {};
    if (includeModalStorage && typeof includeModalStorage === 'object') {
      closeOptions = includeModalStorage;
      shouldCloseModalStorage = closeOptions.includeModalStorage !== false;
    }
    const preserveGlobalMap = !!closeOptions.preserveGlobalMap;
    Object.entries(uiWindows).forEach(([name, w]) => {
      if (!w) return;
      if (name === 'globalMap' && preserveGlobalMap) return;
      w.classList.remove('visible');
    });
    if (shouldCloseModalStorage && typeof closeStorageWindow === 'function') closeStorageWindow();
    if (typeof closeTraderWindow === 'function' && traderWindowOpen) closeTraderWindow();
    if (typeof closeNpcDialogueWindow === 'function') closeNpcDialogueWindow();
    if (typeof closePlayerActionWindow === 'function') closePlayerActionWindow(false);
    if (typeof closeWorldTaskBoardWindow === 'function') closeWorldTaskBoardWindow();
    if (typeof closeMobilePlayerTreatmentMenu === 'function') closeMobilePlayerTreatmentMenu(false);
    if (typeof closeGameConfirmPanel === 'function') closeGameConfirmPanel(false);
    closeQuantityPanel();
    hideItemContextMenu();
    if (typeof hideWorldContextMenu === 'function') hideWorldContextMenu();
    hideTooltip();
    hideTargetHint();
    syncProgressionWindowState();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function anyWindowOpen() {
    const playerActionWin = document.getElementById('player-action-window');
    const playerActionOpen = !!(playerActionWin && playerActionWin.style.display === 'block');
    const treatmentWin = document.getElementById('mobile-player-treatment-menu');
    const qtyPanel = document.getElementById('quantity-side-panel');
    const confirmPanel = document.getElementById('game-confirm-panel');
    const treatmentOpen = !!(treatmentWin && treatmentWin.classList.contains('visible') && treatmentWin.style.display !== 'none');
    const quantityOpen = !!(qtyPanel && qtyPanel.classList.contains('visible') && qtyPanel.style.display !== 'none');
    const confirmOpen = !!(confirmPanel && confirmPanel.classList.contains('visible') && confirmPanel.style.display !== 'none');
    const npcDialogueOpen = document.body.classList.contains('npc-dialogue-window-open');
    return document.body.classList.contains('graphics-window-open') || document.body.classList.contains('world-task-board-window-open') || npcDialogueOpen || storageWindowOpen || playerActionOpen || treatmentOpen || quantityOpen || confirmOpen || Object.values(uiWindows).some(w => w && w.classList.contains('visible'));
  }

  function anyBlockingWindowOpenForQuickAccess() {
    const playerActionWin = document.getElementById('player-action-window');
    const playerActionOpen = !!(playerActionWin && playerActionWin.style.display === 'block');
    const treatmentWin = document.getElementById('mobile-player-treatment-menu');
    const qtyPanel = document.getElementById('quantity-side-panel');
    const confirmPanel = document.getElementById('game-confirm-panel');
    const treatmentOpen = !!(treatmentWin && treatmentWin.classList.contains('visible') && treatmentWin.style.display !== 'none');
    const quantityOpen = !!(qtyPanel && qtyPanel.classList.contains('visible') && qtyPanel.style.display !== 'none');
    const confirmOpen = !!(confirmPanel && confirmPanel.classList.contains('visible') && confirmPanel.style.display !== 'none');
    const npcDialogueOpen = document.body.classList.contains('npc-dialogue-window-open');
    if (document.body.classList.contains('graphics-window-open') || document.body.classList.contains('world-task-board-window-open') || npcDialogueOpen || storageWindowOpen || playerActionOpen || treatmentOpen || quantityOpen || confirmOpen) return true;
    return Object.entries(uiWindows).some(([name, w]) => name !== 'globalMap' && w && w.classList.contains('visible'));
  }

  const PIPBOY_NUMBER_TAB_HOTKEYS = {
    Digit1: 'status',
    Numpad1: 'status',
    Digit2: 'items',
    Numpad2: 'items',
    Digit3: 'skills',
    Numpad3: 'skills',
    Digit4: 'perks',
    Numpad4: 'perks',
    Digit5: 'craft',
    Numpad5: 'craft',
    Digit6: 'quests',
    Numpad6: 'quests',
    Digit7: 'world',
    Numpad7: 'world',
    Digit8: 'friends',
    Numpad8: 'friends',
    Digit9: 'clan',
    Numpad9: 'clan',
    Digit0: 'radio',
    Numpad0: 'radio',
    Minus: 'factions',
    NumpadSubtract: 'factions'
  };

  function isPipboyWindowOpen() {
    return !!(
      (uiWindows.inventory && uiWindows.inventory.classList.contains('visible')) ||
      (uiWindows.talents && uiWindows.talents.classList.contains('visible')) ||
      (uiWindows.craft && uiWindows.craft.classList.contains('visible'))
    );
  }

  function currentPipboyHotkeyTab() {
    if (uiWindows.talents && uiWindows.talents.classList.contains('visible')) {
      return progressionMode === 'perks' ? 'perks' : 'skills';
    }
    if (uiWindows.craft && uiWindows.craft.classList.contains('visible')) return 'craft';
    const win = document.getElementById('inventory-window');
    return win?.dataset?.pipboyScreen || 'items';
  }

  function pipboyTabFromHotkey(e) {
    if (!e || e.ctrlKey || e.altKey || e.metaKey) return '';
    if (PIPBOY_NUMBER_TAB_HOTKEYS[e.code]) return PIPBOY_NUMBER_TAB_HOTKEYS[e.code];
    if (e.code === 'Tab') return 'status';
    if (e.code === 'KeyI') return 'items';
    if (e.code === 'KeyB') return currentPipboyHotkeyTab() === 'skills' ? 'perks' : 'skills';
    if (e.code === 'KeyP' || e.code === 'KeyC') return 'craft';
    if (e.code === 'KeyJ' || e.code === 'KeyQ') return 'quests';
    if (e.code === 'KeyW') return 'world';
    if (e.code === 'KeyO') return 'factions';
    if (e.code === 'KeyF') return 'friends';
    if (e.code === 'KeyK') return 'clan';
    if (e.code === 'KeyR') return 'radio';
    return '';
  }

  function handlePipboyNavigationHotkey(e) {
    if (!isPipboyWindowOpen()) return false;
    const tab = pipboyTabFromHotkey(e);
    if (!tab) return false;
    e.preventDefault();
    Object.keys(keys).forEach(code => { keys[code] = false; });
    stopAutoFire();
    stopTouchAim();
    openPipboyTab(tab, { toggleCurrent: true });
    return true;
  }

  function toggleWindow(name) {
    const win = uiWindows[name];
    if (!win) return;
    const willOpen = !win.classList.contains('visible');
    const preserveGlobalMap = isGlobalMapOverlayActive() && ['inventory', 'talents', 'craft'].includes(name);
    closeAllWindows(true, { preserveGlobalMap });
    if (willOpen) win.classList.add('visible');
    syncProgressionWindowState();
    if (name === 'inventory' && willOpen) setPipboyInventoryPage('items', { noRender: true });
    if (name === 'talents' && willOpen) setProgressionMode('overview', { noRender: true });
    if (name === 'map' && willOpen) {
      if (typeof renderMapWindow === 'function') renderMapWindow();
      else drawMinimap();
    }
    renderInventory();
    if (name === 'talents' && willOpen) renderPerkWheel();
    if (name === 'talents' && willOpen) updatePipboyTabButtons('skills');
    if (name === 'craft' && willOpen) {
      renderCraftingWindow();
      updatePipboyTabButtons('craft');
    }
    if (name === 'inventory' && willOpen) setPipboyInventoryPage('items');
    syncProgressionWindowState();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }
