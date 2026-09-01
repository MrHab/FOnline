#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Builds the Old Klim caravan as an editable Unity/MEP scene.</summary>
    [InitializeOnLoad]
    public static class RoaOldKlimSceneGenerator
    {
        private const string RequestName = "RoaOldKlimSceneGenerator.v2.request";
        private const string ResultName = "RoaOldKlimSceneGenerator.result";
        private const string SceneDirectory = "Assets/Scenes/Locations/OldKlimCaravan";
        private const string ScenePath = "Assets/Scenes/Locations/OldKlimCaravan.unity";
        private const string TerrainPath = SceneDirectory + "/OldKlimTerrain.asset";
        private const string MaterialDirectory = SceneDirectory + "/Materials";
        private const string Mep = "Assets/MEP/MEP_Environment/";

        private const string DesertLayer = Mep + "MEP_Terrains/_TerrainAutoUpgrade/layer_MEP_Dessert_Base.terrainlayer";
        private const string SandLayer = Mep + "MEP_Terrains/_TerrainAutoUpgrade/layer_MEP_Sand_01.terrainlayer";
        private const string SoilLayer = Mep + "MEP_Terrains/_TerrainAutoUpgrade/layer_MEP_Soil.terrainlayer";
        private const string Sky03 = Mep + "MEP_Skyboxes/MEP_Sky_03/MEP_Sky_03.mat";

        private const string Roof01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Roof_01_N.prefab";
        private const string Roof02 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Roof_02_N.prefab";
        private const string Roof03 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Roof_03_N.prefab";
        private const string Roof04 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Roof_04_N.prefab";
        private const string BrokenShack = Mep + "MEP_Buildings&Props/Prefabs/MEP_Shack_Broken_N.prefab";
        private const string Shack01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Shack_01_N.prefab";
        private const string Shack03 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Shack_03_N.prefab";
        private const string Shack05 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Shack_05_N.prefab";
        private const string Fence01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Fence_01_N.prefab";
        private const string Fence03 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Fence_03_N.prefab";
        private const string Wall03 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Wall_03_N.prefab";
        private const string StoneWall01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_StoneWall_01_N.prefab";
        private const string Plank01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Plank_01.prefab";
        private const string Plank02 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Plank_02.prefab";
        private const string Door01 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Door_01_N.prefab";
        private const string Walk02 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Walk_02_N.prefab";
        private const string Stairs02 = Mep + "MEP_Buildings&Props/Prefabs/MEP_Stairs_02_N.prefab";
        private const string Branch03 = Mep + "MEP_Buildings&Props/Prefabs/MEP_S_Branch_03.prefab";
        private const string Bench = Mep + "MEP_Buildings&Props/Prefabs/MEP_Bench_N.prefab";
        private const string Table = Mep + "MEP_Buildings&Props/Prefabs/MEP_Table_N.prefab";
        private const string Barrel = Mep + "MEP_Buildings&Props/MEP_Props/Chest_Barrel/Prefabs/MEP_Barrel.prefab";
        private const string Chest = Mep + "MEP_Buildings&Props/MEP_Props/Chest_Barrel/Prefabs/MEP_Chest.prefab";
        private const string Bed = Mep + "MEP_Buildings&Props/MEP_Props/MEP_House_Props_01/Prefabs/MEP_Bed.prefab";
        private const string Cloth = Mep + "MEP_Buildings&Props/MEP_Props/MEP_House_Props_01/Prefabs/MEP_Cloth_04_b.prefab";
        private const string Lantern = Mep + "MEP_Buildings&Props/MEP_Props/MEP_House_Props_01/Prefabs/MEP_Lantern_01.prefab";
        private const string Jug = Mep + "MEP_Buildings&Props/MEP_Props/Itmes_01/Prefabs/MEP_Jug_01.prefab";
        private const string Fire = Mep + "MEP_FX/MEP_Fire/MEP_Fire_01.prefab";
        private const string Rock01 = Mep + "MEP_Rocks/MEP_Rock_01/Prefabs/MEP_Rock_01_N_a_Sand.prefab";
        private const string Rock04 = Mep + "MEP_Rocks/MEP_Rock_04/Prefabs/MEP_Rock_04_b_Sand.prefab";
        private const string GroundStone = Mep + "MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_a_Sand.prefab";
        private const string Bush01 = Mep + "Vegetation/MEP_Bushes/MEP_Bush_01/Prefabs/MEP_Bush_01_b_Autumn_N.prefab";
        private const string Bush02 = Mep + "Vegetation/MEP_Bushes/MEP_Bush_02/Prefabs/MEP_Bush_02_c_Autumn_N.prefab";
        private const string DryGrass = Mep + "Vegetation/MEP_Grass/MEP_Grass/Prefabs/MEP_Grass_A_02_Dry.prefab";
        private const string DeadTree = Mep + "Vegetation/MEP_Trees/DeadTrees/DeadTree_01/Prefabs/MEP_DeadTree_02_N.prefab";
        private const string CrackedMud = Mep + "MEP_Rocks/MEP_Cracked_Mud/Prefabs/Cracked_Mud_03.prefab";
        private const string GardenPlant = Mep + "Vegetation/MEP_Plants&Flowers/MEP_Fern/MEP_Fern/Prefabs/MEP_Fern_02_N_Autumn.prefab";
        private const string GardenCactus = Mep + "Vegetation/MEP_Plants&Flowers/MEP_Cactus/Prefabs/MEP_Cactus_h_03.prefab";

        private static double _nextRequestCheck;

        private struct ObjectSize
        {
            public float Width;
            public float Depth;
            public float Height;

            public ObjectSize(float width, float depth, float height)
            {
                Width = width;
                Depth = depth;
                Height = height;
            }
        }

        private struct DressingSpec
        {
            public string Prefab;
            public Vector3 Position;
            public float Yaw;
            public float Width;
            public float Depth;

            public DressingSpec(string prefab, float x, float z, float yaw, float width, float depth)
            {
                Prefab = prefab;
                Position = new Vector3(x, 0f, z);
                Yaw = yaw;
                Width = width;
                Depth = depth;
            }
        }

        static RoaOldKlimSceneGenerator()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating
                || EditorApplication.isPlayingOrWillChangePlaymode) return;

            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(projectRoot)) return;
            string request = Path.Combine(projectRoot, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Generate();
        }

        [MenuItem("Realm of Ashes/Locations/Build Old Klim Caravan")]
        public static void Generate()
        {
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            string resultPath = Path.Combine(projectRoot ?? string.Empty, "Library", ResultName);
            Scene generatedScene = default;
            Scene previousScene = SceneManager.GetActiveScene();
            Scene existingTargetScene = SceneManager.GetSceneByPath(ScenePath);
            bool targetWasLoaded = existingTargetScene.IsValid() && existingTargetScene.isLoaded;
            bool targetWasActive = targetWasLoaded && previousScene.handle == existingTargetScene.handle;

            try
            {
                if (string.IsNullOrEmpty(projectRoot)) throw new InvalidOperationException("Unity project root was not found.");
                string definitionPath = Path.GetFullPath(Path.Combine(projectRoot, "..", "data", "locations", "settlement.json"));
                LocationDefinition definition = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(definitionPath));
                if (definition == null || definition.Id != "settlement")
                    throw new InvalidOperationException("The settlement location definition is missing or invalid.");

                EnsureAssetDirectory(SceneDirectory);
                if (targetWasLoaded) EditorSceneManager.CloseScene(existingTargetScene, true);
                generatedScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
                SceneManager.SetActiveScene(generatedScene);
                ConfigureSceneLighting();

                var sceneRoot = new GameObject("OldKlimCaravan");
                Terrain terrain = CreateTerrain(sceneRoot.transform);
                RoaUnityLocationScene marker = sceneRoot.AddComponent<RoaUnityLocationScene>();
                marker.Configure(definition.Id, terrain);

                var authoredRoot = new GameObject("AuthoredObjects");
                authoredRoot.transform.SetParent(sceneRoot.transform, false);
                int expectedObjects = 0;
                int builtObjects = 0;
                int fallbackObjects = 0;
                foreach (LocationObject entry in definition.Objects)
                {
                    if (entry == null || entry.IsLiveEntity()) continue;
                    if (!ShouldUseMep(entry))
                    {
                        fallbackObjects++;
                        continue;
                    }
                    expectedObjects++;
                    BuildAuthoredObject(entry, terrain, authoredRoot.transform);
                    builtObjects++;
                }

                var dressingRoot = new GameObject("EnvironmentDressing");
                dressingRoot.transform.SetParent(sceneRoot.transform, false);
                int dressingCount = AddEnvironmentDressing(terrain, dressingRoot.transform);
                int materialCount = ConvertSceneMaterials(sceneRoot);
                marker.RebuildIndex();

                ValidateScene(marker, terrain, definition, expectedObjects, builtObjects);
                EditorSceneManager.SaveScene(generatedScene, ScenePath);
                AddSceneToBuildSettings();
                AssetDatabase.SaveAssets();
                CapturePreview(generatedScene, Path.Combine(projectRoot, "Library", "OldKlimCaravanPreview.png"));
                CapturePreview(generatedScene, Path.Combine(projectRoot, "Library", "OldKlimCaravanPreviewClose.png"),
                    new Vector3(29f, 29f, 31f), new Vector3(-1f, 0f, -7f), 41f);
                CapturePreview(generatedScene, Path.Combine(projectRoot, "Library", "OldKlimCaravanPreviewEntry.png"),
                    new Vector3(0f, 10.5f, 40f), new Vector3(0f, 2f, 17f), 45f);

                string result = "OK scene=" + ScenePath + " objects=" + builtObjects
                    + " fallback=" + fallbackObjects + " dressing=" + dressingCount
                    + " materials=" + materialCount + " terrain=76x76";
                File.WriteAllText(resultPath, result);
                Debug.Log("[ROA OLD KLIM] " + result);
            }
            catch (Exception error)
            {
                File.WriteAllText(resultPath, "ERROR " + error);
                Debug.LogException(error);
                throw;
            }
            finally
            {
                if (generatedScene.IsValid() && generatedScene.isLoaded)
                    EditorSceneManager.CloseScene(generatedScene, true);
                Scene reopenedTarget = default;
                if (targetWasLoaded)
                    reopenedTarget = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
                if (targetWasActive && reopenedTarget.IsValid() && reopenedTarget.isLoaded)
                    SceneManager.SetActiveScene(reopenedTarget);
                else if (previousScene.IsValid() && previousScene.isLoaded)
                    SceneManager.SetActiveScene(previousScene);
                AssetDatabase.Refresh();
            }
        }

        private static Terrain CreateTerrain(Transform parent)
        {
            TerrainData data = AssetDatabase.LoadAssetAtPath<TerrainData>(TerrainPath);
            if (data == null)
            {
                data = new TerrainData();
                AssetDatabase.CreateAsset(data, TerrainPath);
            }

            data.heightmapResolution = 129;
            data.alphamapResolution = 128;
            data.baseMapResolution = 512;
            data.size = new Vector3(76f, 4f, 76f);
            data.terrainLayers = new[]
            {
                RequireAsset<TerrainLayer>(DesertLayer),
                RequireAsset<TerrainLayer>(SandLayer),
                RequireAsset<TerrainLayer>(SoilLayer)
            };

            float[,] heights = new float[data.heightmapResolution, data.heightmapResolution];
            for (int z = 0; z < data.heightmapResolution; z++)
            for (int x = 0; x < data.heightmapResolution; x++)
            {
                float wx = x / (data.heightmapResolution - 1f) * 76f - 38f;
                float wz = z / (data.heightmapResolution - 1f) * 76f - 38f;
                float radius = Mathf.Sqrt(wx * wx + wz * wz);
                float edge = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(25f, 39f, radius));
                float macro = Mathf.PerlinNoise((wx + 73f) * 0.045f, (wz + 41f) * 0.045f) - 0.5f;
                float micro = Mathf.PerlinNoise((wx + 17f) * 0.19f, (wz + 89f) * 0.19f) - 0.5f;
                heights[z, x] = Mathf.Clamp01(0.0375f + edge * (0.13f + macro * 0.055f)
                    + micro * Mathf.Lerp(0.002f, 0.012f, edge));
            }
            data.SetHeights(0, 0, heights);

            float[,,] splat = new float[data.alphamapHeight, data.alphamapWidth, 3];
            for (int z = 0; z < data.alphamapHeight; z++)
            for (int x = 0; x < data.alphamapWidth; x++)
            {
                float wx = x / (data.alphamapWidth - 1f) * 76f - 38f;
                float wz = z / (data.alphamapHeight - 1f) * 76f - 38f;
                float mainRoad = (1f - Mathf.SmoothStep(2.6f, 4.8f, Mathf.Abs(wx)))
                    * AreaMask(wx, wz, 0f, 0f, 4.8f, 29f, 3f);
                float eastRoad = (1f - Mathf.SmoothStep(2.2f, 4.2f, Mathf.Abs(wz + 7f)))
                    * AreaMask(wx, wz, 12.5f, -7f, 14.5f, 4.2f, 2f);
                float westRoad = (1f - Mathf.SmoothStep(2f, 3.8f, Mathf.Abs(wz + 6f)))
                    * AreaMask(wx, wz, -10.5f, -6f, 12f, 3.8f, 2f);
                float road = Mathf.Max(mainRoad, Mathf.Max(eastRoad, westRoad));
                float plaza = AreaMask(wx, wz, 2f, -6f, 8f, 7f, 3f);
                float workshopYard = AreaMask(wx, wz, -13f, 5f, 9f, 6f, 2.5f);
                float caravanYard = AreaMask(wx, wz, 16f, -6f, 9f, 8f, 2.5f);
                float penYard = AreaMask(wx, wz, 16.5f, 8f, 8f, 5f, 2f);
                float housingYard = AreaMask(wx, wz, 5f, -18f, 13f, 4.5f, 2f);
                float gardenSoil = AreaMask(wx, wz, -14f, -15f, 8.5f, 5f, 1.5f);
                float yard = Mathf.Max(plaza, Mathf.Max(workshopYard,
                    Mathf.Max(caravanYard, Mathf.Max(penYard, housingYard))));
                float noise = Mathf.PerlinNoise((wx + 50f) * 0.08f, (wz + 20f) * 0.08f);
                // The pale packed-sand route is the settlement's visual spine. Functional yards
                // remain darker soil, so the gate-to-plaza path stays legible from gameplay height.
                float soil = Mathf.Clamp01(Mathf.Max(gardenSoil * 0.98f,
                    yard * 0.72f) + noise * 0.06f);
                float sand = Mathf.Clamp01(0.19f + road * 1.25f
                    + (1f - yard) * 0.21f + (1f - noise) * 0.1f);
                float desert = Mathf.Max(0.08f, 1f - soil - sand * 0.68f);
                float total = desert + sand + soil;
                float desertWeight = desert / total;
                float sandWeight = sand / total;
                float soilWeight = soil / total;
                float roadBlend = Mathf.Clamp01(road * 0.88f);
                desertWeight = Mathf.Lerp(desertWeight, 0.04f, roadBlend);
                sandWeight = Mathf.Lerp(sandWeight, 0.93f, roadBlend);
                soilWeight = Mathf.Lerp(soilWeight, 0.03f, roadBlend);
                float gardenBlend = Mathf.Clamp01(gardenSoil * 0.82f);
                splat[z, x, 0] = Mathf.Lerp(desertWeight, 0.05f, gardenBlend);
                splat[z, x, 1] = Mathf.Lerp(sandWeight, 0.12f, gardenBlend);
                splat[z, x, 2] = Mathf.Lerp(soilWeight, 0.83f, gardenBlend);
            }
            data.SetAlphamaps(0, 0, splat);
            EditorUtility.SetDirty(data);

            GameObject terrainObject = Terrain.CreateTerrainGameObject(data);
            terrainObject.name = "OldKlimTerrain";
            terrainObject.transform.SetParent(parent, false);
            terrainObject.transform.localPosition = new Vector3(-38f, -0.15f, -38f);
            Terrain terrain = terrainObject.GetComponent<Terrain>();
            terrain.drawInstanced = true;
            terrain.heightmapPixelError = 4f;
            terrain.basemapDistance = 90f;
            terrain.shadowCastingMode = ShadowCastingMode.On;
            GameObjectUtility.SetStaticEditorFlags(terrainObject,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
            return terrain;
        }

        private static float AreaMask(float x, float z, float centerX, float centerZ,
            float halfWidth, float halfDepth, float feather)
        {
            float xMask = 1f - Mathf.SmoothStep(Mathf.Max(0f, halfWidth - feather), halfWidth,
                Mathf.Abs(x - centerX));
            float zMask = 1f - Mathf.SmoothStep(Mathf.Max(0f, halfDepth - feather), halfDepth,
                Mathf.Abs(z - centerZ));
            return Mathf.Clamp01(xMask * zMask);
        }

        private static void BuildAuthoredObject(LocationObject entry, Terrain terrain, Transform parent)
        {
            var root = new GameObject(entry.Id);
            root.transform.SetParent(parent, false);
            Vector3 position = entry.Position != null
                ? RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z)
                : Vector3.zero;
            position.y = terrain.SampleHeight(position) + terrain.transform.position.y
                + (entry.Position?.Y ?? 0f);
            root.transform.position = position;
            RoaUnityLocationObject marker = root.AddComponent<RoaUnityLocationObject>();
            marker.Configure(entry.Id);

            ObjectSize size = SizeFor(entry);
            BuildMepVisual(entry, root.transform, size, terrain);
            AddGameplayColliders(entry, root, size);

            if (entry.Rotation != null)
                root.transform.rotation = RoaCoords.AuthoredRotation(entry.Rotation.X, entry.Rotation.Y, entry.Rotation.Z);

            SetStaticRecursive(root);
        }

        private static bool ShouldUseMep(LocationObject entry)
        {
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            if (model.StartsWith("oldklim", StringComparison.Ordinal)) return true;
            return model == "cotbed" || model == "rustbarrel" || model == "cargostack"
                || model == "storagechest" || model == "campfirerest" || model == "deadtreea"
                || model == "rubblerock";
        }

        private static void BuildMepVisual(LocationObject entry, Transform root, ObjectSize size, Terrain terrain)
        {
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            int variant = StableHash(entry.Id ?? model);

            if (model.Contains("defensiveperimeter"))
            {
                BuildDefensivePerimeter(root, terrain);
                return;
            }
            if (model.Contains("brahminpens"))
            {
                BuildBrahminPens(root);
                return;
            }
            if (model.Contains("gardens"))
            {
                BuildGardens(root);
                return;
            }
            if (model.Contains("residentialrow"))
            {
                BuildResidentialRow(root);
                return;
            }
            if (model.Contains("workshopshelter"))
            {
                BuildWorkshopShelter(root, size);
                return;
            }
            if (model.Contains("guardpost"))
            {
                BuildGuardPost(root, size);
                return;
            }
            if (model.Contains("plazaseating"))
            {
                BuildPlazaSeating(root);
                return;
            }
            if (model.Contains("watchtower"))
            {
                BuildWatchtower(root, Vector3.zero, 180f);
                return;
            }
            if (model.Contains("maingate") || model.Contains("servicegate"))
            {
                BuildSettlementGate(root, size, model.Contains("maingate"));
                return;
            }

            if (model.Contains("tradehallroof"))
            {
                PlaceVisual(Roof03, root, new Vector3(0f, 3.45f, 0f), Quaternion.identity,
                    size.Width, size.Depth, 0.75f);
                return;
            }
            if (model.Contains("tradehall"))
            {
                // A low stone trading lodge is a clear civic landmark without the visual weight
                // of the previously stretched broken-shack prefab. The central doorway stays open.
                PlaceRotatedVisual(StoneWall01, root, new Vector3(0f, 0f, 2.15f), 0f, 10.5f, 0.5f, 2.85f);
                PlaceRotatedVisual(StoneWall01, root, new Vector3(-5.05f, 0f, 0f), 90f, 4.7f, 0.5f, 2.85f);
                PlaceRotatedVisual(StoneWall01, root, new Vector3(5.05f, 0f, 0f), 90f, 4.7f, 0.5f, 2.85f);
                PlaceRotatedVisual(StoneWall01, root, new Vector3(-3.55f, 0f, -2.15f), 0f, 3.25f, 0.5f, 2.85f);
                PlaceRotatedVisual(StoneWall01, root, new Vector3(3.55f, 0f, -2.15f), 0f, 3.25f, 0.5f, 2.85f);
                PlaceVisual(Table, root, new Vector3(0f, 0f, -1.15f), Quaternion.identity, 2.8f, 1.05f, 0.95f);
                PlaceVisual(Cloth, root, new Vector3(0f, 2.05f, -2.32f), Quaternion.identity, 3.1f, 0.35f, 0.85f);
                PlaceVisual(Bench, root, new Vector3(2.3f, 0f, 0.7f), Quaternion.Euler(0f, 90f, 0f), 1.8f, 0.65f, 0.75f);
                PlaceVisual(Chest, root, new Vector3(-3.8f, 0f, 1.2f), Quaternion.identity, 1.3f, 0.82f, 0.82f);
                PlaceVisual(Barrel, root, new Vector3(-4.3f, 0f, -1.35f), Quaternion.identity, 0.72f, 0.72f, 1f);
                PlaceVisual(Lantern, root, new Vector3(-4.65f, 2.05f, -1.8f), Quaternion.identity, 0.35f, 0.35f, 0.5f);
                return;
            }
            if (model.Contains("caravan"))
            {
                BuildCanopy(root, Roof02, size.Width, size.Depth, true);
                PlaceVisual(Table, root, new Vector3(0f, 0f, -0.95f), Quaternion.identity, 3.1f, 1.05f, 0.95f);
                PlaceVisual(Cloth, root, new Vector3(0f, 1.05f, 1.55f), Quaternion.Euler(0f, 90f, 0f), 3.4f, 0.45f, 1.3f);
                PlaceVisual(Chest, root, new Vector3(2.05f, 0f, 0.65f), Quaternion.Euler(0f, 90f, 0f), 1.25f, 0.8f, 0.82f);
                PlaceVisual(Barrel, root, new Vector3(-2.05f, 0f, 0.72f), Quaternion.identity, 0.78f, 0.78f, 1f);
                PlaceVisual(Jug, root, new Vector3(-0.85f, 0.78f, -0.95f), Quaternion.identity, 0.28f, 0.28f, 0.38f);
                PlaceVisual(Lantern, root, new Vector3(2.45f, 1.9f, -1.45f), Quaternion.identity, 0.32f, 0.32f, 0.48f);
                return;
            }
            if (model.Contains("loadingcanopy"))
            {
                BuildCanopy(root, Roof01, size.Width, size.Depth, false);
                PlaceVisual(Barrel, root, new Vector3(-1.55f, 0f, 0.95f), Quaternion.identity, 0.72f, 0.72f, 1f);
                PlaceVisual(Chest, root, new Vector3(1.35f, 0f, 0.85f), Quaternion.identity, 1.15f, 0.76f, 0.82f);
                return;
            }
            if (model.Contains("cliff"))
            {
                string cliff = Mep + "MEP_Rocks/Cliff_01/Prefabs/MEP_Desert_Cliff_"
                    + ((variant % 8) + 1).ToString("00") + ".prefab";
                PlaceVisual(cliff, root, Vector3.zero, Quaternion.identity, size.Width, size.Depth, size.Height);
                return;
            }
            if (model.Contains("scrub"))
            {
                PlaceVisual(variant % 2 == 0 ? Bush01 : Bush02, root, Vector3.zero,
                    Quaternion.Euler(0f, variant % 360, 0f), size.Width, size.Depth, size.Height);
                return;
            }
            if (model.Contains("rockscatter"))
            {
                string groundRock = Mep + "MEP_Rocks/MEP_GroundRocks_01/Prefabs/MEP_GroundRock_01_"
                    + (char)('a' + variant % 11) + ".prefab";
                PlaceVisual(groundRock, root, Vector3.zero, Quaternion.Euler(0f, variant % 360, 0f),
                    size.Width, size.Depth, 0.45f);
                return;
            }
            if (model == "cargostack")
            {
                BuildCargoCluster(root, size, variant);
                return;
            }
            if (model == "storagechest")
            {
                PlaceVisual(Chest, root, Vector3.zero, Quaternion.identity, size.Width * 0.82f, size.Depth * 0.72f, 0.82f);
                return;
            }
            if (model == "cotbed")
            {
                PlaceVisual(Bed, root, Vector3.zero, Quaternion.identity, size.Width, size.Depth, 0.62f);
                return;
            }
            if (model == "rustbarrel")
            {
                PlaceVisual(Barrel, root, Vector3.zero, Quaternion.identity, size.Width * 0.72f, size.Depth * 0.72f, 1f);
                return;
            }
            if (model == "campfirerest")
            {
                PlaceVisual(Fire, root, Vector3.zero, Quaternion.identity, 1.25f, 1.25f, 0.9f);
                return;
            }
            if (model == "deadtreea")
            {
                PlaceVisual(DeadTree, root, Vector3.zero, Quaternion.Euler(0f, variant % 360, 0f), 2.5f, 2.5f, 4.5f);
                return;
            }
            if (model == "rubblerock")
            {
                PlaceVisual(variant % 2 == 0 ? Rock01 : Rock04, root, Vector3.zero,
                    Quaternion.Euler(0f, variant % 360, 0f), size.Width, size.Depth, 1.25f);
                return;
            }

            throw new InvalidOperationException("No curated MEP recipe for " + entry.Id + " (" + entry.Model + ").");
        }

        private static void BuildDefensivePerimeter(Transform root, Terrain terrain)
        {
            float[] southX = { -21f, -15f, -9f, 9f, 15f, 21f };
            for (int i = 0; i < southX.Length; i++)
                BuildWallSegment(root, TerrainLocalPoint(root, terrain, southX[i], -23f), 0f, 6f, i);

            float[] westZ = { -20f, -14f, -8f, -2f, 4f };
            for (int i = 0; i < westZ.Length; i++)
                BuildWallSegment(root, TerrainLocalPoint(root, terrain, -25f, westZ[i]), 90f, 6f, i + 10);

            float[] eastZ = { -20f, -14f, -8f, -2f };
            for (int i = 0; i < eastZ.Length; i++)
                BuildWallSegment(root, TerrainLocalPoint(root, terrain, 25f, eastZ[i]), 90f, 6f, i + 20);
            BuildWallSegment(root, TerrainLocalPoint(root, terrain, 25f, 2.5f), 90f, 3f, 25);
            BuildWallSegment(root, TerrainLocalPoint(root, terrain, 25f, 11.5f), 90f, 3.5f, 26);

            BuildWatchtower(root, TerrainLocalPoint(root, terrain, -7.5f, -19.5f), 0f);
            BuildWatchtower(root, TerrainLocalPoint(root, terrain, 7.5f, -19.5f), 0f);
            BuildWatchtower(root, TerrainLocalPoint(root, terrain, -21f, 19.5f), 0f);
            BuildWatchtower(root, TerrainLocalPoint(root, terrain, 21f, 19.5f), 0f);
        }

        private static Vector3 TerrainLocalPoint(Transform root, Terrain terrain, float x, float z)
        {
            Vector3 world = root.TransformPoint(RoaCoords.ToUnity(x, 0f, z));
            world.y = terrain.SampleHeight(world) + terrain.transform.position.y;
            return root.InverseTransformPoint(world);
        }

        private static void BuildWallSegment(Transform root, Vector3 localPosition, float yaw,
            float length, int variant)
        {
            var anchor = new GameObject("FortifiedWall_" + variant.ToString("00"));
            anchor.transform.SetParent(root, false);
            anchor.transform.localPosition = localPosition;
            PlaceVisual(StoneWall01, anchor.transform, Vector3.zero, Quaternion.identity,
                length, 0.9f, 1.45f);
            PlaceVisual(variant % 3 == 0 ? Fence01 : Fence03, anchor.transform, new Vector3(0f, 1.05f, 0f),
                Quaternion.identity, length * 0.97f, 0.62f, 1.75f);
            PlaceVisual(Branch03, anchor.transform, new Vector3(-length * 0.46f, 0f, 0f), Quaternion.identity,
                0.34f, 0.34f, 3f);
            PlaceVisual(Branch03, anchor.transform, new Vector3(length * 0.46f, 0f, 0f), Quaternion.Euler(0f, 180f, 0f),
                0.34f, 0.34f, 3f);
            anchor.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
        }

        private static void BuildSettlementGate(Transform root, ObjectSize size, bool mainGate)
        {
            float half = size.Width * 0.455f;
            float height = mainGate ? 4.65f : 3.45f;
            PlaceVisual(StoneWall01, root, new Vector3(-half, 0f, 0f), Quaternion.identity,
                mainGate ? 1.35f : 1.05f, mainGate ? 1.35f : 1.05f, height - 0.15f);
            PlaceVisual(StoneWall01, root, new Vector3(half, 0f, 0f), Quaternion.identity,
                mainGate ? 1.35f : 1.05f, mainGate ? 1.35f : 1.05f, height - 0.15f);
            PlaceVisual(StoneWall01, root, new Vector3(0f, height - (mainGate ? 0.82f : 0.62f), 0f),
                Quaternion.identity, size.Width + (mainGate ? 0.65f : 0.2f),
                mainGate ? 1.15f : 0.9f, mainGate ? 0.92f : 0.7f);
            PlaceVisual(Plank02, root, new Vector3(0f, height + 0.12f, 0f), Quaternion.identity,
                size.Width - (mainGate ? 0.35f : 0.2f), 0.55f, 0.28f);
            float doorCenter = mainGate ? size.Width * 0.335f : size.Width * 0.3f;
            PlaceRotatedVisual(Door01, root, new Vector3(-doorCenter, 0f, 0.12f), -42f,
                mainGate ? 3f : 1.65f, 0.3f, mainGate ? 3.05f : 2.35f);
            PlaceRotatedVisual(Door01, root, new Vector3(doorCenter, 0f, 0.12f), 42f,
                mainGate ? 3f : 1.65f, 0.3f, mainGate ? 3.05f : 2.35f);
            PlaceVisual(Lantern, root, new Vector3(-half, height - 0.9f, -0.38f), Quaternion.identity,
                0.3f, 0.3f, 0.48f);
            PlaceVisual(Lantern, root, new Vector3(half, height - 0.9f, -0.38f), Quaternion.identity,
                0.3f, 0.3f, 0.48f);
        }

        private static void BuildWatchtower(Transform root, Vector3 localPosition, float yaw)
        {
            var anchor = new GameObject("Watchtower");
            anchor.transform.SetParent(root, false);
            anchor.transform.localPosition = localPosition;
            float post = 1.25f;
            PlaceVisual(Branch03, anchor.transform, new Vector3(-post, 0f, -post), Quaternion.identity, 0.34f, 0.34f, 4.3f);
            PlaceVisual(Branch03, anchor.transform, new Vector3(post, 0f, -post), Quaternion.Euler(0f, 180f, 0f), 0.34f, 0.34f, 4.3f);
            PlaceVisual(Branch03, anchor.transform, new Vector3(-post, 0f, post), Quaternion.Euler(0f, 90f, 0f), 0.34f, 0.34f, 4.3f);
            PlaceVisual(Branch03, anchor.transform, new Vector3(post, 0f, post), Quaternion.Euler(0f, 270f, 0f), 0.34f, 0.34f, 4.3f);
            PlaceVisual(Walk02, anchor.transform, new Vector3(0f, 3.05f, 0f), Quaternion.identity, 3.25f, 3.25f, 0.32f);
            PlaceVisual(Roof04, anchor.transform, new Vector3(0f, 4.35f, 0f), Quaternion.identity, 3.75f, 3.75f, 0.55f);
            PlaceVisual(Stairs02, anchor.transform, new Vector3(0f, 0f, -2.15f), Quaternion.identity, 1.45f, 3.25f, 3.2f);
            PlaceVisual(Cloth, anchor.transform, new Vector3(0f, 3.42f, 1.38f), Quaternion.identity, 2.1f, 0.25f, 0.75f);
            PlaceVisual(Lantern, anchor.transform, new Vector3(1.15f, 3.38f, -1.15f), Quaternion.identity, 0.28f, 0.28f, 0.45f);
            anchor.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
        }

        private static void BuildBrahminPens(Transform root)
        {
            BuildBrahminPen(root, -3.5f, false);
            BuildBrahminPen(root, 3.5f, true);
            PlaceVisual(Barrel, root, new Vector3(0f, 0f, 3.15f), Quaternion.identity, 0.72f, 0.72f, 1f);
            PlaceVisual(Jug, root, new Vector3(0.75f, 0f, 3.35f), Quaternion.identity, 0.3f, 0.3f, 0.4f);
        }

        private static void BuildBrahminPen(Transform root, float centerX, bool mirrored)
        {
            PlaceRotatedVisual(Fence01, root, new Vector3(centerX, 0f, -4f), 0f, 6f, 0.32f, 1.25f);
            PlaceRotatedVisual(Fence01, root, new Vector3(centerX - 3f, 0f, 0f), 90f, 8f, 0.32f, 1.25f);
            PlaceRotatedVisual(Fence01, root, new Vector3(centerX + 3f, 0f, 0f), 90f, 8f, 0.32f, 1.25f);
            PlaceRotatedVisual(Fence01, root, new Vector3(centerX - 1.9f, 0f, 4f), 0f, 2.2f, 0.32f, 1.25f);
            PlaceRotatedVisual(Fence01, root, new Vector3(centerX + 1.9f, 0f, 4f), 0f, 2.2f, 0.32f, 1.25f);
            PlaceVisual(Roof04, root, new Vector3(centerX, 1.75f, -2.65f), Quaternion.identity,
                5.35f, 2.25f, 0.5f);
            PlaceVisual(Branch03, root, new Vector3(centerX - 2.35f, 0f, -1.75f), Quaternion.identity,
                0.28f, 0.28f, 1.9f);
            PlaceVisual(Branch03, root, new Vector3(centerX + 2.35f, 0f, -1.75f), Quaternion.Euler(0f, 180f, 0f),
                0.28f, 0.28f, 1.9f);
            PlaceVisual(Chest, root, new Vector3(centerX, 0f, -2.7f), Quaternion.identity, 1.8f, 0.62f, 0.48f);
            PlaceVisual(DryGrass, root, new Vector3(centerX + (mirrored ? 1.5f : -1.5f), 0f, 0.4f),
                Quaternion.Euler(0f, mirrored ? 35f : 145f, 0f), 1.35f, 1.35f, 0.55f);
        }

        private static void BuildGardens(Transform root)
        {
            float[] centers = { -5f, 0f, 5f };
            for (int plot = 0; plot < centers.Length; plot++)
            {
                float cx = centers[plot];
                PlaceVisual(CrackedMud, root, new Vector3(cx, 0.015f, 0f), Quaternion.identity, 4.2f, 7f, 0.09f);
                PlaceRotatedVisual(Plank01, root, new Vector3(cx, 0f, -3.45f), 0f, 4.2f, 0.25f, 0.22f);
                PlaceRotatedVisual(Plank01, root, new Vector3(cx, 0f, 3.45f), 0f, 4.2f, 0.25f, 0.22f);
                PlaceRotatedVisual(Plank01, root, new Vector3(cx - 2.05f, 0f, 0f), 90f, 7f, 0.25f, 0.22f);
                PlaceRotatedVisual(Plank01, root, new Vector3(cx + 2.05f, 0f, 0f), 90f, 7f, 0.25f, 0.22f);
                for (int row = -1; row <= 1; row++)
                {
                    string plant = (plot + row + 3) % 3 == 0 ? GardenCactus : GardenPlant;
                    PlaceVisual(plant, root, new Vector3(cx - 0.9f, 0f, row * 2f), Quaternion.Euler(0f, 20f * (plot + row + 2), 0f),
                        0.95f, 0.95f, 0.88f);
                    PlaceVisual(plant, root, new Vector3(cx + 0.9f, 0f, row * 2f), Quaternion.Euler(0f, 37f * (plot + row + 2), 0f),
                        0.95f, 0.95f, 0.88f);
                }
            }
            PlaceVisual(Barrel, root, new Vector3(7.1f, 0f, 2.6f), Quaternion.identity, 0.75f, 0.75f, 1f);
            PlaceVisual(Jug, root, new Vector3(6.45f, 0f, 2.9f), Quaternion.identity, 0.3f, 0.3f, 0.4f);
        }

        private static void BuildResidentialRow(Transform root)
        {
            string[] shacks = { Shack01, Shack03, Shack05 };
            float[] x = { -8f, 0f, 8f };
            for (int i = 0; i < shacks.Length; i++)
            {
                PlaceVisual(shacks[i], root, new Vector3(x[i], 0f, 0f), Quaternion.identity, 5.5f, 4.5f, 3.25f);
                PlaceVisual(Lantern, root, new Vector3(x[i] + 2.1f, 1.75f, -2.1f), Quaternion.identity, 0.28f, 0.28f, 0.45f);
            }
            PlaceVisual(Table, root, new Vector3(0f, 0f, 3.3f), Quaternion.identity, 2.2f, 1f, 0.9f);
            PlaceVisual(Bench, root, new Vector3(-2.2f, 0f, 3.25f), Quaternion.Euler(0f, 90f, 0f), 1.7f, 0.62f, 0.72f);
            PlaceVisual(Barrel, root, new Vector3(6.1f, 0f, 2.7f), Quaternion.identity, 0.7f, 0.7f, 0.96f);
        }

        private static void BuildWorkshopShelter(Transform root, ObjectSize size)
        {
            PlaceVisual(Roof01, root, new Vector3(0f, 2.85f, 0f), Quaternion.identity, size.Width, size.Depth, 0.68f);
            PlaceRotatedVisual(StoneWall01, root, new Vector3(0f, 0f, -size.Depth * 0.47f), 0f,
                size.Width, 0.5f, 2.35f);
            PlaceRotatedVisual(StoneWall01, root, new Vector3(-size.Width * 0.485f, 0f, -size.Depth * 0.25f), 90f,
                size.Depth * 0.5f, 0.5f, 2.35f);
            PlaceRotatedVisual(StoneWall01, root, new Vector3(size.Width * 0.485f, 0f, -size.Depth * 0.25f), 90f,
                size.Depth * 0.5f, 0.5f, 2.35f);
            PlaceVisual(Branch03, root, new Vector3(-size.Width * 0.46f, 0f, size.Depth * 0.42f), Quaternion.identity, 0.34f, 0.34f, 3.05f);
            PlaceVisual(Branch03, root, new Vector3(size.Width * 0.46f, 0f, size.Depth * 0.42f), Quaternion.Euler(0f, 180f, 0f), 0.34f, 0.34f, 3.05f);
            PlaceVisual(Barrel, root, new Vector3(-4.9f, 0f, 2.25f), Quaternion.identity, 0.72f, 0.72f, 1f);
            PlaceVisual(Chest, root, new Vector3(4.7f, 0f, -2.4f), Quaternion.identity, 1.3f, 0.8f, 0.82f);
            PlaceVisual(Lantern, root, new Vector3(-5.35f, 2.05f, 2.75f), Quaternion.identity, 0.3f, 0.3f, 0.48f);
        }

        private static void BuildGuardPost(Transform root, ObjectSize size)
        {
            BuildCanopy(root, Roof02, size.Width, size.Depth, true);
            PlaceVisual(Table, root, new Vector3(0f, 0f, 0.55f), Quaternion.identity, 2.35f, 0.9f, 0.9f);
            PlaceVisual(Bench, root, new Vector3(0f, 0f, -1.15f), Quaternion.identity, 1.8f, 0.62f, 0.72f);
            PlaceVisual(Lantern, root, new Vector3(1.8f, 1.75f, -1.2f), Quaternion.identity, 0.3f, 0.3f, 0.48f);
        }

        private static void BuildPlazaSeating(Transform root)
        {
            PlaceRotatedVisual(Bench, root, new Vector3(-2.65f, 0f, 0f), 90f, 2f, 0.65f, 0.75f);
            PlaceRotatedVisual(Bench, root, new Vector3(2.65f, 0f, 0f), 90f, 2f, 0.65f, 0.75f);
            PlaceRotatedVisual(Bench, root, new Vector3(0f, 0f, 2.65f), 0f, 2f, 0.65f, 0.75f);
            PlaceVisual(Barrel, root, new Vector3(2.45f, 0f, 2.45f), Quaternion.identity, 0.62f, 0.62f, 0.88f);
        }

        private static GameObject PlaceRotatedVisual(string prefab, Transform parent, Vector3 localPosition,
            float yaw, float width, float depth, float height)
        {
            var anchor = new GameObject("Rotated_" + Path.GetFileNameWithoutExtension(prefab));
            anchor.transform.SetParent(parent, false);
            anchor.transform.localPosition = localPosition;
            GameObject visual = PlaceVisual(prefab, anchor.transform, Vector3.zero, Quaternion.identity, width, depth, height);
            anchor.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            return visual;
        }

        private static void BuildCanopy(Transform root, string roof, float width, float depth, bool clothStall)
        {
            PlaceVisual(roof, root, new Vector3(0f, 2.25f, 0f), Quaternion.identity, width, depth, 0.65f);
            float x = Mathf.Max(1f, width * 0.42f);
            float z = Mathf.Max(0.8f, depth * 0.39f);
            PlaceVisual(Branch03, root, new Vector3(-x, 0f, -z), Quaternion.identity, 0.32f, 0.32f, 2.35f);
            PlaceVisual(Branch03, root, new Vector3(x, 0f, -z), Quaternion.Euler(0f, 180f, 0f), 0.32f, 0.32f, 2.35f);
            PlaceVisual(Branch03, root, new Vector3(-x, 0f, z), Quaternion.Euler(0f, 90f, 0f), 0.32f, 0.32f, 2.35f);
            PlaceVisual(Branch03, root, new Vector3(x, 0f, z), Quaternion.Euler(0f, 270f, 0f), 0.32f, 0.32f, 2.35f);
            if (clothStall)
                PlaceVisual(Cloth, root, new Vector3(0f, 1.15f, z), Quaternion.identity, width * 0.72f, 0.35f, 1.2f);
        }

        private static void BuildCargoCluster(Transform root, ObjectSize size, int variant)
        {
            PlaceVisual(Chest, root, new Vector3(-size.Width * 0.22f, 0f, 0f), Quaternion.identity,
                Mathf.Min(1.45f, size.Width * 0.48f), Mathf.Min(0.9f, size.Depth * 0.7f), 0.82f);
            PlaceVisual(Barrel, root, new Vector3(size.Width * 0.3f, 0f, -size.Depth * 0.18f),
                Quaternion.Euler(0f, variant % 360, 0f), 0.72f, 0.72f, 1f);
            if (size.Width > 2.5f)
                PlaceVisual(Barrel, root, new Vector3(size.Width * 0.28f, 0f, size.Depth * 0.25f),
                    Quaternion.identity, 0.64f, 0.64f, 0.92f);
        }

        private static void AddGameplayColliders(LocationObject entry, GameObject root, ObjectSize size)
        {
            if (!BlocksMovement(entry)) return;
            if (entry.CollisionParts != null && entry.CollisionParts.Count > 0)
            {
                for (int i = 0; i < entry.CollisionParts.Count; i++)
                {
                    var part = entry.CollisionParts[i];
                    float centerX = part?["center"]?["x"]?.Value<float>() ?? part?["x"]?.Value<float>() ?? 0f;
                    float centerY = part?["center"]?["y"]?.Value<float>() ?? part?["y"]?.Value<float>() ?? 1f;
                    float centerZ = part?["center"]?["z"]?.Value<float>() ?? part?["z"]?.Value<float>() ?? 0f;
                    float width = part?["size"]?["x"]?.Value<float>() ?? part?["width"]?.Value<float>() ?? 0f;
                    float height = part?["size"]?["y"]?.Value<float>() ?? part?["height"]?.Value<float>() ?? 2f;
                    float depth = part?["size"]?["z"]?.Value<float>() ?? part?["depth"]?.Value<float>() ?? 0f;
                    if (width <= 0f || height <= 0f || depth <= 0f)
                        throw new InvalidOperationException("Invalid collisionParts entry on " + entry.Id + ".");
                    AddBox(root, RoaCoords.ToUnity(centerX, centerY, centerZ), new Vector3(width, height, depth));
                }
                return;
            }
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            if (model.Contains("tradehall") && !model.Contains("roof"))
            {
                AddBox(root, new Vector3(0f, 1.6f, 2.15f), new Vector3(10.5f, 3.2f, 0.42f));
                AddBox(root, new Vector3(-5.05f, 1.6f, 0f), new Vector3(0.42f, 3.2f, 4.7f));
                AddBox(root, new Vector3(5.05f, 1.6f, 0f), new Vector3(0.42f, 3.2f, 4.7f));
                AddBox(root, new Vector3(-3.55f, 1.6f, -2.15f), new Vector3(3.25f, 3.2f, 0.42f));
                AddBox(root, new Vector3(3.55f, 1.6f, -2.15f), new Vector3(3.25f, 3.2f, 0.42f));
                return;
            }
            if (model.Contains("loadingcanopy"))
            {
                float x = size.Width * 0.42f;
                float z = size.Depth * 0.39f;
                AddBox(root, new Vector3(-x, 1.15f, -z), new Vector3(0.38f, 2.3f, 0.38f));
                AddBox(root, new Vector3(x, 1.15f, -z), new Vector3(0.38f, 2.3f, 0.38f));
                AddBox(root, new Vector3(-x, 1.15f, z), new Vector3(0.38f, 2.3f, 0.38f));
                AddBox(root, new Vector3(x, 1.15f, z), new Vector3(0.38f, 2.3f, 0.38f));
                return;
            }
            if (model.Contains("caravan"))
            {
                AddBox(root, new Vector3(0f, 0.7f, -0.9f), new Vector3(3.2f, 1.4f, 1.1f));
                AddBox(root, new Vector3(0f, 1.25f, 1.55f), new Vector3(size.Width * 0.72f, 2.5f, 0.45f));
                return;
            }

            AddBox(root, new Vector3(0f, size.Height * 0.5f, 0f),
                new Vector3(Mathf.Max(0.4f, size.Width), size.Height, Mathf.Max(0.4f, size.Depth)));
        }

        private static void AddBox(GameObject root, Vector3 center, Vector3 size)
        {
            BoxCollider collider = root.AddComponent<BoxCollider>();
            collider.center = center;
            collider.size = size;
        }

        private static ObjectSize SizeFor(LocationObject entry)
        {
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            float width = entry.Footprint != null && entry.Footprint.X > 0.1f ? entry.Footprint.X : 0f;
            float depth = entry.Footprint != null && entry.Footprint.Z > 0.1f ? entry.Footprint.Z : 0f;
            float height = 1.7f;

            if (model.Contains("defensiveperimeter")) { width = 50f; depth = 48f; height = 4.9f; }
            else if (model.Contains("brahminpens")) { width = width > 0 ? width : 14f; depth = depth > 0 ? depth : 8f; height = 1.25f; }
            else if (model.Contains("gardens")) { width = width > 0 ? width : 14f; depth = depth > 0 ? depth : 7f; height = 0.7f; }
            else if (model.Contains("residentialrow")) { width = width > 0 ? width : 22f; depth = depth > 0 ? depth : 5f; height = 3.25f; }
            else if (model.Contains("workshopshelter")) { width = width > 0 ? width : 13f; depth = depth > 0 ? depth : 8f; height = 3.75f; }
            else if (model.Contains("guardpost")) { width = width > 0 ? width : 5f; depth = depth > 0 ? depth : 3.5f; height = 2.8f; }
            else if (model.Contains("plazaseating")) { width = width > 0 ? width : 7f; depth = depth > 0 ? depth : 7f; height = 0.9f; }
            else if (model.Contains("cliffcorner")) { width = 6f; depth = 5f; height = 3.4f; }
            else if (model.Contains("cliffstraight")) { width = 6f; depth = 2.7f; height = 3.2f; }
            else if (model.Contains("cliffend")) { width = 5f; depth = 3f; height = 3f; }
            else if (model.Contains("tradehall")) { width = width > 0 ? width : 11f; depth = depth > 0 ? depth : 5f; height = 4.5f; }
            else if (model.Contains("caravan")) { width = width > 0 ? width : 6f; depth = depth > 0 ? depth : 4f; height = 3.4f; }
            else if (model.Contains("canopy")) { width = width > 0 ? width : 5f; depth = depth > 0 ? depth : 4f; height = 2.8f; }
            else if (model.Contains("watchtower")) { width = 3.5f; depth = 3.5f; height = 5.2f; }
            else if (model.Contains("gate")) { width = width > 0 ? width : 5f; depth = depth > 0 ? depth : 1.1f; height = model.Contains("maingate") ? 3.8f : 3.2f; }
            else if (model.Contains("utilitypole") || model.Contains("tree")) { width = 1.5f; depth = 1.5f; height = 5f; }
            else if (model.Contains("cargo")) { width = width > 0 ? width : 3.2f; depth = depth > 0 ? depth : 2.1f; height = 2.2f; }
            else if (model.Contains("craft") || model.Contains("bench") || model.Contains("armory")) { width = 2.2f; depth = 1.25f; height = 1.4f; }
            else if (model.Contains("scrub") || model.Contains("bush")) { width = 1.5f; depth = 1.5f; height = 1.1f; }
            else if (model.Contains("rock") || model.Contains("rubble") || model.Contains("scrap") || model.Contains("tire")) { width = 2.2f; depth = 1.8f; height = 1.4f; }

            if (width <= 0f) width = 2f;
            if (depth <= 0f) depth = 2f;
            return new ObjectSize(width, depth, height);
        }

        private static GameObject PlaceVisual(string prefabPath, Transform parent, Vector3 localPosition,
            Quaternion localRotation, float targetWidth, float targetDepth, float targetHeight = -1f)
        {
            GameObject prefab = RequireAsset<GameObject>(prefabPath);
            GameObject visual = PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
            if (visual == null) throw new InvalidOperationException("Cannot instantiate " + prefabPath);
            visual.name = prefab.name;
            visual.transform.localPosition = localPosition;
            visual.transform.localRotation = localRotation;
            visual.transform.localScale = Vector3.one;
            DisableGameplayComponents(visual);

            if (TryBounds(visual, out Bounds before) && before.size.x > 0.001f && before.size.z > 0.001f)
            {
                float scaleX = Mathf.Clamp(targetWidth / before.size.x, 0.08f, 8f);
                float scaleZ = Mathf.Clamp(targetDepth / before.size.z, 0.08f, 8f);
                float scaleY = targetHeight > 0.001f && before.size.y > 0.001f
                    ? Mathf.Clamp(targetHeight / before.size.y, 0.04f, 8f)
                    : Mathf.Sqrt(scaleX * scaleZ);
                visual.transform.localScale = new Vector3(scaleX, scaleY, scaleZ);
                if (TryBounds(visual, out Bounds after))
                {
                    float targetGround = parent.position.y + localPosition.y;
                    visual.transform.position += Vector3.up * (targetGround - after.min.y);
                }
            }
            return visual;
        }

        private static int AddEnvironmentDressing(Terrain terrain, Transform parent)
        {
            DressingSpec[] specs =
            {
                // Sparse edge dressing; the painted terrain already carries the route.
                new DressingSpec(DryGrass, -31f, -18f, 22f, 1.2f, 1.2f),
                new DressingSpec(DryGrass, -27f, -2f, 71f, 1f, 1f),
                new DressingSpec(DryGrass, 31f, -14f, 132f, 1.25f, 1.25f),
                new DressingSpec(DryGrass, 27f, 1f, 18f, 0.9f, 0.9f),
                new DressingSpec(Bush01, -23f, -23f, 38f, 1.5f, 1.5f),
                new DressingSpec(Bush02, 21f, -25f, 146f, 1.35f, 1.35f),
                new DressingSpec(GroundStone, -7f, 23f, 17f, 1.4f, 1.2f),
                new DressingSpec(GroundStone, 9f, 20f, 94f, 1.1f, 1f),
                new DressingSpec(Rock01, -32f, 7f, 61f, 1.45f, 1.25f),
                new DressingSpec(Rock04, 32f, 6f, 118f, 1.35f, 1.2f),
                new DressingSpec(DryGrass, -5f, -18f, 43f, 0.8f, 0.8f),
                new DressingSpec(DryGrass, 11f, -20f, 103f, 0.85f, 0.85f)
            };

            for (int i = 0; i < specs.Length; i++)
            {
                DressingSpec spec = specs[i];
                Vector3 world = spec.Position;
                world.y = terrain.SampleHeight(world) + terrain.transform.position.y;
                var anchor = new GameObject("Dressing_" + i.ToString("00"));
                anchor.transform.SetParent(parent, false);
                anchor.transform.position = world;
                anchor.transform.rotation = Quaternion.Euler(0f, spec.Yaw, 0f);
                PlaceVisual(spec.Prefab, anchor.transform, Vector3.zero, Quaternion.identity,
                    spec.Width, spec.Depth, DressingHeight(spec.Prefab));
                SetStaticRecursive(anchor);
            }
            return specs.Length;
        }

        private static float DressingHeight(string prefab)
        {
            if (prefab == DryGrass) return 0.55f;
            if (prefab == Bush01 || prefab == Bush02) return 1.05f;
            if (prefab == GroundStone) return 0.32f;
            return 0.85f;
        }

        private static bool BlocksMovement(LocationObject entry)
        {
            string collision = (entry.Collision ?? string.Empty).Trim().ToLowerInvariant();
            if (collision != "solid" && collision != "block" && collision != "blocked"
                && collision != "wall" && collision != "resource") return false;
            if (AllowsPlayerOverlap(entry.PlayerCollision) || AllowsPlayerOverlap(entry.MovementCollision))
                return false;
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            if (model.Contains("roof")) return false;
            string kind = ((entry.Kind ?? string.Empty) + " "
                + (entry.Entity?["kind"]?.ToString() ?? string.Empty)
                + " " + (entry.Interactive?["kind"]?.ToString() ?? string.Empty)).ToLowerInvariant();
            if (kind.Contains("craft") || kind.Contains("storage") || kind.Contains("container")
                || kind.Contains("jobboard") || kind.Contains("trade")) return false;
            if (entry.Tags != null)
            {
                for (int i = 0; i < entry.Tags.Count; i++)
                {
                    string tag = (entry.Tags[i] ?? string.Empty).ToLowerInvariant();
                    if (tag.Contains("interactive") || tag.Contains("craft") || tag.Contains("storage")
                        || tag.Contains("container") || tag.Contains("jobboard") || tag.Contains("pass-through"))
                        return false;
                }
            }
            return true;
        }

        private static bool AllowsPlayerOverlap(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return false;
            if (value.Type == JTokenType.Boolean) return !value.Value<bool>();
            string mode = value.ToString().Trim().ToLowerInvariant();
            return mode == "none" || mode == "false" || mode == "off" || mode == "pass-through"
                || mode == "passthrough" || mode == "overlap" || mode == "disabled";
        }

        private static int ConvertSceneMaterials(GameObject sceneRoot)
        {
            EnsureAssetDirectory(MaterialDirectory);
            var converted = new Dictionary<Material, Material>();
            Renderer[] renderers = sceneRoot.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Material[] materials = renderers[i].sharedMaterials;
                bool changed = false;
                for (int j = 0; j < materials.Length; j++)
                {
                    Material source = materials[j];
                    if (source == null) continue;
                    if (!converted.TryGetValue(source, out Material target))
                    {
                        target = ConvertMaterial(source, renderers[i] is ParticleSystemRenderer);
                        converted.Add(source, target);
                    }
                    materials[j] = target;
                    changed = true;
                }
                if (changed) renderers[i].sharedMaterials = materials;
            }
            return converted.Count;
        }

        private static Material ConvertMaterial(Material source, bool particle)
        {
            string sourcePath = AssetDatabase.GetAssetPath(source);
            string materialPath = MaterialDirectory + "/MEP_"
                + StableHash(sourcePath + "|" + source.name).ToString("X8") + ".mat";
            Material target = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            Shader shader = Shader.Find(particle
                ? "Universal Render Pipeline/Particles/Unlit"
                : "Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) throw new InvalidOperationException("URP material shader was not found.");

            if (target == null)
            {
                target = new Material(shader) { name = source.name + "_URP" };
                AssetDatabase.CreateAsset(target, materialPath);
            }
            else
            {
                target.shader = shader;
                target.name = source.name + "_URP";
            }

            Texture baseMap = TextureProperty(source, "_BaseMap", "_MainTex");
            Color baseColor = ColorProperty(source, Color.white, "_BaseColor", "_Color", "_TintColor");
            if (target.HasProperty("_BaseMap")) target.SetTexture("_BaseMap", baseMap);
            if (target.HasProperty("_BaseColor")) target.SetColor("_BaseColor", baseColor);
            if (baseMap != null && target.HasProperty("_BaseMap"))
            {
                string sourceTextureProperty = source.HasProperty("_BaseMap") ? "_BaseMap" : "_MainTex";
                if (source.HasProperty(sourceTextureProperty))
                {
                    target.SetTextureScale("_BaseMap", source.GetTextureScale(sourceTextureProperty));
                    target.SetTextureOffset("_BaseMap", source.GetTextureOffset(sourceTextureProperty));
                }
            }

            Texture normal = TextureProperty(source, "_BumpMap", "_NormalMap");
            if (normal != null && target.HasProperty("_BumpMap"))
            {
                target.SetTexture("_BumpMap", normal);
                target.EnableKeyword("_NORMALMAP");
                if (target.HasProperty("_BumpScale"))
                    target.SetFloat("_BumpScale", FloatProperty(source, 1f, "_BumpScale"));
            }
            else target.DisableKeyword("_NORMALMAP");

            Texture metallicGloss = TextureProperty(source, "_MetallicGlossMap");
            if (target.HasProperty("_MetallicGlossMap")) target.SetTexture("_MetallicGlossMap", metallicGloss);
            if (target.HasProperty("_Metallic"))
                target.SetFloat("_Metallic", FloatProperty(source, 0f, "_Metallic"));
            if (target.HasProperty("_Smoothness"))
                target.SetFloat("_Smoothness", FloatProperty(source, 0.22f, "_Smoothness", "_Glossiness"));

            Texture occlusion = TextureProperty(source, "_OcclusionMap");
            if (target.HasProperty("_OcclusionMap")) target.SetTexture("_OcclusionMap", occlusion);
            Texture emissionMap = TextureProperty(source, "_EmissionMap");
            Color emission = ColorProperty(source, Color.black, "_EmissionColor");
            if (target.HasProperty("_EmissionMap")) target.SetTexture("_EmissionMap", emissionMap);
            if (target.HasProperty("_EmissionColor")) target.SetColor("_EmissionColor", emission);
            if (emissionMap != null || emission.maxColorComponent > 0.02f) target.EnableKeyword("_EMISSION");
            else target.DisableKeyword("_EMISSION");

            string shaderName = source.shader != null ? source.shader.name.ToLowerInvariant() : string.Empty;
            bool transparent = source.renderQueue >= 3000 || shaderName.Contains("transparent")
                || source.IsKeywordEnabled("_ALPHABLEND_ON") || source.IsKeywordEnabled("_ALPHAPREMULTIPLY_ON");
            bool cutout = !transparent && (source.renderQueue >= 2450
                || shaderName.Contains("cutout") || source.IsKeywordEnabled("_ALPHATEST_ON"));
            ConfigureUrpSurface(target, transparent, cutout,
                FloatProperty(source, 0.5f, "_Cutoff", "_AlphaClipThreshold"));

            string lowerPath = sourcePath.ToLowerInvariant();
            bool doubleSided = lowerPath.Contains("vegetation") || lowerPath.Contains("bush")
                || lowerPath.Contains("tree") || shaderName.Contains("nature");
            if (target.HasProperty("_Cull")) target.SetFloat("_Cull", doubleSided ? 0f : 2f);
            EditorUtility.SetDirty(target);
            return target;
        }

        private static void ConfigureUrpSurface(Material material, bool transparent, bool cutout, float cutoff)
        {
            if (material.HasProperty("_AlphaClip")) material.SetFloat("_AlphaClip", cutout ? 1f : 0f);
            if (material.HasProperty("_Cutoff")) material.SetFloat("_Cutoff", cutoff);
            if (cutout) material.EnableKeyword("_ALPHATEST_ON");
            else material.DisableKeyword("_ALPHATEST_ON");

            if (transparent)
            {
                if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
                if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", 5f);
                if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", 10f);
                if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                material.renderQueue = 3000;
            }
            else
            {
                if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 0f);
                if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", 1f);
                if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", 0f);
                if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 1f);
                material.DisableKeyword("_SURFACE_TYPE_TRANSPARENT");
                material.renderQueue = cutout ? 2450 : -1;
            }
        }

        private static Texture TextureProperty(Material material, params string[] names)
        {
            for (int i = 0; i < names.Length; i++)
                if (material.HasProperty(names[i]))
                {
                    Texture value = material.GetTexture(names[i]);
                    if (value != null) return value;
                }
            return null;
        }

        private static float FloatProperty(Material material, float fallback, params string[] names)
        {
            for (int i = 0; i < names.Length; i++)
                if (material.HasProperty(names[i])) return material.GetFloat(names[i]);
            return fallback;
        }

        private static Color ColorProperty(Material material, Color fallback, params string[] names)
        {
            for (int i = 0; i < names.Length; i++)
                if (material.HasProperty(names[i])) return material.GetColor(names[i]);
            return fallback;
        }

        private static void DisableGameplayComponents(GameObject visual)
        {
            foreach (Collider collider in visual.GetComponentsInChildren<Collider>(true))
                UnityEngine.Object.DestroyImmediate(collider);
            foreach (Rigidbody body in visual.GetComponentsInChildren<Rigidbody>(true))
                UnityEngine.Object.DestroyImmediate(body);
        }

        private static bool TryBounds(GameObject root, out Bounds bounds)
        {
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            bool found = false;
            bounds = new Bounds(root.transform.position, Vector3.zero);
            for (int i = 0; i < renderers.Length; i++)
            {
                if (renderers[i] is ParticleSystemRenderer) continue;
                if (!found) { bounds = renderers[i].bounds; found = true; }
                else bounds.Encapsulate(renderers[i].bounds);
            }
            return found;
        }

        private static void SetStaticRecursive(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static void ValidateScene(RoaUnityLocationScene marker, Terrain terrain,
            LocationDefinition definition, int expectedObjects, int builtObjects)
        {
            if (terrain == null || terrain.GetComponent<TerrainCollider>() == null)
                throw new InvalidOperationException("Old Klim scene has no Unity Terrain/TerrainCollider.");
            marker.RebuildIndex();
            if (builtObjects != expectedObjects || marker.ObjectCount != expectedObjects)
                throw new InvalidOperationException("Authored object mismatch: expected=" + expectedObjects
                    + ", built=" + builtObjects + ", indexed=" + marker.ObjectCount);
            if (expectedObjects < 35)
                throw new InvalidOperationException("Unexpectedly few curated MEP objects: " + expectedObjects);
            foreach (LocationObject entry in definition.Objects)
            {
                if (entry == null || entry.IsLiveEntity()) continue;
                if (!ShouldUseMep(entry))
                {
                    if (string.IsNullOrEmpty(entry.Url))
                        throw new InvalidOperationException("Legacy fallback has no GLB URL: " + entry.Id);
                    if (marker.TryGetObject(entry.Id, out _))
                        throw new InvalidOperationException("Unapproved MEP substitution leaked into scene: " + entry.Id);
                    continue;
                }
                if (!marker.TryGetObject(entry.Id, out GameObject root))
                    throw new InvalidOperationException("Unity object is missing for authored id " + entry.Id);
                Vector3 expected = entry.Position != null
                    ? RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z)
                    : Vector3.zero;
                if (Mathf.Abs(root.transform.position.x - expected.x) > 0.01f
                    || Mathf.Abs(root.transform.position.z - expected.z) > 0.01f)
                    throw new InvalidOperationException("Unity object drifted from server X/Z: " + entry.Id);
                bool hasBox = root.GetComponents<BoxCollider>().Length > 0;
                if (BlocksMovement(entry) != hasBox)
                    throw new InvalidOperationException("Movement collider policy mismatch: " + entry.Id);
            }
            Renderer[] renderers = marker.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length < expectedObjects / 2)
                throw new InvalidOperationException("MEP presentation is incomplete: renderers=" + renderers.Length);
            for (int i = 0; i < renderers.Length; i++)
            {
                Material[] materials = renderers[i].sharedMaterials;
                for (int j = 0; j < materials.Length; j++)
                    if (materials[j] == null || materials[j].shader == null
                        || !materials[j].shader.isSupported
                        || materials[j].shader.name == "Hidden/InternalErrorShader")
                        throw new InvalidOperationException("Missing material/shader on " + renderers[i].name);
            }
        }

        private static void ConfigureSceneLighting()
        {
            Material sky = AssetDatabase.LoadAssetAtPath<Material>(Sky03);
            if (sky != null && sky.shader != null && sky.shader.isSupported) RenderSettings.skybox = sky;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.78f, 0.68f, 0.54f);
            RenderSettings.ambientEquatorColor = new Color(0.49f, 0.41f, 0.31f);
            RenderSettings.ambientGroundColor = new Color(0.25f, 0.2f, 0.15f);
            RenderSettings.ambientIntensity = 1.22f;
            RenderSettings.fog = false;
        }

        private static void CapturePreview(Scene scene, string outputPath,
            Vector3? cameraPosition = null, Vector3? lookAt = null, float fieldOfView = 38f)
        {
            var cameraObject = new GameObject("OldKlimPreviewCamera");
            var lightObject = new GameObject("OldKlimPreviewLight");
            SceneManager.MoveGameObjectToScene(cameraObject, scene);
            SceneManager.MoveGameObjectToScene(lightObject, scene);
            RenderTexture target = null;
            Texture2D image = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                Camera camera = cameraObject.AddComponent<Camera>();
                cameraObject.transform.position = cameraPosition ?? new Vector3(42f, 47f, 44f);
                cameraObject.transform.LookAt(lookAt ?? new Vector3(0f, 0f, -3f));
                camera.fieldOfView = fieldOfView;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 180f;
                camera.clearFlags = RenderSettings.skybox != null ? CameraClearFlags.Skybox : CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.145f, 0.13f);

                Light light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.65f;
                light.color = new Color(1f, 0.92f, 0.82f);
                light.shadows = LightShadows.Soft;
                lightObject.transform.rotation = Quaternion.Euler(52f, 138f, 0f);

                target = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32);
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                image = new Texture2D(1280, 720, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
                image.Apply();
                File.WriteAllBytes(outputPath, image.EncodeToPNG());
                camera.targetTexture = null;
            }
            finally
            {
                RenderTexture.active = previous;
                if (target != null) UnityEngine.Object.DestroyImmediate(target);
                if (image != null) UnityEngine.Object.DestroyImmediate(image);
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(lightObject);
            }
        }

        private static void AddSceneToBuildSettings()
        {
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            int index = scenes.FindIndex(item => item.path == ScenePath);
            if (index < 0) scenes.Add(new EditorBuildSettingsScene(ScenePath, true));
            else scenes[index] = new EditorBuildSettingsScene(ScenePath, true);
            EditorBuildSettings.scenes = scenes.ToArray();
        }

        private static T RequireAsset<T>(string path) where T : UnityEngine.Object
        {
            T asset = AssetDatabase.LoadAssetAtPath<T>(path);
            if (asset == null) throw new FileNotFoundException("Required MEP asset was not found", path);
            return asset;
        }

        private static void EnsureAssetDirectory(string path)
        {
            string[] parts = path.Split('/');
            string current = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }

        private static int StableHash(string value)
        {
            unchecked
            {
                int hash = 17;
                for (int i = 0; i < value.Length; i++) hash = hash * 31 + value[i];
                return hash & int.MaxValue;
            }
        }
    }
}
#endif
