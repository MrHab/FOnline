#!/usr/bin/env node
'use strict';

// Сетевая проверка сквозных опасных клеток (экономика v3, итерация 2) на
// настоящем сервере. Файл экономики проверки делает красные клетки
// сквозными, как чёрная Сердцевина: путь, начатый в красной земле, во второй
// мелкой клетке обязательно заводит отряд в её сцену, вход — со стороны
// прихода; выход через тот же край ведёт в соседнюю сквозную сцену, выход в
// обычную землю ставит отряд на карту у общей границы, а в занятую сцену
// сервер досыпает угрозы.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.dangerCells.sceneModes = ['pvpBlack', 'pvpFullDrop'];
economy.dangerCells.encounterChance = { peaceful: 0, pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 };
economy.dangerCells.edgeGraceKm = 0.5;
economy.dangerCells.respawn = { intervalSeconds: 1, minHostiles: { pvp: 0, pvpFullDrop: 60, pvpBlack: 60 } };
const economyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-danger-walk-')), 'economy.json');
fs.writeFileSync(economyFile, JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = economyFile;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUB_POINTS = economy.dangerCells.subCellKm; // 1 точка карты = 1 км
const cellOf = point => ({ sx: Math.floor(point.x / SUB_POINTS), sy: Math.floor(point.y / SUB_POINTS) });

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

/** Доехать до точки сцены пакетами state, как клиент. */
async function driveTo(account, state, x, z, maxFrames = 120) {
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

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const onMap = (role, x, y) => {
    const state = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
    state.globalMap = { onWorldMap: true, playerX: x, playerY: y };
  };
  // Путник у западного края — красный «Глухой обвод».
  onMap('untargeted', 15, 150);
  // Второй — в жёлтой земле восточнее красной полосы.
  onMap('harvest', 21.5, 130);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    const walker = accounts.untargeted;
    await h.connectAndJoin(walker);

    // --- обязательный вход, со стороны прихода ----------------------------------------
    const entered = waitForTransfer(walker);
    const started = await h.socketAck(walker.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: { x: 15, y: 110 } });
    assert(started.ok, JSON.stringify(started).slice(0, 300));
    const first = await entered;
    assert.equal(first.pvpMode, 'pvpFullDrop');
    const startCell = cellOf({ x: 15, y: 150 });
    const firstCell = cellOf(first.worldPoint);
    assert.equal(firstCell.sx, startCell.sx);
    assert.equal(firstCell.sy, startCell.sy - 1, 'the second sub-cell of the route pulls the party in: ' + JSON.stringify(first.worldPoint));
    const state = { x: Number(first.x ?? first.self?.x ?? 0), z: Number(first.z ?? first.self?.z ?? 0) };
    assert(state.z > 20, 'moving north, the party enters from the south edge of the scene: z=' + state.z);
    console.log('PASS a walk cell is entered on foot from the side of arrival (' + first.roomId + ')');

    // --- выход тем же краем: соседняя сквозная сцена ------------------------------------
    assert(await driveTo(walker, state, state.x, 36), 'reached the south edge: ' + JSON.stringify(state));
    const back = waitForTransfer(walker);
    const exit = await h.socketAck(walker.socket, 'globalTravelEnterWorld', {});
    assert(exit.ok && exit.transferred === true, 'the south edge leads into the next walk scene: ' + JSON.stringify(exit).slice(0, 300));
    const second = await back;
    assert.equal(second.reason, 'dangerCellWalk');
    const secondCell = cellOf(second.worldPoint);
    assert.equal(secondCell.sy, firstCell.sy + 1, 'the neighbour to the south');
    assert.notEqual(second.roomId, first.roomId, 'another scene');
    const inSecond = { x: Number(second.x ?? 0), z: Number(second.z ?? 0) };
    assert(inSecond.z < -20, 'going south, the party appears at the north edge of the next scene: z=' + inSecond.z);
    console.log('PASS the edge of a walk scene leads into the neighbouring scene (' + second.roomId + ')');

    // --- угрозы досыпаются ------------------------------------------------------------------
    const hostiles = rows => (rows || []).filter(row => !row.dead && row.hostileToPlayer !== false).length;
    const countBefore = hostiles(second.worldState?.enemies);
    const counts = [];
    const onSnapshot = payload => counts.push(hostiles(payload?.enemies));
    walker.socket.on('enemySnapshot', onSnapshot);
    await delay(3500);
    walker.socket.off('enemySnapshot', onSnapshot);
    const most = Math.max(countBefore, ...counts);
    assert(most > countBefore, `threats respawn in an occupied walk scene: ${countBefore} → ${JSON.stringify(counts)}`);
    console.log(`PASS threats respawn in an occupied scene (${countBefore} → ${most})`);

    // --- выход в обычную землю: на карту у общей границы ------------------------------------
    const scout = accounts.harvest;
    await h.connectAndJoin(scout);
    const scoutIn = waitForTransfer(scout);
    const scoutStart = await h.socketAck(scout.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: { x: 5, y: 130 } });
    assert(scoutStart.ok, JSON.stringify(scoutStart).slice(0, 300));
    const scoutScene = await scoutIn;
    const scoutCell = cellOf(scoutScene.worldPoint);
    const scoutState = { x: Number(scoutScene.x ?? 0), z: Number(scoutScene.z ?? 0) };
    assert(scoutState.x > 20, 'moving west, the scout enters from the east edge: x=' + scoutState.x);
    assert(await driveTo(scout, scoutState, 36, scoutState.z), 'reached the east edge: ' + JSON.stringify(scoutState));
    const out = await h.socketAck(scout.socket, 'globalTravelEnterWorld', {});
    assert(out.ok && !out.transferred, 'the east edge leads back to ordinary land: ' + JSON.stringify(out).slice(0, 300));
    const edgeX = (scoutCell.sx + 1) * SUB_POINTS;
    assert(out.worldPoint.x > edgeX && out.worldPoint.x < edgeX + SUB_POINTS * 0.2, 'on the map just past the shared border: ' + JSON.stringify(out.worldPoint));
    assert(out.worldPoint.y >= scoutCell.sy * SUB_POINTS && out.worldPoint.y <= (scoutCell.sy + 1) * SUB_POINTS, 'level with the scene edge');
    console.log('PASS an edge towards ordinary land leads onto the map at the shared border (' + JSON.stringify(out.worldPoint) + ')');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(path.dirname(economyFile), { recursive: true, force: true });
  }
  console.log('Danger walk network OK: walk cells are entered on foot from the side of arrival, scene edges lead into the neighbouring walk cells or onto the map at the shared border, and threats respawn in occupied scenes.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
