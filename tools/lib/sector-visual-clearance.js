'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {groundHeight,isWaterAt}=require('../../src/server/sector-surface');
const catalogPath=path.resolve(__dirname,'../../data/kromka/sector-visual-bounds.json');
let catalog;
function envelopes(id) {
  if(!catalog)catalog=new Map(JSON.parse(fs.readFileSync(catalogPath,'utf8')).profiles.map(p=>[p.locationId,new Map(p.objects.map(row=>[row.id,row]))]));
  return catalog.get(id)||new Map();
}
function rectangle(row,position,bounds,margin=0) {
  const x=position.x+(bounds?.centerX||0),z=position.z+(bounds?.centerZ||0);
  const hx=(bounds?.halfX||Number(row.footprint?.x||1)/2)+margin;
  const hz=(bounds?.halfZ||Number(row.footprint?.z||1)/2)+margin;
  return {minX:x-hx,maxX:x+hx,minZ:z-hz,maxZ:z+hz};
}
function overlaps(a,b){return a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;}
function clearanceSubject(row) {
  // Anomaly fields are runtime effects rather than native static meshes;
  // their radius and reachable bolt approach are checked by planFunctional.
  return !row.entity&&!row.nativeSupport&&!['terrain','anomaly'].includes(row.role)&&!(row.tags||[]).some(t=>['facility-kit','site','city-kit','city-plot','city-wall','bridge','canal','water','river'].includes(t));
}
function segmentHits(rect,a,b,margin) {
  const dx=b.x-a.x,dz=b.z-a.z;let lo=0,hi=1;
  for(const [start,delta,min,max] of [[a.x,dx,rect.minX-margin,rect.maxX+margin],[a.z,dz,rect.minZ-margin,rect.maxZ+margin]]) {
    if(Math.abs(delta)<1e-9){if(start<min||start>max)return false;continue;}
    const t1=(min-start)/delta,t2=(max-start)/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
  }
  return lo<=hi;
}
function visualClearance(profile,field,definition) {
  const bounds=envelopes(profile.locationId);
  const architecture=(definition.objects||[]).filter(row=>(row.tags||[]).some(t=>t==='facility-kit'||t==='site'||t==='city-kit'))
    .filter(row=>row.position&&bounds.has(row.id)).map(row=>rectangle(row,row.surfaceSourcePosition||row.position,bounds.get(row.id),.25));
  const archived=new Set((definition.surfaceSource?.removedObjects||[]).map(row=>row.id));
  // A loose dry bush rooted inside a retained open framework hides its native
  // posts. This is a centre-only vegetation clearance, not an obstacle for
  // debris, resources, interiors or other protected objects.
  const frameworks=(definition.objects||[])
    .filter(row=>row.model==='wastelandShack'&&row.role==='cover'&&!archived.has(row.id)&&bounds.has(row.id))
    .map(row=>rectangle(row,row.surfacePlacement||row.surfaceSourcePosition||row.position,bounds.get(row.id)));
  const routes=[];
  for(const route of [...profile.roads.filter(r=>!r.blocked&&r.type!=='pipeline'),...profile.processPipes||[]]) {
    const points=route.points?.length?route.points:[route.a,route.b];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];
      if(route.style==='process'&&Math.max(a.h-groundHeight(profile,field,a.x,a.z),b.h-groundHeight(profile,field,b.x,b.z))+route.halfWidth<.08)continue;
      routes.push({a,b,margin:route.halfWidth+(route.style==='process'?.35:.8),rect:{minX:Math.min(a.x,b.x)-route.halfWidth-1,maxX:Math.max(a.x,b.x)+route.halfWidth+1,minZ:Math.min(a.z,b.z)-route.halfWidth-1,maxZ:Math.max(a.z,b.z)+route.halfWidth+1}});
    }
  }
  return {bounds,frameworkInside(x,z){
    return frameworks.some(rect=>x>rect.minX&&x<rect.maxX&&z>rect.minZ&&z<rect.maxZ);
  },wet(row,x,z,margin=0){
    const envelope=bounds.get(row.id);
    const radius=envelope?Math.hypot(envelope.halfX,envelope.halfZ):Math.hypot(Number(row.footprint?.x||1),Number(row.footprint?.z||1))/2;
    return isWaterAt(profile,x+(envelope?.centerX||0),z+(envelope?.centerZ||0),radius+margin,field);
  },blocked(row,x,z){
    const rect=rectangle(row,{x,z},bounds.get(row.id),.15);
    return architecture.some(other=>overlaps(rect,other))||routes.some(route=>overlaps(rect,route.rect)&&segmentHits(rect,route.a,route.b,route.margin));
  }};
}
module.exports={visualClearance,clearanceSubject,envelopes,rectangle,overlaps,segmentHits};
