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
    /// Городская живность в живом клиенте. Нужен локальный сервер, где персонаж с
    /// оружием стоит в городе у места крысюка: адрес, логин и пароль лежат в
    /// Library/CityCritterPlayProbe/server.json ({ baseUrl, login, password }).
    /// Проба входит в игру авто-входом и проверяет, что видит игрок: крысюк
    /// стоит своей моделью (не заглушкой) на земле, у модели шесть клипов, табличка
    /// «Крысюк / ДОБЫЧА» низко над зверьком; выстрел тем же экранным путём, что у
    /// курсора, в мирном городе ранит или убивает его, а убитого сменяет новый.
    /// Кадры 1600×900 и 844×390 (телефон в ландшафте) и крупный план — в той же папке.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaCityCritterPlayProbe
    {
        private const string Key = "Roa.CityCritterPlayProbe";
        private const string Tag = "[CITY CRITTER PLAY]";
        private static readonly string[] Clips = { "idle", "walk", "run", "attack", "hurt", "death" };
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/CityCritterPlayProbe"));

        static RoaCityCritterPlayProbe()
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

        [MenuItem("Realm of Ashes/Живность/Проверить крысюков в живом клиенте")]
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
                Require(enemies != null && camera != null, "нет вида NPC или игровой камеры");
                RoaPlayerController local = UnityEngine.Object.FindObjectsByType<RoaPlayerController>(FindObjectsSortMode.None)
                    .FirstOrDefault(controller => controller.gameObject.scene.IsValid());
                Require(local != null, "нет своего персонажа");
                Transform player = local.transform;

                // Крысюк рядом: модель загружена своей, не заглушкой, и анимация играет.
                JObject rat = await Until(() => NearestRat(enemies, player.position, 12f), "крысюк рядом", 40f);
                string ratId = rat.Value<string>("id");
                GameObject body = await Until(() => RatBody(enemies, ratId), "модель крысюка", 60f);
                await Seconds(1.5f);
                Animation animation = body.GetComponentInChildren<Animation>(true);
                Require(animation != null, "у модели крысюка нет Animation");
                var missing = Clips.Where(clip => animation.GetClip(clip) == null).ToList();
                Require(missing.Count == 0, "у модели крысюка нет клипов: " + string.Join(", ", missing));
                Bounds bounds = RendererBounds(body);
                Require(enemies.TryGetPosition(ratId, out Vector3 ratPosition), "нет позиции крысюка");
                float ground = bootstrap.Loader.CurrentGroundRenderer.bounds.max.y;
                lines.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "rat {0} size {1:0.00}x{2:0.00}x{3:0.00}, feet {4:0.00} over ground {5:0.00}, playing {6}",
                    ratId, bounds.size.x, bounds.size.y, bounds.size.z, bounds.min.y, ground, CurrentClip(animation)));
                Require(bounds.size.y > 0.18f && bounds.size.y < 0.5f, "крысюк не того роста: " + bounds.size.y);
                Require(Mathf.Max(bounds.size.x, bounds.size.z) > 0.6f && Mathf.Max(bounds.size.x, bounds.size.z) < 1.3f,
                    "крысюк не той длины: " + bounds.size);
                Require(Mathf.Abs(bounds.min.y - ratPosition.y) < 0.12f, "крысюк висит над землёй или провалился: "
                    + bounds.min.y + " / " + ratPosition.y);
                Require(!string.IsNullOrEmpty(CurrentClip(animation)), "анимация крысюка не играет");

                // Табличка: имя, «добыча», висит над зверьком, а не на двух метрах.
                var plates = new List<RoaActorNameplates.Entry>();
                enemies.CollectNameplates(plates, player.position, 40f);
                RoaActorNameplates.Entry plate = plates.FirstOrDefault(row => row.Key == "npc:" + ratId);
                Require(plate.Key != null, "у крысюка нет таблички");
                lines.Add("plate '" + plate.Name + "' / '" + plate.Faction + "' at +"
                    + (plate.World.y - ratPosition.y).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
                Require(plate.Name == "Крысюк", "имя на табличке: " + plate.Name);
                Require(plate.Faction.StartsWith("ДОБЫЧА", StringComparison.Ordinal), "строка таблички: " + plate.Faction);
                Require(!plate.Hostile, "крысюк на табличке враг");
                Require(plate.World.y - ratPosition.y < 1.3f, "табличка висит высоко над крысюком");

                Save(GameView(camera, ratPosition, player.position, 1600, 900), "city-desktop.png");
                Save(GameView(camera, ratPosition, player.position, 844, 390), "city-mobile.png");
                Save(CloseUp(body, bounds, bootstrap.Loader.CurrentGroundRenderer), "rat-closeup.png");

                // Выстрел тем же путём, что у курсора: в мирном городе крысюк — добыча.
                var seen = new List<JObject>();
                enemies.CollectPublicSnapshots(seen);
                var ratsBefore = new HashSet<string>(seen.Where(row => row.Value<string>("creatureTypeId") == "rat")
                    .Select(row => row.Value<string>("id")));
                int shots = 0;
                bool dead = false;
                JObject after = null;
                while (shots < 6)
                {
                    Require(enemies.TryGetPosition(ratId, out Vector3 aim), "крысюк пропал до выстрела");
                    Vector3 screen = Camera.main.WorldToScreenPoint(aim + Vector3.up * 0.15f);
                    if (bootstrap.Combat.TriggerAttackAtScreenPoint(new Vector2(screen.x, screen.y))) shots++;
                    await Seconds(1.2f);
                    // Снимок мёртвого клиент больше не отдаёт, а тушка ещё лежит в сцене.
                    if (!enemies.TryGetSnapshot(ratId, out after)) { dead = enemies.TryGetPosition(ratId, out _); break; }
                    if (after.Value<int?>("hp") < after.Value<int?>("maxHp") || after.Value<string>("aiState") == "flee") break;
                }
                IReadOnlyList<string> combatLog = bootstrap.Combat.LogLines;
                lines.Add("combat log: " + string.Join(" / ", combatLog.Skip(Math.Max(0, combatLog.Count - 4))));
                Require(dead || after != null, "крысюк пропал после выстрела");
                lines.Add("after " + shots + " shot(s): " + (dead ? "dead, playing " + CurrentClip(animation)
                    : "hp " + after.Value<int?>("hp") + "/" + after.Value<int?>("maxHp") + ", aiState " + after.Value<string>("aiState")));
                Require(dead || after.Value<int?>("hp") < after.Value<int?>("maxHp") || after.Value<string>("aiState") == "flee",
                    "выстрел в мирном городе не задел крысюка");
                Require(dead || after.Value<bool?>("hostileToPlayer") != true, "раненый крысюк стал врагом");
                Require(!dead || CurrentClip(animation) == "death", "убитый крысюк не играет смерть: " + CurrentClip(animation));
                await Seconds(1.2f);
                Save(CloseUp(body, RendererBounds(body), bootstrap.Loader.CurrentGroundRenderer),
                    dead ? "rat-dead-closeup.png" : "rat-hit-closeup.png");

                if (dead)
                {
                    // Убитого сменяет новый: срок возрождения задаёт сервер проверки.
                    JObject reborn = await Until(() =>
                    {
                        var rows = new List<JObject>();
                        enemies.CollectPublicSnapshots(rows);
                        return rows.FirstOrDefault(row => row.Value<string>("creatureTypeId") == "rat"
                            && !ratsBefore.Contains(row.Value<string>("id")));
                    }, "новый крысюк на месте убитого", 30f);
                    lines.Add("reborn " + reborn.Value<string>("id") + " at "
                        + Flat(Position(reborn), ratPosition).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " m");
                    Require(Flat(Position(reborn), ratPosition) < 9f, "новый крысюк появился не на месте убитого");
                }
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

        private static JObject NearestRat(RoaEnemies enemies, Vector3 origin, float maxDistance)
        {
            var rows = new List<JObject>();
            enemies.CollectPublicSnapshots(rows);
            return rows.Where(row => row.Value<string>("creatureTypeId") == "rat" && row.Value<bool?>("dead") != true)
                .Where(row => Flat(Position(row), origin) < maxDistance)
                .OrderBy(row => Flat(Position(row), origin))
                .FirstOrDefault();
        }

        private static Vector3 Position(JObject row) => RoaCoords.ToUnity(row.Value<float>("x"), row.Value<float>("z"));

        private static float Flat(Vector3 a, Vector3 b) => Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));

        /// <summary>Корень NPC крысюка с загруженной своей моделью (узел EnemyModel:* с рендерерами).</summary>
        private static GameObject RatBody(RoaEnemies enemies, string ratId)
        {
            if (!enemies.TryGetPosition(ratId, out Vector3 position)) return null;
            foreach (Transform root in enemies.transform)
            {
                if (!root.name.StartsWith("Enemy:", StringComparison.Ordinal)) continue;
                if (Vector3.Distance(root.position, position) > 0.05f) continue;
                Transform model = root.GetComponentsInChildren<Transform>(true)
                    .FirstOrDefault(node => node.name.StartsWith("EnemyModel:", StringComparison.Ordinal));
                if (model != null && model.GetComponentsInChildren<Renderer>(false).Any(renderer => renderer.enabled))
                    return root.gameObject;
            }
            return null;
        }

        private static Bounds RendererBounds(GameObject body)
        {
            Renderer[] renderers = body.GetComponentsInChildren<Renderer>(false)
                .Where(renderer => renderer.enabled && !(renderer is ParticleSystemRenderer)).ToArray();
            Require(renderers.Length > 0, "у крысюка нет видимых рендереров");
            Bounds bounds = renderers[0].bounds;
            foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static string CurrentClip(Animation animation)
        {
            foreach (AnimationState state in animation)
                if (animation.IsPlaying(state.name)) return state.name;
            return string.Empty;
        }

        /// <summary>
        /// Крупный план с игровым наклоном камеры: в кадре только зверёк и земля
        /// локации (слой пробы), чтобы куст или стена двора не закрыли модель.
        /// </summary>
        private static Texture2D CloseUp(GameObject body, Bounds bounds, Renderer ground)
        {
            const int layer = 31;
            var saved = new List<KeyValuePair<GameObject, int>>();
            foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
                saved.Add(new KeyValuePair<GameObject, int>(node.gameObject, node.gameObject.layer));
            if (ground != null) saved.Add(new KeyValuePair<GameObject, int>(ground.gameObject, ground.gameObject.layer));
            var root = new GameObject("CityCritterCloseUp");
            try
            {
                foreach (KeyValuePair<GameObject, int> row in saved) row.Key.layer = layer;
                Camera camera = root.AddComponent<Camera>();
                camera.cullingMask = 1 << layer;
                camera.fieldOfView = 30f;
                camera.nearClipPlane = 0.05f;
                camera.transform.position = bounds.center + new Vector3(1.25f, 1.35f, -1.25f);
                camera.transform.LookAt(bounds.center);
                return Capture(camera, 900, 600);
            }
            finally
            {
                foreach (KeyValuePair<GameObject, int> row in saved) if (row.Key != null) row.Key.layer = row.Value;
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>
        /// Кадр игровым ракурсом с крысюком в центре. Крыши и высокие стены рядом
        /// гасятся на время кадра, как их гасит срез крыш у персонажа: иначе камера
        /// у дома снимает только кровлю.
        /// </summary>
        private static Texture2D GameView(Camera game, Vector3 focus, Vector3 player, int width, int height)
        {
            var hidden = new List<Renderer>();
            foreach (Renderer renderer in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!renderer.enabled || !renderer.gameObject.scene.IsValid()) continue;
                Bounds box = renderer.bounds;
                if (box.max.y < focus.y + 2.2f || Flat(box.center, focus) > 18f) continue;
                renderer.enabled = false;
                hidden.Add(renderer);
            }
            var root = new GameObject("CityCritterGameView");
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
