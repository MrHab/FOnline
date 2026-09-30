#!/usr/bin/env node
'use strict';

// Текстуры земли зон из source-assets/ground-textures/sources.json (Poly Haven, CC0).
//
// Карты 1K скачиваются в кэш Build/SourceDownloads/ground-textures и сверяются по md5
// из каталога Poly Haven. В Unity (Assets/Resources/RealmOfAshes/Ground) ложатся:
//   <набор>_albedo.jpg — цвет как есть;
//   <набор>_normal.jpg — нормали OpenGL как есть (Unity читает их как Normal map);
//   <набор>_mask.png   — 512 px: R — высота (растянута на весь диапазон), G — шероховатость,
//                        B — затенение из arm;
//   ground-textures.json — каталог клиента: пресет грунта → набор, шаг повтора, оттенок.
// Запуск без аргументов пересобирает всё; --offline не ходит в сеть.

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = path.join(ROOT, 'source-assets', 'ground-textures', 'sources.json');
const CACHE = path.join(ROOT, 'Build', 'SourceDownloads', 'ground-textures');
const OUTPUT = path.join(ROOT, 'unity-client', 'Assets', 'Resources', 'RealmOfAshes', 'Ground');
const MASK_SIZE = 512;
const OFFLINE = process.argv.includes('--offline');

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FOnline-ground-textures/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${url}: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function sourceMap(id, role, entry) {
  const file = path.join(CACHE, id, `${role}.jpg`);
  if (fs.existsSync(file)) {
    const cached = fs.readFileSync(file);
    if (md5(cached) === entry.md5) return cached;
  }
  if (OFFLINE) throw new Error(`${id}/${role}: нет в кэше ${path.relative(ROOT, file)}, а --offline запрещает загрузку`);
  const data = await download(entry.url);
  if (md5(data) !== entry.md5) throw new Error(`${id}/${role}: md5 ${md5(data)} не совпал с ${entry.md5}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return data;
}

/** Маска набора: высота на весь диапазон 0..255, шероховатость и затенение из arm. */
async function buildMask(disp, arm) {
  const height = await sharp(disp).resize(MASK_SIZE, MASK_SIZE).greyscale().raw().toBuffer();
  const packed = await sharp(arm).resize(MASK_SIZE, MASK_SIZE).removeAlpha().raw().toBuffer();
  let low = 255;
  let high = 0;
  for (const value of height) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const span = Math.max(1, high - low);
  const out = Buffer.alloc(MASK_SIZE * MASK_SIZE * 3);
  for (let i = 0; i < MASK_SIZE * MASK_SIZE; i++) {
    out[i * 3] = Math.round((height[i] - low) / span * 255);
    out[i * 3 + 1] = packed[i * 3 + 1];
    out[i * 3 + 2] = packed[i * 3];
  }
  return sharp(out, { raw: { width: MASK_SIZE, height: MASK_SIZE, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** Каталог клиента — всё, что нужно шейдеру земли, без сведений о происхождении. */
function runtimeCatalog(sources) {
  return {
    schema: 'kromka.ground-textures.v1',
    note: 'Собирает tools/build-ground-textures.js из source-assets/ground-textures/sources.json: не править руками.',
    defaultSet: sources.defaultSet,
    pathSet: sources.pathSet,
    mudSet: sources.mudSet,
    presets: sources.presets,
    sets: Object.fromEntries(Object.entries(sources.sets).map(([id, set]) => [id, {
      tilingMeters: set.tilingMeters,
      tint: set.tint,
      saturation: set.saturation ?? 1
    }]))
  };
}

function writeIfChanged(file, data) {
  if (fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), data) === 0) return false;
  fs.writeFileSync(file, data);
  return true;
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
  fs.mkdirSync(OUTPUT, { recursive: true });
  let written = 0;
  for (const [id, set] of Object.entries(sources.sets)) {
    const diff = await sourceMap(id, 'diff', set.maps.diff);
    const nor = await sourceMap(id, 'nor', set.maps.nor);
    const arm = await sourceMap(id, 'arm', set.maps.arm);
    const disp = await sourceMap(id, 'disp', set.maps.disp);
    if (writeIfChanged(path.join(OUTPUT, `${id}_albedo.jpg`), diff)) written++;
    if (writeIfChanged(path.join(OUTPUT, `${id}_normal.jpg`), nor)) written++;
    if (writeIfChanged(path.join(OUTPUT, `${id}_mask.png`), await buildMask(disp, arm))) written++;
  }
  const catalog = Buffer.from(JSON.stringify(runtimeCatalog(sources), null, 2) + '\n');
  if (writeIfChanged(path.join(OUTPUT, 'ground-textures.json'), catalog)) written++;
  console.log(`Ground textures: ${Object.keys(sources.sets).length} sets, ${Object.keys(sources.presets).length} presets, `
    + `${written} file(s) written to ${path.relative(ROOT, OUTPUT)}`);
}

module.exports = { runtimeCatalog, MASK_SIZE };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
