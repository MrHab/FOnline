#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Раскладывает определение локации по сцене префабами набора зон: этим
    /// заняты и город, и сектор мира — у них одни и те же строки объектов.
    /// Живых актёров сцена не содержит, их ставит сервер.
    /// </summary>
    internal static class KromkaSceneFill
    {
        /// <summary>Что получилось разложить и чего не нашлось в наборе.</summary>
        internal struct Result
        {
            internal int Placed;
            internal SortedSet<string> Missing;

            internal string Describe()
            {
                return Placed + " объектов" + (Missing != null && Missing.Count > 0
                    ? "; без префаба остались: " + string.Join(", ", Missing) : string.Empty);
            }
        }

        /// <summary>
        /// Снять прежнюю застройку и разложить определение заново под узлом
        /// rootName. Земля остаётся: маркер с ролью terrain — это пол локации,
        /// без него игрок проваливается насквозь.
        /// </summary>
        internal static Result Fill(Scene scene, JObject definition, string rootName)
        {
            KromkaLocationAuthoring authoring = scene.GetRootGameObjects()
                .SelectMany(item => item.GetComponentsInChildren<KromkaLocationAuthoring>(true))
                .FirstOrDefault();
            if (authoring == null)
                throw new InvalidOperationException("В сцене нет объекта локации (KromkaLocationAuthoring): экспорт не увидит содержимое.");

            RoaZoneKitCatalog kit = Resources.Load<RoaZoneKitCatalog>(RoaZoneKitCatalog.ResourcePath);
            if (kit == null) throw new InvalidOperationException("Набор префабов зон не найден: " + RoaZoneKitCatalog.ResourcePath);

            // Землю и аномалии раскладка не трогает: маркер terrain — это пол
            // локации, без него игрок проваливается насквозь, а якорь аномалии —
            // авторская опасность, которую конструктор переносит в новую
            // раскладку и которую экспорт иначе стёр бы из каталога.
            foreach (KromkaPlacedObjectAuthoring marker in scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                .Where(marker => marker.Role != "terrain" && marker.Role != "anomaly")
                .ToList())
            {
                UnityEngine.Object.DestroyImmediate(marker.gameObject);
            }
            GameObject previousRoot = scene.GetRootGameObjects().FirstOrDefault(row => row.name == rootName);
            if (previousRoot != null) UnityEngine.Object.DestroyImmediate(previousRoot);

            StretchGround(scene, definition);

            var root = new GameObject(rootName);
            root.transform.SetParent(authoring.transform, false);
            var result = new Result { Missing = new SortedSet<string>(StringComparer.Ordinal) };
            foreach (JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                // Живых актёров ставит сервер: в сцене их нет и быть не должно.
                if (IsLiveActor(row)) continue;
                GameObject prefab = PrefabFor(kit, row, result.Missing);
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
                result.Placed++;
            }
            return result;
        }

        /// <summary>Пол локации по размеру её карты: он же холст для покраски.</summary>
        internal static void StretchGround(Scene scene, JObject definition)
        {
            float width = definition["map"]?["width"]?.ToObject<float>() ?? 0f;
            float depth = definition["map"]?["depth"]?.ToObject<float>() ?? 0f;
            if (width <= 0f || depth <= 0f) return;
            KromkaPlacedObjectAuthoring ground = scene.GetRootGameObjects()
                .SelectMany(item => item.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                .FirstOrDefault(marker => marker.Role == "terrain");
            if (ground == null) return;
            Transform transform = ground.transform;
            Vector3 scale = transform.localScale;
            transform.localScale = new Vector3(width, scale.y <= 0f ? 0.5f : scale.y, depth);
            Vector3 position = transform.position;
            transform.position = new Vector3(0f, position.y, 0f);
        }

        /// <summary>
        /// Преграда объекта в сцене. Префабы набора несут только вид: в игре
        /// коллизию строит сборщик из collisionParts, а сцене нужны настоящие
        /// коллайдеры — по ним экспорт и соберёт те же части обратно. Часть
        /// задана в осях объекта, ровно так её читает сервер.
        /// </summary>
        private static void AddCollision(GameObject instance, JObject row)
        {
            if (Text(row, "collision") != "solid") return;
            if (instance.GetComponentInChildren<Collider>(true) != null) return;
            var parts = row["collisionParts"] as JArray;
            if (parts == null || parts.Count == 0) return;
            // Высоту пишет не всякий генератор, и экспорт не пишет её вовсе
            // (серверу преграда нужна плоской): без неё берём высоту модели.
            float visual = VisualHeight(instance) / Safe(instance.transform.lossyScale.y);
            int index = 0;
            foreach (JObject part in parts.OfType<JObject>())
            {
                float width = part["size"]?["x"]?.ToObject<float>() ?? 0f;
                float depth = part["size"]?["z"]?.ToObject<float>() ?? 0f;
                float height = part["height"]?.ToObject<float>() ?? 0f;
                if (height <= 0f) height = visual;
                if (width <= 0f || depth <= 0f || height <= 0f) continue;
                var node = new GameObject("Collision" + (++index));
                node.transform.SetParent(instance.transform, false);
                node.transform.localPosition = new Vector3(
                    part["center"]?["x"]?.ToObject<float>() ?? 0f,
                    height * 0.5f,
                    part["center"]?["z"]?.ToObject<float>() ?? 0f);
                node.transform.localRotation = Quaternion.Euler(0f,
                    (part["rotationY"]?.ToObject<float>() ?? 0f) * Mathf.Rad2Deg, 0f);
                var box = node.AddComponent<BoxCollider>();
                box.size = new Vector3(width, height, depth);
            }
        }

        /// <summary>Высота объекта по его мешам; без мешей — в рост человека.</summary>
        private static float VisualHeight(GameObject instance)
        {
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            float height = 0f;
            foreach (Renderer renderer in renderers) height = Mathf.Max(height, renderer.bounds.size.y);
            return height > 0.1f ? height : 2f;
        }

        private static float Safe(float value)
        {
            return Mathf.Abs(value) < 0.0001f ? 1f : value;
        }

        internal static bool IsLiveActor(JObject row)
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
            // Мост со строкой сервера: по нему клиент узнаёт объект сцены и не
            // строит поверх него второй — иначе в локации было бы двойное дно.
            var bridge = instance.GetComponent<RoaUnityLocationObject>();
            if (bridge == null) bridge = instance.AddComponent<RoaUnityLocationObject>();
            bridge.Configure(Text(row, "id"));
        }

        private static IEnumerable<string> Tags(JObject row)
        {
            return (row?["tags"] as JArray ?? new JArray()).Select(tag => tag.ToString());
        }

        internal static string Text(JObject row, string key)
        {
            return row?[key]?.ToString() ?? string.Empty;
        }

        internal static Vector3 Vector(JToken point)
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
