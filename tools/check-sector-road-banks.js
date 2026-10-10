'use strict';
const assert=require('node:assert/strict');
const {applyRoadBankTreatments}=require('./lib/sector-road-bank');
const {groundHeight,segmentDistance}=require('../src/server/sector-surface');
const {utilityBlockers}=require('../src/server/sector-utilities');
const {circleBlockerPenalty}=require('../src/server/location-collision');
const field={width:400,depth:400,samplesX:2,samplesY:2,heights:[0,0,0,0]};
function build(kind) {
 const v=[{x:-40,z:-40,h:-10},{x:40,z:-40,h:-10},{x:40,z:40,h:-10},{x:-40,z:40,h:-10}];
 const main={id:'main',type:'track',halfWidth:2.5,a:{x:-20,z:0},b:{x:20,z:0}};
 const roads=[main],corridors=[{id:'main',halfWidth:2.5,blend:8,points:[{...main.a,h:8},{...main.b,h:8}]}];
 if(kind==='duplicate')roads.push({...main,id:'alias'},{...main,id:'reverse',a:main.b,b:main.a});
 if(kind==='crossing') {
  const cross={...main,id:'cross',a:{x:0,z:-20},b:{x:0,z:20}};roads.push(cross);
  corridors.push({id:'cross',halfWidth:2.5,blend:8,points:[{...cross.a,h:8},{...cross.b,h:8}]});
 }
 const p={zoneId:'fixture',width:100,depth:100,mapMinX:0,mapMinY:0,mapSpan:20,gain:160,datum:0,
  roads,corridors,foundations:[],hydroCuts:[],bridges:[],railInfrastructure:[],waterVertices:v,
  waterIndices:[0,1,2,0,2,3],waterEdges:v.map((a,i)=>({a,b:v[(i+1)%4]}))};
 applyRoadBankTreatments([p],field,{roadBankTreatments:[{zone:'fixture',minX:-30,maxX:30,minZ:-30,maxZ:30,blend:5}]});
 return p;
}
const rows=[];
for(const kind of ['single','duplicate','crossing']) {
 const p=build(kind),walls=p.roadBankWalls,blockers=utilityBlockers(p,field);
 const segments=walls.flatMap(w=>w.points.slice(1).map((b,i)=>({a:w.points[i],b})));
 assert.equal(walls.length,1,'overlapping routes form one joined retaining envelope');
 assert.equal(blockers.length,segments.length,'every real wall prism has its matching server polygon');
 const unique=new Set();
 for(let i=0;i<segments.length;i++) {
  const {a,b}=segments[i],key=[[a.x.toFixed(8),a.z.toFixed(8)].join(','),[b.x.toFixed(8),b.z.toFixed(8)].join(',')].sort().join('|');
  assert(!unique.has(key),'aliases cannot create duplicate wall segments');unique.add(key);
  assert.deepEqual(blockers[i].polygon,[{x:a.x,z:a.z},{x:b.x,z:b.z},{x:b.outerX,z:b.outerZ},{x:a.outerX,z:a.outerZ}]);
  const x=(a.x+b.x)/2,z=(a.z+b.z)/2;
  assert(Math.min(...p.roads.map(r=>segmentDistance(x,z,r.a,r.b).distance-r.halfWidth-.705))>=0,
   'the entire inner wall chord stays outside the protected road body');
  for(const q of [a,b])assert(q.bottom<=-.599999&&q.top>q.bottom,
   'retaining walls are real volumes embedded in the natural ground');
 }
 for(const road of p.roads)for(let i=0;i<=80;i++)for(const lane of [-1.25,0,1.25]) {
  const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,length=Math.hypot(dx,dz);
  const x=road.a.x+dx*i/80-dz/length*lane,z=road.a.z+dz*i/80+dx/length*lane;
  assert(!blockers.some(b=>circleBlockerPenalty(x,z,.48,b)>1e-6),'walls leave every real road walking lane clear');
  assert(groundHeight(p,field,x,z)>0,'the retained road remains above the natural bank');
 }
 rows.push({kind,segments:segments.length});
}
assert.equal(rows[0].segments,rows[1].segments,'adding identical or reversed aliases preserves the union topology');
console.log('PASS: joined retaining walls, aliases, ground embedding, exact collision polygons and clear road lanes.');
