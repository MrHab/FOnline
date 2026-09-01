#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = message => {
  console.error(`Unity caravan check failed: ${message}`);
  process.exitCode = 1;
};
const requireText = (source, fragment, label) => {
  if (!source.includes(fragment)) fail(label);
};
const requirePattern = (source, pattern, label) => {
  if (!pattern.test(source)) fail(label);
};
const requireContract = (condition, label) => {
  if (!condition) fail(label);
};

const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const combat = read('unity-client/Assets/Scripts/Game/RoaCombat.cs');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const staging = read('unity-client/Assets/Scripts/Game/RoaCaravanStagingCanvas.cs');
const simulation = read('src/server/wasteland-sim.js');
const server = read('server.js');
const {
  WORLD_OPERATION_SCHEMA,
  createSupplyOperation,
  transitionWorldOperation,
  worldOperationStage
} = require(path.join(root, 'src/server/wasteland-world-tasks.js'));

const preparingOperation = createSupplyOperation({
  partyId: 'contract_caravan',
  issuerFactionId: 'old_klim',
  sourceSiteId: 'settlement',
  destinationSiteId: 'dryWaterPump',
  demand: { water: 12 },
  cargo: { water: 12 },
  goal: {
    summary: 'Пополнение запасов воды.',
    targetSiteId: 'dryWaterPump'
  },
  assignment: {
    leaderId: 'contract_caravan_merchant',
    leaderName: 'Караванщик',
    leaderRole: 'Глава каравана'
  }
}, 24);
const travelingOperation = transitionWorldOperation(preparingOperation, 'traveling', 25);
const completedOperation = transitionWorldOperation(travelingOperation, 'completed', 26, {
  outcome: {
    result: 'delivered',
    reason: 'caravan_arrived',
    siteId: 'dryWaterPump',
    cargo: { water: 12 },
    deliveredUnits: 12,
    npcLosses: 0
  }
});

requireContract(WORLD_OPERATION_SCHEMA === 'realm.worldOperation.v1',
  'the faction caravan operation schema changed without updating its public contract');
requireContract(preparingOperation?.schema === WORLD_OPERATION_SCHEMA
  && preparingOperation?.kind === 'supply_delivery'
  && preparingOperation?.phase === 'preparing'
  && preparingOperation?.status === 'active'
  && preparingOperation?.sourceSiteId === 'settlement'
  && preparingOperation?.destinationSiteId === 'dryWaterPump'
  && preparingOperation?.goal?.reason === 'site_shortage'
  && preparingOperation?.goal?.summary === 'Пополнение запасов воды.'
  && preparingOperation?.assignment?.assigneeId === 'contract_caravan'
  && preparingOperation?.assignment?.leaderName === 'Караванщик'
  && preparingOperation?.assignment?.leaderRole === 'Глава каравана',
  'a preparing faction caravan no longer keeps its reason, route, assignment and generic leader');
requireContract(travelingOperation?.phase === 'traveling'
  && travelingOperation?.status === 'active'
  && travelingOperation?.departureHour === 25
  && travelingOperation?.revision === preparingOperation.revision + 1
  && worldOperationStage(travelingOperation)?.key === 'active',
  'a departing faction caravan no longer advances its public phase, revision and departure time');
requireContract(completedOperation?.phase === 'completed'
  && completedOperation?.status === 'completed'
  && completedOperation?.completedHour === 26
  && completedOperation?.outcome?.result === 'delivered'
  && completedOperation?.outcome?.siteId === 'dryWaterPump'
  && completedOperation?.outcome?.deliveredUnits === 12
  && completedOperation?.outcome?.npcLosses === 0
  && worldOperationStage(completedOperation)?.key === 'completed',
  'a completed faction caravan no longer publishes its bounded delivery outcome');

requirePattern(simulation,
  /function partyLeaderPublicMember\(party = \{\}\)[\s\S]{0,350}kind === 'caravan'[\s\S]{0,250}name: 'Караванщик'[\s\S]{0,120}role: 'Глава каравана'[\s\S]{0,120}type: 'npc'[\s\S]{0,80}leader: true/,
  'public caravan groups no longer use the generic NPC leader Караванщик');
requirePattern(simulation,
  /function publicParty\(party = \{\}\)[\s\S]{0,450}const leader = partyLeaderPublicMember\(party\)/,
  'the public world-party contract no longer resolves its generic NPC leader');
requireText(simulation, 'leaderName: leader.name,',
  'the public world-party contract no longer exposes the caravan leader name');
requireText(simulation, 'groupMembers: [leader, ...npcMembers, ...playerMembers].slice(0, 30),',
  'the public world-party roster no longer places its NPC leader before guards and players');
requirePattern(simulation,
  /const runtimeOperation = taskType === 'escort_caravan'[\s\S]{0,180}publicCaravanWorldOperation\(task, targetParty\)/,
  'public caravan tasks no longer resolve their runtime operation phase');
requireText(simulation,
  'const details = runtimeOperation ? { ...publicDetails, operation: runtimeOperation } : publicDetails;',
  'public caravan task details no longer expose the runtime operation');
requireText(simulation, '...(runtimeOperation ? { operation: runtimeOperation } : {}),',
  'public caravan tasks no longer expose the runtime operation at top level');
requirePattern(simulation,
  /const operationStage = runtimeOperation \? worldOperationStage\(runtimeOperation\) : null;[\s\S]{0,260}stage: operationStage\.key, stageLabel: operationStage\.label/,
  'the public activity stage no longer follows the caravan operation phase');

requireText(socket, '_connection.On("encounterFactionHostile"',
  'RoaSocketClient no longer registers encounterFactionHostile');
requirePattern(socket,
  /encounterFactionHostile[\s\S]{0,500}!IsForCurrentRoom\(payload\["roomId"\][\s\S]{0,300}OnEncounterFactionHostile\?\.Invoke\(payload\)/,
  'encounter hostility is not room-filtered and forwarded on the Unity main thread');

requireText(enemies, 'Socket.OnEncounterFactionHostile += HandleEncounterFactionHostile;',
  'RoaEnemies no longer subscribes to caravan hostility');
requireText(enemies, 'Socket.OnEncounterFactionHostile -= HandleEncounterFactionHostile;',
  'RoaEnemies no longer releases the caravan hostility subscription');
requirePattern(enemies,
  /HandleEncounterFactionHostile\(JObject payload\)[\s\S]{0,350}payload\?\["enemies"\] as JArray[\s\S]{0,250}ApplyPublicEnemy\(token as JObject\)/,
  'RoaEnemies no longer applies every viewer-specific enemy row');

requireText(interaction, 'public bool SubmitRobEncounterActor(string enemyId, Action<JObject> completed = null)',
  'the production robbery entry point is missing');
requirePattern(interaction,
  /SubmitRobEncounterActor\(string enemyId[\s\S]{0,900}EmitWithAck\("robEncounterActor"[\s\S]{0,900}ack\["enemies"\] as JArray[\s\S]{0,350}ApplyPublicEnemy/,
  'robbery no longer waits for an authoritative full-faction acknowledgement');
requirePattern(server,
  /socket\.on\('robEncounterActor'[\s\S]{0,2200}setEncounterFactionHostileToPlayer[\s\S]{0,1200}ack\(\{ ok: true[\s\S]{0,900}encounterFactionHostile[\s\S]{0,500}publicEnemy\(enemy, viewer\)/,
  'server robbery no longer acknowledges the attacker and broadcasts viewer-specific rows');

requireText(combat, 'public bool TriggerAttackAt(Vector3 worldTarget)',
  'the production world-target combat entry point is missing');
requirePattern(combat,
  /weapon == "rocketLauncher"[\s\S]{0,250}SendExplosion\(/,
  'rocket attacks no longer select the explosion route');
requirePattern(combat,
  /private void SendExplosion\([\s\S]{0,900}EmitWithAck\("explosionAttack"/,
  'rocket attacks no longer emit the authoritative explosion action');
requirePattern(combat,
  /HandleExplosionResult\(JObject ack[\s\S]{0,350}ApplyGameplayAck\(ack\)[\s\S]{0,750}ack\["enemies"\] is JArray[\s\S]{0,850}ApplyPublicEnemy(?:Hit)?/,
  'rocket acknowledgement no longer refreshes authoritative player and enemy state');

requirePattern(interaction,
  /InspectCorpse\(JObject corpse\)[\s\S]{0,450}EmitWithAck\("inspectCorpse"[\s\S]{0,650}PanelKind\.Corpse/,
  'corpse inspection no longer opens from a successful server acknowledgement');
requirePattern(interaction,
  /private void Loot\(string itemId, bool all[\s\S]{0,450}"lootEnemy"[\s\S]{0,550}ApplyActionAck\(ack\)/,
  'corpse loot no longer applies the authoritative inventory acknowledgement');

requirePattern(simulation,
  /function applyCaravanEscortArrivalGrade\([\s\S]{0,1800}guardLosses[\s\S]{0,900}escortRewardAdjusted/,
  'lossless caravan arrival no longer receives an idempotent quality grade');
requirePattern(simulation,
  /escortTasks\.forEach\(task[\s\S]{0,250}applyCaravanEscortArrivalGrade[\s\S]{0,900}finishWorldTask/,
  'caravan arrival no longer applies its escort grade before completion');
requireText(pipboy, 'public JObject ActiveEscortTask',
  'Unity no longer exposes the accepted live caravan task');
requireText(pipboy, 'public JObject WorldParty(string id)',
  'Unity no longer resolves the physical caravan party');
requireText(staging, 'private void RefreshLiveRaid',
  'Unity caravan canvas no longer switches from staging to the live route');
requireText(staging, '"\\nРиск " + risk + "%"',
  'Unity caravan HUD no longer shows the simulation risk');
requireText(staging, '"Груз: " + cargo + "% · охрана: " + guards + "/" + initial',
  'Unity caravan HUD no longer shows cargo and guard survival');

if (!process.exitCode) {
  console.log('Unity caravan OK: live route HUD, lossless grade, robbery, rocket battle and corpse loot routes');
}
