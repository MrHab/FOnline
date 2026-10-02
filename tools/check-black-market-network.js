#!/usr/bin/env node
'use strict';

// Сетевая проверка Чёрного рынка на реальном сервере с изолированным DATA_DIR:
// аукционер показывает заявки на выкуп, проводит немедленную продажу и
// исполняет отложенные заявки игроков. Склад, казна и ордера переживают
// перезапуск; вход на рынок и переход в центральную сцену также проверяются.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const HUB_ID = 'coreMarket';
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
  placeInHub(seller, 0, 5);
  seller.territoryFaction = membership('uprava');
  seller.inventory.silver = 0;
  seller.inventory.medkit = 2;
  seller.inventory.leather = 2;
  seller.inventory.ui_laserPistol_trade_3 = 1;
  seller.itemRuntime.ui_laserPistol_trade_3 = {
    baseId: 'laserPistol', condition: 80, loaded: 4, createdAt: Date.now()
  };

  // Второй член фракции — у лестницы наверх.
  const climber = stateFor('harvest');
  placeInHub(climber, 0, -32);
  climber.territoryFaction = membership('contour');

  // Наёмник без контракта, чьё сохранение указывает на рынок.
  const stranger = stateFor('untargeted');
  placeInHub(stranger, 0, 5);
  stranger.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };

  saves.blackMarket = {
    version: 2,
    treasury: 3000,
    orders: { laserPistol: { qty: 2, multiplier: 1 }, leather: { qty: 1, multiplier: 1 } },
    stock: {}
  };
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    // --- аукцион Чёрного рынка ----------------------------------------------------------
    await h.connectAndJoin(accounts.trade);
    const join = accounts.trade.join;
    assert.equal(join.locationId, HUB_ID, 'A faction member reconnects into the market hub.');
    const auctioneer = (join.worldState?.enemies || []).find(row => row.hostileToPlayer === false && row.service === 'auction');
    assert(auctioneer?.id, 'The hub has an auctioneer.');
    assert(!(join.worldState?.enemies || []).some(row => row.service === 'blackMarket'), 'The broker NPC is gone.');
    const view = await h.socketAck(accounts.trade.socket, 'auctionAction', { action: 'state' });
    assert(view.ok && view.auction?.blackMarket === true, 'The auction shows Black Market demand.');
    const pistolBid = view.auction.orders.find(row => row.id === 'bm_laserPistol');
    const leatherBid = view.auction.orders.find(row => row.id === 'bm_leather');
    assert(pistolBid?.price > 0 && leatherBid?.price > 0, 'Item-specific NPC bids are listed.');
    assert.equal(view.auction.orders.filter(row => row.side === 'buy').length, 2);
    const oldTrade = await h.socketAck(accounts.trade.socket, 'syncNpcTradeState', { enemyId: auctioneer.id });
    assert(!oldTrade.ok, 'The auctioneer has no NPC barter window.');
    const buy = await h.socketAck(accounts.trade.socket, 'auctionAction', { action: 'buy', itemId: 'leather', qty: 1, price: 1 });
    assert(!buy.ok, 'The Black Market does not sell to players.');
    const medicine = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sell', itemId: 'medkit', qty: 1, price: 1, durationHours: 24
    });
    assert(!medicine.ok && qty(medicine.self, 'medkit') === 2, 'The Black Market refuses other categories.');
    console.log('PASS Black Market auction and broker removal');

    // An ask lower than the NPC bid is bought immediately. The listing fee is
    // charged, the sale proceeds wait on the auction shelf and the gear enters loot.
    const askPrice = Math.max(1, leatherBid.price - 1);
    const listing = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sell', itemId: 'leather', qty: 1, price: askPrice, durationHours: 24
    });
    assert(listing.ok, 'The seller places an ask: ' + JSON.stringify(listing.error || listing).slice(0, 400));
    assert.equal(listing.soldQty, 1, 'The NPC fills an affordable ask immediately.');
    assert.equal(listing.restingQty, 0);
    assert.equal(qty(listing.self, 'leather'), 1, 'Only the listed item leaves the bag.');
    assert(listing.auction.shelf.silver > 0, 'Proceeds are on the auction shelf.');
    assert(!listing.auction.orders.some(row => row.id === 'bm_leather'), 'The filled bid disappears.');
    console.log('PASS player ask matched to NPC demand');

    // Selling directly into a visible buy order uses the same auction event.
    const cellsBefore = qty(listing.self, 'energyCell');
    const stale = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sellNow', orderId: pistolBid.id, qty: 1,
      expectedPrice: pistolBid.price + 1, itemRuntimeId: 'ui_laserPistol_trade_2'
    });
    assert(!stale.ok, 'An outdated quote cannot fill an NPC bid.');
    const sale = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sellNow', orderId: pistolBid.id, qty: 1, expectedPrice: pistolBid.price,
      itemRuntimeId: 'ui_laserPistol_trade_2', requestId: 'bm_pistol_sale_1'
    });
    assert(sale.ok, 'The auction buys a whole weapon: ' + JSON.stringify(sale.error || sale).slice(0, 400));
    assert.equal(qty(sale.self, 'silver'), sale.proceeds, 'The seller receives the after-tax payout.');
    assert.equal(qty(sale.self, 'energyCell'), cellsBefore + 5, 'The loaded cells return to the bag.');
    assert(!(sale.self?.weaponInventoryRuntime || []).some(row => row?.id === 'ui_laserPistol_trade_2'),
      'The sold weapon leaves the bag.');
    assert.equal(sale.self?.equipmentRuntime?.weapon, 'ui_laserPistol_trade_1', 'The equipped weapon stays.');
    assert.equal(sale.auction.orders.find(row => row.id === 'bm_laserPistol')?.qty, 1);
    const replay = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sellNow', orderId: pistolBid.id, qty: 1, expectedPrice: pistolBid.price,
      itemRuntimeId: 'ui_laserPistol_trade_2', requestId: 'bm_pistol_sale_1'
    });
    assert(replay.ok && replay.reused === true
      && replay.auction.orders.find(row => row.id === 'bm_laserPistol')?.qty === 1,
    'A retried sale cannot buy twice.');
    console.log('PASS instant auction sale');

    const wornAsk = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sell', itemId: 'laserPistol', itemRuntimeId: 'ui_laserPistol_trade_3',
      qty: 1, price: 1, durationHours: 24
    });
    assert(!wornAsk.ok && /отремонтируйте/.test(wornAsk.error),
      'A worn weapon cannot be placed as a Black Market ask.');
    assert.equal(qty(wornAsk.self, 'laserPistol'), 1, 'The rejected weapon stays in the bag.');
    const wornInstantSale = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sellNow', orderId: pistolBid.id, qty: 1, expectedPrice: pistolBid.price,
      itemRuntimeId: 'ui_laserPistol_trade_3'
    });
    assert(wornInstantSale.ok, 'The existing instant-sale rule still accepts a worn weapon.');
    assert(!wornInstantSale.auction.orders.some(row => row.id === 'bm_laserPistol'));
    assert.equal(qty(wornInstantSale.self, 'energyCell'), cellsBefore + 9,
      'Loaded ammunition from the second weapon returns to the bag.');

    const waiting = await h.socketAck(accounts.trade.socket, 'auctionAction', {
      action: 'sell', itemId: 'leather', qty: 1, price: 100, durationHours: 24
    });
    assert(waiting.ok && waiting.restingQty === 1, 'An ask without demand waits in the book.');
    assert.equal(qty(waiting.self, 'leather'), 0, 'The waiting ask holds the item in escrow.');
    assert(waiting.auction.orders.some(row => row.id === waiting.orderId && row.mine), 'The player sees their ask.');
    assert(waiting.auction.orders.find(row => row.id === waiting.orderId)?.itemDetails?.armor?.protection,
      'The listed armor exposes its actual protection values.');

    // --- доступ и подъём -----------------------------------------------------------------
    await h.connectAndJoin(accounts.untargeted);
    assert.notEqual(accounts.untargeted.join.locationId, HUB_ID, 'A mercenary without a contract is not let into the hub.');

    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.locationId, HUB_ID);
    const up = await h.socketAck(accounts.harvest.socket, 'changeLocation', { locationId: 'coreZone' });
    assert(up.ok, 'The stairs lead up into the core: ' + JSON.stringify(up.error || up).slice(0, 300));
    const zone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations', 'coreZone.json')));
    const landing = zone.entryFromMarket;
    assert(Math.hypot(Number(up.x) - landing.x, Number(up.z) - landing.z) < 1.5,
      'The climber lands by the market stairs: ' + JSON.stringify({ x: up.x, z: up.z, landing }));
    const back = await h.socketAck(accounts.harvest.socket, 'changeLocation', { locationId: HUB_ID });
    assert(back.ok && back.locationId === HUB_ID, 'The stairs lead back down: ' + JSON.stringify(back.error || back).slice(0, 300));
    console.log('PASS hub access and stairs');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  // --- stock, book and treasury survive a restart --------------------------------------
  const persisted = JSON.parse(fs.readFileSync(savesPath));
  assert(persisted.blackMarket?.stock?.laserPistol?.length === 2, 'Both sold weapons enter NPC loot stock.');
  assert.deepEqual(persisted.blackMarket.stock.laserPistol.map(row => row.c), [100, 80],
    'The auction preserves the condition of each bought weapon.');
  assert(persisted.blackMarket?.stock?.leather?.length === 1, 'The listed armor enters NPC loot stock.');
  assert(persisted.blackMarket.treasury > 0, 'The treasury is stored.');
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    const view = await h.socketAck(accounts.trade.socket, 'auctionAction', { action: 'state' });
    assert(view.ok && view.auction?.blackMarket === true);
    assert(view.auction.shelf.silver > 0, 'Auction proceeds survive a restart.');
    assert(!view.auction.orders.some(row => row.id === 'bm_leather' || row.id === 'bm_laserPistol'));
    assert(view.auction.orders.some(row => row.mine && row.itemId === 'leather'), 'The waiting ask survives a restart.');
    const own = view.auction.orders.find(row => row.mine && row.itemId === 'leather');
    const cancel = await h.socketAck(accounts.trade.socket, 'auctionAction', { action: 'cancel', orderId: own.id });
    assert(cancel.ok && cancel.auction.shelf.items.some(row => row.itemId === 'leather'),
      'Cancelling puts the escrowed item on the shelf.');
    const claim = await h.socketAck(accounts.trade.socket, 'auctionAction', { action: 'claim' });
    assert(claim.ok && qty(claim.self, 'leather') === 1, 'The item can be claimed after cancellation.');
    console.log('PASS Black Market auction persistence');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Black market network OK: the auction exposes NPC bids, fills player asks and instant sales, and persists stock and proceeds.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
