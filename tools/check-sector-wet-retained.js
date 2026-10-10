'use strict';
const assert=require('node:assert/strict');
const {retainedAreaIndex,rescueDeadContactJunctions}=require('./lib/sector-wet-retained');

const triangle=[{x:0,z:0,y:0},{x:1,z:0,y:0},{x:0,z:1,y:0}];
const profile={zoneId:'wet-retained-fixture',width:2,depth:2,terrainSegments:1,
  waterVertices:triangle.map(v=>({x:v.x,z:v.z,h:v.y})),waterIndices:[0,1,2],
  waterEdges:[{a:{x:0,z:0,h:0},b:{x:0,z:1,h:0}}]};
const regular=(ix,iz)=>({x:ix*2-1,z:iz*2-1,h:0});
const area=retainedAreaIndex([triangle],profile,regular);

// A line just outside the positive triangle has no retained water. A fixed
// signed-area epsilon previously manufactured a narrow interval here.
const outside={x:-5e-9,z:.5};
assert.deepEqual(area.intervals(outside,{x:0,z:1}),[]);
assert.equal(area.wetPoint(outside.x,outside.z),false);
assert.deepEqual(area.noAreaEdges([{kind:'contact',a:{x:-5e-9,z:.5,h:0},
  b:{x:.1,z:.5,h:0}}]),[0]);

// A real edge of the saved fan remains supported at all four float samples.
assert.deepEqual(area.noAreaEdges([{kind:'contact',a:{x:0,z:.2,h:0},
  b:{x:0,z:.8,h:0}}]),[]);

// A tangent domain corner is accepted only at an exact retained fan vertex
// with a strict interior wet witness and matching ground/native support.
assert.equal(area.cornerWitness({x:0,z:0},'domainEdge'),true);
assert.equal(area.cornerWitness({x:-1e-7,z:0},'domainEdge'),false);
assert.equal(area.cornerWitness({x:0,z:0},'contact'),true);

// Two physically distinct endpoints can alias after a supported Float32
// relocation. Reject that first proposal and use the next wet point while
// preserving the closed four-edge graph.
const start={x:Math.fround(.10004),z:.5,h:0};
const neighbor={x:Math.fround(.10006),z:.5,h:0};
const points=[start,neighbor,{x:.4,z:.55,h:0},{x:.05,z:.55,h:0}];
const edges=points.map((a,i)=>({kind:'contact',a,b:points[(i+1)%points.length]}));
const key=v=>`${Math.round(v.x*1e4)},${Math.round(v.z*1e4)}`;
const collision={x:Math.fround(.100055),z:.5};
const safe={x:Math.fround(.10001),z:.5};
assert.notEqual(key(start),key(neighbor));
assert.equal(key(collision),key(neighbor));
const fixtureArea={...area,
 noAreaEdges:rows=>rows===edges&&rows[0].a===start?[0]:[],
 nearbyWetCandidates:()=>[collision,safe]};
const rescue=rescueDeadContactJunctions(profile,null,regular,edges,fixtureArea);
assert.equal(rescue.fixed,1);
assert.equal(edges[0].a.x,safe.x);
assert.equal(edges[3].b,edges[0].a);
const degrees=new Map();
for(const edge of edges){
 assert.notEqual(key(edge.a),key(edge.b),'relocation must not collapse an edge');
 for(const v of [edge.a,edge.b])degrees.set(key(v),(degrees.get(key(v))||0)+1);
}
assert.equal(degrees.size,edges.length);
assert.ok([...degrees.values()].every(value=>value===2));
assert.deepEqual(rescue.bad,[]);
console.log('sector retained wet contour: exact fan, disconnected branch, domain corner PASS');
