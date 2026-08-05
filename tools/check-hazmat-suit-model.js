#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-hazmat-suit-v1', 'suit');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'hazmat_faded_mustard_canvas',
  'hazmat_aged_black_rubber',
  'hazmat_oxidized_filter_metal',
  'hazmat_scratched_smoke_visor',
  'hazmat_dusty_olive_repairs',
  'hazmat_faded_warning_panel'
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
  return path.join(REVIEW_DIR, `equipment_hazmat_suit_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Hazmat ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 800_000, `Hazmat ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 2_500_000, `Hazmat ${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 4_500_000, `Hazmat ${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_hazmat_suit_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'hazmatSuit');
  assert.strictEqual(report.itemNameRu, 'Костюм химзащиты');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.deepStrictEqual(report.materials, REQUIRED_MATERIALS);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 3, `${bodyId} must contain liner, shell and authored details`);
  assert.strictEqual(gltf.materials?.length, 6, `${bodyId} material count changed`);
  assert.strictEqual(gltf.textures?.length, 6, `${bodyId} embedded wear texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of ['inner_seal', 'sealed_shell', 'sealed_details']) {
    assert(nodeNames.some(name => name.includes(token)), `${bodyId} is missing ${token}`);
  }
  assert(report.actualGlb.triangles >= 25_000 && report.actualGlb.triangles <= 32_000,
    `${bodyId} triangle count is outside the reviewed range`);
  assert(report.fit.shellPolygons >= 17_000, `${bodyId} shell coverage is incomplete`);
  assert(report.fit.rubberMaterialPolygons >= 3_000, `${bodyId} gloves or oversocks are incomplete`);
  assert(report.fit.detailPolygons >= 560, `${bodyId} authored protective details are incomplete`);
  assert(report.fit.headRadii.every(value => value > 0.10 && value < 0.19), `${bodyId} hood fit is implausible`);
  return report;
});

const maleMediumExtras = [
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_review.blend')
];
for (const file of maleMediumExtras) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 800_000, `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  const summaryFile = path.join(REVIEW_DIR, 'fit-report-all.json');
  const summary = {
    schema: 'realm.equipment-hazmat-review.v1',
    assetFamily: 'equipment_hazmat_suit_unified_v1',
    itemId: 'hazmatSuit',
    itemNameRu: 'Костюм химзащиты',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Hazmat suit model OK: ${reports.length} fitted GLB variants, 65-bone rig, sealed liner, hood, visor and B+C wear.`);
