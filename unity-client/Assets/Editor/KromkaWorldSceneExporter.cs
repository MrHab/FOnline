using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Kromka.Authoring;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Exports spatial edits from Unity scenes into the authoritative server data.
    /// Narrative data stays in JSON; positions, rotations, footprints, authored
    /// obstacles and anomaly centres come from Unity.
    /// </summary>
    public static class KromkaWorldSceneExporter
    {
        [MenuItem("Кромка/Авторинг/Экспортировать все сцены в data")]
        public static void ExportAllScenes()
        {
            RefuseDirtyOpenScenes();
            Scene original = SceneManager.GetActiveScene();
            string originalPath = original.IsValid() ? original.path : string.Empty;
            JObject catalog = ReadJson(ProjectPath("data/kromka/locations.json"));
            JArray locations = catalog["locations"] as JArray ?? new JArray();

            foreach (JObject row in locations.OfType<JObject>())
            {
                string id = Text(row, "id");
                string path = KromkaLocationSceneCatalog.ScenePath(id);
                if (AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null)
                    throw new FileNotFoundException("Не найдена Unity-сцена локации " + id, path);
                Scene scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
                ExportLocationScene(scene);
            }

            if (!string.IsNullOrWhiteSpace(originalPath)
                && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);

            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] PASS: пространственные данные " + locations.Count + " локаций экспортированы из Unity.");
        }

        [MenuItem("Кромка/Авторинг/Экспортировать открытую локацию в data")]
        public static void ExportOpenLocation()
        {
            Scene scene = SceneManager.GetActiveScene();
            KromkaLocationAuthoring location = FindComponent<KromkaLocationAuthoring>(scene);
            if (location == null)
            {
                EditorUtility.DisplayDialog("Экспорт Кромки",
                    "В активной сцене нет KromkaLocationAuthoring.", "Понятно");
                return;
            }

            if (scene.isDirty && !EditorSceneManager.SaveScene(scene)) return;
            ExportLocationScene(scene);
            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] Unity-размещение локации " + location.StableLocationId
                + " экспортировано в data.", location);
        }

        public static void ExportLocationScene(Scene scene)
        {
            KromkaLocationAuthoring authoring = FindComponent<KromkaLocationAuthoring>(scene);
            string error = authoring == null ? "нет KromkaLocationAuthoring" : null;
            if (authoring == null || !authoring.Validate(out error))
                throw new InvalidOperationException("Некорректная Unity-локация: " + error);

            string locationPath = ProjectPath("data/locations/"
                + authoring.StableLocationId + ".json");
            JObject definition = ReadJson(locationPath);
            JArray previous = definition["objects"] as JArray ?? new JArray();
            var previousById = previous.OfType<JObject>()
                .Where(row => !string.IsNullOrWhiteSpace(Text(row, "id")))
                .GroupBy(row => Text(row, "id"), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

            JArray exported = new JArray(previous.OfType<JObject>()
                .Where(IsLiveServerObject)
                .Select(row => row.DeepClone()));

            KromkaPlacedObjectAuthoring[] markers = authoring
                .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                .Where(marker => marker != null && marker.Role != "terrain")
                .OrderBy(marker => marker.StableObjectId, StringComparer.Ordinal)
                .ToArray();
            foreach (KromkaPlacedObjectAuthoring marker in markers)
            {
                if (string.IsNullOrWhiteSpace(marker.StableObjectId))
                    throw new InvalidOperationException("Объект без стабильного ID: " + marker.name);

                RoaUnityLocationObject bridge = marker.GetComponent<RoaUnityLocationObject>();
                if (bridge == null)
                {
                    bridge = marker.gameObject.AddComponent<RoaUnityLocationObject>();
                    bridge.Configure(marker.StableObjectId);
                    EditorUtility.SetDirty(marker.gameObject);
                    EditorSceneManager.MarkSceneDirty(scene);
                }
                else if (!string.Equals(bridge.ObjectId, marker.StableObjectId, StringComparison.Ordinal))
                {
                    bridge.Configure(marker.StableObjectId);
                    EditorUtility.SetDirty(bridge);
                    EditorSceneManager.MarkSceneDirty(scene);
                }

                previousById.TryGetValue(marker.StableObjectId, out JObject previousRow);
                exported.Add(ExportObject(marker, previousRow));
            }

            definition["schema"] = "realm.location.v1";
            definition["worldRevision"] = KromkaLocationAuthoring.CurrentWorldRevision;
            definition["runtimeMode"] = "unity-authored";
            definition["name"] = authoring.DisplayName;
            definition["macroRegion"] = RegionId(authoring.MacroRegion);
            definition["kromkaVisualProfile"] = authoring.VisualProfileId;
            definition["ambientProfile"] = authoring.AmbientProfileId;
            definition["anomalyDensity"] = authoring.AnomalyDensity;
            definition["unityScene"] = AssetPath(scene.path);
            definition["objects"] = exported;

            int width = definition["map"]?["width"]?.Value<int>() ?? 76;
            int depth = definition["map"]?["depth"]?.Value<int>() ?? 76;
            JObject arrival = ExportPoint(authoring.PlayerArrival, width, depth);
            definition["spawn"] = arrival.DeepClone();
            definition["respawn"] = arrival.DeepClone();
            definition["entry"] = arrival.DeepClone();
            definition["entryFromWorld"] = arrival.DeepClone();
            definition["entryFromWasteland"] = arrival.DeepClone();
            definition["migrationArrival"] = ExportPoint(authoring.MigrationArrival, width, depth);
            ExportDynamicSpawns(authoring, definition, exported, width, depth);

            WriteJson(locationPath, definition);
            ExportAnomalyLayout(authoring);
            if (scene.isDirty) EditorSceneManager.SaveScene(scene);
        }

        /// <summary>
        /// Адресный экспорт: переписывает в data только строки перечисленных
        /// маркеров; остальные объекты, точки и заголовок определения не трогает.
        /// Файл пишется, только если строка изменилась. Возвращает число
        /// найденных маркеров.
        /// </summary>
        public static int ExportPlacedObjects(Scene scene, ICollection<string> objectIds)
        {
            KromkaLocationAuthoring authoring = FindComponent<KromkaLocationAuthoring>(scene);
            if (authoring == null)
                throw new InvalidOperationException("Некорректная Unity-локация: нет KromkaLocationAuthoring");
            string locationPath = ProjectPath("data/locations/"
                + authoring.StableLocationId + ".json");
            JObject definition = ReadJson(locationPath);
            JArray objects = definition["objects"] as JArray ?? new JArray();
            int found = 0;
            bool changed = false;
            foreach (KromkaPlacedObjectAuthoring marker in authoring
                         .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                         .Where(marker => marker != null && objectIds.Contains(marker.StableObjectId)))
            {
                JObject previous = objects.OfType<JObject>()
                    .FirstOrDefault(row => Text(row, "id") == marker.StableObjectId);
                JObject row = ExportObject(marker, previous);
                found++;
                // Сравнение текстом: DeepEquals различает 8 и 8.0 после чтения JSON.
                if (previous != null && previous.ToString(Formatting.None) == row.ToString(Formatting.None)) continue;
                if (previous != null) previous.Replace(row);
                else objects.Add(row);
                changed = true;
            }
            if (!changed) return found;
            definition["objects"] = objects;
            WriteJson(locationPath, definition);
            return found;
        }

        private static JObject ExportObject(KromkaPlacedObjectAuthoring marker, JObject previous)
        {
            JObject row = previous != null ? (JObject)previous.DeepClone() : new JObject();
            Transform transform = marker.transform;
            Vector3 euler = transform.eulerAngles * Mathf.Deg2Rad;
            Bounds bounds = BoundsFor(marker.gameObject);

            row["id"] = marker.StableObjectId;
            if (!string.IsNullOrWhiteSpace(marker.ServerArchetypeId))
                row["model"] = marker.ServerArchetypeId;
            if (row["name"] == null) row["name"] = HumanName(marker.name);
            row["position"] = Vector(transform.position);
            row["rotation"] = Vector(euler);
            row["scale"] = Vector(transform.lossyScale);
            row["collision"] = marker.BlocksMovement ? "solid" : "none";
            row["role"] = marker.Role;
            row["tags"] = new JArray(marker.GameplayTags);
            if (marker.GameplayTags.Contains("resource") && row["maxHp"] == null)
            {
                row["hp"] = 1200;
                row["maxHp"] = 1200;
            }
            row["footprint"] = new JObject
            {
                ["x"] = Round(Mathf.Max(0.2f, bounds.size.x)),
                ["z"] = Round(Mathf.Max(0.2f, bounds.size.z))
            };
            row["vision"] = new JObject { ["blocks"] = marker.BlocksVision };
            row["unityAuthored"] = true;
            row["worldRevision"] = KromkaLocationAuthoring.CurrentWorldRevision;
            row.Remove("placement");
            return row;
        }

        private static void ExportAnomalyLayout(KromkaLocationAuthoring authoring)
        {
            string path = ProjectPath("data/kromka/locations.json");
            JObject catalog = ReadJson(path);
            JObject location = (catalog["locations"] as JArray)?.OfType<JObject>()
                .FirstOrDefault(row => Text(row, "id") == authoring.StableLocationId);
            if (location == null) return;

            KromkaAnomalyAuthoring[] fields = authoring
                .GetComponentsInChildren<KromkaAnomalyAuthoring>(true)
                .OrderBy(field => field.StableAnomalyId, StringComparer.Ordinal)
                .ToArray();
            if (fields.Length == 0)
            {
                location.Remove("anomalyFields");
            }
            else
            {
                location["anomalyFields"] = new JArray(fields.Select(field => new JObject
                {
                    ["id"] = field.StableAnomalyId,
                    ["type"] = field.AnomalyTypeId,
                    ["x"] = Round(field.transform.position.x),
                    ["z"] = Round(field.transform.position.z),
                    ["radius"] = Round(field.Radius),
                    ["dischargeMs"] = field.DischargeMilliseconds,
                    ["training"] = field.TrainingField,
                    ["placement"] = "unity-authored"
                }));
            }
            WriteJson(path, catalog);
        }

        private static void ExportDynamicSpawns(KromkaLocationAuthoring authoring,
                                                JObject definition, JArray exported,
                                                int width, int depth)
        {
            KromkaSpawnAuthoring[] spawns = authoring
                .GetComponentsInChildren<KromkaSpawnAuthoring>(true)
                .Where(spawn => spawn != null)
                .OrderBy(spawn => spawn.SpawnId, StringComparer.Ordinal)
                .ToArray();
            JArray exportedAnchors = new JArray();
            foreach (KromkaSpawnAuthoring spawn in spawns)
            {
                JObject point = ExportPoint(spawn.transform, width, depth);
                exportedAnchors.Add(new JObject
                {
                    ["id"] = spawn.SpawnId,
                    ["kind"] = spawn.Kind.ToString(),
                    ["targetLocationId"] = spawn.TargetLocationId,
                    ["radius"] = Round(spawn.Radius),
                    ["position"] = Vector(spawn.transform.position),
                    ["rotationY"] = point["rotationY"]?.DeepClone()
                });

                if (spawn.Kind == KromkaSpawnKind.Npc || spawn.Kind == KromkaSpawnKind.Enemy
                    || spawn.Kind == KromkaSpawnKind.Encounter)
                {
                    JObject actor = exported.OfType<JObject>()
                        .FirstOrDefault(row => Text(row, "id") == spawn.SpawnId);
                    if (actor == null) continue;
                    actor["position"] = Vector(spawn.transform.position);
                    actor["rotation"] = new JObject
                    {
                        ["x"] = 0f,
                        ["y"] = point["rotationY"]?.DeepClone(),
                        ["z"] = 0f
                    };
                    actor["unityAuthored"] = true;
                    actor["worldRevision"] = KromkaLocationAuthoring.CurrentWorldRevision;
                }
                else if (spawn.Kind == KromkaSpawnKind.Exit)
                {
                    JObject current = definition["exit"] as JObject ?? new JObject();
                    current.Merge(point, new JsonMergeSettings
                    {
                        MergeArrayHandling = MergeArrayHandling.Replace,
                        MergeNullValueHandling = MergeNullValueHandling.Ignore
                    });
                    if (!string.IsNullOrWhiteSpace(spawn.TargetLocationId))
                        current["to"] = spawn.TargetLocationId;
                    if (current["label"] == null) current["label"] = "Выход";
                    definition["exit"] = current;
                }
            }
            definition["unitySpawns"] = exportedAnchors;
        }

        private static JObject ExportPoint(Transform point, int width, int depth)
        {
            Vector3 position = point != null ? point.position : Vector3.zero;
            return new JObject
            {
                ["tx"] = Mathf.Clamp(Mathf.FloorToInt((position.x + width * 0.5f) * 0.5f), 0, width / 2 - 1),
                ["tz"] = Mathf.Clamp(Mathf.FloorToInt((position.z + depth * 0.5f) * 0.5f), 0, depth / 2 - 1),
                ["x"] = Round(position.x),
                ["y"] = Round(position.y),
                ["z"] = Round(position.z),
                ["rotationY"] = Round(point != null ? point.eulerAngles.y * Mathf.Deg2Rad : 0f)
            };
        }

        private static bool IsLiveServerObject(JObject row)
        {
            string kind = row?["entity"]?["kind"]?.Value<string>() ?? string.Empty;
            if (kind == "npc" || kind == "enemy" || kind == "creature" || kind == "player")
                return true;
            return row?["tags"] is JArray tags && tags.Values<string>()
                .Any(tag => tag == "npc" || tag == "living" || tag == "hostile" || tag == "mutant");
        }

        private static Bounds BoundsFor(GameObject root)
        {
            Collider[] colliders = root.GetComponentsInChildren<Collider>(true);
            if (colliders.Length > 0)
            {
                Bounds result = colliders[0].bounds;
                for (int i = 1; i < colliders.Length; i++) result.Encapsulate(colliders[i].bounds);
                return result;
            }
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length > 0)
            {
                Bounds result = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) result.Encapsulate(renderers[i].bounds);
                return result;
            }
            return new Bounds(root.transform.position, new Vector3(0.2f, 0.2f, 0.2f));
        }

        private static JObject Vector(Vector3 value)
        {
            return new JObject
            {
                ["x"] = Round(value.x),
                ["y"] = Round(value.y),
                ["z"] = Round(value.z)
            };
        }

        private static float Round(float value) => (float)Math.Round(value, 3);

        private static string AssetPath(string path)
        {
            return string.IsNullOrWhiteSpace(path) ? string.Empty : path.Replace('\\', '/');
        }

        private static string HumanName(string name)
        {
            return (name ?? string.Empty).Replace('_', ' ').Trim();
        }

        private static string Text(JObject row, string key)
        {
            return row?[key]?.Value<string>() ?? string.Empty;
        }

        private static T FindComponent<T>(Scene scene) where T : Component
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                T component = root.GetComponentInChildren<T>(true);
                if (component != null) return component;
            }
            return null;
        }

        private static JObject ReadJson(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("Не найден JSON Кромки", path);
            return JObject.Parse(File.ReadAllText(path, Encoding.UTF8));
        }

        private static void WriteJson(string path, JObject value)
        {
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(path, value.ToString(Formatting.Indented) + Environment.NewLine,
                new UTF8Encoding(false));
        }

        private static string ProjectPath(string relativePath)
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            return Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
        }

        private static string RegionId(KromkaMacroRegion value)
        {
            switch (value)
            {
                case KromkaMacroRegion.NorthernSluices: return "northern_sluices";
                case KromkaMacroRegion.MiddleVein: return "middle_vein";
                case KromkaMacroRegion.OreArc: return "ore_arc";
                case KromkaMacroRegion.TractIsthmus: return "tract_isthmus";
                case KromkaMacroRegion.ChalkLowland: return "chalk_lowland";
                case KromkaMacroRegion.Glasslands: return "glasslands";
                case KromkaMacroRegion.ZeroBasin: return "zero_basin";
                case KromkaMacroRegion.SilentRing: return "silent_ring";
                case KromkaMacroRegion.OffMap: return "off_map";
                default: return "regional";
            }
        }

        private static void RefuseDirtyOpenScenes()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (scene.IsValid() && scene.isDirty)
                    throw new InvalidOperationException("Сначала сохраните открытую сцену: " + scene.path);
            }
        }
    }
}
