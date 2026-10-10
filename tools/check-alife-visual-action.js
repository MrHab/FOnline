#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { siteActorVisualAction } = require('../src/server/alife-visual-action');
const { WINDUP_MS: GRENADE_WINDUP_MS } = require('../src/server/npc-grenade');

const start = 10000;
const actor = { ecologySiteId: 'lair_one' };
const duration = { ability: 1100, grenade: GRENADE_WINDUP_MS,
  search: 1000, gather: 1800, loot: 1800, heal: 1100 };

for (const [action, ms] of Object.entries(duration)) {
  actor.ecologyVisualAction = action;
  actor.ecologyVisualActionStartedAt = start;
  actor.siteVisualAction = '';
  assert.deepEqual(siteActorVisualAction(actor, start + ms - 1, 'idle', false),
    { action, startedAt: start }, `${action} reaches Unity with its authoritative start time`);
  assert.deepEqual(siteActorVisualAction(actor, start + ms, 'idle', false),
    { action: 'guard', startedAt: start + ms }, `${action} cannot persist after its short window`);
}

actor.ecologyVisualAction = 'ability';
actor.ecologyVisualActionStartedAt = start;
assert.deepEqual(siteActorVisualAction(actor, start + 100, 'chase', false),
  { action: 'ability', startedAt: start }, 'an artifact ability is visible while fighting');
actor.ecologyVisualActionStartedAt = start + 200;
assert.deepEqual(siteActorVisualAction(actor, start + 250, 'chase', false),
  { action: 'ability', startedAt: start + 200 }, 'a second same-name action restarts its animation');
assert.equal(siteActorVisualAction(actor, start + 300, 'attack', false).action, 'combat',
  'the actual attack keeps its combat pose');
assert.equal(siteActorVisualAction(actor, start + 350, 'stagger', false).action, 'combat',
  'a hit reaction keeps its combat pose');

actor.targetId = 'attacker';
actor.x = 4;
actor.z = 5;
actor.tacticalGoalKind = 'cover';
actor.tacticalGoalX = 4;
actor.tacticalGoalZ = 5;
actor.tacticalGoalUntil = start + 2000;
actor.tacticalHoldUntil = start + 2000;
assert.equal(siteActorVisualAction(actor, start + 400, 'chase', false).action, 'cover',
  'a real held cover goal precedes the explicit action');
actor.tacticalGoalKind = 'flank';
assert.equal(siteActorVisualAction(actor, start + 450, 'chase', true).action, 'combat',
  'movement cannot play a stationary ability');
actor.ecologyVisualAction = 'search';
assert.equal(siteActorVisualAction(actor, start + 450, 'chase', false).action, 'combat',
  'search cannot override combat');
actor.targetId = '';
actor.ecologyVisualActionStartedAt = start + 5000;
assert.equal(siteActorVisualAction(actor, start + 450, 'idle', false).action, 'guard',
  'a future timestamp cannot trigger an action');
actor.ecologyVisualActionStartedAt = undefined;
assert.equal(siteActorVisualAction(actor, start + 450, 'idle', false).action, 'guard',
  'a missing start cannot hold a pose indefinitely');
actor.ecologyVisualActionStartedAt = start;
actor.dead = true;
assert.equal(siteActorVisualAction(actor, start + 450, 'dead', false).action, 'death',
  'death precedes every explicit action');

console.log('PASS fixed-site action windows, source timestamps, same-action restart, cover/combat/movement/death precedence');
