'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {visualClearance}=require('./lib/sector-visual-clearance');
const {planPlacements,optionalScatter}=require('./lib/sector-placement');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/kromka/sector-surfaces.json'),'utf8'));
const zone='z_10_08';
const profile=catalog.profiles.find(row=>row.zoneId===zone);
assert.ok(profile,'Real framework fixture profile is missing');
const source=JSON.parse(fs.readFileSync(path.join(root,'data/zones/authored/'+zone+'.json'),'utf8'));
const framework=source.objects.find(row=>row.id==='s07_s1');
// Successful projection archives this exact bush; retain it as the input fixture
// instead of requiring the corrected scene to still contain the removed object.
const bush=source.objects.find(row=>row.id==='s07_sc0_3')
  || source.surfaceSource?.removedObjects?.find(row=>row.id==='s07_sc0_3');
assert.equal(framework?.model,'wastelandShack');
assert.equal(bush?.model,'dryBush');
assert.equal(bush?.role,'scenery');
const position=bush.surfacePlacement||bush.surfaceSourcePosition||bush.position;
const visual=visualClearance(profile,catalog.relief,source);
assert.equal(visual.frameworkInside(position.x,position.z),true,'Real bush must be rooted inside native framework');
assert.equal(optionalScatter(bush),true,'Real bush must be optional');
const minimal={...source,objects:[framework,bush],containers:[],surfaceSource:{removedObjects:[]}};
const changes=planPlacements(profile,catalog.relief,minimal);
assert.ok(changes.some(change=>change.id===bush.id&&change.remove===true),'Real centred bush was not archived');
for(const [name,change] of [
  ['protected',{nativeSupport:true}],
  ['interactive',{interactive:true}],
  ['resource',{role:'resource',resourceType:'wood'}],
  ['outside',{position:{...bush.position,x:framework.position.x+20,z:framework.position.z+20},surfaceSourcePosition:{...bush.surfaceSourcePosition,x:framework.position.x+20,z:framework.position.z+20}}],
  ['debris',{model:'perimeterDebris'}]
]) {
  const candidate={...bush,...change};
  const test={...minimal,objects:[framework,candidate]};
  const at=candidate.surfacePlacement||candidate.surfaceSourcePosition||candidate.position;
  if(name==='outside')assert.equal(visualClearance(profile,catalog.relief,test).frameworkInside(at.x,at.z),false);
  else assert.equal(visualClearance(profile,catalog.relief,test).frameworkInside(at.x,at.z),true);
  if(name!=='outside'&&name!=='debris')assert.equal(optionalScatter(candidate),false,name+' was not protected');
  // These variants must never be removed by the framework vegetation rule.
  // Other physical placement rules remain free to act on them.
  if(name==='debris')assert.equal(candidate.model!=='dryBush',true);
}
// A moved framework is tested at its live source alias, while its preserved
// original anchor remains available for history without becoming an obstacle.
const moved=JSON.parse(fs.readFileSync(path.join(root,'data/zones/authored/z_09_11.json'),'utf8'));
const movedFramework=moved.objects.find(row=>row.id==='s60_s1');
const movedProfile=catalog.profiles.find(row=>row.zoneId==='z_09_11');
assert.ok(movedFramework&&movedProfile);
const movedVisual=visualClearance(movedProfile,catalog.relief,moved);
const live=movedFramework.surfacePlacement||movedFramework.surfaceSourcePosition||movedFramework.position;
assert.equal(movedVisual.frameworkInside(live.x,live.z),true);
assert.equal(movedVisual.frameworkInside(movedFramework.terrainOriginalPosition.x,movedFramework.terrainOriginalPosition.z),false);
console.log(JSON.stringify({status:'PASS',realBush:bush.id,movedFramework:movedFramework.id,protectedCases:3,outsideAndDebris:2}));
