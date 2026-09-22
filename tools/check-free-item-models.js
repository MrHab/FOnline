'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = json('public/assets/models/items/kromka/manifest.json');
const sources = json('source-assets/items/free-catalog-v1/sources.json').sources;
const items = json('data/kromka/items.json').items;
const artifacts = json('data/artifacts.json').types;
const client = read('unity-client/Assets/Scripts/Game/RoaItemModelCatalog.cs');
const ground = read('unity-client/Assets/Scripts/Game/RoaGroundItems.cs');

async function main() {
  const expected = ['artifactDetectorMk1','artifactDetectorMk2','artifactDetectorMk3',
    'artifactBelt2','artifactBelt3','artifactBelt4','artifactContainer','blue','medkit',
    ...artifacts.map(row => row.itemId), 'artifactUnknown'];
  assert.deepEqual(manifest.files.map(row => row.id).sort(), expected.sort());
  const version = '1-' + hash(manifest.files.map(row => row.sha256).join('')).slice(0, 8);
  assert.equal(manifest.version, version, 'Manifest content fingerprint');
  assert(client.includes(`CatalogVersion = "${version}"`), 'Unity uses the generated fingerprint');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let bytes = 0;
  for (const row of manifest.files) {
    const file = path.join(root, 'public', row.file);
    const data = fs.readFileSync(file);
    assert.equal(hash(data), row.sha256, `${row.id}: manifest hash`);
    assert.equal(data.length, row.bytes);
    assert(row.bytes < 500000, `${row.id}: mobile download budget`);
    assert.equal(row.presentationOnly, row.id === 'artifactUnknown');
    assert(row.presentationOnly || items.some(item => item.id === row.id), `${row.id}: unknown gameplay item`);
    assert(client.includes(`"${row.id}"`), `${row.id}: missing Unity lookup`);
    assert(row.sources.length, `${row.id}: no CC0 donor`);
    for (const used of row.sources) {
      const source = sources.find(s => s.id === used.id);
      assert(source && source.sha256 === used.sha256 && source.page === used.page, `${row.id}: provenance`);
      assert.equal(hash(fs.readFileSync(path.join(root, 'source-assets/items/free-catalog-v1', source.file))).toUpperCase(), source.sha256);
    }
    let originalSignature;
    for (const relative of [row.file, row.file.replace('/models/', '/models-lite/')]) {
      const doc = await io.read(path.join(root, 'public', relative));
      const scene = doc.getRoot();
      assert.equal(scene.listAnimations().length, 0, `${row.id}: static item must not animate detached parts`);
      assert.equal(scene.listSkins().length, 0, `${row.id}: rest-pose skin must be baked`);
      const nodes = scene.listNodes();
      const itemRoot = nodes.find(n => n.getName() === 'item_' + row.id);
      assert(itemRoot && itemRoot.getExtras().realm_item_id === row.id, `${row.id}: identity root`);
      const children = new Set();
      itemRoot.traverse(n => children.add(n));
      for (const n of nodes) if (n.getMesh()) assert(children.has(n), `${row.id}: detached mesh ${n.getName()}`);
      for (const socket of row.sockets) assert(nodes.some(n => n.getName() === socket), `${row.id}: missing ${socket}`);
      assert(!nodes.some(n => /Icosphere|glTF_not_exported/.test(n.getName())), `${row.id}: importer helper leaked`);
      let triangles = 0;
      const geometry = [];
      for (const mesh of scene.listMeshes()) for (const p of mesh.listPrimitives()) {
        const position = p.getAttribute('POSITION');
        assert(position && position.getCount() > 2, `${row.id}: empty geometry`);
        assert(Array.from(position.getArray()).every(Number.isFinite), `${row.id}: nonfinite geometry`);
        triangles += (p.getIndices()?.getCount() || position.getCount()) / 3;
        geometry.push(hash(Buffer.from(position.getArray().buffer)));
      }
      assert(triangles > 10 && triangles <= 12000, `${row.id}: triangle budget`);
      assert.equal(triangles, row.triangles, `${row.id}: generated geometry count`);
      const signature = geometry.sort().join(':');
      if (originalSignature) assert.equal(signature, originalSignature, `${row.id}: stale lite geometry`);
      originalSignature = signature;
      assert(scene.listTextures().length, `${row.id}: worn material textures absent`);
    }
    bytes += row.bytes;
  }
  // Test the authoritative 79-item catalog, not only the frozen legacy subset.
  const existing = ground.slice(ground.indexOf('HashSet<string> LibraryItems'), ground.indexOf('private string _status'));
  const existingIds = new Set([...existing.matchAll(/"([A-Za-z0-9]+)"/g)].map(m => m[1]));
  // Транспорт лежит на земле своей моделью из RoaVehicleCatalog; файлы проверяет check-ground-item-models.
  const vehicleIds = new Set([...read('unity-client/Assets/Scripts/Game/RoaVehicleCatalog.cs')
    .matchAll(/\{ "([A-Za-z0-9]+)", "[^"]+\.glb" \}/g)].map(m => m[1]));
  for (const item of items) {
    if (item.id === 'fists') continue;
    assert(existingIds.has(item.id) || vehicleIds.has(item.id) || manifest.files.some(r => r.id === item.id && !r.presentationOnly), `${item.id}: missing ground lookup`);
  }
  assert(ground.indexOf('RoaItemModelCatalog.Contains(itemId)') < ground.indexOf('if (LibraryItems.Contains(itemId))'), 'New medkit overrides old library');
  for (const type of artifacts) assert(client.includes(`case "${type.id}": return "${type.itemId}"`));
  assert(client.includes('default: return "artifactUnknown"'), 'Unidentified artifacts must preserve server identity restrictions');
  for (const name of ['RoaWeaponView','RoaOffhandWeaponView']) {
    const code = read(`unity-client/Assets/Scripts/Game/${name}.cs`);
    assert(code.includes('RoaItemModelCatalog.InstantiateInactive') && code.includes('MountMedicalCase'));
    assert(!code.includes('RoaTutorialProps.Build("medkit"'), `${name}: procedural medical case remains`);
  }
  const tutorial = read('unity-client/Assets/Scripts/Game/RoaTutorialProps.cs');
  const medicalBranch = tutorial.slice(tutorial.indexOf('if (kind == "medkit")'), tutorial.indexOf('else if (kind == "truck")'));
  assert(medicalBranch.includes('RoaItemPropView') && !medicalBranch.includes('PrimitiveType'), 'Tutorial medical prop uses the shared model, not cubes');
  console.log(`Free item models PASS: ${manifest.files.length} models, ${items.length - 1} physical gameplay item lookups, ${bytes} source GLB bytes; lite geometry, provenance, sockets, fingerprint verified.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
