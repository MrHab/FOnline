'use strict';
const {groundHeight,waterAt}=require('./sector-surface');
const crypto=require('node:crypto');
const cache=new WeakMap();
// Pipe runs have real mesh collision in Unity. Their projection on the walking
// height band is shared by server movement and the authoring route planner.
function utilityBlockers(profile,field,{allowPendingRevetment=false}={}) {
  if(!profile)return [];
  if(profile.hasRoadBankContactWalls!==undefined&&typeof profile.hasRoadBankContactWalls!=='boolean')
    throw Error('Invalid retaining contact wall marker '+profile.zoneId);
  const derived=profile.roadBankContactWalls;
  if(!profile.hasRoadBankContactWalls&&derived?.length)
    throw Error('Unmarked retaining contact wall '+profile.zoneId);
  if(profile.hasRoadBankContactWalls){
    const original=profile.roadBankWalls;
    if(!Array.isArray(original)||!original.length||!Array.isArray(derived)||derived.length!==original.length)
      throw Error('Incomplete retaining contact wall '+profile.zoneId);
    for(let i=0;i<derived.length;i++){
      const a=original[i],b=derived[i];
      if(a.id!==b.id||!Array.isArray(b.points)||b.points.length!==a.points.length)
        throw Error('Mismatched retaining contact wall '+profile.zoneId);
      for(let j=0;j<b.points.length;j++){
        const source=a.points[j],target=b.points[j];
        if(source.x!==target.x||source.z!==target.z||source.top!==target.top||source.bottom!==target.bottom)
          throw Error('Altered retaining inner face '+profile.zoneId);
        const width=Math.hypot(target.outerX-target.x,target.outerZ-target.z);
        if(!Number.isFinite(width)||width<.24999||width>.80001)
          throw Error('Invalid retaining contact thickness '+profile.zoneId);
      }
    }
  }
  const bankWalls=profile.hasRoadBankContactWalls?derived:profile.roadBankWalls;
  if(profile.hasRoadBankContactFootings!==undefined&&typeof profile.hasRoadBankContactFootings!=='boolean')
    throw Error('Invalid retaining footing marker '+profile.zoneId);
  const footings=profile.roadBankContactFootings;
  if(!profile.hasRoadBankContactFootings&&footings?.length)
    throw Error('Unmarked retaining footing '+profile.zoneId);
  if(profile.hasRoadBankContactFootings&&(!profile.hasRoadBankContactWalls||!Array.isArray(footings)))
    throw Error('Incomplete retaining footing '+profile.zoneId);
  if(profile.hasRoadBankContactFootings&&(footings.length!==bankWalls.length||
      footings.some((foot,i)=>foot.id!==bankWalls[i].id+'_foot_0'||
        !Array.isArray(foot.points)||foot.points.length!==bankWalls[i].points.length)))
    throw Error('Discontinuous retaining footing '+profile.zoneId);
  const revetments=profile.bridgeBankRevetments,meshes=profile.bridgeBankRevetmentMeshes;
  if(meshes?.length&&!revetments?.length)throw Error('Unmarked bridge bank revetment '+profile.zoneId);
  if(meshes?.length&&meshes.length!==revetments.length)throw Error('Incomplete bridge bank revetment '+profile.zoneId);
  if(revetments?.length&&(!Array.isArray(meshes)||meshes.length!==revetments.length)&&!allowPendingRevetment)
    throw Error('Missing bridge bank revetment mesh '+profile.zoneId);
  const old=cache.get(profile);if(old&&old.source===profile.processPipes&&old.supports===profile.railSupports&&old.barriers===profile.railBarriers&&old.bankWalls===bankWalls&&old.footings===footings&&old.revetments===revetments&&old.meshes===meshes)return old.blockers;
  const blockers=[];
  for(const pipe of profile.processPipes||[]) {
    const points=pipe.points||[],radius=pipe.halfWidth;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
      const low=a.h-groundHeight(profile,field,a.x,a.z),high=b.h-groundHeight(profile,field,b.x,b.z);
      if(length<1e-5) {
        if(Math.max(low,high)+radius>=.2&&Math.min(low,high)-radius<=1.75)
          blockers.push({id:'surface_pipe_'+pipe.id+'_'+i,objectId:pipe.id,modelRef:'authored-process-pipe',x:a.x,z:a.z,round:true,halfX:radius,halfZ:radius});
        continue;
      }
      let t0=0,t1=1;
      for(const [bound,above] of [[.2-radius,true],[1.75+radius,false]]) {
        const delta=high-low;
        if(Math.abs(delta)<1e-7){if(above?low<bound:low>bound){t1=-1;break;}continue;}
        const t=(bound-low)/delta;
        if(above===(delta>0))t0=Math.max(t0,t);else t1=Math.min(t1,t);
      }
      t0=Math.max(0,t0);t1=Math.min(1,t1);if(t1<t0)continue;
      blockers.push({id:'surface_pipe_'+pipe.id+'_'+i,objectId:pipe.id,modelRef:'authored-process-pipe',x:a.x+dx*(t0+t1)/2,z:a.z+dz*(t0+t1)/2,halfX:length*(t1-t0)/2+radius,halfZ:radius,rotationY:Math.atan2(dz,dx)});
    }
    for(const [i,s] of (pipe.supports||[]).entries())if(s.h-s.g>.2)
      blockers.push({id:'surface_support_'+pipe.id+'_'+i,objectId:pipe.id,modelRef:'authored-pipe-support',x:s.x,z:s.z,halfX:.09,halfZ:.09,rotationY:0});
  }
  // Planned piers and locked service entrances have the same XZ footprint
  // as their physical Unity geometry. Service gates close both the freight
  // floor and the public surface above it, so the 2D authority is unambiguous.
  for(const support of profile.railSupports||[])if(support.h-support.g>1)
    blockers.push({id:support.id,objectId:support.id,modelRef:'authored-rail-pier',x:support.x,z:support.z,halfX:support.halfLength,halfZ:support.halfWidth,rotationY:support.rotationY});
  for(const barrier of profile.railBarriers||[])
    blockers.push({id:barrier.id,objectId:barrier.id,modelRef:'authored-rail-service-gate',x:barrier.x,z:barrier.z,halfX:barrier.halfLength,halfZ:barrier.halfWidth,rotationY:barrier.rotationY});
  for(const wall of bankWalls||[])for(let i=1;i<wall.points.length;i++) {
    const a=wall.points[i-1],b=wall.points[i];
    const polygon=[{x:a.x,z:a.z},{x:b.x,z:b.z},{x:b.outerX,z:b.outerZ},{x:a.outerX,z:a.outerZ}];
    const minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x));
    const minZ=Math.min(...polygon.map(p=>p.z)),maxZ=Math.max(...polygon.map(p=>p.z));
    blockers.push({id:'surface_retaining_'+wall.id+'_'+i,objectId:wall.id,modelRef:'authored-road-retaining-wall',
      x:(minX+maxX)/2,z:(minZ+maxZ)/2,halfX:(maxX-minX)/2,halfZ:(maxZ-minZ)/2,polygon});
  }
  for(const [footIndex,foot] of (profile.hasRoadBankContactFootings?footings:[]).entries()){
    if(!Array.isArray(foot.points)||foot.points.length<2)
      throw Error('Empty retaining footing '+profile.zoneId+' '+foot.id);
    for(let i=1;i<foot.points.length;i++){
    const a=foot.points[i-1],b=foot.points[i];
    if(![a.top,a.outerTop,a.bottom,b.top,b.outerTop,b.bottom].every(Number.isFinite)
        ||a.top<=a.bottom||a.outerTop<=a.bottom||b.top<=b.bottom||b.outerTop<=b.bottom)
      throw Error('Invalid retaining footing volume '+profile.zoneId+' '+foot.id);
    for(const [point,wallPoint] of [[a,bankWalls[footIndex].points[i-1]],[b,bankWalls[footIndex].points[i]]]){
      const width=Math.hypot(point.outerX-point.x,point.outerZ-point.z);
      if(width<.399||width>.401||Math.abs(wallPoint.outerX-point.x)>=.0001
        ||Math.abs(wallPoint.outerZ-point.z)>=.0001
        ||point.top>wallPoint.top-.249||point.bottom>wallPoint.bottom)
        throw Error('Detached retaining footing '+profile.zoneId+' '+foot.id);
    }
    const polygon=[{x:a.x,z:a.z},{x:b.x,z:b.z},{x:b.outerX,z:b.outerZ},{x:a.outerX,z:a.outerZ}];
    const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
    const turns=polygon.map((point,j)=>cross(point,polygon[(j+1)%4],polygon[(j+2)%4]));
    if(turns.some(value=>Math.abs(value)<=1e-7||Math.sign(value)!==Math.sign(turns[0])))
      throw Error('Folded retaining footing '+profile.zoneId+' '+foot.id);
    const minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x));
    const minZ=Math.min(...polygon.map(p=>p.z)),maxZ=Math.max(...polygon.map(p=>p.z));
    blockers.push({id:'surface_retaining_footing_'+foot.id+'_'+i,objectId:foot.id,
      modelRef:'authored-road-retaining-footing',x:(minX+maxX)/2,z:(minZ+maxZ)/2,
      halfX:(maxX-minX)/2,halfZ:(maxZ-minZ)/2,polygon});
    }
  }
  if(meshes?.length)for(let i=0;i<meshes.length;i++)blockers.push(...validateBridgeBankRevetment(profile,revetments[i],meshes[i]));
  cache.set(profile,{source:profile.processPipes,supports:profile.railSupports,
    barriers:profile.railBarriers,bankWalls,footings,revetments,meshes,blockers});return blockers;
}
const bankFloat=Math.fround,bankFields=['minX','maxX','minZ','maxZ','thickness','cover','toeEmbed','minSlope','minLift','roadMargin','protectionMargin'];
const bankCross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const bankVertexKey=v=>[bankFloat(v.x),bankFloat(v.h),bankFloat(v.z)].join(',');
function bankRevetmentRecipe(profile,row){
 if(!row||typeof row.id!=='string'||!row.id||typeof row.bridge!=='string'||!['a','b'].includes(row.end)
   ||row.association!=='native-wet-connected-fill'
   ||Object.keys(row).some(k=>!['zone','id','bridge','end','association',...bankFields].includes(k))
   ||!bankFields.every(k=>Number.isFinite(row[k]))||row.minX>=row.maxX||row.minZ>=row.maxZ
   ||row.minX<-profile.width/2||row.maxX>profile.width/2||row.minZ<-profile.depth/2||row.maxZ>profile.depth/2
   ||row.thickness!==.5||row.cover!==.025||row.toeEmbed!==.25||row.minSlope<1||row.minLift<.5
   ||row.roadMargin!==.73||row.protectionMargin!==.5
   ||!profile.bridges?.some(b=>b.id===row.bridge))throw Error('Invalid bridge bank revetment '+profile.zoneId);
 return Object.fromEntries(['id','bridge','end','association',...bankFields].map(k=>[k,row[k]]));
}
function bankWriter(){const rows=[];return{string(s){const b=Buffer.from(s,'utf8');this.int(b.length);rows.push(b);},int(n){const b=Buffer.alloc(4);b.writeInt32LE(n);rows.push(b);},float(n){const b=Buffer.alloc(4);b.writeFloatLE(n);rows.push(b);},hash(){return crypto.createHash('sha256').update(Buffer.concat(rows)).digest('hex');}};}
function bankRoutes(p){return [...(p.bridges||[]).map(r=>({role:'bridge',r})),...(p.roads||[]).filter(r=>!r.blocked&&['road','track'].includes(r.type)).map(r=>({role:'road',r}))]
 .sort((a,b)=>(a.role+':'+a.r.id)<(b.role+':'+b.r.id)?-1:(a.role+':'+a.r.id)>(b.role+':'+b.r.id)?1:0);}
function bankRevetmentSourceHash(p,c){const w=bankWriter();w.string('roa.bridgeBankRevetment.v4');w.string(p.zoneId);w.string(p.groundLattice?.profileGeometryHash||'');
 for(const k of ['id','bridge','end','association'])w.string(c[k]);for(const k of bankFields)w.float(c[k]);const routes=bankRoutes(p);w.int(routes.length);
 for(const {role,r} of routes){w.string(role);w.string(r.id);w.float(r.halfWidth);const pts=r.points?.length?r.points:[r.a,r.b];w.int(pts.length);for(const q of pts){w.float(q.x);w.float(q.z);}}return w.hash();}
function bankRevetmentGeometryHash(m){const w=bankWriter();w.string(m.sourceHash);w.int(m.vertices.length);for(const p of m.vertices){w.float(p.x);w.float(p.h);w.float(p.z);}
 for(const rows of [m.indices,m.prisms]){w.int(rows.length);for(const n of rows)w.int(n);}return w.hash();}
function bankHull(points){const a=[...new Map(points.map(p=>[[p.x,p.z].join(','),{x:p.x,z:p.z}])).values()].sort((a,b)=>a.x-b.x||a.z-b.z);if(a.length<3)return a;
 const low=[],high=[];for(const p of a){while(low.length>1&&bankCross(low.at(-2),low.at(-1),p)<=0)low.pop();low.push(p);}for(const p of a.slice().reverse()){while(high.length>1&&bankCross(high.at(-2),high.at(-1),p)<=0)high.pop();high.push(p);}return low.slice(0,-1).concat(high.slice(0,-1));}
function bankInside(p,poly){return poly.length>2&&poly.every((q,i)=>bankCross(q,poly[(i+1)%poly.length],p)>=-1e-8);}
function bankPointSegment(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function bankSegmentDistance(a,b,c,d){const a1=bankCross(a,b,c),a2=bankCross(a,b,d),b1=bankCross(c,d,a),b2=bankCross(c,d,b);
 if(a1*a2<0&&b1*b2<0)return 0;return Math.min(bankPointSegment(a,c,d),bankPointSegment(b,c,d),bankPointSegment(c,a,b),bankPointSegment(d,a,b));}
function protectedBankSegments(p,c){const segments=[];for(const {role,r} of bankRoutes(p)){const pts=r.points?.length?r.points:[r.a,r.b];for(let i=1;i<pts.length;i++){
  const a={x:bankFloat(pts[i-1].x),z:bankFloat(pts[i-1].z)},b={x:bankFloat(pts[i].x),z:bankFloat(pts[i].z)},dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<1e-8)continue;
  const radius=bankFloat(r.halfWidth)+(role==='road'?bankFloat(c.roadMargin):0)+c.protectionMargin;
  if(role==='road')segments.push({role,a,b,radius});else{const tx=dx/length,tz=dz/length,nx=-tz,nz=tx;
   segments.push({role,polygon:bankHull([{x:a.x-tx*c.protectionMargin+nx*radius,z:a.z-tz*c.protectionMargin+nz*radius},{x:b.x+tx*c.protectionMargin+nx*radius,z:b.z+tz*c.protectionMargin+nz*radius},{x:b.x+tx*c.protectionMargin-nx*radius,z:b.z+tz*c.protectionMargin-nz*radius},{x:a.x-tx*c.protectionMargin-nx*radius,z:a.z-tz*c.protectionMargin-nz*radius}].map(q=>({x:bankFloat(q.x),z:bankFloat(q.z)})))});}
 }}return segments;}
function bankPrismProtected(poly,segments){for(const s of segments){if(s.role==='road'){
  if(bankInside(s.a,poly)||bankInside(s.b,poly))return true;for(let i=0;i<poly.length;i++)if(bankSegmentDistance(poly[i],poly[(i+1)%poly.length],s.a,s.b)<=s.radius+1e-6)return true;
 }else{if(poly.some(q=>bankInside(q,s.polygon))||s.polygon.some(q=>bankInside(q,poly)))return true;for(let i=0;i<poly.length;i++)for(let j=0;j<s.polygon.length;j++)if(bankSegmentDistance(poly[i],poly[(i+1)%poly.length],s.polygon[j],s.polygon[(j+1)%s.polygon.length])<1e-7)return true;}}
 return false;}
function bankEdges(tris){const edges=new Map();for(const t of tris)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=a<b?a+':'+b:b+':'+a;if(!edges.has(k))edges.set(k,{a,b,count:0});edges.get(k).count++;}return edges;}
function splitBankFans(source,tris){const count=source.length,byVertex=Array.from({length:count},()=>[]);for(let t=0;t<tris.length;t++)for(const v of tris[t])byVertex[v].push(t);for(let v=0;v<count;v++){const pending=new Set(byVertex[v]);let first=true;
 while(pending.size){const group=[pending.values().next().value];pending.delete(group[0]);for(let i=0;i<group.length;i++)for(const t of [...pending])if(tris[t].some(q=>q!==v&&tris[group[i]].includes(q))){pending.delete(t);group.push(t);}
  if(first){first=false;continue;}const next=source.push({...source[v]})-1;for(const t of group)tris[t]=tris[t].map(i=>i===v?next:i);
 }}}
// Membership follows shared complete indexed edges, never point contact.
function bankComponents(tris){
 const edges=new Map(),adjacent=tris.map(()=>[]);
 for(let f=0;f<tris.length;f++)for(let j=0;j<3;j++){const a=tris[f][j],b=tris[f][(j+1)%3],key=a<b?a+':'+b:b+':'+a;
  if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(f);}
 for(const e of edges.values()){if(e.faces.length>2)throw Error('Non-manifold bank source');if(e.faces.length===2){adjacent[e.faces[0]].push(e.faces[1]);adjacent[e.faces[1]].push(e.faces[0]);}}
 const groups=[],seen=new Set();for(let f=0;f<tris.length;f++)if(!seen.has(f)){const faces=[f];seen.add(f);
  for(let i=0;i<faces.length;i++)for(const n of adjacent[faces[i]])if(!seen.has(n)){seen.add(n);faces.push(n);}
  const set=new Set(faces),boundary=[...edges.values()].filter(e=>e.faces.length===1&&set.has(e.faces[0]));groups.push({faces,boundary});}
 return groups;
}
function bankWetGroups(source,tris,c,{ground,nativeWater}){
 if(typeof ground!=='function'||typeof nativeWater!=='function')throw Error('Missing native wet association support');
 return bankComponents(tris).map(group=>{let witnesses=0;const visited=new Set();for(const edge of group.boundary)for(const i of [edge.a,edge.b])if(!visited.has(i)){
  visited.add(i);const q=source[i],z=bankFloat(q.z+bankFloat(c.cover)),wet=nativeWater(q.x,z),sourceGround=ground(q.x,q.z),outerGround=ground(q.x,z);
  if(!wet||typeof wet.inside!=='boolean'||!Number.isFinite(wet.height)||!Number.isFinite(sourceGround)||!Number.isFinite(outerGround))throw Error('Invalid native wet association support');
  // The existing toe band identifies the lower bank. The outer face must
  // actually meet native water over the indexed saved soil, within the same
  // 1.5mm support precision already required by the native crown/toe guard.
  if(wet.inside&&sourceGround<=bankFloat(wet.height)+.5&&outerGround<=bankFloat(wet.height)+.0015)witnesses++;
 }return {...group,witnesses};});
}
function bankIndexedSupport(p){
 const lattice=require('./sector-ground-lattice'),mesh=require('./sector-mesh-patches');
 if(!lattice.active(p))throw Error('Missing indexed native wet association '+p.zoneId);
 const missing=()=>{throw Error('Missing canonical bank lattice '+p.zoneId);};
 const raw={...p,foundations:[],corridors:[],roads:[],bridges:[]},field=require('../../data/kromka/sector-surfaces.json').relief;
 return {natural:(x,z)=>require('./sector-surface').groundHeight(raw,field,x,z,false)-.05*p.gain/160,nativeWater:(x,z)=>waterAt(p,x,z),ground:(x,z)=>{const hit=mesh.sample(p,x,z,missing);
  if(!hit?.strict||!Number.isFinite(hit.height))throw Error('Unsupported native bank association '+p.zoneId);return hit.height;}};
}
// The lift threshold identifies engineered seeds. Only their original
// native-wet edge components may acquire adjacent lower-lift toe triangles.
// Each acquired face stays in the native polygon/wet toe band. Its edge path
// reaches the retained seed component, whose actual wet contact remains strict.
// Acquired faces retain positive
// fill over the natural substrate, and pass the same bounds/slope/protection.
function bankRetainSeededWetToe(selected,continuation,c,support){
 const source=[],map=new Map(),index=t=>t.map(q=>{const k=bankVertexKey(q);if(!map.has(k)){map.set(k,source.length);source.push(q);}return map.get(k);});
 const seedTris=selected.map(index),groups=bankWetGroups(source,seedTris,c,support),keep=new Set(groups.filter(g=>g.witnesses>0).flatMap(g=>g.faces));
 const association={candidateComponents:groups.length,keptComponents:groups.filter(g=>g.witnesses>0).length,
  excludedComponents:groups.filter(g=>g.witnesses===0).length,candidateFaces:seedTris.length,excludedFaces:seedTris.length-keep.size};
 if(!keep.size)throw Error('No native-wet-connected engineered seed');
 const all=[...selected,...continuation],tris=[...seedTris,...continuation.map(index)],adjacent=tris.map(()=>[]);
 for(const e of bankComponentsEdges(tris).values())if(e.faces.length===2){adjacent[e.faces[0]].push(e.faces[1]);adjacent[e.faces[1]].push(e.faces[0]);}
 const queue=[...keep];for(let k=0;k<queue.length;k++)for(const n of adjacent[queue[k]])
  if(n>=selected.length&&!keep.has(n)){keep.add(n);queue.push(n);}
 return{triangles:all.filter((t,i)=>keep.has(i)),association,addedFaces:keep.size-queue.filter(i=>i<selected.length).length,eligibleContinuationFaces:continuation.length};
}
function bankComponentsEdges(tris){const edges=new Map();for(let f=0;f<tris.length;f++)for(let j=0;j<3;j++){
 const a=tris[f][j],b=tris[f][(j+1)%3],key=a<b?a+':'+b:b+':'+a;if(!edges.has(key))edges.set(key,{faces:[]});edges.get(key).faces.push(f);}
 if([...edges.values()].some(e=>e.faces.length>2))throw Error('Non-manifold wet toe continuation');return edges;
}
function bankTriangleNativeWetBand(t,c,{ground,nativeWater}){
 return t.some(q=>{const z=bankFloat(q.z+bankFloat(c.cover)),w=nativeWater(q.x,z);
  if(!w||typeof w.inside!=='boolean'||!Number.isFinite(w.height))throw Error('Invalid native toe continuation support');
  return w.inside&&q.h<=bankFloat(w.height)+.5;});
}
// Split on the proven flat Float32 native water plane. Shared indexed edges
// use a canonical cache, including reversed edge visits. No exposed front
// plane may be pulled into the soil by the embedded underwater toe.
function bankSplitNativeWetline(selected,nativeWater,c){
 if(typeof nativeWater!=='function')throw Error('Missing native bank wetline');
 const levels=new Set(selected.flatMap(t=>t.map(q=>{
  const w=nativeWater(q.x,bankFloat(q.z+bankFloat(c.cover)));
  if(!w||!Number.isFinite(w.height))throw Error('Missing native bank water plane');return bankFloat(w.height);
 })));
 if(levels.size!==1)throw Error('Non-flat native bank water plane');
 const level=[...levels][0],cache=new Map();
 const pin=q=>Math.abs(q.h-level)<=.0015?{...q,h:level}:q;
 const cut=(a,b)=>{
  if(bankVertexKey(a)>bankVertexKey(b))[a,b]=[b,a];
  const key=bankVertexKey(a)+'|'+bankVertexKey(b);if(cache.has(key))return cache.get(key);
  const t=(level-a.h)/(b.h-a.h),q={x:bankFloat(a.x+t*(b.x-a.x)),z:bankFloat(a.z+t*(b.z-a.z)),h:level};
  if(bankFloat(nativeWater(q.x,bankFloat(q.z+bankFloat(c.cover))).height)!==level)throw Error('Non-flat native bank water intersection');
  cache.set(key,q);return q;
 };
 const clip=(poly,upper)=>{
  const out=[];for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],inside=upper?a.h>=level:a.h<=level,next=upper?b.h>=level:b.h<=level;
   if(inside)out.push(a);if(inside!==next)out.push(cut(a,b));
  }
  const unique=out.filter((q,i)=>!i||bankVertexKey(q)!==bankVertexKey(out[i-1]));
  if(unique.length>1&&bankVertexKey(unique[0])===bankVertexKey(unique.at(-1)))unique.pop();return unique;
 };
 const out=[];for(const original of selected){const t=original.map(pin);
  if(t.every(q=>q.h>=level)||t.every(q=>q.h<=level)){out.push(t);continue;}
  for(const poly of [clip(t,true),clip(t,false)])for(let i=1;i+1<poly.length;i++)out.push([poly[0],poly[i],poly[i+1]]);
 }
 return out;
}
// Whole triangles retain the actual indexed soil plane. No independent normal
// offset or per-triangle caps can introduce cracks along an interior seam.
function buildBridgeBankRevetment(p,c,triangles,{natural,ground,waterHeight,water,nativeWater}){
 c=bankRevetmentRecipe(p,c);if(typeof natural!=='function'||typeof ground!=='function'||typeof water!=='function'&&!Number.isFinite(waterHeight))throw Error('Missing indexed revetment support');
 const waterHeightAt=typeof water==='function'?water:()=>waterHeight;
 const segments=protectedBankSegments(p,c),selected=[],continuation=[],stats={tested:0,steep:0,protected:0,maxRejectedTriangleDiameter:0};
 for(const input of triangles){const t=input.map(q=>({x:bankFloat(q.x),z:bankFloat(q.z),h:bankFloat(q.h)}));if(!t.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.z)&&Number.isFinite(q.h)))throw Error('Invalid indexed bank triangle');
  if(t.some(q=>q.x<c.minX||q.x>c.maxX||q.z<c.minZ||q.z>c.maxZ))continue;stats.tested++;
  const [a,b,d]=t,den=bankCross(a,b,d);if(Math.abs(den)<1e-10)continue;
  const hz=((b.x-a.x)*(d.h-a.h)-(d.x-a.x)*(b.h-a.h))/den;
  if(-hz<c.minSlope)continue;const x=(a.x+b.x+d.x)/3,z=(a.z+b.z+d.z)/3,h=(a.h+b.h+d.h)/3;
  const localWater=waterHeightAt(x,z);if(!Number.isFinite(localWater))throw Error('Missing revetment water support');
  const lift=h-natural(x,z);if(!Number.isFinite(lift))throw Error('Missing natural bank seed support');
  if(lift<=.0015||Math.max(...t.map(v=>v.h))<localWater-.5)continue;stats.steep++;
  const poly=bankHull(t.flatMap(q=>[{x:q.x,z:bankFloat(q.z+c.cover)},{x:q.x,z:bankFloat(q.z+c.cover-c.thickness)}]));
  if(bankPrismProtected(poly,segments)){stats.protected++;stats.maxRejectedTriangleDiameter=Math.max(stats.maxRejectedTriangleDiameter,...t.map((q,i)=>Math.hypot(q.x-t[(i+1)%3].x,q.z-t[(i+1)%3].z)));continue;}
  // Upward winding gives outward front normals toward the descending +Z face.
  const oriented=den<0?t:[a,d,b];if(lift>=c.minLift)selected.push(oriented);
  else if(bankTriangleNativeWetBand(oriented,c,{ground,nativeWater}))continuation.push(oriented);
 }
 if(!selected.length)throw Error('Empty bridge bank revetment '+p.zoneId+' '+c.id);
 const retained=bankRetainSeededWetToe(selected,continuation,c,{ground,nativeWater});stats.association=retained.association;
 stats.continuation={eligibleFaces:retained.eligibleContinuationFaces,addedFaces:retained.addedFaces};
 selected.splice(0,selected.length,...bankSplitNativeWetline(retained.triangles,nativeWater,c));
 const source=[],map=new Map(),tris=selected.map(t=>t.map(q=>{const k=bankVertexKey(q);if(!map.has(k)){map.set(k,source.length);source.push(q);}return map.get(k);}));
 splitBankFans(source,tris);const edges=bankEdges(tris);
 for(const edge of edges.values()){if(edge.count>2)throw Error('Non-manifold bank source');if(edge.count!==1)continue;
  for(const i of [edge.a,edge.b]){const q=source[i],localWater=waterHeightAt(q.x,q.z);if(!Number.isFinite(localWater))throw Error('Missing revetment toe water');const wet=nativeWater(q.x,bankFloat(q.z+bankFloat(c.cover)));if(wet.inside&&q.h<bankFloat(wet.height)-.0015&&q.h<bankFloat(localWater)-.0015)q.toe=Math.min(q.toe??Infinity,Math.min(q.h,ground(q.x,bankFloat(q.z+c.cover)))-c.toeEmbed);}}
 const vertices=source.flatMap(q=>{const h=bankFloat(q.toe??q.h);return [{x:q.x,z:bankFloat(q.z+c.cover),h},{x:q.x,z:bankFloat(q.z+c.cover-c.thickness),h}];}),indices=[],prisms=[];
 for(const t of tris){const [a,b,d]=t.map(i=>2*i);indices.push(a,b,d,a+1,d+1,b+1);prisms.push(a,b,d,a+1,b+1,d+1);}
 for(const e of edges.values())if(e.count===1){const a=2*e.a,b=2*e.b;indices.push(a,a+1,b,b,a+1,b+1);}
 const m={id:c.id,sourceHash:bankRevetmentSourceHash(p,c),vertices,indices,prisms};m.geometryHash=bankRevetmentGeometryHash(m);validateBridgeBankRevetment(p,c,m,{ground,nativeWater,natural});return {mesh:m,stats:{...stats,faces:tris.length,boundaryEdges:[...edges.values()].filter(e=>e.count===1).length,internalEdges:[...edges.values()].filter(e=>e.count===2).length,toeVertices:source.filter(q=>q.toe!==undefined).length}};
}
function validateBridgeBankRevetment(p,c,m,support){bankRevetmentRecipe(p,c);if(!m||Object.keys(m).some(k=>!['id','sourceHash','geometryHash','vertices','indices','prisms'].includes(k))||m.id!==c.id||m.sourceHash!==bankRevetmentSourceHash(p,c)||!Array.isArray(m.vertices)||!m.vertices.length||!Array.isArray(m.indices)||!m.indices.length||m.indices.length%3||!Array.isArray(m.prisms)||!m.prisms.length||m.prisms.length%6||m.geometryHash!==bankRevetmentGeometryHash(m))throw Error('Stale bridge bank revetment '+p.zoneId);
 if(m.vertices.some(q=>!['x','z','h'].every(k=>Number.isFinite(q[k])&&bankFloat(q[k])===q[k]))||[...m.indices,...m.prisms].some(i=>!Number.isInteger(i)||i<0||i>=m.vertices.length))throw Error('Invalid bank mesh index/vertex');
 const triangles=[];for(let i=0;i<m.indices.length;i+=3){const t=m.indices.slice(i,i+3),[a,b,d]=t.map(j=>m.vertices[j]);const ux=b.x-a.x,uy=b.h-a.h,uz=b.z-a.z,vx=d.x-a.x,vy=d.h-a.h,vz=d.z-a.z;if(Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)<1e-10)throw Error('Degenerate bank face');triangles.push(t);}
 const edges=bankEdges(triangles);if([...edges.values()].some(e=>e.count!==2))throw Error('Open bank volume');
 const segments=protectedBankSegments(p,c),blocks=[],front=[],expected=[];for(let i=0;i<m.prisms.length;i+=6){const ids=m.prisms.slice(i,i+6),v=ids.map(ix=>m.vertices[ix]);for(let j=0;j<3;j++)if(v[j].x!==v[j+3].x||v[j].h!==v[j+3].h||ids[j]+1!==ids[j+3]||ids[j]%2!==0||Math.abs(v[j].z-v[j+3].z-c.thickness)>3e-5)throw Error('Altered bank thickness');
  if(bankCross(v[0],v[1],v[2])>=-1e-10)throw Error('Inverted bank prism');front.push(ids.slice(0,3));expected.push(ids[0],ids[1],ids[2],ids[3],ids[5],ids[4]);
  const poly=bankHull(v);if(poly.length<3||bankPrismProtected(poly,segments))throw Error('Bank intrusion into protected route');const minX=Math.min(...poly.map(q=>q.x)),maxX=Math.max(...poly.map(q=>q.x)),minZ=Math.min(...poly.map(q=>q.z)),maxZ=Math.max(...poly.map(q=>q.z));
  blocks.push({id:'surface_bank_revetment_'+m.id+'_'+i/6,objectId:m.id,modelRef:'authored-bridge-bank-revetment',x:(minX+maxX)/2,z:(minZ+maxZ)/2,halfX:(maxX-minX)/2,halfZ:(maxZ-minZ)/2,polygon:poly});}
 for(const e of bankEdges(front).values())if(e.count===1)expected.push(e.a,e.a+1,e.b,e.b,e.a+1,e.b+1);else if(e.count!==2)throw Error('Non-manifold bank source');
 if(expected.length!==m.indices.length||expected.some((v,i)=>v!==m.indices[i])||new Set(m.prisms).size!==m.vertices.length)throw Error('Bank render/collider/server volume mismatch');
 const indexed=support||bankIndexedSupport(p),source=m.vertices.map(q=>({x:q.x,z:bankFloat(q.z-bankFloat(c.cover))}));
 const groups=bankWetGroups(source,front,c,indexed);if(groups.some(g=>g.witnesses===0))throw Error('Detached non-wet bank component '+p.zoneId);
 if(typeof indexed.natural!=='function')throw Error('Missing natural bank seed support');
 for(const g of groups){let raised=false;for(const f of g.faces){const t=front[f].map(i=>source[i]),x=t.reduce((s,q)=>s+q.x,0)/3,z=t.reduce((s,q)=>s+q.z,0)/3,
  lift=indexed.ground(x,z)-indexed.natural(x,z);if(!Number.isFinite(lift))throw Error('Invalid natural bank seed support');if(lift>=c.minLift){raised=true;break;}}
  if(!raised)throw Error('Native wet bank component lacks engineered seed');}

 for(let i=0;i<m.vertices.length;i+=2){const q=m.vertices[i],at=source[i],sourceGround=indexed.ground(at.x,at.z),outerGround=indexed.ground(q.x,q.z);
  if(q.h>sourceGround+.0015)throw Error('Floating bank crown');
  if(q.h<sourceGround-.0015){const wet=indexed.nativeWater(q.x,q.z),expectedToe=Math.min(sourceGround,outerGround)-c.toeEmbed;
   if(!wet.inside||sourceGround>=bankFloat(wet.height)-.0015||Math.abs(q.h-expectedToe)>.0015)throw Error('Detached bank toe');}
 }
 for(const t of front){if(t.some(i=>m.vertices[i].h<indexed.ground(source[i].x,source[i].z)-.0015)
  &&t.some(i=>m.vertices[i].h>bankFloat(indexed.nativeWater(m.vertices[i].x,m.vertices[i].z).height)+.0015))throw Error('Exposed bank front deformation');}

 return blocks;
}
module.exports={utilityBlockers,bankRevetmentRecipe,bankRevetmentSourceHash,bankRevetmentGeometryHash,buildBridgeBankRevetment,validateBridgeBankRevetment};
