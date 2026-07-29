'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { imageDimensions } = require('./validate-production-glb');
const {
  validateProductionLodSet
} = require('./validate-production-lod-set');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review',
  'production-preview'
);
const DEFAULT_MANIFEST = path.join(
  OUTPUT_ROOT,
  'service-boots-service-scout-review.json'
);
const CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);
const REVIEWED_MANIFEST_SHA256 =
  '303961848c923cf32c9d3405faa8002bb1d7f4e24a72b41485ba51446020dbca';
const CONFIRMED_MANIFEST_SHA256 =
  'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9';
const VARIANTS = ['female_slim', 'female_medium', 'female_large', 'male_slim', 'male_medium', 'male_large'];
const LODS = ['lod0', 'lod1', 'lod2'];
const STANDALONE_VARIANTS = ['female_medium', 'male_medium'];
const STANDALONE_VIEWS = ['front', 'three_quarter', 'side', 'rear', 'sole'];
const FIT_POSES = [
  'bind',
  'idle',
  'walk_contact',
  'run_contact',
  'crouch_idle',
  'ready_1h',
  'ready_2h',
  'melee_heavy'
];

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--manifest') {
      if (!argv[index + 1]) throw new Error('--manifest requires a value');
      args.manifest = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function normalize(value) {
  return String(value).replace(/\\/gu, '/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(directory, base = directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...listFiles(file, base));
    else if (entry.isFile()) rows.push(normalize(path.relative(base, file)));
  }
  return rows;
}

function expectedFiles() {
  const rows = new Set(['service-boots-service-scout-review.json']);
  for (const variant of VARIANTS) {
    for (const lod of LODS) {
      rows.add(
        `variants/${variant}/service_boots_${variant}_service_scout_${lod}.glb`
      );
    }
    rows.add(`fit/service_scout_${variant}_fit-review.json`);
    for (const pose of FIT_POSES) {
      rows.add(
        `renders/fit/${variant}/service_scout_${variant}_${pose}.png`
      );
    }
  }
  for (const variant of STANDALONE_VARIANTS) {
    for (const view of STANDALONE_VIEWS) {
      rows.add(
        `renders/standalone/service_scout_compact_v2_${variant}_lod0_${view}.png`
      );
    }
  }
  return rows;
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every(value => expected.includes(value))
  );
}

function checkEvidence(entry, root, issues, label) {
  if (!entry || typeof entry.file !== 'string') {
    issues.push(`${label}: missing evidence`);
    return;
  }
  const file = path.resolve(root, entry.file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    issues.push(`${label}: evidence file is missing (${entry.file})`);
    return;
  }
  const bytes = fs.statSync(file).size;
  if (entry.bytes !== bytes) issues.push(`${label}: byte size drifted`);
  if (entry.sha256 !== sha256(file)) issues.push(`${label}: SHA-256 drifted`);
  const dimensions = imageDimensions(fs.readFileSync(file));
  if (dimensions) {
    if (
      !Array.isArray(entry.dimensions) ||
      entry.dimensions[0] !== dimensions.width ||
      entry.dimensions[1] !== dimensions.height
    ) {
      issues.push(`${label}: image dimensions drifted`);
    }
  }
}

function variantModelId(variant) {
  return `service_boots_${variant}_service_scout`;
}

function validateManifest(file) {
  const issues = [];
  if (!fs.existsSync(file)) {
    return { valid: false, issues: [`Manifest is missing: ${file}`] };
  }
  const manifest = readJson(file);
  const outputRoot = path.dirname(file);
  if (
    manifest.schema !== 'realm.service-boots-redesign-art-review.v1' ||
    manifest.version !== 1 ||
    manifest.status !== 'approved_for_runtime_integration' ||
    manifest.reviewId !== 'service_boots_service_scout_compact_v2'
  ) {
    issues.push('Manifest identity or status is invalid');
  }
  if (
    manifest.artDirection?.id !== 'geometry_b_materials_c' ||
    manifest.implementation?.assetId !== 'service_boots' ||
    manifest.implementation?.assetClass !== 'humanoid_skinned_equipment' ||
    manifest.implementation?.rig !== 'humanoid_v1' ||
    manifest.implementation?.joints !== 65 ||
    manifest.implementation?.materials !== 2 ||
    !sameSet(manifest.implementation?.hideBodyRegions || [], ['foot_l', 'foot_r']) ||
    !sameSet(manifest.implementation?.lods || [], LODS)
  ) {
    issues.push('Implementation contract metadata is invalid');
  }
  if (
    manifest.provenance?.type !== 'original' ||
    manifest.provenance?.id !== 'realm_of_ashes_original' ||
    manifest.provenance?.thirdPartyGeometryImported !== false ||
    manifest.provenance?.thirdPartyTexturesImported !== false
  ) {
    issues.push('Original-asset provenance is invalid');
  }
  checkEvidence(
    manifest.provenance?.artisticSource,
    REPO_ROOT,
    issues,
    'artistic source'
  );
  checkEvidence(manifest.contract, REPO_ROOT, issues, 'production contract');
  for (const [index, generator] of (manifest.generators || []).entries()) {
    checkEvidence(generator, REPO_ROOT, issues, `generator ${index}`);
  }
  if (
    manifest.correctionBasis?.criticVerdict !== 'APPROVED' ||
    manifest.correctionBasis?.unresolvedGate !==
      'runtime integration and post-integration critic QA' ||
    manifest.criticReview?.reviewer !== 'independent_art_critic_agent' ||
    manifest.criticReview?.verdict !== 'APPROVED' ||
    manifest.criticReview?.reviewedManifestSha256 !==
      REVIEWED_MANIFEST_SHA256
  ) {
    issues.push('Independent critic approval record is invalid');
  }
  checkEvidence(
    manifest.criticReview?.report,
    REPO_ROOT,
    issues,
    'independent critic report'
  );
  if (
    manifest.finalCriticConfirmation?.verdict !== 'APPROVED' ||
    manifest.finalCriticConfirmation?.confirmedManifestSha256 !==
      CONFIRMED_MANIFEST_SHA256 ||
    manifest.userDecision?.mode !== 'delegated_to_critic' ||
    manifest.userDecision?.userText !== 'Пусть критик подтверждает' ||
    manifest.userDecision?.approvedManifestSha256 !==
      CONFIRMED_MANIFEST_SHA256 ||
    manifest.userDecision?.scope !==
      'service_boots_service_scout_compact_v2_only'
  ) {
    issues.push('Delegated user approval record is invalid');
  }
  checkEvidence(
    manifest.finalCriticConfirmation?.report,
    REPO_ROOT,
    issues,
    'final critic confirmation'
  );
  checkEvidence(
    manifest.userDecision?.record,
    REPO_ROOT,
    issues,
    'delegated user decision'
  );

  if (
    manifest.approval?.artDirectionApproved !== true ||
    manifest.approval?.baseBodiesApproved !== true ||
    manifest.approval?.criticApproved !== true ||
    manifest.approval?.userAssetsApproved !== true ||
    manifest.approval?.runtimeIntegrationAllowed !== true ||
    manifest.approval?.pullRequestAllowed !== true
  ) {
    issues.push('Approved integration gates are invalid');
  }

  const variants = manifest.variants || [];
  if (!sameSet(variants.map(row => row.key), VARIANTS)) {
    issues.push('Variant matrix is incomplete');
  }
  for (const variant of VARIANTS) {
    const row = variants.find(candidate => candidate.key === variant);
    if (!row || row.modelId !== variantModelId(variant)) continue;
    const directory = path.join(outputRoot, 'variants', variant);
    const report = validateProductionLodSet({
      directory,
      contract: CONTRACT,
      assetId: 'service_boots',
      modelId: variantModelId(variant),
      assetClass: 'humanoid_skinned_equipment'
    });
    if (!report.valid) {
      issues.push(
        `${variant}: ${report.issues.join('; ')}`
      );
    }
    if (!Array.isArray(row.lods) || row.lods.length !== LODS.length) {
      issues.push(`${variant}: manifest LOD evidence is incomplete`);
    } else {
      for (const [index, lod] of row.lods.entries()) {
        checkEvidence(lod, outputRoot, issues, `${variant}/${LODS[index]}`);
      }
    }
  }

  const expectedRenderFiles = [...expectedFiles()]
    .filter(row => row.endsWith('.png'))
    .sort();
  const actualRenderFiles = (manifest.renders || [])
    .map(row => normalize(row.file))
    .sort();
  if (!sameSet(actualRenderFiles, expectedRenderFiles)) {
    issues.push('Render evidence inventory is incomplete');
  }
  for (const render of manifest.renders || []) {
    checkEvidence(render, outputRoot, issues, `render ${render.file}`);
  }

  const fitReviews = manifest.fitReviews || [];
  if (!sameSet(fitReviews.map(row => row.key), VARIANTS)) {
    issues.push('Fit-review matrix is incomplete');
  }
  for (const variant of VARIANTS) {
    const row = fitReviews.find(candidate => candidate.key === variant);
    if (!row) continue;
    if (
      row.rig !== 'humanoid_v1' ||
      row.jointCount !== 65 ||
      row.jointSetsMatch !== true ||
      !sameSet(row.hideBodyRegions || [], ['foot_l', 'foot_r']) ||
      !sameSet((row.poses || []).map(pose => pose.id), FIT_POSES)
    ) {
      issues.push(`${variant}: fit-review metadata is invalid`);
    }
    checkEvidence(row.report, outputRoot, issues, `${variant}: fit report`);
    const reportFile = path.resolve(outputRoot, row.report?.file || '');
    if (!fs.existsSync(reportFile)) continue;
    const report = readJson(reportFile);
    if (
      report.schema !== 'realm.service-boots-fit-review.v1' ||
      report.status !== 'review_candidate' ||
      report.jointCount !== 65 ||
      report.jointSetsMatch !== true ||
      report.runtimeIntegrationAllowed !== false ||
      report.pullRequestAllowed !== false ||
      !sameSet((report.poses || []).map(pose => pose.id), FIT_POSES)
    ) {
      issues.push(`${variant}: generated fit report is invalid`);
    }
    const lod0 = path.join(
      outputRoot,
      'variants',
      variant,
      `${variantModelId(variant)}_lod0.glb`
    );
    if (report.boots?.sha256 !== sha256(lod0)) {
      issues.push(`${variant}: fit report boot hash drifted`);
    }
    for (const pose of row.poses || []) {
      if (!Number.isFinite(pose.groundShiftMeters)) {
        issues.push(`${variant}/${pose.id}: ground shift is invalid`);
      }
      checkEvidence(
        pose.image,
        outputRoot,
        issues,
        `${variant}/${pose.id}`
      );
    }
  }

  const expected = [...expectedFiles()].sort();
  const actual = listFiles(outputRoot).sort();
  if (!sameSet(actual, expected)) {
    const unexpected = actual.filter(row => !expected.includes(row));
    const missing = expected.filter(row => !actual.includes(row));
    issues.push(
      `Exact review inventory drifted` +
        (missing.length ? `; missing: ${missing.join(', ')}` : '') +
        (unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : '')
    );
  }
  return {
    valid: issues.length === 0,
    issues,
    stats: {
      variants: VARIANTS.length,
      glbs: VARIANTS.length * LODS.length,
      renders: expectedRenderFiles.length,
      fitReports: VARIANTS.length,
      files: actual.length
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateManifest(args.manifest);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.valid) {
    process.stdout.write(
      `Service Scout review is valid: ${report.stats.glbs} GLB, ` +
        `${report.stats.renders} renders, ${report.stats.fitReports} fit reports.\n`
    );
  } else {
    process.stderr.write(
      `Service Scout review is invalid:\n` +
        report.issues.map(issue => `- ${issue}`).join('\n') +
        '\n'
    );
  }
  if (!report.valid) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MANIFEST,
  FIT_POSES,
  VARIANTS,
  expectedFiles,
  validateManifest
};
