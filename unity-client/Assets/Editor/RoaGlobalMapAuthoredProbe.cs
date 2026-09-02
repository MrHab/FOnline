#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Structural test for the prefab-only authored global map.</summary>
    public static class RoaGlobalMapAuthoredProbe
    {
        private const int ExpectedLivePrefabKinds = 14;

        [MenuItem("Realm of Ashes/Проверки/Авторская глобальная карта")]
        public static void Run()
        {
            RunInternal();
        }

        public static void RunBatch()
        {
            try
            {
                RunInternal();
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                else throw;
            }
        }

        private static void RunInternal()
        {
            Scene scene = SceneManager.GetSceneByPath(RoaGlobalMapAuthoringTools.ScenePath);
            bool openedHere = !scene.IsValid() || !scene.isLoaded;
            if (openedHere)
                scene = EditorSceneManager.OpenScene(RoaGlobalMapAuthoringTools.ScenePath, OpenSceneMode.Additive);

            GameObject temporary = null;
            try
            {
                RoaUnityGlobalMapScene marker = FindMarker(scene)
                    ?? throw new InvalidOperationException("RoaUnityGlobalMapScene отсутствует.");
                Require(marker.Validate(out string validationError), validationError);
                Require(marker.SelectionSurface.bounds.size.x >= 80f
                        && marker.SelectionSurface.bounds.size.z >= 80f,
                        "Поверхность выбора не покрывает глобальную карту.");
                Require(marker.SelectionSurface.GetComponent<Renderer>() == null,
                        "Поверхность выбора не должна быть видимой.");
                Require(marker.DynamicContentRoot.childCount == 0,
                        "DynamicContent_SERVER_STATE должен быть пустым в сохранённой сцене.");
                Light[] mapLights = marker.GetComponentsInChildren<Light>(true);
                Light mapSun = Array.Find(mapLights, light => light != null
                    && light.name == "GlobalMapSun_AUTHORED");
                Require(mapSun != null && mapSun.enabled
                        && mapSun.type == LightType.Directional
                        && mapSun.intensity >= 1f,
                        "GlobalMapSun_AUTHORED must provide a readable directional light.");

                Transform biomeTransitions = marker.StaticContentRoot.Find(
                    RoaGlobalMapSeamAuthoring.LayerName);
                Require(biomeTransitions != null
                        && biomeTransitions.childCount ==
                            RoaGlobalMapSeamAuthoring.ExpectedPlacementCount,
                        "Authored biome transitions are incomplete.");
                for (int i = 0; i < biomeTransitions.childCount; i++)
                {
                    Transform transition = biomeTransitions.GetChild(i);
                    Require(transition.name.StartsWith("BiomeBlend_", StringComparison.Ordinal)
                            && PrefabUtility.GetNearestPrefabInstanceRoot(
                                transition.gameObject) == transition.gameObject,
                            "Biome transition must remain a named MEP prefab instance.");
                    Collider[] transitionColliders =
                        transition.GetComponentsInChildren<Collider>(true);
                    for (int c = 0; c < transitionColliders.Length; c++)
                        Require(!transitionColliders[c].enabled,
                            "Decorative biome transition collider must stay disabled.");
                }

                Transform infrastructure = marker.StaticContentRoot.Find("Infrastructure");
                Require(infrastructure != null, "Infrastructure authoring layer is missing.");
                Transform roadNetwork = infrastructure.Find(
                    RoaGlobalMapRoadAuthoring.NetworkLayerName);
                Transform roadLandmarks = infrastructure.Find(
                    RoaGlobalMapRoadAuthoring.LandmarkLayerName);
                Require(roadNetwork != null
                        && roadNetwork.childCount ==
                            RoaGlobalMapRoadAuthoring.ExpectedRoadPieceCount
                            + RoaGlobalMapRoadAuthoring.ExpectedPipelinePieceCount,
                        "Authored road network is incomplete.");
                int roadPieces = 0;
                int pipelinePieces = 0;
                for (int i = 0; i < roadNetwork.childCount; i++)
                {
                    Transform piece = roadNetwork.GetChild(i);
                    if (piece.name.StartsWith("RoadPiece_", StringComparison.Ordinal)) roadPieces++;
                    else if (piece.name.StartsWith("PipelinePiece_", StringComparison.Ordinal))
                        pipelinePieces++;
                    else Require(false, "Infrastructure piece has no stable authored name.");
                    Require(PrefabUtility.GetNearestPrefabInstanceRoot(piece.gameObject)
                            == piece.gameObject,
                            "Infrastructure piece must remain a prefab instance.");
                    Collider[] colliders = piece.GetComponentsInChildren<Collider>(true);
                    for (int c = 0; c < colliders.Length; c++)
                        Require(!colliders[c].enabled,
                            "Strategic infrastructure collider must stay disabled.");
                }
                Require(roadPieces == RoaGlobalMapRoadAuthoring.ExpectedRoadPieceCount
                        && pipelinePieces ==
                            RoaGlobalMapRoadAuthoring.ExpectedPipelinePieceCount,
                        "Road or pipeline authored-piece count changed.");
                Require(roadLandmarks != null
                        && roadLandmarks.childCount ==
                            RoaGlobalMapRoadAuthoring.ExpectedLandmarkCount,
                        "Road landmarks are incomplete.");
                for (int i = 0; i < roadLandmarks.childCount; i++)
                {
                    Transform landmark = roadLandmarks.GetChild(i);
                    Require(landmark.name.StartsWith("RoadLandmark_", StringComparison.Ordinal)
                            && PrefabUtility.GetNearestPrefabInstanceRoot(landmark.gameObject)
                                == landmark.gameObject,
                            "Road landmark must remain a named MEP prefab instance.");
                    Collider[] colliders = landmark.GetComponentsInChildren<Collider>(true);
                    for (int c = 0; c < colliders.Length; c++)
                        Require(!colliders[c].enabled,
                            "Strategic road-landmark collider must stay disabled.");
                }
                Require(PrefabUtility.GetNearestPrefabInstanceRoot(marker.PlayerMarker) != null
                        && PrefabUtility.GetNearestPrefabInstanceRoot(marker.SelectionMarker) != null,
                        "Runtime handles должны быть prefab instances.");

                JObject map = JObject.Parse(File.ReadAllText(Path.GetFullPath(
                    Path.Combine(Application.dataPath, "../../data/global-map.json"))));
                ValidateAuthoredEnvironment(marker, map);
                JArray nodes = map["nodes"] as JArray ?? new JArray();
                foreach (JToken token in nodes)
                {
                    string id = token?["id"]?.ToString() ?? string.Empty;
                    Require(marker.TryGetNode(id, out RoaGlobalMapNodeAnchor anchor) && anchor != null,
                            "Нет авторского узла " + id + ".");
                    Require(anchor.transform.childCount > 0
                            && PrefabUtility.GetNearestPrefabInstanceRoot(
                                anchor.transform.GetChild(0).gameObject) != null,
                            "Визуал узла " + id + " не является prefab instance.");
                }

                int prefabInstances = CountPrefabInstances(scene);
                Require(prefabInstances >= 20,
                        "В сцене недостаточно prefab instances: " + prefabInstances + ".");

                RoaGlobalMapPrefabKind[] kinds =
                    (RoaGlobalMapPrefabKind[])Enum.GetValues(typeof(RoaGlobalMapPrefabKind));
                Require(kinds.Length == ExpectedLivePrefabKinds,
                        "Ожидалось 14 типов live-prefab, найдено " + kinds.Length + ".");

                temporary = new GameObject("GlobalMapProbe_LivePrefabs");
                SceneManager.MoveGameObjectToScene(temporary, scene);
                var firstInstances = new Dictionary<RoaGlobalMapPrefabKind, GameObject>();
                int mepCompositeCount = 0;
                foreach (RoaGlobalMapPrefabKind kind in kinds)
                {
                    GameObject prefab = marker.PrefabFor(kind);
                    Require(prefab != null, "Не назначен live-prefab " + kind + ".");
                    bool usesMep = ValidatePrefabAsset(kind, prefab);
                    if (usesMep) mepCompositeCount++;
                    Require(!RequiresMep(kind) || usesMep,
                            "Live-prefab " + kind + " должен содержать модель MEP.");

                    GameObject instance = marker.InstantiateLivePrefab(kind, temporary.transform);
                    Require(instance != null, "Не создаётся live-prefab " + kind + ".");
                    Require(instance.GetComponentInChildren<Renderer>(true) != null,
                            "Live-prefab " + kind + " не содержит Renderer.");
                    Require(instance.GetComponentInChildren<LineRenderer>(true) == null,
                            "Live-prefab " + kind + " содержит запрещённый LineRenderer.");
                    firstInstances.Add(kind, instance);
                }
                Require(marker.ActiveLiveInstanceCount == kinds.Length,
                        "Счётчик активных prefab instances не совпадает с каталогом.");
                Require(mepCompositeCount >= 8,
                        "Недостаточно live-prefab с моделями MEP: " + mepCompositeCount + ".");

                foreach (GameObject instance in firstInstances.Values)
                    marker.ReleaseLivePrefab(instance);
                Require(marker.ActiveLiveInstanceCount == 0,
                        "ReleaseLivePrefab не вернул все экземпляры в пул.");

                foreach (RoaGlobalMapPrefabKind kind in kinds)
                {
                    GameObject reused = marker.InstantiateLivePrefab(kind, temporary.transform);
                    Require(ReferenceEquals(reused, firstInstances[kind]),
                            "Пул не переиспользовал live-prefab " + kind + ".");
                    marker.ReleaseLivePrefab(reused);
                }
                Require(marker.ActiveLiveInstanceCount == 0,
                        "После проверки в сцене остались активные live-prefab instances.");

                Renderer[] renderers = marker.StaticContentRoot.GetComponentsInChildren<Renderer>(true);
                int urpMaterials = 0;
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    if (renderer == null) continue;
                    Require(PrefabUtility.GetNearestPrefabInstanceRoot(renderer.gameObject) != null,
                            "Видимый объект " + renderer.name + " не является prefab instance.");
                    Material[] materials = renderer.sharedMaterials;
                    for (int m = 0; m < materials.Length; m++)
                    {
                        Material material = materials[m];
                        if (material == null) continue;
                        Require(material.shader != null
                                && material.shader.name.StartsWith(
                                    "Universal Render Pipeline/", StringComparison.Ordinal),
                                "Материал " + material.name + " использует не URP shader.");
                        urpMaterials++;
                    }
                }
                Require(urpMaterials > 0, "URP-материалы карты не найдены.");

                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА] No Generated Global Map готова: узлы=" + nodes.Count
                          + ", prefab instances=" + prefabInstances
                          + ", live-prefab=" + kinds.Length
                          + ", MEP composites=" + mepCompositeCount
                          + ", biome detail="
                          + RoaGlobalMapEnvironmentAuthoring.ExpectedBiomeDetailCount
                          + ", coast detail="
                          + RoaGlobalMapEnvironmentAuthoring.ExpectedCoastDetailCount
                          + ", URP materials=" + urpMaterials + ".", marker);
            }
            finally
            {
                if (temporary != null) UnityEngine.Object.DestroyImmediate(temporary);
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static bool ValidatePrefabAsset(RoaGlobalMapPrefabKind kind, GameObject prefab)
        {
            string prefabPath = AssetDatabase.GetAssetPath(prefab);
            Require(!string.IsNullOrWhiteSpace(prefabPath),
                    "Live-prefab " + kind + " не является сохранённым asset.");
            Require(prefab.GetComponentInChildren<LineRenderer>(true) == null,
                    "Live-prefab " + kind + " содержит LineRenderer.");

            MeshFilter[] filters = prefab.GetComponentsInChildren<MeshFilter>(true);
            Require(filters.Length > 0, "Live-prefab " + kind + " не содержит сохранённой геометрии.");
            for (int i = 0; i < filters.Length; i++)
            {
                Mesh mesh = filters[i] != null ? filters[i].sharedMesh : null;
                Require(mesh != null, "Live-prefab " + kind + " содержит пустой MeshFilter.");
                string meshPath = AssetDatabase.GetAssetPath(mesh).Replace('\\', '/');
                Require(meshPath.StartsWith("Assets/", StringComparison.Ordinal)
                        && meshPath.IndexOf("unity default resources", StringComparison.OrdinalIgnoreCase) < 0,
                        "Live-prefab " + kind + " использует встроенный Unity primitive mesh.");
            }

            string[] dependencies = AssetDatabase.GetDependencies(prefabPath, true);
            for (int i = 0; i < dependencies.Length; i++)
            {
                if (!dependencies[i].Replace('\\', '/').StartsWith("Assets/MEP/", StringComparison.Ordinal))
                    continue;
                return true;
            }
            return false;
        }

        private static void ValidateAuthoredEnvironment(RoaUnityGlobalMapScene marker,
                                                        JObject map)
        {
            JObject cells = map?["cells"] as JObject
                ?? throw new InvalidOperationException("Global-map cells are missing.");
            int waterCells = 0;
            foreach (JProperty property in cells.Properties())
            {
                string texture = property.Value?["texture"]?.ToString()
                    ?.Trim().ToLowerInvariant() ?? string.Empty;
                if (texture == "water" || texture == "ocean"
                    || texture == "sea" || texture == "lake") waterCells++;
            }
            Require(waterCells == RoaGlobalMapEnvironmentAuthoring.ExpectedWaterCellCount,
                    "West-ocean source cell count changed: " + waterCells + ".");

            Transform biomeDetail = marker.StaticContentRoot.Find(
                RoaGlobalMapEnvironmentAuthoring.BiomeDetailLayerName);
            Require(biomeDetail != null
                    && biomeDetail.childCount ==
                        RoaGlobalMapEnvironmentAuthoring.ExpectedBiomeDetailCount,
                    "Authored biome-detail layer is incomplete.");
            ValidatePrefabChildren(biomeDetail, "BiomeDetail_", true);

            Transform worldEdge = marker.StaticContentRoot.Find(
                RoaGlobalMapEnvironmentAuthoring.WorldEdgeLayerName);
            Require(worldEdge != null, "Authored world-edge layer is missing.");
            Transform ocean = worldEdge.Find("WestOcean_AUTHORED");
            Transform horizon = worldEdge.Find("HorizonTerrain_AUTHORED");
            Transform toxicFog = worldEdge.Find("ToxicBoundaryFog_AUTHORED");
            Transform coast = worldEdge.Find(
                RoaGlobalMapEnvironmentAuthoring.CoastDetailLayerName);
            Require(ocean != null && horizon != null && toxicFog != null && coast != null,
                    "West ocean, horizon terrain, toxic fog or coast-detail layer is missing.");
            Require(coast.childCount ==
                    RoaGlobalMapEnvironmentAuthoring.ExpectedCoastDetailCount,
                    "Authored west-coast detail count changed.");
            ValidatePrefabChildren(coast, "CoastDetail_", true);

            Bounds oceanBounds = ValidateEnvironmentPrefab(ocean,
                RoaGlobalMapEnvironmentAuthoring.OceanPrefabPath,
                RoaGlobalMapEnvironmentAuthoring.OceanMeshPath,
                RoaGlobalMapEnvironmentAuthoring.OceanMaterialPath,
                "Universal Render Pipeline/Realm of Ashes/Global Map West Ocean");
            Require(oceanBounds.min.x <= -200f && oceanBounds.size.z >= 400f,
                    "West ocean no longer reaches the fog horizon around the map.");

            // Художественное решение 2026-09-02: горизонт носит ЕДИНЫЙ
            // материал земли — узор продолжается через кромку без шва.
            Bounds horizonBounds = ValidateEnvironmentPrefab(horizon,
                RoaGlobalMapEnvironmentAuthoring.HorizonPrefabPath,
                RoaGlobalMapEnvironmentAuthoring.HorizonMeshPath,
                "Assets/Art/GlobalMap/Materials/GM_GroundUnified.mat",
                "Universal Render Pipeline/Realm of Ashes/Global Map Unified Ground");
            float horizonExtent = RoaGlobalMapEnvironmentAuthoring.HorizonExtent;
            Require(horizonBounds.max.x >= horizonExtent - 2f
                    && horizonBounds.max.z >= horizonExtent - 2f
                    && horizonBounds.min.z <= -horizonExtent + 2f,
                    "Horizon terrain no longer reaches about 220 metres.");

            Bounds toxicFogBounds = ValidateEnvironmentPrefab(toxicFog,
                RoaGlobalMapEnvironmentAuthoring.ToxicFogPrefabPath,
                RoaGlobalMapEnvironmentAuthoring.ToxicFogMeshPath,
                RoaGlobalMapEnvironmentAuthoring.ToxicFogMaterialPath,
                "Universal Render Pipeline/Realm of Ashes/Global Map Toxic Boundary Fog");
            Renderer toxicFogRenderer = toxicFog.GetComponentInChildren<Renderer>(true);
            Material toxicFogMaterial = toxicFogRenderer != null
                ? toxicFogRenderer.sharedMaterial : null;
            Require(toxicFogMaterial != null
                    && toxicFogMaterial.GetFloat("_Density") >= 0.95f
                    && toxicFogMaterial.GetFloat("_VerticalMotion") <= 0.001f,
                    "Toxic boundary fog is no longer dense and seam-safe.");
            float toxicExtent = RoaGlobalMapEnvironmentAuthoring.ToxicFogOuterExtent;
            Require(toxicFogBounds.min.x <= -toxicExtent + 1f
                    && toxicFogBounds.max.x >= toxicExtent - 1f
                    && toxicFogBounds.min.z <= -toxicExtent + 1f
                    && toxicFogBounds.max.z >= toxicExtent - 1f,
                    "Toxic boundary fog no longer surrounds all four map edges.");

            Bounds selectionBounds = marker.SelectionSurface.bounds;
            Require(Mathf.Abs(selectionBounds.size.x - 90f) <= 0.1f
                    && Mathf.Abs(selectionBounds.size.z - 90f) <= 0.1f,
                    "Playable global-map selection surface is no longer 90x90 metres.");
            ValidateHorizonOutsideSelection(horizon, selectionBounds);
            ValidateFogOutsideSelection(toxicFog,
                RoaGlobalMapEnvironmentAuthoring.ToxicFogInnerExtent);
            float groundY = ValidateVisibleGround(marker.StaticContentRoot);
            int grounded = 0;
            grounded += ValidateGroundedRoots(biomeDetail, groundY);
            grounded += ValidateGroundedRoots(coast, groundY);
            grounded += ValidateGroundedRoots(marker.StaticContentRoot.Find(
                RoaGlobalMapSeamAuthoring.LayerName), groundY);
            grounded += ValidateGroundedRoots(marker.StaticContentRoot.Find("Decor"), groundY);
            grounded += ValidateGroundedRoots(marker.StaticContentRoot.Find("Infrastructure/"
                + RoaGlobalMapRoadAuthoring.LandmarkLayerName), groundY);
            grounded += ValidateGroundedRoots(marker.StaticContentRoot.Find("Locations"), groundY);
            Require(grounded == 18,
                    "Unexpected grounded environment root count: " + grounded + ".");
            ValidateDisabledColliders(worldEdge,
                "World-edge and coast decoration colliders must stay disabled.");
        }

        private static void ValidatePrefabChildren(Transform layer, string namePrefix,
                                                   bool requireDisabledColliders)
        {
            for (int i = 0; i < layer.childCount; i++)
            {
                Transform child = layer.GetChild(i);
                Require(child.name.StartsWith(namePrefix, StringComparison.Ordinal)
                        && PrefabUtility.GetNearestPrefabInstanceRoot(child.gameObject)
                            == child.gameObject,
                        layer.name + " must contain named prefab-instance roots only.");
            }
            if (requireDisabledColliders)
                ValidateDisabledColliders(layer,
                    layer.name + " contains an enabled decorative collider.");
        }

        private static Bounds ValidateEnvironmentPrefab(Transform instance,
                                                         string expectedPrefabPath,
                                                         string expectedMeshPath,
                                                         string expectedMaterialPath,
                                                         string expectedShaderName)
        {
            Require(PrefabUtility.GetNearestPrefabInstanceRoot(instance.gameObject)
                    == instance.gameObject,
                    instance.name + " must remain a prefab-instance root.");
            string prefabPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                instance.gameObject).Replace('\\', '/');
            Require(prefabPath == expectedPrefabPath,
                    instance.name + " uses an unexpected prefab asset: " + prefabPath + ".");

            MeshFilter[] filters = instance.GetComponentsInChildren<MeshFilter>(true);
            Require(filters.Length > 0, instance.name + " has no saved mesh asset.");
            bool expectedMeshFound = false;
            for (int i = 0; i < filters.Length; i++)
            {
                Mesh mesh = filters[i] != null ? filters[i].sharedMesh : null;
                if (mesh == null) continue;
                string meshPath = AssetDatabase.GetAssetPath(mesh).Replace('\\', '/');
                if (meshPath == expectedMeshPath) expectedMeshFound = true;
            }
            Require(expectedMeshFound,
                    instance.name + " is not linked to its saved project mesh.");

            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            Require(renderers.Length > 0, instance.name + " has no renderer.");
            bool expectedMaterialFound = false;
            Bounds bounds = renderers[0].bounds;
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (i > 0) bounds.Encapsulate(renderer.bounds);
                Material[] materials = renderer.sharedMaterials;
                for (int m = 0; m < materials.Length; m++)
                {
                    Material material = materials[m];
                    if (material == null) continue;
                    string materialPath = AssetDatabase.GetAssetPath(material).Replace('\\', '/');
                    if (materialPath != expectedMaterialPath) continue;
                    expectedMaterialFound = material.shader != null
                        && material.shader.name == expectedShaderName
                        && material.shader.name.StartsWith(
                            "Universal Render Pipeline/", StringComparison.Ordinal);
                }
            }
            Require(expectedMaterialFound,
                    instance.name + " does not use its saved custom URP material/shader.");
            return bounds;
        }

        private static void ValidateHorizonOutsideSelection(Transform horizon,
                                                            Bounds selectionBounds)
        {
            MeshFilter[] filters = horizon.GetComponentsInChildren<MeshFilter>(true);
            const float inset = 0.05f;
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                if (mesh == null) continue;
                Vector3[] vertices = mesh.vertices;
                for (int v = 0; v < vertices.Length; v++)
                {
                    Vector3 world = filter.transform.TransformPoint(vertices[v]);
                    bool insideX = world.x > selectionBounds.min.x + inset
                        && world.x < selectionBounds.max.x - inset;
                    bool insideZ = world.z > selectionBounds.min.z + inset
                        && world.z < selectionBounds.max.z - inset;
                    Require(!insideX || !insideZ,
                            "Horizon terrain intrudes into the playable 90x90 map.");
                }
            }
        }

        private static void ValidateFogOutsideSelection(Transform fog, float innerExtent)
        {
            MeshFilter[] filters = fog.GetComponentsInChildren<MeshFilter>(true);
            int vertexCount = 0;
            int triangleCount = 0;
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                if (mesh == null) continue;
                Vector3[] vertices = mesh.vertices;
                vertexCount += vertices.Length;
                triangleCount += mesh.triangles.Length / 3;
                for (int v = 0; v < vertices.Length; v++)
                {
                    Vector3 world = filter.transform.TransformPoint(vertices[v]);
                    Require(Mathf.Abs(world.x) >= innerExtent - 0.05f
                            || Mathf.Abs(world.z) >= innerExtent - 0.05f,
                            "Toxic fog intrudes beyond its authored soft perimeter overlap.");
                }
            }
            Require(vertexCount >= 2000 && vertexCount <= 3200
                    && triangleCount >= 1000 && triangleCount <= 1600,
                    "Toxic fog mesh complexity changed unexpectedly: vertices="
                    + vertexCount + ", triangles=" + triangleCount + ".");
            // Эпоха песчаной бури: у границы один меш-рендерер (стена,
            // может быть выключена) плюс системы частиц — все без теней.
            Renderer[] renderers = fog.GetComponentsInChildren<Renderer>(true);
            int meshRenderers = 0;
            for (int i = 0; i < renderers.Length; i++)
            {
                Require(renderers[i].shadowCastingMode ==
                        UnityEngine.Rendering.ShadowCastingMode.Off
                        && !renderers[i].receiveShadows,
                        "Boundary renderers must stay non-shadowing.");
                if (renderers[i] is MeshRenderer) meshRenderers++;
            }
            Require(meshRenderers >= 1 && meshRenderers <= 2,
                    "Boundary must keep the wall mesh and at most a border line.");
        }

        /// <summary>
        /// Высота поверхности земли в мировой точке: авторская база плюс
        /// запечённое поле рельефа (без ассета рельефа карта плоская).
        /// </summary>
        private static float SurfaceY(RoaGlobalMapRelief relief, float worldX,
                                      float worldZ)
        {
            float groundY = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY;
            if (relief == null || !relief.Ready) return groundY;
            float px = worldX * 10f + relief.WidthPoints * 0.5f;
            float py = relief.HeightPoints * 0.5f - worldZ * 10f;
            return groundY + relief.HeightAt(px, py);
        }

        private static float ValidateVisibleGround(Transform staticContentRoot)
        {
            Transform ground = staticContentRoot.Find("Ground");
            Require(ground != null, "Authored Ground layer is missing.");
            RoaGlobalMapRelief relief = Resources.Load<RoaGlobalMapRelief>(
                RoaGlobalMapRelief.ResourceKey);
            MeshFilter[] filters = ground.GetComponentsInChildren<MeshFilter>(true);
            float worstDeviation = 0f;
            int samples = 0;
            for (int i = 0; i < filters.Length; i++)
            {
                MeshFilter filter = filters[i];
                Mesh mesh = filter != null ? filter.sharedMesh : null;
                if (mesh == null) continue;
                Vector3[] vertices = mesh.vertices;
                for (int vertex = 0; vertex < vertices.Length; vertex++)
                {
                    Vector3 world = filter.transform.TransformPoint(vertices[vertex]);
                    float expected = SurfaceY(relief, world.x, world.z);
                    worstDeviation = Mathf.Max(worstDeviation,
                        Mathf.Abs(world.y - expected));
                    samples++;
                }
            }
            // Земля обязана совпадать с запечённым полем рельефа: допуск —
            // шаг сетки поля против сетки тайла (билинейная интерполяция).
            Require(samples > 0 && worstDeviation <= 0.05f,
                    "Visible global-map ground diverges from the baked relief field by "
                    + worstDeviation + " metres.");
            return RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY;
        }

        private static int ValidateGroundedRoots(Transform layer, float groundY)
        {
            Require(layer != null, "Grounded environment layer is missing.");
            RoaGlobalMapRelief relief = Resources.Load<RoaGlobalMapRelief>(
                RoaGlobalMapRelief.ResourceKey);
            int count = 0;
            for (int i = 0; i < layer.childCount; i++)
            {
                Transform child = layer.GetChild(i);
                Renderer[] renderers = child.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0) continue;
                Bounds bounds = renderers[0].bounds;
                for (int renderer = 1; renderer < renderers.Length; renderer++)
                    bounds.Encapsulate(renderers[renderer].bounds);
                // На рельефе низ и верх сравниваются с высотой поверхности в
                // центре объекта; наклон внутри широких пятен даёт допуск.
                float surfaceY = SurfaceY(relief, bounds.center.x, bounds.center.z);
                float slopeSlack = Mathf.Max(bounds.size.x, bounds.size.z) * 0.12f;
                bool thinGroundPatch = bounds.size.y < 0.12f;
                if (thinGroundPatch)
                    Require(bounds.min.y <= surfaceY + 0.03f + slopeSlack,
                            child.name + " thin ground patch floats above visible ground.");
                else
                    Require(bounds.min.y <= surfaceY - 0.01f + slopeSlack,
                            child.name + " floats above the visible ground by "
                            + (bounds.min.y - surfaceY) + " metres.");
                Require(bounds.max.y >= surfaceY - 0.05f - slopeSlack,
                        child.name + " is completely buried below the visible ground.");
                count++;
            }
            return count;
        }

        private static void ValidateDisabledColliders(Transform root, string message)
        {
            Collider[] colliders = root.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++)
                Require(!colliders[i].enabled, message);
        }

        private static bool RequiresMep(RoaGlobalMapPrefabKind kind)
        {
            return kind == RoaGlobalMapPrefabKind.Site
                   || kind == RoaGlobalMapPrefabKind.Party
                   || kind == RoaGlobalMapPrefabKind.ActivityCaravan
                   || kind == RoaGlobalMapPrefabKind.ActivityDistress
                   || kind == RoaGlobalMapPrefabKind.ActivityRecon
                   || kind == RoaGlobalMapPrefabKind.ActivityResource
                   || kind == RoaGlobalMapPrefabKind.ActivityDefense
                   || kind == RoaGlobalMapPrefabKind.ActivityAssault;
        }

        private static RoaUnityGlobalMapScene FindMarker(Scene scene)
        {
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                RoaUnityGlobalMapScene marker = root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }

        private static int CountPrefabInstances(Scene scene)
        {
            var roots = new HashSet<GameObject>();
            foreach (GameObject root in scene.GetRootGameObjects())
            foreach (Transform transform in root.GetComponentsInChildren<Transform>(true))
            {
                GameObject nearest = PrefabUtility.GetNearestPrefabInstanceRoot(transform.gameObject);
                if (nearest != null) roots.Add(nearest);
            }
            return roots.Count;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
