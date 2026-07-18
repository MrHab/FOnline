  function renderTraderWindow() {
    const vendorGrid = document.getElementById('trader-grid');
    const playerGrid = document.getElementById('trader-player-items');
    if (!vendorGrid || !playerGrid) return;
    sanitizeTradeQueues();
    vendorGrid.innerHTML = '';
    playerGrid.innerHTML = '';
    const trader = activeTraderOrNearby(4.2);
    ensureTraderMarket(trader);
    const money = inventory.get('silver') || 0;
    const traderCaps = activeTraderCaps(trader);
    const title = document.getElementById('trader-title');
    const playerCaps = document.getElementById('trade-player-caps');
    const traderName = document.getElementById('trade-trader-name');
    const barterSkill = document.getElementById('trade-barter-skill');
    const carryProjection = document.getElementById('trade-carry-projection');
    const acceptState = tradeAcceptState();
    if (title) title.textContent = `${trader?.name || 'Торговец'} · БАРТЕР`;
    if (playerCaps) playerCaps.textContent = `${money} 🪙`;
    if (traderName) traderName.textContent = `${trader?.name || 'Торговец'} · ${traderCaps} 🪙`;
    if (barterSkill) {
      const interests = activeTraderBuyInterests(trader);
      const marketText = traderWorldMarketText(trader);
      const baseText = interests.length
        ? `Бартер ${Math.round(skillPercent('barter'))}% · крышки торговца: ${traderCaps} · интерес: ${interests.map(itemCategoryLabel).join(', ')}`
        : `Бартер ${Math.round(skillPercent('barter'))}% · крышки торговца: ${traderCaps}`;
      barterSkill.textContent = marketText ? `${baseText} · ${marketText}` : baseText;
    }
    if (carryProjection) {
      carryProjection.textContent = `Вес ${formatWeight(acceptState.projectedWeight)}/${formatWeight(acceptState.capacity)}`;
      carryProjection.classList.toggle('trade-warning-text', acceptState.projectedWeight > acceptState.capacity + 0.0001);
    }

    const playerInventoryEntries = Array.from(inventory.entries())
      .filter(([id, qty]) => qty > 0 && isSellableItem(id))
      .sort(typeof compareItemEntries === 'function' ? compareItemEntries(sortModes.inventory || 'type') : undefined);
    renderItemCategoryTabs('trader-player-category-tabs', 'traderPlayer', playerInventoryEntries);
    const playerEntries = playerInventoryEntries.filter(([id]) => itemMatchesCategory(id, itemCategoryFilters.traderPlayer || 'all'));
    if (!playerEntries.length) {
      const label = itemCategoryFilters.traderPlayer === 'all' ? 'Нет предметов для продажи.' : `В разделе «${itemCategoryLabel(itemCategoryFilters.traderPlayer)}» нет предметов для продажи.`;
      playerGrid.innerHTML = `<div class="trade-empty">${label}</div>`;
    } else {
      playerEntries.forEach(([id, qty]) => {
        const item = ITEMS[id];
        if (!item) return;
        const queued = queuedSellQty(id);
        const freeQty = availableForSaleQueue(id);
        const price = getSellPrice(id);
        const disabled = freeQty <= 0;
        const equipped = Object.values(equipment).includes(id);
        const equippedText = 'ЭКИПИРОВАНО';
        const equippedHint = 'Предмет сейчас на персонаже. Продавайте его только если точно хотите с ним расстаться.';
        const card = document.createElement('div');
        card.className = 'trade-card barter-row player-row' + (queued ? ' queued' : '') + (disabled ? ' disabled' : '') + (equipped ? ' equipped-sale' : '');
        card.dataset.gameHint = equipped
          ? equippedHint
          : (disabled ? 'Весь стак уже добавлен в обмен.' : `Продажа: ${price} крышек за 1 шт.`);
        card.innerHTML = `
          <div class="barter-row-icon">${itemArtHtml(item)}</div>
          <div class="barter-row-body">
            <div class="barter-row-name"><span class="barter-row-name-text">${item.name}</span>${equipped ? `<span class="barter-equipped-badge">${equippedText}</span>` : ''}</div>
            <div class="barter-row-note">${formatWeight(itemWeight(id))} кг · продажа ${price} 🪙</div>
          </div>
          <div class="barter-row-side"><b>x${freeQty}</b>${queued ? `<span>в обмене ${queued}</span>` : ''}</div>
        `;
        card.setAttribute('draggable', isMobileControlsEnabled() ? 'false' : 'true');
        card.addEventListener('dragstart', e => {
          if (disabled) { e.preventDefault(); return; }
          draggedInventoryItem = id;
          e.dataTransfer.setData('text/item-id', id);
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.setData('text/source', 'inventory-main');
          e.dataTransfer.effectAllowed = 'copyMove';
        });
        card.addEventListener('dragend', () => { draggedInventoryItem = null; });
        if (!disabled) card.addEventListener('click', () => queueSaleFromInventoryWithAmount(id));
        card.addEventListener('mouseenter', e => showTooltip(e, { ...item, stat: equipped ? `${equippedHint} Продажа: ${price} крышек за 1 шт.` : `Продажа: ${price} крышек за 1 шт.` }));
        card.addEventListener('mousemove', moveTooltip);
        card.addEventListener('mouseleave', hideTooltip);
        playerGrid.appendChild(card);
      });
    }

    const vendorEntries = activeTraderStock().filter(entry => ITEMS[entry.id]);
    renderItemCategoryTabs('trader-vendor-category-tabs', 'traderVendor', vendorEntries.map(entry => [entry.id, 1]));
    vendorEntries.filter(entry => itemMatchesCategory(entry.id, itemCategoryFilters.traderVendor || 'all')).forEach(entry => {
      const item = ITEMS[entry.id];
      if (!item) return;
      const price = getBuyPrice(entry);
      const queued = queuedBuyQty(entry.id);
      const available = availableForBuyQueue(entry.id);
      const projectedWeight = tradeProjectedWeight() + itemWeight(entry.id);
      const weightBlocked = projectedWeight > carryCapacity() + 0.0001;
      const moneyBlocked = tradeNetCost() + price > money;
      const stockBlocked = available <= 0;
      const card = document.createElement('div');
      card.className = 'trade-card barter-row vendor-row' + (queued ? ' queued' : '') + (weightBlocked ? ' carry-blocked' : '') + (moneyBlocked ? ' money-blocked' : '') + (stockBlocked ? ' disabled' : '');
      card.innerHTML = `
        <div class="barter-row-icon">${itemArtHtml(item)}</div>
        <div class="barter-row-body">
          <div class="barter-row-name"><span class="barter-row-name-text">${item.name}</span></div>
          <div class="barter-row-note">${formatWeight(itemWeight(entry.id))} кг · покупка ${price} 🪙${Number.isFinite(available) ? ` · осталось ${available}` : ''}</div>
        </div>
        <div class="barter-row-side"><b>${price} 🪙</b>${queued ? `<span>в обмене ${queued}</span>` : ''}</div>
      `;
      card.dataset.gameHint = stockBlocked ? 'У торговца больше нет этого товара.' : (weightBlocked ? `${item.name}: после обмена будет перегруз.` : (moneyBlocked ? 'После добавления может не хватить крышек.' : `Товар: ${item.name}`));
      if (!stockBlocked) card.addEventListener('click', () => buyTraderItem(entry.id, price));
      card.addEventListener('mouseenter', e => {
        const extra = moneyBlocked ? `Цена покупки: ${price} крышек · возможна доплата` : (weightBlocked ? `Цена покупки: ${price} крышек · возможен перегруз` : `Цена покупки: ${price} крышек`);
        showTooltip(e, { ...item, stat: extra });
      });
      card.addEventListener('mousemove', moveTooltip);
      card.addEventListener('mouseleave', hideTooltip);
      vendorGrid.appendChild(card);
    });
    if (!vendorGrid.children.length) {
      const label = itemCategoryFilters.traderVendor === 'all' ? 'У торговца нет товаров.' : `В разделе «${itemCategoryLabel(itemCategoryFilters.traderVendor)}» у торговца пусто.`;
      vendorGrid.innerHTML = `<div class="trade-empty">${label}</div>`;
    }

    renderTradeSellZone();
  }

  function queuedSellQty(id) {
    return saleQueue.get(id) || 0;
  }

  function availableForSaleQueue(id) {
    return Math.max(0, (inventory.get(id) || 0) - queuedSellQty(id));
  }

  function addItemToBuyQueue(id, qty = 1) {
    if (!traderWindowOpen) return false;
    const entry = getTraderStockEntry(id);
    const item = ITEMS[id];
    if (!entry || !item) return false;
    const available = availableForBuyQueue(id);
    if (available <= 0) {
      setReadout(`${item.name}: у торговца больше нет этого товара.`);
      renderTraderWindow();
      return false;
    }
    const wantedQty = Math.max(1, Math.floor(Number(qty || 1)));
    const addQty = Number.isFinite(available) ? Math.min(wantedQty, available) : wantedQty;
    buyQueue.set(id, queuedBuyQty(id) + addQty);
    setReadout(`${item.name} добавлен в обмен. Итого: ${queuedBuyQty(id)} шт.`);
    renderTraderWindow();
    return true;
  }

  function queueBuyFromTraderWithAmount(id) {
    const item = ITEMS[id];
    const entry = getTraderStockEntry(id);
    if (!item || !entry) return false;
    const available = availableForBuyQueue(id);
    if (available <= 0) return addItemToBuyQueue(id, 1);
    if (shouldChooseBuyQuantity(id, entry)) {
      const max = maxBulkBuyQty(id, entry);
      if (max <= 0) {
        setReadout(`${item.name}: не хватает крышек или свободного веса для покупки.`);
        renderTraderWindow();
        return false;
      }
      if (max > 1) {
        const price = getBuyPrice(entry);
        const stockText = Number.isFinite(available) ? `Осталось у торговца: ${available}.` : `Доступно по весу и крышкам: ${max}.`;
        return openQuantityPanel({
          title: `${item.name}`,
          sub: `Добавить в покупку. ${stockText} Цена: ${price} за 1 шт.`,
          max,
          value: 1,
          onConfirm: qty => addItemToBuyQueue(id, qty)
        });
      }
    }
    return addItemToBuyQueue(id, 1);
  }

  function removeItemFromBuyQueue(id, qty = 1) {
    const cur = queuedBuyQty(id);
    if (cur <= 0) return;
    const next = cur - Math.max(1, Math.floor(Number(qty || 1)));
    if (next <= 0) buyQueue.delete(id); else buyQueue.set(id, next);
    renderTraderWindow();
  }



  function queueSaleFromInventoryWithAmount(id) {
    const item = ITEMS[id];
    if (!item || id === 'silver') return false;
    const max = availableForSaleQueue(id);
    if (max <= 0) return addItemToSale(id, 1);
    if (max > 1) {
      return openQuantityPanel({
        title: `${item.name}`,
        sub: `Добавить в продажу. Доступно: ${max}`,
        max,
        value: max,
        onConfirm: qty => addItemToSale(id, qty)
      });
    }
    return addItemToSale(id, 1);
  }

  function addItemToSale(id, qty = 1) {
    if (!traderWindowOpen) return false;
    const item = ITEMS[id];
    if (!item || id === 'silver') {
      setReadout('Этот предмет нельзя продать.');
      return false;
    }
    const freeQty = availableForSaleQueue(id);
    if (freeQty <= 0) {
      setReadout(`${item.name}: больше нет свободных предметов для продажи.`);
      return false;
    }
    const addQty = Math.min(qty, freeQty);
    saleQueue.set(id, queuedSellQty(id) + addQty);
    setReadout(`${item.name} добавлен в продажу. Итого: ${queuedSellQty(id)} шт.`);
    renderTraderWindow();
    renderInventory();
    return true;
  }

  function removeItemFromSale(id, qty = 1) {
    const cur = queuedSellQty(id);
    if (cur <= 0) return;
    const next = cur - qty;
    if (next <= 0) saleQueue.delete(id); else saleQueue.set(id, next);
    renderTraderWindow();
    renderInventory();
  }

  function clearSaleQueue() {
    saleQueue.clear();
    buyQueue.clear();
    renderTraderWindow();
    renderInventory();
  }

  function saleQueueTotal() {
    let total = 0;
    saleQueue.forEach((qty, id) => {
      if (ITEMS[id]) total += getSellPrice(id) * Math.min(qty, inventory.get(id) || 0);
    });
    return total;
  }

  function submitServerTradeMachineExchange(machine, state) {
    if (!machine || !machine.isTradeMachine || machine.tradePending) return false;
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Торговый автомат не может провести обмен без сервера мира.');
      return false;
    }
    const buys = Array.from(buyQueue.entries()).map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty || 0))) })).filter(row => row.qty > 0);
    const sells = Array.from(saleQueue.entries()).map(([id, qty]) => ({ id, qty: Math.max(0, Math.floor(Number(qty || 0))) })).filter(row => row.qty > 0);
    machine.tradePending = true;
    renderTraderWindow();
    multiplayer.socket.emit('tradeMachineExchange', {
      machineId: machine.id || '',
      locationId: currentLocation?.id || '',
      buys,
      sells,
      inventory: multiplayerInventorySnapshot(),
      carry: typeof multiplayerCarrySnapshot === 'function' ? multiplayerCarrySnapshot() : null,
      special: characterProfile?.special || DEFAULT_SPECIAL,
      skillRanks: typeof clientSkillRanksSnapshot === 'function' ? clientSkillRanksSnapshot() : { ...skillRanks },
      talentRanks: { ...talentRanks },
      traits: Array.isArray(characterProfile?.traits) ? characterProfile.traits.slice(0, 2) : [],
      level: player.level
    }, ack => {
      machine.tradePending = false;
      if (ack?.market?.ok && typeof applyServerTradeMachineMarket === 'function') {
        applyServerTradeMachineMarket(machine, ack.market);
      }
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил обмен.');
        renderTraderWindow();
        return;
      }
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') {
        applyServerAuthoritativePlayerState(ack.self);
      } else if (Array.isArray(ack.inventory) && typeof applyServerInventorySnapshot === 'function') {
        applyServerInventorySnapshot(ack.inventory);
      }
      saleQueue.clear();
      buyQueue.clear();
      clearEquipmentReferencesToMissing();
      const net = Number(ack.net || state?.net || 0);
      const bought = buys.map(row => `${ITEMS[row.id]?.name || row.id} x${row.qty}`);
      const sold = sells.map(row => `${ITEMS[row.id]?.name || row.id} x${row.qty}`);
      const parts = [];
      if (bought.length) parts.push(`куплено: ${bought.join(', ')}`);
      if (sold.length) parts.push(`продано: ${sold.join(', ')}`);
      const balance = net > 0 ? `доплата ${net}` : (net < 0 ? `получено ${Math.abs(net)}` : 'без доплаты');
      addLog(`Торговый автомат: ${parts.join('; ')} (${balance} крышек).`, null, 'loot');
      setReadout(`Обмен подтвержден сервером: ${balance} крышек.`);
      renderTraderWindow();
      renderInventory();
      renderQuickbar();
      renderWeaponReadout();
      queueSave(true);
    });
    return true;
  }

  function submitServerNpcTradeExchange(trader, state = {}, requested = null) {
    if (!trader || trader.isTradeMachine || trader.tradePending) return false;
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Обмен с NPC требует соединения с сервером мира.');
      return false;
    }
    const sourceBuys = requested?.buys || Array.from(buyQueue.entries()).map(([id, qty]) => ({ id, qty }));
    const sourceSells = requested?.sells || Array.from(saleQueue.entries()).map(([id, qty]) => ({ id, qty }));
    const normalizeRows = rows => rows.map(row => ({ id: baseItemId(row.id), qty: Math.max(0, Math.floor(Number(row.qty || 0))) })).filter(row => row.id && row.qty > 0);
    const buys = normalizeRows(sourceBuys);
    const sells = normalizeRows(sourceSells);
    trader.tradePending = true;
    renderTraderWindow();
    multiplayer.socket.emit('npcTradeExchange', {
      enemyId: trader.id || '',
      buys,
      sells,
      skillRanks: typeof clientSkillRanksSnapshot === 'function' ? clientSkillRanksSnapshot() : { ...skillRanks },
      talentRanks: { ...talentRanks }
    }, ack => {
      trader.tradePending = false;
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (Array.isArray(ack?.inventory) && typeof applyServerInventorySnapshot === 'function') applyServerInventorySnapshot(ack.inventory);
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил обмен.');
        renderTraderWindow();
        return;
      }
      if (ack.enemy && typeof applyNetworkEnemies === 'function') {
        applyNetworkEnemies([ack.enemy], { allowPositionSync: false, fromServer: true, pruneMissing: false });
        const updated = enemies.find(enemy => enemy.id === ack.enemy.id);
        if (updated) activeTraderActor = updated;
      }
      if (!requested) {
        saleQueue.clear();
        buyQueue.clear();
      }
      clearEquipmentReferencesToMissing();
      const net = Number(ack.net || state.net || 0);
      const bought = buys.map(row => `${ITEMS[row.id]?.name || row.id} x${row.qty}`);
      const sold = sells.map(row => `${ITEMS[row.id]?.name || row.id} x${row.qty}`);
      const parts = [];
      if (bought.length) parts.push(`куплено: ${bought.join(', ')}`);
      if (sold.length) parts.push(`продано: ${sold.join(', ')}`);
      const balance = net > 0 ? `доплата ${net}` : (net < 0 ? `получено ${Math.abs(net)}` : 'без доплаты');
      addLog(`Бартер: ${parts.join('; ')} (${balance} крышек).`, null, 'loot');
      setReadout(`Обмен подтверждён сервером: ${balance} крышек.`);
      renderTraderWindow();
      renderInventory();
      renderQuickbar();
      renderWeaponReadout();
      queueSave(true);
    });
    return true;
  }

  function sellQueuedItems() {
    if (!traderWindowOpen) return;
    const state = tradeAcceptState();
    if (!state.ok) {
      setReadout(state.reason);
      return;
    }
    const net = state.net;
    const trader = activeTraderOrNearby(4.2);
    if (trader?.isTradeMachine) {
      submitServerTradeMachineExchange(trader, state);
      return;
    }
    submitServerNpcTradeExchange(trader, state);
  }

  function renderTradeSellZone() {
    const zone = document.getElementById('trade-sell-zone');
    if (!zone) return;
    sanitizeTradeQueues();
    const sellEntries = Array.from(saleQueue.entries()).filter(([id, qty]) => ITEMS[id] && qty > 0 && (inventory.get(id) || 0) > 0);
    const buyEntries = Array.from(buyQueue.entries()).filter(([id, qty]) => ITEMS[id] && getTraderStockEntry(id) && qty > 0);
    const sellTotal = saleQueueTotal();
    const buyTotal = buyQueueTotal();
    const state = tradeAcceptState();
    const net = state.net;
    const netText = net > 0 ? `Вы платите ${net} 🪙` : (net < 0 ? `Вам платят ${Math.abs(net)} 🪙` : 'Ровный обмен');
    const warning = state.reason ? `<div class="trade-warning">${state.reason}</div>` : '';
    zone.innerHTML = `
      <div class="barter-ledger">
        <div class="barter-ledger-title">ИТОГ ОБМЕНА</div>
        <div class="barter-ledger-row"><span>Ваши товары</span><b class="trade-total">+${sellTotal} 🪙</b></div>
        <div class="barter-ledger-row"><span>Товар торговца</span><b class="trade-cost">-${buyTotal} 🪙</b></div>
        <div class="barter-ledger-net${net > 0 ? ' pay' : (net < 0 ? ' gain' : '')}">${netText}</div>
      </div>
      <div class="barter-offers">
        <div class="barter-offer-panel">
          <div class="barter-offer-title">Вы отдаёте</div>
          ${sellEntries.length ? '<div class="trade-sell-list barter-offer-list"></div>' : '<div class="trade-empty">—</div>'}
        </div>
        <div class="barter-offer-panel">
          <div class="barter-offer-title">Вы берёте</div>
          ${buyEntries.length ? '<div class="trade-buy-list barter-offer-list"></div>' : '<div class="trade-empty">—</div>'}
        </div>
      </div>
      ${warning}
      <div class="trade-sell-actions">
        <button type="button" id="trade-sell-confirm" class="ui-btn" ${state.ok ? '' : 'disabled'}>Принять обмен</button>
        <button type="button" id="trade-sell-clear" class="ui-btn" ${(sellEntries.length || buyEntries.length) ? '' : 'disabled'}>Сбросить</button>
      </div>
    `;
    const list = zone.querySelector('.trade-sell-list');
    if (list) {
      sellEntries.forEach(([id, qty]) => {
        const item = ITEMS[id];
        const price = getSellPrice(id);
        const card = document.createElement('div');
        card.className = 'trade-card sell-card queued barter-mini-row';
        card.dataset.gameHint = 'Убрать 1 шт. из обмена.';
        card.innerHTML = `<span class="barter-summary-icon">${itemArtHtml(item)}</span><b>${item.name}</b><em>x${qty}</em><strong>+${price * qty} 🪙</strong>`;
        card.addEventListener('click', () => removeItemFromSale(id, 1));
        card.addEventListener('mouseenter', e => showTooltip(e, { ...item, stat: `Продажа: ${price} крышек за 1 шт.` }));
        card.addEventListener('mousemove', moveTooltip);
        card.addEventListener('mouseleave', hideTooltip);
        list.appendChild(card);
      });
    }
    const buyList = zone.querySelector('.trade-buy-list');
    if (buyList) {
      buyEntries.forEach(([id, qty]) => {
        const item = ITEMS[id];
        const entry = getTraderStockEntry(id);
        const price = getBuyPrice(entry);
        const card = document.createElement('div');
        card.className = 'trade-card buy-card queued barter-mini-row';
        card.dataset.gameHint = 'Убрать 1 шт. из обмена.';
        card.innerHTML = `<span class="barter-summary-icon">${itemArtHtml(item)}</span><b>${item.name}</b><em>x${qty}</em><strong>-${price * qty} 🪙</strong>`;
        card.addEventListener('click', () => removeItemFromBuyQueue(id, 1));
        card.addEventListener('mouseenter', e => showTooltip(e, { ...item, stat: `Покупка: ${price} крышек за 1 шт.` }));
        card.addEventListener('mousemove', moveTooltip);
        card.addEventListener('mouseleave', hideTooltip);
        buyList.appendChild(card);
      });
    }
    const confirmBtn = zone.querySelector('#trade-sell-confirm');
    const clearBtn = zone.querySelector('#trade-sell-clear');
    if (confirmBtn) confirmBtn.addEventListener('click', sellQueuedItems);
    if (clearBtn) clearBtn.addEventListener('click', clearSaleQueue);

    zone.ondragenter = e => { e.preventDefault(); zone.classList.add('drag-over'); };
    zone.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('drag-over'); };
    zone.ondragleave = e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); };
    zone.ondrop = e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const itemId = e.dataTransfer.getData('text/item-id') || e.dataTransfer.getData('text/plain') || draggedInventoryItem;
      if (itemId) queueSaleFromInventoryWithAmount(itemId);
      draggedInventoryItem = null;
    };
  }

  function buyTraderItem(id, price) {
    const item = ITEMS[id];
    if (!item) return;
    queueBuyFromTraderWithAmount(id);
  }


  function sellInventoryItem(id, qty = 1) {
    const item = ITEMS[id];
    if (!item || id === 'silver') return;
    const available = inventory.get(id) || 0;
    if (available <= 0) {
      setReadout('Этого предмета больше нет в инвентаре.');
      renderTraderWindow();
      return;
    }
    const sellQty = Math.min(qty, available);
    const trader = activeTraderOrNearby(4.2);
    ensureTraderMarket(trader);
    const price = getSellPrice(id) * sellQty;
    const traderCaps = activeTraderCaps(trader);
    if (price > traderCaps) {
      setReadout(`У торговца не хватает крышек: нужно ${price}, у него ${traderCaps}.`);
      renderTraderWindow();
      return;
    }
    submitServerNpcTradeExchange(trader, { net: -price }, { sells: [{ id, qty: sellQty }], buys: [] });
  }

