#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Отражает сцены закреплённых секторов и разложенных городов по оси север-юг
    /// вслед за их данными (`node tools/mirror-zones-north-up.js`): до «север = +Z»
    /// содержимое зоны было зеркалом карты мира. Объект встаёт в z → c − z и
    /// поворачивается θ → 180° − θ (фасад смотрит в отражённую сторону, сам объект
    /// не выворачивается), точки появления только переезжают. Сектор отражается
    /// вокруг своей середины (c = 0), город — вокруг центра плана (c = 2 м).
    ///
    /// Нужно ли отражать сцену, решают данные: каждый маркер сверяется со своей
    /// строкой определения, и сцена отражается, только если вся она совпадает с
    /// зеркалом данных. После отражения каждая строка обязана совпасть с маркером,
    /// иначе сцена не сохраняется. Сцена, уже совпадающая с данными, пропускается.
    ///
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.KromkaZoneNorthMirror.RunBatch -quit;
    /// ROA_ZONES — через запятую id локаций, если нужны не все.
    /// </summary>
    public static class KromkaZoneNorthMirror
    {
        private const float PositionTolerance = 0.02f;
        private const float YawToleranceDegrees = 0.2f;
        private const string CompassNorth = "+z";

        [MenuItem("Кромка/Авторинг/Отразить сцены зон по оси север-юг")]
        public static void Run()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            string report = MirrorAll(null);
            Debug.Log("[СЕВЕР] " + report);
            EditorUtility.DisplayDialog("Север = +Z", report, "Ладно");
        }

        public static void RunBatch()
        {
            string list = Environment.GetEnvironmentVariable("ROA_ZONES");
            HashSet<string> only = string.IsNullOrWhiteSpace(list)
                ? null
                : new HashSet<string>(list.Split(',').Select(row => row.Trim()).Where(row => row.Length > 0), StringComparer.Ordinal);
            Debug.Log("[СЕВЕР] " + MirrorAll(only));
        }

        private static string MirrorAll(HashSet<string> only)
        {
            int mirrored = 0, already = 0, checkedScenes = 0;
            var failures = new List<string>();
            foreach (KeyValuePair<string, string> location in Locations())
            {
                if (only != null && !only.Contains(location.Key)) continue;
                checkedScenes++;
                try
                {
                    if (MirrorScene(location.Key, location.Value)) mirrored++;
                    else already++;
                }
                catch (Exception error)
                {
                    failures.Add(location.Key + ": " + error.Message);
                }
                if (checkedScenes % 10 == 0) Debug.Log("[СЕВЕР] сцен просмотрено: " + checkedScenes);
            }
            string summary = "сцен " + checkedScenes + ": отражено " + mirrored + ", уже совпадали с данными " + already;
            if (failures.Count > 0)
                throw new InvalidOperationException(summary + ", с ошибкой " + failures.Count + ":\n" + string.Join("\n", failures));
            return summary;
        }

        /// <summary>Закреплённые секторы и разложенные города: id → файл определения.</summary>
        private static IEnumerable<KeyValuePair<string, string>> Locations()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            foreach (string file in Directory.GetFiles(Path.Combine(root, "data", "zones", "authored"), "*.json")
                         .OrderBy(row => row, StringComparer.Ordinal))
                yield return new KeyValuePair<string, string>(Path.GetFileNameWithoutExtension(file), file);
            foreach (string file in Directory.GetFiles(Path.Combine(root, "data", "locations"), "*.json")
                         .OrderBy(row => row, StringComparer.Ordinal))
            {
                if (!File.ReadAllText(file).Contains("\"cityAuthored\": true")) continue;
                yield return new KeyValuePair<string, string>(Path.GetFileNameWithoutExtension(file), file);
            }
        }

        /// <summary>Отразить сцену локации. false — сцена уже совпадала с данными.</summary>
        private static bool MirrorScene(string locationId, string file)
        {
            JObject definition = JObject.Parse(File.ReadAllText(file));
            if ((string)definition["compassNorth"] != CompassNorth)
                throw new InvalidOperationException("данные ещё не отражены: node tools/mirror-zones-north-up.js");
            string scenePath = (string)definition["unityScene"];
            if (string.IsNullOrEmpty(scenePath) || !File.Exists(Path.GetFullPath(Path.Combine(Application.dataPath, "..", scenePath))))
                throw new InvalidOperationException("нет сцены " + scenePath);
            float c = MirrorAxis(definition);

            Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            KromkaLocationAuthoring authoring = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<KromkaLocationAuthoring>(true)).FirstOrDefault();
            if (authoring == null) throw new InvalidOperationException("в сцене нет KromkaLocationAuthoring");

            List<Pin> pins = Pins(authoring, definition, LoreAnomalies(locationId));
            if (pins.Count == 0) throw new InvalidOperationException("в сцене нет ни одного маркера со строкой данных");
            int direct = pins.Count(pin => pin.Matches(pin.Target.position, pin.Target.eulerAngles.y, 0f, false));
            if (direct == pins.Count) return false;
            List<Pin> strays = pins.Where(pin => !pin.Matches(pin.Target.position, pin.Target.eulerAngles.y, c, true)).ToList();
            if (strays.Count > 0)
                throw new InvalidOperationException("сцена не совпадает ни с данными, ни с их зеркалом (" + direct + " из " + pins.Count
                    + " на месте): " + string.Join(", ", strays.Take(5).Select(pin => pin.Describe())));

            // Сначала все цели, потом перенос от корня к листьям: вложенный маркер
            // ставится сам, а не едет вместе с родителем.
            var moves = new List<KeyValuePair<Transform, Pose>>();
            foreach (Transform target in MirroredTransforms(authoring))
            {
                Vector3 p = target.position;
                Quaternion q = target.rotation;
                moves.Add(new KeyValuePair<Transform, Pose>(target, new Pose(new Vector3(p.x, p.y, c - p.z),
                    new Quaternion(-q.x, -q.y, q.z, q.w) * Quaternion.Euler(0f, 180f, 0f))));
            }
            foreach (KeyValuePair<Transform, Pose> move in moves.OrderBy(row => Depth(row.Key)))
            {
                // Объект и живой актёр поворачиваются вслед за отражением, точка прибытия только переезжает.
                if (Turns(move.Key))
                    move.Key.SetPositionAndRotation(move.Value.position, move.Value.rotation);
                else
                    move.Key.position = move.Value.position;
            }

            List<Pin> wrong = pins.Where(pin => !pin.Matches(pin.Target.position, pin.Target.eulerAngles.y, 0f, false)).ToList();
            if (wrong.Count > 0)
                throw new InvalidOperationException("после отражения разошлись с данными: " + string.Join(", ", wrong.Take(5).Select(pin => pin.Describe())));
            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene)) throw new InvalidOperationException("сцена не сохранилась");
            return true;
        }

        /// <summary>Сумма z пары отражения: сектор — вокруг середины карты, город — вокруг тайла центра плана.</summary>
        private static float MirrorAxis(JObject definition)
        {
            float depth = definition["map"]?["depth"]?.Value<float>() ?? 0f;
            int tiles = Mathf.RoundToInt(depth / 2f);
            if (tiles <= 0) throw new InvalidOperationException("в определении нет размера карты");
            bool city = definition["cityZone"]?.Value<bool>() == true;
            int k = city ? tiles : tiles - 1;
            return (k - tiles + 1) * 2f;
        }

        /// <summary>Что отражается: маркеры объектов (кроме пола), точки появления и якоря аномалий.</summary>
        private static IEnumerable<Transform> MirroredTransforms(KromkaLocationAuthoring authoring)
        {
            var seen = new HashSet<Transform>();
            foreach (KromkaPlacedObjectAuthoring marker in authoring.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                if (marker.Role != "terrain" && seen.Add(marker.transform)) yield return marker.transform;
            foreach (KromkaSpawnAuthoring spawn in authoring.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
                if (seen.Add(spawn.transform)) yield return spawn.transform;
            foreach (Transform anchor in new[] { authoring.PlayerArrival, authoring.MigrationArrival })
                if (anchor != null && seen.Add(anchor)) yield return anchor;
            foreach (KromkaAnomalyAuthoring field in authoring.GetComponentsInChildren<KromkaAnomalyAuthoring>(true))
                if (seen.Add(field.transform)) yield return field.transform;
        }

        /// <summary>Поля аномалий места из лора (data/kromka/locations.json): их место держит он, а не определение.</summary>
        private static JArray LoreAnomalies(string locationId)
        {
            string file = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "kromka", "locations.json"));
            JObject catalog = JObject.Parse(File.ReadAllText(file));
            JObject location = (catalog["locations"] as JArray)?.OfType<JObject>()
                .FirstOrDefault(row => (string)row["id"] == locationId);
            return location?["anomalyFields"] as JArray ?? new JArray();
        }

        /// <summary>
        /// Поворачивается ли узел с отражением: объект — да, якорь живого актёра — да (его
        /// поворот экспорт пишет в строку актёра), точки прибытия, выхода и аномалии — нет.
        /// </summary>
        private static bool Turns(Transform node)
        {
            if (node.GetComponent<KromkaPlacedObjectAuthoring>() != null) return true;
            KromkaSpawnAuthoring spawn = node.GetComponent<KromkaSpawnAuthoring>();
            return spawn != null && IsActor(spawn.Kind);
        }

        private static bool IsActor(KromkaSpawnKind kind)
        {
            return kind == KromkaSpawnKind.Npc || kind == KromkaSpawnKind.Enemy || kind == KromkaSpawnKind.Encounter;
        }

        private static int Depth(Transform transform)
        {
            int depth = 0;
            for (Transform node = transform.parent; node != null; node = node.parent) depth++;
            return depth;
        }

        /// <summary>Маркеры сцены со своими строками данных — по ним сцена сверяется до и после.</summary>
        private static List<Pin> Pins(KromkaLocationAuthoring authoring, JObject definition, JArray anomalies)
        {
            var rows = new Dictionary<string, JObject>(StringComparer.Ordinal);
            foreach (JObject row in (definition["objects"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string id = (string)row["id"];
                if (!string.IsNullOrEmpty(id) && !rows.ContainsKey(id)) rows[id] = row;
            }
            var pins = new List<Pin>();
            foreach (KromkaPlacedObjectAuthoring marker in authoring.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
            {
                if (marker.Role == "terrain" || !rows.TryGetValue(marker.StableObjectId ?? string.Empty, out JObject row)) continue;
                pins.Add(new Pin(marker.StableObjectId, marker.transform, row["position"], row["rotation"]?["y"]?.Value<float>()));
            }
            var spawns = new Dictionary<string, JObject>(StringComparer.Ordinal);
            foreach (JObject row in (definition["unitySpawns"] as JArray ?? new JArray()).OfType<JObject>())
            {
                string id = (string)row["id"];
                if (!string.IsNullOrEmpty(id)) spawns[id] = row;
            }
            foreach (KromkaSpawnAuthoring spawn in authoring.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
            {
                string id = spawn.SpawnId ?? string.Empty;
                // Якорь актёра сверяется со строкой актёра: место и взгляд.
                if (IsActor(spawn.Kind) && rows.TryGetValue(id, out JObject actor))
                    pins.Add(new Pin("actor " + id, spawn.transform, actor["position"], actor["rotation"]?["y"]?.Value<float>()));
                else if (spawns.TryGetValue(id, out JObject row))
                    pins.Add(new Pin("spawn " + id, spawn.transform, row["position"],
                        IsActor(spawn.Kind) ? row["rotationY"]?.Value<float>() : null));
            }
            if (authoring.PlayerArrival != null && definition["spawn"] is JObject arrival)
                pins.Add(new Pin("spawn", authoring.PlayerArrival, arrival, null));
            if (authoring.MigrationArrival != null && definition["migrationArrival"] is JObject migration)
                pins.Add(new Pin("migrationArrival", authoring.MigrationArrival, migration, null));
            foreach (KromkaAnomalyAuthoring field in authoring.GetComponentsInChildren<KromkaAnomalyAuthoring>(true))
            {
                JObject row = anomalies.OfType<JObject>().FirstOrDefault(item => (string)item["id"] == field.StableAnomalyId);
                if (row == null) throw new InvalidOperationException("якоря аномалии " + field.StableAnomalyId + " нет в лоре");
                pins.Add(new Pin("anomaly " + field.StableAnomalyId, field.transform, row, null));
            }
            return pins;
        }

        /// <summary>Маркер сцены и то, где его видят данные.</summary>
        private sealed class Pin
        {
            public readonly string Id;
            public readonly Transform Target;
            private readonly float _x;
            private readonly float _z;
            private readonly float? _yawDegrees;

            public Pin(string id, Transform target, JToken point, float? yawRadians)
            {
                Id = id;
                Target = target;
                _x = point?["x"]?.Value<float>() ?? 0f;
                _z = point?["z"]?.Value<float>() ?? 0f;
                _yawDegrees = yawRadians.HasValue ? yawRadians.Value * Mathf.Rad2Deg : (float?)null;
            }

            /// <summary>Стоит ли маркер там, где его видят данные (mirrored — их зеркало вокруг c).</summary>
            public bool Matches(Vector3 position, float yawDegrees, float c, bool mirrored)
            {
                float z = mirrored ? c - _z : _z;
                if (Mathf.Abs(position.x - _x) > PositionTolerance || Mathf.Abs(position.z - z) > PositionTolerance) return false;
                if (!_yawDegrees.HasValue) return true;
                float yaw = mirrored ? 180f - _yawDegrees.Value : _yawDegrees.Value;
                return Mathf.Abs(Mathf.DeltaAngle(yawDegrees, yaw)) <= YawToleranceDegrees;
            }

            public string Describe()
            {
                var text = new StringBuilder(Id);
                text.Append(" сцена (").Append(Target.position.x.ToString("0.###")).Append(", ").Append(Target.position.z.ToString("0.###"))
                    .Append(" / ").Append(Target.eulerAngles.y.ToString("0.#")).Append("°), данные (").Append(_x.ToString("0.###"))
                    .Append(", ").Append(_z.ToString("0.###"));
                if (_yawDegrees.HasValue) text.Append(" / ").Append(_yawDegrees.Value.ToString("0.#")).Append("°");
                return text.Append(")").ToString();
            }
        }
    }
}
#endif
