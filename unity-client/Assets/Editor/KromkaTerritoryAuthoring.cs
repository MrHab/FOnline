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
