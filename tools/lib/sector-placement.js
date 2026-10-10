'use strict';
const {groundHeight,isWaterAt,segmentDistance,bridgeAt}=require('../../src/server/sector-surface');
const {createLocationCollision,circleBlockerPenalty}=require('../../src/server/location-collision');
const {visualClearance,clearanceSubject}=require('./sector-visual-clearance');
const shoreMesh=require('../../src/server/sector-mesh-patches');
const {locationObjectBlockers}=createLocationCollision({tile:2});
const round=n=>Number(n.toFixed(5));
const rigidScatter=new Set(['carWreck','tireStack','cargoStack','rustBarrelV1','barrelCluster','perimeterDebris','asphaltSlab','watchPost','storageLeanTo','workshopBench']);
const dryBushSlopeLimit=Math.tan(75*Math.PI/180);
function optionalScatter(row,containerVisuals=new Set()) {
  const tags=row.tags||[];
  return (tags.includes('scatter')||(tags.includes('zone-kit')&&['scenery','cover'].includes(row.role)))
    && row.role!=='resource'&&!row.entity&&!row.nativeSupport&&!row.interactive&&!row.resourceType&&!row.resource&&!containerVisuals.has(row.id)
    && !tags.some(t=>['resource','interactive','quest','quest-required','fixed-placement','npc','enemy','container','storage','clan-storage','base-fixed','siege-objective','site','city-kit','city-plot','city-wall','facility-kit','bridge','canal','water','river'].includes(t));
}
function nativeGroundSupport(p,field,row,position,bounds) {
  if(!rigidScatter.has(row.model))return true;
  const halfX=bounds?.halfX||Number(row.footprint?.x||1)/2;
  const halfZ=bounds?.halfZ||Number(row.footprint?.z||1)/2;
  const centerX=position.x+(bounds?.centerX||0),centerZ=position.z+(bounds?.centerZ||0);
  const level=groundHeight(p,field,position.x,position.z);
  const tolerance=row.model==='asphaltSlab'?.25:.35;
  for(const dx of [-halfX,0,halfX])for(const dz of [-halfZ,0,halfZ])
    if(Math.abs(groundHeight(p,field,centerX+dx,centerZ+dz)-level)>tolerance)return false;
  return true;
}
// Ground is rendered as b-c diagonal triangles with shore-snapped X vertices.
// An optional bush rooted on an almost vertical face would hang from the wall;
// test its actual supporting triangle instead of a smooth-field derivative.
function terrainSlopeAt(p,field,x,z,vertices=new Map()) {
  const segments=p.terrainSegments===256?256:128;
  const stepX=p.width/segments,stepZ=p.depth/segments;
  const nominalX=Math.floor((x+p.width/2)/stepX);
  const iz=Math.floor((z+p.depth/2)/stepZ);
  if(iz<0||iz>=segments)return null;
  const vertex=(ix,iz)=>{
    const key=ix+iz*(segments+1);
    if(vertices.has(key))return vertices.get(key);
    const vz=(iz/segments-.5)*p.depth;
    let vx=(ix/segments-.5)*p.width;
    if(ix>0&&ix<segments) {
      const edges=Math.abs(Math.abs(vz)-p.depth/2)<.0001?p.waterEdges:p.visibleShore;
      let closest=stepX/2;
      for(const edge of edges||[]) {
        if(Math.abs(edge.b.z-edge.a.z)<.000001
          ||vz<Math.min(edge.a.z,edge.b.z)-.0001||vz>Math.max(edge.a.z,edge.b.z)+.0001)continue;
        const bank=edge.a.x+(edge.b.x-edge.a.x)*(vz-edge.a.z)/(edge.b.z-edge.a.z);
        const distance=Math.abs(bank-vx);
        if(distance<closest){closest=distance;vx=bank;}
      }
    }
    const floor=groundHeight(p,field,vx,vz,false);
    const roof=p.railInfrastructure?.length&&!bridgeAt(p,vx,vz)
      ?groundHeight(p,field,vx,vz,true):floor;
    const value={x:vx,z:vz,h:(roof>floor+1?roof:floor)
      -(p.surfacePatches?.length ? .05*p.gain/160 : 0)};
    vertices.set(key,value);return value;
  };
  if(p.surfacePatches?.length)return shoreMesh.sample(p,x,z,vertex)?.slope??null;
  const triangleSlope=(a,b,c)=>{
    const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    if(Math.abs(area)<1e-8)return null;
    const u=((b.x-x)*(c.z-z)-(b.z-z)*(c.x-x))/area;
    const v=((c.x-x)*(a.z-z)-(c.z-z)*(a.x-x))/area;
    const w=1-u-v;
    if(u< -1e-6||v< -1e-6||w< -1e-6)return null;
    const sx=((b.h-a.h)*(c.z-a.z)-(c.h-a.h)*(b.z-a.z))/area;
    const sz=((b.x-a.x)*(c.h-a.h)-(c.x-a.x)*(b.h-a.h))/area;
    return Math.hypot(sx,sz);
  };
  let slope=null;
  for(let offset=-1;offset<=1;offset++) {
    const ix=nominalX+offset;if(ix<0||ix>=segments)continue;
    const a=vertex(ix,iz),b=vertex(ix+1,iz),c=vertex(ix,iz+1),d=vertex(ix+1,iz+1);
    for(const [t1,t2,t3] of [[a,c,b],[b,c,d]]) {
      const found=triangleSlope(t1,t2,t3);
      if(found!==null&&(slope===null||found>slope))slope=found;
    }
  }
  return slope;
}
function placementRadius(row) {
  const size=row.collisionSize || {},foot=row.footprint || {};
  return Math.max(.4,Math.hypot(Number(size.width||foot.x||1),Number(size.depth||foot.z||1))/2);
}
function routeDistance(p,x,z) {
  let distance=Infinity;
  for(const road of p.roads.filter(r=>!r.blocked && r.type!=='pipeline')) {
    const points=road.points?.length?road.points:[road.a,road.b];
    for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(x,z,points[i-1],points[i]).distance-road.halfWidth);
  }
  return distance;
}
function planPlacements(p,field,definition) {
  const changes=[];
  if(p.legacyDam)return changes;
  const terrainVertices=new Map();
  const optionalBushOnWall=(row,position,containerVisuals)=>row.model==='dryBush'
    &&optionalScatter(row,containerVisuals)
    &&terrainSlopeAt(p,field,position.x,position.z,terrainVertices)>dryBushSlopeLimit;
  const visual=visualClearance(p,field,definition);
  const optionalBushInFramework=(row,position,containerVisuals)=>row.model==='dryBush'
    &&row.role==='scenery'&&(row.tags||[]).includes('scatter')
    &&optionalScatter(row,containerVisuals)
    &&visual.frameworkInside(position.x,position.z);
  const visualBlocked=(row,x,z)=>clearanceSubject(row)&&visual.blocked(row,x,z);
  const wetAt=(row,x,z,radius)=>isWaterAt(p,x,z,radius,field)||(clearanceSubject(row)&&visual.wet(row,x,z));
  const occupancy=[];
  const containerVisuals=new Set((definition.containers||[]).map(row=>row.visualObjectId).filter(Boolean));
  const facilityBlockers=(definition.objects||[]).filter(row=>(row.tags||[]).includes('facility-kit'))
    .flatMap(row=>locationObjectBlockers({...row,position:row.surfaceSourcePosition||row.position}));
  for(const row of definition.objects||[]) {
    const position=row.surfacePlacement||row.surfaceSourcePosition||row.position;if(!position || row.role==='terrain' || row.entity)continue;
    const radius=placementRadius(row);
    if(optionalScatter(row,containerVisuals)
      &&(optionalBushOnWall(row,position,containerVisuals)
        ||optionalBushInFramework(row,position,containerVisuals)
        ||!nativeGroundSupport(p,field,row,position,visual.bounds.get(row.id))))continue;
    if(wetAt(row,position.x,position.z,radius) || routeDistance(p,position.x,position.z)<radius+.6 || bridgeAt(p,position.x,position.z)||visualBlocked(row,position.x,position.z))continue;
    occupancy.push(...locationObjectBlockers({...row,position}));
  }
  for(const row of definition.objects || []) {
    if(!row.position || row.role==='terrain')continue;
    const original=row.surfaceSourcePosition || row.position;
    const radius=placementRadius(row),tags=row.tags||[];
    const decorative=optionalScatter(row,containerVisuals);
    const preferred=row.surfacePlacement||original;
    if(decorative&&(optionalBushOnWall(row,preferred,containerVisuals)
      ||optionalBushInFramework(row,preferred,containerVisuals))) {
      changes.push({id:row.id,remove:true});continue;
    }
    let needsRelocation=false;
    if(row.surfacePlacement) {
      const {x,z}=row.surfacePlacement;
      if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Nonfinite authored terrain placement '+p.zoneId+' '+row.id);
      needsRelocation=Math.abs(x)>p.width/2-radius-8||Math.abs(z)>p.depth/2-radius-8
        ||wetAt(row,x,z,radius+1)||routeDistance(p,x,z)<radius+1||bridgeAt(p,x,z)||visualBlocked(row,x,z);
      const h=groundHeight(p,field,x,z),spread=Math.max(...[0,1,2,3].map(j=>Math.abs(groundHeight(p,field,x+radius*Math.cos(j*Math.PI/2),z+radius*Math.sin(j*Math.PI/2))-h)));
      needsRelocation||=spread>Math.max(.6,radius*.3);
      if(!needsRelocation){changes.push({id:row.id,x:round(x),z:round(z)});continue;}
    }
    if(tags.some(t=>['bridge','canal','water','river'].includes(t)))continue;
    if(tags.includes('site') && tags.some(t=>t.startsWith('site-'))) {
      if(isWaterAt(p,original.x,original.z,0,field))throw new Error('Authored site structure has no dry support '+p.zoneId+' '+row.id);
      continue;
    }
    // City plots, service buildings and their fences define the city plan.
    // Roads are routed through their real openings; moving a rental board or
    // a municipal floor to clear a route would corrupt that plan.
    if(row.nativeSupport || tags.some(t=>t==='city-kit'||t==='city-plot'||t==='city-wall'||t==='facility-kit')) {
      if(isWaterAt(p,original.x,original.z,0,field))throw new Error('City structure has no dry support '+p.zoneId+' '+row.id);
      continue;
    }
    const wet=wetAt(row,preferred.x,preferred.z,radius);
    const road=needsRelocation||routeDistance(p,preferred.x,preferred.z)<radius+.6 || bridgeAt(p,preferred.x,preferred.z)
      ||visualBlocked(row,preferred.x,preferred.z)||facilityBlockers.some(blocker=>circleBlockerPenalty(preferred.x,preferred.z,radius+.3,blocker)>1e-6);
    if(decorative && (wet || road)) {changes.push({id:row.id,remove:true});continue;}
    // Optional rigid props need support across their native footprint. A
    // centre anchor alone leaves cars, tyres and crates suspended on a cut.
    if(decorative&&!nativeGroundSupport(p,field,row,preferred,visual.bounds.get(row.id))) {
      changes.push({id:row.id,remove:true});continue;
    }
    if(!wet && !road)continue;
    let best=null;
    for(let distance=4;distance<p.width;distance+=4) {
      const count=Math.max(24,Math.ceil(distance*Math.PI/2));
      for(let i=0;i<count;i++) {
        const x=preferred.x+distance*Math.cos(i*2*Math.PI/count),z=preferred.z+distance*Math.sin(i*2*Math.PI/count);
        if(Math.abs(x)>p.width/2-radius-8 || Math.abs(z)>p.depth/2-radius-8)continue;
        if(wetAt(row,x,z,radius+1) || routeDistance(p,x,z)<radius+1 || bridgeAt(p,x,z)||visualBlocked(row,x,z))continue;
        if(occupancy.some(blocker=>circleBlockerPenalty(x,z,radius+.6,blocker)>1e-6))continue;
        const h=groundHeight(p,field,x,z),spread=Math.max(...[0,1,2,3].map(j=>Math.abs(groundHeight(p,field,x+radius*Math.cos(j*Math.PI/2),z+radius*Math.sin(j*Math.PI/2))-h)));
        if(spread>Math.max(.6,radius*.3))continue;
        best={id:row.id,x:round(x),z:round(z)};break;
      }
      if(best)break;
    }
    if(!best)throw new Error('No dry placement for '+p.zoneId+' '+row.id);
    changes.push(best);
    occupancy.push(...locationObjectBlockers({...row,position:{...original,x:best.x,z:best.z}}));
  }
  return changes;
}
module.exports={planPlacements,placementRadius,routeDistance,nativeGroundSupport,optionalScatter};
