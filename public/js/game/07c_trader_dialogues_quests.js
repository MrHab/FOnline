  function openTraderWindow(traderOverride = null) {
    const trader = traderActorInRange(traderOverride, 4.2) ? traderOverride : activeTraderOrNearby(4.2);
    if (!trader) {
      setReadout('Рядом нет торговца.');
      return false;
    }
    const tradeMachine = trader?.isTradeMachine === true;
    if (trader !== traderNpc && !tradeMachine && !isCaravanTrader(trader)) {
      setReadout(`${trader.name || 'НПС'} сейчас ничего не продаёт.`);
      return false;
    }
    closeAllWindows();
    activeTraderActor = trader;
    ensureTraderMarket(trader);
    if (!tradeMachine) beginNpcDialogueFocus(trader);
    saleQueue.clear();
    buyQueue.clear();
    traderWindowOpen = true;
    document.body.classList.add('trader-window-open');
    document.getElementById('trader-window').style.display = 'block';
    renderTraderWindow();
    renderInventory();
    if (tradeMachine && typeof requestTradeMachineMarket === 'function') {
      requestTradeMachineMarket(trader, { silent: true });
    }
    setReadout(`${trader.name}: выбирайте товары для обмена.`);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function robEncounterActor(actor) {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    if (!actor || actor.dead || actor._removed) {
      setReadout('Цель уже недоступна.');
      return false;
    }
    if (typeof currentLocationAllowsNpcCombat === 'function' && !currentLocationAllowsNpcCombat()) {
      setReadout('В мирной локации нельзя нападать или грабить НПС.');
      return false;
    }
    const dist = Math.hypot(Number(actor.x || 0) - player.x, Number(actor.z || 0) - player.z);
    if (dist > 4.4) {
      setReadout('Подойдите ближе, чтобы ограбить.');
      return false;
    }
    if (actor.hostileToPlayer !== false) {
      setReadout(`${actor.name || 'Цель'} уже враждебна.`);
      return false;
    }
    if (enemiesAreServerAuthoritative() && multiplayer.socket && multiplayer.socket.connected) {
      multiplayer.socket.emit('robEncounterActor', { enemyId: actor.id }, ack => {
        if (!ack || !ack.ok) {
          setReadout(ack?.error || 'Ограбление не удалось.');
          return;
        }
        if (Array.isArray(ack.enemies) && typeof applyNetworkEnemies === 'function') {
          applyNetworkEnemies(ack.enemies, { allowPositionSync: true, fromServer: true, pruneMissing: false });
        }
        addLog(`Ограбление: ${ack.targetName || actor.name || 'караван'} поднимает тревогу.`, null, 'combat');
        setReadout('Караван сопротивляется. Победите охрану, чтобы забрать вещи.');
      });
      return true;
    }
    enemies.forEach(e => {
      if (!e || e.dead || e._removed || e.faction !== actor.faction) return;
      e.hostileToPlayer = true;
      e.aiState = 'chase';
      e.targetId = 'player';
    });
    addLog(`Ограбление: ${actor.name || 'караван'} сопротивляется.`, null, 'combat');
    setReadout('Караван сопротивляется. Победите охрану, чтобы забрать вещи.');
    return true;
  }

  function closeTraderWindow() {
    closeQuantityPanel();
    if (activeTraderActor && activeTraderActor.isTradeMachine !== true) endNpcDialogueFocus(activeTraderActor);
    const win = document.getElementById('trader-window');
    if (win) win.style.display = 'none';
    traderWindowOpen = false;
    activeTraderActor = null;
    document.body.classList.remove('trader-window-open');
    saleQueue.clear();
    buyQueue.clear();
    renderTradeSellZone();
    const invWin = uiWindows.inventory;
    if (invWin) invWin.classList.remove('visible');
    renderInventory();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  const SELL_PRICE_OVERRIDES = {
    pistol: 28,
    rifle: 38,
    shotgun: 48,
    rocketLauncher: 118,
    machineGun: 72,
    laserPistol: 60,
    flamethrower: 78,
    plasmaRifle: 92,
    knife: 4,
    leather: 12,
    combatArmor: 42,
    helmet: 8,
    tacticalHelmet: 16,
    assaultHelmet: 22,
    boots: 7,
    scoutBoots: 10,
    reinforcedBoots: 13,
    backpack: 15,
    ammo9: 1,
    ammo556: 2,
    energyCell: 4,
    napalm: 4,
    shotgunShell: 2,
    rocketAmmo: 10,
    medkit: 10,
    stim: 5,
    doctorBag: 18,
    antibiotics: 12,
    water: 2,
    ore: 3,
    wood: 2,
    trophy: 14
  };

  function getSellPrice(id) {
    const priceId = baseItemId(id);
    let base;
    if (SELL_PRICE_OVERRIDES[priceId]) base = SELL_PRICE_OVERRIDES[priceId];
    else {
      const stock = activeTraderStock().find(entry => entry.id === priceId);
      if (stock) base = Math.max(1, Math.floor(stock.price * 0.45));
      else {
        const item = ITEMS[id];
        if (!item) base = 1;
        else if (item.type === 'weapon') base = 12;
        else if (['armor', 'helmet', 'boots', 'backpack'].includes(item.type)) base = 8;
        else if (item.type === 'material') base = 2;
        else if (item.type === 'loot') base = 10;
        else base = 1;
      }
    }
    const charismaBonus = 1 + (statValue('cha') - 5) * 0.04 + (hasStartTrait('traderStart') ? 0.15 : 0) + skillNorm('barter') * 0.30 + talentLevel('merchant') * 0.08;
    let price = Math.max(1, Math.floor(base * charismaBonus));
    const stockEntry = getTraderStockEntry(priceId);
    if (stockEntry) {
      price = Math.min(price, Math.max(1, Math.floor(getBuyPrice(stockEntry) * 0.85)));
    }
    const trader = activeTraderOrNearby(4.2);
    const interests = activeTraderBuyInterests(trader);
    if (isCaravanTrader(trader) && interests.length) {
      const category = typeof itemCategoryFor === 'function' ? itemCategoryFor(priceId) : 'misc';
      price = Math.max(1, Math.round(price * (interests.includes(category) ? 1.24 : 0.84)));
    }
    return price;
  }

  function getBuyPrice(entry) {
    const discount = Math.min(0.48, skillNorm('barter') * 0.24 + talentLevel('merchant') * 0.05);
    return Math.max(1, Math.ceil(entry.price * (1 - discount)));
  }

  function getTraderStockEntry(id) {
    return activeTraderStock().find(entry => entry.id === id) || null;
  }

  function activeTraderStock(trader = activeTraderOrNearby(4.2)) {
    const state = ensureTraderMarket(trader);
    if (state) return normalizeTraderStockRows(state.stock);
    return buildTraderRestockStock(trader);
  }

  function activeTraderBuyInterests(trader = activeTraderOrNearby(4.2)) {
    return isCaravanTrader(trader) && Array.isArray(trader.traderBuyInterests)
      ? trader.traderBuyInterests.map(x => String(x || '')).filter(Boolean)
      : [];
  }

  function availableForBuyQueue(id) {
    const entry = getTraderStockEntry(id);
    if (!entry) return 0;
    const stockQty = Number(entry.qty);
    if (!Number.isFinite(stockQty)) return Infinity;
    return Math.max(0, Math.floor(stockQty) - queuedBuyQty(id));
  }

  function maxBulkBuyQty(id, entry = getTraderStockEntry(id)) {
    if (!entry || !ITEMS[id]) return 0;
    const available = availableForBuyQueue(id);
    if (available <= 0) return 0;
    if (Number.isFinite(available)) return Math.max(0, Math.floor(available));
    const price = Math.max(1, getBuyPrice(entry));
    const moneyLeft = Math.max(0, (inventory.get('silver') || 0) - tradeNetCost());
    const byMoney = Math.max(0, Math.floor(moneyLeft / price));
    const weight = itemWeight(id);
    const freeWeight = Math.max(0, carryCapacity() - tradeProjectedWeight());
    const byWeight = weight > 0 ? Math.max(0, Math.floor(freeWeight / Math.max(0.01, weight))) : 999;
    return Math.max(0, Math.min(999, byMoney || 0, byWeight || 0));
  }

  function shouldChooseBuyQuantity(id, entry = getTraderStockEntry(id)) {
    const item = ITEMS[id];
    if (!item || !entry) return false;
    const available = availableForBuyQueue(id);
    if (Number.isFinite(available)) return available > 1;
    return ['ammo', 'consumable', 'material'].includes(String(item.type || '').toLowerCase()) || item.heal || item.doctor || item.cureInfection || item.repair;
  }

  function decrementActiveTraderStock(id, qty = 1) {
    const trader = activeTraderOrNearby(4.2);
    const state = ensureTraderMarket(trader);
    if (!state) return;
    const itemId = String(id || '');
    const entry = state.stock.find(row => row.id === itemId);
    if (!entry) return;
    entry.qty = Math.max(0, Math.floor(Number(entry.qty || 0)) - Math.max(1, Math.floor(Number(qty || 1))));
    state.stock = normalizeTraderStockRows(state.stock);
    syncTraderMarketToActor(trader, state);
  }

  function traderResalePriceForItem(id) {
    const itemId = baseItemId(id);
    const existing = getTraderStockEntry(itemId);
    if (existing) return Math.max(1, Math.floor(Number(existing.price || 1)));
    const sellPrice = Math.max(1, getSellPrice(id));
    const item = ITEMS[itemId] || ITEMS[id];
    const type = String(item?.type || '').toLowerCase();
    const markup = type === 'ammo' ? 2 : (type === 'material' ? 1.4 : 1.75);
    return Math.max(sellPrice + 1, Math.round(sellPrice * markup));
  }

  function incrementActiveTraderStock(id, qty = 1, price = null) {
    const trader = activeTraderOrNearby(4.2);
    const state = ensureTraderMarket(trader);
    if (!state) return;
    const itemId = baseItemId(id);
    if (!ITEMS[itemId]) return;
    const addQty = Math.max(1, Math.floor(Number(qty || 1)));
    let entry = state.stock.find(row => row.id === itemId);
    if (!entry) {
      entry = { id: itemId, price: Math.max(1, Math.round(Number(price || traderResalePriceForItem(itemId) || 1))), qty: 0 };
      state.stock.push(entry);
    }
    entry.qty = Math.max(0, Math.floor(Number(entry.qty || 0))) + addQty;
    entry.price = Math.max(1, Math.round(Number(entry.price || price || 1)));
    state.stock = normalizeTraderStockRows(state.stock);
    syncTraderMarketToActor(trader, state);
  }

  function queuedBuyQty(id) {
    return buyQueue.get(id) || 0;
  }

  function buyQueueTotal() {
    let total = 0;
    buyQueue.forEach((qty, id) => {
      const entry = getTraderStockEntry(id);
      if (entry && ITEMS[id]) total += getBuyPrice(entry) * Math.max(1, Math.floor(Number(qty || 1)));
    });
    return total;
  }

  function tradeQueueWeight(queue, clampToInventory = false) {
    let total = 0;
    queue.forEach((qty, id) => {
      if (!ITEMS[id]) return;
      const safeQty = Math.max(0, Math.floor(Number(qty || 0)));
      const usedQty = clampToInventory ? Math.min(safeQty, inventory.get(id) || 0) : safeQty;
      total += itemWeight(id) * usedQty;
    });
    return total;
  }

  function tradeProjectedWeight() {
    return Math.max(0, inventoryWeight() - tradeQueueWeight(saleQueue, true) + tradeQueueWeight(buyQueue, false));
  }

  function tradeNetCost() {
    return buyQueueTotal() - saleQueueTotal();
  }

  function sanitizeTradeQueues() {
    Array.from(saleQueue.entries()).forEach(([id, qty]) => {
      if (!ITEMS[id] || id === 'silver' || (inventory.get(id) || 0) <= 0 || qty <= 0) saleQueue.delete(id);
      else if (qty > (inventory.get(id) || 0)) saleQueue.set(id, inventory.get(id) || 0);
    });
    Array.from(buyQueue.entries()).forEach(([id, qty]) => {
      const entry = getTraderStockEntry(id);
      if (!ITEMS[id] || !entry || qty <= 0) buyQueue.delete(id);
      else if (Number.isFinite(Number(entry.qty))) {
        const maxQty = Math.max(0, Math.floor(Number(entry.qty)));
        if (maxQty <= 0) buyQueue.delete(id);
        else if (qty > maxQty) buyQueue.set(id, maxQty);
      }
    });
  }

  function tradeAcceptState() {
    sanitizeTradeQueues();
    const hasTrade = saleQueue.size > 0 || buyQueue.size > 0;
    const net = tradeNetCost();
    const money = inventory.get('silver') || 0;
    const trader = activeTraderOrNearby(4.2);
    if (trader?.tradePending) return { ok: false, reason: 'Автомат проводит обмен на сервере.', net, projectedWeight: tradeProjectedWeight(), capacity: carryCapacity() };
    const traderCaps = activeTraderCaps(trader);
    const projectedWeight = tradeProjectedWeight();
    const capacity = carryCapacity();
    if (!hasTrade) return { ok: false, reason: 'Выберите предметы для обмена.', net, projectedWeight, capacity };
    if (net > money) return { ok: false, reason: `Не хватает крышек: нужно ${net}, у вас ${money}.`, net, projectedWeight, capacity };
    if (net < 0 && Math.abs(net) > traderCaps) return { ok: false, reason: `У торговца не хватает крышек: нужно ${Math.abs(net)}, у него ${traderCaps}.`, net, projectedWeight, capacity };
    if (projectedWeight > capacity + 0.0001) {
      return { ok: false, reason: `Перегруз: ${formatWeight(projectedWeight)}/${formatWeight(capacity)} кг.`, net, projectedWeight, capacity };
    }
    return { ok: true, reason: '', net, projectedWeight, capacity };
  }

  function normalizeNpcQuestState() {
    const supplyStates = ['available', 'active', 'done'];
    const terminalStates = ['locked', 'available', 'active', 'done'];
    if (!supplyStates.includes(npcQuestState.klimSupplies)) npcQuestState.klimSupplies = 'available';
    if (!terminalStates.includes(npcQuestState.klimTerminal)) npcQuestState.klimTerminal = npcQuestState.klimSupplies === 'done' ? 'available' : 'locked';
    npcQuestState.klimTerminalHacked = !!npcQuestState.klimTerminalHacked;
    npcQuestState.klimSuppliesNegotiated = !!npcQuestState.klimSuppliesNegotiated;
    npcQuestState.klimSuppliesSpeechTried = !!npcQuestState.klimSuppliesSpeechTried;
    npcQuestState.klimTerminalNegotiated = !!npcQuestState.klimTerminalNegotiated;
    npcQuestState.klimTerminalScienceTried = !!npcQuestState.klimTerminalScienceTried;
    if (!supplyStates.includes(npcQuestState.scrapParts)) npcQuestState.scrapParts = 'available';
    if (!supplyStates.includes(npcQuestState.relayCalibration)) npcQuestState.relayCalibration = 'available';
    npcQuestState.scrapPartsNegotiated = !!npcQuestState.scrapPartsNegotiated;
    npcQuestState.scrapPartsSpeechTried = !!npcQuestState.scrapPartsSpeechTried;
    npcQuestState.relayCalibrationNegotiated = !!npcQuestState.relayCalibrationNegotiated;
    npcQuestState.relayCalibrationScienceTried = !!npcQuestState.relayCalibrationScienceTried;
  }

  function hasQuestItems(cost = {}) {
    return Object.entries(cost).every(([id, qty]) => (inventory.get(id) || 0) >= qty);
  }

  function npcQuestPanelText() {
    normalizeNpcQuestState();
    if (npcQuestDefinitionsLoaded) {
      if (npcQuestState.klimSupplies === 'active') {
        return { title: questTitle('klimSupplies', 'Старый Клим'), text: questRequirementsProgressText('klimSupplies', { ore: 3, wood: 3, water: 1 }) || questPanelLine('klimSupplies', 'active') };
      }
      if (npcQuestState.klimTerminal === 'active') {
        return { title: questTitle('klimTerminal', 'Старый Клим'), text: npcQuestState.klimTerminalHacked ? questPanelLine('klimTerminal', 'ready') : questPanelLine('klimTerminal', 'active') };
      }
      if (npcQuestState.scrapParts === 'active') {
        return { title: questTitle('scrapParts', 'Грач-Жестянщик'), text: questRequirementsProgressText('scrapParts', { ore: 6, wood: 2, repairKit: 1 }) || questPanelLine('scrapParts', 'active') };
      }
      if (npcQuestState.relayCalibration === 'active') {
        return { title: questTitle('relayCalibration', 'Рада Искра'), text: questRequirementsProgressText('relayCalibration', { energyCell: 20, repairKit: 1 }) || questPanelLine('relayCalibration', 'active') };
      }
    }
    if (npcQuestState.klimSupplies === 'active') {
      return { title: 'Старый Клим', text: `Руда ${inventory.get('ore') || 0}/3 · древесина ${inventory.get('wood') || 0}/3 · вода ${inventory.get('water') || 0}/1` };
    }
    if (npcQuestState.klimTerminal === 'active') {
      return { title: 'Старый Клим', text: npcQuestState.klimTerminalHacked ? 'Вернитесь к Климу за наградой.' : 'Взломайте терминал редкого тайника в Пепельном лесу.' };
    }
    if (npcQuestState.scrapParts === 'active') {
      return { title: 'Грач-Жестянщик', text: `Руда ${inventory.get('ore') || 0}/6 · древесина ${inventory.get('wood') || 0}/2 · ремкомплект ${inventory.get('repairKit') || 0}/1` };
    }
    if (npcQuestState.relayCalibration === 'active') {
      return { title: 'Рада Искра', text: `Энергозаряды ${inventory.get('energyCell') || 0}/20 · ремкомплект ${inventory.get('repairKit') || 0}/1` };
    }
    return { title: 'Поручения', text: 'Поговорите с НПС, чтобы взять работу.' };
  }

  function updateNpcQuestPanel() {
    const panel = document.querySelector('.mobile-quest-panel');
    if (!panel) return;
    const title = panel.querySelector('b');
    const text = panel.querySelector('span');
    const info = npcQuestPanelText();
    if (title) title.textContent = info.title;
    if (text) text.textContent = info.text;
  }

  function ensureNpcDialogueWindow() {
    const host = document.getElementById('ui-overlay')
      || document.getElementById('game-container')
      || document.body;
    let win = document.getElementById('npc-dialogue-window');
    if (win) {
      // Native fullscreen only renders descendants of #game-container. Move an
      // older body-mounted dialogue back into the game UI before showing it.
      if (win.parentElement !== host) host.appendChild(win);
      return win;
    }
    win = document.createElement('div');
    win.id = 'npc-dialogue-window';
    win.className = 'ui-panel modal-panel';
    win.innerHTML = `
      <div class="panel-title"><span id="npc-dialogue-title">Диалог</span><button id="npc-dialogue-close" class="ui-btn modal-close-x" aria-label="Закрыть диалог">×</button></div>
      <div id="npc-dialogue-body">
        <div id="npc-dialogue-line"></div>
        <div id="npc-dialogue-options"></div>
      </div>`;
    host.appendChild(win);
    win.querySelector('#npc-dialogue-close')?.addEventListener('click', closeNpcDialogueWindow);
    return win;
  }

  function closeNpcDialogueWindow(options = {}) {
    const win = document.getElementById('npc-dialogue-window');
    if (win) win.style.display = 'none';
    npcDialogueOpen = false;
    document.body.classList.remove('npc-dialogue-window-open');
    if (!options.keepFocus) endNpcDialogueFocus();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function showNpcDialogueWindow(win, actor = activeTraderActor) {
    win.style.display = 'block';
    npcDialogueOpen = true;
    document.body.classList.add('npc-dialogue-window-open');
    if (actor) faceNpcActorToPlayer(actor);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function clampDialogueChance(v, min = 0.08, max = 0.94) {
    return Math.max(min, Math.min(max, Number(v || 0)));
  }

  function traderSpeechCheckChance() {
    return clampDialogueChance(0.22 + skillNorm('speech') * 0.55 + Math.max(0, statValue('cha') - 5) * 0.035 + talentLevel('diplomat') * 0.08);
  }

  function traderScienceCheckChance() {
    return clampDialogueChance(0.18 + skillNorm('science') * 0.50 + skillNorm('repair') * 0.12 + Math.max(0, statValue('int') - 5) * 0.035 + talentLevel('engineer') * 0.07);
  }

  function scrapTraderDialogueLine() {
    if (npcQuestState.scrapParts === 'available') return 'Грач-Жестянщик стучит пальцем по мятым чертежам: "Нужны детали для пресса. Принесёшь сырьё и ремкомплект — расплачусь крышками и патронами."';
    if (npcQuestState.scrapParts === 'active') return hasQuestItems({ ore: 6, wood: 2, repairKit: 1 })
      ? '"Вот это уже похоже на работу. Выкладывай железо, я проверю качество."'
      : '"Мне нужно 6 руды, 2 древесины и ремкомплект. Без этого станок снова заклинит."';
    return '"Пресс снова дышит. Товар смотри спокойно, но не трогай детали без спроса."';
  }

  function relayTraderDialogueLine() {
    if (npcQuestState.relayCalibration === 'available') return 'Рада Искра не отрывается от панели: "Ретранслятор глохнет. Нужны энергозаряды и ремкомплект. Поможешь — открою доступ к лучшему товару."';
    if (npcQuestState.relayCalibration === 'active') return hasQuestItems({ energyCell: 20, repairKit: 1 })
      ? '"Слышу вес батарей в твоём рюкзаке. Давай сюда, пока станция опять не ушла в помехи."'
      : '"Двадцать энергозарядов и один ремкомплект. Меньше не хватит даже на тестовый запуск."';
    return '"Станция держит частоту. Если нужен редкий техно-хлам, смотри ящики на продажу."';
  }

  function traderDialogueLine(trader = activeTraderOrNearby(4.2)) {
    normalizeNpcQuestState();
    const profileId = traderProfileId(trader);
    if (profileId === 'scrap') return scrapTraderDialogueLine();
    if (profileId === 'relay') return relayTraderDialogueLine();
    if (npcQuestState.klimSupplies === 'available') return 'Старый Клим смотрит поверх прилавка: "Если ищешь работу, поселению нужны припасы. Платить буду честно, но без роскоши."';
    if (npcQuestState.klimSupplies === 'active') return hasQuestItems({ ore: 3, wood: 3, water: 1 })
      ? '"Вижу, рюкзак потяжелел. Принёс всё, о чём я просил?"'
      : '"Руда, древесина и вода. Без этого люди здесь долго не протянут."';
    if (npcQuestState.klimTerminal === 'available') return '"Есть ещё дело. В Пепельном лесу стоит редкий тайник с терминалом. Кто вскроет его аккуратно, тот принесёт мне данные."';
    if (npcQuestState.klimTerminal === 'active') return npcQuestState.klimTerminalHacked
      ? '"Терминал заговорил? Тогда выкладывай, что он тебе отдал."'
      : '"Тайник ждёт в лесу. Не ломай терминал кулаками, ему нужна голова."';
    return '"Пока новых поручений нет. Но торговля открыта, если нужны патроны или вода."';
  }

  function addDialogueOption(root, label, handler, disabled = false, hint = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'npc-dialogue-option' + (disabled ? ' disabled' : '');
    btn.textContent = label;
    if (hint) btn.dataset.gameHint = hint;
    btn.disabled = !!disabled;
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) handler?.();
    });
    root.appendChild(btn);
  }

  function attemptTraderDialogueCheck(kind = 'speech', questKey = '') {
    normalizeNpcQuestState();
    const trader = activeTraderOrNearby(4.2) || activeTraderActor;
    const profileId = traderProfileId(trader);
    const targetQuest = questKey || (profileId === 'scrap'
      ? 'scrapParts'
      : (profileId === 'relay' ? 'relayCalibration' : (kind === 'science' ? 'klimTerminal' : 'klimSupplies')));
    if (!targetQuest) return false;
    return submitServerNpcQuestAction(trader, targetQuest, 'negotiate', { kind }, ack => {
      const chance = Math.round(Number(ack.chance || 0) * 100);
      addLog(`Проверка ${kind === 'science' ? 'науки' : 'речи'} ${ack.success ? 'успешна' : 'провалена'} (${chance}%).`, null, 'quest');
      renderTraderDialogue(ack.success ? 'Условия улучшены. За выполненную работу заплатят больше.' : 'Условия награды остались прежними.');
    });
  }

  function renderTraderDialogue(lineOverride = '') {
    const win = ensureNpcDialogueWindow();
    const title = win.querySelector('#npc-dialogue-title');
    const line = win.querySelector('#npc-dialogue-line');
    const options = win.querySelector('#npc-dialogue-options');
    if (!title || !line || !options) return false;
    normalizeNpcQuestState();
    const trader = activeTraderOrNearby(4.2) || activeTraderActor;
    const profileId = traderProfileId(trader);
    const profile = activeTraderProfile(trader);
    title.textContent = trader?.name || profile.title;
    line.textContent = lineOverride || traderDialogueLine(trader);
    options.innerHTML = '';
    if (profileId === 'scrap') {
      const partsCost = questRequirementItems('scrapParts', { ore: 6, wood: 2, repairKit: 1 });
      if (npcQuestState.scrapParts !== 'done') {
        if (!npcQuestState.scrapPartsNegotiated && !npcQuestState.scrapPartsSpeechTried) {
          addDialogueOption(options, `[Речь ${Math.round(traderSpeechCheckChance() * 100)}%] "За срочность надо доплатить."`, () => attemptTraderDialogueCheck('speech', 'scrapParts'));
        }
        const label = npcQuestState.scrapParts === 'active' ? 'Вот сырьё и ремкомплект.' : 'Нужна помощь со станком?';
        addDialogueOption(options, label, () => { advanceTraderQuestAction(); renderTraderDialogue(); });
        if (npcQuestState.scrapParts === 'active' && !hasQuestItems(partsCost)) {
          options.lastElementChild.disabled = true;
          options.lastElementChild.classList.add('disabled');
          options.lastElementChild.dataset.gameHint = `Нужно: руда ${inventory.get('ore') || 0}/6, древесина ${inventory.get('wood') || 0}/2, ремкомплект ${inventory.get('repairKit') || 0}/1.`;
        }
      } else {
        addDialogueOption(options, 'Есть ещё работа?', () => renderTraderDialogue('"Пока станок держится. Если снова начнёт кашлять железом — позову."'));
      }
      addDialogueOption(options, 'Покажи товары.', () => openTraderWindow(activeTraderActor || trader));
      addDialogueOption(options, 'До встречи.', closeNpcDialogueWindow);
      return showNpcDialogueWindow(win, trader);
    }
    if (profileId === 'relay') {
      const relayCost = questRequirementItems('relayCalibration', { energyCell: 20, repairKit: 1 });
      if (npcQuestState.relayCalibration !== 'done') {
        if (!npcQuestState.relayCalibrationNegotiated && !npcQuestState.relayCalibrationScienceTried) {
          addDialogueOption(options, `[Наука ${Math.round(traderScienceCheckChance() * 100)}%] "Я понимаю, как поднять стабильность контура."`, () => attemptTraderDialogueCheck('science', 'relayCalibration'));
        }
        const label = npcQuestState.relayCalibration === 'active' ? 'Вот расходники для ретранслятора.' : 'Что случилось со станцией?';
        addDialogueOption(options, label, () => { advanceTraderQuestAction(); renderTraderDialogue(); });
        if (npcQuestState.relayCalibration === 'active' && !hasQuestItems(relayCost)) {
          options.lastElementChild.disabled = true;
          options.lastElementChild.classList.add('disabled');
          options.lastElementChild.dataset.gameHint = `Нужно: энергозаряды ${inventory.get('energyCell') || 0}/20, ремкомплект ${inventory.get('repairKit') || 0}/1.`;
        }
      } else {
        addDialogueOption(options, 'Есть ещё работа?', () => renderTraderDialogue('"Сейчас сигнал чистый. Когда снова начнёт рвать эфир, узнаешь первым."'));
      }
      addDialogueOption(options, 'Покажи товары.', () => openTraderWindow(activeTraderActor || trader));
      addDialogueOption(options, 'До встречи.', closeNpcDialogueWindow);
      return showNpcDialogueWindow(win, trader);
    }
    const suppliesCost = questRequirementItems('klimSupplies', { ore: 3, wood: 3, water: 1 });
    if (npcQuestState.klimSupplies !== 'done') {
      if (!npcQuestState.klimSuppliesNegotiated && !npcQuestState.klimSuppliesSpeechTried) {
        addDialogueOption(options, `[Речь ${Math.round(traderSpeechCheckChance() * 100)}%] "Работа рискованная. Подними плату."`, () => attemptTraderDialogueCheck('speech'));
      }
      const label = npcQuestState.klimSupplies === 'active' ? 'Вот припасы для поселения.' : 'Есть работа?';
      addDialogueOption(options, label, () => { advanceTraderQuestAction(); renderTraderDialogue(); });
      if (npcQuestState.klimSupplies === 'active' && !hasQuestItems(suppliesCost)) {
        options.lastElementChild.disabled = true;
        options.lastElementChild.classList.add('disabled');
        options.lastElementChild.dataset.gameHint = `Нужно: руда ${inventory.get('ore') || 0}/3, древесина ${inventory.get('wood') || 0}/3, вода ${inventory.get('water') || 0}/1.`;
      }
    } else if (npcQuestState.klimTerminal !== 'done') {
      if (npcQuestState.klimTerminal === 'available' && !npcQuestState.klimTerminalNegotiated && !npcQuestState.klimTerminalScienceTried) {
        addDialogueOption(options, `[Наука ${Math.round(traderScienceCheckChance() * 100)}%] "Терминал может быть ценнее, чем ты думаешь."`, () => attemptTraderDialogueCheck('science'));
      }
      const label = npcQuestState.klimTerminal === 'active'
        ? (npcQuestState.klimTerminalHacked ? 'Вот данные с терминала.' : 'Я ещё найду этот терминал.')
        : 'Что за тайник в лесу?';
      addDialogueOption(options, label, () => { advanceTraderQuestAction(); renderTraderDialogue(); }, npcQuestState.klimTerminal === 'active' && !npcQuestState.klimTerminalHacked, 'Сначала взломайте терминал редкого тайника.');
    } else {
      addDialogueOption(options, 'Есть новая работа?', () => renderTraderDialogue('"Пока нет. Сначала переварим то, что ты уже принёс."'));
    }
    addDialogueOption(options, 'Покажи товары.', () => openTraderWindow(activeTraderActor));
    addDialogueOption(options, 'До встречи.', closeNpcDialogueWindow);
    win.style.display = 'block';
    npcDialogueOpen = true;
    document.body.classList.add('npc-dialogue-window-open');
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function npcDialogueVariant(actor, count = 1) {
    const raw = String(actor?.id || actor?.name || '');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    return count > 0 ? hash % count : 0;
  }

  function guardDialogueProfile(actor) {
    const faction = String(actor?.faction || '');
    const role = String(actor?.encounterRole || '');
    const klim = faction === 'klim_patrol';
    const caravan = faction === 'caravan';
    const variants = klim ? [
      'Патруль Старого Клима держит периметр. Могу уступить лишние патроны и бинты, но без лишних вопросов.',
      'Если видел гулей у низины, говори сразу. В бартере только служебный излишек: патроны, вода, ремонтные мелочи.',
      'Порядок держится на воде, патронах и дисциплине. Первые два иногда продаю тем, кто не ищет беды.'
    ] : caravan ? [
      'Караван идет по старой трассе. Патроны лишними не бывают, но шум не поднимай.',
      'Торговец считает крышки, я считаю стволы. Есть немного патронов и мелочей, если платишь быстро.',
      'Не подходи к каравану со спины. Хочешь обменяться - показывай крышки и не тяни время.'
    ] : [
      'Я на посту. Если нужен обмен, говори коротко.',
      'Лишнего у меня немного, но кое-что для дороги найдется.',
      'Сначала разговор, потом руки к кобуре. Так всем спокойнее.'
    ];
    const title = klim
      ? (role === 'guard' ? 'Патруль Старого Клима' : 'Охрана Старого Клима')
      : (caravan ? 'Охрана каравана' : 'Охрана');
    const interests = activeTraderBuyInterests(actor);
    const interestText = interests.length
      ? `Особенно интересуют: ${interests.map(itemCategoryLabel).join(', ')}.`
      : 'Покупаю только то, что пригодится на дороге.';
    return {
      title: actor?.name || title,
      roleName: title,
      line: variants[npcDialogueVariant(actor, variants.length)],
      interestText
    };
  }

  function renderGuardDialogue(actor) {
    const win = ensureNpcDialogueWindow();
    const title = win.querySelector('#npc-dialogue-title');
    const line = win.querySelector('#npc-dialogue-line');
    const options = win.querySelector('#npc-dialogue-options');
    if (!title || !line || !options) return false;
    const profile = guardDialogueProfile(actor);
    title.textContent = profile.title;
    line.textContent = `${profile.line} ${profile.interestText}`;
    options.innerHTML = '';
    addDialogueOption(options, 'Показать товары.', () => openTraderWindow(actor));
    addDialogueOption(options, 'Что происходит вокруг?', () => {
      renderGuardDialogue(actor);
      const nextLine = win.querySelector('#npc-dialogue-line');
      if (nextLine) nextLine.textContent = actor?.faction === 'klim_patrol'
        ? 'Патруль следит за дорогой к Старому Климу. Если услышишь стрельбу - либо помогай, либо уходи с линии огня.'
        : 'Караваны ходят редко и с охраной. На дороге полно тварей, а люди иногда хуже тварей.';
    });
    addDialogueOption(options, 'Попрощаться.', closeNpcDialogueWindow);
    win.style.display = 'block';
    npcDialogueOpen = true;
    document.body.classList.add('npc-dialogue-window-open');
    faceNpcActorToPlayer(actor);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function renderCaravanTraderDialogue(trader) {
    const win = ensureNpcDialogueWindow();
    const title = win.querySelector('#npc-dialogue-title');
    const line = win.querySelector('#npc-dialogue-line');
    const options = win.querySelector('#npc-dialogue-options');
    if (!title || !line || !options) return false;
    const interests = activeTraderBuyInterests(trader);
    const roleName = trader?.encounterRole === 'merchant' ? 'Караванщик' : 'Торговец';
    title.textContent = trader?.name || roleName;
    line.textContent = interests.length
      ? `${roleName} оценивает дорогу и товар: "Квестов нет. Беру дороже: ${interests.map(itemCategoryLabel).join(', ')}. Остальное тоже посмотрю, но без щедрости."`
      : `${roleName} кивает: "Можем обменяться, если есть крышки или товар."`;
    options.innerHTML = '';
    addDialogueOption(options, 'Покажи товары.', () => openTraderWindow(trader));
    addDialogueOption(options, 'Попрощаться.', closeNpcDialogueWindow);
    win.style.display = 'block';
    npcDialogueOpen = true;
    document.body.classList.add('npc-dialogue-window-open');
    faceNpcActorToPlayer(trader);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function friendlyNpcDialogueLine(actor, salt = 0) {
    const role = String(actor?.role || actor?.encounterRole || 'npc').toLowerCase();
    const schedule = String(actor?.scheduleState || '').toLowerCase();
    const faction = String(actor?.wastelandOwnerLabel || actor?.faction || '').trim();
    const linesByRole = {
      guard: [
        '\u041f\u043e\u043a\u0430 \u0442\u0438\u0445\u043e. \u041d\u043e \u0432 \u043f\u0443\u0441\u0442\u043e\u0448\u0438 \u0442\u0438\u0448\u0438\u043d\u0430 \u043e\u0431\u044b\u0447\u043d\u043e \u043d\u0435\u043d\u0430\u0434\u043e\u043b\u0433\u043e.',
        '\u0421\u043b\u0435\u0436\u0443 \u0437\u0430 \u043f\u043e\u0440\u044f\u0434\u043a\u043e\u043c. \u0415\u0441\u043b\u0438 \u0438\u0449\u0435\u0448\u044c \u043f\u0440\u0438\u043f\u0430\u0441\u044b, \u043c\u043e\u0436\u0435\u043c \u043e\u0431\u043c\u0435\u043d\u044f\u0442\u044c\u0441\u044f.'
      ],
      worker: [
        '\u0420\u0430\u0431\u043e\u0442\u044b \u0445\u0432\u0430\u0442\u0430\u0435\u0442. \u0417\u0430\u0442\u043e \u043f\u043e\u0441\u0435\u043b\u0435\u043d\u0438\u0435 \u0435\u0449\u0451 \u0434\u0435\u0440\u0436\u0438\u0442\u0441\u044f.',
        '\u0421\u0435\u0439\u0447\u0430\u0441 \u0434\u043e\u0434\u0435\u043b\u0430\u044e \u0441\u043c\u0435\u043d\u0443. \u041c\u043e\u0436\u0435\u043c \u0437\u0430\u043e\u0434\u043d\u043e \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c, \u0447\u0435\u043c \u043e\u0431\u043c\u0435\u043d\u044f\u0442\u044c\u0441\u044f.'
      ],
      craftsman: [
        '\u0425\u043e\u0440\u043e\u0448\u0438\u0439 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u0437\u0434\u0435\u0441\u044c \u0434\u043e\u0440\u043e\u0436\u0435 \u043a\u0440\u0430\u0441\u0438\u0432\u044b\u0445 \u0441\u043b\u043e\u0432.',
        '\u0415\u0441\u043b\u0438 \u0435\u0441\u0442\u044c \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b \u0438\u043b\u0438 \u0437\u0430\u043f\u0430\u0441\u043d\u044b\u0435 \u0434\u0435\u0442\u0430\u043b\u0438, \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0439.'
      ],
      medic: [
        '\u041b\u0435\u043a\u0430\u0440\u0441\u0442\u0432 \u0432\u0441\u0435\u0433\u0434\u0430 \u043c\u0435\u043d\u044c\u0448\u0435, \u0447\u0435\u043c \u0440\u0430\u043d\u0435\u043d\u044b\u0445. \u0411\u0435\u0440\u0435\u0433\u0438 \u0441\u0435\u0431\u044f.',
        '\u041f\u0440\u0438\u043d\u043e\u0441\u0438 \u043c\u0435\u0434\u0438\u043a\u0430\u043c\u0435\u043d\u0442\u044b \u0438 \u0445\u0438\u043c\u0438\u043a\u0430\u0442\u044b. \u041f\u043e \u0446\u0435\u043d\u0435 \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u043c\u0441\u044f.'
      ],
      npc: [
        '\u0412 \u043f\u0443\u0441\u0442\u043e\u0448\u0438 \u043b\u0438\u0448\u043d\u0438\u0445 \u0432\u0435\u0449\u0435\u0439 \u043d\u0435 \u0431\u044b\u0432\u0430\u0435\u0442. \u041c\u043e\u0436\u0435\u043c \u043e\u0431\u043c\u0435\u043d\u044f\u0442\u044c\u0441\u044f.',
        '\u0414\u043e\u0440\u043e\u0433\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f \u0441\u043f\u043e\u043a\u043e\u0439\u043d\u0430\u044f. \u0425\u043e\u0442\u044f \u0437\u0430\u0432\u0442\u0440\u0430 \u0432\u0441\u0451 \u043c\u043e\u0436\u0435\u0442 \u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c\u0441\u044f.'
      ]
    };
    const group = linesByRole[role] || linesByRole.npc;
    const activity = schedule === 'harvest' ? '\u0421\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043d\u044f\u0442 \u0441\u0431\u043e\u0440\u043e\u043c \u0440\u0435\u0441\u0443\u0440\u0441\u043e\u0432, \u043d\u043e \u043f\u0430\u0440\u0430 \u0441\u043b\u043e\u0432 \u043d\u0430\u0439\u0434\u0451\u0442\u0441\u044f.'
      : schedule === 'craft' ? '\u0420\u0430\u0431\u043e\u0442\u0430 \u043d\u0435 \u0436\u0434\u0451\u0442, \u043d\u043e \u044f \u0441\u043b\u0443\u0448\u0430\u044e.'
        : schedule === 'rest' ? '\u041a\u0430\u043a \u0440\u0430\u0437 \u0432\u044b\u0434\u0430\u043b\u0430\u0441\u044c \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u0430\u044f \u043c\u0438\u043d\u0443\u0442\u0430.'
          : schedule === 'sleep' ? '\u0422\u044b \u043c\u0435\u043d\u044f \u0440\u0430\u0437\u0431\u0443\u0434\u0438\u043b. \u041b\u0430\u0434\u043d\u043e, \u0433\u043e\u0432\u043e\u0440\u0438, \u0440\u0430\u0437 \u0443\u0436 \u043f\u0440\u0438\u0448\u0451\u043b.' : '';
    const line = activity || group[(npcDialogueVariant(actor, group.length) + Math.max(0, salt)) % group.length];
    return faction ? `${line} [${faction}]` : line;
  }

  function renderFriendlyNpcDialogue(actor, lineOverride = '') {
    const win = ensureNpcDialogueWindow();
    const title = win.querySelector('#npc-dialogue-title');
    const line = win.querySelector('#npc-dialogue-line');
    const options = win.querySelector('#npc-dialogue-options');
    if (!title || !line || !options || !actor) return false;
    title.textContent = actor.name || '\u0416\u0438\u0442\u0435\u043b\u044c \u043f\u0443\u0441\u0442\u043e\u0448\u0438';
    line.textContent = lineOverride || friendlyNpcDialogueLine(actor);
    options.innerHTML = '';
    addDialogueOption(options, '\u041a\u0430\u043a \u0438\u0434\u0443\u0442 \u0434\u0435\u043b\u0430?', () => renderFriendlyNpcDialogue(actor, friendlyNpcDialogueLine(actor, 1)));
    addDialogueOption(options, '\u041f\u043e\u043a\u0430\u0436\u0438, \u0447\u0435\u043c \u0433\u043e\u0442\u043e\u0432 \u043e\u0431\u043c\u0435\u043d\u044f\u0442\u044c\u0441\u044f.', () => openTraderWindow(actor));
    addDialogueOption(options, '\u0414\u043e \u0432\u0441\u0442\u0440\u0435\u0447\u0438.', closeNpcDialogueWindow);
    return showNpcDialogueWindow(win, actor);
  }

  function openTraderDialogue(traderOverride = null) {
    const trader = traderActorInRange(traderOverride, 4.2) ? traderOverride : activeTraderOrNearby(4.2);
    if (!trader) {
      setReadout('Рядом нет НПС для разговора.');
      return false;
    }
    closeAllWindows();
    activeTraderActor = trader;
    beginNpcDialogueFocus(trader);
    if (!canTalkToNpcActor(trader)) {
      setReadout('\u0421 \u044d\u0442\u0438\u043c \u041d\u041f\u0421 \u043d\u0435\u043b\u044c\u0437\u044f \u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c.');
      return false;
    }
    const role = String(trader.role || trader.encounterRole || '').toLowerCase();
    const dialogueProfile = cleanTraderProfileKey(trader.dialogueProfile || '').toLowerCase();
    const questDialogue = trader === traderNpc
      || isLocationTraderActor(trader)
      || activeTraderQuests(trader).length > 0
      || ['klim', 'scrap', 'relay'].includes(dialogueProfile);
    if (role === 'guard' || role === 'patrol') return renderGuardDialogue(trader);
    if (role === 'merchant' && trader !== traderNpc && !isLocationTraderActor(trader)) return renderCaravanTraderDialogue(trader);
    if (questDialogue) return renderTraderDialogue();
    return renderFriendlyNpcDialogue(trader);
  }

  function submitServerNpcQuestAction(trader, questId, action, extra = {}, onSuccess = null) {
    if (!trader || !questId) return false;
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Задания недоступны без соединения с сервером мира.');
      return false;
    }
    if (trader.questPending) return false;
    trader.questPending = true;
    multiplayer.socket.emit('npcQuestAction', {
      enemyId: trader.id || '',
      questId,
      action,
      ...extra
    }, ack => {
      trader.questPending = false;
      if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      if (!ack?.ok) {
        setReadout(ack?.error || 'Сервер отклонил действие задания.');
        updateNpcQuestPanel();
        renderTraderWindow();
        return;
      }
      if (typeof onSuccess === 'function') onSuccess(ack);
      updateNpcQuestPanel();
      renderTraderWindow();
      queueSave(true);
    });
    return true;
  }

  function advanceTraderQuestAction() {
    const trader = activeTraderOrNearby(4.2);
    if (!trader) {
      setReadout('Рядом нет НПС для разговора.');
      return false;
    }
    normalizeNpcQuestState();
    const profileId = traderProfileId(trader);
    const quests = activeTraderQuests(trader);
    const questId = profileId === 'scrap' && quests.includes('scrapParts')
      ? 'scrapParts'
      : (profileId === 'relay' && quests.includes('relayCalibration')
        ? 'relayCalibration'
        : (npcQuestState.klimSupplies === 'done' ? 'klimTerminal' : 'klimSupplies'));
    const state = npcQuestState[questId];
    if (state === 'done') {
      setReadout(`${trader.name}: пока новой работы нет.`);
      return true;
    }
    const action = state === 'active' ? 'complete' : 'accept';
    return submitServerNpcQuestAction(trader, questId, action, {}, ack => {
      if (action === 'accept') {
        const name = questDef(questId)?.name || questId;
        addLog(`Поручение принято: ${name}.`, null, 'quest');
        setReadout(`Поручение принято: ${name}.`);
        renderTraderDialogue();
        return;
      }
      const reward = ack.reward || {};
      addLog(`${questDef(questId)?.name || questId}: +${Math.max(0, Number(reward.xp || 0))} XP, +${Math.max(0, Number(reward.silver || 0))} крышек.`, null, 'level');
      setReadout(`${trader.name}: задание выполнено.`);
      renderTraderDialogue();
    });
  }

  function talkToTraderQuest(traderOverride = null) {
    return openTraderDialogue(traderOverride);
  }

  function noteNpcQuestEvent(event, details = {}) {
    normalizeNpcQuestState();
    if (event !== 'klimTerminal' || npcQuestState.klimTerminal !== 'active') return false;
    npcQuestState.klimTerminalHacked = true;
    addLog('Получены данные с терминала редкого тайника. Вернитесь к Старому Климу.', null, 'quest');
    setReadout('Квест обновлён: вернитесь к Старому Климу.');
    updateNpcQuestPanel();
    renderTraderWindow();
    queueSave(true);
    return true;
  }
