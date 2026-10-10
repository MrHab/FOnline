'use strict';
function crossWaterHeight(p,x,z,nx,nz,halfWidth){
 let height=-Infinity;
 for(let i=0;i<p.waterIndices.length;i+=3){
  const [a,b,c]=p.waterIndices.slice(i,i+3).map(id=>p.waterVertices[id]);
  const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);if(Math.abs(area)<1e-10)continue;
  let lo=-halfWidth,hi=halfWidth;
  for(const [v,w] of [[a,b],[b,c],[c,a]]){
   const direction=Math.sign(area),base=direction*((w.x-v.x)*(z-v.z)-(w.z-v.z)*(x-v.x));
   const gradient=direction*((w.x-v.x)*nz-(w.z-v.z)*nx);
   if(Math.abs(gradient)<1e-12){if(base<0){lo=1;hi=0;break;}continue;}
   const t=-base/gradient;if(gradient>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
  }
  if(lo>hi)continue;
  for(const side of [lo,hi]){
   const px=x+nx*side,pz=z+nz*side;
   const u=((b.x-px)*(c.z-pz)-(b.z-pz)*(c.x-px))/area;
   const v=((c.x-px)*(a.z-pz)-(c.z-pz)*(a.x-px))/area;
   height=Math.max(height,a.h*u+b.h*v+c.h*(1-u-v));
  }
 }
 return height;
}
// Preserve the authored bridge centreline and raise its deck with a bounded
// slope. Junction earthworks must subsequently use the resulting endpoints.
function clearBridge(p,b,{clearance=.9,maxGrade=.18}={}){
 if(!Number.isFinite(clearance)||clearance<=0||!Number.isFinite(maxGrade)||maxGrade<=0)throw Error("Invalid bridge clearance/grade");
 const source=b.points?.length?b.points:[{...b.a,h:b.height},{...b.b,h:b.height}],samples=[];
 let distance=0;
 for(let j=1;j<source.length;j++){
  const a=source[j-1],v=source[j],length=Math.hypot(v.x-a.x,v.z-a.z),count=Math.max(1,Math.ceil(length/.25));
  for(let k=j===1?0:1;k<=count;k++){
   const t=k/count,x=a.x+(v.x-a.x)*t,z=a.z+(v.z-a.z)*t;
   const nx=-(v.z-a.z)/length,nz=(v.x-a.x)/length;
   let h=a.h+(v.h-a.h)*t,waterRequirement=crossWaterHeight(p,x,z,nx,nz,b.halfWidth)+clearance;
   samples.push({x,z,h:Math.max(h,waterRequirement),distance:distance+length*t});
  }
  distance+=length;
 }
 for(let i=1;i<samples.length;i++)samples[i].h=Math.max(samples[i].h,samples[i-1].h-maxGrade*(samples[i].distance-samples[i-1].distance));
 for(let i=samples.length-2;i>=0;i--)samples[i].h=Math.max(samples[i].h,samples[i+1].h-maxGrade*(samples[i+1].distance-samples[i].distance));
 const retained=samples.filter((s,i)=>i===0||i===samples.length-1||Math.abs(
  (s.h-samples[i-1].h)/(s.distance-samples[i-1].distance)-
  (samples[i+1].h-s.h)/(samples[i+1].distance-s.distance))>1e-7);
 const points=retained.map(s=>({x:Number(s.x.toFixed(6)),z:Number(s.z.toFixed(6)),h:Number(s.h.toFixed(6))}));
 return {...b,points,a:points[0],b:points.at(-1),height:Math.max(...points.map(s=>s.h))};
}
module.exports={clearBridge,crossWaterHeight};
