#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Проводник в живом клиенте. Нужен локальный сервер, где персонаж налегке (без
    /// экипировки, с пустым рюкзаком) стоит в городе фракции рядом с проводником: адрес,
    /// логин и пароль лежат в Library/ConductorPlayProbe/server.json ({ baseUrl, login,
    /// password }). Проба входит в игру авто-входом и проверяет то, что видит игрок:
    /// проводник — человек в куртке и с рюкзаком (не голое тело и не мутант), подсказка
    /// «E — поговорить: Проводник»; E открывает карту мира в режиме проводника с четырьмя
    /// подсвеченными городами-кнопками в кадре, без наложений и с условием под шапкой;
    /// нажатие на город переносит персонажа туда, и карта закрывается. Кадры проводника,
    /// карты 1600×900 и 1688×780 (телефон в ландшафте, 844×390 при DPR 2) — в той же папке.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaConductorPlayProbe
    {
        private const string Key = "Roa.ConductorPlayProbe";
        private const string Tag = "[CONDUCTOR PLAY]";
        private const int UiLayer = 31;
        private const float MinTextPixels = 11f;
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/ConductorPlayProbe"));

        static RoaConductorPlayProbe()
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
                    DateTimeStyles.RoundtripKind);
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

        [MenuItem("Realm of Ashes/Probe/Conductor in the live client")]
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
                string fromCity = bootstrap.Loader.Current?.Id ?? string.Empty;
                RoaEnemies enemies = bootstrap.Enemies;
                Camera camera = bootstrap.CameraRig != null ? bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                Require(enemies != null && camera != null && bootstrap.Interaction != null && bootstrap.WorldOverview != null,
                    "нет NPC, камеры, взаимодействия или карты мира");
                RoaPlayerController local = UnityEngine.Object.FindObjectsByType<RoaPlayerController>(FindObjectsSortMode.None)
                    .FirstOrDefault(controller => controller.gameObject.scene.IsValid());
                Require(local != null, "нет своего персонажа");
                Transform player = local.transform;

                // Проводник: человек (не мутант), в наряде и с услугой, по которой клиент открывает карту.
                JObject conductor = await Until(() => Conductor(enemies), "проводник в городе", 40f);
                string id = conductor.Value<string>("id");
                Require(conductor.Value<string>("name") == "Проводник", "имя проводника: " + conductor.Value<string>("name"));
                Require(string.IsNullOrEmpty(conductor.Value<string>("creatureTypeId")), "проводник — мутант " + conductor.Value<string>("creatureTypeId"));
                GameObject body = await Until(() => Body(enemies, id), "модель проводника", 60f);
                await Seconds(2f);
                Bounds bounds = RendererBounds(body);
                Require(enemies.TryGetPosition(id, out Vector3 at), "нет позиции проводника");
                RoaCharacterView view = body.GetComponentInChildren<RoaCharacterView>(true);
                Require(view != null, "проводник нарисован не телом персонажа");
                string[] meshes = body.GetComponentsInChildren<Renderer>(false).Where(renderer => renderer.enabled)
                    .Select(renderer => renderer.name).Distinct().ToArray();
                lines.Add(string.Format(CultureInfo.InvariantCulture, "conductor {0} in {1}: {2:0.00} m tall, {3} meshes, equipment {4}",
                    id, fromCity, bounds.size.y, meshes.Length, conductor["equipment"]?.ToString(Newtonsoft.Json.Formatting.None)));
                lines.Add("meshes: " + string.Join(", ", meshes));
                Require(bounds.size.y > 1.4f && bounds.size.y < 2.3f, "проводник не человеческого роста: " + bounds.size.y);
                Require(conductor["equipment"]?.Value<string>("armor") == "leather" && conductor["equipment"]?.Value<string>("backpack") == "backpack",
                    "проводник без куртки или рюкзака");
                Save(CloseUp(body, bounds, bootstrap.Loader.CurrentGroundRenderer), "conductor-closeup.png");
                Save(GameView(camera, at, player.position, 1600, 900), "conductor-city.png");

                // Подсказка и E: карта мира у проводника, а не окно услуг.
                string hint = await Until(() => bootstrap.Interaction.InteractionHint.Contains("Проводник")
                    ? bootstrap.Interaction.InteractionHint : null, "подсказка у проводника", 10f);
                lines.Add("hint '" + hint + "'");
                Require(hint.Contains("поговорить: Проводник"), "подсказка: " + hint);
                bootstrap.Interaction.TriggerInteract();
                RoaWorldOverviewCanvas map = bootstrap.WorldOverview;
                await Until(() => map.TravelMode && map.Uses3D ? map : null, "карта мира у проводника", 60f);
                await Seconds(1.5f);
                Require(!bootstrap.Interaction.ServiceOpen && !bootstrap.Interaction.NpcOpen, "вместе с картой открылось окно услуг");
                lines.Add("banner '" + map.TravelBannerText.Replace("\n", " / ") + "'");
                Require(map.TravelBannerText.StartsWith(RoaWorldOverviewCanvas.TravelRules, StringComparison.Ordinal), "нет условия проводника под шапкой");
                Require(map.TravelBannerText.Contains("Выберите подсвеченный город."), "персонажу налегке карта называет помеху: " + map.TravelBannerText);

                List<string> targets = null;
                foreach ((string file, int width, int height, bool mobile) in new[]
                {
                    ("map-desktop.png", 1600, 900, false),
                    ("map-mobile.png", 1688, 780, true)
                })
                {
                    List<string> seen = CaptureMap(map, file, width, height, mobile, lines);
                    Require(seen.Count == 4, $"{file}: {seen.Count} городов-кнопок, нужно 4");
                    Require(!seen.Contains(fromCity), file + ": кнопка ведёт в свой же город");
                    targets = targets ?? seen;
                }

                // Персонаж с вещами видит ту же карту, но строка под шапкой сразу называет
                // помеху (blocked) — ещё до нажатия на город.
                JObject list = await Ack(done => RoaTerritoryNet.RequestFastTravel(bootstrap.Socket, done), "список проводника");
                Require(list?.Value<bool?>("ok") == true && string.IsNullOrEmpty(list.Value<string>("blocked")),
                    "сервер не пускает персонажа налегке: " + list);
                const string Blocked = "Рюкзак должен быть пуст («Лом» и ещё 2): вещи оставляют в хранилище города.";
                var loaded = (JObject)list.DeepClone();
                loaded["blocked"] = Blocked;
                map.OpenForTravel(loaded);
                await Seconds(0.8f);
                Require(map.TravelMode && map.TravelBannerText.Contains(Blocked), "карта не назвала помеху: " + map.TravelBannerText);
                CaptureMap(map, "map-blocked-desktop.png", 1600, 900, false, lines);
                CaptureMap(map, "map-blocked-mobile.png", 1688, 780, true, lines);
                map.OpenForTravel(list);
                await Seconds(0.8f);

                // Нажатие на город: сервер переносит персонажа, карта закрывается.
                string target = targets[0];
                Button button = map.GetComponentsInChildren<Button>(false).First(b => b.name == "Travel:" + target);
                button.onClick.Invoke();
                Require(map.LastTravelTarget == target, "кнопка не попросила дорогу в " + target);
                await Until(() => bootstrap.Loader.Current?.Id == target && bootstrap.InGame
                    && bootstrap.Loader.CurrentGroundRenderer != null ? bootstrap.Loader.Current : null, "прибытие в " + target, 60f);
                Require(!map.IsOpen, "карта осталась открытой после дороги");
                lines.Add("travelled " + fromCity + " -> " + target);
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

        /// <summary>Запрос с ответом через ack: ждать ответа, как ждёт его окно.</summary>
        private static async Task<JObject> Ack(Func<Action<JObject>, bool> send, string what)
        {
            JObject result = null;
            bool answered = false;
            Require(send(ack => { result = ack; answered = true; }), "не отправлено: " + what);
            await Until(() => answered ? new object() : null, what, 15f);
            return result;
        }

        private static JObject Conductor(RoaEnemies enemies)
        {
            var rows = new List<JObject>();
            enemies.CollectPublicSnapshots(rows);
            return rows.FirstOrDefault(row => row.Value<string>("service") == "fastTravel" && row.Value<bool?>("dead") != true);
        }

        /// <summary>Корень NPC проводника с загруженным телом (есть включённые рендереры).</summary>
        private static GameObject Body(RoaEnemies enemies, string id)
        {
            if (!enemies.TryGetPosition(id, out Vector3 position)) return null;
            foreach (Transform root in enemies.transform)
            {
                if (!root.name.StartsWith("Enemy:", StringComparison.Ordinal)) continue;
                if (Vector3.Distance(root.position, position) > 0.05f) continue;
                if (root.GetComponentsInChildren<Renderer>(false).Any(renderer => renderer.enabled && renderer is SkinnedMeshRenderer))
                    return root.gameObject;
            }
            return null;
        }

        /// <summary>
        /// Кадр карты: 3D-сцена своей камерой и окно в ScreenSpaceCamera поверх, сложенные
        /// по альфе окна. Проверяет кнопки городов: в кадре между шапкой и нижней строкой,
        /// друг на друга не лезут, имя влезает, текст не мельче MinTextPixels. Возвращает
        /// города с видимыми кнопками.
        /// </summary>
        private static List<string> CaptureMap(RoaWorldOverviewCanvas map, string file, int width, int height, bool mobile, List<string> lines)
        {
            Canvas canvas = map.GetComponentsInChildren<Canvas>(true).First(c => c.name == "WorldOverviewCanvas");
            CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
            Camera mapCamera = map.Map3D.MapCamera;
            var mapTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var uiTarget = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var uiCamera = new GameObject("ConductorProbeUiCamera").AddComponent<Camera>();
            RenderTexture keepMapTarget = mapCamera.targetTexture;
            var layers = canvas.GetComponentsInChildren<Transform>(true).Select(node => (node, node.gameObject.layer)).ToList();
            try
            {
                uiCamera.enabled = false;
                uiCamera.clearFlags = CameraClearFlags.SolidColor;
                uiCamera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                uiCamera.cullingMask = 1 << UiLayer;
                uiCamera.targetTexture = uiTarget;
                mapCamera.targetTexture = mapTarget;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = uiCamera;
                canvas.planeDistance = 1f;
                foreach (var (node, _) in layers) node.gameObject.layer = UiLayer;
                RoaUiScale.Apply(scaler, mobile);
                scaler.enabled = false;
                scaler.enabled = true;
                Canvas.ForceUpdateCanvases();
                map.LayoutTravelForProbe();
                Canvas.ForceUpdateCanvases();

                var canvasRect = ((RectTransform)canvas.transform).rect;
                float scale = canvas.scaleFactor;
                var buttons = map.GetComponentsInChildren<Button>(false).Where(b => b.name.StartsWith("Travel:", StringComparison.Ordinal)).ToList();
                // Компас и полоса условий: кнопки городов не должны лезть под них.
                var fixedRects = new List<(string what, Rect rect)>();
                foreach (string name in new[] { "Compass", "TravelBanner" })
                {
                    RectTransform element = canvas.GetComponentsInChildren<RectTransform>(false).FirstOrDefault(r => r.name == name);
                    Require(element != null, file + ": нет " + name);
                    fixedRects.Add((name, CanvasRect(canvas, element)));
                }
                Require(fixedRects[0].rect.yMax <= fixedRects[1].rect.yMin + 0.5f, file + ": полоса условий закрывает компас");
                var rects = new List<(string city, Rect rect)>();
                foreach (Button button in buttons)
                {
                    Rect rect = CanvasRect(canvas, (RectTransform)button.transform);
                    string city = button.name.Substring("Travel:".Length);
                    // Кнопка целиком между шапкой с полосой условий (112) и нижней строкой (48).
                    Require(rect.xMin >= canvasRect.xMin && rect.xMax <= canvasRect.xMax
                        && rect.yMin >= canvasRect.yMin + 48f && rect.yMax <= canvasRect.yMax - 112f,
                        $"{file}: кнопка {city} вне кадра карты: {rect} в {canvasRect}");
                    foreach ((string other, Rect otherRect) in rects.Concat(fixedRects))
                        Require(!rect.Overlaps(otherRect), $"{file}: кнопка {city} налезает на {other}");
                    foreach (Text text in button.GetComponentsInChildren<Text>(true))
                    {
                        Require(text.preferredWidth <= text.rectTransform.rect.width + 0.5f,
                            $"{file}: «{text.text}» не влезает в кнопку ({text.preferredWidth:0} > {text.rectTransform.rect.width:0})");
                        Require(text.fontSize * scale >= MinTextPixels, $"{file}: «{text.text}» мельче {MinTextPixels} px ({text.fontSize * scale:0.0})");
                    }
                    rects.Add((city, rect));
                }

                Color32[] mapPixels = RenderPixels(mapCamera, mapTarget, width, height);
                Color32[] uiPixels = RenderPixels(uiCamera, uiTarget, width, height);
                var composed = new Texture2D(width, height, TextureFormat.RGB24, false);
                var result = new Color32[mapPixels.Length];
                for (int i = 0; i < result.Length; i++) result[i] = Color32.Lerp(mapPixels[i], uiPixels[i], uiPixels[i].a / 255f);
                composed.SetPixels32(result);
                composed.Apply();
                Directory.CreateDirectory(Output);
                File.WriteAllBytes(Path.Combine(Output, file), composed.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(composed);
                lines.Add(string.Format(CultureInfo.InvariantCulture, "{0}: scale {1:0.00}, cities {2}", file, scale,
                    string.Join(", ", rects.Select(row => row.city + "@" + row.rect.center.x.ToString("0") + "," + row.rect.center.y.ToString("0")))));
                return rects.Select(row => row.city).ToList();
            }
            finally
            {
                mapCamera.targetTexture = keepMapTarget;
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                canvas.worldCamera = null;
                foreach ((Transform node, int layer) in layers) if (node != null) node.gameObject.layer = layer;
                RoaUiScale.Apply(scaler);
                scaler.enabled = false;
                scaler.enabled = true;
                UnityEngine.Object.DestroyImmediate(uiCamera.gameObject);
                mapTarget.Release();
                uiTarget.Release();
                UnityEngine.Object.DestroyImmediate(mapTarget);
                UnityEngine.Object.DestroyImmediate(uiTarget);
            }
        }

        /// <summary>Прямоугольник элемента в координатах канвы (начало — её центр).</summary>
        private static Rect CanvasRect(Canvas canvas, RectTransform element)
        {
            var corners = new Vector3[4];
            element.GetWorldCorners(corners);
            Vector3 min = canvas.transform.InverseTransformPoint(corners[0]);
            Vector3 max = canvas.transform.InverseTransformPoint(corners[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        private static Color32[] RenderPixels(Camera camera, RenderTexture target, int width, int height)
        {
            var request = new UnityEngine.Rendering.Universal.UniversalRenderPipeline.SingleCameraRequest { destination = target };
            if (UnityEngine.Rendering.RenderPipeline.SupportsRenderRequest(camera, request))
                UnityEngine.Rendering.RenderPipeline.SubmitRenderRequest(camera, request);
            else
                camera.Render();
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = target;
            var image = new Texture2D(width, height, TextureFormat.RGBA32, false);
            image.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            Color32[] pixels = image.GetPixels32();
            UnityEngine.Object.DestroyImmediate(image);
            return pixels;
        }

        private static Bounds RendererBounds(GameObject body)
        {
            Renderer[] renderers = body.GetComponentsInChildren<Renderer>(false)
                .Where(renderer => renderer.enabled && !(renderer is ParticleSystemRenderer)).ToArray();
            Require(renderers.Length > 0, "у проводника нет видимых рендереров");
            Bounds bounds = renderers[0].bounds;
            foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        /// <summary>Крупный план спереди-сбоку: в кадре только проводник и земля локации (слой пробы).</summary>
        private static Texture2D CloseUp(GameObject body, Bounds bounds, Renderer ground)
        {
            const int layer = 31;
            var saved = new List<KeyValuePair<GameObject, int>>();
            foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
                saved.Add(new KeyValuePair<GameObject, int>(node.gameObject, node.gameObject.layer));
            if (ground != null) saved.Add(new KeyValuePair<GameObject, int>(ground.gameObject, ground.gameObject.layer));
            var root = new GameObject("ConductorCloseUp");
            try
            {
                foreach (KeyValuePair<GameObject, int> row in saved) row.Key.layer = layer;
                Camera camera = root.AddComponent<Camera>();
                camera.cullingMask = 1 << layer;
                camera.fieldOfView = 30f;
                camera.nearClipPlane = 0.05f;
                Vector3 facing = Vector3.ProjectOnPlane(body.transform.forward, Vector3.up).normalized;
                if (facing.sqrMagnitude < 0.5f) facing = Vector3.back;
                Vector3 side = Vector3.Cross(Vector3.up, facing);
                camera.transform.position = bounds.center + facing * 3f + side * 1.3f + Vector3.up * 0.9f;
                camera.transform.LookAt(bounds.center);
                return Capture(camera, 700, 900);
            }
            finally
            {
                foreach (KeyValuePair<GameObject, int> row in saved) if (row.Key != null) row.Key.layer = row.Value;
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /// <summary>Кадр игровым ракурсом с проводником в центре; крыши и высокие стены рядом гасятся.</summary>
        private static Texture2D GameView(Camera game, Vector3 focus, Vector3 player, int width, int height)
        {
            var hidden = new List<Renderer>();
            foreach (Renderer renderer in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!renderer.enabled || !renderer.gameObject.scene.IsValid()) continue;
                Bounds box = renderer.bounds;
                if (box.max.y < focus.y + 2.6f || Flat(box.center, focus) > 18f) continue;
                renderer.enabled = false;
                hidden.Add(renderer);
            }
            var root = new GameObject("ConductorGameView");
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

        private static float Flat(Vector3 a, Vector3 b) => Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));

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
