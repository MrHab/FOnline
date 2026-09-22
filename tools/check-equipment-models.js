const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const bootsDir = path.join(root, 'public', 'assets', 'models', 'equipment', 'boots');
const legacyModelFile = path.join(root, 'public', 'assets', 'models', 'equipment', 'service_scout_boots.glb');
const unityEquipmentFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaEquipmentView.cs');
const unityCharacterFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterView.cs');
const unityInventoryFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaInventory.cs');
const unityRemotesFile = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaRemotePlayers.cs');
// Телосложения больше нет: у каждого пола одна базовая модель.
const bodyIds = ['female_medium', 'male_medium'];

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
  'obsolete one-size service_scout_boots.glb returned; use the approved body-fitted GLBs');

const unityEquipmentSource = fs.readFileSync(unityEquipmentFile, 'utf8');
const unityCharacterSource = fs.readFileSync(unityCharacterFile, 'utf8');
const unityInventorySource = fs.readFileSync(unityInventoryFile, 'utf8');
const unityRemotesSource = fs.readFileSync(unityRemotesFile, 'utf8');
// Unity composes /assets/models/equipment/boots/equipment_scout_boots_<body>.glb
// from this definition, i.e. exactly the body-fitted GLBs checked above.
[
  '{ "scoutBoots", new Definition("boots", "equipment_scout_boots") }',
  '"/assets/models/equipment/" + slot + "/" + definition.Prefix + "_" + bodyKey + ".glb"'
].forEach(marker => assert(unityEquipmentSource.includes(marker),
  `Unity approved scout-boot integration is missing: ${marker}`));
assert(!unityEquipmentSource.includes('service_scout_boots'),
  'legacy one-size scout-boot model returned to the Unity equipment view');

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
const unityTerminalSource = fs.readFileSync(
  path.join(root, "unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs"), 'utf8');
assert(unityTerminalSource.includes('Inventory.SubmitEquipmentAction(slot, string.Empty, ack =>'),
  'Unity unequip must clear the runtime id so the server can resolve the built-in fists state');
assert(!unityInventorySource.includes('Equip(slot, slot == "weapon" ? "fists" : string.Empty);'),
  'Unity unequip regressed to requesting a physical fists runtime instance');
assert(unityRemotesSource.includes('public void CollectCharacterViews('),
  'Unity remote-player equipment inspection path is missing');

console.log(`Equipment models OK: ${bodyIds.length} body-fitted scout-boot GLBs, ${totalBytes} bytes total; Unity owner/retry guards present`);
