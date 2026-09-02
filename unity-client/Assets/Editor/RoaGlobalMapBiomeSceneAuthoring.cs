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
    /// Биомные зоны глобальной карты из демо-сцен MEP.
    ///
    /// Карта 900×900 км: запад у океанского пляжа — пустыня (Scene_03),
    /// центр — лес (Scene_01), восточный край — снег и горы (Scene_05).
    /// Ассеты каждой сцены становятся библиотекой зоны, а расстановку ведёт
    /// детерминированный шум: плотные пятна, прогалины и рваные кромки
    /// вместо равномерной сетки. Типы объектов перемешиваются — зона не
    /// вырождается в поле одинаковых валунов. Объекты миниатюрные
    /// (константа DemoMeterToWorld): на карте такого размаха дерево — точка,
    /// скала — бугорок; укрупнение против реальности умеренное, как в
    /// стратегиях.
    ///
    /// Переносятся только корни префаб-инстансов с мешами; служебное
    /// (камеры, свет, звук, вода, частицы), белые стволы и «иглы»
    /// отсекаются. Материалы запекаются в MEPMaterials, коллайдеры
    /// выключаются, LOD раскрывается до LOD0, посадка — на поле рельефа.
    /// Ковёр земли (песок/мох/снег) кладётся только внутри шумовых пятен —
    /// тон биома следует за его наполнением. Прежний процедурный горный
    /// массив очищается: горы карты задаёт снежная зона.
    /// </summary>
    public static class RoaGlobalMapBiomeSceneAuthoring
    {
        private const int Seed = 20260903;
        // Мировых юнитов на метр демо-сцены: дерево ~20 м -> ~0.24 юнита.
        private const float DemoMeterToWorld = 0.012f;
        private const float MinMemberSizeMeters = 1.5f;
        private const float MaxMemberAspect = 5f;
        private const float BandYMinPoints = 115f;
        private const float BandYMaxPoints = 835f;
        private const float PlacementStepPoints = 7f;
        private const float GroundPatchStepPoints = 15f;
        private const float GroundPatchSpanWorld = 2.4f;

        private struct Zone
        {
            public string ScenePath;
            public string ContainerName;
            public float XMinPoints;
            public float XMaxPoints;
            public float NoiseThreshold;  // ниже — прогалина
            public float NoisePeriod;     // размер пятен в точках карты
            public float Density;         // прореживание внутри пятна (0..1)
            public string[] PreferTokens; // характерные для биома ассеты
            public float PreferShare;     // доля лимита под характерное
            public string[] ExtraSkipTokens;
            public string[] GroundPrefabs;
            public float CliffScaleBoost; // горы зоны чуть крупнее прочего
        }

        private static readonly Zone[] Zones =
        {
            new Zone
            {
                ScenePath = "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_03.unity",
                ContainerName = "BiomeScene_Desert_AUTHORED",
                XMinPoints = 105f, XMaxPoints = 395f,
                NoiseThreshold = 0.46f, NoisePeriod = 90f, Density = 0.5f,
                PreferTokens = new[] { "Desert", "Sand", "Mud", "Cactus", "Rock" },
                PreferShare = 0.7f,
                GroundPrefabs = new[]
                {
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_Sand.prefab",
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_a_Sand.prefab",
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_b_Sand.prefab",
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_c_Sand.prefab"
                },
                CliffScaleBoost = 1.3f
            },
            new Zone
            {
                ScenePath = "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_01.unity",
                ContainerName = "BiomeScene_Forest_AUTHORED",
                XMinPoints = 400f, XMaxPoints = 665f,
                NoiseThreshold = 0.5f, NoisePeriod = 60f, Density = 0.55f,
                PreferTokens = new[] { "Tree", "Stump", "Shroom", "Moss" },
                PreferShare = 0.8f,
                ExtraSkipTokens = new[] { "Cliff" },
                GroundPrefabs = new[]
                {
                    "Assets/MEP/MEP_Environment/Vegetation/MEP_Plants&Flowers/MEP_GroundBrush/Prefabs/MEP_GB_Moss_01.prefab",
                    "Assets/MEP/MEP_Environment/Vegetation/MEP_Plants&Flowers/Prefabs/MEP_Moss_01_Grp_01.prefab"
                },
                CliffScaleBoost = 1f
            },
            new Zone
            {
                ScenePath = "Assets/MEP/MEP_Scenes/MEP_Scenes/Scene_05.unity",
                ContainerName = "BiomeScene_Snow_AUTHORED",
                XMinPoints = 665f, XMaxPoints = 870f,
                NoiseThreshold = 0.44f, NoisePeriod = 70f, Density = 0.5f,
                PreferTokens = new[] { "Snow", "Cliff" },
                PreferShare = 0.85f,
                GroundPrefabs = new[]
                {
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_Snow.prefab",
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_a_Snow.prefab",
                    "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Prefabs/MEP_StoneGround_b_Snow.prefab"
                },
                CliffScaleBoost = 1.7f
            }
        };

        // Служебные объекты демо-сцен, которым не место на карте; белые
        // стволы и жерди на мелком масштабе читаются как «лучи».
        private static readonly string[] SkipTokens =
        {
            "Camera", "Light", "Sound", "Audio", "Post", "Fog", "Smoke",
            "Fire", "Water", "Level", "Quad", "Reflection", "Terrain",
            "Polybrush", "Iventory",
            "Birch", "Bamboo", "Liana", "Palm", "Pandani", "Plank",
            "Broken_Con", "Antenna", "Pole"
        };

        private struct Member
        {
            public string PrefabPath;
            public Vector3 DemoScale;   // lossyScale в демо-сцене
            public float DeltaYMeters;  // посадка относительно террейна
            public float YawDeg;
            public float SizeMeters;    // наибольший XZ-габарит рендереров
            public bool Preferred;
        }

        /// <summary>
        /// Полная очистка сгенерированного окружения: биомные зоны, горы,
        /// реки и ориентиры удаляются, остаётся только рельеф (карта высот).
        /// Контейнер Decor сохраняется пустым — слой пинится контрактом.
        /// </summary>
        [MenuItem("Realm of Ashes/Авторинг/Очистить сгенерированное окружение")]
        public static void Clear()
        {
            RoaUnityGlobalMapScene marker =
                RoaGlobalMapMountainsRiversAuthoring.FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");
            Transform staticRoot = marker.StaticContentRoot
                ?? throw new InvalidOperationException("StaticContentRoot отсутствует.");

            int removed = 0;
            foreach (string name in new[]
            {
                "BiomeScene_Desert_AUTHORED", "BiomeScene_Forest_AUTHORED",
                "BiomeScene_Snow_AUTHORED", "GeneratedMountains_AUTHORED",
                "GeneratedRivers_AUTHORED"
            })
            {
                Transform container = staticRoot.Find(name);
                if (container == null) continue;
                removed += container.childCount;
                UnityEngine.Object.DestroyImmediate(container.gameObject);
            }
            // Контейнеры мастер-плана (Plan_*_AUTHORED) удаляются целиком.
            for (int i = staticRoot.childCount - 1; i >= 0; i--)
            {
                Transform child = staticRoot.GetChild(i);
                if (!child.name.StartsWith("Plan_", StringComparison.Ordinal)
                    || !child.name.EndsWith("_AUTHORED", StringComparison.Ordinal))
                    continue;
                removed += child.childCount;
                UnityEngine.Object.DestroyImmediate(child.gameObject);
            }
            // Декоративные слои штатных инструментов тоже опустошаются
            // (контейнеры остаются — их имена пинятся контрактом): детальные
            // биомы, стыки и береговые формы отключены — карта = рельеф.
            foreach (string layerPath in new[]
            {
                "Decor",
                "BiomeDetail_AUTHORED",
                RoaGlobalMapSeamAuthoring.LayerName,
                "WorldEdge_AUTHORED/"
                    + RoaGlobalMapEnvironmentAuthoring.CoastDetailLayerName,
                "Infrastructure/" + RoaGlobalMapRoadAuthoring.NetworkLayerName
            })
            {
                Transform layer = staticRoot.Find(layerPath);
                if (layer == null) continue;
                for (int i = layer.childCount - 1; i >= 0; i--)
                {
                    removed++;
                    UnityEngine.Object.DestroyImmediate(
                        layer.GetChild(i).gameObject);
                }
            }

            RoaGlobalMapMountainsRiversAuthoring.ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            Debug.Log("[ОЧИСТКА] удалено объектов окружения: " + removed
                + ". Остался только рельеф; сцена сохранена.");
        }

        [MenuItem("Realm of Ashes/Авторинг/Сгенерировать биомы из MEP-сцен")]
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

            var bakedMaterials = new Dictionary<Material, Material>();
            var summary = new List<string>();
            for (int zoneIndex = 0; zoneIndex < Zones.Length; zoneIndex++)
            {
                Zone zone = Zones[zoneIndex];
                List<Member> members = ExtractSceneMembers(zone);
                Transform container = RoaGlobalMapMountainsRiversAuthoring
                    .ResetContainer(staticRoot, zone.ContainerName);
                if (members.Count == 0)
                {
                    summary.Add(zone.ContainerName + ": библиотека пуста");
                    continue;
                }
                int placed = PlaceZone(container, members, zone, zoneIndex,
                    map, relief, bakedMaterials);
                int carpet = PlaceGroundCarpet(container, zone, zoneIndex,
                    map, relief, bakedMaterials);
                summary.Add(zone.ContainerName + ": " + placed + " + ковёр "
                    + carpet + " (библиотека " + members.Count + ")");
            }

            // Горы карты задаёт снежная зона — процедурный массив убирается.
            Transform mountains = staticRoot.Find("GeneratedMountains_AUTHORED");
            if (mountains != null)
                for (int i = mountains.childCount - 1; i >= 0; i--)
                    UnityEngine.Object.DestroyImmediate(
                        mountains.GetChild(i).gameObject);

            RoaGlobalMapMountainsRiversAuthoring.ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[БИОМЫ] " + string.Join("; ", summary)
                + ". Процедурные горы очищены, сцена сохранена.");
        }

        // ------------------------------------------------------------------
        // Извлечение библиотеки зоны из демо-сцены.

        private static List<Member> ExtractSceneMembers(Zone zone)
        {
            var members = new List<Member>();
            if (!File.Exists(zone.ScenePath)) return members;
            Scene demo = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
                zone.ScenePath, UnityEditor.SceneManagement.OpenSceneMode.Additive);
            try
            {
                CollectMembers(demo, members, zone);
            }
            finally
            {
                UnityEditor.SceneManagement.EditorSceneManager.CloseScene(demo, true);
            }
            return members;
        }

        private static void CollectMembers(Scene demo, List<Member> members,
            Zone zone)
        {
            var raw = new List<(Vector3 position, Transform root, string path,
                float size, float height)>();
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
                    if (source == null || Skipped(source.name)
                        || Skipped(child.name)) continue;
                    if (zone.ExtraSkipTokens != null
                        && (Matches(source.name, zone.ExtraSkipTokens)
                            || Matches(child.name, zone.ExtraSkipTokens))) continue;
                    string path = AssetDatabase.GetAssetPath(source);
                    if (string.IsNullOrEmpty(path)) continue;

                    MeshRenderer[] renderers =
                        child.GetComponentsInChildren<MeshRenderer>(true);
                    if (renderers.Length == 0) continue;
                    Bounds bounds = renderers[0].bounds;
                    for (int i = 1; i < renderers.Length; i++)
                        bounds.Encapsulate(renderers[i].bounds);
                    float size = Mathf.Max(bounds.size.x, bounds.size.z);
                    if (size < MinMemberSizeMeters) continue;
                    float narrow = Mathf.Min(
                        Mathf.Max(bounds.size.x, 0.1f),
                        Mathf.Max(bounds.size.z, 0.1f));
                    if (size / narrow > MaxMemberAspect) continue;
                    // Вертикальные «иглы» — голые столбы и стволы.
                    if (bounds.size.y / Mathf.Max(size, 0.5f) > 4f) continue;
                    raw.Add((child.position, child, path, size, bounds.size.y));
                }
            }

            // Вложенные инстансы не дублируются отдельно от своих групп.
            var roots = new HashSet<Transform>();
            foreach ((Vector3 _, Transform root, string _, float _, float _)
                     in raw)
                roots.Add(root);
            raw.RemoveAll(candidate =>
            {
                for (Transform parent = candidate.root.parent; parent != null;
                     parent = parent.parent)
                    if (roots.Contains(parent)) return true;
                return false;
            });

            // Библиотека — УНИКАЛЬНЫЕ ассеты (по пути), не расстановка сцены:
            // повторяемость задаёт шум размещения, а не частота в демо-сцене.
            var seen = new HashSet<string>();
            foreach ((Vector3 position, Transform root, string path,
                      float size, float _) in raw)
            {
                if (!seen.Add(path)) continue;
                float ground = SampleGround(terrains, position, position.y);
                members.Add(new Member
                {
                    PrefabPath = path,
                    DemoScale = root.lossyScale,
                    DeltaYMeters = position.y - ground,
                    YawDeg = root.rotation.eulerAngles.y,
                    SizeMeters = size,
                    Preferred = Preferred(path, zone.PreferTokens)
                });
            }
            // Детерминированный порядок.
            members.Sort((a, b) => string.CompareOrdinal(a.PrefabPath, b.PrefabPath));
        }

        private static bool Preferred(string prefabPath, string[] tokens)
        {
            return tokens != null
                && Matches(Path.GetFileNameWithoutExtension(prefabPath), tokens);
        }

        private static bool Matches(string name, string[] tokens)
        {
            foreach (string token in tokens)
                if (name.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            return false;
        }

        private static bool Skipped(string name)
        {
            return Matches(name, SkipTokens);
        }

        private static float SampleGround(List<Terrain> terrains, Vector3 at,
            float fallback)
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
        // Детерминированный шум пятен.

        internal static float Hash01(int x, int y, int seed)
        {
            unchecked
            {
                uint h = (uint)(x * 374761393 + y * 668265263 + seed * 974634211);
                h = (h ^ (h >> 13)) * 1274126177u;
                return ((h ^ (h >> 16)) & 0xFFFFFF) / 16777215f;
            }
        }

        private static float ValueNoise(float x, float y, int seed)
        {
            int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
            float tx = x - x0, ty = y - y0;
            float a = Hash01(x0, y0, seed), b = Hash01(x0 + 1, y0, seed);
            float c = Hash01(x0, y0 + 1, seed), d = Hash01(x0 + 1, y0 + 1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, tx), Mathf.Lerp(c, d, tx), ty);
        }

        internal static float PatchNoise(float px, float py, float period, int seed)
        {
            return 0.62f * ValueNoise(px / period, py / period, seed)
                + 0.38f * ValueNoise(px / (period * 0.31f),
                    py / (period * 0.31f), seed + 17);
        }

        // ------------------------------------------------------------------
        // Расстановка зоны: шумовые пятна с прогалинами, перемешанные типы.

        private static int PlaceZone(Transform container, List<Member> members,
            Zone zone, int zoneIndex, JObject map, RoaGlobalMapRelief relief,
            Dictionary<Material, Material> bakedMaterials)
        {
            var preferred = new List<Member>();
            var others = new List<Member>();
            foreach (Member member in members)
                (member.Preferred ? preferred : others).Add(member);
            if (preferred.Count == 0) preferred = others;
            if (others.Count == 0) others = preferred;

            int placed = 0;
            int cell = 0;
            for (float py = BandYMinPoints; py <= BandYMaxPoints;
                 py += PlacementStepPoints)
                for (float px = zone.XMinPoints; px <= zone.XMaxPoints;
                     px += PlacementStepPoints)
                {
                    cell++;
                    int hx = Mathf.RoundToInt(px), hy = Mathf.RoundToInt(py);
                    float jx = px + (Hash01(hx, hy, Seed + 1) - 0.5f)
                        * PlacementStepPoints;
                    float jy = py + (Hash01(hx, hy, Seed + 2) - 0.5f)
                        * PlacementStepPoints;

                    // Пятна и прогалины; внутри пятна — прореживание.
                    float noise = PatchNoise(jx, jy, zone.NoisePeriod,
                        Seed + zoneIndex * 101);
                    if (noise < zone.NoiseThreshold) continue;
                    if (Hash01(hx, hy, Seed + 3) > zone.Density) continue;

                    Member member;
                    float pick = Hash01(hx, hy, Seed + 4);
                    List<Member> pool = pick < zone.PreferShare
                        ? preferred : others;
                    member = pool[Mathf.Min(pool.Count - 1,
                        (int)(Hash01(hx, hy, Seed + 5) * pool.Count))];

                    if (PlaceMember(container, member, zone, jx, jy, hx, hy,
                            map, relief, bakedMaterials)) placed++;
                }
            return placed;
        }

        private static bool PlaceMember(Transform container, Member member,
            Zone zone, float px, float py, int hx, int hy, JObject map,
            RoaGlobalMapRelief relief,
            Dictionary<Material, Material> bakedMaterials)
        {
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            float widthPoints = cols * cellPoints;
            float heightPoints = rows * cellPoints;
            if (px < 40f || py < 40f || px > widthPoints - 40f
                || py > heightPoints - 40f) return false;
            int cx = Mathf.Clamp(Mathf.FloorToInt(px / cellPoints), 0, cols - 1);
            int cy = Mathf.Clamp(Mathf.FloorToInt(py / cellPoints), 0, rows - 1);
            if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy)) return false;

            var asset = AssetDatabase.LoadAssetAtPath<GameObject>(member.PrefabPath);
            if (asset == null) return false;
            var clone = (GameObject)PrefabUtility.InstantiatePrefab(asset, container);

            float scaleJitter = Mathf.Lerp(0.75f, 1.35f, Hash01(hx, hy, Seed + 6));
            float boost = member.PrefabPath.IndexOf("Cliff",
                StringComparison.OrdinalIgnoreCase) >= 0
                ? zone.CliffScaleBoost : 1f;
            float factor = DemoMeterToWorld * scaleJitter * boost;

            float surface = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                + (relief != null && relief.Ready ? relief.HeightAt(px, py) : 0f);
            float lift = Mathf.Clamp(member.DeltaYMeters * factor, -0.06f, 0.06f);
            clone.transform.position = new Vector3(
                (px - widthPoints * 0.5f) * 0.1f,
                surface + lift - 0.02f,
                (heightPoints * 0.5f - py) * 0.1f);
            clone.transform.rotation = Quaternion.Euler(0f,
                member.YawDeg + Hash01(hx, hy, Seed + 7) * 360f, 0f);
            clone.transform.localScale = member.DemoScale * factor;

            RoaGlobalMapMountainsRiversAuthoring.ApplyBakedMaterials(
                clone, bakedMaterials);
            FlattenLods(clone);
            foreach (Collider collider in
                     clone.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            return true;
        }

        /// <summary>
        /// LOD-группы при масштабе карты куллят объект в ничто (крошечный
        /// экранный размер): остаётся только LOD0, группа удаляется.
        /// </summary>
        internal static void FlattenLods(GameObject clone)
        {
            foreach (LODGroup group in
                     clone.GetComponentsInChildren<LODGroup>(true))
            {
                LOD[] lods = group.GetLODs();
                for (int i = 1; i < lods.Length; i++)
                    foreach (Renderer renderer in lods[i].renderers)
                        if (renderer != null) renderer.enabled = false;
                UnityEngine.Object.DestroyImmediate(group);
            }
        }

        // ------------------------------------------------------------------
        // Ковёр земли: тон биома только внутри шумовых пятен.

        private static int PlaceGroundCarpet(Transform container, Zone zone,
            int zoneIndex, JObject map, RoaGlobalMapRelief relief,
            Dictionary<Material, Material> bakedMaterials)
        {
            if (zone.GroundPrefabs == null || zone.GroundPrefabs.Length == 0)
                return 0;
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            float widthPoints = cols * cellPoints;
            float heightPoints = rows * cellPoints;

            int placed = 0;
            int index = 0;
            for (float py = BandYMinPoints; py <= BandYMaxPoints;
                 py += GroundPatchStepPoints)
                for (float px = zone.XMinPoints; px <= zone.XMaxPoints;
                     px += GroundPatchStepPoints)
                {
                    index++;
                    int hx = Mathf.RoundToInt(px), hy = Mathf.RoundToInt(py);
                    float jx = px + (Hash01(hx, hy, Seed + 11) - 0.5f) * 12f;
                    float jy = py + (Hash01(hx, hy, Seed + 12) - 0.5f) * 12f;
                    if (jx < 40f || jy < 40f || jx > widthPoints - 40f
                        || jy > heightPoints - 40f) continue;
                    float noise = PatchNoise(jx, jy, zone.NoisePeriod,
                        Seed + zoneIndex * 101);
                    if (noise < zone.NoiseThreshold + 0.02f) continue;
                    int cx = Mathf.Clamp(Mathf.FloorToInt(jx / cellPoints),
                        0, cols - 1);
                    int cy = Mathf.Clamp(Mathf.FloorToInt(jy / cellPoints),
                        0, rows - 1);
                    if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy))
                        continue;

                    var asset = AssetDatabase.LoadAssetAtPath<GameObject>(
                        zone.GroundPrefabs[index % zone.GroundPrefabs.Length]);
                    if (asset == null) continue;
                    var clone = (GameObject)PrefabUtility.InstantiatePrefab(
                        asset, container);
                    Bounds bounds = new Bounds(clone.transform.position,
                        Vector3.one);
                    bool first = true;
                    foreach (MeshRenderer renderer in
                             clone.GetComponentsInChildren<MeshRenderer>(true))
                    {
                        if (first) { bounds = renderer.bounds; first = false; }
                        else bounds.Encapsulate(renderer.bounds);
                    }
                    float extent = Mathf.Max(0.5f,
                        Mathf.Max(bounds.size.x, bounds.size.z));
                    float scale = GroundPatchSpanWorld / extent
                        * Mathf.Lerp(0.7f, 1.4f, Hash01(hx, hy, Seed + 13));
                    float surface =
                        RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                        + (relief != null && relief.Ready
                            ? relief.HeightAt(jx, jy) : 0f);
                    clone.transform.position = new Vector3(
                        (jx - widthPoints * 0.5f) * 0.1f,
                        surface + 0.012f + (index % 7) * 0.004f,
                        (heightPoints * 0.5f - jy) * 0.1f);
                    clone.transform.rotation = Quaternion.Euler(0f,
                        Hash01(hx, hy, Seed + 14) * 360f, 0f);
                    clone.transform.localScale =
                        clone.transform.localScale * scale;
                    RoaGlobalMapMountainsRiversAuthoring.ApplyBakedMaterials(
                        clone, bakedMaterials);
                    FlattenLods(clone);
                    foreach (Renderer renderer in
                             clone.GetComponentsInChildren<Renderer>(true))
                        renderer.shadowCastingMode =
                            UnityEngine.Rendering.ShadowCastingMode.Off;
                    foreach (Collider collider in
                             clone.GetComponentsInChildren<Collider>(true))
                        collider.enabled = false;
                    placed++;
                }
            return placed;
        }
    }
}
#endif
