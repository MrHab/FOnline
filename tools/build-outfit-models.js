'use strict';
// Одежда Quaternius «Modular Character Outfits – Fantasy» (CC0) на наши две
// базовые модели: сборка в Blender, манифест, облегчённые копии и версия
// каталога в клиенте. Исходный архив лежит в Build/SourceDownloads и не входит
// в git; его хэш закреплён в сборщике.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const bodies = ['male_medium', 'female_medium'];
const items = ['leather'];
const candidateDir = path.join(root, 'unity-client/Logs/OutfitCandidate');
const publicDir = path.join(root, 'public/assets/models/equipment/outfits-v1');
const catalogFile = path.join(root, 'unity-client/Assets/Scripts/Game/RoaOutfitModelCatalog.cs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Outfit build failed (${result.status}): ${exe}`);
}

const blender = process.env.REALM_BLENDER_EXE
  || path.join(os.homedir(), '.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
for (const item of items) {
  for (const body of bodies) {
    run(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', 'tools/blender/build_ubc_outfit_models.py', '--', `--item=${item}`, `--body=${body}`]);
  }
}

fs.mkdirSync(publicDir, { recursive: true });
const rows = [];
for (const item of items) {
  for (const body of bodies) {
    const name = `equipment_${item}_${body}.glb`;
    const bytes = fs.readFileSync(path.join(candidateDir, name));
    fs.writeFileSync(path.join(publicDir, name), bytes);
    const report = JSON.parse(fs.readFileSync(path.join(candidateDir, `equipment_${item}_${body}.report.json`), 'utf8'));
    rows.push({
      itemId: item,
      bodyId: body,
      file: `/assets/models/equipment/outfits-v1/${name}`,
      sha256: hash(bytes),
      bytes: bytes.length,
      triangles: report.triangles,
      parts: report.parts,
      fit: report.fit,
      source: report.source,
      bodyReference: {
        file: `public/assets/models/characters/base/character_${body}.glb`,
        sha256: hash(fs.readFileSync(path.join(root, `public/assets/models/characters/base/character_${body}.glb`)))
      }
    });
  }
}
const version = '1-' + hash(rows.map(row => row.sha256).join('')).slice(0, 8);
fs.writeFileSync(path.join(publicDir, 'manifest.json'),
  JSON.stringify({ schema: 'realm.ubc-outfits.v1', version, generator: 'tools/blender/build_ubc_outfit_models.py', files: rows }, null, 2) + '\n');

const catalog = fs.readFileSync(catalogFile, 'utf8');
if (!/OutfitVersion = "[^"]+"/.test(catalog)) throw new Error('Missing outfit cache version');
fs.writeFileSync(catalogFile, catalog.replace(/OutfitVersion = "[^"]+"/, `OutfitVersion = "${version}"`));

run(process.execPath, ['tools/optimize-glb.js', publicDir]);
run(process.execPath, ['tools/check-outfit-models.js']);
console.log(`Outfits ${version}: ${rows.length} models built, published and checked.`);
