using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Сцены Сердцевины: генерирует недостающие локальные сцены территории,
    /// адресно пересобирает базы фракций и Рынок Ядра и экспортирует их в data.
    /// </summary>
    public static class KromkaTerritoryAuthoring
    {
        [MenuItem("Кромка/Авторинг/Сердцевина: создать недостающие сцены")]
        [MenuItem("Realm of Ashes/Авторинг/Сердцевина: создать недостающие сцены")]
        public static void AddTerritoryNodesAndScenes()
        {
            string report = Run();
            Debug.Log("[KROMKA] " + report);
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

        /// <summary>
        /// Рынок Ядра (экономика v3): собирает и экспортирует новую сцену хаба,
        /// дописывает в центральную сцену маркер спуска и добавляет хаб в Build Settings.
        /// Центральную сцену целиком не пересобираем: её data правились вручную,
        /// и полный экспорт потерял бы эти правки.
        /// Unity.exe -batchmode -executeMethod
        /// Kromka.EditorTools.KromkaTerritoryAuthoring.RunMarketHubBatch
        /// </summary>
        public static void RunMarketHubBatch() { RunBatchStep(RunMarketHub); }

        public static string RunMarketHub()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Сборка Рынка Ядра выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject territory = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/territory.json");
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            string hubId = Text(territory["marketHub"] as JObject ?? new JObject(), "id");
            string zoneId = Text(territory, "zoneLocationId");
            if (string.IsNullOrEmpty(hubId)) throw new InvalidOperationException("В territory.json нет marketHub.");
            JObject hubRow = ((JArray)catalog["locations"]).OfType<JObject>()
                .FirstOrDefault(row => Text(row, "id") == hubId);
            if (hubRow == null)
                throw new InvalidOperationException("В data/kromka/locations.json нет записи " + hubId + ".");
            // Id совпадает с build-kromka-territory-locations.js (zoneDefinition).
            var doorIds = new[] { "market_stairs" };
            Scene original = SceneManager.GetActiveScene();
            string originalPath = original.IsValid() ? original.path : string.Empty;
            int built, imported, exported;
            try
            {
                built = KromkaWorldSceneBuilder.BuildLocations(new JObject { ["locations"] = new JArray(hubRow) }, true);
                Scene zone = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(zoneId), OpenSceneMode.Single);
                imported = KromkaWorldSceneBuilder.ImportGameplayObjects(zone, zoneId, doorIds);
                if (imported > 0 && !EditorSceneManager.SaveScene(zone))
                    throw new InvalidOperationException("Не удалось сохранить сцену " + zoneId + ".");
                exported = KromkaWorldSceneExporter.ExportPlacedObjects(zone, doorIds);
                if (exported != doorIds.Length)
                    throw new InvalidOperationException("В сцене " + zoneId + " нет маркера спуска на рынок.");
                KromkaWorldSceneBuilder.ConfigureBuildSettings(catalog);
            }
            finally
            {
                AssetDatabase.SaveAssets();
                if (!string.IsNullOrWhiteSpace(originalPath)
                    && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                    EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);
                AssetDatabase.Refresh();
            }
            return "Рынок Ядра: собрано сцен " + built + " (" + hubId + "), в " + zoneId
                + " добавлено маркеров " + imported + ", экспортировано строк " + exported + ".";
        }

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
                ids.Add(Text(territory["marketHub"] as JObject ?? new JObject(), "id"));
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

            int builtScenes = KromkaWorldSceneBuilder.BuildLocations(catalog, false);
            KromkaWorldSceneBuilder.ConfigureBuildSettings(catalog);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            return "Сердцевина: создано сцен " + builtScenes + ".";
        }

        private static string Text(JObject row, string key) => row?[key]?.Value<string>() ?? string.Empty;
    }
}
