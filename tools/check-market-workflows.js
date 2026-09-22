'use strict';
const assert = require('node:assert/strict');
const m = require('../src/server/faction-market');
const { publicHistory } = require('../src/server/market-history');
const rules = m.normalizeMarketRules({ setupFeePct: 0.025, taxPct: 0.08, maxOrdersPerTrader: 1 });
const now = 1800000000000;
const day = 86400000;
const order = (owner, qty, price) => ({ ownerCharacterId: owner, itemId: 'ammo9', category: 'ammo', qty, price, durationMs: day });
let store = m.normalizeMarketStore({});
const sale = m.placeSellOrder(store, order('seller', 10, 100), rules, now).order;
const before = JSON.stringify(store);
for (const input of [
  { qty: 11, price: 100, availableSilver: 10000 },
  { qty: 10, price: 100, availableSilver: 0 },
  { qty: NaN, price: 100, availableSilver: 10000 },
  { qty: 10, price: Infinity, availableSilver: 10000 }
]) {
  assert.equal(m.updateOrder(store, sale.id, 'seller', input, rules, now + 1).ok, false);
  assert.equal(JSON.stringify(store), before, 'Rejected edits are atomic.');
}
assert.equal(m.updateOrder(store, sale.id, 'stranger', { qty: 2, price: 80, availableSilver: 100 }, rules, now + 1).ok, false);
assert.equal(JSON.stringify(store), before);
const changed = m.updateOrder(store, sale.id, 'seller', { qty: 8, price: 80, availableSilver: 100 }, rules, now + 2);
assert(changed.ok, 'Editing works at the per-owner listing limit.');
assert.equal(changed.balanceDelta, -16);
assert.equal(store.orders[sale.id].qty, 8);
assert.equal(store.orders[sale.id].createdAt, now + 2);
assert.equal(m.normalizeMarketStore(JSON.parse(JSON.stringify(store))).orders[sale.id].updatedAt, now + 2, 'Quote protection survives a restart.');
assert.equal(m.shelfFor(store, 'seller').items[0].qty, 2);
m.takeSellOrder(store, sale.id, 'buyer', 3, rules, now + 3);
assert.equal(store.orders[sale.id].filled, 3);
const buy = m.placeBuyOrder(store, order('buyer', 2, 60), rules, now + 4).order;
const crossing = m.updateOrder(store, buy.id, 'buyer', { qty: 4, price: 90, availableSilver: 300 }, rules, now + 5);
assert(crossing.ok);
assert.equal(crossing.boughtQty, 4);
assert.equal(crossing.balanceDelta, 120 - 320 - 9);
assert.equal(m.shelfFor(store, 'buyer').items[0].qty, 4);
assert.equal(store.orders[sale.id].qty, 1);
assert.equal(m.shelfFor(store, 'seller').silver, 221 + 295);
const view = m.publicMarket(store, 'buyer', rules, now + 6, { itemId: 'ammo9', catalog: [{ itemId: 'empty', category: 'misc' }] });
assert.equal(view.history[0].qty, 7);
assert.equal(view.history[0].average, 80);
assert(view.items.some(row => row.itemId === 'empty' && row.sellQty === 0));
assert(view.activity.every(row => !('owner' in row)));
assert(!view.activity.some(row => row.kind === 'sold'), 'A buyer cannot read seller receipts.');
assert.deepEqual(m.publicMarket(m.normalizeMarketStore(JSON.parse(JSON.stringify(store))), 'buyer', rules, now + 6,
  { itemId: 'ammo9', catalog: [{ itemId: 'empty', category: 'misc' }] }), view, 'Restart preserves history and receipts.');
assert.equal(publicHistory(store, 'ammo9', now + 29 * day)[2].qty, 0);
const otherCity = m.normalizeMarketStore({});
assert.equal(publicHistory(otherCity, 'ammo9', now)[0].qty, 0);
for (const key of ['constructor', '__proto__', 'toString', '', 'unknown']) {
  assert.equal(publicHistory(otherCity, key, now)[0].qty, 0, 'Unknown history queries cannot access inherited object properties.');
}

store = m.normalizeMarketStore({});
const reserve = m.placeBuyOrder(store, order('buyer', 10, 100), rules, now).order;
const refund = m.updateOrder(store, reserve.id, 'buyer', { qty: 4, price: 50, availableSilver: 0 }, rules, now + 1);
assert.equal(refund.balanceDelta, 795, 'Freed reserve pays the new listing fee.');
assert.equal(store.orders[reserve.id].escrow, 200);
assert.equal(m.shelfFor(store, 'buyer').silver, 0, 'The refund is returned once through balanceDelta.');
const originalRecord = { id: 'unique', artifact: { seed: 'hidden', tier: 3 } };
const unique = m.placeSellOrder(store, { ...order('seller', 1, 100), itemId: 'artifact', records: [originalRecord] }, rules, now).order;
const revised = m.updateOrder(store, unique.id, 'seller', { qty: 1, price: 200, availableSilver: 20 }, rules, now + 2);
assert.deepEqual(revised.order.records, [originalRecord]);
assert(!JSON.stringify(m.publicMarket(store, 'buyer', rules, now + 3)).includes('hidden'));
assert.equal(m.updateOrder(store, unique.id, 'seller', { qty: 1, price: 200, availableSilver: 20 }, rules, now + 2 * day).ok, false);
m.expireOrders(store, rules, now + 2 * day);
assert(m.publicMarket(store, 'seller', rules, now + 2 * day).activity.some(row => row.kind === 'expired'));

store = m.normalizeMarketStore({});
const makerBuy = m.placeBuyOrder(store, order('buyer', 10, 30), rules, now).order;
const makerSell = m.placeSellOrder(store, order('seller', 8, 40), rules, now + 1).order;
const sellEdit = m.updateOrder(store, makerSell.id, 'seller', { qty: 5, price: 20, availableSilver: 10 }, rules, now + 2);
assert.equal(sellEdit.soldQty, 5);
assert.equal(sellEdit.balanceDelta, 138 - 2, 'Repriced sales fill at the resting buyer price and pay tax plus listing fee.');
assert.equal(store.orders[makerBuy.id].escrow, 150);
assert.equal(m.shelfFor(store, 'seller').items[0].qty, 3);
assert.equal(m.shelfFor(store, 'buyer').items[0].qty, 5);

store = m.normalizeMarketStore({});
const first = m.placeSellOrder(store, order('first', 5, 10), rules, now).order;
const second = m.placeSellOrder(store, order('second', 5, 10), rules, now + 1).order;
m.updateOrder(store, first.id, 'first', { qty: 5, price: 10, availableSilver: 10 }, rules, now + 2);
assert.deepEqual(m.bookSide(store, 'ammo9', 'sell', now + 3).map(row => row.id), [second.id, first.id], 'Editing loses time priority at equal prices.');

const { recordTrade } = require('../src/server/market-history');
store = m.normalizeMarketStore({});
recordTrade(store, 'ammo9', 2, 10, 'buyer', 'seller', 1, now);
recordTrade(store, 'ammo9', 1, 40, 'buyer', 'seller', 3, now + 1);
assert.equal(publicHistory(store, 'ammo9', now + 2)[0].average, 20, 'Average is volume weighted.');
for (let i = 0; i < 3000; i++) recordTrade(store, 'ammo9', 1, 20, 'buyer', 'seller', 1, now + 3 + i);
assert.equal(store.activity.length, 5000, 'Recent receipts are bounded.');
assert.equal(publicHistory(store, 'ammo9', now + 10000)[0].qty, 3003, 'Receipt eviction does not discard market volume.');
assert.equal(m.publicMarket(store, 'buyer', rules, now + 10000).activity.length, 50);
console.log('Market workflows OK: atomic edits, escrow, partial fills, unique records, local price history, privacy and restart.');
