'use strict';
const assert=require('node:assert/strict');
const {clearBridge,crossWaterHeight}=require('./lib/sector-bridge-deck');
// A river plane rises across the bridge. A centreline-only clearance would
// leave one edge of the deck two metres under water.
const p={waterVertices:[{x:-3,z:-8,h:0},{x:3,z:-8,h:0},
  {x:-3,z:8,h:8},{x:3,z:8,h:8}],waterIndices:[0,2,1,1,2,3]};
assert.equal(crossWaterHeight(p,0,0,0,1,4),6);
assert.equal(crossWaterHeight(p,10,0,0,1,4),-Infinity);
const original={id:'sloping_river',style:'concrete',halfWidth:4,
  points:[{x:-20,z:0,h:0},{x:20,z:0,h:0}]};
const source=JSON.stringify(original),b=clearBridge(p,original);
assert.equal(JSON.stringify(original),source,'Deck planning must not mutate its source');
assert.equal(b.id,original.id);assert.equal(b.halfWidth,original.halfWidth);
assert.equal(b.a.x,-20);assert.equal(b.b.x,20);
let wetSamples=0;
for(let i=1;i<b.points.length;i++){
 const a=b.points[i-1],v=b.points[i],distance=Math.hypot(v.x-a.x,v.z-a.z);
 assert(Math.abs(v.h-a.h)<=distance*.18+2e-6,'Deck grade must remain walkable');
 for(let k=0;k<=100;k++){
  const t=k/100,x=a.x+(v.x-a.x)*t,z=a.z+(v.z-a.z)*t,h=a.h+(v.h-a.h)*t;
  const water=crossWaterHeight(p,x,z,0,1,b.halfWidth);
  if(!Number.isFinite(water))continue;
  assert(h-water>=.9-2e-6,'The whole deck width must clear the river plane');wetSamples++;
 }
}
assert(wetSamples>0);
assert(b.a.h>0&&b.b.h>0,'Approach endpoints must follow the bounded ramp');
assert.throws(()=>clearBridge(p,original,{clearance:NaN}),/Invalid bridge/);
// The same rising water crosses a sector boundary. Both saved bridge copies
// must derive their deck from both halves of the native river.
const {addCrossings}=require('./lib/sector-engineering');
const field={samplesX:2,samplesY:2,width:40,depth:20,heights:[0,0,0,0]};
const sector=(id,minX,xmin,xmax)=>({zoneId:id,locationId:id,width:320,depth:320,
 mapMinX:minX,mapMinY:0,mapSpan:20,datum:0,gain:160,hub:{x:0,z:0},
 foundations:[],corridors:[],hydroCuts:[],bridges:[],roads:[],waterEdges:[],
 waterVertices:[{x:xmin,z:-12,h:-2.6},{x:xmax,z:-12,h:-2.6},
  {x:xmin,z:12,h:4.6},{x:xmax,z:12,h:4.6}],waterIndices:[0,2,1,1,2,3]});
const left=sector('left',0,130,160),right=sector('right',20,-160,-130);
addCrossings([left,right],field,{crossings:[{id:'shared_river',a:'left',b:'right',halfWidthMap:.25,
 bankAnchors:{left:{x:-80,z:0},right:{x:80,z:0}}}]});
for(const s of [left,right]){
 const bridge=s.bridges[0];assert(bridge);
 for(const q of bridge.points){
  const water=crossWaterHeight(s,q.x,q.z,0,1,bridge.halfWidth);
  if(Number.isFinite(water))assert(q.h-water>=1-2e-6,'Shared deck width must clear native water');
 }
}
const edgeL=left.bridges[0].points.find(q=>q.x===160),edgeR=right.bridges[0].points.find(q=>q.x===-160);
assert(edgeL&&edgeR);assert.equal(edgeL.h,edgeR.h,'Shared bridge elevation must match at the sector cut');
console.log('Bridge deck: full-width native water clearance, local ramps, shared cut and source preservation passed.');
