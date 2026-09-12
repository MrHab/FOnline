'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  for (const role of ['trade', 'target']) {
    const account = accounts[role];
    const state = saves.characters[users.users[account.login].id][account.characterId].state;
    state.currentLocationId = 'solarArray';
    state.serverLocationContext = { locationId: 'solarArray' };
    Object.assign(state.player, { x: 4, z: 3 });
    if (role === 'target') {
      state.kromkaQuestState.completed.side_iron_argument = { outcomeId: '', completedAt: Date.now() };
    }
  }
  fs.writeFileSync(savesPath, JSON.stringify(saves)); // Isolated disposable DATA_DIR only.
  await h.startServer(); // Includes /health.
  await h.connectAndJoin(accounts.trade);
  await h.connectAndJoin(accounts.target);
  const actor = accounts.trade, observer = accounts.target;
  const initial = actor.join.worldState.anomalies;
  assert.equal(initial.locationId, 'solarArray');
  assert.equal(initial.roomId, observer.join.worldState.anomalies.roomId);
  const chime = initial.fields.find(field => field.type === 'chime');
  assert(chime.active);
  assert.equal(actor.join.self.boltRangeMeters, 10, 'Ordinary client aiming range is authoritative');
  assert.equal(observer.join.self.boltRangeMeters, 13, 'Completed quest grants the client the magnetic aiming range');
  const packets = [], bolts = [];
  observer.socket.on('anomalyState', state => packets.push(state));
  observer.socket.on('boltThrown', state => bolts.push(state));
  const result = await h.socketAck(actor.socket, 'throwBolt', { x: chime.x, z: chime.z,
    hit: false, magnetic: true, from: { x: 999, z: 999 } });
  assert(result.ok && result.hit, JSON.stringify({ result, player: actor.join.self }));
  assert.equal(result.magnetic, false, 'The client cannot grant the magnetic upgrade');
  assert.equal(result.self.boltRangeMeters, 10);
  assert.equal(result.from.x, actor.join.self.x, 'Throw origin comes from the server player');
  assert.equal(result.anomaly.id, chime.id);
  assert(Math.abs(Math.hypot(result.anomaly.contact.x-chime.x, result.anomaly.contact.z-chime.z)-chime.radius)<0.001,
    'Visual contact must lie on the authoritative near edge');
  assert.equal(result.anomalies.fields.find(field => field.id === chime.id).active, false);
  const cooldown = await h.socketAck(actor.socket, 'throwBolt', { x: chime.x, z: chime.z });
  assert.equal(cooldown.ok, false, 'Server enforces cooldown');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert(packets.some(state => state.fields.some(field => field.id === chime.id && !field.active)),
    'Other players receive shared discharge');
  assert(bolts.some(bolt => bolt.anomaly?.id === chime.id && bolt.anomaly.contact), 'Observers receive contact for VFX');
  // Another player has no throw cooldown, but the same field is already discharged.
  const through = await h.socketAck(observer.socket, 'throwBolt', { x: chime.x, z: chime.z });
  assert(through.ok && !through.hit, JSON.stringify(through));
  assert.equal(through.magnetic, true, 'Quest upgrade survives persistence and is used by the server');
  console.log('Anomaly network OK: /health, two Socket.IO players, server origin/upgrade/cooldown, shared discharge and exact VFX contact.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
