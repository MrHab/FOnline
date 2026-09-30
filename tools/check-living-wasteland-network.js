#!/usr/bin/env node
'use strict';

// Живая пустошь на настоящем сервере: путники A-Life (караваны, дозоры) и
// стычки групп без игроков.
//  - у каждого города свой дозор тракта: мир получает их сразу;
//  - караван, идущий через зону с игроком, стоит на своей дороге, идёт шагом к
//    воротам следующей зоны маршрута и уходит только в них; на игрока не нападает;
//  - в соседней зоне с игроком караван входит воротами той стороны, откуда шёл,
//    и игрок видит, кто идёт;
//  - враждебные группы в зоне без игроков сходятся в стычке; пришедший игрок
//    видит павших телами с мешками — в первом своём канале, а не в каждом.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const DEV_TOKEN = 'living-wasteland-network-check-0123456789ab';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
process.env.KROMKA_ZONE_CHANNEL_CAP = '1';
const h = require('./check-combat-runtime');
const { zoneOfPlace, zoneById } = require('../src/server/zone-graph');
const { createZoneRuntime } = require('../src/server/zone-runtime');
const zoneWalk = require('./lib/zone-walk');
const { world } = zoneWalk;
const accounts = {};
const placeInZone = (role, locationId, point) => zoneWalk.placeInZone(h, accounts, role, locationId, point);

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const zoneRuntime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data', 'zones'), normalize: row => row });
const servedZone = id => zoneRuntime.ensure({}, id);
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-living-wasteland-'));
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({
  tickSeconds: 1,
  maxGroups: 60,
  woundHealPerMinute: 0,
  lairs: { capacity: { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  // Стычка без игроков — за считаные секунды; проверка смотрит на её след.
  roam: { restMinutes: [60, 60], stepSeconds: [600, 600], huntStepSeconds: [1, 1], senseSeconds: 3600, radius: 1, clashPerMinute: 60, clashCooldownMinutes: 30 },
  species: [
    { id: 'test_raiders', name: 'Банда налётчиков', kind: 'raider', faction: 'raiders',
      members: [{ type: 'raider', name: 'Налётчик', min: 4, max: 4, equipment: { weapon: 'pistol', armor: 'leather' } }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, perceptionCells: 0, aggression: 1, fleeAt: 0.9 },
    { id: 'test_gari', name: 'Стая гари', kind: 'monster', faction: 'gari',
      members: [{ type: 'gari', name: 'Гарь', min: 3, max: 3 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, perceptionCells: 0, aggression: 1, fleeAt: 0.9 },
    { id: 'test_caravan', name: 'Караван', kind: 'traveller', faction: 'tract_league',
      members: [
        { type: 'caravan_guard', role: 'guard', name: 'Охранник каравана', min: 3, max: 3, equipment: { weapon: 'rifle', armor: 'ballisticVest' } },
        { type: 'porter', role: 'civilian', name: 'Носильщик', min: 1, max: 1, equipment: { backpack: 'backpack' } }
      ],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0, fleeAt: 0.9, stepSeconds: [390, 390],
      travel: { mode: 'caravan', count: 0, restMinutes: [60, 60] } },
    { id: 'test_patrol', name: 'Дозор тракта', kind: 'traveller', faction: 'tract_league',
      members: [{ type: 'patrol_guard', role: 'guard', name: 'Дозорный', min: 3, max: 3 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0.8, stepSeconds: [390, 390],
      travel: { mode: 'patrol', count: 1, restMinutes: [60, 60], respawnMinutes: 60 } }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Дорога каравана: из Ключей на север, через зону у ворот города и дальше.
const keys = zoneOfPlace(graph, 'settlement');
const road = zoneById(graph, keys.edges.north.to);
const roadDef = servedZone(road.id);
const next = zoneById(graph, road.edges.north.to);
const nextDef = servedZone(next.id);
const beyond = zoneById(graph, next.edges.north.to);
assert(road && next && beyond && !road.city && !next.city, 'the road north of Keys runs through open zones');
const cities = graph.zones.filter(zone => zone.city);
// Поле боя — жёлтая зона вдали от дороги каравана.
const field = graph.zones.find(zone => zone.mode === 'pvp' && !zone.city && Math.abs(zone.col - road.col) + Math.abs(zone.row - road.row) > 4);
const fieldDef = servedZone(field.id);

const devGet = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, { headers: { 'x-dev-token': DEV_TOKEN } }, res => {
    let text = '';
    res.on('data', chunk => { text += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(text)); } catch (error) { reject(new Error(`${res.statusCode} ${text.slice(0, 200)}`)); }
    });
  }).on('error', reject);
});
async function groupNear(id, zone, radius = 2) {
  const view = await devGet(`/api/dev/danger-ecology?sx=${zone.col}&sy=${zone.row}&radius=${radius}`);
  assert(view.active, 'A-Life is on');
  return view.near.find(row => row.id === id) || null;
}
async function waitFor(label, probe, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`timed out: ${label}`);
}
const actorsIn = (row, roomId) => (row?.actors || []).filter(actor => actor.roomId === roomId && !actor.dead);

/** Живые снимки канала: NPC, контейнеры, строки A-Life. */
function watch(account) {
  const view = { enemies: new Map(), containers: new Map(), notices: [] };
  for (const row of account.join.worldState?.enemies || []) view.enemies.set(row.id, row);
  for (const row of account.join.worldState?.containers || []) view.containers.set(row.id, row);
  account.socket.on('enemySnapshot', payload => { view.enemies = new Map((payload?.enemies || []).map(row => [row.id, row])); });
  account.socket.on('worldContainersSnapshot', payload => { view.containers = new Map((payload?.containers || []).map(row => [row.id, row])); });
  account.socket.on('dangerCellNotice', payload => view.notices.push(String(payload?.text || '')));
  return view;
}

(async () => {
  await h.bootstrapCharacters(accounts);
  placeInZone('untargeted', road.id, world(roadDef.spawn));
  placeInZone('harvest', next.id, world(nextDef.spawn));
  placeInZone('trade', field.id, world(fieldDef.spawn));
  placeInZone('target', field.id, world(fieldDef.spawn));

  const far = Date.now() + 3600000;
  const now = Date.now();
  const members = (type, count, name, maxHp) => Array.from({ length: count }, (_, i) => ({ id: `m${i + 1}`, type, spec: 0, name, hp: maxHp, maxHp }));
  const resting = (id, speciesId, zone, list) => ({
    id, speciesId, lairId: '', sx: zone.col, sy: zone.row, members: list, state: 'rest', target: null,
    restUntil: far, nextStepAt: far, shakenUntil: 0, size0: list.length, bornAt: 0
  });
  // Караван уже почти прошёл зону у Ключей: до ворот на север ему считаные метры.
  const caravan = {
    id: 'caravan', speciesId: 'test_caravan', lairId: '', sx: road.col, sy: road.row, state: 'travel', target: null,
    members: [
      ...members('caravan_guard', 3, 'Охранник каравана', 55).map(row => ({ ...row, spec: 0 })),
      { id: 'm4', type: 'porter', spec: 1, name: 'Носильщик', hp: 55, maxHp: 55 }
    ],
    restUntil: 0, nextStepAt: now + 20000, shakenUntil: 0, size0: 4, bornAt: 0,
    home: 'settlement', dest: '', routeIndex: 1, fleeing: false,
    route: [keys, road, next, beyond].map(zone => ({ sx: zone.col, sy: zone.row }))
  };
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
    version: 1, mapRevision: 'check', nextId: 50, lairs: [],
    groups: [
      caravan,
      resting('band', 'test_raiders', field, members('raider', 4, 'Налётчик', 55)),
      resting('pack', 'test_gari', field, members('gari', 3, 'Гарь', 39))
    ]
  }));

  await h.startServer();
  try {
    // --- дозоры тракта ------------------------------------------------------------------------------
    await waitFor('every city sends out its road patrol', async () => {
      const summary = (await devGet(`/api/dev/danger-ecology?sx=${road.col}&sy=${road.row}&radius=0`)).summary;
      return summary.bySpecies.test_patrol?.groups === cities.length;
    });
    console.log(`PASS every one of ${cities.length} cities has its road patrol at once`);

    // --- стычка без игроков -------------------------------------------------------------------------
    const clash = await waitFor('the band and the pack clash in a zone without players', async () => {
      const band = await groupNear('band', field, 0);
      const pack = await groupNear('pack', field, 0);
      const lost = (4 - (band?.members.length || 0)) + (3 - (pack?.members.length || 0));
      return lost > 0 ? { band, pack, lost } : null;
    });
    console.log(`PASS raiders and gari clash in ${field.title} without players: ${clash.lost} fallen`);

    // --- караван через зону с игроком ------------------------------------------------------------------
    await h.connectAndJoin(accounts.untargeted);
    await h.connectAndJoin(accounts.harvest);
    const onRoad = watch(accounts.untargeted);
    const ahead = watch(accounts.harvest);
    const gate = (roadDef.transitions || []).find(row => row.type === 'zoneGate' && row.direction === 'north');
    const gatePoint = world(gate);
    const entry = world(roadDef.entryFromSouth);
    const standing = await waitFor('the caravan stands on its road in the zone with a player', async () => {
      const row = await groupNear('caravan', road, 1);
      const actors = actorsIn(row, road.id);
      return actors.length === 4 ? actors : null;
    });
    for (const actor of standing) {
      assert.equal(actor.phase, 'transit', 'the caravan walks through the zone');
      assert(Math.hypot(actor.x - gatePoint.x, actor.z - gatePoint.z) < Math.hypot(entry.x - gatePoint.x, entry.z - gatePoint.z) - 100,
        `a caravan near the end of its crossing stands close to the north gate: ${actor.x},${actor.z}`);
    }
    const people = [...onRoad.enemies.values()].filter(row => !row.dead && row.faction === 'tract_league');
    assert(people.length >= 4 && people.every(row => row.hostileToPlayer === false), 'caravan people are not hostile to the player: '
      + JSON.stringify(people.map(row => [row.name, row.hostileToPlayer])));
    let lastSeen = null;
    await waitFor('the caravan walks out through the north gate', async () => {
      const row = await groupNear('caravan', road, 1);
      const actors = actorsIn(row, road.id);
      if (actors.length) {
        lastSeen = actors;
        return null;
      }
      return row;
    }, 90000);
    for (const actor of lastSeen) {
      assert(Math.hypot(actor.x - gatePoint.x, actor.z - gatePoint.z) <= 8,
        `a caravan leaves the scene only in the gate: last seen ${Math.round(Math.hypot(actor.x - gatePoint.x, actor.z - gatePoint.z))} m from it`);
    }
    const moved = await waitFor('the caravan is in the next zone of its route', async () => {
      const row = await groupNear('caravan', next, 1);
      return row && row.sx === next.col && row.sy === next.row && actorsIn(row, next.id).length === 4 ? row : null;
    });
    assert.equal(moved.state, 'travel', 'the caravan is still on its way');
    const nextEntry = world(nextDef.entryFromSouth);
    for (const actor of actorsIn(moved, next.id)) {
      assert.equal(actor.phase, 'transit');
      assert(Math.hypot(actor.x - nextEntry.x, actor.z - nextEntry.z) < 24, `the caravan enters ${next.title} by its south gate: ${actor.x},${actor.z}`);
    }
    await waitFor('the player ahead is told who comes', async () => ahead.notices.some(text => /С юга идёт: караван/.test(text)));
    console.log(`PASS a caravan walks through ${road.title} to its north gate, leaves only there, and enters ${next.title} from the south with a notice`);

    // --- место стычки ---------------------------------------------------------------------------------
    await h.connectAndJoin(accounts.trade);
    const battle = watch(accounts.trade);
    assert.equal(accounts.trade.join.roomId, field.id);
    const fallen = await waitFor('the fallen of the clash lie in the zone', async () => {
      const dead = [...battle.enemies.values()].filter(row => row.dead);
      return dead.length >= clash.lost ? dead : null;
    });
    await waitFor('the fallen carry their sacks', async () => [...battle.containers.values()].some(row => row.lootBag));
    await waitFor('the player is told about the fight', async () => battle.notices.some(text => /недавно был бой/.test(text)));
    await h.connectAndJoin(accounts.target);
    const second = watch(accounts.target);
    assert.notEqual(accounts.target.join.roomId, field.id, 'the second player stands in another channel');
    await delay(2500);
    assert.equal([...second.enemies.values()].filter(row => row.dead).length, 0, 'the fallen lie in one channel only: their loot is not copied');
    console.log(`PASS the place of the clash shows ${fallen.length} fallen with their sacks in the first channel only`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Living wasteland network OK: every city has its road patrol, caravans walk gate to gate through zones and are announced, groups clash without players and leave their fallen for the first player who comes.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
