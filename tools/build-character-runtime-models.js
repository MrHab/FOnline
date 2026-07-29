#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.resolve(
  ROOT,
  '..',
  'FOnline-art-direction',
  'source-assets',
  'previews',
  'character-base',
  'bc-review'
);
const DEFAULT_OUTPUT = path.join(
  ROOT,
  'public',
  'assets',
  'models',
  'characters',
  'base'
);
const DEFAULT_BLENDER = path.join(
  os.homedir(),
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const BUILDER = path.join(
  ROOT,
  'tools',
  'blender',
  'build_character_runtime_models.py'
);
const MATRIX = [
  ['female', 'slim'],
  ['female', 'medium'],
  ['female', 'large'],
  ['male', 'slim'],
  ['male', 'medium'],
  ['male', 'large']
];

function parseArgs(argv) {
  const options = {
    blender: process.env.REALM_BLENDER_EXE || DEFAULT_BLENDER,
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    textureSize: 512
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--blender' || arg === '--source' || arg === '--output') {
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else if (arg === '--texture-size') {
      if (!value) throw new Error('--texture-size requires a value');
      options.textureSize = Math.max(128, Math.min(1024, Number(value) || 512));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest(outputDirectory, buildReport) {
  const files = MATRIX.map(([sex, bodyType]) => {
    const name = `character_${sex}_${bodyType}.glb`;
    const file = path.join(outputDirectory, name);
    if (!fs.existsSync(file)) throw new Error(`Blender did not create ${file}`);
    return {
      id: `${sex}_${bodyType}`,
      sex,
      bodyType,
      file: `/assets/models/characters/base/${name}`,
      bytes: fs.statSync(file).size,
      sha256: sha256(file)
    };
  });
  const manifest = {
    schema: 'realm.character-model-catalog.v1',
    version: 1,
    generator: 'tools/build-character-runtime-models.js',
    blenderGenerator: 'tools/blender/build_character_runtime_models.py',
    artDirection: 'geometry_b_materials_c',
    source: {
      package: 'Approved Realm of Ashes B+C character base review',
      donor: [
        'Quaternius Universal Base Characters',
        'Quaternius Universal Animation Library'
      ],
      license: 'CC0-1.0'
    },
    defaults: {
      sex: 'male',
      bodyType: 'medium',
      faceId: 'male_01',
      hairId: 'short_crop',
      skinToneId: 'skin_03',
      hairColorId: 'hair_03'
    },
    animations: ['idle', 'walk', 'run'],
    textureSize: Number(buildReport.textureSize || 512),
    files
  };
  fs.writeFileSync(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const [label, file] of [
    ['Blender', options.blender],
    ['Blender generator', BUILDER],
    ['Approved source directory', options.source]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }
  fs.mkdirSync(options.output, { recursive: true });
  const result = spawnSync(options.blender, [
    '--background',
    '--factory-startup',
    '--python',
    BUILDER,
    '--',
    '--source-directory',
    options.source,
    '--output-directory',
    options.output,
    '--texture-size',
    String(options.textureSize)
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `Blender character build failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .find(row => row.startsWith('REALM_CHARACTER_BUILD='));
  if (!line) throw new Error('Blender did not report character build metadata');
  const report = JSON.parse(line.slice('REALM_CHARACTER_BUILD='.length));
  const manifest = writeManifest(options.output, report);
  console.log(
    `Character runtime models built: ${manifest.files.length} GLB, `
    + `${manifest.files.reduce((sum, row) => sum + row.bytes, 0)} bytes`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, writeManifest };
