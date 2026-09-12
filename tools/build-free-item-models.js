#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'public/assets/models/items/kromka');
const blender = process.env.REALM_BLENDER_EXE || path.join(os.homedir(),
  '.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');

function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(exe)} failed (${result.status})`);
}

if (!process.argv.includes('--sync-only')) {
  run(process.execPath, ['tools/fetch-free-item-sources.js']);
  run(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
    '--python', 'tools/blender/build_free_item_models.py']);
}
run(process.execPath, ['tools/optimize-glb.js', directory]);
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const client = path.join(root, 'unity-client/Assets/Scripts/Game/RoaItemModelCatalog.cs');
const code = fs.readFileSync(client, 'utf8');
const pattern = /CatalogVersion = "[^"]+"/;
if (!pattern.test(code)) throw new Error('Item catalog cache version not found');
const updated = code.replace(pattern, `CatalogVersion = "${manifest.version}"`);
if (updated !== code) fs.writeFileSync(client, updated);
run(process.execPath, ['tools/check-free-item-models.js']);
console.log(`Free item runtime catalog + lite + Unity version synchronized: ${manifest.version}`);
