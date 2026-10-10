'use strict';
const assert=require('node:assert/strict');
const {applyRoadPhysicalBindings}=require('./lib/sector-grading');
const {groundHeight}=require('../src/server/sector-surface');
const field={samplesX:2,samplesY:2,width:380,depth:300,heights:[0,0,0,0]};
function sector(type='road') {
  return {zoneId:'road-binding-test',locationId:'road-binding-test',width:320,depth:320,
    mapMinX:40,mapMinY:40,mapSpan:20,datum:0,gain:160,
    waterIndices:[],waterVertices:[],waterEdges:[],hydroCuts:[],bridges:[],
    railInfrastructure:[],foundations:[],corridors:[],
    roads:[{id:'access',type,halfWidth:2.5,a:{x:0,z:0},b:{x:80,z:0},blocked:false}]};
}
const p=sector();
const contour=[[0,0],[30,20],[80,0]];
applyRoadPhysicalBindings([p],field,[{zone:p.zoneId,road:'access',phase:1,
  route:contour,preferredGrade:.45,landing:8,earthworkHalfWidth:4.75,preserveControls:true}]);
assert.equal(p.roads[0].type,'road');
assert.equal(p.roads[0].halfWidth,2.5);
assert.deepEqual(p.roads[0].a,{x:0,z:0});
assert.deepEqual(p.roads[0].b,{x:80,z:0});
assert.ok(p.roads[0].points.some(q=>q.z>18),'The authored dry contour must be used');
assert.ok(p.roads[0].points.some(q=>q.x===30&&q.z===20),'The fixed contour control must be a real supporting vertex');
assert.equal(p.corridors[0].halfWidth,4.75);
assert.ok(p.corridors[0].points.every(q=>Math.abs(groundHeight(p,field,q.x,q.z)-q.h)<1e-9));
const again=structuredClone(p);
applyRoadPhysicalBindings([again],field,[{zone:again.zoneId,road:'access',phase:1,
  route:contour,preferredGrade:.45,landing:8,earthworkHalfWidth:4.75,preserveControls:true}]);
assert.deepEqual(again,p,'Replaying a contour must not accumulate earthworks');
assert.throws(()=>applyRoadPhysicalBindings([sector()],field,[{zone:p.zoneId,road:'access',phase:1,
  route:[[1,0],[80,0]],earthworkHalfWidth:4.75}]),/moved a fixed endpoint/);
assert.throws(()=>applyRoadPhysicalBindings([sector()],field,[{zone:p.zoneId,road:'access',phase:1,
  preferredGrade:.56}]),/Invalid physical road grade/);
const shared=sector('track');
shared.roads.push({id:'site',type:'track',halfWidth:2.5,a:{x:0,z:0},b:{x:40,z:60},blocked:false});
applyRoadPhysicalBindings([shared],field,[{zone:shared.zoneId,road:'access',phase:1,earthworkHalfWidth:4.75},
  {zone:shared.zoneId,road:'site',phase:1,trunk:'access',branch:{x:40,z:0},landing:4,earthworkHalfWidth:4.75}]);
const trunk=shared.corridors.find(c=>c.id===shared.zoneId+'_access');
const site=shared.corridors.find(c=>c.id===shared.zoneId+'_site');
const branch=trunk.points.findIndex(q=>Math.abs(q.x-40)<.01);
assert.ok(branch>0);
assert.deepEqual(site.points.slice(0,branch+1),trunk.points.slice(0,branch+1),
  'The approach must share its trunk position and supporting height until the branch');
assert.deepEqual(shared.roads[1].b,{x:40,z:60});
const bend=sector('track');
bend.roads[0].b={x:50,z:50};
const roundedRecipe={zone:bend.zoneId,road:'access',phase:1,
  route:[[0,0],[50,0],[50,50]],turn:{x:50,z:0,radius:8},
  earthworkHalfWidth:4.75,preserveControls:true};
applyRoadPhysicalBindings([bend],field,[roundedRecipe]);
assert.ok(bend.roads[0].points.some(q=>q.x>42&&q.x<50&&q.z>0&&q.z<8),
  'The supporting route must have a curved inner lane at the authored bend');
assert.ok(!bend.roads[0].points.some(q=>q.x===50&&q.z===0),
  'The abrupt road corner must be replaced by the supporting arc');
const bendAgain=structuredClone(bend);
applyRoadPhysicalBindings([bendAgain],field,[roundedRecipe]);
assert.deepEqual(bendAgain,bend,'A repeated bend rebuild must retain the same geometry');
const bridgeApproach=sector('track');
bridgeApproach.bridges.push({id:'crossing',a:{x:30,z:0},b:{x:50,z:0},halfWidth:4,height:2});
applyRoadPhysicalBindings([bridgeApproach],field,[{zone:bridgeApproach.zoneId,
  road:'access',phase:1,bridgeLandingRun:4,earthworkHalfWidth:4.75}]);
const landing=bridgeApproach.corridors[0].points.filter(q=>(q.x>=26&&q.x<=30)||(q.x>=50&&q.x<=54));
assert.ok(landing.length>=4);
assert.ok(landing.every(q=>Math.abs(q.h-2)<1e-7),
  'Both dry bridge landings must support the deck height before a wheel reaches it');
assert.ok(Math.abs(groundHeight(bridgeApproach,field,29.9,1.25,true)
  -groundHeight(bridgeApproach,field,30.1,1.25,true))<.01,
  'The dry wheel track must meet the actual deck without a height jump');
assert.throws(()=>applyRoadPhysicalBindings([sector()],field,[{zone:p.zoneId,road:'access',phase:1,
  bridgeLandingRun:-1}]),/Invalid physical road grade/);
console.log('Physical road bindings: dry contour, fixed gates, unchanged pavement width and repeat rebuild PASS');
