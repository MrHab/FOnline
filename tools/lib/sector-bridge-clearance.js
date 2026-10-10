'use strict';
const {smooth}=require('../../src/server/sector-surface');

// Excavate only the ground beneath an authored bridge. The river bed cannot
// be raised by this operation, and the deck and its endpoints stay unchanged.
function addBridgeGroundCuts(profiles,plan) {
  for(const recipe of plan.bridgeGroundCuts||[]) {
    const p=profiles.find(p=>p.zoneId===recipe.zone);
    const bridge=p?.bridges.find(b=>b.id===recipe.bridge);
    if(!bridge?.points?.length)throw new Error('Missing clearance bridge '+recipe.zone+'/'+recipe.bridge);
    const end=recipe.end==='a'?bridge.points[0]:bridge.points.at(-1);
    const cut={id:recipe.id,worldKey:p.zoneId+'_'+recipe.id,x:recipe.x,z:recipe.z,
      halfX:recipe.halfX,halfZ:recipe.halfZ,blend:recipe.blend,height:end.h,
      shape:'ellipse',afterRoads:true,cutOnly:true,
      levelPoints:bridge.points.map(v=>({...v,h:v.h-recipe.clearance*smooth(0,recipe.taper,Math.hypot(v.x-end.x,v.z-end.z))}))};
    if(recipe.cutFootprint) {
      const other=recipe.end==='a'?bridge.points.at(-1):bridge.points[0];
      const run=Math.hypot(other.x-end.x,other.z-end.z),dx=(other.x-end.x)/run,dz=(other.z-end.z)/run;
      const {from,to,halfWidth}=recipe.cutFootprint;
      cut.shape='polygon';
      cut.points=[[from,-halfWidth],[to,-halfWidth],[to,halfWidth],[from,halfWidth]]
        .map(([along,side])=>({x:end.x+dx*along-dz*side,z:end.z+dz*along+dx*side}));
    }
    p.foundations=p.foundations.filter(f=>f.id!==recipe.id);p.foundations.push(cut);
  }
}
module.exports={addBridgeGroundCuts};
