'use strict';
const {groundHeight,waterAt,smooth}=require('../../src/server/sector-surface');
const meshSurface=require('../../src/server/sector-mesh-patches');
const groundLattice=require('../../src/server/sector-ground-lattice');
const {bankRevetmentRecipe,buildBridgeBankRevetment}=require('../../src/server/sector-utilities');

// The retaining wall follows the outside of the union of actual road
// footprints. Shared gate routes do not create overlapping duplicate walls.
function applyRoadBankTreatments(profiles,field,engineering) {
  for(const p of profiles) {
    delete p.roadBankTreatments;delete p.roadBankWalls;
    delete p.bridgeBankRevetments;delete p.bridgeBankRevetmentMeshes;
    const revetments=(engineering.bridgeBankRevetments||[]).filter(row=>row.zone===p.zoneId);
    if(revetments.length){
      p.bridgeBankRevetments=revetments.map(row=>bankRevetmentRecipe(p,row));
      if(new Set(p.bridgeBankRevetments.map(row=>row.id)).size!==revetments.length)
        throw Error('Duplicate bridge bank revetment '+p.zoneId);
    }
    const rows=(engineering.roadBankTreatments||[]).filter(row=>row.zone===p.zoneId);
    if(!rows.length)continue;
    p.roadBankTreatments=rows.map(row=>{
      const {minX,maxX,minZ,maxZ,blend}=row;
      if(![minX,maxX,minZ,maxZ,blend].every(Number.isFinite)||minX>=maxX||minZ>=maxZ||blend<=0
          ||minX-blend< -p.width/2||maxX+blend>p.width/2||minZ-blend< -p.depth/2||maxZ+blend>p.depth/2)
        throw Error('Invalid road bank treatment '+p.zoneId);
      return {minX,maxX,minZ,maxZ,blend};
    });
    p.roadBankWalls=buildRoadBankWalls(p,field);
  }
}

function buildRoadBankWalls(p,field) {
  if(!p.roadBankTreatments?.length)return [];
  const step=.5,bucket=8,nx=Math.ceil(p.width/step),nz=Math.ceil(p.depth/step);
  const minX=-p.width/2,minZ=-p.depth/2,segments=[],seen=new Set(),index=new Map(),cells=new Set();
  for(const road of p.roads||[]) {
    if(road.blocked||!['road','track'].includes(road.type))continue;
    const points=road.points?.length?road.points:[road.a,road.b];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
      if(den<1e-12)continue;
      const key=[a.x,a.z,b.x,b.z,road.halfWidth].join(',');if(seen.has(key))continue;seen.add(key);
      // 2.5 cm outside the protected capsule core also keeps polygon chords
      // outside that core at convex corners sampled on the half-metre grid.
      const radius=road.halfWidth+.73,segment={a,b,dx,dz,den,radius};segments.push(segment);
      const margin=radius+step*2;
      const loX=Math.max(minX,Math.min(a.x,b.x)-margin),hiX=Math.min(-minX,Math.max(a.x,b.x)+margin);
      const loZ=Math.max(minZ,Math.min(a.z,b.z)-margin),hiZ=Math.min(-minZ,Math.max(a.z,b.z)+margin);
      for(let x=Math.floor(loX/bucket);x<=Math.floor(hiX/bucket);x++)for(let z=Math.floor(loZ/bucket);z<=Math.floor(hiZ/bucket);z++) {
        const key=x+','+z;if(!index.has(key))index.set(key,[]);index.get(key).push(segment);
      }
      for(let iz=Math.max(0,Math.floor((loZ-minZ)/step));iz<Math.min(nz,Math.ceil((hiZ-minZ)/step));iz++)
      for(let ix=Math.max(0,Math.floor((loX-minX)/step));ix<Math.min(nx,Math.ceil((hiX-minX)/step));ix++)cells.add(iz*nx+ix);
    }
  }
  const signed=(x,z)=>{
    let distance=Infinity;
    for(const s of index.get(Math.floor(x/bucket)+','+Math.floor(z/bucket))||[]) {
      const t=Math.max(0,Math.min(1,((x-s.a.x)*s.dx+(z-s.a.z)*s.dz)/s.den));
      distance=Math.min(distance,Math.hypot(x-s.a.x-s.dx*t,z-s.a.z-s.dz*t)-s.radius);
    }
    return distance;
  };
  const vertexCache=new Map(),edgeCache=new Map(),contour=[];
  const vertex=(ix,iz)=>{
    const id=iz*(nx+1)+ix;if(vertexCache.has(id))return vertexCache.get(id);
    const x=minX+ix*step,z=minZ+iz*step,v={id,x,z,value:signed(x,z)};vertexCache.set(id,v);return v;
  };
  const root=(a,b)=>{
    const key=[Math.min(a.id,b.id),Math.max(a.id,b.id)].join(':');if(edgeCache.has(key))return edgeCache.get(key);
    let lo=0,hi=1;
    for(let j=0;j<36;j++) {
      const t=(lo+hi)/2,v=signed(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
      if((v<=0)===(a.value<=0))lo=t;else hi=t;
    }
    const t=(lo+hi)/2,point={key,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};edgeCache.set(key,point);return point;
  };
  for(const cell of cells) {
    const ix=cell%nx,iz=Math.floor(cell/nx),a=vertex(ix,iz),b=vertex(ix+1,iz),c=vertex(ix,iz+1),d=vertex(ix+1,iz+1);
    for(const triangle of [[a,c,b],[b,c,d]]) {
      const crossings=[];
      for(let i=0;i<3;i++) {const u=triangle[i],v=triangle[(i+1)%3];if((u.value<=0)!==(v.value<=0))crossings.push(root(u,v));}
      if(crossings.length===2&&Math.hypot(crossings[0].x-crossings[1].x,crossings[0].z-crossings[1].z)>1e-9)contour.push(crossings);
    }
  }
  const adjacency=new Map();
  for(const [i,edge] of contour.entries())for(const point of edge) {
    if(!adjacency.has(point.key))adjacency.set(point.key,[]);adjacency.get(point.key).push(i);
  }
  for(const [key,edges] of adjacency)if(edges.length>2)throw Error('Non-manifold road bank union '+p.zoneId+' '+key);
  const points=new Map();
  const natural=(x,z)=>groundHeight(p,field,x,z,false,null,true,false,true);
  const prepared=point=>{
    if(points.has(point.key))return points.get(point.key);
    const e=.001,gx=signed(point.x+e,point.z)-signed(point.x-e,point.z),gz=signed(point.x,point.z+e)-signed(point.x,point.z-e),length=Math.hypot(gx,gz);
    if(!(length>1e-9))throw Error('Undefined road bank normal '+p.zoneId);
    const outerX=point.x+gx/length*.5,outerZ=point.z+gz/length*.5;
    const innerHeight=groundHeight(p,field,point.x,point.z),outerGround=groundHeight(p,field,outerX,outerZ);
    let regionWeight=0;
    for(const r of p.roadBankTreatments) {
      const distance=Math.max(r.minX-point.x,0,point.x-r.maxX,r.minZ-point.z,point.z-r.maxZ);
      regionWeight=Math.max(regionWeight,1-smooth(0,r.blend,distance));
    }
    const top=outerGround+Math.max(0,innerHeight-.15-outerGround)*regionWeight;
    const nativeSamples=[0,.25,.5,.75,1].map(t=>natural(point.x+(outerX-point.x)*t,point.z+(outerZ-point.z)*t));
    const bottom=Math.min(...nativeSamples)-.6;
    const q={x:point.x,z:point.z,outerX,outerZ,top,bottom,outerGround};points.set(point.key,q);return q;
  };
  const used=new Set(),walls=[];
  const traverse=(start,first)=>{
    const chain=[start];let current=start,edge=first;
    while(!used.has(edge)) {
      used.add(edge);const pair=contour[edge],next=pair[0].key===current.key?pair[1]:pair[0];chain.push(next);current=next;
      const remaining=adjacency.get(current.key).find(i=>!used.has(i));if(remaining===undefined)break;edge=remaining;
    }
    const vertices=chain.map(prepared);let run=[];
    const finish=()=>{if(run.length>1)walls.push({id:'bank_'+walls.length,points:run.map(({outerGround,...q})=>q)});run=[];};
    for(let i=1;i<vertices.length;i++) {
      const a=vertices[i-1],b=vertices[i];
      // Existing steep soil needs retention too. A cut-only test leaves gaps
      // wherever a previous span treatment already removed that side fill.
      const active=Math.max(a.top-a.outerGround,b.top-b.outerGround)>.05;
      if(active){if(!run.length)run.push(a);run.push(b);}else finish();
    }
    finish();
  };
  for(const [key,edges] of adjacency)if(edges.length===1&&!used.has(edges[0]))traverse(edgeCache.get(key),edges[0]);
  for(let i=0;i<contour.length;i++)if(!used.has(i))traverse(contour[i][0],i);
  return walls;
}

// Fit the outside face of a retaining wall to the *finished indexed ground*.
// The road-side edge and the authored bank/relief stay in their original
// positions. This is a derived wall mesh, never a replacement for the native
// wall data used to construct the canonical ground lattice.
function fitRoadBankContactWalls(p) {
  if(!p.roadBankWalls?.length)return [];
  if(!p.surfacePatches?.length||!groundLattice.active(p))
    throw Error('Road bank contact fit needs canonical indexed ground '+p.zoneId);
  const radii=Array.from({length:12},(_,i)=>.25+i*.05),originalRadius=.5;
  const nativeVertex=()=>{throw Error('Missing canonical road bank ground lattice '+p.zoneId);};
  const hit=(x,z)=>{
    const sample=meshSurface.sample(p,x,z,nativeVertex);
    return sample?.strict&&Number.isFinite(sample.height)?sample.height:null;
  };
  return p.roadBankWalls.map(wall=>{
    const points=wall.points;if(!Array.isArray(points)||points.length<2)
      throw Error('Empty road bank contact wall '+p.zoneId+' '+wall.id);
    const directions=points.map(q=>{
      const dx=q.outerX-q.x,dz=q.outerZ-q.z,length=Math.hypot(dx,dz);
      if(Math.abs(length-originalRadius)>1e-5)throw Error('Unexpected road bank thickness '+p.zoneId+' '+wall.id);
      return {x:dx/length,z:dz/length};
    });
    const at=(i,r)=>({x:Math.fround(points[i].x+directions[i].x*r),
      z:Math.fround(points[i].z+directions[i].z*r)});
    const originalSign=()=>{
      const a=points[0],b=points[1];
      const area=(b.x-a.x)*(b.outerZ-a.z)-(b.z-a.z)*(b.outerX-a.x);
      if(Math.abs(area)<1e-8)throw Error('Degenerate road bank wall '+p.zoneId+' '+wall.id);
      return Math.sign(area);
    };
    const winding=originalSign();
    const edge=(i,ra,rb)=>{
      const a=at(i,ra),b=at(i+1,rb),inner=points[i],next=points[i+1];
      const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
      // Every corner of the XZ quad must turn the same way; checking only
      // the first triangle can miss a folded outer edge on short spans.
      if([cross(inner,next,b),cross(next,b,a),cross(b,a,inner),cross(a,inner,next)]
          .some(area=>area*winding<=1e-7))return Infinity;
      let previous=null,cost=0;
      for(let k=0;k<=8;k++){
        const t=k/8,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,h=hit(x,z);
        if(h===null)return Infinity;
        const bottomA=Math.min(inner.bottom,points[Math.max(0,i-1)].bottom,next.bottom);
        const bottomB=Math.min(inner.bottom,next.bottom,points[Math.min(points.length-1,i+2)].bottom);
        const bottom=bottomA+(bottomB-bottomA)*t;
        const top=inner.top+(next.top-inner.top)*t;
        if(bottom>h-.05||top<h+.05)return Infinity;
        const roadX=inner.x+(next.x-inner.x)*t,roadZ=inner.z+(next.z-inner.z)*t;
        for(const portion of [0,.5]){
          const support=hit(roadX+(x-roadX)*portion,roadZ+(z-roadZ)*portion);
          if(support===null||bottom>support-.05)return Infinity;
        }
        if(previous!==null){const delta=Math.abs(h-previous);
          cost+=Math.max(0,delta-.08)**2*8000+(delta>.1?2:0);}
        previous=h;
      }
      return cost+Math.pow((ra-rb)/.05,2)*.015+Math.pow((ra-originalRadius)/.05,2)*.001;
    };
    const dp=Array.from({length:points.length},()=>Array(radii.length).fill(Infinity));
    const previous=Array.from({length:points.length},()=>Array(radii.length).fill(-1));
    const originalIndex=5;dp[0][originalIndex]=0;
    for(let i=0;i<points.length-1;i++)for(let a=0;a<radii.length;a++){
      if(!Number.isFinite(dp[i][a]))continue;
      for(let b=0;b<radii.length;b++){
        if(Math.abs(radii[a]-radii[b])>.100001||i+1===points.length-1&&b!==originalIndex)continue;
        const cost=edge(i,radii[a],radii[b]);if(!Number.isFinite(cost))continue;
        const total=dp[i][a]+cost;if(total<dp[i+1][b]){dp[i+1][b]=total;previous[i+1][b]=a;}
      }
    }
    if(!Number.isFinite(dp.at(-1)[originalIndex]))throw Error('No supported bank wall contact fit '+p.zoneId+' '+wall.id);
    const chosen=new Array(points.length);let state=originalIndex;
    for(let i=points.length-1;i>=0;i--){chosen[i]=radii[state];state=previous[i][state];}
    const fitted=points.map((q,i)=>({...q,outerX:at(i,chosen[i]).x,outerZ:at(i,chosen[i]).z}));
    for(let i=1;i<fitted.length;i++){
      const a=fitted[i-1],b=fitted[i];
      const innerA={x:a.x,z:a.z},innerB={x:b.x,z:b.z};
      const outerA={x:a.outerX,z:a.outerZ},outerB={x:b.outerX,z:b.outerZ};
      const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
      if([cross(innerA,innerB,outerB),cross(innerB,outerB,outerA),
        cross(outerB,outerA,innerA),cross(outerA,innerA,innerB)]
        .some(area=>area*winding<=1e-7))throw Error('Folded bank wall contact fit '+p.zoneId+' '+wall.id);
    }
    return {id:wall.id,points:fitted};
  });
}
// A continuous concrete batter follows the wall crest instead of each small
// Ground height change. Its common toe is buried along the complete wall;
// authored Ground and native water remain intact.
function buildRoadBankContactFootings(p) {
  if(!p.roadBankContactWalls?.length)return [];
  if(!groundLattice.active(p)||!p.surfacePatches?.length)
    throw Error('Road bank footing needs indexed ground '+p.zoneId);
  const fallback=()=>{throw Error('Missing canonical footing lattice '+p.zoneId);};
  const ground=(x,z)=>{
    const hit=meshSurface.sample(p,x,z,fallback);
    if(!hit?.strict||!Number.isFinite(hit.height))throw Error('Unsupported retaining footing '+p.zoneId+' '+x+','+z);
    return hit.height;
  };
  const result=[];
  for(const wall of p.roadBankContactWalls){
    const base=p.roadBankWalls.find(row=>row.id===wall.id);
    if(!base||base.points.length!==wall.points.length)
      throw Error('Missing native bank footing source '+p.zoneId+' '+wall.id);
    let commonToe=Infinity;
    const sections=wall.points.map((q,i)=>{
      const dx=q.outerX-q.x,dz=q.outerZ-q.z,length=Math.hypot(dx,dz);
      if(!(length>.24999&&length<.80001))
        throw Error('Invalid retaining contact thickness '+p.zoneId+' '+wall.id+' '+i);
      const outerX=Math.fround(q.outerX+.4*dx/length),outerZ=Math.fround(q.outerZ+.4*dz/length);
      const far=ground(outerX,outerZ),wet=waterAt(p,outerX,outerZ);
      commonToe=Math.min(commonToe,far-.4,wet.inside?wet.height-.4:Infinity);
      return {x:q.outerX,z:q.outerZ,outerX,outerZ,far,wet};
    });
    if(!Number.isFinite(commonToe))throw Error('Unsupported common retaining toe '+p.zoneId+' '+wall.id);
    const points=sections.map((section,i)=>{
      const q=wall.points[i],native=base.points[i];
      const top=q.top-.25,outerTop=top-.65,bottom=commonToe;
      const width=Math.hypot(section.outerX-section.x,section.outerZ-section.z);
      if(width<.399||width>.401||bottom>native.bottom||bottom>q.bottom
          ||!(top>bottom+.1&&outerTop>bottom+.1))
        throw Error('Unsupported retaining footing volume '+p.zoneId+' '+wall.id+' '+i);
      if(section.wet.inside&&section.far<section.wet.height+.02*p.gain/160
          &&Math.atan2(top-outerTop,width)*180/Math.PI<=50)
        throw Error('Walkable retaining footing at native water '+p.zoneId+' '+wall.id+' '+i);
      return {x:section.x,z:section.z,outerX:section.outerX,outerZ:section.outerZ,top,outerTop,bottom};
    });
    for(let k=1;k<points.length;k++){
        const a=points[k-1],b=points[k];
        const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
        const corners=[{x:a.x,z:a.z},{x:b.x,z:b.z},{x:b.outerX,z:b.outerZ},{x:a.outerX,z:a.outerZ}];
        const turns=corners.map((v,j)=>cross(v,corners[(j+1)%4],corners[(j+2)%4]));
        if(turns.some(value=>Math.abs(value)<=1e-7||Math.sign(value)!==Math.sign(turns[0])))
          throw Error('Folded retaining footing '+p.zoneId+' '+wall.id+' '+k);
      }
    result.push({id:wall.id+'_foot_0',points});
  }
  return result;
}
function buildBridgeBankRevetmentMeshes(p,field){
  if(!p.bridgeBankRevetments?.length)return [];
  if(!groundLattice.active(p)||!p.surfacePatches?.length)
    throw Error('Bridge bank revetment requires indexed ground '+p.zoneId);
  const fallback=()=>{throw Error('Missing canonical revetment lattice '+p.zoneId);};
  const regular=(ix,iz)=>groundLattice.regularVertex(p,ix,iz,fallback);
  const naturalProfile={...p,foundations:[],corridors:[],roads:[],bridges:[]};
  const ground=(x,z)=>{const hit=meshSurface.sample(p,x,z,regular);
    if(!hit?.strict||!Number.isFinite(hit.height))throw Error('Unsupported revetment toe '+p.zoneId);return hit.height;};
  return p.bridgeBankRevetments.map(c=>{
    return buildBridgeBankRevetment(p,c,meshSurface.groundTrianglesInBox(p,c.minX,c.minZ,c.maxX,c.maxZ,regular),{
      natural:(x,z)=>groundHeight(naturalProfile,field,x,z,false)-.05*p.gain/160,
      ground,water:(x,z)=>Math.fround(waterAt(p,x,z).height),nativeWater:(x,z)=>waterAt(p,x,z)}).mesh;
  });
}
module.exports={applyRoadBankTreatments,buildRoadBankWalls,fitRoadBankContactWalls,buildRoadBankContactFootings,buildBridgeBankRevetmentMeshes};
