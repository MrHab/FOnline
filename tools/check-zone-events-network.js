#!/usr/bin/env node
'use strict';

// События мира в самих зонах, на настоящем сервере. Порталов к точкам мира у
// зон нет: публичное событие стоит в зоне своей точки у её точки событий —
// встреча и главарь, — видно игрокам зоны и по истечении уходит со сцены,
// оставляя игроков на месте; событие прежнего устройства (своя комната)
// переезжает в свою зону. В угодьях PvE-области встреча из таблицы области
// встаёт в зоне сама, подальше от игрока. Доска работ и ворота Ключей — как были.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { zoneById } = require('../src/server/zone-graph');
const { createZoneRuntime } = require('../src/server/zone-runtime');
const { createPublicEvent, normalizePublicEventCatalog } = require('../src/server/public-events');
const { normalizePveAreaCatalog, pveAreaZone } = require('../src/server/pve-areas');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const graph = readJson('data/kromka/zone-graph.json');
const zoneRuntime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data', 'zones'), normalize: row => row });
const servedZone = id => zoneRuntime.ensure({}, id);
const globalMap = readJson('data/global-map.json');
const areasSource = readJson('data/kromka/pve-areas.json');
const areas = normalizePveAreaCatalog(areasSource).areas;
const events = normalizePublicEventCatalog(readJson('data/kromka/public-events.json'));
// Встреча угодий — сразу и наверняка: проверка смотрит, где и как она встаёт.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-zone-events-'));
fs.writeFileSync(path.join(scratch, 'pve-areas.json'), JSON.stringify({
  ...areasSource, rules: { ...areasSource.rules, rollIntervalMs: 1000, rollChance: 1, calmAfterClearMs: 1000 }
}));
process.env.KROMKA_PVE_AREAS_FILE = path.join(scratch, 'pve-areas.json');
const accounts = {};
const { world } = zoneWalk;
const size = graph.grid.zoneKm;
const centreOf = zone => ({ x: (zone.col + 0.5) * size, y: (zone.row + 0.5) * size });
const nodePoint = id => {
  const node = globalMap.nodes.find(row => (row.locationId || row.id) === id);
  return node ? { x: node.x, y: node.y } : null;
};
const areaZones = areas.map(area => ({ area, zone: pveAreaZone(area, nodePoint(area.locationId)) }));
const groundsOf = zone => areaZones.find(row => Math.hypot(centreOf(zone).x - row.zone.x, centreOf(zone).y - row.zone.y) <= row.zone.radius) || null;

// Зона события — жёлтая, с точками событий и вне угодий; зона угодий — внутри контура.
let eventZone = null;
let groundsZone = null;
for (const zone of graph.zones) {
  if (eventZone && groundsZone) break;
  if (zone.city) continue;
  const definition = servedZone(zone.id);
  if (!(definition.zone?.eventAnchors || []).length) continue;
  if (!eventZone && zone.mode === 'pvp' && !groundsOf(zone)) eventZone = zone;
  if (!groundsZone && groundsOf(zone) && (definition.zone?.spawnAreas || []).length) groundsZone = zone;
}
assert(eventZone && groundsZone, 'the world has a yellow zone and a zone inside hunting grounds, both with event anchors');
const eventDef = servedZone(eventZone.id);
const groundsDef = servedZone(groundsZone.id);
const grounds = groundsOf(groundsZone).area;

// Событие прежнего устройства: своя комната шаблона, точка — середина зоны. Живёт недолго.
const template = events.templates[0];
const now = Date.now();
const event = createPublicEvent(template, { now, rules: events.rules, point: centreOf(eventZone), id: 'pubev_zone_check' });
event.warningAt = now + 20000;
event.expiresAt = now + 30000;
// Эта проверка смотрит истечение события, а не пятиминутное продление сундука
// после случайной зачистки отряда другими жителями зоны.
event.claimGraceGivenAt = now;
assert.notEqual(event.roomId, eventZone.id, 'the seeded event still points into its own room');
const anchors = eventDef.zone.eventAnchors.map(world);
const nearestAnchor = point => Math.min(...anchors.map(anchor => Math.hypot(point.x - anchor.x, point.z - anchor.z)));

function seedEvent() {
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  saves.publicEvents = { version: 1, lastSpawnAt: now, startedAt: now, counter: 1, events: { [event.id]: event } };
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}

async function changeLocation(account, payload) {
  return h.socketAck(account.socket, 'changeLocation', { deviceType: 'desktop', controlType: 'keyboard_mouse', ...payload });
}

/** Живые снимки канала: NPC, строки мира и событий. */
function watch(account) {
  const view = { enemies: new Map(), notices: [], eventStates: [] };
  for (const row of account.join.worldState?.enemies || []) view.enemies.set(row.id, row);
  account.socket.on('enemySnapshot', payload => { view.enemies = new Map((payload?.enemies || []).map(row => [row.id, row])); });
  account.socket.on('dangerCellNotice', payload => view.notices.push(String(payload?.text || '')));
  account.socket.on('publicEventState', payload => view.eventStates.push(payload || {}));
  return view;
}

async function until(label, probe, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`timed out: ${label}`);
}

(async () => {
  await h.bootstrapCharacters(accounts);
  seedEvent();
  // Игроки — поодаль от точки события: встреча у игрока под ногами не встаёт.
  zoneWalk.placeInZone(h, accounts, 'untargeted', eventZone.id, world(eventDef.entryFromWorld));
  zoneWalk.placeInZone(h, accounts, 'harvest', eventZone.id, world(eventDef.entryFromWorld));
  zoneWalk.placeInZone(h, accounts, 'trade', groundsZone.id, world(groundsDef.entryFromWorld));
  // Ключи собирает конструктор городов: ставим писаря на площадь, у доски работ.
  const keysCityDef = zoneWalk.cityDefinition('settlement');
  zoneWalk.placeInZone(h, accounts, 'progression', 'settlement', zoneWalk.cityWorld('settlement', keysCityDef.cityPlan.board));

  await h.startServer();
  try {
    // --- публичное событие стоит в своей зоне --------------------------------------------------------
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    const view = watch(walker);
    assert.equal(walker.join.locationId, eventZone.id);
    assert(!(walker.join.worldState?.portals || []).length, 'zones carry no portals to points of the world');
    assert.equal(walker.join.worldState?.publicEvent?.id, event.id, 'the zone shows the event that stands in it');
    assert.equal(walker.join.worldState?.publicEvent?.roomId, eventZone.id, 'the event of the old kind has moved into its zone');
    const boss = await until('the leader of the event stands at an event point of the zone', () =>
      [...view.enemies.values()].find(row => !row.dead && row.name === template.boss.displayName));
    assert(nearestAnchor(boss) <= 20, `the leader stands at an event point: ${Math.round(nearestAnchor(boss))} m off`);
    const crew = [...view.enemies.values()].filter(row => !row.dead && row.hostileToPlayer !== false && nearestAnchor(row) <= 30);
    assert(crew.length >= 3, `the encounter of the event stands around its point too: ${crew.length}`);
    const stranger = accounts.harvest;
    await h.connectAndJoin(stranger);
    const forged = await changeLocation(stranger, { locationId: event.locationId, roomId: `${event.locationId}#${event.id}` });
    assert.equal(forged.ok, false, 'the old room of the event is gone');
    console.log(`PASS the event "${event.displayName}" stands at an event point of ${eventZone.title}: its leader and ${crew.length} fighters, no portal`);

    await until('the event expires', async () => {
      if (view.eventStates.some(row => row.expired && row.id === event.id)) return true;
      const snapshot = await h.socketAck(walker.socket, 'requestWorldState', { reason: 'eventExpiry' });
      return snapshot.ok && snapshot.state && Object.hasOwn(snapshot.state, 'publicEvent')
        && snapshot.state.publicEvent?.id !== event.id;
    }, 45000);
    await until('its people leave the scene', () => ![...view.enemies.values()].some(row => !row.dead && row.name === template.boss.displayName));
    const still = await h.socketAck(walker.socket, 'requestWorldState', {});
    assert.equal(still?.worldState?.locationId || still?.locationId || walker.join.locationId, eventZone.id, 'the players stay in the zone when the event ends');
    console.log('PASS an expired event leaves the scene and the players stay in the zone');

    // --- встреча угодий встаёт в зоне сама ------------------------------------------------------------
    const hunter = accounts.trade;
    await h.connectAndJoin(hunter);
    const huntView = watch(hunter);
    assert(!(hunter.join.worldState?.portals || []).length, 'the grounds show no trail portal');
    const notice = await until('an encounter of the grounds comes up in the zone', () =>
      huntView.notices.find(text => text.startsWith(`${grounds.displayName}: неподалёку`)), 20000);
    const hunterPoint = world(groundsDef.entryFromWorld);
    await until('the encounter stands away from the player', () => {
      const actors = [...huntView.enemies.values()].filter(row => !row.dead && row.hostileToPlayer !== false);
      return actors.some(row => Math.hypot(row.x - hunterPoint.x, row.z - hunterPoint.z) >= 25);
    });
    console.log(`PASS ${grounds.displayName}: an encounter comes up in ${groundsZone.title} by itself ("${notice}")`);

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

    // --- город — сектор целиком: из него выходят порталом в проёме ворот, а не по старой дороге ---
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
    const portals = (shownKeys.transitions || []).filter(row => row.type === 'zoneGate' && row.crossing === 'portal');
    assert.deepEqual(portals.map(row => row.direction).sort(), openSides,
      'the city carries a gate portal for every open side: ' + JSON.stringify(portals).slice(0, 300));
    const northPortal = portals.find(row => row.direction === 'north');
    assert.equal(northPortal.to, keysNorth.id);
    const clerkState = { x: Number(clerk.join.self?.x ?? clerk.join.x ?? 0), z: Number(clerk.join.self?.z ?? clerk.join.z ?? 0) };
    // Улица от площади к северным воротам свободна по построению: по ней и выходим.
    const gate = zoneWalk.cityWorld('settlement', northPortal);
    assert(await zoneWalk.driveTo(h, clerk, clerkState, gate.x, gate.z - 2, 700), 'the player walks to the north gate of Keys: ' + JSON.stringify(clerkState));
    const faraway = await changeLocation(clerk, { locationId: 'wasteland' });
    assert.equal(faraway.ok, false, 'the gate of a city does not carry the player across the world');
    const outOfKeys = await changeLocation(clerk, { locationId: keysNorth.id });
    assert(outOfKeys.ok && outOfKeys.locationId === keysNorth.id, 'the north gate portal of Keys leads into the sector north of it: ' + JSON.stringify(outOfKeys).slice(0, 200));
    console.log(`PASS the north gate portal of Keys leads into ${keysNorth.title}`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Zone events network OK: events and encounters of the grounds stand in the zones themselves, with no portals; an event of the old kind moves into its zone and leaves the scene when it ends; the job board and the city gates work as before.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
