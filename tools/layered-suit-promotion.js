'use strict';
// Preserve the exact reviewed GLBs; never regenerate different bytes at promotion.
// A matching native PASS is necessary, but callers must also inspect its captures.
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const bodies=['male_slim','male_medium','male_large','female_slim','female_medium','female_large'];
const items=['hazmatSuit','energySuit'];
const boots=['integrated','boots','scoutBoots','reinforcedBoots','assaultBoots'];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const expectedKeys=items.flatMap(item=>bodies.map(body=>item+'/'+body)).sort();

function clientSourceFingerprint(root) {
  const scripts=path.join(root,'unity-client/Assets/Scripts');
  const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>
    entry.isDirectory()?walk(path.join(directory,entry.name)):
      entry.name.endsWith('.cs')?[path.join(directory,entry.name)]:[]);
  return hash(walk(scripts).sort().map(file=>path.relative(scripts,file).replace(/\\/g,'/')
    +'='+hash(fs.readFileSync(file))+'\n').join(''));
}

function validateEvidence(manifest,coverage,native) {
  assert.deepEqual(manifest.files.map(row=>row.itemId+'/'+row.bodyId).sort(),expectedKeys,
    'A complete twelve-suit candidate is required');
  assert.equal(manifest.version,'2-'+hash(manifest.files.map(row=>row.sha256).join('')).slice(0,8));
  assert.equal(coverage.version,manifest.version,'Stale candidate coverage');
  assert.equal(coverage.upperBodyIncluded,true);
  assert.equal(coverage.coverageMask,'skin-ownership-v1');
  assert.equal(coverage.enclosureMethod,'near-surface-layered-rays-v2');
  assert.equal(coverage.surfaceSampling,'face-interior-vertex-edge-exterior-normal-v3');
  assert.deepEqual(coverage.rows.map(row=>row.itemId+'/'+row.bodyId+'/'+row.boots).sort(),
    expectedKeys.flatMap(key=>boots.map(boot=>key+'/'+boot)).sort(),'All 60 boot configurations are required');
  assert(coverage.rows.reduce((sum,row)=>sum+row.surfaceSamples,0)>=3800000,'Full surface sampling is required');
  const byKey=new Map(manifest.files.map(row=>[row.itemId+'/'+row.bodyId,row]));
  for(const row of coverage.rows) {
    const model=byKey.get(row.itemId+'/'+row.bodyId);
    assert.equal(row.suitSha256,model.sha256,'Coverage model changed');
    assert.equal(row.bodySha256,model.bodyReference.sha256,'Coverage body changed');
    assert.equal(row.uncoveredSamples,0,'Uncovered suit surface');
  }
  for(const model of manifest.files) {
    assert.equal(model.legFit?.sameLegSkinSampling,true,'Missing original-leg fitting');
    assert.equal(model.gloveFit?.unsealedHandBoundaryEdges,0,'Missing closed-glove evidence');
    assert.equal(model.jointLiner?.sourceSlitClosure?.closedSourceSlits,
      model.bodyId.startsWith('female')?2:0,'Missing source-arm closure');
  }
  assert.equal(native.result,'PASS','A successful native Unity candidate run is required');
  assert.equal(native.assetMode,'isolated-suit-candidate');
  assert.equal(native.servedSuitCatalogVersion,manifest.version,'Native Unity report is for another candidate');
  assert.deepEqual(native.servedSuitFiles.map(row=>[row.itemId+'/'+row.bodyId,row.sha256]).sort(),
    manifest.files.map(row=>[row.itemId+'/'+row.bodyId,row.sha256]).sort(),'Native model hashes changed');
  assert.deepEqual(native.suitBodies.map(row=>row.body).sort(),[...bodies].sort());
  for(const body of native.suitBodies) {
    assert.equal(body.suits,2); assert.equal(body.bootConfigurations,5);
    assert(body.animationPoses>=330 && body.animatedCaptures>=16 && body.upperMotionCaptures>=24,
      'Incomplete native animation captures');
    assert.equal(body.liveReloadCaptures,8,'Missing live reload evidence');
    assert.equal(body.restorationAndFog,true); assert.equal(body.loadedHoodHairLifecycle,true);
    assert(body.upperMotionClips.includes('walk') && body.upperMotionClips.includes('attack')
      && body.upperMotionClips.some(clip=>clip.startsWith('death')));
  }
  assert(/^[a-f0-9]{32}$/.test(native.runId),'Missing native run identity');
  assert(Number.isFinite(Date.parse(native.at)),'Missing native completion time');
  assert(/^[a-f0-9]{64}$/.test(native.clientSourceHash),'Missing native client-source fingerprint');
  assert.equal(native.clientSourceHashAtFinish,native.clientSourceHash,'Client source changed during native review');
}

function preparePromotion(workspace) {
  const root=path.resolve(workspace);
  const read=relative=>fs.readFileSync(path.join(root,relative));
  const candidateDir='unity-client/Logs/UpperSuitCandidate';
  const manifest=JSON.parse(read(candidateDir+'/manifest.json'));
  const coverage=JSON.parse(read('unity-client/Logs/layered-suit-upper-candidate-coverage.json'));
  const nativeBytes=read('unity-client/Logs/UpperSuitUnityReview/runtime/report.json');
  const native=JSON.parse(nativeBytes);
  validateEvidence(manifest,coverage,native);
  assert.equal(native.clientSourceHash,clientSourceFingerprint(root),'Native review uses outdated client code');
  const files=[];
  for(const row of manifest.files) {
    const filename=`equipment_${row.itemId}_${row.bodyId}.glb`;
    assert.equal(row.file,'/assets/models/equipment/suits-v2/'+filename,'Unexpected public model target');
    assert.equal(row.candidateFile,candidateDir+'/'+filename,'Unexpected candidate model path');
    const bytes=read(row.candidateFile);
    assert.equal(hash(bytes),row.sha256,'Candidate changed during review');
    for(const ref of [row.source,row.bodyReference,row.retainedReference])
      assert.equal(hash(read(ref.file)),ref.sha256,'Fitting/source reference changed');
    const views=JSON.parse(read(`unity-client/Logs/coverage-fit-arms-bent-hands-${row.itemId}-${row.bodyId}.json`));
    assert.equal(views.version,manifest.version); assert.equal(views.suitSha256,row.sha256);
    assert.equal(views.bodySha256,row.bodyReference.sha256);
    assert.equal(views.pose,'arms-bent'); assert.equal(views.includesHands,true);
    assert.deepEqual(views.views.map(view=>view.view).sort(),['back','front','left','right','underarm']);
    for(const view of views.views) assert.equal(view.bareSkinRays,0,'Visible bare seam in candidate');
    files.push({relative:'public'+row.file,bytes});
  }
  const publicManifest={...manifest,files:manifest.files.map(({candidateFile,...row})=>row),
    promotion:{method:'reviewed-candidate-copy-v1',nativeRunId:native.runId,nativeReportSha256:hash(nativeBytes)}};
  files.push({relative:'public/assets/models/equipment/suits-v2/manifest.json',
    bytes:Buffer.from(JSON.stringify(publicManifest,null,2)+'\n')});
  const cacheFile='unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs';
  // Include derived files and the cache source in rollback, even though the
  // existing optimizer/synchronizer (not this helper) updates those files.
  const targets=[...files.map(file=>file.relative),...manifest.files.map(row=>
    'public'+row.file.replace('/models/','/models-lite/')),cacheFile];
  const originals=targets.map(relative=>({relative,bytes:fs.existsSync(path.join(root,relative))?read(relative):null}));
  const backupRelative='unity-client/Logs/SuitPromotionBackup-'+crypto.randomUUID();
  const backup=path.join(root,backupRelative);
  let applied=false;
  function unchanged() {
    for(const original of originals) {
      const exists=fs.existsSync(path.join(root,original.relative));
      assert.equal(exists,original.bytes!==null,'Public files changed while preparing promotion');
      if(exists)assert(read(original.relative).equals(original.bytes),'Public files changed while preparing promotion');
    }
  }
  return {
    version:manifest.version,backup,
    apply() {
      unchanged();
      fs.mkdirSync(backup,{recursive:true});
      for(const original of originals) if(original.bytes!==null) {
        const target=path.join(backup,original.relative);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,original.bytes);
      }
      fs.writeFileSync(path.join(backup,'snapshot.json'),JSON.stringify({version:manifest.version,
        files:originals.map(row=>({file:row.relative,existed:row.bytes!==null,sha256:row.bytes?hash(row.bytes):null}))},null,2)+'\n');
      applied=true;
      for(const file of files) {
        const target=path.join(root,file.relative);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,file.bytes);
      }
    },
    rollback() {
      if(!applied)return;
      for(const original of originals) {
        const target=path.join(root,original.relative);
        if(original.bytes!==null)fs.writeFileSync(target,original.bytes);
        else if(fs.existsSync(target))fs.unlinkSync(target);
      }
      applied=false;
    },
    commit() {
      assert(applied,'Promotion was not applied');
      fs.writeFileSync(path.join(backup,'completed.json'),JSON.stringify({version:manifest.version,
        nativeRunId:native.runId,at:new Date().toISOString()},null,2)+'\n');
      applied=false;
    }
  };
}
module.exports={validateEvidence,preparePromotion,clientSourceFingerprint};
