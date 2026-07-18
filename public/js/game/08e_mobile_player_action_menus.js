  function getMobilePlayerTreatmentRoot() {
    const fullscreenRoot = document.fullscreenElement;
    if (fullscreenRoot && fullscreenRoot.isConnected) return fullscreenRoot;
    const gameContainer = document.getElementById('game-container');
    return gameContainer || document.body;
  }

  function applyImportantStyle(el, name, value) {
    if (!el?.style) return;
    el.style.setProperty(name, value, 'important');
  }

  function stopMobileTreatmentMenuEvent(e, prevent = false) {
    if (!e) return;
    if (prevent && e.cancelable !== false) e.preventDefault?.();
    e.stopPropagation?.();
    e.stopImmediatePropagation?.();
  }

  function ensureMobilePlayerTreatmentLayer() {
    let layer = document.getElementById('mobile-player-treatment-layer');
    const root = getMobilePlayerTreatmentRoot();
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'mobile-player-treatment-layer';
    }
    if (layer.parentElement !== root) root.appendChild(layer);
    if (layer.dataset.boundTreatmentLayer !== '1') {
      layer.dataset.boundTreatmentLayer = '1';
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click'].forEach(type => {
        layer.addEventListener(type, e => {
          // Пока открыто меню лечения, слой гасит любые касания, чтобы они не уходили
          // в touch-зоны, canvas, быстрые слоты или старые обработчики окон.
          // События внутри самой карточки при этом сначала доходят до кнопок меню.
          const insideMenu = !!(e.target && e.target.closest && e.target.closest('#mobile-player-treatment-menu'));
          stopMobileTreatmentMenuEvent(e, !insideMenu);
        }, { passive: false });
      });
    }
    applyImportantStyle(layer, 'position', 'fixed');
    applyImportantStyle(layer, 'left', '0');
    applyImportantStyle(layer, 'top', '0');
    applyImportantStyle(layer, 'right', '0');
    applyImportantStyle(layer, 'bottom', '0');
    applyImportantStyle(layer, 'width', '100vw');
    applyImportantStyle(layer, 'height', 'var(--app-height, 100dvh)');
    applyImportantStyle(layer, 'z-index', '2147483600');
    applyImportantStyle(layer, 'pointer-events', 'none');
    applyImportantStyle(layer, 'visibility', 'visible');
    applyImportantStyle(layer, 'opacity', '1');
    applyImportantStyle(layer, 'transform', 'none');
    applyImportantStyle(layer, 'overflow', 'visible');
    return layer;
  }

  function ensureMobilePlayerTreatmentMenu() {
    const layer = ensureMobilePlayerTreatmentLayer();
    let win = document.getElementById('mobile-player-treatment-menu');
    if (!win) {
      win = document.createElement('div');
      win.id = 'mobile-player-treatment-menu';
      win.className = 'mobile-player-treatment-menu';
      win.innerHTML = `
        <div class="mobile-player-treatment-titlebar"><span id="mobile-player-treatment-title">Игрок</span><button id="mobile-player-treatment-close" type="button" aria-label="Закрыть социальное меню">×</button></div>
        <div id="mobile-player-treatment-status" class="player-action-status"></div>
        <div id="mobile-player-treatment-grid" class="player-action-grid"></div>
      `;
      const stop = e => { stopMobileTreatmentMenuEvent(e, false); };
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click'].forEach(type => {
        win.addEventListener(type, stop, { passive: false });
      });
      const closeBtn = win.querySelector('#mobile-player-treatment-close');
      if (closeBtn && closeBtn.dataset.boundTreatmentClose !== '1') {
        closeBtn.dataset.boundTreatmentClose = '1';
        let lastCloseTapAt = 0;
        const closeFromButton = e => {
          stopMobileTreatmentMenuEvent(e, true);
          const now = performance.now();
          if (now - lastCloseTapAt < 220) return;
          lastCloseTapAt = now;
          closeMobilePlayerTreatmentMenu(true, true);
        };
        closeBtn.addEventListener('pointerdown', e => stopMobileTreatmentMenuEvent(e, true), { passive: false });
        closeBtn.addEventListener('pointerup', closeFromButton, { passive: false });
        closeBtn.addEventListener('touchend', closeFromButton, { passive: false });
        closeBtn.addEventListener('click', closeFromButton);
      }
    }
    if (win.parentElement !== layer) layer.appendChild(win);
    return win;
  }

  function placeMobilePlayerTreatmentMenu(win) {
    if (!win) return;
    const layer = ensureMobilePlayerTreatmentLayer();
    if (win.parentElement !== layer) layer.appendChild(win);
    const vv = window.visualViewport || null;
    const viewportW = Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportH = Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || 1);
    const offsetLeft = Number(vv?.offsetLeft || 0);
    const offsetTop = Number(vv?.offsetTop || 0);
    const pad = 10;
    const centerX = offsetLeft + viewportW * 0.5;
    const centerY = offsetTop + viewportH * 0.5;

    layer.classList.add('treatment-open');
    applyImportantStyle(layer, 'display', 'block');
    applyImportantStyle(layer, 'visibility', 'visible');
    applyImportantStyle(layer, 'opacity', '1');
    applyImportantStyle(layer, 'pointer-events', 'all');

    applyImportantStyle(win, 'display', 'block');
    applyImportantStyle(win, 'position', 'fixed');
    applyImportantStyle(win, 'left', `${Math.round(centerX)}px`);
    applyImportantStyle(win, 'top', `${Math.round(centerY)}px`);
    applyImportantStyle(win, 'right', 'auto');
    applyImportantStyle(win, 'bottom', 'auto');
    applyImportantStyle(win, 'transform', 'translate(-50%, -50%)');
    applyImportantStyle(win, 'z-index', '2147483647');
    applyImportantStyle(win, 'visibility', 'visible');
    applyImportantStyle(win, 'opacity', '1');
    applyImportantStyle(win, 'pointer-events', 'all');
    applyImportantStyle(win, 'box-sizing', 'border-box');
    applyImportantStyle(win, 'width', `min(420px, calc(${Math.floor(viewportW)}px - ${pad * 2}px))`);
    applyImportantStyle(win, 'max-width', `calc(${Math.floor(viewportW)}px - ${pad * 2}px)`);
    applyImportantStyle(win, 'max-height', `calc(${Math.floor(viewportH)}px - ${pad * 2}px)`);
    applyImportantStyle(win, 'overflow', 'auto');
    applyImportantStyle(win, 'padding', '12px');
    applyImportantStyle(win, 'border-radius', '12px');
    applyImportantStyle(win, 'border', '1px solid rgba(214, 176, 94, 0.78)');
    applyImportantStyle(win, 'background', 'rgba(13, 16, 16, 0.98)');
    applyImportantStyle(win, 'color', '#e7d5ae');
    applyImportantStyle(win, 'box-shadow', '0 20px 58px rgba(0,0,0,0.82), inset 0 0 0 1px rgba(255,255,255,0.05)');
    applyImportantStyle(win, 'font-family', '"Segoe UI", Arial, sans-serif');
    applyImportantStyle(win, 'touch-action', 'manipulation');

    const titlebar = win.querySelector('.mobile-player-treatment-titlebar');
    if (titlebar) {
      applyImportantStyle(titlebar, 'display', 'flex');
      applyImportantStyle(titlebar, 'align-items', 'center');
      applyImportantStyle(titlebar, 'justify-content', 'space-between');
      applyImportantStyle(titlebar, 'gap', '10px');
      applyImportantStyle(titlebar, 'margin-bottom', '10px');
      applyImportantStyle(titlebar, 'color', '#f0d28a');
      applyImportantStyle(titlebar, 'font-size', '12px');
      applyImportantStyle(titlebar, 'font-weight', '900');
      applyImportantStyle(titlebar, 'letter-spacing', '1.2px');
      applyImportantStyle(titlebar, 'text-transform', 'uppercase');
    }
    const close = win.querySelector('#mobile-player-treatment-close');
    if (close) {
      applyImportantStyle(close, 'min-width', '34px');
      applyImportantStyle(close, 'min-height', '34px');
      applyImportantStyle(close, 'border-radius', '9px');
      applyImportantStyle(close, 'border', '1px solid rgba(214,176,94,0.58)');
      applyImportantStyle(close, 'background', 'rgba(34,26,17,0.96)');
      applyImportantStyle(close, 'color', '#f0d28a');
      applyImportantStyle(close, 'font-size', '22px');
      applyImportantStyle(close, 'font-weight', '900');
    }
    const status = win.querySelector('#mobile-player-treatment-status');
    if (status) {
      applyImportantStyle(status, 'margin', '0 0 10px');
      applyImportantStyle(status, 'padding', '8px 9px');
      applyImportantStyle(status, 'border', '1px solid rgba(174,139,72,0.34)');
      applyImportantStyle(status, 'border-radius', '8px');
      applyImportantStyle(status, 'background', 'rgba(0,0,0,0.22)');
      applyImportantStyle(status, 'color', '#aeba92');
      applyImportantStyle(status, 'font-size', '12px');
      applyImportantStyle(status, 'line-height', '1.35');
    }
    const grid = win.querySelector('#mobile-player-treatment-grid');
    if (grid) {
      applyImportantStyle(grid, 'display', 'grid');
      applyImportantStyle(grid, 'grid-template-columns', '1fr');
      applyImportantStyle(grid, 'gap', '7px');
      applyImportantStyle(grid, 'max-height', `calc(${Math.floor(viewportH)}px - 150px)`);
      applyImportantStyle(grid, 'overflow', 'auto');
    }

    requestAnimationFrame(() => {
      if (!win.classList.contains('visible') || win.style.display === 'none') return;
      const rect = win.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      let dx = 0;
      let dy = 0;
      const minX = offsetLeft + pad;
      const minY = offsetTop + pad;
      const maxX = offsetLeft + viewportW - pad;
      const maxY = offsetTop + viewportH - pad;
      if (rect.left < minX) dx = minX - rect.left;
      else if (rect.right > maxX) dx = maxX - rect.right;
      if (rect.top < minY) dy = minY - rect.top;
      else if (rect.bottom > maxY) dy = maxY - rect.bottom;
      if (dx || dy) {
        const currentLeft = parseFloat(win.style.left) || centerX;
        const currentTop = parseFloat(win.style.top) || centerY;
        applyImportantStyle(win, 'left', `${Math.round(currentLeft + dx)}px`);
        applyImportantStyle(win, 'top', `${Math.round(currentTop + dy)}px`);
      }
    });
  }

  function closeMobilePlayerTreatmentMenu(updateState = true, forceClose = false) {
    const win = document.getElementById('mobile-player-treatment-menu');
    const open = !!(win && win.classList.contains('visible') && win.style.display !== 'none');
    // На телефоне меню лечения закрывается только крестиком. Фоновые тапы,
    // canvas/touch-зоны, обновление дистанции и общие closeAllWindows не должны
    // случайно убирать карточку и мешать нажатию медицинских кнопок.
    if (open && isMobileControlsEnabled() && !forceClose) return false;
    if (win) {
      applyImportantStyle(win, 'display', 'none');
      win.classList.remove('visible');
      win.setAttribute('aria-hidden', 'true');
    }
    const layer = document.getElementById('mobile-player-treatment-layer');
    if (layer) {
      layer.classList.remove('treatment-open');
      applyImportantStyle(layer, 'display', 'none');
      applyImportantStyle(layer, 'pointer-events', 'none');
    }
    if (updateState) {
      activeWorldContextTarget = null;
      clearWorldContextDistanceWatch();
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    }
    return true;
  }

  function isMobilePlayerTreatmentMenuAllowedNow() {
    if (!isMobileControlsEnabled() || !gameStarted || paused || hudEditMode || isProgressionWindowOpen()) return false;
    if (!characterProfile) return false;

    const characterScreen = document.getElementById('character-screen');
    if (characterScreen) {
      const screenVisible = characterScreen.classList.contains('visible') && getComputedStyle(characterScreen).display !== 'none' && getComputedStyle(characterScreen).visibility !== 'hidden';
      if (screenVisible) return false;
    }

    // Для тестовой версии не полагаемся на aria-hidden у экрана поворота: на части мобильных браузеров
    // этот атрибут может не успеть обновиться. Достаточно фактической ориентации окна.
    if (deviceInfo.type === 'mobile') {
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      const h = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : (window.innerHeight || document.documentElement.clientHeight || 0);
      if (w < h) return false;
    }

    return true;
  }

  function refreshOpenMobilePlayerTreatmentMenu(row) {
    const win = document.getElementById('mobile-player-treatment-menu');
    const open = !!(win && win.classList.contains('visible') && win.style.display !== 'none');
    if (!open || !row?.data?.id) return false;
    if (activeWorldContextTarget?.type === 'remotePlayer' && activeWorldContextTarget.row?.data?.id !== row.data.id) return false;
    renderMobilePlayerTreatmentMenu(row);
    placeMobilePlayerTreatmentMenu(ensureMobilePlayerTreatmentMenu());
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function renderMobilePlayerTreatmentMenu(row) {
    const win = ensureMobilePlayerTreatmentMenu();
    const title = win.querySelector('#mobile-player-treatment-title');
    const status = win.querySelector('#mobile-player-treatment-status');
    const grid = win.querySelector('#mobile-player-treatment-grid');
    if (!row?.data?.id || !title || !status || !grid) return false;
    title.textContent = row.data.name || 'Игрок';
    status.innerHTML = `
      <div><b>Социальное меню</b></div>
      <div>Выберите действие для взаимодействия с игроком.</div>
    `;
    grid.innerHTML = '';
    const target = { type: 'remotePlayer', row, title: row.data?.name || 'Игрок' };
    buildRemotePlayerContextOptions(row).filter(Boolean).forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'player-action-btn' + (opt.disabled ? ' disabled' : '');
      btn.disabled = !!opt.disabled;
      applyImportantStyle(btn, 'width', '100%');
      applyImportantStyle(btn, 'min-height', '44px');
      applyImportantStyle(btn, 'display', 'flex');
      applyImportantStyle(btn, 'flex-direction', 'column');
      applyImportantStyle(btn, 'align-items', 'flex-start');
      applyImportantStyle(btn, 'justify-content', 'center');
      applyImportantStyle(btn, 'gap', '2px');
      applyImportantStyle(btn, 'padding', '8px 10px');
      applyImportantStyle(btn, 'border-radius', '8px');
      applyImportantStyle(btn, 'border', '1px solid rgba(214,176,94,0.38)');
      applyImportantStyle(btn, 'background', opt.disabled ? 'rgba(32,32,28,0.48)' : 'rgba(45,37,22,0.86)');
      applyImportantStyle(btn, 'color', '#f0d28a');
      applyImportantStyle(btn, 'text-align', 'left');
      applyImportantStyle(btn, 'white-space', 'normal');
      applyImportantStyle(btn, 'opacity', opt.disabled ? '0.52' : '1');
      applyImportantStyle(btn, 'touch-action', 'manipulation');
      const label = document.createElement('span');
      label.className = 'player-action-label';
      label.textContent = opt.label;
      applyImportantStyle(label, 'color', '#f0d28a');
      applyImportantStyle(label, 'font-weight', '800');
      applyImportantStyle(label, 'font-size', '12px');
      btn.appendChild(label);
      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'player-action-hint';
        hint.textContent = opt.hint;
        applyImportantStyle(hint, 'color', '#9aa787');
        applyImportantStyle(hint, 'font-size', '10px');
        applyImportantStyle(hint, 'line-height', '1.2');
        btn.appendChild(hint);
      }
      let lastTreatmentButtonActionAt = 0;
      let treatmentButtonPointer = null;
      const runTreatmentButtonAction = e => {
        stopMobileTreatmentMenuEvent(e, true);
        const now = performance.now();
        if (now - lastTreatmentButtonActionAt < 260) return;
        lastTreatmentButtonActionAt = now;
        if (opt.disabled) {
          setReadout(opt.hint || 'Действие недоступно.');
          return;
        }
        if (!isWorldContextTargetInRange(target)) {
          setReadout('Вы отошли слишком далеко для взаимодействия.');
          refreshOpenMobilePlayerTreatmentMenu(row);
          if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
          return;
        }
        try { opt.action?.(); } catch (err) { console.error(err); setReadout('Действие не выполнено.'); }
        // Не закрываем карточку сразу после нажатия: на телефоне игрок должен видеть результат
        // и иметь возможность нажать другую медицинскую кнопку. Состояние обновится после ack сервера,
        // а локально сразу обновляем счётчики предметов.
        refreshOpenMobilePlayerTreatmentMenu(row);
        if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      };
      btn.addEventListener('pointerdown', e => {
        stopMobileTreatmentMenuEvent(e, true);
        treatmentButtonPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }, { passive: false });
      btn.addEventListener('pointermove', e => {
        stopMobileTreatmentMenuEvent(e, true);
        if (treatmentButtonPointer && treatmentButtonPointer.id === e.pointerId && Math.hypot(e.clientX - treatmentButtonPointer.x, e.clientY - treatmentButtonPointer.y) > 14) treatmentButtonPointer.moved = true;
      }, { passive: false });
      btn.addEventListener('pointerup', e => {
        const state = treatmentButtonPointer;
        treatmentButtonPointer = null;
        if (!state || state.id !== e.pointerId || state.moved) { stopMobileTreatmentMenuEvent(e, true); return; }
        runTreatmentButtonAction(e);
      }, { passive: false });
      btn.addEventListener('pointercancel', e => { stopMobileTreatmentMenuEvent(e, true); treatmentButtonPointer = null; }, { passive: false });
      btn.addEventListener('touchend', e => runTreatmentButtonAction(e), { passive: false });
      btn.addEventListener('click', e => runTreatmentButtonAction(e));
      grid.appendChild(btn);
    });
    return true;
  }

  function openMobilePlayerTreatmentMenu(row, opts = {}) {
    if (!row?.data?.id) return false;
    if (!isMobilePlayerTreatmentMenuAllowedNow()) {
      closeMobilePlayerTreatmentMenu(false, true);
      return false;
    }
    const target = mobileRemotePlayerActionTarget(row);
    const ignoreDistance = !!(opts.ignoreDistance || opts.autoTest);
    if (!ignoreDistance && !isWorldContextTargetInRange(target)) {
      if (!opts.silent) setReadout('Нужно подойти ближе к игроку.');
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      return false;
    }
    Object.values(uiWindows).forEach(w => { if (w) w.classList.remove('visible'); });
    if (typeof closeStorageWindow === 'function') closeStorageWindow();
    if (typeof closeTraderWindow === 'function' && traderWindowOpen) closeTraderWindow();
    if (typeof closePlayerActionWindow === 'function') closePlayerActionWindow(false);
    closeQuantityPanel();
    hideItemContextMenu();
    hideWorldContextMenu();
    hideTooltip();
    hideTargetHint();
    stopAutoFire();
    stopTouchAim();
    clearWorldContextDistanceWatch();
    activeWorldContextTarget = target;
    setSelectedMobileRemotePlayer(row);
    if (!renderMobilePlayerTreatmentMenu(row)) return false;
    const win = ensureMobilePlayerTreatmentMenu();
    win.classList.add('visible');
    win.removeAttribute('aria-hidden');
    placeMobilePlayerTreatmentMenu(win);
    lastMobilePlayerContextOpenAt = performance.now();
    if (!ignoreDistance) startWorldContextDistanceWatch();
    syncProgressionWindowState();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    placeMobilePlayerTreatmentMenu(win);
    return true;
  }

  function ensurePlayerActionWindow() {
    let win = document.getElementById('player-action-window');
    if (win) return win;
    win = document.createElement('div');
    win.id = 'player-action-window';
    // Это компактное меню игрока, а не полноэкранная modal-panel.
    // Класс modal-panel ломал мобильную раскладку HUD через общие CSS-правила.
    win.className = 'ui-panel player-action-window';
    win.style.display = 'none';
    win.innerHTML = `
      <div class="panel-title player-action-titlebar"><span id="player-action-title">Игрок</span><button id="player-action-close" class="ui-btn modal-close-x" aria-label="Закрыть меню игрока">×</button></div>
      <div id="player-action-status" class="player-action-status"></div>
      <div id="player-action-grid" class="player-action-grid"></div>
    `;
    document.body.appendChild(win);
    win.addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
    win.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    win.querySelector('#player-action-close')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closePlayerActionWindow();
    });
    return win;
  }

  function placePlayerActionWindowInViewport(win) {
    if (!win) return;
    const vv = window.visualViewport || null;
    const viewportW = Math.max(1, vv?.width || window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportH = Math.max(1, vv?.height || window.innerHeight || document.documentElement.clientHeight || 1);
    const offsetLeft = Number(vv?.offsetLeft || 0);
    const offsetTop = Number(vv?.offsetTop || 0);
    const centerX = offsetLeft + viewportW * 0.5;
    const centerY = offsetTop + viewportH * 0.5;
    win.style.position = 'fixed';
    win.style.left = `${Math.round(centerX)}px`;
    win.style.top = `${Math.round(centerY)}px`;
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    win.style.transform = 'translate(-50%, -50%)';
    win.style.zIndex = '2147482500';
    win.style.visibility = 'visible';
    win.style.opacity = '1';
    win.style.pointerEvents = 'all';
    win.style.maxWidth = `calc(${Math.floor(viewportW)}px - 16px)`;
    win.style.maxHeight = `calc(${Math.floor(viewportH)}px - 16px)`;
    win.style.overflow = 'auto';

    requestAnimationFrame(() => {
      if (!win.classList.contains('visible') || win.style.display === 'none') return;
      const rect = win.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pad = 8;
      const minX = offsetLeft + pad;
      const minY = offsetTop + pad;
      const maxX = offsetLeft + viewportW - pad;
      const maxY = offsetTop + viewportH - pad;
      let dx = 0;
      let dy = 0;
      if (rect.left < minX) dx = minX - rect.left;
      else if (rect.right > maxX) dx = maxX - rect.right;
      if (rect.top < minY) dy = minY - rect.top;
      else if (rect.bottom > maxY) dy = maxY - rect.bottom;
      if (dx || dy) {
        const currentLeft = parseFloat(win.style.left) || centerX;
        const currentTop = parseFloat(win.style.top) || centerY;
        win.style.left = `${Math.round(currentLeft + dx)}px`;
        win.style.top = `${Math.round(currentTop + dy)}px`;
      }
    });
  }

  function closePlayerActionWindow(updateState = true) {
    const win = document.getElementById('player-action-window');
    if (win) {
      win.style.display = 'none';
      win.classList.remove('visible');
    }
    document.body.classList.remove('player-action-window-open');
    if (updateState && typeof updateMobilePanelState === 'function') updateMobilePanelState();
    if (updateState) {
      activeWorldContextTarget = null;
      clearWorldContextDistanceWatch();
    }
  }

  function renderPlayerActionWindow(row) {
    const win = ensurePlayerActionWindow();
    const title = win.querySelector('#player-action-title');
    const status = win.querySelector('#player-action-status');
    const grid = win.querySelector('#player-action-grid');
    if (!row?.data?.id || !title || !status || !grid) return false;
    title.textContent = row.data.name || 'Игрок';
    status.innerHTML = `
      <div><b>Социальное меню</b></div>
      <div>Выберите действие для взаимодействия с игроком.</div>
    `;
    grid.innerHTML = '';
    const target = { type: 'remotePlayer', row, title: row.data?.name || 'Игрок' };
    const options = buildRemotePlayerContextOptions(row).filter(Boolean);
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-btn player-action-btn' + (opt.disabled ? ' disabled' : '');
      btn.disabled = !!opt.disabled;
      const label = document.createElement('span');
      label.className = 'player-action-label';
      label.textContent = opt.label;
      btn.appendChild(label);
      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'player-action-hint';
        hint.textContent = opt.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (opt.disabled) return;
        if (!isWorldContextTargetInRange(target)) {
          closePlayerActionWindow(false);
          setReadout('Вы отошли слишком далеко для взаимодействия.');
          if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
          return;
        }
        closePlayerActionWindow(false);
        try { opt.action?.(); } catch (err) { console.error(err); setReadout('Действие не выполнено.'); }
        if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      });
      grid.appendChild(btn);
    });
    return true;
  }

  function openRemotePlayerActionWindow(row, opts = {}) {
    if (!row?.data?.id) return false;
    if (isMobileControlsEnabled()) return openMobilePlayerTreatmentMenu(row, opts);
    const target = mobileRemotePlayerActionTarget(row);
    if (!isWorldContextTargetInRange(target)) {
      closePlayerActionWindow(false);
      if (!opts.silent) setReadout('Нужно подойти ближе к игроку.');
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      return false;
    }
    closeAllWindows(false);
    hideWorldContextMenu();
    stopAutoFire();
    stopTouchAim();
    hideTargetHint();
    activeWorldContextTarget = target;
    setSelectedMobileRemotePlayer(row);
    if (!renderPlayerActionWindow(row)) return false;
    const win = ensurePlayerActionWindow();
    win.style.display = 'block';
    win.classList.add('visible');
    placePlayerActionWindowInViewport(win);
    document.body.classList.remove('player-action-window-open');
    document.body.classList.remove('mobile-ui-panel-open');
    startWorldContextDistanceWatch();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    // После updateMobilePanelState ещё раз принудительно держим карточку в видимой части экрана.
    placePlayerActionWindowInViewport(win);
    return true;
  }

  function nearestRemotePlayerForContext(maxDist = REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE) {
    let best = null;
    let bestDist = maxDist;
    multiplayer.remotePlayers.forEach(row => {
      if (!row?.group || row.group.visible === false || !row.data?.id) return;
      const x = row.group.position?.x ?? Number(row.data.x || 0);
      const z = row.group.position?.z ?? Number(row.data.z || 0);
      const d = contextDistanceTo(x, z);
      if (d <= bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function nearestEncounterActorForContext(maxDist = WORLD_CONTEXT_INTERACT_DISTANCE) {
    if (!Array.isArray(enemies)) return null;
    let best = null;
    let bestDist = maxDist;
    enemies.forEach(actor => {
      if (!actor || actor.dead || actor._removed) return;
      if (!actor.encounterRole && actor.faction !== 'caravan' && actor.faction !== 'klim_patrol') return;
      const d = contextDistanceTo(actor.x, actor.z);
      if (d <= bestDist) { best = actor; bestDist = d; }
    });
    return best;
  }

  function buildMobileWorldContextTarget() {
    const candidates = [];
    const addCandidate = (target, priority = 10) => {
      if (!target) return;
      const point = worldContextTargetPoint(target);
      if (!point) return;
      const dist = contextDistanceTo(point.x, point.z);
      if (dist <= worldContextTargetMaxDistance(target)) candidates.push({ target, dist, priority });
    };

    const remote = nearestRemotePlayerForContext();
    if (remote) addCandidate({ type: 'remotePlayer', row: remote, title: remote.data?.name || 'Игрок' }, 1);

    const encounterActor = nearestEncounterActorForContext(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (encounterActor) addCandidate({ type: 'enemy', enemy: encounterActor, title: encounterActor.name || 'Встреча' }, 2);

    const trader = findNearbyTrader(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (trader && !trader.encounterRole) addCandidate({ type: 'trader', trader, title: trader.name || 'Торговец' }, 3);

    const storage = findNearbyStorage(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (storage) addCandidate({ type: 'storage', storage, title: storage.name || 'Хранилище' }, 4);

    const jobBoard = findNearbyJobBoard(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (jobBoard) addCandidate({ type: 'jobBoard', board: jobBoard, title: jobBoard.name || 'Доска заданий' }, 4.5);

    const craftingStation = findNearbyCraftingStation(CRAFTING_STATION_INTERACT_DISTANCE);
    if (craftingStation) addCandidate({ type: 'craftingStation', station: craftingStation, title: craftingStation.name || '\u0420\u0430\u0431\u043e\u0447\u0438\u0439 \u0441\u0442\u0430\u043d\u043e\u043a' }, 4.6);

    const corpse = findNearestCorpse(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (corpse) addCandidate({ type: 'corpse', enemy: corpse, title: `Труп: ${corpse.name}` }, 5);

    const container = findNearestWorldContainer(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (container) addCandidate({ type: 'worldContainer', container, title: container.name || 'Ящик' }, 6);

    const groundItem = findNearestGroundItem(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (groundItem) {
      const item = ITEMS[groundItem.itemId];
      addCandidate({ type: 'groundItem', groundItem, title: item ? item.name : 'Предмет' }, 7);
    }

    const res = findNearestResource(WORLD_CONTEXT_INTERACT_DISTANCE);
    if (res) addCandidate({ type: 'resource', resource: res, title: interactionResourceDef(res).title }, 8);

    if (typeof getActiveAutoTarget === 'function') {
      const enemy = getActiveAutoTarget();
      if (enemy && contextDistanceTo(enemy.x, enemy.z) <= WORLD_CONTEXT_INTERACT_DISTANCE) {
        addCandidate({ type: 'enemy', enemy, title: enemy.name || 'Враг' }, 9);
      }
    }

    candidates.sort((a, b) => a.dist - b.dist || a.priority - b.priority);
    return candidates[0]?.target || null;
  }

  function showMobileInteractionContextMenuFromButton(buttonEl, opts = {}) {
    if (!gameStarted || paused || hudEditMode || isProgressionWindowOpen()) return false;
    if (isMobileControlsEnabled() && !isMobilePlayerTreatmentMenuAllowedNow()) return false;
    if (anyWindowOpen()) return false;
    stopAutoFire();
    stopTouchAim();
    hideTargetHint();

    const selectedRow = getSelectedMobileRemotePlayer();
    if (selectedRow) {
      const target = mobileRemotePlayerActionTarget(selectedRow);
      if (isWorldContextTargetInRange(target)) return openRemotePlayerActionWindow(selectedRow, opts);
      // Выбранный ранее игрок мог отойти. Не блокируем кнопку взаимодействия:
      // сбрасываем старый выбор и ниже пробуем открыть меню ближайшего игрока/объекта.
      clearSelectedMobileRemotePlayer(selectedRow);
      closePlayerActionWindow(false);
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    }

    const target = buildMobileWorldContextTarget();
    if (!target) {
      hideWorldContextMenu();
      if (!opts.silent) setReadout('Рядом нет цели для взаимодействия.');
      return false;
    }
    if (target.type === 'remotePlayer') return openRemotePlayerActionWindow(target.row, opts);
    const rect = buttonEl?.getBoundingClientRect?.();
    const x = rect ? rect.left + rect.width * 0.5 : window.innerWidth * 0.5;
    const y = rect ? Math.max(8, rect.top - 14) : window.innerHeight * 0.55;
    return showWorldContextMenu(x, y, target.title, buildWorldContextOptions(target), target);
  }

  function showMobileRemotePlayerContextMenuFromButton(buttonEl, opts = {}) {
    if (!gameStarted || paused || hudEditMode || isProgressionWindowOpen()) return false;
    if (isMobileControlsEnabled() && !isMobilePlayerTreatmentMenuAllowedNow()) return false;
    if (anyWindowOpen()) return false;
    const selectedRow = getSelectedMobileRemotePlayer();
    if (selectedRow && isWorldContextTargetInRange(mobileRemotePlayerActionTarget(selectedRow))) {
      return openRemotePlayerActionWindow(selectedRow, opts);
    }
    const row = nearestRemotePlayerForContext(REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE);
    if (!row) {
      hideWorldContextMenu();
      closePlayerActionWindow(false);
      if (!opts.silent) setReadout(selectedRow ? 'Нужно подойти ближе к выбранному игроку.' : 'Рядом нет игрока для взаимодействия.');
      if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
      return false;
    }
    return openRemotePlayerActionWindow(row, opts);
  }

  function nearestRemotePlayerForTreatmentTest() {
    if (!multiplayer?.remotePlayers || !multiplayer.remotePlayers.size) return null;
    let best = null;
    let bestDist = Infinity;
    multiplayer.remotePlayers.forEach(row => {
      if (!row?.data?.id || !row.group) return;
      // Для теста берём даже тех, кто по текущей игровой проверке считается не в радиусе,
      // чтобы проверить саму карточку меню и данные сетевого игрока.
      const x = row.group.position?.x ?? row.group.userData?.targetX ?? Number(row.data.x || 0);
      const z = row.group.position?.z ?? row.group.userData?.targetZ ?? Number(row.data.z || 0);
      const d = contextDistanceTo(x, z);
      if (d < bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function mobileAutoTreatmentDebugStatus(text) {
    const now = performance.now();
    if (now - lastMobileAutoTreatmentStatusAt < 2200) return;
    lastMobileAutoTreatmentStatusAt = now;
    if (text) setReadout(text);
  }

  function maybeAutoOpenNearbyPlayerTreatmentMenu(dt = 0) {
    if (!MOBILE_AUTO_TREATMENT_TEST_ENABLED) return false;
    if (!isMobilePlayerTreatmentMenuAllowedNow()) return false;
    if (isMobilePlayerTreatmentMenuOpen()) return false;
    if (anyWindowOpen()) return false;
    const now = performance.now();
    if (now - lastMobileAutoTreatmentOpenAt < MOBILE_AUTO_TREATMENT_TEST_INTERVAL_MS) return false;

    const row = nearestRemotePlayerForTreatmentTest();
    if (!row) {
      mobileAutoTreatmentDebugStatus('Тест лечения: сетевые игроки в локации не найдены.');
      return false;
    }

    const x = row.group?.position?.x ?? row.group?.userData?.targetX ?? Number(row.data?.x || 0);
    const z = row.group?.position?.z ?? row.group?.userData?.targetZ ?? Number(row.data?.z || 0);
    const d = contextDistanceTo(x, z);
    lastMobileAutoTreatmentOpenAt = now;
    const opened = openMobilePlayerTreatmentMenu(row, { silent: true, autoTest: true, ignoreDistance: true });
    if (opened) setReadout(`Тест: меню лечения открыто. Дистанция до игрока ${d.toFixed(1)}.`);
    else mobileAutoTreatmentDebugStatus(`Тест лечения: игрок найден, но меню не открылось. Дистанция ${d.toFixed(1)}.`);
    return opened;
  }

  function tryOpenMobileRemotePlayerContextFromTap(clientX, clientY, sourceEvent = null) {
    if (!isMobileControlsEnabled()) return false;
    if (!isMobilePlayerTreatmentMenuAllowedNow()) return false;
    if (anyWindowOpen()) return false;
    const remote = findMobileRemotePlayerFromTap(clientX, clientY);
    if (!remote) return false;
    const target = { type: 'remotePlayer', row: remote, title: remote.data?.name || 'Игрок' };
    if (!isWorldContextTargetInRange(target)) {
      hideWorldContextMenu();
      setReadout('Нужно подойти ближе для взаимодействия.');
      return false;
    }
    if (sourceEvent) {
      sourceEvent.preventDefault?.();
      sourceEvent.stopPropagation?.();
    }
    stopAutoFire();
    stopTouchAim(sourceEvent?.pointerId);
    hideTargetHint();
    return openRemotePlayerActionWindow(remote);
  }

  function isMobilePlayerMenuTapCandidate(state, e) {
    if (!state || !e) return false;
    if (state.pointerId !== e.pointerId) return false;
    const elapsed = performance.now() - state.startedAt;
    const moved = Math.hypot(e.clientX - state.x, e.clientY - state.y);
    return elapsed <= MOBILE_PLAYER_CONTEXT_TAP_MAX_MS && moved <= MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE && !state.moved;
  }

  function tryOpenMobileRemotePlayerContextFromTapState(state, e) {
    if (!isMobilePlayerMenuTapCandidate(state, e)) return false;
    return tryOpenMobileRemotePlayerContextFromTap(e.clientX, e.clientY, e);
  }

