#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { io: createSocketClient } = require('socket.io-client');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(PROJECT_ROOT, 'server.js');
const CLIENT_HTML = path.join(PROJECT_ROOT, 'public', 'index.html');
const MAX_WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 8000);
const PORT = Number(process.env.SMOKE_PORT || (35000 + Math.floor(Math.random() * 2000)));
const SMOKE_TMP_ROOT = process.env.SMOKE_TMPDIR
  ? path.resolve(process.env.SMOKE_TMPDIR)
  : os.tmpdir();
fs.mkdirSync(SMOKE_TMP_ROOT, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(SMOKE_TMP_ROOT, 'realm-of-ashes-smoke-'));
let serverProc = null;
let cleanedUp = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (serverProc && serverProc.exitCode === null) {
    try { serverProc.kill('SIGTERM'); } catch (_) {}
  }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
}

process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

function fail(message, extra = '') {
  console.error(`Smoke check failed: ${message}`);
  if (extra) console.error(extra.trim());
  cleanup();
  process.exit(1);
}

function assertDependenciesInstalled() {
  const deps = ['express', 'socket.io', 'socket.io-client', 'three'];
  const missing = deps.filter(dep => {
    try {
      require.resolve(`${dep}/package.json`, { paths: [PROJECT_ROOT] });
      return false;
    } catch (_) {
      return true;
    }
  });
  if (missing.length) {
    fail(`dependencies are not installed: ${missing.join(', ')}. Run npm install first.`);
  }
}

function assertRequiredFiles() {
  const required = [
    SERVER_FILE,
    CLIENT_HTML,
    path.join(PROJECT_ROOT, 'public', 'js', 'game.js'),
    path.join(PROJECT_ROOT, 'public', 'css', 'game.css')
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) fail(`required file is missing: ${path.relative(PROJECT_ROOT, file)}`);
  }
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const clientLoaderSource = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'game.js'), 'utf8');
  if (clientLoaderSource.includes("open('GET', url, false)")
    || clientLoaderSource.includes('open("GET", url, false)')) {
    fail('client loader still uses synchronous XMLHttpRequest');
  }
  if (!clientLoaderSource.includes('Promise.all([') || !clientLoaderSource.includes('GAME_SCRIPT_PARTS.map(loadScriptPart)')) {
    fail('client script parts are not loaded in parallel');
  }
  if (!serverSource.includes('max-age=31536000, immutable')) {
    fail('versioned static resources do not use immutable caching');
  }
  if (!serverSource.includes('WASTELAND_SIM_SAVE_INTERVAL_MS')) {
    fail('wasteland simulation save interval is not configurable');
  }
  if (!serverSource.includes('function shouldTickEmptyRoomAi(')
    || !serverSource.includes('room.emptyRoomAiUntil = Math.max(')
    || !serverSource.includes('let emptyRoomAiBudget = 1;')
    || !serverSource.includes('updateServerEnemies(room, dt, { players: [], allowSpawn: false });')) {
    fail('ordinary empty rooms are not put to sleep with a bounded AI budget');
  }
  if (!serverSource.includes('ACTIVE_ROOM_AI_TICK_MS')
    || !serverSource.includes('let activeRoomAiBudget = 1;')
    || !serverSource.includes('const enemyDt = Math.min(ACTIVE_ROOM_AI_MAX_DT')
    || !serverSource.includes('updateServerEnemies(room, enemyDt);')
    || serverSource.includes('updateServerEnemies(room, DT);')) {
    fail('active-room NPC AI is not decoupled from the player movement tick');
  }
  if (!serverSource.includes("finishEmptyPartyEncounterRoom(room, reason);")) {
    fail('empty party encounters are not finalized before room AI sleeps');
  }
  const arrivalTransferStart = serverSource.indexOf('function syncWorldCaravanArrivalTransfers(');
  const arrivalTransferEnd = serverSource.indexOf('function syncWorldOnsitePartyTransfers(', arrivalTransferStart);
  const arrivalTransferBody = serverSource.slice(arrivalTransferStart, arrivalTransferEnd);
    const eligibilityCheck = arrivalTransferBody.indexOf('worldTaskClaimEligible(task, p, participated, worldTransferId)');
  const publicStateRead = arrivalTransferBody.indexOf('WASTELAND_SIM.publicState()');
  const roomCreation = arrivalTransferBody.indexOf('chooseRoomForLocation(locationId)');
  if (arrivalTransferStart < 0
    || arrivalTransferEnd < 0
    || eligibilityCheck < 0
    || publicStateRead < eligibilityCheck
    || roomCreation < eligibilityCheck) {
    fail('caravan arrival polling still materializes public state or rooms without an eligible player');
  }
  const siteLookupStart = serverSource.indexOf('function wastelandSitesForLocation(');
  const siteLookupEnd = serverSource.indexOf('function wastelandLocationOccupantKey(', siteLookupStart);
  const siteLookupBody = serverSource.slice(siteLookupStart, siteLookupEnd);
  if (siteLookupBody.includes('WASTELAND_SIM.publicState()')) {
    fail('location initialization still rebuilds the complete public wasteland state');
  }
  if (serverSource.includes('ROOM_CAPACITY') || serverSource.includes('roomCapacity:')) {
    fail('server still exposes or enforces a per-location player capacity');
  }
}

function assertWorldTaskArchiveReload() {
  const stateFile = path.join(DATA_DIR, 'task-archive-test.json');
  const globalMap = readJsonForTest(path.join(PROJECT_ROOT, 'data', 'global-map.json'));
  const makeTask = (id, status) => ({
    id,
    key: id,
    type: 'deliver_supplies',
    status,
    title: id,
    createdHour: 1,
    expiresHour: 1000,
    completedHour: status === 'active' ? 0 : 5,
    reward: { xp: 10, caps: 5 },
    details: {}
  });
  fs.writeFileSync(stateFile, JSON.stringify({
    worldHour: 10,
    lastTickAt: Date.now(),
    worldTasks: [
      ...Array.from({ length: 85 }, (_, index) => makeTask(`active_${index}`, 'active')),
      ...Array.from({ length: 20 }, (_, index) => makeTask(`done_${index}`, 'completed'))
    ],
    worldTaskHistory: [makeTask('archived_target', 'completed')]
  }));
  let sim = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  if (sim.state().worldTasks.filter(task => task.status === 'active').length !== 85) {
    fail('wasteland simulation truncated active world tasks while loading');
  }
  if (sim.publicWorldTasks(['active_84', 'done_19', 'archived_target']).length !== 3) {
    fail('wasteland simulation could not resolve personal current/archived tasks');
  }
  if (!sim.recordWorldTaskPlayerTransfer('archived_target', ['character_smoke'])) {
    fail('wasteland simulation could not record an archived task transfer');
  }
  sim.save(true);
  sim = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  const archivedTarget = sim.publicWorldTasks(['archived_target'])[0];
  const rawArchivedTarget = [
    ...(Array.isArray(sim.state().worldTasks) ? sim.state().worldTasks : []),
    ...(Array.isArray(sim.state().worldTaskHistory) ? sim.state().worldTaskHistory : [])
  ].find(task => task?.id === 'archived_target');
  if (sim.state().worldTasks.filter(task => task.status === 'active').length !== 85
    || sim.publicWorldTasks(['done_19', 'archived_target']).length !== 2
    || !rawArchivedTarget?.details?.arrivalTransferredPlayerIds?.includes('character_smoke')
    || archivedTarget?.details?.arrivalTransferredPlayerIds !== undefined) {
    fail('wasteland world-task state was lost after save and reload');
  }
}

function seedSmokeReputationTask() {
  const stateFile = path.join(DATA_DIR, 'wasteland-sim.json');
  const globalMap = readJsonForTest(path.join(PROJECT_ROOT, 'data', 'global-map.json'));
  const sim = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  const state = sim.state();
  const conflictingSite = Object.values(state.sites || {}).find(site => (
    site && String(site.owner || site.faction || '') === 'scrap_union'
  ));
  if (!conflictingSite) fail('smoke world has no scrap_union site for frozen reputation verification');
  const taskId = 'smoke_reputation_task';
  state.worldTasks = (Array.isArray(state.worldTasks) ? state.worldTasks : [])
    .filter(task => String(task?.id || '') !== taskId);
  state.worldTaskHistory = (Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
    .filter(task => String(task?.id || '') !== taskId);
  state.worldTasks.unshift({
    id: taskId,
    key: taskId,
    type: 'deliver_supplies',
    status: 'completed',
    title: 'Smoke reputation reward',
    siteId: conflictingSite.id,
    issuerSiteId: conflictingSite.id,
    createdHour: Number(state.worldHour || 0),
    completedHour: Number(state.worldHour || 0),
    expiresHour: Number(state.worldHour || 0) + 100,
    reward: { xp: 1, caps: 1, reputation: 3 },
    details: { rewardCharacterIds: ['c_reward_smoke'], rewardFactionId: 'old_klim' }
  });
  sim.save(true);
}

function seedSmokeWorldPartyTask() {
  const stateFile = path.join(DATA_DIR, 'wasteland-sim.json');
  const globalMap = readJsonForTest(path.join(PROJECT_ROOT, 'data', 'global-map.json'));
  const sim = createWastelandSimulation({ stateFile, getGlobalMap: () => globalMap });
  const state = sim.state();
  const taskId = 'smoke_world_party_task';
  const sharedTerminalTaskId = 'smoke_shared_terminal_task';
  const journalRecoveryTaskId = 'smoke_journal_recovery_task';
  const partyId = 'smoke_world_party';
  const settlement = state.sites?.settlement || { x: 255, y: 615 };
  state.parties[partyId] = {
    id: partyId,
    name: 'Smoke Patrol',
    kind: 'patrol',
    faction: 'old_klim',
    state: 'moving',
    x: Number(settlement.x || 255),
    y: Number(settlement.y || 615),
    speedKmh: 18,
    baseSpeedKmh: 18,
    strength: 30,
    members: 4,
    homeSiteId: 'settlement',
    destinationSiteId: '',
    route: [],
    cargo: {},
    playerMembers: []
  };
  state.worldTasks = (Array.isArray(state.worldTasks) ? state.worldTasks : [])
    .filter(task => ![taskId, sharedTerminalTaskId, journalRecoveryTaskId].includes(String(task?.id || '')));
  state.worldTaskHistory = (Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
    .filter(task => ![taskId, sharedTerminalTaskId, journalRecoveryTaskId].includes(String(task?.id || '')));
  state.worldTasks.unshift({
    id: taskId,
    key: taskId,
    type: 'join_patrol',
    status: 'active',
    title: 'Smoke world party',
    siteId: 'settlement',
    issuerSiteId: 'settlement',
    partyId,
    createdHour: Number(state.worldHour || 0),
    completedHour: 0,
    expiresHour: Number(state.worldHour || 0) + 100,
    priority: 5,
    reward: { xp: 1, caps: 1, reputation: 1 },
    details: {}
  });
  state.worldTasks.unshift({
    id: sharedTerminalTaskId,
    key: sharedTerminalTaskId,
    type: 'deliver_supplies',
    status: 'active',
    title: 'Smoke shared terminal lifecycle',
    siteId: 'settlement',
    issuerSiteId: 'settlement',
    partyId: '',
    createdHour: Number(state.worldHour || 0),
    completedHour: 0,
    expiresHour: Number(state.worldHour || 0) + 100,
    priority: 5,
    reward: { xp: 1, caps: 1, reputation: 1 },
    details: { demand: { water: 1 } }
  });
  state.worldTaskHistory.unshift({
    id: journalRecoveryTaskId,
    key: journalRecoveryTaskId,
    type: 'deliver_supplies',
    status: 'completed',
    title: 'Smoke migration journal recovery',
    siteId: 'settlement',
    issuerSiteId: 'settlement',
    partyId: '',
    createdHour: Number(state.worldHour || 0),
    completedHour: Number(state.worldHour || 0),
    expiresHour: Number(state.worldHour || 0) + 100,
    priority: 1,
    reward: { xp: 1, caps: 1, reputation: 1 },
    details: {
      rewardMemberKeys: ['journal_user:journal_old_character'],
      arrivalTransferredPlayerIds: ['journal_user:journal_old_character']
    }
  });
  sim.save(true);
}

function seedLegacyDuplicateCharacters() {
  const characterId = 'legacy_shared_character';
  const row = name => ({
    id: characterId,
    login: name.toLowerCase(),
    createdAt: 1,
    updatedAt: 1,
    summary: { id: characterId, name, level: 1 },
    state: {
      marker: `preserve_${name}`,
      characterProfile: { serverCharacterId: characterId, name },
      player: { level: 1, maxHp: 100, hp: 100 },
      currentLocationId: 'settlement'
    }
  });
  const journalCharacterId = 'journal_new_character';
  const journalRow = row('JournalRecovery');
  journalRow.id = journalCharacterId;
  journalRow.summary.id = journalCharacterId;
  journalRow.state.characterProfile.serverCharacterId = journalCharacterId;
  fs.writeFileSync(path.join(DATA_DIR, 'saves.json'), JSON.stringify({
    version: 2,
    characters: {
      legacy_user_b: { [characterId]: row('LegacyB') },
      legacy_user_a: { [characterId]: row('LegacyA') },
      journal_user: { [journalCharacterId]: journalRow }
    },
    characterIdMigrationJournal: {
      version: 1,
      remaps: [{
        userId: 'journal_user',
        previousCharacterId: 'journal_old_character',
        characterId: journalCharacterId
      }]
    }
  }, null, 2));
}

function assertLegacyDuplicateMigration(expectedRemappedId = '') {
  const saves = readJsonForTest(path.join(DATA_DIR, 'saves.json'));
  const first = saves.characters?.legacy_user_a || {};
  const second = saves.characters?.legacy_user_b || {};
  if (!first.legacy_shared_character) {
    fail('startup legacy migration did not keep the deterministic first owner');
  }
  if (second.legacy_shared_character) {
    fail('startup legacy migration left the colliding character id on the second account');
  }
  const secondRows = Object.values(second);
  if (secondRows.length !== 1
    || !secondRows[0]?.id
    || secondRows[0].id === 'legacy_shared_character'
    || secondRows[0].state?.characterProfile?.serverCharacterId !== secondRows[0].id
    || secondRows[0].summary?.id !== secondRows[0].id
    || secondRows[0].state?.marker !== 'preserve_LegacyB') {
    fail('startup legacy migration did not persist a complete remapped character row', JSON.stringify(secondRows));
  }
  if (expectedRemappedId && secondRows[0].id !== expectedRemappedId) {
    fail('startup legacy migration was not idempotent across restart', JSON.stringify({
      expectedRemappedId,
      actualRemappedId: secondRows[0].id
    }));
  }
  if (saves.characterIdMigrationJournal) {
    fail('character-id migration journal was cleared before or left after durable world reconciliation');
  }
  return secondRows[0].id;
}

function assertPendingMigrationJournalRecovery() {
  const simulation = readJsonForTest(path.join(DATA_DIR, 'wasteland-sim.json'));
  const task = [
    ...(Array.isArray(simulation.worldTasks) ? simulation.worldTasks : []),
    ...(Array.isArray(simulation.worldTaskHistory) ? simulation.worldTaskHistory : [])
  ].find(row => row?.id === 'smoke_journal_recovery_task');
  const expected = 'journal_user:journal_new_character';
  if (!task
    || !task.details?.rewardMemberKeys?.includes(expected)
    || task.details.rewardMemberKeys.includes('journal_user:journal_old_character')
    || !task.details?.arrivalTransferredPlayerIds?.includes(expected)
    || task.details.arrivalTransferredPlayerIds.includes('journal_user:journal_old_character')) {
    fail('pending character-id migration journal did not recover exact world identities', JSON.stringify(task));
  }
}

function readJsonForTest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const body = options.json ? JSON.stringify(options.json) : (options.body || '');
    const headers = { ...(options.headers || {}) };
    if (options.json) headers['Content-Type'] = 'application/json';
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: pathname, method, headers, timeout: 1200 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseJsonResponse(res, label) {
  try {
    return JSON.parse(res.body);
  } catch (err) {
    fail(`${label} did not return valid JSON`, res.body.slice(0, 500));
  }
}

function assertStatus(res, expected, label) {
  if (res.statusCode !== expected) {
    fail(`${label} returned HTTP ${res.statusCode}, expected ${expected}`, res.body.slice(0, 500));
  }
}

function authHeaders(token, deviceId, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Device-Id': deviceId,
    'X-Client-Instance-Id': options.clientInstanceId || `${deviceId}_client`,
    'X-Device-Type': 'desktop',
    'X-Control-Type': 'keyboard_mouse'
  };
  if (options.characterLeaseId) headers['X-Character-Lease-Id'] = options.characterLeaseId;
  return headers;
}

async function waitForHealth(proc, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    if (proc.exitCode !== null) {
      fail('server exited before /health became available', logs.join(''));
    }
    try {
      const res = await request('/health');
      if (res.statusCode === 200) {
        const data = JSON.parse(res.body);
        if (!data.ok) fail('/health responded without ok=true', res.body);
        if (!data.version) fail('/health responded without version field', res.body);
        if (data.playerLimitPerLocation !== null || Object.prototype.hasOwnProperty.call(data, 'roomCapacity')) {
          fail('/health still reports a per-location player limit', res.body);
        }
        return data;
      }
    } catch (_) {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fail(`/health did not respond within ${MAX_WAIT_MS}ms`, logs.join(''));
}

async function assertStaticAssets(health) {
  const html = await request('/');
  assertStatus(html, 200, 'GET /');
  if (!html.body.includes('Realm of Ashes')) {
    fail('root page did not return the client HTML', html.body.slice(0, 500));
  }
  if (health.version && !html.body.includes(`Realm of Ashes v${health.version}`)) {
    fail('root page version is not synced with /health', html.body.slice(0, 500));
  }
  if (html.body.includes('id="server-url-input"')
    || !html.body.includes('id="register-email-input"')
    || !html.body.includes('id="password-reset-panel"')
    || !html.body.includes('/vendor/socket.io.min.js')) {
    fail('root page server authentication controls are incomplete', html.body.slice(0, 800));
  }
  if (html.body.includes('/socket.io/socket.io.js')) {
    fail('root page still depends on the Node-only Socket.IO client route', html.body.slice(0, 800));
  }
  if (!html.body.includes('id="network-ping"')) {
    fail('root page is missing the network ping HUD indicator', html.body.slice(0, 500));
  }

  const css = await request('/css/game.css');
  assertStatus(css, 200, 'GET /css/game.css');
  if (!css.body.includes('16_mobile_ui_icons.css')) {
    fail('CSS loader does not include the mobile UI icon layer', css.body.slice(0, 500));
  }

  const js = await request('/js/game.js');
  assertStatus(js, 200, 'GET /js/game.js');
  if (!js.body.includes('GAME_SCRIPT_PARTS')) {
    fail('client JS loader did not look like the expected loader', js.body.slice(0, 500));
  }

  const three = await request('/vendor/three.min.js');
  assertStatus(three, 200, 'GET /vendor/three.min.js');
  if (!three.body.includes('THREE')) {
    fail('Three.js vendor route did not serve the browser bundle', three.body.slice(0, 500));
  }

  const socketIoClient = await request('/vendor/socket.io.min.js');
  assertStatus(socketIoClient, 200, 'GET /vendor/socket.io.min.js');
  if (!socketIoClient.body.includes('Socket.IO')) {
    fail('vendored Socket.IO browser client was not served', socketIoClient.body.slice(0, 500));
  }
}

async function assertRestCorsPreflight() {
  const requestedHeaders = [
    'Content-Type',
    'Authorization',
    'X-Dev-Token',
    'X-Device-Id',
    'X-Client-Instance-Id',
    'X-Character-Lease-Id',
    'X-Device-Type',
    'X-Control-Type'
  ];
  const localIpv4 = Object.values(os.networkInterfaces())
    .flatMap(rows => Array.isArray(rows) ? rows : [])
    .find(row => row?.family === 'IPv4' && !row.internal)?.address || '127.0.0.1';
  const origin = `http://${localIpv4}:${PORT}`;
  const preflight = await request('/api/auth/me', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requestedHeaders.join(', ')
    }
  });
  assertStatus(preflight, 204, 'REST CORS preflight');
  if (preflight.headers['access-control-allow-origin'] !== origin) {
    fail('REST CORS preflight did not allow the server LAN origin', JSON.stringify(preflight.headers, null, 2));
  }
  const allowHeaders = String(preflight.headers['access-control-allow-headers'] || '').toLowerCase();
  for (const header of requestedHeaders) {
    if (!allowHeaders.split(',').map(v => v.trim()).includes(header.toLowerCase())) {
      fail(`REST CORS preflight does not allow ${header}`, JSON.stringify(preflight.headers, null, 2));
    }
  }

  const rejected = await request('/api/auth/me', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.invalid',
      'Access-Control-Request-Method': 'GET'
    }
  });
  assertStatus(rejected, 204, 'untrusted REST CORS preflight');
  if (rejected.headers['access-control-allow-origin']) {
    fail('REST CORS preflight allowed an untrusted origin', JSON.stringify(rejected.headers, null, 2));
  }
}

async function assertEditorAndWorldDataApis() {
  const localDevHeaders = { 'X-Dev-Local': '1' };
  const locationEditor = await request('/dev-location-editor.html');
  assertStatus(locationEditor, 200, 'GET /dev-location-editor.html');
  if (!locationEditor.body.includes('/api/dev/locations') || !locationEditor.body.includes('dev-location-editor.html')) {
    fail('location editor page is missing its server-backed editor hooks', locationEditor.body.slice(0, 500));
  }
  if (!locationEditor.body.includes("window.location.protocol !== 'file:'")) {
    fail('location editor page is missing the file:// redirect guard', locationEditor.body.slice(0, 500));
  }

  const globalMapEditor = await request('/dev-global-map-editor.html');
  assertStatus(globalMapEditor, 200, 'GET /dev-global-map-editor.html');
  if (!globalMapEditor.body.includes('/api/dev/global-map') || !globalMapEditor.body.includes('dev-global-map-editor.html')) {
    fail('global map editor page is missing its server-backed editor hooks', globalMapEditor.body.slice(0, 500));
  }
  if (!globalMapEditor.body.includes("window.location.protocol !== 'file:'")) {
    fail('global map editor page is missing the file:// redirect guard', globalMapEditor.body.slice(0, 500));
  }

  const proxiedLocalDevRequest = await request('/api/dev/locations', {
    headers: {
      ...localDevHeaders,
      'X-Real-IP': '203.0.113.40',
      'X-Forwarded-For': '203.0.113.40',
      'X-Forwarded-Proto': 'https'
    }
  });
  assertStatus(proxiedLocalDevRequest, 403, 'proxied local dev API request');

  const locations = await request('/api/dev/locations', { headers: localDevHeaders });
  assertStatus(locations, 200, 'GET /api/dev/locations');
  const locationsData = parseJsonResponse(locations, 'GET /api/dev/locations');
  if (!locationsData.ok
    || !Array.isArray(locationsData.locations)
    || locationsData.locations.length < 20
    || !locationsData.locations.some(loc => loc.id === 'settlement')) {
    fail('fresh DATA_DIR did not inherit the bundled location definitions', locations.body);
  }

  const settlement = await request('/api/dev/locations/settlement', { headers: localDevHeaders });
  assertStatus(settlement, 200, 'GET /api/dev/locations/settlement');
  const settlementData = parseJsonResponse(settlement, 'GET /api/dev/locations/settlement');
  if (!settlementData.ok || settlementData.location?.id !== 'settlement') {
    fail('dev settlement API response is incomplete', settlement.body);
  }

  const globalMap = await request('/api/dev/global-map', { headers: localDevHeaders });
  assertStatus(globalMap, 200, 'GET /api/dev/global-map');
  const globalMapData = parseJsonResponse(globalMap, 'GET /api/dev/global-map');
  if (!globalMapData.ok
    || !globalMapData.map?.grid
    || !Array.isArray(globalMapData.map?.nodes)
    || globalMapData.map.nodes.length < 3
    || Object.keys(globalMapData.map?.cells || {}).length < 100
    || !Array.isArray(globalMapData.locations)) {
    fail('fresh DATA_DIR did not inherit the bundled global map', globalMap.body);
  }

  const publicLocations = await request('/api/locations');
  assertStatus(publicLocations, 200, 'GET /api/locations');
  const publicLocationsData = parseJsonResponse(publicLocations, 'GET /api/locations');
  if (!publicLocationsData.ok
    || !publicLocationsData.locations?.settlement
    || Object.keys(publicLocationsData.locations || {}).length < 20) {
    fail('public locations API did not expose the bundled locations', publicLocations.body);
  }
  const capitalStorageFactions = {
    settlement: 'old_klim',
    scrapTown: 'scrap_union',
    relayStation: 'relay_order'
  };
  const locationsWithStorage = Object.values(publicLocationsData.locations || {})
    .filter(loc => !!loc?.storage)
    .map(loc => loc.id)
    .sort();
  if (locationsWithStorage.join(',') !== Object.keys(capitalStorageFactions).sort().join(',')) {
    fail('personal storage exists outside the three faction capitals', JSON.stringify(locationsWithStorage));
  }
  for (const [locationId, factionId] of Object.entries(capitalStorageFactions)) {
    const loc = publicLocationsData.locations[locationId];
    const storageRows = (Array.isArray(loc?.objects) ? loc.objects : []).filter(row => (
      String(row?.interactive?.role || '').toLowerCase() === 'storage'
      || (Array.isArray(row?.tags) && row.tags.includes('capital-storage'))
    ));
    if (loc?.storage?.storageFaction !== factionId
      || storageRows.length !== 1
      || storageRows[0]?.interactive?.storageFaction !== factionId) {
      fail(`capital storage is incomplete or linked to the wrong faction: ${locationId}`, JSON.stringify(loc));
    }
  }

  const quests = await request('/api/quests');
  assertStatus(quests, 200, 'GET /api/quests');
  const questsData = parseJsonResponse(quests, 'GET /api/quests');
  if (!questsData.ok || Object.keys(questsData.quests || {}).length < 4) {
    fail('fresh DATA_DIR did not inherit the bundled quest definitions', quests.body);
  }

  const wasteland = await request('/api/wasteland');
  assertStatus(wasteland, 200, 'GET /api/wasteland');
  const wastelandData = parseJsonResponse(wasteland, 'GET /api/wasteland');
  if (!wastelandData.ok || !wastelandData.sim) {
    fail('wasteland API response is incomplete', wasteland.body);
  }
  const worldSites = Array.isArray(wastelandData.sim.sites) ? wastelandData.sim.sites : [];
  const worldLocationIds = worldSites.map(site => String(site?.locationId || '')).filter(Boolean);
  if (new Set(worldLocationIds).size !== worldLocationIds.length) {
    fail('multiple global sites still lead to one local location id');
  }
  const worldPointKeys = worldSites.map(site => `${Number(site?.x || 0).toFixed(2)}:${Number(site?.y || 0).toFixed(2)}`);
  if (new Set(worldPointKeys).size !== worldPointKeys.length) {
    fail('multiple global locations still occupy the same world point');
  }
  const locationInstances = worldSites.filter(site => site?.templateLocationId);
  if (locationInstances.length < 80) {
    fail('district world sites were not materialized as unique locations');
  }
  const worldNames = worldSites.map(site => String(site?.name || '')).filter(Boolean);
  const worldDescriptions = worldSites.map(site => String(site?.description || site?.note || '')).filter(Boolean);
  if (worldNames.length !== worldSites.length || new Set(worldNames).size !== worldNames.length) {
    fail('global locations do not have unique non-empty names');
  }
  if (worldDescriptions.length !== worldSites.length || new Set(worldDescriptions).size !== worldDescriptions.length) {
    fail('global locations do not have unique non-empty descriptions');
  }
  const instanceSizes = locationInstances.map(site => `${site.localWidthTiles}x${site.localHeightTiles}`);
  if (new Set(instanceSizes).size !== instanceSizes.length) {
    fail('district location instances do not have unique playable sizes');
  }
  const instanceSeeds = [];
  const instanceBounds = [];
  for (const site of worldSites) {
    const loc = publicLocationsData.locations?.[site.locationId];
    if (!site.locationId || !loc) {
      fail(`global site has no real local location: ${site.id || 'unknown'}`, JSON.stringify(site));
    }
    if (String(loc.name || '') !== String(site.name || '') || String(loc.description || '') !== String(site.description || site.note || '')) {
      fail(`global and local location identity is inconsistent: ${site.id}`, JSON.stringify({ site, location: loc }));
    }
    if (site.templateLocationId
      && (!loc.worldSiteInstance || loc.worldSiteId !== site.id || loc.templateLocationId !== site.templateLocationId)) {
      fail(`world location instance is not linked to its site: ${site.id}`, JSON.stringify(loc));
    }
    if (site.templateLocationId) {
      instanceSeeds.push(Number(loc.seed || 0));
      instanceBounds.push(`${loc.playableBounds?.width || 0}x${loc.playableBounds?.height || 0}`);
      if (loc.runtimeMode !== 'worldSiteInstance'
        || !loc.description
        || !loc.playableBounds
        || (Array.isArray(loc.objects) && loc.objects.length > 0)
        || !Array.isArray(loc.containers)
        || loc.containers.length < 1) {
        fail(`world location instance still clones template content: ${site.id}`, JSON.stringify(loc));
      }
    }
  }
  if (new Set(instanceSeeds).size !== instanceSeeds.length || new Set(instanceBounds).size !== instanceBounds.length) {
    fail('world location materialization reused a seed or playable bounds');
  }
}

async function assertAuthApiLifecycle() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const login = `smoke_${suffix}`;
  const password = `smoke-pass-${suffix}`;
  const deviceId = `smoke_${suffix}`;
  const clientInstanceId = `smoke_client_${suffix}`;

  const unauthenticated = await request('/api/auth/me');
  assertStatus(unauthenticated, 401, 'GET /api/auth/me without token');

  const register = await request('/api/auth/register', {
    method: 'POST',
    json: { login, email: `${login}@example.test`, password, deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' }
  });
  assertStatus(register, 200, 'POST /api/auth/register');
  const registered = parseJsonResponse(register, 'POST /api/auth/register');
  if (!registered.ok || !registered.token || registered.user?.login !== login) {
    fail('registration response is incomplete', register.body);
  }

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    json: { login, email: `${login}@example.test`, password, deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' }
  });
  assertStatus(duplicate, 409, 'duplicate POST /api/auth/register');

  const headers = authHeaders(registered.token, deviceId, { clientInstanceId });

  const me = await request('/api/auth/me', { headers });
  assertStatus(me, 200, 'GET /api/auth/me');
  const current = parseJsonResponse(me, 'GET /api/auth/me');
  if (!current.ok || current.user?.login !== login || !Array.isArray(current.characters)) {
    fail('profile response is incomplete', me.body);
  }

  const characters = await request('/api/characters', { headers });
  assertStatus(characters, 200, 'GET /api/characters');
  const characterList = parseJsonResponse(characters, 'GET /api/characters');
  if (!characterList.ok || !Array.isArray(characterList.characters)) {
    fail('characters response is incomplete', characters.body);
  }

  const unknownReset = await request('/api/auth/password-reset/request', {
    method: 'POST',
    json: { email: `missing-${suffix}@example.test` }
  });
  assertStatus(unknownReset, 200, 'POST password reset for unknown email');
  const unknownResetData = parseJsonResponse(unknownReset, 'POST password reset for unknown email');
  if (!unknownResetData.ok) fail('password reset response is incomplete', unknownReset.body);

  const characterId = `c_smoke_${suffix}`;
  const blockedSave = await request(`/api/characters/${encodeURIComponent(characterId)}/save`, {
    method: 'POST',
    headers,
    json: {
      characterId,
      state: {
        version: 4,
        characterProfile: { name: 'Smoke Test', serverCharacterId: characterId, createdAt: Date.now() },
        player: { level: 1, xp: 0 },
        currentLocationId: 'settlement',
        savedAt: Date.now()
      }
    }
  });
  assertStatus(blockedSave, 404, 'POST save for missing character');
  const blockedSaveData = parseJsonResponse(blockedSave, 'POST save for missing character');
  if (blockedSaveData.ok || !blockedSaveData.error) {
    fail('save for missing character was not rejected with an error', blockedSave.body);
  }

  const afterBlockedSave = await request('/api/characters', { headers });
  assertStatus(afterBlockedSave, 200, 'GET /api/characters after blocked save');
  const afterBlockedList = parseJsonResponse(afterBlockedSave, 'GET /api/characters after blocked save');
  if (!afterBlockedList.ok || afterBlockedList.characters.length !== 0) {
    fail('blocked save changed the character list', afterBlockedSave.body);
  }

  const logout = await request('/api/auth/logout', { method: 'POST', headers });
  assertStatus(logout, 200, 'POST /api/auth/logout');
  const logoutData = parseJsonResponse(logout, 'POST /api/auth/logout');
  if (!logoutData.ok) fail('logout response is incomplete', logout.body);

  const afterLogout = await request('/api/auth/me', { headers });
  assertStatus(afterLogout, 401, 'GET /api/auth/me after logout');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function socketAck(socket, event, payload = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), timeoutMs);
    socket.emit(event, payload, result => {
      clearTimeout(timer);
      resolve(result || {});
    });
  });
}

function connectSocketClient() {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(`http://127.0.0.1:${PORT}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 2500
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Socket.IO connection timed out'));
    }, 3000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', err => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

async function registerSocketTestAccount(index, suffix) {
  const login = `multi_${index}_${suffix}`;
  const password = `multi-pass-${index}-${suffix}`;
  const deviceId = `multi_device_${index}_${suffix}`;
  const clientInstanceId = `multi_client_${index}_${suffix}`;
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { login, email: `${login}@example.test`, password, deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' }
  });
  assertStatus(response, 200, `multiplayer register ${index}`);
  const data = parseJsonResponse(response, `multiplayer register ${index}`);
  if (!data.ok || !data.token) fail(`multiplayer register ${index} returned no token`, response.body);
  return {
    login,
    token: data.token,
    deviceId,
    clientInstanceId,
    characterId: `c_multi_${index}_${suffix}`,
    name: `Tester ${index}`
  };
}

async function joinSocketCharacter(socket, account) {
  return socketAck(socket, 'join', {
    token: account.token,
    deviceId: account.deviceId,
    clientInstanceId: account.clientInstanceId,
    deviceType: 'desktop',
    controlType: 'keyboard_mouse',
    characterId: account.characterId,
    name: account.name,
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 },
    traits: ['trainedEye'],
    taggedSkills: ['lightWeapons']
  });
}

async function assertCharacterDeletionLifecycle(account) {
  const headers = authHeaders(account.token, account.deviceId, {
    clientInstanceId: account.clientInstanceId
  });
  const pathname = `/api/characters/${encodeURIComponent(account.characterId)}`;

  const missingConfirmation = await request(pathname, {
    method: 'DELETE',
    headers
  });
  assertStatus(missingConfirmation, 400, 'DELETE character without confirmation');

  const wrongConfirmation = await request(pathname, {
    method: 'DELETE',
    headers,
    json: { confirmCharacterId: `${account.characterId}_wrong` }
  });
  assertStatus(wrongConfirmation, 400, 'DELETE character with wrong confirmation');

  const activeDeletion = await request(pathname, {
    method: 'DELETE',
    headers,
    json: { confirmCharacterId: account.characterId }
  });
  assertStatus(activeDeletion, 409, 'DELETE active character');

  const retained = await request('/api/characters', { headers });
  assertStatus(retained, 200, 'GET /api/characters after rejected deletion');
  const retainedData = parseJsonResponse(retained, 'GET /api/characters after rejected deletion');
  if (!retainedData.ok
    || !Array.isArray(retainedData.characters)
    || !retainedData.characters.some(row => row.id === account.characterId)) {
    fail('rejected character deletion removed the character', retained.body);
  }

  account.socket.close();
  await delay(250);

  const deleted = await request(pathname, {
    method: 'DELETE',
    headers,
    json: { confirmCharacterId: account.characterId }
  });
  assertStatus(deleted, 200, 'DELETE disconnected character');
  const deletedData = parseJsonResponse(deleted, 'DELETE disconnected character');
  if (!deletedData.ok || !Array.isArray(deletedData.characters) || deletedData.characters.length !== 0) {
    fail('character deletion response did not contain an empty character list', deleted.body);
  }

  const characters = await request('/api/characters', { headers });
  assertStatus(characters, 200, 'GET /api/characters after deletion');
  const characterList = parseJsonResponse(characters, 'GET /api/characters after deletion');
  if (!characterList.ok || !Array.isArray(characterList.characters) || characterList.characters.length !== 0) {
    fail('deleted character remained in the character list', characters.body);
  }

  const deletedCharacter = await request(pathname, { headers });
  assertStatus(deletedCharacter, 404, 'GET deleted character');

  const repeatedDeletion = await request(pathname, {
    method: 'DELETE',
    headers,
    json: { confirmCharacterId: account.characterId }
  });
  assertStatus(repeatedDeletion, 404, 'repeated DELETE character');
}

async function assertSocketMultiplayerLifecycle() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const accounts = await Promise.all([1, 2, 3].map(index => registerSocketTestAccount(index, suffix)));
  accounts[0].characterId = 'c_reward_smoke';
  const collidedCharacterId = accounts[0].characterId;
  accounts[1].characterId = collidedCharacterId;
  const sockets = [];
  try {
    for (const account of accounts) {
      const socket = await connectSocketClient();
      sockets.push(socket);
      account.socket = socket;
      account.enemySnapshots = [];
      socket.on('enemySnapshot', payload => {
        if (Array.isArray(payload?.enemies)) account.enemySnapshots.push(payload.enemies);
      });
      if (account === accounts[0]) {
        const invalidJoin = await socketAck(socket, 'join', {
          token: account.token,
          deviceId: account.deviceId,
          clientInstanceId: account.clientInstanceId,
          deviceType: 'desktop',
          controlType: 'keyboard_mouse',
          characterId: account.characterId,
          name: account.name,
          special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 }
        });
        if (invalidJoin.ok) {
          fail('new character join without traits and tagged skills was accepted', JSON.stringify(invalidJoin));
        }
        const invalidJoinCharacters = await request('/api/characters', {
          headers: authHeaders(account.token, account.deviceId, {
            clientInstanceId: account.clientInstanceId
          })
        });
        assertStatus(invalidJoinCharacters, 200, 'GET /api/characters after invalid join');
        const invalidJoinList = parseJsonResponse(invalidJoinCharacters, 'GET /api/characters after invalid join');
        if (!invalidJoinList.ok
          || !Array.isArray(invalidJoinList.characters)
          || invalidJoinList.characters.length !== 0) {
          fail('invalid character join changed the character list', invalidJoinCharacters.body);
        }
      }
      account.join = await joinSocketCharacter(socket, account);
      if (!account.join.ok || !account.join.self || !account.join.characterLeaseId) {
        fail(`multiplayer join failed for ${account.name}`, JSON.stringify(account.join));
      }
      if (account === accounts[1]) {
        if (!account.join.characterId
          || account.join.characterId === collidedCharacterId
          || account.join.self?.characterId !== account.join.characterId) {
          fail('cross-account character-id collision was not remapped by the server', JSON.stringify(account.join));
        }
        account.characterId = account.join.characterId;
      }
      if (!Array.isArray(account.join.self.taggedSkills)
        || account.join.self.taggedSkills.length !== 1
        || account.join.self.taggedSkills[0] !== 'lightWeapons') {
        fail('multiplayer join did not preserve tagged skills', JSON.stringify(account.join.self));
      }
      if (!Array.isArray(account.join.self.worldTaskRecords)) {
        fail('authoritative player state is missing personal world-task records', JSON.stringify(account.join.self));
      }
      if (account.join.roomId !== 'settlement' || Object.prototype.hasOwnProperty.call(account.join, 'roomCapacity')) {
        fail('settlement join still uses a numbered room or publishes a capacity', JSON.stringify(account.join));
      }
      const pingStartedAt = Date.now();
      const pingAck = await socketAck(socket, 'networkPing', { clientTime: pingStartedAt });
      if (!pingAck.ok
        || Number(pingAck.clientTime) !== pingStartedAt
        || !Number.isFinite(Number(pingAck.serverTime))) {
        fail('game socket did not acknowledge the network ping probe', JSON.stringify(pingAck));
      }
    }

    if (!Array.isArray(accounts[2].join.players) || accounts[2].join.players.length < 2) {
      fail('three joined players did not share the single settlement reality', JSON.stringify(accounts[2].join));
    }

    await delay(120);
    const settlementEnemies = accounts[2].enemySnapshots.at(-1) || [];
    const friendlySapientNpcs = settlementEnemies.filter(actor => {
      if (!actor || actor.dead || actor.hostileToPlayer !== false) return false;
      const role = String(actor.role || actor.encounterRole || '').toLowerCase();
      const species = String(actor.species || actor.visual || '').toLowerCase();
      return !['animal', 'monster'].includes(role) && !['brahmin', 'gecko', 'firegecko', 'radscorpion', 'mutantant', 'wolf'].includes(species);
    });
    if (!friendlySapientNpcs.length) fail('settlement snapshot contained no friendly sapient NPCs');
    const ammoByWeapon = {
      pistol: 'ammo9',
      rifle: 'ammo556',
      assaultRifle: 'ammo556',
      machineGun: 'ammo556',
      laserPistol: 'energyCell',
      plasmaRifle: 'energyCell',
      shotgun: 'shotgunShell',
      flamethrower: 'napalm',
      rocketLauncher: 'rocketAmmo'
    };
    for (const actor of friendlySapientNpcs) {
      if (actor.canDialogue !== true
        || !actor.traderId
        || !Array.isArray(actor.traderStock)
        || !Array.isArray(actor.traderBuyInterests)
        || actor.traderBuyInterests.length === 0) {
        fail('friendly sapient NPC was missing dialogue or barter state', JSON.stringify(actor));
      }
      if (!Array.isArray(actor.inventory)
        || !actor.inventory.some(row => row?.id === 'silver' && Number(row?.qty || 0) > 0)
        || !actor.equipment?.weapon
        || !actor.inventory.some(row => row?.id === actor.equipment.weapon && Number(row?.qty || 0) > 0)) {
        fail('friendly sapient NPC was missing personal money, inventory, or equipped weapon', JSON.stringify(actor));
      }
      const ammoId = ammoByWeapon[actor.equipment.weapon];
      if (ammoId && !actor.inventory.some(row => row?.id === ammoId && Number(row?.qty || 0) > 0)) {
        fail('friendly sapient NPC was spawned with a ranged weapon but no matching ammunition', JSON.stringify(actor));
      }
    }

    const duplicate = await connectSocketClient();
    sockets.push(duplicate);
    const duplicateJoin = await joinSocketCharacter(duplicate, accounts[0]);
    if (duplicateJoin.ok) fail('duplicate live account/character join was accepted', JSON.stringify(duplicateJoin));
    duplicate.close();

    const first = accounts[0];
    const second = accounts[1];
    const sharedTerminalTaskId = 'smoke_shared_terminal_task';
    for (const participant of [first, second]) {
      const accepted = await socketAck(participant.socket, 'worldTaskAction', {
        action: 'accept',
        taskId: sharedTerminalTaskId
      });
      if (!accepted.ok || !accepted.self?.worldTaskAccepted?.includes(sharedTerminalTaskId)) {
        fail('shared terminal smoke task could not be accepted by both players', JSON.stringify(accepted));
      }
    }
    await delay(1100);
    const secondTerminalState = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        second.socket.off('authoritativePlayerState', onState);
        reject(new Error('second player did not receive terminal task lifecycle state'));
      }, 4000);
      const onState = payload => {
        const record = (Array.isArray(payload?.worldTaskRecords)
          ? payload.worldTaskRecords
          : []).find(row => row?.id === sharedTerminalTaskId);
        if (payload?.reason !== 'worldTaskLifecycle' || record?.status !== 'completed') return;
        clearTimeout(timer);
        second.socket.off('authoritativePlayerState', onState);
        resolve(payload);
      };
      second.socket.on('authoritativePlayerState', onState);
    });
    const sharedDelivery = await socketAck(first.socket, 'worldTaskAction', {
      action: 'deliver',
      taskId: sharedTerminalTaskId
    });
    if (!sharedDelivery.ok || sharedDelivery.task?.status !== 'completed') {
      fail('first player could not complete the shared terminal smoke task', JSON.stringify(sharedDelivery));
    }
    let secondLifecycle;
    try {
      secondLifecycle = await secondTerminalState;
    } catch (err) {
      fail(err.message);
    }
    const secondTerminalRecord = secondLifecycle?.worldTaskRecords
      ?.find(row => row?.id === sharedTerminalTaskId);
    if (!secondLifecycle?.worldTaskAccepted?.includes(sharedTerminalTaskId)
      || secondTerminalRecord?.status !== 'completed'
      || secondTerminalRecord?.rewardEligible !== true) {
      fail('second player received stale or non-personalized terminal task state', JSON.stringify(secondLifecycle));
    }
    const reputationClaim = await socketAck(first.socket, 'worldTaskAction', {
      action: 'claim',
      taskId: 'smoke_reputation_task'
    });
    if (!reputationClaim.ok
      || Number(reputationClaim.reward?.reputation || 0) !== 3
      || reputationClaim.reward?.reputationFactionId !== 'old_klim'
      || Number(reputationClaim.self?.worldFactionReputation?.old_klim || 0) !== 3) {
      fail('world-task reputation reward was not granted authoritatively', JSON.stringify(reputationClaim));
    }
    const repeatedReputationClaim = await socketAck(first.socket, 'worldTaskAction', {
      action: 'claim',
      taskId: 'smoke_reputation_task'
    });
    if (repeatedReputationClaim.ok) {
      fail('completed world-task reward could be claimed twice', JSON.stringify(repeatedReputationClaim));
    }
    const friendRequest = await socketAck(first.socket, 'socialAction', {
      action: 'friend',
      targetId: second.socket.id
    });
    if (!friendRequest.ok) fail('nearby friend request failed', JSON.stringify(friendRequest));
    const friendAccept = await socketAck(second.socket, 'socialStateAction', {
      action: 'acceptFriend',
      targetId: first.characterId
    });
    const secondFriends = friendAccept.self?.socialState?.friends || [];
    if (!friendAccept.ok || !secondFriends.some(row => row.id === first.characterId)) {
      fail('friend request was not persisted for the recipient', JSON.stringify(friendAccept));
    }

    const initial = first.join.self;
    first.socket.emit('state', {
      seq: 1,
      x: 120,
      z: 120,
      hp: 9999,
      maxHp: 9999,
      level: 999,
      xp: 9999999,
      inventory: { rocketAmmo: 9999, silver: 9999 },
      special: { str: 15, per: 15, end: 15, cha: 15, int: 15, agi: 15, luck: 15 },
      moving: true,
      vx: 999,
      vz: 999
    });
    await delay(150);
    const current = await socketAck(first.socket, 'changeLocation', { locationId: 'settlement', x: 120, z: 120 });
    const currentInventory = Array.isArray(current.self?.inventory) ? current.self.inventory : [];
    if (!current.ok || Number(current.self?.hp || 0) > Number(current.self?.maxHp || 100) || Number(current.self?.level || 0) !== 1) {
      fail('client state forged authoritative health or progression', JSON.stringify(current));
    }
    if (currentInventory.some(row => row.id === 'rocketAmmo' && Number(row.qty || 0) > 0)) {
      fail('client state forged server inventory', JSON.stringify(currentInventory));
    }
    if (Math.hypot(Number(current.x || 0) - Number(initial.x || 0), Number(current.z || 0) - Number(initial.z || 0)) > 20) {
      fail('client state bypassed server movement limits', JSON.stringify({ initial, current }));
    }

    const remoteLocation = await socketAck(first.socket, 'changeLocation', {
      locationId: 'oldDepot',
      roomId: 'oldDepot#forged',
      encounterId: 'raider_ambush'
    });
    if (remoteLocation.ok) fail('remote location entry without a server ticket was accepted', JSON.stringify(remoteLocation));

    const remoteFaction = await socketAck(first.socket, 'worldFactionJoin', { factionId: 'scrap_union' });
    if (remoteFaction.ok) fail('remote faction join outside its territory was accepted', JSON.stringify(remoteFaction));

    const missingTask = await socketAck(first.socket, 'worldTaskAction', { action: 'claim', taskId: 'forged_task' });
    if (missingTask.ok) fail('forged world-task reward claim was accepted', JSON.stringify(missingTask));

    const legacyPartyJoin = await socketAck(first.socket, 'worldTaskJoinParty', {
      taskId: 'forged_task',
      partyId: 'klim_road_patrol',
      characterId: first.characterId,
      factionId: 'old_klim'
    });
    if (legacyPartyJoin.ok) fail('legacy world-party join bypass was accepted', JSON.stringify(legacyPartyJoin));
    const legacyPartyLeave = await socketAck(first.socket, 'worldTaskLeaveParty', {
      partyId: 'klim_road_patrol',
      characterId: first.characterId
    });
    if (legacyPartyLeave.ok) fail('legacy world-party leave bypass was accepted', JSON.stringify(legacyPartyLeave));
    const partyStateResponse = await request('/api/wasteland');
    const partyState = parseJsonResponse(partyStateResponse, 'GET /api/wasteland after legacy party events');
    const forgedMember = (Array.isArray(partyState.sim?.parties) ? partyState.sim.parties : [])
      .flatMap(party => Array.isArray(party?.playerMembers) ? party.playerMembers : [])
      .some(member => String(member?.characterId || member?.id || '') === first.characterId);
    if (forgedMember) fail('rejected legacy world-party events left a phantom member in simulation state');

    const joinOldKlim = await socketAck(first.socket, 'worldFactionJoin', { factionId: 'old_klim' });
    if (!joinOldKlim.ok || joinOldKlim.self?.worldFactionId !== 'old_klim') {
      fail('smoke player could not join the local faction before the party test', JSON.stringify(joinOldKlim));
    }
    const partyAccept = await socketAck(first.socket, 'worldTaskAction', {
      action: 'accept',
      taskId: 'smoke_world_party_task'
    });
    if (!partyAccept.ok
      || partyAccept.self?.globalMap?.attachedPartyId !== 'smoke_world_party'
      || partyAccept.self?.globalMap?.attachedPartyTaskId !== 'smoke_world_party_task'
      || partyAccept.self?.onGlobalMap !== true
      || partyAccept.self?.roomId) {
      fail('world-party accept did not atomically attach server player state', JSON.stringify(partyAccept));
    }
    const attachedTravel = await socketAck(first.socket, 'globalTravelStart', {
      worldPoint: { x: 300, y: 600 },
      targetLocationId: 'wasteland'
    });
    if (attachedTravel.ok) {
      fail('attached world-party player started an independent route', JSON.stringify(attachedTravel));
    }

    first.socket.close();
    await delay(250);
    const reconnected = await connectSocketClient();
    sockets.push(reconnected);
    first.socket = reconnected;
    const rejoin = await joinSocketCharacter(reconnected, first);
    const firstFriends = rejoin.self?.socialState?.friends || [];
    if (!rejoin.ok || !firstFriends.some(row => row.id === second.characterId)) {
      fail('friend state did not survive reconnect', JSON.stringify(rejoin));
    }
    if (Number(rejoin.self?.worldFactionReputation?.old_klim || 0) !== 3) {
      fail('world-task reputation did not survive reconnect', JSON.stringify(rejoin.self));
    }
    if (rejoin.roomId
      || rejoin.self?.globalMap?.attachedPartyId !== 'smoke_world_party'
      || rejoin.self?.globalMap?.attachedPartyTaskId !== 'smoke_world_party_task'
      || rejoin.self?.onGlobalMap !== true) {
      fail('world-party attachment did not survive reconnect authoritatively', JSON.stringify(rejoin));
    }
    const legacyArrivalBypass = await socketAck(first.socket, 'globalTravelArrive', {});
    if (legacyArrivalBypass.ok) {
      fail('reconnected world-party attachment inherited an independent arrival route', JSON.stringify(legacyArrivalBypass));
    }
    const partyCancel = await socketAck(first.socket, 'worldTaskAction', {
      action: 'cancel',
      taskId: 'smoke_world_party_task'
    });
    if (!partyCancel.ok
      || partyCancel.self?.globalMap?.attachedPartyId
      || partyCancel.self?.globalMap?.attachedPartyTaskId
      || partyCancel.self?.worldTaskAccepted?.includes('smoke_world_party_task')) {
      fail('world-party cancel did not atomically detach authoritative state', JSON.stringify(partyCancel));
    }

    await assertCharacterDeletionLifecycle(accounts[2]);
  } finally {
    sockets.forEach(socket => {
      try { socket.close(); } catch (_) {}
    });
  }
}

function spawnSmokeServer(logs = []) {
  const proc = childProcess.spawn(process.execPath, [SERVER_FILE], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      NODE_ENV: 'test',
      DEV_API_MODE: 'local',
      DEV_ADMIN_TOKEN: '',
      ROOM_CAPACITY: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', chunk => logs.push(String(chunk)));
  proc.stderr.on('data', chunk => logs.push(String(chunk)));
  return proc;
}

async function stopSmokeServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve();
    }, 1500);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { proc.kill('SIGTERM'); } catch (_) {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function main() {
  assertRequiredFiles();
  assertDependenciesInstalled();
  assertWorldTaskArchiveReload();
  seedLegacyDuplicateCharacters();
  seedSmokeReputationTask();
  seedSmokeWorldPartyTask();

  const logs = [];
  let proc = spawnSmokeServer(logs);
  serverProc = proc;

  let health;
  try {
    health = await waitForHealth(proc, logs);
    const legacyRemappedId = assertLegacyDuplicateMigration();
    assertPendingMigrationJournalRecovery();
    if (!logs.join('').includes('Remapped 1 duplicate legacy character id(s).')) {
      fail('server startup did not report its legacy character-id migration', logs.join(''));
    }
    await assertStaticAssets(health);
    await assertRestCorsPreflight();
    await assertEditorAndWorldDataApis();
    await assertAuthApiLifecycle();
    await assertSocketMultiplayerLifecycle();
    assertLegacyDuplicateMigration(legacyRemappedId);
    await stopSmokeServer(proc);
    serverProc = null;
    const restartLogs = [];
    proc = spawnSmokeServer(restartLogs);
    serverProc = proc;
    await waitForHealth(proc, restartLogs);
    assertLegacyDuplicateMigration(legacyRemappedId);
    assertPendingMigrationJournalRecovery();
    if (restartLogs.join('').includes('duplicate legacy character id(s)')) {
      fail('server remapped an already migrated character again after restart', restartLogs.join(''));
    }
    console.log(`Smoke check passed: ${health.name || 'Realm of Ashes'} v${health.version} served assets/world APIs and kept three players in one unlimited settlement reality`);
  } finally {
    cleanup();
    setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 1000).unref();
  }
}

main().catch(err => fail(err && err.message ? err.message : String(err)));
