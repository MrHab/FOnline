'use strict';

const assert=require('node:assert/strict');
const {routeOnLand}=require('./lib/sector-access');
const {groundHeight}=require('../src/server/sector-surface');

const flatField=height=>({samplesX:2,samplesY:2,width:380,depth:300,
  heights:[height,height,height,height]});
const profile=()=>({zoneId:'actor-test',locationId:'actor-test',width:320,depth:320,
  mapMinX:40,mapMinY:40,mapSpan:20,datum:0,gain:1,
  waterIndices:[],waterVertices:[],waterEdges:[],visibleShore:[],hydroCuts:[],
  bridges:[],roads:[],railInfrastructure:[],foundations:[],corridors:[],
  obstacles:[],staticBlockers:[],placements:[]});
const walk=(p,field)=>routeOnLand(p,field,{x:0,z:-15},{x:0,z:15},.48,.9,{actorWalk:true});

for(const [degrees,expected] of [[49.75,true],[50.25,false]]) {
  const p=profile(),slope=Math.tan(degrees*Math.PI/180);
  p.corridors=[{id:'support-plane',halfWidth:150,blend:5,
    points:[{x:-160,z:0,h:-160*slope},{x:160,z:0,h:160*slope}],limits:[0,0]}];
  assert.equal(!!walk(p,flatField(0)),expected,
    `A ${degrees}-degree support plane must ${expected?'allow':'block'} a surface actor`);
}

const roof=profile();
roof.railInfrastructure=[{id:'closed-service-tunnel',halfWidth:2.5,points:[
  {x:-50,z:0,h:-30,surfaceH:10,kind:'tunnel',earthworkHalfWidth:6,earthworkBlend:2},
  {x:50,z:0,h:-30,surfaceH:10,kind:'tunnel',earthworkHalfWidth:6,earthworkBlend:2}
]}];
const field=flatField(10);
assert.equal(groundHeight(roof,field,0,0,false),-30);
assert.equal(groundHeight(roof,field,0,0,true),10);
assert.ok(walk(roof,field),'The natural roof supports a surface route over the closed tunnel');

console.log('Actor access: support slope and closed tunnel roof PASS');

// A high bridge-side face cannot be used as a one-way downhill shortcut.
// Its real landings remain available, and a flush deck-side join stays open.
const high=profile();
high.bridges=[{id:'supported-deck',halfWidth:2,a:{x:-20,z:0,h:1},b:{x:20,z:0,h:1},
  points:[{x:-20,z:0,h:1},{x:20,z:0,h:1}],height:1}];
high.foundations=[-20,20].map(x=>({x,z:0,height:1,halfX:4,halfZ:4,blend:4,shape:'ellipse'}));
for(const [start,end] of [[{x:0,z:0},{x:0,z:8}],[{x:0,z:8},{x:0,z:0}]]){
  const route=routeOnLand(high,flatField(0),start,end,.48,.9,{actorWalk:true});
  assert(route&&route.some(v=>Math.abs(v.x)>15),'A return path must use the supported bridge landing');
}
assert(routeOnLand(high,flatField(0),{x:-5,z:1.75},{x:5,z:1.75},.48,.9,{actorWalk:true}),
  'Movement already supported on the deck must not be mistaken for climbing its side');
const flush=profile();flush.bridges=[{...high.bridges[0],a:{x:-20,z:0,h:0},b:{x:20,z:0,h:0},
  points:[{x:-20,z:0,h:0},{x:20,z:0,h:0}],height:0}];
for(const [start,end] of [[{x:0,z:0},{x:0,z:8}],[{x:0,z:8},{x:0,z:0}]]){
  const route=routeOnLand(flush,flatField(0),start,end,.48,.9,{actorWalk:true});
  assert(route&&route.every(v=>Math.abs(v.x)<1),'An indexed flush dry-bank side join remains open');
}
// The actual authored Gorelaya dam profile exposed this failure: analytic
// ground followed the deck near x103 while the indexed Native soil was lower.
const actual=require('../data/kromka/sector-surfaces.json');
const burnt=actual.profiles.find(p=>p.zoneId==='z_09_08');
const bridge=burnt.bridges.find(b=>b.id==='burnt_dam_service_bridge_0');
const landing=burnt.foundations.find(f=>f.id==='burnt_dam_service_bridge_0_junction_b');
assert(bridge,'The authored forest service bridge is required');
for(const [start,end] of [[{x:100.6,z:-36.7},{x:105.8569,z:-23.71415}],
  [{x:105.8569,z:-23.71415},{x:100.6,z:-36.7}]]){
  const route=routeOnLand(burnt,actual.relief,start,end,.48,.9,{actorWalk:true});
  assert(route&&route.some(v=>((v.x-bridge.b.x)/landing.halfX)**2+((v.z-bridge.b.z)/landing.halfZ)**2<=1),
    'The real resource round trip must use the true-B supported landing, not the x103 side drop');
  assert.deepEqual(route[0],start);assert.deepEqual(route.at(-1),end);
}
for(const end of [{x:100.6,z:-36.7},{x:105.8569,z:-23.71415}])
  assert(routeOnLand(burnt,actual.relief,bridge.b,end,.48,.9,{actorWalk:true}),
    'The actual true-B approach remains usable in both directions');
const blockedReturn=routeOnLand(burnt,actual.relief,{x:103.04,z:-34.17},
  {x:103.106797,z:-34.893203},.48,.9,{actorWalk:true});
assert(blockedReturn&&blockedReturn.length>2
  &&blockedReturn.some(v=>((v.x-bridge.b.x)/landing.halfX)**2+((v.z-bridge.b.z)/landing.halfZ)**2<=1),
  'The exact Native failed return segment must detour through the supported landing');
console.log('Actor access: solid deck-side steps, flush joins and actual z_09_08 round trip PASS');
