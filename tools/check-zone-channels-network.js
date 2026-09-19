#!/usr/bin/env node
'use strict';

// Общие комнаты зон на настоящем сервере (предел канала в проверке — 2 игрока):
//  - третий вошедший попадает во второй канал той же зоны, `self.zone.channel`
//    говорит, в каком он; реконнект возвращает в свой канал, пока там есть место;
//  - прошедший ворота несколько секунд под щитом прибытия;
//  - пустая зона засыпает (комната уходит из памяти), а вскрытый в ней тайник
//    остаётся пустым после пробуждения;
//  - пауза ворот и щит прибытия: правила из server.js на поддельных игроках.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const assert = require('node:assert/strict');

process.env.KROMKA_ZONE_CHANNEL_CAP = '2';
process.env.KROMKA_ZONE_SLEEP_MS = '2000';
process.env.WASTELAND_SIM_TICK_MS = '1000';
const h = require('./check-combat-runtime');
const { zoneRecipe, zoneOfPlace } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
const accounts = {};
const zoneWalk = require('./lib/zone-walk');
const { world } = zoneWalk;
const placeInZone = (role, locationId, point) => zoneWalk.placeInZone(h, accounts, role, locationId, point);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- пауза ворот и щит прибытия: те же функции, что в server.js ---------------------------
{
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const piece = name => {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const constant = name => {
    const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
    assert(match, name);
    return `const ${name} = ${match[1]};`;
  };
  const context = vm.createContext({});
  vm.runInContext([constant('ZONE_ARRIVAL_SHIELD_MS'), constant('ZONE_GATE_PVP_PAUSE_MS'),
    piece('serverZoneArrivalShielded'), piece('serverZoneGatePvpPauseLeft'), piece('serverNotePvpExchange'),
    'this.api = { serverZoneArrivalShielded, serverZoneGatePvpPauseLeft, serverNotePvpExchange, ZONE_ARRIVAL_SHIELD_MS, ZONE_GATE_PVP_PAUSE_MS };'].join('\n'), context);
  const api = context.api;
  const now = 1_000_000;
  const shooter = { zoneArrivalShieldUntil: now + 3000 };
  const victim = {};
  assert.equal(api.serverZoneArrivalShielded(shooter, now), true, 'a fresh arrival is shielded');
  api.serverNotePvpExchange(shooter, victim, now);
  assert.equal(api.serverZoneArrivalShielded(shooter, now), false, 'shooting drops your own arrival shield');
  assert.equal(api.serverZoneGatePvpPauseLeft(shooter, now + 1000), api.ZONE_GATE_PVP_PAUSE_MS - 1000, 'the shooter waits at the gate');
  assert.equal(api.serverZoneGatePvpPauseLeft(victim, now + 1000), api.ZONE_GATE_PVP_PAUSE_MS - 1000, 'so does the one who was shot');
  assert.equal(api.serverZoneGatePvpPauseLeft(victim, now + api.ZONE_GATE_PVP_PAUSE_MS), 0, 'the pause ends');
  assert.equal(api.ZONE_ARRIVAL_SHIELD_MS, 4000);
  assert.equal(api.ZONE_GATE_PVP_PAUSE_MS, 6000);
  console.log('PASS a PvP exchange closes the gates for both sides for 6 s and drops the shooter\'s arrival shield');
}

// Ключи занимают свой сектор целиком: за домашнюю берём соседнюю с ними зону.
const home = graph.zones.find(zone => zone.id === zoneOfPlace(graph, 'settlement').edges.north.to);
const homeDef = buildZone(zoneRecipe(graph, home.id), catalog);
const northGate = homeDef.transitions.find(row => row.id === 'gate_north');
// Зона для сна: сосед Ключей с открытым тайником.
const quiet = ['east', 'west', 'south'].map(dir => home.edges[dir]?.to).filter(Boolean)
  // Город конструктор не собирает: его сектор — авторская сцена.
  .filter(id => !graph.zones.find(zone => zone.id === id)?.city)
  .map(id => buildZone(zoneRecipe(graph, id), catalog))
  .find(def => def.containers.some(row => !row.locked));
assert(quiet, 'a neighbour of the home zone has an unlocked cache');
const cache = quiet.containers.find(row => !row.locked);

const health = () => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + '/health', res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});

async function rejoin(role) {
  h.closeSocket(accounts[role]);
  await delay(700);
  await h.connectAndJoin(accounts[role]);
  return accounts[role].join;
}

(async () => {
  await h.bootstrapCharacters(accounts);
  const hub = world(homeDef.spawn);
  for (const [index, role] of ['untargeted', 'harvest', 'trade'].entries()) placeInZone(role, home.id, { x: hub.x + index * 2, z: hub.z + 4 });
  const gatePoint = world(northGate);
  placeInZone('target', home.id, { x: gatePoint.x, z: gatePoint.z + 2 });
  placeInZone('progression', quiet.id, world(cache));

  await h.startServer();
  try {
    // --- каналы ------------------------------------------------------------------------------
    await h.connectAndJoin(accounts.untargeted);
    await h.connectAndJoin(accounts.harvest);
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.untargeted.join.roomId, home.id);
    assert.equal(accounts.harvest.join.roomId, home.id, 'the first channel is the zone itself');
    assert.equal(accounts.harvest.join.self.zone.channel, 1);
    assert.equal(accounts.trade.join.roomId, `${home.id}#ch2`, 'a full zone opens a second channel');
    assert.equal(accounts.trade.join.locationId, home.id, 'the channel is the same zone');
    assert.equal(accounts.trade.join.self.zone.channel, 2);
    assert.equal(accounts.trade.join.self.zone.id, home.id);
    console.log(`PASS the third player in ${home.title} lands in its second channel`);

    let again = await rejoin('trade');
    assert.equal(again.roomId, `${home.id}#ch2`, 'reconnect keeps the channel');
    h.closeSocket(accounts.harvest);
    await delay(700);
    again = await rejoin('trade');
    assert.equal(again.roomId, `${home.id}#ch2`, 'the saved channel is kept while it has room');
    console.log('PASS reconnect returns a player to their own channel');

    // --- щит прибытия ---------------------------------------------------------------------------
    await h.connectAndJoin(accounts.target);
    const crossed = await h.socketAck(accounts.target.socket, 'changeLocation', { locationId: home.edges.north.to });
    assert(crossed.ok, 'the north gate opens: ' + JSON.stringify(crossed).slice(0, 300));
    const shield = Number(crossed.self.zone.arrivalShieldMs);
    assert(shield > 2500 && shield <= 4000, `a gate arrival is shielded for a few seconds (${shield} ms)`);
    assert.equal(Number(crossed.self.zone.gatePauseMs), 0);
    console.log(`PASS crossing a gate gives an arrival shield (${shield} ms left)`);

    // --- сон зоны: тайник не наполняется заново -------------------------------------------------
    await h.connectAndJoin(accounts.progression);
    assert.equal(accounts.progression.join.roomId, quiet.id);
    const box = (accounts.progression.join.worldState?.containers || []).find(row => row.defId === cache.id);
    assert(box, `the zone cache ${cache.id} reaches the client`);
    const opened = await h.socketAck(accounts.progression.socket, 'openWorldContainer', { id: box.id });
    assert(opened.ok && opened.container.loot.length > 0, 'the cache opens full: ' + JSON.stringify(opened).slice(0, 200));
    const taken = await h.socketAck(accounts.progression.socket, 'lootWorldContainer', { id: box.id, mode: 'all' });
    assert(taken.ok, 'the cache is looted: ' + JSON.stringify(taken).slice(0, 200));
    const awake = (await health()).locationRealities;
    h.closeSocket(accounts.progression);
    let asleep = awake;
    for (let i = 0; i < 40 && asleep >= awake; i += 1) {
      await delay(250);
      asleep = (await health()).locationRealities;
    }
    assert(asleep < awake, `the empty zone falls asleep (${awake} → ${asleep} rooms)`);
    await h.connectAndJoin(accounts.progression);
    assert.equal(accounts.progression.join.roomId, quiet.id, 'the zone wakes up for the returning player');
    const reopened = await h.socketAck(accounts.progression.socket, 'openWorldContainer', { id: box.id });
    assert(reopened.ok && reopened.container.empty === true && reopened.container.loot.length === 0,
      'a looted cache stays empty after the zone slept: ' + JSON.stringify(reopened).slice(0, 400));
    console.log(`PASS an empty zone sleeps (${awake} → ${asleep} rooms) and wakes with the looted cache still empty`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Zone channels network OK: channels past the soft cap, reconnect into your channel, arrival shield, gate pause after PvP, and zones that sleep without refilling their caches.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
