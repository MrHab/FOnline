'use strict';
const assert=require('node:assert/strict');
const {applyCisternFootings}=require('./lib/sector-cistern-footings');
const {groundHeight}=require('../src/server/sector-surface');
const field={samplesX:2,samplesY:2,width:400,depth:400,heights:[0,0,0,0]};
const profile=()=>({zoneId:'z_00_00',locationId:'z_00_00',width:320,depth:320,mapMinX:0,mapMinY:0,mapSpan:20,gain:160,datum:0,
  foundations:[],roads:[],bridges:[],corridors:[],hydroCuts:[],waterIndices:[],waterVertices:[],waterEdges:[]});
const definition={objects:[{id:'reserve',model:'waterTank',tags:['zone-kit'],footprint:{x:2.5,z:1.9},position:{x:0,y:0,z:0},scale:{x:2.5,y:2.5,z:2.5}}]};
const recipe={zone:'z_00_00',id:'cistern_service_reserve',objectId:'reserve',x:0,z:0,halfX:3,halfZ:3,blend:8,height:1};
const p=profile(),original=structuredClone(p),source=structuredClone(definition);
assert.deepEqual(applyCisternFootings([p],field,{},()=>definition),[]);assert.deepEqual(p,original);
applyCisternFootings([p],field,{cisternFootings:[recipe]},()=>definition);
for(const x of [-2.9,0,2.9])for(const z of [-2.9,0,2.9])assert.equal(groundHeight(p,field,x,z),1);
assert(groundHeight(p,field,5,0)>groundHeight(p,field,9,0));assert.equal(groundHeight(p,field,12,0),0);
assert.deepEqual(definition,source,'Original model dimensions and authority unchanged');
applyCisternFootings([p],field,{cisternFootings:[recipe]},()=>definition);assert.equal(p.foundations.length,1);
const pair={objects:[{...source.objects[0],id:'a',position:{x:-1,y:0,z:-4}},
  {...source.objects[0],id:'b',position:{x:1,y:0,z:4}}]},pairProfile=profile();
applyCisternFootings([pairProfile],field,{cisternFootings:[{...recipe,objectIds:['a','b'],halfX:4,halfZ:7}]},()=>pair);
for(const row of pair.objects)assert.equal(groundHeight(pairProfile,field,row.position.x,row.position.z),1,'Adjacent reserves share one supporting plane');
const invalid=profile();assert.throws(()=>applyCisternFootings([invalid],field,{cisternFootings:[recipe,{...recipe,id:'bad',x:1}]},()=>definition),/does not support/);
assert.deepEqual(invalid,original,'Invalid later recipe cannot partially apply');
const wet=profile();wet.waterVertices=[{x:-20,z:-20,h:1},{x:20,z:-20,h:1},{x:0,z:20,h:1}];wet.waterIndices=[0,1,2];
const bed=groundHeight(wet,field,0,0);assert.throws(()=>applyCisternFootings([wet],field,{cisternFootings:[recipe]},()=>definition),/intersects water/);
assert.equal(groundHeight(wet,field,0,0),bed);assert.equal(wet.foundations.length,0);
console.log('Cistern service terraces: physical plane/blend, default parity, source dimensions, repeat, atomic rejection and river preservation PASS.');
