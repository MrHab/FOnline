#!/usr/bin/env node
'use strict';

// A real Socket.IO client robs one mobile A-Life caravan in an open sector.
// The second caravan and a road patrol deliberately share its faction, so a
// faction-wide hostility regression cannot pass this scenario.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DEV_TOKEN = 'alife-caravan-robbery-check-0123456789';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { createZoneRuntime } = require('../src/server/zone-runtime');

const root = path.resolve(__dirname, '..');
const accounts = {};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-alife-caravan-robbery-'));
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/zone-graph.json'), 'utf8'));
const zoneId = 'z_09_07';
const zone = graph.zones.find(row => row.id === zoneId);
assert(zone && !zone.city && zone.mode !== 'pve', 'The fixture uses a combat-enabled open sector');
const runtime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data/zones'), normalize: row => row });
const definition = runtime.ensure({}, zoneId);
const coreEntry = definition.transitions.find(row => row.type === 'location' && row.to === 'coreZone');
assert(coreEntry, 'The sector has a stable exterior portal for the caravan fixture');

const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({
  tickSeconds: 1,
  maxGroups: 6,
  woundHealPerMinute: 0,
  lairs: { capacity: { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  roam: { restMinutes: [60, 60], stepSeconds: [3600, 3600], huntStepSeconds: [3600, 3600],
    senseSeconds: 3600, radius: 1, clashPerMinute: 0, clashCooldownMinutes: 60 },
  species: [
    { id: 'robbery_caravan', name: 'Караван', kind: 'traveller', faction: 'tract_league',
      members: [
        { type: 'caravaneer', role: 'merchant', name: 'Караванщик', min: 1, max: 1,
          equipment: { weapon: 'pistol', armor: 'leather' } },
        { type: 'caravan_guard', role: 'guard', name: 'Охранник каравана', min: 2, max: 2,
          equipment: { weapon: 'rifle', armor: 'ballisticVest' } }
      ],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0, fleeAt: 0.9,
      travel: { mode: 'caravan', count: 0, restMinutes: [60, 60] } },
    { id: 'robbery_patrol', name: 'Дозор', kind: 'traveller', faction: 'tract_league',
      members: [{ type: 'patrol_guard', role: 'guard', name: 'Дозорный', min: 2, max: 2 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0, fleeAt: 0.9,
      travel: { mode: 'patrol', count: 0, restMinutes: [60, 60] } }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const devGet = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, { headers: { 'x-dev-token': DEV_TOKEN } }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`${res.statusCode}: ${body.slice(0, 200)}`)); }
    });
  }).on('error', reject);
});
async function waitFor(label, probe, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await probe();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

(async () => {
  await h.bootstrapCharacters(accounts);
  zoneWalk.placeInZone(h, accounts, 'untargeted', zoneId, zoneWalk.world(definition.spawn));
  zoneWalk.placeInZone(h, accounts, 'trade', zoneId, zoneWalk.world(coreEntry));
  const far = Date.now() + 3600000;
  const members = (type, role, count, label) => Array.from({ length: count }, (_, i) => ({
    id: `${role}_${i}`, type, spec: role === 'merchant' ? 0 : 1,
    name: `${role === 'merchant' ? 'Караванщик' : 'Охранник каравана'} ${label} ${i + 1}`,
    hp: 55, maxHp: 55
  }));
  const group = (id, speciesId, list, dest = '') => ({
    id, speciesId, lairId: '', sx: zone.col, sy: zone.row, members: list,
    state: 'rest', target: null, restUntil: far, nextStepAt: far,
    shakenUntil: 0, size0: list.length, bornAt: Date.now(), dest
  });
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
    version: 1, mapRevision: 'check', nextId: 4, lairs: [], groups: [
      group('robbed_caravan', 'robbery_caravan', [
        ...members('caravaneer', 'merchant', 1, 'Первый'), ...members('caravan_guard', 'guard', 2, 'Первый')
      ], 'coreZone'),
      group('other_caravan', 'robbery_caravan', [
        ...members('caravaneer', 'merchant', 1, 'Второй'), ...members('caravan_guard', 'guard', 2, 'Второй')
      ]),
      group('road_patrol', 'robbery_patrol', [
        { id: 'patrol_0', type: 'patrol_guard', spec: 0, name: 'Дозорный третий 1', hp: 55, maxHp: 55 },
        { id: 'patrol_1', type: 'patrol_guard', spec: 0, name: 'Дозорный третий 2', hp: 55, maxHp: 55 }
      ])
    ]
  }));

  await h.startServer();
  try {
    await h.connectAndJoin(accounts.untargeted);
    const observer = accounts.untargeted;
    assert.equal(observer.join.roomId, zoneId);
    const groups = await waitFor('both caravans and the patrol in one room', async () => {
      const state = await devGet(`/api/dev/danger-ecology?sx=${zone.col}&sy=${zone.row}&radius=0`);
      const byId = Object.fromEntries(state.near.map(row => [row.id, row]));
      return ['robbed_caravan', 'other_caravan', 'road_patrol'].every(id =>
        byId[id]?.actors?.some(actor => actor.roomId === zoneId)) ? byId : null;
    });
    const actorCount = id => groups[id].actors.filter(actor => actor.roomId === zoneId).length;
    assert.equal(actorCount('robbed_caravan'), 3, JSON.stringify(groups.robbed_caravan));
    assert.equal(actorCount('other_caravan'), 3, JSON.stringify(groups.other_caravan));
    assert.equal(actorCount('road_patrol'), 2, JSON.stringify(groups.road_patrol));

    await h.connectAndJoin(accounts.trade);
    const robber = accounts.trade;
    assert.equal(robber.join.roomId, zoneId);
    let snapshot = robber.join.worldState;
    robber.socket.on('enemySnapshot', payload => { snapshot = payload; });
    await waitFor('all eight fixture actors in the public snapshot', () => {
      const rows = snapshot?.enemies || [];
      return rows.filter(row => /Первый|Второй|третий/.test(row.name)).length === 8;
    });
    const byEnemyId = id => (snapshot?.enemies || []).find(row => row.id === id);
    const ids = marker => new Set((snapshot?.enemies || [])
      .filter(row => row.name?.includes(marker)).map(row => row.id));
    const robbedIds = ids('Первый');
    const otherIds = ids('Второй');
    const patrolIds = ids('третий');
    assert.equal(robbedIds.size, 3);
    assert.equal(otherIds.size, 3);
    assert.equal(patrolIds.size, 2);
    const merchant = [...robbedIds].map(byEnemyId).find(row => row?.role === 'merchant');
    assert(merchant && merchant.canRob === true && merchant.hostileToPlayer === false,
      'A neutral player sees the open-sector caravan merchant as robbable');
    assert([...otherIds, ...patrolIds].every(id => byEnemyId(id)?.hostileToPlayer === false),
      'Both other groups begin neutral to the robber');
    const tooFar = await h.socketAck(observer.socket, 'robEncounterActor', { enemyId: merchant.id });
    assert(!tooFar.ok && /Подойдите ближе/.test(tooFar.error),
      'The server rejects a robbery attempt outside interaction range: ' + JSON.stringify(tooFar));
    const position = { x: robber.join.self.x, z: robber.join.self.z };
    if (Math.hypot(position.x - merchant.x, position.z - merchant.z) > 4) {
      await zoneWalk.driveTo(h, robber, position, merchant.x, merchant.z, 20);
    }
    assert(Math.hypot(position.x - merchant.x, position.z - merchant.z) <= 4.4,
      `The robber reaches the merchant's interaction radius: ${JSON.stringify({ position, merchant: [merchant.x, merchant.z] })}`);
    const before = await h.socketAck(robber.socket, 'syncNpcTradeState', { enemyId: merchant.id });
    assert(before.ok && before.market?.stock, 'The neutral merchant trades before robbery: ' + JSON.stringify(before.error));

    const robbery = await h.socketAck(robber.socket, 'robEncounterActor', { enemyId: merchant.id });
    assert(robbery.ok && robbery.changed === robbedIds.size,
      'Close-range robbery succeeds and turns only this caravan hostile: ' + JSON.stringify(robbery).slice(0, 700));
    assert.equal(robbery.enemies.length, robbedIds.size, 'The response lists only the robbed group');
    assert(robbery.enemies.every(row => robbedIds.has(row.id) && row.hostileToPlayer),
      'The robbed merchant and guards target the robber');
    await waitFor('viewer-specific hostility snapshot', () => {
      const rows = [...robbedIds].map(byEnemyId);
      return rows.every(row => row?.hostileToPlayer) ? rows : null;
    });
    assert([...otherIds, ...patrolIds].every(id => byEnemyId(id)?.hostileToPlayer === false),
      'The other caravan and same-faction patrol stay neutral');
    const closed = await h.socketAck(robber.socket, 'syncNpcTradeState', { enemyId: merchant.id });
    assert(!closed.ok && /нельзя торговать/.test(closed.error),
      'The robbed merchant closes trade during combat: ' + JSON.stringify(closed));
    const exchange = await h.socketAck(robber.socket, 'npcTradeExchange', {
      enemyId: merchant.id, buys: [{ id: 'medkit', qty: 1 }], sells: []
    });
    assert(!exchange.ok && /нельзя торговать/.test(exchange.error),
      'Direct trade packets cannot bypass the combat lock: ' + JSON.stringify(exchange).slice(0, 300));
    console.log('PASS mobile A-Life caravan robbery in an open sector: canRob, range, group-only hostility, unaffected same-faction groups, closed trade');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(async error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3500));
  for (const account of Object.values(accounts)) h.closeSocket(account);
  await h.stopServer();
  h.cleanupSync();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exitCode = 1;
});
