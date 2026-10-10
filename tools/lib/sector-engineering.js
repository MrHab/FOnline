'use strict';
const {mapPoint,groundHeight,waterAt,isWaterAt}=require('../../src/server/sector-surface');
const {nearestDry}=require('./sector-access');
const {crossWaterHeight}=require('./sector-bridge-deck');
const round=n=>Number(n.toFixed(6));
function shareFoundations(profiles) {
  // Only original owners participate; never feed propagated copies back in.
  for(const p of profiles)p.foundations=p.foundations.filter(f=>!f.foreign);
  const pads=profiles.flatMap(p=>p.foundations.map((f,i)=>{f.worldKey ||= p.zoneId+'_'+(f.id||'foundation_'+i);return {worldKey:f.worldKey,owner:p.zoneId,...mapPoint(p,f.x,f.z),halfX:f.halfX/p.width*20,halfY:f.halfZ/p.depth*20,blend:f.blend/p.width*20,dryCutBlend:f.dryCutBlend?f.dryCutBlend/p.width*20:undefined,waterBlend:f.waterBlend?f.waterBlend/p.width*20:undefined,height:p.datum+f.height/p.gain,shape:f.shape,afterHydro:f.afterHydro,afterRoads:f.afterRoads,fillWater:f.fillWater,cutOnly:f.cutOnly,points:f.points?.map(v=>mapPoint(p,v.x,v.z)),levelPoints:f.levelPoints?.map(v=>({...mapPoint(p,v.x,v.z),h:p.datum+v.h/p.gain}))};}));
  for(const p of profiles)for(const f of pads.filter(f=>f.owner!==p.zoneId)) {
    const reach=Math.max(f.blend,f.dryCutBlend||0);
    const bx=f.shape==='ellipse'?reach*f.halfX/Math.min(f.halfX,f.halfY):reach,by=f.shape==='ellipse'?reach*f.halfY/Math.min(f.halfX,f.halfY):reach;
    if(f.x+f.halfX+bx<p.mapMinX||f.x-f.halfX-bx>p.mapMinX+20||f.y+f.halfY+by<p.mapMinY||f.y-f.halfY-by>p.mapMinY+20)continue;
    p.foundations.push({worldKey:f.worldKey,foreign:true,x:(f.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-f.y)/20*p.depth,halfX:f.halfX/20*p.width,halfZ:f.halfY/20*p.depth,blend:f.blend/20*p.width,dryCutBlend:f.dryCutBlend?f.dryCutBlend/20*p.width:undefined,waterBlend:f.waterBlend?f.waterBlend/20*p.width:undefined,height:(f.height-p.datum)*p.gain,shape:f.shape,afterHydro:f.afterHydro,afterRoads:f.afterRoads,fillWater:f.fillWater,cutOnly:f.cutOnly,points:f.points?.map(v=>({x:(v.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-v.y)/20*p.depth})),levelPoints:f.levelPoints?.map(v=>({x:(v.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-v.y)/20*p.depth,h:(v.h-p.datum)*p.gain}))});
  }
  // Overlapping pads must be applied in the same world order on either side
  // of a cut. Owner-first ordering otherwise creates a step at the boundary.
  for(const p of profiles)p.foundations.sort((a,b)=>a.worldKey.localeCompare(b.worldKey));
}
function addFoundations(profiles,field,plan) {
  for(const recipe of plan.foundations) {
    if(recipe.height!==undefined&&!Number.isFinite(recipe.height))throw new Error('Invalid foundation height '+recipe.zone+'/'+recipe.id);
    if(recipe.afterRoads!==undefined&&typeof recipe.afterRoads!=='boolean')throw new Error('Invalid foundation afterRoads '+recipe.zone+'/'+recipe.id);
  }
  for(const recipe of plan.foundations) {
    const p=profiles.find(p=>p.zoneId===recipe.zone);
    const level=waterAt(p,recipe.x,recipe.z).height+recipe.waterClearance;
    const height=recipe.height!==undefined?recipe.height:Math.max(level,groundHeight(p,field,recipe.x,recipe.z));
    p.foundations.push({id:recipe.id,x:recipe.x,z:recipe.z,halfX:recipe.halfX,halfZ:recipe.halfZ,blend:recipe.blend,shape:recipe.shape,height,
      ...(recipe.afterRoads!==undefined?{afterRoads:recipe.afterRoads}:{})});
  }
}
function trueWetWaterHeight(p,x,z,nx,nz,halfWidth,field) {
  let height=-Infinity;
  // Resolve the engineered dry fill across the entire deck, rather than
  // treating the original water mesh underneath a city platform as open water.
  const count=Math.max(2,Math.ceil(halfWidth*2/.05));
  for(let i=0;i<=count;i++) {
    const side=-halfWidth+2*halfWidth*i/count,px=x+nx*side,pz=z+nz*side;
    const water=waterAt(p,px,pz);
    if((water.inside||water.distance<=.00001)
      &&groundHeight(p,field,px,pz,false,water)<water.height+.02*p.gain/160)
      height=Math.max(height,water.height);
  }
  return height;
}
function addCrossings(profiles,field,plan) {
  const byId=new Map(profiles.map(p=>[p.zoneId,p]));
  for(const recipe of plan.crossings) {
    const p=byId.get(recipe.a),q=byId.get(recipe.b);
    if(recipe.dryFillZones!==undefined&&(!Array.isArray(recipe.dryFillZones)
      ||new Set(recipe.dryFillZones).size!==recipe.dryFillZones.length
      ||recipe.dryFillZones.some(id=>id!==p.zoneId&&id!==q.zoneId)))
      throw new Error('Invalid crossing dry fill zones '+recipe.id);
    if(recipe.regradeBoundaryLanding!==undefined&&typeof recipe.regradeBoundaryLanding!=='boolean')
      throw new Error('Invalid crossing regraded landing '+recipe.id);
    if(recipe.regradeBoundaryLanding&&(!recipe.maxGradeByZone
      ||recipe.maxGradeByZone[p.zoneId]===undefined||recipe.maxGradeByZone[q.zoneId]===undefined
      ||recipe.boundaryLandingWorld===undefined))
      throw new Error('Regrade landing needs both explicit grades and a landing '+recipe.id);
    // A crossing joins the two nearest dry banks, rather than the arrival hubs.
    // Hubs may be on distant hilltops: spanning those would suspend an approach
    // above the city and create an impossible descent inside its walls.
    const horizontal=p.mapMinY===q.mapMinY;
    const middle=horizontal?{x:Math.max(p.mapMinX,q.mapMinX),y:p.mapMinY+10}:{x:p.mapMinX+10,y:Math.max(p.mapMinY,q.mapMinY)};
    const localAt=(sector,v)=>({x:(v.x-sector.mapMinX-10)/20*sector.width,z:(sector.mapMinY+10-v.y)/20*sector.depth});
    const bank=sector=>{
      const boundary=localAt(sector,middle),toward={x:boundary.x*.85,z:boundary.z*.85};
      const authored=recipe.bankAnchors?.[sector.zoneId];
      if(authored)return nearestDry(sector,field,authored,3.1);
      return nearestDry(sector,field,toward,3.1)||nearestDry(sector,field,sector.hub,3.1);
    };
    const pa=bank(p),pb=bank(q);if(!pa||!pb)throw new Error('No dry bridge bank '+recipe.id);
    const a=mapPoint(p,pa.x,pa.z),b=mapPoint(q,pb.x,pb.z);
    const distance=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(2,Math.ceil(distance*16));
    const owner=point=>profiles.find(p=>point.x>=p.mapMinX-1e-6&&point.x<=p.mapMinX+20+1e-6&&point.y>=p.mapMinY-1e-6&&point.y<=p.mapMinY+20+1e-6);
    const local=(p,v)=>({x:(v.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-v.y)/20*p.depth});
    const normal={x:-(b.y-a.y)/distance,y:(b.x-a.x)/distance};
    // Reference envelope comes from the same pre-crossing profiles, without previous generated bridges.
    const stations=Array.from({length:n+1},(_,i)=>({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n}));
    const required=(point,actualWet)=>{
      const sector=owner(point);if(!sector)throw new Error('Crossing leaves playable world '+recipe.id);
      const pos=local(sector,point),water=waterAt(sector,pos.x,pos.z),ground=sector.datum+groundHeight(sector,field,pos.x,pos.z)/sector.gain;
      let h=actualWet?ground:(isWaterAt(sector,pos.x,pos.z,3.1,field)?Math.max(ground,sector.datum+(water.height+1)/sector.gain):ground);
      for(const sideSector of [p,q]) {
        const crossPos=local(sideSector,point),width=recipe.halfWidthMap/20*sideSector.width;
        const useDryFill=actualWet&&recipe.maxGradeByZone?.[sideSector.zoneId]!==undefined&&(!recipe.dryFillZones||recipe.dryFillZones.includes(sideSector.zoneId));
        const level=useDryFill
          ?trueWetWaterHeight(sideSector,crossPos.x,crossPos.z,normal.x,-normal.y,width,field)
          :crossWaterHeight(sideSector,crossPos.x,crossPos.z,normal.x,-normal.y,width);
        if(Number.isFinite(level))h=Math.max(h,sideSector.datum+(level+1)/sideSector.gain);
      }
      return {...point,h,ground,zoneId:sector.zoneId};
    };
    const reference=stations.map(v=>required(v,false)),oldGrade=distance/n*.012;
    for(let i=1;i<reference.length;i++)reference[i].h=Math.max(reference[i].h,reference[i-1].h-oldGrade);
    for(let i=reference.length-2;i>=0;i--)reference[i].h=Math.max(reference[i].h,reference[i+1].h-oldGrade);
    let landingAlong=null,landing=0,landingHeight=null;
    if(recipe.boundaryLandingWorld!==undefined) {
      if(!Number.isFinite(recipe.boundaryLandingWorld)||recipe.boundaryLandingWorld<=0)
        throw new Error('Invalid crossing boundary landing '+recipe.id);
      const t=horizontal?(middle.x-a.x)/(b.x-a.x):(middle.y-a.y)/(b.y-a.y);
      if(!(t>0&&t<1))throw new Error('Crossing boundary landing misses shared edge '+recipe.id);
      const station=t*n,j=Math.floor(station),fraction=station-j;
      landingHeight=reference[j].h+(reference[j+1].h-reference[j].h)*fraction;
      landingAlong=t*distance;landing=recipe.boundaryLandingWorld/16;
      for(let i=0;!recipe.regradeBoundaryLanding&&i<reference.length;i++) {
        const cone=landingHeight-.012*Math.max(0,Math.abs(i*distance/n-landingAlong)-landing);
        if((i===0||i===n)&&cone>reference[i].h+1e-12)
          throw new Error('Crossing landing would raise an authored true end '+recipe.id);
        if(i>0&&i<n)reference[i].h=Math.max(reference[i].h,cone);
      }
    }
    // Explicit dry-bank grades can lower only their own sector's deck. Pin
    // the neighbouring envelope and the existing common flat gate landing.
    const samples=recipe.maxGradeByZone?stations.map((point,i)=>{
      const sample=required(point,recipe.maxGradeByZone[owner(point).zoneId]!==undefined&&(!recipe.dryFillZones||recipe.dryFillZones.includes(owner(point).zoneId)));
      if(recipe.maxGradeByZone[sample.zoneId]===undefined)
        sample.h=Math.max(sample.h,reference[i].h);
      if(!recipe.regradeBoundaryLanding&&landingAlong!==null&&Math.abs(i*distance/n-landingAlong)<=landing)
        sample.h=Math.max(sample.h,reference[i].h);
      if(recipe.regradeBoundaryLanding&&(i===0||i===n)&&!recipe.dryFillZones?.includes(sample.zoneId))
        sample.h=Math.max(sample.h,reference[i].h);
      return sample;
    }):reference;
    if(recipe.maxGradeByZone) {
    const grades=samples.slice(1).map((v,i)=>{
      const sector=owner({x:(v.x+samples[i].x)/2,y:(v.y+samples[i].y)/2});
      const maxGrade=recipe.maxGradeByZone?.[sector.zoneId];
      if(maxGrade!==undefined&&(!Number.isFinite(maxGrade)||maxGrade<=0))
        throw new Error('Invalid crossing grade '+recipe.id+'/'+sector.zoneId);
      if(recipe.regradeBoundaryLanding){if(landingAlong===null||recipe.maxGradeByZone[p.zoneId]===undefined||recipe.maxGradeByZone[q.zoneId]===undefined)throw new Error('Regrade landing needs both explicit grades '+recipe.id);const low=i*distance/n,high=(i+1)*distance/n;if(low>=landingAlong-landing-1e-12&&high<=landingAlong+landing+1e-12)return 0;}
      return distance/n*(maxGrade===undefined?.012:maxGrade*sector.width/20/sector.gain);
    });
    for(let i=1;i<samples.length;i++)samples[i].h=Math.max(samples[i].h,samples[i-1].h-grades[i-1]);
    for(let i=samples.length-2;i>=0;i--)samples[i].h=Math.max(samples[i].h,samples[i+1].h-grades[i]);
    }
    if(recipe.regradeBoundaryLanding)for(const i of [0,n])
      if(!recipe.dryFillZones?.includes(samples[i].zoneId)&&samples[i].h>reference[i].h+1e-10)
        throw new Error('Regrade raised far true bank '+recipe.id);
    for(const [sector,end] of [[p,samples[0]],[q,samples.at(-1)]]) {
      const pos=local(sector,end),h=(end.h-sector.datum)*sector.gain;
      const levelPoints=samples.map(v=>({...local(sector,v),h:(v.h-sector.datum)*sector.gain}));
      const blend=recipe.abutmentBlendByZone?.[sector.zoneId]??32;
      if(!Number.isFinite(blend)||blend<=0)throw new Error('Invalid abutment soil blend '+recipe.id+'/'+sector.zoneId);
      sector.foundations.push({id:recipe.id+'_abutment',x:pos.x,z:pos.z,halfX:16,halfZ:16,blend,height:h,shape:'ellipse',afterHydro:true,levelPoints});
    }
    for(const sector of [p,q]) {
      const points=[];
      for(let i=1;i<samples.length;i++) {
        const start=samples[i-1],end=samples[i];let low=0,high=1;
        for(const [axis,min] of [['x',sector.mapMinX],['y',sector.mapMinY]]) {
          const d=end[axis]-start[axis];
          if(Math.abs(d)<1e-9){if(start[axis]<min-1e-6||start[axis]>min+20+1e-6){low=1;high=0;}continue;}
          const u=(min-start[axis])/d,v=(min+20-start[axis])/d;
          low=Math.max(low,Math.min(u,v));high=Math.min(high,Math.max(u,v));
        }
        if(low>high+1e-9)continue;
        for(const t of [low,high]) {
          const world={x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t};
          const pos=local(sector,world),h=(start.h+(end.h-start.h)*t-sector.datum)*sector.gain;
          if(points.length&&Math.hypot(points.at(-1).x-pos.x,points.at(-1).z-pos.z)<1e-5)continue;
          points.push({x:round(pos.x),z:round(pos.z),h:round(h)});
        }
      }
      if(points.length>1) {
        const boundaryEnds=[points[0],points.at(-1)];
        const full=samples.map(v=>{const pos=local(sector,v);return {x:round(pos.x),z:round(pos.z),h:round((v.h-sector.datum)*sector.gain)};});
        sector.bridges.push({id:recipe.id,type:'bridge',style:recipe.style,purpose:recipe.purpose,boundaryEnds,halfWidth:recipe.halfWidthMap/20*sector.width,a:full[0],b:full.at(-1),points:full,height:full[0].h});
      }
    }
  }
  shareFoundations(profiles);
}
function addJunctions(profiles,field,plan) {
  for(const p of profiles) {
    if(p.legacyDam)continue;
    if(plan.gradedZones.includes(p.zoneId))p.foundations.push({id:'arrival_junction',shape:'ellipse',x:p.hub.x,z:p.hub.z,halfX:12,halfZ:12,blend:24,height:groundHeight(p,field,p.hub.x,p.hub.z,true)});
    for(const b of p.bridges.filter(b=>b.id.includes('_access_') || b.id.includes('_maintenance_') || b.id.includes('_bridge_')))for(const end of [b.a,b.b])
      if(Math.abs(end.x)<p.width/2-8 && Math.abs(end.z)<p.depth/2-8)
        p.foundations.push({id:b.id+'_junction_'+(end===b.a?'a':'b'),shape:'ellipse',x:end.x,z:end.z,halfX:Math.max(10,b.halfWidth+5),halfZ:Math.max(10,b.halfWidth+5),blend:24,height:end.h??b.height});
  }
  shareFoundations(profiles);
}
function addGateJunctions(profiles,field,plan) {
  const seen=new Set();
  for(const p of profiles.filter(p=>plan.gradedZones.includes(p.zoneId)))for(const g of p.gates) {
    const pos=g.boundary,map=mapPoint(p,pos.x,pos.z),key=map.x.toFixed(6)+','+map.y.toFixed(6);
    if(seen.has(key))continue;seen.add(key);
    p.foundations.push({id:'gate_junction_'+g.side,x:pos.x,z:pos.z,halfX:12*p.gain/160,halfZ:12*p.gain/160,blend:24*p.gain/160,shape:'ellipse',height:groundHeight(p,field,pos.x,pos.z,true)});
  }
  shareFoundations(profiles);
}
function shareBridgeRoadProtection(profiles,plan) {
  for(const p of profiles)for(const bridge of p.bridges||[])delete bridge.dryRoadProtectionEnvelopes;
  for(const recipe of plan.crossings||[]) {
    if(recipe.shareDryRoadProtection===undefined)continue;
    if(recipe.shareDryRoadProtection!==true)throw new Error('Invalid shared bridge road protection '+recipe.id);
    const owners=[recipe.a,recipe.b].map(id=>profiles.find(p=>p.zoneId===id));
    if(owners.some(p=>!p))throw new Error('Missing shared bridge road owner '+recipe.id);
    // Share the complete physical capsule envelope in map coordinates. A
    // city sector can have a different scale; its .705 m reserve must survive
    // the projection, together with the road width and its fading shoulder.
    const roads=owners.flatMap(p=>(p.roads||[]).filter(r=>!r.blocked&&['track','road'].includes(r.type)).map(r=>({
      id:p.zoneId+'_'+r.id,halfWidth:(r.halfWidth+.705)/p.width*20,
      margin:.705/p.width*20,blend:2*p.gain/160/p.width*20,
      points:(r.points?.length?r.points:[r.a,r.b]).map(v=>mapPoint(p,v.x,v.z))
    }))).sort((a,b)=>a.id.localeCompare(b.id));
    for(const p of owners) {
      const bridge=p.bridges.find(b=>b.id===recipe.id);
      if(!bridge)throw new Error('Missing shared road protection bridge '+p.zoneId+'/'+recipe.id);
      bridge.dryRoadProtectionEnvelopes=roads.map(r=>({id:r.id,halfWidth:r.halfWidth/20*p.width,
        margin:r.margin/20*p.width,blend:r.blend/20*p.width,
        points:r.points.map(v=>({x:(v.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-v.y)/20*p.depth}))}));
    }
  }
}
module.exports={addFoundations,shareFoundations,addCrossings,addJunctions,addGateJunctions,shareBridgeRoadProtection};
