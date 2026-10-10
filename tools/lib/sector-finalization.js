'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {processPipes}=require('./sector-process-pipes');
const {attachObstacles}=require('./sector-obstacles');
const {visibleShore}=require('./sector-shore');
const {buildSurfacePatches,buildPhysicalShore}=require('./sector-surface-refinements');
const {buildRetainedWetContour}=require('./sector-wet-retained');
const {fitRoadBankContactWalls,buildRoadBankContactFootings,buildBridgeBankRevetmentMeshes}=require('./sector-road-bank');
const groundLattice=require('../../src/server/sector-ground-lattice');
const {planPlacements}=require('./sector-placement');
const {planFunctional}=require('./sector-functional');
const {planNavigation}=require('./sector-navigation');
const {sectorSourceDefinition}=require('./sector-source-definition');
const {writeAtomicJson}=require('./sector-finalization-io');
const {activeLayoutFiles}=require('./sector-active-layouts');
const root=path.resolve(__dirname,'../..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function sharedSnapshot() {
  const directories=['tools/lib','src/server'];
  const files=['data/kromka/sector-engineering.json','data/kromka/sector-visual-bounds.json',...activeLayoutFiles(root)];
  for(const directory of directories)for(const entry of fs.existsSync(path.join(root,directory))?fs.readdirSync(path.join(root,directory),{withFileTypes:true}):[])
    if(entry.isFile()&&/\.(js|json)$/.test(entry.name))files.push(directory+'/'+entry.name);
  return hash(JSON.stringify(files.sort().map(file=>[file,hash(fs.readFileSync(path.join(root,file)))])));
}
function finalizeSectorCatalog(catalog,{collectPaths=false,collectFailures=false,checkpointDir,onProgress,selectedZones}={}) {
  const selection=selectedZones&&new Set(selectedZones);
  if(selection&&(!selection.size||selection.size!==selectedZones.length
      ||selectedZones.some(id=>!catalog.profiles.some(p=>p.zoneId===id))))throw new Error('Invalid diagnostic finalization selection');
  const initialShared=sharedSnapshot(),fieldHash=hash(JSON.stringify(catalog.relief));
  const engineering=JSON.parse(fs.readFileSync(path.join(root,'data/kromka/sector-engineering.json')));
  // Partial diagnostic catalogues intentionally omit most sectors. Require
  // the canonical cache for every native-wet sector actually present; the
  // ordinary 197-sector catalogue still requires all six.
  const present=new Set(catalog.profiles.map(profile=>profile.zoneId));
  const latticeZones=(engineering.surfaceRefinements||[])
    .filter(row=>row.nativeWetContour&&present.has(row.zone)).map(row=>row.zone);
  const latticeFile=process.env.ROA_GROUND_LATTICE_CACHE||path.join(root,'data/kromka/sector-ground-lattices.json');
  const latticeBytes=latticeZones.length?fs.readFileSync(latticeFile):null;
  const latticeCache=latticeBytes?JSON.parse(latticeBytes):null;
  const latticeGeometry=latticeZones.length?groundLattice.geometryHash(catalog):null;
  const latticeCode=latticeZones.length?groundLattice.codeHash():null;
  if(latticeCache&&(latticeCache.schema!==groundLattice.CACHE_SCHEMA
      ||latticeCache.geometryHash!==latticeGeometry||latticeCache.codeHash!==latticeCode
      ||!Array.isArray(latticeCache.zones)||new Set(latticeCache.zones.map(row=>row.zoneId)).size!==latticeCache.zones.length
      ||latticeZones.some(id=>!latticeCache.zones.some(row=>row.zoneId===id))))
    throw new Error('Canonical ground lattice cache is missing, malformed or stale; regenerate with build-sector-ground-lattices');
  const sources=new Map(),prepared=new Map();
  for(const p of catalog.profiles) {
    try {
      if(!/^z_\d{2}_\d{2}$/.test(p.zoneId))throw new Error('Invalid checkpoint sector '+p.zoneId);
      const relative=p.locationId===p.zoneId?'data/zones/authored/'+p.zoneId+'.json':'data/locations/'+p.locationId+'.json';
      const file=path.join(root,relative),content=fs.readFileSync(file);
      sources.set(file,hash(content));
      prepared.set(p.zoneId,{definition:{...sectorSourceDefinition(JSON.parse(content)),surfaceArrivalOverride:engineering.arrivalOverrides?.find(row=>row.zone===p.zoneId)}});
    } catch(error){prepared.set(p.zoneId,{error});}
  }
  if(checkpointDir)fs.mkdirSync(checkpointDir,{recursive:true});
  const paths=collectPaths||checkpointDir?[]:undefined;
  const failures=[];
  let completed=0;
  for(const p of catalog.profiles.filter(p=>!selection||selection.has(p.zoneId))) {
    delete p.interactionApproaches;delete p.functionalPlacements;delete p.navigation;
    delete p.surfacePatches;delete p.physicalShore;delete p.groundLattice;delete p.hasGroundLattice;
    delete p.roadBankContactWalls;delete p.hasRoadBankContactWalls;
    delete p.roadBankContactFootings;delete p.hasRoadBankContactFootings;
    const started=Date.now();let reused=false,failure=null,checkpointIssue=null;
    try {
    if(!/^z_\d{2}_\d{2}$/.test(p.zoneId))throw new Error('Invalid checkpoint sector '+p.zoneId);
    const source=prepared.get(p.zoneId);if(source.error)throw source.error;
    const definition=source.definition;
    const validationHash=hash(JSON.stringify({shared:initialShared,field:fieldHash,lattice:latticeBytes&&hash(latticeBytes),profile:p,definition}));
    const checkpointFile=checkpointDir&&path.join(checkpointDir,p.zoneId+'.json');
    let checkpoint=null;
    if(checkpointFile&&fs.existsSync(checkpointFile)) {
      try{checkpoint=JSON.parse(fs.readFileSync(checkpointFile));}
      catch(error){if(!(error instanceof SyntaxError))throw error;checkpointIssue='Unreadable checkpoint JSON; rebuilding';}
    }
    if(checkpoint?.schema==='roa.sectorFinalizationCheckpoint.v1'&&checkpoint.validationHash===validationHash &&
        checkpoint.profile?.zoneId===p.zoneId&&checkpoint.profile.locationId===p.locationId&&Array.isArray(checkpoint.paths) &&
        (!checkpoint.resultHash||checkpoint.resultHash===hash(JSON.stringify({profile:checkpoint.profile,paths:checkpoint.paths})))) {
      Object.assign(p,checkpoint.profile);paths.push(...checkpoint.paths);reused=true;
    } else {
      const routes=paths?[]:undefined;
      p.processPipes=processPipes(p,catalog.relief,definition,root,catalog.profiles);
      attachObstacles(p,definition,catalog.relief);
      p.visibleShore=visibleShore(p,catalog.relief);
      const refinement=engineering.surfaceRefinements?.find(row=>row.zone===p.zoneId);
      if(refinement){
        if(refinement.nativeWetContour){
          const lattice=latticeCache.zones.find(row=>row.zoneId===p.zoneId);
          if(lattice.geometryHash!==latticeGeometry||lattice.codeHash!==latticeCode
              ||lattice.profileGeometryHash!==groundLattice.profileGeometryHash(p,latticeGeometry))
            throw new Error('Stale canonical ground lattice shoreline '+p.zoneId);
          p.groundLattice=lattice;p.hasGroundLattice=true;groundLattice.decode(p);
        }
        const patches=buildSurfacePatches(p,catalog.relief,refinement);
        if(!patches.validation.ok)throw new Error('Invalid surface patches '+p.zoneId);
        p.surfacePatches=patches.cells;
        if(refinement.nativeWetContour){
          p.physicalShore=buildRetainedWetContour(p,catalog.relief).edges;
        } else if(refinement.shore){
          const shoreline=buildPhysicalShore(p,catalog.relief,refinement);
          // An old visual-shore anchor can be fully wet against a shared sector edge;
          // it has no dry/wet root. The neighbour's actual wet edge is audited separately.
          const nonBoundaryMissing=shoreline.missing.filter(v=>!v.alreadyWetSharedEdge);
          if(nonBoundaryMissing.length)throw new Error('Missing physical shoreline roots '+p.zoneId+': '+nonBoundaryMissing.length);
          p.physicalShore=shoreline.edges;
        }
      }
      if(p.roadBankWalls?.length){
        p.roadBankContactWalls=fitRoadBankContactWalls(p);p.hasRoadBankContactWalls=true;
        p.roadBankContactFootings=buildRoadBankContactFootings(p);p.hasRoadBankContactFootings=true;
      }
      if(p.bridgeBankRevetments?.length){
        p.bridgeBankRevetmentMeshes=buildBridgeBankRevetmentMeshes(p,catalog.relief);
        attachObstacles(p,definition,catalog.relief);
      }
      p.placements=planPlacements(p,catalog.relief,definition);
      p.functionalPlacements=planFunctional(p,catalog.relief,definition,{interactionPaths:routes});
      p.navigation=planNavigation(p,catalog.relief,definition);
      if(checkpointFile)writeAtomicJson(checkpointFile,{schema:'roa.sectorFinalizationCheckpoint.v1',validationHash,
        resultHash:hash(JSON.stringify({profile:p,paths:routes})),profile:p,paths:routes});
      if(paths)paths.push(...routes);
    }
    } catch(error) {
      if(!collectFailures)throw error;
      failure=error.message;failures.push({zoneId:p.zoneId,message:failure});
    }
    onProgress?.({zone:p.zoneId,completed:++completed,reused,milliseconds:Date.now()-started,paths:paths?.length||0,
      failure,failureCount:failures.length,...(checkpointIssue?{checkpointIssue}:{})});
  }
  let sourceError=null;
  try{if(sharedSnapshot()!==initialShared||[...sources].some(([file,value])=>hash(fs.readFileSync(file))!==value)
      ||latticeBytes&&hash(fs.readFileSync(latticeFile))!==hash(latticeBytes))sourceError='Sector sources changed during finalization; no final catalogue can be published';}
  catch(error){sourceError='Sector sources cannot be verified after finalization: '+error.message;}
  if(sourceError) {
    const message=sourceError;
    if(!collectFailures)throw new Error(message);
    failures.push({zoneId:null,message});
  }
  // Diagnostic passes retain successful checkpoints but never publish a partial world.
  if(failures.length)return {catalog:null,paths,failures};
  if(!selection&&latticeZones.length){
    catalog.groundLatticeZones=latticeZones;
    groundLattice.assertCatalog(catalog,{expectedZones:latticeZones,expectedCodeHash:latticeCode});
  }
  catalog.schema='roa.sectorSurfaces.v1';delete catalog.sourceHash;
  catalog.sourceHash=hash(JSON.stringify(catalog));
  return {catalog,paths,...(selection?{wholeWorldAccepted:false,selectedZones:[...selection]}:{})};
}
module.exports={finalizeSectorCatalog,sharedSnapshot};
