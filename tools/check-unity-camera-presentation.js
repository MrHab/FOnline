'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const rig = read(game, 'RoaCameraRig.cs');
const presentation = read(game, 'RoaCameraRig.Presentation.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaCameraPresentationProbe.cs');
const cameraProbe = read('unity-client', 'Assets', 'Editor', 'RoaCameraProbe.cs');
const globalMap = read(game, 'RoaGlobalMap.cs');
const scene = read('unity-client', 'Assets', 'Scenes', 'Wasteland.unity');

assert(rig.includes('public sealed partial class RoaCameraRig')
  && rig.includes('UpdatePresentationTarget(Target, orbit, out teleported)')
  && rig.includes('EvaluateShakeOffset(orbit, impulse, Time.unscaledTime)')
  && rig.includes('EvaluateShakeRotation(impulse, Time.unscaledTime)'),
  'Camera rig is not connected to the live presentation layer');
assert(rig.includes('public const float DefaultGameplayDistance = 11.5f;')
  && rig.includes('public const float MaximumGameplayDistance = 21.5f;')
  && rig.includes('public const float GameplayFieldOfView = 52f;')
  && rig.includes('private const string ZoomPrefsKey = "roa.cameraDistance.v4";')
  && rig.includes('private const string PreviousZoomPrefsKey = "roa.cameraDistance.v3";')
  && rig.includes('PreviousDefaultGameplayDistance = 13.5f')
  && rig.includes('stored = DefaultGameplayDistance;')
  && rig.includes('SetFieldOfView(GameplayFieldOfView);')
  && rig.includes('ProjectedActorScreenFraction('),
  'Local tactical camera no longer guarantees a readable actor size or migrates old zoom');
assert(globalMap.includes('_savedFieldOfView = CameraRig.CurrentFieldOfView;')
  && globalMap.includes('CameraRig.SetFieldOfView(RoaCameraRig.StrategicFieldOfView);')
  && globalMap.includes('CameraRig.SetFieldOfView(_savedFieldOfView);'),
  'Global map no longer preserves its independent strategic field of view');
assert(globalMap.includes('public const float StrategicDefaultPitchDeg = 55f;')
  && globalMap.includes('public const float StrategicDefaultYawDeg = 45f;')
  && globalMap.includes('public const float StrategicMinimumPitchDeg = 38f;')
  && globalMap.includes('public const float StrategicMaximumPitchDeg = 82f;')
  && globalMap.includes('public static Vector2 StrategicCameraOrbit(')
  && globalMap.includes('CameraRig.PitchDeg = StrategicDefaultPitchDeg;')
  && globalMap.includes('CameraRig.YawDeg = StrategicDefaultYawDeg;')
  && globalMap.includes('_savedPitch = CameraRig.PitchDeg;')
  && globalMap.includes('_savedYaw = CameraRig.YawDeg;')
  && globalMap.includes('CameraRig.PitchDeg = _savedPitch;')
  && globalMap.includes('CameraRig.YawDeg = _savedYaw;')
  && cameraProbe.includes('orbit=55/45+MMB'),
  'Global map no longer starts at its angled view or safely clamps and restores middle-button orbit');
assert(globalMap.includes('private bool UpdateKeyboardCameraPan()')
  && globalMap.includes('Input.GetKey(KeyCode.W)')
  && globalMap.includes('Input.GetKey(KeyCode.A)')
  && globalMap.includes('Input.GetKey(KeyCode.S)')
  && globalMap.includes('Input.GetKey(KeyCode.D)')
  && globalMap.includes('KeyboardCameraPanMovement(input, CameraRig.Distance,')
  && globalMap.includes('ApplyCameraPanDelta(RightMousePanDelta(delta));')
  && globalMap.includes('return new Vector2(pointerDelta.x, -pointerDelta.y);')
  && globalMap.includes('CameraRig.MinDistance = StrategicMinimumCameraDistance(span);')
  && globalMap.includes('CameraRig.MaxDistance = StrategicMaximumCameraDistance(span);')
  && cameraProbe.includes('WASD=camera-relative')
  && cameraProbe.includes('RMB=Y-inverted')
  && cameraProbe.includes('mapZoom=18–150'),
  'Global map lost camera-relative WASD, vertical-only RMB inversion or its closer safe zoom');
assert(scene.includes('  Distance: 11.5')
  && scene.includes('  MaxDistance: 21.5')
  && scene.includes('  field of view: 52')
  && cameraProbe.includes('farActorFraction > 0.045f')
  && cameraProbe.includes('defaultActorFraction > 0.085f')
  && cameraProbe.includes('zoom=8–21.5, distance=11.5, fov=52'),
  'Authored scene or Unity probe no longer enforces the tactical camera framing');
assert(rig.includes('Mathf.Infinity, Time.unscaledDeltaTime')
  && rig.includes('if (teleported) _velocity = Vector3.zero;')
  && rig.includes('ResetPresentationState(Target.position);'),
  'Camera smoothing is not pause-safe or teleport-safe');

assert(presentation.includes('MovementLookAhead = 1.35f')
  && presentation.includes('CursorLookAhead = 1.65f')
  && presentation.includes('MaximumFramingOffset = 2.35f')
  && presentation.includes('Vector3.ClampMagnitude(wanted'),
  'Bounded movement/cursor framing is incomplete');
assert(presentation.includes('CalculateMovementLookAhead(')
  && presentation.includes('CalculateCursorLookAhead(')
  && presentation.includes('ShouldSnapForTargetDelta(')
  && presentation.includes('ZoomPersistenceEnabled && !RoaGameBootstrap.BlocksWorldHud'),
  'Camera framing rules no longer isolate local gameplay and menus');
assert(presentation.includes('strength *= strength;')
  && presentation.includes('time * 71f')
  && presentation.includes('time * 43f')
  && presentation.includes('Quaternion.Euler(pitch, 0f, roll)'),
  'Camera impulse is no longer a layered quadratic shake');

assert(probe.includes('movement=1.35m, cursor=1.65m, teleport=7.5m, snap=14m')
  && probe.includes('SnapToTarget no longer preserves the authored orbit distance')
  && probe.includes('teleport guard must ignore height'),
  'Unity camera probe does not cover framing, snap and teleport behavior');

for (const file of [
  'RoaCameraRig.Presentation.cs.meta'
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, file)), `${file} has no valid GUID`);
}
assert(/guid:\s*[0-9a-f]{32}/i.test(read('unity-client', 'Assets', 'Editor', 'RoaCameraPresentationProbe.cs.meta')),
  'RoaCameraPresentationProbe.cs.meta has no valid GUID');

console.log('Unity camera presentation OK: movement/cursor framing, teleport snap and layered impulse');
