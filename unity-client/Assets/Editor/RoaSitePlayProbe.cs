#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Площадка места в зоне глазами живого клиента. Нужен локальный сервер и персонаж,
    /// сохранённый на площадке: адрес, логин, пароль и id площадки лежат в
    /// Library/SitePlayProbe/server.json ({ baseUrl, login, password, site }). Проба входит в
    /// игру авто-входом и проверяет, что сцена сектора принесла площадку (KromkaSiteAuthoring
    /// с её id), клиент получил её строку и провёл по черте безопасного островка белую полосу,
    /// а сервер считает игрока стоящим на ней. Кадры — 1600×900 и 844×390 (телефон в
    /// ландшафте), с игровой и с дальней камеры — в той же папке.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaSitePlayProbe
    {
        private const string Key = "Roa.SitePlayProbe";
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/SitePlayProbe"));

        static RoaSitePlayProbe()
        {
            EditorApplication.playModeStateChanged += state =>
            {
                if (!SessionState.GetBool(Key, false)) return;
                if (state == PlayModeStateChange.EnteredPlayMode) { _started = false; _next = EditorApplication.timeSinceStartup + 1.5; }
                if (state != PlayModeStateChange.EnteredEditMode) return;
                SessionState.SetBool(Key, false);
                if (!Application.isBatchMode || !SessionState.GetBool(Key + ".batch", false)) return;
                SessionState.SetBool(Key + ".batch", false);
                string result = Path.Combine(Output, "result.txt");
                var start = DateTime.Parse(SessionState.GetString(Key + ".start", DateTime.UtcNow.ToString("O")), null,
                    System.Globalization.DateTimeStyles.RoundtripKind);
                EditorApplication.Exit(File.Exists(result) && File.GetLastWriteTimeUtc(result) >= start
                    && File.ReadAllText(result).StartsWith("PASS:", StringComparison.Ordinal) ? 0 : 1);
            };
            EditorApplication.update += () =>
            {
                if (!SessionState.GetBool(Key, false) || !EditorApplication.isPlaying || _started
                    || EditorApplication.timeSinceStartup < _next) return;
                _started = true;
                Audit();
            };
        }

        [MenuItem("Realm of Ashes/Места/Проверить площадку в живом клиенте")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Сначала выйти из Play Mode.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Сначала сохранить открытую сцену.");
            JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
            // Авто-вход берёт адрес и учётку из окружения процесса (RoaGameBootstrap.ApplyAutomationEnvironment).
            Environment.SetEnvironmentVariable("ROA_UNITY_AUTOMATION", "1");
            Environment.SetEnvironmentVariable("ROA_UNITY_BASE_URL", server.Value<string>("baseUrl"));
            Environment.SetEnvironmentVariable("ROA_UNITY_LOGIN", server.Value<string>("login"));
            Environment.SetEnvironmentVariable("ROA_UNITY_PASSWORD", server.Value<string>("password"));
            SessionState.SetBool(Key, true);
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>("Assets/Scenes/Wasteland.unity");
            EditorApplication.isPlaying = true;
        }

        public static void RunBatch()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Пакетный запуск — только в batch mode.");
            Directory.CreateDirectory(Output);
            SessionState.SetBool(Key + ".batch", true);
            SessionState.SetString(Key + ".start", DateTime.UtcNow.ToString("O"));
            Run();
        }

        private static async void Audit()
        {
            var lines = new List<string>();
            string verdict;
            try
            {
                JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
                string siteId = server.Value<string>("site");
                RoaGameBootstrap bootstrap = await Until(() => RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.InGame
                    && RoaGameBootstrap.Active.Loader?.CurrentGroundRenderer != null ? RoaGameBootstrap.Active : null,
                    "вход в мир", 120f);
                Camera camera = bootstrap.CameraRig != null ? bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                Require(camera != null, "нет игровой камеры");
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                await Seconds(6f);

                KromkaSiteAuthoring site = UnityEngine.Object.FindObjectsByType<KromkaSiteAuthoring>(FindObjectsInactive.Include, FindObjectsSortMode.None)
                    .FirstOrDefault(row => row.SiteId == siteId);
                Require(site != null, "сцена сектора не принесла площадку " + siteId);
                int models = site.GetComponentsInChildren<Kromka.Authoring.KromkaPlacedObjectAuthoring>(true).Length;
                Require(models > 20, "на площадке мало моделей: " + models);
                GameObject line = GameObject.Find("SafeLine_" + siteId);
                Require(line != null, "клиент не провёл черту безопасного островка");
                int stripes = line.GetComponentsInChildren<MeshRenderer>(true).Count(renderer => renderer.enabled);
                Require(stripes == 4, "у черты островка не четыре полосы: " + stripes);
                RoaPlayerController controller = UnityEngine.Object.FindFirstObjectByType<RoaPlayerController>();
                Vector3 player = controller != null ? controller.transform.position : camera.transform.position;
                lines.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "site {0}: {1} models, safe line of {2} stripes, player at ({3:0.0}, {4:0.0}), site centre ({5:0.0}, {6:0.0})",
                    siteId, models, stripes, player.x, player.z, site.transform.position.x, site.transform.position.z));
                JObject zone = bootstrap.Socket?.Session?.Self?["zone"] as JObject;
                string standing = (zone?["site"] as JObject)?["id"]?.ToString() ?? "(нет)";
                lines.Add("self.zone.site: " + standing);

                Save(Capture(camera, 1600, 900), "site-desktop.png");
                Save(Capture(camera, 844, 390), "site-mobile.png");
                bootstrap.CameraRig.SetDistance(RoaCameraRig.MaximumGameplayDistance, false);
                await Seconds(3f);
                Save(Capture(camera, 1600, 900), "site-far-desktop.png");
                Save(Capture(camera, 844, 390), "site-far-mobile.png");
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                verdict = "PASS: " + string.Join(" | ", lines);
            }
            catch (Exception error)
            {
                verdict = "FAIL: " + error.Message + " | " + string.Join(" | ", lines);
            }
            File.WriteAllText(Path.Combine(Output, "result.txt"), verdict);
            Debug.Log("[SITE PLAY] " + verdict);
            EditorApplication.isPlaying = false;
        }

        private static Texture2D Capture(Camera camera, int width, int height)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            RenderTexture previousTarget = camera.targetTexture;
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                var image = new Texture2D(width, height, TextureFormat.RGB24, false);
                image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                image.Apply();
                return image;
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void Save(Texture2D image, string name)
        {
            Directory.CreateDirectory(Output);
            File.WriteAllBytes(Path.Combine(Output, name), image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
        }

        private static async Task<T> Until<T>(Func<T> probe, string what, float timeoutSeconds) where T : class
        {
            double deadline = EditorApplication.timeSinceStartup + timeoutSeconds;
            while (EditorApplication.timeSinceStartup < deadline)
            {
                if (!EditorApplication.isPlaying) throw new InvalidOperationException("Play Mode закончился раньше: " + what);
                T value = probe();
                if (value != null) return value;
                await Task.Yield();
            }
            throw new TimeoutException("не дождались: " + what);
        }

        private static async Task Seconds(float seconds)
        {
            double until = EditorApplication.timeSinceStartup + seconds;
            while (EditorApplication.timeSinceStartup < until) await Task.Yield();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
