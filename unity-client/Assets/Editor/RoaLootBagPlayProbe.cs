#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Мешок с добычей в живом клиенте. Нужен локальный сервер, где персонаж с
    /// оружием стоит на арене рядом с Гарью: адрес, логин и пароль лежат в
    /// Library/LootBagPlayProbe/server.json ({ baseUrl, login, password }). Проба
    /// убивает Гарь тем же экранным путём, что курсор, и проверяет, что видит
    /// игрок: мешок лежит своей моделью в шаге от тела, тело больше не цель
    /// обыска, а подсказка у мешка — «E — обыскать: Мешок — Гарь». Кадры 1600×900,
    /// 844×390 и крупный план — в той же папке.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaLootBagPlayProbe
    {
        private const string Key = "Roa.LootBagPlayProbe";
        private const string Tag = "[LOOT BAG PLAY]";
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/LootBagPlayProbe"));

        static RoaLootBagPlayProbe()
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

        [MenuItem("Realm of Ashes/Добыча/Проверить мешок в живом клиенте")]
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
                RoaGameBootstrap bootstrap = await Until(() => RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.InGame
                    && RoaGameBootstrap.Active.Loader?.CurrentGroundRenderer != null ? RoaGameBootstrap.Active : null,
                    "вход в мир", 120f);
                RoaEnemies enemies = bootstrap.Enemies;
                Camera camera = bootstrap.CameraRig != null ? bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                RoaPlayerController local = UnityEngine.Object.FindObjectsByType<RoaPlayerController>(FindObjectsSortMode.None)
                    .FirstOrDefault(controller => controller.gameObject.scene.IsValid());
                Require(enemies != null && camera != null && local != null, "нет вида NPC, камеры или своего персонажа");

                // Гарь идёт на персонажа; выстрел тем же путём, что курсор, пока она не ляжет.
                JObject gari = await Until(() => Snapshots(enemies).FirstOrDefault(row => row.Value<string>("creatureTypeId") == "gari"),
                    "Гарь на арене", 40f);
                string gariId = gari.Value<string>("id");
                bool dead = false;
                for (int shots = 0; shots < 12 && !dead; )
                {
                    Require(enemies.TryGetPosition(gariId, out Vector3 aim), "Гарь пропала");
                    Vector3 screen = Camera.main.WorldToScreenPoint(aim + Vector3.up * 0.4f);
                    if (bootstrap.Combat.TriggerAttackAtScreenPoint(new Vector2(screen.x, screen.y))) shots++;
                    await Seconds(1.1f);
                    dead = !enemies.TryGetSnapshot(gariId, out _) && enemies.TryGetPosition(gariId, out _);
                }
                Require(dead, "Гарь не убита: " + string.Join(" / ", bootstrap.Combat.LogLines.Skip(Math.Max(0, bootstrap.Combat.LogLines.Count - 4))));
                Require(enemies.TryGetPosition(gariId, out Vector3 bodyPosition), "нет тела Гари");

                // Мешок: свой контейнер со своей моделью в шаге от тела.
                GameObject bag = await Until(() => GameObject.Find("WorldContainer:bag_" + gariId), "мешок Гари в сцене", 10f);
                Renderer[] renderers = await Until(() =>
                {
                    Transform model = bag.transform.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "LootBag");
                    Renderer[] found = model != null ? model.GetComponentsInChildren<Renderer>(false).Where(r => r.enabled).ToArray() : null;
                    return found != null && found.Length > 0 ? found : null;
                }, "модель мешка", 10f);
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                float step = Flat(bag.transform.position, bodyPosition);
                lines.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "sack {0} model {1:0.00}x{2:0.00}x{3:0.00} at {4:0.00} m from the body", bag.name,
                    bounds.size.x, bounds.size.y, bounds.size.z, step));
                Require(step > 0.3f && step < 1.5f, "мешок не в шаге от тела: " + step);
                Require(bounds.size.y > 0.1f && bounds.size.y < 1.2f, "мешок не того размера: " + bounds.size);

                // Тело больше не цель обыска; у мешка подсказка обыска.
                Require(!enemies.TryFindInteractable(bodyPosition, 1f, out JObject bodyTarget, out _)
                    || bodyTarget?.Value<string>("id") != gariId, "пустое тело всё ещё предлагает обыск");
                string hint = await Until(() =>
                {
                    string text = bootstrap.Interaction?.InteractionHint ?? string.Empty;
                    return text.Contains("Мешок") ? text : null;
                }, "подсказка у мешка", 6f);
                lines.Add("hint '" + hint + "'");
                Require(hint.Contains("обыскать: Мешок — Гарь"), "подсказка у мешка: " + hint);

                Save(GameView(camera, bag.transform.position, local.transform.position, 1600, 900), "sack-desktop.png");
                Save(GameView(camera, bag.transform.position, local.transform.position, 844, 390), "sack-mobile.png");
                Save(CloseUp(bag.transform.position, bootstrap.Loader.CurrentGroundRenderer), "sack-closeup.png");
                verdict = "PASS: " + string.Join(" | ", lines);
                Debug.Log(Tag + " " + verdict);
            }
            catch (Exception error)
            {
                verdict = "FAIL: " + error.Message + (lines.Count > 0 ? " | " + string.Join(" | ", lines) : string.Empty);
                Debug.LogError(Tag + " " + verdict + "\n" + error);
            }
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, "result.txt"), verdict, new UTF8Encoding(false));
            EditorApplication.isPlaying = false;
        }

        private static List<JObject> Snapshots(RoaEnemies enemies)
        {
            var rows = new List<JObject>();
            enemies.CollectPublicSnapshots(rows);
            return rows;
        }

        private static float Flat(Vector3 a, Vector3 b) => Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));

        /// <summary>Крупный план игровым наклоном: мешок, тело и туша рядом, стены и кусты не мешают.</summary>
        private static Texture2D CloseUp(Vector3 focus, Renderer ground)
        {
            const int layer = 31;
            var saved = new List<KeyValuePair<GameObject, int>>();
            foreach (Renderer renderer in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!renderer.enabled || !renderer.gameObject.scene.IsValid()) continue;
                bool near = Flat(renderer.bounds.center, focus) < 2.2f && renderer.bounds.size.y < 1.6f;
                if (!near && renderer != ground) continue;
                saved.Add(new KeyValuePair<GameObject, int>(renderer.gameObject, renderer.gameObject.layer));
            }
            var root = new GameObject("LootBagCloseUp");
            try
            {
                foreach (KeyValuePair<GameObject, int> row in saved) row.Key.layer = layer;
                Camera camera = root.AddComponent<Camera>();
                camera.cullingMask = 1 << layer;
                camera.fieldOfView = 34f;
                camera.nearClipPlane = 0.05f;
                camera.transform.position = focus + new Vector3(1.8f, 2.0f, -1.8f);
                camera.transform.LookAt(focus + Vector3.up * 0.2f);
                return Capture(camera, 900, 600);
            }
            finally
            {
                foreach (KeyValuePair<GameObject, int> row in saved) if (row.Key != null) row.Key.layer = row.Value;
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>Кадр игровым ракурсом с мешком в центре; крыши рядом гасятся на время кадра.</summary>
        private static Texture2D GameView(Camera game, Vector3 focus, Vector3 player, int width, int height)
        {
            var hidden = new List<Renderer>();
            foreach (Renderer renderer in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!renderer.enabled || !renderer.gameObject.scene.IsValid()) continue;
                if (renderer.bounds.max.y < focus.y + 2.2f || Flat(renderer.bounds.center, focus) > 18f) continue;
                renderer.enabled = false;
                hidden.Add(renderer);
            }
            var root = new GameObject("LootBagGameView");
            try
            {
                Camera camera = root.AddComponent<Camera>();
                camera.CopyFrom(game);
                camera.transform.SetPositionAndRotation(game.transform.position + (focus - player), game.transform.rotation);
                return Capture(camera, width, height);
            }
            finally
            {
                foreach (Renderer renderer in hidden) if (renderer != null) renderer.enabled = true;
                UnityEngine.Object.DestroyImmediate(root);
            }
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
