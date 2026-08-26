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
const feedback = read('unity-client/Assets/Scripts/Game/RoaActivityFeedback.cs');
const feedbackCanvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.Feedback.cs');
const navigation = read('unity-client/Assets/Scripts/Game/RoaWorldActivityNavigation.cs');
const beacon = read('unity-client/Assets/Scripts/Game/RoaActivityBeacon.cs');
const minimap = read('unity-client/Assets/Scripts/Game/RoaMinimap.cs');
const mapWindow = read('unity-client/Assets/Scripts/Game/RoaMapWindowCanvas.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const globalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const metadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs.meta');
const feedbackMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityFeedback.cs.meta');
const feedbackCanvasMetadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.Feedback.cs.meta');
const navigationMetadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityNavigation.cs.meta');
const beaconMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityBeacon.cs.meta');
const navigationProbe = read('unity-client/Assets/Editor/RoaWorldActivityNavigationProbe.cs');
const navigationProbeMetadata = read('unity-client/Assets/Editor/RoaWorldActivityNavigationProbe.cs.meta');
const activityHub = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs');
const activityHubMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs.meta');
const activityHubPresentation = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.Presentation.cs');
const activityHubPresentationMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.Presentation.cs.meta');
const activityHubProbe = read('unity-client/Assets/Editor/RoaActivityHubPresentationProbe.cs');
const activityHubProbeMetadata = read('unity-client/Assets/Editor/RoaActivityHubPresentationProbe.cs.meta');
const feedbackProbe = read('unity-client/Assets/Editor/RoaActivityFeedbackProbe.cs');
const feedbackProbeMetadata = read('unity-client/Assets/Editor/RoaActivityFeedbackProbe.cs.meta');

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
requireText(canvas, 'TryActivityExtractionTarget(out extractionTarget, out extractionReach)',
  'Unity extraction action no longer checks the authored exit distance');
requireText(canvas, '_action.interactable = !_pending && (pointInReach || (extractionOpen && extractionInReach));',
  'Unity allows remote extraction from outside the authored exit');
requireText(canvas, 'bool localCompletion = defense || kind == "distress_signal";',
  'Unity no longer mirrors the server rule for local rescue and defense completion');
requireText(canvas, 'CreateActivityWorldBeacon("ExtractionBeacon"',
  'Unity no longer creates a readable extraction beacon');
requireText(navigation, 'CalculateNavigationArrowAngle',
  'Unity activity navigation lost camera-relative direction');
requireText(navigation, 'NavigationDistanceLabel',
  'Unity activity navigation lost distance feedback');
requireText(navigation, 'CollectMinimapMarkers(List<RoaMinimap.Marker> markers)',
  'Unity activity goals are no longer exported to the minimap');
requireText(beacon, 'public sealed class RoaActivityBeacon',
  'Unity activity beacon component is missing');
requireText(beacon, 'RemoveCollider',
  'Unity activity beacons may interfere with gameplay collision');
requireText(navigationProbe, '[НАВИГАЦИЯ АКТИВНОСТИ] готово',
  'Unity editor probe for activity navigation is missing');
requireText(minimap, 'Objective,',
  'Unity minimap lost objective marker kind');
requireText(minimap, 'Extraction',
  'Unity minimap lost extraction marker kind');
requireText(minimap, 'WorldActivity?.CollectMinimapMarkers(_markers);',
  'Unity minimap is not collecting live activity goals');
requireText(mapWindow, 'RoaMinimap.MarkerKind.Extraction',
  'Unity full map does not style the extraction marker');
requireText(interaction, 'TryNearestActivityResource',
  'Unity resource expeditions no longer point to the nearest resource');
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
requireText(bootstrap, 'Minimap.WorldActivity = WorldActivityCanvas;',
  'Unity bootstrap does not connect activity navigation to the minimap');
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
requireText(activityHub, 'BuildVisibleCardSignature(tasks)',
  'the activity hub rebuilds cards without comparing visible state');
requirePattern(activityHub,
  /if \(!string\.Equals\(signature, _cardSignature[\s\S]{0,120}RefreshCards\(tasks, signature\)/,
  'unchanged activity snapshots can still destroy and recreate every card');
requireText(activityHub, 'SetExpanded(false);',
  'starting an activity route no longer reveals the global map');
requireText(activityHub, 'RoaActivityHubPresentation.DeadlineLabel(task, worldHour)',
  'activity cards no longer communicate event urgency');
requireText(activityHubPresentation, 'public static string BuildSignature',
  'the visible activity-card signature is missing');
requireText(activityHubPresentation, 'Map.TravelProgress',
  'the compact route launcher lost its progress fill');
requireText(activityHubPresentation, 'LauncherText(',
  'the compact launcher no longer names travel time or available signals');
requireText(activityHubPresentation, 'SampleCardRefresh(',
  'changed activity cards pop in without a restrained refresh transition');
requireText(activityHub, 'card.SetActive(false);',
  'a real activity change can leave stale cards visible for one frame');
requireText(activityHub, 'MarkActivityCardsRebuilt();',
  'a real activity change no longer starts the restrained card transition');
requireText(activityHubProbe, '[ЦЕНТР АКТИВНОСТЕЙ] готово:',
  'Unity editor probe for stable activity cards is missing');
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(metadata)) {
  fail('Unity metadata for RoaWorldActivityCanvas is invalid');
}
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(navigationMetadata)) {
  fail('Unity metadata for RoaWorldActivityNavigation is invalid');
}
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(beaconMetadata)) {
  fail('Unity metadata for RoaActivityBeacon is invalid');
}
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(navigationProbeMetadata)) {
  fail('Unity metadata for RoaWorldActivityNavigationProbe is invalid');
}
if (!activityHubMetadata.includes('fileFormatVersion: 2')
    || !/guid: [0-9a-f]{32}/.test(activityHubMetadata)) {
  fail('Unity metadata for RoaActivityHubCanvas is invalid');
}
for (const [contents, label] of [
  [activityHubPresentationMetadata, 'RoaActivityHubCanvas.Presentation'],
  [activityHubProbeMetadata, 'RoaActivityHubPresentationProbe']
]) {
  if (!contents.includes('fileFormatVersion: 2')
      || !/^guid: [0-9a-f]{32}$/m.test(contents)) {
    fail('Unity metadata for ' + label + ' is invalid');
  }
}

requireText(simulation, 'function failWorldActivityTask',
  'a timed-out local activity no longer closes its simulation task');
requireText(server, 'function ensureServerWorldActivityResourceCapacity',
  'resource expeditions no longer guarantee enough live nodes for the maximum goal');
requireText(server, 'const activityFieldKit = activeActivity?.kind === \'resource_expedition\'',
  'resource expeditions can again be blocked by missing personal tools');
requireText(server, 'function settleServerWorldActivityPlayers',
  'completed activities no longer settle rewards and clear accepted tasks');
requirePattern(server,
  /completeWorldActivityTask\(taskId[\s\S]{0,900}performServerWorldTaskAction\(player, \{[\s\S]{0,120}action: 'claim'[\s\S]{0,120}taskId/,
  'the extracting player is no longer paid inside the acknowledged extraction action');
requirePattern(server,
  /players\.set\(socket\.id, p\);[\s\S]{0,120}settleServerWorldActivityPlayers\(p\.worldTaskAccepted\);/,
  'pending activity rewards are no longer recovered when the character joins');
requireText(server, 'lastWorldActivityResult: sanitizeServerWorldActivityResult(savedState.lastWorldActivityResult)',
  'a pending or paid activity result is no longer restored from the character save');
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
requireText(feedback, 'ClassifyActivity(JObject previous, JObject next)',
  'activity feedback is no longer derived from authoritative snapshot transitions');
requirePattern(feedback,
  /!previousExtraction && nextExtraction[\s\S]{0,120}ExtractionOpened/,
  'opening extraction no longer has a distinct high-priority cue');
requireText(feedback, 'ObjectiveProgress(next) > ObjectiveProgress(previous)',
  'objective progress no longer has restrained transition feedback');
requireText(canvas, '_pendingActivityCue = RoaActivityFeedbackCue.None;',
  'leaving an activity can replay a stale deferred cue');
requireText(canvas, '_introPending && _introActivityId ==',
  'activity intro timing is no longer deferred until local gameplay is visible');
requireText(canvas, '!RoaGameBootstrap.BlocksWorldHud',
  'activity result can appear behind a blocking modal');
requireText(feedbackCanvas, 'ApplyCardAnimation(_introGroup',
  'activity intro card lost its fade, slide and scale transition');
requireText(feedbackCanvas, 'audio?.PlayActivityCue(cue);',
  'activity state transitions no longer reach the audio feedback layer');
requireText(feedbackCanvas, 'cue == RoaActivityFeedbackCue.Started ? 2',
  'deferred progress can overwrite the activity start cue');
requireText(feedbackProbe, '[ОБРАТНАЯ СВЯЗЬ АКТИВНОСТИ] готово:',
  'Unity editor probe for activity transition feedback is missing');
requireText(feedbackProbe, 'audio.GeneratedClipCount == 31',
  'Unity editor probe no longer validates the generated activity sounds');
for (const [contents, label] of [
  [feedbackMetadata, 'RoaActivityFeedback'],
  [feedbackCanvasMetadata, 'RoaWorldActivityCanvas.Feedback'],
  [feedbackProbeMetadata, 'RoaActivityFeedbackProbe']
]) {
  if (!contents.includes('fileFormatVersion: 2')
      || !/^guid: [0-9a-f]{32}$/m.test(contents)) {
    fail('Unity metadata for ' + label + ' is invalid');
  }
}
if (!process.exitCode) {
  console.log('Unity world activities OK: authoritative progress, deferred transition feedback, exit gating and acknowledged rewards');
}
