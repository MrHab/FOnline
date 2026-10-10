'use strict';

const {groundHeight,isWaterAt}=require('../../src/server/sector-surface');

function addServiceWalkways(profiles,field,engineering) {
  for(const recipe of engineering.serviceWalkways||[]) {
    const profile=profiles.find(row=>row.zoneId===recipe.zone);
    const approach=profile?.roads.find(row=>row.id===recipe.road && !row.blocked);
    if(!approach?.points?.length)throw new Error('Missing service walkway approach '+recipe.zone+'/'+recipe.road);
    const controls=recipe.controls.map(row=>({x:row.x,z:row.z,h:row.h}));
    if(controls.length<2)throw new Error('Service walkway needs at least two controls: '+recipe.id);
    const first=controls[0],last=controls.at(-1);
    const actualGround=groundHeight(profile,field,first.x,first.z,false);
    if(Math.abs(actualGround-first.h)>.15)throw new Error('Service walkway no longer meets dry approach: '+recipe.id);
    if(isWaterAt(profile,last.x,last.z,.48,field))throw new Error('Service walkway ends in water: '+recipe.id);
    let branchIndex=-1,branchDistance=Infinity;
    for(let i=0;i<approach.points.length;i++) {
      const point=approach.points[i],distance=Math.hypot(point.x-recipe.branch.x,point.z-recipe.branch.z);
      if(distance<branchDistance){branchDistance=distance;branchIndex=i;}
    }
    if(branchDistance>.1)throw new Error('Service walkway branch moved: '+recipe.id);
    const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,h:a.h+(b.h-a.h)*t});
    const curve=(a,b,c,t)=>lerp(lerp(a,b,t),lerp(b,c,t),t);
    const points=[first];
    for(let i=1;i<controls.length-1;i++) {
      const a=controls[i-1],b=controls[i],c=controls[i+1];
      const before=Math.hypot(a.x-b.x,a.z-b.z),after=Math.hypot(c.x-b.x,c.z-b.z);
      const radius=Math.min(recipe.turnRadius,before*.35,after*.35);
      const entry=lerp(b,a,radius/before),exit=lerp(b,c,radius/after);
      points.push(entry);
      for(let j=1;j<8;j++)points.push(curve(entry,b,exit,j/8));
      points.push(exit);
    }
    points.push(last);
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],run=Math.hypot(a.x-b.x,a.z-b.z);
      if(run<.001||Math.abs(b.h-a.h)/run>.9)throw new Error('Unsafe service walkway slope: '+recipe.id);
    }
    const halfWidth=recipe.halfWidth;
    profile.bridges=profile.bridges.filter(row=>row.id!==recipe.id);
    profile.bridges.push({id:recipe.id,type:'bridge',style:'metalService',halfWidth,
      dryLandingBlend:recipe.dryLandingBlend,purpose:recipe.purpose,a:first,b:last,points,height:first.h});
    profile.roads=profile.roads.filter(row=>row.id!==recipe.track);
    profile.roads.push({id:recipe.track,type:'track',walkwayAccess:true,halfWidth,
      a:profile.hub,b:{x:last.x,z:last.z},
      points:[...approach.points.slice(0,branchIndex+1).map(row=>({x:row.x,z:row.z})),
        ...points.map(row=>({x:row.x,z:row.z}))],blocked:false});
  }
}

module.exports={addServiceWalkways};
