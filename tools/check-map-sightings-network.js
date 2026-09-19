#!/usr/bin/env node
'use strict';

// Сетевая проверка клеток Сердцевины на глобальной карте, на настоящем сервере:
//  - /api/global-map отдаёт клетки Сердцевины с постоянными номерами и
//    играбельный контур;
//  - в сцене клетки Сердцевины игрок знает её имя с номером — то же, что на карте.
// Радара наблюдений на карте больше нет: обзорная карта показывает только игрока.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.dangerCells.encounterChance = { peaceful: 0, pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 };
economy.dangerCells.edgeGraceKm = 0.5;
economy.worldModel.dangerEcology = false;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-map-sightings-'));
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUB = economy.dangerCells.subCellKm; // 1 точка карты = 1 км
const centerOf = (sx, sy) => ({ x: (sx + 0.5) * SUB, y: (sy + 0.5) * SUB });

const waitForTransfer = (account, timeoutMs = 20000) => new Promise((resolve, reject) => {
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

(async () => {
  await h.bootstrapCharacters(accounts);

  // Карта и клетки Сердцевины до расстановки: сервер поднимается ради неё отдельно.
  await h.startServer();
  const mapBody = await (await fetch(h.baseUrl() + '/api/global-map')).json();
  await h.stopServer();
  const walk = mapBody.map.dangerWalkCells;
  assert(walk && Array.isArray(walk.cells) && walk.cells.length > 100, 'the Core walk cells are published');
  const numbers = walk.cells.map(row => row[2]);
  assert.deepEqual(numbers, walk.cells.map((_, index) => index + 1), 'Core cells are numbered 1…N in map order');
  assert(walk.cells.every(row => walk.names[row[3]]), 'every Core cell has a location name');
  assert(walk.cells.every((row, index) => index === 0
    || row[1] > walk.cells[index - 1][1] || (row[1] === walk.cells[index - 1][1] && row[0] > walk.cells[index - 1][0])),
  'numbers run north to south, west to east');
  assert(Array.isArray(mapBody.map.playableContour) && mapBody.map.playableContour.length >= 3, 'the playable contour is published');
  console.log(`PASS the map publishes ${walk.cells.length} numbered Core cells (${walk.names.join(', ')}) and the playable contour`);

  // Клетка Сердцевины на западном краю: путь с запада упрётся в неё.
  const rowY = walk.cells[Math.floor(walk.cells.length / 2)][1];
  const entry = walk.cells.filter(row => row[1] === rowY).sort((a, b) => a[0] - b[0])[0];

  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const onMap = (role, point) => {
    const state = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
    state.globalMap = { onWorldMap: true, playerX: point.x, playerY: point.y };
  };
  const walkerStart = centerOf(entry[0] - 3, entry[1]);
  onMap('target', walkerStart);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    // --- клетка Сердцевины: имя с номером ------------------------------------------------------------
    const walker = accounts.target;
    await h.connectAndJoin(walker);
    const selves = [];
    walker.socket.on('authoritativePlayerState', payload => selves.push(payload));
    const entered = waitForTransfer(walker);
    const started = await h.socketAck(walker.socket, 'globalTravelStart', {
      targetLocationId: 'wasteland', worldPoint: centerOf(entry[0] + 4, entry[1])
    });
    assert(started.ok, JSON.stringify(started).slice(0, 300));
    const transfer = await entered;
    assert.equal(transfer.pvpMode, 'pvpBlack');
    let dangerCell = null;
    for (let i = 0; i < 20 && !dangerCell; i += 1) {
      dangerCell = [...selves].reverse().find(payload => payload?.dangerCell)?.dangerCell || null;
      if (!dangerCell) await delay(250);
    }
    assert(dangerCell, 'the player in a Core scene knows the cell');
    const listed = walk.cells.find(row => row[0] === dangerCell.sx && row[1] === dangerCell.sy);
    assert(listed, 'the scene is one of the numbered Core cells');
    assert.equal(dangerCell.number, listed[2]);
    assert.equal(dangerCell.title, `${walk.names[listed[3]]} №${listed[2]}`);
    assert.equal(dangerCell.walk, true);
    console.log(`PASS a Core scene carries its numbered name, the same as on the map ("${dangerCell.title}")`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Map Core cells network OK: numbered Core cells and the playable contour on the map, and Core scenes named with their number.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
