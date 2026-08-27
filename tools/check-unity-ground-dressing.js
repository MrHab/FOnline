'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const dressing = read('unity-client/Assets/Scripts/World/RoaGroundDressing.cs');
const terrain = read('unity-client/Assets/Scripts/World/RoaLocalTerrain.cs');
const probe = read('unity-client/Assets/Editor/RoaGroundDressingProbe.cs');
const audit = read('unity-client/Assets/Editor/RoaClientAuditRunner.cs');

[
  'public static int SurfaceBudget(bool mobile)',
  'return mobile ? 60 : 120;',
  'public static int RidgeBudget(bool mobile)',
  'return mobile ? 16 : 28;',
  'public const float MinimumSurfaceSpacing = 0.72f;',
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
  'TileType(stateMap, tx + 1, tz, mapWidth, mapDepth) == Path',
  'public int PathConnectionCount',
].forEach(marker => assert(terrain.includes(marker), `RoaLocalTerrain не подключает оформление: ${marker}`));

[
  'RoaGroundDressing.SupportsTile(3)',
  'GetComponentsInChildren<Collider>(true).Length == 0',
  'terrain.ApplyMap(water)',
  'ROA_GROUND_DRESSING_CAPTURE',
  'DarkPixelRatio(readback.GetPixels32())',
  'darkRatio < 0.0075f',
  'expectedDetailSize = Application.isMobilePlatform ? 64 : 128',
  'RoaGroundDressing.StoneClusterPieceCount >= 4',
  'RoaGroundDressing.ScrubBladeCount >= 6',
  'RoaGroundDressing.ScrubLobeCount == 3',
  'generator.DryScrubClusterCount + generator.OliveScrubClusterCount',
  'sharedMesh.subMeshCount',
  'renderer.shadowCastingMode == ShadowCastingMode.Off',
  'sharedMaterial.shader.name.Contains("Unlit")',
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
