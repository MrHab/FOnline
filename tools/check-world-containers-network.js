#!/usr/bin/env node
'use strict';

// Сетевая проверка мировых контейнеров на реальном сервере (изолированный
// DATA_DIR). Раньше авторский ящик за пределами лабораторий был пуст всегда:
// случайные таблицы выключены, а списка у него не было. Здесь видно глазами
// клиента, что ящик отдаёт свой авторский список, что запертый не открывается,
// что забранное не возвращается и что «Нюх на тайники» добавляет материалы
// тому, кто открыл тайник первым с перком, — и только материалы.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const { createLocationCollision, circleBlockerPenalty } = require('../src/server/location-collision');
const accounts = {};

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const items = new Map(readJson('data/kromka/items.json').items.map(row => [row.id, row]));
const perkConfig = readJson('data/kromka/economy.json').lootPerks;
// Тайник места ищется в его локации, а у места, стоящего площадкой в зоне, — в секторе.
const definitionOf = locationId => (/^z_\d\d_\d\d$/.test(locationId)
  ? readJson(`data/zones/authored/${locationId}.json`) : readJson(`data/locations/${locationId}.json`));
const authored = (locationId, containerId) => definitionOf(locationId).containers
  .find(row => row.id === containerId);
// Ящики «Заставы 17»: застава стоит в своей зоне площадкой (zone-sites.js).
const OUTPOST_ZONE = 'z_10_10';
const outpostBoxes = definitionOf(OUTPOST_ZONE).containers.filter(row => row.site === 'roadOutpost');
const openBox = outpostBoxes.find(row => !row.locked);
const lockedBox = outpostBoxes.find(row => row.locked);
// Свободная точка в шаге от ящика: сервер не ставит игрока в преграду, а обыск — только рядом.
function besideBox(box) {
  const { locationObjectBlockers } = createLocationCollision({ tile: 2 });
  const blockers = (definitionOf(OUTPOST_ZONE).objects || []).flatMap(row => locationObjectBlockers(row));
  // Вход ставит персонажа на центр клетки 2 м, поэтому кандидаты — центры клеток у ящика.
  const centre = metres => (Math.floor(metres / 2 + 80) + 0.5 - 80) * 2;
  const spots = [];
  for (let dx = -4; dx <= 4; dx += 2) {
    for (let dz = -4; dz <= 4; dz += 2) {
      const x = centre(box.x + dx), z = centre(box.z + dz);
      const d = Math.hypot(x - box.x, z - box.z);
      if (d >= 1 && d <= 3) spots.push({ x, z, d });
    }
  }
  for (const { x, z } of spots.sort((a, b) => a.d - b.d)) {
    if (!blockers.every(blocker => circleBlockerPenalty(x, z, 0.6, blocker) <= 0)) continue;
    // И видно ящик: ни одна преграда, кроме модели самого ящика, не лежит на отрезке.
    const others = blockers.filter(blocker => blocker.objectId !== box.visualObjectId);
    let open = true;
    for (let t = 0.05; t < 1 && open; t += 0.05) {
      const px = x + (box.x - x) * t, pz = z + (box.z - z) * t;
      open = others.every(blocker => circleBlockerPenalty(px, pz, 0.05, blocker) <= 0);
    }
    if (open) return { x, z };
  }
  throw new Error(`no free spot beside ${box.id}`);
}
const byId = rows => Object.fromEntries((rows || []).map(row => [row.id, row.qty]));
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id).reduce((sum, row) => sum + row.qty, 0);
const containerOf = (account, defId) => (account.join.worldState?.containers || []).find(row => row.defId === defId);

(async () => {
  await h.bootstrapCharacters(accounts);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json')));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const place = (state, locationId, x, z) => {
    state.currentLocationId = locationId;
    state.serverLocationContext = { locationId };
    state.player = { ...(state.player || {}), x, z };
  };

  // Путник без перков — у открытого ящика заставы, второй — у запертого.
  const nearOpen = besideBox(openBox);
  const nearLocked = besideBox(lockedBox);
  place(stateFor('harvest'), OUTPOST_ZONE, nearOpen.x, nearOpen.z);
  place(stateFor('untargeted'), OUTPOST_ZONE, nearLocked.x, nearLocked.z);
  // Двое у ящика сторожевой артели: первый без перка, второй с «Нюхом на тайники».
  place(stateFor('trade'), 'scrapOutpost', 1.5, 9);
  const finder = stateFor('progression');
  place(finder, 'scrapOutpost', -1.5, 9);
  finder.player.level = 30;
  finder.characterProfile.special = { str: 5, per: 6, end: 5, cha: 4, int: 5, agi: 5, luck: 10 };
  finder.skillRanks = { ...(finder.skillRanks || {}), lockpick: 60 };
  finder.talentRanks = { cacheSense: 2 };
  delete finder.progressionLedger;
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    // --- открытый ящик отдаёт авторский список ------------------------------------------
    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.locationId, OUTPOST_ZONE);
    const ammoBox = containerOf(accounts.harvest, openBox.id);
    const expectedBox = openBox.loot;
    assert(ammoBox, 'The authored container reaches the client: ' + JSON.stringify((accounts.harvest.join.worldState?.containers || []).map(row => row.defId)));
    const opened = await h.socketAck(accounts.harvest.socket, 'openWorldContainer', { id: ammoBox.id });
    assert(opened.ok, 'An open box opens: ' + JSON.stringify(opened.error || opened).slice(0, 300));
    assert.deepEqual(byId(opened.container.loot), byId(expectedBox), 'The box holds exactly its authored list.');
    assert.equal(opened.container.empty, false, 'An authored container is not empty any more.');
    for (const row of opened.container.loot) {
      assert(['materials', 'aid', 'misc', 'ammo', 'currency'].includes(items.get(row.id).category),
        `The box holds ${row.id}: gear comes from player crafting only.`);
    }
    const before = Object.fromEntries(expectedBox.map(row => [row.id, qty(accounts.harvest.join.self, row.id)]));
    const taken = await h.socketAck(accounts.harvest.socket, 'lootWorldContainer', { id: ammoBox.id, mode: 'all' });
    assert(taken.ok, 'Take all works: ' + JSON.stringify(taken.error || taken).slice(0, 300));
    for (const row of expectedBox) {
      assert.equal(qty(taken.self, row.id), before[row.id] + row.qty, `The player receives ${row.qty} × ${row.id}.`);
    }
    console.log('PASS an authored container yields its list: ' + expectedBox.map(row => `${row.id}×${row.qty}`).join(', '));

    // --- забранное не возвращается -------------------------------------------------------
    const again = await h.socketAck(accounts.harvest.socket, 'openWorldContainer', { id: ammoBox.id });
    assert(again.ok && again.container.loot.length === 0 && again.container.empty === true,
      'A looted container stays looted: ' + JSON.stringify(again.container?.loot));
    const nothing = await h.socketAck(accounts.harvest.socket, 'lootWorldContainer', { id: ammoBox.id, mode: 'all' });
    assert(!nothing.ok, 'There is nothing to take twice.');
    assert.equal(qty(nothing.self || taken.self, expectedBox[0].id), before[expectedBox[0].id] + expectedBox[0].qty,
      'A second take duplicates nothing.');
    console.log('PASS a looted container stays empty');

    // --- запертый ящик не открывается -----------------------------------------------------
    await h.connectAndJoin(accounts.untargeted);
    const crate = containerOf(accounts.untargeted, lockedBox.id);
    assert(crate?.locked, 'The outpost crate is locked.');
    const refused = await h.socketAck(accounts.untargeted.socket, 'openWorldContainer', { id: crate.id });
    assert(!refused.ok && refused.locked === true, 'A locked container refuses to open: ' + JSON.stringify(refused).slice(0, 200) + ' at ' + JSON.stringify([accounts.untargeted.join.self.x, accounts.untargeted.join.self.z, nearLocked, crate.x, crate.z]));
    const scrapBefore = qty(accounts.untargeted.join.self, 'scrap');
    const forced = await h.socketAck(accounts.untargeted.socket, 'lootWorldContainer', { id: crate.id, mode: 'all' });
    assert(!forced.ok && forced.locked === true, 'A locked container cannot be looted around its lock.');
    assert.equal(qty(forced.self || accounts.untargeted.join.self, 'scrap'), scrapBefore, 'Nothing leaves a locked crate.');
    console.log('PASS a locked container keeps its loot');

    // --- «Нюх на тайники» -------------------------------------------------------------------
    const expectedCache = authored('scrapOutpost', 'guard_artel_crate').loot;
    await h.connectAndJoin(accounts.trade);
    await h.connectAndJoin(accounts.progression);
    assert.equal(accounts.progression.join.roomId, accounts.trade.join.roomId, 'Both visitors stand in the same outpost.');
    assert.equal(Number(accounts.progression.join.self?.talentRanks?.cacheSense), 2,
      'The finder keeps the perk: ' + JSON.stringify(accounts.progression.join.self?.talentRanks));
    const cache = containerOf(accounts.trade, 'guard_artel_crate');
    // Первым открывает игрок без перка: он видит авторский список и бонус не тратит.
    const plainView = await h.socketAck(accounts.trade.socket, 'openWorldContainer', { id: cache.id });
    assert(plainView.ok, JSON.stringify(plainView.error || plainView).slice(0, 300));
    assert.deepEqual(byId(plainView.container.loot), byId(expectedCache), 'Without the perk the cache is the authored cache.');
    const sensed = await h.socketAck(accounts.progression.socket, 'openWorldContainer', { id: cache.id });
    assert(sensed.ok, JSON.stringify(sensed.error || sensed).slice(0, 300));
    const bonus = 1 + perkConfig.cacheMaterialsPerRank * 2;
    assert.deepEqual(Object.keys(byId(sensed.container.loot)).sort(), Object.keys(byId(expectedCache)).sort(),
      'The perk adds no new kind of item: ' + JSON.stringify(sensed.container.loot));
    let materials = 0;
    for (const row of expectedCache) {
      const got = byId(sensed.container.loot)[row.id];
      if (items.get(row.id).category === 'materials') {
        materials += 1;
        assert(got >= Math.floor(row.qty * bonus) && got <= Math.ceil(row.qty * bonus) && got > row.qty,
          `${row.id}: rank 2 finds ${bonus}× the materials, got ${got} of ${row.qty}`);
      } else {
        assert.equal(got, row.qty, `${row.id} is not a material and must not grow.`);
      }
    }
    assert(materials > 0 && materials < expectedCache.length, 'The scenario covers both a material and a non-material stack.');
    // Второй раз бонус не срабатывает — ни у того же игрока, ни у другого.
    const second = await h.socketAck(accounts.progression.socket, 'openWorldContainer', { id: cache.id });
    assert.deepEqual(byId(second.container.loot), byId(sensed.container.loot), 'The bonus is applied once per cache.');
    const haul = await h.socketAck(accounts.progression.socket, 'lootWorldContainer', { id: cache.id, mode: 'all' });
    assert(haul.ok, JSON.stringify(haul.error || haul).slice(0, 300));
    for (const row of sensed.container.loot) {
      assert.equal(qty(haul.self, row.id) - qty(accounts.progression.join.self, row.id), row.qty, `The finder carries away ${row.qty} × ${row.id}.`);
    }
    console.log('PASS cacheSense: ' + expectedCache.map(row => `${row.id} ${row.qty}→${byId(sensed.container.loot)[row.id]}`).join(', '));
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
  console.log('World containers network OK: an authored container yields its list once, a lock keeps it, and cacheSense raises only the materials of a cache for its first finder.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
