#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'ground-item-library-v1');
const REVIEW_FILE = path.join(REVIEW_DIR, 'ground_item_library_bc_v1.glb');
const REVIEW_REPORT = path.join(REVIEW_DIR, 'technical-report.json');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'models', 'items');
const RUNTIME_FILE = path.join(RUNTIME_DIR, 'ground_item_library.glb');
const MANIFEST_FILE = path.join(RUNTIME_DIR, 'manifest.json');
const APPROVED_REVIEW_SHA256 = '03FF39155E05996809DF49223C77E29420656305B330D34DF942CA27013B12D4';
const ASSET_VERSION = '7.76.7-ground-items-bc-v1';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)}: неверная сигнатура GLB`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)}: требуется glTF 2`);
  let offset = 12;
  let json = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'JSON') {
      json = JSON.parse(data.subarray(offset + 8, offset + 8 + length).toString('utf8').trim());
    }
    offset += 8 + length;
  }
  assert(json, `${path.basename(file)}: отсутствует JSON-часть`);
  return json;
}

assert(fs.existsSync(REVIEW_FILE), 'Нет утверждённой Blender-GLB библиотеки предметов');
assert(fs.existsSync(REVIEW_REPORT), 'Нет технического отчёта библиотеки предметов');
const reviewHash = sha256(REVIEW_FILE);
assert.strictEqual(
  reviewHash,
  APPROVED_REVIEW_SHA256,
  'GLB библиотеки отличается от визуально проверенной версии; обновите утверждённый SHA осознанно'
);
const report = JSON.parse(fs.readFileSync(REVIEW_REPORT, 'utf8'));
assert.strictEqual(report.sha256, reviewHash, 'SHA в техническом отчёте не совпадает с GLB');
assert.strictEqual(report.style, 'geometry_b_materials_c', 'Ожидался утверждённый стиль B+C');
assert.strictEqual(report.itemIds.length, 24, 'В общей библиотеке должно быть 24 предмета');
const gltf = parseGlb(REVIEW_FILE);
const nodeNames = new Set((gltf.nodes || []).map(node => node.name));
report.itemIds.forEach(id => assert(nodeNames.has(`ground_item_${id}`), `Нет корня ground_item_${id}`));

fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.copyFileSync(REVIEW_FILE, RUNTIME_FILE);
const manifest = {
  schema: 'realm.ground-item-model-manifest.v1',
  assetVersion: ASSET_VERSION,
  style: 'geometry_b_materials_c',
  file: '/assets/models/items/ground_item_library.glb',
  sha256: sha256(RUNTIME_FILE),
  sourceReview: 'docs/art/reviews/ground-item-library-v1/ground_item_library_bc_v1.glb',
  itemIds: report.itemIds,
  totals: report.totals,
  materials: report.materials,
  embeddedTextureImages: report.embeddedTextureImages,
  textureSize: report.textureSize,
  reuse: {
    weapons: '/assets/models/weapons/manifest.json',
    equipment: '/assets/models/approved-humanoid-assets.json',
    bodyVariant: 'male_medium'
  }
};
fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(
  `Физические предметы опубликованы: ${manifest.itemIds.length} моделей, `
  + `${manifest.totals.triangles} треугольников, ${manifest.sha256}`
);
