  // ===== QUICK ACCESS BAR =====
  const QUICK_KEYS = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'];
  const quickbarSlots = new Array(8).fill(null);

  function reconcileQuickbarUniqueReferences() {
    let changed = false;
    for (let i = 0; i < quickbarSlots.length; i++) {
      const id = quickbarSlots[i];
      if (!id) continue;
      if ((inventory.get(id) || 0) > 0) continue;
      const item = ITEMS[id];
      if (item && isUniqueEquipmentItem(id) && !isRuntimeItemId(id)) {
        const replacement = findFirstItemInstanceInMap(inventory, id, item.slot || null);
        if (replacement) { quickbarSlots[i] = replacement; changed = true; continue; }
      }
      if (!ITEMS[id] || isUniqueEquipmentItem(id)) { quickbarSlots[i] = null; changed = true; }
    }
    if (changed) renderQuickbar();
    return changed;
  }

  let draggedInventoryItem = null;
  let draggedQuickSlot = null;
  let quickDragDroppedOnSlot = false;
  let mobileQuickAssignItem = null;

  function setMobileQuickAssignItem(id) {
    if (!id || !isQuickAssignableItem(id)) {
      mobileQuickAssignItem = null;
    } else {
      mobileQuickAssignItem = id;
      const item = ITEMS[id];
      if (item) setReadout(`${item.name}: выберите слот 1–8 в блоке «Быстрые кнопки» сверху инвентаря.`);
    }
    renderInventory();
  }

  function ensureMobileInventoryQuickbarContainer() {
    const carry = document.getElementById('carry-line');
    if (!carry || !carry.parentNode) return null;
    let wrap = document.getElementById('mobile-inventory-quickbar');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mobile-inventory-quickbar';
      wrap.className = 'mobile-inventory-quickbar';
      carry.insertAdjacentElement('afterend', wrap);
    }
    return wrap;
  }

  function renderMobileInventoryQuickbar() {
    const wrap = ensureMobileInventoryQuickbarContainer();
    if (!wrap) return;
    const selected = mobileQuickAssignItem && ITEMS[mobileQuickAssignItem] ? ITEMS[mobileQuickAssignItem] : null;
    const mobile = isMobileControlsEnabled();
    wrap.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'mobile-quickbar-title';
    title.innerHTML = selected
      ? `<span><b>${selected.icon} ${selected.name}</b> — нажмите слот 1–8</span><button type="button" class="ui-btn" id="mobile-quick-cancel">Отмена</button>`
      : (mobile
        ? '<span><b>Быстрые кнопки</b>: нажмите ⚡ на предмете, потом слот 1–8</span>'
        : '<span><b>Быстрый доступ</b>: перетащите предмет в слот 1–8</span>');
    wrap.appendChild(title);
    const cancel = title.querySelector('#mobile-quick-cancel');
    if (cancel) cancel.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); mobileQuickAssignItem = null; renderInventory(); });
    const slots = document.createElement('div');
    slots.className = 'mobile-quickbar-slots';
    for (let i = 0; i < quickbarSlots.length; i++) {
      const id = quickbarSlots[i];
      const item = ITEMS[id];
      const disabled = quickSlotDisabled(i);
      const active = quickSlotActive(i);
      const div = document.createElement('div');
      div.className = 'quick-slot' + (id ? '' : ' empty') + (active ? ' active' : '') + (disabled ? ' disabled' : '') + (mobileQuickAssignItem ? ' assign-target' : '');
      div.dataset.quickIndex = String(i);
      div.dataset.dragArea = 'quickbar';
      if (id) div.dataset.itemId = id;
      div.innerHTML = `<div class="quick-key">${i + 1}</div><div class="quick-icon">${item ? itemArtHtml(item) : ''}</div><div class="quick-label">${item ? item.name : ''}</div><div class="quick-count">${quickSlotCount(i)}</div>`;
      if (item) bindPointerItemDrag(div, () => ({ source: 'quickbar', itemId: id, quickIndex: i }));
      bindInventoryQuickSlotDrop(div, i);
      const clearBtn = div.querySelector('.quick-clear');
      if (clearBtn) {
        clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
        clearBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearQuickSlot(i); });
      }
      const useOrAssignQuickSlot = e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (manualDragJustEnded) return;
        if (mobileQuickAssignItem) {
          const assignId = mobileQuickAssignItem;
          const alreadyAssignedHere = quickbarSlots[i] === assignId;
          const assigned = assignQuickSlot(i, assignId);
          if (assigned || alreadyAssignedHere) mobileQuickAssignItem = null;
          renderInventory();
        } else {
          activateQuickSlot(i);
        }
      };
      div.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
      div.addEventListener('pointerup', useOrAssignQuickSlot, { passive: false });
      div.addEventListener('touchend', useOrAssignQuickSlot, { passive: false });
      div.addEventListener('click', useOrAssignQuickSlot);
      slots.appendChild(div);
    }
    wrap.appendChild(slots);
  }

  function bindInventoryQuickSlotDrop(div, index) {
    if (!div) return;
    div.addEventListener('dragenter', e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragover', e => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      div.classList.add('drag-over');
    });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove('drag-over');
      const source = e.dataTransfer?.getData('text/source') || '';
      const fromRaw = e.dataTransfer?.getData('text/quick-slot') || '';
      if (source === 'quickbar' || fromRaw !== '') {
        const fromIndex = Number(fromRaw !== '' ? fromRaw : draggedQuickSlot);
        quickDragDroppedOnSlot = true;
        moveQuickSlot(fromIndex, index);
        draggedQuickSlot = null;
        return;
      }
      const itemId = e.dataTransfer?.getData('text/item-id') || e.dataTransfer?.getData('text/plain') || draggedInventoryItem;
      if (itemId) assignQuickSlot(index, itemId);
      draggedInventoryItem = null;
    });
  }

  function isQuickAssignableItem(id) {
    const item = ITEMS[id];
    if (!item) return false;
    if ((inventory.get(id) || 0) <= 0) return false;
    const equipSlot = typeof itemEquipSlot === 'function' ? itemEquipSlot(item) : (item.slot || item.equipSlot || '');
    return Boolean(equipSlot || item.type === 'consumable' || item.type === 'ammo');
  }

  function quickSlotDisabled(index) {
    const id = quickbarSlots[index];
    if (!id) return false;
    return (inventory.get(id) || 0) <= 0;
  }

  function quickSlotCount(index) {
    const id = quickbarSlots[index];
    if (!id) return '';
    const item = ITEMS[id];
    if (!item) return '';
    if (item.type === 'weapon') {
      if (item.ammoType) return `${item.loaded}/${item.magSize}`;
      return '';
    }
    const qty = inventory.get(id) || 0;
    return qty > 0 ? qty : '';
  }

  function quickSlotActive(index) {
    const id = quickbarSlots[index];
    if (!id) return false;
    return Object.values(equipment).includes(id);
  }

  function assignQuickSlot(index, itemId) {
    const slotIndex = Math.floor(Number(index));
    if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= quickbarSlots.length) return false;
    if (!isQuickAssignableItem(itemId)) {
      const item = ITEMS[itemId];
      setReadout(item ? `${item.name}: нельзя назначить на быстрый слот.` : 'Предмет нельзя назначить.');
      return false;
    }
    if (quickbarSlots[slotIndex] === itemId) {
      const item = ITEMS[itemId];
      if (item) setReadout(`${item.name}: уже назначен на быстрый слот ${slotIndex + 1}.`);
      return false;
    }
    if (!spendInventoryManipulationAp('quick-assign')) return false;
    quickbarSlots[slotIndex] = itemId;
    const item = ITEMS[itemId];
    draggedInventoryItem = null;
    setReadout(`${item.name} назначен на слот ${slotIndex + 1}. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.`);
    renderInventory();
    renderQuickbar();
    queueSave();
    return true;
  }

  function moveQuickSlot(fromIndex, toIndex) {
    const from = Math.floor(Number(fromIndex));
    const to = Math.floor(Number(toIndex));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    if (from === to) return false;
    if (from < 0 || to < 0 || from >= quickbarSlots.length || to >= quickbarSlots.length) return false;
    const sourceId = quickbarSlots[from];
    if (!sourceId) return false;
    const before = quickbarSlots.join('\u001f');
    const targetId = quickbarSlots[to];
    const nextSlots = quickbarSlots.slice();
    nextSlots[to] = sourceId;
    nextSlots[from] = targetId || null;
    if (nextSlots.join('\u001f') === before) return false;
    if (!spendInventoryManipulationAp('quick-move')) return false;
    quickbarSlots[to] = sourceId;
    quickbarSlots[from] = targetId || null;
    const item = ITEMS[sourceId];
    setReadout(item ? `${item.name}: перемещено в быстрый слот ${to + 1}. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.` : `Быстрый слот ${from + 1} перемещён. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.`);
    renderQuickbar();
    queueSave();
    return true;
  }

  function clearQuickSlot(index, silent = false) {
    const slotIndex = Math.floor(Number(index));
    if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= quickbarSlots.length) return false;
    const oldId = quickbarSlots[slotIndex];
    if (!oldId) return false;
    if (!silent && !spendInventoryManipulationAp('quick-clear')) return false;
    quickbarSlots[slotIndex] = null;
    if (!silent && oldId && ITEMS[oldId]) setReadout(`${ITEMS[oldId].name}: убрано из быстрого слота ${slotIndex + 1}. Потрачено ${INVENTORY_MANIPULATION_AP_COST} ОД.`);
    renderQuickbar();
    queueSave();
    return true;
  }

  function activateQuickSlot(index) {
    const id = quickbarSlots[index];
    if (!id || quickSlotDisabled(index)) return;
    useInventoryItem(id);
    renderInventory();
    renderQuickbar();
  }

  function renderQuickbar() {
    const bar = document.getElementById('quickbar');
    if (!bar) return;
    // v7.63: weapon shots used to rebuild all 8 quick slots and rebind all drag
    // handlers every shot. Cache the DOM if counts/active states did not change.
    const signature = quickbarSlots.map((id, i) => {
      const item = ITEMS[id];
      const count = quickSlotCount(i);
      return `${id || ''}:${item ? item.name : ''}:${count}:${quickSlotActive(i) ? 1 : 0}:${quickSlotDisabled(i) ? 1 : 0}`;
    }).join('|') + `|mobile:${isMobileControlsEnabled() ? 1 : 0}`;
    if (bar.dataset.renderSignature === signature) return;
    bar.dataset.renderSignature = signature;
    bar.innerHTML = '';

    // v7.75.68: on desktop the quickbar stays hidden because E-hold radial
    // is the main quick-use control. On mobile we restore the old stable
    // quick access slots as real tap buttons.
    if (!isMobileControlsEnabled()) {
      bar.style.display = 'none';
      bar.setAttribute('aria-hidden', 'true');
      return;
    }
    bar.style.display = '';
    bar.removeAttribute('aria-hidden');

    for (let i = 0; i < quickbarSlots.length; i++) {
      const id = quickbarSlots[i];
      const item = ITEMS[id];
      const disabled = quickSlotDisabled(i);
      const active = quickSlotActive(i);
      const div = document.createElement('div');
      div.className = 'quick-slot' + (id ? '' : ' empty') + (active ? ' active' : '') + (disabled ? ' disabled' : '');
      div.dataset.quickIndex = String(i);
      div.dataset.dragArea = 'quickbar';
      if (id) div.dataset.itemId = id;
      div.setAttribute('draggable', isMobileControlsEnabled() ? 'false' : 'true');
      div.innerHTML = `
        <div class="quick-key">${i + 1}</div>
        
        <div class="quick-icon">${item ? itemArtHtml(item) : ''}</div>
        <div class="quick-label">${item ? item.name : ''}</div>
        <div class="quick-count">${quickSlotCount(i)}</div>
      `;
      div.dataset.gameHint = item
        ? `${i + 1} — ${item.name}. Перетащите в другой быстрый слот для перемещения.`
        : `${i + 1} — перетащите предмет из инвентаря или другой быстрый слот`;

      const clearBtn = div.querySelector('.quick-clear');
      if (clearBtn) {
        clearBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
        clearBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearQuickSlot(i); });
      }

      div.addEventListener('click', () => { if (manualDragJustEnded) return; activateQuickSlot(i); });
      div.addEventListener('contextmenu', e => { e.preventDefault(); });
      if (item) bindPointerItemDrag(div, () => ({ source: 'quickbar', itemId: id, quickIndex: i }));

      div.addEventListener('dragstart', e => {
        if (!item) { e.preventDefault(); return; }
        draggedQuickSlot = i;
        quickDragDroppedOnSlot = false;
        e.dataTransfer.setData('text/source', 'quickbar');
        e.dataTransfer.setData('text/quick-slot', String(i));
        e.dataTransfer.setData('text/item-id', id);
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
      });

      div.addEventListener('dragend', () => {
        const shouldClear = draggedQuickSlot === i && !quickDragDroppedOnSlot;
        draggedQuickSlot = null;
        quickDragDroppedOnSlot = false;
        if (shouldClear) clearQuickSlot(i);
      });

      div.addEventListener('dragenter', e => { e.preventDefault(); div.classList.add('drag-over'); });
      div.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        div.classList.add('drag-over');
      });
      div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
      div.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        div.classList.remove('drag-over');
        const source = e.dataTransfer.getData('text/source');
        const fromRaw = e.dataTransfer.getData('text/quick-slot');
        if (source === 'quickbar' || fromRaw !== '') {
          const fromIndex = Number(fromRaw !== '' ? fromRaw : draggedQuickSlot);
          quickDragDroppedOnSlot = true;
          moveQuickSlot(fromIndex, i);
          draggedQuickSlot = null;
          return;
        }
        const itemId = e.dataTransfer.getData('text/item-id') || e.dataTransfer.getData('text/plain') || draggedInventoryItem;
        if (itemId) assignQuickSlot(i, itemId);
        draggedInventoryItem = null;
      });
      bar.appendChild(div);
    }
  }

  let quickbarOutsideDropBound = false;
  function bindQuickbarOutsideDrop() {
    if (quickbarOutsideDropBound) return;
    quickbarOutsideDropBound = true;
    document.addEventListener('dragover', e => {
      if (draggedQuickSlot === null || draggedQuickSlot === undefined) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }, true);
    document.addEventListener('drop', e => {
      if (draggedQuickSlot === null || draggedQuickSlot === undefined) return;
      const overQuickbar = !!(e.target && e.target.closest && e.target.closest('.quick-slot'));
      if (overQuickbar) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(draggedQuickSlot);
      draggedQuickSlot = null;
      quickDragDroppedOnSlot = true;
      if (Number.isFinite(idx)) clearQuickSlot(idx);
    }, true);
  }
  bindQuickbarOutsideDrop();

  let inventoryOutsideDropBound = false;
  function isMainInventoryOutsideDrop(e) {
    if (!e) return false;
    const inventoryWindow = document.getElementById('inventory-window');
    if (!inventoryWindow || !inventoryWindow.classList.contains('visible')) return false;
    const itemId = draggedInventoryItem || e.dataTransfer?.getData('text/item-id') || e.dataTransfer?.getData('text/plain');
    if (!itemId || !inventory.has(itemId)) return false;
    const source = e.dataTransfer?.getData('text/source') || 'inventory-main';
    if (source !== 'inventory-main') return false;
    const el = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (typeof closestDropTarget === 'function' && closestDropTarget(el)) return false;
    if (typeof isPointInsideInventoryWindow === 'function' && isPointInsideInventoryWindow(e.clientX, e.clientY)) return false;
    return true;
  }

  function bindInventoryOutsideDrop() {
    if (inventoryOutsideDropBound) return;
    inventoryOutsideDropBound = true;
    document.addEventListener('dragover', e => {
      if (!isMainInventoryOutsideDrop(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }, true);
    document.addEventListener('drop', e => {
      if (!isMainInventoryOutsideDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const itemId = draggedInventoryItem || e.dataTransfer?.getData('text/item-id') || e.dataTransfer?.getData('text/plain');
      draggedInventoryItem = null;
      if (itemId) requestDropInventoryItemWithConfirm(itemId);
    }, true);
  }
  bindInventoryOutsideDrop();
