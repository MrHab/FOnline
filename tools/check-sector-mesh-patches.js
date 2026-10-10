'use strict';
// Behavioral parity fixture for the native Apply seam fan. The bank cell is
// intentionally planar except for one legal (1 mm) authored edge vertex.
const assert=require('node:assert/strict');
const mesh=require('../src/server/sector-mesh-patches');
const f32=Math.fround;
const regular=(ix,iz)=>{const x=ix-64,z=iz-64;return{x,z,h:2*x+3*z};};
function patchAt(ix,iz,side,edgeLift=.001,cornerShift=0){
 const x=ix-64,z=iz-64;
 const ring=[{x,z},{x:x+1,z},{x:x+1,z:z+1},{x,z:z+1}];
 const after={below:0,right:1,above:2,left:3}[side];
 const a=ring[after],b=ring[(after+1)%4];
 ring.splice(after+1,0,{x:(a.x+b.x)/2,z:(a.z+b.z)/2,edge:true});
 const points=[{x:x+.5,z:z+.5},...ring].map(q=>({x:f32(q.x),z:f32(q.z),
  h:f32(2*q.x+3*q.z+(q.edge?edgeLift:0))}));
 if(cornerShift){points[1]={...points[1],x:f32(points[1].x+cornerShift),h:f32(points[1].h+cornerShift)};}
 const indices=[];for(let i=1;i<=5;i++)indices.push(0,i,i===5?1:i+1);
 return{ix,iz,vertices:points,indices};
}
for(const [side,ix,iz,shared] of [
 ['left',63,64,{x:0,z:.5,h:1.5}],
 ['right',65,64,{x:1,z:.5,h:3.5}],
 ['below',64,63,{x:.5,z:0,h:1}],
 ['above',64,65,{x:.5,z:1,h:4}]
]){
 const patch=patchAt(ix,iz,({left:'right',right:'left',below:'above',above:'below'})[side]);
 const profile={zoneId:'fixture',width:128,depth:128,terrainSegments:128,surfacePatches:[patch]};
 const actual=mesh.triangles(profile,64,64,regular);
 assert.equal(actual.length,5,`${side} native adjacent fan count`);
 const raised={...shared,h:f32(shared.h+.001)};
 assert(actual.flat().some(q=>q.x===raised.x&&q.z===raised.z&&q.h===raised.h),`${side} shared raised vertex`);
 const supported=actual.map(t=>mesh.support(raised,t)).filter(Boolean);
 assert(supported.length>=1,`${side} shared vertex lies on native fan`);
 assert(supported.some(s=>Math.abs(s.height-raised.h)<1e-6),`${side} shared vertex controls support height`);
 assert(mesh.sample(profile,raised.x,raised.z,regular),`${side} full sampler finds stitched terrain`);
}
const plain={zoneId:'plain',width:128,depth:128,terrainSegments:128,surfacePatches:[]};
assert.equal(mesh.triangles(plain,64,64,regular).length,2,'unpatched cell retains two triangles');
const boundary={zoneId:'boundary',width:128,depth:128,terrainSegments:128,
 surfacePatches:[patchAt(127,5,'right')]};
assert.equal(mesh.triangles(boundary,0,6,regular).length,2,
 'out-of-range neighbor cannot alias the opposite edge of the row-major grid');
const right=patchAt(65,64,'left',.001,.000001);
const keyed={zoneId:'keyed',width:128,depth:128,terrainSegments:128,surfacePatches:[right]};
assert(mesh.triangles(keyed,65,64,regular).flat().some(v=>v.x===1&&v.z===0&&v.h===2),
 'native 1e-4 keyed merge reuses original corner');
const invalid={zoneId:'invalid',width:128,depth:128,terrainSegments:128,
 surfacePatches:[patchAt(65,64,'left',.002)]};
assert.throws(()=>mesh.triangles(invalid,64,64,regular),/Nonplanar shoreline patch seam/);
// The native double sampler chooses a containing triangle before an elevated
// triangle whose extrapolated footprint lies just within the edge fallback.
const q=f32(.4),near=f32(q+1e-7);
const overlapping={zoneId:'strict-support',width:128,depth:128,terrainSegments:128,
 surfacePatches:[{ix:64,iz:64,vertices:[
  {x:.2,z:.2,h:0},{x:.8,z:.2,h:0},{x:.2,z:.8,h:0},
  {x:near,z:.2,h:100},{x:.8,z:.2,h:100},{x:near,z:.8,h:100}
 ],indices:[0,1,2,3,4,5]}]};
const strictHit=mesh.sample(overlapping,q,q,(ix,iz)=>({x:ix-64,z:iz-64,h:0}));
assert(strictHit?.strict,'containing patch triangle wins');
assert.equal(strictHit.height,0,'near-outside elevated triangle must not replace exact support');
const outside=mesh.support({x:q,z:q},overlapping.surfacePatches[0].vertices.slice(3));
assert(outside&&!outside.strict,'existing edge fallback remains available');
// A slanted Native seam must use its actual endpoints. The right-cell
// interior vertex lies within 20 micrometres of the nominal X=1 slice.
const skewRegular=(ix,iz)=>{
 const z=iz-64,x=ix-64-z*.25;return{x,z,h:2*x+3*z};
};
function skewPatch(ix){
 const x=ix-64,ring=[[x,0],[x+1,0],[x+.75,1],[x-.25,1]];
 const edge=ix===64?1:3,a=ring[edge],b=ring[(edge+1)%4];
 ring.splice(edge+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);
 const center=ix===64?.375:f32(1.000016);
 const vertices=[[center,.5],...ring].map(([x,z])=>({x:f32(x),z:f32(z),h:f32(2*x+3*z)}));
 const indices=[];for(let i=1;i<vertices.length;i++)indices.push(0,i===vertices.length-1?1:i+1,i);
 return{ix,iz:64,vertices,indices};
}
const skewProfile={zoneId:'native-skew',width:128,depth:128,terrainSegments:128,
 surfacePatches:[skewPatch(64),skewPatch(65)]};
assert.equal(mesh.validate(skewProfile,skewRegular).ok,true,'matching slanted Native seam excludes nearby interior vertex');
for(const [field,shift] of [['h',.001],['x',.0001]]){
 const broken=structuredClone(skewProfile),right=broken.surfacePatches[1];
 const shared=right.vertices.find(v=>v.x===.875&&v.z===.5);
 shared[field]=f32(shared[field]+shift);
 assert(mesh.validate(broken,skewRegular).issues.some(v=>v.startsWith('discontinuous patch edge')),
  'real slanted seam '+field+' crack remains rejected');
}
for(const [lift,accepted] of [[.001,true],[.002,false]]){
 const exposed={...skewProfile,surfacePatches:[skewPatch(64)]};
 exposed.surfacePatches[0].vertices.find(v=>v.x===.875&&v.z===.5).h+=lift;
 const result=mesh.validate(exposed,skewRegular);
 assert.equal(result.ok,accepted,'slanted exterior seam keeps original 1.5 mm limit');
 if(!accepted)assert(result.issues.some(v=>v.startsWith('nonplanar exterior edge')));
}
// Actual Float32 dry boundary quad from the saved open native fan. The old
// diagonal gives its shoreline root two spokes in this dry cell; the new
// diagonal gives it one while keeping the wet adjacent triangle unchanged.
const nativeA={x:f32(-3.75),h:f32(-15.6547518),z:f32(78.75)};
const nativeB={x:f32(-2.5),h:f32(-15.66397),z:f32(78.75)};
const nativeC={x:f32(-3.9601686),h:f32(-15.6968813),z:f32(80)};
const nativeD={x:f32(-2.5),h:f32(-15.7171717),z:f32(80)};
const nativeWest={x:-5,h:f32(-16.3227463),z:80};
const nativeCorners=[nativeA,nativeB,nativeC,nativeD];
const nativeGrid=(ix,iz)=>{
 if(iz===127&&ix===61)return nativeA;if(iz===127&&ix===62)return nativeB;
 if(iz===128&&ix===61)return nativeC;if(iz===128&&ix===62)return nativeD;
 if(iz===128&&ix===60)return nativeWest;
 return{x:f32(ix*1.25-80),z:f32(iz*1.25-80),h:-16};
};
const remoteVertices=[nativeGrid(0,0),nativeGrid(1,0),nativeGrid(0,1),nativeGrid(1,1)];
const nativeProfile={zoneId:'dry-boundary-root',width:160,depth:160,terrainSegments:128,
 surfacePatches:[{ix:0,iz:0,vertices:remoteVertices,indices:[0,2,1,1,2,3]}],
 waterVertices:[{x:-3.96017,z:80,h:-15.69333},{x:-10.07199,z:80,h:-15.55066},
  {x:-9.94031,z:65.56641,h:-15.0641}],waterIndices:[0,1,2]};
const nativeExpected=[[nativeA,nativeC,nativeD],[nativeA,nativeD,nativeB]];
assert.deepEqual(mesh.triangles(nativeProfile,61,127,nativeGrid),nativeExpected,
 'real dry boundary fan uses the alternate diagonal with unchanged Float32 XYZ');
const westTriangles=mesh.triangles(nativeProfile,60,127,nativeGrid);
assert(westTriangles.some(t=>t.includes(nativeC)||t.some(v=>v.x===nativeC.x&&v.z===nativeC.z)),
 'wet adjacent face retains the shared root');
const rootFaces=[...westTriangles,...nativeExpected].filter(t=>t.some(v=>v.x===nativeC.x&&v.z===nativeC.z));
assert.equal(rootFaces.length,2,'open shoreline root has only two incident faces');
assert.equal(rootFaces[0].filter(v=>rootFaces[1].some(q=>q.x===v.x&&q.z===v.z&&q.h===v.h)).length,2,
 'remaining dry and wet root faces share a true TOP edge');
const originalRows=[[nativeA,nativeC,nativeB],[nativeB,nativeC,nativeD]];
const oldX=nativeC.x-nativeB.x,oldZ=nativeC.z-nativeB.z,newX=nativeD.x-nativeA.x,newZ=nativeD.z-nativeA.z;
const t=((nativeA.x-nativeB.x)*newZ-(nativeA.z-nativeB.z)*newX)/(oldX*newZ-oldZ*newX);
const intersection={x:nativeB.x+oldX*t,z:nativeB.z+oldZ*t};
function heightAt(rows,q){const found=rows.map(row=>mesh.support(q,row)).filter(Boolean);assert(found.length);return found[0].height;}
const interpolationDelta=Math.abs(heightAt(originalRows,intersection)-heightAt(nativeExpected,intersection));
assert(Math.abs(interpolationDelta-.004391910885772177)<1e-10,'actual dry interior change is 4.39191 mm');
for(const [a,b] of [[nativeA,nativeC],[nativeC,nativeD],[nativeD,nativeB],[nativeB,nativeA]])
 for(const u of [0,.25,.5,.75,1]){
  const q={x:a.x+(b.x-a.x)*u,z:a.z+(b.z-a.z)*u};
  assert(Math.abs(heightAt(originalRows,q)-heightAt(nativeExpected,q))<1e-12,'all quad perimeter heights unchanged');
 }
const unchanged=(p,grid=nativeGrid)=>assert.deepEqual(mesh.triangles(p,61,127,grid),originalRows);
unchanged({...nativeProfile,surfacePatches:[]}); // Original refinement input keeps its original planes.
unchanged({...nativeProfile,waterVertices:[],waterIndices:[]});
const absentRoot=structuredClone(nativeProfile);absentRoot.waterVertices[0].x-=.0001;unchanged(absentRoot);
const wetInterior=structuredClone(nativeProfile);
wetInterior.waterVertices.push({x:-3.4,z:79.4,h:-16},{x:-3.3,z:79.4,h:-16},{x:-3.35,z:79.5,h:-16});
wetInterior.waterIndices.push(3,4,5);unchanged(wetInterior); // All four corners still dry.
const saddleGrid=(ix,iz)=>ix===61&&iz===127?{...nativeA,h:f32(nativeA.h+.1)}:nativeGrid(ix,iz);
assert.deepEqual(mesh.triangles(nativeProfile,61,127,saddleGrid),
 [[saddleGrid(61,127),nativeC,nativeB],[nativeB,nativeC,nativeD]],'large dry saddle remains unchanged');
const concaveGrid=(ix,iz)=>ix===62&&iz===128?{...nativeD,x:-4}:nativeGrid(ix,iz);
assert.deepEqual(mesh.triangles(nativeProfile,61,127,concaveGrid),
 [[nativeA,nativeC,nativeB],[nativeB,concaveGrid(62,128),nativeC]],'nonconvex quad remains on original diagonal');
const nearPatch={ix:62,iz:127,vertices:[nativeGrid(62,127),nativeGrid(63,127),nativeGrid(62,128),nativeGrid(63,128)],indices:[0,2,1,1,2,3]};
const stitched=mesh.triangles({...nativeProfile,surfacePatches:[...nativeProfile.surfacePatches,nearPatch]},61,127,nativeGrid);
assert(stitched.length>2,'adjacent refined cell still takes the original seam fan');
assert(stitched.some(row=>row.some(v=>v.x===f32(f32(nativeB.x+nativeC.x)*.5)&&v.z===f32(f32(nativeB.z+nativeC.z)*.5))),
 'stitched fan keeps the original diagonal midpoint');
assert.deepEqual(nativeProfile.waterVertices,[{x:-3.96017,z:80,h:-15.69333},{x:-10.07199,z:80,h:-15.55066},{x:-9.94031,z:65.56641,h:-15.0641}],
 'canonical native-water vertices retained');assert.deepEqual(nativeProfile.waterIndices,[0,1,2]);
for(const turns of [1,2,3]){
 const rotate=v=>{let{x,z,h}=v;for(let k=0;k<turns;k++)[x,z]=[z,-x];return{x:f32(x),z:f32(z),h};};
 const grid=(ix,iz)=>{for(let k=0;k<turns;k++)[ix,iz]=[128-iz,ix];return rotate(nativeGrid(ix,iz));};
 let cellX=61,cellZ=127;for(let k=0;k<turns;k++)[cellX,cellZ]=[cellZ,127-cellX];
 const p={...nativeProfile,waterVertices:nativeProfile.waterVertices.map(rotate),
  surfacePatches:[{ix:64,iz:64,vertices:[grid(64,64),grid(65,64),grid(64,65),grid(65,65)],indices:[0,2,1,1,2,3]}]};
 const a=grid(cellX,cellZ),b=grid(cellX+1,cellZ),c=grid(cellX,cellZ+1),d=grid(cellX+1,cellZ+1);
 assert.deepEqual(mesh.triangles(p,cellX,cellZ,grid),turns===2?[[a,c,d],[a,d,b]]:[[a,c,b],[b,c,d]],
  'rotated boundary root only flips when its incident spoke count decreases');
}
assert.deepEqual(nativeCorners,[nativeA,nativeB,nativeC,nativeD],'native root and original height vertices retained');
console.log('sector mesh patch parity: native fans, support, slanted seams, dry boundary root topology and wet/saddle/concave/stitched guards PASS');
