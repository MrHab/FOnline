'use strict';

const childProcess = require('child_process');
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

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REVIEW_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review'
);
const REVIEW_MANIFEST = path.join(
  REVIEW_ROOT,
  'production-preview',
  'service-boots-service-scout-review.json'
);
const SOURCE_BLEND = path.join(
  REVIEW_ROOT,
  'service_boots_redesign_working.blend'
);
const FIRST_OUTFIT_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit'
);
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'production',
  'characters',
  'outfits',
  'field_worker',
  'service_boots'
);
const PUBLIC_ROOT = path.join(
  REPO_ROOT,
  'public',
  'assets',
  'models',
  'characters',
  'outfits',
  'field_worker',
  'service_boots'
);
const PUBLIC_MANIFEST = path.join(
  REPO_ROOT,
  'public',
  'assets',
  'models',
  'characters',
  'service-scout-boots-manifest.json'
);
const MODULE_MANIFEST = path.join(OUTPUT_ROOT, 'character-module-set.json');
const RELEASE_MANIFEST = path.join(
  OUTPUT_ROOT,
  'service-scout-production-release.json'
);
const BUILD_SCRIPT = path.join(
  __dirname,
  'blender',
  'build_service_boots_service_scout.py'
);
const CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);
const DEFAULT_BLENDER =
  process.env.REALM_BLENDER_EXE ||
  path.join(
    process.env.USERPROFILE || '',
    '.codex',
    'tool-cache',
    'blender',
    'blender-4.5.12-windows-x64',
    'blender.exe'
  );
const APPROVED_REVIEW_SHA256 =
  'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9';
const LODS = ['lod0', 'lod1', 'lod2'];
const VARIANTS = ['female', 'male'].flatMap(sex =>
  ['slim', 'medium', 'large'].map(bodyType => ({
    key: `${sex}_${bodyType}`,
    sex,
    bodyType
  }))
);

function parseArgs(argv) {
  const args = {
    blender: DEFAULT_BLENDER,
    reuseValid: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--reuse-valid') args.reuseValid = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--blender') {
      const value = argv[index + 1];
      if (!value) throw new Error('--blender requires a value');
      args.blender = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/gu, '/');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function evidence(file, root = REPO_ROOT) {
  const bytes = fs.readFileSync(file);
  return {
    file: normalizePath(path.relative(root, file)),
    bytes: bytes.length,
    sha256: sha256Buffer(bytes)
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function modelId(variant) {
  return `service_boots_${variant.key}`;
}

function outputFile(root, variant, lod) {
  return path.join(
    root,
    'variants',
    variant.key,
    `${modelId(variant)}_${lod}.glb`
  );
}

function scaffoldFile(variant) {
  return path.join(
    FIRST_OUTFIT_ROOT,
    'service_boots',
    'variants',
    variant.key,
    `${modelId(variant)}_lod0.glb`
  );
}

function validateInputs(options) {
  const required = [
    options.blender,
    REVIEW_MANIFEST,
    SOURCE_BLEND,
    BUILD_SCRIPT,
    CONTRACT
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing production input: ${file}`);
  }
  for (const variant of VARIANTS) {
    const scaffold = scaffoldFile(variant);
    if (!fs.existsSync(scaffold)) {
      throw new Error(`Missing approved scaffold: ${scaffold}`);
    }
  }
  const reviewReport = validateReviewManifest(REVIEW_MANIFEST);
  if (!reviewReport.valid) {
    throw new Error(
      `Approved Service Scout review drifted:\n` +
        reviewReport.issues.map(issue => `- ${issue}`).join('\n')
    );
  }
  const review = JSON.parse(fs.readFileSync(REVIEW_MANIFEST, 'utf8'));
  if (
    review.finalCriticConfirmation?.verdict !== 'APPROVED' ||
    review.finalCriticConfirmation?.confirmedManifestSha256 !==
      APPROVED_REVIEW_SHA256 ||
    review.userDecision?.mode !== 'delegated_to_critic' ||
    review.userDecision?.approvedManifestSha256 !== APPROVED_REVIEW_SHA256 ||
    review.userDecision?.scope !==
      'service_boots_service_scout_compact_v2_only' ||
    review.approval?.runtimeIntegrationAllowed !== true ||
    review.approval?.pullRequestAllowed !== true
  ) {
    throw new Error('Service Scout delegated approval gate is not open');
  }
  return review;
}

function runBlender(options, args) {
  const result = childProcess.spawnSync(
    options.blender,
    [
      '--factory-startup',
      '--background',
      '--threads',
      '1',
      '--python-exit-code',
      '1',
      '--python',
      BUILD_SCRIPT,
      '--',
      ...args
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: options.json ? 'pipe' : 'inherit',
      timeout: 60_000
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Blender production export failed with exit ${result.status}` +
        (result.stderr ? `:\n${result.stderr}` : '')
    );
  }
}

function validateVariant(root, variant) {
  return validateProductionLodSet({
    directory: path.join(root, 'variants', variant.key),
    contract: CONTRACT,
    assetId: 'service_boots',
    modelId: modelId(variant),
    assetClass: 'humanoid_skinned_equipment'
  });
}

function buildVariant(options, variant) {
  const existing = validateVariant(OUTPUT_ROOT, variant);
  if (!(options.reuseValid && existing.valid)) {
    for (const lod of LODS) {
      const output = outputFile(OUTPUT_ROOT, variant, lod);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      runBlender(options, [
        '--source-blend',
        SOURCE_BLEND,
        '--scaffold',
        scaffoldFile(variant),
        '--output',
        output,
        '--sex',
        variant.sex,
        '--body-type',
        variant.bodyType,
        '--model-id',
        modelId(variant),
        '--release-approved',
        '--lod',
        lod
      ]);
    }
  }
  const report = validateVariant(OUTPUT_ROOT, variant);
  if (!report.valid) {
    throw new Error(
      `${variant.key} production LOD validation failed:\n` +
        report.issues.map(issue => `- ${issue}`).join('\n')
    );
  }
  for (const lod of LODS) {
    const source = outputFile(OUTPUT_ROOT, variant, lod);
    const target = outputFile(PUBLIC_ROOT, variant, lod);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return report;
}

function buildModuleManifest() {
  const manifest = {
    schema: 'realm.character-module-set.v1',
    version: 1,
    status: 'approved',
    assetId: 'service_boots',
    assetClass: 'humanoid_skinned_equipment',
    visualSlot: 'feet',
    hideBodyRegions: ['foot_l', 'foot_r'],
    provenance: {
      type: 'original',
      id: 'realm_of_ashes_original'
    },
    fitStatus: 'pending_geometry_check',
    variants: VARIANTS.map(variant => ({
      key: variant.key,
      sex: variant.sex,
      bodyType: variant.bodyType,
      modelId: modelId(variant),
      lodDirectory: `variants/${variant.key}`
    }))
  };
  writeJson(MODULE_MANIFEST, manifest);
  const report = validateCharacterModuleSet({
    manifest: MODULE_MANIFEST,
    contract: CONTRACT,
    fixtureMode: false
  });
  if (!report.valid) {
    throw new Error(
      `Production character-module-set validation failed:\n` +
        report.issues.map(issue => `- ${issue}`).join('\n')
    );
  }
  return { manifest, report };
}

function buildPublicManifest(reports) {
  const manifest = {
    schema: 'realm.runtime-character-module.v1',
    version: 1,
    status: 'approved',
    assetId: 'service_boots',
    designRevision: 'service_scout_compact_v2',
    physicalItemIds: ['scoutBoots'],
    visualSlot: 'feet',
    hideBodyRegions: ['foot_l', 'foot_r'],
    rigId: 'humanoid_v1',
    attachmentMode: 'ankle_split_from_shared_rig',
    defaultVariant: 'male_medium',
    lodDistancesMeters: {
      lod0: 0,
      lod1: 18,
      lod2: 40
    },
    files: VARIANTS.flatMap(variant =>
      LODS.map(
        lod =>
          `/assets/models/characters/outfits/field_worker/service_boots/` +
          `variants/${variant.key}/${modelId(variant)}_${lod}.glb`
      )
    ),
    variants: VARIANTS.map(variant => ({
      key: variant.key,
      sex: variant.sex,
      bodyType: variant.bodyType,
      triangles: reports.get(variant.key).stats.triangles,
      lods: Object.fromEntries(
        LODS.map(lod => [
          lod,
          `/assets/models/characters/outfits/field_worker/service_boots/` +
            `variants/${variant.key}/${modelId(variant)}_${lod}.glb`
        ])
      )
    })),
    authority: {
      equipmentSource: 'server_snapshot.equipment.boots',
      physicalInventoryRequired: true,
      clientCosmeticOverrideAllowed: false
    }
  };
  writeJson(PUBLIC_MANIFEST, manifest);
  return manifest;
}

function buildReleaseManifest(review, reports) {
  const manifest = {
    schema: 'realm.service-boots-production-release.v1',
    version: 1,
    status: 'approved_for_integration',
    assetId: 'service_boots',
    physicalItemId: 'scoutBoots',
    designRevision: 'service_scout_compact_v2',
    artDirection: 'geometry_b_materials_c',
    approval: {
      mode: 'delegated_to_critic',
      userText: 'Пусть критик подтверждает',
      scope: 'service_boots_service_scout_compact_v2_only',
      approvedReviewManifestSha256: APPROVED_REVIEW_SHA256,
      criticVerdict: review.finalCriticConfirmation.verdict,
      runtimeIntegrationAllowed: true,
      pullRequestAllowed: true
    },
    provenance: {
      type: 'original',
      id: 'realm_of_ashes_original',
      thirdPartyGeometryImported: false,
      thirdPartyTexturesImported: false,
      redistributionAllowed: true
    },
    fitEvidence: {
      criticReviewedAllSixVariants: true,
      criticReviewedAllEightPoses: true,
      formalBvhFitStatus: 'pending_geometry_check',
      reviewManifest: evidence(REVIEW_MANIFEST)
    },
    moduleManifest: evidence(MODULE_MANIFEST),
    runtimeManifest: evidence(PUBLIC_MANIFEST),
    generators: [
      evidence(BUILD_SCRIPT),
      evidence(__filename),
      evidence(
        path.join(
          __dirname,
          'validate-service-boots-service-scout-production.js'
        )
      )
    ],
    variants: VARIANTS.map(variant => ({
      key: variant.key,
      modelId: modelId(variant),
      triangles: reports.get(variant.key).stats.triangles,
      source: LODS.map(lod =>
        evidence(outputFile(OUTPUT_ROOT, variant, lod), OUTPUT_ROOT)
      ),
      runtime: LODS.map(lod =>
        evidence(outputFile(PUBLIC_ROOT, variant, lod), PUBLIC_ROOT)
      )
    }))
  };
  writeJson(RELEASE_MANIFEST, manifest);
  return manifest;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const review = validateInputs(options);
  const reports = new Map();
  for (const variant of VARIANTS) {
    const report = buildVariant(options, variant);
    reports.set(variant.key, report);
    if (!options.json) {
      process.stdout.write(`Production Service Scout: ${variant.key}\n`);
    }
  }
  buildModuleManifest();
  buildPublicManifest(reports);
  const release = buildReleaseManifest(review, reports);
  const output = {
    outputRoot: normalizePath(path.relative(REPO_ROOT, OUTPUT_ROOT)),
    publicRoot: normalizePath(path.relative(REPO_ROOT, PUBLIC_ROOT)),
    variants: release.variants.length,
    glbs: release.variants.length * LODS.length,
    sourceBytes: release.variants.reduce(
      (sum, variant) =>
        sum + variant.source.reduce((rowSum, row) => rowSum + row.bytes, 0),
      0
    )
  };
  process.stdout.write(
    options.json
      ? `${JSON.stringify(output)}\n`
      : `Service Scout production собран: ${output.glbs} GLB, ` +
          `${output.sourceBytes} байт.\n`
  );
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
  MODULE_MANIFEST,
  OUTPUT_ROOT,
  PUBLIC_MANIFEST,
  PUBLIC_ROOT,
  RELEASE_MANIFEST,
  VARIANTS,
  modelId,
  outputFile
};
