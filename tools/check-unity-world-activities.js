#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
// Рабочая копия на Windows может быть выдана git с CRLF (text=auto);
// многострочные литералы проверки написаны с \n, поэтому нормализуем.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
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
const forbidText = (source, fragment, label) => {
  if (source.includes(fragment)) fail(label);
};
const codeBlock = (source, signature, label) => {
  const signatureAt = source.indexOf(signature);
  if (signatureAt < 0) {
    fail(label);
    return '';
  }
  const bodyAt = source.indexOf('{', signatureAt + signature.length);
  if (bodyAt < 0) {
    fail(`${label}: body is missing`);
    return '';
  }
  let depth = 0;
  for (let index = bodyAt; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyAt + 1, index);
    }
  }
  fail(`${label}: body is not closed`);
  return source.slice(bodyAt + 1);
};

const server = read('server.js');
const simulation = read('src/server/wasteland-sim.js');
const runtime = read('src/server/world-activity-runtime.js');
const matchmaking = read('src/server/world-activity-matchmaking.js');
const canvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs');
const feedback = read('unity-client/Assets/Scripts/Game/RoaActivityFeedback.cs');
const feedbackCanvas = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.Feedback.cs');
const navigation = read('unity-client/Assets/Scripts/Game/RoaWorldActivityNavigation.cs');
const beacon = read('unity-client/Assets/Scripts/Game/RoaActivityBeacon.cs');
const minimap = read('unity-client/Assets/Scripts/Game/RoaMinimap.cs');
const mapWindow = read('unity-client/Assets/Scripts/Game/RoaMapWindowCanvas.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const hudCanvas = read('unity-client/Assets/Scripts/Game/RoaHudCanvas.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');
const pipboyCanvas = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
const dialogueCanvas = read('unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs');
const globalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const globalMapCanvas = read('unity-client/Assets/Scripts/Game/RoaGlobalMapCanvas.cs');
const metadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.cs.meta');
const feedbackMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityFeedback.cs.meta');
const feedbackCanvasMetadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityCanvas.Feedback.cs.meta');
const navigationMetadata = read('unity-client/Assets/Scripts/Game/RoaWorldActivityNavigation.cs.meta');
const beaconMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityBeacon.cs.meta');
const navigationProbe = read('unity-client/Assets/Editor/RoaWorldActivityNavigationProbe.cs');
const auditRunner = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const navigationProbeMetadata = read('unity-client/Assets/Editor/RoaWorldActivityNavigationProbe.cs.meta');
const questSurfacesProbe = read('unity-client/Assets/Editor/RoaPipboyQuestSurfacesProbe.cs');
const questSurfacesProbeMetadata = read('unity-client/Assets/Editor/RoaPipboyQuestSurfacesProbe.cs.meta');
const activityHub = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs');
const activityHubMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.cs.meta');
const activityHubPresentation = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.Presentation.cs');
const activityHubPresentationMetadata = read('unity-client/Assets/Scripts/Game/RoaActivityHubCanvas.Presentation.cs.meta');
const activityHubProbe = read('unity-client/Assets/Editor/RoaActivityHubPresentationProbe.cs');
const activityHubProbeMetadata = read('unity-client/Assets/Editor/RoaActivityHubPresentationProbe.cs.meta');
const feedbackProbe = read('unity-client/Assets/Editor/RoaActivityFeedbackProbe.cs');
const feedbackProbeMetadata = read('unity-client/Assets/Editor/RoaActivityFeedbackProbe.cs.meta');
const hudReadabilityProbe = read('unity-client/Assets/Editor/RoaHudReadabilityProbe.cs');
const pipboyWorldTasks = read('public/js/game/03a_pipboy_social_world_tasks.js');

requireText(runtime, "const WORLD_ACTIVITY_SCHEMA = 'realm.worldActivity.v1';",
  'the versioned server activity schema is missing');
requireText(matchmaking, 'function selectQuickWorldActivityTask',
  'server-authoritative quick activity selection is missing');
requirePattern(server,
  /if \(action === 'accept'\)[\s\S]{0,260}task\.type \|\| ''\) === 'patrol_mission'[\s\S]{0,260}Присоединяйтесь через отдельную заявку патруля/,
  'the authoritative server again allows players to accept an NPC-only patrol mission');
requireText(matchmaking, 'helpSignalForTask(task, options.now)',
  'quick join no longer prioritizes live requests for help');
requireText(runtime, 'function requestWorldActivityHelp',
  'players can no longer open a live request for help');
requireText(runtime, 'function recordWorldActivityHelpResponse',
  'responders are no longer credited into the temporary squad');
requireText(runtime, 'temporary: true',
  'activity snapshots no longer expose their temporary squad');
requireText(runtime, 'function requestWorldActivityRally',
  'temporary squad members can no longer opt into one shared next activity');
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
requirePattern(simulation,
  /worldActivities: activityTasks\.slice\(0, PUBLIC_LIVE_ACTIVITY_LIMIT\)\.map\(public(?:World)?Task\)/,
  'the public simulation no longer exposes a dedicated activity feed');
requireText(simulation, 'liveRegion,',
  'world sites no longer expose the readable live-region state');
requireText(simulation, 'worldPulse:',
  'the public simulation no longer exposes temporary world consequences');
requirePattern(simulation, /worldTasks: visibleTasks\.map\(public(?:World)?Task\)/,
  'live activities are no longer prioritized over legacy jobs');
requireText(simulation, "journalCategory: 'contract'",
  'public procedural tasks are no longer separated from the story journal');
requireText(simulation, 'procedural: true',
  'public world tasks are no longer marked as procedural contracts');
requireText(simulation, 'contractKey: worldContractSemanticKey(',
  'public world tasks no longer publish the shared semantic contract key');
requireText(simulation, 'dedupeActiveWorldContracts(orderedTaskCandidates',
  'the public contract feed no longer removes semantic duplicates');
requirePattern(server,
  /function publicWorldState\([\s\S]{0,900}activity: publicWorldActivity\(room\.worldActivity\)/,
  'activity is no longer part of the authoritative room snapshot');
requirePattern(server,
  /function transferPlayerToServerRoom\([\s\S]{0,2600}ensureServerWorldActivityForRoom\(room, Date\.now\(\)\)[\s\S]{0,160}refreshRoomWorldState\(room, \{ force: true \}\)/,
  'entering an activity room no longer creates and broadcasts its objectives immediately');
requirePattern(server,
  /socket\.on\('requestWorldState'[\s\S]{0,700}ensureServerWorldActivityForRoom\(room, Date\.now\(\)\)[\s\S]{0,160}refreshRoomWorldState\(room, \{ force: true \}\)/,
  'Unity activity resync no longer repairs a missing room activity');
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
  /serverFinishEnemyKilledByPlayer\([\s\S]{0,1800}recordServerWorldActivityEnemyKill/,
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
requireText(canvas, 'bool showAction = running && (pointInReach || (extractionOpen && extractionInReach));',
  'Unity exposes the extraction action outside the authored exit');
requireText(canvas, 'bool localCompletion = defense || kind == "distress_signal";',
  'Unity no longer mirrors the server rule for local rescue and defense completion');
requireText(canvas, 'CreateActivityWorldBeacon("ExtractionBeacon"',
  'Unity no longer creates a readable extraction beacon');
requireText(navigation, 'CalculateNavigationArrowAngle',
  'Unity activity navigation lost camera-relative direction');
requireText(navigation, 'NavigationDistanceLabel',
  'Unity activity navigation lost distance feedback');
requireText(navigation, 'private const int MaxWorldLabels = 4;',
  'Unity world-objective labels lost their strict visual budget');
requireText(canvas, 'BuildObjectiveWorldLabelLayer((RectTransform)canvasGo.transform);',
  'Unity activity Canvas no longer builds the projected world-label layer');
requireText(navigation, 'private void LateUpdate()',
  'world objective labels no longer follow the final camera pose');
requireText(navigation, 'CollectWorldLabelFrames(_worldLabelFrames)',
  'world objective labels no longer consume authoritative activity points');
requireText(navigation, 'TryResolveWorldLabelRect(anchor, safe, _occupiedWorldLabels',
  'world objective labels can overlap the activity HUD or each other');
requireText(navigation, 'Bootstrap.HudCanvas?.CollectOccupiedScreenRects(_occupiedWorldLabels);',
  'world objective labels no longer avoid the adaptive gameplay HUD');
requirePattern(hudCanvas,
  /CollectOccupiedScreenRects[\s\S]{0,900}_playerPanel[\s\S]{0,900}_interactionPrompt/,
  'adaptive HUD occupancy no longer covers all visible gameplay panels');
requireText(hudCanvas, 'rect.GetWorldCorners(_occupiedScreenCorners);',
  'adaptive HUD occupancy no longer follows actual draggable panel bounds');
requireText(hudCanvas, 'panel == null || !panel.activeInHierarchy',
  'hidden HUD panels still reserve world-label space');
requireText(navigation, 'WorldLabelText(frame.Label, frame.Distance, frame.Completed)',
  'world objective labels lost distance, reach or completion states');
requireText(navigation, 'background.raycastTarget = false;',
  'world objective labels intercept gameplay input');
requireText(canvas, 'pointStatus == "disabled" || pointStatus == "locked"',
  'locked future branch points still create world beacons');
requirePattern(navigation,
  /status == "completed" \|\| status == "disabled"[\s\S]{0,80}status == "locked"/,
  'locked future branch points still clutter the activity minimap');
requireText(navigation, 'CollectMinimapMarkers(List<RoaMinimap.Marker> markers)',
  'Unity activity goals are no longer exported to the minimap');
requireText(beacon, 'public sealed class RoaActivityBeacon',
  'Unity activity beacon component is missing');
requireText(beacon, 'RemoveCollider',
  'Unity activity beacons may interfere with gameplay collision');
requireText(navigationProbe, '[НАВИГАЦИЯ АКТИВНОСТИ] готово',
  'Unity editor probe for activity navigation is missing');
requireText(auditRunner, 'typeof(RoaWorldActivityNavigationProbe)',
  'activity navigation probe is not part of the mandatory Unity client audit');
requireText(navigationProbe, 'canvas.WorldLabelPoolSize == 4',
  'Unity editor probe no longer validates the bounded world-label pool');
requireText(navigationProbe, '&& !firstLabel.Overlaps(hud)',
  'Unity editor probe no longer validates world-label collision avoidance');
requireText(navigationProbe, '!image.raycastTarget',
  'Unity editor probe no longer validates input-transparent world labels');
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
requireText(canvas, 'public static void BuildObjectiveViews(JObject activity, List<ObjectiveView> output)',
  'Unity HUD no longer derives a deterministic multi-stage objective plan');
requireText(canvas, 'new GameObject("ObjectiveRows"',
  'Unity HUD lost its bounded Canvas objective-row pool');
requireText(canvas, 'public static bool UseFocusedActivityHud(bool combatActive, bool mobile)',
  'activity HUD no longer switches to a focused combat/mobile presentation');
requireText(canvas, 'public enum ActivityHudDensity',
  'activity HUD lost its glance/context/detail presentation states');
requireText(canvas, 'return new Vector2(330f, 100f);',
  'default activity glance card no longer releases a meaningful part of the world view');
requireText(canvas, 'public enum ActivityFlowStage',
  'activity HUD no longer exposes its start-to-reward flow states');
requireText(canvas, 'BuildFlowStrip(root, "ActivityFlow"',
  'activity HUD no longer shows the four-step start, objective, extraction and reward strip');
requireText(canvas, 'BuildFlowStrip(resultRect, "ResultFlow"',
  'authoritative reward receipt is no longer connected to the activity flow');
requireText(canvas, 'ResolveActivityFlowStage(_activity)',
  'activity HUD no longer derives its visible flow stage from server state');
requireText(canvas, 'if (status == "completed") return ActivityFlowStage.Reward;',
  'completed extraction no longer advances the activity HUD to the pending reward stage');
requireText(canvas, 'Проверяем выплату сервера…',
  'activity HUD claims a reward before the authoritative server receipt arrives');
requireText(hudReadabilityProbe, '[HUD & ACTIVITY FLOW 4.5]',
  'Unity HUD audit no longer validates the end-to-end activity flow');
requireText(canvas, 'ResolveActivityHudDensity(combatActive, mobileHud,',
  'activity HUD density is not resolved from live combat, input and action context');
requireText(canvas, 'RefreshObjectiveRows(density != ActivityHudDensity.Detailed);',
  'compact activity HUD does not enforce a single current objective row');
requireText(canvas, 'new GameObject("Btn:ActivityDetails"',
  'activity HUD has no explicit details control');
requireText(canvas, 'FocusedObjectiveIndex(_objectiveViews)',
  'focused activity HUD no longer keeps the current objective visible');
requirePattern(navigation,
  /ActivityHudScreenRect\(\s*Screen\.width, scale, mobileHud, _hudDensity,[\s\S]{0,100}IdentityVisible/,
  'world labels do not reserve the real activity HUD density footprint');
requireText(feedbackProbe, 'glance activity HUD is not reduced to one readable objective row',
  'Unity activity feedback probe no longer validates glance HUD geometry');
requireText(canvas, 'branchLocked ? "ПОСЛЕ ВЫБОРА" : "СЛЕДУЮЩИЙ ЭТАП"',
  'ordered and mutually exclusive activity stages are no longer distinguished');
requireText(canvas, 'ExtractionObjectiveLabel(kind), "ДОСТУПНО"',
  'opening extraction no longer adds a clear final objective');
requireText(canvas, '"ОСНОВА ГОТОВА · " + current + "/" + bonus',
  'required, bonus and maximum milestones are no longer readable');
requireText(feedbackCanvas, 'foreach (ObjectiveSlot slot in _objectiveSlots)',
  'authoritative progress feedback no longer pulses the active Canvas objective row');
requirePattern(feedbackCanvas,
  /GetComponent<CanvasGroup>\(\);[\s\S]{0,100}if \(_introGroup == null\)[\s\S]{0,180}if \(_resultGroup == null\)/,
  'activity feedback CanvasGroups are not recreated safely under Unity fake-null semantics');
requireText(canvas, 'Bootstrap.FrontendVisible || Bootstrap.OnGlobalMap',
  'activity HUD is not hidden outside a local gameplay location');
requireText(bootstrap, 'WorldActivityCanvas.Configure(Socket, this);',
  'Unity bootstrap no longer configures the activity HUD');
requireText(bootstrap, 'Minimap.WorldActivity = WorldActivityCanvas;',
  'Unity bootstrap does not connect activity navigation to the minimap');
requireText(bootstrap, 'gameObject.AddComponent<RoaActivityHubCanvas>()',
  'Unity bootstrap no longer installs the global activity hub');

const pipboyPages = codeBlock(pipboyCanvas, 'public enum Page',
  'the Unity PIP-ASH page enum is missing');
requirePattern(pipboyPages, /\bQuests\b/,
  'the Unity PIP-ASH lost its story journal page');
requirePattern(pipboyPages, /\bContracts\b/,
  'the Unity PIP-ASH has no separate procedural contracts page');
requirePattern(pipboyCanvas, /\(Page\.Quests,\s*"[^"]*журнал[^"]*"\)/iu,
  'the authored quest page is not named as the story journal');
requirePattern(pipboyCanvas, /\(Page\.Contracts,\s*"[^"]*контракт[^"]*"\)/iu,
  'the procedural task page is not named as contracts');
requireText(pipboyCanvas, 'BuildContractsPage(pageArea);',
  'the Unity PIP-ASH does not build a separate contracts page');
requirePattern(pipboyCanvas, /case Page\.Contracts:\s*RefreshContracts\([^;]*\);\s*break;/,
  'the Unity PIP-ASH does not refresh its contracts page independently');
requirePattern(interaction,
  /public\s+(?:IReadOnly)?List<[^>]+>\s+JournalQuests\s*\(/,
  'the Unity interaction facade does not expose authored journal quests');
const refreshQuests = codeBlock(pipboyCanvas, 'private void RefreshQuests(',
  'the Unity story-journal refresh method is missing');
requireText(refreshQuests, 'Interaction.JournalQuests(',
  'the Unity story journal does not consume authored JournalQuests');
forbidText(refreshQuests, 'PipboyWorldTasks(',
  'procedural world tasks leaked back into the Unity story journal');
const refreshContracts = codeBlock(pipboyCanvas, 'private void RefreshContracts(',
  'the Unity contracts refresh method is missing');
requireText(refreshContracts, 'Interaction.PipboyWorldTasks(',
  'the Unity contracts page no longer consumes procedural world tasks');
requireText(auditRunner, 'typeof(RoaPipboyQuestSurfacesProbe)',
  'the journal/contracts regression probe is not part of the mandatory Unity client audit');
requireText(questSurfacesProbe, 'interaction.JournalQuests(false)',
  'the Unity regression probe no longer verifies the active authored journal');
requireText(questSurfacesProbe, 'interaction.JournalQuests(true)',
  'the Unity regression probe no longer verifies completed authored quests');
requireText(questSurfacesProbe, 'interaction.PipboyWorldTasks(true)',
  'the Unity regression probe no longer verifies merged active contracts');
requireText(questSurfacesProbe, 'accepted-off-feed',
  'the Unity regression probe no longer protects accepted contracts hidden from the public feed');
requireText(questSurfacesProbe, 'Page:Contracts',
  'the Unity regression probe no longer checks the separate contracts surface');

requirePattern(dialogueCanvas,
  /AddHeading\("[^"\r\n]*контракт[^"\r\n]*"\)/iu,
  'the local physical board is still presented as jobs instead of contracts');
requirePattern(globalMapCanvas,
  /KickerLabel\(side,\s*"[^"\r\n]*контракт[^"\r\n]*"/iu,
  'the global-map board is still presented as local jobs instead of contracts');
requirePattern(activityHub,
  /launcherLabel\.text\s*=\s*"[^"\r\n]*контракт[^"\r\n]*"/iu,
  'the priority activity board is not named as a contract board');
requirePattern(interaction,
  /TargetKind\.JobBoard\)\s+return\s+"[^"\r\n]*контракт[^"\r\n]*"/iu,
  'the world interaction prompt still names the physical contract board as a job board');
const fallbackBoard = codeBlock(interaction, 'private void DrawJobBoard(',
  'the fallback Unity contract board is missing');
requirePattern(fallbackBoard, /контракт/iu,
  'the fallback Unity board is still named as jobs instead of contracts');

const rewardReceipt = codeBlock(canvas, 'public static string RewardReceipt(',
  'the authoritative activity reward receipt is missing');
if (/журнал/iu.test(rewardReceipt)) {
  fail('the activity reward receipt still sends procedural rewards to the story journal');
}

requireText(activityHub, 'Map?.WastelandState?["worldActivities"]',
  'the Unity activity hub no longer reads the dedicated feed');
requirePattern(activityHub,
  /private static readonly string\[\] Kinds[\s\S]{0,180}"patrol_mission"[\s\S]{0,80}"join_patrol"/,
  'the Unity activity hub no longer includes patrol status and join cards');
requireText(activityHub, 'case "patrol_mission": return "Задача патруля";',
  'the Unity activity hub lost the patrol-operation label');
requireText(activityHub, 'case "join_patrol": return "Патруль";',
  'the Unity activity hub lost the patrol-participation label');
requirePattern(activityHub,
  /private static JObject WorldTaskOperation\(JObject task\)[\s\S]{0,220}task\?\["operation"\] as JObject \?\? details\?\["operation"\] as JObject/,
  'the Unity activity hub no longer reads patrol operations from either public task path');
requirePattern(activityHub,
  /private static bool IsPatrolMission\(JObject task\)[\s\S]{0,220}\["kind"\][\s\S]{0,100}"patrol_mission"/,
  'the Unity activity hub no longer recognizes mirrored patrol operations');
requirePattern(activityHub,
  /private static string PatrolOperationContext\(JObject task\)[\s\S]{0,360}\["summary"\][\s\S]{0,260}CompactText/,
  'patrol cards no longer show their operation goal');
requirePattern(activityHub,
  /private static string PatrolOperationLeader\(JObject task\)[\s\S]{0,320}\["leaderName"\][\s\S]{0,220}"Командир патруля"/,
  'patrol cards no longer show their generic NPC commander');
requirePattern(activityHub,
  /private static string WorldTaskTargetSiteId\(JObject task\)[\s\S]{0,500}\["impactSiteId"\][\s\S]{0,220}\["targetSiteId"\][\s\S]{0,220}\["destinationSiteId"\]/,
  'patrol cards no longer route to the authoritative operation target');
requirePattern(activityHub,
  /private static string PatrolOperationTargetName\(JObject task, string fallback\)[\s\S]{0,500}"intercept_hostile"[\s\S]{0,260}\["targetPartyName"\]/,
  'patrol interception cards no longer name their moving hostile target');
requireText(activityHub, 'if (!patrolRouteAvailable) caption = "ДВИЖУЩАЯСЯ ЦЕЛЬ";',
  'moving patrol targets again pretend to support settlement routing');
requirePattern(activityHub,
  /if \(kind == "patrol_mission"\)[\s\S]{0,100}TravelTo\(task\);[\s\S]{0,80}return;/,
  'the patrol-status card no longer routes without pretending to join the NPC party');
requirePattern(activityHub,
  /\(kind == "escort_caravan" \|\| kind == "join_patrol"\)[\s\S]{0,160}!Map\.PlayerAtWorldSite\(issuerId\)[\s\S]{0,320}RequestTravelToWorldSite\(issuerId\)/,
  'the patrol join card no longer routes players to its authoritative muster board');
requireText(activityHub, '? "Маршрут к месту сбора каравана начат."\n                        : "Маршрут к месту сбора патруля начат."',
  'the patrol join card no longer explains its muster route');
requireText(activityHub, 'task["actionMode"]?.ToString() == "join_party"',
  'the patrol join card ignores server-authoritative slot availability');
requireText(activityHub, 'caption = "НЕТ МЕСТ";',
  'the patrol join card no longer exposes a full patrol clearly');
requireText(activityHub, 'caption = "НУЖНА ФРАКЦИЯ";',
  'the patrol join card ignores the player faction requirement');
requireText(activityHub, 'card.GetComponent<LayoutElement>().preferredHeight = 140f;',
  'the patrol operation context no longer has enough vertical space in Unity cards');
requireText(activityHub, 'kind == "join_patrol" ? "Присоединяемся к патрулю…"',
  'the patrol join card no longer communicates its distinct participation action');
requireText(activityHub, '"ВЕДЁТ: " + PatrolOperationLeader(task) + " · СТАТУС ОТРЯДА"',
  'the NPC patrol status card again advertises a player reward');
requireText(activityHub, 'LiveStageAndCause(task)',
  'activity cards no longer explain the event stage and cause');
requirePattern(activityHub,
  /string target = kind == "escort_caravan"[\s\S]{0,180}task\["impactSiteName"\]/,
  'the faction caravan card no longer targets the operation impact destination');
requirePattern(activityHub,
  /details\.text = target[\s\S]{0,220}LiveStageAndCause\(task\)/,
  'the faction caravan card no longer joins its destination with the live operation stage and cause');
requirePattern(activityHub,
  /private static string LiveStageAndCause\(JObject task\)[\s\S]{0,900}liveEvent\?\["stageLabel"\][\s\S]{0,180}liveEvent\?\["causeLabel"\][\s\S]{0,650}return stage \+ " · причина: " \+ cause;/,
  'the activity hub no longer renders the server-authored caravan phase and reason');
requirePattern(activityHub,
  /if \(IsPatrolMission\(task\)\)[\s\S]{0,300}PatrolPhaseLabel\(operation\?\["phase"\][\s\S]{0,260}operation\?\["goal"\]\?\["summary"\]/,
  'the activity hub no longer falls back to the authoritative patrol stage and reason');
requireText(activityHub, 'case "patrolling": return "Патрулирование маршрута";',
  'the activity hub lost the active patrol phase');
requireText(activityHub, 'case "holding": return "Удержание позиции";',
  'the activity hub lost the patrol hold phase');
for (const fragment of [
  'function worldTaskPatrolOperationText(task = {})',
  "String(task.actionMode || '') === 'status_only'",
  "String(operation?.kind || '').toLowerCase() !== 'patrol_mission'",
  'Поручение выполняет патруль НПС'
]) forbidText(pipboyWorldTasks, fragment,
  'Unity-only patrol operations leaked back into the legacy browser task board');
requirePattern(interaction,
  /bool statusOnly = type == "patrol_mission"[\s\S]{0,180}"status_only"/,
  'the Unity PIP-ASH page no longer recognizes NPC-only patrol operations');
requirePattern(interaction,
  /if \(statusOnly\)[\s\S]{0,240}card\.CanAccept = false;[\s\S]{0,120}card\.AcceptLabel = null;/,
  'the Unity PIP-ASH page again offers the NPC patrol operation for acceptance');
requirePattern(interaction,
  /public sealed class JobBoardTask[\s\S]{0,500}public bool StatusOnly;/,
  'the Unity job-board model lost the NPC-only patrol status contract');
requirePattern(dialogueCanvas,
  /task\.Status == "active" && !task\.Accepted && !task\.StatusOnly/,
  'the Unity dialogue job board again offers the NPC patrol operation for acceptance');
requireText(interaction, 'if (task?.Row == null || (task.StatusOnly && action == "accept")) return;',
  'the Unity job-board action facade no longer guards NPC-only patrol acceptance');
requireText(interaction, 'status == "active" && !accepted && !statusOnly && GUILayout.Button("Взять")',
  'the Unity fallback job board again offers the NPC patrol operation for acceptance');
requireText(activityHub, 'LiveRegionMetrics(task)',
  'activity cards no longer show supply, security and influence');
requireText(activityHub, 'CommunityText(task)',
  'activity cards no longer show shared player contribution');
requireText(activityHub, 'Interaction.SubmitWorldTaskAction(id, "accept"',
  'the Unity activity hub no longer accepts activities');
requireText(activityHub, 'Interaction.SubmitQuickWorldActivity',
  'the Unity activity hub lost one-click quick sortie matchmaking');
requireText(interaction, 'Socket.EmitWithAck("worldActivityQuickJoin"',
  'Unity quick sortie selection is no longer acknowledged by the server');
requireText(activityHub, 'ПРИЙТИ НА ПОМОЩЬ',
  'live help requests are no longer visible in the global activity hub');
requireText(activityHub, 'Map.RequestTravelToWorldSite',
  'the Unity activity hub no longer starts a server route');
requireText(globalMap, 'public bool RequestTravelToWorldSite',
  'the global map no longer exposes activity-site routing');
requireText(globalMap, 'public static bool RouteClickAllowed',
  'the live global map no longer allows a click to replace the active route');
requireText(globalMap, 'bool rerouting = _travelActive;',
  'route replacement no longer uses the authoritative travel-start path');
requireText(globalMapCanvas, 'Вступить',
  'the only explicit map-entry decision must belong to a route contact');
requireText(globalMapCanvas, 'Покинуть отряд',
  'removing the stop button must not trap an attached player in a world party');
requireText(server, 'const remoteActivity = player.onGlobalMap',
  'the server no longer allows map acceptance for short activities');
requireText(interaction, 'public JObject TrackedWorldTask',
  'Unity interaction facade no longer exposes the tracked activity target');
requireText(globalMap, 'BuildTrackedWorldTaskMarker();',
  'the live map no longer highlights the tracked activity target');
requireText(globalMap, 'public string WorldChangeSummary',
  'completed activities no longer expose a compact visible consequence summary');
requireText(globalMapCanvas, 'RefreshWorldChangeToast()',
  'successful activity consequences are no longer announced without opening a tooltip');
requireText(globalMapCanvas, '_worldChangeToastUntil = Time.unscaledTime + 5.5f;',
  'world-change feedback no longer has a bounded non-blocking lifetime');
requireText(globalMap, '_activityOverlayLabels.Add(new ActivityOverlayState',
  'priority activities no longer receive readable labels on the live map');
for (const [kind, label] of [
  ['escort_caravan', 'Караван'],
  ['distress_signal', 'Сигнал бедствия'],
  ['recon_expedition', 'Разведка'],
  ['resource_expedition', 'Вылазка за ресурсами'],
  ['outpost_defense', 'Защита аванпоста'],
  ['assault_diversion', 'Штурм / диверсия']
]) requireText(globalMap, `case "${kind}": return "${label}";`,
  `the live map lost the canonical ${kind} label`);
requireText(globalMap, 'public int CollectOverlayLabels(List<OverlayLabel> output)',
  'the live map no longer combines activity and settlement overlays');
requireText(globalMapCanvas, 'Map.CollectOverlayLabels(_mapLabelFrames)',
  'the global-map Canvas no longer consumes live activity labels');
requireText(globalMapCanvas, 'TryResolveOverlayLabelRect(point, sidebar, _occupiedMapLabels',
  'live activity labels can overlap the route sidebar or each other');
requireText(globalMapCanvas, 'background.raycastTarget = false;',
  'live activity labels intercept route-selection input');
requireText(globalMap, 'public static bool ThreatZoneShouldDisplay',
  'the global map no longer separates real threats from peaceful route influence');
requireText(globalMap, 'if (!ThreatZoneShouldDisplay(row["kind"]?.ToString()',
  'peaceful caravans and patrols can again create red threat rings');
requireText(globalMap, 'RiskLabel(DangerAtPoint(_selectedPoint, _selectedDynamic))',
  'route risk no longer uses the same filtered semantic danger model as map markers');
requireText(globalMap, 'public static string MarkerSemanticLabel',
  'global-map markers lost their semantic categories');
requireText(globalMapCanvas, 'RefreshHoverCard();',
  'desktop players can no longer inspect a destination before the one-click route starts');
requireText(globalMapCanvas, 'MapLegend',
  'the expanded map details no longer explain marker meanings');
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
requireText(activityHubPresentation,
  'JObject operation = task?["operation"] as JObject ?? details?["operation"] as JObject;',
  'the activity-card refresh signature no longer reads the public caravan operation');
for (const field of [
  'operation?["id"]',
  'operation?["kind"]',
  'operation?["phase"]',
  'operation?["revision"]',
  'operation?["sourceSiteId"]',
  'operation?["destinationSiteId"]',
  'operationGoal?["kind"]',
  'operationGoal?["reason"]',
  'operationGoal?["summary"]',
  'operationGoal?["targetSiteId"]',
  'operationAssignment?["leaderName"]',
  'operationAssignment?["leaderRole"]',
  'details?["targetPartyName"]',
  'details?["waitUntilHour"]',
  'details?["departedHour"]'
]) requireText(activityHubPresentation, `Append(value, ${field}?.ToString());`,
  `the activity-card refresh signature ignores ${field}`);
for (const field of [
  'task?["impactSiteId"]',
  'liveEvent?["stageLabel"]'
]) requireText(activityHubPresentation, `Append(value, ${field}?.ToString());`,
  `the patrol activity-card refresh signature ignores ${field}`);
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
if (!/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(questSurfacesProbeMetadata)) {
  fail('Unity metadata for RoaPipboyQuestSurfacesProbe is invalid');
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
requireText(canvas, 'RewardReceipt(result, self)',
  'Unity final activity card no longer uses the authoritative reward receipt');
requireText(canvas, 'ПОДТВЕРЖДЕНО СЕРВЕРОМ',
  'Unity paid result no longer confirms the resulting wallet and progression state');
requireText(feedbackProbe, 'paid activity result has no authoritative reward receipt',
  'Unity editor probe no longer validates the paid and pending reward receipts');
requireText(canvas, '_introInstruction.text = StartInstruction(kind);',
  'Unity no longer announces the first objective on the transient start card');
requireText(canvas, 'Socket.ApplyGameplayAck(ack);',
  'Unity no longer applies the reward-bearing extraction response');
requireText(canvas, '"ЗАВЕРШИТЬ СПАСЕНИЕ"',
  'distress signal still asks for an exit even though it ends in the cleared area');
requireText(canvas, 'Socket.EmitWithAck("worldActivityHelpSignal"',
  'the local activity HUD can no longer request live help');
requireText(canvas, 'Socket.EmitWithAck("worldActivityPing"',
  'the local activity HUD no longer sends quick temporary-squad pings');
requireText(canvas, 'Socket.EmitWithAck("worldActivityRevive"',
  'the local activity HUD can no longer revive a nearby wounded squad member');
requireText(canvas, 'ВЫ РАНЕНЫ · СОЮЗНИК МОЖЕТ ПОДНЯТЬ ВАС',
  'the activity HUD no longer explains the local downed state');
requireText(canvas, '_participants.text = "ОТРЯД "',
  'the activity HUD no longer identifies shared temporary squad progress');
requireText(canvas, 'new GameObject("Btn:ActivityPingToggle"',
  'temporary-squad pings are no longer collapsed behind one compact control');
requireText(canvas, 'Input.GetKeyDown(KeyCode.Q)',
  'desktop activity pings lost their quick Q shortcut');
requireText(canvas, 'MobilePingHoldSeconds',
  'mobile activity pings lost their hold gesture');
requireText(canvas, 'ResolvePingRadialType',
  'desktop and mobile activity pings no longer share a radial selector');
requireText(runtime, 'danger: 7000',
  'danger pings lost their short combat lifetime');
requireText(runtime, 'move: 10000',
  'move pings lost their rendezvous lifetime');
requireText(runtime, 'loot: 15000',
  'loot pings lost their longer discovery lifetime');
requireText(runtime, 'row.ownerKey !== ownerKey',
  'one player can clutter the activity with multiple simultaneous pings');
requireText(navigation, 'HideActivityNavigation();',
  'the duplicate persistent navigation strip is visible again');
requireText(canvas, 'Socket.EmitWithAck("worldActivityContinue"',
  'the final result card can no longer continue with the temporary squad');
requireText(canvas, 'ПРОДОЛЖИТЬ С ОТРЯДОМ',
  'the final activity card lost its clear squad continuation action');
requireText(server, "socket.on('worldActivityQuickJoin'",
  'the server no longer handles quick activity matchmaking');
requireText(server, "socket.on('worldActivityHelpSignal'",
  'the server no longer handles player help signals');
requireText(server, "socket.on('worldActivityPing'",
  'the server no longer validates squad pings');
requireText(server, "socket.on('worldActivityRevive'",
  'the server no longer validates activity revives');
requireText(server, 'serverTryDownWorldActivityPlayer(target, room, now)',
  'lethal activity damage no longer enters the server-authoritative downed state');
requireText(server, "socket.on('worldActivityContinue'",
  'the server no longer keeps consenting squad members on one next activity');
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
requireText(feedbackProbe, 'audio.GeneratedClipCount == 32',
  'Unity editor probe no longer validates the generated activity sounds');
requireText(feedbackProbe, 'objectiveViews[1].Progress == "ПОСЛЕ ВЫБОРА"',
  'Unity editor probe no longer validates the assault/diversion branch preview');
requireText(feedbackProbe, 'objectiveRows.childCount == 3',
  'Unity editor probe no longer validates the bounded objective Canvas pool');
requireText(canvas, '_rootBackground.raycastTarget = false;',
  'the decorative activity panel intercepts world input');
requireText(canvas, 'threatBackground.raycastTarget = false;',
  'the decorative threat track intercepts world input');
requireText(canvas, '_threatFill.raycastTarget = false;',
  'the decorative threat fill intercepts world input');
requireText(feedbackProbe, 'image.raycastTarget == interactive',
  'Unity editor probe no longer validates activity HUD input transparency');
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
  console.log('Unity world activities OK: authoritative stages, readable world targets, exit gating and acknowledged rewards');
}
