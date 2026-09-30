#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Запекает карты зон для окна зоны на карте мира: каждая зона /api/world-map
    /// строится в Play Mode тем же загрузчиком, что и в игре (сцена сектора или сборка
    /// конструктора, земля, покров), при том же дневном свете, и снимается сверху тем же
    /// RoaMinimapSnapshot, что и локальная карта. Кадры — public/assets/zone-maps/&lt;id&gt;.jpg,
    /// их хэши — в manifest.json рядом (клиент добавляет хэш к адресу, чтобы свежий
    /// снимок не застревал в кеше браузера).
    ///
    /// Определения зон берёт у сервера: ROA_ZONE_MAP_BASE_URL, по умолчанию :3000.
    /// Пакетный запуск: -executeMethod RealmOfAshes.EditorTools.RoaZoneMapBaker.RunBatch (без -quit).
    /// ROA_ZONE_MAP_ONLY (или файл Library/zone-map-bake-only.txt) — через запятую id зон, если нужны не все.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaZoneMapBaker
    {
        public const int Pixels = 512;
        public const int JpegQuality = 80;
        private const string Key = "Roa.ZoneMapBaker";
        private static bool _started;

        private static string OutputDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "public", "assets", "zone-maps"));
        private static string ResultFile => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library", "zone-map-bake.txt"));

        static RoaZoneMapBaker()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state =>
            {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode && !_started)
                {
                    _started = true;
                    var host = new GameObject("ZoneMapBaker");
                    UnityEngine.Object.DontDestroyOnLoad(host);
                    RoaLocationLoader loader = host.AddComponent<RoaLocationLoader>();
                    loader.StartCoroutine(Bake(host, loader));
                }
                if (state == PlayModeStateChange.EnteredEditMode)
                {
                    SessionState.SetBool(Key, false);
                    _started = false;
                    // Вернуть сцены, открытые до запекания.
                    string[] scenes = SessionState.GetString(Key + ".scenes", string.Empty).Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);
                    for (int i = 0; i < scenes.Length; i++)
                        if (File.Exists(scenes[i])) EditorSceneManager.OpenScene(scenes[i], i == 0 ? OpenSceneMode.Single : OpenSceneMode.Additive);
                    if (Application.isBatchMode)
                    {
                        string result = File.Exists(ResultFile) ? File.ReadAllText(ResultFile) : "FAIL: no result";
                        EditorApplication.Exit(result.StartsWith("PASS", StringComparison.Ordinal) ? 0 : 1);
                    }
                }
            };
        }

        [MenuItem("Realm of Ashes/Zones/Bake zone maps")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Exit Play Mode first.");
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save open scenes first.");
            File.WriteAllText(ResultFile, "RUNNING");
            var open = new List<string>();
            for (int i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
            {
                string path = UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).path;
                if (!string.IsNullOrEmpty(path)) open.Add(path);
            }
            SessionState.SetString(Key + ".scenes", string.Join("|", open));
            // Пустая сцена: запекателю не нужен ни бутстрап игры, ни чужие камеры и свет.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.playModeStartScene = null;
            SessionState.SetBool(Key, true);
            EditorApplication.isPlaying = true;
        }

        public static void RunBatch()
        {
            try { Run(); }
            catch (Exception error)
            {
                File.WriteAllText(ResultFile, "FAIL: " + error);
                Debug.LogException(error);
                EditorApplication.Exit(1);
            }
        }

        private static IEnumerator Bake(GameObject host, RoaLocationLoader loader)
        {
            string baseUrl = Environment.GetEnvironmentVariable("ROA_ZONE_MAP_BASE_URL");
            if (string.IsNullOrEmpty(baseUrl)) baseUrl = "http://127.0.0.1:3000";
            loader.BaseUrl = baseUrl;
            RoaWorldLighting lighting = host.AddComponent<RoaWorldLighting>();
            lighting.Configure(baseUrl);
            RoaMinimapSnapshot snapshot = host.AddComponent<RoaMinimapSnapshot>();
            var failures = new List<string>();
            int baked = 0;
            float started = Time.realtimeSinceStartup;

            var ids = new List<string>();
            string error = null;
            using (UnityWebRequest request = UnityWebRequest.Get(baseUrl.TrimEnd('/') + "/api/world-map"))
            {
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success) error = "world map: " + request.error;
                else
                {
                    foreach (JToken zone in JObject.Parse(request.downloadHandler.text)["map"]?["zones"] as JArray ?? new JArray())
                        if (!string.IsNullOrEmpty(zone?["id"]?.ToString())) ids.Add(zone["id"].ToString());
                }
            }
            string only = Environment.GetEnvironmentVariable("ROA_ZONE_MAP_ONLY");
            // Из открытого редактора переменную окружения не задать: тот же список можно положить в файл.
            string onlyFile = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library", "zone-map-bake-only.txt"));
            if (string.IsNullOrEmpty(only) && File.Exists(onlyFile)) only = File.ReadAllText(onlyFile).Trim();
            var worldIds = new List<string>(ids);
            if (!string.IsNullOrEmpty(only)) ids = new List<string>(only.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries));
            if (error == null)
            {
                yield return loader.StartCoroutine(loader.FetchLocationCatalog((ok, message) => { error = ok ? null : message; }));
            }
            if (error != null)
            {
                Finish("FAIL: " + error);
                yield break;
            }

            Directory.CreateDirectory(OutputDir);
            var target = new Texture2D(Pixels, Pixels, TextureFormat.RGB24, false);
            foreach (string id in ids)
            {
                if (loader.GetDefinition(id) == null)
                {
                    bool fetched = false;
                    yield return loader.StartCoroutine(loader.FetchDefinition(id, (ok, message) => fetched = ok));
                    if (!fetched) { failures.Add(id + ": no definition"); continue; }
                }
                bool loaded = false;
                string loadError = null;
                yield return loader.StartCoroutine(loader.LoadLocation(id, (ok, message) => { loaded = ok; if (!ok) loadError = message; }));
                if (!loaded) { failures.Add(id + ": " + loadError); continue; }
                LocationDefinition location = loader.Current;
                lighting.SetLocalWorldActive(true);
                lighting.SetLocation(location, loader.CurrentGroundRenderer);
                // Как миникарта: снимок — когда мир постоял (текстуры, покров, свет дня).
                float until = Time.realtimeSinceStartup + RoaMinimap.SnapshotDelaySeconds;
                while (Time.realtimeSinceStartup < until) yield return null;
                Color ground = RoaMinimap.GroundColor(location.Ground?.Preset);
                ground.a = 1f;
                if (!snapshot.Capture(location, ground, Pixels)) { failures.Add(id + ": nothing to capture"); continue; }
                RenderTexture previous = RenderTexture.active;
                RenderTexture.active = snapshot.Texture;
                target.ReadPixels(new Rect(0, 0, Pixels, Pixels), 0, 0);
                target.Apply();
                RenderTexture.active = previous;
                byte[] jpeg = target.EncodeToJPG(JpegQuality);
                File.WriteAllBytes(Path.Combine(OutputDir, id + ".jpg"), jpeg);
                baked++;
                // Манифест пишется после каждой зоны: прерванный прогон не теряет снятого.
                WriteManifest(worldIds);
                Debug.Log("[ZONE MAPS] " + baked + "/" + ids.Count + " " + id);
            }
            UnityEngine.Object.Destroy(target);

            string summary = $"{baked} of {ids.Count} zones in {Time.realtimeSinceStartup - started:0} s";
            Finish(failures.Count == 0 ? "PASS: " + summary : "FAIL: " + summary + "\n" + string.Join("\n", failures));
        }

        /// <summary>Манифест — хэши всех снимков зон мира, что лежат в папке, по порядку id.</summary>
        private static void WriteManifest(List<string> worldIds)
        {
            var names = new List<string>(worldIds);
            names.Sort(StringComparer.Ordinal);
            var zones = new JObject();
            foreach (string name in names)
            {
                string file = Path.Combine(OutputDir, name + ".jpg");
                if (File.Exists(file)) zones[name] = Hash(File.ReadAllBytes(file));
            }
            var manifest = new JObject { ["schema"] = "kromka.zoneMaps.v1", ["pixels"] = Pixels, ["zones"] = zones };
            File.WriteAllText(Path.Combine(OutputDir, "manifest.json"), manifest.ToString(Newtonsoft.Json.Formatting.Indented).Replace("\r\n", "\n") + "\n");
        }

        private static void Finish(string result)
        {
            File.WriteAllText(ResultFile, result);
            Debug.Log("[ZONE MAPS] " + result);
            EditorApplication.isPlaying = false;
        }

        private static string Hash(byte[] bytes)
        {
            using (SHA1 sha = SHA1.Create())
            {
                var text = new StringBuilder();
                byte[] digest = sha.ComputeHash(bytes);
                for (int i = 0; i < 5; i++) text.Append(digest[i].ToString("x2"));
                return text.ToString();
            }
        }
    }
}
#endif
