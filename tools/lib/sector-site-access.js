'use strict';
const {routeOnLand}=require('./sector-access');

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
      const target=site.entrance||node.surfaceSourcePoint||{x:Number(node.x??((node.tx-p.width/4+.5)*2)),z:Number(node.z??((node.tz-p.depth/4+.5)*2))};
      const points=routeOnLand(p,field,p.hub,target,1.8,.7,cache);
      p.roads.push({id:'site_'+site.id,type:'track',halfWidth:2.5,a:p.hub,b:target,points:points||[],blocked:!points});
    }
  }
}
module.exports={planSiteAccess};
