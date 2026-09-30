#!/usr/bin/env node
'use strict';

// Городская живность на настоящем сервере. В мирном городе живут крысюки:
// мирные, не собеседники, внутри стен. Удар кулаком не злит зверька — он
// удирает и не кусает в ответ, а потом возвращается к своему месту. Кирка
// убивает его, с туши снимают шкуру тира города (Т1), а на место убитого
// через срок возрождения приходит новый крысюк.
// Сначала сервер показывает места зверьков, потом охотники встают у одного из
// них: так проверка не угадывает, где в городе открытый двор.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const tiers = require('../src/server/kromka-tiers');
const critters = require('../src/server/city-critters');
const { TILES, WALL_HALF } = require('../src/server/city-builder');

const ROOT = path.resolve(__dirname, '..');
const CITY = 'relayStation';
const RESPAWN_SECONDS = 5;
const authored = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'city-critters.json'), 'utf8'));
// Проверке не ждать три минуты и не держать охотников в шести метрах от места.
const CONFIG_FILE = path.join(h.DATA_DIR, 'city-critters.check.json');
fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...authored, respawnSeconds: RESPAWN_SECONDS, minPlayerDistance: 0 }));
process.env.KROMKA_CITY_CRITTERS_FILE = CONFIG_FILE;
const config = critters.normalizeCityCritters(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
const { config: tierConfig } = tiers.readTieredCatalogs(path.join(ROOT, 'data'));
const HIDE_T1 = tierConfig.families.find(family => family.resourceType === 'hide').raw.ids[0];
const accounts = {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));

function saves() {
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const file = path.join(h.DATA_DIR, 'saves.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    state: role => data.characters[users.users[accounts[role].login].id][accounts[role].characterId].state,
    write: () => fs.writeFileSync(file, JSON.stringify(data))
  };
}

/** Горожанин с оружием в руках; point — где стоит (без него — у точки появления города). */
function seedCitizen(state, weapon, point = null) {
  state.currentLocationId = CITY;
  state.serverLocationContext = { locationId: CITY };
  state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
  state.inventory = { ...(state.inventory || {}), ...(weapon === 'fists' ? {} : { [weapon]: 1 }) };
  state.equipment = { ...(state.equipment || {}), weapon, offhand: '' };
  state.player = { ...(state.player || {}), hp: 100, itemConditions: { ...(state.player?.itemConditions || {}), [weapon]: 100 } };
  if (point) { state.player.x = point.x; state.player.z = point.z; } else { delete state.player.x; delete state.player.z; }
}

/** Живые снимки NPC комнаты по сокету: последний вид каждого и история позиций. */
function watchEnemies(account) {
  const view = { rows: new Map(), seen: new Map(), killed: [] };
  const take = rows => {
    for (const row of rows || []) {
      view.rows.set(row.id, row);
      if (!view.seen.has(row.id)) view.seen.set(row.id, []);
      view.seen.get(row.id).push({ x: row.x, z: row.z, aiState: row.aiState, t: Date.now() });
    }
  };
  take(account.join.worldState?.enemies || account.join.enemies);
  account.socket.on('enemySnapshot', payload => {
    view.rows.clear();
    take(payload?.enemies);
  });
  account.socket.on('enemyKilled', payload => view.killed.push(payload));
  view.rats = () => [...view.rows.values()].filter(row => row.creatureTypeId === config.species && !row.dead);
  return view;
}

async function until(label, test, timeoutMs = 10000, describe = () => '') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = test();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`Timed out: ${label} ${describe()}`);
}

/** След зверька по снимкам: состояние и точка, для сообщения об ошибке. */
function trail(view, id) {
  return (view.seen.get(id) || []).filter((row, index, rows) => index % 4 === 0 || index === rows.length - 1)
    .map(row => `${row.aiState}@${Number(row.x).toFixed(1)},${Number(row.z).toFixed(1)}`).join(' ');
}

let attackSequence = 0;
function strike(account, rat, weapon, self) {
  return h.socketAck(account.socket, 'enemyHit', {
    weapon, enemyId: rat.id, mode: 'single',
    attackToken: `city_critter_${Date.now().toString(36)}_${++attackSequence}`,
    shotDirX: rat.x - self.x, shotDirZ: rat.z - self.z, skillRanks: {}, talentRanks: {}
  });
}

/** Подойти к зверьку пакетами движения; state {x, z} обновляется по ответам сервера. */
async function approach(account, state, target, reach = 1.4) {
  let seq = Number(state.seq || 1);
  for (let frame = 0; frame < 60 && distance(state, target) > reach; frame += 1) {
    const dx = target.x - state.x, dz = target.z - state.z, length = Math.hypot(dx, dz);
    const result = await h.socketAck(account.socket, 'state', {
      seq: seq++, x: target.x - dx / length * reach * 0.8, z: target.z - dz / length * reach * 0.8,
      angle: Math.atan2(dx, dz), moving: true, turning: false, crouching: false,
      vx: 5.5 * dx / length, vz: 5.5 * dz / length
    });
    const self = result?.self || result || {};
    if (Number.isFinite(Number(self.x))) state.x = Number(self.x);
    if (Number.isFinite(Number(self.z))) state.z = Number(self.z);
    await wait(58);
  }
  state.seq = seq;
  return distance(state, target) <= reach + 0.6;
}

/** Постоять на месте: ответ сервера несёт авторитетное состояние персонажа. */
async function standStill(account, state) {
  const seq = Number(state.seq || 1);
  state.seq = seq + 1;
  const result = await h.socketAck(account.socket, 'state', {
    seq, x: state.x, z: state.z, angle: 0, moving: false, turning: false, crouching: false, vx: 0, vz: 0
  });
  return result?.self || result || {};
}

(async () => {
  await h.bootstrapCharacters(accounts);
  let book = saves();
  seedCitizen(book.state('harvest'), 'fists');
  book.write();

  // 1. Места зверьков: столько, сколько задано, внутри стен, мирные и не собеседники.
  let slot = null;
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.harvest);
    assert.equal(accounts.harvest.join.roomId.split(':')[0], CITY, 'the scout joined the city');
    const scout = watchEnemies(accounts.harvest);
    const rats = await until('the city fills its critter slots', () => {
      const rows = scout.rats();
      return rows.length >= config.perCity ? rows : null;
    });
    assert.equal(rats.length, config.perCity, 'every critter slot of the city is filled');
    for (const rat of rats) {
      assert.equal(rat.name, 'Крысюк');
      assert.equal(rat.modelKey, 'kromkaRat', 'the rat renders its own model');
      assert.equal(rat.prey, true, 'a city critter is prey');
      assert.equal(rat.hostileToPlayer, false, 'a city critter is not an enemy');
      assert.equal(rat.canDialogue, false, 'a city critter does not talk');
      const tx = Math.floor(rat.x / 2 + TILES / 2), tz = Math.floor(rat.z / 2 + TILES / 2);
      assert(Math.abs(tx - TILES / 2) < WALL_HALF && Math.abs(tz - TILES / 2) < WALL_HALF,
        `a city critter lives inside the wall: ${JSON.stringify({ x: rat.x, z: rat.z })}`);
    }
    // Первый снимок зверька — точка его появления, то есть место слота.
    slot = scout.seen.get(rats[0].id)[0];
    console.log(`PASS ${CITY} holds ${rats.length} peaceful rats inside its wall`);
  } finally {
    h.closeSocket(accounts.harvest);
    await wait(2500);
    await h.stopServer();
  }

  // 2. Охотники у места зверька: кулак пугает, кирка убивает, туша даёт шкуру Т1.
  book = saves();
  seedCitizen(book.state('harvest'), 'fists', { x: slot.x + 0.45, z: slot.z });
  seedCitizen(book.state('trade'), 'pickaxe', { x: slot.x - 0.45, z: slot.z });
  book.write();
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.harvest);
    await h.connectAndJoin(accounts.trade);
    const scoutSelf = { x: accounts.harvest.join.self.x, z: accounts.harvest.join.self.z };
    const hunterSelf = { x: accounts.trade.join.self.x, z: accounts.trade.join.self.z };
    const view = watchEnemies(accounts.trade);
    const nearest = () => view.rats().sort((a, b) => distance(a, slot) - distance(b, slot))[0];
    const rat = await until('the rat of the slot is back', () => {
      const row = nearest();
      return row && distance(row, slot) < 4 ? row : null;
    });

    // Кулак: попадание не убивает, зверёк не отвечает — он удирает.
    let punch = null;
    for (let attempt = 0; attempt < 10 && !punch?.hit; attempt += 1) {
      const current = view.rows.get(rat.id) || rat;
      await approach(accounts.harvest, scoutSelf, current);
      punch = await strike(accounts.harvest, current, 'fists', scoutSelf);
      assert(punch.ok && !punch.protected, 'a city critter can be hit in the peaceful city: ' + JSON.stringify(punch).slice(0, 300));
      if (!punch.hit) await wait(1300);
    }
    assert(punch?.hit && !punch.killed && punch.enemy.hp < punch.enemy.maxHp,
      'a punch wounds the rat: ' + JSON.stringify(punch).slice(0, 300));
    const scoutHp = Number(punch.self?.hp);
    const fled = await until('the struck rat flees', () => {
      const row = view.rows.get(rat.id);
      return row && row.aiState === 'flee' ? row : null;
    }, 3000);
    assert.equal(fled.hostileToPlayer, false, 'a struck rat does not turn hostile');
    await until('the rat runs off', () => distance(view.rows.get(rat.id), scoutSelf) > 4, 4000,
      () => `scout ${scoutSelf.x.toFixed(1)},${scoutSelf.z.toFixed(1)}; trail ${trail(view, rat.id)}`);
    await wait(1500);
    const hpAfter = Number((await standStill(accounts.harvest, scoutSelf)).hp);
    assert(Number.isFinite(scoutHp) && hpAfter >= scoutHp, `the rat does not bite back: ${scoutHp} -> ${hpAfter}`);
    console.log('PASS a punched rat flees instead of fighting back and stays peaceful');

    // Кирка: испуг проходит, зверёк возвращается к своему двору, охотник добивает его.
    await until('the rat calms down near its slot', () => {
      const row = view.rows.get(rat.id);
      return row && row.aiState !== 'flee' && row.aiState !== 'return' && distance(row, slot) <= config.wanderRadius * 2 ? row : null;
    }, 15000, () => `slot ${slot.x.toFixed(1)},${slot.z.toFixed(1)}; trail ${trail(view, rat.id)}`);
    let blow = null;
    for (let attempt = 0; attempt < 14 && !blow?.killed; attempt += 1) {
      const current = view.rows.get(rat.id);
      assert(current, 'the wounded rat is still in the room');
      if (current.aiState === 'flee' || current.aiState === 'return') { await wait(700); continue; }
      await approach(accounts.trade, hunterSelf, current, 1.6);
      blow = await strike(accounts.trade, view.rows.get(rat.id) || current, 'pickaxe', hunterSelf);
      assert(blow.ok && !blow.protected, 'the hunter strikes the rat: ' + JSON.stringify(blow).slice(0, 300));
      if (!blow.killed) await wait(1300);
    }
    assert(blow?.killed, 'a pickaxe kills the rat: ' + JSON.stringify(blow).slice(0, 300));
    const killed = await until('the room hears the kill', () => view.killed.find(row => row.enemyId === rat.id), 3000);
    assert(killed.carcassId, 'a slain city rat leaves a carcass: ' + JSON.stringify(killed));
    const diedAt = Date.now();
    console.log('PASS a pickaxe kills the rat and leaves a carcass');

    // Туша: узел «шкура» тира города, свежуется как любой ресурс.
    const started = await h.socketAck(accounts.trade.socket, 'startGather', { id: killed.carcassId });
    assert(started.ok && started.resource?.type === 'hide' && started.resource.tier === 1 && started.resource.carcass === true,
      'the carcass is a T1 hide node of the city: ' + JSON.stringify(started).slice(0, 300));
    assert(started.resource.maxHp >= config.hideQty[0] && started.resource.maxHp <= config.hideQty[1],
      'the rat carcass holds the authored number of hides: ' + JSON.stringify(started.resource));
    await wait(Number(started.cycleMs || 2500));
    const skinned = await h.socketAck(accounts.trade.socket, 'harvestResource', {
      id: killed.carcassId, skillRanks: {}, talentRanks: {}
    });
    assert(skinned.ok && skinned.item?.id === HIDE_T1 && skinned.item.qty >= 1,
      `skinning the rat yields ${HIDE_T1}: ` + JSON.stringify(skinned).slice(0, 300));
    await h.socketAck(accounts.trade.socket, 'stopGather', {});
    console.log(`PASS skinning the rat gives a T1 hide (${HIDE_T1})`);

    // Возрождение: на место убитого приходит новый крысюк.
    const reborn = await until('a new rat takes the slot', () => {
      const rows = view.rats();
      const fresh = rows.find(row => row.id !== rat.id && !view.seen.get(row.id)?.some(seen => seen.t < diedAt));
      return rows.length >= config.perCity && fresh ? fresh : null;
    }, (RESPAWN_SECONDS + 8) * 1000);
    assert(Date.now() - diedAt >= RESPAWN_SECONDS * 1000 - 500, 'the new rat waited for the respawn time');
    assert(distance(view.seen.get(reborn.id)[0], slot) < 7, 'the new rat appears at the slot of the slain one');
    console.log(`PASS a new rat takes the slot ${RESPAWN_SECONDS} s after the kill`);
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await wait(1500);
    await h.stopServer();
  }
  h.cleanupSync();
  console.log('City critters network OK: peaceful rats inside the city wall, flight instead of a fight, a T1 hide from the carcass, respawn at the slot.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
