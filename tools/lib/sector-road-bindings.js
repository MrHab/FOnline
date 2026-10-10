'use strict';
const {mapPoint}=require('../../src/server/sector-surface');

// A shared road station can follow an engineered gate/bridge. Both sides use
// one world-space station, including the different native city/sector scales.
function bindRoadEndpoints(profiles,bindings=[]) {
  const byId=new Map(profiles.map(p=>[p.zoneId,p]));
  for(const binding of bindings) {
    const owner=byId.get(binding.gate.zone),gate=owner?.gates?.find(g=>g.side===binding.gate.side);
    if(!gate)throw new Error('Missing engineering road station '+binding.id);
    const world=mapPoint(owner,gate.boundary.x,gate.boundary.z);
    for(const end of binding.ends) {
      const p=byId.get(end.zone),road=p?.roads.find(r=>r.id===end.route);
      if(!road || !['a','b'].includes(end.end))throw new Error('Missing engineering road end '+binding.id+' '+end.zone);
      road[end.end]={x:(world.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-world.y)/20*p.depth};
      delete road.points;
      road.engineeredStation=binding.id;
    }
  }
}
module.exports={bindRoadEndpoints};
