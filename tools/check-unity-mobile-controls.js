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
assert((canvas.match(/CreateButton\("/g) || []).length === 12
  && canvas.includes('CreateDiscTexture()')
  && canvas.includes('back.raycastTarget = true')
  && canvas.includes('icon.raycastTarget = false')
  && canvas.includes('_joystickOuterImage.raycastTarget'),
  'Mobile Canvas no longer has twelve bounded buttons or correct raycast ownership');
assert(canvas.includes('SetLabel("Target", state.TargetSelected ? "ЦЕЛЬ ✓" : "ЦЕЛЬ")')
  && canvas.includes('SetLabel("Crouch", state.Crouching ? "ВСТАТЬ" : "ПРИСЕСТЬ")')
  && canvas.includes('SetLabel("Player", state.PingAvailable ? "МЕТКА" : "ИГРОК")')
  && canvas.includes('SetLabel("Bolt", state.BoltAiming ? "ОТМЕНА" : "БОЛТ")')
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
  'TriggerPlayerPanel', 'TriggerPlayerOrPing', 'TriggerInteract'
]) {
  assert(controls.includes(`public void ${action}(`), `Mobile action is not shared: ${action}`);
}

assert(bootstrap.includes('gameObject.AddComponent<RoaMobileControlsCanvas>()')
  && bootstrap.includes('mobileCanvas.Configure(MobileControls, BoltThrower);')
  && bootstrap.includes('MobileControls.CanvasDriven = true;'),
  'Bootstrap does not activate the mobile Canvas and gate the old IMGUI path');

// Кнопки сумки, ПУТНИКа и игрока обязаны открывать канву терминала. Если они снова
// начнут дёргать только IMGUI-панели (в бою те выключены флагом CanvasDriven), на
// телефоне пропадут HUD, движение и сам слой кнопок, а выхода не будет: Esc там нет.
assert(controls.includes('public void SetTerminal(RoaPipboyCanvas terminal)')
  && controls.includes('private RoaPipboyCanvas _terminal;'),
  'Mobile controls no longer hold the ПУТНИК canvas that actually renders');
for (const [action, page] of [
  ['TriggerInventory', 'Items'], ['TriggerPipboy', 'Status'], ['TriggerPlayerPanel', 'Friends']
]) {
  const body = controls.slice(controls.indexOf(`public void ${action}(`));
  const scope = body.slice(0, body.indexOf('\n        }'));
  assert(scope.includes(`ToggleTerminalPage(RoaPipboyCanvas.Page.${page}`),
    `Mobile ${action} must open the ПУТНИК canvas page ${page}, not a hidden IMGUI panel`);
}
assert(controls.includes('private bool TerminalOpen')
  && /private bool IsPanelOpen\(\)\s*\{\s*return DialogueOpen\(\) \|\| TerminalOpen/.test(controls),
  'Mobile panel state ignores the ПУТНИК canvas: stick and fire would stay live under it');
assert(bootstrap.includes('MobileControls.SetTerminal(PipboyCanvas);'),
  'Bootstrap does not wire the ПУТНИК canvas into the touch buttons');
assert(read(game, 'RoaPipboyCanvas.cs').includes('dimButton.onClick.AddListener(Close);'),
  'ПУТНИК has no large tap-outside exit: on a phone the × shrinks with the frame');

assert(probe.includes('mobile Canvas control leaves the device safe area')
  && probe.includes('left shortcut rail can no longer steal the floating joystick finger')
  && probe.includes('mobile Canvas pointer-down does not start held fire')
  && probe.includes('suppressed mobile input does not collapse to one clear close action')
  && probe.includes('hidden mobile Canvas leaves held fire latched')
  && probe.includes('mobile contextual player button does not open activity pings'),
  'Unity mobile probe does not cover safe layout, live states and held input cleanup');
assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, 'RoaMobileControlsCanvas.cs.meta')),
  'RoaMobileControlsCanvas.cs.meta has no valid GUID');

console.log('Unity mobile controls OK: safe-area uGUI, 12 touch targets, held fire, bolt tool, floating stick and panel-aware states');
