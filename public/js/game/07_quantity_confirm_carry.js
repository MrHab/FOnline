  // ===== QUANTITY SELECTOR =====
  const quantityPanelState = { max: 1, value: 1, title: '', sub: '', onConfirm: null };

  function clampQty(v, max = quantityPanelState.max) {
    return Math.max(1, Math.min(Math.max(1, Number(max) || 1), Math.floor(Number(v) || 1)));
  }

  function updateQuantityPanelUI() {
    const panel = document.getElementById('quantity-side-panel');
    if (!panel) return;
    const max = Math.max(1, Number(quantityPanelState.max) || 1);
    quantityPanelState.value = clampQty(quantityPanelState.value, max);
    const title = document.getElementById('qty-title');
    const sub = document.getElementById('qty-sub');
    const val = document.getElementById('qty-value');
    const range = document.getElementById('qty-range');
    if (title) title.textContent = quantityPanelState.title || 'Количество';
    if (sub) sub.textContent = quantityPanelState.sub || `Доступно: ${max}`;
    if (val) { val.max = String(max); val.value = String(quantityPanelState.value); }
    if (range) { range.max = String(max); range.value = String(quantityPanelState.value); }
  }

  function closeQuantityPanel() {
    const panel = document.getElementById('quantity-side-panel');
    if (panel) {
      panel.classList.remove('visible');
      panel.setAttribute('aria-hidden', 'true');
    }
    quantityPanelState.onConfirm = null;
    updateMobilePanelState();
  }

  function openQuantityPanel({ title = 'Количество', sub = '', max = 1, value = 1, onConfirm = null } = {}) {
    const panel = document.getElementById('quantity-side-panel');
    if (!panel) return false;
    quantityPanelState.max = Math.max(1, Math.floor(Number(max) || 1));
    quantityPanelState.value = clampQty(value || 1, quantityPanelState.max);
    quantityPanelState.title = title;
    quantityPanelState.sub = sub || `Доступно: ${quantityPanelState.max}`;
    quantityPanelState.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    updateQuantityPanelUI();
    updateMobilePanelState();
    return true;
  }

  function initQuantityPanel() {
    const panel = document.getElementById('quantity-side-panel');
    if (!panel || panel.dataset.boundQty === '1') return;
    panel.dataset.boundQty = '1';
    const setVal = v => { quantityPanelState.value = clampQty(v); updateQuantityPanelUI(); };
    document.getElementById('qty-dec')?.addEventListener('click', () => setVal(quantityPanelState.value - 1));
    document.getElementById('qty-inc')?.addEventListener('click', () => setVal(quantityPanelState.value + 1));
    document.getElementById('qty-one')?.addEventListener('click', () => setVal(1));
    document.getElementById('qty-half')?.addEventListener('click', () => setVal(Math.ceil(quantityPanelState.max / 2)));
    document.getElementById('qty-max')?.addEventListener('click', () => setVal(quantityPanelState.max));
    document.getElementById('qty-value')?.addEventListener('input', e => setVal(e.target.value));
    document.getElementById('qty-range')?.addEventListener('input', e => setVal(e.target.value));
    document.getElementById('qty-cancel')?.addEventListener('click', closeQuantityPanel);
    document.getElementById('qty-confirm')?.addEventListener('click', () => {
      const qty = clampQty(quantityPanelState.value);
      const cb = quantityPanelState.onConfirm;
      closeQuantityPanel();
      if (cb) cb(qty);
    });
    panel.addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
    panel.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  }

  // ===== GAME-STYLE CONFIRMATION PANEL =====
  const gameConfirmPanelState = { onConfirm: null, onCancel: null, previousFocus: null };

  function ensureGameConfirmPanel() {
    let backdrop = document.getElementById('game-confirm-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'game-confirm-backdrop';
      backdrop.className = 'game-confirm-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      const stopBackdrop = e => {
        e.stopPropagation();
        if (e.type === 'pointerdown') e.preventDefault();
      };
      backdrop.addEventListener('pointerdown', stopBackdrop, { passive: false });
      backdrop.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
      document.body.appendChild(backdrop);
    }
    let panel = document.getElementById('game-confirm-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'game-confirm-panel';
    panel.className = 'ui-panel game-confirm-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'game-confirm-title');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="game-confirm-kicker" id="game-confirm-kicker">Подтверждение</div>
      <div class="game-confirm-title" id="game-confirm-title">Подтвердить действие</div>
      <div class="game-confirm-item">
        <div class="game-confirm-icon" id="game-confirm-icon"></div>
        <div class="game-confirm-copy">
          <b id="game-confirm-item-name"></b>
          <span id="game-confirm-body"></span>
        </div>
      </div>
      <div class="game-confirm-note" id="game-confirm-note"></div>
      <div class="game-confirm-actions">
        <button id="game-confirm-cancel" class="ui-btn" type="button">Отмена</button>
        <button id="game-confirm-confirm" class="ui-btn" type="button">Подтвердить</button>
      </div>`;
    document.body.appendChild(panel);

    const stop = e => {
      e.stopPropagation();
      if (e.type === 'pointerdown') e.preventDefault();
    };
    panel.addEventListener('pointerdown', stop, { passive: false });
    panel.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    panel.querySelector('#game-confirm-cancel')?.addEventListener('click', () => closeGameConfirmPanel(true));
    panel.querySelector('#game-confirm-confirm')?.addEventListener('click', () => {
      const cb = gameConfirmPanelState.onConfirm;
      closeGameConfirmPanel(false);
      if (cb) cb();
    });
    document.addEventListener('keydown', e => {
      const active = panel.classList.contains('visible') && panel.style.display !== 'none';
      if (!active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGameConfirmPanel(true);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cancel = panel.querySelector('#game-confirm-cancel');
        const confirm = panel.querySelector('#game-confirm-confirm');
        if (e.shiftKey) {
          (document.activeElement === cancel ? confirm : cancel)?.focus();
        } else {
          (document.activeElement === confirm ? cancel : confirm)?.focus();
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const focused = panel.contains(document.activeElement) ? document.activeElement : null;
        if (focused?.id === 'game-confirm-confirm') {
          focused.click();
        } else {
          panel.querySelector('#game-confirm-cancel')?.click();
        }
      }
    });
    return panel;
  }

  function closeGameConfirmPanel(runCancel = false) {
    const panel = document.getElementById('game-confirm-panel');
    const backdrop = document.getElementById('game-confirm-backdrop');
    const cancelCb = gameConfirmPanelState.onCancel;
    const previousFocus = gameConfirmPanelState.previousFocus;
    gameConfirmPanelState.onConfirm = null;
    gameConfirmPanelState.onCancel = null;
    gameConfirmPanelState.previousFocus = null;
    if (panel) {
      panel.classList.remove('visible');
      panel.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) {
      backdrop.classList.remove('visible');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (runCancel && cancelCb) cancelCb();
    if (previousFocus?.isConnected) {
      setTimeout(() => {
        if (!panel?.classList.contains('visible')) previousFocus.focus();
      }, 0);
    }
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function openGameConfirmPanel({ kicker = 'Подтверждение', title = 'Подтвердить действие', itemId = '', itemName = '', body = '', note = '', iconText = '', confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', onConfirm = null, onCancel = null } = {}) {
    const panel = ensureGameConfirmPanel();
    if (!panel) return false;
    closeQuantityPanel();
    hideTooltip();
    hideItemContextMenu();
    if (typeof hideWorldContextMenu === 'function') hideWorldContextMenu();
    gameConfirmPanelState.previousFocus = document.activeElement;
    gameConfirmPanelState.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    gameConfirmPanelState.onCancel = typeof onCancel === 'function' ? onCancel : null;
    const item = itemId ? ITEMS[itemId] : null;
    const icon = panel.querySelector('#game-confirm-icon');
    if (icon) {
      icon.innerHTML = '';
      if (item) icon.innerHTML = itemArtHtml(item);
      else if (iconText) {
        const glyph = document.createElement('span');
        glyph.className = 'game-confirm-glyph';
        glyph.textContent = iconText;
        icon.appendChild(glyph);
      } else {
        icon.innerHTML = '<span class="item-art-empty">!</span>';
      }
    }
    const setText = (selector, text) => {
      const el = panel.querySelector(selector);
      if (el) el.textContent = text || '';
    };
    setText('#game-confirm-kicker', kicker);
    setText('#game-confirm-title', title);
    setText('#game-confirm-item-name', itemName || (item ? item.name : 'Действие'));
    setText('#game-confirm-body', body);
    setText('#game-confirm-note', note);
    setText('#game-confirm-cancel', cancelLabel);
    setText('#game-confirm-confirm', confirmLabel);
    const backdrop = document.getElementById('game-confirm-backdrop');
    if (backdrop) {
      backdrop.classList.add('visible');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    setTimeout(() => panel.querySelector('#game-confirm-cancel')?.focus(), 0);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function requestDropInventoryItemWithConfirm(id) {
    const item = ITEMS[id];
    const available = inventory.get(id) || 0;
    if (!item || available <= 0 || id === 'fists') return requestDropInventoryItem(id);
    const stackText = available > 1 ? `В рюкзаке: ${available}. После подтверждения выбери количество.` : 'Предмет будет выброшен рядом с персонажем.';
    return openGameConfirmPanel({
      kicker: 'Инвентарь',
      title: 'Выбросить предмет на землю?',
      itemId: id,
      body: stackText,
      note: 'Действие потратит 1 ОД. Предмет сможет подобрать любой игрок рядом.',
      confirmLabel: available > 1 ? 'Выбрать количество' : 'Выбросить',
      cancelLabel: 'Оставить',
      onConfirm: () => requestDropInventoryItem(id)
    });
  }


  function freeCarryWeight() {
    return Math.max(0, carryCapacity() - inventoryWeight());
  }

  function finiteMaxCarryableQty(id, availableQty = 1) {
    const available = Math.max(0, Math.floor(Number(availableQty) || 0));
    if (available <= 0 || !ITEMS[id]) return 0;
    const weight = itemWeight(id);
    if (weight <= 0) return available;
    return Math.max(0, Math.min(available, Math.floor(freeCarryWeight() / Math.max(0.01, weight))));
  }

  function lootEntriesWeight(entries = []) {
    return entries.reduce((sum, entry) => {
      if (!entry || !ITEMS[entry.id] || Number(entry.qty || 0) <= 0) return sum;
      return sum + itemWeight(entry.id) * Math.max(1, Math.floor(Number(entry.qty || 1)));
    }, 0);
  }

  function canCarryFullLootList(entries = []) {
    const valid = entries.filter(entry => entry && ITEMS[entry.id] && Number(entry.qty || 0) > 0);
    if (!valid.length) return false;
    return inventoryWeight() + lootEntriesWeight(valid) <= carryCapacity() + 0.0001;
  }

  function carryLimitText(id, qty = 1) {
    const item = ITEMS[id];
    if (!item) return '';
    const max = finiteMaxCarryableQty(id, qty);
    const free = formatWeight(freeCarryWeight());
    const unit = formatWeight(itemWeight(id));
    if (max <= 0) return `Нет свободного веса. Свободно: ${free} кг, вес 1 шт.: ${unit} кг.`;
    if (max < qty) return `Можно взять ${max} из ${qty}. Свободно: ${free} кг, вес 1 шт.: ${unit} кг.`;
    return `Можно взять полностью. Свободно: ${free} кг.`;
  }

  function prepareTakeQuantity(id, availableQty, titlePrefix, onConfirm) {
    const item = ITEMS[id];
    if (!item) return false;
    const available = Math.max(1, Math.floor(Number(availableQty) || 1));
    const carryMax = finiteMaxCarryableQty(id, available);
    if (carryMax <= 0) {
      setReadout(`${item.name}: нет свободного веса. Свободно ${formatWeight(freeCarryWeight())} кг.`);
      return false;
    }
    if (available > 1) {
      const limited = carryMax < available;
      return openQuantityPanel({
        title: `${titlePrefix}: ${item.name}`,
        sub: limited
          ? `В стаке: ${available}. Можно унести сейчас: ${carryMax}.`
          : `В стаке: ${available}. Можно забрать полностью.`,
        max: carryMax,
        value: carryMax,
        onConfirm
      });
    }
    return onConfirm(1);
  }
