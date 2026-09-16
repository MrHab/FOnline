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
  roomIdleResetMs: 600000,
  // Обстоятельства встречи: обычно стая бродит поодаль, иногда поджидает
  // вплотную, иногда приходит смешанной — с гостем другого вида.
  // Встречи приходят к идущему: между проверками отряд должен пройти по
  // области хоть сколько-то. Стоящий на месте лагерь зверей не собирает.
  distancePerRollM: 90,
  ambushChance: 0.25,
  ambushMinPlayerDistance: 6,
  mixedChance: 0.25,
  mixedCompanionCount: 1
});

// Столько силуэтов области нарисовано в клиенте (`RoaGlobalMapZoneShapes`).
// Номер контура — авторское поле области, а не догадка карты.
const PVE_AREA_SHAPES = 3;

// Полоса опасности словом. Карточка области на карте говорит «сложность:
// высокая», а не «опасность 4»: цифра ничего не значит для игрока.
const DANGER_BAND_LABELS = Object.freeze(['низкая', 'низкая', 'умеренная', 'средняя', 'высокая', 'крайняя']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function dangerBandLabel(band = 1) {
  return DANGER_BAND_LABELS[clamp(Math.floor(Number(band || 1)), 0, 5)] || 'средняя';
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
    roomIdleResetMs: Math.max(10000, Math.floor(Number(src.roomIdleResetMs || DEFAULT_RULES.roomIdleResetMs))),
    distancePerRollM: Math.max(0, Number(src.distancePerRollM ?? DEFAULT_RULES.distancePerRollM)),
    ambushChance: clamp(Number(src.ambushChance ?? DEFAULT_RULES.ambushChance), 0, 1),
    ambushMinPlayerDistance: Math.max(2, Number(src.ambushMinPlayerDistance || DEFAULT_RULES.ambushMinPlayerDistance)),
    mixedChance: clamp(Number(src.mixedChance ?? DEFAULT_RULES.mixedChance), 0, 1),
    mixedCompanionCount: Math.max(1, Math.floor(Number(src.mixedCompanionCount || DEFAULT_RULES.mixedCompanionCount)))
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
      // Игрок видит область до входа: её границы на карте, оценку опасности и
      // характерные категории добычи. Всё это авторские данные, а не догадка
      // клиента по типу узла.
      radiusPoints: clamp(Number(input?.radiusPoints ?? 24), 4, 80),
      dangerBand: clamp(Math.floor(Number(input?.dangerBand ?? 1)), 1, 5),
      lootCategories: (Array.isArray(input?.lootCategories) ? input.lootCategories : [])
        .map(row => String(row || '').slice(0, 64)).filter(Boolean).slice(0, 6),
      // Силуэт области на карте. Клиент не выдумывает форму: он берёт один из
      // нарисованных контуров по номеру и поворачивает его на заданный угол,
      // поэтому две соседние области не выглядят близнецами.
      shape: clamp(Math.floor(Number(input?.shape ?? 1)), 1, PVE_AREA_SHAPES),
      shapeRotation: ((Math.floor(Number(input?.shapeRotation ?? 0)) % 360) + 360) % 360,
      objective: String(input?.objective || 'зачистить угодья').slice(0, 64),
      activity: String(input?.activity || 'всегда').slice(0, 32),
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

/**
 * Что область реально отдаёт: предметы из таблиц добычи её же обитателей.
 * Карточка на карте обещает только это, поэтому обещание нельзя разойтись с
 * дропом — список считается из тех же таблиц, по которым падает лут.
 */
function pveAreaRewardIds(area = {}, lootTables = {}, tierFor = null, limit = 4) {
  const ids = [];
  for (const pack of Array.isArray(area?.packs) ? area.packs : []) {
    const creature = cleanId(pack?.creatureTypeId, 32);
    // Полка добычи стаи резолвится так же, как в бою: по существу целиком, а
    // не по одному идентификатору — стая может быть задана и именем типа.
    const key = typeof tierFor === 'function' ? cleanId(tierFor(pack), 48) : creature;
    for (const row of Array.isArray(lootTables?.[key]) ? lootTables[key] : []) {
      for (const candidate of Array.isArray(row?.oneOf) ? row.oneOf : [row?.id]) {
        const id = cleanId(candidate, 48);
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids.slice(0, Math.max(1, Math.floor(Number(limit || 4))));
}

/**
 * Каталог областей для клиента: название, границы, опасность, обитатели и
 * категории добычи. Точку центра сервер берёт из узла глобальной карты, потому
 * что координаты мира живут там. Силуэт, цель, периоды активности, слово
 * опасности и превью награды едут рядом: карта ничего из этого не сочиняет.
 */
function publicPveAreaCatalog(catalog = {}, pointForLocation = null, options = {}) {
  const rewardIdsFor = typeof options?.rewardIdsFor === 'function' ? options.rewardIdsFor : null;
  const itemName = typeof options?.itemName === 'function' ? options.itemName : null;
  return (Array.isArray(catalog?.areas) ? catalog.areas : []).map(area => {
    const point = typeof pointForLocation === 'function' ? pointForLocation(area.locationId) : null;
    const rewardIds = rewardIdsFor ? (rewardIdsFor(area) || []) : [];
    return {
      id: area.id,
      locationId: area.locationId,
      // Зона мира этих угодий: по этому идентификатору сервер подтверждает
      // контакт на маршруте, поэтому клиент не выдумывает его сам.
      worldZoneId: pveAreaZoneId(area.id),
      displayName: area.displayName,
      x: Number(point?.x ?? 0),
      y: Number(point?.y ?? 0),
      radiusPoints: area.radiusPoints,
      shape: area.shape,
      shapeRotation: area.shapeRotation,
      danger: area.dangerBand,
      dangerLabel: dangerBandLabel(area.dangerBand),
      objective: area.objective,
      activity: area.activity,
      personal: true,
      inhabitants: area.packs.map(pack => String(pack.label || pack.typeName || pack.creatureTypeId || '')).filter(Boolean),
      lootCategories: [...area.lootCategories],
      rewardPreview: rewardIds.slice(0, 4).map(id => ({
        id: cleanId(id, 48),
        name: itemName ? String(itemName(id) || id).slice(0, 48) : String(id)
      })).filter(row => row.id)
    };
  });
}

/**
 * Зона угодий на глобальной карте. Без неё путь сквозь контур ничего не значит:
 * сервер сверяет контакт в пути со своими зонами мира, а каталог областей он
 * для этого не смотрит. Зона постоянная — угодья не истекают, как событие.
 */
function pveAreaZoneId(areaId = '') {
  return `pvearea_${cleanId(areaId)}`.slice(0, 64);
}

function pveAreaZone(area = {}, point = { x: 0, y: 0 }, worldHour = 0) {
  return {
    id: pveAreaZoneId(area?.id),
    kind: 'pveArea',
    status: 'active',
    title: String(area?.displayName || 'Угодья').slice(0, 96),
    text: `Угодья обитателей. ${String(area?.objective || 'зачистить угодья')}.`.slice(0, 420),
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0),
    radius: Math.max(2, Number(area?.radiusPoints ?? 24)),
    priority: 2,
    sourceType: 'pve_area',
    sourceId: cleanId(area?.id),
    locationId: cleanId(area?.locationId || area?.id),
    pvpMode: 'pve',
    createdHour: Number(worldHour || 0),
    // Личная встреча: вход всегда по выбору игрока, «Обойти» обязано работать.
    forced: false,
    details: {
      pveArea: true,
      areaId: cleanId(area?.id),
      danger: Number(area?.dangerBand ?? 1),
      hidden: false,
      visible: true,
      forced: false
    }
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
    lastCircumstance: 'wandering',
    // Пройденное по области расстояние с последней проверки.
    distanceSinceRollM: 0,
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

/**
 * Обстоятельства встречи. Стая приходит по-разному: обычно бродит поодаль,
 * иногда поджидает вплотную (засада), иногда приводит с собой соседа другого
 * вида (смешанная). Спутник выбирается из других пачек области, поэтому
 * «обстоятельства» остаются авторскими: чего в области нет, то и не придёт.
 */
function chooseCircumstance(area = {}, pack = null, rules = DEFAULT_RULES, random = Math.random) {
  if (!pack) return null;
  const roll = random();
  if (roll < Number(rules.ambushChance || 0)) {
    return { kind: 'ambush', label: 'засада', companion: null };
  }
  if (roll < Number(rules.ambushChance || 0) + Number(rules.mixedChance || 0)) {
    const others = (area.packs || []).filter(row => row.id !== pack.id && row.weight > 0);
    if (others.length) {
      const companion = others[Math.min(others.length - 1, Math.floor(random() * others.length))];
      return {
        kind: 'mixed',
        label: 'смешанная стая',
        companion: { ...companion, spawnCount: Math.max(1, Math.floor(Number(rules.mixedCompanionCount || 1))) }
      };
    }
  }
  return { kind: 'wandering', label: '', companion: null };
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
/**
 * Пройденное отрядом расстояние внутри области. Частота встреч считается по
 * нему, а не только по часам: кто идёт — встречает, кто стоит — нет.
 */
function notePveDistance(state = {}, metres = 0) {
  const step = Math.max(0, Number(metres) || 0);
  if (!step) return Number(state.distanceSinceRollM || 0);
  state.distanceSinceRollM = Number(state.distanceSinceRollM || 0) + step;
  return state.distanceSinceRollM;
}

function rollPveEncounter(state = {}, area = {}, rules = DEFAULT_RULES, now = Date.now(), options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const aliveCount = Math.max(0, Math.floor(Number(options.aliveCount || 0)));
  if (options.occupied === false) return { rolled: false, spawn: null, reason: 'empty' };
  if (Number(now) < Number(state.nextRollAt || 0)) return { rolled: false, spawn: null, reason: 'cooldown' };
  // Проверка не делается, пока отряд не прошёл свою долю пути по области.
  const needed = Math.max(0, Number(rules.distancePerRollM || 0));
  if (needed > 0 && Number(state.distanceSinceRollM || 0) < needed) {
    state.lastResult = 'still';
    return { rolled: false, spawn: null, reason: 'still' };
  }
  state.distanceSinceRollM = 0;
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
  const circumstance = chooseCircumstance(area, pack, rules, random);
  state.packsSpawned += 1;
  state.lastResult = 'spawned';
  state.lastPackLabel = pack.label;
  state.lastCircumstance = circumstance?.kind || 'wandering';
  return { rolled: true, spawn: { ...pack, circumstance }, reason: 'spawned' };
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
  // По следам идут сами: засады тут не бывает, но соседи по области прийти
  // вместе со стаей могут.
  const circumstance = chooseCircumstance(area, pack, { ...rules, ambushChance: 0 }, random);
  state.calmUntil = 0;
  state.packsSpawned += 1;
  state.lastResult = 'tracked';
  state.lastPackLabel = pack.label;
  state.lastCircumstance = circumstance?.kind || 'wandering';
  return { ok: true, spawn: { ...pack, circumstance }, reason: 'tracked' };
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
  still: 'Пока стоим на месте — никого.',
  noTracks: 'Следов не нашлось.',
  tracked: 'По следам вышла группа.',
  cleared: 'Область зачищена — затишье.'
});

// Обстоятельства встречи игрок должен слышать словами, а не угадывать по
// тому, что звери вдруг оказались вплотную.
const CIRCUMSTANCE_LABELS = Object.freeze({
  wandering: '',
  ambush: 'Они уже рядом — засада.',
  mixed: 'Пришли не одни: стая смешанная.'
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
    // Сколько ещё пройти по области до следующей проверки: встречи приходят
    // к идущему, и игрок должен это видеть.
    distanceToRollM: Math.max(0, Math.round(Number(rules.distancePerRollM || 0) - Number(state.distanceSinceRollM || 0))),
    calmSeconds: Math.max(0, Math.round((Number(state.calmUntil || 0) - Number(now)) / 1000)),
    tracksReadyInSeconds: Math.max(0, Math.round((Number(state.tracksReadyAt || 0) - Number(now)) / 1000)),
    rolls: Number(state.rolls || 0),
    packsSpawned: Number(state.packsSpawned || 0),
    kills: Number(state.kills || 0),
    lastResult: String(state.lastResult || 'idle'),
    lastResultLabel: [
      RESULT_LABELS[String(state.lastResult || 'idle')] || RESULT_LABELS.idle,
      ['spawned', 'tracked'].includes(String(state.lastResult || ''))
        ? (CIRCUMSTANCE_LABELS[String(state.lastCircumstance || 'wandering')] || '')
        : ''
    ].filter(Boolean).join(' '),
    lastPackLabel: String(state.lastPackLabel || ''),
    lastCircumstance: String(state.lastCircumstance || 'wandering'),
    members: Math.max(0, Math.floor(Number(extra.members || 0)))
  };
}

module.exports = {
  chooseCircumstance,
  notePveDistance,
  publicPveAreaCatalog,
  dangerBandLabel,
  pveAreaRewardIds,
  pveAreaZone,
  pveAreaZoneId,
  PVE_AREA_SHAPES,
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
