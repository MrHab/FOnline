#!/usr/bin/env node
'use strict';

// Сетевая проверка A-Life на сетке зон мира, на настоящем сервере. Логова стоят
// в каждой немирной зоне, но пусты (ёмкость 0) — в мире только группы, заранее
// положенные в состояние; предел канала 1, поэтому двое в одной зоне стоят в
// двух каналах:
//  - группа, живущая в зоне, стоит в каждом её канале с игроками;
//  - группа из соседней зоны чует игроков и входит воротами с той стороны,
//    откуда шла, — в оба канала, игроки видят предупреждение;
//  - погибшая особь исчезает во всех каналах сразу, а выжившие после больших
//    потерь остаются в зоне и не прекращают обычное поведение;
//  - синяя зона тоже живая;
//  - опустевшая зона отпускает группы в мир с ранами.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const DEV_TOKEN = 'danger-ecology-network-check-0123456789abcdef';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
process.env.KROMKA_ZONE_CHANNEL_CAP = '1';
const h = require('./check-combat-runtime');
const { zoneOfPlace, zoneById } = require('../src/server/zone-graph');
const { normalizeRecipe } = require('../src/server/zone-builder');
const { zoneRecipe } = require('../src/server/zone-graph');
const { hash01 } = require('../src/server/danger-ecology');
const { createZoneRuntime } = require('../src/server/zone-runtime');
const accounts = {};
const zoneWalk = require('./lib/zone-walk');
const { world } = zoneWalk;
const placeInZone = (role, locationId, point) => zoneWalk.placeInZone(h, accounts, role, locationId, point);

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const alifeCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'open-world-alife.json'), 'utf8'));
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-danger-ecology-'));
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({
  tickSeconds: 1,
  maxGroups: 40,
  woundHealPerMinute: 0,
  lairs: { capacity: { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  roam: { restMinutes: [60, 60], stepSeconds: [600, 600], huntStepSeconds: [1, 1], senseSeconds: 1, radius: 1 },
  species: [
    // Группы не нападают на игроков и друг на друга (одна фракция, не враждебны):
    // проверка смотрит на жизнь групп, а не на исход боя.
    { id: 'test_gari', name: 'Стая гари', kind: 'monster', faction: 'gari', hostile: false,
      members: [{ type: 'gari', name: 'Гарь', min: 3, max: 3 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1, pvpBlack: 1 }, perceptionCells: 0, aggression: 0 },
    { id: 'test_scouts', name: 'Стая гари', kind: 'monster', faction: 'gari', hostile: false,
      members: [{ type: 'gari', name: 'Гарь-разведчик', min: 3, max: 3 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1, pvpBlack: 1 }, perceptionCells: 1, aggression: 1 }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Город — не зона пустоши: за домашнюю берём соседнюю с Ключами зону.
const home = graph.zones.find(zone => zone.id === zoneOfPlace(graph, 'settlement').edges.north.to);
// Зона такая, какой её отдаёт сервер: авторский файл, если он есть, иначе конструктор.
const zoneRuntime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data', 'zones'), normalize: row => row });
const servedZone = id => zoneRuntime.ensure({}, id);
const homeDef = servedZone(home.id);
// Сосед с открытыми воротами, откуда придёт охотник: он идёт на юг и входит с севера.
const north = zoneById(graph, home.edges.north.to);
assert(home.edges.north.open !== false && north && north.mode !== 'peaceful', 'the home zone has an open gate to a live zone in the north');
// Синяя зона без игроков в соседях: живая, в ней своя группа.
const blue = graph.zones.find(zone => zone.mode === 'pve' && Math.abs(zone.col - home.col) + Math.abs(zone.row - home.row) > 3);
assert(blue, 'the world has a blue zone away from Keys');
const blueDef = servedZone(blue.id);
// Где встанет группа без логова в зоне: её точка появления (serverEcologyZoneAnchor).
const anchorOf = (def, groupId) => {
  const pool = def.zone.spawnAreas?.length ? def.zone.spawnAreas : def.zone.lairs;
  return world(pool[Math.floor(hash01(`${groupId}:anchor`) * pool.length)]);
};
// Наблюдатель в 15 м от группы — ближе, чем туман клиента прячет существ.
const residentAnchor = anchorOf(homeDef, 'resident');
const blueAnchor = anchorOf(blueDef, 'bluebirds');

const devGet = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, { headers: { 'x-dev-token': DEV_TOKEN } }, res => {
    let text = '';
    res.on('data', chunk => { text += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(text)); } catch (error) { reject(new Error(`${res.statusCode} ${text.slice(0, 200)}`)); }
    });
  }).on('error', reject);
});
const devPost = (route, body) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify(body));
  const req = http.request(h.baseUrl() + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': payload.length, 'x-dev-token': DEV_TOKEN }
  }, res => {
    let text = '';
    res.on('data', chunk => { text += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(text)); } catch (error) { reject(new Error(`${res.statusCode} ${text.slice(0, 200)}`)); }
    });
  });
  req.on('error', reject);
  req.end(payload);
});
async function group(id, zone, radius = 2) {
  const view = await devGet(`/api/dev/danger-ecology?sx=${zone.col}&sy=${zone.row}&radius=${radius}`);
  assert(view.active, 'A-Life is on');
  return view.near.find(row => row.id === id) || null;
}
async function waitFor(label, probe, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await delay(300);
  }
  throw new Error(`timed out: ${label}`);
}
const actorsIn = (row, roomId) => (row?.actors || []).filter(actor => actor.roomId === roomId && !actor.dead);

(async () => {
  await h.bootstrapCharacters(accounts);
  const hub = world(homeDef.spawn);
  placeInZone('untargeted', home.id, hub);
  placeInZone('harvest', home.id, { x: residentAnchor.x + 15, z: residentAnchor.z });
  placeInZone('trade', blue.id, { x: blueAnchor.x + 15, z: blueAnchor.z });

  const far = Date.now() + 3600000;
  const members = () => [1, 2, 3].map(n => ({ id: `m${n}`, type: 'gari', spec: 0, name: 'Гарь', hp: 39, maxHp: 39 }));
  const resting = (id, speciesId, zone) => ({
    id, speciesId, lairId: '', sx: zone.col, sy: zone.row, members: members(), state: 'rest', target: null,
    restUntil: far, nextStepAt: far, shakenUntil: 0, size0: 3, bornAt: 0
  });
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
    version: 1, mapRevision: 'check', nextId: 50, lairs: [],
    // Призрак — группа прежней мелкой сетки мира, клетки которой нет среди зон.
    groups: [resting('resident', 'test_gari', home), resting('hunter', 'test_scouts', north), resting('bluebirds', 'test_gari', blue),
      resting('ghost', 'test_gari', { col: 200, row: 180 })]
  }));

  await h.startServer();
  const notices = [];
  try {
    await h.connectAndJoin(accounts.untargeted);
    await h.connectAndJoin(accounts.harvest);
    const channels = [accounts.untargeted.join.roomId, accounts.harvest.join.roomId];
    assert.deepEqual(channels, [home.id, `${home.id}#ch2`], 'two players in one zone stand in two channels');
    for (const account of [accounts.untargeted, accounts.harvest]) {
      account.socket.on('dangerCellNotice', payload => notices.push({ role: account.role, text: String(payload?.text || '') }));
    }

    // --- группа зоны — в каждом канале --------------------------------------------------------
    const resident = await waitFor('the resident group stands in both channels', async () => {
      const row = await group('resident', home, 0);
      return channels.every(roomId => actorsIn(row, roomId).length === 3) ? row : null;
    });
    assert.equal(resident.online, home.id, 'the group is online in its zone');
    // Логова — места логов, которые конструктор ставит в каждой немирной зоне.
    const expectedLairs = graph.zones.filter(zone => !zone.city && zone.mode !== 'peaceful')
      .reduce((sum, zone) => sum + normalizeRecipe(zoneRecipe(graph, zone.id)).budget.lairs, 0);
    const summary = (await devGet(`/api/dev/danger-ecology?sx=${home.col}&sy=${home.row}&radius=0`)).summary;
    assert.equal(summary.lairs, expectedLairs, 'every live zone has its lairs');
    assert.equal(summary.huntingGrounds, alifeCatalog.huntingGrounds.length,
      'hunting grounds stay separate from the 237 fixed lairs');
    assert.equal(summary.groups, 3, 'a group outside the zone world is dropped on start');
    const locationResponse = await fetch(h.baseUrl() + `/api/locations/${home.id}`);
    const publicZone = (await locationResponse.json()).location;
    assert.equal(publicZone.zone.lairs.length, homeDef.zone.lairs.length, 'every lair keeps its authored anchor');
    assert(publicZone.zone.lairs.every(lair => ['test_gari', 'test_scouts'].includes(lair.speciesId)
      && lair.speciesName === 'Стая гари'), 'the client receives the resident species of each lair');
    // Чёрных зон на карте канона нет (библия, 4.4): логова есть в синих и красных.
    assert(summary.lairsByMode.pve > 0 && summary.lairsByMode.pvpFullDrop > 0, 'blue and red zones have lairs: ' + JSON.stringify(summary.lairsByMode));
    console.log(`PASS the group living in ${home.title} stands in both of its channels (3 + 3 creatures); ${expectedLairs} lairs across the live zones`);

    // --- охотник из соседней зоны входит воротами -----------------------------------------------
    const hunter = await waitFor('the hunter comes through the north gate', async () => {
      const row = await group('hunter', home, 1);
      return row && row.sx === home.col && row.sy === home.row && channels.every(roomId => actorsIn(row, roomId).length === 3) ? row : null;
    });
    const entry = world(homeDef.entryFromNorth);
    // Воротами группа входит в каналы, открытые в миг прихода. Первый канал
    // открыт всегда: без игрока группу ничто не зовёт. Тик экологии может пройти
    // между двумя входами — тогда второй канал откроется позже и получит уже
    // стоящую в зоне группу на её точках появления, как любой новый канал; его
    // проверяем, только если он слышал приход с севера.
    await delay(600);
    const heard = new Set(notices.filter(row => /север/i.test(row.text)).map(row => row.role));
    [accounts.untargeted, accounts.harvest].forEach((account, index) => {
      if (index > 0 && !heard.has(account.role)) return;
      for (const actor of actorsIn(hunter, channels[index])) {
        assert(Math.hypot(actor.x - entry.x, actor.z - entry.z) < 24, `the hunter enters by the north gate: ${actor.x},${actor.z} vs ${entry.x},${entry.z}`);
      }
    });
    console.log(`PASS a group from ${north.title} senses the players, walks in by the north gate and stands in both channels`);

    // --- гибель во всех каналах без бегства ----------------------------------------------------
    const killed = await devPost('/api/dev/danger-ecology/kill', { groupId: 'resident', roomId: channels[1], count: 2 });
    assert.equal(killed.killed, 2);
    assert.equal(killed.members, 1, 'the dead do not come back');
    assert.notEqual(killed.state, 'flee', 'two of three dead: the group stays');
    const after = await group('resident', home, 0);
    assert.equal(actorsIn(after, channels[0]).length, 1, 'a creature killed in one channel is gone from the other too');
    assert.equal(actorsIn(after, channels[1]).length, 1, 'the survivor stays in the second channel too');
    await delay(2500);
    const stayed = await group('resident', home, 0);
    assert.equal(stayed.sx, home.col);
    assert.equal(stayed.sy, home.row);
    for (const roomId of channels) {
      const [survivor] = actorsIn(stayed, roomId);
      assert(survivor && survivor.phase !== 'leaving', `the survivor stays in ${roomId}`);
    }
    console.log('PASS a creature dies in every channel at once; survivors stay in both channels');

    // --- синяя зона живая ------------------------------------------------------------------------
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.trade.join.roomId, blue.id);
    await waitFor('the blue zone group stands in its scene', async () => actorsIn(await group('bluebirds', blue, 0), blue.id).length === 3);
    console.log(`PASS the blue zone ${blue.title} is alive too`);

    // --- синяя зона тоже удерживает выживших --------------------------------------------------
    assert.notEqual((await devPost('/api/dev/danger-ecology/kill', { groupId: 'bluebirds', roomId: blue.id, count: 2 })).state, 'flee');
    await delay(1500);
    const blueSurvivor = await group('bluebirds', blue, 0);
    assert.equal(actorsIn(blueSurvivor, blue.id).length, 1, 'the blue-zone survivor stays in the scene');
    assert.notEqual(actorsIn(blueSurvivor, blue.id)[0].phase, 'leaving');
    console.log('PASS a blue-zone survivor also stays after heavy losses');

    // --- опустевшая зона отпускает группы ------------------------------------------------------------
    const woundedBefore = await group('hunter', home, 1);
    h.closeSocket(accounts.untargeted);
    h.closeSocket(accounts.harvest);
    const released = await waitFor('the empty zone releases the hunter', async () => {
      const row = await group('hunter', home, 1);
      return row && !row.online ? row : null;
    });
    assert.equal(released.sx, home.col, 'the released group stays in the zone');
    assert.deepEqual(released.members.map(row => row.hp), woundedBefore.members.map(row => row.hp), 'wounds are kept');
    console.log('PASS an emptied zone releases its groups into the world with their wounds');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Danger ecology network OK: groups live on the zone grid, stand in every channel, hunt through open gates, die in every channel at once, keep survivors in battle, live in blue zones and are released with their wounds.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
