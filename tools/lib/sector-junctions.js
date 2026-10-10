'use strict';
const {mapPoint,segmentDistance,bridgeAt,bridgeHeight}=require('../../src/server/sector-surface');

// Solve the road network in one world frame. Heights at shared crossings are
// constraints on the earthwork, rather than independent overlapping ramps.
function reconcileJunctions(profiles,{maxPasses=40000}={}) {
  const routes=[],nodes=[],constraints=[];
  const addNode=(point,fixed)=>{const id=nodes.length;nodes.push({...point,fixed});return id;};
  for(const p of profiles)for(const corridor of p.corridors||[]) {
    if(!corridor.id.startsWith(p.zoneId+'_'))continue;
    const points=corridor.points.map((v,i)=>{
      const mapped=mapPoint(p,v.x,v.z),bridge=bridgeAt(p,v.x,v.z,-corridor.halfWidth);
      const fixed=i===0||i===corridor.points.length-1||!!bridge;
      const actualDeck=bridgeAt(p,v.x,v.z);
      const deckId=bridge&&actualDeck?.id===bridge.id?actualDeck.id:null;
      return addNode({deckId,x:mapped.x*16,z:-mapped.y*16,h:(p.datum+(bridge?bridgeHeight(bridge,v.x,v.z):v.h)/p.gain)*160},fixed);
    });
    const route={id:corridor.id,p,corridor,points,halfWidth:corridor.halfWidth*160/p.gain,blend:corridor.blend*160/p.gain};
    routes.push(route);
    for(let i=1;i<points.length;i++) {
      const a=nodes[points[i-1]],b=nodes[points[i]],run=Math.hypot(b.x-a.x,b.z-a.z);
      // Retain a solved sharp-turn landing; elsewhere allow a modest adjustment
      // within the same maximum grade used by the contour builder.
      const original=Math.abs(b.h-a.h);
      let slope=.49;
      for(let at=Math.max(1,i-3);at<=Math.min(points.length-2,i+2);at++) {
        const x=nodes[points[at-1]],y=nodes[points[at]],z=nodes[points[at+1]];
        const before=Math.hypot(y.x-x.x,y.z-x.z),after=Math.hypot(z.x-y.x,z.z-y.z);
        const dot=((y.x-x.x)*(z.x-y.x)+(y.z-x.z)*(z.z-y.z))/(before*after||1);
        const turn=Math.acos(Math.max(-1,Math.min(1,dot)));
        if(turn>.1)slope=Math.min(slope,.49*(turn>.6?.12:turn>.35?.3:.65));
      }
      const limit=corridor.limits?.[i]!==undefined?corridor.limits[i]*160/p.gain:Math.max(original,run*slope);
      constraints.push({terms:[[points[i-1],1],[points[i],-1]],limit:limit+1e-6,kind:'grade',a:route.id});
    }
  }
  const pairs=new Set();
  for(let r=0;r<routes.length;r++)for(let s=r+1;s<routes.length;s++) {
    const a=routes[r],b=routes[s],margin=a.halfWidth+b.halfWidth+Math.max(a.blend,b.blend);
    const bounds=route=>({minX:Math.min(...route.points.map(i=>nodes[i].x)),maxX:Math.max(...route.points.map(i=>nodes[i].x)),minZ:Math.min(...route.points.map(i=>nodes[i].z)),maxZ:Math.max(...route.points.map(i=>nodes[i].z))});
    const aa=bounds(a),bb=bounds(b);
    if(aa.maxX+margin<bb.minX||bb.maxX+margin<aa.minX||aa.maxZ+margin<bb.minZ||bb.maxZ+margin<aa.minZ)continue;
    for(const [first,second] of [[a,b],[b,a]])for(const index of first.points) {
      const point=nodes[index];let closest=null;
      for(let j=1;j<second.points.length;j++) {
        const left=second.points[j-1],right=second.points[j],sample=segmentDistance(point.x,point.z,nodes[left],nodes[right]);
        if(!closest||sample.distance<closest.distance)closest={...sample,left,right};
      }
      if(!closest||closest.distance>margin)continue;
      const key=index+'|'+closest.left+'|'+closest.right;
      if(pairs.has(key))continue;pairs.add(key);
      const terms=[[index,1],[closest.left,-(1-closest.t)],[closest.right,-closest.t]];
      // Samples already fixed to one continuous structural deck do not form
      // independent soil ramps. Its longitudinal grade remains constrained;
      // shoulders outside the actual deck retain the ordinary junction rule.
      if(point.fixed&&point.deckId&&terms.filter(([,weight])=>weight!==0)
          .every(([id])=>nodes[id].fixed&&nodes[id].deckId===point.deckId))continue;
      constraints.push({terms,limit:.25*closest.distance+.015,kind:'junction',a:first.id,b:second.id});
    }
  }
  // Two authored gates at the same sector edge are one continuous road. An
  // equal endpoint height alone leaves a sharp crossfall when the overlapping
  // earthworks have different terminal slopes. Reconcile their first metres
  // as one shared tangent, while each route retains its own grade limits.
  const gates=routes.filter(r=>/_gate_(north|south|east|west)$/.test(r.id));
  const opposite={north:'south',south:'north',east:'west',west:'east'};
  const sampleInward=(route,distance)=>{
    let remaining=distance;
    for(let i=route.points.length-1;i>0;i--) {
      const outer=route.points[i],inner=route.points[i-1],a=nodes[outer],b=nodes[inner];
      const run=Math.hypot(a.x-b.x,a.z-b.z);
      if(remaining<=run+1e-7){const t=Math.min(1,remaining/(run||1));return [[outer,1-t],[inner,t]];}
      remaining-=run;
    }
    return null;
  };
  const value=terms=>terms.reduce((sum,[index,weight])=>sum+nodes[index].h*weight,0);
  const combined=terms=>{
    const weights=new Map();
    for(const [index,weight] of terms)weights.set(index,(weights.get(index)||0)+weight);
    return [...weights].filter(([,weight])=>Math.abs(weight)>1e-10);
  };
  let continuations=0;
  for(let i=0;i<gates.length;i++)for(let j=i+1;j<gates.length;j++) {
    const a=gates[i],b=gates[j],aSide=a.id.match(/_gate_(north|south|east|west)$/)[1],bSide=b.id.match(/_gate_(north|south|east|west)$/)[1];
    if(opposite[aSide]!==bSide||a.p===b.p)continue;
    const ai=a.points.at(-1),bi=b.points.at(-1),ae=nodes[ai],be=nodes[bi];
    if(Math.hypot(ae.x-be.x,ae.z-be.z)>.05)continue;
    // A short authored jog along the map edge must not disguise the real
    // incoming directions of the two road bodies.
    const directionA=sampleInward(a,6),directionB=sampleInward(b,6);
    if(!directionA||!directionB)continue;
    const position=terms=>({x:terms.reduce((sum,[id,w])=>sum+nodes[id].x*w,0),
      z:terms.reduce((sum,[id,w])=>sum+nodes[id].z*w,0)});
    const ap=position(directionA),bp=position(directionB);
    const av={x:ap.x-ae.x,z:ap.z-ae.z},bv={x:bp.x-be.x,z:bp.z-be.z};
    const facing=(av.x*bv.x+av.z*bv.z)/(Math.hypot(av.x,av.z)*Math.hypot(bv.x,bv.z)||1);
    if(facing>-.7)continue;
    const checkA=sampleInward(a,4),checkB=sampleInward(b,4);
    if(!checkA||!checkB)continue;
    const mismatch=value([...checkA,...checkB,[ai,-1],[bi,-1]]);
    if(Math.abs(mismatch)<=.16)continue;
    for(const distance of [2,4,6]) {
      const aa=sampleInward(a,distance),bb=sampleInward(b,distance);
      if(!aa||!bb)continue;
      constraints.push({terms:combined([...aa,...bb,[ai,-1],[bi,-1]]),limit:.015*distance+.01,
        kind:'continuation',a:a.id,b:b.id});
    }
    continuations++;
  }
  let residual=Infinity,pass=0;const residualHistory=[];
  const error=c=>Math.max(0,Math.abs(c.terms.reduce((sum,[id,w])=>sum+nodes[id].h*w,0))-c.limit);
  for(;pass<maxPasses;pass++) {
    for(const c of constraints) {
      const value=c.terms.reduce((sum,[id,w])=>sum+nodes[id].h*w,0),violation=Math.max(0,Math.abs(value)-c.limit);
      if(violation<1e-7)continue;
      const denominator=c.terms.reduce((sum,[id,w])=>sum+(nodes[id].fixed?0:w*w),0);
      if(denominator===0)continue;
      const delta=Math.sign(value)*violation/denominator;
      for(const [id,w] of c.terms)if(!nodes[id].fixed)nodes[id].h-=delta*w;
    }
    if(pass%10===0){residual=Math.max(0,...constraints.map(error));if(pass%1000===0)residualHistory.push({pass,residual});if(residual<.002)break;}
  }
  const defects=constraints.filter(c=>error(c)>.01).map(c=>({kind:c.kind,a:c.a,b:c.b,error:error(c),limit:c.limit,points:c.terms.map(([id,weight])=>({...nodes[id],weight}))})).sort((a,b)=>b.error-a.error);
  if(defects.length) {
    const e=new Error('Road junction constraints conflict: '+JSON.stringify(defects.slice(0,10)));
    e.junctionDefects=defects;e.residualHistory=residualHistory;throw e;
  }
  const solved=new Map(routes.map(r=>[r.id,{...r,heights:r.points.map(i=>nodes[i].h)}]));
  for(const p of profiles)for(const c of p.corridors||[]) {
    const source=solved.get(c.id);if(!source)continue;
    for(let i=0;i<c.points.length;i++)c.points[i].h=(source.heights[i]/160-p.datum)*p.gain;
  }
  return {routes:routes.length,nodes:nodes.length,constraints:constraints.length,continuations,passes:pass,residual};
}
module.exports={reconcileJunctions};
