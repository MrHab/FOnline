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
const north = graph.zones.find(row => row.id === zone.edges?.north?.to);
const south = graph.zones.find(row => row.id === zone.edges?.south?.to);
assert(north && south, 'The moving caravan has a real road route through the sector');
const rewards = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/open-world-alife.json'), 'utf8'))
  .caravanRobberyRewards;
const runtime = createZoneRuntime({ graph, zonesDir: path.join(root, 'data/zones'), normalize: row => row });
const definition = runtime.ensure({}, zoneId);

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
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0,
      travel: { mode: 'caravan', count: 0, restMinutes: [60, 60] } },
    { id: 'robbery_patrol', name: 'Дозор', kind: 'traveller', faction: 'tract_league',
      members: [{ type: 'patrol_guard', role: 'guard', name: 'Дозорный', min: 2, max: 2 }],
      habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 }, aggression: 0,
      travel: { mode: 'patrol', count: 0, restMinutes: [60, 60] } }
  ]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const qty = (self, id) => (self?.inventory || []).filter(row => row.id === id)
  .reduce((sum, row) => sum + Number(row.qty || 0), 0);
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
  zoneWalk.placeInZone(h, accounts, 'trade', zoneId, zoneWalk.world(definition.spawn));
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const traderCustomer = saves.characters[users.users[accounts.trade.login].id][accounts.trade.characterId].state;
  traderCustomer.inventory = { ...(traderCustomer.inventory || {}), silver: 200, trophy: 3 };
  traderCustomer.itemRuntime.ui_laserPistol_trade_1.loaded = 5;
  fs.writeFileSync(savesPath, JSON.stringify(saves));
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
      // Half of this fixture's 3600s road step keeps the moving merchant near the player.
      { ...group('robbed_caravan', 'robbery_caravan', [
        ...members('caravaneer', 'merchant', 1, 'Первый').map(row => ({ ...row, hp: 1 })),
        ...members('caravan_guard', 'guard', 2, 'Первый')
      ], 'coreZone'), state: 'travel', restUntil: 0, nextStepAt: Date.now() + 1800000,
      home: 'settlement', routeIndex: 1,
      route: [south, zone, north].map(row => ({ sx: row.col, sy: row.row })) },
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
    assert(groups.robbed_caravan.actors.every(actor => actor.phase === 'transit'),
      'The caravan is walking its road route rather than resting at a fixed trader point');
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
    try {
      await waitFor('moving caravan merchant', () => byEnemyId(merchant.id)?.moving, 5000);
    } catch (error) {
      const current = byEnemyId(merchant.id);
      console.error('Caravan movement diagnostic:', JSON.stringify({
        merchant: current && { x: current.x, z: current.z, moving: current.moving, aiState: current.aiState },
        ecology: (await devGet(`/api/dev/danger-ecology?sx=${zone.col}&sy=${zone.row}&radius=0`))
          .near.find(row => row.id === 'robbed_caravan')?.actors
      }));
      throw error;
    }
    const merchantNow = () => byEnemyId(merchant.id) || merchant;
    assert([...otherIds, ...patrolIds].every(id => byEnemyId(id)?.hostileToPlayer === false),
      'Both other groups begin neutral to the robber');
    const tooFar = await h.socketAck(observer.socket, 'robEncounterActor', { enemyId: merchant.id });
    assert(!tooFar.ok && /Подойдите ближе/.test(tooFar.error),
      'The server rejects a robbery attempt outside interaction range: ' + JSON.stringify(tooFar));
    const position = { x: robber.join.self.x, z: robber.join.self.z };
    const reachMerchant = async distance => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = merchantNow();
        if (Math.hypot(position.x - current.x, position.z - current.z) <= distance - 0.6) return;
        await zoneWalk.driveTo(h, robber, position, current.x, current.z, 20);
      }
      const current = merchantNow();
      assert(Math.hypot(position.x - current.x, position.z - current.z) <= distance,
        `The player reaches the moving merchant: ${JSON.stringify({ position, merchant: [current.x, current.z] })}`);
    };
    await reachMerchant(4.4);
    const before = await h.socketAck(robber.socket, 'syncNpcTradeState', { enemyId: merchant.id });
    assert(before.ok && before.market?.stock, 'The neutral merchant trades before robbery: ' + JSON.stringify(before.error));
    const medkitStock = before.market.stock.find(row => row.id === 'medkit');
    assert(medkitStock?.qty > 0, 'The moving caravan carries authored medical supplies');
    const initialSilver = qty(robber.join.self, 'silver');
    const initialMedkits = qty(robber.join.self, 'medkit');
    const initialTrophies = qty(robber.join.self, 'trophy');
    const bought = await h.socketAck(robber.socket, 'npcTradeExchange', {
      enemyId: merchant.id, buys: [{ id: 'medkit', qty: 1 }], sells: []
    });
    assert(bought.ok && bought.buyTotal > 0, 'A real purchase succeeds with the moving merchant: ' + JSON.stringify(bought).slice(0, 350));
    assert.equal(qty(bought.self, 'medkit'), initialMedkits + 1);
    assert.equal(qty(bought.self, 'silver'), initialSilver - bought.buyTotal);
    assert.equal(bought.market.stock.find(row => row.id === 'medkit')?.qty, medkitStock.qty - 1,
      'The server decrements the real trade shelf');
    const sold = await h.socketAck(robber.socket, 'npcTradeExchange', {
      enemyId: merchant.id, buys: [], sells: [{ id: 'trophy', qty: 1 }]
    });
    assert(sold.ok && sold.sellTotal > 0, 'A real trophy sale succeeds with the moving merchant: ' + JSON.stringify(sold).slice(0, 350));
    assert.equal(qty(sold.self, 'trophy'), initialTrophies - 1);
    assert.equal(qty(sold.self, 'silver'), initialSilver - bought.buyTotal + sold.sellTotal);
    assert((sold.market.stock.find(row => row.id === 'trophy')?.qty || 0) >= 1,
      'The merchant shelf receives the sold trophy');
    await reachMerchant(4.4);

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
    let killed = false;
    for (let attempt = 0; attempt < 5 && !killed; attempt += 1) {
      const current = merchantNow();
      const hit = await h.socketAck(robber.socket, 'enemyHit', {
        enemyId: merchant.id, weapon: 'laserPistol', mode: 'single',
        attackToken: `alife_caravan_reward_${Date.now()}_${attempt}`,
        shotDirX: current.x - position.x, shotDirZ: current.z - position.z,
        skillRanks: {}, talentRanks: {}
      });
      killed = hit?.killed === true;
      if (!killed) await delay(1200);
    }
    assert(killed, 'The robbed merchant can be killed through authoritative combat');
    const bag = await waitFor('the robbed caravan reward sack', async () => {
      const world = await h.socketAck(robber.socket, 'requestWorldState', {});
      return world.state?.containers?.find(row => row.id === `bag_${merchant.id}`) || null;
    }, 5000);
    const tier = Math.max(1, Math.min(5, Math.round(Number(zone.difficulty || 1))));
    const byId = rows => [...rows].map(row => ({ id: row.id, qty: row.qty }))
      .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId(bag.loot || []), byId(rewards[tier] || []),
      'The raid sack follows the tier reward table after stock was bought and trophies were sold');
    console.log('PASS moving A-Life caravan: server trade buy/sell, group-only robbery, closed combat trade and tier reward independent of shelf stock');
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
