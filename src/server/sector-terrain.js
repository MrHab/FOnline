'use strict';
const catalog=require('../../data/kromka/sector-surfaces.json');
const geometry=require('./sector-surface');
const legacy=require('./dam-road-river');
const {utilityBlockers}=require('./sector-utilities');
const shoreMesh=require('./sector-mesh-patches');
const groundLattice=require('./sector-ground-lattice');
if(catalog.groundLatticeZones?.length||catalog.profiles.some(p=>p.hasGroundLattice||
  p.groundLattice&&Object.keys(p.groundLattice).length))
  groundLattice.assertCatalog(catalog,{expectedZones:catalog.groundLatticeZones});
const profiles=new Map(catalog.profiles.map(p=>[p.locationId,p]));
const tileMasks=new Map();
const meshVertices=new WeakMap();
const find=id=>profiles.get(String(id||'')) || null;

// The walking ground is a triangle mesh, not the smooth height function. Match
// BuildGround's b-c diagonal and shoreline-pinned X vertices for server foot
// movement. Vertices are cached only as they are visited by players.
function snapGridX(profile,original,z,segments) {
  if(Math.abs(original)>=profile.width/2-0.0001)return original;
  const boundary=Math.abs(Math.abs(z)-profile.depth/2)<0.0001;
  const edges=boundary?profile.waterEdges:profile.visibleShore;
  let value=original,closest=profile.width/segments/2;
  for(const edge of edges||[]) {
    if(Math.abs(edge.b.z-edge.a.z)<0.000001
      || z<Math.min(edge.a.z,edge.b.z)-0.0001
      || z>Math.max(edge.a.z,edge.b.z)+0.0001)continue;
    const bank=edge.a.x+(edge.b.x-edge.a.x)*(z-edge.a.z)/(edge.b.z-edge.a.z);
    const distance=Math.abs(bank-original);
    if(distance<closest){closest=distance;value=bank;}
  }
  return value;
}
function meshVertex(profile,ix,iz) {
  let cache=meshVertices.get(profile);
  if(!cache){cache=new Map();meshVertices.set(profile,cache);}
  const segments=profile.terrainSegments===256?256:128,key=ix+iz*(segments+1);
  if(cache.has(key))return cache.get(key);
  const z=(iz/segments-0.5)*profile.depth;
  let x=(ix/segments-0.5)*profile.width;
  if(ix>0&&ix<segments)x=snapGridX(profile,x,z,segments);
  const floor=geometry.groundHeight(profile,catalog.relief,x,z,false);
  const roof=profile.railInfrastructure?.length&&!geometry.bridgeAt(profile,x,z)
    ?geometry.groundHeight(profile,catalog.relief,x,z,true):floor;
  const vertex={x,z,h:(roof>floor+1?roof:floor)
    -(profile.surfacePatches?.length ? .05*profile.gain/160 : 0)};
  cache.set(key,vertex);
  return vertex;
}
function triangleSupport(point,a,b,c) {
  const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  if(Math.abs(area)<1e-8)return null;
  const u=((b.x-point.x)*(c.z-point.z)-(b.z-point.z)*(c.x-point.x))/area;
  const v=((c.x-point.x)*(a.z-point.z)-(c.z-point.z)*(a.x-point.x))/area;
  const w=1-u-v;
  if(u< -1e-6||v< -1e-6||w< -1e-6)return null;
  const gradientX=((b.h-a.h)*(c.z-a.z)-(c.h-a.h)*(b.z-a.z))/area;
  const gradientZ=((b.x-a.x)*(c.h-a.h)-(c.x-a.x)*(b.h-a.h))/area;
  return {height:a.h*u+b.h*v+c.h*w,slope:Math.hypot(gradientX,gradientZ)};
}
function meshSupport(profile,x,z) {
  const segments=profile.terrainSegments===256?256:128;
  const stepX=profile.width/segments,stepZ=profile.depth/segments;
  const nominalX=Math.floor((x+profile.width/2)/stepX);
  const iz=Math.floor((z+profile.depth/2)/stepZ);
  if(iz<0||iz>=segments)return null;
  let support=null;
  for(let offset=-1;offset<=1;offset++) {
    const ix=nominalX+offset;
    if(ix<0||ix>=segments)continue;
    const point={x,z};
    for(const triangle of shoreMesh.triangles(profile,ix,iz,(cx,cz)=>meshVertex(profile,cx,cz))) {
      const found=triangleSupport(point,...triangle);
      if(found && (!support || found.slope>support.slope))support=found;
    }
  }
  return support;
}
function steepUphill(id,ax,az,bx,bz,radius=0.48,trace=null) {
  const profile=find(id);
  if(!profile||profile.legacyDam)return false;
  const distance=Math.hypot(bx-ax,bz-az);
  if(distance<1e-6)return false;
  // Look far enough ahead that a client cannot climb one continuous steep
  // face by sending arbitrarily small movement packets.
  const probeDistance=Math.max(distance,0.45);
  const steps=Math.max(1,Math.ceil(probeDistance/0.2)),run=probeDistance/steps;
  const ux=(bx-ax)/distance,uz=(bz-az)/distance;
  const slopeLimit=Math.tan(50*Math.PI/180);
  // CharacterController can step over a short raised facet even when that
  // facet's own normal exceeds slopeLimit. Its 1.8 m body has a 0.252 m step.
  const stepHeight=1.8*0.14;
  let previous=null,steepClimb=0;
  for(let i=0;i<=steps;i++) {
    const x=ax+ux*run*i,z=az+uz*run*i;
    // Bridges and railway service decks have their own support mesh. This
    // ground check resumes once the actor is back on ordinary terrain.
    // The deck supports the actor's feet at the centre even when the capsule
    // brushes a rail. Water and side collisions still use the full radius.
    const supported=geometry.bridgeAt(profile,x,z);
    const support=supported?null:meshSupport(profile,x,z);
    if(support!==null&&previous!==null) {
      const rise=support.height-previous.height;
      // CharacterController rejects uphill contact with a steep supporting
      // triangle even when motion runs obliquely across its contour.
      const steep=rise>run*slopeLimit+0.001;
      steepClimb=steep?Math.max(0,steepClimb+rise):0;
      if(steepClimb>stepHeight+0.001){
        if(trace)trace({reason:'steepClimb',x,z,previous,support,rise,run,steepClimb});
        return true;
      }
    }else steepClimb=0;
    previous=support;
  }
  return false;
}
function isWaterAt(id,x,z,radius=0) {
  const p=find(id);if(!p)return false;
  return p.legacyDam?legacy.isWaterAt(x,z,radius):geometry.isWaterAt(p,x,z,radius,catalog.relief);
}
function crossesWater(id,ax,az,bx,bz,radius=0) {
  const p=find(id);if(!p)return false;
  return p.legacyDam?legacy.crossesWater(ax,az,bx,bz,radius):geometry.crossesWater(p,ax,az,bx,bz,radius,catalog.relief);
}
function paintWaterTiles(map,id,tileSize=2,waterType=3) {
  const p=find(id);if(!p)return new Set();
  const depth=map.length,width=map[0]?.length||0,key=id+':'+width+':'+depth+':'+tileSize;
  let mask=tileMasks.get(key);
  if(!mask) {
    mask=new Set();
    for(let tz=0;tz<depth;tz++)for(let tx=0;tx<width;tx++)
      if(isWaterAt(id,(tx-width/2+.5)*tileSize,(tz-depth/2+.5)*tileSize))mask.add(tz*width+tx);
    tileMasks.set(key,mask);
  }
  for(const index of mask)map[Math.floor(index/width)][index%width]=waterType;
  return mask;
}
const staticBlockers=id=>utilityBlockers(find(id),catalog.relief);
module.exports={find,isWaterAt,crossesWater,paintWaterTiles,staticBlockers,steepUphill,version:catalog.sourceHash};
