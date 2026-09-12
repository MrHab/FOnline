#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'public', 'assets', 'models', 'weapons');
const LITE_OPTIMIZER = path.join(ROOT, 'tools', 'optimize-glb.js');
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
  ['revolver', 'sidearm'],
  ['sawedOffShotgun', 'sidearm'],
  ['smg', 'long_gun'],
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

function writeFileWithRetry(file, data) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'UNKNOWN'].includes(error?.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  throw lastError;
}

function writeManifest(outputDirectory, report) {
  const buildRows = new Map((report.models || []).map(row => [row.id, row]));
  const files = WEAPONS.map(([id, family]) => {
    const name = `weapon_${id}.glb`;
    const file = path.join(outputDirectory, name);
    if (!fs.existsSync(file)) throw new Error(`Blender did not create ${file}`);
    const row = buildRows.get(id) || {};
    const source = row.source && typeof row.source === 'object'
      ? {
          ...row.source,
          sourceFile: Object.prototype.hasOwnProperty.call(row.source, 'file')
            ? row.source.file
            : row.source.sourceFile
        }
      : null;
    if (source) delete source.file;
    return {
      id,
      family,
      file: `/assets/models/weapons/${name}`,
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
      meshes: Number(row.meshes || 0),
      runtimeScale: Number(row.runtimeScale || 1),
      boundsMeters: row.boundsBlender || null,
      animations: Array.isArray(row.animations) ? row.animations : ['idle', 'attack'],
      gripSockets: Array.isArray(row.gripSockets) ? row.gripSockets : [],
      reloadKind: String(row.reloadKind || 'none'),
      reloadPart: row.reloadPart ? String(row.reloadPart) : null,
      modelRevision: Number(row.modelRevision || 3),
      ...(row.pilotFamily ? { pilotFamily: String(row.pilotFamily) } : {}),
      ...(source ? { source } : {})
    };
  });
  const manifest = {
    schema: 'realm.weapon-model-catalog.v1',
    version: 2,
    generator: 'tools/build-weapon-runtime-models.js',
    blenderGenerator: 'tools/blender/build_weapon_runtime_models.py',
    artDirection: 'geometry_b_materials_c',
    source: {
      package: 'Complete firearm CC0 donor catalog, CC0 knife/axe, and project-authored workshop tools',
      license: 'Mixed: project-owned original work and CC0-1.0',
      pilotManifest: 'source-assets/weapons/pilot/manifest.json'
    },
    coordinateSystem: {
      forward: '-Z',
      up: '+Y',
      origin: 'primary grip'
    },
    textureSize: Number(report.textureSize || 96),
    requiredAnimations: ['idle', 'attack'],
    reloadAnimationWeapons: WEAPONS
      .filter(([, family]) => !family.startsWith('melee'))
      .map(([id]) => id),
    interactionProfile: 'physical_grips_reload_v2',
    files
  };
  writeFileWithRetry(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

function refreshLiteCopies(outputDirectory) {
  if (path.resolve(outputDirectory) !== path.resolve(DEFAULT_OUTPUT)) return;
  const result = spawnSync(process.execPath, [LITE_OPTIMIZER, outputDirectory], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `Weapon models-lite build failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  console.log('Unity models-lite weapon copies refreshed.');
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
    '--python-exit-code',
    '1',
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
  // The generic builder deliberately regenerates its procedural fallback.
  // Restore the separately reviewed assault rifle and grip as the final,
  // approval-gated runtime assets.
  require('./build-approved-humanoid-assets').main({ weaponsOnly: true });
  const attachmentCheck = spawnSync(options.blender, [
    '--background', '--factory-startup', '--python-exit-code', '1',
    '--python', path.join(ROOT, 'tools/blender/check_weapon_attachments.py'), '--',
    '--model-directory', options.output,
    '--report', path.join(options.output, 'attachment-report.json')
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (attachmentCheck.status !== 0) {
    throw new Error(`Weapon attachment audit failed:\n${attachmentCheck.stdout}\n${attachmentCheck.stderr}`);
  }
  // Unity resolves every weapon through /assets/models-lite/ first. Keep that
  // generated tree synchronized in the same command so an old local copy can
  // never mask the freshly rebuilt authoritative GLB.
  refreshLiteCopies(options.output);
  console.log(
    `Weapon runtime models built: ${manifest.files.length} GLB, `
    + `${manifest.files.reduce((sum, row) => sum + row.bytes, 0)} bytes`
  );
  // Publish the content fingerprint to both clients in the same build. A fixed
  // Unity catalog number allowed freshly built GLBs to keep the old cache URL.
  const digest = crypto.createHash('sha256');
  for (const file of fs.readdirSync(DEFAULT_OUTPUT).filter(name => /^weapon_.*\.glb$/.test(name)).sort()) {
    digest.update(file);
    digest.update(fs.readFileSync(path.join(DEFAULT_OUTPUT, file)));
  }
  const fingerprint = digest.digest('hex').slice(0, 8);
  if (path.resolve(options.output) === path.resolve(DEFAULT_OUTPUT)) {
    const clients = [
      ['unity-client/Assets/Scripts/Game/RoaModelUrl.cs', /WeaponCatalogVersion = "[^"]+"/, `WeaponCatalogVersion = "3-${fingerprint}"`],
      ['public/js/game/04c_weapon_glb_runtime.js', /WEAPON_MODEL_ASSET_VERSION = '[^']+'/, `WEAPON_MODEL_ASSET_VERSION = 'weapon-catalog-3-${fingerprint}'`]
    ];
    for (const [relative, pattern, replacement] of clients) {
      const file = path.join(ROOT, relative);
      const source = fs.readFileSync(file, 'utf8');
      if (!pattern.test(source)) throw new Error(`Weapon cache version missing: ${relative}`);
      const updated = source.replace(pattern, replacement);
      if (updated !== source) writeFileWithRetry(file, updated);
    }
  }
  console.log(`Weapon catalog fingerprint: ${fingerprint}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

module.exports = { WEAPONS, parseArgs, writeManifest, refreshLiteCopies };
