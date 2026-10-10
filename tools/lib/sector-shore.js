'use strict';
const {waterAt,groundHeight}=require('../../src/server/sector-surface');
function visibleShore(profile,field) {
  if(!profile.waterIndices.length)return [];
  const n=256,side=n+1,values=new Float64Array(side*side),edges=[];
  const point=(x,z)=>({x:(x/n-.5)*profile.width,z:(z/n-.5)*profile.depth});
  for(let z=0;z<=n;z++)for(let x=0;x<=n;x++) {
    const p=point(x,z),w=waterAt(profile,p.x,p.z);
    values[x+z*side]=w.inside?groundHeight(profile,field,p.x,p.z,false,w)-w.height-.02*profile.gain/160:Math.max(.001,w.distance);
  }
  for(let z=0;z<n;z++)for(let x=0;x<n;x++) {
    const corners=[[x,z],[x+1,z],[x+1,z+1],[x,z+1]],crossings=[];
    for(let i=0;i<4;i++) {
      const a=corners[i],b=corners[(i+1)%4],av=values[a[0]+a[1]*side],bv=values[b[0]+b[1]*side];
      if((av<0)===(bv<0))continue;
      const t=av/(av-bv),v=point(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t),water=waterAt(profile,v.x,v.z);
      crossings.push({x:Number(v.x.toFixed(6)),z:Number(v.z.toFixed(6)),h:Number(water.height.toFixed(6))});
    }
    if(crossings.length===2)edges.push({a:crossings[0],b:crossings[1]});
    else if(crossings.length===4) {
      const center=point(x+.5,z+.5),water=waterAt(profile,center.x,center.z);
      const wet=water.inside&&groundHeight(profile,field,center.x,center.z,false,water)<water.height+.02*profile.gain/160;
      const firstWet=values[x+z*side]<0,offset=wet===firstWet?1:0;
      edges.push({a:crossings[offset],b:crossings[(offset+1)%4]},{a:crossings[(offset+2)%4],b:crossings[(offset+3)%4]});
    }
  }
  return edges;
}
module.exports={visibleShore};
