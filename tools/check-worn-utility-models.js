'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative));
const json = relative => JSON.parse(read(relative));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const manifest = json('public/assets/models/equipment/utilities-v1/manifest.json');
const items = json('public/assets/models/items/kromka/manifest.json').files;
const bodies = ['male_slim','male_medium','male_large','female_slim','female_medium','female_large'];
const armors = ['none','leather','metalArmor','ballisticVest','combatArmor','heavyArmor','hazmatSuit','energySuit'];
const ids = ['artifactDetectorMk1','artifactDetectorMk2','artifactDetectorMk3','artifactBelt2','artifactBelt3','artifactBelt4'];
const key = r => `${r.itemId}/${r.bodyId}/${r.armorId}`;
async function main() {
  assert.equal(manifest.schema, 'realm.worn-utilities.v1');
  const expected = bodies.flatMap(bodyId => armors.flatMap(armorId => ids.map(itemId => key({ bodyId, armorId, itemId }))));
  assert.deepEqual(manifest.files.map(key).sort(), expected.sort());
  const version = '1-' + hash(manifest.files.map(r => r.sha256).join('')).slice(0,8);
  assert.equal(manifest.version, version);
  const client = read('unity-client/Assets/Scripts/Game/RoaWornUtilityCatalog.cs').toString();
  assert(client.includes(`CatalogVersion = "${version}"`));
  const equipment = read('unity-client/Assets/Scripts/Game/RoaEquipmentView.cs').toString();
  assert(equipment.includes('RoaWornUtilityCatalog.TryModelPath'));
  assert(equipment.includes('state.ArmorFit == armorFit'), 'Armor changes must invalidate the utility fit');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let bytes = 0;
  for (const row of manifest.files) {
    const label = key(row);
    assert(client.includes(`"${row.itemId}"`) && equipment.includes(`"${row.itemId}"`));
    assert.equal(row.slot, row.itemId.startsWith('artifactBelt') ? 'artifactBelt' : 'detector');
    assert.equal(row.file, `/assets/models/equipment/utilities-v1/equipment_${row.itemId}_${row.bodyId}_${row.armorId}.glb`);
    const data = read('public' + row.file);
    assert.equal(hash(data), row.sha256, label + ': generated hash');
    assert.equal(row.bytes, data.length);
    assert(row.bytes < 500000, label + ': mobile budget');
    assert.equal(row.sourceItem.sha256, items.find(i => i.id === row.itemId).sha256);
    assert.deepEqual(row.sources, items.find(i => i.id === row.itemId).sources);
    assert.equal(row.fittingReferences.length, row.armorId === 'none' ? 1 : 2);
    for (const ref of [row.sourceItem, ...row.fittingReferences]) assert.equal(hash(read(ref.file)), ref.sha256, label + ': stale fitting/source');
    let original;
    for (const file of [row.file, row.file.replace('/models/','/models-lite/')]) {
      const doc = await io.read(path.join(root,'public',file));
      const scene = doc.getRoot();
      assert.equal(scene.listAnimations().length,0);
      const nodes = scene.listNodes().filter(n => n.getMesh());
      assert(nodes.length);
      const signature = [];
      let triangles = 0;
      for (const n of nodes) {
        assert(n.getName().startsWith('utility_'+row.itemId), label + ': leaked body or donor');
        assert.equal(n.getExtras().realm_source_license,'CC0-1.0');
        const skin = n.getSkin(); assert(skin, label + ': disconnected static part');
        const joints = skin.listJoints(); assert.equal(joints.length,65);
        const pelvis = joints.findIndex(j => j.getName() === 'pelvis'); assert(pelvis >= 0);
        for (const p of n.getMesh().listPrimitives()) {
          const position = p.getAttribute('POSITION');
          triangles += (p.getIndices()?.getCount() || position.getCount()) / 3;
          const indices = p.getAttribute('JOINTS_0').getArray(), weights = p.getAttribute('WEIGHTS_0').getArray();
          for (let i=0;i<weights.length;i+=4) {
            let sum=0;
            for(let j=0;j<4;j++) { const w=weights[i+j]; assert(Number.isFinite(w) && w>=0); sum+=w; if(w>1e-6) assert.equal(indices[i+j],pelvis,label+': part not rigidly attached to pelvis'); }
            assert(Math.abs(sum-1)<1e-5);
          }
          for (const semantic of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']) {
            const array=p.getAttribute(semantic).getArray();
            signature.push(semantic+hash(Buffer.from(array.buffer,array.byteOffset,array.byteLength)));
          }
        }
      }
      assert.equal(triangles,row.triangles); assert(triangles>10 && triangles<12000);
      const value=signature.sort().join(':'); if(original) assert.equal(value,original,label+': stale lite'); original=value;
    }
    bytes += data.length;
  }
  console.log(`Worn utilities PASS: ${manifest.files.length} models, 6 bodies, 8 armor fits, ${bytes} bytes; source/fitting hashes, rigid pelvis skin and lite geometry verified.`);
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
