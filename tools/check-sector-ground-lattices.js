'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const lattice=require('../src/server/sector-ground-lattice');
const mesh=require('../src/server/sector-mesh-patches');
const tool=require('./build-sector-ground-lattices');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const view=new DataView(new ArrayBuffer(4));
const bits=value=>{view.setFloat32(0,value,true);return view.getUint32(0,true);};
const profiles=Array.from({length:197},(_,i)=>({zoneId:`z_${String(Math.floor(i/20)+1).padStart(2,'0')}_${String(i%20+1).padStart(2,'0')}`,
 locationId:`fixture-${i}`,width:128,depth:128,gain:1,datum:0,waterIndices:[],visibleShore:[]}));
const selected=profiles.slice(0,6).map(p=>p.zoneId);
const catalog={relief:{fixture:true},profiles};
const input=Buffer.from(JSON.stringify(catalog));
assert.throws(()=>tool.argsOf(['node','tool','prepare','--input','world.json','--zones','six','--output','WORLD.json']),/overwrite --input/);
assert.throws(()=>tool.argsOf(['node','tool','prepare','--input','world.json','--zones','six','--output','cache.json','--bogus','1']),/Unknown or duplicate option/);
assert.throws(()=>tool.argsOf(['node','tool','apply','--input','world.json','--request','request.json','--export','export.json','--output','request.json']),/overwrite --request/);
const request=tool.requestFor(input,selected);
assert.equal(request.profiles.length,197);
assert.equal(request.geometryHash,lattice.geometryHash(catalog));
// Presentation switches remain part of the conservative native-cache input.
// A real city profile with this flag must prepare; unknown fields still fail.
const cityCatalog=structuredClone(catalog);
cityCatalog.profiles[0].retainingFinish=true;
cityCatalog.profiles[0].foundations=[{id:'city_platform',x:0,z:0,halfX:20,halfZ:20,height:0,blend:.075,dryCutBlend:32,afterHydro:true}];
const cityRequest=tool.requestFor(Buffer.from(JSON.stringify(cityCatalog)),selected);
assert.equal(cityRequest.profiles[0].retainingFinish,true);
assert.equal(cityRequest.profiles[0].foundations[0].dryCutBlend,32);
const cityHash=cityRequest.geometryHash;
cityCatalog.profiles[0].retainingFinish=false;
assert.notEqual(lattice.geometryHash(cityCatalog),cityHash,'Concrete finish switch invalidates the conservative native cache');
cityCatalog.profiles[0].retainingFinish=true;
cityCatalog.profiles[0].foundations[0].dryCutBlend=16;
assert.notEqual(lattice.geometryHash(cityCatalog),cityHash,'Dry hillside grading invalidates the native ground cache');
cityCatalog.profiles[0].unknownGroundAdjustment=1;
assert.throws(()=>tool.requestFor(Buffer.from(JSON.stringify(cityCatalog)),selected),/Unknown ground geometry field/);
const liningCatalog=structuredClone(catalog);
liningCatalog.profiles[0].bridgeBankRevetments=[{id:'bank',bridge:'fixture-span',end:'b',association:'native-wet-connected-fill',
 minX:-10,maxX:10,minZ:4,maxZ:10,thickness:.5,cover:.025,toeEmbed:.25,
 minSlope:1,minLift:.5,roadMargin:.73,protectionMargin:.5}];
const liningHash=lattice.geometryHash(liningCatalog);
assert.notEqual(liningHash,request.geometryHash,'authored bank lining is an explicit BASE input');
liningCatalog.profiles[0].bridgeBankRevetments[0].association='all-core';
assert.notEqual(lattice.geometryHash(liningCatalog),liningHash,'association is authored BASE policy, not a derived render selector');
liningCatalog.profiles[0].bridgeBankRevetments[0].association='native-wet-connected-fill';
liningCatalog.profiles[0].bridgeBankRevetments[0].cover=.026;
assert.notEqual(lattice.geometryHash(liningCatalog),liningHash,'authored lining mutation invalidates the geometry fingerprint');
liningCatalog.profiles[0].bridgeBankRevetments[0].cover=.025;
liningCatalog.profiles[0].bridgeBankRevetmentMeshes=[{id:'bank',vertices:[{x:1,z:2,h:3}],indices:[],prisms:[]}];
assert.equal(lattice.geometryHash(liningCatalog),liningHash,'derived lining mesh is excluded from BASE, without recursive hashing');
liningCatalog.profiles[0].bridgeBankRevetmentMeshes[0].vertices[0].h=30;
assert.equal(lattice.geometryHash(liningCatalog),liningHash,'derived geometry mutation does not alter BASE fingerprint');
liningCatalog.profiles[0].unknownBankAuthoring=1;
assert.throws(()=>lattice.geometryHash(liningCatalog),/Unknown ground geometry field/);
const n=128,vertexBits=[];
for(let iz=0;iz<=n;iz++)for(let ix=0;ix<=n;ix++)
 vertexBits.push(bits(ix-64),bits(ix===67&&iz===67?70:7),bits(iz-64));
const exported={schema:lattice.EXPORT_SCHEMA,inputSha256:sha(input),geometryHash:request.geometryHash,
 codeHash:request.codeHash,zones:request.zones.map(row=>({...row,vertexBits}))};
const cache=tool.cacheFor(request,exported);
assert.equal(cache.zones.length,6);
for(let i=0;i<6;i++){profiles[i].groundLattice=cache.zones[i];profiles[i].hasGroundLattice=true;}
assert.deepEqual(lattice.assertCatalog(catalog,{expectedZones:selected,expectedCodeHash:request.codeHash}).zones,
 [...selected].sort());
const p=profiles[0];
const dry={...profiles[20],groundLattice:{},hasGroundLattice:false};
assert.equal(lattice.regularVertex(dry,0,0,()=>({h:7})).h,7,'empty Unity dry placeholder is inactive');
assert.throws(()=>lattice.regularVertex({...dry,groundLattice:cache.zones[0]},0,0,()=>({h:7})),/without marker/);
assert.throws(()=>lattice.regularVertex({...dry,hasGroundLattice:true,groundLattice:null},0,0,()=>({h:7})),/Missing marked/);
// A normal cell well outside a refined cell still reads the native Float32
// vertex. The fallback must never be evaluated for a cached profile.
p.surfacePatches=[{ix:5,iz:5,vertices:[],indices:[]}];
const actual=mesh.triangles(p,67,67,()=>{throw Error('analytic regular fallback used');});
assert.equal(actual.length,2);
assert(actual.flat().some(v=>v.x===3&&v.z===3&&v.h===70));
assert.equal(mesh.sample(p,3,3,()=>{throw Error('analytic sampler fallback used');}).height,70);
assert.equal(lattice.regularVertex(p,67,67,()=>{throw Error('fallback used');}).h,70);
// Four refined bank cells intentionally meet one metre above the native soil
// at their shared corner. The validator must honor that recipe callback while
// keeping every exposed corner on the native lattice.
const bank=profiles[1],bankExpected=(ix,iz)=>{
 const v=lattice.regularVertex(bank,ix,iz);
 return ix===64&&iz===64?{...v,h:8}:v;
};
bank.surfacePatches=[];
for(const [ix,iz] of [[63,63],[64,63],[63,64],[64,64]]){
 const vertices=[[ix,iz],[ix+1,iz],[ix,iz+1],[ix+1,iz+1]].map(([x,z])=>bankExpected(x,z));
 bank.surfacePatches.push({ix,iz,vertices,indices:[0,2,1,1,2,3]});
}
assert.equal(mesh.validate(bank,bankExpected).ok,true,'four-cell refined bank accepts adjusted interior corner');
const wrong=mesh.validate(bank,(ix,iz)=>lattice.regularVertex(bank,ix,iz));
assert.equal(wrong.ok,false,'native soil alone cannot validate the adjusted bank corner');
assert(wrong.issues.some(issue=>issue.startsWith('changed inherited vertex')));
const unchanged=lattice.geometryHash(catalog);
profiles[100].datum=1;
assert.notEqual(lattice.geometryHash(catalog),unchanged,'neighbour geometry invalidates global cache');
assert.throws(()=>lattice.assertCatalog(catalog,{expectedZones:selected}),/Stale ground lattice geometry/);
profiles[100].datum=0;
p.visibleShore=[{a:{x:0,z:0,h:0},b:{x:1,z:1,h:0}}];
assert.throws(()=>lattice.assertCatalog(catalog,{expectedZones:selected}),/Stale ground lattice geometry/);
p.visibleShore=[];
assert.throws(()=>tool.cacheFor(request,{...exported,codeHash:'0'.repeat(64)}),/metadata mismatch/);
const truncated={...exported,zones:exported.zones.map((row,i)=>i?row:{...row,vertexBits:row.vertexBits.slice(1)})};
assert.throws(()=>tool.cacheFor(request,truncated),/row mismatch/);
const nonfinite={...exported,zones:exported.zones.map((row,i)=>i?row:{...row,vertexBits:[0x7f800000,...row.vertexBits.slice(1)]})};
assert.throws(()=>tool.cacheFor(request,nonfinite),/Non-finite/);
console.log('Ground lattice: request/export fingerprints, native bits, unpatched-cell support, stale neighbour/shore and malformed data PASS');
