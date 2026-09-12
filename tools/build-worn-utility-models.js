'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Utility build step failed (${result.status})`);
}
if (!process.argv.includes('--sync-only')) {
  run(process.execPath, ['tools/check-free-item-models.js']);
  const blender = process.env.REALM_BLENDER_EXE || path.join(os.homedir(), '.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
  run(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python', 'tools/blender/build_worn_utility_models.py']);
}
run(process.execPath, ['tools/optimize-glb.js', path.join(root, 'public/assets/models/equipment/utilities-v1')]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/models/equipment/utilities-v1/manifest.json')));
const client = path.join(root, 'unity-client/Assets/Scripts/Game/RoaWornUtilityCatalog.cs');
const source = fs.readFileSync(client, 'utf8');
if (!/CatalogVersion = "[^"]+"/.test(source)) throw new Error('Missing utility cache version');
const updated = source.replace(/CatalogVersion = "[^"]+"/, `CatalogVersion = "${manifest.version}"`);
if (source !== updated) fs.writeFileSync(client, updated);
run(process.execPath, ['tools/check-worn-utility-models.js']);
