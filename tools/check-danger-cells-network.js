#!/usr/bin/env node
'use strict';

// Сетевая проверка опасных клеток (экономика v3, библия 18.1) на настоящем
// сервере: карта отдаёт цвета клеток, отряды NPC не видны, путь через
// красную клетку заканчивается серверной стычкой в общей сцене мелкой
// клетки — двое, кого стычка застала в одной клетке, оказываются в одной
// комнате, точка карты остаётся на месте стычки, частая смена маршрута
// бросков не отменяет, — а путь через мирный пояс столицы стычек не даёт.
// Шанс стычки поднят до единицы отдельным файлом экономики. Здесь проверяется
// стычка из пула встреч (A-Life выключен); стычки с группами A-Life
// проверяет check-danger-ecology-network.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'economy.json'), 'utf8'));
economy.dangerCells.encounterChance = { peaceful: 0, pve: 0, pvp: 1, pvpFullDrop: 1, pvpBlack: 1 };
economy.dangerCells.wandererReduction = 0;
economy.dangerCells.edgeGraceKm = 0.5;
economy.worldModel.dangerEcology = false;
const economyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-danger-')), 'economy.json');
fs.writeFileSync(economyFile, JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = economyFile;

const getJson = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});

const waitForTransfer = (account, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    account.socket.off('serverWorldTransfer', onTransfer);
    reject(new Error(`no danger cell encounter for ${account.role} in ${timeoutMs} ms`));
  }, timeoutMs);
  function onTransfer(payload) {
    if (payload?.reason !== 'dangerCell') return;
    clearTimeout(timer);
    account.socket.off('serverWorldTransfer', onTransfer);
    resolve(payload);
  }
  account.socket.on('serverWorldTransfer', onTransfer);
});

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const onMap = (role, x, y) => {
    const state = stateFor(role);
    state.globalMap = { onWorldMap: true, playerX: x, playerY: y };
  };
  // Двое у западного края — красный регион «Глухой обвод».
  onMap('untargeted', 15, 150);
  onMap('harvest', 15, 150);
  // Третий там же, но шлёт маршрут заново каждые 250 мс.
  onMap('trade', 5, 150);
  // Третий — в мирном поясе Створа.
  const map = JSON.parse(fs.readFileSync(path.join(root, 'data', 'global-map.json')));
  const sluice = map.nodes.find(node => (node.locationId || node.id) === 'sluiceCity');
  onMap('target', sluice.x + 3, sluice.y);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    // --- карта и отряды -----------------------------------------------------------
    const publicMap = await getJson('/api/global-map');
    const modes = new Set(Object.values(publicMap.map.cells).map(cell => cell.pvpMode));
    for (const mode of ['peaceful', 'pve', 'pvp', 'pvpFullDrop', 'pvpBlack']) {
      assert(modes.has(mode), `the map shows ${mode} cells: ${[...modes]}`);
    }
    assert.equal(publicMap.map.cells['1:15'].pvpMode, 'pvpFullDrop', 'the western edge is red');
    const coreNode = map.nodes.find(node => (node.locationId || node.id) === 'coreZone');
    assert.equal(publicMap.map.cells[`${Math.floor(coreNode.x / 10)}:${Math.floor(coreNode.y / 10)}`].pvpMode, 'pvpBlack', 'the core is black');
    const wasteland = await getJson('/api/wasteland');
    assert.deepEqual(wasteland.sim.parties, [], 'NPC parties are not on the map');
    console.log('PASS danger colours on the map and hidden NPC parties');

    // --- стычка в красной клетке ------------------------------------------------------
    for (const role of ['untargeted', 'harvest', 'target', 'trade']) await h.connectAndJoin(accounts[role]);
    const route = { targetLocationId: 'wasteland', worldPoint: { x: 15, y: 205 } };
    const firstTransfer = waitForTransfer(accounts.untargeted);
    const secondTransfer = waitForTransfer(accounts.harvest);
    const started = await Promise.all([
      h.socketAck(accounts.untargeted.socket, 'globalTravelStart', route),
      h.socketAck(accounts.harvest.socket, 'globalTravelStart', route)
    ]);
    assert(started.every(row => row.ok), 'both travellers set off: ' + JSON.stringify(started).slice(0, 300));
    const [a, b] = await Promise.all([firstTransfer, secondTransfer]);
    assert.equal(a.pvpMode, 'pvpFullDrop', 'the encounter keeps the red rules');
    assert.match(a.roomId, /^randomDryBasin#cell_\d+_\d+$/, 'a red silent ring cell uses the dry basin scene: ' + a.roomId);
    assert(economy.dangerCells.encounters.pvpFullDrop.includes(a.encounterId), 'the encounter comes from the red pool: ' + a.encounterId);
    assert((a.worldState?.enemies || []).some(row => row.hostileToPlayer !== false && !row.dead), 'the scene has threats');
    assert(a.worldPoint && Math.abs(a.worldPoint.x - 15) < 1 && a.worldPoint.y > 150, 'the scene remembers where on the map it happened');
    assert.equal(b.roomId, a.roomId, 'two travellers caught in one cell share the scene');
    console.log('PASS red cell encounter in a shared scene (' + a.roomId + ', ' + a.encounterId + ')');

    // Точка карты после стычки — место стычки, а не начало пути.
    h.closeSocket(accounts.untargeted);
    await new Promise(resolve => setTimeout(resolve, 800));
    const savedAll = JSON.parse(fs.readFileSync(savesPath));
    const saved = savedAll.characters[users.users[accounts.untargeted.login].id][accounts.untargeted.characterId].state.globalMap;
    assert(Math.abs(saved.playerX - a.worldPoint.x) < 0.5 && Math.abs(saved.playerY - a.worldPoint.y) < 0.5,
      `the map point stays where the encounter happened: ${JSON.stringify(saved)} vs ${JSON.stringify(a.worldPoint)}`);
    console.log('PASS the scene keeps the map point of the encounter');

    // --- смена маршрута не спасает от стычки --------------------------------------------
    const spamTransfer = waitForTransfer(accounts.trade, 20000);
    let spamming = true;
    const spam = (async () => {
      while (spamming) {
        await h.socketAck(accounts.trade.socket, 'globalTravelStart', { targetLocationId: 'wasteland', worldPoint: { x: 5, y: 60 } });
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    })();
    try {
      const spammed = await spamTransfer;
      assert.equal(spammed.reason, 'dangerCell');
    } finally {
      spamming = false;
      await spam.catch(() => {});
    }
    console.log('PASS re-sending the route every 250 ms does not skip the rolls');

    // --- мирный пояс ------------------------------------------------------------------
    let peacefulTransfer = null;
    accounts.target.socket.on('serverWorldTransfer', payload => { if (payload?.reason === 'dangerCell') peacefulTransfer = payload; });
    const calm = await h.socketAck(accounts.target.socket, 'globalTravelStart',
      { targetLocationId: 'wasteland', worldPoint: { x: sluice.x + 3, y: sluice.y - 20 } });
    assert(calm.ok, JSON.stringify(calm).slice(0, 300));
    await new Promise(resolve => setTimeout(resolve, 9000));
    assert.equal(peacefulTransfer, null, 'the capital belt is safe to cross');
    console.log('PASS no encounters in the peaceful and blue belt');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(path.dirname(economyFile), { recursive: true, force: true });
  }
  console.log('Danger cells network OK: coloured map cells, no visible NPC parties, server-side encounters in shared red cell scenes that keep the map point, rolls that survive re-routing, and a safe capital belt.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
