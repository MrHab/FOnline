#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-backpack-v1', 'backpack');
const BODY_IDS = Object.freeze(['female_slim', 'female_medium', 'female_large', 'male_slim', 'male_medium', 'male_large']);
const REQUIRED_MATERIALS = Object.freeze([
  'backpack_faded_olive_canvas',
  'backpack_aged_brown_webbing',
  'backpack_oxidised_frame_steel',
  'backpack_dusty_blanket_roll',
  'backpack_faded_field_patch'
]);
const ARMOR_OFFSETS = Object.freeze({
  '': 0,
  leather: 0.02,
  metalArmor: 0.04,
  ballisticVest: 0.035,
  combatArmor: 0.05,
  hazmatSuit: 0.03,
  heavyArmor: 0.07,
  energySuit: 0.04
});

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
  return path.join(REVIEW_DIR, `equipment_backpack_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const backRender = fileFor(bodyId, '_back.png');
  for (const file of [glbFile, reportFile, backRender]) {
    assert(fs.existsSync(file), `Backpack ${bodyId} asset is missing: ${file}`);
  }
  assert(fs.statSync(backRender).size > 900_000, `Backpack ${bodyId} review render is unexpectedly small`);
  assert(fs.statSync(glbFile).size > 850_000 && fs.statSync(glbFile).size < 1_000_000,
    `Backpack ${bodyId} GLB is outside the reviewed budget`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_backpack_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'backpack');
  assert.strictEqual(report.slot, 'backpack');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.strictEqual(gltf.skins?.length, 1);
  assert.strictEqual(gltf.skins[0].joints?.length, 65);
  assert.strictEqual(gltf.meshes?.length, 2);
  assert.strictEqual(gltf.materials?.length, 5);
  assert.strictEqual(gltf.images?.length, 15);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  const layers = (gltf.nodes || [])
    .map(node => node.extras?.realm_backpack_layer)
    .filter(Boolean)
    .sort();
  assert.deepStrictEqual(layers, ['harness', 'pack'], `${bodyId} must separate the body harness and pack shell`);
  assert(report.actualGlb.triangles >= 4_200 && report.actualGlb.triangles <= 4_500);
  assert.strictEqual(report.fit.baseBodyClearance, 0.046);
  assert.deepStrictEqual(report.fit.runtimeArmorOffsets, ARMOR_OFFSETS);
  assert.strictEqual(report.fit.sidePockets, 2);
  assert.strictEqual(report.fit.frameRails, 2);
  assert.strictEqual(report.fit.frameCrossbars, 3);
  assert.strictEqual(report.fit.cargoRolls, 2);
  assert.strictEqual(report.fit.shoulderStraps, 2);
  assert(report.fit.packHalfWidth >= 0.24 && report.fit.packHalfWidth < 0.28);
  return report;
});

for (const file of [fileFor('male_medium', '_front.png'), fileFor('male_medium', '_detail.png'), fileFor('male_medium', '_review.blend')]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 900_000, `Male medium review extra is missing: ${file}`);
}

const heavyReport = JSON.parse(fs.readFileSync(path.join(
  ROOT,
  'docs', 'art', 'reviews', 'unified-equipment-heavy-armor-v1', 'armor',
  'equipment_heavy_armor_unified_v1_male_medium.report.json'
), 'utf8'));
const maleMedium = reports.find(report => report.bodyId === 'male_medium');
const heavyArmorOuterBackY = Number(heavyReport.details.backY) + 0.04;
const effectivePackFrontY = Number(maleMedium.fit.packFrontY)
  + Number(maleMedium.fit.runtimeArmorOffsets.heavyArmor);
assert(
  effectivePackFrontY - heavyArmorOuterBackY >= 0.01,
  'Backpack shell does not retain clearance over the approved heavy armor'
);

if (process.argv.includes('--write-summary')) {
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify({
    schema: 'realm.equipment-backpack-review.v1',
    assetFamily: 'equipment_backpack_unified_v1',
    itemId: 'backpack',
    itemNameRu: 'Рюкзак',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    runtimeArmorOffsets: ARMOR_OFFSETS,
    variants: reports
  }, null, 2)}\n`, 'utf8');
}

console.log(`Backpack model OK: ${reports.length} fitted GLB variants, split harness/pack layers and armor clearance.`);
