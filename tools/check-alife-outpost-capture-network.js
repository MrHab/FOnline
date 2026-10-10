#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./check-combat-runtime');
const zoneWalk = require('./lib/zone-walk');
const { createShiftCycle } = require('../src/server/shift-cycle');
const storms = require('../src/server/radiation-storm');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-outpost-capture-'));
const locationId = 'z_06_10';
const authored = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/open-world-alife.json'), 'utf8'));
const site = authored.outposts.find(row => row.id === 'alife_scrap_outpost');
assert(site && site.locationId === locationId);
const fixture = { ...site, garrisonSize: 1 };
const clockFile = path.join(scratch, 'clock-offset.txt');
let clockOffset = 0;
let shotSequence = 0;
const accounts = {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

fs.writeFileSync(clockFile, '0');
fs.writeFileSync(path.join(scratch, 'open-world-alife.json'), JSON.stringify({ outposts: [fixture] }));
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify({ tickSeconds: 1 }));
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = false;
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_OPEN_WORLD_ALIFE_FILE = path.join(scratch, 'open-world-alife.json');
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
process.env.ALIFE_CAPTURE_CLOCK_FILE = clockFile;
process.env.NODE_ENV = 'test';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${path.join(__dirname, 'test-support/alife-capture-clock.js')}`.trim();

function setClock(offset) {
  clockOffset = offset;
  fs.writeFileSync(clockFile, String(offset));
  return delay(100);
}

async function advanceClock(ms) { await setClock(clockOffset + ms); }

async function until(label, read, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function seedPlayers() {
  const players = [
    ['cadence', 'uprava', 55, 47],
    ['untargeted', 'uprava', 55, 49],
    ['target', site.ownerFaction, 55, 51]
  ];
  for (const [role, , x, z] of players) zoneWalk.placeInZone(h, accounts, role, locationId, { x, z });
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const file = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [role, faction] of players) {
    const account = accounts[role];
    const row = saves.characters[users.users[account.login].id][account.characterId];
    const state = row.state;
    state.territoryFaction = { version: 1, factionId: faction, joinedAt: Date.now(),
      changeAllowedAt: 0, history: [] };
    state.player.hp = 5000;
    state.player.maxHp = 5000;
    state.player.level = 50;
    state.player.xp = 0;
    state.player.xpNeeded = 100000;
    row.summary.level = 50;
    if (faction === 'uprava') {
      const weaponRuntimeId = String(state.equipment?.weapon || '');
      assert.equal(state.itemRuntime?.[weaponRuntimeId]?.baseId, 'laserPistol',
        `${role} must have an equipped runtime laser pistol`);
      state.inventory.energyCell = 100;
      state.itemRuntime[weaponRuntimeId].loaded = 12;
      state.characterProfile.special.per = 10;
      state.characterProfile.special.agi = 10;
      state.skillRanks = { ...(state.skillRanks || {}), energyWeapons: 100 };
    }
  }
  fs.writeFileSync(file, JSON.stringify(saves));
}

function captureState(world) {
  const alife = world?.alife || {};
  const siteState = alife.sites?.find(row => row.id === site.id);
  const task = alife.captureTasks?.find(row => row.siteId === site.id);
  assert(siteState && task, 'The network snapshot exposes the outpost and capture task');
  return { site: siteState, task };
}

async function liveCapture(account = accounts.cadence) {
  const ack = await h.socketAck(account.socket, 'requestWorldState', {});
  assert(ack.ok && ack.state, 'requestWorldState returns an authoritative snapshot');
  return captureState(ack.state);
}

function attachEnemyView(account) {
  account.enemyView = account.join.worldState;
  account.socket.on('enemySnapshot', payload => { account.enemyView = payload; });
}

function liveEnemy(account, role) {
  return (account.enemyView?.enemies || []).find(row => row.siteId === site.id && row.role === role && row.hp > 0);
}

async function killDefender(shooter, role) {
  const target = await until(`${role} actor`, () => liveEnemy(shooter, role));
  for (let attempt = 0; attempt < 70; attempt += 1) {
    const current = liveEnemy(shooter, role);
    if (!current) return;
    await advanceClock(2500);
    const self = shooter.join.self;
    const shot = await h.socketAck(shooter.socket, 'enemyHit', {
      enemyId: current.id, weapon: 'laserPistol', mode: 'single',
      attackToken: `outpost_${++shotSequence}`,
      shotDirX: current.x - self.x, shotDirZ: current.z - self.z,
      targetX: current.x, targetZ: current.z,
      skillRanks: {}, talentRanks: {}
    });
    if (shot.killed) return;
    if (shot.ok && Number(shot.combat?.loaded) === 0) {
      await advanceClock(2500);
      const reload = await h.socketAck(shooter.socket, 'reloadWeapon', {
        weapon: 'laserPistol', take: 12, skillRanks: {}, talentRanks: {}
      });
      assert(reload.ok, `Reload during ${role} fight: ${JSON.stringify(reload)}`);
    } else if (!shot.ok && /патрон|заряж|магазин/i.test(shot.error || '')) {
      const reload = await h.socketAck(shooter.socket, 'reloadWeapon', {
        weapon: 'laserPistol', take: 12, skillRanks: {}, talentRanks: {}
      });
      assert(reload.ok, `Reload during ${role} fight: ${JSON.stringify(reload)}`);
    } else if (!shot.ok && !/не хватает ОД|Недостаточно очков действий|перезаряд|слишком рано/i.test(shot.error || '')) {
      throw new Error(`${role} combat was rejected: ${JSON.stringify(shot).slice(0, 500)}`);
    }
    if (shot.enemy) shooter.enemyView = { ...shooter.enemyView,
      enemies: (shooter.enemyView?.enemies || []).map(row => row.id === shot.enemy.id ? shot.enemy : row) };
  }
  throw new Error(`${role} survived 70 authoritative shots`);
}

async function tickCapture(expected) {
  const before = await liveCapture();
  await advanceClock(10000);
  return until('outpost capture tick', async () => {
    const after = await liveCapture();
    return after.site.ownerFaction !== before.site.ownerFaction
      || (after.task.progressPercent >= expected && after.task.progressPercent !== before.task.progressPercent)
      ? after : null;
  }, 3500);
}

function stormWindow() {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/artifacts.json'), 'utf8'));
  const graph = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/zone-graph.json'), 'utf8'));
  const cycle = createShiftCycle(catalog.shift, { epochMs: 0 });
  const model = storms.createRadiationStorm(cycle, catalog.shift.storm, {
    minX: 0, minY: 0, maxX: graph.grid.cols * graph.grid.zoneKm,
    maxY: graph.grid.rows * graph.grid.zoneKm
  });
  const frame = storms.sectorFrame(6, 10, graph.grid.zoneKm, 320, 320);
  const position = storms.localToGlobal(frame, site.x, site.z);
  const activeOffset = cycle.cycleMs - cycle.afterglowMs - cycle.activeMs;
  for (let index = 1; index < 24; index += 1) {
    const activeStart = index * cycle.cycleMs + activeOffset;
    const storm = model.at(activeStart + 1000);
    const passage = storms.sampleStorm(storm, position.x, position.y, activeStart + 1000);
    const middle = Math.round((passage.reachedAt + passage.passedAt) / 2);
    if (middle > activeStart && middle < storm.activeEndAt
      && storms.sampleStorm(storm, position.x, position.y, middle).inside) {
      return { middle, passedAt: passage.passedAt };
    }
  }
  throw new Error('No deterministic storm window covers the authored outpost');
}

function seedNeutralShelter() {
  zoneWalk.placeInZone(h, accounts, 'harvest', locationId, { x: site.x, z: site.z });
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const file = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(file, 'utf8'));
  const account = accounts.harvest;
  const state = saves.characters[users.users[account.login].id][account.characterId].state;
  state.territoryFaction = { version: 1, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: [] };
  state.player.hp = 5000;
  state.player.maxHp = 5000;
  fs.writeFileSync(file, JSON.stringify(saves));
}

async function checkStormShelterAndRaiders() {
  seedNeutralShelter();
  const window = stormWindow();
  const enterStorm = () => {
    const epoch = Date.now() + clockOffset - window.middle;
    process.env.KROMKA_TEST_SHIFT_EPOCH_MS = String(epoch);
    return epoch;
  };
  const finishStorm = async epoch => {
    await setClock(epoch + window.passedAt + 2000 - Date.now());
    await delay(1500);
  };
  let epoch = enterStorm();
  await h.startServer();
  await h.connectAndJoin(accounts.harvest);
  assert.equal(accounts.harvest.join.self.territoryFaction?.factionId || '', '',
    'The sheltering character has no territory faction');
  await delay(1600);
  await finishStorm(epoch);
  const sheltered = await liveCapture(accounts.harvest);
  assert.equal(sheltered.site.ownerFaction, 'uprava',
    'A neutral character inside the outpost prevents post-storm raider takeover');
  h.closeSocket(accounts.harvest);
  await h.stopServer();

  epoch = enterStorm();
  await h.startServer();
  await delay(1600); // No player has a loaded room while this storm passes.
  await finishStorm(epoch);
  await h.connectAndJoin(accounts.harvest);
  const empty = captureState(accounts.harvest.join.worldState);
  assert.equal(empty.site.ownerFaction, 'raiders',
    'An unoccupied outpost transfers to raiders after the storm, even offscreen');
  assert.equal(empty.task.phase, 'defeatBoss', 'Raiders receive their own mandatory boss');
  const raiderBoss = await until('the raider boss in the newly loaded room', async () => {
    const world = await h.socketAck(accounts.harvest.socket, 'requestWorldState', {});
    return (world.state?.enemies || []).find(enemy =>
      enemy.siteId === site.id && enemy.role === 'boss' && enemy.faction === 'raiders');
  }, 10000);
  assert(raiderBoss, 'The raider boss is present in the live room after offscreen takeover');
}

(async () => {
  await h.bootstrapCharacters(accounts);
  seedPlayers();
  await h.startServer();
  try {
    await h.connectAndJoin(accounts.cadence);
    attachEnemyView(accounts.cadence);
    await h.connectAndJoin(accounts.untargeted);
    attachEnemyView(accounts.untargeted);
    await h.connectAndJoin(accounts.target);
    const initial = captureState(accounts.cadence.join.worldState);
    assert.equal(initial.task.phase, 'defeatBoss');
    assert.equal(initial.task.progressPercent, 0);
    await killDefender(accounts.cadence, 'boss');
    await until('boss gate cleared', async () => {
      const current = await liveCapture();
      return current.task.phase === 'hold' ? current : null;
    });
    await killDefender(accounts.untargeted, 'guard');
    h.closeSocket(accounts.untargeted);
    await delay(700);
    const tied = await liveCapture();
    for (let i = 0; i < 2; i += 1) {
      await advanceClock(10000);
      await delay(1200);
      assert.equal((await liveCapture()).task.progressPercent, tied.task.progressPercent,
        'One attacker and one defender must pause the hold timer');
    }
    h.closeSocket(accounts.target);
    await delay(700);
    let half = await liveCapture();
    for (let i = 0; i < 9; i += 1) half = await tickCapture(Math.min(99, half.task.progressPercent + 1));
    assert(half.task.progressPercent >= 45 && half.task.progressPercent < 100,
      'One attacker earns roughly half of the cumulative three-minute hold');
    await h.connectAndJoin(accounts.untargeted);
    for (let i = 0; i < 11; i += 1) {
      const current = await liveCapture();
      if (current.site.ownerFaction === 'uprava') break;
      await tickCapture(Math.min(99, current.task.progressPercent + 1));
    }
    const captured = await liveCapture();
    assert.equal(captured.site.ownerFaction, 'uprava', 'The room captures after 180 cumulative seconds');
    assert.equal(captured.task.phase, 'defeatBoss', 'The new garrison restores a mandatory boss');
    h.closeSocket(accounts.cadence);
    h.closeSocket(accounts.untargeted);
    await delay(700);
    await h.connectAndJoin(accounts.cadence);
    await h.connectAndJoin(accounts.untargeted);
    const firstXp = accounts.cadence.join.self.xp;
    const secondXp = accounts.untargeted.join.self.xp;
    assert(firstXp > secondXp && secondXp > 0,
      `Capture XP follows observed participation: ${firstXp} versus ${secondXp}`);
    h.closeSocket(accounts.cadence);
    h.closeSocket(accounts.untargeted);
    await h.stopServer();
    await h.startServer();
    await h.connectAndJoin(accounts.cadence);
    await h.connectAndJoin(accounts.untargeted);
    assert.equal(accounts.cadence.join.self.xp, firstXp, 'Reconnect/restart cannot duplicate the first XP award');
    assert.equal(accounts.untargeted.join.self.xp, secondXp, 'Reconnect/restart cannot duplicate the second XP award');
    h.closeSocket(accounts.cadence);
    h.closeSocket(accounts.untargeted);
    await h.stopServer();
    await checkStormShelterAndRaiders();
    console.log('PASS network boss kill, tied pause, 180-second capture, contribution XP, restart and both storm outcomes');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  process.exitCode = 1;
});
