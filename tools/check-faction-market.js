#!/usr/bin/env node
'use strict';

// Рынок фракции под управляемым временем: книга ордеров на продажу и на выкуп,
// встречное исполнение по цене стоявшего ордера, частичные сделки, сбор за
// размещение и налог с продажи, мгновенные «купить/продать сейчас», отмена и
// срок ордера с возвратом товара и замороженных марок, переезд лотов прежнего
// аукциона, публичная проекция без чужих идентификаторов, серверные крючки и
// отдельный экран рынка в Unity.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const market = require('../src/server/faction-market');

const rules = market.normalizeMarketRules({});
assert.deepEqual(rules, {
  durationChoicesMs: [21600000, 86400000, 259200000, 604800000],
  listingLifetimeMs: 86400000,
  maxOrdersPerTrader: 12,
  maxOrdersPerFaction: 300,
  taxPct: 0.05,
  setupFeePct: 0.015,
  minPrice: 1,
  maxPrice: 200000,
  maxQtyPerOrder: 500
});
// Прежнее имя сбора в авторских данных продолжает задавать налог на продажу.
assert.equal(market.normalizeMarketRules({ feePct: 0.12 }).taxPct, 0.12);
assert(rules.durationChoicesMs.includes(rules.listingLifetimeMs), 'The default term is one the trader can actually pick.');

const F = 'uprava';
const day = 86400000;
const t0 = 1700000000000;
const seller = { factionId: F, ownerCharacterId: 'char-seller', ownerName: 'Продавец' };
const buyer = { factionId: F, ownerCharacterId: 'char-buyer', ownerName: 'Покупатель' };

// --- проверки ордера ---------------------------------------------------------------
let store = market.normalizeMarketStore({});
assert.equal(market.placeSellOrder(store, { ...seller, itemId: 'ammo9', qty: 0, price: 10, durationMs: day }, rules, t0).error, 'Выберите предмет и количество.');
assert(market.placeSellOrder(store, { ...seller, itemId: 'ammo9', qty: 10, price: 0, durationMs: day }, rules, t0).error.includes('Цена за штуку'));
assert(market.placeSellOrder(store, { ...seller, itemId: 'ammo9', qty: 9999, price: 10, durationMs: day }, rules, t0).error.includes('Не больше'));
assert.equal(market.placeSellOrder(store, { ...seller, itemId: 'ammo9', qty: 1, price: 10, durationMs: 1234 }, rules, t0).error, 'Такого срока ордера нет.');
assert.equal(market.placeSellOrder(store, { factionId: '', ownerCharacterId: 'x', itemId: 'ammo9', qty: 1, price: 1, durationMs: day }, rules, t0).error, 'Рынок открыт только членам фракции.');

// --- ордер на продажу встаёт в книгу -----------------------------------------------
const rest = market.placeSellOrder(store, { ...seller, itemId: 'ammo9', category: 'ammo', qty: 20, price: 10, durationMs: day }, rules, t0);
assert(rest.ok && rest.order && rest.order.id === 'lot_uprava_1');
assert.equal(rest.restingQty, 20);
assert.equal(rest.soldQty, 0);
assert.equal(rest.setupFee, 3, 'The setup fee is 1.5% of the whole order.');
assert.equal(rest.order.category, 'ammo', 'The order keeps the category the server derived from its item catalog.');
assert.equal(market.bestPrice(store, F, 'ammo9', 'sell', t0 + 1), 10);

// --- встречный ордер на выкуп исполняется по цене книги -----------------------------
const cross = market.placeBuyOrder(store, { ...buyer, itemId: 'ammo9', category: 'ammo', qty: 30, price: 12, durationMs: day }, rules, t0 + 10);
assert(cross.ok);
assert.equal(cross.boughtQty, 20, 'The buy order takes every unit the book offers below its price.');
assert.equal(cross.spent, 200, 'A crossing order pays the resting price, not its own.');
assert.equal(cross.restingQty, 10);
assert.equal(cross.escrow, 120, 'The rest of the buy order freezes marks at its own price.');
assert.equal(cross.setupFee, 5);
assert.deepEqual(cross.bought.map(row => [row.itemId, row.qty, row.price]), [['ammo9', 20, 10]]);
let sellerShelf = market.shelfFor(store, F, 'char-seller');
assert.equal(sellerShelf.silver, 190, 'The seller receives the sale minus the five percent tax.');
assert.equal(sellerShelf.sales, 1);

// --- продажа в стоящий ордер на выкуп ------------------------------------------------
const hit = market.placeSellOrder(store, {
  factionId: F, ownerCharacterId: 'char-third', ownerName: 'Третий', itemId: 'ammo9', category: 'ammo', qty: 4, price: 11, durationMs: day
}, rules, t0 + 20);
assert(hit.ok && hit.soldQty === 4 && hit.restingQty === 0, 'A sell order under the best bid is filled on the spot.');
assert.equal(hit.proceeds, 46, 'The seller is paid the resting buy price minus the tax.');
assert.equal(hit.tax, 2);
assert.deepEqual(market.shelfFor(store, F, 'char-buyer').items.map(row => [row.itemId, row.qty, row.reason]), [['ammo9', 4, 'bought']],
  'The buyer collects the goods from the shelf at the auctioneer.');

// --- свой ордер не исполняется своим же ----------------------------------------------
const selfCross = market.placeSellOrder(store, { ...buyer, itemId: 'ammo9', category: 'ammo', qty: 2, price: 1, durationMs: day }, rules, t0 + 30);
assert(selfCross.ok && selfCross.soldQty === 0 && selfCross.restingQty === 2, 'Nobody trades with their own order.');
assert(market.cancelOrder(store, F, selfCross.order.id, 'char-buyer', t0 + 31).ok);

// --- мгновенные сделки ----------------------------------------------------------------
store = market.normalizeMarketStore({});
const shelfOrder = market.placeSellOrder(store, { ...seller, itemId: 'medkit', category: 'aid', qty: 5, price: 100, durationMs: day }, rules, t0).order;
assert.equal(market.takeSellOrder(store, F, shelfOrder.id, 'char-seller', 1, rules, t0 + 1).error, 'Свой ордер можно только отменить.');
const partial = market.takeSellOrder(store, F, shelfOrder.id, 'char-buyer', 2, rules, t0 + 2);
assert(partial.ok && partial.qty === 2 && partial.cost === 200 && partial.tax === 10 && partial.payout === 190);
assert.equal(shelfOrder.qty, 3, 'A partial buy leaves the rest of the order in the book.');
assert.equal(shelfOrder.filled, 2);
assert.equal(market.shelfFor(store, F, 'char-seller').silver, 190);

const wanted = market.placeBuyOrder(store, { ...buyer, itemId: 'ore', category: 'materials', qty: 10, price: 30, durationMs: day }, rules, t0 + 3);
assert(wanted.ok && wanted.escrow === 300 && wanted.boughtQty === 0);
const sold = market.takeBuyOrder(store, F, wanted.order.id, 'char-seller', 4, [], rules, t0 + 4);
assert(sold.ok && sold.qty === 4 && sold.value === 120 && sold.tax === 6 && sold.proceeds === 114);
assert.equal(wanted.order.qty, 6, 'A partial sale leaves the rest of the buy order in the book.');
assert.equal(wanted.order.escrow, 180, 'The escrow shrinks exactly by what the sale paid out.');

// --- отмена и срок --------------------------------------------------------------------
assert.equal(market.cancelOrder(store, F, wanted.order.id, 'char-seller', t0 + 5).error, 'Это не ваш ордер.');
assert(market.cancelOrder(store, F, wanted.order.id, 'char-buyer', t0 + 5).ok);
assert.equal(market.shelfFor(store, F, 'char-buyer').silver, 180, 'Cancelling a buy order unfreezes the marks onto the shelf.');
assert.equal(market.expireOrders(store, rules, t0 + day - 1).length, 0, 'Nothing expires early.');
const expired = market.expireOrders(store, rules, t0 + day + 1);
assert.equal(expired.length, 1);
assert.deepEqual(market.shelfFor(store, F, 'char-seller').items.map(row => [row.itemId, row.qty, row.reason]), [['medkit', 3, 'expired']],
  'An expired sell order returns what was left of the goods.');

// --- экземпляры ------------------------------------------------------------------------
store = market.normalizeMarketStore({});
const artifactRecord = { id: 'rec-1', itemRuntimeId: 'rec-1', baseId: 'artifactSpring', artifact: { id: 'rec-1', typeId: 'spring', seed: 'secret', tier: 3 } };
assert.equal(market.placeSellOrder(store, { ...seller, itemId: 'artifactSpring', qty: 2, price: 300, durationMs: day, records: [artifactRecord] }, rules, t0).error,
  'Предмет с собственным состоянием выставляется по одному.');
const instance = market.placeSellOrder(store, {
  ...seller, itemId: 'artifactSpring', category: 'artifacts', qty: 1, price: 300, durationMs: day, records: [artifactRecord]
}, rules, t0);
assert(instance.ok);
const instanceBought = market.takeSellOrder(store, F, instance.order.id, 'char-buyer', 1, rules, t0 + 1);
assert.deepEqual(instanceBought.records[0].artifact, artifactRecord.artifact, 'The artifact instance travels with the order.');

// --- переезд лотов прежнего аукциона ----------------------------------------------------
const migrated = market.normalizeMarketStore({
  factions: {
    uprava: {
      counter: 9,
      listings: {
        lot_uprava_9: {
          id: 'lot_uprava_9', factionId: F, itemId: 'medkit', qty: 2, startPrice: 100, buyoutPrice: 250,
          bidAmount: 140, bidderCharacterId: 'char-bidder', sellerCharacterId: 'char-seller', sellerName: 'П',
          createdAt: t0, expiresAt: t0 + day
        }
      },
      shelves: {}
    }
  }
});
const moved = migrated.factions.uprava.orders.lot_uprava_9;
assert(moved && moved.side === 'sell' && moved.price === 250, 'A former lot becomes a sell order at its buyout price.');
assert.equal(market.shelfFor(migrated, F, 'char-bidder').silver, 140, 'The losing bid of the old auction comes back to its owner.');

// --- публичная проекция ------------------------------------------------------------------
const view = market.publicMarket(store, F, 'char-buyer', rules, t0 + 2, {
  projectArtifact: record => require('../src/server/artifact-instances').publicArtifactRecord(record, JSON.parse(read('data/artifacts.json')))
});
assert.equal(view.taxPct, rules.taxPct);
assert.equal(view.setupFeePct, rules.setupFeePct);
assert.deepEqual(view.durationChoicesHours, [6, 24, 72, 168], 'The order form gets its terms from the server.');
assert.equal(view.limits.maxQtyPerOrder, rules.maxQtyPerOrder);
assert(view.categories.every(row => row.id && row.label), 'Every category comes with its Russian label.');
for (const order of view.orders) {
  assert(!('ownerCharacterId' in order) && !('records' in order) && !('escrow' in order),
    'Owner ids, escrow and instance records stay on the server.');
}
assert(!JSON.stringify(view).includes('secret'), 'Hidden artifact rolls never leave the server through the market.');

const bookStore = market.normalizeMarketStore({});
market.placeSellOrder(bookStore, { ...seller, itemId: 'ammo9', category: 'ammo', qty: 8, price: 12, durationMs: day }, rules, t0);
market.placeSellOrder(bookStore, { factionId: F, ownerCharacterId: 'char-third', ownerName: 'Третий', itemId: 'ammo9', category: 'ammo', qty: 4, price: 9, durationMs: day }, rules, t0 + 1);
market.placeBuyOrder(bookStore, { ...buyer, itemId: 'ammo9', category: 'ammo', qty: 6, price: 7, durationMs: day }, rules, t0 + 2);
const summary = market.publicMarket(bookStore, F, 'char-buyer', rules, t0 + 3).items;
assert.deepEqual(summary, [{ itemId: 'ammo9', category: 'ammo', sellQty: 12, sellPrice: 9, buyQty: 6, buyPrice: 7, mine: true }],
  'The item summary carries both sides of the book: ' + JSON.stringify(summary));
assert.deepEqual(market.bookSide(bookStore, F, 'ammo9', 'sell', t0 + 3).map(row => row.price), [9, 12],
  'The sell side is ordered from the cheapest.');

// --- серверные крючки и Unity --------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'savesDb.factionAuctions = normalizeMarketStore(savesDb.factionAuctions)',
  "socket.on('auctionAction'",
  "if (!serverNearbyServiceActor(p, 'auction')) return fail('Аукционер должен быть рядом.');",
  "if (!['sell', 'buy', 'buyNow', 'sellNow', 'cancel', 'claim'].includes(action)) return fail('Неизвестное действие аукциона.');",
  "['action', 'itemId', 'qty', 'price', 'durationHours', 'orderId', 'itemRuntimeId']",
  'function serverMarketItemIsFungible(itemId = \'\')',
  'serverCaptureWeaponRuntimeRecords(p, row, validation)',
  'category: KROMKA_ITEM_INDEXES.categories[itemId]',
  "serverInventoryRemove(p, 'silver', placed.spent + placed.escrow + placed.setupFee);",
  'marketExpireOrders(serverAuctionStore(), KROMKA_AUCTION_RULES, now)',
  'function serverClaimAuctionShelf(p, factionId, data = {}, now = Date.now())',
  'serverTickAuctions(Date.now())'
]) assert(server.includes(needle), `server.js is missing the market contract: ${needle}`);
assert(!fs.existsSync(path.join(root, 'src/server/faction-auction.js')),
  'The auction module was replaced by the order book; two markets must not coexist.');

const unityNet = read('unity-client/Assets/Scripts/Game/RoaAuctionNet.cs');
for (const token of ['"state"', '"sell"', '"buy"', '"buyNow"', '"sellNow"', '"cancel"', '"claim"', 'EmitWithAck("auctionAction"']) {
  assert(unityNet.includes(token), `RoaAuctionNet is missing ${token}`);
}
// Отдельный экран рынка: открывается взаимодействием, без вариантов диалога.
const unityCanvas = read('unity-client/Assets/Scripts/Game/RoaAuctionCanvas.cs');
for (const token of ['ПОКУПКА', 'ПРОДАЖА', 'МОИ ОРДЕРА', 'ОРДЕР НА ВЫКУП', 'ОРДЕР НА ПРОДАЖУ',
  'durationChoicesHours', 'setupFeePct', 'taxPct', 'categories']) {
  assert(unityCanvas.includes(token), `RoaAuctionCanvas is missing ${token}`);
}
const unityDialogue = read('unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs');
assert(!unityDialogue.includes('AddAuctionOptions'), 'The auctioneer opens its own screen, so the dialogue keeps no auction options.');

console.log('Faction market OK: order book with buy and sell orders, crossing at the resting price, partial fills, setup fee and sales tax, instant buy/sell, cancel and expiry returns, legacy lot migration, private projection, server hooks and the standalone market screen.');
