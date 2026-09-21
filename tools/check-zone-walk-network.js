#!/usr/bin/env node
'use strict';

// Зоны мира на настоящем сервере: зона — обычная общая локация, её ворота —
// локальные переходы через changeLocation. Город занимает сектор целиком: южные
// ворота соседней зоны вводят прямо в Ключи, а край Ключей возвращает в неё же;
// издалека и в несоседний сектор не пускает; реконнект и перезапуск сервера
// возвращают персонажа туда же. Портал места и его край проверяются на «Заставе 17».

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const { zoneById, zoneRecipe, zoneOfPlace } = require('../src/server/zone-graph');
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

// Город Ключи занимает свой сектор; ходим из зоны к северу от него.
const city = zoneOfPlace(graph, 'settlement');
const home = zoneById(graph, city.edges.north.to);
const east = home.edges.east.to;
// Сектор берётся из своего файла: закреплённый в сцене мир живёт им, а
// конструктор остаётся первой раскладкой для ещё не закреплённого сектора.
const sectorDefinition = id => {
  const file = path.join(root, 'data', 'zones', 'authored', `${id}.json`);
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : buildZone(zoneRecipe(graph, id), catalog);
};
const homeDef = sectorDefinition(home.id);
const cityGate = homeDef.transitions.find(row => row.id === 'gate_south');
// Место с порталом: «Застава 17» стоит в секторе южнее города.
const outpostZone = zoneOfPlace(graph, 'roadOutpost');
const outpostDef = sectorDefinition(outpostZone.id);

const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (error) { reject(error); } });
  }).on('error', reject);
});

(async () => {
  await h.bootstrapCharacters(accounts);
  const gatePoint = world(cityGate);
  placeInZone('untargeted', home.id, { x: gatePoint.x, z: gatePoint.z - 2 });
  placeInZone('harvest', 'settlement', { x: 0, z: -22 });
  const portal = outpostDef.transitions.find(row => row.to === 'roadOutpost');
  placeInZone('target', outpostZone.id, world(portal));

  await h.startServer();
  try {
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    assert.equal(walker.join.locationId, home.id, 'the saved zone is restored on join');
    assert.equal(walker.join.roomId, home.id, 'a zone is one shared room');
    const view = walker.join.self.zone;
    assert(view && view.id === home.id && view.n === home.n && view.title === home.title, 'self.zone names the zone: ' + JSON.stringify(view));
    assert(view.gates.some(gate => gate.dir === 'south' && gate.to === 'settlement' && gate.title === city.title),
      'the gate into a city names the city itself: ' + JSON.stringify(view.gates));
    console.log(`PASS a character saved in ${home.title} joins its shared room`);

    // --- определение зоны отдаётся по одной, общий список без зон ---------------------------
    const one = await getJson(`/api/locations/${home.id}`);
    assert.equal(one.status, 200);
    // Сектор разложен в свою сцену: клиент грузит её, а не собирает объекты
    // заново, а ревизия идёт от содержимого файла — правка в Unity меняет её
    // для клиентов.
    assert.equal(one.json.location.generated, false, 'a sector laid into its scene is not assembled at runtime');
    assert.equal(one.json.location.unityScene, `Assets/Scenes/Kromka/Locations/${home.id}.unity`,
      'the sector names its own scene');
    assert.match(String(one.json.location.revision), /^f-[0-9a-f]{8}$/, 'the sector revision follows its file');
    assert(one.json.location.transitions.some(row => row.id === 'gate_south' && row.targetPvpMode), 'gates carry the rules of the sector behind them');
    const all = await getJson('/api/locations');
    assert(!Object.keys(all.json.locations).some(id => /^z_\d\d_\d\d$/.test(id)), 'the full catalogue does not carry zones');
    assert(!all.json.locations.settlement, 'a city sector is as heavy as a zone and is served by id too');
    assert(all.json.locations.roadOutpost, 'authored places are still listed');
    console.log('PASS the zone definition is served by id and kept out of the full catalogue');
    const overview = (await getJson('/api/world-map')).json.map;
    assert.equal(overview.zones.length, graph.zones.length, 'the world map lists every zone');
    const mine = overview.zones.find(row => row.id === home.id);
    assert(mine && mine.gates.includes('s'), 'the world map shows open gates: ' + JSON.stringify(mine));
    const cityRow = overview.zones.find(row => row.id === 'settlement');
    assert(cityRow && cityRow.city === 'settlement' && cityRow.title === city.title && !cityRow.places.length,
      'a city fills its own cell of the world map: ' + JSON.stringify(cityRow));
    const outpostRow = overview.zones.find(row => row.id === outpostZone.id);
    assert(outpostRow.places.some(place => place.id === 'roadOutpost'), 'places of a wasteland sector are listed');
    assert.equal(overview.capitals.length, 6, 'the six capitals are marked');
    console.log(`PASS the world map serves ${overview.zones.length} sectors, cities among them, with gates and places`);

    // --- ворота: только рядом и только к соседу ------------------------------------------------
    const farAway = await h.socketAck(walker.socket, 'changeLocation', { locationId: east });
    assert.equal(farAway.ok, false, 'the east gate is far away: ' + JSON.stringify(farAway).slice(0, 200));
    const notNeighbour = await h.socketAck(walker.socket, 'changeLocation', { locationId: 'z_03_03' });
    assert.equal(notNeighbour.ok, false, 'there is no gate to a zone that is not a neighbour');
    const hints = [];
    walker.socket.on('dangerCellNotice', payload => { if (payload?.hint) hints.push(payload.hint); });
    const crossed = await h.socketAck(walker.socket, 'changeLocation', { locationId: 'settlement' });
    assert(crossed.ok, 'the south gate leads straight into the city: ' + JSON.stringify(crossed).slice(0, 300));
    assert.equal(crossed.locationId, 'settlement', 'a city sector is entered as the city itself');
    assert.equal(crossed.self.zone.id, 'settlement');
    assert.equal(crossed.self.zone.title, city.title, 'self.zone names the city');
    const keysDefinition = (await getJson('/api/locations/settlement')).json.location;
    // Город тоже разложен в свою сцену; план города при этом остаётся: по нему
    // живут участки, банк и ворота.
    assert.equal(keysDefinition.generated, false, 'a city laid into its scene is not assembled at runtime');
    assert.equal(keysDefinition.cityAuthored, true, 'the city is served from its own file');
    assert(keysDefinition.cityPlan?.bank?.rect, 'the city plan names the bank');
    const landing = zoneWalk.cityWorld('settlement', keysDefinition.entryFromNorth);
    assert(Math.hypot(crossed.x - landing.x, crossed.z - landing.z) < 6,
      `arrives at the north side of the city: ${crossed.x},${crossed.z} vs ${landing.x},${landing.z}`);
    const wall = keysDefinition.cityPlan.wall;
    assert(keysDefinition.entryFromNorth.tz > wall.min && keysDefinition.entryFromNorth.tz < wall.max,
      'the arrival stands inside the city wall: ' + JSON.stringify(keysDefinition.entryFromNorth));
    console.log(`PASS the south gate leads straight into ${crossed.self.zone.title}, inside its wall`);

    // Город общий, как и зона: второй персонаж в нём стоит в той же комнате.
    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.roomId, crossed.roomId, 'everyone in a city shares one room');
    h.closeSocket(accounts.harvest);

    // --- обратно пешком: к северному краю города и назад в зону ---------------------------------
    // Улица от северных ворот к площади свободна по построению: идём по ней наружу.
    const state = { x: crossed.x, z: crossed.z };
    const cityEdge = zoneWalk.cityEdge('settlement', 'north');
    assert(await driveTo(walker, state, cityEdge.x, cityEdge.z, 420), 'walked to the north edge of the city: ' + JSON.stringify(state));
    const back = await h.socketAck(walker.socket, 'changeLocation', { locationId: home.id });
    assert(back.ok && back.locationId === home.id, 'the north edge of the city leads back into the zone: ' + JSON.stringify(back).slice(0, 300));
    const homeLanding = world(homeDef.entryFromSouth);
    assert(Math.hypot(back.x - homeLanding.x, back.z - homeLanding.z) < 3, 'arrives at the south entry of the home zone');
    console.log('PASS walking to the edge of the city crosses back into the neighbouring sector');
    await delay(300);
    assert.deepEqual(hints, ['zoneGates', 'worldMap'], 'the first gate teaches gates and the world map once: ' + JSON.stringify(hints));
    console.log('PASS the first gate crossing shows the gate and world map hints once');

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

    // --- места: портал из зоны на «Заставу 17», её край — обратно в ту же зону ----------------
    const settler = accounts.target;
    await h.connectAndJoin(settler);
    assert.equal(settler.join.locationId, outpostZone.id);
    const into = await h.socketAck(settler.socket, 'changeLocation', { locationId: 'roadOutpost' });
    assert(into.ok && into.locationId === 'roadOutpost', 'the portal leads from the zone into the outpost: ' + JSON.stringify(into).slice(0, 300));
    assert.equal(into.self.zone, null, 'inside a place there is no zone view');
    const outpost = (await getJson('/api/locations/roadOutpost')).json.location;
    assert.equal(outpost.parentZone?.id, outpostZone.id, 'the place names the zone its edge leads to');
    assert.equal(outpost.parentZone.entryKey, 'entryFromPlace_roadOutpost');
    assert(outpost.parentZone.targetZoneRules?.mode, 'the place carries the rules of the zone behind its edge');
    const inside = { x: into.x, z: into.z };
    const early = await h.socketAck(settler.socket, 'changeLocation', { locationId: outpostZone.id });
    assert.equal(early.ok, false, 'the zone opens only from the edge of the place');
    // У заставы нет старой дороги «в мир», поэтому нужен сам край: полоса в два тайла.
    assert(await driveTo(settler, inside, 1, -34), 'walked to the edge of the outpost: ' + JSON.stringify(inside));
    const out = await h.socketAck(settler.socket, 'changeLocation', { locationId: outpostZone.id });
    assert(out.ok && out.locationId === outpostZone.id, 'the edge of the outpost leads into its zone: ' + JSON.stringify(out).slice(0, 300));
    const fromOutpost = world(outpostDef.entryFromPlace_roadOutpost);
    assert(Math.hypot(out.x - fromOutpost.x, out.z - fromOutpost.z) < 3, 'leaving the outpost lands at its entry point in the zone');
    const wrongZone = await h.socketAck(settler.socket, 'changeLocation', { locationId: 'z_03_03' });
    assert.equal(wrongZone.ok, false);
    console.log(`PASS the portal leads into the outpost and its edge leads back into ${outpostZone.title}`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Zone walk network OK: zones are shared rooms, gates cross only to neighbours and land opposite, a city sector is entered as the city itself, zone identity survives reconnect and restart, places open from their zone and their edge leads back into it.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
