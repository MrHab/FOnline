#!/usr/bin/env node
'use strict';

// Сетевая проверка марок на счёте аккаунта (экономика v3) на настоящем
// сервере: марки из старого сохранения персонажа при входе добавляются к
// счёту, снимок игрока показывает общий баланс, марки нельзя выбросить или
// положить в хранилище фракции, траты уходят со счёта, сохранение держит
// марки на счёте, а не в персонаже, и второй персонаж того же аккаунта видит
// тот же баланс.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);
const sluice = require('../data/locations/sluiceCity.json');
const auctioneer = (sluice.objects || []).find(object => (object.entity || {}).service === 'auction');
assert(auctioneer, 'в Створе нет аукционера');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Хранилище Управы в Створе — точка из SERVER_FACTION_CAPITAL_STORAGE сервера.
const storageMatch = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  .match(/const SERVER_FACTION_CAPITAL_STORAGE = \{\s*sluiceCity: \{\s*x: (-?[\d.]+),\s*z: (-?[\d.]+)/);
assert(storageMatch, 'в сервере нет точки хранилища Створа');
const storagePoint = { x: Number(storageMatch[1]), z: Number(storageMatch[2]) };

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const account = accounts.trade;
  const userId = users.users[account.login].id;
  const store = saves.characters[userId];
  const first = store[account.characterId];
  // Персонаж со старыми марками в рюкзаке стоит у аукционера Створа.
  first.state.currentLocationId = 'sluiceCity';
  first.state.serverLocationContext = { locationId: 'sluiceCity' };
  first.state.inventory.silver = 500;
  first.state.player = { ...(first.state.player || {}), x: Number(auctioneer.position.x), z: Number(auctioneer.position.z) - 2 };
  // На счёте аккаунта уже 1000 марок.
  saves.accounts = { [userId]: { sin: 0, marks: 1000 } };
  // Второй персонаж того же аккаунта: без марок в рюкзаке.
  const secondId = `${account.characterId}_alt`;
  const second = JSON.parse(JSON.stringify(first));
  second.id = secondId;
  second.state.characterProfile = { ...(second.state.characterProfile || {}), serverCharacterId: secondId, name: 'Второй' };
  delete second.state.inventory.silver;
  // Второй персонаж стоит у хранилища Управы.
  second.state.player = { ...(second.state.player || {}), x: storagePoint.x, z: storagePoint.z - 2.5 };
  if (second.summary) second.summary = { ...second.summary, id: secondId, name: 'Второй' };
  store[secondId] = second;
  fs.writeFileSync(savesPath, JSON.stringify(saves));
  const readSaves = () => JSON.parse(fs.readFileSync(savesPath));

  await h.startServer();
  try {
    await h.connectAndJoin(account);
    const joined = account.join.self;
    assert.equal(qty(joined, 'silver'), 1500, 'the old backpack marks joined the account: ' + qty(joined, 'silver'));
    assert.equal(joined.account.marks, 1500, 'the player snapshot shows the account marks');
    await delay(300);
    let saved = readSaves();
    assert.equal(saved.accounts[userId].marks, 1500, 'the migration is saved on the account');
    assert(!Number(saved.characters[userId][account.characterId].state.inventory?.silver || 0), 'the character save keeps no marks');
    console.log('PASS old backpack marks move onto the account on join');

    const dropped = await h.socketAck(account.socket, 'dropItem', { itemId: 'silver', qty: 10 });
    assert.equal(dropped.ok, false);
    assert.match(dropped.error, /счёте/);
    console.log('PASS marks cannot be dropped');

    // Ордер на выкуп замораживает марки: они уходят со счёта.
    const bid = await h.socketAck(account.socket, 'auctionAction', {
      action: 'buy', itemId: 'ammo9', qty: 10, price: 20, durationHours: 24, requestId: 'marks-bid'
    });
    assert(bid.ok, JSON.stringify(bid).slice(0, 300));
    const spent = bid.escrow + bid.spent + bid.setupFee;
    assert.equal(qty(bid.self, 'silver'), 1500 - spent);
    assert.equal(bid.self.account.marks, 1500 - spent);
    console.log(`PASS spending takes marks from the account (${spent})`);

    h.closeSocket(account);
    await delay(800);
    saved = readSaves();
    assert.equal(saved.accounts[userId].marks, 1500 - spent, 'the account keeps the spent balance');
    assert(!Number(saved.characters[userId][account.characterId].state.inventory?.silver || 0), 'the character save still keeps no marks');

    // Второй персонаж аккаунта видит тот же счёт.
    const alt = { ...account, characterId: secondId, socket: null, join: null };
    await h.connectAndJoin(alt);
    assert.equal(qty(alt.join.self, 'silver'), 1500 - spent, 'the second character shares the account marks');
    assert.equal(alt.join.self.account.marks, 1500 - spent);
    console.log('PASS the second character of the account shares the marks');

    const stored = await h.socketAck(alt.socket, 'storageTransfer', {
      direction: 'deposit', rows: [{ id: 'silver', qty: 10 }], requestId: 'marks-storage'
    });
    // Хранилище фракции марок не принимает вовсе: строка марок отбрасывается.
    assert.equal(stored.ok, false, JSON.stringify(stored).slice(0, 300));
    assert.equal(qty(stored.self, 'silver'), 1500 - spent, 'the marks stay on the account');
    // Проба: обычный предмет в то же хранилище ложится — отказ именно про марки.
    const itemId = (alt.join.self.inventory || []).find(row => row.id !== 'silver' && row.qty > 0 && !row.equipped)?.id;
    if (itemId) {
      const control = await h.socketAck(alt.socket, 'storageTransfer', {
        direction: 'deposit', rows: [{ id: itemId, qty: 1 }], requestId: 'marks-storage-control'
      });
      assert(control.ok, 'the storage itself works: ' + JSON.stringify(control).slice(0, 300));
    }
    h.closeSocket(alt);
    console.log('PASS marks cannot be put into the faction storage' + (itemId ? ` (${itemId} can)` : ''));
  } finally {
    for (const row of Object.values(accounts)) h.closeSocket(row);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Account marks network OK: old backpack marks join the account, marks cannot be dropped or stored, spending uses the account, saves keep marks on the account and every character of the account shares them.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
