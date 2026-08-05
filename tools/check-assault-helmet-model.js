#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-assault-helmet-v1', 'helmet');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'assault_helmet_weathered_graphite_composite',
  'assault_helmet_exposed_laminate_edge',
  'assault_helmet_aged_black_polymer',
  'assault_helmet_dusty_retention_webbing',
  'assault_helmet_tarnished_hardware',
  'assault_helmet_laminated_amber_visor'
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
  return path.join(REVIEW_DIR, `equipment_assault_helmet_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Assault helmet ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 750_000, `${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 330_000, `${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 500_000, `${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_assault_helmet_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'assaultHelmet');
  assert.strictEqual(report.itemNameRu, 'Штурмовой шлем');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.deepStrictEqual(report.materials, REQUIRED_MATERIALS);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 2, `${bodyId} must contain shell and impact armour meshes`);
  assert.strictEqual(gltf.materials?.length, 6, `${bodyId} material count changed`);
  assert.strictEqual(gltf.textures?.length, 15, `${bodyId} embedded B+C wear texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  assert(report.actualGlb.triangles >= 1800 && report.actualGlb.triangles <= 1900,
    `${bodyId} triangle count is outside the reviewed range`);
  assert.strictEqual(report.metrics.headBoneWeight, 1, `${bodyId} must follow the head bone`);
  assert.strictEqual(report.metrics.cheekPanelCount, 2, `${bodyId} must have two cheek panels`);
  assert.strictEqual(report.metrics.earPodCount, 2, `${bodyId} must have two ear modules`);
  assert.strictEqual(report.metrics.mouthOpeningPreserved, true, `${bodyId} mouth opening was blocked`);
  assert(report.metrics.detailPolygons >= 160, `${bodyId} impact armour is incomplete`);
  assert(report.fit.armoredVisorBottomAboveHeadMinimum >= 0.080,
    `${bodyId} visor hangs too low over the mouth`);
  assert(report.fit.baseClearance.side >= 0.030 && report.fit.baseClearance.crown >= 0.025,
    `${bodyId} heavy shell clearance is too small`);
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  assert(nodeNames.some(name => name.includes('_face_and_')),
    `${bodyId} is missing the authored face armour node`);
  return report;
});

for (const file of [
  fileFor('male_medium', '_side.png'),
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_review.blend')
]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 750_000,
    `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  const summary = {
    schema: 'realm.equipment-assault-helmet-review.v1',
    assetFamily: 'equipment_assault_helmet_unified_v1',
    itemId: 'assaultHelmet',
    itemNameRu: 'Штурмовой шлем',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Assault helmet model OK: ${reports.length} fitted GLB variants, reinforced open-mouth face armour and current 65-bone rig.`);
