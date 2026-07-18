// Стабильная серверная логика Realm of Ashes. Рабочий вход проекта: ../../server.js
// Этот файл оставлен как точка для будущего модульного разбиения серверной логики.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { version: GAME_VERSION } = require('../../package.json');

const GAME_NAME = 'Realm of Ashes';

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = Number(process.env.TICK_RATE || 12);
const DT = 1 / TICK_RATE;
const MAP_SIZE = 140;
const PLAYER_SPEED = 7.0;
const SESSION_LOCK_MS = Number(process.env.SESSION_LOCK_MS || 120000);
const JSON_LIMIT = process.env.JSON_LIMIT || '12mb';
const REST_CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Auth-Token',
  'X-Device-Id',
  'X-Client-Instance-Id',
  'X-Character-Lease-Id',
  'X-Device-Type',
  'X-Control-Type'
].join(', ');

// Example: ORIGINS="https://yandex.ru,https://yandex.com,http://localhost:8080"
const allowedOrigins = (process.env.ORIGINS || '*')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SAVES_FILE = path.join(DATA_DIR, 'saves.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function backupUnreadableJson(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.corrupt-${stamp}`;
    fs.copyFileSync(file, backup);
    return backup;
  } catch (err) {
    console.error('Failed to backup unreadable JSON:', file, err);
    return '';
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    const backup = backupUnreadableJson(file);
    console.error('Failed to read JSON:', file, backup ? `backup: ${backup}` : 'backup failed', err);
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const usersDb = readJson(USERS_FILE, { version: 1, users: {}, sessions: {} });
const savesDb = readJson(SAVES_FILE, { version: 1, saves: {} });
if (!usersDb.users) usersDb.users = {};
if (!usersDb.sessions) usersDb.sessions = {};
if (!savesDb.saves) savesDb.saves = {};
if (!savesDb.characters) savesDb.characters = {};

// Живые блокировки нужны, чтобы один аккаунт/персонаж не был открыт с двух устройств.
const activeAccountSockets = new Map(); // login -> socket.id
const activeCharacterSockets = new Map(); // characterId -> socket.id

function pruneStaleSessions(login = '') {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of Object.entries(usersDb.sessions || {})) {
    if (!session) { delete usersDb.sessions[token]; changed = true; continue; }
    if (login && session.login !== login) continue;
    const liveSocket = session.activeSocketId && socketIsLive(session.activeSocketId);
    const fresh = Number(session.lastSeenAt || 0) > now - SESSION_LOCK_MS;
    if (!liveSocket && !fresh) {
      delete usersDb.sessions[token];
      changed = true;
    }
  }
  if (changed) persistUsers();
}

function persistUsers() { writeJsonAtomic(USERS_FILE, usersDb); }
function persistSaves() { writeJsonAtomic(SAVES_FILE, savesDb); }

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function validateLogin(login) {
  return /^[a-z0-9_.@-]{3,32}$/.test(login);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 4 && password.length <= 128;
}

function makeUserId() {
  return `u_${crypto.randomBytes(12).toString('hex')}`;
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
  } catch (_) {
    return false;
  }
}

function normalizeDeviceId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,96}$/.test(id) ? id : '';
}

function normalizeDeviceType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'mobile' || v === 'phone' || v === 'tablet' || v === 'touch') return 'mobile';
  return 'desktop';
}

function normalizeControlType(value, deviceType = 'desktop') {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'touch' || v === 'mobile') return 'touch';
  if (v === 'gamepad') return 'gamepad';
  return deviceType === 'mobile' ? 'touch' : 'keyboard_mouse';
}

function getDeviceIdFromRequest(req) {
  return normalizeDeviceId(req.headers['x-device-id'] || req.body?.deviceId || '');
}

function getDeviceTypeFromRequest(req) {
  return normalizeDeviceType(req.headers['x-device-type'] || req.body?.deviceType || '');
}

function getControlTypeFromRequest(req) {
  const deviceType = getDeviceTypeFromRequest(req);
  return normalizeControlType(req.headers['x-control-type'] || req.body?.controlType || '', deviceType);
}

function socketIsLive(socketId) {
  try { return !!(socketId && io && io.sockets && io.sockets.sockets && io.sockets.sockets.has(socketId)); }
  catch (_) { return false; }
}

function sessionConflictForLogin(login, deviceId) {
  pruneStaleSessions(login);
  const now = Date.now();
  for (const [token, session] of Object.entries(usersDb.sessions || {})) {
    if (!session || session.login !== login) continue;
    if (deviceId && session.deviceId === deviceId) continue;
    if (session.activeSocketId && socketIsLive(session.activeSocketId)) return session;
    if (Number(session.lastSeenAt || 0) > now - SESSION_LOCK_MS) return session;
  }
  const socketId = activeAccountSockets.get(login);
  if (socketIsLive(socketId)) {
    const p = players.get(socketId);
    if (!deviceId || !p || p.deviceId !== deviceId) return { login, activeSocketId: socketId };
  } else {
    activeAccountSockets.delete(login);
  }
  return null;
}

function clearOldDeviceSessions(login, deviceId) {
  if (!deviceId) return;
  for (const [token, session] of Object.entries(usersDb.sessions || {})) {
    if (session && session.login === login && session.deviceId === deviceId) delete usersDb.sessions[token];
  }
}

function createSession(login, user, deviceId = '', deviceType = 'desktop', controlType = 'keyboard_mouse') {
  clearOldDeviceSessions(login, deviceId);
  const token = makeToken();
  usersDb.sessions[token] = {
    userId: user.id,
    login,
    deviceId,
    deviceType: normalizeDeviceType(deviceType),
    controlType: normalizeControlType(controlType, normalizeDeviceType(deviceType)),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    activeSocketId: ''
  };
  user.lastLoginAt = Date.now();
  persistUsers();
  return token;
}

function getAuthFromRequest(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.headers['x-auth-token'] || '').trim();
}

function getUserByToken(token, deviceId = '') {
  if (!token) return null;
  const session = usersDb.sessions[token];
  if (!session) return null;
  if (session.deviceId && deviceId && session.deviceId !== deviceId) return null;
  if (!session.deviceId && deviceId) session.deviceId = deviceId;
  const user = usersDb.users[session.login];
  if (!user || user.id !== session.userId) return null;
  session.lastSeenAt = Date.now();
  return { token, session, user, login: session.login };
}

function requireAuth(req, res, next) {
  const deviceId = getDeviceIdFromRequest(req);
  const auth = getUserByToken(getAuthFromRequest(req), deviceId);
  if (!auth) return res.status(401).json({ ok: false, error: 'Не выполнен вход или сессия открыта на другом устройстве.' });
  req.auth = auth;
  req.deviceId = deviceId;
  req.deviceType = getDeviceTypeFromRequest(req);
  req.controlType = getControlTypeFromRequest(req);
  next();
}

function safeSaveState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  // Состояние приходит от текущего HTML-клиента: персонаж, инвентарь, карта,
  // locationStates, враги, хранилище, быстрые слоты и runtime оружия.
  return state;
}


function makeCharacterId() {
  return `c_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function normalizeCharacterId(id) {
  const value = String(id || '').trim();
  return /^[a-zA-Z0-9_-]{3,64}$/.test(value) ? value : '';
}

function summarizeState(state, fallbackId = '') {
  const profile = state?.characterProfile || {};
  const player = state?.player || {};
  return {
    id: normalizeCharacterId(profile.serverCharacterId || fallbackId) || fallbackId || makeCharacterId(),
    name: safeName(profile.name || 'Без имени'),
    level: Number(player.level || 1),
    xp: Number(player.xp || 0),
    locationId: String(state?.currentLocationId || 'settlement').slice(0, 32),
    savedAt: Number(state?.savedAt || Date.now()),
    createdAt: Number(profile.createdAt || Date.now())
  };
}

function ensureUserCharacterStore(userId) {
  if (!savesDb.characters[userId]) savesDb.characters[userId] = {};
  return savesDb.characters[userId];
}

function migrateLegacySaveToCharacter(user, login) {
  const store = ensureUserCharacterStore(user.id);
  const legacy = savesDb.saves[user.id];
  if (!legacy || !legacy.state || Object.keys(store).length > 0) return false;
  const state = legacy.state;
  const existingId = normalizeCharacterId(state?.characterProfile?.serverCharacterId);
  const characterId = existingId || makeCharacterId();
  if (state.characterProfile) state.characterProfile.serverCharacterId = characterId;
  const updatedAt = Number(legacy.updatedAt || Date.now());
  store[characterId] = {
    id: characterId,
    login,
    createdAt: Number(state?.characterProfile?.createdAt || updatedAt),
    updatedAt,
    summary: summarizeState(state, characterId),
    state
  };
  persistSaves();
  return true;
}

function listUserCharacters(user, login) {
  migrateLegacySaveToCharacter(user, login);
  const store = ensureUserCharacterStore(user.id);
  return Object.values(store)
    .map(row => ({
      id: row.id,
      name: row.summary?.name || row.state?.characterProfile?.name || 'Без имени',
      level: Number(row.summary?.level || row.state?.player?.level || 1),
      xp: Number(row.summary?.xp || row.state?.player?.xp || 0),
      locationId: row.summary?.locationId || row.state?.currentLocationId || 'settlement',
      createdAt: Number(row.createdAt || row.summary?.createdAt || Date.now()),
      updatedAt: Number(row.updatedAt || row.summary?.savedAt || Date.now())
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveCharacterState(user, login, characterId, state) {
  const id = normalizeCharacterId(characterId || state?.characterProfile?.serverCharacterId) || makeCharacterId();
  if (!state.characterProfile) state.characterProfile = {};
  state.characterProfile.serverCharacterId = id;
  const store = ensureUserCharacterStore(user.id);
  const now = Date.now();
  const prev = store[id] || {};
  store[id] = {
    id,
    login,
    createdAt: Number(prev.createdAt || state.characterProfile.createdAt || now),
    updatedAt: now,
    summary: summarizeState(state, id),
    state
  };
  // Старое поле оставляем как последнее активное сохранение, чтобы старые HTML-версии не ломались.
  savesDb.saves[user.id] = { login, updatedAt: now, state };
  persistSaves();
  return store[id];
}

function corsOrigin(origin, cb) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error('Origin not allowed: ' + origin));
}

const app = express();

function getRestCorsOrigin(origin) {
  if (!origin) return '*';
  if (allowedOrigins.includes('*')) return '*';
  return allowedOrigins.includes(origin) ? origin : '';
}

// CORS для REST API: HTML обычно открыт с http://localhost:8080,
// а сервер регистрации/сохранений работает на http://localhost:3000.
// Без этих заголовков браузер блокирует /api/auth/register и другие fetch-запросы.
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  const allowOrigin = getRestCorsOrigin(origin);
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', REST_CORS_ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_LIMIT }));

// Клиент вынесен в public/index.html, CSS и JS лежат в public/css и public/js.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); }
}));

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    name: GAME_NAME,
    version: GAME_VERSION,
    uptimeSec: Math.round(process.uptime()),
    players: players.size,
    locationRealities: rooms.size,
    playerLimitPerLocation: null,
    users: Object.keys(usersDb.users).length,
    saves: Object.keys(savesDb.saves).length,
    characters: Object.values(savesDb.characters).reduce((sum, row) => sum + Object.keys(row || {}).length, 0)
  });
});

app.post('/api/auth/register', (req, res) => {
  const login = normalizeLogin(req.body.login);
  const password = String(req.body.password || '');
  const deviceId = getDeviceIdFromRequest(req);
  const deviceType = getDeviceTypeFromRequest(req);
  const controlType = getControlTypeFromRequest(req);
  if (!validateLogin(login)) {
    return res.status(400).json({ ok: false, error: 'Логин: 3–32 символа, латиница/цифры/._@-.' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ ok: false, error: 'Пароль должен быть от 4 до 128 символов.' });
  }
  if (usersDb.users[login]) {
    return res.status(409).json({ ok: false, error: 'Такой логин уже зарегистрирован.' });
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    id: makeUserId(),
    login,
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
    lastLoginAt: Date.now()
  };
  usersDb.users[login] = user;
  const token = createSession(login, user, deviceId, deviceType, controlType);
  res.json({ ok: true, token, user: { login }, hasSave: false, characters: [] });
});

app.post('/api/auth/login', (req, res) => {
  const login = normalizeLogin(req.body.login);
  const password = String(req.body.password || '');
  const deviceId = getDeviceIdFromRequest(req);
  const deviceType = getDeviceTypeFromRequest(req);
  const controlType = getControlTypeFromRequest(req);
  const user = usersDb.users[login];
  if (!user || !verifyPassword(password, user)) {
    return res.status(401).json({ ok: false, error: 'Неверный логин или пароль.' });
  }
  const conflict = sessionConflictForLogin(login, deviceId);
  if (conflict) {
    return res.status(409).json({ ok: false, error: 'Этот аккаунт уже открыт на другом устройстве. Выйдите там из игры или подождите около минуты после закрытия вкладки.' });
  }
  const token = createSession(login, user, deviceId, deviceType, controlType);
  const characters = listUserCharacters(user, login);
  res.json({ ok: true, token, user: { login }, hasSave: characters.length > 0, characters });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const characters = listUserCharacters(req.auth.user, req.auth.login);
  persistUsers();
  res.json({ ok: true, user: { login: req.auth.login }, hasSave: characters.length > 0, characters });
});

app.post('/api/auth/heartbeat', requireAuth, (req, res) => {
  req.auth.session.lastSeenAt = Date.now();
  persistUsers();
  res.json({ ok: true, now: req.auth.session.lastSeenAt });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const sid = req.auth.session.activeSocketId;
  if (sid && socketIsLive(sid)) {
    try { io.sockets.sockets.get(sid).disconnect(true); } catch (_) {}
  }
  if (activeAccountSockets.get(req.auth.login) === sid) activeAccountSockets.delete(req.auth.login);
  delete usersDb.sessions[req.auth.token];
  persistUsers();
  res.json({ ok: true });
});


app.get('/api/characters', requireAuth, (req, res) => {
  const characters = listUserCharacters(req.auth.user, req.auth.login);
  res.json({ ok: true, characters });
});

function characterLockedByOtherToken(characterId, token) {
  const socketId = activeCharacterSockets.get(characterId);
  if (!socketIsLive(socketId)) {
    activeCharacterSockets.delete(characterId);
    return false;
  }
  const p = players.get(socketId);
  return !!(p && p.token && p.token !== token);
}

app.get('/api/characters/:characterId', requireAuth, (req, res) => {
  const characterId = normalizeCharacterId(req.params.characterId);
  if (!characterId) return res.status(400).json({ ok: false, error: 'Некорректный ID персонажа.' });
  const store = ensureUserCharacterStore(req.auth.user.id);
  const row = store[characterId];
  if (!row) return res.status(404).json({ ok: false, error: 'Персонаж не найден.' });
  if (characterLockedByOtherToken(characterId, req.auth.token)) return res.status(409).json({ ok: false, error: 'Этот персонаж уже открыт на другом устройстве.' });
  res.json({ ok: true, character: {
    id: row.id,
    name: row.summary?.name || row.state?.characterProfile?.name || 'Без имени',
    level: Number(row.summary?.level || row.state?.player?.level || 1),
    xp: Number(row.summary?.xp || row.state?.player?.xp || 0),
    locationId: row.summary?.locationId || row.state?.currentLocationId || 'settlement',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }, save: row.state });
});

app.post('/api/characters/:characterId/save', requireAuth, (req, res) => {
  const characterId = normalizeCharacterId(req.params.characterId);
  if (!characterId) return res.status(400).json({ ok: false, error: 'Некорректный ID персонажа.' });
  const state = safeSaveState(req.body.state);
  if (!state) return res.status(400).json({ ok: false, error: 'Некорректное состояние игры.' });
  if (characterLockedByOtherToken(characterId, req.auth.token)) return res.status(409).json({ ok: false, error: 'Этот персонаж сейчас открыт на другом устройстве. Синхронизация отклонена, чтобы не раздвоить прогресс.' });
  const row = saveCharacterState(req.auth.user, req.auth.login, characterId, state);
  res.json({ ok: true, characterId: row.id, updatedAt: row.updatedAt, character: row.summary });
});

app.delete('/api/characters/:characterId', requireAuth, (req, res) => {
  const characterId = normalizeCharacterId(req.params.characterId);
  if (!characterId) return res.status(400).json({ ok: false, error: 'Некорректный ID персонажа.' });
  const store = ensureUserCharacterStore(req.auth.user.id);
  if (!store[characterId]) return res.status(404).json({ ok: false, error: 'Персонаж не найден.' });
  delete store[characterId];
  persistSaves();
  res.json({ ok: true, characters: listUserCharacters(req.auth.user, req.auth.login) });
});

app.get('/api/save', requireAuth, (req, res) => {
  const characters = listUserCharacters(req.auth.user, req.auth.login);
  if (characters.length) {
    const store = ensureUserCharacterStore(req.auth.user.id);
    const row = store[characters[0].id];
    return res.json({ ok: true, save: row?.state || null, updatedAt: row?.updatedAt || null, characterId: row?.id || null, characters });
  }
  const saveRow = savesDb.saves[req.auth.user.id] || null;
  res.json({ ok: true, save: saveRow?.state || null, updatedAt: saveRow?.updatedAt || null, characters: [] });
});

app.post('/api/save', requireAuth, (req, res) => {
  const state = safeSaveState(req.body.state);
  if (!state) return res.status(400).json({ ok: false, error: 'Некорректное состояние игры.' });
  const requestedId = normalizeCharacterId(req.body.characterId || state?.characterProfile?.serverCharacterId) || makeCharacterId();
  const row = saveCharacterState(req.auth.user, req.auth.login, requestedId, state);
  res.json({ ok: true, characterId: row.id, updatedAt: row.updatedAt, character: row.summary });
});

app.post('/api/save/reset', requireAuth, (req, res) => {
  delete savesDb.saves[req.auth.user.id];
  delete savesDb.characters[req.auth.user.id];
  persistSaves();
  res.json({ ok: true });
});



// Локальный запуск идет без SDK Яндекса. Возвращаем JS, чтобы браузер не ругался на MIME,
// если старая вкладка или кэш всё же запросит /sdk.js.
app.get('/sdk.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript').send('window.YaGames=window.YaGames||null;');
});

app.get('/favicon.ico', (_, res) => {
  res.status(204).end();
});

function resolveThreeBundlePath() {
  const candidates = [];
  // Manual fallback first: you can put a browser build near this server.
  candidates.push(path.join(__dirname, 'three.min.js'));
  candidates.push(path.join(__dirname, 'vendor', 'three.min.js'));
  candidates.push(path.join(__dirname, 'node_modules', 'three', 'build', 'three.min.js'));
  candidates.push(path.join(__dirname, 'node_modules', 'three', 'build', 'three.js'));

  // npm dependency fallback. package.json pins three 0.125.2 because it still has
  // build/three.min.js with the global window.THREE object needed by this HTML game.
  try {
    const threePackage = require.resolve('three/package.json');
    const threeDir = path.dirname(threePackage);
    candidates.push(path.join(threeDir, 'build', 'three.min.js'));
    candidates.push(path.join(threeDir, 'build', 'three.js'));
  } catch (_) {}

  return candidates.find(file => file && fs.existsSync(file)) || '';
}

function resolveThreeExamplePath(relativePath) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  const candidates = [
    path.join(__dirname, 'node_modules', 'three', 'examples', 'js', ...parts)
  ];
  try {
    const threePackage = require.resolve('three/package.json');
    const threeDir = path.dirname(threePackage);
    candidates.push(path.join(threeDir, 'examples', 'js', ...parts));
  } catch (_) {}
  return candidates.find(file => file && fs.existsSync(file)) || '';
}

app.get('/vendor/three.min.js', (req, res) => {
  const file = resolveThreeBundlePath();
  if (file) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('application/javascript').sendFile(file);
  }
  console.error('Three.js browser build was not found. Run: npm install, then node server.js.');
  res.status(500).type('application/javascript').send(`console.error(${JSON.stringify('Three.js не найден на сервере. В папке проекта выполните: npm install, затем node server.js')});`);
});

app.get('/vendor/GLTFLoader.js', (req, res) => {
  const file = resolveThreeExamplePath('loaders/GLTFLoader.js');
  if (file) {
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('application/javascript').sendFile(file);
  }
  console.error('GLTFLoader was not found. Run: npm install, then node server.js.');
  res.status(500).type('application/javascript').send(`console.error(${JSON.stringify('GLTFLoader not found. Run npm install, then node server.js.')});`);
});

function findClientHtml() {
  const candidates = [
    process.env.CLIENT_HTML,
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, 'public', 'game.html'),
    path.join(__dirname, 'game.html'),
    path.join(__dirname, 'index.html')
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || '';
}

function sendClientHtml(_, res) {
  const clientHtml = findClientHtml();
  if (clientHtml) return res.sendFile(clientHtml);
  return res.type('text/plain').send(`${GAME_NAME} v${GAME_VERSION} server is running, but client HTML was not found. Put the HTML file in public/index.html or set CLIENT_HTML=path/to/game.html. API: /health, /api/auth/login, /api/auth/register, /api/characters, /api/save.`);
}

app.get('/', sendClientHtml);
app.get('/game', sendClientHtml);
app.get('/game.html', sendClientHtml);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Device-Id']
  },
  transports: ['websocket', 'polling']
});

const players = new Map();
const rooms = new Map();
const globalTravelSessions = new Map();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function safeName(name) { return String(name || 'Wanderer').slice(0, 24).replace(/[<>]/g, ''); }

const VALID_EQUIPMENT = {
  weapon: new Set(['pistol', 'rifle', 'assaultRifle', 'knife', 'fists', 'medkit', 'stim', 'doctorBag', 'antibiotics', 'pickaxe', 'axe', 'handPump']),
  armor: new Set(['leather', 'combatArmor', '']),
  helmet: new Set(['helmet', 'tacticalHelmet', 'assaultHelmet', '']),
  boots: new Set(['boots', 'scoutBoots', 'reinforcedBoots', '']),
  backpack: new Set(['backpack', ''])
};

function sanitizeEquipment(input = {}, fallback = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const out = {
    weapon: String(src.weapon ?? base.weapon ?? 'pistol'),
    armor: String(src.armor ?? base.armor ?? ''),
    helmet: String(src.helmet ?? base.helmet ?? ''),
    boots: String(src.boots ?? base.boots ?? ''),
    backpack: String(src.backpack ?? base.backpack ?? '')
  };
  Object.keys(out).forEach(slot => {
    if (!VALID_EQUIPMENT[slot] || !VALID_EQUIPMENT[slot].has(out[slot])) out[slot] = slot === 'weapon' ? 'pistol' : '';
  });
  return out;
}

function sanitizeInjuries(input = {}, fallback = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const out = {};
  ['brokenArm', 'brokenLeg', 'concussion', 'infection'].forEach(id => {
    if (src[id] === true || base[id] === true) out[id] = true;
  });
  return out;
}

function normalizeLocationId(id) { return String(id || 'settlement').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'settlement'; }
function sanitizeServerGlobalMapPoint(input = null) {
  if (!input || typeof input !== 'object') return null;
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x, 0, 900), y: clamp(y, 0, 900) };
}
function roomIdFor(locationId) { return normalizeLocationId(locationId); }

// ===== MMO AUTHORITATIVE WORLD =====
// Сервер больше не доверяет клиентам в вопросе мобов: карта, ресурсы и enemies
// есть внутри каждой комнаты, а AI/спавн/атаки/лут идут из server tick.
const TILE = 2.0;
const MAP_W = 38;
const MAP_H = 38;
const TILE_TYPES = { GRASS: 0, TREE: 1, ROCK: 2, WATER: 3, DARK: 4, PATH: 5, ORE: 6, WOOD: 7, RUIN: 8, OIL: 9 };
const WORLD_ENVIRONMENT_VERSION = 'wasteland-props-v778';
const LOCATIONS = {
  settlement: {
    id: 'settlement', name: 'Поселение', seed: 20260601, safe: true, pvpMode: 'peaceful',
    spawn: { tx: 19, tz: 25 }, entryFromWasteland: { tx: 19, tz: 5 },
    exit: { tx: 19, tz: 3, to: 'wasteland', label: 'Путь в Пепельный лес' },
    trader: { tx: 15, tz: 20, name: 'Старый Клим' },
    storage: { tx: 23, tz: 20, name: 'Общий ящик' }
  },
  wasteland: {
    id: 'wasteland', name: 'Пепельный лес', seed: 123456, safe: false, pvpMode: 'pvp',
    enemyCap: 12, spawnCount: 8,
    spawn: { tx: 19, tz: 32 }, entryFromSettlement: { tx: 19, tz: 34 },
    exit: { tx: 19, tz: 35, to: 'settlement', label: 'Дорога в поселение' }
  },
  scrapTown: {
    id: 'scrapTown', name: 'Свалочный пост', seed: 20260811, safe: true, pvpMode: 'peaceful',
    spawn: { tx: 19, tz: 25 }, entryFromWorld: { tx: 19, tz: 25 },
    trader: {
      tx: 16, tz: 19, name: 'Грач-Жестянщик',
      stock: [
        { id: 'repairKit', price: 18, qty: 4 },
        { id: 'pickaxe', price: 16, qty: 2 },
        { id: 'axe', price: 15, qty: 2 },
        { id: 'handPump', price: 22, qty: 2 },
        { id: 'scrap', price: 3, qty: 18 },
        { id: 'oil', price: 8, qty: 8 },
        { id: 'ammo9', price: 2, qty: 90 },
        { id: 'ammo556', price: 4, qty: 80 },
        { id: 'shotgunShell', price: 5, qty: 28 },
        { id: 'napalm', price: 6, qty: 35 },
        { id: 'pistol', price: 48, qty: 1 },
        { id: 'rifle', price: 78, qty: 1 },
        { id: 'shotgun', price: 138, qty: 1 },
        { id: 'metalArmor', price: 54, qty: 1 },
        { id: 'ballisticVest', price: 82, qty: 1 },
        { id: 'scoutBoots', price: 20, qty: 1 },
        { id: 'backpack', price: 32, qty: 1 },
        { id: 'water', price: 6, qty: 5 }
      ],
      buyInterests: ['materials', 'tools', 'weapons', 'armor']
    }
  },
  relayStation: {
    id: 'relayStation', name: 'Станция Ретранслятор', seed: 20260823, safe: true, pvpMode: 'peaceful',
    spawn: { tx: 19, tz: 25 }, entryFromWorld: { tx: 19, tz: 25 },
    trader: {
      tx: 22, tz: 18, name: 'Рада Искра',
      stock: [
        { id: 'energyCell', price: 4, qty: 120 },
        { id: 'napalm', price: 6, qty: 50 },
        { id: 'laserPistol', price: 128, qty: 1 },
        { id: 'plasmaRifle', price: 232, qty: 1 },
        { id: 'flamethrower', price: 198, qty: 1 },
        { id: 'oil', price: 9, qty: 14 },
        { id: 'repairKit', price: 18, qty: 3 },
        { id: 'hazmatSuit', price: 88, qty: 1 },
        { id: 'energySuit', price: 138, qty: 1 },
        { id: 'tacticalHelmet', price: 32, qty: 1 },
        { id: 'assaultHelmet', price: 50, qty: 1 },
        { id: 'doctorBag', price: 36, qty: 2 },
        { id: 'antibiotics', price: 26, qty: 4 },
        { id: 'medkit', price: 21, qty: 4 },
        { id: 'rocketAmmo', price: 22, qty: 4 },
        { id: 'napalm', price: 6, qty: 20 },
        { id: 'water', price: 6, qty: 4 }
      ],
      buyInterests: ['tools', 'ammo', 'weapons', 'armor']
    }
  },
  randomEncounter: {
    id: 'randomEncounter', name: 'Событие мира', seed: 20260901, safe: false, pvpMode: 'pvp',
    encounterOnly: true, noRespawn: true, enemyCap: 0, spawnCount: 0,
    spawn: { tx: 19, tz: 19 }, entryFromWorld: { tx: 19, tz: 19 }
  }
};
function applyLocationTraderProfiles(locations = {}) {
  const profiles = {
    settlement: { id: 'old_klim', dialogueProfile: 'klim', caps: 720, quests: ['klimSupplies', 'klimTerminal'] },
    scrapTown: { id: 'scrap_gratch', dialogueProfile: 'scrap', caps: 460, quests: ['scrapParts'] },
    relayStation: { id: 'relay_rada', dialogueProfile: 'relay', caps: 640, quests: ['relayCalibration'] }
  };
  Object.entries(profiles).forEach(([locationId, profile]) => {
    const loc = locations?.[locationId];
    if (!loc?.trader) return;
    loc.trader = { ...profile, ...loc.trader };
    loc.trader.id = profile.id;
    loc.trader.dialogueProfile = profile.dialogueProfile;
    loc.trader.caps = Number.isFinite(Number(loc.trader.caps)) ? Math.max(0, Math.floor(Number(loc.trader.caps))) : profile.caps;
    loc.trader.quests = Array.isArray(loc.trader.quests) && loc.trader.quests.length ? loc.trader.quests : profile.quests.slice();
  });
  return locations;
}
applyLocationTraderProfiles(LOCATIONS);
const SERVER_ENEMY_TYPES = [
  { name: 'Рейдер', hp: 55, atk: 9, speed: 2.45, xp: 25, money: 5, scale: 1.0 },
  { name: 'Гуль', hp: 42, atk: 7, speed: 2.85, xp: 18, money: 2, scale: 0.92 },
  { name: 'Супермутант', hp: 120, atk: 18, speed: 1.75, xp: 70, money: 14, scale: 1.32 },
  { name: 'Пепельный волк', hp: 36, atk: 8, speed: 3.15, xp: 20, money: 1, scale: 0.82 }
];
const SERVER_ITEM_IDS = new Set(['pistol','rifle','assaultRifle','machineGun','laserPistol','flamethrower','plasmaRifle','shotgun','rocketLauncher','knife','fists','leather','metalArmor','ballisticVest','combatArmor','hazmatSuit','heavyArmor','energySuit','helmet','tacticalHelmet','assaultHelmet','boots','scoutBoots','reinforcedBoots','backpack','ammo9','ammo556','energyCell','napalm','shotgunShell','rocketAmmo','medkit','stim','doctorBag','antibiotics','ore','wood','scrap','oil','silver','trophy','water','pickaxe','axe','handPump','repairKit']);

function serverArmorValue(p = {}) {
  const eq = p.equipment || {};
  let v = 0;
  if (eq.armor === 'leather') v += 3;
  if (eq.armor === 'combatArmor') v += 8;
  if (eq.helmet) v += 2;
  return v;
}
function clampPlayerHp(value, maxHp = 100) {
  const max = clamp(Number(maxHp || 100), 1, 9999);
  return clamp(Number(value ?? max), 0, max);
}
function playerSpawnWorld(locationId = 'settlement', key = 'spawn') {
  const loc = LOCATIONS[normalizeLocationId(locationId)] || LOCATIONS.settlement;
  const spawn = loc[key] || loc.spawn || LOCATIONS.settlement.spawn;
  return tileToWorld(spawn.tx, spawn.tz);
}

function rngFactory(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function roomIndex(room) { return Math.max(1, Number(String(room?.id || '').split('#')[1]) || 1); }
function roomLocation(room) { return LOCATIONS[normalizeLocationId(room?.locationId)] || LOCATIONS.settlement; }
const LOCATION_PVP_MODES = new Set(['peaceful', 'pvp', 'pvpFullDrop']);
function normalizeLocationPvpMode(input, safeFallback = true) {
  if (typeof input === 'boolean') return input ? 'pvp' : (safeFallback ? 'peaceful' : 'pvp');
  const raw = String(input || '').trim();
  if (LOCATION_PVP_MODES.has(raw)) return raw;
  const low = raw.toLowerCase();
  if (['peace', 'safe', 'safezone', 'no_pvp', 'nopvp', 'noncombat', 'social'].includes(low)) return 'peaceful';
  if (['pvpfulldrop', 'fullpvp', 'fulldrop', 'full_drop', 'pvp-full-drop', 'pvp_full_drop'].includes(low)) return 'pvpFullDrop';
  if (['pvp', 'danger', 'dangerous', 'unsafe', 'true', 'combat'].includes(low)) return 'pvp';
  return safeFallback ? 'peaceful' : 'pvp';
}
function locationPvpMode(loc = {}) {
  return normalizeLocationPvpMode(loc.pvpMode || loc.pvpType || loc.combatMode || loc.pvp, loc.safe !== false);
}
function locationAllowsPvp(loc = {}) { return locationPvpMode(loc) !== 'peaceful'; }
function locationAllowsNpcCombat(loc = {}) { return locationPvpMode(loc) !== 'peaceful'; }
function tileToWorld(tx, tz) { return { x: (tx - MAP_W / 2 + 0.5) * TILE, z: (tz - MAP_H / 2 + 0.5) * TILE }; }
function worldToTile(x, z) { return { tx: Math.floor(x / TILE + MAP_W / 2), tz: Math.floor(z / TILE + MAP_H / 2) }; }
function inBounds(tx, tz) { return tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H; }
function solidTileValue(v) { return v === TILE_TYPES.TREE || v === TILE_TYPES.WATER || v === TILE_TYPES.ORE || v === TILE_TYPES.WOOD || v === TILE_TYPES.OIL; }
function isRoomWalkableTile(room, tx, tz) { return inBounds(tx, tz) && Array.isArray(room.map[tz]) && !solidTileValue(room.map[tz][tx]); }
function isRoomWalkableWorld(room, x, z, radius = 0.35) {
  const samples = [[x - radius, z - radius], [x + radius, z - radius], [x - radius, z + radius], [x + radius, z + radius], [x, z]];
  return samples.every(([sx, sz]) => { const t = worldToTile(sx, sz); return isRoomWalkableTile(room, t.tx, t.tz); });
}


// ===== Enemy perception helpers =====
// Movement, vision and bullets are separate systems. Water blocks walking only.
// Trees block vision/fire. Low cover (rock/ore/wood/ruin) blocks discovery only
// when the target is crouched directly behind it relative to the observer.
const ENEMY_VISION_RANGE = 16;
const ENEMY_HEARING_SHOT_RANGE = 24;
const ENEMY_HEARING_HARVEST_RANGE = 11;
const ENEMY_MEMORY_MS = 5200;
const ENEMY_INVESTIGATE_MS = 6500;
const ENEMY_SENSE_INTERVAL_MS = 260;

function roomTileValue(room, tx, tz) {
  if (!room || !Array.isArray(room.map) || !inBounds(tx, tz) || !Array.isArray(room.map[tz])) return null;
  return room.map[tz][tx];
}
function isRoomFullVisionBlocker(room, tx, tz) {
  const v = roomTileValue(room, tx, tz);
  if (v === null) return true;
  return v === TILE_TYPES.TREE;
}
function isRoomLowCoverTile(room, tx, tz) {
  const v = roomTileValue(room, tx, tz);
  return v === TILE_TYPES.ROCK || v === TILE_TYPES.ORE || v === TILE_TYPES.WOOD || v === TILE_TYPES.RUIN || v === TILE_TYPES.OIL;
}
function lineTilesBetweenRoom(startTx, startTz, endTx, endTz) {
  const tiles = [];
  let x0 = startTx;
  let z0 = startTz;
  const x1 = endTx;
  const z1 = endTz;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  while (true) {
    if (x0 === x1 && z0 === z1) return tiles;
    const e2 = err * 2;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
    if (!inBounds(x0, z0)) return tiles;
    tiles.push({ tx: x0, tz: z0 });
  }
}
function isCrouchedTargetHiddenBehindLowCover(room, sx, sz, tx, tz) {
  if (sx === tx && sz === tz) return false;
  const line = lineTilesBetweenRoom(sx, sz, tx, tz);
  for (let i = 0; i < line.length; i++) {
    const tile = line[i];
    if (tile.tx === tx && tile.tz === tz) return false;
    if (!isRoomLowCoverTile(room, tile.tx, tile.tz)) continue;
    const next = line[i + 1];
    if (next && next.tx === tx && next.tz === tz) return true;
  }
  return false;
}
function roomHasHighLineOfSight(room, fromX, fromZ, toX, toZ) {
  const start = worldToTile(fromX, fromZ);
  const end = worldToTile(toX, toZ);
  if (!inBounds(start.tx, start.tz) || !inBounds(end.tx, end.tz)) return false;
  const line = lineTilesBetweenRoom(start.tx, start.tz, end.tx, end.tz);
  for (const tile of line) {
    if (tile.tx === end.tx && tile.tz === end.tz) return true;
    if (isRoomFullVisionBlocker(room, tile.tx, tile.tz)) return false;
  }
  return true;
}
function enemyCanSeePlayer(room, enemy, p, now = Date.now()) {
  if (!room || !enemy || !p || p.dead || Number(p.hp || 0) <= 0) return false;
  const d = Math.hypot(Number(p.x || 0) - Number(enemy.x || 0), Number(p.z || 0) - Number(enemy.z || 0));
  if (d > ENEMY_VISION_RANGE) return false;
  if (!roomHasHighLineOfSight(room, enemy.x, enemy.z, p.x, p.z)) return false;
  if (p.crouching) {
    const a = worldToTile(enemy.x, enemy.z);
    const b = worldToTile(p.x, p.z);
    if (isCrouchedTargetHiddenBehindLowCover(room, a.tx, a.tz, b.tx, b.tz)) return false;
  }
  // Очень близко моб всё равно замечает игрока: это убирает странные случаи,
  // когда игрок сидит прямо в упор за краем маленького камня.
  if (d < 1.7) return true;
  return true;
}
function chooseVisibleEnemyTarget(room, enemy, candidates, now = Date.now()) {
  let best = null;
  let bestScore = Infinity;
  for (const p of candidates) {
    const d = Math.hypot(Number(p.x || 0) - Number(enemy.x || 0), Number(p.z || 0) - Number(enemy.z || 0));
    if (d > ENEMY_VISION_RANGE) continue;
    if (!enemyCanSeePlayer(room, enemy, p, now)) continue;
    if (d < bestScore) { bestScore = d; best = p; }
  }
  return { target: best, distance: bestScore };
}

function enemyTravelAwareInvestigateUntil(enemy, fromX, fromZ, toX, toZ, now = Date.now(), extraMs = ENEMY_NOISE_ARRIVAL_SEARCH_MS) {
  const speed = Math.max(0.45, Number(enemy?.speed || 1.8) * 0.72);
  const distance = Math.hypot(Number(toX || 0) - Number(fromX || 0), Number(toZ || 0) - Number(fromZ || 0));
  const travelMs = Math.ceil((distance / speed) * 1000);
  const baseMs = enemyInvestigateMs(enemy);
  const planned = now + Math.max(baseMs, travelMs + extraMs);
  return Math.min(now + ENEMY_NOISE_MAX_INVESTIGATE_MS, planned);
}
function extendEnemyInvestigationWithoutRetarget(enemy, until, now = Date.now()) {
  if (!enemy) return;
  const startedAt = Number(enemy.investigateStartedAt || enemy.lastNoiseAt || now);
  const capped = Math.min(Number(until || now), startedAt + ENEMY_NOISE_MAX_INVESTIGATE_MS);
  enemy.investigateUntil = Math.max(Number(enemy.investigateUntil || 0), capped);
}
function forceEnemyInvestigatePoint(room, enemy, x, z, now = Date.now(), opts = {}) {
  if (!room || !enemy || enemy.dead) return;
  const px = Number(x || 0);
  const pz = Number(z || 0);
  const investigate = chooseNoiseInvestigationPoint(room, px, pz, enemy);
  const shift = Number.isFinite(Number(enemy.investigateX)) && Number.isFinite(Number(enemy.investigateZ))
    ? Math.hypot(Number(enemy.investigateX) - investigate.x, Number(enemy.investigateZ) - investigate.z)
    : Infinity;
  enemy.aiState = 'investigate';
  enemy.targetId = '';
  enemy.investigateX = investigate.x;
  enemy.investigateZ = investigate.z;
  enemy.lastKnownX = investigate.x;
  enemy.lastKnownZ = investigate.z;
  enemy.lastNoiseAt = now;
  if (!Number(enemy.investigateStartedAt || 0) || opts.restart) enemy.investigateStartedAt = now;
  const extraMs = Number.isFinite(Number(opts.extraMs)) ? Number(opts.extraMs) : ENEMY_NOISE_ARRIVAL_SEARCH_MS;
  enemy.investigateUntil = enemyTravelAwareInvestigateUntil(enemy, enemy.x, enemy.z, investigate.x, investigate.z, now, extraMs);
  enemy.lastNoiseType = String(opts.type || enemy.lastNoiseType || 'noise').slice(0, 24);
  enemy.lastNoiseSourceId = String(opts.sourceId || enemy.lastNoiseSourceId || '').slice(0, 64);
  enemy.noiseLockUntil = now + Math.max(ENEMY_NOISE_RETARGET_LOCK_MS, 4200);
  enemy.nextNoiseRetargetAt = enemy.noiseLockUntil;
  enemy.noiseCooldownUntil = 0;
  enemy.wanderTimer = 0;
  if (shift > 0.7) invalidateEnemyPath(enemy);
}
function aggroEnemyFromHit(room, enemy, player, now = Date.now()) {
  if (!room || !enemy || !player || enemy.dead || player.dead) return;
  const canSee = enemyCanSeePlayer(room, enemy, player, now);
  enemy.noiseCooldownUntil = 0;
  enemy.lastKnownX = Number(player.x || 0);
  enemy.lastKnownZ = Number(player.z || 0);
  enemy.lastNoiseAt = now;
  enemy.lastNoiseType = 'combat';
  enemy.lastNoiseSourceId = String(player.id || player.characterId || '').slice(0, 64);
  if (canSee) {
    enemy.targetId = player.id;
    enemy.aiState = 'chase';
    enemy.lastSenseAt = now;
    enemy.investigateX = null;
    enemy.investigateZ = null;
    enemy.investigateStartedAt = 0;
    enemy.investigateUntil = 0;
    invalidateEnemyPath(enemy);
    return;
  }
  forceEnemyInvestigatePoint(room, enemy, player.x, player.z, now, {
    type: 'combat',
    sourceId: player.id || player.characterId || '',
    extraMs: ENEMY_HIT_AGGRO_SEARCH_MS,
    restart: true
  });
}

function addRoomNoise(room, x, z, radius = ENEMY_HEARING_SHOT_RANGE, sourceId = '', type = 'noise') {
  if (!room || !room.enemies || !room.sockets.size) return;
  const now = Date.now();
  const nx = Number(x || 0);
  const nz = Number(z || 0);
  for (const enemy of room.enemies.values()) {
    if (!enemy || enemy.dead) continue;
    const d = Math.hypot(nx - Number(enemy.x || 0), nz - Number(enemy.z || 0));
    if (d > radius) continue;
    // Видимую цель слух не должен сбивать. Шум нужен именно для расследования.
    if (enemy.aiState === 'chase' && now - Number(enemy.lastSenseAt || 0) < 1400) continue;
    enemy.aiState = 'investigate';
    enemy.targetId = '';
    enemy.investigateX = nx;
    enemy.investigateZ = nz;
    enemy.lastKnownX = nx;
    enemy.lastKnownZ = nz;
    enemy.lastNoiseAt = now;
    enemy.lastNoiseType = String(type || 'noise').slice(0, 24);
    enemy.lastNoiseSourceId = String(sourceId || '').slice(0, 64);
    enemy.wanderTimer = 0;
  }
}
function clearEnemyTarget(enemy) {
  if (!enemy) return;
  enemy.targetId = '';
  enemy.aiState = 'idle';
  enemy.lastKnownX = null;
  enemy.lastKnownZ = null;
  enemy.investigateX = null;
  enemy.investigateZ = null;
  invalidateEnemyPath(enemy);
}
function enemyPathKey(tx, tz) { return `${tx},${tz}`; }
function invalidateEnemyPath(enemy) {
  if (!enemy) return;
  enemy.path = null;
  enemy.pathIndex = 0;
  enemy.pathGoalKey = '';
  enemy.nextPathAt = 0;
  enemy.pathStuckSince = 0;
}
function findNearestWalkablePathTile(room, tx, tz, maxRadius = 8) {
  tx = Math.round(Number(tx || 0));
  tz = Math.round(Number(tz || 0));
  if (isRoomWalkableTile(room, tx, tz)) return { tx, tz };
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!isRoomWalkableTile(room, nx, nz)) continue;
        const d = Math.hypot(dx, dz);
        if (d < bestD) { bestD = d; best = { tx: nx, tz: nz }; }
      }
    }
    if (best) return best;
  }
  return null;
}
function canEnemyUseDiagonalStep(room, tx, tz, nx, nz) {
  const dx = nx - tx;
  const dz = nz - tz;
  if (Math.abs(dx) !== 1 || Math.abs(dz) !== 1) return true;
  // Запрещаем срезать угол между водой/деревом/камнем. Иначе моб визуально
  // пытается протиснуться через диагональную щель и снова выглядит застрявшим.
  return isRoomWalkableTile(room, tx + dx, tz) && isRoomWalkableTile(room, tx, tz + dz);
}
function enemyBodyRadius(enemy) {
  return Math.max(0.36, Math.min(0.78, Number(enemy?.scale || 1) * 0.42));
}
function isEnemyBodyBlockedAt(room, enemy, x, z) {
  if (!room || !room.enemies || !enemy) return false;
  const nx = Number(x);
  const nz = Number(z);
  if (!Number.isFinite(nx) || !Number.isFinite(nz)) return true;
  const ownRadius = enemyBodyRadius(enemy);
  const currentX = Number(enemy.x || 0);
  const currentZ = Number(enemy.z || 0);
  for (const other of room.enemies.values()) {
    if (!other || other === enemy || other.dead) continue;
    const ox = Number(other.x || 0);
    const oz = Number(other.z || 0);
    if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
    const minDist = (ownRadius + enemyBodyRadius(other)) * 0.92;
    const nextDist = Math.hypot(nx - ox, nz - oz);
    if (nextDist >= minDist) continue;
    const currentDist = Math.hypot(currentX - ox, currentZ - oz);
    if (nextDist <= currentDist + 0.015) return true;
  }
  return false;
}
function isEnemyStepOpen(room, enemy, x, z, radius = 0.32) {
  return isRoomWalkableWorld(room, x, z, radius) && !isEnemyBodyBlockedAt(room, enemy, x, z);
}
function findEnemyGridPath(room, startTx, startTz, goalTx, goalTz) {
  const start = findNearestWalkablePathTile(room, startTx, startTz, 3);
  const goal = findNearestWalkablePathTile(room, goalTx, goalTz, 8);
  if (!start || !goal) return null;
  if (start.tx === goal.tx && start.tz === goal.tz) return [];
  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]
  ];
  const startKey = enemyPathKey(start.tx, start.tz);
  const goalKey = enemyPathKey(goal.tx, goal.tz);
  const open = [{ tx: start.tx, tz: start.tz, key: startKey, f: Math.hypot(goal.tx - start.tx, goal.tz - start.tz) }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();
  let iterations = 0;
  while (open.length && iterations++ < 900) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    if (!current || closed.has(current.key)) continue;
    if (current.key === goalKey) {
      const out = [];
      let key = current.key;
      while (key && key !== startKey) {
        const [x, z] = key.split(',').map(Number);
        out.push({ tx: x, tz: z, ...tileToWorld(x, z) });
        key = cameFrom.get(key);
      }
      out.reverse();
      return out;
    }
    closed.add(current.key);
    const baseG = gScore.get(current.key) ?? Infinity;
    for (const [dx, dz, cost] of dirs) {
      const nx = current.tx + dx;
      const nz = current.tz + dz;
      if (!isRoomWalkableTile(room, nx, nz)) continue;
      if (!canEnemyUseDiagonalStep(room, current.tx, current.tz, nx, nz)) continue;
      const key = enemyPathKey(nx, nz);
      if (closed.has(key)) continue;
      const nextG = baseG + cost;
      if (nextG >= (gScore.get(key) ?? Infinity)) continue;
      cameFrom.set(key, current.key);
      gScore.set(key, nextG);
      const h = Math.hypot(goal.tx - nx, goal.tz - nz);
      open.push({ tx: nx, tz: nz, key, f: nextG + h });
    }
  }
  return null;
}
function moveEnemyDirectStep(room, enemy, tx, tz, speed, dt) {
  const dx = Number(tx || 0) - Number(enemy.x || 0);
  const dz = Number(tz || 0) - Number(enemy.z || 0);
  const dist = Math.hypot(dx, dz);
  if (dist <= 0.02) return { dist, moved: false };
  const vx = dx / dist;
  const vz = dz / dist;
  const step = Math.min(speed * dt, dist);
  const nx = enemy.x + vx * step;
  const nz = enemy.z + vz * step;
  let moved = false;
  if (isEnemyStepOpen(room, enemy, nx, enemy.z, 0.32)) { enemy.x = nx; moved = true; }
  if (isEnemyStepOpen(room, enemy, enemy.x, nz, 0.32)) { enemy.z = nz; moved = true; }
  enemy.vx = vx;
  enemy.vz = vz;
  return { dist, moved };
}
function moveEnemyTowards(room, enemy, tx, tz, speed, dt) {
  const targetX = Number(tx || 0);
  const targetZ = Number(tz || 0);
  const distToFinal = Math.hypot(targetX - Number(enemy.x || 0), targetZ - Number(enemy.z || 0));
  if (distToFinal <= 0.02) return distToFinal;

  const now = Date.now();
  const startTile = worldToTile(enemy.x, enemy.z);
  const rawGoalTile = worldToTile(targetX, targetZ);
  const goalTile = findNearestWalkablePathTile(room, rawGoalTile.tx, rawGoalTile.tz, 8);
  if (!goalTile) {
    const direct = moveEnemyDirectStep(room, enemy, targetX, targetZ, speed, dt);
    return direct.dist;
  }
  const goalKey = enemyPathKey(goalTile.tx, goalTile.tz);
  const stuckTooLong = enemy.pathStuckSince && now - Number(enemy.pathStuckSince || 0) > 420;
  const needsPath = !Array.isArray(enemy.path) || enemy.pathGoalKey !== goalKey ||
    Number(enemy.pathIndex || 0) >= enemy.path.length || now >= Number(enemy.nextPathAt || 0) || stuckTooLong;
  if (needsPath) {
    enemy.path = findEnemyGridPath(room, startTile.tx, startTile.tz, goalTile.tx, goalTile.tz) || [];
    enemy.pathIndex = 0;
    enemy.pathGoalKey = goalKey;
    enemy.nextPathAt = now + 520 + Math.floor(Math.random() * 90);
    enemy.pathStuckSince = 0;
  }

  let waypoint = null;
  while (Array.isArray(enemy.path) && Number(enemy.pathIndex || 0) < enemy.path.length) {
    const candidate = enemy.path[Number(enemy.pathIndex || 0)];
    if (!candidate) break;
    const d = Math.hypot(candidate.x - enemy.x, candidate.z - enemy.z);
    if (d > 0.28) { waypoint = candidate; break; }
    enemy.pathIndex = Number(enemy.pathIndex || 0) + 1;
  }

  const moveTarget = waypoint || { x: targetX, z: targetZ };
  const result = moveEnemyDirectStep(room, enemy, moveTarget.x, moveTarget.z, speed, dt);
  if (result.moved) {
    enemy.pathStuckSince = 0;
  } else if (!enemy.pathStuckSince) {
    enemy.pathStuckSince = now;
  }
  return distToFinal;
}
function makeServerEntityId(prefix = 'srv') { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function addLootStack(list, id, qty = 1) {
  if (!SERVER_ITEM_IDS.has(id) || qty <= 0) return;
  const existing = list.find(x => x.id === id);
  if (existing) existing.qty += qty; else list.push({ id, qty });
}
function rollEnemyLootServer(room, type) {
  return [];
}
function generateRoomWorld(room) {
  const loc = roomLocation(room);
  const rng = rngFactory((loc.seed || 1) + roomIndex(room) * 9973);
  room.rng = rng;
  room.map = [];
  room.resources.clear();
  const applyWorldExitEdges = () => {
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (x <= 1 || z <= 1 || x >= MAP_W - 2 || z >= MAP_H - 2) room.map[z][x] = TILE_TYPES.PATH;
      }
    }
  };
  for (let z = 0; z < MAP_H; z++) {
    room.map[z] = [];
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || z === 0 || x === MAP_W - 1 || z === MAP_H - 1) {
        room.map[z][x] = TILE_TYPES.PATH;
        continue;
      }
      const darkChance =
        loc.id === 'randomDryBasin' ? 0.20 :
          loc.id === 'scrapTown' ? 0.14 :
            loc.id === 'randomRuinedRoad' ? 0.10 :
              loc.id === 'relayStation' ? 0.09 :
                loc.id === 'randomAshGrove' ? 0.08 : 0.06;
      room.map[z][x] = rng() < darkChance ? TILE_TYPES.DARK : TILE_TYPES.GRASS;
    }
  }
  const midX = Math.floor(MAP_W / 2), midZ = Math.floor(MAP_H / 2);
  if (loc.id === 'settlement') {
    for (let x = 4; x < MAP_W - 4; x++) room.map[midZ][x] = TILE_TYPES.PATH;
    for (let z = 3; z < MAP_H - 3; z++) room.map[z][midX] = TILE_TYPES.PATH;
    for (let z = 15; z <= 24; z++) for (let x = 11; x <= 26; x++) room.map[z][x] = (x >= 14 && x <= 23 && z >= 17 && z <= 22) ? TILE_TYPES.PATH : TILE_TYPES.GRASS;
    [[8,12],[9,12],[10,12],[8,13],[10,13],[27,14],[28,14],[29,14],[27,15],[29,15],[9,27],[10,27],[11,27],[9,28],[11,28],[27,26],[28,26],[29,26],[29,27]].forEach(([x,z]) => { if (inBounds(x,z)) room.map[z][x] = TILE_TYPES.RUIN; });
    [loc.spawn, loc.entryFromWasteland, loc.trader, loc.storage, loc.exit].forEach(p => clearSpawnArea(room, p));
  } else {
    const markPath = (cx, cz, rx = 1, rz = rx) => {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (!inBounds(x, z)) continue;
          const nx = (x - cx) / Math.max(0.1, rx);
          const nz = (z - cz) / Math.max(0.1, rz);
          if (nx * nx + nz * nz <= 1.05) room.map[z][x] = TILE_TYPES.PATH;
        }
      }
    };
    const markLine = (x1, z1, x2, z2, radius = 1) => {
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)) * 2 + 1;
      for (let i = 0; i <= steps; i++) {
        const t = i / Math.max(1, steps);
        markPath(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, radius, radius * 0.72);
      }
    };
    const block = (type, cells) => cells.forEach(([x,z]) => { if (inBounds(x,z)) room.map[z][x] = type; });
    const addResource = (tx, tz, type) => {
      if (!inBounds(tx, tz)) return;
      room.map[tz][tx] = type === 'oil' || type === 'water'
        ? TILE_TYPES.OIL
        : type === 'ore' || type === 'scrap'
          ? TILE_TYPES.ORE
          : TILE_TYPES.WOOD;
      const id = `res_${tx}_${tz}_${type}`;
      room.resources.set(id, { id, tx, tz, type, hp: 3, maxHp: 3 });
    };
    markPath(midX, midZ, 4.2, 3.4);
    markLine(midX, 3, midX, MAP_H - 4, 1.15);
    markLine(3, midZ, MAP_W - 4, midZ, 1.15);
    if (loc.id === 'scrapTown') {
      markLine(19, 25, 16, 19, 1.6);
      markLine(19, 25, 28, 13, 1.0);
      block(TILE_TYPES.RUIN, [[7,10],[8,10],[8,11],[29,10],[30,10],[30,11],[7,27],[8,28],[28,28],[29,28],[31,18],[31,19]]);
      block(TILE_TYPES.ROCK, [[12,13],[25,14],[11,25],[26,24]]);
      [[9,14,'ore'],[29,16,'ore'],[26,29,'ore'],[12,28,'wood'],[31,22,'wood']].forEach(([x,z,type]) => addResource(x,z,type));
    } else if (loc.id === 'relayStation') {
      markLine(19, 25, 22, 18, 1.5);
      markLine(11, 14, 30, 25, 0.85);
      block(TILE_TYPES.RUIN, [[9,12],[10,12],[28,11],[29,11],[7,28],[31,27]]);
      block(TILE_TYPES.ROCK, [[12,10],[30,18],[9,24],[26,30]]);
      [[8,16,'ore'],[29,25,'ore'],[12,29,'wood'],[32,14,'wood']].forEach(([x,z,type]) => addResource(x,z,type));
    } else if (loc.id === 'randomAshGrove') {
      markLine(6, 19, 32, 19, 1.0);
      markLine(19, 6, 19, 32, 1.0);
      block(TILE_TYPES.TREE, [[6,8],[9,9],[31,9],[32,28],[7,30],[28,30],[5,23],[33,17]]);
      block(TILE_TYPES.ROCK, [[12,14],[28,16],[15,29]]);
      [[10,26,'wood'],[13,11,'wood'],[24,25,'wood'],[30,12,'wood'],[8,18,'wood'],[21,30,'wood'],[27,20,'ore']].forEach(([x,z,type]) => addResource(x,z,type));
    } else if (loc.id === 'randomDryBasin') {
      markPath(midX, midZ, 7.2, 5.8);
      markLine(8, 30, 30, 9, 0.85);
      block(TILE_TYPES.ROCK, [[8,11],[29,12],[7,25],[31,27],[13,31]]);
      block(TILE_TYPES.RUIN, [[19,10],[26,18]]);
      [[11,16,'ore'],[28,22,'ore'],[21,30,'ore'],[14,27,'wood'],[26,13,'wood']].forEach(([x,z,type]) => addResource(x,z,type));
    } else if (loc.id === 'randomRuinedRoad') {
      for (let i = 3; i < MAP_W - 3; i++) {
        const roadZ = Math.round(8 + i * 0.58 + Math.sin(i * 0.45) * 1.4);
        markPath(i, roadZ, 1.05, 0.85);
      }
      block(TILE_TYPES.RUIN, [[6,16],[7,16],[10,22],[29,15],[31,16],[27,25]]);
      block(TILE_TYPES.ROCK, [[13,13],[22,27],[33,21]]);
      [[9,25,'wood'],[24,12,'ore'],[31,28,'wood'],[15,29,'ore']].forEach(([x,z,type]) => addResource(x,z,type));
    } else if (loc.id === 'wasteland') {
      markLine(19, 32, 19, 8, 1.2);
      markLine(9, 26, 30, 12, 0.85);
      block(TILE_TYPES.TREE, [[6,8],[12,27],[26,8],[33,20],[8,29],[31,12]]);
      block(TILE_TYPES.ROCK, [[9,14],[29,23],[15,31],[24,14]]);
      block(TILE_TYPES.RUIN, [[7,22],[28,12],[30,29]]);
      [[10,10,'wood'],[13,27,'wood'],[25,25,'wood'],[31,18,'wood'],[6,31,'wood'],[27,12,'ore'],[14,24,'ore'],[22,30,'ore'],[17,11,'ore']].forEach(([x,z,type]) => addResource(x,z,type));
    } else {
      block(TILE_TYPES.RUIN, [[8,9],[28,11],[13,27],[29,28]]);
      block(TILE_TYPES.ROCK, [[10,24],[30,18]]);
      [[11,15,'wood'],[27,23,'ore'],[15,29,'wood'],[29,9,'ore']].forEach(([x,z,type]) => addResource(x,z,type));
    }
    [loc.spawn, loc.entryFromSettlement, loc.entryFromWorld, loc.trader, loc.storage, loc.exit].forEach(p => {
      clearSpawnArea(room, p);
      if (!p) return;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = p.tx + dx, z = p.tz + dz;
        if (inBounds(x, z)) {
          room.map[z][x] = TILE_TYPES.PATH;
          for (const [id, r] of room.resources.entries()) if (r.tx === x && r.tz === z) room.resources.delete(id);
        }
      }
    });
  }
  applyWorldExitEdges();
  room.environmentVersion = WORLD_ENVIRONMENT_VERSION;
  room.worldReady = true;
}
function clearSpawnArea(room, p) {
  if (!p) return;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = p.tx + dx, z = p.tz + dz;
    if (inBounds(x, z)) {
      const old = room.map[z][x];
      room.map[z][x] = TILE_TYPES.PATH;
      if (old === TILE_TYPES.ORE || old === TILE_TYPES.WOOD || old === TILE_TYPES.OIL) {
        for (const [id, r] of room.resources.entries()) if (r.tx === x && r.tz === z) room.resources.delete(id);
      }
    }
  }
}
function ensureRoomWorld(room) {
  if (!room) return;
  if (room.worldReady && room.environmentVersion === WORLD_ENVIRONMENT_VERSION) return;
  const environmentRebuild = room.worldReady && room.environmentVersion !== WORLD_ENVIRONMENT_VERSION;
  if (environmentRebuild && room.enemies instanceof Map) room.enemies.clear();
  generateRoomWorld(room);
  const loc = roomLocation(room);
  if (!loc.safe && !loc.noRespawn) for (let i = 0; i < (loc.spawnCount || 8); i++) spawnServerEnemy(room);
  refreshRoomWorldState(room);
}
function publicEnemy(e) {
  return {
    id: e.id,
    typeIndex: e.typeIndex,
    name: e.name,
    x: Number(e.x.toFixed(2)),
    z: Number(e.z.toFixed(2)),
    hp: Math.max(0, Math.round(e.hp)),
    maxHp: e.maxHp,
    aiState: e.aiState || (e.dead ? 'dead' : 'idle'),
    dead: !!e.dead,
    loot: e.dead ? (e.loot || []).map(x => ({ id: x.id, qty: x.qty })) : [],
    looted: !!e.looted
  };
}

const CORPSE_LOOT_HOLD_MS = 45000;
const CORPSE_EMPTY_CLEANUP_MS = 500;
const CORPSE_FULL_CLEANUP_MS = 90000;

function serverTouchCorpseLootHold(enemy, playerId = '', now = Date.now()) {
  if (!enemy || !enemy.dead) return false;
  enemy.lastLootInspectAt = now;
  enemy.corpseLootHoldUntil = Math.max(Number(enemy.corpseLootHoldUntil || 0), now + CORPSE_LOOT_HOLD_MS);
  enemy.corpseLootHolderId = String(playerId || '').slice(0, 64);
  return true;
}

function serverReleaseCorpseLootHold(enemy, playerId = '', now = Date.now()) {
  if (!enemy || !enemy.dead) return false;
  const holderId = String(enemy.corpseLootHolderId || '');
  if (holderId && playerId && holderId !== playerId) return false;
  enemy.corpseLootHoldUntil = Math.min(Number(enemy.corpseLootHoldUntil || 0), now);
  enemy.corpseLootHolderId = '';
  return true;
}

function serverCorpseLootIsHeld(enemy, now = Date.now()) {
  return !!(enemy && enemy.dead && Number(enemy.corpseLootHoldUntil || 0) > now);
}

function serverCorpseCleanupAgeMs(enemy, now = Date.now()) {
  return now - Math.max(Number(enemy?.diedAt || now), Number(enemy?.lastLootInspectAt || 0));
}

function serverShouldRemoveCorpse(enemy, now = Date.now()) {
  if (!enemy || !enemy.dead || serverCorpseLootIsHeld(enemy, now)) return false;
  const ageMs = serverCorpseCleanupAgeMs(enemy, now);
  return enemy.looted ? ageMs > CORPSE_EMPTY_CLEANUP_MS : ageMs > CORPSE_FULL_CLEANUP_MS;
}

function publicWorldState(room, includeMap = true) {
  ensureRoomWorld(room);
  return {
    locationId: room.locationId,
    map: includeMap ? room.map.map(row => row.slice()) : undefined,
    resources: [...room.resources.values()].map(r => ({ id: r.id, tx: r.tx, tz: r.tz, type: r.type, hp: r.hp, maxHp: r.maxHp })),
    enemies: [...room.enemies.values()].map(publicEnemy),
    environmentVersion: WORLD_ENVIRONMENT_VERSION,
    updatedAt: Date.now(),
    serverAuthoritative: true
  };
}
function refreshRoomWorldState(room) { room.worldState = publicWorldState(room, true); }
function livePlayersInRoom(room) { return [...players.values()].filter(p => p.roomId === room.id && socketIsLive(p.id)); }
function aliveEnemyCount(room) { let n = 0; for (const e of room.enemies.values()) if (!e.dead) n++; return n; }
function serverRespawnPlayer(p, oldRoom, cause = {}) {
  if (!p || !p.id) return;
  const socket = io.sockets.sockets.get(p.id);
  const now = Date.now();
  const settlement = chooseRoomForLocation('settlement');
  const pos = playerSpawnWorld('settlement', 'spawn');

  if (oldRoom && oldRoom.id !== settlement.id) {
    oldRoom.sockets.delete(p.id);
    if (socket) {
      try { socket.leave(oldRoom.id); } catch (_) {}
    }
    io.to(oldRoom.id).emit('playerLeft', { id: p.id, characterId: p.characterId || '', reason: 'deathRespawn' });
  }

  if (socket) {
    try { socket.join(settlement.id); } catch (_) {}
  }
  settlement.sockets.add(p.id);

  p.roomId = settlement.id;
  p.locationId = settlement.locationId;
  p.x = pos.x;
  p.z = pos.z;
  p.input = { forward: 0, right: 0 };
  p.maxHp = clamp(Number(p.maxHp || 100), 1, 9999);
  p.hp = Math.ceil(p.maxHp * 0.55);
  p.dead = false;
  p.crouching = false;
  p.lastRespawnAt = now;
  p.lastServerDamageAt = now;

  ensureRoomWorld(settlement);
  refreshRoomWorldState(settlement);
  const others = [...players.values()].filter(v => v.roomId === settlement.id && v.id !== p.id).map(publicPlayer);
  socket?.emit('serverRespawn', {
    ok: true,
    reason: 'death',
    cause,
    roomId: settlement.id,
    locationId: settlement.locationId,
    x: Number(p.x.toFixed(2)),
    z: Number(p.z.toFixed(2)),
    hp: p.hp,
    maxHp: p.maxHp,
    players: others,
    worldState: settlement.worldState || publicWorldState(settlement, true),
    serverAuthoritativeEnemies: true,
    t: now
  });
  socket?.to(settlement.id).emit('playerJoined', publicPlayer(p));
  emitEnemySnapshot(settlement, true);
}

function spawnServerEnemy(room) {
  ensureRoomWorld(room);
  const loc = roomLocation(room);
  if (loc.safe || loc.noRespawn || aliveEnemyCount(room) >= (loc.enemyCap || 12)) return null;
  const rng = room.rng || Math.random;
  const typeIndex = Math.floor(rng() * SERVER_ENEMY_TYPES.length);
  const type = SERVER_ENEMY_TYPES[typeIndex] || SERVER_ENEMY_TYPES[0];
  const roomPlayers = livePlayersInRoom(room);
  let chosen = null;
  for (let tries = 0; tries < 160; tries++) {
    const tx = 2 + Math.floor(rng() * (MAP_W - 4));
    const tz = 2 + Math.floor(rng() * (MAP_H - 4));
    if (!isRoomWalkableTile(room, tx, tz)) continue;
    const pos = tileToWorld(tx, tz);
    const farEnough = roomPlayers.every(p => Math.hypot(pos.x - p.x, pos.z - p.z) > 12);
    if (farEnough || tries > 120) { chosen = pos; break; }
  }
  if (!chosen) return null;
  const enemy = {
    ...type,
    id: makeServerEntityId('enemy'),
    typeIndex,
    x: chosen.x,
    z: chosen.z,
    hp: type.hp,
    maxHp: type.hp,
    dead: false,
    attackTimer: 0.6 + rng() * 0.9,
    wanderTimer: 0,
    vx: 0,
    vz: 0,
    aiState: 'idle',
    targetId: '',
    lastKnownX: null,
    lastKnownZ: null,
    investigateX: null,
    investigateZ: null,
    lastSenseAt: 0,
    nextSenseAt: Date.now() + Math.floor(rng() * ENEMY_SENSE_INTERVAL_MS),
    lastNoiseAt: 0,
    path: null,
    pathIndex: 0,
    pathGoalKey: '',
    nextPathAt: 0,
    pathStuckSince: 0,
    loot: rollEnemyLootServer(room, type),
    looted: false,
    diedAt: 0,
    lastLootInspectAt: 0,
    corpseLootHoldUntil: 0,
    corpseLootHolderId: ''
  };
  room.enemies.set(enemy.id, enemy);
  return enemy;
}
function updateServerEnemies(room, dt) {
  ensureRoomWorld(room);
  const loc = roomLocation(room);
  if (loc.safe) return;
  const roomPlayers = livePlayersInRoom(room).filter(p => Number(p.hp || 1) > 0 && !p.dead);
  room.enemySpawnTimer += dt;
  if (!loc.noRespawn && room.enemySpawnTimer >= 2.0) {
    room.enemySpawnTimer = 0;
    while (aliveEnemyCount(room) < (loc.enemyCap || 12)) spawnServerEnemy(room);
  }
  const rng = room.rng || Math.random;
  const now = Date.now();
  for (const enemy of [...room.enemies.values()]) {
    if (enemy.dead) {
      if (serverShouldRemoveCorpse(enemy, now)) room.enemies.delete(enemy.id);
      continue;
    }

    let visibleTarget = null;
    let visibleDistance = Infinity;
    if (!enemy.nextSenseAt || now >= Number(enemy.nextSenseAt || 0)) {
      enemy.nextSenseAt = now + ENEMY_SENSE_INTERVAL_MS + Math.floor(rng() * 90);
      const sensed = chooseVisibleEnemyTarget(room, enemy, roomPlayers, now);
      visibleTarget = sensed.target;
      visibleDistance = sensed.distance;
      if (visibleTarget) {
        enemy.targetId = visibleTarget.id;
        enemy.aiState = 'chase';
        enemy.lastKnownX = visibleTarget.x;
        enemy.lastKnownZ = visibleTarget.z;
        enemy.lastSenseAt = now;
        enemy.investigateX = null;
        enemy.investigateZ = null;
      }
    } else if (enemy.targetId) {
      const oldTarget = roomPlayers.find(p => p.id === enemy.targetId);
      if (oldTarget && enemyCanSeePlayer(room, enemy, oldTarget, now)) {
        visibleTarget = oldTarget;
        visibleDistance = Math.hypot(oldTarget.x - enemy.x, oldTarget.z - enemy.z);
        enemy.aiState = 'chase';
        enemy.lastKnownX = oldTarget.x;
        enemy.lastKnownZ = oldTarget.z;
        enemy.lastSenseAt = now;
      }
    }

    let target = visibleTarget;
    if (!target && enemy.targetId) {
      const remembered = roomPlayers.find(p => p.id === enemy.targetId);
      if (remembered && now - Number(enemy.lastSenseAt || 0) <= ENEMY_MEMORY_MS) {
        target = remembered;
      } else if (now - Number(enemy.lastSenseAt || 0) > ENEMY_MEMORY_MS) {
        enemy.targetId = '';
        if (enemy.aiState === 'chase') enemy.aiState = 'investigate';
      }
    }

    const hasFreshTarget = !!(target && enemy.targetId && now - Number(enemy.lastSenseAt || 0) <= ENEMY_MEMORY_MS);
    if (hasFreshTarget && target) {
      const chaseX = visibleTarget ? target.x : Number(enemy.lastKnownX ?? target.x);
      const chaseZ = visibleTarget ? target.z : Number(enemy.lastKnownZ ?? target.z);
      const distToTarget = Math.hypot(target.x - enemy.x, target.z - enemy.z);
      const canAttack = visibleTarget && visibleDistance <= 1.35;
      if (!canAttack) {
        enemy.attackTimer = Math.max(0.25, Number(enemy.attackTimer || 0.5));
        moveEnemyTowards(room, enemy, chaseX, chaseZ, enemy.speed, dt);
        if (!visibleTarget && Math.hypot(chaseX - enemy.x, chaseZ - enemy.z) < 0.8) {
          enemy.aiState = 'investigate';
          enemy.investigateX = chaseX;
          enemy.investigateZ = chaseZ;
          enemy.targetId = '';
        }
      } else {
        enemy.aiState = 'attack';
        enemy.attackTimer -= dt;
        if (enemy.attackTimer <= 0) {
          enemy.attackTimer = 1.25;
          const raw = Math.max(1, Number(enemy.atk || 1));
          const damage = Math.max(1, raw - serverArmorValue(target));
          target.maxHp = clamp(Number(target.maxHp || 100), 1, 9999);
          target.hp = Math.max(0, Number(target.hp || target.maxHp) - damage);
          target.lastServerDamageAt = now;
          io.to(target.id).emit('enemyAttack', {
            locationId: room.locationId,
            enemyId: enemy.id,
            enemyName: enemy.name,
            raw,
            damage,
            hp: Math.round(target.hp),
            maxHp: Math.round(target.maxHp),
            x: Number(enemy.x.toFixed(2)),
            z: Number(enemy.z.toFixed(2)),
            t: now
          });
          io.to(room.id).emit('playerDamaged', {
            playerId: target.id,
            characterId: target.characterId || '',
            enemyId: enemy.id,
            enemyName: enemy.name,
            damage,
            hp: Math.round(target.hp),
            maxHp: Math.round(target.maxHp),
            t: now
          });
          if (target.hp <= 0 && !target.dead) {
            target.dead = true;
            clearEnemyTarget(enemy);
            serverRespawnPlayer(target, room, { enemyId: enemy.id, enemyName: enemy.name });
          }
        }
      }
      continue;
    }

    const investigating = Number.isFinite(Number(enemy.investigateX)) && Number.isFinite(Number(enemy.investigateZ)) &&
      now - Number(enemy.lastNoiseAt || enemy.lastSenseAt || now) <= ENEMY_INVESTIGATE_MS;
    if (investigating) {
      enemy.aiState = 'investigate';
      const d = moveEnemyTowards(room, enemy, Number(enemy.investigateX), Number(enemy.investigateZ), enemy.speed * 0.72, dt);
      if (d < 0.75) {
        enemy.investigateX = null;
        enemy.investigateZ = null;
        enemy.aiState = 'idle';
        enemy.wanderTimer = 0;
      }
      continue;
    }

    enemy.aiState = 'idle';
    enemy.wanderTimer -= dt;
    if (enemy.wanderTimer <= 0) {
      enemy.wanderTimer = 1.8 + rng() * 2.6;
      const a = rng() * Math.PI * 2;
      enemy.vx = Math.cos(a);
      enemy.vz = Math.sin(a);
    }
    const speed = enemy.speed * 0.28;
    const nx = enemy.x + (enemy.vx || 0) * speed * dt;
    const nz = enemy.z + (enemy.vz || 0) * speed * dt;
    let moved = false;
    if (isEnemyStepOpen(room, enemy, nx, enemy.z, 0.32)) { enemy.x = nx; moved = true; }
    if (isEnemyStepOpen(room, enemy, enemy.x, nz, 0.32)) { enemy.z = nz; moved = true; }
    if (!moved) enemy.wanderTimer = 0;
  }
}
function emitEnemySnapshot(room, force = false) {
  if (!room || !room.sockets.size) return;
  const now = Date.now();
  if (!force && now - Number(room.lastEnemySnapshotAt || 0) < 80) return;
  room.lastEnemySnapshotAt = now;
  io.to(room.id).emit('enemySnapshot', { locationId: room.locationId, t: now, enemies: [...room.enemies.values()].map(publicEnemy) });
}
function mergeResourceSnapshots(room, resources) {
  ensureRoomWorld(room);
  if (!Array.isArray(resources)) return;
  for (const r of resources) {
    const id = String(r.id || `res_${Number(r.tx)||0}_${Number(r.tz)||0}_${String(r.type || 'node')}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const tx = clamp(Number(r.tx || 0), 0, MAP_W - 1);
    const tz = clamp(Number(r.tz || 0), 0, MAP_H - 1);
    const type = String(r.type || 'wood').slice(0, 16);
    const hp = clamp(Number(r.hp ?? 0), 0, 999);
    const maxHp = clamp(Number(r.maxHp ?? 3), 1, 999);
    if (!id) continue;
    room.resources.set(id, { id, tx, tz, type, hp, maxHp });
    if (room.map[tz]) {
      if (hp <= 0) room.map[tz][tx] = TILE_TYPES.GRASS;
      else room.map[tz][tx] = type === 'oil' || type === 'water'
        ? TILE_TYPES.OIL
        : type === 'ore' || type === 'scrap'
          ? TILE_TYPES.ORE
          : TILE_TYPES.WOOD;
    }
  }
  refreshRoomWorldState(room);
}
function sanitizeLootRequest(data) {
  const requested = Array.isArray(data.requested) ? data.requested.slice(0, 32).map(x => ({ id: String(x.id || '').slice(0, 64), qty: clamp(Number(x.qty || 0), 0, 9999) })).filter(x => x.id && x.qty > 0) : [];
  const itemId = String(data.itemId || '').slice(0, 64);
  const qty = clamp(Number(data.qty || 9999), 1, 9999);
  if (requested.length) return requested;
  if (itemId) return [{ id: itemId, qty }];
  return [];
}

function getOrCreateRoom(roomId = 'settlement', locationId = '') {
  const loc = normalizeLocationId(locationId || String(roomId || '').split('#')[0] || 'settlement');
  const id = roomIdFor(loc);
  if (!rooms.has(id)) {
    rooms.set(id, {
      id,
      locationId: loc,
      sockets: new Set(),
      enemies: new Map(),
      resources: new Map(),
      map: [],
      rng: null,
      worldReady: false,
      worldState: null,
      enemySpawnTimer: 0,
      lastEnemySnapshotAt: 0,
      createdAt: Date.now()
    });
  }
  const room = rooms.get(id);
  ensureRoomWorld(room);
  return room;
}

function chooseRoomForLocation(locationId) {
  const loc = normalizeLocationId(locationId);
  const room = getOrCreateRoom(roomIdFor(loc), loc);
  for (const sid of [...room.sockets]) if (!socketIsLive(sid)) room.sockets.delete(sid);
  return room;
}

function publicPlayer(p) {
  return {
    id: p.id,
    accountLogin: p.accountLogin || '',
    characterId: p.characterId || '',
    deviceType: normalizeDeviceType(p.deviceType || 'desktop'),
    controlType: normalizeControlType(p.controlType || '', p.deviceType || 'desktop'),
    name: p.name,
    x: Number(p.x.toFixed(2)),
    z: Number(p.z.toFixed(2)),
    angle: Number(p.angle.toFixed(3)),
    crouching: !!p.crouching,
    hp: Math.round(Number(p.hp || 0)),
    maxHp: Math.round(Number(p.maxHp || 100)),
    dead: !!p.dead,
    weapon: p.weapon,
    equipment: sanitizeEquipment(p.equipment, { weapon: p.weapon || 'pistol' }),
    injuries: sanitizeInjuries(p.injuries || {}),
    level: p.level,
    locationId: p.locationId || 'settlement',
    roomId: p.roomId || ''
  };
}

function publicTravelPartyMember(p, leaderId = '') {
  return {
    id: p.id,
    characterId: p.characterId || '',
    name: p.name || 'Игрок',
    leader: p.id === leaderId,
    locationId: p.locationId || 'settlement',
    roomId: p.roomId || ''
  };
}

function nearbyGlobalTravelParty(leader, radius = 8.5) {
  if (!leader || !leader.roomId) return [];
  const out = [];
  for (const p of players.values()) {
    if (!p || !socketIsLive(p.id) || p.dead || Number(p.hp || 0) <= 0) continue;
    if (p.roomId !== leader.roomId) continue;
    const d = Math.hypot(Number(p.x || 0) - Number(leader.x || 0), Number(p.z || 0) - Number(leader.z || 0));
    if (p.id === leader.id || d <= radius) out.push(p);
  }
  out.sort((a, b) => (a.id === leader.id ? -1 : 0) - (b.id === leader.id ? -1 : 0) || String(a.name || '').localeCompare(String(b.name || '')));
  return out;
}

function emitGlobalTravelToParty(session, eventName, payload = {}, includeLeader = false) {
  if (!session || !Array.isArray(session.memberIds)) return;
  for (const memberId of session.memberIds) {
    if (!includeLeader && memberId === session.leaderId) continue;
    const memberSocket = io.sockets.sockets.get(memberId);
    if (memberSocket) memberSocket.emit(eventName, payload);
  }
}

function globalTravelSessionForMember(memberId = '') {
  const id = String(memberId || '');
  if (!id) return null;
  for (const session of globalTravelSessions.values()) {
    if (!session || !Array.isArray(session.memberIds)) continue;
    if (session.memberIds.some(row => String(row || '') === id)) return session;
  }
  return null;
}

function globalTravelMemberIsFollower(memberId = '') {
  const id = String(memberId || '');
  const session = globalTravelSessionForMember(id);
  return !!(session && String(session.leaderId || '') && String(session.leaderId || '') !== id);
}

function cleanupGlobalTravelSessionsForSocket(socketId = '') {
  const id = String(socketId || '');
  if (!id) return;
  for (const [leaderId, session] of [...globalTravelSessions.entries()]) {
    if (!session) {
      globalTravelSessions.delete(leaderId);
      continue;
    }
    if (String(leaderId || '') === id || String(session.leaderId || '') === id) {
      globalTravelSessions.delete(leaderId);
      continue;
    }
    if (Array.isArray(session.memberIds)) {
      session.memberIds = session.memberIds.filter(memberId => String(memberId || '') !== id);
      if (session.memberIds.length <= 0) globalTravelSessions.delete(leaderId);
    }
  }
}

function leaveCurrentRoom(socket) {
  const p = players.get(socket.id);
  if (!p || !p.roomId) return;
  const room = rooms.get(p.roomId);
  if (room) {
    room.sockets.delete(socket.id);
    socket.to(p.roomId).emit('playerLeft', { id: socket.id, characterId: p.characterId || '' });
  }
  socket.leave(p.roomId);
}

function releaseSocketLocks(socket) {
  const p = players.get(socket.id);
  if (!p) return;
  if (p.accountLogin && activeAccountSockets.get(p.accountLogin) === socket.id) activeAccountSockets.delete(p.accountLogin);
  if (p.characterId && activeCharacterSockets.get(p.characterId) === socket.id) activeCharacterSockets.delete(p.characterId);
  if (p.token && usersDb.sessions[p.token] && usersDb.sessions[p.token].activeSocketId === socket.id) {
    usersDb.sessions[p.token].activeSocketId = '';
    usersDb.sessions[p.token].lastSeenAt = Date.now();
    persistUsers();
  }
}

function rejectJoin(socket, ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error });
  socket.emit('sessionRejected', { error });
}

function liveOtherSessionForLogin(login, deviceId, token, currentSocketId = '') {
  pruneStaleSessions(login);
  const now = Date.now();
  for (const [t, session] of Object.entries(usersDb.sessions || {})) {
    if (!session || session.login !== login || t === token) continue;
    if (deviceId && session.deviceId === deviceId) continue;
    if (session.activeSocketId && socketIsLive(session.activeSocketId)) return session;
    if (Number(session.lastSeenAt || 0) > now - SESSION_LOCK_MS) return session;
  }
  const socketId = activeAccountSockets.get(login);
  if (socketId && socketId !== currentSocketId && socketIsLive(socketId)) {
    const p = players.get(socketId);
    if (!deviceId || !p || p.deviceId !== deviceId) return { login, activeSocketId: socketId };
  }
  return null;
}


function sanitizeWorldState(input, locationId = 'settlement') {
  if (!input || typeof input !== 'object') return null;
  const loc = normalizeLocationId(input.locationId || locationId);
  const safeRow = row => Array.isArray(row) ? row.slice(0, 64).map(v => Number.isFinite(Number(v)) ? Number(v) : 0) : [];
  const map = Array.isArray(input.map) ? input.map.slice(0, 64).map(safeRow) : undefined;
  const resources = Array.isArray(input.resources) ? input.resources.slice(0, 256).map(r => ({
    id: String(r.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `res_${Number(r.tx)||0}_${Number(r.tz)||0}`,
    tx: clamp(Number(r.tx || 0), 0, 1000),
    tz: clamp(Number(r.tz || 0), 0, 1000),
    type: String(r.type || 'wood').slice(0, 16),
    hp: clamp(Number(r.hp ?? 0), 0, 999),
    maxHp: clamp(Number(r.maxHp ?? 3), 1, 999)
  })) : undefined;
  // Клиентские enemies больше не принимаются как источник истины. Это поле оставлено
  // только для совместимости с устаревшими HTML, но сервер его не использует.
  const enemies = Array.isArray(input.enemies) ? input.enemies.slice(0, 128).map(e => ({
    id: String(e.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `enemy_${Math.random().toString(36).slice(2,8)}`,
    typeIndex: clamp(Number(e.typeIndex || 0), 0, 99),
    x: clamp(Number(e.x || 0), -MAP_SIZE, MAP_SIZE),
    z: clamp(Number(e.z || 0), -MAP_SIZE, MAP_SIZE),
    hp: clamp(Number(e.hp ?? 0), 0, 10000),
    maxHp: clamp(Number(e.maxHp ?? 1), 1, 10000),
    dead: !!e.dead,
    loot: Array.isArray(e.loot) ? e.loot.slice(0, 64).map(x => ({ id: String(x.id || '').slice(0, 64), qty: clamp(Number(x.qty || 0), 0, 9999) })) : [],
    looted: !!e.looted
  })) : undefined;
  return { locationId: loc, map, resources, enemies, updatedAt: Date.now() };
}

io.on('connection', (socket) => {
  socket.on('join', (data = {}, ack) => {
    const token = String(data.token || data.authToken || '');
    const deviceId = normalizeDeviceId(data.deviceId || '');
    const deviceType = normalizeDeviceType(data.deviceType || socket.handshake?.auth?.deviceType || '');
    const controlType = normalizeControlType(data.controlType || socket.handshake?.auth?.controlType || '', deviceType);
    const auth = getUserByToken(token, deviceId);
    if (!auth) return rejectJoin(socket, ack, 'Не выполнен вход или сессия открыта на другом устройстве.');
    if (liveOtherSessionForLogin(auth.login, deviceId, token, socket.id)) return rejectJoin(socket, ack, 'Этот аккаунт уже авторизован на другом устройстве.');

    const currentSocketId = activeAccountSockets.get(auth.login);
    if (currentSocketId && currentSocketId !== socket.id && socketIsLive(currentSocketId)) {
      return rejectJoin(socket, ack, 'Этот аккаунт уже находится в игре на другом устройстве.');
    }

    const characterId = normalizeCharacterId(data.characterId || data.serverCharacterId || '');
    if (!characterId) return rejectJoin(socket, ack, 'Не выбран персонаж.');
    const lockedSocketId = activeCharacterSockets.get(characterId);
    if (lockedSocketId && lockedSocketId !== socket.id && socketIsLive(lockedSocketId)) {
      return rejectJoin(socket, ack, 'Этот персонаж уже находится в игре на другом устройстве.');
    }

    leaveCurrentRoom(socket);
    const locationId = normalizeLocationId(data.locationId || data.roomId || 'settlement');
    const room = chooseRoomForLocation(locationId);
    socket.join(room.id);
    room.sockets.add(socket.id);

    activeAccountSockets.set(auth.login, socket.id);
    activeCharacterSockets.set(characterId, socket.id);
    auth.session.activeSocketId = socket.id;
    auth.session.deviceType = deviceType;
    auth.session.controlType = controlType;
    auth.session.lastSeenAt = Date.now();
    persistUsers();

    const existing = players.get(socket.id) || {};
    const p = {
      id: socket.id,
      token,
      deviceId,
      deviceType,
      controlType,
      accountLogin: auth.login,
      characterId,
      name: safeName(data.name || auth.login),
      x: clamp(Number(data.x ?? existing.x ?? 0), -MAP_SIZE, MAP_SIZE),
      z: clamp(Number(data.z ?? existing.z ?? 0), -MAP_SIZE, MAP_SIZE),
      angle: Number(data.angle ?? existing.angle ?? 0),
      crouching: !!data.crouching,
      maxHp: clamp(Number(data.maxHp ?? existing.maxHp ?? 100), 1, 9999),
      hp: clampPlayerHp(data.hp ?? existing.hp ?? data.maxHp ?? existing.maxHp ?? 100, data.maxHp ?? existing.maxHp ?? 100),
      dead: false,
      equipment: sanitizeEquipment(data.equipment, existing.equipment || { weapon: data.weapon || existing.weapon || 'pistol' }),
      weapon: sanitizeEquipment(data.equipment, existing.equipment || { weapon: data.weapon || existing.weapon || 'pistol' }).weapon,
      level: Number(data.level ?? existing.level ?? 1),
      injuries: sanitizeInjuries(data.injuries, existing.injuries || {}),
      input: { forward: 0, right: 0 },
      locationId: room.locationId,
      roomId: room.id,
      lastInputAt: Date.now()
    };
    players.set(socket.id, p);

    const others = [...players.values()].filter(v => v.roomId === room.id && v.id !== socket.id).map(publicPlayer);
    refreshRoomWorldState(room);
    if (typeof ack === 'function') ack({ ok: true, id: socket.id, roomId: room.id, locationId: room.locationId, players: others, worldState: room.worldState || publicWorldState(room, true), serverAuthoritativeEnemies: true });
    socket.to(room.id).emit('playerJoined', publicPlayer(p));
    emitEnemySnapshot(room, true);
  });

  socket.on('state', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.x = clamp(Number(data.x ?? p.x), -MAP_SIZE, MAP_SIZE);
    p.z = clamp(Number(data.z ?? p.z), -MAP_SIZE, MAP_SIZE);
    p.angle = Number.isFinite(Number(data.angle)) ? Number(data.angle) : p.angle;
    if (typeof data.crouching !== 'undefined') p.crouching = !!data.crouching;
    if (Number.isFinite(Number(data.maxHp))) p.maxHp = clamp(Number(data.maxHp), 1, 9999);
    if (Number.isFinite(Number(data.hp)) && !p.dead) {
      const incomingHp = clampPlayerHp(data.hp, p.maxHp || 100);
      const recentServerDamage = p.lastServerDamageAt && Date.now() - p.lastServerDamageAt < 900;
      const recentServerHeal = p.lastHealedAt && Date.now() - p.lastHealedAt < 900;
      // После серверного удара не разрешаем старому клиентскому state вернуть HP назад.
      // После серверного лечения не разрешаем старому клиентскому state откатить HP вниз.
      if ((!recentServerDamage || incomingHp <= Number(p.hp || 0) + 0.5) && (!recentServerHeal || incomingHp >= Number(p.hp || 0) - 0.5)) p.hp = incomingHp;
    }
    p.level = Number.isFinite(Number(data.level)) ? Number(data.level) : p.level;
    p.name = safeName(data.name || p.name);
    p.deviceType = normalizeDeviceType(data.deviceType || p.deviceType || 'desktop');
    p.controlType = normalizeControlType(data.controlType || p.controlType || '', p.deviceType);
    p.equipment = sanitizeEquipment(data.equipment, p.equipment || { weapon: data.weapon || p.weapon || 'pistol' });
    p.weapon = p.equipment.weapon || String(data.weapon || p.weapon).slice(0, 32);
    if (data.injuries && typeof data.injuries === 'object') p.injuries = sanitizeInjuries(data.injuries, p.injuries || {});
    p.lastInputAt = Date.now();
    if (p.token && usersDb.sessions[p.token]) usersDb.sessions[p.token].lastSeenAt = Date.now();
  });

  socket.on('input', (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (p.dead) { p.input.forward = 0; p.input.right = 0; return; }
    p.input.forward = clamp(Number(data.forward || 0), -1, 1);
    p.input.right = clamp(Number(data.right || 0), -1, 1);
    p.angle = Number.isFinite(Number(data.angle)) ? Number(data.angle) : p.angle;
    if (typeof data.crouching !== 'undefined') p.crouching = !!data.crouching;
    if (Number.isFinite(Number(data.maxHp))) p.maxHp = clamp(Number(data.maxHp), 1, 9999);
    if (Number.isFinite(Number(data.hp)) && !p.dead) {
      const incomingHp = clampPlayerHp(data.hp, p.maxHp || 100);
      const recentServerDamage = p.lastServerDamageAt && Date.now() - p.lastServerDamageAt < 1200;
      const recentServerHeal = p.lastHealedAt && Date.now() - p.lastHealedAt < 1200;
      // input приходит чаще state, поэтому особенно важно не позволять старому клиентскому HP
      // откатывать серверный урон или серверное лечение назад.
      if ((!recentServerDamage || incomingHp <= Number(p.hp || 0) + 0.5) && (!recentServerHeal || incomingHp >= Number(p.hp || 0) - 0.5)) p.hp = incomingHp;
    }
    p.dead = false;
    if (typeof data.crouching !== 'undefined') p.crouching = !!data.crouching;
    p.deviceType = normalizeDeviceType(data.deviceType || p.deviceType || 'desktop');
    p.controlType = normalizeControlType(data.controlType || p.controlType || '', p.deviceType);
    p.equipment = sanitizeEquipment(data.equipment, p.equipment || { weapon: data.weapon || p.weapon || 'pistol' });
    p.weapon = p.equipment.weapon || String(data.weapon || p.weapon).slice(0, 32);
    if (data.injuries && typeof data.injuries === 'object') p.injuries = sanitizeInjuries(data.injuries, p.injuries || {});
    p.lastInputAt = Date.now();
  });


  socket.on('healPlayer', (data = {}, ack) => {
    const healer = players.get(socket.id);
    const fail = error => { if (typeof ack === 'function') ack({ ok: false, error }); };
    if (!healer || !healer.roomId || healer.dead || Number(healer.hp || 0) <= 0) return fail('Нельзя лечить сейчас.');
    const targetId = String(data.targetId || '').slice(0, 96);
    const target = players.get(targetId);
    if (!target || target.roomId !== healer.roomId) return fail('Игрок не найден рядом.');
    if (target.dead || Number(target.hp || 0) <= 0) return fail('Этого игрока нельзя вылечить.');
    const dist = Math.hypot(Number(target.x || 0) - Number(healer.x || 0), Number(target.z || 0) - Number(healer.z || 0));
    if (dist > 4.25) return fail('Подойдите ближе, чтобы лечить игрока.');
    const itemId = String(data.itemId || 'medkit').slice(0, 32);
    const fallbackAmount = itemId === 'stim' ? 18 : (itemId === 'doctorBag' ? 22 : 35);
    const amount = clamp(Number(data.amount || fallbackAmount), 1, 75);
    const before = clampPlayerHp(target.hp, target.maxHp || 100);
    const maxHp = clamp(Number(target.maxHp || 100), 1, 9999);
    if (before >= maxHp - 0.5) return fail('Игрок уже здоров.');
    target.hp = clampPlayerHp(before + amount, maxHp);
    target.lastHealedAt = Date.now();
    const healed = Math.max(0, Math.round(target.hp - before));
    const payload = {
      roomId: healer.roomId,
      locationId: healer.locationId || target.locationId || 'settlement',
      healerId: healer.id,
      healerName: healer.name || 'Игрок',
      targetId: target.id,
      targetName: target.name || 'Игрок',
      itemId,
      healed,
      hp: Math.round(target.hp),
      maxHp: Math.round(maxHp)
    };
    io.to(healer.roomId).emit('playerHealed', payload);
    if (typeof ack === 'function') ack({ ok: true, ...payload, target: publicPlayer(target) });
  });

  socket.on('globalTravelStart', (data = {}, ack) => {
    const leader = players.get(socket.id);
    const fail = (error, extra = {}) => { if (typeof ack === 'function') ack({ ok: false, error, ...extra }); };
    if (globalTravelMemberIsFollower(socket.id)) {
      const session = globalTravelSessionForMember(socket.id);
      return fail('Маршрут выбирает лидер группы.', { leaderId: session?.leaderId || '', leaderName: session?.leaderName || '' });
    }
    if (!leader || (!leader.roomId && !leader.onGlobalMap) || leader.dead || Number(leader.hp || 0) <= 0) return fail('Лидер группы недоступен.');
    const targetLocationId = normalizeLocationId(data.targetLocationId || 'settlement');
    const fromLocationId = normalizeLocationId(data.fromLocationId || leader.locationId || 'settlement');
    if (!LOCATIONS[targetLocationId]) return fail('Неизвестная точка глобальной карты.');
    const existing = globalTravelSessions.get(socket.id);
    const party = existing?.memberIds?.length
      ? existing.memberIds.map(id => players.get(id)).filter(Boolean)
      : (leader.roomId ? nearbyGlobalTravelParty(leader) : [leader]);
    const session = {
      id: existing?.id || `travel_${socket.id}_${Date.now()}`,
      leaderId: socket.id,
      leaderName: leader.name || 'Игрок',
      fromLocationId,
      targetLocationId,
      memberIds: party.map(p => p.id),
      startedAt: Date.now()
    };
    globalTravelSessions.set(socket.id, session);
    const publicParty = party.map(p => publicTravelPartyMember(p, socket.id));
    const payload = {
      leaderId: socket.id,
      leaderName: session.leaderName,
      fromLocationId,
      targetLocationId,
      party: publicParty,
      startedAt: session.startedAt
    };
    emitGlobalTravelToParty(session, 'globalTravelStarted', payload, false);
    if (typeof ack === 'function') ack({ ok: true, ...payload });
  });

  socket.on('globalTravelEnterWorld', (data = {}, ack) => {
    const leader = players.get(socket.id);
    const fail = (error, extra = {}) => { if (typeof ack === 'function') ack({ ok: false, error, ...extra }); };
    if (globalTravelMemberIsFollower(socket.id)) {
      const session = globalTravelSessionForMember(socket.id);
      return fail('Маршрут выбирает лидер группы.', { leaderId: session?.leaderId || '', leaderName: session?.leaderName || '' });
    }
    if (!leader || !leader.roomId || leader.dead || Number(leader.hp || 0) <= 0) return fail('Игрок недоступен.');
    const fromLocationId = normalizeLocationId(data.fromLocationId || leader.locationId || 'settlement');
    const worldPoint = sanitizeServerGlobalMapPoint(data.worldPoint || data.globalPoint || null);
    const party = nearbyGlobalTravelParty(leader);
    const session = {
      id: `travel_${socket.id}_${Date.now()}`,
      leaderId: socket.id,
      leaderName: leader.name || 'Игрок',
      fromLocationId,
      targetLocationId: fromLocationId,
      worldPoint,
      memberIds: party.map(p => p.id),
      startedAt: Date.now()
    };
    globalTravelSessions.set(socket.id, session);
    const publicParty = party.map(p => publicTravelPartyMember(p, socket.id));
    const payload = {
      leaderId: socket.id,
      leaderName: session.leaderName,
      fromLocationId,
      worldPoint,
      party: publicParty,
      startedAt: session.startedAt
    };
    for (const member of party) {
      const memberSocket = io.sockets.sockets.get(member.id);
      if (!memberSocket) continue;
      leaveCurrentRoom(memberSocket);
      member.roomId = '';
      member.locationId = fromLocationId;
      member.onGlobalMap = true;
    }
    emitGlobalTravelToParty(session, 'globalTravelEnteredWorld', payload, false);
    if (typeof ack === 'function') ack({ ok: true, ...payload });
  });

  socket.on('globalTravelEncounterDecision', (data = {}, ack) => {
    const leader = players.get(socket.id);
    const session = globalTravelSessions.get(socket.id);
    if (!leader || !session) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Маршрут группы не найден.' });
      return;
    }
    const decision = String(data.decision || '').slice(0, 16);
    const pending = !!data.pending;
    const payload = {
      leaderId: socket.id,
      leaderName: leader.name || session.leaderName || 'Игрок',
      pending,
      decision: pending ? '' : (decision === 'enter' ? 'enter' : 'skip'),
      encounterId: String(data.encounterId || '').slice(0, 40),
      title: safeName(data.title || 'Событие мира'),
      targetLocationId: session.targetLocationId
    };
    emitGlobalTravelToParty(session, 'globalTravelEncounterDecision', payload, false);
    if (typeof ack === 'function') ack({ ok: true, ...payload });
  });

  socket.on('globalTravelArrive', (data = {}, ack) => {
    const leader = players.get(socket.id);
    const session = globalTravelSessions.get(socket.id);
    const fail = (error, extra = {}) => { if (typeof ack === 'function') ack({ ok: false, error, ...extra }); };
    if (globalTravelMemberIsFollower(socket.id)) {
      const activeSession = globalTravelSessionForMember(socket.id);
      return fail('Маршрут выбирает лидер группы.', { leaderId: activeSession?.leaderId || '', leaderName: activeSession?.leaderName || '' });
    }
    if (!leader || (!leader.roomId && !leader.onGlobalMap) || leader.dead || Number(leader.hp || 0) <= 0) return fail('Лидер группы недоступен.');
    const targetLocationId = normalizeLocationId(data.targetLocationId || session?.targetLocationId || leader.locationId || 'settlement');
    if (!LOCATIONS[targetLocationId]) return fail('Неизвестная точка глобальной карты.');
    const activeSession = session || {
      leaderId: socket.id,
      leaderName: leader.name || 'Игрок',
      fromLocationId: leader.locationId || 'settlement',
      targetLocationId,
      memberIds: nearbyGlobalTravelParty(leader).map(p => p.id),
      startedAt: Date.now()
    };
    activeSession.targetLocationId = targetLocationId;
    const encounterId = String(data.encounterId || '').slice(0, 40);
    const encounterRoomId = targetLocationId === 'randomEncounter'
      ? `randomEncounter#${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
      : '';
    const payload = {
      leaderId: socket.id,
      leaderName: leader.name || activeSession.leaderName || 'Игрок',
      targetLocationId,
      entryKey: String(data.entryKey || 'entryFromWorld').slice(0, 32),
      encounter: !!data.encounter,
      encounterId,
      encounterRoomId,
      party: activeSession.memberIds.map(id => players.get(id)).filter(Boolean).map(p => publicTravelPartyMember(p, socket.id))
    };
    emitGlobalTravelToParty(activeSession, 'globalTravelArrived', payload, false);
    activeSession.memberIds.forEach(id => {
      const p = players.get(id);
      if (p) p.onGlobalMap = false;
    });
    globalTravelSessions.delete(socket.id);
    if (typeof ack === 'function') ack({ ok: true, ...payload });
  });

  socket.on('shoot', (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room || !locationAllowsNpcCombat(roomLocation(room))) return;
    const shot = {
      shooterId: socket.id,
      characterId: p.characterId || '',
      deviceType: normalizeDeviceType(data.deviceType || p.deviceType || 'desktop'),
      controlType: normalizeControlType(data.controlType || p.controlType || '', p.deviceType || 'desktop'),
      x: p.x,
      z: p.z,
      startX: Number.isFinite(Number(data.startX)) ? Number(data.startX) : null,
      startY: Number.isFinite(Number(data.startY)) ? Number(data.startY) : null,
      startZ: Number.isFinite(Number(data.startZ)) ? Number(data.startZ) : null,
      endX: Number.isFinite(Number(data.endX)) ? Number(data.endX) : null,
      endZ: Number.isFinite(Number(data.endZ)) ? Number(data.endZ) : null,
      angle: Number.isFinite(Number(data.angle)) ? Number(data.angle) : p.angle,
      weapon: String(data.weapon || p.weapon).slice(0, 32),
      equipment: sanitizeEquipment(data.equipment, p.equipment || { weapon: p.weapon || 'pistol' }),
      mode: String(data.mode || 'single').slice(0, 24),
      t: Date.now()
    };
    socket.to(p.roomId).emit('shot', shot);
    if (room) addRoomNoise(room, p.x, p.z, ENEMY_HEARING_SHOT_RANGE, socket.id, 'shot');
  });

  socket.on('enemyHit', (data = {}, ack) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    ensureRoomWorld(room);
    const loc = roomLocation(room);
    if (!locationAllowsNpcCombat(loc)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'В мирной локации нельзя атаковать НПС.' });
      return;
    }
    const enemyId = String(data.enemyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const enemy = room.enemies.get(enemyId);
    if (!enemy || enemy.dead) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Цель уже недоступна.' });
      return;
    }
    const dist = Math.hypot((p.x || 0) - enemy.x, (p.z || 0) - enemy.z);
    if (dist > 36) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Цель слишком далеко.' });
      return;
    }
    const now = Date.now();
    const isMultiTargetHit = !!data.multiTarget;
    // Дробовик и огнемёт могут задеть несколько мобов одним выстрелом.
    // Такие попадания приходят пачкой почти в один тик, поэтому общий антиспам
    // по времени нельзя применять к каждому мобу отдельно — иначе сервер
    // засчитывает только первую цель, а остальные HP откатываются снапшотом.
    if (!isMultiTargetHit && p.lastEnemyHitAt && now - p.lastEnemyHitAt < 45) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Слишком частые атаки.' });
      return;
    }
    if (!isMultiTargetHit) p.lastEnemyHitAt = now;
    const damage = clamp(Number(data.clientPredictedDamage ?? data.damage ?? 0), 0, 140);
    addRoomNoise(room, p.x, p.z, ENEMY_HEARING_SHOT_RANGE, socket.id, 'combat');
    if (damage <= 0) {
      if (typeof ack === 'function') ack({ ok: true, hit: false, damage: 0, enemy: publicEnemy(enemy), killed: false });
      return;
    }
    enemy.hp = Math.max(0, enemy.hp - damage);
    let killed = false;
    if (enemy.hp <= 0 && !enemy.dead) {
      killed = true;
      enemy.dead = true;
      enemy.diedAt = now;
      enemy.looted = false;
      enemy.killerId = socket.id;
      enemy.attackTimer = 0;
      io.to(room.id).emit('enemyKilled', { enemyId: enemy.id, killerId: socket.id, name: enemy.name, xp: enemy.xp || 0, x: Number(enemy.x.toFixed(2)), z: Number(enemy.z.toFixed(2)), t: now });
    }
    refreshRoomWorldState(room);
    if (typeof ack === 'function') ack({ ok: true, hit: true, damage, enemy: publicEnemy(enemy), killed });
    emitEnemySnapshot(room, true);
  });

  socket.on('inspectCorpse', (data = {}, ack) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    ensureRoomWorld(room);
    const enemyId = String(data.enemyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const enemy = room.enemies.get(enemyId);
    if (!enemy || !enemy.dead) {
      if (typeof ack === 'function') ack({ ok: false, error: 'corpse_not_found' });
      return;
    }
    const dist = Math.hypot((p.x || 0) - enemy.x, (p.z || 0) - enemy.z);
    if (dist > 4.4) {
      if (typeof ack === 'function') ack({ ok: false, error: 'too_far' });
      return;
    }
    const now = Date.now();
    serverTouchCorpseLootHold(enemy, socket.id, now);
    refreshRoomWorldState(room);
    if (typeof ack === 'function') ack({ ok: true, enemy: publicEnemy(enemy), holdUntil: enemy.corpseLootHoldUntil });
  });

  socket.on('releaseCorpseLoot', (data = {}, ack) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    ensureRoomWorld(room);
    const enemyId = String(data.enemyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const enemy = room.enemies.get(enemyId);
    if (!enemy || !enemy.dead) {
      if (typeof ack === 'function') ack({ ok: true, removed: true });
      return;
    }
    const now = Date.now();
    serverReleaseCorpseLootHold(enemy, socket.id, now);
    const removed = serverShouldRemoveCorpse(enemy, now);
    if (removed) room.enemies.delete(enemy.id);
    refreshRoomWorldState(room);
    emitEnemySnapshot(room, true);
    if (typeof ack === 'function') ack({ ok: true, removed });
  });

  socket.on('lootEnemy', (data = {}, ack) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    ensureRoomWorld(room);
    const enemyId = String(data.enemyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const enemy = room.enemies.get(enemyId);
    if (!enemy || !enemy.dead) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Труп не найден.' });
      return;
    }
    const dist = Math.hypot((p.x || 0) - enemy.x, (p.z || 0) - enemy.z);
    if (dist > 4.4) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Подойдите ближе к телу.' });
      return;
    }
    serverTouchCorpseLootHold(enemy, socket.id, Date.now());
    const requested = sanitizeLootRequest(data);
    const taken = [];
    const requestedMap = new Map();
    for (const r of requested) requestedMap.set(r.id, (requestedMap.get(r.id) || 0) + r.qty);

    if (requested.length === 0 && String(data.mode || '') === 'all') {
      for (const entry of enemy.loot || []) requestedMap.set(entry.id, (requestedMap.get(entry.id) || 0) + entry.qty);
    }

    for (const entry of enemy.loot || []) {
      const want = requestedMap.get(entry.id) || 0;
      if (want <= 0 || entry.qty <= 0 || !SERVER_ITEM_IDS.has(entry.id)) continue;
      const qty = Math.min(entry.qty, want);
      if (qty > 0) {
        entry.qty -= qty;
        taken.push({ id: entry.id, qty });
      }
    }
    enemy.loot = (enemy.loot || []).filter(x => x.qty > 0);
    if (enemy.loot.length === 0) {
      enemy.looted = true;
      enemy.diedAt = Date.now() - 1000;
    }
    refreshRoomWorldState(room);
    const publicLootEnemy = publicEnemy(enemy);
    const now = Date.now();
    const removed = serverShouldRemoveCorpse(enemy, now);
    if (typeof ack === 'function') ack({ ok: true, items: taken, enemy: publicLootEnemy, removed });
    io.to(room.id).emit('enemyLootUpdated', {
      locationId: room.locationId,
      enemyId: enemy.id,
      enemy: publicLootEnemy,
      removed,
      looted: enemy.looted,
      taken,
      takenBy: socket.id,
      t: now
    });
    if (removed) room.enemies.delete(enemy.id);
    refreshRoomWorldState(room);
    emitEnemySnapshot(room, true);
  });

  const changeLocationHandler = (data = {}, ack) => {
    const p = players.get(socket.id);
    if (!p) return rejectJoin(socket, ack, 'Сначала войдите в сетевую игру.');
    leaveCurrentRoom(socket);
    const locationId = normalizeLocationId(data.locationId || p.locationId || 'settlement');
    const room = chooseRoomForLocation(locationId);
    socket.join(room.id);
    room.sockets.add(socket.id);
    p.roomId = room.id;
    p.locationId = room.locationId;
    p.x = clamp(Number(data.x ?? p.x), -MAP_SIZE, MAP_SIZE);
    p.z = clamp(Number(data.z ?? p.z), -MAP_SIZE, MAP_SIZE);
    p.angle = Number.isFinite(Number(data.angle)) ? Number(data.angle) : p.angle;
    if (typeof data.crouching !== 'undefined') p.crouching = !!data.crouching;
    if (Number.isFinite(Number(data.maxHp))) p.maxHp = clamp(Number(data.maxHp), 1, 9999);
    if (Number.isFinite(Number(data.hp))) p.hp = clampPlayerHp(data.hp, p.maxHp || 100);
    p.dead = false;
    if (typeof data.crouching !== 'undefined') p.crouching = !!data.crouching;
    p.deviceType = normalizeDeviceType(data.deviceType || p.deviceType || 'desktop');
    p.controlType = normalizeControlType(data.controlType || p.controlType || '', p.deviceType);
    p.equipment = sanitizeEquipment(data.equipment, p.equipment || { weapon: data.weapon || p.weapon || 'pistol' });
    p.weapon = p.equipment.weapon || String(data.weapon || p.weapon).slice(0, 32);
    if (data.injuries && typeof data.injuries === 'object') p.injuries = sanitizeInjuries(data.injuries, p.injuries || {});
    const others = [...players.values()].filter(v => v.roomId === room.id && v.id !== socket.id).map(publicPlayer);
    refreshRoomWorldState(room);
    if (typeof ack === 'function') ack({ ok: true, roomId: room.id, locationId: room.locationId, players: others, worldState: room.worldState || publicWorldState(room, true), serverAuthoritativeEnemies: true });
    socket.to(room.id).emit('playerJoined', publicPlayer(p));
    emitEnemySnapshot(room, true);
  };
  socket.on('changeLocation', changeLocationHandler);
  socket.on('changeRoom', changeLocationHandler);

  socket.on('worldState', (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    ensureRoomWorld(room);
    const reason = String(data.reason || 'update').slice(0, 32);
    const incoming = sanitizeWorldState(data.state || data, room.locationId);
    if (!incoming || incoming.locationId !== room.locationId) return;

    // В MMO-режиме клиенты больше не могут перетирать mobs/enemies комнаты.
    // Клиентские worldState-события используются только для ресурсов/карты совместимости.
    if (Array.isArray(incoming.resources)) {
      mergeResourceSnapshots(room, incoming.resources);
      if (reason === 'resource') addRoomNoise(room, p.x, p.z, ENEMY_HEARING_HARVEST_RANGE, socket.id, 'harvest');
    } else refreshRoomWorldState(room);

    if (reason === 'init' || reason === 'periodic') return;
    io.to(room.id).emit('worldState', { reason, state: room.worldState || publicWorldState(room, true) });
    emitEnemySnapshot(room, true);
  });

  socket.on('disconnect', () => {
    cleanupGlobalTravelSessionsForSocket(socket.id);
    leaveCurrentRoom(socket);
    releaseSocketLocks(socket);
    players.delete(socket.id);
  });
});

setInterval(() => {
  // 1) Сначала двигаем игроков.
  for (const p of players.values()) {
    if (p.dead) continue;
    const fwdX = Math.sin(p.angle);
    const fwdZ = Math.cos(p.angle);
    const rightX = Math.cos(p.angle);
    const rightZ = -Math.sin(p.angle);
    let dx = fwdX * p.input.forward + rightX * p.input.right;
    let dz = fwdZ * p.input.forward + rightZ * p.input.right;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const moving = Math.abs(p.input.forward) + Math.abs(p.input.right) > 0.01;
    if (moving) {
      const speedFactor = p.input.forward < -0.15 ? 0.58 : 1;
      p.x = clamp(p.x + dx * PLAYER_SPEED * speedFactor * DT, -MAP_SIZE, MAP_SIZE);
      p.z = clamp(p.z + dz * PLAYER_SPEED * speedFactor * DT, -MAP_SIZE, MAP_SIZE);
    }
  }

  // 2) Потом серверный AI мобов. Здесь игрок может умереть и сменить комнату.
  // Поэтому snapshots игроков собираем только после этого шага, иначе старый room
  // может повторно добавить модель умершего игрока после события playerLeft.
  for (const room of rooms.values()) {
    for (const sid of [...room.sockets]) if (!socketIsLive(sid)) room.sockets.delete(sid);
    if (room.sockets.size > 0) {
      updateServerEnemies(room, DT);
      emitEnemySnapshot(room);
    }
  }

  // 3) Финальный актуальный snapshot по комнатам после всех смертей/респавнов.
  const byRoom = new Map();
  for (const p of players.values()) {
    if (!p.roomId || !socketIsLive(p.id)) continue;
    if (!byRoom.has(p.roomId)) byRoom.set(p.roomId, []);
    byRoom.get(p.roomId).push(publicPlayer(p));
  }
  for (const [roomId, list] of byRoom.entries()) io.to(roomId).emit('snapshot', { t: Date.now(), players: list });
}, 1000 / TICK_RATE);

function getLanUrls(port) {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${GAME_NAME} v${GAME_VERSION} server listening on :${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  const lanUrls = getLanUrls(PORT);
  if (lanUrls.length) console.log(`LAN: ${lanUrls.join('  |  ')}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
