'use strict';

// The saved server definition contains only objects present in the scene.
// Terrain generation also needs the source decoration it intentionally removed.
function sectorSourceDefinition(definition) {
  const archived=definition.surfaceSource?.removedObjects||[];
  if(!archived.length)return definition;
  const rows=new Map((definition.objects||[]).map(row=>[row.id,row]));
  for(const row of archived)if(!rows.has(row.id))rows.set(row.id,row);
  const objects=[];
  for(const id of definition.surfaceSource.objectOrder||[]) {
    const row=rows.get(id);
    if(row){objects.push(row);rows.delete(id);}
  }
  objects.push(...rows.values());
  return {...definition,objects};
}
module.exports={sectorSourceDefinition};
