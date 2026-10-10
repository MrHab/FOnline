'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {finalizeSectorCatalog}=require('./lib/sector-finalization');
const {writeAtomicJson}=require('./lib/sector-finalization-io');
function canonical(file) {
  const resolved=fs.existsSync(file)?fs.realpathSync(file):path.resolve(file);
  return process.platform==='win32'?resolved.toLowerCase():resolved;
}
function runSectorFinalization(input,output,diagnostic,checkpointDir,{collectFailures=false,onProgress}={}) {
  assert(input&&output&&diagnostic,'Usage: finalize-sector-surfaces input output diagnostic [checkpoint-directory]');
  assert.equal(new Set([input,output,diagnostic].map(canonical)).size,3,'Input, output and diagnostic must be distinct files');
  if(checkpointDir)assert(![input,output,diagnostic].some(file=>canonical(file)===canonical(checkpointDir)),
    'Checkpoint directory must be distinct from input, output and diagnostic');
  // A failed or interrupted replay must never leave yesterday's catalogue at
  // the requested publication path. Checkpoints remain available separately.
  const removeOutput=()=>{if(fs.existsSync(output))fs.unlinkSync(output);};
  const failureReport=failures=>({schema:'roa.sectorFinalizationFailures.v1',status:'FAIL',profiles:197,failures});
  removeOutput();
  try {
    writeAtomicJson(diagnostic,{schema:'roa.sectorFinalizationFailures.v1',status:'IN_PROGRESS',profiles:197},true);
    const content=fs.readFileSync(input),inputHash=crypto.createHash('sha256').update(content).digest('hex');
    const catalog=JSON.parse(content);
    assert.equal(catalog.profiles.length,197);assert.equal(new Set(catalog.profiles.map(p=>p.zoneId)).size,197);
    if(checkpointDir)for(const profile of catalog.profiles.filter(p=>/^z_\d{2}_\d{2}$/.test(p.zoneId))) {
      const checkpoint=path.join(checkpointDir,profile.zoneId+'.json');
      assert(![input,output,diagnostic].some(file=>canonical(file)===canonical(checkpoint)),
        'Checkpoint must not overwrite input, output or diagnostic: '+profile.zoneId);
    }
    const result=finalizeSectorCatalog(catalog,{collectPaths:true,collectFailures,checkpointDir,onProgress});
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),inputHash,'Geometry input changed during replay');
    if(!result.catalog) {writeAtomicJson(diagnostic,failureReport(result.failures),true);return result;}
    // Publish the complete catalogue only after its diagnostic has been saved.
    writeAtomicJson(diagnostic,{schema:'roa.interactionPathDiagnostics.v1',status:'PASS',sourceHash:result.catalog.sourceHash,rows:result.paths});
    writeAtomicJson(output,result.catalog);
    return result;
  } catch(error) {
    removeOutput();
    try{writeAtomicJson(diagnostic,failureReport([{zoneId:null,message:error.message}]),true);}
    catch(diagnosticError){error.message+='; diagnostic could not be saved: '+diagnosticError.message;}
    throw error;
  }
}
if(require.main===module) {
  const [input,output,diagnostic,checkpointDir]=process.argv.slice(2);
  try {
    const result=runSectorFinalization(input,output,diagnostic,checkpointDir,{collectFailures:process.env.ROA_FINALIZATION_COLLECT_FAILURES==='1',
      onProgress:row=>console.log(JSON.stringify(row))});
    if(!result.catalog){console.error(JSON.stringify({status:'FAIL',failures:result.failures.length,diagnostic}));process.exitCode=1;}
    else console.log(JSON.stringify({status:'PASS',profiles:197,paths:result.paths.length,sourceHash:result.catalog.sourceHash}));
  } catch(error){console.error(error.stack);process.exitCode=1;}
}
module.exports={runSectorFinalization};
