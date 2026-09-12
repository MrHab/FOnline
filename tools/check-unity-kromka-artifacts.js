'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const detector = read('unity-client/Assets/Scripts/Game/RoaKromkaShiftAndDetector.cs');
const bootstrap = read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs');
const controller = read('unity-client/Assets/Scripts/Game/RoaPlayerController.cs');
const inventory = read('unity-client/Assets/Scripts/Game/RoaInventory.cs');
const inventoryCanvas = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');

for (const token of ['OnArtifactState', 'requestArtifactState', 'pickupArtifact', 'ShiftWarning'])
  assert(detector.includes(token), `Detector presentation is missing ${token}.`);
for (const retiredHud of ['"KromkaShiftDetectorCanvas"', '"ArtifactComparison"', '"ArtifactEffects"', '"DetectorText"'])
  assert(!detector.includes(retiredHud), `Permanent gameplay HUD leaked back in: ${retiredHud}.`);
assert(bootstrap.includes('ShiftAndDetector.Configure(this, Socket)'), 'Bootstrap must configure the Shift/detector presentation.');
assert(controller.includes('artifactSpeedMultiplier'), 'Artifact speed must reach local locomotion.');
assert(inventory.includes('"detector"') && inventory.includes('"artifactBelt"'), 'Detector and belt need dedicated equipment slots.');
assert(inventoryCanvas.includes('{ "weapon", "armor", "boots", "detector" }')
  && inventoryCanvas.includes('{ "offhand", "helmet", "backpack", "artifactBelt" }')
  && inventoryCanvas.includes('"Детектор"') && inventoryCanvas.includes('"Арт-пояс"'),
  'The visible inventory does not expose detector and artifact-belt equipment slots.');
assert(socket.includes('OnArtifactState?.Invoke(payload)'), 'Artifact state must be routed from the socket.');

console.log('Unity Kromka artifacts OK: inventory slots visible, permanent detector/artifact HUD absent.');
