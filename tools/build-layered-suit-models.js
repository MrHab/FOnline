'use strict';
const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawnSync}=require('child_process');
const {preparePromotion}=require('./layered-suit-promotion');
const root=path.resolve(__dirname,'..');
function run(exe,args) {
  const result=spawnSync(exe,args,{cwd:root,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`Layered suit build failed (${result.status})`);
}
const syncOnly=process.argv.includes('--sync-only');
const promote=process.argv.includes('--promote-candidate');
if(syncOnly && promote)throw new Error('Choose either --sync-only or --promote-candidate');
if(!syncOnly && !promote) {
  run(process.execPath,['tools/fetch-free-armor-sources.js']);
  const blender=process.env.REALM_BLENDER_EXE || path.join(os.homedir(),'.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
  run(blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_layered_suit_models.py','--','--candidate','--joint-liner']);
  run(process.execPath,['tools/check-layered-suit-models.js','--candidate']);
  console.log('Built the complete upper-fitted candidate. Verify coverage, Blender views and native Unity captures, then use --promote-candidate. Public models were not changed.');
  process.exit(0);
}
if(promote)run(process.execPath,['tools/check-layered-suit-models.js','--candidate']);
const promotion=promote?preparePromotion(root):null;
try {
  if(promotion)promotion.apply();
  run(process.execPath,['tools/optimize-glb.js',path.join(root,'public/assets/models/equipment/suits-v2')]);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/assets/models/equipment/suits-v2/manifest.json')));
  const client=path.join(root,'unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs');
  const source=fs.readFileSync(client,'utf8');
  if(!/CatalogVersion = "[^"]+"/.test(source)) throw new Error('Missing suit cache version');
  const updated=source.replace(/CatalogVersion = "[^"]+"/,`CatalogVersion = "${manifest.version}"`);
  if(source!==updated) fs.writeFileSync(client,updated);
  run(process.execPath,['tools/check-layered-suit-models.js']);
  if(promotion) {
    promotion.commit();
    console.log(`Promoted exact reviewed suit bytes ${promotion.version}. Recoverable backup: ${promotion.backup}`);
    console.log('Regenerate worn utilities and run final Unity/WebGL checks before claiming the player is updated.');
  }
} catch(error) {
  if(promotion)promotion.rollback();
  throw error;
}
