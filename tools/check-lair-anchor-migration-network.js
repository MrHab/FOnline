#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const h = require('./check-combat-runtime');

const root = path.resolve(__dirname, '..');
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
const economyFile = path.join(h.DATA_DIR, 'migration-economy.json');
fs.writeFileSync(economyFile, JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = economyFile;

const siteId = 'lair_z_06_10_1';
const old = { id: siteId, speciesId: 'raider_band', sx: 6, sy: 10,
  mode: 'pvpFullDrop', region: 'ore_arc', slot: 1, kind: 'lair',
  tx: 88, tz: 9, x: 17, z: -141, radius: 12,
  destroyedAt: Date.now(), refillAt: Date.now() + 5 * 60000,
  lootClaimed: false, loot: [{ id: 'scrap', qty: 3 }], claimRoomId: '' };
const file = path.join(h.DATA_DIR, 'danger-ecology.json');
fs.writeFileSync(file, JSON.stringify({ version: 1, mapRevision: 'before-authored-anchors',
  nextId: 1, lairs: [old], groups: [] }));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const connect = () => new Promise((resolve, reject) => {
  const socket = io(h.baseUrl(), { transports: ['websocket'], forceNew: true,
    reconnection: false, timeout: 3000 });
  socket.once('connect', () => { socket.close(); resolve(); });
  socket.once('connect_error', reject);
});

(async () => {
  await h.startServer();
  try {
    await connect();
    let state = null;
    for (let i = 0; i < 30; i++) {
      state = read();
      if (state.mapRevision !== 'before-authored-anchors') break;
      await delay(500);
    }
    assert(state && state.mapRevision !== 'before-authored-anchors',
      'The server migrates lairs to the new authored anchor revision.');
    const migrated = state.lairs.find(row => row.id === siteId);
    const authored = require('../data/kromka/open-world-alife.json').lairAnchors.find(row => row.id === siteId);
    assert(migrated && authored);
    assert.deepEqual([migrated.tx, migrated.tz, migrated.x, migrated.z],
      [authored.tx, authored.tz, authored.x, authored.z]);
    assert.equal(migrated.speciesId, old.speciesId);
    assert.equal(migrated.destroyedAt, old.destroyedAt);
    assert.equal(migrated.refillAt, old.refillAt);
    assert.deepEqual(migrated.loot, old.loot);
    assert.equal(state.lairs.filter(row => row.kind === 'lair').length, 237);
    await h.stopServer();
    await h.startServer();
    await connect();
    const restarted = read().lairs.find(row => row.id === siteId);
    assert.deepEqual([restarted.speciesId, restarted.tx, restarted.tz,
      restarted.destroyedAt, restarted.refillAt, restarted.loot],
    [old.speciesId, authored.tx, authored.tz, old.destroyedAt, old.refillAt, old.loot]);
    console.log('PASS 237 stable lair IDs migrate to authored anchors with species, cooldown and loot intact across restart');
  } finally {
    await h.stopServer();
    h.cleanupSync();
  }
})().catch(async error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  await h.stopServer();
  h.cleanupSync();
  process.exitCode = 1;
});
