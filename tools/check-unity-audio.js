'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const audio = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaAudio.cs');
const activityFeedbackCanvas = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaWorldActivityCanvas.Feedback.cs');
const activityFeedbackProbe = read('unity-client', 'Assets', 'Editor', 'RoaActivityFeedbackProbe.cs');
const economyFeedbackCanvas = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaHudCanvas.EconomyFeedback.cs');
const economyFeedbackProbe = read('unity-client', 'Assets', 'Editor', 'RoaEconomyFeedbackProbe.cs');
const movementFx = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaMovementFx.cs');
const remotePlayers = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaRemotePlayers.cs');
const enemies = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaEnemies.cs');
const bootstrap = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaGameBootstrap.cs');
const combat = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombat.cs');
const combatFx = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombatFx.cs');
const controller = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaPlayerController.cs');
const systemCanvas = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaSystemCanvas.cs');
const meta = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaAudio.cs.meta');
const movementMeta = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaMovementFx.cs.meta');
const movementProbe = read('unity-client', 'Assets', 'Editor', 'RoaMovementFxProbe.cs');
const weaponAudioProbe = read('unity-client', 'Assets', 'Editor', 'RoaWeaponAudioProbe.cs');
const clientAuditRunner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const weaponAudioRoot = path.join(root, 'unity-client', 'Assets', 'Resources', 'Audio', 'Weapons');
const weaponAudioManifest = JSON.parse(read('source-assets', 'audio', 'weapon-pilot', 'manifest.json'));
const weaponAudioFiles = [
  'ballistic_pistol.ogg', 'ballistic_rifle.ogg', 'ballistic_shotgun.ogg',
  'ballistic_machinegun.ogg', 'energy_sidearm.ogg', 'energy_longgun.ogg',
  'launcher_fire.ogg', 'flamethrower_fire.ogg', 'projectile_impact.ogg',
  'melee_light_swing.ogg', 'melee_light_impact.ogg', 'melee_heavy_swing.ogg',
  'melee_heavy_impact.ogg', 'reload_pistol.ogg', 'reload_rifle.ogg',
  'reload_shotgun.ogg', 'dry_fire.ogg'
];

assert(audio.includes('public sealed class RoaAudio'), 'Unity runtime audio component is missing');
assert(audio.includes('WeaponPilotClipCount = 17')
  && audio.includes('Resources.Load<AudioClip>(WeaponAudioResourceRoot + resourceName)')
  && audio.includes('public bool WeaponPilotAudioReady')
  && audio.includes('LoadWeaponPilotClips();'),
'Authored weapon audio no longer loads with generated fallbacks');
assert.strictEqual(weaponAudioManifest.clips.length, weaponAudioFiles.length,
  'Weapon audio source manifest does not describe all runtime clips');
assert.deepStrictEqual(
  weaponAudioManifest.clips.map(clip => clip.file).sort(),
  [...weaponAudioFiles].sort(),
  'Weapon audio source manifest and runtime catalog disagree');
assert.deepStrictEqual(
  fs.readdirSync(weaponAudioRoot).filter(file => file.endsWith('.ogg')).sort(),
  [...weaponAudioFiles].sort(),
  'Unexpected or missing OGG files in the weapon audio Resources folder');
for (const file of weaponAudioFiles) {
  const asset = path.join(weaponAudioRoot, file);
  const bytes = fs.readFileSync(asset);
  const manifestClip = weaponAudioManifest.clips.find(clip => clip.file === file);
  assert(bytes.length > 4 * 1024,
    `Authored weapon audio is missing or unexpectedly small: ${file}`);
  assert.strictEqual(manifestClip.bytes, bytes.length,
    `Weapon audio byte count drifted from provenance: ${file}`);
  assert.strictEqual(manifestClip.sha256,
    crypto.createHash('sha256').update(bytes).digest('hex'),
    `Weapon audio hash drifted from provenance: ${file}`);
  assert(fs.existsSync(`${asset}.meta`), `Unity audio importer metadata is missing: ${file}.meta`);
}
assert(weaponAudioProbe.includes('ExpectedClips = 17')
  && weaponAudioProbe.includes('audio.WeaponPilotAudioReady')
  && weaponAudioProbe.includes('clip.channels == 1')
  && clientAuditRunner.includes('typeof(RoaWeaponAudioProbe)'),
'Unity weapon audio probe no longer validates the complete mono Resources set');
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
assert(audio.includes('PlayActorFootstep(FootstepCue cue)')
  && audio.includes('14f * noise, false)')
  && audio.includes('if (!allowSteal) return;'),
'Visible actor footsteps no longer yield pooled audio voices to combat');
assert(audio.includes('maxDistance * _hearingMultiplier')
  && audio.includes('cue.NoiseMultiplier') && audio.includes('_feet.volume *= _movementNoiseMultiplier'),
'Artifact hearing and movement-noise modifiers must reach spatial audio');
assert(audio.includes('float.IsNaN(data[i])') && audio.includes('Generated audio is silent')
  && audio.includes('_validatedClipCount++'),
'Generated clips no longer reject silent or invalid PCM data');
assert(audio.includes('VolumePrefsKey') && audio.includes('CycleMasterVolume()')
  && audio.includes('PlayerPrefs.Save()'),
'Persistent player-facing volume control is incomplete');
assert(audio.includes('PlayActivityCue(RoaActivityFeedbackCue cue)')
  && audio.includes('BuildActivitySignal("ActivityStart"')
  && audio.includes('BuildActivitySignal("ActivityProgress"')
  && audio.includes('BuildActivitySignal("ActivityExtraction"')
  && audio.includes('BuildActivitySignal("ActivitySuccess"')
  && audio.includes('BuildActivitySignal("ActivityFailure"'),
'Activity start, progress, extraction and result cues are incomplete');
assert(audio.includes('Time.unscaledTime - _lastActivityAt < 0.42f')
  && activityFeedbackCanvas.includes('audio?.PlayActivityCue(cue);'),
'Activity feedback can chatter or is disconnected from the HUD');
assert(activityFeedbackProbe.includes('audio.ActivityCuesReady')
  && activityFeedbackProbe.includes('audio.GeneratedClipCount == 32'),
'Unity editor probe no longer validates generated activity PCM');
assert(audio.includes('PlayEconomyCue(RoaEconomyNoticeKind kind)')
  && audio.includes('BuildActivitySignal("EconomyGain"')
  && audio.includes('BuildActivitySignal("LevelUp"')
  && economyFeedbackCanvas.includes('PlayEconomyCue(RoaEconomyNoticeKind.LevelUp)')
  && economyFeedbackProbe.includes('audio.EconomyCuesReady'),
'Generated economy gain or level-up audio is incomplete');

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
  && combat.includes('Audio?.PlayReload(ActiveWeapon())'),
'Accepted combat actions lost an important sound feedback branch');
assert(controller.includes('footPosition.y = FeetY() + 0.025f;')
  && controller.includes('Audio?.SetLocomotion(_visualVelocity, footPosition, _controller.isGrounded, _crouching, Moving);')
  && audio.includes('_locomotionActive = moving;')
  && audio.includes('!_locomotionActive || !_grounded')
  && controller.includes('Audio?.StopLocomotion();'),
'Footsteps are no longer driven by collision-resolved movement');
assert(movementFx.includes('public sealed class RoaMovementFx')
  && movementFx.includes('ParticleSystemRenderMode.HorizontalBillboard')
  && movementFx.includes('PuffCapacityValue = 96')
  && movementFx.includes('DustTextureSizeValue = 64')
  && movementFx.includes('PuffLiftMax = 0.58f')
  && movementFx.includes('material.EnableKeyword("_ALPHABLEND_ON")')
  && movementFx.includes('Application.isMobilePlatform')
  && movementFx.includes('FootOffset(planar, cue.RightFoot)'),
'Movement FX lost its pooled dust, ground scuff, mobile budget or alternating feet');
assert(movementFx.includes('ActorStepState')
  && movementFx.includes('TryPlanActorStep(ref ActorStepState state')
  && movementFx.includes('delta.sqrMagnitude > 7.5625f')
  && movementFx.includes('mobile ? 15f : 24f')
  && movementFx.includes('EmitActorStep(cue);'),
'Shared actor step scheduler lost cadence, teleport protection, distance budget or pooled emission');
assert(remotePlayers.includes('ConfigureMovementFx(RoaMovementFx movementFx, Camera worldCamera)')
  && remotePlayers.includes('TrackActor(ref remote.StepFx')
  && remotePlayers.includes('remote.PresentationVelocity')
  && remotePlayers.includes('remote.PresentationMoving')
  && enemies.includes('ConfigureMovementFx(RoaMovementFx movementFx, Camera worldCamera)')
  && enemies.includes('TrackActor(ref enemy.StepFx')
  && enemies.includes('enemy.PresentationVelocity')
  && enemies.includes('enemy.PresentationMoving'),
'Remote players or NPCs no longer drive shared visible movement feedback');
assert(bootstrap.includes('Enemies.ConfigureMovementFx(MovementFx, movementFxCamera);')
  && bootstrap.includes('RemotePlayers.ConfigureMovementFx(MovementFx, movementFxCamera);'),
'Bootstrap no longer shares movement FX and camera distance budget with visible actors');
assert(movementProbe.includes('[ПЫЛЬ ШАГОВ] готово:')
  && movementProbe.includes('run.PuffCount > walk.PuffCount')
  && movementProbe.includes('crouch.ScuffCount == 0')
  && movementProbe.includes('TryPlanActorStep(ref actorState')
  && movementProbe.includes('fx.ActorStepCount == 1')
  && movementProbe.includes('maxLift > 0.045f')
  && movementProbe.includes('maxAlpha > 0.24f')
  && movementProbe.includes('серверная коррекция позиции ошибочно выглядит как шаг'),
'Unity movement FX probe no longer covers pace, visibility, teleport protection and shared actor pools');
assert(systemCanvas.includes('"Звук: выключен"')
  && systemCanvas.includes('RoaAudio.Active?.CycleMasterVolume()'),
'System menu no longer exposes audio volume');
assert(/guid:\s*[0-9a-f]{32}/i.test(meta), 'RoaAudio MonoScript meta GUID is missing');
assert(/guid:\s*[0-9a-f]{32}/i.test(movementMeta), 'RoaMovementFx MonoScript meta GUID is missing');

console.log('Unity audio/movement OK: ambience, combat/footsteps, activity/economy cues, UI priority and persistent volume');
