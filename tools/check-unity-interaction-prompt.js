'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const hud = read(game, 'RoaHudCanvas.cs');
const prompt = read(game, 'RoaHudInteractionPrompt.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaHudInteractionPromptProbe.cs');

assert(hud.includes('public sealed partial class RoaHudCanvas')
  && hud.includes('BuildInteractionPrompt();')
  && hud.includes('RefreshInteractionPrompt(worldHud);')
  && hud.includes('ApplyInteractionPromptLayout(mobile);'),
  'Adaptive HUD is not connected to the persistent interaction prompt');
assert(!hud.includes('if (hint != _lastHint)'),
  'Interaction hint still expires inside the transient system log');
assert(prompt.includes('public static void FormatInteractionPrompt')
  && prompt.includes('mobile ? "ДЕЙСТВИЕ" : "E"')
  && prompt.includes('Time.unscaledDeltaTime * 8f'),
  'Interaction prompt lost desktop/mobile formatting or its pause-safe fade');
assert(prompt.includes('background.raycastTarget = false;')
  && prompt.includes('_interactionPromptGroup.blocksRaycasts = false;')
  && prompt.includes('_interactionPromptGroup.interactable = false;'),
  'Interaction prompt may block world input');
assert(prompt.includes('mobile ? 302f : 216f')
  && prompt.includes('mobile ? 0.86f : 1f'),
  'Interaction prompt no longer adapts around the mobile HUD');
assert(probe.includes('[ПОДСКАЗКА ВЗАИМОДЕЙСТВИЯ] готово')
  && probe.includes('interaction prompt blocks gameplay input'),
  'Unity editor probe does not cover prompt input safety');

for (const file of [
  'RoaHudInteractionPrompt.cs.meta'
]) {
  assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(read(game, file)),
    `${file} has invalid metadata`);
}
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Editor', 'RoaHudInteractionPromptProbe.cs.meta')),
  'RoaHudInteractionPromptProbe.cs.meta has invalid metadata');

console.log('Unity interaction prompt OK: persistent context, mobile wording, pause-safe fade and input transparency');
