'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const unity = path.join(root, 'unity-client');
const scenePath = path.join(unity, 'Assets', 'Scenes', 'GlobalMapAuthored.unity');
const prefabDir = path.join(unity, 'Assets', 'Prefabs', 'GlobalMap');
const meshDir = path.join(unity, 'Assets', 'Art', 'GlobalMap', 'Meshes');
const mepMaterialDir = path.join(unity, 'Assets', 'Art', 'GlobalMap', 'MEPMaterials');

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesWithExtension(directory, extension) {
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter(file => file.endsWith(extension)).sort()
    : [];
}

function assetGuid(...parts) {
  const metaPath = `${path.join(root, ...parts)}.meta`;
  assert(fs.existsSync(metaPath), `Unity asset meta is missing: ${path.relative(root, metaPath)}`);
  const match = fs.readFileSync(metaPath, 'utf8').match(/^guid:\s*([0-9a-f]{32})/mi);
  assert(match, `Unity asset has no valid GUID: ${path.relative(root, metaPath)}`);
  return match[1];
}

assert(fs.existsSync(scenePath), 'Assets/Scenes/GlobalMapAuthored.unity is missing');
assert(fs.existsSync(prefabDir), 'Assets/Prefabs/GlobalMap is missing');

const scene = fs.readFileSync(scenePath, 'utf8');
const runtime = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMap.cs');
const bridge = read('unity-client', 'Assets', 'Scripts', 'World', 'RoaUnityGlobalMapScene.cs');
const authoring = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapAuthoringTools.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapAuthoredProbe.cs');
const lifecycleProbe = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapLifecycleProbe.cs');
const presentationProbe = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapPresentationProbe.cs');
const liveActorsProbe = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapLiveActorsProbe.cs');
const stressActorsProbe = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapActorStressProbe.cs');
const auditRunner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const actorView = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMapActorView.cs');
const characterView = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaCharacterView.cs');
const mapCanvas = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaGlobalMapCanvas.cs');
const seamAuthoring = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapSeamAuthoring.cs');
const roadAuthoring = read('unity-client', 'Assets', 'Editor', 'RoaGlobalMapRoadAuthoring.cs');
const environmentAuthoring = read('unity-client', 'Assets', 'Editor',
  'RoaGlobalMapEnvironmentAuthoring.cs');
const landmarkAuthoring = read('unity-client', 'Assets', 'Editor',
  'RoaGlobalMapLandmarkAuthoring.cs');
const guide = read('docs', 'UNITY_GLOBAL_MAP_AUTHORING.md');
const build = read('unity-client', 'ProjectSettings', 'EditorBuildSettings.asset');
const saltMaterial = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Materials', 'GM_Salt.mat');
const roadMaterial = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Materials', 'GM_Road.mat');
const oceanShader = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Shaders',
  'GM_WestOcean.shader');
const horizonShader = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Shaders',
  'GM_HorizonTerrain.shader');
const toxicFogShader = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Shaders',
  'GM_ToxicBoundaryFog.shader');
const oceanMaterial = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Materials',
  'GM_WestOcean.mat');
const horizonMaterial = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Materials',
  'GM_HorizonTerrain.mat');
const toxicFogMaterial = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Materials',
  'GM_ToxicBoundaryFog.mat');
const oceanMesh = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Meshes',
  'GM_Mesh_WestOcean.asset');
const horizonMesh = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Meshes',
  'GM_Mesh_HorizonTerrain.asset');
const toxicFogMesh = read('unity-client', 'Assets', 'Art', 'GlobalMap', 'Meshes',
  'GM_Mesh_ToxicBoundaryFog.asset');
const oceanPrefab = read('unity-client', 'Assets', 'Prefabs', 'GlobalMap',
  'GM_WestOcean.prefab');
const horizonPrefab = read('unity-client', 'Assets', 'Prefabs', 'GlobalMap',
  'GM_HorizonTerrain.prefab');
const toxicFogPrefab = read('unity-client', 'Assets', 'Prefabs', 'GlobalMap',
  'GM_ToxicBoundaryFog.prefab');
const map = JSON.parse(read('data', 'global-map.json'));

for (const layer of [
  'StaticContent',
  'Ground',
  'Infrastructure',
  'Locations',
  'Decor',
  'DynamicContent_SERVER_STATE',
  'RuntimeHandles',
  'SelectionSurface_EDITABLE_BOUNDS'
]) {
  assert(scene.includes(`m_Name: ${layer}`), `Authored global-map layer is missing: ${layer}`);
}

for (const node of map.nodes || []) {
  assert(node && node.id, 'global-map node has no stable id');
  assert(scene.includes(`_nodeId: ${node.id}`), `Unity scene has no node anchor for ${node.id}`);
}

const prefabInstances = (scene.match(/m_SourcePrefab:/g) || []).length;
const curatedLandmarks = (scene.match(/value: Curated_/g) || []).length;
assert(prefabInstances >= 20,
  `GlobalMapAuthored contains too few prefab instances (${prefabInstances})`);
assert(landmarkAuthoring.includes('Seed = 20260902')
  && landmarkAuthoring.includes('"Curated_" + Categories[i].Name')
  && landmarkAuthoring.includes('collider.enabled = false')
  && landmarkAuthoring.includes('ApplyBakedMaterials(')
  && landmarkAuthoring.includes('ExpectedVisibleGroundY')
  && landmarkAuthoring.includes('EditorSceneManager.SaveScene('),
  'Landmark authoring cannot deterministically rebuild the Decor layer from MEP scenes');
assert((scene.match(/\n  - Kind: /g) || []).length === 14,
  'GlobalMapAuthored must serialize all 14 live-prefab catalogue slots');
assert(!scene.includes('_routeLine:') && !scene.includes('LineRenderer:'),
  'GlobalMapAuthored still contains the retired generated route line');
assert(scene.includes('m_Name: GlobalMapSun_AUTHORED')
  && scene.includes('--- !u!108 &2147001002')
  && scene.includes('m_Intensity: 1.45'),
  'GlobalMapAuthored must contain its dedicated warm directional light');
assert(saltMaterial.includes('guid: 832a7ce0389e3844a8e7a4f07a39d254')
  && !saltMaterial.includes('- _BaseMap:\n        m_Texture: {fileID: 0}'),
  'Salt biome must use an authored MEP terrain texture instead of a flat grey material');
assert(roadMaterial.includes('guid: 03f62994ad7fd9d40934a1e6f921a6f3')
  && !roadMaterial.includes('guid: b7b')
  && roadMaterial.includes('_BaseColor: {r: 1.16, g: 1.02, b: 0.78, a: 1}'),
  'Authored roads must use a light stone-ground texture instead of a building prop texture');
assert(scene.includes('m_Name: BiomeTransitions_AUTHORED')
  && (scene.match(/value: BiomeBlend_/g) || []).length === 0,
  'GlobalMapAuthored must keep the biome-seam layer empty (art decision 2026-09-02)');
assert(seamAuthoring.includes('ExpectedPlacementCount = 0')
  && seamAuthoring.includes('MEP_StoneGround_Sand.prefab')
  && seamAuthoring.includes('Cracked_Mud_03.prefab')
  && seamAuthoring.includes('colliders[c].enabled = false')
  && seamAuthoring.includes('GroundSurfaceY = -0.13f')
  && seamAuthoring.includes('GroundToSurface(instance, GroundSurfaceY, GroundEmbedDepth)')
  && seamAuthoring.includes('EditorSceneManager.SaveScene(scene)'),
  'Seamless-biome authoring cannot deterministically rebuild safe prefab transitions');
assert(scene.includes('m_Name: RoadNetwork_AUTHORED')
  && scene.includes('m_Name: RoadLandmarks_AUTHORED')
  && (scene.match(/value: RoadPiece_/g) || []).length === 0
  && (scene.match(/value: PipelinePiece_/g) || []).length === 0
  && (scene.match(/value: RoadLandmark_/g) || []).length === 14,
  'GlobalMapAuthored must keep the road network empty and 14 curated road landmarks');
assert(roadAuthoring.includes('ExpectedRoadPieceCount = 0')
  && roadAuthoring.includes('ExpectedPipelinePieceCount = 0')
  && roadAuthoring.includes('ExpectedLandmarkCount = 14')
  && roadAuthoring.includes('MaximumPieceLength = 6f')
  && roadAuthoring.includes('../../data/global-map.json')
  && roadAuthoring.includes('DisableColliders(instance)')
  && roadAuthoring.includes('GroundSurfaceY = -0.13f')
  && roadAuthoring.includes('GroundToSurface(instance, GroundSurfaceY, embedDepth, placement.GroundPatch)')
  && roadAuthoring.includes('map-sized black wedges')
  && roadAuthoring.includes('EditorSceneManager.SaveScene(scene)'),
  'Road authoring cannot deterministically rebuild safe prefab infrastructure');

const waterCells = Object.values(map.cells || {}).filter(cell => {
  const texture = String(cell?.texture || '').trim().toLowerCase();
  return texture === 'water' || texture === 'ocean'
    || texture === 'sea' || texture === 'lake';
}).length;
assert(waterCells === 101,
  `Global-map west ocean must remain exactly 101 authored water cells (found ${waterCells})`);
assert(scene.includes('m_Name: BiomeDetail_AUTHORED')
  && (scene.match(/value: BiomeDetail_/g) || []).length === 0,
  'GlobalMapAuthored must keep the biome-detail layer empty (art decision 2026-09-02)');
assert(scene.includes('m_Name: WorldEdge_AUTHORED')
  && (scene.match(/value: WestOcean_AUTHORED/g) || []).length === 1
  && (scene.match(/value: HorizonTerrain_AUTHORED/g) || []).length === 1
  && (scene.match(/value: ToxicBoundaryFog_AUTHORED/g) || []).length === 1
  && scene.includes('m_Name: WestCoastDetail_AUTHORED')
  && (scene.match(/value: CoastDetail_/g) || []).length === 0,
  'GlobalMapAuthored must contain the saved west ocean and horizon without coast details');
assert(environmentAuthoring.includes('ExpectedBiomeDetailCount = 0')
  && environmentAuthoring.includes('ExpectedCoastDetailCount = 0')
  && environmentAuthoring.includes('ExpectedWaterCellCount = 101')
  && environmentAuthoring.includes('HorizonExtent = 220f')
  && environmentAuthoring.includes('ToxicFogInnerExtent = 41.5f')
  && environmentAuthoring.includes('ToxicFogOuterExtent = 170f')
  && environmentAuthoring.includes('ExpectedVisibleGroundY = -0.13f')
  && environmentAuthoring.includes('ExpectedGroundedExistingCount = 18')
  && environmentAuthoring.includes('PopulateBiomeDetails(')
  && environmentAuthoring.includes('PopulateCoastDetails(')
  && environmentAuthoring.includes('DisableColliders(instance)')
  && environmentAuthoring.includes('SaveMesh(BuildOceanMesh(), OceanMeshPath)')
  && environmentAuthoring.includes('SaveMesh(BuildHorizonMesh(), HorizonMeshPath)')
  && environmentAuthoring.includes('SaveMesh(BuildToxicFogMesh(), ToxicFogMeshPath)')
  && environmentAuthoring.includes('vertices.Add(new Vector3(x, 0.24f, z))')
  && environmentAuthoring.includes('ResolveVisibleGroundY(')
  && environmentAuthoring.includes('GroundExistingDecoration(')
  && environmentAuthoring.includes('EditorSceneManager.SaveScene(scene)'),
  'Environment authoring cannot deterministically rebuild 3.4 biome/ocean/fog/grounding assets');

const oceanShaderGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Shaders', 'GM_WestOcean.shader');
const horizonShaderGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Shaders', 'GM_HorizonTerrain.shader');
const toxicFogShaderGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Shaders', 'GM_ToxicBoundaryFog.shader');
const oceanMaterialGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Materials', 'GM_WestOcean.mat');
const horizonMaterialGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Materials', 'GM_HorizonTerrain.mat');
const toxicFogMaterialGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Materials', 'GM_ToxicBoundaryFog.mat');
const oceanMeshGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Meshes', 'GM_Mesh_WestOcean.asset');
const horizonMeshGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Meshes', 'GM_Mesh_HorizonTerrain.asset');
const toxicFogMeshGuid = assetGuid('unity-client', 'Assets', 'Art', 'GlobalMap',
  'Meshes', 'GM_Mesh_ToxicBoundaryFog.asset');
assert(oceanShader.includes('Shader "Universal Render Pipeline/Realm of Ashes/Global Map West Ocean"')
  && horizonShader.includes('Shader "Universal Render Pipeline/Realm of Ashes/Global Map Horizon"')
  && toxicFogShader.includes('Shader "Universal Render Pipeline/Realm of Ashes/Global Map Toxic Boundary Fog"')
  && toxicFogShader.includes('Blend SrcAlpha OneMinusSrcAlpha')
  && toxicFogShader.includes('smoothstep(-3.50h, 0.15h, outside)')
  && toxicFogShader.includes('smoothstep(2.0h, 8.0h, cameraDistance)')
  && toxicFogMaterial.includes('- _Density: 0.96')
  && toxicFogMaterial.includes('- _VerticalMotion: 0')
  && toxicFogShader.includes('ComputeFogIntensity(input.fogFactor)'),
  'Global-map ocean/horizon/toxic fog must use their custom URP shaders');
assert(oceanMaterial.includes(`guid: ${oceanShaderGuid}`)
  && horizonMaterial.includes(`guid: ${horizonShaderGuid}`)
  && toxicFogMaterial.includes(`guid: ${toxicFogShaderGuid}`),
  'Saved ocean/horizon/toxic-fog materials are not linked to their custom shaders');
assert(oceanMesh.includes('m_Name: GM_Mesh_WestOcean')
  && horizonMesh.includes('m_Name: GM_Mesh_HorizonTerrain')
  && toxicFogMesh.includes('m_Name: GM_Mesh_ToxicBoundaryFog')
  && Number((oceanMesh.match(/m_VertexCount:\s*(\d+)/) || [0, 0])[1]) >= 1000
  && Number((horizonMesh.match(/m_VertexCount:\s*(\d+)/) || [0, 0])[1]) >= 1000
  && Number((toxicFogMesh.match(/m_VertexCount:\s*(\d+)/) || [0, 0])[1]) >= 2000,
  'Saved ocean/horizon/toxic-fog meshes are missing or no longer detailed');
assert(oceanPrefab.includes(`guid: ${oceanMeshGuid}`)
  && oceanPrefab.includes(`guid: ${oceanMaterialGuid}`)
  && horizonPrefab.includes(`guid: ${horizonMeshGuid}`)
  && horizonPrefab.includes(`guid: ${horizonMaterialGuid}`)
  && toxicFogPrefab.includes(`guid: ${toxicFogMeshGuid}`)
  && toxicFogPrefab.includes(`guid: ${toxicFogMaterialGuid}`),
  'Ocean/horizon/toxic-fog prefabs are not linked to their saved mesh/material assets');

const requiredPrefabs = [
  'GM_Ground_Desert.prefab',
  'GM_Ground_Rocky.prefab',
  'GM_Ground_Salt.prefab',
  'GM_WestOcean.prefab',
  'GM_HorizonTerrain.prefab',
  'GM_ToxicBoundaryFog.prefab',
  'GM_RoadSegment.prefab',
  'GM_PipelineSegment.prefab',
  'GM_RockCluster.prefab',
  'GM_Location_OldKlim.prefab',
  'GM_Location_ScrapTown.prefab',
  'GM_Location_RelayStation.prefab',
  'GM_Location_CaravanCamp.prefab',
  'GM_PlayerMarker.prefab',
  'GM_SelectionMarker.prefab',
  'GM_LiveSiteMarker.prefab',
  'GM_LivePartyMarker.prefab',
  'GM_TrackedTaskMarker.prefab',
  'GM_SettlementStatusMarker.prefab',
  'GM_TerritoryCell.prefab',
  'GM_TerritoryBorder.prefab',
  'GM_InfluenceRing.prefab',
  'GM_RouteDash.prefab',
  'GM_Activity_Caravan.prefab',
  'GM_Activity_Distress.prefab',
  'GM_Activity_Recon.prefab',
  'GM_Activity_Resource.prefab',
  'GM_Activity_Defense.prefab',
  'GM_Activity_Assault.prefab'
];
for (const file of requiredPrefabs) {
  assert(fs.existsSync(path.join(prefabDir, file)), `Global-map prefab is missing: ${file}`);
}
assert(filesWithExtension(prefabDir, '.prefab').length === requiredPrefabs.length,
  'GlobalMap prefab directory contains retired or untracked prefab assets');
assert(!fs.existsSync(path.join(prefabDir, 'GM_OverlayLine.prefab')),
  'Retired GM_OverlayLine prefab still exists');

const primitiveMeshGuid = 'guid: 0000000000000000e000000000000000';
for (const file of requiredPrefabs) {
  const yaml = fs.readFileSync(path.join(prefabDir, file), 'utf8');
  assert(!yaml.includes(primitiveMeshGuid), `${file} still uses a Unity primitive mesh`);
  assert(!yaml.includes('LineRenderer:'), `${file} still uses generated LineRenderer geometry`);
}

const mepCompositePrefabs = [
  'GM_RockCluster.prefab',
  'GM_Location_OldKlim.prefab',
  'GM_Location_ScrapTown.prefab',
  'GM_Location_RelayStation.prefab',
  'GM_Location_CaravanCamp.prefab',
  'GM_LiveSiteMarker.prefab',
  'GM_LivePartyMarker.prefab',
  'GM_Activity_Caravan.prefab',
  'GM_Activity_Distress.prefab',
  'GM_Activity_Recon.prefab',
  'GM_Activity_Resource.prefab',
  'GM_Activity_Defense.prefab',
  'GM_Activity_Assault.prefab'
];
for (const file of mepCompositePrefabs) {
  const yaml = fs.readFileSync(path.join(prefabDir, file), 'utf8');
  assert(yaml.includes('m_SourcePrefab:'), `${file} has no nested MEP prefab instance`);
}

assert(filesWithExtension(meshDir, '.asset').length >= 12,
  'Checked-in authored global-map meshes are incomplete');
assert(filesWithExtension(mepMaterialDir, '.mat').length >= 15,
  'Map-local URP material copies for MEP models are incomplete');

for (const forbidden of [
  'new Mesh',
  'new Material(',
  'new GameObject',
  'GameObject.CreatePrimitive',
  'AddComponent<Mesh',
  'LineRenderer',
  'BuildBucketedMesh',
  'MeshBucket',
  'CreateDynamicMaterial',
  'BuildOceanMesh',
  'BuildHorizonMesh',
  'BuildToxicFogMesh',
  'RoaGlobalMapEnvironmentAuthoring',
  'GM_WestOcean',
  'GM_HorizonTerrain',
  'GM_ToxicBoundaryFog',
  'RoaGlobalMapSiteMeshBuilder',
  'SiteMeshVertexCount',
  'SiteMeshSubMeshCount',
  'OverlayLine'
]) {
  assert(!runtime.includes(forbidden), `Runtime global map still creates visual content: ${forbidden}`);
}
assert(runtime.includes('RoaGlobalMapPrefabKind.TerritoryCell')
  && runtime.includes('RoaGlobalMapPrefabKind.TerritoryBorder')
  && runtime.includes('RoaGlobalMapPrefabKind.InfluenceRing')
  && runtime.includes('RoaGlobalMapPrefabKind.RouteDash'),
  'Territories, influence and routes are not prefab-driven');
assert(runtime.includes('private void ConfigureMapLighting()')
  && runtime.includes('private void RestoreMapLighting()')
  && runtime.includes('RenderSettings.ambientMode = AmbientMode.Trilight')
  && runtime.includes('RenderSettings.sun = candidate'),
  'Global-map lighting is not isolated from local-world lighting');
assert(runtime.includes('public static MapPresentationProfile PresentationProfile')
  && runtime.includes('TargetKindVisibleAtTier')
  && runtime.includes('PresentationTargetWinner')
  && runtime.includes('InfrastructureLabelLimit = 3')
  && runtime.includes('InfrastructureShortTitle(')
  && runtime.includes('RouteVisualScale('),
  'Semantic zoom and filtered target selection are not wired at runtime');
for (const kind of [
  'ActivityCaravan', 'ActivityDistress', 'ActivityRecon',
  'ActivityResource', 'ActivityDefense', 'ActivityAssault'
]) {
  assert(runtime.includes(`RoaGlobalMapPrefabKind.${kind}`),
    `Activity prefab is not wired at runtime: ${kind}`);
}
assert(runtime.includes('renderer.SetPropertyBlock(_colorBlock)')
  && !runtime.includes('renderer.sharedMaterial ='),
  'Runtime tinting must use MaterialPropertyBlock without material instantiation');
assert(runtime.includes('private void EnsureRuntimeState()')
  && runtime.includes('private MaterialPropertyBlock _colorBlock;')
  && !runtime.includes('private MaterialPropertyBlock _colorBlock = new MaterialPropertyBlock()')
  && runtime.includes('if (_colorBlock == null) _colorBlock = new MaterialPropertyBlock()')
  && runtime.includes('if (_dynamicTargets == null) _dynamicTargets = new List<DynamicTarget>()')
  && runtime.includes('_dynamicTargets?.Clear()')
  && runtime.includes('_territoryByCell?.Clear()'),
  'Global-map managed state is not resilient to Unity script reload and repeated cleanup');
assert(lifecycleProbe.includes('NullManagedState(map)')
  && lifecycleProbe.includes('clear.Invoke(map, null)')
  && lifecycleProbe.includes('map.Configure(null, null, null, null)'),
  'Unity lifecycle probe does not reproduce null managed state and repeated cleanup');
assert(presentationProbe.includes('PresentationProfile(RoaGlobalMap.MapDetailTier.Far)')
  && presentationProbe.includes('TargetKindVisibleAtTier')
  && presentationProbe.includes('InfrastructureLabelLimit == 3')
  && presentationProbe.includes('RouteVisualScale(0.6f, 0.6f'),
  'Unity presentation probe does not cover semantic zoom and hidden target layers');
assert(runtime.includes('Dictionary<string, PartyActorState> _partyActors')
  && runtime.includes('private PartyActorState EnsurePartyActor(string id)')
  && runtime.includes('private void IndexExistingPartyActors()')
  && runtime.includes('private void UpdatePartyActors()')
  && runtime.includes('public static GlobalMapPoint WorldPartyDisplayPoint')
  && runtime.includes('_ = partyActor.Actor.ConfigureParty(BaseUrl, row)')
  && runtime.includes('_ = _playerActor.ConfigurePlayer(BaseUrl, self ?? new JObject())')
  && runtime.includes('WastelandSnapshotIsStale'),
  'Unity global map does not preserve, render and smoothly advance authoritative live actors');
assert(actorView.includes('sealed class RoaGlobalMapActorView')
  && actorView.includes('Dictionary<string, Task<GltfImport>> ModelCache')
  && actorView.includes('if (Ready) return Task.CompletedTask')
  && actorView.includes('TryRendererContentBounds')
  && actorView.includes('StrategicActorContent')
  && actorView.includes('SetPresentationLod(RoaActorPresentationTier tier)')
  && actorView.includes('transform.InverseTransformDirection(_motionDirection)')
  && actorView.includes('return "friendlyBrahmin"')
  && actorView.includes('return "enemySuperMutant"')
  && actorView.includes('return "enemyRaider"')
  && actorView.includes('RoaCharacterView')
  && actorView.includes('PlayCreatureClip(_moving ? "walk" : "idle")'),
  'Strategic actor view does not load real humanoid/creature GLBs with map locomotion');
assert(characterView.includes('Dictionary<string, Task<GltfImport>> ModelLoads')
  && characterView.includes('_animationLibraryLoad = LoadSharedImport'),
  'Humanoid GLB loading is not shared while many party representatives arrive together');
assert(bridge.includes('instance.transform.localScale = prefab.transform.localScale'),
  'Global-map prefab pool does not restore authored scale before reuse');
assert(mapCanvas.includes('OverlayLabelScreenSize(frame.Cluster, frame.Activity')
  && mapCanvas.includes('public static Vector2 OverlayLabelCanvasSize')
  && mapCanvas.includes('public static Vector2 OverlayLabelScreenSize'),
  'Global-map labels are not sized in stable Canvas units');
assert(liveActorsProbe.includes('DisplayPoint(party, 5f)')
  && liveActorsProbe.includes('106f, 102.4f')
  && liveActorsProbe.includes('DisplayPoint(party, 60f)')
  && liveActorsProbe.includes('VerifyWastelandSnapshotOrdering()')
  && liveActorsProbe.includes('VerifyPartyModelMappings()')
  && liveActorsProbe.includes('VerifyOverlayLabelScaling()')
  && liveActorsProbe.includes('public static async Task RunModelsAsync()')
  && liveActorsProbe.includes('"friendlyBrahmin", "enemySuperMutant", "enemyFireGecko"')
  && liveActorsProbe.includes('Task.WhenAll(')
  && auditRunner.includes('typeof(RoaGlobalMapLiveActorsProbe)'),
  'Unity live-actor regression probe is incomplete or missing from the client audit');
assert(stressActorsProbe.includes('public const int PartyCount = 33')
  && stressActorsProbe.includes('public static async Task RunStressAsync()')
  && stressActorsProbe.includes('VerifyAssetReuse(views)')
  && stressActorsProbe.includes('VerifyAnimationBudget(views)')
  && stressActorsProbe.includes('VerifyCenteredTurning(roots, views)'),
  'Unity global-map 33-party stress probe is incomplete');

assert(bridge.includes('RoaGlobalMapPrefabSlot[] _livePrefabs')
  && bridge.includes('Stack<GameObject>')
  && bridge.includes('ReleaseLivePrefab')
  && bridge.includes('foreach (RoaGlobalMapPrefabKind kind in Enum.GetValues'),
  'Authored scene bridge does not validate and pool the full prefab catalogue');

assert(!fs.existsSync(path.join(unity, 'Assets', 'Editor', 'RoaGlobalMapSceneGenerator.cs')),
  'Global-map scene generator must not ship after the authored migration');
assert(!fs.existsSync(path.join(unity, 'Assets', 'Scripts', 'Game', 'RoaGlobalMapSiteMeshBuilder.cs')),
  'Retired procedural global-map site mesh builder still exists');
assert(authoring.includes('public const string ScenePath = "Assets/Scenes/GlobalMapAuthored.unity"')
  && authoring.includes('node["x"] = Math.Round(point.x, 2)')
  && authoring.includes('node["y"] = Math.Round(point.y, 2)'),
  'Unity authoring tools cannot open, validate and export manually moved settlements');
assert(probe.includes('public static void RunBatch()')
  && probe.includes('CountPrefabInstances(scene)')
  && probe.includes('marker.InstantiateLivePrefab(kind, temporary.transform)')
  && probe.includes('RoaGlobalMapSeamAuthoring.ExpectedPlacementCount')
  && probe.includes('RoaGlobalMapRoadAuthoring.ExpectedRoadPieceCount')
  && probe.includes('RoaGlobalMapRoadAuthoring.ExpectedLandmarkCount')
  && probe.includes('ValidateAuthoredEnvironment(marker, map)')
  && probe.includes('ExpectedBiomeDetailCount')
  && probe.includes('ExpectedCoastDetailCount')
  && probe.includes('ExpectedWaterCellCount')
  && probe.includes('oceanBounds.min.x <= -200f')
  && probe.includes('oceanBounds.size.z >= 400f')
  && probe.includes('ValidateHorizonOutsideSelection(horizon, selectionBounds)')
  && probe.includes('ValidateFogOutsideSelection(toxicFog')
  && probe.includes('ValidateVisibleGround(marker.StaticContentRoot)')
  && probe.includes('Require(grounded == 18')
  && probe.includes('GetPrefabAssetPathOfNearestInstanceRoot')
  && probe.includes('World-edge and coast decoration colliders must stay disabled.'),
  'Unity authored-map probe does not validate prefab instances and live markers');
assert(guide.includes('StaticContent/Decor')
  && guide.includes('Workflow 3.4')
  && guide.includes('Применить детальные биомы и океан 3.4')
  && guide.includes('BiomeDetail_AUTHORED')
  && guide.includes('WestOcean_AUTHORED')
  && guide.includes('HorizonTerrain_AUTHORED')
  && guide.includes('ToxicBoundaryFog_AUTHORED')
  && guide.includes('Камера и MMB')
  && guide.includes('RoaGlobalMapNodeAnchor')
  && guide.includes('No Generated Global Map'),
  'Global-map manual authoring guide is incomplete');
assert(build.includes('Assets/Scenes/GlobalMapAuthored.unity'),
  'GlobalMapAuthored is not included in Unity build settings');

console.log(`Unity no-generated global map OK: ${map.nodes.length} nodes, ${prefabInstances} scene prefab instances, ${curatedLandmarks} curated landmarks, ${requiredPrefabs.length} visual prefabs`);
require('./check-unity-model-prefabs').run();
require('./check-unity-global-map-stress').run();
