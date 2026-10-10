#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { io } = require('socket.io-client');
const h = require('./check-combat-runtime');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(h.DATA_DIR, 'stalker-check-'));
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
const authored = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/danger-ecology.json'), 'utf8'));
authored.tickSeconds = 1;
authored.lairs.capacity = { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 };
authored.species = authored.species.filter(row => row.id === 'neutral_stalkers')
  .map(row => ({ ...row, travel: { ...row.travel, count: 0, artifactSearchSeconds: 1 } }));
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify(authored));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');
const routes = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/open-world-alife.json'), 'utf8')).anomalyRoutes;
fs.writeFileSync(path.join(scratch, 'open-world-alife.json'), JSON.stringify({ anomalyRoutes: routes, huntingGrounds: [], outposts: [] }));
process.env.KROMKA_OPEN_WORLD_ALIFE_FILE = path.join(scratch, 'open-world-alife.json');

const zone = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/zone-graph.json'), 'utf8'))
  .zones.find(row => row.id === 'z_08_07');
assert(zone && routes.includes(zone.id));
const now = Date.now();
const birthId = `birth:${zone.id}:s14_anom2:network`;
fs.writeFileSync(path.join(h.DATA_DIR, 'saves.json'), JSON.stringify({
  version: 2, characters: {}, claimedArtifactIds: [],
  anomalyBirths: { version: 1, locations: { [zone.id]: {
    lastCheckAt: { s14_anom2: now }, lastEmissionId: '', births: 1,
    artifacts: { s14_anom2: { id: birthId, fieldId: 's14_anom2', typeId: 'drop',
      itemId: 'artifactDrop', tier: 1, seed: 'private-test-seed', sourceAnomalyType: 'dew',
      x: -103, z: -25, bornAt: now, emissionId: '' } }
  } } }
}));
fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
  version: 1, mapRevision: 'network-seed', nextId: 2, lairs: [],
  groups: [{ id: 'g1', speciesId: 'neutral_stalkers', lairId: '', sx: zone.col, sy: zone.row,
    members: [
      { id: 'm1', type: 'patrol_guard', spec: 0, name: 'Сталкер А', hp: 80, maxHp: 80 },
      { id: 'm2', type: 'patrol_guard', spec: 0, name: 'Сталкер Б', hp: 80, maxHp: 80 }
    ], state: 'rest', target: null, restUntil: now + 60000, nextStepAt: now + 60000,
    shakenUntil: 0, size0: 2, bornAt: now, home: zone.id, dest: zone.id,
    route: null, routeIndex: 0 }]
}));

const health = () => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + '/health', res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readSaves = () => JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'saves.json'), 'utf8'));
const socketConnection = () => new Promise((resolve, reject) => {
  const socket = io(h.baseUrl(), { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000 });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', reject);
});

(async () => {
  await h.startServer();
  try {
    assert((await health()).ok);
    const socket = await socketConnection();
    socket.close();
    let save = null;
    for (let i = 0; i < 30; i += 1) {
      save = readSaves();
      if (save.anomalyBirths?.npcClaims?.[birthId]) break;
      await delay(500);
    }
    const claim = save?.anomalyBirths?.npcClaims?.[birthId];
    assert(claim && claim.groupId === 'g1' && ['m1', 'm2'].includes(claim.memberId),
      'One offscreen stalker received the claimed birth.');
    assert(!save.anomalyBirths.locations[zone.id].artifacts.s14_anom2, 'The birth is deleted in the same saves snapshot.');
    assert(save.claimedArtifactIds.includes(birthId));
    assert.equal(Object.values(save.anomalyBirths.npcClaims).filter(row => row.id === birthId).length, 1);
    await h.stopServer();
    await h.startServer();
    assert((await health()).ok);
    const recovered = readSaves();
    assert.equal(recovered.anomalyBirths.npcClaims[birthId].memberId, claim.memberId);
    assert(!recovered.anomalyBirths.locations[zone.id].artifacts.s14_anom2);
    console.log('PASS offscreen stalker claims one birth durably, /health and Socket.IO respond, restart keeps the spawn removed');
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
