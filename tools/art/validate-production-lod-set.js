const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  parseGlb,
  toModelId,
  validateProductionGlb
} = require('./validate-production-glb');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);
const LOD_IDS = ['lod0', 'lod1', 'lod2'];

function parseArgs(argv) {
  const args = {
    contract: DEFAULT_CONTRACT,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--json') args.json = true;
    else if (arg === '--directory') {
      if (!value) throw new Error('--directory requires a path');
      args.directory = path.resolve(value);
      index += 1;
    } else if (arg === '--asset-id') {
      if (!value) throw new Error('--asset-id requires a runtime asset id');
      args.assetId = value;
      index += 1;
    } else if (arg === '--model-id') {
      if (!value) throw new Error('--model-id requires a model id');
      args.modelId = value;
      index += 1;
    } else if (arg === '--class') {
      if (!value) throw new Error('--class requires an asset class');
      args.assetClass = value;
      index += 1;
    } else if (arg === '--contract') {
      if (!value) throw new Error('--contract requires a path');
      args.contract = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  for (const field of ['directory', 'assetId', 'assetClass']) {
    if (!args[field]) throw new Error(`Missing required argument: ${field}`);
  }
  args.modelId = args.modelId || toModelId(args.assetId);
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function nodeTransform(node) {
  return {
    translation: node.translation || [0, 0, 0],
    rotation: node.rotation || [0, 0, 0, 1],
    scale: node.scale || [1, 1, 1],
    matrix: node.matrix || null
  };
}

function imageFingerprint(gltf, binary, image) {
  const view = gltf.bufferViews?.[image.bufferView];
  if (!view) return { name: image.name || null, sha256: null };
  const start = Number(view.byteOffset || 0);
  const end = start + Number(view.byteLength || 0);
  if (start < 0 || end > binary.length || end <= start) {
    return { name: image.name || null, sha256: null };
  }
  return {
    name: image.name || null,
    mimeType: image.mimeType || null,
    sha256: sha256(binary.subarray(start, end))
  };
}

function lodFingerprint(parsed) {
  const gltf = parsed.json;
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const root = gltf.nodes?.[scene?.nodes?.[0]];
  const sockets = (gltf.nodes || [])
    .filter(node => String(node.name || '').startsWith('socket_'))
    .map(node => ({
      name: node.name,
      transform: nodeTransform(node)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const jointNames = (gltf.skins?.[0]?.joints || []).map(
    nodeIndex => gltf.nodes?.[nodeIndex]?.name || null
  );
  return {
    rootMetadata: {
      assetSchema: root?.extras?.realm_asset_schema,
      assetId: root?.extras?.realm_asset_id,
      assetClass: root?.extras?.realm_asset_class,
      originProfile: root?.extras?.realm_origin_profile,
      approvalStatus: root?.extras?.realm_approval_status,
      provenanceType: root?.extras?.realm_provenance_type,
      provenanceId: root?.extras?.realm_provenance_id,
      rigId: root?.extras?.realm_rig_id || null
    },
    materials: (gltf.materials || []).map(material => material.name || null),
    images: (gltf.images || []).map(image =>
      imageFingerprint(gltf, parsed.binary, image)
    ),
    sockets,
    jointNames
  };
}

function validateCrossLod(lods, contract, assetClass, issues) {
  const existing = LOD_IDS.filter(id => lods[id]);
  addIssue(issues, existing.includes('lod0'), 'LOD0 is required for every 3D asset');
  if (existing.includes('lod2')) {
    addIssue(issues, existing.includes('lod1'), 'LOD2 cannot exist without LOD1');
  }
  if (assetClass.requiresLods) {
    for (const lod of LOD_IDS) {
      addIssue(issues, !!lods[lod], `${assetClass.id}: required file is missing for ${lod}`);
    }
  }
  if (existing.length <= 1) return;

  const triangles = Object.fromEntries(
    existing.map(lod => [lod, lods[lod].report.stats.triangles])
  );
  for (let index = 1; index < existing.length; index += 1) {
    const previous = existing[index - 1];
    const current = existing[index];
    addIssue(
      issues,
      triangles[current] < triangles[previous],
      `${current}: triangle count ${triangles[current]} must be below ${previous} (${triangles[previous]})`
    );
  }
  const lod0Triangles = triangles.lod0;
  for (const lod of ['lod1', 'lod2']) {
    if (!lods[lod] || !Number.isFinite(lod0Triangles) || lod0Triangles <= 0) continue;
    const ratio = triangles[lod] / lod0Triangles;
    const range = contract.lodPolicy.triangleRetention[lod];
    addIssue(
      issues,
      ratio >= range.min && ratio <= range.max,
      `${lod}: triangle retention ${ratio.toFixed(3)} must stay between ${range.min} and ${range.max}`
    );
  }

  const lod0Fingerprint = lods.lod0.fingerprint;
  for (const lod of existing.filter(id => id !== 'lod0')) {
    const fingerprint = lods[lod].fingerprint;
    if (!lod0Fingerprint || !fingerprint) {
      issues.push(`${lod}: cross-LOD fingerprint is unavailable`);
      continue;
    }
    for (const field of [
      'rootMetadata',
      'materials',
      'images',
      'sockets',
      'jointNames'
    ]) {
      addIssue(
        issues,
        sameJson(fingerprint[field], lod0Fingerprint[field]),
        `${lod}: ${field} drifted from LOD0`
      );
    }
  }
}

function validateProductionLodSet(rawOptions) {
  const options = {
    contract: DEFAULT_CONTRACT,
    ...rawOptions
  };
  options.modelId = options.modelId || toModelId(options.assetId);
  const issues = [];
  const warnings = [];
  addIssue(
    issues,
    fs.existsSync(options.directory) && fs.statSync(options.directory).isDirectory(),
    `LOD directory does not exist: ${options.directory}`
  );
  addIssue(issues, fs.existsSync(options.contract), `Production contract does not exist: ${options.contract}`);
  if (issues.length) return { valid: false, issues, warnings, lods: {}, stats: {} };

  const contract = readJson(options.contract);
  const assetClass = (contract.assetClasses || []).find(row => row.id === options.assetClass);
  addIssue(issues, !!assetClass, `Unknown asset class: ${options.assetClass}`);
  if (!assetClass) return { valid: false, issues, warnings, lods: {}, stats: {} };

  const lods = {};
  for (const lod of LOD_IDS) {
    const file = path.join(options.directory, `${options.modelId}_${lod}.glb`);
    if (!fs.existsSync(file)) continue;
    const report = validateProductionGlb({
      input: file,
      contract: options.contract,
      assetClass: options.assetClass,
      assetId: options.assetId,
      modelId: options.modelId,
      lod
    });
    for (const issue of report.issues) issues.push(`${lod}: ${issue}`);
    for (const warning of report.warnings) warnings.push(`${lod}: ${warning}`);
    let parsed = null;
    let fingerprint = null;
    try {
      parsed = parseGlb(file);
      fingerprint = lodFingerprint(parsed);
    } catch (error) {
      issues.push(`${lod}: unable to inspect cross-LOD data: ${error.message || error}`);
    }
    lods[lod] = {
      file,
      report,
      fingerprint
    };
  }
  validateCrossLod(lods, contract, assetClass, issues);

  const existing = LOD_IDS.filter(lod => lods[lod]);
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    lods,
    stats: {
      assetId: options.assetId,
      modelId: options.modelId,
      assetClass: options.assetClass,
      requiredLods: assetClass.requiresLods,
      files: existing.length,
      tiers: existing,
      triangles: Object.fromEntries(
        existing.map(lod => [lod, lods[lod].report.stats.triangles])
      ),
      totalBytes: existing.reduce(
        (total, lod) => total + Number(lods[lod].report.stats.bytes || 0),
        0
      )
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateProductionLodSet(args);
  const output = {
    directory: path.relative(REPO_ROOT, args.directory).replace(/\\/g, '/'),
    valid: report.valid,
    ...report.stats,
    issues: report.issues,
    warnings: report.warnings
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (report.valid) {
    console.log(
      `LOD-комплект корректен: ${output.modelId}, ${output.tiers.join(', ')}, ` +
      `${Object.entries(output.triangles).map(([lod, count]) => `${lod}=${count}`).join(', ')}, ` +
      `${output.totalBytes} байт.`
    );
  } else {
    console.error(
      `Ошибки LOD-комплекта:\n${report.issues.map(issue => `- ${issue}`).join('\n')}`
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
  lodFingerprint,
  parseArgs,
  validateProductionLodSet
};
