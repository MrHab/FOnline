const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseGlb } = require('./validate-production-glb');
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

function meshBounds(gltf, meshIndex) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const primitive of gltf.meshes?.[meshIndex]?.primitives || []) {
    const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
    if (
      !Array.isArray(accessor?.min) ||
      !Array.isArray(accessor?.max) ||
      accessor.min.length !== 3 ||
      accessor.max.length !== 3
    ) {
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], accessor.min[axis]);
      maximum[axis] = Math.max(maximum[axis], accessor.max[axis]);
    }
  }
  return {
    min: minimum,
    max: maximum,
    size: minimum.map((value, axis) => maximum[axis] - value)
  };
}

function combinedBounds(gltf) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let meshIndex = 0; meshIndex < (gltf.meshes || []).length; meshIndex += 1) {
    const bounds = meshBounds(gltf, meshIndex);
    if (![...bounds.min, ...bounds.max].every(Number.isFinite)) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], bounds.min[axis]);
      maximum[axis] = Math.max(maximum[axis], bounds.max[axis]);
    }
  }
  return {
    min: minimum,
    max: maximum,
    size: minimum.map((value, axis) => maximum[axis] - value)
  };
}

function parentIndexByNode(gltf) {
  const parents = new Map();
  for (const [parentIndex, node] of (gltf.nodes || []).entries()) {
    for (const childIndex of node.children || []) {
      parents.set(childIndex, parentIndex);
    }
  }
  return parents;
}

function inspectBodyGlb(file, variant, contract, issues, label) {
  const parsed = parseGlb(file);
  const gltf = parsed.json;
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const root = gltf.nodes?.[scene?.nodes?.[0]];
  const extras = root?.extras || {};
  const bodyContract = contract.characterBodySetContract;
  for (const field of bodyContract.requiredRootExtras) {
    addIssue(
      issues,
      Object.prototype.hasOwnProperty.call(extras, field),
      `${label}: root metadata is missing ${field}`
    );
  }
  for (const [field, expected] of Object.entries(bodyContract.requiredRootValues)) {
    addIssue(
      issues,
      sameJson(extras[field], expected),
      `${label}: root ${field} drifted from the body contract`
    );
  }
  addIssue(
    issues,
    extras.realm_sex === variant.sex &&
      extras.realm_body_type === variant.bodyType,
    `${label}: sex/body-type metadata drifted`
  );

  const regionPattern = new RegExp(bodyContract.bodyRegionNodePattern);
  const regionNodes = (gltf.nodes || [])
    .map((node, index) => ({ node, index }))
    .filter(row => regionPattern.test(row.node.name || ''));
  const expectedRegionNames = contract.humanoidContract.bodyRegions.map(
    region => `mesh_body_region_${region}`
  );
  addIssue(
    issues,
    sameSet(
      regionNodes.map(row => row.node.name),
      expectedRegionNames
    ),
    `${label}: body-region nodes do not cover all 17 regions`
  );
  addIssue(
    issues,
    duplicateValues(regionNodes.map(row => row.node.name)).length === 0,
    `${label}: duplicate body-region node names`
  );
  const regionMeshIndices = regionNodes.map(row => row.node.mesh);
  addIssue(
    issues,
    regionMeshIndices.every(Number.isInteger) &&
      new Set(regionMeshIndices).size === regionNodes.length,
    `${label}: every body region must use a unique mesh`
  );
  for (const { node } of regionNodes) {
    addIssue(
      issues,
      node.skin === 0 &&
        gltf.meshes?.[node.mesh]?.name === node.name,
      `${label}: ${node.name} must use skin 0 and a same-named mesh`
    );
  }

  const nodeNames = (gltf.nodes || []).map(node => String(node.name || ''));
  for (const token of bodyContract.forbiddenBakedNodeTokens) {
    addIssue(
      issues,
      !nodeNames.some(name => name.toLowerCase().includes(token)),
      `${label}: forbidden baked-equipment node token: ${token}`
    );
  }
  const materialNames = (gltf.materials || []).map(material => material.name);
  for (const material of bodyContract.requiredMaterialNames) {
    addIssue(
      issues,
      materialNames.includes(material),
      `${label}: required body material is missing: ${material}`
    );
  }

  const socketRows = (gltf.nodes || [])
    .map((node, index) => ({ node, index }))
    .filter(row => String(row.node.name || '').startsWith('socket_'));
  addIssue(
    issues,
    sameSet(
      socketRows.map(row => row.node.name),
      contract.humanoidContract.characterSockets
    ),
    `${label}: body sockets do not match the humanoid contract`
  );
  const parents = parentIndexByNode(gltf);
  const jointIndices = new Set(gltf.skins?.[0]?.joints || []);
  for (const socket of socketRows) {
    addIssue(
      issues,
      jointIndices.has(parents.get(socket.index)),
      `${label}: ${socket.node.name} must be parented to a rig joint`
    );
  }

  const torsoNode = regionNodes.find(
    row => row.node.name === 'mesh_body_region_torso_upper'
  );
  const torsoBounds = Number.isInteger(torsoNode?.node.mesh)
    ? meshBounds(gltf, torsoNode.node.mesh)
    : { size: [NaN, NaN, NaN] };
  const bounds = combinedBounds(gltf);
  return {
    extras,
    fingerprint: lodFingerprint(parsed),
    animations: (gltf.animations || []).map(animation => animation.name),
    bounds,
    torsoWidth: torsoBounds.size[0]
  };
}

function validateBodyTypeWidths(reports, contract, issues) {
  const body = contract.characterBodySetContract;
  for (const sex of contract.humanoidContract.variantMatrix.sexes) {
    const widths = Object.fromEntries(
      reports
        .filter(report => report.sex === sex)
        .map(report => [report.bodyType, report.torsoWidth])
    );
    for (const [smaller, larger] of [
      ['slim', 'medium'],
      ['medium', 'large']
    ]) {
      const ratio = widths[larger] / widths[smaller];
      addIssue(
        issues,
        Number.isFinite(ratio) &&
          ratio >= body.productionBounds.minimumTorsoWidthStepRatio &&
          ratio <= body.productionBounds.maximumTorsoWidthStepRatio,
        `${sex}: ${larger}/${smaller} torso-width ratio ${ratio} is outside the body contract`
      );
    }
  }
}

function validateCharacterBodySet(rawOptions) {
  const options = {
    contract: DEFAULT_CONTRACT,
    fixtureMode: false,
    ...rawOptions
  };
  const issues = [];
  const warnings = [];
  addIssue(
    issues,
    fs.existsSync(options.manifest),
    `Body manifest does not exist: ${options.manifest}`
  );
  addIssue(
    issues,
    fs.existsSync(options.contract),
    `Production contract does not exist: ${options.contract}`
  );
  if (issues.length) return { valid: false, issues, warnings, variants: [], stats: {} };

  const manifest = readJson(options.manifest);
  const contract = readJson(options.contract);
  const bodyContract = contract.characterBodySetContract;
  addIssue(issues, manifest.schema === bodyContract.schema, 'Character-body-set schema is invalid');
  addIssue(issues, manifest.version === 1, 'Character-body-set version must be 1');
  addIssue(
    issues,
    ['fixture', 'review_candidate', 'approved'].includes(manifest.status),
    `Invalid character-body-set status: ${manifest.status}`
  );
  if (!contract.artDirection.finalArtProductionAllowed) {
    addIssue(
      issues,
      manifest.status !== 'approved',
      'Character body set cannot be approved before art-direction approval'
    );
  }
  addIssue(
    issues,
    manifest.rigId === contract.humanoidContract.rigId,
    `Character body set must use ${contract.humanoidContract.rigId}`
  );
  addIssue(
    issues,
    sameJson(manifest.baseState, bodyContract.requiredManifestBaseState),
    'Character body-set base state must be barefoot underwear with no equipment'
  );
  addIssue(
    issues,
    contract.metadataContract.provenanceTypes.includes(manifest.provenance?.type) &&
      typeof manifest.provenance?.id === 'string' &&
      manifest.provenance.id.length > 0,
    'Character body-set provenance is invalid'
  );
  if (options.fixtureMode) {
    addIssue(issues, manifest.status === 'fixture', 'Fixture validation requires status=fixture');
    addIssue(
      issues,
      isWithin(os.tmpdir(), options.manifest),
      'Fixture character-body manifest must stay inside the temporary directory'
    );
  } else {
    addIssue(issues, manifest.status !== 'fixture', 'Production validation cannot use a fixture manifest');
  }

  const variants = manifest.variants || [];
  addIssue(
    issues,
    sameSet(variants.map(row => row.key), bodyContract.variantKeys),
    'Character-body variants must cover the exact 2x3 matrix'
  );
  const duplicateKeys = duplicateValues(variants.map(row => row.key));
  addIssue(issues, duplicateKeys.length === 0, `Duplicate body variants: ${duplicateKeys.join(', ')}`);

  const reports = [];
  let reference = null;
  for (const variant of variants) {
    for (const field of bodyContract.requiredVariantFields) {
      addIssue(
        issues,
        Object.prototype.hasOwnProperty.call(variant, field),
        `${variant.key || '<unknown variant>'}: missing ${field}`
      );
    }
    addIssue(
      issues,
      variant.key === `${variant.sex}_${variant.bodyType}`,
      `${variant.key}: sex/bodyType key mismatch`
    );
    addIssue(
      issues,
      variant.assetId === variant.key &&
        variant.modelId === variant.key,
      `${variant.key}: body assetId and modelId must equal the variant key`
    );
    const directory = path.resolve(
      path.dirname(options.manifest),
      variant.lodDirectory || ''
    );
    addIssue(
      issues,
      fs.existsSync(directory) && fs.statSync(directory).isDirectory(),
      `${variant.key}: LOD directory does not exist`
    );
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    const lodReport = validateProductionLodSet({
      directory,
      contract: options.contract,
      assetId: variant.assetId,
      modelId: variant.modelId,
      assetClass: 'humanoid_body'
    });
    for (const issue of lodReport.issues) issues.push(`${variant.key}: ${issue}`);
    for (const warning of lodReport.warnings) warnings.push(`${variant.key}: ${warning}`);

    const inspectedTiers = {};
    for (const lod of lodReport.stats.tiers || []) {
      const file = lodReport.lods[lod]?.file;
      if (!file) continue;
      try {
        inspectedTiers[lod] = inspectBodyGlb(
          file,
          variant,
          contract,
          issues,
          `${variant.key}/${lod}`
        );
      } catch (error) {
        issues.push(`${variant.key}/${lod}: body inspection failed: ${error.message || error}`);
      }
      if (!options.fixtureMode) {
        const target = bodyContract.targetTriangles[lod];
        const triangles = lodReport.lods[lod]?.report?.stats?.triangles;
        addIssue(
          issues,
          Number.isFinite(triangles) &&
            triangles >= target.min &&
            triangles <= target.max,
          `${variant.key}/${lod}: triangle count ${triangles} is outside target ${target.min}-${target.max}`
        );
      }
    }
    const lod0 = inspectedTiers.lod0;
    if (!lod0) continue;
    addIssue(
      issues,
      lod0.fingerprint.rootMetadata.provenanceType === manifest.provenance.type &&
        lod0.fingerprint.rootMetadata.provenanceId === manifest.provenance.id,
      `${variant.key}: provenance drifted from the body manifest`
    );
    if (!options.fixtureMode) {
      const height = lod0.bounds.size[1];
      addIssue(
        issues,
        height >= bodyContract.productionBounds.heightMeters.min &&
          height <= bodyContract.productionBounds.heightMeters.max,
        `${variant.key}: body height ${height}m is outside the 1.75-1.85m art standard`
      );
    }
    const shared = {
      materials: lod0.fingerprint.materials,
      images: lod0.fingerprint.images,
      sockets: lod0.fingerprint.sockets,
      jointNames: lod0.fingerprint.jointNames,
      animations: lod0.animations
    };
    if (!reference) reference = shared;
    else {
      for (const field of [
        'materials',
        'images',
        'sockets',
        'jointNames',
        'animations'
      ]) {
        addIssue(
          issues,
          sameJson(shared[field], reference[field]),
          `${variant.key}: ${field} drifted across body variants`
        );
      }
    }
    reports.push({
      key: variant.key,
      sex: variant.sex,
      bodyType: variant.bodyType,
      modelId: variant.modelId,
      directory,
      valid: lodReport.valid,
      tiers: lodReport.stats.tiers,
      triangles: lodReport.stats.triangles,
      height: lod0.bounds.size[1],
      torsoWidth: lod0.torsoWidth,
      joints: lodReport.lods.lod0?.report?.stats?.joints ?? null,
      animations: lod0.animations.length
    });
  }
  if (!options.fixtureMode) validateBodyTypeWidths(reports, contract, issues);

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    variants: reports,
    stats: {
      rigId: manifest.rigId,
      requiredVariants: bodyContract.variantKeys.length,
      validatedVariants: reports.length,
      bodyRegions: contract.humanoidContract.bodyRegions.length,
      baseState: manifest.baseState
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateCharacterBodySet(args);
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
      `Набор базовых тел корректен: ${output.validatedVariants}/${output.requiredVariants} ` +
        `вариантов, ${output.bodyRegions} областей тела, риг ${output.rigId}.`
    );
  } else {
    console.error(
      `Ошибки набора базовых тел:\n${report.issues.map(issue => `- ${issue}`).join('\n')}`
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
  parseArgs,
  validateBodyTypeWidths,
  validateCharacterBodySet
};
