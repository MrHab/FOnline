#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'priority-environment-v1');
const REPORT_FILE = path.join(REVIEW_DIR, 'technical-report.json');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const MANIFEST_FILE = path.join(RUNTIME_DIR, 'priority-environment-manifest.json');
const COLLIDER_BUILDER = path.join(ROOT, 'tools', 'build-model-colliders.js');
const ASSET_VERSION = '7.79.0-priority-environment-bc-v1';
const APPROVED = Object.freeze({
  car_wreck: { runtime: 'car_wreck.glb', sha256: 'ABDEA140AFCDD1C58C831AC5A3B34E70AB0ED2C160151A39D75B5BD59B5C0DCC' },
  dead_tree_a: { runtime: 'dead_tree_a.glb', sha256: '2DE3AAFEC17F5690180188FC20594C8481C465FD9F3A2E7FC8F5611450D2F3E4' },
  dead_tree_b: { runtime: 'dead_tree_b.glb', sha256: '6E792B12468B34E31332DED94AB2B1F8D48B5CD766097ABAC9BE71AB324D4C27' },
  dead_tree_c: { runtime: 'dead_tree_c.glb', sha256: '04A5B43AEBECFACCD86DA292DA851CCF76DD2BC8444B51D9E98E398B85331AFC' },
  dry_bush: { runtime: 'dry_bush.glb', sha256: '19E3FABA19C13565CBD382BF958230244E1A5E030A745277AB7FEE6335AAFDF9' },
  rubble_rock: { runtime: 'rubble_rock.glb', sha256: 'F15BDC751B8C9C0F6254DA7B7E7370C5875A2F368E43D2056ADB0E5C47289602' },
  scrap_heap: { runtime: 'scrap_heap.glb', sha256: '151BBA7FBEB0C5356A1BBC3681E717B94089F236BAC2D7D4C4A2ADEC5208FAC5' },
  wasteland_shack: { runtime: 'wasteland_shack.glb', sha256: 'FDB92773BC746486DF775A45A247D0B48BC914AD08155931A5BDCAE9D2791BBA' }
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

assert(fs.existsSync(REPORT_FILE), 'Нет технического отчёта приоритетного окружения');
const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
assert.strictEqual(report.schema, 'realm.priority-environment-report.v1');
assert.strictEqual(report.style, 'geometry_b_materials_c');
assert.deepStrictEqual(Object.keys(report.models), Object.keys(APPROVED));

const manifestModels = {};
for (const [modelId, approval] of Object.entries(APPROVED)) {
  const review = report.models[modelId];
  const reviewFile = path.join(REVIEW_DIR, review.file);
  assert(fs.existsSync(reviewFile), `Нет ревью-GLB ${review.file}`);
  assert.strictEqual(sha256(reviewFile), approval.sha256, `${modelId}: изменился утверждённый SHA`);
  assert.strictEqual(review.sha256, approval.sha256, `${modelId}: отчёт не совпадает с GLB`);
  const runtimeFile = path.join(RUNTIME_DIR, approval.runtime);
  fs.copyFileSync(reviewFile, runtimeFile);
  manifestModels[modelId] = {
    file: `/assets/models/wasteland/${approval.runtime}`,
    sha256: sha256(runtimeFile),
    meshes: review.meshes,
    vertices: review.vertices,
    triangles: review.triangles,
    sizeMetres: review.sizeMetres
  };
}

const manifest = {
  schema: 'realm.priority-environment-manifest.v1',
  assetVersion: ASSET_VERSION,
  style: 'geometry_b_materials_c',
  sourceReview: 'docs/art/reviews/priority-environment-v1',
  models: manifestModels,
  totals: report.totals
};
fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const colliderResult = spawnSync(process.execPath, [COLLIDER_BUILDER], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit'
});
if (colliderResult.status !== 0) process.exit(colliderResult.status || 1);
console.log(
  `Приоритетное окружение опубликовано: ${Object.keys(APPROVED).length} GLB, `
  + `${report.totals.triangles} треугольников.`
);
