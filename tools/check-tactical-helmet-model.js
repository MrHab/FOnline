#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-tactical-helmet-v1', 'helmet');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'tactical_helmet_weathered_olive_composite',
  'tactical_helmet_exposed_composite_edge',
  'tactical_helmet_aged_black_polymer',
  'tactical_helmet_dusty_retention_webbing',
  'tactical_helmet_tarnished_hardware',
  'tactical_helmet_scratched_smoked_visor'
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
  return path.join(REVIEW_DIR, `equipment_tactical_helmet_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Tactical helmet ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 700_000, `${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 300_000, `${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 500_000, `${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_tactical_helmet_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'tacticalHelmet');
  assert.strictEqual(report.itemNameRu, 'Тактический шлем');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.deepStrictEqual(report.materials, REQUIRED_MATERIALS);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 1, `${bodyId} must use one helmet mesh`);
  assert.strictEqual(gltf.materials?.length, 6, `${bodyId} material count changed`);
  assert.strictEqual(gltf.textures?.length, 15, `${bodyId} embedded B+C wear texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  assert(report.actualGlb.triangles >= 1450 && report.actualGlb.triangles <= 1550,
    `${bodyId} triangle count is outside the reviewed range`);
  assert.strictEqual(report.metrics.headBoneWeight, 1, `${bodyId} must follow the head bone`);
  assert.strictEqual(report.metrics.railPointCount, 6, `${bodyId} side rail layout changed`);
  assert(report.metrics.visorBounds[2] > report.fit.headBounds.minimum[2] + 0.075,
    `${bodyId} visor hangs too low over the mouth`);
  assert(report.fit.highCutEarClearance >= 0.035,
    `${bodyId} shell no longer has the approved high-cut ear opening`);
  assert(report.fit.baseClearance.side >= 0.025 && report.fit.baseClearance.crown >= 0.020,
    `${bodyId} shell clearance is too small`);
  return report;
});

for (const file of [
  fileFor('male_medium', '_side.png'),
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_review.blend')
]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 700_000,
    `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  const summary = {
    schema: 'realm.equipment-tactical-helmet-review.v1',
    assetFamily: 'equipment_tactical_helmet_unified_v1',
    itemId: 'tacticalHelmet',
    itemNameRu: 'Тактический шлем',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Tactical helmet model OK: ${reports.length} fitted GLB variants, current 65-bone rig, closed compact visor and B+C materials.`);
