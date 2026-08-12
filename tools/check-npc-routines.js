'use strict';
// Роли НПС: расписание свёрнуто, у роли ровно одно постоянное поведение.
// Проверяем сам набор ролей, разбор авторских описаний, доступность сервиса
// и прерывания — единственное, что теперь переключает поведение.
const assert = require('assert');
const {
  ROLE_BEHAVIOURS,
  INTERRUPT_PRIORITIES,
  createLegacyRoutine,
  normalizeAuthoredRoutine,
  normalizeAuthoredRoutineCatalog,
  routineInterruptBlocksService,
  selectRoutinePackage
} = require('../src/server/npc-routines');

const selected = (routine, context = {}) => selectRoutinePackage({ routine, context });

// --- Набор ролей ---
assert.deepStrictEqual(
  Object.keys(ROLE_BEHAVIOURS).sort(),
  ['craftsman', 'guard', 'merchant', 'worker'],
  'набор постоянных ролей изменился'
);
for (const [role, behaviour] of Object.entries(ROLE_BEHAVIOURS)) {
  assert(behaviour.type && behaviour.state && behaviour.target,
    `роль ${role} описана не полностью`);
  assert(!('startHour' in behaviour) && !('endHour' in behaviour),
    `роль ${role} снова описана часовым окном`);
}

// --- У роли ровно одно поведение, и оно не зависит от времени ---
for (const role of Object.keys(ROLE_BEHAVIOURS)) {
  const routine = createLegacyRoutine({ seed: `${role}-a`, role });
  assert.strictEqual(routine.packages.length, 1,
    `роль ${role} должна давать ровно одно поведение`);
  assert.strictEqual(routine.role, role);
  const pkg = selected(routine);
  assert.strictEqual(pkg.type, ROLE_BEHAVIOURS[role].type);
  assert.strictEqual(pkg.target, ROLE_BEHAVIOURS[role].target);
  assert.strictEqual(pkg.serviceAvailable, ROLE_BEHAVIOURS[role].serviceAvailable);
  assert(!('startHour' in pkg) && !('endHour' in pkg),
    `пакет роли ${role} снова получил часовое окно`);
}

// Синонимы ролей приводятся к базовым.
for (const [alias, expected] of [
  ['patrol', 'guard'],
  ['night_guard', 'guard'],
  ['trader', 'merchant'],
  ['quartermaster', 'merchant'],
  ['mechanic', 'craftsman'],
  ['неизвестная роль', 'worker']
]) {
  assert.strictEqual(createLegacyRoutine({ seed: 's', role: alias }).role, expected,
    `синоним роли ${alias} должен приводиться к ${expected}`);
}

// Поведение не зависит от посева: одна роль — один результат.
assert.deepStrictEqual(
  createLegacyRoutine({ seed: 'a', role: 'guard' }).packages,
  createLegacyRoutine({ seed: 'b', role: 'guard' }).packages,
  'поведение роли стало зависеть от случайности'
);

// --- Авторские описания ---
const authored = normalizeAuthoredRoutine({
  id: 'old-klim',
  packages: [
    {
      id: 'shop',
      type: 'shop',
      target: { slotType: 'shop_counter' },
      priority: 100,
      serviceAvailable: true
    },
    {
      id: 'guard-post',
      type: 'guard',
      target: { slotType: 'guard_post' },
      priority: 40
    }
  ]
});

assert.strictEqual(authored.id, 'old-klim', 'идентификатор берётся из описания');
assert.strictEqual(authored.packages.length, 2);
assert.strictEqual(selected(authored).id, 'shop', 'приоритет должен решать выбор поведения');
assert.strictEqual(selected(authored).serviceAvailable, true);
assert.strictEqual(
  selected(authored, { disabledPackageIds: ['shop'] }).id,
  'guard-post',
  'отключение поведения должно передавать выбор следующему по приоритету'
);

const catalog = normalizeAuthoredRoutineCatalog({
  routines: { caravan: { packages: [{ id: 'shop', type: 'shop', serviceAvailable: true }] } }
});
assert(catalog.routines?.caravan, 'каталог авторских ролей не разобран');
assert.strictEqual(catalog.routines.caravan.packages.length, 1);

// --- Прерывания: единственное, что переключает поведение ---
const merchant = createLegacyRoutine({ seed: 'merchant-a', role: 'merchant' });
assert.strictEqual(selected(merchant).serviceAvailable, true, 'торговец должен быть открыт');
assert.strictEqual(selected(merchant, { investigate: { target: 'noise:1' } }).type, 'investigate');
assert.strictEqual(selected(merchant, { combat: { target: 'enemy:1' } }).type, 'combat');
assert.strictEqual(selected(merchant, { alarm: true, dialogue: true }).type, 'alarm',
  'тревога должна перебивать диалог');
assert.strictEqual(selected(merchant, { dialogue: true }).serviceAvailable, false);
assert(INTERRUPT_PRIORITIES.combat > INTERRUPT_PRIORITIES.alarm);
assert(INTERRUPT_PRIORITIES.alarm > INTERRUPT_PRIORITIES.dialogue);

assert.strictEqual(routineInterruptBlocksService({ combat: true }), true);
assert.strictEqual(routineInterruptBlocksService({ alarm: true }), true);
assert.strictEqual(routineInterruptBlocksService({ investigate: true }), true);
assert.strictEqual(routineInterruptBlocksService({ dialogue: true }), false,
  'диалог сам по себе не закрывает торговлю');
assert.strictEqual(routineInterruptBlocksService({ dialogue: true, investigate: true }), true,
  'активная проверка шума закрывает торговлю даже при более заметном диалоге');

// --- Часовой механики не должно остаться ---
const moduleSource = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'src', 'server', 'npc-routines.js'),
  'utf8'
);
for (const forbidden of ['gameHour', 'startHour', 'endHour', 'hourInsideWindow', 'nextRoutineBoundary']) {
  assert(!moduleSource.includes(forbidden),
    `в модуле ролей снова появилась часовая механика: ${forbidden}`);
}

console.log(`NPC roles OK: ${Object.keys(ROLE_BEHAVIOURS).length} постоянных ролей, авторские описания, прерывания; часовых окон нет.`);
