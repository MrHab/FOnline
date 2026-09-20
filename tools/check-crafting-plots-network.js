#!/usr/bin/env node
'use strict';

// Сетевая проверка участков города (экономика v3, библия 14.5) на настоящем
// сервере. Город станков не ставит: у свободного участка стоит табличка торгов,
// станок появляется только у того, кто выиграл участок, купил материалы и
// построил его сам. Станок переживает смену владельца, но строителю город
// возвращает половину нынешней цены материалов — один раз; снос не возвращает
// ничего.
// Дальше — прежние правила участка: арендатор назначает плату и работает
// бесплатно, гость платит арендатору, устаревшая плата отклоняется, аренда и
// постройка переживают перезапуск. Премиум тратит фокус на заказ у станка.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const accounts = {};

const LOCATION = 'scrapTown';
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  // Раздолье — город-сектор: участки размечает конструктор городов.
  const city = zoneWalk.cityDefinition(LOCATION);
  const plot = (city.cityPlan.plots || []).find(row => row.open && row.district === 'workshop');
  assert(plot, 'в квартале мастерских нет свободного участка');
  const PLOT_ID = `${LOCATION}__${plot.id}`;
  const STATION_OBJECT = `station_${plot.id}`;
  const spot = zoneWalk.cityWorld(LOCATION, plot);
  const knifePrice = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'items.json'))).items
    .find(row => row.id === 'knife').basePrice;

  const place = (role, dx, builder = false) => {
    const state = stateFor(role);
    state.currentLocationId = LOCATION;
    state.serverLocationContext = { locationId: LOCATION };
    state.inventory.silver = 1000;
    state.inventory.ore = 20;
    state.inventory.wood = 10;
    // Материалы ровно на один станок и только будущему строителю: оружейный
    // стоит 20 лома и 6 оружейных частей, а с лишним грузом не скрафтить нож.
    if (builder) {
      state.inventory.scrap = 20;
      state.inventory.weaponParts = 6;
    }
    state.player = { ...(state.player || {}), x: spot.x + dx, z: spot.z - 1.5 };
  };
  // Будущий владелец участка и гость стоят на самом участке.
  place('trade', -1, true);
  place('harvest', 1);
  // Третий участник торгов.
  place('target', 0);
  delete saves.craftingPlots;
  // Гость с премиумом и полным запасом фокуса.
  const focusCap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'economy.json'))).accountSin.focus;
  saves.accounts = {
    [users.users[accounts.harvest.login].id]: {
      sin: 0, premiumUntil: Date.now() + 7 * 86400000, focus: focusCap.cap, focusUpdatedAt: Date.now()
    }
  };
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  const craft = (role, fee, requestId, extra = {}) => h.socketAck(accounts[role].socket, 'craftingStationUsed', {
    requestId, recipeId: 'knifecraft', station: 'weapon_bench', fee, locationId: LOCATION, stationObjectId: STATION_OBJECT, ...extra
  });
  const plotAction = (role, data) => h.socketAck(accounts[role].socket, 'craftingPlotAction', data);
  const plotOf = state => (state.plots || []).find(row => row.plotId === PLOT_ID);

  await h.startServer();
  try {
    for (const role of ['trade', 'harvest', 'target']) await h.connectAndJoin(accounts[role]);

    // --- пустой участок: станка нет, и заказывать негде ------------------------------
    const first = await plotAction('trade', { action: 'state' });
    assert(first.ok, JSON.stringify(first));
    assert(first.plots.length >= 16, 'город размечен участками: ' + first.plots.length);
    const free = plotOf(first);
    assert(free, 'участок квартала мастерских есть в снимке: ' + JSON.stringify(first.plots).slice(0, 300));
    assert.equal(free.leased, false);
    assert.equal(free.station, '', 'на свободном участке станка нет');
    assert.equal(free.auction.open, true);
    assert(!JSON.stringify(first.plots).includes(accounts.trade.characterId), 'снимок участков не раскрывает id персонажей');
    const nothingToUse = await craft('harvest', 1, 'craft-empty');
    assert(!nothingToUse.ok, 'на пустом участке заказывать нечего: ' + JSON.stringify(nothingToUse).slice(0, 200));
    console.log('PASS an empty plot has no station and no orders');

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

    // --- участок выигран: теперь на нём строят станок ------------------------------
    const leased = await plotAction('trade', { action: 'state' });
    const mine = plotOf(leased);
    assert.equal(mine.leased, true, 'победитель торгов стал владельцем участка');
    assert.equal(mine.mine, true);
    assert.equal(mine.feePct, 0.05);
    assert(mine.leaseEndsAt > Date.now() + 6 * 86400000);
    const strangerBuild = await plotAction('harvest', { action: 'build', plotId: PLOT_ID, station: 'weapon_bench', requestId: 'build-guest' });
    assert(!strangerBuild.ok && /другой игрок/.test(strangerBuild.error), 'чужой участок не застроить: ' + JSON.stringify(strangerBuild).slice(0, 200));
    const nonsense = await plotAction('trade', { action: 'build', plotId: PLOT_ID, station: 'pottery', requestId: 'build-bad' });
    assert(!nonsense.ok, 'строят только станки из списка');
    const poor = await plotAction('harvest', { action: 'state' });
    const price = poor.stationCosts.weapon_bench;
    assert(price && price.cost.scrap === 20 && price.worth > 0, 'цена станка видна: ' + JSON.stringify(poor.stationCosts));
    assert.equal(poor.stationRefundPct, 0.5, 'город возвращает половину');
    const scrapBefore = qty((await plotAction('trade', { action: 'state' })).self, 'scrap');
    const built = await plotAction('trade', { action: 'build', plotId: PLOT_ID, station: 'weapon_bench', requestId: 'build-1' });
    assert(built.ok && plotOf(built).station === 'weapon_bench', 'станок построен: ' + JSON.stringify(built).slice(0, 300));
    assert.equal(qty(built.self, 'scrap'), scrapBefore - 20, 'постройка забрала лом');
    assert.equal(qty(built.self, 'weaponParts'), 0, 'постройка забрала оружейные части');
    assert.equal(plotOf(built).stationMine, true, 'станок числится за строителем');
    const twice = await plotAction('trade', { action: 'build', plotId: PLOT_ID, station: 'tool_bench', requestId: 'build-2' });
    assert(!twice.ok && /уже стоит/.test(twice.error), 'второй станок на участок не ставят');
    const brokeBuild = await plotAction('harvest', { action: 'build', plotId: PLOT_ID, station: 'weapon_bench', requestId: 'build-poor' });
    assert(!brokeBuild.ok, 'чужой участок не застроить');
    console.log('PASS the plot owner pays materials and builds a station, nobody else does');

    // --- плата за работу у чужого станка ------------------------------------------
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
    assert(own.ok && own.fee === 0, 'владелец работает бесплатно: ' + JSON.stringify(own).slice(0, 200));
    const ownerSilver = qty(own.self, 'silver');
    const lesseeFee = feeFor(knifePrice, 0.2);
    const stale = await craft('harvest', feeFor(knifePrice, 0.05), 'craft-stale');
    assert(!stale.ok && stale.requiredFee === lesseeFee, 'устаревшая плата отклоняется: ' + JSON.stringify(stale).slice(0, 200));
    const guest = await craft('harvest', lesseeFee, 'craft-guest', { useFocus: true });
    assert(guest.ok && guest.fee === lesseeFee, JSON.stringify(guest).slice(0, 300));
    const focusCost = Math.max(focusCap.minCost, Math.ceil(knifePrice * focusCap.costPerValue));
    assert.equal(guest.focusSpent, focusCost, 'премиум тратит фокус на заказ: ' + JSON.stringify(guest.self.account));
    const ownerAfter = await plotAction('trade', { action: 'state' });
    assert.equal(qty(ownerAfter.self, 'silver'), ownerSilver + lesseeFee, 'плата гостя дошла до владельца участка');
    console.log('PASS lessee fee paid to the plot owner (' + lesseeFee + ')');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  const saved = JSON.parse(fs.readFileSync(savesPath)).craftingPlots.plots[PLOT_ID];
  assert.equal(saved.lessee.characterId, accounts.trade.characterId, 'аренда сохранена');
  assert.equal(saved.station, 'weapon_bench', 'построенный станок сохранён');
  assert.equal(saved.stationOwner.characterId, accounts.trade.characterId, 'строитель станка сохранён');
  assert.deepEqual(saved.stationCost, { scrap: 20, weaponParts: 6 }, 'материалы станка сохранены');
  assert.equal(saved.feePct, 0.2);
  assert.equal(saved.earned, feeFor(knifePrice, 0.2));

  // --- участок ушёл другому: станок остался, строителю вернули половину ---------
  const handover = JSON.parse(fs.readFileSync(savesPath));
  const plotRow = handover.craftingPlots.plots[PLOT_ID];
  plotRow.leaseEndsAt = Date.now() - 1000;
  plotRow.bid = { characterId: accounts.harvest.characterId, name: 'Гость', amount: 500, at: Date.now() - 2000 };
  plotRow.auctionEndsAt = Date.now() - 1000;
  fs.writeFileSync(savesPath, JSON.stringify(handover));

  const items = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kromka', 'items.json'))).items;
  const basePrice = id => Number(items.find(row => row.id === id).basePrice);
  // Книга города пуста, поэтому нынешняя цена материалов — базовая.
  const refund = Math.floor((basePrice('scrap') * 20 + basePrice('weaponParts') * 6) * 0.5);

  await h.startServer();
  try {
    for (const role of ['trade', 'harvest']) await h.connectAndJoin(accounts[role]);
    const builder = await plotAction('trade', { action: 'state' });
    assert.equal(builder.payout, refund, `строителю вернулась половина: ${refund}, пришло ${builder.payout}`);
    const lost = plotOf(builder);
    assert.equal(lost.mine, false, 'участок больше не его');
    assert.equal(lost.station, 'weapon_bench', 'станок остался на участке');
    assert.equal(lost.stationMine, false, 'станок больше не числится за прежним строителем');
    const again = await plotAction('trade', { action: 'state' });
    assert.equal(again.payout, 0, 'возврат приходит один раз');

    const heir = plotOf(await plotAction('harvest', { action: 'state' }));
    assert.equal(heir.mine, true, 'участок у победителя торгов');
    assert.equal(heir.station, 'weapon_bench', 'станок достался ему даром');
    assert.equal(heir.stationMine, false, 'он за станок не платил');
    const scrapBeforeDemolish = qty((await plotAction('harvest', { action: 'state' })).self, 'scrap');
    const razed = await plotAction('harvest', { action: 'demolish', plotId: PLOT_ID, requestId: 'raze-1' });
    assert(razed.ok && plotOf(razed).station === '', 'станок снесён: ' + JSON.stringify(razed).slice(0, 300));
    assert.equal(qty(razed.self, 'scrap'), scrapBeforeDemolish, 'снос ничего не возвращает');
    const nothing = await plotAction('harvest', { action: 'demolish', plotId: PLOT_ID, requestId: 'raze-2' });
    assert(!nothing.ok && /нечего сносить/.test(nothing.error), 'сносить второй раз нечего');
    console.log('PASS the station outlives its builder, who gets half back once, and the heir razes it for nothing');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
  }

  const razedSave = JSON.parse(fs.readFileSync(savesPath)).craftingPlots.plots[PLOT_ID];
  assert.equal(razedSave.station, '', 'снесённый станок не вернулся после перезапуска');
  assert.equal(razedSave.lessee.characterId, accounts.harvest.characterId, 'участок остался за новым владельцем');
  h.cleanupSync();
  console.log('Crafting plots network OK: an empty city plot has no station, auction bids refund (also to offline bidders), the winner pays materials and builds a station, the owner works free, a guest pays his fee, a stale fee is refused, lease and station survive a restart, a handover pays the builder half the current price of his materials once, and the heir razes the station for nothing.');
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
