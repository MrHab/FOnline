'use strict';
const fs=require('node:fs'),path=require('node:path');

// Authored process ponds are additions to the immutable natural river field.
// Terrain, server collision and the global preview consume this same geometry.
function addSiteWater(profile,definition,root) {
  profile.naturalWaterIndexCount=profile.waterIndices.length;
  for(const site of definition.sites||[]) {
    const file=path.join(root,'data/kromka/site-layouts',site.id+'.json');
    if(!fs.existsSync(file))continue;
    const layout=JSON.parse(fs.readFileSync(file,'utf8'));
    const angle=(layout.site.rotationY||0)*Math.PI/180;
    const transform=(x,z,h)=>({x:site.x+x*Math.cos(angle)+z*Math.sin(angle),z:site.z-x*Math.sin(angle)+z*Math.cos(angle),h});
    const pad=profile.foundations.find(f=>f.id==='site_'+site.id+'_000_base');
    for(const pond of layout.water||[]) {
      const h=pad.height+pond.height,n=64;
      const vertices=[transform(pond.x,pond.z,h)];
      for(let i=0;i<n;i++){const t=i*Math.PI*2/n;vertices.push(transform(pond.x+Math.cos(t)*pond.halfX,pond.z+Math.sin(t)*pond.halfZ,h));}
      if(vertices.some(v=>Math.abs(v.x)>profile.width/2||Math.abs(v.z)>profile.depth/2))throw new Error('Process pond crosses sector boundary '+site.id);
      const offset=profile.waterVertices.length,indices=[];
      for(let i=0;i<n;i++)indices.push(offset,offset+1+(i+1)%n,offset+1+i);
      profile.waterVertices=[...profile.waterVertices,...vertices];profile.waterIndices=[...profile.waterIndices,...indices];
      profile.waterEdges=[...profile.waterEdges,...Array.from({length:n},(_,i)=>({a:vertices[i+1],b:vertices[1+(i+1)%n]}))];
    }
  }
  siteWaterFilms(profile,definition,root);
}
function siteWaterFilms(profile,definition,root) {
  delete profile.waterPollution;
  for(const site of definition.sites||[]) {
    const file=path.join(root,'data/kromka/site-layouts',site.id+'.json');
    if(!fs.existsSync(file))continue;
    const layout=JSON.parse(fs.readFileSync(file,'utf8')),angle=(layout.site.rotationY||0)*Math.PI/180;
    for(const pond of layout.water||[])if(pond.surfaceFilm) {
      if(profile.waterPollution)throw new Error('Multiple film fields require separate water materials '+profile.zoneId);
      const film=pond.surfaceFilm;
      profile.waterPollution={x:site.x+film.x*Math.cos(angle)+film.z*Math.sin(angle),z:site.z-film.x*Math.sin(angle)+film.z*Math.cos(angle),halfX:film.halfX,halfZ:film.halfZ,color:film.color};
    }
  }
}
module.exports={addSiteWater,siteWaterFilms};
