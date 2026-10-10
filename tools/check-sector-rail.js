'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {utilityBlockers}=require('../src/server/sector-utilities');
const {circleBlockerPenalty}=require('../src/server/location-collision');
const {groundHeight,waterAt}=require('../src/server/sector-surface');
const data=JSON.parse(fs.readFileSync(process.env.ROA_SURFACE_INPUT||path.resolve(__dirname,'../data/kromka/sector-surfaces.json'),'utf8'));
let segments=0,supports=0,barriers=0;
const services=new Set();
for(const p of data.profiles) {
  if(p.legacyDam&&p.railInfrastructure?.length) {
    // A bridge carries its deck above water without turning the riverbed
    // into a solid earth embankment. Sample the actual authored crossing.
    for(const x of [-115,-110,-105,-100,-95]) {
      const water=waterAt(p,x,-106),natural=groundHeight(p,data.relief,x,-106,false,null,false);
      assert.ok(water.inside&&natural<water.height-.5,'Outpost17 crossing has no submerged riverbed');
      assert.ok(Math.abs(groundHeight(p,data.relief,x,-106)-natural)<.001,'rail grading fills the Outpost17 riverbed');
      assert.ok(groundHeight(p,data.relief,x,-106,true)>water.height+.2,'Outpost17 bridge deck is below water');
    }
  }
  const blockers=new Map(utilityBlockers(p,data.relief).map(b=>[b.id,b]));
  for(const r of p.railInfrastructure||[])for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i],length=Math.hypot(b.worldX-a.worldX,b.worldY-a.worldY)*16;
    if(length>1e-6)assert.ok(Math.abs(b.worldHeight-a.worldHeight)*160/length<=.04001,p.zoneId+' freight grade exceeds 4%');
    segments++;
  }
  for(const s of p.railSupports||[]) {
    assert.ok(s.g<s.h,p.zoneId+' pier has no physical depth');
    const shape=blockers.get(s.id);assert.ok(shape,p.zoneId+' pier absent from authority');
    assert.equal(shape.halfX,s.halfLength);assert.equal(shape.halfZ,s.halfWidth);
    assert.ok(circleBlockerPenalty(s.x,s.z,.4,shape)>0);supports++;
  }
  for(const g of p.railBarriers||[]) {
    const shape=blockers.get(g.id);assert.ok(shape,p.zoneId+' service gate absent from authority');
    assert.ok(g.halfWidth>=3.35,p.zoneId+' service gate only covers the gauge');
    const x=Math.cos(g.rotationY),z=Math.sin(g.rotationY);
    for(const radius of [.4,1.3])for(const lane of [-1.25,0,1.25]) {
      assert.ok(circleBlockerPenalty(g.x-z*lane,g.z+x*lane,radius,shape)>0,'gate admits player or vehicle lane');
      assert.equal(circleBlockerPenalty(g.x-z*(g.halfWidth+radius+.05),g.z+x*(g.halfWidth+radius+.05),radius,shape),0,'gate blocks the public outside detour');
    }
    const end=g.id.endsWith('_Start')?'Start':'End';
    assert.ok(p.railInfrastructure.some(r=>(r.spans||[]).some(s=>s.globalId===g.globalId&&(s['portal'+end]||s['service'+end]))),'a gate was invented at a sector edge');
    if(p.legacyDam)assert.ok(Math.hypot(g.x+105,g.z+106)>15,'freight gate closes the public Outpost17 bridge');
    services.add(g.id);barriers++;
  }
}
console.log(JSON.stringify({pass:true,segments,supports,localGatePieces:barriers,globalServiceGates:services.size}));
