#!/usr/bin/env node
'use strict';

// Сбор как в Albion (src/server/gathering.js) на настоящем конфиге тиров:
// цикл растёт с тиром узла, инструмент не обязателен и ускоряет только не ниже
// тира узла, заряды узла растут с тиром, цикл засчитывается не раньше срока,
// шаг в сторону, урон, другой узел или другая комната прерывают сбор, туша
// зверя — временный узел шкуры, а шкура падает только со зверей, не с мутантов.

const path = require('node:path');
const assert = require('node:assert/strict');
const tiers = require('../src/server/kromka-tiers');
const gathering = require('../src/server/gathering');

const { config } = tiers.readTieredCatalogs(path.join(__dirname, '..', 'data'));

// Цикл: без инструмента — базовый по тиру, с инструментом тира узла и выше —
// быстрее, с инструментом ниже тира — как без него.
for (let tier = 1; tier <= 5; tier++) {
  const bare = gathering.gatherCycleMs(config, tier, 0);
  assert.equal(bare, config.gathering.cycleMs[tier - 1], `bare-hand cycle of T${tier}`);
  assert(gathering.gatherCycleMs(config, tier, tier) < bare, `a T${tier} tool speeds a T${tier} node`);
  assert.equal(gathering.gatherCycleMs(config, tier, 5), gathering.gatherCycleMs(config, tier, tier), 'a higher tool is no faster than one of the node tier');
  if (tier > 1) assert.equal(gathering.gatherCycleMs(config, tier, tier - 1), bare, `a tool below T${tier} does not help`);
  if (tier > 1) assert(bare > gathering.gatherCycleMs(config, tier - 1, 0), 'higher tiers take longer to gather');
  assert(gathering.nodeCharges(config, tier) >= (tier > 1 ? gathering.nodeCharges(config, tier - 1) : 1), 'charges grow with the tier');
}
console.log('PASS cycle length and node charges follow the tier, a tool of the node tier speeds gathering');

// Сессия: цикл не раньше срока, затем следующий через ту же длительность.
const node = { id: 'tier_ore_1', tier: 3, hp: 7, maxHp: 7 };
const player = { x: 10, z: 4 };
const session = gathering.beginGatherSession({ config, resource: node, player, roomId: 'arena', tool: { id: 'pickaxeT3', tier: 3 }, now: 1000 });
assert.equal(session.toolId, 'pickaxeT3');
assert.equal(session.cycleMs, gathering.gatherCycleMs(config, 3, 3));
const at = (now, extra = {}) => gathering.checkGatherCycle(config, session, { resourceId: node.id, roomId: 'arena', player, now, ...extra });
assert.deepEqual({ ok: at(1000 + session.cycleMs / 2).ok, stop: at(1000 + session.cycleMs / 2).stop }, { ok: false, stop: false }, 'an early cycle is refused but gathering goes on');
assert.equal(at(1000 + session.cycleMs).ok, true, 'a finished cycle counts');
gathering.advanceGatherSession(session, 1000 + session.cycleMs);
assert.equal(at(1000 + session.cycleMs + 10).ok, false, 'the next cycle needs its own time');
assert.equal(at(1000 + 2 * session.cycleMs).ok, true);
assert.equal(session.cycles, 1);
console.log('PASS a cycle counts only once it has run its time');

// Прерывание: шаг дальше допуска, урон после начала, другой узел или комната.
const moved = at(1000 + 2 * session.cycleMs, { player: { x: 10 + config.gathering.moveToleranceM + 0.1, z: 4 } });
assert.equal(moved.stop, true, 'walking away stops gathering');
assert.equal(moved.reason, 'moved');
assert.equal(at(1000 + 2 * session.cycleMs, { player: { x: 10.3, z: 4.2 } }).ok, true, 'shuffling on the spot keeps gathering');
const hit = at(1000 + 2 * session.cycleMs, { lastDamageAt: 1500 });
assert.equal(hit.stop, true, 'taking damage stops gathering');
assert.equal(hit.reason, 'damaged');
assert.equal(at(1000 + 2 * session.cycleMs, { lastDamageAt: 900 }).ok, true, 'damage from before the start does not stop it');
assert.equal(at(1000 + 2 * session.cycleMs, { resourceId: 'tier_ore_2' }).stop, true, 'another node is another gathering');
assert.equal(at(1000 + 2 * session.cycleMs, { roomId: 'other' }).stop, true, 'the same node id in another room is not this node');
assert.equal(gathering.checkGatherCycle(config, null, { resourceId: node.id, roomId: 'arena', player, now: 5000 }).stop, true, 'no cycle without a started gathering');
console.log('PASS moving, damage, another node or room stop gathering');

// Без инструмента сбор идёт, просто медленнее; инструмент ниже тира не помогает.
const bare = gathering.beginGatherSession({ config, resource: node, player, roomId: 'arena', tool: { id: 'pickaxe', tier: 1 }, now: 0 });
assert.equal(bare.toolId, '', 'a tool below the node tier is not used (and not worn)');
assert.equal(bare.cycleMs, config.gathering.cycleMs[2]);
console.log('PASS gathering needs no tool');

// Туша: временный узел шкуры тира зоны, не занимает клетку и истлевает.
const carcass = gathering.carcassResource(config, { enemyId: 'gari_7', tx: 4, tz: 9, tier: 4, charges: 3, now: 100 });
assert.equal(carcass.type, 'hide');
assert.equal(carcass.tier, 4);
assert.equal(carcass.hp, 3);
assert.equal(carcass.carcass, true);
assert.equal(carcass.expiresAt, 100 + config.gathering.carcassMs);
console.log('PASS a slain beast leaves a hide carcass node of the zone tier');

// Шкуры — только со зверей; пыльники и плакальщики — мутанты без шкур. Каждый
// зверь со шкурой дорастает до пятого тира.
assert.deepEqual([...config.hideDrops.species].sort(), ['fold', 'gari', 'lantern', 'listener', 'rykhlyak']);
for (const id of config.hideDrops.species) {
  assert(config.enemies.species[id]?.tiers.includes(5), `${id} lives up to tier 5`);
}
assert(config.hideDrops.qty[0] >= 1 && config.hideDrops.qty[1] >= config.hideDrops.qty[0], 'a carcass holds at least one hide');
console.log('PASS hides come from beasts only, and every hide beast reaches tier 5');

console.log('Gathering OK: tiered cycles and charges, optional tools, timed cycles, interruption, hide carcasses.');
