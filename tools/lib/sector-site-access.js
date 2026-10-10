'use strict';
const fs=require('node:fs'),path=require('node:path');
const {routeOnLand}=require('./sector-access');

const root=path.resolve(__dirname,'../..');
function authoredEntrance(site,zoneId) {
  const file=path.join(root,'data/kromka/site-layouts',site.id+'.json');
  if(!fs.existsSync(file))return null;
  const layout=JSON.parse(fs.readFileSync(file,'utf8'));
  const authored=layout.site;
  if(authored?.id!==site.id||authored.zone!==zoneId)
    throw new Error('Mismatched authored site approach '+zoneId+' '+site.id);
  if(authored.entrance!==undefined) {
    const {x,z}=authored.entrance;
    if(!Number.isFinite(x)||!Number.isFinite(z))
      throw new Error('Invalid authored site entrance '+zoneId+' '+site.id);
    return {x,z};
  }
  if(layout.approach===undefined)return null;
  const {x,z}=layout.approach,center=authored.center,angle=Number(authored.rotationY||0)*Math.PI/180;
  if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(center?.x)||!Number.isFinite(center?.z)||!Number.isFinite(angle))
    throw new Error('Invalid authored site approach '+zoneId+' '+site.id);
  return {x:center.x+x*Math.cos(angle)+z*Math.sin(angle),z:center.z-x*Math.sin(angle)+z*Math.cos(angle)};
}

// A place's authored entrance is a physical service road destination. Keeping
// it only in the A-life navigation graph would leave native yards disconnected
// from the engineered vehicle approaches.
function planSiteAccess(profiles,field,definitionOf) {
  for(const p of profiles) {
    if(p.legacyDam)continue;
    const definition=definitionOf(p),cache={};
    for(const site of [...definition.sites||[],...definition.facilities||[]]) {
      const node=definition.zone?.nav?.nodes?.find(n=>n.id==='place_'+site.id);
      if(!node)throw new Error('Missing authored site approach '+p.zoneId+' '+site.id);
      const target=authoredEntrance(site,p.zoneId)||site.entrance||node.surfaceSourcePoint||{x:Number(node.x??((node.tx-p.width/4+.5)*2)),z:Number(node.z??((node.tz-p.depth/4+.5)*2))};
      const points=routeOnLand(p,field,p.hub,target,1.8,.7,cache);
      p.roads.push({id:'site_'+site.id,type:'track',halfWidth:2.5,a:p.hub,b:target,points:points||[],blocked:!points});
    }
  }
}
module.exports={planSiteAccess};
