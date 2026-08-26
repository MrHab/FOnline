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

const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const enemies = read('unity-client/Assets/Scripts/Game/RoaEnemies.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const combat = read('unity-client/Assets/Scripts/Game/RoaCombat.cs');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const staging = read('unity-client/Assets/Scripts/Game/RoaCaravanStagingCanvas.cs');
const simulation = read('src/server/wasteland-sim.js');
const server = read('server.js');

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
