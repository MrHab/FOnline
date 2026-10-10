'use strict';
const assert=require('node:assert/strict');
const {reconcileJunctions}=require('./lib/sector-junctions');
const {gradeAccess,applyRoadPhysicalBindings}=require('./lib/sector-grading');
const {attachObstacles}=require('./lib/sector-obstacles');
const {sectorSourceDefinition}=require('./lib/sector-source-definition');
const profile=()=>({zoneId:'test',width:320,depth:320,mapMinX:0,mapMinY:0,mapSpan:20,gain:160,datum:0,
 foundations:[],hydroCuts:[],waterVertices:[],waterIndices:[],waterEdges:[],roads:[],corridors:[],bridges:[],hub:{x:0,z:0}});
const deck=(id,a=-20,b=40)=>({id,halfWidth:4,a:{x:a,z:0,h:a*.4},b:{x:b,z:0,h:b*.4},
 points:[{x:a,z:0,h:a*.4},{x:b,z:0,h:b*.4}]});
function junctionFixture(z=0) {
 const p=profile();p.bridges=[deck('continuous')];
 p.corridors=[[-20,-10,0],[20,30,40]].map((xs,i)=>({id:'test_road_'+i,halfWidth:2,blend:32,
  points:xs.map(x=>({x,z,h:x*.4}))}));
 return p;
}
const continuous=junctionFixture(),before=JSON.stringify(continuous.corridors);
assert.equal(reconcileJunctions([continuous]).residual,0);
assert.equal(JSON.stringify(continuous.corridors),before,'one fixed inclined deck retains its exact longitudinal heights');
const shoulders=junctionFixture(5);
assert.throws(()=>reconcileJunctions([shoulders],{maxPasses:1}),/Road junction constraints conflict/,
 'expanded corridor shoulders outside the actual deck retain earthwork constraints');
const separate=junctionFixture();separate.bridges=[deck('first',-20,0),deck('second',20,40)];
assert.throws(()=>reconcileJunctions([separate],{maxPasses:1}),/Road junction constraints conflict/,
 'different structural decks do not suppress a junction');
const limited=junctionFixture();limited.corridors[0].limits=[0,1,1];
assert.throws(()=>reconcileJunctions([limited],{maxPasses:1}),/Road junction constraints conflict/,
 'longitudinal grade constraints remain active on the structural deck');
const field={width:400,depth:400,samplesX:2,samplesY:2,heights:[0,0,0,0]};
const graded=profile();graded.bridges=[{...deck('steep',-40,40),a:{x:-40,z:0,h:0},b:{x:40,z:0,h:38.4},
 points:[{x:-40,z:0,h:0},{x:40,z:0,h:38.4}]}];
graded.roads=[{id:'gate_east',type:'track',halfWidth:2.5,a:{x:-40,z:0},b:{x:40,z:0},
 points:[{x:-40,z:0},{x:0,z:0},{x:40,z:0}]}];
const plan={roadInitialGrades:[{zone:'test',road:'gate_east',preferredGrade:.49,landing:0,preserveControls:true}]};
gradeAccess([graded],field,plan);
assert(graded.corridors.length===1&&graded.corridors[0].points.every(v=>v.z===0),
 'an authored initial grade retains the bridge axis before shared junction grading');
assert.equal(graded.corridors[0].points.at(-1).h,38.4);
for(const preferredGrade of [NaN,0,-1,.5,'0.49'])
 assert.throws(()=>gradeAccess([profile()],field,{roadInitialGrades:[{...plan.roadInitialGrades[0],preferredGrade}]}),/Invalid initial road grade/);
const branchFixture=()=>{
 const p=profile();
 p.roads=[{id:'trunk',type:'track',halfWidth:2.5,a:{x:-40,z:0},b:{x:40,z:0},points:[{x:-40,z:0},{x:40,z:0}]},
  {id:'south',type:'track',halfWidth:2.5,a:{x:-40,z:0},b:{x:0,z:-40},points:[{x:-40,z:0},{x:0,z:-40}]}];
 return p;
};
const physical={roadPhysicalBindings:[
 {zone:'test',road:'trunk',phase:1,preferredGrade:.49,landing:0,preserveControls:true},
 {zone:'test',road:'south',phase:2,trunk:'trunk',branch:{x:0,z:10},preferredGrade:.49,landing:4}
]};
assert.throws(()=>applyRoadPhysicalBindings([branchFixture()],field,physical.roadPhysicalBindings),/Site trunk branch misses graded road/,
 'a relocated trunk cannot silently detach its authored branch');
const explicit=structuredClone(physical);
explicit.roadPhysicalBindings[0].route=[[-40,0],[-24,10],[0,10],[24,10],[40,0]];
const connected=branchFixture(),endpoints=structuredClone(connected.roads.map(r=>[r.a,r.b]));
applyRoadPhysicalBindings([connected],field,explicit.roadPhysicalBindings);
assert.deepEqual(connected.roads.map(r=>[r.a,r.b]),endpoints,'an explicit trunk retains all fixed access endpoints');
const trunk=connected.corridors.find(c=>c.id==='test_trunk'),south=connected.corridors.find(c=>c.id==='test_south');
const join=trunk.points.findIndex(v=>v.x===0&&v.z===10);
assert(join>0&&join<trunk.points.length-1,'the authored branch remains an interior trunk station');
assert.deepEqual(south.points.slice(0,join+1),trunk.points.slice(0,join+1),
 'the branch shares the actual trunk geometry and heights until its authored junction');
const sourceObstacleFixture=()=>{
 const p=branchFixture();p.roads=p.roads.slice(0,1);
 const definition=sectorSourceDefinition({objects:[],surfaceSource:{removedObjects:[{
  id:'archived_barrels',model:'barrelCluster',position:{x:0,y:0,z:0},collision:'solid',
  collisionSize:{width:2,depth:2},tags:['zone-kit']
 }]}});
 attachObstacles(p,definition,field);
 return p;
};
const explicitBinding={zone:'test',road:'trunk',phase:1,preferredGrade:.49,landing:0,
 preserveControls:true,route:[[-40,0],[0,0],[40,0]]};
const blocked=sourceObstacleFixture();
assert.throws(()=>applyRoadPhysicalBindings([blocked],field,[explicitBinding]),
 /Authored physical road route cannot be graded test trunk/,
 'an archived source prop rejects an explicit route instead of silently choosing another contour');
assert.deepEqual(blocked.roads[0].points,explicitBinding.route.map(([x,z])=>({x,z})),
 'a rejected route is not replaced by an automatically generated contour');
for(const preserveControls of [true,false]) {
 const detour=sourceObstacleFixture(),route=[[-40,0],[-20,12],[20,12],[40,0]];
 applyRoadPhysicalBindings([detour],field,[{...explicitBinding,preserveControls,route}]);
 const points=detour.corridors[0].points;
 assert(points.every(v=>Math.min(...route.slice(1).map((b,i)=>{
  const a=route[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((v.x-a[0])*dx+(v.z-a[1])*dz)/(dx*dx+dz*dz)));
  return Math.hypot(v.x-a[0]-t*dx,v.z-a[1]-t*dz);
 }))<1e-8),'the source-aware detour follows its authored segments under either sampling mode');
 if(preserveControls)assert(route.every(([x,z])=>points.some(v=>Math.hypot(v.x-x,v.z-z)<1e-8)),
  'control-preserving sampling retains every authored detour point');
}
console.log('PASS: fixed actual deck, independent soil shoulders, separate bridges, longitudinal limits, authored bridge approach and preserved trunk branch.');
