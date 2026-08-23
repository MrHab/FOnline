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
requireText(canvas, 'Bootstrap.FrontendVisible || Bootstrap.OnGlobalMap',
  'activity HUD is not hidden outside a local gameplay location');
requireText(bootstrap, 'WorldActivityCanvas.Configure(Socket, this);',
  'Unity bootstrap no longer configures the activity HUD');
requireText(interaction, 'public JObject TrackedWorldTask',
  'Unity interaction facade no longer exposes the tracked activity target');
requireText(globalMap, 'BuildTrackedWorldTaskMarker();',
  'the live map no longer highlights the tracked activity target');
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(metadata)) {
  fail('Unity metadata for RoaWorldActivityCanvas is invalid');
}

if (!process.exitCode) {
  console.log('Unity world activities OK: worldState HUD, server progress and acknowledged extraction');
}
