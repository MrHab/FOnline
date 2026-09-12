#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-progression-'));
let server = null;
let port = 0;

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
  await startServer();
  const catalogResponse = await request('/api/kromka/character-progression');
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.json.catalog.skills.items.length, 16);

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
  socket.close();
  await delay(500);
  await stopServer();

  await startServer();
  joined = await joinExisting(auth, 'progression_restart_client');
  assert.equal(joined.result.self.skillRanks.lightWeapons, 51);
  assert.equal(joined.result.self.talentRanks.specialStr, 1);
  assert.equal(joined.result.self.skillPoints, 23);
  assert.equal(joined.result.self.perkPoints, 1);
  joined.socket.close();
  console.log('Kromka progression runtime OK: budget rejection, alias start, migration, replay and restart persistence.');
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try { await stopServer(); } catch (_) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
});
