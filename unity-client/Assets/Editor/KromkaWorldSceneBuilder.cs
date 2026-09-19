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
    /// Creates the editable Kromka location scenes from the location catalog. After
    /// this pass, designers move scene objects in Unity and export their transforms;
    /// the server JSON is never the spatial editor.
    /// </summary>
    public static class KromkaWorldSceneBuilder
    {
        private const string LocationSceneRoot = "Assets/Scenes/Kromka/Locations";
        private const string MaterialRoot = "Assets/Art/Kromka/Materials";

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

        [MenuItem("Кромка/Авторинг/ПЕРЕСОБРАТЬ мир из исходного seed")]
        public static void RebuildAllFromSeed()
        {
            if (!EditorUtility.DisplayDialog("Пересобрать мир Кромки?",
                    "Все локальные Unity-сцены Кромки будут созданы заново. Ручные правки в этих сценах будут потеряны.",
                    "Пересобрать", "Отмена"))
                return;
            BuildAllInternal(true);
        }

        [MenuItem("Кромка/Авторинг/ПЕРЕСОБРАТЬ сцены kromka-1 (проверенная миграция)")]
        public static void RebuildGeneratedScenesForMigration()
        {
            RefuseDirtyOpenScenes();
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
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
            EnsureFolders();
            int built = BuildLocations(catalog, overwriteExisting);
            ConfigureBuildSettings(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] Мир kromka-1: создано " + built
                + " сцен; существующие ручные сцены "
                + (overwriteExisting ? "пересобраны." : "сохранены без изменений."));
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
                        Text(location, "locationType"), regionId);
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
                bool blocksVision = row["vision"]?["blocks"]?.Value<bool>() ?? blocksMovement;
                string role = Text(row, "role");
                if (string.IsNullOrWhiteSpace(role) && row["entity"]?["kind"] != null)
                    role = row["entity"]["kind"].Value<string>();
                instance.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                    id, Text(row, "model"), role, tags, true, blocksMovement, blocksVision);
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

        internal static void ConfigureBuildSettings(JObject catalog)
        {
            // 3D-карта мира — отдельная сцена, которую окно «КАРТА МИРА» грузит поверх зоны.
            var paths = new List<string> { "Assets/Scenes/Wasteland.unity", KromkaLocationSceneCatalog.WorldMapScenePath };
            // Build Settings must follow the catalog alias (wasteland -> KromkaGloomDetour),
            // never the raw location id: LoadSceneAsync ignores case and the raw name
            // collides with the Wasteland bootstrap scene.
            paths.AddRange(((JArray)catalog["locations"]).OfType<JObject>()
                .Select(row => KromkaLocationSceneCatalog.ScenePath(Text(row, "id"))));
            EditorBuildSettings.scenes = paths.Select(path => new EditorBuildSettingsScene(path, true)).ToArray();
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
            RenderSettings.fogDensity = 0.0085f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = Color.Lerp(groundColor, new Color(0.38f, 0.35f, 0.31f), 0.62f);
            RenderSettings.ambientIntensity = 0.82f;
            RenderSettings.reflectionIntensity = 0.25f;
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

    }
}
