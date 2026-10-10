'use strict';
const assert=require('node:assert/strict');
const {groundHeight}=require('../src/server/sector-surface');
const {buildSurfacePatches}=require('./lib/sector-surface-refinements');
// A raised dry causeway crosses the native water polygon's boundary at x=0.
// Its visible bank lies beyond the road. Refining that cell must preserve the
// road while still lowering the actual bank and retaining the submerged bed.
const field={width:760,depth:600,samplesX:2,samplesY:2,heights:[-.00625,-.00625,-.00625,-.00625]};
const waterVertices=[{x:0,z:-64,h:0},{x:64,z:-64,h:0},{x:64,z:64,h:0},{x:0,z:64,h:0}];
const profile={zoneId:'fixture-bank-road',locationId:'fixture-bank-road',width:128,depth:128,gain:160,datum:0,
 mapMinX:100,mapMinY:100,mapSpan:20,terrainSegments:128,waterVertices,waterIndices:[0,1,2,0,2,3],
 waterEdges:[{a:waterVertices[0],b:waterVertices[3]},{a:waterVertices[0],b:waterVertices[1]},
 {a:waterVertices[1],b:waterVertices[2]},{a:waterVertices[2],b:waterVertices[3]}],
 visibleShore:[{a:{x:1.2,z:-62,h:0},b:{x:1.2,z:62,h:0}}],
 foundations:[{shape:'rectangle',x:0,z:0,halfX:1,halfZ:64,height:10,blend:.2,afterRoads:true,fillWater:true}],
 bridges:[],roads:[],corridors:[],hydroCuts:[],railInfrastructure:[]};
const result=buildSurfacePatches(profile,field,{shore:true,steep:true,subdivision:4,ring:1,bankBand:.5});
assert(result.validation.ok&&result.serializedValidation.ok);
const at=(x,z)=>result.cells.flatMap(cell=>cell.vertices).filter(v=>Math.abs(v.x-x)<1e-6&&v.z===z);
const road=at(0,0),bank=at(.9,0),bed=at(2,0);
assert(road.length&&bank.length&&bed.length,'fixture visits the road, bank and open bed');
const roadFloor=groundHeight(profile,field,0,0,false)-.05;
assert(road.every(v=>Math.abs(v.h-roadFloor)<.00001),'native water edge cannot carve the raised road');
assert(bank.every(v=>v.h>0&&v.h<groundHeight(profile,field,.9,0,false)-.05),
 'prepared visible bank retains its descending skirt');
assert(bed.every(v=>v.h<0),'the open river bed remains below water');
const noSkirt=buildSurfacePatches(profile,field,{shore:true,steep:true,subdivision:4,ring:1,bankBand:.5,bankSkirt:false});
assert(noSkirt.validation.ok&&noSkirt.serializedValidation.ok);
const unlowered=noSkirt.cells.flatMap(cell=>cell.vertices).filter(v=>Math.abs(v.x-.9)<1e-6&&v.z===0);
assert(unlowered.length,'the natural-bank variant visits the same prepared bank');
assert(unlowered.every(v=>Math.abs(v.h-(groundHeight(profile,field,v.x,v.z,false)-.05))<.00001),
 'disabling artificial skirt preserves the source bank height, without disabling clipping or the seam halo');
assert(noSkirt.cells.flatMap(cell=>cell.vertices).filter(v=>v.x===0&&v.z===0)
 .every(v=>Math.abs(v.h-roadFloor)<.00001),'natural-bank refinement also preserves the raised road');
console.log('Sector bank surface: raised road at hidden water seam, visible bank skirt and submerged bed PASS');
{
const d=require('../src/server/sector-utilities');
const p={zoneId:'bank-fixture',width:40,depth:40,groundLattice:{profileGeometryHash:'a'.repeat(64)},bridges:[{id:'bridge',halfWidth:1,points:[{x:0,z:0},{x:0,z:18}]}],roads:[{id:'curve',type:'road',halfWidth:.5,points:[{x:6,z:5},{x:8,z:7},{x:8,z:10}]}]};
const c={id:'bank',bridge:'bridge',end:'a',association:'native-wet-connected-fill',minX:-10,maxX:10,minZ:4,maxZ:10.5,thickness:.5,cover:.025,toeEmbed:.25,minSlope:1,minLift:.5,roadMargin:.73,protectionMargin:.5};

// A genuine native Float32 indexed fixture backs both the server validator
// and the association test. The native water polygon is not a height-only
// approximation; the right/dry component below is tested separately.
p.hasGroundLattice=true;p.terrainSegments=128;p.surfacePatches=[];p.gain=160;p.datum=10;p.mapMinX=0;p.mapMinY=0;p.mapSpan=20;
const nativeBits=[],view=new DataView(new ArrayBuffer(4));for(let iz=0;iz<=128;iz++)for(let ix=0;ix<=128;ix++){
 const x=-20+40*ix/128,z=-20+40*iz/128;for(const v of [x,10-2*z,z]){view.setFloat32(0,v,true);nativeBits.push(view.getUint32(0,true));}}
p.groundLattice={...p.groundLattice,schema:'roa.groundLattice.v1',zoneId:p.zoneId,segments:128,
 geometryHash:'a'.repeat(64),codeHash:'a'.repeat(64),vertexBits:nativeBits};
p.waterVertices=[{x:-20,z:4,h:-9.8},{x:20,z:4,h:-9.8},{x:20,z:20,h:-9.8},{x:-20,z:20,h:-9.8}];
p.waterIndices=[0,1,2,0,2,3];p.waterEdges=p.waterVertices.map((a,i)=>({a,b:p.waterVertices[(i+1)%4]}));
const nativeWater=(x,z)=>require('../src/server/sector-surface').waterAt(p,x,z);
const tris=[];for(let x=-9;x<9;x+=.5)for(let z=4;z<10.5;z+=.5){const q=(x,z)=>({x,z,h:10-2*z});const a=q(x,z),b=q(x+.5,z),v=q(x,z+.5),e=q(x+.5,z+.5);tris.push([a,v,b],[b,v,e]);}
const input=JSON.stringify({p,tris}),result=d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-9.8,nativeWater});
assert.equal(JSON.stringify({p,tris}),input);assert(result.stats.protected>0);assert(result.stats.toeVertices>0);
const m=result.mesh,blocks=d.validateBridgeBankRevetment(p,c,m);assert.equal(blocks.length,result.stats.faces);
let exactToes=0;
for(let i=0;i<m.vertices.length;i+=2){const q=m.vertices[i],source=10-2*(q.z-c.cover);
  if(q.h<source-.0015){assert(Math.abs(q.h-(Math.min(source,10-2*q.z)-c.toeEmbed))<.00001,
    'a boundary vertex shared by two caps subtracts toeEmbed exactly once');exactToes++;}}
assert.equal(exactToes,result.stats.toeVertices);
const localWater=d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,water:(x,z)=>x<0?-9.8:-30,nativeWater});
assert(localWater.stats.toeVertices>0&&localWater.stats.toeVertices<result.stats.toeVertices,
  'local recipe water can only restrict toe lowering below the actual native water plane');
for(let i=0;i<m.prisms.length;i+=6){const v=m.prisms.slice(i,i+3).map(j=>m.vertices[j]),lowered=v.some(q=>q.h<10-2*(q.z-c.cover)-.0015);
 if(lowered)assert(v.every(q=>q.h<=Math.fround(nativeWater(q.x,q.z).height)+.0015),'a lowered triangle stays wholly underwater');}
const crossing=JSON.parse(JSON.stringify(m)),face=crossing.prisms.slice(0,3),q=crossing.vertices[face[0]],back=crossing.vertices[face[0]+1];
q.h=back.h=Math.fround(q.h-.25);crossing.geometryHash=d.bankRevetmentGeometryHash(crossing);
assert.throws(()=>d.validateBridgeBankRevetment(p,c,crossing),/Detached bank toe|Exposed bank front deformation/,
 'rehashing an above-water toe deformation cannot make it valid');
assert.throws(()=>d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-9.8,
 nativeWater:(x,z)=>({...nativeWater(x,z),height:x<0?-9.8:-9.7})}),/Non-flat native bank water plane/);
const edgeOrder=d.buildBridgeBankRevetment(p,c,tris.map(t=>[t[1],t[2],t[0]]),{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-9.8,nativeWater});
const points=mesh=>[...new Set(mesh.vertices.map(v=>[v.x,v.h,v.z].join(',')))].sort();assert.deepEqual(points(edgeOrder.mesh),points(m),
 'canonical cached reversed-edge intersections share identical Float32 positions');
const onWater=d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-10,
 nativeWater:(x,z)=>({...nativeWater(x,z),height:-10})});
assert(onWater.stats.toeVertices>0);assert(d.validateBridgeBankRevetment(p,c,onWater.mesh,{ground:(x,z)=>10-2*z,
 nativeWater:(x,z)=>({...nativeWater(x,z),height:-10}),natural:()=>-20}).length>0,'edge-on-water is a closed unlowered shared seam');
assert.equal(m.indices.length,6*result.stats.faces+6*result.stats.boundaryEdges,'only boundary edges receive caps');
for(let i=0;i<m.prisms.length;i+=6){const [a,b,c]=m.prisms.slice(i,i+3).map(j=>m.vertices[j]);assert((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)<0,'front normals point upward and outwards');}
const bad=JSON.parse(JSON.stringify(m));bad.indices.splice(0,3);bad.geometryHash=d.bankRevetmentGeometryHash(bad);assert.throws(()=>d.validateBridgeBankRevetment(p,c,bad),/Open/);
const shifted=JSON.parse(JSON.stringify(m));for(const v of shifted.vertices)v.x=Math.fround(v.x+5);shifted.geometryHash=d.bankRevetmentGeometryHash(shifted);assert.throws(()=>d.validateBridgeBankRevetment(p,c,shifted),/intrusion/);
const width=JSON.parse(JSON.stringify(m));width.vertices[1].z=Math.fround(width.vertices[1].z+.1);width.geometryHash=d.bankRevetmentGeometryHash(width);assert.throws(()=>d.validateBridgeBankRevetment(p,c,width),/thickness/);
assert.throws(()=>d.validateBridgeBankRevetment({...p,roads:[{...p.roads[0],halfWidth:2}]},c,m),/Stale/);
assert.throws(()=>d.bankRevetmentRecipe(p,{...c,thickness:.8}),/Invalid/);
assert.throws(()=>d.bankRevetmentRecipe(p,{...c,minZ:NaN}),/Invalid/);
// A closed unsplit triangle can have an individually correct underwater toe
// while its upper vertices remain exposed. The face-level gate must reject it.
const crossed={id:c.id,sourceHash:d.bankRevetmentSourceHash(p,c),vertices:[],indices:[0,2,4,1,5,3,0,1,2,2,1,3,2,3,4,4,3,5,4,5,0,0,5,1],prisms:[0,2,4,1,3,5]};
for(const q of [{x:-9,z:9.5,h:-9},{x:-9,z:10.5,h:-11.3},{x:-8.5,z:9.5,h:-9}])crossed.vertices.push(
 {x:Math.fround(q.x),z:Math.fround(q.z+c.cover),h:Math.fround(q.h)},
 {x:Math.fround(q.x),z:Math.fround(q.z+c.cover-c.thickness),h:Math.fround(q.h)});
crossed.geometryHash=d.bankRevetmentGeometryHash(crossed);
assert.throws(()=>d.validateBridgeBankRevetment(p,c,crossed),/Exposed bank front deformation/,
 'a correct individual toe cannot deform a triangle crossing above native water');
const closeWater=Math.fround(-9.999),nearPin=d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:closeWater,
 nativeWater:(x,z)=>({...nativeWater(x,z),height:closeWater})});
const pinned=nearPin.mesh.vertices.filter((q,i)=>i%2===0&&Math.abs((10-2*(q.z-c.cover))-closeWater)<=.0015);
assert(pinned.length&&pinned.every(q=>q.h===closeWater),'native source vertices inside 1.5mm waterline band are pinned and never lowered');
const support={ground:(x,z)=>10-2*z,nativeWater,natural:()=>-20};
const gapNatural=(x,z)=>(10-2*z)-(z<9.75?1:.25);
const gap=d.buildBridgeBankRevetment(p,c,tris,{...support,natural:gapNatural,waterHeight:-9.8});
assert(gap.stats.continuation.addedFaces>0,'positive-lift native-wet toe faces close the minLift seed gap');
assert(gap.mesh.vertices.some(q=>q.z>10.4),'the retained engineered bank reaches its actual wet toe');
assert.throws(()=>d.buildBridgeBankRevetment(p,c,tris,{...support,natural:(x,z)=>10-2*z,waterHeight:-9.8}),/Empty|seed/,
 'a natural wet bank without raised seed cannot acquire concrete');
assert.throws(()=>d.validateBridgeBankRevetment(p,c,m,{...support,natural:(x,z)=>10-2*z}),/lacks engineered seed/);
const stale={...m,sourceHash:'legacy-policy'};stale.geometryHash=d.bankRevetmentGeometryHash(stale);
assert.throws(()=>d.validateBridgeBankRevetment(p,c,stale),/Stale/,'previous partial-coverage policy must not be accepted');
// A dry upper toe row is inside the native-water polygon and half-metre
// band. Its lower neighbour has actual wet contact. Their complete indexed
// edge chain, not individual wet contact on every row, closes the lining.
const quarter=[];for(let x=-9;x< -7.5;x+=.5)for(let z=9.5;z<10.5;z+=.25){
 const q=(x,z)=>({x,z,h:10-2*z}),a=q(x,z),b=q(x+.5,z),u=q(x,z+.25),v=q(x+.5,z+.25);quarter.push([a,u,b],[b,u,v]);}
const upperNatural=(x,z)=>(10-2*z)-(x< -8.5?1:.25);
const upper=d.buildBridgeBankRevetment(p,c,quarter,{...support,natural:upperNatural,waterHeight:-9.8});
function frontAt(mesh,x,z){for(let i=0;i<mesh.prisms.length;i+=6){const [a,b,c]=mesh.prisms.slice(i,i+3).map(j=>mesh.vertices[j]),den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z),u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;if(Math.min(u,v,1-u-v)>=-1e-7)return true;}return false;}
assert(frontAt(upper.mesh,-8.25,9.625+c.cover),'upper row reaches its wet lower row through full indexed edges');
const upperOuter=10-2*(9.75+c.cover);assert(upperOuter>Math.fround(nativeWater(-8.25,9.75+c.cover).height)+.0015,
 'the fixture upper row actually has no individually wet corner');
const pointOnly=[{x:-7.5,z:10.25,h:10-2*10.25},{x:-7,z:10.25,h:10-2*10.25},{x:-7,z:10.5,h:10-2*10.5}];
const isolated=d.buildBridgeBankRevetment(p,c,[...quarter,pointOnly],{...support,natural:upperNatural,waterHeight:-9.8});
assert(isolated.mesh.vertices.every(q=>q.x<=-7.5),'point contact cannot acquire a disconnected wet toe triangle');
const drySeedNatural=(x,z)=>(10-2*z)-(x< -8.5||x>=-8?1:.25);
const drySeedWater=(x,z)=>({...nativeWater(x,z),inside:x< -8});
const drySeed=d.buildBridgeBankRevetment(p,c,quarter,{...support,natural:drySeedNatural,nativeWater:drySeedWater,waterHeight:-9.8});
assert(drySeed.stats.association.excludedComponents>0&&drySeed.mesh.vertices.every(q=>q.x<=-8),
 'a previously excluded dry original seed stays excluded even beside the new edge chain');
const receipt={schema:'roa.bankRevetmentSyntheticFixture.v952',passed:true,inputUnchanged:true,stats:result.stats,checks:['closed actual volume','no internal caps','outward front normals','toe embed','whole swept bridge/curved road capsule protection','same-volume server blockers','open shell rejected','protected intrusion rejected','thickness mutation rejected','stale route rejected','nonfinite/unsafe recipe rejected'],NativeAcceptance:false};
console.log('Sector bank revetment: closed indexed shell, toe, protected full deck/curved road and volume mutations PASS');

  assert.throws(()=>d.utilityBlockers({...p,bridgeBankRevetments:[c]},null),/Missing bridge bank revetment/);
  assert.deepEqual(d.utilityBlockers({...p,bridgeBankRevetments:[c]},null,{allowPendingRevetment:true}),[],
    'only the explicit initial authoring stage may defer derived collision');
  assert.equal(d.utilityBlockers({...p,bridgeBankRevetments:[c],bridgeBankRevetmentMeshes:[m]},null).length,blocks.length);
  const missing=JSON.parse(JSON.stringify(m));missing.prisms.splice(0,6);missing.geometryHash=d.bankRevetmentGeometryHash(missing);
  assert.throws(()=>d.validateBridgeBankRevetment(p,c,missing),/volume mismatch/,'renderer triangles cannot disappear from server collision');
  assert.throws(()=>d.validateBridgeBankRevetment({...p,groundLattice:{profileGeometryHash:'b'.repeat(64)}},c,m),/Stale/);
  assert.throws(()=>d.bankRevetmentRecipe(p,{...c,unexpected:true}),/Invalid/);
  for(const association of [undefined,'all-core','legacy','unknown'])assert.throws(()=>d.bankRevetmentRecipe(p,{...c,association}),/Invalid/);
  assert.notEqual(d.bankRevetmentSourceHash(p,c),d.bankRevetmentSourceHash(p,{...c,association:'all-core'}),'the policy is a hashed BASE input, even before enum validation');
  const dryNative=(x,z)=>({...nativeWater(x,z),inside:x<0});
  const dryFiltered=d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-9.8,nativeWater:dryNative});
  assert.equal(dryFiltered.stats.association.keptComponents,1);assert(dryFiltered.stats.association.excludedFaces>0);
  assert(dryFiltered.mesh.vertices.every(q=>q.x<0),'a separate dry component is removed from the actual mesh, not its renderer alone');
  assert.throws(()=>d.buildBridgeBankRevetment(p,c,tris,{natural:()=>-20,ground:(x,z)=>10-2*z,waterHeight:-9.8,nativeWater:(x,z)=>({...nativeWater(x,z),inside:false})}),/No native-wet-connected/);
  const detached={...p,waterVertices:p.waterVertices.map(q=>({...q,x:q.x+100}))};
  assert.throws(()=>d.validateBridgeBankRevetment(detached,c,m),/Detached non-wet/,'even a freshly hashed closed volume must have an actual native wet toe');
  console.log('Sector bank association: actual indexed native-water seed, edge-connected selection, dry exclusion, missing/unknown/legacy policy rejection PASS');
}

// A water clipping root only 5 micrometres from its inherited corner is
// the exact same Unity Float32 position. Both selected cells must share
// the original endpoint rather than create a collapsed native triangle.
{
const field={width:760,depth:600,samplesX:2,samplesY:2,heights:[-.00625,-.00625,-.00625,-.00625]};
const a={x:-159.23317,z:-172.66548,h:0},b={x:-132.19849,z:-151.37817,h:0},c={x:-132.19849,z:-200,h:0};
const p={zoneId:'endpoint-f32-fixture',locationId:'endpoint-f32-fixture',width:320,depth:320,gain:160,datum:0,mapMinX:100,mapMinY:100,mapSpan:20,terrainSegments:128,
waterVertices:[a,b,c],waterIndices:[0,1,2],waterEdges:[{a,b},{a:b,b:c},{a:c,b:a}],
visibleShore:[{a:{x:-141,z:-157,h:0},b:{x:-141.01,z:-157.01,h:0}}],
foundations:[{shape:'rectangle',x:-141,z:-157,halfX:.2,halfZ:.2,height:10,blend:.5,afterRoads:true,fillWater:true}],bridges:[],roads:[],corridors:[],hydroCuts:[],railInfrastructure:[]};
const options={shore:true,subdivision:4,ring:1};

const result=buildSurfacePatches(p,field,options);
assert(result.validation.ok);
const left=result.cells.find(c=>c.ix===6&&c.iz===0),right=result.cells.find(c=>c.ix===7&&c.iz===0);
assert(left&&right,'both cells at the actual snapped southern bank participate');
const endpoint=right.vertices[0];
assert.equal(right.vertices.filter(v=>Math.fround(v.x)===Math.fround(endpoint.x)&&Math.fround(v.z)===Math.fround(endpoint.z)&&Math.fround(v.h)===Math.fround(endpoint.h)).length,1,'one native endpoint');
for(const cell of [left,right])for(let i=0;i<cell.indices.length;i+=3){const [a,b,c]=cell.indices.slice(i,i+3).map(id=>cell.vertices[id]).map(v=>({x:Math.fround(v.x),z:Math.fround(v.z)}));assert(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))>1e-7,'no Float32 collapsed clipping triangle');}
}
