#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const {
  WORLD_ACTIVITY_SCHEMA,
  createResourceExpedition,
  publicWorldActivity,
  applyWorldActivityHarvest,
  tickWorldActivity,
  extractWorldActivity,
  worldActivityRewardCharacterIds
} = require('../src/server/world-activity-runtime');

function testMap() {
  return {
    grid: { cols: 4, rows: 4, cellPoints: 30, cellKm: 10 },
    nodes: [],
    infrastructure: [],
    cells: Object.fromEntries(Array.from({ length: 16 }, (_, index) => {
      const cx = index % 4;
      const cy = Math.floor(index / 4);
      return [`${cx}:${cy}`, { terrain: 'Пустошь', texture: 'grass', territoryOwner: 'neutral', difficulty: 1 }];
    }))
  };
}

function checkRuntime() {
  const startedAt = 1_000_000;
  const activity = createResourceExpedition({
    taskId: 'task_resource_a',
    roomId: 'resourceScrapFields',
    locationId: 'resourceScrapFields',
    siteId: 'scrapFields',
    allowedItemIds: ['scrap'],
    target: 3,
    bonusTarget: 4,
    maxTarget: 5,
    durationMs: 180000,
    now: startedAt
  });
  assert.strictEqual(activity.schema, WORLD_ACTIVITY_SCHEMA);
  assert.strictEqual(activity.status, 'active');

  const wrong = applyWorldActivityHarvest(activity, { itemId: 'wood', qty: 3, now: startedAt + 1000 });
  assert.strictEqual(wrong.changed, false, 'unrelated resources must not advance the activity');
  const first = applyWorldActivityHarvest(activity, {
    itemId: 'scrap', qty: 2, characterId: 'character_secret', userId: 'user_secret', name: 'Сборщик', now: startedAt + 2000
  });
  assert.strictEqual(first.credited, 2);
  assert.strictEqual(activity.extractionOpen, false);
  const goal = applyWorldActivityHarvest(activity, {
    itemId: 'scrap', qty: 1, characterId: 'character_secret', userId: 'user_secret', name: 'Сборщик', now: startedAt + 3000
  });
  assert.strictEqual(goal.extractionOpened, true);
  assert.strictEqual(activity.status, 'extracting');
  assert.strictEqual(activity.participants[0].contributed, 3);
  assert.deepStrictEqual(worldActivityRewardCharacterIds(activity), ['character_secret']);

  const publicRow = publicWorldActivity(activity);
  const publicJson = JSON.stringify(publicRow);
  assert(!publicJson.includes('character_secret'), 'public activity leaked a character id');
  assert(!publicJson.includes('user_secret'), 'public activity leaked a user id');
  assert.strictEqual(publicRow.participantCount, 1);
  assert.deepStrictEqual(publicRow.participantNames, ['Сборщик']);

  const extracted = extractWorldActivity(activity, { characterId: 'character_secret', now: startedAt + 4000 });
  assert.strictEqual(extracted.ok, true);
  assert.strictEqual(extracted.grade, 'completed');
  assert.strictEqual(activity.status, 'completed');
  assert.strictEqual(extractWorldActivity(activity, { now: startedAt + 5000 }).ok, false);

  const timed = createResourceExpedition({ taskId: 'timed', target: 3, durationMs: 180000, now: startedAt });
  const expired = tickWorldActivity(timed, startedAt + 180001);
  assert.strictEqual(expired.expired, true);
  assert.strictEqual(timed.status, 'failed');
}

function checkSimulationContract() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-world-activities-'));
  try {
    const sim = createWastelandSimulation({
      stateFile: path.join(tempRoot, 'wasteland-sim.json'),
      getGlobalMap: testMap,
      gameDayRealMs: 60 * 60 * 1000,
      saveIntervalMs: 3000
    });
    const task = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'resource_expedition');
    assert(task, 'simulation did not seed a resource expedition');
    assert(task.details?.locationId, 'resource expedition has no target location');
    const result = sim.completeWorldActivityTask(task.id, {
      grade: 'bonus',
      objectiveCurrent: 9,
      rewardCharacterIds: ['character_a', 'character_a', 'character_b']
    });
    assert.strictEqual(result?.ok, true, result?.error || 'activity completion failed');
    assert.strictEqual(result.task.status, 'completed');
    assert.strictEqual(result.task.details.activityGrade, 'bonus');
    assert.deepStrictEqual(result.task.details.rewardCharacterIds, ['character_a', 'character_b']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

checkRuntime();
checkSimulationContract();
console.log('World activities OK: objective, threat, extraction, reward eligibility and redaction');
