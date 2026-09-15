#!/usr/bin/env node
'use strict';

// Сетевая проверка рынка на реальном сервере (изолированный DATA_DIR): книга
// ордеров у аукционера открывается только рядом с ним, ордер на продажу уходит
// в категорию на выбранный срок за сбор, ордер на выкуп замораживает марки и
// исполняется встречными по цене книги, мгновенные «купить/продать сейчас»
// доводят товар и выручку до рюкзака, отмена и забор полки возвращают
// остальное, а повтор requestId не списывает марки дважды.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const qty = (self, id) => (self.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const AUCTIONEER = { x: -2, z: 4 };

// Сервер не телепортирует: позиция подтягивается обычными пакетами движения,
// каждый из которых сервер обрезает по скорости игрока. Шаги идут до тех пор,
// пока экран аукциона не примет (или не отвергнет) запрос.
const walkSeq = new Map();
async function walkTo(account, x, z, wantOpen) {
  for (let step = 0; step < 30; step += 1) {
    const seq = (walkSeq.get(account.login) || 0) + 1;
    walkSeq.set(account.login, seq);
    await h.socketAck(account.socket, 'state', { x, z, angle: 0, moving: true, seq });
    const probe = await h.socketAck(account.socket, 'auctionAction', { action: 'state' });
    if (probe.ok === wantOpen) {
      const stop = seq + 1;
      walkSeq.set(account.login, stop);
      await h.socketAck(account.socket, 'state', { x, z, angle: 0, moving: false, seq: stop });
      return probe;
    }
    await delay(760);
  }
  throw new Error(`the trader never reached ${x};${z} with the auction ${wantOpen ? 'open' : 'shut'}`);
}

const walkToAuctioneer = async account => (await walkTo(account, AUCTIONEER.x, AUCTIONEER.z, true)).auction;

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const membership = factionId => ({ version: 1, factionId, joinedAt: Date.now() - 1000, changeAllowedAt: Date.now() + 72 * 3600000, history: [] });

  for (const [role, silver, goods] of [
    ['trade', 300, { ammo9: 40, medkit: 2 }],
    ['target', 2000, {}],
    ['untargeted', 2000, {}]
  ]) {
    const state = stateFor(role);
    state.currentLocationId = 'coreBaseUprava';
    state.serverLocationContext = { locationId: 'coreBaseUprava' };
    state.territoryFaction = membership('uprava');
    state.inventory.silver = silver;
    Object.assign(state.inventory, goods);
  }
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  for (const role of ['trade', 'target', 'untargeted']) await h.connectAndJoin(accounts[role]);

  const send = async (role, data, ok = true) => {
    const response = await h.socketAck(accounts[role].socket, 'auctionAction', data);
    assert.equal(response.ok, ok, `${data.action} (${role}): ${JSON.stringify(response).slice(0, 400)}`);
    return response;
  };

  // --- аукционер открывает книгу только рядом с собой ---------------------
  const far = await walkTo(accounts.trade, 16, -18, false);
  assert.equal(far.ok, false, 'The market stays shut away from the auctioneer.');
  assert.match(far.error, /Аукционер/, far.error);

  const opened = await walkToAuctioneer(accounts.trade);
  assert.equal(opened.taxPct, 0.05, 'The screen states the sales tax up front.');
  assert.equal(opened.setupFeePct, 0.015, 'The screen states the setup fee up front.');
  assert.deepEqual(opened.durationChoicesHours, [6, 24, 72, 168], 'The trader picks the order term from the server list.');
  assert(opened.categories.length >= 9 && opened.categories.every(row => row.id && row.label),
    'Every product category arrives with its label.');
  assert.equal(opened.limits.maxQtyPerOrder, 500);
  for (const role of ['target', 'untargeted']) await walkToAuctioneer(accounts[role]);

  // --- ордер на продажу ---------------------------------------------------
  await send('trade', { action: 'sell', itemId: 'ammo9', qty: 20, price: 10, durationHours: 5, requestId: 'sell-term' }, false);
  await send('trade', { action: 'sell', itemId: 'ammo9', qty: 999, price: 10, durationHours: 24, requestId: 'sell-many' }, false);
  const listed = await send('trade', { action: 'sell', itemId: 'ammo9', qty: 20, price: 10, durationHours: 24, requestId: 'sell-1' });
  assert.equal(listed.restingQty, 20, 'With no counter-orders the whole order rests in the book.');
  assert.equal(listed.soldQty, 0);
  assert.equal(listed.setupFee, 3, 'The setup fee is 1.5% of the order.');
  assert.equal(qty(listed.self, 'ammo9'), 20, 'The listed stack leaves the backpack at once.');
  assert.equal(qty(listed.self, 'silver'), 297, 'The setup fee is paid on the spot.');
  const sellOrderId = listed.orderId;

  const buyerView = await send('target', { action: 'state' });
  const book = buyerView.auction.orders.find(row => row.id === sellOrderId);
  assert(book, 'Faction members see the order: ' + JSON.stringify(buyerView.auction.orders).slice(0, 300));
  assert.equal(book.side, 'sell');
  assert.equal(book.price, 10);
  assert.equal(book.category, 'ammo', 'The server files the order under the category of its own item catalog.');
  assert.equal(book.durationHours, 24);
  assert.equal(book.mine, false);
  assert(!('ownerCharacterId' in book) && !('escrow' in book), 'The screen never learns who is behind an order.');
  assert.deepEqual(buyerView.auction.items, [{ itemId: 'ammo9', category: 'ammo', sellQty: 20, sellPrice: 10, buyQty: 0, buyPrice: 0, mine: false }],
    'The item summary carries the best price of each side.');

  // --- купить сейчас частью ордера ---------------------------------------
  await send('trade', { action: 'buyNow', orderId: sellOrderId, qty: 1, requestId: 'self-buy' }, false);
  const instant = await send('target', { action: 'buyNow', orderId: sellOrderId, qty: 5, requestId: 'buynow-1' });
  assert.equal(instant.cost, 50);
  assert.equal(instant.tax, 2, 'The sales tax is held back from the seller, not added to the buyer.');
  assert.equal(qty(instant.self, 'ammo9'), 5, 'An instant buy hands the goods over on the spot.');
  assert.equal(qty(instant.self, 'silver'), 1950);

  // --- ордер на выкуп исполняется встречными по цене книги -----------------
  await send('untargeted', { action: 'buy', itemId: 'rifle', qty: 1, price: 100, durationHours: 24, requestId: 'buy-instance' }, false);
  const order = await send('untargeted', { action: 'buy', itemId: 'ammo9', qty: 20, price: 12, durationHours: 24, requestId: 'buy-1' });
  assert.equal(order.boughtQty, 15, 'A buy order takes every unit the book offers below its price.');
  assert.equal(order.spent, 150, 'A crossing order pays the resting price, not its own.');
  assert.equal(order.restingQty, 5);
  assert.equal(order.escrow, 60, 'The rest of the order freezes marks at its own price.');
  assert.equal(order.setupFee, 3);
  assert.equal(qty(order.self, 'ammo9'), 15, 'What was bought at once lands in the backpack.');
  assert.equal(qty(order.self, 'silver'), 1787, 'The buyer pays the fills, the escrow and the fee together.');

  // Повтор того же requestId не списывает марки второй раз.
  const replay = await send('untargeted', { action: 'buy', itemId: 'ammo9', qty: 20, price: 12, durationHours: 24, requestId: 'buy-1' });
  assert.equal(replay.reused, true, 'A repeated order request replays instead of charging twice.');
  assert.equal(qty(replay.self, 'silver'), 1787);

  const buyOrderId = order.orderId;
  const sellerBook = await send('trade', { action: 'state' });
  assert.equal(sellerBook.auction.items[0].buyQty, 5, 'The resting buy order shows up in the book.');
  assert.equal(sellerBook.auction.items[0].buyPrice, 12);
  assert.equal(sellerBook.auction.shelf.silver, 191, 'Both fills paid the seller the price minus the tax.');

  // --- продать сейчас в стоящий ордер на выкуп ----------------------------
  const soldNow = await send('trade', { action: 'sellNow', orderId: buyOrderId, qty: 5, requestId: 'sellnow-1' });
  assert.equal(soldNow.price, 12);
  assert.equal(soldNow.tax, 3);
  assert.equal(soldNow.proceeds, 57, 'An instant sale pays the seller straight into the backpack.');
  assert.equal(qty(soldNow.self, 'silver'), 354);
  assert.equal(qty(soldNow.self, 'ammo9'), 15);
  const filled = await send('untargeted', { action: 'state' });
  assert.equal(filled.auction.orders.length, 0, 'A fully filled order leaves the book.');
  assert.deepEqual(filled.auction.shelf.items.map(row => [row.itemId, row.qty, row.reason]), [['ammo9', 5, 'bought']],
    'The buyer collects the goods from the shelf at the auctioneer.');

  // --- отмена ордера и полка ----------------------------------------------
  const second = await send('trade', { action: 'sell', itemId: 'medkit', qty: 2, price: 60, durationHours: 72, requestId: 'sell-2' });
  assert.equal(second.restingQty, 2);
  await send('target', { action: 'cancel', orderId: second.orderId, requestId: 'cancel-foreign' }, false);
  const cancelled = await send('trade', { action: 'cancel', orderId: second.orderId, requestId: 'cancel-2' });
  assert.equal(cancelled.side, 'sell');

  const claimed = await send('trade', { action: 'claim', requestId: 'claim-1' });
  assert.equal(qty(claimed.self, 'silver'), 544, 'The shelf pays the sales out to the trader backpack.');
  assert.equal(qty(claimed.self, 'medkit'), 2, 'The cancelled order comes home through the shelf.');
  const emptied = await send('trade', { action: 'state' });
  assert.equal(emptied.auction.shelf.silver, 0);
  assert.equal(emptied.auction.shelf.items.length, 0);
  await send('trade', { action: 'claim', requestId: 'claim-2' }, false);

  const rivalClaim = await send('untargeted', { action: 'claim', requestId: 'claim-3' });
  assert.equal(qty(rivalClaim.self, 'ammo9'), 20, 'The filled buy order delivers through the shelf.');
  assert.equal(qty(rivalClaim.self, 'silver'), 1787, 'Every mark of the order went into goods and fees, none vanished.');

  console.log('Market network OK: proximity to the auctioneer, categories and terms from the server, resting sell orders with a setup fee, buy orders crossing at the book price with escrow, replay-safe requests, instant buy and sell with the sales tax, cancel and shelf claims.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
