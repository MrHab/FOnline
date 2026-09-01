'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modelRoot = path.join(root, 'public', 'assets', 'models');
const prefabRoot = path.join(root, 'unity-client', 'Assets', 'Prefabs', 'Models');
const manifestPath = path.join(root, 'unity-client', 'Packages', 'manifest.json');
const lockPath = path.join(root, 'unity-client', 'Packages', 'packages-lock.json');
const catalogPath = path.join(root, 'unity-client', 'Assets', 'Resources',
  'RealmOfAshes', 'GlobalMapModelPrefabs.asset');
const expectedModelCount = 202;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory, extension, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) output.push(...walk(absolute, extension, relative));
    else if (name.toLowerCase().endsWith(extension)) output.push(relative);
  }
  return output;
}

function guidFromMeta(metaPath) {
  const match = fs.readFileSync(metaPath, 'utf8').match(/^guid:\s*([0-9a-f]{32})\s*$/m);
  return match ? match[1] : '';
}

function versionAtLeast(actual, minimum) {
  const left = String(actual).split('.').map(Number);
  const right = String(minimum).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0);
  }
  return true;
}

function expectedRuntimeUrls() {
  const urls = [
    '/assets/models/characters/npc/npc_humanoid_animations.glb',
    '/assets/models/wasteland/brahmin.glb',
    '/assets/models/wasteland/npc_ash_wolf.glb',
    '/assets/models/wasteland/npc_fire_gecko.glb',
    '/assets/models/wasteland/npc_gecko.glb',
    '/assets/models/wasteland/npc_ghoul.glb',
    '/assets/models/wasteland/npc_mutant_ant.glb',
    '/assets/models/wasteland/npc_radscorpion.glb',
    '/assets/models/wasteland/npc_super_mutant.glb'
  ];
  for (const sex of ['female', 'male']) {
    for (const body of ['large', 'medium', 'slim']) {
      urls.push(`/assets/models/characters/base/character_${sex}_${body}.glb`);
    }
  }
  return urls.sort();
}

function run() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(modelRoot, 'package.json'), 'utf8'));
  assert(packageJson.name === 'com.realmofashes.models',
    'public/assets/models is not the Realm of Ashes Unity package');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert(manifest.dependencies['com.realmofashes.models'] === 'file:../public/assets/models',
    'Unity does not reference the canonical shared model package');
  const gltfVersion = manifest.dependencies['com.unity.cloud.gltfast'];
  assert(versionAtLeast(gltfVersion, '6.15.0'),
    `glTFast ${gltfVersion} has the broken multi-primitive skinned editor importer`);
  assert(lock.dependencies['com.unity.cloud.gltfast']?.version === gltfVersion,
    'glTFast manifest and packages-lock versions differ');
  assert(lock.dependencies['com.realmofashes.models']?.source === 'local',
    'shared model package is not locked as a local Unity dependency');

  const models = walk(modelRoot, '.glb');
  const prefabs = walk(prefabRoot, '.prefab');
  assert(models.length === expectedModelCount,
    `expected ${expectedModelCount} canonical GLBs, found ${models.length}`);
  assert(prefabs.length === models.length,
    `expected ${models.length} Unity prefabs, found ${prefabs.length}`);

  const expectedPrefabs = models.map(relative => relative.replace(/\.glb$/i, '.prefab'));
  assert(JSON.stringify(prefabs) === JSON.stringify(expectedPrefabs),
    'Unity prefab tree does not exactly mirror public/assets/models');

  const sourceGuids = new Set();
  const prefabGuids = new Map();
  for (let i = 0; i < models.length; i++) {
    const relative = models[i];
    const modelPath = path.join(modelRoot, ...relative.split('/'));
    const modelMeta = `${modelPath}.meta`;
    const prefabPath = path.join(prefabRoot, ...expectedPrefabs[i].split('/'));
    const prefabMeta = `${prefabPath}.meta`;
    assert(fs.existsSync(modelMeta), `Unity importer metadata is missing: ${relative}.meta`);
    assert(fs.existsSync(prefabPath), `Unity prefab is missing: ${expectedPrefabs[i]}`);
    assert(fs.existsSync(prefabMeta), `Unity prefab metadata is missing: ${expectedPrefabs[i]}.meta`);

    const sourceGuid = guidFromMeta(modelMeta);
    const prefabGuid = guidFromMeta(prefabMeta);
    assert(sourceGuid && !sourceGuids.has(sourceGuid), `missing or duplicate model GUID: ${relative}`);
    sourceGuids.add(sourceGuid);
    assert(prefabGuid && !prefabGuids.has(prefabGuid),
      `missing or duplicate prefab GUID: ${expectedPrefabs[i]}`);
    prefabGuids.set(prefabGuid, expectedPrefabs[i]);

    const importer = fs.readFileSync(modelMeta, 'utf8');
    assert(/animationMethod:\s*1\b/.test(importer),
      `model is not imported with Legacy Animation: ${relative}`);
    assert(/nodeNameMethod:\s*1\b/.test(importer),
      `model does not preserve unique node names: ${relative}`);
    assert(/generateMipMaps:\s*1\b/.test(importer),
      `model does not generate mipmaps: ${relative}`);

    const prefab = fs.readFileSync(prefabPath, 'utf8');
    assert(prefab.includes('PrefabInstance:') && prefab.includes('m_SourcePrefab:'),
      `generated asset is not a linked Unity prefab variant: ${expectedPrefabs[i]}`);
    assert(prefab.includes(`guid: ${sourceGuid}`),
      `prefab lost its dependency on the canonical GLB: ${expectedPrefabs[i]}`);
  }

  const catalog = fs.readFileSync(catalogPath, 'utf8');
  const entries = [...catalog.matchAll(/- sourceUrl:\s*(\S+)\r?\n\s+prefab:.*guid:\s*([0-9a-f]{32})/g)]
    .map(match => ({ url: match[1], guid: match[2] }));
  const runtimeUrls = entries.map(entry => entry.url).sort();
  assert(JSON.stringify(runtimeUrls) === JSON.stringify(expectedRuntimeUrls()),
    `runtime global-map catalog is incomplete: found ${runtimeUrls.length} entries`);
  for (const entry of entries) {
    assert(prefabGuids.has(entry.guid), `catalog references a missing prefab: ${entry.url}`);
  }

  const generator = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Editor',
    'RoaModelPrefabGenerator.cs'), 'utf8');
  const actor = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game',
    'RoaGlobalMapActorView.cs'), 'utf8');
  const character = fs.readFileSync(path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game',
    'RoaCharacterView.cs'), 'utf8');
  assert(generator.includes('PREFAB GENERATION PASS')
      && generator.includes('ConfigureLegacyAnimation(sourcePaths)'),
    'deterministic Unity prefab generator is incomplete');
  assert(actor.includes('RoaModelPrefabCatalog.TryInstantiate')
      && character.includes('RoaModelPrefabCatalog.TryInstantiate')
      && character.includes('RoaModelPrefabCatalog.AnimationClips'),
    'global-map actors are not prefab-first with an animation catalog');

  console.log(`Unity model prefabs OK: ${models.length} linked prefabs, `
    + `${entries.length} runtime global-map models, glTFast ${gltfVersion}`);
}

if (require.main === module) run();

module.exports = { run };
