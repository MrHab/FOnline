#!/usr/bin/env node
'use strict';

// Сетевая проверка рынка и сервисов столиц на настоящем сервере (изолированный
// DATA_DIR): книга одна на всех аукционеров — ордер, выставленный в одной
// столице, виден и исполняется в другой; членство во фракции больше ничего не
// решает; ордер на выкуп замораживает марки и исполняется встречными по цене
// книги; ремонтник чинит снаряжение за марки, а медик и он сам работают только
// рядом с собой.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const qty = (self, id) => (self.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);

// Сервисы расставлены tools/build-capital-services.js; координаты берутся из
// авторских данных, чтобы проверка падала, если NPC переедет.
const locations = JSON.parse(JSON.stringify({
  sluiceCity: require('../data/locations/sluiceCity.json'),
  scrapTown: require('../data/locations/scrapTown.json'),
  coreBaseUprava: require('../data/locations/coreBaseUprava.json')
}));
const servicePosition = (locationId, service) => {
  const row = (locations[locationId].objects || []).find(object => (object.entity || {}).service === service);
  assert(row, `в ${locationId} нет сервиса ${service}`);
  return { x: Number(row.position.x), z: Number(row.position.z) };
};

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const membership = factionId => ({ version: 1, factionId, joinedAt: Date.now() - 1000, changeAllowedAt: Date.now() + 72 * 3600000, history: [] });

  // Продавец стоит в столице «Управы» между аукционером и ремонтником и НЕ
  // состоит ни в одной фракции Сердцевины: рынок обязан его принять.
  const sluiceAuction = servicePosition('sluiceCity', 'auction');
  const sluiceRepair = servicePosition('sluiceCity', 'repair');
  const sellerState = stateFor('trade');
  sellerState.currentLocationId = 'sluiceCity';
  sellerState.serverLocationContext = { locationId: 'sluiceCity' };
  sellerState.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };
  sellerState.inventory.silver = 3000;
  sellerState.inventory.ammo9 = 60;
  sellerState.inventory.leather = 1;
  sellerState.player = {
    ...(sellerState.player || {}),
    // Состояния предметов сервер читает из state.player.itemConditions — они
    // приоритетнее одноимённого поля уровнем выше.
    itemConditions: { ...(sellerState.player?.itemConditions || {}), leather: 40 },
    x: (sluiceAuction.x + sluiceRepair.x) / 2,
    z: (sluiceAuction.z + sluiceRepair.z) / 2
  };

  // Покупатель — в другой столице, у другого аукционера.
  const scrapAuction = servicePosition('scrapTown', 'auction');
  const buyerState = stateFor('target');
  buyerState.currentLocationId = 'scrapTown';
  buyerState.serverLocationContext = { locationId: 'scrapTown' };
  buyerState.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };
  buyerState.inventory.silver = 3000;
  buyerState.player = { ...(buyerState.player || {}), x: scrapAuction.x, z: scrapAuction.z - 2 };

  // Третий — на базе Сердцевины: туда пускают только по контракту фракции.
  const coreAuction = servicePosition('coreBaseUprava', 'auction');
  const coreState = stateFor('untargeted');
  coreState.currentLocationId = 'coreBaseUprava';
  coreState.serverLocationContext = { locationId: 'coreBaseUprava' };
  coreState.territoryFaction = membership('uprava');
  coreState.inventory.silver = 3000;
  coreState.player = { ...(coreState.player || {}), x: coreAuction.x, z: coreAuction.z - 2 };

  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  for (const role of ['trade', 'target', 'untargeted']) await h.connectAndJoin(accounts[role]);

  const send = async (role, event, data, ok = true) => {
    const response = await h.socketAck(accounts[role].socket, event, data);
    assert.equal(response.ok, ok, `${event}:${data.action} (${role}): ${JSON.stringify(response).slice(0, 400)}`);
    return response;
  };
  const market = (role, data, ok = true) => send(role, 'auctionAction', data, ok);

  // --- рынок открыт без членства во фракции ------------------------------
  const opened = await market('trade', { action: 'state' });
  assert.equal(opened.auction.marketId, 'wasteland', 'книга у всех аукционеров одна');
  assert.equal(opened.auction.taxPct, 0.05);
  assert.equal(opened.auction.setupFeePct, 0.015);
  assert.deepEqual(opened.auction.durationChoicesHours, [6, 24, 72, 168]);
  assert(!('factionId' in opened.auction), 'снимок рынка не привязан к фракции');

  // --- ордер из одной столицы виден в другой ------------------------------
  const listed = await market('trade', { action: 'sell', itemId: 'ammo9', qty: 20, price: 10, durationHours: 24, requestId: 'sell-1' });
  assert.equal(listed.restingQty, 20);
  assert.equal(listed.setupFee, 3);
  assert.equal(qty(listed.self, 'ammo9'), 40, 'выставленная пачка уходит из рюкзака');
  const orderId = listed.orderId;

  const fromScrapTown = await market('target', { action: 'state' });
  const seen = fromScrapTown.auction.orders.find(row => row.id === orderId);
  assert(seen, 'ордер из «Шлюзового города» обязан быть виден в «Свалке»: '
    + JSON.stringify(fromScrapTown.auction.orders).slice(0, 300));
  assert.equal(seen.price, 10);
  assert.equal(seen.mine, false);

  const fromCoreBase = await market('untargeted', { action: 'state' });
  assert(fromCoreBase.auction.orders.some(row => row.id === orderId),
    'тот же ордер виден и у аукционера базы Сердцевины');

  // --- сделка через столицы ----------------------------------------------
  const bought = await market('target', { action: 'buyNow', orderId, qty: 5, requestId: 'buynow-1' });
  assert.equal(bought.cost, 50);
  assert.equal(qty(bought.self, 'ammo9'), 5, 'покупатель получает товар в другой столице');
  assert.equal(qty(bought.self, 'silver'), 2950);
  const sellerBook = await market('trade', { action: 'state' });
  assert.equal(sellerBook.auction.shelf.silver, 48, 'выручка продавца ждёт его на полке: цена минус налог');
  assert.equal(sellerBook.auction.orders.find(row => row.id === orderId).qty, 15, 'в книге остался остаток ордера');

  // Ордер на выкуп с базы Сердцевины исполняется остатком того же ордера.
  const crossing = await market('untargeted', { action: 'buy', itemId: 'ammo9', qty: 15, price: 12, durationHours: 24, requestId: 'buy-1' });
  assert.equal(crossing.boughtQty, 15, 'встречный ордер забирает остаток продавца из другой столицы');
  assert.equal(crossing.spent, 150, 'исполнение идёт по цене того ордера, что стоял в книге');
  const afterCrossing = await market('trade', { action: 'state' });
  assert.equal(afterCrossing.auction.orders.length, 0, 'исполненный ордер уходит из общей книги');
  assert.equal(afterCrossing.auction.shelf.silver, 48 + 143, 'вторая выручка тоже на полке');

  // --- ремонтник столицы --------------------------------------------------
  const repairState = await send('trade', 'baseServiceAction', { service: 'repair', action: 'state' });
  const damaged = repairState.targets.find(row => row.itemId === 'leather');
  assert(damaged, 'ремонтник обязан видеть изношенную куртку: ' + JSON.stringify(repairState).slice(0, 400));
  assert.equal(damaged.condition, 40);
  assert(damaged.cost > 0, 'починка стоит марок');
  // Сколько марок было — говорит сам ремонтник в своём снимке.
  const silverBefore = repairState.silver;
  const repaired = await send('trade', 'baseServiceAction',
    { service: 'repair', action: 'repair', itemId: 'leather', requestId: 'repair-1' });
  assert.equal(repaired.cost, damaged.cost);
  assert.equal(qty(repaired.self, 'silver'), silverBefore - damaged.cost, 'ремонт списывает ровно объявленную цену');
  assert(!repaired.targets.some(row => row.itemId === 'leather'), 'починенное уходит из списка ремонтника');
  await send('trade', 'baseServiceAction', { service: 'repair', action: 'repair', itemId: 'leather', requestId: 'repair-2' }, false);

  // --- сервис работает только рядом с собой -------------------------------
  await send('trade', 'baseServiceAction', { service: 'medic', action: 'state' }, false);
  await send('target', 'baseServiceAction', { service: 'repair', action: 'state' }, false);
  await send('trade', 'baseServiceAction', { service: 'tinker', action: 'state' }, false);

  console.log('Capital services network OK: one book across capitals without faction membership, cross-capital fills at the resting price, shelf payouts, repairman restores gear for marks, and every service needs its own NPC nearby.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
