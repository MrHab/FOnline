#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Раскладывает город в его сцену: то, что конструктор собирал на лету,
    /// становится обычными объектами Unity, и дальше город правят руками.
    ///
    /// Работает только с городом, разложенным в авторскую локацию
    /// (`node tools/bake-city-scene.js &lt;город&gt;` ставит `cityAuthored`), иначе
    /// правки стёр бы следующий запуск конструктора. Живых NPC сцена не
    /// содержит — их ставит сервер, как и в остальных локациях.
    ///
    /// Обратный путь обычный: «Кромка → Экспорт сцен» пишет правки в тот же
    /// файл локации, сохраняя метаданные строк (службы, торги, квесты).
    /// </summary>
    public static class KromkaCitySceneBuilder
    {
        private const string ScenesRoot = "Assets/Scenes/Kromka/Locations";
        private const string CityRoot = "CityLayout";

        [MenuItem("Кромка/Собрать город в сцену")]
        public static void Run()
        {
            string locationId = Path.GetFileNameWithoutExtension(EditorSceneManager.GetActiveScene().path);
            if (string.IsNullOrEmpty(locationId))
            {
                EditorUtility.DisplayDialog("Город в сцену", "Откройте сцену города — она и будет заполнена.", "Ладно");
                return;
            }
            Build(locationId, true);
        }

        /// <summary>
        /// Из консоли: `-executeMethod RealmOfAshes.EditorTools.KromkaCitySceneBuilder.RunBatch`.
        /// Город берётся из ROA_CITY, иначе раскладываются все, уже помеченные
        /// авторскими.
        /// </summary>
        public static void RunBatch()
        {
            string single = Environment.GetEnvironmentVariable("ROA_CITY");
            IEnumerable<string> cities = !string.IsNullOrWhiteSpace(single)
                ? new[] { single.Trim() }
                : AuthoredCities();
            int total = 0;
            foreach (string city in cities) total += Build(city, false);
            Debug.Log("[ГОРОД] готово: поставлено объектов " + total);
        }

        /// <summary>Города, уже разложенные в авторские локации.</summary>
        private static IEnumerable<string> AuthoredCities()
        {
            string folder = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "locations"));
            foreach (string file in Directory.GetFiles(folder, "*.json").OrderBy(row => row, StringComparer.Ordinal))
            {
                if (file.EndsWith(".authored-backup.json", StringComparison.Ordinal)) continue;
                string text = File.ReadAllText(file);
                if (!text.Contains("\"cityAuthored\": true")) continue;
                yield return Path.GetFileNameWithoutExtension(file);
            }
        }

        /// <summary>Разложить город в его сцену. Возвращает число поставленных объектов.</summary>
        public static int Build(string locationId, bool interactive)
        {
            string file = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "locations", locationId + ".json"));
            if (!File.Exists(file)) throw new InvalidOperationException("Нет файла локации: " + file);
            JObject definition = JObject.Parse(File.ReadAllText(file));
            if (definition["cityAuthored"]?.ToObject<bool>() != true)
            {
                string message = locationId + " ещё строится конструктором: правки в сцене стёр бы следующий запуск.\n\n"
                    + "Сначала выполните:  node tools/bake-city-scene.js " + locationId;
                if (interactive) EditorUtility.DisplayDialog("Город в сцену", message, "Ладно");
                else Debug.LogWarning("[ГОРОД] " + message);
                return 0;
            }

            string scenePath = ScenesRoot + "/" + locationId + ".unity";
            Scene scene = EditorSceneManager.GetActiveScene().path == scenePath
                ? EditorSceneManager.GetActiveScene()
                : EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);

            RoaZoneKitCatalog kit = Resources.Load<RoaZoneKitCatalog>(RoaZoneKitCatalog.ResourcePath);
            if (kit == null) throw new InvalidOperationException("Набор префабов зон не найден: " + RoaZoneKitCatalog.ResourcePath);

            // Старую застройку снимаем целиком: город приходит из данных, а
            // свет, земля и камеры сцены остаются на месте.
            foreach (KromkaPlacedObjectAuthoring marker in scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                .ToList())
            {
                UnityEngine.Object.DestroyImmediate(marker.gameObject);
            }
            GameObject previousRoot = scene.GetRootGameObjects().FirstOrDefault(row => row.name == CityRoot);
            if (previousRoot != null) UnityEngine.Object.DestroyImmediate(previousRoot);

            KromkaLocationAuthoring authoring = scene.GetRootGameObjects()
                .SelectMany(item => item.GetComponentsInChildren<KromkaLocationAuthoring>(true))
                .FirstOrDefault();
            if (authoring == null)
                throw new InvalidOperationException("В сцене нет объекта локации (KromkaLocationAuthoring): экспорт не увидит город.");
            var root = new GameObject(CityRoot);
            root.transform.SetParent(authoring.transform, false);
            int placed = 0;
            var missing = new SortedSet<string>(StringComparer.Ordinal);
            foreach (JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                // Живых актёров ставит сервер: в сцене их нет и быть не должно.
                if (IsLiveActor(row)) continue;
                GameObject prefab = PrefabFor(kit, row, missing);
                if (prefab == null) continue;
                GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.transform);
                PrefabUtility.UnpackPrefabInstance(instance, PrefabUnpackMode.Completely,
                                                   InteractionMode.AutomatedAction);
                instance.name = Text(row, "id");
                instance.transform.position = Vector(row["position"]);
                Vector3 radians = Vector(row["rotation"]);
                instance.transform.rotation = Quaternion.Euler(radians * Mathf.Rad2Deg);
                Vector3 scale = Vector(row["scale"]);
                instance.transform.localScale = scale == Vector3.zero ? Vector3.one : scale;
                Configure(instance, row);
                AddCollision(instance, row);
                placed++;
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            string note = locationId + ": в сцену поставлено " + placed + " объектов города"
                + (missing.Count > 0 ? "; без префаба остались: " + string.Join(", ", missing) : string.Empty);
            Debug.Log("[ГОРОД] " + note);
            if (interactive) EditorUtility.DisplayDialog("Город в сцену", note, "Ладно");
            return placed;
        }

        /// <summary>
        /// Преграда объекта в сцене. Префабы набора несут только вид: в игре
        /// коллизию строит сборщик из collisionParts, а сцене нужны настоящие
        /// коллайдеры — по ним экспорт и соберёт те же части обратно.
        /// </summary>
        private static void AddCollision(GameObject instance, JObject row)
        {
            if (Text(row, "collision") != "solid") return;
            if (instance.GetComponentInChildren<Collider>(true) != null) return;
            var parts = row["collisionParts"] as JArray;
            if (parts == null || parts.Count == 0) return;
            Vector3 scale = instance.transform.lossyScale;
            int index = 0;
            foreach (JObject part in parts.OfType<JObject>())
            {
                float width = part["size"]?["x"]?.ToObject<float>() ?? 0f;
                float depth = part["size"]?["z"]?.ToObject<float>() ?? 0f;
                float height = part["height"]?.ToObject<float>() ?? 0f;
                if (width <= 0f || depth <= 0f || height <= 0f) continue;
                var node = new GameObject("Collision" + (++index));
                node.transform.SetParent(instance.transform, false);
                node.transform.localPosition = new Vector3(
                    (part["center"]?["x"]?.ToObject<float>() ?? 0f) / Safe(scale.x),
                    height * 0.5f / Safe(scale.y),
                    (part["center"]?["z"]?.ToObject<float>() ?? 0f) / Safe(scale.z));
                node.transform.localRotation = Quaternion.Euler(0f,
                    (part["rotationY"]?.ToObject<float>() ?? 0f) * Mathf.Rad2Deg, 0f);
                var box = node.AddComponent<BoxCollider>();
                box.size = new Vector3(width / Safe(scale.x), height / Safe(scale.y), depth / Safe(scale.z));
            }
        }

        private static float Safe(float value)
        {
            return Mathf.Abs(value) < 0.0001f ? 1f : value;
        }

        private static bool IsLiveActor(JObject row)
        {
            string kind = row?["entity"]?["kind"]?.ToString() ?? string.Empty;
            if (kind == "npc" || kind == "enemy" || kind == "creature" || kind == "player") return true;
            return Tags(row).Any(tag => tag == "npc" || tag == "living" || tag == "hostile" || tag == "mutant");
        }

        /// <summary>Префаб строки: ключ набора зон, иначе модель локации.</summary>
        private static GameObject PrefabFor(RoaZoneKitCatalog kit, JObject row, SortedSet<string> missing)
        {
            string key = Text(row, "prefab");
            if (!string.IsNullOrEmpty(key))
            {
                GameObject fromKit = kit.Find(key);
                if (fromKit != null) return fromKit;
                missing.Add(key);
                return null;
            }
            string model = Text(row, "model");
            GameObject byModel = string.IsNullOrEmpty(model)
                ? null
                : Resources.Load<GameObject>("RealmOfAshes/Models/" + model);
            if (byModel == null && !string.IsNullOrEmpty(model)) missing.Add(model);
            return byModel;
        }

        private static void Configure(GameObject instance, JObject row)
        {
            var marker = instance.GetComponent<KromkaPlacedObjectAuthoring>();
            if (marker == null) marker = instance.AddComponent<KromkaPlacedObjectAuthoring>();
            bool blocksMovement = Text(row, "collision") == "solid";
            JToken vision = row["vision"];
            bool blocksVision = vision?["blocks"]?.ToObject<bool>() == true;
            bool lowCover = vision?["mode"]?.ToString() == "cover";
            marker.Configure(Text(row, "id"), Text(row, "model"), Text(row, "role"),
                Tags(row).ToArray(), true, blocksMovement, blocksVision, lowCover);
        }

        private static IEnumerable<string> Tags(JObject row)
        {
            return (row?["tags"] as JArray ?? new JArray()).Select(tag => tag.ToString());
        }

        private static string Text(JObject row, string key)
        {
            return row?[key]?.ToString() ?? string.Empty;
        }

        private static Vector3 Vector(JToken point)
        {
            if (point == null) return Vector3.zero;
            return new Vector3(
                point["x"]?.ToObject<float>() ?? 0f,
                point["y"]?.ToObject<float>() ?? 0f,
                point["z"]?.ToObject<float>() ?? 0f);
        }
    }
}
#endif
