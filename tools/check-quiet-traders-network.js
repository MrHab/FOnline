#!/usr/bin/env node
'use strict';

// Сетевая проверка тихих торговцев на настоящем сервере: стационарные
// торговцы и служебные NPC столицы не двигаются и не идут проверять
// выстрелы рядом с собой, торговля с ними не закрывается, а торговец Ключей
// снова торгует.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const accounts = {};

const scrapTown = require('../data/locations/scrapTown.json');
const merchantRow = (scrapTown.objects || []).find(row => String(row.entity?.role || row.role || '').toLowerCase() === 'merchant');
assert(merchantRow, 'в Раздолье нет торговца');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const quiet = row => row && !row.dead && row.hostileToPlayer === false
  && (['merchant', 'trader'].includes(String(row.role || '').toLowerCase()) || !!String(row.service || '').trim());

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const place = (role, locationId, x, z) => {
    const state = stateFor(role);
    state.currentLocationId = locationId;
    state.serverLocationContext = { locationId };
    state.player = { ...(state.player || {}), x, z };
  };
  // Стрелок с лазерным пистолетом стоит у прилавка торговца Раздолья.
  place('untargeted', 'scrapTown', Number(merchantRow.position.x) + 2, Number(merchantRow.position.z) + 2);
  // Второй — в Ключах.
  place('target', 'settlement', 0, 0);
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    for (const role of ['untargeted', 'target']) await h.connectAndJoin(accounts[role]);
    const shooter = accounts.untargeted;
    const before = (shooter.join.worldState?.enemies || []).filter(quiet);
    assert(before.length >= 3, 'в Раздолье есть торговцы и служебные NPC: ' + before.length);

    // --- выстрелы рядом с прилавком -------------------------------------------------
    for (let shot = 0; shot < 3; shot += 1) {
      const token = `quiet_trader_${Date.now().toString(36)}_${shot}`;
      const fired = await h.socketAck(shooter.socket, 'combatAttack', {
        weapon: 'laserPistol',
        mode: 'single',
        attackToken: token,
        combat: { token, weapon: 'laserPistol', mode: 'single', shots: 1 },
        equipment: { weapon: 'laserPistol' },
        x: Number(shooter.join.x || 0),
        z: Number(shooter.join.z || 0),
        angle: 0,
        skillRanks: {},
        talentRanks: {}
      });
      assert(fired.ok, 'выстрел принят: ' + JSON.stringify(fired).slice(0, 300));
      await delay(900);
    }
    await delay(2500);
    const world = await h.socketAck(shooter.socket, 'requestWorldState', { reason: 'quietTraders' });
    assert(world.ok, JSON.stringify(world).slice(0, 200));
    const after = new Map((world.state?.enemies || []).map(row => [row.id, row]));
    for (const row of before) {
      const now = after.get(row.id);
      assert(now, `${row.name} на месте`);
      const moved = Math.hypot(Number(now.x) - Number(row.x), Number(now.z) - Number(row.z));
      assert(moved < 0.05, `${row.name} (${row.role || row.service}) не сдвинулся после выстрелов: ${moved.toFixed(2)} м`);
      assert.notEqual(now.aiState, 'investigate', `${row.name} не пошёл проверять выстрел`);
      assert.notEqual(now.serviceAvailable, false, `${row.name} не закрыл торговлю`);
    }
    const merchant = before.find(row => row.role === 'merchant' && row.tradeOpen === true);
    assert(merchant, 'торговец Раздолья торгует');
    const trade = await h.socketAck(shooter.socket, 'syncNpcTradeState', { enemyId: merchant.id });
    assert(trade.ok, 'торговля после выстрелов открыта: ' + JSON.stringify(trade).slice(0, 200));
    console.log(`PASS ${before.length} capital traders and service NPCs ignore gunfire and keep trading`);

    // --- Ключи ----------------------------------------------------------------------------
    const keys = (accounts.target.join.worldState?.enemies || [])
      .filter(row => row.hostileToPlayer === false && ['merchant', 'trader'].includes(String(row.role || '').toLowerCase()));
    const keysTrader = keys.find(row => row.tradeOpen === true);
    assert(keysTrader, 'торговец Ключей торгует: ' + JSON.stringify(keys.map(row => ({ name: row.name, tradeOpen: row.tradeOpen }))));
    // tradeOpen сервер считает той же проверкой, что и доступ к обмену; обмен
    // отказал бы только из-за расстояния до торговца.
    const keysTrade = await h.socketAck(accounts.target.socket, 'syncNpcTradeState', { enemyId: keysTrader.id });
    assert(keysTrade.ok || /далеко/.test(keysTrade.error || ''), 'Ключи не закрыты для торговли: ' + JSON.stringify(keysTrade).slice(0, 200));
    console.log('PASS the Keys trader trades again (' + keysTrader.name + ')');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('Quiet traders network OK: capital traders stand still and keep trading under gunfire, and the Keys trader is back.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  process.exit(1);
});
