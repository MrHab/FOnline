'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {sectorSourceDefinition}=require('./lib/sector-source-definition');
const {planPlacements}=require('./lib/sector-placement');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(process.env.ROA_SURFACE_INPUT||path.join(root,'data/kromka/sector-surfaces.json'),'utf8'));
let profiles=0,removed=0,replays=0;
for(const p of catalog.profiles) {
  if(p.legacyDam)continue;
  const relative=p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json';
  const original=sectorSourceDefinition(JSON.parse(fs.readFileSync(path.join(root,relative),'utf8')));
  const deleted=new Set((p.placements||[]).filter(row=>row.remove).map(row=>row.id));
  const objects=original.objects||[];
  const saved={...original,objects:objects.filter(row=>!deleted.has(row.id)),surfaceSource:{...original.surfaceSource,
    objectOrder:objects.map(row=>row.id),removedObjects:objects.filter(row=>deleted.has(row.id))}};
  const restored=sectorSourceDefinition(saved);
  assert.deepEqual(restored.objects,objects,p.zoneId+' source decoration changed after save/rebuild');
  assert(!saved.objects.some(row=>deleted.has(row.id)),p.zoneId+' removed decoration remains in server objects');
  if(['z_02_11','z_08_14','sluiceCity'].includes(p.locationId)) {
    assert.deepEqual(planPlacements(p,catalog.relief,restored),planPlacements(p,catalog.relief,original),p.zoneId+' placement changed after source restoration');
    replays++;
  }
  profiles++;removed+=saved.surfaceSource.removedObjects.length;
}
assert.equal(profiles,196);assert.equal(replays,3);
console.log(JSON.stringify({status:'PASS',profiles,removedDecoration:removed,placementReplays:replays}));
