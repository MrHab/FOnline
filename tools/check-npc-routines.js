'use strict';

const assert = require('assert');
const {
  LEGACY_ROUTINE_TEMPLATES,
  hourInsideWindow,
  createLegacyRoutine,
  normalizeAuthoredRoutine,
  normalizeAuthoredRoutineCatalog,
  routineInterruptBlocksService,
  selectRoutinePackage,
  resolveAuthoritativeClock,
  nextRoutineBoundary
} = require('../src/server/npc-routines');

function fixedRoll(values = {}) {
  return (_seed, salt) => Object.prototype.hasOwnProperty.call(values, salt) ? values[salt] : 0.5;
}

function selected(routine, gameHour, context = {}) {
  return selectRoutinePackage({ packages: routine.packages, gameHour, context });
}

assert.deepStrictEqual(
  Object.keys(LEGACY_ROUTINE_TEMPLATES),
  ['guard', 'night_guard', 'merchant', 'craftsman', 'worker'],
  'all legacy templates must be available'
);
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(LEGACY_ROUTINE_TEMPLATES).map(([key, rows]) => [
    key,
    rows.map(row => [row.startHour, row.endHour, row.state])
  ])),
  {
    guard: [[0, 5, 'sleep'], [5, 7, 'rest'], [7, 13, 'work'], [13, 14, 'rest'], [14, 20, 'work'], [20, 22, 'social'], [22, 24, 'sleep']],
    night_guard: [[0, 6, 'work'], [6, 8, 'social'], [8, 15, 'sleep'], [15, 17, 'rest'], [17, 24, 'work']],
    merchant: [[0, 7, 'sleep'], [7, 8, 'rest'], [8, 13, 'work'], [13, 14, 'rest'], [14, 20, 'work'], [20, 22, 'social'], [22, 24, 'sleep']],
    craftsman: [[0, 6, 'sleep'], [6, 8, 'rest'], [8, 12, 'work'], [12, 13, 'social'], [13, 18, 'work'], [18, 21, 'social'], [21, 24, 'sleep']],
    worker: [[0, 6, 'sleep'], [6, 7, 'rest'], [7, 12, 'work'], [12, 13, 'rest'], [13, 18, 'work'], [18, 21, 'social'], [21, 24, 'sleep']]
  },
  'legacy windows must remain byte-for-byte compatible with the existing schedules'
);

const zeroShift = fixedRoll({ 'schedule-shift': 0.5, 'night-guard': 0.1 });
const guard = createLegacyRoutine({ seed: 'guard-a', role: 'guard', stableRoll: zeroShift });
assert.strictEqual(guard.template, 'guard');
assert.strictEqual(guard.shift, 0);
assert.deepStrictEqual(
  guard.segments.map(row => [row.start, row.end, row.state]),
  [
    [0, 5, 'sleep'],
    [5, 7, 'rest'],
    [7, 13, 'work'],
    [13, 14, 'rest'],
    [14, 20, 'work'],
    [20, 22, 'social'],
    [22, 0, 'sleep']
  ],
  'guard windows must stay compatible with the legacy server schedule'
);

const nightGuard = createLegacyRoutine({
  seed: 'guard-night',
  role: 'guard',
  stableRoll: fixedRoll({ 'schedule-shift': 0.5, 'night-guard': 0.9 })
});
assert.strictEqual(nightGuard.template, 'night_guard', 'guard roll above 0.72 must select the night shift');
assert.strictEqual(selected(nightGuard, 2).state, 'work');
assert.strictEqual(selected(nightGuard, 10).state, 'sleep');

const earlyWorker = createLegacyRoutine({
  seed: 'worker-early',
  role: 'worker',
  stableRoll: fixedRoll({ 'schedule-shift': 0 })
});
const lateWorker = createLegacyRoutine({
  seed: 'worker-late',
  role: 'worker',
  stableRoll: fixedRoll({ 'schedule-shift': 0.999 })
});
assert.strictEqual(earlyWorker.shift, -1);
assert.strictEqual(earlyWorker.packages[0].startHour, 23);
assert.strictEqual(lateWorker.shift, 1);
assert.strictEqual(lateWorker.packages[0].startHour, 1);

assert.deepStrictEqual(
  createLegacyRoutine({ seed: 'same-seed', role: 'merchant' }),
  createLegacyRoutine({ seed: 'same-seed', role: 'merchant' }),
  'built-in stable hashing must make legacy routines deterministic'
);

assert.strictEqual(hourInsideWindow(23.75, 22, 6), true);
assert.strictEqual(hourInsideWindow(5.99, 22, 6), true);
assert.strictEqual(hourInsideWindow(6, 22, 6), false);
assert.strictEqual(hourInsideWindow(12, 0, 0), true, 'equal boundaries mean a full-day package');

const authored = normalizeAuthoredRoutine({
  id: 'old-klim',
  packages: [
    {
      id: 'sleep-at-home',
      type: 'sleep',
      time: { start: '22:00', end: '06:00' },
      target: 'bed:old-klim',
      priority: 100
    },
    {
      id: 'open-shop',
      type: 'shop',
      state: 'work',
      startHour: 8,
      endHour: 20,
      target: 'counter:old-klim',
      priority: 100,
      serviceAvailable: true,
      conditions: { flags: { shopUnlocked: true } }
    },
    {
      id: 'quest-meeting',
      type: 'dialogue_scene',
      state: 'social',
      startHour: 9,
      endHour: 12,
      targetId: 'marker:meeting',
      priority: 250,
      when: { questStage: { min: 3 } },
      interruptPolicy: 'protected',
      resumePolicy: 'resume'
    },
    {
      id: 'day-sandbox',
      type: 'sandbox',
      start: 6,
      end: 22,
      priority: 1
    }
  ]
});

const authoredDocument = {
  schema: 'realm.npc-routines.v1',
  version: 1,
  routines: { 'old-klim': { id: 'old-klim', packages: authored.packages } }
};
assert.strictEqual(
  normalizeAuthoredRoutine(authoredDocument, { id: 'old-klim' }).packages.length,
  authored.packages.length,
  'normalization must accept the root data/npc-routines.json schema'
);
assert.strictEqual(
  normalizeAuthoredRoutineCatalog(authoredDocument).routines['old-klim'].id,
  'old-klim',
  'routine catalogs must preserve stable authored IDs'
);

assert.strictEqual(authored.id, 'old-klim');
for (const row of authored.packages) {
  for (const field of ['id', 'type', 'state', 'target', 'priority', 'interruptPolicy', 'resumePolicy', 'serviceAvailable']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, field), `normalized package must contain ${field}`);
  }
}
assert.strictEqual(selected(authored, 23).id, 'sleep-at-home', 'authored midnight window must select sleep');
assert.strictEqual(
  selected(authored, 10, { flags: { shopUnlocked: true }, questStage: 1 }).id,
  'open-shop',
  'authored conditions must exclude an unavailable higher-priority package'
);
assert.strictEqual(
  selected(authored, 10, { flags: { shopUnlocked: true }, questStage: 3 }).id,
  'quest-meeting',
  'higher-priority authored package must win when its conditions match'
);

const merchant = createLegacyRoutine({
  seed: 'merchant-service',
  role: 'merchant',
  stableRoll: zeroShift
});
assert.strictEqual(selected(merchant, 9).serviceAvailable, true, 'merchant service must be open during work');
assert.strictEqual(selected(merchant, 13.5).serviceAvailable, false, 'merchant service must close for rest');
assert.strictEqual(selected(merchant, 21).serviceAvailable, false, 'merchant service must close after work');

assert.strictEqual(selected(merchant, 9, { investigate: { target: 'noise:1' } }).type, 'investigate');
assert.strictEqual(
  selected(merchant, 9, { investigate: true, dialogue: { target: 'player:1' } }).type,
  'dialogue',
  'dialogue must outrank investigation'
);
assert.strictEqual(
  selected(merchant, 9, { investigate: true, dialogue: true, alarm: true, combat: { target: 'raider:1' } }).type,
  'combat',
  'combat must outrank all other interrupts'
);
assert.strictEqual(selected(merchant, 9, { alarm: true, dialogue: true }).type, 'alarm');
assert.strictEqual(selected(merchant, 9, { dialogue: true }).serviceAvailable, false);
assert.strictEqual(routineInterruptBlocksService({ combat: true }), true);
assert.strictEqual(routineInterruptBlocksService({ alarm: true }), true);
assert.strictEqual(routineInterruptBlocksService({ investigate: true }), true);
assert.strictEqual(routineInterruptBlocksService({ dialogue: true }), false,
  'dialogue alone must preserve an open merchant service');
assert.strictEqual(routineInterruptBlocksService({ dialogue: true, investigate: true }), true,
  'an active investigation must close service even while dialogue has the higher presentation priority');

const gameDayRealMs = 60 * 60 * 1000;
const clock = resolveAuthoritativeClock({
  worldHour: 23,
  sampledAt: 1_000_000,
  now: 1_000_000 + gameDayRealMs / 2,
  gameDayRealMs
});
assert.strictEqual(clock.absoluteWorldHour, 35);
assert.strictEqual(clock.gameHour, 11);
assert.strictEqual(clock.worldDay, 1);
assert.strictEqual(clock.millisecondsPerGameHour, 150000);

const merchantBoundary = nextRoutineBoundary({
  packages: merchant.packages,
  gameHour: 21.5,
  worldDay: 4,
  gameDayRealMs
});
assert.strictEqual(merchantBoundary.gameHour, 22);
assert.strictEqual(merchantBoundary.hoursUntil, 0.5);
assert.strictEqual(merchantBoundary.worldDay, 4);
assert.strictEqual(merchantBoundary.millisecondsUntil, 75000);

const midnightBoundary = nextRoutineBoundary({
  packages: authored.packages.filter(row => row.id === 'sleep-at-home'),
  gameHour: 23.5,
  worldDay: 7,
  gameDayRealMs
});
assert.strictEqual(midnightBoundary.gameHour, 6);
assert.strictEqual(midnightBoundary.hoursUntil, 6.5);
assert.strictEqual(midnightBoundary.worldDay, 8);

const dayConditionBoundary = nextRoutineBoundary({
  packages: [{
    id: 'market-day',
    type: 'shop',
    state: 'work',
    target: 'counter',
    priority: 100,
    interruptPolicy: 'interruptible',
    resumePolicy: 'reevaluate',
    serviceAvailable: true,
    startHour: 0,
    endHour: 0,
    conditions: { days: [1, 3, 5] },
    order: 0
  }],
  gameHour: 18,
  worldDay: 2,
  gameDayRealMs
});
assert.strictEqual(dayConditionBoundary.gameHour, 0, 'day-based conditions must wake the evaluator at midnight');
assert.strictEqual(dayConditionBoundary.hoursUntil, 6);
assert.strictEqual(dayConditionBoundary.worldDay, 3);

console.log(`NPC routines OK: ${Object.keys(LEGACY_ROUTINE_TEMPLATES).length} legacy templates, authored selection, interrupts, clock and boundaries.`);
