'use strict';
// This is the sole planner for physical freight piers and service closures.
// Unity and the authoritative movement planner consume the resulting rows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {groundHeight}=require('../src/server/sector-surface');
const {envelopes,rectangle,segmentHits}=require('./lib/sector-visual-clearance');
const root=path.resolve(__dirname,'..');
const round=v=>Number(v.toFixed(5));
function planRailSupports(catalog) {
const reports=[];
for(const p of catalog.profiles) {
  p.railSupports=[];p.railBarriers=[];
  if(!p.railInfrastructure?.length)continue;
  const definition=JSON.parse(fs.readFileSync(path.join(root,p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json'),'utf8'));
  const bounds=envelopes(p.locationId),placements=new Map((p.placements||[]).map(v=>[v.id,v]));
  const fixed=(definition.objects||[]).filter(row=>(row.tags||[]).some(t=>['facility-kit','site','city-kit'].includes(t)))
    .filter(row=>row.position&&bounds.has(row.id)&&!placements.get(row.id)?.remove)
    .map(row=>rectangle(row,placements.get(row.id)||row.surfaceSourcePosition||row.position,bounds.get(row.id),.5));
  const pointsOf=route=>route.points?.length?route.points:[route.a,route.b];
  const closest=(points,x,z)=>{
    let best=Infinity;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-8,dx*dx+dz*dz)));
      best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    }
    return best;
  };
  const publicRoads=p.roads.filter(r=>!r.blocked&&r.type!=='railway');
  const anchors=[...(p.functionalPlacements||[]),...(p.interactionApproaches||[]),...(p.navigation?.nodes||[])];
  const usedSupports=new Set(),usedBarriers=new Set();
  for(const route of p.railInfrastructure) {
    const points=route.points||[],spacing=Math.max(4,route.viaductSupportSpacing||12);
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];if(a.kind!=='viaduct'&&b.kind!=='viaduct')continue;
      for(let station=Math.ceil(a.alongMetres/spacing)*spacing;station<=b.alongMetres;station+=spacing) {
        const key=round(station);if(usedSupports.has(key))continue;
        const t=(station-a.alongMetres)/Math.max(1e-8,b.alongMetres-a.alongMetres);
        const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,h=a.h+(b.h-a.h)*t;
        if(Math.abs(x)>p.width/2+3||Math.abs(z)>p.depth/2+3)continue;
        const centreGround=groundHeight(p,catalog.relief,x,z,false,null,false);
        if(h-centreGround<=1||publicRoads.some(r=>closest(pointsOf(r),x,z)<=r.halfWidth+route.halfWidth+2)||anchors.some(v=>Math.hypot(v.x-x,v.z-z)<5))continue;
        const dx=b.x-a.x,dz=b.z-a.z,run=Math.hypot(dx,dz),side={x:-dz/run,z:dx/run};
        if(fixed.some(rect=>segmentHits(rect,{x:x-side.x*2.2,z:z-side.z*2.2},{x:x+side.x*2.2,z:z+side.z*2.2},1.1)))continue;
        let g=Infinity;
        for(const along of [-1.1,-.55,0,.55,1.1])for(const across of [-2.2,-1.1,0,1.1,2.2])
          g=Math.min(g,groundHeight(p,catalog.relief,x+dx/run*along+side.x*across,z+dz/run*along+side.z*across,false,null,false));
        usedSupports.add(key);
        p.railSupports.push({id:'freight_pier_'+round(station).toString().replace('.','_'),x:round(x),z:round(z),h:round(h-.55),g:round(g-.25),halfLength:1.1,halfWidth:2.2,rotationY:round(Math.atan2(dz,dx)),alongMetres:round(station)});
      }
    }
    for(const span of route.spans||[])for(const end of ['Start','End']) {
      if(!(span['portal'+end]||span['service'+end]))continue;
      const index=end==='Start'?span.fromIndex:span.toIndex,a=points[index],b=points[Math.max(0,Math.min(points.length-1,index+(end==='Start'?1:-1)))];
      if(!a||!b||Math.abs(a.x)>p.width/2+4||Math.abs(a.z)>p.depth/2+4)continue;
      const key=span.globalId+'_'+end;if(usedBarriers.has(key))continue;
      usedBarriers.add(key);
      p.railBarriers.push({id:'freight_closed_'+key,kind:span.kind,globalId:span.globalId,x:round(a.x),z:round(a.z),h:round(a.h),g:round(groundHeight(p,catalog.relief,a.x,a.z,false,null,false)),halfLength:.06,halfWidth:round(route.halfWidth+.85+.5),height:span.kind==='tunnel'?route.tunnelClearanceHeight:2.2,rotationY:round(Math.atan2(b.z-a.z,b.x-a.x))});
    }
  }
  reports.push({zone:p.zoneId,supports:p.railSupports.length,barriers:p.railBarriers.length});
}
return reports;
}
if(require.main===module) {
  const [input,output]=process.argv.slice(2);
  if(!input||!output||input===output)throw Error('Pass distinct input/output stage paths.');
  const catalog=JSON.parse(fs.readFileSync(input,'utf8')),reports=planRailSupports(catalog);
  delete catalog.sourceHash;catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  fs.writeFileSync(output,JSON.stringify(catalog)+'\n');console.log(JSON.stringify(reports));
}
module.exports={planRailSupports};
