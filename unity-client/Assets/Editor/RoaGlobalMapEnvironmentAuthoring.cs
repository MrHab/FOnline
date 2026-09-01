#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Saves the detailed strategic biomes, west ocean and fog-hidden horizon as
    /// normal project assets and prefab instances. Nothing is generated at runtime.
    /// </summary>
    public static class RoaGlobalMapEnvironmentAuthoring
    {
        public const string BiomeDetailLayerName = "BiomeDetail_AUTHORED";
        public const string WorldEdgeLayerName = "WorldEdge_AUTHORED";
        public const string CoastDetailLayerName = "WestCoastDetail_AUTHORED";
        public const int ExpectedBiomeDetailCount = 144;
        public const int ExpectedCoastDetailCount = 24;
        public const int ExpectedWaterCellCount = 101;
        public const float HorizonExtent = 220f;
        // A soft visual overlap hides the 90x90 ground/horizon join. The fog has no
        // collider, so the authoritative playable selection surface remains unchanged.
        public const float ToxicFogInnerExtent = 41.5f;
        public const float ToxicFogOuterExtent = 170f;
        public const float ExpectedVisibleGroundY = -0.13f;
        public const int ExpectedGroundedExistingCount = 69;

        public const string OceanMeshPath =
            "Assets/Art/GlobalMap/Meshes/GM_Mesh_WestOcean.asset";
        public const string HorizonMeshPath =
            "Assets/Art/GlobalMap/Meshes/GM_Mesh_HorizonTerrain.asset";
        public const string ToxicFogMeshPath =
            "Assets/Art/GlobalMap/Meshes/GM_Mesh_ToxicBoundaryFog.asset";
        public const string OceanMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_WestOcean.mat";
        public const string HorizonMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_HorizonTerrain.mat";
        public const string ToxicFogMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_ToxicBoundaryFog.mat";
        public const string OceanPrefabPath =
            "Assets/Prefabs/GlobalMap/GM_WestOcean.prefab";
        public const string HorizonPrefabPath =
            "Assets/Prefabs/GlobalMap/GM_HorizonTerrain.prefab";
        public const string ToxicFogPrefabPath =
            "Assets/Prefabs/GlobalMap/GM_ToxicBoundaryFog.prefab";

        private const float MapHalfExtent = 45f;
        private const int DetailPerMacroTile = 16;
        private const string DesertGroundMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_Desert.mat";
        private const string RockyGroundMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_Rocky.mat";
        private const string SaltGroundMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_Salt.mat";
        private const string OceanShaderName =
            "Universal Render Pipeline/Realm of Ashes/Global Map West Ocean";
        private const string HorizonShaderName =
            "Universal Render Pipeline/Realm of Ashes/Global Map Horizon";
        private const string ToxicFogShaderName =
            "Universal Render Pipeline/Realm of Ashes/Global Map Toxic Boundary Fog";
        private const string WaterNormalPath =
            "Assets/MEP/MEP_Environment/MEP_FX/Water_Placeholder/MEP_Water_Placeholder_Nor.png";

        private const string Rock01Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Rock_01/Prefabs/MEP_Rock_01_N_a_Sand.prefab";
        private const string Rock03Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Rock_02_03/Prefabs/MEP_Rock_03_b_Sand.prefab";
        private const string Cliff02Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_02/Prefabs/Cliff_02_02_N.prefab";
        private const string Cliff03Prefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_03/Prefabs/Cliff_03_04_N.prefab";
        private const string GrassPrefab =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Grass/MEP_Desert_Grass/Prefabs/MEP_DGrass_Grp_01.prefab";
        private const string BushPrefab =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Bushes/Prefabs/MEP_Bush_02_c_N.prefab";
        private const string DeadTreePrefab =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/DeadTrees/DeadTree_01/Prefabs/MEP_DeadTree_03_N.prefab";
        private const string BrokenTreePrefab =
            "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/MEP_BrokenTrees/Prefabs/MEP_BrokenDeadTree_02_N.prefab";
        private const string StoneGroundPrefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_Sand.prefab";
        private const string CrackedMudPrefab =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_03.prefab";

        private const string Rock01Material =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Rock_01_Dif_Sand_925cbba3.mat";
        private const string Rock03Material =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Rock_02-03_Dif_Desert_af942719.mat";
        private const string Cliff02Material =
            "Assets/Art/GlobalMap/MEPMaterials/Cliff_02_cb45918b.mat";
        private const string Cliff03Material =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Cliff_03_c0c5f3a1.mat";
        private const string GrassMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Desert_Grass_f491bb91.mat";
        private const string BushMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Brush_02_e559954f.mat";
        private const string DeadTreeMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_Deadtree_01_62065c2b.mat";
        private const string BrokenTreeMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_BrokenDeadTree_4dd67474.mat";
        private const string StoneGroundMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/MEP_StoneGround_Desert_f3580c39.mat";
        private const string CrackedMudMaterial =
            "Assets/Art/GlobalMap/MEPMaterials/Cracked_Mud_b13c2d72.mat";

        private static readonly Vector2[] Coastline =
        {
            new Vector2(0.105f, 0.00f), new Vector2(0.070f, 0.08f),
            new Vector2(0.082f, 0.16f), new Vector2(0.055f, 0.25f),
            new Vector2(0.106f, 0.36f), new Vector2(0.090f, 0.48f),
            new Vector2(0.142f, 0.62f), new Vector2(0.126f, 0.73f),
            new Vector2(0.184f, 0.86f), new Vector2(0.154f, 1.00f)
        };

        private readonly struct DetailAsset
        {
            public readonly string PrefabPath;
            public readonly string MaterialPath;
            public readonly float MinimumFootprint;
            public readonly float MaximumFootprint;
            public readonly bool GroundPatch;

            public DetailAsset(string prefabPath, string materialPath,
                               float minimumFootprint, float maximumFootprint,
                               bool groundPatch = false)
            {
                PrefabPath = prefabPath;
                MaterialPath = materialPath;
                MinimumFootprint = minimumFootprint;
                MaximumFootprint = maximumFootprint;
                GroundPatch = groundPatch;
            }
        }

        private static readonly DetailAsset[] DesertDetails =
        {
            new DetailAsset(GrassPrefab, GrassMaterial, 0.85f, 1.55f),
            new DetailAsset(BushPrefab, BushMaterial, 0.65f, 1.25f),
            new DetailAsset(Rock01Prefab, Rock01Material, 0.85f, 1.65f),
            new DetailAsset(Rock03Prefab, Rock03Material, 0.75f, 1.45f),
            new DetailAsset(DeadTreePrefab, DeadTreeMaterial, 1.05f, 1.65f),
            new DetailAsset(BrokenTreePrefab, BrokenTreeMaterial, 1.05f, 1.75f),
            new DetailAsset(StoneGroundPrefab, StoneGroundMaterial, 2.4f, 4.1f, true),
            new DetailAsset(CrackedMudPrefab, CrackedMudMaterial, 2.8f, 4.8f, true)
        };

        private static readonly DetailAsset[] RockyDetails =
        {
            new DetailAsset(Rock01Prefab, Rock01Material, 1.05f, 2.1f),
            new DetailAsset(Rock03Prefab, Rock03Material, 0.95f, 1.9f),
            new DetailAsset(Cliff02Prefab, Cliff02Material, 2.1f, 3.8f),
            new DetailAsset(Cliff03Prefab, Cliff03Material, 2.2f, 4.0f),
            new DetailAsset(StoneGroundPrefab, StoneGroundMaterial, 2.8f, 4.5f, true),
            new DetailAsset(BushPrefab, BushMaterial, 0.65f, 1.15f)
        };

        private static readonly DetailAsset[] SaltDetails =
        {
            new DetailAsset(CrackedMudPrefab, SaltGroundMaterialPath, 3.1f, 5.2f, true),
            new DetailAsset(StoneGroundPrefab, SaltGroundMaterialPath, 2.7f, 4.7f, true),
            new DetailAsset(Rock01Prefab, Rock01Material, 0.75f, 1.35f),
            new DetailAsset(Rock03Prefab, Rock03Material, 0.7f, 1.3f),
            new DetailAsset(BrokenTreePrefab, BrokenTreeMaterial, 0.9f, 1.45f),
            new DetailAsset(DeadTreePrefab, DeadTreeMaterial, 0.9f, 1.35f)
        };

        private static readonly DetailAsset[] GreenDetails =
        {
            new DetailAsset(GrassPrefab, GrassMaterial, 1.0f, 1.75f),
            new DetailAsset(GrassPrefab, GrassMaterial, 0.9f, 1.55f),
            new DetailAsset(BushPrefab, BushMaterial, 0.75f, 1.4f),
            new DetailAsset(BushPrefab, BushMaterial, 0.65f, 1.2f),
            new DetailAsset(DeadTreePrefab, DeadTreeMaterial, 1.0f, 1.55f),
            new DetailAsset(BrokenTreePrefab, BrokenTreeMaterial, 0.95f, 1.55f),
            new DetailAsset(StoneGroundPrefab, StoneGroundMaterial, 2.2f, 3.7f, true)
        };

        private static readonly DetailAsset[] CoastDetails =
        {
            new DetailAsset(Cliff02Prefab, Cliff02Material, 3.4f, 5.4f),
            new DetailAsset(Rock01Prefab, Rock01Material, 1.8f, 3.1f),
            new DetailAsset(Cliff03Prefab, Cliff03Material, 3.6f, 5.6f),
            new DetailAsset(Rock03Prefab, Rock03Material, 1.7f, 3.0f)
        };

        [MenuItem("Realm of Ashes/Глобальная карта/Применить детальные биомы и океан 3.4", true)]
        private static bool CanApply()
        {
            return !Application.isPlaying && !EditorApplication.isCompiling;
        }

        [MenuItem("Realm of Ashes/Глобальная карта/Применить детальные биомы и океан 3.4")]
        public static void Apply()
        {
            ApplyInternal();
        }

        public static void RunBatch()
        {
            try
            {
                ApplyInternal();
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                else throw;
            }
        }

        private static void ApplyInternal()
        {
            Scene scene = SceneManager.GetSceneByPath(RoaGlobalMapAuthoringTools.ScenePath);
            bool openedHere = !scene.IsValid() || !scene.isLoaded;
            if (openedHere)
                scene = EditorSceneManager.OpenScene(RoaGlobalMapAuthoringTools.ScenePath,
                    OpenSceneMode.Additive);

            try
            {
                RoaUnityGlobalMapScene marker = FindMarker(scene)
                    ?? throw new InvalidOperationException("RoaUnityGlobalMapScene is missing.");
                JObject map = JObject.Parse(File.ReadAllText(MapPath()));
                JObject cells = map["cells"] as JObject
                    ?? throw new InvalidOperationException("Global-map cells are missing.");
                int waterCells = CountWaterCells(cells);
                if (waterCells != ExpectedWaterCellCount)
                    throw new InvalidOperationException("Expected " + ExpectedWaterCellCount
                        + " west-ocean cells, found " + waterCells + ".");

                UpgradeGroundMaterials();
                float groundY = ResolveVisibleGroundY(marker.StaticContentRoot);
                GameObject oceanPrefab = BuildOceanPrefab();
                GameObject horizonPrefab = BuildHorizonPrefab();
                GameObject toxicFogPrefab = BuildToxicFogPrefab();

                DestroyLayer(marker.StaticContentRoot, BiomeDetailLayerName);
                DestroyLayer(marker.StaticContentRoot, WorldEdgeLayerName);
                Transform biomeLayer = CreateLayer(BiomeDetailLayerName,
                    marker.StaticContentRoot, scene);
                Transform edgeLayer = CreateLayer(WorldEdgeLayerName,
                    marker.StaticContentRoot, scene);
                Transform coastLayer = CreateLayer(CoastDetailLayerName, edgeLayer, scene);

                InstantiateSavedPrefab(oceanPrefab, "WestOcean_AUTHORED", edgeLayer, scene);
                InstantiateSavedPrefab(horizonPrefab, "HorizonTerrain_AUTHORED", edgeLayer, scene);
                InstantiateSavedPrefab(toxicFogPrefab, "ToxicBoundaryFog_AUTHORED", edgeLayer, scene);

                List<Vector3> forbidden = ReadNodePositions(map);
                int biomeCount = PopulateBiomeDetails(map, cells, biomeLayer, scene, forbidden,
                    groundY);
                int coastCount = PopulateCoastDetails(coastLayer, scene, groundY);
                int groundedExisting = GroundExistingDecoration(marker.StaticContentRoot, groundY);
                if (biomeCount != ExpectedBiomeDetailCount
                    || coastCount != ExpectedCoastDetailCount
                    || groundedExisting != ExpectedGroundedExistingCount)
                    throw new InvalidOperationException("Environment placement count changed: biome="
                        + biomeCount + ", coast=" + coastCount + ", grounded="
                        + groundedExisting + ".");

                AssetDatabase.SaveAssets();
                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new InvalidOperationException("GlobalMapAuthored could not be saved.");
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА 3.4] сохранено: " + biomeCount
                    + " деталей биомов, " + coastCount + " береговых форм, "
                    + waterCells + " клетка океана; горизонт=" + HorizonExtent
                    + " м; toxic fog=" + ToxicFogOuterExtent + " м; grounded="
                    + groundedExisting + ".", marker);
            }
            finally
            {
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static GameObject BuildOceanPrefab()
        {
            Shader shader = Shader.Find(OceanShaderName)
                ?? throw new InvalidOperationException("West-ocean shader is missing.");
            var material = new Material(shader) { name = "GM_WestOcean" };
            material.SetColor("_DeepColor", new Color(0.008f, 0.055f, 0.080f, 1f));
            material.SetColor("_ShallowColor", new Color(0.055f, 0.220f, 0.240f, 1f));
            material.SetColor("_FoamColor", new Color(0.50f, 0.57f, 0.48f, 1f));
            material.SetTexture("_WaveNormal", Load<Texture2D>(WaterNormalPath));
            material.SetFloat("_WaveScale", 0.052f);
            material.SetFloat("_WaveStrength", 0.31f);
            material.SetFloat("_Smoothness", 0.82f);
            material.SetFloat("_FoamWidth", 0.14f);
            Material oceanMaterial = SaveMaterial(material, OceanMaterialPath);
            Mesh oceanMesh = SaveMesh(BuildOceanMesh(), OceanMeshPath);
            return SaveRenderPrefab("GM_WestOcean", OceanPrefabPath, oceanMesh,
                oceanMaterial, false, false);
        }

        private static GameObject BuildHorizonPrefab()
        {
            Shader shader = Shader.Find(HorizonShaderName)
                ?? throw new InvalidOperationException("Horizon-terrain shader is missing.");
            Material desert = Load<Material>(DesertGroundMaterialPath);
            Material rocky = Load<Material>(RockyGroundMaterialPath);
            Material salt = Load<Material>(SaltGroundMaterialPath);
            var material = new Material(shader) { name = "GM_HorizonTerrain" };
            material.SetTexture("_DesertMap", desert.GetTexture("_BaseMap"));
            material.SetTexture("_RockyMap", rocky.GetTexture("_BaseMap"));
            material.SetTexture("_SaltMap", salt.GetTexture("_BaseMap"));
            material.SetColor("_Tint", new Color(0.50f, 0.41f, 0.31f, 1f));
            material.SetFloat("_WorldTiling", 0.105f);
            material.SetFloat("_Roughness", 0.87f);
            Material horizonMaterial = SaveMaterial(material, HorizonMaterialPath);
            Mesh horizonMesh = SaveMesh(BuildHorizonMesh(), HorizonMeshPath);
            return SaveRenderPrefab("GM_HorizonTerrain", HorizonPrefabPath, horizonMesh,
                horizonMaterial, true, true);
        }

        private static GameObject BuildToxicFogPrefab()
        {
            Shader shader = Shader.Find(ToxicFogShaderName)
                ?? throw new InvalidOperationException("Toxic-boundary fog shader is missing.");
            var material = new Material(shader) { name = "GM_ToxicBoundaryFog" };
            material.SetColor("_ToxicColor", new Color(0.055f, 0.20f, 0.025f, 1f));
            material.SetColor("_DarkColor", new Color(0.003f, 0.018f, 0.003f, 1f));
            material.SetColor("_GlowColor", new Color(0.16f, 0.32f, 0.045f, 1f));
            material.SetColor("_BoundaryColor", new Color(0.30f, 0.44f, 0.05f, 1f));
            material.SetFloat("_Density", 0.96f);
            material.SetFloat("_NoiseScale", 0.075f);
            material.SetVector("_FlowSpeed", new Vector4(0.035f, 0.018f, -0.026f, 0.029f));
            material.SetFloat("_PulseSpeed", 0.52f);
            material.SetFloat("_VerticalMotion", 0f);
            Material fogMaterial = SaveMaterial(material, ToxicFogMaterialPath);
            Mesh fogMesh = SaveMesh(BuildToxicFogMesh(), ToxicFogMeshPath);
            return SaveRenderPrefab("GM_ToxicBoundaryFog", ToxicFogPrefabPath, fogMesh,
                fogMaterial, false, false);
        }

        private static Mesh BuildOceanMesh()
        {
            const int coastSegments = 128;
            const int depthSegments = 12;
            var vertices = new Vector3[(coastSegments + 1) * (depthSegments + 1)];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[coastSegments * depthSegments * 6];
            int vertex = 0;
            for (int row = 0; row <= coastSegments; row++)
            {
                float z = Mathf.Lerp(HorizonExtent, -HorizonExtent,
                    (float)row / coastSegments);
                float coastX = CoastWorldXAtZ(z);
                for (int column = 0; column <= depthSegments; column++)
                {
                    float t = (float)column / depthSegments;
                    float curved = 1f - Mathf.Pow(1f - t, 1.28f);
                    float x = Mathf.Lerp(-HorizonExtent, coastX, curved);
                    vertices[vertex] = new Vector3(x, -0.045f, z);
                    float coastDistance = Mathf.Max(0f, coastX - x);
                    uv[vertex] = new Vector2(Mathf.Clamp01(1f - coastDistance / 18f),
                        (float)row / coastSegments * 8f);
                    vertex++;
                }
            }

            int index = 0;
            int stride = depthSegments + 1;
            for (int row = 0; row < coastSegments; row++)
            for (int column = 0; column < depthSegments; column++)
            {
                int a = row * stride + column;
                int b = a + 1;
                int c = a + stride;
                int d = c + 1;
                triangles[index++] = a;
                triangles[index++] = b;
                triangles[index++] = c;
                triangles[index++] = b;
                triangles[index++] = d;
                triangles[index++] = c;
            }

            var mesh = new Mesh { name = "GM_Mesh_WestOcean", indexFormat = IndexFormat.UInt32 };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh BuildHorizonMesh()
        {
            var vertices = new List<Vector3>(5000);
            var colors = new List<Color>(5000);
            var triangles = new List<int>(8000);
            float northCoast = CoastWorldXAtZ(MapHalfExtent);
            float southCoast = CoastWorldXAtZ(-MapHalfExtent);
            AddHorizonSection(vertices, colors, triangles,
                northCoast, HorizonExtent, MapHalfExtent, HorizonExtent, 15f);
            AddHorizonSection(vertices, colors, triangles,
                southCoast, HorizonExtent, -HorizonExtent, -MapHalfExtent, 15f);
            AddHorizonSection(vertices, colors, triangles,
                MapHalfExtent, HorizonExtent, -MapHalfExtent, MapHalfExtent, 15f);

            var mesh = new Mesh { name = "GM_Mesh_HorizonTerrain", indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            mesh.SetColors(colors);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh BuildToxicFogMesh()
        {
            var vertices = new List<Vector3>(12000);
            var colors = new List<Color>(12000);
            var triangles = new List<int>(20000);
            const float step = 14f;
            for (int layer = 0; layer < 1; layer++)
            {
                AddToxicFogSection(vertices, colors, triangles,
                    -ToxicFogOuterExtent, ToxicFogOuterExtent,
                    ToxicFogInnerExtent, ToxicFogOuterExtent, step, layer);
                AddToxicFogSection(vertices, colors, triangles,
                    -ToxicFogOuterExtent, ToxicFogOuterExtent,
                    -ToxicFogOuterExtent, -ToxicFogInnerExtent, step, layer);
                AddToxicFogSection(vertices, colors, triangles,
                    ToxicFogInnerExtent, ToxicFogOuterExtent,
                    -ToxicFogInnerExtent, ToxicFogInnerExtent, step, layer);
                AddToxicFogSection(vertices, colors, triangles,
                    -ToxicFogOuterExtent, -ToxicFogInnerExtent,
                    -ToxicFogInnerExtent, ToxicFogInnerExtent, step, layer);
            }

            var mesh = new Mesh
            {
                name = "GM_Mesh_ToxicBoundaryFog",
                indexFormat = IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetColors(colors);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddToxicFogSection(List<Vector3> vertices, List<Color> colors,
                                               List<int> triangles, float minX, float maxX,
                                               float minZ, float maxZ, float step, int layer)
        {
            int columns = Mathf.Max(1, Mathf.CeilToInt((maxX - minX) / step));
            int rows = Mathf.Max(1, Mathf.CeilToInt((maxZ - minZ) / step));
            for (int row = 0; row < rows; row++)
            for (int column = 0; column < columns; column++)
            {
                float x0 = Mathf.Lerp(minX, maxX, (float)column / columns);
                float x1 = Mathf.Lerp(minX, maxX, (float)(column + 1) / columns);
                float z0 = Mathf.Lerp(minZ, maxZ, (float)row / rows);
                float z1 = Mathf.Lerp(minZ, maxZ, (float)(row + 1) / rows);
                int start = vertices.Count;
                AddToxicFogVertex(vertices, colors, x0, z0, layer);
                AddToxicFogVertex(vertices, colors, x0, z1, layer);
                AddToxicFogVertex(vertices, colors, x1, z0, layer);
                AddToxicFogVertex(vertices, colors, x1, z1, layer);
                triangles.Add(start);
                triangles.Add(start + 1);
                triangles.Add(start + 2);
                triangles.Add(start + 2);
                triangles.Add(start + 1);
                triangles.Add(start + 3);
            }
        }

        private static void AddToxicFogVertex(List<Vector3> vertices, List<Color> colors,
                                              float x, float z, int layer)
        {
            // One coplanar sheet prevents cracks where the four ring sections meet.
            // Density, boundary glow and animation are evaluated continuously in world
            // space by the shader instead of being interpolated across this coarse mesh.
            vertices.Add(new Vector3(x, 0.24f, z));
            colors.Add(Color.white);
        }

        private static void AddHorizonSection(List<Vector3> vertices, List<Color> colors,
                                              List<int> triangles, float minX, float maxX,
                                              float minZ, float maxZ, float step)
        {
            int columns = Mathf.Max(1, Mathf.CeilToInt((maxX - minX) / step));
            int rows = Mathf.Max(1, Mathf.CeilToInt((maxZ - minZ) / step));
            for (int row = 0; row < rows; row++)
            for (int column = 0; column < columns; column++)
            {
                float x0 = Mathf.Lerp(minX, maxX, (float)column / columns);
                float x1 = Mathf.Lerp(minX, maxX, (float)(column + 1) / columns);
                float z0 = Mathf.Lerp(minZ, maxZ, (float)row / rows);
                float z1 = Mathf.Lerp(minZ, maxZ, (float)(row + 1) / rows);
                int start = vertices.Count;
                AddHorizonVertex(vertices, colors, x0, z0);
                AddHorizonVertex(vertices, colors, x0, z1);
                AddHorizonVertex(vertices, colors, x1, z0);
                AddHorizonVertex(vertices, colors, x1, z1);
                triangles.Add(start);
                triangles.Add(start + 1);
                triangles.Add(start + 2);
                triangles.Add(start + 2);
                triangles.Add(start + 1);
                triangles.Add(start + 3);
            }
        }

        private static void AddHorizonVertex(List<Vector3> vertices, List<Color> colors,
                                             float x, float z)
        {
            float dx = Mathf.Max(0f, Mathf.Abs(x) - MapHalfExtent);
            float dz = Mathf.Max(0f, Mathf.Abs(z) - MapHalfExtent);
            float outsideDistance = Mathf.Sqrt(dx * dx + dz * dz);
            float fade = Mathf.Clamp01(outsideDistance / (HorizonExtent - MapHalfExtent));
            float noise = Mathf.Sin(x * 0.071f + z * 0.017f) * 0.52f
                        + Mathf.Cos(z * 0.063f - x * 0.023f) * 0.36f;
            float y = -0.155f + noise * Mathf.SmoothStep(0f, 0.58f, fade)
                      - Mathf.Pow(fade, 2.25f) * 8.5f;
            Vector3 weights = HorizonBiomeWeights(x, z, fade, noise);
            vertices.Add(new Vector3(x, y, z));
            colors.Add(new Color(weights.x, weights.y, weights.z, 1f));
        }

        private static Vector3 HorizonBiomeWeights(float x, float z, float fade, float noise)
        {
            float dx = Mathf.Max(0f, Mathf.Abs(x) - MapHalfExtent);
            float dz = Mathf.Max(0f, Mathf.Abs(z) - MapHalfExtent);
            Vector3 edge;
            if (dz >= dx)
                edge = z >= 0f ? NorthEdgeWeights(x) : SouthEdgeWeights(x);
            else
                edge = EastEdgeWeights(z);
            Vector3 distant = new Vector3(
                0.58f + noise * 0.05f,
                0.32f - noise * 0.035f,
                0.10f - noise * 0.015f);
            Vector3 result = Vector3.Lerp(edge, distant, fade * 0.82f);
            float total = Mathf.Max(0.001f, result.x + result.y + result.z);
            return result / total;
        }

        private static Vector3 NorthEdgeWeights(float x)
        {
            if (x < -19f) return new Vector3(0f, 1f, 0f);
            if (x < -11f)
                return Vector3.Lerp(new Vector3(0f, 1f, 0f), Vector3.right,
                    Mathf.InverseLerp(-19f, -11f, x));
            if (x < 11f) return Vector3.right;
            if (x < 19f)
                return Vector3.Lerp(Vector3.right, Vector3.forward,
                    Mathf.InverseLerp(11f, 19f, x));
            return Vector3.forward;
        }

        private static Vector3 SouthEdgeWeights(float x)
        {
            if (x < -19f) return Vector3.forward;
            if (x < -11f)
                return Vector3.Lerp(Vector3.forward, Vector3.right,
                    Mathf.InverseLerp(-19f, -11f, x));
            return Vector3.right;
        }

        private static Vector3 EastEdgeWeights(float z)
        {
            if (z < -19f) return Vector3.right;
            if (z < -11f)
                return Vector3.Lerp(Vector3.right, Vector3.up,
                    Mathf.InverseLerp(-19f, -11f, z));
            if (z < 11f) return Vector3.up;
            if (z < 19f)
                return Vector3.Lerp(Vector3.up, Vector3.forward,
                    Mathf.InverseLerp(11f, 19f, z));
            return Vector3.forward;
        }

        private static int PopulateBiomeDetails(JObject map, JObject cells, Transform parent,
                                                Scene scene, List<Vector3> forbidden,
                                                float groundY)
        {
            int count = 0;
            for (int tileZ = 0; tileZ < 3; tileZ++)
            for (int tileX = 0; tileX < 3; tileX++)
            {
                int tileIndex = tileZ * 3 + tileX;
                float centerX = (tileX - 1) * 30f;
                float centerZ = (1 - tileZ) * 30f;
                var random = new System.Random(3307 + tileIndex * 101);
                for (int detail = 0; detail < DetailPerMacroTile; detail++)
                {
                    Vector3 position = FindDetailPosition(map, cells, centerX, centerZ,
                        random, forbidden, tileIndex, detail);
                    string texture = CellTexture(cells, position.x, position.z);
                    DetailAsset[] family = DetailFamily(texture);
                    DetailAsset asset = family[(detail + tileIndex * 3) % family.Length];
                    float footprint = Mathf.Lerp(asset.MinimumFootprint,
                        asset.MaximumFootprint, (float)random.NextDouble());
                    GameObject instance = InstantiateDetail(asset,
                        "BiomeDetail_" + TextureLabel(texture) + "_T"
                        + tileIndex.ToString("00") + "_" + detail.ToString("00"),
                        position, (float)random.NextDouble() * 360f, footprint,
                        parent, scene, groundY);
                    forbidden.Add(instance.transform.position);
                    count++;
                }
            }
            return count;
        }

        private static Vector3 FindDetailPosition(JObject map, JObject cells,
                                                  float centerX, float centerZ,
                                                  System.Random random,
                                                  List<Vector3> forbidden,
                                                  int tileIndex, int detailIndex)
        {
            for (int attempt = 0; attempt < 320; attempt++)
            {
                float x = centerX + Mathf.Lerp(-13.6f, 13.6f,
                    (float)random.NextDouble());
                float z = centerZ + Mathf.Lerp(-13.6f, 13.6f,
                    (float)random.NextDouble());
                if (IsWater(cells, x, z) || x <= CoastWorldXAtZ(z) + 3.5f) continue;
                float clearance = detailIndex % 5 == 0 ? 2.0f : 1.25f;
                if (NearForbidden(x, z, forbidden, clearance)) continue;
                if (NearInfrastructure(map, x, z, 1.15f)) continue;
                return new Vector3(x, 0f, z);
            }
            throw new InvalidOperationException("Cannot place biome detail " + detailIndex
                + " in macro tile " + tileIndex + ".");
        }

        private static int PopulateCoastDetails(Transform parent, Scene scene, float groundY)
        {
            var random = new System.Random(8841);
            for (int i = 0; i < ExpectedCoastDetailCount; i++)
            {
                float z = Mathf.Lerp(42.5f, -42.5f,
                    (i + 0.35f + (float)random.NextDouble() * 0.3f)
                    / ExpectedCoastDetailCount);
                float coastX = CoastWorldXAtZ(z);
                float neighborZ = Mathf.Clamp(z - 0.5f, -MapHalfExtent, MapHalfExtent);
                Vector2 tangent = new Vector2(CoastWorldXAtZ(neighborZ) - coastX,
                    neighborZ - z).normalized;
                Vector2 landNormal = new Vector2(-tangent.y, tangent.x);
                if (landNormal.x < 0f) landNormal = -landNormal;
                float inset = Mathf.Lerp(2.4f, 3.7f, (float)random.NextDouble());
                Vector3 position = new Vector3(coastX + landNormal.x * inset,
                    0f, z + landNormal.y * inset);
                DetailAsset asset = CoastDetails[i % CoastDetails.Length];
                float footprint = Mathf.Lerp(asset.MinimumFootprint,
                    asset.MaximumFootprint, (float)random.NextDouble());
                InstantiateDetail(asset, "CoastDetail_" + i.ToString("00"), position,
                    Mathf.Atan2(tangent.x, tangent.y) * Mathf.Rad2Deg
                        + Mathf.Lerp(-18f, 18f, (float)random.NextDouble()),
                    footprint, parent, scene, groundY);
            }
            return ExpectedCoastDetailCount;
        }

        private static GameObject InstantiateDetail(DetailAsset asset, string name,
                                                    Vector3 position, float yaw,
                                                    float footprint, Transform parent,
                                                    Scene scene, float groundY)
        {
            GameObject source = Load<GameObject>(asset.PrefabPath);
            Material material = Load<Material>(asset.MaterialPath);
            GameObject instance = PrefabUtility.InstantiatePrefab(source, scene) as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate " + name + ".");
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = position;
            instance.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            ConfigureRenderers(instance, material, asset.GroundPatch);
            DisableColliders(instance);
            float embedDepth = asset.GroundPatch
                ? 0.105f
                : Mathf.Clamp(footprint * 0.055f, 0.045f, 0.22f);
            FitToFootprint(instance, footprint, groundY, embedDepth, asset.GroundPatch);
            MarkStatic(instance);
            EditorUtility.SetDirty(instance);
            return instance;
        }

        private static void FitToFootprint(GameObject instance, float targetFootprint,
                                           float groundY, float embedDepth,
                                           bool groundPatch)
        {
            Bounds bounds = RendererBounds(instance);
            float footprint = Mathf.Max(0.001f, Mathf.Max(bounds.size.x, bounds.size.z));
            float scale = targetFootprint / footprint;
            instance.transform.localScale *= scale;
            bounds = RendererBounds(instance);
            Vector3 position = instance.transform.position;
            bool thinGroundPatch = groundPatch && bounds.size.y < 0.12f;
            position.y += thinGroundPatch
                ? groundY + 0.006f - bounds.max.y
                : groundY - embedDepth - bounds.min.y;
            instance.transform.position = position;
        }

        private static Bounds RendererBounds(GameObject instance)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0)
                throw new InvalidOperationException(instance.name + " has no renderer.");
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static float ResolveVisibleGroundY(Transform staticContentRoot)
        {
            Transform ground = staticContentRoot.Find("Ground")
                ?? throw new InvalidOperationException("Authored Ground layer is missing.");
            MeshFilter[] filters = ground.GetComponentsInChildren<MeshFilter>(true);
            if (filters.Length == 0)
                throw new InvalidOperationException("Authored Ground has no saved meshes.");

            float minimum = float.PositiveInfinity;
            float maximum = float.NegativeInfinity;
            int samples = 0;
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                if (mesh == null) continue;
                Vector3[] vertices = mesh.vertices;
                for (int vertex = 0; vertex < vertices.Length; vertex++)
                {
                    float y = filter.transform.TransformPoint(vertices[vertex]).y;
                    minimum = Mathf.Min(minimum, y);
                    maximum = Mathf.Max(maximum, y);
                    samples++;
                }
            }
            if (samples == 0 || maximum - minimum > 0.02f)
                throw new InvalidOperationException("Visible global-map ground is missing or uneven.");
            float groundY = (minimum + maximum) * 0.5f;
            if (Mathf.Abs(groundY - ExpectedVisibleGroundY) > 0.01f)
                throw new InvalidOperationException("Visible ground height changed: " + groundY + ".");
            return groundY;
        }

        private static int GroundExistingDecoration(Transform staticContentRoot, float groundY)
        {
            int count = 0;
            count += GroundLayerDownward(staticContentRoot.Find("Decor"), groundY);
            count += GroundLayerDownward(staticContentRoot.Find(
                RoaGlobalMapSeamAuthoring.LayerName), groundY);
            count += GroundLayerDownward(staticContentRoot.Find("Infrastructure/"
                + RoaGlobalMapRoadAuthoring.LandmarkLayerName), groundY);
            count += GroundLayerDownward(staticContentRoot.Find("Locations"), groundY);
            return count;
        }

        private static int GroundLayerDownward(Transform layer, float groundY)
        {
            if (layer == null)
                throw new InvalidOperationException("Grounded decoration layer is missing.");
            int count = 0;
            for (int i = 0; i < layer.childCount; i++)
            {
                Transform child = layer.GetChild(i);
                Renderer[] renderers = child.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0) continue;
                Bounds bounds = RendererBounds(child.gameObject);
                float footprint = Mathf.Max(bounds.size.x, bounds.size.z);
                bool groundPatch = IsGroundPatch(child.name);
                float embedDepth = groundPatch
                    ? 0.105f
                    : Mathf.Clamp(footprint * 0.055f, 0.035f, 0.22f);
                bool thinGroundPatch = groundPatch && bounds.size.y < 0.12f;
                if (thinGroundPatch)
                {
                    Vector3 position = child.position;
                    position.y += groundY + 0.006f - bounds.max.y;
                    child.position = position;
                    EditorUtility.SetDirty(child);
                    count++;
                    continue;
                }
                float desiredMinimumY = groundY - embedDepth;
                if (bounds.min.y > desiredMinimumY + 0.001f)
                {
                    Vector3 position = child.position;
                    position.y -= bounds.min.y - desiredMinimumY;
                    child.position = position;
                    EditorUtility.SetDirty(child);
                }
                count++;
            }
            return count;
        }

        private static bool IsGroundPatch(string name)
        {
            return name.IndexOf("BiomeBlend_", StringComparison.Ordinal) >= 0
                || name.IndexOf("Dust", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("DryLake", StringComparison.OrdinalIgnoreCase) >= 0
                || name.IndexOf("CrackedMud", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void ConfigureRenderers(GameObject instance, Material material,
                                               bool groundPatch)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                Material[] materials = renderer.sharedMaterials;
                for (int m = 0; m < materials.Length; m++) materials[m] = material;
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = groundPatch
                    ? ShadowCastingMode.Off : ShadowCastingMode.On;
                renderer.receiveShadows = true;
                renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            }
        }

        private static void DisableColliders(GameObject instance)
        {
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++) colliders[i].enabled = false;
        }

        private static void MarkStatic(GameObject root)
        {
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic;
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static void UpgradeGroundMaterials()
        {
            ConfigureGroundMaterial(Load<Material>(DesertGroundMaterialPath), 3.25f, 0.08f);
            ConfigureGroundMaterial(Load<Material>(RockyGroundMaterialPath), 3.05f, 0.13f);
            ConfigureGroundMaterial(Load<Material>(SaltGroundMaterialPath), 3.65f, 0.18f);
        }

        private static void ConfigureGroundMaterial(Material material, float tiling,
                                                    float smoothness)
        {
            Vector2 scale = Vector2.one * tiling;
            if (material.HasProperty("_BaseMap")) material.SetTextureScale("_BaseMap", scale);
            if (material.HasProperty("_MainTex")) material.SetTextureScale("_MainTex", scale);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
        }

        private static Material SaveMaterial(Material generated, string path)
        {
            Material existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static Mesh SaveMesh(Mesh generated, string path)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static GameObject SaveRenderPrefab(string name, string path, Mesh mesh,
                                                   Material material, bool castShadows,
                                                   bool receiveShadows)
        {
            var temporary = new GameObject(name);
            try
            {
                temporary.AddComponent<MeshFilter>().sharedMesh = mesh;
                MeshRenderer renderer = temporary.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = castShadows
                    ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = receiveShadows;
                renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
                MarkStatic(temporary);
                GameObject prefab = PrefabUtility.SaveAsPrefabAsset(temporary, path);
                if (prefab == null)
                    throw new InvalidOperationException("Cannot save prefab " + path + ".");
                return prefab;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(temporary);
            }
        }

        private static GameObject InstantiateSavedPrefab(GameObject prefab, string name,
                                                         Transform parent, Scene scene)
        {
            GameObject instance = PrefabUtility.InstantiatePrefab(prefab, scene) as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Cannot instantiate " + name + ".");
            instance.name = name;
            instance.transform.SetParent(parent, false);
            instance.transform.localPosition = Vector3.zero;
            return instance;
        }

        private static DetailAsset[] DetailFamily(string texture)
        {
            switch ((texture ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "rocky_hills": return RockyDetails;
                case "dry_lake": return SaltDetails;
                case "green_lowland": return GreenDetails;
                case "scrap_field": return RockyDetails;
                default: return DesertDetails;
            }
        }

        private static string TextureLabel(string texture)
        {
            string label = (texture ?? "desert").Trim();
            return string.IsNullOrEmpty(label) ? "desert" : label.Replace(' ', '_');
        }

        private static string CellTexture(JObject cells, float worldX, float worldZ)
        {
            int cellX = Mathf.Clamp(Mathf.FloorToInt((worldX + MapHalfExtent) / 3f), 0, 29);
            int cellY = Mathf.Clamp(Mathf.FloorToInt((MapHalfExtent - worldZ) / 3f), 0, 29);
            return cells[cellX.ToString(CultureInfo.InvariantCulture) + ":"
                         + cellY.ToString(CultureInfo.InvariantCulture)]?["texture"]?.ToString()
                   ?? "wasteland_dust";
        }

        private static bool IsWater(JObject cells, float worldX, float worldZ)
        {
            string texture = CellTexture(cells, worldX, worldZ).Trim().ToLowerInvariant();
            return texture == "water" || texture == "ocean"
                || texture == "sea" || texture == "lake";
        }

        private static int CountWaterCells(JObject cells)
        {
            int count = 0;
            foreach (JProperty property in cells.Properties())
            {
                string texture = property.Value?["texture"]?.ToString()
                    ?.Trim().ToLowerInvariant() ?? string.Empty;
                if (texture == "water" || texture == "ocean"
                    || texture == "sea" || texture == "lake") count++;
            }
            return count;
        }

        public static float CoastWorldXAtZ(float worldZ)
        {
            float ny = Mathf.Clamp01((MapHalfExtent - worldZ) / (MapHalfExtent * 2f));
            if (ny <= Coastline[0].y) return (Coastline[0].x - 0.5f) * 90f;
            for (int i = 0; i < Coastline.Length - 1; i++)
            {
                Vector2 a = Coastline[i];
                Vector2 b = Coastline[i + 1];
                if (ny > b.y) continue;
                float t = Mathf.InverseLerp(a.y, b.y, ny);
                return (Mathf.Lerp(a.x, b.x, t) - 0.5f) * 90f;
            }
            return (Coastline[Coastline.Length - 1].x - 0.5f) * 90f;
        }

        private static List<Vector3> ReadNodePositions(JObject map)
        {
            var result = new List<Vector3>();
            JArray nodes = map["nodes"] as JArray ?? new JArray();
            for (int i = 0; i < nodes.Count; i++)
            {
                float x = Float(nodes[i]?["x"]);
                float y = Float(nodes[i]?["y"]);
                result.Add(new Vector3((x - 450f) * 0.1f, 0f, (450f - y) * 0.1f));
            }
            return result;
        }

        private static bool NearForbidden(float x, float z, List<Vector3> forbidden,
                                          float clearance)
        {
            float squared = clearance * clearance;
            for (int i = 0; i < forbidden.Count; i++)
            {
                float dx = forbidden[i].x - x;
                float dz = forbidden[i].z - z;
                if (dx * dx + dz * dz < squared) return true;
            }
            return false;
        }

        private static bool NearInfrastructure(JObject map, float x, float z, float clearance)
        {
            Vector2 point = new Vector2(x, z);
            JArray rows = map["infrastructure"] as JArray ?? new JArray();
            for (int row = 0; row < rows.Count; row++)
            {
                JArray points = rows[row]?["points"] as JArray ?? new JArray();
                for (int i = 1; i < points.Count; i++)
                {
                    Vector2 a = MapPointToWorld(points[i - 1]);
                    Vector2 b = MapPointToWorld(points[i]);
                    if (PointSegmentDistance(point, a, b) < clearance) return true;
                }
            }
            return false;
        }

        private static Vector2 MapPointToWorld(JToken token)
        {
            return new Vector2((Float(token?["x"]) - 450f) * 0.1f,
                (450f - Float(token?["y"])) * 0.1f);
        }

        private static float PointSegmentDistance(Vector2 point, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float lengthSquared = ab.sqrMagnitude;
            if (lengthSquared < 0.0001f) return Vector2.Distance(point, a);
            float t = Mathf.Clamp01(Vector2.Dot(point - a, ab) / lengthSquared);
            return Vector2.Distance(point, a + ab * t);
        }

        private static Transform CreateLayer(string name, Transform parent, Scene scene)
        {
            var layer = new GameObject(name);
            SceneManager.MoveGameObjectToScene(layer, scene);
            layer.transform.SetParent(parent, false);
            return layer.transform;
        }

        private static void DestroyLayer(Transform parent, string name)
        {
            Transform existing = parent.Find(name);
            if (existing != null) UnityEngine.Object.DestroyImmediate(existing.gameObject);
        }

        private static RoaUnityGlobalMapScene FindMarker(Scene scene)
        {
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                RoaUnityGlobalMapScene marker =
                    root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }

        private static T Load<T>(string path) where T : UnityEngine.Object
        {
            return AssetDatabase.LoadAssetAtPath<T>(path)
                ?? throw new InvalidOperationException("Required asset is missing: " + path);
        }

        private static string MapPath()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../data/global-map.json"));
        }

        private static float Float(JToken token)
        {
            return token != null && float.TryParse(token.ToString(), NumberStyles.Float,
                CultureInfo.InvariantCulture, out float value) ? value : 0f;
        }
    }
}
#endif
