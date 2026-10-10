'use strict';
const catalog=require('../../data/kromka/room-surfaces.json');
const profiles=new Map(catalog.profiles.map(p=>[p.locationId,p]));
const find=id=>profiles.get(String(id||''))||null;
function height(profile,x,z) {
  if(!profile)return 0;
  let h=0;
  for(const f of profile.features) {
    const q=Math.hypot((x-f.x)/f.halfX,(z-f.z)/f.halfZ);
    const t=Math.max(0,Math.min(1,(q-f.flat)/(1-f.flat)));
    h+=f.height*(1-t*t*(3-2*t));
  }
  for(const f of profile.foundations||[]) {
    const a=f.rotationY||0,dx=x-f.x,dz=z-f.z;
    const d=Math.hypot(Math.max(0,Math.abs(dx*Math.cos(a)-dz*Math.sin(a))-f.halfX),Math.max(0,Math.abs(dx*Math.sin(a)+dz*Math.cos(a))-f.halfZ));
    const t=Math.max(0,Math.min(1,d/f.blend));h=f.height+(h-f.height)*t*t*(3-2*t);
  }
  return h;
}
module.exports={find,height};
