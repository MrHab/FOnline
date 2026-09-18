#!/usr/bin/env node
'use strict';

// Сетевая проверка видимости на глобальной карте и клеток Сердцевины на
// настоящем сервере:
//  - /api/global-map отдаёт клетки Сердцевины с постоянными номерами и
//    играбельный контур;
//  - игрок на карте видит группы A-Life только в радиусе, который даёт
//    «Странник», а другого игрока — ещё и с поправкой на его «Странника»:
//    внутри своего радиуса можно не заметить скрытного;
//  - в сцене клетки Сердцевины игрок знает её имя с номером — то же, что на карте.

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
economy.worldModel.dangerEcology = true;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-map-sightings-'));
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
const SIGHTINGS = { baseKm: 4, wandererKm: 10, stealthShare: 0.9, maxGroups: 40, maxPlayers: 30 };
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({
  tickSeconds: 1,
  lairs: { density: { pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  roam: { restMinutes: [60, 60], stepSeconds: [600, 600], huntStepSeconds: [600, 600], senseSeconds: 600, radius: 1 },
  sightings: SIGHTINGS,
  species: [
    { id: 'test_gari', name: 'Стая гари', kind: 'monster', faction: 'gari',
      members: [{ type: 'gari', name: 'Гарь', min: 3, max: 3 }],
      habitat: { pvp: 1, pvpFullDrop: 1, pvpBlack: 1 }, perceptionCells: 0, aggression: 0 }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUB = economy.dangerCells.subCellKm; // 1 точка карты = 1 км
const centerOf = (sx, sy) => ({ x: (sx + 0.5) * SUB, y: (sy + 0.5) * SUB });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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
  const watcher = { x: 200, y: 60 };
  onMap('untargeted', watcher);
  onMap('harvest', { x: watcher.x + 1.5, y: watcher.y });
  onMap('trade', { x: watcher.x, y: watcher.y + 4.9 });
  const walkerStart = centerOf(entry[0] - 3, entry[1]);
  onMap('target', walkerStart);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  // Группы на разных расстояниях от наблюдателя.
  const cell = { sx: Math.floor(watcher.x / SUB), sy: Math.floor(watcher.y / SUB) };
  const offsets = [[1, 0], [0, 3], [5, 0], [0, -8], [13, 0]];
  const member = id => ({ id, type: 'gari', hp: 39, maxHp: 39 });
  const far = Date.now() + 3600000;
  const groups = offsets.map(([dx, dy], index) => ({
    id: `g${index}`, speciesId: 'test_gari', lairId: '', sx: cell.sx + dx, sy: cell.sy + dy,
    members: [member('m1'), member('m2'), member('m3')], state: 'rest', target: null,
    restUntil: far, nextStepAt: far, size0: 3, bornAt: 0
  }));
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({ version: 1, mapRevision: 'sightings-check', nextId: 50, lairs: [], groups }));

  await h.startServer();
  try {
    const seen = {};
    for (const role of ['untargeted', 'harvest', 'trade']) {
      await h.connectAndJoin(accounts[role]);
      accounts[role].socket.on('globalMapSightings', payload => { seen[role] = payload; });
    }
    await delay(4500);
    const view = seen.untargeted;
    assert(view, 'the watcher on the map receives sightings');
    const radius = Number(view.radiusKm);
    const norm = (radius - SIGHTINGS.baseKm) / SIGHTINGS.wandererKm;
    assert(radius > SIGHTINGS.baseKm && radius < SIGHTINGS.baseKm + SIGHTINGS.wandererKm, `the radius grows with the wanderer skill (${radius} km)`);

    // --- группы: только в радиусе -------------------------------------------------------------
    for (const group of groups) {
      const at = centerOf(group.sx, group.sy);
      const visible = view.groups.some(row => row.id === group.id);
      const inside = dist(at, watcher) <= radius;
      assert.equal(visible, inside, `${group.id} at ${dist(at, watcher).toFixed(1)} km: visible ${visible}, inside ${inside} of ${radius} km`);
      if (visible) {
        const row = view.groups.find(item => item.id === group.id);
        assert.equal(row.name, 'Стая гари');
        assert.equal(row.size, 3);
        assert.equal(row.creatureTypeId, 'gari');
      }
    }
    const shown = view.groups.length;
    assert(shown >= 1 && shown < groups.length, 'some groups are in sight, some are not');
    console.log(`PASS groups are seen only within the wanderer radius (${radius} km: ${shown} of ${groups.length})`);

    // --- игроки: свой радиус и чужой «Странник» -------------------------------------------------
    const exposure = 1 - SIGHTINGS.stealthShare * norm;
    const near = view.players.find(row => row.name === accounts.harvest.characterName || row.id === accounts.harvest.socket.id);
    assert(near, 'a player 1.5 km away is seen: ' + JSON.stringify(view.players));
    const hiddenDistance = 4.9;
    assert(hiddenDistance <= radius && hiddenDistance > radius * exposure,
      `the check needs a player inside the radius (${radius}) but beyond the stealth distance (${(radius * exposure).toFixed(2)})`);
    assert(!view.players.some(row => row.id === accounts.trade.socket.id),
      'a player inside the radius is still missed thanks to his own wanderer skill');
    assert(seen.harvest?.players?.some(row => row.id === accounts.untargeted.socket.id), 'sightings are mutual at close range');
    console.log(`PASS players are seen within the radius shortened by their own wanderer skill (${hiddenDistance} km hidden, stealth distance ${(radius * exposure).toFixed(2)} km)`);

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
  console.log('Map sightings network OK: numbered Core cells and the playable contour on the map, groups seen within the wanderer radius, players hidden by their own wanderer skill, and Core scenes named with their number.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
