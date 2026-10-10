'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {waterAt,groundHeight,isWaterAt}=require('../../src/server/sector-surface');
const round=value=>Number(value.toFixed(5));

// Sample the authored utility route against the current engineered ground.
// Preview stages and final catalogues use the same elevations.
function processPipes(profile,relief,definition,root,profiles=[]) {
  const routes=[];
  for(const site of [...definition.sites||[],...definition.facilities||[]]) {
    const file=['site-layouts','facility-layouts'].map(folder=>path.join(root,'data/kromka',folder,site.id+'.json')).find(f=>fs.existsSync(f));
    if(!file)continue;
    const layout=JSON.parse(fs.readFileSync(file,'utf8'));
    const angle=layout.site?(layout.site.rotationY||0)*Math.PI/180:(site.rotationY||0);
    for(const pipe of layout.pipes||[]) {
      const transform=point=>{
        const x=site.x+point.x*Math.cos(angle)+point.z*Math.sin(angle);
        const z=site.z-point.x*Math.sin(angle)+point.z*Math.cos(angle);
        const water=point.waterLevel?waterAt(profile,x,z):null;
        if(water && !water.inside)throw new Error('Water intake outside water domain: '+site.id+' '+pipe.id);
        return {x:round(x),z:round(z),h:round((water?water.height:groundHeight(profile,relief,x,z))+point.y)};
      };
      const controls=pipe.points.map(transform),points=[];
      if(pipe.followGround)for(let i=1;i<controls.length;i++) {
        const a=controls[i-1],b=controls[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));
        for(let j=i===1?0:1;j<=count;j++) {
          const t=j/count,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
          const clearance=pipe.points[i-1].y+(pipe.points[i].y-pipe.points[i-1].y)*t;
          const base=isWaterAt(profile,x,z,0,relief)?waterAt(profile,x,z).height:groundHeight(profile,relief,x,z);
          points.push({x:round(x),z:round(z),h:round(base+clearance)});
        }
      }
      else points.push(...controls);
      const supports=[];let distance=0;
      if(pipe.followGround)for(let i=1;i<points.length;i++) {
        const point=points[i];distance+=Math.hypot(point.x-points[i-1].x,point.z-points[i-1].z);
        if(distance<4 || isWaterAt(profile,point.x,point.z,0,relief))continue;
        const floor=groundHeight(profile,relief,point.x,point.z),bottom=point.h-pipe.radius;
        if(bottom-floor>.08){supports.push({...point,h:round(bottom),g:round(floor)});distance=0;}
      }
      routes.push({id:site.id+'_'+pipe.id,style:'process',halfWidth:pipe.radius,points,supports,a:points[0],b:points.at(-1)});
    }
  }
  // Long penstocks are authored in immutable map coordinates and clipped into
  // every crossed sector. Both neighbouring cuts sample the same route and
  // elevations; the feed cannot disappear at the facility's room boundary.
  for(const source of profiles)for(const facility of source.facilities||[]) {
    const file=path.join(root,'data/kromka/facility-layouts',facility.id+'.json');
    if(!fs.existsSync(file))continue;
    const layout=JSON.parse(fs.readFileSync(file,'utf8'));
    for(const pipe of layout.externalPipes||[])for(let k=1;k<pipe.points.length;k++) {
      const a=pipe.points[k-1],b=pipe.points[k];
      const local=point=>({x:(point.mapX-profile.mapMinX-10)/20*profile.width,z:(profile.mapMinY+10-point.mapY)/20*profile.depth});
      const aa=local(a),bb=local(b),dx=bb.x-aa.x,dz=bb.z-aa.z;
      let lo=0,hi=1,valid=true;
      for(const [v,d,min,max] of [[aa.x,dx,-profile.width/2,profile.width/2],[aa.z,dz,-profile.depth/2,profile.depth/2]]) {
        if(Math.abs(d)<1e-9){if(v<min||v>max)valid=false;continue;}
        const ta=(min-v)/d,tb=(max-v)/d;lo=Math.max(lo,Math.min(ta,tb));hi=Math.min(hi,Math.max(ta,tb));
      }
      if(!valid||hi<=lo)continue;
      const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)*(hi-lo)/.5)),points=[];
      for(let j=0;j<=count;j++) {
        const t=lo+(hi-lo)*j/count,x=aa.x+dx*t,z=aa.z+dz*t;
        const base=isWaterAt(profile,x,z,0,relief)?waterAt(profile,x,z).height:groundHeight(profile,relief,x,z);
        const ceiling=pipe.hydraulic?((a.worldHeight+(b.worldHeight-a.worldHeight)*t)-profile.datum)*profile.gain:Infinity;
        points.push({x:round(x),z:round(z),h:round(Math.min(base+a.y+(b.y-a.y)*t,ceiling))});
      }
      routes.push({id:facility.id+'_'+pipe.id+'_'+k,style:'process',halfWidth:pipe.radius,points,supports:[],a:points[0],b:points.at(-1)});
    }
  }
  return routes;
}
module.exports={processPipes};
