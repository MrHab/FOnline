'use strict';

const DEFAULT_GAME_DAY_REAL_MS = 60 * 60 * 1000;
const FULL_DAY_HOURS = 24;
const HOUR_EPSILON = 1e-9;

const LEGACY_ROUTINE_TEMPLATES = Object.freeze({
  guard: freezeTemplate([
    [0, 5, 'sleep'],
    [5, 7, 'rest'],
    [7, 13, 'work'],
    [13, 14, 'rest'],
    [14, 20, 'work'],
    [20, 22, 'social'],
    [22, 24, 'sleep']
  ]),
  night_guard: freezeTemplate([
    [0, 6, 'work'],
    [6, 8, 'social'],
    [8, 15, 'sleep'],
    [15, 17, 'rest'],
    [17, 24, 'work']
  ]),
  merchant: freezeTemplate([
    [0, 7, 'sleep'],
    [7, 8, 'rest'],
    [8, 13, 'work'],
    [13, 14, 'rest'],
    [14, 20, 'work'],
    [20, 22, 'social'],
    [22, 24, 'sleep']
  ]),
  craftsman: freezeTemplate([
    [0, 6, 'sleep'],
    [6, 8, 'rest'],
    [8, 12, 'work'],
    [12, 13, 'social'],
    [13, 18, 'work'],
    [18, 21, 'social'],
    [21, 24, 'sleep']
  ]),
  worker: freezeTemplate([
    [0, 6, 'sleep'],
    [6, 7, 'rest'],
    [7, 12, 'work'],
    [12, 13, 'rest'],
    [13, 18, 'work'],
    [18, 21, 'social'],
    [21, 24, 'sleep']
  ])
});

const INTERRUPT_DEFINITIONS = Object.freeze({
  combat: Object.freeze({ priority: 1000, state: 'combat', resumePolicy: 'reevaluate' }),
  alarm: Object.freeze({ priority: 900, state: 'alarm', resumePolicy: 'reevaluate' }),
  dialogue: Object.freeze({ priority: 800, state: 'dialogue', resumePolicy: 'resume' }),
  investigate: Object.freeze({ priority: 700, state: 'investigate', resumePolicy: 'resume' })
});

const INTERRUPT_PRIORITIES = Object.freeze(Object.fromEntries(
  Object.entries(INTERRUPT_DEFINITIONS).map(([type, row]) => [type, row.priority])
));

const ROUTINE_TYPE_DEFAULT_STATES = Object.freeze({
  guard: 'work',
  patrol: 'work',
  shop: 'work',
  merchant: 'work',
  trade: 'work',
  service: 'work',
  craft: 'work',
  work: 'work',
  sleep: 'sleep',
  rest: 'rest',
  social: 'social',
  socialize: 'social',
  eat: 'eat',
  travel: 'travel',
  sandbox: 'idle',
  wait: 'idle'
});

function freezeTemplate(rows = []) {
  return Object.freeze(rows.map(row => Object.freeze({
    startHour: row[0],
    endHour: row[1],
    state: row[2]
  })));
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeGameHour(value = 0) {
  const hour = finiteNumber(value, 0);
  return ((hour % FULL_DAY_HOURS) + FULL_DAY_HOURS) % FULL_DAY_HOURS;
}

function parseGameHour(value) {
  if (typeof value === 'string' && value.includes(':')) {
    const match = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 24 || (hours === 24 && minutes !== 0)) return null;
    return normalizeGameHour(hours + minutes / 60);
  }
  const number = Number(value);
  return Number.isFinite(number) ? normalizeGameHour(number) : null;
}

function hourInsideWindow(gameHour = 0, startHour = 0, endHour = 0) {
  const hour = normalizeGameHour(gameHour);
  const start = normalizeGameHour(startHour);
  const end = normalizeGameHour(endHour);
  if (Math.abs(start - end) < HOUR_EPSILON) return true;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

function stableRoutineRoll(seed = '', salt = '') {
  const source = `${String(seed || '')}:${String(salt || '')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

function routineRoll(options = {}, seed = '', salt = '') {
  const supplied = options.stableRoll;
  let value;
  if (typeof supplied === 'function') value = supplied(seed, salt);
  else if (supplied && typeof supplied === 'object' && hasOwn(supplied, salt)) value = supplied[salt];
  else if (Number.isFinite(Number(supplied))) value = supplied;
  else value = stableRoutineRoll(seed, salt);
  if (!Number.isFinite(Number(value))) value = stableRoutineRoll(seed, salt);
  return Math.max(0, Math.min(0.999999999999, Number(value)));
}

function normalizeLegacyTemplateName(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (hasOwn(LEGACY_ROUTINE_TEMPLATES, raw)) return raw;
  if (raw === 'patrol') return 'guard';
  if (raw === 'trader' || raw === 'quartermaster') return 'merchant';
  if (raw === 'mechanic') return 'craftsman';
  return '';
}

function legacyTemplateForRole(role = '', options = {}, seed = '') {
  const explicit = normalizeLegacyTemplateName(options.template);
  if (explicit) return explicit;
  const normalizedRole = normalizeLegacyTemplateName(role);
  if (normalizedRole === 'guard' && String(role || '').trim().toLowerCase() === 'guard') {
    return routineRoll(options, seed, 'night-guard') > 0.72 ? 'night_guard' : 'guard';
  }
  return normalizedRole || 'worker';
}

function legacyActionType(template = 'worker', state = 'work') {
  if (state !== 'work') return state === 'social' ? 'socialize' : state;
  if (template === 'guard' || template === 'night_guard') return 'guard';
  if (template === 'merchant') return 'shop';
  if (template === 'craftsman') return 'craft';
  return 'work';
}

function legacyTarget(template = 'worker', state = 'work') {
  if (state === 'sleep') return 'bed';
  if (state === 'rest') return 'rest';
  if (state === 'social') return 'social';
  if (template === 'guard' || template === 'night_guard') return 'guard_post';
  if (template === 'merchant') return 'shop_counter';
  if (template === 'craftsman') return 'workstation';
  return 'worksite';
}

function createLegacyRoutine(options = {}) {
  const seed = String(options.seed || '');
  const role = String(options.role || options.template || 'worker');
  const template = legacyTemplateForRole(role, options, seed);
  const shift = Math.floor(routineRoll(options, seed, 'schedule-shift') * 3) - 1;
  const sourceRows = LEGACY_ROUTINE_TEMPLATES[template] || LEGACY_ROUTINE_TEMPLATES.worker;
  const packages = sourceRows.map((row, index) => {
    const state = row.state;
    return {
      id: `legacy:${template}:${index + 1}:${state}`,
      type: legacyActionType(template, state),
      state,
      target: legacyTarget(template, state),
      priority: 100,
      interruptPolicy: 'interruptible',
      resumePolicy: 'reevaluate',
      serviceAvailable: template === 'merchant' && state === 'work',
      startHour: normalizeGameHour(row.startHour + shift),
      endHour: normalizeGameHour(row.endHour + shift),
      conditions: {},
      order: index,
      source: 'legacy'
    };
  });
  return {
    id: `legacy:${template}`,
    template,
    shift,
    packages,
    segments: packages.map(row => ({
      start: row.startHour,
      end: row.endHour,
      state: row.state
    }))
  };
}

function extractPackageRows(source) {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source.packages)) return source.packages;
  if (Array.isArray(source.routinePackages)) return source.routinePackages;
  if (Array.isArray(source.schedule)) return source.schedule;
  if (source.routine && source.routine !== source) return extractPackageRows(source.routine);
  if (source.schedule && source.schedule !== source) return extractPackageRows(source.schedule);
  if (hasOwn(source, 'type') || hasOwn(source, 'state')) return [source];
  return [];
}

function routineSourceFromCatalog(source = {}, options = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const routines = source.routines;
  if (!routines || typeof routines !== 'object' || Array.isArray(routines)) return source;
  const requestedId = String(options.id || options.routineId || '').trim();
  if (requestedId && routines[requestedId] && typeof routines[requestedId] === 'object') {
    return routines[requestedId];
  }
  const entries = Object.entries(routines).filter(([, row]) => row && typeof row === 'object');
  return entries.length === 1 ? entries[0][1] : source;
}

function safeRoutineId(value = '', fallback = 'routine') {
  const id = String(value || '').trim();
  return id || fallback;
}

function authoredRoutineId(source = {}, options = {}) {
  if (options && options.id) return safeRoutineId(options.id);
  if (!source || Array.isArray(source) || typeof source !== 'object') return 'authored';
  if (source.id || source.routineId) return safeRoutineId(source.id || source.routineId);
  if (source.routine && typeof source.routine === 'object') {
    return safeRoutineId(source.routine.id || source.routine.routineId, 'authored');
  }
  return 'authored';
}

function normalizeType(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized || 'sandbox';
}

function defaultStateForType(type = '') {
  return ROUTINE_TYPE_DEFAULT_STATES[type] || type || 'idle';
}

function packageWindow(row = {}) {
  const time = row.time && typeof row.time === 'object' ? row.time : {};
  const hours = row.hours && typeof row.hours === 'object' ? row.hours : {};
  const window = row.window && typeof row.window === 'object' ? row.window : {};
  const startRaw = hasOwn(row, 'startHour') ? row.startHour
    : hasOwn(row, 'start') ? row.start
      : hasOwn(time, 'start') ? time.start
        : hasOwn(hours, 'start') ? hours.start
          : window.start;
  let endRaw = hasOwn(row, 'endHour') ? row.endHour
    : hasOwn(row, 'end') ? row.end
      : hasOwn(time, 'end') ? time.end
        : hasOwn(hours, 'end') ? hours.end
          : window.end;
  const startHour = parseGameHour(startRaw);
  if (endRaw == null && startHour != null && Number.isFinite(Number(row.durationHours))) {
    endRaw = startHour + Number(row.durationHours);
  }
  const endHour = parseGameHour(endRaw);
  return startHour == null || endHour == null
    ? { startHour: null, endHour: null }
    : { startHour, endHour };
}

function packageConditions(row = {}) {
  const when = row.when && typeof row.when === 'object' && !Array.isArray(row.when) ? row.when : {};
  const explicit = row.conditions && typeof row.conditions === 'object' && !Array.isArray(row.conditions)
    ? row.conditions
    : {};
  const conditions = { ...when, ...explicit };
  if (hasOwn(row, 'days') && !hasOwn(conditions, 'days')) conditions.days = row.days;
  if (hasOwn(row, 'dayOfWeek') && !hasOwn(conditions, 'dayOfWeek')) conditions.dayOfWeek = row.dayOfWeek;
  if (hasOwn(row, 'requires') && !hasOwn(conditions, 'require')) conditions.require = row.requires;
  if (hasOwn(row, 'unless') && !hasOwn(conditions, 'exclude')) conditions.exclude = row.unless;
  return conditions;
}

function authoredTarget(row = {}) {
  if (hasOwn(row, 'target')) return row.target;
  if (hasOwn(row, 'targetId')) return row.targetId;
  if (hasOwn(row, 'activitySlotId')) return row.activitySlotId;
  if (hasOwn(row, 'anchorId')) return row.anchorId;
  return null;
}

function normalizePackageRow(row = {}, index = 0, options = {}) {
  if (!row || typeof row !== 'object' || row.enabled === false) return null;
  const type = normalizeType(row.type || row.action || row.procedure || row.state);
  const state = String(row.state || defaultStateForType(type)).trim().toLowerCase() || 'idle';
  const routineId = safeRoutineId(options.routineId, 'authored');
  const id = safeRoutineId(row.id || row.packageId, `${routineId}:${type}:${index + 1}`);
  const priority = finiteNumber(row.priority, finiteNumber(options.defaultPriority, 100));
  const serviceExplicit = hasOwn(row, 'serviceAvailable')
    ? row.serviceAvailable
    : row.service && hasOwn(row.service, 'available') ? row.service.available : undefined;
  const serviceType = type === 'shop' || type === 'merchant' || type === 'trade' || type === 'service';
  return {
    id,
    type,
    state,
    target: authoredTarget(row),
    priority,
    interruptPolicy: String(row.interruptPolicy || 'interruptible'),
    resumePolicy: String(row.resumePolicy || 'reevaluate'),
    serviceAvailable: serviceExplicit === undefined ? serviceType && state === 'work' : Boolean(serviceExplicit),
    ...packageWindow(row),
    conditions: packageConditions(row),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
    source: String(row.source || options.source || 'authored')
  };
}

function normalizeRoutinePackages(source = [], options = {}) {
  const routineSource = routineSourceFromCatalog(source, options);
  const routineId = safeRoutineId(options.id || options.routineId, authoredRoutineId(routineSource, options));
  const seenIds = new Map();
  return extractPackageRows(routineSource)
    .map((row, index) => normalizePackageRow(row, index, { ...options, routineId }))
    .filter(Boolean)
    .map(row => {
      const seen = seenIds.get(row.id) || 0;
      seenIds.set(row.id, seen + 1);
      return seen === 0 ? row : { ...row, id: `${row.id}#${seen + 1}` };
    });
}

function normalizeAuthoredRoutine(source = {}, options = {}) {
  const routineSource = routineSourceFromCatalog(source, options);
  const id = authoredRoutineId(routineSource, options);
  return {
    id,
    packages: normalizeRoutinePackages(routineSource, { ...options, routineId: id, source: 'authored' })
  };
}

function normalizeAuthoredRoutineCatalog(source = {}, options = {}) {
  const routines = source && source.routines && typeof source.routines === 'object' && !Array.isArray(source.routines)
    ? source.routines
    : {};
  const normalized = {};
  for (const [key, row] of Object.entries(routines)) {
    if (!row || typeof row !== 'object') continue;
    const id = safeRoutineId(row.id || row.routineId || key, key);
    normalized[id] = normalizeAuthoredRoutine(row, { ...options, id });
  }
  return {
    schema: String(source.schema || 'realm.npc-routines.v1'),
    version: Math.max(1, Math.floor(finiteNumber(source.version, 1))),
    routines: normalized
  };
}

function isNormalizedRoutinePackage(row) {
  return Boolean(row
    && typeof row === 'object'
    && typeof row.id === 'string'
    && typeof row.type === 'string'
    && typeof row.state === 'string'
    && hasOwn(row, 'target')
    && Number.isFinite(Number(row.priority))
    && hasOwn(row, 'interruptPolicy')
    && hasOwn(row, 'resumePolicy')
    && hasOwn(row, 'serviceAvailable')
    && hasOwn(row, 'startHour')
    && hasOwn(row, 'endHour')
    && row.conditions
    && typeof row.conditions === 'object');
}

function preparedPackages(source = []) {
  const rows = extractPackageRows(source);
  return rows.every(isNormalizedRoutinePackage) ? rows : normalizeRoutinePackages(source);
}

function contextValue(context = {}, path = '') {
  const parts = String(path || '').split('.').filter(Boolean);
  let value = context;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function conditionValueMatches(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      ? actual.some(value => expected.includes(value))
      : expected.includes(actual);
  }
  if (!expected || typeof expected !== 'object') return actual === expected;
  if (hasOwn(expected, '$exists') && Boolean(actual !== undefined && actual !== null) !== Boolean(expected.$exists)) return false;
  if (hasOwn(expected, '$eq') && actual !== expected.$eq) return false;
  if (hasOwn(expected, '$ne') && actual === expected.$ne) return false;
  if (hasOwn(expected, '$in') && !conditionValueMatches(actual, expected.$in)) return false;
  if (hasOwn(expected, '$nin') && conditionValueMatches(actual, expected.$nin)) return false;
  if (hasOwn(expected, '$gt') && !(Number(actual) > Number(expected.$gt))) return false;
  if (hasOwn(expected, '$gte') && !(Number(actual) >= Number(expected.$gte))) return false;
  if (hasOwn(expected, '$lt') && !(Number(actual) < Number(expected.$lt))) return false;
  if (hasOwn(expected, '$lte') && !(Number(actual) <= Number(expected.$lte))) return false;
  if (hasOwn(expected, 'min') && !(Number(actual) >= Number(expected.min))) return false;
  if (hasOwn(expected, 'max') && !(Number(actual) <= Number(expected.max))) return false;
  const operatorKeys = new Set(['$exists', '$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', 'min', 'max']);
  const nestedKeys = Object.keys(expected).filter(key => !operatorKeys.has(key));
  if (!nestedKeys.length) return true;
  if (!actual || typeof actual !== 'object') return false;
  return nestedKeys.every(key => conditionValueMatches(actual[key], expected[key]));
}

function objectConditionsMatch(actual = {}, expected = {}) {
  if (!expected || typeof expected !== 'object') return true;
  return Object.entries(expected).every(([path, value]) => conditionValueMatches(contextValue(actual, path), value));
}

function conditionsMatch(conditions = {}, context = {}) {
  if (!conditions || typeof conditions !== 'object') return true;
  if (Array.isArray(conditions.all) && !conditions.all.every(row => conditionsMatch(row, context))) return false;
  if (Array.isArray(conditions.any) && conditions.any.length && !conditions.any.some(row => conditionsMatch(row, context))) return false;
  if (conditions.not && conditionsMatch(conditions.not, context)) return false;
  if (conditions.require && !objectConditionsMatch(context, conditions.require)) return false;
  if (conditions.context && !objectConditionsMatch(context, conditions.context)) return false;
  if (conditions.flags && !objectConditionsMatch(context.flags || {}, conditions.flags)) return false;
  if (conditions.exclude && objectConditionsMatch(context, conditions.exclude)) return false;

  const currentDay = Number.isFinite(Number(context.dayOfWeek))
    ? ((Math.floor(Number(context.dayOfWeek)) % 7) + 7) % 7
    : ((Math.floor(finiteNumber(context.gameDay ?? context.worldDay, 0)) % 7) + 7) % 7;
  if (hasOwn(conditions, 'days') && !conditionValueMatches(currentDay, conditions.days)) return false;
  if (hasOwn(conditions, 'dayOfWeek') && !conditionValueMatches(currentDay, conditions.dayOfWeek)) return false;

  const reserved = new Set(['all', 'any', 'not', 'require', 'context', 'flags', 'exclude', 'days', 'dayOfWeek']);
  return Object.entries(conditions)
    .filter(([key]) => !reserved.has(key))
    .every(([path, expected]) => conditionValueMatches(contextValue(context, path), expected));
}

function routinePackageMatches(row = {}, gameHour = 0, context = {}) {
  if (!row || row.enabled === false) return false;
  if (row.startHour != null && row.endHour != null && !hourInsideWindow(gameHour, row.startHour, row.endHour)) return false;
  const disabled = Array.isArray(context.disabledPackageIds) ? context.disabledPackageIds : [];
  if (disabled.includes(row.id)) return false;
  return conditionsMatch(row.conditions, { ...context, gameHour: normalizeGameHour(gameHour) });
}

function interruptIsActive(value) {
  if (value == null || value === false || value === 0 || value === '') return false;
  if (value && typeof value === 'object' && hasOwn(value, 'active')) return Boolean(value.active);
  return true;
}

function interruptTarget(type = '', value = null, context = {}) {
  if (value && typeof value === 'object') {
    if (hasOwn(value, 'target')) return value.target;
    if (hasOwn(value, 'targetId')) return value.targetId;
    if (hasOwn(value, 'position')) return value.position;
  }
  const aliases = {
    combat: ['combatTarget', 'target'],
    alarm: ['alarmTarget', 'alarmSource'],
    dialogue: ['dialogueTarget', 'dialogueFocus', 'npcDialogueFocus'],
    investigate: ['investigateTarget', 'noiseTarget', 'lastNoise']
  };
  for (const key of aliases[type] || []) {
    if (hasOwn(context, key)) return context[key];
  }
  return null;
}

function interruptCandidate(type = '', value = true, context = {}) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const definition = INTERRUPT_DEFINITIONS[normalizedType];
  if (!definition || !interruptIsActive(value)) return null;
  const details = value && typeof value === 'object' ? value : {};
  return {
    id: safeRoutineId(details.id || details.packageId, `interrupt:${normalizedType}`),
    type: normalizedType,
    state: String(details.state || definition.state),
    target: interruptTarget(normalizedType, value, context),
    priority: finiteNumber(details.priority, definition.priority),
    interruptPolicy: String(details.interruptPolicy || 'immediate'),
    resumePolicy: String(details.resumePolicy || definition.resumePolicy),
    serviceAvailable: false,
    startHour: null,
    endHour: null,
    conditions: {},
    order: Object.keys(INTERRUPT_DEFINITIONS).indexOf(normalizedType),
    source: 'interrupt'
  };
}

function collectInterrupts(context = {}) {
  const candidates = [];
  const add = (type, value) => {
    const row = interruptCandidate(type, value, context);
    if (row) candidates.push(row);
  };

  if (typeof context.interrupt === 'string') add(context.interrupt, true);
  else if (context.interrupt && typeof context.interrupt === 'object') {
    add(context.interrupt.type || context.interrupt.state, context.interrupt);
  }
  if (typeof context.interruptType === 'string') add(context.interruptType, true);

  if (Array.isArray(context.interrupts)) {
    for (const value of context.interrupts) {
      if (typeof value === 'string') add(value, true);
      else if (value && typeof value === 'object') add(value.type || value.state, value);
    }
  } else if (context.interrupts && typeof context.interrupts === 'object') {
    for (const [type, value] of Object.entries(context.interrupts)) add(type, value);
  }

  const aliases = {
    combat: ['combat', 'inCombat', 'combatActive', 'hasCombatTarget'],
    alarm: ['alarm', 'alarmActive'],
    dialogue: ['dialogue', 'inDialogue', 'dialogueActive', 'npcDialogueFocus'],
    investigate: ['investigate', 'investigating', 'investigateActive']
  };
  for (const [type, keys] of Object.entries(aliases)) {
    for (const key of keys) {
      if (hasOwn(context, key) && interruptIsActive(context[key])) {
        add(type, context[key]);
        break;
      }
    }
  }
  if (String(context.aiState || '').toLowerCase() in INTERRUPT_DEFINITIONS) add(context.aiState, true);
  if (Number.isFinite(Number(context.investigateUntil))
    && Number(context.investigateUntil) > finiteNumber(context.now, 0)) {
    add('investigate', { target: context.investigateTarget || context.lastNoise || null });
  }

  const byType = new Map();
  for (const row of candidates) {
    const previous = byType.get(row.type);
    if (!previous || row.priority > previous.priority) byType.set(row.type, row);
  }
  return [...byType.values()].sort((a, b) => b.priority - a.priority || a.order - b.order);
}

function routineInterruptBlocksService(context = {}) {
  return collectInterrupts(context).some(row => (
    row.type === 'combat' || row.type === 'alarm' || row.type === 'investigate'
  ));
}

function defaultFallbackPackage() {
  return {
    id: 'routine:fallback',
    type: 'sandbox',
    state: 'idle',
    target: null,
    priority: -1000,
    interruptPolicy: 'interruptible',
    resumePolicy: 'reevaluate',
    serviceAvailable: false,
    startHour: null,
    endHour: null,
    conditions: {},
    order: Number.MAX_SAFE_INTEGER,
    source: 'fallback'
  };
}

function selectRoutinePackage(options = {}) {
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const interrupts = collectInterrupts(context);
  if (interrupts.length) return interrupts[0];

  const gameHour = normalizeGameHour(options.gameHour ?? context.gameHour ?? 0);
  const active = preparedPackages(options.packages || options.routine || [])
    .filter(row => routinePackageMatches(row, gameHour, context))
    .sort((a, b) => Number(b.priority) - Number(a.priority)
      || Number(a.order || 0) - Number(b.order || 0)
      || String(a.id).localeCompare(String(b.id)));
  if (active.length) return active[0];
  if (options.fallback === false || options.fallback === null) return null;
  if (options.fallback && typeof options.fallback === 'object') {
    return normalizePackageRow(options.fallback, 0, { routineId: 'fallback', defaultPriority: -1000, source: 'fallback' });
  }
  return defaultFallbackPackage();
}

function resolveAuthoritativeClock(options = {}) {
  const now = finiteNumber(options.now, Date.now());
  const sampledAt = finiteNumber(options.sampledAt, now);
  const gameDayRealMs = finiteNumber(options.gameDayRealMs, DEFAULT_GAME_DAY_REAL_MS);
  if (!(gameDayRealMs > 0)) throw new RangeError('gameDayRealMs must be greater than zero');
  const persistedWorldHour = Math.max(0, finiteNumber(options.worldHour, 0));
  const elapsedMs = Math.max(0, now - sampledAt);
  const absoluteWorldHour = persistedWorldHour + elapsedMs * FULL_DAY_HOURS / gameDayRealMs;
  const worldDay = Math.floor(absoluteWorldHour / FULL_DAY_HOURS);
  const gameHour = normalizeGameHour(absoluteWorldHour);
  return {
    worldHour: absoluteWorldHour,
    absoluteWorldHour,
    gameHour,
    worldDay,
    gameDay: worldDay,
    elapsedMs,
    sampledAt,
    now,
    gameDayRealMs,
    millisecondsPerGameHour: gameDayRealMs / FULL_DAY_HOURS
  };
}

function nextRoutineBoundary(options = {}) {
  const gameHour = normalizeGameHour(options.gameHour ?? 0);
  const boundaries = new Set();
  for (const row of preparedPackages(options.packages || options.routine || [])) {
    if (routineConditionsDependOnDay(row.conditions)) boundaries.add(0);
    if (row.startHour == null || row.endHour == null) continue;
    const start = normalizeGameHour(row.startHour);
    const end = normalizeGameHour(row.endHour);
    if (Math.abs(start - end) < HOUR_EPSILON) continue;
    boundaries.add(start);
    boundaries.add(end);
  }
  if (!boundaries.size) return null;

  let nextHour = null;
  let hoursUntil = Infinity;
  for (const boundary of boundaries) {
    let delta = normalizeGameHour(boundary - gameHour);
    if (delta < HOUR_EPSILON) delta = FULL_DAY_HOURS;
    if (delta < hoursUntil) {
      nextHour = boundary;
      hoursUntil = delta;
    }
  }
  const worldDay = Math.floor(finiteNumber(options.worldDay ?? options.gameDay, 0));
  const dayOffset = gameHour + hoursUntil >= FULL_DAY_HOURS - HOUR_EPSILON ? 1 : 0;
  const gameDayRealMs = finiteNumber(options.gameDayRealMs, DEFAULT_GAME_DAY_REAL_MS);
  return {
    gameHour: nextHour,
    hoursUntil,
    dayOffset,
    worldDay: worldDay + dayOffset,
    absoluteWorldHour: (worldDay + dayOffset) * FULL_DAY_HOURS + nextHour,
    millisecondsUntil: gameDayRealMs > 0 ? hoursUntil * gameDayRealMs / FULL_DAY_HOURS : null
  };
}

function routineConditionsDependOnDay(conditions = {}) {
  if (!conditions || typeof conditions !== 'object') return false;
  if (hasOwn(conditions, 'days') || hasOwn(conditions, 'dayOfWeek')) return true;
  if (conditions.require && (hasOwn(conditions.require, 'gameDay')
    || hasOwn(conditions.require, 'worldDay')
    || hasOwn(conditions.require, 'dayOfWeek'))) return true;
  if (conditions.context && (hasOwn(conditions.context, 'gameDay')
    || hasOwn(conditions.context, 'worldDay')
    || hasOwn(conditions.context, 'dayOfWeek'))) return true;
  if (Array.isArray(conditions.all) && conditions.all.some(routineConditionsDependOnDay)) return true;
  if (Array.isArray(conditions.any) && conditions.any.some(routineConditionsDependOnDay)) return true;
  return Boolean(conditions.not && routineConditionsDependOnDay(conditions.not));
}

module.exports = {
  DEFAULT_GAME_DAY_REAL_MS,
  LEGACY_ROUTINE_TEMPLATES,
  INTERRUPT_PRIORITIES,
  normalizeGameHour,
  hourInsideWindow,
  stableRoutineRoll,
  createLegacyRoutine,
  normalizeRoutinePackages,
  normalizeAuthoredRoutine,
  normalizeAuthoredRoutineCatalog,
  routinePackageMatches,
  routineInterruptBlocksService,
  selectRoutinePackage,
  resolveAuthoritativeClock,
  nextRoutineBoundary
};
