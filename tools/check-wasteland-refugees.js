#!/usr/bin/env node
'use strict';

// Беженцев в экономике v3 нет: симуляция их не создаёт и не двигает. От модуля
// остались разбор записей из старых сохранений и вариант локальной сцены
// поселения — очередь, баррикады, ремонтная бригада — по его состоянию.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeRefugeeState,
  publicRefugeeFlow,
  settlementSceneVariant
} = require('../src/server/wasteland-refugees');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'world-simulation.json'), 'utf8'));

function settlement(id, options = {}) {
  return {
    id,
    name: id,
    type: 'settlement',
    x: 0,
    y: 0,
    security: options.security ?? 70,
    settlementLife: {
      population: 100,
      protectedMinimum: 50,
      condition: options.condition || 'stable',
      integrity: options.integrity ?? 75,
      tension: 20,
      causeCode: options.causeCode || 'stable_supplies'
    }
  };
}

// --- запись из старого сохранения читается, прибывшая группа активной не считается ---
const legacy = normalizeRefugeeState({
  sequence: 3,
  active: {
    moving: { id: 'moving', members: 9, originSiteId: 'origin', destinationSiteId: 'safe', status: 'moving', x: 1, y: 2 },
    arrived: { id: 'arrived', members: 4, originSiteId: 'origin', status: 'arrived' }
  },
  history: [{ id: 'old', members: 5, status: 'arrived', arrivedHour: 10 }]
}, config);
assert.deepEqual(Object.keys(legacy.active), ['moving'], 'an arrived group must not stay active after load');
assert.equal(legacy.history.length, 1);
const publicFlow = publicRefugeeFlow(legacy.active.moving, { safe: { id: 'safe', name: 'Гавань', x: 10, y: 0 } });
assert(publicFlow.aggregated && publicFlow.canEncounter === false && publicFlow.kind === 'refugees',
  'a legacy refugee group is not explicitly aggregated and non-encounterable');

// --- вариант локальной сцены ---------------------------------------------------------
const crisisScene = settlementSceneVariant(settlement('scene', {
  condition: 'crisis', security: 18, integrity: 35
}), config, 100);
assert(crisisScene.queue && crisisScene.barricades && crisisScene.repairCrew,
  'crisis scene does not expose queues, barricades and repair crews');
assert(crisisScene.actorBudget > 0 && crisisScene.actorBudget <= 8,
  'settlement scene actor budget is not bounded');
const raided = settlementSceneVariant({ ...settlement('raided'), raidUntil: 200 }, config, 100);
assert(raided.barricades && !raided.queue, 'a raid must put up barricades without a ration queue');
const stableScene = settlementSceneVariant(settlement('stable'), config, 100);
assert(!stableScene.queue && !stableScene.barricades && !stableScene.repairCrew
  && stableScene.actorBudget === 0, 'stable scene incorrectly materializes crisis dressing');
assert.equal(settlementSceneVariant({ id: 'mine', type: 'resource' }, config, 100), null,
  'only settlements have a life variant');

console.log('Wasteland refugees OK: legacy refugee records load safely and settlement scenes get bounded queue, barricade and repair variants.');
