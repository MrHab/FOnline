#!/usr/bin/env node
'use strict';

// Сетевая проверка сини (экономика v3, библия 14.5) на настоящем сервере:
// кассеты из рюкзака уходят на счёт аккаунта при входе, премиум покупается
// за синь и снижает налог аукциона, синь не выставляется на аукцион,
// обменник синь↔марки работает только у аукционера — ордера, мгновенные
// сделки, отмена и полка, выручка сверх стопки марок ждёт на полке, —
// купленная синь сама ложится на счёт, а счёт
// переживает перезапуск. Выдача сини закрыта без доступа разработчика.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const DAY = 24 * 3600000;
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);
const sluice = require('../data/locations/sluiceCity.json');
const auctioneer = (sluice.objects || []).find(object => (object.entity || {}).service === 'auction');
assert(auctioneer, 'в Створе нет аукционера');

const postJson = (route, body) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify(body));
  const req = http.request(h.baseUrl() + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': payload.length }
  }, res => {
    let text = '';
    res.on('data', chunk => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  req.end(payload);
});

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const userId = role => users.users[accounts[role].login].id;
  const stateFor = role => saves.characters[userId(role)][accounts[role].characterId].state;
  const nearAuctioneer = (role, dz, items) => {
    const state = stateFor(role);
    state.currentLocationId = 'sluiceCity';
    state.serverLocationContext = { locationId: 'sluiceCity' };
    Object.assign(state.inventory, items);
    state.player = { ...(state.player || {}), x: Number(auctioneer.position.x), z: Number(auctioneer.position.z) + dz };
  };
  // У продавца 340 сини на счёте и полная стопка кассет в рюкзаке —
  // наследие старых сохранений.
  // Марок у него больше прежнего предела стопки в рюкзаке (200 000).
  nearAuctioneer('trade', -2, { silver: 199000, blue: 60 });
  saves.accounts = { [userId('trade')]: { sin: 340, ledger: [{ at: 1, delta: 340, reason: 'grant' }] } };
  nearAuctioneer('harvest', 2, { silver: 5000 });
  // Третий далеко от аукционера.
  stateFor('target').inventory.silver = 100;
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    for (const role of ['trade', 'harvest', 'target']) await h.connectAndJoin(accounts[role]);
    const send = async (role, event, data, ok = true) => {
      const response = await h.socketAck(accounts[role].socket, event, data);
      assert.equal(response.ok, ok, `${event}:${data.action} (${role}): ${JSON.stringify(response).slice(0, 400)}`);
      return response;
    };
    const sin = (role, data, ok = true) => send(role, 'accountSinAction', data, ok);

    // --- кассеты на счёт -------------------------------------------------------
    const opened = await sin('trade', { action: 'state' });
    assert.equal(opened.account.sin, 400, 'the 60 cassettes joined the stored 340 sin: ' + JSON.stringify(opened.account));
    assert.equal(qty(opened.self, 'blue'), 0, 'no sin cassettes stay in the backpack');
    assert.equal(opened.self.account.sin, 400, 'the player snapshot shows the account');
    assert.equal(opened.account.premium, false);
    assert.equal(opened.exchange.orderFee, 10);
    assert.deepEqual(opened.exchange.durationChoicesHours, [24, 72, 168, 720]);
    console.log('PASS cassettes move onto the account on join');

    // --- синь не продаётся на аукционе ------------------------------------------
    const blocked = await send('trade', 'auctionAction', { action: 'sell', itemId: 'blue', qty: 1, price: 10, durationHours: 24, requestId: 'a-sell-blue' }, false);
    assert.match(blocked.error, /обменник/i);
    await send('harvest', 'auctionAction', { action: 'buy', itemId: 'blue', qty: 1, price: 10, durationHours: 24, requestId: 'a-buy-blue' }, false);
    const plainTax = await send('trade', 'auctionAction', { action: 'state' });
    assert.equal(plainTax.auction.taxPct, 0.08, 'no premium, full tax');
    console.log('PASS sin is not an auction lot');

    // --- премиум ------------------------------------------------------------------
    const before = Date.now();
    const premium = await sin('trade', { action: 'buyPremium', requestId: 'premium-1' });
    assert.equal(premium.account.sin, 100);
    assert.equal(premium.account.premium, true);
    // Часы процессов теста и сервера расходятся на миллисекунды — допуск секунда.
    assert(premium.premiumUntil >= before + 30 * DAY - 1000 && premium.premiumUntil <= Date.now() + 30 * DAY + 1000,
      `thirty days of premium: ${premium.premiumUntil} vs ${before} (${JSON.stringify(premium).slice(0, 300)})`);
    const replay = await sin('trade', { action: 'buyPremium', requestId: 'premium-1' });
    assert.equal(replay.replay, true);
    assert.equal(replay.account.sin, 100, 'a replayed purchase is not charged twice');
    const premiumTax = await send('trade', 'auctionAction', { action: 'state' });
    assert.equal(premiumTax.auction.taxPct, 0.04, 'premium halves the auction tax');
    await sin('harvest', { action: 'buyPremium', requestId: 'premium-poor' }, false);
    console.log('PASS premium costs 300 sin, lasts 30 days and lowers the auction tax');

    // --- обменник -------------------------------------------------------------------
    await sin('target', { action: 'state' });
    const far = await sin('target', { action: 'buy', qty: 1, price: 10, durationHours: 24, requestId: 'far-buy' }, false);
    assert.match(far.error, /аукционер/i, 'the exchange lives at the auctioneer');

    const listed = await sin('trade', { action: 'sell', qty: 50, price: 20, durationHours: 72, requestId: 'x-sell-1' });
    assert.equal(listed.restingQty, 50);
    assert.equal(listed.account.sin, 50, 'the sold sin leaves the account at once');
    assert.equal(qty(listed.self, 'silver'), 198990, 'a flat 10-mark order fee');
    const orderId = listed.orderId;
    assert(orderId, JSON.stringify(listed).slice(0, 300));
    await sin('trade', { action: 'sell', qty: 51, price: 20, durationHours: 72, requestId: 'x-sell-over' }, false);

    const bought = await sin('harvest', { action: 'buyNow', orderId, qty: 20, requestId: 'x-buynow-1' });
    assert.equal(bought.cost, 400);
    assert.equal(bought.account.sin, 20, 'bought sin lands on the account');
    assert.equal(qty(bought.self, 'silver'), 4600);

    const crossing = await sin('harvest', { action: 'buy', qty: 10, price: 25, durationHours: 24, requestId: 'x-buy-cross' });
    assert.equal(crossing.boughtQty, 10, 'a higher bid fills against the resting order');
    assert.equal(crossing.spent, 200, 'at the resting order price');
    assert.equal(crossing.account.sin, 30);
    assert.equal(qty(crossing.self, 'silver'), 4390);

    const claimed = await sin('trade', { action: 'claim', requestId: 'x-claim-1' });
    assert.equal(claimed.claimedSilver, 600, 'the seller takes 30 × 20 marks without tax');
    assert.equal(qty(claimed.self, 'silver'), 199590);

    const cancelled = await sin('trade', { action: 'cancel', orderId, requestId: 'x-cancel-1' });
    assert.equal(cancelled.account.sin, 70, 'the unsold rest returns to the account');
    assert.equal((cancelled.exchange.orders || []).length, 0);

    const bid = await sin('harvest', { action: 'buy', qty: 5, price: 15, durationHours: 24, requestId: 'x-bid' });
    assert.equal(bid.restingQty, 5);
    assert.equal(bid.escrow, 75);
    assert.equal(qty(bid.self, 'silver'), 4305);
    const bidId = bid.orderId;
    const sold = await sin('trade', { action: 'sellNow', orderId: bidId, qty: 5, requestId: 'x-sellnow' });
    assert.equal(sold.proceeds, 75);
    assert.equal(sold.account.sin, 65);
    assert.equal(qty(sold.self, 'silver'), 199665);
    const later = await sin('harvest', { action: 'state' });
    assert.equal(later.account.sin, 35, 'sin bought by a resting order reaches the account');

    // Марки на счёте аккаунта: прежний предел стопки в 200 000 их не режет.
    const richBid = await sin('harvest', { action: 'buy', qty: 5, price: 100, durationHours: 24, requestId: 'x-rich-bid' });
    assert.equal(richBid.restingQty, 5);
    const overflow = await sin('trade', { action: 'sell', qty: 5, price: 90, durationHours: 24, requestId: 'x-overflow' });
    assert.equal(overflow.soldQty, 5);
    assert.equal(overflow.proceeds, 500, 'the resting bid price is paid');
    assert.equal(qty(overflow.self, 'silver'), 200155, 'marks on the account have no 200 000 cap');
    assert.equal(overflow.account.marks, 200155, 'the account view shows the live marks');
    assert.equal(overflow.shelvedSilver, 0, 'nothing waits on the shelf');
    assert.equal(overflow.account.sin, 60);
    await sin('trade', { action: 'claim', requestId: 'x-claim-full' }, false);
    assert.equal((await sin('harvest', { action: 'state' })).account.sin, 40);
    console.log('PASS the sin exchange: orders, instant deals, cancel, shelf and the flat fee');

    // --- выдача и сохранение ----------------------------------------------------------
    const grant = await postJson('/api/dev/accounts/sin', { login: accounts.target.login, amount: 1000 });
    assert.notEqual(grant.status, 200, 'granting sin needs developer access: ' + grant.text.slice(0, 200));

    h.closeSocket(accounts.trade);
    h.closeSocket(accounts.harvest);
    await new Promise(resolve => setTimeout(resolve, 2500));
    const stored = JSON.parse(fs.readFileSync(savesPath)).accounts || {};
    assert.equal(stored[userId('trade')]?.sin, 60, 'the account is saved: ' + JSON.stringify(stored[userId('trade')]).slice(0, 200));
    assert(stored[userId('trade')].premiumUntil > Date.now() + 29 * DAY);
    assert.equal(stored[userId('harvest')]?.sin, 40);
    const character = JSON.parse(fs.readFileSync(savesPath)).characters[userId('trade')][accounts.trade.characterId].state;
    assert(!Number(character.inventory?.blue || 0), 'the saved backpack has no sin cassettes');
    console.log('PASS the account survives in saves and is closed to anonymous grants');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Account sin network OK: cassettes onto the account, premium for sin with the lower auction tax, no sin lots on the auction, the sin exchange at the auctioneer and a saved account.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
