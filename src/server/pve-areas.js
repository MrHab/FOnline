'use strict';

// Постоянные PvE-области. Каждая область — обычная локация с личной комнатой
// на игрока или его группу: `${locationId}#pve_${ownerKey}`. Внутри PvP нет и
// вещи при смерти не выпадают (режим зоны `pve`). Встречи «выкатываются» по
// реальному времени; время и генератор случайных чисел инжектируются.

const DEFAULT_RULES = Object.freeze({
  rollIntervalMs: 90000,
  calmAfterClearMs: 45000,
  rollChance: 0.35,
  tracksCooldownMs: 30000,
  tracksChance: 0.8,
  maxAlive: 8,
  spawnMinPlayerDistance: 14,
  roomIdleResetMs: 600000
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

function normalizePveRules(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    rollIntervalMs: Math.max(1000, Math.floor(Number(src.rollIntervalMs || DEFAULT_RULES.rollIntervalMs))),
    calmAfterClearMs: Math.max(0, Math.floor(Number(src.calmAfterClearMs ?? DEFAULT_RULES.calmAfterClearMs))),
    rollChance: clamp(Number(src.rollChance ?? DEFAULT_RULES.rollChance), 0, 1),
    tracksCooldownMs: Math.max(1000, Math.floor(Number(src.tracksCooldownMs || DEFAULT_RULES.tracksCooldownMs))),
    tracksChance: clamp(Number(src.tracksChance ?? DEFAULT_RULES.tracksChance), 0, 1),
    maxAlive: Math.max(1, Math.floor(Number(src.maxAlive || DEFAULT_RULES.maxAlive))),
    spawnMinPlayerDistance: Math.max(2, Number(src.spawnMinPlayerDistance || DEFAULT_RULES.spawnMinPlayerDistance)),
    roomIdleResetMs: Math.max(10000, Math.floor(Number(src.roomIdleResetMs || DEFAULT_RULES.roomIdleResetMs)))
  };
}

function normalizePack(input = {}, index = 0) {
  const creatureTypeId = cleanId(input?.creatureTypeId, 32);
  const typeName = String(input?.typeName || '').trim().slice(0, 48);
  if (!creatureTypeId && !typeName) return null;
  const range = Array.isArray(input?.count) && input.count.length >= 2 ? input.count : [1, 1];
  const min = Math.max(1, Math.floor(Number(range[0] || 1)));
  const max = Math.max(min, Math.floor(Number(range[1] || min)));
  return {
    id: cleanId(input?.id || `pack_${index + 1}`),
    creatureTypeId,
    typeName,
    count: [min, max],
    weight: Math.max(0, Number(input?.weight || 1)),
    label: String(input?.label || creatureTypeId || typeName).slice(0, 80)
  };
}

function normalizePveAreaCatalog(raw = {}) {
  const rules = normalizePveRules(raw?.rules);
  const areas = [];
  const seen = new Set();
  for (const input of Array.isArray(raw?.areas) ? raw.areas : []) {
    const id = cleanId(input?.id);
    const locationId = cleanId(input?.locationId || id);
    if (!id || !locationId || seen.has(locationId)) continue;
    const packs = (Array.isArray(input?.packs) ? input.packs : []).map(normalizePack).filter(Boolean);
    if (!packs.length) continue;
    seen.add(locationId);
    areas.push({
      id,
      locationId,
      displayName: String(input?.displayName || id).slice(0, 96),
      tracksLabel: String(input?.tracksLabel || 'Искать следы').slice(0, 48),
      initialPacks: Math.max(0, Math.floor(Number(input?.initialPacks ?? 1))),
      packs
    });
  }
  return {
    schema: String(raw?.schema || 'kromka.pve-areas.v1'),
    version: Math.max(1, Math.floor(Number(raw?.version || 1))),
    rules,
    areas,
    byLocation: Object.fromEntries(areas.map(area => [area.locationId, area]))
  };
}

function pveAreaForLocation(catalog = {}, locationId = '') {
  return catalog?.byLocation?.[cleanId(locationId)] || null;
}

function pveOwnerKey(value = '') {
  return cleanId(value, 80);
}

function pveRoomId(locationId = '', ownerKey = '') {
  const loc = cleanId(locationId);
  const key = pveOwnerKey(ownerKey);
  return loc && key ? `${loc}#pve_${key}`.slice(0, 96) : '';
}

function pveRoomOwner(roomId = '', locationId = '') {
  const prefix = `${cleanId(locationId)}#pve_`;
  const raw = String(roomId || '');
  return raw.startsWith(prefix) ? pveOwnerKey(raw.slice(prefix.length)) : '';
}

// Кому можно в комнату: владельцу и тем, кого сервер сам привёл туда
// (группа путешествия получила один билет на общую комнату).
function pveRoomAllowed(roomId = '', locationId = '', ownerKey = '', members = []) {
  const owner = pveRoomOwner(roomId, locationId);
  if (!owner) return false;
  const key = pveOwnerKey(ownerKey);
  if (owner === key) return true;
  return (Array.isArray(members) ? members : Array.from(members || [])).some(row => pveOwnerKey(row) === key);
}

function createPveRoomState(area = {}, rules = DEFAULT_RULES, now = Date.now(), ownerKey = '') {
  return {
    areaId: String(area.id || ''),
    locationId: String(area.locationId || ''),
    ownerKey: pveOwnerKey(ownerKey),
    createdAt: Number(now),
    lastRollAt: Number(now),
    nextRollAt: Number(now) + rules.rollIntervalMs,
    calmUntil: 0,
    tracksReadyAt: 0,
    rolls: 0,
    packsSpawned: 0,
    kills: 0,
    lastAlive: 0,
    lastResult: 'idle',
    lastPackLabel: '',
    initialSpawned: false
  };
}

function choosePack(area = {}, random = Math.random) {
  const packs = (area.packs || []).filter(row => row.weight > 0);
  if (!packs.length) return null;
  const total = packs.reduce((sum, row) => sum + row.weight, 0);
  let cursor = random() * total;
  let chosen = packs[packs.length - 1];
  for (const pack of packs) {
    cursor -= pack.weight;
    if (cursor <= 0) { chosen = pack; break; }
  }
  const count = chosen.count[0] + Math.floor(random() * (chosen.count[1] - chosen.count[0] + 1));
  return { ...chosen, spawnCount: clamp(count, chosen.count[0], chosen.count[1]) };
}

function initialPacks(state = {}, area = {}, random = Math.random) {
  if (state.initialSpawned) return [];
  state.initialSpawned = true;
  const out = [];
  for (let i = 0; i < Math.max(0, Number(area.initialPacks || 0)); i += 1) {
    const pack = choosePack(area, random);
    if (pack) out.push(pack);
  }
  if (out.length) {
    state.packsSpawned += out.length;
    state.lastResult = 'spawned';
    state.lastPackLabel = out[out.length - 1].label;
  }
  return out;
}

// Плановая проверка: только при игроках в комнате, не чаще интервала,
// не в «затишье» после зачистки и не при переполнении.
function rollPveEncounter(state = {}, area = {}, rules = DEFAULT_RULES, now = Date.now(), options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const aliveCount = Math.max(0, Math.floor(Number(options.aliveCount || 0)));
  if (options.occupied === false) return { rolled: false, spawn: null, reason: 'empty' };
  if (Number(now) < Number(state.nextRollAt || 0)) return { rolled: false, spawn: null, reason: 'cooldown' };
  state.lastRollAt = Number(now);
  state.nextRollAt = Number(now) + rules.rollIntervalMs;
  state.rolls += 1;
  if (Number(now) < Number(state.calmUntil || 0)) {
    state.lastResult = 'calm';
    return { rolled: true, spawn: null, reason: 'calm' };
  }
  if (aliveCount >= rules.maxAlive) {
    state.lastResult = 'crowded';
    return { rolled: true, spawn: null, reason: 'crowded' };
  }
  if (random() >= rules.rollChance) {
    state.lastResult = 'quiet';
    return { rolled: true, spawn: null, reason: 'quiet' };
  }
  const pack = choosePack(area, random);
  if (!pack) return { rolled: true, spawn: null, reason: 'quiet' };
  state.packsSpawned += 1;
  state.lastResult = 'spawned';
  state.lastPackLabel = pack.label;
  return { rolled: true, spawn: pack, reason: 'spawned' };
}

// «Искать следы»: игрок сам провоцирует встречу с повышенным шансом; своя
// перезарядка, затишье после зачистки не мешает, переполнение — мешает.
function searchTracks(state = {}, area = {}, rules = DEFAULT_RULES, now = Date.now(), options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const aliveCount = Math.max(0, Math.floor(Number(options.aliveCount || 0)));
  if (Number(now) < Number(state.tracksReadyAt || 0)) {
    return { ok: false, spawn: null, reason: 'cooldown', error: `Следы уже осмотрены. Подождите ${Math.ceil((state.tracksReadyAt - now) / 1000)} с.`, readyInMs: state.tracksReadyAt - Number(now) };
  }
  state.tracksReadyAt = Number(now) + rules.tracksCooldownMs;
  if (aliveCount >= rules.maxAlive) {
    state.lastResult = 'crowded';
    return { ok: true, spawn: null, reason: 'crowded' };
  }
  if (random() >= rules.tracksChance) {
    state.lastResult = 'noTracks';
    return { ok: true, spawn: null, reason: 'noTracks' };
  }
  const pack = choosePack(area, random);
  if (!pack) return { ok: true, spawn: null, reason: 'noTracks' };
  state.calmUntil = 0;
  state.packsSpawned += 1;
  state.lastResult = 'tracked';
  state.lastPackLabel = pack.label;
  return { ok: true, spawn: pack, reason: 'tracked' };
}

// Зачистка: все звери мертвы — начинается затишье, следующая плановая
// проверка не раньше его конца.
function notePveAlive(state = {}, rules = DEFAULT_RULES, aliveCount = 0, now = Date.now()) {
  const alive = Math.max(0, Math.floor(Number(aliveCount || 0)));
  const cleared = Number(state.lastAlive || 0) > 0 && alive === 0;
  if (cleared) {
    state.kills += Number(state.lastAlive || 0);
    state.calmUntil = Number(now) + rules.calmAfterClearMs;
    state.nextRollAt = Math.max(Number(state.nextRollAt || 0), state.calmUntil);
    state.lastResult = 'cleared';
  }
  state.lastAlive = alive;
  return cleared;
}

function pveRoomIdle(state = {}, rules = DEFAULT_RULES, emptySince = 0, now = Date.now()) {
  const since = Number(emptySince || 0);
  return since > 0 && Number(now) - since >= rules.roomIdleResetMs;
}

const RESULT_LABELS = Object.freeze({
  idle: 'Тихо.',
  spawned: 'Слышно движение: появилась новая группа.',
  calm: 'После зачистки здесь тихо.',
  crowded: 'Логово и так кишит.',
  quiet: 'Пока спокойно.',
  noTracks: 'Следов не нашлось.',
  tracked: 'По следам вышла группа.',
  cleared: 'Область зачищена — затишье.'
});

function publicPveRoomState(state = null, area = null, rules = DEFAULT_RULES, now = Date.now(), extra = {}) {
  if (!state || !area) return null;
  return {
    areaId: String(area.id || ''),
    locationId: String(area.locationId || ''),
    displayName: String(area.displayName || ''),
    mode: 'pve',
    personal: true,
    tracksLabel: String(area.tracksLabel || 'Искать следы'),
    alive: Math.max(0, Math.floor(Number(extra.aliveCount ?? state.lastAlive ?? 0))),
    maxAlive: rules.maxAlive,
    nextRollInSeconds: Math.max(0, Math.round((Number(state.nextRollAt || 0) - Number(now)) / 1000)),
    calmSeconds: Math.max(0, Math.round((Number(state.calmUntil || 0) - Number(now)) / 1000)),
    tracksReadyInSeconds: Math.max(0, Math.round((Number(state.tracksReadyAt || 0) - Number(now)) / 1000)),
    rolls: Number(state.rolls || 0),
    packsSpawned: Number(state.packsSpawned || 0),
    kills: Number(state.kills || 0),
    lastResult: String(state.lastResult || 'idle'),
    lastResultLabel: RESULT_LABELS[String(state.lastResult || 'idle')] || RESULT_LABELS.idle,
    lastPackLabel: String(state.lastPackLabel || ''),
    members: Math.max(0, Math.floor(Number(extra.members || 0)))
  };
}

module.exports = {
  DEFAULT_RULES,
  RESULT_LABELS,
  choosePack,
  createPveRoomState,
  initialPacks,
  normalizePveAreaCatalog,
  normalizePveRules,
  notePveAlive,
  publicPveRoomState,
  pveAreaForLocation,
  pveOwnerKey,
  pveRoomAllowed,
  pveRoomId,
  pveRoomIdle,
  pveRoomOwner,
  rollPveEncounter,
  searchTracks
};
