'use strict';
const {groundHeight,waterAt}=require('../../src/server/sector-surface');
const surface=require('../../src/server/sector-mesh-patches');
const groundLattice=require('../../src/server/sector-ground-lattice');
function buildSurfacePatches(p,field,options={}) {
 if(p.surfacePatches?.length)throw new Error('Profile already patched '+p.zoneId);
 const n=p.terrainSegments||128,stepX=p.width/n,stepZ=p.depth/n,sub=options.subdivision||4;
 // The serialized patch and Unity mesh use the same representable positions.
 // Rounding to decimal micrometres can create a sub-float XZ sliver once Unity
 // deserializes a high bank. Keep the original regular lattice as the seam.
 const rounded=value=>Number(value.toFixed(6)),baseCache=new Map();
 const bankBand=options.bankBand||0;
 const shoreDistance=(x,z)=>{
  let nearest=Infinity;
  for(const edge of p.visibleShore||[]){
   const dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,den=dx*dx+dz*dz;
   if(den<1e-12)continue;
   const t=Math.max(0,Math.min(1,((x-edge.a.x)*dx+(z-edge.a.z)*dz)/den));
   nearest=Math.min(nearest,Math.hypot(x-edge.a.x-t*dx,z-edge.a.z-t*dz));
  }
  return nearest;
 };
 const bankHeight=(x,z,sourceHeight)=>{
  if(!bankBand||options.bankSkirt===false)return sourceHeight;
  const water=waterAt(p,x,z);
  const excess=sourceHeight-water.height;if(excess<=-.05)return sourceHeight;
  const influence=Math.max(0,Math.min(1,(excess+.05)/.05));
  const weight=influence*influence*(3-2*influence);
  // The native water polygon can run underneath a raised dry road or site.
  // Its triangulation boundary is not necessarily a visible bank. Lower soil
  // only near the prepared physical shoreline, never near that hidden seam.
  const distance=shoreDistance(x,z);
  if(distance>=bankBand)return sourceHeight;
  const t=Math.max(0,Math.min(1,distance/bankBand));
  const eased=t*t*(3-2*t);
  const skirt=water.height-.025+(excess+.025)*eased;
  return sourceHeight+(skirt-sourceHeight)*weight;
 };
 const baseVertex=(ix,iz)=>{
  const key=ix+iz*(n+1);if(baseCache.has(key))return baseCache.get(key);
  if(groundLattice.active(p)){const v=groundLattice.regularVertex(p,ix,iz);baseCache.set(key,v);return v;}
  const z=(iz/n-.5)*p.depth;let x=(ix/n-.5)*p.width;
  if(ix>0&&ix<n){let closest=stepX/2;const edges=Math.abs(Math.abs(z)-p.depth/2)<.0001?p.waterEdges:p.visibleShore;
   for(const edge of edges||[]){if(Math.abs(edge.b.z-edge.a.z)<.000001||z<Math.min(edge.a.z,edge.b.z)-.0001||z>Math.max(edge.a.z,edge.b.z)+.0001)continue;
    const bank=edge.a.x+(edge.b.x-edge.a.x)*(z-edge.a.z)/(edge.b.z-edge.a.z),distance=Math.abs(bank-x);
    if(distance<closest){closest=distance;x=bank;}}}
  const v={x,z,h:groundHeight(p,field,x,z,false)-.05*p.gain/160};baseCache.set(key,v);return v;};
 const originalProfile={...p,surfacePatches:[]};
 const heightAt=(x,z)=>{
  const raw=groundHeight(p,field,x,z,false)-.05*p.gain/160;
  let h=bankHeight(x,z,raw);
  const halo=Math.max(stepX,stepZ),distance=Math.max(0,Math.min(p.width/2-Math.abs(x),p.depth/2-Math.abs(z)));
  if(bankBand&&distance<halo){
   const coarse=surface.sample(originalProfile,x,z,baseVertex);
   if(!coarse)throw Error('No original coarse halo plane '+p.zoneId+' '+x+','+z);
   const t=distance/halo,weight=t*t*(3-2*t);
   h=coarse.height+(h-coarse.height)*weight;
  }
  return h;
 };
 const wetSigned=(x,z,h)=>{const water=waterAt(p,x,z);return water.inside?h-water.height:Math.max(.001,water.distance);};
 const core=new Set();
 function selectPoint(x,z){const ix=Math.floor((x+p.width/2)/stepX),iz=Math.floor((z+p.depth/2)/stepZ);
  if(ix>=0&&ix<n&&iz>=0&&iz<n)core.add(iz*n+ix);}
 if(options.shore&&p.visibleShore?.length){
  for(const edge of p.visibleShore){const length=Math.hypot(edge.b.x-edge.a.x,edge.b.z-edge.a.z),steps=Math.max(1,Math.ceil(length/.125));
   for(let i=0;i<=steps;i++){const t=i/steps,x=edge.a.x+(edge.b.x-edge.a.x)*t,z=edge.a.z+(edge.b.z-edge.a.z)*t;
    const mesh=surface.sample(p,x,z,baseVertex);if(!mesh)continue;
    const analytic=groundHeight(p,field,x,z,false)-.05*p.gain/160,water=waterAt(p,x,z);
    if(Math.abs(mesh.height-analytic)>.025||
      (Math.abs(analytic-water.height)<=.03&&Math.abs(mesh.height-water.height)>.03))selectPoint(x,z);
   }}
 }
 if(options.steep){
  const threshold=options.steepError??.2;
  for(let iz=0;iz<n;iz++)for(let ix=0;ix<n;ix++){
   const a=baseVertex(ix,iz),b=baseVertex(ix+1,iz),c=baseVertex(ix,iz+1),d=baseVertex(ix+1,iz+1);
   if(Math.max(a.h,b.h,c.h,d.h)-Math.min(a.h,b.h,c.h,d.h)<1)continue;
   let error=0;
   for(const [u,v] of [[.5,.5],[.25,.25],[.75,.75],[.25,.75],[.75,.25],[.5,0],[.5,1],[0,.5],[1,.5]]){
    const x=(1-v)*((1-u)*a.x+u*b.x)+v*((1-u)*c.x+u*d.x),z=(1-v)*((1-u)*a.z+u*b.z)+v*((1-u)*c.z+u*d.z);
    const old=surface.sample(p,x,z,baseVertex);if(!old)continue;
    const analytic=groundHeight(p,field,x,z,false)-.05*p.gain/160;
    error=Math.max(error,Math.abs(old.height-analytic));
   }
   if(error>threshold)core.add(iz*n+ix);
  }
 }
 const ring=options.ring??1,selected=new Set();
 for(const key of core){const ix=key%n,iz=Math.floor(key/n);
  for(let dz=-ring;dz<=ring;dz++)for(let dx=-ring;dx<=ring;dx++){
   const x=ix+dx,z=iz+dz;if(x>=0&&x<n&&z>=0&&z<n)selected.add(z*n+x);}}
 function makeCell(ix,iz){
  const a=baseVertex(ix,iz),b=baseVertex(ix+1,iz),c=baseVertex(ix,iz+1),d=baseVertex(ix+1,iz+1);
  const exteriorEdges=[];
  if(ix===0||!selected.has(iz*n+ix-1))exteriorEdges.push([a,c]);
  if(ix===n-1||!selected.has(iz*n+ix+1))exteriorEdges.push([b,d]);
  if(iz===0||!selected.has((iz-1)*n+ix))exteriorEdges.push([a,b]);
  if(iz===n-1||!selected.has((iz+1)*n+ix))exteriorEdges.push([c,d]);
  function exteriorHeight(x,z,h){
   for(const [start,end] of exteriorEdges){const dx=end.x-start.x,dz=end.z-start.z,den=dx*dx+dz*dz;
    const t=((x-start.x)*dx+(z-start.z)*dz)/den;
    if(t<-.0001||t>1.0001||Math.hypot(x-start.x-dx*t,z-start.z-dz*t)>.00003)continue;
    return start.h+(end.h-start.h)*t;
   }
   return h;
  }
  const vertices=[],lookup=new Map(),indices=[],edgeRoots=new Map();
  const emit=(ia,ib,ic)=>{const a=vertices[ia],b=vertices[ib],c=vertices[ic];
    if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))>1e-7)indices.push(ia,ib,ic);
  };
  const add=(x,z,h)=>{const key=`${rounded(x)},${rounded(z)},${rounded(h)}`;
    if(lookup.has(key))return lookup.get(key);
    const id=vertices.length;vertices.push({x:rounded(x),z:rounded(z),h:rounded(h)});lookup.set(key,id);return id;
  };
  const point=(i,j)=>{
    const u=i/sub,v=j/sub;
    const x=(1-u)*(1-v)*a.x+u*(1-v)*b.x+(1-u)*v*c.x+u*v*d.x;
    const z=(1-v)*a.z+v*c.z;
    let h=heightAt(x,z);
    // Only edges touching an unpatched cell stay on the old coarse plane.
    // Interior patch edges share the analytic samples on both sides.
    if(i===0&&(ix===0||!selected.has(iz*n+ix-1)))h=a.h+(c.h-a.h)*v;
    else if(i===sub&&(ix===n-1||!selected.has(iz*n+ix+1)))h=b.h+(d.h-b.h)*v;
    if(j===0&&(iz===0||!selected.has((iz-1)*n+ix)))h=a.h+(b.h-a.h)*u;
    else if(j===sub&&(iz===n-1||!selected.has((iz+1)*n+ix)))h=c.h+(d.h-c.h)*u;
    if((i===0||i===sub)&&(j===0||j===sub)){
      const vx=ix+(i===sub?1:0),vz=iz+(j===sub?1:0);
      const neighbors=[(vz-1)*n+vx-1,(vz-1)*n+vx,vz*n+vx-1,vz*n+vx];
      if(vx===0||vz===0||vx===n||vz===n||neighbors.some(key=>!selected.has(key)))h=baseVertex(vx,vz).h;
    }
    return add(x,z,h);
  };
  const grid=Array.from({length:(sub+1)*(sub+1)},(_,key)=>point(key%(sub+1),Math.floor(key/(sub+1))));
  const cross=(ia,ib)=>{
    const key=ia<ib?`${ia}:${ib}`:`${ib}:${ia}`;
    if(edgeRoots.has(key))return edgeRoots.get(key);
    const va=vertices[ia],vb=vertices[ib],sa=wetSigned(va.x,va.z,va.h),sb=wetSigned(vb.x,vb.z,vb.h);
    let lo=0,hi=1,t=sa/(sa-sb);
    if(!Number.isFinite(t))t=.5;
    for(let k=0;k<20;k++){
      const mid=(lo+hi)/2,x=va.x+(vb.x-va.x)*mid,z=va.z+(vb.z-va.z)*mid;
      const h=bankBand?exteriorHeight(x,z,heightAt(x,z)):heightAt(x,z);
      const sm=wetSigned(x,z,h);
      if((sm<0)===(sa<0))lo=mid;else hi=mid;
    }
    t=(lo+hi)/2;
    const x=va.x+(vb.x-va.x)*t,z=va.z+(vb.z-va.z)*t;
    const h=exteriorHeight(x,z,heightAt(x,z));
    // A clipped root which is exactly its original endpoint in Unity's
    // Float32 XYZ has no separate native geometry. Keep that endpoint on
    // both adjacent patch edges instead of serializing a collapsed sliver.
    const nativeRoot=[x,z,h].map(v=>Math.fround(rounded(v)));
    for(const endpoint of [ia,ib]){
      const v=vertices[endpoint],nativeEndpoint=[v.x,v.z,v.h].map(v=>Math.fround(v));
      if(nativeRoot.every((value,index)=>value===nativeEndpoint[index])){
        edgeRoots.set(key,endpoint);return endpoint;
      }
    }
    const id=add(x,z,h);edgeRoots.set(key,id);return id;
  };
  const clip=(triangle,keepWet)=>{
    const out=[];
    for(let i=0;i<3;i++){
      const ia=triangle[i],ib=triangle[(i+1)%3],va=vertices[ia],vb=vertices[ib];
      const insideA=(wetSigned(va.x,va.z,va.h)<0)===keepWet;
      const insideB=(wetSigned(vb.x,vb.z,vb.h)<0)===keepWet;
      if(insideA)out.push(ia);
      if(insideA!==insideB)out.push(cross(ia,ib));
    }
    for(let k=1;k+1<out.length;k++)emit(out[0],out[k],out[k+1]);
  };
  const triangle=(ia,ib,ic)=>{
    if(bankBand){emit(ia,ib,ic);return;}
    const tri=[ia,ib,ic],signs=tri.map(id=>wetSigned(vertices[id].x,vertices[id].z,vertices[id].h)<0);
    if(signs.every(value=>value===signs[0])){emit(...tri);return;}
    clip(tri,false);clip(tri,true);
  };
  for(let j=0;j<sub;j++)for(let i=0;i<sub;i++){
    const aa=grid[j*(sub+1)+i],bb=grid[j*(sub+1)+i+1],cc=grid[(j+1)*(sub+1)+i],dd=grid[(j+1)*(sub+1)+i+1];
    triangle(aa,cc,bb);triangle(bb,cc,dd);
  }
  return {ix,iz,vertices,indices};
}
 const cells=[...selected].sort((a,b)=>a-b).map(key=>makeCell(key%n,Math.floor(key/n)));
 // A bank corner surrounded by four refined cells is no longer an exposed
 // inherited lattice point. Corners touching an unpatched cell stay exactly
 // on the original regular mesh, including every sector-border corner.
 const expectedCorner=(ix,iz)=>{
  const raw=baseVertex(ix,iz);
  if(!bankBand||ix===0||iz===0||ix===n||iz===n)return raw;
  for(const key of [(iz-1)*n+ix-1,(iz-1)*n+ix,iz*n+ix-1,iz*n+ix])
   if(!selected.has(key))return raw;
  return {...raw,h:heightAt(raw.x,raw.z)};
 };
 const validation=surface.validate({...p,surfacePatches:cells},expectedCorner);
 if(!validation.ok)throw new Error('Invalid '+p.zoneId+' adaptive patch: '+validation.issues.join('; '));
 // Wet contours are clipped from the positions actually serialized into Unity.
 // Keeping one float conversion before both contour stages prevents shallow
 // water from moving laterally when its height is rounded after the contour.
 let serializedValidation=null;
 if(bankBand){
  const toFloat=v=>({x:Math.fround(rounded(v.x)),z:Math.fround(rounded(v.z)),h:Math.fround(rounded(v.h))});
  for(const cell of cells){
   cell.vertices=cell.vertices.map(toFloat);
   for(let i=0;i<cell.indices.length;i+=3){
    const [a,b,c]=cell.indices.slice(i,i+3).map(id=>cell.vertices[id]);
    if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))<=1e-7)
     throw new Error('Serialized wet ground triangle collapsed '+p.zoneId);
   }
  }
  serializedValidation=surface.validate({...p,surfacePatches:cells},(ix,iz)=>toFloat(expectedCorner(ix,iz)));
  if(!serializedValidation.ok)throw new Error('Invalid serialized '+p.zoneId+' bank: '+serializedValidation.issues.join('; '));
 }

 return {zoneId:p.zoneId,terrainSegments:n,subdivision:sub,coreCells:core.size,patchedCells:cells.length,
  patchTriangles:cells.reduce((v,c)=>v+c.indices.length/3,0),validation,serializedValidation,cells};
}
function buildPhysicalShore(p,field,options={}){
 if(!p.surfacePatches?.length||!p.visibleShore?.length)return {edges:[],missing:[]};
 const n=p.terrainSegments||128,step=p.width/n,cache=new Map();
 function vertex(ix,iz){const key=ix+iz*(n+1);if(cache.has(key))return cache.get(key);
  if(groundLattice.active(p)){const value=groundLattice.regularVertex(p,ix,iz);cache.set(key,value);return value;}
  const z=(iz/n-.5)*p.depth;let x=(ix/n-.5)*p.width;
  if(ix>0&&ix<n){let closest=step/2;const edges=Math.abs(Math.abs(z)-p.depth/2)<.0001?p.waterEdges:p.visibleShore;
   for(const e of edges||[]){if(Math.abs(e.b.z-e.a.z)<1e-6||z<Math.min(e.a.z,e.b.z)-.0001||z>Math.max(e.a.z,e.b.z)+.0001)continue;
    const bx=e.a.x+(e.b.x-e.a.x)*(z-e.a.z)/(e.b.z-e.a.z),d=Math.abs(bx-x);
    if(d<closest){closest=d;x=bx;}}}
  const value={x,z,h:groundHeight(p,field,x,z,false)-.05*p.gain/160};cache.set(key,value);return value;}
 function sample(x,z){const w=waterAt(p,x,z);
  const mesh=surface.sample(p,x,z,vertex)||
    (Math.abs(Math.abs(z)-p.depth/2)<.00001
      ?surface.sample(p,x,Math.sign(z)*(p.depth/2-.0001),vertex):null);
  if(!mesh)return null;return {water:w,mesh:mesh.height};}
 function wetSign(x,z){const value=sample(x,z);if(!value)return null;
  return value.water.inside?value.mesh-value.water.height:Math.max(.001,value.water.distance);}
 function rootNear(x,z){let best=null,lastX=Math.max(-p.width/2,x-5),last=wetSign(lastX,z);
  for(let nextX=lastX+.125;nextX<=Math.min(p.width/2,x+5)+1e-6;nextX+=.125){
   const next=wetSign(nextX,z);
   if(last!==null&&next!==null&&(last<0)!==(next<0)){
    let lo=lastX,hi=nextX,sl=last;
    for(let k=0;k<15;k++){const mid=(lo+hi)/2,sm=wetSign(mid,z);if((sm<0)===(sl<0)){lo=mid;sl=sm;}else hi=mid;}
    const found=(lo+hi)/2;if(best===null||Math.abs(found-x)<Math.abs(best-x))best=found;
   }
   lastX=nextX;last=next;
  }return best;
 }
 const memo=new Map(),missing=[];
 function anchor(input){const key=`${input.x.toFixed(6)},${input.z.toFixed(6)}`;
  if(memo.has(key))return memo.get(key);
  const x=rootNear(input.x,input.z);
  if(x===null){
   const edgeX=input.x<0?-p.width/2:p.width/2;
   const onSharedSide=Math.abs(input.x-edgeX)<=.2;
   const atInput=sample(input.x,input.z);
   const atEdge=sample(edgeX+(input.x<0?.0001:-.0001),input.z);
   missing.push({...input,alreadyWetSharedEdge:Boolean(onSharedSide&&atInput&&atEdge&&
    atInput.water.inside&&atEdge.water.inside&&
    atInput.mesh<atInput.water.height&&atEdge.mesh<atEdge.water.height)});
   memo.set(key,null);return null;}
  const w=waterAt(p,x,input.z),value={x:Number(x.toFixed(6)),z:input.z,h:Number(w.height.toFixed(6))};
  memo.set(key,value);return value;
 }
 const contours=[];
 function subdivide(a,b,depth){const middle={x:(a.x+b.x)/2,z:(a.z+b.z)/2},actual=anchor(middle);
  if(!actual){contours.push({a,b});return;}
  const midSample=sample(middle.x,middle.z),domainChord=midSample&&Math.abs(midSample.mesh-midSample.water.height)>.03&&midSample.water.distance>(options.domainChordDistance??.01);
  if((Math.abs(actual.x-middle.x)>(options.shoreDeviation??.05)&&depth<(options.shoreSplitDepth??3)) || (domainChord&&depth<6))
  {subdivide(a,actual,depth+1);subdivide(actual,b,depth+1);}
  else contours.push({a,b});
 }
 for(const edge of p.visibleShore){const a=anchor(edge.a),b=anchor(edge.b);if(a&&b)subdivide(a,b,0);}
 const out=[];
 function position(e,t){const x=e.a.x+(e.b.x-e.a.x)*t,z=e.a.z+(e.b.z-e.a.z)*t;
  const value=sample(x,z);if(!value)throw new Error('Physical shoreline mesh hole '+p.zoneId+' '+x+','+z);
  return {x,z,h:value.water.height,gap:Math.abs(value.mesh-value.water.height),distance:value.water.distance};}
 const kindThreshold=.03;
 function gapSign(e,t){return position(e,t).gap-kindThreshold;}
 function splitPoint(e,t){const value=position(e,t);return {x:Number(value.x.toFixed(7)),z:Number(value.z.toFixed(7)),h:Number(value.h.toFixed(7))};}
 for(const e of contours){const length=Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z),steps=Math.max(8,Math.ceil(length/.1));
  let start=0,last=gapSign(e,0),parts=[];
  for(let i=1;i<=steps;i++){const t=i/steps,next=gapSign(e,t);
   if((last>0)===(next>0)){last=next;continue;}
   let lo=(i-1)/steps,hi=t,previous=last;
   for(let k=0;k<25;k++){const mid=(lo+hi)/2,value=gapSign(e,mid);
    if((value>0)===(previous>0)){lo=mid;previous=value;}else hi=mid;}
   const cut=(lo+hi)/2;if(cut-start>1e-7)parts.push([start,cut]);start=cut;last=next;
  }
  if(1-start>1e-7)parts.push([start,1]);
  for(const [a,b] of parts){const mid=position(e,(a+b)/2),kind=mid.gap>kindThreshold?'domainEdge':'contact';
   if(kind==='domainEdge'&&mid.distance>.03)throw new Error('Shoreline water-domain discontinuity '+p.zoneId+' '+mid.x+','+mid.z);
   out.push({a:splitPoint(e,a),b:splitPoint(e,b),kind});
  }
 }
 return {edges:out,missing,sourceEdges:contours.length,
  contactEdges:out.filter(e=>e.kind==='contact').length,
  domainEdges:out.filter(e=>e.kind==='domainEdge').length};
}
module.exports={buildSurfacePatches,buildPhysicalShore};
