'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const editor = path.join('unity-client', 'Assets', 'Editor');

const motion = read(game, 'RoaNetworkActorMotion.cs');
const remotes = read(game, 'RoaRemotePlayers.cs');
const enemies = read(game, 'RoaEnemies.cs');
const socket = read('unity-client', 'Assets', 'Scripts', 'Net', 'RoaSocketClient.cs');
const probe = read(editor, 'RoaNetworkActorMotionProbe.cs');
const runner = read(editor, 'RoaClientAuditRunner.cs');

assert(motion.includes('public static float OneWayLatencySeconds')
  && motion.includes('pingMs * 0.0005f')
  && motion.includes('maxExtrapolationSeconds) * 0.5f')
  && motion.includes('public static Vector3 PredictPosition')
  && motion.includes('Mathf.Clamp(secondsSincePacket, 0f')
  && motion.includes('public static Sample Step(')
  && motion.includes('Vector3.SmoothDamp(currentPosition, predicted')
  && motion.includes('AdaptiveSmoothTime(baseSmoothTime, error, safeSnapDistance)')
  && motion.includes('PresentationSpeedLimit(networkVelocity)')
  && motion.includes('maxVisibleStep = speedLimit * dt')
  && motion.includes('if (error >= safeSnapDistance)')
  && motion.includes('Vector3 snapVelocity = networkMoving ? networkVelocity : Vector3.zero;')
  && motion.includes('VisualVelocity = snapVelocity')
  && motion.includes('Moving = snapSpeed >= PresentationMoveSpeed')
  && motion.includes('Moving = visualSpeed >= PresentationMoveSpeed'),
  'Shared actor motion lost bounded prediction, adaptive correction, teleport snap or displayed velocity');

for (const [name, source] of [['remote players', remotes], ['enemies', enemies]]) {
  assert(source.includes('RoaNetworkActorMotion.Step(')
    && (source.includes('PresentationVelocity = motion.VisualVelocity;')
      || (source.includes('PresentationVelocity = motionLocked || contactConstrained')
        && source.includes('? Vector3.zero : motion.VisualVelocity;')))
    && source.includes('PresentationMoving = motion.Moving')
    && source.includes('RoaNetworkActorMotion.OneWayLatencySeconds(')
    && source.includes('Socket != null ? Socket.PingMs : -1f')
    && source.includes('motion.Snapped')
    && !source.includes('TargetPosition +=')
    && !source.includes('Vector3.SmoothDamp(t.position'),
    `${name} bypass the shared time-based network presenter`);
  assert(source.includes('UpdateLocomotion(')
    && source.includes('PresentationVelocity')
    && source.includes('TrackActor(ref')
    && source.includes('PresentationMoving'),
    `${name} animation or footsteps still use stale packet velocity`);
}
assert(enemies.includes('CombatMotionLocked(enemy.Dead, enemy.ThreatActive,')
  && enemies.includes('enemy.ActionUntil, enemy.ReactionUntil, Time.time)')
  && enemies.includes('ResolvePresentationContact(presentedPosition,')
  && enemies.includes('t.position, motionLocked ? t.position : enemy.TargetPosition,')
  && enemies.includes('if (contactConstrained) enemy.SmoothVelocity = Vector3.zero;')
  && enemies.includes('enemy.PresentationMoving = motion.Moving && !motionLocked'),
  'enemy contact/action constraints no longer wrap the shared motion sample');

assert(remotes.includes('movement.Seq <= remote.LastSeq')
  && socket.includes('if (frame.Seq <= _lastEnemyFrameSeq) return;'),
  'Out-of-order movement packets are no longer rejected before presentation');
assert(enemies.includes('enemy.Root.transform.position = enemy.TargetPosition;')
  && enemies.includes('enemy.SmoothVelocity = Vector3.zero;')
  && enemies.includes('public float MaxExtrapolationSeconds = 0.22f;')
  && enemies.includes('Mathf.Min(MaxExtrapolationSeconds, 0.22f)')
  && enemies.includes('RoaCharacterView.ResolveCombatPresentationPhase(')
  && enemies.includes('CombatPresentationPhase.Idle ? "idle"'),
  'Enemy death, melee stop prediction, or non-humanoid clips can still slide against their visible position');

assert(probe.includes('OneWayLatencySeconds(160f, 0.25f)')
  && probe.includes('cappedLatency - 0.125f')
  && probe.includes('PredictPosition(')
  && probe.includes('teleport.Snapped')
  && probe.includes('movingTeleport.Snapped && movingTeleport.Moving')
  && probe.includes('movingTeleport.VisualVelocity.z - 4f')
  && probe.includes('stopCorrection.Moving')
  && probe.includes('nearTeleport.VisualVelocity.magnitude <= 5.51f')
  && probe.includes('Simulate(30)')
  && probe.includes('Simulate(120)')
  && probe.includes('!at30.Moving && !at120.Moving'),
  'Editor probe does not cover capped loss, stop correction, teleport and FPS invariance');
assert(runner.includes('typeof(RoaNetworkActorMotionProbe)'),
  'Network actor motion probe is not part of the batch Unity audit');

for (const file of [
  path.join(game, 'RoaNetworkActorMotion.cs.meta'),
  path.join(editor, 'RoaNetworkActorMotionProbe.cs.meta')
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(file)), `${file} has no valid GUID`);
}

console.log('Unity network actors OK: bounded prediction, adaptive catch-up, motion-preserving snap and animation from displayed motion');
