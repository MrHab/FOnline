'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname,'..');
function run(exe,args) {
  const result = spawnSync(exe,args,{cwd:root,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status !== 0) throw new Error(`Equipment build step failed (${result.status})`);
}
if (!process.argv.includes('--sync-only')) {
  run(process.execPath,['tools/fetch-free-item-sources.js']);
  run(process.execPath,['tools/fetch-free-gear-sources.js']);
  const blender = process.env.REALM_BLENDER_EXE || path.join(os.homedir(),'.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
  run(blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_free_equipment_models.py',
    '--','--review',path.join(root,'unity-client/Temp/FreeEquipmentReview')]);
}
run(process.execPath,['tools/optimize-glb.js',path.join(root,'public/assets/models/equipment/free-v2')]);
const manifest = JSON.parse(fs.readFileSync(path.join(root,'public/assets/models/equipment/free-v2/manifest.json')));
const client = path.join(root,'unity-client/Assets/Scripts/Game/RoaEquipmentModelCatalog.cs');
const source = fs.readFileSync(client,'utf8');
const pattern = /CatalogVersion = "[^"]+"/;
if (!pattern.test(source)) throw new Error('Equipment cache version missing');
const updated = source.replace(pattern,`CatalogVersion = "${manifest.version}"`);
if (updated !== source) fs.writeFileSync(client,updated);
run(process.execPath,['tools/check-free-equipment-models.js']);
