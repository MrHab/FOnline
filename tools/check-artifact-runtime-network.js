'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};
const qty = (self, id) => (self.inventory || []).filter(r => r.id === id).reduce((sum, r) => sum + r.qty, 0);

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const account = accounts.trade;
  const state = saves.characters[users.users[account.login].id][account.characterId].state;
  Object.assign(state.inventory, { food: 3, water: 3, stim: 3, artifactDew: 1, artifactBelt4: 1 });
  state.equipment.artifactBelt = 'artifactBelt4';
  state.artifactRecords = [{ id: 'network_dew', typeId: 'dew', itemId: 'artifactDew', stabilized: true }];
  state.artifactSlots = ['network_dew'];
  state.player.hp = 20;
  state.artifactRuntime = { hydration: 35 };
  fs.writeFileSync(savesPath, JSON.stringify(saves));
  await h.startServer(); // startServer checks /health; connectAndJoin uses real Socket.IO.
  await h.connectAndJoin(account);
  const req = async (event, data, ok = true) => {
    const response = await h.socketAck(account.socket, event, data);
    assert.equal(response.ok, ok, `${event}: ${JSON.stringify(response)}`);
    return response;
  };
  const selfId = account.join.self.id;
  assert(account.join.self.artifactEffects.flags.foodHealingDisabled);
  assert(account.join.self.artifactRuntime.hydration <= 35);
  await req('healPlayer', { targetId: selfId, itemId: 'food' }, false);
  let response = await req('state', { profileOnly: true,
    artifactRuntime: { hydration: 100, stimUntil: Date.now() + 86400000 },
    artifactEffects: { flags: { foodHealingDisabled: false }, stimDurationPct: 99 } });
  assert.equal(qty(response.self, 'food'), 3, 'Rejected food must not be consumed');
  assert(response.self.artifactRuntime.hydration < 36, 'Client cannot refill hydration');
  assert.equal(response.self.artifactRuntime.stimSeconds, 0, 'Client cannot inject buffs');
  response = await req('healPlayer', { targetId: selfId, itemId: 'water' });
  assert.equal(response.hydrated, 40);
  assert.equal(qty(response.self, 'water'), 2);
  assert(response.self.artifactRuntime.hydration > 74 && response.self.artifactRuntime.hydration <= 75);
  response = await req('healPlayer', { targetId: selfId, itemId: 'stim' });
  assert(response.healed > 0, 'Existing instant heal stays intact');
  assert(response.self.artifactRuntime.stimSeconds > 11 && response.self.artifactRuntime.stimSeconds <= 12);
  const duration = response.self.artifactRuntime.stimSeconds;
  assert.equal(qty(response.self, 'stim'), 2);
  await req('artifactLoadoutAction', { action: 'unequip', recordId: 'network_dew' });
  response = await req('healPlayer', { targetId: selfId, itemId: 'food' });
  assert.equal(response.healed, 10);
  assert.equal(qty(response.self, 'food'), 2);
  await req('healPlayer', { targetId: 'missing', itemId: 'water' }, false);
  response = await req('state', { profileOnly: true });
  assert.equal(qty(response.self, 'water'), 2);
  const hp = response.self.hp;
  h.closeSocket(account);
  await h.stopServer();
  await h.startServer();
  await h.connectAndJoin(account);
  const restored = account.join.self;
  assert(restored.artifactRuntime.hydration > 73 && restored.artifactRuntime.hydration < 76);
  assert(restored.artifactRuntime.stimSeconds < duration, 'Restart must not restart stim timer');
  assert.equal(restored.hp, hp);
  assert.equal(qty(restored, 'food'), 2);
  assert.equal(qty(restored, 'water'), 2);
  assert.equal(qty(restored, 'stim'), 2);
  assert.deepEqual(restored.artifactSlots, []);
  console.log('Artifact network OK: /health + Socket.IO, usable provisions, Dew restrictions/duration, forged state rejection, belt removal and restart persistence.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Object.values(accounts).forEach(h.closeSocket);
  await h.stopServer();
  h.cleanupSync();
});
