#!/usr/bin/env node
'use strict';
// Оптимизация GLB-моделей для обоих клиентов (web Three.js и Unity glTFast):
//  - dedup/prune/resample — без изменения внешнего вида;
//  - квантование НЕ применяется: серверные инструменты коллайдеров читают
//    вершины напрямую (tools/model-collider-geometry.js);
//  - PNG → JPEG для текстур непрозрачных материалов (BLEND/MASK остаются PNG:
//    JPEG без альфы). Meshopt/Draco/KTX2 не применяются: им нужны декодеры на
//    обеих сторонах.
// Запуск: node tools/optimize-glb.js [--dry] [--quality 85] [путь ...]
// Оригиналы в public/assets/models не меняются (их хэши закреплены пайплайном
// утверждения моделей); копии пишутся в public/assets/models-lite/ с тем же
// относительным путём. Каталог в .gitignore — генерируется при деплое.
const fs = require('fs');
const path = require('path');
const { NodeIO, PropertyType } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { dedup, prune, resample } = require('@gltf-transform/functions');
const sharp = require('sharp');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const qIndex = args.indexOf('--quality');
const quality = qIndex >= 0 ? Number(args[qIndex + 1]) : 85;
const targets = args.filter((a, i) => !a.startsWith('--') && (qIndex < 0 || i !== qIndex + 1));
const root = path.join(__dirname, '..');
const defaultDir = path.join(root, 'public', 'assets', 'models');
const outRoot = path.join(root, 'public', 'assets', 'models-lite');

function listGlb(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith('.glb') ? [target] : [];
  return fs.readdirSync(target).flatMap(name => listGlb(path.join(target, name)));
}

async function optimize(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(file);
  const before = fs.statSync(file).size;

  // Текстуры, которые нельзя переводить в JPEG: участвуют в материалах с альфой.
  const keepPng = new Set();
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() === 'OPAQUE') continue;
    for (const texture of [material.getBaseColorTexture(), material.getMetallicRoughnessTexture(), material.getNormalTexture(), material.getEmissiveTexture(), material.getOcclusionTexture()])
      if (texture) keepPng.add(texture);
  }
  for (const texture of document.getRoot().listTextures()) {
    // Текстуры уже не PNG или с альфа-каналом в самом PNG — не трогаем.
    if (texture.getMimeType() !== 'image/png') { keepPng.add(texture); continue; }
    const meta = await sharp(texture.getImage()).metadata();
    if (meta.hasAlpha && meta.channels === 4) {
      const { data } = await sharp(texture.getImage()).raw().toBuffer({ resolveWithObject: true });
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { keepPng.add(texture); break; }
    }
  }
  const convertible = document.getRoot().listTextures().filter(t => !keepPng.has(t));
  let jpegCount = 0;
  for (const texture of convertible) {
    const jpeg = await sharp(texture.getImage()).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length < texture.getImage().length) {
      texture.setImage(jpeg).setMimeType('image/jpeg');
      if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.png$/i, '.jpg'));
      jpegCount++;
    }
  }

  // prune — только неиспользуемые текстуры/материалы/аксессоры: пустые узлы (крепления
  // оружия по имени кости) и скины должны остаться, их ищут по имени оба клиента.
  await document.transform(
    dedup(),
    prune({ propertyTypes: [PropertyType.TEXTURE, PropertyType.TEXTURE_INFO, PropertyType.MATERIAL, PropertyType.ACCESSOR, PropertyType.BUFFER_VIEW, PropertyType.BUFFER], keepLeaves: true, keepAttributes: true, keepIndices: true }),
    resample());

  const out = path.join(outRoot, path.relative(defaultDir, file));
  if (!dry) { fs.mkdirSync(path.dirname(out), { recursive: true }); await io.write(out, document); }
  const after = dry ? (await io.writeBinary(document)).byteLength : fs.statSync(out).size;
  return { before, after, jpegCount, textures: document.getRoot().listTextures().length };
}

(async () => {
  const files = (targets.length ? targets : [defaultDir]).flatMap(t => listGlb(path.resolve(t)));
  let totalBefore = 0, totalAfter = 0;
  for (const file of files) {
    const r = await optimize(file);
    totalBefore += r.before; totalAfter += r.after;
    console.log(`${path.relative(root, file)}: ${(r.before / 1048576).toFixed(2)} → ${(r.after / 1048576).toFixed(2)} МБ (jpeg ${r.jpegCount}/${r.textures})`);
  }
  console.log(`${dry ? '[dry] ' : ''}Итого: ${(totalBefore / 1048576).toFixed(1)} → ${(totalAfter / 1048576).toFixed(1)} МБ, файлов ${files.length}`);
})().catch(error => { console.error(error); process.exit(1); });
