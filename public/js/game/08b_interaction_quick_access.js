  function performUniversalInteract() {
    if (!gameStarted) return;
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return;
    const lootWin = document.getElementById('loot-window');
    if (activeLootEnemy && lootWin && lootWin.style.display === 'block') {
      takeAllLoot();
      return;
    }
    const cursorTarget = interactionTargetUnderCursor();
    if (tryUseHeldItemForInteraction(cursorTarget)) return;
    if (performCursorTargetInteraction(cursorTarget)) return;
    if (useLocationExit()) return;
    setReadout('Наведи курсор на предмет, НПС, ресурс, ящик или игрока для взаимодействия.');
  }

  function currentInteractionCursorPoint() {
    const lastX = Number(lastPointerClientX);
    const lastY = Number(lastPointerClientY);
    if (Number.isFinite(lastX) && Number.isFinite(lastY)) return { x: lastX, y: lastY };
    if (typeof quickUseFallbackPoint === 'function') {
      const p = quickUseFallbackPoint();
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
  }

  const INTERACTION_TARGET_CACHE_MS = 360;
  const INTERACTION_TARGET_SCREEN_EPS = 2.5;
  const INTERACTION_TARGET_WORLD_EPS = 0.18;
  let interactionTargetCache = {
    target: null,
    x: NaN,
    y: NaN,
    px: NaN,
    pz: NaN,
    cx: NaN,
    cz: NaN,
    at: 0
  };

  function invalidateInteractionTargetCache() {
    interactionTargetCache.at = 0;
    interactionTargetCache.target = null;
  }

  function interactionTargetCacheIsFresh(point, now) {
    if (!Number.isFinite(interactionTargetCache.at) || now - interactionTargetCache.at > INTERACTION_TARGET_CACHE_MS) return false;
    if (Math.hypot(Number(point.x || 0) - interactionTargetCache.x, Number(point.y || 0) - interactionTargetCache.y) > INTERACTION_TARGET_SCREEN_EPS) return false;
    if (Math.hypot(Number(player.x || 0) - interactionTargetCache.px, Number(player.z || 0) - interactionTargetCache.pz) > INTERACTION_TARGET_WORLD_EPS) return false;
    const camX = Number(camera?.position?.x || 0);
    const camZ = Number(camera?.position?.z || 0);
    if (Math.hypot(camX - interactionTargetCache.cx, camZ - interactionTargetCache.cz) > INTERACTION_TARGET_WORLD_EPS) return false;
    const target = interactionTargetCache.target;
    return !target || typeof worldContextTargetStillExists !== 'function' || worldContextTargetStillExists(target);
  }

  function interactionTargetUnderCursor(options = {}) {
    if (typeof buildWorldContextTarget !== 'function') return null;
    const p = currentInteractionCursorPoint();
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!options.force && interactionTargetCacheIsFresh(p, now)) return interactionTargetCache.target;
    const target = buildWorldContextTarget(p.x, p.y);
    interactionTargetCache = {
      target,
      x: Number(p.x || 0),
      y: Number(p.y || 0),
      px: Number(player.x || 0),
      pz: Number(player.z || 0),
      cx: Number(camera?.position?.x || 0),
      cz: Number(camera?.position?.z || 0),
      at: now
    };
    return target;
  }

  function performCursorTargetInteraction(target) {
    if (!target) return false;
    if (typeof isWorldContextTargetInRange === 'function' && !isWorldContextTargetInRange(target)) {
      setReadout('Нужно подойти ближе к цели под курсором.');
      return true;
    }
    if (typeof hideWorldContextMenu === 'function') hideWorldContextMenu();
    if (target.type === 'remotePlayer') {
      if (typeof openRemotePlayerActionWindow === 'function') return openRemotePlayerActionWindow(target.row, {});
      return false;
    }
    if (target.type === 'corpse') {
      openLootWindow(target.enemy);
      return true;
    }
    if (target.type === 'enemy') {
      const actor = target.enemy;
      if (actor?.hostileToPlayer === false && typeof isSilentCreatureActor === 'function' && isSilentCreatureActor(actor)) {
        showTargetHint(actor);
        return true;
      }
      if (!actor || actor.dead || actor._removed) return false;
      if (actor.hostileToPlayer === false) {
        if (typeof canTalkToNpcActor === 'function' && canTalkToNpcActor(actor) && typeof talkToTraderQuest === 'function') return talkToTraderQuest(actor);
        if (typeof isCaravanTrader === 'function' && isCaravanTrader(actor) && typeof talkToTraderQuest === 'function') return talkToTraderQuest(actor);
        showTargetHint(actor);
        return true;
      }
      if (typeof currentLocationAllowsNpcCombat === 'function' && !currentLocationAllowsNpcCombat()) {
        setReadout('В мирной локации нельзя атаковать НПС.');
        return true;
      }
      tryAttack(actor);
      return true;
    }
    if (target.type === 'worldContainer') {
      const c = target.container;
      if (c?.terminalLocked) return attemptHackTerminal(c);
      if (c?.locked) return attemptPickLock(c);
      return openWorldContainerWindow(c);
    }
    if (target.type === 'groundItem') return pickupGroundItem(target.groundItem);
    if (target.type === 'trader') return talkToTraderQuest(target.trader);
    if (target.type === 'storage') return openStorageWindow();
    if (target.type === 'jobBoard') return openWorldTaskBoardWindow(target.board);
    if (target.type === 'craftingStation') return openCraftingStationWindow(target.station);
    if (target.type === 'tradeMachine') return openTraderWindow(target.machine);
    if (target.type === 'resource') return tryHarvestResourceWithHeldTool(target.resource);
    return false;
  }

  function interactionHintForTarget(target) {
    if (!target) return '';
    const held = heldInteractionItemEntry();
    const heldBase = heldInteractionBaseId(held?.id || '');
    if (target.type === 'remotePlayer') {
      if (held && isMedicalInteractionItem(held.item)) return `E - применить ${held.item.name} к игроку.`;
      return 'E - меню игрока.';
    }
    if (target.type === 'corpse') return 'E - обыскать тело.';
    if (target.type === 'enemy') {
      const actor = target.enemy;
      if (actor?.hostileToPlayer === false && typeof isSilentCreatureActor === 'function' && isSilentCreatureActor(actor)) return 'E - осмотреть.';
      if (actor?.hostileToPlayer === false) return 'E - взаимодействовать с НПС.';
      return 'E - атаковать цель.';
    }
    if (target.type === 'worldContainer') {
      const c = target.container;
      if (c?.terminalLocked) return 'E - взломать терминал.';
      if (c?.locked) return 'E - взломать замок.';
      return 'E - открыть контейнер.';
    }
    if (target.type === 'groundItem') return 'E - подобрать предмет.';
    if (target.type === 'trader') return 'E - поговорить с торговцем.';
    if (target.type === 'storage') return 'E - открыть хранилище.';
    if (target.type === 'jobBoard') return 'E - открыть доску заданий.';
    if (target.type === 'tradeMachine') return 'E - открыть торговый автомат.';
    if (target.type === 'craftingStation') return 'E - \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u0441\u0442\u0430\u043d\u043e\u043a.';
    if (target.type === 'resource') {
      const def = interactionResourceDef(target.resource);
      return heldBase === def.toolId ? def.ready : def.need;
    }
    return '';
  }

  function heldInteractionItemEntry() {
    if (typeof currentHeldItem === 'function') return currentHeldItem();
    const id = equipment?.weapon || '';
    const item = id ? ITEMS[id] : null;
    return item ? { id, item } : null;
  }

  function isMedicalInteractionItem(item) {
    return !!(item && (item.heal || item.doctor || item.cureInfection));
  }

  function heldInteractionBaseId(id) {
    if (typeof baseItemId === 'function') return baseItemId(id);
    return String(id || '').replace(/^ui_/, '').split('_')[0];
  }

  const INTERACTION_RESOURCE_DEFS = {
    ore: { title: 'Руда', toolId: 'pickaxe', ready: 'E - добывать руду.', need: 'E - нужна кирка.', wrongTool: 'Для добычи руды возьмите кирку в руки.', menu: 'Добывать руду' },
    wood: { title: 'Древесина', toolId: 'axe', ready: 'E - рубить древесину.', need: 'E - нужен топор.', wrongTool: 'Для заготовки древесины возьмите топор в руки.', menu: 'Рубить древесину' },
    scrap: { title: 'Металлолом', toolId: 'pickaxe', ready: 'E - разбирать металлолом.', need: 'E - нужна кирка.', wrongTool: 'Для разборки металлолома возьмите кирку в руки.', menu: 'Разобрать металлолом' },
    water: { title: 'Водяная помпа', toolId: 'handPump', ready: 'E - качать воду.', need: 'E - нужен ручной насос.', wrongTool: 'Для откачки воды возьмите ручной насос в руки.', menu: 'Качать воду' },
    oil: { title: 'Нефтяная качалка', toolId: 'handPump', ready: 'E - добывать нефть.', need: 'E - нужен ручной насос.', wrongTool: 'Для добычи нефти возьмите ручной насос в руки.', menu: 'Добывать нефть' },
    chemicals: { title: 'Химический источник', toolId: 'handPump', ready: 'E - собирать химикаты.', need: 'E - нужен ручной насос.', wrongTool: 'Для сбора химикатов возьмите ручной насос в руки.', menu: 'Собрать химикаты' },
    medicine: { title: 'Лекарственные растения', toolId: 'axe', ready: 'E - собрать растения.', need: 'E - нужен топор.', wrongTool: 'Для сбора лекарственных растений возьмите топор в руки.', menu: 'Собрать растения' },
    food: { title: 'Пищевые заросли', toolId: 'axe', ready: 'E - заготовить пищу.', need: 'E - нужен топор.', wrongTool: 'Для заготовки пищи возьмите топор в руки.', menu: 'Заготовить пищу' },
    electronics: { title: 'Электронный лом', toolId: 'pickaxe', ready: 'E - разобрать электронику.', need: 'E - нужна кирка.', wrongTool: 'Для разбора электроники возьмите кирку в руки.', menu: 'Разобрать электронику' },
    ammoParts: { title: 'Детали патронов', toolId: 'pickaxe', ready: 'E - разобрать детали.', need: 'E - нужна кирка.', wrongTool: 'Для разбора деталей патронов возьмите кирку в руки.', menu: 'Разобрать детали' },
    weaponParts: { title: 'Оружейные детали', toolId: 'pickaxe', ready: 'E - разобрать детали.', need: 'E - нужна кирка.', wrongTool: 'Для разбора оружейных деталей возьмите кирку в руки.', menu: 'Разобрать детали' }
  };

  function interactionResourceDef(res) {
    return INTERACTION_RESOURCE_DEFS[String(res?.type || '').toLowerCase()] || INTERACTION_RESOURCE_DEFS.ore;
  }

  function localPlayerNeedsMedicalItem(item) {
    if (!item) return false;
    if (item.heal) return player.hp < player.maxHp - 0.5;
    if (item.doctor) return ['brokenArm', 'brokenLeg', 'concussion'].some(id => typeof hasInjury === 'function' && hasInjury(id));
    if (item.cureInfection) return typeof hasInjury === 'function' && hasInjury('infection');
    return false;
  }

  function remotePlayerNeedsMedicalItem(row, item) {
    if (!row || !item) return false;
    if (item.heal) {
      const maxHp = Math.max(1, Number(row.data?.maxHp || 100));
      const hp = Math.max(0, Number(row.data?.hp || maxHp));
      return hp < maxHp - 0.5;
    }
    if (item.doctor) return remotePlayerTreatableInjuries(row).length > 0;
    if (item.cureInfection) return !!remotePlayerInjuries(row).infection;
    return false;
  }

  function cursorRemotePlayerForHeldInteraction() {
    if (!multiplayer?.remotePlayers || !multiplayer.remotePlayers.size) return null;
    const p = typeof quickUseFallbackPoint === 'function'
      ? quickUseFallbackPoint()
      : { x: lastPointerClientX ?? window.innerWidth * 0.5, y: lastPointerClientY ?? window.innerHeight * 0.5 };
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const row = isMobileControlsEnabled()
      ? findMobileRemotePlayerFromTap(x, y)
      : findRemotePlayerFromEvent(x, y);
    return row?.data?.id ? row : null;
  }

  function cursorOverLocalPlayerForHeldInteraction() {
    const p = typeof quickUseFallbackPoint === 'function'
      ? quickUseFallbackPoint()
      : { x: lastPointerClientX ?? window.innerWidth * 0.5, y: lastPointerClientY ?? window.innerHeight * 0.5 };
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !camera || typeof THREE === 'undefined') return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const samples = [0.25, 0.75, 1.15, 1.55].map(offsetY => {
      const pt = new THREE.Vector3(player.x, offsetY, player.z);
      pt.project(camera);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y) || pt.z < -1 || pt.z > 1) return null;
      return {
        x: rect.left + (pt.x + 1) * 0.5 * rect.width,
        y: rect.top + (1 - pt.y) * 0.5 * rect.height
      };
    }).filter(Boolean);
    if (!samples.length) return false;
    let best = Infinity;
    samples.forEach(pt => { best = Math.min(best, Math.hypot(pt.x - x, pt.y - y)); });
    for (let i = 1; i < samples.length; i++) {
      best = Math.min(best, screenDistanceToSegment(x, y, samples[i - 1].x, samples[i - 1].y, samples[i].x, samples[i].y));
    }
    return best <= 92;
  }

  function heldMedicalRemoteTarget(item) {
    const cursorTarget = cursorRemotePlayerForHeldInteraction();
    if (cursorTarget) return cursorTarget;
    const rows = [];
    const selected = typeof getSelectedMobileRemotePlayer === 'function' ? getSelectedMobileRemotePlayer() : null;
    if (isMobileControlsEnabled() && selected && isWorldContextTargetInRange({ type: 'remotePlayer', row: selected })) rows.push(selected);
    const nearest = isMobileControlsEnabled() && typeof nearestRemotePlayerForContext === 'function' ? nearestRemotePlayerForContext(REMOTE_PLAYER_CONTEXT_INTERACT_DISTANCE) : null;
    if (nearest && !rows.some(row => row.data?.id === nearest.data?.id)) rows.push(nearest);
    return rows[0] || null;
  }

  function requiredHarvestToolForResource(res) {
    if (!res) return '';
    return interactionResourceDef(res).toolId || '';
  }

  function tryHarvestResourceWithHeldTool(res) {
    const required = requiredHarvestToolForResource(res);
    if (!required) return false;
    const held = heldInteractionItemEntry();
    const heldBase = heldInteractionBaseId(held?.id || '');
    if (heldBase !== required) {
      setReadout(interactionResourceDef(res).wrongTool);
      return true;
    }
    interactResource(res);
    return true;
  }

  function tryUseHeldItemForInteraction(target = null) {
    const held = heldInteractionItemEntry();
    if (!held) return false;
    const heldBase = heldInteractionBaseId(held.id);
    if (heldBase === 'pickaxe' || heldBase === 'axe' || heldBase === 'handPump') {
      if (target?.type === 'resource') return tryHarvestResourceWithHeldTool(target.resource);
      return false;
    }
    if (!isMedicalInteractionItem(held.item)) return false;
    if (target?.type === 'remotePlayer') {
      healRemotePlayer(target.row, held.id);
      return true;
    }
    if (cursorOverLocalPlayerForHeldInteraction() && typeof useMedicalItemOnSelf === 'function') {
      useMedicalItemOnSelf(held.id);
      return true;
    }
    return false;
  }


const QUICK_USE_RADIAL_HOLD_MS = 210;
let quickUseRadialState = null;
let quickAssignRadialState = null;
let quickUsePointerPosition = { x: 0, y: 0 };
let quickUseKeyboardPointerBound = false;
let quickUseRadialLastTapOpenAt = 0;

function rememberQuickUsePointer(clientX, clientY) {
  if (Number.isFinite(Number(clientX))) quickUsePointerPosition.x = Number(clientX);
  if (Number.isFinite(Number(clientY))) quickUsePointerPosition.y = Number(clientY);
}

function quickUseFallbackPoint() {
  return {
    x: Number(quickUsePointerPosition.x || window.innerWidth * 0.5),
    y: Number(quickUsePointerPosition.y || window.innerHeight * 0.5)
  };
}

function quickUsePointInsideButton(button, clientX, clientY, margin = 12) {
  if (!button || !button.getBoundingClientRect) return false;
  const r = button.getBoundingClientRect();
  const x = Number(clientX);
  const y = Number(clientY);
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= r.left - margin && x <= r.right + margin
    && y >= r.top - margin && y <= r.bottom + margin;
}

function bindQuickUseGlobalPointerTracking() {
  if (quickUseKeyboardPointerBound) return;
  quickUseKeyboardPointerBound = true;
  const move = e => {
    rememberQuickUsePointer(e.clientX, e.clientY);
    if (quickUseRadialState && quickUseRadialState.open) updateQuickUseRadialSelection(e.clientX, e.clientY);
  };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('mousemove', move, { passive: true });
}

function quickUseRadialEntries() {
  if (!Array.isArray(quickbarSlots)) return [];
  const entries = [];
  for (let i = 0; i < quickbarSlots.length; i++) {
    const id = quickbarSlots[i];
    const item = ITEMS[id];
    if (!id || !item) continue;
    const disabled = typeof quickSlotDisabled === 'function' ? quickSlotDisabled(i) : ((inventory.get(id) || 0) <= 0);
    entries.push({ index: i, id, item, disabled, count: typeof quickSlotCount === 'function' ? quickSlotCount(i) : '' });
  }
  return entries;
}

function ensureQuickUseRadialMenu() {
  let menu = document.getElementById('quick-use-radial-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'quick-use-radial-menu';
  menu.setAttribute('aria-hidden', 'true');
  document.body.appendChild(menu);
  return menu;
}

function quickUseRadialCenterFromButton(button, fallbackX, fallbackY) {
  const rect = button && button.getBoundingClientRect ? button.getBoundingClientRect() : null;
  if (rect && rect.width && rect.height) {
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    return { x, y };
  }
  const fallback = quickUseFallbackPoint();
  return { x: Number(fallbackX || fallback.x || window.innerWidth / 2), y: Number(fallbackY || fallback.y || window.innerHeight / 2) };
}

function openQuickUseRadial(button, clientX, clientY) {
  if (!gameStarted || paused || anyBlockingWindowOpenForQuickAccess()) return false;
  bindQuickUseGlobalPointerTracking();
  if (!quickUseRadialState) {
    const p = quickUseRadialCenterFromButton(button, clientX, clientY);
    quickUseRadialState = {
      pointerId: 'manual',
      startX: Number(clientX || p.x),
      startY: Number(clientY || p.y),
      open: false,
      selectedIndex: null,
      entries: [],
      center: p,
      timer: null,
      source: button && button.id ? button.id : 'manual'
    };
  }
  let entries = quickUseRadialEntries();
  const hasAssignedEntries = entries.length > 0;
  if (!hasAssignedEntries) {
    setReadout('Нет назначенных предметов в быстрых слотах.');
    entries = [{ index: -1, id: '', item: { icon: '—', name: 'Назначьте предмет' }, disabled: true, count: '' }];
  }
  const center = quickUseRadialCenterFromButton(button, clientX, clientY);
  const menu = ensureQuickUseRadialMenu();
  const radius = Math.max(66, Math.min(96, Math.min(window.innerWidth, window.innerHeight) * 0.16));
  menu.innerHTML = '';
  menu.className = 'quick-use-radial visible';
  menu.dataset.centerX = String(center.x);
  menu.dataset.centerY = String(center.y);
  menu.dataset.radius = String(radius);
  menu.setAttribute('aria-hidden', 'false');

  const centerNode = document.createElement('div');
  centerNode.className = 'quick-use-radial-center';
  centerNode.style.left = `${center.x}px`;
  centerNode.style.top = `${center.y}px`;
  centerNode.innerHTML = hasAssignedEntries ? '<b>Исп.</b><span>отпусти</span>' : '<b>Пусто</b><span>назначь</span>';
  menu.appendChild(centerNode);

  entries.forEach((entry, visualIndex) => {
    const angle = -Math.PI / 2 + visualIndex * Math.PI * 2 / entries.length;
    const itemNode = document.createElement('div');
    const entryIndex = Number(entry.index);
    itemNode.className = 'quick-use-radial-item' + (entry.disabled ? ' disabled' : '') + (entryIndex >= 0 && typeof quickSlotActive === 'function' && quickSlotActive(entryIndex) ? ' active' : '');
    itemNode.dataset.quickIndex = String(entryIndex);
    itemNode.dataset.visualIndex = String(visualIndex);
    itemNode.style.left = `${center.x + Math.cos(angle) * radius}px`;
    itemNode.style.top = `${center.y + Math.sin(angle) * radius}px`;
    itemNode.innerHTML = `<div class="quick-use-radial-icon">${entry.id && typeof itemArtHtml === 'function' ? itemArtHtml(entry.item) : ''}</div><div class="quick-use-radial-count">${entry.count || ''}</div>`;
    itemNode.title = entry.item.name || '';
    const activateFromTap = e => {
      const state = quickUseRadialState;
      if (!state || !state.persistent) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      e.stopImmediatePropagation?.();
      activateQuickUseRadialIndex(entryIndex);
    };
    itemNode.addEventListener('pointerdown', e => {
      if (quickUseRadialState && quickUseRadialState.persistent) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
    itemNode.addEventListener('pointerup', activateFromTap, { passive: false });
    itemNode.addEventListener('touchend', activateFromTap, { passive: false });
    menu.appendChild(itemNode);
  });

  quickUseRadialState.open = true;
  quickUseRadialState.entries = entries;
  quickUseRadialState.center = center;
  quickUseRadialState.radius = radius;
  quickUseRadialState.selectedIndex = null;
  document.body.classList.add('quick-use-radial-open');
  updateQuickUseRadialSelection(clientX, clientY);
  return true;
}

function updateQuickUseRadialSelection(clientX, clientY) {
  const state = quickUseRadialState;
  if (!state || !state.open || !state.entries || !state.entries.length) return null;
  const dx = Number(clientX || 0) - state.center.x;
  const dy = Number(clientY || 0) - state.center.y;
  const dist = Math.hypot(dx, dy);
  let selected = null;
  if (dist >= 28) {
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    while (angle < 0) angle += Math.PI * 2;
    while (angle >= Math.PI * 2) angle -= Math.PI * 2;
    const visualIndex = Math.round(angle / (Math.PI * 2 / state.entries.length)) % state.entries.length;
    const entry = state.entries[visualIndex];
    if (entry && !entry.disabled && Number(entry.index) >= 0) selected = entry.index;
  }
  state.selectedIndex = selected;
  const menu = document.getElementById('quick-use-radial-menu');
  if (menu) {
    menu.querySelectorAll('.quick-use-radial-item').forEach(node => {
      node.classList.toggle('selected', selected !== null && Number(node.dataset.quickIndex) === selected);
    });
  }
  return selected;
}


function activateQuickUseRadialIndex(index) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return false;
  if (!Array.isArray(quickbarSlots) || n >= quickbarSlots.length) return false;
  if (!quickbarSlots[n] || (typeof quickSlotDisabled === 'function' && quickSlotDisabled(n))) return false;
  closeQuickUseRadial(false);
  if (typeof activateQuickSlot === 'function') {
    activateQuickSlot(n);
    return true;
  }
  return false;
}

function closeQuickUseRadial(activate = false) {
  const state = quickUseRadialState;
  const selected = state && state.open ? state.selectedIndex : null;
  const menu = document.getElementById('quick-use-radial-menu');
  if (menu) {
    menu.classList.remove('visible', 'tap-mode');
    menu.removeAttribute('data-mode');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = '';
  }
  document.body.classList.remove('quick-use-radial-open');
  if (state && state.timer) clearTimeout(state.timer);
  if (state && state.outsideCloseHandler) {
    document.removeEventListener('pointerdown', state.outsideCloseHandler, true);
    document.removeEventListener('touchstart', state.outsideCloseHandler, true);
  }
  quickUseRadialState = null;
  if (activate && selected !== null && Number(selected) >= 0 && typeof activateQuickSlot === 'function') {
    activateQuickSlot(selected);
    return true;
  }
  return false;
}

function cancelQuickUseRadial() {
  closeQuickUseRadial(false);
}

function closeQuickAssignRadial() {
  const menu = document.getElementById('quick-use-radial-menu');
  if (menu && menu.dataset.mode === 'assign') {
    menu.classList.remove('visible', 'assign');
    menu.removeAttribute('data-mode');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = '';
  }
  document.body.classList.remove('quick-use-radial-open', 'quick-assign-radial-open');
  if (quickAssignRadialState && quickAssignRadialState.closeHandler) {
    document.removeEventListener('pointerdown', quickAssignRadialState.closeHandler, true);
  }
  if (quickAssignRadialState && quickAssignRadialState.keyHandler) {
    document.removeEventListener('keydown', quickAssignRadialState.keyHandler, true);
  }
  quickAssignRadialState = null;
}

function openQuickAssignRadial(itemId, clientX, clientY) {
  const item = ITEMS[itemId];
  if (!item) return false;
  if (typeof isQuickAssignableItem === 'function' && !isQuickAssignableItem(itemId)) {
    setReadout(`${item.name}: нельзя добавить в быстрый доступ.`);
    return false;
  }
  if (typeof assignQuickSlot !== 'function') return false;
  closeQuickUseRadial(false);
  closeQuickAssignRadial();
  hideTooltip?.();
  const menu = ensureQuickUseRadialMenu();
  const center = {
    x: Math.max(118, Math.min((window.innerWidth || 800) - 118, Number(clientX || window.innerWidth * 0.5))),
    y: Math.max(118, Math.min((window.innerHeight || 600) - 118, Number(clientY || window.innerHeight * 0.5)))
  };
  const radius = Math.max(78, Math.min(118, Math.min(window.innerWidth || 800, window.innerHeight || 600) * 0.18));
  menu.innerHTML = '';
  menu.className = 'quick-use-radial visible assign';
  menu.dataset.mode = 'assign';
  menu.dataset.centerX = String(center.x);
  menu.dataset.centerY = String(center.y);
  menu.dataset.radius = String(radius);
  menu.setAttribute('aria-hidden', 'false');

  const centerNode = document.createElement('div');
  centerNode.className = 'quick-use-radial-center assign-center';
  centerNode.style.left = `${center.x}px`;
  centerNode.style.top = `${center.y}px`;
  centerNode.innerHTML = `<b class="quick-use-radial-center-art">${typeof itemArtHtml === 'function' ? itemArtHtml(item) : ''}</b><span>выбери слот</span>`;
  menu.appendChild(centerNode);

  for (let i = 0; i < 8; i++) {
    const currentId = Array.isArray(quickbarSlots) ? quickbarSlots[i] : null;
    const current = currentId && ITEMS[currentId] ? ITEMS[currentId] : null;
    const angle = -Math.PI / 2 + i * Math.PI * 2 / 8;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'quick-use-radial-item assign-slot' + (currentId === itemId ? ' selected active' : '') + (!current ? ' empty' : '');
    node.dataset.quickIndex = String(i);
    node.style.left = `${center.x + Math.cos(angle) * radius}px`;
    node.style.top = `${center.y + Math.sin(angle) * radius}px`;
    node.innerHTML = `<div class="quick-use-radial-slot-num">${i + 1}</div><div class="quick-use-radial-icon">${current && typeof itemArtHtml === 'function' ? itemArtHtml(current) : '＋'}</div><div class="quick-use-radial-count">${current ? '' : ''}</div>`;
    node.title = current ? `Слот ${i + 1}: заменить ${current.name}` : `Слот ${i + 1}: пусто`;
    node.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
    node.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const alreadyAssignedHere = Array.isArray(quickbarSlots) && quickbarSlots[i] === itemId;
      if (assignQuickSlot(i, itemId) || alreadyAssignedHere) {
        setReadout(`${item.name} добавлен в быстрый доступ: слот ${i + 1}.`);
        closeQuickAssignRadial();
      }
    });
    menu.appendChild(node);
  }

  const closeHandler = e => {
    if (menu.contains(e.target)) return;
    closeQuickAssignRadial();
  };
  const keyHandler = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickAssignRadial();
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 8) {
      e.preventDefault();
      const alreadyAssignedHere = Array.isArray(quickbarSlots) && quickbarSlots[n - 1] === itemId;
      if (assignQuickSlot(n - 1, itemId) || alreadyAssignedHere) {
        setReadout(`${item.name} добавлен в быстрый доступ: слот ${n}.`);
        closeQuickAssignRadial();
      }
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', closeHandler, true), 0);
  document.addEventListener('keydown', keyHandler, true);
  quickAssignRadialState = { itemId, center, radius, closeHandler, keyHandler };
  document.body.classList.add('quick-use-radial-open', 'quick-assign-radial-open');
  return true;
}
