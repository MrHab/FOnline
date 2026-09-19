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
        [MenuItem("Кромка/Проверки/Авторские сцены")]
        public static void Run()
        {
            JObject catalog = ReadProjectJson("data/kromka/locations.json");
            JArray locations = (JArray)catalog["locations"];
            Require(locations.Count == 45, "каталог должен содержать 45 локаций");

            var buildPaths = new HashSet<string>(EditorBuildSettings.scenes
                .Where(scene => scene.enabled).Select(scene => scene.path), StringComparer.Ordinal);
            Require(buildPaths.Contains("Assets/Scenes/Wasteland.unity"), "нет bootstrap-сцены Wasteland");

            foreach (JObject row in locations.OfType<JObject>()) ValidateLocation(row, buildPaths);

            Debug.Log("[KROMKA SCENE AUDIT] PASS: " + locations.Count
                + " редактируемых локаций соответствуют kromka-1.");
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
            Require(Find(scene, "REGION_LANGUAGE_" + (row["macroRegion"]?.Value<string>() ?? string.Empty)
                + "_EDITABLE") != null, id + ": нет визуального языка региона");
            Require(Find(scene, "LOCATION_TYPE_" + type + "_EDITABLE") != null,
                id + ": нет узнаваемой композиции типа локации");
            GameObject dressing = Find(scene, "ATMOSPHERIC_DRESSING_EDITABLE");
            Require(dressing != null && dressing.transform.childCount >= 19,
                id + ": недостаточно отдельного редактируемого постапокалиптического декора");

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
            foreach (KromkaPlacedObjectAuthoring marker in objects.Where(marker => marker.Role != "terrain"))
            {
                RoaUnityLocationObject bridge = marker.GetComponent<RoaUnityLocationObject>();
                Require(bridge != null && bridge.ObjectId == marker.StableObjectId,
                    id + ": объект " + marker.StableObjectId + " не связан с сервером");
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
            if (type == "tutorial")
            {
                Require(CountNames(scene, "-tower-12") == 1, id + ": нет башни №12");
                Require(CountNames(scene, "-training-range") == 1, id + ": нет учебного стрельбища");
                Require(CountNames(scene, "-caravan-loading") == 1, id + ": нет каравана к отправке");
            }
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
