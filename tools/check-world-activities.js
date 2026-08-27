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
  createReconExpedition,
  createOutpostDefense,
  createDistressSignal,
  createAssaultDiversion,
  publicWorldActivity,
  applyWorldActivityHarvest,
  applyWorldActivityInteraction,
  applyWorldActivityEnemyKill,
  tickWorldActivity,
  extractWorldActivity,
  worldActivityRewardCharacterIds
} = require('../src/server/world-activity-runtime');
const { createWorldActivityPointPositions } = require('../src/server/world-activity-layout');

function checkCompactWorldActivityLayout() {
  const blocked = new Set(['10:10', '11:11', '12:12', '13:13']);
  const points = createWorldActivityPointPositions({
    bounds: { minX: 10, minZ: 10, maxX: 29, maxZ: 29 },
    count: 6,
    resolveSafeTile: (tx, tz) => blocked.has(`${tx}:${tz}`) ? null : { tx, tz },
    tileToWorld: (tx, tz) => ({ x: tx, z: tz })
  });
  assert.strictEqual(points.length, 6, 'compact 20x20 activity location must still receive every operation point');
  assert.strictEqual(new Set(points.map(point => `${point.tx}:${point.tz}`)).size, 6,
    'operation points must stay unique after compact-layout fallback');
}
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


function checkReconRuntime() {
  const startedAt = 2_000_000;
  const interactionPoints = Array.from({ length: 5 }, (_, index) => ({
    id: `recon_${index + 1}`,
    label: `Точка ${index + 1}`,
    x: index * 8,
    z: index * -5
  }));
  const activity = createReconExpedition({
    taskId: 'task_recon_a',
    interactionPoints,
    target: 3,
    bonusTarget: 4,
    durationMs: 180000,
    now: startedAt
  });
  assert.strictEqual(activity.kind, 'recon_expedition');
  assert.strictEqual(activity.interactionPoints.length, 5);
  assert.strictEqual(applyWorldActivityInteraction(activity, { pointId: 'missing' }).changed, false);
  for (let index = 1; index <= 3; index += 1) {
    const progress = applyWorldActivityInteraction(activity, {
      pointId: `recon_${index}`,
      characterId: 'recon_character',
      name: 'Разведчик',
      now: startedAt + index * 1000
    });
    assert.strictEqual(progress.changed, true);
  }
  assert.strictEqual(activity.status, 'extracting');
  assert.strictEqual(activity.extractionOpen, true);
  const bonus = applyWorldActivityInteraction(activity, {
    pointId: 'recon_4',
    characterId: 'recon_character',
    name: 'Разведчик',
    now: startedAt + 5000
  });
  assert.strictEqual(bonus.objective.status, 'bonus');
  assert.strictEqual(activity.interactionPoints[3].status, 'completed');
  const publicJson = JSON.stringify(publicWorldActivity(activity));
  assert(!publicJson.includes('recon_character'), 'public recon activity leaked a character id');
  const extracted = extractWorldActivity(activity, { characterId: 'recon_character', now: startedAt + 6000 });
  assert.strictEqual(extracted.grade, 'bonus');
}

function checkOutpostDefenseRuntime() {
  const startedAt = 3_000_000;
  const activity = createOutpostDefense({
    taskId: 'task_defense_a', target: 3, bonusTarget: 4, maxTarget: 5, durationMs: 180000, now: startedAt
  });
  assert.strictEqual(activity.kind, 'outpost_defense');
  assert.strictEqual(activity.threatTier, 1, 'defense must start with the first wave ready');
  const first = applyWorldActivityEnemyKill(activity, {
    enemyId: 'attacker_1', characterId: 'defender_character', name: 'Защитник', now: startedAt + 1000
  });
  assert.strictEqual(first.changed, true);
  assert.strictEqual(first.threatTier, 2);
  assert.strictEqual(applyWorldActivityEnemyKill(activity, { enemyId: 'attacker_1' }).changed, false,
    'one attacker must never count twice');
  applyWorldActivityEnemyKill(activity, {
    enemyId: 'attacker_2', characterId: 'defender_character', name: 'Защитник', now: startedAt + 2000
  });
  const goal = applyWorldActivityEnemyKill(activity, {
    enemyId: 'attacker_3', characterId: 'defender_character', name: 'Защитник', now: startedAt + 3000
  });
  assert.strictEqual(goal.extractionOpened, true);
  assert.strictEqual(activity.status, 'extracting');
  applyWorldActivityEnemyKill(activity, {
    enemyId: 'attacker_4', characterId: 'defender_character', name: 'Защитник', now: startedAt + 4000
  });
  assert.strictEqual(activity.objectives[0].status, 'bonus');
  assert.strictEqual(activity.participants[0].contributed, 4);
  const publicJson = JSON.stringify(publicWorldActivity(activity));
  assert(!publicJson.includes('defender_character'), 'public defense activity leaked a character id');
  assert(!publicJson.includes('creditedEntityIds'), 'public defense activity leaked internal kill ids');
  const extracted = extractWorldActivity(activity, { characterId: 'defender_character', now: startedAt + 5000 });
  assert.strictEqual(extracted.grade, 'bonus');
}

function checkDistressSignalRuntime() {
  const startedAt = 4_000_000;
  const activity = createDistressSignal({
    taskId: 'task_distress_a',
    interactionPoints: [{ id: 'distress_signal_1', label: 'Маяк', x: 3, z: 7 }],
    target: 2, bonusTarget: 3, maxTarget: 4, durationMs: 180000, now: startedAt
  });
  assert.strictEqual(activity.threatTier, 0);
  const signal = applyWorldActivityInteraction(activity, {
    pointId: 'distress_signal_1', characterId: 'rescuer_character', name: 'Спасатель', now: startedAt + 1000
  });
  assert.strictEqual(signal.changed, true);
  assert.strictEqual(activity.threatTier, 1);
  assert.strictEqual(activity.extractionOpen, false, 'finding the beacon alone must not complete the rescue');
  applyWorldActivityEnemyKill(activity, {
    enemyId: 'ambusher_1', characterId: 'rescuer_character', name: 'Спасатель', now: startedAt + 2000
  });
  const cleared = applyWorldActivityEnemyKill(activity, {
    enemyId: 'ambusher_2', characterId: 'rescuer_character', name: 'Спасатель', now: startedAt + 3000
  });
  assert.strictEqual(cleared.extractionOpened, true);
  applyWorldActivityEnemyKill(activity, {
    enemyId: 'ambusher_3', characterId: 'rescuer_character', name: 'Спасатель', now: startedAt + 4000
  });
  assert.strictEqual(activity.objectives[1].status, 'bonus');
  const extracted = extractWorldActivity(activity, { characterId: 'rescuer_character', now: startedAt + 5000 });
  assert.strictEqual(extracted.grade, 'bonus', 'multi-objective grading must use the attackers objective');
  assert.strictEqual(extracted.result.objectiveCurrent, 4);
  const publicJson = JSON.stringify(publicWorldActivity(activity));
  assert(!publicJson.includes('rescuer_character'), 'public distress activity leaked a character id');
}
function operationPoints() {
  return [
    { id: 'approach_assault', label: 'Штурм', x: 0, z: 0 },
    { id: 'approach_diversion', label: 'Диверсия', x: 10, z: 0 },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `sabotage_${index + 1}`, label: `Объект ${index + 1}`, x: index * 5, z: 10, status: 'locked'
    }))
  ];
}

function checkAssaultDiversionRuntime() {
  const startedAt = 5_000_000;
  const assault = createAssaultDiversion({
    taskId: 'task_operation_assault', interactionPoints: operationPoints(),
    targetKills: 3, bonusKills: 4, maxKills: 5, now: startedAt
  });
  assert.strictEqual(assault.approach, '');
  const selected = applyWorldActivityInteraction(assault, {
    pointId: 'approach_assault', characterId: 'stormer', name: 'Штурмовик', now: startedAt + 1000
  });
  assert.strictEqual(selected.approach, 'assault');
  assert.strictEqual(assault.threatTier, 1);
  assert(assault.interactionPoints.filter(point => point.id.startsWith('sabotage_')).every(point => point.status === 'disabled'));
  for (let index = 1; index <= 3; index += 1) applyWorldActivityEnemyKill(assault, {
    enemyId: `guard_${index}`, characterId: 'stormer', name: 'Штурмовик', now: startedAt + 1000 + index * 1000
  });
  assert.strictEqual(assault.extractionOpen, true);
  assert.strictEqual(extractWorldActivity(assault, { characterId: 'stormer', now: startedAt + 6000 }).grade, 'completed');

  const diversion = createAssaultDiversion({
    taskId: 'task_operation_diversion', interactionPoints: operationPoints(),
    targetSabotage: 3, bonusSabotage: 4, now: startedAt
  });
  applyWorldActivityInteraction(diversion, {
    pointId: 'approach_diversion', characterId: 'saboteur', name: 'Диверсант', now: startedAt + 1000
  });
  assert.strictEqual(diversion.approach, 'diversion');
  assert.strictEqual(diversion.interactionPoints.find(point => point.id === 'approach_assault').status, 'disabled');
  for (let index = 1; index <= 4; index += 1) applyWorldActivityInteraction(diversion, {
    pointId: `sabotage_${index}`, characterId: 'saboteur', name: 'Диверсант', now: startedAt + 1000 + index * 1000
  });
  assert.strictEqual(diversion.extractionOpen, true);
  assert.strictEqual(diversion.objectives.find(row => row.id === 'sabotage').status, 'mastered');
  assert.strictEqual(extractWorldActivity(diversion, { characterId: 'saboteur', now: startedAt + 7000 }).grade, 'mastered');
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
    const failedTask = sim.state().worldTasks.find(row =>
      row?.status === 'active' && row.type === 'resource_expedition' && row.id !== task.id);
    assert(failedTask, 'simulation did not keep a second activity for timeout verification');
    const failedResult = sim.failWorldActivityTask(failedTask.id, { reason: 'time_expired' });
    assert.strictEqual(failedResult?.ok, true, failedResult?.error || 'activity failure did not close');
    assert.strictEqual(failedResult.task.status, 'failed');
    assert.strictEqual(failedResult.task.details.activityGrade, 'failed');
    assert.strictEqual(failedResult.task.details.failureReason, 'time_expired');
    assert.strictEqual(sim.failWorldActivityTask(failedTask.id, { reason: 'time_expired' }).ok, false,
      'a failed activity must never restart from the same task');
    const reconTask = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'recon_expedition');
    assert(reconTask, 'simulation did not seed a recon expedition');
    assert(reconTask.details?.locationId, 'recon expedition has no target location');
    const reconResult = sim.completeWorldActivityTask(reconTask.id, {
      grade: 'mastered',
      objectiveCurrent: 5,
      rewardCharacterIds: ['recon_character']
    });
    assert.strictEqual(reconResult?.ok, true, reconResult?.error || 'recon completion failed');
    assert.strictEqual(reconResult.task.details.activityKind, 'recon_expedition');
    assert.strictEqual(reconResult.task.details.activityGrade, 'mastered');
    const defenseTask = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'outpost_defense');
    assert(defenseTask, 'simulation did not seed an outpost defense');
    assert(defenseTask.details?.locationId, 'outpost defense has no target location');
    const defenseResult = sim.completeWorldActivityTask(defenseTask.id, {
      grade: 'completed', objectiveCurrent: 6, rewardCharacterIds: ['defender_character']
    });
    assert.strictEqual(defenseResult?.ok, true, defenseResult?.error || 'outpost defense completion failed');
    assert.strictEqual(defenseResult.task.details.activityKind, 'outpost_defense');
    assert.strictEqual(defenseResult.task.details.activityGrade, 'completed');
    const distressTask = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'distress_signal');
    assert(distressTask, 'simulation did not seed a distress signal');
    const distressResult = sim.completeWorldActivityTask(distressTask.id, {
      grade: 'bonus', objectiveCurrent: 7, rewardCharacterIds: ['rescuer_character']
    });
    assert.strictEqual(distressResult?.ok, true, distressResult?.error || 'distress signal completion failed');
    assert.strictEqual(distressResult.task.details.activityKind, 'distress_signal');
    const operationTask = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'assault_diversion');
    assert(operationTask, 'simulation did not seed an assault/diversion operation');
    const rewardBeforeRejectedCompletion = JSON.stringify(operationTask.reward);
    const rejectedOperation = sim.completeWorldActivityTask(operationTask.id, { grade: 'mastered' });
    assert.strictEqual(rejectedOperation.ok, false, 'operation without an approach must be rejected');
    assert.strictEqual(JSON.stringify(operationTask.reward), rewardBeforeRejectedCompletion, 'rejected operation mutated its reward');
    const operationResult = sim.completeWorldActivityTask(operationTask.id, {
      grade: 'completed', approach: 'diversion', objectiveCurrent: 4, rewardCharacterIds: ['saboteur']
    });
    assert.strictEqual(operationResult?.ok, true, operationResult?.error || 'operation completion failed');
    assert.strictEqual(operationResult.task.details.approach, 'diversion');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

checkRuntime();
checkCompactWorldActivityLayout();
checkReconRuntime();
checkOutpostDefenseRuntime();
checkDistressSignalRuntime();
checkAssaultDiversionRuntime();
checkSimulationContract();
console.log('World activities OK: collection, recon, defense waves, extraction, rewards and redaction');
