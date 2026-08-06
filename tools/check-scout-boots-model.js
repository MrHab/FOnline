#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-scout-boots-v1', 'boots');
const BODY_IDS = Object.freeze(['female_slim', 'female_medium', 'female_large', 'male_slim', 'male_medium', 'male_large']);
const REQUIRED_MATERIALS = Object.freeze([
  'scout_boots_weathered_dark_leather',
  'scout_boots_flexible_black_rubber',
  'scout_boots_faded_olive_canvas',
  'scout_boots_dull_hardware',
  'scout_boots_dust_gaiter',
  'scout_boots_aged_webbing',
  'scout_boots_faded_route_marker'
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
  return path.join(REVIEW_DIR, `equipment_scout_boots_unified_v1_${bodyId}${suffix}`);
}

const reports = BODY_IDS.map(bodyId => {
  const glbFile = fileFor(bodyId, '.glb');
  const reportFile = fileFor(bodyId, '.report.json');
  const reviewRenders = [fileFor(bodyId, '_front.png'), fileFor(bodyId, '_walk_f10.png'), fileFor(bodyId, '_run_f6.png')];
  for (const file of [glbFile, reportFile, ...reviewRenders]) {
    assert(fs.existsSync(file), `Scout boots ${bodyId} asset is missing: ${file}`);
  }
  reviewRenders.forEach(file => assert(
    fs.statSync(file).size > 950_000,
    `Scout boots ${bodyId} review render is unexpectedly small: ${file}`
  ));
  assert(fs.statSync(glbFile).size > 850_000 && fs.statSync(glbFile).size < 1_000_000,
    `Scout boots ${bodyId} GLB is outside the reviewed budget`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const gltf = parseGlb(glbFile);
  assert.strictEqual(report.assetId, `equipment_scout_boots_unified_v1_${bodyId}`);
  assert.strictEqual(report.bodyId, bodyId);
  assert.strictEqual(report.itemId, 'scoutBoots');
  assert.strictEqual(report.slot, 'boots');
  assert.strictEqual(report.reviewOnly, true);
  assert.strictEqual(report.runtimeIntegrationAllowed, false);
  assert.strictEqual(report.sha256, sha256(glbFile), `${bodyId} report checksum is stale`);
  assert.strictEqual(gltf.skins?.length, 1);
  assert.strictEqual(gltf.skins[0].joints?.length, 65);
  assert.strictEqual(gltf.meshes?.length, 1);
  assert.strictEqual(gltf.materials?.length, 7);
  assert.strictEqual(gltf.images?.length, 21);
  assert.deepStrictEqual(gltf.materials.map(material => material.name).sort(), [...REQUIRED_MATERIALS].sort());
  assert.strictEqual(report.actualGlb.positionVertices, 3850);
  assert.strictEqual(report.actualGlb.triangles, 1994);
  assert.strictEqual(report.animationStress.rigCompatibility, true);
  assert.strictEqual(report.animationStress.walk.rendered, true);
  assert.strictEqual(report.animationStress.run.rendered, true);
  for (const side of ['l', 'r']) {
    const details = report.scoutDetails[side];
    assert.strictEqual(details.toeGuard, true);
    assert.strictEqual(details.gaiterCollar, true);
    assert.strictEqual(details.ankleStraps, 2);
    assert.strictEqual(details.outerFlexiblePatch, true);
    assert.strictEqual(details.heelKickPad, true);
    assert.strictEqual(details.pullLoop, true);
    assert.strictEqual(details.trailLugs, 5);
    assert.strictEqual(details.strapHooks, 2);
    assert.deepStrictEqual(details.weights, [`foot_${side}`, `ball_${side}`, `calf_${side}`]);
  }
  return report;
});

for (const file of [
  fileFor('male_medium', '_side.png'),
  fileFor('male_medium', '_back.png'),
  fileFor('male_medium', '_detail.png'),
  fileFor('male_medium', '_game.png'),
  fileFor('male_medium', '_review.blend')
]) {
  assert(fs.existsSync(file) && fs.statSync(file).size > 900_000, `Male medium review extra is missing: ${file}`);
}

if (process.argv.includes('--write-summary')) {
  fs.writeFileSync(path.join(REVIEW_DIR, 'fit-report-all.json'), `${JSON.stringify({
    schema: 'realm.equipment-scout-boots-review.v1',
    assetFamily: 'equipment_scout_boots_unified_v1',
    itemId: 'scoutBoots',
    itemNameRu: 'Разведботинки',
    artDirection: 'геометрия B, материалы и износ C',
    bodyIds: BODY_IDS,
    variantCount: reports.length,
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variants: reports
  }, null, 2)}\n`, 'utf8');
}

console.log(`Scout boots model OK: ${reports.length} fitted GLB variants, 65-bone rig and walk/run reviews.`);
