const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const bootsDir = path.join(root, 'public', 'assets', 'models', 'equipment', 'boots');
const legacyModelFile = path.join(root, 'public', 'assets', 'models', 'equipment', 'service_scout_boots.glb');
const approvedRuntimeFile = path.join(root, 'public', 'js', 'game', '04d_approved_humanoid_assets_runtime.js');
const modernRuntimeFile = path.join(root, 'public', 'js', 'game', '04a_player_model_modern_runtime.js');
const visualsFile = path.join(root, 'public', 'js', 'game', '04_player_model_visuals.js');
const unityEquipmentFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaEquipmentView.cs');
const unityCharacterFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterView.cs');
const unityInventoryFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaInventory.cs');
const unityRemotesFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaRemotePlayers.cs');
const bodyIds = [
  'female_slim', 'female_medium', 'female_large',
  'male_slim', 'male_medium', 'male_large'
];

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)} must be a GLB`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)} must use glTF 2`);
  assert.strictEqual(data.readUInt32LE(8), data.length, `${path.basename(file)} has stale declared length`);
  let offset = 12;
  let json = null;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    offset += 8 + chunkLength;
  }
  assert(json, `${path.basename(file)} has no JSON chunk`);
  return { data, json };
}

let totalBytes = 0;
bodyIds.forEach(bodyId => {
  const file = path.join(bootsDir, `equipment_scout_boots_${bodyId}.glb`);
  assert(fs.existsSync(file), `approved scout boots are missing for ${bodyId}`);
  const { data, json } = parseGlb(file);
  totalBytes += data.length;
  assert(data.length < 1_500_000, `approved scout boots are too heavy for ${bodyId}: ${data.length} bytes`);
  assert((json.scenes || []).length >= 1, `${bodyId} scout boots have no scene`);
  assert((json.nodes || []).some(node => Number.isInteger(node.mesh)), `${bodyId} scout boots have no mesh nodes`);
  assert((json.meshes || []).length >= 1, `${bodyId} scout boots have no meshes`);
  assert((json.buffers || []).every(buffer => !buffer.uri), `${bodyId} scout boots use an external buffer`);
});

assert(!fs.existsSync(legacyModelFile),
  'obsolete one-size service_scout_boots.glb returned; use the six approved body-fitted GLBs');

const approvedRuntimeSource = fs.readFileSync(approvedRuntimeFile, 'utf8');
const modernRuntimeSource = fs.readFileSync(modernRuntimeFile, 'utf8');
const visualsSource = fs.readFileSync(visualsFile, 'utf8');
const unityEquipmentSource = fs.readFileSync(unityEquipmentFile, 'utf8');
const unityCharacterSource = fs.readFileSync(unityCharacterFile, 'utf8');
const unityInventorySource = fs.readFileSync(unityInventoryFile, 'utf8');
const unityRemotesSource = fs.readFileSync(unityRemotesFile, 'utf8');
[
  'const APPROVED_EQUIPMENT_ASSETS = Object.freeze({',
  'scoutBoots: Object.freeze({',
  "itemId: 'scoutBoots'",
  "slot: 'boots'",
  "urls: approvedEquipmentBodyUrls('boots', 'equipment_scout_boots')",
  'function loadApprovedEquipmentTemplate(',
  'function applyApprovedEquipmentSlot('
].forEach(marker => assert(approvedRuntimeSource.includes(marker),
  `approved scout-boot runtime integration is missing: ${marker}`));
assert(
  visualsSource.includes('refreshCharacterGlbEquipmentLayers(actor, eq)'),
  'equipment visual switch does not reach the approved GLB equipment loader'
);
[
  'SERVICE_SCOUT_BOOT_MODEL_URL',
  'preloadServiceScoutBootModel',
  'installServiceScoutBootInstances',
  'applyServiceScoutBootVisual'
].forEach(marker => assert(!modernRuntimeSource.includes(marker) && !visualsSource.includes(marker),
  `legacy one-size scout-boot runtime returned: ${marker}`));

[
  'state.BodyKey == bodyKey && state.CharacterRoot == characterRoot',
  'private void ScheduleRetry(',
  'private async Task RetrySlotLater(',
  'state.CharacterRoot == root'
].forEach(marker => assert(unityEquipmentSource.includes(marker),
  `Unity equipment ownership/retry guard is missing: ${marker}`));
[
  'public int LoadedEquipmentSlotCount',
  'public bool AnyHairVisible',
  'private bool LoadIsCurrent(int request)'
].forEach(marker => assert(unityCharacterSource.includes(marker),
  `Unity character/equipment lifecycle integration is missing: ${marker}`));
assert(unityInventorySource.includes('public bool SubmitEquipmentAction('),
  'Unity inventory no longer exposes the authoritative equipment action path');
assert(unityInventorySource.includes('Equip(slot, string.Empty);'),
  'Unity unequip must clear the runtime id so the server can resolve the built-in fists state');
assert(!unityInventorySource.includes('Equip(slot, slot == "weapon" ? "fists" : string.Empty);'),
  'Unity unequip regressed to requesting a physical fists runtime instance');
assert(unityRemotesSource.includes('public void CollectCharacterViews('),
  'Unity remote-player equipment inspection path is missing');

console.log(`Equipment models OK: 6 body-fitted scout-boot GLBs, ${totalBytes} bytes total; Unity owner/retry guards present`);
