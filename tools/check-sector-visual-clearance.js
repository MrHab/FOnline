'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {visualClearance,clearanceSubject}=require('./lib/sector-visual-clearance');
const {nativeGroundSupport,optionalScatter}=require('./lib/sector-placement');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(process.env.ROA_SURFACE_INPUT||path.join(root,'data/kromka/sector-surfaces.json'),'utf8'));
const defects=[];let zones=0,objects=0;
for(const profile of catalog.profiles) {
  if(profile.legacyDam)continue;
  const file=profile.locationId===profile.zoneId?'data/zones/authored/'+profile.zoneId+'.json':'data/locations/'+profile.locationId+'.json';
  const definition=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const clearance=visualClearance(profile,catalog.relief,definition);
  const placements=new Map((profile.placements||[]).map(p=>[p.id,p]));
  const containerVisuals=new Set((definition.containers||[]).map(row=>row.visualObjectId).filter(Boolean));
  for(const row of definition.objects||[]) {
    if(!row.position||!clearanceSubject(row)||placements.get(row.id)?.remove)continue;
    const position=placements.get(row.id)||row.surfacePlacement||row.surfaceSourcePosition||row.position;
    if(!clearance.bounds.has(row.id))defects.push({zone:profile.zoneId,id:row.id,kind:'missing-native-envelope'});
    if(clearance.blocked(row,position.x,position.z))defects.push({zone:profile.zoneId,id:row.id,kind:'infrastructure-intersection'});
    if(clearance.wet(row,position.x,position.z))defects.push({zone:profile.zoneId,id:row.id,kind:'water-intersection'});
    if(optionalScatter(row,containerVisuals)&&!nativeGroundSupport(profile,catalog.relief,row,position,clearance.bounds.get(row.id)))
      defects.push({zone:profile.zoneId,id:row.id,kind:'unsupported-rigid-decoration'});
    objects++;
  }
  zones++;
}
assert.equal(zones,196,'Incomplete world geometry clearance verification');
assert.equal(defects.length,0,'Native visual clearance defects:\n'+JSON.stringify(defects.slice(0,50),null,2)+'\nTotal '+defects.length);
console.log(JSON.stringify({status:'PASS',zones,nativeObjects:objects}));
