'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const combat = read(game, 'RoaCombat.cs');
const meleeGrip = read(game, 'RoaMeleeGrip.cs');
const confirmation = read(game, 'RoaCombatConfirmation.cs');
const feedback = read(game, 'RoaCombatFeedbackCanvas.cs');
const enemies = read(game, 'RoaEnemies.cs');
const fx = read(game, 'RoaCombatFx.cs');
const polish = read(game, 'RoaCombatPresentationFx.cs');
const motion = read(game, 'RoaCombatPresentationFx.Motion.cs');
const audio = read(game, 'RoaAudio.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaCombatConfirmationProbe.cs');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const packageJson = JSON.parse(read('package.json'));

assert(confirmation.includes('NormalLifetime = 0.38f')
  && confirmation.includes('KillLifetime = 0.48f')
  && confirmation.includes('Mathf.Pow(1f - t, 3f)')
  && confirmation.includes('Mathf.InverseLerp(0.38f, 1f, t)'),
'Hit marker lost its bounded converge-and-fade curve');
assert(confirmation.includes('critical ? 26f : 23f')
  && confirmation.includes('killed ? 30f')
  && confirmation.includes('killed ? 12f : critical ? 10f : 8f'),
'Normal, critical and kill markers are no longer visually distinct');
assert(feedback.includes('InitialFloatingPool = 16')
  && feedback.includes('InitialMarkerPool = 12')
  && feedback.includes('public static FloatingFrame EvaluateFloating(')
  && feedback.includes('FloatingLifetime = 0.92f')
  && feedback.includes('Mathf.InverseLerp(0.44f, 1f, t)')
  && feedback.includes('public static FloatingStyle ResolveFloatingStyle(')
  && feedback.includes('value + "  <size=" + tagSize + ">КРИТ</size>"')
  && feedback.includes('public static Vector2 FloatingStackOffset(')
  && feedback.includes('point + view.Offset + Vector2.up * frame.Rise')
  && feedback.includes('RoaUiScale.Apply(')
  && feedback.includes('image.raycastTarget = false')
  && feedback.includes('group.blocksRaycasts = false'),
'Combat feedback Canvas lost bounded pools, scaled presentation or input transparency');
assert(meleeGrip.includes('public const float StrikeContactPhase = 0.58f;')
  && meleeGrip.includes('public static float StrikeContactSeconds(')
  && meleeGrip.includes('else if (phase < StrikeContactPhase)')
  && meleeGrip.includes('(phase - StrikeContactPhase) / (1f - StrikeContactPhase)'),
'Authored melee pose and result timing no longer share one contact phase');

const enemyResult = combat.slice(combat.indexOf('private void HandleHitResult('),
  combat.indexOf('private void HandlePlayerHitResult('));
const playerResult = combat.slice(combat.indexOf('private void HandlePlayerHitResult('),
  combat.indexOf('private void HandleExplosionResult('));
const explosionResult = combat.slice(combat.indexOf('private void HandleExplosionResult('),
  combat.indexOf('private void EnsureFireMode()'));
for (const [name, body] of [['enemy', enemyResult], ['player', playerResult]]) {
  assert(body.includes('if (!hit)') && body.indexOf('if (!hit)') < body.indexOf('PlayHitConfirm(critical)'),
    `${name} hit confirmation can play before a server-confirmed hit`);
  assert(body.includes('Fx?.PlayConfirmedHit(targetPosition, sourcePosition, weapon, critical,'),
    `${name} accepted hit is missing a confirmed world impact`);
  assert(body.includes('ConfirmHit(targetPosition, critical,'),
    `${name} accepted hit is missing a target-anchored HUD marker`);
  assert(body.includes('TryTakeMeleePresentationDelay(')
    && body.includes('new WaitForSecondsRealtime(delay)')
    && body.indexOf('Socket.ApplyGameplayAck(ack)') < body.indexOf('StartCoroutine('),
    `${name} melee feedback is not contact-synchronized after immediate authoritative state`);
}
assert(enemyResult.includes('Enemies.ApplyPublicEnemyHit(enemy, sourcePosition, damage, critical)'),
  'NPC hit state loses source, damage or critical context');
assert(playerResult.includes('if (killed) Audio?.PlayKillConfirm();'),
  'PvP kill has no local kill confirmation');
assert(combat.includes('public static float MeleePresentationDelay(')
  && combat.includes('RoaMeleeGrip.StrikeContactSeconds(swingSeconds)')
  && combat.includes('PresentEnemyKillAfterDelay')
  && combat.includes('BeginAttackRequest(attackToken, meleeAttack, attackVisualStartedAt);'),
  'Melee contact timing is not connected to attack start, hit feedback and kill reward');
assert(explosionResult.includes('FindResultRow(enemyHits, "enemyId"')
  && explosionResult.includes('Enemies.ApplyPublicEnemyHit(enemy, impactPosition,')
  && explosionResult.includes('if (selfHit) continue;')
  && explosionResult.includes('ConfirmHit(position, critical, killed);')
  && explosionResult.includes('out Vector3 resolvedEnemyPosition')
  && explosionResult.includes('out Vector3 resolvedPlayerPosition')
  && explosionResult.includes('if (confirmedTargets > 0) Audio?.PlayHitConfirm(anyCritical);'),
'Explosion hits lose authoritative NPC context, duplicate self-damage, or lack multi-target confirmation');
assert(combat.includes('HitConfirmationLimit = 12')
  && combat.includes('feedback.ShowFloating(')
  && combat.includes('feedback.ShowHit(')
  && combat.includes('if (!CanvasDriven && cam != null)')
  && feedback.includes('RoaCombatConfirmation.Evaluate(')
  && feedback.includes('AcquireFloating()')
  && feedback.includes('AcquireMarker()'),
'Authoritative feedback is not routed through the bounded Canvas or IMGUI still renders in the primary HUD');

assert(enemies.includes('public void ApplyPublicEnemyHit(')
  && enemies.includes('enemy.CharacterView.PlayHit(hitSource, hitDamage, hitCritical);'),
'NPCs no longer receive an authoritative directional hit reaction');
assert(enemies.includes('public void BeginMeleePresentationHold(')
  && enemies.includes('public void CompleteMeleePresentationHold(')
  && enemies.includes('TryDeferMeleeSnapshot(id, row, out JObject presentationRow)')
  && enemies.includes('presentationRow["hp"] = enemy.Hp;')
  && enemies.includes('presentationRow["dead"] = enemy.Dead;')
  && enemies.includes('_meleePresentationHolds[id].PendingKilled')
  && enemies.includes('_meleePresentationHolds[id].SawDeadFrame = true;')
  && enemies.includes('ReleaseDueMeleePresentationHolds();'),
'Early PvE damage/death is not held until the authored melee contact');
const targetedMelee = combat.slice(combat.indexOf('else if (!string.IsNullOrEmpty(enemyId))'),
  combat.indexOf('private bool TryScreenPointToWorld('));
assert(targetedMelee.includes('Enemies.BeginMeleePresentationHold(enemyId,')
  && targetedMelee.indexOf('Enemies.BeginMeleePresentationHold(enemyId,')
    < targetedMelee.indexOf('SendAuthoritativeHit(enemyId,'),
'Targeted PvE melee does not start its bounded presentation hold before the request');
const presentEnemyResult = combat.slice(combat.indexOf('private void PresentHitResult('),
  combat.indexOf('private void HandlePlayerHitResult('));
assert(presentEnemyResult.includes('Enemies.CompleteMeleePresentationHold(resolvedEnemyId);')
  && presentEnemyResult.indexOf('Enemies.CompleteMeleePresentationHold(resolvedEnemyId);')
    < presentEnemyResult.indexOf('Enemies.ApplyPublicEnemyHit(enemy,'),
'Authoritative melee result does not release the PvE target at contact');
assert(polish.includes('public void PlayConfirmedHit(')
  && polish.includes('impact.Scale = killed ? 1.6f : critical ? 1.35f : 1.16f;')
  && motion.includes('Mathf.Max(0.5f, fx.Scale)'),
'Polished VFX lost the stronger confirmed/critical/kill impact');
assert(fx.includes('Polish.PlayConfirmedHit(target, source, weaponId, critical, killed);'),
  'Fallback combat FX no longer delegates confirmed hits to the pooled presentation');
assert(audio.includes('BuildUiTone("HitConfirm"')
  && audio.includes('BuildUiTone("CriticalConfirm"')
  && audio.includes('Time.unscaledTime - _lastHitConfirmAt < 0.045f')
  && audio.includes('public bool CombatConfirmationCuesReady'),
'Confirmed hit audio is missing, chatters for cone attacks, or is not probed');

assert(probe.includes('RoaCombatConfirmation.Expired(0.39f, false)')
  && probe.includes('RoaCombat.MeleePresentationDelay(10f, 10.035f)')
  && probe.includes('RoaMeleeGrip.StrikeContactPhase')
  && probe.includes('RoaEnemies.ShouldDeferMeleeState(10f, 10.2f, 40, 20, false)')
  && probe.includes('holdProbe.MeleePresentationHoldCount == 1')
  && probe.includes('holdProbe.MeleePresentationHoldCount == 0')
  && probe.includes('RoaCombatFeedbackCanvas.EvaluateFloating(0.82f)')
  && probe.includes('ResolveFloatingStyle("КРИТ 42", false)')
  && probe.includes('FloatingStackOffset(1)')
  && probe.includes('feedback.InputTransparent')
  && probe.includes('accepted feedback did not project to a visible Canvas position')
  && probe.includes('feedback.FloatingPoolSize == floatingPool')
  && probe.includes('audio.CombatConfirmationCuesReady && audio.GeneratedClipCount == 32')
  && probe.includes('fx.ActiveImpactCount == 1')
  && probe.includes('[ПОДТВЕРЖДЕНИЕ ПОПАДАНИЯ] готово:'),
'Editor probe no longer covers Canvas motion, bounded pools, input transparency, audio and pooled impact');
assert(runner.includes('typeof(RoaCombatConfirmationProbe)'),
  'Combat confirmation probe is not included in the Unity audit');
for (const file of [
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombatConfirmation.cs.meta'],
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombatFeedbackCanvas.cs.meta'],
  ['unity-client', 'Assets', 'Editor', 'RoaCombatConfirmationProbe.cs.meta']
]) assert(/guid:\s*[0-9a-f]{32}/i.test(read(...file)), `${file.join('/')} has no GUID`);
assert(packageJson.scripts['check:unity-combat-confirmation'],
  'package.json has no narrow combat confirmation check');

console.log('Unity combat confirmation OK: contact-synchronized melee and bounded PvE target state plus authoritative Canvas marker/text/audio/impact, directional reaction and bounded pools');
