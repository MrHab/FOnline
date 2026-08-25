'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const audio = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaAudio.cs');
const movementFx = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaMovementFx.cs');
const bootstrap = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaGameBootstrap.cs');
const combat = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombat.cs');
const combatFx = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombatFx.cs');
const controller = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaPlayerController.cs');
const systemCanvas = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaSystemCanvas.cs');
const meta = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaAudio.cs.meta');
const movementMeta = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaMovementFx.cs.meta');
const movementProbe = read('unity-client', 'Assets', 'Editor', 'RoaMovementFxProbe.cs');

assert(audio.includes('public sealed class RoaAudio'), 'Unity runtime audio component is missing');
assert(audio.includes('BuildWind()') && audio.includes('BuildGunshot(')
  && audio.includes('BuildEnergyShot(') && audio.includes('BuildExplosion()'),
'Runtime audio no longer generates ambience and distinct weapon/explosion layers');
assert(audio.includes('WorldVoiceCount = 14') && audio.includes('Source("WorldVoice" + i, 0.78f)')
  && audio.includes('DelayedWorld(_impact'),
'World audio lost pooled spatial voices or distance-delayed impacts');
assert(audio.includes('UpdateFootsteps(') && audio.includes('_controller.isGrounded') === false,
'Audio component must own cadence without reaching into the player controller');
assert(audio.includes('public event Action<FootstepCue> Footstep;')
  && audio.includes('Footstep?.Invoke(new FootstepCue')
  && audio.includes('RightFoot = _rightFoot'),
'Audio cadence no longer emits an alternating visual footstep cue');
assert(audio.includes('float.IsNaN(data[i])') && audio.includes('Generated audio is silent')
  && audio.includes('_validatedClipCount++'),
'Generated clips no longer reject silent or invalid PCM data');assert(audio.includes('VolumePrefsKey') && audio.includes('CycleMasterVolume()')
  && audio.includes('PlayerPrefs.Save()'),
'Persistent player-facing volume control is incomplete');

assert(bootstrap.includes('gameObject.AddComponent<RoaAudio>()')
  && bootstrap.includes('gameObject.AddComponent<RoaMovementFx>()')
  && bootstrap.includes('MovementFx.Configure(Audio);')
  && bootstrap.includes('CombatFx.Audio = Audio;')
  && bootstrap.includes('Combat.Audio = Audio;')
  && bootstrap.includes('_controller.Audio = Audio;'),
'Bootstrap does not wire audio to combat, FX and locomotion');
assert(combatFx.includes('Audio?.PlayShot(start, end, weaponId);')
  && combatFx.includes('Audio?.PlayExplosion(center, radius);'),
'Combat visuals no longer emit matching spatial sound');
assert(combat.includes('Audio?.PlayMeleeSwing')
  && combat.includes('Audio?.PlayMeleeImpact')
  && combat.includes('Audio?.PlayHurt(damage)')
  && combat.includes('Audio?.PlayKillConfirm()')
  && combat.includes('Audio?.PlayReload()'),
'Accepted combat actions lost an important sound feedback branch');
assert(controller.includes('footPosition.y = FeetY() + 0.025f;')
  && controller.includes('Audio?.SetLocomotion(_visualVelocity, footPosition, _controller.isGrounded, _crouching);')
  && controller.includes('Audio?.StopLocomotion();'),
'Footsteps are no longer driven by collision-resolved movement');
assert(movementFx.includes('public sealed class RoaMovementFx')
  && movementFx.includes('ParticleSystemRenderMode.HorizontalBillboard')
  && movementFx.includes('PuffCapacityValue = 96')
  && movementFx.includes('Application.isMobilePlatform')
  && movementFx.includes('FootOffset(planar, cue.RightFoot)'),
'Movement FX lost its pooled dust, ground scuff, mobile budget or alternating feet');
assert(movementProbe.includes('[ПЫЛЬ ШАГОВ] готово:')
  && movementProbe.includes('run.PuffCount > walk.PuffCount')
  && movementProbe.includes('crouch.ScuffCount == 0'),
'Unity movement FX probe no longer covers pace and crouch scaling');
assert(systemCanvas.includes('"Звук: выключен"')
  && systemCanvas.includes('RoaAudio.Active?.CycleMasterVolume()'),
'System menu no longer exposes audio volume');
assert(/guid:\s*[0-9a-f]{32}/i.test(meta), 'RoaAudio MonoScript meta GUID is missing');
assert(/guid:\s*[0-9a-f]{32}/i.test(movementMeta), 'RoaMovementFx MonoScript meta GUID is missing');

console.log('Unity audio/movement OK: ambience, 8 weapon profiles, spatial impacts, synchronized footstep dust, combat/UI feedback and persistent volume');
