'use strict';
// Guarded production draft. Derives a closed physical shoreline from retained
// native-water fans over the indexed ground. Does not change analytic Height.
const {groundHeight,waterAt}=require('../../src/server/sector-surface');
const surface=require('../../src/server/sector-mesh-patches');
const groundLattice=require('../../src/server/sector-ground-lattice');
const {buildActualWetContour}=require('./sector-wet-contour');
const cross=(a,b,q)=>(b.x-a.x)*(q.z-a.z)-(b.z-a.z)*(q.x-a.x);
const nodeKey=q=>`${Math.round(q.x*1e4)},${Math.round(q.z*1e4)}`;
function clip(poly,fn){const out=[];for(let i=0;i<poly.length;i++){
 const a=poly[i],b=poly[(i+1)%poly.length],da=fn(a),db=fn(b);
 if(da>=0)out.push(a);
 if((da<0)!=(db<0)){const t=da/(da-db);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,
   y:a.y+(b.y-a.y)*t,g:a.g+(b.g-a.g)*t});}
 }return out;}
function groundPlane(t,x,z){const [a,b,c]=t,den=cross(a,b,c),u=cross({x,z},b,c)/den,v=cross(a,{x,z},c)/den;
 return u*a.h+v*b.h+(1-u-v)*c.h;}
function makeGroundVertex(p,field){const n=p.terrainSegments||128,step=p.width/n,cache=new Map();
 return (ix,iz)=>{const id=ix+iz*(n+1);if(cache.has(id))return cache.get(id);
   if(groundLattice.active(p)){const v=groundLattice.regularVertex(p,ix,iz);cache.set(id,v);return v;}
   const z=(iz/n-.5)*p.depth;let x=(ix/n-.5)*p.width;
   if(ix>0&&ix<n){let closest=step/2,rows=Math.abs(Math.abs(z)-p.depth/2)<.0001?p.waterEdges:p.visibleShore;
     for(const e of rows||[]){if(Math.abs(e.b.z-e.a.z)<1e-6||z<Math.min(e.a.z,e.b.z)-.0001||z>Math.max(e.a.z,e.b.z)+.0001)continue;
       const bx=e.a.x+(e.b.x-e.a.x)*(z-e.a.z)/(e.b.z-e.a.z),d=Math.abs(bx-x);if(d<closest){closest=d;x=bx}}}
   const v={x:Math.fround(x),z:Math.fround(z),h:Math.fround(groundHeight(p,field,x,z,false)-.05*p.gain/160)};cache.set(id,v);return v;};
}
function retainedWaterTriangles(p,field,vertex){
 const triangles=[];let culled=0,culledArea=0;
 for(let wi=0;wi<p.waterIndices.length;wi+=3){
   const wt=p.waterIndices.slice(wi,wi+3).map(id=>{const q=p.waterVertices[id];return{x:Math.fround(q.x),z:Math.fround(q.z),y:Math.fround(q.h??q.y)};});
   const wSign=Math.sign(cross(...wt));if(!wSign)continue;
   const gtRows=surface.groundTrianglesInBox(p,Math.min(...wt.map(v=>v.x)),Math.min(...wt.map(v=>v.z)),
     Math.max(...wt.map(v=>v.x)),Math.max(...wt.map(v=>v.z)),vertex);
   for(const gt of gtRows){const gSign=Math.sign(cross(...gt));if(!gSign)continue;
     let poly=wt.map(v=>({...v,g:groundPlane(gt,v.x,v.z)}));
     for(let j=0;j<3&&poly.length>=3;j++){
       const a=gt[j],b=gt[(j+1)%3],dx=b.x-a.x,dz=b.z-a.z;
       poly=clip(poly,v=>(dx*(v.z-a.z)-dz*(v.x-a.x))*gSign);
       for(const v of poly)v.g=groundPlane(gt,v.x,v.z);
     }
     if(poly.length<3)continue;
     poly=clip(poly,v=>v.y-v.g);if(poly.length<3)continue;
     for(let k=1;k+1<poly.length;k++){
       const t=[poly[0],poly[k],poly[k+1]].map(v=>({x:Math.fround(v.x),z:Math.fround(v.z),y:Math.fround(v.y)})),twice=Math.abs(cross(...t));
       if(twice<1e-7){culled++;culledArea+=twice/2;continue}
       triangles.push(t);
     }
   }
 }
 return{triangles,culled,culledArea};
}
function floatUlp(value){const f=Math.fround(Math.abs(value));if(f===0)return 1.401298464324817e-45;
 const bits=new DataView(new ArrayBuffer(4));bits.setFloat32(0,f,true);
 bits.setUint32(0,bits.getUint32(0,true)+1,true);return bits.getFloat32(0,true)-f;}
function retainedAreaIndex(triangles,p,vertex){const cell=2,cells=new Map(),boundaryCounts=new Map(),boundaryRows=new Map();
 for(let i=0;i<(p.waterIndices||[]).length;i+=3)for(let j=0;j<3;j++){
   const a=p.waterVertices[p.waterIndices[i+j]],b=p.waterVertices[p.waterIndices[i+(j+1)%3]],
     ak=nodeKey(a),bk=nodeKey(b),key=ak<bk?ak+'|'+bk:bk+'|'+ak;
   boundaryCounts.set(key,(boundaryCounts.get(key)||0)+1);boundaryRows.set(key,{a,b});
 }
 const nativeBoundary=[...boundaryRows].filter(([key])=>boundaryCounts.get(key)===1).map(([,row])=>row);
 for(let id=0;id<triangles.length;id++){
   const t=triangles[id],xmin=Math.min(...t.map(v=>v.x)),xmax=Math.max(...t.map(v=>v.x)),
     zmin=Math.min(...t.map(v=>v.z)),zmax=Math.max(...t.map(v=>v.z));
   for(let x=Math.floor((xmin-.1)/cell);x<=Math.floor((xmax+.1)/cell);x++)
     for(let z=Math.floor((zmin-.1)/cell);z<=Math.floor((zmax+.1)/cell);z++){
       const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(id);
     }
 }
 function wetPoint(x,z){for(const id of cells.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)||[]){
   const t=triangles[id];if(t.every(v=>v.x>x+.00002)||t.every(v=>v.x<x-.00002)||
     t.every(v=>v.z>z+.00002)||t.every(v=>v.z<z-.00002))continue;
   const sign=Math.sign(cross(...t));if(!sign)continue;let inside=true;
   for(let j=0;j<3;j++)if(sign*cross(t[j],t[(j+1)%3],{x,z}) < 0){inside=false;break}
   if(inside)return true;
 }return false;}
 function intervals(q,n){const out=[],ids=cells.get(`${Math.floor(q.x/cell)},${Math.floor(q.z/cell)}`)||[];
   for(const id of ids){const t=triangles[id],sign=Math.sign(cross(...t));if(!sign)continue;
     let lo=-.1,hi=.1;
     for(let i=0;i<3;i++){
       const a=t[i],b=t[(i+1)%3],f=sign*cross(a,b,q),d=sign*((b.x-a.x)*n.z-(b.z-a.z)*n.x);
       if(Math.abs(d)<1e-15){if(f<0){lo=1;break}continue}
       const root=-f/d;if(d>0)lo=Math.max(lo,root);else hi=Math.min(hi,root);
       if(lo>=hi)break;
     }
     if(hi-lo>1e-12)out.push({lo,hi});
   }
   out.sort((a,b)=>a.lo-b.lo);const merged=[];
   for(const r of out){const last=merged.at(-1);if(last&&r.lo<=last.hi+1e-10)last.hi=Math.max(last.hi,r.hi);
     else merged.push({lo:r.lo,hi:r.hi});}
   return merged;
 }
 function nativeDistance(q){let distance=Infinity;
   for(const e of nativeBoundary){const a=e.a,b=e.b,dx=b.x-a.x,dz=b.z-a.z,
     t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/(dx*dx+dz*dz)));
     distance=Math.min(distance,Math.hypot(q.x-a.x-t*dx,q.z-a.z-t*dz));}
   return distance;
 }
 function cornerWitness(q,kind){
   const ids=cells.get(`${Math.floor(q.x/cell)},${Math.floor(q.z/cell)}`)||[];
   if(kind==='domainEdge'&&nativeDistance(q)>.00005)return false;
   for(const id of ids){const t=triangles[id],den=cross(...t),sign=Math.sign(den);
     if(Math.abs(den)<1e-7)continue;
     const sa=sign*cross(t[1],t[2],q),sb=sign*cross(t[2],t[0],q),sc=sign*cross(t[0],t[1],q);
     if(sa<0||sb<0||sc<0)continue;
     const cx=(t[0].x+t[1].x+t[2].x)/3,cz=(t[0].z+t[1].z+t[2].z)/3,
       distance=Math.hypot(cx-q.x,cz-q.z);
     for(const fraction of [.001,.01,.1,.5]){
       const alpha=distance>0?Math.min(fraction,.05/distance):fraction,
         w={x:q.x+(cx-q.x)*alpha,z:q.z+(cz-q.z)*alpha},
         wa=sign*cross(t[1],t[2],w),wb=sign*cross(t[2],t[0],w),wc=sign*cross(t[0],t[1],w);
       if(wa<=0||wb<=0||wc<=0)continue;
       const saved=(wa*t[0].y+wb*t[1].y+wc*t[2].y)/Math.abs(den),
         ground=surface.sample(p,w.x,w.z,vertex),native=waterAt(p,w.x,w.z);
       if(ground&&ground.height<=saved&&native.inside&&Math.abs(saved-native.height)<=.0015)return true;
     }
   }
   return false;
 }
 function nearbyWetCandidates(q,maxMove){const found=[],seen=new Set();
   const x0=Math.floor((q.x-maxMove)/cell),x1=Math.floor((q.x+maxMove)/cell),
     z0=Math.floor((q.z-maxMove)/cell),z1=Math.floor((q.z+maxMove)/cell);
   for(let ix=x0;ix<=x1;ix++)for(let iz=z0;iz<=z1;iz++)
     for(const id of cells.get(`${ix},${iz}`)||[]){if(seen.has(id))continue;seen.add(id);
       const t=triangles[id],cx=(t[0].x+t[1].x+t[2].x)/3,cz=(t[0].z+t[1].z+t[2].z)/3;
       for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],dx=b.x-a.x,dz=b.z-a.z,
         u=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/(dx*dx+dz*dz))),
         px=a.x+u*dx,pz=a.z+u*dz,distance=Math.hypot(px-q.x,pz-q.z);
         if(distance>maxMove)continue;
         for(const inward of [.000005,.00002,.0001,.0005]){
           const toward=Math.hypot(cx-px,cz-pz),alpha=Math.min(.5,inward/toward),
             x=Math.fround(px+(cx-px)*alpha),z=Math.fround(pz+(cz-pz)*alpha),
             move=Math.hypot(x-q.x,z-q.z);
           if(move<=maxMove&&wetPoint(x,z))found.push({x,z,move});
         }
       }
     }
   found.sort((a,b)=>a.move-b.move);return found;
 }
 function noAreaEdges(edges){const bad=[];
   for(let ei=0;ei<edges.length;ei++){
     const e=edges[ei],dx=Math.fround(e.b.x-e.a.x),dz=Math.fround(e.b.z-e.a.z),len=Math.hypot(dx,dz),
       normal={x:Math.fround(-dz/len),z:Math.fround(dx/len)},steps=Math.max(4,Math.ceil(len/.1));
     for(let si=0;si<=steps;si++){
       const r=Math.fround(si/steps),q={x:Math.fround(e.a.x+Math.fround(dx*r)),z:Math.fround(e.a.z+Math.fround(dz*r))},
         is=intervals(q,normal),ulp=Math.max(floatUlp(q.x),floatUlp(q.z)),allowed=Math.max(.00002,2*ulp);
       if(!is.some(v=>{const gap=v.lo>0?v.lo:v.hi<0?-v.hi:0;
         return gap<=allowed&&v.hi-v.lo>=4*ulp})&&
         !((si===0||si===steps)&&cornerWitness(q,e.kind))){
         bad.push(ei);break;
       }
     }
   }
   return bad;
 }
 return{wetPoint,noAreaEdges,intervals,cornerWitness,nearbyWetCandidates,nativeDistance};
}
function rescueDeadContactJunctions(p,field,vertex,edges,area){
 let fixed=0,maxMove=0;
 let bad=area.noAreaEdges(edges);
 const incident=new Map(),occupied=new Set();
 for(let i=0;i<edges.length;i++)for(const side of ['a','b']){
  const k=nodeKey(edges[i][side]);occupied.add(k);if(!incident.has(k))incident.set(k,[]);
  incident.get(k).push({index:i,side});
 }
 for(const [key,links] of incident){
  if(links.length!==2||!links.some(v=>bad.includes(v.index)))continue;
  const nativeJunction=links.some(v=>edges[v.index].kind==='domainEdge'),limit=nativeJunction?.002:.02;
  const source=edges[links[0].index][links[0].side];
  let replacement=null;
  const proposals=area.nearbyWetCandidates(source,limit);
  for(const distance of [.00001,.00002,.00005,.0001,.0002,.0005,.001,.002,.004,.008,.012,.02])
   for(let k=0;k<16&&distance<=limit;k++){const theta=k*Math.PI/8;
     proposals.push({x:source.x+Math.cos(theta)*distance,z:source.z+Math.sin(theta)*distance,move:distance});}
  for(const candidate of proposals){
    const x=Math.fround(candidate.x),z=Math.fround(candidate.z),distance=Math.hypot(x-source.x,z-source.z);
    // A supported Float32 point may still alias a neighbouring graph node.
    // Keep the two incident edges distinct before testing their wet support.
    const targetKey=nodeKey({x,z});if(targetKey!==key&&occupied.has(targetKey))continue;
    if(distance>limit||(nativeJunction&&area.nativeDistance({x,z})>.00005))continue;
    const w=waterAt(p,x,z),g=surface.sample(p,x,z,vertex);
    if(!w.inside||!g||Math.abs(g.height-w.height)>.03||!area.wetPoint(x,z))continue;
    const point={x,z,h:Math.fround(w.height)};
    const revised=links.map(v=>{const e={...edges[v.index],[v.side]:point},other=v.side==='a'?'b':'a';
      return {...e,[other]:{x:Math.fround((point.x+e[other].x)/2),
        z:Math.fround((point.z+e[other].z)/2),h:Math.fround((point.h+e[other].h)/2)}};});
    if(area.noAreaEdges(revised).length)continue;
    replacement=point;maxMove=Math.max(maxMove,distance);break;
  }
  if(replacement){occupied.delete(key);occupied.add(nodeKey(replacement));
   for(const link of links)edges[link.index]={...edges[link.index],[link.side]:replacement};
   fixed++;bad=area.noAreaEdges(edges);}
 }
 return {fixed,maxMove,bad};
}
function contractMicroEdges(p,field,vertex,edges,bad,wetPoint){
 const zero=new Set(bad),parent=new Map(),nodes=new Map(),incident=new Map();
 for(let i=0;i<edges.length;i++)for(const v of [edges[i].a,edges[i].b]){
   const k=nodeKey(v);if(!parent.has(k)){parent.set(k,k);nodes.set(k,[]);incident.set(k,[])}
   nodes.get(k).push(v);incident.get(k).push(i);
 }
 const root=x=>{while(parent.get(x)!==x){parent.set(x,parent.get(parent.get(x)));x=parent.get(x)}return x};
 for(const i of zero){const e=edges[i],a=root(nodeKey(e.a)),b=root(nodeKey(e.b));if(a!==b)parent.set(b,a)}
 const groups=new Map();for(const k of parent.keys()){const r=root(k);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(k)}
 const relocated=new Map(),components=[];
 function support(v){let count=0;for(let k=0;k<8;k++){
   const theta=k*Math.PI/4;if(wetPoint(v.x+Math.cos(theta)*.00001,v.z+Math.sin(theta)*.00001))count++;
 }return count;}
 for(const ks of groups.values()){
   if(ks.length===1)continue;
   const candidates=ks.flatMap(k=>nodes.get(k));
   const native=ks.filter(k=>incident.get(k).some(i=>edges[i].kind==='domainEdge'&&!zero.has(i)));
   const sources=(native.length?native:ks).flatMap(k=>nodes.get(k));
   const proposals=[...sources];
   if(!native.length)for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++)
     for(const t of [.25,.5,.75])proposals.push({x:sources[i].x+(sources[j].x-sources[i].x)*t,
       z:sources[i].z+(sources[j].z-sources[i].z)*t,h:sources[i].h+(sources[j].h-sources[i].h)*t});
   if(!native.length){const points=proposals.slice();for(const v of points)for(const offset of [.00002,.00005,.0001,.0002])
     for(let i=0;i<8;i++){const angle=i*Math.PI/4;proposals.push({x:v.x+Math.cos(angle)*offset,z:v.z+Math.sin(angle)*offset,h:v.h});}}
   const centroid={x:sources.reduce((s,v)=>s+v.x,0)/sources.length,z:sources.reduce((s,v)=>s+v.z,0)/sources.length};
   const external=[...new Set(ks.flatMap(k=>incident.get(k)))].filter(i=>!zero.has(i));
   function score(v){let max=0;for(const id of external){const e=edges[id];if(e.kind!=='contact')continue;
     const a=ks.includes(nodeKey(e.a))?v:e.a,b=ks.includes(nodeKey(e.b))?v:e.b,len=Math.hypot(a.x-b.x,a.z-b.z),steps=Math.max(2,Math.ceil(len/.05));
     for(let j=0;j<=steps;j++){const r=j/steps,x=a.x+(b.x-a.x)*r,z=a.z+(b.z-a.z)*r,g=surface.sample(p,x,z,vertex),w=waterAt(p,x,z);
       if(!g)return Infinity;max=Math.max(max,Math.abs(g.height-w.height));}
   }return max;}
   const ranked=proposals.map(v=>({v,count:support(v),gap:score(v),distance:Math.hypot(v.x-centroid.x,v.z-centroid.z)}))
     .sort((a,b)=>(a.gap<=.03&&a.count>0?0:1)-(b.gap<=.03&&b.count>0?0:1)||
       a.gap-b.gap||b.count-a.count||a.distance-b.distance);
   const point={...ranked[0].v};
   let diameter=0;for(const a of candidates)for(const b of candidates)diameter=Math.max(diameter,Math.hypot(a.x-b.x,a.z-b.z));
   if(diameter>.002)throw Error('Wet contour contraction exceeds 2 mm at '+p.zoneId);
   for(const k of ks)relocated.set(k,point);components.push({nodes:ks.length,diameter,native:!!native.length});
 }
 const result=[];for(let i=0;i<edges.length;i++){
   if(zero.has(i))continue;const e=edges[i],a=relocated.get(nodeKey(e.a))||e.a,b=relocated.get(nodeKey(e.b))||e.b;
   if(Math.hypot(a.x-b.x,a.z-b.z)<1e-5)continue;result.push({...e,a,b});
 }
 return{edges:result,components};
}
function validate(p,field,vertex,edges,area){
 const degree=new Map();for(const e of edges)for(const v of [e.a,e.b])degree.set(nodeKey(v),(degree.get(nodeKey(v))||0)+1);
 if(degree.size!==edges.length||[...degree.values()].some(d=>d!==2))throw Error('Wet retained contour is not closed: '+p.zoneId);
 if(area.noAreaEdges(edges).length)throw Error('Wet retained contour includes area-free segment: '+p.zoneId);
 const nativeCounts=new Map(),nativeRows=new Map();
 for(let i=0;i<p.waterIndices.length;i+=3)for(let j=0;j<3;j++){
   const a=p.waterVertices[p.waterIndices[i+j]],b=p.waterVertices[p.waterIndices[i+(j+1)%3]],
     ak=nodeKey(a),bk=nodeKey(b),id=ak<bk?ak+'|'+bk:bk+'|'+ak;
   nativeCounts.set(id,(nativeCounts.get(id)||0)+1);nativeRows.set(id,{a,b});
 }
 const native=[...nativeRows].filter(([id])=>nativeCounts.get(id)===1).map(([,edge])=>edge);
 let contactMax=0,domainMax=0,domainPlanMax=0,missingGround=0,contactOut=0;
 for(const e of edges){if(e.kind!=='contact'&&e.kind!=='domainEdge')throw Error('Unknown wet contour kind '+e.kind);
   const len=Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z),steps=Math.max(1,Math.ceil(len/.1));
   for(let i=0;i<=steps;i++){const t=i/steps,x=e.a.x+(e.b.x-e.a.x)*t,z=e.a.z+(e.b.z-e.a.z)*t,g=surface.sample(p,x,z,vertex),w=waterAt(p,x,z);
     let nearest=null,distance=Infinity,nearestT=0;
     for(const row of native){const dx=row.b.x-row.a.x,dz=row.b.z-row.a.z,u=Math.max(0,Math.min(1,((x-row.a.x)*dx+(z-row.a.z)*dz)/(dx*dx+dz*dz))),
       d=Math.hypot(x-row.a.x-u*dx,z-row.a.z-u*dz);
       if(d<distance){distance=d;nearest=row;nearestT=u;}}
     if(e.kind==='contact'){
       if(!g){missingGround++;continue}
       contactMax=Math.max(contactMax,Math.abs(g.height-w.height));
       if(!w.inside&&distance>.00002)contactOut++;
     }else{
       domainMax=Math.max(domainMax,distance);
       domainPlanMax=Math.max(domainPlanMax,Math.abs(e.a.h+(e.b.h-e.a.h)*t-
         (nearest.a.h+(nearest.b.h-nearest.a.h)*nearestT)));
     }
   }
 }
 if(contactMax>.03||missingGround||contactOut||domainMax>.00005||domainPlanMax>.00005)
   throw Error('Wet retained contour contract failed '+p.zoneId+' '+JSON.stringify({contactMax,domainMax,domainPlanMax,missingGround,contactOut}));
 return{contactMax,domainMax,domainPlanMax};
}
function buildRetainedWetContour(p,field){
 const vertex=makeGroundVertex(p,field),base=buildActualWetContour(p,field),retained=retainedWaterTriangles(p,field,vertex),area=retainedAreaIndex(retained.triangles,p,vertex);
 let edges=base.edges.map(e=>({kind:e.kind,a:{x:Math.fround(e.a.x),z:Math.fround(e.a.z),h:Math.fround(e.a.h)},
   b:{x:Math.fround(e.b.x),z:Math.fround(e.b.z),h:Math.fround(e.b.h)}})),iterations=[];
 const rescued=rescueDeadContactJunctions(p,field,vertex,edges,area);
 let bad=rescued.bad;
 for(let pass=0;bad.length&&pass<4;pass++){
   const micro=bad.filter(i=>Math.hypot(edges[i].b.x-edges[i].a.x,edges[i].b.z-edges[i].a.z)<=.002);
   if(!micro.length)
     throw Error('Area-free wet contour segment longer than 1 mm: '+p.zoneId+' '+JSON.stringify(bad.slice(0,20).map(i=>{const e=edges[i],dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,len=Math.hypot(dx,dz),mid={x:(e.a.x+e.b.x)/2,z:(e.a.z+e.b.z)/2},n={x:-dz/len,z:dx/len},fail=[];for(let j=0;j<=Math.ceil(len/.01);j++){const t=j/Math.ceil(len/.01),q={x:e.a.x+dx*t,z:e.a.z+dz*t},rows=area.intervals(q,n);if(!rows.some(v=>{const gap=v.lo>0?v.lo:v.hi<0?-v.hi:0;return gap<=.00002&&v.hi-v.lo>0}))fail.push({t,q,rows});}return{index:i,edge:e,length:len,mid,normal:n,intervals:area.intervals(mid,n),fail:fail.slice(0,12),failCount:fail.length};})));
   const step=contractMicroEdges(p,field,vertex,edges,micro,area.wetPoint);edges=step.edges;
   iterations.push({removed:micro.length,components:step.components.length});bad=rescueDeadContactJunctions(p,field,vertex,edges,area).bad;
 }
 if(bad.length)throw Error('Retained wet contour did not converge: '+p.zoneId+' '+bad.length);
 edges=edges.map(e=>({kind:e.kind,a:{x:Math.fround(e.a.x),z:Math.fround(e.a.z),h:Math.fround(e.a.h)},
  b:{x:Math.fround(e.b.x),z:Math.fround(e.b.z),h:Math.fround(e.b.h)}}));
 const checked=validate(p,field,vertex,edges,area);
 return{edges,report:{...base.report,rescued,retainedFans:retained.triangles.length,culledFans:retained.culled,
   culledArea:retained.culledArea,iterations,finalEdges:edges.length,...checked}};
}
module.exports={buildRetainedWetContour,retainedAreaIndex,rescueDeadContactJunctions};
