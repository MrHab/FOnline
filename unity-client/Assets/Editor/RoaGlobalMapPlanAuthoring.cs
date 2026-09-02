#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Исполнитель мастер-плана окружения глобальной карты (v2, согласован
    /// комитетом из трёх критиков: композиция, читаемость зума, техника).
    ///
    /// Вход: data/map-plan/plan.json (глобальные правила и исключения),
    /// data/map-plan/regions/*.json (региональные планы от агентов),
    /// data/mep-catalog.json (палитра пака с габаритами).
    ///
    /// Ключевые правила комитета, зашитые в генератор, а не в дисциплину
    /// планировщиков: радиус 55 от узлов; глобальные exclusion-зоны
    /// (солончак и т.п.); буфер дорожных коридоров (в 10 точках от осевой —
    /// только низкий декор); абсолютный потолок высоты декора в юнитах;
    /// ≤12 уникальных префабов на регион; ≤8 рендереров на префаб; бюджет
    /// запечённых материалов; последний LOD вместо LOD0; нечёткие кромки
    /// регионов (edge fade порога шума). Тон биома с дальнего зума даёт
    /// подкраска земли: на тайлы печётся detail-карта из тонов регионов.
    /// Контент — только префаб-инстансы в контейнерах Plan_*_AUTHORED.
    /// </summary>
    public static class RoaGlobalMapPlanAuthoring
    {
        private const string PlanPath = "../../data/map-plan/plan.json";
        private const string RegionsDir = "../../data/map-plan/regions";
        private const string CatalogPath = "../../data/mep-catalog.json";
        private const string TintFolder = "Assets/Art/GlobalMap/Textures";
        private const string MaterialFolder = "Assets/Art/GlobalMap/Materials";
        private const string BakedFolder = "Assets/Art/GlobalMap/MEPMaterials";

        private static readonly string[] SkipTokens =
        {
            "Camera", "Light", "Sound", "Audio", "Post", "Fog", "Smoke",
            "Fire", "Water", "Level", "Quad", "Reflection", "Terrain",
            "Polybrush", "Iventory", "Birch", "Plank"
        };

        private struct PaletteEntry
        {
            public JObject Asset;
            public int Weight;      // накопленный вес для выбора
            public float Boost;
            public float MaxHeight; // юниты мира, потолок финальной высоты
        }

        [MenuItem("Realm of Ashes/Авторинг/Применить мастер-план окружения")]
        public static void Apply()
        {
            RoaUnityGlobalMapScene marker =
                RoaGlobalMapMountainsRiversAuthoring.FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");
            Transform staticRoot = marker.StaticContentRoot
                ?? throw new InvalidOperationException("StaticContentRoot отсутствует.");

            JObject plan = LoadJson(PlanPath);
            JObject catalog = LoadJson(CatalogPath);
            JObject map = RoaGlobalMapReliefAuthoring.LoadMapJson();
            RoaGlobalMapRelief relief = AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(
                "Assets/Resources/RealmOfAshes/GlobalMapRelief.asset");

            float meterToWorld = plan["demoMeterToWorld"]?.ToObject<float>() ?? 0.012f;
            int budget = plan["objectBudget"]?.ToObject<int>() ?? 5000;
            int rendererBudget = plan["rendererBudget"]?.ToObject<int>() ?? 10000;
            int materialBudget = plan["bakedMaterialBudget"]?.ToObject<int>() ?? 40;
            JArray exclusions = plan["exclusions"] as JArray ?? new JArray();

            var regionFiles = new List<string>();
            string regionsRoot = Path.GetFullPath(Path.Combine(
                Application.dataPath, RegionsDir));
            if (Directory.Exists(regionsRoot))
                regionFiles.AddRange(Directory.GetFiles(regionsRoot, "*.json"));
            regionFiles.Sort(StringComparer.Ordinal);
            if (regionFiles.Count == 0)
                throw new InvalidOperationException(
                    "Нет региональных планов в data/map-plan/regions.");

            var regions = new List<JObject>();
            foreach (string file in regionFiles)
                regions.Add(JObject.Parse(File.ReadAllText(file)));

            var bakedMaterials = new Dictionary<Material, Material>();
            var usedSourceMaterials = new HashSet<string>();
            // Уже запечённые копии бесплатны для бюджета: повторный запуск
            // должен давать тот же результат, что и первый.
            var existingBakedNames = new HashSet<string>();
            int existingBaked = 0;
            if (Directory.Exists(BakedFolder))
                foreach (string file in Directory.GetFiles(BakedFolder, "*.mat"))
                {
                    existingBaked++;
                    string stem = Path.GetFileNameWithoutExtension(file);
                    int cut = stem.LastIndexOf('_');
                    existingBakedNames.Add(cut > 0 ? stem.Substring(0, cut) : stem);
                }

            var summary = new List<string>();
            int total = 0;
            int renderersTotal = 0;
            foreach (JObject region in regions)
            {
                string container = region["container"]?.ToString()
                    ?? "Plan_" + (region["id"]?.ToString() ?? "Region")
                        + "_AUTHORED";
                Transform root = RoaGlobalMapMountainsRiversAuthoring
                    .ResetContainer(staticRoot, container);
                int placed = ApplyRegion(root, region, catalog, map, relief,
                    exclusions, meterToWorld, bakedMaterials,
                    usedSourceMaterials, existingBakedNames,
                    materialBudget - existingBaked,
                    budget - total, rendererBudget, ref renderersTotal);
                total += placed;
                summary.Add((region["id"]?.ToString() ?? container) + ": "
                    + placed);
            }

            int tinted = BakeGroundTint(marker, plan, regions, map);

            RoaGlobalMapMountainsRiversAuthoring.ClearSavedDynamicContent(marker);
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(
                marker.gameObject.scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[МАСТЕР-ПЛАН] размещено: " + total + "/" + budget
                + ", рендереров: " + renderersTotal + "/" + rendererBudget
                + ", тайлов подкрашено: " + tinted
                + " (" + string.Join("; ", summary) + "). Сцена сохранена.");
        }

        // ------------------------------------------------------------------
        // Регион: шумовые пятна, нечёткие кромки, взвешенный выбор.

        private static int ApplyRegion(Transform root, JObject region,
            JObject catalog, JObject map, RoaGlobalMapRelief relief,
            JArray globalExclusions, float meterToWorld,
            Dictionary<Material, Material> bakedMaterials,
            HashSet<string> usedSourceMaterials,
            HashSet<string> existingBakedNames, int materialsLeft,
            int remainingBudget, int rendererBudget, ref int renderersTotal)
        {
            JObject bounds = region["bounds"] as JObject ?? new JObject();
            float xMin = bounds["xMin"]?.ToObject<float>() ?? 40f;
            float xMax = bounds["xMax"]?.ToObject<float>() ?? 860f;
            float yMin = bounds["yMin"]?.ToObject<float>() ?? 115f;
            float yMax = bounds["yMax"]?.ToObject<float>() ?? 835f;
            float edgeFade = region["edgeFadePoints"]?.ToObject<float>() ?? 30f;

            JObject noise = region["noise"] as JObject ?? new JObject();
            float threshold = noise["threshold"]?.ToObject<float>() ?? 0.48f;
            float period = noise["period"]?.ToObject<float>() ?? 70f;
            float density = noise["density"]?.ToObject<float>() ?? 0.5f;
            int seed = noise["seed"]?.ToObject<int>() ?? 1;
            float step = noise["stepPoints"]?.ToObject<float>() ?? 8f;

            JObject scale = region["scale"] as JObject ?? new JObject();
            float scaleMin = scale["min"]?.ToObject<float>() ?? 0.75f;
            float scaleMax = scale["max"]?.ToObject<float>() ?? 1.35f;
            float defaultMaxHeight =
                region["maxHeightWorld"]?.ToObject<float>() ?? 0.5f;

            JArray excludeRects = region["excludeRects"] as JArray ?? new JArray();
            int quota = Mathf.Min(remainingBudget,
                region["quota"]?.ToObject<int>() ?? 400);

            List<PaletteEntry> pool = BuildPool(region, catalog,
                defaultMaxHeight, usedSourceMaterials, existingBakedNames,
                materialsLeft);
            if (pool.Count == 0) return 0;
            int totalWeight = pool[pool.Count - 1].Weight;

            int placed = 0;
            for (float py = yMin; py <= yMax && placed < quota; py += step)
                for (float px = xMin; px <= xMax && placed < quota; px += step)
                {
                    if (renderersTotal >= rendererBudget) return placed;
                    int hx = Mathf.RoundToInt(px), hy = Mathf.RoundToInt(py);
                    float jx = px + (RoaGlobalMapBiomeSceneAuthoring
                        .Hash01(hx, hy, seed + 1) - 0.5f) * step;
                    float jy = py + (RoaGlobalMapBiomeSceneAuthoring
                        .Hash01(hx, hy, seed + 2) - 0.5f) * step;

                    // Кромка региона рвётся шумом: порог растёт к границе.
                    float fade = EdgeFade(jx, jy, xMin, xMax, yMin, yMax,
                        edgeFade);
                    float patch = RoaGlobalMapBiomeSceneAuthoring
                        .PatchNoise(jx, jy, period, seed);
                    if (patch < threshold + (1f - fade) * 0.3f) continue;
                    if (RoaGlobalMapBiomeSceneAuthoring.Hash01(hx, hy, seed + 3)
                        > density) continue;
                    if (InsideAny(excludeRects, jx, jy)
                        || InsideAny(globalExclusions, jx, jy)) continue;

                    int pick = (int)(RoaGlobalMapBiomeSceneAuthoring
                        .Hash01(hx, hy, seed + 4) * totalWeight);
                    PaletteEntry chosen = default;
                    foreach (PaletteEntry entry in pool)
                        if (pick < entry.Weight) { chosen = entry; break; }
                    if (chosen.Asset == null) continue;

                    float jitter = Mathf.Lerp(scaleMin, scaleMax,
                        RoaGlobalMapBiomeSceneAuthoring.Hash01(hx, hy, seed + 5));
                    int renderers = PlaceAsset(root, chosen, map, relief,
                        jx, jy, meterToWorld * jitter,
                        RoaGlobalMapBiomeSceneAuthoring
                            .Hash01(hx, hy, seed + 6) * 360f,
                        bakedMaterials);
                    if (renderers > 0) { placed++; renderersTotal += renderers; }
                }

            // Явные ориентиры региона — свой потолок высоты из плана.
            foreach (JToken token in region["landmarks"] as JArray ?? new JArray())
            {
                if (placed >= quota || renderersTotal >= rendererBudget) break;
                JObject landmark = token as JObject;
                if (landmark == null) continue;
                var entry = new PaletteEntry
                {
                    Asset = new JObject { ["path"] = landmark["path"] },
                    Boost = 1f,
                    MaxHeight = landmark["maxHeight"]?.ToObject<float>() ?? 1f
                };
                FillSizesFromCatalog(entry.Asset, catalog);
                int renderers = PlaceAsset(root, entry, map, relief,
                    landmark["x"]?.ToObject<float>() ?? 450f,
                    landmark["y"]?.ToObject<float>() ?? 450f,
                    meterToWorld * (landmark["scale"]?.ToObject<float>() ?? 1f),
                    landmark["yaw"]?.ToObject<float>() ?? 0f, bakedMaterials);
                if (renderers > 0) { placed++; renderersTotal += renderers; }
            }
            return placed;
        }

        private static float EdgeFade(float px, float py, float xMin,
            float xMax, float yMin, float yMax, float fadePoints)
        {
            if (fadePoints <= 0.01f) return 1f;
            float dx = Mathf.Min(px - xMin, xMax - px);
            float dy = Mathf.Min(py - yMin, yMax - py);
            return Mathf.Clamp01(Mathf.Min(dx, dy) / fadePoints);
        }

        private static bool InsideAny(JArray rects, float px, float py)
        {
            foreach (JToken token in rects)
            {
                JObject rect = token as JObject;
                if (rect == null) continue;
                if (px >= (rect["xMin"]?.ToObject<float>() ?? float.MaxValue)
                    && px <= (rect["xMax"]?.ToObject<float>() ?? float.MinValue)
                    && py >= (rect["yMin"]?.ToObject<float>() ?? float.MaxValue)
                    && py <= (rect["yMax"]?.ToObject<float>() ?? float.MinValue))
                    return true;
            }
            return false;
        }

        // ------------------------------------------------------------------
        // Пул региона: фильтры пригодности и бюджеты комитета.

        private static List<PaletteEntry> BuildPool(JObject region,
            JObject catalog, float defaultMaxHeight,
            HashSet<string> usedSourceMaterials,
            HashSet<string> existingBakedNames, int materialsLeft)
        {
            var pool = new List<PaletteEntry>();
            var distinct = new HashSet<string>();
            int accumulated = 0;
            JArray entries = catalog["entries"] as JArray ?? new JArray();
            foreach (JToken ruleToken in region["palette"] as JArray ?? new JArray())
            {
                JObject rule = ruleToken as JObject;
                if (rule == null) continue;
                var include = ToStrings(rule["include"]);
                var exclude = ToStrings(rule["exclude"]);
                int weight = Mathf.Max(1, rule["weight"]?.ToObject<int>() ?? 1);
                float boost = rule["boost"]?.ToObject<float>() ?? 1f;
                float maxHeight = rule["maxHeight"]?.ToObject<float>()
                    ?? defaultMaxHeight;

                foreach (JToken token in entries)
                {
                    if (distinct.Count >= 12) break; // кап комитета: ≤12/регион
                    JObject entry = token as JObject;
                    if (entry == null) continue;
                    string name = entry["name"]?.ToString() ?? string.Empty;
                    string category = entry["category"]?.ToString() ?? string.Empty;
                    string path = entry["path"]?.ToString() ?? string.Empty;
                    if (distinct.Contains(path)) continue;
                    string haystack = category + "/" + name;
                    if (!MatchesAny(haystack, include)) continue;
                    if (MatchesAny(haystack, exclude)) continue;
                    if (MatchesAny(name, SkipTokens)) continue;

                    int renderers = entry["renderers"]?.ToObject<int>() ?? 1;
                    if (renderers > 8) continue; // кап комитета

                    float sizeX = entry["sizeX"]?.ToObject<float>() ?? 0f;
                    float sizeY = entry["sizeY"]?.ToObject<float>() ?? 0f;
                    float sizeZ = entry["sizeZ"]?.ToObject<float>() ?? 0f;
                    float footprint = Mathf.Max(sizeX, sizeZ);
                    float narrow = Mathf.Max(0.1f, Mathf.Min(sizeX, sizeZ));
                    // Группы — уже авторские кластеры: пропорции одиночек к
                    // ним не применяются (правка комитета про кактусы).
                    bool group = name.IndexOf("Grp",
                        StringComparison.OrdinalIgnoreCase) >= 0;
                    if (!group)
                    {
                        if (footprint < 1.2f) continue;
                        if (footprint / narrow > 5f) continue;
                        if (sizeY / Mathf.Max(footprint, 0.5f) > 4f) continue;
                    }

                    // Бюджет запечённых материалов: префаб, тянущий новые
                    // исходные материалы сверх лимита, не попадает в пул.
                    if (!FitsMaterialBudget(path, usedSourceMaterials,
                            existingBakedNames, materialsLeft)) continue;

                    var clone = (JObject)entry.DeepClone();
                    accumulated += weight;
                    distinct.Add(path);
                    pool.Add(new PaletteEntry
                    {
                        Asset = clone,
                        Weight = accumulated,
                        Boost = boost,
                        MaxHeight = maxHeight
                    });
                }
            }
            return pool;
        }

        private static bool FitsMaterialBudget(string path,
            HashSet<string> usedSourceMaterials,
            HashSet<string> existingBakedNames, int materialsLeft)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) return false;
            var fresh = new List<string>();
            foreach (Renderer renderer in
                     prefab.GetComponentsInChildren<Renderer>(true))
                foreach (Material material in renderer.sharedMaterials)
                {
                    if (material == null) continue;
                    if (existingBakedNames.Contains(material.name)) continue;
                    if (usedSourceMaterials.Contains(material.name)) continue;
                    if (!fresh.Contains(material.name)) fresh.Add(material.name);
                }
            if (usedSourceMaterials.Count + fresh.Count > materialsLeft)
                return false;
            foreach (string name in fresh) usedSourceMaterials.Add(name);
            return true;
        }

        // ------------------------------------------------------------------

        /// <summary>Ставит ассет; возвращает число рендереров (0 = отказ).</summary>
        private static int PlaceAsset(Transform root, PaletteEntry entry,
            JObject map, RoaGlobalMapRelief relief, float px, float py,
            float factor, float yaw, Dictionary<Material, Material> bakedMaterials)
        {
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            float widthPoints = cols * cellPoints;
            float heightPoints = rows * cellPoints;
            if (px < 40f || py < 40f || px > widthPoints - 40f
                || py > heightPoints - 40f) return 0;
            int cx = Mathf.Clamp(Mathf.FloorToInt(px / cellPoints), 0, cols - 1);
            int cy = Mathf.Clamp(Mathf.FloorToInt(py / cellPoints), 0, rows - 1);
            if (RoaGlobalMapReliefAuthoring.CellIsWater(map, cx, cy)) return 0;
            if (NearNode(map, px, py, 55f)) return 0;

            factor *= entry.Boost;
            float sizeY = entry.Asset["sizeY"]?.ToObject<float>() ?? 1f;
            // Абсолютный потолок высоты: декор не конкурирует с маркерами.
            float maxHeight = entry.MaxHeight > 0f ? entry.MaxHeight : 0.5f;
            if (sizeY * factor > maxHeight) factor = maxHeight / sizeY;
            // Буфер дорожных коридоров: у осевой — только низкий декор.
            if (sizeY * factor > 0.25f && RoadDistance(map, px, py) < 10f)
                return 0;

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                entry.Asset["path"]?.ToString() ?? string.Empty);
            if (prefab == null) return 0;
            var clone = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root);
            float surface = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                + (relief != null && relief.Ready ? relief.HeightAt(px, py) : 0f);
            clone.transform.position = new Vector3(
                (px - widthPoints * 0.5f) * 0.1f,
                surface - 0.02f,
                (heightPoints * 0.5f - py) * 0.1f);
            clone.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            clone.transform.localScale = clone.transform.localScale * factor;

            RoaGlobalMapMountainsRiversAuthoring.ApplyBakedMaterials(
                clone, bakedMaterials);
            int visible = KeepLastLod(clone);
            foreach (Collider collider in
                     clone.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            return Mathf.Max(1, visible);
        }

        /// <summary>
        /// Оставляет последний меш-LOD (наименьшая детализация — для карты
        /// это норма), остальные рендереры глушит, LODGroup отключает.
        /// Части префаб-инстанса не удаляются — контракт «только префабы».
        /// Возвращает число активных рендереров.
        /// </summary>
        private static int KeepLastLod(GameObject clone)
        {
            foreach (LODGroup group in
                     clone.GetComponentsInChildren<LODGroup>(true))
            {
                LOD[] lods = group.GetLODs();
                int keep = -1;
                for (int i = lods.Length - 1; i >= 0; i--)
                {
                    bool meshOnly = lods[i].renderers.Length > 0;
                    foreach (Renderer renderer in lods[i].renderers)
                        if (!(renderer is MeshRenderer)) { meshOnly = false; break; }
                    if (meshOnly) { keep = i; break; }
                }
                if (keep < 0) keep = 0;
                for (int i = 0; i < lods.Length; i++)
                    foreach (Renderer renderer in lods[i].renderers)
                        if (renderer != null) renderer.enabled = i == keep;
                group.enabled = false;
            }
            int visible = 0;
            foreach (Renderer renderer in
                     clone.GetComponentsInChildren<Renderer>(true))
                if (renderer.enabled) visible++;
            return visible;
        }

        // ------------------------------------------------------------------
        // Подкраска земли: тон биома с дальнего зума (правка комитета №1
        // по читаемости). На каждый тайл печётся detail-карта из тонов
        // регионов; материал тайла — копия исходного с _DETAIL_MULX2.

        private static int BakeGroundTint(RoaUnityGlobalMapScene marker,
            JObject plan, List<JObject> regions, JObject map)
        {
            if (!Directory.Exists(TintFolder))
                Directory.CreateDirectory(TintFolder);
            JArray exclusions = plan["exclusions"] as JArray ?? new JArray();

            int baked = 0;
            var pattern = new System.Text.RegularExpressions.Regex(
                "^GroundTile_(\\d+)_(\\d+)$");
            foreach (GameObject sceneRoot in
                     marker.gameObject.scene.GetRootGameObjects())
            foreach (Transform child in
                     sceneRoot.GetComponentsInChildren<Transform>(true))
            {
                var match = pattern.Match(child.name);
                if (!match.Success) continue;
                MeshRenderer renderer =
                    child.GetComponentInChildren<MeshRenderer>(true);
                if (renderer == null) continue;

                int tx = int.Parse(match.Groups[1].Value);
                int ty = int.Parse(match.Groups[2].Value);
                string texPath = TintFolder + "/GM_GroundTint_" + tx + "_"
                    + ty + ".png";
                WriteTintTexture(texPath, renderer, regions, exclusions);

                // База — материал исходного префаба тайла (Desert/Rocky/Salt),
                // а не текущий (иначе копия копии при повторном запуске).
                var sourceRenderer = PrefabUtility.GetCorrespondingObjectFromSource(
                    renderer);
                Material baseMaterial = sourceRenderer != null
                    ? sourceRenderer.sharedMaterial : renderer.sharedMaterial;
                string matPath = MaterialFolder + "/GM_GroundTint_" + tx + "_"
                    + ty + ".mat";
                var material = AssetDatabase.LoadAssetAtPath<Material>(matPath);
                if (material == null)
                {
                    material = new Material(baseMaterial);
                    AssetDatabase.CreateAsset(material, matPath);
                }
                else material.CopyPropertiesFromMaterial(baseMaterial);
                material.EnableKeyword("_DETAIL_MULX2");
                material.SetTexture("_DetailAlbedoMap",
                    AssetDatabase.LoadAssetAtPath<Texture2D>(texPath));
                // URP Lit передаёт в деталь uv, уже умноженный на ST базовой
                // карты — гасим базовый тайлинг обратным масштабом, чтобы
                // тон лёг ровно один раз на тайл.
                Vector2 baseScale = material.GetTextureScale("_BaseMap");
                material.SetTextureScale("_DetailAlbedoMap", new Vector2(
                    1f / Mathf.Max(0.0001f, baseScale.x),
                    1f / Mathf.Max(0.0001f, baseScale.y)));
                if (material.HasProperty("_DetailAlbedoMapScale"))
                    material.SetFloat("_DetailAlbedoMapScale", 1f);
                EditorUtility.SetDirty(material);
                renderer.sharedMaterial = material;
                baked++;
            }
            return baked;
        }

        private static void WriteTintTexture(string texPath,
            MeshRenderer renderer, List<JObject> regions, JArray exclusions)
        {
            const int size = 96;
            Bounds bounds = renderer.bounds;
            var texture = new Texture2D(size, size, TextureFormat.RGB24, false);
            var neutral = new Color(0.5f, 0.5f, 0.5f);
            for (int v = 0; v < size; v++)
            for (int u = 0; u < size; u++)
            {
                float worldX = Mathf.Lerp(bounds.min.x, bounds.max.x,
                    (u + 0.5f) / size);
                float worldZ = Mathf.Lerp(bounds.min.z, bounds.max.z,
                    (v + 0.5f) / size);
                float px = worldX * 10f + 450f;
                float py = 450f - worldZ * 10f;
                Color color = neutral;
                foreach (JObject region in regions)
                {
                    string hex = region["groundTint"]?.ToString();
                    if (string.IsNullOrEmpty(hex)
                        || !ColorUtility.TryParseHtmlString(hex, out Color tint))
                        continue;
                    JObject rb = region["bounds"] as JObject ?? new JObject();
                    float fade = EdgeFade(px, py,
                        rb["xMin"]?.ToObject<float>() ?? 40f,
                        rb["xMax"]?.ToObject<float>() ?? 860f,
                        rb["yMin"]?.ToObject<float>() ?? 115f,
                        rb["yMax"]?.ToObject<float>() ?? 835f,
                        region["edgeFadePoints"]?.ToObject<float>() ?? 30f);
                    if (fade <= 0f) continue;
                    if (InsideAny(region["excludeRects"] as JArray
                            ?? new JArray(), px, py)
                        || InsideAny(exclusions, px, py)) continue;
                    float strength =
                        region["groundTintStrength"]?.ToObject<float>() ?? 0.8f;
                    color = Color.Lerp(color, tint, fade * strength);
                }
                texture.SetPixel(u, v, color);
            }
            texture.Apply();
            File.WriteAllBytes(texPath, texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(texPath);
            var importer = AssetImporter.GetAtPath(texPath) as TextureImporter;
            if (importer != null && (importer.maxTextureSize != 128
                || importer.wrapMode != TextureWrapMode.Clamp))
            {
                importer.maxTextureSize = 128;
                importer.wrapMode = TextureWrapMode.Clamp;
                importer.SaveAndReimport();
            }
        }

        // ------------------------------------------------------------------

        private static float RoadDistance(JObject map, float px, float py)
        {
            float best = float.MaxValue;
            var at = new Vector2(px, py);
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

        private static bool NearNode(JObject map, float px, float py, float radius)
        {
            foreach (JToken token in map["nodes"] as JArray ?? new JArray())
            {
                float x = token["x"]?.ToObject<float>() ?? float.MinValue;
                float y = token["y"]?.ToObject<float>() ?? float.MinValue;
                if (Vector2.Distance(new Vector2(px, py), new Vector2(x, y))
                    < radius) return true;
            }
            return false;
        }

        private static void FillSizesFromCatalog(JObject asset, JObject catalog)
        {
            string path = asset["path"]?.ToString() ?? string.Empty;
            foreach (JToken token in catalog["entries"] as JArray ?? new JArray())
                if ((token as JObject)?["path"]?.ToString() == path)
                {
                    asset["sizeY"] = token["sizeY"];
                    return;
                }
            asset["sizeY"] = 10f;
        }

        private static bool MatchesAny(string value, IReadOnlyList<string> tokens)
        {
            if (tokens == null || tokens.Count == 0) return false;
            foreach (string token in tokens)
                if (value.IndexOf(token,
                        StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        private static List<string> ToStrings(JToken token)
        {
            var list = new List<string>();
            foreach (JToken item in token as JArray ?? new JArray())
                list.Add(item.ToString());
            return list;
        }

        private static JObject LoadJson(string relativePath)
        {
            string path = Path.GetFullPath(Path.Combine(
                Application.dataPath, relativePath));
            if (!File.Exists(path))
                throw new InvalidOperationException("Файл не найден: " + path);
            return JObject.Parse(File.ReadAllText(path));
        }
    }
}
#endif
