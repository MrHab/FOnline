'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const readiness = read(game, 'RoaWeaponReadiness.cs');
const combat = read(game, 'RoaCombat.cs');
const hud = read(game, 'RoaHud.cs');
const canvas = read(game, 'RoaHudCanvas.cs');
const character = read(game, 'RoaCharacterView.cs');
const weapon = read(game, 'RoaWeaponView.cs');
const offhand = read(game, 'RoaOffhandWeaponView.cs');
const audio = read(game, 'RoaAudio.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaWeaponReadinessProbe.cs');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const packageJson = JSON.parse(read('package.json'));

for (const kind of ['Ready', 'Cooldown', 'ReloadPending', 'Reloading', 'Empty', 'NoAmmo', 'LowActionPoints'])
  assert(readiness.includes(kind), `weapon readiness state ${kind} is missing`);
assert(readiness.includes('ПУСТО · R')
  && readiness.includes('НЕТ ПАТРОНОВ')
  && readiness.includes('НУЖНО ')
  && readiness.includes('ГОТОВО ЧЕРЕЗ '),
'Weapon state does not explain ammo, AP and authoritative cooldown failures');

assert(hud.includes('combat["cooldownRemainingMs"]')
  && hud.includes('public float CooldownRemainingSeconds'),
'HUD does not consume the server-authoritative attack cooldown');
assert(combat.includes('public bool ReloadRequestPending')
  && combat.includes('public float ReloadVisualRemaining')
  && combat.includes('public bool HasUsableRound')
  && combat.includes('if (_reloadRequestInFlight)')
  && combat.includes('AddLog("Перезарядка…")')
  && combat.includes('Audio?.PlayDryFire()'),
'Combat input lacks reload de-duplication, immediate pending feedback or dry-fire response');
assert(combat.includes('Player.View?.CancelReload()')
  && character.includes('public void CancelReload()')
  && weapon.includes('public void CancelReload()')
  && offhand.includes('public void CancelReload()'),
'Accepted cosmetic reload cannot yield cleanly to the next attack');

assert(canvas.includes('RoaWeaponReadiness.Evaluate(')
  && canvas.includes('_consoleWeaponState.text = readiness.Label')
  && canvas.includes('WeaponStateColor(readiness.Kind)'),
'Weapon console does not render the unified readiness state');
assert(audio.includes('public void PlayDryFire()')
  && audio.includes('_dryFire = BuildDryFire()')
  && audio.includes('public bool WeaponFeedbackCuesReady'),
'Empty magazine has no distinct rate-limited audio cue');

assert(probe.includes('RoaWeaponReadinessKind.ReloadPending')
  && probe.includes('RoaWeaponReadinessKind.NoAmmo')
  && probe.includes('[ГОТОВНОСТЬ ОРУЖИЯ] готово:'),
'Editor probe no longer covers reload, empty reserve and ready states');
assert(runner.includes('typeof(RoaWeaponReadinessProbe)'),
  'Weapon readiness probe is not included in the Unity audit');
for (const file of [
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaWeaponReadiness.cs.meta'],
  ['unity-client', 'Assets', 'Editor', 'RoaWeaponReadinessProbe.cs.meta']
]) assert(/guid:\s*[0-9a-f]{32}/i.test(read(...file)), `${file.join('/')} has no GUID`);
assert(packageJson.scripts['check:unity-weapon-readiness'],
  'package.json has no narrow weapon readiness check');

console.log('Unity weapon readiness OK: authoritative cooldown, reload lifecycle, dry fire and readable HUD state');
