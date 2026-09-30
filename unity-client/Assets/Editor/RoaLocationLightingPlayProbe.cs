#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Свет локации в живом клиенте. Нужен локальный сервер с DEV_API_MODE=local и
    /// персонаж в проверяемой локации: адрес, логин, пароль и id локации лежат в
    /// Library/LocationLightingPlayProbe/server.json ({ baseUrl, login, password, location }).
    /// Проба входит в игру авто-входом и снимает кадр игровой камеры (1600×900 и
    /// 844×390 — телефон в ландшафте), кадр с дальней камеры и для разбора кадр
    /// без оттенка земли. Если авторский профиль локации тёплый
    /// (солнце, небо и заполняющий свет краснее, чем синее), кадр обязан быть тёплым:
    /// ни земля, ни весь кадр не уходят в синеву.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaLocationLightingPlayProbe
    {
        private const string Key = "Roa.LocationLightingPlayProbe";
        private const string Tag = "[LOCATION LIGHT]";
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/LocationLightingPlayProbe"));

        static RoaLocationLightingPlayProbe()
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

        [MenuItem("Realm of Ashes/Освещение/Проверить свет локации в живом клиенте")]
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

        private struct FrameColor
        {
            public Color Whole;
            public Color Lower;
            public Color Player;
        }

        private static async void Audit()
        {
            var lines = new List<string>();
            string verdict;
            try
            {
                JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
                string expected = server.Value<string>("location") ?? string.Empty;
                RoaGameBootstrap bootstrap = await Until(() => RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.InGame
                    && RoaGameBootstrap.Active.Lighting != null && RoaGameBootstrap.Active.Lighting.LocalWorldActive
                    && RoaGameBootstrap.Active.Loader?.CurrentGroundRenderer != null ? RoaGameBootstrap.Active : null,
                    "вход в мир", 150f);
                LocationDefinition location = bootstrap.Loader.Current;
                Require(location != null && location.Id == expected,
                    "игрок не в проверяемой локации: " + (location?.Id ?? "<нет>") + " вместо " + expected);
                Camera camera = bootstrap.CameraRig != null ? bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                Require(camera != null, "нет игровой камеры");
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                await Seconds(5f);

                RoaWorldLighting lighting = bootstrap.Lighting;
                RoaWorldLighting.LightingSample sample = lighting.CurrentSample;
                Renderer ground = bootstrap.Loader.CurrentGroundRenderer;
                var block = new MaterialPropertyBlock();
                ground.GetPropertyBlock(block, 0);
                Color groundTint = block.HasColor(BaseColorId) ? block.GetColor(BaseColorId) : Color.white;
                Color groundMaterial = ground.sharedMaterial.HasProperty(BaseColorId)
                    ? ground.sharedMaterial.GetColor(BaseColorId) : Color.white;
                ColorAdjustments post = WastelandColorAdjustments(lighting);
                Color filter = post != null ? post.colorFilter.value : Color.white;
                var ambient = new Color[3];
                RenderSettings.ambientProbe.Evaluate(new[] { Vector3.up, Vector3.forward, Vector3.down }, ambient);

                lines.Add("location " + location.Id + " kind '" + location.Kind + "' safe " + location.Safe
                    + ", profile " + lighting.VisualProfileId + ", hour " + F(lighting.WorldHour));
                lines.Add("sun " + Hex(sample.SunColor) + " x" + F(sample.SunIntensity) + ", hemi sky " + Hex(sample.HemiSkyColor)
                    + " ground " + Hex(sample.HemiGroundColor) + " x" + F(sample.HemiIntensity) + ", fill " + Hex(sample.FillColor)
                    + ", fog " + Hex(RenderSettings.fogColor) + " " + F(RenderSettings.fogDensity, "0.0000")
                    + ", exposure " + F(sample.Exposure));
                lines.Add("ambient " + RenderSettings.ambientMode + " SH up " + Hex(ambient[0]) + " side " + Hex(ambient[1])
                    + " down " + Hex(ambient[2]) + ", post filter " + Hex(filter)
                    + " sat " + (post != null ? F(post.saturation.value) : "-")
                    + ", ground tint " + Hex(groundTint) + " over material " + Hex(groundMaterial));

                FrameColor current = Shoot(camera, bootstrap, 1600, 900, "current-desktop.png");
                Shoot(camera, bootstrap, 844, 390, "current-mobile.png");
                lines.Add("frame " + Describe(current));
                // С дальней камеры в кадр попадают постройки и реквизит вокруг точки входа.
                bootstrap.CameraRig.SetDistance(RoaCameraRig.MaximumGameplayDistance, false);
                await Seconds(3f);
                FrameColor far = Shoot(camera, bootstrap, 1600, 900, "far-desktop.png");
                lines.Add("far frame " + Describe(far));
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                await Seconds(3f);
                Color props = ShootProps(camera, bootstrap, location, out int propCount);
                lines.Add("props " + propCount + " " + Rgb(props));

                // Разбор: тот же кадр без оттенка земли — видно, чей цвет у земли, её или профиля.
                var untinted = new MaterialPropertyBlock();
                ground.GetPropertyBlock(untinted, 0);
                untinted.SetColor(BaseColorId, groundMaterial);
                ground.SetPropertyBlock(untinted, 0);
                try { lines.Add("no ground tint " + Describe(Shoot(camera, bootstrap, 1600, 900, "no-ground-tint-desktop.png"))); }
                finally { ground.SetPropertyBlock(block, 0); }

                bool warmProfile = location.VisualProfile != null
                    && Warm(location.VisualProfile, "sunDay") && Warm(location.VisualProfile, "hemiSkyDay")
                    && Warm(location.VisualProfile, "fillDay");
                lines.Add("authored profile " + (warmProfile ? "warm" : "not warm (only reported)"));
                if (warmProfile)
                {
                    Require(Warmth(sample.SunColor) >= 0f && Warmth(sample.HemiSkyColor) >= 0f && Warmth(sample.FillColor) >= 0f,
                        "тёплый авторский профиль, а солнце, небо или заполняющий свет синие");
                    Require(Warmth(filter) >= 0f, "фильтр постобработки красит кадр в синий: " + Hex(filter));
                    Require(Warmth(groundTint) >= -0.02f, "земля подкрашена в синий: " + Hex(groundTint));
                    Require(Warmth(current.Whole) >= 0f && Warmth(far.Whole) >= 0f,
                        "кадр уходит в синеву: " + Hex(current.Whole) + ", издали " + Hex(far.Whole));
                    Require(Warmth(current.Lower) >= 0f, "земля в кадре синяя: " + Hex(current.Lower));
                    Require(propCount == 0 || Warmth(props) >= 0f, "постройки и реквизит синие: " + Hex(props));
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

        private static ColorAdjustments WastelandColorAdjustments(RoaWorldLighting lighting)
        {
            foreach (Volume volume in lighting.GetComponentsInChildren<Volume>(true))
            {
                if (volume == null || volume.name != "Wasteland Post Processing" || volume.profile == null) continue;
                ColorAdjustments adjustments;
                if (volume.profile.TryGet(out adjustments)) return adjustments;
            }
            return null;
        }

        private static FrameColor Shoot(Camera camera, RoaGameBootstrap bootstrap, int width, int height, string name)
        {
            Texture2D image = Capture(camera, width, height);
            try
            {
                Color32[] pixels = image.GetPixels32();
                var frame = new FrameColor
                {
                    Whole = Mean(pixels, width, 0, 0, width, height),
                    Lower = Mean(pixels, width, 0, 0, width, height * 3 / 5)
                };
                Rect player = PlayerRect(camera, bootstrap, width, height);
                frame.Player = player.width > 2f && player.height > 2f
                    ? Mean(pixels, width, (int)player.xMin, (int)player.yMin, (int)player.xMax, (int)player.yMax)
                    : Color.clear;
                File.WriteAllBytes(Path.Combine(Output, name), image.EncodeToPNG());
                return frame;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(image);
            }
        }

        /// <summary>
        /// Постройки и реквизит локации: игровая камера тем же ракурсом переезжает на
        /// их середину и снимает кадр (props-desktop.png), а затем тот же кадр без
        /// земли — средний цвет всего, что не фон, и есть цвет реквизита.
        /// </summary>
        private static Color ShootProps(Camera camera, RoaGameBootstrap bootstrap, LocationDefinition location, out int count)
        {
            count = 0;
            var centre = Vector3.zero;
            foreach (LocationObject row in location.Objects)
            {
                GameObject root;
                if (row == null || !bootstrap.Loader.TryGetObjectRoot(row.Id, out root) || !root.activeInHierarchy) continue;
                Renderer[] renderers = root.GetComponentsInChildren<Renderer>();
                if (renderers.Length == 0) continue;
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers) bounds.Encapsulate(renderer.bounds);
                centre += bounds.center;
                count++;
            }
            if (count == 0 || bootstrap.PlayerView == null) return Color.clear;
            centre /= count;

            Transform view = camera.transform;
            Vector3 position = view.position;
            Renderer ground = bootstrap.Loader.CurrentGroundRenderer;
            try
            {
                view.position = centre + (position - bootstrap.PlayerView.transform.position);
                Shoot(camera, bootstrap, 1600, 900, "props-desktop.png");
                ground.enabled = false;
                Texture2D image = Capture(camera, 1600, 900);
                try
                {
                    Color background = camera.backgroundColor;
                    double r = 0, g = 0, b = 0;
                    int pixels = 0;
                    foreach (Color32 c in image.GetPixels32())
                    {
                        Color color = c;
                        if (Mathf.Abs(color.r - background.r) + Mathf.Abs(color.g - background.g)
                            + Mathf.Abs(color.b - background.b) < 0.06f) continue;
                        r += color.r; g += color.g; b += color.b;
                        pixels++;
                    }
                    return pixels == 0 ? Color.clear
                        : new Color((float)(r / pixels), (float)(g / pixels), (float)(b / pixels), 1f);
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(image);
                }
            }
            finally
            {
                ground.enabled = true;
                view.position = position;
            }
        }

        /// <summary>Прямоугольник персонажа на кадре (в пикселях текстуры, y снизу).</summary>
        private static Rect PlayerRect(Camera camera, RoaGameBootstrap bootstrap, int width, int height)
        {
            if (bootstrap.PlayerView == null) return Rect.zero;
            bool any = false;
            var bounds = new Bounds();
            foreach (Renderer renderer in bootstrap.PlayerView.GetComponentsInChildren<Renderer>())
            {
                if (renderer == null || !renderer.enabled || renderer is ParticleSystemRenderer) continue;
                if (!any) { bounds = renderer.bounds; any = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            if (!any) return Rect.zero;
            float xMin = float.MaxValue, yMin = float.MaxValue, xMax = float.MinValue, yMax = float.MinValue;
            for (int i = 0; i < 8; i++)
            {
                Vector3 corner = new Vector3((i & 1) == 0 ? bounds.min.x : bounds.max.x,
                    (i & 2) == 0 ? bounds.min.y : bounds.max.y, (i & 4) == 0 ? bounds.min.z : bounds.max.z);
                Vector3 viewport = camera.WorldToViewportPoint(corner);
                xMin = Mathf.Min(xMin, viewport.x); xMax = Mathf.Max(xMax, viewport.x);
                yMin = Mathf.Min(yMin, viewport.y); yMax = Mathf.Max(yMax, viewport.y);
            }
            // Средняя треть по ширине — корпус без фона по краям рамки.
            float third = (xMax - xMin) / 3f;
            return Rect.MinMaxRect(Mathf.Clamp((xMin + third) * width, 0, width), Mathf.Clamp(yMin * height, 0, height),
                Mathf.Clamp((xMax - third) * width, 0, width), Mathf.Clamp(yMax * height, 0, height));
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

        private static Color Mean(Color32[] pixels, int width, int x0, int y0, int x1, int y1)
        {
            double r = 0, g = 0, b = 0;
            int count = 0;
            for (int y = y0; y < y1; y += 2)
            for (int x = x0; x < x1; x += 2)
            {
                Color32 c = pixels[y * width + x];
                r += c.r; g += c.g; b += c.b;
                count++;
            }
            if (count == 0) return Color.clear;
            return new Color((float)(r / count / 255.0), (float)(g / count / 255.0), (float)(b / count / 255.0), 1f);
        }

        /// <summary>Насколько цвет краснее, чем синее: меньше нуля — синева.</summary>
        private static float Warmth(Color color)
        {
            return color.r - color.b;
        }

        private static bool Warm(JObject profile, string key)
        {
            Color color;
            string raw = profile[key]?.ToString();
            return !string.IsNullOrWhiteSpace(raw) && ColorUtility.TryParseHtmlString(raw, out color) && Warmth(color) > 0f;
        }

        private static string Describe(FrameColor frame)
        {
            return "whole " + Rgb(frame.Whole) + " lower " + Rgb(frame.Lower) + " player " + Rgb(frame.Player);
        }

        private static string Rgb(Color color)
        {
            return "(" + Mathf.RoundToInt(color.r * 255f) + "," + Mathf.RoundToInt(color.g * 255f) + "," + Mathf.RoundToInt(color.b * 255f) + ")";
        }

        private static string Hex(Color color)
        {
            return "#" + ColorUtility.ToHtmlStringRGB(color);
        }

        private static string F(float value, string format = "0.00")
        {
            return value.ToString(format, CultureInfo.InvariantCulture);
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
