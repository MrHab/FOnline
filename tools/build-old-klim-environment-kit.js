#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BLENDER = path.join(
  os.homedir(),
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const GENERATOR = path.join(
  ROOT,
  'tools',
  'blender',
  'build_old_klim_environment_kit.py'
);
const CHECKER = path.join(ROOT, 'tools', 'check-old-klim-environment-kit.js');
const COLLIDER_BUILDER = path.join(ROOT, 'tools', 'build-model-colliders.js');
const REVIEW_DIR = path.join(ROOT, 'docs', 'art', 'reviews', 'old-klim-environment-kit-v1');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'models', 'wasteland');

function parseArgs(argv) {
  const options = {
    blender: process.env.REALM_BLENDER_EXE || DEFAULT_BLENDER,
    render: true,
    verify: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--blender') {
      const value = argv[index + 1];
      if (!value) throw new Error('--blender requires a path');
      options.blender = path.resolve(value);
      index += 1;
    } else if (argument === '--no-render') {
      options.render = false;
    } else if (argument === '--no-verify') {
      options.verify = false;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function run(command, args, label, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const [label, file] of [
    ['Blender', options.blender],
    ['Old Klim Blender generator', GENERATOR],
    ['Old Klim verifier', CHECKER]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  }
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const blenderArgs = [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    GENERATOR,
    '--',
    '--review-dir',
    REVIEW_DIR,
    '--runtime-dir',
    RUNTIME_DIR,
    '--blend-output',
    path.join(REVIEW_DIR, 'old_klim_environment_kit_v1.blend'),
    '--report',
    path.join(REVIEW_DIR, 'technical-report.json')
  ];
  if (options.render) {
    blenderArgs.push(
      '--render',
      path.join(REVIEW_DIR, 'catalog.png'),
      '--cutaway-render',
      path.join(REVIEW_DIR, 'cutaway.png')
    );
  }
  const blender = run(options.blender, blenderArgs, 'Old Klim environment build', 64 * 1024 * 1024);
  const reportLine = String(blender.stdout || '')
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find(line => line.trim().startsWith('{'));
  if (!reportLine) {
    throw new Error(
      'Blender did not emit the Old Klim build report:\n'
      + `${blender.stdout || ''}\n${blender.stderr || ''}`
    );
  }
  const report = JSON.parse(reportLine);
  const colliders = run(process.execPath, [COLLIDER_BUILDER], 'Model collider rebuild');
  process.stdout.write(colliders.stdout || '');
  if (options.verify) {
    const checked = run(process.execPath, [CHECKER], 'Old Klim environment verification');
    process.stdout.write(checked.stdout || '');
  }
  console.log(
    `Old Klim kit built: ${Object.keys(report.models || {}).length} GLB, `
    + `${report.totals?.primitives || 0} primitives, `
    + `${report.totals?.triangles || 0} triangles.`
  );
}

main();
