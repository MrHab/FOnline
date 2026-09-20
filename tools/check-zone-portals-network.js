#!/usr/bin/env node
'use strict';

// Порталы зон (src/server/zone-portals.js) на настоящем сервере. Публичное
// событие, чья точка лежит в зоне, стоит в ней порталом у якоря событий:
// издалека он не пускает, вплотную — выдаёт билет в комнату события, а край
// этой комнаты выводит обратно к порталу. Угодья шире зоны: их следы стоят в
// каждой зоне внутри контура и ведут в разовую встречу из таблицы области.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { zoneRecipe, zoneById, zoneAtPoint } = require('../src/server/zone-graph');
const { loadZoneCatalog } = require('../src/server/zone-chunks');
const { buildZone } = require('../src/server/zone-builder');
const { zonePortals } = require('../src/server/zone-portals');
const { createPublicEvent, publicEventZone, normalizePublicEventCatalog } = require('../src/server/public-events');
const { normalizePveAreaCatalog, pveAreaZone } = require('../src/server/pve-areas');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const graph = readJson('data/kromka/zone-graph.json');
const catalog = loadZoneCatalog(path.join(root, 'data', 'zones'));
const globalMap = readJson('data/global-map.json');
const areas = normalizePveAreaCatalog(readJson('data/kromka/pve-areas.json')).areas;
const events = normalizePublicEventCatalog(readJson('data/kromka/public-events.json'));
const accounts = {};
const { world } = zoneWalk;
const size = graph.grid.zoneKm;
const centreOf = zone => ({ x: (zone.col + 0.5) * size, y: (zone.row + 0.5) * size });
const nodePoint = id => {
  const node = globalMap.nodes.find(row => (row.locationId || row.id) === id);
  return node ? { x: node.x, y: node.y } : null;
};
const areaZones = areas.map(area => pveAreaZone(area, nodePoint(area.locationId)));
const insideGrounds = zone => areaZones.some(row => Math.hypot(centreOf(zone).x - row.x, centreOf(zone).y - row.y) <= row.radius);

// Зона события — жёлтая, с якорями и вне угодий; зона следов — внутри контура угодий.
let eventZone = null;
let groundsZone = null;
const built = {};
for (const zone of graph.zones) {
  if (eventZone && groundsZone) break;
  // Города собирает свой конструктор — здесь нужны обычные зоны пустоши.
  if (zone.city) continue;
  const definition = buildZone(zoneRecipe(graph, zone.id), catalog);
  if (!(definition.zone.eventAnchors || []).length) continue;
  if (!eventZone && zone.mode === 'pvp' && !insideGrounds(zone)) { eventZone = zone; built[zone.id] = definition; }
  if (!groundsZone && insideGrounds(zone)) { groundsZone = zone; built[zone.id] = definition; }
}
assert(eventZone && groundsZone, 'the world has a yellow zone and a zone inside hunting grounds, both with event anchors');

const template = events.templates[0];
const event = createPublicEvent(template, { now: Date.now(), rules: events.rules, point: centreOf(eventZone), id: 'pubev_portal_check' });
const expected = (zone, worldZones) => zonePortals(zone.id, worldZones, {
  zoneIdAt: (x, y) => zoneAtPoint(graph, x, y)?.id || '',
  centre: centreOf(zone),
  anchors: built[zone.id].zone.eventAnchors,
  fallback: built[zone.id].entryFromWorld,
  locationExists: () => true
});
const eventPortal = expected(eventZone, [publicEventZone(event, events.rules), ...areaZones]).find(row => row.worldZoneId === event.id);
const groundsPortal = expected(groundsZone, [publicEventZone(event, events.rules), ...areaZones]).find(row => row.kind === 'grounds');
assert(eventPortal && groundsPortal, 'the portals are placed at event anchors');
const nearPortal = portal => { const point = world(portal); return { x: point.x + 1.2, z: point.z }; };

function seedEvent() {
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  saves.publicEvents = { version: 1, lastSpawnAt: Date.now(), startedAt: Date.now(), counter: 1, events: { [event.id]: event } };
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}

async function changeLocation(account, payload) {
  return h.socketAck(account.socket, 'changeLocation', { deviceType: 'desktop', controlType: 'keyboard_mouse', ...payload });
}

/** Дойти до края комнаты и выйти в зону: пробует четыре стороны, пока одна не выпустит. */
async function leaveByEdge(account, state, zoneId, tileWidth, tileDepth) {
  const halfX = tileWidth - 3;
  const halfZ = tileDepth - 3;
  for (const [x, z] of [[-halfX, state.z], [halfX, state.z], [state.x, -halfZ], [state.x, halfZ]]) {
    await zoneWalk.driveTo(h, account, state, x, z, 140);
    const left = await changeLocation(account, { locationId: zoneId });
    if (left.ok) return left;
  }
  return null;
}

(async () => {
  await h.bootstrapCharacters(accounts);
  seedEvent();
  zoneWalk.placeInZone(h, accounts, 'untargeted', eventZone.id, nearPortal(eventPortal));
  zoneWalk.placeInZone(h, accounts, 'harvest', eventZone.id, world(built[eventZone.id].entryFromWorld));
  zoneWalk.placeInZone(h, accounts, 'trade', groundsZone.id, nearPortal(groundsPortal));
  // Ключи собирает конструктор городов: ставим писаря на площадь, у доски работ.
  const keysCityDef = zoneWalk.cityDefinition('settlement');
  zoneWalk.placeInZone(h, accounts, 'progression', 'settlement', world(keysCityDef.cityPlan.board));

  await h.startServer();
  try {
    // --- портал события стоит в зоне его точки ------------------------------------------------
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    assert.equal(walker.join.locationId, eventZone.id);
    const shown = (walker.join.worldState?.portals || []).find(row => row.id === eventPortal.id);
    assert(shown, 'the zone shows the portal of the event in it: ' + JSON.stringify(walker.join.worldState?.portals || []).slice(0, 400));
    assert.deepEqual([shown.tx, shown.tz, shown.to], [eventPortal.tx, eventPortal.tz, event.locationId], 'the server places the portal at the same anchor');
    assert.equal(shown.targetZoneRules?.mode, 'pvpEvent', 'the portal carries the rules of the event room');
    console.log(`PASS the event "${event.displayName}" stands as a portal in zone ${eventZone.n}`);

    const stranger = accounts.harvest;
    await h.connectAndJoin(stranger);
    const far = await changeLocation(stranger, { locationId: event.locationId, portalId: eventPortal.id });
    assert.equal(far.ok, false, 'a portal does not let in from across the zone');
    assert.match(far.error, /Подойдите/);
    const forged = await changeLocation(stranger, { locationId: event.locationId, roomId: event.roomId });
    assert.equal(forged.ok, false, 'the event room is not entered without the portal');
    console.log('PASS the portal refuses from afar and the room refuses without it');

    // --- вход по билету и выход с края к порталу ----------------------------------------------------
    const entered = await changeLocation(walker, { locationId: event.locationId, portalId: eventPortal.id });
    assert(entered.ok, 'the portal lets in: ' + JSON.stringify(entered).slice(0, 300));
    assert.equal(entered.roomId, event.roomId, 'the portal leads into the room of the event');
    assert.equal(entered.worldState?.parentZone?.id, eventZone.id, 'the edge of the event room leads back to its zone');
    console.log(`PASS the portal leads into ${event.roomId}`);

    const eventLoc = readJson(`data/locations/${event.locationId}.json`);
    const state = { x: Number(entered.x), z: Number(entered.z) };
    const left = await leaveByEdge(walker, state, eventZone.id, eventLoc.map?.width ? eventLoc.map.width / 2 : 38, eventLoc.map?.depth ? eventLoc.map.depth / 2 : 38);
    assert(left, 'the edge of the event room leads out into the zone');
    assert.equal(left.locationId, eventZone.id);
    const portalPoint = world(eventPortal);
    assert(Math.hypot(Number(left.x) - portalPoint.x, Number(left.z) - portalPoint.z) <= 10,
      `the player comes out next to the portal: ${left.x},${left.z} vs ${portalPoint.x},${portalPoint.z}`);
    console.log('PASS the edge of the event room returns the player next to the portal');

    // --- следы угодий ведут в разовую встречу ---------------------------------------------------------
    const hunter = accounts.trade;
    await h.connectAndJoin(hunter);
    const trail = (hunter.join.worldState?.portals || []).find(row => row.id === groundsPortal.id);
    assert(trail && trail.kind === 'grounds' && /^Следы: /.test(trail.name), 'a zone inside the grounds shows their trail: ' + JSON.stringify(hunter.join.worldState?.portals || []).slice(0, 300));
    const encounter = await changeLocation(hunter, { locationId: trail.to, portalId: trail.id });
    assert(encounter.ok, 'the trail leads into an encounter: ' + JSON.stringify(encounter).slice(0, 300));
    assert.match(encounter.roomId, /#enc_/, 'the encounter is a room of its own');
    const area = areas.find(row => row.id === groundsPortal.areaId);
    assert(area.encounters.some(row => row.locationId === encounter.locationId), 'the scene comes from the encounter table of the area');
    assert.equal(encounter.worldState?.parentZone?.id, groundsZone.id, 'the encounter leads back into the zone it was entered from');
    console.log(`PASS the trail of ${area.displayName} leads into ${encounter.roomId}`);

    // --- быстрый подбор вылазки — у доски работ, а не откуда угодно -------------------------------
    const clerk = accounts.progression;
    await h.connectAndJoin(clerk);
    assert.equal(clerk.join.locationId, 'settlement');
    const elsewhere = await h.socketAck(clerk.socket, 'worldActivityQuickJoin', { boardSiteId: 'sluiceCity' });
    assert.equal(elsewhere.ok, false);
    assert.match(elsewhere.error, /у доски работ/, 'a board in another settlement does not pick an activity');
    const atBoard = await h.socketAck(clerk.socket, 'worldActivityQuickJoin', { boardSiteId: 'settlement' });
    assert(atBoard.ok || !/у доски работ/.test(atBoard.error || ''), 'the board of Keys picks an activity: ' + JSON.stringify(atBoard).slice(0, 200));
    console.log(`PASS the quick activity join works at the board of Keys (${atBoard.ok ? atBoard.taskId : atBoard.error}) and not at another settlement's`);

    // --- город — сектор целиком: из него выходят через край, а не по старой дороге --------------
    const keysCity = graph.zones.find(zone => zone.city === 'settlement');
    const keysNorth = zoneById(graph, keysCity.edges.north.to);
    const shownKeys = await new Promise((resolve, reject) => {
      require('node:http').get(h.baseUrl() + '/api/locations/settlement', res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => { try { resolve(JSON.parse(body).location); } catch (error) { reject(error); } });
      }).on('error', reject);
    });
    assert(!shownKeys.exit, 'a city built by the constructor has no old road out of the world');
    const openSides = Object.entries(keysCity.edges).filter(([, edge]) => edge.open).map(([dir]) => dir).sort();
    assert.deepEqual((shownKeys.sectorGates || []).map(gate => gate.side).sort(), openSides,
      'the city carries a gate for every open side: ' + JSON.stringify(shownKeys.sectorGates).slice(0, 300));
    assert.equal(shownKeys.sectorGates.find(gate => gate.side === 'north')?.to, keysNorth.id);
    const clerkState = { x: Number(clerk.join.self?.x ?? clerk.join.x ?? 0), z: Number(clerk.join.self?.z ?? clerk.join.z ?? 0) };
    // Улица от площади к северным воротам свободна по построению: по ней и выходим.
    assert(await zoneWalk.driveTo(h, clerk, clerkState, 1, -157, 700), 'the player walks to the north edge of Keys: ' + JSON.stringify(clerkState));
    const faraway = await changeLocation(clerk, { locationId: 'wasteland' });
    assert.equal(faraway.ok, false, 'the edge of a city does not carry the player across the world');
    const outOfKeys = await changeLocation(clerk, { locationId: keysNorth.id });
    assert(outOfKeys.ok && outOfKeys.locationId === keysNorth.id, 'the north edge of Keys leads into the sector north of it: ' + JSON.stringify(outOfKeys).slice(0, 200));
    console.log(`PASS the north edge of Keys leads into ${keysNorth.title}`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Zone portals network OK: an event stands as a portal in the zone of its point, lets in only up close, its room leads back to the portal, hunting-ground trails roll an encounter, and the job board picks an activity.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
