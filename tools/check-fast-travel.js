#!/usr/bin/env node
'use strict';

// Перенос между столицами (src/server/fast-travel.js): цена растёт с расстоянием
// между зонами столиц, перенос только из столицы в другую столицу, из боя и с
// артефактами в рюкзаке не отправляют, без денег — тоже. Столицы — настоящие:
// из data/kromka/economy.json и графа зон.

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

assert.equal(capitals.length, 6, 'six faction capitals');
for (const row of capitals) assert(row.zone && row.zone.mode === 'peaceful', `${row.locationId} stands in a peaceful zone`);
assert(economy.fastTravel && rules.baseFee > 0 && rules.feePerKm > 0, 'the fees come from economy.json');

const from = capitals[0];
const menu = travel.fastTravelDestinations(rules, capitals, from.locationId);
assert.equal(menu.length, 5, 'a capital sends to the five others');
assert(menu.every(row => row.fee === Math.round(rules.baseFee + rules.feePerKm * row.distanceKm) || Math.abs(row.fee - (rules.baseFee + rules.feePerKm * row.distanceKm)) <= 1), 'the fee is base plus distance');
assert(menu[0].fee <= menu[menu.length - 1].fee, 'nearer capitals are cheaper');
assert.deepEqual(travel.fastTravelDestinations(rules, capitals, 'z_05_05'), [], 'no dispatcher outside a capital');

const trip = extra => ({ rules, capitals, fromLocationId: from.locationId, toLocationId: menu[0].locationId, silver: 10000, now: 1_000_000, cargo: [], ...extra });
assert.equal(travel.fastTravelRefusal(trip()), '', 'a paid trip between capitals goes');
assert.match(travel.fastTravelRefusal(trip({ fromLocationId: 'settlement' })), /только в столицах/);
assert.match(travel.fastTravelRefusal(trip({ toLocationId: 'settlement' })), /только между столицами/);
assert.match(travel.fastTravelRefusal(trip({ lastCombatAt: 1_000_000 - 2000 })), /Из боя не отправляют/);
assert.equal(travel.fastTravelRefusal(trip({ lastCombatAt: 1_000_000 - rules.combatLockMs - 1 })), '', 'the combat lock ends');
assert.match(travel.fastTravelRefusal(trip({ cargo: [{ id: 'artifactSpring', category: 'artifacts', name: 'Артефакт «Пружина»' }] })), /не перевозят/);
assert.equal(travel.fastTravelRefusal(trip({ cargo: [{ id: 'scrap', category: 'materials' }] })), '', 'ordinary cargo travels');
assert.match(travel.fastTravelRefusal(trip({ silver: menu[0].fee - 1 })), /стоит \d+ марок/);

console.log(`Fast travel OK: ${capitals.length} capitals, fees ${menu[0].fee}–${menu[menu.length - 1].fee} marks from ${from.locationId}, no trip out of combat, with artifacts in the pack or without the fee.`);

// --- на настоящем сервере: диспетчер Затворов отправляет в другую столицу ------------------------
const fsPath = require('node:path');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const accounts = {};

function seed(role, locationId, inventory) {
  zoneWalk.placeInZone(h, accounts, role, locationId, { x: 0, z: 0 });
  const users = JSON.parse(fs.readFileSync(fsPath.join(h.DATA_DIR, 'users.json')));
  const savesPath = fsPath.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const state = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  state.inventory = { ...(state.inventory || {}), ...inventory };
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}
const marks = self => (self?.inventory || []).filter(row => row.id === 'silver').reduce((sum, row) => sum + row.qty, 0);

(async () => {
  await h.bootstrapCharacters(accounts);
  seed('trade', from.locationId, { silver: 500 });
  seed('progression', from.locationId, { silver: 500, artifactSpring: 1 });
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.trade.join.locationId, from.locationId);
    const list = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'list' });
    assert(list.ok && list.destinations.length === 5, 'the dispatcher lists five capitals: ' + JSON.stringify(list).slice(0, 300));
    const pick = list.destinations[0];
    const transfer = new Promise(resolve => accounts.trade.socket.once('serverWorldTransfer', resolve));
    const before = marks(accounts.trade.join.self);
    const went = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert(went.ok, 'the paid trip goes: ' + JSON.stringify(went).slice(0, 300));
    const arrived = await transfer;
    assert.equal(arrived.reason, 'fastTravel');
    assert.equal(arrived.locationId, pick.locationId, 'the player lands in the destination capital');
    assert.equal(marks(went.self), before - pick.fee, `the fee of ${pick.fee} marks is paid`);
    const again = await h.socketAck(accounts.trade.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert.equal(again.ok, false, 'a repeated order does not charge twice');
    console.log(`PASS the dispatcher sends a player from ${from.locationId} to ${pick.locationId} for ${pick.fee} marks`);

    await h.connectAndJoin(accounts.progression);
    const refused = await h.socketAck(accounts.progression.socket, 'fastTravel', { action: 'go', to: pick.locationId });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /не перевозят/, 'an artifact in the pack stays on the road');
    assert.equal(marks(refused.self), 500, 'a refused trip costs nothing');
    console.log('PASS an artifact in the pack is refused and nothing is charged');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Fast travel network OK: the capital dispatcher lists the other capitals, charges the fee once and moves the player; artifacts do not travel.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
