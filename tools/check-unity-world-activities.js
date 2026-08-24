#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = message => {
  console.error(`Unity world activities check failed: ${message}`);
  process.exitCode = 1;
};
const requireText = (source, fragment, label) => {
  if (!source.includes(fragment)) fail(label);
};
const requirePattern = (source, pattern, label) => {
  if (!pattern.test(source)) fail(label);
};

const server = read('server.js');
const simulation = read('src/server/wasteland-sim.js');
const runtime = read('src/server/world-activity-runtime.js');
const canvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const globalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const metadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs.meta');
const activityHub = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs');
const activityHubMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs.meta');

requireText(runtime, "const WORLD_ACTIVITY_SCHEMA = 'realm.worldActivity.v1';",
  'the versioned server activity schema is missing');
requirePattern(simulation,
  /function ensureResourceExpeditionTasks\([\s\S]{0,3500}createWorldTask\('resource_expedition'/,
  'the world simulation no longer seeds resource expeditions');
requirePattern(simulation,
  /function ensureReconExpeditionTasks\([\s\S]{0,3500}createWorldTask\('recon_expedition'/,
  'the world simulation no longer seeds recon expeditions');
requirePattern(simulation,
  /function ensureOutpostDefenseTasks\([\s\S]{0,4000}createWorldTask\('outpost_defense'/,
  'the world simulation no longer seeds outpost defenses');
requirePattern(simulation,
  /function ensureDistressSignalTasks\([\s\S]{0,4500}createWorldTask\('distress_signal'/,
  'the world simulation no longer seeds distress signals');
requirePattern(simulation,
  /function ensureAssaultDiversionTasks\([\s\S]{0,4500}createWorldTask\('assault_diversion'/,
  'the world simulation no longer seeds assault-diversion operations');
requireText(simulation, 'worldActivities: activityTasks.slice(0, 18).map(publicTask)',
  'the public simulation no longer exposes a dedicated activity feed');
requireText(simulation, 'worldTasks: visibleTasks.map(publicTask)',
  'live activities are no longer prioritized over legacy jobs');
requirePattern(server,
  /function publicWorldState\([\s\S]{0,900}activity: publicWorldActivity\(room\.worldActivity\)/,
  'activity is no longer part of the authoritative room snapshot');
requirePattern(server,
  /socket\.on\('harvestResource'[\s\S]{0,4500}recordServerWorldActivityHarvest\(room, p, item, now\)/,
  'authoritative harvesting no longer advances the activity');
requirePattern(server,
  /action === 'activity_extract'[\s\S]{0,180}performServerWorldActivityExtraction/,
  'the existing worldTaskAction route no longer handles extraction');
requirePattern(server,
  /performServerWorldActivityExtraction\([\s\S]{0,1500}serverPlayerAtGlobalMapExit\(player\)[\s\S]{0,1600}completeWorldActivityTask/,
  'extraction is not validated at a real exit and completed by the simulation');
requirePattern(server,
  /action === 'activity_interact'[\s\S]{0,220}performServerWorldActivityInteraction/,
  'the existing worldTaskAction route no longer handles recon points');
requirePattern(server,
  /performServerWorldActivityInteraction\([\s\S]{0,1500}distance > 3[\s\S]{0,900}applyWorldActivityInteraction/,
  'recon interaction is not distance-validated by the authoritative server');
requirePattern(server,
  /serverFinishEnemyKilledByPlayer\([\s\S]{0,1000}recordServerWorldActivityEnemyKill/,
  'authoritative enemy deaths no longer advance outpost defense');
requirePattern(server,
  /recordServerWorldActivityEnemyKill\([\s\S]{0,1400}applyWorldActivityEnemyKill[\s\S]{0,1000}spawnServerWorldActivityWave/,
  'outpost defense no longer validates kills and advances waves');

requireText(canvas, 'Socket.OnWorldState += ApplyWorldState;',
  'Unity HUD no longer subscribes to authoritative worldState');
requireText(canvas, 'JObject next = state?["activity"] as JObject;',
  'Unity HUD no longer reads worldState.activity');
requirePattern(canvas,
  /EmitWithAck\("worldTaskAction"[\s\S]{0,300}\["action"\] = "activity_extract"/,
  'Unity extraction no longer uses the acknowledged world task action');
requirePattern(canvas,
  /\["action"\] = "activity_interact"[\s\S]{0,160}\["pointId"\] = pointId/,
  'Unity recon no longer sends an acknowledged point interaction');
requireText(canvas, 'new GameObject("WorldActivityMarkers")',
  'Unity recon world markers are missing');
requireText(canvas, 'kind == "outpost_defense"',
  'Unity HUD has no outpost defense presentation');
requireText(canvas, 'kind == "distress_signal"',
  'Unity HUD has no distress signal presentation');
requireText(canvas, 'kind == "assault_diversion"',
  'Unity HUD has no assault-diversion presentation');
requireText(canvas, 'Bootstrap.FrontendVisible || Bootstrap.OnGlobalMap',
  'activity HUD is not hidden outside a local gameplay location');
requireText(bootstrap, 'WorldActivityCanvas.Configure(Socket, this);',
  'Unity bootstrap no longer configures the activity HUD');
requireText(bootstrap, 'gameObject.AddComponent<RoaActivityHubCanvas>()',
  'Unity bootstrap no longer installs the global activity hub');
requireText(activityHub, 'Map?.WastelandState?["worldActivities"]',
  'the Unity activity hub no longer reads the dedicated feed');
requireText(activityHub, 'Interaction.SubmitWorldTaskAction(id, "accept"',
  'the Unity activity hub no longer accepts activities');
requireText(activityHub, 'Map.RequestTravelToWorldSite',
  'the Unity activity hub no longer starts a server route');
requireText(globalMap, 'public bool RequestTravelToWorldSite',
  'the global map no longer exposes activity-site routing');
requireText(server, 'const remoteActivity = player.onGlobalMap',
  'the server no longer allows map acceptance for short activities');
requireText(interaction, 'public JObject TrackedWorldTask',
  'Unity interaction facade no longer exposes the tracked activity target');
requireText(globalMap, 'BuildTrackedWorldTaskMarker();',
  'the live map no longer highlights the tracked activity target');
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(metadata)) {
  fail('Unity metadata for RoaWorldActivityCanvas is invalid');
}
if (!activityHubMetadata.includes('fileFormatVersion: 2')
    || !/guid: [0-9a-f]{32}/.test(activityHubMetadata)) {
  fail('Unity metadata for RoaActivityHubCanvas is invalid');
}

requireText(simulation, 'function failWorldActivityTask',
  'a timed-out local activity no longer closes its simulation task');
requireText(server, 'function ensureServerWorldActivityResourceCapacity',
  'resource expeditions no longer guarantee enough live nodes for the maximum goal');
requireText(server, 'const activityFieldKit = activeActivity?.kind === \'resource_expedition\'',
  'resource expeditions can again be blocked by missing personal tools');
requireText(server, 'function settleServerWorldActivityPlayers',
  'completed activities no longer settle rewards and clear accepted tasks');
requireText(server, 'lastWorldActivityResult: sanitizeServerWorldActivityResult',
  'the authoritative player snapshot no longer exposes a clear activity result');
requirePattern(server,
  /syncWorldCaravanArrivalTransfers\(simState\);[\s\S]{0,180}settleServerWorldActivityPlayers\(\);/,
  'caravan arrival no longer ends with the common activity settlement');
requireText(canvas, 'Socket.OnAuthoritativeSelf += HandleAuthoritativeSelf;',
  'Unity no longer listens for authoritative activity results');
requireText(canvas, 'new GameObject("WorldActivityResult"',
  'Unity final activity card is missing');
requireText(canvas, '"АКТИВНОСТЬ НАЧАЛАСЬ. " + StartInstruction(kind)',
  'Unity no longer announces the start and first objective');
requireText(canvas, 'Socket.ApplyGameplayAck(ack);',
  'Unity no longer applies the reward-bearing extraction response');
requireText(canvas, '"ЗАВЕРШИТЬ СПАСЕНИЕ"',
  'distress signal still asks for an exit even though it ends in the cleared area');
if (!process.exitCode) {
  console.log('Unity world activities OK: worldState HUD, server progress and acknowledged extraction');
}
