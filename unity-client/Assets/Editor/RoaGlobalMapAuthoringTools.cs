#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Designer workflow for the hand-authored global map.</summary>
    public static class RoaGlobalMapAuthoringTools
    {
        public const string ScenePath = "Assets/Scenes/GlobalMapAuthored.unity";
        private const float MapScale = 0.1f;

        [MenuItem("Realm of Ashes/Глобальная карта/Открыть авторскую сцену")]
        public static void OpenScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Selection.activeGameObject = FindMarker(SceneManager.GetActiveScene())?.gameObject;
        }

        [MenuItem("Realm of Ashes/Глобальная карта/Проверить авторскую сцену")]
        public static void ValidateScene()
        {
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            bool openedHere = !scene.IsValid() || !scene.isLoaded;
            if (openedHere) scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
            try
            {
                RoaUnityGlobalMapScene marker = FindMarker(scene);
                if (marker == null) throw new InvalidOperationException("RoaUnityGlobalMapScene не найден.");
                if (!marker.Validate(out string error)) throw new InvalidOperationException(error);

                JObject map = ReadMap();
                JArray nodes = map["nodes"] as JArray ?? new JArray();
                var missing = new List<string>();
                var moved = new List<string>();
                Grid(map, out float width, out float height);
                foreach (JToken token in nodes)
                {
                    string id = token?["id"]?.ToString() ?? string.Empty;
                    if (!marker.TryGetNode(id, out RoaGlobalMapNodeAnchor anchor))
                    {
                        missing.Add(id);
                        continue;
                    }
                    Vector2 authored = WorldToPoint(marker.transform, anchor.transform.position, width, height);
                    Vector2 server = new Vector2(Float(token?["x"]), Float(token?["y"]));
                    if (Vector2.Distance(authored, server) > 0.5f) moved.Add(id);
                }
                if (missing.Count > 0)
                    throw new InvalidOperationException("Нет узлов: " + string.Join(", ", missing));

                string note = moved.Count > 0
                    ? " Перемещены без экспорта: " + string.Join(", ", moved) + "."
                    : string.Empty;
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА] сцена корректна: узлы=" + marker.NodeCount
                          + ", prefab instances=" + CountPrefabInstances(scene) + "." + note, marker);
            }
            finally
            {
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
        }

        [MenuItem("Realm of Ashes/Глобальная карта/Экспортировать позиции поселений в data")]
        public static void ExportNodePositions()
        {
            if (!EditorUtility.DisplayDialog("Экспорт глобальной карты",
                    "Координаты RoaGlobalMapNodeAnchor будут записаны в data/global-map.json. "
                    + "Декор и префабы останутся только в Unity-сцене.",
                    "Экспортировать", "Отмена"))
                return;

            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            bool openedHere = !scene.IsValid() || !scene.isLoaded;
            if (openedHere) scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
            try
            {
                RoaUnityGlobalMapScene marker = FindMarker(scene)
                    ?? throw new InvalidOperationException("RoaUnityGlobalMapScene не найден.");
                JObject map = ReadMap();
                JArray nodes = map["nodes"] as JArray ?? throw new InvalidOperationException("nodes отсутствует");
                Grid(map, out float width, out float height);
                int exported = 0;
                foreach (JToken token in nodes)
                {
                    JObject node = token as JObject;
                    string id = node?["id"]?.ToString() ?? string.Empty;
                    if (node == null || !marker.TryGetNode(id, out RoaGlobalMapNodeAnchor anchor))
                        throw new InvalidOperationException("Не найден Unity-узел " + id);
                    Vector2 point = WorldToPoint(marker.transform, anchor.transform.position, width, height);
                    node["x"] = Math.Round(point.x, 2);
                    node["y"] = Math.Round(point.y, 2);
                    exported++;
                }

                string path = MapPath();
                File.WriteAllText(path, map.ToString(Formatting.Indented) + Environment.NewLine,
                                  new UTF8Encoding(false));
                AssetDatabase.Refresh();
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА] экспортировано поселений: " + exported + " → " + path, marker);
            }
            finally
            {
                if (openedHere && scene.IsValid() && scene.isLoaded)
                    EditorSceneManager.CloseScene(scene, true);
            }
        }

        private static RoaUnityGlobalMapScene FindMarker(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                RoaUnityGlobalMapScene marker = root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                if (marker != null) return marker;
            }
            return null;
        }

        private static int CountPrefabInstances(Scene scene)
        {
            var roots = new HashSet<GameObject>();
            foreach (GameObject root in scene.GetRootGameObjects())
            foreach (Transform transform in root.GetComponentsInChildren<Transform>(true))
            {
                GameObject nearest = PrefabUtility.GetNearestPrefabInstanceRoot(transform.gameObject);
                if (nearest != null) roots.Add(nearest);
            }
            return roots.Count;
        }

        private static JObject ReadMap()
        {
            return JObject.Parse(File.ReadAllText(MapPath()));
        }

        private static string MapPath()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/global-map.json"));
        }

        private static void Grid(JObject map, out float width, out float height)
        {
            JObject grid = map["grid"] as JObject ?? throw new InvalidOperationException("grid отсутствует");
            float cell = Float(grid["cellPoints"]);
            width = Float(grid["cols"]) * cell;
            height = Float(grid["rows"]) * cell;
        }

        private static Vector2 WorldToPoint(Transform mapRoot, Vector3 world, float width, float height)
        {
            Vector3 local = mapRoot != null ? mapRoot.InverseTransformPoint(world) : world;
            return new Vector2(Mathf.Clamp(local.x / MapScale + width * 0.5f, 0f, width),
                               Mathf.Clamp(height * 0.5f - local.z / MapScale, 0f, height));
        }

        private static float Float(JToken token)
        {
            return token != null && float.TryParse(token.ToString(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float value) ? value : 0f;
        }
    }
}
#endif
