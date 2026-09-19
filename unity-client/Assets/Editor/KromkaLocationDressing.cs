using System;
using System.Collections.Generic;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>Adds deterministic, individually editable wasteland props to Kromka scenes.</summary>
    internal static class KromkaLocationDressing
    {
        private const string PrefabRoot = "Assets/Prefabs/Models/wasteland/";
        private const string GroupName = "ATMOSPHERIC_DRESSING_EDITABLE";
        private const int RegionalCount = 15;
        // Территория Сердцевины получает только атмосферу: у баз свои настоящие койки,
        // доска работ и склады, и функциональные муляжи рядом с ними путают игрока.
        private const int TerritoryRegionalCount = 19;
        private const int PlacementAttempts = 24;

        public static void Compose(Transform parent, string id, string type, string region,
                                   bool authoredTerritory = false)
        {
            ComposeInto(Child(parent, GroupName), id, type, region, authoredTerritory);
        }

        /// <summary>
        /// Fills an existing dressing group and returns the placed markers. Each prop
        /// tries deterministic positions until it clears the authored objects and
        /// arrival/spawn points already in the scene; the first try is the historic one.
        /// </summary>
        public static List<KromkaPlacedObjectAuthoring> ComposeInto(Transform root, string id,
                                                                   string type, string region,
                                                                   bool authoredTerritory,
                                                                   IEnumerable<Rect> solidAreas = null)
        {
            var placed = new List<KromkaPlacedObjectAuthoring>();
            Occupancy occupancy = Occupancy.FromScene(root.root, root);
            foreach (Rect area in solidAreas ?? Enumerable.Empty<Rect>()) occupancy.AddArea(area);
            string[] regional = RegionProps(region);
            int regionalTarget = authoredTerritory ? TerritoryRegionalCount : RegionalCount;
            int regionalPlaced = 0;
            for (int i = 0; regionalPlaced < regionalTarget && i < regionalTarget * 3; i++)
            {
                int index = i;
                KromkaPlacedObjectAuthoring marker = Place(root,
                    id + "-dressing-region-" + (regionalPlaced + 1).ToString("00"),
                    regional[i % regional.Length],
                    attempt => (Scatter(id, index + attempt * 97, 18f, 34f), Angle(id, index + attempt * 97)),
                    0.82f + Fraction(id, i + 71) * 0.46f, false,
                    new[] { region, "regional-dressing" }, occupancy);
                if (marker == null) continue;
                placed.Add(marker);
                regionalPlaced++;
            }
            if (authoredTerritory) return placed;

            string[] functional = TypeProps(type, id);
            for (int i = 0; i < functional.Length; i++)
            {
                float baseAngle = (i + 0.35f) * Mathf.PI * 2f / functional.Length;
                float baseRadius = 13f + (i % 3) * 3.2f;
                KromkaPlacedObjectAuthoring marker = Place(root,
                    id + "-dressing-functional-" + (i + 1).ToString("00"),
                    functional[i],
                    attempt =>
                    {
                        int step = (attempt + 1) / 2;
                        float angle = baseAngle + (attempt % 2 == 0 ? -1f : 1f) * step * 0.23f;
                        float radius = Mathf.Min(34f, baseRadius + step * 1.1f);
                        return (new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius),
                            -angle * Mathf.Rad2Deg + 90f);
                    },
                    0.9f + (i % 2) * 0.12f, IsBlocking(functional[i]),
                    new[] { type, "functional-dressing" }, occupancy);
                if (marker != null) placed.Add(marker);
            }
            return placed;
        }

        /// <summary>
        /// Дополняет оформлением сцены, где группа ATMOSPHERIC_DRESSING_EDITABLE
        /// осталась пустой (Сердцевина собиралась, когда префабы уже переехали в
        /// RecoveredEnvironment). Сцену целиком не пересобирает и в data дописывает
        /// только новые строки: полный экспорт удалил бы строки, добавленные в JSON
        /// вручную.
        /// </summary>
        [MenuItem("Кромка/Авторинг/Дополнить пустое оформление локаций")]
        [MenuItem("Realm of Ashes/Авторинг/Дополнить пустое оформление локаций")]
        public static void RepairEmptyDressing()
        {
            Debug.Log("[KROMKA] " + RepairEmptyDressingScenes());
        }

        public static void RepairEmptyDressingBatch()
        {
            try
            {
                Debug.Log("[KROMKA] " + RepairEmptyDressingScenes());
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[KROMKA] FAIL: дополнение оформления: " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                throw;
            }
        }

        public static string RepairEmptyDressingScenes()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Оформление дополняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            Scene original = SceneManager.GetActiveScene();
            string originalPath = original.IsValid() ? original.path : string.Empty;
            var repaired = new List<string>();
            try
            {
                foreach (JObject row in ((JArray)catalog["locations"]).OfType<JObject>())
                {
                    string id = row["id"]?.Value<string>() ?? string.Empty;
                    string path = KromkaLocationSceneCatalog.ScenePath(id);
                    if (string.IsNullOrEmpty(path)
                        || AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null) continue;
                    Scene scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
                    Transform group = scene.GetRootGameObjects()
                        .SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                        .FirstOrDefault(item => item.name == GroupName);
                    // Учебный двор собирается без оформления намеренно: группы там нет.
                    if (group == null || group.childCount > 0) continue;
                    List<KromkaPlacedObjectAuthoring> markers = ComposeInto(group, id,
                        row["locationType"]?.Value<string>() ?? string.Empty,
                        row["macroRegion"]?.Value<string>() ?? string.Empty,
                        row["territory"] != null, ServerSolidAreas(id));
                    // Адресный экспорт пишет только строки новых маркеров и не трогает остальные.
                    int exported = KromkaWorldSceneExporter.ExportPlacedObjects(scene,
                        markers.Select(marker => marker.StableObjectId).ToList());
                    if (exported != markers.Count)
                        throw new InvalidOperationException(id + ": в data попало " + exported
                            + " строк оформления из " + markers.Count);
                    EditorSceneManager.MarkSceneDirty(scene);
                    EditorSceneManager.SaveScene(scene);
                    repaired.Add(id + " +" + markers.Count);
                }
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(originalPath)
                    && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                    EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);
            }
            return "оформление дополнено в " + repaired.Count + " сценах"
                + (repaired.Count > 0 ? ": " + string.Join(", ", repaired) : ".");
        }

        /// <summary>
        /// Footprints of rows the server treats as solid. The exported footprint comes
        /// from colliders and can be wider than the visible body, and a prop inside
        /// such an invisible wall only confuses.
        /// </summary>
        private static IEnumerable<Rect> ServerSolidAreas(string id)
        {
            JObject definition = KromkaWorldSceneBuilder.ReadProjectJson("data/locations/" + id + ".json");
            foreach (JObject row in (definition?["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string collision = row["collision"]?.Value<string>() ?? "none";
                if (collision == "none" || !(row["footprint"] is JObject footprint)
                    || !(row["position"] is JObject position)) continue;
                float width = footprint["x"]?.Value<float>() ?? 0f;
                float depth = footprint["z"]?.Value<float>() ?? 0f;
                yield return new Rect((position["x"]?.Value<float>() ?? 0f) - width * 0.5f,
                    (position["z"]?.Value<float>() ?? 0f) - depth * 0.5f, width, depth);
            }
        }

        private static string[] RegionProps(string region)
        {
            switch (region)
            {
                case "northern_sluices":
                    return new[] { "concrete_wall", "rust_barrel_v1", "utility_pole", "perimeter_debris" };
                case "middle_vein":
                    return new[] { "dry_bush", "garden_patch", "utility_pole", "rubble_rock" };
                case "ore_arc":
                    return new[] { "scrap_heap", "ore_outcrop", "rust_barrel_v1", "perimeter_debris" };
                case "tract_isthmus":
                    return new[] { "car_wreck", "tire_stack", "highway_sign", "dry_bush" };
                case "chalk_lowland":
                    return new[] { "rubble_rock", "deadwood", "dry_bush", "ore_outcrop" };
                case "glasslands":
                    return new[] { "dead_tree_a", "relay_antenna", "utility_pole", "perimeter_debris" };
                case "zero_basin":
                    return new[] { "dead_tree_b", "rust_barrel_v1", "oil_pump_jack", "rubble_rock" };
                case "silent_ring":
                    return new[] { "dead_tree_c", "deadwood", "rubble_rock", "ruined_billboard" };
                case "off_map":
                    return new[] { "cargo_stack", "utility_pole", "tire_stack", "perimeter_debris" };
                default:
                    return new[] { "dry_bush", "rubble_rock", "perimeter_debris" };
            }
        }

        private static string[] TypeProps(string type, string id)
        {
            switch (type)
            {
                case "tutorial":
                    return new[] { "job_board", "workshop_bench", "craft_station_weapon", "brahmin_pen", "cargo_stack", "armory_rack" };
                case "settlement":
                case "faction_capital":
                    return new[] { "wasteland_shack", "trader_awning", "job_board", "garden_patch", "storage_lean_to", "barrel_cluster", "watch_post" };
                case "caravan_hub":
                    // Торговых автоматов в экономике v3 нет.
                    return new[] { "cargo_stack", "trader_awning", "car_wreck", "tire_stack", "workshop_bench", "storage_lean_to" };
                case "road_outpost":
                    return new[] { "roadblock_barricade", "watch_post", "scrap_watch_tower", "highway_sign", "barrel_cluster" };
                case "resource_site":
                    return id.IndexOf("Oil", StringComparison.OrdinalIgnoreCase) >= 0
                        ? new[] { "oil_pump_jack", "rust_barrel_v1", "cargo_stack", "storage_lean_to" }
                        : new[] { "ore_outcrop", "scrap_heap", "cargo_stack", "workshop_bench" };
                case "industrial_site":
                    return new[] { "scrap_heap", "cargo_stack", "rust_barrel_v1", "craft_station_tools", "workshop_bench", "scrap_wall_segment" };
                case "clan_base":
                    return new[] { "scrap_watch_tower", "scrap_wall_segment", "roadblock_barricade", "armory_rack", "storage_chest", "craft_station_repair" };
                case "personal_base":
                    return new[] { "storage_chest", "campfire_rest", "craft_station_tools", "garden_patch", "fence_segment" };
                case "mutant_lair":
                    return new[] { "dead_tree_a", "deadwood", "rubble_rock", "car_wreck", "perimeter_debris" };
                case "story_complex":
                case "raid_complex":
                    return new[] { "concrete_wall", "relay_antenna", "rust_barrel_v1", "roadblock_barricade", "cargo_stack" };
                default:
                    return new[] { "car_wreck", "dry_bush", "rubble_rock", "campfire_rest" };
            }
        }

        private static bool IsBlocking(string prefab)
        {
            return prefab == "wasteland_shack" || prefab == "storage_lean_to"
                || prefab == "scrap_watch_tower" || prefab == "concrete_wall"
                || prefab == "roadblock_barricade" || prefab == "scrap_wall_segment";
        }

        private static KromkaPlacedObjectAuthoring Place(Transform parent, string stableId, string prefabName,
                                                         Func<int, (Vector3 position, float yaw)> candidate,
                                                         float scale, bool blocks, string[] tags,
                                                         Occupancy occupancy)
        {
            // Префабы окружения ушли из Models/wasteland в 33a20ffd и живут в
            // RecoveredEnvironment под теми же GUID. Молча пропускать нельзя: так
            // двенадцать сцен Сердцевины собрались без единого предмета оформления.
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabRoot + prefabName + ".prefab")
                ?? AssetDatabase.LoadAssetAtPath<GameObject>(
                    KromkaLocalPrefabRecovery.PrefabRoot + prefabName + ".prefab");
            if (prefab == null)
                throw new InvalidOperationException("Нет префаба оформления " + prefabName);
            GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = stableId;
            instance.transform.SetParent(parent, false);
            instance.transform.localScale *= scale;
            bool clear = false;
            for (int attempt = 0; attempt < PlacementAttempts && !clear; attempt++)
            {
                (Vector3 position, float yaw) = candidate(attempt);
                instance.transform.localPosition = position;
                instance.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
                clear = occupancy.TryReserve(instance);
            }
            if (!clear)
            {
                UnityEngine.Object.DestroyImmediate(instance);
                return null;
            }
            if (!blocks)
            {
                foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true))
                    collider.enabled = false;
            }
            // Префабы RecoveredEnvironment коллайдеров не несут, так что сарай или стена
            // обзор перекрывают, а движение — нет. Флаг движения без коллайдера значил бы
            // невидимую преграду на сервере, и экспортёр такой объект не принимает.
            KromkaPlacedObjectAuthoring marker = instance.AddComponent<KromkaPlacedObjectAuthoring>();
            marker.Configure(stableId, prefabName, "scenery", tags, false,
                blocks && KromkaWorldSceneExporter.HasPhysicalCollider(instance), blocks);
            instance.AddComponent<RoaUnityLocationObject>().Configure(stableId);
            return marker;
        }

        private static Vector3 Scatter(string id, int index, float innerRadius, float outerRadius)
        {
            float angle = Fraction(id, index * 3 + 11) * Mathf.PI * 2f;
            float radius = Mathf.Lerp(innerRadius, outerRadius, Fraction(id, index * 3 + 19));
            return new Vector3(Mathf.Cos(angle) * radius, 0f, Mathf.Sin(angle) * radius);
        }

        private static float Angle(string id, int index) => Fraction(id, index * 5 + 37) * 360f;

        private static float Fraction(string id, int salt)
        {
            unchecked
            {
                uint hash = 2166136261;
                string value = id + ":" + salt;
                for (int i = 0; i < value.Length; i++) hash = (hash ^ value[i]) * 16777619;
                return (hash & 0x00ffffff) / 16777215f;
            }
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        /// <summary>
        /// Plan-view footprints (XZ convex hulls) that dressing must not cover: authored
        /// non-terrain objects, arrival/spawn anchors and anomaly fields. A compact
        /// object counts as a whole (a prop must not stand inside a clinic yard); a
        /// sprawling one, like a perimeter wall, counts by its parts so it does not
        /// reserve the whole yard it encloses.
        /// </summary>
        private sealed class Occupancy
        {
            private const float Margin = 0.6f;
            private const float AnchorHalfSize = 2.5f;
            private const float CompactObjectArea = 300f;
            // Подход к зданию: столб в двух шагах от двери клиники мешает сильнее,
            // чем столб у сплошной стены периметра.
            private const float CompactClearance = 2f;
            private readonly List<Vector2[]> _hulls = new List<Vector2[]>();

            public static Occupancy FromScene(Transform sceneRoot, Transform dressingRoot)
            {
                var occupancy = new Occupancy();
                var partsByOwner = new Dictionary<KromkaPlacedObjectAuthoring, List<Vector2[]>>();
                foreach (Renderer renderer in sceneRoot.GetComponentsInChildren<Renderer>(false))
                {
                    if (!renderer.enabled || renderer.transform.IsChildOf(dressingRoot)) continue;
                    KromkaPlacedObjectAuthoring owner = renderer.GetComponentInParent<KromkaPlacedObjectAuthoring>(true);
                    if (owner == null || owner.Role == "terrain") continue;
                    if (!partsByOwner.TryGetValue(owner, out List<Vector2[]> parts))
                        partsByOwner[owner] = parts = new List<Vector2[]>();
                    parts.Add(Hull(Corners(renderer)));
                }
                foreach (List<Vector2[]> parts in partsByOwner.Values)
                {
                    Vector2[] whole = Hull(parts.SelectMany(part => part));
                    if (Area(whole) <= CompactObjectArea) occupancy._hulls.Add(Grow(whole, CompactClearance));
                    else occupancy._hulls.AddRange(parts);
                }
                foreach (KromkaSpawnAuthoring spawn in sceneRoot.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
                    occupancy.AddSquare(spawn.transform.position, AnchorHalfSize);
                foreach (KromkaAnomalyAuthoring anomaly in sceneRoot.GetComponentsInChildren<KromkaAnomalyAuthoring>(true))
                    occupancy.AddSquare(anomaly.transform.position, Mathf.Max(AnchorHalfSize, anomaly.Radius));
                KromkaLocationAuthoring location = sceneRoot.GetComponentInChildren<KromkaLocationAuthoring>(true);
                if (location != null && location.PlayerArrival != null)
                    occupancy.AddSquare(location.PlayerArrival.position, AnchorHalfSize);
                if (location != null && location.MigrationArrival != null)
                    occupancy.AddSquare(location.MigrationArrival.position, AnchorHalfSize);
                return occupancy;
            }

            /// <summary>Reserves the instance footprint when it overlaps nothing reserved so far.</summary>
            public bool TryReserve(GameObject instance)
            {
                var points = new List<Vector2>();
                foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>(true))
                    points.AddRange(Corners(renderer));
                if (points.Count == 0) return true;
                Vector2[] hull = Hull(points);
                foreach (Vector2[] other in _hulls)
                    if (Overlaps(hull, other)) return false;
                _hulls.Add(hull);
                return true;
            }

            public void AddArea(Rect area)
            {
                _hulls.Add(new[]
                {
                    new Vector2(area.xMin, area.yMin), new Vector2(area.xMax, area.yMin),
                    new Vector2(area.xMax, area.yMax), new Vector2(area.xMin, area.yMax)
                });
            }

            private void AddSquare(Vector3 position, float halfSize)
            {
                _hulls.Add(new[]
                {
                    new Vector2(position.x - halfSize, position.z - halfSize),
                    new Vector2(position.x + halfSize, position.z - halfSize),
                    new Vector2(position.x + halfSize, position.z + halfSize),
                    new Vector2(position.x - halfSize, position.z + halfSize)
                });
            }

            private static Vector2[] Grow(Vector2[] polygon, float distance)
            {
                Vector2 center = polygon.Aggregate(Vector2.zero, (sum, p) => sum + p) / polygon.Length;
                return polygon.Select(p => p + (p - center).normalized * distance).ToArray();
            }

            private static float Area(Vector2[] polygon)
            {
                float twice = 0f;
                for (int i = 0; i < polygon.Length; i++)
                {
                    Vector2 a = polygon[i];
                    Vector2 b = polygon[(i + 1) % polygon.Length];
                    twice += a.x * b.y - b.x * a.y;
                }
                return Mathf.Abs(twice) * 0.5f;
            }

            private static IEnumerable<Vector2> Corners(Renderer renderer)
            {
                Bounds bounds;
                Matrix4x4 matrix;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (renderer is MeshRenderer && filter != null && filter.sharedMesh != null)
                {
                    bounds = filter.sharedMesh.bounds;
                    matrix = renderer.transform.localToWorldMatrix;
                }
                else
                {
                    bounds = renderer.bounds;
                    matrix = Matrix4x4.identity;
                }
                for (int i = 0; i < 8; i++)
                {
                    Vector3 corner = bounds.center + Vector3.Scale(bounds.extents, new Vector3(
                        (i & 1) == 0 ? -1f : 1f, (i & 2) == 0 ? -1f : 1f, (i & 4) == 0 ? -1f : 1f));
                    Vector3 world = matrix.MultiplyPoint3x4(corner);
                    yield return new Vector2(world.x, world.z);
                }
            }

            private static Vector2[] Hull(IEnumerable<Vector2> source)
            {
                Vector2[] points = source.Distinct().OrderBy(p => p.x).ThenBy(p => p.y).ToArray();
                if (points.Length < 3)
                {
                    Vector2 center = points.Length == 0 ? Vector2.zero
                        : points.Aggregate(Vector2.zero, (sum, p) => sum + p) / points.Length;
                    return new[]
                    {
                        center + new Vector2(-0.05f, -0.05f), center + new Vector2(0.05f, -0.05f),
                        center + new Vector2(0.05f, 0.05f), center + new Vector2(-0.05f, 0.05f)
                    };
                }
                var hull = new List<Vector2>();
                foreach (IEnumerable<Vector2> pass in new IEnumerable<Vector2>[] { points, Enumerable.Reverse(points) })
                {
                    int start = hull.Count;
                    foreach (Vector2 p in pass)
                    {
                        while (hull.Count >= start + 2 && Cross(hull[hull.Count - 2], hull[hull.Count - 1], p) <= 0f)
                            hull.RemoveAt(hull.Count - 1);
                        hull.Add(p);
                    }
                    hull.RemoveAt(hull.Count - 1);
                }
                return hull.Count >= 3 ? hull.ToArray() : Hull(new[] { points[0] });
            }

            private static float Cross(Vector2 origin, Vector2 a, Vector2 b)
            {
                return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
            }

            private static bool Overlaps(Vector2[] a, Vector2[] b)
            {
                return !Separated(a, b) && !Separated(b, a);
            }

            private static bool Separated(Vector2[] edges, Vector2[] other)
            {
                for (int i = 0; i < edges.Length; i++)
                {
                    Vector2 edge = edges[(i + 1) % edges.Length] - edges[i];
                    Vector2 axis = new Vector2(-edge.y, edge.x);
                    if (axis.sqrMagnitude < 1e-8f) continue;
                    axis.Normalize();
                    Project(edges, axis, out float minA, out float maxA);
                    Project(other, axis, out float minB, out float maxB);
                    if (maxA + Margin < minB || maxB + Margin < minA) return true;
                }
                return false;
            }

            private static void Project(Vector2[] polygon, Vector2 axis, out float min, out float max)
            {
                min = float.MaxValue;
                max = float.MinValue;
                foreach (Vector2 point in polygon)
                {
                    float value = Vector2.Dot(point, axis);
                    if (value < min) min = value;
                    if (value > max) max = value;
                }
            }
        }
    }
}
