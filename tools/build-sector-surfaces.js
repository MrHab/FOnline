'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {planAccess}=require('./lib/sector-access');
const {addFoundations,shareFoundations,addCrossings,addJunctions,addGateJunctions,shareBridgeRoadProtection}=require('./lib/sector-engineering');
const {addBridgeGroundCuts}=require('./lib/sector-bridge-clearance');
const {addServiceWalkways}=require('./lib/sector-service-walkways');
const {applyResourceFootings}=require('./lib/sector-resource-footings');
const {applyCisternFootings}=require('./lib/sector-cistern-footings');
const {sectorSourceDefinition}=require('./lib/sector-source-definition');
const {finalizeSectorCatalog,sharedSnapshot}=require('./lib/sector-finalization');
const {addLocalCrossings}=require('./lib/sector-crossings');
const {gradeAccess}=require('./lib/sector-grading');
const {reconcileJunctions}=require('./lib/sector-junctions');
const {applyInfrastructureLayouts}=require('./lib/sector-infrastructure-layout');
const {planSiteAccess}=require('./lib/sector-site-access');
const {addSiteWater}=require('./lib/sector-site-water');
const {bindRoadEndpoints}=require('./lib/sector-road-bindings');
const {processPipes}=require('./lib/sector-process-pipes');
const {buildRailInfrastructure}=require('./build-sector-rail-infrastructure');
const {applyRailDecks}=require('./apply-sector-rail-infrastructure');
const {planRailSupports}=require('./plan-sector-rail-supports');
const {applyRoadBankTreatments}=require('./lib/sector-road-bank');
const { sampleField, mapPoint, sourcePoint, waterAt, groundHeight, isWaterAt, crossesWater } = require('../src/server/sector-surface');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const round = x => Number(x.toFixed(5));
function field(text, name) {
  const m = text.match(new RegExp('^\\s*' + name + ': ([^\\r\\n]+)', 'm'));
  if (!m) throw new Error('Missing ' + name);
  return m[1].trim();
}
function readRelief() {
  const text = read('unity-client/Assets/Resources/RealmOfAshes/GlobalMapRelief.asset');
  const f = { samplesX: Number(field(text, 'SamplesX')), samplesY: Number(field(text, 'SamplesY')),
    width: Number(field(text, 'WidthPoints')), depth: Number(field(text, 'HeightPoints')),
    heights: text.slice(text.indexOf('  Heights:')).split(/\r?\n/).filter(s => /^\s*- [-\d.]/.test(s)).map(s => Number(s.trim().slice(2))) };
  if (f.heights.length !== f.samplesX * f.samplesY) throw new Error('Invalid original relief field');
  return f;
}
function readRiver(fieldData) {
  const text = read('unity-client/Assets/Resources/RealmOfAshes/DamRoadRiverSource.asset');
  const bytes = Buffer.from(field(text, '_typelessdata'), 'hex'), indices = Buffer.from(field(text, 'm_IndexBuffer'), 'hex');
  const count = Number(field(text, 'm_VertexCount')), stride = bytes.length / count;
  if (stride !== 32) throw new Error('Unsupported original river vertex stride');
  const v = Array.from({ length: count }, (_, i) => ({ x: bytes.readFloatLE(i * stride) / 0.1 + fieldData.width / 2,
    y: fieldData.depth / 2 - bytes.readFloatLE(i * stride + 8) / 0.1, h: bytes.readFloatLE(i * stride + 4) }));
  return Array.from({ length: Number(field(text, 'indexCount')) / 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => v[indices.readUInt16LE((i * 3 + j) * 2)]));
}
function waterMesh(triangles,p) {
  const vertices=[],indices=[],lookup=new Map();
  const index=v=>{const key=v.x.toFixed(5)+','+v.y.toFixed(5);if(lookup.has(key))return lookup.get(key);const n=vertices.length;lookup.set(key,n);vertices.push({x:round(((v.x-p.mapMinX)/20-0.5)*p.width),z:round((0.5-(v.y-p.mapMinY)/20)*p.depth),h:round((v.h-p.datum)*p.gain)});return n;};
  for(const source of triangles) {
    let polygon=source;
    for(const [axis,value,less] of [['x',p.mapMinX,false],['x',p.mapMinX+20,true],['y',p.mapMinY,false],['y',p.mapMinY+20,true]]) {
      const result=[];
      for(let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length],inA=less?a[axis]<=value:a[axis]>=value,inB=less?b[axis]<=value:b[axis]>=value;
        if(inA) result.push(a);
        if(inA!==inB) {const t=(value-a[axis])/(b[axis]-a[axis]);result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,h:a.h+(b.h-a.h)*t});}
      }
      polygon=result;
      if(!polygon.length) break;
    }
    for(let i=1;i<polygon.length-1;i++) {
      const ids=[index(polygon[0]),index(polygon[i]),index(polygon[i+1])];
      if(new Set(ids).size===3) indices.push(...ids);
    }
  }
  const edges=new Map();
  for(let i=0;i<indices.length;i+=3) for(let j=0;j<3;j++) {
    const a=indices[i+j],b=indices[i+(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(',');
    if(edges.has(key))edges.delete(key);else edges.set(key,{a:vertices[a],b:vertices[b]});
  }
  // A cut through the sector border is a continuation of water, not a shore.
  const realEdges=[...edges.values()].filter(e=>!(['x','z'].some(axis=>Math.abs(e.a[axis]-e.b[axis])<1e-4 && Math.abs(Math.abs(e.a[axis])-p[axis==='x'?'width':'depth']/2)<1e-3)));
  return {waterVertices:vertices,waterIndices:indices,waterEdges:realEdges};
}
function clipLine(a, b, p) {
  let low = 0, high = 1;
  const dx = b.x-a.x, dy = b.y-a.y;
  for (const [n,q] of [[-dx,a.x-p.mapMinX],[dx,p.mapMinX+p.mapSpan-a.x],[-dy,a.y-p.mapMinY],[dy,p.mapMinY+p.mapSpan-a.y]]) {
    if (Math.abs(n) < 1e-8) { if (q < 0) return null; continue; }
    const t = q/n;
    if (n < 0) low = Math.max(low,t); else high = Math.min(high,t);
    if (low > high) return null;
  }
  return [low,high].map(t => ({x:round(((a.x+dx*t-p.mapMinX)/p.mapSpan-0.5)*p.width),
    z:round((0.5-(a.y+dy*t-p.mapMinY)/p.mapSpan)*p.depth)}));
}
function build() {
  const sourceSnapshot=()=>{
    const files=['data/global-map.json','data/kromka/zone-graph.json',
      'data/kromka/dam-road-river-profile.json',
      'unity-client/Assets/Resources/RealmOfAshes/GlobalMapRelief.asset',
      'unity-client/Assets/Resources/RealmOfAshes/DamRoadRiverSource.asset'];
    for(const directory of ['data/zones/authored','data/locations'])
      for(const name of fs.readdirSync(path.join(root,directory)).filter(name=>name.endsWith('.json')).sort())
        files.push(directory+'/'+name);
    return crypto.createHash('sha256').update(JSON.stringify({shared:sharedSnapshot(),
      files:files.map(file=>[file,crypto.createHash('sha256').update(read(file)).digest('hex')])})).digest('hex');
  };
  const initialSources=sourceSnapshot();
  const verifySources=()=>{
    if(sourceSnapshot()!==initialSources)
      throw new Error('World source files changed during geometry generation; no catalog can be published');
  };
  const graph = json('data/kromka/zone-graph.json'), map = json('data/global-map.json'), relief = readRelief();
  const engineering=json('data/kromka/sector-engineering.json');
  let river = readRiver(relief);
  const damDatum=sampleField(relief,200.675,216.625);
  const waterLevel=y=>{
    const z=(210-y)*16;
    let h=z < -140 ? -0.15+(-140-z)*0.007 : z<=-72 ? -0.15-(z+140)*0.0005 : z+72<24 ? -0.184-0.0175*(z+72)*(z+72)/48 : -0.184-0.0175*(z+60);
    return damDatum+h/160;
  };
  for(const point of new Set(river.flat())) {
    const sourceX=point.x;
    for(let i=0;i<20;i++) point.x=sourceX+(point.x-sourcePoint(point.x,point.y).x);
    const distance=Math.hypot(Math.max(200-point.x,0,point.x-220),Math.max(200-point.y,0,point.y-220));
    const t=Math.min(1,distance/5),blend=1-t*t*(3-2*t);
    point.h=point.h*(1-blend)+waterLevel(point.y)*blend;
  }
  // Reframe the authored spillway into its canonical cell. Both neighbouring
  // water cuts sample these same banks; there is no overlapping legacy cutout.
  const originalRiver=river,dam=json('data/kromka/dam-road-river-profile.json');
  const rowBanks=y=>{
    let left=Infinity,right=-Infinity;
    for(const tri of originalRiver)for(let i=0;i<3;i++) {
      const a=tri[i],b=tri[(i+1)%3];
      if((a.y-y)*(b.y-y)>0||Math.abs(a.y-b.y)<1e-8)continue;
      const x=a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y);
      if(x<180||x>240)continue;
      left=Math.min(left,x);right=Math.max(right,x);
    }
    return {left,right};
  };
  const rowCache=new Map();
  const banks=y=>{const key=y.toFixed(7);if(!rowCache.has(key))rowCache.set(key,rowBanks(y));return rowCache.get(key);};
  const clipY=(poly,y,less)=>{
    const out=[];
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],ia=less?a.y<=y:a.y>=y,ib=less?b.y<=y:b.y>=y;
      if(ia)out.push({...a});
      if(ia!==ib){const t=(y-a.y)/(b.y-a.y);out.push({x:a.x+(b.x-a.x)*t,y,h:a.h+(b.h-a.h)*t});}
    }
    return out;
  };
  const transformBank=v=>{
    if(v.x<180||v.x>240)return v;
    const original=banks(v.y);if(!Number.isFinite(original.left)||original.right-original.left<1e-6)return v;
    const z=Math.max(-160,Math.min(160,(210-v.y)*16)),index=(z/320+.5)*dam.segments,low=Math.min(Math.floor(index),dam.segments-1),t=index-low;
    const center=dam.centers[low]*(1-t)+dam.centers[low+1]*t,half=dam.halfWidths[low]*(1-t)+dam.halfWidths[low+1]*t;
    const left=200+(center-half+160)/16,right=200+(center+half+160)/16;
    const distance=Math.max(200-v.y,0,v.y-220),f=Math.min(1,distance/10),weight=1-f*f*(3-2*f);
    const u=(v.x-original.left)/(original.right-original.left);
    return {x:v.x*(1-weight)+(left+(right-left)*u)*weight,y:v.y,h:v.h*(1-weight)+waterLevel(v.y)*weight};
  };
  river=[];
  for(const triangle of originalRiver) {
    const min=Math.min(...triangle.map(v=>v.y)),max=Math.max(...triangle.map(v=>v.y));
    if(max<190||min>230||Math.max(...triangle.map(v=>v.x))<180||Math.min(...triangle.map(v=>v.x))>240){river.push(triangle);continue;}
    const polys=[clipY(triangle,190,true),clipY(triangle,230,false)];
    const step=20/dam.segments,start=Math.max(190,190+Math.floor((min-190)/step)*step),end=Math.min(230,max);
    for(let y=start;y<end-1e-8;y+=step)polys.push(clipY(clipY(triangle,y,false),y+step,true).map(transformBank));
    for(const poly of polys)for(let i=1;i<poly.length-1;i++)river.push([poly[0],poly[i],poly[i+1]]);
  }
  const globalEdges=new Map();
  const key=v=>v.x.toFixed(5)+','+v.y.toFixed(5);
  for(const triangle of river) for(let i=0;i<3;i++) {
    const a=triangle[i],b=triangle[(i+1)%3],k=[key(a),key(b)].sort().join('|');
    if(globalEdges.has(k))globalEdges.delete(k);else globalEdges.set(k,{a,b});
  }
  const warpedInfrastructure=map.infrastructure.map(route=>({...route,points:route.points.map(point=>{let x=point.x;for(let i=0;i<20;i++)x=point.x+(x-sourcePoint(x,point.y).x);return {x,y:point.y};})}));
  const profiles = graph.zones.map(zone => {
    const locationId = zone.city || zone.id;
    const file = zone.city ? `data/locations/${locationId}.json` : `data/zones/authored/${zone.id}.json`;
    const definition = json(file);
    const p = { zoneId: zone.id, locationId, title: zone.title, region: zone.region,
      width: definition.map.width, depth: definition.map.depth, mapMinX: zone.col*20, mapMinY: zone.row*20,
      mapSpan: 20, gain: definition.map.width / 2, datum: 0, legacyDam: zone.id === 'z_10_10',
      foundations: [], facilities:definition.facilities||[], hydroCuts:engineering.hydroCuts || [], waterVertices: [], waterIndices: [], waterEdges: [], roads: [], bridges: [] };
    if (Math.abs(p.width-p.depth)>0.001) throw new Error('Nonuniform sector scaling: '+locationId);
    const origin = mapPoint(p,p.legacyDam?-82:0,p.legacyDam?-106:0); p.datum = round(sampleField(relief,sourcePoint(origin.x,origin.y).x,origin.y));
    // Occupied sites and cities keep one coherent foundation; blend through the
    // surrounding terrain instead of individually tilting imported structures.
    for (const s of [...definition.sites||[],...definition.facilities||[]]) {
      const pos = mapPoint(p,s.x,s.z);
      const height=round((sampleField(relief,sourcePoint(pos.x,pos.y).x,pos.y)-p.datum)*p.gain);
      const layoutPath=['site-layouts','facility-layouts'].map(folder=>path.join(root,'data/kromka',folder,s.id+'.json')).find(file=>fs.existsSync(file));
      const layout=layoutPath?JSON.parse(fs.readFileSync(layoutPath,'utf8')):{};
      if(layout.terrainSegments){if(![128,256].includes(layout.terrainSegments))throw new Error('Unsupported native terrain detail '+s.id);p.terrainSegments=Math.max(p.terrainSegments||128,layout.terrainSegments);}
      if(layout.foundationMode!=='natural')p.foundations.push({id:'site_'+s.id+'_000_base',x:s.x,z:s.z,halfX:s.halfX,halfZ:s.halfZ,blend:layout.foundationBlend??24,height,...(layout.foundationWaterBlend?{waterBlend:layout.foundationWaterBlend}:{})});
      if(layoutPath) {
        const angle=layout.site?(layout.site.rotationY||0)*Math.PI/180:(s.rotationY||0);
        for(const cut of layout.earthworks||[]) {
          const x=s.x+cut.x*Math.cos(angle)+cut.z*Math.sin(angle),z=s.z-cut.x*Math.sin(angle)+cut.z*Math.cos(angle);
          // Rectangular cuts retain their authored orientation; a polygon also
          // supports arbitrary site rotation without changing imported models.
          const points=cut.shape==='rectangle'?[[ -cut.halfX,-cut.halfZ ],[cut.halfX,-cut.halfZ],[cut.halfX,cut.halfZ],[-cut.halfX,cut.halfZ]].map(([dx,dz])=>({x:x+dx*Math.cos(angle)+dz*Math.sin(angle),z:z-dx*Math.sin(angle)+dz*Math.cos(angle)})):undefined;
          const anchor=cut.heightAnchor;
          const anchorX=anchor?s.x+anchor.x*Math.cos(angle)+anchor.z*Math.sin(angle):x;
          const anchorZ=anchor?s.z-anchor.x*Math.sin(angle)+anchor.z*Math.cos(angle):z;
          const referenceProfile=anchor?.ignoreAfterRoads?{...p,foundations:p.foundations.filter(f=>!f.afterRoads)}:p;
          const reference=cut.heightMode==='existing'?groundHeight(referenceProfile,relief,anchorX,anchorZ):height;
          p.foundations.push({id:'site_'+s.id+'_100_'+cut.id,x:round(x),z:round(z),halfX:cut.halfX,halfZ:cut.halfZ,blend:cut.blend,height:round(reference+cut.height),shape:points?'polygon':cut.shape,points,...(cut.afterRoads?{afterRoads:true}:{})});
        }
      }
    }
    if (zone.city) {
      const wall=definition.zone?.cityWall;
      const minX=wall?.minX??-67,maxX=wall?.maxX??69,minZ=wall?.minZ??-67,maxZ=wall?.maxZ??69;
      const appearancePath=path.join(root,'data/kromka/city-appearance-layouts',locationId+'.json');
      const appearance=fs.existsSync(appearancePath)?JSON.parse(fs.readFileSync(appearancePath,'utf8')):{};
      // A concrete quay keeps its soil transition inside the native wall.
      // Other cities retain their authored sloping foundation by default.
      const blend=appearance.retainingBlend??2;
      if(!Number.isFinite(blend)||blend<=0||blend>2)throw new Error('Invalid city retaining blend '+locationId);
      if(appearance.retainingFinish!==undefined&&typeof appearance.retainingFinish!=='boolean')throw new Error('Invalid city retaining finish '+locationId);
      if(appearance.retainingFinish===true)p.retainingFinish=true;
      const dryCutBlend=appearance.dryCutBlend;
      if(dryCutBlend!==undefined&&(!Number.isFinite(dryCutBlend)||dryCutBlend<blend||dryCutBlend>64))throw new Error('Invalid city dry cut blend '+locationId);
      p.foundations.push({id:'city_platform',afterHydro:true,fillWater:true,x:(minX+maxX)/2,z:(minZ+maxZ)/2,halfX:(maxX-minX)/2+3,halfZ:(maxZ-minZ)/2+3,blend,height:0,shape:'polygon',points:[{x:minX-3,z:minZ+3},{x:minX+3,z:minZ-3},{x:maxX-3,z:minZ-3},{x:maxX+3,z:minZ+3},{x:maxX+3,z:maxZ-3},{x:maxX-3,z:maxZ+3},{x:minX+3,z:maxZ+3},{x:minX-3,z:maxZ-3}]});
      if(dryCutBlend!==undefined)p.foundations[p.foundations.length-1].dryCutBlend=dryCutBlend;
    }
    Object.assign(p,waterMesh(river,p));
    // Use the same original shoreline on both sides of every cut. A mesh
    // clipped to one cell cannot supply the closest bank of its neighbour.
    const margin=16;
    p.waterEdges=[...globalEdges.values()].filter(e=>Math.max(e.a.x,e.b.x)>=p.mapMinX-margin&&Math.min(e.a.x,e.b.x)<=p.mapMinX+20+margin&&Math.max(e.a.y,e.b.y)>=p.mapMinY-margin&&Math.min(e.a.y,e.b.y)<=p.mapMinY+20+margin)
      .map(e=>({a:{x:round((e.a.x-p.mapMinX-10)/20*p.width),z:round((p.mapMinY+10-e.a.y)/20*p.depth),h:round((e.a.h-p.datum)*p.gain)},b:{x:round((e.b.x-p.mapMinX-10)/20*p.width),z:round((p.mapMinY+10-e.b.y)/20*p.depth),h:round((e.b.h-p.datum)*p.gain)}}));
    addSiteWater(p,definition,root);
    if(zone.city && p.waterVertices.length) {
      p.foundations[0].height=Math.max(0,...p.waterVertices.map(v=>v.h+0.4));
    }
    if(p.legacyDam) {
      p.foundations=[{x:-82,z:-106,halfX:70,halfZ:30,blend:24,height:0}];
      const d=json('data/kromka/dam-road-river-profile.json');
      p.waterVertices=[];p.waterIndices=[];p.waterEdges=[];
      for(let i=0;i<=d.segments;i++) {
        const z=(i/d.segments-0.5)*d.depth,h=(waterLevel(210-z/16)-p.datum)*p.gain;
        p.waterVertices.push({x:d.centers[i]-d.halfWidths[i],z,h:round(h)},{x:d.centers[i]+d.halfWidths[i],z,h:round(h)});
        if(i>0) {const n=i*2;p.waterIndices.push(n-2,n,n-1,n-1,n,n+1);p.waterEdges.push({a:p.waterVertices[n-2],b:p.waterVertices[n]},{a:p.waterVertices[n-1],b:p.waterVertices[n+1]});}
      }
      p.bridges=[{id:'outpost17_authored_rail_bridge',style:'legacyDam',halfWidth:3.6,height:.1334173,a:{x:-122.755,z:-106},b:{x:-86.755,z:-106}}];
    }
    for (const route of warpedInfrastructure) {
      if (route.type === 'service_tunnel') continue;
      for(let i=1;i<route.points.length;i++) {
        const clipped=clipLine(route.points[i-1],route.points[i],p);
        if(clipped && Math.hypot(clipped[1].x-clipped[0].x,clipped[1].z-clipped[0].z)>0.1)
          p.roads.push({id:route.id+'_'+i,type:route.type,halfWidth:route.type==='railway'?3.6:route.type==='pipeline'?1.8:4,a:clipped[0],b:clipped[1]});
      }
    }
    if(p.legacyDam) {
      const rail=json('data/kromka/dam-road-rail.json');
      p.roads=[{id:'ore_freight_rail_authored',type:'railway',halfWidth:2.1,a:rail.points[0],b:rail.points.at(-1),points:rail.points}];
    }
    // Retain every existing gate and connect it to the playable interior. These
    // access tracks also provide intended bridges where the river divides a zone.
    for (const [side,edge] of Object.entries(zone.edges).filter(([,e])=>e.open)) {
      const along=(edge.along-0.5)*p.width;
      const end=side==='north'?{x:along,z:p.depth/2}:side==='south'?{x:along,z:-p.depth/2}:side==='east'?{x:p.width/2,z:along}:{x:-p.width/2,z:along};
      p.roads.push({id:'gate_'+side,type:'track',halfWidth:2.5,a:{x:0,z:0},b:end});
    }
    if (!p.legacyDam) for (const road of p.roads.filter(r=>r.type!=='pipeline' && r.type!=='track')) {
      const length=Math.hypot(road.b.x-road.a.x,road.b.z-road.a.z), steps=Math.ceil(length/0.5);
      let first=-1;
      for(let i=0;i<=steps+1;i++) {
        const t=Math.min(1,i/steps), x=road.a.x+(road.b.x-road.a.x)*t,z=road.a.z+(road.b.z-road.a.z)*t;
        const wet=i<=steps && isWaterAt(p,x,z,0.8,relief);
        if(wet && first<0) first=i;
        if(!wet && first>=0) {
          const point=j=>({x:round(road.a.x+(road.b.x-road.a.x)*j/steps),z:round(road.a.z+(road.b.z-road.a.z)*j/steps)});
          const a=point(Math.max(0,first-24)),b=point(Math.min(steps,i+24));
          if(isWaterAt(p,a.x,a.z,1,relief)||isWaterAt(p,b.x,b.z,1,relief))continue;
          const h=Math.max(groundHeight(p,relief,a.x,a.z),groundHeight(p,relief,b.x,b.z),waterAt(p,x,z).height)+0.3;
          const length=Math.hypot(b.x-a.x,b.z-a.z),ramp=Math.min(12,length*.3),along=ramp/length;
          const points=[{...a,h:round(groundHeight(p,relief,a.x,a.z))},{x:round(a.x+(b.x-a.x)*along),z:round(a.z+(b.z-a.z)*along),h:round(h)},{x:round(b.x-(b.x-a.x)*along),z:round(b.z-(b.z-a.z)*along),h:round(h)},{...b,h:round(groundHeight(p,relief,b.x,b.z))}];
          p.bridges.push({id:road.id+'_bridge_'+first,a:points[0],b:points[3],points,halfWidth:road.halfWidth,height:round(h)});
          first=-1;
        }
      }
    }
    return p;
  });
  // Foundations are world features. Their blending must continue across adjacent
  // cuts with the neighbouring sector's own horizontal and vertical scale.
  applyInfrastructureLayouts(profiles,relief,engineering.infrastructureLayouts);
  addFoundations(profiles,relief,engineering);shareFoundations(profiles);
  const definitionOf=p=>({...sectorSourceDefinition(json(p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json')),surfaceArrivalOverride:engineering.arrivalOverrides?.find(row=>row.zone===p.zoneId)});
  planAccess(profiles,graph,relief,definitionOf,false);
  addCrossings(profiles,relief,engineering);
  planAccess(profiles,graph,relief,definitionOf,false);
  addLocalCrossings(profiles,relief,engineering);
  addJunctions(profiles,relief,engineering);
  const gateBindings=planAccess(profiles,graph,relief,definitionOf);
  addGateJunctions(profiles,relief,engineering);
  bindRoadEndpoints(profiles,engineering.endpointBindings);
  planSiteAccess(profiles,relief,definitionOf);
  for(const p of profiles)p.processPipes=processPipes(p,relief,definitionOf(p),root,profiles);
  if(process.env.ROA_SURFACE_STAGE)fs.writeFileSync(process.env.ROA_SURFACE_STAGE,JSON.stringify({schema:'roa.sectorSurfaceStage.v1',gateBindings,relief,profiles})+'\n');
  if(process.argv.includes('--stage-only')){verifySources();return {gateBindings,relief,profiles};}
  gradeAccess(profiles,relief,engineering);
  reconcileJunctions(profiles);
  addBridgeGroundCuts(profiles,engineering);shareFoundations(profiles);
  addServiceWalkways(profiles,relief,engineering);
  // gradeAccess routes engineered stations together with their supporting
  // corridor. Keep that final route so road and earthwork rebuild identically.
  if(applyResourceFootings(profiles,relief,engineering,definitionOf).length)shareFoundations(profiles);
  if(applyCisternFootings(profiles,relief,engineering,definitionOf).length)shareFoundations(profiles);
  const catalog={schema:'roa.sectorSurfaces.v1',gateBindings,relief,profiles};
  buildRailInfrastructure(catalog);applyRailDecks(catalog);planRailSupports(catalog);
  applyRoadBankTreatments(profiles,relief,engineering);
  shareBridgeRoadProtection(profiles,engineering);
  verifySources();
  if(process.argv.includes('--geometry-only')) {
    catalog.sourceHash=crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
    return catalog;
  }
  const finalized=finalizeSectorCatalog(catalog,{collectPaths:!!process.env.ROA_INTERACTION_PATHS_OUT,
    checkpointDir:process.env.ROA_SURFACE_CHECKPOINTS,
    onProgress:process.env.ROA_SURFACE_CHECKPOINTS?row=>console.log(JSON.stringify(row)):undefined});
  verifySources();
  if(process.env.ROA_INTERACTION_PATHS_OUT) {
    const output=path.resolve(process.env.ROA_INTERACTION_PATHS_OUT);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({schema:'roa.interactionPathDiagnostics.v1',sourceHash:catalog.sourceHash,rows:finalized.paths})+'\n');
  }
  return catalog;
}
if (require.main===module) {
  const geometryOnly=process.argv.includes('--geometry-only');
  if(geometryOnly && (!process.env.ROA_SURFACE_GEOMETRY_OUT
      || process.argv.includes('--stage-only') || process.argv.includes('--check')))
    throw new Error('--geometry-only requires ROA_SURFACE_GEOMETRY_OUT and cannot be combined with --stage-only or --check');
  const publicationFiles=['data/kromka/sector-surfaces.json','unity-client/Assets/Resources/RealmOfAshes/SectorSurfaces.json'];
  if(geometryOnly && publicationFiles.some(file=>path.resolve(root,file).toLowerCase()
      ===path.resolve(process.env.ROA_SURFACE_GEOMETRY_OUT).toLowerCase()))
    throw new Error('Diagnostic geometry must not overwrite a published sector catalog');
  const data=JSON.stringify(build())+'\n';
  if(process.argv.includes('--stage-only')) {
    if(!process.env.ROA_SURFACE_STAGE)throw new Error('--stage-only requires ROA_SURFACE_STAGE');
    console.log('Surface engineering stage saved for geometric diagnostics.');
    process.exit(0);
  }
  if(geometryOnly) {
    const output=path.resolve(process.env.ROA_SURFACE_GEOMETRY_OUT);
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,data);
    console.log('Full source geometry saved for validation; '+JSON.parse(data).profiles.length+' sectors.');
    process.exit(0);
  }
  for (const f of publicationFiles) {
    const target=path.join(root,f);
    if(process.argv.includes('--check')) {if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==data) throw new Error('Stale sector surfaces: '+f);}
    else fs.writeFileSync(target,data);
  }
  console.log('Sector surfaces: '+JSON.parse(data).profiles.length+'; original relief and water, deterministic server/client profile.');
}
module.exports={build,waterMesh,clipLine,readRelief};
