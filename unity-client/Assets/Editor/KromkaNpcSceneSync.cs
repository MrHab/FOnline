#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Расставляет дружелюбных НПС локаций по их сценам префабом KromkaNpc:
    /// торговцев, службы (аукцион, медик, ремонт, регистратор, лаборатория),
    /// квестодателей и охрану баз. Монстры и рейдеры остаются точками появления
    /// врагов. Старый невидимый якорь НПС заменяется префабом на его же месте —
    /// сцена главнее данных; НПС без якоря встаёт туда, где его держат данные.
    ///
    /// Дальше НПС двигают и поворачивают руками, облик меняют в инспекторе, а
    /// обычный экспорт сцены пишет позицию, поворот и облик в его строку.
    /// Меню: Кромка → НПС.
    /// </summary>
    public static class KromkaNpcSceneSync
    {
        internal const string PrefabPath = "Assets/Prefabs/Kromka/KromkaNpc.prefab";
        private const string NpcRootName = "Npcs_EDITABLE";

        [MenuItem("Кромка/НПС/Расставить НПС во всех сценах")]
        public static void RunAll()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            int placed = SyncAll(null);
            EditorUtility.DisplayDialog("НПС в сценах", "Расставлено и обновлено НПС: " + placed, "Ладно");
        }

        [MenuItem("Кромка/НПС/Расставить НПС в открытой сцене")]
        public static void RunOpen()
        {
            Scene scene = SceneManager.GetActiveScene();
            KromkaLocationAuthoring authoring = FindAuthoring(scene);
            if (authoring == null)
            {
                EditorUtility.DisplayDialog("НПС в сцене", "В открытой сцене нет объекта локации.", "Ладно");
                return;
            }
            JObject definition = ReadDefinition(authoring.StableLocationId);
            int placed = definition == null ? 0 : SyncScene(scene, definition);
            EditorUtility.DisplayDialog("НПС в сцене", authoring.StableLocationId + ": НПС " + placed, "Ладно");
        }

        /// <summary>
        /// Из консоли: `-executeMethod RealmOfAshes.EditorTools.KromkaNpcSceneSync.RunBatch`,
        /// локации — из ROA_SCENES через запятую, иначе все, где есть НПС.
        /// ROA_NPC_POSE=data ставит уже расставленных НПС на место и поворот из
        /// данных — для починки данных; ручные правки сцены при этом теряются.
        /// </summary>
        public static void RunBatch()
        {
            string list = Environment.GetEnvironmentVariable("ROA_SCENES");
            HashSet<string> only = string.IsNullOrWhiteSpace(list)
                ? null
                : new HashSet<string>(list.Split(',').Select(row => row.Trim()), StringComparer.Ordinal);
            bool poseFromData = Environment.GetEnvironmentVariable("ROA_NPC_POSE") == "data";
            int placed = SyncAll(only, poseFromData);
            Debug.Log("[НПС] готово: в сценах НПС " + placed + (poseFromData ? " (поза из данных)" : string.Empty));
        }

        private static int SyncAll(HashSet<string> only, bool poseFromData = false)
        {
            GameObject prefab = EnsurePrefab();
            if (prefab == null) return 0;
            int placed = 0;
            string folder = ProjectPath("data/locations");
            foreach (string file in Directory.GetFiles(folder, "*.json").OrderBy(row => row, StringComparer.Ordinal))
            {
                JObject definition = JObject.Parse(File.ReadAllText(file));
                string id = definition["id"]?.ToString() ?? Path.GetFileNameWithoutExtension(file);
                if (only != null && !only.Contains(id)) continue;
                if (!FriendlyNpcs(definition).Any()) continue;
                string scenePath = KromkaLocationSceneCatalog.ScenePath(id);
                if (scenePath == null || AssetDatabase.LoadAssetAtPath<SceneAsset>(scenePath) == null) continue;
                Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                placed += SyncScene(scene, definition, poseFromData);
            }
            return placed;
        }

        /// <summary>НПС одной сцены по её определению. Возвращает, сколько их в сцене.</summary>
        internal static int SyncScene(Scene scene, JObject definition, bool poseFromData = false)
        {
            GameObject prefab = EnsurePrefab();
            KromkaLocationAuthoring authoring = FindAuthoring(scene);
            if (prefab == null || authoring == null) return 0;
            Transform anchors = authoring.DynamicAnchorsRoot != null ? authoring.DynamicAnchorsRoot : authoring.transform;
            Transform parent = anchors.Find(NpcRootName);
            if (parent == null)
            {
                parent = new GameObject(NpcRootName).transform;
                parent.SetParent(anchors, false);
            }

            var anchorsById = new Dictionary<string, KromkaSpawnAuthoring>(StringComparer.Ordinal);
            foreach (KromkaSpawnAuthoring spawn in authoring.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
                if (spawn.Kind == KromkaSpawnKind.Npc && !anchorsById.ContainsKey(spawn.SpawnId))
                    anchorsById[spawn.SpawnId] = spawn;

            int count = 0;
            var wanted = new HashSet<string>(StringComparer.Ordinal);
            foreach (JObject row in FriendlyNpcs(definition))
            {
                string id = row["id"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(id)) continue;
                wanted.Add(id);
                anchorsById.TryGetValue(id, out KromkaSpawnAuthoring spawn);
                KromkaNpcAuthoring npc = spawn != null ? spawn.GetComponent<KromkaNpcAuthoring>() : null;
                if (npc == null)
                {
                    // Сцена главнее данных: старый якорь уже стоит там, куда
                    // НПС поставили руками, и префаб встаёт на его место.
                    Vector3 position = spawn != null ? spawn.transform.position : Vector(row["position"]);
                    Quaternion rotation = spawn != null
                        ? spawn.transform.rotation
                        : Quaternion.Euler(0f, (row["rotation"]?["y"]?.ToObject<float>() ?? 0f) * Mathf.Rad2Deg, 0f);
                    var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
                    instance.transform.SetPositionAndRotation(position, rotation);
                    KromkaSpawnAuthoring own = instance.GetComponent<KromkaSpawnAuthoring>();
                    own.Configure(id, KromkaSpawnKind.Npc, string.Empty, 0.5f);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(own);
                    if (spawn != null) RetireAnchor(spawn);
                    npc = instance.GetComponent<KromkaNpcAuthoring>();
                }
                else if (poseFromData)
                {
                    npc.transform.SetPositionAndRotation(Vector(row["position"]),
                        Quaternion.Euler(0f, (row["rotation"]?["y"]?.ToObject<float>() ?? 0f) * Mathf.Rad2Deg, 0f));
                }

                GameObject root = npc.gameObject;
                string name = row["name"]?.ToString();
                root.name = string.IsNullOrWhiteSpace(name) ? id : name;
                JObject entity = row["entity"] as JObject ?? new JObject();
                npc.ConfigureIdentity(name, Text(entity, "role"), Text(entity, "service"), Text(entity, "faction"),
                    (entity["quests"] as JArray)?.Select(quest => quest.ToString()).ToArray() ?? Array.Empty<string>());
                if (entity["appearance"] is JObject appearance)
                {
                    npc.ConfigureAppearance(Text(appearance, "sex"), Text(appearance, "bodyType"),
                        Text(appearance, "faceId"), Text(appearance, "hairId"), Text(appearance, "hairColorId"));
                }
                if (entity["equipment"] is JObject equipment)
                {
                    npc.ConfigureEquipment(Text(equipment, "weapon"), Text(equipment, "armor"),
                        Text(equipment, "helmet"), Text(equipment, "boots"), Text(equipment, "backpack"));
                }
                PrefabUtility.RecordPrefabInstancePropertyModifications(npc);
                PrefabUtility.RecordPrefabInstancePropertyModifications(root);
                PrefabUtility.RecordPrefabInstancePropertyModifications(root.transform);
                count++;
            }

            // НПС в сцене без строки в данных — его убрали из данных или
            // скопировали руками. Сами не удаляем: сначала решает человек.
            foreach (KromkaNpcAuthoring stray in authoring.GetComponentsInChildren<KromkaNpcAuthoring>(true)
                         .Where(npc => !wanted.Contains(npc.NpcId)))
                Debug.LogWarning("[НПС] " + authoring.StableLocationId + ": в сцене есть НПС «" + stray.name
                    + "» (" + stray.NpcId + "), которого нет в данных — экспорт его не запишет.", stray);

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            return count;
        }

        /// <summary>Дружелюбные НПС: те, с кем говорят, торгуют и берут работу.</summary>
        private static IEnumerable<JObject> FriendlyNpcs(JObject definition)
        {
            foreach (JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                if (row["entity"] is not JObject entity || Text(entity, "kind") != "npc") continue;
                if (entity["hostileToPlayer"]?.Type == JTokenType.Boolean && entity["hostileToPlayer"].Value<bool>()) continue;
                string role = Text(entity, "role");
                if (role == "monster" || role == "raider") continue;
                yield return row;
            }
        }

        /// <summary>Старый якорь уходит; если на его объекте есть что-то ещё — только сам якорь.</summary>
        private static void RetireAnchor(KromkaSpawnAuthoring spawn)
        {
            GameObject owner = spawn.gameObject;
            bool bare = owner.transform.childCount == 0
                && owner.GetComponents<Component>().All(component => component is Transform || component == spawn);
            if (bare) UnityEngine.Object.DestroyImmediate(owner);
            else UnityEngine.Object.DestroyImmediate(spawn);
        }

        /// <summary>Префаб НПС: якорь для экспорта, сведения и облик. EditorOnly — в сборку не идёт.</summary>
        internal static GameObject EnsurePrefab()
        {
            GameObject existing = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (existing != null) return existing;
            Directory.CreateDirectory(Path.GetDirectoryName(ProjectPath("unity-client/" + PrefabPath)));
            var root = new GameObject("KromkaNpc") { tag = "EditorOnly" };
            root.AddComponent<KromkaSpawnAuthoring>().Configure(string.Empty, KromkaSpawnKind.Npc, string.Empty, 0.5f);
            root.AddComponent<KromkaNpcAuthoring>();
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
            UnityEngine.Object.DestroyImmediate(root);
            return prefab;
        }

        private static KromkaLocationAuthoring FindAuthoring(Scene scene)
        {
            return scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaLocationAuthoring>(true))
                .FirstOrDefault();
        }

        private static JObject ReadDefinition(string locationId)
        {
            string file = ProjectPath("data/locations/" + locationId + ".json");
            return File.Exists(file) ? JObject.Parse(File.ReadAllText(file)) : null;
        }

        private static string ProjectPath(string relative)
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", relative));
        }

        private static string Text(JObject row, string key)
        {
            return row?[key]?.ToString() ?? string.Empty;
        }

        private static Vector3 Vector(JToken point)
        {
            if (point == null) return Vector3.zero;
            return new Vector3(point["x"]?.ToObject<float>() ?? 0f, point["y"]?.ToObject<float>() ?? 0f,
                point["z"]?.ToObject<float>() ?? 0f);
        }
    }
}
#endif
