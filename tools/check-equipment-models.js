const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const modelFile = path.join(root, 'public', 'assets', 'models', 'equipment', 'service_scout_boots.glb');
const runtimeFile = path.join(root, 'public', 'js', 'game', '04a_player_model_modern_runtime.js');
const visualsFile = path.join(root, 'public', 'js', 'game', '04_player_model_visuals.js');

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', 'equipment model must be a GLB');
  assert.strictEqual(data.readUInt32LE(4), 2, 'equipment model must use glTF 2');
  assert.strictEqual(data.readUInt32LE(8), data.length, 'declared GLB length is stale');
  let offset = 12;
  let json = null;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trim());
    offset += 8 + chunkLength;
  }
  assert(json, 'equipment GLB has no JSON chunk');
  return { data, json };
}

assert(fs.existsSync(modelFile), 'service scout boot GLB is missing');
const { data, json } = parseGlb(modelFile);
assert(data.length < 1_500_000, `runtime boot model is too heavy: ${data.length} bytes`);
assert.strictEqual(json.scenes?.length, 1, 'runtime boot GLB must have one scene');
assert.strictEqual(json.nodes?.length, 2, 'runtime boot GLB must contain two optimized nodes');
assert.strictEqual(json.meshes?.length, 2, 'runtime boot GLB must contain two optimized meshes');
assert.deepStrictEqual(
  json.nodes.map(node => node.name).sort(),
  ['SERVICE_SCOUT_BOOT_L', 'SERVICE_SCOUT_BOOT_R'],
  'runtime boot side names changed'
);
json.nodes.forEach(node => assert(Number.isInteger(node.mesh), `${node.name} has no mesh`));
json.meshes.forEach(mesh => {
  assert(mesh.primitives?.length >= 8 && mesh.primitives.length <= 12, 'boot material primitives are missing or fragmented');
});
assert.strictEqual(json.images?.length, 3, 'embedded leather texture set must contain three images');
json.images.forEach(image => {
  assert(Number.isInteger(image.bufferView), 'equipment texture must be embedded in the GLB');
  assert(!image.uri, 'equipment texture must not use an external URI');
  assert.strictEqual(image.mimeType, 'image/png', 'equipment texture must use PNG');
});
assert((json.buffers || []).every(buffer => !buffer.uri), 'equipment GLB must not use an external buffer');

const materialNames = (json.materials || []).map(material => String(material.name || '').replace(/\.\d+$/, ''));
[
  'SSC_Canvas_Olive',
  'SSC_Canvas_Sun_Faded',
  'SSC_Leather_Dark',
  'SSC_Metal_Dull',
  'SSC_Lace_Dust',
  'SSC_Rubber_Black',
  'SSC_Rubber_Local_Dust',
  'SSC_Leather_Textured',
  'SSC_Leather_Strap'
].forEach(name => assert(materialNames.includes(name), `equipment material is missing: ${name}`));

const leatherMaterial = (json.materials || []).find(material => String(material.name || '').startsWith('SSC_Leather_Textured'));
assert(Number.isInteger(leatherMaterial?.pbrMetallicRoughness?.baseColorTexture?.index), 'leather base-color texture is missing');
assert(Number.isInteger(leatherMaterial?.pbrMetallicRoughness?.metallicRoughnessTexture?.index), 'leather roughness texture is missing');
assert(Number.isInteger(leatherMaterial?.normalTexture?.index), 'leather normal texture is missing');

const runtimeSource = fs.readFileSync(runtimeFile, 'utf8');
const visualsSource = fs.readFileSync(visualsFile, 'utf8');
[
  "const SERVICE_SCOUT_BOOT_MODEL_URL = '/assets/models/equipment/service_scout_boots.glb';",
  'function preloadServiceScoutBootModel()',
  'function installServiceScoutBootInstances(parts)',
  'function applyServiceScoutBootVisual(parts, bootsId = \'\')'
].forEach(marker => assert(runtimeSource.includes(marker), `service scout runtime integration is missing: ${marker}`));
assert(
  visualsSource.includes("applyServiceScoutBootVisual(parts, bootsOn ? bootsId : '')"),
  'equipment visual switch does not activate the GLB boots'
);

console.log(`Equipment models OK: 2 boot meshes, 3 embedded textures, ${data.length} bytes`);
