#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-metal-armor-v1', 'armor');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'metal_armour_charcoal_padding',
  'metal_armour_worn_steel',
  'metal_armour_oxidised_edges',
  'metal_armour_aged_straps'
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
  return path.join(REVIEW_DIR, `equipment_metal_armor_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Metal armor ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 900_000, `Metal armor ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 850_000, `Metal armor ${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 1_100_000, `Metal armor ${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_metal_armor_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'metalArmor');
  assert.strictEqual(report.slot, 'armor');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 2, `${bodyId} must contain the padded liner and plate layer`);
  assert.strictEqual(gltf.materials?.length, 4, `${bodyId} material count changed`);
  assert.strictEqual(gltf.images?.length, 12, `${bodyId} embedded PBR texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of ['padded_liner', 'plates']) {
    assert(nodeNames.some(name => name.includes(token)), `${bodyId} is missing ${token}`);
  }
  assert(report.actualGlb.triangles >= 7_500 && report.actualGlb.triangles <= 8_500,
    `${bodyId} triangle count is outside the reviewed range`);
  assert(report.fit.shellPolygons >= 4_500, `${bodyId} padded liner coverage is incomplete`);
  assert.strictEqual(report.details.abdominalLames, 3, `${bodyId} abdominal articulation changed`);
  assert.strictEqual(report.details.measuredArmPieces, 4, `${bodyId} arm protection is incomplete`);
  assert.strictEqual(report.details.rivetCount, 9, `${bodyId} readable fastener count changed`);
  assert(report.details.halfWidth > 0.18 && report.details.halfWidth < 0.28,
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
    schema: 'realm.equipment-metal-armor-review.v1',
    assetFamily: 'equipment_metal_armor_unified_v1',
    itemId: 'metalArmor',
    itemNameRu: 'Металлическая броня',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Metal armor model OK: ${reports.length} fitted GLB variants, 65-bone rig and B+C worn steel materials.`);
