#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-energy-suit-v1', 'suit');
const BODY_IDS = Object.freeze([
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
]);
const REQUIRED_MATERIALS = Object.freeze([
  'energy_suit_weathered_graphite_composite',
  'energy_suit_aged_charcoal_insulation',
  'energy_suit_tarnished_copper_channels',
  'energy_suit_cyan_field_glass',
  'energy_suit_chipped_blue_ceramic',
  'energy_suit_oxidized_service_patch'
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
  return path.join(REVIEW_DIR, `equipment_energy_suit_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const frontRender = fileFor(bodyId, '_front.png');
  for (const file of [glbFile, reportFile, frontRender]) {
    assert(fs.existsSync(file), `Energy suit ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(frontRender).size > 800_000, `Energy suit ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 2_500_000, `Energy suit ${bodyId} GLB is unexpectedly small`);
  assert(fs.statSync(glbFile).size < 4_000_000, `Energy suit ${bodyId} GLB exceeds the review budget`);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_energy_suit_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'energySuit');
  assert.strictEqual(report.itemNameRu, 'Энергозащитный костюм');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.deepStrictEqual(report.materials, REQUIRED_MATERIALS);
  assert.strictEqual(gltf.skins?.length, 1, `${bodyId} must use one player skin`);
  assert.strictEqual(gltf.skins[0].joints?.length, 65, `${bodyId} must use the current 65-bone rig`);
  assert.strictEqual(gltf.meshes?.length, 3, `${bodyId} must contain liner, shell and field details`);
  assert.strictEqual(gltf.materials?.length, 6, `${bodyId} material count changed`);
  assert.strictEqual(gltf.textures?.length, 6, `${bodyId} embedded wear texture count changed`);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of ['inner_seal', 'sealed_shell', 'field_details']) {
    assert(nodeNames.some(name => name.includes(token)), `${bodyId} is missing ${token}`);
  }
  assert(report.actualGlb.triangles >= 25_000 && report.actualGlb.triangles <= 30_000,
    `${bodyId} triangle count is outside the reviewed range`);
  assert(report.fit.shellPolygons >= 17_000, `${bodyId} shell coverage is incomplete`);
  assert(report.fit.rubberMaterialPolygons >= 3_000, `${bodyId} insulated hands or feet are incomplete`);
  assert(report.fit.detailPolygons >= 260, `${bodyId} field-protection details are incomplete`);
  assert(report.fit.energyCore.length === 3 && report.fit.energyCore[2] > 1.1,
    `${bodyId} field regulator placement is invalid`);
  assert(report.fit.waistRadii.every(value => value > 0.09 && value < 0.25),
    `${bodyId} measured waist channel is implausible`);
  return report;
});

for (const file of [
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_review.blend')
]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 800_000, `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  const summary = {
    schema: 'realm.equipment-energy-suit-review.v1',
    assetFamily: 'equipment_energy_suit_unified_v1',
    itemId: 'energySuit',
    itemNameRu: 'Энергозащитный костюм',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  };
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

console.log(`Energy suit model OK: ${reports.length} fitted GLB variants, 65-bone rig, compact regulator and B+C field materials.`);
