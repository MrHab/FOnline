#!/usr/bin/env node
'use strict';

// A player in Keys must see and use the city bank, while faction banks stay separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./check-combat-runtime');
const { cityDefinition, cityWorld } = require('./lib/zone-walk');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const qty = (rows, id) => (rows || []).filter(row => row.id === id)
  .reduce((sum, row) => sum + Number(row.qty || 0), 0);

(async () => {
  const accounts = {};
  await h.bootstrapCharacters(accounts);
  const player = accounts.trade;
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const state = saves.characters[users.users[player.login].id][player.characterId].state;
  const keys = cityDefinition('settlement');
  const storage = cityWorld('settlement', keys.cityPlan.bank.storage);

  state.currentLocationId = 'settlement';
  state.serverLocationContext = { locationId: 'settlement' };
  state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
  state.player = { ...(state.player || {}), x: storage.x, z: storage.z - 2.5 };
  state.inventory = { ...(state.inventory || {}), scrap: 3 };
  state.factionStorages = { ...(state.factionStorages || {}), city: { water: 2 }, uprava: { ammo9: 5 } };
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    await h.connectAndJoin(player);
    assert.equal(player.join.self.storageFaction, 'city');
    assert.equal(qty(player.join.self.storage, 'water'), 2);
    assert.equal(qty(player.join.self.storage, 'ammo9'), 0, 'faction storage must remain separate');

    const deposited = await h.socketAck(player.socket, 'storageTransfer', {
      direction: 'deposit', rows: [{ id: 'scrap', qty: 1 }], requestId: 'keys-deposit'
    });
    assert.equal(deposited.ok, true, JSON.stringify(deposited).slice(0, 400));
    assert.equal(deposited.storageFaction, 'city');
    assert.equal(qty(deposited.storage, 'scrap'), 1);
    assert.equal(qty(deposited.self.inventory, 'scrap'), 2);

    const withdrawn = await h.socketAck(player.socket, 'storageTransfer', {
      direction: 'withdraw', rows: [{ id: 'water', qty: 1 }], requestId: 'keys-withdraw'
    });
    assert.equal(withdrawn.ok, true, JSON.stringify(withdrawn).slice(0, 400));
    assert.equal(qty(withdrawn.storage, 'water'), 1);
    assert.equal(qty(withdrawn.self.inventory, 'water'), 1);

    h.closeSocket(player);
    await delay(800);
    await h.connectAndJoin(player);
    assert.equal(player.join.self.storageFaction, 'city');
    assert.equal(qty(player.join.self.storage, 'water'), 1);
    assert.equal(qty(player.join.self.storage, 'scrap'), 1);
    const saved = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
    const persisted = saved.characters[users.users[player.login].id][player.characterId].state;
    assert.equal(persisted.factionStorages.city.water, 1);
    assert.equal(persisted.factionStorages.city.scrap, 1);
    assert.equal(persisted.factionStorages.uprava.ammo9, 5);
    console.log('Keys city storage network OK: join, deposit, withdraw, reconnect and faction isolation.');
  } finally {
    h.closeSocket(player);
    await h.stopServer();
    h.cleanupSync();
  }
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  process.exitCode = 1;
});
