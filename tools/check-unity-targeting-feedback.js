'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const feedback = read(game, 'RoaTargetingFeedback.cs');
const combat = read(game, 'RoaCombat.cs');
const mobile = read(game, 'RoaMobileControls.cs');
const nameplates = read(game, 'RoaActorNameplates.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaTargetingFeedbackProbe.cs');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const packageJson = JSON.parse(read('package.json'));

assert(feedback.includes('public static Frame Evaluate(')
  && feedback.includes('Status.OutOfRange')
  && feedback.includes('Status.Blocked')
  && feedback.includes('frame.Label = "ЛИНИЯ ПЕРЕКРЫТА";')
  && feedback.includes('frame.Label = "ВНЕ ДАЛЬНОСТИ";'),
'Target feedback no longer distinguishes ready, blocked and out-of-range shots');
assert(feedback.includes('_ring = CreateLine("TargetRing"')
  && feedback.includes('_trajectory = CreateLine("TargetTrajectory"')
  && feedback.includes('SetVisible(false, false);'),
'World target ring or exact trajectory preview is missing or cannot hide');

const resolverIndex = combat.indexOf('TryResolvePrimaryTarget(cursor, out string resolvedEnemyId');
const fallbackIndex = combat.indexOf('TryFindTargetUnderCursor(hoverRay');
assert(resolverIndex >= 0 && fallbackIndex > resolverIndex,
'Desktop preview does not use the real shot resolver before model-hover fallback');
assert(combat.includes('TryResolvePrimaryTarget(_mobileAimPosition')
  && combat.includes('public void SetMobileAimTarget(')
  && combat.includes('RoaTargetingFeedback.Evaluate(Time.unscaledTime')
  && combat.includes('Player.View.FireObstructed')
  && combat.includes('AttackLineBlocked(_hoverPosition, targetScale)')
  && combat.includes('? new Color(1f, 0.176f, 0.122f, 1f) : frame.Color;'),
'Combat preview is disconnected from mobile selection, barrel collision or line blocking');

assert(mobile.includes('_combat?.SetMobileAimTarget(_selectedId, position);')
  && mobile.includes('_combat?.ClearMobileAimTarget();')
  && !mobile.includes('MobileTargetRing')
  && !mobile.includes('EnsureTargetRing'),
'Mobile controls still render a second target ring that can disagree with combat');
assert(nameplates.includes('Combat.TryGetTargetDisplay(out _, out label, out color)')
  && nameplates.includes('_hintChance.text = label;')
  && nameplates.includes('_hintChance.color = color;'),
'Cursor hint does not explain blocked/range state from the common target preview');

assert(probe.includes('blocked.TrajectoryAlpha > high.TrajectoryAlpha')
  && probe.includes('view.ActiveRendererCount == 2')
  && probe.includes('[ПРИЦЕЛ] готово:'),
'Editor probe no longer covers target quality, trajectory and cleanup');
assert(runner.includes('typeof(RoaTargetingFeedbackProbe)'),
'Targeting feedback probe is not included in the Unity client audit');
for (const file of [
  ['unity-client', 'Assets', 'Scripts', 'Game', 'RoaTargetingFeedback.cs.meta'],
  ['unity-client', 'Assets', 'Editor', 'RoaTargetingFeedbackProbe.cs.meta']
]) assert(/guid:\s*[0-9a-f]{32}/i.test(read(...file)), `${file.join('/')} has no GUID`);
assert(packageJson.scripts['check:unity-targeting-feedback'],
'package.json has no narrow Unity targeting feedback check');

console.log('Unity targeting feedback OK: one resolver drives desktop/mobile target, trajectory, range and obstruction states');
