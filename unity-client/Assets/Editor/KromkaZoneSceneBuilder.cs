#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Раскладывает сектор мира в его собственную сцену: то, что конструктор зон
    /// собирал при каждом входе, становится обычными объектами Unity, и дальше
    /// сектор правят руками, как любую авторскую локацию.
    ///
    /// Работает только с закреплённым сектором
    /// (`node tools/bake-zone-scene.js &lt;id&gt;` кладёт его в data/zones/authored/),
    /// иначе правки стёр бы следующий запуск конструктора. Сцены у сектора может
    /// ещё не быть — тогда она создаётся: земля по размеру карты, солнце,
    /// атмосфера региона и точка прибытия из определения.
    ///
    /// Обратный путь обычный: «Кромка → Экспорт сцен» пишет правки в тот же файл.
    /// </summary>
    public static class KromkaZoneSceneBuilder
    {
        private const string ScenesRoot = "Assets/Scenes/Kromka/Locations";
        private const string ZoneRoot = "ZoneLayout";

        [MenuItem("Кромка/Собрать сектор в сцену")]
        public static void Run()
        {
            string zoneId = Path.GetFileNameWithoutExtension(EditorSceneManager.GetActiveScene().path);
            if (!KromkaLocationSceneCatalog.IsZoneId(zoneId))
            {
                EditorUtility.DisplayDialog("Сектор в сцену",
                    "Откройте сцену сектора (z_CC_RR) — она и будет заполнена.", "Ладно");
                return;
            }
            int placed = Build(zoneId);
            EditorUtility.DisplayDialog("Сектор в сцену", zoneId + ": поставлено " + placed + " объектов", "Ладно");
        }

        /// <summary>
        /// Из консоли: `-executeMethod RealmOfAshes.EditorTools.KromkaZoneSceneBuilder.RunBatch`.
        /// Секторы берутся из ROA_ZONES (через запятую), иначе раскладываются все
        /// закреплённые.
        /// </summary>
        public static void RunBatch()
        {
            string list = Environment.GetEnvironmentVariable("ROA_ZONES");
            IEnumerable<string> zones = !string.IsNullOrWhiteSpace(list)
                ? list.Split(',').Select(row => row.Trim()).Where(row => row.Length > 0)
                : AuthoredZones();
            int total = 0;
            int scenes = 0;
            foreach (string zone in zones)
            {
                total += Build(zone);
                scenes += 1;
                // Пакет идёт часами: без промежуточной отметки непонятно, жив ли он.
                if (scenes % 10 == 0) Debug.Log("[СЕКТОР] сцен готово: " + scenes);
            }
            RegisterScenes();
            AssetDatabase.SaveAssets();
            Debug.Log("[СЕКТОР] готово: сцен " + scenes + ", поставлено объектов " + total);
        }

        /// <summary>Закреплённые секторы: файлы data/zones/authored/.</summary>
        private static IEnumerable<string> AuthoredZones()
        {
            string folder = AuthoredFolder();
            if (!Directory.Exists(folder)) yield break;
            foreach (string file in Directory.GetFiles(folder, "*.json").OrderBy(row => row, StringComparer.Ordinal))
                yield return Path.GetFileNameWithoutExtension(file);
        }

        private static string AuthoredFolder()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "data", "zones", "authored"));
        }

        /// <summary>Разложить сектор в его сцену. Возвращает число поставленных объектов.</summary>
        public static int Build(string zoneId)
        {
            string file = Path.Combine(AuthoredFolder(), zoneId + ".json");
            if (!File.Exists(file))
                throw new InvalidOperationException(zoneId + " ещё строится конструктором: сначала выполните "
                    + "node tools/bake-zone-scene.js " + zoneId);
            JObject definition = JObject.Parse(File.ReadAllText(file));

            string scenePath = ScenesRoot + "/" + zoneId + ".unity";
            Scene scene = KromkaWorldSceneBuilder.SceneAssetExists(scenePath)
                ? EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single)
                : CreateScene(zoneId, definition, scenePath);

            KromkaSceneFill.Result result = KromkaSceneFill.Fill(scene, definition, ZoneRoot);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, scenePath);
            // Сразу и обратно в данные: у генератора след объекта записан в его
            // собственных осях, а сцена меряет его по сторонам света. Разойдись
            // они — сервер и клиент считали бы разные клетки занятыми.
            Kromka.EditorTools.KromkaWorldSceneExporter.ExportLocationScene(scene);
            if (result.Missing.Count > 0)
                Debug.LogWarning("[СЕКТОР] " + zoneId + ": без префаба остались " + string.Join(", ", result.Missing));
            return result.Placed;
        }

        /// <summary>
        /// Пустая сцена сектора: та же оболочка, что у остальных локаций —
        /// корень с авторингом, земля по карте, солнце и атмосфера региона.
        /// </summary>
        private static Scene CreateScene(string zoneId, JObject definition, string scenePath)
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var root = new GameObject("KromkaLocation_" + zoneId);
            var authoring = root.AddComponent<KromkaLocationAuthoring>();
            var runtime = root.AddComponent<RoaUnityLocationScene>();
            Transform staticContent = KromkaWorldSceneBuilder.Child(root.transform, "StaticContent_EDITABLE");
            KromkaWorldSceneBuilder.Child(staticContent, "GameplayObjects_EDITABLE");
            Transform dynamicAnchors = KromkaWorldSceneBuilder.Child(root.transform, "DynamicAnchors_EDITABLE");
            Transform arrival = KromkaWorldSceneBuilder.Child(dynamicAnchors, "PlayerArrival");
            Transform migration = KromkaWorldSceneBuilder.Child(dynamicAnchors, "MigrationArrival_SAFE");

            float width = definition["map"]?["width"]?.Value<float>() ?? 320f;
            float depth = definition["map"]?["depth"]?.Value<float>() ?? 320f;
            // Точка прибытия — из определения: экспорт пишет её обратно из сцены,
            // и разойдись они, сектор при каждой пересборке двигал бы вход.
            Vector3 spawn = KromkaWorldSceneBuilder.PointFromTile(definition["spawn"] as JObject, definition,
                new Vector3(0f, 0f, 0f));
            arrival.localPosition = new Vector3(spawn.x, 0.1f, spawn.z);
            migration.localPosition = new Vector3(spawn.x, 0.1f, spawn.z);
            arrival.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                zoneId + "-arrival", KromkaSpawnKind.PlayerArrival, string.Empty, 2f);
            migration.gameObject.AddComponent<KromkaSpawnAuthoring>().Configure(
                zoneId + "-migration", KromkaSpawnKind.MigrationArrival, string.Empty, 3f);

            string regionId = definition["macroRegion"]?.ToString() ?? "regional";
            Color regionColor = KromkaWorldSceneBuilder.RegionColor(regionId);
            GameObject ground = KromkaWorldSceneBuilder.Primitive("Ground_EDITABLE", PrimitiveType.Cube, staticContent,
                new Vector3(0f, -0.3f, 0f), new Vector3(width, 0.5f, depth),
                KromkaWorldSceneBuilder.MaterialFor("Kromka_Local_" + regionId, regionColor));
            ground.AddComponent<KromkaPlacedObjectAuthoring>().Configure(
                zoneId + "-ground", "ground", "terrain", new[] { regionId }, false, false, false);
            KromkaWorldSceneBuilder.AddSun(root.transform, 1.25f, Color.Lerp(Color.white, regionColor, 0.18f));
            KromkaWorldSceneBuilder.ConfigureAtmosphere(zoneId, regionColor);

            authoring.ConfigureIdentity(zoneId, definition["name"]?.ToString() ?? zoneId,
                KromkaLocationKind.BoundaryExpedition, KromkaWorldSceneBuilder.ParseRegion(regionId));
            // Экспорт отказывается писать локацию без профилей и ориентира, а у
            // сектора их нет: он берёт вид от своего макрорегиона, как разовая встреча.
            string visual = definition["kromkaVisualProfile"]?.ToString();
            string ambient = definition["ambientProfile"]?.ToString();
            authoring.ConfigurePresentation(
                string.IsNullOrWhiteSpace(visual) ? "inherit-macro-region" : visual,
                string.IsNullOrWhiteSpace(ambient) ? "inherit-macro-region" : ambient,
                0f, new[] { regionId });
            authoring.ConfigureRoots(staticContent, dynamicAnchors, arrival, migration);
            runtime.Configure(zoneId, null, ground.GetComponent<Renderer>(), true);

            EditorSceneManager.SaveScene(scene, scenePath);
            return scene;
        }

        /// <summary>
        /// Сцены секторов в списке сборки: без него LoadSceneAsync не найдёт их
        /// в собранном клиенте. Уже перечисленные сцены остаются как есть.
        /// </summary>
        internal static void RegisterScenes()
        {
            var known = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            var have = new HashSet<string>(known.Select(row => row.path), StringComparer.OrdinalIgnoreCase);
            foreach (string zoneId in AuthoredZones())
            {
                string scenePath = ScenesRoot + "/" + zoneId + ".unity";
                if (have.Contains(scenePath) || !KromkaWorldSceneBuilder.SceneAssetExists(scenePath)) continue;
                known.Add(new EditorBuildSettingsScene(scenePath, true));
                have.Add(scenePath);
            }
            EditorBuildSettings.scenes = known.ToArray();
        }
    }
}
#endif
