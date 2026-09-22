'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {NodeIO}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const candidate=process.argv.includes('--candidate');
async function main() {
  const manifest=JSON.parse(read(candidate?'unity-client/Logs/UpperSuitCandidate/manifest.json':'public/assets/models/equipment/suits-v2/manifest.json'));
  const version='2-'+hash(manifest.files.map(r=>r.sha256).join('')).slice(0,8);
  assert.equal(manifest.version,version);
  const client=read('unity-client/Assets/Scripts/Game/RoaSuitModelCatalog.cs').toString();
  if(!candidate)assert(client.includes(`CatalogVersion = "${version}"`));
  // Телосложения больше нет: у каждого пола одна базовая модель.
  const bodies=['male_medium','female_medium'];
  assert.deepEqual(manifest.files.map(r=>r.itemId+'/'+r.bodyId).sort(),['hazmatSuit','energySuit'].flatMap(i=>bodies.map(b=>i+'/'+b)).sort());
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for(const row of manifest.files) {
    const label=row.itemId+'/'+row.bodyId;
    assert.equal(hash(read(candidate?row.candidateFile:'public'+row.file)),row.sha256,label);
    for(const ref of [row.source,row.bodyReference,row.retainedReference]) assert.equal(hash(read(ref.file)),ref.sha256,label+': stale reference');
    assert.equal(row.source.license,'CC0-1.0');
    if(row.legFit) {
      assert.equal(row.legFit.method,'donor-leg-side-v1',label+': original leg ownership');
      assert.equal(row.legFit.sameLegSkinSampling,true,label+': crossed cloth must keep its own leg skin');
      assert.equal(row.legFit.baseBodyHidden,false,label+': leg fit must not hide skin');
      assert(Number.isInteger(row.legFit.crossedMidlineSourceVertices) && row.legFit.crossedMidlineSourceVertices>=0);
      if(row.legFit.surfacePreparation) {
        const surface=row.legFit.surfacePreparation;
        assert.equal(surface.method,'fixed-tessellation-double-sided-dedup-v1');
        assert.equal(surface.verticesMoved,0,label+': duplicate cleanup must not deform cloth');
        assert(Number.isInteger(surface.removedDuplicateTriangles) && surface.removedDuplicateTriangles>=0);
        assert.equal(surface.sourceTriangles-surface.triangles,surface.removedDuplicateTriangles);
      }
    }
    if(row.jointLiner) {
      const liner=row.jointLiner;
      assert.equal(liner.baseBodyHidden,false,label+': liner must not hide the body');
      for(const field of ['maxRestSurfaceErrorMetres','maxStressSurfaceErrorMetres'])
        assert(Number.isFinite(liner[field]) && liner[field]<=.003,label+': '+field);
      assert(liner.triangles>0 && liner.triangles<=liner.sourceTriangles,label+': liner geometry');
      if(liner.spanBoundsMetres) {
        const spans=liner.spanBoundsMetres;
        assert(Object.values(spans).every(Number.isFinite),label+': textile span bounds');
        assert(spans.shoulderEnd-spans.elbowStart>=.02-1e-8 && spans.minimumOverlap===.02,
          label+': shoulder and elbow textile must overlap');
        assert(spans.elbowStart<spans.elbowEnd,label+': elbow interval');
      }
      if(liner.sourceSlitClosure) {
        const closure=liner.sourceSlitClosure;
        assert.equal(closure.baseBodyHidden,false,label+': slit closure must preserve the body');
        assert.equal(closure.closedSourceSlits,row.bodyId.startsWith('female')?2:0,
          label+': only the two female source-arm creases should close');
        assert.equal(closure.addedTriangles,closure.closedSourceSlits*3);
      }
      assert(row.gloveFit && row.gloveFit.baseHandsHidden===false,label+': fitted gloves required');
      assert(Number.isFinite(row.gloveFit.maxRestSurfaceErrorMetres)
        && row.gloveFit.maxRestSurfaceErrorMetres<=.001,label+': glove shape error');
      if(row.gloveFit.closedSourceBoundaryLoops) {
        assert(Number.isFinite(row.gloveFit.maxStressSurfaceErrorMetres)
          && row.gloveFit.maxStressSurfaceErrorMetres<=.001,label+': glove bent-surface error');
      }
      assert.equal(row.gloveFit.unsealedHandBoundaryEdges,0,label+': unsealed or unaudited glove seam');
      assert(Number.isFinite(row.gloveFit.maxSourceSlitWeldMetres)
        && row.gloveFit.maxSourceSlitWeldMetres<=.0002,label+': source seam weld exceeds 0.2 mm');
      for(const trial of [...liner.detailOptimization,...liner.shellOptimization]) if(trial.accepted) {
        assert(trial.sampledRestErrorMetres<=.001 && trial.sampledStressErrorMetres<=.001,
          label+': accepted accessory/shell reduction exceeds its surface budget');
      }
    }
    let signature;
    const files=candidate?[row.candidateFile]:['public'+row.file,'public'+row.file.replace('/models/','/models-lite/')];
    for(const file of files) {
      const doc=await io.read(path.join(root,file));
      const nodes=doc.getRoot().listNodes().filter(n=>n.getMesh());
      assert.equal(nodes.length,3,label+': shell, footwear and retained details');
      const footwear=nodes.filter(n=>n.getName().includes('builtin_footwear'));
      assert.equal(footwear.length,1);
      assert.equal(footwear[0].getExtras().realm_armor_layer,'builtin_footwear');
      assert.equal(doc.getRoot().listAnimations().length,0);
      let triangles=0;
      const geometry=[];
      for(const n of nodes) {
        assert(n.getSkin()); assert.equal(n.getSkin().listJoints().length,65);
        assert(!/body_base|Icosphere/.test(n.getName()));
        for(const p of n.getMesh().listPrimitives()) {
          triangles+=(p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount())/3;
          const weights=p.getAttribute('WEIGHTS_0').getArray();
          for(let i=0;i<weights.length;i+=4) assert(Math.abs(weights[i]+weights[i+1]+weights[i+2]+weights[i+3]-1)<1e-4);
          for(const semantic of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']) {
            const a=p.getAttribute(semantic).getArray();
            geometry.push(semantic+hash(Buffer.from(a.buffer,a.byteOffset,a.byteLength)));
          }
        }
      }
      assert.equal(triangles,row.triangles); assert(triangles<12000);
      const actual=geometry.sort().join(':'); if(signature)assert.equal(actual,signature,label+': stale lite'); signature=actual;
    }
  }
  console.log(candidate
    ? `Candidate layered suits PASS: ${manifest.files.length} isolated variants, source hashes, 65-bone skins, geometry budgets and version ${version}; not a runtime/lite approval.`
    : `Layered suits PASS: ${manifest.files.length} variants, distinct built-in footwear, source hashes, 65-bone skins, lite geometry and version ${version}.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
