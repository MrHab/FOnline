#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-ballistic-vest-v1', 'vest');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'ballistic_vest_faded_olive_carrier',
  'ballistic_vest_charcoal_insert',
  'ballistic_vest_dusty_webbing',
  'ballistic_vest_oxidised_hardware',
  'ballistic_vest_faded_repair_cloth'
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
  return path.join(REVIEW_DIR, `equipment_ballistic_vest_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Ballistic vest ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 950_000, `Ballistic vest ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 800_000, `Ballistic vest ${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 1_000_000, `Ballistic vest ${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_ballistic_vest_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'ballisticVest');
  assert.strictEqual(report.slot, 'armor');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 2, `${bodyId} must contain carrier and equipment layers`);
  assert.strictEqual(gltf.materials?.length, 5, `${bodyId} material count changed`);
  assert.strictEqual(gltf.images?.length, 15, `${bodyId} embedded PBR texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of ['soft_carrier', 'plates_webbin']) {
    assert(nodeNames.some(name => name.includes(token)), `${bodyId} is missing ${token}`);
  }
  assert(report.actualGlb.triangles >= 5_000 && report.actualGlb.triangles <= 5_800,
    `${bodyId} triangle count is outside the reviewed range`);
  assert(report.fit.shellPolygons >= 2_000, `${bodyId} carrier coverage is incomplete`);
  assert.strictEqual(report.details.pouchCount, 3, `${bodyId} magazine pouch row changed`);
  assert.strictEqual(report.details.molleRows, 3, `${bodyId} MOLLE row count changed`);
  assert.strictEqual(report.details.shoulderAdjusters, 2, `${bodyId} shoulder adjustment is incomplete`);
  assert.strictEqual(report.details.dragHandle, true, `${bodyId} rear drag handle is missing`);
  assert(report.details.halfWidth > 0.17 && report.details.halfWidth < 0.27,
    `${bodyId} measured torso width is implausible`);
  return report;
});

for (const file of [
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_review.blend')
]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 900_000, `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  const summary = {
    schema: 'realm.equipment-ballistic-vest-review.v1',
    assetFamily: 'equipment_ballistic_vest_unified_v1',
    itemId: 'ballisticVest',
    itemNameRu: 'Бронежилет',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Ballistic vest model OK: ${reports.length} fitted GLB variants, 65-bone rig and B+C plate-carrier materials.`);
