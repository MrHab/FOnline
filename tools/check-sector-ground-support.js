'use strict';
const assert=require('node:assert/strict');
const {planPlacements,nativeGroundSupport}=require('./lib/sector-placement');
const field={samplesX:2,samplesY:2,width:380,depth:300,heights:[0,0,0,0]};
const profile=slope=>({zoneId:'support-test',locationId:'support-test',width:320,depth:320,
  mapMinX:40,mapMinY:40,mapSpan:20,datum:0,gain:1,
  waterIndices:[],waterVertices:[],waterEdges:[],visibleShore:[],hydroCuts:[],
  bridges:[],roads:[],railInfrastructure:[],foundations:[],obstacles:[],staticBlockers:[],
  corridors:[{id:'inclined-ground',halfWidth:150,blend:5,limits:[0,0],
    points:[{x:-160,z:0,h:-160*slope},{x:160,z:0,h:160*slope}]}]});
const wreck={id:'wreck',model:'carWreck',position:{x:0,y:0,z:0},role:'cover',
  tags:['zone-kit'],footprint:{x:4,z:2},collisionSize:{width:4,depth:2}};
const definition=row=>({objects:[row],containers:[]});
assert.ok(nativeGroundSupport(profile(0),field,wreck,wreck.position));
assert.ok(nativeGroundSupport(profile(.05),field,wreck,wreck.position));
assert.equal(nativeGroundSupport(profile(.4),field,wreck,wreck.position),false);
assert.deepEqual(planPlacements(profile(.4),field,definition(wreck)),[{id:'wreck',remove:true}]);
assert.deepEqual(planPlacements(profile(.05),field,definition(wreck)),[]);
const watchPost={...wreck,id:'watch-post',model:'watchPost',footprint:{x:3,z:3}};
assert.deepEqual(planPlacements(profile(.4),field,definition(watchPost)),[{id:'watch-post',remove:true}]);
assert.deepEqual(planPlacements(profile(0),field,definition(watchPost)),[]);
for(const model of ['storageLeanTo','workshopBench']) {
  const frame={...wreck,id:model,model};
  assert.deepEqual(planPlacements(profile(.4),field,definition(frame)),[{id:model,remove:true}]);
  assert.deepEqual(planPlacements(profile(0),field,definition(frame)),[]);
  assert.deepEqual(planPlacements(profile(.4),field,definition({...frame,interactive:true})),[]);
}
for(const extra of [{entity:{type:'npc'}},{resourceType:'metal',role:'resource'},
  {interactive:true},{nativeSupport:true},{tags:['zone-kit','quest-required']},
  {tags:['zone-kit','facility-kit']},{tags:['zone-kit','fixed-placement']}]) {
  assert.deepEqual(planPlacements(profile(.4),field,definition({...wreck,...extra})),[],
    'Ground decoration cleanup must preserve protected objects');
}
assert.deepEqual(planPlacements(profile(.4),field,{objects:[wreck],containers:[{visualObjectId:'wreck'}]}),[]);
console.log('Native ground support: inclined rigid props removed; supported and protected objects preserved PASS');
