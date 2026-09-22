'use strict';
// Одежда и броня полным костюмом: манифесты, хэши, скин на 65 костей,
// отдельный слой обуви, запас треугольников и совпадение облегчённой копии с
// оригиналом. Всё, что тут проверяется, шьётся под наши две базовые модели.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const bodies = ['male_medium', 'female_medium'];

const families = [
  {
    title: 'кожаная броня набора',
    manifest: 'public/assets/models/equipment/outfits-v1/manifest.json',
    schema: 'realm.ubc-outfits.v1',
    version: 'OutfitVersion',
    items: ['leather'],
    nodes: [2, 2],
    triangles: 16000
  },
  {
    title: 'военная броня',
    manifest: 'public/assets/models/equipment/armor-v3/manifest.json',
    schema: 'realm.plated-armor.v1',
    version: 'PlatedVersion',
    items: ['ballisticVest', 'combatArmor', 'heavyArmor', 'metalArmor'],
    // У брони с пластинами к форме и обуви добавляется слой деталей.
    nodes: [2, 3],
    triangles: 12000
  }
];

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const client = read('unity-client/Assets/Scripts/Game/RoaOutfitModelCatalog.cs').toString();
  let total = 0;
  for (const family of families) {
    const manifest = JSON.parse(read(family.manifest));
    assert.equal(manifest.schema, family.schema);
    assert.equal(manifest.version, '1-' + hash(manifest.files.map(row => row.sha256).join('')).slice(0, 8),
      `${family.title}: версия манифеста не сходится с файлами`);
    assert(client.includes(`${family.version} = "${manifest.version}"`),
      `${family.title}: клиент просит устаревшую версию`);
    assert.deepEqual(manifest.files.map(row => row.itemId + '/' + row.bodyId).sort(),
      family.items.flatMap(item => bodies.map(body => item + '/' + body)).sort(),
      `${family.title}: набор вещей и тел`);

    for (const row of manifest.files) {
      const label = family.title + ' ' + row.itemId + '/' + row.bodyId;
      assert.equal(hash(read('public' + row.file)), row.sha256, label);
      assert.equal(hash(read(row.bodyReference.file)), row.bodyReference.sha256, label + ': устаревшая ссылка на тело');
      if (row.fit) {
        // Тело под одеждой остаётся видимым: примерка обязана держать кожу под
        // тканью, а не рассчитывать на скрытые части.
        assert.equal(row.fit.baseBodyHidden, false, label + ': примерка не должна прятать тело');
        assert(row.fit.skinPokes <= 80 && row.fit.deepestPokeMetres <= 0.005, label + ': тело просвечивает сквозь одежду');
      }

      let signature;
      for (const file of ['public' + row.file, 'public' + row.file.replace('/models/', '/models-lite/')]) {
        const document = await io.read(path.join(root, file));
        const nodes = document.getRoot().listNodes().filter(node => node.getMesh());
        assert(nodes.length >= family.nodes[0] && nodes.length <= family.nodes[1], label + ': состав слоёв');
        const footwear = nodes.filter(node => node.getName().includes('builtin_footwear'));
        assert.equal(footwear.length, 1, label + ': ровно один снимаемый слой обуви');
        assert.equal(footwear[0].getExtras().realm_armor_layer, 'builtin_footwear', label);
        assert.equal(document.getRoot().listAnimations().length, 0, label + ': анимации не едут с одеждой');
        let triangles = 0;
        const geometry = [];
        for (const node of nodes) {
          assert.equal(node.getSkin()?.listJoints().length, 65, label + ': скелет игрока из 65 костей');
          for (const primitive of node.getMesh().listPrimitives()) {
            triangles += (primitive.getIndices()?.getCount() || primitive.getAttribute('POSITION').getCount()) / 3;
            const weights = primitive.getAttribute('WEIGHTS_0').getArray();
            for (let i = 0; i < weights.length; i += 4) {
              assert(Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 1e-4,
                label + ': веса костей должны давать единицу');
            }
            for (const semantic of ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']) {
              const array = primitive.getAttribute(semantic).getArray();
              geometry.push(semantic + hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength)));
            }
          }
        }
        if (row.triangles) assert.equal(triangles, row.triangles, label + ': счёт треугольников в манифесте устарел');
        assert(triangles < family.triangles, label + ': сверх запаса треугольников');
        const actual = geometry.sort().join(':');
        if (signature) assert.equal(actual, signature, label + ': облегчённая копия устарела');
        signature = actual;
      }
      total += 1;
    }
  }
  console.log(`Outfits PASS: ${total} костюмов со штанами и снимаемой обувью на две базовые модели, `
    + 'скины на 65 костей, облегчённые копии и версии каталога.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
