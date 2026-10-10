'use strict';
const {isWaterAt,groundHeight,crossesWater,bridgeAt,bridgeHeight}=require('../../src/server/sector-surface');
const {attachObstacles,blockedAt}=require('./sector-obstacles');
const shoreMesh=require('../../src/server/sector-mesh-patches');

class Queue {
  constructor(){this.items=[];}
  push(item){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].score<=item.score)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){const first=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].score<this.items[c].score)c++;if(last.score<=this.items[c].score)break;this.items[i]=this.items[c];i=c;}this.items[i]=last;}return first;}
}
function routeOnLand(profile,field,start,end,radius=1.8,maxGrade=.8,surfaceCache=null) {
  // Refined surfaces contain usable passages narrower than the old four-metre
  // search lattice. Keep the same capsule and slope checks on a two-metre grid.
  const n=profile.bridges.length||profile.surfacePatches?.length?160:80,step=profile.width/n,half=profile.width/2;
  const index=p=>Math.max(0,Math.min(n,Math.round((p.x+half)/step)))+
    Math.max(0,Math.min(n,Math.round((p.z+half)/step)))*(n+1);
  const side=n+1,total=side*side;
  const cache=surfaceCache||{};
  // Engineering access keeps the authored centre-line rule. Interaction and
  // navigation routes opt in to the slope of the actual triangulated surface
  // touched by the player's capsule.
  const actorWalk=cache.actorWalk===true;
  // Match the actual 50-degree CharacterController limit with a small
  // numerical margin. A full one-degree margin rejected a physically passed
  // route in z_09_11 at a 49.74-degree supporting triangle.
  const actorSlopeLimit=Math.tan(50*Math.PI/180)-.005;
  const actorStepLimit=.252; // PlayerHeight 1.8 m times configured step factor .14.
  const heightCache=cache.heightCache ||= new Map();
  const heightAt=(x,z)=>{
    const key=x.toFixed(5)+','+z.toFixed(5);
    if(heightCache.size>262144)heightCache.clear();
    if(!heightCache.has(key))heightCache.set(key,groundHeight(profile,field,x,z,true));
    return heightCache.get(key);
  };
  // Grid indexing is distinct from tile indexing. Include both outer boundaries.
  const point=i=>({x:(i%side)*step-half,z:Math.floor(i/side)*step-half});
  if(cache.radius!==radius || cache.maxGrade!==maxGrade) {
    if(cache.radius!==radius)cache.wet=new Int8Array(total);
    cache.segments=new Map();cache.failedInterior=null;cache.successfulPaths=[];
    cache.radius=radius;cache.maxGrade=maxGrade;
  }
  const wet=cache.wet ||= new Int8Array(total),heights=cache.heights ||= new Float64Array(total),heightKnown=cache.heightKnown ||= new Uint8Array(total);
  const segmentCache=cache.segments ||= new Map();
  const terrainGrid=profile.terrainSegments||128;
  const terrainStepX=profile.width/terrainGrid,terrainStepZ=profile.depth/terrainGrid;
  const terrainVertexCache=actorWalk?(cache.terrainVertices ||= new Map()):null;
  const terrainCellCache=actorWalk?(cache.terrainCells ||= new Map()):null;
  const terrainVertex=(ix,iz)=>{
    const key=ix+iz*(terrainGrid+1);
    if(!terrainVertexCache.has(key)){
      const x=ix*terrainStepX-half,z=iz*terrainStepZ-half;
      const ground=groundHeight(profile,field,x,z,false);
      // The freight tunnel keeps a separate, solid natural roof above its
      // excavated floor. Surface actors touch that roof, while engineering
      // height queries still use the bore floor. Public bridge decks retain
      // their own explicit support check below.
      const roof=profile.railInfrastructure?.length&&!bridgeAt(profile,x,z)
        ?groundHeight(profile,field,x,z,true):ground;
      terrainVertexCache.set(key,roof>ground+1?roof:ground);
    }
    return terrainVertexCache.get(key);
  };
  const terrainRegularVertices=actorWalk?(cache.terrainRegularVertices ||= new Map()):null;
  const terrainRegularVertex=(ix,iz)=>{
    const key=ix+iz*(terrainGrid+1);
    if(terrainRegularVertices?.has(key))return terrainRegularVertices.get(key);
    const z=iz*terrainStepZ-half;let x=ix*terrainStepX-half;
    if(ix>0&&ix<terrainGrid){
      let nearest=terrainStepX/2;
      const edges=Math.abs(Math.abs(z)-profile.depth/2)<.0001?profile.waterEdges:profile.visibleShore;
      for(const edge of edges||[]){
        if(Math.abs(edge.b.z-edge.a.z)<.000001||z<Math.min(edge.a.z,edge.b.z)-.0001
          ||z>Math.max(edge.a.z,edge.b.z)+.0001)continue;
        const bank=edge.a.x+(edge.b.x-edge.a.x)*(z-edge.a.z)/(edge.b.z-edge.a.z);
        if(Math.abs(bank-x)<nearest){nearest=Math.abs(bank-x);x=bank;}
      }
    }
    const floor=groundHeight(profile,field,x,z,false),roof=profile.railInfrastructure?.length&&!bridgeAt(profile,x,z)
      ?groundHeight(profile,field,x,z,true):floor;
    const vertex={x,z,h:(roof>floor+1?roof:floor)-.05*profile.gain/160};
    terrainRegularVertices?.set(key,vertex);return vertex;
  };
  const triangleCell=(ix,iz)=>{
    const key=ix+iz*terrainGrid;
    if(terrainCellCache.has(key))return terrainCellCache.get(key);
    if(profile.surfacePatches?.length){
      const result=shoreMesh.triangles(profile,ix,iz,terrainRegularVertex).map(vertices=>{
        const [a,b,c]=vertices,area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
        const sx=((b.h-a.h)*(c.z-a.z)-(c.h-a.h)*(b.z-a.z))/area;
        const sz=((b.x-a.x)*(c.h-a.h)-(c.x-a.x)*(b.h-a.h))/area;
        return {vertices:vertices.map(v=>({x:v.x,z:v.z})),slope:Math.hypot(sx,sz)};
      });
      terrainCellCache.set(key,result);return result;
    }
    const x=ix*terrainStepX-half,z=iz*terrainStepZ-half;
    const a=terrainVertex(ix,iz),b=terrainVertex(ix+1,iz),c=terrainVertex(ix,iz+1),d=terrainVertex(ix+1,iz+1);
    const triangles=[
      {vertices:[{x,z},{x:x+terrainStepX,z},{x,z:z+terrainStepZ}],slope:Math.hypot((b-a)/terrainStepX,(c-a)/terrainStepZ)},
      {vertices:[{x:x+terrainStepX,z:z+terrainStepZ},{x,z:z+terrainStepZ},{x:x+terrainStepX,z}],slope:Math.hypot((d-c)/terrainStepX,(d-b)/terrainStepZ)}
    ];
    terrainCellCache.set(key,triangles);
    return triangles;
  };
  const pointSegmentDistance2=(p,a,b)=>{
    const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
    return (p.x-a.x-t*dx)**2+(p.z-a.z-t*dz)**2;
  };
  const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  const segmentIntersects=(a,b,c,d)=>{
    const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
    if(ab1*ab2>0||cd1*cd2>0)return false;
    return Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))
      &&Math.max(Math.min(a.z,b.z),Math.min(c.z,d.z))<=Math.min(Math.max(a.z,b.z),Math.max(c.z,d.z));
  };
  const withinTriangle=(p,[a,b,c])=>{
    const u=cross(a,b,p),v=cross(b,c,p),w=cross(c,a,p);
    return (u>=0&&v>=0&&w>=0)||(u<=0&&v<=0&&w<=0);
  };
  const capsuleTouchesTriangle=(a,b,vertices,r)=>{
    if(withinTriangle(a,vertices)||withinTriangle(b,vertices))return true;
    let nearest=Infinity;
    for(let i=0;i<3;i++){
      const c=vertices[i],d=vertices[(i+1)%3];
      if(segmentIntersects(a,b,c,d))return true;
      nearest=Math.min(nearest,pointSegmentDistance2(c,a,b),pointSegmentDistance2(d,a,b),
        pointSegmentDistance2(a,c,d),pointSegmentDistance2(b,c,d));
    }
    return nearest<=r*r+1e-9;
  };
  // Source height can make a bridge-side join look flush while the actual
  // indexed ground lies below its solid deck. Test that vertical contact in
  // both directions; a dry join already supported at deck height stays open.
  const bridgeSides=actorWalk?(cache.bridgeSides ||= (profile.bridges||[])
    .filter(bridge=>bridge.style!=='railViaduct')
    .flatMap(bridge=>{
      const points=bridge.points?.length?bridge.points:[bridge.a,bridge.b],sides=[];
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
        if(length<1e-6)continue;
        for(const sign of [-1,1]){
          const nx=-(b.z-a.z)/length*sign,nz=(b.x-a.x)/length*sign;
          sides.push({bridge,nx,nz,a:{x:a.x+nx*bridge.halfWidth,z:a.z+nz*bridge.halfWidth},
            b:{x:b.x+nx*bridge.halfWidth,z:b.z+nz*bridge.halfWidth}});
        }
      }
      return sides;
    })):[];
  const bridgeContactSafe=(from,to)=>{
    const mid={x:(from.x+to.x)/2,z:(from.z+to.z)/2};
    for(const side of bridgeSides){
      if([from,mid,to].every(q=>bridgeAt(profile,q.x,q.z)===side.bridge))continue;
      if(Math.max(from.x,to.x)+radius<Math.min(side.a.x,side.b.x)
        ||Math.min(from.x,to.x)-radius>Math.max(side.a.x,side.b.x)
        ||Math.max(from.z,to.z)+radius<Math.min(side.a.z,side.b.z)
        ||Math.min(from.z,to.z)-radius>Math.max(side.a.z,side.b.z))continue;
      const dx=side.b.x-side.a.x,dz=side.b.z-side.a.z,length2=dx*dx+dz*dz;
      for(const t of [0,.5,1]){
        const center={x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t};
        const u=Math.max(0,Math.min(1,((center.x-side.a.x)*dx+(center.z-side.a.z)*dz)/length2));
        const q={x:side.a.x+dx*u,z:side.a.z+dz*u};
        if(Math.hypot(center.x-q.x,center.z-q.z)>radius+1e-6)continue;
        // An overlapping ribbon is not an exposed side of the deck union.
        if(bridgeAt(profile,q.x+side.nx*.001,q.z+side.nz*.001))continue;
        const support=shoreMesh.sample(profile,q.x,q.z,terrainRegularVertex);
        if(!support||Math.abs(bridgeHeight(side.bridge,q.x,q.z)-support.height)>actorStepLimit)return false;
      }
    }
    return true;
  };
  const actorSurfaceSafe=(a,b)=>{
    if(!actorWalk)return true;
    const length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.max(1,Math.ceil(length/.5));
    for(let i=1;i<=count;i++){
      const from={x:a.x+(b.x-a.x)*(i-1)/count,z:a.z+(b.z-a.z)*(i-1)/count};
      const to={x:a.x+(b.x-a.x)*i/count,z:a.z+(b.z-a.z)*i/count};
      const mid={x:(from.x+to.x)/2,z:(from.z+to.z)/2};
      if(!bridgeContactSafe(from,to))return false;
      if(bridgeAt(profile,from.x,from.z,radius)&&bridgeAt(profile,to.x,to.z,radius)
        &&bridgeAt(profile,mid.x,mid.z,radius))continue;
      const minX=Math.max(0,Math.floor((Math.min(from.x,to.x)-radius+half)/terrainStepX));
      const maxX=Math.min(terrainGrid-1,Math.floor((Math.max(from.x,to.x)+radius+half)/terrainStepX));
      const minZ=Math.max(0,Math.floor((Math.min(from.z,to.z)-radius+half)/terrainStepZ));
      const maxZ=Math.min(terrainGrid-1,Math.floor((Math.max(from.z,to.z)+radius+half)/terrainStepZ));
      for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
        for(const triangle of triangleCell(ix,iz)){
          if(triangle.slope<=actorSlopeLimit)continue;
          if(capsuleTouchesTriangle(from,to,triangle.vertices,radius))return false;
        }
      }
    }
    return true;
  };
  const allowed=i=>{
    if(wet[i]===0){const p=point(i);wet[i]=isWaterAt(profile,p.x,p.z,radius,field)||blockedAt(profile,p.x,p.z,radius)?-1:1;}
    return wet[i]>0;
  };
  const height=i=>{if(!heightKnown[i]){const p=point(i);heights[i]=heightAt(p.x,p.z);heightKnown[i]=1;}return heights[i];};
  const interior=v=>Math.abs(v.x)<=half-20 && Math.abs(v.z)<=half-20;
  // An exhausted search proves which interior cells are reachable from this
  // start. Reuse that result when relocating many anchors on an isolated bank.
  // Boundary destinations need their own search because their entry allowance
  // changes the cells near the sector edge.
  const inside=v=>Math.abs(v.x)<=half-radius && Math.abs(v.z)<=half-radius;
  const nearEnd=v=>Math.hypot(v.x-end.x,v.z-end.z)<20 || Math.hypot(v.x-start.x,v.z-start.z)<20;
  const testSegment=(a,b)=>{
    const length=Math.hypot(b.x-a.x,b.z-a.z);
    if(length<1e-6)return true;
    const steps=Math.max(1,Math.ceil(length/.5)),distance=length/steps,sx=-(b.z-a.z)/length,sz=(b.x-a.x)/length;
    if(crossesWater(profile,a.x,a.z,b.x,b.z,radius,field))return false;
    for(let i=0;i<=steps;i++)if(blockedAt(profile,a.x+(b.x-a.x)*i/steps,a.z+(b.z-a.z)*i/steps,radius))return false;
    for(const offset of [-1.25,0,1.25]) {
      let level=heightAt(a.x+sx*offset,a.z+sz*offset);
      for(let i=1;i<=steps;i++) {
        const x=a.x+(b.x-a.x)*i/steps+sx*offset,z=a.z+(b.z-a.z)*i/steps+sz*offset;
        const next=heightAt(x,z);
        if(Math.abs(next-level)>distance*maxGrade+.01)return false;
        level=next;
      }
    }
    return actorSurfaceSafe(a,b);
  };
  const safeSegment=(a,b)=>{
    const key=[a.x.toFixed(5)+','+a.z.toFixed(5),b.x.toFixed(5)+','+b.z.toFixed(5)].sort().join('|');
    // A 160-cell sector has roughly 100k distinct neighbour edges. Clearing
    // earlier repeats the expensive terrain/capsule check for every object.
    if(segmentCache.size>(actorWalk?262144:65536))segmentCache.clear();
    if(!segmentCache.has(key))segmentCache.set(key,testSegment(a,b));
    return segmentCache.get(key);
  };
  const startKey=start.x.toFixed(5)+','+start.z.toFixed(5);
  const remember=path=>{
    if(path){
      const paths=cache.successfulPaths ||= [];
      paths.push({startKey,path});
      if(paths.length>64)paths.shift();
    }
    return path;
  };
  // Functional objects often come in clusters. A previously verified route
  // from the same hub can be extended to a nearby endpoint, provided that
  // the new segment passes the identical water, collision and grade checks.
  if(!cache.disablePathReuse && cache.successfulPaths?.length
    && !isWaterAt(profile,end.x,end.z,radius,field)
    && !blockedAt(profile,end.x,end.z,radius)) {
    const candidates=[];
    for(const entry of cache.successfulPaths)if(entry.startKey===startKey)
      for(let i=0;i<entry.path.length;i++){
        const point=entry.path[i],distance=Math.hypot(point.x-end.x,point.z-end.z);
        if(distance<=24)candidates.push({entry,index:i,distance});
      }
    candidates.sort((a,b)=>a.distance-b.distance);
    for(const candidate of candidates.slice(0,8)){
      const prefix=candidate.entry.path.slice(0,candidate.index+1);
      if(safeSegment(prefix.at(-1),end))
        return remember([...prefix,{x:Number(end.x.toFixed(6)),z:Number(end.z.toFixed(6))}]);
    }
  }
  // A graded gate road is an authored, continuously checked path. A coarse
  // lattice can miss a narrow bend in that road even while the road itself is
  // walkable. Use its real centerline only after validating every segment at
  // the same water, blocker and slope limits as the grid search.
  const gradedGatePath=()=>{
    const hub=profile.hub;
    if(!hub)return null;
    if(isWaterAt(profile,start.x,start.z,radius,field)||isWaterAt(profile,end.x,end.z,radius,field)
      ||blockedAt(profile,start.x,start.z,radius)||blockedAt(profile,end.x,end.z,radius))return null;
    const same=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)<.01;
    for(const road of profile.roads||[]){
      if(road.blocked||road.type!=='track'||!road.points?.length)continue;
      const path=road.points;
      if(!same(path[0],hub)||!path.every((v,i)=>!i||safeSegment(path[i-1],v)))continue;
      // A narrow authored footbridge may be thinner than the search lattice.
      // Follow its verified centreline, then search only the nearby landing
      // for an interaction point on the dry bank.
      if(actorWalk&&road.walkwayAccess===true&&same(start,hub)&&!same(path.at(-1),hub)
        &&Math.hypot(end.x-path.at(-1).x,end.z-path.at(-1).z)<=24) {
        const landing=routeOnLand(profile,field,path.at(-1),end,radius,maxGrade,{actorWalk,disablePathReuse:true});
        const joined=landing&&[...path,...landing.slice(1)];
        if(joined?.every((v,i)=>!i||safeSegment(joined[i-1],v)))
          return joined.map(v=>({x:Number(v.x.toFixed(6)),z:Number(v.z.toFixed(6))}));
      }
      const forward=same(end,path.at(-1)),reverse=same(start,path.at(-1));
      if(!forward&&!reverse)continue;
      const other=forward?start:end;
      const approach=same(other,hub)?[other]:routeOnLand(profile,field,other,hub,radius,maxGrade,{actorWalk});
      if(!approach)continue;
      const combined=forward?[...approach,...path.slice(1)]:[...path.toReversed(),...approach.toReversed().slice(1)];
      if(combined.every((v,i)=>!i||safeSegment(combined[i-1],v)))return combined.map(v=>({x:Number(v.x.toFixed(6)),z:Number(v.z.toFixed(6))}));
    }
    return null;
  };
  // An exact entrance may be clear even if its nearest grid cell contains a
  // small prop. Connect it to a neighbouring clear cell without moving the
  // authored endpoint or ignoring collision, water and slope along the join.
  const endpointCandidates=exact=>{
    if(isWaterAt(profile,exact.x,exact.z,radius,field)||blockedAt(profile,exact.x,exact.z,radius))return [];
    const closest=index(exact),first=point(closest);
    const connectorCost=id=>{
      const p=point(id);
      return Math.hypot(p.x-exact.x,p.z-exact.z)+2*Math.abs(height(id)-heightAt(exact.x,exact.z));
    };
    if(allowed(closest)&&safeSegment(exact,first))return [{id:closest,cost:connectorCost(closest)}];
    const cx=closest%side,cz=Math.floor(closest/side),result=[];
    for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
      const x=cx+dx,z=cz+dz;if(x<0||x>n||z<0||z>n)continue;
      const id=x+z*side;if(!allowed(id)||!safeSegment(exact,point(id)))continue;
      result.push({id,cost:connectorCost(id)});
    }
    return result.sort((a,b)=>a.cost-b.cost||a.id-b.id);
  };
  const sources=endpointCandidates(start),targets=endpointCandidates(end);
  if(!sources.length||!targets.length)return gradedGatePath();
  const targetCost=new Map(targets.map(v=>[v.id,v.cost]));
  if(interior(start)&&interior(end)&&cache.failedInterior?.startKey===startKey
    && targets.every(v=>!cache.failedInterior.reachable[v.id]))return gradedGatePath();
  const cost=new Float64Array(total);cost.fill(Infinity);
  const previous=new Int32Array(total);previous.fill(-1);
  const closed=new Uint8Array(total),queue=new Queue();
  for(const source of sources)if(source.cost<cost[source.id]){
    cost[source.id]=source.cost;
    const p=point(source.id);
    queue.push({id:source.id,score:source.cost+Math.hypot(p.x-end.x,p.z-end.z)});
  }
  let chosen=-1,best=Infinity;
  while(queue.items.length) {
    if(queue.items[0].score>=best)break;
    const current=queue.pop().id;if(closed[current])continue;closed[current]=1;
    if(targetCost.has(current)&&cost[current]+targetCost.get(current)<best){
      chosen=current;best=cost[current]+targetCost.get(current);
    }
    const x=current%side,z=Math.floor(current/side);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const nx=x+dx,nz=z+dz;if(nx<0||nx>n||nz<0||nz>n)continue;
      const next=nx+nz*side;if(closed[next]||!allowed(next))continue;
      const nextPoint=point(next);
      if(!inside(nextPoint)&&!nearEnd(nextPoint))continue;
      if(dx&&dz&&(!allowed(x+dx+z*side)||!allowed(x+(z+dz)*side)))continue;
      const distance=step*Math.hypot(dx,dz),rise=Math.abs(height(next)-height(current));
      // Prefer existing gentle terrain; a separate construction plan is needed
      // where no walkable grade exists. Do not disguise cliffs as a road.
      if(rise>distance*maxGrade)continue;
      if(!safeSegment(point(current),nextPoint))continue;
      const candidate=cost[current]+distance+rise*2;
      if(candidate>=cost[next])continue;
      cost[next]=candidate;previous[next]=current;
      const p=point(next);queue.push({id:next,score:candidate+Math.hypot(p.x-end.x,p.z-end.z)});
    }
  }
  if(chosen<0) {
    if(interior(start)&&interior(end))cache.failedInterior={startKey,reachable:closed};
    return gradedGatePath();
  }
  const points=[start],grid=[];for(let i=chosen;i>=0;i=previous[i])grid.push(point(i));
  grid.reverse();
  for(const v of grid)if(Math.hypot(v.x-points.at(-1).x,v.z-points.at(-1).z)>1e-6)points.push(v);
  if(Math.hypot(end.x-points.at(-1).x,end.z-points.at(-1).z)>1e-6)points.push(end);
  if(points.length<2)points.push(end);
  const simplified=[points[0]];
  for(let i=1;i<points.length-1;i++) {
    const a=points[i-1],b=points[i],c=points[i+1];
    if(Math.abs((b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x))>1e-5)simplified.push(b);
  }
  simplified.push(points[points.length-1]);
  if(simplified.some((p,i)=>i&&crossesWater(profile,simplified[i-1].x,simplified[i-1].z,p.x,p.z,radius,field)))return null;
  const shortcut=source=>{
    const result=[source[0]];
    for(let i=0;i<source.length-1;) {
      let end=source.length-1;
      while(end>i+1&&!safeSegment(source[i],source[end]))end--;
      if(!safeSegment(source[i],source[end]))return null;
      result.push(source[end]);i=end;
    }
    return result;
  };
  // Collinear grid steps can each meet the slope limit while a longer chord
  // samples a narrow grade break between them. Keep those checked steps when
  // the simplified chord fails instead of discarding a reachable route.
  const direct=shortcut(simplified)||shortcut(points);
  if(!direct)return null;
  const curved=[direct[0]];
  for(let i=1;i<direct.length-1;i++) {
    const a=direct[i-1],b=direct[i],c=direct[i+1],before=Math.hypot(b.x-a.x,b.z-a.z),after=Math.hypot(c.x-b.x,c.z-b.z);
    const radius=Math.min(8,before*.35,after*.35);
    const start={x:b.x+(a.x-b.x)*radius/before,z:b.z+(a.z-b.z)*radius/before},end={x:b.x+(c.x-b.x)*radius/after,z:b.z+(c.z-b.z)*radius/after};
    const bend=Array.from({length:9},(_,j)=>{const t=j/8,u=1-t;return {x:u*u*start.x+2*u*t*b.x+t*t*end.x,z:u*u*start.z+2*u*t*b.z+t*t*end.z};});
    if(bend.every((v,j)=>!j||safeSegment(bend[j-1],v)))curved.push(...bend);
    else curved.push(b);
  }
  curved.push(direct.at(-1));
  if(curved.some((v,i)=>i&&crossesWater(profile,curved[i-1].x,curved[i-1].z,v.x,v.z,radius,field)))return remember(direct);
  if(curved.some((v,i)=>i&&!safeSegment(curved[i-1],v)))return remember(direct);
  return remember(curved.map(v=>({x:Number(v.x.toFixed(6)),z:Number(v.z.toFixed(6))})));
}
function nearestDry(profile,field,point,radius=3.1) {
  const snap=p=>({x:Math.round((p.x+profile.width/2)/(profile.width/80))*(profile.width/80)-profile.width/2,z:Math.round((p.z+profile.depth/2)/(profile.depth/80))*(profile.depth/80)-profile.depth/2});
  const grid=snap(point);
  if(!isWaterAt(profile,point.x,point.z,radius,field)&&!isWaterAt(profile,grid.x,grid.z,radius,field)&&!blockedAt(profile,point.x,point.z,radius)&&!blockedAt(profile,grid.x,grid.z,radius))return point;
  const step=profile.width/80;
  for(let distance=step;distance<profile.width;distance+=step) {
    const count=Math.max(16,Math.ceil(distance*2*Math.PI/step));
    for(let i=0;i<count;i++) {
      const x=point.x+distance*Math.cos(i*2*Math.PI/count),z=point.z+distance*Math.sin(i*2*Math.PI/count);
      if(Math.abs(x)>profile.width/2-20||Math.abs(z)>profile.depth/2-20)continue;
      const p=snap({x,z});
      if(!isWaterAt(profile,p.x,p.z,radius,field)&&!blockedAt(profile,p.x,p.z,radius))return p;
    }
  }
  return null;
}
function planAccess(profiles,graph,field,definitionOf,routing=true) {
  const byId=new Map(profiles.map(p=>[p.zoneId,p])),bindings=[];
  const routeCaches=new Map(),remaining=new Map(graph.zones.map(z=>[z.id,Object.values(z.edges).filter(e=>e.open).length]));
  for(const p of profiles) {
    const definition=definitionOf(p);
    attachObstacles(p,definition,field);
    const spawn=definition.surfaceSource?.spawn || definition.spawn;
    const original={x:Number(spawn?.x??((spawn.tx-p.width/4+.5)*2)),z:Number(spawn?.z??((spawn.tz-p.depth/4+.5)*2))};
    // A bridge added later must not turn the original flooded spawn into a
    // new hub in the middle of its deck. Keep the selected dry-bank arrival.
    p.hub ||= nearestDry(p,field,original)||original;p.gates=[];
    if(definition.surfaceArrivalOverride) {
      const target=definition.surfaceArrivalOverride;
      const point=nearestDry(p,field,{x:target.x,z:target.z});
      if(!point || Math.hypot(point.x-target.x,point.z-target.z)>.01)throw new Error('Invalid authored surface arrival '+p.zoneId);
      p.hub=point;
    }
    if(Math.hypot(p.hub.x-original.x,p.hub.z-original.z)>.1)p.spawnOverride=p.hub;
    p.roads=p.roads.filter(r=>r.type!=='track');
  }
  for(const zone of graph.zones)for(const [side,edge] of Object.entries(zone.edges)) {
    if(!edge.open||zone.id>edge.to)continue;
    const p=byId.get(zone.id),q=byId.get(edge.to),opposite={north:'south',south:'north',east:'west',west:'east'}[side];
    const preferredAlong=edge.sourceAlong??edge.along;
    const boundary=(p,side,along)=>side==='north'?{x:(along-.5)*p.width,z:p.depth/2}:side==='south'?{x:(along-.5)*p.width,z:-p.depth/2}:side==='west'?{x:-p.width/2,z:(along-.5)*p.depth}:{x:p.width/2,z:(along-.5)*p.depth};
    const bridgeEnds=(p,side)=>p.bridges.flatMap(b=>b.boundaryEnds||[b.a,b.b]).filter(v=>Math.abs((side==='north'?v.z-p.depth/2:side==='south'?v.z+p.depth/2:side==='west'?v.x+p.width/2:v.x-p.width/2))<1e-4);
    const position=(p,side,along,inset=0)=>{
      const point=boundary(p,side,along);
      if(inset)for(const bridge of p.bridges.filter(b=>b.points?.length)) {
        const start=bridgeEnds(p,side).find(e=>Math.hypot(e.x-point.x,e.z-point.z)<1e-4);
        if(!start || !(bridge.boundaryEnds||[bridge.a,bridge.b]).includes(start))continue;
        const borderIndex=bridge.points.reduce((best,p,i)=>Math.hypot(p.x-start.x,p.z-start.z)<Math.hypot(bridge.points[best].x-start.x,bridge.points[best].z-start.z)?i:best,0);
        const before=bridge.points[Math.max(0,borderIndex-1)],after=bridge.points[Math.min(bridge.points.length-1,borderIndex+1)];
        const towardBefore=Math.abs(before.x)<=p.width/2+1e-4 && Math.abs(before.z)<=p.depth/2+1e-4;
        const points=[start,...(towardBefore?bridge.points.slice(0,borderIndex).reverse():bridge.points.slice(borderIndex+1))];let left=inset;
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i],length=Math.hypot(b.x-a.x,b.z-a.z);
          if(left<=length)return {x:a.x+(b.x-a.x)*left/length,z:a.z+(b.z-a.z)*left/length};
          left-=length;
        }
      }
      return {x:point.x+(side==='west'?inset:side==='east'?-inset:0),z:point.z+(side==='south'?inset:side==='north'?-inset:0)};
    };
    const bridgeCandidates=bridgeEnds(p,side).map(v=>(side==='north'||side==='south'?v.x/p.width:v.z/p.depth)+.5);
    const approachScore=along=>{
      let penalty=0;
      for(const [sector,direction] of [[p,side],[q,opposite]]) {
        const end=position(sector,direction,along),run=Math.max(1,Math.hypot(end.x-sector.hub.x,end.z-sector.hub.z));
        const rise=Math.abs(groundHeight(sector,field,end.x,end.z,true)-groundHeight(sector,field,sector.hub.x,sector.hub.z,true));
        penalty+=Math.max(0,rise/run-.45)*4;
      }
      return Math.abs(along-preferredAlong)*.2+penalty;
    };
    const candidates=[...bridgeCandidates,preferredAlong,...Array.from({length:65},(_,i)=>(i+8)/80)].sort((a,b)=>approachScore(a)-approachScore(b)||Math.abs(a-preferredAlong)-Math.abs(b-preferredAlong));
    const clearApproach=(sector,direction,along)=>{
      const points=[position(sector,direction,along,19),position(sector,direction,along,9),position(sector,direction,along)];
      for(let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)));
        for(let j=0;j<=n;j++)if(blockedAt(sector,a.x+(b.x-a.x)*j/n,a.z+(b.z-a.z)*j/n,3.1))return false;
      }
      return true;
    };
    const along=candidates.find(a=>clearApproach(p,side,a)&&clearApproach(q,opposite,a)&&[0,9,19].every(inset=>{
      const a1=position(p,side,a,inset),a2=position(q,opposite,a,inset);
      const snap=(p,point)=>({x:Math.round((point.x+p.width/2)/(p.width/80))*(p.width/80)-p.width/2,z:Math.round((point.z+p.depth/2)/(p.depth/80))*(p.depth/80)-p.depth/2});
      const g1=snap(p,a1),g2=snap(q,a2);
      return !isWaterAt(p,a1.x,a1.z,3.1,field)&&!isWaterAt(q,a2.x,a2.z,3.1,field)&&!isWaterAt(p,g1.x,g1.z,1.8,field)&&!isWaterAt(q,g2.x,g2.z,1.8,field)
        && !blockedAt(p,a1.x,a1.z,3.1)&&!blockedAt(q,a2.x,a2.z,3.1)&&!blockedAt(p,g1.x,g1.z,1.8)&&!blockedAt(q,g2.x,g2.z,1.8);
    }));
    const chosen=along??edge.along;
    bindings.push({a:p.zoneId,b:q.zoneId,side,along:chosen,requiresCrossing:along===undefined});
    for(const [sector,direction] of [[p,side],[q,opposite]]) {
      const entry=position(sector,direction,chosen,19),gate=position(sector,direction,chosen,9),boundary=position(sector,direction,chosen);
      sector.gates.push({side:direction,along:chosen,entry,gate,boundary,requiresCrossing:along===undefined});
      if(sector.legacyDam || !routing)continue;
      if(!routeCaches.has(sector))routeCaches.set(sector,{});
      const points=routeOnLand(sector,field,sector.hub,boundary,1.8,.8,routeCaches.get(sector));
      sector.roads.push({id:'gate_'+direction,type:'track',halfWidth:2.5,a:sector.hub,b:boundary,points:points||[],blocked:!points});
      remaining.set(sector.zoneId,remaining.get(sector.zoneId)-1);
      if(remaining.get(sector.zoneId)===0)routeCaches.delete(sector);
    }
  }
  return bindings;
}
module.exports={routeOnLand,nearestDry,planAccess};
