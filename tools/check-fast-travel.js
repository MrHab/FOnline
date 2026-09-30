#!/usr/bin/env node
'use strict';

// Проводник (src/server/fast-travel.js): в каждом городе фракции он бесплатно
// ведёт в любой другой такой город, но только налегке — без экипировки и с
// пустым рюкзаком (марки — счёт аккаунта и не мешают); из боя не уводит.
// Города — настоящие: из data/kromka/economy.json и графа зон. Сетевая часть
// проверяет и то, что клиент видит в записи проводника: человек в наряде и с
// услугой, по которой клиент открывает карту, — случайный вид мутанта снимал и то,
// и другое.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const travel = require('../src/server/fast-travel');
const { zoneOfPlace } = require('../src/server/zone-graph');

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const rules = travel.normalizeFastTravelRules(economy.fastTravel);
const capitals = economy.dangerCells.capitals.map(id => ({ locationId: id, name: id, zone: zoneOfPlace(graph, id) }));

assert.equal(capitals.length, 5, 'five faction cities');
// Город занимает свой сектор целиком: ворота соседей ведут прямо в него.
for (const row of capitals) assert(row.zone && row.zone.city === row.locationId, `${row.locationId} holds a sector of its own`);
assert.equal(rules.combatLockMs, economy.fastTravel.combatLockMs, 'the combat lock comes from economy.json');

const from = capitals[0];
const menu = travel.fastTravelDestinations(capitals, from.locationId);
assert.equal(menu.length, 4, 'a faction city leads to the four others');
assert(menu.every(row => !('fee' in row)), 'the road with the conductor is free');
assert(menu.every((row, i) => i === 0 || menu[i - 1].distanceKm <= row.distanceKm), 'nearer cities come first');
assert.deepEqual(travel.fastTravelDestinations(capitals, 'z_05_05'), [], 'no conductor outside a faction city');

const trip = extra => ({ rules, capitals, fromLocationId: from.locationId, toLocationId: menu[0].locationId, now: 1_000_000, equipment: [], cargo: [], ...extra });
assert.equal(travel.fastTravelRefusal(trip()), '', 'a light traveller goes between faction cities');
assert.match(travel.fastTravelRefusal(trip({ fromLocationId: 'settlement' })), /только в городах/);
assert.match(travel.fastTravelRefusal(trip({ toLocationId: 'settlement' })), /только в другой город/);
// «Баланс» — подземелье, а не город: проводника там нет и туда он не ведёт.
assert.match(travel.fastTravelRefusal(trip({ toLocationId: 'balanceBunker' })), /только в другой город/);
assert.match(travel.fastTravelRefusal(trip({ toLocationId: from.locationId })), /уже в этом городе/);
assert.match(travel.fastTravelRefusal(trip({ lastCombatAt: 1_000_000 - 2000 })), /Из боя проводник не уводит/);
assert.equal(travel.fastTravelRefusal(trip({ lastCombatAt: 1_000_000 - rules.combatLockMs - 1 })), '', 'the combat lock ends');
const worn = [{ slot: 'armor', id: 'leather', name: 'Куртка' }, { slot: 'boots', id: 'boots', name: 'Сапоги' }];
assert.equal(travel.fastTravelRefusal(trip({ equipment: worn })), 'Снимите экипировку («Куртка» и ещё 1): проводник ведёт только налегке.');
assert.match(travel.fastTravelRefusal(trip({ equipment: worn.slice(1) })), /«Сапоги»\): проводник/);
assert.match(travel.fastTravelRefusal(trip({ cargo: [{ id: 'scrap', qty: 3, name: 'Лом' }] })), /^Рюкзак должен быть пуст \(«Лом»\)/);
// Артефакт — такой же груз, как любой другой: его тоже несут через зоны ногами.
assert.match(travel.fastTravelRefusal(trip({ cargo: [{ id: 'artifactSpring', qty: 1, name: 'Пружина' }] })), /Рюкзак должен быть пуст/);
assert.equal(travel.fastTravelReadiness(trip({ equipment: worn, cargo: [{ id: 'scrap', qty: 1 }] })).startsWith('Снимите экипировку'), true,
  'the conductor names the gear first');

console.log(`Conductor rules OK: ${capitals.length} faction cities, ${menu[0].distanceKm}–${menu[menu.length - 1].distanceKm} km from ${from.locationId}, free, only without gear and with an empty pack, never out of combat.`);

// --- на настоящем сервере: проводник города ведёт в другой город ---------------------------------
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const accounts = {};
const NO_GEAR = { weapon: 'fists', offhand: '', armor: '', helmet: '', boots: '', backpack: '', detector: '', artifactBelt: '', vehicle: '' };

// Рядом с проводником: он стоит на площади города, в паре тайлов от её центра.
function nearConductor(locationId) {
  const plan = zoneWalk.cityDefinition(locationId).cityPlan;
  return zoneWalk.cityWorld(locationId, { tx: plan.dispatcher.tx + 3, tz: plan.dispatcher.tz + 2 });
}

/** Проводник в записи мира так, как её видит клиент. */
function conductorRow(worldState, where) {
  // Клиент открывает карту по услуге fastTravel в записи: у мутанта она пустела.
  const actor = (worldState?.enemies || []).find(row => row?.service === 'fastTravel');
  assert(actor, `${where} has a conductor the client can use: ` + (worldState?.enemies || []).map(row => `${row.name}/${row.service}`).join(', '));
  assert.equal(actor.name, 'Проводник', `${where}: the conductor is called Проводник`);
  assert.equal(actor.hostileToPlayer, false, `${where}: the conductor is friendly`);
  assert.equal(actor.creatureTypeId || '', '', `${where}: the conductor is a human, not ${actor.creatureTypeId}`);
  assert(actor.appearance && actor.appearance.sex, `${where}: the conductor has a face and hair`);
  assert.equal(actor.equipment?.armor, 'leather', `${where}: the conductor wears a jacket`);
  assert.equal(actor.equipment?.backpack, 'backpack', `${where}: the conductor carries a pack`);
  return actor;
}

/** Персонаж в городе: рюкзак и экипировка заданы целиком, а не дописаны к стартовому набору. */
function seed(role, locationId, state, point = nearConductor(locationId)) {
  zoneWalk.placeInZone(h, accounts, role, locationId, point);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const saved = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  saved.inventory = state.inventory;
  saved.equipment = state.equipment;
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}
const marks = self => (self?.inventory || []).filter(row => row.id === 'silver').reduce((sum, row) => sum + row.qty, 0);

async function walkUp(account) {
  const seen = conductorRow(account.join.worldState, account.join.locationId);
  const state = { x: Number(account.join.x), z: Number(account.join.z) };
  assert(await zoneWalk.driveTo(h, account, state, Number(seen.x) - 2, Number(seen.z), 60), 'the player walks up to the conductor: ' + JSON.stringify(state));
}

(async () => {
  await h.bootstrapCharacters(accounts);
  seed('trade', from.locationId, { inventory: { silver: 500 }, equipment: NO_GEAR });
  seed('progression', from.locationId, { inventory: { silver: 500, scrap: 2 }, equipment: NO_GEAR });
  seed('modification', from.locationId, { inventory: { silver: 500 }, equipment: { ...NO_GEAR, armor: 'leather' } });
  const spot = nearConductor(from.locationId);
  seed('harvest', from.locationId, { inventory: { silver: 500 }, equipment: NO_GEAR }, { x: spot.x - 20, z: spot.z });
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.trade.join.locationId, from.locationId);
    // Проводник стоит на площади города: подходим к нему настоящими шагами.
    await walkUp(accounts.trade);
    const list = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'list' });
    assert(list.ok && list.destinations.length === 4, 'the conductor shows the four other faction cities: ' + JSON.stringify(list).slice(0, 300));
    assert.equal(list.blocked, '', 'a light traveller is ready to go');
    const pick = list.destinations[0];
    const transfer = new Promise(resolve => accounts.trade.socket.once('serverWorldTransfer', resolve));
    const before = marks(accounts.trade.join.self);
    const went = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert(went.ok, 'the road goes: ' + JSON.stringify(went).slice(0, 300));
    const arrived = await transfer;
    assert.equal(arrived.reason, 'fastTravel');
    assert.equal(arrived.locationId, pick.locationId, 'the player lands in the destination city');
    assert.equal(marks(went.self), before, 'the road is free');
    conductorRow(arrived.worldState, pick.locationId);
    const again = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'go', to: from.locationId });
    assert.equal(again.ok, false, 'at the city gate there is no conductor to order from');
    console.log(`PASS the conductor leads a light traveller from ${from.locationId} to ${pick.locationId} for free`);

    await h.connectAndJoin(accounts.progression);
    await walkUp(accounts.progression);
    const loaded = await h.socketAck(accounts.progression.socket, 'fastTravel', { action: 'list' });
    assert(loaded.ok && loaded.destinations.length === 4, 'the map still shows the cities to a loaded traveller');
    assert.match(loaded.blocked, /Рюкзак должен быть пуст/, 'the map says why the road is closed before the click');
    const refused = await h.socketAck(accounts.progression.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /Рюкзак должен быть пуст \(«.+»\)/, 'a full pack stays in the city');
    assert.equal(marks(refused.self), 500, 'a refused road costs nothing');
    console.log('PASS a traveller with things in the pack is refused');

    await h.connectAndJoin(accounts.modification);
    await walkUp(accounts.modification);
    const dressed = await h.socketAck(accounts.modification.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert.equal(dressed.ok, false);
    assert.match(dressed.error, /Снимите экипировку/, 'worn gear stays in the city');
    console.log('PASS a traveller wearing gear is refused');

    await h.connectAndJoin(accounts.harvest);
    const fromAfar = await h.socketAck(accounts.harvest.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert.equal(fromAfar.ok, false);
    assert.match(fromAfar.error, /должен быть рядом/, 'nobody orders the road from across the city');
    console.log('PASS the conductor does not take an order from across the city');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Conductor network OK: a human conductor in the city shows the other faction cities and leads a light traveller there for free; a pack, worn gear or distance keep the player in place.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
