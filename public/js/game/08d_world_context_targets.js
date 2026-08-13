  function updatePointerWorld(clientX, clientY) {
    lastPointerClientX = clientX;
    lastPointerClientY = clientY;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(groundPlane, pointerWorld);
    pointerHasWorld = true;
    pointerHasAimWorld = !!raycaster.ray.intersectPlane(pointerAimPlane, pointerAimWorld);
  }

  function refreshPointerWorldFromLastScreen() {
    if (lastPointerClientX === null || lastPointerClientY === null) return;
    const rect = canvas.getBoundingClientRect();
    if (lastPointerClientX < rect.left || lastPointerClientX > rect.right || lastPointerClientY < rect.top || lastPointerClientY > rect.bottom) return;
    const keepX = lastPointerClientX;
    const keepY = lastPointerClientY;
    updatePointerWorld(keepX, keepY);
  }

  // Другой игрок как цель подсказки. Подсказка ждёт поля обычного актёра,
  // поэтому строку сети приводим к тому же виду; сам объект одноразовый и
  // никуда не сохраняется.
  function remotePlayerHintTarget(row) {
    const data = row?.data || {};
    const pvpAllowed = String(currentLocation?.pvpMode || 'pvp') !== 'peaceful';
    return {
      id: String(data.id || ''),
      name: String(data.name || 'Игрок'),
      hp: Number(data.hp || 0),
      maxHp: Math.max(1, Number(data.maxHp || data.hp || 1)),
      x: Number(row?.visualX ?? data.x ?? 0),
      z: Number(row?.visualZ ?? data.z ?? 0),
      scale: 1,
      dead: Number(data.hp || 0) <= 0,
      hostileToPlayer: pvpAllowed,
      isRemotePlayer: true
    };
  }

  function findRemotePlayerFromPointer() {
    const remote = multiplayer?.remotePlayers;
    if (!remote || typeof remote.forEach !== 'function' || !remote.size) return null;
    const roots = [];
    remote.forEach(row => {
      if (!row?.group || row.group.visible === false) return;
      row.group.userData.remotePlayerHintRow = row;
      roots.push(row.group);
    });
    if (!roots.length) return null;
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj) {
        const row = obj.userData?.remotePlayerHintRow;
        if (row) return remotePlayerHintTarget(row);
        obj = obj.parent;
      }
    }
    return null;
  }

  function findEnemyFromEvent(clientX, clientY, pointerAlreadyUpdated = false) {
    if (!pointerAlreadyUpdated) updatePointerWorld(clientX, clientY);
    const proxies = [];
    const fallbackRoots = [];
    enemyMeshes.forEach(root => {
      if (!root || root.visible === false) return;
      const proxy = root.userData?.interactionProxy;
      if (proxy) proxies.push(proxy);
      else fallbackRoots.push(root);
    });
    const hits = proxies.length ? raycaster.intersectObjects(proxies, false) : [];
    if (fallbackRoots.length) {
      hits.push(...raycaster.intersectObjects(fallbackRoots, true));
      hits.sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0));
    }
    for (const h of hits) {
      let obj = h.object;
      while (obj) {
        const enemy = obj.userData?.enemy;
        if (enemy && !enemy._removed) return enemy;
        obj = obj.parent;
      }
    }
    const remotePlayer = findRemotePlayerFromPointer();
    if (remotePlayer) return remotePlayer;
    return null;
  }

  function hideTargetHint() {
    const el = document.getElementById('target-hint');
    if (el) el.style.display = 'none';
    if (targetHintRenderCache) {
      targetHintRenderCache.enemyKey = '';
      targetHintRenderCache.html = '';
      targetHintRenderCache.until = 0;
    }
  }

  const TARGET_HINT_RECALC_MS = 120;
  var targetHintRenderCache = {
    enemyKey: '',
    html: '',
    until: 0,
    // Позиция ещё ни разу не записана. Здесь нельзя держать NaN: сравнение
    // «сдвинулась ли подсказка» пропускало бы первую запись — Math.abs(x - NaN)
    // это NaN, а NaN > 0.5 всегда ложь, — и подсказка навсегда оставалась бы в
    // левом верхнем углу, где её и рисует position: absolute без координат.
    left: null,
    top: null
  };

  function targetHintCacheKey(enemy) {
    const w = typeof currentWeapon === 'function' ? currentWeapon() : null;
    return [
      enemy?.id || enemy?.name || '',
      Math.ceil(Number(enemy?.hp || 0)),
      Math.ceil(Number(enemy?.maxHp || 0)),
      enemy?.hostileToPlayer === false ? 'neutral' : 'hostile',
      String(w?.id || equipment?.weapon || ''),
      String(player.fireMode || ''),
      player.crouching ? 1 : 0,
      Math.round(Number(player.x || 0) * 5),
      Math.round(Number(player.z || 0) * 5),
      Math.round(Number(enemy?.x || 0) * 5),
      Math.round(Number(enemy?.z || 0) * 5),
      String(enemy?.scheduleState || ''),
      String(enemy?.scheduleLabel || ''),
      talentLevel('awareness')
    ].join('|');
  }

  function buildTargetHintHtml(enemy) {
    const info = getTargetHitInfo(enemy);
    // Шанс попадания всегда ярко-красный: игрок читает его первым.
    const cls = 'hit-chance';
    const aware = talentLevel('awareness') > 0;
    const state = enemyHealthStateText(enemy);
    const attitude = enemy.isRemotePlayer
      ? (enemy.hostileToPlayer === false ? 'Игрок · мирная зона' : 'Игрок')
      : (enemy.hostileToPlayer === false ? '\u041d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u044b\u0439' : '\u0412\u0440\u0430\u0436\u0434\u0435\u0431\u043d\u044b\u0439');
    const hpLine = aware
      ? `HP ${Math.max(0, Math.ceil(enemy.hp))}/${enemy.maxHp}<br>\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435: ${state}`
      : `\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435: ${state}`;
    const damageLine = aware ? `<br>\u041f\u0440\u0435\u0434\u043f. \u0443\u0440\u043e\u043d: <span class="target-note">${estimatedWeaponDamageText(enemy, info)}</span>` : '';
    const safe = typeof escapeHtml === 'function'
      ? escapeHtml
      : (value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])));
    const scheduleLine = enemy.scheduleLabel
      ? `<br>\u0417\u0430\u043d\u044f\u0442: <span class="target-note">${safe(enemy.scheduleLabel)}</span>`
      : '';
    const ownerLabel = String(enemy.wastelandOwnerLabel
      || (enemy.wastelandOwnerFaction && typeof globalMapFactionLabel === 'function' ? globalMapFactionLabel(enemy.wastelandOwnerFaction) : '')
      || '').trim();
    const factionLine = ownerLabel
      ? `<br>\u0424\u0440\u0430\u043a\u0446\u0438\u044f: <span class="target-note">${safe(ownerLabel)}</span>`
      : '';
    const specialLine = aware && enemy.special
      ? `<br><span class="target-note">SPECIAL ${['ST', 'PE', 'EN', 'CH', 'IN', 'AG', 'LK'].map(key => `${key}${Math.max(1, Math.min(10, Math.round(Number(enemy.special[key] || 0))))}`).join(' ')}</span>`
      : '';
    return `<b>${safe(enemy.name)}</b><br>${attitude}${factionLine}${scheduleLine}<br>${hpLine}${specialLine}<br>\u0428\u0430\u043d\u0441 \u043f\u043e\u043f\u0430\u0434\u0430\u043d\u0438\u044f: <span class="${cls}">${info.chance}%</span>${damageLine}<br><span class="target-note">${info.note}</span>`;
  }

  // Подсказка привязана к самой цели, а не к курсору. Осмотр запускают
  // по-разному — наведением, клавишей, пунктом меню, — и координат мыши в
  // половине этих случаев нет вовсе: подсказка уезжала в левый верхний угол.
  // Позиция цели известна всегда, при наведении она и так под курсором.
  const targetHintProjected = new THREE.Vector3();
  function targetHintScreenAnchor(enemy, clientX, clientY) {
    if (enemy && typeof camera !== 'undefined' && camera && canvas) {
      const x = Number(enemy.x ?? enemy.visualX);
      const z = Number(enemy.z ?? enemy.visualZ);
      if (Number.isFinite(x) && Number.isFinite(z)) {
        targetHintProjected.set(x, 1.7 * Math.max(0.5, Number(enemy.scale || 1)), z).project(camera);
        if (targetHintProjected.z <= 1) {
          const rect = canvas.getBoundingClientRect();
          return {
            x: rect.left + (targetHintProjected.x + 1) * rect.width * 0.5,
            y: rect.top + (1 - targetHintProjected.y) * rect.height * 0.5
          };
        }
      }
    }
    // Цель не проецируется — тогда курсор, если он вообще есть. Проверять надо
    // сам аргумент: Number(null) — это ноль, а не NaN, и подсказка снова
    // встала бы в углу экрана.
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) return { x: clientX, y: clientY };
    return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42 };
  }

  function showTargetHint(enemy, clientX = lastPointerClientX, clientY = lastPointerClientY) {
    const el = document.getElementById('target-hint');
    if (!el || !enemy) return;
    if (enemy.dead) {
      hideTargetHint();
      return;
    }
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const key = targetHintCacheKey(enemy);
    if (key !== targetHintRenderCache.enemyKey || now >= targetHintRenderCache.until || !targetHintRenderCache.html) {
      targetHintRenderCache.enemyKey = key;
      targetHintRenderCache.html = buildTargetHintHtml(enemy);
      targetHintRenderCache.until = now + TARGET_HINT_RECALC_MS;
    }
    if (el.dataset.targetHintHtml !== targetHintRenderCache.html) {
      el.innerHTML = targetHintRenderCache.html;
      el.dataset.targetHintHtml = targetHintRenderCache.html;
    }
    const pad = 14;
    const anchor = targetHintScreenAnchor(enemy, clientX, clientY);
    const anchorX = anchor.x;
    const anchorY = anchor.y;
    const x = Math.min(window.innerWidth - 190, Math.max(8, anchorX + pad));
    const y = Math.min(window.innerHeight - 92, Math.max(8, anchorY + pad));
    // Записываем, пока позиция не подтверждена числом: любое сравнение с
    // «ещё не записано» должно приводить к записи, а не пропускать её.
    if (!Number.isFinite(targetHintRenderCache.left) || Math.abs(x - targetHintRenderCache.left) > 0.5) {
      el.style.left = x + 'px';
      targetHintRenderCache.left = x;
    }
    if (!Number.isFinite(targetHintRenderCache.top) || Math.abs(y - targetHintRenderCache.top) > 0.5) {
      el.style.top = y + 'px';
      targetHintRenderCache.top = y;
    }
    el.style.display = 'block';
  }

  function updateTargetHintFromHover() {
    if (hoveredEnemy && !hoveredEnemy._removed) showTargetHint(hoveredEnemy);
    else hideTargetHint();
  }

  function findResourceFromEvent(clientX, clientY) {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(obstacleMeshes, true);
    for (const h of hits) {
      let obj = h.object;
      while (obj) {
        if (obj.userData && obj.userData.resource) return obj.userData.resource;
        obj = obj.parent;
      }
    }
    return null;
  }


  // ===== WORLD CONTEXT MENU (ПКМ ПО МИРУ / ТАП ПО ОБЪЕКТУ НА ТЕЛЕФОНЕ) =====
  const WORLD_CONTEXT_INTERACT_DISTANCE = 3.35;
  const CRAFTING_STATION_INTERACT_DISTANCE = 4.2;
  // Игроки на экране визуально крупнее ящиков/ресурсов, поэтому для меню лечения
  // даём чуть больший радиус. Объекты мира остаются на старой дистанции.
  const REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE = 4.25;
  const MOBILE_AUTO_TREATMENT_TEST_ENABLED = false;
  const MOBILE_AUTO_TREATMENT_TEST_INTERVAL_MS = 700;
  const WORLD_CONTEXT_DISTANCE_POLL_MS = 180;
  const MOBILE_INTERACT_LONG_PRESS_MS = 520;
  const MOBILE_PLAYER_CONTEXT_TAP_RADIUS = 220;
  const MOBILE_PLAYER_CONTEXT_TAP_MAX_MS = 360;
  const MOBILE_PLAYER_CONTEXT_TAP_MAX_MOVE = 16;
  let activeWorldContextTarget = null;
  let worldContextDistanceTimer = null;
  let selectedMobileRemotePlayerId = null;
  let lastMobilePlayerContextOpenAt = 0;
  let lastMobileAutoTreatmentOpenAt = 0;
  let lastMobileAutoTreatmentStatusAt = 0;

  function clearWorldContextDistanceWatch() {
    if (worldContextDistanceTimer) {
      clearInterval(worldContextDistanceTimer);
      worldContextDistanceTimer = null;
    }
  }

  function ensureWorldContextMenu() {
    let menu = document.getElementById('world-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'world-context-menu';
    menu.className = 'ui-panel';
    menu.style.display = 'none';
    document.body.appendChild(menu);
    return menu;
  }

  function hideWorldContextMenu() {
    const menu = document.getElementById('world-context-menu');
    if (menu) menu.style.display = 'none';
    activeWorldContextTarget = null;
    clearWorldContextDistanceWatch();
  }

  function worldContextTargetPoint(target) {
    if (!target) return null;
    if (target.type === 'remotePlayer') {
      const row = target.row;
      return {
        x: row?.group?.position?.x ?? Number(row?.data?.x || 0),
        z: row?.group?.position?.z ?? Number(row?.data?.z || 0)
      };
    }
    if (target.type === 'corpse' || target.type === 'enemy') {
      return target.enemy ? { x: target.enemy.x, z: target.enemy.z } : null;
    }
    if (target.type === 'worldContainer') {
      return target.container ? { x: Number(target.container.x || 0), z: Number(target.container.z || 0) } : null;
    }
    if (target.type === 'groundItem') {
      return target.groundItem ? { x: Number(target.groundItem.x || 0), z: Number(target.groundItem.z || 0) } : null;
    }
    if (target.type === 'trader') {
      return target.trader ? { x: Number(target.trader.x || 0), z: Number(target.trader.z || 0) } : null;
    }
    if (target.type === 'storage') {
      return target.storage ? { x: Number(target.storage.x || 0), z: Number(target.storage.z || 0) } : null;
    }
    if (target.type === 'jobBoard') {
      return target.board ? { x: Number(target.board.x || 0), z: Number(target.board.z || 0) } : null;
    }
    if (target.type === 'craftingStation') {
      return target.station ? { x: Number(target.station.x || 0), z: Number(target.station.z || 0) } : null;
    }
    if (target.type === 'tradeMachine') {
      return target.machine ? { x: Number(target.machine.x || 0), z: Number(target.machine.z || 0) } : null;
    }
    if (target.type === 'resource') {
      if (!target.resource) return null;
      const pos = tileToWorld(target.resource.tx, target.resource.tz);
      return { x: pos.x, z: pos.z };
    }
    return null;
  }

  function worldContextTargetStillExists(target) {
    if (!target) return false;
    if (target.type === 'remotePlayer') return !!(target.row && target.row.group && target.row.group.visible !== false && target.row.data?.id);
    if (target.type === 'corpse') return !!(target.enemy && target.enemy.dead && !target.enemy._removed);
    if (target.type === 'enemy') return !!(target.enemy && !target.enemy.dead && !target.enemy._removed);
    if (target.type === 'worldContainer') return !!(target.container && (!target.container.mesh || target.container.mesh.visible !== false));
    if (target.type === 'groundItem') return !!(target.groundItem && ITEMS[target.groundItem.itemId] && (!target.groundItem.mesh || target.groundItem.mesh.visible !== false));
    if (target.type === 'trader') return !!target.trader;
    if (target.type === 'storage') return !!target.storage;
    if (target.type === 'jobBoard') return !!(target.board && (!target.board.mesh || target.board.mesh.visible !== false));
    if (target.type === 'craftingStation') return !!(target.station && (!target.station.mesh || target.station.mesh.visible !== false));
    if (target.type === 'tradeMachine') return !!(target.machine && (!target.machine.mesh || target.machine.mesh.visible !== false));
    if (target.type === 'resource') return !!(target.resource && target.resource.hp > 0);
    return true;
  }

  function worldContextTargetMaxDistance(target, fallback = WORLD_CONTEXT_INTERACT_DISTANCE) {
    if (target?.type === 'remotePlayer') return REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE;
    if (target?.type === 'craftingStation') return CRAFTING_STATION_INTERACT_DISTANCE;
    return fallback;
  }

  function isWorldContextTargetInRange(target, maxDist = null) {
    if (!target) return false;
    if (!worldContextTargetStillExists(target)) return false;
    const point = worldContextTargetPoint(target);
    if (!point) return false;
    const limit = Number.isFinite(maxDist) ? Number(maxDist) : worldContextTargetMaxDistance(target);
    return contextDistanceTo(point.x, point.z) <= limit;
  }

  function setSelectedMobileRemotePlayer(row) {
    if (!isMobileControlsEnabled()) return;
    selectedMobileRemotePlayerId = row?.data?.id || null;
  }

  function clearSelectedMobileRemotePlayer(row = null) {
    if (!row || row.data?.id === selectedMobileRemotePlayerId) selectedMobileRemotePlayerId = null;
  }

  function getSelectedMobileRemotePlayer() {
    if (!selectedMobileRemotePlayerId || !multiplayer?.remotePlayers) return null;
    const row = multiplayer.remotePlayers.get(selectedMobileRemotePlayerId);
    if (!row?.group || row.group.visible === false || !row.data?.id) {
      selectedMobileRemotePlayerId = null;
      return null;
    }
    return row;
  }

  function mobileRemotePlayerActionTarget(row) {
    if (!row?.data?.id) return null;
    return { type: 'remotePlayer', row, title: row.data?.name || 'Игрок' };
  }

  function checkWorldContextMenuDistance() {
    const menu = document.getElementById('world-context-menu');
    const playerActionWin = document.getElementById('player-action-window');
    const treatmentWin = document.getElementById('mobile-player-treatment-menu');
    const worldMenuOpen = !!(menu && menu.style.display !== 'none');
    const playerActionOpen = !!(playerActionWin && playerActionWin.style.display === 'block');
    const treatmentOpen = !!(treatmentWin && treatmentWin.classList.contains('visible') && treatmentWin.style.display !== 'none');
    if (!worldMenuOpen && !playerActionOpen && !treatmentOpen) {
      clearWorldContextDistanceWatch();
      activeWorldContextTarget = null;
      return;
    }
    if (!activeWorldContextTarget) return;
    if (!isWorldContextTargetInRange(activeWorldContextTarget)) {
      if (treatmentOpen && isMobileControlsEnabled() && activeWorldContextTarget.type === 'remotePlayer') {
        // Мобильное меню лечения закрывается только крестиком. Кнопки лечения
        // сами проверяют дистанцию и покажут, что нужно подойти ближе.
        refreshOpenMobilePlayerTreatmentMenu(activeWorldContextTarget.row);
        return;
      }
      hideWorldContextMenu();
      if (typeof closePlayerActionWindow === 'function') closePlayerActionWindow(false);
      if (typeof closeMobilePlayerTreatmentMenu === 'function') closeMobilePlayerTreatmentMenu(false);
      setReadout('Вы отошли слишком далеко для взаимодействия.');
    }
  }

  function startWorldContextDistanceWatch() {
    clearWorldContextDistanceWatch();
    worldContextDistanceTimer = setInterval(checkWorldContextMenuDistance, WORLD_CONTEXT_DISTANCE_POLL_MS);
  }

  function updateMobilePlayerTreatmentRangeGate() {
    const win = document.getElementById('mobile-player-treatment-menu');
    const treatmentOpen = !!(win && win.classList.contains('visible') && win.style.display !== 'none');
    if (!treatmentOpen) return false;

    const target = activeWorldContextTarget;
    if (!target || target.type !== 'remotePlayer') return false;

    // Не закрываем мобильное меню лечения автоматически: закрытие только на крестик.
    // При отходе от игрока просто обновляем кнопки — они станут недоступны по дистанции.
    refreshOpenMobilePlayerTreatmentMenu(target.row);
    return false;
  }

  function placeWorldContextMenu(menu, clientX, clientY) {
    const pad = 8;
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;
    menu.style.display = 'block';
    const rect = menu.getBoundingClientRect();
    const x = Math.max(pad, Math.min(window.innerWidth - rect.width - pad, clientX));
    const y = Math.max(pad, Math.min(window.innerHeight - rect.height - pad, clientY));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  function showWorldContextMenu(clientX, clientY, title, options = [], target = null) {
    const activeOptions = options.filter(Boolean);
    if (!activeOptions.length) return false;
    if (target && !isWorldContextTargetInRange(target)) {
      hideWorldContextMenu();
      setReadout('Нужно подойти ближе для взаимодействия.');
      return false;
    }
    const menu = ensureWorldContextMenu();
    const mobileInventoryLike = isMobileControlsEnabled() && target?.type === 'remotePlayer';
    activeWorldContextTarget = target || null;
    menu.innerHTML = '';
    menu.classList.toggle('mobile-inventory-style', mobileInventoryLike);
    if (!mobileInventoryLike) {
      const head = document.createElement('div');
      head.className = 'ctx-title world-ctx-title';
      head.textContent = title || 'Действие';
      menu.appendChild(head);
    }
    activeOptions.forEach(opt => {
      const row = document.createElement('div');
      row.className = 'ctx-option world-ctx-option' + (opt.disabled ? ' disabled' : '');
      row.textContent = opt.label;
      if (opt.hint) row.dataset.gameHint = opt.hint;
      row.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (opt.disabled) return;
        const targetForAction = activeWorldContextTarget;
        if (targetForAction && !isWorldContextTargetInRange(targetForAction)) {
          hideWorldContextMenu();
          setReadout('Вы отошли слишком далеко для взаимодействия.');
          return;
        }
        hideWorldContextMenu();
        try { opt.action?.(); } catch (err) { console.error(err); setReadout('Действие не выполнено.'); }
      });
      menu.appendChild(row);
    });
    placeWorldContextMenu(menu, clientX, clientY);
    if (activeWorldContextTarget) startWorldContextDistanceWatch();
    return true;
  }

  function findRemotePlayerFromEvent(clientX, clientY) {
    updatePointerWorld(clientX, clientY);
    const proxies = [];
    const fallbackRoots = [];
    multiplayer.remotePlayers.forEach(row => {
      const root = row?.group;
      if (!root || root.visible === false) return;
      const proxy = root.userData?.interactionProxy;
      if (proxy) proxies.push(proxy);
      else fallbackRoots.push(root);
    });
    if (!proxies.length && !fallbackRoots.length) return null;
    raycaster.setFromCamera(mouse, camera);
    const hits = proxies.length ? raycaster.intersectObjects(proxies, false) : [];
    if (fallbackRoots.length) {
      hits.push(...raycaster.intersectObjects(fallbackRoots, true));
      hits.sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0));
    }
    for (const h of hits) {
      let obj = h.object;
      while (obj) {
        if (obj.userData && obj.userData.remotePlayerRow) return obj.userData.remotePlayerRow;
        obj = obj.parent;
      }
    }
    return null;
  }

  function remotePlayerScreenPoint(row) {
    if (!row?.group || !camera || typeof THREE === 'undefined') return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const base = row.group.position || row.data || {};
    const x = Number(base.x || 0);
    const z = Number(base.z || 0);
    const p = new THREE.Vector3(x, Number(base.y || 0) + 1.15, z);
    p.project(camera);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    if (p.z < -1 || p.z > 1) return null;
    return {
      x: rect.left + (p.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - p.y) * 0.5 * rect.height
    };
  }

  function remotePlayerScreenSamplePoints(row) {
    if (!row?.group || !camera || typeof THREE === 'undefined') return [];
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    const base = row.group.position || row.data || {};
    const x = Number(base.x || 0);
    const z = Number(base.z || 0);
    const by = Number(base.y || 0);
    const points = [];
    [0.25, 0.75, 1.15, 1.55, 1.9].forEach(offsetY => {
      const p = new THREE.Vector3(x, by + offsetY, z);
      p.project(camera);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
      if (p.z < -1 || p.z > 1) return;
      points.push({
        x: rect.left + (p.x + 1) * 0.5 * rect.width,
        y: rect.top + (1 - p.y) * 0.5 * rect.height
      });
    });
    return points;
  }

  function screenDistanceToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }

  function mobileRemotePlayerTapDistance(row, clientX, clientY) {
    const points = remotePlayerScreenSamplePoints(row);
    if (!points.length) return Infinity;
    let best = Infinity;
    points.forEach(pt => { best = Math.min(best, Math.hypot(pt.x - clientX, pt.y - clientY)); });
    for (let i = 1; i < points.length; i++) {
      best = Math.min(best, screenDistanceToSegment(clientX, clientY, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
    }
    return best;
  }

  function findMobileRemotePlayerFromTap(clientX, clientY) {
    const direct = findRemotePlayerFromEvent(clientX, clientY);
    if (direct && isWorldContextTargetInRange({ type: 'remotePlayer', row: direct })) return direct;
    const candidates = [];
    multiplayer.remotePlayers.forEach(row => {
      if (!row?.group || row.group.visible === false || !row.data?.id) return;
      const x = row.group.position?.x ?? Number(row.data.x || 0);
      const z = row.group.position?.z ?? Number(row.data.z || 0);
      const worldDist = contextDistanceTo(x, z);
      if (worldDist > REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE) return;
      const screenDist = mobileRemotePlayerTapDistance(row, clientX, clientY);
      if (screenDist <= MOBILE_PLAYER_CONTEXT_TAP_RADIUS) candidates.push({ row, screenDist, worldDist });
    });
    candidates.sort((a, b) => a.screenDist - b.screenDist || a.worldDist - b.worldDist);
    return candidates[0]?.row || null;
  }

  function findTraderFromEvent(clientX, clientY) {
    if (!traderNpc?.mesh) return null;
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([traderNpc.mesh], true);
    return hits.length ? traderNpc : null;
  }

  function findStorageFromEvent(clientX, clientY) {
    if (!storageBox?.mesh) return null;
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([storageBox.mesh], true);
    return hits.length ? storageBox : null;
  }

  function jobBoardFromObject(object) {
    let node = object;
    while (node) {
      if (node.userData?.jobBoard) return node.userData.jobBoard;
      node = node.parent;
    }
    return null;
  }

  function tradeMachineFromObject(object) {
    let node = object;
    while (node) {
      if (node.userData?.tradeMachine) return node.userData.tradeMachine;
      node = node.parent;
    }
    return null;
  }

  function craftingStationFromObject(object) {
    let node = object;
    while (node) {
      if (node.userData?.craftingStation) return node.userData.craftingStation;
      node = node.parent;
    }
    return null;
  }

  function findJobBoardFromEvent(clientX, clientY) {
    if (!Array.isArray(locationJobBoards) || !locationJobBoards.length) return null;
    const roots = locationJobBoards.map(row => row?.mesh).filter(Boolean);
    if (!roots.length) return null;
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const board = jobBoardFromObject(hit.object);
      if (board) return board;
    }
    return null;
  }

  function findTradeMachineFromEvent(clientX, clientY) {
    if (!Array.isArray(locationTradeMachines) || !locationTradeMachines.length) return null;
    const roots = locationTradeMachines.map(row => row?.mesh).filter(Boolean);
    if (!roots.length) return null;
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const machine = tradeMachineFromObject(hit.object);
      if (machine) return machine;
    }
    return null;
  }

  function findCraftingStationFromEvent(clientX, clientY) {
    if (!Array.isArray(locationCraftingStations) || !locationCraftingStations.length) return null;
    const roots = locationCraftingStations.map(row => row?.mesh).filter(Boolean);
    if (!roots.length) return null;
    updatePointerWorld(clientX, clientY);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const station = craftingStationFromObject(hit.object);
      if (station) return station;
    }
    return null;
  }

  function findNearbyJobBoard(maxDist = WORLD_CONTEXT_INTERACT_DISTANCE) {
    if (!Array.isArray(locationJobBoards) || !locationJobBoards.length) return null;
    let best = null;
    let bestDist = maxDist;
    locationJobBoards.forEach(row => {
      const d = contextDistanceTo(row.x, row.z);
      if (d <= bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function findNearbyCraftingStation(maxDist = CRAFTING_STATION_INTERACT_DISTANCE) {
    if (!Array.isArray(locationCraftingStations) || !locationCraftingStations.length) return null;
    let best = null;
    let bestDist = maxDist;
    locationCraftingStations.forEach(row => {
      const d = contextDistanceTo(row.x, row.z);
      if (d <= bestDist) { bestDist = d; best = row; }
    });
    return best;
  }

  function contextDistanceTo(x, z) {
    return Math.hypot(Number(x || 0) - player.x, Number(z || 0) - player.z);
  }

  function remotePlayerHpText(row) {
    const hp = Math.max(0, Math.round(Number(row?.data?.hp || 0)));
    const maxHp = Math.max(1, Math.round(Number(row?.data?.maxHp || 100)));
    return `${hp}/${maxHp} HP`;
  }

  function remotePlayerInjuries(row) {
    const src = row?.data?.injuries && typeof row.data.injuries === 'object' ? row.data.injuries : {};
    return {
      brokenArm: !!src.brokenArm,
      brokenLeg: !!src.brokenLeg,
      concussion: !!src.concussion,
      infection: !!src.infection
    };
  }

  function remotePlayerTreatableInjuries(row) {
    const injuries = remotePlayerInjuries(row);
    return ['brokenArm', 'brokenLeg', 'concussion'].filter(id => !!injuries[id]);
  }

  function remotePlayerInjuryStatusText(row) {
    const injuries = remotePlayerInjuries(row);
    const ids = Object.keys(injuries).filter(id => injuries[id]);
    if (!ids.length) return 'травм нет';
    return ids.map(id => INJURY_LABELS[id] || id).join(', ');
  }

  const SOCIAL_ACTION_TEXT = {
    trade: { label: '🤝 Торговать', sent: 'Запрос торговли отправлен.' },
    friend: { label: '➕ Добавить в друзья', sent: 'Заявка в друзья отправлена.' },
    clan: { label: '⚑ Пригласить в клан', sent: 'Приглашение в клан отправлено.' }
  };

  function sendRemoteSocialAction(row, action) {
    if (!row?.data?.id) return;
    const meta = SOCIAL_ACTION_TEXT[action] || SOCIAL_ACTION_TEXT.trade;
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      setReadout('Социальные действия доступны в сетевой игре.');
      return;
    }
    if (!isWorldContextTargetInRange({ type: 'remotePlayer', row })) {
      setReadout('Подойдите ближе к игроку.');
      return;
    }
    multiplayer.socket.emit('socialAction', { targetId: row.data.id, action }, ack => {
      if (!ack || !ack.ok) {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        setReadout(ack?.error || 'Социальное действие не выполнено.');
        return;
      }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      const targetName = ack.targetName || row.data.name || 'игроку';
      addLog(`${meta.label}: ${targetName}.`, null, 'system');
      setReadout(ack.message || meta.sent);
    });
  }

  function healRemotePlayer(row, itemId) {
    if (!row?.data?.id) return;
    const item = ITEMS[itemId];
    const isHpHeal = !!(item && item.heal);
    const isDoctor = !!(item && item.doctor);
    const isAntibiotic = !!(item && item.cureInfection);
    if (!item || (!isHpHeal && !isDoctor && !isAntibiotic)) return;
    if (!multiplayer.socket || !multiplayer.socket.connected || !multiplayer.joined) {
      setReadout('Лечение другого игрока работает в сетевой игре.');
      return;
    }
    const tx = row.group?.position?.x ?? Number(row.data.x || 0);
    const tz = row.group?.position?.z ?? Number(row.data.z || 0);
    if (contextDistanceTo(tx, tz) > REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE) {
      setReadout('Подойдите ближе, чтобы лечить игрока.');
      return;
    }
    const maxHp = Math.max(1, Number(row.data.maxHp || 100));
    const hp = Math.max(0, Number(row.data.hp || maxHp));
    if (isHpHeal && hp >= maxHp - 0.5) {
      setReadout(`${row.data.name || 'Игрок'} уже здоров.`);
      return;
    }
    if (isDoctor && !remotePlayerTreatableInjuries(row).length) {
      setReadout(`${row.data.name || 'Игрок'}: нет переломов или контузии.`);
      return;
    }
    if (isAntibiotic && !remotePlayerInjuries(row).infection) {
      setReadout(`${row.data.name || 'Игрок'}: инфекции нет.`);
      return;
    }
    if ((inventory.get(itemId) || 0) <= 0) {
      setReadout(`Нет предмета: ${item.name}.`);
      return;
    }
    const medicalKind = isDoctor ? 'doctor' : (isAntibiotic ? 'antibiotics' : (itemId === 'stim' ? 'stim' : 'aid'));
    if (typeof canStartMedicalAction === 'function' && !canStartMedicalAction(medicalKind)) return;
    const apBefore = Number(player.ap || 0);
    const apCost = typeof medicalItemApCost === 'function' ? medicalItemApCost(itemId) : (isDoctor ? 3 : (itemId === 'stim' ? 1 : 2));
    if (apBefore + 0.01 < apCost) {
      setReadout(`Недостаточно очков действий. Нужно ${apCost} ОД.`);
      return;
    }
    if (typeof applyMedicalActionDelay === 'function') applyMedicalActionDelay(medicalKind);
    multiplayer.socket.emit('healPlayer', {
      targetId: row.data.id,
      itemId,
      amount: Number(item.heal || 0),
      successChance: isDoctor ? doctorSuccessChance() : 1,
      ap: apBefore,
      apCost,
      special: characterProfile?.special || {},
      traits: characterProfile?.traits || [],
      skillRanks: typeof multiplayerSkillSnapshot === 'function' ? multiplayerSkillSnapshot() : {},
      talentRanks: typeof multiplayerTalentSnapshot === 'function' ? multiplayerTalentSnapshot() : {}
    }, ack => {
      if (!ack || !ack.ok) {
        player.ap = Number.isFinite(Number(ack?.ap)) ? Number(ack.ap) : apBefore;
        if (Number.isFinite(Number(ack?.maxAp)) && Number(ack.maxAp) > 0) player.maxAp = Number(ack.maxAp);
        refreshInventoryDependentUI();
        setReadout(ack?.error || 'Не удалось вылечить игрока.');
        return;
      }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
      if (ack.refundItem === itemId) {
        addLog(`${item.icon} Полевой хирург: ${item.name} сохранён.`, null, 'system');
      }
      row.data = {
        ...row.data,
        hp: Number(ack.hp ?? row.data.hp ?? 0),
        maxHp: Number(ack.maxHp ?? row.data.maxHp ?? 100),
        injuries: ack.injuries || ack.target?.injuries || row.data.injuries || {}
      };
      if (ack.medicalFailed) {
        createFloatingText(tx, tz, 'неудача', '#ffbf69');
        addLog(`${item.icon} Лечение ${ack.targetName || row.data.name || 'игрока'} не удалось. Потрачено ${ack.apCost ?? apCost} ОД.`, null, 'system');
        setReadout('Лечение не удалось.');
      } else if (ack.curedInjury) {
        const curedName = INJURY_LABELS[ack.curedInjury] || 'травма';
        createFloatingText(tx, tz, itemId === 'antibiotics' ? 'антибиотик' : 'леч.', '#7ce67a');
        addLog(`${item.icon} Вы лечите ${ack.targetName || row.data.name || 'игрока'}: ${curedName}. Потрачено ${ack.apCost ?? apCost} ОД.`, null, 'system');
        setReadout(`${ack.targetName || row.data.name || 'Игрок'}: вылечено — ${curedName}.`);
      } else {
        createFloatingText(tx, tz, '+' + Math.max(0, Number(ack.healed || 0)), '#7ce67a');
        addLog(`${item.icon} Вы лечите ${ack.targetName || row.data.name || 'игрока'}: +${Math.max(0, Number(ack.healed || 0))} HP. Потрачено ${ack.apCost ?? apCost} ОД.`, null, 'system');
        setReadout(`${ack.targetName || row.data.name || 'Игрок'}: +${Math.max(0, Number(ack.healed || 0))} HP.`);
      }
      if (typeof refreshOpenMobilePlayerTreatmentMenu === 'function') refreshOpenMobilePlayerTreatmentMenu(row);
      queueSave(true);
    });
  }

  function buildRemotePlayerContextOptions(row) {
    const d = contextDistanceTo(row.group?.position?.x ?? row.data?.x, row.group?.position?.z ?? row.data?.z);
    const tooFar = d > REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE;
    return [
      {
        label: SOCIAL_ACTION_TEXT.trade.label,
        disabled: tooFar,
        hint: tooFar ? 'Нужно подойти ближе.' : 'Отправить запрос на обмен предметами.',
        action: () => sendRemoteSocialAction(row, 'trade')
      },
      {
        label: SOCIAL_ACTION_TEXT.friend.label,
        disabled: tooFar,
        hint: tooFar ? 'Нужно подойти ближе.' : 'Отправить заявку в список друзей.',
        action: () => sendRemoteSocialAction(row, 'friend')
      },
      {
        label: SOCIAL_ACTION_TEXT.clan.label,
        disabled: tooFar,
        hint: tooFar ? 'Нужно подойти ближе.' : 'Отправить приглашение в клан.',
        action: () => sendRemoteSocialAction(row, 'clan')
      }
    ];
  }

  function buildWorldContextTarget(clientX, clientY) {
    const remote = isMobileControlsEnabled() ? findMobileRemotePlayerFromTap(clientX, clientY) : findRemotePlayerFromEvent(clientX, clientY);
    if (remote) return { type: 'remotePlayer', row: remote, title: remote.data?.name || 'Игрок' };
    const enemy = findEnemyFromEvent(clientX, clientY);
    if (enemy) return { type: enemy.dead ? 'corpse' : 'enemy', enemy, title: enemy.dead ? `Труп: ${enemy.name}` : enemy.name };
    const container = findWorldContainerFromEvent(clientX, clientY);
    if (container) return { type: 'worldContainer', container, title: container.name || 'Ящик' };
    const groundItem = findGroundItemFromEvent(clientX, clientY);
    if (groundItem) {
      const item = ITEMS[groundItem.itemId];
      return { type: 'groundItem', groundItem, title: item ? item.name : 'Предмет' };
    }
    const trader = findTraderFromEvent(clientX, clientY);
    if (trader) return { type: 'trader', trader, title: trader.name || 'Торговец' };
    const storage = findStorageFromEvent(clientX, clientY);
    if (storage) return { type: 'storage', storage, title: storage.name || 'Хранилище' };
    const jobBoard = findJobBoardFromEvent(clientX, clientY);
    if (jobBoard) return { type: 'jobBoard', board: jobBoard, title: jobBoard.name || 'Доска заданий' };
    const craftingStation = findCraftingStationFromEvent(clientX, clientY);
    if (craftingStation) return { type: 'craftingStation', station: craftingStation, title: craftingStation.name || '\u0420\u0430\u0431\u043e\u0447\u0438\u0439 \u0441\u0442\u0430\u043d\u043e\u043a' };
    const tradeMachine = findTradeMachineFromEvent(clientX, clientY);
    if (tradeMachine) return { type: 'tradeMachine', machine: tradeMachine, title: tradeMachine.name || 'Торговый автомат' };
    const resource = findResourceFromEvent(clientX, clientY);
    if (resource) return { type: 'resource', resource, title: interactionResourceDef(resource).title };
    return null;
  }

  function buildWorldContextOptions(target) {
    if (!target) return [];
    if (target.type === 'remotePlayer') return buildRemotePlayerContextOptions(target.row);
    if (target.type === 'corpse') return [
      { label: 'Обыскать тело', action: () => openLootWindow(target.enemy) },
      { label: 'Забрать всё', action: () => { openLootWindow(target.enemy); takeAllLoot(); } }
    ];
    if (target.type === 'enemy') {
      const actor = target.enemy;
      const neutral = actor && actor.hostileToPlayer === false;
      const npcCombatAllowed = typeof currentLocationAllowsNpcCombat !== 'function' || currentLocationAllowsNpcCombat();
      if (neutral && typeof isSilentCreatureActor === 'function' && isSilentCreatureActor(actor)) {
        return [
          { label: 'Осмотреть', action: () => showTargetHint(actor) },
          ...(npcCombatAllowed ? [{ label: 'Атаковать', action: () => tryAttack(actor) }] : [])
        ];
      }
      if (neutral) {
        const options = [
          { label: '\u041f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c', action: () => talkToTraderQuest(actor) },
          (typeof npcScheduledTradeClosed === 'function' && npcScheduledTradeClosed(actor))
            ? { label: '\u041c\u0430\u0433\u0430\u0437\u0438\u043d \u0437\u0430\u043a\u0440\u044b\u0442', action: () => setReadout(`${actor.name || '\u0422\u043e\u0440\u0433\u043e\u0432\u0435\u0446'} \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442.`) }
            : { label: '\u0422\u043e\u0440\u0433\u043e\u0432\u0430\u0442\u044c', action: () => openTraderWindow(actor) }
        ];
        if (npcCombatAllowed) {
          if (actor.encounterRole === 'merchant') options.push({ label: '\u041e\u0433\u0440\u0430\u0431\u0438\u0442\u044c \u043a\u0430\u0440\u0430\u0432\u0430\u043d', action: () => robEncounterActor(actor) });
          else if (actor.faction === 'caravan' || actor.faction === 'klim_patrol') {
            options.push({ label: '\u041e\u0433\u0440\u0430\u0431\u0438\u0442\u044c', action: () => robEncounterActor(actor) });
            options.push({ label: '\u0410\u0442\u0430\u043a\u043e\u0432\u0430\u0442\u044c', action: () => tryAttack(actor) });
          } else options.push({ label: '\u0410\u0442\u0430\u043a\u043e\u0432\u0430\u0442\u044c', action: () => tryAttack(actor) });
        }
        options.push({ label: '\u041e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c', action: () => showTargetHint(actor) });
        return options;
      }
      if (!npcCombatAllowed) return [
        { label: 'Осмотреть цель', action: () => showTargetHint(actor) }
      ];
      return [
        { label: 'Атаковать', action: () => tryAttack(actor) },
        { label: 'Осмотреть цель', action: () => showTargetHint(actor) }
      ];
    }
    if (target.type === 'worldContainer') {
      const c = target.container || {};
      const options = [];
      if (c.terminalLocked) {
        const chance = typeof securityChancePercent === 'function' ? securityChancePercent(c, 'terminal') : '?';
        options.push({
          label: typeof securityActionLabel === 'function' ? securityActionLabel(c, 'terminal') : `Взломать терминал (${chance}%)`,
          hint: typeof securityTooltipText === 'function' ? securityTooltipText(c, 'terminal') : '',
          action: () => attemptHackTerminal(c)
        });
      }
      if (c.locked) {
        const chance = typeof securityChancePercent === 'function' ? securityChancePercent(c, 'lock') : '?';
        options.push({
          label: typeof securityActionLabel === 'function' ? securityActionLabel(c, 'lock') : `Взломать замок (${chance}%)`,
          disabled: !!c.terminalLocked,
          hint: c.terminalLocked ? 'Сначала нужен доступ к терминалу.' : (typeof securityTooltipText === 'function' ? securityTooltipText(c, 'lock') : ''),
          action: () => attemptPickLock(c)
        });
      }
      if (!c.locked && !c.terminalLocked) {
        options.push({ label: 'Открыть ящик', action: () => openWorldContainerWindow(c) });
      }
      options.push({ label: c.terminalLocked ? 'Защита: терминал' : (c.locked ? 'Защита: замок' : 'Защита снята'), disabled: true });
      return options;
    }
    if (target.type === 'groundItem') return [
      { label: 'Подобрать', action: () => pickupGroundItem(target.groundItem) }
    ];
    if (target.type === 'trader') {
      const hasWork = !Array.isArray(target.trader?.traderStock) && target.trader?.locationId === 'settlement';
      return [
        { label: hasWork ? 'Поговорить о работе' : 'Поговорить', action: talkToTraderQuest },
        { label: 'Торговать', action: openTraderWindow }
      ];
    }
    if (target.type === 'storage') return [
      { label: 'Открыть хранилище', action: openStorageWindow }
    ];
    if (target.type === 'jobBoard') return [
      { label: 'Открыть доску заданий', action: () => openWorldTaskBoardWindow(target.board) }
    ];
    if (target.type === 'craftingStation') return [
      { label: '\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0441\u0442\u0430\u043d\u043e\u043a', action: () => openCraftingStationWindow(target.station) }
    ];
    if (target.type === 'tradeMachine') return [
      { label: 'Торговать', action: () => openTraderWindow(target.machine) }
    ];
    if (target.type === 'resource') return [
      { label: interactionResourceDef(target.resource).menu, action: () => tryHarvestResourceWithHeldTool(target.resource) }
    ];
    return [];
  }
