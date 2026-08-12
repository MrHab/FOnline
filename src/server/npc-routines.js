'use strict';

// Времени суток в игре нет, поэтому распорядок свёрнут: у роли ровно одно
// постоянное поведение вместо набора окон по часам. Разнообразие даёт не
// расписание, а сама роль и её место работы.
const ROLE_BEHAVIOURS = Object.freeze({
  guard: Object.freeze({ type: 'guard', state: 'work', target: 'guard_post', serviceAvailable: false }),
  merchant: Object.freeze({ type: 'shop', state: 'work', target: 'shop_counter', serviceAvailable: true }),
  craftsman: Object.freeze({ type: 'craft', state: 'work', target: 'workstation', serviceAvailable: false }),
  worker: Object.freeze({ type: 'work', state: 'work', target: 'worksite', serviceAvailable: false })
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
  // Сна в игре нет: НПС не ложатся. Авторские пакеты с типом sleep
  // деградируют в обычный отдых, чтобы старые данные не роняли распорядок.
  sleep: 'rest',
  rest: 'rest',
  social: 'social',
  socialize: 'social',
  eat: 'eat',
  travel: 'travel',
  sandbox: 'idle',
  wait: 'idle'
});

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function normalizeRoleName(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (hasOwn(ROLE_BEHAVIOURS, raw)) return raw;
  if (raw === 'patrol' || raw === 'guardpost' || raw === 'night_guard') return 'guard';
  if (raw === 'trader' || raw === 'quartermaster') return 'merchant';
  if (raw === 'mechanic') return 'craftsman';
  return '';
}

function roleBehaviourFor(role = '', options = {}) {
  const explicit = normalizeRoleName(options.template || options.role);
  return ROLE_BEHAVIOURS[explicit || normalizeRoleName(role) || 'worker'] || ROLE_BEHAVIOURS.worker;
}

function createLegacyRoutine(options = {}) {
  const role = normalizeRoleName(options.template || options.role) || 'worker';
  const behaviour = roleBehaviourFor(options.role, options);
  const packages = [{
    id: `role:${role}`,
    type: behaviour.type,
    state: behaviour.state,
    target: behaviour.target,
    priority: 100,
    interruptPolicy: 'interruptible',
    resumePolicy: 'reevaluate',
    serviceAvailable: behaviour.serviceAvailable,
    conditions: {},
    order: 0,
    source: 'role'
  }];
  return { id: `role:${role}`, role, packages };
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

function routinePackageMatches(row = {}, context = {}) {
  if (!row || row.enabled === false) return false;
  const disabled = Array.isArray(context.disabledPackageIds) ? context.disabledPackageIds : [];
  if (disabled.includes(row.id)) return false;
  return conditionsMatch(row.conditions, context);
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
    conditions: {},
    order: Number.MAX_SAFE_INTEGER,
    source: 'fallback'
  };
}

function selectRoutinePackage(options = {}) {
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const interrupts = collectInterrupts(context);
  if (interrupts.length) return interrupts[0];

  const active = preparedPackages(options.packages || options.routine || [])
    .filter(row => routinePackageMatches(row, context))
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

module.exports = {
  ROLE_BEHAVIOURS,
  INTERRUPT_PRIORITIES,
  stableRoutineRoll,
  createLegacyRoutine,
  normalizeRoutinePackages,
  normalizeAuthoredRoutine,
  normalizeAuthoredRoutineCatalog,
  routinePackageMatches,
  routineInterruptBlocksService,
  selectRoutinePackage
};
