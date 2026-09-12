'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const root = path.resolve(__dirname, '..');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const accessorHash = accessor => {
  const array=accessor.getArray();
  return hash(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/models/equipment/free-v2/manifest.json')));
const bodies = ['female_large','female_medium','female_slim','male_large','male_medium','male_slim'];
const families = { backpack:'backpack', helmet:'helmet', tacticalHelmet:'helmet', assaultHelmet:'helmet',
  preWarHelmet:'helmet', weldedHelmet:'helmet', boots:'boots', scoutBoots:'boots', reinforcedBoots:'boots', assaultBoots:'boots' };
const donors = JSON.parse(fs.readFileSync(path.join(root,'source-assets/equipment/free-gear-v2/sources.json'))).sources;
async function main() {
  const fingerprint = '2-' + hash(manifest.files.map(r => r.sha256).join('')).slice(0,8);
  assert.equal(manifest.version, fingerprint);
  const client = fs.readFileSync(path.join(root,'unity-client/Assets/Scripts/Game/RoaEquipmentModelCatalog.cs'),'utf8');
  assert(client.includes(`CatalogVersion = "${fingerprint}"`), 'Equipment cache fingerprint stale');
  assert.deepEqual(manifest.files.map(r => r.itemId + ':' + r.bodyId).sort(),
    Object.keys(families).flatMap(id => bodies.map(b => id + ':' + b)).sort());
  for (const item of Object.keys(families)) assert(client.includes('"'+item+'"'), 'Missing replacement lookup '+item);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const row of manifest.files) {
    assert.equal(hash(fs.readFileSync(path.join(root,'public',row.file))),row.sha256);
    assert.equal(row.source.license,'CC0-1.0');
    assert.equal(row.slot,families[row.itemId]);
    assert.equal(row.file,`/assets/models/equipment/free-v2/equipment_${row.itemId}_${row.bodyId}.glb`);
    if (row.itemId === 'backpack') {
      assert.equal(hash(fs.readFileSync(path.join(root,'source-assets/items/free-catalog-v1/backpack.glb'))).toUpperCase(), row.source.sha256);
      assert.equal(hash(fs.readFileSync(path.join(root,row.retainedReference.file))),row.retainedReference.sha256);
    } else {
      const donor = donors.find(d => d.id === row.source.id);
      assert(donor, 'Unknown source '+row.source.id);
      assert.equal(row.source.file,donor.file);
      assert.equal(row.source.sha256,donor.sha256);
      assert.equal(row.source.page,donor.page);
      assert.equal(hash(fs.readFileSync(path.join(root,'source-assets/equipment/free-gear-v2',donor.file))).toUpperCase(), donor.sha256);
      assert.equal(hash(fs.readFileSync(path.join(root,row.fitReference.file))),row.fitReference.sha256);
      assert(row.sourceSelectedTriangles>0 && row.sourceSelection);
      if (row.slot === 'boots') {
        assert(row.fittingReferences?.length===1,'Boot envelope provenance missing');
        for (const ref of row.fittingReferences) assert.equal(hash(fs.readFileSync(path.join(root,ref.file))),ref.sha256);
      }
    }
    let original;
    for (const relative of [row.file,row.file.replace('/models/','/models-lite/')]) {
      const doc = await io.read(path.join(root,'public',relative));
      const catalog = doc.getRoot();
      assert.equal(catalog.listAnimations().length,0,'Equipment must use the player animation only');
      const joints = new Set(catalog.listSkins().flatMap(s => s.listJoints().map(j => j.getName())));
      assert.equal(joints.size,65,`${relative}: disconnected rig`);
      const geometry = [];
      let triangles = 0;
      for (const node of catalog.listNodes().filter(n => n.getMesh())) {
        assert(!/body_base|not_exported|helper/i.test(node.getName()),'Donor body/helper leaked into equipment');
        assert(node.getSkin(),`${relative}: unbound visible part ${node.getName()}`);
        assert.equal(node.getExtras().realm_item_id,row.itemId);
        assert.equal(node.getExtras().realm_body_id,row.bodyId);
        for (const p of node.getMesh().listPrimitives()) {
          const pos = p.getAttribute('POSITION');
          geometry.push(['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'].map(name => {
            const accessor=p.getAttribute(name);
            assert(accessor,`${relative}: missing ${name}`);
            return name+':'+accessorHash(accessor);
          }).join('|'));
          assert(p.getAttribute('JOINTS_0') && p.getAttribute('WEIGHTS_0'));
          const weights=p.getAttribute('WEIGHTS_0').getArray();
          for (let v=0;v<weights.length;v+=4) {
            const sum=weights[v]+weights[v+1]+weights[v+2]+weights[v+3];
            assert(Math.abs(sum-1)<.002,`${relative}: unweighted visible vertex`);
          }
          if (row.slot==='helmet') {
            const indices=p.getAttribute('JOINTS_0').getArray(), bones=node.getSkin().listJoints();
            for(let v=0;v<weights.length;v++) if(weights[v]>.00001)
              assert.equal(bones[indices[v]].getName(),'head','Rigid helmet has a foreign bone influence');
          }
          triangles += p.getIndices().getCount()/3;
        }
      }
      assert.equal(triangles,row.triangles);
      assert(triangles < 12000);
      const signature = geometry.sort().join(':');
      if (original) assert.equal(signature,original,'Stale lite replacement');
      original = signature;
      assert(catalog.listNodes().some(n => n.getName().includes(row.itemId==='backpack'?'downloaded_sack':`free_${row.itemId}_${row.bodyId}_downloaded_`)));
    }
  }
  console.log(`Free equipment PASS: ${manifest.files.length} models, 10 families on all 6 bodies, pinned CC0 sources, 65-bone binding, original/lite geometry and cache version.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
