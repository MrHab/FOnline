const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelDirectory = path.join(root, 'public', 'assets', 'models', 'characters', 'base');
const manifestPath = path.join(modelDirectory, 'manifest.json');
const unityCreatorPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterCreator.cs');
const unityCharacterViewPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterView.cs');
const serverPath = path.join(root, 'server.js');
// Телосложения не выбираются, поэтому база ровно одна на пол: всё остальное
// было недостижимой загрузкой (RoaCharacterView.ModelKey → "<sex>_medium").
const expectedKeys = new Set([
  'female_medium',
  'male_medium'
]);
const expectedHair = {
  female: ['shaved', 'tied_back'],
  male: ['shaved', 'short_crop']
};
const expectedHairCatalog = ['shaved', 'short_crop', 'tied_back'];
const legacyServerHair = [
  ...expectedHairCatalog,
  'side_swept',
  'mohawk',
  'braids',
  'long',
  'buns'
];
const expectedHairColors = [
  ['hair_01', '#1A1512'],
  ['hair_02', '#2A1B16'],
  ['hair_03', '#4B3023'],
  ['hair_04', '#6B452A'],
  ['hair_05', '#8A6040'],
  ['hair_06', '#A27A4B'],
  ['hair_07', '#7B7D76'],
  ['hair_08', '#5B2922']
];

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
  const nodeNames = new Set((json.nodes || []).map(node => String(node.name || '').toLowerCase()));
  assert(nodeNames.has('face_eyes'), `${fileName}: separate animated eye mesh is missing`);
  assert(nodeNames.has('face_eyebrows'), `${fileName}: separate animated eyebrow mesh is missing`);
  const authoredHairNodes = (json.nodes || []).filter(node => (
    String(node.extras?.realm_character_layer || '').toLowerCase() === 'hair'
  ));
  const expectedHairNode = row.sex === 'female' ? 'hair_tied_back' : 'hair_short_crop';
  assert.deepStrictEqual(
    authoredHairNodes.map(node => String(node.name || '').toLowerCase()),
    [expectedHairNode],
    `${fileName}: authored hair node drifted`
  );
  const animations = new Set((json.animations || []).map(animation => String(animation.name || '').toLowerCase()));
  for (const animation of ['idle', 'walk', 'run']) {
    assert(animations.has(animation), `${fileName}: missing ${animation} animation`);
  }
}
assert.deepStrictEqual(actualKeys, expectedKeys);

// Ни одного лишнего тела на диске: вариантов телосложения больше нет, и они не
// должны вернуться мимо манифеста мёртвым весом для WebGL-сборки.
assert.deepStrictEqual(
  fs.readdirSync(modelDirectory).filter(name => name.endsWith('.glb')).sort(),
  [...expectedKeys].map(key => `character_${key}.glb`).sort(),
  'unreachable character body GLBs are back in the base directory'
);

// Unity owns character appearance: RoaCharacterCreator offers the catalog and
// RoaCharacterView loads the canonical base GLB, hides authored hair and tints it.
const unityCreator = fs.readFileSync(unityCreatorPath, 'utf8');
const unityCharacterView = fs.readFileSync(unityCharacterViewPath, 'utf8');
assert(unityCharacterView.includes('"/assets/models/characters/base/character_" + key + ".glb"'),
  'Unity no longer loads the canonical character GLB bases');
assert(unityCharacterView.includes('bool showHair = !covered && hairId != "shaved";'),
  'authored GLB hair visibility is missing');

function unityStringList(source, declaration) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `Unity appearance catalog is missing: ${declaration}`);
  const open = source.indexOf('{', start);
  return Array.from(source.slice(open, source.indexOf('}', open)).matchAll(/"([^"]+)"/g), match => match[1]);
}

function unityHairHex(source, declaration) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `Unity hair color table is missing: ${declaration}`);
  const body = source.slice(start, source.indexOf(';', start));
  const hexes = new Map(Array.from(
    body.matchAll(/id == "(hair_\d+)" \? "(#[0-9A-Fa-f]{6})"/g),
    match => [match[1], match[2].toUpperCase()]
  ));
  const fallback = body.match(/:\s*"(#[0-9A-Fa-f]{6})"\s*$/)?.[1]?.toUpperCase();
  return id => hexes.get(id) || fallback;
}

// Телосложение и форма лица не выбираются: игра запрашивает одну базу на пол.
assert(unityCharacterView.includes('return sex + "_medium";'),
  'Unity must load one base model per sex');
assert(!unityCreator.includes('BodyIds') && !unityCreator.includes('FaceSuffixes'),
  'the creator must not offer body builds or face shapes again');
const unityHair = unityCreator
  .slice(unityCreator.indexOf('private static string[] HairIds(string sex)'))
  .match(/sex == "female"\s*\?\s*new\[\]\s*\{([^}]*)\}\s*:\s*new\[\]\s*\{([^}]*)\}/);
assert(unityHair, 'Unity creator no longer limits hairstyles by sex');
const unityHairBySex = {
  female: Array.from(unityHair[1].matchAll(/"([^"]+)"/g), match => match[1]),
  male: Array.from(unityHair[2].matchAll(/"([^"]+)"/g), match => match[1])
};
for (const sex of ['female', 'male']) {
  assert.deepStrictEqual(unityHairBySex[sex], expectedHair[sex],
    `${sex}: sex-compatible hairstyle catalog drifted`);
}
assert.deepStrictEqual(
  [...new Set([...unityHairBySex.female, ...unityHairBySex.male])].sort(),
  expectedHairCatalog,
  'authored hairstyle catalog drifted'
);
assert.deepStrictEqual(unityStringList(unityCreator, 'HairColorIds ='), expectedHairColors.map(([id]) => id),
  'hair color catalog drifted');
const creatorHairHex = unityHairHex(unityCreator, 'public static Color HairColorSwatch(');
const viewHairHex = unityHairHex(unityCharacterView, 'private static Color HairColor(string id)');
for (const [id, hex] of expectedHairColors) {
  assert.strictEqual(creatorHairHex(id), hex, `${id}: creator hair swatch drifted`);
  assert.strictEqual(viewHairHex(id), hex, `${id}: in-game hair tint drifted`);
}

const server = fs.readFileSync(serverPath, 'utf8');
assert(server.includes("const SERVER_CHARACTER_SEXES = new Set(['female', 'male'])"));
assert(!server.includes('SERVER_CHARACTER_BODY_TYPES') && !server.includes('faceIds'),
  'the server must not validate body builds or face shapes again');
for (const id of [
  ...legacyServerHair,
  ...expectedHairColors.map(([id]) => id)
]) {
  assert(server.includes(`'${id}'`), `server appearance allowlist is missing: ${id}`);
}
assert(server.includes('const hairId = SERVER_CHARACTER_HAIR_IDS.has(rawHairId) ? rawHairId : defaults.hairId;'));
assert(server.includes('const hairColorId = SERVER_CHARACTER_HAIR_COLOR_IDS.has(rawHairColorId) ? rawHairColorId'));
assert(server.includes('appearance: sanitizeCharacterAppearance(p.appearance || {})'));

console.log(
  'Character models OK: 2 GLB bases in the catalog (one per sex, exactly what the game asks for), '
  + '2 sex-compatible hairstyles each, 8 hair colors in the Unity creator/view and server '
  + 'allowlist, authored GLB hair visibility/tinting, rig/animations and hashes checked'
);
