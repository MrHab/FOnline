#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');
const DEFAULT_BLENDER = path.join(
  os.homedir(),
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const COLLIDER_BUILDER = path.join(ROOT, 'tools', 'build-model-colliders.js');
const MANIFEST_NAME = 'approved-creature-manifest.json';
const STYLE = 'geometry_b_materials_c';

function fromRoot(...segments) {
  return path.join(ROOT, ...segments);
}

const APPROVED_CREATURES = [
  {
    id: 'brahmin',
    label: 'Брамин',
    species: 'brahmin',
    outputFile: 'brahmin.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-brahmin-v4', 'brahmin'),
    reviewFile: 'creature_brahmin_unified_v4.glb',
    reviewReport: 'technical-report.json',
    approvalFile: 'CRITIC_APPROVAL_V4.md',
    approvedReviewSha256: 'B12B53B02C502CD0007FDEF70295CF09E81732458F468BE2A600C8E9ED263EA5',
    expectedRuntimeSha256: 'F61FCA471CAAFE50A592697E075CAC253840F944C81CE4F54626D15D35D94F66',
    generator: fromRoot('tools', 'blender', 'build_unified_brahmin_review.py'),
    sourceBlend: fromRoot(
      'source-assets', 'quaternius', 'ultimate-animated-animals', 'bull', 'Bull.blend'
    ),
    builderArgs: [],
    runtimeScaleMultiplier: 1,
    runtimeScaleCompensation: 'component_square_root_for_threejs_skinned_bounds',
    expected: { meshes: 1, vertices: 7078, triangles: 3478, materials: 9, images: 27, channels: 924, joints: 51 }
  },
  {
    id: 'npc_gecko',
    label: 'Геккон пустоши',
    species: 'gecko',
    outputFile: 'npc_gecko.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-gecko-v1', 'gecko'),
    reviewFile: 'creature_wasteland_gecko_unified_v1.glb',
    reviewReport: 'creature_wasteland_gecko_unified_v1-report.json',
    approvalFile: 'CRITIC_APPROVAL_V1.md',
    approvedReviewSha256: '7970765D978E9BB219557268445B795A50039E9717F2E13B1570073F35D2E454',
    expectedRuntimeSha256: '18A9F50C8B650BFFA08C3F9402A4BCCF2FCA2F5853900389C7E792C0EB74B7EB',
    generator: fromRoot('tools', 'blender', 'build_unified_gecko_review.py'),
    sourceBlend: fromRoot(
      'source-assets', 'quaternius', 'animated-dinosaurs', 'velociraptor', 'Velociraptor.blend'
    ),
    builderArgs: ['--variant', 'standard'],
    runtimeScaleMultiplier: 2.2,
    expected: { meshes: 2, vertices: 3256, triangles: 1648, materials: 5, images: 15, channels: 528, joints: 29 }
  },
  {
    id: 'npc_fire_gecko',
    label: 'Огненный геккон',
    species: 'fire_gecko',
    outputFile: 'npc_fire_gecko.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-fire-gecko-v1', 'fire_gecko'),
    reviewFile: 'creature_wasteland_fire_gecko_unified_v1.glb',
    reviewReport: 'creature_wasteland_fire_gecko_unified_v1-report.json',
    approvalFile: 'CRITIC_APPROVAL_V1.md',
    approvedReviewSha256: '225B1DBB1F26DAE0022152FE1C47F754914F4F302577AB474CBA4476250EF07C',
    expectedRuntimeSha256: '0A8790B87F2B6F5C26E53686A5996C1BDDDF1BF6620ED68FD7FB533FB9B26B5E',
    generator: fromRoot('tools', 'blender', 'build_unified_gecko_review.py'),
    sourceBlend: fromRoot(
      'source-assets', 'quaternius', 'animated-dinosaurs', 'velociraptor', 'Velociraptor.blend'
    ),
    builderArgs: ['--variant', 'fire'],
    runtimeScaleMultiplier: 2.2,
    expected: { meshes: 2, vertices: 3256, triangles: 1648, materials: 6, images: 19, channels: 528, joints: 29 }
  },
  {
    id: 'npc_ash_wolf',
    label: 'Пепельный волк',
    species: 'ash_wolf',
    outputFile: 'npc_ash_wolf.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-creature-v8', 'ash-wolf'),
    reviewFile: 'creature_ash_wolf_unified_v8.glb',
    reviewReport: 'creature_ash_wolf_unified_v8-report.json',
    approvalFile: 'CRITIC_APPROVAL_V8.md',
    approvedReviewSha256: 'CDB0374E135B80C880B93D373B7CEB9490A9B34C44AEA6EB4D469DD9CA0E1A7A',
    expectedRuntimeSha256: '60489F6E6F0FF2A374DC3DB7DA374728AA3976BCEEF2AC7230DE92184F5646F8',
    generator: fromRoot('tools', 'blender', 'build_unified_quaternius_wolf_review.py'),
    sourceBlend: fromRoot(
      'source-assets', 'quaternius', 'ultimate-animated-animals', 'wolf', 'Wolf.blend'
    ),
    builderArgs: [],
    runtimeScaleMultiplier: 1,
    runtimeScaleCompensation: 'component_square_root_for_threejs_skinned_bounds',
    expected: { meshes: 2, vertices: 4056, triangles: 1990, materials: 7, images: 21, channels: 942, joints: 52 }
  },
  {
    id: 'npc_radscorpion',
    label: 'Радскорпион',
    species: 'radscorpion',
    outputFile: 'npc_radscorpion.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-radscorpion-v2', 'radscorpion'),
    reviewFile: 'creature_radscorpion_unified_v2.glb',
    reviewReport: 'creature_radscorpion_unified_v2-report.json',
    approvalFile: 'CRITIC_APPROVAL_V2.md',
    approvedReviewSha256: 'B8E13C9DF4AEF5CD73AC400B29B7B5B3D4A5EBFB16888C684E738DB0E303BF46',
    expectedRuntimeSha256: '64B54BC6EB25BF2F9A796581FAEE3FCEC837802BE0CF352FB983FD447FFBEC49',
    generator: fromRoot('tools', 'blender', 'build_unified_radscorpion_review.py'),
    sourceBlend: null,
    builderArgs: [],
    runtimeScaleMultiplier: 1,
    expected: { meshes: 1, vertices: 9684, triangles: 3624, materials: 7, images: 21, channels: 1122, joints: 62 }
  },
  {
    id: 'npc_mutant_ant',
    label: 'Мутировавший муравей',
    species: 'mutant_ant',
    outputFile: 'npc_mutant_ant.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-mutant-ant-v2', 'mutant-ant'),
    reviewFile: 'creature_mutant_ant_unified_v2.glb',
    reviewReport: 'technical-report.json',
    approvalFile: 'CRITIC_APPROVAL_V2.md',
    approvedReviewSha256: '7419D9A522BE72424F2E94F31D2D2FE4B7B227DE25074A695FFE1C1B65B052FF',
    expectedRuntimeSha256: '54D25A1245DA94310EDB016B5955C3EB79656FE91FB8B0E69B6CB576F398F9F3',
    generator: fromRoot('tools', 'blender', 'build_unified_mutant_ant_review.py'),
    sourceBlend: null,
    builderArgs: [],
    runtimeScaleMultiplier: 1,
    expected: { meshes: 1, vertices: 6788, triangles: 2498, materials: 7, images: 21, channels: 888, joints: 49 }
  },
  {
    id: 'npc_super_mutant',
    label: 'Супермутант',
    species: 'super_mutant',
    outputFile: 'npc_super_mutant.glb',
    reviewDirectory: fromRoot('docs', 'art', 'reviews', 'unified-super-mutant-v1', 'super-mutant'),
    reviewFile: 'creature_super_mutant_unified_v1.glb',
    reviewReport: 'technical-report.json',
    approvalFile: 'VISUAL_ACCEPTANCE_V1_RU.md',
    approvedReviewSha256: '69C7771D31926F2650BD1F2AED710979A4AE9724449F89123C13F2780570E311',
    expectedRuntimeSha256: 'D0777568929942FEED5B420FD7802B0EAABCFDAC9727FBADEACD6764D1D8AA27',
    generator: fromRoot('tools', 'blender', 'build_unified_super_mutant_review.py'),
    sourceGlb: fromRoot(
      'docs', 'art', 'reviews', 'unified-humanoid-npc-v5', 'base',
      'npc_humanoid_base_unified_v5.glb'
    ),
    sourceBlend: null,
    builderArgs: [],
    runtimeScaleMultiplier: 1,
    expected: { meshes: 4, vertices: 33578, triangles: 11216, materials: 8, images: 24, channels: 1170, joints: 65 }
  }
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  if (data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2) {
    throw new Error(`${path.basename(file)} is not a glTF 2 GLB`);
  }
  let offset = 12;
  let json = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'JSON') {
      json = JSON.parse(
        data.subarray(offset + 8, offset + 8 + length).toString('utf8').replace(/\0+$/g, '').trim()
      );
    }
    offset += 8 + length;
  }
  if (!json) throw new Error(`${path.basename(file)} has no JSON chunk`);
  let vertices = 0;
  let triangles = 0;
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const position = json.accessors?.[primitive.attributes?.POSITION];
      const indices = json.accessors?.[primitive.indices];
      vertices += Number(position?.count || 0);
      triangles += indices
        ? Math.floor(Number(indices.count || 0) / 3)
        : Math.floor(Number(position?.count || 0) / 3);
    }
  }
  return {
    bytes: data.length,
    meshes: Number(json.meshes?.length || 0),
    vertices,
    triangles,
    materials: Number(json.materials?.length || 0),
    images: Number(json.images?.length || 0),
    animations: (json.animations || []).map(animation => String(animation.name || '').toLowerCase()).sort(),
    animationChannels: (json.animations || []).reduce(
      (sum, animation) => sum + Number(animation.channels?.length || 0),
      0
    ),
    skins: Number(json.skins?.length || 0)
  };
}

function parseArgs(argv) {
  const options = {
    blender: process.env.REALM_BLENDER_EXE || DEFAULT_BLENDER,
    output: DEFAULT_OUTPUT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--blender' || arg === '--output') {
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  return result;
}

function verifyApproval(definition) {
  const reviewFile = path.join(definition.reviewDirectory, definition.reviewFile);
  const reportFile = path.join(definition.reviewDirectory, definition.reviewReport);
  const approvalFile = path.join(definition.reviewDirectory, definition.approvalFile);
  for (const [label, file] of [
    ['generator', definition.generator],
    ['review GLB', reviewFile],
    ['review report', reportFile],
    ['critic approval', approvalFile]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${definition.id} ${label} is missing: ${file}`);
  }
  if (definition.sourceBlend && !fs.existsSync(definition.sourceBlend)) {
    throw new Error(`${definition.id} donor source is missing: ${definition.sourceBlend}`);
  }
  if (definition.sourceGlb && !fs.existsSync(definition.sourceGlb)) {
    throw new Error(`${definition.id} donor source is missing: ${definition.sourceGlb}`);
  }
  const approval = fs.readFileSync(approvalFile, 'utf8');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (!approval.includes('APPROVE') || !approval.includes(definition.approvedReviewSha256)) {
    throw new Error(`${definition.id} critic approval does not authorize the configured review hash`);
  }
  if (sha256(reviewFile) !== definition.approvedReviewSha256) {
    throw new Error(`${definition.id} review GLB differs from the approved bytes`);
  }
  if (String(report.sha256 || '').toUpperCase() !== definition.approvedReviewSha256) {
    throw new Error(`${definition.id} review report hash is stale`);
  }
}

function buildCreature(definition, blender, temporaryDirectory, outputDirectory) {
  verifyApproval(definition);
  const runtimeGlb = path.join(temporaryDirectory, definition.outputFile);
  const runtimeBlend = path.join(temporaryDirectory, `${definition.id}.blend`);
  const runtimeReportFile = path.join(temporaryDirectory, `${definition.id}-runtime-report.json`);
  const builderArguments = [
    '--background',
    '--factory-startup',
    '--python',
    definition.generator,
    '--'
  ];
  if (definition.sourceBlend) {
    builderArguments.push('--source-blend', definition.sourceBlend);
  }
  if (definition.sourceGlb) {
    builderArguments.push('--source', definition.sourceGlb);
  }
  builderArguments.push(
    '--output', runtimeGlb,
    '--blend-output', runtimeBlend,
    '--report', runtimeReportFile,
    '--asset-id', definition.id,
    ...definition.builderArgs,
    '--runtime-approved-sha', definition.approvedReviewSha256
  );
  run(blender, builderArguments);
  const report = JSON.parse(fs.readFileSync(runtimeReportFile, 'utf8'));
  if (
    report.reviewOnly !== false
    || report.runtimeIntegrationAllowed !== true
    || report.approvedReviewSha256 !== definition.approvedReviewSha256
    || Number(report.runtimeScaleMultiplier) !== definition.runtimeScaleMultiplier
  ) {
    throw new Error(`${definition.id} runtime export did not preserve the approval gate`);
  }
  if (
    definition.runtimeScaleCompensation
    && report.runtimeScaleCompensation !== definition.runtimeScaleCompensation
  ) {
    throw new Error(`${definition.id} runtime scale compensation changed`);
  }
  const runtimeSha256 = sha256(runtimeGlb);
  if (runtimeSha256 !== definition.expectedRuntimeSha256) {
    throw new Error(
      `${definition.id} runtime GLB is not reproducible: ${runtimeSha256}; `
      + `expected ${definition.expectedRuntimeSha256}`
    );
  }
  fs.copyFileSync(runtimeGlb, path.join(outputDirectory, definition.outputFile));
}

function writeManifest(outputDirectory) {
  const colliders = JSON.parse(
    fs.readFileSync(path.join(outputDirectory, 'model-colliders.json'), 'utf8')
  );
  const files = APPROVED_CREATURES.map(definition => {
    const file = path.join(outputDirectory, definition.outputFile);
    const stats = parseGlb(file);
    return {
      id: definition.id,
      category: 'creature',
      species: definition.species,
      label: definition.label,
      file: `/assets/models/wasteland/${definition.outputFile}`,
      sha256: sha256(file),
      approvedReviewSha256: definition.approvedReviewSha256,
      runtimeScaleMultiplier: definition.runtimeScaleMultiplier,
      runtimeScaleCompensation: definition.runtimeScaleCompensation || null,
      ...stats,
      boundsMeters: colliders.models?.[definition.outputFile]?.size || null,
      centerMeters: colliders.models?.[definition.outputFile]?.center || null
    };
  });
  const manifest = {
    schema: 'realm.approved-creature-model-catalog.v1',
    version: 1,
    generator: 'tools/build-approved-creature-models.js',
    artDirection: STYLE,
    scope: 'approved_creature_runtime_replacements',
    animationSet: ['attack', 'death', 'hurt', 'idle', 'run', 'walk'],
    source: {
      license: 'Project-owned original work; selected topology, rigs and base motion use Quaternius CC0 1.0',
      method: 'Reproducible Blender generators with a critic-approved SHA-256 gate'
    },
    files
  };
  fs.writeFileSync(
    path.join(outputDirectory, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  for (const [label, file] of [
    ['Blender', options.blender],
    ['collider builder', COLLIDER_BUILDER]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  }
  fs.mkdirSync(options.output, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-approved-creatures-'));
  try {
    for (const definition of APPROVED_CREATURES) {
      buildCreature(definition, options.blender, temporaryRoot, options.output);
    }
    run(process.execPath, [COLLIDER_BUILDER]);
    const manifest = writeManifest(options.output);
    const totals = manifest.files.reduce((sum, row) => ({
      bytes: sum.bytes + row.bytes,
      triangles: sum.triangles + row.triangles,
      channels: sum.channels + row.animationChannels
    }), { bytes: 0, triangles: 0, channels: 0 });
    console.log(
      `Approved B+C creature models built: ${manifest.files.length} GLB, `
      + `${totals.triangles} triangles, ${totals.channels} animation channels, `
      + `${totals.bytes} bytes`
    );
    return manifest;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = {
  APPROVED_CREATURES,
  MANIFEST_NAME,
  STYLE,
  parseArgs,
  parseGlb,
  writeManifest,
  main
};
