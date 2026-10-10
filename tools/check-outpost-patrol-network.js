#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const h = require('./check-combat-runtime');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const locationId = 'z_06_10';
const siteLocationId = 'scrapOutpost';
const partyId = 'alife_test_patrol';
const zoneId = 'alife_test_patrol_onsite';
const accounts = {};

function seedPlayer(account) {
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const file = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = saves.characters[users.users[account.login].id][account.characterId].state;
  state.currentLocationId = locationId;
  state.player = { ...(state.player || {}), x: 55, z: 23 };
  state.globalMap = { ...(state.globalMap || {}), onWorldMap: false };
  state.serverLocationContext = { locationId };
  saves.characters[users.users[account.login].id][account.characterId].summary.locationId = locationId;
  const awardId = `alife_scrap_outpost:2:${account.characterId}`;
  saves.alifeCaptureAwards = { [awardId]: { id: awardId, siteId: 'alife_scrap_outpost',
    generation: 2, characterId: account.characterId, xp: 75, appliedAt: 0 } };
  fs.writeFileSync(file, JSON.stringify(saves));
}

function seedPatrol() {
  const globalMap = JSON.parse(fs.readFileSync(path.join(root, 'data/global-map.json'), 'utf8'));
  const sim = createWastelandSimulation({
    stateFile: path.join(h.DATA_DIR, 'wasteland-sim.json'),
    getGlobalMap: () => globalMap,
    worldSimulationFile: path.join(root, 'data/kromka/world-simulation.json')
  });
  const state = sim.state();
  const site = state.sites[siteLocationId];
  assert(site && site.locationId === siteLocationId, 'The authored outpost is a persistent world site.');
  const actors = Array.from({ length: 5 }, (_, index) => ({
    id: `alife_patrol_${index + 1}`, name: `Дозорный ${index + 1}`,
    side: 'attacker', faction: 'uprava', role: 'guard',
    typeName: 'Патрульный', hp: 120, maxHp: 120, atk: 14, speed: 2.1,
    tx: 16 + index, tz: 8, equipment: { weapon: 'rifle', armor: 'leather' },
    dead: false, stationary: false
  }));
  state.parties[partyId] = {
    id: partyId, name: 'Дозор Управы', kind: 'patrol', faction: 'uprava',
    state: 'onsite', destroyed: false, members: actors.length, strength: 100,
    x: site.x, y: site.y, speedKmh: 18, baseSpeedKmh: 18,
    homeSiteId: 'settlement', destinationSiteId: siteLocationId, onsiteSiteId: siteLocationId,
    onsiteZoneId: zoneId, onsiteReason: 'patrol', onsiteUntilHour: state.worldHour + 20,
    route: [], cargo: {}, playerMembers: []
  };
  const zone = sim.upsertWorldZone({
    id: zoneId, kind: 'visit', status: 'active', title: 'Дозор у аванпоста',
    x: site.x, y: site.y, siteId: site.id, partyId,
    faction: site.owner || 'free_artels', targetFaction: 'uprava',
    locationId, roomId: locationId, pvpMode: 'pvp', durationHours: 24,
    details: { onsiteParty: true, hostileOnsiteRaid: false, simBattle: false,
      siteId: site.id, partyId, partyKind: 'patrol', partyFaction: 'uprava',
      arrivalReason: 'patrol', arrivalFromX: site.x, arrivalFromY: site.y,
      arrivedHour: state.worldHour, resolveAfterHour: state.worldHour + 20,
      actors }
  });
  assert(zone && zone.details?.onsiteParty);
  state.parties[partyId].onsiteZoneId = zone.id;
  sim.save(true);
}

(async () => {
  await h.startServer();
  try {
    accounts.watcher = await h.registerAccount('outpost', Date.now().toString(36));
    await h.connectAndJoin(accounts.watcher);
    h.closeSocket(accounts.watcher);
    await h.stopServer();
    seedPlayer(accounts.watcher);
    seedPatrol();
    await h.startServer();
    await h.connectAndJoin(accounts.watcher);
    assert.equal(accounts.watcher.join.self.xp, 75, 'The saved capture award is applied to the joining character.');
    const awarded = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'saves.json'), 'utf8'));
    const awardId = `alife_scrap_outpost:2:${accounts.watcher.characterId}`;
    assert(Number(awarded.alifeCaptureAwards[awardId].appliedAt) > 0,
      'The same journaled save marks the XP award applied.');
    const initial = accounts.watcher.join.worldState;
    const alife = initial?.alife;
    assert(alife?.sites?.some(site => site.id === 'alife_scrap_outpost'),
      `The loaded room includes the outpost site: ${JSON.stringify({ roomId: accounts.watcher.join.roomId, selfLocation: accounts.watcher.join.self?.locationId, alife, keys: Object.keys(initial || {}) })}`);
    const task = alife.captureTasks?.find(row => row.siteId === 'alife_scrap_outpost');
    assert(task && task.phase === 'defeatBoss' && task.bossAlive && task.progressPercent === 0,
      'The capture task exposes owner, mandatory boss and realtime percent.');
    let seenPatrol = false;
    let seenBoss = false;
    let combat = false;
    let lastSiteEnemies = [];
    const inspect = payload => {
      lastSiteEnemies = (payload?.enemies || []).filter(enemy => enemy.siteId === 'alife_scrap_outpost')
        .map(enemy => ({ name: enemy.name, x: enemy.x, z: enemy.z, hp: enemy.hp, maxHp: enemy.maxHp, aiState: enemy.aiState, visualAction: enemy.visualAction }));
      for (const enemy of payload?.enemies || []) {
        if (enemy.siteId !== 'alife_scrap_outpost') continue;
        if (enemy.name === 'Командир аванпоста') seenBoss = true;
        if (String(enemy.name || '').startsWith('Дозорный')) {
          seenPatrol = true;
          if (['factionCombat', 'attack', 'chase'].includes(enemy.aiState) || enemy.hp < enemy.maxHp) combat = true;
        }
      }
    };
    inspect(initial);
    accounts.watcher.socket.on('enemySnapshot', inspect);
    for (let i = 0; i < 30 && !(seenPatrol && seenBoss && combat); i += 1) await delay(500);
    assert(seenBoss && seenPatrol, 'Patrol and mandatory boss coexist visibly in the shared room.');
    assert(combat, `The opposing patrol engages in visible NPC combat: ${JSON.stringify(lastSiteEnemies)}`);
    h.closeSocket(accounts.watcher);
    await h.stopServer();
    await h.startServer();
    await h.connectAndJoin(accounts.watcher);
    assert.equal(accounts.watcher.join.self.xp, 75,
      'Restarting after an applied capture award cannot grant it twice.');
    console.log('PASS loaded outpost shows physical patrol combat, versioned capture task and exactly-once XP after restart');
  } finally {
    h.closeSocket(accounts.watcher);
    await h.stopServer();
    h.cleanupSync();
  }
})().catch(async error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  h.closeSocket(accounts.watcher);
  await h.stopServer();
  h.cleanupSync();
  process.exitCode = 1;
});
