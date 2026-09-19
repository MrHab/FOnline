'use strict';

// Общие помощники сетевых проверок зон мира: точка тайла зоны в метрах,
// персонаж, сохранённый в зоне, и ходьба настоящими пакетами движения.

const fs = require('node:fs');
const path = require('node:path');
const { TILES } = require('../../src/server/zone-builder');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Центр тайла зоны {tx, tz} в метрах сервера. */
function world(tile) {
  return { x: (tile.tx - TILES / 2 + 0.5) * 2, z: (tile.tz - TILES / 2 + 0.5) * 2 };
}

/** Записать в сохранение, что персонаж стоит в зоне (до запуска сервера). */
function placeInZone(h, accounts, role, locationId, point) {
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const state = saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  state.currentLocationId = locationId;
  state.player = { ...(state.player || {}), x: point.x, z: point.z };
  state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
  delete state.serverLocationContext;
  fs.writeFileSync(savesPath, JSON.stringify(saves));
}

/** Довести персонажа до точки пакетами движения; state {x, z} обновляется по ответам сервера. */
async function driveTo(h, account, state, x, z, maxFrames = 160) {
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

module.exports = { delay, driveTo, placeInZone, world };
