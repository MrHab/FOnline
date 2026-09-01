'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const character = read(game, 'RoaCharacterView.cs');
const enemies = read(game, 'RoaEnemies.cs');
const remote = read(game, 'RoaRemotePlayers.cs');
const melee = read(game, 'RoaMeleeGrip.cs');
const weapon = read(game, 'RoaWeaponView.cs');
const fx = read(game, 'RoaCombatPresentationFx.cs');
const fxFactory = read(game, 'RoaCombatPresentationFx.Factory.cs');
const fxMotion = read(game, 'RoaCombatPresentationFx.Motion.cs');
const combat = read(game, 'RoaCombat.cs');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const webInput = read('public', 'js', 'game', '08f_input_events_proximity.js');
const webWindows = read('public', 'js', 'game', '08c_hud_edit_windows_touch.js');
const server = read('server.js');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaCombatFlowProbe.cs');
const probeMeta = read('unity-client', 'Assets', 'Editor', 'RoaCombatFlowProbe.cs.meta');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const docs = read('docs', 'UNITY_PORT.md');
const packageJson = JSON.parse(read('package.json'));

assert(character.includes('public enum CombatPresentationPhase')
  && character.includes('if (dead) return CombatPresentationPhase.Death;')
  && character.includes('if (reacting) return CombatPresentationPhase.Reaction;')
  && character.includes('if (attacking) return CombatPresentationPhase.Attack;'),
'Character body no longer has one explicit death > reaction > attack > gait priority');
assert(character.includes('public static float DeathYawForImpact(')
  && character.includes('Mathf.Round(raw / 45f) * 45f')
  && character.includes('public void PrepareDeath(')
  && character.includes('Quaternion.Euler(0f, _deathYawOffsetDeg, 0f)'),
'Authoritative fatal hits no longer select a stable directional death variant');
assert(melee.includes('public static float SwingSecondsForImpact(')
  && melee.includes('impact / StrikeContactPhase')
  && weapon.includes('public void PlayAttack(float meleeSwingSeconds)')
  && weapon.includes('StartSwing(meleeSwingSeconds);'),
'NPC melee pose cannot be stretched to the authoritative contact deadline');

const attackBody = enemies.slice(enemies.indexOf('private void PlayEnemyAttack('),
  enemies.indexOf('private void HandleEnemyKilled('));
assert(attackBody.includes('AttackPresentationBlocked(')
  && !attackBody.includes('enemy.ReactionUntil = 0f;')
  && attackBody.includes('AnimateAttackAtImpact(ranged, windupAnimated)'),
'A stale attack relay can still cancel hit reaction or duplicate a wind-up');
assert(enemies.includes('AnimateAttackAtTelegraph(enemy.ThreatRanged)')
  && enemies.includes('RoaMeleeGrip.SwingSecondsForImpact(enemy.ThreatRemaining)')
  && enemies.includes('PlayClip(enemy, "attack", enemy.ThreatRemaining)')
  && enemies.includes('AttackRootLockSeconds('),
'NPC warning is not connected to contact-timed melee and bounded recovery');
assert(enemies.includes('RoaCharacterView.ResolveCombatPresentationPhase(')
  && enemies.includes('enemy.Animation.Play(clip, PlayMode.StopAll);')
  && enemies.includes('clip == "attack" || clip == "hurt" ? WrapMode.Once')
  && enemies.includes('if (clip == "attack" || clip == "hurt") state.time = 0f;'),
'Legacy NPCs can reuse stale action time or retain locomotion weight after death');

assert(server.includes('sourceX: Number(sourceX.toFixed(2))')
  && server.includes('sourceZ: Number(sourceZ.toFixed(2))')
  && server.includes('sourceX: Number(enemy.x.toFixed(2))')
  && remote.includes('wounded.View.PrepareDeath(source);')
  && remote.includes('killed.View.PrepareDeath(source);')
  && enemies.includes('enemy.CharacterView.PrepareDeath(hitSource);'),
'Fatal source direction is lost between server, local NPC and remote-player presentation');

assert(fx.includes('public static float ConfirmationImpulse(')
  && fx.includes('distance >= 18f')
  && fx.includes('public static Color ConfirmedImpactColor(')
  && fx.includes('CameraRig.AddImpulse(impulse);')
  && fxFactory.includes('"ImpactDust"')
  && fxFactory.includes('DustMaterial = dustMaterial')
  && fxMotion.includes('float dustRadius = Mathf.Lerp('),
'Accepted hits lost their bounded camera weight, material colour or pooled ground dust');
assert(fx.includes('private static void DestroyOwnedObject(')
  && fx.includes('UnityEngine.Object.DestroyImmediate(ownedObject);')
  && fxFactory.includes('DestroyOwnedObject(_impacts[i].Root);'),
'Pooled combat VFX can leave editor probe errors during immediate cleanup');

assert(combat.includes('public RoaPipboyCanvas PipboyCanvas;')
  && combat.includes('public RoaGlobalMap GlobalMap;')
  && combat.includes('Bootstrap != null && Bootstrap.GlobalMapBlocksCombat')
  && combat.includes('PipboyCanvas != null && PipboyCanvas.IsOpen')
  && combat.includes('GlobalMap != null && GlobalMap.IsActive')
  && bootstrap.includes('Combat.Bootstrap = this;')
  && bootstrap.includes('public bool GlobalMapBlocksCombat { get { return _stage == Stage.LoadingGlobalMap || _stage == Stage.GlobalMap; } }')
  && bootstrap.includes('Combat.GlobalMap = GlobalMap;')
  && bootstrap.includes('Combat.PipboyCanvas = PipboyCanvas;'),
'PIP-ASH or global-map state is no longer wired into authoritative combat input gating');
assert(webInput.includes('if (anyWindowOpen()) {')
  && webInput.includes('stopAutoFire();')
  && webInput.includes('e.stopPropagation();')
  && webWindows.includes('if (paused || anyWindowOpen()) {')
  && webWindows.includes("setTouchButtonActive('touch-fire', false);")
  && webWindows.includes("uiWindows.globalMap.classList.contains('visible')")
  && webWindows.includes("Object.values(uiWindows).some(w => w && w.classList.contains('visible'))"),
'The browser combat surface can attack through an open PIP-ASH or global-map window');

assert(probe.includes('RoaCharacterView.ResolveCombatPresentationPhase(')
  && probe.includes('RoaMeleeGrip.SwingSecondsForImpact(deadline)')
  && probe.includes('RoaCharacterView.DeathYawForImpact(Vector2.right)')
  && probe.includes('RoaCombatPresentationFx.ConfirmationImpulse(')
  && probe.includes('RoaCombat.UiBlocksAttack(false, true, false, false, false)')
  && probe.includes('RoaCombat.UiBlocksAttack(false, false, false, false, true)')
  && probe.includes('impact.Find("ImpactDust")')
  && probe.includes('[COMBAT FLOW 4.8] готово:'),
'Unity 4.8 probe no longer covers priority, timing, death direction and pooled impact');
assert(runner.includes('typeof(RoaCombatFlowProbe)'),
'Combat Flow 4.8 probe is missing from the Unity audit runner');
assert(probeMeta.includes('guid: 7f4b9d8e50c84b31a6e2f1739a480c42'),
'Combat Flow 4.8 probe metadata is missing or unstable');
assert(docs.includes('## Combat Flow 4.8'),
'Unity port documentation does not describe the Combat Flow 4.8 contract');
assert(packageJson.scripts['check:unity-combat-flow'],
'package.json has no narrow Combat Flow 4.8 check');

console.log('Unity Combat Flow 4.8 OK: priority, server-timed melee, impact recoil, directional deaths and pooled readable effects');
