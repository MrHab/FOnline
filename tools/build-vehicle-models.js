#!/usr/bin/env node
'use strict';

// Транспорт: скачивает закреплённый по SHA-256 исходник, собирает в Blender
// рантайм-GLB с колёсами, рулём и точками для седока, пишет манифест с
// лицензией и облегчённую копию. Исходник лежит в игнорируемом Build/.
// Запуск: node tools/build-vehicle-models.js
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'Build', 'SourceDownloads', 'vehicles-20260922');
const OUTPUT_DIR = path.join(ROOT, 'public', 'assets', 'models', 'vehicles');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.json');
const BLENDER = process.env.REALM_BLENDER_EXE || path.join(os.homedir(),
  '.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');

const MODELS = Object.freeze([
  {
    id: 'motorcycle',
    itemId: 'motorcycle',
    file: 'vehicle_motorcycle.glb',
    source: {
      title: 'Military Motorbike',
      creator: 'Zsky',
      page: 'https://poly.pizza/m/9SwnIlPjNv',
      url: 'https://static.poly.pizza/b61993ed-4bd4-4439-89c0-933ad42384c7.glb',
      file: 'military_motorbike_zsky.glb',
      sha256: 'CD49EA6E852B313B6C6F6F0448F5EFDD1E464C97D2F1AE8F716046606B3ADA0E',
      license: 'CC-BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      attribution: '“Military Motorbike” by Zsky, downloaded from Poly Pizza, licensed under Creative Commons Attribution 3.0.'
    }
  }
]);

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

async function download(source) {
  const file = path.join(CACHE, source.file);
  if (fs.existsSync(file) && digest(fs.readFileSync(file)) === source.sha256) return file;
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'RealmOfAshesAssetPipeline/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== source.sha256) throw new Error(`SHA-256 mismatch for ${source.file}: expected ${source.sha256}, got ${actual}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed (${result.status})`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows = [];
  for (const model of MODELS) {
    const source = await download(model.source);
    const output = path.join(OUTPUT_DIR, model.file);
    const report = path.join(CACHE, `${model.id}-report.json`);
    run(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', 'tools/blender/build_vehicle_models.py', '--',
      '--source', source, '--output', output, '--report', report]);
    const built = JSON.parse(fs.readFileSync(report, 'utf8'));
    rows.push({
      id: model.id,
      itemId: model.itemId,
      file: model.file,
      sha256: digest(fs.readFileSync(output)),
      triangles: built.triangles,
      wheelRadius: built.wheelRadius,
      source: model.source
    });
  }
  const version = 'vehicles-1-' + digest(Buffer.from(rows.map(row => row.sha256).join(':'))).slice(0, 8).toLowerCase();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify({
    schema: 'realm.vehicle-model-manifest.v1',
    version,
    models: rows
  }, null, 2) + '\n');
  run(process.execPath, ['tools/optimize-glb.js', ...rows.map(row => path.join(OUTPUT_DIR, row.file))]);
  run(process.execPath, ['tools/check-vehicle-models.js']);
  console.log(`Vehicle models built: ${rows.map(row => row.file).join(', ')} (${version})`);
}

main().catch(error => { console.error(error); process.exit(1); });
