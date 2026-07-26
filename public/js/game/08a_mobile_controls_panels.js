  // ===== INPUT =====
  const keys = {};
  let pointerWorld = new THREE.Vector3();
  const moveNdc = new THREE.Vector2();
  const moveGroundPoint = new THREE.Vector3();
  const playerScreenPoint = new THREE.Vector3();
  const fallbackScreenPoint = new THREE.Vector3();
  var hoveredEnemy = null; // var нужен: updatePlayerEquipmentVisuals вызывается до блока INPUT при первичной инициализации
  let paused = false;
  let controlsVisible = false;
  let pointerHasWorld = false;
  let lastPointerClientX = null;
  let lastPointerClientY = null;
  let mouseFireHeld = false;

  const virtualMove = { active: false, x: 0, y: 0, forward: 0, right: 0, pointerId: null, baseX: null, baseY: null, radius: 54, floating: false };
  window.__virtualMoveReady = true;
  let touchAimPointerId = null;
  let touchFireHeld = false;
  let touchAimFireHeld = false;
  let touchFireTimer = 0;
  let lastTouchAimX = null;
  let lastTouchAimY = null;

  function isMobileControlsEnabled() {
    return deviceInfo.type === 'mobile';
  }

  function setTouchButtonActive(id, active) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', !!active);
  }

  function resetVirtualMove() {
    virtualMove.active = false;
    virtualMove.x = 0;
    virtualMove.y = 0;
    virtualMove.forward = 0;
    virtualMove.right = 0;
    virtualMove.pointerId = null;
    virtualMove.baseX = null;
    virtualMove.baseY = null;
    virtualMove.floating = false;
    const joy = document.getElementById('touch-joystick');
    const knob = document.getElementById('touch-knob');
    if (joy) {
      joy.classList.remove('active', 'floating');
      joy.style.left = '';
      joy.style.top = '';
      joy.style.bottom = '';
    }
    if (knob) knob.style.transform = 'translate(0px, 0px)';
  }

  function placeFloatingJoystick(clientX, clientY) {
    const joy = document.getElementById('touch-joystick');
    if (!joy) return;
    const size = Math.max(96, joy.getBoundingClientRect().width || 132);
    const half = size / 2;
    const safeLeft = 8;
    const safeRight = Math.min(window.innerWidth * 0.56, 380);
    const safeTop = Math.max(80, window.innerHeight * 0.18);
    const safeBottom = window.innerHeight - 18;
    const cx = Math.min(safeRight - half, Math.max(safeLeft + half, clientX));
    const cy = Math.min(safeBottom - half, Math.max(safeTop + half, clientY));
    virtualMove.baseX = cx;
    virtualMove.baseY = cy;
    virtualMove.radius = Math.max(34, size * 0.40);
    virtualMove.floating = true;
    joy.style.left = `${(cx - half).toFixed(1)}px`;
    joy.style.top = `${(cy - half).toFixed(1)}px`;
    joy.style.bottom = 'auto';
    joy.classList.add('floating', 'active');
  }

  function updateVirtualMoveFromPoint(clientX, clientY) {
    const joy = document.getElementById('touch-joystick');
    const knob = document.getElementById('touch-knob');
    if (!joy) return;
    let cx = virtualMove.baseX;
    let cy = virtualMove.baseY;
    const r = joy.getBoundingClientRect();
    if (cx == null || cy == null) {
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      virtualMove.radius = Math.max(30, Math.min(r.width, r.height) * 0.40);
    }
    const max = virtualMove.radius || Math.max(30, Math.min(r.width, r.height) * 0.40);
    let dx = clientX - cx;
    let dy = clientY - cy;
    const rawLen = Math.hypot(dx, dy);
    const deadzone = Math.max(8, max * 0.14);
    if (rawLen > max) { dx = dx / rawLen * max; dy = dy / rawLen * max; }
    virtualMove.active = rawLen >= deadzone;
    virtualMove.x = dx / max;
    virtualMove.y = dy / max;
    if (virtualMove.active) {
      // На телефоне скорость больше не зависит от расстояния пальца от центра стика:
      // стик задаёт только направление, а не «газ».
      const dirLen = Math.max(0.001, Math.hypot(dx, dy));
      virtualMove.right = dx / dirLen;
      virtualMove.forward = -dy / dirLen;
    } else {
      virtualMove.right = 0;
      virtualMove.forward = 0;
    }
    if (joy) joy.classList.add('active');
    if (knob) knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }

  function updateTouchAim(clientX, clientY) {
    // На телефоне больше не показываем экранный прицел и не наводимся тапом по полю.
    if (isMobileControlsEnabled()) {
      lastTouchAimX = null;
      lastTouchAimY = null;
      document.body.classList.remove('touch-aiming');
      return;
    }
    lastTouchAimX = clientX;
    lastTouchAimY = clientY;
    updatePointerWorld(clientX, clientY);
    const reticle = document.getElementById('touch-aim-reticle');
    if (reticle) {
      reticle.style.left = `${clientX}px`;
      reticle.style.top = `${clientY}px`;
    }
    document.body.classList.add('touch-aiming');
  }

  function updateTouchAimFromWorld(x, z) {
    // На телефоне автоцель работает без отдельного визуального прицела.
    if (isMobileControlsEnabled()) {
      lastTouchAimX = null;
      lastTouchAimY = null;
      document.body.classList.remove('touch-aiming');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    fallbackScreenPoint.set(x, 0, z).project(camera);
    const cx = rect.left + (fallbackScreenPoint.x + 1) * rect.width * 0.5;
    const cy = rect.top + (1 - fallbackScreenPoint.y) * rect.height * 0.5;
    lastTouchAimX = cx;
    lastTouchAimY = cy;
    const reticle = document.getElementById('touch-aim-reticle');
    if (reticle) {
      reticle.style.left = `${cx}px`;
      reticle.style.top = `${cy}px`;
    }
    document.body.classList.add('touch-aiming');
  }

  function stopTouchAim(pointerId = null) {
    if (pointerId == null || touchAimPointerId === pointerId) {
      touchAimPointerId = null;
      touchAimFireHeld = false;
    }
    document.body.classList.remove('touch-aiming');
  }

  function shootFromCurrentAim() {
    if (isMobileControlsEnabled()) {
      const target = getActiveAutoTarget();
      if (target) {
        const preservedTargetId = mobileAutoTargetId(target);
        facePoint(target.x, target.z);
        const fired = shootAtPoint(target.x, target.z);
        restoreMobileAutoTargetAfterAttack(target, preservedTargetId);
        return fired;
      }
      const f = { x: Math.sin(player.angle), z: Math.cos(player.angle) };
      shootAtPoint(player.x + f.x * 18, player.z + f.z * 18);
      return;
    }
    refreshPointerWorldFromLastScreen();
    let tx, tz;
    if (pointerHasWorld) {
      tx = pointerWorld.x;
      tz = pointerWorld.z;
    } else {
      const f = getAimForwardWorld();
      tx = player.x + f.x * 18;
      tz = player.z + f.z * 18;
    }
    shootAtPoint(tx, tz);
  }

  function isMobileGamePanelOpen() {
    const lootWin = document.getElementById('loot-window');
    const traderWin = document.getElementById('trader-window');
    const playerActionWin = document.getElementById('player-action-window');
    const characterScreen = document.getElementById('character-screen');
    const settingsPanel = document.getElementById('game-settings-panel');
    const tutorialPanel = document.getElementById('tutorial-window');
    const confirmPanel = document.getElementById('game-confirm-panel');
    const playerActionOpen = !!(playerActionWin && playerActionWin.style.display === 'block');
    const confirmOpen = !!(confirmPanel && confirmPanel.classList.contains('visible') && confirmPanel.style.display !== 'none');
    const modalOpen = !!((lootWin && lootWin.style.display === 'block') || (traderWin && traderWin.style.display === 'block') || storageWindowOpen || playerActionOpen || confirmOpen);
    const normalOpen = Object.values(uiWindows || {}).some(w => w && w.classList.contains('visible'));
    const characterOpen = !!(characterScreen && characterScreen.classList.contains('visible'));
    const overlayOpen = !!((settingsPanel && settingsPanel.classList.contains('visible')) || (tutorialPanel && tutorialPanel.classList.contains('visible')));
    return modalOpen || normalOpen || characterOpen || overlayOpen;
  }

  function updateMobilePanelState() {
    const lootWin = document.getElementById('loot-window');
    const playerActionWin = document.getElementById('player-action-window');
    const characterScreen = document.getElementById('character-screen');
    const settingsPanel = document.getElementById('game-settings-panel');
    const tutorialPanel = document.getElementById('tutorial-window');
    const confirmPanel = document.getElementById('game-confirm-panel');
    const lootOpen = !!(lootWin && lootWin.style.display === 'block');
    const playerActionOpen = !!(playerActionWin && playerActionWin.style.display === 'block');
    const confirmOpen = !!(confirmPanel && confirmPanel.classList.contains('visible') && confirmPanel.style.display !== 'none');
    const normalOpen = Object.values(uiWindows || {}).some(w => w && w.classList.contains('visible'));
    const characterOpen = !!(characterScreen && characterScreen.classList.contains('visible'));
    const overlayOpen = !!((settingsPanel && settingsPanel.classList.contains('visible')) || (tutorialPanel && tutorialPanel.classList.contains('visible')));
    const blockingMobilePanelOpen = !!(lootOpen || traderWindowOpen || storageWindowOpen || confirmOpen || normalOpen || characterOpen || overlayOpen);
    const open = !!blockingMobilePanelOpen;
    document.body.classList.toggle('loot-window-open', lootOpen);
    document.body.classList.toggle('trader-window-open', !!traderWindowOpen);
    document.body.classList.toggle('storage-window-open', !!storageWindowOpen);
    // Меню лечения игрока — плавающая карточка поверх игры. Оно не должно включать
    // body-классы, которые переставляют HUD, скрывают журнал/миникарту или меняют touch-кнопки.
    document.body.classList.remove('player-action-window-open');
    document.body.classList.toggle('mobile-ui-panel-open', isMobileControlsEnabled() && blockingMobilePanelOpen);
    document.body.classList.toggle('game-ui-panel-open', open);
    syncMobileCrouchButton();
  }

  let appFullscreenWanted = false;

  async function requestGameFullscreen() {
    const root = document.documentElement;
    const gameRoot = document.getElementById('game-container') || root;
    try {
      if (document.fullscreenElement || document.body.classList.contains('app-fullscreen')) {
        appFullscreenWanted = false;
        document.body.classList.remove('app-fullscreen');
        if (document.fullscreenElement) await document.exitFullscreen();
      } else {
        appFullscreenWanted = true;
        document.body.classList.add('app-fullscreen');
        if (gameRoot.requestFullscreen) {
          await gameRoot.requestFullscreen({ navigationUI: 'hide' });
          if (deviceInfo.type === 'mobile' && screen.orientation && screen.orientation.lock) {
            try { await screen.orientation.lock('landscape'); } catch (_) {}
          }
        } else {
          setReadout('Включён внутренний полноэкранный режим игры.');
        }
      }
    } catch (err) {
      document.body.classList.add('app-fullscreen');
      setReadout('Браузер не разрешил настоящий fullscreen. Включён внутренний полноэкранный режим игры.');
    }
    syncFullscreenClass();
    setTimeout(resize, 120);
  }

  function syncFullscreenClass() {
    if (!document.fullscreenElement && appFullscreenWanted) document.body.classList.add('app-fullscreen');
    document.body.classList.toggle('fullscreen-active', !!document.fullscreenElement || document.body.classList.contains('app-fullscreen'));
    setTimeout(resize, 80);
  }

  function initFullscreenButtons() {
    ['mobile-fullscreen-btn', 'global-fullscreen-btn', 'landscape-fullscreen-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.boundFullscreen === '1') return;
      btn.dataset.boundFullscreen = '1';
      const handler = e => { e.preventDefault(); e.stopPropagation(); requestGameFullscreen(); };
      btn.addEventListener('pointerdown', handler);
      btn.addEventListener('click', handler);
    });
    if (!document.body.dataset.fullscreenListenerBound) {
      document.body.dataset.fullscreenListenerBound = '1';
      document.addEventListener('fullscreenchange', () => {
        syncFullscreenClass();
        setTimeout(resize, 120);
        setTimeout(resize, 360);
      });
    }
    syncFullscreenClass();
  }

  function initWindowCloseButtons() {
    document.querySelectorAll('.window-panel').forEach(win => {
      // У окна графики уже есть один рабочий крестик #graphics-close.
      // Не добавляем второй автокрестик ни на ПК, ни на мобильном.
      if (win.id === 'graphics-window' || win.querySelector('#graphics-close') || win.querySelector('.window-close-btn')) return;
      if (win.querySelector('.mobile-window-close') || win.querySelector('[data-close-window]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-window-close';
      btn.textContent = '×';
      btn.setAttribute('aria-label', 'Закрыть окно');
      const close = e => {
        e.preventDefault();
        e.stopPropagation();
        win.classList.remove('visible');
        hideTooltip();
        if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      };
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener('click', close);
      win.appendChild(btn);
    });
  }


  function syncMobileOrientationState() {
    if (deviceInfo.type !== 'mobile') return;
    const w = window.innerWidth || 0;
    const h = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
    const landscape = w >= h;
    document.body.classList.toggle('landscape-mode', landscape);
    const lock = document.getElementById('mobile-landscape-lock');
    if (lock) lock.setAttribute('aria-hidden', landscape ? 'true' : 'false');
    if (!landscape) {
      // Окно действий игрока не должно всплывать при первом входе в портретном режиме.
      if (typeof closePlayerActionWindow === 'function') closePlayerActionWindow(false);
      if (typeof closeMobilePlayerTreatmentMenu === 'function') closeMobilePlayerTreatmentMenu(false);
      if (typeof hideWorldContextMenu === 'function') hideWorldContextMenu();
      document.body.classList.remove('player-action-window-open');
      document.body.classList.remove('game-ui-panel-open');
      updateMobilePanelState();
    }
  }

  function updateMobileChatLine(text) {
    const el = document.getElementById('mobile-chat-line');
    if (el && text) el.textContent = String(text).slice(0, 120);
  }


  function toggleGameMenu(force) {
    const panel = document.getElementById('game-settings-panel');
    if (!panel) return;
    const visible = typeof force === 'boolean' ? force : !panel.classList.contains('visible');
    panel.classList.toggle('visible', visible);
    if (visible) closeTutorialWindow(false);
    updateMobilePanelState();
  }

  function closeGameMenu(update = true) {
    const panel = document.getElementById('game-settings-panel');
    if (panel) panel.classList.remove('visible');
    if (update) updateMobilePanelState();
  }

  function openTutorialWindow() {
    closeGameMenu(false);
    const panel = document.getElementById('tutorial-window');
    if (panel) panel.classList.add('visible');
    updateMobilePanelState();
  }

  function closeTutorialWindow(update = true) {
    const panel = document.getElementById('tutorial-window');
    if (panel) panel.classList.remove('visible');
    if (update) updateMobilePanelState();
  }

  async function switchCharacterFromMenu() {
    closeGameMenu(false);
    closeTutorialWindow(false);
    if (!await confirmClientSaveBeforeContextTransition('switch')) {
      updateMobilePanelState();
      return false;
    }
    if (typeof invalidateMultiplayerSessionContext === 'function') {
      invalidateMultiplayerSessionContext('character-switch', { disconnect: true, clearWorld: true });
    } else {
      if (multiplayer.socket) { try { multiplayer.socket.disconnect(); } catch (_) {} multiplayer.socket = null; }
      multiplayer.joined = false;
      multiplayer.characterLeaseId = '';
    }
    advanceClientSaveContextEpoch();
    activeCharacterLeaseId = '';
    clearRemotePlayers();
    gameStarted = false;
    characterProfile = null;
    clientContextTransitionInFlight = false;
    saveDirty = false;
    saveTimer = 0;
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.add('visible');
    if (serverSession.token) {
      await showCharacterSelect('Выберите персонажа. Текущий прогресс синхронизирован.');
    }
    else setAuthStep('login');
    updateMobilePanelState();
    return true;
  }
