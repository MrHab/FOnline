'use strict';
// Full-world parallel replay. Each worker calls the ordinary per-zone
// finalizer against the same 197-profile input; only the parent may publish.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {finalizeSectorCatalog,sharedSnapshot}=require('./lib/sector-finalization');
const {writeAtomicJson}=require('./lib/sector-finalization-io');
const lattice=require('../src/server/sector-ground-lattice');
const root=path.resolve(__dirname,'..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function canonical(file){
 const absolute=path.resolve(file),resolved=fs.existsSync(absolute)?fs.realpathSync(absolute):absolute;
 return process.platform==='win32'?resolved.toLowerCase():resolved;
}
function sourceSnapshot(){
 const files=['data/kromka/sector-engineering.json','data/kromka/sector-visual-bounds.json',
  'tools/finalize-sector-surfaces-parallel.js','tools/finalize-sector-surfaces.js'];
 const cache=process.env.ROA_GROUND_LATTICE_CACHE||path.join(root,'data/kromka/sector-ground-lattices.json');
 for(const dir of ['tools/lib','src/server','data/locations','data/zones/authored'])
  for(const entry of fs.existsSync(path.join(root,dir))?fs.readdirSync(path.join(root,dir),{withFileTypes:true}):[])
   if(entry.isFile()&&/\.(js|json)$/.test(entry.name))files.push(dir+'/'+entry.name);
 return hash(JSON.stringify({shared:sharedSnapshot(),cache:hash(fs.readFileSync(cache)),
  files:files.sort().map(file=>[file,hash(fs.readFileSync(path.join(root,file)))])}));
}
function partition(ids,count){
 const groups=Array.from({length:count},()=>[]);
 ids.forEach((id,index)=>groups[index%count].push(id));
 return groups;
}
function worker(input,expectedInputHash,expectedSources,group,checkpointDir,resultFile){
 const bytes=fs.readFileSync(input);
 if(hash(bytes)!==expectedInputHash||sourceSnapshot()!==expectedSources)
  throw new Error('Frozen source changed before parallel worker');
 const catalog=JSON.parse(bytes);
 const result=finalizeSectorCatalog(catalog,{selectedZones:group,collectPaths:true,collectFailures:true,
  checkpointDir,onProgress:row=>console.log(JSON.stringify(row))});
 if(hash(fs.readFileSync(input))!==expectedInputHash||sourceSnapshot()!==expectedSources)
  throw new Error('Frozen source changed during parallel worker');
 if(!result.catalog){
  writeAtomicJson(resultFile,{status:'FAIL',selectedZones:group,failures:result.failures});
  return;
 }
 if(result.wholeWorldAccepted!==false||JSON.stringify(result.selectedZones)!==JSON.stringify(group))
  throw new Error('Worker claimed a complete catalogue');
 const selected=result.catalog.profiles.filter(profile=>group.includes(profile.zoneId));
 if(selected.length!==group.length||result.paths.some(row=>!group.includes(row.zone)))
  throw new Error('Worker result escaped its selected zones');
 writeAtomicJson(resultFile,{status:'PASS',selectedZones:group,profiles:selected,paths:result.paths});
}
function childResult(input,inputHash,sources,group,checkpointDir,resultFile){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[__filename,'--worker',input,inputHash,sources,JSON.stringify(group),checkpointDir,resultFile],
   {cwd:root,windowsHide:true,env:process.env,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(process.stdout,{end:false});child.stderr.pipe(process.stderr,{end:false});
  child.on('error',reject);
  child.on('close',code=>{
   if(code!==0)return reject(new Error('Parallel finalization worker exited '+code+' for '+group.join(',')));
   try{resolve(JSON.parse(fs.readFileSync(resultFile)));}catch(error){reject(error);}
  });
 });
}
async function runSectorFinalizationParallel(input,output,diagnostic,checkpointDir,workerCount){
 assert(input&&output&&diagnostic&&checkpointDir,'Usage: finalize-sector-surfaces-parallel input output diagnostic checkpoint-dir workers');
 assert(Number.isInteger(workerCount)&&workerCount>=1&&workerCount<=8,'Workers must be an integer from 1 to 8');
 assert.equal(new Set([input,output,diagnostic].map(canonical)).size,3,
  'Input, output and diagnostic must be distinct files');
 const checkpoints=canonical(checkpointDir);
 for(const file of [input,output,diagnostic]){
  const target=canonical(file);
  assert(target!==checkpoints&&!target.startsWith(checkpoints+path.sep),
   'Checkpoint directory must not contain input, output or diagnostic');
 }
 const removeOutput=()=>{if(fs.existsSync(output))fs.unlinkSync(output);};
 const failureReport=failures=>({schema:'roa.sectorFinalizationFailures.v1',status:'FAIL',profiles:197,failures});
 removeOutput();
 let runDir;
 try{
  writeAtomicJson(diagnostic,{schema:'roa.sectorFinalizationFailures.v1',status:'IN_PROGRESS',profiles:197},true);
  const bytes=fs.readFileSync(input),inputHash=hash(bytes),catalog=JSON.parse(bytes);
  assert.equal(catalog.profiles.length,197);
  const ids=catalog.profiles.map(profile=>profile.zoneId);
  assert.equal(new Set(ids).size,197);
  assert(ids.every(id=>/^z_\d{2}_\d{2}$/.test(id)),'Invalid full-world zone ID');
  for(const id of ids)assert(![input,output,diagnostic].some(file=>canonical(file)===canonical(path.join(checkpointDir,id+'.json'))),
   'Checkpoint must not overwrite input, output or diagnostic: '+id);
  const initialGeometry=lattice.geometryHash(catalog),sources=sourceSnapshot(),code=lattice.codeHash();
  const groups=partition(ids,workerCount);
  runDir=fs.mkdtempSync(path.join(os.tmpdir(),'roa-sector-parallel-'));
  const resultFiles=groups.map((_,index)=>path.join(runDir,'worker-'+index+'.json'));
  const settled=await Promise.allSettled(groups.map((group,index)=>
   childResult(input,inputHash,sources,group,checkpointDir,resultFiles[index])));
  if(hash(fs.readFileSync(input))!==inputHash||sourceSnapshot()!==sources||lattice.codeHash()!==code)
   throw new Error('Frozen source changed during parallel finalization');
  const errors=settled.filter(row=>row.status==='rejected').map(row=>row.reason.message);
  if(errors.length)throw new Error(errors.join('; '));
  const results=settled.map(row=>row.value),failures=results.flatMap(row=>row.failures||[]);
  if(failures.length){writeAtomicJson(diagnostic,failureReport(failures),true);return {catalog:null,paths:[],failures};}
  const updated=new Map(),pathsByZone=new Map();
  for(let index=0;index<results.length;index++){
   const result=results[index],group=groups[index];
   assert.equal(result.status,'PASS');
   assert.deepEqual(result.selectedZones,group);
   assert.equal(result.profiles.length,group.length);
   for(const profile of result.profiles){
    assert(group.includes(profile.zoneId)&&!updated.has(profile.zoneId),'Duplicate/unselected worker profile');
    updated.set(profile.zoneId,profile);
   }
   for(const row of result.paths){
    assert(group.includes(row.zone),'Unselected worker path');
    if(!pathsByZone.has(row.zone))pathsByZone.set(row.zone,[]);
    pathsByZone.get(row.zone).push(row);
   }
  }
  assert.equal(updated.size,197);
  catalog.profiles=catalog.profiles.map(profile=>updated.get(profile.zoneId));
  assert.equal(lattice.geometryHash(catalog),initialGeometry,'Immutable source geography changed');
  const engineering=JSON.parse(fs.readFileSync(path.join(root,'data/kromka/sector-engineering.json')));
  catalog.groundLatticeZones=(engineering.surfaceRefinements||[])
   .filter(row=>row.nativeWetContour).map(row=>row.zone);
  lattice.assertCatalog(catalog,{expectedZones:catalog.groundLatticeZones,expectedCodeHash:code});
  const paths=catalog.profiles.flatMap(profile=>pathsByZone.get(profile.zoneId)||[]);
  assert.equal(paths.length,results.reduce((sum,row)=>sum+row.paths.length,0),'Lost interaction routes');
  catalog.schema='roa.sectorSurfaces.v1';delete catalog.sourceHash;
  catalog.sourceHash=hash(JSON.stringify(catalog));
  if(hash(fs.readFileSync(input))!==inputHash||sourceSnapshot()!==sources||lattice.codeHash()!==code)
   throw new Error('Frozen source changed before parallel publication');
  writeAtomicJson(diagnostic,{schema:'roa.interactionPathDiagnostics.v1',status:'PASS',sourceHash:catalog.sourceHash,rows:paths});
  writeAtomicJson(output,catalog);
  return {catalog,paths};
 }catch(error){
  removeOutput();
  try{writeAtomicJson(diagnostic,failureReport([{zoneId:null,message:error.message}]),true);}
  catch(diagnosticError){error.message+='; diagnostic could not be saved: '+diagnosticError.message;}
  throw error;
 }finally{
  if(runDir){
   for(const name of fs.readdirSync(runDir))if(/^worker-\d+\.json$/.test(name))fs.unlinkSync(path.join(runDir,name));
   if(!fs.readdirSync(runDir).length)fs.rmdirSync(runDir);
  }
 }
}
if(require.main===module){
 if(process.argv[2]==='--worker'){
  try{worker(process.argv[3],process.argv[4],process.argv[5],JSON.parse(process.argv[6]),process.argv[7],process.argv[8]);}
  catch(error){console.error(error.stack);process.exitCode=1;}
 }else{
  const args=process.argv.slice(2);
  if(args.length!==5){console.error('Usage: finalize-sector-surfaces-parallel input output diagnostic checkpoint-dir workers');process.exitCode=1;}
  else runSectorFinalizationParallel(args[0],args[1],args[2],args[3],Number(args[4]))
   .then(result=>{if(!result.catalog){console.error(JSON.stringify({status:'FAIL',failures:result.failures.length}));process.exitCode=1;}
    else console.log(JSON.stringify({status:'PASS',profiles:197,paths:result.paths.length,sourceHash:result.catalog.sourceHash}));})
   .catch(error=>{console.error(error.stack);process.exitCode=1;});
 }
}
module.exports={runSectorFinalizationParallel,partition,sourceSnapshot};
