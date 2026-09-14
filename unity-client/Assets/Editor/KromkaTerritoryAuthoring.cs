using System;
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
    /// <summary>
    /// Дописывает Сердцевину в уже авторскую глобальную сцену: добавляет якоря
    /// новых узлов из data/kromka/world-layout.seed.json, не трогая существующие
    /// объекты, генерирует недостающие локальные сцены и экспортирует размещение.
    /// Существующая ручная сцена глобальной карты не пересобирается.
    /// </summary>
    public static class KromkaTerritoryAuthoring
    {
        private const string GlobalScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";

        [MenuItem("Кромка/Авторинг/Сердцевина: добавить узлы, сцены и экспортировать")]
        [MenuItem("Realm of Ashes/Авторинг/Сердцевина: добавить узлы, сцены и экспортировать")]
        public static void AddTerritoryNodesAndScenes()
        {
            string report = Run();
            Debug.Log("[KROMKA] " + report);
        }

        /// <summary>
        /// Переносит якоря узлов Сердцевины в позиции из seed (после правки
        /// раскладки в данных) и сохраняет глобальную сцену без экспорта.
        /// </summary>
        [MenuItem("Кромка/Авторинг/Сердцевина: синхронизировать узлы с seed")]
        [MenuItem("Realm of Ashes/Авторинг/Сердцевина: синхронизировать узлы с seed")]
        public static void SyncTerritoryNodesToSeed()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Синхронизация выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject territory = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/territory.json");
            JObject seed = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/world-layout.seed.json");
            var territoryIds = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal)
            {
                Text(territory, "zoneLocationId")
            };
            foreach (JObject faction in (territory["factions"] as JArray ?? new JArray()).OfType<JObject>())
                territoryIds.Add(Text(faction, "baseLocationId"));

            Scene scene = EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
            KromkaWorldAuthoring world = scene.GetRootGameObjects()
                .Select(root => root.GetComponentInChildren<KromkaWorldAuthoring>(true))
                .FirstOrDefault(component => component != null);
            if (world == null) throw new InvalidOperationException("Глобальная сцена без KromkaWorldAuthoring.");
            int moved = 0;
            foreach (KromkaWorldLocationAuthoring marker in world.GetComponentsInChildren<KromkaWorldLocationAuthoring>(true))
            {
                if (!territoryIds.Contains(marker.StableLocationId)) continue;
                JObject position = ((JArray)seed["locations"]).OfType<JObject>()
                    .FirstOrDefault(row => Text(row, "id") == marker.StableLocationId);
                if (position == null) continue;
                Vector3 target = KromkaWorldSceneBuilder.PointToWorld(Float(position, "x"), Float(position, "z"), 0.08f);
                if ((marker.transform.localPosition - target).sqrMagnitude < 0.0001f) continue;
                Undo.RecordObject(marker.transform, "Sync territory node");
                marker.transform.localPosition = target;
                moved++;
            }
            if (moved > 0)
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
            Debug.Log("[KROMKA] Сердцевина: узлов перемещено по seed " + moved + ".");
        }

        /// <summary>
        /// Адресная пересборка сцен Сердцевины из data/locations/&lt;id&gt;.json с
        /// перезаписью существующих сцен: либо только четыре базы фракций, либо
        /// вся территория (зона, базы, лаборатории). Каждая сцена после сборки
        /// экспортируется обратно в data самим BuildLocations; остальные сцены и
        /// Build Settings не трогаются.
        /// </summary>
        [MenuItem("Кромка/Авторинг/Сердцевина: пересобрать базы фракций и экспортировать")]
        [MenuItem("Realm of Ashes/Авторинг/Сердцевина: пересобрать базы фракций и экспортировать")]
        public static void RebuildFactionBaseScenes()
        {
            RunMenu(() => RunTerritoryScenes(false));
        }

        [MenuItem("Кромка/Авторинг/Сердцевина: пересобрать все сцены территории и экспортировать")]
        [MenuItem("Realm of Ashes/Авторинг/Сердцевина: пересобрать все сцены территории и экспортировать")]
        public static void RebuildTerritoryScenes()
        {
            RunMenu(() => RunTerritoryScenes(true));
        }

        /// <summary>
        /// Пакетный запуск: Unity.exe -batchmode -executeMethod
        /// Kromka.EditorTools.KromkaTerritoryAuthoring.RunFactionBasesBatch -quit
        /// (или RunTerritoryScenesBatch для всей территории).
        /// </summary>
        public static void RunFactionBasesBatch() { RunBatchStep(() => RunTerritoryScenes(false)); }
        public static void RunTerritoryScenesBatch() { RunBatchStep(() => RunTerritoryScenes(true)); }

        private static void RunMenu(Func<string> step)
        {
            try
            {
                Debug.Log("[KROMKA] " + step());
            }
            catch (Exception error)
            {
                // ExecuteMenuItem возвращает true даже при исключении, поэтому явная
                // строка отказа нужна тем, кто читает Logs/Editor.log через RoaAgentGate.
                Debug.LogError("[KROMKA] FAIL: пересборка сцен Сердцевины: " + error.Message);
                throw;
            }
        }

        private static void RunBatchStep(Func<string> step)
        {
            try
            {
                Debug.Log("[KROMKA] " + step());
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[KROMKA] FAIL: пересборка сцен Сердцевины: " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                throw;
            }
        }

        public static string RunFactionBases() { return RunTerritoryScenes(false); }

        public static string RunTerritoryScenes(bool wholeTerritory)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Пересборка сцен Сердцевины выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject territory = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/territory.json");
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            var ids = new System.Collections.Generic.List<string>();
            if (wholeTerritory) ids.Add(Text(territory, "zoneLocationId"));
            foreach (JObject faction in (territory["factions"] as JArray ?? new JArray()).OfType<JObject>())
                ids.Add(Text(faction, "baseLocationId"));
            if (wholeTerritory)
            {
                foreach (JObject lab in (territory["labs"] as JArray ?? new JArray()).OfType<JObject>())
                    ids.Add(Text(lab, "id"));
                foreach (JObject level in (territory["centralLab"]?["levels"] as JArray ?? new JArray()).OfType<JObject>())
                    ids.Add(Text(level, "id"));
            }
            ids = ids.Where(id => !string.IsNullOrEmpty(id)).Distinct(StringComparer.Ordinal).ToList();
            if (ids.Count == 0) throw new InvalidOperationException("В data/kromka/territory.json нет локаций Сердцевины.");
            var rows = ((JArray)catalog["locations"]).OfType<JObject>()
                .Where(row => ids.Contains(Text(row, "id")))
                .ToList();
            var missing = ids.Where(id => rows.All(row => Text(row, "id") != id)).ToList();
            if (missing.Count > 0)
                throw new InvalidOperationException("В data/kromka/locations.json нет локаций: " + string.Join(", ", missing));
            foreach (string id in ids)
            {
                if (string.IsNullOrEmpty(KromkaLocationSceneCatalog.ScenePath(id)))
                    throw new InvalidOperationException("Локация не входит в KromkaLocationSceneCatalog: " + id);
                string definitionPath = System.IO.Path.GetFullPath(System.IO.Path.Combine(
                    Application.dataPath, "../..", "data", "locations", id + ".json"));
                if (!System.IO.File.Exists(definitionPath))
                    throw new InvalidOperationException("Нет авторского определения data/locations/" + id + ".json");
            }

            Scene original = SceneManager.GetActiveScene();
            string originalPath = original.IsValid() ? original.path : string.Empty;
            // Отфильтрованный каталог идёт только в BuildLocations; ConfigureBuildSettings
            // не вызывается, чтобы не заменить список сцен несколькими записями.
            var filtered = new JObject { ["locations"] = new JArray(rows) };
            int built;
            try
            {
                built = KromkaWorldSceneBuilder.BuildLocations(filtered, true);
            }
            finally
            {
                AssetDatabase.SaveAssets();
                if (!string.IsNullOrWhiteSpace(originalPath)
                    && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                    EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);
                AssetDatabase.Refresh();
            }
            return "Сердцевина: пересобрано и экспортировано сцен " + built + " (" + string.Join(", ", ids) + ").";
        }

        /// <summary>
        /// Пакетный запуск: Unity.exe -batchmode -executeMethod
        /// Kromka.EditorTools.KromkaTerritoryAuthoring.RunBatch -quit.
        /// </summary>
        public static void RunBatch()
        {
            try
            {
                string report = Run();
                Debug.Log("[KROMKA] " + report);
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[KROMKA] Сердцевина: ошибка авторинга: " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                throw;
            }
        }

        public static string Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Авторинг Сердцевины выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            JObject seed = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/world-layout.seed.json");

            int addedNodes = AddMissingGlobalNodes(catalog, seed);
            int builtScenes = KromkaWorldSceneBuilder.BuildLocations(catalog, false);
            KromkaWorldSceneBuilder.ConfigureBuildSettings(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Scene global = EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
            KromkaWorldSceneExporter.ExportGlobalScene(global);
            if (global.isDirty) EditorSceneManager.SaveScene(global);
            return "Сердцевина: добавлено узлов " + addedNodes + ", создано сцен " + builtScenes
                + ", глобальная карта экспортирована.";
        }

        private static int AddMissingGlobalNodes(JObject catalog, JObject seed)
        {
            Scene scene = EditorSceneManager.OpenScene(GlobalScenePath, OpenSceneMode.Single);
            KromkaWorldAuthoring world = scene.GetRootGameObjects()
                .Select(root => root.GetComponentInChildren<KromkaWorldAuthoring>(true))
                .FirstOrDefault(component => component != null);
            if (world == null) throw new InvalidOperationException("Глобальная сцена без KromkaWorldAuthoring.");
            Transform locations = world.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(t => t.name == "Locations_EDITABLE");
            if (locations == null) throw new InvalidOperationException("Нет Locations_EDITABLE в глобальной сцене.");

            var existing = world.GetComponentsInChildren<KromkaWorldLocationAuthoring>(true)
                .Select(marker => marker.StableLocationId)
                .ToHashSet(StringComparer.Ordinal);
            var catalogById = ((JArray)catalog["locations"]).OfType<JObject>()
                .ToDictionary(row => Text(row, "id"), StringComparer.Ordinal);
            int added = 0;
            foreach (JObject position in (JArray)seed["locations"])
            {
                string id = Text(position, "id");
                if (existing.Contains(id)) continue;
                if (!catalogById.TryGetValue(id, out JObject location))
                    throw new InvalidOperationException("В seed есть узел без лора: " + id);
                GameObject marker = new GameObject("Location_" + id);
                marker.transform.SetParent(locations, false);
                marker.transform.localPosition = KromkaWorldSceneBuilder.PointToWorld(
                    Float(position, "x"), Float(position, "z"), 0.08f);
                string regionId = Text(location, "macroRegion");
                marker.AddComponent<KromkaWorldLocationAuthoring>().Configure(id,
                    KromkaWorldSceneBuilder.ParseRegion(regionId), Text(location, "unityScene"),
                    KromkaWorldSceneBuilder.DangerFor(seed, regionId), 2f);
                marker.AddComponent<RoaGlobalMapNodeAnchor>().Configure(id);
                KromkaWorldSceneBuilder.BuildMapLandmark(marker.transform, location);
                Undo.RegisterCreatedObjectUndo(marker, "Add territory node");
                added++;
            }
            if (added > 0)
            {
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
            return added;
        }

        private static string Text(JObject row, string key) => row?[key]?.Value<string>() ?? string.Empty;
        private static float Float(JObject row, string key) => row?[key]?.Value<float>() ?? 0f;
    }
}
