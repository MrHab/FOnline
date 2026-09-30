#!/usr/bin/env node
'use strict';

// Мешок и рюкзак на настоящем сервере, на арене красной зоны тира 1. Убитая Гарь
// роняет трофей мешком в шаге от тела, а само тело пустое. Мешок переживает
// перезапуск сервера, его обыскивают, и опустевший он исчезает у всех.
// Погибший игрок оставляет инвентарь рюкзаком в шаге от тела, а не россыпью
// по земле, и убийца забирает из него всё.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');

const ARENA = 'lootBagArena';
const accounts = {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z));

function arena() {
  const base = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'locations', 'combatRuntimeArena.json'), 'utf8'));
  // Гарь стоит в нескольких шагах от точки, где ждёт охотник; трофей у неё есть всегда.
  const gari = {
    id: 'bag_arena_gari',
    model: 'enemyAshWolf',
    name: 'Гарь',
    position: { x: 4, y: 0, z: 11 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    collision: 'solid',
    tags: ['npc', 'enemy', 'hostile', 'monster'],
    entity: {
      kind: 'npc', role: 'monster', species: 'ashWolf', hp: 24, atk: 1,
      creatureTypeId: 'gari', faction: 'wild', enemyType: 'ashWolf', hostileToPlayer: true
    }
  };
  return { ...base, id: ARENA, name: 'Loot bag arena', tier: 1, safe: false, pvpMode: 'pvpFullDrop', objects: [...base.objects, gari] };
}

function saves() {
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const file = path.join(h.DATA_DIR, 'saves.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    state: role => data.characters[users.users[accounts[role].login].id][accounts[role].characterId].state,
    write: () => fs.writeFileSync(file, JSON.stringify(data))
  };
}

function seed(state, { weapon = 'fists', inventory = {}, hp = 100 } = {}) {
  state.currentLocationId = ARENA;
  state.serverLocationContext = { locationId: ARENA };
  state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
  state.inventory = { ...inventory, ...(weapon === 'fists' ? {} : { [weapon]: 1 }) };
  state.equipment = { ...(state.equipment || {}), weapon, offhand: '' };
  state.player = { ...(state.player || {}), x: 1, z: 11, hp, itemConditions: { ...(state.player?.itemConditions || {}), [weapon]: 100 } };
}

/** Живые снимки комнаты: NPC, контейнеры и убийства. */
function watch(account) {
  const view = { enemies: new Map(), killed: [] };
  for (const row of account.join.worldState?.enemies || []) view.enemies.set(row.id, row);
  view.containers = new Map((account.join.worldState?.containers || []).map(row => [row.id, row]));
  account.socket.on('enemySnapshot', payload => {
    view.enemies = new Map((payload?.enemies || []).map(row => [row.id, row]));
  });
  account.socket.on('enemyKilled', payload => view.killed.push(payload));
  account.socket.on('worldContainersSnapshot', payload => {
    view.containers = new Map((payload?.containers || []).map(row => [row.id, row]));
  });
  account.socket.on('worldContainerUpdated', payload => {
    if (payload?.container?.id) view.containers.set(payload.container.id, payload.container);
  });
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

let attackSequence = 0;
function attack(account, event, target, self, extra) {
  return h.socketAck(account.socket, event, {
    weapon: 'pickaxe', mode: 'single', ...extra,
    attackToken: `loot_bag_${Date.now().toString(36)}_${++attackSequence}`,
    shotDirX: Number(target.x) - Number(self.x), shotDirZ: Number(target.z) - Number(self.z),
    skillRanks: {}, talentRanks: {}
  });
}

const selfOf = account => ({ x: Number(account.join.self.x), z: Number(account.join.self.z) });

async function empty(account, view, bag) {
  const opened = await h.socketAck(account.socket, 'openWorldContainer', { containerId: bag.id });
  assert(opened.ok && opened.container?.lootBag, `${bag.id} opens: ` + JSON.stringify(opened).slice(0, 300));
  const taken = await h.socketAck(account.socket, 'lootWorldContainer', { containerId: bag.id, mode: 'all' });
  assert(taken.ok && taken.removed === true, `taking everything empties and removes ${bag.id}: ` + JSON.stringify(taken).slice(0, 300));
  await until(`${bag.id} vanishes for the room`, () => !view.containers.has(bag.id), 3000);
  return taken;
}

(async () => {
  await h.bootstrapCharacters(accounts);
  fs.writeFileSync(path.join(h.DATA_DIR, 'locations', `${ARENA}.json`), JSON.stringify(arena(), null, 2));
  let book = saves();
  seed(book.state('trade'), { weapon: 'pickaxe' });
  book.write();

  // 1. Гарь убита: трофей в мешке, тело пустое.
  let sack = null;
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    assert.equal(accounts.trade.join.roomId.split(':')[0], ARENA, 'the hunter joined the arena');
    const view = watch(accounts.trade);
    const hunter = selfOf(accounts.trade);
    const gari = await until('the arena gari', () => [...view.enemies.values()].find(row => row.creatureTypeId === 'gari' && !row.dead), 5000);
    let blow = null;
    for (let attempt = 0; attempt < 16 && !blow?.killed; attempt += 1) {
      const current = view.enemies.get(gari.id) || gari;
      if (distance(current, hunter) > 2.6) { await wait(400); continue; }
      blow = await attack(accounts.trade, 'enemyHit', current, hunter, { enemyId: gari.id });
      assert(blow.ok, 'the hunter strikes the gari: ' + JSON.stringify(blow).slice(0, 300));
      if (!blow.killed) await wait(1300);
    }
    assert(blow?.killed, 'the pickaxe kills the gari: ' + JSON.stringify(blow).slice(0, 300));
    sack = await until('the gari drops a sack', () => view.containers.get(`bag_${gari.id}`), 3000,
      () => JSON.stringify([...view.containers.keys()]));
    assert(sack.lootBag && sack.kind === 'sack' && sack.name === 'Мешок — Гарь', 'a sack named after the gari: ' + JSON.stringify(sack).slice(0, 300));
    assert(sack.loot.some(row => row.id === 'trophy'), 'the gari trophy lies in the sack: ' + JSON.stringify(sack.loot));
    const body = await until('the gari body', () => {
      const row = view.enemies.get(gari.id);
      return row?.dead ? row : null;
    }, 3000);
    assert.deepEqual(body.loot, [], 'the body itself holds nothing');
    assert(distance(sack, body) > 0.3 && distance(sack, body) < 1.5, 'the sack lies a step from the body');
    console.log('PASS a slain gari leaves an empty body and its trophy in a sack a step away');
  } finally {
    h.closeSocket(accounts.trade);
    await wait(2500);
    await h.stopServer();
  }

  // 2. Перезапуск: мешок на месте; обысканный — исчезает у всех.
  book = saves();
  seed(book.state('harvest'), { inventory: { medkit: 2 }, hp: 4 });
  book.write();
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.trade);
    const view = watch(accounts.trade);
    const restored = await until('the sack survives the restart', () => view.containers.get(sack.id), 5000,
      () => JSON.stringify([...view.containers.keys()]));
    assert.deepEqual(restored.loot, sack.loot, 'the restored sack keeps its loot');
    assert(distance(restored, sack) < 0.01, 'the restored sack lies where it fell');
    const taken = await empty(accounts.trade, view, restored);
    assert((taken.inventory || []).some(row => row.id === 'trophy'), 'the trophy goes into the hunter bag');
    console.log('PASS the sack survives a restart, is searched and vanishes once empty');

    // 3. Игрок погиб в красной зоне: инвентарь — рюкзаком у тела, убийца его обыскивает.
    await wait(1500);
    await h.connectAndJoin(accounts.harvest);
    const victim = selfOf(accounts.harvest);
    const hunter = selfOf(accounts.trade);
    let hit = null;
    for (let attempt = 0; attempt < 12 && !hit?.killed; attempt += 1) {
      hit = await attack(accounts.trade, 'playerHit', victim, hunter, { targetId: accounts.harvest.socket.id });
      if (!hit?.killed) await wait(1300);
    }
    assert(hit?.killed, 'the hunter kills the victim in the red zone: ' + JSON.stringify(hit).slice(0, 300));
    const backpack = await until('the victim leaves a backpack', () => [...view.containers.values()]
      .find(row => row.lootBag && row.kind === 'backpack'), 4000, () => JSON.stringify([...view.containers.keys()]));
    assert(backpack.name.startsWith('Рюкзак'), 'the container is a backpack: ' + backpack.name);
    assert.deepEqual(backpack.loot.filter(row => row.id === 'medkit'), [{ id: 'medkit', qty: 2 }], 'the medkits lie in the backpack');
    assert(distance(backpack, victim) < 1.5, 'the backpack lies by the body');
    const looted = await empty(accounts.trade, view, backpack);
    assert((looted.inventory || []).some(row => row.id === 'medkit' && row.qty >= 2), 'the killer takes the medkits');
    console.log('PASS a player slain in the red zone leaves a backpack, the killer searches it');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await wait(1500);
    await h.stopServer();
  }
  h.cleanupSync();
  console.log('Loot bags network OK: an NPC sack by the empty body, persisted across a restart, searched and removed; a player backpack in the red zone.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
