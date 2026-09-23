#!/usr/bin/env node
'use strict';

// Сетевая проверка рынков и сервисов столиц на настоящем сервере (изолированный
// DATA_DIR). Экономика v3: у каждой столицы своя книга — ордер одной столицы
// не виден в другой; налог 8% и сбор 2,5%; прежняя общая книга переезжает на
// полки владельцев; членство во фракции ничего не решает. Торгуют только
// торговцы-люди: аукционер «Покажи товары» не предлагает и торговать
// отказывается. Ремонтник чинит снаряжение за марки, а медик и он сам
// работают только рядом с собой.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const accounts = {};

const qty = (self, id) => (self.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);

// Сервисы расставлены tools/build-capital-services.js. Столицы — города-секторы:
// их собирает конструктор, поэтому координаты сервисов берутся у него, а базы
// Сердцевины остаются авторскими сценами.
const cityDefinition = require('./lib/zone-walk').cityDefinition;
const locations = {
  sluiceCity: cityDefinition('sluiceCity'),
  scrapTown: cityDefinition('scrapTown'),
  coreBaseUprava: JSON.parse(JSON.stringify(require('../data/locations/coreBaseUprava.json')))
};
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
  const noFaction = () => ({ version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] });

  // Продавец стоит в «Створе» между аукционером и ремонтником и НЕ состоит ни
  // в одной фракции Сердцевины: рынок обязан его принять.
  const sluiceAuction = servicePosition('sluiceCity', 'auction');
  const sellerState = stateFor('trade');
  sellerState.currentLocationId = 'sluiceCity';
  sellerState.serverLocationContext = { locationId: 'sluiceCity' };
  sellerState.territoryFaction = noFaction();
  sellerState.inventory.silver = 3000;
  sellerState.inventory.ammo9 = 60;
  sellerState.inventory.leather = 1;
  sellerState.player = {
    ...(sellerState.player || {}),
    // Состояния предметов сервер читает из state.player.itemConditions — они
    // приоритетнее одноимённого поля уровнем выше.
    itemConditions: { ...(sellerState.player?.itemConditions || {}), leather: 40 },
    x: sluiceAuction.x + 1.5,
    z: sluiceAuction.z + 1.5
  };

  // Покупатель в той же столице.
  const neighbourState = stateFor('harvest');
  neighbourState.currentLocationId = 'sluiceCity';
  neighbourState.serverLocationContext = { locationId: 'sluiceCity' };
  neighbourState.territoryFaction = noFaction();
  neighbourState.inventory.silver = 3000;
  neighbourState.player = { ...(neighbourState.player || {}), x: sluiceAuction.x, z: sluiceAuction.z - 2 };

  // Покупатель в другой столице, у другого аукционера.
  const scrapAuction = servicePosition('scrapTown', 'auction');
  const buyerState = stateFor('target');
  buyerState.currentLocationId = 'scrapTown';
  buyerState.serverLocationContext = { locationId: 'scrapTown' };
  buyerState.territoryFaction = noFaction();
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

  // Прежняя общая книга: у продавца стоит ордер на 5 патронов и 9 марок на полке.
  const now = Date.now();
  saves.market = {
    version: 3,
    counter: 1,
    orders: {
      lot_1: {
        id: 'lot_1', side: 'sell', itemId: 'ammo9', category: 'ammo', qty: 5, filled: 0, price: 7,
        ownerCharacterId: accounts.trade.characterId, ownerName: 'Продавец', records: [],
        createdAt: now - 1000, durationMs: 24 * 3600000, expiresAt: now + 24 * 3600000
      }
    },
    shelves: { [accounts.trade.characterId]: { silver: 9, items: [], sales: 1 } }
  };
  delete saves.markets;

  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  for (const role of ['trade', 'harvest', 'target', 'untargeted']) await h.connectAndJoin(accounts[role]);

  const send = async (role, event, data, ok = true) => {
    const response = await h.socketAck(accounts[role].socket, event, data);
    assert.equal(response.ok, ok, `${event}:${data.action} (${role}): ${JSON.stringify(response).slice(0, 400)}`);
    return response;
  };
  const market = (role, data, ok = true) => send(role, 'auctionAction', data, ok);
  // Сервисный NPC встаёт на свободный тайл рядом со своей точкой, а в городе это
  // может быть и несколько шагов в сторону: подходим к тому, кого видим.
  const walkToService = async (role, service) => {
    const actor = (accounts[role].join.worldState?.enemies || []).find(row => String(row?.service || '') === service);
    assert(actor, `${role}: рядом нет NPC сервиса ${service}`);
    const state = { x: Number(accounts[role].join.x), z: Number(accounts[role].join.z) };
    // Через площадь: напрямик путь упирается в дома и заборы участков.
    await zoneWalk.driveTo(h, accounts[role], state, 1, 1, 300);
    assert(await zoneWalk.driveTo(h, accounts[role], state, Number(actor.x) + 1.4, Number(actor.z) + 1.4, 460),
      `${role} дошёл до сервиса ${service}: ` + JSON.stringify(state));
    return state;
  };
  for (const role of ['trade', 'harvest', 'target', 'untargeted']) await walkToService(role, 'auction');

  // --- рынок столицы открыт без членства во фракции ---------------------
  const opened = await market('trade', { action: 'state' });
  assert.equal(opened.auction.marketId, 'sluiceCity', 'у каждой столицы своя книга');
  assert.equal(opened.auction.marketName, locations.sluiceCity.name);
  assert.equal(opened.auction.taxPct, 0.08);
  assert.equal(opened.auction.setupFeePct, 0.025);
  assert.deepEqual(opened.auction.durationChoicesHours, [24, 72, 168, 720]);
  assert(!('factionId' in opened.auction), 'снимок рынка не привязан к фракции');
  // Переезд общей книги: ордер снят, товар и марки ждут на полке.
  assert.equal(opened.auction.orders.length, 0, 'ордера общей книги сняты');
  assert.equal(opened.auction.shelf.silver, 9, 'марки общей полки переехали');
  assert.deepEqual(opened.auction.shelf.items.map(row => [row.itemId, row.qty]), [['ammo9', 5]],
    'выставленные патроны вернулись на полку');

  // --- ордер столицы виден только в ней -----------------------------------
  const wornSale = await market('trade', { action: 'sell', itemId: 'leather', qty: 1, price: 100, requestId: 'worn-sale' }, false);
  assert(/отремонтируйте/.test(wornSale.error));
  assert.equal(qty(wornSale.self, 'leather'), 1, 'Rejected worn equipment stays with its owner.');
  const listed = await market('trade', { action: 'sell', itemId: 'ammo9', qty: 20, price: 10, durationHours: 720, requestId: 'sell-1' });
  assert.equal(listed.restingQty, 20);
  assert.equal(listed.setupFee, 5, 'сбор 2,5% от 200');
  assert.equal(qty(listed.self, 'ammo9'), 40, 'выставленная пачка уходит из рюкзака');
  const orderId = listed.orderId;

  const fromScrapTown = await market('target', { action: 'state' });
  assert.equal(fromScrapTown.auction.marketId, 'scrapTown');
  assert(!fromScrapTown.auction.orders.some(row => row.id === orderId),
    'ордер «Створа» не виден в «Раздолье»: ' + JSON.stringify(fromScrapTown.auction.orders).slice(0, 300));
  await market('target', { action: 'buyNow', orderId, qty: 5, requestId: 'buynow-far' }, false);
  const fromCoreBase = await market('untargeted', { action: 'state' });
  assert(!fromCoreBase.auction.orders.some(row => row.id === orderId), 'и у аукционера базы Сердцевины его нет');

  // --- сделка в своей столице -----------------------------------------------
  const ammoBefore = qty(accounts.harvest.join.self, 'ammo9');
  const bought = await market('harvest', { action: 'buyNow', orderId, qty: 5, requestId: 'buynow-1' });
  assert.equal(bought.cost, 50);
  assert.equal(bought.tax, 4, 'налог 8% с 50');
  assert.equal(qty(bought.self, 'ammo9'), ammoBefore + 5);
  const sellerBook = await market('trade', { action: 'state' });
  assert.equal(sellerBook.auction.shelf.silver, 9 + 46, 'выручка продавца ждёт его на полке: цена минус налог');
  assert.equal(sellerBook.auction.orders.find(row => row.id === orderId).qty, 15, 'в книге остался остаток ордера');

  const crossing = await market('harvest', { action: 'buy', itemId: 'ammo9', qty: 15, price: 12, durationHours: 24, requestId: 'buy-1' });
  assert.equal(crossing.boughtQty, 15, 'встречный ордер забирает остаток продавца');
  assert.equal(crossing.spent, 150, 'исполнение идёт по цене того ордера, что стоял в книге');
  const afterCrossing = await market('trade', { action: 'state' });
  assert.equal(afterCrossing.auction.orders.length, 0, 'исполненный ордер уходит из книги');
  assert.equal(afterCrossing.auction.shelf.silver, 9 + 46 + 138, 'вторая выручка тоже на полке');

  const claimed = await market('trade', { action: 'claim', requestId: 'claim-1' });
  assert.equal(claimed.claimedSilver, 193);
  assert.equal(qty(claimed.self, 'ammo9'), 45, 'возвращённые патроны общей книги забраны');

  // Editing reserves and receipts is authoritative and idempotent over Socket.IO.
  const history = await market('trade', { action: 'state', itemId: 'ammo9' });
  assert.equal(history.auction.history[0].qty, 20);
  assert.equal(history.auction.history[0].average, 10);
  assert(history.auction.historySeries.some(row => row.qty === 20 && row.average === 10),
    'The item card receives chart points from completed local trades.');
  assert(history.auction.items.some(row => row.sellQty === 0 && row.buyQty === 0), 'Unlisted catalogue items can be selected.');
  assert(history.auction.activity.some(row => row.kind === 'sold'));
  assert.equal((await market('target', { action: 'state', itemId: 'ammo9' })).auction.history[0].qty, 0);
  const rest = await market('trade', { action: 'sell', itemId: 'ammo9', qty: 10, price: 20, requestId: 'edit-list' });
  await market('harvest', { action: 'update', orderId: rest.orderId, qty: 5, price: 10, requestId: 'edit-other' }, false);
  await market('trade', { action: 'update', orderId: rest.orderId, qty: 11, price: 10, requestId: 'edit-extra' }, false);
  const editRequest = { action: 'update', orderId: rest.orderId, qty: 6, price: 15, expectedPrice: 20, expectedQty: 10, requestId: 'edit-own' };
  const edit = await market('trade', editRequest);
  assert.equal(edit.setupFee, 2);
  assert.equal(qty(edit.self, 'silver'), qty(rest.self, 'silver') - 2);
  assert.equal(edit.auction.orders.find(row => row.id === rest.orderId).qty, 6);
  assert.equal(edit.auction.shelf.items.reduce((sum, row) => sum + row.qty, 0), 4);
  const replay = await market('trade', editRequest);
  assert.equal(qty(replay.self, 'silver'), qty(edit.self, 'silver'));
  assert.deepEqual(replay.auction.activity, edit.auction.activity, 'Replayed requests produce no duplicate receipt.');
  const stale = await market('harvest', { action: 'buyNow', orderId: rest.orderId, qty: 1, expectedPrice: 20, requestId: 'stale-price' }, false);
  assert(/изменилась/.test(stale.error), 'A confirmation at an old price must not execute at the edited price.');
  const legacyQuote = await market('harvest', { action: 'buyNow', orderId: rest.orderId, qty: 1, requestId: 'legacy-price' }, false);
  assert(/Обновите игру/.test(legacyQuote.error), 'Old clients cannot silently accept a new price after an edit.');
  const demand = await market('harvest', { action: 'buy', itemId: 'ammo9', qty: 4, price: 10, requestId: 'edit-demand' });
  const fill = await market('harvest', { action: 'update', orderId: demand.orderId, qty: 4, price: 20, requestId: 'edit-cross' });
  assert.equal(fill.restingQty, 0);
  assert.equal(fill.balanceDelta, 40 - 60 - 2);
  assert.equal(fill.auction.shelf.items.reduce((sum, row) => sum + row.qty, 0), 4);
  await market('trade', { action: 'cancel', orderId: rest.orderId, requestId: 'edit-cleanup' });

  const shelfOffer = await market('trade', { action: 'sell', itemId: 'ammo9', qty: 2, price: 25, requestId: 'shelf-offer' });
  const buyerBeforeShelf = qty(demand.self, 'ammo9');
  const shelfBuy = await market('harvest', { action: 'buyNow', orderId: shelfOffer.orderId,
    qty: 2, deliverToInventory: false, requestId: 'shelf-buy' });
  assert.equal(shelfBuy.shelved, 2, 'The chosen delivery destination is returned in the receipt.');
  assert.equal(qty(shelfBuy.self, 'ammo9'), buyerBeforeShelf, 'Buying to the shelf does not add weight to the backpack.');
  assert(shelfBuy.auction.shelf.items.some(row => row.itemId === 'ammo9' && row.qty === 2 && row.reason === 'bought'));

  // --- торгуют только торговцы-люди -----------------------------------------
  const scrapActors = accounts.target.join.worldState?.enemies || [];
  const merchant = scrapActors.find(row => row.role === 'merchant' && row.hostileToPlayer === false);
  const auctioneer = scrapActors.find(row => row.service === 'auction');
  assert(merchant?.tradeOpen === true, 'торговец столицы торгует: ' + JSON.stringify(merchant && { name: merchant.name, tradeOpen: merchant.tradeOpen }));
  assert(auctioneer && auctioneer.tradeOpen === false, 'аукционер «Покажи товары» не предлагает');
  // Облик и взгляд авторского НПС — из его строки: их задают в сцене Unity, и
  // клиент получает ровно их, а не выводит облик из id актёра, который новый
  // при каждом появлении.
  const auctionRow = locations.scrapTown.objects.find(row => row?.entity?.service === 'auction');
  assert.deepEqual(auctioneer.appearance, auctionRow.entity.appearance,
    'аукционер выглядит, как его одели в сцене: ' + JSON.stringify(auctioneer.appearance));
  assert(Math.abs(Number(auctioneer.activityFacing) - Number(auctionRow.rotation.y)) < 1e-3,
    `аукционер смотрит, как его повернули в сцене: ${auctioneer.activityFacing} против ${auctionRow.rotation.y}`);
  // Наряд — тоже из строки и ровно такой: пустой слот не добирается со склада фракции.
  for (const slot of ['weapon', 'armor', 'helmet', 'boots', 'backpack']) {
    assert.equal(auctioneer.equipment?.[slot] || '', auctionRow.entity.equipment[slot] || '',
      `аукционер одет, как в сцене (${slot}): ${JSON.stringify(auctioneer.equipment)}`);
  }
  assert(scrapActors.filter(row => row.hostileToPlayer === false && row.role === 'guard').every(row => row.tradeOpen === false),
    'охрана столицы не торгует');
  const refused = await send('target', 'syncNpcTradeState', { enemyId: auctioneer.id }, false);
  assert(/не торгует/.test(refused.error), 'сервер отказывает в торговле с аукционером: ' + refused.error);

  // --- ремонтник столицы --------------------------------------------------
  // Ремонтник живёт в мастерских, а не рядом с аукционером: идём к нему через город.
  await walkToService('trade', 'repair');
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

  console.log('Capital services network OK: a book per capital without faction membership, 8% tax and 2.5% fee, the shared book moved onto owner shelves, fills at the resting price, only human traders trade, repairman restores gear for marks, and every service needs its own NPC nearby.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
