const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelDirectory = path.join(root, 'public', 'assets', 'models', 'characters', 'base');
const manifestPath = path.join(modelDirectory, 'manifest.json');
const runtimePath = path.join(root, 'public', 'js', 'game', '04b_character_glb_runtime.js');
const creatorPath = path.join(root, 'public', 'js', 'game', '08_character_creation_save.js');
const updatePath = path.join(root, 'public', 'js', 'game', '09_update_fog_movement_ai.js');
const indexPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'server.js');
const expectedKeys = new Set([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);

function glbJson(buffer, fileName) {
  assert(buffer.length >= 20, `${fileName}: truncated GLB`);
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'glTF', `${fileName}: invalid GLB magic`);
  assert.strictEqual(buffer.readUInt32LE(4), 2, `${fileName}: GLB must use glTF 2.0`);
  const declaredLength = buffer.readUInt32LE(8);
  assert.strictEqual(declaredLength, buffer.length, `${fileName}: stale GLB byte length`);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert(chunkEnd <= buffer.length, `${fileName}: invalid GLB chunk length`);
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buffer.subarray(chunkStart, chunkEnd).toString('utf8').replace(/\0+$/g, ''));
    }
    offset = chunkEnd;
  }
  throw new Error(`${fileName}: missing JSON chunk`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.character-model-catalog.v1');
assert.strictEqual(manifest.source?.license, 'CC0-1.0');
assert.strictEqual(manifest.files?.length, expectedKeys.size);
assert(!Object.prototype.hasOwnProperty.call(manifest, 'generatedAt'), 'character manifest must be deterministic');

const actualKeys = new Set();
for (const row of manifest.files) {
  const key = `${row.sex}_${row.bodyType}`;
  assert(expectedKeys.has(key), `unexpected character combination: ${key}`);
  assert(!actualKeys.has(key), `duplicate character combination: ${key}`);
  actualKeys.add(key);

  const fileName = path.basename(String(row.file || ''));
  assert.strictEqual(fileName, `character_${key}.glb`, `${key}: non-canonical file name`);
  const filePath = path.join(modelDirectory, fileName);
  const buffer = fs.readFileSync(filePath);
  assert(buffer.length <= 5.5 * 1024 * 1024, `${fileName}: exceeds the browser asset budget`);
  assert.strictEqual(row.bytes, buffer.length, `${fileName}: manifest byte count is stale`);
  assert.strictEqual(
    row.sha256,
    crypto.createHash('sha256').update(buffer).digest('hex'),
    `${fileName}: manifest hash is stale`
  );

  const json = glbJson(buffer, fileName);
  assert.strictEqual(json.asset?.version, '2.0', `${fileName}: asset version is not glTF 2.0`);
  assert(Array.isArray(json.meshes) && json.meshes.length >= 1 && json.meshes.length <= 4, `${fileName}: invalid mesh count`);
  assert(Array.isArray(json.materials) && json.materials.length <= 4, `${fileName}: too many materials`);
  assert(Array.isArray(json.skins) && json.skins.length === 1, `${fileName}: expected one humanoid skin`);
  assert(json.skins[0].joints?.length >= 60, `${fileName}: incomplete humanoid rig`);
  const animations = new Set((json.animations || []).map(animation => String(animation.name || '').toLowerCase()));
  for (const animation of ['idle', 'walk', 'run']) {
    assert(animations.has(animation), `${fileName}: missing ${animation} animation`);
  }
}
assert.deepStrictEqual(actualKeys, expectedKeys);

const runtime = fs.readFileSync(runtimePath, 'utf8');
const creator = fs.readFileSync(creatorPath, 'utf8');
const update = fs.readFileSync(updatePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
assert(runtime.includes('/assets/models/characters/base/character_${characterAppearanceKey(input)}.glb'));
assert(runtime.includes('setCharacterCreationPreviewAppearance'));
assert(runtime.includes('applyCharacterGlbAppearance'));
for (const id of [
  'female_01', 'female_02', 'female_03',
  'male_01', 'male_02', 'male_03',
  'short_crop', 'tied_back', 'mohawk', 'shaved'
]) {
  assert(runtime.includes(`'${id}'`), `character appearance option is missing: ${id}`);
}
assert(runtime.includes('function applyCharacterGlbVisualVariants('));
assert(runtime.includes('function applyCharacterFaceShape('));
assert(runtime.includes('applyCharacterFaceShapeFrame(runtime.root);'));
assert(runtime.includes('applyCharacterFaceShapeFrame(characterPreviewState.model);'));
assert(runtime.includes('root.rotation.y = Math.PI;'), 'runtime GLB does not face the cursor direction');
assert(runtime.includes("canvas.addEventListener('pointermove'"), 'creator preview does not follow the cursor');
assert(update.includes('facePoint(pointerWorld.x, pointerWorld.z)'),
  'the local player does not face the world cursor');
assert(index.includes('id="creator-face-options"') && index.includes('id="creator-hair-options"'),
  'face or hairstyle controls are missing from character creation');
assert(creator.includes('creatorAppearance = { ...creatorAppearance, faceId: option.id }'));
assert(creator.includes('creatorAppearance = { ...creatorAppearance, hairId: option.id }'));

const server = fs.readFileSync(serverPath, 'utf8');
assert(server.includes("const SERVER_CHARACTER_SEXES = new Set(['female', 'male'])"));
assert(server.includes("const SERVER_CHARACTER_BODY_TYPES = new Set(['slim', 'medium', 'large'])"));
assert(server.includes("const SERVER_CHARACTER_HAIR_IDS = new Set(['short_crop', 'tied_back', 'mohawk', 'shaved'])"));
assert(server.includes('const faceId = defaults.faceIds.has(rawFaceId) ? rawFaceId : defaults.faceId;'));
assert(server.includes('const hairId = SERVER_CHARACTER_HAIR_IDS.has(rawHairId) ? rawHairId : defaults.hairId;'));
assert(server.includes('appearance: sanitizeCharacterAppearance(p.appearance || {})'));

console.log('Character models OK: 6 GLB bases, 6 faces, 4 hairstyles, cursor facing, rig/animations and hashes checked');
