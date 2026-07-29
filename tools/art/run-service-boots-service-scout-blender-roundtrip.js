#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const blender = process.env.REALM_BLENDER_EXE || path.join(
  process.env.USERPROFILE || '',
  '.codex',
  'tool-cache',
  'blender',
  'blender-4.5.12-windows-x64',
  'blender.exe'
);
const script = path.join(
  ROOT,
  'tools',
  'art',
  'blender',
  'validate_service_boots_roundtrip.py'
);
const productionDirectory = path.join(
  ROOT,
  'source-assets',
  'production',
  'characters',
  'outfits',
  'field_worker',
  'service_boots'
);
const output = path.join(
  ROOT,
  'source-assets',
  'previews',
  'character-equipment',
  'bc-review',
  'first-outfit',
  'service_boots',
  'redesign-review',
  'integration-evidence',
  'service-scout-blender-roundtrip.json'
);

for (const [label, file] of [
  ['Blender executable', blender],
  ['round-trip script', script],
  ['production directory', productionDirectory]
]) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} is missing: ${file}`);
  }
}

const result = spawnSync(
  blender,
  [
    '--background',
    '--factory-startup',
    '--python',
    script,
    '--',
    '--root',
    ROOT,
    '--directory',
    productionDirectory,
    '--output',
    output
  ],
  {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  }
);
const transcript = `${result.stdout || ''}${result.stderr || ''}`;
if (transcript) process.stdout.write(transcript);
if (
  result.error ||
  result.status !== 0 ||
  transcript.includes('Traceback (most recent call last)') ||
  !transcript.includes('Service Scout Blender round-trip passed:') ||
  !fs.existsSync(output)
) {
  throw result.error || new Error('Service Scout Blender round-trip failed');
}
