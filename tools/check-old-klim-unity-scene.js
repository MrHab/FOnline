'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));
const legacyPattern = /^old_klim_.*\.glb$/i;

function legacyGlbs(...parts) {
  const directory = path.join(root, ...parts);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && legacyPattern.test(entry.name))
    .map(entry => path.join(directory, entry.name));
}

const runtimeGlbs = legacyGlbs('public', 'assets', 'models', 'wasteland');
const reviewGlbs = legacyGlbs('docs', 'art', 'reviews', 'old-klim-environment-kit-v1');
assert.deepStrictEqual(runtimeGlbs, [], 'Retired runtime Old Klim GLBs are still present');
assert.deepStrictEqual(reviewGlbs, [], 'Retired review Old Klim GLBs are still present');
assert(!exists('public', 'assets', 'models', 'wasteland', 'old-klim-environment-kit-manifest.json'),
  'Retired Old Klim GLB manifest is still present');

const location = JSON.parse(read('data', 'locations', 'settlement.json'));
const oldKlimObjects = location.objects.filter(entry => /^oldKlim/.test(String(entry.model || '')));
const oldKlimActors = location.objects.filter(entry => entry.id === 'old_klim'
  || /Стар(?:ый|ого) Клим/i.test(String(entry.name || '')));
assert.strictEqual(location.name, 'Ключи', 'The active settlement must use Kromka canon');
assert.strictEqual(location.worldRevision, 'kromka-1', 'The active settlement needs Kromka revision');
assert.strictEqual(location.runtimeMode, 'unity-authored', 'Unity must own settlement geometry');
assert(location.unityScene.endsWith('/Kromka/Locations/settlement.unity'),
  'The active settlement must load the Kromka scene');
assert.strictEqual(oldKlimObjects.length, 0,
  'Retired Old Klim geometry leaked back into the active Kromka settlement');
assert.strictEqual(oldKlimActors.length, 0,
  'Retired Old Klim actor leaked back into the active Kromka settlement');
assert(location.objects.some(entry => entry.id === 'irena_versta_belova'
  && entry.name === 'Ирена «Верста» Белова'),
  'Keys must spawn the canonical first guide instead of Old Klim');
// Ключи — город на весь сектор, разложенный в свою сцену: ориентир на площади и
// кварталы стоят вместо прежних одиночных построек посёлка.
assert(location.objects.some(entry => entry.id === 'plaza_landmark'),
  'the city of Keys has no landmark on its plaza');
for (const district of ['city-bank', 'city-market', 'city-workshop', 'city-homes']) {
  assert(location.objects.some(entry => (entry.tags || []).includes(district)),
    `Kromka settlement quarter is missing: ${district}`);
}

const generator = read('unity-client', 'Assets', 'Editor', 'RoaOldKlimSceneGenerator.cs');
for (const token of [
  'ShouldUseMep(entry)',
  'BuildMepVisual(entry',
  'BuildCanopy(root',
  'BrokenShack',
  'targetHeight / before.size.y',
  'MEP_Desert_Cliff_',
  'MEP_GroundRock_01_',
  'Autumn_N.prefab',
  'MEP_Grass_A_02_Dry.prefab',
  'MEP_Sky_03.mat',
  'BuildDefensivePerimeter(',
  'BuildSettlementGate(',
  'BuildBrahminPens(',
  'BuildGardens(',
  'BuildResidentialRow(',
  'BuildWorkshopShelter(',
  'StoneWall01',
  'Door01',
  'OldKlimCaravanPreviewEntry.png',
  'EditorSceneManager.CloseScene(existingTargetScene, true)',
  'EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive)',
  'AreaMask(wx, wz, 16.5f, 8f',
  'AreaMask(wx, wz, -14f, -15f',
  'Unapproved MEP substitution leaked into scene'
]) assert(generator.includes(token), 'Curated Unity scene generator is missing: ' + token);
assert((generator.match(/BuildWatchtower\(root, TerrainLocalPoint/g) || []).length === 4,
  'The defensive perimeter must build four towers in addition to the loading-yard tower');

const fallbackModels = [
  'tirestack', 'scrapheap', 'craftstationammo', 'craftstationweapon', 'craftstationtools',
  'craftstationrepair', 'craftstationenergy', 'craftstationchem', 'armoryrack', 'utilitypole',
  'ruinedbillboard', 'highwaysign', 'jobboard'
];
const shouldUseStart = generator.indexOf('private static bool ShouldUseMep');
const shouldUseEnd = generator.indexOf('private static void BuildMepVisual', shouldUseStart);
const shouldUseSource = generator.slice(shouldUseStart, shouldUseEnd).toLowerCase();
for (const model of fallbackModels)
  assert(!shouldUseSource.includes(model), 'Illogical MEP replacement was approved for ' + model);
assert(!location.objects.some(entry => ['scrapWatchtower', 'openScrapGate'].includes(entry.model)),
  'Retired procedural watchtower or gate still survives in the authored settlement');

const loader = read('unity-client', 'Assets', 'Scripts', 'World', 'RoaLocationLoader.cs');
assert(loader.includes('SceneManager.LoadSceneAsync(unitySceneName, LoadSceneMode.Additive)'),
  'Old Klim additive scene loading is missing');
assert(loader.indexOf('unityScene.TryGetObject(entry.Id')
  < loader.indexOf('if (string.IsNullOrEmpty(entry.Url)) { skipped++; continue; }'),
  'Unity scene objects are still gated by retired GLB URLs');

assert(exists('unity-client', 'Assets', 'Scenes', 'Locations', 'OldKlimCaravan.unity'),
  'Old Klim Unity scene is missing');
assert(exists('unity-client', 'Assets', 'Scenes', 'Locations', 'OldKlimCaravan', 'OldKlimTerrain.asset'),
  'Old Klim Unity TerrainData is missing');
const buildSettings = read('unity-client', 'ProjectSettings', 'EditorBuildSettings.asset');
assert(!buildSettings.includes('Assets/Scenes/Locations/OldKlimCaravan.unity'),
  'Archived Old Klim scene must not ship in the Kromka build');
assert(buildSettings.includes('Assets/Scenes/Kromka/Locations/settlement.unity'),
  'Kromka settlement scene is absent from build settings');
const webGlBuild = read('unity-client', 'Assets', 'Editor', 'RoaWebGlBuild.cs');
assert(webGlBuild.includes('EditorBuildSettings.scenes')
  && webGlBuild.includes('.Where(scene => scene.enabled)')
  && webGlBuild.includes('.Select(scene => scene.path)'),
  'WebGL build no longer includes the enabled additive Unity scenes');

const materialsDirectory = path.join(root, 'unity-client', 'Assets', 'Scenes', 'Locations',
  'OldKlimCaravan', 'Materials');
const materialCount = fs.readdirSync(materialsDirectory).filter(file => file.endsWith('.mat')).length;
assert(materialCount >= 10, 'Curated MEP URP material set is incomplete');

const colliderCatalog = read('public', 'assets', 'models', 'wasteland', 'model-colliders.json');
assert(!/"old_klim_.*\.glb"/i.test(colliderCatalog),
  'Collider catalog still contains removed Old Klim GLBs');

const packageJson = JSON.parse(read('package.json'));
assert(!packageJson.scripts['build:old-klim-environment'],
  'Retired Old Klim GLB build command is still active');
assert(packageJson.scripts['check:old-klim-unity-scene'],
  'Unity scene replacement check is missing');

console.log('Old Klim Unity scene OK: curated MEP architecture/nature, specialized GLB fallbacks, no retired generated GLBs');
