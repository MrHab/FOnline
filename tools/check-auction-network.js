#!/usr/bin/env node
'use strict';

// Сетевая проверка аукциона на реальном сервере (изолированный DATA_DIR):
// экран аукционера открывается только рядом с ним, лот уходит в категорию на
// выбранный срок, ставка снимает марки и возвращает перебитую на полку,
// выкуп закрывает торги с налогом продавцу, снятие и забор полки доводят
// предметы до рюкзака, а повтор requestId не списывает марки дважды.

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

  // --- аукционер открывает экран только рядом с собой --------------------
  const far = await walkTo(accounts.trade, 16, -18, false);
  assert.equal(far.ok, false, 'The auction screen stays shut away from the auctioneer.');
  assert.match(far.error, /Аукционер/, far.error);

  const opened = await walkToAuctioneer(accounts.trade);
  assert.equal(opened.taxPct, 0.05, 'The screen states the sales tax up front.');
  assert.deepEqual(opened.durationChoicesHours, [6, 12, 24, 48], 'The seller chooses the listing term from the server list.');
  assert(opened.categories.length >= 9 && opened.categories.every(row => row.id && row.label),
    'Every product category arrives with its label.');
  assert.equal(opened.limits.maxQtyPerListing, 200);
  for (const role of ['target', 'untargeted']) await walkToAuctioneer(accounts[role]);

  // --- выставление --------------------------------------------------------
  await send('trade', { action: 'list', itemId: 'ammo9', qty: 20, startPrice: 100, buyoutPrice: 40, durationHours: 6, requestId: 'lot-bad' }, false);
  await send('trade', { action: 'list', itemId: 'ammo9', qty: 20, startPrice: 100, buyoutPrice: 500, durationHours: 5, requestId: 'lot-term' }, false);
  const listed = await send('trade', {
    action: 'list', itemId: 'ammo9', qty: 20, startPrice: 100, buyoutPrice: 500, durationHours: 6, requestId: 'lot-1'
  });
  assert.equal(listed.category, 'ammo', 'The server files the lot under the category of its own item catalog.');
  assert.equal(qty(listed.self, 'ammo9'), 20, 'The listed stack leaves the backpack at once.');
  const lotId = listed.listingId;

  const buyerView = await send('target', { action: 'state' });
  const lot = buyerView.auction.listings.find(row => row.id === lotId);
  assert(lot, 'Faction members see the lot: ' + JSON.stringify(buyerView.auction.listings).slice(0, 300));
  assert.equal(lot.category, 'ammo');
  assert.equal(lot.startPrice, 100);
  assert.equal(lot.buyoutPrice, 500);
  assert.equal(lot.nextBid, 100);
  assert.equal(lot.durationHours, 6);
  assert.equal(lot.mine, false);
  assert(!('bidderCharacterId' in lot) && !('sellerCharacterId' in lot), 'The screen never learns who is behind a lot.');
  assert.equal(buyerView.auction.categories.find(row => row.id === 'ammo').count, 1);

  // --- ставки -------------------------------------------------------------
  await send('target', { action: 'bid', listingId: lotId, amount: 99, requestId: 'bid-low' }, false);
  const firstBid = await send('target', { action: 'bid', listingId: lotId, amount: 100, requestId: 'bid-1' });
  assert.equal(firstBid.nextBid, 105, 'The next bid has to clear the step.');
  assert.equal(qty(firstBid.self, 'silver'), 1900, 'A bid takes the marks at once, so the lot holds real money.');

  // Повтор того же requestId не списывает марки второй раз.
  const replay = await send('target', { action: 'bid', listingId: lotId, amount: 100, requestId: 'bid-1' });
  assert.equal(replay.reused, true, 'A repeated bid request replays instead of charging twice.');
  assert.equal(qty(replay.self, 'silver'), 1900);

  await send('untargeted', { action: 'bid', listingId: lotId, amount: 104, requestId: 'bid-2' }, false);
  const rivalBid = await send('untargeted', { action: 'bid', listingId: lotId, amount: 105, requestId: 'bid-3' });
  assert.equal(qty(rivalBid.self, 'silver'), 1895);
  const outbid = await send('target', { action: 'state' });
  assert.equal(outbid.auction.shelf.silver, 100, 'An outbid claimant finds every mark back on the shelf.');
  assert.equal(outbid.auction.listings.find(row => row.id === lotId).bid, 105);

  await send('trade', { action: 'cancel', listingId: lotId, requestId: 'cancel-bid' }, false);

  // --- выкуп --------------------------------------------------------------
  const bought = await send('target', { action: 'buyout', listingId: lotId, requestId: 'buyout-1' });
  assert.equal(bought.price, 500);
  assert.equal(bought.tax, 25, 'The five percent sales tax is held back from the seller.');
  assert.equal(qty(bought.self, 'ammo9'), 20, 'The buyout hands the goods over on the spot.');
  assert.equal(qty(bought.self, 'silver'), 1400, 'The buyer pays the buyout price on top of the bid already held.');

  const rivalAfter = await send('untargeted', { action: 'state' });
  assert.equal(rivalAfter.auction.shelf.silver, 105, 'The losing bid comes back when the lot is bought out.');

  const sellerAfter = await send('trade', { action: 'state' });
  assert.equal(sellerAfter.auction.shelf.silver, 475, 'The seller receives the price minus the tax.');
  assert.equal(sellerAfter.auction.shelf.sales, 1);
  assert.equal(sellerAfter.auction.listings.length, 0);

  // --- снятие лота и полка ------------------------------------------------
  const second = await send('trade', {
    action: 'list', itemId: 'medkit', qty: 2, startPrice: 60, buyoutPrice: 0, durationHours: 12, requestId: 'lot-2'
  });
  assert.equal(second.buyoutPrice, 0, 'A lot may go to auction without a buyout at all.');
  await send('target', { action: 'buyout', listingId: second.listingId, requestId: 'buyout-2' }, false);
  await send('trade', { action: 'cancel', listingId: second.listingId, requestId: 'cancel-2' });

  const claimed = await send('trade', { action: 'claim', requestId: 'claim-1' });
  assert.equal(qty(claimed.self, 'silver'), 775, 'The shelf pays out the sale to the seller backpack.');
  assert.equal(qty(claimed.self, 'medkit'), 2, 'The cancelled lot comes home through the shelf.');
  const emptied = await send('trade', { action: 'state' });
  assert.equal(emptied.auction.shelf.silver, 0);
  assert.equal(emptied.auction.shelf.items.length, 0);
  await send('trade', { action: 'claim', requestId: 'claim-2' }, false);

  const rivalClaim = await send('untargeted', { action: 'claim', requestId: 'claim-3' });
  assert.equal(qty(rivalClaim.self, 'silver'), 2000, 'The outbid rival ends the day whole.');

  console.log('Auction network OK: proximity to the auctioneer, categories and terms from the server, escrowed bids with refunds, replay-safe requests, buyout with the sales tax, cancel and shelf claims.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
