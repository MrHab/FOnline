#!/usr/bin/env node
'use strict';

// Зоны мира на настоящем сервере: зона — обычная общая локация, её ворота —
// локальные переходы через changeLocation. Персонаж, стоящий в зоне Ключей у
// северных ворот, переходит в соседнюю зону и оказывается у её южных ворот
// напротив тех, из которых вышел; издалека и в несоседнюю зону не пускает;
// реконнект и перезапуск сервера возвращают его в ту же зону на то же место.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
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
const driveTo = (account, state, x, z, maxFrames) => zoneWalk.driveTo(h, account, state, x, z, maxFrames);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const home = zoneOfPlace(graph, 'settlement');
const north = home.edges.north.to;
const east = home.edges.east.to;
const homeDef = buildZone(zoneRecipe(graph, home.id), catalog);
const northDef = buildZone(zoneRecipe(graph, north), catalog);
const northGate = homeDef.transitions.find(row => row.id === 'gate_north');
const southGateThere = northDef.transitions.find(row => row.id === 'gate_south');

const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (error) { reject(error); } });
  }).on('error', reject);
});

(async () => {
  await h.bootstrapCharacters(accounts);
  const gatePoint = world(northGate);
  placeInZone('untargeted', home.id, { x: gatePoint.x, z: gatePoint.z + 2 });
  placeInZone('harvest', north, world(northDef.entryFromWorld));
  const portal = homeDef.transitions.find(row => row.to === 'settlement');
  placeInZone('target', home.id, world(portal));

  await h.startServer();
  try {
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    assert.equal(walker.join.locationId, home.id, 'the saved zone is restored on join');
    assert.equal(walker.join.roomId, home.id, 'a zone is one shared room');
    const view = walker.join.self.zone;
    assert(view && view.id === home.id && view.n === home.n && view.title === home.title, 'self.zone names the zone: ' + JSON.stringify(view));
    assert(view.gates.some(gate => gate.dir === 'north' && gate.to === north), 'self.zone lists where the gates lead');
    console.log(`PASS a character saved in ${home.title} joins its shared room`);

    // --- определение зоны отдаётся по одной, общий список без зон ---------------------------
    const one = await getJson(`/api/locations/${home.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.json.location.generated, true);
    assert.equal(one.json.location.revision, homeDef.revision, 'the server builds the same zone as the constructor');
    assert(one.json.location.transitions.some(row => row.id === 'gate_north' && row.targetPvpMode), 'gates carry the rules of the zone behind them');
    const all = await getJson('/api/locations');
    assert(!Object.keys(all.json.locations).some(id => /^z_\d\d_\d\d$/.test(id)), 'the full catalogue does not carry zones');
    assert(all.json.locations.settlement, 'authored places are still listed');
    console.log('PASS the zone definition is served by id and kept out of the full catalogue');

    // --- ворота: только рядом и только к соседу ------------------------------------------------
    const farAway = await h.socketAck(walker.socket, 'changeLocation', { locationId: east });
    assert.equal(farAway.ok, false, 'the east gate is far away: ' + JSON.stringify(farAway).slice(0, 200));
    const notNeighbour = await h.socketAck(walker.socket, 'changeLocation', { locationId: 'z_03_03' });
    assert.equal(notNeighbour.ok, false, 'there is no gate to a zone that is not a neighbour');
    const crossed = await h.socketAck(walker.socket, 'changeLocation', { locationId: north });
    assert(crossed.ok, 'the north gate leads to the neighbour: ' + JSON.stringify(crossed).slice(0, 300));
    assert.equal(crossed.locationId, north);
    assert.equal(crossed.self.zone.id, north);
    const landing = world(northDef.entryFromSouth);
    assert(Math.hypot(crossed.x - landing.x, crossed.z - landing.z) < 3, `arrives at the south entry of the neighbour: ${crossed.x},${crossed.z} vs ${landing.x},${landing.z}`);
    assert(Math.abs(crossed.x - gatePoint.x) < 3, 'arrives straight opposite the gate it left by');
    console.log(`PASS the north gate leads into ${crossed.self.zone.title}, opposite the gate`);

    // Зона общая: второй персонаж в той же зоне стоит в той же комнате.
    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.roomId, crossed.roomId, 'everyone in a zone shares one room');
    h.closeSocket(accounts.harvest);

    // --- обратно пешком: до южных ворот и назад ------------------------------------------------
    const state = { x: crossed.x, z: crossed.z };
    const southPoint = world(southGateThere);
    assert(await driveTo(walker, state, southPoint.x, southPoint.z - 1), 'walked to the south gate: ' + JSON.stringify(state));
    const back = await h.socketAck(walker.socket, 'changeLocation', { locationId: home.id });
    assert(back.ok && back.locationId === home.id, 'the south gate leads back: ' + JSON.stringify(back).slice(0, 300));
    const homeLanding = world(homeDef.entryFromNorth);
    assert(Math.hypot(back.x - homeLanding.x, back.z - homeLanding.z) < 3, 'arrives at the north entry of the home zone');
    console.log('PASS walking to the far gate and crossing back lands at the matching entry');

    // --- реконнект и перезапуск: та же зона, то же место ---------------------------------------
    const before = { x: back.x, z: back.z };
    h.closeSocket(walker);
    await delay(400);
    await h.connectAndJoin(walker);
    assert.equal(walker.join.locationId, home.id, 'a reconnect keeps the zone');
    assert(Math.hypot(walker.join.x - before.x, walker.join.z - before.z) < 1.5, 'a reconnect keeps the position');
    h.closeSocket(walker);
    await delay(400);
    await h.stopServer();
    await h.startServer();
    await h.connectAndJoin(walker);
    assert.equal(walker.join.locationId, home.id, 'a server restart keeps the zone');
    assert.equal(walker.join.self.zone.id, home.id);
    assert(Math.hypot(walker.join.x - before.x, walker.join.z - before.z) < 1.5, 'a server restart keeps the position');
    console.log('PASS reconnect and server restart return the character to the same zone and spot');

    // --- места: портал из зоны в поселение, край поселения — обратно в его зону --------------
    const settler = accounts.target;
    await h.connectAndJoin(settler);
    assert.equal(settler.join.locationId, home.id);
    const into = await h.socketAck(settler.socket, 'changeLocation', { locationId: 'settlement' });
    assert(into.ok && into.locationId === 'settlement', 'the portal leads from the zone into Keys: ' + JSON.stringify(into).slice(0, 300));
    assert.equal(into.self.zone, null, 'inside a place there is no zone view');
    const keys = (await getJson('/api/locations/settlement')).json.location;
    assert.equal(keys.parentZone?.id, home.id, 'the place names the zone its edge leads to');
    assert.equal(keys.parentZone.entryKey, 'entryFromPlace_settlement');
    assert(keys.parentZone.targetZoneRules?.mode, 'the place carries the rules of the zone behind its edge');
    const inKeys = { x: into.x, z: into.z };
    const early = await h.socketAck(settler.socket, 'changeLocation', { locationId: home.id });
    assert.equal(early.ok, false, 'the zone opens only from the edge of the place');
    assert(await driveTo(settler, inKeys, 1, -31), 'walked to the edge of Keys: ' + JSON.stringify(inKeys));
    const out = await h.socketAck(settler.socket, 'changeLocation', { locationId: home.id });
    assert(out.ok && out.locationId === home.id, 'the edge of Keys leads into its zone: ' + JSON.stringify(out).slice(0, 300));
    const fromKeys = world(homeDef.entryFromPlace_settlement);
    assert(Math.hypot(out.x - fromKeys.x, out.z - fromKeys.z) < 3, 'leaving Keys lands at its entry point in the zone');
    const wrongZone = await h.socketAck(settler.socket, 'changeLocation', { locationId: 'z_03_03' });
    assert.equal(wrongZone.ok, false);
    console.log(`PASS the portal leads into Keys and the edge of Keys leads back into ${home.title}`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Zone walk network OK: zones are shared rooms, gates cross only to neighbours and land opposite, zone identity survives reconnect and restart, places open from their zone and their edge leads back into it.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
