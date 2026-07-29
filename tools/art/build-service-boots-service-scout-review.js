'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { imageDimensions } = require('./validate-production-glb');
const {
  validateProductionLodSet
} = require('./validate-production-lod-set');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIRST_OUTFIT_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit'
);
const CHARACTER_BASE_ROOT = path.join(
  REPO_ROOT,
  'source-assets',
  'previews',
  'character-base',
  'bc-review'
);
const REDESIGN_ROOT = path.join(
  FIRST_OUTFIT_ROOT,
  'service_boots',
  'redesign-review'
);
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REDESIGN_ROOT,
  'production-preview'
);
const SOURCE_BLEND = path.join(
  REDESIGN_ROOT,
  'service_boots_redesign_working.blend'
);
const CRITIC_REVIEW = path.join(REDESIGN_ROOT, 'CRITIC_REVIEW.md');
const CRITIC_CONFIRMATION = path.join(
  REDESIGN_ROOT,
  'CRITIC_CONFIRMATION.md'
);
const DELEGATED_USER_DECISION = path.join(
  REDESIGN_ROOT,
  'DELEGATED_USER_DECISION.md'
);
const BUILD_SCRIPT = path.join(
  __dirname,
  'blender',
  'build_service_boots_service_scout.py'
);
const RENDER_SCRIPT = path.join(
  __dirname,
  'blender',
  'render_service_boots_service_scout.py'
);
const FIT_RENDER_SCRIPT = path.join(
  __dirname,
  'blender',
  'render_service_boots_fit_review.py'
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
const SEXES = ['female', 'male'];
const BODY_TYPES = ['slim', 'medium', 'large'];
const LODS = ['lod0', 'lod1', 'lod2'];
const VARIANTS = SEXES.flatMap(sex =>
  BODY_TYPES.map(bodyType => ({
    key: `${sex}_${bodyType}`,
    sex,
    bodyType
  }))
);
const RENDER_VARIANTS = new Set(['female_medium', 'male_medium']);
const RENDER_VIEWS = ['front', 'three_quarter', 'side', 'rear', 'sole'];
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
    blender: DEFAULT_BLENDER,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    variants: [],
    skipRenders: false,
    partial: false,
    reuseValid: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--skip-renders') args.skipRenders = true;
    else if (arg === '--partial') args.partial = true;
    else if (arg === '--reuse-valid') args.reuseValid = true;
    else if (
      arg === '--blender' ||
      arg === '--output-directory' ||
      arg === '--variant'
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === '--blender') args.blender = path.resolve(value);
      else if (arg === '--output-directory') {
        args.outputDirectory = path.resolve(value);
      } else {
        args.variants.push(
          ...value
            .split(',')
            .map(row => row.trim())
            .filter(Boolean)
        );
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const allowed = new Set(VARIANTS.map(row => row.key));
  if (args.variants.some(row => !allowed.has(row))) {
    throw new Error(
      `Unknown variant. Allowed values: ${[...allowed].join(', ')}`
    );
  }
  if (!args.variants.length) args.variants = [...allowed];
  return args;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/gu, '/');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function evidence(file, root = REPO_ROOT) {
  const bytes = fs.readFileSync(file);
  const dimensions = imageDimensions(bytes);
  return {
    file: normalizePath(path.relative(root, file)),
    bytes: bytes.length,
    sha256: sha256Buffer(bytes),
    ...(dimensions
      ? {
          dimensions: [dimensions.width, dimensions.height],
          mime: dimensions.mime
        }
      : {})
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runBlenderOnce(blender, leading, script, args) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      blender,
      [
        ...leading,
        '--background',
        '--threads',
        '1',
        '--python-exit-code',
        '1',
        '--python',
        script,
        '--',
        ...args
      ],
      {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'inherit', 'inherit']
      }
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 45_000);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) resolve();
      else {
        reject(
          new Error(
            `Blender failed (${path.basename(script)}), ` +
              `${timedOut ? 'timeout' : `exit ${code}`}`
          )
        );
      }
    });
  });
}

async function runBlender(blender, leading, script, args) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await runBlenderOnce(blender, leading, script, args);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
  }
  throw lastError;
}

function scaffoldFile(variant) {
  return path.join(
    FIRST_OUTFIT_ROOT,
    'service_boots',
    'variants',
    variant.key,
    `service_boots_${variant.key}_lod0.glb`
  );
}

function bodyFile(variant) {
  const fileName = `character_${variant.key}_bc_lod0.glb`;
  return variant.bodyType === 'medium'
    ? path.join(CHARACTER_BASE_ROOT, fileName)
    : path.join(CHARACTER_BASE_ROOT, 'body-types', fileName);
}

function modelId(variant) {
  return `service_boots_${variant.key}_service_scout`;
}

function outputFile(outputDirectory, variant, lod) {
  return path.join(
    outputDirectory,
    'variants',
    variant.key,
    `${modelId(variant)}_${lod}.glb`
  );
}

function validateInputs(options) {
  const required = [
    options.blender,
    SOURCE_BLEND,
    BUILD_SCRIPT,
    RENDER_SCRIPT,
    FIT_RENDER_SCRIPT,
    CRITIC_REVIEW,
    CRITIC_CONFIRMATION,
    DELEGATED_USER_DECISION,
    CONTRACT
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing build input: ${file}`);
  }
  for (const variant of VARIANTS) {
    const inputs = [
      ['approved boot scaffold', scaffoldFile(variant)],
      ['approved body', bodyFile(variant)]
    ];
    for (const [label, file] of inputs) {
      if (!fs.existsSync(file)) {
        throw new Error(`Missing ${label}: ${file}`);
      }
    }
  }
}

async function buildVariant(options, variant) {
  const directory = path.join(
    options.outputDirectory,
    'variants',
    variant.key
  );
  fs.mkdirSync(directory, { recursive: true });
  if (!options.reuseValid) {
    for (const lod of LODS) {
      await runBlender(
        options.blender,
        ['--factory-startup'],
        BUILD_SCRIPT,
        [
          '--source-blend',
          SOURCE_BLEND,
          '--scaffold',
          scaffoldFile(variant),
          '--output',
          outputFile(options.outputDirectory, variant, lod),
          '--sex',
          variant.sex,
          '--body-type',
          variant.bodyType,
          '--lod',
          lod
        ]
      );
      await new Promise(resolve => setTimeout(resolve, 1_500));
    }
  }
  const report = validateProductionLodSet({
    directory,
    contract: CONTRACT,
    assetId: 'service_boots',
    modelId: modelId(variant),
    assetClass: 'humanoid_skinned_equipment'
  });
  if (!report.valid) {
    throw new Error(
      `${variant.key} LOD validation failed:\n` +
        report.issues.map(issue => `- ${issue}`).join('\n')
    );
  }
  return report;
}

async function renderVariant(options, variant) {
  if (!RENDER_VARIANTS.has(variant.key) || options.skipRenders) return [];
  const outputDirectory = path.join(
    options.outputDirectory,
    'renders',
    'standalone'
  );
  const prefix = `service_scout_compact_v2_${variant.key}_lod0`;
  await runBlender(
    options.blender,
    ['--factory-startup'],
    RENDER_SCRIPT,
    [
      '--input',
      outputFile(options.outputDirectory, variant, 'lod0'),
      '--output-dir',
      outputDirectory,
      '--prefix',
      prefix
    ]
  );
  return RENDER_VIEWS.map(view =>
    path.join(outputDirectory, `${prefix}_${view}.png`)
  );
}

function existingReports(options) {
  const reports = new Map();
  for (const variant of VARIANTS) {
    const directory = path.join(
      options.outputDirectory,
      'variants',
      variant.key
    );
    const report = validateProductionLodSet({
      directory,
      contract: CONTRACT,
      assetId: 'service_boots',
      modelId: modelId(variant),
      assetClass: 'humanoid_skinned_equipment'
    });
    if (!report.valid) {
      throw new Error(
        `Complete six-variant package is not valid (${variant.key}):\n` +
          report.issues.map(issue => `- ${issue}`).join('\n')
      );
    }
    reports.set(variant.key, report);
  }
  return reports;
}

async function renderFitVariant(options, variant) {
  if (options.skipRenders) return [];
  const outputDirectory = path.join(
    options.outputDirectory,
    'renders',
    'fit',
    variant.key
  );
  const report = path.join(
    options.outputDirectory,
    'fit',
    `service_scout_${variant.key}_fit-review.json`
  );
  const prefix = `service_scout_${variant.key}`;
  await runBlender(
    options.blender,
    ['--factory-startup'],
    FIT_RENDER_SCRIPT,
    [
      '--body',
      bodyFile(variant),
      '--boots',
      outputFile(options.outputDirectory, variant, 'lod0'),
      '--output-dir',
      outputDirectory,
      '--prefix',
      prefix,
      '--report',
      report
    ]
  );
  return FIT_POSES.map(pose =>
    path.join(outputDirectory, `${prefix}_${pose}.png`)
  );
}

function buildManifest(options, reports, renderFiles) {
  const manifest = {
    schema: 'realm.service-boots-redesign-art-review.v1',
    version: 1,
    status: 'approved_for_runtime_integration',
    reviewId: 'service_boots_service_scout_compact_v2',
    titleRu: 'Служебные ботинки «Полевой разведчик», compact v2',
    artDirection: {
      id: 'geometry_b_materials_c',
      geometry: 'graphic_faceted_b',
      materialsAndWear: 'retro_modern_c'
    },
    correctionBasis: {
      criticVerdict: 'APPROVED',
      correctedFindings: [
        'oversized toe, shaft and split outsole',
        'triangle and material budget overflow',
        'missing humanoid_v1 skin and weights',
        'missing LOD and body-variant matrix',
        'missing production root, metadata, UV and packed ORM'
      ],
      unresolvedGate: 'runtime integration and post-integration critic QA'
    },
    criticReview: {
      reviewer: 'independent_art_critic_agent',
      verdict: 'APPROVED',
      reviewedManifestSha256:
        '303961848c923cf32c9d3405faa8002bb1d7f4e24a72b41485ba51446020dbca',
      report: evidence(CRITIC_REVIEW)
    },
    finalCriticConfirmation: {
      verdict: 'APPROVED',
      confirmedManifestSha256:
        'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9',
      report: evidence(CRITIC_CONFIRMATION)
    },
    userDecision: {
      mode: 'delegated_to_critic',
      userText: 'Пусть критик подтверждает',
      recordedAt: '2026-07-29',
      approvedManifestSha256:
        'd66e7ebac2b8685b06a7345ef3e5a2c0f457ab2d901be6caa079dd460556f9b9',
      scope: 'service_boots_service_scout_compact_v2_only',
      record: evidence(DELEGATED_USER_DECISION)
    },
    provenance: {
      type: 'original',
      id: 'realm_of_ashes_original',
      artisticSource: evidence(SOURCE_BLEND),
      thirdPartyGeometryImported: false,
      thirdPartyTexturesImported: false,
      redistributionStatus: 'original Realm of Ashes review asset'
    },
    generators: [
      evidence(BUILD_SCRIPT),
      evidence(RENDER_SCRIPT),
      evidence(FIT_RENDER_SCRIPT),
      evidence(__filename),
      evidence(
        path.join(
          __dirname,
          'blender',
          'build_character_bc_first_outfit_review.py'
        )
      )
    ],
    contract: evidence(CONTRACT),
    implementation: {
      assetId: 'service_boots',
      assetClass: 'humanoid_skinned_equipment',
      rig: 'humanoid_v1',
      joints: 65,
      maxInfluences: 4,
      materials: 2,
      textureSet: 'Base Color + Normal + packed ORM per material',
      textureSize: [256, 256],
      visualSlot: 'feet',
      hideBodyRegions: ['foot_l', 'foot_r'],
      lods: LODS,
      matrix: '2 sexes x 3 body types',
      designRevision: 'service_scout_compact_v2'
    },
    variants: VARIANTS.map(variant => {
      const report = reports.get(variant.key);
      return {
        key: variant.key,
        sex: variant.sex,
        bodyType: variant.bodyType,
        modelId: modelId(variant),
        triangles: report.stats.triangles,
        totalBytes: report.stats.totalBytes,
        lods: LODS.map(lod =>
          evidence(
            outputFile(options.outputDirectory, variant, lod),
            options.outputDirectory
          )
        )
      };
    }),
    renders: renderFiles.map(file =>
      evidence(file, options.outputDirectory)
    ),
    fitReviews: VARIANTS.map(variant => {
      const reportFile = path.join(
        options.outputDirectory,
        'fit',
        `service_scout_${variant.key}_fit-review.json`
      );
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      return {
        key: variant.key,
        rig: report.rig,
        jointCount: report.jointCount,
        jointSetsMatch: report.jointSetsMatch,
        hideBodyRegions: report.hideBodyRegions,
        hiddenBodyVertices: report.hiddenBodyVertices,
        poses: report.poses.map(pose => ({
          id: pose.id,
          groundShiftMeters: pose.groundShiftMeters,
          image: evidence(
            path.join(
              options.outputDirectory,
              'renders',
              'fit',
              variant.key,
              pose.image
            ),
            options.outputDirectory
          )
        })),
        report: evidence(reportFile, options.outputDirectory)
      };
    }),
    decisionLog: {
      priorIterationFolders: [
        'critic_d2 through critic_d12',
        'fit_final',
        'final'
      ],
      priorUserDecisionRecordAvailable: false,
      currentUserDecisionRecorded: true
    },
    approval: {
      artDirectionApproved: true,
      baseBodiesApproved: true,
      criticApproved: true,
      userAssetsApproved: true,
      runtimeIntegrationAllowed: true,
      pullRequestAllowed: true
    }
  };
  writeJson(
    path.join(
      options.outputDirectory,
      'service-boots-service-scout-review.json'
    ),
    manifest
  );
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateInputs(options);
  const renderFiles = [];
  for (const key of options.variants) {
    const variant = VARIANTS.find(row => row.key === key);
    await buildVariant(options, variant);
    renderFiles.push(...(await renderVariant(options, variant)));
    renderFiles.push(...(await renderFitVariant(options, variant)));
    if (!options.json) {
      process.stdout.write(`Собран Service Scout: ${variant.key}\n`);
    }
  }
  if (options.partial) {
    const output = {
      outputDirectory: normalizePath(
        path.relative(REPO_ROOT, options.outputDirectory)
      ),
      builtVariants: options.variants,
      completePackageChecked: false
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(output)}\n`
        : `Частичная сборка завершена: ${options.variants.join(', ')}.\n`
    );
    return;
  }
  const reports = existingReports(options);
  const allRenderFiles = VARIANTS.filter(variant =>
    RENDER_VARIANTS.has(variant.key)
  ).flatMap(variant => {
    const prefix = `service_scout_compact_v2_${variant.key}_lod0`;
    return RENDER_VIEWS.map(view =>
      path.join(
        options.outputDirectory,
        'renders',
        'standalone',
        `${prefix}_${view}.png`
      )
    );
  });
  const fitRenderFiles = VARIANTS.flatMap(variant =>
    FIT_POSES.map(pose =>
      path.join(
        options.outputDirectory,
        'renders',
        'fit',
        variant.key,
        `service_scout_${variant.key}_${pose}.png`
      )
    )
  );
  const fitReportFiles = VARIANTS.map(variant =>
    path.join(
      options.outputDirectory,
      'fit',
      `service_scout_${variant.key}_fit-review.json`
    )
  );
  const requiredReviewFiles = [
    ...allRenderFiles,
    ...fitRenderFiles,
    ...fitReportFiles
  ];
  const missingReviewFiles = requiredReviewFiles.filter(
    file => !fs.existsSync(file)
  );
  if (missingReviewFiles.length) {
    throw new Error(
      `Review evidence is incomplete:\n` +
        missingReviewFiles.map(file => `- ${file}`).join('\n')
    );
  }
  const completeRenders = [...allRenderFiles, ...fitRenderFiles];
  const manifest = buildManifest(options, reports, completeRenders);
  const output = {
    outputDirectory: normalizePath(
      path.relative(REPO_ROOT, options.outputDirectory)
    ),
    variants: manifest.variants.length,
    glbs: manifest.variants.length * LODS.length,
    renders: manifest.renders.length,
    status: manifest.status,
    runtimeIntegrationAllowed:
      manifest.approval.runtimeIntegrationAllowed,
    pullRequestAllowed: manifest.approval.pullRequestAllowed
  };
  if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else {
    process.stdout.write(
      `Review-пакет Service Scout собран: ` +
        `${output.glbs} GLB, ${output.renders} рендеров; ` +
        `runtime/PR разрешены только для утверждённого этапа.\n`
    );
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BLENDER,
  DEFAULT_OUTPUT_DIRECTORY,
  SOURCE_BLEND,
  VARIANTS,
  LODS,
  parseArgs
};
