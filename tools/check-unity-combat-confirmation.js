'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const combat = read(game, 'RoaCombat.cs');
const confirmation = read(game, 'RoaCombatConfirmation.cs');
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
}
assert(enemyResult.includes('Enemies.ApplyPublicEnemyHit(enemy, sourcePosition, damage, critical)'),
  'NPC hit state loses source, damage or critical context');
assert(playerResult.includes('if (killed) Audio?.PlayKillConfirm();'),
  'PvP kill has no local kill confirmation');
assert(explosionResult.includes('FindResultRow(enemyHits, "enemyId"')
  && explosionResult.includes('Enemies.ApplyPublicEnemyHit(enemy, impactPosition,')
  && explosionResult.includes('if (selfHit) continue;')
  && explosionResult.includes('ConfirmHit(position, critical, killed);')
  && explosionResult.includes('out Vector3 resolvedEnemyPosition')
  && explosionResult.includes('out Vector3 resolvedPlayerPosition')
  && explosionResult.includes('if (confirmedTargets > 0) Audio?.PlayHitConfirm(anyCritical);'),
'Explosion hits lose authoritative NPC context, duplicate self-damage, or lack multi-target confirmation');
assert(combat.includes('HitConfirmationLimit = 12')
  && combat.includes('RoaCombatConfirmation.Expired(')
  && combat.includes('DrawMarkerCorner(')
  && combat.includes('Texture2D.whiteTexture'),
'Target marker queue is unbounded, not expired, or not rendered');

assert(enemies.includes('public void ApplyPublicEnemyHit(')
  && enemies.includes('enemy.CharacterView.PlayHit(hitSource, hitDamage, hitCritical);'),
'NPCs no longer receive an authoritative directional hit reaction');
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
  && probe.includes('audio.CombatConfirmationCuesReady && audio.GeneratedClipCount == 30')
  && probe.includes('fx.ActiveImpactCount == 1')
  && probe.includes('[ПОДТВЕРЖДЕНИЕ ПОПАДАНИЯ] готово:'),
'Editor probe no longer covers marker lifetime, generated audio and pooled impact');
assert(runner.includes('typeof(RoaCombatConfirmationProbe)'),
  'Combat confirmation probe is not included in the Unity audit');
for (const file of [
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaCombatConfirmation.cs.meta'],
  ['unity-client', 'Assets', 'Editor', 'RoaCombatConfirmationProbe.cs.meta']
]) assert(/guid:\s*[0-9a-f]{32}/i.test(read(...file)), `${file.join('/')} has no GUID`);
assert(packageJson.scripts['check:unity-combat-confirmation'],
  'package.json has no narrow combat confirmation check');

console.log('Unity combat confirmation OK: authoritative marker/audio/impact, directional NPC reaction and bounded pooled feedback');
