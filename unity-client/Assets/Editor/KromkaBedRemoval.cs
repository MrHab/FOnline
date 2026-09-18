using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Сна у NPC нет, личных коек тоже: удаляет койки и раскладушки из сцен
    /// локаций, не пересобирая и не экспортируя сцену целиком (строки в
    /// data/locations удаляются отдельно, точечно). Раскладушка раненого в
    /// обучении — реквизит шага обучения, она остаётся.
    /// Unity.exe -batchmode -executeMethod
    /// Kromka.EditorTools.KromkaBedRemoval.RunBatch -quit
    /// </summary>
    public static class KromkaBedRemoval
    {
        private static readonly string[] BedArchetypes = { "cotbed", "cot_bed", "bedroll" };
        private static readonly HashSet<string> Keep = new HashSet<string> { "yard_casualty_cot" };

        public static void RunBatch()
        {
            try
            {
                Debug.Log("[KROMKA] " + Run());
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[KROMKA] FAIL: удаление коек: " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                throw;
            }
        }

        public static string Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Удаление коек выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            var report = new List<string>();
            foreach (JObject row in ((JArray)catalog["locations"]).OfType<JObject>())
            {
                string id = row["id"]?.ToString() ?? string.Empty;
                string scenePath = KromkaLocationSceneCatalog.ScenePath(id);
                if (string.IsNullOrEmpty(id) || AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null) continue;
                string text = File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "..", scenePath)));
                if (!BedArchetypes.Any(model => text.IndexOf(model, StringComparison.OrdinalIgnoreCase) >= 0)) continue;

                Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var removed = new List<string>();
                var targets = new HashSet<GameObject>();
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    foreach (KromkaPlacedObjectAuthoring marker in root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                    {
                        if (marker == null || Keep.Contains(marker.StableObjectId) || !IsBed(marker)) continue;
                        GameObject target = PrefabUtility.GetOutermostPrefabInstanceRoot(marker.gameObject) ?? marker.gameObject;
                        if (targets.Add(target)) removed.Add(marker.StableObjectId);
                    }
                    // Декоративные раскладушки без разметки — по исходному префабу.
                    foreach (Transform child in root.GetComponentsInChildren<Transform>(true))
                    {
                        GameObject go = child.gameObject;
                        if (!PrefabUtility.IsOutermostPrefabInstanceRoot(go)) continue;
                        string path = AssetDatabase.GetAssetPath(PrefabUtility.GetCorrespondingObjectFromSource(go));
                        if (string.IsNullOrEmpty(path) || !BedArchetypes.Any(model => path.IndexOf(model, StringComparison.OrdinalIgnoreCase) >= 0)) continue;
                        KromkaPlacedObjectAuthoring marker = go.GetComponentInChildren<KromkaPlacedObjectAuthoring>(true);
                        if (marker != null && Keep.Contains(marker.StableObjectId)) continue;
                        if (targets.Add(go)) removed.Add(marker != null ? marker.StableObjectId : go.name);
                    }
                }
                foreach (GameObject target in targets)
                {
                    if (target != null) UnityEngine.Object.DestroyImmediate(target);
                }
                if (removed.Count == 0) continue;
                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new InvalidOperationException("Не удалось сохранить сцену " + scenePath + ".");
                report.Add(id + ": " + removed.Count);
            }
            AssetDatabase.SaveAssets();
            return report.Count == 0
                ? "Коек в сценах нет."
                : "Удалены койки — " + string.Join("; ", report) + ".";
        }

        private static bool IsBed(KromkaPlacedObjectAuthoring marker)
        {
            string model = (marker.ServerArchetypeId ?? string.Empty).ToLowerInvariant();
            if (BedArchetypes.Contains(model)) return true;
            return marker.GameplayTags != null && marker.GameplayTags.Any(tag =>
                string.Equals(tag, "personal-bed", StringComparison.OrdinalIgnoreCase)
                || string.Equals(tag, "bed", StringComparison.OrdinalIgnoreCase)
                || string.Equals(tag, "sleep", StringComparison.OrdinalIgnoreCase));
        }
    }
}
