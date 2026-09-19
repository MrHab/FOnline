'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const catalog = JSON.parse(read('data/kromka/locations.json'));
const seed = JSON.parse(read('data/kromka/world-layout.seed.json'));
const builder = read('unity-client/Assets/Editor/KromkaWorldSceneBuilder.cs');
const localComposer = read('unity-client/Assets/Editor/KromkaLocationSceneComposer.cs');
const locationDressing = read('unity-client/Assets/Editor/KromkaLocationDressing.cs');
const majadroidSourceAudit = read('unity-client/Assets/Editor/KromkaMajadroidSourceAudit.cs');
const quarryLicense = read('unity-client/Assets/ThirdParty/PolyHaven/QuarryWall02/README.md');
const sluiceConcreteLicense = read('unity-client/Assets/ThirdParty/PolyHaven/ConcreteWall009/README.md');
const kenneyFactoryLicense = read('unity-client/Assets/ThirdParty/Kenney/FactoryKit30/README.md');
const kenneyCityKitLicense = read('unity-client/Assets/ThirdParty/Kenney/CityKitIndustrial20/README.md');
const kenneyCarKitLicense = read('unity-client/Assets/ThirdParty/Kenney/CarKit31/README.md');
const kenneySpaceKitLicense = read('unity-client/Assets/ThirdParty/Kenney/SpaceKit10/README.md');
const sovietCc0License = read('unity-client/Assets/ThirdParty/SovietCC0/README.md');
const concreteBridgeLicense = read('unity-client/Assets/ThirdParty/OpenGameArt/ConcreteBridge/README.md');
const majadroidApocalypseLicense = read('unity-client/Assets/ThirdParty/OpenGameArt/MajadroidApocalypticBuildings/README.md');
const mehozavrUazLicense = read('unity-client/Assets/ThirdParty/OpenGameArt/MehozavrUaz452/README.md');
const exporter = read('unity-client/Assets/Editor/KromkaWorldSceneExporter.cs');
const sceneRuntime = read('unity-client/Assets/Scripts/World/RoaUnityLocationScene.cs');
const loader = read('unity-client/Assets/Scripts/World/RoaLocationLoader.cs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includes(source, tokens, label) {
  for (const token of tokens) {
    assert(source.includes(token), `${label}: missing ${token}`);
  }
}

assert(catalog.worldRevision === 'kromka-1', 'location catalog must be kromka-1');
assert(Array.isArray(catalog.locations) && catalog.locations.length >= 45,
  'Unity authoring must cover all Kromka locations (45 base + Сердцевина)');

const typeHandlers = new Map([
  ['tutorial', 'BuildTutorial'],
  ['settlement', 'BuildSettlement'],
  ['faction_capital', 'BuildFactionCapital'],
  ['caravan_hub', 'BuildCaravanHub'],
  ['road_outpost', 'BuildRoadOutpost'],
  ['industrial_site', 'BuildIndustrialSite'],
  ['resource_site', 'BuildResourceSite'],
  ['raid_complex', 'BuildRaidComplex'],
  ['mutant_lair', 'BuildMutantLair'],
  ['encounter_template', 'BuildEncounter'],
  ['boundary_expedition', 'BuildBoundary'],
  ['story_complex', 'BuildStoryComplex'],
  ['personal_base', 'BuildPersonalBase'],
  ['clan_base', 'BuildClanBase']
]);
for (const type of new Set(catalog.locations.map(row => row.locationType))) {
  const handler = typeHandlers.get(type);
  assert(handler && localComposer.includes(`case "${type}": ${handler}`),
    `no explicit editable Unity composition for location type ${type}`);
}

const regionMethods = new Map([
  ['northern_sluices', 'NorthernSluices'],
  ['middle_vein', 'MiddleVein'],
  ['ore_arc', 'OreArc'],
  ['tract_isthmus', 'TractIsthmus'],
  ['chalk_lowland', 'ChalkLowland'],
  ['glasslands', 'Glasslands'],
  ['zero_basin', 'ZeroBasin'],
  ['silent_ring', 'SilentRing']
]);
for (const region of catalog.regions) {
  assert(regionMethods.has(region.id), `unknown region ${region.id}`);
  assert(localComposer.includes(`case "${region.id}":`),
    `local visual language missing for ${region.id}`);
}

for (const location of catalog.locations) {
  const sceneName = location.id === 'wasteland' ? 'KromkaGloomDetour' : location.id;
  assert(location.unityScene === `Assets/Scenes/Kromka/Locations/${sceneName}.unity`,
    `location ${location.id} does not own an editable Unity scene path`);
  assert(Array.isArray(location.landmarkTags) && location.landmarkTags.length > 0,
    `location ${location.id} lacks a top-readable landmark`);
}

// Unity loads names case-insensitively; protect the bootstrap/local-scene boundary.
const buildSettings = read('unity-client/ProjectSettings/EditorBuildSettings.asset');
const buildScenes = [...buildSettings.matchAll(/enabled: 1\r?\n\s+path: (.+)/g)].map(match => match[1].trim());
const sceneNames = new Set();
for (const scenePath of buildScenes) {
  const name = path.basename(scenePath, '.unity').toLowerCase();
  assert(!sceneNames.has(name), `case-insensitive scene-name collision: ${scenePath}`);
  sceneNames.add(name);
}
for (const location of catalog.locations) {
  assert(buildScenes.includes(location.unityScene), `${location.id}: scene missing from Build Settings`);
  assert(fs.existsSync(path.join(root, 'unity-client', location.unityScene)), `${location.id}: scene asset missing`);
}
includes(read('unity-client/Assets/Scripts/Kromka/KromkaLocationSceneCatalog.cs'),
  ['locationId == "wasteland" ? "KromkaGloomDetour" : locationId'], 'wasteland scene alias');
// The editor world builder rewrites Build Settings; it must resolve scene paths
// through the same catalog alias, or a rebuild would re-list Locations/wasteland.unity.
includes(builder, ['KromkaLocationSceneCatalog.ScenePath(Text(row, "id"))'],
  'build settings follow the scene catalog alias');
assert(!builder.includes('Text(row, "id") + ".unity"'),
  'world builder must not derive Build Settings scene paths from raw location ids');

const gloomDetour = seed.locations.find(row => row.id === 'wasteland');
assert(gloomDetour && gloomDetour.x === 78 && gloomDetour.z === 65,
  'Gloom Detour must remain inside the visible south-western landmass');

includes(builder, [
  'BuildLocations(catalog, overwriteExisting)',
  'существующие ручные сцены',
  'EditorUtility.DisplayDialog("Пересобрать мир Кромки?"',
  'KromkaLocationSceneComposer.Compose',
  'KromkaLocationDressing.Compose',
  'BuildImportedGameplayObjects',
  'KromkaWorldSceneExporter.ExportLocationScene',
  'RoaUnityLocationObject'
], 'safe Unity scene builder');
includes(concreteBridgeLicense, [
  'https://opengameart.org/content/concrete-bridge',
  'Creative Commons Zero',
  'tbbk',
  'b3cb8b8feba0f6187297259746e3d403c18e3c154d406b79779f62cb06d54e9f'
], 'OpenGameArt concrete bridge provenance');
includes(majadroidSourceAudit, [
  'building-01.fbx',
  'building-07.fbx',
  'wreckage-3-types.fbx',
  'total_triangles=',
  'source_texture_bindings=',
  'majadroid-source-audit.txt'
], 'Majadroid source import audit');
includes(majadroidApocalypseLicense, [
  'https://opengameart.org/content/3d-apocalyptic-building-city-cc0',
  'Creative Commons Zero',
  'Majadroid',
  '4117BD1D2E815223762C1DBD53E80EE050F64ED7E2B4B43A2BC00EBF20B7DF6B'
], 'Majadroid apocalyptic-building provenance');
includes(mehozavrUazLicense, [
  'https://opengameart.org/content/uaz-452-utility-van-lowpoly',
  'Creative Commons Zero',
  'Mehozavr',
  'ADC0E41D50198F64B44C3A3C1266F478E444AED88C205AE4E0B12F6EE4B146B0'
], 'OpenGameArt Mehozavr UAZ-452 provenance');
includes(quarryLicense, [
  'https://polyhaven.com/a/quarry_wall_02',
  'Dimitrios Savva',
  'CC0 1.0 Universal',
  '2c8072f6752e7ad39827fc1fe32b2cd4',
  'b533faeb7d80eb9c3d9978908b796697',
  'd754560d668dc27d7db43838eabf95f3'
], 'Poly Haven Quarry Wall 02 provenance');
includes(sluiceConcreteLicense, [
  'https://polyhaven.com/a/concrete_wall_009',
  'Charlotte Baglioni',
  'CC0 1.0 Universal',
  'd6d3e7c2f475a43ee858cc82de533062',
  '90b0fc6f86c6bb04f15408fd9e2a50a3',
  'a24df87cbdc8c6ff8594c1d581e713d3'
], 'Poly Haven Concrete Wall 009 provenance');
includes(kenneyFactoryLicense, [
  'https://kenney.nl/assets/factory-kit',
  'Factory Kit 3.0',
  'Creative Commons Zero (CC0 1.0)',
  '7e31fb2308e90304672bd15cd18fa9d9f02c03731a8cbc57a8e3e1c181dfb0a7',
  'bff94ee097e29d7108c25145b2658ee64204e96edc6d2ac45a52a11aa98baa78',
  '64848ebf10a6e2889048398ae74ff27985a73243fdfedf1ba71e0727a507460f',
  '35d7bd6900dde0208429eeaec87fa17fbf024ed59f3f4eab54bc92802eba9dd7'
], 'Kenney Factory Kit 3.0 provenance');
includes(kenneyCityKitLicense, [
  'https://kenney.nl/assets/city-kit-industrial',
  'City Kit Industrial 2.0',
  'Creative Commons Zero (CC0 1.0)',
  '5b381164e5760f3830a2dbee43b972deee38b2a695d091b56e238ab2910c96d2',
  '1854cda5f4f87825efe792a399edf0fcc9f798b9f60845a983bbfc743e7a2849',
  '1676322390b68aa97ddbc7de1a0d87a0f1c3ef11034150ba2a237ec83100a09b',
  '8f6e7998bc075f176c2395a100c43344ed21f052587325c62402704d2b38d1ff'
], 'Kenney City Kit Industrial 2.0 provenance');
includes(kenneyCarKitLicense, [
  'https://kenney.nl/assets/car-kit',
  'Kenney Car Kit 3.1',
  'Creative Commons Zero (CC0 1.0)',
  'fac7dacac5c7874348cf19729af3ef205f3d366493edaf0a827d93f4fdf3d0c4',
  '3820fb12d04a558fe2a8eaecd988c8ee865ea3898817bf40089777d76b0c5a8e',
  'db74bb037db6d9bbeea0c2b7e627c37cbf85a96353bb0c7c92a8f4a5de246ede',
  '202d893c156e76dad189899e6ec59a319306538b726952b796ca6cd9ec649e25',
  'f3622a03a20c6696065cae9cbe391351be873508af190c2ebd1d420c055787a5'
], 'Kenney Car Kit 3.1 provenance');
includes(kenneySpaceKitLicense, [
  'https://kenney.nl/assets/space-kit',
  'Space Kit 1.0',
  'Creative Commons CC0 1.0 Universal',
  'D5D7CDF2635ED5A43A9187DEAF409B6F47484E402321128341D3C3698E9EF4D9',
  'AA47CDB4D99C85BDEAA44F37BCA8EFF5362A70658DF1198E3B908FA490BF54E4',
  '852281215D14E3DC24B90C22690B65160841036242DEBE4C50C919FC0D7A2DE2',
  '5D8C4D76E10555264863C5BF073DC89496D62E3BDACBF4925DAB7E53C8A105A3',
  '50DFB91A12AE5FAF182A8E4FD3520F62E784E0B4DF2BE20B4BDF18DB009CD33A'
], 'Kenney Space Kit 1.0 provenance');
includes(sovietCc0License, [
  'CC0 1.0',
  'soviet-panel-apartment-house-3d',
  'residential-building-lowpoly-apartment-block',
  'soviet-metal-garage-3d',
  'electrical-substation-3d',
  'post-soviet-fence-po-2-and-grate',
  'warehouse-building-low-poly',
  'creativecommons.org/publicdomain/zero/1.0'
], 'Soviet CC0 source provenance');

const positions = new Map(seed.locations.map(row => [row.id, row]));
for (const [id, x, z] of [
  ['sluiceCity', 186, 262],
  ['settlement', 195, 205],
  ['scrapTown', 76, 210],
  ['caravanCamp', 125, 155],
  ['relayStation', 284, 181],
  ['secondHaven', 297, 110],
  ['cascadeRegenerator', 205, 65]
]) {
  const point = positions.get(id);
  assert(point && point.x === x && point.z === z,
    `${id} must follow the approved full-region map at ${x}:${z}`);
}
for (const region of seed.regions.filter(row => !row.ring)) {
  assert(Array.isArray(region.unityBoundary) && region.unityBoundary.length >= 7,
    `${region.id} must use an authored irregular boundary`);
}
assert(positions.get('scrapTown').x < positions.get('settlement').x,
  'Ore Arc must remain west of the Middle Vein');
assert(positions.get('relayStation').x > positions.get('settlement').x,
  'Glasslands must remain east of the Middle Vein');
assert(positions.get('secondHaven').x > positions.get('settlement').x
  && positions.get('secondHaven').z < positions.get('settlement').z,
  'Chalk Lowland must remain south-east of the Middle Vein');

includes(localComposer, [
  'REGION_LANGUAGE_',
  'LOCATION_TYPE_',
  'KromkaPlacedObjectAuthoring',
  'RoaUnityLocationObject',
  'personal-build-socket',
  'clan-module-socket',
  'siege_approach',
  'training_range',
  'field_clinic',
  'community_yard',
  'impossible-geometry'
], 'editable local-scene grammar');

includes(locationDressing, [
  'ATMOSPHERIC_DRESSING_EDITABLE',
  'regional-dressing',
  'functional-dressing',
  'PrefabUtility.InstantiatePrefab',
  'KromkaPlacedObjectAuthoring',
  'RoaUnityLocationObject'
], 'editable regional dressing');

includes(exporter, [
  'Экспортировать открытую локацию в data',
  'definition["objects"] = exported',
  'definition["spawn"] = arrival.DeepClone()',
  'row["footprint"]',
  'row["unityAuthored"] = true',
  'ExportAnomalyLayout(authoring)'
], 'Unity-to-server spatial exporter');
includes(sceneRuntime, ['_replaceServerStaticGeometry = true', 'GroundRenderer', 'ReplaceServerStaticGeometry'],
  'Unity location runtime contract');
includes(loader, ['unityScene.GroundRenderer', 'unityScene.ReplaceServerStaticGeometry'],
  'Unity scene loading contract');

console.log(`Unity Kromka authoring OK: ${catalog.locations.length} editable local scenes, `
  + `${typeHandlers.size} location grammars, ${regionMethods.size} region languages and Unity-to-server export.`);
