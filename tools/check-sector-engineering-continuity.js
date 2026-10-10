'use strict';
const assert=require('node:assert/strict');
const {groundHeight,waterAt,isWaterAt}=require('../src/server/sector-surface');
const vertices=[{x:0,z:-64,h:0},{x:64,z:-64,h:0},{x:64,z:64,h:0},{x:0,z:64,h:0}];
const profile={zoneId:'engineering-continuity',width:128,depth:128,gain:160,datum:0,
 mapMinX:100,mapMinY:100,mapSpan:20,waterVertices:vertices,waterIndices:[0,1,2,0,2,3],
 waterEdges:[{a:vertices[0],b:vertices[3]},{a:vertices[0],b:vertices[1]},
  {a:vertices[1],b:vertices[2]},{a:vertices[2],b:vertices[3]}],
 foundations:[],bridges:[],corridors:[],hydroCuts:[],railInfrastructure:[]};
const field=height=>({width:760,depth:600,samplesX:2,samplesY:2,heights:Array(4).fill(height/160)});
const {shareFoundations}=require('./lib/sector-engineering');
const quay={id:'quay',shape:'rectangle',x:0,z:0,halfX:20,halfZ:4,height:0,blend:.075,
 dryCutBlend:32,afterHydro:true,fillWater:true};
const retained={...profile,foundations:[quay]},narrow={...profile,foundations:[{...quay,dryCutBlend:undefined}]};
const dryCut=groundHeight(retained,field(15),-20.5,0);
assert(dryCut>0&&dryCut<.02,'dry hillside joins the city floor as a broad shallow cut');
assert.equal(groundHeight(narrow,field(15),-20.5,0),15,'fixture exposes the previous dry cliff');
for(const x of [-20.5,-20.01,20.01,20.5]) {
 assert.equal(groundHeight(retained,field(-1),x,0),groundHeight(narrow,field(-1),x,0),'negative bank retaining fill stays exact');
}
assert.equal(groundHeight(retained,field(15),20.5,0),groundHeight(narrow,field(15),20.5,0),'native water keeps its narrow quay transition');
for(let x=-21;x<-19;x+=.05) {
 const grade=Math.abs(groundHeight(retained,field(15),x+.05,0)-groundHeight(retained,field(15),x,0))/.05;
 assert(grade<.1,'the dry gate approach has no capsule-sized height step');
}
// The dry cut reaches a neighbour that the .075 m wet lip alone does not.
const dryWorld={...profile,waterVertices:[],waterIndices:[],waterEdges:[]};
const owner={...dryWorld,foundations:[{...quay,x:40,halfX:4}]};
const adjacent={...dryWorld,zoneId:'cut-neighbour',mapMinX:120,width:256,depth:256,gain:320,foundations:[]};
shareFoundations([owner,adjacent]);
const foreignCut=adjacent.foundations.find(f=>f.foreign&&f.worldKey.endsWith('_quay'));
assert(foreignCut&&foreignCut.dryCutBlend===64,'wide dry cut is shared and scaled into the adjacent sector');
const sharedWorldX=119.5,ownX=(sharedWorldX-110)/20*128,otherX=(sharedWorldX-130)/20*256;
const tallerField={width:760,depth:600,samplesX:2,samplesY:2,heights:Array(4).fill(15/160)};
assert(Math.abs(groundHeight(owner,tallerField,ownX,0)/160-groundHeight(adjacent,tallerField,otherX,0)/320)<1e-12,'shared dry slope has the same world height at both scales');
const bridge={id:'bridge',style:'concrete',halfWidth:20,height:10,a:{x:-30,z:0},b:{x:30,z:0}};
const foundation={id:'fill',shape:'rectangle',x:0,z:0,halfX:20,halfZ:20,height:15,blend:6,afterHydro:true};
const corridor={id:'road',halfWidth:20,blend:6,points:[{x:-30,z:0,h:12},{x:30,z:0,h:12}]};
const bridgeProfile={...profile,bridges:[bridge]};
const below=groundHeight(bridgeProfile,field(.02-1e-6),1,0);
const above=groundHeight(bridgeProfile,field(.02+1e-6),1,0);
assert(Math.abs(above-below)<2.1e-6,'bridge grading cannot jump at the bed threshold');
const engineered={...profile,foundations:[foundation],bridges:[bridge],corridors:[corridor]};
const outside=groundHeight(engineered,field(.04),-.0001,0);
const inside=groundHeight(engineered,field(.04),.0001,0);
assert(Math.abs(inside-outside)<1e-6,'foundation and road grading join across the native water edge');
const overlapping={...engineered,foundations:[foundation,{...foundation,id:'neighbour-fill',foreign:true}]};
for(const x of [-.0001,.0001])assert(groundHeight(overlapping,field(.04),x,0)<.5,
 'overlapping foundations and approaches cannot turn the low natural bank into a full-height dam');
for(const x of [1,2,3,4,8,16]){
 const natural=groundHeight(profile,field(-1),x,0);
 assert(natural<0,'fixture samples an actual submerged bed');
 assert.equal(groundHeight(engineered,field(-1),x,0),natural,'engineering leaves the open bed exact');
}
assert.equal(groundHeight(engineered,field(10),-4,0),
 groundHeight({...engineered,waterVertices:[],waterIndices:[],waterEdges:[]},field(10),-4,0),
 'fully dry engineering retains its original arithmetic');
const causeway={...engineered,foundations:[{shape:'rectangle',x:0,z:0,halfX:1,halfZ:64,
 height:10,blend:.2,afterRoads:true,fillWater:true}]};
for(const x of [-.5,0,.5])assert.equal(groundHeight(causeway,field(-1),x,20),10,
 'the raised dry causeway spans a hidden native water boundary');
const sideFill={...profile,foundations:[foundation]};
// A bridge needs a deck above a low bank, not a soil dam underneath it.
// Splitting the route into stations must not create artificial span ends.
const segmentedBridge={...bridge,points:Array.from({length:61},(_,i)=>({x:i-30,z:0,h:10}))};
const segmented={...engineered,bridges:[segmentedBridge]};
for(const x of [-.5,-.25,0,.25,.5]){
 const natural=groundHeight(profile,field(-1),x,0);
 assert.equal(groundHeight(engineered,field(-1),x,0),natural,
  'the low bank beneath an open bridge span retains its natural soil');
 assert.equal(groundHeight(segmented,field(-1),x,0),natural,
  'intermediate polyline stations cannot acquire new endpoint fill');
 assert.equal(groundHeight(segmented,field(-1),x,0,true),10,
  'traffic still uses the bridge deck above the preserved soil');
}
for(const x of [-30,-29.25,-28,-27,-26]){
 const left=groundHeight(segmented,field(-1),x-1e-6,0);
 const right=groundHeight(segmented,field(-1),x+1e-6,0);
 assert(Math.abs(right-left)<.0001,'span and footing transitions cannot introduce a knife edge');
}
const sideRoad={id:'side-entry',type:'track',halfWidth:2.5,
 points:[{x:-30,z:21,h:12},{x:30,z:21,h:12}]};
const sideEntry={...engineered,roads:[sideRoad],corridors:[{...sideRoad,blend:6}]};
for(const z of [21-.48,21,21+.48])assert.equal(groundHeight(sideEntry,field(.5),20,z),12,
 'the actual dry side-entry road supports the whole capsule outside the deck');
assert.equal(groundHeight({...sideEntry,roads:[{...sideRoad,blocked:true}]},field(.5),20,21),.5,
 'a blocked road cannot extend approach fill across an open span');
for(const z of [20,21,sideRoad.points[0].z+sideRoad.halfWidth+.705])
 assert(Math.abs(groundHeight(sideEntry,field(.5),20,z-1e-6)-groundHeight(sideEntry,field(.5),20,z+1e-6))<.0001,
  'deck-side and road-core protection are continuous');
assert(groundHeight(sideFill,field(-1),-1,10)<=.69+1e-6,
 'a broad abutment halo joins the truly wet bank as a soil slope');
assert.equal(groundHeight({...sideFill,foundations:[{...foundation,fillWater:true}]},field(-1),-1,10),15,
 'explicit after-hydraulic causeway fill remains at its authored level');
const interiorWithoutNearbyEdges={inside:true,distance:Infinity,height:0,bankHeight:0,bankX:0,bankZ:0};
assert.equal(groundHeight(engineered,field(-1),1,0,false,interiorWithoutNearbyEdges),
 groundHeight(profile,field(-1),1,0,false,interiorWithoutNearbyEdges),
 'an open-water index bucket without nearby edges cannot acquire foundation, bridge or road fill');
const wideVertices=vertices.map(v=>({x:v.x*5,z:v.z*2.5,h:0}));
const wide={...profile,width:640,depth:320,waterVertices:wideVertices,
 waterEdges:[[0,3],[0,1],[1,2],[2,3]].map(([a,b])=>({a:wideVertices[a],b:wideVertices[b]}))};
const wideWater=waterAt(wide,192,0);
assert.equal(wideWater.inside,true);assert.equal(wideWater.distance,Infinity,
 'fixture reaches a real interior spatial-index bucket without edge candidates');
const wideEngineered={...wide,foundations:[{...foundation,x:128,halfX:64}],
 bridges:[{...bridge,a:{x:64,z:0},b:{x:256,z:0}}],
 corridors:[{...corridor,points:[{x:64,z:0,h:12},{x:256,z:0,h:12}]}]};
assert.equal(groundHeight(wideEngineered,field(-1),192,0),groundHeight(wide,field(-1),192,0),
 'the real water index cannot create an engineered island in an open river');
assert.equal(isWaterAt(wideEngineered,192,24,0,field(-1)),true,
 'the open river beside the deck remains blocked water');
assert.equal(isWaterAt(wideEngineered,192,0,0,field(-1)),false,
 'the authored bridge still permits passage above the preserved riverbed');
const bankRoad={id:'retained-service-road',type:'track',halfWidth:2.5,
 points:[{x:-80,z:0,h:8},{x:80,z:0,h:8}]};
const roadBank={...profile,roads:[bankRoad],corridors:[{...bankRoad,halfWidth:6,blend:6}],
 roadBankTreatments:[{minX:-32,maxX:32,minZ:-32,maxZ:32,blend:32}]};
for(const z of [-3.205,-2.5,0,2.5,3.205])assert.equal(groundHeight(roadBank,field(.5),20,z),8,
 'the retaining treatment preserves the full actual road body core');
assert.equal(groundHeight(roadBank,field(.5),20,5),.5,
 'unneeded corridor fill outside the actual shoulder returns to the natural bank');
assert.equal(groundHeight(roadBank,field(.5),64,5),8,
 'the authored treatment fades to zero exactly at the sector seam');
assert(Math.abs(groundHeight(roadBank,field(.5),64-1e-6,5)-groundHeight(roadBank,field(.5),64+1e-6,5))<1e-7,
 'the zero-weight seam is continuous');
const bankFooting={...roadBank,foundations:[{shape:'ellipse',x:20,z:5,halfX:1,halfZ:1,blend:2,height:.7,afterHydro:true}]};
assert.equal(groundHeight(bankFooting,field(.5),20,5),8,'a true foundation core remains supported');
assert(Math.abs(groundHeight(bankFooting,field(.5),20,6-1e-6)-groundHeight(bankFooting,field(.5),20,6+1e-6))<.0001,
 'foundation protection fades continuously outside its actual footprint');
assert.equal(groundHeight(roadBank,field(-1),20,5),groundHeight({...roadBank,roadBankTreatments:[]},field(-1),20,5),
 'retaining a service road cannot fill an open riverbed');
console.log('Engineering continuity: open bed, causeway, span, road body, retaining bank and shared seam PASS');
