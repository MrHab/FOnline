#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Погода в живом клиенте. Нужен локальный сервер с DEV_API_MODE=local и готовый
    /// персонаж в зоне: адрес, логин и пароль лежат в Library/WeatherPlayProbe/server.json
    /// ({ baseUrl, login, password }). Проба входит в игру авто-входом, закрепляет через
    /// /api/dev/weather ясно → дождь → ливень → мокро после дождя и в каждом состоянии
    /// проверяет, что видит игрок: струи и круги дождя, шум, чип под картой, мокрую
    /// землю (темнее и глаже), молнии в ливень и множитель шага из снимка сервера.
    /// Кадры камеры — 1600×900 и 844×390 (телефон в ландшафте) — в той же папке.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaWeatherPlayProbe
    {
        private const string Key = "Roa.WeatherPlayProbe";
        private const string Tag = "[WEATHER PLAY]";
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/WeatherPlayProbe"));

        static RoaWeatherPlayProbe()
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

        [MenuItem("Realm of Ashes/Погода/Проверить дождь в живом клиенте")]
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
            SessionState.SetString(Key + ".scene", AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene));
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

        private sealed class StateReport
        {
            public string Name;
            public int Streaks;
            public int Ripples;
            public float RainVolume;
            public string Chip;
            public string HudChip;
            public float MoveMultiplier;
            public float SunIntensity;
            public float FogDensity;
            public float GroundSmoothness;
            public float GroundWetness;
            public bool ShaderWetness;
            public Color GroundTint;
            public float GroundLuminance;
            public int Lightning;
        }

        private static async void Audit()
        {
            var lines = new List<string>();
            string verdict;
            try
            {
                RoaWeatherProbe.CheckRules();
                RoaGameBootstrap bootstrap = await Until(() => RoaGameBootstrap.Active != null && RoaGameBootstrap.Active.InGame
                    && RoaGameBootstrap.Active.Weather != null && RoaGameBootstrap.Active.Weather.Active
                    && RoaGameBootstrap.Active.Loader?.CurrentGroundRenderer != null ? RoaGameBootstrap.Active : null,
                    "вход в мир", 120f);
                RoaWeather weather = bootstrap.Weather;
                JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
                string baseUrl = server.Value<string>("baseUrl");
                Camera camera = bootstrap.CameraRig != null ? bootstrap.CameraRig.GetComponent<Camera>() : Camera.main;
                Require(camera != null, "нет игровой камеры");
                // Дистанция камеры сохраняется между запусками: кадры снимаем с игровой по умолчанию.
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                await Seconds(4f);

                StateReport clear = await Settle(baseUrl, "clear", weather, bootstrap, camera);
                // Тот же кадр прежней землёй URP/Lit (та же запечённая карта): «было» рядом со «стало».
                CaptureLegacyGround(bootstrap, camera);
                StateReport rain = await Settle(baseUrl, "rain", weather, bootstrap, camera);
                StateReport storm = await Settle(baseUrl, "storm", weather, bootstrap, camera);
                // Ливень с самой дальней камеры: струи обязаны укрупниться, а не исчезнуть.
                bootstrap.CameraRig.SetDistance(RoaCameraRig.MaximumGameplayDistance, false);
                await Seconds(3f);
                float farScale = weather.RainFx.ViewScale;
                Save(Capture(camera, 1600, 900), "storm-far-desktop.png");
                bootstrap.CameraRig.SetDistance(RoaCameraRig.DefaultGameplayDistance, false);
                await Seconds(3f);
                Require(farScale > 1.5f, "на дальней камере струи не укрупняются: " + farScale);
                // Ливень назначает удары сам; кадр вспышки снимаем по удару «сейчас» — на
                // тяжёлой сцене пакетный Unity даёт пару кадров в секунду и пик вспышки пропускает.
                Require(weather.LightningScheduled, "в ливень молнии не назначаются");
                weather.TriggerLightning(0f);
                Require(bootstrap.Lighting.LightningLight != null && bootstrap.Lighting.LightningLight.enabled
                    && bootstrap.Lighting.LightningLight.intensity > 1.5f, "удар молнии не включил свет");
                Texture2D flashFrame = Capture(camera, 1600, 900);
                float flashLuminance = LowerLuminance(flashFrame);
                Save(flashFrame, "storm-lightning-desktop.png");
                storm.Lightning = weather.LightningCount;
                Renderer groundRenderer = bootstrap.Loader.CurrentGroundRenderer;
                lines.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "flash luminance {0:0.000} vs storm {1:0.000}; ground centre y {2:0.00}, wet reflection {3}, default reflection {4} {5}",
                    flashLuminance, storm.GroundLuminance, groundRenderer.bounds.center.y,
                    bootstrap.Lighting.WetReflection != null && bootstrap.Lighting.WetReflection.enabled,
                    RenderSettings.defaultReflectionMode, ReflectionProbe.defaultTexture != null ? ReflectionProbe.defaultTexture.width.ToString() : "none"));
                Require(flashLuminance > storm.GroundLuminance * 1.15f, "вспышка молнии не освещает землю");
                Require(groundRenderer.bounds.center.y < RoaWorldLighting.WetReflectionTop - 0.01f,
                    "центр земли выше коробки отражения мокрой земли");
                StateReport wet = await Settle(baseUrl, "wet", weather, bootstrap, camera);
                await Post(baseUrl, "/api/dev/weather", "{\"override\":null}");

                foreach (StateReport row in new[] { clear, rain, storm, wet })
                    lines.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                        "{0}: streaks {1}, ripples {2}, rain volume {3:0.000}, chip '{4}' / HUD '{5}', walk x{6:0.000}, sun {7:0.00}, "
                        + "fog {8:0.0000}, ground smoothness {9:0.000}, tint {10:0.00}, ground luminance {11:0.000}, lightning {12}, wetness {13:0.00}",
                        row.Name, row.Streaks, row.Ripples, row.RainVolume, row.Chip, row.HudChip, row.MoveMultiplier,
                        row.SunIntensity, row.FogDensity, row.GroundSmoothness, row.GroundTint.grayscale, row.GroundLuminance, row.Lightning,
                        row.GroundWetness));

                Require(clear.Streaks == 0 && clear.Chip == "" && Mathf.Approximately(clear.MoveMultiplier, 1f), "в ясную не должно быть дождя и штрафа шага");
                Material groundMaterial = bootstrap.Loader.CurrentGroundRenderer.sharedMaterial;
                if (!clear.ShaderWetness)
                {
                    float materialSmoothness = groundMaterial.GetFloat("_Smoothness");
                    Require(Mathf.Abs(clear.GroundSmoothness - materialSmoothness) < 0.002f, "сухая земля не такая, как её материал");
                }
                else Require(clear.GroundWetness == 0f, "в ясную шейдер земли получает влажность");
                Require(rain.Streaks > 150 && rain.Ripples > 0, "в дождь не видно струй или кругов");
                Require(rain.Chip == "ДОЖДЬ", "чип дождя: " + rain.Chip);
                Require(rain.RainVolume > 0.02f, "дождь не слышно");
                Require(rain.SunIntensity < clear.SunIntensity * 0.8f, "облака не гасят солнце");
                Require(storm.Streaks > rain.Streaks * 1.3f, "ливень не гуще дождя");
                Require(storm.Chip == "ЛИВЕНЬ", "чип ливня: " + storm.Chip);
                Require(storm.MoveMultiplier < 0.95f && storm.MoveMultiplier > 0.8f, "грязь в ливень не замедляет шаг: " + storm.MoveMultiplier);
                Require(storm.FogDensity > clear.FogDensity * 3f, "ливень не сгущает дымку");
                Require(wet.Streaks == 0, "дождь кончился, а струи идут");
                Require(wet.Chip == "ГРЯЗЬ", "после дождя чип грязи: " + wet.Chip);
                if (wet.ShaderWetness)
                {
                    // Шейдер земли мочит себя сам: цвет часа не темнеет, влажность уходит в _Wetness.
                    Require(wet.GroundWetness > 0.5f && storm.GroundWetness > wet.GroundWetness * 0.99f,
                        "шейдер земли не получает влажность: " + wet.GroundWetness);
                }
                else
                {
                    Require(wet.GroundSmoothness > 0.3f, "мокрая земля не блестит");
                    Require(wet.GroundTint.grayscale < clear.GroundTint.grayscale * 0.8f, "мокрая земля не темнее сухой");
                }
                Require(wet.GroundLuminance < clear.GroundLuminance, "в кадре мокрая земля не темнее сухой");
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

        private static async Task<StateReport> Settle(string baseUrl, string state, RoaWeather weather,
                                                       RoaGameBootstrap bootstrap, Camera camera)
        {
            string response = await Post(baseUrl, "/api/dev/weather", "{\"override\":\"" + state + "\"}");
            Require(response.Contains("\"ok\":true"), "dev API не закрепил погоду " + state + ": " + response);
            string expected = state == "wet" ? "overcast" : state;
            await Until(() => weather.Target.Valid && weather.Target.Forced && weather.Target.State == expected ? weather : null,
                "снимок " + state, 20f);
            await Until(() => Mathf.Abs(weather.Rain - weather.Target.Rain) < 0.01f
                && Mathf.Abs(weather.Wetness - weather.Target.Wetness) < 0.01f
                && Mathf.Abs(weather.Cloud - weather.Target.Cloud) < 0.01f
                && Mathf.Abs(weather.Mud - weather.Target.Mud) < 0.01f ? weather : null, "сглаживание " + state, 40f);
            await Seconds(2.5f);

            var report = new StateReport { Name = state };
            report.Streaks = weather.RainFx.StreakCount;
            report.Ripples = weather.RainFx.RippleCount;
            report.RainVolume = bootstrap.Audio != null ? bootstrap.Audio.RainVolume : 0f;
            report.Chip = weather.ChipLabel;
            report.HudChip = HudChip();
            report.MoveMultiplier = weather.MoveSpeedMultiplier;
            report.SunIntensity = bootstrap.Lighting.Sun != null && bootstrap.Lighting.Sun.enabled ? bootstrap.Lighting.Sun.intensity : 0f;
            report.FogDensity = RenderSettings.fogDensity;
            Renderer ground = bootstrap.Loader.CurrentGroundRenderer;
            var block = new MaterialPropertyBlock();
            ground.GetPropertyBlock(block, 0);
            report.GroundSmoothness = block.GetFloat("_Smoothness");
            report.ShaderWetness = ground.sharedMaterial.HasProperty("_Wetness");
            report.GroundWetness = block.GetFloat("_Wetness");
            report.GroundTint = block.GetColor("_BaseColor");
            Texture2D desktop = Capture(camera, 1600, 900);
            report.GroundLuminance = LowerLuminance(desktop);
            Save(desktop, state + "-desktop.png");
            Save(Capture(camera, 844, 390), state + "-mobile.png");
            return report;
        }

        private static void CaptureLegacyGround(RoaGameBootstrap bootstrap, Camera camera)
        {
            Renderer ground = bootstrap.Loader.CurrentGroundRenderer;
            Material current = ground.sharedMaterial;
            if (!current.HasProperty("_SurfaceMask")) return;
            var legacy = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "ProbeLegacyGround" };
            legacy.SetTexture("_BaseMap", current.GetTexture("_BaseMap"));
            legacy.SetColor("_BaseColor", Color.white);
            legacy.SetFloat("_Smoothness", RoaWorldLighting.DryGroundSmoothness);
            try
            {
                ground.sharedMaterial = legacy;
                Save(Capture(camera, 1600, 900), "clear-legacy-desktop.png");
            }
            finally
            {
                ground.sharedMaterial = current;
                UnityEngine.Object.DestroyImmediate(legacy);
            }
        }

        private static string HudChip()
        {
            Text chip = Resources.FindObjectsOfTypeAll<Text>()
                .FirstOrDefault(text => text.transform.parent != null && text.transform.parent.name == "Weather"
                    && text.gameObject.scene.IsValid());
            if (chip == null) return "<нет>";
            return chip.transform.parent.gameObject.activeInHierarchy ? chip.text : "";
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

        /// <summary>Средняя яркость нижних трёх пятых кадра — там почти одна земля.</summary>
        private static float LowerLuminance(Texture2D image)
        {
            Color32[] pixels = image.GetPixels32();
            int rows = image.height * 3 / 5;
            double sum = 0;
            int count = 0;
            for (int y = 0; y < rows; y += 2)
            for (int x = 0; x < image.width; x += 2)
            {
                Color32 c = pixels[y * image.width + x];
                sum += (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255.0;
                count++;
            }
            return (float)(sum / Math.Max(1, count));
        }

        private static void Save(Texture2D image, string name)
        {
            Directory.CreateDirectory(Output);
            File.WriteAllBytes(Path.Combine(Output, name), image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
        }

        private static async Task<string> Post(string baseUrl, string route, string json)
        {
            using (var request = new UnityWebRequest(baseUrl.TrimEnd('/') + route, "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                request.SetRequestHeader("x-dev-local", "1");
                UnityWebRequestAsyncOperation operation = request.SendWebRequest();
                while (!operation.isDone) await Task.Yield();
                return request.downloadHandler.text ?? request.error ?? string.Empty;
            }
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
