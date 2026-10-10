'use strict';
const {mapPoint,groundHeight,crossesWater,bridgeAt,bridgeHeight,segmentDistance}=require('../../src/server/sector-surface');
const {routeOnLand}=require('./sector-access');
const {blockedAt}=require('./sector-obstacles');
const {reconcileJunctions}=require('./sector-junctions');
function routeLength(path){return path.slice(1).reduce((sum,v,i)=>sum+Math.hypot(v.x-path[i].x,v.z-path[i].z),0);}
function sampleRoute(route,preserveControls=false) {
  if(preserveControls) {
    const points=[{x:route[0].x,z:route[0].z}],distance=[0];let along=0;
    for(let i=1;i<route.length;i++) {
      const a=route[i-1],b=route[i],run=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(run/2));
      if(run<1e-8)continue;
      for(let j=1;j<=steps;j++) {
        const t=j/steps;along+=run/steps;
        points.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});distance.push(along);
      }
    }
    return {points,distance,along};
  }
  const cumulative=[0];
  for(let i=1;i<route.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(route[i].x-route[i-1].x,route[i].z-route[i-1].z));
  const total=cumulative.at(-1),count=Math.max(1,Math.round(total/2)),points=[],distance=[];
  let segment=1,along=0;
  for(let i=0;i<=count;i++) {
    const target=total*i/count;
    while(segment<cumulative.length-1&&cumulative[segment]<target)segment++;
    const a=route[segment-1],b=route[segment],run=cumulative[segment]-cumulative[segment-1];
    const t=run>1e-8?(target-cumulative[segment-1])/run:0;
    const v={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
    if(points.length)along+=Math.hypot(v.x-points.at(-1).x,v.z-points.at(-1).z);
    points.push(v);distance.push(along);
  }
  return {points,distance,along};
}
function routeHasCloseReturn(route,halfWidth,blend=6) {
  const {points,distance}=sampleRoute(route);
  const clearance=2*(halfWidth+blend),separation=Math.max(20,clearance*1.5);
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++) {
    if(distance[j]-distance[i]<separation)continue;
    if(Math.hypot(points[j].x-points[i].x,points[j].z-points[i].z)<clearance)return true;
  }
  return false;
}
function gradeLimits(points,distance,along,grade,landing,anchors=[]) {
  const stepGrade=Array(points.length).fill(grade);
  // Near a sharp bend the inside wheel track is shorter than the centreline.
  for(let i=1;i<points.length-1;i++) {
    const before=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
    const after=Math.hypot(points[i+1].x-points[i].x,points[i+1].z-points[i].z);
    if(before<1e-5||after<1e-5)continue;
    const dot=((points[i].x-points[i-1].x)*(points[i+1].x-points[i].x)+(points[i].z-points[i-1].z)*(points[i+1].z-points[i].z))/(before*after);
    const turn=Math.acos(Math.max(-1,Math.min(1,dot)));
    if(turn<.1)continue;
    const local=grade*(turn>.6?.3:turn>.35?.5:.75);
    for(let j=i;j>0&&distance[i]-distance[j-1]<4;j--)stepGrade[j]=Math.min(stepGrade[j],local);
    for(let j=i+1;j<points.length&&distance[j]-distance[i]<4;j++)stepGrade[j]=Math.min(stepGrade[j],local);
  }
  const pinned=new Set(anchors.map(([index])=>index));
  for(let i=1;i<points.length;i++)if(pinned.has(i-1)&&pinned.has(i))stepGrade[i]=grade;
  return points.map((_,i)=>i?stepGrade[i]*Math.max(0,Math.min(distance[i],along-landing)-Math.max(distance[i-1],landing)):0);
}
function fixedRoadHeights(p,field,points,road,bridgeLandingRun=0) {
  const fixed=new Map();
  fixed.set(0,groundHeight(p,field,points[0].x,points[0].z,true));
  fixed.set(points.length-1,groundHeight(p,field,points.at(-1).x,points.at(-1).z,true));
  for(let i=0;i<points.length;i++) {
    // A side wheel can reach the deck before the centreline. Pin the soil
    // corridor through that entire envelope, not only at the bridge centre.
    let b=bridgeAt(p,points[i].x,points[i].z,-Math.max(road.halfWidth,1.25));
    if(!b && bridgeLandingRun>0)b=(p.bridges||[]).find(bridge=>{
      const path=bridge.points?.length?bridge.points:[bridge.a,bridge.b];
      return [[path[0],path[1]],[path.at(-1),path.at(-2)]].some(([end,inside])=>{
        const dx=inside.x-end.x,dz=inside.z-end.z,run=Math.hypot(dx,dz);
        if(run<1e-6)return false;
        const vx=points[i].x-end.x,vz=points[i].z-end.z;
        const along=(vx*dx+vz*dz)/run,side=Math.abs(vx*dz-vz*dx)/run;
        return along>=-bridgeLandingRun && along<=0
          &&side<=bridge.halfWidth+Math.max(road.halfWidth,1.25);
      });
    });
    if(b)fixed.set(i,bridgeHeight(b,points[i].x,points[i].z));
  }
  return [...fixed].sort((a,b)=>a[0]-b[0]);
}
function anchorsFit(anchors,limits) {
  const prefix=[0];
  for(let i=1;i<limits.length;i++)prefix.push(prefix.at(-1)+limits[i]);
  for(let i=1;i<anchors.length;i++)if(Math.abs(anchors[i][1]-anchors[i-1][1])>prefix[anchors[i][0]]-prefix[anchors[i-1][0]]+1e-6)return false;
  return true;
}
function roundStvorSwitchback(p,field,road,corridor) {
  // The narrow turn onto Stvor's northern bank cuts across its inner wheel
  // track. Keep the two dry straight approaches and join them with a 10 m
  // circular arc sampled finely enough for the server's wheel tracks.
  if(p.zoneId!=='z_08_14'||road.id!=='gate_north')return;
  const inherited=p.corridors;
  p.corridors=[...(inherited||[]).filter(c=>c.id!==corridor.id),corridor];
  let originalGrade;
  try{originalGrade=roadGrade(p,field,road);}finally{p.corridors=inherited;}
  if(originalGrade<=.57)return;
  const points=corridor.points;
  let pivot=0,nearest=Infinity;
  for(let i=0;i<points.length;i++) {
    const distance=Math.hypot(points[i].x-132,points[i].z-93);
    if(distance<nearest){nearest=distance;pivot=i;}
  }
  if(nearest>5||pivot<8||pivot+8>=points.length)return;
  const unit=(a,b)=>{
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    return {x:dx/length,z:dz/length};
  };
  const incoming=unit(points[pivot-7],points[pivot-5]),outgoing=unit(points[pivot+3],points[pivot+5]);
  const turn=Math.acos(Math.max(-1,Math.min(1,incoming.x*outgoing.x+incoming.z*outgoing.z)));
  const cross=incoming.x*outgoing.z-incoming.z*outgoing.x;
  if(turn<1.3||turn>2||cross<.8)return;
  const before=points[pivot-5],after=points[pivot+3];
  const run=((after.x-before.x)*outgoing.z-(after.z-before.z)*outgoing.x)/cross;
  const corner={x:before.x+incoming.x*run,z:before.z+incoming.z*run};
  const radius=10,offset=radius*Math.tan(turn/2);
  const start={x:corner.x-incoming.x*offset,z:corner.z-incoming.z*offset};
  const end={x:corner.x+outgoing.x*offset,z:corner.z+outgoing.z*offset};
  const center={x:start.x-incoming.z*radius,z:start.z+incoming.x*radius};
  const locate=point=>{
    let best={distance:Infinity};
    for(let i=1;i<points.length;i++) {
      const hit=segmentDistance(point.x,point.z,points[i-1],points[i]);
      if(hit.distance<best.distance)best={...hit,index:i};
    }
    return best;
  };
  const first=locate(start),last=locate(end);
  if(first.distance>.25||last.distance>.25||first.index>=last.index
    ||first.index<pivot-10||first.index>pivot
    ||last.index<pivot||last.index>pivot+15)return;
  const firstHeight=points[first.index-1].h+(points[first.index].h-points[first.index-1].h)*first.t;
  const lastHeight=points[last.index-1].h+(points[last.index].h-points[last.index-1].h)*last.t;
  const beginning=Math.atan2(start.z-center.z,start.x-center.x),steps=Math.ceil(radius*turn/.55);
  const arc=Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,angle=beginning+turn*t;
    return {x:center.x+radius*Math.cos(angle),z:center.z+radius*Math.sin(angle),h:firstHeight+(lastHeight-firstHeight)*t};
  });
  if(arc.some(v=>Math.abs(v.x)>p.width/2-2||Math.abs(v.z)>p.depth/2-2))return;
  const next=[...points.slice(0,first.index),...arc,...points.slice(last.index)];
  if(routeHasCloseReturn(next,road.halfWidth))return;
  for(let i=first.index;i<=first.index+steps+1;i++) {
    const a=next[i-1],b=next[i];
    if(crossesWater(p,a.x,a.z,b.x,b.z,1.8,field)
      ||bridgeAt(p,a.x,a.z,-road.halfWidth)||bridgeAt(p,b.x,b.z,-road.halfWidth))return;
    const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
    for(let j=0;j<=count;j++)if(blockedAt(p,a.x+(b.x-a.x)*j/count,a.z+(b.z-a.z)*j/count,1.8))return;
  }
  const limits=[...corridor.limits.slice(0,first.index)];
  for(let i=first.index;i<=first.index+steps+1;i++)limits.push(.49*Math.hypot(next[i].x-next[i-1].x,next[i].z-next[i-1].z));
  limits.push(...corridor.limits.slice(last.index+1));
  if(limits.length!==next.length)throw new Error('Stvor switchback limit mismatch');
  corridor.points=next;corridor.limits=limits;
  road.points=next.map(v=>({x:v.x,z:v.z}));
}
function roadGrade(p,field,road) {
  if(road.blocked)return Infinity;
  const points=road.points?.length?road.points:[road.a,road.b];let worst=0;
  for(let j=1;j<points.length;j++) {
    const a=points[j-1],b=points[j],length=Math.hypot(b.x-a.x,b.z-a.z);
    if(length<1e-5)continue;
    const steps=Math.max(1,Math.ceil(length/.5)),sx=-(b.z-a.z)/length,sz=(b.x-a.x)/length;
    for(const offset of [-1.25,0,1.25]) {
      let previous=groundHeight(p,field,a.x+sx*offset,a.z+sz*offset,true);
      for(let k=1;k<=steps;k++) {
        const next=groundHeight(p,field,a.x+(b.x-a.x)*k/steps+sx*offset,a.z+(b.z-a.z)*k/steps+sz*offset,true);
        worst=Math.max(worst,Math.abs(next-previous)/(length/steps));previous=next;
      }
    }
  }
  return worst;
}
// The client walks on a 128-cell triangulated terrain mesh. A centre-line
// height check misses a steep crossfall inside a wide access road, even when
// the analytic height varies gently along each wheel track.
function roadSurfaceSlope(p,field,road) {
  const grid=p.terrainSegments||128;
  const stepsX=p.width/grid,stepsZ=p.depth/grid;
  const halfX=p.width/2,halfZ=p.depth/2;
  const vertices=new Map();
  const vertex=(ix,iz)=>{
    const key=ix+iz*(grid+1);
    if(!vertices.has(key))vertices.set(key,groundHeight(p,field,ix*stepsX-halfX,iz*stepsZ-halfZ,false));
    return vertices.get(key);
  };
  const triangleSlope=(x,z)=>{
    if(bridgeAt(p,x,z)||Math.abs(x)>=halfX||Math.abs(z)>=halfZ)return 0;
    const ix=Math.max(0,Math.min(grid-1,Math.floor((x+halfX)/stepsX)));
    const iz=Math.max(0,Math.min(grid-1,Math.floor((z+halfZ)/stepsZ)));
    const x0=ix*stepsX-halfX,z0=iz*stepsZ-halfZ;
    const a=vertex(ix,iz),b=vertex(ix+1,iz),c=vertex(ix,iz+1),d=vertex(ix+1,iz+1);
    return (x-x0)/stepsX+(z-z0)/stepsZ<=1
      ?Math.hypot((b-a)/stepsX,(c-a)/stepsZ)
      :Math.hypot((d-c)/stepsX,(d-b)/stepsZ);
  };
  const points=road.points?.length?road.points:[road.a,road.b];
  let worst=0;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],run=Math.hypot(b.x-a.x,b.z-a.z);
    if(run<1e-5)continue;
    const sx=-(b.z-a.z)/run,sz=(b.x-a.x)/run;
    const lane=Math.min(1.25,Math.max(0,road.halfWidth-.5));
    const count=Math.max(1,Math.ceil(run/1.25));
    for(let j=0;j<=count;j++)for(const offset of [-lane,0,lane]) {
      const x=a.x+(b.x-a.x)*j/count+sx*offset,z=a.z+(b.z-a.z)*j/count+sz*offset;
      worst=Math.max(worst,triangleSlope(x,z));
    }
  }
  return worst;
}
function gradeRoad(p,field,road,preferredGrade=.4,preferredLanding=12,preserveControls=false,bridgeLandingRun=0,authoredRoute=false) {
      let route=road.blocked?null:road.points;
      if(!route?.length)route=routeOnLand(p,field,road.a||p.hub,road.b,1.8,Infinity);
      if(!route)throw new Error('Cannot grade submerged access '+p.zoneId+' '+road.id);
      let maxGrade=preferredGrade,landing=preferredLanding;
      const routeUsable=path=>{
        if(!path?.length||path.length<2||routeHasCloseReturn(path,road.halfWidth))return false;
        if(path.slice(1).some((v,i)=>crossesWater(p,path[i].x,path[i].z,v.x,v.z,1.8,field)))return false;
        const {points,distance,along}=sampleRoute(path,preserveControls);
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i];
          if(crossesWater(p,a.x,a.z,b.x,b.z,1.8,field))return false;
          const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
          for(let j=0;j<=n;j++)if(blockedAt(p,a.x+(b.x-a.x)*j/n,a.z+(b.z-a.z)*j/n,1.8))return false;
        }
        const anchors=fixedRoadHeights(p,field,points,road,bridgeLandingRun);
        const bridgeTouched=anchors.length>2||bridgeAt(p,points[0].x,points[0].z,-road.halfWidth)||bridgeAt(p,points.at(-1).x,points.at(-1).z,-road.halfWidth);
        return anchorsFit(anchors,gradeLimits(points,distance,along,maxGrade,bridgeTouched?0:landing,anchors));
      };
      const authoredSamples=authoredRoute?sampleRoute(road.points,preserveControls).points:null;
      if(authoredRoute&&!routeUsable(route)) {
        // Keep the existing higher grade allowance, but never search for a
        // different contour when engineering supplied an explicit route.
        maxGrade=Math.max(maxGrade,.49);landing=4;
        if(!routeUsable(route))throw new Error('Authored physical road route cannot be graded '+p.zoneId+' '+road.id);
      }
      const direct=routeUsable(route)?null:routeOnLand(p,field,road.a||p.hub,road.b,1.8,Infinity);
      if(routeUsable(direct))route=direct;
      const findContour=()=>{
        const a=route[0],b=route.at(-1),dx=b.x-a.x,dz=b.z-a.z,run=Math.hypot(dx,dz);
        if(run<1e-6)return null;
        const side={x:-dz/run,z:dx/run};
        let replacement=null;
        // A broad, same-side contour is preferable to a three-turn zigzag: the
        // latter can gain run by crossing its own earthwork at a different level.
        for(const pattern of [
          {widths:[40,56,72,88,104,120,136,144],turns:[1/3,2/3],alternate:false},
          {widths:[16,24,32,40,56,72,88,104,120,136,144],turns:[.25,.5,.75],alternate:true}
        ]) {
          for(const width of pattern.widths) {
            let atWidth=null;
            for(const sign of [-1,1]) {
              const via=[a,...pattern.turns.map((t,i)=>({
                x:Math.max(-p.width/2+12,Math.min(p.width/2-12,a.x+dx*t+side.x*width*sign*(pattern.alternate&&i%2?-1:1))),
                z:Math.max(-p.depth/2+12,Math.min(p.depth/2-12,a.z+dz*t+side.z*width*sign*(pattern.alternate&&i%2?-1:1)))
              })),b];
              const candidate=[];
              for(let i=1;i<via.length;i++){const leg=routeOnLand(p,field,via[i-1],via[i],1.8,Infinity);if(!leg){candidate.length=0;break;}candidate.push(...(i===1?leg:leg.slice(1)));}
              if(routeUsable(candidate)&&(!atWidth||routeLength(candidate)<routeLength(atWidth)))atWidth=candidate;
            }
            if(atWidth){replacement=atWidth;break;}
          }
          if(replacement)break;
        }
        return replacement;
      };
      if(!routeUsable(route))route=findContour()||route;
      if(!routeUsable(route)) {
        // Some fixed bridge-to-gate links climb faster than 0.4 even along the
        // shortest safe route. The audited limit is 0.55; retain a margin.
        maxGrade=.49;landing=4;
        if(!routeUsable(route)) {
          if(routeUsable(direct))route=direct;
          else route=findContour()||route;
        }
      }
      // A just-feasible climb has no room for the shared, level junction at
      // its hub. A shallow cubic shoulder adds run without a tight hairpin or
      // a steep inside wheel track. Put it on the side away from other exits.
      const spareRun=path=>{
        const {points,distance,along}=sampleRoute(path,preserveControls);
        const anchors=fixedRoadHeights(p,field,points,road,bridgeLandingRun);
        if(anchors.length!==2||bridgeAt(p,points[0].x,points[0].z,-road.halfWidth)
          ||bridgeAt(p,points.at(-1).x,points.at(-1).z,-road.halfWidth))return Infinity;
        const limits=gradeLimits(points,distance,along,maxGrade,landing,anchors);
        return limits.reduce((sum,v)=>sum+v,0)-Math.abs(anchors[1][1]-anchors[0][1]);
      };
      const reserve=2*p.gain/160;
      if(routeUsable(route)&&spareRun(route)<reserve) {
        const a=route[0],b=route.at(-1),dx=b.x-a.x,dz=b.z-a.z,run=Math.hypot(dx,dz);
        const scale=p.gain/160;
        if(run>30*scale) {
          const forward={x:dx/run,z:dz/run},side={x:-dz/run,z:dx/run};
          const departures=p.roads.filter(r=>r!==road&&r.type==='track'&&Math.hypot(r.a.x-a.x,r.a.z-a.z)<4);
          const occupied=departures.reduce((sum,r)=>sum+(dx*(r.b.z-a.z)-dz*(r.b.x-a.x))/Math.max(1,Math.hypot(r.b.x-a.x,r.b.z-a.z)),0);
          const signs=occupied<0?[1,-1]:[-1,1];
          let shoulder=null;
          for(const width of [8,12,16,20,24].map(v=>v*scale)) {
            for(const sign of signs) {
              const first={x:a.x+forward.x*Math.min(10*scale,run*.1)+side.x*width*sign,z:a.z+forward.z*Math.min(10*scale,run*.1)+side.z*width*sign};
              const second={x:a.x+forward.x*run*.45+side.x*width*.85*sign,z:a.z+forward.z*run*.45+side.z*width*.85*sign};
              const count=Math.max(24,Math.ceil(run/2));
              const candidate=Array.from({length:count+1},(_,i)=>{
                const t=i/count,u=1-t;
                return {x:u*u*u*a.x+3*u*u*t*first.x+3*u*t*t*second.x+t*t*t*b.x,
                  z:u*u*u*a.z+3*u*u*t*first.z+3*u*t*t*second.z+t*t*t*b.z};
              });
              if(candidate.slice(1,-1).some(v=>Math.abs(v.x)>p.width/2+1e-4||Math.abs(v.z)>p.depth/2+1e-4))continue;
              if(!routeUsable(candidate)||spareRun(candidate)<reserve)continue;
              shoulder=candidate;break;
            }
            if(shoulder)break;
          }
          if(shoulder)route=shoulder;
        }
      }
      if(!routeUsable(route))throw new Error('Road requires a non-overlapping contour approach '+p.zoneId+' '+road.id);
      const {points,distance,along}=sampleRoute(route,preserveControls);
      if(authoredSamples&&(points.length!==authoredSamples.length||points.some((v,i)=>
        Math.hypot(v.x-authoredSamples[i].x,v.z-authoredSamples[i].z)>1e-8)))
        throw new Error('Authored physical road route was replaced '+p.zoneId+' '+road.id);
      for(const v of points)v.h=groundHeight(p,field,v.x,v.z,true);
      const anchors=fixedRoadHeights(p,field,points,road,bridgeLandingRun);
      const bridgeTouched=anchors.length>2||bridgeAt(p,points[0].x,points[0].z,-road.halfWidth)||bridgeAt(p,points.at(-1).x,points.at(-1).z,-road.halfWidth);
      const limits=gradeLimits(points,distance,along,maxGrade,bridgeTouched?0:landing,anchors),prefix=[0],fixed=new Map(anchors);
      for(let i=1;i<points.length;i++)prefix.push(prefix.at(-1)+limits[i]);
      if(!anchorsFit(anchors,limits))throw new Error('Road bridge and bank grades cannot meet '+p.zoneId+' '+road.id);
      for(let i=0;i<points.length;i++) {
        let low=-Infinity,high=Infinity;
        for(const [at,height] of anchors) {
          const reach=Math.abs(prefix[i]-prefix[at]);
          low=Math.max(low,height-reach);high=Math.min(high,height+reach);
        }
        if(low>high+1e-6)throw new Error('Road height anchors conflict '+p.zoneId+' '+road.id);
        points[i].h=fixed.has(i)?fixed.get(i):Math.max(low,Math.min(high,points[i].h));
      }
      for(let pass=0;pass<20;pass++) {
        for(let i=1;i<points.length-1;i++)if(!fixed.has(i)){const d=limits[i];points[i].h=Math.max(points[i-1].h-d,Math.min(points[i-1].h+d,points[i].h));}
        for(let i=points.length-2;i>0;i--)if(!fixed.has(i)){const d=limits[i+1];points[i].h=Math.max(points[i+1].h-d,Math.min(points[i+1].h+d,points[i].h));}
      }
      const corridor={id:p.zoneId+'_'+road.id,halfWidth:road.halfWidth,blend:6,points,limits};
      road.points=points.map(v=>({x:v.x,z:v.z}));road.blocked=false;
      if(!authoredRoute)roundStvorSwitchback(p,field,road,corridor);
      return corridor;
}
function gradeBoundSiteRoad(p,field,road,trunk,binding) {
  const wanted=binding.branch;
  let branchIndex=0,nearest=Infinity;
  for(let i=0;i<trunk.points.length;i++) {
    const v=trunk.points[i],distance=Math.hypot(v.x-wanted.x,v.z-wanted.z);
    if(distance<nearest){nearest=distance;branchIndex=i;}
  }
  if(nearest>1.25||branchIndex<1||branchIndex>=trunk.points.length-1)
    throw new Error('Site trunk branch misses graded road '+p.zoneId+' '+road.id);
  const prefix=trunk.points.slice(0,branchIndex+1).map(v=>({...v}));
  const branch=routeOnLand(p,field,prefix.at(-1),road.b,1.8,Infinity);
  if(!branch||branch.length<2)
    throw new Error('Site branch has no dry access '+p.zoneId+' '+road.id);
  const sampled=sampleRoute(branch).points.slice(1);
  const points=[...prefix,...sampled];
  for(let i=branchIndex+1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    if(crossesWater(p,a.x,a.z,b.x,b.z,1.8,field))
      throw new Error('Site branch crosses water '+p.zoneId+' '+road.id);
    const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
    for(let j=0;j<=count;j++)if(blockedAt(p,a.x+(b.x-a.x)*j/count,a.z+(b.z-a.z)*j/count,1.8))
      throw new Error('Site branch crosses obstacle '+p.zoneId+' '+road.id);
  }
  const distance=[0];
  for(let i=1;i<points.length;i++)distance.push(distance.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  const anchors=prefix.map((v,i)=>[i,v.h]);
  anchors.push([points.length-1,groundHeight(p,field,road.b.x,road.b.z,true)]);
  for(let i=branchIndex+1;i<points.length-1;i++) {
    const b=bridgeAt(p,points[i].x,points[i].z,-road.halfWidth);
    if(b)anchors.push([i,bridgeHeight(b,points[i].x,points[i].z)]);
  }
  anchors.sort((a,b)=>a[0]-b[0]);
  const limits=gradeLimits(points,distance,distance.at(-1),binding.preferredGrade??.49,binding.landing??4,anchors);
  for(let i=0;i<=branchIndex;i++)limits[i]=trunk.limits[i];
  if(!anchorsFit(anchors,limits))
    throw new Error('Site trunk and entrance grades cannot meet '+p.zoneId+' '+road.id);
  const fixed=new Map(anchors),cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative.at(-1)+limits[i]);
  for(let i=branchIndex+1;i<points.length;i++) {
    let low=-Infinity,high=Infinity;
    for(const [at,height] of anchors) {
      const reach=Math.abs(cumulative[i]-cumulative[at]);
      low=Math.max(low,height-reach);high=Math.min(high,height+reach);
    }
    if(low>high+1e-6)throw new Error('Site branch height anchors conflict '+p.zoneId+' '+road.id);
    const soil=groundHeight(p,field,points[i].x,points[i].z,true);
    points[i].h=fixed.has(i)?fixed.get(i):Math.max(low,Math.min(high,soil));
  }
  for(let pass=0;pass<20;pass++) {
    for(let i=branchIndex+1;i<points.length-1;i++)if(!fixed.has(i)) {
      const d=limits[i];points[i].h=Math.max(points[i-1].h-d,Math.min(points[i-1].h+d,points[i].h));
    }
    for(let i=points.length-2;i>branchIndex;i--)if(!fixed.has(i)) {
      const d=limits[i+1];points[i].h=Math.max(points[i+1].h-d,Math.min(points[i+1].h+d,points[i].h));
    }
  }
  road.points=points.map(v=>({x:v.x,z:v.z}));road.blocked=false;
  return {id:p.zoneId+'_'+road.id,halfWidth:road.halfWidth,blend:6,points,limits};
}
function applyRoadContourVia(p,field,road,binding) {
  const original=road.points?.length?road.points:[road.a,road.b];
  let joinIndex=-1,nearest=Infinity;
  for(let i=1;i<original.length-1;i++) {
    const distance=Math.hypot(original[i].x-binding.join.x,original[i].z-binding.join.z);
    if(distance<nearest){nearest=distance;joinIndex=i;}
  }
  if(nearest>.5)throw new Error('Road contour join misses authored route '+p.zoneId+' '+road.id);
  const stops=[original[0],...binding.via,binding.join],approach=[];
  for(let i=1;i<stops.length;i++) {
    const leg=routeOnLand(p,field,stops[i-1],stops[i],1.8,Infinity);
    if(!leg?.length)throw new Error('Road contour has no dry leg '+p.zoneId+' '+road.id+' '+i);
    approach.push(...(i===1?leg:leg.slice(1)));
  }
  const route=[...approach,...original.slice(joinIndex+1)];
  if(routeHasCloseReturn(route,road.halfWidth))
    throw new Error('Road contour doubles back into its earthwork '+p.zoneId+' '+road.id);
  road.points=route;road.blocked=false;
}
function roundBoundTrunkTurn(p,field,road,corridor,binding) {
  if(!binding.turn)return;
  const turn=binding.turn,points=corridor.points;
  let pivot=0,nearest=Infinity;
  for(let i=1;i<points.length-1;i++) {
    const d=Math.hypot(points[i].x-turn.x,points[i].z-turn.z);
    if(d<nearest){nearest=d;pivot=i;}
  }
  if(nearest>Math.max(3,turn.radius*.4)||pivot<5||pivot+5>=points.length)
    throw new Error('Authored trunk turn misses graded road '+p.zoneId+' '+road.id);
  const direction=(a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);return {x:dx/d,z:dz/d};};
  // Route smoothing can already round the authored corner before grading.
  // Read the straight tangents outside that preliminary bend, then replace
  // it with the exact-radius arc rather than rounding the shallow arc twice.
  const distanceFromTurn=v=>Math.hypot(v.x-turn.x,v.z-turn.z);
  const outerTangent=before=>{
    const indices=before?Array.from({length:pivot},(_,j)=>pivot-j):Array.from({length:points.length-pivot-1},(_,j)=>pivot+j+1);
    for(const i of indices){
      const a=points[i-1],b=points[i];
      if(distanceFromTurn(a)>=turn.radius*.8&&distanceFromTurn(b)>=turn.radius*.8
        &&Math.min(distanceFromTurn(a),distanceFromTurn(b))<=turn.radius*3)return direction(a,b);
    }
    return null;
  };
  const incoming=nearest>2?outerTangent(true)||direction(points[pivot-4],points[pivot-2]):direction(points[pivot-4],points[pivot-2]);
  const outgoing=nearest>2?outerTangent(false)||direction(points[pivot+2],points[pivot+4]):direction(points[pivot+2],points[pivot+4]);
  const angle=Math.acos(Math.max(-1,Math.min(1,incoming.x*outgoing.x+incoming.z*outgoing.z)));
  const sign=Math.sign(incoming.x*outgoing.z-incoming.z*outgoing.x);
  if(angle<.7||angle>2||!sign)
    throw new Error('Authored trunk turn has no right-angle bend '+p.zoneId+' '+road.id);
  const offset=turn.radius*Math.tan(angle/2);
  const start={x:turn.x-incoming.x*offset,z:turn.z-incoming.z*offset};
  const end={x:turn.x+outgoing.x*offset,z:turn.z+outgoing.z*offset};
  const center={x:start.x-sign*incoming.z*turn.radius,z:start.z+sign*incoming.x*turn.radius};
  const locate=point=>{
    let best={distance:Infinity};
    for(let i=1;i<points.length;i++) {
      const hit=segmentDistance(point.x,point.z,points[i-1],points[i]);
      if(hit.distance<best.distance)best={...hit,index:i};
    }
    return best;
  };
  const first=locate(start),last=locate(end);
  if(first.distance>.4||last.distance>.4||first.index>=last.index)
    throw new Error('Authored trunk turn tangents miss road '+p.zoneId+' '+road.id);
  const heightAt=hit=>points[hit.index-1].h+(points[hit.index].h-points[hit.index-1].h)*hit.t;
  const h0=heightAt(first),h1=heightAt(last);
  const begin=Math.atan2(start.z-center.z,start.x-center.x),steps=Math.ceil(turn.radius*angle/.5);
  const arc=Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,a=begin+sign*angle*t;
    return {x:center.x+turn.radius*Math.cos(a),z:center.z+turn.radius*Math.sin(a),h:h0+(h1-h0)*t};
  });
  // A tangent can land only centimetres from an existing sample. Eliminate
  // those slivers on either side: their nearest-height switch makes an inside
  // wheel climb abruptly even when the circular centreline is smooth.
  const dropStart=first.index>1 && Math.hypot(arc[0].x-points[first.index-1].x,
    arc[0].z-points[first.index-1].z)<.25 ? 1 : 0;
  const dropEnd=last.index<points.length-1 && Math.hypot(arc.at(-1).x-points[last.index].x,
    arc.at(-1).z-points[last.index].z)<.25 ? 1 : 0;
  const startIndex=first.index-dropStart,endIndex=startIndex+arc.length;
  const next=[...points.slice(0,startIndex),...arc,...points.slice(last.index+dropEnd)];
  for(let i=startIndex;i<=endIndex;i++) {
    const a=next[i-1],b=next[i];
    if(!b)break;
    if(crossesWater(p,a.x,a.z,b.x,b.z,1.8,field))
      throw new Error('Authored trunk turn crosses water '+p.zoneId+' '+road.id);
    const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
    for(let j=0;j<=count;j++)if(blockedAt(p,a.x+(b.x-a.x)*j/count,a.z+(b.z-a.z)*j/count,1.8))
      throw new Error('Authored trunk turn crosses obstacle '+p.zoneId+' '+road.id+' '+(a.x+(b.x-a.x)*j/count).toFixed(2)+','+(a.z+(b.z-a.z)*j/count).toFixed(2));
  }
  const limits=next.map((v,i)=>{
    if(!i)return 0;
    if(i<startIndex)return corridor.limits[i];
    if(i<=endIndex) {
      const geometric=.49*Math.hypot(v.x-next[i-1].x,v.z-next[i-1].z);
      if(dropStart && i===startIndex)
        return Math.min(geometric,corridor.limits[first.index-1]+corridor.limits[first.index]);
      if(dropEnd && i===endIndex)
        return Math.min(geometric,corridor.limits[last.index]+corridor.limits[last.index+1]);
      return geometric;
    }
    return corridor.limits[last.index+dropEnd+i-endIndex];
  });
  corridor.points=next;corridor.limits=limits;
  road.points=next.map(v=>({x:v.x,z:v.z}));
}
function shareCorridors(profiles,owners) {
  const authored=[...owners.values()].map(({p,c})=>({id:c.id,halfWidth:c.halfWidth/p.width*20,blend:c.blend/p.width*20,points:c.points.map(v=>({...mapPoint(p,v.x,v.z),h:p.datum+v.h/p.gain})),limits:c.limits.map(v=>v/p.gain)})).sort((a,b)=>a.id.localeCompare(b.id));
  for(const p of profiles) {
    p.corridors=[];
    for(const c of authored) {
      const margin=c.halfWidth+c.blend;
      if(Math.max(...c.points.map(v=>v.x))+margin<p.mapMinX || Math.min(...c.points.map(v=>v.x))-margin>p.mapMinX+20 || Math.max(...c.points.map(v=>v.y))+margin<p.mapMinY || Math.min(...c.points.map(v=>v.y))-margin>p.mapMinY+20)continue;
      p.corridors.push({id:c.id,halfWidth:c.halfWidth/20*p.width,blend:c.blend/20*p.width,points:c.points.map(v=>({x:(v.x-p.mapMinX-10)/20*p.width,z:(p.mapMinY+10-v.y)/20*p.depth,h:(v.h-p.datum)*p.gain})),limits:c.limits.map(v=>v*p.gain)});
    }
  }
}
function applyBoundRoadShoulder(p,field,road,binding) {
  const path=road.points;
  if(!path?.length)throw new Error('Bound road shoulder has no graded path '+p.zoneId+' '+road.id);
  const locate=target=>{
    let best={index:-1,distance:Infinity};
    for(let i=0;i<path.length;i++){
      const distance=Math.hypot(path[i].x-target.x,path[i].z-target.z);
      if(distance<best.distance)best={index:i,distance};
    }
    return best;
  };
  const first=locate(binding.from),last=locate(binding.to);
  if(first.distance>1.25||last.distance>1.25||last.index-first.index<20)
    throw new Error('Bound road shoulder misses its authored contour '+p.zoneId+' '+road.id);
  const source=path.map(v=>({...v}));
  for(let i=first.index;i<=last.index;i++){
    const t=(i-first.index)/(last.index-first.index);
    const offset=binding.offset*Math.sin(Math.PI*t)**2;
    path[i]={x:source[i].x+binding.normal.x*offset,z:source[i].z+binding.normal.z*offset};
  }
  if(routeHasCloseReturn(path,road.halfWidth))
    throw new Error('Bound road shoulder returns into its own earthwork '+p.zoneId+' '+road.id);
  const id=p.zoneId+'_'+road.id,prior=p.corridors;
  p.corridors=prior.filter(c=>c.id!==id);
  let corridor;
  try{corridor=gradeRoad(p,field,road,binding.preferredGrade);}finally{p.corridors=prior;}
  roundBoundTrunkTurn(p,field,road,corridor,{turn:binding.turn});
  for(const cap of binding.gradientCaps||[])for(let i=cap.first;i<=cap.last;i++){
    const a=corridor.points[i-1],b=corridor.points[i];
    if(!a||!b)throw new Error('Bound road gradient cap misses contour '+id);
    corridor.limits[i]=Math.min(corridor.limits[i],cap.grade*Math.hypot(b.x-a.x,b.z-a.z));
  }
  if(binding.bendCap)for(let i=1;i<corridor.points.length;i++){
    const a=corridor.points[i-1],b=corridor.points[i],cap=binding.bendCap;
    if(b.z<cap.maxZ&&b.x>=cap.minX&&b.x<=cap.maxX)
      corridor.limits[i]=Math.min(corridor.limits[i],cap.grade*Math.hypot(b.x-a.x,b.z-a.z));
  }
  // This high mountain route has only endpoint anchors. Distribute the
  // elevation over its real turn-aware limits before the shared junction
  // solver; otherwise a near-capacity climb converges needlessly slowly.
  if(corridor.points.some(v=>bridgeAt(p,v.x,v.z,-road.halfWidth)))
    throw new Error('Bound road shoulder unexpectedly reaches a bridge '+id);
  const capacity=corridor.limits.reduce((sum,v)=>sum+v,0),start=corridor.points[0].h,
    gain=corridor.points.at(-1).h-start;
  if(capacity<Math.abs(gain)+.1)
    throw new Error('Bound road shoulder has insufficient run '+id+' '+capacity.toFixed(3)+' < '+Math.abs(gain).toFixed(3));
  let used=0;
  for(let i=1;i<corridor.points.length;i++){
    used+=corridor.limits[i];corridor.points[i].h=start+gain*used/capacity;
  }
  if(binding.earthworkHalfWidth)corridor.halfWidth=Math.max(corridor.halfWidth,binding.earthworkHalfWidth);
  return corridor;
}
function joinDryBankRoad(p,field,road,binding) {
  const shared=p.corridors.find(c=>c.id===p.zoneId+'_'+binding.sharedBankRoad);
  if(!shared)throw new Error('Dry bank road has no existing service trunk '+p.zoneId+' '+road.id);
  const pointAtZ=z=>{
    for(let i=1;i<shared.points.length;i++) {
      const a=shared.points[i-1],b=shared.points[i];
      if((a.z-z)*(b.z-z)>0||Math.abs(b.z-a.z)<1e-6)continue;
      const t=(z-a.z)/(b.z-a.z);
      return {x:a.x+(b.x-a.x)*t,z};
    }
    throw new Error('Dry bank service trunk misses join station '+p.zoneId+' '+z);
  };
  const firstTrim=road.points.findIndex(v=>v.z<binding.trimZ);
  if(firstTrim<3||firstTrim>=road.points.length-3)
    throw new Error('Dry bank route misses service approach '+p.zoneId+' '+road.id);
  const originalEnd=road.points.at(-1);
  road.points=[...road.points.slice(0,firstTrim),pointAtZ(binding.joinZ),
    pointAtZ(binding.splitZ),originalEnd];
  let c=gradeRoad(p,field,road,.49,4);
  if(c.points.some(v=>bridgeAt(p,v.x,v.z,-road.halfWidth)))
    throw new Error('Dry bank shared road unexpectedly enters a bridge '+p.zoneId+' '+road.id);
  // The bank turn and its inside wheel need gentler vertical grades than the
  // straight runs. Keep the same absolute gate heights and distribute the
  // climb over the full physical route, including the shared service trunk.
  for(let i=1;i<c.points.length;i++) {
    const a=c.points[i-1],b=c.points[i],run=Math.hypot(b.x-a.x,b.z-a.z);
    const grade=i>=2&&i<=10?.4:(b.z>=binding.bendMinZ&&b.z<=binding.bendMaxZ?binding.bendGrade:Infinity);
    c.limits[i]=Math.min(c.limits[i],grade*run);
  }
  const capacity=c.limits.reduce((sum,v)=>sum+v,0);
  const first=c.points[0].h,gain=c.points.at(-1).h-first;
  if(capacity<Math.abs(gain)+.5)
    throw new Error('Dry bank shared route lacks grade reserve '+p.zoneId+' '+road.id);
  let used=0;
  for(let i=1;i<c.points.length;i++) {
    used+=c.limits[i];
    c.points[i].h=first+gain*used/capacity;
  }
  return c;
}
function gradeAccess(profiles,field,plan,options={}) {
  const owners=new Map();
  const siteBindings=new Map((plan.siteTrunkBindings||[]).map(v=>[v.zone+'_site_'+v.site,v]));
  const roadBindings=new Map((plan.roadTrunkBindings||[]).map(v=>[v.zone+'_'+v.road,v]));
  const corridorBindings=new Map((plan.roadCorridorBindings||[]).map(v=>[v.zone+'_'+v.road,v]));
  const contourBindings=new Map((plan.roadContourBindings||[]).map(v=>[v.zone+'_'+v.road,v]));
  const dryBindings=new Map((plan.roadDryBindings||[]).map(v=>[v.zone+'_'+v.road,v]));
  const forceGrade=new Set((plan.roadForceGrade||[]).map(v=>v.zone+'_'+v.road));
  const initialGrades=new Map();
  for(const binding of plan.roadInitialGrades||[]) {
    const id=binding.zone+'_'+binding.road;
    if(initialGrades.has(id)||!Number.isFinite(binding.preferredGrade)
      ||binding.preferredGrade<=0||binding.preferredGrade>.49
      ||!Number.isFinite(binding.landing)||binding.landing<0)
      throw new Error('Invalid initial road grade '+id);
    const owner=profiles.find(p=>p.zoneId===binding.zone);
    if(!owner?.roads.some(r=>r.id===binding.road))throw new Error('Missing initial road grade '+id);
    initialGrades.set(id,binding);forceGrade.add(id);
  }
  const trunkTurns=new Map((plan.siteTrunkBindings||[]).filter(v=>v.turn).map(v=>[v.zone+'_'+v.trunk,v]));
  const roadTurns=new Map((plan.roadTurns||[]).map(v=>[v.zone+'_'+v.road,v.turns]));
  const applyTurns=(p,road,c)=>{
    const id=p.zoneId+'_'+road.id,siteTurn=trunkTurns.get(id)?.turn;
    for(const turn of [...(siteTurn?[siteTurn]:[]),...(roadTurns.get(id)||[])])
      roundBoundTrunkTurn(p,field,road,c,{turn});
  };
  const applyCorridorShape=c=>{
    const binding=corridorBindings.get(c.id);
    if(binding?.blend!==undefined)c.blend=binding.blend;
  };
  for(const p of profiles)p.corridors=[];
  // A late corridor can change an earlier sector's ground after that sector
  // was visited. Continue until every unowned access is checked against the
  // final shared terrain, including roads introduced near the end of a pass.
  const maxPasses=8;
  for(let pass=0;pass<maxPasses;pass++) {
    let changed=false;
    for(const p of profiles)for(const road of p.roads.filter(r=>r.type==='track'||r.engineeredStation)) {
      const id=p.zoneId+'_'+road.id,owned=owners.has(id);
      const binding=siteBindings.get(id)||roadBindings.get(id);
      if(pass>0&&owned)continue;
      const dryBinding=dryBindings.get(id);
      // Dry shoreline approaches are planned against the already reconciled
      // network after this loop, never against the raw ungraded field.
      if(dryBinding)continue;
      if(contourBindings.has(id)&&!owned)applyRoadContourVia(p,field,road,contourBindings.get(id));
      if(!binding&&!forceGrade.has(id)&&!road.engineeredStation&&!road.blocked&&roadGrade(p,field,road)<=(owned?.55:.9)+.02)continue;
      // A corridor propagated from a neighbour can steepen an initially sound
      // road, so evaluate again after each world-space propagation.
      const original=p.corridors;
      p.corridors=p.corridors.filter(c=>c.id!==id);
      let c;
      if(binding) {
        const trunkId=p.zoneId+'_'+binding.trunk;
        let trunk=owners.get(trunkId)?.c;
        if(!trunk) {
          const trunkRoad=p.roads.find(v=>v.id===binding.trunk);
          if(!trunkRoad)throw new Error('Missing site trunk '+trunkId);
          trunk=gradeRoad(p,field,trunkRoad,pass===0?.4:.35);
          applyTurns(p,trunkRoad,trunk);
          applyCorridorShape(trunk);
          owners.set(trunkId,{p,c:trunk});
          changed=true;
        }
        p.corridors.push(trunk);
        try{c=gradeBoundSiteRoad(p,field,road,trunk,binding);}finally{p.corridors.pop();}
      } else {
        const initial=initialGrades.get(id);
        c=initial?gradeRoad(p,field,road,initial.preferredGrade,initial.landing,initial.preserveControls===true)
          :gradeRoad(p,field,road,pass===0?.4:.35);
        applyTurns(p,road,c);
      }
      applyCorridorShape(c);
      p.corridors=original;
      owners.set(id,{p,c});changed=true;
    }
    if(!changed)break;
    shareCorridors(profiles,owners);
    if(pass===maxPasses-1)throw new Error('Road grading did not stabilize across sectors');
  }
  for(const apron of plan.junctionAprons||[]) {
    const p=profiles.find(v=>v.zoneId===apron.zone),road=p?.roads.find(v=>v.id===apron.road);
    if(!road||road.blocked||!p.corridors.some(c=>c.id===p.zoneId+'_'+road.id))
      throw new Error('Junction apron needs a graded road '+apron.zone+' '+apron.road);
    if(crossesWater(p,apron.a.x,apron.a.z,apron.b.x,apron.b.z,1.8,field))
      throw new Error('Junction apron crosses water '+apron.zone+' '+apron.id);
    const height=groundHeight(p,field,road.b.x,road.b.z,true)-apron.belowEntrance;
    const c={id:p.zoneId+'_'+apron.id,halfWidth:apron.halfWidth,blend:apron.blend,
      points:[{...apron.a,h:height},{...apron.b,h:height}],limits:[0,0]};
    owners.set(c.id,{p,c});
  }
  if(plan.junctionAprons?.length)shareCorridors(profiles,owners);
  options.onCoreGraded?.(profiles);
  finishGradeAccess(profiles,field,plan,owners);
  if(plan.roadPhysicalBindings?.length) {
    // Solve the authored road network before adding local, physical-width
    // shoulders. The neighbouring junctions then share one height plane.
    reconcileJunctions(profiles);
    applyRoadPhysicalBindings(profiles,field,plan.roadPhysicalBindings);
  }
}
function applyRoadPhysicalBindings(profiles,field,bindings) {
  let phase=null;
  let owners=new Map();
  const collect=()=>{
    owners=new Map();
    for(const p of profiles)for(const c of p.corridors||[])
      if(c.id.startsWith(p.zoneId+'_'))owners.set(c.id,{p,c});
  };
  collect();
  for(const binding of bindings) {
    if(!Number.isInteger(binding.phase)||binding.phase<1)
      throw new Error('Physical road binding requires an ordered phase '+binding.zone+' '+binding.road);
    if(phase!==null && binding.phase!==phase) {
      if(binding.phase!==phase+1)throw new Error('Physical road phases must be consecutive');
      shareCorridors(profiles,owners);
      reconcileJunctions(profiles);
      collect();
    }
    phase=binding.phase;
    const p=profiles.find(v=>v.zoneId===binding.zone);
    let road=p?.roads.find(v=>v.id===binding.road);
    if(p && !road && binding.route) {
      const points=binding.route.map(([x,z])=>({x,z}));
      if(points.length<2 || !points.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.z)))
        throw new Error('Physical road route is invalid '+binding.zone+' '+binding.road);
      road={id:binding.road,type:'track',halfWidth:binding.halfWidth,
        a:points[0],b:points.at(-1),points,blocked:false};
      p.roads.push(road);
    }
    if(!p||!road||road.blocked||!['track','road'].includes(road.type))
      throw new Error('Physical road binding has no built ground road '+binding.zone+' '+binding.road);
    const preferredGrade=binding.preferredGrade??.4,landing=binding.landing??12,bridgeLandingRun=binding.bridgeLandingRun??0;
    if(!Number.isFinite(preferredGrade)||preferredGrade<=0||preferredGrade>.55||!Number.isFinite(landing)||landing<0
      ||!Number.isFinite(bridgeLandingRun)||bridgeLandingRun<0||bridgeLandingRun>12)
      throw new Error('Invalid physical road grade '+binding.zone+' '+binding.road);
    const id=p.zoneId+'_'+road.id;
    if(binding.route) {
      const points=binding.route.map(([x,z])=>({x,z}));
      if(points.length<2||!points.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.z))
        ||Math.hypot(points[0].x-road.a.x,points[0].z-road.a.z)>.01
        ||Math.hypot(points.at(-1).x-road.b.x,points.at(-1).z-road.b.z)>.01)
        throw new Error('Physical road contour moved a fixed endpoint '+binding.zone+' '+binding.road);
      road.points=points;
      p.corridors=p.corridors.filter(c=>c.id!==id);
    }
    let c=p.corridors.find(v=>v.id===id);
    if(binding.trunk) {
      const trunk=p.corridors.find(v=>v.id===p.zoneId+'_'+binding.trunk);
      if(!trunk || binding.trunk===road.id || !Number.isFinite(binding.branch?.x) || !Number.isFinite(binding.branch?.z))
        throw new Error('Physical site road requires an existing trunk and branch '+binding.zone+' '+binding.road);
      p.corridors=p.corridors.filter(v=>v.id!==id);
      c=gradeBoundSiteRoad(p,field,road,trunk,binding);
      p.corridors.push(c);
    }
    if(!c) {
      c=gradeRoad(p,field,road,preferredGrade,landing,binding.preserveControls===true,bridgeLandingRun,!!binding.route);
      p.corridors.push(c);
    }
    if(binding.turn)roundBoundTrunkTurn(p,field,road,c,binding);
    if(binding.earthworkHalfWidth)c.halfWidth=Math.max(c.halfWidth,binding.earthworkHalfWidth);
    owners.set(id,{p,c});
  }
  if(phase!==null)shareCorridors(profiles,owners);
}
function finishGradeAccess(profiles,field,plan,owners) {
  const dryBindings=new Map((plan.roadDryBindings||[]).map(v=>[v.zone+'_'+v.road,v]));
  if(plan.roadShoulderBindings?.length) {
    reconcileJunctions(profiles);
    for(const [id,owner] of owners){
      const solved=owner.p.corridors.find(v=>v.id===id);
      if(!solved)throw new Error('Reconciled road owner missing '+id);
      owner.c=solved;
    }
    for(const binding of plan.roadShoulderBindings){
      const p=profiles.find(v=>v.zoneId===binding.zone),road=p?.roads.find(v=>v.id===binding.road);
      if(!road)throw new Error('Missing bound road shoulder '+binding.zone+' '+binding.road);
      const c=applyBoundRoadShoulder(p,field,road,binding);
      owners.set(c.id,{p,c});
    }
    shareCorridors(profiles,owners);
  }
  if(dryBindings.size) {
    // The ordinary roads now have one shared height network. Select all dry
    // bank routes against that stable ground, then solve their new junctions
    // with the existing roads in the caller's final reconciliation pass.
    reconcileJunctions(profiles);
    for(const [id,owner] of owners) {
      const solved=owner.p.corridors.find(v=>v.id===id);
      if(!solved)throw new Error('Reconciled road owner missing '+id);
      owner.c=solved;
    }
    for(const binding of plan.roadDryBindings) {
      const p=profiles.find(v=>v.zoneId===binding.zone);
      if(!p)continue;
      const road=p.roads.find(v=>v.id===binding.road);
      if(!road)throw new Error('Missing dry bank road '+binding.zone+' '+binding.road);
      const route=binding.route?.map(([x,z])=>({x,z}))
        ||routeOnLand(p,field,road.a||p.hub,road.b,binding.radius,Infinity);
      if(!route)throw new Error('Dry bank approach has no full-width route '+binding.zone+' '+binding.road);
      if(binding.route) {
        const start=road.a||p.hub,end=road.b;
        if(Math.hypot(route[0].x-start.x,route[0].z-start.z)>.01
          ||Math.hypot(route.at(-1).x-end.x,route.at(-1).z-end.z)>.01)
          throw new Error('Dry bank contour moved a fixed endpoint '+binding.zone+' '+binding.road);
        for(let i=1;i<route.length;i++) {
          const a=route[i-1],b=route[i],run=Math.hypot(b.x-a.x,b.z-a.z);
          if(crossesWater(p,a.x,a.z,b.x,b.z,binding.radius,field))
            throw new Error('Dry bank contour crosses water '+binding.zone+' '+binding.road);
          const steps=Math.max(1,Math.ceil(run/.5));
          for(let j=0;j<=steps;j++)
            if(blockedAt(p,a.x+(b.x-a.x)*j/steps,a.z+(b.z-a.z)*j/steps,binding.radius))
              throw new Error('Dry bank contour crosses obstacle '+binding.zone+' '+binding.road);
        }
      }
      road.points=route;road.blocked=false;
      let c=gradeRoad(p,field,road,.49,4);
      if(binding.sharedBankRoad)c=joinDryBankRoad(p,field,road,binding);
      if(binding.earthworkHalfWidth)c.halfWidth=Math.max(c.halfWidth,binding.earthworkHalfWidth);
      if(binding.turnGradeCap)for(let i=1;i<c.points.length;i++) {
        const a=c.points[i-1],b=c.points[i],midZ=(a.z+b.z)/2;
        if(midZ>=binding.turnGradeCap.minZ&&midZ<=binding.turnGradeCap.maxZ)
          c.limits[i]=Math.min(c.limits[i],binding.turnGradeCap.grade*Math.hypot(b.x-a.x,b.z-a.z));
      }
      owners.set(c.id,{p,c});
    }
    shareCorridors(profiles,owners);
  }
}
function resumeGradeAccess(profiles,field,plan) {
  const owners=new Map();
  for(const p of profiles)for(const c of p.corridors||[])
    if(c.id.startsWith(p.zoneId+'_'))owners.set(c.id,{p,c});
  finishGradeAccess(profiles,field,plan,owners);
}
module.exports={gradeAccess,resumeGradeAccess,applyRoadPhysicalBindings,routeHasCloseReturn,roadSurfaceSlope,gradeRoad,gradeBoundSiteRoad,shareCorridors,roundBoundTrunkTurn,applyBoundRoadShoulder,joinDryBankRoad};
