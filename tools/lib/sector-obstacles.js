'use strict';
const {createLocationCollision,circleBlockerPenalty}=require('../../src/server/location-collision');
const {locationObjectBlockers}=createLocationCollision({tile:2});
const {waterAt,groundHeight,bridgeAt}=require('../../src/server/sector-surface');
const {utilityBlockers}=require('../../src/server/sector-utilities');
const tables=new WeakMap();
const key=(x,z)=>Math.floor(x/8)+','+Math.floor(z/8);
function attachObstacles(profile,definition,field,{includeScatter=false,prepared=false}={}) {
  const table=new Map();
  // Initial authoring runs precede the final indexed bank mesh. Once derived
  // volumes exist they are validated here as well as by the runtime authority.
  if(field)for(const blocker of utilityBlockers(profile,field,{allowPendingRevetment:true})) {
    const extent=Math.hypot(blocker.halfX,blocker.halfZ)+4;
    for(let x=Math.floor((blocker.x-extent)/8);x<=Math.floor((blocker.x+extent)/8);x++)
      for(let z=Math.floor((blocker.z-extent)/8);z<=Math.floor((blocker.z+extent)/8);z++) {
        const k=x+','+z;if(!table.has(k))table.set(k,[]);table.get(k).push(blocker);
      }
  }
  for(const row of definition.objects || []) {
    const tags=row.tags||[];
    if(!includeScatter&&tags.includes('scatter') || row.entity || tags.some(t=>['bridge','canal','river','water'].includes(t)))continue;
    const source=!prepared&&row.surfaceSourcePosition?{...row,position:row.surfaceSourcePosition}:row;
    // Flooded source props are relocated during surface authoring. They cannot
    // decide where a newly built bridge is reachable before that relocation.
    if(!prepared && field && source.position) {
      const {x,z}=source.position,water=waterAt(profile,x,z);
      if(bridgeAt(profile,x,z) || water.inside && groundHeight(profile,field,x,z)<water.height+.02*profile.gain/160)continue;
    }
    for(const blocker of locationObjectBlockers(source)) {
      const extent=Math.hypot(blocker.halfX||0,blocker.halfZ||0)+(blocker.radius||0)+4;
      for(let x=Math.floor((blocker.x-extent)/8);x<=Math.floor((blocker.x+extent)/8);x++)
        for(let z=Math.floor((blocker.z-extent)/8);z<=Math.floor((blocker.z+extent)/8);z++) {
          const k=x+','+z;if(!table.has(k))table.set(k,[]);table.get(k).push(blocker);
        }
    }
  }
  tables.set(profile,table);
}
function blockedAt(profile,x,z,radius=1.8) {
  return (tables.get(profile)?.get(key(x,z))||[]).some(b=>circleBlockerPenalty(x,z,radius,b)>1e-6);
}
module.exports={attachObstacles,blockedAt};
