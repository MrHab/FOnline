'use strict';

/**
 * Захватываемые аванпосты Сердцевины.
 *
 * Чистая модель без доступа к часам: каждая функция получает абсолютное
 * серверное время `now` в миллисекундах. Правило времени: событие «Захват
 * аванпоста» открывается ровно через `ownerChangeLockMs` (1 200 000 мс) после
 * последней смены владельца и остаётся открытым до следующей смены. Ничто,
 * кроме смены владельца, не сдвигает отсчёт; нейтральный аванпост доступен
 * сразу. Гарнизон привязан к порядковому номеру смены владельца, поэтому
 * повторная обработка, reconnect и перезапуск не создают второй отряд.
 */
const TERRITORY_RUNTIME_VERSION = 1;
const MAX_TICK_GAP_MS = 5000;
const GARRISON_STATES = new Set(['none', 'dispatched', 'enroute', 'arrived', 'returning']);
const DEFAULT_RULES = Object.freeze({
  ownerChangeLockMs: 1200000,
  captureHoldMs: 180000,
  captureDecayRate: 0.5,
  contestPausesProgress: true,
  captureTickMs: 1000,
  garrison: Object.freeze({ guards: 4, quartermaster: 1, speedMps: 2.2, arrivalRadius: 4 })
});

function safeId(value = '', limit = 48) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function outpostRules(catalog = {}) {
  const raw = catalog?.outpostRules && typeof catalog.outpostRules === 'object' ? catalog.outpostRules : {};
  const garrisonRaw = raw.garrison && typeof raw.garrison === 'object' ? raw.garrison : {};
  return {
    ownerChangeLockMs: Math.max(0, Math.floor(num(raw.ownerChangeLockMs, DEFAULT_RULES.ownerChangeLockMs))),
    captureHoldMs: Math.max(1000, Math.floor(num(raw.captureHoldMs, DEFAULT_RULES.captureHoldMs))),
    captureDecayRate: Math.max(0, num(raw.captureDecayRate, DEFAULT_RULES.captureDecayRate)),
    contestPausesProgress: raw.contestPausesProgress !== false,
    captureTickMs: Math.max(250, Math.floor(num(raw.captureTickMs, DEFAULT_RULES.captureTickMs))),
    garrison: {
      guards: Math.max(0, Math.floor(num(garrisonRaw.guards, DEFAULT_RULES.garrison.guards))),
      quartermaster: Math.max(0, Math.floor(num(garrisonRaw.quartermaster, DEFAULT_RULES.garrison.quartermaster))),
      speedMps: Math.max(0.2, num(garrisonRaw.speedMps, DEFAULT_RULES.garrison.speedMps)),
      arrivalRadius: Math.max(1, num(garrisonRaw.arrivalRadius, DEFAULT_RULES.garrison.arrivalRadius))
    }
  };
}

function territoryOutpostDefs(catalog = {}) {
  return (Array.isArray(catalog?.outposts) ? catalog.outposts : [])
    .map(row => ({
      id: safeId(row?.id),
      displayName: String(row?.displayName || row?.id || '').slice(0, 80),
      position: { x: num(row?.position?.x), z: num(row?.position?.z) },
      captureRadius: Math.max(2, num(row?.captureRadius, 10)),
      initialOwner: safeId(row?.initialOwner, 32),
      landmark: String(row?.landmark || '').slice(0, 32)
    }))
    .filter(row => row.id);
}

function territoryFactionIds(catalog = {}) {
  return (Array.isArray(catalog?.factions) ? catalog.factions : []).map(row => safeId(row?.id, 32)).filter(Boolean);
}

function emptyGarrison() {
  return {
    state: 'none', seq: 0, factionId: '', dispatchedAtMs: 0, arrivedAtMs: 0,
    returnStartedAtMs: 0, returnFromProgress: 0, progress: 0, routeLengthMeters: 0, casualties: 0
  };
}

function emptyCapture(now = 0) {
  return { progressMs: {}, contested: false, leadingFactionId: '', lastTickMs: now, lastPresenceAtMs: 0 };
}

/**
 * Нейтральный аванпост открывает первое событие сразу; аванпост с заданным
 * владельцем считает владение от момента инициализации мира.
 */
function createOutpostRuntime(def = {}, now = 0) {
  const owner = safeId(def.initialOwner, 32);
  return {
    id: safeId(def.id),
    ownerFactionId: owner,
    ownerChangedAtMs: owner ? now : 0,
    ownerChangeSeq: 0,
    event: owner
      ? { status: 'closed', openedAtMs: 0, openedForSeq: 0 }
      : { status: 'open', openedAtMs: now, openedForSeq: 0 },
    capture: emptyCapture(now),
    garrison: emptyGarrison(),
    history: []
  };
}

function sanitizeOutpostRuntime(input = null, def = {}, now = 0) {
  const src = input && typeof input === 'object' ? input : null;
  if (!src) return createOutpostRuntime(def, now);
  const owner = safeId(src.ownerFactionId, 32);
  const eventStatus = String(src.event?.status || '') === 'open' ? 'open' : 'closed';
  const progressMs = {};
  for (const [faction, value] of Object.entries(src.capture?.progressMs || {})) {
    const id = safeId(faction, 32);
    const ms = Math.max(0, Math.floor(num(value)));
    if (id && ms > 0) progressMs[id] = ms;
  }
  const garrisonSrc = src.garrison && typeof src.garrison === 'object' ? src.garrison : {};
  const garrison = {
    ...emptyGarrison(),
    state: GARRISON_STATES.has(String(garrisonSrc.state || '')) ? String(garrisonSrc.state) : 'none',
    seq: Math.max(0, Math.floor(num(garrisonSrc.seq))),
    factionId: safeId(garrisonSrc.factionId, 32),
    dispatchedAtMs: Math.max(0, Math.floor(num(garrisonSrc.dispatchedAtMs))),
    arrivedAtMs: Math.max(0, Math.floor(num(garrisonSrc.arrivedAtMs))),
    returnStartedAtMs: Math.max(0, Math.floor(num(garrisonSrc.returnStartedAtMs))),
    returnFromProgress: Math.min(1, Math.max(0, num(garrisonSrc.returnFromProgress))),
    progress: Math.min(1, Math.max(0, num(garrisonSrc.progress))),
    routeLengthMeters: Math.max(0, num(garrisonSrc.routeLengthMeters)),
    casualties: Math.max(0, Math.floor(num(garrisonSrc.casualties)))
  };
  if (garrison.state === 'none') garrison.factionId = '';
  return {
    id: safeId(def.id || src.id),
    ownerFactionId: owner,
    ownerChangedAtMs: owner ? Math.max(0, Math.floor(num(src.ownerChangedAtMs))) : 0,
    ownerChangeSeq: Math.max(0, Math.floor(num(src.ownerChangeSeq))),
    event: {
      status: eventStatus,
      openedAtMs: eventStatus === 'open' ? Math.max(0, Math.floor(num(src.event?.openedAtMs))) : 0,
      openedForSeq: eventStatus === 'open' ? Math.max(0, Math.floor(num(src.event?.openedForSeq))) : 0
    },
    capture: {
      progressMs,
      contested: src.capture?.contested === true,
      leadingFactionId: safeId(src.capture?.leadingFactionId, 32),
      lastTickMs: Math.max(0, Math.floor(num(src.capture?.lastTickMs))),
      lastPresenceAtMs: Math.max(0, Math.floor(num(src.capture?.lastPresenceAtMs)))
    },
    garrison,
    history: (Array.isArray(src.history) ? src.history : []).slice(-16).map(row => ({
      seq: Math.max(0, Math.floor(num(row?.seq))),
      factionId: safeId(row?.factionId, 32),
      previousFactionId: safeId(row?.previousFactionId, 32),
      at: Math.max(0, Math.floor(num(row?.at)))
    }))
  };
}

function normalizeTerritoryStore(store = null, catalog = {}, now = 0) {
  const src = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
  const outposts = {};
  for (const def of territoryOutpostDefs(catalog)) {
    outposts[def.id] = sanitizeOutpostRuntime(src.outposts?.[def.id] || null, def, now);
  }
  return {
    version: TERRITORY_RUNTIME_VERSION,
    territoryId: safeId(catalog?.id || 'core', 32),
    updatedAt: Math.max(0, Math.floor(num(src.updatedAt))),
    outposts
  };
}

function nextEventAtMs(outpost = {}, rules = DEFAULT_RULES) {
  if (!outpost?.ownerFactionId) return 0;
  return Math.max(0, Math.floor(num(outpost.ownerChangedAtMs))) + rules.ownerChangeLockMs;
}

/**
 * Открывает просроченные события ровно один раз. Отсутствие игроков рядом и
 * остановка сервера не мешают: при первом тике после восстановления событие
 * открывается, если 20 реальных минут уже прошли.
 */
function openDueEvents(store = {}, catalog = {}, now = 0) {
  const rules = outpostRules(catalog);
  const opened = [];
  for (const outpost of Object.values(store?.outposts || {})) {
    if (!outpost || outpost.event.status === 'open') continue;
    const dueAt = nextEventAtMs(outpost, rules);
    if (outpost.ownerFactionId && now < dueAt) continue;
    outpost.event = { status: 'open', openedAtMs: now, openedForSeq: outpost.ownerChangeSeq };
    outpost.capture = emptyCapture(now);
    opened.push(outpost.id);
  }
  if (opened.length) store.updatedAt = now;
  return opened;
}

/**
 * Прогресс захвата по присутствию в области контроля.
 * `presence` = { [factionId]: { players, guards } } — живые игроки и живой
 * гарнизон внутри области. Прогресс копит единственная атакующая фракция при
 * отсутствии владельца и его охраны; присутствие второй фракции или владельца
 * ставит захват на паузу («оспаривается»); пустая область затухает.
 */
function applyCapturePresence(outpost = {}, presence = {}, now = 0, rules = DEFAULT_RULES) {
  const capture = outpost.capture || (outpost.capture = emptyCapture(now));
  const lastTick = Math.max(0, Math.floor(num(capture.lastTickMs)));
  const dt = lastTick > 0 ? Math.min(MAX_TICK_GAP_MS, Math.max(0, now - lastTick)) : 0;
  capture.lastTickMs = now;
  if (outpost.event?.status !== 'open') {
    const hadProgress = Object.keys(capture.progressMs || {}).length > 0;
    capture.progressMs = {};
    capture.contested = false;
    capture.leadingFactionId = '';
    return { changed: hadProgress, captured: '', contested: false, leadingFactionId: '' };
  }
  const owner = safeId(outpost.ownerFactionId, 32);
  const rows = Object.entries(presence || {})
    .map(([faction, row]) => ({
      factionId: safeId(faction, 32),
      players: Math.max(0, Math.floor(num(row?.players))),
      guards: Math.max(0, Math.floor(num(row?.guards)))
    }))
    .filter(row => row.factionId);
  const ownerPresence = rows
    .filter(row => row.factionId === owner)
    .reduce((sum, row) => sum + row.players + row.guards, 0);
  const attackers = rows.filter(row => row.factionId !== owner && row.players > 0);
  const before = JSON.stringify(capture.progressMs) + capture.contested + capture.leadingFactionId;
  const decay = dt * rules.captureDecayRate;
  const decayAll = except => {
    for (const faction of Object.keys(capture.progressMs)) {
      if (faction === except) continue;
      const next = Math.max(0, Math.floor(capture.progressMs[faction] - decay));
      if (next <= 0) delete capture.progressMs[faction];
      else capture.progressMs[faction] = next;
    }
  };
  let captured = '';
  if (attackers.length === 1 && ownerPresence === 0) {
    const attacker = attackers[0].factionId;
    capture.contested = false;
    capture.lastPresenceAtMs = now;
    capture.progressMs[attacker] = Math.min(rules.captureHoldMs, Math.floor(num(capture.progressMs[attacker]) + dt));
    decayAll(attacker);
    capture.leadingFactionId = attacker;
    if (capture.progressMs[attacker] >= rules.captureHoldMs) captured = attacker;
  } else if (attackers.length >= 1) {
    capture.contested = true;
    capture.lastPresenceAtMs = now;
    if (!rules.contestPausesProgress) decayAll('');
  } else {
    capture.contested = false;
    decayAll('');
    const leading = Object.entries(capture.progressMs).sort((a, b) => b[1] - a[1])[0];
    capture.leadingFactionId = leading ? leading[0] : '';
  }
  const changed = before !== JSON.stringify(capture.progressMs) + capture.contested + capture.leadingFactionId;
  return { changed, captured, contested: capture.contested, leadingFactionId: capture.leadingFactionId };
}

/**
 * Атомарная смена владельца: только во время открытого события, только другой
 * фракцией территории. Закрывает событие, обнуляет прогресс, ставит отсчёт от
 * этого момента и назначает один отряд гарнизона на эту смену владельца.
 */
function applyOwnerChange(store = {}, outpostId = '', factionId = '', now = 0, catalog = {}, options = {}) {
  const outpost = store?.outposts?.[safeId(outpostId)];
  if (!outpost) return { ok: false, error: 'Аванпост не найден.' };
  const faction = safeId(factionId, 32);
  if (!territoryFactionIds(catalog).includes(faction)) return { ok: false, error: 'Эта фракция не участвует в борьбе за территорию.' };
  if (outpost.ownerFactionId === faction) return { ok: false, error: 'Аванпост уже принадлежит вашей фракции.', reason: 'sameOwner' };
  if (outpost.event?.status !== 'open') return { ok: false, error: 'Захват закрыт: событие ещё не началось.', reason: 'eventClosed' };
  const previous = outpost.ownerFactionId;
  outpost.ownerFactionId = faction;
  outpost.ownerChangedAtMs = now;
  outpost.ownerChangeSeq += 1;
  outpost.event = { status: 'closed', openedAtMs: 0, openedForSeq: 0 };
  outpost.capture = emptyCapture(now);
  outpost.garrison = {
    ...emptyGarrison(),
    state: 'dispatched',
    seq: outpost.ownerChangeSeq,
    factionId: faction,
    dispatchedAtMs: now,
    routeLengthMeters: Math.max(0, num(options.routeLengthMeters))
  };
  outpost.history = [...(outpost.history || []), { seq: outpost.ownerChangeSeq, factionId: faction, previousFactionId: previous, at: now }].slice(-16);
  store.updatedAt = now;
  return { ok: true, seq: outpost.ownerChangeSeq, previousFactionId: previous, factionId: faction };
}

/**
 * Виртуальное движение отряда по времени: работает и без загруженной комнаты.
 * Если владелец сменился до прибытия, отряд возвращается на свою базу и
 * исчезает дома; уничтоженный отряд не заменяется в рамках той же смены.
 */
function advanceGarrison(outpost = {}, now = 0, rules = DEFAULT_RULES) {
  const garrison = outpost.garrison || (outpost.garrison = emptyGarrison());
  const before = `${garrison.state}:${garrison.progress.toFixed(4)}`;
  const travelMs = Math.max(1000, garrison.routeLengthMeters / rules.garrison.speedMps * 1000);
  if (garrison.state === 'dispatched') garrison.state = 'enroute';
  if ((garrison.state === 'enroute' || garrison.state === 'arrived') && garrison.seq !== outpost.ownerChangeSeq) {
    garrison.state = 'returning';
    garrison.returnStartedAtMs = now;
    garrison.returnFromProgress = garrison.progress;
  }
  if (garrison.state === 'enroute') {
    garrison.progress = Math.min(1, Math.max(0, (now - garrison.dispatchedAtMs) / travelMs));
    if (garrison.progress >= 1) {
      garrison.state = 'arrived';
      garrison.arrivedAtMs = now;
    }
  } else if (garrison.state === 'returning') {
    const elapsed = Math.max(0, now - garrison.returnStartedAtMs);
    garrison.progress = Math.max(0, garrison.returnFromProgress - elapsed / travelMs);
    if (garrison.progress <= 0) {
      outpost.garrison = emptyGarrison();
    }
  }
  const after = `${outpost.garrison.state}:${outpost.garrison.progress.toFixed(4)}`;
  return { changed: before !== after, state: outpost.garrison.state, progress: outpost.garrison.progress };
}

function markGarrisonDestroyed(outpost = {}, now = 0) {
  const garrison = outpost.garrison;
  if (!garrison || garrison.state === 'none') return false;
  outpost.garrison = { ...emptyGarrison(), casualties: garrison.casualties };
  void now;
  return true;
}

function publicOutpost(def = {}, outpost = {}, now = 0, rules = DEFAULT_RULES) {
  const dueAt = nextEventAtMs(outpost, rules);
  const progress = {};
  for (const [faction, ms] of Object.entries(outpost.capture?.progressMs || {})) {
    progress[faction] = Number((Math.min(1, ms / rules.captureHoldMs)).toFixed(3));
  }
  const garrison = outpost.garrison || emptyGarrison();
  const travelMs = Math.max(1000, garrison.routeLengthMeters / rules.garrison.speedMps * 1000);
  return {
    id: outpost.id || def.id,
    displayName: def.displayName || outpost.id,
    x: num(def.position?.x),
    z: num(def.position?.z),
    captureRadius: def.captureRadius,
    ownerFactionId: outpost.ownerFactionId || '',
    ownerChangedAtMs: outpost.ownerChangedAtMs || 0,
    ownerChangeSeq: outpost.ownerChangeSeq || 0,
    eventStatus: outpost.event?.status === 'open' ? 'open' : 'closed',
    eventOpenedAtMs: outpost.event?.status === 'open' ? outpost.event.openedAtMs : 0,
    nextEventAtMs: outpost.event?.status === 'open' ? 0 : dueAt,
    eventOpensInMs: outpost.event?.status === 'open' ? 0 : Math.max(0, dueAt - now),
    capture: {
      holdMs: rules.captureHoldMs,
      progress,
      leadingFactionId: outpost.capture?.leadingFactionId || '',
      contested: outpost.capture?.contested === true
    },
    garrison: {
      state: garrison.state,
      factionId: garrison.factionId || '',
      seq: garrison.seq || 0,
      progress: Number(num(garrison.progress).toFixed(3)),
      etaMs: garrison.state === 'enroute' ? Math.max(0, Math.round(travelMs * (1 - num(garrison.progress)))) : 0,
      dispatchedAtMs: garrison.dispatchedAtMs || 0,
      arrivedAtMs: garrison.arrivedAtMs || 0
    }
  };
}

function publicTerritoryState(store = {}, catalog = {}, now = 0) {
  const rules = outpostRules(catalog);
  return {
    territoryId: safeId(catalog?.id || 'core', 32),
    displayName: String(catalog?.displayName || 'Сердцевина').slice(0, 80),
    zoneLocationId: safeId(catalog?.zoneLocationId || 'coreZone', 64),
    rules: {
      ownerChangeLockMs: rules.ownerChangeLockMs,
      captureHoldMs: rules.captureHoldMs,
      captureDecayRate: rules.captureDecayRate,
      contestPausesProgress: rules.contestPausesProgress
    },
    serverNow: now,
    updatedAt: Math.max(0, Math.floor(num(store?.updatedAt))),
    outposts: territoryOutpostDefs(catalog).map(def => publicOutpost(def, store?.outposts?.[def.id] || createOutpostRuntime(def, now), now, rules))
  };
}

module.exports = {
  DEFAULT_RULES,
  MAX_TICK_GAP_MS,
  TERRITORY_RUNTIME_VERSION,
  advanceGarrison,
  applyCapturePresence,
  applyOwnerChange,
  createOutpostRuntime,
  markGarrisonDestroyed,
  nextEventAtMs,
  normalizeTerritoryStore,
  openDueEvents,
  outpostRules,
  publicOutpost,
  publicTerritoryState,
  sanitizeOutpostRuntime,
  territoryFactionIds,
  territoryOutpostDefs
};
