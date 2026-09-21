#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Убирает из сцен Кромки станки, которых больше нет в данных: крафт переехал
    /// на участки города, и станок ставит игрок. Сцена — источник геометрии, и
    /// пока эти объекты в ней стоят, полный экспорт вернул бы их на сервер.
    /// Меню: Кромка → Убрать станки из сцен.
    /// </summary>
    public static class KromkaRetiredStationSweeper
    {
        private const string ScenesRoot = "Assets/Scenes/Kromka";

        [MenuItem("Кромка/Убрать станки из сцен")]
        public static void Run()
        {
            // Станки остаются только на учебном дворе: там игрок впервые чинит вещь.
            var keepScenes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "tutorialCaravanYard" };
            var removed = new List<string>();
            foreach (string guid in AssetDatabase.FindAssets("t:Scene", new[] { ScenesRoot }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                string locationId = Path.GetFileNameWithoutExtension(path);
                if (keepScenes.Contains(locationId)) continue;

                Scene scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
                var doomed = scene.GetRootGameObjects()
                    .SelectMany(root => root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                    .Where(IsCraftingStation)
                    .ToList();
                if (doomed.Count == 0) continue;
                foreach (KromkaPlacedObjectAuthoring marker in doomed)
                {
                    removed.Add(locationId + ": " + marker.StableObjectId);
                    UnityEngine.Object.DestroyImmediate(marker.gameObject);
                }
                EditorSceneManager.MarkSceneDirty(scene);
                EditorSceneManager.SaveScene(scene);
            }
            AssetDatabase.SaveAssets();
            Debug.Log(removed.Count == 0
                ? "[STATIONS] Сцены уже без станков."
                : "[STATIONS] Из сцен убрано станков: " + removed.Count + "\n" + string.Join("\n", removed));
        }

        /// <summary>Станок узнаётся так же, как его узнавал экспорт: по тегу.</summary>
        private static bool IsCraftingStation(KromkaPlacedObjectAuthoring marker)
        {
            if (marker == null) return false;
            IReadOnlyList<string> tags = marker.GameplayTags ?? (IReadOnlyList<string>)Array.Empty<string>();
            return tags.Any(tag => string.Equals(tag, "crafting-station", StringComparison.OrdinalIgnoreCase));
        }
    }
}
#endif
