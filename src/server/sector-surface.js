'use strict';

// Geometry shared by authoring, navigation checks and authoritative movement.
// Profiles are immutable authored data, never samples of a modified map preview.
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return { distance: Math.hypot(x - a.x - dx * t, z - a.z - dz * t), t };
}
function sampleField(field, x, y) {
  const u = clamp(x / field.width, 0, 1) * (field.samplesX - 1);
  const v = clamp(y / field.depth, 0, 1) * (field.samplesY - 1);
  const ix = Math.min(Math.floor(u), field.samplesX - 2), iy = Math.min(Math.floor(v), field.samplesY - 2);
  const f = u - ix, g = v - iy, h = field.heights, row = iy * field.samplesX + ix;
  return (h[row] * (1 - f) + h[row + 1] * f) * (1 - g)
    + (h[row + field.samplesX] * (1 - f) + h[row + field.samplesX + 1] * f) * g;
}
function mapPoint(profile, x, z) {
  return { x: profile.mapMinX + (x / profile.width + 0.5) * profile.mapSpan,
    y: profile.mapMinY + (0.5 - z / profile.depth) * profile.mapSpan };
}
function sourcePoint(x,y) {
  const distance=Math.hypot(Math.max(200-x,0,x-220),Math.max(200-y,0,y-220));
  return {x:x-4.2*(1-smooth(0,10,distance)),y};
}
function rawHeight(profile, field, x, z) {
  const mapped = mapPoint(profile, x, z), p=sourcePoint(mapped.x,mapped.y);
  return (sampleField(field, p.x, p.y) - profile.datum) * profile.gain;
}
const waterIndexes=new WeakMap();
const railIndexes=new WeakMap();
function railIndex(profile) {
  let index=railIndexes.get(profile);
  if(index?.source===profile.railInfrastructure)return index;
  const size=16,cells=new Map();
  for(const route of profile.railInfrastructure||[])for(let i=1;i<(route.points?.length||0);i++) {
    const a=route.points[i-1],b=route.points[i],margin=Math.max(route.halfWidth+8,
      (a.earthworkHalfWidth??route.halfWidth)+(a.earthworkBlend??(a.kind==='tunnel'?2:8)),
      (b.earthworkHalfWidth??route.halfWidth)+(b.earthworkBlend??(b.kind==='tunnel'?2:8)));
    for(let ix=Math.floor((Math.min(a.x,b.x)-margin)/size);ix<=Math.floor((Math.max(a.x,b.x)+margin)/size);ix++)
      for(let iz=Math.floor((Math.min(a.z,b.z)-margin)/size);iz<=Math.floor((Math.max(a.z,b.z)+margin)/size);iz++) {
        const key=ix+','+iz;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({route,a,b});
      }
  }
  index={source:profile.railInfrastructure,size,cells};railIndexes.set(profile,index);return index;
}
function railAt(profile,x,z) {
  if(!profile.railInfrastructure?.length)return null;
  const index=railIndex(profile),key=Math.floor(x/index.size)+','+Math.floor(z/index.size);
  let nearest=null;
  for(const item of index.cells.get(key)||[]) {
    const sample=segmentDistance(x,z,item.a,item.b);
    const earthworkHalfWidth=(item.a.earthworkHalfWidth??item.route.halfWidth)
      +((item.b.earthworkHalfWidth??item.route.halfWidth)-(item.a.earthworkHalfWidth??item.route.halfWidth))*sample.t;
    const earthworkBlend=(item.a.earthworkBlend??(item.a.kind==='tunnel'?2:8))
      +((item.b.earthworkBlend??(item.b.kind==='tunnel'?2:8))-(item.a.earthworkBlend??(item.a.kind==='tunnel'?2:8)))*sample.t;
    if(sample.distance>Math.max(item.route.halfWidth+8,earthworkHalfWidth+earthworkBlend) || nearest&&sample.distance>=nearest.distance)continue;
    const t=sample.t;
    nearest={distance:sample.distance,halfWidth:item.route.halfWidth,earthworkHalfWidth,earthworkBlend,
      h:item.a.h+(item.b.h-item.a.h)*t,
      surfaceH:item.a.surfaceH+(item.b.surfaceH-item.a.surfaceH)*t,
      kind:t<.5?item.a.kind:item.b.kind};
  }
  return nearest;
}
function waterIndex(profile) {
  let index=waterIndexes.get(profile);
  if(index && index.vertices===profile.waterVertices && index.edgesSource===profile.waterEdges)return index;
  const edges=new Map(),triangles=new Map(),size=16;
  const add=(table,row,minX,maxX,minZ,maxZ)=>{
    for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++)for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++) {
      const key=x+','+z;if(!table.has(key))table.set(key,[]);table.get(key).push(row);
    }
  };
  const wide=(profile.hydroCuts||[]).some(c=>c.maxX+c.blend>=profile.mapMinX && c.minX-c.blend<=profile.mapMinX+profile.mapSpan && c.maxY+c.blend>=profile.mapMinY && c.minY-c.blend<=profile.mapMinY+profile.mapSpan);
  const margin=(wide?128:32)*profile.gain/160+1;
  for(const e of profile.waterEdges||[])add(edges,e,Math.min(e.a.x,e.b.x)-margin,Math.max(e.a.x,e.b.x)+margin,Math.min(e.a.z,e.b.z)-margin,Math.max(e.a.z,e.b.z)+margin);
  const v=profile.waterVertices||[],ids=profile.waterIndices||[];
  for(let i=0;i<ids.length;i+=3){const row=[v[ids[i]],v[ids[i+1]],v[ids[i+2]]];add(triangles,row,Math.min(...row.map(p=>p.x))-1e-5,Math.max(...row.map(p=>p.x))+1e-5,Math.min(...row.map(p=>p.z))-1e-5,Math.max(...row.map(p=>p.z))+1e-5);}
  index={edges,triangles,size,vertices:profile.waterVertices,edgesSource:profile.waterEdges};waterIndexes.set(profile,index);return index;
}
function waterAt(profile, x, z) {
  const index=waterIndex(profile),key=Math.floor(x/index.size)+','+Math.floor(z/index.size);
  let nearest = Infinity, height = 0, inside = false, bankX=x,bankZ=z,bankHeight=0;
  for (const edge of index.edges.get(key) || []) {
    const d = segmentDistance(x,z,edge.a,edge.b);
    if (d.distance < nearest) { nearest=d.distance; height=edge.a.h+(edge.b.h-edge.a.h)*d.t;bankHeight=height;bankX=edge.a.x+(edge.b.x-edge.a.x)*d.t;bankZ=edge.a.z+(edge.b.z-edge.a.z)*d.t; }
  }
  for(const [a,b,c] of index.triangles.get(key) || []) {
    const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(den)<1e-9) continue;
    const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den;
    const w=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
    if(u>=-1e-7 && w>=-1e-7 && u+w<=1.0000001) { inside=true; height=u*a.h+w*b.h+(1-u-w)*c.h; break; }
  }
  return {inside,distance:nearest,height,bankX,bankZ,bankHeight};
}
function bridgeAt(profile, x, z, radius = 0) {
  return (profile.bridges || []).find(b => {
    const points=b.points?.length?b.points:[b.a,b.b];
    return points.some((point,i)=>{
      if(!i)return false;
      const a=points[i-1],dx=point.x-a.x,dz=point.z-a.z;
      const t=((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1);
    return t>=-1e-6&&t<=1+1e-6&&segmentDistance(x,z,a,point).distance+radius<=b.halfWidth+1e-6;
    });
  }) || null;
}
function bridgeHeight(bridge,x,z) {
  if(bridge.style==='legacyDam')return -.05+(.0734173+.05)*clamp((18-Math.abs(x+104.755))/3,0,1)+.06*(1-clamp((Math.abs(z+106)-1.5)/.6,0,1));
  if(!bridge.points?.length)return bridge.height;
  let nearest=Infinity,height=bridge.height;
  for(let i=1;i<bridge.points.length;i++) {
    const a=bridge.points[i-1],b=bridge.points[i],p=segmentDistance(x,z,a,b);
    if(p.distance<nearest){nearest=p.distance;height=a.h+(b.h-a.h)*p.t;}
  }
  return height;
}
function isWaterAt(profile, x, z, radius = 0, field = null) {
  if(bridgeAt(profile,x,z,radius))return false;
  if(!profile.waterIndices?.length && !profile.waterEdges?.length)return false;
  field ||= require('../../data/kromka/sector-surfaces.json').relief;
  const wet=(px,pz)=>{
    const water=waterAt(profile,px,pz);
    return (water.inside || water.distance<=0.00001) && groundHeight(profile,field,px,pz,false,water)<water.height+0.02*profile.gain/160;
  };
  if(wet(x,z))return true;
  for(let i=0;i<8 && radius>0;i++)if(wet(x+radius*Math.cos(i*Math.PI/4),z+radius*Math.sin(i*Math.PI/4)))return true;
  return false;
}
// Earthworks fade continuously into an open channel. Testing only whether a
// point is inside the native polygon creates a vertical wall at its boundary;
// testing only a bed-height threshold creates another wall inside the river.
function engineeringDryWeight(profile,water,height) {
  const scale=profile.gain/160;
  const above=smooth(.02*scale,.5*scale,height-water.height);
  // An interior index bucket can have no nearby shore edges. That sentinel
  // describes distance availability, not whether an open water bed is dry.
  if(!Number.isFinite(water.distance))return water.inside?above:1;
  return water.inside?above:Math.max(above,smooth(0,3*scale,water.distance));
}
function bridgeFootingWeight(profile,x,z) {
  const scale=profile.gain/160;let weight=0;
  for(const bridge of profile.bridges||[]) {
    if(['legacyDam','railViaduct','metalService'].includes(bridge.style))continue;
    const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
    for(const [a,b] of [[points[0],points[1]],[points.at(-1),points.at(-2)]]) {
      const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<.001)continue;
      const along=Math.abs(((x-a.x)*dx+(z-a.z)*dz)/length);
      const across=Math.abs(((z-a.z)*dx-(x-a.x)*dz)/length);
      const distance=Math.hypot(Math.max(0,along-.75*scale),Math.max(0,across-bridge.halfWidth*.75));
      weight=Math.max(weight,1-smooth(0,2*scale,distance));
    }
  }
  return weight;
}
function bridgeOpenSpanWeight(profile,x,z,water,naturalBank,edgeWet,cut) {
  const scale=profile.gain/160;
  const wet=Math.max(edgeWet,cut,water.inside?smooth(0,3*scale,water.distance):0);
  const low=1-smooth(.5*scale,2*scale,naturalBank-water.height);
  if(wet===0||low===0)return 0;
  let closest=null;
  for(const bridge of profile.bridges||[]) {
    if(['legacyDam','railViaduct','metalService'].includes(bridge.style))continue;
    const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
    const lengths=points.slice(1).map((b,i)=>Math.hypot(b.x-points[i].x,b.z-points[i].z));
    const total=lengths.reduce((sum,length)=>sum+length,0);if(total<.001)continue;
    let along=0;
    for(let i=1;i<points.length;i++) {
      const sample=segmentDistance(x,z,points[i-1],points[i]);
      if(!closest||sample.distance-bridge.halfWidth<closest.distance-closest.bridge.halfWidth)
        closest={bridge,distance:sample.distance,along:along+sample.t*lengths[i-1],total};
      along+=lengths[i-1];
    }
  }
  if(!closest)return 0;
  const ends=smooth(0,3*scale,Math.min(closest.along,closest.total-closest.along));
  const radial=1-smooth(closest.bridge.halfWidth+2.5*scale,closest.bridge.halfWidth+8*scale,closest.distance);
  if(ends===0||radial===0)return 0;
  const footing=1-bridgeFootingWeight(profile,x,z);
  if(footing===0)return 0;
  if(closest.bridge.dryRoadProtectionEnvelopes?.length) {
    let protection=0;
    for(const road of closest.bridge.dryRoadProtectionEnvelopes) {
      let distance=Infinity;
      for(let i=1;i<road.points.length;i++)distance=Math.min(distance,segmentDistance(x,z,road.points[i-1],road.points[i]).distance);
      const core=1-smooth(road.halfWidth,road.halfWidth+road.blend,distance);
      protection=Math.max(protection,core*smooth(closest.bridge.halfWidth-road.margin,closest.bridge.halfWidth,closest.distance));
    }
    return ends*footing*radial*wet*low*(1-protection);
  }
  // A dry road can enter from the side of a raised deck. Preserve its full
  // capsule footprint outside the deck, fading continuously on either side
  // of the junction; the channel beneath the deck stays open.
  const margin=.705; // radius .48 + skin .075 + outside clearance .15 metres
  let roadCore=0;
  for(const road of profile.roads||[]) {
    if(road.blocked||!['track','road'].includes(road.type))continue;
    const points=road.points?.length?road.points:[road.a,road.b];
    let distance=Infinity;
    for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(x,z,points[i-1],points[i]).distance);
    roadCore=Math.max(roadCore,1-smooth(road.halfWidth+margin,road.halfWidth+margin+2*scale,distance));
  }
  const roadProtection=roadCore*smooth(closest.bridge.halfWidth-margin,closest.bridge.halfWidth,closest.distance);
  return ends*footing*radial*wet*low*(1-roadProtection);
}
function roadBankWeight(profile,x,z) {
  let weight=0;
  for(const treatment of profile.roadBankTreatments||[]) {
    const distance=Math.max(treatment.minX-x,0,x-treatment.maxX,treatment.minZ-z,z-treatment.maxZ);
    weight=Math.max(weight,1-smooth(0,treatment.blend,distance));
  }
  if(weight===0)return 0;
  const scale=profile.gain/160;let core=0;
  for(const road of profile.roads||[]) {
    if(road.blocked||!['track','road'].includes(road.type))continue;
    const points=road.points?.length?road.points:[road.a,road.b];let distance=Infinity;
    for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(x,z,points[i-1],points[i]).distance);
    core=Math.max(core,1-smooth(road.halfWidth+.705,road.halfWidth+.705+.25*scale,distance));
  }
  if(core===1)return 0;
  let footing=bridgeFootingWeight(profile,x,z);
  for(const f of profile.foundations||[])footing=Math.max(footing,1-smooth(0,2*scale,foundationDistance(f,x,z)));
  return weight*(1-core)*(1-footing);
}
function groundHeight(profile, field, x, z, walking = false, waterSample = null, applyRail = true, railWalking = false, naturalSubstrate = false) {
  let h = rawHeight(profile, field, x, z);
  const water = waterSample || waterAt(profile,x,z);
  const mapped=mapPoint(profile,x,z);
  // The original river domain also covers high, dry ground. Only a genuinely
  // wet source edge creates a natural bank outside that domain. Both sides
  // converge to the same lip; dry edges retain the original relief.
  const edgeWet=Number.isFinite(water.distance)?smooth(.005*profile.gain/160,.5*profile.gain/160,water.bankHeight-rawHeight(profile,field,water.bankX,water.bankZ)):0;
  let cut=0;
  for(const c of profile.hydroCuts || []) {
    const d=Math.hypot(Math.max(c.minX-mapped.x,0,mapped.x-c.maxX),Math.max(c.minY-mapped.y,0,mapped.y-c.maxY));
    cut=Math.max(cut,1-smooth(0,c.blend,d));
  }
  if (water.inside) {
    const bed=water.height+0.04*profile.gain/160-1.84*profile.gain/160*smooth(0,3*profile.gain/160,water.distance);
    const blend=smooth(0.005*profile.gain/160,0.5*profile.gain/160,water.height-h);
    h=h*(1-blend)+Math.min(h,bed)*blend;
    const shore=edgeWet*(1-smooth(0,3*profile.gain/160,water.distance));
    h=h*(1-shore)+bed*shore;
    h=h*(1-cut)+bed*cut;
    const point=mapPoint(profile,x,z),distance=Math.hypot(Math.max(200-point.x,0,point.x-220),Math.max(200-point.y,0,point.y-220));
    const canal=1-smooth(0,5,distance);
    h=h*(1-canal)+bed*canal;
  }
  else if(Number.isFinite(water.distance) && edgeWet>0) {
    const slope=Math.min((32+96*cut)*profile.gain/160,Math.max(12*profile.gain/160,(h-water.height)*3.2+6*profile.gain/160));
    if(water.distance<slope) {
      const crest=Math.max(h,water.height+0.23*profile.gain/160),crestAt=slope*.62;
      const bank=water.distance<crestAt ? water.height+0.04*profile.gain/160+(crest-water.height-0.04*profile.gain/160)*smooth(0,crestAt,water.distance) : crest+(h-crest)*smooth(crestAt,slope,water.distance);
      h=h*(1-edgeWet)+bank*edgeWet;
    }
  }
  for (const p of profile.foundations || []) {
    if(p.afterHydro || p.afterRoads)continue;
    const d = foundationDistance(p,x,z);
    const weight=(1-smooth(0,p.blend,d))*(p.waterBlend?(water.inside?0:smooth(0,p.waterBlend,water.distance)):1);
    h += (p.height-h)*weight;
  }
  // A neighbouring city's approach fill cannot dam a continuous river. The
  // authored hydraulic cut takes priority over that fill, including its banks.
  if(cut>0) {
    if(water.inside) {
      const bed=water.height+.04*profile.gain/160-1.84*profile.gain/160*smooth(0,3*profile.gain/160,water.distance);
      h=h*(1-cut)+bed*cut;
    } else if(Number.isFinite(water.distance)) {
      const run=Math.min(128*profile.gain/160,Math.max(12*profile.gain/160,(h-water.height)*3.2+6*profile.gain/160));
      const bank=water.height+.04*profile.gain/160+(h-water.height-.04*profile.gain/160)*smooth(0,run,water.distance);
      h=h*(1-cut)+bank*cut;
    }
  }
  // A hydraulic bank treatment must not erode the already engineered dry
  // bridge footing. Its fill stays outside the source channel.
  // Every earthwork uses the same natural bank. Earlier fill must not make a
  // neighbouring fill eligible to raise the channel a second time.
  if(naturalSubstrate)return h;
  const naturalBank=h,roadDryWeight=engineeringDryWeight(profile,water,h);
  let protectedFillWater=false;
  for(const p of profile.foundations || [])if(p.afterHydro && !p.afterRoads) {
    const level=p.levelPoints?.length?bridgeHeight({points:p.levelPoints,height:p.height},x,z):p.height;
    // Cut a dry hillside as a broad soil slope. Retaining fill at the river
    // keeps its narrow contact with the native concrete quay.
    const transition=p.dryCutBlend>0&&h>level&&!water.inside?p.dryCutBlend:p.blend;
    const blend=smooth(0,transition,foundationDistance(p,x,z));
    const dry=p.fillWater?1:roadDryWeight;
    if(p.fillWater&&blend<1)protectedFillWater=true;
    h=dry===1?level+(h-level)*blend:h+(level-h)*(1-blend)*dry;
  }
  // Broad abutment halos are soil slopes. Keep the actual concrete contact,
  // explicit causeway fill and natural relief; limit only extra side fill.
  if(!protectedFillWater&&h>naturalBank&&Number.isFinite(water.distance)) {
    const cap=Math.max(naturalBank,water.height+.04*profile.gain/160+.65*water.distance);
    if(h>cap)h+=(cap-h)*Math.max(edgeWet,cut)*(1-bridgeFootingWeight(profile,x,z));
  }
  // The bridge deck carries traffic over the natural low bank and bed. Its
  // approach fill ends continuously at the actual endpoint footing; do not
  // extend road earthworks beneath the entire elevated span.
  const openSpan=protectedFillWater?0:bridgeOpenSpanWeight(profile,x,z,water,naturalBank,edgeWet,cut);
  if(openSpan>0&&h>naturalBank)h=openSpan===1?naturalBank:h+(naturalBank-h)*openSpan;
  let roadLevel=0,roadWeight=0,roadInfluence=0;
  const channelBed=water.inside && h<water.height+.02*profile.gain/160;
  if(roadDryWeight>0) {
    let closest=null;
    for(const bridge of profile.bridges || []) {
    if(bridge.style==='legacyDam'||bridge.style==='railViaduct'||bridge.style==='metalService')continue;
      const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
      const distance=Math.min(...points.slice(1).map((v,i)=>segmentDistance(x,z,points[i],v).distance));
      if(!closest||distance-bridge.halfWidth<closest.distance-closest.bridge.halfWidth)closest={bridge,distance};
    }
    if(closest) {
      const {bridge,distance}=closest,scale=profile.gain/160;
      const weight=(1-smooth(bridge.halfWidth+2.5*scale,bridge.halfWidth+8*scale,distance))*roadDryWeight*(1-openSpan);
      h=h*(1-weight)+bridgeHeight(bridge,x,z)*weight;
    }
  }
  const beforeRoadSoil=h;
  for(const corridor of roadDryWeight>0?profile.corridors || []:[]) {
    let nearest=Infinity,level=h;
    for(let i=1;i<corridor.points.length;i++) {
      const a=corridor.points[i-1],b=corridor.points[i],sample=segmentDistance(x,z,a,b);
      if(sample.distance<nearest){nearest=sample.distance;level=a.h+(b.h-a.h)*sample.t;}
    }
    const influence=1-smooth(corridor.halfWidth,corridor.halfWidth+corridor.blend,nearest);
    const kernel=1-smooth(0,corridor.halfWidth+corridor.blend,nearest),weight=kernel*kernel;
    roadLevel+=level*weight;roadWeight+=weight;roadInfluence=Math.max(roadInfluence,influence);
  }
  if(roadWeight>1e-12){roadInfluence*=roadDryWeight*(1-openSpan);h=h*(1-roadInfluence)+roadLevel/roadWeight*roadInfluence;}
  // A raised service road is retained by concrete at its protected shoulder.
  // Beyond it, remove only additional corridor fill, keeping the natural bank,
  // previous foundations, actual road footprint and all open water beds.
  if(!protectedFillWater&&h>beforeRoadSoil&&h>naturalBank) {
    const cap=Math.max(beforeRoadSoil,naturalBank);
    const weight=Math.max(water.inside?1:0,edgeWet,cut)*roadBankWeight(profile,x,z);
    if(weight>0)h+=(cap-h)*weight;
  }
  // Continuous authored floors and rail aprons keep one supporting plane
  // after road grading. The dry-only default preserves the open water bed.
  for(const p of profile.foundations || [])if(p.afterRoads && (!water.inside || p.fillWater || p.cutOnly)) {
    const level=p.levelPoints?.length?bridgeHeight({points:p.levelPoints,height:p.height},x,z):p.height;
    const weight=(1-smooth(0,p.blend,foundationDistance(p,x,z)))*(p.waterBlend?smooth(0,p.waterBlend,water.distance):1);
    const treated=h*(1-weight)+level*weight;
    h=p.cutOnly?Math.min(h,treated):treated;
  }
  const canonical=mapPoint(profile,x,z),distance=Math.hypot(Math.max(200-canonical.x,0,canonical.x-220),Math.max(200-canonical.y,0,canonical.y-220));
  if(distance<5) {
    const datum=sampleField(field,200.675,216.625);
    const old=legacyNativeHeight(field,(canonical.x-210)*16,(210-canonical.y)*16,datum)/160+datum;
    const blend=1-smooth(0,5,distance);
    h=h*(1-blend)+(old-profile.datum)*profile.gain*blend;
  }
  // A dry road that joins a sloped bridge from the side needs the bank soil
  // to meet the actual deck plane across the whole wheel track. This narrow
  // authored landing never fills a water triangle beneath the bridge.
  if(!water.inside)for(const bridge of profile.bridges||[])if(bridge.dryLandingBlend>0) {
    const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
    let nearest=Infinity;
    for(let i=1;i<points.length;i++)nearest=Math.min(nearest,segmentDistance(x,z,points[i-1],points[i]).distance);
    const weight=1-smooth(bridge.halfWidth,bridge.halfWidth+bridge.dryLandingBlend,nearest);
    if(weight>0)h=h*(1-weight)+bridgeHeight(bridge,x,z)*weight;
  }
  const naturalBeforeRail=h;
  // The legacy dam bed is applied after the initial channelBed decision.
  // Recheck the finished natural surface so rail formation cannot fill the
  // open channel beneath the authored bridge.
  const openChannel=water.inside && naturalBeforeRail<water.height+.02*profile.gain/160;
  let railFloor=null,railRoof=null;
  if(applyRail) {
    const rail=railAt(profile,x,z);
    if(rail) {
      // A viaduct has its own deck and supports. Keep the riverbed or valley
      // visible under it. Cut/fill and tunnel bores change only the narrow
      // earthwork around the railway; the mountain cover is a separate shell.
      const viaduct=rail.kind==='viaduct'||rail.h-rail.surfaceH>8;
      if(walking && !railWalking && (rail.kind==='tunnel'||viaduct))railRoof=naturalBeforeRail;
      else if(walking && rail.distance<=rail.halfWidth)railFloor=rail.h;
      if(!viaduct && !channelBed && !openChannel) {
        const weight=1-smooth(rail.earthworkHalfWidth,rail.earthworkHalfWidth+rail.earthworkBlend,rail.distance);
        h=h*(1-weight)+rail.h*weight;
      }
    }
  }
  if (walking) {
    if(railFloor!==null)return railFloor;
    if(railRoof!==null)return railRoof;
    const b = bridgeAt(profile, x, z);
    if (b && (b.style!=='railViaduct'||railWalking)) return bridgeHeight(b,x,z);
  }
  return h;
}
function foundationDistance(p,x,z) {
  if(p.shape==='polygon') {
    let inside=false,nearest=Infinity;
    for(let i=0,j=p.points.length-1;i<p.points.length;j=i++) {
      const a=p.points[j],b=p.points[i];nearest=Math.min(nearest,segmentDistance(x,z,a,b).distance);
      if((a.z>z)!==(b.z>z) && x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    return inside?0:nearest;
  }
  return p.shape==='ellipse'?Math.max(0,(Math.hypot((x-p.x)/p.halfX,(z-p.z)/p.halfZ)-1)*Math.min(p.halfX,p.halfZ)):Math.hypot(Math.max(0,Math.abs(x-p.x)-p.halfX),Math.max(0,Math.abs(z-p.z)-p.halfZ));
}
function legacyNativeHeight(field,x,z,datum=sampleField(field,200.675,216.625)) {
  const profile=require('../../data/kromka/dam-road-river-profile.json');
  const apron=Math.hypot(Math.max(0,Math.abs(x+82)-70),Math.max(0,Math.abs(z+106)-30));
  const land=(sampleField(field,205.8+x/16,210-z/16)-datum)*160*smooth(0,24,apron);
  const index=clamp((z/320+.5)*256,0,256),low=Math.min(255,Math.floor(index)),t=index-low;
  const center=profile.centers[low]*(1-t)+profile.centers[low+1]*t,half=profile.halfWidths[low]*(1-t)+profile.halfWidths[low+1]*t,d=Math.abs(x-center);
  const canal=smooth(-160,-140,z)*(1-smooth(-72,0,z));
  const water=z< -140?-.15+(-140-z)*.007:z<=-72?-.15-(z+140)*.0005:z+72<24?-.184-.0175*(z+72)*(z+72)/48:-.184-.0175*(z+60);
  const inner=3.2+(0.35-3.2)*canal,bank=Math.max(20,Math.max(0,land-water)*3.2+6)*(1-canal)+2.6*canal,lip=water+.015,bed=water-1.65;
  if(d<=half-inner)return bed;
  if(d<half)return bed+(lip-bed)*smooth(half-inner,half,d);
  if(d>=half+bank)return land;
  const crest=Math.max(land,water+.23),crestAt=half+bank*.62;
  return d<crestAt?lip+(crest-lip)*smooth(half,crestAt,d):crest+(land-crest)*smooth(crestAt,half+bank,d);
}
function crossesWater(profile, ax, az, bx, bz, radius = 0, field = null) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  for (let i = 1; i <= steps; i++) {
    if (isWaterAt(profile, ax + (bx - ax) * i / steps, az + (bz - az) * i / steps, radius, field)) return true;
  }
  return false;
}
module.exports = { clamp, smooth, segmentDistance, sampleField, mapPoint, sourcePoint, rawHeight, waterAt,
  bridgeAt, bridgeHeight, isWaterAt, groundHeight, legacyNativeHeight, crossesWater };
