#!/usr/bin/env node
'use strict';

// Сбор как в Albion (src/server/gathering.js) на настоящем конфиге тиров:
// цикл растёт с тиром узла, T1 берут голыми руками, выше нужен инструмент не ниже
// тира узла (он же ускоряет), опыт профессии тира N идёт до уровня тира N+1,
// заряды узла растут с тиром, цикл засчитывается не раньше срока,
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

// T1 берут голыми руками, выше нужен инструмент тира узла; инструмент ниже тира не помогает.
assert.equal(config.gathering.toolFreeTier, 1, 'only T1 is gathered bare-handed');
assert.equal(gathering.toolRequired(config, 1), false, 'a T1 node needs no tool');
for (let tier = 2; tier <= 5; tier++) assert.equal(gathering.toolRequired(config, tier), true, `a T${tier} node needs a tool`);
const bareT1 = gathering.beginGatherSession({ config, resource: { ...node, tier: 1 }, player, roomId: 'arena', tool: { id: '', tier: 0 }, now: 0 });
assert.equal(bareT1.toolId, '', 'a bare-handed T1 gathering wears no tool');
assert.equal(bareT1.cycleMs, config.gathering.cycleMs[0], 'bare hands gather T1 at the base pace');
const bare = gathering.beginGatherSession({ config, resource: node, player, roomId: 'arena', tool: { id: 'pickaxe', tier: 1 }, now: 0 });
assert.equal(bare.toolId, '', 'a tool below the node tier is not used (and not worn)');
assert.equal(gathering.toolHelps({ id: 'pickaxe', tier: 1 }, 3), false, 'a T1 pickaxe does not open a T3 node');
assert.equal(gathering.toolHelps({ id: 'pickaxeT4', tier: 4 }, 3), true, 'a pickaxe above the node tier opens it');
console.log('PASS T1 needs no tool, T2–T5 need a tool of the node tier or higher');

// Опыт профессии по лестнице тиров: работа тира N учит до уровня, открывающего N+1.
const t2Xp = tiers.professionXpForLevel(config, tiers.tierRow(config, 2).level);
assert.equal(tiers.professionXpCapForTier(config, 1), t2Xp, 'T1 work teaches up to the T2 level');
assert.equal(tiers.professionXpCapForTier(config, 5), tiers.professionXpForLevel(config, config.professions.maxLevel),
  'T5 work teaches up to the top of the profession');
const ladder = { gatherMetal: t2Xp - 5 };
const last = tiers.grantProfessionXp(config, ladder, 'gatherMetal', tiers.professionXpForWork(config, 1, 1), { tier: 1 });
assert.equal(last.gained, 5, 'the last T1 unit tops the profession up to the T2 level, not past it');
assert.equal(last.capped, true);
assert.equal(last.capTier, 2);
assert.equal(tiers.professionAllowsTier(config, ladder.gatherMetal, 2), true, 'T1 work alone opens T2');
const stale = tiers.grantProfessionXp(config, ladder, 'gatherMetal', tiers.professionXpForWork(config, 1, 3), { tier: 1 });
assert.equal(stale.gained, 0, 'T1 work teaches nothing once T2 is open');
assert.equal(stale.capped, true);
const t2 = tiers.grantProfessionXp(config, ladder, 'gatherMetal', tiers.professionXpForWork(config, 2, 1), { tier: 2 });
assert.equal(t2.gained, tiers.tierRow(config, 2).xp, 'T2 work goes on teaching');
assert.equal(t2.capped, undefined);
const veteran = { gatherMetal: t2Xp + 900 };
assert.equal(tiers.grantProfessionXp(config, veteran, 'gatherMetal', 60, { tier: 1 }).gained, 0);
assert.equal(veteran.gatherMetal, t2Xp + 900, 'experience above the cap earned earlier is kept, never cut back');
console.log(`PASS T1 work teaches up to level ${tiers.tierRow(config, 2).level}, then only the next tier does`);

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

console.log('Gathering OK: tiered cycles and charges, bare-handed T1 and tools from T2, the profession xp ladder, timed cycles, interruption, hide carcasses.');
