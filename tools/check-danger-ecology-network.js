#!/usr/bin/env node
'use strict';

// Сетевая проверка A-Life на сетке зон мира, на настоящем сервере. Логова стоят
// в каждой немирной зоне, но пусты (ёмкость 0) — в мире только группы, заранее
// положенные в состояние; предел канала 1, поэтому двое в одной зоне стоят в
// двух каналах:
//  - группа, живущая в зоне, стоит в каждом её канале с игроками;
//  - группа из соседней зоны чует игроков и входит воротами с той стороны,
//    откуда шла, — в оба канала, игроки видят предупреждение;
//  - погибшая особь исчезает во всех каналах сразу, большие потери уводят
//    группу воротами в соседнюю зону — не в город и не сквозь игрока; беглец
//    исчезает только в воротах, группа уходит с последней копией и не
//    возвращается;
//  - синяя зона тоже живая; беглец, от которого игрок не отстаёт, загнан и остаётся;
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
process.env.KROMKA_ECOLOGY_CORNERED_MS = '8000';
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
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1, pvpBlack: 1 }, perceptionCells: 0, aggression: 0, fleeAt: 0.6 },
    { id: 'test_scouts', name: 'Стая гари', kind: 'monster', faction: 'gari', hostile: false,
      members: [{ type: 'gari', name: 'Гарь-разведчик', min: 3, max: 3 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1, pvpBlack: 1 }, perceptionCells: 1, aggression: 1, fleeAt: 0.6 }
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
    assert.equal(summary.groups, 3, 'a group outside the zone world is dropped on start');
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

    // --- гибель во всех каналах, бегство в соседнюю зону ---------------------------------------
    // Потери — в канале наблюдателя: ворота бегства выбирают по его игрокам.
    const killed = await devPost('/api/dev/danger-ecology/kill', { groupId: 'resident', roomId: channels[1], count: 2 });
    assert.equal(killed.killed, 2);
    assert.equal(killed.members, 1, 'the dead do not come back');
    assert.equal(killed.state, 'flee', 'two of three dead: the group flees');
    const after = await group('resident', home, 0);
    const watcher = { x: Number(accounts.harvest.join.self.x), z: Number(accounts.harvest.join.self.z) };
    const [runner] = actorsIn(after, channels[1]);
    assert.equal(actorsIn(after, channels[0]).length, 1, 'a creature killed in one channel is gone from the other too');
    assert.equal(actorsIn(after, channels[1]).length, 1, 'one survivor runs');
    const startDistance = Math.hypot(runner.x - watcher.x, runner.z - watcher.z);
    assert(startDistance < 22, `the watcher stands by the group: ${Math.round(startDistance)} m`);
    // Беглец в каждом канале бежит до самых ворот и исчезает только в них; всё это
    // время группа в зоне, а наблюдателя он обходит стороной.
    const gates = (homeDef.transitions || []).filter(row => row.type === 'zoneGate').map(row => ({ direction: row.direction, ...world(row) }));
    const lastSeen = new Map();
    let closest = startDistance;
    await waitFor('every copy of the survivor walks out through a gate', async () => {
      const row = await group('resident', home, 1);
      const running = channels.map(roomId => actorsIn(row, roomId)[0]).filter(Boolean);
      if (!running.length) return true;
      assert(row.sx === home.col && row.sy === home.row, 'the group stays in the zone while a copy is still running');
      for (const actor of running) {
        assert.equal(actor.phase, 'leaving', 'the survivor keeps running');
        lastSeen.set(actor.roomId, actor);
        if (actor.roomId === channels[1]) closest = Math.min(closest, Math.hypot(actor.x - watcher.x, actor.z - watcher.z));
      }
      return null;
    }, 150000);
    const exits = [...lastSeen.values()].map(actor => gates
      .map(gate => ({ direction: gate.direction, distance: Math.hypot(actor.x - gate.x, actor.z - gate.z) }))
      .sort((a, b) => a.distance - b.distance)[0]);
    assert.equal(exits.length, 2, 'the survivor ran in both channels');
    for (const exit of exits) assert(exit.distance <= 8, `a survivor vanishes only in a zone gate: last seen ${exit.distance.toFixed(1)} m from the ${exit.direction} gate`);
    assert.equal(exits[0].direction, exits[1].direction, 'every copy leaves by the same gate');
    assert(closest >= startDistance - 3, `the survivor runs away from the watcher, not past them: ${Math.round(startDistance)} → ${Math.round(closest)} m`);
    const fled = await waitFor('the broken group leaves through a gate', async () => {
      const row = await group('resident', home, 1);
      return row && (row.sx !== home.col || row.sy !== home.row) ? row : null;
    }, 5000);
    const direction = Object.entries(home.edges).find(([, edge]) => edge.to === zoneById(graph, graph.zones.find(z => z.col === fled.sx && z.row === fled.sy).id)?.id);
    assert(direction && direction[1].open !== false, 'the group left through an open gate');
    assert.equal(direction[0], exits[0].direction, 'the group is beyond the gate its survivors walked out of');
    assert(!zoneById(graph, direction[1].to).city, 'a broken group does not run into a city');
    assert.equal(fled.online, '', 'the group left the scenes');
    for (let probe = 0; probe < 6; probe += 1) {
      assert(!((await group('resident', home, 1)).actors || []).length, 'the fled group does not come back into the zone');
      await delay(500);
    }
    console.log(`PASS a creature dies in every channel at once; the survivor runs away from the watcher (${Math.round(startDistance)} → ${Math.round(closest)} m closest) all the way out through the ${direction[0]} gate, in both channels, and the group does not come back`);

    // --- синяя зона живая ------------------------------------------------------------------------
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.trade.join.roomId, blue.id);
    await waitFor('the blue zone group stands in its scene', async () => actorsIn(await group('bluebirds', blue, 0), blue.id).length === 3);
    console.log(`PASS the blue zone ${blue.title} is alive too`);

    // --- загнанный беглец ---------------------------------------------------------------------------
    // Игрок не отстаёт от беглеца: тот не исчезает у него на глазах, а, загнанный,
    // перестаёт бежать и остаётся в сцене.
    assert.equal((await devPost('/api/dev/danger-ecology/kill', { groupId: 'bluebirds', roomId: blue.id, count: 2 })).state, 'flee');
    const chaser = { x: Number(accounts.trade.join.self.x), z: Number(accounts.trade.join.self.z) };
    const chaseStart = Date.now();
    let cornered = null;
    while (!cornered && Date.now() - chaseStart < 20000) {
      const [actor] = actorsIn(await group('bluebirds', blue, 0), blue.id);
      assert(actor, `a chased survivor does not vanish before the chaser (${((Date.now() - chaseStart) / 1000).toFixed(1)} s)`);
      if (!actor.phase) cornered = actor;
      else await zoneWalk.driveTo(h, accounts.trade, chaser, actor.x, actor.z, 4);
    }
    assert(cornered, 'a survivor the player keeps up with is cornered');
    const chaseSeconds = (Date.now() - chaseStart) / 1000;
    assert(chaseSeconds >= 7, `it runs for the whole flight first: ${chaseSeconds.toFixed(1)} s`);
    await delay(1500);
    assert.equal(actorsIn(await group('bluebirds', blue, 0), blue.id).length, 1, 'the cornered survivor stays in the scene');
    console.log(`PASS a survivor the player keeps up with is cornered after ${chaseSeconds.toFixed(1)} s and stays`);

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
  console.log('Danger ecology network OK: groups live on the zone grid, stand in every channel, hunt through open gates, die in every channel at once, walk out through gates and never into cities, fight when cornered, live in blue zones and are released with their wounds.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
