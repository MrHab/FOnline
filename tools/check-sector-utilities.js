'use strict';
const assert=require('node:assert/strict');
const {utilityBlockers}=require('../src/server/sector-utilities');
const {circleBlockerPenalty}=require('../src/server/location-collision');
const {groundHeight}=require('../src/server/sector-surface');
const field={samplesX:2,samplesY:2,width:380,depth:300,heights:[0,0,0,0]};
assert.deepEqual(utilityBlockers({},field),[],'an initial authoring profile without utility arrays is valid');
const pierOnly={railSupports:[{id:'early-pier',x:0,z:0,h:10,g:0,halfLength:1.1,halfWidth:2.2,rotationY:0}]};
assert.ok(utilityBlockers(pierOnly,field).some(b=>b.id==='early-pier'),'a profile without pipes still exports its freight support');
function profile(points,radius=.2,supports=[]) {
 return {width:320,depth:320,mapMinX:0,mapMinY:0,mapSpan:20,gain:160,datum:0,waterVertices:[],waterIndices:[],waterEdges:[],foundations:[],corridors:[],roads:[],bridges:[],processPipes:[{id:'pipe',halfWidth:radius,points,supports}]};
}
function obstructs(p,x,z,radius=.25) {return utilityBlockers(p,field).some(b=>circleBlockerPenalty(x,z,radius,b)>0);}
assert.ok(obstructs(profile([{x:-4,z:-4,h:1},{x:4,z:4,h:1}]),2,2),'a diagonal pipe stops a body at its actual centreline');
assert.ok(!obstructs(profile([{x:-4,z:-4,h:1},{x:4,z:4,h:1}]),2,-2),'the diagonal pipe does not fill the whole bounding square');
assert.ok(!obstructs(profile([{x:-4,z:0,h:3},{x:4,z:0,h:3}]),0,0),'an overhead pipe leaves its passage open');
assert.ok(!obstructs(profile([{x:-4,z:0,h:-.4},{x:4,z:0,h:-.4}]),0,0),'buried pipe does not stop a walking body');
assert.ok(obstructs(profile([{x:0,z:0,h:-.4},{x:0,z:0,h:3}]),.25,0),'the vertical riser has its circular physical obstruction');
assert.ok(!obstructs(profile([{x:0,z:0,h:-.4},{x:0,z:0,h:3}]),.6,0),'the riser does not obstruct points beyond its circle');
const rising=profile([{x:-4,z:0,h:0},{x:4,z:0,h:4}]);
assert.ok(obstructs(rising,-2,0),'the low end of an inclined pipe stops a walking body');
assert.ok(!obstructs(rising,3,0),'the high end of an inclined pipe leaves head clearance');
assert.ok(obstructs(profile([{x:-4,z:0,h:3},{x:4,z:0,h:3}],.2,[{x:0,z:0,g:0,h:2.8}]),0,0),'a real support remains solid below an overhead pipe');
console.log('PASS: pipe body band, diagonal footprint, riser, buried/overhead clearance and support collision.');
const freight=profile([]);
freight.railSupports=[{id:'pier',x:0,z:0,h:10,g:0,halfLength:1.1,halfWidth:2.2,rotationY:Math.PI/4}];
assert.ok(obstructs(freight,1,-1),'a diagonal viaduct pier blocks its actual transverse width');
assert.ok(!obstructs(freight,2,2),'the pier leaves the longitudinal clearance beyond its footprint');
freight.railBarriers=[{id:'service',x:10,z:10,halfLength:.2,halfWidth:3.85,rotationY:Math.PI/4}];
assert.ok(obstructs(freight,12,8),'a locked freight gate covers the full bore width');
assert.ok(!obstructs(freight,13.5,6.5),'a public detour beyond the visible gate stays open');
console.log('PASS: freight piers and locked service gate footprints, diagonal orientation and public bypass.');
const retaining=profile([]);
retaining.roadBankWalls=[{id:'road-bank',points:[{x:0,z:0,outerX:0,outerZ:.5,top:4,bottom:-.6},
 {x:4,z:4,outerX:4,outerZ:4.5,top:4,bottom:-.6}]}];
assert.ok(obstructs(retaining,2,2.25),'a retaining wall blocks its actual oblique concrete footprint');
assert.ok(!obstructs(retaining,2,1.5),'the clear road side of a retaining wall stays open');
assert.ok(!obstructs(retaining,0,4),'the wall does not block the empty corners of its bounding box');
assert(Math.abs(circleBlockerPenalty(2,2.25,.25,utilityBlockers(retaining,field)[0])-(.25+.25/Math.sqrt(2)))<1e-10,
 'polygon collision uses the distance to the actual wall face');
const soil=groundHeight(retaining,field,2,2.5);
const derived=structuredClone(retaining.roadBankWalls);
for(const point of derived[0].points)point.outerZ+=.25;
retaining.roadBankContactWalls=derived;retaining.hasRoadBankContactWalls=true;
assert.ok(obstructs(retaining,2,2.6),'the derived wall collider follows its actual shifted outer face');
assert.ok(!obstructs(retaining,2,1.5),'derived wall keeps the road-side clearance');
assert.equal(groundHeight(retaining,field,2,2.5),soil,'fitting concrete does not alter authoritative terrain');
const footing=[{id:'road-bank_foot_0',points:[
 {x:0,z:.75,outerX:0,outerZ:1.15,top:3.2,outerTop:-.15,bottom:-1},
 {x:4,z:4.75,outerX:4,outerZ:5.15,top:3.2,outerTop:-.15,bottom:-1}]}];
retaining.roadBankContactFootings=footing;
retaining.hasRoadBankContactFootings=true;
const solid=utilityBlockers(retaining,field);
assert.equal(solid.filter(b=>b.modelRef==='authored-road-retaining-footing').length,1,
 'the physical concrete footing has one matching server collision polygon');
assert.ok(obstructs(retaining,2,2.95,.05),'the footing blocks its actual outer strip');
assert.ok(!obstructs(retaining,2,1.5,.05),'the footing leaves the road-side lane clear');
assert.equal(groundHeight(retaining,field,2,2.5),soil,'the footing does not replace authoritative ground');
const unmarkedFoot=structuredClone(retaining);unmarkedFoot.hasRoadBankContactFootings=false;
assert.throws(()=>utilityBlockers(unmarkedFoot,field),/Unmarked retaining footing/,
 'unmarked physical footings cannot disappear from server collision');
const detachedFoot=structuredClone(retaining);detachedFoot.roadBankContactFootings[0].points[0].z+=.01;
assert.throws(()=>utilityBlockers(detachedFoot,field),/Detached retaining footing/,
 'a displaced footing cannot silently leave the concrete wall');
const foldedFoot=structuredClone(retaining);foldedFoot.roadBankContactFootings[0].points[1].outerX=-4;
assert.throws(()=>utilityBlockers(foldedFoot,field),/Folded retaining footing|Detached retaining footing/,
 'a folded footing cannot create a misleading server polygon');
const truncatedFoot=structuredClone(retaining);truncatedFoot.roadBankContactFootings[0].points.pop();
assert.throws(()=>utilityBlockers(truncatedFoot,field),/Discontinuous retaining footing/,
 'a continuous concrete footing cannot silently lose its final wall segment');
retaining.hasRoadBankContactWalls=false;
assert.throws(()=>utilityBlockers(retaining,field),/Unmarked retaining contact wall/,
 'unmarked derived collision geometry cannot silently fall back to the old wall');
retaining.hasRoadBankContactWalls=true;derived[0].points[0].x=.1;
assert.throws(()=>utilityBlockers(retaining,field),/Altered retaining inner face/,
 'a derived wall cannot move the protected road-side face');
derived[0].points[0].x=0;derived[0].points.pop();
assert.throws(()=>utilityBlockers(retaining,field),/Mismatched retaining contact wall/,
 'a truncated derived wall cannot lose a physical collider span');
delete retaining.roadBankContactFootings;delete retaining.hasRoadBankContactFootings;
delete retaining.roadBankContactWalls;delete retaining.hasRoadBankContactWalls;
retaining.roadBankWalls=[];
assert.deepEqual(utilityBlockers(retaining,field),[],'replacing the wall layout invalidates utility collision cache');
console.log('PASS: retaining wall polygon footprint, road clearance, face distance and cache invalidation.');
require('./check-sector-crossing-landings');
require('./check-sector-road-banks');
require('./check-road-bank-footings');
require('./check-sector-structural-junctions');
