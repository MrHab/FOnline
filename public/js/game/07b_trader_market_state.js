  // ===== TRADER WINDOW =====  // ===== TRADER WINDOW =====
  let traderWindowOpen = false;
  let saleQueue = new Map();
  let buyQueue = new Map();
  let activeTraderActor = null;
  let traderMarketState = {};
  let traderMarketRestockCheckTimer = 0;
  const tradeMachineMarketRequests = new Set();
  const npcQuestState = {
    klimSupplies: 'available',
    klimTerminal: 'locked',
    klimTerminalHacked: false,
    klimSuppliesNegotiated: false,
    klimSuppliesSpeechTried: false,
    klimTerminalNegotiated: false,
    klimTerminalScienceTried: false,
    scrapParts: 'available',
    scrapPartsNegotiated: false,
    scrapPartsSpeechTried: false,
    relayCalibration: 'available',
    relayCalibrationNegotiated: false,
    relayCalibrationScienceTried: false
  };
  let npcQuestDefinitions = {};
  let npcQuestDefinitionsLoaded = false;

  function normalizeNpcQuestDefinitions(input = {}) {
    const src = input && typeof input === 'object' && input.quests && typeof input.quests === 'object'
      ? input.quests
      : input;
    const out = {};
    Object.entries(src || {}).forEach(([questId, quest]) => {
      if (!quest || typeof quest !== 'object') return;
      const id = String(quest.id || questId || '').trim();
      if (!id) return;
      const reqItems = quest.requirements && typeof quest.requirements.items === 'object' ? quest.requirements.items : {};
      const items = {};
      Object.entries(reqItems || {}).forEach(([itemId, qty]) => {
        const safeQty = Math.max(0, Math.floor(Number(qty || 0)));
        if (itemId && safeQty > 0) items[itemId] = safeQty;
      });
      out[id] = {
        id,
        title: String(quest.title || quest.name || id),
        name: String(quest.name || id),
        initialState: String(quest.initialState || 'available'),
        requirements: {
          items,
          labels: quest.requirements && typeof quest.requirements.labels === 'object' ? { ...quest.requirements.labels } : {},
          event: String(quest.requirements?.event || '')
        },
        panel: quest.panel && typeof quest.panel === 'object' ? { ...quest.panel } : {},
        unlocks: Array.isArray(quest.unlocks) ? quest.unlocks.map(String).filter(Boolean) : []
      };
    });
    return out;
  }

  function questDef(questKey = '') {
    return npcQuestDefinitions[String(questKey || '')] || null;
  }

  function questRequirementItems(questKey = '', fallback = {}) {
    const items = questDef(questKey)?.requirements?.items;
    return items && Object.keys(items).length ? { ...items } : { ...fallback };
  }

  function questTitle(questKey = '', fallback = 'Поручение') {
    return questDef(questKey)?.title || fallback;
  }

  function questPanelLine(questKey = '', state = 'active', fallback = '') {
    const panel = questDef(questKey)?.panel || {};
    return String(panel[state] || fallback || '');
  }

  function questRequirementsProgressText(questKey = '', fallbackItems = {}) {
    const def = questDef(questKey);
    const items = questRequirementItems(questKey, fallbackItems);
    const labels = def?.requirements?.labels || {};
    const rows = Object.entries(items).map(([itemId, qty]) => `${labels[itemId] || itemId} ${inventory.get(itemId) || 0}/${qty}`);
    return rows.join(' · ');
  }

  async function loadNpcQuestDefinitions() {
    try {
      const data = typeof serverApi === 'function'
        ? await serverApi('/api/quests', { method: 'GET' })
        : await fetch('/api/quests', { cache: 'no-store' }).then(res => res.json());
      const next = normalizeNpcQuestDefinitions(data?.quests || data);
      if (Object.keys(next).length) {
        npcQuestDefinitions = next;
        npcQuestDefinitionsLoaded = true;
        normalizeNpcQuestState();
        updateNpcQuestPanel();
      }
    } catch (err) {
      console.warn('[quests] failed to load quest data', err);
    }
    return npcQuestDefinitionsLoaded;
  }
  loadNpcQuestDefinitions();
  let npcDialogueOpen = false;
  let npcDialogueFocusActor = null;
  let npcDialogueFocusTimer = null;

  const LOCATION_TRADER_PROFILES = {
    klim: {
      id: 'klim',
      title: 'Старый Клим',
      caps: 720,
      quests: ['klimSupplies', 'klimTerminal']
    },
    scrap: {
      id: 'scrap',
      title: 'Грач-Жестянщик',
      caps: 460,
      quests: ['scrapParts']
    },
    relay: {
      id: 'relay',
      title: 'Рада Искра',
      caps: 640,
      quests: ['relayCalibration']
    }
  };

  function cleanTraderProfileKey(value = '') {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }

  function isLocationTraderActor(actor = null) {
    if (!actor || actor === traderNpc) return true;
    const locTrader = currentLocation?.trader || {};
    const actorIds = [
      actor.traderId,
      actor.traderProfile,
      actor.tradeProfile,
      actor.dialogueProfile,
      actor.id,
      actor.authoredLocationObjectId
    ].map(value => cleanTraderProfileKey(value).toLowerCase()).filter(Boolean);
    const locationIds = [
      locTrader.id,
      locTrader.traderId,
      locTrader.traderProfile,
      locTrader.tradeProfile,
      locTrader.dialogueProfile,
      locTrader.objectId
    ].map(value => cleanTraderProfileKey(value).toLowerCase()).filter(Boolean);
    return actorIds.some(id => locationIds.includes(id));
  }

  function traderProfileId(actor = null) {
    const useLocationFallback = isLocationTraderActor(actor);
    const direct = cleanTraderProfileKey(actor?.dialogueProfile || actor?.traderProfile || (useLocationFallback ? currentLocation?.trader?.dialogueProfile : ''));
    if (LOCATION_TRADER_PROFILES[direct]) return direct;
    const actorId = cleanTraderProfileKey(actor?.traderId || actor?.id || (useLocationFallback ? currentLocation?.trader?.id : '')).toLowerCase();
    if (actorId.includes('scrap')) return 'scrap';
    if (actorId.includes('relay')) return 'relay';
    if (actorId.includes('klim')) return 'klim';
    const loc = cleanTraderProfileKey((useLocationFallback ? (actor?.locationId || currentLocation?.id) : actor?.locationId) || '').toLowerCase();
    if (loc === 'scraptown') return 'scrap';
    if (loc === 'relaystation') return 'relay';
    return 'klim';
  }

  function activeTraderProfile(actor = null) {
    return LOCATION_TRADER_PROFILES[traderProfileId(actor)] || LOCATION_TRADER_PROFILES.klim;
  }

  function activeTraderQuests(actor = null) {
    if (Array.isArray(actor?.traderQuests) && actor.traderQuests.length) {
      return actor.traderQuests.map(id => String(id || '').trim()).filter(Boolean);
    }
    if (actor && !isLocationTraderActor(actor)) return [];
    const raw = Array.isArray(currentLocation?.trader?.quests)
      ? currentLocation.trader.quests
      : activeTraderProfile(actor).quests;
    return raw.map(id => String(id || '').trim()).filter(Boolean);
  }

  const CARAVAN_TRADER_STOCK = [
    { id: 'water', price: 5 },
    { id: 'oil', price: 9 },
    { id: 'stim', price: 12 },
    { id: 'medkit', price: 22 },
    { id: 'doctorBag', price: 38 },
    { id: 'antibiotics', price: 28 },
    { id: 'ammo9', price: 2 },
    { id: 'ammo556', price: 4 },
    { id: 'shotgunShell', price: 5 },
    { id: 'napalm', price: 6 },
    { id: 'pickaxe', price: 18 },
    { id: 'axe', price: 16 },
    { id: 'handPump', price: 24 },
    { id: 'repairKit', price: 20 },
    { id: 'leather', price: 28 },
    { id: 'helmet', price: 18 },
    { id: 'boots', price: 16 },
    { id: 'pistol', price: 54 },
    { id: 'rifle', price: 86 }
  ];

  const TRADER_DAILY_STOCK_QTY = {
    ammo9: 90,
    ammo556: 75,
    energyCell: 48,
    napalm: 40,
    shotgunShell: 36,
    rocketAmmo: 8,
    water: 10,
    oil: 8,
    scrap: 18,
    stim: 8,
    medkit: 5,
    doctorBag: 2,
    antibiotics: 4,
    repairKit: 4,
    pickaxe: 2,
    axe: 2,
    handPump: 1,
    pistol: 2,
    rifle: 2,
    assaultRifle: 1,
    machineGun: 1,
    laserPistol: 1,
    flamethrower: 1,
    plasmaRifle: 1,
    shotgun: 1,
    rocketLauncher: 1,
    leather: 2,
    metalArmor: 1,
    ballisticVest: 1,
    combatArmor: 1,
    hazmatSuit: 1,
    heavyArmor: 1,
    energySuit: 1,
    helmet: 2,
    tacticalHelmet: 1,
    assaultHelmet: 1,
    boots: 2,
    scoutBoots: 1,
    reinforcedBoots: 1,
    backpack: 1
  };

  function isEncounterMerchantActor(actor) {
    return !!(actor && !actor.dead && !actor._removed && actor.hostileToPlayer === false && isCaravanTrader(actor));
  }

  function isTradeGuardActor(actor) {
    if (!actor || actor.dead || actor._removed || actor.hostileToPlayer !== false) return false;
    const faction = String(actor.faction || '');
    const role = String(actor.encounterRole || '');
    return role === 'guard' && (faction === 'caravan' || faction === 'klim_patrol');
  }

  function isSilentCreatureActor(actor) {
    if (!actor || actor.dead || actor._removed) return false;
    const role = String(actor.encounterRole || actor.role || '').toLowerCase();
    const species = String(actor.species || '').toLowerCase();
    const visual = String(actor.visual || actor.modelKey || actor.mesh?.userData?.enemyVisual || '').toLowerCase();
    return actor.canDialogue === false
      || role === 'animal'
      || role === 'monster'
      || species === 'brahmin'
      || visual === 'brahmin'
      || visual === 'friendlybrahmin';
  }

  function isCaravanTrader(actor) {
    if (actor?.isTradeMachine) return true;
    if (isSilentCreatureActor(actor)) return false;
    return !!(actor && !actor.dead && !actor._removed && actor.hostileToPlayer === false);
  }

  function canTalkToNpcActor(actor) {
    if (!actor || actor.dead || actor._removed || actor.hostileToPlayer !== false) return false;
    return !isSilentCreatureActor(actor);
  }

  function faceNpcActorToPlayer(actor) {
    if (!actor || !player) return;
    const dx = Number(player.x || 0) - Number(actor.x || actor.visualX || 0);
    const dz = Number(player.z || 0) - Number(actor.z || actor.visualZ || 0);
    if (Math.hypot(dx, dz) <= 0.05) return;
    actor.lookX = Number(player.x || 0);
    actor.lookZ = Number(player.z || 0);
    actor.aiState = 'dialogue';
    actor.netVx = 0;
    actor.netVz = 0;
    actor.enemyVisualSpeed = 0;
    if (actor.mesh?.rotation) {
      const targetRot = Math.atan2(dx, dz) + Math.PI;
      const currentRot = Number(actor.mesh.rotation.y || 0);
      const diff = Math.atan2(Math.sin(targetRot - currentRot), Math.cos(targetRot - currentRot));
      actor.mesh.rotation.y = currentRot + diff * 0.85;
    }
  }

  function emitNpcDialogueFocus(actor, active = true) {
    const enemyId = String(actor?.id || '');
    if (!enemyId || typeof multiplayer === 'undefined' || !multiplayer.socket?.connected) return;
    multiplayer.socket.emit('npcDialogueFocus', { enemyId, active: !!active }, ack => {
      if (!ack || !ack.ok || !ack.enemy || typeof applyNetworkEnemies !== 'function') return;
      applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
    });
  }

  function beginNpcDialogueFocus(actor) {
    if (!actor || actor.dead || actor._removed) return;
    if (npcDialogueFocusActor && npcDialogueFocusActor !== actor) endNpcDialogueFocus(npcDialogueFocusActor);
    npcDialogueFocusActor = actor;
    faceNpcActorToPlayer(actor);
    emitNpcDialogueFocus(actor, true);
    if (npcDialogueFocusTimer) clearInterval(npcDialogueFocusTimer);
    npcDialogueFocusTimer = setInterval(() => {
      if (!npcDialogueFocusActor || (!npcDialogueOpen && !traderWindowOpen) || !traderActorInRange(npcDialogueFocusActor, 5.8)) {
        endNpcDialogueFocus(npcDialogueFocusActor);
        return;
      }
      faceNpcActorToPlayer(npcDialogueFocusActor);
      emitNpcDialogueFocus(npcDialogueFocusActor, true);
    }, 3500);
  }

  function endNpcDialogueFocus(actor = npcDialogueFocusActor) {
    if (npcDialogueFocusTimer) {
      clearInterval(npcDialogueFocusTimer);
      npcDialogueFocusTimer = null;
    }
    if (actor) emitNpcDialogueFocus(actor, false);
    npcDialogueFocusActor = null;
  }

  function findNearbyEncounterTrader(maxDist = 3.0) {
    if (!Array.isArray(enemies)) return null;
    let best = null;
    let bestDist = maxDist;
    enemies.forEach(actor => {
      if (!isEncounterMerchantActor(actor)) return;
      const d = Math.hypot(Number(actor.x || 0) - player.x, Number(actor.z || 0) - player.z);
      if (d <= bestDist) { best = actor; bestDist = d; }
    });
    return best;
  }

  function findNearbyTradeMachine(maxDist = 3.0) {
    if (!Array.isArray(locationTradeMachines) || !locationTradeMachines.length) return null;
    let best = null;
    let bestDist = maxDist;
    locationTradeMachines.forEach(machine => {
      if (!machine || machine._removed || (machine.mesh && machine.mesh.visible === false)) return;
      const d = Math.hypot(Number(machine.x || 0) - player.x, Number(machine.z || 0) - player.z);
      if (d <= bestDist) {
        best = machine;
        bestDist = d;
      }
    });
    return best;
  }

  function findNearbyTrader(maxDist = 3.0) {
    const encounterTrader = findNearbyEncounterTrader(maxDist);
    if (encounterTrader) return encounterTrader;
    const tradeMachine = findNearbyTradeMachine(maxDist);
    if (tradeMachine) return tradeMachine;
    if (!traderNpc) return null;
    const d = Math.hypot(traderNpc.x - player.x, traderNpc.z - player.z);
    return d <= maxDist ? traderNpc : null;
  }

  function traderActorInRange(trader, maxDist = 4.2) {
    if (!trader) return false;
    if (trader.dead || trader._removed) return false;
    const d = Math.hypot(Number(trader.x || 0) - player.x, Number(trader.z || 0) - player.z);
    return d <= maxDist;
  }

  function activeTraderOrNearby(maxDist = 4.2) {
    if (traderActorInRange(activeTraderActor, maxDist)) return activeTraderActor;
    activeTraderActor = null;
    return findNearbyTrader(maxDist);
  }

  function normalizeTraderStockRows(rows = []) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(entry => {
        const id = String(entry?.id || '');
        const rawQty = Number(entry?.qty);
        return {
          id,
          price: Math.max(1, Math.round(Number(entry?.price || 1))),
          qty: Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : traderDefaultStockQty(id)
        };
      })
      .filter(entry => entry.id && ITEMS[entry.id] && entry.price > 0 && entry.qty > 0);
  }

  function normalizeNpcInventoryRows(input = []) {
    const rows = Array.isArray(input)
      ? input
      : (input && typeof input === 'object'
        ? Object.entries(input).map(([id, qty]) => ({ id, qty }))
        : []);
    const out = new Map();
    rows.forEach(row => {
      const id = typeof baseItemId === 'function' ? baseItemId(row?.id || row?.itemId || '') : String(row?.id || row?.itemId || '');
      if (!id || !ITEMS[id] || id === 'fists') return;
      const qty = Math.max(0, Math.floor(Number(row?.qty ?? row?.count ?? 0)));
      if (qty <= 0) return;
      out.set(id, Math.min(9999, (out.get(id) || 0) + qty));
    });
    return Array.from(out.entries()).map(([id, qty]) => ({ id, qty }));
  }

  function npcInventoryCapsOrNull(actor = null) {
    if (!actor || !Array.isArray(actor.inventory)) return null;
    return actor.inventory
      .filter(row => (typeof baseItemId === 'function' ? baseItemId(row?.id || '') : String(row?.id || '')) === 'silver')
      .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.qty || 0))), 0);
  }

  function setNpcInventoryItem(actor = null, itemId = '', qty = 0) {
    if (!actor) return 0;
    const id = typeof baseItemId === 'function' ? baseItemId(itemId) : String(itemId || '');
    if (!id || !ITEMS[id]) return 0;
    const safeQty = Math.max(0, Math.floor(Number(qty || 0)));
    const rows = normalizeNpcInventoryRows(actor.inventory || []).filter(row => row.id !== id);
    if (safeQty > 0) rows.push({ id, qty: Math.min(9999, safeQty) });
    actor.inventory = rows;
    actor.inventoryUpdatedAt = Date.now();
    return safeQty;
  }

  function setNpcInventoryCaps(actor = null, caps = 0) {
    const safeCaps = setNpcInventoryItem(actor, 'silver', caps);
    if (actor) actor.traderCaps = safeCaps;
    return safeCaps;
  }

  function syncNpcTradeStateToServer(trader = null) {
    if (!trader || trader.isTradeMachine || !trader.id || typeof multiplayer === 'undefined' || !multiplayer?.socket || !multiplayer.socket.connected) return;
    multiplayer.socket.emit('syncNpcTradeState', {
      enemyId: trader.id,
      caps: npcInventoryCapsOrNull(trader) ?? Math.max(0, Math.floor(Number(trader.traderCaps || 0))),
      inventory: normalizeNpcInventoryRows(trader.inventory || []),
      traderStock: normalizeTraderStockRows(trader.traderStock || [])
    }, ack => {
      if (!ack || !ack.ok || !ack.enemy || typeof applyNetworkEnemies !== 'function') return;
      applyNetworkEnemies([ack.enemy], { allowPositionSync: false, fromServer: true, pruneMissing: false });
    });
  }

  function traderDefaultStockQty(id, entry = null) {
    const rawQty = Number(entry?.qty);
    if (Number.isFinite(rawQty)) return Math.max(0, Math.floor(rawQty));
    const fixed = TRADER_DAILY_STOCK_QTY[id];
    if (Number.isFinite(Number(fixed))) return Math.max(1, Math.floor(Number(fixed)));
    const item = ITEMS[id];
    const type = String(item?.type || '').toLowerCase();
    if (type === 'ammo') return 45;
    if (type === 'consumable') return 4;
    if (type === 'material') return 8;
    if (['weapon', 'armor', 'helmet', 'boots', 'backpack'].includes(type)) return 1;
    return 3;
  }

  function traderBaseStockRows(trader) {
    if (Array.isArray(trader?.traderStock) && trader.traderStock.length) return trader.traderStock;
    return [];
  }

  function buildTraderRestockStock(trader) {
    return normalizeTraderStockRows(traderBaseStockRows(trader).map(entry => ({
      id: entry.id,
      price: entry.price,
      qty: traderDefaultStockQty(entry.id, entry)
    })));
  }

  function traderMarketKey(trader) {
    if (!trader) return 'global:trader';
    const actorId = String(trader.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (actorId) return `actor:${actorId}`;
    const loc = String(trader.locationId || currentLocation?.id || 'settlement').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const name = String(trader.name || 'trader').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'trader';
    return `loc:${loc}:${name}`;
  }

  function applyServerTradeMachineMarket(machine, market = {}) {
    if (!machine || !machine.isTradeMachine || !market || market.ok === false) return null;
    const stock = normalizeTraderStockRows(market.stock || []);
    const caps = Math.max(0, Math.floor(Number(market.caps || 0)));
    const key = traderMarketKey(machine);
    machine.serverMarketAuthoritative = true;
    machine.siteId = String(market.siteId || machine.siteId || '').slice(0, 64);
    machine.traderProfile = String(market.traderProfile || machine.traderProfile || '').slice(0, 64);
    machine.traderBuyInterests = Array.isArray(market.buyInterests)
      ? market.buyInterests.map(value => String(value || '')).filter(Boolean)
      : (Array.isArray(machine.traderBuyInterests) ? machine.traderBuyInterests : []);
    machine.traderStock = stock.map(row => ({ ...row }));
    machine.traderCaps = caps;
    machine.traderMarket = market.market || null;
    machine.inventory = caps > 0 ? [{ id: 'silver', qty: caps }] : [];
    traderMarketState[key] = {
      restockDay: Number.isFinite(Number(market.worldHour)) ? Math.floor(Number(market.worldHour) / 24) : null,
      baseCaps: caps,
      caps,
      baseStock: stock.map(row => ({ ...row })),
      stock: stock.map(row => ({ ...row }))
    };
    return traderMarketState[key];
  }

  function requestTradeMachineMarket(machine, options = {}) {
    if (!machine || !machine.isTradeMachine) return Promise.resolve(null);
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket?.connected || !multiplayer.joined) {
      if (!options.silent) setReadout('Торговый автомат работает только через сервер мира.');
      return Promise.resolve(null);
    }
    const requestKey = String(machine.id || traderMarketKey(machine));
    if (tradeMachineMarketRequests.has(requestKey)) return Promise.resolve(null);
    tradeMachineMarketRequests.add(requestKey);
    return new Promise(resolve => {
      multiplayer.socket.emit('tradeMachineMarketState', {
        machineId: machine.id || '',
        locationId: currentLocation?.id || ''
      }, ack => {
        tradeMachineMarketRequests.delete(requestKey);
        if (!ack?.ok) {
          if (!options.silent) setReadout(ack?.error || 'Не удалось получить ассортимент автомата.');
          resolve(null);
          return;
        }
        const state = applyServerTradeMachineMarket(machine, ack);
        if (traderWindowOpen && activeTraderActor === machine) renderTraderWindow();
        resolve(state);
      });
    });
  }

  function handleTradeMachineMarketUpdated(data = {}) {
    const machine = Array.isArray(locationTradeMachines)
      ? locationTradeMachines.find(row => row && String(row.id || '') === String(data.machineId || data.market?.machineId || ''))
      : null;
    if (!machine || !data.market?.ok) return false;
    applyServerTradeMachineMarket(machine, data.market);
    if (traderWindowOpen && activeTraderActor === machine && !machine.tradePending) renderTraderWindow();
    return true;
  }

  function computeTraderRestockCaps(trader) {
    const inventoryCaps = npcInventoryCapsOrNull(trader);
    if (inventoryCaps !== null) return inventoryCaps;
    const hasLocationTraderProfile = isLocationTraderActor(trader);
    const explicit = Number(trader?.traderCaps ?? (hasLocationTraderProfile ? currentLocation?.trader?.caps : undefined));
    if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
    return 0;
  }

  function syncTraderMarketToActor(trader, state) {
    if (!trader || !state) return;
    const caps = Math.max(0, Math.floor(Number(state.caps || 0)));
    trader.traderCaps = caps;
    setNpcInventoryCaps(trader, caps);
    trader.traderRestockDay = Number(state.restockDay || 0);
    trader.traderStock = normalizeTraderStockRows(state.stock);
  }

  function applyServerTraderMarketUpdate(trader) {
    if (!trader || !trader.id) return null;
    const day = typeof currentGameDayIndex === 'function' ? currentGameDayIndex() : Math.floor(Date.now() / (60 * 60 * 1000));
    const key = traderMarketKey(trader);
    const existing = traderMarketState[key] || {};
    const stock = normalizeTraderStockRows(trader.traderStock || existing.stock || []);
    const caps = npcInventoryCapsOrNull(trader);
    const safeCaps = caps !== null
      ? caps
      : Math.max(0, Math.floor(Number(trader.traderCaps ?? existing.caps ?? computeTraderRestockCaps(trader))));
    const baseStock = normalizeTraderStockRows(existing.baseStock).length
      ? normalizeTraderStockRows(existing.baseStock)
      : stock.map(row => ({ ...row }));
    traderMarketState[key] = {
      restockDay: day,
      baseCaps: Number.isFinite(Number(existing.baseCaps)) ? Math.max(0, Math.floor(Number(existing.baseCaps))) : safeCaps,
      caps: safeCaps,
      baseStock,
      stock: stock.map(row => ({ ...row }))
    };
    syncTraderMarketToActor(trader, traderMarketState[key]);
    return traderMarketState[key];
  }

  function ensureTraderMarket(trader = activeTraderOrNearby(4.2), force = false) {
    if (!trader) return null;
    if (trader.isTradeMachine && trader.serverMarketAuthoritative) {
      const key = traderMarketKey(trader);
      const existing = traderMarketState[key];
      if (existing) {
        syncTraderMarketToActor(trader, existing);
        return existing;
      }
    }
    const day = typeof currentGameDayIndex === 'function' ? currentGameDayIndex() : Math.floor(Date.now() / (60 * 60 * 1000));
    const key = traderMarketKey(trader);
    const existing = traderMarketState[key] || null;
    const baseStock = normalizeTraderStockRows(existing?.baseStock).length
      ? normalizeTraderStockRows(existing.baseStock)
      : buildTraderRestockStock(trader);
    const baseCaps = Number.isFinite(Number(existing?.baseCaps))
      ? Math.max(0, Math.floor(Number(existing.baseCaps)))
      : computeTraderRestockCaps(trader);
    const needsRestock = force || !existing || Number(existing.restockDay) !== day;
    if (needsRestock) {
      traderMarketState[key] = {
        restockDay: day,
        baseCaps,
        caps: baseCaps,
        baseStock: baseStock.map(row => ({ ...row })),
        stock: baseStock.map(row => ({ ...row }))
      };
    } else {
      traderMarketState[key] = {
        ...existing,
        restockDay: Number(existing.restockDay),
        baseCaps,
        caps: Math.max(0, Math.floor(Number(existing.caps || 0))),
        baseStock: baseStock.map(row => ({ ...row })),
        stock: normalizeTraderStockRows(existing.stock).map(row => ({ ...row }))
      };
    }
    syncTraderMarketToActor(trader, traderMarketState[key]);
    return traderMarketState[key];
  }

  function traderWorldMarketText(trader = null) {
    const market = trader?.traderMarket;
    if (!market || typeof market !== 'object') return '';
    const label = String(market.stateLabel || market.state || '').trim();
    if (!label) return '';
    const priceDelta = Math.round((Number(market.priceMultiplier || 1) - 1) * 100);
    const qtyDelta = Math.round((Number(market.quantityMultiplier || 1) - 1) * 100);
    const parts = [`рынок: ${label}`];
    if (Math.abs(priceDelta) >= 2) parts.push(`цены ${priceDelta > 0 ? '+' : ''}${priceDelta}%`);
    if (Math.abs(qtyDelta) >= 2) parts.push(`товар ${qtyDelta > 0 ? '+' : ''}${qtyDelta}%`);
    return parts.join(' · ');
  }

  function traderMarketStateSnapshot() {
    return normalizeTraderMarketState(traderMarketState);
  }

  function normalizeTraderMarketState(raw = {}) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.entries(raw).forEach(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const safeKey = String(key || '').slice(0, 96);
      if (!safeKey) return;
      const baseStock = normalizeTraderStockRows(value.baseStock);
      const stock = normalizeTraderStockRows(value.stock);
      const savedBaseCaps = Number.isFinite(Number(value.baseCaps))
        ? Math.max(0, Math.floor(Number(value.baseCaps)))
        : (Number.isFinite(Number(value.caps)) ? Math.max(0, Math.floor(Number(value.caps))) : 0);
      out[safeKey] = {
        restockDay: Number.isFinite(Number(value.restockDay)) ? Math.floor(Number(value.restockDay)) : null,
        baseCaps: savedBaseCaps,
        caps: Number.isFinite(Number(value.caps)) ? Math.max(0, Math.floor(Number(value.caps))) : 0,
        baseStock,
        stock
      };
    });
    return out;
  }

  function activeTraderCaps(trader = activeTraderOrNearby(4.2)) {
    const state = ensureTraderMarket(trader);
    return state ? Math.max(0, Math.floor(Number(state.caps || 0))) : 0;
  }

  function setActiveTraderCaps(amount, trader = activeTraderOrNearby(4.2)) {
    const state = ensureTraderMarket(trader);
    if (!state) return 0;
    state.caps = Math.max(0, Math.floor(Number(amount || 0)));
    syncTraderMarketToActor(trader, state);
    return state.caps;
  }

  function adjustActiveTraderCaps(delta, trader = activeTraderOrNearby(4.2)) {
    const state = ensureTraderMarket(trader);
    if (!state) return 0;
    return setActiveTraderCaps(Math.max(0, Math.floor(Number(state.caps || 0) + Number(delta || 0))), trader);
  }

  function updateTraderMarketRestock(dt) {
    traderMarketRestockCheckTimer += dt;
    if (traderMarketRestockCheckTimer < 5) return;
    traderMarketRestockCheckTimer = 0;
    const trader = traderWindowOpen ? activeTraderOrNearby(4.2) : null;
    if (!trader) return;
    if (trader.isTradeMachine) {
      requestTradeMachineMarket(trader, { silent: true });
      return;
    }
    const before = traderMarketState[traderMarketKey(trader)]?.restockDay;
    const state = ensureTraderMarket(trader);
    if (state && before !== undefined && Number(before) !== Number(state.restockDay)) {
      saleQueue.clear();
      buyQueue.clear();
      renderTraderWindow();
      setReadout(`${trader.name || 'Торговец'} обновил ассортимент и запас крышек.`);
      queueSave();
    }
  }

