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

// Окно повышенного рождения после выброса: сервер присылает остаток и во
// сколько раз шанс выше, панель сдвига это показывает.
const serverSource = read('server.js');
for (const token of [
  'fieldsExcited,',
  'fieldsExcitedSeconds: fieldsExcited ? Math.max(0, Math.round((excitedUntil - now) / 1000)) : 0,',
  'fieldsChanceMultiplier: baseChance > 0 ? Number((chance / baseChance).toFixed(2)) : 1,'
]) assert(serverSource.includes(token), `server.js must publish the excited fields window: ${token}`);
for (const token of [
  'public static string ShiftLine(JObject shift)',
  // Ранний прогноз сдвига от жителей и клановой базы виден в тихую фазу.
  'shift["earlyWarning"]',
  'СДВИГ СКОРО',
  'ПОЛЯ АКТИВНЫ: ещё ',
  'shift["fieldsChanceMultiplier"]'
]) assert(detector.includes(token), `The shift panel must show the excited fields: ${token}`);

// Предварительное определение находки: сервер шлёт тир (Mk2) и вид (Mk3) в
// самом сигнале, панель детектора обязана их показывать — решение «идти или
// нет» принимается до подбора.
// Постоянной панели детектора в клиенте нет, поэтому предварительное
// определение находки живёт в подсказке подбора — той строке, которой находку
// и поднимают.
for (const token of [
  'public static string PickupHintText(string key, int tier, string tierColor, string displayName)',
  'public string PickupHint'
]) assert(detector.includes(token), `The detector must offer a pickup hint: ${token}`);
const hudPrompt = read('unity-client/Assets/Scripts/Game/RoaHudInteractionPrompt.cs');
assert(hudPrompt.includes('string pickup = _artifacts.PickupHint;'),
  'The HUD prompt must prefer the find under the feet.');
assert(read('unity-client/Assets/Scripts/Game/RoaGameBootstrap.cs').includes('HudCanvas.SetArtifactSource(ShiftAndDetector);'),
  'The bootstrap must give the HUD its artifact source.');

for (const token of [
  'RoaGearData.TierShortLabel(tier)',
  'view.Tier = row["tier"]?.Value<int>() ?? 0;',
  'view.DisplayName = row["displayName"]?.ToString() ?? string.Empty;'
]) assert(detector.includes(token), `The detector must keep the pre-pickup identification: ${token}`);
// Панели детектора и пояса в клиенте нет: их мёртвые поля и форматтеры убраны,
// а данные живут в подсказке подбора и в ПУТНИКе.
for (const token of ['_detectorText', '_effectsText', '_artifactRecordText', 'FormatEffects', 'DetectorReadout'])
  assert(!detector.includes(token), `The ghost detector panel must stay removed: ${token}`);
const spawns = read('src/server/artifact-spawns.js');
for (const token of [
  'typeId: visible && detector.identifiesBeforePickup ? artifact.typeId :',
  'tier: tier ? tier.tier : 0,'
]) assert(spawns.includes(token), `The server must send the pre-pickup identification: ${token}`);

console.log('Unity Kromka artifacts OK: inventory slots visible, permanent detector/artifact HUD absent.');
