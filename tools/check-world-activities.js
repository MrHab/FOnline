#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');
const { applyActivityOutcome, deriveLiveRegion } = require('../src/server/wasteland-live-regions');
const { dedupeActiveWorldContracts, worldContractSemanticKey } = require('../src/server/world-contracts');
const {
  WORLD_ACTIVITY_SCHEMA,
  createResourceExpedition,
  createReconExpedition,
  createOutpostDefense,
  createDistressSignal,
  createAssaultDiversion,
  publicWorldActivity,
  recordWorldActivityParticipant,
  requestWorldActivityHelp,
  recordWorldActivityHelpResponse,
  requestWorldActivityRally,
  createWorldActivityPing,
  setWorldActivityParticipantDowned,
  applyWorldActivityHarvest,
  applyWorldActivityInteraction,
  applyWorldActivityEnemyKill,
  tickWorldActivity,
  extractWorldActivity,
  worldActivityRewardCharacterIds
} = require('../src/server/world-activity-runtime');
const {
  WORLD_ACTIVITY_DIRECTOR_SCHEMA,
  WORLD_ACTIVITY_STALL_MS,
  planWorldActivityDirector
} = require('../src/server/world-activity-director');
const {
  createWorldActivityPointPositions,
  createWorldActivityEncounterLayout,
  selectWorldActivityEncounterWave
} = require('../src/server/world-activity-layout');
const {
  selectQuickWorldActivityTask,
  selectRoomWorldActivityTask
} = require('../src/server/world-activity-matchmaking');

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

function assertPublicContractRows(rows, label) {
  assert(Array.isArray(rows), `${label} must be an array`);
  const activeKeys = [];
  for (const row of rows) {
    assert(row && typeof row === 'object', `${label} contains an invalid contract row`);
    assert.strictEqual(row.journalCategory, 'contract',
      `${label} contract ${row.id || '<unknown>'} can leak into the story journal`);
    assert.strictEqual(row.procedural, true,
      `${label} contract ${row.id || '<unknown>'} is not marked as procedural`);
    assert.strictEqual(typeof row.contractKey, 'string',
      `${label} contract ${row.id || '<unknown>'} has no semantic contract key`);
    assert(row.contractKey.trim(), `${label} contract ${row.id || '<unknown>'} has an empty semantic contract key`);
    if (String(row.status || 'active').toLowerCase() === 'active') activeKeys.push(row.contractKey);
  }
  assert.strictEqual(new Set(activeKeys).size, activeKeys.length,
    `${label} exposes semantically duplicate active contracts`);
}

function checkContractSemanticDedupe() {
  const base = {
    id: 'delivery_north',
    key: 'delivery_north',
    type: 'deliver_supplies',
    status: 'active',
    title: 'Доставка к Северной вышке',
    siteId: 'north_tower',
    reward: { xp: 40, caps: 25 },
    details: {
      objective: 'support_resource_site',
      resourceSupport: true,
      supportReason: 'shortage',
      rewardFactionId: 'old_klim',
      demand: { water: 4, wood: 2 },
      locationId: 'north_tower_location',
      x: 10,
      y: 12
    }
  };
  const sameWorkAtAnotherPoint = {
    ...base,
    id: 'delivery_south',
    key: 'delivery_south',
    title: 'Доставка к Южной вышке',
    siteId: 'south_tower',
    reward: { xp: 95, caps: 80 },
    details: { ...base.details, locationId: 'south_tower_location', x: 80, y: 64 }
  };
  assert.strictEqual(worldContractSemanticKey(base), worldContractSemanticKey(sameWorkAtAnotherPoint),
    'a procedural job changed identity only because its point name, coordinates, or reward changed');
  assert.strictEqual(dedupeActiveWorldContracts([base, sameWorkAtAnotherPoint]).length, 1,
    'equivalent procedural jobs were not collapsed to one contract-board offer');

  const differentDemand = {
    ...sameWorkAtAnotherPoint,
    id: 'delivery_more_water',
    details: { ...sameWorkAtAnotherPoint.details, demand: { water: 8, wood: 2 } }
  };
  const differentFaction = {
    ...sameWorkAtAnotherPoint,
    id: 'delivery_relay',
    details: { ...sameWorkAtAnotherPoint.details, rewardFactionId: 'relay_order' }
  };
  assert.notStrictEqual(worldContractSemanticKey(base), worldContractSemanticKey(differentDemand),
    'contracts with different required cargo were incorrectly collapsed');
  assert.notStrictEqual(worldContractSemanticKey(base), worldContractSemanticKey(differentFaction),
    'contracts for different factions were incorrectly collapsed');
}

function checkEncounterLayout() {
  const layout = createWorldActivityEncounterLayout({
    bounds: { minX: 10, minZ: 10, maxX: 49, maxZ: 49 },
    seed: 'operation:old_klim',
    resolveSafeTile: (tx, tz) => ({ tx, tz }),
    tileToWorld: (tx, tz) => ({ x: tx * 2, z: tz * 2 })
  });
  assert(layout && layout.lanes.length === 4,
    'a normal activity location must expose four readable approach lanes');
  assert(layout.objectiveBounds.width < 40 && layout.objectiveBounds.height < 40,
    'operation objectives still span the entire local map instead of one staged zone');
  assert(layout.lanes.every(lane => Math.hypot(lane.tx - layout.focus.tx,
    lane.tz - layout.focus.tz) >= 6),
  'an approach lane can appear inside the objective zone');

  const defense = createOutpostDefense({
    taskId: 'layout_defense', target: 6, bonusTarget: 8, maxTarget: 9,
    encounter: layout, now: 900000
  });
  const firstWave = selectWorldActivityEncounterWave(defense, defense.encounter);
  applyWorldActivityEnemyKill(defense, { enemyId: 'layout_enemy_1', now: 901000 });
  applyWorldActivityEnemyKill(defense, { enemyId: 'layout_enemy_2', now: 902000 });
  const secondWave = selectWorldActivityEncounterWave(defense, defense.encounter);
  assert.strictEqual(firstWave.waveNumber, 1);
  assert.strictEqual(secondWave.waveNumber, 2);
  assert.notStrictEqual(firstWave.lane.id, secondWave.lane.id,
    'successive defense waves approach from the same unreadable random direction');
  const publicLayout = publicWorldActivity(defense).encounter;
  assert(publicLayout && publicLayout.focus && publicLayout.lanes.length === 4,
    'Unity snapshot lost the server encounter layout');
  assert(!JSON.stringify(publicLayout).includes('"tx"')
    && !JSON.stringify(publicLayout).includes('"objectiveBounds"'),
  'public encounter layout leaked internal tile authoring details');
}

function checkTemporaryWorldConsequences() {
  const site = { id: 'test_outpost', name: 'Тестовый аванпост', type: 'outpost', owner: 'old_klim', security: 42, danger: 2, stockpile: {} };
  const stored = applyActivityOutcome({}, {
    siteId: site.id,
    kind: 'outpost_defense',
    success: true,
    grade: 'bonus',
    worldHour: 10,
    durationHours: 18,
    participantCount: 3,
    contribution: 8
  });
  const during = deriveLiveRegion(site, { worldHour: 12, market: { scarcity: 30 }, control: {}, stored });
  const recovered = deriveLiveRegion(site, { worldHour: 29, market: { scarcity: 30 }, control: {}, stored });
  assert(during.aftermath && during.security.value > recovered.security.value,
    'successful event aftermath must visibly improve the region while it is active');
  assert.strictEqual(recovered.aftermath, null,
    'event aftermath must expire instead of permanently damaging or buffing the world');
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

function checkQuickJoinAndLiveHelp() {
  const now = Date.now();
  const routine = {
    id: 'routine', type: 'resource_expedition', status: 'active', siteId: 'scrap_fields', priority: 5,
    targetX: 10, targetY: 10, liveEvent: { stage: 'active', community: { participantCount: 3 } }
  };
  const rescue = {
    id: 'rescue', type: 'recon_expedition', status: 'active', siteId: 'radio_tower', priority: 1,
    targetX: 20, targetY: 20,
    liveEvent: { stage: 'active', community: { participantCount: 1 }, helpSignal: { active: true, expiresAt: now + 120000 } }
  };
  assert.strictEqual(selectQuickWorldActivityTask([routine, rescue], { now, playerX: 0, playerY: 0 }).id, 'rescue',
    'an active player help signal must outrank routine quick-join activities');
  assert.strictEqual(selectQuickWorldActivityTask([routine, rescue], {
    now, playerX: 0, playerY: 0, acceptedTaskIds: ['routine']
  }).id, 'routine', 'quick join must resume an already accepted activity before taking another one');

  const activity = createResourceExpedition({ taskId: 'help_task', target: 3, durationMs: 180000, now });
  recordWorldActivityParticipant(activity, {
    characterId: 'caller_secret', name: 'Разведчик', joinedVia: 'quick_join', now
  });
  const requested = requestWorldActivityHelp(activity, {
    characterId: 'caller_secret', name: 'Разведчик', durationMs: 60000, now
  });
  assert.strictEqual(requested.ok, true, requested.error || 'help signal was rejected');
  const response = recordWorldActivityHelpResponse(activity, {
    characterId: 'responder_secret', name: 'Медик', now: now + 1000
  });
  assert.strictEqual(response.ok, true, response.error || 'help response was rejected');
  const publicRow = publicWorldActivity(activity);
  assert.strictEqual(publicRow.squad.temporary, true);
  assert.strictEqual(publicRow.squad.memberCount, 2);
  assert.strictEqual(publicRow.squad.members[1].joinedVia, 'help_signal');
  assert.strictEqual(publicRow.helpSignal.responderCount, 1);
  assert(!JSON.stringify(publicRow).includes('responder_secret'), 'public help state leaked a character id');
  const ping = createWorldActivityPing(activity, {
    characterId: 'responder_secret', name: 'Медик', type: 'danger', label: 'ВРАГ', x: 8, z: -3,
    durationMs: 6000, now: now + 2000
  });
  assert.strictEqual(ping.ok, true, ping.error || 'squad ping was rejected');
  assert.strictEqual(publicWorldActivity(activity).pings[0].type, 'danger');
  assert.strictEqual(ping.ping.expiresAt - ping.ping.createdAt, 7000,
    'danger ping does not use its short combat lifetime');
  assert(!JSON.stringify(publicWorldActivity(activity).pings).includes('responder_secret'),
    'public squad ping leaked a character id');
  assert.strictEqual(setWorldActivityParticipantDowned(activity, {
    characterId: 'responder_secret', downed: true, downedUntil: now + 20000, now: now + 2500
  }), true, 'activity participant did not enter the downed state');
  assert.strictEqual(publicWorldActivity(activity).squad.members[1].downed, true,
    'temporary squad did not expose the teammate revive state');
  assert.strictEqual(setWorldActivityParticipantDowned(activity, {
    characterId: 'responder_secret', downed: false, now: now + 3000
  }), true, 'activity participant did not leave the downed state after revive');
  const refreshedPing = createWorldActivityPing(activity, {
    characterId: 'responder_secret', name: 'Медик', type: 'loot', label: 'ЛУТ', x: 9, z: -2,
    now: now + 3500
  });
  assert.strictEqual(refreshedPing.ping.expiresAt - refreshedPing.ping.createdAt, 15000,
    'loot ping does not use its longer discovery lifetime');
  assert.strictEqual(publicWorldActivity(activity).pings.length, 1,
    'a player can clutter the squad map with more than one active ping');
  assert.strictEqual(publicWorldActivity(activity).pings[0].type, 'loot',
    'a new ping did not replace the same player previous ping');
  const movePing = createWorldActivityPing(activity, {
    characterId: 'caller_secret', name: 'Разведчик', type: 'move', label: 'СЮДА', x: 6, z: -1,
    now: now + 4000
  });
  assert.strictEqual(movePing.ping.expiresAt - movePing.ping.createdAt, 10000,
    'move ping does not use its rendezvous lifetime');
  assert.strictEqual(publicWorldActivity(activity).pings.length, 2,
    'one player replacement removed another squad member ping');
  assert(!JSON.stringify(publicWorldActivity(activity).pings).includes('ownerKey'),
    'public squad pings expose their internal owner key');
  tickWorldActivity(activity, now + 61000);
  assert.strictEqual(publicWorldActivity(activity).helpSignal, null, 'expired help signal stayed in the activity feed');
  assert.strictEqual(publicWorldActivity(activity).pings.length, 0, 'expired squad ping stayed in the activity feed');

  const rallyActivity = createResourceExpedition({ taskId: 'rally_task', target: 3, durationMs: 180000, now });
  applyWorldActivityHarvest(rallyActivity, {
    itemId: 'scrap', qty: 3, characterId: 'rally_one', name: 'Первый', now: now + 1000
  });
  recordWorldActivityParticipant(rallyActivity, {
    characterId: 'rally_two', name: 'Второй', joinedAt: now + 1000
  });
  assert.strictEqual(extractWorldActivity(rallyActivity, {
    characterId: 'rally_one', name: 'Первый', now: now + 2000
  }).ok, true);
  const firstVote = requestWorldActivityRally(rallyActivity, {
    characterId: 'rally_one', name: 'Первый', nextTaskId: 'next_task', now: now + 3000
  });
  assert.strictEqual(firstVote.ok, true);
  assert.strictEqual(firstVote.ready, false);
  const secondVote = requestWorldActivityRally(rallyActivity, {
    characterId: 'rally_two', name: 'Второй', nextTaskId: 'different_task', now: now + 4000
  });
  assert.strictEqual(secondVote.ready, true, 'two squad members did not form the next-activity rally');
  assert.strictEqual(secondVote.nextTaskId, 'next_task', 'a later vote replaced the squad next activity');
  assert(!JSON.stringify(publicWorldActivity(rallyActivity)).includes('rally_one'),
    'public rally state leaked a character id');
}

function checkTrackedActivityArrival() {
  const oldTask = {
    id: 'old_assault', type: 'assault_diversion', status: 'active',
    siteId: 'ant_hive', priority: 9
  };
  const trackedTask = {
    id: 'tracked_assault', type: 'assault_diversion', status: 'active',
    siteId: 'ant_hive', priority: 1
  };
  const players = [{
    id: 'traveller',
    worldTaskAccepted: [oldTask.id, trackedTask.id],
    worldTaskTrackedId: trackedTask.id
  }];
  assert.strictEqual(selectRoomWorldActivityTask([oldTask, trackedTask], players).id,
    trackedTask.id,
    'arrival started an older accepted task instead of the operation tracked on the global map');
  assert.strictEqual(selectRoomWorldActivityTask([oldTask, trackedTask], [{
    id: 'traveller', worldTaskAccepted: [oldTask.id], worldTaskTrackedId: ''
  }]).id, oldTask.id, 'room selection ignored the only accepted operation');
}

function checkMissionDirector() {
  const startedAt = 1_700_000;
  const defense = createOutpostDefense({
    taskId: 'director_defense', target: 6, bonusTarget: 8, maxTarget: 9, now: startedAt
  });
  const opening = planWorldActivityDirector(defense, {
    liveHostiles: 0, participantCount: 1, combatStarted: false
  }, startedAt);
  assert.strictEqual(opening.schema, WORLD_ACTIVITY_DIRECTOR_SCHEMA);
  assert.strictEqual(opening.spawnCount, 2,
    'a solo outpost defense must receive a playable opening wave immediately');
  assert.strictEqual(planWorldActivityDirector(defense, {
    liveHostiles: 2, participantCount: 1, combatStarted: true
  }, startedAt + 1000).spawnCount, 0,
  'the director must not stack a new wave while enough activity hostiles are alive');
  const recovered = planWorldActivityDirector(defense, {
    liveHostiles: 0,
    participantCount: 1,
    combatStarted: true,
    objectiveUnavailable: true
  }, startedAt + WORLD_ACTIVITY_STALL_MS + 1);
  assert.strictEqual(recovered.recoveryNeeded, true,
    'a vanished combat wave must be recognized as a recoverable stalled objective');
  assert(recovered.spawnCount > 0,
    'the combat objective became mathematically impossible after its live targets vanished');

  const distress = createDistressSignal({
    taskId: 'director_distress',
    interactionPoints: [{ id: 'distress_signal_1', label: 'Маяк', x: 2, z: 3 }],
    target: 4,
    maxTarget: 6,
    now: startedAt
  });
  assert.strictEqual(planWorldActivityDirector(distress, {
    liveHostiles: 0, combatStarted: false
  }, startedAt).spawnCount, 0,
  'the distress ambush must not appear before the beacon is activated');
  applyWorldActivityInteraction(distress, {
    pointId: 'distress_signal_1', characterId: 'rescuer', now: startedAt + 1000
  });
  assert(planWorldActivityDirector(distress, {
    liveHostiles: 0, combatStarted: false
  }, startedAt + 1000).spawnCount > 0,
  'activating the distress beacon did not release the ambush stage');

  const operation = createAssaultDiversion({
    taskId: 'director_operation', interactionPoints: operationPoints(), now: startedAt
  });
  assert.strictEqual(planWorldActivityDirector(operation, {
    liveHostiles: 0, combatStarted: false
  }, startedAt).spawnCount, 0,
  'operation defenders must wait until the player chooses an approach');
  applyWorldActivityInteraction(operation, {
    pointId: 'approach_assault', characterId: 'stormer', now: startedAt + 1000
  });
  assert(planWorldActivityDirector(operation, {
    liveHostiles: 0, combatStarted: false
  }, startedAt + 1000).spawnCount > 0,
  'choosing direct assault did not start its combat stage');

  const diversion = createAssaultDiversion({
    taskId: 'director_diversion', interactionPoints: operationPoints(), now: startedAt
  });
  applyWorldActivityInteraction(diversion, {
    pointId: 'approach_diversion', characterId: 'saboteur', now: startedAt + 1000
  });
  assert.strictEqual(planWorldActivityDirector(diversion, {
    liveHostiles: 0, combatStarted: false
  }, startedAt + 1000).spawnCount, 0,
  'the stealth diversion branch must not be converted into a forced combat wave');
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
  assert.strictEqual(activity.phase, 'ambush',
    'activating the distress beacon did not advance to a readable ambush stage');
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
    const initialPublic = sim.publicState();
    assert(initialPublic.worldActivities.length <= 3,
      'the mass-market activity feed must expose at most three important events');
    assert(initialPublic.worldActivities.every(row => row.liveEvent?.causeLabel && row.liveEvent?.stageLabel),
      'every public activity must explain its cause and lifecycle stage');
    assertPublicContractRows(initialPublic.worldTasks, 'public worldTasks');
    assertPublicContractRows(initialPublic.worldActivities, 'public worldActivities');

    const visibleSeed = initialPublic.worldTasks.find(row => (
      String(row?.status || 'active').toLowerCase() === 'active'
      && row?.type === 'resource_expedition'
    ));
    assert(visibleSeed, 'simulation did not expose a groupable contract for semantic-deduplication verification');
    const simulationState = sim.state();
    const rawSeed = simulationState.worldTasks.find(row => String(row?.id || '') === String(visibleSeed.id || ''));
    assert(rawSeed, 'public active contract has no matching authoritative task');
    const semanticDuplicate = JSON.parse(JSON.stringify(rawSeed));
    semanticDuplicate.id = `${rawSeed.id}_semantic_duplicate`;
    semanticDuplicate.key = `${rawSeed.key || rawSeed.id}_semantic_duplicate`;
    semanticDuplicate.createdHour = Number(rawSeed.createdHour || 0) + 0.001;
    assert.strictEqual(worldContractSemanticKey(semanticDuplicate), worldContractSemanticKey(rawSeed),
      'the exported world-contract key treats a copied procedural contract as a different semantic offer');
    simulationState.worldTasks.unshift(semanticDuplicate);
    try {
      const deduplicatedPublic = sim.publicState();
      assertPublicContractRows(deduplicatedPublic.worldTasks, 'deduplicated public worldTasks');
      const matchingRows = deduplicatedPublic.worldTasks.filter(row => (
        String(row?.status || 'active').toLowerCase() === 'active'
        && row?.contractKey === visibleSeed.contractKey
      ));
      assert.strictEqual(matchingRows.length, 1,
        'the public contract feed did not collapse an intentionally duplicated active contract');
    } finally {
      const duplicateIndex = simulationState.worldTasks.findIndex(row => row?.id === semanticDuplicate.id);
      if (duplicateIndex >= 0) simulationState.worldTasks.splice(duplicateIndex, 1);
    }
    assert(initialPublic.sites.every(row => row.liveRegion?.supply?.label
      && row.liveRegion?.security?.label && row.liveRegion?.influence?.label),
    'every public site must expose readable supply, security and influence states');
    const task = sim.state().worldTasks.find(row => row?.status === 'active' && row.type === 'resource_expedition');
    assert(task, 'simulation did not seed a resource expedition');
    assert(task.details?.locationId, 'resource expedition has no target location');
    const synced = sim.syncWorldActivityProgress(task.id, {
      progress: 2,
      goal: 6,
      participantCount: 2,
      participantNames: ['Сборщик', 'Охранник']
    });
    assert.strictEqual(synced?.ok, true, 'shared activity contribution did not sync into the world feed');
    const syncedTask = sim.publicWorldTasks([task.id])[0];
    assert.strictEqual(syncedTask.liveEvent.community.progress, 2);
    assert.strictEqual(syncedTask.liveEvent.community.participantCount, 2);
    const helpSynced = sim.syncWorldActivityProgress(task.id, {
      progress: 2,
      goal: 6,
      participantCount: 2,
      participantNames: ['Сборщик', 'Охранник'],
      helpSignal: {
        active: true,
        requestedByCharacterId: 'private_character',
        requestedByName: 'Сборщик',
        message: 'Нужна помощь у северного входа.',
        requestedAt: Date.now(),
        expiresAt: Date.now() + 120000,
        responderCharacterIds: ['private_responder'],
        responderNames: ['Охранник']
      }
    });
    assert.strictEqual(helpSynced?.ok, true, 'help signal did not sync into the live activity feed');
    const helpedTask = sim.publicWorldTasks([task.id])[0];
    assert.strictEqual(helpedTask.liveEvent.helpSignal.requestedByName, 'Сборщик');
    assert.strictEqual(helpedTask.liveEvent.helpSignal.responderCount, 1);
    assert(!JSON.stringify(helpedTask).includes('private_character'), 'public live event leaked caller identity');
    const result = sim.completeWorldActivityTask(task.id, {
      grade: 'bonus',
      objectiveCurrent: 9,
      rewardCharacterIds: ['character_a', 'character_a', 'character_b']
    });
    assert.strictEqual(result?.ok, true, result?.error || 'activity completion failed');
    assert.strictEqual(result.task.status, 'completed');
    assert.strictEqual(result.task.details.activityGrade, 'bonus');
    assert.deepStrictEqual(result.task.details.rewardCharacterIds, ['character_a', 'character_b']);
    const completedSite = sim.publicState().sites.find(row => row.id === task.siteId);
    assert.strictEqual(completedSite.liveRegion.aftermath.outcome, 'success',
      'successful activity did not leave a visible temporary consequence');
    assert(completedSite.liveRegion.aftermath.participantCount >= 2,
      'temporary consequence lost the shared participant count');
    const failedTask = sim.state().worldTasks.find(row =>
      row?.status === 'active' && row.type === 'resource_expedition' && row.id !== task.id);
    assert(failedTask, 'simulation did not keep a second activity for timeout verification');
    const failedResult = sim.failWorldActivityTask(failedTask.id, { reason: 'time_expired' });
    assert.strictEqual(failedResult?.ok, true, failedResult?.error || 'activity failure did not close');
    assert.strictEqual(failedResult.task.status, 'failed');
    assert.strictEqual(failedResult.task.details.activityGrade, 'failed');
    assert.strictEqual(failedResult.task.details.failureReason, 'time_expired');
    const failedSite = sim.publicState().sites.find(row => row.id === failedTask.siteId);
    assert.strictEqual(failedSite.liveRegion.aftermath.outcome, 'failure',
      'failed activity did not leave a bounded negative consequence');
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
checkContractSemanticDedupe();
checkQuickJoinAndLiveHelp();
checkTrackedActivityArrival();
checkMissionDirector();
checkCompactWorldActivityLayout();
checkEncounterLayout();
checkTemporaryWorldConsequences();
checkReconRuntime();
checkOutpostDefenseRuntime();
checkDistressSignalRuntime();
checkAssaultDiversionRuntime();
checkSimulationContract();
console.log('World activities OK: mission director, collection, recon, defense waves, extraction, rewards and redaction');
