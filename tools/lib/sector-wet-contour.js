'use strict';
const {groundHeight, waterAt} = require('../../src/server/sector-surface');
const surface = require('../../src/server/sector-mesh-patches');
const groundLattice = require('../../src/server/sector-ground-lattice');
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const pointKey = p => `${Math.round(p.x*1e4)},${Math.round(p.z*1e4)}`;
function clipPolygon(poly, a, b, sign) {
  const out = [];
  for (let i=0;i<poly.length;i++) {
    const p=poly[i],q=poly[(i+1)%poly.length];
    const fp=sign*cross(a,b,p),fq=sign*cross(a,b,q);
    const insideP=fp>=-1e-9,insideQ=fq>=-1e-9;
    if(insideP)out.push(p);
    if(insideP!==insideQ){const t=fp/(fp-fq);
      out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,
        g:p.g+(q.g-p.g)*t,w:p.w+(q.w-p.w)*t});}
  }
  return out;
}
function plane(a,b,c,x,z){const den=cross(a,b,c);
  const u=cross({x,z},b,c)/den,v=cross(a,{x,z},c)/den;
  return u*a.h+v*b.h+(1-u-v)*c.h;}
function pointDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function buildActualWetContour(p,field){
  const waterVertices=p.waterVertices.map(v=>({x:Math.fround(v.x),z:Math.fround(v.z),h:Math.fround(v.h)}));
  const zone=p.zoneId,n=p.terrainSegments||128,step=p.width/n,cache=new Map();
  function vertex(ix,iz){const key=ix+iz*(n+1);if(cache.has(key))return cache.get(key);
    if(groundLattice.active(p)){const v=groundLattice.regularVertex(p,ix,iz);cache.set(key,v);return v;}
    const z=(iz/n-.5)*p.depth;let x=(ix/n-.5)*p.width;
    if(ix>0&&ix<n){let closest=step/2,edges=Math.abs(Math.abs(z)-p.depth/2)<.0001?p.waterEdges:p.visibleShore;
      for(const e of edges||[]){if(Math.abs(e.b.z-e.a.z)<1e-6||z<Math.min(e.a.z,e.b.z)-.0001||z>Math.max(e.a.z,e.b.z)+.0001)continue;
        const bx=e.a.x+(e.b.x-e.a.x)*(z-e.a.z)/(e.b.z-e.a.z),d=Math.abs(bx-x);
        if(d<closest){closest=d;x=bx;}}}
    const v={x:Math.fround(x),z:Math.fround(z),h:Math.fround(groundHeight(p,field,x,z,false)-.05*p.gain/160)};cache.set(key,v);return v;}
  const boundaryCounts=new Map();
  for(let i=0;i<p.waterIndices.length;i+=3){const ids=p.waterIndices.slice(i,i+3);
    for(let j=0;j<3;j++){const a=waterVertices[ids[j]],b=waterVertices[ids[(j+1)%3]],ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
      boundaryCounts.set(key,(boundaryCounts.get(key)||0)+1);}}
  const nativeBoundary=[];const seenBoundary=new Set();
  for(let i=0;i<p.waterIndices.length;i+=3){const ids=p.waterIndices.slice(i,i+3);
    for(let j=0;j<3;j++){const a=waterVertices[ids[j]],b=waterVertices[ids[(j+1)%3]],ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
      if(boundaryCounts.get(key)===1&&!seenBoundary.has(key)){seenBoundary.add(key);nativeBoundary.push({a,b,key});}}}
  const contact=new Map(),domain=new Map();let overlapPolygons=0,anomalies=[];
  function emit(target,a,b){if(Math.hypot(b.x-a.x,b.z-a.z)<1e-5)return;
    const ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
    target.set(key,{a:{x:a.x,z:a.z,h:a.w},b:{x:b.x,z:b.z,h:b.w}});}
  for(let wi=0;wi<p.waterIndices.length;wi+=3){
    const ids=p.waterIndices.slice(wi,wi+3),wt=ids.map(id=>waterVertices[id]),sign=Math.sign(cross(...wt));
    if(!sign)continue;
    const minX=Math.min(...wt.map(v=>v.x)),maxX=Math.max(...wt.map(v=>v.x)),minZ=Math.min(...wt.map(v=>v.z)),maxZ=Math.max(...wt.map(v=>v.z));
    const gtris=surface.groundTrianglesInBox(p,minX,minZ,maxX,maxZ,vertex);
    const outer=Array.from({length:3},(_,j)=>{const a=wt[j],b=wt[(j+1)%3],ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
      return boundaryCounts.get(key)===1;});
    for(const gt of gtris){if(Math.abs(cross(...gt))<1e-10)continue;
      let poly=gt.map(v=>({x:v.x,z:v.z,g:v.h,w:plane(...wt,v.x,v.z)}));
      for(let j=0;j<3&&poly.length>=3;j++)poly=clipPolygon(poly,wt[j],wt[(j+1)%3],sign);
      if(poly.length<3)continue;overlapPolygons++;
      const roots=new Map();
      for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=a.w-a.g,db=b.w-b.g;
        if(Math.abs(da)<=1e-12)roots.set(pointKey(a),a);
        if(da*db<0){const t=da/(da-db),v={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,
          g:a.g+(b.g-a.g)*t,w:a.w+(b.w-a.w)*t};roots.set(pointKey(v),v);}
      }
      if(roots.size>=2){const values=[...roots.values()];let pair=null,best=0;
        for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
          const d=Math.hypot(values[i].x-values[j].x,values[i].z-values[j].z);
          if(d>best){best=d;pair=[values[i],values[j]];}}
        if(pair)emit(contact,...pair);
        if(roots.size>2&&anomalies.length<10)anomalies.push({kind:'contactRoots',zone,points:values.map(v=>({x:v.x,z:v.z}))});}
      for(let j=0;j<3;j++)if(outer[j]){
        const wa=wt[j],wb=wt[(j+1)%3];
        for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length];
          if(pointDistance(a,wa,wb)>1e-5||pointDistance(b,wa,wb)>1e-5)continue;
          const da=a.w-a.g,db=b.w-b.g;
          // The stabilized bank ends exactly on the water plane. A retained
          // positive-area wet fan can therefore touch the native polygon edge
          // at zero depth; that edge still closes the physical wet domain.
          if(da< -1e-6&&db< -1e-6)continue;
          if(da>=-1e-6&&db>=-1e-6){emit(domain,a,b);continue;}
          const t=da/(da-db),v={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,g:a.g+(b.g-a.g)*t,w:a.w+(b.w-a.w)*t};
          if(da>0)emit(domain,a,v);else emit(domain,v,b);
        }
      }
    }
  }
  const groupedDomain=new Map();let unassignedDomain=0;
  for(const e of domain.values()){
    const owner=nativeBoundary.find(row=>pointDistance(e.a,row.a,row.b)<.0001&&pointDistance(e.b,row.a,row.b)<.0001);
    if(!owner){unassignedDomain++;continue}
    const dx=owner.b.x-owner.a.x,dz=owner.b.z-owner.a.z,den=dx*dx+dz*dz;
    const project=v=>Math.max(0,Math.min(1,((v.x-owner.a.x)*dx+(v.z-owner.a.z)*dz)/den));
    const ta=project(e.a),tb=project(e.b);
    if(!groupedDomain.has(owner.key))groupedDomain.set(owner.key,{owner,intervals:[]});
    groupedDomain.get(owner.key).intervals.push([Math.min(ta,tb),Math.max(ta,tb)]);
  }
  const mergedDomain=[];
  for(const {owner,intervals} of groupedDomain.values()){
    intervals.sort((a,b)=>a[0]-b[0]);let current=null;
    function add(){if(!current)return;const make=t=>({x:owner.a.x+(owner.b.x-owner.a.x)*t,z:owner.a.z+(owner.b.z-owner.a.z)*t,
      h:owner.a.h+(owner.b.h-owner.a.h)*t});
      if(Math.hypot(owner.b.x-owner.a.x,owner.b.z-owner.a.z)*(current[1]-current[0])>.00001)
        mergedDomain.push({a:make(current[0]),b:make(current[1]),kind:'domainEdge'});}
    for(const interval of intervals){if(!current){current=interval.slice();continue}
      if(interval[0]-current[1]<=.0001/Math.hypot(owner.b.x-owner.a.x,owner.b.z-owner.a.z))current[1]=Math.max(current[1],interval[1]);
      else{add();current=interval.slice();}}
    add();
  }
  let all=[...contact.values()].map(e=>({...e,kind:'contact'})).concat(mergedDomain);
  const endpoints=all.flatMap(e=>[e.a,e.b]),parent=endpoints.map((_,i)=>i),buckets=new Map(),size=.0001;
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a};
  for(let i=0;i<endpoints.length;i++){
    const v=endpoints[i],ix=Math.floor(v.x/size),iz=Math.floor(v.z/size);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const j of buckets.get(`${ix+dx},${iz+dz}`)||[]){
      const w=endpoints[j];if(Math.hypot(v.x-w.x,v.z-w.z)<=.00002)join(i,j);}
    const key=`${ix},${iz}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);
  }
  const groups=new Map();for(let i=0;i<endpoints.length;i++){
    const key=root(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(endpoints[i]);}
  const snapped=new Map();for(const [key,rows] of groups){
    const mean=(prop)=>Number((rows.reduce((sum,v)=>sum+v[prop],0)/rows.length).toFixed(6));
    snapped.set(key,{x:mean('x'),z:mean('z'),h:mean('h')});}
  all=all.map((e,i)=>({...e,a:snapped.get(root(i*2)),b:snapped.get(root(i*2+1))})).filter(e=>
    Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z)>.00001);
  const duplicateGroups=new Map();for(let i=0;i<all.length;i++){
    const e=all[i],a=pointKey(e.a),b=pointKey(e.b),key=a<b?a+'|'+b:b+'|'+a;
    if(!duplicateGroups.has(key))duplicateGroups.set(key,[]);duplicateGroups.get(key).push(i);}
  const remove=new Set();
  for(const ids of duplicateGroups.values())if(ids.length===2&&ids.every(i=>all[i].kind==='contact'&&
    Math.hypot(all[i].b.x-all[i].a.x,all[i].b.z-all[i].a.z)<.02))ids.forEach(i=>remove.add(i));
  const branchAdj=new Map();for(let i=0;i<all.length;i++)if(!remove.has(i))for(const v of [all[i].a,all[i].b]){
    const key=pointKey(v);if(!branchAdj.has(key))branchAdj.set(key,[]);branchAdj.get(key).push(i);}
  for(const [leaf,edges] of branchAdj)if(edges.length===1){
    let current=leaf,previous=-1,length=0,chain=[],terminal=null;
    for(let step=0;step<20;step++){
      const links=branchAdj.get(current)||[];
      if(step&&links.length!==2){terminal=current;break}
      const edgeId=links.find(id=>id!==previous);if(edgeId===undefined||all[edgeId].kind!=='contact')break;
      const edge=all[edgeId],next=pointKey(edge.a)===current?pointKey(edge.b):pointKey(edge.a);
      length+=Math.hypot(edge.b.x-edge.a.x,edge.b.z-edge.a.z);chain.push(edgeId);
      previous=edgeId;current=next;
    }
    if(terminal&&(branchAdj.get(terminal)||[]).length>=3&&length<.02)chain.forEach(id=>remove.add(id));
  }
  all=all.filter((_,i)=>!remove.has(i));
  // Merging native-boundary intervals can create a false chord when a high
  // generated bank rises above the water between its end points. The true
  // contact curve already surrounds that dry patch. Remove the chord only if
  // the remaining edge graph is independently a closed two-valent contour.
  let removedDryDomain=0;
  function twoValentWithout(skip){const counts=new Map();let count=0;
    for(let i=0;i<all.length;i++){if(i===skip)continue;count++;
      for(const q of [all[i].a,all[i].b]){const k=pointKey(q);counts.set(k,(counts.get(k)||0)+1);}}
    return counts.size===count&&[...counts.values()].every(n=>n===2);
  }
  for(let i=all.length-1;i>=0;i--){const e=all[i];if(e.kind!=='domainEdge')continue;
    const length=Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z),steps=Math.max(2,Math.ceil(length/.05));
    let dryExcess=0;
    for(let j=0;j<=steps;j++){const t=j/steps,x=e.a.x+(e.b.x-e.a.x)*t,z=e.a.z+(e.b.z-e.a.z)*t,
      g=surface.sample(p,x,z,vertex),w=waterAt(p,x,z);
      if(g)dryExcess=Math.max(dryExcess,g.height-w.height);}
    if(dryExcess>.0015&&twoValentWithout(i)){all.splice(i,1);removedDryDomain++;}
  }
  const degree=new Map(),node=new Map(),adjacent=new Map();for(const e of all)for(const v of [e.a,e.b]){const key=pointKey(v);degree.set(key,(degree.get(key)||0)+1);node.set(key,v);if(!adjacent.has(key))adjacent.set(key,[]);adjacent.get(key).push({kind:e.kind,a:e.a,b:e.b})}
  const degreeSummary={};for(const count of degree.values())degreeSummary[count]=(degreeSummary[count]||0)+1;
  const leaves=[...degree].filter(([,count])=>count===1).map(([key])=>node.get(key));
  const leafNearest=[];for(const a of leaves){let best=Infinity;for(const b of leaves){if(a===b)continue;best=Math.min(best,Math.hypot(a.x-b.x,a.z-b.z))}leafNearest.push(best)}
  leafNearest.sort((a,b)=>a-b);
  let contactMax=0,domainMax=0,sideMismatch=0,denseSamples=0,denseMissing=0,denseMissingUnexpected=0,denseMissingExamples=[],denseMissingUnexpectedExamples=[];
  for(const e of all){const mid={x:(e.a.x+e.b.x)/2,z:(e.a.z+e.b.z)/2},mesh=surface.sample(p,mid.x,mid.z,vertex),water=waterAt(p,mid.x,mid.z);
    if(!mesh){sideMismatch++;continue}
    if(e.kind==='contact')contactMax=Math.max(contactMax,Math.abs(mesh.height-water.height));
    else {let min=Infinity;for(let j=0;j<p.waterIndices.length;j+=3){const ids=p.waterIndices.slice(j,j+3);
      for(let k=0;k<3;k++){const a=waterVertices[ids[k]],b=waterVertices[ids[(k+1)%3]],ka=pointKey(a),kb=pointKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;
        if(boundaryCounts.get(key)===1)min=Math.min(min,pointDistance(mid,a,b));}}
      domainMax=Math.max(domainMax,min);}
    const length=Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z),steps=Math.max(1,Math.ceil(length/.1));
    for(let i=0;i<=steps;i++){
      const t=i/steps,x=e.a.x+(e.b.x-e.a.x)*t,z=e.a.z+(e.b.z-e.a.z)*t;
      if(e.kind==='contact'){
        const g=surface.sample(p,x,z,vertex),w=waterAt(p,x,z);denseSamples++;
        if(!g||!w.inside){
          denseMissing++;
          const domainDistance=Math.min(...nativeBoundary.map(row=>pointDistance({x,z},row.a,row.b)));
          // A representable water-polygon endpoint can land just outside the
          // analytic water test. A missing ground triangle is a separate hole.
          const numericalEndpoint=Boolean(g)&&!w.inside&&(i===0||i===steps)&&domainDistance<=.000002;
          const row={x,z,ground:Boolean(g),waterInside:w.inside,kind:e.kind,i,steps,edge:e,domainDistance,numericalEndpoint};
          if(!numericalEndpoint){denseMissingUnexpected++;if(denseMissingUnexpectedExamples.length<5)denseMissingUnexpectedExamples.push(row);}
          if(denseMissingExamples.length<5)denseMissingExamples.push(row);
          continue;
        }
        contactMax=Math.max(contactMax,Math.abs(g.height-w.height));
      } else {
        let min=Infinity;for(const row of nativeBoundary)min=Math.min(min,pointDistance({x,z},row.a,row.b));
        domainMax=Math.max(domainMax,min);denseSamples++;
      }
    }
  }
  if(Object.keys(degreeSummary).length!==1||degreeSummary[2]!==all.length||
     denseMissingUnexpected||sideMismatch||contactMax>.03||domainMax>.00001)
    throw Error('Wet contour failed manifold/contact/domain guard '+zone+' '+JSON.stringify({degreeSummary,edges:all.length,denseMissing,denseMissingUnexpected,denseMissingExamples,denseMissingUnexpectedExamples,contactMax,domainMax,sideMismatch,leaves:leaves.slice(0,20),leafNearest:leafNearest.slice(0,20),branches:[...degree].filter(([,n])=>n>2).map(([key,n])=>({at:node.get(key),n,edges:adjacent.get(key)})).slice(0,4)}));
  const report={zone,overlapPolygons,rawContact:contact.size,rawDomain:domain.size,mergedDomain:mergedDomain.length,
    contact:all.filter(e=>e.kind==='contact').length,domain:all.filter(e=>e.kind==='domainEdge').length,unassignedDomain,removedDryDomain,total:all.length,
    degreeSummary,junctionExamples:[...degree].filter(([,n])=>n>=3).slice(0,8).map(([key,n])=>({at:node.get(key),degree:n,edges:adjacent.get(key).map(e=>({kind:e.kind,length:Math.hypot(e.b.x-e.a.x,e.b.z-e.a.z),other:pointKey(e.a)===key?e.b:e.a}))})),leafNearest:{min:leafNearest[0],median:leafNearest[Math.floor(leafNearest.length/2)],p95:leafNearest[Math.floor(leafNearest.length*.95)],max:leafNearest.at(-1)},leafExamples:leaves.slice(0,8),contactMax,domainMax,sideMismatch,denseSamples,denseMissing,denseMissingUnexpected,denseMissingExamples,denseMissingUnexpectedExamples,anomalies};
  return {edges:all,report};
}
module.exports={buildActualWetContour};
