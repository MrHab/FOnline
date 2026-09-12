'use strict';
// Pure inventory fixtures: no Unity launch, generated assets or fake approvals.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { assertPrefabInventory } = require('./check-unity-model-prefabs');
const models = Array.from({ length: 524 }, (_, i) => `equipment/model_${i}.glb`);
const prefabs = models.map(file => file.replace(/\.glb$/, '.prefab'));
assert.deepEqual(assertPrefabInventory(models, [...prefabs].reverse()), prefabs);
assert.deepEqual(assertPrefabInventory([...models, 'items/new.glb'], [...prefabs, 'items/new.prefab']),
  [...prefabs, 'items/new.prefab']);
assert.throws(() => assertPrefabInventory([], []), /inventory is empty/);
assert.throws(() => assertPrefabInventory(models, prefabs.slice(0, 141)), /383 missing/);
assert.throws(() => assertPrefabInventory(models, prefabs.slice(0, 202)), /322 missing/);
assert.throws(() => assertPrefabInventory(models, [...prefabs.slice(1), 'wrong.prefab']),
  /1 missing.*1 unexpected/);
assert.throws(() => assertPrefabInventory(models, [...prefabs, 'stale.prefab']), /1 unexpected/);
assert.throws(() => assertPrefabInventory([...models, models[0].toUpperCase()], prefabs),
  /duplicate canonical/);
assert.throws(() => assertPrefabInventory(models, [...prefabs, prefabs[0].toUpperCase()]),
  /duplicate Unity/);
const root = path.resolve(__dirname, '..');
const generator = fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/RoaModelPrefabGenerator.cs'), 'utf8');
const probe = fs.readFileSync(path.join(root,
  'unity-client/Assets/Editor/RoaModelPrefabCatalogProbe.cs'), 'utf8');
assert(generator.indexOf('ValidateSourceInventory(sourcePaths);') < generator.indexOf('EnsureFolder(PrefabRoot);'));
const cleanup = generator.indexOf('RemoveStalePrefabs(generated);');
for (const guard of ['if (failed > 0)', 'if (generated.Count != sourcePaths.Length)',
  'if (runtimeEntries.Count != RuntimeModelUrls.Count)']) {
  assert(generator.indexOf(guard) >= 0 && generator.indexOf(guard) < cleanup,
    'Generator must reject incomplete work before deleting stale prefabs: ' + guard);
}
assert(generator.includes('Directory.GetFiles(diskRoot') && generator.includes('expected.SequenceEqual(actual'));
assert(probe.includes('ValidateSourceInventory(sources)')
  && probe.includes('expectedPrefabs.SequenceEqual(actualPrefabs'));
assert(!probe.includes('ExpectedModelCount'));
console.log('Unity prefab inventory fixtures PASS: expanding exact-path coverage; missing/extra/duplicate rejection; native source guards and cleanup ordering. Native import still requires Unity verification.');
