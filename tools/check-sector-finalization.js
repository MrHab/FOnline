'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {finalizeSectorCatalog}=require('./lib/sector-finalization');
const {writeAtomicJson}=require('./lib/sector-finalization-io');
const {runSectorFinalization}=require('./finalize-sector-surfaces');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'roa-finalization-check-'));
const saved=JSON.parse(fs.readFileSync(process.env.ROA_SURFACE_INPUT||path.join(root,'data/kromka/sector-surfaces.json')));
const valid=saved.profiles.find(p=>p.legacyDam);
assert(valid,'The real legacy dam profile is needed for the checkpoint scenario');
const copy=value=>JSON.parse(JSON.stringify(value));
const one=()=>({...copy(saved),profiles:[copy(valid)]});
const bad={zoneId:'z_99_99',locationId:'z_99_99'};
const checkpoints=path.join(temporary,'checkpoints'),checkpointFile=path.join(checkpoints,valid.zoneId+'.json');
let scenarios=0;
try {
  // Real source loading failure precedes a real successful sector. The source
  // files and geometry remain untouched; only the fixture refers to no file.
  const progress=[];
  const mixed={...copy(saved),profiles:[bad,copy(valid)]};
  const failed=finalizeSectorCatalog(mixed,{collectFailures:true,checkpointDir:checkpoints,onProgress:row=>progress.push(row)});
  assert.equal(failed.catalog,null);assert.equal(failed.failures.length,1);
  assert.equal(failed.failures[0].zoneId,bad.zoneId);
  assert(progress[0].failure.includes('ENOENT'));assert.equal(progress[0].failureCount,1);
  assert.equal(progress[1].failure,null);assert.equal(progress[1].completed,2);
  assert(fs.existsSync(checkpointFile));assert(!fs.existsSync(path.join(checkpoints,bad.zoneId+'.json')));
  assert.throws(()=>finalizeSectorCatalog({...copy(saved),profiles:[bad,copy(valid)]}),/ENOENT/);
  scenarios++;

  const replay=[];
  const complete=finalizeSectorCatalog(one(),{checkpointDir:checkpoints,onProgress:row=>replay.push(row)});
  assert(complete.catalog.sourceHash);assert.equal(replay[0].reused,true);
  const validCheckpoint=fs.readFileSync(checkpointFile,'utf8');
  fs.writeFileSync(checkpointFile,'{"schema":');
  const rebuilt=[];
  assert(finalizeSectorCatalog(one(),{collectFailures:true,checkpointDir:checkpoints,onProgress:row=>rebuilt.push(row)}).catalog);
  assert.equal(rebuilt[0].reused,false);assert(rebuilt[0].checkpointIssue);
  assert.equal(fs.readFileSync(checkpointFile,'utf8'),validCheckpoint);
  const damaged=JSON.parse(validCheckpoint);damaged.profile.testCorruption=true;
  fs.writeFileSync(checkpointFile,JSON.stringify(damaged));
  const repaired=finalizeSectorCatalog(one(),{checkpointDir:checkpoints});
  assert(!repaired.catalog.profiles[0].testCorruption);
  assert.equal(fs.readFileSync(checkpointFile,'utf8'),validCheckpoint);
  scenarios++;

  // An interrupted checkpoint replacement preserves the prior valid file.
  const originalRename=fs.renameSync;
  const changed=one();changed.profiles[0].testReplayVersion=1;
  let interrupted;
  fs.renameSync=(source,target)=>{if(target===checkpointFile)throw new Error('injected checkpoint rename failure');return originalRename(source,target);};
  try{interrupted=finalizeSectorCatalog(changed,{collectFailures:true,checkpointDir:checkpoints});}
  finally{fs.renameSync=originalRename;}
  assert.equal(interrupted.catalog,null);assert.match(interrupted.failures[0].message,/rename failure/);
  assert.equal(fs.readFileSync(checkpointFile,'utf8'),validCheckpoint);
  assert(!fs.readdirSync(checkpoints).some(file=>file.endsWith('.tmp')));
  assert(finalizeSectorCatalog(one(),{checkpointDir:checkpoints}).catalog);
  scenarios++;

  const atomic=path.join(temporary,'atomic.json');writeAtomicJson(atomic,{old:true});
  fs.renameSync=()=>{throw new Error('injected atomic rename failure');};
  try{assert.throws(()=>writeAtomicJson(atomic,{partial:true}),/rename failure/);}
  finally{fs.renameSync=originalRename;}
  assert.deepEqual(JSON.parse(fs.readFileSync(atomic)),{old:true});
  assert(!fs.readdirSync(temporary).some(file=>file.endsWith('.tmp')));
  writeAtomicJson(atomic,{complete:true});assert.deepEqual(JSON.parse(fs.readFileSync(atomic)),{complete:true});
  scenarios++;

  const input=path.join(temporary,'input.json'),output=path.join(temporary,'output.json'),diagnostic=path.join(temporary,'diagnostic.json');
  const absent=Array.from({length:196},(_,i)=>({zoneId:'z_'+String(30+Math.floor(i/20)).padStart(2,'0')+'_'+String(i%20).padStart(2,'0'),
    locationId:'z_'+String(30+Math.floor(i/20)).padStart(2,'0')+'_'+String(i%20).padStart(2,'0')}));
  const fixture={...copy(saved),profiles:[...absent,copy(valid)]};
  fs.writeFileSync(input,JSON.stringify(fixture));
  const originalInput=fs.readFileSync(input,'utf8');
  fs.writeFileSync(output,'{"previousSuccessfulCatalogue":true}');
  fs.writeFileSync(diagnostic,'{"status":"PASS","previous":true}');
  const result=runSectorFinalization(input,output,diagnostic,path.join(temporary,'cli-checkpoints'),{collectFailures:true});
  assert.equal(result.catalog,null);assert.equal(result.failures.length,196);
  assert(!fs.existsSync(output));assert.equal(JSON.parse(fs.readFileSync(diagnostic)).status,'FAIL');
  assert.equal(fs.readFileSync(input,'utf8'),originalInput);
  fs.writeFileSync(output,'{"previousSuccessfulCatalogue":true}');
  const cli=spawnSync(process.execPath,[path.join(root,'tools/finalize-sector-surfaces.js'),input,output,diagnostic],
    {env:{...process.env,ROA_FINALIZATION_COLLECT_FAILURES:'1'},encoding:'utf8',maxBuffer:2*1024*1024});
  assert.equal(cli.status,1,cli.stderr);assert(!fs.existsSync(output));
  assert.equal(JSON.parse(fs.readFileSync(diagnostic)).failures.length,196);
  scenarios++;

  // The full-world parallel entry point must aggregate source failures from
  // all three ordinary selected-zone workers and remove a stale catalogue.
  const parallelDiagnostic=path.join(temporary,'parallel-diagnostic.json');
  fs.writeFileSync(output,'{"previousSuccessfulCatalogue":true}');
  const parallel=spawnSync(process.execPath,[path.join(root,'tools/finalize-sector-surfaces-parallel.js'),
    input,output,parallelDiagnostic,path.join(temporary,'parallel-checkpoints'),'3'],
    {encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});
  assert.equal(parallel.status,1,parallel.stderr);
  assert(!fs.existsSync(output));
  const parallelReport=JSON.parse(fs.readFileSync(parallelDiagnostic));
  assert.equal(parallelReport.status,'FAIL');
  assert.equal(parallelReport.failures.length,196);
  assert.equal(fs.readFileSync(input,'utf8'),originalInput);
  scenarios++;

  assert.throws(()=>runSectorFinalization(input,input,diagnostic),/distinct files/);
  assert.throws(()=>runSectorFinalization(input,output,input),/distinct files/);
  assert.throws(()=>runSectorFinalization(input,output,output),/distinct files/);
  assert.equal(fs.readFileSync(input,'utf8'),originalInput);
  const aliasedInput=path.join(temporary,valid.zoneId+'.json');fs.writeFileSync(aliasedInput,originalInput);
  assert.throws(()=>runSectorFinalization(aliasedInput,output,diagnostic,temporary),/Checkpoint must not overwrite/);
  assert.equal(fs.readFileSync(aliasedInput,'utf8'),originalInput);
  fs.writeFileSync(input,'{"profiles":');fs.writeFileSync(output,'{"previousSuccessfulCatalogue":true}');
  assert.throws(()=>runSectorFinalization(input,output,diagnostic),SyntaxError);
  assert(!fs.existsSync(output));assert.equal(JSON.parse(fs.readFileSync(diagnostic)).status,'FAIL');
  scenarios++;
  console.log(JSON.stringify({status:'PASS',scenarios,continuedAfterFailure:true,checkpointRecovery:true,noStaleOutput:true,atomicWrites:true}));
} finally {
  assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));
  fs.rmSync(temporary,{recursive:true,force:true});
}
