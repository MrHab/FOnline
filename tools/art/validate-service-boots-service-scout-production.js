'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  validateManifest: validateReviewManifest
} = require('./validate-service-boots-service-scout-review');
const {
  validateCharacterModuleSet
} = require('./validate-character-module-set');
const {
  validateProductionLodSet
} = require('./validate-production-lod-set');
const {
  MODULE_MANIFEST,
  OUTPUT_ROOT,
  PUBLIC_MANIFEST,
  PUBLIC_ROOT,
  RELEASE_MANIFEST,
  VARIANTS,
  modelId,
  outputFile
} = require('./build-service-boots-service-scout-production');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);
const REVIEW_MANIFEST = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review',
  'production-preview',
  'service-boots-service-scout-review.json'
);
const APPROVED_REVIEW_SHA256 =
  'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9';
const LODS = ['lod0', 'lod1', 'lod2'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function checkEvidence(row, root, issues, label) {
  const file = row?.file ? path.resolve(root, row.file) : null;
  if (!file || !fs.existsSync(file)) {
    issues.push(`${label}: evidence file is missing`);
    return;
  }
  const bytes = fs.statSync(file).size;
  if (bytes !== row.bytes) issues.push(`${label}: byte size drifted`);
  if (sha256File(file) !== row.sha256) issues.push(`${label}: SHA-256 drifted`);
}

function validateProduction() {
  const issues = [];
  for (const file of [
    REVIEW_MANIFEST,
    MODULE_MANIFEST,
    PUBLIC_MANIFEST,
    RELEASE_MANIFEST
  ]) {
    if (!fs.existsSync(file)) issues.push(`Missing release file: ${file}`);
  }
  if (issues.length) return { valid: false, issues, stats: {} };

  const reviewReport = validateReviewManifest(REVIEW_MANIFEST);
  issues.push(...reviewReport.issues.map(issue => `review: ${issue}`));

  const moduleReport = validateCharacterModuleSet({
    manifest: MODULE_MANIFEST,
    contract: CONTRACT,
    fixtureMode: false
  });
  issues.push(...moduleReport.issues.map(issue => `module: ${issue}`));

  const moduleManifest = readJson(MODULE_MANIFEST);
  if (
    moduleManifest.status !== 'approved' ||
    moduleManifest.fitStatus !== 'pending_geometry_check' ||
    moduleManifest.provenance?.type !== 'original' ||
    moduleManifest.provenance?.id !== 'realm_of_ashes_original'
  ) {
    issues.push('Production module approval, fit or provenance status is invalid');
  }

  const runtime = readJson(PUBLIC_MANIFEST);
  if (
    runtime.schema !== 'realm.runtime-character-module.v1' ||
    runtime.status !== 'approved' ||
    runtime.assetId !== 'service_boots' ||
    JSON.stringify(runtime.physicalItemIds) !== JSON.stringify(['scoutBoots']) ||
    runtime.authority?.equipmentSource !==
      'server_snapshot.equipment.boots' ||
    runtime.authority?.physicalInventoryRequired !== true ||
    runtime.authority?.clientCosmeticOverrideAllowed !== false
  ) {
    issues.push('Runtime manifest identity or authority rules are invalid');
  }

  const release = readJson(RELEASE_MANIFEST);
  if (
    release.schema !== 'realm.service-boots-production-release.v1' ||
    release.status !== 'approved_for_integration' ||
    release.assetId !== 'service_boots' ||
    release.physicalItemId !== 'scoutBoots' ||
    release.approval?.mode !== 'delegated_to_critic' ||
    release.approval?.scope !==
      'service_boots_service_scout_compact_v2_only' ||
    release.approval?.approvedReviewManifestSha256 !==
      APPROVED_REVIEW_SHA256 ||
    release.approval?.criticVerdict !== 'APPROVED' ||
    release.approval?.runtimeIntegrationAllowed !== true ||
    release.approval?.pullRequestAllowed !== true ||
    release.provenance?.type !== 'original' ||
    release.provenance?.redistributionAllowed !== true ||
    release.fitEvidence?.formalBvhFitStatus !== 'pending_geometry_check'
  ) {
    issues.push('Production release approval or provenance record is invalid');
  }

  checkEvidence(release.fitEvidence?.reviewManifest, REPO_ROOT, issues, 'review manifest');
  checkEvidence(release.moduleManifest, REPO_ROOT, issues, 'module manifest');
  checkEvidence(release.runtimeManifest, REPO_ROOT, issues, 'runtime manifest');
  for (const [index, row] of (release.generators || []).entries()) {
    checkEvidence(row, REPO_ROOT, issues, `generator ${index}`);
  }

  const runtimeByKey = new Map(
    (runtime.variants || []).map(variant => [variant.key, variant])
  );
  const releaseByKey = new Map(
    (release.variants || []).map(variant => [variant.key, variant])
  );
  for (const variant of VARIANTS) {
    const report = validateProductionLodSet({
      directory: path.join(OUTPUT_ROOT, 'variants', variant.key),
      contract: CONTRACT,
      assetId: 'service_boots',
      modelId: modelId(variant),
      assetClass: 'humanoid_skinned_equipment'
    });
    issues.push(...report.issues.map(issue => `${variant.key}: ${issue}`));
    const runtimeVariant = runtimeByKey.get(variant.key);
    const releaseVariant = releaseByKey.get(variant.key);
    if (!runtimeVariant || !releaseVariant) {
      issues.push(`${variant.key}: runtime or release variant is missing`);
      continue;
    }
    if (
      runtimeVariant.sex !== variant.sex ||
      runtimeVariant.bodyType !== variant.bodyType ||
      JSON.stringify(runtimeVariant.triangles) !==
        JSON.stringify(report.stats.triangles)
    ) {
      issues.push(`${variant.key}: runtime variant metadata drifted`);
    }
    for (const [lodIndex, lod] of LODS.entries()) {
      const source = outputFile(OUTPUT_ROOT, variant, lod);
      const target = outputFile(PUBLIC_ROOT, variant, lod);
      if (!fs.existsSync(source) || !fs.existsSync(target)) {
        issues.push(`${variant.key}/${lod}: source or runtime GLB is missing`);
        continue;
      }
      if (sha256File(source) !== sha256File(target)) {
        issues.push(`${variant.key}/${lod}: runtime GLB differs from production`);
      }
      checkEvidence(
        releaseVariant.source?.[lodIndex],
        OUTPUT_ROOT,
        issues,
        `${variant.key}/${lod} source`
      );
      checkEvidence(
        releaseVariant.runtime?.[lodIndex],
        PUBLIC_ROOT,
        issues,
        `${variant.key}/${lod} runtime`
      );
      const expectedUrl =
        `/assets/models/characters/outfits/field_worker/service_boots/` +
        `variants/${variant.key}/${modelId(variant)}_${lod}.glb`;
      if (runtimeVariant.lods?.[lod] !== expectedUrl) {
        issues.push(`${variant.key}/${lod}: runtime URL drifted`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    stats: {
      variants: VARIANTS.length,
      glbs: VARIANTS.length * LODS.length,
      moduleFitStatus: moduleManifest.fitStatus,
      physicalItemId: release.physicalItemId
    }
  };
}

function main() {
  const report = validateProduction();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.valid) {
    process.stdout.write(
      `Service Scout production is valid: ${report.stats.glbs} GLB, ` +
        `${report.stats.variants} variants, item ${report.stats.physicalItemId}.\n`
    );
  } else {
    process.stderr.write(
      `Service Scout production is invalid:\n` +
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
  validateProduction
};
