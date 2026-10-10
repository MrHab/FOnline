'use strict';
const {groundHeight}=require('../../src/server/sector-surface');

// Authored infrastructure corridors around existing city plots. The source
// geography remains immutable; the prepared local view supplies its replacement.
function applyInfrastructureLayouts(profiles,field,recipes=[]) {
  for(const recipe of recipes) {
    const p=profiles.find(p=>p.zoneId===recipe.zone);
    if(!p)throw new Error('No infrastructure sector '+recipe.zone);
    const road=p.roads.find(r=>r.id===recipe.route);
    if(!road)throw new Error('No infrastructure route '+recipe.zone+' '+recipe.route);
    const start=road.a,level=groundHeight(p,field,start.x,start.z);
    if(recipe.foundation)p.foundations.push({...recipe.foundation,height:level,afterHydro:true});
    const control=recipe.curve.control,end=recipe.curve.end;
    const points=Array.from({length:17},(_,i)=>{
      const t=i/16,u=1-t;
      return {x:u*u*start.x+2*u*t*control.x+t*t*end.x,z:u*u*start.z+2*u*t*control.z+t*t*end.z};
    });
    points.push(...recipe.points);
    road.points=points;road.b=points.at(-1);road.purpose=recipe.purpose;
  }
}
module.exports={applyInfrastructureLayouts};
