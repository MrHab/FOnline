'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
function applyRailDecks(catalog,rail={schema:'roa.railInfrastructure.v1',zones:Object.fromEntries(catalog.profiles.map(p=>[p.zoneId,p.railInfrastructure||[]]))}) {
if(rail.schema!=='roa.railInfrastructure.v1')throw new Error('Unsupported freight infrastructure schema.');
const changed=[];
for(const profile of catalog.profiles) {
  profile.railInfrastructure=rail.zones[profile.zoneId]||[];
  profile.bridges=profile.bridges.filter(b=>b.style!=='railViaduct');
  for(const route of profile.railInfrastructure)for(const span of route.spans) {
    if(span.kind!=='viaduct')continue;
    const points=route.points.slice(Math.max(0,span.fromIndex-1),Math.min(route.points.length,span.toIndex+2)).map(p=>({x:p.x,z:p.z,h:p.h}));
    if(points.length<2)continue;
    profile.bridges.push({id:span.id+'_deck',type:'railway',style:'railViaduct',halfWidth:route.halfWidth,
      a:points[0],b:points.at(-1),height:points[0].h,points});
  }
  if(profile.railInfrastructure.length)changed.push({zone:profile.zoneId,routes:profile.railInfrastructure.length,viaducts:profile.bridges.filter(b=>b.style==='railViaduct').length});
}
return changed;
}
if(require.main===module) {
  const [input,railInput,output]=process.argv.slice(2);
  if(!output)throw new Error('Pass engineering stage, generated rail infrastructure and output stage.');
  const catalog=JSON.parse(fs.readFileSync(input,'utf8'));
  const changed=applyRailDecks(catalog,railInput==='--profile'?undefined:JSON.parse(fs.readFileSync(railInput,'utf8')));
  delete catalog.sourceHash;catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  fs.writeFileSync(output,JSON.stringify(catalog)+'\n');console.log(JSON.stringify({changed}));
}
module.exports={applyRailDecks};
