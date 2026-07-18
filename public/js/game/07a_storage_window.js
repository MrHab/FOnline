  // ===== STORAGE =====
  let storageWindowOpen = false;
  let draggedStorageItem = null;
  let baseStorageRestockDay = null;
  let baseStorageRestockCheckTimer = 0;
  let storageTransferPending = false;

  // Тестовый ящик на базе: каждый игровой день восстанавливает минимум по одному
  // экземпляру всех видов оружия и брони. Личные вещи игрока не удаляются.
  const BASE_STORAGE_RESTOCK_ITEMS = {};

  function storageToObject() {
    return Object.fromEntries(Array.from(storageInventory.entries()).filter(([, qty]) => qty > 0));
  }

  function applyServerStorageSnapshot(rows = []) {
    if (!Array.isArray(rows)) return false;
    storageInventory.clear();
    rows.slice(0, 160).forEach(row => {
      const id = baseItemId(row?.id || row?.itemId || '');
      const qty = Math.max(0, Math.floor(Number(row?.qty ?? row?.count ?? 0)));
      if (!id || id === 'fists' || !ITEMS[id] || qty <= 0) return;
      storageInventory.set(id, (storageInventory.get(id) || 0) + qty);
    });
    if (storageWindowOpen) renderStorageWindow();
    queueSave(true);
    return true;
  }

  function submitServerStorageTransfer(direction, rows = []) {
    if (storageTransferPending) {
      setReadout('Дождитесь подтверждения предыдущего переноса.');
      return false;
    }
    if (!findNearbyStorage()) {
      setReadout('Рядом нет хранилища.');
      return false;
    }
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Хранилище недоступно без соединения с сервером мира.');
      return false;
    }
    const normalized = rows.map(row => ({
      id: baseItemId(row?.id || ''),
      qty: Math.max(0, Math.floor(Number(row?.qty || 0)))
    })).filter(row => row.id && row.id !== 'silver' && row.qty > 0);
    if (!normalized.length) return false;
    storageTransferPending = true;
    multiplayer.socket.emit('storageTransfer', { direction, rows: normalized }, ack => {
      storageTransferPending = false;
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') {
        applyServerAuthoritativePlayerState(ack.self);
      } else {
        if (Array.isArray(ack?.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
        if (Array.isArray(ack?.storage)) applyServerStorageSnapshot(ack.storage);
      }
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил перенос.');
        renderStorageWindow();
        return;
      }
      const total = normalized.reduce((sum, row) => sum + row.qty, 0);
      setReadout(direction === 'deposit'
        ? `В хранилище перенесено предметов: ${total}.`
        : `Из хранилища забрано предметов: ${total}.`);
      refreshInventoryDependentUI();
    });
    return true;
  }

  function restockBaseStorage(force = false, opts = {}) {
    const day = currentGameDayIndex();
    baseStorageRestockDay = day;
    return false;
  }

  function updateBaseStorageRestock(dt) {
    baseStorageRestockCheckTimer += dt;
    if (baseStorageRestockCheckTimer < 5) return;
    baseStorageRestockCheckTimer = 0;
    restockBaseStorage(false, { silent: !storageWindowOpen });
  }

  function addStorageItem(id, qty = 1, opts = {}) {
    const item = ITEMS[id];
    const count = Math.max(1, Math.floor(Number(qty || 1)));
    if (!item || count <= 0) return false;
    if (isUniqueEquipmentItem(id)) {
      for (let i = 0; i < count; i++) {
        let instanceId = null;
        if (isRuntimeItemId(id) && i === 0 && !storageInventory.has(id)) instanceId = id;
        else instanceId = createRuntimeItemInstance(id);
        if (instanceId) storageInventory.set(instanceId, 1);
      }
    } else {
      storageInventory.set(id, (storageInventory.get(id) || 0) + count);
    }
    if (!opts.noRender) renderStorageWindow();
    if (!opts.noSave) queueSave();
    return true;
  }

  function removeStorageItem(id, qty = 1) {
    const cur = storageInventory.get(id) || 0;
    if (cur < qty) return false;
    const next = cur - qty;
    if (next <= 0) storageInventory.delete(id); else storageInventory.set(id, next);
    renderStorageWindow();
    queueSave();
    return true;
  }

  function findNearbyStorage(maxDist = 3.2) {
    if (!storageBox) return null;
    const d = Math.hypot(storageBox.x - player.x, storageBox.z - player.z);
    return d <= maxDist ? storageBox : null;
  }

  function openStorageWindow() {
    const box = findNearbyStorage();
    if (!box) {
      setReadout('Рядом нет хранилища.');
      return;
    }
    closeLootWindow();
    closeTraderWindow();
    closeAllWindows(false);
    storageWindowOpen = true;
    document.body.classList.add('storage-window-open');
    const win = document.getElementById('storage-window');
    if (win) win.style.display = 'block';
    const title = document.getElementById('storage-title');
    if (title) title.textContent = box.name || 'Хранилище';
    restockBaseStorage(false, { silent: true });
    renderStorageWindow();
    setReadout('Хранилище открыто. Перетащите предметы между рюкзаком и ящиком.');
  }

  function closeStorageWindow() {
    closeQuantityPanel();
    const win = document.getElementById('storage-window');
    if (win) win.style.display = 'none';
    storageWindowOpen = false;
    document.body.classList.remove('storage-window-open');
    draggedStorageItem = null;
    renderInventory();
  }

  function isProtectedInventoryItem(id) {
    if (!id || id === 'silver') return true;
    if (Object.values(equipment || {}).includes(id)) return true;
    const w = currentWeapon();
    if (w && w.ammoType && id === w.ammoType) return true;
    return false;
  }

  function transferInventoryToStorage(id, qty = 1) {
    const item = ITEMS[id];
    if (!item || isProtectedInventoryItem(id)) {
      setReadout('Этот предмет используется персонажем и остаётся в рюкзаке.');
      return false;
    }
    const have = inventory.get(id) || 0;
    const take = Math.min(qty, have);
    if (take <= 0) return false;
    return submitServerStorageTransfer('deposit', [{ id, qty: take }]);
  }

  function transferStorageToInventory(id, qty = 1) {
    const item = ITEMS[id];
    if (!item) return false;
    const have = storageInventory.get(id) || 0;
    const take = Math.min(qty, have);
    if (take <= 0) return false;
    if (!canCarryItem(id, take)) {
      setReadout(`${item.name}: рюкзак перегружен. Свободный вес: ${formatWeight(carryCapacity() - inventoryWeight())}.`);
      return false;
    }
    return submitServerStorageTransfer('withdraw', [{ id, qty: take }]);
  }



  function requestStorageTransfer(id, source, qty = null) {
    const item = ITEMS[id];
    if (!item) return false;
    const max = source === 'inventory' ? (inventory.get(id) || 0) : (storageInventory.get(id) || 0);
    if (max <= 0) return false;
    const doTransfer = amount => source === 'inventory' ? transferInventoryToStorage(id, amount) : transferStorageToInventory(id, amount);
    if (qty && qty > 0) return doTransfer(qty);
    if (source === 'storage') {
      const carryMax = finiteMaxCarryableQty(id, max);
      if (carryMax <= 0) {
        setReadout(`${item.name}: нет свободного веса. Свободно ${formatWeight(freeCarryWeight())} кг.`);
        return false;
      }
      if (max > 1) {
        return openQuantityPanel({
          title: `${item.name}`,
          sub: carryMax < max ? `Забрать в рюкзак. В ящике: ${max}. Можно унести: ${carryMax}.` : `Забрать в рюкзак. Доступно: ${max}`,
          max: carryMax,
          value: carryMax,
          onConfirm: doTransfer
        });
      }
    }
    if (max > 1) {
      return openQuantityPanel({
        title: `${item.name}`,
        sub: source === 'inventory' ? `Положить в хранилище. Доступно: ${max}` : `Забрать в рюкзак. Доступно: ${max}`,
        max,
        value: max,
        onConfirm: doTransfer
      });
    }
    return doTransfer(1);
  }

  function putAllToStorage() {
    const rows = Array.from(inventory.entries())
      .filter(([id, qty]) => ITEMS[id] && !isProtectedInventoryItem(id) && qty > 0)
      .map(([id, qty]) => ({ id, qty }));
    if (!rows.length) return setReadout('Нечего положить в хранилище.');
    submitServerStorageTransfer('deposit', rows);
  }

  function takeAllFromStorage() {
    const rows = Array.from(storageInventory.entries())
      .filter(([id, qty]) => ITEMS[id] && qty > 0)
      .map(([id, qty]) => ({ id, qty }));
    if (!rows.length) return setReadout('Хранилище пусто.');
    submitServerStorageTransfer('withdraw', rows);
  }

  function mapForStorageSource(source) {
    return source === 'storage' ? storageInventory : inventory;
  }

  function bindStorageSlotReorder(card, targetSource, targetId = null, targetIndex = null) {
    if (!card) return;
    card.addEventListener('dragover', e => {
      const source = e.dataTransfer?.getData('text/source');
      if (source && !['inventory', 'storage', 'inventory-main'].includes(source)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over-slot');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over-slot');
    });
    card.addEventListener('drop', e => {
      let source = e.dataTransfer?.getData('text/source') || (draggedStorageItem ? 'storage' : 'inventory');
      if (source === 'inventory-main') source = 'inventory';
      if (!['inventory', 'storage'].includes(source)) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-over-slot');
      hideTooltip();
      const draggedId = e.dataTransfer?.getData('text/item-id') || (source === 'storage' ? draggedStorageItem : draggedInventoryItem);
      if (!draggedId) return;
      if (source !== targetSource) {
        requestStorageTransfer(draggedId, source);
      } else {
        const map = mapForStorageSource(source);
        const index = targetIndex !== null && targetIndex !== undefined ? targetIndex : Number(card.dataset.slotIndex);
        if (reorderMapEntryAtIndex(map, draggedId, targetId, Number.isFinite(index) ? index : null)) {
          renderInventory();
          renderStorageWindow();
          setReadout(source === 'storage' ? 'Предмет перемещён в ячейку хранилища.' : 'Предмет перемещён в ячейку рюкзака.');
        }
      }
      draggedInventoryItem = null;
      draggedStorageItem = null;
    });
  }

  function renderStorageCard(id, qty, source) {
    const item = ITEMS[id];
    const card = document.createElement('div');
    const carryMax = source === 'storage' ? finiteMaxCarryableQty(id, qty) : qty;
    const carryLimited = source === 'storage' && carryMax < qty;
    const carryBlocked = source === 'storage' && carryMax <= 0;
    card.className = 'inv-card'
      + (source === 'inventory' && Object.values(equipment).includes(id) ? ' equipped' : '')
      + (carryLimited ? ' carry-limited' : '')
      + (carryBlocked ? ' disabled carry-blocked' : '');
    card.dataset.dragArea = source;
    card.dataset.itemId = id;
    const count = qty > 1 || ['ammo', 'money', 'material', 'loot'].includes(item.type) ? `<div class="inv-count">${qty}</div>` : '';
    card.innerHTML = `<div class="inv-weight">${formatWeight(itemWeight(id) * qty)}</div><div class="inv-emoji">${itemArtHtml(item)}</div><div class="inv-name">${item.name}</div>${count}`;
    card.setAttribute('draggable', isMobileControlsEnabled() ? 'false' : 'true');
    card.dataset.gameHint = source === 'inventory'
      ? 'Перетащите в ящик или дважды нажмите.'
      : (carryLimited ? carryLimitText(id, qty) : 'Перетащите в рюкзак или дважды нажмите.');
    card.addEventListener('dragstart', e => {
      hideTooltip();
      if (id === 'silver') { e.preventDefault(); return; }
      if (source === 'inventory') draggedInventoryItem = id; else draggedStorageItem = id;
      e.dataTransfer.setData('text/item-id', id);
      e.dataTransfer.setData('text/source', source);
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => { draggedInventoryItem = null; draggedStorageItem = null; });
    card.addEventListener('click', e => {
      if (manualDragJustEnded) { e.preventDefault(); e.stopPropagation(); return; }
      if (!isMobileControlsEnabled()) return;
      e.preventDefault();
      requestStorageTransfer(id, source);
    });
    card.addEventListener('dblclick', e => {
      e.preventDefault();
      requestStorageTransfer(id, source);
    });
    bindMobileItemLongPress(card, id);
    bindPointerItemDrag(card, () => ({ source, itemId: id }));
    card.addEventListener('mouseenter', e => showTooltip(e, source === 'storage' && carryLimited ? gameTooltipItem(item, carryLimitText(id, qty)) : item));
    card.addEventListener('mousemove', moveTooltip);
    card.addEventListener('mouseleave', hideTooltip);
    return card;
  }

  function setupStorageDropZone(grid, target) {
    grid.ondragenter = e => { e.preventDefault(); grid.classList.add('drag-over'); };
    grid.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; grid.classList.add('drag-over'); };
    grid.ondragleave = e => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('drag-over'); };
    grid.ondrop = e => {
      e.preventDefault();
      grid.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/item-id') || e.dataTransfer.getData('text/plain') || draggedInventoryItem || draggedStorageItem;
      let source = e.dataTransfer.getData('text/source') || (draggedStorageItem ? 'storage' : 'inventory');
      if (source === 'inventory-main') source = 'inventory';
      hideTooltip();
      if (!id) return;
      if (target === source) {
        const map = mapForStorageSource(source);
        reorderMapEntry(map, id, null);
        renderStorageWindow();
        renderInventory();
      } else {
        if (target === 'storage' && source === 'inventory') requestStorageTransfer(id, 'inventory');
        if (target === 'inventory' && source === 'storage') requestStorageTransfer(id, 'storage');
      }
      draggedInventoryItem = null;
      draggedStorageItem = null;
    };
  }

  function appendStorageEmptyCells(grid, source, startIndex, minSlots = 20) {
    const visibleSlots = Math.max(minSlots, Math.ceil(Math.max(startIndex, 1) / 4) * 4);
    for (let i = startIndex; i < visibleSlots; i++) {
      const empty = document.createElement('div');
      empty.className = 'inv-card empty-slot';
      empty.dataset.dragArea = source;
      empty.dataset.slotIndex = String(i);
      empty.innerHTML = '<div class="empty-slot-mark">·</div>';
      bindStorageSlotReorder(empty, source, null, i);
      grid.appendChild(empty);
    }
  }

  function renderStorageWindow() {
    if (!storageWindowOpen) return;
    const invGrid = document.getElementById('storage-inventory-grid');
    const boxGrid = document.getElementById('storage-grid');
    if (!invGrid || !boxGrid) return;
    invGrid.innerHTML = '';
    boxGrid.innerHTML = '';
    const inventoryEntries = Array.from(inventory.entries()).map(([id, qty], slotIndex) => ({ id, qty, slotIndex }))
      .filter(row => ITEMS[row.id] && row.qty > 0 && row.id !== 'silver');
    const storageEntries = Array.from(storageInventory.entries()).map(([id, qty], slotIndex) => ({ id, qty, slotIndex }))
      .filter(row => ITEMS[row.id] && row.qty > 0);
    renderItemCategoryTabs('storage-inventory-category-tabs', 'storageInventory', inventoryEntries.map(row => [row.id, row.qty]));
    renderItemCategoryTabs('storage-category-tabs', 'storage', storageEntries.map(row => [row.id, row.qty]));
    const storageInvCategory = itemCategoryFilters.storageInventory || 'all';
    const storageBoxCategory = itemCategoryFilters.storage || 'all';
    let invIndex = 0;
    inventoryEntries.filter(row => itemMatchesCategory(row.id, storageInvCategory)).forEach(({ id, qty }) => {
      const card = renderStorageCard(id, qty, 'inventory');
      card.dataset.slotIndex = String(invIndex);
      bindStorageSlotReorder(card, 'inventory', id, invIndex);
      invGrid.appendChild(card);
      invIndex++;
    });
    if (storageInvCategory === 'all') appendStorageEmptyCells(invGrid, 'inventory', invIndex, 20);
    else if (!invIndex) invGrid.innerHTML = `<div class="storage-empty">В разделе «${itemCategoryLabel(storageInvCategory)}» пусто.</div>`;

    let boxIndex = 0;
    storageEntries.filter(row => itemMatchesCategory(row.id, storageBoxCategory)).forEach(({ id, qty }) => {
      const card = renderStorageCard(id, qty, 'storage');
      card.dataset.slotIndex = String(boxIndex);
      bindStorageSlotReorder(card, 'storage', id, boxIndex);
      boxGrid.appendChild(card);
      boxIndex++;
    });
    if (storageBoxCategory === 'all') appendStorageEmptyCells(boxGrid, 'storage', boxIndex, 20);
    else if (!boxIndex) boxGrid.innerHTML = `<div class="storage-empty">В разделе «${itemCategoryLabel(storageBoxCategory)}» пусто.</div>`;
    setupStorageDropZone(invGrid, 'inventory');
    setupStorageDropZone(boxGrid, 'storage');
    const takeAllBtn = document.getElementById('storage-take-all');
    if (takeAllBtn) {
      const storageLoot = Array.from(storageInventory.entries())
        .filter(([id, qty]) => ITEMS[id] && qty > 0)
        .map(([id, qty]) => ({ id, qty }));
      const canTakeAll = canCarryFullLootList(storageLoot);
      takeAllBtn.disabled = storageLoot.length === 0 || !canTakeAll;
      takeAllBtn.classList.toggle('carry-blocked', storageLoot.length > 0 && !canTakeAll);
      if (storageLoot.length > 0 && !canTakeAll) takeAllBtn.dataset.gameHint = 'Не хватает переносимого веса, чтобы забрать всё.'; else delete takeAllBtn.dataset.gameHint;
      takeAllBtn.removeAttribute('title');
    }
    updateCarryReadouts();
  }

