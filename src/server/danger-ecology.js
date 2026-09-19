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
const LIVING_MODES = Object.freeze(['pvp', 'pvpFullDrop', 'pvpBlack']);
const GROUP_STATES = Object.freeze(['rest', 'roam', 'return', 'hunt', 'flee']);

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
    density: Object.freeze({ pvp: 0.01, pvpFullDrop: 0.03, pvpBlack: 0.18 }),
    capacity: Object.freeze({ pvp: 1, pvpFullDrop: 2, pvpBlack: 2 }),
    refillMinutes: Object.freeze({ pvp: 120, pvpFullDrop: 75, pvpBlack: 45 }),
    placeClearKm: 4.5
  }),
  roam: Object.freeze({
    restMinutes: Object.freeze([4, 10]),
    stepSeconds: Object.freeze([70, 160]),
    huntStepSeconds: Object.freeze([35, 70]),
    // Как часто отдыхающая группа прислушивается к сценам с игроками рядом.
    senseSeconds: 30,
    // Сколько сломленная группа после бегства не идёт на шум.
    shakenMinutes: 10,
    radius: 2
  }),
  // Восприятие на глобальной карте: радиус видимости групп и игроков.
  sightings: Object.freeze({
    baseKm: 6,
    maxGroups: 40,
    maxPlayers: 30
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
  const kind = ['raider', 'monster', 'fauna'].includes(row.kind) ? row.kind : 'monster';
  return Object.freeze({
    id,
    name: cleanText(row.name, 80) || id,
    kind,
    // Мирная фауна (фонарники) никого не трогает и в стычку не тянется.
    hostile: kind !== 'fauna' && row.hostile !== false,
    faction: safeId(row.faction, 48),
    members: Object.freeze(members),
    habitat,
    regions: Object.freeze(regions),
    roamRadius: Math.floor(finite(row.roamRadius, roam.radius, 1, 6)),
    perceptionCells: Math.floor(finite(row.perceptionCells, 2, 0, 6)),
    aggression: finite(row.aggression, 0.6, 0, 1),
    fleeAt: finite(row.fleeAt, 0.5, 0.05, 1),
    stepSeconds: row.stepSeconds ? range(row.stepSeconds, roam.stepSeconds, 1, 3600) : roam.stepSeconds
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
    radius: Math.floor(finite(roamSrc.radius, DEFAULT_CONFIG.roam.radius, 1, 6))
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
      refillMinutes: modeTable(lairs.refillMinutes, DEFAULT_CONFIG.lairs.refillMinutes, 1, 10080),
      placeClearKm: finite(lairs.placeClearKm, DEFAULT_CONFIG.lairs.placeClearKm, 0, 50)
    }),
    roam,
    sightings: Object.freeze({
      baseKm: finite(src.sightings?.baseKm, DEFAULT_CONFIG.sightings.baseKm, 0, 200),
      maxGroups: Math.floor(finite(src.sightings?.maxGroups, DEFAULT_CONFIG.sightings.maxGroups, 0, 500)),
      maxPlayers: Math.floor(finite(src.sightings?.maxPlayers, DEFAULT_CONFIG.sightings.maxPlayers, 0, 500))
    }),
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
      bornAt: Math.max(0, Number(row.bornAt) || 0)
    };
    state.groups.set(id, group);
    indexAdd(state, group);
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
      bornAt: group.bornAt
    }))
  };
}

// --- логова ---------------------------------------------------------------------------------

function pickSpecies(config, mode, region, roll) {
  const weights = config.species.map(row => row.habitat[mode] * (row.regions[region] ?? 1));
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
 * Логова по клеткам-кандидатам: {sx, sy, mode, region} — играбельные мелкие
 * клетки живых цветов вдали от мест карты. Расстановка детерминирована по
 * ревизии карты: тот же мир даёт те же логова.
 */
function buildLairs(config, candidates = [], mapRevision = '') {
  const lairs = [];
  for (const cell of Array.isArray(candidates) ? candidates : []) {
    const mode = LIVING_MODES.includes(cell?.mode) ? cell.mode : '';
    if (!mode) continue;
    const density = config.lairs.density[mode] || 0;
    const key = cellKey(cell.sx, cell.sy);
    if (!(density > 0) || hash01(`${mapRevision}:lair:${key}`) >= density) continue;
    const species = pickSpecies(config, mode, safeId(cell.region, 48), hash01(`${mapRevision}:species:${key}`));
    if (!species) continue;
    lairs.push({ id: `lair_${key.replace(/-/g, 'm')}`, speciesId: species.id, sx: cell.sx, sy: cell.sy, mode, region: safeId(cell.region, 48), refillAt: 0 });
  }
  return lairs;
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

function canEnter(species, ctx, sx, sy) {
  const mode = typeof ctx.modeAt === 'function' ? ctx.modeAt(sx, sy) : '';
  return LIVING_MODES.includes(mode) && species.habitat[mode] > 0;
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
    if (canEnter(species, ctx, group.sx + step.dx, group.sy + step.dy)) return direction;
  }
  // Обход препятствия: любой проходимый сосед.
  const around = Object.keys(STEPS).sort(() => random() - 0.5);
  for (const direction of around) {
    const step = STEPS[direction];
    if (canEnter(species, ctx, group.sx + step.dx, group.sy + step.dy)) return direction;
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

function pickRoamTarget(group, species, lair, ctx, random) {
  const home = lair || { sx: group.sx, sy: group.sy };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sx = home.sx + Math.round((random() * 2 - 1) * species.roamRadius);
    const sy = home.sy + Math.round((random() * 2 - 1) * species.roamRadius);
    if ((sx !== group.sx || sy !== group.sy) && canEnter(species, ctx, sx, sy)) return { sx, sy };
  }
  return { sx: home.sx, sy: home.sy };
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
 * Один проход жизни мира. ctx: modeAt(sx, sy) — цвет мелкой клетки (или
 * пусто вне карты), occupied(sx, sy) — есть ли там сцена с игроками,
 * occupiedCells — список таких клеток, createMember(type) → {maxHp, name}.
 * Возвращает события: spawn, move, arrive (группа вошла в занятую клетку).
 */
function tickEcology(state, config, ctx = {}, now = Date.now(), random = Math.random) {
  const events = [];
  const occupied = typeof ctx.occupied === 'function' ? ctx.occupied : () => false;
  const occupiedCells = Array.isArray(ctx.occupiedCells) ? ctx.occupiedCells : [];
  const minutes = Math.max(0, (now - (state.lastTickAt || now)) / 60000);
  state.lastTickAt = now;

  // Пополнение логов: медленно и только без игроков в клетке логова.
  const counts = lairGroupCounts(state);
  for (const lair of state.lairs.values()) {
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
      group.target = pickRoamTarget(group, species, lair, ctx, random);
    }
    if ((group.state === 'return' || group.state === 'flee') && !group.target) group.target = home;
    if (!group.target || (group.target.sx === group.sx && group.target.sy === group.sy)) {
      // Цель достигнута: обход → домой, домой → отдых.
      if (group.state === 'roam') {
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
  // Бежавшая группа идёт домой и какое-то время не лезет обратно на шум.
  if (group.state === 'flee') {
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
  STEPS,
  normalizeEcologyConfig,
  emptyEcologyState,
  normalizeEcologyState,
  serializeEcologyState,
  buildLairs,
  resetLairs,
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
  ecologySummary,
  cellKey,
  hash01
};
