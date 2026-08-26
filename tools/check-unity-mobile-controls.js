#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const controls = read(game, 'RoaMobileControls.cs');
const canvas = read(game, 'RoaMobileControlsCanvas.cs');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaMobileControlsProbe.cs');

assert(canvas.includes('public sealed class RoaMobileControlsCanvas')
  && canvas.includes('typeof(CanvasScaler), typeof(GraphicRaycaster)')
  && canvas.includes('RoaUiScale.Apply(canvasRoot.GetComponent<CanvasScaler>())')
  && canvas.includes('Screen.safeArea')
  && canvas.includes('public static Layout CalculateLayout('),
  'Adaptive safe-area mobile uGUI Canvas is incomplete');
assert((canvas.match(/CreateButton\("/g) || []).length === 11
  && canvas.includes('CreateDiscTexture()')
  && canvas.includes('back.raycastTarget = true')
  && canvas.includes('icon.raycastTarget = false')
  && canvas.includes('_joystickOuterImage.raycastTarget'),
  'Mobile Canvas no longer has eleven bounded buttons or correct raycast ownership');
assert(canvas.includes('SetLabel("Target", state.TargetSelected ? "ЦЕЛЬ ✓" : "ЦЕЛЬ")')
  && canvas.includes('SetLabel("Crouch", state.Crouching ? "ВСТАТЬ" : "ПРИСЕСТЬ")')
  && canvas.includes('state.FireMode.ToUpperInvariant()')
  && canvas.includes('state.InputSuppressed ? "ЗАКРЫТЬ" : "МЕНЮ"')
  && canvas.includes('bool joystickVisible = _gameplayButtonsVisible && state.JoystickActive;'),
  'Mobile Canvas lost readable live state or panel conflict handling');
assert(canvas.includes('IPointerDownHandler')
  && canvas.includes('IPointerUpHandler')
  && canvas.includes('IPointerExitHandler')
  && canvas.includes('held => Controls?.SetFireHeld(held)')
  && canvas.includes('Controls?.SetFireHeld(false);'),
  'Held fire can remain latched or no longer follows pointer lifecycle');

assert(controls.includes('public bool CanvasDriven { get; set; }')
  && controls.includes('if (CanvasDriven) return;')
  && controls.includes('if (_fireHeld || (!CanvasDriven && TouchHeld(')
  && controls.includes('public void SetFireHeld(bool held)')
  && controls.includes('public bool TryGetJoystickVisual(')
  && controls.includes('IsJoystickStart(gui, Screen.width, Screen.height, Screen.safeArea)')
  && controls.includes('!layout.SafeArea.Contains(screenPoint)')
  && controls.includes('layout.Map.Contains(screenPoint)'),
  'Gameplay controller is not safely delegated from IMGUI to the mobile Canvas');
for (const action of [
  'TriggerMenu', 'TriggerInventory', 'TriggerPipboy', 'TriggerMap',
  'TriggerTargetCycle', 'TriggerCrouch', 'TriggerReload', 'TriggerFireMode',
  'TriggerPlayerPanel', 'TriggerInteract'
]) {
  assert(controls.includes(`public void ${action}(`), `Mobile action is not shared: ${action}`);
}

assert(bootstrap.includes('gameObject.AddComponent<RoaMobileControlsCanvas>()')
  && bootstrap.includes('mobileCanvas.Configure(MobileControls);')
  && bootstrap.includes('MobileControls.CanvasDriven = true;'),
  'Bootstrap does not activate the mobile Canvas and gate the old IMGUI path');
assert(probe.includes('mobile Canvas control leaves the device safe area')
  && probe.includes('left shortcut rail can no longer steal the floating joystick finger')
  && probe.includes('mobile Canvas pointer-down does not start held fire')
  && probe.includes('suppressed mobile input does not collapse to one clear close action')
  && probe.includes('hidden mobile Canvas leaves held fire latched'),
  'Unity mobile probe does not cover safe layout, live states and held input cleanup');
assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, 'RoaMobileControlsCanvas.cs.meta')),
  'RoaMobileControlsCanvas.cs.meta has no valid GUID');

console.log('Unity mobile controls OK: safe-area uGUI, 11 touch targets, held fire, floating stick and panel-aware states');
