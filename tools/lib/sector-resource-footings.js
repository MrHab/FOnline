'use strict';

// These small, explicitly authored dry pads support a rigid resource base.
// They are applied after road grading and hydraulic cuts, before rail decks.
// With no recipes the generation pipeline is unchanged.
function applyResourceFootings(profiles,field,engineering,definitionOf) {
  const recipes=engineering.resourceFootings||[];
  if(!recipes.length)return [];
  const byZone=new Map(profiles.map(p=>[p.zoneId,p])),seen=new Set(),prepared=[];
  for(const recipe of recipes) {
    const p=byZone.get(recipe.zone);
    if(!p||p.legacyDam)throw new Error('Invalid resource footing sector '+recipe.zone);
    const key=recipe.zone+'/'+recipe.id;
    if(!recipe.id||!recipe.objectId||seen.has(key))throw new Error('Duplicate or unnamed resource footing '+key);
    seen.add(key);
    const definition=definitionOf(p),object=definition.objects.find(row=>row.id===recipe.objectId);
    if(!object||!(object.resourceType||object.resource)||!['oilPumpJack','tireStack'].includes(object.model))
      throw new Error('Resource footing requires a protected rigid native model '+key);
    for(const name of ['x','z','halfX','halfZ','blend','height'])
      if(!Number.isFinite(recipe[name]))throw new Error('Invalid resource footing '+name+' '+key);
    if(recipe.halfX<=0||recipe.halfZ<=0||recipe.blend<=0)
      throw new Error('Resource footing must have a positive core and smooth blend '+key);
    if(Math.abs(recipe.x)+recipe.halfX+recipe.blend>p.width/2||Math.abs(recipe.z)+recipe.halfZ+recipe.blend>p.depth/2)
      throw new Error('Resource footing crosses a sector boundary '+key);
    const pad={id:recipe.id,resourceObjectId:recipe.objectId,x:recipe.x,z:recipe.z,
      halfX:recipe.halfX,halfZ:recipe.halfZ,blend:recipe.blend,height:recipe.height,
      afterRoads:true};
    prepared.push({p,pad});
  }
  // Validate every recipe before mutating the catalog.
  for(const {p,pad}of prepared) {
    p.foundations=p.foundations.filter(row=>row.id!==pad.id);
    p.foundations.push(pad);
  }
  return prepared.map(({p,pad})=>({zone:p.zoneId,...pad}));
}
module.exports={applyResourceFootings};
