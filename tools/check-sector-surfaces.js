'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mapPoint, rawHeight, groundHeight, waterAt, bridgeAt, bridgeHeight, isWaterAt: geometryWaterAt, crossesWater: geometryCrossesWater } = require('../src/server/sector-surface');
const {crossWaterHeight}=require('./lib/sector-bridge-deck');
const root=path.resolve(__dirname,'..');
const graph=require('../data/kromka/zone-graph.json');
const data=JSON.parse(fs.readFileSync(process.env.ROA_SURFACE_INPUT || path.join(root,'data/kromka/sector-surfaces.json'),'utf8'));
const isWaterAt=(p,x,z,r=0)=>geometryWaterAt(p,x,z,r,data.relief);
const crossesWater=(p,ax,az,bx,bz,r=0)=>geometryCrossesWater(p,ax,az,bx,bz,r,data.relief);
const profiles=new Map(data.profiles.map(p=>[p.zoneId,p]));
assert.equal(profiles.size,graph.zones.length);
const seen=new Set(),defects=[];
let edges=0,maxRaw=0,maxFinal=0,waterDifferences=0,clearanceCutSamples=0;
for(const zone of graph.zones) {
  const p=profiles.get(zone.id);
  assert.equal(p.locationId,zone.city||zone.id);
  assert.equal(p.mapMinX,zone.col*20);
  assert.equal(p.mapMinY,zone.row*20);
  assert.equal(p.width,p.depth);
  for(const i of p.waterIndices)assert(i>=0&&i<p.waterVertices.length);
  for(const [side,edge] of Object.entries(zone.edges)) {
    if(!edge.open)continue;
    const pair=[p.zoneId,edge.to].sort().join('|');
    if(seen.has(pair))continue;
    seen.add(pair);edges++;
    const q=profiles.get(edge.to);
    let worst=0,wet=0;
    for(let i=0;i<=320;i++) {
      const u=i/320,along=(u-.5)*p.width;
      const x=side==='west'?-p.width/2:side==='east'?p.width/2:along;
      const z=side==='north'?p.depth/2:side==='south'?-p.depth/2:along;
      const point=mapPoint(p,x,z),qx=(point.x-q.mapMinX-10)/20*q.width,qz=(q.mapMinY+10-point.y)/20*q.depth;
      const rawA=p.datum+rawHeight(p,data.relief,x,z)/p.gain,rawB=q.datum+rawHeight(q,data.relief,qx,qz)/q.gain;
      maxRaw=Math.max(maxRaw,Math.abs(rawA-rawB));
      const a=p.datum+groundHeight(p,data.relief,x,z)/p.gain,b=q.datum+groundHeight(q,data.relief,qx,qz)/q.gain;
      worst=Math.max(worst,Math.abs(a-b));
      if(isWaterAt(p,x,z)!==isWaterAt(q,qx,qz))wet++;
    }
    maxFinal=Math.max(maxFinal,worst);waterDifferences+=wet;
    if(worst>0.001||wet)defects.push({kind:'seam',pair,worldHeightDelta:worst,wetSamples:wet});
  }
  for(const bridge of p.bridges) {
    const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
    if(!p.legacyDam&&bridge.style!=='railViaduct'){
      let minimumClearance=Infinity;
      for(let j=1;j<points.length;j++){
        const a=points[j-1],b=points[j],length=Math.hypot(b.x-a.x,b.z-a.z);
        if(length<1e-6)continue;
        const nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length,count=Math.ceil(length/.25);
        for(let k=0;k<=count;k++){
          const t=k/count,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
          const level=crossWaterHeight(p,x,z,nx,nz,bridge.halfWidth);
          if(!Number.isFinite(level))continue;
          minimumClearance=Math.min(minimumClearance,bridgeHeight(bridge,x,z)-level);
        }
      }
      if(minimumClearance<.02)defects.push({kind:'submergedBridgeDeck',zone:p.zoneId,id:bridge.id,minimumClearance});
    }
    if(points.some((point,i)=>i&&crossesWater(p,points[i-1].x,points[i-1].z,point.x,point.z,.48)))defects.push({kind:'blockedBridge',zone:p.zoneId,id:bridge.id});
    const ends=[bridge.a,bridge.b].filter(e=>Math.abs(e.x)<p.width/2-1e-4&&Math.abs(e.z)<p.depth/2-1e-4);
    const gap=Math.max(0,...ends.map(e=>{
      const other=p.bridges.filter(b=>b!==bridge&&bridgeAt({bridges:[b]},e.x,e.z));
      return Math.min(Math.abs(groundHeight(p,data.relief,e.x,e.z)-bridgeHeight(bridge,e.x,e.z)),...other.map(b=>Math.abs(bridgeHeight(b,e.x,e.z)-bridgeHeight(bridge,e.x,e.z))));
    }));
    if(gap>.3)defects.push({kind:'bridgeApproach',zone:p.zoneId,id:bridge.id,gap});
  }
  for(const road of p.roads.filter(r=>r.type!=='pipeline')) {
    if(road.blocked){defects.push({kind:'unbuiltRoad',zone:p.zoneId,id:road.id});continue;}
    const points=road.points?.length?road.points:[road.a,road.b];
    if(road.engineeredStation) {
      const corridor=p.corridors.find(c=>c.id===p.zoneId+'_'+road.id);
      if(!corridor || points.length!==corridor.points.length
        || points.some((v,i)=>Math.hypot(v.x-corridor.points[i].x,v.z-corridor.points[i].z)>1e-7))
        defects.push({kind:'roadEarthworkMismatch',zone:p.zoneId,id:road.id});
    }
    if(points.some((point,i)=>i&&crossesWater(p,points[i-1].x,points[i-1].z,point.x,point.z,.48)))defects.push({kind:'blockedRoad',zone:p.zoneId,id:road.id});
    if(road.type==='track') {
      let worst=0;
      for(let j=1;j<points.length;j++) {
        const a=points[j-1],b=points[j],length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(length/.5));
        if(length<1e-5)continue;
        const sx=-(b.z-a.z)/length,sz=(b.x-a.x)/length;
        for(const offset of [-1.25,0,1.25]) {
          let previous=groundHeight(p,data.relief,a.x+sx*offset,a.z+sz*offset,true);
          for(let k=1;k<=steps;k++) {
            const next=groundHeight(p,data.relief,a.x+(b.x-a.x)*k/steps+sx*offset,a.z+(b.z-a.z)*k/steps+sz*offset,true);
            worst=Math.max(worst,Math.abs(next-previous)/(length/steps));previous=next;
          }
        }
      }
      const limit=p.corridors?.some(c=>c.id===p.zoneId+'_'+road.id)?.55:.9;
      if(worst>limit+.02)defects.push({kind:'roadGrade',zone:p.zoneId,id:road.id,grade:worst,limit});
    }
  }
  for(const cut of p.foundations.filter(f=>f.cutOnly)) {
    const before={...p,foundations:p.foundations.filter(f=>f!==cut)};
    for(let z=Math.max(-p.depth/2,cut.z-cut.halfZ-cut.blend);z<=Math.min(p.depth/2,cut.z+cut.halfZ+cut.blend);z++)
      for(let x=Math.max(-p.width/2,cut.x-cut.halfX-cut.blend);x<=Math.min(p.width/2,cut.x+cut.halfX+cut.blend);x++) {
        const original=groundHeight(before,data.relief,x,z),actual=groundHeight(p,data.relief,x,z),water=waterAt(p,x,z);
        assert(actual<=original+1e-7,p.zoneId+'/'+cut.id+' clearance cut raises the ground');
        if(water.inside&&original<water.height-.05)
          assert(Math.abs(actual-original)<1e-7,p.zoneId+'/'+cut.id+' clearance cut alters the open river bed');
        clearanceCutSamples++;
      }
  }
}
for(const binding of data.gateBindings)if(binding.requiresCrossing)defects.push({kind:'wetTransition',...binding});
const report={schema:'roa.sectorSurfaceAudit.v1',profiles:profiles.size,edges,maxRaw,maxFinal,waterDifferences,clearanceCutSamples,defects};
const output=process.env.ROA_SURFACE_AUDIT;
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,defects:undefined,defectCounts: Object.fromEntries([...new Set(defects.map(d=>d.kind))].map(kind=>[kind,defects.filter(d=>d.kind===kind).length]))}));
assert.equal(defects.length,0,'Sector surface geometry needs correction. See ROA_SURFACE_AUDIT report.');
