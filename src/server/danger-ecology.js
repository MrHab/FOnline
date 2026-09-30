'use strict';

/**
 * A-Life опасных клеток (экономика v3, библия 18.1). Угрозы не рождаются в
 * сцене — их приводит мир. Группы монстров Кромки и мародёров живут
 * постоянно: у каждой есть логово в мелкой клетке (1,6 км), состав (особи со
 * своим здоровьем), цель и счёт потерь. Без игроков группа отдыхает у логова,
 * обходит окрестности и возвращается, а почуяв игроков в соседней сцене —
 * идёт к ним. Шаг — одна мелкая клетка по сторонам света, поэтому группа,
 * вошедшая в занятую сцену, появляется у того края, откуда шла.
 *
 * Логово пополняет группы медленно и только пока в его клетке нет игроков.
 * Погибшая особь не возвращается; группа без особей исчезает.
 *
 * Модуль не знает о сервере: цвет клетки, занятость сцен, здоровье особей,
 * время и случайность передаются снаружи. Пока группа «в сети» (её особи —
 * настоящие NPC в сцене), модуль её не двигает.
 */

const ECOLOGY_VERSION = 1;
// Жизнь идёт во всех немирных зонах, синие (pve) — тоже: там слабые виды и потери без добычи.
const LIVING_MODES = Object.freeze(['pve', 'pvp', 'pvpFullDrop', 'pvpBlack']);
// Люди A-Life: налётчики и путники. Остальные типы особей — твари бестиария.
const HUMAN_TYPES = Object.freeze(['raider', 'caravaneer', 'caravan_guard', 'porter', 'patrol_guard']);
const GROUP_STATES = Object.freeze(['rest', 'roam', 'return', 'hunt', 'flee', 'travel']);

// Место стычки без игроков (павшие) ждёт игроков столько, не больше стольких на зону и на мир.
const AFTERMATH_TTL_MS = 40 * 60000;
const AFTERMATH_PER_CELL = 3;
const AFTERMATH_MAX = 400;

const STEPS = Object.freeze({
  north: Object.freeze({ dx: 0, dy: -1 }),
  south: Object.freeze({ dx: 0, dy: 1 }),
  west: Object.freeze({ dx: -1, dy: 0 }),
  east: Object.freeze({ dx: 1, dy: 0 })
});

const DEFAULT_CONFIG = Object.freeze({
  tickSeconds: 5,
  maxGroups: 800,
  pullRadiusCells: 3,
  woundHealPerMinute: 0.02,
  lairs: Object.freeze({
    density: Object.freeze({ pve: 0, pvp: 0.01, pvpFullDrop: 0.03, pvpBlack: 0.18 }),
    capacity: Object.freeze({ pve: 1, pvp: 1, pvpFullDrop: 2, pvpBlack: 2 }),
    refillMinutes: Object.freeze({ pve: 120, pvp: 120, pvpFullDrop: 75, pvpBlack: 45 })
  }),
  roam: Object.freeze({
    restMinutes: Object.freeze([4, 10]),
    stepSeconds: Object.freeze([70, 160]),
    huntStepSeconds: Object.freeze([35, 70]),
    // Как часто отдыхающая группа прислушивается к сценам с игроками рядом.
    senseSeconds: 30,
    // Сколько сломленная группа после бегства не идёт на шум.
    shakenMinutes: 10,
    radius: 2,
    // Как далеко (в зонах от логова) уходит группа в дальний обход.
    migrateRadius: 4,
    // Враждебные группы в одной зоне без игроков сходятся в среднем раз в
    // 1 / (clashPerMinute × агрессия) минут; после стычки — передышка.
    clashPerMinute: 0.5,
    clashCooldownMinutes: 10
  }),
  species: Object.freeze([])
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeId(value = '', limit = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function cleanText(value = '', limit = 80) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);
}

function range(value, fallback, min, max) {
  const src = Array.isArray(value) ? value : fallback;
  const a = finite(src[0], fallback[0], min, max);
  const b = finite(src[1], fallback[1], min, max);
  return Object.freeze([Math.min(a, b), Math.max(a, b)]);
}

function modeTable(value, fallback, min, max) {
  const src = value && typeof value === 'object' ? value : {};
  return Object.freeze(Object.fromEntries(LIVING_MODES.map(mode => [mode, finite(src[mode], fallback[mode] || 0, min, max)])));
}

function stableHash(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function hash01(text = '') {
  return stableHash(text) / 4294967296;
}

function cellKey(sx, sy) {
  return `${sx}_${sy}`;
}

function normalizeSpecies(row = {}, roam = DEFAULT_CONFIG.roam) {
  const id = safeId(row.id);
  if (!id) return null;
  const members = (Array.isArray(row.members) ? row.members : []).map(member => {
    const min = Math.floor(finite(member?.min, 1, 0, 12));
    const equipment = {};
    for (const [slot, itemId] of Object.entries(member?.equipment && typeof member.equipment === 'object' ? member.equipment : {})) {
      const cleanSlot = safeId(slot, 24);
      const cleanItem = safeId(itemId, 48);
      if (cleanSlot && cleanItem) equipment[cleanSlot] = cleanItem;
    }
    return Object.freeze({
      type: safeId(member?.type),
      name: cleanText(member?.name, 60),
      // Роль человека в группе (охранник, носильщик): от неё — облик и поведение NPC.
      role: safeId(member?.role, 24),
      min,
      max: Math.floor(finite(member?.max, min, min, 12)),
      equipment: Object.freeze(equipment)
    });
  }).filter(member => member.type && member.max > 0);
  const habitat = modeTable(row.habitat, {}, 0, 10);
  if (!members.length || !LIVING_MODES.some(mode => habitat[mode] > 0)) return null;
  const regions = {};
  for (const [region, weight] of Object.entries(row.regions && typeof row.regions === 'object' ? row.regions : {})) {
    const key = safeId(region, 48);
    if (key) regions[key] = finite(weight, 1, 0, 10);
  }
  const kind = ['raider', 'monster', 'fauna', 'traveller'].includes(row.kind) ? row.kind : 'monster';
  const travel = row.travel && typeof row.travel === 'object' ? row.travel : {};
  return Object.freeze({
    id,
    name: cleanText(row.name, 80) || id,
    kind,
    // Мирная фауна (фонарники) никого не трогает и в стычку не тянется; путники
    // (караваны, патрули) на игрока не нападают.
    hostile: kind !== 'fauna' && kind !== 'traveller' && row.hostile !== false,
    faction: safeId(row.faction, 48),
    members: Object.freeze(members),
    habitat,
    regions: Object.freeze(regions),
    roamRadius: Math.floor(finite(row.roamRadius, roam.radius, 1, 6)),
    perceptionCells: Math.floor(finite(row.perceptionCells, 2, 0, 6)),
    aggression: finite(row.aggression, 0.6, 0, 1),
    fleeAt: finite(row.fleeAt, 0.5, 0.05, 1),
    stepSeconds: row.stepSeconds ? range(row.stepSeconds, roam.stepSeconds, 1, 3600) : roam.stepSeconds,
    // Дойдя до цели обхода, группа с этой вероятностью идёт дальше, а не домой;
    // после отдыха с вероятностью migrateChance уходит далеко, на migrateRadius зон.
    wander: finite(row.wander, 0.35, 0, 1),
    migrateChance: finite(row.migrateChance, 0.2, 0, 1),
    // Сила в стычке без игроков на единицу здоровья: стволы налётчиков бьют больнее.
    combat: finite(row.combat, kind === 'raider' ? 1.3 : kind === 'traveller' ? 1.2 : kind === 'fauna' ? 0.3 : 1, 0, 10),
    // Путники ходят между городами (караван) или обходят зоны у своего города (патруль).
    travel: kind === 'traveller' ? Object.freeze({
      mode: travel.mode === 'patrol' ? 'patrol' : 'caravan',
      // Караванов — столько на весь мир, патрулей — столько у каждого города.
      count: Math.floor(finite(travel.count, 4, 0, 64)),
      restMinutes: range(travel.restMinutes, [20, 60], 0, 1440),
      respawnMinutes: finite(travel.respawnMinutes, 30, 1, 10080),
      patrolRadius: Math.floor(finite(travel.patrolRadius, 2, 1, 6)),
      patrolStops: Math.floor(finite(travel.patrolStops, 3, 1, 12))
    }) : null
  });
}

function normalizeEcologyConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const lairs = src.lairs && typeof src.lairs === 'object' ? src.lairs : {};
  const roamSrc = src.roam && typeof src.roam === 'object' ? src.roam : {};
  const roam = Object.freeze({
    restMinutes: range(roamSrc.restMinutes, DEFAULT_CONFIG.roam.restMinutes, 0, 720),
    stepSeconds: range(roamSrc.stepSeconds, DEFAULT_CONFIG.roam.stepSeconds, 1, 3600),
    huntStepSeconds: range(roamSrc.huntStepSeconds, DEFAULT_CONFIG.roam.huntStepSeconds, 1, 3600),
    senseSeconds: finite(roamSrc.senseSeconds, DEFAULT_CONFIG.roam.senseSeconds, 1, 3600),
    shakenMinutes: finite(roamSrc.shakenMinutes, DEFAULT_CONFIG.roam.shakenMinutes, 0, 1440),
    radius: Math.floor(finite(roamSrc.radius, DEFAULT_CONFIG.roam.radius, 1, 6)),
    migrateRadius: Math.floor(finite(roamSrc.migrateRadius, DEFAULT_CONFIG.roam.migrateRadius, 1, 12)),
    clashPerMinute: finite(roamSrc.clashPerMinute, DEFAULT_CONFIG.roam.clashPerMinute, 0, 60),
    clashCooldownMinutes: finite(roamSrc.clashCooldownMinutes, DEFAULT_CONFIG.roam.clashCooldownMinutes, 0, 1440)
  });
  const species = [];
  const seen = new Set();
  for (const row of Array.isArray(src.species) ? src.species : []) {
    const clean = normalizeSpecies(row, roam);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    species.push(clean);
  }
  return Object.freeze({
    tickSeconds: finite(src.tickSeconds, DEFAULT_CONFIG.tickSeconds, 1, 120),
    maxGroups: Math.floor(finite(src.maxGroups, DEFAULT_CONFIG.maxGroups, 0, 5000)),
    pullRadiusCells: Math.floor(finite(src.pullRadiusCells, DEFAULT_CONFIG.pullRadiusCells, 0, 8)),
    woundHealPerMinute: finite(src.woundHealPerMinute, DEFAULT_CONFIG.woundHealPerMinute, 0, 1),
    lairs: Object.freeze({
      density: modeTable(lairs.density, DEFAULT_CONFIG.lairs.density, 0, 1),
      capacity: Object.freeze(Object.fromEntries(LIVING_MODES.map(mode => [mode,
        Math.floor(finite(lairs.capacity?.[mode], DEFAULT_CONFIG.lairs.capacity[mode], 0, 8))]))),
      refillMinutes: modeTable(lairs.refillMinutes, DEFAULT_CONFIG.lairs.refillMinutes, 1, 10080)
    }),
    roam,
    species: Object.freeze(species),
    speciesById: Object.freeze(Object.fromEntries(species.map(row => [row.id, row])))
  });
}

// --- состояние ------------------------------------------------------------------------------

function emptyEcologyState(mapRevision = '') {
  return {
    version: ECOLOGY_VERSION,
    mapRevision: String(mapRevision || ''),
    nextId: 1,
    lairs: new Map(),
    groups: new Map(),
    cellIndex: new Map(),
    travellerNextAt: {},
    aftermath: [],
    dirty: true
  };
}

function indexAdd(state, group) {
  const key = cellKey(group.sx, group.sy);
  let set = state.cellIndex.get(key);
  if (!set) state.cellIndex.set(key, set = new Set());
  set.add(group.id);
}

function indexRemove(state, group) {
  const key = cellKey(group.sx, group.sy);
  const set = state.cellIndex.get(key);
  if (!set) return;
  set.delete(group.id);
  if (!set.size) state.cellIndex.delete(key);
}

function sanitizeMember(row = {}, index = 0) {
  const maxHp = Math.max(1, Math.round(finite(row.maxHp, 100, 1, 100000)));
  return {
    id: safeId(row.id, 24) || `m${index + 1}`,
    type: safeId(row.type),
    spec: Math.floor(finite(row.spec, 0, 0, 32)),
    name: cleanText(row.name, 60),
    hp: Math.round(finite(row.hp, maxHp, 0, maxHp)),
    maxHp
  };
}

function normalizeEcologyState(input = {}, config = normalizeEcologyConfig()) {
  const src = input && typeof input === 'object' ? input : {};
  const state = emptyEcologyState(src.mapRevision);
  state.nextId = Math.max(1, Math.floor(finite(src.nextId, 1, 1, 1e12)));
  for (const row of Array.isArray(src.lairs) ? src.lairs : []) {
    const id = safeId(row?.id);
    if (!id || !config.speciesById[row?.speciesId]) continue;
    state.lairs.set(id, {
      id,
      speciesId: row.speciesId,
      sx: Math.floor(Number(row.sx) || 0),
      sy: Math.floor(Number(row.sy) || 0),
      mode: LIVING_MODES.includes(row.mode) ? row.mode : 'pvp',
      region: safeId(row.region, 48),
      slot: Math.max(0, Math.floor(Number(row.slot) || 0)),
      refillAt: Math.max(0, Number(row.refillAt) || 0)
    });
  }
  for (const row of Array.isArray(src.groups) ? src.groups : []) {
    const id = safeId(row?.id);
    const species = config.speciesById[row?.speciesId];
    if (!id || !species) continue;
    const members = (Array.isArray(row.members) ? row.members : []).map(sanitizeMember)
      .filter(member => member.type && member.hp > 0);
    if (!members.length) continue;
    const group = {
      id,
      speciesId: species.id,
      lairId: state.lairs.has(row.lairId) ? row.lairId : '',
      sx: Math.floor(Number(row.sx) || 0),
      sy: Math.floor(Number(row.sy) || 0),
      members,
      state: GROUP_STATES.includes(row.state) ? row.state : 'rest',
      target: row.target && Number.isFinite(Number(row.target.sx)) && Number.isFinite(Number(row.target.sy))
        ? { sx: Math.floor(Number(row.target.sx)), sy: Math.floor(Number(row.target.sy)) }
        : null,
      restUntil: Math.max(0, Number(row.restUntil) || 0),
      nextStepAt: Math.max(0, Number(row.nextStepAt) || 0),
      shakenUntil: Math.max(0, Number(row.shakenUntil) || 0),
      // После перезапуска сцен нет: все группы снова вне сети.
      online: '',
      size0: Math.max(members.length, Math.floor(finite(row.size0, members.length, 1, 100))),
      bornAt: Math.max(0, Number(row.bornAt) || 0),
      clashReadyAt: Math.max(0, Number(row.clashReadyAt) || 0)
    };
    if (species.kind === 'traveller') {
      const route = (Array.isArray(row.route) ? row.route : [])
        .filter(cell => Number.isFinite(Number(cell?.sx)) && Number.isFinite(Number(cell?.sy)))
        .map(cell => ({ sx: Math.floor(Number(cell.sx)), sy: Math.floor(Number(cell.sy)) }));
      group.home = safeId(row.home, 64);
      group.dest = safeId(row.dest, 64);
      group.route = route.length >= 2 ? route : null;
      group.routeIndex = group.route ? Math.max(0, Math.min(route.length - 1, Math.floor(Number(row.routeIndex) || 0))) : 0;
      group.fleeing = !!row.fleeing && !!group.route;
      if (!group.route && group.state === 'travel') group.state = 'rest';
    }
    state.groups.set(id, group);
    indexAdd(state, group);
  }
  state.aftermath = (Array.isArray(src.aftermath) ? src.aftermath : []).map(row => ({
    id: safeId(row?.id, 32),
    sx: Math.floor(Number(row?.sx) || 0),
    sy: Math.floor(Number(row?.sy) || 0),
    at: Math.max(0, Number(row?.at) || 0),
    shown: safeId(row?.shown, 96),
    dead: (Array.isArray(row?.dead) ? row.dead : []).slice(0, 24).map(dead => ({
      speciesId: safeId(dead?.speciesId), type: safeId(dead?.type), spec: Math.floor(finite(dead?.spec, 0, 0, 32)), name: cleanText(dead?.name, 60)
    })).filter(dead => config.speciesById[dead.speciesId] && dead.type)
  })).filter(row => row.id && row.dead.length).slice(-AFTERMATH_MAX);
  state.travellerNextAt = {};
  for (const [key, at] of Object.entries(src.travellerNextAt && typeof src.travellerNextAt === 'object' ? src.travellerNextAt : {})) {
    const cleanKey = String(key).replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 96);
    if (cleanKey && Number.isFinite(Number(at))) state.travellerNextAt[cleanKey] = Number(at);
  }
  state.dirty = false;
  return state;
}

function serializeEcologyState(state) {
  return {
    version: ECOLOGY_VERSION,
    mapRevision: state.mapRevision,
    nextId: state.nextId,
    lairs: [...state.lairs.values()].map(lair => ({ ...lair })),
    groups: [...state.groups.values()].map(group => ({
      id: group.id,
      speciesId: group.speciesId,
      lairId: group.lairId,
      sx: group.sx,
      sy: group.sy,
      members: group.members.map(member => ({ ...member })),
      state: group.state,
      target: group.target ? { ...group.target } : null,
      restUntil: group.restUntil,
      nextStepAt: group.nextStepAt,
      shakenUntil: group.shakenUntil || 0,
      size0: group.size0,
      bornAt: group.bornAt,
      ...(group.clashReadyAt ? { clashReadyAt: group.clashReadyAt } : {}),
      ...(group.home !== undefined ? {
        home: group.home,
        dest: group.dest || '',
        route: group.route ? group.route.map(cell => ({ sx: cell.sx, sy: cell.sy })) : null,
        routeIndex: group.routeIndex || 0,
        fleeing: !!group.fleeing
      } : {})
    })),
    travellerNextAt: { ...(state.travellerNextAt || {}) },
    aftermath: (state.aftermath || []).map(row => ({ ...row, dead: row.dead.map(dead => ({ ...dead })) }))
  };
}

// --- логова ---------------------------------------------------------------------------------

function pickSpecies(config, mode, region, roll, allowed = () => true) {
  // allowed — да/нет или множитель веса (угодья делают зверя чаще или реже).
  const weights = config.species.map(row => {
    // Путники живут не в логовах, а в дороге между городами.
    if (row.kind === 'traveller') return 0;
    const verdict = allowed(row);
    const factor = verdict === true ? 1 : verdict === false ? 0 : Math.max(0, Number(verdict) || 0);
    return factor > 0 ? row.habitat[mode] * (row.regions[region] ?? 1) * factor : 0;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return null;
  let left = roll * total;
  for (let i = 0; i < weights.length; i += 1) {
    left -= weights[i];
    if (left < 0 && weights[i] > 0) return config.species[i];
  }
  return config.species[weights.findLastIndex(weight => weight > 0)] || null;
}

/**
 * Логова по клеткам-кандидатам {sx, sy, mode, region}. Кандидат с `id` — готовое
 * место логова (логово зоны мира, `slot` — его номер в зоне): оно ставится
 * всегда; без `id` клетка становится логовом с вероятностью density цвета.
 * Расстановка детерминирована по ревизии: тот же мир даёт те же логова.
 * options.speciesAllowed(species, cell) отсекает виды, чуждые клетке (тир зоны),
 * или возвращает множитель веса вида (угодья зоны).
 */
function buildLairs(config, candidates = [], mapRevision = '', options = {}) {
  const speciesAllowed = typeof options.speciesAllowed === 'function' ? options.speciesAllowed : () => true;
  const lairs = [];
  for (const cell of Array.isArray(candidates) ? candidates : []) {
    const mode = LIVING_MODES.includes(cell?.mode) ? cell.mode : '';
    if (!mode) continue;
    const key = cellKey(cell.sx, cell.sy);
    const id = cell.id ? safeId(cell.id) : `lair_${key.replace(/-/g, 'm')}`;
    if (!cell.id) {
      const density = config.lairs.density[mode] || 0;
      if (!(density > 0) || hash01(`${mapRevision}:lair:${key}`) >= density) continue;
    }
    // Сперва виды тира клетки; если таких в этой среде нет, логово не пропадает —
    // встаёт вид среды, а силу ему даёт тир зоны при появлении.
    const roll = hash01(`${mapRevision}:species:${cell.id ? id : key}`);
    const species = pickSpecies(config, mode, safeId(cell.region, 48), roll, row => speciesAllowed(row, cell))
      || pickSpecies(config, mode, safeId(cell.region, 48), roll);
    if (!species) continue;
    lairs.push({
      id, speciesId: species.id, sx: cell.sx, sy: cell.sy, mode, region: safeId(cell.region, 48),
      slot: Math.max(0, Math.floor(Number(cell.slot) || 0)), refillAt: 0
    });
  }
  return lairs;
}

/**
 * Убрать группы, которым нет места в мире (keep(group) !== true): клетки прежней
 * сетки мира, которой больше нет. Такие «призраки» не ходят, не приходят в сцены
 * и не гибнут, но занимают предел групп — и логова живого мира не пополняются.
 */
function purgeGroups(state, keep) {
  let removed = 0;
  for (const group of [...state.groups.values()]) {
    if (keep(group) === true) continue;
    indexRemove(state, group);
    state.groups.delete(group.id);
    removed += 1;
  }
  if (removed) state.dirty = true;
  return removed;
}

/** Заменить логова (новая ревизия карты): группы старых логов остаются бродягами. */
function resetLairs(state, lairs = [], mapRevision = '') {
  state.lairs = new Map(lairs.map(lair => [lair.id, { ...lair }]));
  state.mapRevision = String(mapRevision || '');
  for (const group of state.groups.values()) if (!state.lairs.has(group.lairId)) group.lairId = '';
  state.dirty = true;
}

function between(random, pair) {
  return pair[0] + (pair[1] - pair[0]) * random();
}

function spawnGroup(state, config, lair, now, random = Math.random, createMember = null) {
  const species = config.speciesById[lair.speciesId];
  if (!species) return null;
  const members = [];
  const addMember = (spec, index) => {
    const stats = typeof createMember === 'function' ? createMember(spec.type) || {} : {};
    members.push(sanitizeMember({
      id: `m${members.length + 1}`,
      type: spec.type,
      spec: index,
      name: spec.name || stats.name,
      hp: stats.maxHp,
      maxHp: stats.maxHp
    }, members.length));
  };
  species.members.forEach((spec, index) => {
    const count = spec.min + Math.floor(random() * (spec.max - spec.min + 1));
    for (let i = 0; i < count; i += 1) addMember(spec, index);
  });
  if (!members.length) addMember(species.members[0], 0);
  const restMs = between(random, config.roam.restMinutes) * 60000;
  const group = {
    id: `g${state.nextId++}`,
    speciesId: species.id,
    lairId: lair.id,
    sx: lair.sx,
    sy: lair.sy,
    members,
    state: 'rest',
    target: null,
    restUntil: now + restMs,
    nextStepAt: now + restMs,
    online: '',
    size0: members.length,
    bornAt: now
  };
  state.groups.set(group.id, group);
  indexAdd(state, group);
  state.dirty = true;
  return group;
}

function lairGroupCounts(state) {
  const counts = new Map();
  for (const group of state.groups.values()) if (group.lairId) counts.set(group.lairId, (counts.get(group.lairId) || 0) + 1);
  return counts;
}

// --- движение -------------------------------------------------------------------------------

function directionBetweenCells(from, to) {
  const dx = to.sx - from.sx;
  const dy = to.sy - from.sy;
  if (dx === 0 && dy === 0) return '';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

/**
 * Можно ли виду войти в клетку. С клеткой, откуда идёт группа, ещё и можно ли
 * пройти между ними: у зон мира это открытые ворота (ctx.canStep).
 */
function canEnter(species, ctx, sx, sy, from = null) {
  const mode = typeof ctx.modeAt === 'function' ? ctx.modeAt(sx, sy) : '';
  if (!LIVING_MODES.includes(mode) || !(species.habitat[mode] > 0)) return false;
  // Тир зоны: вид не уходит в клетки, где он не живёт (ctx.speciesAllowedAt).
  if (typeof ctx.speciesAllowedAt === 'function' && ctx.speciesAllowedAt(species, sx, sy) !== true) return false;
  return !from || typeof ctx.canStep !== 'function' || ctx.canStep(from.sx, from.sy, sx, sy) === true;
}

/** Шаг на одну клетку к цели: сначала по большей разнице, затем по другой оси. */
function stepToward(group, target, species, ctx, random) {
  const dx = target.sx - group.sx;
  const dy = target.sy - group.sy;
  const options = [];
  const horizontal = dx !== 0 ? (dx > 0 ? 'east' : 'west') : '';
  const vertical = dy !== 0 ? (dy > 0 ? 'south' : 'north') : '';
  if (Math.abs(dx) >= Math.abs(dy)) options.push(horizontal, vertical);
  else options.push(vertical, horizontal);
  for (const direction of options) {
    if (!direction) continue;
    const step = STEPS[direction];
    if (canEnter(species, ctx, group.sx + step.dx, group.sy + step.dy, group)) return direction;
  }
  // Обход препятствия: любой проходимый сосед.
  const around = Object.keys(STEPS).sort(() => random() - 0.5);
  for (const direction of around) {
    const step = STEPS[direction];
    if (canEnter(species, ctx, group.sx + step.dx, group.sy + step.dy, group)) return direction;
  }
  return '';
}

function moveGroup(state, group, sx, sy) {
  if (group.sx === sx && group.sy === sy) return;
  indexRemove(state, group);
  group.sx = sx;
  group.sy = sy;
  indexAdd(state, group);
  state.dirty = true;
}

function pickRoamTarget(group, species, lair, ctx, random, radius = species.roamRadius) {
  const home = lair || { sx: group.sx, sy: group.sy };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sx = home.sx + Math.round((random() * 2 - 1) * radius);
    const sy = home.sy + Math.round((random() * 2 - 1) * radius);
    if ((sx !== group.sx || sy !== group.sy) && canEnter(species, ctx, sx, sy)) return { sx, sy };
  }
  return { sx: home.sx, sy: home.sy };
}

// --- путники: караваны и патрули ------------------------------------------------------------

/**
 * Путь по клеткам от from до to включительно: Дейкстра со случайной ценой
 * перехода (1 … 1 + jitter), поэтому пути между одними точками разные.
 * neighbors(sx, sy) → соседние клетки, куда есть проход; through(sx, sy) —
 * можно ли пройти клетку насквозь (город — только начало или конец пути).
 */
function planRoute(from, to, neighbors, random = Math.random, options = {}) {
  const jitter = Number.isFinite(Number(options.jitter)) ? Number(options.jitter) : 1.5;
  const through = typeof options.through === 'function' ? options.through : () => true;
  const limit = Math.max(16, Math.floor(Number(options.maxCells) || 4096));
  const start = cellKey(from.sx, from.sy);
  const goal = cellKey(to.sx, to.sy);
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const cells = new Map([[start, { sx: from.sx, sy: from.sy }]]);
  const open = [start];
  const done = new Set();
  while (open.length && done.size < limit) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) if (dist.get(open[i]) < dist.get(open[best])) best = i;
    const key = open.splice(best, 1)[0];
    if (done.has(key)) continue;
    done.add(key);
    if (key === goal) break;
    const cell = cells.get(key);
    if (key !== start && !through(cell.sx, cell.sy)) continue;
    for (const next of neighbors(cell.sx, cell.sy) || []) {
      const nextKey = cellKey(next.sx, next.sy);
      if (done.has(nextKey)) continue;
      const cost = dist.get(key) + 1 + random() * jitter;
      if (cost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, cost);
        prev.set(nextKey, key);
        cells.set(nextKey, { sx: next.sx, sy: next.sy });
        open.push(nextKey);
      }
    }
  }
  if (!prev.has(goal) && start !== goal) return null;
  const path = [];
  for (let key = goal; key; key = prev.get(key)) {
    path.push(cells.get(key));
    if (key === start) break;
  }
  return path.reverse();
}

function travellerNextCell(group) {
  return Array.isArray(group?.route) ? group.route[(group.routeIndex || 0) + 1] || null : null;
}

/** Куда путник пойдёт из своей зоны: сторона следующей клетки маршрута. */
function travellerNextDirection(group) {
  const next = travellerNextCell(group);
  return next ? directionBetweenCells(group, next) : '';
}

/** Сторона, с которой путник вошёл в свою зону (из предыдущей клетки маршрута). */
function travellerCameFrom(group) {
  const previous = Array.isArray(group?.route) && group.routeIndex > 0 ? group.route[group.routeIndex - 1] : null;
  return previous ? directionBetweenCells(previous, group) : '';
}

/**
 * Шаг путника в следующую клетку маршрута. Последняя клетка — город: путник
 * входит в него и отдыхает, а потом выбирает новый путь.
 */
function travellerStep(state, config, group, now = Date.now(), random = Math.random) {
  const species = config.speciesById[group.speciesId];
  const next = travellerNextCell(group);
  if (!species?.travel || !next) return null;
  const from = { sx: group.sx, sy: group.sy };
  const direction = directionBetweenCells(from, next);
  moveGroup(state, group, next.sx, next.sy);
  group.routeIndex += 1;
  const arrived = !travellerNextCell(group);
  if (arrived) {
    group.state = 'rest';
    group.route = null;
    group.routeIndex = 0;
    group.fleeing = false;
    group.restUntil = now + between(random, species.travel.restMinutes) * 60000;
    group.nextStepAt = group.restUntil;
  } else {
    group.nextStepAt = now + between(random, group.fleeing ? config.roam.huntStepSeconds : species.stepSeconds) * 1000;
  }
  state.dirty = true;
  return { from, to: next, direction, arrived };
}

/** Разбитый путник поворачивает назад, в город, откуда вышел, — той же дорогой. */
function travellerTurnBack(group, now = Date.now()) {
  if (!Array.isArray(group.route) || group.routeIndex <= 0) {
    // Ещё в городе или только вышел: возвращаться некуда, путь заново после отдыха.
    group.fleeing = false;
    return false;
  }
  group.route = group.route.slice(0, group.routeIndex + 1).reverse();
  group.routeIndex = 0;
  group.fleeing = true;
  group.state = 'travel';
  group.nextStepAt = Math.min(group.nextStepAt || now, now);
  return true;
}

/**
 * Новый путь из города: караван — в другой город, патруль — обход нескольких
 * зон вокруг своего города и назад. ctx.cities() → [{id, sx, sy}], ctx.route(from,
 * to, random) → клетки от from до to включительно (со случайной ценой переходов,
 * поэтому пути между одними городами разные).
 */
function travellerPlan(state, config, group, species, ctx, now, random) {
  const cities = typeof ctx.cities === 'function' ? ctx.cities() : [];
  const route = typeof ctx.route === 'function' ? ctx.route
    : typeof ctx.neighbors === 'function'
      ? (from, to, rnd) => planRoute(from, to, ctx.neighbors, rnd, { through: ctx.through })
      : null;
  const here = { sx: group.sx, sy: group.sy };
  let path = null;
  if (route && species.travel.mode === 'patrol') {
    const home = cities.find(city => city.id === group.home) || null;
    const stops = [];
    for (let attempt = 0; home && stops.length < species.travel.patrolStops && attempt < 40; attempt += 1) {
      const r = species.travel.patrolRadius;
      const sx = home.sx + Math.round((random() * 2 - 1) * r);
      const sy = home.sy + Math.round((random() * 2 - 1) * r);
      const mode = typeof ctx.modeAt === 'function' ? ctx.modeAt(sx, sy) : '';
      if (LIVING_MODES.includes(mode) && !stops.some(stop => stop.sx === sx && stop.sy === sy)) stops.push({ sx, sy });
    }
    if (home && stops.length) {
      path = [here];
      let from = here;
      for (const stop of [...stops, home]) {
        const segment = route(from, stop, random);
        if (!Array.isArray(segment) || segment.length < 2) { path = null; break; }
        path.push(...segment.slice(1));
        from = stop;
      }
      group.dest = home.id;
    }
  } else if (route) {
    const options = cities.filter(city => city.sx !== here.sx || city.sy !== here.sy);
    const dest = options.length ? options[Math.floor(random() * options.length)] : null;
    const segment = dest ? route(here, dest, random) : null;
    if (Array.isArray(segment) && segment.length >= 2) {
      path = segment;
      group.dest = dest.id;
    }
  }
  if (!path || path.length < 2) {
    group.restUntil = now + between(random, species.travel.restMinutes) * 60000;
    group.nextStepAt = group.restUntil;
    return false;
  }
  group.route = path.map(cell => ({ sx: cell.sx, sy: cell.sy }));
  group.routeIndex = 0;
  group.fleeing = false;
  group.state = 'travel';
  group.nextStepAt = now;
  state.dirty = true;
  return true;
}

/** Путник в городе: членов по составу вида, дом — этот город. */
function spawnTraveller(state, config, species, city, now, random = Math.random, createMember = null) {
  const members = [];
  species.members.forEach((spec, index) => {
    const count = spec.min + Math.floor(random() * (spec.max - spec.min + 1));
    for (let i = 0; i < count; i += 1) {
      const stats = typeof createMember === 'function' ? createMember(spec.type) || {} : {};
      members.push(sanitizeMember({ id: `m${members.length + 1}`, type: spec.type, spec: index, name: spec.name || stats.name, hp: stats.maxHp, maxHp: stats.maxHp }, members.length));
    }
  });
  if (!members.length) return null;
  const group = {
    id: `g${state.nextId++}`,
    speciesId: species.id,
    lairId: '',
    sx: city.sx,
    sy: city.sy,
    members,
    state: 'rest',
    target: null,
    // Путники выходят вразнобой, а не все разом.
    restUntil: now + random() * species.travel.restMinutes[1] * 60000,
    nextStepAt: 0,
    online: '',
    size0: members.length,
    bornAt: now,
    home: safeId(city.id, 64),
    dest: '',
    route: null,
    routeIndex: 0,
    fleeing: false
  };
  group.nextStepAt = group.restUntil;
  state.groups.set(group.id, group);
  indexAdd(state, group);
  state.dirty = true;
  return group;
}

/**
 * Караванов в мире и патрулей у каждого города — столько, сколько задано. Мир
 * сразу получает всех, погибших восполняет по одному за respawnMinutes.
 */
function dispatchTravellers(state, config, ctx, now, random, events) {
  const cities = typeof ctx.cities === 'function' ? ctx.cities() : [];
  if (!cities.length) return;
  if (!state.travellerNextAt) state.travellerNextAt = {};
  for (const species of config.species) {
    if (species.kind !== 'traveller' || !species.travel.count) continue;
    const alive = [...state.groups.values()].filter(group => group.speciesId === species.id);
    const slots = species.travel.mode === 'patrol'
      ? cities.map(city => ({ key: `${species.id}:${city.id}`, have: alive.filter(group => group.home === city.id).length, city }))
      : [{ key: species.id, have: alive.length, city: null }];
    const respawnMs = species.travel.respawnMinutes * 60000;
    const spawnOne = slot => {
      const city = slot.city || cities[Math.floor(random() * cities.length)];
      const group = spawnTraveller(state, config, species, city, now, random, ctx.createMember);
      if (group) events.push({ type: 'spawn', groupId: group.id, sx: group.sx, sy: group.sy });
      return group;
    };
    for (const slot of slots) {
      // Первое заселение — всех сразу.
      if (!Object.prototype.hasOwnProperty.call(state.travellerNextAt, slot.key)) {
        for (let have = slot.have; have < species.travel.count && state.groups.size < config.maxGroups; have += 1) {
          if (!spawnOne(slot)) break;
        }
        state.travellerNextAt[slot.key] = now + respawnMs;
        state.dirty = true;
        continue;
      }
      // Полный состав: часы восполнения стоят на «срок от сейчас», и замена
      // погибшим приходит не раньше чем через respawnMinutes после потери.
      if (slot.have >= species.travel.count) {
        state.travellerNextAt[slot.key] = now + respawnMs;
        continue;
      }
      if (now < state.travellerNextAt[slot.key] || state.groups.size >= config.maxGroups) continue;
      spawnOne(slot);
      state.travellerNextAt[slot.key] = now + respawnMs;
      state.dirty = true;
    }
  }
}

// --- стычки групп без игроков ---------------------------------------------------------------

/** Враждебны ли виды: ctx.hostile(a, b) или разные фракции. Фауна в стычки не тянется. */
function speciesHostile(ctx, a, b) {
  if (!a || !b || a.kind === 'fauna' || b.kind === 'fauna') return false;
  if (a.kind === 'traveller' && b.kind === 'traveller') return false;
  if (typeof ctx.hostile === 'function') return ctx.hostile(a, b) === true;
  return a.faction !== b.faction;
}

function groupPower(group, species) {
  return group.members.reduce((sum, member) => sum + Math.max(0, member.hp), 0) * (species?.combat ?? 1);
}

/** Урон группе: кусками по случайным особям; павшие — в список потерь. */
function woundGroup(group, damage, random, casualties) {
  let left = damage;
  while (left > 0.5 && group.members.length) {
    const index = Math.floor(random() * group.members.length);
    const member = group.members[index];
    const dealt = Math.min(left, Math.max(8, member.maxHp * 0.45), member.hp);
    member.hp = Math.round(member.hp - dealt);
    left -= dealt;
    if (member.hp <= 0) {
      group.members.splice(index, 1);
      casualties.push({ groupId: group.id, speciesId: group.speciesId, memberId: member.id, type: member.type, spec: member.spec, name: member.name, maxHp: member.maxHp });
    }
  }
}

/**
 * Стычка двух групп в одной зоне без игроков: несколько обменов ударами, пока
 * одна из сторон не сломается (потеряла fleeAt своего состава) или не кончатся
 * раунды. Проигравший уходит (путник — назад по своей дороге), победитель
 * задерживается на месте боя. Павшие — насовсем.
 */
function clashGroups(state, config, a, b, now = Date.now(), random = Math.random) {
  const species = new Map([[a, config.speciesById[a.speciesId]], [b, config.speciesById[b.speciesId]]]);
  const start = new Map([[a, a.members.length], [b, b.members.length]]);
  const broken = group => !group.members.length
    || 1 - group.members.length / Math.max(1, start.get(group)) >= (species.get(group)?.fleeAt ?? 0.5);
  const casualties = [];
  for (let round = 0; round < 6 && !broken(a) && !broken(b); round += 1) {
    const hitA = groupPower(b, species.get(b)) * 0.16 * (0.7 + random() * 0.6);
    const hitB = groupPower(a, species.get(a)) * 0.16 * (0.7 + random() * 0.6);
    woundGroup(a, hitA, random, casualties);
    woundGroup(b, hitB, random, casualties);
  }
  const loser = broken(a) !== broken(b)
    ? (broken(a) ? a : b)
    : (groupPower(a, species.get(a)) < groupPower(b, species.get(b)) ? a : b);
  const winner = loser === a ? b : a;
  const destroyed = [];
  for (const group of [a, b]) {
    group.clashReadyAt = now + config.roam.clashCooldownMinutes * 60000;
    if (!group.members.length) {
      indexRemove(state, group);
      state.groups.delete(group.id);
      destroyed.push(group.id);
    }
  }
  if (loser.members.length) {
    if (species.get(loser)?.kind === 'traveller') {
      travellerTurnBack(loser, now);
    } else {
      const lair = state.lairs.get(loser.lairId) || null;
      loser.state = 'return';
      loser.target = lair ? { sx: lair.sx, sy: lair.sy } : null;
      loser.shakenUntil = now + config.roam.shakenMinutes * 60000;
      loser.nextStepAt = now;
    }
  }
  // Победитель задерживается у места боя.
  if (winner.members.length) winner.nextStepAt = Math.max(Number(winner.nextStepAt || 0), now + 120000);
  state.dirty = true;
  return {
    groups: [a.id, b.id],
    species: [a.speciesId, b.speciesId],
    winner: winner.members.length ? winner.id : '',
    loser: loser.id,
    casualties,
    destroyed
  };
}

/**
 * Место стычки: павшие лежат в зоне, пока их не увидит игрок (shown — канал,
 * где их показали) или не истечёт срок. Старые места вытесняются новыми.
 */
function recordAftermath(state, sx, sy, casualties, now) {
  if (!Array.isArray(state.aftermath)) state.aftermath = [];
  if (!casualties.length) return null;
  const row = {
    id: `af${state.nextId++}`, sx, sy, at: now, shown: '',
    dead: casualties.slice(0, 24).map(dead => ({ speciesId: dead.speciesId, type: dead.type, spec: dead.spec || 0, name: dead.name || '' }))
  };
  state.aftermath.push(row);
  const here = state.aftermath.filter(site => site.sx === sx && site.sy === sy);
  for (const old of here.slice(0, Math.max(0, here.length - AFTERMATH_PER_CELL))) state.aftermath.splice(state.aftermath.indexOf(old), 1);
  if (state.aftermath.length > AFTERMATH_MAX) state.aftermath.splice(0, state.aftermath.length - AFTERMATH_MAX);
  state.dirty = true;
  return row;
}

/** Не показанные ещё места стычек в зоне (sx, sy). */
function aftermathAt(state, sx, sy, now = Date.now()) {
  return (state.aftermath || []).filter(site => site.sx === sx && site.sy === sy && !site.shown && now - site.at < AFTERMATH_TTL_MS);
}

function expireAftermath(state, now = Date.now()) {
  const before = (state.aftermath || []).length;
  state.aftermath = (state.aftermath || []).filter(site => now - site.at < AFTERMATH_TTL_MS);
  if (state.aftermath.length !== before) state.dirty = true;
}

/** Враждебные группы вне сцен, стоящие в одной зоне без игроков, сходятся в стычке. */
function resolveClashes(state, config, ctx, now, random, minutes, events) {
  if (!(minutes > 0) || !(config.roam.clashPerMinute > 0)) return;
  const occupied = typeof ctx.occupied === 'function' ? ctx.occupied : () => false;
  for (const key of [...state.cellIndex.keys()]) {
    const ids = state.cellIndex.get(key);
    if (!ids || ids.size < 2) continue;
    const here = [...ids].map(id => state.groups.get(id)).filter(group => group && !group.online);
    if (here.length < 2 || occupied(here[0].sx, here[0].sy)) continue;
    for (let i = 0; i < here.length; i += 1) {
      for (let j = i + 1; j < here.length; j += 1) {
        const a = here[i];
        const b = here[j];
        if (!state.groups.has(a.id) || !state.groups.has(b.id)) continue;
        if (now < Number(a.clashReadyAt || 0) || now < Number(b.clashReadyAt || 0)) continue;
        const sa = config.speciesById[a.speciesId];
        const sb = config.speciesById[b.speciesId];
        if (!speciesHostile(ctx, sa, sb)) continue;
        const aggression = Math.max(sa.aggression, sb.aggression);
        if (random() >= 1 - Math.exp(-config.roam.clashPerMinute * aggression * minutes)) continue;
        const { sx, sy } = a;
        const result = clashGroups(state, config, a, b, now, random);
        const site = recordAftermath(state, sx, sy, result.casualties, now);
        events.push({ type: 'clash', sx, sy, at: now, aftermathId: site?.id || '', ...result });
      }
    }
  }
}

/** Ближайшая занятая сцена в пределах чутья вида (по Чебышёву). */
function sensePrey(group, species, occupiedCells = []) {
  let best = null;
  let bestDistance = Infinity;
  for (const cell of occupiedCells) {
    const distance = Math.max(Math.abs(cell.sx - group.sx), Math.abs(cell.sy - group.sy));
    if (distance === 0 || distance > species.perceptionCells) continue;
    if (distance < bestDistance) {
      best = { sx: cell.sx, sy: cell.sy };
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Один проход жизни мира. ctx: modeAt(sx, sy) — цвет клетки (или пусто вне
 * мира), canStep(fromSx, fromSy, sx, sy) — открыт ли проход между соседними
 * клетками (необязательно), occupied(sx, sy) — есть ли там сцена с игроками,
 * occupiedCells — список таких клеток, createMember(type) → {maxHp, name}.
 * Возвращает события: spawn, move, arrive (группа вошла в занятую клетку).
 */
function tickEcology(state, config, ctx = {}, now = Date.now(), random = Math.random) {
  const events = [];
  const occupied = typeof ctx.occupied === 'function' ? ctx.occupied : () => false;
  const occupiedCells = Array.isArray(ctx.occupiedCells) ? ctx.occupiedCells : [];
  const minutes = Math.max(0, (now - (state.lastTickAt || now)) / 60000);
  state.lastTickAt = now;

  // Пополнение логов: медленно и только без игроков в клетке логова. Под пределом
  // групп первыми встают пустые и дольше всех ждавшие логова, а не первые по списку.
  const counts = lairGroupCounts(state);
  const refillOrder = [...state.lairs.values()]
    .sort((a, b) => ((counts.get(a.id) || 0) - (counts.get(b.id) || 0)) || (a.refillAt - b.refillAt));
  for (const lair of refillOrder) {
    if (state.groups.size >= config.maxGroups) break;
    const capacity = config.lairs.capacity[lair.mode] || 0;
    if ((counts.get(lair.id) || 0) >= capacity || now < lair.refillAt || occupied(lair.sx, lair.sy)) continue;
    const group = spawnGroup(state, config, lair, now, random, ctx.createMember);
    lair.refillAt = now + (config.lairs.refillMinutes[lair.mode] || 60) * 60000;
    if (group) {
      counts.set(lair.id, (counts.get(lair.id) || 0) + 1);
      events.push({ type: 'spawn', groupId: group.id, sx: group.sx, sy: group.sy });
    }
  }

  for (const group of state.groups.values()) {
    if (group.online) continue;
    const species = config.speciesById[group.speciesId];
    if (!species) continue;
    // Раненые без игроков понемногу поправляются.
    if (minutes > 0 && config.woundHealPerMinute > 0) {
      for (const member of group.members) {
        if (member.hp < member.maxHp) member.hp = Math.min(member.maxHp, Math.round(member.hp + member.maxHp * config.woundHealPerMinute * minutes));
      }
    }
    const due = now >= group.nextStepAt;
    // Путники идут своим маршрутом: из города в город или обходом у своего города.
    if (species.kind === 'traveller') {
      if (!due) continue;
      if (group.state !== 'travel' || !travellerNextCell(group)) {
        travellerPlan(state, config, group, species, ctx, now, random);
        continue;
      }
      const stepped = travellerStep(state, config, group, now, random);
      if (!stepped) continue;
      events.push({ type: 'move', groupId: group.id, from: stepped.from, to: stepped.to, direction: stepped.direction });
      if (!stepped.arrived && occupied(group.sx, group.sy)) {
        events.push({ type: 'arrive', groupId: group.id, sx: group.sx, sy: group.sy, direction: stepped.direction });
      }
      continue;
    }
    // Отдыхающая группа между шагами прислушивается: стрельба и шум в
    // сценах рядом поднимают её раньше конца отдыха.
    if (!due) {
      if (group.state !== 'rest' || !occupiedCells.length || now < Number(group.nextSenseAt || 0)) continue;
      group.nextSenseAt = now + config.roam.senseSeconds * 1000;
    }
    const lair = state.lairs.get(group.lairId) || null;
    const home = lair ? { sx: lair.sx, sy: lair.sy } : null;

    // Чутьё: игроки в сценах рядом привлекают группу — кроме сломленной.
    if (group.state !== 'hunt' && group.state !== 'flee' && now >= Number(group.shakenUntil || 0)) {
      const prey = sensePrey(group, species, occupiedCells);
      if (prey && random() < species.aggression) {
        group.state = 'hunt';
        group.target = prey;
        state.dirty = true;
      }
    }
    if (!due && group.state !== 'hunt') continue;
    if (group.state === 'hunt' && (!group.target || !occupied(group.target.sx, group.target.sy))) {
      group.state = 'return';
      group.target = home;
    }
    if (group.state === 'rest') {
      if (now < group.restUntil) {
        group.nextStepAt = group.restUntil;
        continue;
      }
      group.state = 'roam';
      // Иногда после отдыха группа уходит в дальний обход — за несколько зон.
      group.target = random() < species.migrateChance
        ? pickRoamTarget(group, species, lair, ctx, random, config.roam.migrateRadius)
        : pickRoamTarget(group, species, lair, ctx, random);
    }
    if ((group.state === 'return' || group.state === 'flee') && !group.target) group.target = home;
    if (!group.target || (group.target.sx === group.sx && group.target.sy === group.sy)) {
      // Цель достигнута: обход → дальше (с вероятностью wander) или домой, домой → отдых.
      if (group.state === 'roam' && random() < species.wander) {
        group.target = pickRoamTarget(group, species, lair, ctx, random);
      } else if (group.state === 'roam') {
        group.state = 'return';
        group.target = home;
      } else {
        group.state = 'rest';
        group.target = null;
        group.restUntil = now + between(random, config.roam.restMinutes) * 60000;
        group.nextStepAt = group.restUntil;
        state.dirty = true;
        continue;
      }
      if (!group.target || (group.target.sx === group.sx && group.target.sy === group.sy)) {
        group.state = 'rest';
        group.target = null;
        group.restUntil = now + between(random, config.roam.restMinutes) * 60000;
        group.nextStepAt = group.restUntil;
        state.dirty = true;
        continue;
      }
    }
    const direction = stepToward(group, group.target, species, ctx, random);
    const pace = group.state === 'hunt' || group.state === 'flee' ? config.roam.huntStepSeconds : species.stepSeconds;
    group.nextStepAt = now + between(random, pace) * 1000;
    if (!direction) {
      group.state = 'rest';
      group.target = null;
      group.restUntil = group.nextStepAt;
      continue;
    }
    const from = { sx: group.sx, sy: group.sy };
    const step = STEPS[direction];
    moveGroup(state, group, group.sx + step.dx, group.sy + step.dy);
    events.push({ type: 'move', groupId: group.id, from, to: { sx: group.sx, sy: group.sy }, direction });
    if (occupied(group.sx, group.sy)) events.push({ type: 'arrive', groupId: group.id, sx: group.sx, sy: group.sy, direction });
  }
  dispatchTravellers(state, config, ctx, now, random, events);
  resolveClashes(state, config, ctx, now, random, minutes, events);
  expireAftermath(state, now);
  return events;
}

// --- сцена ----------------------------------------------------------------------------------

function groupsAt(state, sx, sy) {
  const set = state.cellIndex.get(cellKey(sx, sy));
  return set ? [...set].map(id => state.groups.get(id)).filter(Boolean) : [];
}

/** Ближайшая группа вне сети в пределах radius клеток (для стычки «наткнулись»). */
function nearestOfflineGroup(state, sx, sy, radius = 3, filter = null) {
  let best = null;
  let bestDistance = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (distance >= bestDistance) continue;
      for (const group of groupsAt(state, sx + dx, sy + dy)) {
        if (group.online || (typeof filter === 'function' && !filter(group))) continue;
        best = group;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function setGroupOnline(state, group, roomId = '') {
  group.online = String(roomId || '');
  state.dirty = true;
}

/**
 * Группа уходит из сцены: здоровье выживших — из сцены (hpByMember), особи,
 * которых в сцене нет и которые не погибли, сохраняют прежнее.
 */
function setGroupOffline(state, group, hpByMember = new Map(), now = Date.now(), config = null) {
  for (const member of group.members) {
    if (hpByMember.has(member.id)) member.hp = Math.max(1, Math.min(member.maxHp, Math.round(Number(hpByMember.get(member.id)) || member.hp)));
  }
  // Бежавшая группа идёт домой и какое-то время не лезет обратно на шум;
  // разбитый путник поворачивает назад своей дорогой.
  if (group.state === 'flee' && group.home !== undefined) {
    if (!travellerTurnBack(group, now)) group.state = 'rest';
  } else if (group.state === 'flee') {
    group.state = 'return';
    group.target = null;
    group.shakenUntil = now + (config?.roam?.shakenMinutes ?? DEFAULT_CONFIG.roam.shakenMinutes) * 60000;
  }
  group.online = '';
  if (group.nextStepAt < now) group.nextStepAt = now;
  state.dirty = true;
}

/** Гибель особи: насовсем. Группа без особей исчезает; большие потери — бегство. */
function memberKilled(state, config, groupId = '', memberId = '') {
  const group = state.groups.get(String(groupId || ''));
  if (!group) return { ok: false };
  const index = group.members.findIndex(member => member.id === memberId);
  if (index < 0) return { ok: false };
  group.members.splice(index, 1);
  state.dirty = true;
  if (!group.members.length) {
    indexRemove(state, group);
    state.groups.delete(group.id);
    return { ok: true, destroyed: true, group };
  }
  const species = config.speciesById[group.speciesId];
  const lost = 1 - group.members.length / Math.max(1, group.size0);
  const fleeing = !!species && lost >= species.fleeAt && group.state !== 'flee';
  if (fleeing) {
    group.state = 'flee';
    group.target = null;
  }
  return { ok: true, destroyed: false, fleeing, group };
}

function groupStrength(group) {
  return group.members.reduce((sum, member) => sum + Math.max(0, member.hp), 0);
}

/** Наблюдение группы на карте: центр мелкой клетки в точках карты. */
function groupSighting(group, species, subCellPoints = 1.6) {
  return {
    id: group.id,
    speciesId: group.speciesId,
    name: species?.name || group.speciesId,
    kind: species?.kind || 'monster',
    x: Number(((group.sx + 0.5) * subCellPoints).toFixed(2)),
    y: Number(((group.sy + 0.5) * subCellPoints).toFixed(2)),
    size: group.members.length
  };
}

function ecologySummary(state, config) {
  const bySpecies = {};
  for (const group of state.groups.values()) {
    const row = bySpecies[group.speciesId] || (bySpecies[group.speciesId] = { groups: 0, members: 0, online: 0 });
    row.groups += 1;
    row.members += group.members.length;
    if (group.online) row.online += 1;
  }
  const lairsByMode = {};
  for (const lair of state.lairs.values()) lairsByMode[lair.mode] = (lairsByMode[lair.mode] || 0) + 1;
  return {
    version: ECOLOGY_VERSION,
    mapRevision: state.mapRevision,
    lairs: state.lairs.size,
    lairsByMode,
    groups: state.groups.size,
    species: config.species.map(row => row.id),
    bySpecies
  };
}

module.exports = {
  ECOLOGY_VERSION,
  LIVING_MODES,
  HUMAN_TYPES,
  STEPS,
  normalizeEcologyConfig,
  emptyEcologyState,
  normalizeEcologyState,
  serializeEcologyState,
  buildLairs,
  resetLairs,
  purgeGroups,
  spawnGroup,
  tickEcology,
  groupsAt,
  nearestOfflineGroup,
  moveGroup,
  setGroupOnline,
  setGroupOffline,
  memberKilled,
  groupStrength,
  groupSighting,
  directionBetweenCells,
  canEnter,
  planRoute,
  travellerNextCell,
  travellerNextDirection,
  travellerCameFrom,
  travellerStep,
  travellerTurnBack,
  speciesHostile,
  clashGroups,
  aftermathAt,
  AFTERMATH_TTL_MS,
  ecologySummary,
  cellKey,
  hash01
};
