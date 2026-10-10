'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {planPlacements}=require('./lib/sector-placement');
const root=path.resolve(__dirname,'..');
const [input,output,manifestOutput]=process.argv.slice(2);
if(!input||!output||!manifestOutput)throw new Error('Pass engineering stage, placement stage and delta manifest.');
const catalog=JSON.parse(fs.readFileSync(input,'utf8'));
const changed=[];
for(const profile of catalog.profiles) {
  if(profile.legacyDam)continue;
  const definition=JSON.parse(fs.readFileSync(path.join(root,profile.locationId===profile.zoneId?'data/zones/authored/'+profile.zoneId+'.json':'data/locations/'+profile.locationId+'.json'),'utf8'));
  const previous=new Map((profile.placements||[]).map(row=>[row.id,row]));
  profile.placements=planPlacements(profile,catalog.relief,definition);
  const current=new Map(profile.placements.map(row=>[row.id,row]));
  const ids=[...new Set([...previous.keys(),...current.keys()])].filter(id=>JSON.stringify(previous.get(id))!==JSON.stringify(current.get(id))).sort();
  if(ids.length)changed.push({zone:profile.zoneId,ids,relocated:ids.filter(id=>current.has(id)&&!current.get(id).remove)});
}
delete catalog.sourceHash;catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
fs.writeFileSync(output,JSON.stringify(catalog)+'\n');
fs.writeFileSync(manifestOutput,JSON.stringify({schema:'roa.sectorPlacementDelta.v1',input,path:output,changed},null,2)+'\n');
console.log(JSON.stringify({changedZones:changed.length,changedObjects:changed.reduce((n,p)=>n+p.ids.length,0),relocatedObjects:changed.reduce((n,p)=>n+p.relocated.length,0),output}));
