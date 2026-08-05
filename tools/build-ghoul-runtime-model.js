#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
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
const GENERATOR = path.join(ROOT, 'tools', 'blender', 'build_unified_ghoul_review.py');
const SOURCE = path.join(
  ROOT,
  'docs',
  'art',
  'reviews',
  'unified-humanoid-npc-v5',
  'base',
  'npc_humanoid_base_unified_v5.glb'
);
const REVIEW_DIRECTORY = path.join(
  ROOT,
  'docs',
  'art',
  'reviews',
  'unified-ghoul-v3',
  'ghoul'
);
const REVIEW_GLB = path.join(REVIEW_DIRECTORY, 'creature_ghoul_unified_v3.glb');
const REVIEW_REPORT = path.join(REVIEW_DIRECTORY, 'technical-report.json');
const APPROVAL_FILE = path.join(REVIEW_DIRECTORY, 'CRITIC_APPROVAL_V3.md');
const OUTPUT = path.join(ROOT, 'public', 'assets', 'models', 'wasteland', 'npc_ghoul.glb');
const COLLIDER_BUILDER = path.join(ROOT, 'tools', 'build-model-colliders.js');
const APPROVED_REVIEW_SHA256 = 'DCAA6F7E2A2C48D3C89F9089399BE2BC4B12383265C2B16B5C825A2AB105CAF1';
const EXPECTED_RUNTIME_SHA256 = '1360D1A0A0B4BD90CB49FD0ABC9BBDE83991BC430DB43D818D03B06928B1D91C';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function parseArgs(argv) {
  const options = {
    blender: process.env.REALM_BLENDER_EXE || DEFAULT_BLENDER
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--blender') {
      if (!value) throw new Error('--blender requires a value');
      options.blender = path.resolve(value);
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
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed with exit code ${result.status}:\n`
      + `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  return result;
}

function verifyApprovalGate() {
  for (const [label, file] of [
    ['Blender generator', GENERATOR],
    ['humanoid v5 source', SOURCE],
    ['review GLB', REVIEW_GLB],
    ['review report', REVIEW_REPORT],
    ['critic approval', APPROVAL_FILE],
    ['collider builder', COLLIDER_BUILDER]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  }
  const approval = fs.readFileSync(APPROVAL_FILE, 'utf8');
  const report = JSON.parse(fs.readFileSync(REVIEW_REPORT, 'utf8'));
  if (!approval.includes('APPROVE') || !approval.includes(APPROVED_REVIEW_SHA256)) {
    throw new Error('Critic approval does not authorize the configured review SHA-256');
  }
  if (sha256(REVIEW_GLB) !== APPROVED_REVIEW_SHA256) {
    throw new Error('Review GLB differs from the critic-approved bytes');
  }
  if (String(report.sha256 || '').toUpperCase() !== APPROVED_REVIEW_SHA256) {
    throw new Error('Review report does not describe the critic-approved GLB');
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!fs.existsSync(options.blender)) {
    throw new Error(`Blender not found: ${options.blender}`);
  }
  verifyApprovalGate();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-ghoul-runtime-'));
  const runtimeGlb = path.join(temporaryRoot, 'npc_ghoul.glb');
  const runtimeBlend = path.join(temporaryRoot, 'npc_ghoul.blend');
  const runtimeReportFile = path.join(temporaryRoot, 'runtime-report.json');
  try {
    run(options.blender, [
      '--background',
      '--factory-startup',
      '--python',
      GENERATOR,
      '--',
      '--source',
      SOURCE,
      '--output',
      runtimeGlb,
      '--blend-output',
      runtimeBlend,
      '--report',
      runtimeReportFile,
      '--asset-id',
      'npc_ghoul',
      '--runtime-approved-sha',
      APPROVED_REVIEW_SHA256
    ]);
    const report = JSON.parse(fs.readFileSync(runtimeReportFile, 'utf8'));
    if (
      report.reviewOnly !== false
      || report.runtimeIntegrationAllowed !== true
      || report.approvedReviewSha256 !== APPROVED_REVIEW_SHA256
      || report.runtimeScaleMultiplier !== 1.0
    ) {
      throw new Error('Runtime export did not preserve the critic approval gate');
    }
    const runtimeSha256 = sha256(runtimeGlb);
    if (runtimeSha256 !== EXPECTED_RUNTIME_SHA256) {
      throw new Error(
        `Runtime GLB is not reproducible: ${runtimeSha256}; expected ${EXPECTED_RUNTIME_SHA256}`
      );
    }
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.copyFileSync(runtimeGlb, OUTPUT);
    run(process.execPath, [COLLIDER_BUILDER]);
    console.log(
      `B+C ghoul runtime model built: ${path.relative(ROOT, OUTPUT)} `
      + `(${fs.statSync(OUTPUT).size} bytes, ${runtimeSha256})`
    );
    return OUTPUT;
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
  APPROVED_REVIEW_SHA256,
  EXPECTED_RUNTIME_SHA256,
  parseArgs,
  main
};
