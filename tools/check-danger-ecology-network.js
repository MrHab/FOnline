#!/usr/bin/env node
'use strict';

// Сетевая проверка A-Life опасных клеток на настоящем сервере. Файл экономики
// проверки делает красные клетки сквозными, логов нет — в мире только группы,
// заранее положенные в состояние:
//  - группа, живущая в клетке, стоит в её сцене существами бестиария Кромки;
//  - группа из соседней клетки чует игрока и входит с того края, откуда шла,
//    а игрок видит предупреждение;
//  - погибшие особи не возвращаются, большие потери уводят группу за край в
//    соседнюю клетку;
//  - опустевшая сцена отпускает группы в мир с ранами;
//  - шанс стычки в пути сводит отряд с ближайшей группой, а без групп рядом
//    стычки нет.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

const DEV_TOKEN = 'danger-ecology-network-check-0123456789abcdef';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
// Путь по карте медленнее обычного: стычки в пути успевают разыграться.
process.env.SERVER_GLOBAL_TRAVEL_TIME_COMPRESSION = '120';
const h = require('./check-combat-runtime');
const cells = require('../src/server/danger-cells');
const accounts = {};

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.dangerCells.sceneModes = ['pvpBlack', 'pvpFullDrop'];
economy.dangerCells.encounterChance = { peaceful: 0, pve: 0, pvp: 1, pvpFullDrop: 0, pvpBlack: 0 };
economy.dangerCells.edgeGraceKm = 0.5;
economy.worldModel.dangerEcology = true;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-danger-ecology-'));
const economyFile = path.join(scratch, 'economy.json');
fs.writeFileSync(economyFile, JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = economyFile;
const ecologyFile = path.join(scratch, 'danger-ecology.json');
fs.writeFileSync(ecologyFile, JSON.stringify({
  tickSeconds: 1,
  maxGroups: 40,
  pullRadiusCells: 3,
  woundHealPerMinute: 0,
  lairs: { density: { pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  roam: { restMinutes: [60, 60], stepSeconds: [600, 600], huntStepSeconds: [1, 1], senseSeconds: 1, radius: 1 },
  species: [
    // Группы у путника не нападают на него и друг на друга (одна фракция):
    // проверка смотрит на жизнь групп, а не на исход боя.
    { id: 'test_gari', name: 'Стая гари', kind: 'monster', faction: 'gari', hostile: false,
      members: [{ type: 'gari', name: 'Гарь', min: 3, max: 3 }],
      habitat: { pvp: 1, pvpFullDrop: 2, pvpBlack: 1 }, perceptionCells: 0, aggression: 0, fleeAt: 0.6 },
    { id: 'test_scouts', name: 'Стая гари', kind: 'monster', faction: 'gari', hostile: false,
      members: [{ type: 'gari', name: 'Гарь-разведчик', min: 3, max: 3 }],
      habitat: { pvp: 1, pvpFullDrop: 2, pvpBlack: 1 }, perceptionCells: 2, aggression: 1, fleeAt: 0.6 },
    { id: 'test_raiders', name: 'Банда налётчиков', kind: 'raider', faction: 'raiders',
      members: [{ type: 'raider', name: 'Налётчик', min: 2, max: 2, equipment: { weapon: 'pistol', armor: 'leather' } }],
      habitat: { pvp: 3, pvpFullDrop: 1 }, perceptionCells: 0, aggression: 0, fleeAt: 0.5 }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = ecologyFile;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUB = economy.dangerCells.subCellKm; // 1 точка карты = 1 км
const cellOf = point => ({ sx: Math.floor(point.x / SUB), sy: Math.floor(point.y / SUB) });
const centerOf = (sx, sy) => ({ x: Number(((sx + 0.5) * SUB).toFixed(3)), y: Number(((sy + 0.5) * SUB).toFixed(3)) });

// --- цвета мелких клеток так же, как их видит сервер -------------------------------------------
const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json'), 'utf8'));
const nodes = {};
for (const node of map.nodes) {
  const id = String(node.locationId || node.id || '');
  if (id) nodes[id] = { x: Number(node.x), y: Number(node.y) };
}
const modes = cells.cellDangerModes(cells.normalizeDangerCellConfig(economy.dangerCells), map.grid, map.cells, nodes);
const playable = require('../data/kromka/global-map-playable.json').points;
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = playable.length - 1; i < playable.length; j = i, i += 1) {
    const a = playable[i];
    const b = playable[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1e-9) + a[0]) hit = !hit;
  }
  return hit;
}
const places = map.nodes.map(node => ({ x: Number(node.x), y: Number(node.y) }));
function modeAt(sx, sy) {
  const { x, y } = centerOf(sx, sy);
  if (!inside(x, y)) return '';
  return modes[`${Math.floor(x / map.grid.cellPoints)}:${Math.floor(y / map.grid.cellPoints)}`] || '';
}
/** Горизонтальные полосы жёлтой земли без мест карты рядом. */
function yellowRuns(length) {
  const runs = [];
  for (let sy = 5; sy < 180; sy += 3) {
    for (let sx = 5; sx < 225; sx += 1) {
      let ok = true;
      for (let k = -1; k <= length && ok; k += 1) {
        for (let dy = -4; dy <= 4 && ok; dy += 1) {
          if (modeAt(sx + k, sy + dy) !== 'pvp') ok = false;
        }
        const c = centerOf(sx + k, sy);
        if (places.some(place => Math.hypot(place.x - c.x, place.y - c.y) < 8)) ok = false;
      }
      if (ok) runs.push({ sx, sy });
    }
  }
  return runs;
}

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
async function groupNear(id, sx, sy, radius = 3) {
  const view = await devGet(`/api/dev/danger-ecology?sx=${sx}&sy=${sy}&radius=${radius}`);
  assert(view.ok && view.active, 'A-Life is on: ' + JSON.stringify(view).slice(0, 200));
  return view.near.find(group => group.id === id) || null;
}
async function waitFor(check, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out: ' + label);
    await delay(250);
  }
}

const waitForTransfer = (account, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    account.socket.off('serverWorldTransfer', onTransfer);
    reject(new Error(`no danger cell transfer for ${account.role} in ${timeoutMs} ms`));
  }, timeoutMs);
  function onTransfer(payload) {
    if (!/^dangerCell/.test(String(payload?.reason || ''))) return;
    clearTimeout(timer);
    account.socket.off('serverWorldTransfer', onTransfer);
    resolve(payload);
  }
  account.socket.on('serverWorldTransfer', onTransfer);
});

async function driveTo(account, state, x, z, maxFrames = 160) {
  let seq = 1;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const dx = x - state.x;
    const dz = z - state.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.4) return true;
    const result = await h.socketAck(account.socket, 'state', {
      seq: seq++, x, z, angle: Math.atan2(dx, dz), moving: true, turning: false, crouching: false,
      vx: 5.5 * dx / Math.max(0.001, length), vz: 5.5 * dz / Math.max(0.001, length)
    });
    const self = result?.self || result || {};
    if (Number.isFinite(Number(self.x))) state.x = Number(self.x);
    if (Number.isFinite(Number(self.z))) state.z = Number(self.z);
    await delay(58);
  }
  return false;
}

const member = (id, type, hp) => ({ id, type, hp, maxHp: hp });

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const onMap = (role, x, y) => {
    const state = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
    state.globalMap = { onWorldMap: true, playerX: x, playerY: y };
  };

  // Путник у западного края — красный «Глухой обвод», как в check-danger-walk-network.
  const walkerStart = { x: 15, y: 150 };
  const scene = { sx: cellOf(walkerStart).sx, sy: cellOf(walkerStart).sy - 1 };
  onMap('untargeted', walkerStart.x, walkerStart.y);
  // Две полосы жёлтой земли далеко друг от друга: без групп и с группой рядом.
  const runs = yellowRuns(6);
  assert(runs.length >= 2, 'the map has long yellow runs');
  const quietRun = runs[0];
  const lurkRun = runs.find(run => Math.abs(run.sx - quietRun.sx) + Math.abs(run.sy - quietRun.sy) > 30);
  assert(lurkRun, 'two yellow runs far apart');
  onMap('harvest', centerOf(quietRun.sx, quietRun.sy).x, centerOf(quietRun.sx, quietRun.sy).y);
  onMap('trade', centerOf(lurkRun.sx, lurkRun.sy).x, centerOf(lurkRun.sx, lurkRun.sy).y);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  const far = Date.now() + 3600000;
  const group = (id, speciesId, sx, sy, members) => ({
    id, speciesId, lairId: '', sx, sy, members, state: 'rest', target: null,
    restUntil: far, nextStepAt: far, size0: members.length, bornAt: 0
  });
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
    version: 1,
    mapRevision: 'network-check',
    nextId: 100,
    lairs: [],
    groups: [
      group('resident', 'test_gari', scene.sx, scene.sy, [member('m1', 'gari', 39), member('m2', 'gari', 39), member('m3', 'gari', 39)]),
      group('hunter', 'test_scouts', scene.sx, scene.sy - 1, [member('m1', 'gari', 39), member('m2', 'gari', 39), member('m3', 'gari', 39)]),
      group('lurker', 'test_raiders', lurkRun.sx + 1, lurkRun.sy - 2, [member('m1', 'raider', 55), member('m2', 'raider', 55)])
    ]
  }));

  await h.startServer();
  try {
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);
    const snapshots = [];
    const notices = [];
    walker.socket.on('enemySnapshot', payload => snapshots.push(payload?.enemies || []));
    walker.socket.on('dangerCellNotice', payload => notices.push(String(payload?.text || '')));

    // --- группа клетки стоит в её сцене ---------------------------------------------------
    const entered = waitForTransfer(walker);
    const started = await h.socketAck(walker.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: { x: walkerStart.x, y: 110 } });
    assert(started.ok, JSON.stringify(started).slice(0, 300));
    const first = await entered;
    assert.equal(first.pvpMode, 'pvpFullDrop');
    assert.deepEqual(cellOf(first.worldPoint), scene, 'the walker is in the scene of the resident group');
    const gari = rows => rows.filter(row => !row.dead && row.creatureTypeId === 'gari' && row.name === 'Гарь');
    const residents = await waitFor(() => {
      const last = snapshots[snapshots.length - 1] || [];
      return gari(last).length >= 3 ? gari(last) : null;
    }, 6000, 'resident gari in the scene');
    assert(residents.every(row => row.name === 'Гарь' && row.faction === 'gari'), 'Kromka creatures, not random types: ' + JSON.stringify(residents.map(row => [row.name, row.faction])));
    const walkerZ = Number(first.z ?? 0);
    assert(residents.every(row => Math.abs(Number(row.z) - walkerZ) > 6), 'the resident group stands away from the entry edge');
    console.log(`PASS a group living in the cell stands in its scene as Kromka creatures (${residents.length} × Гарь)`);

    // --- соседняя группа чует игрока и входит с края ----------------------------------------------
    const mourners = rows => rows.filter(row => !row.dead && row.creatureTypeId === 'gari' && row.name === 'Гарь-разведчик');
    let firstSeen = null;
    const newcomers = await waitFor(() => {
      for (const rows of snapshots) {
        if (mourners(rows).length >= 3) {
          firstSeen = firstSeen || mourners(rows);
          return firstSeen;
        }
      }
      return null;
    }, 10000, 'the hunter group arrives');
    assert.equal(newcomers.length, 3);
    // Север сцены — +Z, как на глобальной карте.
    assert(newcomers.every(row => Number(row.z) > 12), 'coming from the north, the group walks in at the north edge: ' + JSON.stringify(newcomers.map(row => row.z)));
    await waitFor(() => notices.some(text => /С севера/.test(text)), 3000, 'the arrival notice');
    const hunter = await groupNear('hunter', scene.sx, scene.sy, 2);
    assert.equal(hunter.sx, scene.sx);
    assert.equal(hunter.sy, scene.sy, 'the hunter moved into the scene cell');
    assert(hunter.online, 'the hunter is in the scene');
    console.log(`PASS a group next door senses the player and walks in from the edge it came from ("${notices.find(text => /С севера/.test(text))}")`);

    // --- потери насовсем, бегство за край ------------------------------------------------------------
    const killed = await devPost('/api/dev/danger-ecology/kill', { groupId: 'hunter', count: 2 });
    assert(killed.ok && killed.killed === 2, JSON.stringify(killed));
    assert.equal(killed.members, 1, 'dead members are gone from the group');
    assert.equal(killed.state, 'flee', 'heavy losses break the group');
    const fled = await waitFor(async () => {
      const row = await groupNear('hunter', scene.sx, scene.sy, 3);
      return row && !row.online ? row : null;
    }, 40000, 'the survivor leaves the scene');
    assert.equal(fled.members.length, 1, 'the dead do not come back');
    assert.equal(Math.abs(fled.sx - scene.sx) + Math.abs(fled.sy - scene.sy), 1, 'the survivor left for a neighbouring cell: ' + JSON.stringify(fled));
    console.log(`PASS deaths are permanent and a broken group leaves through the far edge (${fled.sx}_${fled.sy})`);

    // --- сцена опустела: группа в мире с ранами ------------------------------------------------------------
    const liveResidents = gari(snapshots[snapshots.length - 1] || []);
    const residentHpBefore = liveResidents.map(row => Math.round(Number(row.hp))).sort((a, b) => a - b);
    const state = { x: Number(first.x ?? 0), z: Number(first.z ?? 0) };
    assert(await driveTo(walker, state, state.x, -36), 'reached the south edge: ' + JSON.stringify(state));
    const back = waitForTransfer(walker);
    const exit = await h.socketAck(walker.socket, 'globalTravelEnterWorld', {});
    assert(exit.ok, JSON.stringify(exit).slice(0, 300));
    if (exit.transferred) await back;
    const released = await waitFor(async () => {
      const row = await groupNear('resident', scene.sx, scene.sy, 0);
      return row && !row.online ? row : null;
    }, 6000, 'the resident group goes back to the world');
    assert.equal(released.sx, scene.sx);
    assert.equal(released.sy, scene.sy, 'the released group stays in its cell');
    assert.deepEqual(released.members.map(row => row.hp).sort((a, b) => a - b), residentHpBefore,
      'the released group keeps its members and their health');
    console.log('PASS an emptied scene releases its groups back to the world with their health');

    // --- стычка в пути: без групп рядом её нет ---------------------------------------------------------------
    const quiet = accounts.harvest;
    await h.connectAndJoin(quiet);
    let quietTransfer = null;
    quiet.socket.on('serverWorldTransfer', payload => { if (/^dangerCell/.test(String(payload?.reason || ''))) quietTransfer = payload; });
    const quietTarget = centerOf(quietRun.sx + 6, quietRun.sy);
    const quietStart = await h.socketAck(quiet.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: quietTarget });
    assert(quietStart.ok, JSON.stringify(quietStart).slice(0, 300));
    await delay(7000);
    assert.equal(quietTransfer, null, 'a chance encounter needs a group nearby: ' + JSON.stringify(quietTransfer)?.slice(0, 200));
    console.log('PASS with no group around, the route through yellow land passes without an encounter');

    // --- стычка в пути: ближайшая группа ---------------------------------------------------------------------------
    const scout = accounts.trade;
    await h.connectAndJoin(scout);
    const scoutSnapshots = [];
    scout.socket.on('enemySnapshot', payload => scoutSnapshots.push(payload?.enemies || []));
    const ambushed = waitForTransfer(scout, 20000);
    const scoutTarget = centerOf(lurkRun.sx + 6, lurkRun.sy);
    const scoutStart = await h.socketAck(scout.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: scoutTarget });
    assert(scoutStart.ok, JSON.stringify(scoutStart).slice(0, 300));
    const ambush = await ambushed;
    assert.equal(ambush.reason, 'dangerCell');
    const ambushCell = cellOf(ambush.worldPoint);
    const lurker = await waitFor(() => groupNear('lurker', ambushCell.sx, ambushCell.sy, 0), 5000, 'the lurker in the ambush cell');
    assert(lurker.online, 'the nearby group is the encounter');
    const raiders = await waitFor(() => {
      const rows = scoutSnapshots[scoutSnapshots.length - 1] || [];
      const found = rows.filter(row => !row.dead && row.faction === 'raiders' && row.name === 'Налётчик');
      return found.length >= 2 ? found : null;
    }, 5000, 'the raiders in the ambush scene');
    console.log(`PASS a chance encounter on the road pulls in the nearest group (${raiders.length} × Налётчик at ${ambushCell.sx}_${ambushCell.sy})`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Danger ecology network OK: cell groups stand in their scenes as Kromka creatures, neighbours walk in from the edge they came from, deaths are permanent, broken groups leave, emptied scenes release groups with their health, and road encounters meet the nearest group or none.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
