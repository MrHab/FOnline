#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DEV_TOKEN = 'alife-hundred-network-check-0123456789abcdef';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
process.env.AUTH_RATE_IP_MAX_ATTEMPTS = '1000';
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const accounts = {};
const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/zone-graph.json'), 'utf8'));
const home = graph.zones.find(row => row.id === 'z_06_10');
assert(home, 'The authored scrap outpost sector exists');
const spawn = { x: 55, z: 47 };
const site = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/open-world-alife.json'), 'utf8'))
  .outposts.find(row => row.id === 'alife_scrap_outpost');
assert(site && site.locationId === home.id && spawn.x >= site.bounds.minX && spawn.x <= site.bounds.maxX
  && spawn.z >= site.bounds.minZ && spawn.z <= site.bounds.maxZ, 'Crowd spawn is inside the outpost');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-alife-hundred-'));
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
fs.writeFileSync(path.join(scratch, 'open-world-alife.json'), JSON.stringify({ huntingGrounds: [], outposts: [site] }));
process.env.KROMKA_OPEN_WORLD_ALIFE_FILE = path.join(scratch, 'open-world-alife.json');
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({
  tickSeconds: 1, maxGroups: 4, stationaryLairs: true,
  lairs: { capacity: { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 } },
  species: [{ id: 'load_pack', name: 'Load pack', kind: 'monster', faction: 'gari', hostile: false,
    members: [{ type: 'gari', name: 'Гарь', min: 3, max: 3 }], habitat: { pve: 1, pvp: 1, pvpFullDrop: 1 } }]
}));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const devGet = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, { headers: { 'x-dev-token': DEV_TOKEN } }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
  }).on('error', reject);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const siteActors = payload => (payload?.enemies || []).filter(enemy => enemy.siteId === site.id);
const bossOf = payload => siteActors(payload).find(enemy => enemy.role === 'boss');

(async () => {
  await h.bootstrapCharacters(accounts);
  await h.startServer();
  try {
    for (let i = 0; i < 87; i += 1) {
      const role = `alife${String(i).padStart(2, '0')}`;
      const account = await h.registerAccount(role, 'hundred');
      accounts[role] = account;
      await h.connectAndJoin(account);
      h.closeSocket(account);
    }
  } finally { await h.stopServer(); }
  assert.equal(Object.keys(accounts).length, 100);
  for (const role of Object.keys(accounts)) zoneWalk.placeInZone(h, accounts, role, home.id, spawn);
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const savesFile = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesFile, 'utf8'));
  for (const account of Object.values(accounts)) {
    const state = saves.characters[users.users[account.login].id][account.characterId].state;
    state.territoryFaction = { version: 1, factionId: 'uprava', joinedAt: Date.now(),
      changeAllowedAt: 0, history: [] };
  }
  fs.writeFileSync(savesFile, JSON.stringify(saves));
  const members = [0, 1, 2].map(i => ({ id: `m${i}`, type: 'gari', spec: 0, name: 'Гарь', hp: 39, maxHp: 39 }));
  fs.writeFileSync(path.join(h.DATA_DIR, 'danger-ecology.json'), JSON.stringify({
    version: 1, mapRevision: 'check', nextId: 2, lairs: [], groups: [{
      id: 'one_pack', speciesId: 'load_pack', lairId: '', sx: home.col, sy: home.row,
      members, state: 'rest', target: null, restUntil: Date.now() + 600000,
      nextStepAt: Date.now() + 600000, size0: 3, bornAt: Date.now()
    }]
  }));
  await h.startServer();
  try {
    const entries = Object.values(accounts);
    await h.connectAndJoin(entries[0]);
    assert.equal(entries[0].join.self.territoryFaction.factionId, 'uprava');
    const task = entries[0].join.worldState?.alife?.captureTasks?.find(row => row.siteId === site.id);
    assert(task && task.phase === 'defeatBoss' && task.progressPercent === 0,
      'Outpost task requires the boss before the three-minute hold');
    let firstSnapshot = entries[0].join.worldState;
    entries[0].socket.on('enemySnapshot', payload => { firstSnapshot = payload; });
    for (let i = 0; i < 15 && !bossOf(firstSnapshot); i += 1) await delay(200);
    const firstBoss = bossOf(firstSnapshot);
    assert(firstBoss, 'The first player sees the mandatory outpost boss');
    assert.equal(siteActors(firstSnapshot).filter(enemy => enemy.role === 'boss').length, 1);
    const firstHp = firstBoss.hp;
    const firstMaxHp = firstBoss.maxHp;
    for (let start = 1; start < entries.length; start += 10) {
      const batch = entries.slice(start, start + 10);
      await Promise.all(batch.map(account => h.connectAndJoin(account)));
    }
    assert(entries.every(account => account.join.roomId === home.id), '100 players share the same zone room');
    const outside = entries.filter(account => !account.socket.connected
      || account.join.self.x < site.bounds.minX || account.join.self.x > site.bounds.maxX
      || account.join.self.z < site.bounds.minZ || account.join.self.z > site.bounds.maxZ);
    assert.equal(outside.length, 0, 'All 100 sockets remain connected inside the outpost boundary: '
      + JSON.stringify(outside.slice(0, 4).map(account => ({ role: account.role,
        connected: account.socket.connected, x: account.join.self.x, z: account.join.self.z }))));
    const view = await devGet(`/api/dev/danger-ecology?sx=${home.col}&sy=${home.row}&radius=0`);
    const pack = view.near.find(row => row.id === 'one_pack');
    assert(pack && pack.actors.length === 3, 'one NPC actor set serves all 100 players');
    assert(pack.actors.every(row => row.roomId === home.id));
    for (let i = 0; i < pack.actors.length; i += 1) for (let j = i + 1; j < pack.actors.length; j += 1) {
      assert(Math.hypot(pack.actors[i].x - pack.actors[j].x, pack.actors[i].z - pack.actors[j].z) >= 1,
        'group members spawn at separate coordinates');
    }
    let crowdSnapshot = entries.at(-1).join.worldState;
    entries.at(-1).socket.on('enemySnapshot', payload => { crowdSnapshot = payload; });
    for (let i = 0; i < 20 && (bossOf(crowdSnapshot)?.maxHp || 0) <= firstMaxHp; i += 1) await delay(200);
    const defenders = siteActors(crowdSnapshot);
    const bosses = defenders.filter(enemy => enemy.role === 'boss');
    assert.equal(bosses.length, 1, '100 viewers still share exactly one mandatory boss');
    assert.equal(defenders.length, site.garrisonSize + 1,
      '100 viewers still share one authored garrison, not a garrison per player');
    assert(bosses[0].maxHp > firstMaxHp,
      `Attacking-player count raises defender max HP: ${firstMaxHp} -> ${bosses[0].maxHp}`);
    assert(bosses[0].maxHp - bosses[0].hp >= firstMaxHp - firstHp,
      `A larger attacking crowd cannot erase damage: ${firstMaxHp - firstHp} -> ${bosses[0].maxHp - bosses[0].hp}`);
    assert(bosses[0].hp > firstHp,
      'A fresh boss gains effective HP against the larger attacking crowd');
    const crowdedTask = entries.at(-1).join.worldState?.alife?.captureTasks?.find(row => row.siteId === site.id);
    assert(crowdedTask && crowdedTask.phase === 'defeatBoss' && crowdedTask.progressPercent === 0,
      'The shared capture task cannot accrue hold time while the boss lives');
    const health = await devGet('/health');
    assert(health.ok, '/health stays available with 100 connected players');
    console.log(`PASS 100 players share ${home.id}, 3 separated pack members, one outpost garrison and boss, `
      + 'scaling without healing, gated capture task, /health');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(async error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  for (const account of Object.values(accounts)) h.closeSocket(account);
  await h.stopServer();
  h.cleanupSync();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exitCode = 1;
});
