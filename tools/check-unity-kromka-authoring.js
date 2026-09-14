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
const globalComposer = read('unity-client/Assets/Editor/KromkaGlobalMapSceneComposer.cs');
const globalRelief = read('unity-client/Assets/Editor/KromkaGlobalMapReliefAuthoring.cs');
const globalTextures = read('unity-client/Assets/Editor/KromkaGlobalMapTextureAuthoring.cs');
const globalWater = read('unity-client/Assets/Editor/KromkaGlobalMapWaterAuthoring.cs');
const globalRoutes = read('unity-client/Assets/Editor/KromkaGlobalMapRouteSurfaceAuthoring.cs');
const globalShorelines = read('unity-client/Assets/Editor/KromkaGlobalMapShorelineAuthoring.cs');
const globalOreStrata = read('unity-client/Assets/Editor/KromkaGlobalMapOreStrataAuthoring.cs');
const globalFusedGlass = read('unity-client/Assets/Editor/KromkaGlobalMapFusedGlassAuthoring.cs');
const globalChalkKarst = read('unity-client/Assets/Editor/KromkaGlobalMapChalkKarstAuthoring.cs');
const globalZeroDeposits = read('unity-client/Assets/Editor/KromkaGlobalMapZeroDepositsAuthoring.cs');
const globalSluiceWeathering = read('unity-client/Assets/Editor/KromkaGlobalMapSluiceWeatheringAuthoring.cs');
const globalFloodplain = read('unity-client/Assets/Editor/KromkaGlobalMapFloodplainAuthoring.cs');
const globalTractWear = read('unity-client/Assets/Editor/KromkaGlobalMapTractWearAuthoring.cs');
const globalSilentRing = read('unity-client/Assets/Editor/KromkaGlobalMapSilentRingAuthoring.cs');
const globalTransitionDeposits = read('unity-client/Assets/Editor/KromkaGlobalMapTransitionDepositsAuthoring.cs');
const globalFinalTexture = read('unity-client/Assets/Editor/KromkaGlobalMapFinalTextureAuthoring.cs');
const globalRockLandmarks = read('unity-client/Assets/Editor/KromkaGlobalMapRockLandmarkAuthoring.cs');
const globalTalus = read('unity-client/Assets/Editor/KromkaGlobalMapTalusAuthoring.cs');
const globalQuarryBenches = read('unity-client/Assets/Editor/KromkaGlobalMapQuarryBenchAuthoring.cs');
const globalSilentRingCliffs = read('unity-client/Assets/Editor/KromkaGlobalMapSilentRingCliffAuthoring.cs');
const globalNorthernSluices = read('unity-client/Assets/Editor/KromkaGlobalMapNorthernSluicesAuthoring.cs');
const globalOreIndustry = read('unity-client/Assets/Editor/KromkaGlobalMapOreIndustryAuthoring.cs');
const globalMiddleVeinSettlements = read('unity-client/Assets/Editor/KromkaGlobalMapMiddleVeinSettlementsAuthoring.cs');
const globalTractInfrastructure = read('unity-client/Assets/Editor/KromkaGlobalMapTractInfrastructureAuthoring.cs');
const globalGlasslandsScience = read('unity-client/Assets/Editor/KromkaGlobalMapGlasslandsScienceAuthoring.cs');
const globalGlasslandsLandmarks = read('unity-client/Assets/Editor/KromkaGlobalMapGlasslandsLandmarkAuthoring.cs');
const globalChalkLowlandSettlements = read('unity-client/Assets/Editor/KromkaGlobalMapChalkLowlandSettlementAuthoring.cs');
const globalListenersRavine = read('unity-client/Assets/Editor/KromkaGlobalMapListenersRavineAuthoring.cs');
const globalZeroCore = read('unity-client/Assets/Editor/KromkaGlobalMapZeroCoreAuthoring.cs');
const globalZeroOuter = read('unity-client/Assets/Editor/KromkaGlobalMapZeroOuterAuthoring.cs');
const globalHostileLandmarks = read('unity-client/Assets/Editor/KromkaGlobalMapHostileLandmarkAuthoring.cs');
const globalSilentRingOutpost = read('unity-client/Assets/Editor/KromkaGlobalMapSilentRingOutpostAuthoring.cs');
const globalRouteCrossings = read('unity-client/Assets/Editor/KromkaGlobalMapRouteCrossingAuthoring.cs');
const globalRoadBridges = read('unity-client/Assets/Editor/KromkaGlobalMapRoadBridgeAuthoring.cs');
const globalRiverClearanceAudit = read('unity-client/Assets/Editor/KromkaGlobalMapRiverClearanceAudit.cs');
const globalSilentRingDeadwood = read('unity-client/Assets/Editor/KromkaGlobalMapSilentRingDeadwoodAuthoring.cs');
const globalPowerCorridor = read('unity-client/Assets/Editor/KromkaGlobalMapPowerCorridorAuthoring.cs');
const globalRoadsideFinal = read('unity-client/Assets/Editor/KromkaGlobalMapRoadsideFinalAuthoring.cs');
const globalNativeModelMaterials = read('unity-client/Assets/Editor/KromkaGlobalMapNativeModelMaterialAuthoring.cs');
const globalSovietReplacements = read('unity-client/Assets/Editor/KromkaGlobalMapSovietReplacementAuthoring.cs');
const globalDustEffects = read('unity-client/Assets/Editor/KromkaGlobalMapDustEffectAuthoring.cs');
const globalFogEffects = read('unity-client/Assets/Editor/KromkaGlobalMapFogEffectAuthoring.cs');
const globalSmokeEffects = read('unity-client/Assets/Editor/KromkaGlobalMapSmokeEffectAuthoring.cs');
const globalToxicFogEffects = read('unity-client/Assets/Editor/KromkaGlobalMapToxicFogEffectAuthoring.cs');
const globalBoundary = read('unity-client/Assets/Editor/KromkaGlobalMapBoundaryAuthoring.cs');
const globalOuterWasteland = read('unity-client/Assets/Editor/KromkaGlobalMapOuterWastelandAuthoring.cs');
const globalOuterWasteland02 = read('unity-client/Assets/Editor/KromkaGlobalMapOuterWastelandIteration02Authoring.cs');
const majadroidSourceAudit = read('unity-client/Assets/Editor/KromkaMajadroidSourceAudit.cs');
const globalVisualDefectAudit = read('unity-client/Assets/Editor/KromkaGlobalMapVisualDefectAudit.cs');
const globalCapture = read('unity-client/Assets/Editor/KromkaSceneCapture.cs');
const runtimeGlobalMap = read('unity-client/Assets/Scripts/Game/RoaGlobalMap.cs');
const runtimeBoundary = read('unity-client/Assets/Scripts/World/RoaGlobalMapBoundary.cs');
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
const globalTerrainShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalTerrain.shader');
const roadDustShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaRoadDust.shader');
const lowFogShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaLowFog.shader');
const industrialSmokeShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaIndustrialSmoke.shader');
const toxicFogShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaToxicFog.shader');
const globalWaterShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalWater.shader');
const globalRouteShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalRoute.shader');
const globalShorelineShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalShoreline.shader');
const globalOreStrataShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalQuarryStrata.shader');
const globalFusedGlassShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalFusedGlass.shader');
const globalChalkKarstShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalChalkKarst.shader');
const globalZeroDepositsShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalZeroDeposits.shader');
const globalSluiceWeatheringShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalSluiceWeathering.shader');
const globalFloodplainShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalFloodplain.shader');
const globalTractWearShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalTractWear.shader');
const globalSilentRingShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalSilentRing.shader');
const globalTransitionDepositsShader = read('unity-client/Assets/Art/Kromka/Shaders/KromkaGlobalTransitionDeposits.shader');
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
assert(Array.isArray(catalog.locations) && catalog.locations.length === 45,
  'Unity authoring must cover all 45 Kromka locations');

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
  includes(globalComposer, [regionMethods.get(region.id) + '(', `${regionMethods.get(region.id)}_EDITABLE`],
    `global visual language ${region.id}`);
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
includes(globalRelief, ['ContainsMapPoint', 'OutlineRadius(angle)'],
  'global landmass containment helper');

includes(builder, [
  'SceneAssetExists(GlobalScenePath)',
  'BuildLocations(catalog, overwriteExisting)',
  'существующие ручные сцены',
  'EditorUtility.DisplayDialog("Пересобрать мир Кромки?"',
  'KromkaLocationSceneComposer.Compose',
  'KromkaLocationDressing.Compose',
  'KromkaGlobalMapSceneComposer.Compose',
  'BuildImportedGameplayObjects',
  'KromkaWorldSceneExporter.ExportLocationScene',
  'RoaUnityLocationObject'
], 'safe Unity scene builder');
includes(builder, [
  'RebuildGlobalMapFromSeed',
  'selectionRenderer.enabled = false',
  'row["unityBoundary"]',
  'BuildMapMarkerMeshes',
  'Kromka_MapMarker_Box.asset',
  'Kromka_MapMarker_Prism.asset',
  'Kromka_MapMarker_Beacon.asset',
  'MapMarkerObject',
  'MaterialForMap'
], 'lore map reconstruction pipeline');
assert(!builder.includes('BuildTesmaBanks')
  && !builder.includes('TesmaBank_')
  && !builder.includes('_LeftRail_')
  && !builder.includes('_RightRail_')
  && !builder.includes('_Tie_'),
  'floating cube riverbanks, rails and sleepers must not return to the map');
assert(!builder.includes('TesmaWater_'),
  'legacy rectangular Tesma water segments must not overlap the authored river mesh');
assert(!builder.includes('Kromka_RouteBed')
  && !builder.includes('Kromka_Route_road')
  && !builder.includes('Kromka_Route_rail_ballast')
  && !builder.includes('Kromka_Route_cascade_bank')
  && !builder.includes('Kromka_Route_cascade_canal'),
  'legacy route strips must not overlap the conforming MEP route surfaces');
assert(!builder.includes('Primitive("RegionGround_'),
  'rectangular colored region slabs must not return to the lore-first global map');

includes(globalComposer, [
  'ContinuousRelief_EDITABLE',
  'KromkaGlobalMapTextureAuthoring.BuildMaterial()',
  'KromkaGlobalMapFinalTextureAuthoring.Apply',
  'KromkaGlobalMapRockLandmarkAuthoring.Compose',
  'KromkaGlobalMapTalusAuthoring.Compose',
  'KromkaGlobalMapQuarryBenchAuthoring.Compose',
  'ComposeLoreInfrastructure',
  'KromkaGlobalMapMiddleVeinSettlementsAuthoring.Compose',
  'KromkaGlobalMapTractInfrastructureAuthoring.Compose',
  'KromkaGlobalMapGlasslandsScienceAuthoring.Compose',
  'KromkaGlobalMapGlasslandsLandmarkAuthoring.Compose',
  'KromkaGlobalMapChalkLowlandSettlementAuthoring.Compose',
  'KromkaGlobalMapListenersRavineAuthoring.Compose',
  'KromkaGlobalMapZeroCoreAuthoring.Compose',
  'KromkaGlobalMapZeroOuterAuthoring.Compose',
  'KromkaGlobalMapHostileLandmarkAuthoring.Compose',
  'KromkaGlobalMapSilentRingOutpostAuthoring.Compose',
  'KromkaGlobalMapRouteCrossingAuthoring.Compose',
  'KromkaGlobalMapRoadBridgeAuthoring.Compose',
  'KromkaGlobalMapPowerCorridorAuthoring.Compose',
  'KromkaGlobalMapRoadsideFinalAuthoring.Compose',
  'RestoredLoreInfrastructure_MANIFEST_REFERENCE',
  'FactoryKitIndustrialModels_RESTORED_REFERENCE',
  'CitiesAndSettlements_RESTORED_REFERENCE',
  'LoreLandmarks_RESTORED_REFERENCE',
  'PowerTransmissionLine_RESTORED_REFERENCE',
  'PersistentAtEveryZoom_REFERENCE',
  'KromkaGlobalMapSovietReplacementAuthoring.Compose',
  'KromkaGlobalMapSilentRingDeadwoodAuthoring.Compose',
  'Effects_EffectPass_EDITABLE',
  'KromkaGlobalMapDustEffectAuthoring.ComposeIteration01',
  'KromkaGlobalMapDustEffectAuthoring.ComposeIteration02',
  'KromkaGlobalMapDustEffectAuthoring.ComposeIteration03',
  'KromkaGlobalMapDustEffectAuthoring.ComposeIteration04',
  'KromkaGlobalMapDustEffectAuthoring.ComposeIteration05',
  'KromkaGlobalMapFogEffectAuthoring.ComposeIteration06',
  'KromkaGlobalMapFogEffectAuthoring.ComposeIteration07',
  'KromkaGlobalMapFogEffectAuthoring.ComposeIteration08',
  'KromkaGlobalMapFogEffectAuthoring.ComposeIteration09',
  'KromkaGlobalMapFogEffectAuthoring.ComposeIteration10',
  'KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration11',
  'KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration12',
  'KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration13',
  'KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration14',
  'KromkaGlobalMapSmokeEffectAuthoring.ComposeIteration15',
  'KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration16',
  'KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration17',
  'KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration18',
  'KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration19',
  'KromkaGlobalMapToxicFogEffectAuthoring.ComposeIteration20',
  'KromkaGlobalMapTransitionDepositsAuthoring.Compose',
  'KromkaGlobalMapWaterAuthoring.Compose',
  'KromkaGlobalMapShorelineAuthoring.Compose',
  'KromkaGlobalMapOreStrataAuthoring.Compose',
  'KromkaGlobalMapFusedGlassAuthoring.Compose',
  'KromkaGlobalMapChalkKarstAuthoring.Compose',
  'KromkaGlobalMapZeroDepositsAuthoring.Compose',
  'KromkaGlobalMapSluiceWeatheringAuthoring.Compose',
  'KromkaGlobalMapFloodplainAuthoring.Compose',
  'KromkaGlobalMapRouteSurfaceAuthoring.Compose',
  'KromkaGlobalMapTractWearAuthoring.Compose',
  'KromkaGlobalMapSilentRingAuthoring.Compose',
  'WaterSurfaces_TexturePass_EDITABLE',
  'ShorelineSurfaces_TexturePass_EDITABLE',
  'OreStrataSurfaces_TexturePass_EDITABLE',
  'FusedGlassSurfaces_TexturePass_EDITABLE',
  'ChalkKarstSurfaces_TexturePass_EDITABLE',
  'ZeroDepositSurfaces_TexturePass_EDITABLE',
  'SluiceWeatheringSurfaces_TexturePass_EDITABLE',
  'FloodplainSurfaces_TexturePass_EDITABLE',
  'RouteSurfaces_TexturePass_EDITABLE',
  'TractWearSurfaces_TexturePass_EDITABLE',
  'SilentRingSurfaces_TexturePass_EDITABLE',
  'TransitionDeposits_TexturePass_EDITABLE',
  'TextureIteration_20_of_20',
  'RetireLegacyMacroProxy',
  '"NorthernSluices"',
  '"MiddleVein"',
  '"OreArc"',
  '"TractIsthmus"',
  '"Glasslands"',
  '"ChalkLowland"',
  '"ZeroBasin"',
  '"SilentRing"',
  'LegacyPrimitiveProxyRemoved_REFERENCE'
], 'reference-driven global landscape');
assert(!globalComposer.includes('RetireSupersededModelPasses')
  && !globalComposer.includes('SupersededPrimitiveAndKenneyPasses_REMOVED_REFERENCE'),
  'restored lore infrastructure must not be replaced by retirement markers');
includes(globalRelief, [
  'ReliefIteration = 20',
  'ReliefIterationCount = 20',
  'KromkaLandmass_Relief_100pct',
  'FieldSamplesX = 191',
  'FieldSamplesY = 151',
  'WidthPoints = 380f',
  'HeightPoints = 300f',
  'Northern Sluices',
  'Ore Arc',
  'Glasslands',
  'Chalk Lowland',
  'Zero Basin',
  'Silent Ring',
  'NorthernDamFront',
  'Terraced01',
  'TesmaPath',
  'GlassFractureNorth',
  'WestDrainage',
  'EastDrainage',
  'SouthDrainage',
  'ChalkGullyNorth',
  'CentralOxbowWest',
  'NorthernServiceBench',
  'SluiceSpillway',
  'westReservoirRadius',
  'shelfFrontY',
  'OreHaulRampNorth',
  'OreHaulRampSouth',
  'OreTailingsNorth',
  'DistanceAndProgressToPolyline',
  'GlassFaultCentral',
  'GlassFaultEast',
  'OrientedPlateMask',
  'glassPlateNorthWest',
  'ChalkRidgeWest',
  'ChalkRidgeCentre',
  'ChalkRidgeSouth',
  'KarstBowl',
  'chalkFrontX',
  'ZeroWetlandSpine',
  'ZeroEastDrain',
  'zeroPoolCentre',
  'zeroDrainLevee',
  'outerBankDelta',
  'outerScarp',
  'ringClefts',
  'northPassShoulder',
  'TractMainEarthwork',
  'TractSouthBypass',
  'MiddleCanalWest',
  'MiddleCanalEast',
  'middleOuterTerrace',
  'tractCrown',
  'SilentRidgeNorthWest',
  'SilentRidgeEast',
  'SilentPassNorth',
  'SilentPassEast',
  'TesmaGradeAtY',
  'TesmaChannelWidthAtY',
  'tesmaFloodBowls',
  'SluiceMiddleApronWest',
  'OreMiddleApronNorth',
  'GlassMiddleBrokenFront',
  'ChalkZeroBrokenApron',
  'glassTransitionSaddles',
  'NaturalTerrace',
  'TerraceSpread',
  'strategic edge terraces',
  'ResourcePocket',
  'ImpactCrater',
  'ResearchApron',
  'OrientedRingMean',
  'every authored resource location',
  'TerrainAccessGrade',
  'TalusApron',
  'TalusCrossSlopeCrown',
  'NinthQuarryAccess',
  'IronMineAccess',
  'VectorResearchAccess',
  'StorehouseCraterAccess',
  'Colluvial fans',
  'RelictShoreline',
  'RelictShorelinePeak',
  'ErosionRibbon',
  'CrossSectionDepth',
  'OreStrataWashNorth',
  'GlassSplinterEast',
  'ChalkRunnelNorth',
  'ZeroSubsidenceEast',
  'SilentNorthEastRill',
  'recognisable geological handwriting',
  'HydraulicChannel',
  'WetlandShoreline',
  'WetlandShorelinePeak',
  'AlluvialSplay',
  'AlluvialDistributaryRelief',
  'SluiceCascadeWest',
  'ZeroPoolConnectorCentre',
  'ZeroTerminalBraidEast',
  'hydrological pass',
  'EdgeFootProfile',
  'AngularBump',
  'SideWallFloor',
  'RadialFootRelief',
  'FinalRegionalSurfaceRelief',
  'sector-dependent toe',
  'SaveRuntimeField'
], 'Kromka relief iteration 20');
includes(globalTextures, [
  'TextureIteration = 6',
  'TextureIterationCount = 20',
  'Kromka_GlobalTerrain_MEP.mat',
  'MEP_Ground_01_N_Dif.tga',
  'MEP_Dessert_Base_N.png',
  'MEP_Sand_03.png',
  'MEP_Ground_Snow_01_N.tga',
  'MEP_Sand_05.png',
  'ForestFloor_BL_Dif.tga',
  'MEP_Cliff_03_Terrain.png',
  'MEP_Soil_01_N_Dif.tga',
  'MEP_CaveGround_Dif_N.png',
  'MEP_Sand_N_Dif.tga',
  'ForestFloor_C_Dif.tga',
  'ValidateIteration06',
  '_MacroTiling',
  '_MacroBlend',
  '_MacroVariation',
  '_CliffTiling',
  '_SlopeStart',
  '_SlopeFull',
  '_WeatheringStart',
  '_WeatheringEnd',
  '_WeatheringStrength',
  '_RiverWetInner',
  '_RiverWetOuter',
  '_WetBlend',
  '_WetDarkening',
  '_BasinWetStrength',
  '_DepositTiling',
  '_DepositMacroTiling',
  '_DepositBreakup',
  '_OreDepositStrength',
  '_GlassDepositStrength',
  '_ChalkDepositStrength',
  '_PeatDepositStrength',
  '_BoundaryWarp',
  '_TransitionWidth',
  'eleven direct MEP terrain maps'
], 'Kromka texture iteration 06');
includes(globalWater, [
  'TextureIteration = 7',
  'TextureIterationCount = 20',
  'KromkaGlobalWater.shader',
  'MEP_Water_Placeholder_Nor.png',
  'Kromka_GlobalWater_Clean_MEP.mat',
  'Kromka_GlobalWater_Toxic_MEP.mat',
  'Kromka_GlobalWater_Karst_MEP.mat',
  'Kromka_GlobalWater_Clean.asset',
  'Kromka_GlobalWater_Toxic.asset',
  'Kromka_GlobalWater_Karst.asset',
  'CleanWater_SURFACE_MEP',
  'ToxicWater_SURFACE_MEP',
  'KarstWater_SURFACE_MEP',
  'TesmaRibbon_REFERENCE',
  'TesmaMountainHeadwaters_REFERENCE',
  'TesmaZeroBasinSink_REFERENCE',
  'SingleTesmaChannel_REFERENCE',
  'NorthernReservoirs_3_REFERENCE',
  'ZeroBasinPools_4_REFERENCE',
  'ChalkKarstWindows_6_REFERENCE',
  'AddRiver(TesmaPath',
  'MinimumDownhillGrade',
  'ValidateDownhillRiver',
  'floats above its terrain bed',
  'ValidateIteration07',
  'three WebGL-friendly water meshes'
], 'Kromka texture iteration 07 water authoring');
includes(globalWaterShader, [
  'Realm of Ashes/Kromka Global Water',
  '_NormalMap',
  '_ShallowColor',
  '_DeepColor',
  '_FoamColor',
  '_Opacity',
  '_NormalScale',
  '_NormalTiling',
  '_FlowSpeed',
  '_Smoothness',
  '_FresnelPower',
  '_MineralVeil',
  '_ToxicPulse',
  'UnpackNormalScale',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP global water shader');
includes(globalRoutes, [
  'TextureIteration = 9',
  'TextureIterationCount = 20',
  'KromkaGlobalRoute.shader',
  'MEP_Sand_N_Dif.tga',
  'MEP_StoneGround_Dif.png',
  'MEP_SandStone_Terrain.png',
  'MEP_Soil_01_N_Dif.tga',
  'MEP_Sand_03.tga',
  'Kromka_GlobalRoute_Shoulder_MEP.mat',
  'Kromka_GlobalRoute_Road_MEP.mat',
  'Kromka_GlobalRoute_Ballast_MEP.mat',
  'Kromka_GlobalRoute_Hydraulic_MEP.mat',
  'Kromka_GlobalRoute_Transitions_MEP.mat',
  'RouteShoulders_SURFACE_MEP',
  'RoadCores_SURFACE_MEP',
  'RailBallast_SURFACE_MEP',
  'HydraulicAprons_SURFACE_MEP',
  'RouteJunctionTransitions_SURFACE_MEP',
  'VisibleTransportRoutes_4_REFERENCE',
  'NorthernDamAprons_3_REFERENCE',
  'RouteWearPatterns_4_REFERENCE',
  'RouteJunctionTransitions_5_REFERENCE',
  'TesmaServiceRoad',
  'OreFreightRail',
  'MainTract',
  'ZeroServiceLine',
  'ValidateIteration09',
  'PatchAccumulator',
  'wheel ruts'
], 'Kromka texture iteration 09 route wear');
includes(globalRouteShader, [
  'Realm of Ashes/Kromka Global Route',
  '_MainTex',
  '_WearTex',
  '_Tint',
  '_WearTint',
  '_DetailTiling',
  '_MacroTiling',
  '_MacroBlend',
  '_Opacity',
  '_EdgeFade',
  '_WearTiling',
  '_WearStrength',
  '_Ruts',
  '_EdgeDust',
  '_WetLowlands',
  'rutBand',
  'edgeMineral',
  'lowland',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'smoothstep(0.0, _EdgeFade',
  'SampleSH'
], 'Kromka MEP global route shader');
includes(globalShorelines, [
  'TextureIteration = 10',
  'TextureIterationCount = 20',
  'KromkaGlobalShoreline.shader',
  'MEP_Sand_03.tga',
  'MEP_Soil_01_N_Dif.tga',
  'MEP_Dessert_Base_N.tga',
  'Kromka_GlobalShore_DryMineral_MEP.mat',
  'Kromka_GlobalShore_WetSilt_MEP.mat',
  'Kromka_GlobalShore_ToxicCrust_MEP.mat',
  'Kromka_GlobalShore_DryMineral.asset',
  'Kromka_GlobalShore_WetSilt.asset',
  'Kromka_GlobalShore_ToxicCrust.asset',
  'TesmaWetSiltBanks_SURFACE_MEP',
  'DryMineralWaterlines_SURFACE_MEP',
  'ToxicCrustWaterlines_SURFACE_MEP',
  'SingleTesmaSiltBanks_REFERENCE',
  'NorthernRelictWaterlines_3_REFERENCE',
  'ChalkKarstMineralRims_6_REFERENCE',
  'ZeroToxicCrustRims_4_REFERENCE',
  'AddRiverBanks',
  'AddPoolRing',
  'ValidateIteration10',
  'three direct 2048+ MEP surfaces'
], 'Kromka texture iteration 10 shoreline deposits');
includes(globalShorelineShader, [
  'Realm of Ashes/Kromka Global Shoreline',
  '_MainTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Breakup',
  '_Wetness',
  '_Toxicity',
  'deposit',
  'broken',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP global shoreline shader');
includes(globalOreStrata, [
  'TextureIteration = 11',
  'TextureIterationCount = 20',
  'KromkaGlobalQuarryStrata.shader',
  'MEP_Cliff_03_Sand_Terrain.tga',
  'MEP_StoneGround_Dif_Sand.png',
  'MEP_Sand_N_Dif.tga',
  'Kromka_GlobalOre_BenchStrata_MEP.mat',
  'Kromka_GlobalOre_Tailings_MEP.mat',
  'Kromka_GlobalOre_HaulDust_MEP.mat',
  'Kromka_GlobalOre_BenchStrata.asset',
  'Kromka_GlobalOre_Tailings.asset',
  'Kromka_GlobalOre_HaulDust.asset',
  'OreBenchStrata_SURFACE_MEP',
  'OreTailingsFans_SURFACE_MEP',
  'OreHaulRampDust_SURFACE_MEP',
  'OreBenchStrata_5_REFERENCE',
  'OreTailingsFans_2_REFERENCE',
  'OreHaulRamps_2_REFERENCE',
  'OreHaulRampNorth',
  'OreHaulRampSouth',
  'OreTailingsNorth',
  'OreTailingsSouth',
  'AddEllipticalBand',
  'AddTaperedRibbon',
  'ValidateIteration11',
  'three direct 2048 MEP rock'
], 'Kromka texture iteration 11 Ore Arc strata');
includes(globalOreStrataShader, [
  'Realm of Ashes/Kromka Global Quarry Strata',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Breakup',
  '_Oxide',
  '_Dust',
  'oxideMask',
  'fissure',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP quarry-strata shader');
includes(globalFusedGlass, [
  'TextureIteration = 12',
  'TextureIterationCount = 20',
  'KromkaGlobalFusedGlass.shader',
  'MEP_Ground_Snow_01_N.tga',
  'MEP_StoneGround_Dif.png',
  'Kromka_GlobalGlass_FusedSeams_MEP.mat',
  'Kromka_GlobalGlass_ThermalScorch_MEP.mat',
  'Kromka_GlobalGlass_FusedSeams.asset',
  'Kromka_GlobalGlass_ThermalScars.asset',
  'GlassFusedSeams_SURFACE_MEP',
  'GlassThermalScars_SURFACE_MEP',
  'GlassFractureNetwork_6_REFERENCE',
  'GlassImpactBasins_3_REFERENCE',
  'GlassFractureNorth',
  'GlassFractureSouth',
  'GlassFaultCentral',
  'GlassFaultEast',
  'GlassSplinterNorth',
  'GlassSplinterEast',
  'AddRibbon',
  'AddEllipticalBand',
  'ValidateIteration12',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 12 Glasslands fractures');
includes(globalFusedGlassShader, [
  'Realm of Ashes/Kromka Global Fused Glass',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Crystalline',
  '_Scorch',
  '_EmissionStrength',
  'crystalline',
  'scorchMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP fused-glass shader');
includes(globalChalkKarst, [
  'TextureIteration = 13',
  'TextureIterationCount = 20',
  'KromkaGlobalChalkKarst.shader',
  'MEP_Sand_05.png',
  'MEP_SandStone_Terrain.tga',
  'Kromka_GlobalChalk_RidgeBloom_MEP.mat',
  'Kromka_GlobalChalk_KarstRunoff_MEP.mat',
  'Kromka_GlobalChalk_SinkFlour_MEP.mat',
  'Kromka_GlobalChalk_RidgeBloom.asset',
  'Kromka_GlobalChalk_KarstRunoff.asset',
  'Kromka_GlobalChalk_SinkFlour.asset',
  'ChalkRidgeBloom_SURFACE_MEP',
  'ChalkKarstRunoff_SURFACE_MEP',
  'ChalkSinkFlour_SURFACE_MEP',
  'ChalkMineralRidges_3_REFERENCE',
  'ChalkKarstDrainage_4_REFERENCE',
  'ChalkSinkFlour_6_REFERENCE',
  'ChalkRidgeWest',
  'ChalkRidgeCentre',
  'ChalkRidgeSouth',
  'ChalkGullyNorth',
  'ChalkGullySouth',
  'ChalkRunnelNorth',
  'ChalkRunnelSouth',
  'AddRibbon',
  'AddEllipticalBand',
  'ValidateIteration13',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 13 Chalk Lowland karst');
includes(globalChalkKarstShader, [
  'Realm of Ashes/Kromka Global Chalk Karst',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_MineralStrength',
  '_Erosion',
  '_Dust',
  'mineral',
  'erosionMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP chalk-karst shader');
includes(globalZeroDeposits, [
  'TextureIteration = 14',
  'TextureIterationCount = 20',
  'KromkaGlobalZeroDeposits.shader',
  'ForestFloor_C_Dif.tga',
  'MEP_Soil_01_N_Dif.tga',
  'Kromka_GlobalZero_PeatSeams_MEP.mat',
  'Kromka_GlobalZero_ChemicalRunoff_MEP.mat',
  'Kromka_GlobalZero_OilStains_MEP.mat',
  'Kromka_GlobalZero_PeatSeams.asset',
  'Kromka_GlobalZero_ChemicalRunoff.asset',
  'Kromka_GlobalZero_OilStains.asset',
  'ZeroPeatSeams_SURFACE_MEP',
  'ZeroChemicalRunoff_SURFACE_MEP',
  'ZeroOilStains_SURFACE_MEP',
  'ZeroPeatSpines_2_REFERENCE',
  'ZeroChemicalChannels_5_REFERENCE',
  'ZeroIndustrialStains_3_REFERENCE',
  'ZeroWetlandSpine',
  'ZeroEastDrain',
  'ZeroPoolConnectorWest',
  'ZeroPoolConnectorCentre',
  'ZeroPoolConnectorEast',
  'ChemicalSpringSpill',
  'FuelRampLeak',
  'RegeneratorDrain',
  'BalanceSeep',
  'ValidateIteration14',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 14 Zero Basin deposits');
includes(globalZeroDepositsShader, [
  'Realm of Ashes/Kromka Global Zero Deposits',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Organic',
  '_Toxicity',
  '_Wetness',
  '_OilSheen',
  'organicMask',
  'chemicalMask',
  'sheen',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP Zero Basin deposit shader');
includes(globalSluiceWeathering, [
  'TextureIteration = 15',
  'TextureIterationCount = 20',
  'KromkaGlobalSluiceWeathering.shader',
  'MEP_StoneGround_Dif.png',
  'MEP_Cliff_03_Terrain.png',
  'Kromka_GlobalSluice_ConcreteApron_MEP.mat',
  'Kromka_GlobalSluice_WetBleed_MEP.mat',
  'Kromka_GlobalSluice_RustStreak_MEP.mat',
  'Kromka_GlobalSluice_ConcreteApron.asset',
  'Kromka_GlobalSluice_WetBleed.asset',
  'Kromka_GlobalSluice_RustStreak.asset',
  'SluiceConcreteAprons_SURFACE_MEP',
  'SluiceWetBleeds_SURFACE_MEP',
  'SluiceRustStreaks_SURFACE_MEP',
  'SluiceConcreteAprons_5_REFERENCE',
  'SluiceWetBleeds_6_REFERENCE',
  'SluiceRustStreaks_6_REFERENCE',
  'NorthernDamFront',
  'NorthernServiceBench',
  'SluiceSpillway',
  'SluiceCascadeWest',
  'SluiceCascadeEast',
  'RustStreaks',
  'ReservoirCentres',
  'ValidateIteration15',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 15 Northern Sluices weathering');
includes(globalSluiceWeatheringShader, [
  'Realm of Ashes/Kromka Global Sluice Weathering',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Wetness',
  '_Rust',
  '_Mineral',
  'wetMask',
  'rustMask',
  'mineralMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP Northern Sluices weathering shader');
includes(globalFloodplain, [
  'TextureIteration = 16',
  'TextureIterationCount = 20',
  'KromkaGlobalFloodplain.shader',
  'MEP_Grass_01_N_Dif.tga',
  'MEP_Ground_01_N_Dif.tga',
  'Kromka_GlobalMiddle_FloodSilt_MEP.mat',
  'Kromka_GlobalMiddle_FieldMosaic_MEP.mat',
  'Kromka_GlobalMiddle_TrampledGround_MEP.mat',
  'Kromka_GlobalMiddle_FloodSilt.asset',
  'Kromka_GlobalMiddle_FieldMosaic.asset',
  'Kromka_GlobalMiddle_TrampledGround.asset',
  'MiddleFloodSilt_SURFACE_MEP',
  'MiddleFieldMosaic_SURFACE_MEP',
  'MiddleTrampledGround_SURFACE_MEP',
  'MiddleFloodSilt_3_REFERENCE',
  'MiddleFieldPlots_8_REFERENCE',
  'MiddleInhabitedAprons_5_REFERENCE',
  'MiddleCanalWest',
  'MiddleCanalEast',
  'CentralOxbowWest',
  'FarmToKeys',
  'KeysToFilter',
  'FieldCentres',
  'ApronCentres',
  'AddEllipticalPatch',
  'ValidateIteration16',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 16 Middle Vein floodplain');
includes(globalFloodplainShader, [
  'Realm of Ashes/Kromka Global Floodplain',
  '_MainTex',
  '_SecondaryTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Fertility',
  '_Silt',
  '_Trample',
  '_Wetness',
  'growthMask',
  'wearMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP Middle Vein floodplain shader');
includes(globalTractWear, [
  'TextureIteration = 17',
  'TextureIterationCount = 20',
  'KromkaGlobalTractWear.shader',
  'MEP_Sand_03.tga',
  'MEP_Dessert_Base_N.tga',
  'MEP_StoneGround_Dif.png',
  'Kromka_GlobalTract_TrafficDust_MEP.mat',
  'Kromka_GlobalTract_WheelRuts_MEP.mat',
  'Kromka_GlobalTract_CaravanYards_MEP.mat',
  'Kromka_GlobalTract_BrokenSlabs_MEP.mat',
  'Kromka_GlobalTract_TrafficDust.asset',
  'Kromka_GlobalTract_WheelRuts.asset',
  'Kromka_GlobalTract_CaravanYards.asset',
  'Kromka_GlobalTract_BrokenSlabs.asset',
  'TractTrafficDust_SURFACE_MEP',
  'TractWheelRuts_SURFACE_MEP',
  'TractCaravanYards_SURFACE_MEP',
  'TractBrokenSlabs_SURFACE_MEP',
  'TractDustCorridors_3_REFERENCE',
  'TractWheelRutPairs_2_REFERENCE',
  'TractCaravanYards_6_REFERENCE',
  'TractBrokenSlabs_9_REFERENCE',
  'WesternApproach',
  'CrossroadsToKeys',
  'EasternDescent',
  'DepotBypass',
  'YardCentres',
  'SlabCentres',
  'AddRibbon',
  'AddPatch',
  'ValidateIteration17',
  'three direct high-resolution MEP'
], 'Kromka texture iteration 17 Tract traffic wear');
includes(globalTractWearShader, [
  'Realm of Ashes/Kromka Global Tract Wear',
  '_MainTex',
  '_SecondaryTex',
  '_AggregateTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Dust',
  '_Compaction',
  '_Ruts',
  '_Aggregate',
  'rutPair',
  'vergeDust',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP Tract-wear shader');
includes(globalSilentRing, [
  'TextureIteration = 18',
  'TextureIterationCount = 20',
  'KromkaGlobalSilentRing.shader',
  'MEP_CaveGround_Dif_N.png',
  'MEP_Cliff_03_Terrain.png',
  'MEP_Sand_05.png',
  'Kromka_GlobalSilent_AshMantle_MEP.mat',
  'Kromka_GlobalSilent_BurnArcs_MEP.mat',
  'Kromka_GlobalSilent_ErosionFans_MEP.mat',
  'Kromka_GlobalSilent_MineralEdges_MEP.mat',
  'Kromka_GlobalSilent_AshMantle.asset',
  'Kromka_GlobalSilent_BurnArcs.asset',
  'Kromka_GlobalSilent_ErosionFans.asset',
  'Kromka_GlobalSilent_MineralEdges.asset',
  'SilentAshMantle_SURFACE_MEP',
  'SilentBurnArcs_SURFACE_MEP',
  'SilentErosionFans_SURFACE_MEP',
  'SilentMineralEdges_SURFACE_MEP',
  'SilentAshMantle_1_REFERENCE',
  'SilentBurnArcs_12_REFERENCE',
  'SilentErosionFans_10_REFERENCE',
  'SilentMineralEdges_14_REFERENCE',
  'BurnArcDegrees',
  'MineralArcDegrees',
  'ErosionFanDegrees',
  'AddArc',
  'AddRadialFan',
  'ValidateIteration18',
  'three direct high-resolution MEP'
], 'Kromka texture iteration 18 Silent Ring deposits');
includes(globalSilentRingShader, [
  'Realm of Ashes/Kromka Global Silent Ring',
  '_MainTex',
  '_SecondaryTex',
  '_MineralTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Ash',
  '_Burn',
  '_Erosion',
  '_Mineral',
  'ashMask',
  'scorchMask',
  'erosionMask',
  'mineralMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP Silent Ring shader');
includes(globalTransitionDeposits, [
  'TextureIteration = 19',
  'TextureIterationCount = 20',
  'KromkaGlobalTransitionDeposits.shader',
  'MEP_Ground_01_N_Dif.tga',
  'MEP_StoneGround_Dif.png',
  'MEP_Sand_05.png',
  'Kromka_GlobalTransition_SluiceWash_MEP.mat',
  'Kromka_GlobalTransition_OreColluvium_MEP.mat',
  'Kromka_GlobalTransition_GlassScree_MEP.mat',
  'Kromka_GlobalTransition_ChalkFlour_MEP.mat',
  'Kromka_GlobalTransition_SluiceWash.asset',
  'Kromka_GlobalTransition_OreColluvium.asset',
  'Kromka_GlobalTransition_GlassScree.asset',
  'Kromka_GlobalTransition_ChalkFlour.asset',
  'TransitionSluiceWash_SURFACE_MEP',
  'TransitionOreColluvium_SURFACE_MEP',
  'TransitionGlassScree_SURFACE_MEP',
  'TransitionChalkFlour_SURFACE_MEP',
  'TransitionSluiceAprons_2_REFERENCE',
  'TransitionOreTongues_2_REFERENCE',
  'TransitionGlassFronts_3_REFERENCE',
  'TransitionChalkApron_1_REFERENCE',
  'SluiceMiddleApronWest',
  'SluiceMiddleApronEast',
  'OreMiddleApronNorth',
  'OreMiddleApronSouth',
  'GlassMiddleFronts',
  'ChalkZeroBrokenApron',
  'AddTaperedRibbon',
  'AddPatch',
  'ValidateIteration19',
  'three direct high-resolution MEP'
], 'Kromka texture iteration 19 regional transitions');
includes(globalTransitionDepositsShader, [
  'Realm of Ashes/Kromka Global Transition Deposits',
  '_MainTex',
  '_SecondaryTex',
  '_MineralTex',
  '_Tint',
  '_DarkTint',
  '_DetailTiling',
  '_MacroTiling',
  '_Opacity',
  '_EdgeFade',
  '_Oxide',
  '_WetWash',
  '_GlassDust',
  '_ChalkDust',
  'oxideMask',
  'wetMask',
  'glassMask',
  'chalkMask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off'
], 'Kromka MEP regional-transition shader');
includes(globalFinalTexture, [
  'TextureIteration = 20',
  'TextureIterationCount = 20',
  'KromkaGlobalTerrain.shader',
  'Kromka_GlobalTerrain_MEP.mat',
  'MEP_CaveGround_Dif_N.png',
  'MEP_Sand_N_Dif.tga',
  '_PatinaTex',
  '_MicroDustTex',
  '_PatinaTiling',
  '_PatinaMacroTiling',
  '_PatinaStrength',
  '_ChromaticCompression',
  '_DustVeil',
  '_WashContrast',
  'FinalTexture_MicroPatina_2MEP_REFERENCE',
  'FinalTexture_ChromaticCalibration_REFERENCE',
  'FinalTexture_WashVariation_REFERENCE',
  'ValidateIteration20',
  'two direct high-resolution MEP'
], 'Kromka texture iteration 20 final calibration');
includes(globalRockLandmarks, [
  'ModelIteration = 1',
  'ModelIterationCount = 20',
  'Assets/MEP/MEP_Environment/MEP_Rocks/',
  'MEP_Desert_Cliff_02.prefab',
  'MEP_Desert_Cliff_06.prefab',
  'MEP_Rock_01_N_d_Sand.prefab',
  'MEP_Rock_03_b_Sand.prefab',
  'MEP_Rock_04_b_Sand.prefab',
  'MEP_Rock_05_h_Sand.prefab',
  'OreArc_LargeRockLandmarks_MEP',
  'SilentRing_LargeRockLandmarks_MEP',
  'LargeRockLandmarks_17_REFERENCE',
  'DirectMEPRockPrefabs_13_REFERENCE',
  'PersistentHighestDetailLOD_REFERENCE',
  'ModelIteration_01_of_20',
  'KeepHighestDetailAtEveryDistance',
  'DisableInteractionColliders',
  'ValidateIteration01',
  '[KROMKA MODELS 5%] PASS'
], 'Kromka model iteration 01 large rock landmarks');
includes(globalTalus, [
  'ModelIteration = 2',
  'ModelIterationCount = 20',
  'ExpectedPieceCount = 52',
  'MEP_GroundRock_01_a.prefab',
  'MEP_GroundRock_01_k.prefab',
  'MEP_Stone_06.prefab',
  'MEP_Stone_09.prefab',
  'MEP_Stone_12.prefab',
  'MEP_StoneGround_a_Sand.prefab',
  'OreArc_DirectionalTalus_MEP',
  'SilentRing_SparseTalus_MEP',
  'DirectionalTalusFans_17_REFERENCE',
  'MediumTalusPieces_52_REFERENCE',
  'DirectMEPTalusPrefabs_9_REFERENCE',
  'ModelIteration_02_of_20',
  'InstantiateMepRock',
  'ValidateIteration02',
  '[KROMKA MODELS 10%] PASS'
], 'Kromka model iteration 02 directional talus');
includes(globalQuarryBenches, [
  'ModelIteration = 3',
  'ModelIterationCount = 20',
  'ExpectedBenchCount = 3',
  'ExpectedAccentCount = 12',
  'SamplesPerBench = 96',
  'MEP_Dirtedge_Straight.prefab',
  'MEP_Dirtedge_Curve_Out.prefab',
  'MEP_Dirtedge_Curve_In.prefab',
  'quarry_wall_02_diff_2k.jpg',
  'quarry_wall_02_nor_gl_2k.jpg',
  'quarry_wall_02_ao_2k.jpg',
  'Kromka_QuarryBench_PolyHaven_MEP.mat',
  'OreArc_OpenPitBenchTiers_MEP',
  'ContinuousBenchMeshes_EDITABLE',
  'MepEdgeAccents_EDITABLE',
  'QuarryBenchMeshes_3_REFERENCE',
  'QuarryBenchAccents_12_REFERENCE',
  'DirectMEPDirtEdgePrefabs_3_REFERENCE',
  'PolyHavenQuarryWall02_CC0_REFERENCE',
  'HaulRampGaps_2_REFERENCE',
  'ModelIteration_03_of_20',
  'BuildBenchMesh',
  'Kromka_QuarryBench_',
  'ValidateIteration03',
  '[KROMKA MODELS 15%] PASS'
], 'Kromka model iteration 03 open-pit quarry benches');
includes(globalSilentRingCliffs, [
  'ModelIteration = 4',
  'ModelIterationCount = 20',
  'ExpectedLinkCount = 8',
  'PiecesPerLink = 4',
  'ExpectedPieceCount = ExpectedLinkCount * PiecesPerLink',
  'Cliff_02_01_N.prefab',
  'Cliff_02_02_N.prefab',
  'Cliff_02_03_N.prefab',
  'Cliff_03_02_N.prefab',
  'Cliff_03_04_N.prefab',
  'Cliff_03_06_N.prefab',
  'SilentRing_BrokenCliffChain_MEP',
  'SilentRingCliffLinks_8_REFERENCE',
  'BrokenCliffPieces_32_REFERENCE',
  'DirectMEPCliffPrefabs_6_REFERENCE',
  'StrategicGaps_8_REFERENCE',
  'ModelIteration_04_of_20',
  'InstantiateMepRock',
  'ValidateIteration04',
  '[KROMKA MODELS 20%] PASS'
], 'Kromka model iteration 04 broken Silent Ring cliffs');
includes(globalNorthernSluices, [
  'ModelIteration = 5',
  'ModelIterationCount = 20',
  'ExpectedDamCount = 3',
  'SectionsPerDam = 4',
  'ExpectedSectionCount = ExpectedDamCount * SectionsPerDam',
  'ExpectedAccentCount = ExpectedDamCount * AccentsPerDam',
  'ExpectedPierCount = ExpectedDamCount * PiersPerDam',
  'SamplesPerSection = 24',
  'MEP_Wall_01_N.prefab',
  'MEP_Wall_02_N.prefab',
  'MEP_Wall_03_N.prefab',
  'MEP_Wall_04_N.prefab',
  'concrete_wall_009_diff_2k.jpg',
  'concrete_wall_009_nor_gl_2k.jpg',
  'concrete_wall_009_ao_2k.jpg',
  'Kromka_NorthernSluices_Concrete009_MEP.mat',
  'NorthernSluices_DamComplex_MEP',
  'ContinuousDamSections_EDITABLE',
  'MepBreachAccents_EDITABLE',
  'GatePiers_EDITABLE',
  'NorthernDamCrowns_3_REFERENCE',
  'BrokenDamSections_12_REFERENCE',
  'ConcreteGatePiers_6_REFERENCE',
  'DirectMEPWallAccents_12_REFERENCE',
  'DirectMEPWallPrefabs_4_REFERENCE',
  'SpillwayBreaches_3_REFERENCE',
  'PolyHavenConcreteWall009_CC0_REFERENCE',
  'ModelIteration_05_of_20',
  'BuildDamSectionMesh',
  'mesh.bounds.center.z < -9f',
  'existing.vertices = generated.vertices',
  'ValidateIteration05',
  '[KROMKA MODELS 25%] PASS'
], 'Kromka model iteration 05 Northern Sluices');
includes(globalOreIndustry, [
  'ModelIteration = 6',
  'ModelIterationCount = 20',
  'ExpectedClusterCount = 3',
  'ExpectedIndustrialCount = 6',
  'IndustrialWarehouse.obj',
  'Material.013.png',
  'Kromka_OreArc_IndustrialWarehouse_CC0.mat',
  'OreArc_SovietIndustrialBelt_CC0',
  'WeatheredIndustrialBuildings_EDITABLE',
  'OreIndustryClusters_3_REFERENCE',
  'CC0IndustrialWarehouses_6_REFERENCE',
  'Warehouse02_CC0_REFERENCE',
  'NoKenneyIndustrialModels_REFERENCE',
  'NoToyFactoryKit_REFERENCE',
  'StaticIndustrialGeometry_REFERENCE',
  'ModelIteration_06_of_20',
  'ConfigureAssets',
  'InstantiateAndFitModel',
  'outside the Ore Arc interior',
  'ValidateIteration06',
  '[KROMKA MODELS 30%] PASS'
], 'Kromka model iteration 06 Ore Arc industry');
assert(!globalOreIndustry.includes('/ThirdParty/Kenney/')
  && !globalOreIndustry.includes('FactoryKit30'),
  'the live Ore Arc authoring pass must not depend on toy Kenney factory models');
includes(globalMiddleVeinSettlements, [
  'ModelIteration = 7',
  'ModelIterationCount = 20',
  'ExpectedSettlementCount = 3',
  'ExpectedBuildingCount = 16',
  'ExpectedKeysKenneyBuildingCount = 10',
  'ExpectedMepSatelliteBuildingCount = 6',
  'ExpectedCivicPieceCount = 13',
  'building-a.fbx',
  'building-b.fbx',
  'building-d.fbx',
  'building-g.fbx',
  'building-h.fbx',
  'building-i.fbx',
  'building-k.fbx',
  'building-o.fbx',
  'building-s.fbx',
  'building-t.fbx',
  'water-tower.fbx',
  'MEP_Shack_05_N.prefab',
  'MEP_Shack_06_N.prefab',
  'MEP_Walk_01_N.prefab',
  'MEP_Walk_04_N.prefab',
  'MEP_StoneWall_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'Kromka_MiddleVein_Settlement_MEP.mat',
  'Kromka_MiddleVein_Civic_MEP.mat',
  'Kromka_MiddleVein_KenneyBrick.mat',
  'variation-b.png',
  'MiddleVein_SettlementBelt_MEP',
  'ThreeNamedSettlements_EDITABLE',
  'CivicInfrastructure_EDITABLE',
  'MiddleVeinSettlements_3_REFERENCE',
  'KenneyKeysBuildings_10_REFERENCE',
  'DirectMEPSatelliteBuildings_6_REFERENCE',
  'KenneyCityKitSources_11_REFERENCE',
  'DirectMEPCivicPieces_13_REFERENCE',
  'KeysLoadingPlatforms_4_REFERENCE',
  'KeysWaterTower_1_REFERENCE',
  'PersistentSettlementGeometry_REFERENCE',
  'ModelIteration_07_of_20',
  'Keys_WaterTower_LANDMARK',
  'ConfigureKenneyAssets',
  'BuildKenneyMaterial',
  'BuildMepMaterial',
  'outside the reviewed Middle Vein settlement belt',
  'ValidateIteration07',
  '[KROMKA MODELS 35%] PASS'
], 'Kromka model iteration 07 Middle Vein settlements');
includes(globalTractInfrastructure, [
  'ModelIteration = 8',
  'ModelIterationCount = 20',
  'ExpectedHubCount = 4',
  'ExpectedStructureCount = 13',
  'ExpectedContainerCount = 12',
  'ExpectedMepFortificationCount = 19',
  'ExpectedVehicleCount = 18',
  'ExpectedDebrisCount = 16',
  'building-a.fbx',
  'building-s.fbx',
  'shipping-container-a.fbx',
  'shipping-container-c.fbx',
  'crane.fbx',
  'crane-lift.fbx',
  'MEP_StoneWall_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'truck.fbx',
  'firetruck.fbx',
  'garbage-truck.fbx',
  'debris-tire.fbx',
  'debris-door.fbx',
  'Kromka_Tract_KenneyStructures.mat',
  'Kromka_Tract_CarWrecks.mat',
  'Kromka_Tract_MEPFortifications.mat',
  'TractIsthmus_Infrastructure_MEP_Kenney',
  'FourNamedNodes_EDITABLE',
  'VehicleGraveyards_EDITABLE',
  'TractNamedNodes_4_REFERENCE',
  'KenneyStructures_13_REFERENCE',
  'CargoContainers_12_REFERENCE',
  'DirectMEPFortifications_19_REFERENCE',
  'AbandonedVehicles_18_REFERENCE',
  'VehicleDebris_16_REFERENCE',
  'RoutePylonAndTurntable_2_REFERENCE',
  'KenneyCarKit31_CC0_REFERENCE',
  'PersistentTractGeometry_REFERENCE',
  'ModelIteration_08_of_20',
  'Crossroads_RoutePylon_LANDMARK',
  'BypassDepot_Turntable_LANDMARK',
  'ConfigureImportedAssets',
  'outside the reviewed Tract corridor',
  'ValidateIteration08',
  '[KROMKA MODELS 40%] PASS'
], 'Kromka model iteration 08 Tract infrastructure');
includes(globalNativeModelMaterials, [
  'Kenney_CarKit31_Native.mat',
  'Kenney_FactoryKit30_Native.mat',
  'Kenney_CityKitIndustrial20_Native.mat',
  'Assets/ThirdParty/Kenney/CarKit31/',
  'Assets/ThirdParty/Kenney/FactoryKit30/',
  'Assets/ThirdParty/Kenney/CityKitIndustrial20/',
  'Textures/colormap.png',
  'material.SetTexture("_BaseMap", texture)',
  'material.SetColor("_BaseColor", Color.white)',
  'ValidateSourceAtlases'
], 'native model-kit materials');
assert(!globalTractInfrastructure.includes('vehicles.SetTexture("_BaseMap", null)'),
  'Car Kit vehicles must not lose their original texture atlas');
includes(globalGlasslandsScience, [
  'ModelIteration = 9',
  'ModelIterationCount = 20',
  'ExpectedFacilityCount = 12',
  'ExpectedDishCount = 5',
  'ExpectedMachineCount = 10',
  'ExpectedSupportCount = 7',
  'ExpectedMepRuinCount = 18',
  'hangar_roundGlass.fbx',
  'hangar_largeA.fbx',
  'hangar_smallB.fbx',
  'satelliteDish_large.fbx',
  'satelliteDish_detailed.fbx',
  'machine_generatorLarge.fbx',
  'machine_wirelessCable.fbx',
  'pipe_cornerRoundLarge.fbx',
  'supports_high.fbx',
  'MEP_StoneWall_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'MEP_C_ClusterStone_01_N.prefab',
  'MEP_C_ConcaveStone_N.prefab',
  'Kromka_Glasslands_ContourFacility.mat',
  'Kromka_Glasslands_ContourCeramic.mat',
  'Kromka_Glasslands_ContourMachinery.mat',
  'Kromka_Glasslands_LeaningSupports.mat',
  'Kromka_Glasslands_MEP_Ruins.mat',
  'Glasslands_ScienceBelt_MEP_Kenney',
  'ThreeNamedScienceNodes_EDITABLE',
  'DishArray_EDITABLE',
  'ScientificMachinery_EDITABLE',
  'LeaningSupportGrid_EDITABLE',
  'DirectMEPRuins_EDITABLE',
  'GlasslandsNamedScienceNodes_3_REFERENCE',
  'ContourFacilities_12_REFERENCE',
  'ContourDishes_5_REFERENCE',
  'ContourMachines_10_REFERENCE',
  'LeaningScienceSupports_7_REFERENCE',
  'DirectMEPGlasslandRuins_18_REFERENCE',
  'Contour3SealedTower_1_REFERENCE',
  'KenneySpaceKit10_CC0_REFERENCE',
  'PersistentGlasslandsScienceGeometry_REFERENCE',
  'ModelIteration_09_of_20',
  'Contour3_SealedTower_LANDMARK',
  'ConfigureImportedAssets',
  'outside the reviewed Glasslands shelf',
  'ValidateIteration09',
  '[KROMKA MODELS 45%] PASS'
], 'Kromka model iteration 09 Glasslands science belt');
includes(globalGlasslandsLandmarks, [
  'ModelIteration = 10',
  'ModelIterationCount = 20',
  'ExpectedSolarPanelCount = 18',
  'ExpectedVectorRingSegmentCount = 24',
  'ExpectedSupportCount = 12',
  'ExpectedDishCount = 4',
  'ExpectedMachineCount = 5',
  'ExpectedFacilityCount = 3',
  'ExpectedMepRuinCount = 17',
  'supports_high.fbx',
  'satelliteDish_large.fbx',
  'machine_generatorLarge.fbx',
  'machine_wirelessCable.fbx',
  'hangar_roundGlass.fbx',
  'structure_closed.fbx',
  'structure_detailed.fbx',
  'MEP_StoneWall_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'MEP_C_ClusterStone_03_N.prefab',
  'MEP_C_ConcaveStone_N.prefab',
  'Kromka_Glasslands_SolarPanel.mat',
  'Kromka_Glasslands_VectorRing.mat',
  'Glasslands_OuterLandmarks_MEP_Kenney',
  'OuterSupportArrays_EDITABLE',
  'OuterDishArrays_EDITABLE',
  'OuterMachines_EDITABLE',
  'OuterFacilities_EDITABLE',
  'OuterMEPRuins_EDITABLE',
  'SolarField4_PanelField_LANDMARK',
  'ObjectVector_BuriedRings_EDITABLE',
  'ObjectVector_ImpossibleLattice_LANDMARK',
  'RelayB9_SealedMast_LANDMARK',
  'GlasslandsOuterNodes_3_REFERENCE',
  'SolarField4Panels_18_REFERENCE',
  'VectorRingSegments_24_REFERENCE',
  'OuterScienceSupports_12_REFERENCE',
  'OuterScienceDishes_4_REFERENCE',
  'OuterScienceMachines_5_REFERENCE',
  'OuterScienceFacilities_3_REFERENCE',
  'DirectMEPOuterRuins_17_REFERENCE',
  'RelayB9SplitDishes_3_REFERENCE',
  'ObjectVectorImpossibleLattice_1_REFERENCE',
  'PersistentOuterGlasslandsGeometry_REFERENCE',
  'ModelIteration_10_of_20',
  'outside the reviewed outer Glasslands',
  'ValidateIteration10',
  '[KROMKA MODELS 50%] PASS'
], 'Kromka model iteration 10 outer Glasslands landmarks');
includes(globalChalkLowlandSettlements, [
  'ModelIteration = 11',
  'ModelIterationCount = 20',
  'ExpectedBuildingCount = 8',
  'ExpectedCivicCount = 14',
  'ExpectedKarstCount = 14',
  'ExpectedFactoryCount = 5',
  'ExpectedFilterRackCount = 12',
  'ExpectedKilnCount = 2',
  'MEP_Shack_01_N.prefab',
  'MEP_Shack_06_N.prefab',
  'MEP_Shack_Broken_N.prefab',
  'MEP_Walk_04_N.prefab',
  'MEP_StoneWall_02_N.prefab',
  'MEP_Fence_03_N.prefab',
  'MEP_C_Entrance_01_N.prefab',
  'MEP_C_Boulder_04_N.prefab',
  'MEP_C_ClusterStone_03_N.prefab',
  'MEP_C_ConcaveStone_N.prefab',
  'MEP_C_Wall_03_N.prefab',
  'hopper-high-round.fbx',
  'hopper-high-square.fbx',
  'conveyor-long-sides.fbx',
  'conveyor-bars-fence-slope.fbx',
  'structure-tall.fbx',
  'Kromka_ChalkLowland_Buildings_MEP.mat',
  'Kromka_ChalkLowland_Civic_MEP.mat',
  'Kromka_ChalkLowland_Karst_MEP.mat',
  'Kromka_ChalkLowland_FilterCloth.mat',
  'ChalkLowland_SettlementAndIndustry_MEP_Kenney',
  'SecondHaven_QuarryHouses_EDITABLE',
  'ChalkCivicInfrastructure_EDITABLE',
  'ChalkKarstLandmarks_EDITABLE',
  'ChalkProcessingMachines_EDITABLE',
  'SecondHaven_FilterCanopy_LANDMARK',
  'CeramicLedge_Kilns_LANDMARK',
  'ChalkSluice_FilterRacks_LANDMARK',
  'ChalkLowlandNamedNodes_3_REFERENCE',
  'DirectMEPChalkBuildings_8_REFERENCE',
  'DirectMEPChalkCivic_14_REFERENCE',
  'DirectMEPChalkKarst_14_REFERENCE',
  'KenneyChalkMachines_5_REFERENCE',
  'ChalkFilterRacks_12_REFERENCE',
  'CeramicKilns_2_REFERENCE',
  'SecondHavenFilterCanopy_1_REFERENCE',
  'PersistentChalkLowlandGeometry_REFERENCE',
  'ModelIteration_11_of_20',
  'outside the reviewed Chalk Lowland',
  'ValidateIteration11',
  '[KROMKA MODELS 55%] PASS'
], 'Kromka model iteration 11 Chalk Lowland settlements');
includes(globalListenersRavine, [
  'ModelIteration = 12',
  'ModelIterationCount = 20',
  'ExpectedCanyonWallCount = 22',
  'ExpectedEchoPillarCount = 24',
  'ExpectedCollapseCount = 18',
  'ExpectedBridgeCount = 4',
  'ExpectedListeningBasinCount = 3',
  'BasinSegments = 12',
  'MEP_C_Wall_01_N.prefab',
  'MEP_C_Wall_07_N.prefab',
  'MEP_C_Transition_01_N.prefab',
  'MEP_C_Entrance_01_N.prefab',
  'MEP_C_Stalagmite_01_N.prefab',
  'MEP_C_Stalagmite_06_N.prefab',
  'MEP_C_Boulder_Grp_01_N.prefab',
  'MEP_C_ClusterStone_03_N.prefab',
  'MEP_C_ConcaveStone_N.prefab',
  'MEP_C_Block_01_N.prefab',
  'MEP_C_Edge_01_N.prefab',
  'Kromka_ListenersRavine_Walls_MEP.mat',
  'Kromka_ListenersRavine_EchoPillars_MEP.mat',
  'Kromka_ListenersRavine_Collapse_MEP.mat',
  'Kromka_ListenersRavine_BasinDark.mat',
  'ListenersRavine_NaturalKarst_MEP',
  'DoubleCanyonWalls_EDITABLE',
  'PairedEchoPillars_EDITABLE',
  'CollapsedKarstChambers_EDITABLE',
  'NaturalStoneBridges_EDITABLE',
  'ListeningBasins_DarkKarstWindows_LANDMARK',
  'ListenersRavineNode_332_83_REFERENCE',
  'DirectMEPCanyonWalls_22_REFERENCE',
  'DirectMEPEchoPillars_24_REFERENCE',
  'DirectMEPCollapsePieces_18_REFERENCE',
  'DirectMEPNaturalBridges_4_REFERENCE',
  'ListeningBasins_3_REFERENCE',
  'ListenerKarstRavineProfile_REFERENCE',
  'PersistentListenersRavineGeometry_REFERENCE',
  'ModelIteration_12_of_20',
  'outside the reviewed Listeners\' Ravine',
  'ValidateIteration12',
  '[KROMKA MODELS 60%] PASS'
], 'Kromka model iteration 12 Listeners Ravine');
includes(globalZeroCore, [
  'ModelIteration = 13',
  'ModelIterationCount = 20',
  'ExpectedFacilityCount = 14',
  'ExpectedMachineCount = 10',
  'ExpectedMepPipeCount = 12',
  'ExpectedMepFortificationCount = 18',
  'ExpectedBlackWaterRingCount = 3',
  'RingSegments = 16',
  'structure_closed.fbx',
  'structure_detailed.fbx',
  'hangar_smallA.fbx',
  'hangar_largeB.fbx',
  'corridor_detailed.fbx',
  'gate_complex.fbx',
  'hopper-high-round.fbx',
  'structure-tall.fbx',
  'machine_generatorLarge.fbx',
  'machine_wirelessCable.fbx',
  'MEP_C_Pipe_01_N.prefab',
  'MEP_C_Pipe_02_N.prefab',
  'MEP_Wall_04_N.prefab',
  'MEP_StoneWall_02_N.prefab',
  'MEP_Fence_03_N.prefab',
  'MEP_C_Entrance_01_N.prefab',
  'Kromka_ZeroCore_Facility.mat',
  'Kromka_ZeroCore_Machinery.mat',
  'Kromka_ZeroCore_Pipes_MEP.mat',
  'Kromka_ZeroCore_Walls_MEP.mat',
  'Kromka_ZeroCore_BlackWater.mat',
  'ZeroBasin_CoreComplexes_MEP_Kenney',
  'R12AndBalanceFacilities_EDITABLE',
  'R12AndBalanceMachinery_EDITABLE',
  'DirectMEPThickPipes_EDITABLE',
  'DirectMEPZeroFortifications_EDITABLE',
  'R12_BlackWaterRings_LANDMARK',
  'R12_RegeneratorColumn_LANDMARK',
  'Balance_ColdStatusColumn_LANDMARK',
  'ZeroCoreNamedNodes_2_REFERENCE',
  'ZeroCoreFacilities_14_REFERENCE',
  'ZeroCoreMachines_10_REFERENCE',
  'DirectMEPZeroPipes_12_REFERENCE',
  'DirectMEPZeroFortifications_18_REFERENCE',
  'R12BlackWaterRings_3_REFERENCE',
  'R12RegeneratorColumn_1_REFERENCE',
  'BalanceColdStatusColumn_1_REFERENCE',
  'PersistentZeroCoreGeometry_REFERENCE',
  'ModelIteration_13_of_20',
  'outside the reviewed Zero Basin core',
  'ValidateIteration13',
  '[KROMKA MODELS 65%] PASS'
], 'Kromka model iteration 13 Zero Basin core');
includes(globalZeroOuter, [
  'ModelIteration = 14',
  'ModelIterationCount = 20',
  'ExpectedStructureCount = 15',
  'ExpectedVehicleCount = 5',
  'ExpectedMepPipeCount = 14',
  'ExpectedMepBarrelCount = 18',
  'ExpectedMepFortificationCount = 18',
  'ExpectedLeaningTankCount = 4',
  'PoolSegments = 16',
  'gate_complex.fbx',
  'hangar_largeA.fbx',
  'structure_closed.fbx',
  'building-t.fbx',
  'hopper-high-round.fbx',
  'conveyor-long-sides.fbx',
  'water-tower.fbx',
  'shipping-container-a.fbx',
  'crane-lift.fbx',
  'delivery.fbx',
  'truck-flat.fbx',
  'firetruck.fbx',
  'MEP_C_Pipe_01_N.prefab',
  'MEP_C_Pipe_02_N.prefab',
  'MEP_Barrel.prefab',
  'MEP_Wall_04_N.prefab',
  'MEP_StoneWall_02_N.prefab',
  'MEP_Fence_03_N.prefab',
  'Kromka_ZeroOuter_Structures.mat',
  'Kromka_ZeroOuter_Vehicles.mat',
  'Kromka_ZeroOuter_Pipes_MEP.mat',
  'Kromka_ZeroOuter_Barrels_MEP.mat',
  'Kromka_ZeroOuter_Fortifications_MEP.mat',
  'ZeroBasin_OuterInfrastructure_MEP_Kenney',
  'ZeroOuterStructures_EDITABLE',
  'ZeroOuterVehicles_EDITABLE',
  'DirectMEPOuterPipes_EDITABLE',
  'DirectMEPOuterBarrels_EDITABLE',
  'DirectMEPOuterFortifications_EDITABLE',
  'FuelRamp_LeaningTanks_LANDMARK',
  'FuelRamp_LoadingRack_LANDMARK',
  'Drain4B_DrainStack_LANDMARK',
  'Drain4B_BlackSettlingPool_LANDMARK',
  'Fort14_CommandBastion_LANDMARK',
  'ZeroOuterNamedNodes_3_REFERENCE',
  'ZeroOuterStructures_15_REFERENCE',
  'ZeroOuterVehicles_5_REFERENCE',
  'DirectMEPOuterPipes_14_REFERENCE',
  'DirectMEPOuterBarrels_18_REFERENCE',
  'DirectMEPOuterFortifications_18_REFERENCE',
  'FuelRampLeaningTanks_4_REFERENCE',
  'FuelRampLoadingRack_1_REFERENCE',
  'Drain4BBlackSettlingPool_1_REFERENCE',
  'Drain4BDrainStack_1_REFERENCE',
  'Fort14CommandBastion_1_REFERENCE',
  'PersistentZeroOuterGeometry_REFERENCE',
  'ModelIteration_14_of_20',
  'outside the reviewed Zero Basin outer nodes',
  'ValidateIteration14',
  '[KROMKA MODELS 70%] PASS'
], 'Kromka model iteration 14 Zero Basin outer nodes');
includes(globalHostileLandmarks, [
  'ModelIteration = 15',
  'ModelIterationCount = 20',
  'ExpectedDustlingMepCount = 14',
  'ExpectedFoldedConcreteCount = 18',
  'ExpectedBurrowRidgeCount = 16',
  'ExpectedRelicCount = 9',
  'ExpectedCableRunCount = 10',
  'ExpectedMedicalRingSegments = 20',
  'ExpectedBurrowHoleCount = 5',
  'MEP_C_Entrance_01_N.prefab',
  'MEP_C_Block_01_N.prefab',
  'MEP_C_ClusterStone_02_N.prefab',
  'MEP_C_Pipe_02_N.prefab',
  'MEP_Wall_04_N.prefab',
  'MEP_StoneWall_02_N.prefab',
  'MEP_C_ConcaveStone_N.prefab',
  'MEP_C_Wall_07_N.prefab',
  'machine_wirelessCable.fbx',
  'pipe_split.fbx',
  'hangar_roundGlass.fbx',
  'hopper-high-round.fbx',
  'conveyor-corner.fbx',
  'structure-tall.fbx',
  'Kromka_Hostile_Dustling_MEP.mat',
  'Kromka_Hostile_FoldedConcrete_MEP.mat',
  'Kromka_Hostile_BurrowRidge_MEP.mat',
  'Kromka_Hostile_IndustrialRelics.mat',
  'Kromka_Hostile_ShreddedCable.mat',
  'Kromka_Hostile_MedicalRing.mat',
  'Kromka_Hostile_BurrowDark.mat',
  'HostileLandmarks_ModelPass15_MEP_Kenney',
  'DustlingColony_DirectMEP_EDITABLE',
  'FoldedCrater_DirectMEP_EDITABLE',
  'BurrowerNest_DirectMEP_EDITABLE',
  'HostileIndustrialRelics_EDITABLE',
  'Dustling_ShreddedCableRuns_LANDMARK',
  'Dustling_VentMound_LANDMARK',
  'Folded_MedicalRing_LANDMARK',
  'Folded_SurgicalMast_LANDMARK',
  'Burrower_DarkHoles_LANDMARK',
  'Burrower_BrokenSettlingWall_LANDMARK',
  'HostileNamedNodes_3_REFERENCE',
  'DustlingDirectMEP_14_REFERENCE',
  'FoldedConcreteDirectMEP_18_REFERENCE',
  'BurrowRidgeDirectMEP_16_REFERENCE',
  'HostileIndustrialRelics_9_REFERENCE',
  'DustlingCableRuns_10_REFERENCE',
  'FoldedMedicalRingSegments_20_REFERENCE',
  'BurrowerDarkHoles_5_REFERENCE',
  'TerrainSeatedHostileLandmarks_REFERENCE',
  'PersistentHostileGeometry_REFERENCE',
  'ModelIteration_15_of_20',
  'is floating above or buried in the terrain',
  'contains intersecting authored footprints',
  'every hostile landmark renderer must retain a supported material',
  'ValidateIteration15',
  '[KROMKA MODELS 75%] PASS'
], 'Kromka model iteration 15 hostile landmarks');
includes(globalSilentRingOutpost, [
  'ModelIteration = 16',
  'ModelIterationCount = 20',
  'ExpectedFortificationCount = 18',
  'ExpectedPipeCount = 8',
  'ExpectedStructureCount = 6',
  'ExpectedFireVentCount = 5',
  'ExpectedSignalPylonCount = 6',
  'GloomMapX = 78f',
  'GloomMapY = 65f',
  'MEP_Wall_01_N.prefab',
  'MEP_Wall_04_N.prefab',
  'MEP_StoneWall_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'MEP_C_Pipe_01_N.prefab',
  'MEP_C_Pipe_02_N.prefab',
  'structure_closed.fbx',
  'machine_generatorLarge.fbx',
  'satelliteDish_detailed.fbx',
  'structure-tall.fbx',
  'water-tower.fbx',
  'Kromka_SilentOutpost_Fortifications_MEP.mat',
  'Kromka_SilentOutpost_Pipes_MEP.mat',
  'Kromka_SilentOutpost_SubsurfaceFire.mat',
  'SilentRing_GloomDetour_ModelPass16_MEP_Kenney',
  'GloomDetour_DirectMEPPerimeter_EDITABLE',
  'GloomDetour_DirectMEPBuriedPipes_EDITABLE',
  'GloomDetour_IndustrialRelics_EDITABLE',
  'GloomDetour_DefenceTower_LANDMARK',
  'GloomDetour_SubsurfaceFire_LANDMARK',
  'GloomDetour_SignalPylons_LANDMARK',
  'GloomDetourDirectMEPPerimeter_18_REFERENCE',
  'GloomDetourDirectMEPBuriedPipes_8_REFERENCE',
  'GloomDetourSubsurfaceFireVents_5_REFERENCE',
  'TerrainSeatedGloomDetour_REFERENCE',
  'ContainsMapPoint',
  'PersistentSilentRingGeometry_REFERENCE',
  'ModelIteration_16_of_20',
  'is floating above or buried in the terrain',
  'contains intersecting authored footprints',
  'every Gloom Detour renderer must retain a supported material',
  'ValidateIteration16',
  '[KROMKA MODELS 80%] PASS'
], 'Kromka model iteration 16 Gloom Detour');
includes(globalRouteCrossings, [
  'ModelIteration = 17',
  'ModelIterationCount = 20',
  'TesmaFreightRail_SUPPORTED_EDITABLE',
  'RailwaySurfaceHeight',
  'crossings.Count == 1',
  'ContinuousFreightRails',
  'GroundSupportedSleepers',
  'TesmaRailBridge_ContinuousStructure',
  'RailBridgeApproachFill',
  'BankAbutment_',
  'RailWaterCrossing_1_REFERENCE',
  'NoOrphanedDryLandViaducts_REFERENCE',
  'PersistentRouteCrossingGeometry_REFERENCE',
  'ModelIteration_17_of_20',
  'A rail bridge abutment is floating.',
  'A rail bridge bearing is detached from its deck.',
  'ValidateIteration17',
  '[KROMKA MODELS 85%] PASS'
], 'Kromka model iteration 17 route crossings');
includes(globalRoadBridges, [
  'OpenGameArt/ConcreteBridge/Models/concrete-bridge.fbx',
  'TesmaMainTract_RoadBridge',
  'R12SouthService_RoadBridge',
  'ConcreteRoadBridges_OpenGameArt_CC0_EDITABLE',
  'RoadWaterCrossings_2_REFERENCE',
  'OpenGameArtConcreteBridge_CC0_REFERENCE',
  'NativeBridgeMaterials_PRESERVED_REFERENCE',
  'NoRoadRunsInsideTesma_REFERENCE',
  'nativeMaterialNames.Contains("Concrete")',
  'nativeMaterialNames.Contains("road")',
  'nativeMaterialNames.Contains("yellowpaint")',
  'KROMKA ROAD BRIDGES'
], 'Kromka CC0 concrete road bridges');
includes(globalRiverClearanceAudit, [
  'MapCentre.y - bounds.center.z / WorldScale',
  'scanned_structures=',
  'blocking_structures=',
  'authored_hydraulic_structures=',
  'IsNaturalRiverDebris',
  'StartsWith("TesmaMainTract_RoadBridge"',
  'StartsWith("R12SouthService_RoadBridge"',
  'Equals("TesmaFreightRail_SUPPORTED_EDITABLE"',
  'Equals("NorthernSluices_DamComplex_MEP"',
  'Write river-clearance audit'
], 'Kromka river-clearance audit');
includes(concreteBridgeLicense, [
  'https://opengameart.org/content/concrete-bridge',
  'Creative Commons Zero',
  'tbbk',
  'b3cb8b8feba0f6187297259746e3d403c18e3c154d406b79779f62cb06d54e9f'
], 'OpenGameArt concrete bridge provenance');
includes(globalOuterWasteland, [
  'OuterNuclearWasteland_AUTHORED',
  'Iteration01_NorthWestNuclearOutskirts_05pct',
  'Kromka_OuterNuclearWasteland_05pct.asset',
  'Kromka_OuterDeadHighway_05pct.asset',
  'Kromka_OuterNuclearCraterScorch_05pct.asset',
  'Kromka_OuterNuclearGround_MEP.mat',
  'Kromka_OuterNuclearCraterScorch_MEP.mat',
  'KromkaOuterNuclearScorch.shader',
  'NuclearImpactScorch_SURFACE_MEP',
  'NuclearImpactCraters_AUTHORED',
  'GroundZeroCrater',
  'SecondaryAirburstCrater',
  'CollapsedShelterCrater',
  'MajadroidApocalypticRuins_CC0_NATIVE_TEXTURES',
  'building-01.fbx',
  'building-05.fbx',
  'building-07.fbx',
  'wreckage-3-types.fbx',
  'OuterWastelandProgress_05pct_REFERENCE',
  'OuterSectorsComplete_01_of_20_REFERENCE',
  'NuclearCraterScorchReadableAtStrategicZoom_REFERENCE',
  'OutsidePlayableBoundary_NON_ROUTABLE_REFERENCE',
  'HighwaySegmentsPerSpan = 8',
  'CraterAngularSegments = 40',
  'source texture',
  'ValidateIteration01',
  '[KROMKA OUTER WASTELAND 5%] PASS'
], 'Kromka outer nuclear wasteland iteration 01');
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
includes(globalOuterWasteland02, [
  'Iteration02_WesternEvacuationGraveyard_10pct',
  'Kromka_OuterWesternEvacuationGraveyard_Iteration02.asset',
  'Kromka_OuterWesternEvacuationRoute_Iteration02.asset',
  'Kromka_OuterWesternCraterScorch_Iteration02.asset',
  'Kromka_OuterEvacuationAsphalt_MEP.mat',
  'EvacuationColumnImpactCrater',
  'WesternRelayBlastCrater',
  'RoadsideSecondaryCrater',
  'MehozavrDestroyedUazConvoy_CC0_NATIVE_TEXTURES',
  'uaz_destroyed.fbx',
  'WesternCheckpointRuins_CC0_NATIVE_TEXTURES',
  'WesternBlastDeadwood_DIRECT_MEP',
  'OuterWastelandProgress_10pct_REFERENCE',
  'OuterSectorsComplete_02_of_20_REFERENCE',
  'Iteration01To02_WATERTIGHT_SEAM_REFERENCE',
  'ValidateSharedSeam',
  'RoutePointCount = 25',
  'mehozavr-uaz-source-audit.txt',
  '[KROMKA OUTER WASTELAND 10%] PASS'
], 'Kromka outer nuclear wasteland iteration 02');
includes(mehozavrUazLicense, [
  'https://opengameart.org/content/uaz-452-utility-van-lowpoly',
  'Creative Commons Zero',
  'Mehozavr',
  'ADC0E41D50198F64B44C3A3C1266F478E444AED88C205AE4E0B12F6EE4B146B0'
], 'OpenGameArt Mehozavr UAZ-452 provenance');
includes(globalSilentRingDeadwood, [
  'ModelIteration = 18',
  'ModelIterationCount = 20',
  'ExpectedDeadTreeCount = 40',
  'ExpectedStumpCount = 16',
  'ExpectedBranchCount = 20',
  'MEP_BrokenDeadTree_01_N.prefab',
  'MEP_BrokenDeadTree_06_N.prefab',
  'MEP_TreeStump_01.prefab',
  'MEP_TreeStump_02.prefab',
  'MEP_TreeTrunk_01.prefab',
  'MEP_S_Branch_03.prefab',
  'MEP_S_Branch_09.prefab',
  'SilentRing_DeadwoodBelt_ModelPass18_DirectMEP',
  'DeadTreeSentinels_EDITABLE',
  'DeadTreeStumps_EDITABLE',
  'WindThrownBranches_EDITABLE',
  'SilentRingDeadTrees_40_REFERENCE',
  'SilentRingStumps_16_REFERENCE',
  'SilentRingBranches_20_REFERENCE',
  'DirectMEPDeadwoodSources_16_REFERENCE',
  'SparseDeadForestBelt_REFERENCE',
  'TerrainSeatedDeadwood_REFERENCE',
  'PersistentDeadwoodGeometry_REFERENCE',
  'ModelIteration_18_of_20',
  'is floating above or buried in the terrain',
  'contains intersecting authored footprints',
  'every deadwood renderer must retain a supported MEP material',
  'ValidateIteration18',
  '[KROMKA MODELS 90%] PASS'
], 'Kromka model iteration 18 Silent Ring deadwood');
includes(globalPowerCorridor, [
  'ModelIteration = 19',
  'ModelIterationCount = 20',
  'ExpectedPylonCount = 8',
  'ExpectedFenceCount = 16',
  'ExpectedEquipmentCount = 4',
  'ExpectedSwitchyardCount = 2',
  'MEP_Fence_01_N.prefab',
  'MEP_Fence_02_N.prefab',
  'MEP_Fence_03_N.prefab',
  'machine_generatorLarge.fbx',
  'machine_generator.fbx',
  'SovietTransmissionCorridor_ModelPass19_MEP_Kenney',
  'LatticeTransmissionPylons_LANDMARKS',
  'SaggingTransmissionConductors_OPTIMIZED',
  'DirectMEPSwitchyardFences_EDITABLE',
  'OptimizedSwitchyardEquipment_EDITABLE',
  'SwitchgearBays_LANDMARKS',
  'SovietTransmissionPylons_8_REFERENCE',
  'TransmissionCablePhases_3_REFERENCE',
  'DirectMEPSwitchyardFences_16_REFERENCE',
  'OptimizedSwitchyardEquipment_4_REFERENCE',
  'SwitchingYards_2_REFERENCE',
  'TerrainSeatedPowerInfrastructure_REFERENCE',
  'StaticBatchedPowerInfrastructure_REFERENCE',
  'PersistentPowerCorridorGeometry_REFERENCE',
  'ModelIteration_19_of_20',
  'has a floating or buried footing',
  'a sagging conductor intersects the terrain',
  'contains intersecting authored footprints',
  'every power-corridor renderer must retain a supported material',
  'ValidateIteration19',
  '[KROMKA MODELS 95%] PASS'
], 'Kromka model iteration 19 Soviet power corridor');
includes(globalRoadsideFinal, [
  'ModelIteration = 20',
  'ModelIterationCount = 20',
  'ExpectedStopCount = 6',
  'ExpectedShelterCount = 6',
  'ExpectedBenchCount = 6',
  'ExpectedFenceCount = 12',
  'GlobalRendererBudget = 5000',
  'GlobalMaterialBudget = 160',
  'MEP_Shack_Broken_N.prefab',
  'MEP_Shack_01_N.prefab',
  'MEP_Shack_02_N.prefab',
  'MEP_Bench_N.prefab',
  'MEP_Fence_01_N.prefab',
  'MEP_Fence_03_N.prefab',
  'PostSovietRoadsideNodes_ModelPass20_DirectMEP',
  'DirectMEPRoadsideShelters_EDITABLE',
  'DirectMEPRoadsideBenches_EDITABLE',
  'DirectMEPRoadsideFences_EDITABLE',
  'RoadsideSignAssemblies_LANDMARKS',
  'SovietRoadsideStops_6_REFERENCE',
  'DirectMEPRoadsideShelters_6_REFERENCE',
  'DirectMEPRoadsideBenches_6_REFERENCE',
  'DirectMEPRoadsideFences_12_REFERENCE',
  'new Placement("SouthSluice_FenceA", "SouthSluiceStop", FenceSources[2], 188f, 246f',
  'new Placement("SouthSluice_FenceB", "SouthSluiceStop", FenceSources[1], 202f, 251f',
  'RoadsideSignAssemblies_6_REFERENCE',
  'AllModelPasses_20_REFERENCE',
  'GlobalModelMaterialAudit_REFERENCE',
  'GlobalModelOptimizationAudit_REFERENCE',
  'ModelIteration_20_of_20',
  'an environment model still owns an active interaction collider',
  'an environment model can still disappear with camera distance',
  'an environment renderer is missing static batching flags',
  'contains intersecting authored footprints',
  'ValidateIteration20',
  '[KROMKA MODELS 100%] PASS'
], 'Kromka model iteration 20 post-Soviet roadside and final audit');
includes(globalDustEffects, [
  'EffectIterationCount = 20',
  'DustIteration01 = 1',
  'ExpectedRoadEmitterCount = 4',
  'SheetsPerEmitter = 3',
  'MaximumDustRendererCount = 4',
  'MEP_FX/MEP_Clouds/Textures/MEP_Fog_a.png',
  'Kromka_Effect_RoadDust_MEP.mat',
  'Kromka_Effect_RoadDustVeils.asset',
  'Kromka/Global Map/Road Dust',
  'Dust_Iteration01_GroundRoadBreath_MEP',
  'RoadDustEmitters_4_REFERENCE',
  'MEPDustTexture_REFERENCE',
  'GroundHuggingRoadDust_REFERENCE',
  'AnimatedDustVeils_REFERENCE',
  'OptimizedDustMeshBudget_REFERENCE',
  'Vector3.Scale(row.Scale',
  'new Vector3(0.72f, 0.74f, 0.72f)',
  'AddGroundPatch',
  'EffectIteration_01_of_20',
  'GetComponentsInChildren<ParticleSystem>(true).Length == 0',
  'StaticEditorFlags.BatchingStatic',
  'renderer.shadowCastingMode == ShadowCastingMode.Off',
  'ValidateIteration01',
  '[KROMKA EFFECTS 5%] PASS'
], 'Kromka effect iteration 01 road dust');
assert(!globalDustEffects.includes('private static void AddSheet'),
  'road dust must stay on terrain patches instead of returning as vertical ribbons');
includes(globalDustEffects, [
  'DustIteration02 = 2',
  'ExpectedCrosswindTrailCount = 5',
  'MaximumCumulativeDustRendererCount = 9',
  'Dust_Iteration02_ExposedTractCrosswind_MEP',
  'CrosswindDustTrails_5_REFERENCE',
  'ExposedTractWindLanguage_REFERENCE',
  'SharedDustMeshAndMaterial_REFERENCE',
  'EffectIteration_02_of_20',
  'cumulative dust layer must remain at nine renderers',
  'ValidateIteration02',
  '[KROMKA EFFECTS 10%] PASS'
], 'Kromka effect iteration 02 exposed-tract crosswind dust');
includes(globalDustEffects, [
  'DustIteration03 = 3',
  'ExpectedOrePlumeCount = 3',
  'MaximumCumulativeDustRendererCount03 = 12',
  'Kromka_Effect_OreDust_MEP.mat',
  'Dust_Iteration03_OreArcIndustrialPlumes_MEP',
  'OreArcDustPlumes_3_REFERENCE',
  'CrusherSlagLoadingDust_REFERENCE',
  'RegionalDustTint_REFERENCE',
  'EffectIteration_03_of_20',
  'first three dust passes must remain at twelve renderers',
  'ValidateIteration03',
  '[KROMKA EFFECTS 15%] PASS'
], 'Kromka effect iteration 03 regional Ore Arc dust');
includes(globalDustEffects, [
  'DustIteration04 = 4',
  'ExpectedGlassGritCount = 4',
  'MaximumCumulativeDustRendererCount04 = 16',
  'Kromka_Effect_GlassGrit_MEP.mat',
  'Dust_Iteration04_GlasslandsColdGrit_MEP',
  'GlasslandsGritVeils_4_REFERENCE',
  'ColdFusedGlassDust_REFERENCE',
  'CounterflowDustMotion_REFERENCE',
  'EffectIteration_04_of_20',
  'first four dust passes must remain at sixteen renderers',
  'ValidateIteration04',
  '[KROMKA EFFECTS 20%] PASS'
], 'Kromka effect iteration 04 Glasslands cold grit');
includes(globalDustEffects, [
  'DustIteration05 = 5',
  'ExpectedSilentAshCount = 4',
  'MaximumFinalDustRendererCount = 20',
  'MaximumFinalDustMaterialCount = 4',
  'Kromka_Effect_SilentAsh_MEP.mat',
  'Dust_Iteration05_SilentRingAshDrift_MEP',
  'SilentRingAshDrifts_4_REFERENCE',
  'DeadwoodAshLanguage_REFERENCE',
  'DustStageGlobalAudit_REFERENCE',
  'EffectIteration_05_of_20',
  'complete dust stage must remain at twenty renderers',
  'complete dust stage must remain at four shared materials',
  'complete dust stage must not contain particle systems',
  'ValidateIteration05',
  '[KROMKA EFFECTS 25%] PASS'
], 'Kromka effect iteration 05 Silent Ring ash and dust audit');
includes(roadDustShader, [
  'Kromka/Global Map/Road Dust',
  'Licensed MEP dust mask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off',
  '_FlowSpeed',
  'edgeFade',
  'radialFade',
  'mask.a * input.color.r',
  'MixFog'
], 'Kromka animated transparent road-dust shader');
assert(!roadDustShader.includes('mask.a * 0.75h + 0.08h')
  && !roadDustShader.includes('edgeFade * pulse * 2.2h'),
  'opaque rectangular dust cards must not return to the global map');
includes(globalFogEffects, [
  'FogIteration06 = 6',
  'ExpectedRiverBankCount = 5',
  'SheetsPerBank = 3',
  'MaximumRiverFogRendererCount = 5',
  'MEP_FX/MEP_Clouds/Textures/MEP_Fog_4x4.png',
  'Kromka_Effect_TesmaLowFog_MEP.mat',
  'Kromka_Effect_LowFogBank.asset',
  'Kromka/Global Map/Low Fog',
  'Fog_Iteration06_TesmaGroundMist_MEP',
  'TesmaLowFogBanks_5_REFERENCE',
  'MEPFogFlipbook_REFERENCE',
  'ShaderAnimatedFog_REFERENCE',
  'TerrainSeatedFog_REFERENCE',
  'EffectIteration_06_of_20',
  'GetComponentsInChildren<ParticleSystem>(true).Length == 0',
  'StaticEditorFlags.BatchingStatic',
  'renderer.shadowCastingMode == ShadowCastingMode.Off',
  'ValidateIteration06',
  '[KROMKA EFFECTS 30%] PASS'
], 'Kromka effect iteration 06 Tesma low fog');
includes(globalFogEffects, [
  'FogIteration07 = 7',
  'ExpectedReservoirBankCount = 3',
  'MaximumCumulativeFogRendererCount07 = 8',
  'Kromka_Effect_ReservoirMist_MEP.mat',
  'Kromka_Effect_GroundFogPatch.asset',
  'Fog_Iteration07_ReservoirColdMist_MEP',
  'ReservoirFogBanks_3_REFERENCE',
  'ColdWaterFogLanguage_REFERENCE',
  'SharedFogMesh_REFERENCE',
  'EffectIteration_07_of_20',
  'first two fog passes must remain at eight renderers',
  'ValidateIteration07',
  '[KROMKA EFFECTS 35%] PASS'
], 'Kromka effect iteration 07 reservoir cold mist');
includes(globalFogEffects, [
  'FogIteration08 = 8',
  'ExpectedChalkMistCount = 4',
  'MaximumCumulativeFogRendererCount08 = 12',
  'Kromka_Effect_ChalkLowlandMist_MEP.mat',
  'Fog_Iteration08_ChalkLowlandMist_MEP',
  'ChalkLowlandMistPatches_4_REFERENCE',
  'DryKarstFogLanguage_REFERENCE',
  'ChalkFogLandmarkClearance_REFERENCE',
  'EffectIteration_08_of_20',
  'first three fog passes must remain at twelve renderers',
  'ValidateIteration08',
  '[KROMKA EFFECTS 40%] PASS'
], 'Kromka effect iteration 08 Chalk Lowland mist');
includes(globalFogEffects, [
  'FogIteration09 = 9',
  'ExpectedRavineFogCount = 3',
  'MaximumCumulativeFogRendererCount09 = 15',
  'Kromka_Effect_ListenersRavineFog_MEP.mat',
  'Fog_Iteration09_ListenersRavinePockets_MEP',
  'ListenersRavineFogPockets_3_REFERENCE',
  'EnclosedKarstFogLanguage_REFERENCE',
  'ListeningBasinClearance_REFERENCE',
  'EffectIteration_09_of_20',
  'first four fog passes must remain at fifteen renderers',
  'ValidateIteration09',
  '[KROMKA EFFECTS 45%] PASS'
], 'Kromka effect iteration 09 Listeners Ravine fog');
includes(globalFogEffects, [
  'FogIteration10 = 10',
  'ExpectedFrontierHazeCount = 5',
  'MaximumFinalFogRendererCount = 20',
  'MaximumFinalFogMaterialCount = 5',
  'MaximumFinalFogMeshCount = 2',
  'Kromka_Effect_FrontierHaze_MEP.mat',
  'Fog_Iteration10_FrontierBoundaryHaze_MEP',
  'FrontierHazeBanks_5_REFERENCE',
  'SilentRingBoundaryDepth_REFERENCE',
  'FogStageGlobalAudit_REFERENCE',
  'EffectIteration_10_of_20',
  'complete fog stage must remain at twenty renderers',
  'complete fog stage must remain at five shared materials',
  'complete fog stage must reuse exactly two optimized meshes',
  'complete fog stage must not contain particle systems',
  'ValidateIteration10',
  '[KROMKA EFFECTS 50%] PASS'
], 'Kromka effect iteration 10 frontier haze and fog audit');
assert(!globalFogEffects.includes('private static void AddSheet'),
  'global fog must stay on terrain patches instead of returning as vertical walls');
includes(lowFogShader, [
  'Kromka/Global Map/Low Fog',
  'Licensed MEP 4x4 fog atlas',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off',
  '_FrameRate',
  '_DriftAmount',
  'atlasUv',
  'radialFade',
  'MixFog'
], 'Kromka animated transparent low-fog shader');
includes(globalSmokeEffects, [
  'SmokeIteration11 = 11',
  'ExpectedOreSmokeCount = 4',
  'PuffsPerColumn = 6',
  'MaximumOreSmokeRendererCount = 4',
  'MEP_FX/MEP_Clouds/Textures/AEP_Smoke_02.png',
  'Kromka_Effect_OreIndustrialSmoke_MEP.mat',
  'Kromka_Effect_SmokeColumn.asset',
  'Kromka/Global Map/Industrial Smoke',
  'Smoke_Iteration11_OreArcIndustrialSoot_MEP',
  'OreIndustrialSmokeColumns_4_REFERENCE',
  'AEPIndustrialSmokeTexture_REFERENCE',
  'ModelTopAnchoredSmoke_REFERENCE',
  'NoParticleSmoke_REFERENCE',
  'EffectIteration_11_of_20',
  'GetComponentsInChildren<ParticleSystem>(true)',
  'GetComponentsInChildren<LODGroup>(true).Length == 0',
  'renderer.allowOcclusionWhenDynamic = false',
  'ValidateIteration11',
  '[KROMKA EFFECTS 55%] PASS'
], 'Kromka effect iteration 11 Ore Arc industrial smoke');
includes(globalSmokeEffects, [
  'SmokeIteration12 = 12',
  'ExpectedKilnSmokeCount = 2',
  'MaximumCumulativeSmokeRendererCount12 = 6',
  'Kromka_Effect_CeramicKilnSmoke_MEP.mat',
  'Smoke_Iteration12_CeramicKilnPaleSmoke_MEP',
  'CeramicKilnSmokeColumns_2_REFERENCE',
  'PaleChalkSmokeLanguage_REFERENCE',
  'KilnTopAnchoredSmoke_REFERENCE',
  'EffectIteration_12_of_20',
  'first two smoke passes must remain at six renderers',
  'ValidateIteration12',
  '[KROMKA EFFECTS 60%] PASS'
], 'Kromka effect iteration 12 Ceramic Ledge kiln smoke');
includes(globalSmokeEffects, [
  'SmokeIteration13 = 13',
  'ExpectedRegeneratorExhaustCount = 3',
  'MaximumCumulativeSmokeRendererCount13 = 9',
  'Kromka_Effect_RegeneratorExhaust_MEP.mat',
  'Smoke_Iteration13_RegeneratorColdExhaust_MEP',
  'RegeneratorExhaustColumns_3_REFERENCE',
  'ColdTechnicalExhaustLanguage_REFERENCE',
  'R12MachineTopAnchors_REFERENCE',
  'EffectIteration_13_of_20',
  'first three smoke passes must remain at nine renderers',
  'ValidateIteration13',
  '[KROMKA EFFECTS 65%] PASS'
], 'Kromka effect iteration 13 Regenerator cold exhaust');
includes(globalSmokeEffects, [
  'SmokeIteration14 = 14',
  'ExpectedFireVentSmokeCount = 5',
  'MaximumCumulativeSmokeRendererCount14 = 14',
  'Kromka_Effect_FireVentSmoke_MEP.mat',
  'Smoke_Iteration14_GloomSubsurfaceVents_MEP',
  'GloomFireVentSmokeColumns_5_REFERENCE',
  'HotSubsurfaceSmokeLanguage_REFERENCE',
  'FireVentTopAnchors_REFERENCE',
  'EffectIteration_14_of_20',
  'first four smoke passes must remain at fourteen renderers',
  'ValidateIteration14',
  '[KROMKA EFFECTS 70%] PASS'
], 'Kromka effect iteration 14 Gloom fire-vent smoke');
includes(globalSmokeEffects, [
  'SmokeIteration15 = 15',
  'ExpectedRemoteFailureSmokeCount = 4',
  'MaximumFinalSmokeRendererCount = 18',
  'MaximumFinalSmokeMaterialCount = 5',
  'MaximumFinalSmokeMeshCount = 1',
  'Kromka_Effect_RemoteFailureSmoke_MEP.mat',
  'Smoke_Iteration15_RemoteFailureSources_MEP',
  'RemoteFailureSmokeColumns_4_REFERENCE',
  'IntermittentGeneratorSmoke_REFERENCE',
  'SmokeStageGlobalAudit_REFERENCE',
  'EffectIteration_15_of_20',
  'complete smoke stage must remain at eighteen renderers',
  'complete smoke stage must remain at five shared materials',
  'complete smoke stage must reuse one optimized mesh',
  'complete smoke stage must not contain particle systems',
  'ValidateIteration15',
  '[KROMKA EFFECTS 75%] PASS'
], 'Kromka effect iteration 15 remote failures and smoke audit');
includes(industrialSmokeShader, [
  'Kromka/Global Map/Industrial Smoke',
  'Licensed MEP smoke mask',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off',
  '_RiseSpeed',
  '_RiseDistance',
  '_SwayAmount',
  'lifeFade',
  'MixFog'
], 'Kromka animated transparent industrial-smoke shader');
includes(globalToxicFogEffects, [
  'ToxicFogIteration16 = 16',
  'ExpectedDeadWaterPatchCount = 4',
  'MaximumDeadWaterRendererCount = 4',
  'MEP_FX/MEP_Clouds/Textures/MEP_Fog_4x4.png',
  'Kromka_Effect_GroundFogPatch.asset',
  'Kromka_Effect_DeadWaterToxicFog_MEP.mat',
  'Kromka/Global Map/Toxic Fog',
  'ToxicFog_Iteration16_DeadWaterVapour_MEP',
  'DeadWaterToxicPatches_4_REFERENCE',
  'MEPToxicFogAtlas_REFERENCE',
  'DeadWaterSurfaceClearance_REFERENCE',
  'NoParticleToxicFog_REFERENCE',
  'EffectIteration_16_of_20',
  'GetComponentsInChildren<ParticleSystem>(true)',
  'GetComponentsInChildren<LODGroup>(true).Length == 0',
  'renderer.allowOcclusionWhenDynamic = false',
  'ValidateIteration16',
  '[KROMKA EFFECTS 80%] PASS'
], 'Kromka effect iteration 16 dead-water toxic fog');
includes(globalToxicFogEffects, [
  'ToxicFogIteration17 = 17',
  'ExpectedInfrastructurePatchCount = 4',
  'MaximumCumulativeRendererCount17 = 8',
  'Kromka_Effect_InfrastructureToxicFog_MEP.mat',
  'ToxicFog_Iteration17_InfrastructureRunoff_MEP',
  'InfrastructureToxicPatches_4_REFERENCE',
  'DrainFuelRunoffPlacement_REFERENCE',
  'MutedSulphurPalette_REFERENCE',
  'EffectIteration_17_of_20',
  'ValidateIteration17',
  '[KROMKA EFFECTS 85%] PASS'
], 'Kromka effect iteration 17 infrastructure toxic fog');
includes(globalToxicFogEffects, [
  'ToxicFogIteration18 = 18',
  'ExpectedAnomalyPatchCount = 4',
  'MaximumCumulativeRendererCount18 = 12',
  'Kromka_Effect_AnomalyReactionFog_MEP.mat',
  'ToxicFog_Iteration18_AnomalyReaction_MEP',
  'AnomalyReactionPatches_4_REFERENCE',
  'GlasslandsFacilityPlacement_REFERENCE',
  'ColdCyanGreenPalette_REFERENCE',
  'EffectIteration_18_of_20',
  'ValidateIteration18',
  '[KROMKA EFFECTS 90%] PASS'
], 'Kromka effect iteration 18 Glasslands anomaly-reaction fog');
includes(globalToxicFogEffects, [
  'ToxicFogIteration19 = 19',
  'ExpectedSporeBreachPatchCount = 4',
  'MaximumCumulativeRendererCount19 = 16',
  'Kromka_Effect_SilentSporeFog_MEP.mat',
  'ToxicFog_Iteration19_SilentSporeBreaches_MEP',
  'SilentSporeBreachPatches_4_REFERENCE',
  'DeadwoodInnerBeltPlacement_REFERENCE',
  'AshGreenSporePalette_REFERENCE',
  'EffectIteration_19_of_20',
  'ValidateIteration19',
  '[KROMKA EFFECTS 95%] PASS'
], 'Kromka effect iteration 19 Silent Ring spore fog');
includes(globalToxicFogEffects, [
  'ToxicFogIteration20 = 20',
  'ExpectedBoundaryVeilCount = 4',
  'MaximumFinalToxicRendererCount = 20',
  'MaximumFinalToxicMaterialCount = 5',
  'MaximumFinalToxicMeshCount = 2',
  'MaximumAllEffectRendererCount = 78',
  'MaximumAllEffectMaterialCount = 19',
  'MaximumAllEffectMeshCount = 4',
  'Kromka_Effect_BoundaryPoisonFog_MEP.mat',
  'Kromka_Effect_LowFogBank.asset',
  'ToxicFog_Iteration20_BoundaryPoisonVeils_MEP',
  'BoundaryPoisonVeils_4_REFERENCE',
  'FourSidedInnerRimPlacement_REFERENCE',
  'EffectsGlobalRendererBudget_78_REFERENCE',
  'EffectsGlobalMaterialBudget_19_REFERENCE',
  'EffectsGlobalMeshBudget_4_REFERENCE',
  'EffectStageFinalAudit_REFERENCE',
  'EffectIteration_20_of_20',
  'candidate.vertexCount <= 24',
  'GetComponentsInChildren<ParticleSystem>(true)',
  'GetComponentsInChildren<LODGroup>(true).Length == 0',
  'ValidateIteration20',
  '[KROMKA EFFECTS 100%] PASS'
], 'Kromka effect iteration 20 boundary poison and final effect audit');
includes(toxicFogShader, [
  'Kromka/Global Map/Toxic Fog',
  'Licensed MEP toxic-fog atlas',
  'Blend SrcAlpha OneMinusSrcAlpha',
  'ZWrite Off',
  '_FrameRate',
  '_DriftAmount',
  '_PulseSpeed',
  '_GlowStrength',
  'atlasUvSecondary',
  'radialFade',
  'MixFog'
], 'Kromka animated transparent toxic-fog shader');
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
includes(globalCapture, [
  'CaptureModelIteration01',
  'ValidateAndCaptureModelIteration01',
  'RebuildValidateAndCaptureModelIteration01',
  'ValidateCompletedTerrainAndTextureStages',
  'EnvironmentModels_ModelPass_EDITABLE',
  'models-05pct.png',
  '[KROMKA MODELS 5%]'
], 'Kromka model iteration 01 review capture');
includes(globalCapture, [
  'CaptureModelIteration02',
  'ValidateAndCaptureModelIteration02',
  'RebuildValidateAndCaptureModelIteration02',
  'CaptureModelStage',
  'models-10pct.png',
  '[KROMKA MODELS 10%]'
], 'Kromka model iteration 02 review capture');
includes(globalCapture, [
  'CaptureModelIteration03',
  'ValidateAndCaptureModelIteration03',
  'RebuildValidateAndCaptureModelIteration03',
  'models-15pct.png',
  '[KROMKA MODELS 15%]'
], 'Kromka model iteration 03 review capture');
includes(globalCapture, [
  'CaptureModelIteration04',
  'ValidateAndCaptureModelIteration04',
  'RebuildValidateAndCaptureModelIteration04',
  'models-20pct.png',
  '[KROMKA MODELS 20%]'
], 'Kromka model iteration 04 review capture');
includes(globalCapture, [
  'CaptureModelIteration05',
  'ValidateAndCaptureModelIteration05',
  'RebuildValidateAndCaptureModelIteration05',
  'models-25pct.png',
  '[KROMKA MODELS 25%]'
], 'Kromka model iteration 05 review capture');
includes(globalCapture, [
  'CaptureModelIteration06',
  'ValidateAndCaptureModelIteration06',
  'RebuildValidateAndCaptureModelIteration06',
  'models-30pct.png',
  '[KROMKA MODELS 30%]'
], 'Kromka model iteration 06 review capture');
includes(globalCapture, [
  'CaptureModelIteration07',
  'ValidateAndCaptureModelIteration07',
  'RebuildValidateAndCaptureModelIteration07',
  'models-35pct.png',
  '[KROMKA MODELS 35%]'
], 'Kromka model iteration 07 review capture');
includes(globalCapture, [
  'CaptureModelIteration08',
  'ValidateAndCaptureModelIteration08',
  'RebuildValidateAndCaptureModelIteration08',
  'models-40pct.png',
  '[KROMKA MODELS 40%]'
], 'Kromka model iteration 08 review capture');
includes(globalCapture, [
  'CaptureModelIteration09',
  'ValidateAndCaptureModelIteration09',
  'RebuildValidateAndCaptureModelIteration09',
  'models-45pct.png',
  '[KROMKA MODELS 45%]'
], 'Kromka model iteration 09 review capture');
includes(globalCapture, [
  'CaptureModelIteration10',
  'ValidateAndCaptureModelIteration10',
  'RebuildValidateAndCaptureModelIteration10',
  'models-50pct.png',
  '[KROMKA MODELS 50%]'
], 'Kromka model iteration 10 review capture');
includes(globalCapture, [
  'CaptureModelIteration11',
  'ValidateAndCaptureModelIteration11',
  'RebuildValidateAndCaptureModelIteration11',
  'models-55pct.png',
  '[KROMKA MODELS 55%]'
], 'Kromka model iteration 11 review capture');
includes(globalCapture, [
  'CaptureModelIteration12',
  'ValidateAndCaptureModelIteration12',
  'RebuildValidateAndCaptureModelIteration12',
  'models-60pct.png',
  '[KROMKA MODELS 60%]'
], 'Kromka model iteration 12 review capture');
includes(globalCapture, [
  'CaptureModelIteration13',
  'ValidateAndCaptureModelIteration13',
  'RebuildValidateAndCaptureModelIteration13',
  'models-65pct.png',
  '[KROMKA MODELS 65%]'
], 'Kromka model iteration 13 review capture');
includes(globalCapture, [
  'CaptureModelIteration14',
  'ValidateAndCaptureModelIteration14',
  'RebuildValidateAndCaptureModelIteration14',
  'models-70pct.png',
  '[KROMKA MODELS 70%]'
], 'Kromka model iteration 14 review capture');
includes(globalCapture, [
  'CaptureModelIteration15',
  'ValidateAndCaptureModelIteration15',
  'RebuildValidateAndCaptureModelIteration15',
  'models-75pct.png',
  '[KROMKA MODELS 75%]'
], 'Kromka model iteration 15 review capture');
includes(globalCapture, [
  'CaptureModelIteration16',
  'ValidateAndCaptureModelIteration16',
  'RebuildValidateAndCaptureModelIteration16',
  'models-80pct.png',
  '[KROMKA MODELS 80%]'
], 'Kromka model iteration 16 review capture');
includes(globalCapture, [
  'CaptureModelIteration17',
  'ValidateAndCaptureModelIteration17',
  'RebuildValidateAndCaptureModelIteration17',
  'models-85pct.png',
  '[KROMKA MODELS 85%]'
], 'Kromka model iteration 17 review capture');
includes(globalCapture, [
  'CaptureModelIteration18',
  'ValidateAndCaptureModelIteration18',
  'RebuildValidateAndCaptureModelIteration18',
  'models-90pct.png',
  '[KROMKA MODELS 90%]'
], 'Kromka model iteration 18 review capture');
includes(globalCapture, [
  'CaptureModelIteration19',
  'ValidateAndCaptureModelIteration19',
  'RebuildValidateAndCaptureModelIteration19',
  'models-95pct.png',
  '[KROMKA MODELS 95%]'
], 'Kromka model iteration 19 review capture');
includes(globalCapture, [
  'CaptureModelIteration20',
  'ValidateAndCaptureModelIteration20',
  'RebuildValidateAndCaptureModelIteration20',
  'models-100pct.png',
  '[KROMKA MODELS 100%]'
], 'Kromka model iteration 20 review capture');
includes(globalCapture, [
  'CaptureEffectIteration01',
  'ValidateAndCaptureEffectIteration01',
  'RebuildValidateAndCaptureEffectIteration01',
  'CaptureEffectStage',
  'Effects_EffectPass_EDITABLE',
  'render one warm-up frame, then the capture',
  'effects-05pct.png',
  '[KROMKA EFFECTS 5%]'
], 'Kromka effect iteration 01 review capture');
includes(globalCapture, [
  'CaptureEffectIteration02',
  'ValidateAndCaptureEffectIteration02',
  'RebuildValidateAndCaptureEffectIteration02',
  'effects-10pct.png',
  '[KROMKA EFFECTS 10%]'
], 'Kromka effect iteration 02 review capture');
includes(globalCapture, [
  'CaptureEffectIteration03',
  'ValidateAndCaptureEffectIteration03',
  'RebuildValidateAndCaptureEffectIteration03',
  'effects-15pct.png',
  '[KROMKA EFFECTS 15%]'
], 'Kromka effect iteration 03 review capture');
includes(globalCapture, [
  'CaptureEffectIteration04',
  'ValidateAndCaptureEffectIteration04',
  'RebuildValidateAndCaptureEffectIteration04',
  'effects-20pct.png',
  '[KROMKA EFFECTS 20%]'
], 'Kromka effect iteration 04 review capture');
includes(globalCapture, [
  'CaptureEffectIteration05',
  'ValidateAndCaptureEffectIteration05',
  'RebuildValidateAndCaptureEffectIteration05',
  'effects-25pct.png',
  '[KROMKA EFFECTS 25%]'
], 'Kromka effect iteration 05 review capture');
includes(globalCapture, [
  'CaptureEffectIteration06',
  'ValidateAndCaptureEffectIteration06',
  'RebuildValidateAndCaptureEffectIteration06',
  'effects-30pct.png',
  '[KROMKA EFFECTS 30%]'
], 'Kromka effect iteration 06 review capture');
includes(globalCapture, [
  'CaptureEffectIteration07',
  'ValidateAndCaptureEffectIteration07',
  'RebuildValidateAndCaptureEffectIteration07',
  'effects-35pct.png',
  '[KROMKA EFFECTS 35%]'
], 'Kromka effect iteration 07 review capture');
includes(globalCapture, [
  'CaptureEffectIteration08',
  'ValidateAndCaptureEffectIteration08',
  'RebuildValidateAndCaptureEffectIteration08',
  'effects-40pct.png',
  '[KROMKA EFFECTS 40%]'
], 'Kromka effect iteration 08 review capture');
includes(globalCapture, [
  'CaptureEffectIteration09',
  'ValidateAndCaptureEffectIteration09',
  'RebuildValidateAndCaptureEffectIteration09',
  'effects-45pct.png',
  '[KROMKA EFFECTS 45%]'
], 'Kromka effect iteration 09 review capture');
includes(globalCapture, [
  'CaptureEffectIteration10',
  'ValidateAndCaptureEffectIteration10',
  'RebuildValidateAndCaptureEffectIteration10',
  'effects-50pct.png',
  '[KROMKA EFFECTS 50%]'
], 'Kromka effect iteration 10 review capture');
includes(globalCapture, [
  'CaptureEffectIteration11',
  'ValidateAndCaptureEffectIteration11',
  'RebuildValidateAndCaptureEffectIteration11',
  'ValidateCompletedEffectStagesThrough10',
  'effects-55pct.png',
  '[KROMKA EFFECTS 55%]'
], 'Kromka effect iteration 11 review capture');
includes(globalCapture, [
  'CaptureEffectIteration12',
  'ValidateAndCaptureEffectIteration12',
  'RebuildValidateAndCaptureEffectIteration12',
  'effects-60pct.png',
  '[KROMKA EFFECTS 60%]'
], 'Kromka effect iteration 12 review capture');
includes(globalCapture, [
  'CaptureEffectIteration13',
  'ValidateAndCaptureEffectIteration13',
  'RebuildValidateAndCaptureEffectIteration13',
  'effects-65pct.png',
  '[KROMKA EFFECTS 65%]'
], 'Kromka effect iteration 13 review capture');
includes(globalCapture, [
  'CaptureEffectIteration14',
  'ValidateAndCaptureEffectIteration14',
  'RebuildValidateAndCaptureEffectIteration14',
  'effects-70pct.png',
  '[KROMKA EFFECTS 70%]'
], 'Kromka effect iteration 14 review capture');
includes(globalCapture, [
  'CaptureEffectIteration15',
  'ValidateAndCaptureEffectIteration15',
  'RebuildValidateAndCaptureEffectIteration15',
  'effects-75pct.png',
  '[KROMKA EFFECTS 75%]'
], 'Kromka effect iteration 15 review capture');
includes(globalCapture, [
  'CaptureEffectIteration16',
  'ValidateAndCaptureEffectIteration16',
  'RebuildValidateAndCaptureEffectIteration16',
  'ValidateCompletedEffectStagesThrough15',
  'effects-80pct.png',
  '[KROMKA EFFECTS 80%]'
], 'Kromka effect iteration 16 review capture');
includes(globalCapture, [
  'CaptureEffectIteration17',
  'ValidateAndCaptureEffectIteration17',
  'RebuildValidateAndCaptureEffectIteration17',
  'effects-85pct.png',
  '[KROMKA EFFECTS 85%]'
], 'Kromka effect iteration 17 review capture');
includes(globalCapture, [
  'CaptureEffectIteration18',
  'ValidateAndCaptureEffectIteration18',
  'RebuildValidateAndCaptureEffectIteration18',
  'effects-90pct.png',
  '[KROMKA EFFECTS 90%]'
], 'Kromka effect iteration 18 review capture');
includes(globalCapture, [
  'CaptureEffectIteration19',
  'ValidateAndCaptureEffectIteration19',
  'RebuildValidateAndCaptureEffectIteration19',
  'effects-95pct.png',
  '[KROMKA EFFECTS 95%]'
], 'Kromka effect iteration 19 review capture');
includes(globalCapture, [
  'CaptureEffectIteration20',
  'ValidateAndCaptureEffectIteration20',
  'RebuildValidateAndCaptureEffectIteration20',
  'effects-100pct.png',
  '[KROMKA EFFECTS 100%]'
], 'Kromka effect iteration 20 review capture');
includes(globalCapture, [
  'CaptureGlobalMapVisualAuditViews',
  'RebuildAndCaptureGlobalMapVisualAuditViews',
  'visual-audit-west.png',
  'visual-audit-north.png',
  'visual-audit-east.png',
  'visual-audit-south.png',
  '[KROMKA VISUAL AUDIT]'
], 'Kromka low-angle global-map visual audit capture set');
includes(globalCapture, [
  'CaptureGlobalMapVisualDetailViews',
  'CaptureSector',
  'visual-detail-sluices.png',
  'visual-detail-ore-arc.png',
  'visual-detail-middle-vein.png',
  'visual-detail-tract.png',
  'visual-detail-glasslands.png',
  'visual-detail-chalk.png',
  'visual-detail-ravine.png',
  'visual-detail-zero.png',
  'visual-detail-silent-ring.png',
  'visual-models-soviet-housing.png',
  'visual-models-soviet-substation.png',
  'visual-models-soviet-garage.png',
  'visual-models-glasslands-utility.png',
  'visual-models-silent-ring-utility.png',
  'visual-models-ore-industrial-warehouse.png',
  'visual-debug-ravine-no-effects.png',
  'visual-debug-chalk-no-effects.png',
  'visual-debug-glasslands-no-effects.png',
  '[KROMKA VISUAL DETAIL AUDIT]'
], 'Kromka close regional visual audit capture set');
includes(globalVisualDefectAudit, [
  'KromkaGlobalMapVisualDefectAudit',
  'visual-defect-audit.txt',
  'BoundsInsideLandmass',
  'IsUnityPrimitive',
  'HasAuthoredTexture',
  'MeshInsideLandmass',
  'SCENE PRIMITIVES OUTSIDE MODEL PASS',
  'LOCATION RENDERERS OUTSIDE LANDMASS',
  'OVERSIZED LOCATION MARKERS',
  'DUST CARDS OUTSIDE LANDMASS',
  'OVERSIZED DUST CARDS',
  'FOG CARDS OUTSIDE LANDMASS',
  'TALL FOG CARDS',
  'OVERSIZED DAM ELEMENTS',
  'Global-map visual defect audit found',
  '/ThirdParty/Kenney/',
  '[KROMKA VISUAL DEFECT AUDIT]'
], 'Kromka global-map visual defect inventory');
includes(globalSovietReplacements, [
  'KromkaGlobalMapSovietReplacementAuthoring',
  'Assets/ThirdParty/SovietCC0/',
  'SovietPanelHouse/spah9lvl.FBX',
  'ResidentialBlock/my_panel16_14.obj',
  'SovietGarage/SMGarage.FBX',
  'ElectricalSubstation/ElectricSubstation.FBX',
  'PostSovietFence/zaborec.obj',
  'SovietPostSoviet_CC0_Replacements_EDITABLE',
  'SovietCC0Landmarks_31_REFERENCE',
  'NoKenneySpaceOrCarModels_REFERENCE',
  'NoUnityPrimitiveLandmarks_REFERENCE',
  'StrategicShorelineClearance_REFERENCE',
  'ResidentialTextures',
  'SubstationTextures',
  'FenceTextures',
  'ModelImporterMaterialImportMode.ImportStandard',
  'ApplyMaterials',
  'SelectMaterial',
  'SourcePitch',
  '|| kind == AssetKind.Substation',
  'CullMode.Off',
  'lost its long, low garage silhouette',
  'distinctAlbedos >= 25',
  'ContainsMapPoint',
  'BoundsInsideLandmass',
  'ConfigureModelImporters',
  'Validate()',
  '[KROMKA SOVIET REPLACEMENTS]'
], 'Kromka Soviet and post-Soviet CC0 replacement pass');
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
includes(globalTerrainShader, [
  'Realm of Ashes/Kromka Global Terrain',
  '_BaseTex',
  '_NorthTex',
  '_OreTex',
  '_GlassTex',
  '_ChalkTex',
  '_ZeroTex',
  '_CliffTex',
  '_WetTex',
  '_GranuleTex',
  '_DustTex',
  '_PeatTex',
  '_PatinaTex',
  '_MicroDustTex',
  '_BoundaryWarp',
  '_TransitionWidth',
  '_MacroTiling',
  '_MacroBlend',
  '_MacroVariation',
  '_PatinaTiling',
  '_PatinaMacroTiling',
  '_PatinaStrength',
  '_ChromaticCompression',
  '_DustVeil',
  '_WashContrast',
  'SampleTwoScale',
  'macroTone',
  'SampleCliff',
  'slopeSignal',
  'slopeWeight',
  'weathering',
  'patinaBreakup',
  'protectedDeposits',
  'dryFlat',
  'washTone',
  'SegmentDistance',
  'TesmaDistance',
  'floodplainWet',
  'northernBeds',
  'zeroBeds',
  'wetWeight',
  'OreDepositDistance',
  'GlassDepositDistance',
  'ChalkDepositDistance',
  'ZeroPeatDistance',
  'DepositRibbon',
  'oreDepositMask',
  'glassDepositMask',
  'chalkDepositMask',
  'peatDepositMask',
  'EllipseMask',
  'ValueNoise',
  'OrganicPoint',
  'OrganicWeight',
  'boundaryBreakup',
  'float2(380.0, 300.0)',
  'ringMask'
], 'Kromka MEP global terrain shader');
assert(!globalComposer.includes('ReliefStone_'),
  'random sphere relief must not cover the continuous authored mesh');

includes(globalComposer, ['KromkaGlobalMapBoundaryAuthoring.Compose(parent)'],
  'Kromka lore boundary composition');
includes(globalComposer,
  ['KromkaGlobalMapOuterWastelandAuthoring.ComposeIteration01(parent)',
    'KromkaGlobalMapOuterWastelandIteration02Authoring.Compose(parent)'],
  'Kromka outer wasteland 10-percent composition');
includes(globalBoundary, [
  'WorldEdge_AUTHORED',
  'ToxicBoundaryFog_AUTHORED',
  'BoundaryLine',
  'TerrainApron_FadesIntoStorm',
  'TesmaMountainHeadwaters_REFERENCE',
  'SparseRockRidges_MEP',
  'BrokenBarrierFragments_MEP',
  'SparseWarningBeacons_AUTHORED',
  'DustStormPerimeter_AUTHORED',
  'NoContinuousWall_LoreRule_REFERENCE',
  'RoaGlobalMapBoundary',
  'ParticleSystemShapeType.Box',
  'Validate()'
], 'Kromka lore boundary authoring');
includes(runtimeBoundary, [
  'ContainsWorldPoint',
  'ClosestWorldPoint',
  '_localPoints'
], 'runtime irregular boundary geometry');
includes(runtimeGlobalMap, [
  '_playableBoundary',
  '_playableBoundary.ContainsWorldPoint(hit.point)',
  '_playableBoundary.ClosestWorldPoint(hit)',
  'Дальше — буря. Пути нет.'
], 'runtime Kromka boundary refusal');
includes(globalCapture, [
  'CaptureLoreBoundaryReviewSet',
  'boundary-overview.png',
  'ValidateAndCaptureTesmaHydrology',
  'tesma-headwaters-desktop.png',
  'tesma-full-grade-mobile-landscape.png',
  'SimulateParticles(scene)'
], 'Kromka boundary visual review');

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
  'Экспортировать глобальную карту в data',
  'definition["objects"] = exported',
  'definition["spawn"] = arrival.DeepClone()',
  'row["footprint"]',
  'row["unityAuthored"] = true',
  'ExportAnomalyLayout(authoring)',
  'row["points"] = new JArray',
  'row["unityBoundary"]'
], 'Unity-to-server spatial exporter');

includes(sceneRuntime, ['_replaceServerStaticGeometry = true', 'GroundRenderer', 'ReplaceServerStaticGeometry'],
  'Unity location runtime contract');
includes(loader, ['unityScene.GroundRenderer', 'unityScene.ReplaceServerStaticGeometry'],
  'Unity scene loading contract');

const expectedScenes = catalog.locations.length + 1;
console.log(`Unity Kromka authoring OK: ${catalog.locations.length} editable local scenes + global scene, `
  + `${typeHandlers.size} location grammars, ${regionMethods.size} region languages and Unity-to-server export.`);
console.log(`Editor generation target: ${expectedScenes} Kromka scenes.`);
