#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { io } = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-progression-'));
let server = null;
let port = 0;

function checkXpThresholds() {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/character-progression.json'), 'utf8'));
  const context = vm.createContext({
    SERVER_SKILL_POINTS_PER_LEVEL: catalog.skills.pointsPerLevel,
    SERVER_PERK_LEVEL_INTERVAL: catalog.perks.levelInterval,
    // These cases isolate XP thresholds and earned budgets; real allocation,
    // derived stats and persistence are exercised over Socket.IO below.
    enforceServerProgressionBudget: () => {}, serverApplyDerivedVitals: () => {},
    serverSpentSkillPoints: p => p.spentSkills || 0,
    serverSpentPerkPoints: p => p.spentPerks || 0,
    // Премиум экономики v3 даёт +50% опыта.
    serverPremiumMultiplier: (p, key) => (p.premium && key === 'xpMultiplier' ? 1.5 : 1)
  });
  for (const name of ['serverSkillBudgetFor', 'serverPerkBudgetFor', 'serverUpdateFreeProgressionPoints', 'serverGrantXp']) {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  const player = { level: 1, xp: 99, xpNeeded: 100, traits: [], spentSkills: 0, spentPerks: 0 };
  assert.equal(context.serverGrantXp(player, 1).levels, 1);
  assert.equal(player.level, 2);
  assert.equal(player.xp, 0);
  assert.equal(player.xpNeeded, 145);
  assert.equal(player.skillPoints, 5);
  assert.equal(player.perkPoints, 0);
  assert.equal(context.serverGrantXp(player, 145 + 210 + 7).levels, 2);
  assert.equal(player.level, 4);
  assert.equal(player.xp, 7);
  assert.equal(player.xpNeeded, 304);
  assert.equal(player.skillPoints, 15);
  assert.equal(player.perkPoints, 1);
  const before = JSON.stringify(player);
  for (const gain of [0, -10]) assert.equal(context.serverGrantXp(player, gain).gained, 0);
  assert.equal(JSON.stringify(player), before);
  const capped = { level: 199, xp: 0, xpNeeded: 100, traits: ['educatedStart'], spentSkills: 12, spentPerks: 3 };
  assert.equal(context.serverGrantXp(capped, 1000).levels, 1);
  assert.equal(capped.level, 200);
  assert.equal(capped.xp, 900);
  assert.equal(capped.skillPoints, 988);
  assert.equal(capped.perkPoints, 63);
  const premium = { level: 1, xp: 0, xpNeeded: 100, traits: [], spentSkills: 0, spentPerks: 0, premium: true };
  assert.equal(context.serverGrantXp(premium, 41).gained, 61, 'premium adds half the XP, rounded down');
  console.log('XP thresholds OK: exact level-up, multiple levels, remainder, skill/perk awards, spent points, level cap and the premium bonus.');
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const value = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(value));
    });
  });
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.json ? JSON.stringify(options.json) : '';
    const request = http.request({
      hostname: '127.0.0.1', port, path: pathname, method: options.method || 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      timeout: 1500
    }, response => {
      let output = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { output += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(output) }));
    });
    request.once('timeout', () => request.destroy(new Error('request timeout')));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function startServer() {
  port = await freePort();
  const logs = [];
  server = childProcess.spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      NODE_ENV: 'test',
      KROMKA_TEST_SKIP_ONBOARDING: '1',
      WASTELAND_TICK_MS: '600000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => logs.push(chunk.toString()));
  server.stderr.on('data', chunk => logs.push(chunk.toString()));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early\n${logs.join('')}`);
    try {
      const health = await request('/health');
      if (health.status === 200 && health.json.ok) return;
    } catch (_) {}
    await delay(100);
  }
  throw new Error(`server readiness timeout\n${logs.join('')}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const stopped = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([stopped, delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  server = null;
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2500
    });
    const timer = setTimeout(() => reject(new Error('socket connection timeout')), 3500);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
}

function ack(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 4000);
    socket.emit(event, payload, response => { clearTimeout(timer); resolve(response || {}); });
  });
}

function appearance() {
  return {
    schema: 'realm.character-appearance.v1', sex: 'male', bodyType: 'medium',
    faceId: 'male_01', hairId: 'short_crop', skinToneId: 'skin_03', hairColorId: 'hair_03'
  };
}

async function joinExisting(auth, clientInstanceId) {
  const socket = await connect();
  const result = await ack(socket, 'join', {
    token: auth.token,
    deviceId: auth.deviceId,
    clientInstanceId,
    characterId: auth.characterId,
    deviceType: 'desktop',
    controlType: 'keyboard_mouse'
  });
  assert.equal(result.ok, true, result.error || 'existing character join failed');
  return { socket, result };
}

async function run() {
  checkXpThresholds();
  await startServer();
  const catalogResponse = await request('/api/kromka/character-progression');
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.json.catalog.skills.items.length, 15);

  const deviceId = 'progression_test_device_0123456789';
  const guestResponse = await request('/api/auth/guest', {
    method: 'POST', json: { deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' }
  });
  assert.equal(guestResponse.status, 200);
  assert.equal(guestResponse.json.ok, true);
  const auth = {
    token: guestResponse.json.token,
    deviceId,
    characterId: 'c_progression_runtime'
  };

  let socket = await connect();
  const invalid = await ack(socket, 'join', {
    ...auth,
    clientInstanceId: 'progression_invalid_client',
    name: 'Ошибка бюджета',
    appearance: appearance(),
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 },
    taggedSkills: ['lightWeapons'],
    traits: ['trainedEye']
  });
  assert.equal(invalid.ok, false, '35-point character draft must be rejected');
  assert.match(invalid.error || '', /ровно 40 очков/);

  const created = await ack(socket, 'join', {
    ...auth,
    clientInstanceId: 'progression_create_client',
    name: 'Наёмник',
    appearance: appearance(),
    quickStartId: 'legacyQuickStart'
  });
  assert.equal(created.ok, true, created.error || 'quick-start alias join failed');
  assert.equal(Object.values(created.self.special).reduce((sum, value) => sum + value, 0), 40);
  socket.close();
  await delay(500);
  await stopServer();

  const savesFile = path.join(dataDir, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesFile, 'utf8'));
  const ownerStore = Object.values(saves.characters).find(store => store && store[auth.characterId]);
  assert(ownerStore, 'created character was not persisted');
  const state = ownerStore[auth.characterId].state;
  state.player.level = 6;
  state.player.xp = 0;
  state.player.xpNeeded = 1000;
  state.skillRanks = { lightWeapons: 46 };
  delete state.progressionLedger;
  fs.writeFileSync(savesFile, JSON.stringify(saves));

  await startServer();
  let joined = await joinExisting(auth, 'progression_migration_client');
  socket = joined.socket;
  assert.equal(joined.result.self.skillRanks.lightWeapons, 46, 'legacy trained skill was not migrated');
  assert.equal(joined.result.self.skillPoints, 24, 'legacy skill rank did not consume one preserved step');
  assert.equal(joined.result.self.perkPoints, 2);

  const skill = await ack(socket, 'state', {
    profileOnly: true, reason: 'profile',
    skillRanks: { ...joined.result.self.skillRanks, lightWeapons: 51 }
  });
  assert.equal(skill.ok, true, skill.error || 'skill progression rejected');
  assert.equal(skill.self.skillRanks.lightWeapons, 51);
  assert.equal(skill.self.skillPoints, 23);

  const perk = await ack(socket, 'state', {
    profileOnly: true, reason: 'profile', talentRanks: { specialStr: 1 }
  });
  assert.equal(perk.ok, true, perk.error || 'perk progression rejected');
  assert.equal(perk.self.talentRanks.specialStr, 1);
  assert.equal(perk.self.perkPoints, 1);

  const replay = await ack(socket, 'state', {
    profileOnly: true, reason: 'profile',
    skillRanks: { ...skill.self.skillRanks }, talentRanks: { specialStr: 1 }
  });
  assert.equal(replay.ok, true, replay.error || 'idempotent progression replay failed');
  assert.equal(replay.changed, false);
  assert.equal(replay.self.skillPoints, 23);
  assert.equal(replay.self.perkPoints, 1);

  const rejected = await ack(socket, 'state', {
    profileOnly: true, reason: 'profile', talentRanks: { specialStr: 4 }
  });
  assert.equal(rejected.ok, false, 'rank above catalog maximum must be rejected');
  assert.match(rejected.error || '', /максимальный ранг 3/);
  assert.equal(rejected.self.perkPoints, 1);

  const invalidStep = await ack(socket, 'state', {
    profileOnly: true, skillRanks: { lightWeapons: 53 }, talentRanks: { specialStr: 2 }
  });
  assert.equal(invalidStep.ok, false, 'partial skill step below the cap must be rejected atomically');
  assert.equal(invalidStep.self.skillRanks.lightWeapons, 51);
  assert.equal(invalidStep.self.talentRanks.specialStr, 1);
  assert.equal(invalidStep.self.skillPoints, 23);
  assert.equal(invalidStep.self.perkPoints, 1);

  const nearCap = await ack(socket, 'state', {
    profileOnly: true, skillRanks: { lightWeapons: 96 }
  });
  assert.equal(nearCap.ok, true, nearCap.error);
  assert.equal(nearCap.self.skillPoints, 14);
  const capped = await ack(socket, 'state', {
    profileOnly: true, skillRanks: { lightWeapons: 100 }
  });
  assert.equal(capped.ok, true, capped.error || 'the last skill point must reach the 100% cap');
  assert.equal(capped.self.skillRanks.lightWeapons, 100);
  assert.equal(capped.self.skillPoints, 13, '96% -> 100% must spend exactly one skill point');
  const capReplay = await ack(socket, 'state', {
    profileOnly: true, skillRanks: { lightWeapons: 100 }
  });
  assert.equal(capReplay.ok, true);
  assert.equal(capReplay.changed, false);
  assert.equal(capReplay.self.skillPoints, 13, 'replayed final step must not spend twice');

  const endurance = await ack(socket, 'state', {
    profileOnly: true, talentRanks: { specialEnd: 1 }
  });
  assert.equal(endurance.ok, true, endurance.error);
  assert.equal(endurance.self.maxHp, capReplay.self.maxHp + 9, 'Endurance perk must immediately increase maximum HP');
  assert.equal(endurance.self.perkPoints, 0);
  const noPoints = await ack(socket, 'state', {
    profileOnly: true, talentRanks: { specialEnd: 2 }
  });
  assert.equal(noPoints.ok, false, 'perk allocation without points must be rejected');
  assert.equal(noPoints.self.talentRanks.specialEnd, 1);
  socket.close();
  await delay(500);
  await stopServer();

  await startServer();
  joined = await joinExisting(auth, 'progression_restart_client');
  assert.equal(joined.result.self.skillRanks.lightWeapons, 100);
  assert.equal(joined.result.self.talentRanks.specialStr, 1);
  assert.equal(joined.result.self.skillPoints, 13);
  assert.equal(joined.result.self.perkPoints, 0);
  assert.equal(joined.result.self.talentRanks.specialEnd, 1);
  assert.equal(joined.result.self.maxHp, endurance.self.maxHp);
  joined.socket.close();
  await delay(500);
  await stopServer();

  // «Странник» убран из игры: шаги, вложенные в него, при входе снова свободны,
  // а метка навыка снимается.
  const savedAgain = JSON.parse(fs.readFileSync(savesFile, 'utf8'));
  const wandererState = Object.values(savedAgain.characters).find(store => store && store[auth.characterId])[auth.characterId].state;
  wandererState.progressionLedger.skillSteps.wanderer = 4;
  wandererState.skillRanks = { ...wandererState.skillRanks, wanderer: 55 };
  wandererState.taggedSkills = ['lightWeapons', 'wanderer'];
  fs.writeFileSync(savesFile, JSON.stringify(savedAgain));
  await startServer();
  joined = await joinExisting(auth, 'progression_wanderer_client');
  assert.equal(joined.result.self.skillPoints, 13, 'points spent on the removed Wanderer skill come back');
  assert.equal(joined.result.self.skillRanks.wanderer, undefined, 'the removed skill has no rank');
  assert.equal(joined.result.self.skillRanks.lightWeapons, 100);
  if (Array.isArray(joined.result.self.taggedSkills)) assert(!joined.result.self.taggedSkills.includes('wanderer'), 'the removed skill is no longer tagged');
  joined.socket.close();
  console.log('Kromka progression runtime OK: budget rejection, alias start, migration, atomic proposals, skill cap, replay, restart persistence and the Wanderer refund.');
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { await stopServer(); } catch (_) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
});
