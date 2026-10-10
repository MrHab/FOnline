'use strict';
// Build one connected grade over every local piece of the authored ore line.
// Explicit paths keep diagnostics out of the checked-in world catalog.
const fs=require('node:fs');
const {mapPoint,groundHeight,bridgeAt,waterAt}=require('../src/server/sector-surface');
function buildRailInfrastructure(data) {
for(const p of data.profiles){p.railInfrastructure=[];p.bridges=p.bridges.filter(b=>b.style!=='railViaduct');}
const rail=[];
for(const p of data.profiles)for(const road of p.roads.filter(r=>r.type==='railway')) {
  const number=road.id==='ore_freight_rail_authored'?10:Number(road.id.match(/_(\d+)$/)?.[1]);
  if(!Number.isFinite(number))continue;
  if(number===7&&p.zoneId.endsWith('_09'))continue;
  const raw=road.points?.length?road.points:[road.a,road.b],points=[];
  for(let i=1;i<raw.length;i++) {
    const a=raw[i-1],b=raw[i],run=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(run/2));
    for(let j=i===1?0:1;j<=n;j++) {
      const t=j/n,local={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t},world=mapPoint(p,local.x,local.z);
      const gh=groundHeight(p,data.relief,local.x,local.z,true,null,false);
      const apron=p.zoneId==='z_10_10'&&local.x>=-152&&local.x<=-12&&Math.abs(local.z+106)<=30;
      points.push({zone:p.zoneId,road:road.id,x:world.x,y:world.y,lx:local.x,lz:local.z,
        natural:p.datum+gh/p.gain,bridge:!!bridgeAt(p,local.x,local.z),apron});
    }
  }
  rail.push({number,zone:p.zoneId,points});
}
rail.sort((a,b)=>a.number-b.number||a.points[0].x-b.points[0].x);
const chain=[],gaps=[];
for(const line of rail) {
  if(chain.length) {
    const a=chain.at(-1),b=line.points[0],gap=Math.hypot(b.x-a.x,b.y-a.y);
    if(gap>0.001) {
      gaps.push({from:a.zone,to:b.zone,x:a.x,y:a.y,xx:b.x,yy:b.y,lengthMetres:gap*16,startIndex:chain.length-1});
      const n=Math.ceil(gap/.125);
      for(let i=1;i<n;i++)chain.push({zone:'connector',road:`${a.road}->${b.road}`,x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n,
        natural:a.natural+(b.natural-a.natural)*i/n,bridge:false,apron:false});
    }
  }
  chain.push(...line.points.slice(chain.length&&Math.hypot(line.points[0].x-chain.at(-1).x,line.points[0].y-chain.at(-1).y)<0.001?1:0));
  if(gaps.length&&gaps.at(-1).to===line.zone&&gaps.at(-1).endIndex===undefined)gaps.at(-1).endIndex=chain.length-line.points.length;
}
let length=0;
for(let i=0;i<chain.length;i++) {
  if(i)length+=Math.hypot(chain[i].x-chain[i-1].x,chain[i].y-chain[i-1].y)*16;
  chain[i].metres=length;
}
const speed=.04; // 4 cm vertical per metre of horizontal run.
function feasible(error,output=false) {
  const low=[],high=[];
  for(let i=0;i<chain.length;i++) {
    const p=chain[i],pin=p.bridge;
    let lo=p.natural-(pin?0:(p.apron?0.15:error))/160;
    let hi=p.natural+((pin||p.apron)?0.15:error)/160;
    if(i){const reach=speed*(p.metres-chain[i-1].metres)/160;lo=Math.max(lo,low[i-1]-reach);hi=Math.min(hi,high[i-1]+reach);}
    if(lo>hi+1e-10){if(output)console.error('infeasible',i,p.zone,p.road,p.x,p.y,p.metres,p.natural,p.bridge,'interval',lo,hi,'previous',chain[i-1]);return null;}
    low.push(lo);high.push(hi);
  }
  if(!output)return true;
  const target=Array(chain.length);target[chain.length-1]=Math.max(low.at(-1),Math.min(high.at(-1),chain.at(-1).natural));
  for(let i=chain.length-2;i>=0;i--) {
    const reach=speed*(chain[i+1].metres-chain[i].metres)/160;
    const lo=Math.max(low[i],target[i+1]-reach),hi=Math.min(high[i],target[i+1]+reach);
    target[i]=Math.max(lo,Math.min(hi,chain[i].natural));
  }
  return target;
}
let lo=0,hi=200;
for(let i=0;i<42;i++){const mid=(lo+hi)/2;if(feasible(mid))hi=mid;else lo=mid;}
const target=feasible(hi+1e-7,true);
if(!target)throw Error('Even the pinned bridge violates 4%');
for(let i=0;i<chain.length;i++) {
  chain[i].railHeight=target[i];
  chain[i].differenceMetres=(target[i]-chain[i].natural)*160;
  if(i)chain[i].grade=(target[i]-target[i-1])*160/(chain[i].metres-chain[i-1].metres);
}
let maxGrade=0,maxFill={value:-Infinity},maxCut={value:-Infinity};
const classes={atGrade:0,cut:0,tunnel:0,fill:0,viaduct:0};
for(let i=1;i<chain.length;i++){
  const p=chain[i],d=p.differenceMetres,run=p.metres-chain[i-1].metres;
  maxGrade=Math.max(maxGrade,Math.abs(p.grade));
  if(d>maxFill.value)maxFill={value:d,...p};
  if(-d>maxCut.value)maxCut={value:-d,...p};
  classes[d>8?'viaduct':d>1?'fill':d< -8?'tunnel':d< -1?'cut':'atGrade']+=run;
}
const perRail=[];
for(const line of rail) {
  const pts=chain.filter(v=>v.zone===line.zone&&v.road===line.points[0].road);
  if(!pts.length)continue;
  const diffs=pts.map(v=>v.differenceMetres);
  perRail.push({zone:line.zone,id:line.points[0].road,start:[pts[0].x,pts[0].y],end:[pts.at(-1).x,pts.at(-1).y],
    maxFill:Math.max(...diffs),maxCut:-Math.min(...diffs),targetStart:pts[0].railHeight,targetEnd:pts.at(-1).railHeight});
}
const report={samples:chain.length,lengthMetres:length,minimaxErrorMetres:hi,maxGrade,maxFill,maxCut,classes,gaps,perRail,
  bridgePins:chain.filter(v=>v.bridge).length,apronPins:chain.filter(v=>v.apron).length,chain};
const kindAt=d=>d>8?'viaduct':d>1?'fill':d< -8?'tunnel':d< -1?'cut':'atGrade';
const globalSpans=[];
for(let i=0;i<chain.length;i++) {
  const p=chain[i],kind=kindAt(p.differenceMetres);
  if(!globalSpans.length||globalSpans.at(-1).kind!==kind)globalSpans.push({id:`ore_span_${globalSpans.length}`,kind,startIndex:i,endIndex:i});
  else globalSpans.at(-1).endIndex=i;
  p.kind=kind;p.spanId=globalSpans.at(-1).id;
}
for(const span of globalSpans){
  const first=chain[span.startIndex],last=chain[span.endIndex];
  span.start={x:first.x,y:first.y,metres:first.metres};span.end={x:last.x,y:last.y,metres:last.metres};
  span.portalStart=span.kind==='tunnel'&&span.startIndex>0;
  span.portalEnd=span.kind==='tunnel'&&span.endIndex<chain.length-1;
  span.openBoundaryStart=span.kind==='tunnel'&&span.startIndex===0;
  span.openBoundaryEnd=span.kind==='tunnel'&&span.endIndex===chain.length-1;
  span.serviceStart=span.kind==='viaduct';
  span.serviceEnd=span.kind==='viaduct';
}
const nearestRail=(x,y)=>{
  let best={distance:Infinity};
  for(let i=1;i<chain.length;i++) {
    const a=chain[i-1],b=chain[i],dx=b.x-a.x,dy=b.y-a.y,run=dx*dx+dy*dy;
    const t=run?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/run)):0;
    const distance=Math.hypot(x-(a.x+dx*t),y-(a.y+dy*t));
    if(distance<best.distance)best={distance,index:i,t,height:a.railHeight+(b.railHeight-a.railHeight)*t,metres:a.metres+(b.metres-a.metres)*t};
  }
  return best;
};
const byZone={};
for(const p of data.profiles)for(const road of p.roads.filter(r=>r.type==='railway')) {
  if(road.id==='ore_freight_rail_7'&&p.zoneId.endsWith('_09'))continue;
  const raw=road.points?.length?road.points:[road.a,road.b],points=[];
  for(let i=1;i<raw.length;i++) {
    const a=raw[i-1],b=raw[i],run=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.ceil(run/2));
    for(let j=i===1?0:1;j<=n;j++) {
      const t=j/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,world=mapPoint(p,x,z);
      const nearest=nearestRail(world.x,world.y);
      if(nearest.distance>.02)throw Error('Rail route does not align with solved profile '+p.zoneId+' '+road.id+' '+nearest.distance);
      const natural=groundHeight(p,data.relief,x,z,true,null,false),h=(nearest.height-p.datum)*p.gain;
      const difference=h-natural,kind=kindAt(difference),water=waterAt(p,x,z);
      if(kind==='tunnel'&&water.inside&&h<water.height)
        throw new Error('Rail tunnel needs a sealed hydraulic bore '+p.zoneId+' '+road.id+' '+x+','+z);
      points.push({x,z,h,surfaceH:natural,kind,spanId:chain[nearest.index].spanId,
        worldX:world.x,worldY:world.y,worldHeight:nearest.height,alongMetres:nearest.metres,differenceMetres:difference});
    }
  }
  const spans=[];
  for(let i=0;i<points.length;i++) {
    const point=points[i];
    if(!spans.length||spans.at(-1).kind!==point.kind||spans.at(-1).globalId!==point.spanId)
      spans.push({id:`${p.zoneId}_${road.id}_span_${spans.length}`,globalId:point.spanId,kind:point.kind,fromIndex:i,toIndex:i});
    else spans.at(-1).toIndex=i;
  }
  for(const span of spans) {
    const global=globalSpans.find(v=>v.id===span.globalId);
    span.portalStart=!!global.portalStart&&Math.abs(points[span.fromIndex].alongMetres-global.start.metres)<2.1;
    span.portalEnd=!!global.portalEnd&&Math.abs(points[span.toIndex].alongMetres-global.end.metres)<2.1;
    span.serviceStart=!!global.serviceStart&&Math.abs(points[span.fromIndex].alongMetres-global.start.metres)<2.1;
    span.serviceEnd=!!global.serviceEnd&&Math.abs(points[span.toIndex].alongMetres-global.end.metres)<2.1;
  }
  (byZone[p.zoneId] ||= []).push({id:`${p.zoneId}_${road.id}`,sourceRoadId:road.id,halfWidth:2.5,
    tunnelClearanceHeight:4.5,viaductSupportSpacing:12,points,spans});
}
for(let g=0;g<gaps.length;g++) {
  const gap=gaps[g],part=chain.slice(gap.startIndex,gap.endIndex+1);
  for(const zoneId of [gap.from,gap.to]) {
    const p=data.profiles.find(v=>v.zoneId===zoneId),points=part.map(v=>{
      const x=(v.x-p.mapMinX-10)/20*p.width,z=(p.mapMinY+10-v.y)/20*p.depth;
      const surfaceH=groundHeight(p,data.relief,x,z,true,null,false),h=(v.railHeight-p.datum)*p.gain,kind=kindAt(h-surfaceH),water=waterAt(p,x,z);
      if(kind==='tunnel'&&water.inside&&h<water.height)
        throw new Error('Rail connector tunnel needs a sealed hydraulic bore '+zoneId+' '+g+' '+x+','+z);
      return {x,z,h,surfaceH,kind,spanId:v.spanId,worldX:v.x,worldY:v.y,
        worldHeight:v.railHeight,alongMetres:v.metres,differenceMetres:h-surfaceH};
    });
    (byZone[zoneId] ||= []).push({id:`${zoneId}_ore_connector_${g}`,sourceRoadId:`ore_connector_${g}`,halfWidth:2.5,
      tunnelClearanceHeight:4.5,viaductSupportSpacing:12,points,spans:[]});
  }
}
// The earthwork influences terrain for several metres beyond a zone edge.
// Give both sectors the same world-space strip, including a predecessor road
// that terminates just outside the neighbour. This preserves floor seams and
// gives each locally clipped Unity mesh the same geometry at its boundary.
const shared=[];
const connectorIds=new Set();
for(const routes of Object.values(byZone))for(const route of routes) {
  if(route.sourceRoadId.startsWith('ore_connector_')) {
    if(connectorIds.has(route.sourceRoadId))continue;
    connectorIds.add(route.sourceRoadId);
  }
  shared.push(route);
}
for(const p of data.profiles) {
  const routes=byZone[p.zoneId] ||= [],present=new Set(routes.map(v=>v.id));
  for(const route of shared) {
    if(present.has(route.id))continue;
    const margin=(route.halfWidth+8)*p.mapSpan/p.width;
    const xs=route.points.map(v=>v.worldX),ys=route.points.map(v=>v.worldY);
    if(Math.max(...xs)+margin<p.mapMinX || Math.min(...xs)-margin>p.mapMinX+p.mapSpan ||
       Math.max(...ys)+margin<p.mapMinY || Math.min(...ys)-margin>p.mapMinY+p.mapSpan)continue;
    const points=route.points.map(v=>{
      const x=(v.worldX-p.mapMinX-p.mapSpan/2)/p.mapSpan*p.width;
      const z=(p.mapMinY+p.mapSpan/2-v.worldY)/p.mapSpan*p.depth;
      const h=(v.worldHeight-p.datum)*p.gain;
      return {x,z,h,surfaceH:groundHeight(p,data.relief,x,z,true,null,false),kind:v.kind,spanId:v.spanId,
        worldX:v.worldX,worldY:v.worldY,worldHeight:v.worldHeight,alongMetres:v.alongMetres,differenceMetres:h-v.surfaceH};
    });
    routes.push({...route,id:route.id,points,foreign:true});present.add(route.id);
  }
}
// A 128-cell terrain triangle reaches beyond a narrow ballast bed. Keep a
// level formation under the entire actor capsule and its neighbouring grid
// triangle, while the gauge, ballast and native tunnel lining keep their
// authored widths. The last ore segment crosses from a 320 m sector into a
// 160 m sector; taper only this soil cut over the final 30 m of the coarse
// sector so the two excavations meet in world coordinates.
for(const p of data.profiles)for(const route of byZone[p.zoneId]||[])for(const point of route.points) {
  const tunnel=point.kind==='tunnel';
  const coreHalfWidth=Math.max(4,p.width/128*2.4);
  let worldHalfWidth=coreHalfWidth*p.mapSpan/p.width;
  let worldBlend=(tunnel?2:8)*p.mapSpan/p.width;
  if(route.sourceRoadId==='ore_freight_rail_14' &&
     (p.zoneId==='z_14_10'||p.zoneId==='z_15_10')) {
    const t=Math.max(0,Math.min(1,(point.worldX-(300-30/16))/(30/16)));
    worldHalfWidth=(6+2*t)/16;
    worldBlend=(tunnel?2:8)*(1+t)/16;
  }
  point.earthworkHalfWidth=worldHalfWidth*p.width/p.mapSpan;
  point.earthworkBlend=worldBlend*p.width/p.mapSpan;
}
const infrastructure={schema:'roa.railInfrastructure.v1',maxGrade:.04,globalSpans,zones:byZone,gaps};
report.globalSpans=globalSpans;
for(const p of data.profiles)p.railInfrastructure=byZone[p.zoneId]||[];
return {catalog:data,report,infrastructure};
}
if(require.main===module) {
  const input=process.env.ROA_SURFACE_INPUT,output=process.env.ROA_SURFACE_OUTPUT;
  if(!input||!output||input===output)throw new Error('Set distinct ROA_SURFACE_INPUT and ROA_SURFACE_OUTPUT paths');
  const data=JSON.parse(fs.readFileSync(input,'utf8'));
  const {report,infrastructure}=buildRailInfrastructure(data);
  delete data.sourceHash;
  fs.writeFileSync(output,JSON.stringify(data)+'\n');
  if(process.env.ROA_RAIL_REPORT)fs.writeFileSync(process.env.ROA_RAIL_REPORT,JSON.stringify({
    schema:infrastructure.schema,maxGrade:.04,globalSpans:infrastructure.globalSpans,gaps:infrastructure.gaps,
    samples:report.samples,lengthMetres:report.lengthMetres,minimaxErrorMetres:report.minimaxErrorMetres,
    maxFill:report.maxFill,maxCut:report.maxCut,classes:report.classes,bridgePins:report.bridgePins,apronPins:report.apronPins,perRail:report.perRail
  },null,2)+'\n');
  console.log(JSON.stringify({output,samples:report.samples,lengthMetres:report.lengthMetres,maxGrade:report.maxGrade,
    minimaxErrorMetres:report.minimaxErrorMetres,spans:infrastructure.globalSpans.length,gaps:infrastructure.gaps.length}));
}
module.exports={buildRailInfrastructure};
