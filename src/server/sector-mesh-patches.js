'use strict';
// Shared indexed terrain used by server height, route and placement consumers.
// Refined profiles are published only after saved Unity geometry probes pass.
const EPS=1e-6;
const lattice=require('./sector-ground-lattice');
const cellKey=(ix,iz,n)=>iz*n+ix;
const patchIndex=new WeakMap();
const stitchedIndex=new WeakMap();
const regularCallbacks=new WeakMap();
const boundaryWaterIndexes=new WeakMap();
function regularVertex(profile,ix,iz,fallback){return lattice.regularVertex(profile,ix,iz,fallback);}
function effectiveVertex(profile,fallback){
 if(!lattice.active(profile))return fallback;
 const previous=regularCallbacks.get(fallback);
 if(previous?.profile===profile&&previous.lattice===profile.groundLattice)return previous.callback;
 const callback=(ix,iz)=>regularVertex(profile,ix,iz,fallback);
 regularCallbacks.set(fallback,{profile,lattice:profile.groundLattice,callback});return callback;
}
function index(profile){
 const source=profile.surfacePatches||null,previous=patchIndex.get(profile);
 if(previous?.source===source)return previous.cells;
 const cells=new Map((source||[])
   .map(c=>[cellKey(c.ix,c.iz,profile.terrainSegments||128),c]));
 patchIndex.set(profile,{source,cells});
 return cells;
}
function patchCell(profile,ix,iz){
 const n=profile.terrainSegments||128;
 return ix>=0&&ix<n&&iz>=0&&iz<n?index(profile).get(cellKey(ix,iz,n))||null:null;
}
const f32=Math.fround;
function roundToEven(value){
 const floor=Math.floor(value),fraction=value-floor;
 return fraction<.5?floor:fraction>.5?floor+1:floor%2===0?floor:floor+1;
}
function vertexKey(v){return `${roundToEven(f32(v.x*10000))},${roundToEven(f32(v.h*10000))},${roundToEven(f32(v.z*10000))}`;}
function point(v){return{x:f32(v.x),z:f32(v.z),h:f32(v.h)};}
function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z,a.h-b.h);}
function cross(a,b,c){return f32(f32(f32(b.x-a.x)*f32(c.z-a.z))-f32(f32(b.z-a.z)*f32(c.x-a.x)));}
// A clipped native-water root at the sector boundary has an open triangle
// fan. A dry regular quad can remove its redundant spoke by using the other
// diagonal. Original vertices, perimeter planes and all wet cells are kept.
function dryBoundaryDiagonal(profile,ix,iz,a,b,c,d){
 const n=profile.terrainSegments||128;
 if(ix!==0&&ix!==n-1&&iz!==0&&iz!==n-1)return false;
 const source=profile.waterVertices,ids=profile.waterIndices;
 if(!source?.length||!ids?.length)return false;
 let water=boundaryWaterIndexes.get(profile);
 if(!water||water.source!==source||water.ids!==ids){
  const vertices=source.map(v=>({x:f32(v.x),z:f32(v.z)})),edges=new Map(),triangles=[];
  for(let i=0;i<ids.length;i+=3){
   const row=ids.slice(i,i+3),tri=row.map(id=>vertices[id]);
   if(Math.abs(areaXZ(...tri))<1e-9)continue;
   triangles.push(tri);
   for(let k=0;k<3;k++){
    const u=row[k],v=row[(k+1)%3],key=u<v?`${u},${v}`:`${v},${u}`;
    const edge=edges.get(key)||{u,v,count:0};edge.count++;edges.set(key,edge);
   }
  }
  const rootIds=new Set();for(const edge of edges.values())if(edge.count===1){rootIds.add(edge.u);rootIds.add(edge.v);}
  const roots=[...rootIds].map(id=>vertices[id]).filter(v=>
   Math.abs(Math.abs(v.x)-profile.width/2)<=.00002||Math.abs(Math.abs(v.z)-profile.depth/2)<=.00002);
  water={source,ids,triangles,roots};boundaryWaterIndexes.set(profile,water);
 }
 const root=v=>water.roots.some(q=>(q.x-v.x)**2+(q.z-v.z)**2<=4e-10);
 if(root(a)||root(d)||Number(root(b))+Number(root(c))!==1)return false;
 const quad=[a,c,d,b];
 for(let k=0;k<4;k++)if(areaXZ(quad[k],quad[(k+1)%4],quad[(k+2)%4])>=-1e-7||
  cross(quad[k],quad[(k+1)%4],quad[(k+2)%4])>=-1e-7)return false;
 const minX=Math.min(a.x,b.x,c.x,d.x),maxX=Math.max(a.x,b.x,c.x,d.x);
 const minZ=Math.min(a.z,b.z,c.z,d.z),maxZ=Math.max(a.z,b.z,c.z,d.z);
 for(const tri of water.triangles){
  if(Math.max(...tri.map(v=>v.x))<minX||Math.min(...tri.map(v=>v.x))>maxX||
     Math.max(...tri.map(v=>v.z))<minZ||Math.min(...tri.map(v=>v.z))>maxZ)continue;
  let clipped=quad;
  const sign=Math.sign(areaXZ(...tri));
  for(let k=0;k<3&&clipped.length>=3;k++){
   const next=[],u=tri[k],v=tri[(k+1)%3];
   for(let j=0;j<clipped.length;j++){
    const q=clipped[j],r=clipped[(j+1)%clipped.length],sq=sign*areaXZ(u,v,q),sr=sign*areaXZ(u,v,r);
    if(sq>=0)next.push(q);
    if((sq<0)!==(sr<0)){const t=sq/(sq-sr);next.push({x:q.x+(r.x-q.x)*t,z:q.z+(r.z-q.z)*t});}
   }
   clipped=next;
  }
  let twiceArea=0;for(let k=1;k+1<clipped.length;k++)twiceArea+=areaXZ(clipped[0],clipped[k],clipped[k+1]);
  if(Math.abs(twiceArea)>0)return false;
 }
 // The only interior extremum between two quad triangulations is at the
 // diagonal intersection. Bound this authored dry-surface change to 5 mm.
 const oldX=c.x-b.x,oldZ=c.z-b.z,newX=d.x-a.x,newZ=d.z-a.z;
 const den=oldX*newZ-oldZ*newX;
 if(Math.abs(den)<1e-7)return false;
 const t=((a.x-b.x)*newZ-(a.z-b.z)*newX)/den;
 const u=((a.x-b.x)*oldZ-(a.z-b.z)*oldX)/den;
 if(t<=0||t>=1||u<=0||u>=1)return false;
 return Math.abs(b.h+(c.h-b.h)*t-(a.h+(d.h-a.h)*u))<=.005;
}
function areaXZ(a,b,c){return(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function regularRows(profile,ix,iz,a,b,c,d){
 return dryBoundaryDiagonal(profile,ix,iz,a,b,c,d)?[[a,c,d],[a,d,b]]:[[a,c,b],[b,c,d]];
}
function stitchCell(profile,ix,iz,regularVertex,patch){
 const a=point(regularVertex(ix,iz)),b=point(regularVertex(ix+1,iz));
 const c=point(regularVertex(ix,iz+1)),d=point(regularVertex(ix+1,iz+1));
 // Apply seeds its vertex dictionary from the original row-major lattice.
 // Local corners are sufficient for all vertices on this cell's four edges.
 const keyed=new Map();
 for(const v of [a,b,c,d])keyed.set(vertexKey(v),v);
 const add=v=>{const q=point(v),key=vertexKey(q);if(keyed.has(key))return keyed.get(key);keyed.set(key,q);return q;};
 const result=[];
 function emit(a,b,c){a=add(a);b=add(b);c=add(c);const area=cross(a,b,c);
  if(Math.abs(area)<1e-7)return;
  result.push(area>0?[a,c,b]:[a,b,c]);
 }
 if(patch){for(let k=0;k<patch.indices.length;k+=3)
   emit(...patch.indices.slice(k,k+3).map(id=>patch.vertices[id]));
  return result;
 }
 const left=patchCell(profile,ix-1,iz),right=patchCell(profile,ix+1,iz);
 const below=patchCell(profile,ix,iz-1),above=patchCell(profile,ix,iz+1);
 if(!left&&!right&&!below&&!above){for(const row of regularRows(profile,ix,iz,a,b,c,d))emit(...row);return result;}
 function split(start,end,neighbor){
  if(!neighbor)return[];
  const dx=f32(end.x-start.x),dz=f32(end.z-start.z),length2=f32(f32(dx*dx)+f32(dz*dz));
  const rows=[];
  for(const v of neighbor.vertices){
   const q=point(v),qx=f32(q.x-start.x),qz=f32(q.z-start.z);
   const t=f32(f32(f32(qx*dx)+f32(qz*dz))/length2);
   if(t<=.00001||t>=.99999)continue;
   const px=f32(start.x+f32(dx*t)),pz=f32(start.z+f32(dz*t));
   if(Math.hypot(q.x-px,q.z-pz)>.00003)continue;
   const expected=f32(start.h+f32(f32(end.h-start.h)*t));
   if(Math.abs(q.h-expected)>.0015)
    throw Error(`Nonplanar shoreline patch seam ${profile.zoneId||profile.locationId}:${ix},${iz}`);
   rows.push({t,q});
  }
  rows.sort((u,v)=>u.t-v.t);
  const distinct=[];
  for(const row of rows)if(!distinct.length||distance(distinct.at(-1),row.q)>.00002)distinct.push(row.q);
  return distinct;
 }
 const middle={x:f32(f32(b.x+c.x)*.5),z:f32(f32(b.z+c.z)*.5),h:f32(f32(b.h+c.h)*.5)};
 function fan(edge){for(let k=0;k+1<edge.length;k++)emit(middle,edge[k],edge[k+1]);}
 fan([c,...split(a,c,left).reverse(),a,...split(a,b,below),b]);
 fan([b,...split(b,d,right),d,...split(c,d,above).reverse(),c]);
 return result;
}
function triangles(profile,ix,iz,regularVertex){
 regularVertex=effectiveVertex(profile,regularVertex);
 const n=profile.terrainSegments||128,source=profile.surfacePatches||null;
 if(!source?.length){
  const a=regularVertex(ix,iz),b=regularVertex(ix+1,iz),c=regularVertex(ix,iz+1),d=regularVertex(ix+1,iz+1);
  return [[a,c,b],[b,c,d]];
 }
 if(!patchCell(profile,ix,iz)&&!patchCell(profile,ix-1,iz)&&
   !patchCell(profile,ix+1,iz)&&!patchCell(profile,ix,iz-1)&&!patchCell(profile,ix,iz+1)){
  const a=point(regularVertex(ix,iz)),b=point(regularVertex(ix+1,iz));
  const c=point(regularVertex(ix,iz+1)),d=point(regularVertex(ix+1,iz+1));
  const result=[];
  for(const row of regularRows(profile,ix,iz,a,b,c,d)){
   const area=cross(...row);
   if(Math.abs(area)>=1e-7)result.push(area>0?[row[0],row[2],row[1]]:row);
  }
  return result;
 }
 let cached=stitchedIndex.get(regularVertex);
 if(!cached||cached.profile!==profile||cached.source!==source){cached={profile,source,cells:new Map()};stitchedIndex.set(regularVertex,cached);}
 const key=cellKey(ix,iz,n);
 if(!cached.cells.has(key))cached.cells.set(key,stitchCell(profile,ix,iz,regularVertex,patchCell(profile,ix,iz)));
 return cached.cells.get(key);
}
function support(point,[a,b,c]){
 const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 if(Math.abs(area)<1e-10)return null;
 const u=((b.x-point.x)*(c.z-point.z)-(b.z-point.z)*(c.x-point.x))/area;
 const v=((c.x-point.x)*(a.z-point.z)-(c.z-point.z)*(a.x-point.x))/area;
 const w=1-u-v;
 if(Math.min(u,v,w)<-EPS)return null;
 const gradientX=((b.h-a.h)*(c.z-a.z)-(c.h-a.h)*(b.z-a.z))/area;
 const gradientZ=((b.x-a.x)*(c.h-a.h)-(c.x-a.x)*(b.h-a.h))/area;
 return {height:a.h*u+b.h*v+c.h*w,slope:Math.hypot(gradientX,gradientZ),triangle:[a,b,c],
  strict:Math.min(u,v,w)>=-1e-10};
}
function sample(profile,x,z,regularVertex){
 const n=profile.terrainSegments||128,stepX=profile.width/n,stepZ=profile.depth/n;
 const ix0=Math.floor((x+profile.width/2)/stepX),iz0=Math.floor((z+profile.depth/2)/stepZ);
 let best=null;
 for(let iz=Math.max(0,iz0-1);iz<=Math.min(n-1,iz0+1);iz++)
 for(let ix=Math.max(0,ix0-2);ix<=Math.min(n-1,ix0+2);ix++)
  for(const triangle of triangles(profile,ix,iz,regularVertex)){
   const hit=support({x,z},triangle);
   if(hit&&(!best||(hit.strict&&!best.strict)||(hit.strict===best.strict&&hit.height>best.height)))best=hit;
  }
 return best;
}
// A water consumer must clip authored water triangles against exactly these
// indexed ground triangles. It must never reconstruct the old two-triangle cell.
function groundTrianglesInBox(profile,minX,minZ,maxX,maxZ,regularVertex){
 const n=profile.terrainSegments||128,stepX=profile.width/n,stepZ=profile.depth/n;
 const x0=Math.max(0,Math.floor((minX+profile.width/2)/stepX)-2);
 const x1=Math.min(n-1,Math.ceil((maxX+profile.width/2)/stepX)+2);
 const z0=Math.max(0,Math.floor((minZ+profile.depth/2)/stepZ)-1);
 const z1=Math.min(n-1,Math.ceil((maxZ+profile.depth/2)/stepZ)+1);
 const out=[];
 for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++)
  for(const triangle of triangles(profile,ix,iz,regularVertex))out.push(triangle);
 return out;
}
function validate(profile,regularVertex){
 // The caller supplies the expected *finished* corner heights. A bank corner
 // surrounded by refined cells may intentionally differ from the native
 // regular soil lattice; exposed corners are supplied as native values.
 const n=profile.terrainSegments||128,stepX=profile.width/n,stepZ=profile.depth/n;
 // Native shoreline snapping can make a cell edge slant in XZ. A nominal
 // grid-coordinate slice can pick an interior vertex from the next cell.
 const edgePosition=(v,start,end)=>{
  const dx=end.x-start.x,dz=end.z-start.z,den=dx*dx+dz*dz;
  const t=((v.x-start.x)*dx+(v.z-start.z)*dz)/den;
  return {t,distance:Math.hypot(v.x-start.x-dx*t,v.z-start.z-dz*t)};
 };
 const seen=new Set(),issues=[];let count=0,boundary=0;
 for(const c of profile.surfacePatches||[]){
  const key=cellKey(c.ix,c.iz,n);
  if(seen.has(key))issues.push(`duplicate cell ${key}`);seen.add(key);
  if(c.ix<0||c.iz<0||c.ix>=n||c.iz>=n)issues.push(`outside sector ${key}`);
  if(c.indices.length%3)issues.push(`incomplete index list ${key}`);
  const minX=-profile.width/2+c.ix*stepX,maxX=minX+stepX;
  const minZ=-profile.depth/2+c.iz*stepZ,maxZ=minZ+stepZ;
  for(const v of c.vertices){
   if(v.x<minX-stepX/2-EPS||v.x>maxX+stepX/2+EPS||v.z<minZ-EPS||v.z>maxZ+EPS)issues.push(`escaped cell ${key}`);
   if(Math.abs(Math.abs(v.x)-profile.width/2)<EPS||Math.abs(Math.abs(v.z)-profile.depth/2)<EPS)boundary++;
  }
  for(let k=0;k<c.indices.length;k+=3){
   const ids=c.indices.slice(k,k+3);
   if(ids.some(id=>!Number.isInteger(id)||id<0||id>=c.vertices.length)){issues.push(`bad index ${key}`);continue;}
   const [a,b,d]=ids.map(id=>c.vertices[id]);
   const area=(b.x-a.x)*(d.z-a.z)-(b.z-a.z)*(d.x-a.x);
   if(Math.abs(area)<1e-9)issues.push(`degenerate triangle ${key}:${k/3}`);
   if(area>1e-9)issues.push(`inverted triangle ${key}:${k/3}`);
   count++;
  }
  for(const [dx,dz] of [[1,0],[0,1]]){
   const adjacent=patchCell(profile,c.ix+dx,c.iz+dz);
   if(!adjacent)continue;
   const start=dx?regularVertex(c.ix+1,c.iz):regularVertex(c.ix,c.iz+1);
   const end=regularVertex(c.ix+1,c.iz+1);
   const row=vertices=>vertices.filter(v=>{
    const edge=edgePosition(v,start,end);
    return edge.t>=-EPS&&edge.t<=1+EPS&&edge.distance<2e-5;
   })
    .map(v=>`${v.x.toFixed(5)},${v.z.toFixed(5)},${v.h.toFixed(5)}`).sort();
   if(JSON.stringify(row(c.vertices))!==JSON.stringify(row(adjacent.vertices)))
    issues.push(`discontinuous patch edge ${key}->${cellKey(c.ix+dx,c.iz+dz,n)}`);
  }
  for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){
   if(patchCell(profile,c.ix+dx,c.iz+dz))continue;
   const start=dx===-1?regularVertex(c.ix,c.iz):dx===1?regularVertex(c.ix+1,c.iz)
    :dz===-1?regularVertex(c.ix,c.iz):regularVertex(c.ix,c.iz+1);
   const end=dx===-1?regularVertex(c.ix,c.iz+1):dx===1?regularVertex(c.ix+1,c.iz+1)
    :dz===-1?regularVertex(c.ix+1,c.iz):regularVertex(c.ix+1,c.iz+1);
   for(const v of c.vertices){
    const {t,distance}=edgePosition(v,start,end);
    if(distance>2e-5)continue;
    const expected=start.h+(end.h-start.h)*t;
    if(t>=-EPS&&t<=1+EPS&&Math.abs(v.h-expected)>.0015)
     issues.push(`nonplanar exterior edge ${key}:${dx},${dz} delta=${(v.h-expected).toFixed(5)}`);
   }
  }
  // The four inherited lattice corners must survive exactly.
  for(const [ix,iz] of [[c.ix,c.iz],[c.ix+1,c.iz],[c.ix,c.iz+1],[c.ix+1,c.iz+1]]){
   const original=regularVertex(ix,iz);
   if(!c.vertices.some(v=>Math.abs(v.x-original.x)<2e-5&&Math.abs(v.z-original.z)<2e-5&&Math.abs(v.h-original.h)<2e-5))
    issues.push(`changed inherited vertex ${key}:${ix},${iz}`);
  }
 }
 return {ok:issues.length===0,cells:seen.size,triangles:count,sectorBoundaryVertices:boundary,issues:issues.slice(0,30)};
}
module.exports={patchCell,regularVertex,triangles,support,sample,groundTrianglesInBox,validate};
