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

namespace Kromka.EditorTools
{
    /// <summary>Editor gate proving that the generated world is editable Unity content.</summary>
    public static class KromkaWorldSceneProbe
    {
        private const string GlobalScene = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";

        [MenuItem("Кромка/Проверки/Авторские сцены")]
        public static void Run()
        {
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            JObject seed = ReadProjectJson("data/kromka/world-layout.seed.json");
            JArray locations = (JArray)catalog["locations"];
            // Каталог растёт (Сердцевина, Рынок Ядра), и точное число устаревало с каждой
            // новой локацией. Охранять нужно не его, а случайную потерю строки: таблица
            // сцен клиента и каталог обязаны перечислять одни и те же локации (каждая
            // строка каталога проверяется ниже, поэтому хватает равенства размеров),
            // а сцена без строки каталога — осиротевшая локация. Нижняя граница — как
            // в tools/check-unity-kromka-authoring.js.
            Require(locations.Count >= 45,
                "каталог должен содержать не меньше 45 локаций, найдено " + locations.Count);
            Require(KromkaLocationSceneCatalog.Count == locations.Count,
                "таблица сцен клиента и каталог расходятся: клиент=" + KromkaLocationSceneCatalog.Count
                + ", каталог=" + locations.Count);
            var catalogScenes = new HashSet<string>(locations.OfType<JObject>()
                .Select(row => KromkaLocationSceneCatalog.ScenePath(row["id"]?.Value<string>() ?? string.Empty)
                    ?? string.Empty), StringComparer.Ordinal);
            string[] orphanScenes = AssetDatabase.FindAssets("t:Scene", new[] { "Assets/Scenes/Kromka/Locations" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(scenePath => !catalogScenes.Contains(scenePath)).ToArray();
            Require(orphanScenes.Length == 0,
                "сцены локаций без строки каталога: " + string.Join(", ", orphanScenes));

            var buildPaths = new HashSet<string>(EditorBuildSettings.scenes
                .Where(scene => scene.enabled).Select(scene => scene.path), StringComparer.Ordinal);
            Require(buildPaths.Contains("Assets/Scenes/Wasteland.unity"), "нет bootstrap-сцены Wasteland");
            Require(buildPaths.Contains(GlobalScene), "глобальная сцена Кромки не добавлена в Build Settings");

            ValidateGlobal(seed, buildPaths);
            foreach (JObject row in locations.OfType<JObject>()) ValidateLocation(row, buildPaths);

            Debug.Log("[KROMKA SCENE AUDIT] PASS: глобальная карта и " + locations.Count
                + " редактируемых локаций соответствуют kromka-1.");
        }

        private static void ValidateGlobal(JObject seed, HashSet<string> buildPaths)
        {
            Require(AssetDatabase.LoadAssetAtPath<SceneAsset>(GlobalScene) != null,
                "не создана " + GlobalScene);
            Scene scene = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            KromkaWorldAuthoring world = Components<KromkaWorldAuthoring>(scene).SingleOrDefault();
            Require(world != null, "глобальная сцена не содержит KromkaWorldAuthoring");
            Require(world.Validate(out string error), "глобальная сцена: " + error);
            Require(world.WorldRevision == "kromka-1", "неверная ревизия глобальной сцены");
            Require(Mathf.Approximately(world.WorldWidthKm, 380f)
                    && Mathf.Approximately(world.WorldHeightKm, 300f),
                "глобальная сцена должна иметь размер 380x300 км");

            KromkaWorldLocationAuthoring[] markers = Components<KromkaWorldLocationAuthoring>(scene);
            int expectedMarkerCount = ((JArray)seed["locations"]).Count;
            string[] expectedMarkerIds = ((JArray)seed["locations"]).OfType<JObject>()
                .Select(row => row["id"]?.Value<string>() ?? string.Empty).ToArray();
            string[] actualMarkerIds = markers.Select(marker => marker.StableLocationId).ToArray();
            GameObject locationRoot = Find(scene, "Locations_EDITABLE");
            int locationChildCount = locationRoot != null ? locationRoot.transform.childCount : -1;
            string[] markerObjectsWithoutComponent = locationRoot == null
                ? Array.Empty<string>()
                : Enumerable.Range(0, locationRoot.transform.childCount)
                    .Select(index => locationRoot.transform.GetChild(index))
                    .Where(item => item.GetComponent<KromkaWorldLocationAuthoring>() == null)
                    .Select(item => item.name).ToArray();
            string markerDifference = "; missing=" + string.Join(",",
                expectedMarkerIds.Except(actualMarkerIds, StringComparer.Ordinal))
                + "; unexpected=" + string.Join(",",
                    actualMarkerIds.Except(expectedMarkerIds, StringComparer.Ordinal))
                + "; locationChildren=" + locationChildCount
                + "; objectsWithoutComponent=" + string.Join(",", markerObjectsWithoutComponent);
            Require(markers.Length == expectedMarkerCount,
                "число Unity-маркеров не совпадает с физическими узлами seed: Unity="
                + markers.Length + ", seed=" + expectedMarkerCount + markerDifference);
            Require(markers.Select(marker => marker.StableLocationId).Distinct(StringComparer.Ordinal).Count()
                    == markers.Length, "на глобальной сцене повторяются ID локаций");
            int routeCount = Components<KromkaRouteAuthoring>(scene).Length;
            int expectedRouteCount = ((JArray)seed["routes"]).Count;
            Require(routeCount == expectedRouteCount,
                "число Unity-маршрутов не совпадает с seed: Unity=" + routeCount
                + ", seed=" + expectedRouteCount);
            Require(Find(scene, "LORE_TERRAIN_LANGUAGE_EDITABLE") != null,
                "нет непрерывного лорного оформления глобальной карты");
            Require(Find(scene, "RegionGround_northern_sluices") == null,
                "обнаружена запрещённая прямоугольная плитка старого биома");
            Require(buildPaths.Contains(GlobalScene), "глобальная сцена выключена в Build Settings");
        }

        private static void ValidateLocation(JObject row, HashSet<string> buildPaths)
        {
            string id = row["id"]?.Value<string>() ?? string.Empty;
            string type = row["locationType"]?.Value<string>() ?? string.Empty;
            string path = KromkaLocationSceneCatalog.ScenePath(id);
            Require(AssetDatabase.LoadAssetAtPath<SceneAsset>(path) != null, "не создана сцена " + id);
            Require(buildPaths.Contains(path), "сцена " + id + " не добавлена в Build Settings");

            Scene scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single);
            KromkaLocationAuthoring location = Components<KromkaLocationAuthoring>(scene).SingleOrDefault();
            Require(location != null, id + ": нет KromkaLocationAuthoring");
            Require(location.Validate(out string error), id + ": " + error);
            Require(location.StableLocationId == id, id + ": ID корневого компонента не совпадает");
            Require(location.VisualProfileId == row["visualProfile"]?.Value<string>(),
                id + ": неверный визуальный профиль");
            Require(location.AmbientProfileId == row["ambientProfile"]?.Value<string>(),
                id + ": неверный профиль окружения");
            // Учебный двор RoaTutorialYardAuthoring пересобирает в чистую площадку без
            // общей грамматики Кромки (регион, тип, атмосферный декор, башня №12):
            // так задумано с 33a20ffd. Вместо грамматики проверяется его собственный
            // состав ниже, остальное — RoaPracticalTutorialProbe и check-kromka-onboarding.
            bool practicalYard = path == RealmOfAshes.EditorTools.RoaTutorialYardAuthoring.ScenePath;
            if (!practicalYard)
            {
                Require(Find(scene, "REGION_LANGUAGE_" + (row["macroRegion"]?.Value<string>() ?? string.Empty)
                    + "_EDITABLE") != null, id + ": нет визуального языка региона");
                Require(Find(scene, "LOCATION_TYPE_" + type + "_EDITABLE") != null,
                    id + ": нет узнаваемой композиции типа локации");
                GameObject dressing = Find(scene, "ATMOSPHERIC_DRESSING_EDITABLE");
                Require(dressing != null && dressing.transform.childCount >= 19,
                    id + ": недостаточно отдельного редактируемого постапокалиптического декора");
            }

            RoaUnityLocationScene runtime = Components<RoaUnityLocationScene>(scene).SingleOrDefault();
            Require(runtime != null && runtime.LocationId == id, id + ": нет runtime-моста Unity-сцены");
            Require(runtime.ReplaceServerStaticGeometry, id + ": старая JSON-геометрия не отключена");
            Require(runtime.GroundRenderer != null, id + ": не назначен редактируемый ground renderer");

            KromkaPlacedObjectAuthoring[] objects = Components<KromkaPlacedObjectAuthoring>(scene);
            Require(objects.Length >= MinimumObjects(type), id + ": слишком мало авторских объектов");
            Require(objects.Select(marker => marker.StableObjectId)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.Ordinal).Count() == objects.Length,
                id + ": повторяются стабильные ID объектов");
            // Движение: флаг маркера, коллайдеры сцены и collision в data обязаны говорить
            // одно. Экспортёр выводит collision из флага, клиент останавливает игрока
            // только коллайдером, сервер — только строкой data. 319 строк прежнего
            // набора окружения расходились здесь с переноса в Кромку, и полный экспорт
            // любой из 42 сцен молча превратил бы их в преграды на сервере.
            var rows = (ReadProjectJson("data/locations/" + id + ".json")?["objects"] as JArray ?? new JArray())
                .OfType<JObject>()
                .GroupBy(entry => entry["id"]?.Value<string>() ?? string.Empty, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            // Состав строк: экспорт оставляет статическую строку только при маркере в сцене, а
            // клиент без объекта сцены её не показывает. 18 сюжетных целей и шлюзов лабораторий
            // жили так с 15.09: нажималось «использовать» на пустом месте.
            var markerIds = new HashSet<string>(objects.Select(marker => marker.StableObjectId), StringComparer.Ordinal);
            string[] unmarked = rows.Where(pair => !string.IsNullOrEmpty(pair.Key) && !IsLiveRow(pair.Value)
                                                   && !markerIds.Contains(pair.Key))
                .Select(pair => pair.Key).ToArray();
            Require(unmarked.Length == 0, id + ": статические строки data без объекта сцены: "
                + string.Join(", ", unmarked) + " («Кромка/Авторинг/Дополнить сцены маркерами строк data»)");
            foreach (KromkaPlacedObjectAuthoring marker in objects.Where(marker => marker.Role != "terrain"))
            {
                RoaUnityLocationObject bridge = marker.GetComponent<RoaUnityLocationObject>();
                Require(bridge != null && bridge.ObjectId == marker.StableObjectId,
                    id + ": объект " + marker.StableObjectId + " не связан с сервером");
                Require(marker.BlocksMovement == KromkaWorldSceneExporter.HasPhysicalCollider(marker.gameObject),
                    id + ": у объекта " + marker.StableObjectId + " флаг движения ("
                    + marker.BlocksMovement + ") расходится с коллайдерами сцены");
                Require(rows.TryGetValue(marker.StableObjectId, out JObject data),
                    id + ": объект " + marker.StableObjectId + " не экспортирован в data");
                string collision = data["collision"]?.Value<string>() ?? string.Empty;
                Require(KromkaWorldSceneExporter.CollisionFor(marker.BlocksMovement, collision) == collision,
                    id + ": экспорт сцены сменил бы collision объекта " + marker.StableObjectId
                    + " с \"" + collision + "\"");
                // Теги экспорт берёт с маркера: расхождение молча сняло бы quest-object с антенны
                // заставы и вернуло бы койке учебного двора теги сна.
                string[] dataTags = data["tags"] is JArray tagRows ? tagRows.Values<string>().ToArray() : Array.Empty<string>();
                Require(dataTags.SequenceEqual(marker.GameplayTags, StringComparer.Ordinal),
                    id + ": теги объекта " + marker.StableObjectId + " в data [" + string.Join(", ", dataTags)
                    + "] расходятся с маркером [" + string.Join(", ", marker.GameplayTags) + "]");
                // Преграды и размах: data обязана хранить ровно то, что напишет экспорт, иначе
                // сервер останавливает игрока не там, где клиент.
                JObject expected = KromkaWorldSceneExporter.ExportedCollision(marker, data);
                foreach (string field in new[] { "footprint", "collisionParts" })
                    Require(SameNumbers(expected[field], data[field]),
                        id + ": экспорт сцены сменил бы " + field + " объекта " + marker.StableObjectId
                        + ": в data " + (data[field]?.ToString(Newtonsoft.Json.Formatting.None) ?? "нет")
                        + ", в сцене " + (expected[field]?.ToString(Newtonsoft.Json.Formatting.None) ?? "нет"));
            }

            int expectedAnomalies = row["anomalyFields"] is JArray fields ? fields.Count : 0;
            KromkaAnomalyAuthoring[] anomalies = Components<KromkaAnomalyAuthoring>(scene);
            Require(anomalies.Length == expectedAnomalies, id + ": неверное число аномалий");
            foreach (KromkaAnomalyAuthoring anomaly in anomalies)
            {
                float arrivalDistance = Vector3.Distance(anomaly.transform.position,
                    location.PlayerArrival.position);
                float migrationDistance = Vector3.Distance(anomaly.transform.position,
                    location.MigrationArrival.position);
                Require(arrivalDistance > anomaly.Radius + 2f, id + ": вход игрока находится в аномалии");
                Require(migrationDistance > anomaly.Radius + 2f, id + ": точка миграции находится в аномалии");
            }

            if (type == "clan_base")
            {
                Require(CountNames(scene, "-approach-") == 3, id + ": нужно три линии штурма");
                Require(CountNames(scene, "-relay-") == 3, id + ": нужно три ретранслятора");
                Require(CountNames(scene, "-module-socket-") == 6, id + ": нужно шесть модульных позиций");
            }
            if (type == "personal_base")
                Require(CountNames(scene, "-build-socket-") == 12, id + ": нужно 12 строительных ячеек");
            if (practicalYard)
            {
                // Всё, что собирает RoaTutorialYardAuthoring.ComposeGameplay.
                foreach (string required in new[]
                         { "yard_cover_a", "yard_repair_bench", "yard_ore", "yard_wood", "yard_caravan_truck",
                           "yard_gate_left", "yard_gate_right", "yard_casualty_cot" })
                    Require(objects.Any(marker => marker.StableObjectId == required),
                        id + ": в учебном дворе нет " + required);
            }
            else if (type == "tutorial")
            {
                Require(CountNames(scene, "-tower-12") == 1, id + ": нет башни №12");
                Require(CountNames(scene, "-training-range") == 1, id + ": нет учебного стрельбища");
                Require(CountNames(scene, "-caravan-loading") == 1, id + ": нет каравана к отправке");
            }
        }

        // Правило клиента RoaLocationData.IsLiveEntity в объёме экспортёра: живых сцена не описывает.
        private static bool IsLiveRow(JObject row)
        {
            string kind = row?["entity"]?["kind"]?.Value<string>() ?? string.Empty;
            if (kind == "npc" || kind == "enemy" || kind == "creature" || kind == "player") return true;
            return row?["tags"] is JArray tags && tags.Values<string>()
                .Any(tag => tag == "npc" || tag == "living" || tag == "hostile" || tag == "mutant");
        }

        // Числа сравниваются с допуском в полмиллиметра: 8 и 8.0 после чтения JSON — разные токены.
        private static bool SameNumbers(JToken expected, JToken actual)
        {
            if (expected == null || actual == null) return expected == null && actual == null;
            if (expected is JValue a && actual is JValue b)
            {
                bool numeric = (a.Type == JTokenType.Float || a.Type == JTokenType.Integer)
                               && (b.Type == JTokenType.Float || b.Type == JTokenType.Integer);
                return numeric ? Math.Abs(a.Value<double>() - b.Value<double>()) <= 0.0005 : JToken.DeepEquals(a, b);
            }
            if (expected is JArray left && actual is JArray right)
                return left.Count == right.Count && left.Zip(right, SameNumbers).All(same => same);
            if (expected is JObject first && actual is JObject second)
                return first.Count == second.Count && first.Properties()
                    .All(property => second[property.Name] != null && SameNumbers(property.Value, second[property.Name]));
            return false;
        }

        private static int MinimumObjects(string type)
        {
            switch (type)
            {
                case "clan_base": return 15;
                case "personal_base": return 15;
                case "tutorial": return 8;
                case "faction_capital": return 7;
                default: return 6;
            }
        }

        private static int CountNames(Scene scene, string fragment)
        {
            return scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                .Count(item => item.name.IndexOf(fragment, StringComparison.Ordinal) >= 0);
        }

        private static GameObject Find(Scene scene, string exactName)
        {
            return scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                .Where(item => item.name == exactName).Select(item => item.gameObject).FirstOrDefault();
        }

        private static T[] Components<T>(Scene scene) where T : Component
        {
            return scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<T>(true)).ToArray();
        }

        private static JObject ReadProjectJson(string relativePath)
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            return JObject.Parse(File.ReadAllText(Path.Combine(root,
                relativePath.Replace('/', Path.DirectorySeparatorChar))));
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("[KROMKA SCENE AUDIT] " + message);
        }
    }
}
#endif
