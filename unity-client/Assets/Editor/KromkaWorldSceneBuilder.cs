using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Creates the first editable Kromka world from the one-shot seed. After this
    /// pass, designers move scene objects in Unity and export their transforms;
    /// the server JSON is never the spatial editor.
    /// </summary>
    public static class KromkaWorldSceneBuilder
    {
        private const string GlobalScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string LocationSceneRoot = "Assets/Scenes/Kromka/Locations";
        private const string MaterialRoot = "Assets/Art/Kromka/Materials";
        private const string MeshRoot = "Assets/Art/Kromka/Meshes";
        private const float MapScale = 0.1f;
        private static readonly Vector2 MapCenter = new Vector2(190f, 150f);

        private static readonly Dictionary<string, Color> RegionColors =
            new Dictionary<string, Color>(StringComparer.Ordinal)
            {
                { "northern_sluices", new Color(0.17f, 0.24f, 0.23f) },
                { "middle_vein", new Color(0.22f, 0.27f, 0.16f) },
                { "ore_arc", new Color(0.31f, 0.17f, 0.11f) },
                { "tract_isthmus", new Color(0.29f, 0.23f, 0.14f) },
                { "chalk_lowland", new Color(0.48f, 0.45f, 0.33f) },
                { "glasslands", new Color(0.13f, 0.24f, 0.23f) },
                { "zero_basin", new Color(0.07f, 0.09f, 0.10f) },
                { "silent_ring", new Color(0.06f, 0.08f, 0.07f) },
                { "off_map", new Color(0.22f, 0.20f, 0.16f) },
                { "regional", new Color(0.27f, 0.22f, 0.14f) }
            };

        [MenuItem("Кромка/Авторинг/Создать мир kromka-1")]
        public static void BuildAll()
        {
            BuildAllInternal(false);
        }

        [MenuItem("Кромка/Авторинг/Пересобрать только глобальную карту")]
        public static void RebuildGlobalMapFromSeed()
        {
            RefuseDirtyOpenScenes();
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            JObject seed = ReadProjectJson("data/kromka/world-layout.seed.json");
            EnsureFolders();
            BuildGlobal(catalog, seed);
            ConfigureBuildSettings(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] PASS: глобальная карта пересобрана по канонической схеме.");
        }

        [MenuItem("Кромка/Авторинг/ПЕРЕСОБРАТЬ мир из исходного seed")]
        public static void RebuildAllFromSeed()
        {
            if (!EditorUtility.DisplayDialog("Пересобрать мир Кромки?",
                    "Все 46 Unity-сцен Кромки будут созданы заново. Ручные правки в этих сценах будут потеряны.",
                    "Пересобрать", "Отмена"))
                return;
            BuildAllInternal(true);
        }

        [MenuItem("Кромка/Авторинг/Восстановить связи глобальной карты")]
        public static void RepairGlobalBindings()
        {
            RefuseDirtyOpenScenes();
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            JObject seed = ReadProjectJson("data/kromka/world-layout.seed.json");
            Scene scene = EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
            KromkaWorldAuthoring world = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaWorldAuthoring>(true))
                .Single();
            var catalogById = ((JArray)catalog["locations"]).OfType<JObject>()
                .ToDictionary(row => Text(row, "id"), StringComparer.Ordinal);
            int repaired = 0;

            foreach (JObject position in (JArray)seed["locations"])
            {
                string id = Text(position, "id");
                Transform marker = FindDirectChild(world.LocationRoot, "Location_" + id);
                if (marker == null)
                    throw new InvalidOperationException("Нет маркера Location_" + id);

                KromkaWorldLocationAuthoring binding = marker.GetComponent<KromkaWorldLocationAuthoring>();
                RoaGlobalMapNodeAnchor runtime = marker.GetComponent<RoaGlobalMapNodeAnchor>();
                if (binding == null || runtime == null)
                {
                    repaired += GameObjectUtility.RemoveMonoBehavioursWithMissingScript(marker.gameObject);
                    binding = marker.GetComponent<KromkaWorldLocationAuthoring>();
                    runtime = marker.GetComponent<RoaGlobalMapNodeAnchor>();
                }

                JObject location = catalogById[id];
                if (binding == null)
                {
                    binding = marker.gameObject.AddComponent<KromkaWorldLocationAuthoring>();
                    repaired++;
                }
                binding.Configure(id, ParseRegion(Text(location, "macroRegion")),
                    Text(location, "unityScene"), DangerFor(seed, Text(location, "macroRegion")), 2f);
                if (runtime == null)
                {
                    runtime = marker.gameObject.AddComponent<RoaGlobalMapNodeAnchor>();
                    repaired++;
                }
                runtime.Configure(id);
                EditorUtility.SetDirty(marker.gameObject);
            }

            EditorSceneManager.SaveScene(scene);
            Debug.Log("[KROMKA] PASS: восстановлены связи глобальной карты: " + repaired
                + "; позиции и геометрия не изменены.");
        }

        [MenuItem("Кромка/Авторинг/ПЕРЕСОБРАТЬ сцены kromka-1 (проверенная миграция)")]
        public static void RebuildGeneratedScenesForMigration()
        {
            RefuseDirtyOpenScenes();
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            RequireGeneratedScene(GlobalScenePath, "m_Name: KromkaGlobalMap_kromka-1");
            foreach (JObject location in (JArray)catalog["locations"])
            {
                string id = Text(location, "id");
                RequireGeneratedScene(KromkaLocationSceneCatalog.ScenePath(id),
                    "m_Name: KromkaLocation_" + id);
            }
            BuildAllInternal(true);
        }

        private static void BuildAllInternal(bool overwriteExisting)
        {
            RefuseDirtyOpenScenes();
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            JObject seed = ReadProjectJson("data/kromka/world-layout.seed.json");
            EnsureFolders();
            int built = 0;
            if (overwriteExisting || !SceneAssetExists(GlobalScenePath))
            {
                BuildGlobal(catalog, seed);
                built++;
            }
            built += BuildLocations(catalog, overwriteExisting);
            ConfigureBuildSettings(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] Мир kromka-1: создано " + built
                + " сцен; существующие ручные сцены "
                + (overwriteExisting ? "пересобраны." : "сохранены без изменений."));
        }

        private static void BuildGlobal(JObject catalog, JObject seed)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            GameObject root = new GameObject("KromkaGlobalMap_kromka-1");
            KromkaWorldAuthoring authoring = root.AddComponent<KromkaWorldAuthoring>();
            RoaUnityGlobalMapScene runtime = root.AddComponent<RoaUnityGlobalMapScene>();

            Transform terrain = Child(root.transform, "Terrain_EDITABLE");
            Transform regions = Child(root.transform, "Regions_EDITABLE");
            Transform routes = Child(root.transform, "Routes_EDITABLE");
            Transform locations = Child(root.transform, "Locations_EDITABLE");
            Transform staticContent = Child(root.transform, "StaticContent");
            Transform dynamicContent = Child(root.transform, "DynamicContent_SERVER_STATE");
            Transform handles = Child(root.transform, "RuntimeHandles");

            GameObject ground = Primitive("SelectionSurface_EDITABLE_BOUNDS", PrimitiveType.Cube,
                terrain, Vector3.zero, new Vector3(38f, 0.2f, 30f),
                MaterialFor("Kromka_GlobalGround", new Color(0.19f, 0.20f, 0.16f)));
            ground.transform.localPosition = new Vector3(0f, -0.18f, 0f);
            BoxCollider selection = ground.GetComponent<BoxCollider>();
            Renderer selectionRenderer = ground.GetComponent<Renderer>();
            if (selectionRenderer != null) selectionRenderer.enabled = false;

            foreach (JObject row in (JArray)seed["regions"])
            {
                string id = Text(row, "id");
                Transform regionRoot = Child(regions, "Region_" + id);
                var region = regionRoot.gameObject.AddComponent<KromkaRegionAuthoring>();
                Vector2 center = Pair(row["center"] as JArray);
                regionRoot.localPosition = PointToWorld(center.x, center.y, 0f);

                Transform boundary = Child(regionRoot, "Boundary_EDITABLE");
                JArray authoredBoundary = row["unityBoundary"] as JArray
                    ?? throw new InvalidOperationException(id + ": нет unityBoundary.");
                Transform[] points = new Transform[authoredBoundary.Count];
                for (int i = 0; i < authoredBoundary.Count; i++)
                {
                    Vector2 mapPoint = Pair(authoredBoundary[i] as JArray);
                    points[i] = Child(boundary, "BoundaryPoint_" + (i + 1));
                    Vector3 worldPoint = PointToWorld(mapPoint.x, mapPoint.y, 0f);
                    points[i].localPosition = regionRoot.InverseTransformPoint(worldPoint);
                }
                region.Configure(ParseRegion(id), Text(row, "displayName"),
                    Text(row, "visualProfile"), points, Int(row, "dangerBand"));

            }

            KromkaGlobalMapSceneComposer.Compose(staticContent);
            BuildMapMarkerMeshes();
            foreach (JObject routeRow in (JArray)seed["routes"])
                BuildRoute(routeRow, routes);

            var catalogById = ((JArray)catalog["locations"])
                .OfType<JObject>().ToDictionary(row => Text(row, "id"), StringComparer.Ordinal);
            foreach (JObject position in (JArray)seed["locations"])
            {
                string id = Text(position, "id");
                JObject location = catalogById[id];
                GameObject marker = new GameObject("Location_" + id);
                marker.transform.SetParent(locations, false);
                marker.transform.localPosition = PointToWorld(Float(position, "x"), Float(position, "z"), 0.08f);
                var worldMarker = marker.AddComponent<KromkaWorldLocationAuthoring>();
                worldMarker.Configure(id, ParseRegion(Text(location, "macroRegion")),
                    Text(location, "unityScene"), DangerFor(seed, Text(location, "macroRegion")), 2f);
                marker.AddComponent<RoaGlobalMapNodeAnchor>().Configure(id);
                BuildMapLandmark(marker.transform, location);
            }

            Transform cameraAnchor = Child(handles, "CameraAnchor");
            cameraAnchor.localPosition = new Vector3(0f,
                RoaGlobalMap.StrategicMinimumCameraAnchorY, -18f);
            cameraAnchor.localRotation = Quaternion.Euler(58f, 0f, 0f);
            GameObject playerMarker = PrefabInstance("Assets/Prefabs/GlobalMap/GM_PlayerMarker.prefab",
                handles, "PlayerMarker");
            GameObject selectionMarker = PrefabInstance("Assets/Prefabs/GlobalMap/GM_SelectionMarker.prefab",
                handles, "SelectionMarker");
            playerMarker.SetActive(false);
            selectionMarker.SetActive(false);

            var slots = Enum.GetValues(typeof(RoaGlobalMapPrefabKind))
                .Cast<RoaGlobalMapPrefabKind>()
                .Select(kind => new RoaGlobalMapPrefabSlot(kind,
                    AssetDatabase.LoadAssetAtPath<GameObject>(LivePrefabPath(kind))))
                .ToArray();
            runtime.Configure(staticContent, dynamicContent, selection, playerMarker,
                selectionMarker, cameraAnchor, slots);
            authoring.Configure("kromka-1", 380f, 300f, terrain, regions, routes, locations);

            AddSun(root.transform, 1.12f, new Color(0.96f, 0.92f, 0.84f));
            ConfigureAtmosphere("global", new Color(0.19f, 0.20f, 0.16f));
            EditorSceneManager.SaveScene(scene, GlobalScenePath);
        }

        private static Transform FindDirectChild(Transform parent, string name)
        {
            if (parent == null) return null;
            for (int i = 0; i < parent.childCount; i++)
            {
                Transform child = parent.GetChild(i);
                if (child.name == name) return child;
            }
            return null;
        }

        internal static int BuildLocations(JObject catalog, bool overwriteExisting)
        {
            int built = 0;
            foreach (JObject location in (JArray)catalog["locations"])
            {
                string id = Text(location, "id");
                string scenePath = KromkaLocationSceneCatalog.ScenePath(id);
                if (!overwriteExisting && SceneAssetExists(scenePath)) continue;
                Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                GameObject root = new GameObject("KromkaLocation_" + id);
                var authoring = root.AddComponent<KromkaLocationAuthoring>();
                var runtime = root.AddComponent<RoaUnityLocationScene>();
                Transform staticContent = Child(root.transform, "StaticContent_EDITABLE");
                Transform importedContent = Child(staticContent, "GameplayObjects_EDITABLE");
                Transform dynamicAnchors = Child(root.transform, "DynamicAnchors_EDITABLE");
                Transform arrival = Child(dynamicAnchors, "PlayerArrival");
                Transform migration = Child(dynamicAnchors, "MigrationArrival_SAFE");
                arrival.localPosition = new Vector3(0f, 0.1f, -18f);
                migration.localPosition = new Vector3(-4f, 0.1f, -19f);
                arrival.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                    id + "-arrival", KromkaSpawnKind.PlayerArrival, string.Empty, 2f);
                migration.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                    Text(location, "migrationSpawnId"), KromkaSpawnKind.MigrationArrival,
                    string.Empty, 3f);
                BuildServerSpawnAnchors(dynamicAnchors, id);

                string regionId = Text(location, "macroRegion");
                Color regionColor = RegionColor(regionId);
                // Размер сцены берётся из авторского определения: большие сцены
                // (Сердцевина) объявляют map.width/depth в метрах.
                JObject sizedDefinition = ReadProjectJson("data/locations/" + id + ".json");
                float mapWidth = sizedDefinition?["map"]?["width"]?.Value<float>() ?? 76f;
                float mapDepth = sizedDefinition?["map"]?["depth"]?.Value<float>() ?? 76f;
                if (sizedDefinition?["spawn"] is JObject authoredSpawn)
                {
                    // Высота прибытия фиксирована: экспортированный spawn уже несёт y,
                    // и прибавка сверху сдвигала бы точку на 0,1 м при каждой пересборке.
                    Vector3 authoredPoint = PointFromTile(authoredSpawn, sizedDefinition, arrival.localPosition);
                    arrival.localPosition = new Vector3(authoredPoint.x, 0.1f, authoredPoint.z);
                }
                GameObject ground = Primitive("Ground_EDITABLE", PrimitiveType.Cube, staticContent,
                    new Vector3(0f, -0.3f, 0f), new Vector3(mapWidth, 0.5f, mapDepth),
                    MaterialFor("Kromka_Local_" + regionId, regionColor));
                ground.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                    id + "-ground", "ground", "terrain", new[] { regionId }, false, false, false);

                if (id == "tutorialCaravanYard")
                {
                    arrival.localPosition = migration.localPosition = new Vector3(0f, .1f, -26f);
                    RealmOfAshes.EditorTools.RoaTutorialYardAuthoring.ComposeGameplay(staticContent);
                }
                else
                {
                    BuildLocationLandmark(staticContent, location, regionColor);
                    BuildLocationModules(staticContent, id, Text(location, "locationType"), regionColor);
                    KromkaLocationSceneComposer.Compose(staticContent, location);
                    KromkaLocationDressing.Compose(staticContent, id,
                        Text(location, "locationType"), regionId, location["territory"] != null);
                }
                BuildImportedGameplayObjects(importedContent, id);
                BuildAnomalyFields(dynamicAnchors, location);
                AddSun(root.transform, 1.25f, Color.Lerp(Color.white, regionColor, 0.18f));

                authoring.ConfigureIdentity(id, Text(location, "displayName"),
                    ParseLocationKind(Text(location, "locationType")), ParseRegion(regionId));
                authoring.ConfigurePresentation(Text(location, "visualProfile"),
                    Text(location, "ambientProfile"), Float(location, "anomalyDensity"),
                    ((JArray)location["landmarkTags"]).Values<string>().ToArray());
                authoring.ConfigureRoots(staticContent, dynamicAnchors, arrival, migration);
                runtime.Configure(id, null, ground.GetComponent<Renderer>(), true);
                ConfigureAtmosphere(regionId, regionColor);

                EditorSceneManager.SaveScene(scene, scenePath);
                KromkaWorldSceneExporter.ExportLocationScene(scene);
                built++;
            }
            return built;
        }

        private static void BuildLocationLandmark(Transform parent, JObject location, Color baseColor)
        {
            string id = Text(location, "id");
            string tag = ((JArray)location["landmarkTags"]).Values<string>().FirstOrDefault() ?? "marker";
            Transform root = Child(parent, "Landmark_" + tag + "_EDITABLE");
            root.gameObject.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                id + "-landmark", tag, "landmark", new[] { tag }, false, true, true);
            Bridge(root.gameObject, id + "-landmark");
            Color accent = Color.Lerp(baseColor, new Color(0.25f, 0.62f, 0.66f), 0.35f);

            if (tag.Contains("tower") || tag.Contains("mast") || tag.Contains("furnace"))
            {
                Primitive("Shaft", PrimitiveType.Cylinder, root, new Vector3(0f, 6f, 0f),
                    new Vector3(3.5f, 6f, 3.5f), MaterialFor("Kromka_IndustrialDark", new Color(0.20f, 0.18f, 0.15f)));
                Primitive("Crown", PrimitiveType.Cube, root, new Vector3(0f, 12f, 0f),
                    new Vector3(8f, 2f, 8f), MaterialFor("Kromka_Accent", accent));
            }
            else if (tag.Contains("dish") || tag.Contains("array") || tag.Contains("solar"))
            {
                GameObject dish = Primitive("Dish", PrimitiveType.Cylinder, root,
                    new Vector3(0f, 5f, 0f), new Vector3(8f, 0.5f, 8f),
                    MaterialFor("Kromka_Accent", accent));
                dish.transform.localRotation = Quaternion.Euler(22f, 0f, 12f);
                Primitive("Support", PrimitiveType.Cylinder, root, new Vector3(0f, 2.2f, 0f),
                    new Vector3(1f, 2.2f, 1f), MaterialFor("Kromka_IndustrialDark", new Color(0.20f, 0.18f, 0.15f)));
            }
            else
            {
                Primitive("FrameA", PrimitiveType.Cube, root, new Vector3(-4f, 3f, 0f),
                    new Vector3(2f, 6f, 12f), MaterialFor("Kromka_IndustrialDark", new Color(0.20f, 0.18f, 0.15f)));
                Primitive("FrameB", PrimitiveType.Cube, root, new Vector3(4f, 3f, 0f),
                    new Vector3(2f, 6f, 12f), MaterialFor("Kromka_IndustrialDark", new Color(0.20f, 0.18f, 0.15f)));
                Primitive("Signal", PrimitiveType.Cube, root, new Vector3(0f, 7f, 0f),
                    new Vector3(10f, 1f, 2f), MaterialFor("Kromka_Accent", accent));
            }
        }

        private static void BuildLocationModules(Transform parent, string id, string type, Color color)
        {
            bool inhabited = type.Contains("settlement") || type.Contains("capital")
                || type.Contains("hub") || type.Contains("outpost") || type.Contains("base");
            int count = inhabited ? 10 : 5;
            for (int i = 0; i < count; i++)
            {
                float angle = i * Mathf.PI * 2f / count;
                float radius = inhabited ? 22f : 15f;
                Vector3 position = new Vector3(Mathf.Cos(angle) * radius, 1.4f,
                    Mathf.Sin(angle) * radius);
                GameObject module = Primitive("Module_" + (i + 1).ToString("00"),
                    i % 4 == 0 ? PrimitiveType.Cylinder : PrimitiveType.Cube, parent,
                    position, i % 4 == 0 ? new Vector3(2.5f, 1.4f, 2.5f)
                        : new Vector3(7f, 2.8f, 5f),
                    MaterialFor("Kromka_Module_" + id, Color.Lerp(color, Color.gray, 0.52f)));
                module.transform.localRotation = Quaternion.Euler(0f, -angle * Mathf.Rad2Deg + 90f, 0f);
                module.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                    id + "-module-" + (i + 1), "industrial_module", "structure",
                    new[] { type, "modular" }, false, true, true);
                Bridge(module, id + "-module-" + (i + 1));
            }
        }

        /// <summary>
        /// Дописывает в уже собранную сцену маркеры перечисленных строк
        /// data/locations/&lt;id&gt;.json, не трогая остальное содержимое.
        /// Возвращает число добавленных маркеров.
        /// </summary>
        internal static int ImportGameplayObjects(Scene scene, string locationId, ICollection<string> objectIds)
        {
            KromkaLocationAuthoring authoring = scene.GetRootGameObjects()
                .Select(root => root.GetComponentInChildren<KromkaLocationAuthoring>(true))
                .FirstOrDefault(component => component != null);
            Transform parent = authoring != null
                ? authoring.transform.Find("StaticContent_EDITABLE/GameplayObjects_EDITABLE")
                : null;
            if (parent == null)
                throw new InvalidOperationException("В сцене " + locationId + " нет StaticContent_EDITABLE/GameplayObjects_EDITABLE.");
            int before = parent.childCount;
            BuildImportedGameplayObjects(parent, locationId, objectIds);
            if (parent.childCount != before) EditorSceneManager.MarkSceneDirty(scene);
            return parent.childCount - before;
        }

        private static void BuildImportedGameplayObjects(Transform parent, string locationId,
            ICollection<string> onlyIds = null)
        {
            JObject definition = ReadProjectJson("data/locations/" + locationId + ".json");
            if (!(definition?["objects"] is JArray objects)) return;
            var existingIds = new HashSet<string>(parent.root
                .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                .Where(marker => marker != null && !string.IsNullOrWhiteSpace(marker.StableObjectId))
                .Select(marker => marker.StableObjectId), StringComparer.Ordinal);

            foreach (JObject row in objects.OfType<JObject>())
            {
                string id = Text(row, "id");
                if (string.IsNullOrWhiteSpace(id) || IsLiveObject(row)
                    || (onlyIds != null && !onlyIds.Contains(id))
                    || Text(row, "role") == "anomaly" || existingIds.Contains(id)
                    || IsRetiredLegacyVisual(row)
                    || !KeepLegacyGameplayObject(row))
                    continue;

                GameObject instance = TryInstantiateLocationPrefab(row, parent, id);
                if (instance == null)
                {
                    Vector2 footprint = PairFromObject(row["footprint"] as JObject, 1.6f);
                    float height = Mathf.Max(0.5f, Float(row["scale"] as JObject, "y", 1f));
                    instance = Primitive(id, PrimitiveType.Cube, parent, Vector3.zero,
                        new Vector3(footprint.x, height, footprint.y),
                        MaterialFor("Kromka_GameplayProxy", new Color(0.28f, 0.27f, 0.23f)));
                }

                instance.name = "Gameplay_" + id;
                instance.transform.localPosition = Vector3From(row["position"] as JObject, Vector3.zero);
                JObject rotation = row["rotation"] as JObject;
                instance.transform.localRotation = Quaternion.Euler(
                    Float(rotation, "x", 0f) * Mathf.Rad2Deg,
                    Float(rotation, "y", 0f) * Mathf.Rad2Deg,
                    Float(rotation, "z", 0f) * Mathf.Rad2Deg);
                JObject scale = row["scale"] as JObject;
                if (scale != null)
                    instance.transform.localScale = Vector3From(scale, Vector3.one);

                string[] tags = row["tags"] is JArray tagRows
                    ? tagRows.Values<string>().Where(value => !string.IsNullOrWhiteSpace(value)).ToArray()
                    : Array.Empty<string>();
                bool blocksMovement = !string.Equals(Text(row, "collision"), "none", StringComparison.OrdinalIgnoreCase);
                // Старые строки пишут vision.mode ("cover", "none"), а не vision.blocks.
                // Если читать только blocks, укрытие молча становится стеной через
                // запасной blocksMovement — так при переносе в Кромку (33a20ffd)
                // бочки, верстаки, лом и грядки стали перекрывать обзор.
                RoaAuthoredVision.Kind vision = RoaAuthoredVision.FromConfig(row["vision"] as JObject);
                bool blocksVision = vision == RoaAuthoredVision.Kind.Unknown
                    ? blocksMovement
                    : vision == RoaAuthoredVision.Kind.Block;
                bool lowCover = vision == RoaAuthoredVision.Kind.Cover;
                string role = Text(row, "role");
                if (string.IsNullOrWhiteSpace(role) && row["entity"]?["kind"] != null)
                    role = row["entity"]["kind"].Value<string>();
                instance.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                    id, Text(row, "model"), role, tags, true, blocksMovement, blocksVision, lowCover);
                Bridge(instance, id);
                existingIds.Add(id);
            }
        }

        private static void BuildServerSpawnAnchors(Transform parent, string locationId)
        {
            JObject definition = ReadProjectJson("data/locations/" + locationId + ".json");
            if (!(definition?["objects"] is JArray objects)) return;
            Transform root = Child(parent, "ServerActors_EDITABLE");
            foreach (JObject row in objects.OfType<JObject>().Where(IsLiveObject))
            {
                string id = Text(row, "id");
                if (string.IsNullOrWhiteSpace(id)) continue;
                Transform anchor = Child(root, "ActorSpawn_" + id);
                anchor.localPosition = Vector3From(row["position"] as JObject, Vector3.zero);
                JObject rotation = row["rotation"] as JObject;
                anchor.localRotation = Quaternion.Euler(
                    Float(rotation, "x", 0f) * Mathf.Rad2Deg,
                    Float(rotation, "y", 0f) * Mathf.Rad2Deg,
                    Float(rotation, "z", 0f) * Mathf.Rad2Deg);
                string kind = row["entity"]?["kind"]?.Value<string>() ?? string.Empty;
                bool hostile = row["entity"]?["hostileToPlayer"]?.Value<bool>() == true
                    || (row["tags"] is JArray tags && tags.Values<string>().Any(tag => tag == "hostile"));
                KromkaSpawnKind spawnKind = hostile || kind == "enemy" || kind == "creature"
                    ? KromkaSpawnKind.Enemy : KromkaSpawnKind.Npc;
                anchor.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                    id, spawnKind, string.Empty, 0.8f);
            }

            if (definition?["exit"] is JObject exit)
            {
                Transform anchor = Child(parent, "Exit_" + Text(exit, "to") + "_EDITABLE");
                anchor.localPosition = PointFromTile(exit, definition, new Vector3(0f, 0f, -34f));
                anchor.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                    "primary-exit", KromkaSpawnKind.Exit, Text(exit, "to"), 3f);
            }
        }

        private static Vector3 PointFromTile(JObject point, JObject definition, Vector3 fallback)
        {
            if (point == null) return fallback;
            if (point["x"] != null && point["z"] != null) return Vector3From(point, fallback);
            int width = definition?["map"]?["width"]?.Value<int>() ?? 76;
            int depth = definition?["map"]?["depth"]?.Value<int>() ?? 76;
            float x = (Float(point, "tx", width / 4f) + 0.5f) * 2f - width * 0.5f;
            float z = (Float(point, "tz", 1f) + 0.5f) * 2f - depth * 0.5f;
            return new Vector3(x, 0f, z);
        }

        private static bool IsLiveObject(JObject row)
        {
            string kind = row?["entity"]?["kind"]?.Value<string>() ?? string.Empty;
            if (kind == "npc" || kind == "enemy" || kind == "creature" || kind == "player")
                return true;
            if (!(row?["tags"] is JArray tags)) return false;
            return tags.Values<string>().Any(tag => tag == "npc" || tag == "living"
                || tag == "hostile" || tag == "mutant");
        }

        private static bool KeepLegacyGameplayObject(JObject row)
        {
            if (!string.IsNullOrWhiteSpace(Text(row, "url"))) return true;
            if (row?["container"] != null || row?["entity"] != null) return true;
            if (!string.IsNullOrWhiteSpace(Text(row, "role"))) return true;
            if (!(row?["tags"] is JArray tags)) return false;
            string[] gameplay =
            {
                "cover", "storage", "craft", "resource", "harvest", "terminal",
                "door", "quest", "work", "bed", "campfire", "trade"
            };
            return tags.Values<string>().Any(tag => gameplay.Any(token =>
                tag.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0));
        }

        private static bool IsRetiredLegacyVisual(JObject row)
        {
            string id = Text(row, "id");
            string model = Text(row, "model");
            return id.StartsWith("old_klim_", StringComparison.OrdinalIgnoreCase)
                || model.StartsWith("oldKlim", StringComparison.OrdinalIgnoreCase);
        }

        private static GameObject TryInstantiateLocationPrefab(JObject row, Transform parent, string id)
        {
            GameObject prefab = null;
            string url = Text(row, "url");
            if (!string.IsNullOrWhiteSpace(url))
            {
                string file = Path.GetFileNameWithoutExtension(url.Replace('\\', '/'));
                prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Models/wasteland/" + file + ".prefab")
                    ?? AssetDatabase.LoadAssetAtPath<GameObject>(KromkaLocalPrefabRecovery.PrefabRoot + file + ".prefab");
            }
            // Без url объект ищется среди восстановленных префабов окружения по ключу
            // модели: camelCase «concreteWall» → «concrete_wall.prefab». Иначе — куб-прокси,
            // и экспорт вернул бы габарит 1×1 вместо реального следа модели.
            if (prefab == null)
            {
                string key = RecoveredPrefabKey(Text(row, "model"));
                if (!string.IsNullOrEmpty(key))
                    prefab = AssetDatabase.LoadAssetAtPath<GameObject>(KromkaLocalPrefabRecovery.PrefabRoot + key + ".prefab");
            }
            if (prefab == null) return null;
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = id;
            instance.transform.SetParent(parent, false);
            return instance;
        }

        internal static string RecoveredPrefabKey(string model)
        {
            if (string.IsNullOrWhiteSpace(model)) return string.Empty;
            var key = new System.Text.StringBuilder(model.Length + 4);
            foreach (char symbol in model.Trim())
            {
                if (char.IsUpper(symbol))
                {
                    if (key.Length > 0) key.Append('_');
                    key.Append(char.ToLowerInvariant(symbol));
                }
                else key.Append(symbol);
            }
            return key.ToString();
        }

        private static void BuildAnomalyFields(Transform parent, JObject location)
        {
            if (!(location?["anomalyFields"] is JArray fields) || fields.Count == 0) return;
            Transform root = Child(parent, "AnomalyFields_EDITABLE");
            foreach (JObject field in fields.OfType<JObject>())
            {
                string id = Text(field, "id");
                string type = Text(field, "type");
                Transform marker = Child(root, "Anomaly_" + id);
                marker.localPosition = new Vector3(Float(field, "x"), 0.08f, Float(field, "z"));
                int dischargeMs = Int(field, "dischargeMs");
                if (dischargeMs <= 0) dischargeMs = AnomalyDischargeFor(type);
                marker.gameObject.AddComponent<KromkaAnomalyAuthoring>().Configure(
                    id, type, Mathf.Max(0.75f, Float(field, "radius")),
                    dischargeMs, field["training"]?.Value<bool>() == true);
                marker.gameObject.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                    id, type, "anomaly", new[] { "visible-hazard", "bolt-discharge" },
                    true, false, false);
                Bridge(marker.gameObject, id);
            }
        }

        internal static void BuildMapLandmark(Transform parent, JObject location)
        {
            string regionId = Text(location, "macroRegion");
            string type = Text(location, "locationType");
            string tag = location?["landmarkTags"] is JArray tags
                ? tags.Values<string>().FirstOrDefault() ?? string.Empty : string.Empty;
            Color color = Color.Lerp(RegionColor(regionId), Color.white, 0.18f);
            bool major = type == "faction_capital" || type == "caravan_hub"
                || type == "story_complex" || type == "raid_complex";
            // Location silhouettes must read as cartographic pins, not as
            // full-size buildings standing above the miniature landscape.
            float miniatureScale = major ? 0.72f : 0.56f;
            GameObject baseObject = MapMarkerObject("MapMiniature",
                MeshRoot + "/Kromka_MapMarker_Prism.asset", parent,
                new Vector3(0f, 0.055f, 0f),
                new Vector3(0.15f, 0.028f, 0.15f) * miniatureScale,
                MaterialForMap("Kromka_Map_" + regionId, color));
            Material accent = MaterialForMap("Kromka_MapAccent",
                new Color(0.20f, 0.30f, 0.27f));
            if (tag.Contains("bridge") || tag.Contains("conveyor") || tag.Contains("gate"))
            {
                MapMarkerObject("LandmarkSilhouette_" + tag,
                    MeshRoot + "/Kromka_MapMarker_Box.asset", parent,
                    new Vector3(0f, 0.12f, 0f),
                    new Vector3(0.25f, 0.055f, 0.075f) * miniatureScale, accent);
            }
            else if (tag.Contains("dish") || tag.Contains("solar") || tag.Contains("pool"))
            {
                GameObject dish = MapMarkerObject("LandmarkSilhouette_" + tag,
                    MeshRoot + "/Kromka_MapMarker_Prism.asset", parent,
                    new Vector3(0f, 0.13f, 0f),
                    new Vector3(0.12f, 0.020f, 0.12f) * miniatureScale, accent);
                dish.transform.localRotation = Quaternion.Euler(18f, 0f, 8f);
            }
            else if (tag.Contains("furnace") || tag.Contains("tower") || tag.Contains("mast")
                     || tag.Contains("shaft") || tag.Contains("column"))
            {
                MapMarkerObject("LandmarkSilhouette_" + tag,
                    MeshRoot + "/Kromka_MapMarker_Prism.asset", parent,
                    new Vector3(0f, major ? 0.18f : 0.14f, 0f),
                    (major ? new Vector3(0.075f, 0.20f, 0.075f)
                        : new Vector3(0.060f, 0.14f, 0.060f)) * miniatureScale,
                    accent);
            }
            else
            {
                MapMarkerObject("LandmarkSilhouette_" + tag,
                    MeshRoot + "/Kromka_MapMarker_Box.asset", parent,
                    new Vector3(0f, major ? 0.17f : 0.13f, 0f),
                    (major ? new Vector3(0.090f, 0.21f, 0.090f)
                        : new Vector3(0.068f, 0.14f, 0.068f)) * miniatureScale,
                    accent);
            }
            MapMarkerObject("LocationGlow",
                MeshRoot + "/Kromka_MapMarker_Beacon.asset", parent,
                new Vector3(0f, major ? 0.29f : 0.21f, 0f),
                Vector3.one * (major ? 0.026f : 0.019f),
                MaterialForEmissive("Kromka_MapLocationGlow",
                    new Color(0.64f, 0.43f, 0.18f)));
        }

        private static void BuildMapMarkerMeshes()
        {
            EnsureFolder(MeshRoot);
            SaveMapMarkerMesh(MeshRoot + "/Kromka_MapMarker_Box.asset",
                BuildMarkerBoxMesh());
            SaveMapMarkerMesh(MeshRoot + "/Kromka_MapMarker_Prism.asset",
                BuildMarkerPrismMesh(12));
            SaveMapMarkerMesh(MeshRoot + "/Kromka_MapMarker_Beacon.asset",
                BuildMarkerBeaconMesh());
        }

        private static GameObject MapMarkerObject(string name, string meshPath,
                                                  Transform parent, Vector3 position,
                                                  Vector3 scale, Material material)
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            if (mesh == null)
                throw new InvalidOperationException("Missing authored map-marker mesh: "
                    + meshPath);
            var result = new GameObject(name);
            result.transform.SetParent(parent, false);
            result.transform.localPosition = position;
            result.transform.localScale = scale;
            result.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = result.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            return result;
        }

        private static void SaveMapMarkerMesh(string path, Mesh mesh)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
                AssetDatabase.CreateAsset(mesh, path);
            else
            {
                EditorUtility.CopySerialized(mesh, existing);
                EditorUtility.SetDirty(existing);
                UnityEngine.Object.DestroyImmediate(mesh);
            }
        }

        private static Mesh BuildMarkerBoxMesh()
        {
            Vector3[] vertices =
            {
                new Vector3(-0.5f,-0.5f, 0.5f), new Vector3( 0.5f,-0.5f, 0.5f),
                new Vector3( 0.5f, 0.5f, 0.5f), new Vector3(-0.5f, 0.5f, 0.5f),
                new Vector3( 0.5f,-0.5f,-0.5f), new Vector3(-0.5f,-0.5f,-0.5f),
                new Vector3(-0.5f, 0.5f,-0.5f), new Vector3( 0.5f, 0.5f,-0.5f),
                new Vector3(-0.5f,-0.5f,-0.5f), new Vector3(-0.5f,-0.5f, 0.5f),
                new Vector3(-0.5f, 0.5f, 0.5f), new Vector3(-0.5f, 0.5f,-0.5f),
                new Vector3( 0.5f,-0.5f, 0.5f), new Vector3( 0.5f,-0.5f,-0.5f),
                new Vector3( 0.5f, 0.5f,-0.5f), new Vector3( 0.5f, 0.5f, 0.5f),
                new Vector3(-0.5f, 0.5f, 0.5f), new Vector3( 0.5f, 0.5f, 0.5f),
                new Vector3( 0.5f, 0.5f,-0.5f), new Vector3(-0.5f, 0.5f,-0.5f),
                new Vector3(-0.5f,-0.5f,-0.5f), new Vector3( 0.5f,-0.5f,-0.5f),
                new Vector3( 0.5f,-0.5f, 0.5f), new Vector3(-0.5f,-0.5f, 0.5f)
            };
            int[] triangles =
            {
                 0, 1, 2,  0, 2, 3,  4, 5, 6,  4, 6, 7,
                 8, 9,10,  8,10,11, 12,13,14, 12,14,15,
                16,17,18, 16,18,19, 20,21,22, 20,22,23
            };
            Vector2[] uv = new Vector2[24];
            Vector2[] faceUv =
            {
                new Vector2(0f,0f), new Vector2(1f,0f),
                new Vector2(1f,1f), new Vector2(0f,1f)
            };
            for (int face = 0; face < 6; face++)
                Array.Copy(faceUv, 0, uv, face * 4, 4);
            return FinishMarkerMesh("Kromka_MapMarker_Box", vertices, uv, triangles);
        }

        private static Mesh BuildMarkerPrismMesh(int sides)
        {
            var vertices = new List<Vector3>(sides * 4 + 2);
            var uv = new List<Vector2>(sides * 4 + 2);
            var triangles = new List<int>(sides * 12);
            vertices.Add(new Vector3(0f, -0.5f, 0f));
            uv.Add(new Vector2(0.5f, 0.5f));
            vertices.Add(new Vector3(0f, 0.5f, 0f));
            uv.Add(new Vector2(0.5f, 0.5f));
            for (int side = 0; side < sides; side++)
            {
                float a = side / (float)sides * Mathf.PI * 2f;
                float nextA = (side + 1) / (float)sides * Mathf.PI * 2f;
                Vector3 lowerA = new Vector3(Mathf.Cos(a) * 0.5f, -0.5f,
                    Mathf.Sin(a) * 0.5f);
                Vector3 lowerB = new Vector3(Mathf.Cos(nextA) * 0.5f, -0.5f,
                    Mathf.Sin(nextA) * 0.5f);
                int start = vertices.Count;
                vertices.Add(lowerA);
                vertices.Add(lowerB);
                vertices.Add(new Vector3(lowerB.x, 0.5f, lowerB.z));
                vertices.Add(new Vector3(lowerA.x, 0.5f, lowerA.z));
                uv.Add(new Vector2(0f, 0f)); uv.Add(new Vector2(1f, 0f));
                uv.Add(new Vector2(1f, 1f)); uv.Add(new Vector2(0f, 1f));
                triangles.Add(0); triangles.Add(start + 1); triangles.Add(start);
                triangles.Add(1); triangles.Add(start + 3); triangles.Add(start + 2);
                triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 3);
            }
            return FinishMarkerMesh("Kromka_MapMarker_Prism", vertices.ToArray(),
                uv.ToArray(), triangles.ToArray());
        }

        private static Mesh BuildMarkerBeaconMesh()
        {
            Vector3[] vertices =
            {
                new Vector3(0f, 0.62f, 0f), new Vector3(0f,-0.62f,0f),
                new Vector3(0.5f,0f,0f), new Vector3(-0.5f,0f,0f),
                new Vector3(0f,0f,0.5f), new Vector3(0f,0f,-0.5f)
            };
            int[] triangles =
            {
                0,2,4, 0,4,3, 0,3,5, 0,5,2,
                1,4,2, 1,3,4, 1,5,3, 1,2,5
            };
            Vector2[] uv = vertices.Select(vertex => new Vector2(
                vertex.x + 0.5f, vertex.z + 0.5f)).ToArray();
            return FinishMarkerMesh("Kromka_MapMarker_Beacon", vertices, uv, triangles);
        }

        private static Mesh FinishMarkerMesh(string name, Vector3[] vertices,
                                             Vector2[] uv, int[] triangles)
        {
            var mesh = new Mesh { name = name, vertices = vertices, uv = uv,
                triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void BuildRoute(JObject route, Transform routeRoot)
        {
            string id = Text(route, "id");
            Transform root = Child(routeRoot, "Route_" + id);
            JArray pointsJson = (JArray)route["points"];
            Transform[] points = new Transform[pointsJson.Count];
            for (int i = 0; i < pointsJson.Count; i++)
            {
                Vector2 point = Pair((JArray)pointsJson[i]);
                points[i] = Child(root, "ControlPoint_" + (i + 1).ToString("00"));
                points[i].position = PointToWorld(point.x, point.y, 0.04f);
            }
            root.gameObject.AddComponent<KromkaRouteAuthoring>().Configure(id,
                Text(route, "displayName"), ParseRoute(Text(route, "kind")), points,
                Float(route, "widthKm"), Float(route, "travelFactor"));

            // The conforming RouteSurfaces texture pass owns the visible road
            // and railway beds. The former cube rails and sleepers floated at
            // low angles and extended beyond the irregular shoreline.
        }

        internal static void ConfigureBuildSettings(JObject catalog)
        {
            var paths = new List<string> { "Assets/Scenes/Wasteland.unity", GlobalScenePath };
            // Build Settings must follow the catalog alias (wasteland -> KromkaGloomDetour),
            // never the raw location id: LoadSceneAsync ignores case and the raw name
            // collides with the Wasteland bootstrap scene.
            paths.AddRange(((JArray)catalog["locations"]).OfType<JObject>()
                .Select(row => KromkaLocationSceneCatalog.ScenePath(Text(row, "id"))));
            EditorBuildSettings.scenes = paths.Select(path => new EditorBuildSettingsScene(path, true)).ToArray();
        }

        private static string LivePrefabPath(RoaGlobalMapPrefabKind kind)
        {
            switch (kind)
            {
                case RoaGlobalMapPrefabKind.Site: return "Assets/Prefabs/GlobalMap/GM_LiveSiteMarker.prefab";
                case RoaGlobalMapPrefabKind.Party: return "Assets/Prefabs/GlobalMap/GM_LivePartyMarker.prefab";
                case RoaGlobalMapPrefabKind.TrackedTask: return "Assets/Prefabs/GlobalMap/GM_TrackedTaskMarker.prefab";
                case RoaGlobalMapPrefabKind.SettlementStatus: return "Assets/Prefabs/GlobalMap/GM_SettlementStatusMarker.prefab";
                case RoaGlobalMapPrefabKind.TerritoryCell: return "Assets/Prefabs/GlobalMap/GM_TerritoryCell.prefab";
                case RoaGlobalMapPrefabKind.TerritoryBorder: return "Assets/Prefabs/GlobalMap/GM_TerritoryBorder.prefab";
                case RoaGlobalMapPrefabKind.InfluenceRing: return "Assets/Prefabs/GlobalMap/GM_InfluenceRing.prefab";
                case RoaGlobalMapPrefabKind.RouteDash: return "Assets/Prefabs/GlobalMap/GM_RouteDash.prefab";
                case RoaGlobalMapPrefabKind.ActivityCaravan: return "Assets/Prefabs/GlobalMap/GM_Activity_Caravan.prefab";
                case RoaGlobalMapPrefabKind.ActivityDistress: return "Assets/Prefabs/GlobalMap/GM_Activity_Distress.prefab";
                case RoaGlobalMapPrefabKind.ActivityRecon: return "Assets/Prefabs/GlobalMap/GM_Activity_Recon.prefab";
                case RoaGlobalMapPrefabKind.ActivityResource: return "Assets/Prefabs/GlobalMap/GM_Activity_Resource.prefab";
                case RoaGlobalMapPrefabKind.ActivityDefense: return "Assets/Prefabs/GlobalMap/GM_Activity_Defense.prefab";
                case RoaGlobalMapPrefabKind.ActivityAssault: return "Assets/Prefabs/GlobalMap/GM_Activity_Assault.prefab";
                case RoaGlobalMapPrefabKind.ZoneAreaA: return "Assets/Prefabs/GlobalMap/GM_ZoneArea_A.prefab";
                case RoaGlobalMapPrefabKind.ZoneAreaB: return "Assets/Prefabs/GlobalMap/GM_ZoneArea_B.prefab";
                case RoaGlobalMapPrefabKind.ZoneAreaC: return "Assets/Prefabs/GlobalMap/GM_ZoneArea_C.prefab";
                case RoaGlobalMapPrefabKind.BossBadge: return "Assets/Prefabs/GlobalMap/GM_BossBadge.prefab";
                default: throw new ArgumentOutOfRangeException(nameof(kind), kind, null);
            }
        }

        private static GameObject PrefabInstance(string path, Transform parent, string name)
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new InvalidOperationException("Не найден Unity prefab: " + path);
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = name;
            instance.transform.SetParent(parent, false);
            return instance;
        }

        private static GameObject Primitive(string name, PrimitiveType type, Transform parent,
                                            Vector3 position, Vector3 scale, Material material)
        {
            GameObject result = GameObject.CreatePrimitive(type);
            result.name = name;
            result.transform.SetParent(parent, false);
            result.transform.localPosition = position;
            result.transform.localScale = scale;
            Renderer renderer = result.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = material;
            return result;
        }

        private static void Bridge(GameObject target, string stableObjectId)
        {
            RoaUnityLocationObject bridge = target.GetComponent<RoaUnityLocationObject>();
            if (bridge == null) bridge = target.AddComponent<RoaUnityLocationObject>();
            bridge.Configure(stableObjectId);
        }

        private static void DisableCollider(GameObject target)
        {
            Collider collider = target != null ? target.GetComponent<Collider>() : null;
            if (collider != null) collider.enabled = false;
        }

        private static void AddSun(Transform parent, float intensity, Color color)
        {
            Transform sun = Child(parent, "Sun_AUTHORED");
            sun.localRotation = Quaternion.Euler(48f, -32f, 0f);
            Light light = sun.gameObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = intensity;
            light.color = color;
            light.shadows = LightShadows.Soft;
        }

        private static void ConfigureAtmosphere(string id, Color groundColor)
        {
            Color fog = Color.Lerp(groundColor, new Color(0.25f, 0.23f, 0.20f), 0.55f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = fog;
            RenderSettings.fogDensity = id == "global" ? 0.0065f : 0.0085f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = Color.Lerp(groundColor,
                id == "global" ? new Color(0.46f, 0.47f, 0.42f)
                    : new Color(0.38f, 0.35f, 0.31f), id == "global" ? 0.72f : 0.62f);
            RenderSettings.ambientIntensity = id == "global" ? 0.96f : 0.82f;
            RenderSettings.reflectionIntensity = id == "global" ? 0.12f : 0.25f;
            RenderSettings.skybox = SkyboxFor(id, fog);
        }

        private static Material SkyboxFor(string id, Color horizon)
        {
            string safeId = id.Replace('/', '_');
            string path = MaterialRoot + "/Kromka_Sky_" + safeId + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            Shader shader = Shader.Find("Skybox/Procedural");
            if (shader == null) return null;
            material = new Material(shader) { name = "Kromka_Sky_" + safeId };
            material.SetColor("_SkyTint", Color.Lerp(horizon, new Color(0.24f, 0.28f, 0.30f), 0.45f));
            material.SetColor("_GroundColor", Color.Lerp(horizon, Color.black, 0.18f));
            material.SetFloat("_AtmosphereThickness", 0.72f);
            material.SetFloat("_Exposure", 0.72f);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        internal static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        internal static Vector3 PointToWorld(float x, float z, float height)
        {
            return new Vector3((x - MapCenter.x) * MapScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(x, z) + height,
                (MapCenter.y - z) * MapScale);
        }

        private static Material MaterialFor(string name, Color color)
        {
            string path = MaterialRoot + "/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Standard");
            material = new Material(shader) { name = name, color = color };
            material.SetFloat("_Smoothness", 0.18f);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        private static Material MaterialForMap(string name, Color color)
        {
            Material material = MaterialFor(name, color);
            material.color = color;
            if (material.HasProperty("_BaseColor"))
                material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", 0.18f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material MaterialForEmissive(string name, Color color)
        {
            string path = MaterialRoot + "/" + name + ".mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                material = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_EmissionColor"))
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * 0.85f);
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        internal static JObject ReadProjectJson(string relativePath)
        {
            string projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            return JObject.Parse(File.ReadAllText(Path.Combine(projectRoot,
                relativePath.Replace('/', Path.DirectorySeparatorChar))));
        }

        internal static bool SceneAssetExists(string assetPath)
        {
            return AssetDatabase.LoadAssetAtPath<SceneAsset>(assetPath) != null;
        }

        private static void RequireGeneratedScene(string assetPath, string signature)
        {
            string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..",
                assetPath.Replace('/', Path.DirectorySeparatorChar)));
            if (!File.Exists(fullPath) || File.ReadAllText(fullPath).IndexOf(signature,
                    StringComparison.Ordinal) < 0)
                throw new InvalidOperationException("Отказ от миграционной пересборки: сцена не имеет "
                    + "подписи генератора kromka-1: " + assetPath);
        }

        internal static void RefuseDirtyOpenScenes()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (!scene.isDirty) continue;
                throw new InvalidOperationException("Есть несохранённая сцена '" + scene.name
                    + "'. Сохраните или отмените её правки перед генерацией Кромки.");
            }
        }

        private static void EnsureFolders()
        {
            EnsureFolder("Assets/Scenes/Kromka");
            EnsureFolder(LocationSceneRoot);
            EnsureFolder("Assets/Art/Kromka");
            EnsureFolder(MaterialRoot);
            EnsureFolder(MeshRoot);
        }

        private static void EnsureFolder(string path)
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

        internal static int DangerFor(JObject seed, string regionId)
        {
            JObject row = ((JArray)seed["regions"]).OfType<JObject>()
                .FirstOrDefault(candidate => Text(candidate, "id") == regionId);
            return row == null ? 1 : Int(row, "dangerBand");
        }

        private static int AnomalyDischargeFor(string type)
        {
            switch (type)
            {
                case "seam": return 3000;
                case "pull":
                case "glass":
                case "sink": return 4000;
                case "carousel":
                case "dew":
                case "mute": return 5000;
                case "chime": return 6000;
                default: return 4000;
            }
        }

        private static Color RegionColor(string id)
        {
            return RegionColors.TryGetValue(id ?? string.Empty, out Color color)
                ? color : new Color(0.34f, 0.31f, 0.24f);
        }

        private static string Text(JObject row, string key) => row?[key]?.Value<string>() ?? string.Empty;
        private static float Float(JObject row, string key) => row?[key]?.Value<float>() ?? 0f;
        private static int Int(JObject row, string key) => row?[key]?.Value<int>() ?? 0;
        private static float Float(JObject row, string key, float fallback)
            => row?[key]?.Value<float>() ?? fallback;
        private static Vector3 Vector3From(JObject row, Vector3 fallback)
            => row == null ? fallback : new Vector3(
                Float(row, "x", fallback.x), Float(row, "y", fallback.y), Float(row, "z", fallback.z));
        private static Vector2 PairFromObject(JObject row, float fallback)
            => row == null ? new Vector2(fallback, fallback) : new Vector2(
                Mathf.Max(0.2f, Float(row, "x", fallback)),
                Mathf.Max(0.2f, Float(row, "z", fallback)));
        private static Vector2 Pair(JArray row) => row == null || row.Count < 2
            ? Vector2.zero : new Vector2(row[0].Value<float>(), row[1].Value<float>());

        internal static KromkaMacroRegion ParseRegion(string value)
        {
            switch (value)
            {
                case "northern_sluices": return KromkaMacroRegion.NorthernSluices;
                case "middle_vein": return KromkaMacroRegion.MiddleVein;
                case "ore_arc": return KromkaMacroRegion.OreArc;
                case "tract_isthmus": return KromkaMacroRegion.TractIsthmus;
                case "chalk_lowland": return KromkaMacroRegion.ChalkLowland;
                case "glasslands": return KromkaMacroRegion.Glasslands;
                case "zero_basin": return KromkaMacroRegion.ZeroBasin;
                case "silent_ring": return KromkaMacroRegion.SilentRing;
                case "off_map": return KromkaMacroRegion.OffMap;
                default: return KromkaMacroRegion.Regional;
            }
        }

        private static KromkaLocationKind ParseLocationKind(string value)
        {
            switch (value)
            {
                case "settlement": return KromkaLocationKind.Settlement;
                case "faction_capital": return KromkaLocationKind.FactionCapital;
                case "caravan_hub": return KromkaLocationKind.CaravanHub;
                case "road_outpost": return KromkaLocationKind.RoadOutpost;
                case "industrial_site": return KromkaLocationKind.IndustrialSite;
                case "resource_site": return KromkaLocationKind.ResourceSite;
                case "raid_complex": return KromkaLocationKind.RaidComplex;
                case "mutant_lair": return KromkaLocationKind.MutantLair;
                case "encounter_template": return KromkaLocationKind.EncounterTemplate;
                case "boundary_expedition": return KromkaLocationKind.BoundaryExpedition;
                case "tutorial": return KromkaLocationKind.Tutorial;
                case "story_complex": return KromkaLocationKind.StoryComplex;
                case "personal_base": return KromkaLocationKind.PersonalBase;
                case "clan_base": return KromkaLocationKind.ClanBase;
                default: return KromkaLocationKind.EncounterTemplate;
            }
        }

        private static KromkaRouteKind ParseRoute(string value)
        {
            switch (value)
            {
                case "railway": return KromkaRouteKind.Railway;
                case "cascade_canal": return KromkaRouteKind.CascadeCanal;
                case "service_tunnel": return KromkaRouteKind.ServiceTunnel;
                case "seasonal_pass": return KromkaRouteKind.SeasonalPass;
                default: return KromkaRouteKind.Road;
            }
        }
    }
}
