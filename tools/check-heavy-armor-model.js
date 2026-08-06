#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-heavy-armor-v1', 'armor');
const BODY_IDS = Object.freeze(['female_slim', 'female_medium', 'female_large', 'male_slim', 'male_medium', 'male_large']);
const REQUIRED_MATERIALS = Object.freeze([
  'heavy_armor_black_padded_underlayer',
  'heavy_armor_worn_gunmetal',
  'heavy_armor_olive_composite_inserts',
  'heavy_armor_aged_webbing',
  'heavy_armor_oxidised_hardware',
  'heavy_armor_faded_hazard_repair'
]);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', `${path.basename(file)} is not a GLB`);
  assert.strictEqual(data.readUInt32LE(4), 2, `${path.basename(file)} is not glTF 2`);
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8').replace(/\0+$/g, '').trim());
}

function fileFor(bodyId, suffix) {
  return path.join(REVIEW_DIR, `equipment_heavy_armor_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Heavy armor ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 900_000, `Heavy armor ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 1_150_000 && fs.statSync(glbFile).size < 1_400_000,
    `Heavy armor ${bodyId} GLB is outside the reviewed budget`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_heavy_armor_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'heavyArmor');
  assert.strictEqual(report.slot, 'armor');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.strictEqual(gltf.skins?.length, 1);
  assert.strictEqual(gltf.skins[0].joints?.length, 65);
  assert.strictEqual(gltf.meshes?.length, 2);
  assert.strictEqual(gltf.materials?.length, 6);
  assert.strictEqual(gltf.images?.length, 18);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of ['black_padded_und', 'layered_heavy_pl']) {
    assert(nodeNames.some(name => name.includes(token)), `${bodyId} is missing ${token}`);
  }
  assert(report.actualGlb.triangles >= 9_200 && report.actualGlb.triangles <= 9_800);
  assert(report.fit.shellPolygons >= 4_500);
  assert.strictEqual(report.details.abdominalLames, 3);
  assert.strictEqual(report.details.fauldPanels, 3);
  assert.strictEqual(report.details.spineRails, 2);
  assert.strictEqual(report.details.armGuards, 4);
  assert.strictEqual(report.details.thighGuards.length, 2);
  assert(report.details.halfWidth > 0.19 && report.details.halfWidth < 0.30);
  return report;
});

for (const file of [fileFor('male_medium', '_back.png'), fileFor('male_medium', '_detail.png'), fileFor('male_medium', '_review.blend')]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 900_000, `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify({
    schema: 'realm.equipment-heavy-armor-review.v1',
    assetFamily: 'equipment_heavy_armor_unified_v1',
    itemId: 'heavyArmor',
    itemNameRu: 'Тяжёлая броня',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  }, null, 2)}\n`, 'utf8');
}

console.log(`Heavy armor model OK: ${reports.length} fitted GLB variants, 65-bone rig and B+C layered heavy protection.`);
