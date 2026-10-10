'use strict';
const assert=require('node:assert/strict');
const {addCrossings}=require('./lib/sector-engineering');
const {bridgeHeight}=require('../src/server/sector-surface');
const field={width:400,depth:400,samplesX:2,samplesY:2,heights:[0,0,0,0]};
function profile(id,mapMinX,width=160,gain=160,waterHeight=10) {
 const v=[{x:mapMinX===0?width/2-20:-width/2,z:-10,h:waterHeight},
  {x:mapMinX===0?width/2:-width/2+20,z:-10,h:waterHeight},
  {x:mapMinX===0?width/2:-width/2+20,z:10,h:waterHeight},
  {x:mapMinX===0?width/2-20:-width/2,z:10,h:waterHeight}];
 return {zoneId:id,mapMinX,mapMinY:0,mapSpan:20,width,depth:width,gain,datum:0,
  foundations:[],bridges:[],roads:[],hydroCuts:[],waterVertices:v,waterIndices:[0,1,2,0,2,3],
  waterEdges:v.map((a,i)=>({a,b:v[(i+1)%4]})),hub:{x:0,z:0}};
}
const baseRecipe={id:'crossing',a:'left',b:'right',style:'concrete',halfWidthMap:.55,
 bankAnchors:{left:{x:40,z:0},right:{x:-40,z:0}}};
function run(recipe,heights=[10,10]) {
 const pair=[profile('left',0,160,160,heights[0]),profile('right',20,160,160,heights[1])];
 addCrossings(pair,field,{crossings:[recipe]});return pair;
}
const original=run(baseRecipe),landing=run({...baseRecipe,boundaryLandingWorld:7});
for(let j=0;j<2;j++) {
 const a=original[j].bridges[0],b=landing[j].bridges[0];
 assert.deepEqual(b.a,a.a,'a landing preserves the true first bridge endpoint');
 assert.deepEqual(b.b,a.b,'a landing preserves the true last bridge endpoint');
 for(let i=0;i<a.points.length;i++)assert(b.points[i].h>=a.points[i].h,'a landing never lowers a structural deck into water');
}
for(const distance of [0,2,4,6]) {
 const left=bridgeHeight(landing[0].bridges[0],80-distance,0),right=bridgeHeight(landing[1].bridges[0],-80+distance,0);
 assert(Math.abs(left-right)<1e-6,'both adjoining routes have the same landing elevation and tangent');
}
assert.throws(()=>run({...baseRecipe,boundaryLandingWorld:7},[0,10]),/would raise an authored true end/);
for(const value of [0,-1,Infinity,NaN,'7'])assert.throws(()=>run({...baseRecipe,boundaryLandingWorld:value}),/Invalid crossing boundary landing/);
const mixed=()=>[profile('left',0,320,160,-10),profile('right',20,160,80,-5)];
const defaultBlend=mixed(),overrideBlend=mixed();
const mixedRecipe={...baseRecipe,bankAnchors:{left:{x:140,z:0},right:{x:-64,z:0}}};
addCrossings(defaultBlend,field,{crossings:[mixedRecipe]});
addCrossings(overrideBlend,field,{crossings:[{...mixedRecipe,abutmentBlendByZone:{right:8}}]});
assert.equal(defaultBlend[1].foundations.find(f=>!f.foreign).blend,32);
assert.equal(overrideBlend[1].foundations.find(f=>!f.foreign).blend,8);
assert.equal(overrideBlend[0].foundations.find(f=>f.foreign&&f.worldKey.startsWith('right_')).blend,16,
 'the neighbouring rural profile scales the city soil blend with the shared world feature');
for(let i=0;i<2;i++)assert.deepEqual(overrideBlend[i].bridges,defaultBlend[i].bridges,'changing soil blend preserves structural bridge geometry');
console.log('PASS: shared crossing landing, exact true ends, dry deck, invalid landing rejection and scaled city soil blend.');

// Native water can remain underneath an existing dry city platform. A bridge
// must meet that dry platform without using the submerged plane as its floor.
function cityPair() {
 const pair=[profile('left',0,160,80,2.6),profile('right',20,160,80,2.6)];
 pair[0].waterVertices[0].x=20;pair[0].waterVertices[3].x=20;
 pair[0].waterEdges=pair[0].waterVertices.map((a,i)=>({a,b:pair[0].waterVertices[(i+1)%4]}));
 pair[0].foundations.push({id:'existing_city',shape:'rectangle',x:0,z:0,
  halfX:64,halfZ:40,blend:1,height:3,afterHydro:true,fillWater:true});
 return pair;
}
const cityReference=cityPair(),cityGraded=cityPair();
const waterSource=JSON.stringify(cityGraded.map(p=>[p.waterVertices,p.waterIndices,p.waterEdges]));
addCrossings(cityReference,field,{crossings:[baseRecipe]});
addCrossings(cityGraded,field,{crossings:[{...baseRecipe,maxGradeByZone:{left:.4}}]});
assert.equal(cityGraded[0].bridges[0].a.h,3,'the true dry city endpoint meets its existing platform');
assert(cityReference[0].bridges[0].a.h>3,'fixture must expose the original submerged-water clearance error');
assert.equal(JSON.stringify(cityGraded.map(p=>[p.waterVertices,p.waterIndices,p.waterEdges])),waterSource,
 'a filled-bank grade does not modify native water');
for(const point of cityGraded[1].bridges[0].points.filter(v=>v.x>=-80))
 assert.equal(point.h,bridgeHeight(cityReference[1].bridges[0],point.x,point.z),
  'the neighbouring sector retains its original deck envelope');
for(const point of cityGraded[0].bridges[0].points.filter(v=>v.x>=65&&v.x<=80))
 assert(point.h>=3.6-1e-6,'open water retains one metre of deck clearance');
for(const value of [0,-1,Infinity,NaN,'0.4'])
 assert.throws(()=>addCrossings(cityPair(),field,{crossings:[{...baseRecipe,maxGradeByZone:{left:value}}]}),
  /Invalid crossing grade/);
console.log('PASS: existing filled city endpoint, open-water clearance, native water preservation, neighbouring deck and invalid city grades.');

const newLanding=cityPair(),landingSource=JSON.stringify(newLanding.map(p=>[p.waterVertices,p.waterIndices,p.waterEdges]));
const regrade={...baseRecipe,maxGradeByZone:{left:.48,right:.25},dryFillZones:['left'],
 boundaryLandingWorld:7,regradeBoundaryLanding:true};
addCrossings(newLanding,field,{crossings:[regrade]});
assert.equal(newLanding[0].bridges[0].a.h,3,'a new shared landing retains the dry city entrance');
assert.deepEqual(newLanding[1].bridges[0].b,cityReference[1].bridges[0].b,'the other true bank retains its authored elevation');
const common=bridgeHeight(newLanding[0].bridges[0],80,0);
for(const distance of [0,1,2,3]) {
 assert.equal(bridgeHeight(newLanding[0].bridges[0],80-distance,0),common);
 assert.equal(bridgeHeight(newLanding[1].bridges[0],-80+distance,0),common);
}
assert.equal(JSON.stringify(newLanding.map(p=>[p.waterVertices,p.waterIndices,p.waterEdges])),landingSource);
for(const invalid of [
 {...regrade,maxGradeByZone:{left:.48}}, {...regrade,boundaryLandingWorld:undefined},
 {...regrade,dryFillZones:['unknown']}, {...regrade,dryFillZones:['left','left']},
 {...regrade,regradeBoundaryLanding:'true'}
])assert.throws(()=>addCrossings(cityPair(),field,{crossings:[invalid]}),/Regrade landing|Invalid crossing/);
console.log('PASS: regraded shared flat landing, preserved true bank, native water and incomplete recipe rejection.');
