'use strict';
const {isWaterAt}=require('../../src/server/sector-surface');

// Small service terraces for explicitly reviewed water reserves on steep soil.
// Default generation and the source river remain unchanged without a recipe.
function applyCisternFootings(profiles,field,engineering,definitionOf) {
  const recipes=engineering.cisternFootings||[],byZone=new Map(profiles.map(p=>[p.zoneId,p]));
  const prepared=[],seen=new Set();
  for(const recipe of recipes) {
    const p=byZone.get(recipe.zone),key=recipe.zone+'/'+recipe.id;
    if(!p||p.legacyDam||!recipe.id||seen.has(key))throw new Error('Invalid cistern footing '+key);
    seen.add(key);
    const ids=recipe.objectIds||[recipe.objectId],definition=definitionOf(p);
    const rows=ids.map(id=>definition.objects.find(r=>r.id===id));
    if(!ids.length||new Set(ids).size!==ids.length||rows.some(row=>!row||row.model!=='waterTank'||!row.tags?.includes('zone-kit')
        ||!(row.footprint?.x>=2.2&&row.footprint.x<=3.5&&row.footprint.z>=1.65&&row.footprint.z<=2.7)))
      throw new Error('Cistern footing requires an authored small water reserve '+key);
    for(const name of ['x','z','halfX','halfZ','blend','height'])
      if(!Number.isFinite(recipe[name]))throw new Error('Invalid cistern footing '+name+' '+key);
    if(recipe.halfX<=0||recipe.halfZ<=0||recipe.blend<=0
        ||Math.abs(recipe.x)+recipe.halfX+recipe.blend>p.width/2
        ||Math.abs(recipe.z)+recipe.halfZ+recipe.blend>p.depth/2)
      throw new Error('Cistern footing crosses its sector or has invalid dimensions '+key);
    for(const row of rows) {
      const anchor=row.surfacePlacement||row.surfaceSourcePosition||row.position;
      const radius=Math.hypot(row.footprint.x,row.footprint.z)/2;
      if((rows.length===1&&Math.hypot(anchor.x-recipe.x,anchor.z-recipe.z)>.001)
          ||Math.abs(anchor.x-recipe.x)+radius>recipe.halfX||Math.abs(anchor.z-recipe.z)+radius>recipe.halfZ)
        throw new Error('Cistern footing does not support its authored reserve '+key);
    }
    const radius=Math.hypot(recipe.halfX,recipe.halfZ)+recipe.blend;
    if(isWaterAt(p,recipe.x,recipe.z,radius,field))
      throw new Error('Cistern service terrace intersects water '+key);
    prepared.push({p,pad:{id:recipe.id,cisternObjectIds:ids,x:recipe.x,z:recipe.z,
      halfX:recipe.halfX,halfZ:recipe.halfZ,blend:recipe.blend,height:recipe.height,afterRoads:true}});
  }
  for(const {p,pad}of prepared){p.foundations=p.foundations.filter(r=>r.id!==pad.id);p.foundations.push(pad);}
  return prepared.map(({p,pad})=>({zone:p.zoneId,...pad}));
}
module.exports={applyCisternFootings};
