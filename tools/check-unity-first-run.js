'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const coach = read(game, 'RoaFirstRunCoach.cs');
const activity = read(game, 'RoaWorldActivityCanvas.cs');
const systemCanvas = read(game, 'RoaSystemCanvas.cs');
const minimap = read(game, 'RoaMinimap.cs');
const loader = read('unity-client', 'Assets', 'Scripts', 'World', 'RoaLocationLoader.cs');
const exitBoundary = read('unity-client', 'Assets', 'Scripts', 'World', 'RoaWorldExitBoundary.cs');
const globalMap = read(game, 'RoaGlobalMap.cs');
const controller = read(game, 'RoaPlayerController.cs');
const onboarding = read(game, 'RoaKromkaOnboarding.cs');
const socket = read('unity-client', 'Assets', 'Scripts', 'Net', 'RoaSocketClient.cs');
const auditRunner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaFirstRunCoachProbe.cs');

assert(bootstrap.includes('gameObject.AddComponent<RoaFirstRunCoach>()')
  && bootstrap.includes('FirstRunCoach.Configure(this);')
  && bootstrap.includes('MenuRestartFirstRunCoach()'),
  'First-run coach or its replay action is not connected to the Unity bootstrap');
assert(coach.includes('delta.magnitude <= 5f')
  && coach.includes('_movementMeters >= 1.5f'),
  'Movement step is not based on actual bounded player travel');
assert(coach.includes('Bootstrap.Interaction.IsPanelOpen')
  && coach.includes('activity.IsActivityRunning')
  && coach.includes('activity.LastResultTaskId')
  && coach.includes('activity.LastResultSucceeded'),
  'Coach steps are not driven by real interaction, active mission and matching result');
assert(coach.includes('if (activityActive) return CoachStep.Mission;')
  && coach.includes('if (activitySucceeded) return CoachStep.Complete;')
  && coach.includes('if (activityFailed) return CoachStep.Activity;'),
  'Starting, succeeding and failing a first activity do not have distinct coach states');
assert(activity.includes('public bool IsActivityRunning')
  && activity.includes('public string CurrentActivityTaskId')
  && activity.includes('public string LastResultTaskId')
  && activity.includes('public bool LastResultSucceeded')
  && activity.includes('public bool LastResultRewardClaimed'),
  'World activity HUD does not expose authoritative task-matched result signals');
assert(coach.includes('Application.isMobilePlatform')
  && coach.includes('Левый палец')
  && coach.includes('WASD')
  && coach.includes('Screen.safeArea'),
  'First-run copy or safe layout is not adaptive');
assert(coach.includes('PlayerPrefs.SetInt(PrefsKey, 1);')
  && coach.includes('PlayerPrefs.DeleteKey(PrefsKey);')
  && coach.includes('PlayerPrefs.Save();')
  && coach.includes('Пропустить'),
  'Coach completion, skip or explicit replay is not persisted');
assert(systemCanvas.includes('RestartFirstRunCoach')
  && systemCanvas.includes('Повторить первый выход')
  && systemCanvas.includes('Результат и начисленную награду подтверждает сервер.'),
  'F1 tutorial does not explain or replay the full activity loop');
assert(coach.includes('background.raycastTarget = false;')
  && coach.includes('_progress[i].raycastTarget = false;')
  && coach.includes('bool visible = !RoaGameBootstrap.BlocksWorldHud')
  && coach.includes('CoachStep.Mission && activityActive'),
  'Coach may block play or cover the authoritative mission HUD');
assert(probe.includes('public static void RunBatch()')
  && probe.includes('raycastGraphics == 1')
  && probe.includes('activity.LastResultTaskId == "activity_test"')
  && probe.includes('RoaWorldExitBoundary.IsInExitBand')
  && probe.includes('boundary.BeaconCount >= 12')
  && probe.includes('boundary.LockedColliderCount == 4')
  && probe.includes('CoachStep.Mission')
  && probe.includes('[ПЕРВЫЙ ВЫХОД] готово'),
  'Unity editor probe does not cover the full task-matched activity loop');
assert(auditRunner.includes('typeof(RoaFirstRunCoachProbe)'),
  'First-run probe is not part of the mandatory Unity client audit');

assert(exitBoundary.includes('public const int ExitBandTileCount = 2;')
  && exitBoundary.includes('GlobalMapExitBoundary')
  && exitBoundary.includes('ExitThresholdLine')
  && exitBoundary.includes('OutwardExitArrows')
  && exitBoundary.includes('ExitGuideBeacon')
  && exitBoundary.includes('ClosedLocationBoundary')
  && exitBoundary.includes('LockedDashedPerimeter')
  && exitBoundary.includes('AddComponent<BoxCollider>()')
  && exitBoundary.includes('ВЫХОД НА ГЛОБАЛЬНУЮ КАРТУ'),
  'The local world does not provide a clear two-tile global-map exit boundary');
assert(exitBoundary.includes('DistanceToMapEdge')
  && exitBoundary.includes('ApproachDistance = 12f')
  && exitBoundary.includes('Пересеките золотую полосу'),
  'The exit boundary does not provide proximity feedback before the automatic transition');
assert(loader.includes('_currentRoot.AddComponent<RoaWorldExitBoundary>()')
  && loader.includes('exitBoundary.Configure(definition.TileWidth, definition.TileDepth);'),
  'Generated and authored Unity locations do not share the exit boundary');
assert(bootstrap.includes('RoaWorldExitBoundary.IsInExitBand('),
  'The automatic transition width can drift away from its visual boundary');
assert(globalMap.includes('_enterWorldRequestPending')
  && globalMap.includes('controller?.SendStateImmediately()')
  && globalMap.includes('_enterWorldRetryAt = Time.realtimeSinceStartup + 0.75f;'),
  'Unity can overlap edge-exit requests or validate a stale player position');
assert(controller.includes('public void SendStateImmediately()')
  && socket.includes('private void SendStateInternal(')
  && socket.includes('if (!force && !isTransition && _stateCooldown > 0f) return;'),
  'The edge-exit action cannot flush its final authoritative position');
assert(bootstrap.includes('_controller.TeleportToSafeSpawn(spawn)')
  && controller.includes('FindSafeSpawnPosition(')
  && controller.includes('Physics.CheckCapsule(')
  && controller.includes('if (reason == "movementCorrection")')
  && controller.includes('ApplyAuthoritativePositionCorrection(corrected);')
  && controller.includes('transform.position = corrected;')
  && controller.includes('Physics.SyncTransforms();')
  && controller.includes('ResetTeleportMotion();')
  && controller.includes('_presentationCorrectionOffset = Vector3.zero;')
  && controller.includes('_presentationCorrectionVelocity = Vector3.zero;')
  && controller.includes('TeleportToSafeSpawn(corrected);')
  && onboarding.includes('Vector3 target = RoaCoords.ToUnity('),
  'Character creation, respawn or onboarding can place the player or target inside mirrored geometry');

const tutorialYard = JSON.parse(read('data', 'locations', 'tutorialCaravanYard.json'));
const tutorialAuthoring = read('unity-client', 'Assets', 'Editor', 'RoaTutorialYardAuthoring.cs');
assert(tutorialAuthoring.includes('authoring.PlayerArrival.localPosition = new Vector3(0, .1f, -26);')
  && tutorialAuthoring.includes('authoring.MigrationArrival.localPosition = new Vector3(0, .1f, -26);'),
  'Tutorial editor anchors disagree with the validated clear-ground spawn');
for (const key of ['spawn', 'respawn', 'entry', 'entryFromWorld', 'entryFromWasteland']) {
  assert(tutorialYard[key]?.tx === 19 && tutorialYard[key]?.tz === 6
    && tutorialYard[key]?.x === 0 && tutorialYard[key]?.z === -26,
  `Tutorial yard ${key} is not at the authored clear-ground arrival point`);
}
assert(minimap.includes('PaintGlobalMapExitBand(pixels);')
  && minimap.includes('RoaWorldExitBoundary.ExitBandTileCount'),
  'The minimap does not show the same exit band as the 3D location');

assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read(game, 'RoaFirstRunCoach.cs.meta')),
  'RoaFirstRunCoach.cs.meta has invalid metadata');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Editor', 'RoaFirstRunCoachProbe.cs.meta')),
  'RoaFirstRunCoachProbe.cs.meta has invalid metadata');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Scripts', 'World', 'RoaWorldExitBoundary.cs.meta')),
  'RoaWorldExitBoundary.cs.meta has invalid metadata');

// --- показатели жизни в первую же секунду -------------------------------------
// HUD брал здоровье только из снимка комнаты, а сервер в этом снимке шлёт
// ВСЕХ, КРОМЕ САМОГО игрока (`v.id !== p.id` во всех сборках снимка). Поэтому
// до первого попадания HUD жил с нулём и рисовал «HP 0/1» — красная полоса и
// вид мертвеца у только что вошедшего живого персонажа.
const hud = read(game, 'RoaHud.cs');
const server = read('server.js');

assert(/ApplyEquipmentAndSkills[\s\S]{0,1400}payload\["maxHp"\]/.test(hud)
  && /ApplyEquipmentAndSkills[\s\S]{0,1400}payload\["hp"\]/.test(hud),
  'HUD не читает здоровье из join-ответа — игрок увидит «HP 0/1» до первого попадания');
assert(/ApplyEquipmentAndSkills[\s\S]{0,1400}payload\["dead"\]/.test(hud),
  'HUD не читает признак смерти из join-ответа');
assert(hud.includes('ApplyEquipmentAndSkills(ack.Self)'),
  'join-ответ больше не проходит через чтение витальных показателей');

// Источник этих полей — publicPlayer, развёрнутый в publicAuthoritativePlayerState.
const publicPlayerBody = server.slice(server.indexOf('function publicPlayer(p) {'));
const publicPlayerEnd = publicPlayerBody.indexOf('\n}\n');
for (const field of ['hp:', 'maxHp:', 'dead:', 'level:']) {
  assert(publicPlayerBody.slice(0, publicPlayerEnd).includes(field),
    `publicPlayer больше не отдаёт ${field} — HUD останется без него при входе`);
}
assert(server.includes('...publicPlayer(p),'),
  'publicAuthoritativePlayerState больше не разворачивает publicPlayer, и join-ответ теряет показатели жизни');

console.log('Unity first run OK: guided movement, interaction, visible world exit, live-map mission, authoritative result '
  + 'and vitals shown from the join reply instead of «HP 0/1» until the first hit');
