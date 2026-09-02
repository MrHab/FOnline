#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Генератор ориентиров глобальной карты из демо-сцен MEP.
    ///
    /// Слой Decor исторически собирался вручную; после его утраты ориентиры
    /// строятся детерминированно: композиции, расставленные художником пака в
    /// демо-сценах (лагеря из контейнеров и построек, сухостойные рощи,
    /// каменные россыпи), извлекаются «штампами» (см. генератор гор) и
    /// раскладываются по биомам авторских данных data/global-map.json —
    /// вдали от узлов, объектов и гор; лагеря тяготеют к дорогам.
    ///
    /// Контейнер Decor пересоздаётся при каждом запуске; главный член каждой
    /// композиции переименовывается в Curated_* — контракт
    /// check-unity-authored-global-map считает такие имена. Высоты берутся из
    /// запечённого поля рельефа (Resources/RealmOfAshes/GlobalMapRelief), т.е.
    /// инструмент запускается после генератора рельефа и окружения.
    /// В конце сцена сохраняется — как принято у авторинг-инструментов карты.
    /// </summary>
    public static class RoaGlobalMapLandmarkAuthoring
    {
        private const int Seed = 20260902;
        private const string DecorRootName = "Decor";
        private const float DemoToMapScale = 0.22f;
        private const float SpacingPoints = 62f;
        private const float EdgeMarginPoints = 42f;
        private const float MountainFootHeight = 0.24f;

        private static readonly string[] StampScenePaths =
        {
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_01.unity",
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_02.unity",
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_03.unity",
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_04.unity"
        };

        private struct Category
        {
            public string Name;          // префикс Curated_<Name>_NN
            public string[] SourceTokens;
            public string[] CellTextures;
            public int Quota;
            public bool NearRoads;
            public float JoinMeters;     // радиус кластеризации в демо-сцене
            public int MemberMin;        // одиночный Grp-префаб — тоже композиция
        }

        private static readonly Category[] Categories =
        {
            new Category
            {
                Name = "Camp",
                SourceTokens = new[] { "Con_", "House", "Wall", "Plank",
                    "Wood", "Barrel", "Chest", "Skull", "Cart", "Fence",
                    "Hunter" },
                CellTextures = new[] { "scrap_field", "green_lowland" },
                Quota = 6,
                NearRoads = true,
                JoinMeters = 12f,
                MemberMin = 3
            },
            new Category
            {
                Name = "Deadwood",
                SourceTokens = new[] { "DeadTree", "Deadtree", "TreeStump",
                    "Stump" },
                CellTextures = new[] { "green_lowland", "dry_lake" },
                Quota = 7,
                NearRoads = false,
                JoinMeters = 20f,
                MemberMin = 1
            },
            new Category
            {
                Name = "Stones",
                SourceTokens = new[] { "Stone_Grp", "Rock_0", "Boulder",
                    "ClusterStone", "C_Rock" },
                CellTextures = new[] { "scrap_field", "rocky_hills" },
                Quota = 6,
                NearRoads = false,
                JoinMeters = 12f,
                MemberMin = 3
            }
        };

        [MenuItem("Realm of Ashes/Авторинг/Сгенерировать ориентиры из MEP-сцен")]
        public static void Generate()
        {
            RoaUnityGlobalMapScene marker =
                RoaGlobalMapMountainsRiversAuthoring.FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");
            Transform staticRoot = marker.StaticContentRoot
                ?? throw new InvalidOperationException("StaticContentRoot отсутствует.");

            JObject map = RoaGlobalMapReliefAuthoring.LoadMapJson();
            RoaGlobalMapRelief relief = AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(
                "Assets/Resources/RealmOfAshes/GlobalMapRelief.asset");
            if (relief == null || !relief.Ready)
                throw new InvalidOperationException(
                    "Поле рельефа не найдено — сначала запустите генератор рельефа.");

            // Библиотеки композиций по категориям — одним проходом по сценам.
            var libraries = new List<RoaGlobalMapMountainsRiversAuthoring.Stamp>[
                Categories.Length];
            for (int i = 0; i < Categories.Length; i++)
            {
                Category category = Categories[i];
                libraries[i] = RoaGlobalMapMountainsRiversAuthoring.ExtractStamps(
                    StampScenePaths,
                    name => MatchesCategory(name, category.SourceTokens),
                    category.JoinMeters, category.MemberMin, 26);
            }

            Transform decor = RoaGlobalMapMountainsRiversAuthoring.ResetContainer(
                staticRoot, DecorRootName);
            var random = new System.Random(Seed);
            var bakedMaterials = new Dictionary<Material, Material>();
            var occupied = new List<Vector2>();
            var counts = new int[Categories.Length];
            int total = 0;

            for (int i = 0; i < Categories.Length; i++)
            {
                if (libraries[i].Count == 0)
                {
                    Debug.LogWarning("[ОРИЕНТИРЫ] нет композиций категории "
                        + Categories[i].Name + " — пропуск.");
                    continue;
                }
                List<Vector2> anchors = CollectAnchors(map, relief,
                    Categories[i], random);
                foreach (Vector2 at in anchors)
                {
                    if (counts[i] >= Categories[i].Quota) break;
                    if (TooClose(occupied, at)) continue;
                    RoaGlobalMapMountainsRiversAuthoring.Stamp stamp =
                        libraries[i][counts[i] % libraries[i].Count];
                    string name = "Curated_" + Categories[i].Name + "_"
                        + (counts[i] + 1).ToString("00");
                    if (PlaceLandmark(decor, random, relief, map, bakedMaterials,
                            stamp, at, name) == 0) continue;
                    occupied.Add(at);
                    counts[i]++;
                    total++;
                }
            }

            // Авторская сцена не хранит серверного состояния: упавшая проба
            // могла оставить в DynamicContent тестовые клоны — вычищаем.
            RoaGlobalMapMountainsRiversAuthoring.ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[ОРИЕНТИРЫ] размещено: " + total + " (лагерей: "
                + counts[0] + ", сухостоя: " + counts[1] + ", россыпей: "
                + counts[2] + "). Слой Decor пересобран, сцена сохранена.");
            if (total < 15)
                Debug.LogWarning("[ОРИЕНТИРЫ] меньше 15 ориентиров — контракт"
                    + " check-unity-authored-global-map не пройдёт.");
        }

        private static bool MatchesCategory(string sourceName, string[] tokens)
        {
            if (sourceName.IndexOf("Snow", StringComparison.Ordinal) >= 0
                || sourceName.IndexOf("Cliff", StringComparison.Ordinal) >= 0)
                return false;
            foreach (string token in tokens)
                if (sourceName.IndexOf(token, StringComparison.Ordinal) >= 0)
                    return true;
            return false;
        }

        // ------------------------------------------------------------------
        // Якоря: центры подходящих клеток, отфильтрованные по рельефу, воде,
        // узлам, объектам и дорогам; порядок детерминированно перемешан.

        private static List<Vector2> CollectAnchors(JObject map,
            RoaGlobalMapRelief relief, Category category, System.Random random)
        {
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            float widthPoints = cols * cellPoints;
            float heightPoints = rows * cellPoints;
            JObject cells = map["cells"] as JObject ?? new JObject();

            var anchors = new List<Vector2>();
            for (int cy = 0; cy < rows; cy++)
                for (int cx = 0; cx < cols; cx++)
                {
                    string texture = cells[cx + ":" + cy]?["texture"]?.ToString()
                        ?? string.Empty;
                    if (Array.IndexOf(category.CellTextures, texture) < 0) continue;

                    var at = new Vector2(
                        (cx + 0.5f) * cellPoints
                            + Mathf.Lerp(-8f, 8f, (float)random.NextDouble()),
                        (cy + 0.5f) * cellPoints
                            + Mathf.Lerp(-8f, 8f, (float)random.NextDouble()));
                    if (at.x < EdgeMarginPoints || at.y < EdgeMarginPoints
                        || at.x > widthPoints - EdgeMarginPoints
                        || at.y > heightPoints - EdgeMarginPoints) continue;

                    float height = relief.HeightAt(at.x, at.y);
                    if (height < -0.04f || height > MountainFootHeight) continue;
                    if (NearPoint(map, "nodes", at, 55f)
                        || NearPoint(map, "objects", at, 40f)) continue;

                    float road = RoadDistance(map, at);
                    if (category.NearRoads)
                    {
                        if (road < 20f || road > 85f) continue;
                    }
                    else if (road < 26f) continue;

                    anchors.Add(at);
                }

            // Детерминированное перемешивание тем же сидом.
            for (int i = anchors.Count - 1; i > 0; i--)
            {
                int j = random.Next(i + 1);
                (anchors[i], anchors[j]) = (anchors[j], anchors[i]);
            }
            return anchors;
        }

        private static bool NearPoint(JObject map, string listKey, Vector2 at,
            float radius)
        {
            foreach (JToken token in map[listKey] as JArray ?? new JArray())
            {
                float x = token["x"]?.ToObject<float>() ?? float.MinValue;
                float y = token["y"]?.ToObject<float>() ?? float.MinValue;
                if (Vector2.Distance(at, new Vector2(x, y)) < radius) return true;
            }
            return false;
        }

        private static float RoadDistance(JObject map, Vector2 at)
        {
            float best = float.MaxValue;
            foreach (JToken road in map["infrastructure"] as JArray ?? new JArray())
            {
                JArray points = road["points"] as JArray;
                if (points == null) continue;
                for (int i = 0; i + 1 < points.Count; i++)
                {
                    var a = new Vector2(points[i]["x"]?.ToObject<float>() ?? 0f,
                        points[i]["y"]?.ToObject<float>() ?? 0f);
                    var b = new Vector2(points[i + 1]["x"]?.ToObject<float>() ?? 0f,
                        points[i + 1]["y"]?.ToObject<float>() ?? 0f);
                    Vector2 ab = b - a;
                    float t = ab.sqrMagnitude > 0.001f
                        ? Mathf.Clamp01(Vector2.Dot(at - a, ab) / ab.sqrMagnitude)
                        : 0f;
                    best = Mathf.Min(best, Vector2.Distance(at, a + ab * t));
                }
            }
            return best;
        }

        private static bool TooClose(List<Vector2> occupied, Vector2 at)
        {
            foreach (Vector2 other in occupied)
                if (Vector2.Distance(other, at) < SpacingPoints) return true;
            return false;
        }

        // ------------------------------------------------------------------

        /// <summary>
        /// Ставит композицию: контейнер с членами-инстансами MEP-префабов;
        /// самый крупный член переименовывается в имя ориентира — контракт
        /// считает переименованные корни инстансов Curated_*.
        /// </summary>
        private static int PlaceLandmark(Transform decor, System.Random random,
            RoaGlobalMapRelief relief, JObject map,
            Dictionary<Material, Material> bakedMaterials,
            RoaGlobalMapMountainsRiversAuthoring.Stamp stamp, Vector2 at,
            string name)
        {
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            float widthPoints = cols * cellPoints;
            float heightPoints = rows * cellPoints;

            Quaternion yawRotation = Quaternion.Euler(0f,
                (float)(random.NextDouble() * 360.0), 0f);
            var landmarkRoot = new GameObject(name + "_Grp").transform;
            landmarkRoot.SetParent(decor, false);

            int placed = 0;
            GameObject largest = null;
            float largestSize = -1f;
            foreach (RoaGlobalMapMountainsRiversAuthoring.StampMember member
                     in stamp.Members)
            {
                Vector3 offset = yawRotation * (member.Offset * DemoToMapScale);
                float px = at.x + offset.x * 10f;
                float py = at.y - offset.z * 10f;
                if (px < 12f || py < 12f || px > widthPoints - 12f
                    || py > heightPoints - 12f) continue;
                int cx = Mathf.Clamp(Mathf.FloorToInt(px / cellPoints), 0, cols - 1);
                int cy = Mathf.Clamp(Mathf.FloorToInt(py / cellPoints), 0, rows - 1);
                if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy)) continue;

                var asset = AssetDatabase.LoadAssetAtPath<GameObject>(member.PrefabPath);
                if (asset == null) continue;
                var clone = (GameObject)PrefabUtility.InstantiatePrefab(
                    asset, landmarkRoot);
                // Вертикальная дельта из демо-сцены зажимается: реквизит,
                // стоявший там на скале или пне, на карте садится на землю.
                float lift = Mathf.Clamp(offset.y, -0.25f, 0.2f);
                clone.transform.position = new Vector3(
                    (px - widthPoints * 0.5f) * 0.1f,
                    RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                        + relief.HeightAt(px, py) + lift - 0.06f,
                    (heightPoints * 0.5f - py) * 0.1f);
                clone.transform.rotation = yawRotation * member.Rotation;
                clone.transform.localScale = member.Scale * DemoToMapScale;
                RoaGlobalMapMountainsRiversAuthoring.ApplyBakedMaterials(
                    clone, bakedMaterials);
                foreach (Collider collider in
                         clone.GetComponentsInChildren<Collider>(true))
                    collider.enabled = false;

                float size = 0f;
                foreach (Renderer renderer in
                         clone.GetComponentsInChildren<Renderer>(true))
                    size = Mathf.Max(size,
                        renderer.bounds.size.x * renderer.bounds.size.z);
                if (size > largestSize)
                {
                    largestSize = size;
                    largest = clone;
                }
                placed++;
            }

            if (placed == 0)
            {
                UnityEngine.Object.DestroyImmediate(landmarkRoot.gameObject);
                return 0;
            }
            if (largest != null) largest.name = name;
            return placed;
        }
    }
}
#endif
