'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const layoutPath=process.argv[2];
if(!layoutPath)throw new Error('Usage: node tools/convert-place-to-sector-site.js <layout.json>');
const layout=JSON.parse(fs.readFileSync(path.resolve(layoutPath),'utf8'));
const file=path.join(root,'data/locations',layout.site.id+'.json');
const source=JSON.parse(fs.readFileSync(file,'utf8'));
const zone=JSON.parse(fs.readFileSync(path.join(root,'data/zones/authored',layout.site.zone+'.json'),'utf8'));
assert.equal(source.id,layout.site.id);
assert.equal(source.safe===true,layout.site.safe===true);
assert(zone.sites.some(site=>site.id===source.id),'Site must already be authored in the sector');
const objects=new Map(zone.objects.map(row=>[row.id,row]));
for(const row of layout.objects) {
  const id=row.stableId||`${layout.site.id}_${row.id}`,saved=objects.get(id);
  assert(saved?.unityAuthored,'Place geometry must be saved and exported before migration: '+id);
  if(row.sourceObjectId) {
    assert.equal(id,row.sourceObjectId,'Functional IDs are stable');
    assert(row.serverMetadata,'Layout must retain canonical server properties for repeat builds: '+id);
    for(const key of ['model','resourceType','resource','interactive','questObjective','entity','hp','maxHp'])
      if(row.serverMetadata[key]!==undefined)assert.deepEqual(saved[key],row.serverMetadata[key],'Lost gameplay field '+id+' '+key);
  }
}
for(const before of source.containers||[]) {
  const after=zone.containers.find(c=>c.id===before.id&&c.site===source.id);
  assert(after,'Missing migrated container '+before.id);
  for(const key of ['loot','locked','lockDifficulty','terminalLocked','terminalUnlocksLock','terminalName','terminalDifficulty'])
    if(before[key]!==undefined)assert.deepEqual(after[key],before[key],'Lost container field '+before.id+' '+key);
}
const next={...source,site:{zone:layout.site.zone,safe:layout.site.safe===true},runtimeMode:'zone-site',objects:[],containers:[],transitions:[],worldZones:[]};
delete next.entryFromWorld;
delete next.unityScene;
fs.writeFileSync(file,JSON.stringify(next,null,2)+'\n');
require('./sync-unity-site-scenes').synchronize(root);
console.log('Place now enters through its sector:',source.id,layout.site.zone);
