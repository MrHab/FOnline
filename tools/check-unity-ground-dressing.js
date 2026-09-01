'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const dressing = read('unity-client/Assets/Scripts/World/RoaGroundDressing.cs');
const terrain = read('unity-client/Assets/Scripts/World/RoaLocalTerrain.cs');
const palette = read('unity-client/Assets/Scripts/World/RoaEnvironmentPalette.cs');
const authoring = read('unity-client/Assets/Editor/RoaEnvironmentPaletteAuthoring.cs');
const probe = read('unity-client/Assets/Editor/RoaGroundDressingProbe.cs');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');
const paletteAsset = path.join(
  ROOT,
  'unity-client/Assets/Resources/RealmOfAshes/EnvironmentPalette.asset'
);

assert(fs.existsSync(paletteAsset), 'curated MEP Resources palette asset is missing');

[
  'public static int SurfaceBudget(bool mobile)',
  'return mobile ? 24 : 40;',
  'public static int RidgeBudget(bool mobile)',
  'return mobile ? 8 : 12;',
  'public const float MinimumSurfaceSpacing = 1.35f;',
  'Mathf.Lerp(0.60f, 0.95f, sizeRandom)',
  'Mathf.Lerp(0.48f, 0.78f, sizeRandom)',
  'public const int ScrubLobeCount = 3;',
  'public const int ScrubToneCount = 2;',
  'public static bool SupportsTile(int type)',
  'return type == Grass || type == Dark;',
  'KeepClear(location, x, z, mapWidth, mapDepth, settlement)',
  'AppendScrub(',
  'ScrubToneIndex(i, seed)',
  'new[] { _scrubMaterial, _secondaryScrubMaterial }',
  'AppendStoneCluster(',
  'AppendStone(',
  'AppendTaperedBranch(',
  'PatchDensity(',
  'NearestDistance(',
  'AppendDistantRidge(',
  'Resources.Load<RoaEnvironmentPalette>(RoaEnvironmentPalette.ResourceKey)',
  'AppendAuthoredPrefab(',
  'AppendAuthoredRidges(',
  'StripGameplayComponents(',
  'BuildCompatibleMaterials(',
  'CompatibleMaterialCount',
  'Universal Render Pipeline/Lit',
  'ConfigureOpaqueSurface(',
  'castContactShadow',
  'public bool UsesAuthoredPrefabs',
  'public int AuthoredPrefabCount',
  'public int AuthoredShadowCasterCount',
  'public int GroundAccentCount',
  'CreateRenderNode("Scrub", _scrubMesh,',
  'new GameObject("GroundDressing")',
  'new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer))',
].forEach(marker => assert(dressing.includes(marker), `Нет Unity-маркера оформления земли: ${marker}`));

assert(!/AddComponent<[^>]*Collider/.test(dressing)
  && !/typeof\([^)]*Collider\)/.test(dressing),
'Декоративное оформление земли не должно создавать игровые коллайдеры');

[
  'private RoaGroundDressing _groundDressing;',
  'gameObject.AddComponent<RoaGroundDressing>()',
  '_groundDressing.Build(_location, stateMap, mapWidth, mapDepth, _visualWidth, _visualDepth);',
  'public int SurfaceDetailClusterCount',
  'public int DistantRidgeCount',
  'public int DetailVertexCount',
  'public int MicroDetailTextureSize',
  'ApplyMicroDetail(_material, location != null ? location.Seed : 1L);',
  'material.EnableKeyword("_DETAIL_MULX2")',
  'public static int AlbedoResolution(bool mobile)',
  'return mobile ? 512 : 1024;',
  'public static float SurfaceMacroSample(float worldX, float worldZ, int seed)',
  'float worldX = (x / (_textureSize - 1f) - 0.5f) * _visualWidth;',
  'float worldZ = (y / (_textureSize - 1f) - 0.5f) * _visualDepth;',
  'float macro = SurfaceMacroSample(worldX, worldZ, seed);',
  'PaintPathConnection(',
  'JitteredTileCenter(',
  'TileType(stateMap, tx + 1, tz, mapWidth, mapDepth) == Path',
  'public int PathConnectionCount',
  'public bool UsesAuthoredEnvironment',
  'public int AuthoredEnvironmentPrefabCount',
].forEach(marker => assert(terrain.includes(marker), `RoaLocalTerrain не подключает оформление: ${marker}`));

[
  'public const string ResourceKey = "RealmOfAshes/EnvironmentPalette";',
  '[SerializeField] private GameObject[] _dryScrubs;',
  '[SerializeField] private GameObject[] _stones;',
  '[SerializeField] private GameObject[] _groundAccents;',
  '[SerializeField] private GameObject[] _distantRidges;',
  'public bool Ready',
  'PickDryScrub(',
  'PickGroundAccent(',
].forEach(marker => assert(palette.includes(marker), `Environment palette is incomplete: ${marker}`));

[
  'Assets/Resources/RealmOfAshes/EnvironmentPalette.asset',
  'MEP_Grass_A_02_Dry.prefab',
  'MEP_StoneGround_a_Sand.prefab',
  'Cracked_Mud_03.prefab',
  'MEP_Desert_Cliff_06.prefab',
  'AssetDatabase.CreateAsset(palette, AssetPath)',
].forEach(marker => assert(authoring.includes(marker), `Environment palette authoring is incomplete: ${marker}`));

[
  'RoaGroundDressing.SupportsTile(3)',
  'GetComponentsInChildren<Collider>(true).Length == 0',
  'terrain.ApplyMap(water)',
  'ROA_GROUND_DRESSING_CAPTURE',
  'DefaultCaptureName = "WorldReadability44.png"',
  'DarkPixelRatio(pixels)',
  'MagentaPixelRatio(pixels)',
  'magentaRatio < 0.0001f',
  'BrightPixelRatio(pixels)',
  'brightRatio < 0.18f',
  'darkRatio < 0.0075f',
  'expectedDetailSize = Application.isMobilePlatform ? 64 : 128',
  'palette != null && palette.Ready',
  'terrain.UsesAuthoredEnvironment',
  'terrain.AuthoredEnvironmentPrefabCount',
  'generator.AuthoredPrefabCount',
  'generator.AuthoredRendererCount',
  'generator.AuthoredShadowCasterCount',
  'generator.GroundAccentCount',
  'generator.MaximumDecorationHeight',
  'renderer.shadowCastingMode != ShadowCastingMode.ShadowsOnly',
  '!material.name.StartsWith("RuntimeGround", StringComparison.Ordinal)',
  'generator.MinimumClusterSpacing >= RoaGroundDressing.MinimumSurfaceSpacing',
  'terrain.PathConnectionCount == 17',
  'terrain.AlbedoTextureSize == RoaLocalTerrain.AlbedoResolution(',
  'RoaLocalTerrain.SurfaceMacroSample(',
  'macroMax - macroMin > 0.18f && macroStep < 0.16f',
  'декор земли снова сливается в почти чёрные точки',
  '[ОФОРМЛЕНИЕ ЗЕМЛИ] готово:',
].forEach(marker => assert(probe.includes(marker), `Проба оформления земли неполна: ${marker}`));

assert(audit.includes('typeof(RoaGroundDressingProbe)'),
  'Проба оформления земли не включена в общий Unity-аудит');

console.log('Unity ground dressing check passed.');
