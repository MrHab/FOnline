#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  npcMeleeCommitCapacity,
  npcMeleeCommitLeaseMs,
  npcMeleeCommitCooldownMs,
  tryReserveNpcMeleeCommit,
  completeNpcMeleeCommit
} = require('../src/server/enemy-ai');


assert.deepStrictEqual([1, 2, 5, 6, 40].map(npcMeleeCommitCapacity), [1, 2, 2, 3, 3],
  'melee commit capacity is not bounded at 1/2/3');
assert(npcMeleeCommitLeaseMs(0.6) >= 1100 && npcMeleeCommitLeaseMs(0.6) <= 1350,
  'ordinary melee commit lease does not contain wind-up and follow-through');
assert(npcMeleeCommitCooldownMs(1) > npcMeleeCommitCooldownMs(0),
  'stable cooldown spread no longer rotates attackers');
const actors = Array.from({ length: 8 }, (_, index) => ({
  id: `npc-${index}`, attackTimer: 0.55
}));
const active = new Set();
assert.deepStrictEqual(actors.map(actor =>
  tryReserveNpcMeleeCommit(actor, 'player', actors.length, active, 1000)),
  [true, true, true, false, false, false, false, false],
  'the real reservation helper does not cap an eight-NPC group at three commits');
completeNpcMeleeCommit(actors[0], active, 1100, 0);
assert(tryReserveNpcMeleeCommit(actors[3], 'player', actors.length, active, 1101),
  'a waiting NPC does not inherit a released commit');

console.log('NPC coordination OK: bounded rotating melee commits');
