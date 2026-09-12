'use strict';
// Synthetic evidence is confined to a new temporary fixture project. It never
// creates or approves a report in the real Unity project.
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {validateEvidence,preparePromotion,clientSourceFingerprint}=require('./layered-suit-promotion');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const tempParent=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(tempParent,'roa-suit-promotion-fixture-'));
const write=(file,bytes)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);};
const json=(file,data)=>write(file,JSON.stringify(data));
const read=file=>fs.readFileSync(path.join(root,file));
try {
  const bodies=['male_slim','male_medium','male_large','female_slim','female_medium','female_large'];
  const boots=['integrated','boots','scoutBoots','reinforcedBoots','assaultBoots'];
  write('references/body.glb','synthetic body reference, not a model');
  write('unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs','const string CatalogVersion = "old";');
  const reference={file:'references/body.glb',sha256:hash(read('references/body.glb'))};
  const files=['hazmatSuit','energySuit'].flatMap(itemId=>bodies.map(bodyId=>{
    const filename=`equipment_${itemId}_${bodyId}.glb`;
    const bytes=Buffer.from('SYNTHETIC MODEL FIXTURE '+filename);
    const candidateFile='unity-client/Logs/UpperSuitCandidate/'+filename;
    const file='/assets/models/equipment/suits-v2/'+filename;
    write(candidateFile,bytes);write('public'+file,'old original '+filename);
    if(bodyId!=='male_slim')write('public'+file.replace('/models/','/models-lite/'),'old lite '+filename);
    return {itemId,bodyId,candidateFile,file,sha256:hash(bytes),bodyReference:reference,
      source:reference,retainedReference:reference,legFit:{sameLegSkinSampling:true},
      gloveFit:{unsealedHandBoundaryEdges:0},jointLiner:{sourceSlitClosure:{closedSourceSlits:bodyId.startsWith('female')?2:0}}};
  }));
  const manifest={version:'2-'+hash(files.map(row=>row.sha256).join('')).slice(0,8),files};
  const coverage={version:manifest.version,upperBodyIncluded:true,coverageMask:'skin-ownership-v1',
    enclosureMethod:'near-surface-layered-rays-v2',surfaceSampling:'face-interior-vertex-edge-exterior-normal-v3',
    rows:files.flatMap(row=>boots.map(boot=>({itemId:row.itemId,bodyId:row.bodyId,boots:boot,
      suitSha256:row.sha256,bodySha256:reference.sha256,surfaceSamples:64830,uncoveredSamples:0})))};
  const fingerprint=clientSourceFingerprint(root);
  const native={result:'PASS',assetMode:'isolated-suit-candidate',servedSuitCatalogVersion:manifest.version,
    servedSuitFiles:clone(files),runId:'f'.repeat(32),at:'2000-01-01T00:00:00Z',
    clientSourceHash:fingerprint,clientSourceHashAtFinish:fingerprint,
    suitBodies:bodies.map(body=>({body,suits:2,bootConfigurations:5,animationPoses:330,
      animatedCaptures:16,upperMotionCaptures:24,liveReloadCaptures:8,restorationAndFog:true,
      loadedHoodHairLifecycle:true,upperMotionClips:['walk','attack','death']}))};
  const manifestFile='unity-client/Logs/UpperSuitCandidate/manifest.json';
  const coverageFile='unity-client/Logs/layered-suit-upper-candidate-coverage.json';
  const nativeFile='unity-client/Logs/UpperSuitUnityReview/runtime/report.json';
  json(manifestFile,manifest);json(coverageFile,coverage);json(nativeFile,native);
  for(const row of files)json(`unity-client/Logs/coverage-fit-arms-bent-hands-${row.itemId}-${row.bodyId}.json`,
    {version:manifest.version,suitSha256:row.sha256,bodySha256:reference.sha256,includesHands:true,pose:'arms-bent',
      views:['front','back','left','right','underarm'].map(view=>({view,bareSkinRays:0}))});
  json('public/assets/models/equipment/suits-v2/manifest.json',{version:'old'});
  validateEvidence(manifest,coverage,native);
  for(const mutate of [
    n=>{n.servedSuitCatalogVersion='stale';},n=>{n.result='FAIL';},
    n=>{n.servedSuitFiles[0].sha256='0'.repeat(64);},n=>{n.suitBodies.pop();},
    n=>{n.suitBodies[0].loadedHoodHairLifecycle=false;},n=>{n.suitBodies[0].liveReloadCaptures=0;},
    n=>{n.clientSourceHashAtFinish='0'.repeat(64);}
  ]) {const altered=clone(native);mutate(altered);assert.throws(()=>validateEvidence(manifest,coverage,altered));}
  for(const mutate of [c=>c.rows.pop(),c=>{c.rows[0].uncoveredSamples=1;},
    c=>{c.surfaceSampling='face-centres-only';},c=>{c.rows[0].suitSha256='wrong';},
    c=>{for(const row of c.rows)row.surfaceSamples=1;}
  ]) {const altered=clone(coverage);mutate(altered);assert.throws(()=>validateEvidence(manifest,altered,native));}
  const oldOriginals=new Map(files.map(row=>['public'+row.file,read('public'+row.file)]));
  const oldCatalog=read('unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs');
  const unsafe=clone(manifest);unsafe.files[0].file='/../../outside.glb';json(manifestFile,unsafe);
  assert.throws(()=>preparePromotion(root),/Unexpected public model target/);json(manifestFile,manifest);
  write('unity-client/Assets/Scripts/ConcurrentChange.cs','synthetic changed client');
  assert.throws(()=>preparePromotion(root),/outdated client code/);
  fs.unlinkSync(path.join(root,'unity-client/Assets/Scripts/ConcurrentChange.cs'));
  const promotion=preparePromotion(root);
  promotion.apply();
  for(const row of files)assert.equal(hash(read('public'+row.file)),row.sha256);
  assert(!JSON.parse(read('public/assets/models/equipment/suits-v2/manifest.json')).files.some(row=>row.candidateFile));
  for(const row of files)write('public'+row.file.replace('/models/','/models-lite/'),'new derived fixture');
  write('unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs','new cache fixture');
  promotion.rollback();
  for(const [file,bytes] of oldOriginals)assert(read(file).equals(bytes),'Rollback original');
  for(const row of files) {
    const lite='public'+row.file.replace('/models/','/models-lite/');
    if(row.bodyId==='male_slim')assert(!fs.existsSync(path.join(root,lite)),'Rollback newly created lite');
    else assert.equal(read(lite).toString(),'old lite '+path.basename(row.file));
  }
  assert(read('unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs').equals(oldCatalog));
  assert.equal(JSON.parse(read('public/assets/models/equipment/suits-v2/manifest.json')).version,'old');
  const concurrent=preparePromotion(root);
  write('public'+files[0].file,'concurrent generated edit');
  assert.throws(()=>concurrent.apply(),/Public files changed/);
  write('public'+files[0].file,oldOriginals.get('public'+files[0].file));
  const committed=preparePromotion(root);committed.apply();committed.commit();committed.rollback();
  assert.equal(hash(read('public'+files[0].file)),files[0].sha256,'Committed models must remain');
  assert(fs.existsSync(path.join(committed.backup,'completed.json')));
  console.log('Suit promotion fixture PASS: exact bytes, complete/fresh native and surface evidence, path guards, concurrent edits, recoverable originals/lite/cache rollback and commit. Not native Unity approval.');
} finally {
  const resolved=fs.realpathSync(root);
  assert.equal(path.dirname(resolved),tempParent);
  assert(path.basename(resolved).startsWith('roa-suit-promotion-fixture-'));
  fs.rmSync(resolved,{recursive:true});
}
