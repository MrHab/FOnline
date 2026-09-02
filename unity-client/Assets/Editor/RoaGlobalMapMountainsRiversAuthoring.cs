#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Генератор окружения глобальной карты: горы и реки поверх поля высот.
    ///
    /// Горы — «штампы» из демо-сцен MEP: композиции скал, собранные
    /// художником пака (кластеры Cliff/Desert_Cliff в Scene_03/Scene_04),
    /// извлекаются с относительными позициями, поворотами, масштабами и
    /// посадкой относительно террейна, а затем ставятся на гребни нашего
    /// рельефа с ориентацией вдоль хребта. Демо-сцены открываются аддитивно
    /// только на чтение и закрываются без сохранения; в нашу сцену попадают
    /// новые инстансы MEP-префабов с запечёнными материалами из
    /// Art/GlobalMap/MEPMaterials (конвенция остальных авторинг-инструментов).
    /// Промежутки между штампами добивает прежняя сетка одиночных пиков.
    /// Реки — трассировка стоком: исток на высоком гребне, спуск по
    /// градиенту поля до западного океана; русло врезается в рельеф (тайлы
    /// пересобираются генератором рельефа), лента воды использует авторский
    /// материал океана.
    ///
    /// Дороги отдельно не генерируются: сеть уже детерминированно строит
    /// RoaGlobalMapRoadAuthoring из data/global-map.json, а рельеф выравнивает
    /// их коридоры и пересаживает сегменты.
    ///
    /// Повторный запуск идемпотентен: контейнеры Generated*_AUTHORED
    /// очищаются и наполняются заново, ассеты мешей переиспользуются. В конце
    /// сцена сохраняется — как принято у авторинг-инструментов карты.
    /// </summary>
    public static class RoaGlobalMapMountainsRiversAuthoring
    {
        private const int Seed = 20260901;
        private const string MountainsRootName = "GeneratedMountains_AUTHORED";
        private const string RiversRootName = "GeneratedRivers_AUTHORED";
        private const string MeshFolder = "Assets/Art/GlobalMap/Meshes";
        private const string OceanMaterialPath =
            "Assets/Art/GlobalMap/Materials/GM_WestOcean.mat";

        // Горы: авторские композиции из демо-сцен пака + сетка одиночных
        // пиков, добивающая промежутки (как хребты кампании Total War).
        private const int MountainInstanceLimit = 280;
        private const float MountainFootHeight = 0.26f;
        private const float MountainGridStepPoints = 13f;

        // Демо-сцены MEP, из которых извлекаются композиции скал.
        private static readonly string[] StampScenePaths =
        {
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_03.unity",
            "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_04.unity"
        };
        // Демо-сцены — метры первого лица; карта — диорама 90×90 юнитов.
        private const float DemoToMapScale = 0.24f;
        private const float StampClusterJoinMeters = 16f;
        private const int StampMemberMin = 3;
        private const int StampMemberMax = 40;
        private const int StampPlacementLimit = 44;
        private const string BakedMaterialFolder = "Assets/Art/GlobalMap/MEPMaterials";
        private const int RiverLimit = 2;
        private const float RiverStepPoints = 7f;
        private const int RiverMaxSteps = 240;

        [MenuItem("Realm of Ashes/Авторинг/Сгенерировать окружение: горы и реки")]
        public static void Generate()
        {
            RoaUnityGlobalMapScene marker = FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");
            Transform staticRoot = marker.StaticContentRoot
                ?? throw new InvalidOperationException("StaticContentRoot отсутствует.");

            JObject map = RoaGlobalMapReliefAuthoring.LoadMapJson();

            // 1. Базовое поле без рек — по нему трассируются русла.
            RoaGlobalMapReliefAuthoring.ReliefField baseField =
                RoaGlobalMapReliefAuthoring.PreviewField();

            // 2. Реки стоком вниз + врезка русел, пересборка рельефа и тайлов.
            List<List<Vector2>> rivers = TraceRivers(baseField, map);
            var carves = new List<RoaGlobalMapReliefAuthoring.RiverCarve>();
            foreach (List<Vector2> river in rivers)
            {
                for (int i = 0; i < river.Count; i++)
                {
                    float progress = river.Count > 1 ? i / (float)(river.Count - 1) : 1f;
                    carves.Add(new RoaGlobalMapReliefAuthoring.RiverCarve
                    {
                        At = river[i],
                        Radius = Mathf.Lerp(7f, 14f, progress),
                        Depth = Mathf.Lerp(0.14f, 0.30f, progress)
                    });
                }
            }
            RoaGlobalMapReliefAuthoring.ReliefField carved =
                RoaGlobalMapReliefAuthoring.GenerateWithCarves(carves);

            // 3. Горные массивы на гребнях итогового поля.
            int mountains = BuildMountains(staticRoot, carved, map);

            // 4. Ленты воды по врезанным руслам.
            int riverMeshes = BuildRiverRibbons(staticRoot, carved, rivers);

            // Авторская сцена не хранит серверного состояния: упавшая проба
            // могла оставить в DynamicContent тестовые клоны — вычищаем.
            ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            Debug.Log("[ОКРУЖЕНИЕ] гор: " + mountains + ", рек: " + riverMeshes
                + " (сегментов русла: " + carves.Count
                + "). Рельеф пересобран, сцена сохранена.");
        }

        // ------------------------------------------------------------------
        // Реки: исток на высоком гребне, спуск по градиенту до океана.

        private static List<List<Vector2>> TraceRivers(
            RoaGlobalMapReliefAuthoring.ReliefField field, JObject map)
        {
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;

            // Кандидаты истоков: высокие точки на суше, восточная половина
            // (океан на западе — реке есть куда течь).
            var springs = new List<(Vector2 at, float height)>();
            for (float py = 60f; py < field.HeightPoints - 60f; py += 24f)
            {
                for (float px = field.WidthPoints * 0.42f;
                     px < field.WidthPoints - 60f; px += 24f)
                {
                    float height = field.HeightAt(px, py);
                    if (height > 0.5f) springs.Add((new Vector2(px, py), height));
                }
            }
            springs.Sort((a, b) => b.height.CompareTo(a.height));

            var rivers = new List<List<Vector2>>();
            foreach ((Vector2 at, float _) in springs)
            {
                if (rivers.Count >= RiverLimit) break;
                bool nearExisting = false;
                foreach (List<Vector2> existing in rivers)
                    if (Vector2.Distance(existing[0], at) < 220f) nearExisting = true;
                if (nearExisting) continue;

                List<Vector2> path = DescendToWater(field, map, cols, rows,
                    cellPoints, at);
                if (path != null && path.Count > 14) rivers.Add(path);
            }
            return rivers;
        }

        private static List<Vector2> DescendToWater(
            RoaGlobalMapReliefAuthoring.ReliefField field, JObject map,
            int cols, int rows, float cellPoints, Vector2 start)
        {
            var path = new List<Vector2> { start };
            Vector2 current = start;
            Vector2 momentum = Vector2.left; // к океану
            for (int step = 0; step < RiverMaxSteps; step++)
            {
                int cx = Mathf.Clamp(Mathf.FloorToInt(current.x / cellPoints), 0, cols - 1);
                int cy = Mathf.Clamp(Mathf.FloorToInt(current.y / cellPoints), 0, rows - 1);
                if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy)) return path;

                // Самый низкий из 14 направлений с инерцией течения: река не
                // мечется, но честно обходит гребни.
                Vector2 best = current;
                float bestScore = float.MaxValue;
                for (int i = 0; i < 14; i++)
                {
                    float angle = i * Mathf.PI * 2f / 14f;
                    var direction = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle));
                    Vector2 candidate = current + direction * RiverStepPoints;
                    if (candidate.x < 8f || candidate.y < 8f
                        || candidate.x > field.WidthPoints - 8f
                        || candidate.y > field.HeightPoints - 8f) continue;
                    float score = field.HeightAt(candidate.x, candidate.y)
                        - Vector2.Dot(direction, momentum) * 0.06f
                        // Слабый общий уклон к океану на западе: на плоских
                        // участках река не крутит петли, а тянется к морю.
                        + (candidate.x - current.x) * 0.004f;
                    // Защита от петель: не возвращаться к старой части русла.
                    for (int p = 0; p < path.Count - 10; p++)
                    {
                        if (Vector2.Distance(path[p], candidate) >= 9f) continue;
                        score += 10f;
                        break;
                    }
                    if (score >= bestScore) continue;
                    bestScore = score;
                    best = candidate;
                }
                if (best == current) return path; // тупик — сухое озеро
                momentum = (best - current).normalized;
                current = best;
                path.Add(current);
            }
            return path;
        }

        // ------------------------------------------------------------------
        // Горы: авторские композиции демо-сцен на гребнях + одиночный добив.

        internal struct StampMember
        {
            public string PrefabPath;
            public Vector3 Offset;    // от центроида кластера, метры демо-сцены
            public Quaternion Rotation;
            public Vector3 Scale;     // lossyScale в демо-сцене
        }

        internal struct Stamp
        {
            public List<StampMember> Members;
            public float RadiusMeters; // радиус кластера в демо-сцене
        }

        private static int BuildMountains(Transform staticRoot,
            RoaGlobalMapReliefAuthoring.ReliefField field, JObject map)
        {
            Transform container = ResetContainer(staticRoot, MountainsRootName);
            var random = new System.Random(Seed);
            var bakedMaterials = new Dictionary<Material, Material>();

            int count = PlaceStamps(container, random, field, map, bakedMaterials);

            // Добив одиночными пиками: промежутки между штампами и кромка
            // предгорий; крупные первыми, мелкие сглаживают край массива.
            List<(GameObject asset, Vector3 baseScale)> templates =
                FindMountainTemplates(staticRoot);
            if (templates.Count == 0) return count;

            var candidates = new List<(Vector2 at, float height)>();
            for (float py = 26f; py < field.HeightPoints - 26f;
                 py += MountainGridStepPoints)
                for (float px = 26f; px < field.WidthPoints - 26f;
                     px += MountainGridStepPoints)
                {
                    var jittered = new Vector2(
                        px + ((float)random.NextDouble() - 0.5f) * 9f,
                        py + ((float)random.NextDouble() - 0.5f) * 9f);
                    float height = field.HeightAt(jittered.x, jittered.y);
                    if (height > MountainFootHeight)
                        candidates.Add((jittered, height));
                }
            candidates.Sort((a, b) => b.height.CompareTo(a.height));

            int singles = 0;
            foreach ((Vector2 at, float height) in candidates)
            {
                if (singles >= MountainInstanceLimit) break;
                float core = Mathf.InverseLerp(MountainFootHeight, 1.45f, height);
                float scale = Mathf.Lerp(0.75f, 2.6f, core * core)
                    * Mathf.Lerp(0.85f, 1.15f, (float)random.NextDouble());
                PlaceMountain(container, templates, random, field, at, scale,
                    bakedMaterials);
                singles++;
            }
            return count + singles;
        }

        /// <summary>Ставит извлечённые из демо-сцен композиции на гребни.</summary>
        private static int PlaceStamps(Transform container, System.Random random,
            RoaGlobalMapReliefAuthoring.ReliefField field, JObject map,
            Dictionary<Material, Material> bakedMaterials)
        {
            List<Stamp> stamps = ExtractStamps(StampScenePaths,
                name => name.IndexOf("Cliff", StringComparison.Ordinal) >= 0,
                StampClusterJoinMeters, StampMemberMin, StampMemberMax);
            if (stamps.Count == 0)
            {
                Debug.LogWarning("[ОКРУЖЕНИЕ] демо-сцены MEP не дали ни одной"
                    + " композиции скал — остаются только одиночные пики.");
                return 0;
            }

            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;

            // Кандидаты-якоря: джиттер-сетка над порогом предгорий, высокие
            // первыми. Якоря разрежаются по фактическому радиусу штампов,
            // с перекрытием ~45% — соседние композиции сливаются в хребет.
            var candidates = new List<(Vector2 at, float height)>();
            for (float py = 30f; py < field.HeightPoints - 30f; py += 20f)
                for (float px = 30f; px < field.WidthPoints - 30f; px += 20f)
                {
                    var jittered = new Vector2(
                        px + ((float)random.NextDouble() - 0.5f) * 12f,
                        py + ((float)random.NextDouble() - 0.5f) * 12f);
                    float height = field.HeightAt(jittered.x, jittered.y);
                    if (height > MountainFootHeight + 0.05f)
                        candidates.Add((jittered, height));
                }
            candidates.Sort((a, b) => b.height.CompareTo(a.height));

            var placed = new List<(Vector2 at, float radiusPoints)>();
            int cliffs = 0;
            foreach ((Vector2 at, float height) in candidates)
            {
                if (placed.Count >= StampPlacementLimit) break;
                Stamp stamp = stamps[random.Next(stamps.Count)];
                float core = Mathf.InverseLerp(MountainFootHeight, 1.45f, height);
                float scale = DemoToMapScale * Mathf.Lerp(0.8f, 1.35f, core)
                    * Mathf.Lerp(0.9f, 1.1f, (float)random.NextDouble());
                float radiusPoints = stamp.RadiusMeters * scale * 10f;

                bool crowded = false;
                foreach ((Vector2 other, float otherRadius) in placed)
                    if (Vector2.Distance(other, at)
                        < (radiusPoints + otherRadius) * 0.44f)
                    { crowded = true; break; }
                if (crowded) continue;

                cliffs += PlaceStamp(container, random, field, map, cols, rows,
                    cellPoints, bakedMaterials, stamp, at, scale,
                    "Range_" + placed.Count);
                placed.Add((at, radiusPoints));
            }
            Debug.Log("[ОКРУЖЕНИЕ] штампов из демо-сцен: " + placed.Count
                + " (скал в них: " + cliffs + ", библиотека: "
                + stamps.Count + " композиций).");
            return cliffs;
        }

        private static int PlaceStamp(Transform container, System.Random random,
            RoaGlobalMapReliefAuthoring.ReliefField field, JObject map,
            int cols, int rows, float cellPoints,
            Dictionary<Material, Material> bakedMaterials,
            Stamp stamp, Vector2 at, float scale, string name)
        {
            // Композиция ориентируется вдоль хребта: перпендикуляр градиента
            // поля высот, лёгкий случайный доворот разбивает регулярность.
            var gradient = new Vector2(
                field.HeightAt(at.x + 8f, at.y) - field.HeightAt(at.x - 8f, at.y),
                field.HeightAt(at.x, at.y + 8f) - field.HeightAt(at.x, at.y - 8f));
            float yaw = gradient.sqrMagnitude > 0.0001f
                ? Mathf.Atan2(gradient.x, -gradient.y) * Mathf.Rad2Deg + 90f
                : (float)(random.NextDouble() * 360.0);
            yaw += Mathf.Lerp(-14f, 14f, (float)random.NextDouble());
            Quaternion yawRotation = Quaternion.Euler(0f, yaw, 0f);

            var rangeRoot = new GameObject(name).transform;
            rangeRoot.SetParent(container, false);

            int placedMembers = 0;
            foreach (StampMember member in stamp.Members)
            {
                Vector3 offset = yawRotation * (member.Offset * scale);
                float px = at.x + offset.x * 10f;
                float py = at.y - offset.z * 10f;
                if (px < 12f || py < 12f || px > field.WidthPoints - 12f
                    || py > field.HeightPoints - 12f) continue;
                int cx = Mathf.Clamp(Mathf.FloorToInt(px / cellPoints), 0, cols - 1);
                int cy = Mathf.Clamp(Mathf.FloorToInt(py / cellPoints), 0, rows - 1);
                if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy)) continue;

                var asset = AssetDatabase.LoadAssetAtPath<GameObject>(member.PrefabPath);
                if (asset == null) continue;
                var clone = (GameObject)PrefabUtility.InstantiatePrefab(
                    asset, rangeRoot);
                float ground = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                    + field.HeightAt(px, py);
                clone.transform.position = new Vector3(
                    (px - field.WidthPoints * 0.5f) * 0.1f,
                    ground + offset.y - 0.22f,
                    (field.HeightPoints * 0.5f - py) * 0.1f);
                clone.transform.rotation = yawRotation * member.Rotation;
                clone.transform.localScale = member.Scale * scale;
                ApplyBakedMaterials(clone, bakedMaterials);
                foreach (Collider collider in
                         clone.GetComponentsInChildren<Collider>(true))
                    collider.enabled = false;
                placedMembers++;
            }

            if (placedMembers == 0)
            {
                UnityEngine.Object.DestroyImmediate(rangeRoot.gameObject);
                return 0;
            }
            return placedMembers;
        }

        /// <summary>
        /// Извлекает композиции скал из демо-сцен MEP: сцены открываются
        /// аддитивно только на чтение, кластеры инстансов Cliff-префабов
        /// снимаются с относительными трансформами и посадкой относительно
        /// террейна, затем сцены закрываются без сохранения.
        /// </summary>
        internal static List<Stamp> ExtractStamps(string[] scenePaths,
            Func<string, bool> sourceNameFilter, float joinMeters,
            int memberMin, int memberMax)
        {
            var stamps = new List<Stamp>();
            foreach (string scenePath in scenePaths)
            {
                if (!File.Exists(scenePath)) continue;
                Scene demo = UnityEditor.SceneManagement.EditorSceneManager
                    .OpenScene(scenePath,
                        UnityEditor.SceneManagement.OpenSceneMode.Additive);
                try
                {
                    CollectSceneStamps(demo, stamps, sourceNameFilter,
                        joinMeters, memberMin, memberMax);
                }
                finally
                {
                    UnityEditor.SceneManagement.EditorSceneManager
                        .CloseScene(demo, true);
                }
            }
            return stamps;
        }

        private static void CollectSceneStamps(Scene demo, List<Stamp> stamps,
            Func<string, bool> sourceNameFilter, float joinMeters,
            int memberMin, int memberMax)
        {
            // Корни инстансов Cliff-префабов (группа-префаб считается одним
            // членом — её внутренняя композиция уже авторская).
            var members = new List<(Vector3 position, Transform root, string path)>();
            var terrains = new List<Terrain>();
            foreach (GameObject sceneRoot in demo.GetRootGameObjects())
            {
                terrains.AddRange(sceneRoot.GetComponentsInChildren<Terrain>(true));
                foreach (Transform child in
                         sceneRoot.GetComponentsInChildren<Transform>(true))
                {
                    if (PrefabUtility.GetNearestPrefabInstanceRoot(child.gameObject)
                        != child.gameObject) continue;
                    GameObject source =
                        PrefabUtility.GetCorrespondingObjectFromSource(child.gameObject);
                    if (source == null || !sourceNameFilter(source.name)) continue;
                    string path = AssetDatabase.GetAssetPath(source);
                    if (string.IsNullOrEmpty(path)) continue;
                    members.Add((child.position, child, path));
                }
            }

            // Вложенные префабы: скала внутри группового префаба не должна
            // попадать в кластер отдельно от своей группы.
            var roots = new HashSet<Transform>();
            foreach ((Vector3 _, Transform root, string _) in members) roots.Add(root);
            members.RemoveAll(candidate =>
            {
                for (Transform parent = candidate.root.parent; parent != null;
                     parent = parent.parent)
                    if (roots.Contains(parent)) return true;
                return false;
            });

            // Кластеризация по близости на плоскости XZ (union-find).
            var cluster = new int[members.Count];
            for (int i = 0; i < members.Count; i++) cluster[i] = i;
            int Find(int i) => cluster[i] == i ? i : cluster[i] = Find(cluster[i]);
            for (int i = 0; i < members.Count; i++)
                for (int j = i + 1; j < members.Count; j++)
                {
                    Vector3 a = members[i].position, b = members[j].position;
                    float dx = a.x - b.x, dz = a.z - b.z;
                    if (dx * dx + dz * dz < joinMeters * joinMeters)
                        cluster[Find(i)] = Find(j);
                }

            var groups = new Dictionary<int, List<int>>();
            for (int i = 0; i < members.Count; i++)
            {
                int root = Find(i);
                if (!groups.TryGetValue(root, out List<int> list))
                    groups.Add(root, list = new List<int>());
                list.Add(i);
            }

            // Детерминированный порядок: по центроиду кластера.
            var ordered = new List<List<int>>(groups.Values);
            ordered.Sort((a, b) =>
            {
                Vector3 ca = Centroid(members, a), cb = Centroid(members, b);
                int byX = ca.x.CompareTo(cb.x);
                return byX != 0 ? byX : ca.z.CompareTo(cb.z);
            });

            foreach (List<int> group in ordered)
            {
                if (group.Count < memberMin) continue;
                Vector3 centroid = Centroid(members, group);
                var stamp = new Stamp
                {
                    Members = new List<StampMember>(),
                    RadiusMeters = 6f
                };
                foreach (int index in group)
                {
                    if (stamp.Members.Count >= memberMax) break;
                    (Vector3 position, Transform root, string path) = members[index];
                    float ground = SampleDemoGround(terrains, position, centroid.y);
                    stamp.Members.Add(new StampMember
                    {
                        PrefabPath = path,
                        Offset = new Vector3(position.x - centroid.x,
                            position.y - ground, position.z - centroid.z),
                        Rotation = root.rotation,
                        Scale = root.lossyScale
                    });
                    float dx = position.x - centroid.x, dz = position.z - centroid.z;
                    stamp.RadiusMeters = Mathf.Max(stamp.RadiusMeters,
                        Mathf.Sqrt(dx * dx + dz * dz));
                }
                stamps.Add(stamp);
            }
        }

        private static Vector3 Centroid(
            List<(Vector3 position, Transform root, string path)> members,
            List<int> group)
        {
            Vector3 sum = Vector3.zero;
            foreach (int index in group) sum += members[index].position;
            return sum / Mathf.Max(1, group.Count);
        }

        /// <summary>Высота земли демо-сцены под точкой; без террейна — Y центроида.</summary>
        private static float SampleDemoGround(List<Terrain> terrains,
            Vector3 at, float fallback)
        {
            foreach (Terrain terrain in terrains)
            {
                if (terrain == null || terrain.terrainData == null) continue;
                Vector3 origin = terrain.GetPosition();
                Vector3 size = terrain.terrainData.size;
                if (at.x < origin.x || at.z < origin.z
                    || at.x > origin.x + size.x || at.z > origin.z + size.z)
                    continue;
                return terrain.SampleHeight(at) + origin.y;
            }
            return fallback;
        }

        // ------------------------------------------------------------------
        // Запечённые материалы: клоны из демо-сцен не должны тянуть исходные
        // MEP-материалы — конвенция карты требует копий в MEPMaterials.

        internal static void ApplyBakedMaterials(GameObject instance,
            Dictionary<Material, Material> cache)
        {
            foreach (Renderer renderer in
                     instance.GetComponentsInChildren<Renderer>(true))
            {
                Material[] materials = renderer.sharedMaterials;
                for (int i = 0; i < materials.Length; i++)
                    if (materials[i] != null)
                        materials[i] = BakedMaterial(materials[i], cache);
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode =
                    UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
                renderer.motionVectorGenerationMode =
                    MotionVectorGenerationMode.ForceNoMotion;
            }
        }

        private static Material BakedMaterial(Material source,
            Dictionary<Material, Material> cache)
        {
            if (cache.TryGetValue(source, out Material cached)) return cached;

            // Уже запечённая копия (например Cliff_02_cb45918b) — переиспользуем.
            Material target = null;
            foreach (string guid in AssetDatabase.FindAssets(
                         "t:Material", new[] { BakedMaterialFolder }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                string file = Path.GetFileNameWithoutExtension(path);
                if (!file.StartsWith(source.name + "_", StringComparison.Ordinal))
                    continue;
                target = AssetDatabase.LoadAssetAtPath<Material>(path);
                break;
            }

            if (target == null)
            {
                Shader lit = Shader.Find("Universal Render Pipeline/Lit")
                    ?? throw new InvalidOperationException("URP Lit не найден.");
                target = new Material(lit) { name = source.name };
                if (source.HasProperty("_BaseMap") || source.HasProperty("_MainTex"))
                {
                    Texture baseMap = source.HasProperty("_BaseMap")
                        ? source.GetTexture("_BaseMap")
                        : source.GetTexture("_MainTex");
                    target.SetTexture("_BaseMap", baseMap);
                }
                if (source.HasProperty("_BumpMap"))
                {
                    Texture bump = source.GetTexture("_BumpMap");
                    if (bump != null)
                    {
                        target.SetTexture("_BumpMap", bump);
                        target.EnableKeyword("_NORMALMAP");
                    }
                }
                target.SetFloat("_Smoothness", 0.3f);
                target.SetFloat("_Metallic", 0f);
                uint hash = 2166136261u;
                foreach (char c in AssetDatabase.GetAssetPath(source) + "|" + source.name)
                    hash = (hash ^ c) * 16777619u;
                AssetDatabase.CreateAsset(target, BakedMaterialFolder + "/"
                    + source.name + "_" + hash.ToString("x8") + ".mat");
            }

            // Требования комитета к WebGL-бюджету: GPU instancing у копий и
            // потолок 1024 на текстурах — объекты карты всё равно точки.
            target.enableInstancing = true;
            ClampTextureSize(target.GetTexture("_BaseMap"));
            if (target.HasProperty("_BumpMap"))
                ClampTextureSize(target.GetTexture("_BumpMap"));

            cache.Add(source, target);
            return target;
        }

        private static void ClampTextureSize(Texture texture)
        {
            if (texture == null) return;
            string path = AssetDatabase.GetAssetPath(texture);
            if (string.IsNullOrEmpty(path)) return;
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null || importer.maxTextureSize <= 1024) return;
            importer.maxTextureSize = 1024;
            importer.SaveAndReimport();
        }

        private static void PlaceMountain(Transform container,
            List<(GameObject asset, Vector3 baseScale)> templates,
            System.Random random, RoaGlobalMapReliefAuthoring.ReliefField field,
            Vector2 at, float scale, Dictionary<Material, Material> bakedMaterials)
        {
            if (at.x < 12f || at.y < 12f || at.x > field.WidthPoints - 12f
                || at.y > field.HeightPoints - 12f) return;
            // Правило сцены «только префабы»: пик — инстанс исходного
            // MEP-префаба, а не отвязанный клон сценического объекта.
            (GameObject asset, Vector3 baseScale) template =
                templates[random.Next(templates.Count)];
            Transform clone = ((GameObject)PrefabUtility.InstantiatePrefab(
                template.asset, container)).transform;
            clone.gameObject.name = "Mountain_" + container.childCount;
            clone.gameObject.SetActive(true);
            ApplyBakedMaterials(clone.gameObject, bakedMaterials);
            foreach (Collider collider in
                     clone.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            float height = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                + field.HeightAt(at.x, at.y);
            // Крупные пики сажаются глубже — основание уходит в склон, а не
            // висит на точке касания.
            clone.position = new Vector3(
                (at.x - field.WidthPoints * 0.5f) * 0.1f,
                height - 0.15f - scale * 0.09f,
                (field.HeightPoints * 0.5f - at.y) * 0.1f);
            clone.rotation = Quaternion.Euler(0f,
                (float)(random.NextDouble() * 360.0), 0f);
            clone.localScale = template.baseScale * scale;
        }

        /// <summary>
        /// Шаблоны одиночных пиков: исходные MEP-префабы авторских скал сцены
        /// и их сценический масштаб (сами инстансы не клонируются — из них
        /// берётся только ссылка на ассет).
        /// </summary>
        private static List<(GameObject asset, Vector3 baseScale)>
            FindMountainTemplates(Transform staticRoot)
        {
            var templates = new List<(GameObject asset, Vector3 baseScale)>();
            foreach (Transform child in
                     staticRoot.GetComponentsInChildren<Transform>(true))
            {
                if (templates.Count >= 4) break;
                if (child == null) continue;
                GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(
                    child.gameObject);
                string sourceName = source != null ? source.name : string.Empty;
                if ((sourceName.StartsWith("Cliff", StringComparison.Ordinal)
                     || sourceName.StartsWith("MEP_Cliff", StringComparison.Ordinal))
                    && PrefabUtility.GetNearestPrefabInstanceRoot(child.gameObject)
                        == child.gameObject)
                {
                    var asset = AssetDatabase.LoadAssetAtPath<GameObject>(
                        AssetDatabase.GetAssetPath(source));
                    if (asset != null) templates.Add((asset, child.localScale));
                }
            }
            if (templates.Count == 0)
            {
                foreach (Transform child in
                         staticRoot.GetComponentsInChildren<Transform>(true))
                {
                    if (child == null || !child.name.StartsWith("RockCluster",
                            StringComparison.Ordinal)) continue;
                    GameObject source = PrefabUtility.GetCorrespondingObjectFromSource(
                        child.gameObject);
                    if (source == null) continue;
                    var asset = AssetDatabase.LoadAssetAtPath<GameObject>(
                        AssetDatabase.GetAssetPath(source));
                    if (asset == null) continue;
                    templates.Add((asset, child.localScale));
                    break;
                }
            }
            return templates;
        }

        // ------------------------------------------------------------------
        // Ленты воды по руслам: авторский материал океана, меши как ассеты.

        private static int BuildRiverRibbons(Transform staticRoot,
            RoaGlobalMapReliefAuthoring.ReliefField field, List<List<Vector2>> rivers)
        {
            Transform container = ResetContainer(staticRoot, RiversRootName);
            Material water = AssetDatabase.LoadAssetAtPath<Material>(OceanMaterialPath);
            int built = 0;
            for (int i = 0; i < rivers.Count; i++)
            {
                List<Vector2> path = Smooth(Smooth(Smooth(rivers[i])));
                if (path.Count < 3) continue;
                string assetPath = MeshFolder + "/GM_Mesh_River_" + i + ".asset";
                Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
                bool fresh = mesh == null;
                if (fresh) mesh = new Mesh();
                mesh.name = Path.GetFileNameWithoutExtension(assetPath);
                FillRibbon(mesh, field, path);
                if (fresh) AssetDatabase.CreateAsset(mesh, assetPath);
                else EditorUtility.SetDirty(mesh);

                // Правило сцены «только префабы»: лента реки сохраняется
                // префабом (как океан/горизонт) и инстанцируется из ассета.
                var template = new GameObject("River_" + i,
                    typeof(MeshFilter), typeof(MeshRenderer));
                template.GetComponent<MeshFilter>().sharedMesh = mesh;
                MeshRenderer renderer = template.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = water;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                string prefabPath = "Assets/Prefabs/GlobalMap/GM_River_" + i + ".prefab";
                GameObject prefabAsset = PrefabUtility.SaveAsPrefabAsset(
                    template, prefabPath);
                UnityEngine.Object.DestroyImmediate(template);
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(
                    prefabAsset, container);
                instance.name = "River_" + i;
                built++;
            }
            AssetDatabase.SaveAssets();
            return built;
        }

        private static List<Vector2> Smooth(List<Vector2> path)
        {
            var smooth = new List<Vector2>(path.Count);
            for (int i = 0; i < path.Count; i++)
            {
                Vector2 previous = path[Mathf.Max(0, i - 1)];
                Vector2 next = path[Mathf.Min(path.Count - 1, i + 1)];
                smooth.Add((previous + path[i] * 2f + next) * 0.25f);
            }
            return smooth;
        }

        /// <summary>Лента: пары вершин поперёк пути, вода чуть ниже берегов.</summary>
        private static void FillRibbon(Mesh mesh,
            RoaGlobalMapReliefAuthoring.ReliefField field, List<Vector2> path)
        {
            int count = path.Count;
            var vertices = new Vector3[count * 2];
            var uv = new Vector2[count * 2];
            var triangles = new int[(count - 1) * 6];
            for (int i = 0; i < count; i++)
            {
                float progress = i / (float)(count - 1);
                Vector2 forward = (path[Mathf.Min(count - 1, i + 1)]
                    - path[Mathf.Max(0, i - 1)]).normalized;
                var side = new Vector2(-forward.y, forward.x);
                float half = Mathf.Lerp(4.5f, 10f, progress);
                float surface = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                    + field.HeightAt(path[i].x, path[i].y) + 0.07f;
                Vector2 left = path[i] - side * half;
                Vector2 right = path[i] + side * half;
                vertices[i * 2] = new Vector3(
                    (left.x - field.WidthPoints * 0.5f) * 0.1f, surface,
                    (field.HeightPoints * 0.5f - left.y) * 0.1f);
                vertices[i * 2 + 1] = new Vector3(
                    (right.x - field.WidthPoints * 0.5f) * 0.1f, surface,
                    (field.HeightPoints * 0.5f - right.y) * 0.1f);
                uv[i * 2] = new Vector2(0f, progress * 18f);
                uv[i * 2 + 1] = new Vector2(1f, progress * 18f);
                if (i >= count - 1) continue;
                int t = i * 6, a = i * 2;
                triangles[t] = a; triangles[t + 1] = a + 2; triangles[t + 2] = a + 1;
                triangles[t + 3] = a + 1; triangles[t + 4] = a + 2; triangles[t + 5] = a + 3;
            }
            mesh.Clear();
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
        }

        // ------------------------------------------------------------------

        /// <summary>
        /// Убирает из DynamicContent_SERVER_STATE сохранённые сироты: слой
        /// принадлежит рантайму, в авторской сцене он обязан быть пустым.
        /// </summary>
        internal static void ClearSavedDynamicContent(RoaUnityGlobalMapScene marker)
        {
            Transform dynamicRoot = marker.DynamicContentRoot;
            if (dynamicRoot == null) return;
            for (int i = dynamicRoot.childCount - 1; i >= 0; i--)
                UnityEngine.Object.DestroyImmediate(dynamicRoot.GetChild(i).gameObject);
        }

        internal static Transform ResetContainer(Transform staticRoot, string name)
        {
            Transform container = staticRoot.Find(name);
            if (container == null)
            {
                container = new GameObject(name).transform;
                container.SetParent(staticRoot, false);
            }
            for (int i = container.childCount - 1; i >= 0; i--)
                UnityEngine.Object.DestroyImmediate(container.GetChild(i).gameObject);
            return container;
        }

        internal static RoaUnityGlobalMapScene FindLoadedMarker()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    RoaUnityGlobalMapScene marker =
                        root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                    if (marker != null) return marker;
                }
            }
            return null;
        }
    }
}
#endif
