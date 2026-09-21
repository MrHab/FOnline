#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
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
    /// Сама раскладка — общая с секторами мира: KromkaSceneFill.
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

            KromkaSceneFill.Result result = KromkaSceneFill.Fill(scene, definition, CityRoot);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            // И сразу обратно в данные: у конструктора след объекта записан в его
            // собственных осях, а сцена меряет его по сторонам света. Разойдись
            // они — сервер и клиент считали бы разные клетки занятыми.
            Kromka.EditorTools.KromkaWorldSceneExporter.ExportLocationScene(scene);
            string note = locationId + ": в сцену поставлено " + result.Describe();
            Debug.Log("[ГОРОД] " + note);
            if (interactive) EditorUtility.DisplayDialog("Город в сцену", note, "Ладно");
            return result.Placed;
        }
    }
}
#endif
