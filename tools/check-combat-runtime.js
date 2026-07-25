#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { io: createSocketClient } = require('socket.io-client');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.join(PROJECT_ROOT, 'server.js');
const MAX_WAIT_MS = Math.max(3000, Number(process.env.COMBAT_RUNTIME_WAIT_MS || 10000));
const PORT = Number(process.env.COMBAT_RUNTIME_PORT || (37000 + Math.floor(Math.random() * 1500)));
const TMP_ROOT = path.resolve(process.env.COMBAT_RUNTIME_TMPDIR || os.tmpdir());
const TMP_PREFIX = 'realm-of-ashes-combat-runtime-';

fs.mkdirSync(TMP_ROOT, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(TMP_ROOT, TMP_PREFIX));

let activeServer = null;
let activeServerLogs = [];
let cleanedUp = false;
let attackSequence = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupSync() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (activeServer && activeServer.exitCode === null) {
    try { activeServer.kill('SIGTERM'); } catch (_) {}
  }
  const resolvedDataDir = path.resolve(DATA_DIR);
  const withinTempRoot = resolvedDataDir.startsWith(`${TMP_ROOT}${path.sep}`);
  if (withinTempRoot && path.basename(resolvedDataDir).startsWith(TMP_PREFIX)) {
    try { fs.rmSync(resolvedDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

process.once('exit', cleanupSync);
process.once('SIGINT', () => {
  cleanupSync();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanupSync();
  process.exit(143);
});

function inspect(value) {
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

function invariant(condition, message, details = null) {
  if (condition) return;
  const suffix = details === null ? '' : `\n${inspect(details)}`;
  throw new Error(`${message}${suffix}`);
}

function assertDependenciesInstalled() {
  for (const dependency of ['express', 'socket.io', 'socket.io-client']) {
    try {
      require.resolve(`${dependency}/package.json`, { paths: [PROJECT_ROOT] });
    } catch (_) {
      throw new Error(`Missing dependency ${dependency}. Run npm ci first.`);
    }
  }
  invariant(fs.existsSync(SERVER_FILE), 'server.js is missing');
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.json === undefined ? String(options.body || '') : JSON.stringify(options.json);
    const headers = { ...(options.headers || {}) };
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: pathname,
      method: options.method || 'GET',
      headers,
      timeout: Number(options.timeoutMs || 2500)
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: responseBody
      }));
    });
    req.once('timeout', () => req.destroy(new Error(`HTTP timeout: ${pathname}`)));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseJsonResponse(response, label) {
  try {
    return JSON.parse(response.body);
  } catch (_) {
    throw new Error(`${label} did not return JSON\n${response.body.slice(0, 600)}`);
  }
}

async function waitForHealth(proc) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited before /health was ready\n${activeServerLogs.join('').slice(-4000)}`);
    }
    try {
      const response = await request('/health', { timeoutMs: 800 });
      if (response.statusCode === 200) {
        const health = parseJsonResponse(response, '/health');
        if (health.ok) return health;
      }
    } catch (_) {
      // Startup is still in progress.
    }
    await delay(150);
  }
  throw new Error(`/health did not become ready within ${MAX_WAIT_MS}ms\n${activeServerLogs.join('').slice(-4000)}`);
}

async function startServer() {
  invariant(!activeServer, 'Test attempted to start two server processes');
  activeServerLogs = [];
  const proc = childProcess.spawn(process.execPath, [SERVER_FILE], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR,
      SESSION_LOCK_MS: '500',
      WASTELAND_SIM_SAVE_INTERVAL_MS: '3000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  activeServer = proc;
  proc.stdout.on('data', chunk => activeServerLogs.push(String(chunk)));
  proc.stderr.on('data', chunk => activeServerLogs.push(String(chunk)));
  return waitForHealth(proc);
}

async function stopServer() {
  const proc = activeServer;
  if (!proc) return;
  activeServer = null;
  if (proc.exitCode !== null) return;
  try { proc.kill('SIGTERM'); } catch (_) {}
  const exited = await Promise.race([
    new Promise(resolve => proc.once('exit', () => resolve(true))),
    delay(2000).then(() => false)
  ]);
  if (!exited && proc.exitCode === null) {
    try { proc.kill('SIGKILL'); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      delay(1000)
    ]);
  }
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
    }, 3500);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', error => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function socketAck(socket, event, payload = {}, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), timeoutMs);
    socket.emit(event, payload, result => {
      clearTimeout(timer);
      resolve(result || {});
    });
  });
}

function authHeaders(account, leaseId = '') {
  const headers = {
    Authorization: `Bearer ${account.token}`,
    'X-Device-Id': account.deviceId,
    'X-Client-Instance-Id': account.clientInstanceId,
    'X-Device-Type': 'desktop',
    'X-Control-Type': 'keyboard_mouse'
  };
  if (leaseId) headers['X-Character-Lease-Id'] = leaseId;
  return headers;
}

async function registerAccount(role, suffix) {
  const login = `combat_${role}_${suffix}`.slice(0, 32);
  const account = {
    role,
    login,
    password: `combat-pass-${role}-${suffix}`,
    deviceId: `combat_device_${role}_${suffix}`,
    clientInstanceId: `combat_client_${role}_${suffix}`,
    characterId: `c_combat_${role}_${suffix}`,
    name: `Combat ${role}`
  };
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: {
      login: account.login,
      email: `${account.login}@example.test`,
      password: account.password,
      deviceId: account.deviceId,
      deviceType: 'desktop',
      controlType: 'keyboard_mouse'
    }
  });
  invariant(response.statusCode === 200, `Register failed for ${role}`, response);
  const body = parseJsonResponse(response, `register ${role}`);
  invariant(body.ok && body.token, `Register returned no token for ${role}`, body);
  account.token = body.token;
  return account;
}

function joinPayload(account) {
  return {
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
  };
}

async function connectAndJoin(account) {
  const socket = await connectSocketClient();
  const join = await socketAck(socket, 'join', joinPayload(account));
  if (!join.ok) socket.close();
  invariant(join.ok && join.self && join.characterLeaseId, `Join failed for ${account.role}`, join);
  account.socket = socket;
  account.join = join;
  account.equipmentRevision = Math.max(0, Math.floor(Number(join.self?.equipmentRevision || 0)));
  return { socket, join };
}

function closeSocket(account) {
  if (!account?.socket) return;
  try { account.socket.close(); } catch (_) {}
  account.socket = null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function computedMaxHp(level, endurance) {
  return 55 + endurance * 9 + Math.max(0, level - 1) * 12;
}

function seedCharacterState(account, options, usersDb, savesDb) {
  const user = usersDb.users?.[account.login];
  invariant(user?.id, `Temporary user is missing for ${account.role}`, usersDb.users);
  const row = savesDb.characters?.[user.id]?.[account.characterId];
  invariant(row?.state, `Temporary character is missing for ${account.role}`, savesDb.characters?.[user.id]);

  const state = row.state;
  const level = Math.max(1, Math.floor(Number(options.level || 1)));
  const special = cloneJson(options.special);
  const maxHp = computedMaxHp(level, Number(special.end || 5));
  const maxAp = Math.max(5, 5 + Math.floor(Number(special.agi || 5) / 2));
  // oldDepot's authored spawn is tile (19, 25), or world (1, 13).
  // Starting from that known-walkable point keeps the PvP fixture independent
  // of wall/collider changes elsewhere in the location.
  const spawnX = 1;
  const spawnZ = 13;

  state.characterProfile.special = special;
  state.currentLocationId = 'oldDepot';
  state.lastVisitedSettlementId = 'settlement';
  state.serverLocationContext = { locationId: 'oldDepot' };
  state.player = {
    ...(state.player || {}),
    x: spawnX,
    z: spawnZ,
    angle: 0,
    hp: maxHp,
    maxHp,
    ap: Number.isFinite(Number(options.initialAp))
      ? Math.max(0, Math.min(maxAp, Number(options.initialAp)))
      : maxAp,
    maxAp,
    level,
    xp: 0,
    xpNeeded: 100,
    injuries: {},
    itemConditions: { ...(state.player?.itemConditions || {}) }
  };

  if (options.weapon) {
    const weaponRuntimeId = String(options.weaponRuntimeId || options.weapon);
    account.weaponRuntimeId = weaponRuntimeId;
    account.weaponRuntimeIds = [weaponRuntimeId];
    state.inventory = {
      ...(state.inventory || {}),
      knife: Math.max(1, Number(state.inventory?.knife || 0)),
      [weaponRuntimeId]: 1,
      [options.ammoType]: Math.max(0, Math.floor(Number(options.reserveAmmo || 0)))
    };
    state.equipment = {
      ...(state.equipment || {}),
      weapon: weaponRuntimeId
    };
    state.itemRuntime = {
      ...(state.itemRuntime || {}),
      [weaponRuntimeId]: {
        baseId: options.weapon,
        condition: 100,
        loaded: Math.max(0, Math.floor(Number(options.loaded || 0))),
        createdAt: Date.now()
      }
    };
    state.player.itemConditions[options.weapon] = 100;

    for (const extra of Array.isArray(options.additionalWeapons) ? options.additionalWeapons : []) {
      const extraBaseId = String(extra?.baseId || options.weapon);
      const extraRuntimeId = String(extra?.runtimeId || extraBaseId);
      if (!extraRuntimeId || account.weaponRuntimeIds.includes(extraRuntimeId)) continue;
      account.weaponRuntimeIds.push(extraRuntimeId);
      state.inventory[extraRuntimeId] = 1;
      state.itemRuntime[extraRuntimeId] = {
        baseId: extraBaseId,
        condition: 100,
        loaded: Math.max(0, Math.floor(Number(extra.loaded || 0))),
        createdAt: Date.now()
      };
      state.player.itemConditions[extraBaseId] = 100;
    }
  }

  row.summary = {
    ...(row.summary || {}),
    level,
    xp: 0,
    locationId: 'oldDepot'
  };
  account.seedState = cloneJson(state);
}

function seedCombatFixtures(accounts) {
  const usersFile = path.join(DATA_DIR, 'users.json');
  const savesFile = path.join(DATA_DIR, 'saves.json');
  const usersDb = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  const savesDb = JSON.parse(fs.readFileSync(savesFile, 'utf8'));

  seedCharacterState(accounts.target, {
    level: 50,
    special: { str: 5, per: 5, end: 10, cha: 5, int: 5, agi: 5, luck: 5 }
  }, usersDb, savesDb);
  seedCharacterState(accounts.persistence, {
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 10, luck: 5 },
    weapon: 'pistol',
    weaponRuntimeId: 'ui_pistol_combatrt_1',
    additionalWeapons: [{
      baseId: 'pistol',
      runtimeId: 'ui_pistol_combatrt_2',
      loaded: 4
    }],
    ammoType: 'ammo9',
    loaded: 0,
    reserveAmmo: 16
  }, usersDb, savesDb);
  seedCharacterState(accounts.cadence, {
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 10, luck: 5 },
    weapon: 'pistol',
    ammoType: 'ammo9',
    loaded: 8,
    reserveAmmo: 8
  }, usersDb, savesDb);
  seedCharacterState(accounts.untargeted, {
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 10, luck: 5 },
    weapon: 'pistol',
    ammoType: 'ammo9',
    loaded: 3,
    reserveAmmo: 5
  }, usersDb, savesDb);
  seedCharacterState(accounts.strictAp, {
    special: { str: 8, per: 8, end: 8, cha: 5, int: 4, agi: 2, luck: 5 },
    weapon: 'pistol',
    ammoType: 'ammo9',
    loaded: 0,
    reserveAmmo: 8
  }, usersDb, savesDb);
  seedCharacterState(accounts.equipmentAp, {
    special: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 10, luck: 5 },
    weapon: 'pistol',
    weaponRuntimeId: 'ui_pistol_equipment_1',
    ammoType: 'ammo9',
    loaded: 1,
    reserveAmmo: 0,
    initialAp: 0
  }, usersDb, savesDb);

  fs.writeFileSync(savesFile, JSON.stringify(savesDb, null, 2));
}

function inventoryRowsToSavedObject(rows, equipment = {}) {
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || '');
    const qty = Math.max(0, Math.floor(Number(row?.qty || 0)));
    if (id && qty > 0) out[id] = (out[id] || 0) + qty;
  }
  for (const itemId of Object.values(equipment || {})) {
    const id = String(itemId || '');
    if (id && id !== 'fists') out[id] = Math.max(1, Number(out[id] || 0) + 1);
  }
  return out;
}

function saveStateAfterCombat(account, self, combat, position) {
  const state = cloneJson(account.seedState);
  const equipment = cloneJson(
    self?.equipment || { weapon: 'pistol', armor: '', helmet: '', boots: '', backpack: '' }
  );
  if (account.weaponRuntimeId) equipment.weapon = account.weaponRuntimeId;
  const weaponRuntimeId = String(account.weaponRuntimeId || 'pistol');
  state.currentLocationId = 'oldDepot';
  state.serverLocationContext = { locationId: 'oldDepot' };
  state.equipment = cloneJson(equipment);
  state.inventory = inventoryRowsToSavedObject(self?.inventory || [], equipment);
  state.player = {
    ...(state.player || {}),
    x: Number(position.x || 0),
    z: Number(position.z || 0),
    hp: Number(self?.hp || state.player?.hp || 1),
    maxHp: Number(self?.maxHp || state.player?.maxHp || 1),
    ap: Number(combat.ap),
    maxAp: Number(combat.maxAp),
    level: Number(self?.level || state.player?.level || 1),
    injuries: cloneJson(self?.injuries || {}),
    itemConditions: cloneJson(self?.itemConditions || state.player?.itemConditions || {})
  };
  state.skillRanks = cloneJson(self?.skillRanks || {});
  state.talentRanks = cloneJson(self?.talentRanks || {});
  state.itemRuntime = {
    ...(state.itemRuntime || {}),
    [weaponRuntimeId]: {
      ...(state.itemRuntime?.[weaponRuntimeId] || {}),
      baseId: 'pistol',
      condition: Number.isFinite(Number(combat.condition)) ? Number(combat.condition) : 100,
      loaded: Math.max(0, Math.floor(Number(combat.loaded || 0))),
      createdAt: Number(state.itemRuntime?.[weaponRuntimeId]?.createdAt || Date.now())
    }
  };
  state.savedAt = Date.now();
  return state;
}

async function saveCharacter(account, leaseId, state) {
  const response = await request(`/api/characters/${encodeURIComponent(account.characterId)}/save`, {
    method: 'POST',
    headers: authHeaders(account, leaseId),
    json: { state }
  });
  invariant(response.statusCode === 200, 'Authoritative character save failed', response);
  const result = parseJsonResponse(response, 'character save');
  invariant(result.ok, 'Authoritative character save returned ok=false', result);
}

function combatSnapshot(value, label) {
  invariant(value && typeof value === 'object', `${label} is missing authoritative combat state`, value);
  for (const key of ['weapon', 'loaded', 'magSize', 'reserveAmmo', 'ap', 'maxAp']) {
    invariant(Object.prototype.hasOwnProperty.call(value, key), `${label}.${key} is missing`, value);
  }
  return value;
}

function assertCombat(value, expected, label) {
  const combat = combatSnapshot(value, label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    invariant(Number.isFinite(expectedValue)
      ? Number(combat[key]) === expectedValue
      : combat[key] === expectedValue,
    `${label}.${key}: expected ${expectedValue}, got ${combat[key]}`, combat);
  }
  return combat;
}

function assertRuntimeWeaponInventory(self, runtimeId, expectedLoaded, label) {
  const rows = Array.isArray(self?.weaponInventoryRuntime)
    ? self.weaponInventoryRuntime
    : [];
  const row = rows.find(entry => entry?.id === runtimeId);
  invariant(row && Number(row.qty || 0) === 1,
    `${label}: runtime weapon ${runtimeId} is missing`, rows);
  invariant(Number(row.loaded) === expectedLoaded,
    `${label}: expected ${runtimeId} loaded=${expectedLoaded}, got ${row.loaded}`, row);
  return row;
}

function runtimeEquipmentSnapshot(weaponId) {
  return {
    weapon: String(weaponId || 'fists'),
    armor: '',
    helmet: '',
    boots: '',
    backpack: ''
  };
}

function attackPayload(attackerJoin, targetSocket, mode = 'single', weaponRuntimeId = '') {
  const token = `combat_runtime_${Date.now().toString(36)}_${++attackSequence}`;
  const payload = {
    targetId: targetSocket.id,
    weapon: 'pistol',
    mode,
    attackToken: token,
    combat: {
      token,
      weapon: 'pistol',
      mode,
      shots: 1
    },
    x: Number(attackerJoin.x || 0),
    z: Number(attackerJoin.z || 0),
    angle: 0,
    skillRanks: {},
    talentRanks: {}
  };
  if (weaponRuntimeId) payload.equipment = runtimeEquipmentSnapshot(weaponRuntimeId);
  return payload;
}

function assertSameCombatRoom(attacker, target, label) {
  invariant(attacker.join.roomId === 'oldDepot' && target.join.roomId === 'oldDepot',
    `${label}: fixtures did not join oldDepot`, {
      attacker: attacker.join.roomId,
      target: target.join.roomId
    });
  const distance = Math.hypot(
    Number(attacker.join.x || 0) - Number(target.join.x || 0),
    Number(attacker.join.z || 0) - Number(target.join.z || 0)
  );
  invariant(distance <= 12.85, `${label}: players spawned outside pistol range`, {
    distance,
    attacker: { x: attacker.join.x, z: attacker.join.z },
    target: { x: target.join.x, z: target.join.z }
  });
}

async function sendEquipmentProfileState(account, weaponId) {
  account.socket.emit('state', {
    profileOnly: true,
    deviceType: 'desktop',
    controlType: 'keyboard_mouse',
    equipment: runtimeEquipmentSnapshot(weaponId),
    skillRanks: {},
    talentRanks: {}
  });
  await delay(100);
}

async function sendEquipmentAction(account, itemRuntimeId, options = {}) {
  const payload = options.payload || {
    requestId: options.requestId || `equipment_runtime_${Date.now().toString(36)}_${++attackSequence}`,
    expectedRevision: Number.isFinite(Number(options.expectedRevision))
      ? Math.max(0, Math.floor(Number(options.expectedRevision)))
      : Math.max(0, Math.floor(Number(account.equipmentRevision || 0))),
    slot: options.slot || 'weapon',
    itemRuntimeId: String(itemRuntimeId || '')
  };
  const ack = await socketAck(account.socket, 'equipmentAction', payload);
  if (Number.isFinite(Number(ack.equipmentRevision))) {
    account.equipmentRevision = Math.max(0, Math.floor(Number(ack.equipmentRevision)));
  }
  return { payload, ack };
}

function readSavedCharacterState(account) {
  const usersDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
  const savesDb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'saves.json'), 'utf8'));
  const user = usersDb.users?.[account.login];
  const state = user?.id
    ? savesDb.characters?.[user.id]?.[account.characterId]?.state
    : null;
  invariant(state && typeof state === 'object', `Persisted state is missing for ${account.role}`);
  return state;
}

async function bootstrapCharacters(accounts) {
  await startServer();
  const suffix = crypto.randomBytes(4).toString('hex');
  for (const [key, role] of [
    ['persistence', 'persist'],
    ['cadence', 'cadence'],
    ['untargeted', 'air'],
    ['strictAp', 'strict'],
    ['equipmentAp', 'equipment'],
    ['target', 'target']
  ]) {
    accounts[key] = await registerAccount(role, suffix);
    await connectAndJoin(accounts[key]);
    closeSocket(accounts[key]);
    await delay(100);
  }
  await delay(250);
  await stopServer();
  seedCombatFixtures(accounts);
}

async function exerciseMagazineBeforeReconnect(accounts) {
  const [pistolA, pistolB] = accounts.persistence.weaponRuntimeIds;
  await startServer();
  await connectAndJoin(accounts.target);
  await connectAndJoin(accounts.persistence);
  assertSameCombatRoom(accounts.persistence, accounts.target, 'magazine setup');
  assertCombat(accounts.persistence.join.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolA,
    loaded: 0,
    magSize: 8,
    reserveAmmo: 16
  }, 'runtime-id join combat');
  assertRuntimeWeaponInventory(
    accounts.persistence.join.self,
    pistolB,
    4,
    'join carried runtime inventory'
  );

  // The shipping client sends the concrete runtime id. A legacy base-id packet
  // must also preserve a runtime instance the server already knows.
  await sendEquipmentProfileState(accounts.persistence, pistolA);

  const reload = await socketAck(accounts.persistence.socket, 'reloadWeapon', {
    weapon: 'pistol',
    take: 8,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(reload.ok, 'Initial reload was rejected', reload);
  assertCombat(reload.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolA,
    loaded: 8,
    magSize: 8,
    reserveAmmo: 8
  }, 'initial reload combat');
  assertRuntimeWeaponInventory(
    reload.self,
    pistolB,
    4,
    'post-reload carried runtime inventory'
  );

  await sendEquipmentProfileState(accounts.persistence, 'pistol');
  const pistolAShotPayload = attackPayload(
    accounts.persistence.join,
    accounts.target.socket,
    'single',
    pistolA
  );
  const shot = await socketAck(accounts.persistence.socket, 'playerHit', pistolAShotPayload);
  invariant(shot.ok, 'Persistence shot was rejected', shot);
  assertCombat(shot.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolA,
    loaded: 7,
    magSize: 8,
    reserveAmmo: 8
  }, 'post-shot combat');

  const staleSaveState = saveStateAfterCombat(
    accounts.persistence,
    reload.self,
    shot.combat,
    { x: accounts.persistence.join.x, z: accounts.persistence.join.z }
  );

  // Same-base runtime switches are explicit, AP-backed equipment actions.
  // The following combat request may only consume B after that action succeeds.
  await delay(500);
  const switchToB = await sendEquipmentAction(accounts.persistence, pistolB);
  invariant(switchToB.ack.ok && switchToB.ack.changed && Number(switchToB.ack.apCost) === 1,
    'Authoritative same-base A -> B equipment action failed', switchToB.ack);
  invariant(switchToB.ack.self?.equipmentRuntime?.weapon === pistolB
    && Number(switchToB.ack.equipmentRevision) === 1,
  'A -> B equipment action did not publish runtime identity/revision', switchToB.ack);
  assertRuntimeWeaponInventory(
    switchToB.ack.self,
    pistolA,
    7,
    'post-switch carried A runtime inventory'
  );
  const switchedShot = await socketAck(
    accounts.persistence.socket,
    'playerHit',
    attackPayload(accounts.persistence.join, accounts.target.socket, 'single', pistolB)
  );
  invariant(switchedShot.ok, 'Shot after authoritative same-base runtime switch was rejected', switchedShot);
  assertCombat(switchedShot.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 3,
    magSize: 8,
    reserveAmmo: 8
  }, 'same-base switched shot combat');

  const duplicateJoin = await socketAck(
    accounts.persistence.socket,
    'join',
    joinPayload(accounts.persistence)
  );
  invariant(duplicateJoin.ok === false,
    'Server accepted a duplicate join on an already joined socket', duplicateJoin);
  const duplicateJoinCombat = assertCombat(duplicateJoin.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 3,
    magSize: 8,
    reserveAmmo: 8,
    ap: Number(switchedShot.combat.ap)
  }, 'duplicate-join rejection combat');
  invariant(Number(duplicateJoinCombat.cooldownRemainingMs) > 0
    && Number(duplicateJoinCombat.cooldownRemainingMs) <= Number(switchedShot.combat.cooldownRemainingMs),
  'Duplicate join reset or extended the active weapon cooldown', {
    shot: switchedShot.combat,
    duplicateJoin: duplicateJoinCombat
  });

  const loadedRuntimeDrop = await socketAck(accounts.persistence.socket, 'dropItem', {
    itemId: 'pistol',
    itemRuntimeId: pistolB,
    qty: 1
  });
  invariant(loadedRuntimeDrop.ok === false,
    'Server allowed a loaded runtime weapon instance to be dropped', loadedRuntimeDrop);
  const postDropCombat = assertCombat(loadedRuntimeDrop.self?.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 3,
    reserveAmmo: 8,
    ap: Number(duplicateJoinCombat.ap)
  }, 'loaded-runtime drop rejection combat');
  invariant(Number(postDropCombat.cooldownRemainingMs) > 0,
    'Rejected loaded-runtime drop reset the active cooldown', postDropCombat);

  const postDuplicateCooldown = await socketAck(
    accounts.persistence.socket,
    'playerHit',
    attackPayload(accounts.persistence.join, accounts.target.socket, 'single', pistolB)
  );
  invariant(postDuplicateCooldown.ok === false,
    'Duplicate join cleared the authoritative weapon cooldown', postDuplicateCooldown);
  const postDuplicateCombat = assertCombat(postDuplicateCooldown.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 3,
    reserveAmmo: 8
  }, 'post-duplicate-join cooldown rejection combat');
  invariant(Number(postDuplicateCombat.cooldownRemainingMs) > 0,
    'Duplicate join cleared the authoritative weapon cooldown', postDuplicateCooldown);
  invariant(Number(postDuplicateCombat.ap) >= Number(duplicateJoinCombat.ap),
    'Post-duplicate-join cooldown rejection spent AP', {
      duplicateJoin: duplicateJoinCombat,
      cooldown: postDuplicateCombat
    });

  const crossRuntimeReplay = await socketAck(accounts.persistence.socket, 'combatAttack', {
    weapon: 'pistol',
    mode: 'single',
    attackToken: pistolAShotPayload.attackToken,
    combat: {
      token: pistolAShotPayload.attackToken,
      weapon: 'pistol',
      mode: 'single',
      shots: 1
    },
    equipment: runtimeEquipmentSnapshot(pistolB),
    x: Number(accounts.persistence.join.x || 0),
    z: Number(accounts.persistence.join.z || 0),
    angle: 0,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(crossRuntimeReplay.ok === false,
    'Server reused an A attack token after switching to runtime B', crossRuntimeReplay);
  const crossRuntimeCombat = assertCombat(crossRuntimeReplay.combat, {
    weaponRuntimeId: pistolB,
    loaded: 3,
    reserveAmmo: 8
  }, 'cross-runtime replay rejection combat');
  invariant(Number(crossRuntimeCombat.ap) >= Number(switchedShot.combat.ap),
    'Cross-runtime replay spent AP from B', {
      switched: switchedShot.combat,
      replay: crossRuntimeCombat
    });

  // This payload was captured while A was active. It must save inventory
  // presentation without rolling the live authoritative identity back from B.
  await saveCharacter(accounts.persistence, accounts.persistence.join.characterLeaseId, staleSaveState);
  const afterStaleSave = readSavedCharacterState(accounts.persistence);
  invariant(afterStaleSave.equipment?.weapon === pistolB,
    'Stale HTTP save rolled live equipment back before disconnect', afterStaleSave.equipment);
  invariant(Number(afterStaleSave.inventory?.[pistolA]) === 1
    && Number(afterStaleSave.inventory?.[pistolB]) === 1,
    'Stale HTTP save did not retain both carried runtime weapon identities',
    afterStaleSave.inventory);

  const liveTopUp = await socketAck(accounts.persistence.socket, 'reloadWeapon', {
    weapon: 'pistol',
    take: 1,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(liveTopUp.ok && Number(liveTopUp.take) === 1,
    'Live B top-up failed after stale A autosave', liveTopUp);
  assertCombat(liveTopUp.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 4,
    magSize: 8,
    reserveAmmo: 7
  }, 'post-stale-save live combat');

  closeSocket(accounts.persistence);
  closeSocket(accounts.target);
  await delay(300);
  await stopServer();

  const persisted = readSavedCharacterState(accounts.persistence);
  invariant(persisted.equipment?.weapon === pistolB,
    'Stale save rolled the equipped runtime identity back from B', {
      expected: pistolB,
      actual: persisted.equipment?.weapon
    });
  invariant(Number(persisted.inventory?.[pistolA]) === 1
    && Number(persisted.inventory?.[pistolB]) === 1,
    'Save did not retain both carried runtime weapon identities',
    persisted.inventory);
  invariant(Number(persisted.itemRuntime?.[pistolA]?.loaded) === 7,
    'Save did not persist A magazine independently',
    persisted.itemRuntime);
  invariant(Number(persisted.itemRuntime?.[pistolB]?.loaded) === 4,
    'Save did not persist B magazine independently',
    persisted.itemRuntime);
  invariant(7 + 4 + Number(persisted.inventory?.ammo9 || 0) === 18,
    'Persisted A + B + reserve ammunition was not conserved after two shots',
    persisted.inventory);
}

async function assertMagazineAfterReconnect(accounts) {
  const [pistolA, pistolB] = accounts.persistence.weaponRuntimeIds;
  await startServer();
  await connectAndJoin(accounts.target);
  await connectAndJoin(accounts.persistence);
  assertSameCombatRoom(accounts.persistence, accounts.target, 'magazine reconnect');

  const joinedCombat = assertCombat(accounts.persistence.join.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 4,
    magSize: 8,
    reserveAmmo: 7
  }, 'join combat');
  invariant(7 + Number(joinedCombat.loaded) + Number(joinedCombat.reserveAmmo) === 18,
    'Reconnect changed A + B + reserve ammunition', joinedCombat);

  // A reconnect restores the exact persisted AP balance. Wait for enough
  // authoritative regeneration to cover both the 1 AP switch and 3 AP reload,
  // even when the previous phase disconnected at zero AP.
  await delay(2600);
  const switchToA = await sendEquipmentAction(accounts.persistence, pistolA);
  invariant(switchToA.ack.ok && switchToA.ack.changed && Number(switchToA.ack.apCost) === 1,
    'Explicit B -> A switch failed after reconnect', switchToA.ack);
  const topUpA = await socketAck(accounts.persistence.socket, 'reloadWeapon', {
    weapon: 'pistol',
    equipment: runtimeEquipmentSnapshot(pistolA),
    take: 1,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(topUpA.ok && Number(topUpA.take) === 1,
    'A top-up failed after reconnect', topUpA);
  const toppedACombat = assertCombat(topUpA.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolA,
    loaded: 8,
    magSize: 8,
    reserveAmmo: 6
  }, 'post-reconnect A reload combat');

  await delay(2600);
  const switchToB = await sendEquipmentAction(accounts.persistence, pistolB);
  invariant(switchToB.ack.ok && switchToB.ack.changed && Number(switchToB.ack.apCost) === 1,
    'Explicit A -> B switch failed after reconnect', switchToB.ack);
  const topUpB = await socketAck(accounts.persistence.socket, 'reloadWeapon', {
    weapon: 'pistol',
    equipment: runtimeEquipmentSnapshot(pistolB),
    take: 1,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(topUpB.ok && Number(topUpB.take) === 1,
    'B top-up failed after reconnect', topUpB);
  const toppedBCombat = assertCombat(topUpB.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolB,
    loaded: 5,
    magSize: 8,
    reserveAmmo: 5
  }, 'post-reconnect B reload combat');
  invariant(Number(toppedACombat.loaded) + Number(toppedBCombat.loaded) + Number(toppedBCombat.reserveAmmo) === 18,
    'A/B reloads violated total ammunition conservation', {
      pistolA: toppedACombat,
      pistolB: toppedBCombat
    });
}

async function assertUntargetedAttack(accounts) {
  const account = accounts.untargeted;
  await connectAndJoin(account);
  assertSameCombatRoom(account, accounts.target, 'untargeted attack');
  assertCombat(account.join.combat, {
    weapon: 'pistol',
    weaponRuntimeId: 'pistol',
    loaded: 3,
    magSize: 8,
    reserveAmmo: 5
  }, 'untargeted join combat');

  const token = `combat_runtime_air_${Date.now().toString(36)}_${++attackSequence}`;
  const payload = {
    weapon: 'pistol',
    mode: 'single',
    attackToken: token,
    combat: {
      token,
      weapon: 'pistol',
      mode: 'single',
      shots: 1
    },
    equipment: runtimeEquipmentSnapshot('pistol'),
    x: Number(account.join.x || 0),
    z: Number(account.join.z || 0),
    angle: 0,
    skillRanks: {},
    talentRanks: {}
  };

  const airShot = await socketAck(account.socket, 'combatAttack', payload);
  invariant(airShot.ok && airShot.reused === false,
    'Untargeted authoritative shot was rejected', airShot);
  const airCombat = assertCombat(airShot.combat, {
    weapon: 'pistol',
    weaponRuntimeId: 'pistol',
    loaded: 2,
    magSize: 8,
    reserveAmmo: 5
  }, 'untargeted shot combat');

  const replay = await socketAck(account.socket, 'combatAttack', payload);
  invariant(replay.ok && replay.reused === true,
    'Untargeted attack-token replay was not idempotent', replay);
  const replayCombat = assertCombat(replay.combat, {
    weapon: 'pistol',
    weaponRuntimeId: 'pistol',
    loaded: 2,
    reserveAmmo: 5
  }, 'untargeted replay combat');
  invariant(Number(replayCombat.ap) >= Number(airCombat.ap),
    'Untargeted attack-token replay spent AP', {
      first: airCombat,
      replay: replayCombat
    });

  const nextToken = `combat_runtime_air_${Date.now().toString(36)}_${++attackSequence}`;
  const tooFast = await socketAck(account.socket, 'combatAttack', {
    ...payload,
    attackToken: nextToken,
    combat: { ...payload.combat, token: nextToken }
  });
  invariant(tooFast.ok === false,
    'Untargeted shot bypassed authoritative weapon cooldown', tooFast);
  assertCombat(tooFast.combat, {
    weaponRuntimeId: 'pistol',
    loaded: 2,
    reserveAmmo: 5
  }, 'untargeted cooldown rejection combat');
  closeSocket(account);
}

async function assertServerFireRate(accounts) {
  await connectAndJoin(accounts.cadence);
  assertSameCombatRoom(accounts.cadence, accounts.target, 'fire-rate');
  assertCombat(accounts.cadence.join.combat, {
    weapon: 'pistol',
    loaded: 8,
    magSize: 8,
    reserveAmmo: 8
  }, 'fire-rate join combat');

  const firstPayload = attackPayload(accounts.cadence.join, accounts.target.socket, 'single');
  const first = await socketAck(accounts.cadence.socket, 'playerHit', firstPayload);
  invariant(first.ok, 'First cadence shot was rejected', first);
  assertCombat(first.combat, { loaded: 7, reserveAmmo: 8 }, 'first cadence shot');

  const replay = await socketAck(accounts.cadence.socket, 'playerHit', firstPayload);
  invariant(replay.ok === false, 'Server accepted an already-spent attack token', replay);
  const replayCombat = assertCombat(replay.combat, {
    loaded: 7,
    reserveAmmo: 8
  }, 'attack-token replay combat');
  invariant(Number(replayCombat.ap) >= Number(first.combat.ap),
    'Attack-token replay spent AP', { first: first.combat, replay: replayCombat });

  // The legacy guard was only 45ms. A 70ms gap must still be rejected for a
  // pistol whose authoritative single-shot fireRate is 0.48 seconds.
  await delay(70);
  const tooFast = await socketAck(
    accounts.cadence.socket,
    'playerHit',
    attackPayload(accounts.cadence.join, accounts.target.socket, 'single')
  );
  invariant(tooFast.ok === false, 'Server accepted a pistol shot only 70ms after the previous shot', tooFast);
  const rejectedCombat = assertCombat(tooFast.combat, {
    loaded: 7,
    reserveAmmo: 8
  }, 'fire-rate rejection combat');
  invariant(Number(rejectedCombat.ap) >= Number(first.combat.ap),
    'Fire-rate rejection spent AP', { first: first.combat, rejected: rejectedCombat });

  await delay(440);
  const afterCooldown = await socketAck(
    accounts.cadence.socket,
    'playerHit',
    attackPayload(accounts.cadence.join, accounts.target.socket, 'single')
  );
  invariant(afterCooldown.ok, 'Pistol shot stayed blocked after its 0.48s cadence elapsed', afterCooldown);
  assertCombat(afterCooldown.combat, { loaded: 6, reserveAmmo: 8 }, 'post-cooldown shot');
}

async function assertStrictServerAp(accounts) {
  await connectAndJoin(accounts.strictAp);
  assertSameCombatRoom(accounts.strictAp, accounts.target, 'strict AP');
  assertCombat(accounts.strictAp.join.combat, {
    weapon: 'pistol',
    loaded: 0,
    magSize: 8,
    reserveAmmo: 8,
    maxAp: 6
  }, 'strict-AP join combat');

  const reload = await socketAck(accounts.strictAp.socket, 'reloadWeapon', {
    weapon: 'pistol',
    take: 8,
    skillRanks: {},
    talentRanks: {}
  });
  invariant(reload.ok, 'Strict-AP fixture reload failed', reload);
  const afterReload = assertCombat(reload.combat, {
    loaded: 8,
    reserveAmmo: 0,
    maxAp: 6
  }, 'strict-AP reload combat');
  invariant(Number(afterReload.ap) >= 3.95 && Number(afterReload.ap) <= 4.05,
    'Strict-AP fixture did not spend exactly 2 AP on reload', afterReload);

  // At 1.8 AP/sec this leaves about 4.88 AP: below aimed cost 5, but above the
  // old exploitable threshold of 4.15 produced by the +0.85 tolerance.
  await delay(490);
  const insufficient = await socketAck(
    accounts.strictAp.socket,
    'playerHit',
    attackPayload(accounts.strictAp.join, accounts.target.socket, 'aimed')
  );
  invariant(insufficient.ok === false, 'Server accepted a 5-AP aimed shot with less than 5 AP', insufficient);
  const rejectedCombat = assertCombat(insufficient.combat, {
    loaded: 8,
    reserveAmmo: 0,
    maxAp: 6
  }, 'strict-AP rejection combat');
  invariant(Number(rejectedCombat.ap) < 5 && Number(rejectedCombat.ap) >= 4.65,
    'Strict-AP rejection returned an unexpected AP value', rejectedCombat);

  await delay(120);
  const funded = await socketAck(
    accounts.strictAp.socket,
    'playerHit',
    attackPayload(accounts.strictAp.join, accounts.target.socket, 'aimed')
  );
  invariant(funded.ok, 'Aimed shot was rejected after authoritative AP reached its cost', funded);
  assertCombat(funded.combat, { loaded: 7, reserveAmmo: 0, maxAp: 6 }, 'funded aimed shot');
}

async function assertEquipmentActionAuthority(accounts) {
  const account = accounts.equipmentAp;
  const pistolRuntimeId = account.weaponRuntimeId;
  await connectAndJoin(account);
  assertSameCombatRoom(account, accounts.target, 'equipment AP');
  assertCombat(account.join.combat, {
    weapon: 'pistol',
    weaponRuntimeId: pistolRuntimeId,
    loaded: 1,
    reserveAmmo: 0,
    ap: 0
  }, 'equipment-AP join combat');
  invariant(Number(account.join.self?.equipmentRevision) === 0,
    'Join charged AP or advanced equipment revision', account.join.self);

  const unfunded = await sendEquipmentAction(account, 'knife');
  invariant(unfunded.ack.ok === false,
    'Equipment changed with less than 1 authoritative AP', unfunded.ack);
  invariant(unfunded.ack.self?.equipmentRuntime?.weapon === pistolRuntimeId
    && Number(unfunded.ack.equipmentRevision) === 0
    && Number(unfunded.ack.self?.combat?.loaded) === 1
    && Number(unfunded.ack.self?.combat?.ap) < 1,
  'Rejected equipment action mutated weapon, magazine, AP, or revision', unfunded.ack);

  await delay(620);
  const funded = await sendEquipmentAction(account, 'knife');
  invariant(funded.ack.ok && funded.ack.changed && !funded.ack.reused,
    'Funded equipment action was rejected', funded.ack);
  invariant(Number(funded.ack.apCost) === 1
    && Number(funded.ack.equipmentRevision) === 1
    && funded.ack.self?.equipmentRuntime?.weapon === 'knife',
  'Funded equipment action did not atomically spend 1 AP and advance revision', funded.ack);
  const fundedAp = Number(funded.ack.self?.combat?.ap);
  invariant(fundedAp >= 0 && fundedAp < 0.45,
    'Funded equipment action did not spend exactly the regenerated 1 AP', funded.ack.self?.combat);
  assertRuntimeWeaponInventory(funded.ack.self, pistolRuntimeId, 1, 'post-equip carried pistol');

  const replay = await socketAck(account.socket, 'equipmentAction', funded.payload);
  invariant(replay.ok && replay.reused && replay.changed === false && Number(replay.apCost) === 0,
    'Equipment request replay was not idempotent', replay);
  invariant(replay.self?.equipmentRuntime?.weapon === 'knife'
    && Number(replay.self?.combat?.ap) >= fundedAp
    && Number(replay.equipmentRevision) === 1,
  'Equipment request replay spent AP or changed equipment', replay);

  const collision = await socketAck(account.socket, 'equipmentAction', {
    ...funded.payload,
    itemRuntimeId: 'pistol'
  });
  invariant(collision.ok === false
    && collision.self?.equipmentRuntime?.weapon === 'knife'
    && Number(collision.self?.combat?.ap) >= fundedAp,
  'Reused equipment request id accepted a different payload', collision);

  const stale = await sendEquipmentAction(account, pistolRuntimeId, { expectedRevision: 0 });
  invariant(stale.ack.ok === false
    && stale.ack.self?.equipmentRuntime?.weapon === 'knife'
    && Number(stale.ack.equipmentRevision) === 1
    && Number(stale.ack.self?.combat?.ap) >= fundedAp,
  'Stale equipment revision changed equipment or AP', stale.ack);

  account.socket.emit('state', {
    profileOnly: true,
    equipment: runtimeEquipmentSnapshot('pistol'),
    skillRanks: {},
    talentRanks: {}
  });
  await delay(100);
  const afterProfileSpoof = await socketAck(account.socket, 'join', joinPayload(account));
  invariant(afterProfileSpoof.ok === false
    && afterProfileSpoof.self?.equipmentRuntime?.weapon === 'knife'
    && Number(afterProfileSpoof.self?.equipmentRevision) === 1,
  'Legacy state packet changed authoritative equipment for free', afterProfileSpoof);

  const spoofedCombat = await socketAck(
    account.socket,
    'playerHit',
    attackPayload(account.join, accounts.target.socket, 'single', 'pistol')
  );
  invariant(spoofedCombat.ok === false
    && spoofedCombat.self?.equipmentRuntime?.weapon === 'knife'
    && Number(spoofedCombat.self?.equipmentRevision) === 1,
  'Combat packet changed authoritative equipment for free', spoofedCombat);

  const stillUnfunded = await sendEquipmentAction(account, pistolRuntimeId);
  invariant(stillUnfunded.ack.ok === false
    && stillUnfunded.ack.self?.equipmentRuntime?.weapon === 'knife'
    && Number(stillUnfunded.ack.equipmentRevision) === 1,
  'Insufficient-AP switch back was not atomic', stillUnfunded.ack);

  await delay(700);
  const beforeInvalidRuntime = await socketAck(account.socket, 'equipmentAction', funded.payload);
  const beforeInvalidAp = Number(beforeInvalidRuntime.self?.combat?.ap);
  invariant(beforeInvalidRuntime.ok && beforeInvalidRuntime.reused && beforeInvalidAp >= 1,
    'Invalid-runtime fixture did not regenerate enough authoritative AP', beforeInvalidRuntime);
  const invalidRuntime = await sendEquipmentAction(account, 'ui_pistol_equipment_2');
  invariant(invalidRuntime.ack.ok === false
    && invalidRuntime.ack.self?.equipmentRuntime?.weapon === 'knife'
    && Number(invalidRuntime.ack.equipmentRevision) === 1
    && Number(invalidRuntime.ack.self?.combat?.ap) + 0.02 >= beforeInvalidAp,
  'Unavailable runtime rejection changed equipment, revision, or AP', invalidRuntime.ack);
  assertRuntimeWeaponInventory(
    invalidRuntime.ack.self,
    pistolRuntimeId,
    1,
    'post-invalid-runtime carried pistol'
  );

  closeSocket(account);
  await delay(650);
  await connectAndJoin(account);
  invariant(account.join.self?.equipmentRuntime?.weapon === 'knife'
    && Number(account.join.self?.equipmentRevision) === 0,
  'Reconnect charged AP or lost authoritative equipment', account.join.self);
  assertRuntimeWeaponInventory(account.join.self, pistolRuntimeId, 1, 'reconnected carried pistol');
  closeSocket(account);
}

async function main() {
  assertDependenciesInstalled();
  const accounts = {};
  try {
    await bootstrapCharacters(accounts);
    await exerciseMagazineBeforeReconnect(accounts);
    await assertMagazineAfterReconnect(accounts);
    await assertUntargetedAttack(accounts);
    await assertServerFireRate(accounts);
    await assertStrictServerAp(accounts);
    await assertEquipmentActionAuthority(accounts);

    console.log(
      'Combat runtime OK: runtime-id profile sync and reload/fire survived save + reconnect, '
      + 'same-base magazines stayed separate, stale save did not roll back live equipment, '
      + 'duplicate joins and loaded-runtime drops preserved live combat state, '
      + 'loaded/reserve stayed conserved, targeted and untargeted replay/cadence were enforced, '
      + 'equipment changes were revisioned/idempotent and spent exactly 1 server AP, '
      + 'and insufficient AP or unavailable runtime ids caused no mutation'
    );
  } finally {
    for (const account of Object.values(accounts)) closeSocket(account);
    await delay(100);
    await stopServer();
    cleanupSync();
  }
}

main().catch(error => {
  console.error(`Combat runtime check failed: ${error?.message || String(error)}`);
  const logs = activeServerLogs.join('').trim();
  if (logs) console.error(logs.slice(-5000));
  process.exitCode = 1;
});
