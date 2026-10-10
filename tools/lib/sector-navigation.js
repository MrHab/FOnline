'use strict';
const {groundHeight,isWaterAt}=require('../../src/server/sector-surface');
const {routeOnLand}=require('./sector-access');
const {blockedAt}=require('./sector-obstacles');

// The existing named nodes remain meaningful to events and sites. Only the
// connections between them are rebuilt around the prepared terrain.
function planNavigation(p,field,definition) {
  const nav=definition.zone?.nav;
  if(!nav||p.legacyDam)return null;
  const sourceNodes=(nav.nodes||[]).filter(n=>!/^surface_/.test(n.id));
  const sourceLinks=definition.surfaceSource?.navLinks||nav.links.filter(l=>!l.some(id=>/^surface_/.test(id)));
  // Named links must keep their independently checked endpoint selection.
  // Reusing a hub route can select an earlier reachable node that the direct
  // named link cannot resolve through its coarse lattice.
  const cache={disablePathReuse:true,actorWalk:true},routeCache=new Map();
  const route=(a,b)=>{
    const key=a.x.toFixed(5)+','+a.z.toFixed(5)+'|'+b.x.toFixed(5)+','+b.z.toFixed(5);
    if(!routeCache.has(key))routeCache.set(key,routeOnLand(p,field,a,b,.48,.9,cache));
    return routeCache.get(key);
  };
  const reachable=point=>!isWaterAt(p,point.x,point.z,.48,field)&&!blockedAt(p,point.x,point.z,.48)&&!!route(p.hub,point);
  const sourcePoint=row=>row.surfaceSourcePoint||{x:Number(row.x??((row.tx-p.width/4+.5)*2)),z:Number(row.z??((row.tz-p.depth/4+.5)*2))};
  const nodes=[];
  for(const row of sourceNodes) {
    const source=sourcePoint(row);let point=null;
    if(row.id==='hub')point=p.hub;
    const gate=/^gate_(north|south|east|west)(_turn)?$/.exec(row.id);
    if(gate) {
      const road=p.roads.find(r=>r.id==='gate_'+gate[1]);
      if(!road||road.blocked)throw new Error('Navigation needs a built gate '+p.zoneId+' '+row.id);
      const path=road.points?.length?road.points:[road.a,road.b];
      point=gate[2]?path[Math.min(1,path.length-1)]:path.at(-1);
    }
    const facility=(definition.facilities||[]).find(f=>row.id==='place_'+f.id);
    if(facility){point=facility.entrance;if(!reachable(point))throw new Error('Facility nav entrance is inaccessible '+p.zoneId+' '+facility.id);}
    if(!point && reachable(source))point=source;
    if(!point)for(let ring=2;ring<p.width&&!point;ring+=2) {
      const count=Math.max(16,Math.ceil(ring*Math.PI));
      for(let i=0;i<count;i++) {
        const v={x:source.x+ring*Math.cos(i*2*Math.PI/count),z:source.z+ring*Math.sin(i*2*Math.PI/count)};
        if(Math.abs(v.x)>p.width/2-4||Math.abs(v.z)>p.depth/2-4)continue;
        if(reachable(v)){point=v;break;}
      }
    }
    if(!point)throw new Error('No reachable named navigation node '+p.zoneId+' '+row.id);
    nodes.push({id:row.id,source,x:Number(point.x.toFixed(5)),z:Number(point.z.toFixed(5)),y:Number((groundHeight(p,field,point.x,point.z,true)+.1).toFixed(5))});
  }
  const byId=new Map(nodes.map(n=>[n.id,n])),connections=[];
  for(let i=0;i<sourceLinks.length;i++) {
    const link=sourceLinks[i];
    if(link.every(id=>id==='hub'||/^gate_/.test(id)))continue;
    const a=byId.get(link[0]),b=byId.get(link[1]);
    if(!a||!b)throw new Error('Missing authored nav endpoint '+p.zoneId+' '+link.join('|'));
    const points=route(a,b);
    if(!points)throw new Error('Disconnected named navigation link '+p.zoneId+' '+link.join('|'));
    connections.push({id:i,from:a.id,to:b.id,points});
  }
  return {sourceLinks,nodes,connections};
}
module.exports={planNavigation};
