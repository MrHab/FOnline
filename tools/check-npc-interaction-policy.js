#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const functionSource = name => {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `Missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const context = vm.createContext({
  WORLD_ECONOMY: { worldModel: { npcTraders: true, wildTraders: false }, npcTradeHubs: [] },
  LOCATIONS: { capital: {} },
  normalizeLocationId: value => value,
  locationIsFactionCapital: () => true,
  serverNpcIsNaturalCreature: () => false,
  serverIsBlackMarketActor: () => false
});
for (const name of ['serverNpcHasQuestDialogue', 'serverNpcHasDialogue', 'serverNpcTradeOpen'])
  vm.runInContext(functionSource(name), context);

const ordinaryTrader = { role: 'merchant', canDialogue: true, authoredLocationId: 'capital' };
const questTrader = { ...ordinaryTrader, traderQuests: ['supplies'] };
const namedQuestNpc = { ...ordinaryTrader, kromkaNamedNpcId: 'story_guide' };
const specialist = service => ({ canDialogue: true, service });

assert.equal(context.serverNpcTradeOpen(ordinaryTrader), true);
assert.equal(context.serverNpcHasDialogue(ordinaryTrader), false);
assert.equal(context.serverNpcTradeOpen(questTrader), false);
assert.equal(context.serverNpcHasDialogue(questTrader), true);
assert.equal(context.serverNpcTradeOpen(namedQuestNpc), false);
assert.equal(context.serverNpcHasDialogue(namedQuestNpc), true);
assert.equal(context.serverNpcHasDialogue({ kromkaOnboardingNpcId: 'first_step' }), true);
for (const service of ['auction', 'medic', 'repair'])
  assert.equal(context.serverNpcHasDialogue(specialist(service)), true, service);
for (const service of ['fastTravel', 'registrar', 'artifactLab'])
  assert.equal(context.serverNpcHasDialogue(specialist(service)), false, service);

console.log('NPC interaction policy OK: quest dialogue, service dialogue, direct trader access, quest trade rejection.');
