const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseGlb } = require('./validate-production-glb');
const {
  validateCharacterBodySet
} = require('./validate-character-body-set');
const {
  lodFingerprint,
  validateProductionLodSet
} = require('./validate-production-lod-set');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);

function parseArgs(argv) {
  const args = {
    contract: DEFAULT_CONTRACT,
    fixtureMode: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--fixture-mode') args.fixtureMode = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--manifest') {
      if (!value) throw new Error('--manifest requires a path');
      args.manifest = path.resolve(value);
      index += 1;
    } else if (arg === '--contract') {
      if (!value) throw new Error('--contract requires a path');
      args.contract = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.manifest) throw new Error('--manifest is required');
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function sameSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every(value => actual.includes(value))
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function moduleDefinitionHash(manifest) {
  const definition = {
    schema: manifest.schema,
    version: manifest.version,
    assetId: manifest.assetId,
    assetClass: manifest.assetClass,
    visualSlot: manifest.visualSlot,
    hideBodyRegions: manifest.hideBodyRegions,
    provenance: manifest.provenance,
    variants: (manifest.variants || [])
      .map(variant => ({
        key: variant.key,
        sex: variant.sex,
        bodyType: variant.bodyType,
        modelId: variant.modelId,
        lodDirectory: variant.lodDirectory
      }))
      .sort((left, right) => String(left.key).localeCompare(String(right.key)))
  };
  return sha256Buffer(Buffer.from(JSON.stringify(definition), 'utf8'));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveVariantDirectory(manifestFile, relativeDirectory) {
  return path.resolve(path.dirname(manifestFile), relativeDirectory || '');
}

function rootExtras(file) {
  const parsed = parseGlb(file);
  const gltf = parsed.json;
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const root = gltf.nodes?.[scene?.nodes?.[0]];
  return {
    extras: root?.extras || {},
    fingerprint: lodFingerprint(parsed)
  };
}

function validatePassedFitReport(
  manifest,
  contract,
  contractFile,
  manifestFile,
  reportFile,
  report,
  issues
) {
  const fitContract = contract.characterFitContract;
  const bodyContract = contract.characterBodySetContract;
  const moduleContract = contract.characterModuleSetContract;
  addIssue(
    issues,
    report.schema === fitContract.schema && report.version === 1 && report.valid === true,
    'Character fit report is invalid or did not pass'
  );
  addIssue(
    issues,
    report.status === (manifest.status === 'fixture' ? 'fixture' : 'review_candidate'),
    'Character fit report status does not match the module stage'
  );
  addIssue(
    issues,
    report.assetId === manifest.assetId &&
      report.algorithm === fitContract.algorithm &&
      report.rigId === contract.humanoidContract.rigId &&
      report.moduleDefinitionSha256 === moduleDefinitionHash(manifest) &&
      sameJson(report.hideBodyRegions, manifest.hideBodyRegions) &&
      report.generator === 'tools/art/blender/check_character_fit.py' &&
      typeof report.blenderVersion === 'string' &&
      report.blenderVersion.length > 0,
    'Character fit report does not match the current module definition'
  );
  addIssue(
    issues,
    report.thresholds?.maximumIntersectingTrianglePairs ===
      fitContract.maximumIntersectingTrianglePairs &&
      report.thresholds?.maximumPenetratingGarmentVertices ===
        fitContract.maximumPenetratingGarmentVertices &&
      report.thresholds?.penetrationEpsilonMeters ===
        fitContract.penetrationEpsilonMeters &&
      report.thresholds?.maximumMedianGarmentClearanceMeters ===
        fitContract.maximumMedianGarmentClearanceMeters,
    'Character fit report thresholds drifted from the production contract'
  );
  const requiredPoseIds = fitContract.requiredPoses.map(pose => pose.id);
  addIssue(
    issues,
    sameSet(report.requiredPoses, requiredPoseIds),
    'Character fit report does not cover the required poses'
  );
  const reportVariants = report.variants || [];
  addIssue(
    issues,
    sameSet(
      reportVariants.map(variant => variant.key),
      moduleContract.variantKeys
    ),
    'Character fit report does not cover all body variants'
  );
  const bodyManifestFile = report.bodyManifest?.file
    ? path.resolve(path.dirname(reportFile), report.bodyManifest.file)
    : null;
  const bodyManifestExists =
    !!bodyManifestFile &&
    fs.existsSync(bodyManifestFile) &&
    fs.statSync(bodyManifestFile).isFile();
  addIssue(issues, bodyManifestExists, 'Character fit report body manifest is missing');
  let bodyManifest = null;
  if (bodyManifestExists) {
    addIssue(
      issues,
      sha256File(bodyManifestFile) === report.bodyManifest.sha256,
      'Character fit report body manifest hash drifted'
    );
    bodyManifest = readJson(bodyManifestFile);
    addIssue(
      issues,
      bodyManifest.schema === fitContract.bodySetSchema &&
        bodyManifest.version === 1 &&
        (manifest.status === 'fixture'
          ? bodyManifest.status === 'fixture'
          : bodyManifest.status !== 'fixture') &&
        bodyManifest.rigId === contract.humanoidContract.rigId &&
        sameJson(
          bodyManifest.baseState,
          bodyContract.requiredManifestBaseState
        ) &&
        contract.metadataContract.provenanceTypes.includes(
          bodyManifest.provenance?.type
        ) &&
        typeof bodyManifest.provenance?.id === 'string' &&
        bodyManifest.provenance.id.length > 0 &&
        sameSet(
          (bodyManifest.variants || []).map(variant => variant.key),
          moduleContract.variantKeys
        ),
      'Character fit report body manifest schema is invalid'
    );
    if (manifest.status !== 'fixture') {
      const bodySetReport = validateCharacterBodySet({
        manifest: bodyManifestFile,
        contract: contractFile,
        fixtureMode: false
      });
      for (const issue of bodySetReport.issues) {
        issues.push(`fit body set: ${issue}`);
      }
    }
  }
  for (const variant of manifest.variants || []) {
    const reported = reportVariants.find(row => row.key === variant.key);
    if (!reported) continue;
    const moduleLod0 = path.resolve(
      path.dirname(manifestFile),
      variant.lodDirectory,
      `${variant.modelId}_lod0.glb`
    );
    addIssue(
      issues,
      fs.existsSync(moduleLod0) &&
        sha256File(moduleLod0) === reported.moduleSha256,
      `${variant.key}: fit report module hash drifted`
    );
    const bodyVariant = (bodyManifest?.variants || []).find(
      row => row.key === variant.key
    );
    addIssue(
      issues,
      bodyVariant?.sex === variant.sex &&
        bodyVariant?.bodyType === variant.bodyType &&
        bodyVariant?.assetId === variant.key &&
        bodyVariant?.modelId === variant.key &&
        typeof bodyVariant?.lodDirectory === 'string' &&
        bodyVariant.lodDirectory.length > 0 &&
        reported.sex === variant.sex &&
        reported.bodyType === variant.bodyType,
      `${variant.key}: fit report variant metadata drifted`
    );
    const bodyFile =
      bodyVariant?.lodDirectory && bodyVariant?.modelId
      ? path.resolve(
          path.dirname(bodyManifestFile),
          bodyVariant.lodDirectory,
          `${bodyVariant.modelId}_lod0.glb`
        )
      : null;
    addIssue(
      issues,
      !!bodyFile &&
        fs.existsSync(bodyFile) &&
        sha256File(bodyFile) === reported.bodySha256,
      `${variant.key}: fit report body hash drifted`
    );
    const poses = reported.poses || [];
    let metricsValid = true;
    for (const pose of poses) {
      const verdict =
        Number.isInteger(pose.intersectingTrianglePairs) &&
        pose.intersectingTrianglePairs >= 0 &&
        Number.isInteger(pose.penetratingGarmentVertices) &&
        pose.penetratingGarmentVertices >= 0 &&
        Number.isFinite(pose.medianGarmentClearanceMeters) &&
        pose.medianGarmentClearanceMeters >= 0 &&
        pose.intersectingTrianglePairs <=
          fitContract.maximumIntersectingTrianglePairs &&
        pose.penetratingGarmentVertices <=
          fitContract.maximumPenetratingGarmentVertices &&
        pose.medianGarmentClearanceMeters <=
          fitContract.maximumMedianGarmentClearanceMeters;
      if (pose.valid !== verdict || !verdict) metricsValid = false;
    }
    addIssue(
      issues,
      reported.valid === true &&
        sameSet(
          poses.map(pose => pose.id),
          requiredPoseIds
        ) &&
        metricsValid,
      `${variant.key}: fit report poses did not all pass`
    );
  }
}

function validateFitStatus(manifest, contract, contractFile, manifestFile, issues) {
  const moduleContract = contract.characterModuleSetContract;
  const allowed = new Set([
    moduleContract.fitStatusBeforeGeometryTest,
    moduleContract.fitStatusAfterPassing
  ]);
  addIssue(issues, allowed.has(manifest.fitStatus), `Invalid fit status: ${manifest.fitStatus}`);
  if (manifest.fitStatus === moduleContract.fitStatusAfterPassing) {
    addIssue(issues, !!manifest.fitReport, 'geometry_check_passed requires fitReport');
    const fitReportFile = manifest.fitReport
      ? path.resolve(path.dirname(manifestFile), manifest.fitReport)
      : null;
    const fitReportExists =
      !!fitReportFile &&
      fs.existsSync(fitReportFile) &&
      fs.statSync(fitReportFile).isFile();
    addIssue(issues, fitReportExists, 'Character fit report does not exist');
    if (fitReportExists) {
      try {
        validatePassedFitReport(
          manifest,
          contract,
          contractFile,
          manifestFile,
          fitReportFile,
          readJson(fitReportFile),
          issues
        );
      } catch (error) {
        issues.push(`Character fit report could not be validated: ${error.message || error}`);
      }
    }
  } else {
    addIssue(
      issues,
      !manifest.fitReport,
      'pending_geometry_check must not reference a completed fit report'
    );
  }
}

function validateCharacterModuleSet(rawOptions) {
  const options = {
    contract: DEFAULT_CONTRACT,
    fixtureMode: false,
    ...rawOptions
  };
  const issues = [];
  const warnings = [];
  addIssue(issues, fs.existsSync(options.manifest), `Module manifest does not exist: ${options.manifest}`);
  addIssue(issues, fs.existsSync(options.contract), `Production contract does not exist: ${options.contract}`);
  if (issues.length) return { valid: false, issues, warnings, variants: [], stats: {} };

  const manifest = readJson(options.manifest);
  const contract = readJson(options.contract);
  const moduleContract = contract.characterModuleSetContract;
  addIssue(issues, manifest.schema === moduleContract.schema, 'Character-module-set schema is invalid');
  addIssue(issues, manifest.version === 1, 'Character-module-set version must be 1');
  addIssue(
    issues,
    ['fixture', 'review_candidate', 'approved'].includes(manifest.status),
    `Invalid character-module-set status: ${manifest.status}`
  );
  if (!contract.artDirection.finalArtProductionAllowed) {
    addIssue(
      issues,
      manifest.status !== 'approved',
      'Character module set cannot be approved before art-direction approval'
    );
  }
  addIssue(
    issues,
    manifest.assetClass === 'humanoid_skinned_equipment',
    'Character module set must use humanoid_skinned_equipment'
  );
  addIssue(
    issues,
    moduleContract.allowedVisualSlots.includes(manifest.visualSlot),
    `Invalid character-module visual slot: ${manifest.visualSlot}`
  );
  addIssue(
    issues,
    Array.isArray(manifest.hideBodyRegions) &&
      manifest.hideBodyRegions.length > 0 &&
      manifest.hideBodyRegions.every(region => contract.humanoidContract.bodyRegions.includes(region)),
    'Character-module body-region mask is empty or invalid'
  );
  addIssue(
    issues,
    duplicateValues(manifest.hideBodyRegions || []).length === 0,
    'Character-module body-region mask contains duplicates'
  );
  addIssue(
    issues,
    typeof manifest.assetId === 'string' && manifest.assetId.length > 0,
    'Character-module assetId is missing'
  );
  const assetLibrary = readJson(
    path.resolve(REPO_ROOT, contract.linkedManifests.assetLibrary)
  );
  const knownItem = (assetLibrary.inventoryItems || []).some(row => row.id === manifest.assetId);
  const firstOutfit = new Set(contract.humanoidContract.firstOutfitItems || []);
  addIssue(
    issues,
    knownItem || firstOutfit.has(manifest.assetId),
    `${manifest.assetId}: module is absent from the item catalog and first outfit`
  );
  addIssue(
    issues,
    contract.metadataContract.provenanceTypes.includes(manifest.provenance?.type) &&
      typeof manifest.provenance?.id === 'string' &&
      manifest.provenance.id.length > 0,
    'Character-module provenance is invalid'
  );
  validateFitStatus(
    manifest,
    contract,
    options.contract,
    options.manifest,
    issues
  );

  if (options.fixtureMode) {
    addIssue(issues, manifest.status === 'fixture', 'Fixture validation requires status=fixture');
    addIssue(
      issues,
      isWithin(os.tmpdir(), options.manifest),
      'Fixture character-module manifest must stay inside the temporary directory'
    );
  } else {
    addIssue(issues, manifest.status !== 'fixture', 'Production validation cannot use a fixture manifest');
  }

  const variants = manifest.variants || [];
  addIssue(
    issues,
    sameSet(variants.map(row => row.key), moduleContract.variantKeys),
    'Character-module variants must cover the exact 2x3 matrix'
  );
  const duplicateKeys = duplicateValues(variants.map(row => row.key));
  addIssue(issues, duplicateKeys.length === 0, `Duplicate module variants: ${duplicateKeys.join(', ')}`);

  const reports = [];
  let referenceFingerprint = null;
  for (const variant of variants) {
    for (const field of moduleContract.requiredVariantFields) {
      addIssue(
        issues,
        Object.prototype.hasOwnProperty.call(variant, field),
        `${variant.key || '<unknown variant>'}: missing ${field}`
      );
    }
    const expectedKey = `${variant.sex}_${variant.bodyType}`;
    addIssue(issues, variant.key === expectedKey, `${variant.key}: sex/bodyType key mismatch`);
    addIssue(
      issues,
      contract.humanoidContract.variantMatrix.sexes.includes(variant.sex),
      `${variant.key}: invalid sex ${variant.sex}`
    );
    addIssue(
      issues,
      contract.humanoidContract.variantMatrix.bodyTypes.includes(variant.bodyType),
      `${variant.key}: invalid body type ${variant.bodyType}`
    );
    addIssue(
      issues,
      typeof variant.modelId === 'string' &&
        variant.modelId.endsWith(`_${variant.key}`),
      `${variant.key}: modelId must end with the exact variant key`
    );
    const directory = resolveVariantDirectory(options.manifest, variant.lodDirectory);
    addIssue(
      issues,
      fs.existsSync(directory) && fs.statSync(directory).isDirectory(),
      `${variant.key}: LOD directory does not exist`
    );
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    const lodReport = validateProductionLodSet({
      directory,
      contract: options.contract,
      assetId: manifest.assetId,
      modelId: variant.modelId,
      assetClass: manifest.assetClass
    });
    for (const issue of lodReport.issues) issues.push(`${variant.key}: ${issue}`);
    for (const warning of lodReport.warnings) warnings.push(`${variant.key}: ${warning}`);
    const inspectedTiers = {};
    for (const lod of lodReport.stats.tiers || []) {
      const lodFile = lodReport.lods[lod]?.file;
      if (!lodFile) continue;
      try {
        inspectedTiers[lod] = rootExtras(lodFile);
      } catch (error) {
        issues.push(
          `${variant.key}: ${lod.toUpperCase()} module metadata could not be inspected: ` +
            `${error.message || error}`
        );
        continue;
      }
      const inspected = inspectedTiers[lod];
      for (const field of moduleContract.requiredRootExtras) {
        addIssue(
          issues,
          Object.prototype.hasOwnProperty.call(inspected.extras, field),
          `${variant.key}: ${lod.toUpperCase()} root metadata is missing ${field}`
        );
      }
      addIssue(
        issues,
        inspected.extras.realm_visual_slot === manifest.visualSlot,
        `${variant.key}: ${lod.toUpperCase()} visual slot metadata drifted`
      );
      addIssue(
        issues,
        inspected.extras.realm_sex === variant.sex,
        `${variant.key}: ${lod.toUpperCase()} sex metadata drifted`
      );
      addIssue(
        issues,
        inspected.extras.realm_body_type === variant.bodyType,
        `${variant.key}: ${lod.toUpperCase()} body-type metadata drifted`
      );
      addIssue(
        issues,
        sameJson(
          inspected.extras.realm_hide_body_regions,
          manifest.hideBodyRegions
        ),
        `${variant.key}: ${lod.toUpperCase()} body-region mask metadata drifted`
      );
      addIssue(
        issues,
        inspected.fingerprint.rootMetadata.provenanceType === manifest.provenance.type &&
          inspected.fingerprint.rootMetadata.provenanceId === manifest.provenance.id,
        `${variant.key}: ${lod.toUpperCase()} provenance drifted from the module manifest`
      );
    }
    const inspected = inspectedTiers.lod0;
    if (!inspected) continue;
    const shared = {
      materials: inspected.fingerprint.materials,
      images: inspected.fingerprint.images,
      sockets: inspected.fingerprint.sockets,
      jointNames: inspected.fingerprint.jointNames
    };
    if (!referenceFingerprint) referenceFingerprint = shared;
    else {
      for (const field of ['materials', 'images', 'sockets', 'jointNames']) {
        addIssue(
          issues,
          sameJson(shared[field], referenceFingerprint[field]),
          `${variant.key}: ${field} drifted across body variants`
        );
      }
    }
    reports.push({
      key: variant.key,
      directory,
      modelId: variant.modelId,
      valid: lodReport.valid,
      tiers: lodReport.stats.tiers,
      triangles: lodReport.stats.triangles,
      joints: lodReport.lods.lod0?.report?.stats?.joints ?? null
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    variants: reports,
    stats: {
      assetId: manifest.assetId,
      visualSlot: manifest.visualSlot,
      fitStatus: manifest.fitStatus,
      requiredVariants: moduleContract.variantKeys.length,
      validatedVariants: reports.length,
      hideBodyRegions: manifest.hideBodyRegions || []
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateCharacterModuleSet(args);
  const output = {
    manifest: path.relative(REPO_ROOT, args.manifest).replace(/\\/g, '/'),
    valid: report.valid,
    ...report.stats,
    variants: report.variants,
    issues: report.issues,
    warnings: report.warnings
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (report.valid) {
    console.log(
      `Комплект модульной одежды корректен: ${output.assetId}, ` +
      `${output.validatedVariants}/${output.requiredVariants} вариантов, ` +
      `слот ${output.visualSlot}, маски ${output.hideBodyRegions.join(', ')}.`
    );
  } else {
    console.error(
      `Ошибки комплекта модульной одежды:\n${report.issues.map(issue => `- ${issue}`).join('\n')}`
    );
  }
  for (const warning of report.warnings) console.warn(`Предупреждение: ${warning}`);
  if (!report.valid) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exit(1);
  }
}

module.exports = {
  moduleDefinitionHash,
  parseArgs,
  validateCharacterModuleSet
};
