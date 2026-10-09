#!/usr/bin/env node
'use strict';

// Сетевая проверка скупщика Чёрного рынка в Ключах на реальном сервере
// с изолированным DATA_DIR: витрина, серверные цены и отказы, сохранение
// склада и казны, доступ нейтрального игрока, миграция старого Рынка Ядра.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const HUB_ID = 'settlement';
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const membership = factionId => ({ version: 1, factionId, joinedAt: Date.now() - 1000, changeAllowedAt: Date.now() + 72 * 3600000, history: [] });
  const placeInHub = (state, x, z) => {
    state.currentLocationId = HUB_ID;
    state.serverLocationContext = { locationId: HUB_ID };
    state.player = { ...(state.player || {}), x, z };
  };

  // Продавец стоит у прилавка: запасной заряженный лазерный пистолет в сумке,
  // аптечки и ноль марок.
  const seller = stateFor('trade');
  placeInHub(seller, -31, 28);
  seller.territoryFaction = membership('uprava');
  seller.inventory.silver = 0;
  seller.inventory.medkit = 2;

  // Старое сохранение в удалённом Рынке Ядра переносится к наружному входу.
  const climber = stateFor('harvest');
  climber.currentLocationId = 'coreMarket';
  climber.serverLocationContext = { locationId: 'coreMarket' };
  climber.territoryFaction = membership('contour');
  climber.inventory.medkit = 7;
  climber.player.xp = 511;
  climber.quests = { coreExpedition: { stage: 'labApproach', completed: false } };

  // Нейтральный игрок имеет доступ к скупщику в мирных Ключах.
  const stranger = stateFor('untargeted');
  placeInHub(stranger, -31, 28);
  stranger.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };

  delete saves.blackMarket;
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    // --- вход и витрина ------------------------------------------------------------------
    await h.connectAndJoin(accounts.trade);
    const join = accounts.trade.join;
    assert.equal(join.locationId, HUB_ID, 'A faction member reconnects into Keys.');
    const broker = (join.worldState?.enemies || []).find(row => row.hostileToPlayer === false && row.service === 'blackMarket');
    assert(broker?.id, 'The broker stands in the hub: ' + JSON.stringify((join.worldState?.enemies || []).map(row => [row.id, row.service])));

    const view = await h.socketAck(accounts.trade.socket, 'syncNpcTradeState', { enemyId: broker.id });
    assert(view.ok, 'The broker opens a trade window: ' + JSON.stringify(view));
    assert.deepEqual(view.market.stock, [], 'The broker has no shelf.');
    assert(view.market.blackMarket && view.market.caps === view.market.blackMarket.treasury, 'The window shows the market treasury.');
    const pistolPrice = Number(view.market.sellPrices?.laserPistol || 0);
    assert(pistolPrice > 0, 'The server names a price for a whole weapon: ' + JSON.stringify(view.market.sellPrices));
    assert.equal(view.market.sellPrices.medkit, undefined, 'The broker names no price for medicine.');
    assert.equal(view.market.sellPricesByItem?.ui_laserPistol_trade_2, pistolPrice, 'Each weapon instance has its own price.');
    const treasuryBefore = Number(view.market.caps);
    console.log('PASS hub entry and broker window');

    // --- отказы --------------------------------------------------------------------------
    // Пауза на несколько тиков ИИ: нейтральный персонал рынка не должен брать
    // члена фракции в цель (иначе сервер закрывает торговлю как «бой»).
    await new Promise(resolve => setTimeout(resolve, 1500));
    const buy = await h.socketAck(accounts.trade.socket, 'npcTradeExchange', {
      enemyId: broker.id, buys: [{ id: 'laserPistol', qty: 1 }], sells: []
    });
    assert(!buy.ok && /ничего не продаёт/.test(buy.error), 'The broker sells nothing: ' + JSON.stringify(buy.error));
    const medicine = await h.socketAck(accounts.trade.socket, 'npcTradeExchange', {
      enemyId: broker.id, buys: [], sells: [{ id: 'medkit', qty: 1 }]
    });
    assert(!medicine.ok && /оружие и броню/.test(medicine.error), 'The broker refuses medicine: ' + JSON.stringify(medicine.error));
    assert.equal(qty(medicine.self, 'medkit'), 2, 'A refused sale keeps the medkits.');
    console.log('PASS broker refusals');

    // --- продажа -------------------------------------------------------------------------
    // Оружие и броню у игроков покупает только скупщик: заряженный запасной пистолет
    // продаётся ему, а пять зарядов возвращаются в сумку.
    const cellsBefore = qty(medicine.self, 'energyCell');
    const sale = await h.socketAck(accounts.trade.socket, 'npcTradeExchange', {
      enemyId: broker.id,
      buys: [],
      sells: [{ id: 'laserPistol', itemRuntimeId: 'ui_laserPistol_trade_2', qty: 1 }]
    });
    assert(sale.ok, 'The broker buys a whole weapon: ' + JSON.stringify(sale.error || sale).slice(0, 400));
    assert.equal(qty(sale.self, 'silver'), pistolPrice, 'The seller receives the quoted price.');
    assert.deepEqual(sale.unloadedAmmo, [{ id: 'energyCell', qty: 5 }], 'The sold pistol is unloaded first.');
    assert.equal(qty(sale.self, 'energyCell'), cellsBefore + 5, 'The unloaded cells return to the bag.');
    assert(!(sale.self?.weaponInventoryRuntime || []).some(row => row?.id === 'ui_laserPistol_trade_2'),
      'The sold weapon leaves the bag.');
    assert.equal(sale.self?.equipmentRuntime?.weapon, 'ui_laserPistol_trade_1', 'Selling a bag weapon keeps the equipped one.');
    const after = await h.socketAck(accounts.trade.socket, 'syncNpcTradeState', { enemyId: broker.id });
    assert.equal(Number(after.market.caps), treasuryBefore - pistolPrice, 'The price leaves the treasury.');
    console.log('PASS black market sale (' + pistolPrice + ' marks)');

    // --- доступ и миграция ---------------------------------------------------------------
    await h.connectAndJoin(accounts.untargeted);
    assert.equal(accounts.untargeted.join.locationId, HUB_ID, 'A neutral visitor can reach the Keys broker.');
    const neutralBroker = (accounts.untargeted.join.worldState?.enemies || []).find(row => row.service === 'blackMarket');
    assert(neutralBroker?.id, 'The broker is shared with neutral visitors.');
    const neutralView = await h.socketAck(accounts.untargeted.socket, 'syncNpcTradeState', { enemyId: neutralBroker.id });
    assert.equal(neutralView.ok, true, 'The neutral visitor can open the broker window.');

    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.locationId, 'z_09_07', 'A saved character in coreMarket migrates to the exterior portal.');
    assert.equal(qty(accounts.harvest.join.self, 'medkit'), 7, 'Legacy Core inventory survives the real join migration.');
    assert.equal(accounts.harvest.join.self.xp, 511, 'Legacy Core experience survives the real join migration.');
    assert.equal(accounts.harvest.join.self.territoryFaction.factionId, 'contour', 'Legacy faction membership survives migration.');
    const migratedSave = JSON.parse(fs.readFileSync(savesPath));
    const migratedState = migratedSave.characters[users.users[accounts.harvest.login].id][accounts.harvest.characterId].state;
    assert.deepEqual(migratedState.quests, climber.quests, 'Legacy quest progress remains in the saved character.');
    const closed = await h.socketAck(accounts.harvest.socket, 'changeLocation', { locationId: 'coreMarket' });
    assert.equal(closed.ok, false, 'The retired market is not reachable again.');
    console.log('PASS neutral broker access and legacy market migration');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  // --- склад и казна переживают перезапуск ------------------------------------------------
  const persisted = JSON.parse(fs.readFileSync(savesPath)).blackMarket;
  assert(persisted?.stock?.laserPistol?.length === 1, 'The sold weapon is stored: ' + JSON.stringify(persisted?.stock));
  assert(persisted.treasury > 0, 'The treasury is stored.');
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    const broker = (accounts.trade.join.worldState?.enemies || []).find(row => row.service === 'blackMarket');
    const view = await h.socketAck(accounts.trade.socket, 'syncNpcTradeState', { enemyId: broker.id });
    assert.equal(Number(view.market.caps), persisted.treasury, 'The treasury survives a restart.');
    assert.equal(view.market.blackMarket.stockCount, 1,
      'The stock survives a restart: ' + JSON.stringify(view.market.blackMarket).slice(0, 300));
    console.log('PASS black market persistence');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Black market network OK: Keys broker buys whole weapons, refuses other goods, serves neutral players, preserves stock and treasury, and migrates the old hub.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
