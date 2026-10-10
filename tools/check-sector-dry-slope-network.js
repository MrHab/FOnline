#!/usr/bin/env node
'use strict';

// The authoritative server must not move a player uphill through a dry
// BuildGround triangle steeper than the Unity CharacterController's 50° limit.
// The same server must still allow descent and an engineered ordinary road.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const h=require('./check-combat-runtime');
const walk=require('./lib/zone-walk');
const terrain=require('../src/server/sector-terrain');
const surface=require('../src/server/sector-surface');
const {createLocationCollision,circleBlockerPenalty}=require('../src/server/location-collision');

const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/kromka/sector-surfaces.json'),'utf8'));
const zoneId='z_04_12';
const profile=catalog.profiles.find(row=>row.locationId===zoneId);
const start={x:-24.570250380266895,z:-101.27731552454898};
const top={x:-23.76308295306644,z:-100.38935114211768};
const {locationObjectBlockers}=createLocationCollision({tile:2});
const accounts={};
const getJson=url=>new Promise((resolve,reject)=>http.get(h.baseUrl()+url,res=>{
  let body='';res.on('data',chunk=>body+=chunk);
  res.on('end',()=>{try{resolve(JSON.parse(body))}catch(error){reject(error)}});
}).on('error',reject));

function assertClear(zone,location,from,to) {
  const blockers=[...terrain.staticBlockers(zone),
    ...(location.objects||[]).flatMap(row=>locationObjectBlockers(row))];
  for(let i=0;i<=8;i++) {
    const t=i/8,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;
    assert.equal(terrain.isWaterAt(zone,x,z,.48),false,`${zone} dry slope water at ${t}`);
    assert(blockers.every(row=>circleBlockerPenalty(x,z,.48,row)<=0),`${zone} dry slope has a 2D blocker at ${t}`);
  }
}

(async()=>{
  assert.equal(terrain.version,catalog.sourceHash,'runtime and served catalog must match');
  assert(profile&&!profile.legacyDam,`${zoneId} must have a public terrain mesh`);
  const step=profile.width/(profile.terrainSegments||128);
  const a=surface.groundHeight(profile,catalog.relief,-25,-102.5,false);
  const b=surface.groundHeight(profile,catalog.relief,-22.5,-102.5,false);
  const c=surface.groundHeight(profile,catalog.relief,-25,-100,false);
  const actualTriangleAngle=Math.atan(Math.hypot((b-a)/step,(c-a)/step))*180/Math.PI;
  assert(actualTriangleAngle>50,`${zoneId} fixture must still be a steep BuildGround triangle`);
  const road=catalog.profiles.find(row=>row.locationId==='z_02_09')?.roads.find(row=>row.id==='gate_west');
  assert(road?.points?.length>=4,'safe road fixture must exist');
  const roadStart=road.points[2],roadEnd=road.points[3];
  await h.bootstrapCharacters(accounts);
  walk.placeInZone(h,accounts,'untargeted',zoneId,start);
  walk.placeInZone(h,accounts,'harvest',zoneId,start);
  walk.placeInZone(h,accounts,'trade',zoneId,start);
  walk.placeInZone(h,accounts,'target',zoneId,top);
  walk.placeInZone(h,accounts,'progression','z_02_09',roadStart);
  await h.startServer();
  try {
    const zone=(await getJson('/api/locations/'+zoneId)).location;
    const roadZone=(await getJson('/api/locations/z_02_09')).location;
    assert(zone&&roadZone,'server must serve both fixture zones');
    assertClear(zoneId,zone,start,top);

    const uphill=accounts.untargeted;
    await h.connectAndJoin(uphill);
    const uphillState={x:Number(uphill.join.self.x),z:Number(uphill.join.self.z)};
    const actualStart={...uphillState};
    assertClear(zoneId,zone,actualStart,top);
    assert(terrain.steepUphill(zoneId,actualStart.x,actualStart.z,top.x,top.z,.48),
      'mesh-aware server slope predicate sees the real uphill fixture');
    const uphillReached=await walk.driveTo(h,uphill,uphillState,top.x,top.z,32);
    assert.equal(uphillReached,false,'server must not climb a dry slope blocked by the player controller');
    assert(Math.hypot(uphillState.x-top.x,uphillState.z-top.z)>.6,'uphill actor remains below the steep triangle');
    h.closeSocket(uphill);
    for(const [packetStep,role] of [[0.12,'harvest'],[0.2,'trade']]) {
      const actor=accounts[role];
      await h.connectAndJoin(actor);
      const state={x:Number(actor.join.self.x),z:Number(actor.join.self.z)};
      assert(Math.hypot(state.x-actualStart.x,state.z-actualStart.z)<0.01,'small packet fixture starts at the same lower bank');
      for(let frame=0;frame<32;frame++) {
        const dx=top.x-state.x,dz=top.z-state.z,length=Math.hypot(dx,dz);
        if(length<0.05)break;
        const span=Math.min(packetStep,length);
        const ack=await h.socketAck(actor.socket,'state',{
          seq:actor.movementSeq=(actor.movementSeq||0)+1,
          x:state.x+dx/length*span,z:state.z+dz/length*span,
          angle:Math.atan2(dx,dz),moving:true,turning:false,crouching:false,
          vx:5.5*dx/length,vz:5.5*dz/length
        },12000);
        const self=ack?.self||ack||{};
        state.x=Number(self.x);state.z=Number(self.z);
        await walk.delay(58);
      }
      assert(Math.hypot(state.x-top.x,state.z-top.z)>.6,
        `uphill actor cannot bypass the 50° ground guard with ${packetStep} m packets`);
      h.closeSocket(actor);
    }

    const descending=accounts.target;
    await h.connectAndJoin(descending);
    const downhillState={x:Number(descending.join.self.x),z:Number(descending.join.self.z)};
    assert.equal(terrain.steepUphill(zoneId,downhillState.x,downhillState.z,actualStart.x,actualStart.z,.48),false,
      'the opposite downhill direction remains allowed');
    assert(await walk.driveTo(h,descending,downhillState,actualStart.x,actualStart.z,32),
      'server must allow descent on this dry slope');

    const roadWalker=accounts.progression;
    await h.connectAndJoin(roadWalker);
    const roadState={x:Number(roadWalker.join.self.x),z:Number(roadWalker.join.self.z)};
    assertClear('z_02_09',roadZone,roadState,roadEnd);
    assert(await walk.driveTo(h,roadWalker,roadState,roadEnd.x,roadEnd.z,40),
      'an engineered road remains accessible');
    console.log(`Dry slope network PASS: ${zoneId} actual triangle ${actualTriangleAngle.toFixed(3)}°, uphill blocked, downhill and z_02_09 gate_west pass.`);
  } finally {
    for(const actor of Object.values(accounts))h.closeSocket(actor);
    await h.stopServer();
  }
})().catch(error=>{
  console.error(error?.stack||error);
  const logs=h.serverLogs().trim();if(logs)console.error(logs.slice(-3000));
  process.exitCode=1;
});
