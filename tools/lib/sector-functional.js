'use strict';
const {groundHeight,isWaterAt}=require('../../src/server/sector-surface');
const {routeOnLand}=require('./sector-access');
const {attachObstacles,blockedAt}=require('./sector-obstacles');
function planFunctional(p,field,definition,{interactionPaths}={}) {
  if(p.legacyDam)return [];
  const moves=new Map((p.placements||[]).filter(v=>!v.remove).map(v=>[v.id,v]));
  const removed=new Set((p.placements||[]).filter(v=>v.remove).map(v=>v.id));
  const effective=(definition.objects||[]).filter(v=>!removed.has(v.id)).map(row=>{
    const source=row.surfaceSourcePosition||row.position,change=moves.get(row.id);
    const result={...row,position:change?{...source,x:change.x,z:change.z}:source};delete result.surfaceSourcePosition;return result;
  });
  // All route searches use the future saved placements, including relocated
  // obstacles; a source prop in the river cannot block an authored interaction.
  attachObstacles(p,{objects:effective},field,{includeScatter:true,prepared:true});
  const objectById=new Map(effective.map(row=>[row.id,row]));
  const rows=[...(definition.containers||[]).map(row=>({kind:'container',row})),
    ...(definition.transitions||[]).filter(row=>row.type==='location').map(row=>({kind:'transition',row})),
    ...(definition.anomalyFields||[]).map(row=>({kind:'anomaly',row})),
    ...['lairs','eventAnchors','spawnAreas'].flatMap(kind=>(definition.zone?.[kind]||[]).map(row=>({kind,row})))];
  const routeCache=new Map();
  // An editor diagnostic can replay the already solved paths in real physics.
  // The optional collector stays outside the authored surface catalogue.
  const pathCache=interactionPaths?new Map():null;
  const pointKey=point=>point.x.toFixed(3)+','+point.z.toFixed(3);
  const surfaceCache={actorWalk:true};
  const accessible=point=>{
    const key=pointKey(point);
    if(!routeCache.has(key)) {
      const route=!isWaterAt(p,point.x,point.z,.48,field)&&!blockedAt(p,point.x,point.z,.48)&&routeOnLand(p,field,p.hub,point,.48,.9,surfaceCache);
      routeCache.set(key,!!route);
      if(pathCache&&route)pathCache.set(key,route);
    }
    return routeCache.get(key);
  };
  const record=(kind,id,approach,target,radius)=>{
    if(!interactionPaths)return;
    const points=pathCache.get(pointKey(approach));
    if(!points)throw new Error('Missing diagnostic approach route '+p.zoneId+' '+id);
    interactionPaths.push({zone:p.zoneId,locationId:p.locationId,kind,id,approach,target,radius,points});
  };
  const result=[];
  p.interactionApproaches=[];
  for(const row of effective.filter(r=>r.resourceType||r.resource||r.interactive||r.entity?.kind==='npc')) {
    const target=row.position;
    const radius=row.resourceType||row.resource?3.2:1.5;
    let approach=null;
    for(const distance of [0,.8,1.2,1.4,1.8,2.2,2.8,3.1].filter(d=>d<=radius)) {
      for(let i=0;i<16&&!approach;i++) {
        const point={x:target.x+distance*Math.cos(i*Math.PI/8),z:target.z+distance*Math.sin(i*Math.PI/8)};
        if(accessible(point))approach=point;
      }
      if(approach)break;
    }
    if(!approach)throw new Error('Authored interaction is unreachable '+p.zoneId+' '+row.id);
    p.interactionApproaches.push({id:row.id,x:Number(approach.x.toFixed(5)),z:Number(approach.z.toFixed(5)),target,radius});
    record('interaction',row.id,approach,target,radius);
  }
  for(const {kind,row} of rows) {
    const visual=kind==='container'&&objectById.get(row.visualObjectId);
    const source=row.surfaceSourcePoint||{x:Number(row.x??((row.tx-p.width/4+.5)*2)),z:Number(row.z??((row.tz-p.depth/4+.5)*2))};
    const facility=kind==='transition'&&(definition.facilities||[]).find(f=>f.transitionId===row.id);
    const original=facility?.entrance||row.surfacePlacement||visual?.position||source;
    const radius=kind==='anomaly'?Math.max(.5,Number(row.radius||1)):kind==='container'?.6:1.8;
    let anchorApproach=null;
    const canReach=point=>{
      anchorApproach=null;
      if(isWaterAt(p,point.x,point.z,radius,field))return false;
      if(kind!=='container') {if(!accessible(point))return false;anchorApproach=point;return true;}
      return [0,1,2,3,4,5,6,7].some(i=>{
        const approach={x:point.x+1.8*Math.cos(i*Math.PI/4),z:point.z+1.8*Math.sin(i*Math.PI/4)};
        if(!accessible(approach))return false;anchorApproach=approach;return true;
      });
    };
    let point=canReach(original)?original:null;
    if(!point && facility)throw new Error('Authored facility entrance is inaccessible '+p.zoneId+' '+facility.id);
    if(!point && visual)throw new Error('Authored container visual is inaccessible '+p.zoneId+' '+row.id);
    if(!point)for(let ring=4;ring<p.width && !point;ring+=4) {
      const count=Math.max(16,Math.ceil(ring*Math.PI/2));
      for(let i=0;i<count;i++) {
        const candidate={x:source.x+ring*Math.cos(i*2*Math.PI/count),z:source.z+ring*Math.sin(i*2*Math.PI/count)};
        if(Math.abs(candidate.x)>p.width/2-10-radius || Math.abs(candidate.z)>p.depth/2-10-radius)continue;
        if(canReach(candidate)){point=candidate;break;}
      }
    }
    if(!point)throw new Error('No reachable functional anchor '+p.zoneId+' '+kind+' '+row.id);
    record(kind,row.id,anchorApproach,point,kind==='container'?2:.75);
    result.push({kind,id:row.id,source,x:Number(point.x.toFixed(5)),z:Number(point.z.toFixed(5)),y:Number((groundHeight(p,field,point.x,point.z,true)+.1).toFixed(5))});
  }
  return result;
}
module.exports={planFunctional};
