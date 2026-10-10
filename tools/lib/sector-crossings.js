'use strict';
const {isWaterAt,waterAt,groundHeight}=require('../../src/server/sector-surface');
const round=n=>Number(n.toFixed(6));
const {clearBridge}=require('./sector-bridge-deck');
function landComponents(p,field) {
  const n=160,side=n+1,step=p.width/n,half=p.width/2,total=side*side;
  const point=i=>({x:i%side*step-half,z:Math.floor(i/side)*step-half});
  const index=v=>Math.max(0,Math.min(n,Math.round((v.x+half)/step)))+Math.max(0,Math.min(n,Math.round((v.z+half)/step)))*side;
  const labels=new Int32Array(total);labels.fill(-1);
  for(let i=0;i<total;i++){const v=point(i);if(isWaterAt(p,v.x,v.z,1.8,field))labels[i]=-2;}
  let count=0;
  for(let i=0;i<total;i++)if(labels[i]===-1) {
    const queue=[i];labels[i]=count;
    for(let cursor=0;cursor<queue.length;cursor++) {
      const current=queue[cursor],x=current%side,z=Math.floor(current/side);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,nz=z+dz;if(nx<0||nx>n||nz<0||nz>n)continue;
        const id=nx+nz*side;if(labels[id]===-1){labels[id]=count;queue.push(id);}
      }
    }
    count++;
  }
  return {label:v=>labels[index(v)],count};
}
function addLocalCrossings(profiles,field,plan) {
  for(const recipe of plan.localCrossings) {
    const p=profiles.find(p=>p.zoneId===recipe.zone);
    for(let iteration=0;iteration<3;iteration++) {
      const components=landComponents(p,field),home=components.label(p.hub);
      const needed=new Set(p.gates.map(g=>components.label(g.boundary)).filter(c=>c>=0&&c!==home));
      if(!needed.size)break;
      const candidates=[];
      for(const edge of p.waterEdges) {
        const dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,length=Math.hypot(dx,dz);
        if(length<.1)continue;
        const normal={x:-dz/length,z:dx/length};
        const count=Math.max(1,Math.ceil(length/12));
        for(let j=0;j<count;j++)for(const sign of [-1,1]) {
          const bank={x:edge.a.x+dx*(j+.5)/count,z:edge.a.z+dz*(j+.5)/count};
          const at=d=>({x:bank.x+normal.x*d*sign,z:bank.z+normal.z*d*sign});
          const within=v=>Math.abs(v.x)<p.width/2-8&&Math.abs(v.z)<p.depth/2-8;
          const wet=at(4),dry=at(-12);
          if(!within(dry)||!within(wet)||!isWaterAt(p,wet.x,wet.z,0,field)||isWaterAt(p,dry.x,dry.z,2.5,field))continue;
          let end=null;
          for(let d=8;d<200;d+=2) {
            const v=at(d);if(!within(v))break;
            if(!isWaterAt(p,v.x,v.z,2.5,field)) {const candidate=at(d+12);if(within(candidate)&&!isWaterAt(p,candidate.x,candidate.z,2.5,field))end=candidate;break;}
          }
          if(!end)continue;
          const ca=components.label(dry),cb=components.label(end);
          if(!((ca===home&&needed.has(cb))||(cb===home&&needed.has(ca))))continue;
          const span=Math.hypot(end.x-dry.x,end.z-dry.z),ha=groundHeight(p,field,dry.x,dry.z,true),hb=groundHeight(p,field,end.x,end.z,true);
          if(Math.abs(ha-hb)>span*.18)continue;
          let deck=Math.max(ha,hb);
          for(let t=0;t<=1;t+=1/Math.ceil(span)) {
            const x=dry.x+(end.x-dry.x)*t,z=dry.z+(end.z-dry.z)*t;
            if(isWaterAt(p,x,z,0,field))deck=Math.max(deck,waterAt(p,x,z).height+.9);
          }
          const ramp=Math.max(12,(deck-Math.min(ha,hb))/.18);
          if(ramp*2>span*.85)continue;
          const u=ramp/span;
          const points=[{...dry,h:ha},{x:dry.x+(end.x-dry.x)*u,z:dry.z+(end.z-dry.z)*u,h:deck},{x:end.x-(end.x-dry.x)*u,z:end.z-(end.z-dry.z)*u,h:deck},{...end,h:hb}].map(v=>({x:round(v.x),z:round(v.z),h:round(v.h)}));
          candidates.push({id:recipe.id+'_'+iteration,type:'bridge',style:'concrete',purpose:recipe.purpose,
            ...(recipe.dryLandingBlend?{dryLandingBlend:recipe.dryLandingBlend}:{}),
            halfWidth:4,a:points[0],b:points.at(-1),points,height:round(deck),cost:span*5+Math.hypot(dry.x-p.hub.x,dry.z-p.hub.z)});
        }
      }
      candidates.sort((a,b)=>a.cost-b.cost||a.a.x-b.a.x||a.a.z-b.a.z);
      if(!candidates.length)throw new Error('No feasible bank-to-bank crossing '+recipe.zone);
      let selected=candidates[0];delete selected.cost;
      if(recipe.fullWidthWaterClearance)selected=clearBridge(p,selected,{clearance:recipe.fullWidthWaterClearance});
      p.bridges.push(selected);
      const after=landComponents(p,field),afterHome=after.label(p.hub);
      const unreachable=p.gates.filter(g=>{const label=after.label(g.boundary);return label>=0&&label!==afterHome;}).length;
      const before=p.gates.filter(g=>{const label=components.label(g.boundary);return label>=0&&label!==home;}).length;
      if(unreachable>=before)throw new Error('Crossing failed to connect its banks '+recipe.zone+' '+selected.id);
    }
  }
}
module.exports={landComponents,addLocalCrossings};
