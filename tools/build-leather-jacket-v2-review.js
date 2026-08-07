#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BLENDER = process.env.REALM_BLENDER_EXE || path.join(
  os.homedir(),
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const GENERATOR = path.join(ROOT, 'tools', 'blender', 'build_unified_leather_jacket_review_v2.py');
const CHARACTER_DIRECTORY = path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base');
const REVIEW_DIRECTORY = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-leather-jacket-v2', 'jacket');
const ASSET_ID = 'equipment_leather_jacket_unified_v2';
const BODY_IDS = [
  'female_slim',
  'female_medium',
  'female_large',
  'male_slim',
  'male_medium',
  'male_large'
];

function fail(message) {
  throw new Error(message);
}

function requireFile(label, file) {
  if (!fs.existsSync(file)) fail(`${label} not found: ${file}`);
}

function bodyIdsFromArgs() {
  const only = process.argv.find(argument => argument.startsWith('--only='));
  if (!only) return BODY_IDS;
  const ids = only.slice('--only='.length).split(',').filter(Boolean);
  ids.forEach(id => assert(BODY_IDS.includes(id), `unknown body id: ${id}`));
  return ids;
}

function reviewPaths(bodyId) {
  const prefix = `${ASSET_ID}_${bodyId}`;
  return {
    glb: path.join(REVIEW_DIRECTORY, `${prefix}.glb`),
    report: path.join(REVIEW_DIRECTORY, `${prefix}.report.json`),
    front: path.join(REVIEW_DIRECTORY, `${prefix}_front.png`),
    blend: path.join(REVIEW_DIRECTORY, `${prefix}_review.blend`),
    back: path.join(REVIEW_DIRECTORY, `${prefix}_back.png`),
    side: path.join(REVIEW_DIRECTORY, `${prefix}_side.png`),
    threeQuarter: path.join(REVIEW_DIRECTORY, `${prefix}_three_quarter.png`),
    isometric: path.join(REVIEW_DIRECTORY, `${prefix}_isometric.png`),
    night: path.join(REVIEW_DIRECTORY, `${prefix}_night.png`),
    wireframe: path.join(REVIEW_DIRECTORY, `${prefix}_wireframe.png`),
    native: path.join(REVIEW_DIRECTORY, `${prefix}_native112.png`),
    deformation: path.join(REVIEW_DIRECTORY, `${prefix}_deformation.png`),
    detail: path.join(REVIEW_DIRECTORY, `${prefix}_detail.png`),
    idle: path.join(REVIEW_DIRECTORY, `${prefix}_idle_f19.png`),
    walk: path.join(REVIEW_DIRECTORY, `${prefix}_walk_f10.png`),
    run: path.join(REVIEW_DIRECTORY, `${prefix}_run_f6.png`)
  };
}

function validateReport(report, bodyId) {
  assert.strictEqual(report.assetId, ASSET_ID, `${bodyId}: asset id drifted`);
  assert.strictEqual(report.bodyId, bodyId, `${bodyId}: body id drifted`);
  assert.strictEqual(report.reviewOnly, true, `${bodyId}: review gate is missing`);
  assert.strictEqual(report.runtimeIntegrationAllowed, false, `${bodyId}: runtime gate opened unexpectedly`);
  assert.strictEqual(report.actualGlb?.skins, 1, `${bodyId}: expected one skin`);
  assert.strictEqual(report.actualGlb?.meshDefinitions, 2, `${bodyId}: expected shell and details meshes`);
  assert.strictEqual(report.actualGlb?.materials, 4, `${bodyId}: expected four materials`);
  assert.strictEqual(report.actualGlb?.textures, 12, `${bodyId}: expected twelve embedded PBR textures`);
  assert(report.actualGlb?.triangles >= 4500 && report.actualGlb?.triangles <= 12000,
    `${bodyId}: triangle budget violated (${report.actualGlb?.triangles})`);
  assert(report.bytes > 0 && report.bytes <= 1_500_000, `${bodyId}: GLB size budget violated (${report.bytes})`);
  assert(report.highPolySource?.polygons >= 60_000, `${bodyId}: high-poly source is not dense enough`);
  assert(report.actualGlb?.nodes?.includes('character_root'), `${bodyId}: character_root missing`);
  for (const bone of ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']) {
    assert(report.actualGlb.nodes.includes(bone), `${bodyId}: rig bone missing: ${bone}`);
  }
}

function buildBody(bodyId) {
  const reference = path.join(CHARACTER_DIRECTORY, `character_${bodyId}.glb`);
  const output = reviewPaths(bodyId);
  requireFile(`${bodyId} character`, reference);
  const args = [
    '-b',
    '--python', GENERATOR,
    '--',
    '--reference-character', reference,
    '--asset-id', ASSET_ID,
    '--body-id', bodyId,
    '--output', output.glb,
    '--report', output.report,
    '--front-render', output.front
  ];
  if (bodyId === 'male_medium') {
    args.push(
      '--blend-output', output.blend,
      '--back-render', output.back,
      '--side-render', output.side,
      '--three-quarter-render', output.threeQuarter,
      '--isometric-render', output.isometric,
      '--night-render', output.night,
      '--wireframe-render', output.wireframe,
      '--native-render', output.native,
      '--deformation-render', output.deformation,
      '--detail-render', output.detail,
      '--idle-render', output.idle,
      '--walk-render', output.walk,
      '--run-render', output.run
    );
  }
  const result = spawnSync(BLENDER, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    fail(`${bodyId}: Blender exited with ${result.status}`);
  }
  requireFile(`${bodyId} GLB`, output.glb);
  requireFile(`${bodyId} report`, output.report);
  requireFile(`${bodyId} front render`, output.front);
  const report = JSON.parse(fs.readFileSync(output.report, 'utf8'));
  validateReport(report, bodyId);
  if (bodyId === 'male_medium') {
    for (const [label, file] of Object.entries(output)) {
      requireFile(`male_medium ${label}`, file);
    }
  }
  console.log(`${bodyId}: ${report.actualGlb.triangles} triangles, ${report.bytes} bytes, ${report.sha256}`);
  return report;
}

function main() {
  requireFile('Blender', BLENDER);
  requireFile('leather jacket v2 generator', GENERATOR);
  fs.mkdirSync(REVIEW_DIRECTORY, { recursive: true });
  const requestedIds = bodyIdsFromArgs();
  const builtReports = requestedIds.map(buildBody);
  const reportsById = new Map(
    BODY_IDS
      .map(bodyId => reviewPaths(bodyId).report)
      .filter(file => fs.existsSync(file))
      .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
      .map(report => [report.bodyId, report])
  );
  const reports = BODY_IDS.map(bodyId => reportsById.get(bodyId)).filter(Boolean);
  const summary = {
    artDirection: 'geometry B, materials and wear C',
    assetId: ASSET_ID,
    bodyIds: BODY_IDS,
    reference: 'docs/art/references/leather-jacket-bc-reference-v1.png',
    reviewOnly: true,
    runtimeIntegrationAllowed: false,
    variantCount: reports.length,
    variants: reports
  };
  fs.writeFileSync(
    path.join(REVIEW_DIRECTORY, 'fit-report-all.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
  console.log(`Leather jacket v2 review build complete: ${builtReports.length} generated, ${reports.length} in summary`);
}

main();
