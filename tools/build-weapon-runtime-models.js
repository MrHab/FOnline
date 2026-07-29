#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'public', 'assets', 'models', 'weapons');
const DEFAULT_BLENDER = path.join(
  os.homedir(),
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const BUILDER = path.join(ROOT, 'tools', 'blender', 'build_weapon_runtime_models.py');
const WEAPONS = [
  ['pistol', 'sidearm'],
  ['rifle', 'long_gun'],
  ['assaultRifle', 'long_gun'],
  ['machineGun', 'heavy'],
  ['laserPistol', 'energy_sidearm'],
  ['flamethrower', 'heavy'],
  ['plasmaRifle', 'energy_long_gun'],
  ['shotgun', 'long_gun'],
  ['rocketLauncher', 'launcher'],
  ['knife', 'melee_light'],
  ['pickaxe', 'melee_heavy'],
  ['axe', 'melee_heavy'],
  ['handPump', 'melee_heavy']
];

function parseArgs(argv) {
  const options = {
    blender: process.env.REALM_BLENDER_EXE || DEFAULT_BLENDER,
    output: DEFAULT_OUTPUT,
    textureSize: 96
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--blender' || arg === '--output') {
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else if (arg === '--texture-size') {
      if (!value) throw new Error('--texture-size requires a value');
      options.textureSize = Math.max(32, Math.min(256, Number(value) || 96));
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

function writeManifest(outputDirectory, report) {
  const buildRows = new Map((report.models || []).map(row => [row.id, row]));
  const files = WEAPONS.map(([id, family]) => {
    const name = `weapon_${id}.glb`;
    const file = path.join(outputDirectory, name);
    if (!fs.existsSync(file)) throw new Error(`Blender did not create ${file}`);
    const row = buildRows.get(id) || {};
    return {
      id,
      family,
      file: `/assets/models/weapons/${name}`,
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
      meshes: Number(row.meshes || 0),
      animations: ['idle', 'attack', 'reload']
    };
  });
  const manifest = {
    schema: 'realm.weapon-model-catalog.v1',
    version: 1,
    generator: 'tools/build-weapon-runtime-models.js',
    blenderGenerator: 'tools/blender/build_weapon_runtime_models.py',
    artDirection: 'geometry_b_materials_c',
    source: {
      package: 'Realm of Ashes original procedural weapon library',
      license: 'Project-owned original work'
    },
    coordinateSystem: {
      forward: '-Z',
      up: '+Y',
      origin: 'primary grip'
    },
    textureSize: Number(report.textureSize || 96),
    requiredAnimations: ['idle', 'attack', 'reload'],
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
  for (const [label, file] of [['Blender', options.blender], ['Blender generator', BUILDER]]) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }
  fs.mkdirSync(options.output, { recursive: true });
  const result = spawnSync(options.blender, [
    '--background',
    '--factory-startup',
    '--python',
    BUILDER,
    '--',
    '--output-directory',
    options.output,
    '--texture-size',
    String(options.textureSize)
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `Blender weapon build failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .find(row => row.startsWith('REALM_WEAPON_BUILD='));
  if (!line) throw new Error('Blender did not report weapon build metadata');
  const report = JSON.parse(line.slice('REALM_WEAPON_BUILD='.length));
  const manifest = writeManifest(options.output, report);
  console.log(
    `Weapon runtime models built: ${manifest.files.length} GLB, `
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

module.exports = { WEAPONS, parseArgs, writeManifest };
