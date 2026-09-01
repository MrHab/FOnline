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
  && probe.includes('CoachStep.Mission')
  && probe.includes('[ПЕРВЫЙ ВЫХОД] готово'),
  'Unity editor probe does not cover the full task-matched activity loop');
assert(auditRunner.includes('typeof(RoaFirstRunCoachProbe)'),
  'First-run probe is not part of the mandatory Unity client audit');

assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read(game, 'RoaFirstRunCoach.cs.meta')),
  'RoaFirstRunCoach.cs.meta has invalid metadata');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Editor', 'RoaFirstRunCoachProbe.cs.meta')),
  'RoaFirstRunCoachProbe.cs.meta has invalid metadata');

console.log('Unity first run OK: movement, interaction, live-map mission, matching authoritative result and replayable guidance');
