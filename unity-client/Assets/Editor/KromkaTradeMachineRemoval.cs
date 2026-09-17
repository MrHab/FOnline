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
    /// Экономика v3: торговых автоматов в игре нет. Удаляет их маркеры из сцен
    /// локаций, не пересобирая и не экспортируя сцену целиком (строки в
    /// data/locations удаляются отдельно, точечно).
    /// Unity.exe -batchmode -executeMethod
    /// Kromka.EditorTools.KromkaTradeMachineRemoval.RunBatch -quit
    /// </summary>
    public static class KromkaTradeMachineRemoval
    {
        private static readonly string[] MachineModels = { "trade_machine", "trademachine", "vending_machine", "vendingmachine" };

        public static void RunBatch()
        {
            try
            {
                Debug.Log("[KROMKA] " + Run());
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[KROMKA] FAIL: удаление торговых автоматов: " + error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                throw;
            }
        }

        public static string Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Удаление автоматов выполняется только в Edit Mode.");
            KromkaWorldSceneBuilder.RefuseDirtyOpenScenes();
            JObject catalog = KromkaWorldSceneBuilder.ReadProjectJson("data/kromka/locations.json");
            var report = new List<string>();
            foreach (JObject row in ((JArray)catalog["locations"]).OfType<JObject>())
            {
                string id = row["id"]?.ToString() ?? string.Empty;
                string scenePath = KromkaLocationSceneCatalog.ScenePath(id);
                if (string.IsNullOrEmpty(id) || AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null) continue;
                string text = File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "..", scenePath)));
                if (!MachineModels.Any(model => text.IndexOf(model, StringComparison.OrdinalIgnoreCase) >= 0)) continue;

                Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var removed = new List<string>();
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    foreach (KromkaPlacedObjectAuthoring marker in root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                    {
                        if (marker == null || !IsMachine(marker)) continue;
                        removed.Add(marker.StableObjectId);
                        GameObject target = PrefabUtility.GetOutermostPrefabInstanceRoot(marker.gameObject) ?? marker.gameObject;
                        UnityEngine.Object.DestroyImmediate(target);
                    }
                }
                if (removed.Count == 0) continue;
                EditorSceneManager.MarkSceneDirty(scene);
                if (!EditorSceneManager.SaveScene(scene))
                    throw new InvalidOperationException("Не удалось сохранить сцену " + scenePath + ".");
                report.Add(id + ": " + string.Join(", ", removed));
            }
            AssetDatabase.SaveAssets();
            return report.Count == 0
                ? "Торговых автоматов в сценах нет."
                : "Удалены торговые автоматы — " + string.Join("; ", report) + ".";
        }

        private static bool IsMachine(KromkaPlacedObjectAuthoring marker)
        {
            string model = (marker.ServerArchetypeId ?? string.Empty).ToLowerInvariant();
            if (MachineModels.Contains(model)) return true;
            return marker.GameplayTags != null && marker.GameplayTags.Any(tag =>
                string.Equals(tag, "tradeMachine", StringComparison.OrdinalIgnoreCase)
                || string.Equals(tag, "vendingMachine", StringComparison.OrdinalIgnoreCase));
        }
    }
}
