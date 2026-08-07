#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BLENDER = process.env.REALM_BLENDER_EXE || path.join(
  os.homedir(), '.codex', 'tool-cache', 'blender', 'blender-4.5.12-windows-x64',
  process.platform === 'win32' ? 'blender.exe' : 'blender'
);
const GENERATOR = path.join(ROOT, 'tools', 'blender', 'build_leather_armor_blockout.py');
const REVIEW = path.join(ROOT, 'docs', 'art', 'reviews', 'unified-equipment-leather-armor-blockout-v1');
const RENDERS = path.join(REVIEW, 'renders');
const PREFIX = 'equipment_leather_armor_blockout_v1_male_medium';

function output(suffix) {
  return path.join(RENDERS, `${PREFIX}_${suffix}.png`);
}

function main() {
  fs.mkdirSync(RENDERS, { recursive: true });
  const args = [
    '-b', '--python', GENERATOR, '--',
    '--reference-character', path.join(ROOT, 'public', 'assets', 'models', 'characters', 'base', 'character_male_medium.glb'),
    '--asset-id', 'equipment_leather_armor_blockout_v1',
    '--body-id', 'male_medium',
    '--output', path.join(REVIEW, `${PREFIX}.glb`),
    '--blend-output', path.join(REVIEW, `${PREFIX}.blend`),
    '--report', path.join(REVIEW, `${PREFIX}.report.json`),
    '--front-render', output('front'),
    '--back-render', output('back'),
    '--left-render', output('left'),
    '--right-render', output('right'),
    '--three-quarter-render', output('three_quarter'),
    '--isometric-render', output('isometric'),
    '--game-camera-render', output('game_camera'),
    '--wireframe-render', output('wireframe'),
    '--native-render', output('native112')
  ];
  const result = spawnSync(BLENDER, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status || 1);
  }
  const reportFile = path.join(REVIEW, `${PREFIX}.report.json`);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  if (report.stage !== 'blockout' || report.bodyId !== 'male_medium' || report.runtimeIntegrationAllowed !== false) {
    throw new Error('Leather armor blockout review gate drifted');
  }
  console.log(`Leather armor blockout built: ${report.actualGlb.triangles} triangles, ${report.bytes} bytes`);
}

main();
