#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MANIFEST_FILE = path.join(MODELS_DIR, 'priority-environment-manifest.json');
const COLLIDER_FILE = path.join(MODELS_DIR, 'model-colliders.json');
const STATIC_RUNTIME = path.join(ROOT, 'public', 'js', 'game', '02a_materials_static_models.js');
const GENERIC_BUILDER = path.join(ROOT, 'tools', 'build-wasteland-models.js');
const EXPECTED_IDS = [
  'car_wreck', 'dead_tree_a', 'dead_tree_b', 'dead_tree_c',
  'dry_bush', 'rubble_rock', 'scrap_heap', 'wasteland_shack'
];
const EXPECTED_TOTALS = { meshes: 194, vertices: 4082, triangles: 7164 };

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: неверная сигнатура`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)}: требуется glTF 2`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').trim());
    if (type === 'BIN\0') binary = chunk;
    offset += 8 + length;
  }
  assert(json && binary, `${path.basename(file)}: отсутствует JSON или BIN`);
  return { data, json, binary };
}

assert(fs.existsSync(MANIFEST_FILE), 'Нет манифеста приоритетного окружения');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
assert.strictEqual(manifest.schema, 'realm.priority-environment-manifest.v1');
assert.strictEqual(manifest.assetVersion, '7.79.0-priority-environment-bc-v1');
assert.strictEqual(manifest.style, 'geometry_b_materials_c');
assert.deepStrictEqual(Object.keys(manifest.models), EXPECTED_IDS);
assert.deepStrictEqual(manifest.totals, EXPECTED_TOTALS);

let meshes = 0;
let triangles = 0;
for (const [modelId, entry] of Object.entries(manifest.models)) {
  const file = path.join(ROOT, 'public', entry.file.replace(/^\//, ''));
  const parsed = parseGlb(file);
  assert.strictEqual(sha256(parsed.data), entry.sha256, `${modelId}: SHA runtime-GLB не совпадает`);
  const root = (parsed.json.nodes || []).find(node => node.extras?.realm_model_id === modelId);
  assert(root, `${modelId}: нет корня с realm_model_id`);
  assert.strictEqual(root.extras.realm_style, 'geometry_b_materials_c', `${modelId}: неверный стиль`);
  assert((parsed.json.materials || []).length >= 2, `${modelId}: недостаточно материалов`);
  assert((parsed.json.images || []).length >= 6, `${modelId}: нет встроенных C-текстур`);
  for (const image of parsed.json.images || []) {
    const view = parsed.json.bufferViews?.[image.bufferView];
    assert(view, `${modelId}: нет bufferView текстуры`);
    const bytes = parsed.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    assert.strictEqual(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${modelId}: ожидалась PNG`);
    assert.strictEqual(bytes.readUInt32BE(16), 128, `${modelId}: ширина текстуры не 128`);
    assert.strictEqual(bytes.readUInt32BE(20), 128, `${modelId}: высота текстуры не 128`);
  }
  meshes += Number(entry.meshes || 0);
  for (const mesh of parsed.json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      triangles += Number(parsed.json.accessors?.[primitive.indices]?.count || 0) / 3;
    }
  }
}
assert.strictEqual(meshes, EXPECTED_TOTALS.meshes, 'Изменилось число исходных мешей');
assert.strictEqual(triangles, EXPECTED_TOTALS.triangles, 'Изменилась утверждённая триангуляция');

const colliders = JSON.parse(fs.readFileSync(COLLIDER_FILE, 'utf8'));
for (const entry of Object.values(manifest.models)) {
  const fileName = path.basename(entry.file);
  assert(colliders.models?.[fileName], `${fileName}: не пересобран каталог коллайдеров`);
}

const runtime = fs.readFileSync(STATIC_RUNTIME, 'utf8');
[
  "const PRIORITY_ENVIRONMENT_GLB_ASSET_VERSION = '7.79.0-priority-environment-bc-v1'",
  'PRIORITY_ENVIRONMENT_STATIC_MODEL_KEYS.has(key)',
  "carWreck: '/assets/models/wasteland/car_wreck.glb'",
  "wastelandShack: '/assets/models/wasteland/wasteland_shack.glb'",
  "dryBush: '/assets/models/wasteland/dry_bush.glb'"
].forEach(marker => assert(runtime.includes(marker), `Нет runtime-маркера: ${marker}`));

const genericBuilder = fs.readFileSync(GENERIC_BUILDER, 'utf8');
assert(genericBuilder.includes('APPROVED_PRIORITY_ENVIRONMENT_FILES'), 'Общий генератор может затереть утверждённые модели');
assert(genericBuilder.includes('build-priority-environment-models.js'), 'Нет понятного маршрута публикации утверждённых моделей');

console.log(
  `Приоритетное окружение OK: ${EXPECTED_IDS.length} GLB, `
  + `${EXPECTED_TOTALS.meshes} меша, ${EXPECTED_TOTALS.triangles} треугольника.`
);
