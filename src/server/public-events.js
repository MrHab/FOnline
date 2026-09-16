'use strict';

const { normalizeScenarioState, normalizeScenarioTemplate } = require('./public-event-scenarios');
// Полоса опасности словом живёт в одном месте: узел события и постоянная
// область обязаны называть «среднюю» одинаково.
const { dangerBandLabel } = require('./pve-areas');

// Временные публичные события пустоши: логова мутантов и базы налётчиков.
// Одно событие = одна общая комната шаблонной локации, зона на глобальной
// карте, ограниченное время жизни с предупреждением, спорный сундук после
// зачистки (45–60 с) и задержка возврата после смерти (60–90 с). Время и
// генератор случайных чисел инжектируются — проверки идут без ожидания.

const STORE_VERSION = 1;

const DEFAULT_RULES = Object.freeze({
  maxActive: 3,
  spawnIntervalMs: 900000,
  initialSpawnDelayMs: 60000,
  minLifetimeMs: 1800000,
  maxLifetimeMs: 2700000,
  expiryWarningMs: 300000,
  chestOpenDelayMs: [45000, 60000],
  deathRejoinDelayMs: [60000, 90000],
  zoneRadius: 9,
  chestChannelMs: 8000,
  chestChannelRangeM: 2.5,
  chestContestRangeM: 14,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function cleanId(value = '', max = 64) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
}

function rangeMs(input, fallback) {
  const source = Array.isArray(input) && input.length >= 2 ? input : fallback;
  const min = Math.max(0, Math.floor(Number(source[0] || 0)));
  const max = Math.max(min, Math.floor(Number(source[1] || min)));
  return [min, max];
}

function rollRange(range = [0, 0], random = Math.random) {
  return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
}

function normalizePublicEventRules(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const minLifetimeMs = Math.max(60000, Math.floor(Number(src.minLifetimeMs || DEFAULT_RULES.minLifetimeMs)));
  return {
    maxActive: Math.max(1, Math.floor(Number(src.maxActive || DEFAULT_RULES.maxActive))),
    spawnIntervalMs: Math.max(10000, Math.floor(Number(src.spawnIntervalMs || DEFAULT_RULES.spawnIntervalMs))),
    initialSpawnDelayMs: Math.max(0, Math.floor(Number(src.initialSpawnDelayMs ?? DEFAULT_RULES.initialSpawnDelayMs))),
    minLifetimeMs,
    maxLifetimeMs: Math.max(minLifetimeMs, Math.floor(Number(src.maxLifetimeMs || DEFAULT_RULES.maxLifetimeMs))),
    expiryWarningMs: Math.max(10000, Math.floor(Number(src.expiryWarningMs || DEFAULT_RULES.expiryWarningMs))),
    chestOpenDelayMs: rangeMs(src.chestOpenDelayMs, DEFAULT_RULES.chestOpenDelayMs),
    // Вскрытие тайника — процесс: держать канал столько миллисекунд, стоя не
    // дальше chestChannelRangeM, пока рядом нет чужих (ближе chestContestRangeM).
    chestChannelMs: Math.max(1000, Math.floor(Number(src.chestChannelMs ?? DEFAULT_RULES.chestChannelMs))),
    chestChannelRangeM: clamp(Number(src.chestChannelRangeM ?? DEFAULT_RULES.chestChannelRangeM), 1, 12),
    chestContestRangeM: clamp(Number(src.chestContestRangeM ?? DEFAULT_RULES.chestContestRangeM), 1, 40),
    deathRejoinDelayMs: rangeMs(src.deathRejoinDelayMs, DEFAULT_RULES.deathRejoinDelayMs),
    zoneRadius: clamp(Number(src.zoneRadius || DEFAULT_RULES.zoneRadius), 2, 28)
  };
}

function normalizeTemplate(input = {}) {
  const id = cleanId(input?.id);
  const locationId = cleanId(input?.locationId);
  const encounterId = cleanId(input?.encounterId);
  if (!id || !locationId || !encounterId) return null;
  const kind = String(input?.kind || '') === 'raiderBase' ? 'raiderBase' : 'monsterLair';
  const chest = input?.chest && typeof input.chest === 'object' ? input.chest : {};
  // Мини-босс сценария: без него событие нельзя зачистить, а награда не
  // открывается. Опасность объявляется автором, а не угадывается по клетке.
  const bossRaw = input?.boss && typeof input.boss === 'object' ? input.boss : null;
  const boss = bossRaw && cleanId(bossRaw.id) ? {
    id: cleanId(bossRaw.id),
    displayName: String(bossRaw.displayName || 'Главарь').slice(0, 96),
    modelKey: cleanId(bossRaw.modelKey, 48),
    species: cleanId(bossRaw.species, 32) || 'mutant',
    hpMultiplier: clamp(Number(bossRaw.hpMultiplier || 2), 1, 8)
  } : null;
  return {
    id,
    kind,
    displayName: String(input?.displayName || id).slice(0, 96),
    text: String(input?.text || '').slice(0, 420),
    locationId,
    encounterId,
    danger: clamp(Math.floor(Number(input?.danger ?? 3)), 1, 5),
    // Цель узла одной строкой: карта показывает её до входа, как и полосу
    // опасности словом. Без главаря событие зачищается иначе, поэтому цель —
    // авторская, а не собранная из имени босса.
    objective: String(input?.objective || (bossRaw ? 'убить главаря' : 'зачистить событие')).slice(0, 64),
    boss,
    // Механики сценария: опоры (генератор щита, рация, гнёзда), обозначенный
    // удар и опасная земля. Без них событие было бы обычной пачкой врагов.
    mechanics: normalizeScenarioTemplate(input?.mechanics),
    weight: Math.max(0, Number(input?.weight || 1)),
    chest: {
      name: String(chest.name || 'Тайник события').slice(0, 96),
      loot: (Array.isArray(chest.loot) ? chest.loot : [])
        .map(row => ({ id: cleanId(row?.id), qty: Math.max(0, Math.floor(Number(row?.qty || 0))) }))
        .filter(row => row.id && row.qty > 0)
    }
  };
}

function normalizePublicEventCatalog(raw = {}) {
  const templates = (Array.isArray(raw?.templates) ? raw.templates : []).map(normalizeTemplate).filter(Boolean);
  return {
    schema: String(raw?.schema || 'kromka.public-events.v1'),
    version: Math.max(1, Math.floor(Number(raw?.version || 1))),
    rules: normalizePublicEventRules(raw?.rules),
    templates,
    byId: Object.fromEntries(templates.map(row => [row.id, row]))
  };
}

function sanitizeEvent(input = {}) {
  const id = cleanId(input?.id, 64);
  const templateId = cleanId(input?.templateId);
  const locationId = cleanId(input?.locationId);
  if (!id || !templateId || !locationId) return null;
  const statusRaw = String(input?.status || 'active');
  const status = ['active', 'warning', 'expired'].includes(statusRaw) ? statusRaw : 'active';
  const deaths = {};
  for (const [characterId, until] of Object.entries(input?.deaths && typeof input.deaths === 'object' ? input.deaths : {})) {
    const key = cleanId(characterId, 96);
    if (key) deaths[key] = Math.max(0, Math.floor(Number(until || 0)));
  }
  return {
    id,
    templateId,
    kind: String(input?.kind || '') === 'raiderBase' ? 'raiderBase' : 'monsterLair',
    displayName: String(input?.displayName || templateId).slice(0, 96),
    text: String(input?.text || '').slice(0, 420),
    locationId,
    encounterId: cleanId(input?.encounterId),
    roomId: String(input?.roomId || `${locationId}#${id}`).replace(/[^a-zA-Z0-9_#-]/g, '').slice(0, 96),
    pvpMode: 'pvpEvent',
    x: Number(Number(input?.x || 0).toFixed(2)),
    y: Number(Number(input?.y || 0).toFixed(2)),
    createdAt: Math.max(0, Math.floor(Number(input?.createdAt || 0))),
    warningAt: Math.max(0, Math.floor(Number(input?.warningAt || 0))),
    expiresAt: Math.max(0, Math.floor(Number(input?.expiresAt || 0))),
    expiredAt: Math.max(0, Math.floor(Number(input?.expiredAt || 0))),
    status,
    cleared: input?.cleared === true,
    clearedAt: Math.max(0, Math.floor(Number(input?.clearedAt || 0))),
    danger: clamp(Math.floor(Number(input?.danger ?? 3)), 1, 5),
    // Состояние мини-босса и уже объявленного сундука переживают перезапуск:
    // иначе после рестарта награда исчезала, а босс появлялся заново.
    boss: {
      spawned: input?.boss?.spawned === true,
      killedAt: Math.max(0, Math.floor(Number(input?.boss?.killedAt || 0)))
    },
    chest: {
      opensAt: Math.max(0, Math.floor(Number(input?.chest?.opensAt || 0))),
      claimedAt: Math.max(0, Math.floor(Number(input?.chest?.claimedAt || 0))),
      claimedBy: cleanId(input?.chest?.claimedBy, 96),
      announced: input?.chest?.announced === true,
      // Текущее вскрытие: кто держит канал, с какого момента и сколько уже
      // накоплено. Переживает перезапуск, чтобы прогресс не дублировал награду.
      opening: {
        characterId: cleanId(input?.chest?.opening?.characterId, 96),
        name: String(input?.chest?.opening?.name || '').slice(0, 64),
        startedAt: Math.max(0, Math.floor(Number(input?.chest?.opening?.startedAt || 0))),
        progressMs: Math.max(0, Math.floor(Number(input?.chest?.opening?.progressMs || 0))),
        contested: input?.chest?.opening?.contested === true,
        updatedAt: Math.max(0, Math.floor(Number(input?.chest?.opening?.updatedAt || 0)))
      }
    },
    deaths,
    scenario: normalizeScenarioState(input?.scenario, null),
    visits: Math.max(0, Math.floor(Number(input?.visits || 0)))
  };
}

function normalizePublicEventStore(input = {}) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const events = {};
  for (const [id, row] of Object.entries(src.events && typeof src.events === 'object' ? src.events : {})) {
    const clean = sanitizeEvent({ ...row, id: row?.id || id });
    if (clean) events[clean.id] = clean;
  }
  return {
    version: STORE_VERSION,
    lastSpawnAt: Math.max(0, Math.floor(Number(src.lastSpawnAt || 0))),
    startedAt: Math.max(0, Math.floor(Number(src.startedAt || 0))),
    counter: Math.max(0, Math.floor(Number(src.counter || 0))),
    events
  };
}

function activeEvents(store = {}) {
  return Object.values(store?.events || {}).filter(row => row && row.status !== 'expired');
}

function pickTemplate(catalog = {}, random = Math.random, exclude = new Set()) {
  const rows = (catalog.templates || []).filter(row => row.weight > 0 && !exclude.has(row.id));
  const pool = rows.length ? rows : (catalog.templates || []).filter(row => row.weight > 0);
  if (!pool.length) return null;
  const total = pool.reduce((sum, row) => sum + row.weight, 0);
  let cursor = random() * total;
  for (const row of pool) {
    cursor -= row.weight;
    if (cursor <= 0) return row;
  }
  return pool[pool.length - 1];
}

function createPublicEvent(template = {}, options = {}) {
  const now = Number(options.now || 0);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const rules = options.rules || DEFAULT_RULES;
  const id = cleanId(options.id || `pubev_${template.id}_${now.toString(36)}`, 64);
  const lifetime = rollRange([rules.minLifetimeMs, rules.maxLifetimeMs], random);
  const point = options.point && typeof options.point === 'object' ? options.point : { x: 0, y: 0 };
  return sanitizeEvent({
    id,
    templateId: template.id,
    kind: template.kind,
    displayName: template.displayName,
    text: template.text,
    locationId: template.locationId,
    encounterId: template.encounterId,
    danger: template.danger,
    roomId: `${template.locationId}#${id}`,
    x: point.x,
    y: point.y,
    createdAt: now,
    warningAt: now + lifetime - rules.expiryWarningMs,
    expiresAt: now + lifetime,
    status: 'active'
  });
}

// Появление новых событий: не больше maxActive, не чаще spawnIntervalMs,
// первое — через initialSpawnDelayMs после старта сервера.
function spawnDuePublicEvents(store = {}, catalog = {}, now = Date.now(), options = {}) {
  const rules = catalog.rules || DEFAULT_RULES;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const pickPoint = typeof options.pickPoint === 'function' ? options.pickPoint : () => ({ x: 0, y: 0 });
  if (!store.startedAt) store.startedAt = Number(now);
  const created = [];
  const active = activeEvents(store);
  if (active.length >= rules.maxActive) return created;
  const readyAt = store.lastSpawnAt
    ? Number(store.lastSpawnAt) + rules.spawnIntervalMs
    : Number(store.startedAt) + rules.initialSpawnDelayMs;
  if (Number(now) < readyAt) return created;
  const exclude = new Set(active.map(row => row.templateId));
  const template = pickTemplate(catalog, random, exclude);
  if (!template) return created;
  store.counter = Number(store.counter || 0) + 1;
  const event = createPublicEvent(template, {
    now, random, rules, point: pickPoint(random, template),
    id: `pubev_${template.id}_${store.counter}`
  });
  if (!event) return created;
  store.events[event.id] = event;
  store.lastSpawnAt = Number(now);
  created.push(event);
  return created;
}

// Жизненный цикл: предупреждение за expiryWarningMs, затем истечение.
function tickPublicEvent(event = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const changes = { warned: false, expired: false };
  if (!event || event.status === 'expired') return changes;
  if (event.status === 'active' && Number(now) >= Number(event.warningAt || 0)) {
    event.status = 'warning';
    changes.warned = true;
  }
  if (Number(now) >= Number(event.expiresAt || 0)) {
    event.status = 'expired';
    event.expiredAt = Number(now);
    changes.expired = true;
  }
  return changes;
}

function purgeExpiredPublicEvents(store = {}, now = Date.now(), keepMs = 600000) {
  let removed = 0;
  for (const [id, event] of Object.entries(store?.events || {})) {
    if (event.status !== 'expired') continue;
    if (Number(now) - Number(event.expiredAt || 0) < keepMs) continue;
    delete store.events[id];
    removed += 1;
  }
  return removed;
}

// Зачистка взводит спорный сундук один раз: он откроется через 45–60 с,
// и до открытия комнату можно оспаривать (PvP разрешено).
function notePublicEventCleared(event = {}, rules = DEFAULT_RULES, now = Date.now(), random = Math.random) {
  if (!event || event.status === 'expired' || event.cleared) return false;
  event.cleared = true;
  event.clearedAt = Number(now);
  event.chest.opensAt = Number(now) + rollRange(rules.chestOpenDelayMs, random);
  return true;
}

function publicEventChestOpen(event = {}, now = Date.now()) {
  return !!event?.cleared && Number(event.chest?.opensAt || 0) > 0 && Number(now) >= Number(event.chest.opensAt);
}

function claimPublicEventChest(event = {}, characterId = '', now = Date.now(), rules = DEFAULT_RULES) {
  const key = cleanId(characterId, 96);
  if (event?.chest?.claimedBy === key && key) return { ok: true, repeat: true };
  const gate = claimableChest(event, now);
  if (!gate.ok) {
    return event?.chest?.opensAt && !event?.chest?.claimedBy
      ? { ...gate, opensInMs: Number(event.chest.opensAt) - Number(now) }
      : gate;
  }
  // Награду получает только тот, кто довёл вскрытие до конца: одна выдача на
  // событие, без гонки одновременных обращений.
  const opening = event.chest.opening;
  if (opening?.characterId !== key || Number(opening?.progressMs || 0) < Number(rules.chestChannelMs || DEFAULT_RULES.chestChannelMs)) {
    return { ok: false, error: 'Сначала вскройте тайник: держите канал рядом с ним.', needsOpening: true };
  }
  event.chest.claimedBy = key;
  event.chest.claimedAt = Number(now);
  cancelChestOpening(event, key, 'claimed');
  return { ok: true };
}

/**
 * Начать вскрытие тайника. Канал держит один игрок; чужая попытка перехватывает
 * его только если прежний бросил канал (ушёл, погиб, отменил).
 */
function beginChestOpening(event = {}, opener = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const key = cleanId(opener?.characterId, 96);
  if (!key) return { ok: false, error: 'Персонаж недоступен.' };
  const gate = claimableChest(event, now);
  if (!gate.ok) return gate;
  const opening = event.chest.opening;
  if (opening.characterId && opening.characterId !== key) {
    return { ok: false, error: `Тайник уже вскрывает ${opening.name || 'другой игрок'}.`, busy: true };
  }
  if (opening.characterId === key) return { ok: true, already: true, opening };
  event.chest.opening = {
    characterId: key,
    name: String(opener?.name || '').slice(0, 64),
    startedAt: Number(now),
    progressMs: 0,
    contested: false,
    updatedAt: Number(now)
  };
  return { ok: true, opening: event.chest.opening };
}

/** Тайник доступен для вскрытия: событие живо, зачищено, открыто и не забрано. */
function claimableChest(event = {}, now = Date.now()) {
  if (!event || event.status === 'expired') return { ok: false, error: 'Событие уже завершилось.' };
  if (!event.cleared) return { ok: false, error: 'Сначала зачистите логово.' };
  if (!publicEventChestOpen(event, now)) {
    return { ok: false, error: `Тайник откроется через ${Math.ceil((Number(event.chest.opensAt) - Number(now)) / 1000)} с.` };
  }
  if (event.chest.claimedBy) return { ok: false, error: 'Тайник уже забрали.' };
  return { ok: true };
}

/** Сбросить канал: уход, смерть или отмена. Прогресс не сохраняется. */
function cancelChestOpening(event = {}, characterId = '', reason = '') {
  const opening = event?.chest?.opening;
  if (!opening?.characterId) return false;
  const key = cleanId(characterId, 96);
  if (key && opening.characterId !== key) return false;
  event.chest.opening = {
    characterId: '', name: '', startedAt: 0, progressMs: 0, contested: false, updatedAt: 0
  };
  void reason;
  return true;
}

/**
 * Шаг вскрытия. Прогресс идёт, пока игрок стоит у тайника и рядом нет чужих;
 * присутствие противника ставит его на паузу, уход или смерть сбрасывают.
 * Возвращает состояние и признак завершения — награду выдаёт сервер.
 */
function tickChestOpening(event = {}, options = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const opening = event?.chest?.opening;
  if (!opening?.characterId) return { active: false, changed: false };
  const changedBefore = `${opening.progressMs}:${opening.contested}`;
  if (options.present !== true) {
    cancelChestOpening(event, opening.characterId, 'left');
    return { active: false, changed: true, cancelled: true, reason: 'left' };
  }
  const contested = options.contested === true;
  const elapsed = Math.max(0, Number(now) - Math.max(Number(opening.updatedAt || opening.startedAt || now), 0));
  if (!contested) opening.progressMs = Math.min(rules.chestChannelMs, Number(opening.progressMs || 0) + elapsed);
  opening.contested = contested;
  opening.updatedAt = Number(now);
  const done = Number(opening.progressMs || 0) >= rules.chestChannelMs;
  return {
    active: true,
    changed: changedBefore !== `${opening.progressMs}:${opening.contested}`,
    contested,
    done,
    progressMs: Number(opening.progressMs || 0),
    characterId: opening.characterId
  };
}

// Смерть внутри события: вернуться можно только через 60–90 с.
function recordPublicEventDeath(event = {}, characterId = '', rules = DEFAULT_RULES, now = Date.now(), random = Math.random) {
  const key = cleanId(characterId, 96);
  if (!event || !key) return 0;
  const until = Number(now) + rollRange(rules.deathRejoinDelayMs, random);
  event.deaths[key] = until;
  return until;
}

function publicEventRejoinBlockedMs(event = {}, characterId = '', now = Date.now()) {
  const until = Number(event?.deaths?.[cleanId(characterId, 96)] || 0);
  return until > Number(now) ? until - Number(now) : 0;
}

function publicEventEntryError(event = {}, characterId = '', now = Date.now()) {
  if (!event) return 'Событие не найдено.';
  if (event.status === 'expired') return 'Событие уже завершилось.';
  const blocked = publicEventRejoinBlockedMs(event, characterId, now);
  if (blocked > 0) return `После гибели вернуться в событие можно через ${Math.ceil(blocked / 1000)} с.`;
  return '';
}

/**
 * Превью награды узла: те же строки, что лежат в сундуке шаблона, не больше
 * четырёх. Карта обещает ровно то, что откроется после зачистки.
 */
function publicEventRewardPreview(loot = [], itemName = null) {
  return (Array.isArray(loot) ? loot : [])
    .map(row => ({
      id: cleanId(row?.id, 48),
      qty: Math.max(0, Math.floor(Number(row?.qty || 0))),
      name: typeof itemName === 'function'
        ? String(itemName(cleanId(row?.id, 48)) || cleanId(row?.id, 48)).slice(0, 48)
        : cleanId(row?.id, 48)
    }))
    .filter(row => row.id && row.qty > 0)
    .slice(0, 4);
}

function publicEvent(event = {}, now = Date.now(), rules = DEFAULT_RULES, options = {}) {
  if (!event) return null;
  const remaining = Math.max(0, Number(event.expiresAt || 0) - Number(now));
  return {
    id: event.id,
    templateId: event.templateId,
    kind: event.kind,
    displayName: event.displayName,
    text: event.text,
    locationId: event.locationId,
    roomId: event.roomId,
    pvpMode: 'pvpEvent',
    x: event.x,
    y: event.y,
    radius: Number(rules?.zoneRadius || DEFAULT_RULES.zoneRadius),
    worldZoneId: event.id,
    status: event.status,
    remainingSeconds: Math.round(remaining / 1000),
    warning: event.status === 'warning',
    warningInSeconds: Math.max(0, Math.round((Number(event.warningAt || 0) - Number(now)) / 1000)),
    danger: Number(event.danger || 3),
    // Карточка узла на глобальной карте: цель, полоса опасности словом и
    // превью награды из того же сундука, который откроется после зачистки.
    // Ключ намеренно не называется `chest` — сундук событию отдаёт сервер
    // только внутри комнаты.
    objective: String(options?.objective || ''),
    dangerLabel: dangerBandLabel(event.danger),
    rewardPreview: publicEventRewardPreview(options?.rewardLoot, options?.itemName),
    // Мини-босс сценария: имя и состояние видны участникам, пока он жив.
    boss: {
      displayName: String(options?.bossName || ''),
      alive: event.boss?.killedAt ? false : event.boss?.spawned === true,
      killed: Number(event.boss?.killedAt || 0) > 0
    },
    cleared: event.cleared === true,
    chestOpensInSeconds: event.cleared ? Math.max(0, Math.round((Number(event.chest.opensAt || 0) - Number(now)) / 1000)) : 0,
    chestOpen: publicEventChestOpen(event, now),
    chestClaimed: !!event.chest.claimedBy,
    visits: Number(event.visits || 0)
  };
}

function publicEvents(store = {}, now = Date.now(), catalog = null, options = {}) {
  const byId = catalog?.byId && typeof catalog.byId === 'object' ? catalog.byId : {};
  const itemName = typeof options?.itemName === 'function' ? options.itemName : null;
  return Object.values(store?.events || {})
    .filter(row => row && row.status !== 'expired')
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .map(row => publicEvent(row, now, catalog?.rules || DEFAULT_RULES, {
      bossName: byId[row.templateId]?.boss?.displayName || '',
      objective: byId[row.templateId]?.objective || '',
      rewardLoot: byId[row.templateId]?.chest?.loot || [],
      itemName
    }));
}

/**
 * Мини-босс сценария: отмечает появление и гибель. Пока босс не убит, событие
 * не считается зачищенным и награда не открывается.
 */
function notePublicEventBoss(event = {}, options = {}) {
  if (!event.boss || typeof event.boss !== 'object') event.boss = { spawned: false, killedAt: 0 };
  let changed = false;
  if (options.spawned === true && event.boss.spawned !== true) {
    event.boss.spawned = true;
    changed = true;
  }
  if (options.killedAt && !event.boss.killedAt) {
    event.boss.killedAt = Math.max(0, Math.floor(Number(options.killedAt)));
    changed = true;
  }
  return changed;
}

/** Событие зачищено только когда объявленный сценарием босс мёртв. */
function publicEventBossDefeated(event = {}, template = null) {
  if (!template?.boss) return true;
  return Number(event?.boss?.killedAt || 0) > 0;
}

// Зона на глобальной карте для симуляции: общая комната события, вход через
// обычное путешествие; после истечения зона помечается expired и убирается.
function publicEventZone(event = {}, rules = DEFAULT_RULES, worldHour = 0) {
  return {
    id: event.id,
    kind: event.kind === 'raiderBase' ? 'raiderBase' : 'monsterLair',
    status: event.status === 'expired' ? 'expired' : 'active',
    title: event.displayName,
    text: event.text,
    x: event.x,
    y: event.y,
    radius: rules.zoneRadius,
    priority: 3,
    sourceType: 'public_event',
    sourceId: event.id,
    encounterId: event.encounterId,
    locationId: event.locationId,
    roomId: event.roomId,
    pvpMode: 'pvpEvent',
    createdHour: Number(worldHour || 0),
    expiresHour: Number(worldHour || 0) + 72,
    details: { publicEvent: true, eventId: event.id, hidden: false, visible: true }
  };
}

module.exports = {
  beginChestOpening,
  cancelChestOpening,
  claimableChest,
  tickChestOpening,
  notePublicEventBoss,
  publicEventBossDefeated,
  DEFAULT_RULES,
  STORE_VERSION,
  activeEvents,
  claimPublicEventChest,
  createPublicEvent,
  normalizePublicEventCatalog,
  normalizePublicEventRules,
  normalizePublicEventStore,
  notePublicEventCleared,
  pickTemplate,
  publicEvent,
  publicEventChestOpen,
  publicEventRewardPreview,
  publicEventEntryError,
  publicEventRejoinBlockedMs,
  publicEventZone,
  publicEvents,
  purgeExpiredPublicEvents,
  recordPublicEventDeath,
  spawnDuePublicEvents,
  tickPublicEvent
};
