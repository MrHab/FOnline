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
const probe = read('unity-client', 'Assets', 'Editor', 'RoaFirstRunCoachProbe.cs');

assert(bootstrap.includes('gameObject.AddComponent<RoaFirstRunCoach>()')
  && bootstrap.includes('FirstRunCoach.Configure(this);'),
  'First-run coach is not connected to the Unity bootstrap');
assert(coach.includes('delta.magnitude <= 5f')
  && coach.includes('_movementMeters >= 1.5f'),
  'Movement step is not based on actual bounded player travel');
assert(coach.includes('Bootstrap.Interaction.IsPanelOpen')
  && coach.includes('Bootstrap.OnGlobalMap')
  && coach.includes('Bootstrap.WorldActivityCanvas.HasActiveActivity'),
  'Coach steps are not driven by real interaction, global map and activity state');
assert(activity.includes('public bool HasActiveActivity'),
  'World activity HUD does not expose an authoritative onboarding completion signal');
assert(coach.includes('Application.isMobilePlatform')
  && coach.includes('Левый палец')
  && coach.includes('WASD')
  && coach.includes('Screen.safeArea'),
  'First-run copy or safe layout is not adaptive');
assert(coach.includes('PlayerPrefs.SetInt(PrefsKey, 1);')
  && coach.includes('PlayerPrefs.Save();')
  && coach.includes('Пропустить'),
  'Coach completion or explicit skip is not persisted');
assert(coach.includes('background.raycastTarget = false;')
  && coach.includes('_progress[i].raycastTarget = false;')
  && coach.includes('bool visible = !RoaGameBootstrap.BlocksWorldHud;'),
  'Coach may block play or remain visible above gameplay panels');
assert(probe.includes('public static void RunBatch()')
  && probe.includes('raycastGraphics == 1')
  && probe.includes('[ПЕРВЫЙ ВЫХОД] готово'),
  'Unity editor probe does not cover progression and input transparency');

assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read(game, 'RoaFirstRunCoach.cs.meta')),
  'RoaFirstRunCoach.cs.meta has invalid metadata');
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Editor', 'RoaFirstRunCoachProbe.cs.meta')),
  'RoaFirstRunCoachProbe.cs.meta has invalid metadata');

console.log('Unity first run OK: action-driven movement, interaction, live-map activity and nonblocking adaptive coach');
