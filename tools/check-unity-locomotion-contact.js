'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const editor = path.join('unity-client', 'Assets', 'Editor');

const resolver = read(game, 'RoaLocomotionPresentation.cs');
const controller = read(game, 'RoaPlayerController.cs');
const character = read(game, 'RoaCharacterView.cs');
const pose = read(game, 'RoaCharacterPose.cs');
const audio = read(game, 'RoaAudio.cs');
const probe = read(editor, 'RoaLocomotionContactProbe.cs');
const runner = read(editor, 'RoaClientAuditRunner.cs');

assert(resolver.includes('public static float ContactPressure')
  && resolver.includes('public static Vector3 ResolveCollisionVelocity')
  && resolver.includes('Vector3.ProjectOnPlane(requestedVelocity, collisionNormal)')
  && resolver.includes('return slide.normalized * actualSpeed;'),
  'Collision-resolved visual velocity no longer follows the requested wall tangent');
assert(resolver.includes('public static Vector3 SmoothVisualVelocity')
  && resolver.includes('return target / targetSpeed * nextSpeed;')
  && resolver.includes('Mathf.MoveTowards(previousSpeed, targetSpeed'),
  'Visual locomotion must smooth speed without blending through the old direction');

assert(controller.includes('_requestedVelocity = requestedVelocity;')
  && controller.includes('pressure > _collisionPressure')
  && controller.includes('ResolveCollisionVelocity(')
  && controller.includes('SmoothVisualVelocity(')
  && controller.includes('_collisionNormal, _collisionPressure)')
  && !controller.includes('Vector3.MoveTowards(_visualVelocity, actual'),
  'Player controller no longer selects the strongest contact or uses resolved presentation motion');
assert(character.includes('Vector3 collisionNormal = default(Vector3)')
  && character.includes('float contactWeight = Mathf.Clamp01(collisionPressure);')
  && character.includes('contactWeight, contactForward, contactSide'),
  'Character view no longer maps world contact into the facing-relative pose');
assert(pose.includes('public float ContactPressure')
  && pose.includes('contactTarget * 0.022f')
  && pose.includes('float contactForward = _contactForward * _contactPressure;')
  && pose.includes('contactSide * 0.026f'),
  'Procedural pose lost contact compression or directional body response');
assert(audio.includes('bool grounded, bool crouching, bool moving)')
  && audio.includes('_locomotionActive = moving;')
  && audio.includes('!_locomotionActive || !_grounded'),
  'Local footsteps are no longer gated by actual collision-resolved movement');

assert(probe.includes('Vector3.back * 4f')
  && probe.includes('ResolveCollisionVelocity(')
  && probe.includes('pose.KneeFlex > 0.03f')
  && probe.includes('spine01.localRotation'),
  'Editor probe does not cover reversal, wall slide, foot IK compression and body response');
assert(runner.includes('typeof(RoaLocomotionContactProbe)'),
  'Locomotion contact probe is not part of the batch Unity audit');

for (const file of [
  path.join(game, 'RoaLocomotionPresentation.cs.meta'),
  path.join(editor, 'RoaLocomotionContactProbe.cs.meta')
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(file)), `${file} has no valid GUID`);
}

console.log('Unity locomotion contact OK: instant direction sync, stable wall slide, strongest contact, body compression and exact footstep stop');
