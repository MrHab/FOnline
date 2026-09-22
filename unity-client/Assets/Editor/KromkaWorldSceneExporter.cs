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

            // Закреплённые секторы мира — такие же авторские локации, только их
            // определения лежат в data/zones/authored: пропусти их экспорт, и
            // правка сектора в сцене не дошла бы до сервера.
            int zones = 0;
            foreach (string zoneId in AuthoredZoneIds())
            {
                string path = KromkaLocationSceneCatalog.ScenePath(zoneId);
                if (AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null) continue;
                ExportLocationScene(EditorSceneManager.OpenScene(path, OpenSceneMode.Single));
                zones += 1;
            }

            if (!string.IsNullOrWhiteSpace(originalPath)
                && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);

            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] PASS: пространственные данные " + locations.Count + " локаций и "
                + zones + " секторов экспортированы из Unity.");
        }

        /// <summary>
        /// Из консоли: `-executeMethod Kromka.EditorTools.KromkaWorldSceneExporter.ExportBatch`.
        /// Сцены берутся из ROA_SCENES (через запятую), иначе экспортируются все.
        /// </summary>
        public static void ExportBatch()
        {
            string list = Environment.GetEnvironmentVariable("ROA_SCENES");
            if (string.IsNullOrWhiteSpace(list))
            {
                ExportAllScenes();
                return;
            }
            int exported = 0;
            foreach (string id in list.Split(',').Select(row => row.Trim()).Where(row => row.Length > 0))
            {
                string path = KromkaLocationSceneCatalog.ScenePath(id);
                if (path == null || AssetDatabase.LoadAssetAtPath<SceneAsset>(path) == null)
                    throw new FileNotFoundException("Не найдена Unity-сцена локации " + id, path ?? id);
                ExportLocationScene(EditorSceneManager.OpenScene(path, OpenSceneMode.Single));
                exported += 1;
            }
            AssetDatabase.Refresh();
            Debug.Log("[KROMKA] PASS: экспортировано сцен: " + exported);
        }

        /// <summary>Закреплённые секторы мира: файлы data/zones/authored/.</summary>
        private static IEnumerable<string> AuthoredZoneIds()
        {
            string folder = ProjectPath("data/zones/authored");
            if (!Directory.Exists(folder)) return Enumerable.Empty<string>();
            return Directory.GetFiles(folder, "*.json")
                .Select(Path.GetFileNameWithoutExtension)
                .OrderBy(row => row, StringComparer.Ordinal);
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

            string locationPath = DefinitionPath(authoring.StableLocationId);
            JObject definition = ReadJson(locationPath);
            JArray previous = definition["objects"] as JArray ?? new JArray();
            var previousById = previous.OfType<JObject>()
                .Where(row => !string.IsNullOrWhiteSpace(Text(row, "id")))
                .GroupBy(row => Text(row, "id"), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

            KromkaPlacedObjectAuthoring[] markers = authoring
                .GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true)
                .Where(marker => marker != null && marker.Role != "terrain")
                .OrderBy(marker => marker.StableObjectId, StringComparer.Ordinal)
                .ToArray();
            var markerIds = new HashSet<string>(markers.Select(marker => marker.StableObjectId), StringComparer.Ordinal);

            // Живые строки сцена не описывает. Статическая строка без маркера — либо объект,
            // удалённый в Unity (её писал экспорт, unityAuthored), либо строка, которую
            // написали руками или генератором и ещё не внесли в сцену. Вторую экспорт
            // обязан оставить: 18 сюжетных целей и шлюзов лабораторий он раньше стирал молча.
            string[] unimported = previous.OfType<JObject>()
                .Where(row => !IsLiveServerObject(row) && !IsUnityAuthored(row)
                              && !string.IsNullOrWhiteSpace(Text(row, "id")) && !markerIds.Contains(Text(row, "id")))
                .Select(row => Text(row, "id")).ToArray();
            if (unimported.Length > 0)
                Debug.LogWarning("[KROMKA] " + authoring.StableLocationId + ": строки без маркера сцены оставлены как есть: "
                    + string.Join(", ", unimported)
                    + ". Внесите их в сцену: «Кромка/Авторинг/Дополнить сцены маркерами строк data».");
            JArray exported = new JArray(previous.OfType<JObject>()
                .Where(row => IsLiveServerObject(row) || unimported.Contains(Text(row, "id")))
                .Select(row => row.DeepClone()));
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
            string locationPath = DefinitionPath(authoring.StableLocationId);
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

        /// <summary>
        /// Файл определения локации: сектор мира закреплён в data/zones/authored,
        /// остальные локации лежат в data/locations.
        /// </summary>
        private static string DefinitionPath(string locationId)
        {
            return KromkaLocationSceneCatalog.IsZoneId(locationId)
                ? ProjectPath("data/zones/authored/" + locationId + ".json")
                : ProjectPath("data/locations/" + locationId + ".json");
        }

        private static JObject ExportObject(KromkaPlacedObjectAuthoring marker, JObject previous)
        {
            JObject row = previous != null ? (JObject)previous.DeepClone() : new JObject();
            Transform transform = marker.transform;
            Vector3 euler = transform.eulerAngles * Mathf.Deg2Rad;
            List<KromkaWalkCollision.GroundShape> shapes = KromkaWalkCollision.Shapes(marker.gameObject);

            row["id"] = marker.StableObjectId;
            if (!string.IsNullOrWhiteSpace(marker.ServerArchetypeId))
                row["model"] = marker.ServerArchetypeId;
            if (row["name"] == null) row["name"] = HumanName(marker.name);
            row["position"] = Vector(transform.position);
            row["rotation"] = Vector(euler);
            row["scale"] = Vector(transform.lossyScale);
            RequirePhysicalMovementFlag(marker, shapes.Count > 0);
            row["collision"] = CollisionFor(marker.BlocksMovement, Text(previous, "collision"));
            row["role"] = marker.Role;
            row["tags"] = new JArray(marker.GameplayTags);
            if (marker.GameplayTags.Contains("resource") && row["maxHp"] == null)
            {
                row["hp"] = 1200;
                row["maxHp"] = 1200;
            }
            row["footprint"] = FootprintFor(marker.gameObject, previous);
            // Сервер строит преграды из collisionParts: одна коробка footprint закрыла бы двор
            // внутри ограды, проезд под балкой КПП и дно отстойника (38 тыс. м² лишних стен).
            if (marker.BlocksMovement)
                row["collisionParts"] = KromkaWalkCollision.Parts(shapes,
                    new Vector3(Round(transform.position.x), 0f, Round(transform.position.z)),
                    Round(euler.y), new Vector3(Round(transform.lossyScale.x), 1f, Round(transform.lossyScale.z)));
            else
                row.Remove("collisionParts");
            // Булев blocks не выражает низкое укрытие, поэтому оно пишется режимом.
            row["vision"] = marker.ProvidesLowCover
                ? new JObject { ["mode"] = "cover" }
                : new JObject { ["blocks"] = marker.BlocksVision };
            row["unityAuthored"] = true;
            row["worldRevision"] = KromkaLocationAuthoring.CurrentWorldRevision;
            row.Remove("placement");
            return row;
        }

        /// <summary>Поля преград строки так, как их записал бы экспорт: для проверки сцен.</summary>
        internal static JObject ExportedCollision(KromkaPlacedObjectAuthoring marker, JObject previous)
        {
            JObject row = ExportObject(marker, previous);
            // Отсутствующее поле остаётся отсутствующим: индексатор JObject превратил бы C# null
            // в JSON null, а экспорт у непроходимых объектов collisionParts удаляет.
            var fields = new JObject();
            foreach (string field in new[] { "footprint", "collisionParts" })
                if (row[field] != null) fields[field] = row[field].DeepClone();
            return fields;
        }

        /// <summary>
        /// Режим collision для строки data. Пока прежнее значение говорит о движении
        /// то же, что и маркер, оно сохраняется: экспорт не должен молча превращать
        /// "resource" в "solid" или "cover" в "none".
        /// </summary>
        internal static string CollisionFor(bool blocksMovement, string previous)
        {
            string current = (previous ?? string.Empty).Trim();
            if (current.Length > 0 && CollisionBlocksMovement(current) == blocksMovement) return current;
            return blocksMovement ? "solid" : "none";
        }

        /// <summary>Режимы, на которых сервер останавливает игрока: locationObjectBlocksMovement в server.js.</summary>
        internal static bool CollisionBlocksMovement(string collision)
        {
            switch ((collision ?? string.Empty).Trim().ToLowerInvariant())
            {
                case "solid":
                case "block":
                case "blocked":
                case "wall":
                case "resource":
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>
        /// Игрока на клиенте останавливает только включённый коллайдер сцены на высоте его
        /// тела, сервер — только collision из этого экспорта. Триггеры движению не мешают,
        /// и то, что целиком выше головы (настил моста на 2,5 м), тоже.
        /// </summary>
        internal static bool HasPhysicalCollider(GameObject root) => KromkaWalkCollision.BlocksWalking(root);

        // Флаг без коллайдера дал бы серверу невидимую преграду, коллайдер без флага —
        // стену, сквозь которую сервер ведёт игрока и противников. 319 маркеров прежнего
        // набора окружения несли такой флаг с переноса в Кромку (33a20ffd).
        private static void RequirePhysicalMovementFlag(KromkaPlacedObjectAuthoring marker, bool blocksWalking)
        {
            if (marker.BlocksMovement == blocksWalking) return;
            throw new InvalidOperationException("Объект " + marker.StableObjectId + (marker.BlocksMovement
                ? " помечен как преграда, но включённого коллайдера на высоте тела в сцене у него нет"
                : " несёт включённый коллайдер на высоте тела, но не помечен как преграда")
                + ": сервер и клиент разошлись бы в движении.");
        }

        /// <summary>
        /// footprint — размах объекта по земле. Его даёт физика: коллайдеры примитивов
        /// одинаковы на любой машине. Строке без коллайдеров значение оставляется прежним:
        /// её вид — меши магазинных наборов (MEP), которых в чистой копии репозитория нет,
        /// и экспорт там переписал бы 1070 строк под пустые границы.
        /// </summary>
        private static JObject FootprintFor(GameObject root, JObject previous)
        {
            if (KromkaWalkCollision.TryFootprint(root, out double sizeX, out double sizeZ))
                return new JObject
                {
                    ["x"] = KromkaWalkCollision.Round(Math.Max(0.2, sizeX)),
                    ["z"] = KromkaWalkCollision.Round(Math.Max(0.2, sizeZ))
                };
            if (previous?["footprint"] is JObject authored && authored["x"] != null && authored["z"] != null)
                return (JObject)authored.DeepClone();
            Bounds bounds = BoundsFor(root);
            return new JObject
            {
                ["x"] = Round(Mathf.Max(0.2f, bounds.size.x)),
                ["z"] = Round(Mathf.Max(0.2f, bounds.size.z))
            };
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
                // Сцена владеет местом, радиусом и ритмом поля; остальные поля строки
                // (permanentDischarge и прочее, заданное в каталоге) экспорт сохраняет.
                var previous = (location["anomalyFields"] as JArray ?? new JArray()).OfType<JObject>()
                    .Where(row => !string.IsNullOrWhiteSpace(Text(row, "id")))
                    .GroupBy(row => Text(row, "id"), StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
                location["anomalyFields"] = new JArray(fields.Select(field =>
                {
                    JObject row = previous.TryGetValue(field.StableAnomalyId, out JObject known)
                        ? (JObject)known.DeepClone() : new JObject();
                    row["id"] = field.StableAnomalyId;
                    row["type"] = field.AnomalyTypeId;
                    row["x"] = Round(field.transform.position.x);
                    row["z"] = Round(field.transform.position.z);
                    row["radius"] = Round(field.Radius);
                    row["dischargeMs"] = field.DischargeMilliseconds;
                    row["training"] = field.TrainingField;
                    row["placement"] = "unity-authored";
                    return row;
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
                    // Облик НПС правят в инспекторе префаба: сервер отдаёт его клиенту
                    // как есть, и в игре НПС выглядит так же, как в сцене.
                    KromkaNpcAuthoring npc = spawn.GetComponent<KromkaNpcAuthoring>();
                    if (npc != null)
                    {
                        JObject entity = actor["entity"] as JObject ?? new JObject();
                        entity["appearance"] = new JObject
                        {
                            ["schema"] = "realm.character-appearance.v1",
                            ["sex"] = npc.SexId,
                            ["bodyType"] = npc.BodyTypeId,
                            ["faceId"] = npc.FaceId,
                            ["hairId"] = npc.HairId,
                            ["skinToneId"] = "skin_03",
                            ["hairColorId"] = npc.HairColorId
                        };
                        actor["entity"] = entity;
                    }
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

        private static bool IsUnityAuthored(JObject row)
        {
            return row?["unityAuthored"]?.Type == JTokenType.Boolean && row["unityAuthored"].Value<bool>();
        }

        // Видимые границы новой строки без коллайдеров: единственный случай, когда footprint
        // берётся из рендереров (дальше он хранится в data, и экспорт его не трогает).
        private static Bounds BoundsFor(GameObject root)
        {
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
