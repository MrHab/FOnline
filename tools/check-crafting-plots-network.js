#!/usr/bin/env node
'use strict';

// Сетевая проверка участков станков (экономика v3, библия 14.5) на настоящем
// сервере: свободный участок берёт плату поселения, ставки на аренду
// списывают марки и перебитые возвращаются владельцу, итоги торгов делают
// победителя арендатором, арендатор назначает плату и работает бесплатно, а
// гость платит арендатору; устаревшая плата отклоняется, аренда переживает
// перезапуск.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const LOCATION = 'scrapTown';
const BENCH = 'capital_station_scrap_union_weapon_bench';
const PLOT_ID = `${LOCATION}__${BENCH}`;
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const location = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'locations', `${LOCATION}.json`)));
  const bench = location.objects.find(row => row.id === BENCH);
  assert(bench, 'в Раздолье нет оружейного станка');
  const knifePrice = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'items.json'))).items
    .find(row => row.id === 'knife').basePrice;

  const place = (role, dx) => {
    const state = stateFor(role);
    state.currentLocationId = LOCATION;
    state.serverLocationContext = { locationId: LOCATION };
    state.inventory.silver = 1000;
    state.inventory.ore = 20;
    state.inventory.wood = 10;
    state.player = { ...(state.player || {}), x: Number(bench.position.x) + dx, z: Number(bench.position.z) - 1.5 };
  };
  // Будущий арендатор и гость стоят у станка.
  place('trade', -1);
  place('harvest', 1);
  // Третий участник торгов.
  place('target', 0);
  delete saves.craftingPlots;
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  const craft = (role, fee, requestId) => h.socketAck(accounts[role].socket, 'craftingStationUsed', {
    requestId, recipeId: 'knifecraft', station: 'weapon_bench', fee, locationId: LOCATION, stationObjectId: BENCH
  });
  const plotAction = (role, data) => h.socketAck(accounts[role].socket, 'craftingPlotAction', data);
  const plotOf = state => (state.plots || []).find(row => row.plotId === PLOT_ID);

  await h.startServer();
  try {
    for (const role of ['trade', 'harvest', 'target']) await h.connectAndJoin(accounts[role]);

    // --- свободный участок ---------------------------------------------------------
    const first = await plotAction('trade', { action: 'state' });
    assert(first.ok, JSON.stringify(first));
    const free = plotOf(first);
    assert(free, 'оружейный станок — участок: ' + JSON.stringify(first.plots).slice(0, 300));
    assert.equal(free.leased, false);
    assert.equal(free.feePct, 0.15);
    assert.equal(free.auction.open, true);
    assert(free.returnRate > 0.2, 'профильный регион Раздолья даёт больший возврат: ' + free.returnRate);
    assert(!JSON.stringify(first.plots).includes(accounts.trade.characterId), 'снимок участков не раскрывает id персонажей');
    const settlementFee = feeFor(knifePrice, 0.15);
    const tooCheap = await craft('harvest', 1, 'craft-cheap');
    assert(!tooCheap.ok && tooCheap.requiredFee === settlementFee, 'старая комиссия не проходит: ' + JSON.stringify(tooCheap).slice(0, 200));
    const guestCraft = await craft('harvest', settlementFee, 'craft-free');
    assert(guestCraft.ok, JSON.stringify(guestCraft).slice(0, 300));
    assert.equal(guestCraft.fee, settlementFee, 'свободный участок берёт плату поселения');
    assert.equal(qty(guestCraft.self, 'silver'), 1000 - settlementFee);
    assert.equal(qty(guestCraft.self, 'knife'), qty(accounts.harvest.join.self, 'knife') + 1);
    console.log('PASS free plot charges the settlement fee (' + settlementFee + ')');

    // --- торги --------------------------------------------------------------------
    const low = await plotAction('trade', { action: 'bid', plotId: PLOT_ID, amount: 50, requestId: 'bid-low' });
    assert(!low.ok && /не меньше 100/.test(low.error), JSON.stringify(low));
    const bidA = await plotAction('trade', { action: 'bid', plotId: PLOT_ID, amount: 100, requestId: 'bid-a' });
    assert(bidA.ok, JSON.stringify(bidA).slice(0, 300));
    assert.equal(qty(bidA.self, 'silver'), 900, 'ставка списана');
    assert.equal(plotOf(bidA).auction.leading, true);
    const bidC = await plotAction('target', { action: 'bid', plotId: PLOT_ID, amount: 105, requestId: 'bid-c' });
    assert(bidC.ok, JSON.stringify(bidC).slice(0, 300));
    const refunded = await plotAction('trade', { action: 'state' });
    assert.equal(qty(refunded.self, 'silver'), 1000, 'перебитая ставка вернулась');
    assert.equal(plotOf(refunded).auction.leading, false);
    // Перебитый участник вышел из игры: его возврат дождётся следующего входа.
    h.closeSocket(accounts.target);
    await new Promise(resolve => setTimeout(resolve, 300));
    const bidA2 = await plotAction('trade', { action: 'bid', plotId: PLOT_ID, amount: 120, requestId: 'bid-a2' });
    assert(bidA2.ok);
    const replay = await plotAction('trade', { action: 'bid', plotId: PLOT_ID, amount: 120, requestId: 'bid-a2' });
    assert(replay.ok && qty(replay.self, 'silver') === 880, 'повтор запроса не списывает второй раз');
    console.log('PASS lease auction bids and refunds');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  // Торги закончились: переносим их конец в прошлое, как будто прошли сутки.
  const midway = JSON.parse(fs.readFileSync(savesPath));
  assert.equal(midway.craftingPlots.plots[PLOT_ID].bid.amount, 120, 'ставка сохранена');
  assert.equal(midway.craftingPlots.payouts?.[accounts.target.characterId], 105, 'возврат ушедшего игрока ждёт его');
  midway.craftingPlots.plots[PLOT_ID].auctionEndsAt = Date.now() - 1000;
  fs.writeFileSync(savesPath, JSON.stringify(midway));

  await h.startServer();
  try {
    for (const role of ['trade', 'harvest', 'target']) await h.connectAndJoin(accounts[role]);
    const refund = await plotAction('target', { action: 'state' });
    assert.equal(qty(refund.self, 'silver'), 1000, 'вернувшийся участник получил возврат ставки');

    // --- аренда -------------------------------------------------------------------
    const leased = await plotAction('trade', { action: 'state' });
    const mine = plotOf(leased);
    assert.equal(mine.leased, true, 'победитель торгов стал арендатором');
    assert.equal(mine.mine, true);
    assert.equal(mine.feePct, 0.05);
    assert(mine.leaseEndsAt > Date.now() + 6 * 86400000);
    const guestView = plotOf(await plotAction('harvest', { action: 'state' }));
    assert.equal(guestView.mine, false);
    assert.equal(guestView.lesseeName.length > 0, true);
    const stranger = await plotAction('harvest', { action: 'setFee', plotId: PLOT_ID, feePct: 0.1, requestId: 'fee-guest' });
    assert(!stranger.ok, 'чужой не назначает плату');
    const setFee = await plotAction('trade', { action: 'setFee', plotId: PLOT_ID, feePct: 0.2, requestId: 'fee-1' });
    assert(setFee.ok && plotOf(setFee).feePct === 0.2, JSON.stringify(setFee).slice(0, 300));
    const tooHigh = await plotAction('trade', { action: 'setFee', plotId: PLOT_ID, feePct: 0.5, requestId: 'fee-2' });
    assert(!tooHigh.ok);

    const own = await craft('trade', 0, 'craft-own');
    assert(own.ok && own.fee === 0, 'арендатор работает бесплатно: ' + JSON.stringify(own).slice(0, 200));
    const ownerSilver = qty(own.self, 'silver');
    const lesseeFee = feeFor(knifePrice, 0.2);
    const stale = await craft('harvest', feeFor(knifePrice, 0.05), 'craft-stale');
    assert(!stale.ok && stale.requiredFee === lesseeFee, 'устаревшая плата отклоняется: ' + JSON.stringify(stale).slice(0, 200));
    const guest = await craft('harvest', lesseeFee, 'craft-guest');
    assert(guest.ok && guest.fee === lesseeFee, JSON.stringify(guest).slice(0, 300));
    const ownerAfter = await plotAction('trade', { action: 'state' });
    assert.equal(qty(ownerAfter.self, 'silver'), ownerSilver + lesseeFee, 'плата гостя дошла до арендатора');
    console.log('PASS lessee fee paid to the lessee (' + lesseeFee + ')');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  const saved = JSON.parse(fs.readFileSync(savesPath)).craftingPlots.plots[PLOT_ID];
  assert.equal(saved.lessee.characterId, accounts.trade.characterId, 'аренда сохранена');
  assert.equal(saved.feePct, 0.2);
  assert.equal(saved.earned, feeFor(knifePrice, 0.2));
  h.cleanupSync();
  console.log('Crafting plots network OK: settlement fee on a free plot, lease bids with refunds (also to offline bidders), auction settlement, lessee fee setting, free work for the lessee, fees paid to the lessee, stale fees refused and the lease saved.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});

// Плата участка — как на сервере: доля стоимости вверх, не меньше комиссии рецепта (1).
function feeFor(price, pct) {
  return Math.max(1, Math.ceil(Number((price * pct).toFixed(6))));
}
